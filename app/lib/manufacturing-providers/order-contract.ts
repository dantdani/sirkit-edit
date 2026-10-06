/**
 * [B23-C] The order contract, against an INJECTED port only (runbook B23-C :996-998; D23-4's order-contract half, D23-11; OD-172).
 * No production port exists and no composition root constructs this contract or wires a port (b23-c-order-contract case 7); only a
 * test injects a fake one. The record's state machine is B23-B2's exchange record's pattern (`exchange-ledger.ts`), in memory:
 * `prepared -> submitted -> accepted | rejected | UNKNOWN_PENDING_RECONCILIATION`, or `prepared -> not_submitted`.
 *
 *  - Turned off first: while `orderingEnablement()` is disabled (OD-171; always in B23) nothing is consumed, read or sent.
 *  - A human project administrator only; the model, automation and every other role are refused before anything is read.
 *  - One order per authorization: a repeated or concurrent submit of one authorization answers its record and sends nothing; a new
 *    authorization for a cart whose order is unresolved (`prepared`, `submitted` or `UNKNOWN_PENDING_RECONCILIATION`), or that another
 *    authorization has claimed for its burn, is refused before its authorization is burned (the cart is what is ordered, cartDigestOf).
 *  - The authorization is burned (purchase-authorization.ts, one compare-and-set, the exact binding), then price and availability are
 *    RE-READ immediately before the submission: any changed unit price, stock short of a line, another currency or other lines, a total
 *    that does not add up, or a total above the ceiling refuses and nothing is submitted.
 *  - The submission is made ONCE, under one idempotency key derived from the authorization, inside a deadline. An acceptance with a
 *    usable provider order id is `accepted`, a definite refusal `rejected`; anything else - a throw, an abort, a timeout, a server
 *    error, an unreadable answer - is `UNKNOWN_PENDING_RECONCILIATION`, never retried; a person reconciles it with the provider.
 *  - A webhook is verified (webhook-verification.ts: signature over the raw body, timestamp window, replay store) and recorded as an
 *    observation on the order it names, of the provider whose secret signed it; it never creates, submits or changes an order.
 */
import { durableWorkflowDigest } from "../durable-workflow/stable";
import { orderingEnablementFromProcess, type OrderingEnablement } from "./ordering-enablement";
import { addMoney, canonicalMoney, cartDigestOf, compareMoney, linesTotal, type PurchaseActor, type PurchaseAuthorizationStore, type PurchaseBinding, type PurchaseScope } from "./purchase-authorization";
import { verifyWebhook, type WebhookHeaders, type WebhookRefusal, type WebhookReplayStore } from "./webhook-verification";

export const ORDER_STATES = Object.freeze(["prepared", "submitted", "accepted", "rejected", "UNKNOWN_PENDING_RECONCILIATION", "not_submitted"] as const);
export type OrderState = (typeof ORDER_STATES)[number];
/** The re-read's and the submission's deadlines (a port that never answers ends the call; the submission's end is then UNKNOWN). */
export const ORDER_DEADLINES_MS = Object.freeze({ requoteMs: 15_000, submitMs: 30_000 });
export const ORDER_LIMITS = Object.freeze({ ordersPerScope: 256, orders: 16_384, observationsPerOrder: 32 });
export const ORDER_WEBHOOK_STATUSES = Object.freeze(["accepted", "in_production", "shipped", "delivered", "cancelled", "rejected"] as const);

