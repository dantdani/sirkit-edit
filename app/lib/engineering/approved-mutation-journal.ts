/**
 * B12.3 §A / B12.4 §B§C — the durable approved-mutation replay journal.
 *
 * B12.3 introduced the journal; B12.4 hardens it after three reproduced
 * defects: (R2) `validateEntry` accepted structurally malformed
 * checksum-valid records and never checked scope coherence; (R3)
 * `prepare()` could DOWNGRADE a committed/finalized entry back to
 * `prepared`, erasing the durable receipt inputs; and the entry integrity
 * digest was being treated as authentication when it is only a
 * consistency checksum (receipt authority now lives in the §A linkage in
 * approved-agent-mutations.ts — the journal itself never authenticates).
 *
 * B12.4 contract:
 *
 *  - STRICT, TOTAL validation (§B): exact closed key sets for documents,
 *    entries, nested head marks and receipts; exact types, patterns,
 *    finite safe integers and bounds; entry scope must match THIS journal
 *    instance's tenant/project/branch; state-dependent invariants
 *    (prepared carries no commit fields; committed/adopted carry complete
 *    committed inputs and no receipt; receipt-finalized carries both and a
 *    coherent receipt; poisoned preserves whatever was known). Validation
 *    never throws on hostile, malformed, cyclic, oversized, or
 *    checksum-valid-but-malformed input.
 *
 *  - MONOTONIC state machine (§C):
 *        prepared → canonical-committed → adopted → receipt-finalized
 *        prepared | canonical-committed | adopted → poisoned
 *    `prepare` is an idempotent no-op against an IDENTICAL `prepared`
 *    entry, fails closed (`conflict`) against a conflicting one, and can
 *    never overwrite or downgrade any later state
 *    (`invalid-transition`). Repeated transitions with identical payloads
 *    are idempotent (crash-retry safe); a finalized receipt can never be
 *    replaced (`conflict`) and a finalized entry can never be poisoned.
 *    Every transition preserves the immutable identity/scope/base fields.
 *
 *  - CAS-versioned documents (§C): every document carries a monotonically
 *    increasing `version`; writes go through the store's compare-and-swap
 *    (`saveIf`) with bounded optimistic retries, so two compositions
 *    (tabs/reloads) performing read-modify-write cannot silently clobber
 *    each other.
 *
 * B12.5 §A: `saveIf` is a REAL atomicity requirement on the store, not a
 * convention. The B12.4 localStorage implementation performed a
 * synchronous read-check-write and claimed per-turn atomicity supplied
 * cross-context CAS — reproduced FALSE (pre-edit counterexample R1: two
 * contexts both returned true from the same expected version and one
 * write was silently lost; monotonic entry transitions cannot prevent
 * lost updates between different identities). The production store is now
 * `IndexedDbApprovedMutationJournalStore` (approved-mutation-journal-idb.ts),
 * whose `saveIf` performs read/version-check/write inside ONE IndexedDB
 * readwrite transaction — the engine serializes overlapping readwrite
 * transactions across every browser context. There is no localStorage
 * fallback, and the interface has no unconditional `save`: every
 * production journal write passes through the atomic compare-and-swap
 * boundary. Failed writes leave the previous durable state intact.
 *
 * Storage identity (§B) is collision-free: the IndexedDB store keys
 * records by the ARRAY key [tenantId, projectId, branchId] (element-wise
 * comparison — injective), never by a delimiter-joined string; scope ids
 * are bounds-validated before key derivation. The B12.4 localStorage key
 * `…v1:${tenant}:${project}:${branch}` collided distinct valid scopes
 * (pre-edit counterexample R4) because `:` is a legal scope character.
 */

import { capturePlainJson } from "../agent/plain-capture";
import { canonicalJson, engineeringDigest } from "./stable";
import type { ReplacementMutationReceipt } from "./approved-replacement-mutations";
import type { ApprovedMutationReceipt } from "./approved-agent-mutations";

export const APPROVED_MUTATION_JOURNAL_SCHEMA = "sirkit.approved-mutation-journal.v1" as const;
export const APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA = "sirkit.approved-mutation-journal-entry.v1" as const;

export type ApprovedMutationJournalState =
  | "prepared"
  | "canonical-committed"
  | "adopted"
  | "receipt-finalized"
  | "poisoned";

export interface ApprovedMutationJournalEntry {
  schema: typeof APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA;
  /** The complete approved-mutation identity key (v2 — the whole sealed body). */
  identityKey: string;
  proposalId: string;
  /** Also the canonical executor's clientOperationId for this apply. */
  clientOperationId: string;
  operationsDigest: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  lineageId: string;
  baseHeadMark: { headSequence: number; canonicalStateDigest: string };
  baseSchematicDigest: string;
  originRunId: string | null;
  /** [B16.0.1 §E] the sealed authorization identity this apply was PREPARED
   *  under — the verified principal + the membership revision from the
   *  proposal's authorization binding. Durable BEFORE the canonical commit;
   *  recovery can never adopt a receipt under a different principal or
   *  membership revision, and a LEGACY entry lacking this field is never
   *  imported or adopted (membership authority is never backfilled). */
  authorization: { principalId: string; membershipRevision: string };
  operationCount: number;
  destructive: boolean;
  preparedAt: number;
  state: ApprovedMutationJournalState;
  /** Deterministic receipt inputs — recorded at canonical commit. */
  committedAt: number | null;
  transactionId: string | null;
  revisionBefore: string | null;
  revisionAfter: string | null;
  headAfter: { headSequence: number; canonicalStateDigest: string } | null;
  schematicDigestAfter: string | null;
  /** The finalized ORIGINAL receipt, once persisted. */
  receipt: ApprovedMutationReceipt | ReplacementMutationReceipt | null;
  /** Content-CONSISTENCY digest over the entry body (this field excluded).
   *  A checksum, NOT authentication — receipt authority is the §A linkage. */
  integrity: string;
}

