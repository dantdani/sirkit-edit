/**
 * [B23-B2] Step 5 of B23-B, "store provider receipt, artifact digest, capability/profile version and timestamp" (runbook :979; D23-4,
 * D23-5's receipt half; OD-167): the provider exchange's durable record, `mfg.provider-exchange.v1`. B22-C's `computation.evidence.v1`
 * (`app/lib/computation/evidence-store.ts`, OD-141) is the design copied:
 *  - one silent aggregate per (scope, board, provider), keyed through `durableWorkflowId`, on the durable-workflow substrate;
 *  - every append is a compare-and-set on the aggregate revision under an idempotency key of the attempt and its phase (`prepared`,
 *    `sent`, `settled`), so a repeated or concurrent append writes nothing new and is answered from its replay; a revision conflict
 *    with ANOTHER attempt of the same aggregate is retried on the new head (a durable write, never a send);
 *  - every load re-verifies the record digest, the attempt digest and the attempt itself, and a replay against the record stored
 *    under its id, refusing any disagreement with one closed error;
 *  - silent: NO outbox effect, ever (an exchange is never a command a handler could re-run; b23-b-egress-import-gate case 4).
 *
 * An attempt is keyed by its idempotency key and moves `prepared -> sent -> acknowledged | rejected | UNKNOWN_PENDING_RECONCILIATION`,
 * or `prepared -> not_sent` when the boundary refused it before any byte left (OD-184 (a)). `prepared` is written before the send and
 * `sent` immediately before the bytes are handed over, so a crash after `sent` leaves a record a person reconciles, never a silent
 * resend; a sender sends only after ITS OWN `prepared` and `sent` appends wrote new records. A record keeps ids, digests, timestamps,
 * versions and bounded normalized fields: never a raw provider answer, never a file or archive byte (B1 re-derives the bytes from the
 * ledgered release while its authority is head, its board current and its rule-profile evidence unexpired and within
 * `RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS`, `release/route.ts`; otherwise the exchange is stale - the staleness half of D23-5 is
 * B23-B3's, OD-168). B1's in-memory key store answers a repeated commit in its process; this record is the outcome of record and the
 * durable backstop across processes and restarts (OD-184 (c)).
 *
 * [B23-B2 review, 2026-10-04] The adversarial review's fixes:
 *  - the KEY NAMESPACE is the project scope (tenant, project, branch), B1's key scope: every record of a project shares one replay
 *    namespace, so a key names at most one attempt per project, and a key reused on another board or provider is refused, after a
 *    restart too (tests-4); `attemptForKey` reads an attempt by its key alone, so a restarted service answers a commit whose plan it
 *    no longer holds (tests-3);
 *  - ONE PACKAGE IN FLIGHT: a new attempt is refused (`in_flight`) while the aggregate holds another attempt of the same package to the
 *    same provider and operation ([B23-B2 lead, 2026-10-04] low-3: was the same request digest, which a registry revision moves) that is `prepared` or `sent` - in flight, or interrupted by a crash - and
 *    the refusal is re-checked on every head the append is tried against, so two concurrent commits of one package send once
 *    (coverage-2); only a person reconciling with the provider ends a `sent` one (no read is built, OD-167); [B23-B2 lead, 2026-10-04] low-2: a `prepared` one handed nothing over, so the next attempt of its package settles it `not_sent` (`abandoned`) once it is EXCHANGE_PREPARED_ABANDON_MS old, and a `sent` mark is written only while its own attempt is still `prepared` on that head, so an abandoned attempt never sends;
 *  - the PROVIDER KEY sent as Idempotency-Key is derived here (`providerIdempotencyKeyOf`) and re-derived on load, never the client's
 *    string (security-2);
 *  - a `sent` mark whose hand-over never happened (the deadline fell during the mark) settles `not_sent`, the mark kept (regressions-1);
 *  - a provider whose terms forbid storage keeps no provider-chosen text: its answer's media type is stored empty (coverage-6).
 *
 * The repository is INJECTED (the route composes the durable one; tests the in-memory one or PGlite): this module never imports the
 * durable runtime, the database, the outbox or the egress.
 */
