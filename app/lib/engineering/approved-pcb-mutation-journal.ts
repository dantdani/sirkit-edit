/**
 * B15.3 §J — the DURABLE approved-PCB-mutation journal.
 *
 * A PCB-SPECIFIC sibling of the B12 `approved-mutation-journal` — it shares
 * the proven skeleton (CAS-only writes, prepare-before-commit states,
 * monotonic transitions, closed key sets, bounded document) but NEVER
 * overloads a schematic journal field with a PCB meaning: the base is the
 * PCB semantic revision + board digest + board instance + PCB history head +
 * lineage + sealed validation policy, and the receipt is a PCB receipt.
 *
 * INTEGRITY MODEL (same as B12, documented honestly): the `integrity` field
 * is a content-CONSISTENCY checksum, NOT authentication — anything this
 * module can compute, a forger can compute. Authenticated identity comes
 * from three stronger mechanisms at the apply boundary:
 *   1. `identityKey` is digested over the COMPLETE sealed proposal body
 *      only after independent seal verification;
 *   2. the receipt commitment is bound into the canonical transaction's
 *      `provenance.candidateId`, and the canonical transaction log is a
 *      hash-chained durable ledger (`validatePersistenceEnvelope`);
 *   3. recovery adopts a commit ONLY when the canonical durable history
 *      proves the transaction landed (`durableIdempotencyEvidence`).
 * A journal entry claiming a commit the canonical history cannot prove is
 * refused as forged/recovery-required — never adopted.
 */

import { engineeringDigest } from "./stable";

export const APPROVED_PCB_MUTATION_JOURNAL_SCHEMA = "sirkit.approved-pcb-mutation-journal.v1" as const;
export const APPROVED_PCB_MUTATION_JOURNAL_ENTRY_SCHEMA = "sirkit.approved-pcb-mutation-journal-entry.v1" as const;
/** [B16.0.1 §E] .v1 → .v2: the receipt now carries the REQUIRED
 *  `authorization` identity (verified principal + membership revision). A
 *  legacy v1 receipt (or a legacy entry without `authorization`) NEVER
 *  validates — it fails closed by design; membership authority is never
 *  backfilled into old artifacts. */
export const PCB_MUTATION_RECEIPT_SCHEMA = "sirkit.approved-pcb-mutation-receipt.v2" as const;
export const PCB_APPROVAL_ACTOR = "human:interactive" as const;

export type ApprovedPcbMutationJournalState =
  | "prepared"
  | "canonical-committed"
  | "adopted"
  | "receipt-finalized"
  | "poisoned";

/** The PCB receipt — validated as one closed shape. */
export interface PcbMutationReceipt {
  schema: typeof PCB_MUTATION_RECEIPT_SCHEMA;
  receiptId: string;
  proposalId: string;
  identityKey: string;
  transactionId: string;
  committedAt: number;
  /** PCB semantic revisions (pcb2-…), before and after the ONE transaction. */
  pcbRevisionBefore: string;
  pcbRevisionAfter: string;
  headSequenceAfter: number;
  /** Earned by consuming the one-shot human approval — never stamped. */
  approvalActor: typeof PCB_APPROVAL_ACTOR;
  /** [B16.0.1 §E] the authorization identity the proposal was sealed under —
   *  the verified principal and the membership revision the apply role was
   *  resolved at. Covered by the receipt COMMITMENT digest, so a receipt
   *  minted under another principal/revision can never be adopted. */
  authorization: { principalId: string; membershipRevision: string };
  /** The chain-protected commitment recorded in the canonical transaction's
   *  provenance.candidateId — the durable linkage anchor. */
  commitment: string;
}

export interface ApprovedPcbMutationJournalEntry {
  schema: typeof APPROVED_PCB_MUTATION_JOURNAL_ENTRY_SCHEMA;
  /** Digest over the COMPLETE verified sealed proposal body. */
  identityKey: string;
  proposalId: string;
  operationsDigest: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
  lineageId: string;
  basePcbRevisionId: string;
  baseBoardDigest: string;
  baseHeadSequence: number;
  validationPolicy: { presetId: string; presetVersion: number; rulesDigest: string };
  /** [B16.0.1 §E] REQUIRED authorization identity from the proposal's sealed
   *  binding. A legacy entry lacking it NEVER validates (fail closed by
   *  design — documented, not "fixed"). */
  authorization: { principalId: string; membershipRevision: string };
  originRunId: string | null;
  operationCount: number;
  preparedAt: number;
  state: ApprovedPcbMutationJournalState;
  committedAt: number | null;
  transactionId: string | null;
  pcbRevisionBefore: string | null;
  pcbRevisionAfter: string | null;
  headSequenceAfter: number | null;
  receipt: PcbMutationReceipt | null;
  /** Content-CONSISTENCY checksum over the entry (this field excluded). A
   *  checksum, NOT authentication — see the module header. */
  integrity: string;
}