interface JournalDocument {
  schema: typeof APPROVED_MUTATION_JOURNAL_SCHEMA;
  version: number;
  entries: ApprovedMutationJournalEntry[];
}

const MAX_ENTRIES = 64;
const MAX_SERIALIZED = 262_144;
const CAS_RETRIES = 4;

/** §A size bound shared with the production store. */
export const APPROVED_MUTATION_JOURNAL_MAX_SERIALIZED = MAX_SERIALIZED;

/**
 * [B12.5 §A] The journal's persistence boundary. `saveIf` MUST be a real
 * compare-and-swap: two independent contexts must never both succeed from
 * the same expected version, and the read/version-check/write must be one
 * atomic unit covering the complete document (an implementation whose
 * check and write can interleave with another context's — e.g. plain
 * localStorage — is NOT a valid implementation). There is deliberately no
 * unconditional `save`: every production write passes through the CAS.
 */
export interface ApprovedMutationJournalStore {
  load(tenantId: string, projectId: string, branchId: string): Promise<unknown | null>;
  /** Atomic compare-and-swap: persist `document` only when the stored
   *  document's `version` still equals `expectedVersion` (null = nothing
   *  stored). Returns false on a version conflict; a false return means
   *  NOTHING was written. */
  saveIf(tenantId: string, projectId: string, branchId: string, document: unknown, expectedVersion: number | null): Promise<boolean>;
}

/** The `version` a stored raw document claims (0 when absent/invalid). */
export function journalDocumentVersion(raw: unknown): number | null {
  return storedVersion(raw);
}

/** §B — the closed scope-id vocabulary, checked BEFORE any storage-key
 *  derivation. Colons, periods, underscores and hyphens are legal (which
 *  is exactly why delimiter-joined keys collide — R4); Unicode is not. */
export function isValidJournalScopeId(value: string): boolean {
  return SCOPE_ID.test(value);
}

function storedVersion(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const version = (raw as Record<string, unknown>).version;
  return typeof version === "number" && Number.isSafeInteger(version) && version >= 0 ? version : 0;
}

/** Test implementation — instance-scoped, never module-global. */
export class InMemoryApprovedMutationJournalStore implements ApprovedMutationJournalStore {
  private readonly documents = new Map<string, unknown>();
  private key(tenantId: string, projectId: string, branchId: string): string {
    return `${tenantId}\0${projectId}\0${branchId}`;
  }
  async load(tenantId: string, projectId: string, branchId: string): Promise<unknown | null> {
    const value = this.documents.get(this.key(tenantId, projectId, branchId));
    return value === undefined ? null : structuredClone(value);
  }
  async saveIf(tenantId: string, projectId: string, branchId: string, document: unknown, expectedVersion: number | null): Promise<boolean> {
    const key = this.key(tenantId, projectId, branchId);
    const current = this.documents.get(key);
    const currentVersion = current === undefined ? null : storedVersion(current);
    if (currentVersion !== expectedVersion) return false;
    this.documents.set(key, structuredClone(document));
    return true;
  }
  /** Test-only backdoor to plant a raw (possibly corrupt) value. */
  unsafeSetRaw(tenantId: string, projectId: string, branchId: string, value: unknown): void {
    this.documents.set(this.key(tenantId, projectId, branchId), structuredClone(value));
  }
}

// [B12.5 §A] `BrowserLocalStorageApprovedMutationJournalStore` is REMOVED.
// Its synchronous read-check-write was not a cross-context CAS (pre-edit
// counterexample R1: both writers claimed success, one write lost) and its
// delimiter-joined key collided distinct valid scopes (R4). The production
// store is `IndexedDbApprovedMutationJournalStore` in
// approved-mutation-journal-idb.ts; the legacy localStorage records it left
// behind are read ONCE by that store's fail-closed migration.

function entryIntegrity(entry: Omit<ApprovedMutationJournalEntry, "integrity">): string {
  return engineeringDigest({ schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, body: entry });
}

// ─── §B strict, total validation ─────────────────────────────────────────────

const ENTRY_STATES: readonly ApprovedMutationJournalState[] = ["prepared", "canonical-committed", "adopted", "receipt-finalized", "poisoned"];
const ENTRY_KEYS = [
  "schema", "identityKey", "proposalId", "clientOperationId", "operationsDigest",
  "tenantId", "projectId", "branchId", "lineageId", "baseHeadMark", "baseSchematicDigest",
  "originRunId", "authorization", "operationCount", "destructive", "preparedAt", "state",
  "committedAt", "transactionId", "revisionBefore", "revisionAfter", "headAfter",
  "schematicDigestAfter", "receipt", "integrity",
] as const;
const DOCUMENT_KEYS = ["schema", "version", "entries"] as const;
const RECEIPT_KEYS = [
  "schema", "receiptId", "proposalId", "operationsDigest", "originRunId", "authorization", "commandId",
  "tenantId", "projectId", "branchId", "lineageId", "headBefore", "headAfter",
  "schematicDigestBefore", "schematicDigestAfter", "transactionId", "operationCount",
  "destructive", "postconditions", "undoReference", "completedAt",
] as const;

/** [B16.0.1 §E] exact-keys, bounded authorization identity {principalId,
 *  membershipRevision} — required on every journal entry AND every persisted
 *  receipt (Tier-1 and replacement alike). */
function isAuthorizationIdentityShaped(value: unknown): value is { principalId: string; membershipRevision: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isExactKeys(record, ["principalId", "membershipRevision"])
    && isBoundedString(record.principalId, 128)
    && isBoundedString(record.membershipRevision, 128);
}