import { canonicalDurableScope, durableAggregateIdentity, durableScopeKey, durableWorkflowDigest, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";

export const PROVIDER_EXCHANGE_AGGREGATE_TYPE = "mfg.provider-exchange.v1" as const;
export const PROVIDER_EXCHANGE_RECORD_SCHEMA = "sirkit.mfg-provider-exchange-record.v1" as const;
export const EXCHANGE_ATTEMPT_STATES = Object.freeze(["prepared", "sent", "acknowledged", "rejected", "UNKNOWN_PENDING_RECONCILIATION", "not_sent"] as const);
export type ExchangeAttemptState = (typeof EXCHANGE_ATTEMPT_STATES)[number];
/** The three appends of an attempt; `settled` carries its terminal state. */
export const EXCHANGE_PHASES = Object.freeze(["prepared", "sent", "settled"] as const);
export type ExchangePhase = (typeof EXCHANGE_PHASES)[number];
export const EXCHANGE_LEDGER_BOUNDS = Object.freeze({ maxText: 200, maxNormalizedFields: 16, maxNormalizedText: 256, maxContentType: 128, casAttempts: 8 });

export interface ExchangeAggregate { readonly scope: DurableWorkflowScope; readonly designId: string; readonly boardId: string; readonly providerId: string }
export interface ExchangeAttempt {
  readonly idempotencyKey: string;
  readonly planId: string;
  /** [B23-B2 review, 2026-10-04] the plan's digest: a restarted service names the plan by id, digest and key, as B1's store does */
  readonly planDigest: string;
  /** [B23-B2 review, 2026-10-04] the Idempotency-Key the provider sees, derived on the server (`providerIdempotencyKeyOf`) */
  readonly providerIdempotencyKey: string;
  readonly requestDigest: string;
  /** the human project administrator who committed (server-derived) */
  readonly committedBy: string;
  readonly operationId: string;
  readonly purpose: "dfm" | "quote";
  /** the registry row's version and digest, and the transfer descriptor's version */
  readonly descriptor: { readonly registryVersion: string; readonly registryDigest: string; readonly transferVersion: string };
  readonly capabilityProfile: { readonly profileId: string; readonly version: number };
  readonly release: { readonly releaseId: string; readonly archiveSha256: string };
  readonly outboundPackageDigest: string;
  readonly retention: "normalized" | "ids_digests_timestamps_only";
  /** whether the descriptor declares a status read for a later human-initiated reconciliation */
  readonly statusRead: "declared" | "not_declared";
  readonly state: ExchangeAttemptState;
  readonly preparedAt: string;
  readonly sentAt: string | null;
  readonly settledAt: string | null;
  readonly sendStarted: boolean;
  readonly request: { readonly bytes: number; readonly sha256: string } | null;
  readonly response: { readonly status: number; readonly contentType: string; readonly bytes: number; readonly sha256: string } | null;
  readonly receipt: { readonly providerReceiptId: string; readonly retrievedAt: string } | null;
  readonly normalized: Readonly<Record<string, string | number | boolean>>;
  readonly failure: string | null;
}
export type PreparedAttemptInput = Pick<ExchangeAttempt, "idempotencyKey" | "planId" | "planDigest" | "requestDigest" | "committedBy" | "operationId" | "purpose" | "descriptor" | "capabilityProfile" | "release" | "outboundPackageDigest" | "retention" | "statusRead">;
/** How a send ended, as the egress answers it (the fields the record keeps). */
export interface ExchangeSettleOutcome {
  readonly state: "not_sent" | "acknowledged" | "rejected" | "UNKNOWN_PENDING_RECONCILIATION";
  readonly sendStarted: boolean;
  readonly failure: string | null;
  readonly response: ExchangeAttempt["response"];
  readonly receipt: ExchangeAttempt["receipt"];
  readonly normalized: ExchangeAttempt["normalized"];
}
export interface LoadedExchangeRecord { readonly revision: number; readonly recordDigest: string; readonly aggregateKey: string; readonly phase: ExchangePhase; readonly at: string; readonly attempt: ExchangeAttempt }
export type ExchangePrepareResult =
  | { readonly ok: true; readonly replayed: boolean; readonly attempt: ExchangeAttempt }
  | { readonly ok: false; readonly code: "invalid_attempt"; readonly problems: readonly string[] }
  | { readonly ok: false; readonly code: "key_reuse_conflict"; readonly attempt: ExchangeAttempt }
  /** [B23-B2 review, 2026-10-04] another attempt of the same package, provider and operation ([B23-B2 lead, 2026-10-04] low-3: was the same request) is `prepared` or `sent` (in flight, or interrupted): nothing may be sent */
  | { readonly ok: false; readonly code: "in_flight"; readonly attempt: ExchangeAttempt }
  | { readonly ok: false; readonly code: "contended" };
export interface ProviderExchangeLedger {
  /** Record an attempt as `prepared`, or replay the attempt its key already names (`replayed`: send nothing). */
  prepare(input: { readonly aggregate: ExchangeAggregate; readonly attempt: PreparedAttemptInput; readonly at: string }): Promise<ExchangePrepareResult>;
  /** Record `sent`, immediately before the hand-over; throws unless THIS call wrote it while its attempt was still `prepared` on that head ([B23-B2 lead, 2026-10-04] low-2: never once abandoned); then nothing may be sent. */
  markSent(input: { readonly aggregate: ExchangeAggregate; readonly idempotencyKey: string; readonly request: { readonly bytes: number; readonly sha256: string }; readonly at: string }): Promise<ExchangeAttempt>;
  /** Record the terminal state (once; a repeat answers what was recorded). */
  settle(input: { readonly aggregate: ExchangeAggregate; readonly idempotencyKey: string; readonly outcome: ExchangeSettleOutcome; readonly at: string }): Promise<ExchangeAttempt>;
  /** The attempt's current record in this aggregate, re-verified; null when its key names none here. */
  attempt(aggregate: ExchangeAggregate, idempotencyKey: string): Promise<ExchangeAttempt | null>;
  /** [B23-B2 review, 2026-10-04] The attempt a key names in a project scope, with its aggregate, re-verified; null when it names none. */
  attemptForKey(scope: DurableWorkflowScope, idempotencyKey: string): Promise<{ readonly aggregate: ExchangeAggregate; readonly attempt: ExchangeAttempt } | null>;
  /** The head revision and each attempt's current record, every record re-verified; null when nothing was written. */
  load(aggregate: ExchangeAggregate): Promise<{ readonly revision: number; readonly attempts: readonly ExchangeAttempt[] } | null>;
  /** Every record in revision order, each re-verified. */
  history(aggregate: ExchangeAggregate): Promise<LoadedExchangeRecord[]>;
}

/** A stored record that fails its digest, its attempt digest, its attempt's rules or its replay: one closed error, nothing returned. */
export class ProviderExchangeLedgerIntegrityError extends Error {
  readonly code = "PX_LEDGER_DIGEST_MISMATCH" as const;
  constructor() {
    super("PX_LEDGER_DIGEST_MISMATCH: a stored provider exchange record failed its digest or attempt check; nothing was returned");
    this.name = "ProviderExchangeLedgerIntegrityError";
  }
}
/** A transition the attempt's state does not allow, a sent mark this call did not write, or a head that kept moving: nothing may be sent. */
export class ProviderExchangeLedgerTransitionError extends Error {
  readonly code = "PX_LEDGER_TRANSITION_REFUSED" as const;
  constructor() {
    super("PX_LEDGER_TRANSITION_REFUSED: the provider exchange record refused this transition; nothing may be sent under it");
    this.name = "ProviderExchangeLedgerTransitionError";
  }
}
/** [B23-B2 review, 2026-10-04] Internal: the open attempt that refuses a new one of the same package and operation (prepare answers `in_flight`; [B23-B2 lead, 2026-10-04] keyed on the package, not the request). */
class OpenAttemptRefusal extends Error {
  constructor(readonly attempt: ExchangeAttempt) {
    super("an attempt of the same package is in flight or interrupted");
  }
}

/** The attempt the exchange service records for a plan it is about to send (pure). */
export function exchangeAttemptInput(input: {
  readonly plan: { readonly planId: string; readonly planDigest: string; readonly requestDigest: string; readonly purpose: "dfm" | "quote"; readonly provider: { readonly operationId: string; readonly descriptorVersion: string; readonly descriptorDigest: string }; readonly release: { readonly releaseId: string; readonly archiveSha256: string }; readonly outbound: { readonly outboundPackageDigest: string } };
  readonly key: string;
  readonly actorId: string;
  readonly descriptor: { readonly version: string; readonly retention: "normalized" | "ids_digests_timestamps_only"; readonly statusRead: { readonly declared: boolean } };
  readonly capabilityProfile: { readonly profileId: string; readonly version: number };
}): PreparedAttemptInput {
  const { plan, descriptor } = input;
  return {
    idempotencyKey: input.key,
    planId: plan.planId,
    planDigest: plan.planDigest,
    requestDigest: plan.requestDigest,
    committedBy: input.actorId,
    operationId: plan.provider.operationId,
    purpose: plan.purpose,
    descriptor: { registryVersion: plan.provider.descriptorVersion, registryDigest: plan.provider.descriptorDigest, transferVersion: descriptor.version },
    capabilityProfile: { profileId: input.capabilityProfile.profileId, version: input.capabilityProfile.version },
    release: { releaseId: plan.release.releaseId, archiveSha256: plan.release.archiveSha256 },
    outboundPackageDigest: plan.outbound.outboundPackageDigest,
    retention: descriptor.retention,
    statusRead: descriptor.statusRead.declared ? "declared" : "not_declared",
  };
}

/**
 * [B23-B2 review, 2026-10-04] security-2: the Idempotency-Key the provider sees for one attempt - `sx-` and 64 hex characters of a digest
 * of the scope, the board, the provider, the plan and the client's key. Every tenant sends under one provider account, so a client's key
 * must never meet another's in the provider's namespace; one attempt keeps its key (a replay names the same attempt).
 */
export function providerIdempotencyKeyOf(aggregate: ExchangeAggregate, attempt: { readonly planId: string; readonly idempotencyKey: string }): string {
  return `sx-${durableWorkflowDigest({ ...canonicalDurableScope(aggregate.scope), designId: aggregate.designId, boardId: aggregate.boardId, providerId: aggregate.providerId, planId: attempt.planId, idempotencyKey: attempt.idempotencyKey }).slice(4)}`;
}

// ── the closed record ────────────────────────────────────────────────────────────────────────────────────────────────────────

const ATTEMPT_KEYS = ["idempotencyKey", "planId", "planDigest", "providerIdempotencyKey", "requestDigest", "committedBy", "operationId", "purpose", "descriptor", "capabilityProfile", "release", "outboundPackageDigest", "retention", "statusRead", "state", "preparedAt", "sentAt", "settledAt", "sendStarted", "request", "response", "receipt", "normalized", "failure"] as const;
const RECORD_KEYS = ["schema", "aggregate", "revision", "phase", "at", "attemptDigest", "attempt"] as const;
const KEY_TEXT = /^[A-Za-z0-9._:-]{1,128}$/;
const PROVIDER_KEY = /^sx-[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const FAILURE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const TERMINAL: ReadonlySet<string> = new Set(["acknowledged", "rejected", "UNKNOWN_PENDING_RECONCILIATION", "not_sent"]);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function keysAre(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => present.includes(key));
}
/** Printable text of 1..max characters (no control character: PostgreSQL text refuses a NUL, and none belongs in a record; [B23-B2 lead, 2026-10-04] low-2: and no lone UTF-16 surrogate, which PostgreSQL's jsonb refuses). */
function text(value: unknown, max: number = EXCHANGE_LEDGER_BOUNDS.maxText): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || hasLoneSurrogate(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}
const count = (value: unknown): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const instant = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
function normalizedOk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= EXCHANGE_LEDGER_BOUNDS.maxNormalizedFields && entries.every(([key, entry]) => FIELD_NAME.test(key)
    && (typeof entry === "boolean" || (typeof entry === "number" && Number.isFinite(entry)) || (typeof entry === "string" && entry.length <= EXCHANGE_LEDGER_BOUNDS.maxNormalizedText && (entry === "" || text(entry, EXCHANGE_LEDGER_BOUNDS.maxNormalizedText)))));
}

