import {
  DeliverableType,
  isInvalidStatus,
  type AgentClient,
  type Negotiation,
  type Order,
} from "@croo-network/sdk";
import { isCreateEnsService, isCreatePolicyService, isExecutePaymentService, isInstantUsdcPayService, isResolveEnsService } from "../config.js";
import { executePayrollSettlement } from "../chain/payroll-settlement.js";
import {
  isNonFundServiceAcceptError,
  settleInstantUsdcPay,
} from "../chain/instant-pay-settlement.js";
import { createEnsFromRequirements } from "../policy/ens-service.js";
import { attachEnsJourneyGuide, attachPolicyJourneyGuide } from "../policy/journey-guide.js";
import { interpretPolicyFromRequirements } from "../policy/interpreter.js";
import {
  parseExecutePayrollPlan,
  resolveExecuteFundAddress,
} from "../policy/execute-resolver.js";
import {
  parseInstantUsdcPayRequirements,
  resolveInstantPayFundAddress,
  resolveInstantUsdcPay,
} from "../policy/instant-usdc-pay.js";
import { savePolicy, toStoredPolicy } from "../policy/store.js";
import { resolveEnsFromRequirements } from "../policy/ens-resolve.js";
import {
  assertLedgerReadyForFundOrders,
  claimOrderProcessing,
  getStagedDelivery,
  isFulfillmentReadyForDelivery,
  ledgerPhase,
  LEDGER_PHASE_PROCESSING,
  loadOrderFulfillment,
  releaseOrderAdvisoryLock,
  saveOrderFulfillment,
  stageOrderDelivery,
  tryAcquireOrderAdvisoryLock,
} from "./order-ledger.js";
import {
  shouldAcceptNegotiation,
  shouldProcessOrderPaid,
  withNegotiationLock,
  withOrderLock,
} from "./order-state.js";

export type HandlerContext = {
  client: AgentClient;
  orderId: string;
  order: Order;
  negotiation: Negotiation;
};

function log(level: "info" | "error", message: string, extra?: unknown): void {
  const prefix = "[remifi]";
  if (extra !== undefined) {
    console[level](prefix, message, extra);
  } else {
    console[level](prefix, message);
  }
}

async function deliverSchema(
  client: AgentClient,
  orderId: string,
  payload: Record<string, unknown>,
): Promise<string | undefined> {
  const json = JSON.stringify(payload);
  try {
    const result = await client.deliverOrder(orderId, {
      deliverableType: DeliverableType.Schema,
      deliverableSchema: json,
      deliverableText: json,
    });
    return result.txHash;
  } catch (err) {
    if (isInvalidStatus(err)) {
      log("info", `deliverOrder skipped — order ${orderId} already past delivery`, {
        reason: err instanceof Error ? err.message : String(err),
      });
      const order = await client.getOrder(orderId);
      return order.deliverTxHash?.trim() || undefined;
    }
    throw err;
  }
}

async function finalizeDelivery(
  client: AgentClient,
  orderId: string,
  serviceId: string,
  deliveryPayload: Record<string, unknown>,
): Promise<string | undefined> {
  await saveOrderFulfillment(orderId, serviceId, deliveryPayload);
  return deliverSchema(client, orderId, deliveryPayload);
}

function isFundTransferService(serviceId: string): boolean {
  return isExecutePaymentService(serviceId) || isInstantUsdcPayService(serviceId);
}

async function buildSchemaDelivery(
  ctx: HandlerContext,
): Promise<Record<string, unknown>> {
  const { order, negotiation } = ctx;

  if (isCreateEnsService(order.serviceId)) {
    const delivery = await createEnsFromRequirements(negotiation.requirements);
    const enriched = attachEnsJourneyGuide(delivery);
    const ens =
      "names" in delivery ? delivery.names[0]?.ens : delivery.ens;
    log("info", `createEnsName delivered ${ens ?? "batch"}`, {
      nextStep: enriched.journeyGuide.nextStep.service,
    });
    await stageOrderDelivery(ctx.orderId, order.serviceId, enriched);
    return enriched;
  }

  if (isResolveEnsService(order.serviceId)) {
    const delivery = await resolveEnsFromRequirements(negotiation.requirements);
    const resolved = delivery.results.filter((row) => row.resolved).length;
    log("info", `resolveEnsName delivered ${resolved}/${delivery.results.length}`, {
      success: delivery.success,
    });
    await stageOrderDelivery(ctx.orderId, order.serviceId, delivery);
    return delivery;
  }

  if (isCreatePolicyService(order.serviceId)) {
    const delivery = await interpretPolicyFromRequirements(negotiation.requirements);
    delivery.journeyGuide = attachPolicyJourneyGuide(delivery);
    await stageOrderDelivery(ctx.orderId, order.serviceId, delivery);
    await savePolicy(toStoredPolicy(delivery));
    log("info", `createPolicy delivered ${delivery.policyId}`, {
      recipients: delivery.policy.recipients.length,
      payrollRecipients: delivery.executionGuide?.payroll.recipientCount ?? 0,
    });
    return delivery;
  }

  throw new Error(`buildSchemaDelivery called for unsupported service ${order.serviceId}`);
}

