/**
 * [B18-B] The DURABLE agent-execution journal — the browser's prepare-before-
 * consume / consume-before-commit record for a server-minted execution grant.
 *
 * A grant-specific sibling of the B15.3 approved-PCB-mutation journal: the
 * same proven skeleton (CAS-only writes, monotonic states, closed key sets,
 * bounded document, a content-CONSISTENCY checksum that is never
 * authentication) with grant semantics — the entry binds the grant handle,
 * the prepared attempt (nonce → attemptId), the commitment the server
 * consumed under, and the exact base the grant was minted against.
 *
 * States: prepared → grant-consumed → canonical-committed → adopted →
 * receipt-finalized → settled (the server holds the report), or poisoned (a commit that cannot be verified) or
 * abandoned (nothing changed: the consume was refused, or a consumed grant
 * had no canonical evidence when the commit window closed).
 *
 * Authenticated identity comes from the stronger mechanisms at the ritual:
 * the grant is re-derived and byte-compared, the commitment is bound into the
 * canonical transaction's `provenance.candidateId` (a hash-chained ledger),
 * and recovery adopts a commit ONLY when `durableIdempotencyEvidence` proves
 * it landed under this grant id.
 */
import { EXECUTION_RECEIPT_SCHEMA, executionCommitmentFor, parsePublicExecutionGrant, type ExecutionDecisionMode, type ExecutionFamily, type PublicExecutionGrant } from "./execution-grant";
import { engineeringDigest } from "./stable";

export const AGENT_EXECUTION_JOURNAL_SCHEMA = "sirkit.agent-execution-journal.v1" as const;
export const AGENT_EXECUTION_JOURNAL_ENTRY_SCHEMA = "sirkit.agent-execution-journal-entry.v1" as const;
export const EXECUTION_APPROVAL_ACTORS = ["human:confirmed-preview", "server-grant:execute_explicit"] as const;
export type ExecutionApprovalActor = (typeof EXECUTION_APPROVAL_ACTORS)[number];

export type AgentExecutionJournalState = "prepared" | "grant-consumed" | "canonical-committed" | "adopted" | "receipt-finalized" | "settled" | "poisoned" | "abandoned";

export interface ExecutionReceipt {
  schema: typeof EXECUTION_RECEIPT_SCHEMA;
  receiptId: string;
  grantId: string;
  identityKey: string;
  attemptId: string;
  transactionId: string;
  committedAt: number;
  pcbRevisionBefore: string;
  pcbRevisionAfter: string;
  headSequenceAfter: number;
  approvalActor: ExecutionApprovalActor;
  authorization: { principalId: string; membershipRevision: string };
  /** The chain-protected commitment recorded in the canonical transaction's provenance.candidateId. */
  commitment: string;
}

export interface AgentExecutionJournalEntry {
  schema: typeof AGENT_EXECUTION_JOURNAL_ENTRY_SCHEMA;
  identityKey: string;
  grantId: string;
  grantDigest: string;
  attemptNonce: string;
  attemptId: string;
  family: ExecutionFamily;
  decision: ExecutionDecisionMode;
  editor: "pcb";
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
  lineageId: string;
  basePcbRevisionId: string;
  baseBoardDigest: string;
  baseHeadSequence: number;
  validationPolicy: { presetId: string; presetVersion: string; rulesDigest: string };
  authorization: { principalId: string; membershipRevision: string };
  originRunId: string | null;
  operationCount: number;
  operationsDigest: string;
  previewDigest: string;
  /** The bounded public grant, kept for recovery (never the nonce). */
  grant: PublicExecutionGrant;
  preparedAt: number;
  /** Derived from the entry's own fields at prepare; recomputed on every read. */
  commitment: string;
  state: AgentExecutionJournalState;
  consumedAt: number | null;
  committedAt: number | null;
  transactionId: string | null;
  pcbRevisionBefore: string | null;
  pcbRevisionAfter: string | null;
  headSequenceAfter: number | null;
  receipt: ExecutionReceipt | null;
  abandonReason: string | null;
  /** Content-CONSISTENCY checksum (this field excluded) — never authentication. */
  integrity: string;
}

export interface AgentExecutionJournalDocument {
  schema: typeof AGENT_EXECUTION_JOURNAL_SCHEMA;
  version: number;
  entries: AgentExecutionJournalEntry[];
}