/** [B23-B2] The closed attempt's problems (JSON paths); empty when it is a valid exchange attempt in a consistent state. */
export function validateExchangeAttempt(candidate: unknown): string[] {
  if (!keysAre(candidate, ATTEMPT_KEYS)) return ["$"];
  const a = candidate;
  const problems: string[] = [];
  if (typeof a.idempotencyKey !== "string" || !KEY_TEXT.test(a.idempotencyKey)) problems.push("$.idempotencyKey");
  if (typeof a.providerIdempotencyKey !== "string" || !PROVIDER_KEY.test(a.providerIdempotencyKey)) problems.push("$.providerIdempotencyKey");
  for (const key of ["planId", "planDigest", "requestDigest", "committedBy", "operationId", "outboundPackageDigest"] as const) if (!text(a[key])) problems.push(`$.${key}`);
  if (a.purpose !== "dfm" && a.purpose !== "quote") problems.push("$.purpose");
  if (!keysAre(a.descriptor, ["registryVersion", "registryDigest", "transferVersion"]) || !text(a.descriptor.registryVersion) || !text(a.descriptor.registryDigest) || !text(a.descriptor.transferVersion)) problems.push("$.descriptor");
  if (!keysAre(a.capabilityProfile, ["profileId", "version"]) || !text(a.capabilityProfile.profileId) || !count(a.capabilityProfile.version)) problems.push("$.capabilityProfile");
  if (!keysAre(a.release, ["releaseId", "archiveSha256"]) || !text(a.release.releaseId) || typeof a.release.archiveSha256 !== "string" || !HEX64.test(a.release.archiveSha256)) problems.push("$.release");
  if (a.retention !== "normalized" && a.retention !== "ids_digests_timestamps_only") problems.push("$.retention");
  if (a.statusRead !== "declared" && a.statusRead !== "not_declared") problems.push("$.statusRead");
  if (!(EXCHANGE_ATTEMPT_STATES as readonly unknown[]).includes(a.state)) problems.push("$.state");
  if (!instant(a.preparedAt)) problems.push("$.preparedAt");
  if (!(a.sentAt === null || instant(a.sentAt))) problems.push("$.sentAt");
  if (!(a.settledAt === null || instant(a.settledAt))) problems.push("$.settledAt");
  if (typeof a.sendStarted !== "boolean") problems.push("$.sendStarted");
  if (!(a.request === null || (keysAre(a.request, ["bytes", "sha256"]) && count(a.request.bytes) && typeof a.request.sha256 === "string" && HEX64.test(a.request.sha256)))) problems.push("$.request");
  // [B23-B2 review, 2026-10-04] coverage-6: a provider whose terms forbid storage keeps no provider-chosen text, so its media type is empty
  if (!(a.response === null || (keysAre(a.response, ["status", "contentType", "bytes", "sha256"]) && typeof a.response.status === "number" && Number.isSafeInteger(a.response.status) && a.response.status >= 100 && a.response.status <= 599
    && (a.response.contentType === "" || (a.retention === "normalized" && text(a.response.contentType, EXCHANGE_LEDGER_BOUNDS.maxContentType))) && count(a.response.bytes) && typeof a.response.sha256 === "string" && HEX64.test(a.response.sha256)))) problems.push("$.response");
  if (!(a.receipt === null || (keysAre(a.receipt, ["providerReceiptId", "retrievedAt"]) && typeof a.receipt.providerReceiptId === "string" && KEY_TEXT.test(a.receipt.providerReceiptId) && instant(a.receipt.retrievedAt)))) problems.push("$.receipt");
  // a provider whose terms forbid storage keeps ids, digests and timestamps only
  if (!normalizedOk(a.normalized) || (a.retention !== "normalized" && Object.keys(a.normalized as object).length > 0)) problems.push("$.normalized");
  if (!(a.failure === null || (typeof a.failure === "string" && FAILURE_CODE.test(a.failure)))) problems.push("$.failure");
  if (problems.length === 0 && !stateConsistent(a as unknown as ExchangeAttempt)) problems.push("$.state");
  return problems;
}

