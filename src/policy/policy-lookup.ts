import type { AgentClient } from "@croo-network/sdk";
import { extractPolicyId, policyIdMatches } from "./policy-id.js";
import type { CreatePolicyDelivery, StoredPolicy } from "./types.js";

const MAX_ORDER_PAGES = 5;
const ORDER_PAGE_SIZE = 100;

async function listProviderOrders(client: AgentClient): Promise<
  Awaited<ReturnType<AgentClient["listOrders"]>>
> {
  const all: Awaited<ReturnType<AgentClient["listOrders"]>> = [];
  for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
    const batch = await client.listOrders({
      role: "provider",
      pageSize: ORDER_PAGE_SIZE,
      page,
    });
    if (batch.length === 0) {
      break;
    }
    all.push(...batch);
    if (batch.length < ORDER_PAGE_SIZE) {
      break;
    }
  }
  return all;
}

function deliveryBody(raw: {
  deliverableText?: string;
  deliverableSchema?: string | Record<string, unknown>;
}): string {
  if (typeof raw.deliverableText === "string" && raw.deliverableText.trim()) {
    return raw.deliverableText.trim();
  }
  if (typeof raw.deliverableSchema === "string" && raw.deliverableSchema.trim()) {
    return raw.deliverableSchema.trim();
  }
  if (raw.deliverableSchema && typeof raw.deliverableSchema === "object") {
    return JSON.stringify(raw.deliverableSchema);
  }
  return "";
}

function parsePolicyIdFromDelivery(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { policyId?: string };
    const id = parsed.policyId?.trim();
    if (id && extractPolicyId(id)) {
      return id.toLowerCase();
    }
  } catch {
    return extractPolicyId(raw);
  }
  return null;
}

function parseCreatePolicyDelivery(raw: unknown): CreatePolicyDelivery | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CreatePolicyDelivery;
    const policyId = parsed.policyId?.trim().toLowerCase();
    if (
      policyId &&
      extractPolicyId(policyId) &&
      parsed.policy?.recipients?.length
    ) {
      return { ...parsed, policyId };
    }
  } catch {
    return null;
  }
  return null;
}

export async function loadPolicyFromCompletedOrders(
  client: AgentClient,
  policyId: string,
  createPolicyServiceId: string,
  requesterAgentId?: string,
): Promise<StoredPolicy | null> {
  const targetId = policyId.trim().toLowerCase();
  const orders = await listProviderOrders(client);

  const candidates = orders
    .filter(
      (order) =>
        order.serviceId === createPolicyServiceId &&
        order.status === "completed" &&
        (!requesterAgentId || order.requesterAgentId === requesterAgentId),
    )
    .sort(
      (a, b) => Date.parse(b.createdTime) - Date.parse(a.createdTime),
    );

  for (const order of candidates) {
    try {
      const delivery = await client.getDelivery(order.orderId);
      const parsed = parseCreatePolicyDelivery(deliveryBody(delivery));
      if (parsed && policyIdMatches(targetId, parsed.policyId)) {
        return {
          ...parsed,
          policyId: parsed.policyId,
          createdAt: order.createdTime ?? new Date().toISOString(),
        };
      }
    } catch {
    }
  }

  return null;
}

export async function resolvePolicyIdFromRequester(
  client: AgentClient,
  requesterAgentId: string,
  createPolicyServiceId: string,
  beforeIso?: string,
): Promise<string | null> {
  const orders = await listProviderOrders(client);
  const beforeMs = beforeIso ? Date.parse(beforeIso) : Number.POSITIVE_INFINITY;

  const candidates = orders
    .filter(
      (order) =>
        order.serviceId === createPolicyServiceId &&
        order.status === "completed" &&
        order.requesterAgentId === requesterAgentId &&
        Date.parse(order.createdTime) <= beforeMs,
    )
    .sort(
      (a, b) =>
        Date.parse(b.createdTime) - Date.parse(a.createdTime),
    );

  for (const order of candidates) {
    try {
      const delivery = await client.getDelivery(order.orderId);
      const policyId = parsePolicyIdFromDelivery(deliveryBody(delivery));
      if (policyId) {
        return policyId;
      }
    } catch {
    }
  }

  return null;
}