export const EXECUTION_JOURNAL_MAX_ENTRIES = 32;
export const EXECUTION_JOURNAL_MAX_SERIALIZED = 262_144;
const CAS_RETRIES = 4;

const ENG_DIGEST = /^eng1-[0-9a-f]{8,64}$/;
const GRANT_ID = /^xg-[0-9a-f]{32}$/;
const ATTEMPT_ID = /^eng1-[0-9a-f]{16}$/;
const NONCE = /^[0-9a-f]{32}$/;
const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PCB_REVISION = /^pcb2-[0-9a-f]{8,128}$/;

const ENTRY_KEYS = [
  "schema", "identityKey", "grantId", "grantDigest", "attemptNonce", "attemptId", "family", "decision", "editor",
  "tenantId", "projectId", "branchId", "boardInstanceId", "lineageId", "basePcbRevisionId", "baseBoardDigest", "baseHeadSequence",
  "validationPolicy", "authorization", "originRunId", "operationCount", "operationsDigest", "previewDigest", "grant",
  "preparedAt", "commitment", "state", "consumedAt", "committedAt", "transactionId", "pcbRevisionBefore", "pcbRevisionAfter",
  "headSequenceAfter", "receipt", "abandonReason", "integrity",
] as const;
const RECEIPT_KEYS = ["schema", "receiptId", "grantId", "identityKey", "attemptId", "transactionId", "committedAt", "pcbRevisionBefore", "pcbRevisionAfter", "headSequenceAfter", "approvalActor", "authorization", "commitment"] as const;
/** Fields that can NEVER change across state transitions. */
const IMMUTABLE_KEYS = [
  "schema", "identityKey", "grantId", "grantDigest", "attemptNonce", "attemptId", "family", "decision", "editor",
  "tenantId", "projectId", "branchId", "boardInstanceId", "lineageId", "basePcbRevisionId", "baseBoardDigest", "baseHeadSequence",
  "validationPolicy", "authorization", "originRunId", "operationCount", "operationsDigest", "previewDigest", "grant", "preparedAt", "commitment",
] as const;

const STATE_ORDER: Record<AgentExecutionJournalState, number> = {
  prepared: 0, "grant-consumed": 1, "canonical-committed": 2, adopted: 3, "receipt-finalized": 4, settled: 5, poisoned: 5, abandoned: 5,
};

function entryIntegrity(entry: Omit<AgentExecutionJournalEntry, "integrity">): string {
  return engineeringDigest({ schema: "sirkit.agent-execution-journal-integrity.v1", body: entry });
}

function isWellFormedAuthorization(candidate: unknown): candidate is { principalId: string; membershipRevision: string } {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 2 && keys.includes("principalId") && keys.includes("membershipRevision")
    && typeof record.principalId === "string" && SCOPE_ID.test(record.principalId)
    && typeof record.membershipRevision === "string" && SCOPE_ID.test(record.membershipRevision);
}

/** The commitment every entry carries — derived from its own prepared fields (§2.2). */
export function journalCommitmentFor(entry: Pick<AgentExecutionJournalEntry, "identityKey" | "grantId" | "attemptId" | "originRunId" | "preparedAt" | "authorization">): string {
  return executionCommitmentFor({ identityKey: entry.identityKey, grantId: entry.grantId, attemptId: entry.attemptId, originRunId: entry.originRunId ?? "", preparedAt: new Date(entry.preparedAt).toISOString(), authorization: entry.authorization });
}

export function buildExecutionReceipt(input: Omit<ExecutionReceipt, "schema" | "receiptId">): ExecutionReceipt {
  const body = { schema: EXECUTION_RECEIPT_SCHEMA, ...input };
  return Object.freeze({ ...body, receiptId: engineeringDigest({ schema: "sirkit.agent-execution-receipt-id.v1", body }) });
}