/** What each state carries: nothing sent before `sent`; a settled time on every terminal state; a receipt only when acknowledged. */
function stateConsistent(a: ExchangeAttempt): boolean {
  const empty = Object.keys(a.normalized).length === 0;
  switch (a.state) {
    case "prepared":
      return a.sentAt === null && a.settledAt === null && !a.sendStarted && a.request === null && a.response === null && a.receipt === null && a.failure === null && empty;
    case "sent":
      return a.sentAt !== null && a.settledAt === null && a.sendStarted && a.request !== null && a.response === null && a.receipt === null && a.failure === null && empty;
    case "acknowledged":
      return a.sentAt !== null && a.settledAt !== null && a.sendStarted && a.request !== null && a.response !== null && a.receipt !== null && a.failure === null;
    case "rejected":
      return a.sentAt !== null && a.settledAt !== null && a.sendStarted && a.request !== null && a.response !== null && a.receipt === null && a.failure !== null && empty;
    case "UNKNOWN_PENDING_RECONCILIATION":
      return a.sentAt !== null && a.settledAt !== null && a.sendStarted && a.request !== null && a.receipt === null && a.failure !== null && empty;
    case "not_sent":
      // [B23-B2 review, 2026-10-04] regressions-1: nothing handed over; a `sent` mark that landed without a hand-over keeps its time and digest
      return (a.sentAt === null) === (a.request === null) && a.settledAt !== null && !a.sendStarted && a.response === null && a.receipt === null && a.failure !== null && empty;
  }
}

