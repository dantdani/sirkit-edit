/**
 * [B23-C] The purchase-authorization contract, written and tested offline only (runbook B23-C :996: "When enabled, require a second
 * explicit confirmation bound to exact provider, cart/order lines, quantities, currency, total price ceiling, shipping destination
 * reference, release/BOM digest and expiry. ... The AI cannot mint or consume the final purchase authorization."; D23-11; OD-172).
 *
 *  - A human project administrator REQUESTS: a closed binding (a registry provider's ordering operation, 1-64 lines with whole
 *    quantities and the unit price the person saw, a currency, a DECIMAL price ceiling, a shipping destination reference, the
 *    release/BOM digest and an expiry at most 10 minutes ahead). Money is exact decimal text, as CD-12's `unitPriceDecimal`
 *    (`release-engineering/types.ts:37-38`), never a JavaScript number.
 *  - A DIFFERENT human project administrator CONFIRMS the exact request digest (CD-12's `proposerCannotApprove`, types.ts:60): this
 *    human-only confirmation is the one place an authorization is minted. It is single-use and held here, in server memory; the
 *    caller gets its id, digest and expiry only (B22-B's sealed request, B23-B1's sealed plan: the shape, not the store).
 *  - CONSUME burns it with one compare-and-set on its revision, and only when the presented binding equals the held one field for
 *    field; any changed field burns it unused (`void`), an expired one is burned `expired`, a forged id or digest writes nothing.
 *  - The model, automation, the migration actor and every other role are refused at every step, before anything is read.
 *  - While ordering is turned off (`orderingEnablement()`, OD-171) nothing is requested, confirmed or consumed. In B23 it is off.
 *
 * Only two server modules may import this one, the exact approved-importer set of b23-c-purchase-authorization case 7: this module
 * (the confirmation) and order-contract.ts (the consumer, which never requests or confirms). No route, tool, agent, chat, MCP or
 * orchestration module reaches it (D21-33's gap, closed for it). Nothing here is persisted: a restart forgets every request and
 * authorization, which then simply cannot be consumed.
 */
import { randomBytes } from "node:crypto";
import { durableWorkflowDigest, durableWorkflowJson } from "../durable-workflow/stable";
import { orderingEnablementFromProcess, type OrderingEnablement } from "./ordering-enablement";
import { PROVIDER_ROWS, type ProviderRow } from "./provider-registry";

export const PURCHASE_REQUEST_SCHEMA = "sirkit.purchase-request.v1" as const;
export const PURCHASE_AUTHORIZATION_SCHEMA = "sirkit.purchase-authorization.v1" as const;
/** An authorization expires at most this long after it is requested (OD-172). */
export const PURCHASE_AUTHORIZATION_MAX_TTL_MS = 10 * 60_000;
/** The binding's closed fields, in the runbook's order (:996). */
export const PURCHASE_BINDING_FIELDS = Object.freeze(["providerId", "operationId", "lines", "currency", "priceCeilingDecimal", "shippingDestinationRef", "releaseDigest", "expiresAt"] as const);
export const PURCHASE_LINE_FIELDS = Object.freeze(["lineId", "providerPartNumber", "quantity", "unitPriceDecimal"] as const);
/** Bounds: lines per binding, a line's quantity, and the stores per project and overall (a bound refuses; nothing live is evicted). */
export const PURCHASE_LIMITS = Object.freeze({ maxLines: 64, maxLineQuantity: 1_000_000, requestsPerScope: 32, requests: 2048, authorizationsPerScope: 64, authorizations: 4096 });
/** How long a settled or expired entry is kept after its expiry, so a repeat is answered for what it was. */
export const PURCHASE_RETENTION_MS = 60 * 60_000;