export interface ApprovedPcbMutationJournalDocument {
  schema: typeof APPROVED_PCB_MUTATION_JOURNAL_SCHEMA;
  version: number;
  entries: ApprovedPcbMutationJournalEntry[];
}

export const PCB_JOURNAL_MAX_ENTRIES = 64;
export const PCB_JOURNAL_MAX_SERIALIZED = 262_144;
const CAS_RETRIES = 4;

const ENG_DIGEST = /^eng1-[0-9a-f]{8,64}$/;
const PROPOSAL_ID = /^pprop-[0-9a-f]{8,64}$/;
const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PCB_REVISION = /^pcb2-[0-9a-f]{8,128}$/;

const ENTRY_KEYS = [
  "schema", "identityKey", "proposalId", "operationsDigest",
  "tenantId", "projectId", "branchId", "boardInstanceId", "lineageId",
  "basePcbRevisionId", "baseBoardDigest", "baseHeadSequence",
  "validationPolicy", "authorization", "originRunId", "operationCount", "preparedAt", "state",
  "committedAt", "transactionId", "pcbRevisionBefore", "pcbRevisionAfter",
  "headSequenceAfter", "receipt", "integrity",
] as const;

const RECEIPT_KEYS = [
  "schema", "receiptId", "proposalId", "identityKey", "transactionId",
  "committedAt", "pcbRevisionBefore", "pcbRevisionAfter", "headSequenceAfter",
  "approvalActor", "authorization", "commitment",
] as const;

/** Fields that can NEVER change across state transitions. */
const IMMUTABLE_KEYS = [
  "schema", "identityKey", "proposalId", "operationsDigest",
  "tenantId", "projectId", "branchId", "boardInstanceId", "lineageId",
  "basePcbRevisionId", "baseBoardDigest", "baseHeadSequence",
  "validationPolicy", "authorization", "originRunId", "operationCount", "preparedAt",
] as const;

const STATE_ORDER: Record<ApprovedPcbMutationJournalState, number> = {
  prepared: 0, "canonical-committed": 1, adopted: 2, "receipt-finalized": 3, poisoned: 3,
};

function entryIntegrity(entry: Omit<ApprovedPcbMutationJournalEntry, "integrity">): string {
  return engineeringDigest({ schema: "sirkit.approved-pcb-mutation-journal-integrity.v1", body: entry });
}

/** [B16.0.1 §E] exact-keys, bounded (≤128 chars each) authorization identity. */
function isWellFormedAuthorization(candidate: unknown): candidate is { principalId: string; membershipRevision: string } {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 2 && keys.includes("principalId") && keys.includes("membershipRevision")
    && typeof record.principalId === "string" && SCOPE_ID.test(record.principalId)
    && typeof record.membershipRevision === "string" && SCOPE_ID.test(record.membershipRevision);
}

export function buildPcbMutationReceipt(input: Omit<PcbMutationReceipt, "schema" | "receiptId">): PcbMutationReceipt {
  const body = { schema: PCB_MUTATION_RECEIPT_SCHEMA, ...input };
  const receipt: PcbMutationReceipt = Object.freeze({
    ...body,
    receiptId: engineeringDigest({ schema: "sirkit.approved-pcb-mutation-receipt-id.v1", body }),
  });
  return receipt;
}