// ── the store ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface StoredExchangeRecord { schema: typeof PROVIDER_EXCHANGE_RECORD_SCHEMA; aggregate: { designId: string; boardId: string; providerId: string }; revision: number; phase: ExchangePhase; at: string; attemptDigest: string; attempt: ExchangeAttempt }

export function exchangeAggregateKey(aggregate: ExchangeAggregate): string {
  return durableWorkflowId("mfg-provider-exchange", { ...canonicalDurableScope(aggregate.scope), designId: aggregate.designId, boardId: aggregate.boardId, providerId: aggregate.providerId });
}
/** [B23-B2 review, 2026-10-04] tests-4: the ONE replay namespace of a project scope's exchange records (B1's key scope), so a key names at most one attempt per (tenant, project, branch). */
export function exchangeScopeKey(scope: DurableWorkflowScope): string {
  return durableScopeKey(scope, "mfg-provider-exchange");
}
/** The durable idempotency key of one append: the attempt's key and the phase it records. */
export const exchangeCommitKey = (idempotencyKey: string, phase: ExchangePhase): string => `attempt:${idempotencyKey}:${phase}`;
const identityOf = (aggregate: ExchangeAggregate): DurableAggregateIdentity => durableAggregateIdentity(aggregate.scope, PROVIDER_EXCHANGE_AGGREGATE_TYPE, exchangeAggregateKey(aggregate));
const sameAggregate = (a: ExchangeAggregate, b: ExchangeAggregate): boolean => exchangeAggregateKey(a) === exchangeAggregateKey(b);
function digestOrNull(value: unknown): string | null {
  try {
    return durableWorkflowDigest(value);
  } catch {
    return null;
  }
}
function providerKeyOrNull(aggregate: ExchangeAggregate, attempt: { readonly planId: string; readonly idempotencyKey: string }): string | null {
  try {
    return providerIdempotencyKeyOf(aggregate, attempt);
  } catch {
    return null;
  }
}
const phaseHolds = (phase: unknown, state: ExchangeAttemptState): boolean => (phase === "prepared" && state === "prepared") || (phase === "sent" && state === "sent") || (phase === "settled" && TERMINAL.has(state));

function verified(record: DurableAggregateRecord<object>, aggregate: ExchangeAggregate): LoadedExchangeRecord {
  const payload = record.payload as Partial<StoredExchangeRecord>;
  const ok = record.aggregateType === PROVIDER_EXCHANGE_AGGREGATE_TYPE && record.aggregateKey === exchangeAggregateKey(aggregate)
    && keysAre(payload, RECORD_KEYS) && payload.schema === PROVIDER_EXCHANGE_RECORD_SCHEMA && payload.revision === record.revision
    && keysAre(payload.aggregate, ["designId", "boardId", "providerId"]) && payload.aggregate.designId === aggregate.designId && payload.aggregate.boardId === aggregate.boardId && payload.aggregate.providerId === aggregate.providerId
    && instant(payload.at) && digestOrNull(payload) === record.recordDigest
    && typeof payload.attemptDigest === "string" && digestOrNull(payload.attempt) === payload.attemptDigest
    && validateExchangeAttempt(payload.attempt).length === 0 && phaseHolds(payload.phase, payload.attempt!.state)
    // [B23-B2 review, 2026-10-04] security-2: the provider key is this attempt's own derivation
    && payload.attempt!.providerIdempotencyKey === providerKeyOrNull(aggregate, payload.attempt!);
  if (!ok) throw new ProviderExchangeLedgerIntegrityError();
  return { revision: record.revision, recordDigest: record.recordDigest, aggregateKey: record.aggregateKey, phase: payload.phase!, at: payload.at!, attempt: payload.attempt! };
}

/** [B23-B2 review, 2026-10-04] The aggregate a stored record names (its scope, and the board and provider its payload carries). */
function aggregateOf(scope: DurableWorkflowScope, record: DurableAggregateRecord<object>): ExchangeAggregate {
  const named = (record.payload as Partial<StoredExchangeRecord>).aggregate;
  if (!keysAre(named, ["designId", "boardId", "providerId"]) || !text(named.designId) || !text(named.boardId) || !text(named.providerId, 64)) throw new ProviderExchangeLedgerIntegrityError();
  return { scope, designId: named.designId, boardId: named.boardId, providerId: named.providerId };
}

/** A revision conflict or a unique-index refusal: another append moved the head first (in memory, or on PostgreSQL). */
function contended(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current: unknown = error; current !== null && typeof current === "object" && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    const message = current instanceof Error ? current.message : "";
    if (message === "DW_OPTIMISTIC_REVISION_CONFLICT" || (current as { code?: unknown }).code === "23505" || message.includes("duplicate key value violates unique constraint")) return true;
  }
  return false;
}