export interface PurchaseScope { readonly tenantId: string; readonly projectId: string; readonly branchId: string }
/** The SERVER-derived actor (never a body claim). */
export interface PurchaseActor { readonly actorId: string; readonly actorKind: string; readonly role: string }
export interface PurchaseLine { readonly lineId: string; readonly providerPartNumber: string; readonly quantity: number; readonly unitPriceDecimal: string }
export interface PurchaseBinding {
  readonly providerId: string;
  readonly operationId: string;
  readonly lines: readonly PurchaseLine[];
  readonly currency: string;
  readonly priceCeilingDecimal: string;
  readonly shippingDestinationRef: string;
  readonly releaseDigest: string;
  readonly expiresAt: string;
}
export interface PurchaseRequest { readonly schema: typeof PURCHASE_REQUEST_SCHEMA; readonly requestId: string; readonly scope: PurchaseScope; readonly binding: PurchaseBinding; readonly requestedBy: string; readonly requestedAt: string; readonly requestDigest: string }
/** What the confirming person is given: a handle. The binding stays on the server. */
export interface PurchaseAuthorizationHandle { readonly authorizationId: string; readonly authorizationDigest: string; readonly expiresAt: string }
export interface ConsumedPurchaseAuthorization { readonly authorizationId: string; readonly scope: PurchaseScope; readonly binding: PurchaseBinding; readonly requestedBy: string; readonly approvedBy: string; readonly issuedAt: string; readonly expiresAt: string; readonly consumedAt: string; readonly consumedBy: string }
export type PurchaseAuthorizationState = "issued" | "consumed" | "void" | "expired";

export const PURCHASE_AUTHORIZATION_ERRORS = Object.freeze({
  PA_HUMAN_ADMIN_REQUIRED: "A purchase authorization is requested, confirmed and used only by human project administrators. Nothing was changed.",
  PA_ORDERING_DISABLED: "Ordering through Sirkit is turned off (OD-171): nothing can be requested, confirmed or used. Nothing was changed.",
  PA_BINDING_INVALID: "The binding is not a valid closed binding (provider ordering operation, lines, exact decimals, currency, ceiling, destination reference, release digest, expiry). Nothing was changed.",
  PA_REQUEST_NOT_FOUND: "No such request exists for this project.",
  PA_REQUEST_DIGEST_MISMATCH: "requestDigest is not this request's digest. Nothing was changed.",
  PA_REQUEST_EXPIRED: "The request expired. Request again.",
  PA_REQUEST_ALREADY_CONFIRMED: "The request was already confirmed once.",
  PA_PROPOSER_CANNOT_APPROVE: "The person who requested a purchase cannot confirm it; another project administrator must. Nothing was changed.",
  PA_NOT_FOUND: "No such authorization exists for this project. Nothing was changed.",
  PA_EXPIRED: "The authorization expired and is spent. Request and confirm again.",
  PA_ALREADY_USED: "The authorization was already used, voided or expired. Request and confirm again.",
  PA_BINDING_CHANGED: "The binding presented differs from the confirmed one; the authorization is spent unused. Request and confirm again.",
  PA_LIMIT_REACHED: "This project, or the server, holds as many open purchase requests or authorizations as it may. Nothing was changed.",
} satisfies Record<string, string>);
export type PurchaseAuthorizationErrorCode = keyof typeof PURCHASE_AUTHORIZATION_ERRORS;
export interface PurchaseRefusal { readonly ok: false; readonly code: PurchaseAuthorizationErrorCode; readonly message: string; readonly problems?: readonly string[]; readonly fields?: readonly string[] }

// ─── exact money ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Decimal text: up to 12 integer digits (no leading zero) and up to 6 fraction digits - what a binding or a re-read may carry. */
const MONEY_TEXT = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,6}))?$/;
const MONEY_SCALE = 6;
/** [B23-C fix] What the arithmetic reads: the same spelling with any number of integer digits, so a product or sum past 12 digits stays
 *  exact and is judged, never thrown (regressions-1); only `canonicalMoney` bounds what comes in. */
const AMOUNT_TEXT = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/;
function scaledOf(text: string, pattern: RegExp = MONEY_TEXT): bigint | null {
  const match = pattern.exec(text);
  return match ? BigInt(`${match[1]}${(match[2] ?? "").padEnd(MONEY_SCALE, "0")}`) : null;
}
function renderScaled(value: bigint): string {
  const digits = value.toString().padStart(MONEY_SCALE + 1, "0");
  const whole = digits.slice(0, -MONEY_SCALE), fraction = digits.slice(-MONEY_SCALE).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}