async function buildInstantPayDelivery(
  ctx: HandlerContext,
): Promise<Record<string, unknown>> {
  const fundAmount = ctx.order.fundAmount ?? ctx.negotiation.fundAmount;
  if (!fundAmount?.trim()) {
    throw new Error(
      "Instant USDC Pay order missing fundAmount — buyer must pay principal via fund transfer checkout",
    );
  }
  const parsed = await parseInstantUsdcPayRequirements(ctx.negotiation.requirements, {
    fundAmount,
  });
  if (parsed.amount === "0" || BigInt(parsed.amount) <= 0n) {
    parsed.amount = fundAmount.trim();
  }
  const resolved = await resolveInstantUsdcPay(parsed);
  return settleInstantUsdcPay(ctx.order, resolved);
}

export async function handleOrderPaid(
  client: AgentClient,
  orderId: string,
): Promise<void> {
  await withOrderLock(orderId, async () => {
    const dbLocked = await tryAcquireOrderAdvisoryLock(orderId);
    if (!dbLocked) {
      log("info", `order_paid ${orderId} skipped — advisory lock held by another worker`);
      return;
    }

    try {
      const order = await client.getOrder(orderId);
      const gate = shouldProcessOrderPaid(order.status);
      if (!gate.proceed) {
        log("info", `order_paid ${orderId} skipped`, {
          status: order.status,
          reason: gate.reason,
        });
        return;
      }

      if (isFundTransferService(order.serviceId)) {
        assertLedgerReadyForFundOrders();
      }

      const existing = await loadOrderFulfillment(orderId);
      if (existing && isFulfillmentReadyForDelivery(existing.deliveryPayload)) {
        const payload =
          getStagedDelivery(existing.deliveryPayload) ?? existing.deliveryPayload;
        log("info", `order_paid ${orderId} replaying saved delivery`, {
          serviceId: existing.serviceId,
        });
        await finalizeDelivery(client, orderId, order.serviceId, payload);
        return;
      }

      const staged = existing ? getStagedDelivery(existing.deliveryPayload) : null;
      if (staged) {
        log("info", `order_paid ${orderId} delivering staged result`, {
          serviceId: order.serviceId,
        });
        await finalizeDelivery(client, orderId, order.serviceId, staged);
        return;
      }

      const negotiation = await client.getNegotiation(order.negotiationId);
      const ctx: HandlerContext = { client, orderId, order, negotiation };

      let executePlan: Awaited<ReturnType<typeof parseExecutePayrollPlan>> | undefined;

      if (isExecutePaymentService(order.serviceId)) {
        executePlan = await parseExecutePayrollPlan(negotiation.requirements, {
          client,
          requesterAgentId: negotiation.requesterAgentId,
          fundAmount: order.fundAmount ?? negotiation.fundAmount,
          orderCreatedAt: order.createdTime ?? negotiation.createdTime,
        });
      }

      const resuming =
        existing && ledgerPhase(existing.deliveryPayload) === LEDGER_PHASE_PROCESSING;

      if (resuming) {
        if (!isFundTransferService(order.serviceId)) {
          throw new Error(
            `Order ${orderId} is processing without staged delivery — ` +
              "schema services must stage results before deliver; retry after provider restart",
          );
        }
        log("info", `order_paid ${orderId} resuming fund-transfer fulfillment`, {
          serviceId: order.serviceId,
        });
      } else {
        const claimed = await claimOrderProcessing(
          orderId,
          order.serviceId,
          executePlan
            ? {
                policyId: executePlan.policyId,
                totalUsdc: executePlan.totalUsdc,
                fundAmount: executePlan.fundAmount,
                recipientCount: executePlan.legs.length,
              }
            : { requesterAgentId: negotiation.requesterAgentId },
        );

        if (!claimed) {
          const raced = await loadOrderFulfillment(orderId);
          const racedStaged = raced ? getStagedDelivery(raced.deliveryPayload) : null;
          if (racedStaged) {
            await finalizeDelivery(client, orderId, order.serviceId, racedStaged);
            return;
          }
          if (raced && isFulfillmentReadyForDelivery(raced.deliveryPayload)) {
            const payload =
              getStagedDelivery(raced.deliveryPayload) ?? raced.deliveryPayload;
            await finalizeDelivery(client, orderId, order.serviceId, payload);
            return;
          }
          if (!isFundTransferService(order.serviceId)) {
            throw new Error(
              `Order ${orderId} claim race without staged delivery — cannot safely retry schema service`,
            );
          }
          log("info", `order_paid ${orderId} resuming after concurrent claim`, {
            serviceId: order.serviceId,
          });
        }
      }

      log("info", `order_paid ${orderId}`, {
        serviceId: order.serviceId,
        status: order.status,
        fundAmount: order.fundAmount ?? null,
        providerFundAddress: order.providerFundAddress ?? null,
        resuming,
      });

      let deliveryPayload: Record<string, unknown>;

      if (isExecutePaymentService(order.serviceId)) {
        if (!executePlan) {
          executePlan = await parseExecutePayrollPlan(negotiation.requirements, {
            client,
            requesterAgentId: negotiation.requesterAgentId,
            fundAmount: order.fundAmount ?? negotiation.fundAmount,
            orderCreatedAt: order.createdTime ?? negotiation.createdTime,
          });
        }
        deliveryPayload = await executePayrollSettlement(order, executePlan);
        await stageOrderDelivery(orderId, order.serviceId, deliveryPayload);
      } else if (isInstantUsdcPayService(order.serviceId)) {
        deliveryPayload = await buildInstantPayDelivery(ctx);
        await stageOrderDelivery(orderId, order.serviceId, deliveryPayload);
      } else if (
        isCreateEnsService(order.serviceId) ||
        isResolveEnsService(order.serviceId) ||
        isCreatePolicyService(order.serviceId)
      ) {
        deliveryPayload = await buildSchemaDelivery(ctx);
      } else {
        throw new Error(
          `Unknown service ${order.serviceId}. Set CROO_SERVICE_ID_CREATE_POLICY, ` +
            `CROO_SERVICE_ID_CREATE_ENS, CROO_SERVICE_ID_RESOLVE_ENS, ` +
            `CROO_SERVICE_ID_EXECUTE_PAYMENT, and CROO_SERVICE_ID_INSTANT_USDC_PAY in .env.`,
        );
      }

      const deliverTxHash = await finalizeDelivery(
        client,
        orderId,
        order.serviceId,
        deliveryPayload,
      );

      if (isExecutePaymentService(order.serviceId)) {
        const delivery = deliveryPayload as Awaited<ReturnType<typeof executePayrollSettlement>>;
        log("info", `executePaymentJob payroll delivered ${delivery.policyId}`, {
          settlement: delivery.settlement,
          fundTxHash: delivery.fundTxHash,
          deliverTxHash: deliverTxHash ?? delivery.deliverTxHash,
          recipients: delivery.recipients.length,
        });
      } else if (isInstantUsdcPayService(order.serviceId)) {
        const delivery = deliveryPayload as Awaited<ReturnType<typeof settleInstantUsdcPay>>;
        log("info", `instantUsdcPay delivered → ${delivery.to}`, {
          amountUsdc: delivery.amountUsdc,
          fundTxHash: delivery.fundTxHash,
          deliverTxHash,
          settlement: delivery.settlement,
        });
      }
    } finally {
      await releaseOrderAdvisoryLock(orderId);
    }
  });
}