const ENG_DIGEST = /^eng1-[0-9a-f]{8,64}$/;
/** [B14] `prop-` (Tier-1) and `rprop-` (replacement) proposal identities. */
const PROPOSAL_ID = /^(?:r|c)?prop-[0-9a-f]{8,64}$/; // [PR-M, 2026-10-17] + `cprop-`: the component RESOLUTION batch (app/lib/component-resolution/resolution-proposal.ts), the third family sharing this journal
const LINEAGE_ID = /^lin1-[0-9a-f]{8,64}$/;
const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  if (own.length !== keys.length) return false;
  for (const key of keys) if (!own.includes(key)) return false;
  return true;
}

function isHeadMark(value: unknown): value is { headSequence: number; canonicalStateDigest: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const mark = value as Record<string, unknown>;
  return isExactKeys(mark, ["headSequence", "canonicalStateDigest"])
    && typeof mark.headSequence === "number" && Number.isSafeInteger(mark.headSequence) && mark.headSequence >= 0
    && typeof mark.canonicalStateDigest === "string" && ENG_DIGEST.test(mark.canonicalStateDigest);
}

function isBoundedString(value: unknown, max = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isFiniteAt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Structural check of a persisted receipt's SHAPE (closed keys, types,
 *  patterns) — NOT authentication and not the §A linkage. */
function isReceiptShaped(value: unknown): value is ApprovedMutationReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (!isExactKeys(receipt, RECEIPT_KEYS)) return false;
  // [B16.0.1 §E] V2 receipts carry the sealed authorization identity; a
  // LEGACY V1 receipt never validates (membership authority is never
  // backfilled into an old record).
  if (receipt.schema !== "sirkit.approved-agent-mutation-receipt.v2") return false;
  if (typeof receipt.receiptId !== "string" || !/^amr-[0-9a-f]{16,64}$/.test(receipt.receiptId)) return false;
  if (typeof receipt.proposalId !== "string" || !PROPOSAL_ID.test(receipt.proposalId)) return false;
  if (typeof receipt.operationsDigest !== "string" || !ENG_DIGEST.test(receipt.operationsDigest)) return false;
  if (receipt.originRunId !== null && !isBoundedString(receipt.originRunId)) return false;
  if (!isAuthorizationIdentityShaped(receipt.authorization)) return false;
  if (receipt.commandId !== "schematic.edit-tier1-apply") return false;
  for (const key of ["tenantId", "projectId", "branchId"] as const) {
    if (typeof receipt[key] !== "string" || !SCOPE_ID.test(receipt[key] as string)) return false;
  }
  if (typeof receipt.lineageId !== "string" || !LINEAGE_ID.test(receipt.lineageId)) return false;
  if (!isHeadMark(receipt.headBefore) || !isHeadMark(receipt.headAfter)) return false;
  for (const key of ["schematicDigestBefore", "schematicDigestAfter"] as const) {
    if (typeof receipt[key] !== "string" || !ENG_DIGEST.test(receipt[key] as string)) return false;
  }
  if (!isBoundedString(receipt.transactionId)) return false;
  if (typeof receipt.operationCount !== "number" || !Number.isSafeInteger(receipt.operationCount) || receipt.operationCount < 1 || receipt.operationCount > 256) return false;
  if (typeof receipt.destructive !== "boolean") return false;
  if (receipt.postconditions !== "verified") return false;
  const undo = receipt.undoReference;
  if (typeof undo !== "object" || undo === null || Array.isArray(undo)) return false;
  const undoRecord = undo as Record<string, unknown>;
  if (!isExactKeys(undoRecord, ["kind", "transactionId"]) || undoRecord.kind !== "canonical-transaction" || undoRecord.transactionId !== receipt.transactionId) return false;
  if (!isFiniteAt(receipt.completedAt)) return false;
  return true;
}

const REPLACEMENT_RECEIPT_KEYS = [
  ...RECEIPT_KEYS,
  "componentInstanceId", "sourcePartId", "target", "authorityLinkage", "approvalActor",
] as const;
const REPLACEMENT_TARGET_KEYS = ["partId", "manufacturer", "atomicPartRevisionId", "symbolAssetVersionId", "footprintAssetVersionId", "mappingCertificateId"] as const;
const REPLACEMENT_LINKAGE_KEYS = ["operationDigest", "impactDigest", "authorityResourceId", "authorityResourceDigest", "canonicalResourceId", "canonicalResourceDigest", "consumedAuthorityDigest", "mappingCertificateId"] as const;

/** [B14] Structural check of a persisted REPLACEMENT receipt's shape —
 *  the B12 core linkage keys plus the closed replacement identity/authority
 *  linkage. Tier-1 receipts keep their own unchanged check above. */