/** Throws only on text that is no decimal at all (never on a result of this module's own arithmetic). */
function scaled(text: string): bigint {
  const value = scaledOf(text, AMOUNT_TEXT);
  if (value === null) throw new Error("PA_MONEY_DECIMAL_INVALID");
  return value;
}
/** The canonical spelling of a decimal text (no trailing fraction zero), or null when it is not decimal text (a number is not). */
export function canonicalMoney(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = scaledOf(value);
  return parsed === null ? null : renderScaled(parsed);
}
export const isCanonicalMoney = (value: unknown): value is string => typeof value === "string" && canonicalMoney(value) === value;
export const addMoney = (a: string, b: string): string => renderScaled(scaled(a) + scaled(b));
export function multiplyMoney(value: string, quantity: number): string {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error("PA_QUANTITY_INVALID");
  return renderScaled(scaled(value) * BigInt(quantity));
}
export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const left = scaled(a), right = scaled(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
/** The sum of quantity x unit price over the lines, exact. */
export const linesTotal = (lines: readonly Pick<PurchaseLine, "quantity" | "unitPriceDecimal">[]): string => lines.reduce((total, line) => addMoney(total, multiplyMoney(line.unitPriceDecimal, line.quantity)), "0");

// ─── the binding ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LINE_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const PART_NUMBER = /^[A-Za-z0-9._:/#+-]{1,64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const REFERENCE = /^[A-Za-z0-9._:-]{1,128}$/;
const DIGEST_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SCOPE_TEXT = /^[A-Za-z0-9._:@/-]{1,200}$/;
const ACTOR_ID = /^[A-Za-z0-9._:@/-]{1,200}$/;
const HANDLE_TEXT = /^[A-Za-z0-9._:-]{1,200}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const closedKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => present.includes(key));
};
const canonicalInstant = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
};

/** Why `value` is not a valid binding at `now` (empty: it is). Each problem names its field. Never throws: [B23-C fix] a total past 12
 *  integer digits is compared exactly (regressions-1), and a binding that throws when read is `binding: unreadable`. */
export function purchaseBindingProblems(value: unknown, now: number, registry: readonly ProviderRow[] = PROVIDER_ROWS): string[] {
  try {
    return bindingProblems(value, now, registry);
  } catch {
    return ["binding: unreadable"];
  }
}
function bindingProblems(value: unknown, now: number, registry: readonly ProviderRow[]): string[] {
  if (!isRecord(value)) return ["binding: not an object"];
  const problems: string[] = [];
  if (!closedKeys(value, PURCHASE_BINDING_FIELDS)) problems.push(`binding: the keys are not exactly ${PURCHASE_BINDING_FIELDS.join(", ")}`);
  const row = registry.find((candidate) => candidate.id === value.providerId);
  if (!row) problems.push("providerId: not a registered provider");
  else if (!row.operations.some((operation) => operation.id === value.operationId && operation.tier === "ordering")) problems.push("operationId: not an ordering operation of the provider");
  const lines = value.lines;
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > PURCHASE_LIMITS.maxLines) problems.push(`lines: 1 to ${PURCHASE_LIMITS.maxLines} lines`);
  else {
    const ids = new Set<string>();
    lines.forEach((line: unknown, index) => {
      if (!isRecord(line) || !closedKeys(line, PURCHASE_LINE_FIELDS)) { problems.push(`lines[${index}]: the keys are not exactly ${PURCHASE_LINE_FIELDS.join(", ")}`); return; }
      if (typeof line.lineId !== "string" || !LINE_ID.test(line.lineId) || ids.has(line.lineId)) problems.push(`lines[${index}].lineId: not a unique line id`);
      else ids.add(line.lineId);
      if (typeof line.providerPartNumber !== "string" || !PART_NUMBER.test(line.providerPartNumber)) problems.push(`lines[${index}].providerPartNumber: not a part number`);
      if (typeof line.quantity !== "number" || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > PURCHASE_LIMITS.maxLineQuantity) problems.push(`lines[${index}].quantity: a whole number from 1 to ${PURCHASE_LIMITS.maxLineQuantity}`);
      if (!isCanonicalMoney(line.unitPriceDecimal)) problems.push(`lines[${index}].unitPriceDecimal: not canonical decimal text`);
    });
  }
  if (typeof value.currency !== "string" || !CURRENCY.test(value.currency)) problems.push("currency: not a three-letter ISO 4217 code");
  if (!isCanonicalMoney(value.priceCeilingDecimal)) problems.push("priceCeilingDecimal: not canonical decimal text");
  else if (problems.length === 0 && compareMoney(linesTotal(lines as PurchaseLine[]), value.priceCeilingDecimal) > 0) problems.push("priceCeilingDecimal: below the lines' total");
  if (typeof value.shippingDestinationRef !== "string" || !REFERENCE.test(value.shippingDestinationRef)) problems.push("shippingDestinationRef: not a reference (an address never goes here)");
  if (typeof value.releaseDigest !== "string" || !DIGEST_REFERENCE.test(value.releaseDigest)) problems.push("releaseDigest: not a release or BOM digest");
  const expiresAt = canonicalInstant(value.expiresAt);
  if (expiresAt === null) problems.push("expiresAt: not a canonical ISO instant");
  else if (expiresAt <= now || expiresAt - now > PURCHASE_AUTHORIZATION_MAX_TTL_MS) problems.push("expiresAt: not within the next 10 minutes");
  return problems;
}

