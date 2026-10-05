/**
 * [B23-C] The ordering suites' shared fixture (runbook B23-C :984-998; D23-10, D23-11; OD-170..OD-172): obvious fake actors, a scope,
 * a COMPLETE fake owner record (only a test may hold one: no such record exists in B23, OD-171), a binding, a clock, a server-nonce
 * sequence and a fake order port - an in-process object whose every answer the suite scripts. Nothing here is a provider, an account
 * or a credential, nothing leaves the process and nothing is written.
 */
import { orderingEnablement, type OrderingEnablement, type OrderingOwnerRecord } from "../ordering-enablement";
import type { OrderRequoteInput, OrderSubmissionPort, OrderSubmitInput } from "../order-contract";
import type { PurchaseActor, PurchaseBinding, PurchaseScope } from "../purchase-authorization";

export const SCOPE: PurchaseScope = Object.freeze({ tenantId: "tenant-b23c", projectId: "project-b23c", branchId: "main" });
export const OTHER_SCOPE: PurchaseScope = Object.freeze({ tenantId: "tenant-b23c", projectId: "project-other", branchId: "main" });
export const ADMIN_A: PurchaseActor = Object.freeze({ actorId: "user:requester-a", actorKind: "human", role: "project_admin" });
export const ADMIN_B: PurchaseActor = Object.freeze({ actorId: "user:approver-b", actorKind: "human", role: "project_admin" });
export const ADMIN_C: PurchaseActor = Object.freeze({ actorId: "user:approver-c", actorKind: "human", role: "project_admin" });
/** Every actor that may never request, approve or consume: other human roles, the model, automation and the migration actor. */
export const REFUSED_ACTORS: ReadonlyArray<PurchaseActor> = Object.freeze([
  { actorId: "user:editor", actorKind: "human", role: "pcb_editor" },
  { actorId: "user:reviewer", actorKind: "human", role: "reviewer" },
  { actorId: "user:viewer", actorKind: "human", role: "viewer" },
  { actorId: "user:migration", actorKind: "human", role: "migration_admin" },
  { actorId: "agent:chat", actorKind: "ai", role: "project_admin" },
  { actorId: "automation:worker", actorKind: "automation", role: "project_admin" },
  { actorId: "system:migration", actorKind: "system_migration", role: "project_admin" },
]);

const fakeReference = (name: string): string => ["test-fake", name, "b23c"].join(":");
/** A complete owner record, every reference an obvious test fake. B23 holds none (`ORDERING_OWNER_RECORD` is null). */
export const TEST_OWNER_RECORD: OrderingOwnerRecord = Object.freeze({
  ownerDecision: "OD-999",
  prerequisites: Object.freeze({
    account_reference: fakeReference("account"),
    spend_and_quantity_limits: fakeReference("limits"),
    billing_shipping_policy: fakeReference("billing-shipping"),
    authorized_roles: fakeReference("roles"),
    cancellation_refund_behaviour: fakeReference("cancellation-refund"),
    legal_compliance: fakeReference("legal-compliance"),
    sandbox_path: fakeReference("sandbox"),
  }),
});
/** The only enabled verdict a suite can hold: the real `orderingEnablement` over the fake record and a wired port (a test port). */
export const enabledOrdering = (): OrderingEnablement => orderingEnablement({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired", env: {} });

export const T0 = Date.parse("2026-10-04T12:00:00.000Z");
export function testClock(start: number = T0): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}
/** 32 hex characters per call, as the server's random nonce would be (distinct, deterministic). [B23-C fix, 2026-10-04] the counter is
 *  left-padded (tests-9: right-padding made "c1" and "c10" one value, so a 17th request replaced the 2nd). */
export function testNonces(prefix = "c"): () => string {
  let count = 0;
  return () => `${prefix}${(count++).toString(16).padStart(32 - prefix.length, "0")}`.slice(0, 32);
}

/** Two lines (10 x 0.45 + 100 x 0.0123 = 5.73), a ceiling of 25, nine minutes to expiry. */
export function testBinding(now: number = T0, overrides: Partial<PurchaseBinding> = {}): PurchaseBinding {
  return {
    providerId: "digikey",
    operationId: "ordering",
    lines: [
      { lineId: "L1", providerPartNumber: "296-1411-5-ND", quantity: 10, unitPriceDecimal: "0.45" },
      { lineId: "L2", providerPartNumber: "311-10.0KCRCT-ND", quantity: 100, unitPriceDecimal: "0.0123" },
    ],
    currency: "USD",
    priceCeilingDecimal: "25",
    shippingDestinationRef: "destination:lab-bench-1",
    releaseDigest: "mfg-release-45b3b7efbc85dc3a8ecd233c906384cd",
    expiresAt: new Date(now + 9 * 60_000).toISOString(),
    ...overrides,
  };
}

/** The re-read the fake provider answers by default: the bound prices, everything in stock, 7.5 of charges (total 13.23). */
export function quoteFor(input: OrderRequoteInput, overrides: { prices?: Record<string, string>; available?: Record<string, number | null>; charges?: string; total?: string; currency?: string } = {}): Record<string, unknown> {
  const bound: Record<string, string> = { L1: "0.45", L2: "0.0123" };
  const lines = input.lines.map((line) => ({ lineId: line.lineId, providerPartNumber: line.providerPartNumber, unitPriceDecimal: overrides.prices?.[line.lineId] ?? bound[line.lineId] ?? "1", availableQuantity: overrides.available && line.lineId in overrides.available ? overrides.available[line.lineId] : 100_000 }));
  return { currency: overrides.currency ?? input.currency, lines, chargesDecimal: overrides.charges ?? "7.5", totalDecimal: overrides.total ?? "13.23" };
}

export type PortCall = { readonly kind: "requote"; readonly input: OrderRequoteInput } | { readonly kind: "submit"; readonly input: OrderSubmitInput };
/** A fake order port: it records every call and answers what the suite scripts (a value, a throw or a promise that never settles). */
export function fakeOrderPort(script: { requote?: (input: OrderRequoteInput, signal: AbortSignal) => unknown; submit?: (input: OrderSubmitInput, signal: AbortSignal) => unknown } = {}): OrderSubmissionPort & { readonly calls: PortCall[]; count(kind: PortCall["kind"]): number } {
  const calls: PortCall[] = [];
  return {
    calls,
    count: (kind) => calls.filter((call) => call.kind === kind).length,
    async requote(input, signal) {
      calls.push({ kind: "requote", input });
      return script.requote ? script.requote(input, signal) : quoteFor(input);
    },
    async submit(input, signal) {
      calls.push({ kind: "submit", input });
      return script.submit ? script.submit(input, signal) : { outcome: "accepted", providerOrderId: `fake-provider-order-${calls.length}` };
    },
  };
}

/** A webhook secret assembled at run time (an obvious fake, never a key-shaped literal). */
export const TEST_WEBHOOK_SECRET = ["fake", "b23c", "webhook", "signing", "secret", "0123456789"].join("-");
/** A promise that never settles (a provider that never answers). */
export const never = (): Promise<never> => new Promise<never>(() => undefined);