function isReplacementReceiptShaped(value: unknown): value is ReplacementMutationReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (!isExactKeys(receipt, REPLACEMENT_RECEIPT_KEYS)) return false;
  // [B16.0.1 §E] V2 replacement receipts carry the same sealed authorization
  // identity as Tier-1 receipts; a LEGACY V1 receipt never validates.
  if (receipt.schema !== "sirkit.approved-replacement-receipt.v2") return false;
  if (typeof receipt.receiptId !== "string" || !/^arr-[0-9a-f]{16,64}$/.test(receipt.receiptId)) return false;
  if (typeof receipt.proposalId !== "string" || !/^rprop-[0-9a-f]{8,64}$/.test(receipt.proposalId)) return false;
  if (typeof receipt.operationsDigest !== "string" || !ENG_DIGEST.test(receipt.operationsDigest)) return false;
  if (receipt.originRunId !== null && !isBoundedString(receipt.originRunId)) return false;
  if (!isAuthorizationIdentityShaped(receipt.authorization)) return false;
  if (receipt.commandId !== "schematic.replace-component") return false;
  for (const key of ["tenantId", "projectId", "branchId"] as const) {
    if (typeof receipt[key] !== "string" || !SCOPE_ID.test(receipt[key] as string)) return false;
  }
  if (typeof receipt.lineageId !== "string" || !LINEAGE_ID.test(receipt.lineageId)) return false;
  if (!isHeadMark(receipt.headBefore) || !isHeadMark(receipt.headAfter)) return false;
  for (const key of ["schematicDigestBefore", "schematicDigestAfter"] as const) {
    if (typeof receipt[key] !== "string" || !ENG_DIGEST.test(receipt[key] as string)) return false;
  }
  if (!isBoundedString(receipt.transactionId)) return false;
  if (receipt.operationCount !== 1) return false;
  if (receipt.destructive !== true) return false;
  if (receipt.postconditions !== "verified") return false;
  const undo = receipt.undoReference;
  if (typeof undo !== "object" || undo === null || Array.isArray(undo)) return false;
  const undoRecord = undo as Record<string, unknown>;
  if (!isExactKeys(undoRecord, ["kind", "transactionId"]) || undoRecord.kind !== "canonical-transaction" || undoRecord.transactionId !== receipt.transactionId) return false;
  if (!isFiniteAt(receipt.completedAt)) return false;
  if (!isBoundedString(receipt.componentInstanceId, 200) || !isBoundedString(receipt.sourcePartId, 200)) return false;
  const target = receipt.target;
  if (typeof target !== "object" || target === null || Array.isArray(target)) return false;
  const targetRecord = target as Record<string, unknown>;
  const targetKeys = Object.keys(targetRecord);
  const allowedTarget = [...REPLACEMENT_TARGET_KEYS, "selectionRecordId"];
  if (!targetKeys.every((key) => allowedTarget.includes(key))) return false;
  for (const key of REPLACEMENT_TARGET_KEYS) {
    if (!isBoundedString(targetRecord[key], 512)) return false;
  }
  if (targetRecord.selectionRecordId !== undefined && !isBoundedString(targetRecord.selectionRecordId, 512)) return false;
  const linkage = receipt.authorityLinkage;
  if (typeof linkage !== "object" || linkage === null || Array.isArray(linkage)) return false;
  const linkageRecord = linkage as Record<string, unknown>;
  if (!isExactKeys(linkageRecord, REPLACEMENT_LINKAGE_KEYS)) return false;
  for (const key of REPLACEMENT_LINKAGE_KEYS) {
    if (!isBoundedString(linkageRecord[key], 512)) return false;
  }
  if (receipt.approvalActor !== "human:interactive") return false;
  return true;
}

/** §B — complete capture-first validation of one captured entry against
 *  THIS journal's scope. Returns null for anything malformed — including
 *  checksum-valid malformed records. Total; never throws (input is owned
 *  captured plain JSON). */
function validateEntry(raw: unknown, scope: { tenantId: string; projectId: string; branchId: string }): ApprovedMutationJournalEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  if (!isExactKeys(entry, ENTRY_KEYS)) return null;
  if (entry.schema !== APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA) return null;
  if (typeof entry.identityKey !== "string" || !ENG_DIGEST.test(entry.identityKey)) return null;
  if (typeof entry.proposalId !== "string" || !PROPOSAL_ID.test(entry.proposalId)) return null;
  if (entry.clientOperationId !== entry.proposalId) return null;
  if (typeof entry.operationsDigest !== "string" || !ENG_DIGEST.test(entry.operationsDigest)) return null;
  // Scope coherence: the entry must belong to THIS journal instance.
  if (entry.tenantId !== scope.tenantId || entry.projectId !== scope.projectId || entry.branchId !== scope.branchId) return null;
  if (typeof entry.lineageId !== "string" || !LINEAGE_ID.test(entry.lineageId)) return null;
  if (!isHeadMark(entry.baseHeadMark)) return null;
  if (typeof entry.baseSchematicDigest !== "string" || !ENG_DIGEST.test(entry.baseSchematicDigest)) return null;
  if (entry.originRunId !== null && !isBoundedString(entry.originRunId)) return null;
  // [B16.0.1 §E] the sealed authorization identity is REQUIRED and bounded.
  // A legacy entry lacking it never validates (and is never adopted) —
  // membership authority is never guessed or backfilled into an old record.
  if (typeof entry.authorization !== "object" || entry.authorization === null || Array.isArray(entry.authorization)) return null;
  const entryAuthorization = entry.authorization as Record<string, unknown>;
  if (!isExactKeys(entryAuthorization, ["principalId", "membershipRevision"] as const)) return null;
  if (!isBoundedString(entryAuthorization.principalId, 128) || !isBoundedString(entryAuthorization.membershipRevision, 128)) return null;
  if (typeof entry.operationCount !== "number" || !Number.isSafeInteger(entry.operationCount) || entry.operationCount < 1 || entry.operationCount > 256) return null;
  if (typeof entry.destructive !== "boolean") return null;
  if (!isFiniteAt(entry.preparedAt)) return null;
  if (typeof entry.state !== "string" || !(ENTRY_STATES as readonly string[]).includes(entry.state)) return null;
  if (typeof entry.integrity !== "string") return null;
  const hasCommitted = entry.committedAt !== null || entry.transactionId !== null || entry.headAfter !== null || entry.schematicDigestAfter !== null || entry.revisionBefore !== null || entry.revisionAfter !== null;
  const committedComplete = isFiniteAt(entry.committedAt)
    && isBoundedString(entry.transactionId)
    && isHeadMark(entry.headAfter)
    && typeof entry.schematicDigestAfter === "string" && ENG_DIGEST.test(entry.schematicDigestAfter)
    && (entry.revisionBefore === null || (typeof entry.revisionBefore === "string" && ENG_DIGEST.test(entry.revisionBefore)))
    && (entry.revisionAfter === null || (typeof entry.revisionAfter === "string" && ENG_DIGEST.test(entry.revisionAfter)));
  // State-dependent invariants.
  switch (entry.state) {
    case "prepared":
      if (hasCommitted || entry.receipt !== null) return null;
      break;
    case "canonical-committed":
    case "adopted":
      if (!committedComplete || entry.receipt !== null) return null;
      break;
    case "receipt-finalized": {
      if (!committedComplete || entry.receipt === null || (!isReceiptShaped(entry.receipt) && !isReplacementReceiptShaped(entry.receipt) && !isResolutionReceiptShaped(entry.receipt))) return null; // [PR-M, 2026-10-17] + the resolution receipt (its shape check is appended at the end of this file)
      const receipt = entry.receipt as ApprovedMutationReceipt;
      // The persisted receipt must be COHERENT with its own entry.
      if (receipt.proposalId !== entry.proposalId || receipt.operationsDigest !== entry.operationsDigest) return null;
      if (receipt.tenantId !== entry.tenantId || receipt.projectId !== entry.projectId || receipt.branchId !== entry.branchId || receipt.lineageId !== entry.lineageId) return null;
      if (receipt.transactionId !== entry.transactionId) return null;
      if (canonicalJson(receipt.headBefore) !== canonicalJson(entry.baseHeadMark)) return null;
      if (canonicalJson(receipt.headAfter) !== canonicalJson(entry.headAfter)) return null;
      if (receipt.schematicDigestBefore !== entry.baseSchematicDigest || receipt.schematicDigestAfter !== entry.schematicDigestAfter) return null;
      if (receipt.operationCount !== entry.operationCount || receipt.destructive !== entry.destructive) return null;
      if (receipt.originRunId !== entry.originRunId || receipt.completedAt !== entry.committedAt) return null;
      // [B16.0.1 §E] the persisted receipt's authorization identity must
      // deep-equal the entry's own — one durable identity, never divergent
      // copies of principal/membership revision.
      if (canonicalJson(receipt.authorization) !== canonicalJson(entry.authorization)) return null;
      break;
    }
    case "poisoned":
      // Explicit fail-closed marker; whatever committed identity was known
      // is PRESERVED (either nothing, or the complete committed inputs).
      if (hasCommitted && !committedComplete) return null;
      if (entry.receipt !== null) return null;
      break;
  }
  // Consistency checksum LAST (it is not authentication).
  const body = { ...entry } as Record<string, unknown>;
  delete body.integrity;
  if (entryIntegrity(body as unknown as Omit<ApprovedMutationJournalEntry, "integrity">) !== entry.integrity) return null;
  return entry as unknown as ApprovedMutationJournalEntry;
}