/** [B23-B2] The exchange record over an injected durable-workflow repository. */
export function createProviderExchangeLedger(repository: DurableWorkflowRepository): ProviderExchangeLedger {
  /**
   * The attempt a key names in a project scope: its latest phase's replay, checked against the record stored under that replay's id,
   * both verified against the aggregate the stored record names. [B23-B2 review, 2026-10-04] the key namespace is the project scope.
   */
  async function keyedAttempt(scope: DurableWorkflowScope, idempotencyKey: string): Promise<{ aggregate: ExchangeAggregate; attempt: ExchangeAttempt } | null> {
    const canonical = canonicalDurableScope(scope);
    for (const phase of ["settled", "sent", "prepared"] as const) {
      const replay = await repository.getReplay(canonical, exchangeScopeKey(canonical), exchangeCommitKey(idempotencyKey, phase));
      if (!replay) continue;
      const replayed = replay.records[0];
      if (!replayed) throw new ProviderExchangeLedgerIntegrityError();
      const stored = await repository.loadRecord(canonical, replayed.recordId);
      if (!stored || stored.recordDigest !== replayed.recordDigest) throw new ProviderExchangeLedgerIntegrityError();
      const aggregate = aggregateOf(canonical, stored);
      const loaded = verified(stored, aggregate);
      verified(replayed, aggregate);
      if (loaded.phase !== phase || loaded.attempt.idempotencyKey !== idempotencyKey) throw new ProviderExchangeLedgerIntegrityError();
      return { aggregate, attempt: loaded.attempt };
    }
    return null;
  }

  /** The attempt's current record in `aggregate` (null when its key names none, or names one of another aggregate). */
  async function attemptOf(aggregate: ExchangeAggregate, idempotencyKey: string): Promise<ExchangeAttempt | null> {
    const found = await keyedAttempt(aggregate.scope, idempotencyKey);
    return found !== null && sameAggregate(found.aggregate, aggregate) ? found.attempt : null;
  }

  /**
   * One append under CAS: `written` only when THIS call wrote a new record; a replay of the same append is `written: false`. `guard`
   * runs against every head the append is tried on, after it is read and before the commit, so what it checks holds for the
   * revision the commit expects (a refusal throws before anything is written).
   */
  async function append(aggregate: ExchangeAggregate, phase: ExchangePhase, attempt: ExchangeAttempt, at: string, guard?: () => Promise<void>): Promise<{ written: boolean }> {
    const scope = canonicalDurableScope(aggregate.scope);
    const scopeKey = exchangeScopeKey(scope);
    const commitKey = exchangeCommitKey(attempt.idempotencyKey, phase);
    for (let tries = 0; tries < EXCHANGE_LEDGER_BOUNDS.casAttempts; tries += 1) {
      const head = await repository.loadHead(identityOf(aggregate));
      if (head) verified(head, aggregate);
      if (head && guard) await guard(); if (head && phase === "sent") await stillPrepared(historyOf, aggregate, attempt.idempotencyKey); // [B23-B2 lead, 2026-10-04] low-2: a sent mark only while its own attempt is still prepared on this head (never once abandoned)
      const expectedRevision = head?.revision ?? 0;
      const payload: StoredExchangeRecord = { schema: PROVIDER_EXCHANGE_RECORD_SCHEMA, aggregate: { designId: aggregate.designId, boardId: aggregate.boardId, providerId: aggregate.providerId }, revision: expectedRevision + 1, phase, at, attemptDigest: durableWorkflowDigest(attempt), attempt };
      try {
        const committed = await repository.commit({
          scope,
          scopeKey,
          idempotencyKey: commitKey,
          operations: [{ aggregateType: PROVIDER_EXCHANGE_AGGREGATE_TYPE, aggregateKey: exchangeAggregateKey(aggregate), expectedRevision, payload, recordDigest: durableWorkflowDigest(payload) }],
          outbox: [], // silent: no effect, ever
          result: { idempotencyKey: attempt.idempotencyKey, phase },
          committedAt: at,
        });
        return { written: !committed.idempotent };
      } catch (error) {
        if (!contended(error)) throw error;
        // the head moved: if it moved by this very append (a concurrent duplicate), that is a replay; otherwise try the new head
        if (await repository.getReplay(scope, scopeKey, commitKey)) return { written: false };
      }
    }
    throw new ProviderExchangeLedgerTransitionError();
  }

  /** Every record in revision order, each re-verified. */
  async function historyOf(aggregate: ExchangeAggregate): Promise<LoadedExchangeRecord[]> {
    return (await repository.history(identityOf(aggregate))).map((record) => verified(record, aggregate)).sort((a, b) => a.revision - b.revision);
  }

  function aggregateProblems(aggregate: ExchangeAggregate, at: string): string[] {
    const problems: string[] = [];
    if (!text(aggregate.designId)) problems.push("$.aggregate.designId");
    if (!text(aggregate.boardId)) problems.push("$.aggregate.boardId");
    if (!text(aggregate.providerId, 64)) problems.push("$.aggregate.providerId");
    if (!instant(at)) problems.push("$.at");
    return problems;
  }

  return Object.freeze({
    async prepare(input: { readonly aggregate: ExchangeAggregate; readonly attempt: PreparedAttemptInput; readonly at: string }): Promise<ExchangePrepareResult> {
      const placement = aggregateProblems(input.aggregate, input.at);
      if (placement.length > 0) return { ok: false, code: "invalid_attempt", problems: placement };
      const attempt: ExchangeAttempt = { ...input.attempt, providerIdempotencyKey: providerKeyOrNull(input.aggregate, input.attempt) ?? "", state: "prepared", preparedAt: input.at, sentAt: null, settledAt: null, sendStarted: false, request: null, response: null, receipt: null, normalized: {}, failure: null };
      const problems = validateExchangeAttempt(attempt);
      if (problems.length > 0) return { ok: false, code: "invalid_attempt", problems };
      // the key's attempt, in this aggregate or another of the project: the same plan replays, anything else is a reuse of the key
      const replay = (existing: { aggregate: ExchangeAggregate; attempt: ExchangeAttempt }): ExchangePrepareResult => (sameAggregate(existing.aggregate, input.aggregate) && existing.attempt.planId === attempt.planId && existing.attempt.planDigest === attempt.planDigest && existing.attempt.requestDigest === attempt.requestDigest
        ? { ok: true, replayed: true, attempt: existing.attempt }
        : { ok: false, code: "key_reuse_conflict", attempt: existing.attempt });
      const existing = await keyedAttempt(input.aggregate.scope, attempt.idempotencyKey);
      if (existing) return replay(existing);
      // [B23-B2 review, 2026-10-04] coverage-2: one package in flight - another attempt of this package and operation still `prepared` or `sent` refuses this one ([B23-B2 lead, 2026-10-04] the package digest, never the request digest a registry revision moves)
      const guard = async (): Promise<void> => {
        const latest = new Map<string, ExchangeAttempt>();
        for (const record of await historyOf(input.aggregate)) latest.set(record.attempt.idempotencyKey, record.attempt);
        const open = [...latest.values()].find((other) => other.idempotencyKey !== attempt.idempotencyKey && samePackage(other, attempt) && (other.state === "prepared" || other.state === "sent")); // [B23-B2 lead, 2026-10-04] low-3: the package, provider and operation (was the request digest, which a registry revision moves)
        if (open) throw new OpenAttemptRefusal(open);
      };
      let written: boolean;
      try {
        await abandonStale({ append, history: historyOf }, input.aggregate, attempt, input.at); ({ written } = await append(input.aggregate, "prepared", attempt, input.at, guard)); // [B23-B2 lead, 2026-10-04] low-2: a stalled prepared attempt of the package is settled not_sent first
      } catch (error) {
        if (error instanceof OpenAttemptRefusal) return { ok: false, code: "in_flight", attempt: error.attempt };
        if (error instanceof ProviderExchangeLedgerTransitionError) return { ok: false, code: "contended" };
        throw error;
      }
      if (written) return { ok: true, replayed: false, attempt };
      const current = await keyedAttempt(input.aggregate.scope, attempt.idempotencyKey);
      if (!current) throw new ProviderExchangeLedgerIntegrityError();
      return replay(current);
    },

    async markSent(input: { readonly aggregate: ExchangeAggregate; readonly idempotencyKey: string; readonly request: { readonly bytes: number; readonly sha256: string }; readonly at: string }): Promise<ExchangeAttempt> {
      const current = await attemptOf(input.aggregate, input.idempotencyKey);
      if (!current || current.state !== "prepared") throw new ProviderExchangeLedgerTransitionError();
      const next: ExchangeAttempt = { ...current, state: "sent", sentAt: input.at, sendStarted: true, request: { bytes: input.request.bytes, sha256: input.request.sha256 } };
      if (validateExchangeAttempt(next).length > 0 || !instant(input.at)) throw new ProviderExchangeLedgerTransitionError();
      // only the call that WROTE `sent` may hand the bytes over: a replayed mark means another sender holds this attempt
      if (!(await append(input.aggregate, "sent", next, input.at)).written) throw new ProviderExchangeLedgerTransitionError();
      return next;
    },

    async settle(input: { readonly aggregate: ExchangeAggregate; readonly idempotencyKey: string; readonly outcome: ExchangeSettleOutcome; readonly at: string }): Promise<ExchangeAttempt> {
      const current = await attemptOf(input.aggregate, input.idempotencyKey);
      if (!current) throw new ProviderExchangeLedgerTransitionError();
      if (TERMINAL.has(current.state)) return current; // settled once; a repeat answers what was recorded
      const { outcome } = input;
      // [B23-B2 review, 2026-10-04] regressions-1: nothing handed over settles `prepared`, or a `sent` mark that landed without a hand-over
      // (the deadline fell during the mark); anything after the hand-over settles `sent`
      const from: readonly ExchangeAttemptState[] = outcome.state === "not_sent" ? ["prepared", "sent"] : ["sent"];
      if (!from.includes(current.state) || outcome.sendStarted !== (outcome.state !== "not_sent")) throw new ProviderExchangeLedgerTransitionError();
      const kept = current.retention === "normalized";
      // [B23-B2 review, 2026-10-04] coverage-6: under ids-only retention no provider-chosen text is kept (the media type is stored empty)
      const response = outcome.response === null || kept ? outcome.response : { ...outcome.response, contentType: "" };
      const next: ExchangeAttempt = { ...current, state: outcome.state, sendStarted: outcome.sendStarted, settledAt: input.at, failure: outcome.failure, response, receipt: outcome.receipt, normalized: kept ? { ...outcome.normalized } : {} };
      if (validateExchangeAttempt(next).length > 0 || !instant(input.at)) throw new ProviderExchangeLedgerTransitionError();
      if ((await append(input.aggregate, "settled", next, input.at)).written) return next;
      const recorded = await attemptOf(input.aggregate, input.idempotencyKey);
      if (!recorded) throw new ProviderExchangeLedgerIntegrityError();
      return recorded;
    },

    attempt: attemptOf,

    attemptForKey: keyedAttempt,

    async load(aggregate: ExchangeAggregate): Promise<{ readonly revision: number; readonly attempts: readonly ExchangeAttempt[] } | null> {
      const head = await repository.loadHead(identityOf(aggregate));
      if (!head) return null;
      verified(head, aggregate);
      const latest = new Map<string, ExchangeAttempt>();
      for (const record of await historyOf(aggregate)) latest.set(record.attempt.idempotencyKey, record.attempt);
      return { revision: head.revision, attempts: [...latest.values()] };
    },

    history: historyOf,
  });
}