/** The fields in which `presented` differs from the confirmed binding (`extra` for any key outside the closed set). */
function bindingDifferences(held: PurchaseBinding, presented: unknown): string[] {
  if (!isRecord(presented)) return [...PURCHASE_BINDING_FIELDS];
  const same = (a: unknown, b: unknown): boolean => {
    try {
      return b !== undefined && durableWorkflowJson(a) === durableWorkflowJson(b);
    } catch {
      return false;
    }
  };
  const fields: string[] = PURCHASE_BINDING_FIELDS.filter((field) => !same(held[field], presented[field]));
  if (Object.keys(presented).some((key) => !(PURCHASE_BINDING_FIELDS as readonly string[]).includes(key))) fields.push("extra");
  return fields;
}

/**
 * The cart's identity: what is ordered - the provider operation and each part's total quantity, sorted by part - without prices or
 * expiry. [B23-C fix] Line ids and line order are labels and no longer count (security-2: relabelled or reordered lines made a second
 * cart, so a new authorization for the same goods passed the in-flight guard). Null when unreadable. [B23-C lead, 2026-10-04] Read from the canonical binding consume compares (`durableWorkflowJson`, NFC): a part spelled with U+212A for K was grouped and sorted apart.
 */
export function cartDigestOf(binding: unknown): string | null {
  try {
    const read: unknown = JSON.parse(durableWorkflowJson(binding)); if (!isRecord(read) || !Array.isArray(read.lines)) return null;
    const quantities = new Map<string, number>();
    for (const line of read.lines as unknown[]) {
      if (!isRecord(line) || typeof line.providerPartNumber !== "string" || typeof line.quantity !== "number" || !Number.isSafeInteger(line.quantity)) return null;
      quantities.set(line.providerPartNumber, (quantities.get(line.providerPartNumber) ?? 0) + line.quantity);
    }
    const parts = [...quantities].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([providerPartNumber, quantity]) => ({ providerPartNumber, quantity }));
    return durableWorkflowDigest({ providerId: read.providerId, operationId: read.operationId, parts });
  } catch {
    return null;
  }
}

// ─── the store ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const isHumanAdmin = (actor: unknown): actor is PurchaseActor => isRecord(actor) && actor.actorKind === "human" && actor.role === "project_admin" && typeof actor.actorId === "string" && ACTOR_ID.test(actor.actorId);
/** The project scope read once into its own strings, or null. */
const scopeOf = (scope: unknown): PurchaseScope | null => {
  if (!isRecord(scope)) return null;
  const { tenantId, projectId, branchId } = scope;
  return typeof tenantId === "string" && typeof projectId === "string" && typeof branchId === "string" && [tenantId, projectId, branchId].every((part) => SCOPE_TEXT.test(part)) ? { tenantId, projectId, branchId } : null;
};
const keyOfScope = (scope: PurchaseScope): string => `${scope.tenantId}\0${scope.projectId}\0${scope.branchId}`;
const scopeKeyOf = (scope: unknown): string | null => {
  const read = scopeOf(scope);
  return read === null ? null : keyOfScope(read);
};
const refused = (code: PurchaseAuthorizationErrorCode, extra: { problems?: readonly string[]; fields?: readonly string[] } = {}): PurchaseRefusal => ({ ok: false, code, message: PURCHASE_AUTHORIZATION_ERRORS[code], ...extra });
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