export function isExecutionReceiptShaped(candidate: unknown): candidate is ExecutionReceipt {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false;
  const receipt = candidate as Record<string, unknown>;
  const keys = Object.keys(receipt);
  if (keys.length !== RECEIPT_KEYS.length || !RECEIPT_KEYS.every((key) => keys.includes(key))) return false;
  return receipt.schema === EXECUTION_RECEIPT_SCHEMA
    && typeof receipt.receiptId === "string" && ENG_DIGEST.test(receipt.receiptId)
    && typeof receipt.grantId === "string" && GRANT_ID.test(receipt.grantId)
    && typeof receipt.identityKey === "string" && ENG_DIGEST.test(receipt.identityKey)
    && typeof receipt.attemptId === "string" && ATTEMPT_ID.test(receipt.attemptId)
    && typeof receipt.transactionId === "string" && receipt.transactionId.length > 0
    && typeof receipt.committedAt === "number" && Number.isSafeInteger(receipt.committedAt) && receipt.committedAt >= 0
    && typeof receipt.pcbRevisionBefore === "string" && PCB_REVISION.test(receipt.pcbRevisionBefore)
    && typeof receipt.pcbRevisionAfter === "string" && PCB_REVISION.test(receipt.pcbRevisionAfter)
    && typeof receipt.headSequenceAfter === "number" && Number.isSafeInteger(receipt.headSequenceAfter) && receipt.headSequenceAfter >= 0
    && (EXECUTION_APPROVAL_ACTORS as readonly string[]).includes(receipt.approvalActor as string)
    && isWellFormedAuthorization(receipt.authorization)
    && typeof receipt.commitment === "string" && ENG_DIGEST.test(receipt.commitment);
}

export function executionJournalDocumentVersion(document: unknown): number | null {
  if (typeof document !== "object" || document === null) return null;
  const version = (document as Record<string, unknown>).version;
  return typeof version === "number" && Number.isSafeInteger(version) ? version : null;
}

export function isValidExecutionJournalScopeId(value: string): boolean {
  return SCOPE_ID.test(value);
}

/** Atomic compare-and-swap store — a false return means NOTHING was written. Unavailability THROWS. */
export interface AgentExecutionJournalStore {
  load(tenantId: string, projectId: string, branchId: string, editor: string): Promise<unknown | null>;
  saveIf(tenantId: string, projectId: string, branchId: string, editor: string, document: unknown, expectedVersion: number | null): Promise<boolean>;
}

export class InMemoryAgentExecutionJournalStore implements AgentExecutionJournalStore {
  private readonly documents = new Map<string, unknown>();
  private key(tenantId: string, projectId: string, branchId: string, editor: string): string { return JSON.stringify([tenantId, projectId, branchId, editor]); }
  async load(tenantId: string, projectId: string, branchId: string, editor: string): Promise<unknown | null> {
    const stored = this.documents.get(this.key(tenantId, projectId, branchId, editor));
    return stored === undefined ? null : structuredClone(stored);
  }
  async saveIf(tenantId: string, projectId: string, branchId: string, editor: string, document: unknown, expectedVersion: number | null): Promise<boolean> {
    const key = this.key(tenantId, projectId, branchId, editor);
    const stored = this.documents.get(key);
    const currentVersion = stored === undefined ? null : executionJournalDocumentVersion(stored);
    if (currentVersion !== expectedVersion) return false;
    if (JSON.stringify(document).length > EXECUTION_JOURNAL_MAX_SERIALIZED) throw new Error("EXECUTION_JOURNAL_DOCUMENT_TOO_LARGE");
    this.documents.set(key, structuredClone(document));
    return true;
  }
  /** TEST-ONLY: plant a raw (possibly forged/corrupt) document. */
  unsafeSetRaw(tenantId: string, projectId: string, branchId: string, editor: string, document: unknown): void {
    this.documents.set(this.key(tenantId, projectId, branchId, editor), structuredClone(document));
  }
}

export type ExecutionJournalLookup =
  | { kind: "absent" }
  | { kind: "entry"; entry: AgentExecutionJournalEntry }
  | { kind: "corrupt"; detail: string }
  | { kind: "unavailable" };

export type ExecutionJournalWrite =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "corrupt" | "absent" | "conflict" | "invalid-transition" | "invalid-entry" };

export interface ExecutionJournalScope { tenantId: string; projectId: string; branchId: string; boardInstanceId: string; editor: "pcb" }

export type ExecutionJournalPrepareInput = Omit<AgentExecutionJournalEntry, "schema" | "commitment" | "state" | "consumedAt" | "committedAt" | "transactionId" | "pcbRevisionBefore" | "pcbRevisionAfter" | "headSequenceAfter" | "receipt" | "abandonReason" | "integrity">;

export class AgentExecutionJournal {
  constructor(private readonly store: AgentExecutionJournalStore, private readonly scope: ExecutionJournalScope) {}

