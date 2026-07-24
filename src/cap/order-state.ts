import { NegotiationStatus, OrderStatus } from "@croo-network/sdk";

export function isOrderAwaitingDelivery(status: string): boolean {
  return status === OrderStatus.Paid || status === OrderStatus.DeliverFailed;
}

export function isOrderTerminal(status: string): boolean {
  return (
    status === OrderStatus.Completed ||
    status === OrderStatus.Rejected ||
    status === OrderStatus.Expired ||
    status === OrderStatus.CreateFailed ||
    status === OrderStatus.PayFailed
  );
}

export type OrderPaidGate = {
  proceed: boolean;
  reason: string;
};

export function shouldProcessOrderPaid(status: string): OrderPaidGate {
  if (isOrderTerminal(status)) {
    return { proceed: false, reason: `terminal status ${status}` };
  }
  if (status === OrderStatus.Delivering) {
    return { proceed: false, reason: "delivery already in progress" };
  }
  if (status === OrderStatus.Creating || status === OrderStatus.Created) {
    return { proceed: false, reason: `payment not confirmed (status ${status})` };
  }
  if (status === OrderStatus.Paying) {
    return { proceed: false, reason: "payment in progress" };
  }
  if (isOrderAwaitingDelivery(status)) {
    return { proceed: true, reason: "ready for delivery" };
  }
  return { proceed: false, reason: `unexpected status ${status}` };
}

export function shouldAcceptNegotiation(status: string): boolean {
  return status === NegotiationStatus.Pending;
}

const orderLocks = new Map<string, Promise<void>>();
const negotiationLocks = new Map<string, Promise<void>>();

function withLock<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => gate);
  locks.set(key, chain);

  return previous.then(async () => {
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === chain) {
        locks.delete(key);
      }
    }
  });
}

export async function withOrderLock<T>(
  orderId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withLock(orderLocks, orderId, fn);
}

export async function withNegotiationLock<T>(
  negotiationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withLock(negotiationLocks, negotiationId, fn);
}