interface HeldRequest { readonly request: PurchaseRequest; readonly scopeKey: string; readonly expiresAt: number; revision: number; confirmed: boolean }
interface AuthorizationRecord { readonly schema: typeof PURCHASE_AUTHORIZATION_SCHEMA; readonly authorizationId: string; readonly scope: PurchaseScope; readonly binding: PurchaseBinding; readonly requestId: string; readonly requestedBy: string; readonly approvedBy: string; readonly issuedAt: string; readonly expiresAt: string; readonly authorizationDigest: string }
interface HeldAuthorization { readonly record: AuthorizationRecord; readonly scopeKey: string; readonly expiresAt: number; revision: number; state: PurchaseAuthorizationState; consumedAt: string | null; consumedBy: string | null }

export interface PurchaseAuthorizationStoreOptions {
  now?: () => number;
  /** 32 hex characters from the server (B22-B's sealed-request nonce) */
  nonce?: () => string;
  /** whether ordering is enabled; the production answer otherwise (disabled in B23) */
  enablement?: () => OrderingEnablement;
  registry?: readonly ProviderRow[];
  limits?: Partial<Record<keyof typeof PURCHASE_LIMITS, number>>; // [B23-C fix] whole numbers (the frozen defaults' literal types admitted only themselves)
}

/** The server-held requests and authorizations. Every read and write goes through `load` and a compare-and-set on a revision. */
export class PurchaseAuthorizationStore {
  private readonly requests = new Map<string, HeldRequest>();
  private readonly authorizations = new Map<string, HeldAuthorization>();
  private readonly now: () => number;
  private readonly nonce: () => string;
  private readonly enablement: () => OrderingEnablement;
  private readonly registry: readonly ProviderRow[];
  private readonly limits: Readonly<Record<keyof typeof PURCHASE_LIMITS, number>>;

  constructor(options: PurchaseAuthorizationStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.nonce = options.nonce ?? (() => randomBytes(16).toString("hex"));
    this.enablement = options.enablement ?? (() => orderingEnablementFromProcess());
    this.registry = options.registry ?? PROVIDER_ROWS;
    this.limits = Object.freeze({ ...PURCHASE_LIMITS, ...(options.limits ?? {}) });
  }

  /** A human project administrator asks for a purchase of exactly `binding`. Mints nothing. */
  async request(input: { readonly actor: unknown; readonly scope: unknown; readonly binding: unknown }): Promise<{ readonly ok: true; readonly request: PurchaseRequest } | PurchaseRefusal> {
    if (!isHumanAdmin(input.actor)) return refused("PA_HUMAN_ADMIN_REQUIRED");
    if (!this.enablement().enabled) return refused("PA_ORDERING_DISABLED");
    const requester = input.actor;
    const scope = scopeOf(input.scope);
    const now = this.now();
    // the server's own copy is taken first and is what is validated and held: an accessor cannot show validation one value and
    // the store another
    let binding: unknown;
    try {
      binding = structuredClone(input.binding);
    } catch {
      return refused("PA_BINDING_INVALID", { problems: ["binding: not plain data"] });
    }
    const problems = scope === null ? ["scope: not a project scope"] : purchaseBindingProblems(binding, now, this.registry);
    if (scope === null || problems.length > 0) return refused("PA_BINDING_INVALID", { problems });
    const scopeKey = keyOfScope(scope);
    this.sweep(now);
    if (!this.hasRoom(this.requests, scopeKey, this.limits.requestsPerScope, this.limits.requests)) return refused("PA_LIMIT_REACHED");
    const held = binding as PurchaseBinding;
    const nonce = this.nonce();
    if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error("PA_NONCE_INVALID");
    const requestedAt = new Date(now).toISOString();
    const body = { schema: PURCHASE_REQUEST_SCHEMA, requestId: `purchase-request:${durableWorkflowDigest({ nonce, scope, requestedAt }).slice(4, 36)}`, scope, binding: held, requestedBy: requester.actorId, requestedAt };
    const request: PurchaseRequest = deepFreeze({ ...body, requestDigest: durableWorkflowDigest(body) });
    this.requests.set(request.requestId, { request, scopeKey, expiresAt: Date.parse(held.expiresAt), revision: 0, confirmed: false });
    return { ok: true, request };
  }