// ── [B23-B2 lead, 2026-10-04] the independent check's low findings ─────────────────────────────────────────────────────────────

/**
 * [B23-B2 lead, 2026-10-04] low-2: how old a `prepared` attempt (one that handed nothing over) must be before the next attempt of its
 * package, provider and operation settles it `not_sent` (`abandoned`) instead of answering in flight: ten minutes, five times the
 * longest deadline a reviewed transfer descriptor may declare (`TRANSFER_DESCRIPTOR_BOUNDS.maxDeadlineMs`, 120 s, provider-egress.ts),
 * which bounds a live sender's time from `prepared` to its `sent` mark. The bound decides only when a stalled attempt stops blocking;
 * it never lets two attempts send: the abandonment is a CAS append that requires the attempt still `prepared` on its head, and a `sent`
 * mark is written only while its own attempt is still `prepared` on its head, so whichever lands first, the other is refused. A clock
 * skewed between instances can abandon a live attempt early; its mark is then refused and it sends nothing.
 */
export const EXCHANGE_PREPARED_ABANDON_MS = 10 * 60_000;

/** [B23-B2 lead, 2026-10-04] low-3: the one-package-in-flight identity - the package's digest and the operation (the provider is the aggregate's), never the request digest, which a registry or descriptor revision moves. */
function samePackage(a: Pick<ExchangeAttempt, "outboundPackageDigest" | "operationId">, b: Pick<ExchangeAttempt, "outboundPackageDigest" | "operationId">): boolean {
  return a.outboundPackageDigest === b.outboundPackageDigest && a.operationId === b.operationId;
}