/**
 * [B12.5 §A/§B] Classification of a LEGACY (pre-B12.5 localStorage)
 * journal document during migration. The legacy key encoding collided
 * distinct scopes (R4), so the key can never select authority — only the
 * validated CONTENT scope of the entries can:
 *
 *  - `owned`   — strictly valid under the B12.4 validator and every entry
 *                belongs to the REQUESTING scope: safe to import once.
 *  - `foreign` — strictly valid but the entries belong to a different
 *                scope (a collision victim's journal): the requesting
 *                scope treats it as ABSENT and must not read, import,
 *                overwrite, or delete it.
 *  - `absent`  — a valid document with no entries: nothing to import and
 *                no owner to determine; left untouched.
 *  - `corrupt` — malformed, checksum-broken, duplicated-identity, or
 *                MIXED-scope (ambiguous authority): fail closed — never
 *                imported, never deleted; surfaces as `recovery-required`.
 */
export type LegacyJournalClassification =
  | { kind: "owned"; document: { schema: typeof APPROVED_MUTATION_JOURNAL_SCHEMA; version: number; entries: ApprovedMutationJournalEntry[] } }
  | { kind: "foreign" }
  | { kind: "absent" }
  | { kind: "corrupt" };

export function classifyLegacyJournalDocument(
  raw: unknown,
  scope: { tenantId: string; projectId: string; branchId: string },
): LegacyJournalClassification {
  const captured = capturePlainJson(raw, "legacy-journal", MAX_SERIALIZED);
  if (!captured.ok) return { kind: "corrupt" };
  const value = captured.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "corrupt" };
  const record = value as Record<string, unknown>;
  const allowed = new Set<string>(DOCUMENT_KEYS);
  if (!Object.keys(record).every((key) => allowed.has(key)) || record.schema !== APPROVED_MUTATION_JOURNAL_SCHEMA || !Array.isArray(record.entries)) {
    return { kind: "corrupt" };
  }
  const version = record.version === undefined ? 0 : record.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return { kind: "corrupt" };
  const rawEntries = record.entries as unknown[];
  if (rawEntries.length === 0) return { kind: "absent" };
  const entries: ApprovedMutationJournalEntry[] = [];
  const identities = new Set<string>();
  let owned = 0;
  let foreign = 0;
  for (const rawEntry of rawEntries) {
    // Validate each entry against ITS OWN embedded scope first — a legacy
    // record must be internally sound before its ownership means anything.
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) return { kind: "corrupt" };
    const candidate = rawEntry as Record<string, unknown>;
    const entryScope = { tenantId: candidate.tenantId, projectId: candidate.projectId, branchId: candidate.branchId };
    if (typeof entryScope.tenantId !== "string" || typeof entryScope.projectId !== "string" || typeof entryScope.branchId !== "string") return { kind: "corrupt" };
    const valid = validateEntry(rawEntry, entryScope as { tenantId: string; projectId: string; branchId: string });
    if (!valid) return { kind: "corrupt" };
    if (identities.has(valid.identityKey)) return { kind: "corrupt" };
    identities.add(valid.identityKey);
    if (valid.tenantId === scope.tenantId && valid.projectId === scope.projectId && valid.branchId === scope.branchId) {
      owned += 1;
      entries.push(structuredClone(valid) as ApprovedMutationJournalEntry);
    } else {
      foreign += 1;
    }
  }
  // Mixed ownership is ambiguous — the collision-prone key cannot say
  // whose journal this was, so nobody gets to claim it.
  if (owned > 0 && foreign > 0) return { kind: "corrupt" };
  if (owned === 0) return { kind: "foreign" };
  return { kind: "owned", document: { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version, entries } };
}