  /**
   * The human-only confirmation: a project administrator who did not request it confirms the exact request digest, which mints the one
   * authorization (single use, server-held) and answers its handle. A request is confirmed at most once.
   */
  async confirm(input: { readonly actor: unknown; readonly scope: unknown; readonly requestId: unknown; readonly requestDigest: unknown }): Promise<{ readonly ok: true; readonly authorization: PurchaseAuthorizationHandle } | PurchaseRefusal> {
    if (!isHumanAdmin(input.actor)) return refused("PA_HUMAN_ADMIN_REQUIRED");
    if (!this.enablement().enabled) return refused("PA_ORDERING_DISABLED");
    const approver = input.actor;
    const scopeKey = scopeKeyOf(input.scope);
    const loaded = typeof input.requestId === "string" && HANDLE_TEXT.test(input.requestId) ? await this.loadRequest(input.requestId) : null;
    if (scopeKey === null || loaded === null || loaded.held.scopeKey !== scopeKey) return refused("PA_REQUEST_NOT_FOUND");
    const { held, revision } = loaded;
    if (input.requestDigest !== held.request.requestDigest) return refused("PA_REQUEST_DIGEST_MISMATCH");
    const now = this.now();
    if (now >= held.expiresAt) return refused("PA_REQUEST_EXPIRED");
    if (held.confirmed) return refused("PA_REQUEST_ALREADY_CONFIRMED");
    if (approver.actorId === held.request.requestedBy) return refused("PA_PROPOSER_CANNOT_APPROVE");
    this.sweep(now);
    if (!this.hasRoom(this.authorizations, scopeKey, this.limits.authorizationsPerScope, this.limits.authorizations)) return refused("PA_LIMIT_REACHED");
    if (!(await this.swapRequest(held.request.requestId, revision))) return refused("PA_REQUEST_ALREADY_CONFIRMED");
    const nonce = this.nonce();
    if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error("PA_NONCE_INVALID");
    const issuedAt = new Date(now).toISOString();
    const { request } = held;
    const body = { schema: PURCHASE_AUTHORIZATION_SCHEMA, authorizationId: `purchase-authorization:${durableWorkflowDigest({ nonce, requestId: request.requestId, issuedAt }).slice(4, 36)}`, scope: request.scope, binding: request.binding, requestId: request.requestId, requestedBy: request.requestedBy, approvedBy: approver.actorId, issuedAt, expiresAt: request.binding.expiresAt };
    const record: AuthorizationRecord = deepFreeze({ ...body, authorizationDigest: durableWorkflowDigest(body) });
    this.authorizations.set(record.authorizationId, { record, scopeKey, expiresAt: Date.parse(record.expiresAt), revision: 0, state: "issued", consumedAt: null, consumedBy: null });
    return { ok: true, authorization: deepFreeze({ authorizationId: record.authorizationId, authorizationDigest: record.authorizationDigest, expiresAt: record.expiresAt }) };
  }