export function isPcbReceiptShaped(candidate: unknown): candidate is PcbMutationReceipt {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false;
  const receipt = candidate as Record<string, unknown>;
  const keys = Object.keys(receipt);
  if (keys.length !== RECEIPT_KEYS.length || !RECEIPT_KEYS.every((key) => keys.includes(key))) return false;
  return receipt.schema === PCB_MUTATION_RECEIPT_SCHEMA
    && typeof receipt.receiptId === "string" && ENG_DIGEST.test(receipt.receiptId as string)
    && typeof receipt.proposalId === "string" && PROPOSAL_ID.test(receipt.proposalId as string)
    && typeof receipt.identityKey === "string" && ENG_DIGEST.test(receipt.identityKey as string)
    && typeof receipt.transactionId === "string" && (receipt.transactionId as string).length > 0
    && typeof receipt.committedAt === "number" && Number.isSafeInteger(receipt.committedAt) && (receipt.committedAt as number) >= 0
    && typeof receipt.pcbRevisionBefore === "string" && PCB_REVISION.test(receipt.pcbRevisionBefore as string)
    && typeof receipt.pcbRevisionAfter === "string" && PCB_REVISION.test(receipt.pcbRevisionAfter as string)
    && typeof receipt.headSequenceAfter === "number" && Number.isSafeInteger(receipt.headSequenceAfter) && (receipt.headSequenceAfter as number) >= 0
    && receipt.approvalActor === PCB_APPROVAL_ACTOR
    // [B16.0.1 §E] the authorization identity is REQUIRED and exact-shaped.
    && isWellFormedAuthorization(receipt.authorization)
    && typeof receipt.commitment === "string" && ENG_DIGEST.test(receipt.commitment as string);
}

/** The version rides INSIDE the document (same convention as the B12
 *  journal): the store compares it atomically before writing. */
export function pcbJournalDocumentVersion(document: unknown): number | null {
  if (typeof document !== "object" || document === null) return null;
  const version = (document as Record<string, unknown>).version;
  return typeof version === "number" && Number.isSafeInteger(version) ? version : null;
}

export function isValidPcbJournalScopeId(value: string): boolean {
  return SCOPE_ID.test(value);
}

/** Atomic compare-and-swap store — a false return means NOTHING was written.
 *  Deliberately no unconditional save. Unavailability THROWS. */
export interface ApprovedPcbMutationJournalStore {
  load(tenantId: string, projectId: string, branchId: string): Promise<unknown | null>;
  saveIf(tenantId: string, projectId: string, branchId: string, document: unknown, expectedVersion: number | null): Promise<boolean>;
}

export class InMemoryApprovedPcbMutationJournalStore implements ApprovedPcbMutationJournalStore {
  private readonly documents = new Map<string, unknown>();
  private key(tenantId: string, projectId: string, branchId: string): string {
    return JSON.stringify([tenantId, projectId, branchId]);
  }
  async load(tenantId: string, projectId: string, branchId: string): Promise<unknown | null> {
    const stored = this.documents.get(this.key(tenantId, projectId, branchId));
    return stored === undefined ? null : structuredClone(stored);
  }
  async saveIf(tenantId: string, projectId: string, branchId: string, document: unknown, expectedVersion: number | null): Promise<boolean> {
    const key = this.key(tenantId, projectId, branchId);
    const stored = this.documents.get(key);
    const currentVersion = stored === undefined ? null : pcbJournalDocumentVersion(stored);
    if (currentVersion !== expectedVersion) return false;
    if (JSON.stringify(document).length > PCB_JOURNAL_MAX_SERIALIZED) throw new Error("PCB_JOURNAL_DOCUMENT_TOO_LARGE");
    this.documents.set(key, structuredClone(document));
    return true;
  }
  /** TEST-ONLY: plant a raw (possibly forged/corrupt) document. */
  unsafeSetRaw(tenantId: string, projectId: string, branchId: string, document: unknown): void {
    this.documents.set(this.key(tenantId, projectId, branchId), structuredClone(document));
  }
}

export type PcbJournalLookup =
  | { kind: "absent" }
  | { kind: "entry"; entry: ApprovedPcbMutationJournalEntry }
  | { kind: "corrupt"; detail: string }
  | { kind: "unavailable" };

export type PcbJournalWrite =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "corrupt" | "absent" | "conflict" | "invalid-transition" };

export interface PcbJournalScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
}

export class ApprovedPcbMutationJournal {
  constructor(
    private readonly store: ApprovedPcbMutationJournalStore,
    private readonly scope: PcbJournalScope,
  ) {}