export type JournalLookup =
  | { kind: "absent" }
  | { kind: "entry"; entry: ApprovedMutationJournalEntry }
  | { kind: "corrupt" }
  | { kind: "unavailable" };

export type JournalWrite =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "corrupt" | "absent" | "conflict" | "invalid-transition" };

/** Fields that no transition (and no re-prepare) may ever change.
 *  [B16.0.1 §E] `authorization` is immutable too: a re-prepare under another
 *  principal/membership revision is a `conflict`, never a silent adoption. */
const IMMUTABLE_KEYS = [
  "schema", "identityKey", "proposalId", "clientOperationId", "operationsDigest",
  "tenantId", "projectId", "branchId", "lineageId", "baseHeadMark",
  "baseSchematicDigest", "originRunId", "authorization", "operationCount", "destructive",
] as const;

function immutableFieldsEqual(a: ApprovedMutationJournalEntry, b: Record<string, unknown>): boolean {
  for (const key of IMMUTABLE_KEYS) {
    if (canonicalJson((a as unknown as Record<string, unknown>)[key]) !== canonicalJson(b[key])) return false;
  }
  return true;
}

/**
 * The per-project journal boundary (§B strict + §C monotonic + CAS).
 * Loads are capture-first and strictly validated per entry against THIS
 * instance's scope; a malformed or foreign-scope entry surfaces as
 * `corrupt` for its identity. Writes are CAS-versioned read-modify-write
 * with bounded optimistic retries and never throw.
 */
export class ApprovedMutationJournal {
  constructor(
    private readonly store: ApprovedMutationJournalStore,
    private readonly scope: { tenantId: string; projectId: string; branchId: string },
  ) {}

  private async loadDocument(): Promise<
    | { kind: "ok"; document: JournalDocument; loadedVersion: number | null; corruptIdentities: Set<string>; documentCorrupt: boolean }
    | { kind: "unavailable" }
  > {
    let raw: unknown | null;
    try {
      raw = await this.store.load(this.scope.tenantId, this.scope.projectId, this.scope.branchId);
    } catch {
      return { kind: "unavailable" };
    }
    if (raw === null) return { kind: "ok", document: { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: 0, entries: [] }, loadedVersion: null, corruptIdentities: new Set(), documentCorrupt: false };
    const empty = (documentCorrupt: boolean, loadedVersion: number | null): { kind: "ok"; document: JournalDocument; loadedVersion: number | null; corruptIdentities: Set<string>; documentCorrupt: boolean } =>
      ({ kind: "ok", document: { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: 0, entries: [] }, loadedVersion, corruptIdentities: new Set(), documentCorrupt });
    const captured = capturePlainJson(raw, "journal", MAX_SERIALIZED);
    if (!captured.ok) return empty(true, storedVersion(raw));
    const value = captured.value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return empty(true, null);
    const record = value as Record<string, unknown>;
    // §B — exact closed document keys ({schema, version, entries};
    // `version` may be absent on pre-B12.4 documents and reads as 0).
    const documentKeys = Object.keys(record);
    const allowed = new Set<string>(DOCUMENT_KEYS);
    if (!documentKeys.every((key) => allowed.has(key)) || record.schema !== APPROVED_MUTATION_JOURNAL_SCHEMA || !Array.isArray(record.entries)) {
      return empty(true, storedVersion(raw));
    }
    const version = record.version === undefined ? 0 : record.version;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return empty(true, null);
    const entries: ApprovedMutationJournalEntry[] = [];
    const corruptIdentities = new Set<string>();
    const seenIdentities = new Set<string>();
    for (const rawEntry of (record.entries as unknown[])) {
      const valid = validateEntry(rawEntry, this.scope);
      if (valid && !seenIdentities.has(valid.identityKey)) {
        seenIdentities.add(valid.identityKey);
        entries.push(structuredClone(valid) as ApprovedMutationJournalEntry);
      } else if (valid) {
        // Duplicate identity: keep the first, flag the identity.
        corruptIdentities.add(valid.identityKey);
      } else {
        const identity = typeof (rawEntry as Record<string, unknown> | null)?.["identityKey"] === "string"
          ? (rawEntry as Record<string, string>).identityKey : "";
        if (identity) corruptIdentities.add(identity);
      }
    }
    return { kind: "ok", document: { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version, entries }, loadedVersion: version, corruptIdentities, documentCorrupt: false };
  }