export const ORDER_CONTRACT_CODES = Object.freeze({
  ORDER_DISABLED: "Ordering through Sirkit is turned off (OD-171): nothing was consumed, read or sent.",
  ORDER_HUMAN_ADMIN_REQUIRED: "Only a human project administrator submits an order. Nothing was consumed, read or sent.",
  ORDER_AUTHORIZATION_REFUSED: "The purchase authorization was refused (see `authorization`). Nothing was sent.",
  ORDER_IN_FLIGHT: "An order of this cart is unresolved (prepared, submitted or UNKNOWN_PENDING_RECONCILIATION); nothing more is sent until a person reconciles it. Nothing was sent by this request.",
  ORDER_LIMIT_REACHED: "This project, or the server, holds as many orders as it may. Nothing was consumed, read or sent.",
  ORDER_REQUOTE_FAILED: "Price and availability could not be re-read before the submission. Nothing was submitted; the authorization is spent.",
  ORDER_REQUOTE_MISMATCH: "The re-read does not answer the confirmed lines in the confirmed currency with a total that adds up. Nothing was submitted; the authorization is spent.",
  ORDER_PRICE_CHANGED: "A unit price changed since the confirmation. Nothing was submitted; the authorization is spent.",
  ORDER_AVAILABILITY_SHORT: "A line's stock is short or unknown. Nothing was submitted; the authorization is spent.",
  ORDER_ABOVE_CEILING: "The re-read total is above the confirmed price ceiling. Nothing was submitted; the authorization is spent.",
  ORDER_ACCEPTED: "The provider accepted the order; its order id is recorded. An acceptance is the provider's observation, never Sirkit proof.",
  ORDER_REJECTED: "The provider refused the order. It is never retried.",
  ORDER_UNKNOWN_PENDING_RECONCILIATION: "The order was handed to the provider but its answer is unknown. It is UNKNOWN_PENDING_RECONCILIATION: never retried; a person reconciles it with the provider.",
  ORDER_DISABLED_BEFORE_SUBMISSION: "Ordering through Sirkit was turned off (OD-171) before the submission. Nothing was submitted; the authorization is spent.", ORDER_CART_BUSY: "Another submission of this cart is in progress and holds it until its own authorization is checked. This request consumed, read and sent nothing; submit the authorization again in a moment.", // [B23-C lead, 2026-10-04] a claim conflict's own answer (it answered ORDER_IN_FLIGHT, though no order existed)
} satisfies Record<string, string>);
export type OrderCode = keyof typeof ORDER_CONTRACT_CODES;

export interface OrderRequoteInput { readonly providerId: string; readonly operationId: string; readonly currency: string; readonly lines: ReadonlyArray<{ readonly lineId: string; readonly providerPartNumber: string; readonly quantity: number }> }
export interface OrderSubmitInput {
  readonly providerId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly currency: string;
  readonly lines: ReadonlyArray<{ readonly lineId: string; readonly providerPartNumber: string; readonly quantity: number; readonly unitPriceDecimal: string }>;
  readonly chargesDecimal: string;
  readonly totalDecimal: string;
  readonly maxTotalDecimal: string;
  readonly shippingDestinationRef: string;
  readonly releaseDigest: string;
}
/** The provider port, injected. Its answers are untrusted values the contract judges; a throw is an answer too. */
export interface OrderSubmissionPort {
  /** Re-read price and availability for exactly these lines (a read: nothing is ordered). */
  requote(input: OrderRequoteInput, signal: AbortSignal): Promise<unknown>;
  /** Submit once under `idempotencyKey`. The contract never calls it twice for one authorization. */
  submit(input: OrderSubmitInput, signal: AbortSignal): Promise<unknown>;
}

export interface OrderObservation { readonly eventId: string; readonly status: (typeof ORDER_WEBHOOK_STATUSES)[number]; readonly receivedAt: string }
export interface OrderRecord {
  readonly orderId: string;
  readonly authorizationId: string;
  readonly scope: PurchaseScope;
  readonly providerId: string;
  readonly operationId: string;
  readonly cartDigest: string;
  readonly idempotencyKey: string;
  readonly state: OrderState;
  readonly code: OrderCode | null;
  readonly submittedBy: string;
  readonly preparedAt: string;
  readonly submittedAt: string | null;
  readonly settledAt: string | null;
  readonly requote: { readonly currency: string; readonly chargesDecimal: string; readonly totalDecimal: string } | null;
  readonly providerOrderId: string | null;
  readonly failure: string | null;
  readonly observations: readonly OrderObservation[];
}
export interface OrderAnswer { readonly ok: boolean; readonly code: OrderCode; readonly message: string; readonly idempotent: boolean; readonly order: OrderRecord | null; readonly authorization?: string; readonly fields?: readonly string[] }
export type OrderWebhookAnswer =
  | { readonly ok: true; readonly code: "WEBHOOK_RECORDED"; readonly orderId: string }
  | { readonly ok: false; readonly code: "WEBHOOK_NOT_CONFIGURED" | "WEBHOOK_UNREADABLE" | "WEBHOOK_UNKNOWN_ORDER" }
  | { readonly ok: false; readonly code: "WEBHOOK_REFUSED"; readonly refusal: WebhookRefusal }
  | { readonly ok: false; readonly code: "WEBHOOK_OBSERVATIONS_FULL"; readonly orderId: string };