  private validateEntry(entry: unknown): string | null {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return "ENTRY_NOT_OBJECT";
    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== ENTRY_KEYS.length || !(ENTRY_KEYS as readonly string[]).every((key) => keys.includes(key))) return "ENTRY_KEYS_INVALID";
    if (record.schema !== AGENT_EXECUTION_JOURNAL_ENTRY_SCHEMA) return "ENTRY_SCHEMA_INVALID";
    if (typeof record.identityKey !== "string" || !ENG_DIGEST.test(record.identityKey)) return "IDENTITY_KEY_INVALID";
    if (typeof record.grantId !== "string" || !GRANT_ID.test(record.grantId)) return "GRANT_ID_INVALID";
    if (typeof record.grantDigest !== "string" || !ENG_DIGEST.test(record.grantDigest)) return "GRANT_DIGEST_INVALID";
    if (typeof record.attemptNonce !== "string" || !NONCE.test(record.attemptNonce)) return "ATTEMPT_NONCE_INVALID";
    if (typeof record.attemptId !== "string" || !ATTEMPT_ID.test(record.attemptId)) return "ATTEMPT_ID_INVALID";
    if (typeof record.family !== "string" || !SCOPE_ID.test(record.family)) return "FAMILY_INVALID";
    if (record.decision !== "execute_explicit" && record.decision !== "preview_then_confirm") return "DECISION_INVALID";
    if (record.editor !== this.scope.editor) return "EDITOR_INVALID";
    for (const key of ["tenantId", "projectId", "branchId", "boardInstanceId", "lineageId"] as const) {
      if (typeof record[key] !== "string" || !SCOPE_ID.test(record[key] as string)) return `${key.toUpperCase()}_INVALID`;
    }
    if (record.tenantId !== this.scope.tenantId || record.projectId !== this.scope.projectId || record.branchId !== this.scope.branchId || record.boardInstanceId !== this.scope.boardInstanceId) return "ENTRY_SCOPE_FOREIGN";
    if (typeof record.basePcbRevisionId !== "string" || !PCB_REVISION.test(record.basePcbRevisionId)) return "BASE_REVISION_INVALID";
    if (typeof record.baseBoardDigest !== "string" || !ENG_DIGEST.test(record.baseBoardDigest)) return "BASE_BOARD_DIGEST_INVALID";
    if (typeof record.baseHeadSequence !== "number" || !Number.isSafeInteger(record.baseHeadSequence) || record.baseHeadSequence < 0) return "BASE_HEAD_SEQUENCE_INVALID";
    const policy = record.validationPolicy as Record<string, unknown>;
    if (typeof policy !== "object" || policy === null || Object.keys(policy).length !== 3
      || typeof policy.presetId !== "string" || !SCOPE_ID.test(policy.presetId)
      || typeof policy.presetVersion !== "string" || policy.presetVersion.length === 0 || policy.presetVersion.length > 32
      || typeof policy.rulesDigest !== "string" || !ENG_DIGEST.test(policy.rulesDigest)) return "VALIDATION_POLICY_INVALID";
    if (!isWellFormedAuthorization(record.authorization)) return "AUTHORIZATION_INVALID";
    if (record.originRunId !== null && (typeof record.originRunId !== "string" || record.originRunId.length > 128)) return "ORIGIN_RUN_INVALID";
    if (typeof record.operationCount !== "number" || !Number.isInteger(record.operationCount) || record.operationCount < 1 || record.operationCount > 16) return "OPERATION_COUNT_INVALID";
    if (typeof record.operationsDigest !== "string" || !ENG_DIGEST.test(record.operationsDigest)) return "OPERATIONS_DIGEST_INVALID";
    if (typeof record.previewDigest !== "string" || !ENG_DIGEST.test(record.previewDigest)) return "PREVIEW_DIGEST_INVALID";
    const grant = parsePublicExecutionGrant(record.grant);
    if (!grant || grant.grantId !== record.grantId || grant.grantDigest !== record.grantDigest || grant.binding.proposal.operationsDigest !== record.operationsDigest || grant.binding.proposal.previewDigest !== record.previewDigest) return "GRANT_INVALID";
    if (typeof record.preparedAt !== "number" || !Number.isSafeInteger(record.preparedAt) || record.preparedAt < 0) return "PREPARED_AT_INVALID";
    const typed = record as unknown as AgentExecutionJournalEntry;
    if (typeof record.commitment !== "string" || journalCommitmentFor(typed) !== record.commitment) return "COMMITMENT_INVALID";
    const state = record.state as AgentExecutionJournalState;
    if (!(state in STATE_ORDER)) return "STATE_INVALID";
    if (record.consumedAt !== null && (typeof record.consumedAt !== "number" || !Number.isSafeInteger(record.consumedAt))) return "CONSUMED_AT_INVALID";
    if (state === "prepared" && record.consumedAt !== null) return "PREPARED_CARRIES_CONSUME";
    if ((state === "grant-consumed" || state === "canonical-committed" || state === "adopted" || state === "receipt-finalized" || state === "settled") && record.consumedAt === null) return "CONSUME_FIELDS_MISSING";
    const hasCommit = record.committedAt !== null || record.transactionId !== null || record.pcbRevisionBefore !== null || record.pcbRevisionAfter !== null || record.headSequenceAfter !== null;
    const completeCommit = typeof record.committedAt === "number" && Number.isSafeInteger(record.committedAt)
      && typeof record.transactionId === "string" && record.transactionId.length > 0
      && typeof record.pcbRevisionBefore === "string" && PCB_REVISION.test(record.pcbRevisionBefore)
      && typeof record.pcbRevisionAfter === "string" && PCB_REVISION.test(record.pcbRevisionAfter)
      && typeof record.headSequenceAfter === "number" && Number.isSafeInteger(record.headSequenceAfter);
    if ((state === "prepared" || state === "grant-consumed" || state === "abandoned") && (hasCommit || record.receipt !== null)) return "PRE_COMMIT_CARRIES_COMMIT_FIELDS";
    if ((state === "canonical-committed" || state === "adopted") && (!completeCommit || record.receipt !== null)) return "COMMITTED_FIELDS_INCOMPLETE";
    if (state === "receipt-finalized" || state === "settled") {
      if (!completeCommit) return "COMMITTED_FIELDS_INCOMPLETE";
      if (!isExecutionReceiptShaped(record.receipt)) return "RECEIPT_MALFORMED";
      const receipt = record.receipt;
      if (receipt.grantId !== record.grantId || receipt.identityKey !== record.identityKey || receipt.attemptId !== record.attemptId
        || receipt.transactionId !== record.transactionId || receipt.committedAt !== record.committedAt
        || receipt.pcbRevisionBefore !== record.pcbRevisionBefore || receipt.pcbRevisionAfter !== record.pcbRevisionAfter || receipt.headSequenceAfter !== record.headSequenceAfter
        || receipt.commitment !== record.commitment
        || receipt.authorization.principalId !== typed.authorization.principalId || receipt.authorization.membershipRevision !== typed.authorization.membershipRevision
        || receipt.approvalActor !== (record.decision === "execute_explicit" ? "server-grant:execute_explicit" : "human:confirmed-preview")) return "RECEIPT_ENTRY_MISMATCH";
    }
    if (state === "poisoned" && record.receipt !== null) return "POISONED_CARRIES_RECEIPT";
    if (state === "abandoned" ? (typeof record.abandonReason !== "string" || record.abandonReason.length === 0 || record.abandonReason.length > 120) : record.abandonReason !== null) return "ABANDON_REASON_INVALID";
    const { integrity, ...body } = typed;
    if (typeof integrity !== "string" || entryIntegrity(body) !== integrity) return "ENTRY_CHECKSUM_MISMATCH";
    return null;
  }

  private validateDocument(document: unknown): string | null {
    if (typeof document !== "object" || document === null) return "DOCUMENT_NOT_OBJECT";
    const doc = document as Record<string, unknown>;
    if (doc.schema !== AGENT_EXECUTION_JOURNAL_SCHEMA) return "DOCUMENT_SCHEMA_INVALID";
    if (typeof doc.version !== "number" || !Number.isSafeInteger(doc.version)) return "DOCUMENT_VERSION_INVALID";
    if (!Array.isArray(doc.entries) || doc.entries.length > EXECUTION_JOURNAL_MAX_ENTRIES) return "DOCUMENT_ENTRIES_INVALID";
    const seen = new Set<string>();
    const grants = new Set<string>();
    for (const entry of doc.entries) {
      const issue = this.validateEntry(entry);
      if (issue) return issue;
      const typed = entry as AgentExecutionJournalEntry;
      if (seen.has(typed.identityKey) || grants.has(typed.grantId)) return "DUPLICATE_IDENTITY_KEY";
      seen.add(typed.identityKey);
      grants.add(typed.grantId);
    }
    return null;
  }

  private seal(candidate: Omit<AgentExecutionJournalEntry, "integrity"> & { integrity?: string }): AgentExecutionJournalEntry {
    // A transition re-seals a COPY of the current entry: the stale checksum must never ride inside the new body.
    const { integrity: _stale, ...body } = candidate;
    void _stale;
    return { ...body, integrity: entryIntegrity(body) };
  }

  private async loadDocument(): Promise<{ kind: "ok"; document: AgentExecutionJournalDocument | null } | { kind: "unavailable" } | { kind: "corrupt"; detail: string }> {
    let stored: unknown;
    try { stored = await this.store.load(this.scope.tenantId, this.scope.projectId, this.scope.branchId, this.scope.editor); } catch { return { kind: "unavailable" }; }
    if (stored === null) return { kind: "ok", document: null };
    const issue = this.validateDocument(stored);
    if (issue) return { kind: "corrupt", detail: issue };
    return { kind: "ok", document: stored as AgentExecutionJournalDocument };
  }

  async lookup(identityKey: string): Promise<ExecutionJournalLookup> {
    const loaded = await this.loadDocument();
    if (loaded.kind !== "ok") return loaded;
    const entry = loaded.document?.entries.find((candidate) => candidate.identityKey === identityKey);
    return entry ? { kind: "entry", entry: structuredClone(entry) } : { kind: "absent" };
  }

  async lookupByGrant(grantId: string): Promise<ExecutionJournalLookup> {
    const loaded = await this.loadDocument();
    if (loaded.kind !== "ok") return loaded;
    const entry = loaded.document?.entries.find((candidate) => candidate.grantId === grantId);
    return entry ? { kind: "entry", entry: structuredClone(entry) } : { kind: "absent" };
  }

  /** Every non-terminal entry (the recovery sweep's work list), oldest first. */
  async pending(): Promise<{ ok: true; entries: AgentExecutionJournalEntry[] } | { ok: false; reason: "unavailable" | "corrupt" }> {
    const loaded = await this.loadDocument();
    if (loaded.kind === "unavailable") return { ok: false, reason: "unavailable" };
    if (loaded.kind === "corrupt") return { ok: false, reason: "corrupt" };
    const entries = (loaded.document?.entries ?? []).filter((entry) => STATE_ORDER[entry.state] < 5).map((entry) => structuredClone(entry));
    return { ok: true, entries };
  }

  private async write(mutate: (entries: AgentExecutionJournalEntry[]) => ExecutionJournalWrite | AgentExecutionJournalEntry[]): Promise<ExecutionJournalWrite> {
    for (let attempt = 0; attempt < CAS_RETRIES; attempt += 1) {
      let stored: unknown;
      try { stored = await this.store.load(this.scope.tenantId, this.scope.projectId, this.scope.branchId, this.scope.editor); } catch { return { ok: false, reason: "unavailable" }; }
      let expectedVersion: number | null = null;
      let document: AgentExecutionJournalDocument;
      if (stored === null) {
        document = { schema: AGENT_EXECUTION_JOURNAL_SCHEMA, version: 1, entries: [] };
      } else {
        const issue = this.validateDocument(stored);
        if (issue) return { ok: false, reason: "corrupt" };
        expectedVersion = executionJournalDocumentVersion(stored);
        document = structuredClone(stored) as AgentExecutionJournalDocument;
        document.version = (expectedVersion ?? 0) + 1;
      }
      const outcome = mutate(document.entries);
      if (!Array.isArray(outcome)) return outcome;
      document.entries = outcome;
      // Bounded: terminal entries age out first, then the oldest.
      while (document.entries.length > EXECUTION_JOURNAL_MAX_ENTRIES) {
        const terminal = document.entries.findIndex((entry) => STATE_ORDER[entry.state] >= 5);
        document.entries.splice(terminal >= 0 ? terminal : 0, 1);
      }
      let saved: boolean;
      try { saved = await this.store.saveIf(this.scope.tenantId, this.scope.projectId, this.scope.branchId, this.scope.editor, document, expectedVersion); } catch { return { ok: false, reason: "unavailable" }; }
      if (saved) return { ok: true };
    }
    return { ok: false, reason: "conflict" };
  }

  private transition(identityKey: string, from: readonly AgentExecutionJournalState[], apply: (entry: AgentExecutionJournalEntry) => Omit<AgentExecutionJournalEntry, "integrity"> | "idempotent"): Promise<ExecutionJournalWrite> {
    return this.write((entries) => {
      const index = entries.findIndex((entry) => entry.identityKey === identityKey);
      if (index < 0) return { ok: false, reason: "absent" };
      const current = entries[index]!;
      const applied = apply(current);
      if (applied === "idempotent") return { ok: true };
      if (!from.includes(current.state)) return { ok: false, reason: "invalid-transition" };
      for (const key of IMMUTABLE_KEYS) {
        if (JSON.stringify(applied[key]) !== JSON.stringify(current[key])) return { ok: false, reason: "invalid-transition" };
      }
      const next = this.seal(applied);
      if (this.validateEntry(next)) return { ok: false, reason: "invalid-entry" };
      return [...entries.slice(0, index), next, ...entries.slice(index + 1)];
    });
  }

  async prepare(input: ExecutionJournalPrepareInput): Promise<ExecutionJournalWrite> {
    const body: Omit<AgentExecutionJournalEntry, "integrity"> = {
      schema: AGENT_EXECUTION_JOURNAL_ENTRY_SCHEMA, ...structuredClone(input),
      commitment: journalCommitmentFor(input),
      state: "prepared", consumedAt: null, committedAt: null, transactionId: null, pcbRevisionBefore: null, pcbRevisionAfter: null, headSequenceAfter: null, receipt: null, abandonReason: null,
    };
    const entry = this.seal(body);
    if (this.validateEntry(entry)) return { ok: false, reason: "invalid-entry" };
    return this.write((entries) => {
      if (entries.some((existing) => existing.identityKey === entry.identityKey || existing.grantId === entry.grantId)) return { ok: false, reason: "conflict" };
      return [...entries, entry];
    });
  }

  markConsumed(identityKey: string, input: { consumedAt: number }): Promise<ExecutionJournalWrite> {
    return this.transition(identityKey, ["prepared"], (entry) => (entry.state === "grant-consumed" ? "idempotent" : { ...entry, state: "grant-consumed", consumedAt: input.consumedAt }));
  }

  markCommitted(identityKey: string, input: { committedAt: number; transactionId: string; pcbRevisionBefore: string; pcbRevisionAfter: string; headSequenceAfter: number }): Promise<ExecutionJournalWrite> {
    return this.transition(identityKey, ["grant-consumed"], (entry) => (entry.state === "canonical-committed" && entry.transactionId === input.transactionId ? "idempotent" : { ...entry, state: "canonical-committed", ...input }));
  }

  markAdopted(identityKey: string): Promise<ExecutionJournalWrite> {
    return this.transition(identityKey, ["canonical-committed"], (entry) => (entry.state === "adopted" ? "idempotent" : { ...entry, state: "adopted" }));
  }

  finalizeReceipt(identityKey: string, receipt: ExecutionReceipt): Promise<ExecutionJournalWrite> {
    return this.transition(identityKey, ["adopted"], (entry) => (entry.state === "receipt-finalized" && entry.receipt?.receiptId === receipt.receiptId ? "idempotent" : { ...entry, state: "receipt-finalized", receipt: structuredClone(receipt) }));
  }

  /** The server holds the settlement report: the entry leaves the recovery sweep. */
  markSettled(identityKey: string): Promise<ExecutionJournalWrite> {
    return this.transition(identityKey, ["receipt-finalized"], (entry) => (entry.state === "settled" ? "idempotent" : { ...entry, state: "settled" }));
  }

  poison(identityKey: string): Promise<ExecutionJournalWrite> {
    return this.transition(identityKey, ["prepared", "grant-consumed", "canonical-committed", "adopted"], (entry) => (entry.state === "poisoned" ? "idempotent" : { ...entry, state: "poisoned", receipt: null }));
  }

  abandon(identityKey: string, reason: string): Promise<ExecutionJournalWrite> {
    return this.transition(identityKey, ["prepared", "grant-consumed"], (entry) => (entry.state === "abandoned" ? "idempotent" : { ...entry, state: "abandoned", abandonReason: reason.slice(0, 120) }));
  }
}