/** Each attempt's latest record, in revision order. */
function latestAttempts(history: readonly LoadedExchangeRecord[]): Map<string, ExchangeAttempt> {
  const latest = new Map<string, ExchangeAttempt>();
  for (const record of history) latest.set(record.attempt.idempotencyKey, record.attempt);
  return latest;
}

type ExchangeHistory = (aggregate: ExchangeAggregate) => Promise<LoadedExchangeRecord[]>;
type ExchangeAppend = (aggregate: ExchangeAggregate, phase: ExchangePhase, attempt: ExchangeAttempt, at: string, guard?: () => Promise<void>) => Promise<{ written: boolean }>;

/** [B23-B2 lead, 2026-10-04] low-2: a `sent` mark's own-state check, run on every head its append is tried on. */
async function stillPrepared(history: ExchangeHistory, aggregate: ExchangeAggregate, idempotencyKey: string): Promise<void> {
  if (latestAttempts(await history(aggregate)).get(idempotencyKey)?.state !== "prepared") throw new ProviderExchangeLedgerTransitionError();
}

/** [B23-B2 lead, 2026-10-04] Internal: the attempt is no longer `prepared` on this head (it was marked sent, or settled), so it is not abandoned. */
class AbandonSkipped extends Error {
  constructor() {
    super("the attempt is no longer prepared");
  }
}

/**
 * [B23-B2 lead, 2026-10-04] low-2: before a new attempt is prepared, every other attempt of its package, provider and operation that is
 * still `prepared` EXCHANGE_PREPARED_ABANDON_MS after it was prepared is settled `not_sent` with the failure `abandoned`: no `sent`
 * record exists, so nothing was handed over, and once this record lands its sender's `sent` mark is refused. Each is a CAS append under
 * the attempt's own `settled` key that re-checks, on every head, that the attempt is still `prepared`; one marked `sent` meanwhile is
 * left as it is (it then blocks the new attempt), and one its own sender settled meanwhile replays.
 */
async function abandonStale(io: { readonly append: ExchangeAppend; readonly history: ExchangeHistory }, aggregate: ExchangeAggregate, attempt: ExchangeAttempt, at: string): Promise<void> {
  for (const other of latestAttempts(await io.history(aggregate)).values()) {
    if (other.idempotencyKey === attempt.idempotencyKey || !samePackage(other, attempt) || other.state !== "prepared" || Date.parse(at) - Date.parse(other.preparedAt) < EXCHANGE_PREPARED_ABANDON_MS) continue;
    const abandoned: ExchangeAttempt = { ...other, state: "not_sent", settledAt: at, failure: "abandoned" };
    if (validateExchangeAttempt(abandoned).length > 0) throw new ProviderExchangeLedgerTransitionError();
    try {
      await io.append(aggregate, "settled", abandoned, at, async () => {
        if (latestAttempts(await io.history(aggregate)).get(other.idempotencyKey)?.state !== "prepared") throw new AbandonSkipped();
      });
    } catch (error) {
      if (!(error instanceof AbandonSkipped)) throw error;
    }
  }
}

/**
 * [B23-B2 lead, 2026-10-04] low-2: whether `value` holds a UTF-16 surrogate without its pair. PostgreSQL's jsonb refuses one (22P02,
 * "Unicode low surrogate must follow a high surrogate"; b23-b-exchange-ledger-pglite case 5), so a record holding it could never land.
 */
function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