export interface OrderContractOptions {
  port: OrderSubmissionPort;
  authorizations: PurchaseAuthorizationStore;
  /** whether ordering is enabled; the production answer otherwise (disabled in B23) */
  enablement?: () => OrderingEnablement;
  now?: () => number;
  deadlines?: { readonly requoteMs?: number; readonly submitMs?: number };
  /** the provider whose events these are, its shared webhook secret and the replay store; without them every webhook is refused */
  webhook?: { readonly providerId: string; readonly secret: string; readonly replay: WebhookReplayStore; readonly toleranceMs?: number };
  limits?: Partial<Record<keyof typeof ORDER_LIMITS, number>>; // [B23-C fix] whole numbers (the frozen defaults' literal types admitted only themselves)
}

/** The one idempotency key the provider sees for an authorization: `so-` and 64 hex characters of a digest of the scope and the id. */
export function orderIdempotencyKeyOf(scope: PurchaseScope, authorizationId: string): string {
  return `so-${durableWorkflowDigest({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, authorizationId }).slice(4)}`;
}

const PROVIDER_ORDER_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const UNRESOLVED: ReadonlySet<OrderState> = new Set(["prepared", "submitted", "UNKNOWN_PENDING_RECONCILIATION"]);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isHumanAdmin = (actor: unknown): actor is PurchaseActor => isRecord(actor) && actor.actorKind === "human" && actor.role === "project_admin" && typeof actor.actorId === "string" && actor.actorId.length > 0;
const scopeKeyOf = (scope: PurchaseScope): string => `${scope.tenantId}\0${scope.projectId}\0${scope.branchId}`;
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
/** [B23-C fix] The server's own copy of a presented value, read once (null when it is not plain data, which consume then refuses). */
function plainCopy(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}
/** [B23-C fix] A judgement of an untrusted answer that throws while it is read is the fallback answer, never a throw (regressions-1). */
function judgedOr<T>(judge: () => T, fallback: T): T {
  try {
    return judge();
  } catch {
    return fallback;
  }
}

/** A port call bounded by a deadline: the value, or a timeout or a throw (the signal is aborted on the deadline). A late answer or a
 *  late throw after the deadline is dropped, never recorded and never left unhandled. */