  private validateEntry(entry: unknown): string | null {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return "ENTRY_NOT_OBJECT";
    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== ENTRY_KEYS.length || !(ENTRY_KEYS as readonly string[]).every((key) => keys.includes(key))) return "ENTRY_KEYS_INVALID";
    if (record.schema !== APPROVED_PCB_MUTATION_JOURNAL_ENTRY_SCHEMA) return "ENTRY_SCHEMA_INVALID";
    if (typeof record.identityKey !== "string" || !ENG_DIGEST.test(record.identityKey)) return "IDENTITY_KEY_INVALID";
    if (typeof record.proposalId !== "string" || !PROPOSAL_ID.test(record.proposalId)) return "PROPOSAL_ID_INVALID";
    if (typeof record.operationsDigest !== "string" || !ENG_DIGEST.test(record.operationsDigest)) return "OPERATIONS_DIGEST_INVALID";
    for (const key of ["tenantId", "projectId", "branchId", "boardInstanceId", "lineageId"] as const) {
      if (typeof record[key] !== "string" || !SCOPE_ID.test(record[key] as string)) return `${key.toUpperCase()}_INVALID`;
    }
    // Scope coherence: entries for a foreign scope are corrupt in THIS journal.
    if (record.tenantId !== this.scope.tenantId || record.projectId !== this.scope.projectId
      || record.branchId !== this.scope.branchId || record.boardInstanceId !== this.scope.boardInstanceId) {
      return "ENTRY_SCOPE_FOREIGN";
    }
    if (typeof record.basePcbRevisionId !== "string" || !PCB_REVISION.test(record.basePcbRevisionId)) return "BASE_REVISION_INVALID";
    if (typeof record.baseBoardDigest !== "string" || !PCB_REVISION.test(record.baseBoardDigest)) return "BASE_BOARD_DIGEST_INVALID";
    if (typeof record.baseHeadSequence !== "number" || !Number.isSafeInteger(record.baseHeadSequence) || record.baseHeadSequence < 0) return "BASE_HEAD_SEQUENCE_INVALID";
    const policy = record.validationPolicy as Record<string, unknown>;
    if (typeof policy !== "object" || policy === null || Object.keys(policy).length !== 3
      || typeof policy.presetId !== "string" || !SCOPE_ID.test(policy.presetId as string)
      || typeof policy.presetVersion !== "number" || !Number.isSafeInteger(policy.presetVersion)
      || typeof policy.rulesDigest !== "string" || !ENG_DIGEST.test(policy.rulesDigest as string)) {
      return "VALIDATION_POLICY_INVALID";
    }
    // [B16.0.1 §E] the authorization identity is REQUIRED — a legacy entry
    // without it fails closed here (and at the exact key set above).
    if (!isWellFormedAuthorization(record.authorization)) return "AUTHORIZATION_INVALID";
    if (record.originRunId !== null && (typeof record.originRunId !== "string" || (record.originRunId as string).length > 128)) return "ORIGIN_RUN_INVALID";
    if (typeof record.operationCount !== "number" || !Number.isInteger(record.operationCount) || record.operationCount < 1 || record.operationCount > 16) return "OPERATION_COUNT_INVALID";
    if (typeof record.preparedAt !== "number" || !Number.isSafeInteger(record.preparedAt) || record.preparedAt < 0) return "PREPARED_AT_INVALID";
    const state = record.state as ApprovedPcbMutationJournalState;
    if (!(state in STATE_ORDER)) return "STATE_INVALID";
    const hasCommit = record.committedAt !== null || record.transactionId !== null
      || record.pcbRevisionBefore !== null || record.pcbRevisionAfter !== null || record.headSequenceAfter !== null;
    const completeCommit = typeof record.committedAt === "number" && Number.isSafeInteger(record.committedAt)
      && typeof record.transactionId === "string" && (record.transactionId as string).length > 0
      && typeof record.pcbRevisionBefore === "string" && PCB_REVISION.test(record.pcbRevisionBefore as string)
      && typeof record.pcbRevisionAfter === "string" && PCB_REVISION.test(record.pcbRevisionAfter as string)
      && typeof record.headSequenceAfter === "number" && Number.isSafeInteger(record.headSequenceAfter);
    if (state === "prepared" && (hasCommit || record.receipt !== null)) return "PREPARED_CARRIES_COMMIT_FIELDS";
    if ((state === "canonical-committed" || state === "adopted") && (!completeCommit || record.receipt !== null)) return "COMMITTED_FIELDS_INCOMPLETE";
    if (state === "receipt-finalized") {
      if (!completeCommit) return "COMMITTED_FIELDS_INCOMPLETE";
      if (!isPcbReceiptShaped(record.receipt)) return "RECEIPT_MALFORMED";
      const receipt = record.receipt as PcbMutationReceipt;
      const entryAuthorization = record.authorization as { principalId: string; membershipRevision: string };
      if (receipt.proposalId !== record.proposalId || receipt.identityKey !== record.identityKey
        || receipt.transactionId !== record.transactionId || receipt.committedAt !== record.committedAt
        || receipt.pcbRevisionBefore !== record.pcbRevisionBefore || receipt.pcbRevisionAfter !== record.pcbRevisionAfter
        || receipt.headSequenceAfter !== record.headSequenceAfter
        // [B16.0.1 §E] a receipt under another principal/membership revision
        // can never finalize this entry.
        || receipt.authorization.principalId !== entryAuthorization.principalId
        || receipt.authorization.membershipRevision !== entryAuthorization.membershipRevision) {
        return "RECEIPT_ENTRY_MISMATCH";
      }
    }
    if (state === "poisoned" && record.receipt !== null) return "POISONED_CARRIES_RECEIPT";
    // Checksum LAST — a consistency check, never authentication.
    const { integrity, ...body } = record as unknown as ApprovedPcbMutationJournalEntry;
    if (typeof integrity !== "string" || entryIntegrity(body) !== integrity) return "ENTRY_CHECKSUM_MISMATCH";
    return null;
  }

  private validateDocument(document: unknown): string | null {
    if (typeof document !== "object" || document === null) return "DOCUMENT_NOT_OBJECT";
    const doc = document as Record<string, unknown>;
    if (doc.schema !== APPROVED_PCB_MUTATION_JOURNAL_SCHEMA) return "DOCUMENT_SCHEMA_INVALID";
    if (typeof doc.version !== "number" || !Number.isSafeInteger(doc.version)) return "DOCUMENT_VERSION_INVALID";
    if (!Array.isArray(doc.entries) || doc.entries.length > PCB_JOURNAL_MAX_ENTRIES) return "DOCUMENT_ENTRIES_INVALID";
    const seen = new Set<string>();
    for (const entry of doc.entries) {
      const issue = this.validateEntry(entry);
      if (issue) return issue;
      const key = (entry as ApprovedPcbMutationJournalEntry).identityKey;
      if (seen.has(key)) return "DUPLICATE_IDENTITY_KEY";
      seen.add(key);
    }
    return null;
  }

  private seal(body: Omit<ApprovedPcbMutationJournalEntry, "integrity">): ApprovedPcbMutationJournalEntry {
    return { ...body, integrity: entryIntegrity(body) };
  }

  async lookup(identityKey: string): Promise<PcbJournalLookup> {
    let stored: unknown;
    try {
      stored = await this.store.load(this.scope.tenantId, this.scope.projectId, this.scope.branchId);
    } catch {
      return { kind: "unavailable" };
    }
    if (stored === null) return { kind: "absent" };
    const issue = this.validateDocument(stored);
    if (issue) return { kind: "corrupt", detail: issue };
    const document = stored as ApprovedPcbMutationJournalDocument;
    const entry = document.entries.find((candidate) => candidate.identityKey === identityKey);
    return entry ? { kind: "entry", entry: structuredClone(entry) } : { kind: "absent" };
  }

  private async write(mutate: (entries: ApprovedPcbMutationJournalEntry[]) => PcbJournalWrite | ApprovedPcbMutationJournalEntry[]): Promise<PcbJournalWrite> {
    for (let attempt = 0; attempt < CAS_RETRIES; attempt += 1) {
      let stored: unknown;
      try {
        stored = await this.store.load(this.scope.tenantId, this.scope.projectId, this.scope.branchId);
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      let expectedVersion: number | null = null;
      let document: ApprovedPcbMutationJournalDocument;
      if (stored === null) {
        document = { schema: APPROVED_PCB_MUTATION_JOURNAL_SCHEMA, version: 1, entries: [] };
      } else {
        const issue = this.validateDocument(stored);
        if (issue) return { ok: false, reason: "corrupt" };
        expectedVersion = pcbJournalDocumentVersion(stored);
        document = structuredClone(stored) as ApprovedPcbMutationJournalDocument;
        document.version = (expectedVersion ?? 0) + 1;
      }
      const outcome = mutate(document.entries);
      if (!Array.isArray(outcome)) return outcome;
      document.entries = outcome;
      while (document.entries.length > PCB_JOURNAL_MAX_ENTRIES) document.entries.shift();
      let saved: boolean;
      try {
        saved = await this.store.saveIf(this.scope.tenantId, this.scope.projectId, this.scope.branchId, document, expectedVersion);
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      if (saved) return { ok: true };
    }
    return { ok: false, reason: "conflict" };
  }

  async prepare(input: Omit<ApprovedPcbMutationJournalEntry, "schema" | "state" | "committedAt" | "transactionId" | "pcbRevisionBefore" | "pcbRevisionAfter" | "headSequenceAfter" | "receipt" | "integrity">): Promise<PcbJournalWrite> {
    const entry = this.seal({
      schema: APPROVED_PCB_MUTATION_JOURNAL_ENTRY_SCHEMA,
      ...input,
      state: "prepared",
      committedAt: null, transactionId: null,
      pcbRevisionBefore: null, pcbRevisionAfter: null, headSequenceAfter: null,
      receipt: null,
    });
    const issue = this.validateEntry(entry);
    if (issue) return { ok: false, reason: "corrupt" };
    return this.write((entries) => {
      const existing = entries.find((candidate) => candidate.identityKey === entry.identityKey);
      if (existing) {
        if (existing.state !== "prepared") return { ok: false, reason: "invalid-transition" };
        const { integrity: a, ...existingBody } = existing;
        const { integrity: b, ...entryBody } = entry;
        void a; void b;
        return JSON.stringify(existingBody) === JSON.stringify(entryBody)
          ? entries // idempotent identical prepare
          : { ok: false, reason: "conflict" };
      }
      return [...entries, entry];
    });
  }

  private transition(
    identityKey: string,
    from: ApprovedPcbMutationJournalState[],
    apply: (entry: ApprovedPcbMutationJournalEntry) => Omit<ApprovedPcbMutationJournalEntry, "integrity">,
  ): Promise<PcbJournalWrite> {
    return this.write((entries) => {
      const index = entries.findIndex((candidate) => candidate.identityKey === identityKey);
      if (index < 0) return { ok: false, reason: "absent" };
      const existing = entries[index]!;
      if (!from.includes(existing.state)) return { ok: false, reason: "invalid-transition" };
      const next = this.seal(apply(existing));
      for (const key of IMMUTABLE_KEYS) {
        if (JSON.stringify(next[key]) !== JSON.stringify(existing[key])) return { ok: false, reason: "conflict" };
      }
      if (STATE_ORDER[next.state] < STATE_ORDER[existing.state]) return { ok: false, reason: "invalid-transition" };
      const issue = this.validateEntry(next);
      if (issue) return { ok: false, reason: "corrupt" };
      const copy = [...entries];
      copy[index] = next;
      return copy;
    });
  }

  markCommitted(identityKey: string, commit: { committedAt: number; transactionId: string; pcbRevisionBefore: string; pcbRevisionAfter: string; headSequenceAfter: number }): Promise<PcbJournalWrite> {
    return this.transition(identityKey, ["prepared"], (entry) => {
      const { integrity, ...body } = entry;
      void integrity;
      return { ...body, state: "canonical-committed", ...commit, receipt: null };
    });
  }

  markAdopted(identityKey: string): Promise<PcbJournalWrite> {
    return this.transition(identityKey, ["canonical-committed"], (entry) => {
      const { integrity, ...body } = entry;
      void integrity;
      return { ...body, state: "adopted" };
    });
  }

  finalizeReceipt(identityKey: string, receipt: PcbMutationReceipt): Promise<PcbJournalWrite> {
    return this.write((entries) => {
      const index = entries.findIndex((candidate) => candidate.identityKey === identityKey);
      if (index < 0) return { ok: false, reason: "absent" };
      const existing = entries[index]!;
      if (existing.state === "receipt-finalized") {
        // A DIFFERENT receipt can never replace a finalized one.
        return JSON.stringify(existing.receipt) === JSON.stringify(receipt) ? entries : { ok: false, reason: "conflict" };
      }
      if (existing.state !== "adopted") return { ok: false, reason: "invalid-transition" };
      const { integrity, ...body } = existing;
      void integrity;
      const next = this.seal({ ...body, state: "receipt-finalized", receipt: structuredClone(receipt) });
      const issue = this.validateEntry(next);
      if (issue) return { ok: false, reason: "corrupt" };
      const copy = [...entries];
      copy[index] = next;
      return copy;
    });
  }

  /** Poison preserves committed identity but voids the receipt; NEVER from
   *  `receipt-finalized` (a finalized receipt is immutable evidence). */
  poison(identityKey: string): Promise<PcbJournalWrite> {
    return this.transition(identityKey, ["prepared", "canonical-committed", "adopted"], (entry) => {
      const { integrity, ...body } = entry;
      void integrity;
      return { ...body, state: "poisoned", receipt: null };
    });
  }
}