  /** CAS write with bounded optimistic retries. `mutate` runs against the
   *  freshly loaded document on every attempt and may refuse. */
  private async write(identityKey: string, mutate: (document: JournalDocument) => JournalWrite): Promise<JournalWrite> {
    for (let attempt = 0; attempt <= CAS_RETRIES; attempt += 1) {
      const loaded = await this.loadDocument();
      if (loaded.kind === "unavailable") return { ok: false, reason: "unavailable" };
      if (loaded.documentCorrupt || loaded.corruptIdentities.has(identityKey)) return { ok: false, reason: "corrupt" };
      const document: JournalDocument = { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: (loaded.loadedVersion ?? 0) + 1, entries: loaded.document.entries };
      const outcome = mutate(document);
      if (!outcome.ok) return outcome;
      try {
        const saved = await this.store.saveIf(this.scope.tenantId, this.scope.projectId, this.scope.branchId, document, loaded.loadedVersion);
        if (saved) return { ok: true };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      // Version conflict — another composition wrote first; retry against
      // its state (monotonic rules re-checked each attempt).
    }
    return { ok: false, reason: "conflict" };
  }

  async lookup(identityKey: string): Promise<JournalLookup> {
    const loaded = await this.loadDocument();
    if (loaded.kind === "unavailable") return { kind: "unavailable" };
    if (loaded.documentCorrupt || loaded.corruptIdentities.has(identityKey)) return { kind: "corrupt" };
    const entry = loaded.document.entries.find((candidate) => candidate.identityKey === identityKey);
    return entry ? { kind: "entry", entry: structuredClone(entry) } : { kind: "absent" };
  }

  /** §C — create the PREPARED record (durable BEFORE the canonical commit
   *  begins). Idempotent against an IDENTICAL prepared entry; `conflict`
   *  against a differing prepared entry; `invalid-transition` against any
   *  later state (never a downgrade, never an erasure). */
  async prepare(input: Omit<ApprovedMutationJournalEntry, "schema" | "state" | "committedAt" | "transactionId" | "revisionBefore" | "revisionAfter" | "headAfter" | "schematicDigestAfter" | "receipt" | "integrity" | "clientOperationId"> & { clientOperationId?: string }): Promise<JournalWrite> {
    const body: Omit<ApprovedMutationJournalEntry, "integrity"> = {
      schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA,
      identityKey: input.identityKey,
      proposalId: input.proposalId,
      clientOperationId: input.clientOperationId ?? input.proposalId,
      operationsDigest: input.operationsDigest,
      tenantId: input.tenantId,
      projectId: input.projectId,
      branchId: input.branchId,
      lineageId: input.lineageId,
      baseHeadMark: { ...input.baseHeadMark },
      baseSchematicDigest: input.baseSchematicDigest,
      originRunId: input.originRunId,
      authorization: { principalId: input.authorization.principalId, membershipRevision: input.authorization.membershipRevision },
      operationCount: input.operationCount,
      destructive: input.destructive,
      preparedAt: input.preparedAt,
      state: "prepared",
      committedAt: null, transactionId: null, revisionBefore: null, revisionAfter: null,
      headAfter: null, schematicDigestAfter: null, receipt: null,
    };
    return this.write(input.identityKey, (document) => {
      const index = document.entries.findIndex((candidate) => candidate.identityKey === input.identityKey);
      if (index >= 0) {
        const existing = document.entries[index]!;
        if (existing.state !== "prepared") return { ok: false, reason: "invalid-transition" };
        if (!immutableFieldsEqual(existing, body as unknown as Record<string, unknown>)) return { ok: false, reason: "conflict" };
        return { ok: true }; // idempotent no-op — the existing prepared entry stands
      }
      while (document.entries.length >= MAX_ENTRIES) document.entries.shift();
      document.entries.push({ ...body, integrity: entryIntegrity(body) });
      return { ok: true };
    });
  }

  private transition(
    identityKey: string,
    allowedFrom: readonly ApprovedMutationJournalState[],
    idempotentIn: ApprovedMutationJournalState | null,
    mutate: (entry: ApprovedMutationJournalEntry) => Omit<ApprovedMutationJournalEntry, "integrity"> | { refused: "conflict" },
  ): Promise<JournalWrite> {
    return this.write(identityKey, (document) => {
      const index = document.entries.findIndex((candidate) => candidate.identityKey === identityKey);
      if (index < 0) return { ok: false, reason: "absent" };
      const existing = document.entries[index]!;
      if (idempotentIn !== null && existing.state === idempotentIn) {
        const result = mutate(existing);
        if ("refused" in result) return { ok: false, reason: result.refused };
        // Idempotent only when the resulting body is identical.
        const bodyExisting = { ...existing } as Record<string, unknown>;
        delete bodyExisting.integrity;
        if (canonicalJson(result) === canonicalJson(bodyExisting)) return { ok: true };
        return { ok: false, reason: "conflict" };
      }
      if (!allowedFrom.includes(existing.state)) return { ok: false, reason: "invalid-transition" };
      const result = mutate(existing);
      if ("refused" in result) return { ok: false, reason: result.refused };
      if (!immutableFieldsEqual(existing, result as unknown as Record<string, unknown>)) return { ok: false, reason: "conflict" };
      document.entries[index] = { ...result, integrity: entryIntegrity(result) };
      return { ok: true };
    });
  }

  /** prepared → canonical-committed (idempotent when identical). */
  async markCommitted(identityKey: string, data: { committedAt: number; transactionId: string; revisionBefore: string | null; revisionAfter: string | null; headAfter: { headSequence: number; canonicalStateDigest: string }; schematicDigestAfter: string }): Promise<JournalWrite> {
    return this.transition(identityKey, ["prepared"], "canonical-committed", (entry) => {
      const body = { ...entry } as Record<string, unknown>;
      delete body.integrity;
      return { ...(body as unknown as Omit<ApprovedMutationJournalEntry, "integrity">), state: "canonical-committed", committedAt: data.committedAt, transactionId: data.transactionId, revisionBefore: data.revisionBefore, revisionAfter: data.revisionAfter, headAfter: { ...data.headAfter }, schematicDigestAfter: data.schematicDigestAfter };
    });
  }

  /** canonical-committed → adopted (idempotent in adopted). */
  async markAdopted(identityKey: string): Promise<JournalWrite> {
    return this.transition(identityKey, ["canonical-committed"], "adopted", (entry) => {
      const body = { ...entry } as Record<string, unknown>;
      delete body.integrity;
      return { ...(body as unknown as Omit<ApprovedMutationJournalEntry, "integrity">), state: "adopted" };
    });
  }

  /** canonical-committed | adopted → receipt-finalized. An already
   *  finalized entry accepts only the IDENTICAL receipt (idempotent); a
   *  different receipt is a `conflict` — the authoritative finalized
   *  receipt can never be replaced. */
  async finalizeReceipt(identityKey: string, receipt: ApprovedMutationReceipt | ReplacementMutationReceipt): Promise<JournalWrite> {
    return this.transition(identityKey, ["canonical-committed", "adopted"], "receipt-finalized", (entry) => {
      const body = { ...entry } as Record<string, unknown>;
      delete body.integrity;
      return { ...(body as unknown as Omit<ApprovedMutationJournalEntry, "integrity">), state: "receipt-finalized", receipt: structuredClone(receipt) as ApprovedMutationReceipt | ReplacementMutationReceipt };
    });
  }

  /** prepared | canonical-committed | adopted → poisoned (idempotent in
   *  poisoned; a FINALIZED entry can never be poisoned). Committed
   *  identity fields are preserved — poisoning never erases the known
   *  canonical transaction. */
  async poison(identityKey: string): Promise<JournalWrite> {
    return this.transition(identityKey, ["prepared", "canonical-committed", "adopted"], "poisoned", (entry) => {
      const body = { ...entry } as Record<string, unknown>;
      delete body.integrity;
      return { ...(body as unknown as Omit<ApprovedMutationJournalEntry, "integrity">), state: "poisoned", receipt: null };
    });
  }
}

// ─── [PR-M, 2026-10-17] the component RESOLUTION receipt (section M.2.5), appended so no cited line above moves ─────────────
const RESOLUTION_RECEIPT_KEYS = [...RECEIPT_KEYS, "items", "authorityLinkage", "approvalActor"] as const;
const RESOLUTION_TARGET_KEYS = ["catalogPartId", "valueKey", "exactMpn", "manufacturer", "atomicPartRevisionId", "symbolAssetVersionId", "footprintAssetVersionId", "mappingCertificateId", "footprintFullName", "evidenceDigest"] as const;
const RESOLUTION_LINKAGE_KEYS = ["operationsDigest", "impactDigest", "connectivityDigest", "authorityResourceId", "authorityResourceDigest", "canonicalResourceId", "canonicalResourceDigest", "consumedAuthorityDigest"] as const;

/** [PR-M] Structural check of a persisted RESOLUTION receipt: the B12 core linkage keys, one item per resolved instance (1-20,
 *  each with its closed target identity; the item count equals the operation count), the closed authority linkage and the human
 *  approval actor. Tier-1 and replacement receipts keep their own checks above. */
function isResolutionReceiptShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (!isExactKeys(receipt, RESOLUTION_RECEIPT_KEYS)) return false;
  if (receipt.schema !== "sirkit.approved-resolution-receipt.v1") return false;
  if (typeof receipt.receiptId !== "string" || !/^acr-[0-9a-f]{16,64}$/.test(receipt.receiptId)) return false;
  if (typeof receipt.proposalId !== "string" || !/^cprop-[0-9a-f]{8,64}$/.test(receipt.proposalId)) return false;
  if (typeof receipt.operationsDigest !== "string" || !ENG_DIGEST.test(receipt.operationsDigest)) return false;
  if (receipt.originRunId !== null && !isBoundedString(receipt.originRunId)) return false;
  if (!isAuthorizationIdentityShaped(receipt.authorization)) return false;
  if (receipt.commandId !== "schematic.resolve-components") return false;
  for (const key of ["tenantId", "projectId", "branchId"] as const) {
    if (typeof receipt[key] !== "string" || !SCOPE_ID.test(receipt[key] as string)) return false;
  }
  if (typeof receipt.lineageId !== "string" || !LINEAGE_ID.test(receipt.lineageId)) return false;
  if (!isHeadMark(receipt.headBefore) || !isHeadMark(receipt.headAfter)) return false;
  for (const key of ["schematicDigestBefore", "schematicDigestAfter"] as const) {
    if (typeof receipt[key] !== "string" || !ENG_DIGEST.test(receipt[key] as string)) return false;
  }
  if (!isBoundedString(receipt.transactionId)) return false;
  if (typeof receipt.operationCount !== "number" || !Number.isSafeInteger(receipt.operationCount) || receipt.operationCount < 1 || receipt.operationCount > 20) return false;
  if (receipt.destructive !== true || receipt.postconditions !== "verified") return false;
  const undo = receipt.undoReference;
  if (typeof undo !== "object" || undo === null || Array.isArray(undo)) return false;
  const undoRecord = undo as Record<string, unknown>;
  if (!isExactKeys(undoRecord, ["kind", "transactionId"]) || undoRecord.kind !== "canonical-transaction" || undoRecord.transactionId !== receipt.transactionId) return false;
  if (!isFiniteAt(receipt.completedAt)) return false;
  if (!Array.isArray(receipt.items) || receipt.items.length !== receipt.operationCount) return false;
  for (const item of receipt.items as unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    if (!isExactKeys(record, ["componentInstanceId", "refDes", "sourcePartId", "target"])) return false;
    if (!isBoundedString(record.componentInstanceId, 200) || !isBoundedString(record.refDes, 64) || !isBoundedString(record.sourcePartId, 200)) return false;
    const target = record.target;
    if (typeof target !== "object" || target === null || Array.isArray(target)) return false;
    const targetRecord = target as Record<string, unknown>;
    if (!isExactKeys(targetRecord, RESOLUTION_TARGET_KEYS)) return false;
    for (const key of RESOLUTION_TARGET_KEYS) if (key !== "valueKey" && !isBoundedString(targetRecord[key], 512)) return false;
    if (typeof targetRecord.valueKey !== "string" || targetRecord.valueKey.length > 64) return false;
  }
  const linkage = receipt.authorityLinkage;
  if (typeof linkage !== "object" || linkage === null || Array.isArray(linkage)) return false;
  const linkageRecord = linkage as Record<string, unknown>;
  if (!isExactKeys(linkageRecord, RESOLUTION_LINKAGE_KEYS)) return false;
  for (const key of RESOLUTION_LINKAGE_KEYS) if (!isBoundedString(linkageRecord[key], 512)) return false;
  return receipt.approvalActor === "human:interactive";
}