  /**
   * Burn the authorization for exactly `binding`: one compare-and-set from `issued`. A forged id or digest, another project or a
   * refused actor writes nothing; an expired authorization is burned `expired`, a changed binding `void`.
   */
  async consume(input: { readonly actor: unknown; readonly scope: unknown; readonly authorizationId: unknown; readonly authorizationDigest: unknown; readonly binding: unknown }): Promise<{ readonly ok: true; readonly authorization: ConsumedPurchaseAuthorization } | PurchaseRefusal> {
    if (!isHumanAdmin(input.actor)) return refused("PA_HUMAN_ADMIN_REQUIRED");
    if (!this.enablement().enabled) return refused("PA_ORDERING_DISABLED");
    const consumer = input.actor;
    const scopeKey = scopeKeyOf(input.scope);
    const loaded = typeof input.authorizationId === "string" && HANDLE_TEXT.test(input.authorizationId) ? await this.loadAuthorization(input.authorizationId) : null;
    if (scopeKey === null || loaded === null || loaded.held.scopeKey !== scopeKey || input.authorizationDigest !== loaded.held.record.authorizationDigest) return refused("PA_NOT_FOUND");
    const { held, revision } = loaded;
    const id = held.record.authorizationId;
    if (held.state !== "issued") return refused("PA_ALREADY_USED");
    const now = this.now();
    if (now >= held.expiresAt) return (await this.swapAuthorization(id, revision, "expired", now, null)) ? refused("PA_EXPIRED") : refused("PA_ALREADY_USED");
    const fields = bindingDifferences(held.record.binding, input.binding);
    if (fields.length > 0) return (await this.swapAuthorization(id, revision, "void", now, null)) ? refused("PA_BINDING_CHANGED", { fields }) : refused("PA_ALREADY_USED");
    if (!(await this.swapAuthorization(id, revision, "consumed", now, consumer.actorId))) return refused("PA_ALREADY_USED");
    const { record } = held;
    return { ok: true, authorization: deepFreeze({ authorizationId: id, scope: record.scope, binding: record.binding, requestedBy: record.requestedBy, approvedBy: record.approvedBy, issuedAt: record.issuedAt, expiresAt: record.expiresAt, consumedAt: new Date(now).toISOString(), consumedBy: consumer.actorId }) };
  }

  /** An authorization's state in a project (a read; nothing changes), or null when the project holds no such authorization. */
  stateOf(scope: unknown, authorizationId: string): PurchaseAuthorizationState | null {
    const held = this.authorizations.get(authorizationId);
    return held && held.scopeKey === scopeKeyOf(scope) ? held.state : null;
  }

  // the store's reads and its compare-and-set writes (in memory; a durable store would implement the same two operations). A read is
  // a SNAPSHOT, as a durable read is: two racing callers can both read `issued` (or unconfirmed), and only the compare-and-set on the
  // revision lets one of them through
  private async loadRequest(requestId: string): Promise<{ held: HeldRequest; revision: number } | null> {
    const held = this.requests.get(requestId);
    return held ? { held: { ...held }, revision: held.revision } : null;
  }
  private async swapRequest(requestId: string, expected: number): Promise<boolean> {
    const held = this.requests.get(requestId);
    if (!held || held.revision !== expected || held.confirmed) return false;
    held.confirmed = true;
    held.revision += 1;
    return true;
  }
  private async loadAuthorization(authorizationId: string): Promise<{ held: HeldAuthorization; revision: number } | null> {
    const held = this.authorizations.get(authorizationId);
    return held ? { held: { ...held }, revision: held.revision } : null;
  }
  private async swapAuthorization(authorizationId: string, expected: number, state: Exclude<PurchaseAuthorizationState, "issued">, now: number, consumedBy: string | null): Promise<boolean> {
    const held = this.authorizations.get(authorizationId);
    if (!held || held.revision !== expected || held.state !== "issued") return false;
    held.state = state;
    held.consumedAt = new Date(now).toISOString();
    held.consumedBy = consumedBy;
    held.revision += 1;
    return true;
  }

  /** Drops entries past their expiry by the retention period (a bound then refuses; nothing live is evicted). */
  private sweep(now: number): void {
    for (const [id, held] of this.requests) if (now >= held.expiresAt + PURCHASE_RETENTION_MS) this.requests.delete(id);
    for (const [id, held] of this.authorizations) if (now >= held.expiresAt + PURCHASE_RETENTION_MS) this.authorizations.delete(id);
  }
  private hasRoom(map: ReadonlyMap<string, { readonly scopeKey: string }>, scopeKey: string, perScope: number, overall: number): boolean {
    let held = 0;
    for (const entry of map.values()) if (entry.scopeKey === scopeKey) held += 1;
    return held < perScope && map.size < overall;
  }
}