async function withinDeadline(call: (signal: AbortSignal) => Promise<unknown>, ms: number): Promise<{ readonly answered: true; readonly value: unknown } | { readonly answered: false; readonly failure: "timeout" | "threw" }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); });
  try {
    let pending: Promise<{ readonly value: unknown } | "threw">;
    try {
      pending = call(controller.signal).then((value) => ({ value }), () => "threw" as const);
    } catch {
      pending = Promise.resolve("threw" as const);
    }
    const raced = await Promise.race([pending, deadline]);
    if (raced === "timeout") {
      controller.abort();
      return { answered: false, failure: "timeout" };
    }
    return raced === "threw" ? { answered: false, failure: "threw" } : { answered: true, value: raced.value };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** What the re-read answers, judged against the confirmed binding: the totals, or the refusal code. */
function judgeRequote(binding: PurchaseBinding, answer: unknown): { readonly ok: true; readonly chargesDecimal: string; readonly totalDecimal: string } | { readonly ok: false; readonly code: OrderCode; readonly failure: string } {
  const mismatch = (failure: string) => ({ ok: false as const, code: "ORDER_REQUOTE_MISMATCH" as const, failure });
  if (!isRecord(answer) || !Array.isArray(answer.lines)) return mismatch("unreadable");
  if (answer.currency !== binding.currency) return mismatch("currency");
  if (answer.lines.length !== binding.lines.length) return mismatch("lines");
  const charges = canonicalMoney(answer.chargesDecimal), total = canonicalMoney(answer.totalDecimal);
  if (charges === null || total === null) return mismatch("unreadable");
  const quoted: Array<{ unitPriceDecimal: string; availableQuantity: unknown }> = [];
  for (const [index, line] of binding.lines.entries()) {
    const read = answer.lines[index];
    if (!isRecord(read) || read.lineId !== line.lineId || read.providerPartNumber !== line.providerPartNumber) return mismatch("lines");
    const price = canonicalMoney(read.unitPriceDecimal);
    if (price === null) return mismatch("unreadable");
    quoted.push({ unitPriceDecimal: price, availableQuantity: read.availableQuantity });
  }
  // the sum must add up exactly before any of its parts is believed
  const computed = addMoney(linesTotal(quoted.map((entry, index) => ({ quantity: binding.lines[index]!.quantity, unitPriceDecimal: entry.unitPriceDecimal }))), charges);
  if (compareMoney(computed, total) !== 0) return mismatch("total");
  for (const [index, line] of binding.lines.entries()) {
    if (compareMoney(quoted[index]!.unitPriceDecimal, line.unitPriceDecimal) !== 0) return { ok: false, code: "ORDER_PRICE_CHANGED", failure: `price:${line.lineId}` };
  }
  for (const [index, line] of binding.lines.entries()) {
    const available = quoted[index]!.availableQuantity;
    if (typeof available !== "number" || !Number.isSafeInteger(available) || available < line.quantity) return { ok: false, code: "ORDER_AVAILABILITY_SHORT", failure: `availability:${line.lineId}` };
  }
  if (compareMoney(total, binding.priceCeilingDecimal) > 0) return { ok: false, code: "ORDER_ABOVE_CEILING", failure: "ceiling" };
  return { ok: true, chargesDecimal: charges, totalDecimal: total };
}

/** The submission's answer: accepted with a usable order id, a definite refusal, or UNKNOWN for everything else. */
function judgeSubmission(answer: unknown): { readonly state: "accepted"; readonly providerOrderId: string } | { readonly state: "rejected" } | { readonly state: "UNKNOWN_PENDING_RECONCILIATION"; readonly failure: string } {
  if (!isRecord(answer)) return { state: "UNKNOWN_PENDING_RECONCILIATION", failure: "unreadable" };
  if (answer.outcome === "accepted" && typeof answer.providerOrderId === "string" && PROVIDER_ORDER_ID.test(answer.providerOrderId)) return { state: "accepted", providerOrderId: answer.providerOrderId };
  if (answer.outcome === "rejected") return { state: "rejected" };
  return { state: "UNKNOWN_PENDING_RECONCILIATION", failure: answer.outcome === "accepted" ? "no_usable_order_id" : "ambiguous_outcome" };
}

interface HeldOrder { record: OrderRecord; readonly scopeKey: string }

/** The order contract: a module of its own state, a port and an authorization store given by whoever composes it (only tests in B23). */
export class OrderContract {
  private readonly records = new Map<string, HeldOrder>();
  /** [B23-C fix] carts claimed by a submit between its in-flight check and its record (project and cart -> the authorization's key; [B23-C lead, 2026-10-04] and how many of its submits hold it) */
  private readonly claims = new Map<string, { readonly key: string; holders: number }>();
  private readonly port: OrderSubmissionPort;
  private readonly authorizations: PurchaseAuthorizationStore;
  private readonly enablement: () => OrderingEnablement;
  private readonly now: () => number;
  private readonly deadlines: { readonly requoteMs: number; readonly submitMs: number };
  private readonly webhook: OrderContractOptions["webhook"];
  private readonly limits: Readonly<Record<keyof typeof ORDER_LIMITS, number>>;

  constructor(options: OrderContractOptions) {
    this.port = options.port;
    this.authorizations = options.authorizations;
    this.enablement = options.enablement ?? (() => orderingEnablementFromProcess());
    this.now = options.now ?? (() => Date.now());
    this.deadlines = { ...ORDER_DEADLINES_MS, ...(options.deadlines ?? {}) };
    this.webhook = options.webhook;
    this.limits = Object.freeze({ ...ORDER_LIMITS, ...(options.limits ?? {}) });
  }

  /** Submit the order an authorization confirmed, exactly once. */
  async submit(input: { readonly actor: unknown; readonly scope: PurchaseScope; readonly authorizationId: string; readonly authorizationDigest: string; readonly binding: PurchaseBinding }): Promise<OrderAnswer> {
    if (!this.enablement().enabled) return this.answer("ORDER_DISABLED", null, false);
    if (!isHumanAdmin(input.actor)) return this.answer("ORDER_HUMAN_ADMIN_REQUIRED", null, false);
    const actor = input.actor;
    const scope: PurchaseScope = { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId };
    const key = `${scopeKeyOf(scope)}\0${input.authorizationId}`;
    const replay = this.replay(key);
    if (replay) return replay;
    // [B23-C fix] the presented binding is read once, into the server's own copy: the cart claimed below is the cart consume compares
    const presented = plainCopy(input.binding);
    const cartDigest = cartDigestOf(presented);
    const claim = cartDigest === null ? null : `${scopeKeyOf(scope)}\0${cartDigest}`;
    // [B23-C fix] the cart is claimed BEFORE the burn (coverage-1, tests-1): another authorization for a cart that is unresolved, or that a racing submit has claimed, is refused here, still unspent; a racing submit of the SAME authorization goes on and answers its record
    if (cartDigest !== null && this.unresolvedCart(scope, cartDigest, presented)) return this.answer("ORDER_IN_FLIGHT", null, false);
    if (cartDigest !== null && this.claims.has(claim!) && this.claims.get(claim!)!.key !== key) return this.answer("ORDER_CART_BUSY", null, false); // [B23-C lead, 2026-10-04] claimed, not yet an order: its own code (case 15; it answered ORDER_IN_FLIGHT)
    if (!this.hasRoom(scopeKeyOf(scope))) return this.answer("ORDER_LIMIT_REACHED", null, false);
    const claimed = claim !== null; // [B23-C lead, 2026-10-04] every submit of the claiming authorization holds the claim until its consume ends, so a twin that fails first frees nothing (case 16)
    if (claimed) { const holding = this.claims.get(claim!); if (holding) holding.holders += 1; else this.claims.set(claim!, { key, holders: 1 }); }
    let consumed: Awaited<ReturnType<PurchaseAuthorizationStore["consume"]>>;
    try {
      consumed = await this.authorizations.consume({ actor, scope, authorizationId: input.authorizationId, authorizationDigest: input.authorizationDigest, binding: presented });
    } finally {
      // released in the same turn that records the order below: the cart is never unclaimed and unrecorded in between
      if (claimed) { const holding = this.claims.get(claim!)!; holding.holders -= 1; if (holding.holders === 0) this.claims.delete(claim!); }
    }
    if (!consumed.ok) return this.replay(key) ?? { ...this.answer("ORDER_AUTHORIZATION_REFUSED", null, false), authorization: consumed.code, ...(consumed.fields ? { fields: consumed.fields } : {}) };
    const binding = consumed.authorization.binding;
    const cart = cartDigestOf(binding)!;
    const prepared = this.now();
    const record: OrderRecord = { orderId: `order:${input.authorizationId}`, authorizationId: input.authorizationId, scope, providerId: binding.providerId, operationId: binding.operationId, cartDigest: cart, idempotencyKey: orderIdempotencyKeyOf(scope, input.authorizationId), state: "prepared", code: null, submittedBy: actor.actorId, preparedAt: new Date(prepared).toISOString(), submittedAt: null, settledAt: null, requote: null, providerOrderId: null, failure: null, observations: [] };
    // recorded before any await, so a racing submit of another authorization for this cart now finds it unresolved. [B23-C fix] With
    // the claim above this guard is unreachable for the real store [B23-C lead, 2026-10-04, corrected: it said "the consumed binding is the presented one", but consume answers the held binding, equal to the presented one only as `durableWorkflowJson` compares them (NFC), and an unclaimed twin submit could burn after its claimant failed; it is unreachable since the cart is read from that canonical binding (case 14) and every submit of the claiming authorization holds the claim (case 16)]; it keeps a consume that
    // answers another cart's binding from the port (case 9)
    if (this.unresolvedCart(scope, cart, binding)) {
      this.records.set(key, { record: deepFreeze({ ...record, state: "not_submitted", code: "ORDER_IN_FLIGHT", settledAt: record.preparedAt, failure: "in_flight" }), scopeKey: scopeKeyOf(scope) });
      return this.answer("ORDER_IN_FLIGHT", this.records.get(key)!.record, false);
    }
    const held: HeldOrder = { record: deepFreeze(record), scopeKey: scopeKeyOf(scope) };
    this.records.set(key, held);
    // the re-read, immediately before the submission (a read; nothing is ordered)
    const lines = binding.lines.map((line) => ({ lineId: line.lineId, providerPartNumber: line.providerPartNumber, quantity: line.quantity }));
    const reread = await withinDeadline((signal) => this.port.requote({ providerId: binding.providerId, operationId: binding.operationId, currency: binding.currency, lines }, signal), this.deadlines.requoteMs);
    const unreadable: ReturnType<typeof judgeRequote> = { ok: false, code: "ORDER_REQUOTE_MISMATCH", failure: "unreadable" };
    const judged = reread.answered ? judgedOr(() => judgeRequote(binding, reread.value), unreadable) : { ok: false as const, code: "ORDER_REQUOTE_FAILED" as const, failure: reread.failure };
    if (!judged.ok) return this.settle(held, { state: "not_submitted", code: judged.code, failure: judged.failure });
    // [B23-C fix] enablement is checked again immediately before the hand-over (security-1): turned off during the re-read, nothing is sent
    if (!this.enablement().enabled) return this.settle(held, { state: "not_submitted", code: "ORDER_DISABLED_BEFORE_SUBMISSION", failure: "disabled" });
    const requote = { currency: binding.currency, chargesDecimal: judged.chargesDecimal, totalDecimal: judged.totalDecimal };
    // `submitted` is recorded immediately before the hand-over: from here on an unclear end is UNKNOWN, never a resend
    held.record = deepFreeze({ ...held.record, state: "submitted", submittedAt: new Date(this.now()).toISOString(), requote });
    const submission: OrderSubmitInput = { providerId: binding.providerId, operationId: binding.operationId, idempotencyKey: held.record.idempotencyKey, currency: binding.currency, lines: binding.lines.map((line) => ({ ...line })), chargesDecimal: judged.chargesDecimal, totalDecimal: judged.totalDecimal, maxTotalDecimal: binding.priceCeilingDecimal, shippingDestinationRef: binding.shippingDestinationRef, releaseDigest: binding.releaseDigest };
    const sent = await withinDeadline((signal) => this.port.submit(submission, signal), this.deadlines.submitMs);
    const unclear: ReturnType<typeof judgeSubmission> = { state: "UNKNOWN_PENDING_RECONCILIATION", failure: "unreadable" };
    const outcome = sent.answered ? judgedOr(() => judgeSubmission(sent.value), unclear) : { state: "UNKNOWN_PENDING_RECONCILIATION" as const, failure: sent.failure };
    if (outcome.state === "accepted") return this.settle(held, { state: "accepted", code: "ORDER_ACCEPTED", providerOrderId: outcome.providerOrderId });
    if (outcome.state === "rejected") return this.settle(held, { state: "rejected", code: "ORDER_REJECTED", failure: "rejected" });
    return this.settle(held, { state: "UNKNOWN_PENDING_RECONCILIATION", code: "ORDER_UNKNOWN_PENDING_RECONCILIATION", failure: outcome.failure });
  }

  /** A provider's webhook: verified, then recorded as an observation on the order it names. Never creates, submits or changes one. */
  receiveWebhook(input: { readonly rawBody: Uint8Array; readonly headers: WebhookHeaders }): OrderWebhookAnswer {
    if (!this.webhook) return { ok: false, code: "WEBHOOK_NOT_CONFIGURED" };
    const verified = verifyWebhook({ rawBody: input.rawBody, headers: input.headers, secret: this.webhook.secret, now: this.now(), replay: this.webhook.replay, toleranceMs: this.webhook.toleranceMs });
    if (!verified.ok) return { ok: false, code: "WEBHOOK_REFUSED", refusal: verified.refusal };
    let event: unknown;
    try {
      event = JSON.parse(Buffer.from(input.rawBody).toString("utf8"));
    } catch {
      return { ok: false, code: "WEBHOOK_UNREADABLE" };
    }
    if (!isRecord(event) || Object.keys(event).length !== 3 || event.type !== "order.status" || typeof event.providerOrderId !== "string" || !PROVIDER_ORDER_ID.test(event.providerOrderId) || !(ORDER_WEBHOOK_STATUSES as readonly unknown[]).includes(event.status)) return { ok: false, code: "WEBHOOK_UNREADABLE" };
    const providerOrderId = event.providerOrderId, status = event.status as OrderObservation["status"];
    const providerId = this.webhook.providerId; // an event names an order of the provider whose secret signed it, never another's
    const held = [...this.records.values()].find((entry) => entry.record.providerId === providerId && entry.record.providerOrderId === providerOrderId);
    if (!held) return { ok: false, code: "WEBHOOK_UNKNOWN_ORDER" };
    // [B23-C fix] a full order refuses the event in so many words (coverage-2: it answered WEBHOOK_RECORDED and recorded nothing)
    if (held.record.observations.length >= this.limits.observationsPerOrder) return { ok: false, code: "WEBHOOK_OBSERVATIONS_FULL", orderId: held.record.orderId };
    const observation: OrderObservation = { eventId: verified.id, status, receivedAt: new Date(this.now()).toISOString() };
    held.record = deepFreeze({ ...held.record, observations: [...held.record.observations, observation] });
    return { ok: true, code: "WEBHOOK_RECORDED", orderId: held.record.orderId };
  }

  /** The order an authorization made in a project (a read), or null. */
  order(scope: PurchaseScope, authorizationId: string): OrderRecord | null {
    return this.records.get(`${scopeKeyOf(scope)}\0${authorizationId}`)?.record ?? null;
  }
  /** Every order of a project (a read). */
  orders(scope: PurchaseScope): OrderRecord[] {
    const scopeKey = scopeKeyOf(scope);
    return [...this.records.values()].filter((entry) => entry.scopeKey === scopeKey).map((entry) => entry.record);
  }

  private answer(code: OrderCode, order: OrderRecord | null, idempotent: boolean): OrderAnswer {
    return { ok: code === "ORDER_ACCEPTED", code, message: ORDER_CONTRACT_CODES[code], idempotent, order };
  }
  /** A submit of an authorization that already has a record answers that record and sends nothing. */
  private replay(key: string): OrderAnswer | null {
    const held = this.records.get(key);
    if (!held) return null;
    return this.answer(held.record.code ?? "ORDER_IN_FLIGHT", held.record, true);
  }
  private unresolvedCart(scope: PurchaseScope, cartDigest: string, binding: unknown): boolean {
    const scopeKey = scopeKeyOf(scope);
    const providerId = isRecord(binding) && typeof binding.providerId === "string" ? binding.providerId.normalize("NFC") : undefined; // [B23-C lead, 2026-10-04] as consume compares it (case 14)
    return [...this.records.values()].some((entry) => entry.scopeKey === scopeKey && entry.record.cartDigest === cartDigest && entry.record.providerId.normalize("NFC") === providerId && UNRESOLVED.has(entry.record.state));
  }
  private hasRoom(scopeKey: string): boolean {
    let held = 0;
    for (const entry of this.records.values()) if (entry.scopeKey === scopeKey) held += 1;
    return held < this.limits.ordersPerScope && this.records.size < this.limits.orders;
  }
  private settle(held: HeldOrder, end: { readonly state: Exclude<OrderState, "prepared" | "submitted">; readonly code: OrderCode; readonly failure?: string; readonly providerOrderId?: string }): OrderAnswer {
    held.record = deepFreeze({ ...held.record, state: end.state, code: end.code, settledAt: new Date(this.now()).toISOString(), failure: end.failure ?? null, providerOrderId: end.providerOrderId ?? null });
    return this.answer(end.code, held.record, false);
  }
}