export async function acceptNegotiation(
  client: AgentClient,
  negotiation: Negotiation,
): Promise<void> {
  const { negotiationId, serviceId } = negotiation;

  await withNegotiationLock(negotiationId, async () => {
    const latest = await client.getNegotiation(negotiationId);

    if (!shouldAcceptNegotiation(latest.status)) {
      log("info", `negotiation ${negotiationId} skipped`, {
        status: latest.status,
      });
      return;
    }

    if (isExecutePaymentService(serviceId)) {
      const fundAddress = await resolveExecuteFundAddress(client, latest.requirements);
      const result = await client.acceptNegotiationWithFundAddress(
        negotiationId,
        fundAddress,
      );
      log("info", `accepted fund-transfer → ${fundAddress} → order ${result.order.orderId}`);
      return;
    }

    if (isInstantUsdcPayService(serviceId)) {
      const fundAddress = await resolveInstantPayFundAddress(
        latest.requirements,
        { fundAmount: latest.fundAmount },
      );
      try {
        const result = await client.acceptNegotiationWithFundAddress(
          negotiationId,
          fundAddress,
        );
        log("info", `accepted instant USDC pay (CAP → recipient) → ${fundAddress} → order ${result.order.orderId}`);
      } catch (err) {
        if (isNonFundServiceAcceptError(err)) {
          throw new Error(
            "Instant USDC Pay requires Require Fund Transfer ON in Agent Store. " +
              "CROO sends USDC directly to the recipient — no Router or payout wallet.",
          );
        }
        throw err;
      }
      return;
    }

    const result = await client.acceptNegotiation(negotiationId);
    log("info", `accepted negotiation → order ${result.order.orderId}`);
  });
}

export async function deliverFailure(
  client: AgentClient,
  orderId: string,
  reason: string,
): Promise<void> {
  await deliverSchema(client, orderId, {
    success: false,
    error: reason,
  });
}
