/**
 * B06/B06.1/B06.2 — canonical schematic editor session.
 *
 * The schematic sibling of the B03 `CanonicalEditorSession`: it binds the
 * page-level schematic editor to the ONE canonical executor. Every migrated
 * schematic mutation executes as a canonical transaction (expected-revision
 * conflict detection, authorization + capability checks, atomic commit or
 * rollback, deterministic revision advancement, idempotent retry, durable
 * record with an exact inverse), and the resulting canonical state is
 * projected back into the UI `SchematicState` — one user action → one
 * transaction → one `SchematicHistory` entry.
 *
 * B06.2 — explicit session lifecycle:
 *
 *     unopened → hydrating → ready
 *                    ↘ conflicted (explicit recovery choice required)
 *                    ↘ unavailable (durable storage cannot open)
 *
 *  - Canonical mutations are STRUCTURALLY REJECTED unless the session is
 *    `ready` — a command issued during hydration gets a truthful
 *    "schematic history is loading" outcome and can never rebase, mutate,
 *    or overwrite anything.
 *  - When canonical recovery wins over a stale projection, the session does
 *    NOT become ready until the UI proves adoption via the
 *    `confirmAdoption(state)` handshake; the stale projection digest is
 *    remembered and permanently refused (`stale_revision`) so a pre-recovery
 *    click can never rebase the canonical store backward.
 *  - `dispose()` (project switching) invalidates every queued command and
 *    pending callback of the previous session.
 *  - `headMark()` is null unless `ready`, so autosave can never pair a stale
 *    projection with an adopted-looking canonical mark.
 *
 * B06.2 — durable storage is REQUIRED, never silently substituted:
 *
 *  - In-memory persistence exists only via explicit test injection
 *    (`options.store`). Production construction resolves the IndexedDB
 *    store; if IndexedDB is absent or cannot open, the session enters
 *    `unavailable`, mutations are disabled, and the UI shows a truthful
 *    durability error — no false "edits still work".
 *  - A corrupt durable envelope is NEVER overwritten automatically: the
 *    session enters `conflicted`, both sides stay intact, and only the
 *    explicit `recoverStartFresh()` action quarantines the raw corrupt
 *    value (recoverable) before starting a replacement lineage.
 *  - Every automatic lineage rebase quarantines the prior envelope first.
 *
 * B06.2 — projection reconciliation uses the validated decision table in
 * `schematic-projection.ts`: marks are structurally validated and verified
 * against the durable envelope's actual head/log positions; a fabricated or
 * foreign-lineage mark cannot overwrite the canonical head, and impossible
 * orderings preserve BOTH sides as an explicit conflict.
 *
 * Undo/redo stay snapshot-synchronous for the UI; the session reconciles the
 * canonical lineage through the VERIFIED replay contract (`executeUndoRedo`)
 * keyed by restored-state digests — caller-forged replay is impossible
 * (B03.1), and divergence deterministically rebases instead of guessing.
 * Undo links are in-memory: after a reload the canonical head resumes
 * exactly, and undo of pre-reload transactions falls back to the rebase rule
 * (documented in artifacts/ai-control-plane-b06-1/schematic-durability-contract.md).
 *
 * Trusted-composition note (B03.2 boundary): this module is an approved
 * importer of the interactive-channel composition module. No provider, chat,
 * MCP, or agent surface can reach this session.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { createEmptyBoard } from "../pcb/types";
import { ACTION_COVERAGE_REGISTRY } from "./action-registry";
import { BrowserIndexedDbProjectStore } from "./browser-indexeddb-store";
import { CanonicalExecutor, deriveExecutorLineageId, type ExecutionRejectionCode } from "./executor";
import { createEditorSessionChannel } from "./interactive-channel.internal";
import { createPersistenceEnvelope, validatePersistenceEnvelope, type AtomicProjectStore } from "./persistence";
import { computeProjectRevision } from "./revision";
import { fromCanonicalSchematic, parseCanonicalSchematic, schematicStateDigest, toCanonicalSchematic, validateSchematicStateIntegrity, type CanonicalSchematic } from "./schematic-model";
import { decideProjectionReconciliation, envelopeLineage, envelopeSequenceDigests, validateSchematicCanonicalMark, type SchematicCanonicalMark } from "./schematic-projection";
import { engineeringDigest } from "./stable";
import { EngineeringTransactionService } from "./transaction-service";
import type { CanonicalProjectState, EngineeringActor, EngineeringOperation, ProjectPersistenceEnvelope } from "./types";

export type { SchematicCanonicalMark } from "./schematic-projection";

export interface SchematicSessionIdentity {
  tenantId: string;
  projectId: string;
  branchId: string;
}

export interface SchematicSessionOptions {
  buildId?: string;
  /** EXPLICIT test injection. Production never selects in-memory storage. */
  store?: AtomicProjectStore;
}

export type SchematicSessionLifecycle = "unopened" | "hydrating" | "ready" | "conflicted" | "unavailable";

/** [B12.3 §D] Read-only durable idempotency evidence for one
 *  clientOperationId — captured, owned, bounded metadata only. */
export type DurableIdempotencyEvidence =
  | { kind: "unavailable" }
  | { kind: "absent" }
  | { kind: "corrupt"; detail: string }
  | { kind: "found"; record: {
      readonly transactionId: string;
      readonly clientOperationId: string;
      readonly status: string;
      readonly operationsDigest: string;
      readonly operationCount: number;
      readonly projectId: string;
      readonly branchId: string;
      readonly lineageId: string | null;
      readonly baseHeadSequence: number;
      readonly baseCanonicalStateDigest: string;
      readonly resultHeadSequence: number | null;
      readonly resultCanonicalStateDigest: string | null;
      /** [B12.4 §A] The chain-protected receipt commitment carried in the
       *  transaction's provenance (null on legacy transactions). */
      readonly provenanceCandidateId: string | null;
    } };

export type SchematicHydrationOutcome =
  | { status: "fresh"; detail: string }
  | { status: "resumed"; detail: string }
  /** The projection provably saw the current head and carries newer legacy
   *  edits; the lineage rebased onto it (prior envelope quarantined). */
  | { status: "rebased-local-newer"; detail: string }
  /** The durable canonical head superseded an older/untrusted projection.
   *  The caller MUST apply `state` and then call `confirmAdoption(state)` —
   *  the session stays non-ready until adoption is proven. */
  | { status: "recovered-canonical"; detail: string; state: SchematicState; reason: "verified-older-mark" | "untrusted-projection" }
  /** Impossible/conflicting persistence states. BOTH sides intact: the
   *  projection stays visible (editing disabled), `canonicalState` is what
   *  the durable head holds. Resolve with resolveConflictKeepLocal /
   *  resolveConflictAdoptCanonical. */
  | { status: "projection-conflict"; detail: string; reason: string; canonicalState: SchematicState }
  /** Durable history failed integrity validation. Nothing was overwritten;
   *  editing is disabled until the explicit recoverStartFresh() choice. */
  | { status: "corrupt-history"; detail: string }
  /** B07.1 — the PROJECTION itself is identity-invalid (duplicate stable ids,
   *  malformed collections, off-contract geometry) and no valid canonical
   *  head exists to fall back to. Nothing was changed anywhere; canonical
   *  editing is disabled until the source data is repaired explicitly. */
  | { status: "invalid-projection"; detail: string; issues: string[] }
  /** Durable storage could not open. Canonical mutations are disabled. */
  | { status: "unavailable"; detail: string };

export interface SchematicCommandRequest {
  commandId: string;
  label: string;
  /** Build the exact operations against the canonical model at execution time. */
  buildOperations(schematic: CanonicalSchematic): EngineeringOperation[];
  /** Pin a stable action-scoped idempotency key (retries replay). */
  idempotencyKey?: string;
  /** [B12.4 §A] Optional caller commitment carried into the transaction's
   *  provenance.candidateId — INSIDE the canonical integrity chain. Used by
   *  the approved-mutation service to bind non-canonical receipt inputs to
   *  durable evidence. Metadata only; grants no capability. */
  provenanceCandidateId?: string;
  /**
   * B06.1 (sealed proposals): the UI-projection digest the operations were
   * compiled against. Verified INSIDE the serialized queue against the head
   * at execution position — a mismatch rejects with `stale_revision` and
   * mutates nothing.
   */
  expectedBaseDigest?: string;
  /**
   * B09.1 (scope-sealed proposals): the exact canonical head mark the
   * caller verified against. Rechecked INSIDE the serialized queue
   * immediately before execution — lineage, head sequence, and canonical
   * head digest must ALL still match, so a verification-to-execution race
   * (another command landing between verify and apply) rejects with
   * `stale_revision` and mutates nothing.
   */
  expectedHeadMark?: SchematicCanonicalMark;
}

export type SchematicCommandRejectionCode = ExecutionRejectionCode | "session_not_ready" | "session_conflicted" | "session_unavailable";

/** B07.3 — typed outcome of an explicit lifecycle projection adoption. */
export type SchematicLifecycleAdoptionResult =
  | { ok: true; code: "adopted" | "already-canonical"; detail: string }
  | { ok: false; code: "not-ready" | "no-service" | "stale-superseded" | "invalid" | "quarantine-failed"; detail: string };

export type SchematicCommandResult =
  | {
      ok: true;
      status: "executed" | "idempotent_replay" | "noop";
      state: SchematicState;
      label: string;
      transactionId?: string;
      revisionBefore?: string;
      revisionAfter?: string;
      invalidatedArtifactKinds?: string[];
      /** Persist this with the projection (SavedProject) after applying `state`. */
      headMark?: SchematicCanonicalMark;
    }
  | {
      ok: false;
      status: "rejected";
      reasonCode: SchematicCommandRejectionCode;
      /** Toast-ready structured outcome — never a silent no-op. */
      message: string;
      diagnostics: string[];
    };

export interface SchematicSessionEvent {
  kind:
    | "opened"
    | "resumed"
    | "recovered-canonical"
    | "projection-conflict"
    | "corrupt-history"
    | "unavailable"
    | "adopted"
    | "rebased"
    | "executed"
    | "replayed"
    | "noop"
    | "rejected"
    | "undo-reconciled"
    | "redo-reconciled"
    | "reconcile-rebased";
  detail: string;
  transactionId?: string;
}

interface SchematicLineageLink {
  transactionId: string;
  baseUiDigest: string;
  resultUiDigest: string;
  baseSemanticDigest: string;
  resultSemanticDigest: string;
}

const KNOWN_DIGEST_LIMIT = 500;

function resolveProductionStore(): AtomicProjectStore | null {
  // Production requires the durable browser store. There is NO silent
  // in-memory fallback: without IndexedDB the session is `unavailable` and
  // canonical mutations stay disabled (in-memory stores are test injections).
  return typeof indexedDB === "undefined" ? null : new BrowserIndexedDbProjectStore("sirkit-schematic-canonical-v1");
}

export class SchematicEditorSession {
  private service: EngineeringTransactionService | null = null;
  private executor: CanonicalExecutor | null = null;
  private lineage = "";
  private lifecycleState: SchematicSessionLifecycle = "unopened";
  private readonly store: AtomicProjectStore | null;
  private readonly buildId: string;
  private readonly channel = createEditorSessionChannel("schematic-editor interactive session");
  private readonly actor: EngineeringActor;
  private readonly links = new Map<string, SchematicLineageLink>();
  /** UI digests of states on the canonical lineage (genesis + commit edges). */
  private readonly knownCanonicalDigests = new Set<string>();
  /** Projection digests proven STALE by canonical recovery — permanently
   *  refused so a pre-recovery snapshot can never rebase backward. */
  private readonly staleProjectionDigests = new Set<string>();
  private readonly reconcileCounts = new Map<string, number>();
  private readonly eventLog: SchematicSessionEvent[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  /** Set while a recovered/adopt-canonical state awaits UI adoption. */
  private pendingAdoptionDigest: string | null = null;
  /** Pending conflict context while `conflicted`. */
  private conflict: { kind: "projection-conflict" | "corrupt-history" | "invalid-projection"; canonicalEnvelope: ProjectPersistenceEnvelope | null; detail: string } | null = null;

  constructor(private readonly identity: SchematicSessionIdentity, options?: SchematicSessionOptions) {
    this.buildId = options?.buildId ?? "b06-schematic-session";
    this.store = options?.store ?? resolveProductionStore();
    this.actor = {
      actorId: "local-editor",
      actorKind: "human",
      sessionId: `schematic-editor:${identity.projectId}`,
      // project_admin carries edit_components — the schematic-mutation
      // capability. AI actors are categorically refused edit_components by
      // the Stage 10 authorization rule, independent of this session.
      role: "project_admin",
    };
  }

  get events(): readonly SchematicSessionEvent[] {
    return this.eventLog;
  }

  get lineageId(): string {
    return this.lineage;
  }

  get lifecycle(): SchematicSessionLifecycle {
    return this.disposed ? "unavailable" : this.lifecycleState;
  }

  whenIdle(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  dispose(): void {
    // Project switching: every queued task and pending callback of this
    // session is invalidated; nothing of it may run or mutate afterwards.
    this.disposed = true;
    this.lifecycleState = "unavailable";
    this.conflict = null;
    this.pendingAdoptionDigest = null;
  }

  /** Current head marker — null unless the session is READY, so autosave can
   *  never pair a stale projection with an adopted-looking canonical mark. */
  /**
   * [B12.2] Narrow READ-ONLY authority identity: which tenant/project/
   * branch/lineage this live session IS, plus its lifecycle. Used by the
   * approved-mutation service to contain consumed-replay receipts to the
   * matching live authority — it grants no capability and mints no trust.
   * `lineageId` is null until a lineage is opened.
   */
  scopeIdentity(): { tenantId: string; projectId: string; branchId: string; lineageId: string | null; lifecycle: SchematicSessionLifecycle } {
    return { ...this.identity, lineageId: this.lineage === "" ? null : this.lineage, lifecycle: this.lifecycle };
  }

  /**
   * [B12.4 §A] Narrow READ-ONLY digest of the CURRENT canonical head's UI
   * projection (the same digest domain as a receipt's
   * `schematicDigestAfter`). Null unless ready. Grants no capability —
   * used by the approved-mutation service to re-derive and verify a
   * receipt's after-digest when the durable head still sits at the
   * receipt's transaction.
   */
  headProjectionDigest(): string | null {
    if (this.lifecycle !== "ready" || !this.service) return null;
    return this.currentUiDigest();
  }

  /**
   * [B12.3 §D] Narrow READ-ONLY durable idempotency evidence: whether the
   * durable store already holds a transaction for `clientOperationId`, and
   * — when it does — captured/owned bounded metadata for exact-identity
   * comparison. Exposes NO mutation capability, verifies the envelope's
   * full integrity chain before answering, and never lets a caller bypass
   * base/head checks (comparison and disposition belong to the approved
   * apply boundary, which uses this ONLY for authenticated artifacts).
   */
  async durableIdempotencyEvidence(clientOperationId: string): Promise<DurableIdempotencyEvidence> {
    if (!this.store) return { kind: "unavailable" };
    let envelope: ProjectPersistenceEnvelope | null;
    try {
      envelope = await this.store.load(this.identity.projectId, this.identity.branchId);
    } catch {
      return { kind: "unavailable" };
    }
    if (!envelope) return { kind: "absent" };
    try {
      const integrityIssues = validatePersistenceEnvelope(envelope);
      if (integrityIssues.length > 0) return { kind: "corrupt", detail: integrityIssues[0] ?? "ENVELOPE_INVALID" };
      const record = envelope.transactionLog.find((candidate) => candidate.transaction?.clientOperationId === clientOperationId);
      if (!record) return { kind: "absent" };
      const transaction = record.transaction;
      if (typeof transaction.transactionId !== "string" || transaction.transactionId.length === 0
        || !Array.isArray(transaction.operations)
        || typeof transaction.baseRevision?.headSequence !== "number"
        || typeof transaction.baseRevision?.canonicalStateDigest !== "string") {
        return { kind: "corrupt", detail: "MALFORMED_TRANSACTION_RECORD" };
      }
      return {
        kind: "found",
        record: Object.freeze({
          transactionId: transaction.transactionId,
          clientOperationId: transaction.clientOperationId,
          status: String(record.status),
          operationsDigest: engineeringDigest({ schema: "sirkit.approved-mutation-evidence-operations.v1", operations: transaction.operations }),
          operationCount: transaction.operations.length,
          projectId: this.identity.projectId,
          branchId: this.identity.branchId,
          lineageId: envelopeLineage(envelope),
          baseHeadSequence: transaction.baseRevision.headSequence,
          baseCanonicalStateDigest: transaction.baseRevision.canonicalStateDigest,
          resultHeadSequence: record.resultingRevision?.headSequence ?? null,
          resultCanonicalStateDigest: record.resultingRevision?.canonicalStateDigest ?? null,
          provenanceCandidateId: typeof transaction.provenance?.candidateId === "string" ? transaction.provenance.candidateId : null,
        }),
      };
    } catch {
      return { kind: "corrupt", detail: "EVIDENCE_READ_FAILED" };
    }
  }

  headMark(): SchematicCanonicalMark | null {
    if (this.lifecycle !== "ready" || !this.service) return null;
    const revision = this.service.currentRevision();
    return { lineageId: this.lineage, headSequence: revision.headSequence, canonicalStateDigest: revision.canonicalStateDigest };
  }

  /**
   * B06.2 — open the ONE authoritative schematic head for a project and
   * reconcile it against the SavedProject projection through the validated
   * decision table. The session is `hydrating` from the moment this is
   * called until the outcome (and, for canonical recovery, UI adoption)
   * resolves — commands in between are structurally rejected.
   */
  openForProject(projectionState: SchematicState, projectionMark: unknown): Promise<SchematicHydrationOutcome> {
    this.lifecycleState = "hydrating";
    return this.enqueue(async (): Promise<SchematicHydrationOutcome> => {
      if (!this.store) {
        this.lifecycleState = "unavailable";
        const detail = "Durable schematic storage (IndexedDB) is not available in this environment. Canonical schematic editing is disabled — nothing will be silently kept in memory.";
        this.record({ kind: "unavailable", detail });
        return { status: "unavailable", detail };
      }
      const mark = validateSchematicCanonicalMark(projectionMark);
      let envelope: ProjectPersistenceEnvelope | null = null;
      try {
        envelope = await this.store.load(this.identity.projectId, this.identity.branchId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("ENVELOPE_INTEGRITY_FAILED")) {
          // Corrupt durable history: overwrite NOTHING. Explicit recovery only.
          this.lifecycleState = "conflicted";
          this.conflict = { kind: "corrupt-history", canonicalEnvelope: null, detail: message };
          const detail = `The stored canonical schematic history failed integrity validation (${message}). It has NOT been changed. Choose an explicit recovery to continue canonical editing; the corrupt history will be preserved for recovery.`;
          this.record({ kind: "corrupt-history", detail });
          return { status: "corrupt-history", detail };
        }
        this.lifecycleState = "unavailable";
        const detail = `Durable schematic storage could not be opened (${message}). Canonical schematic editing is disabled.`;
        this.record({ kind: "unavailable", detail });
        return { status: "unavailable", detail };
      }
      // B07.1 — identity-integrity gate BEFORE any lineage decision: a
      // projection with duplicate stable ids, malformed collections, or
      // off-contract geometry must never open as fresh/ready (a duplicate
      // operation target would be ambiguous). The original project and any
      // durable envelope stay untouched; recovery is explicit.
      const projectionIssues = validateSchematicStateIntegrity(projectionState);
      if (projectionIssues.length > 0) {
        this.lifecycleState = "conflicted";
        const summary = projectionIssues.slice(0, 3).join("; ");
        let canonicalFallback: SchematicState | null = null;
        if (envelope) {
          const storedCanonical = parseCanonicalSchematic(envelope.canonicalSnapshot.schematic);
          if (storedCanonical) canonicalFallback = fromCanonicalSchematic(storedCanonical);
        }
        if (canonicalFallback && envelope) {
          // A VALID canonical head exists: surface it as an explicit conflict
          // so the user can adopt it. Keep-local is structurally refused for
          // an invalid projection (resolveConflictKeepLocal re-validates).
          this.conflict = { kind: "invalid-projection", canonicalEnvelope: envelope, detail: summary };
          const detail = `The locally saved schematic failed identity validation (${summary}). Nothing was changed. The durable canonical history is intact — adopt it to continue, or repair the local data; the invalid copy will be preserved.`;
          this.record({ kind: "projection-conflict", detail });
          return { status: "projection-conflict", detail, reason: "invalid-projection-identity", canonicalState: canonicalFallback };
        }
        this.conflict = { kind: "invalid-projection", canonicalEnvelope: null, detail: summary };
        const detail = `The schematic failed identity validation (${summary}) and no valid canonical history exists to fall back to. Nothing was changed anywhere; canonical editing is disabled until the data is repaired.`;
        this.record({ kind: "projection-conflict", detail });
        return { status: "invalid-projection", detail, issues: projectionIssues };
      }
      if (!envelope) {
        await this.openLineage(projectionState, "opened");
        this.lifecycleState = "ready";
        return { status: "fresh", detail: `Canonical schematic lineage ${this.lineage} started for this project.` };
      }
      const canonical = parseCanonicalSchematic(envelope.canonicalSnapshot.schematic);
      if (!canonical) {
        this.lifecycleState = "conflicted";
        this.conflict = { kind: "corrupt-history", canonicalEnvelope: null, detail: "non-canonical schematic in envelope" };
        const detail = "The stored canonical schematic history is unreadable. It has NOT been changed. Choose an explicit recovery to continue canonical editing.";
        this.record({ kind: "corrupt-history", detail });
        return { status: "corrupt-history", detail };
      }
      // B06.3 — the durable envelope is the EXCLUSIVE lineage authority.
      // Legacy envelopes (predating lineage persistence, or with a malformed
      // lineage) are migrated deterministically and DURABLY before any
      // reconciliation decision; projection marks never substitute.
      if (envelopeLineage(envelope) === null) {
        try {
          envelope = await this.migrateLegacyEnvelopeLineage(envelope);
        } catch (error) {
          this.lifecycleState = "unavailable";
          const detail = `The stored schematic history predates lineage persistence and could not be migrated safely (${error instanceof Error ? error.message : String(error)}). Canonical editing is disabled; nothing was changed.`;
          this.record({ kind: "unavailable", detail });
          return { status: "unavailable", detail };
        }
      }
      const durableLineage = envelopeLineage(envelope)!;
      const headState = fromCanonicalSchematic(canonical);
      const decision = decideProjectionReconciliation({
        projectionDigest: schematicStateDigest(projectionState),
        headUiDigest: schematicStateDigest(headState),
        envelopeLineageId: durableLineage,
        headSequence: envelope.snapshotRevision.headSequence,
        headCanonicalDigest: envelope.snapshotRevision.canonicalStateDigest,
        sequenceDigests: envelopeSequenceDigests(envelope),
        mark,
      });
      if (decision.action === "resume") {
        await this.resumeHead(envelope);
        if (decision.markStatus === "foreign-discarded") {
          // Recorded, downgraded, and superseded: the next ready autosave
          // writes the ENVELOPE lineage mark; the foreign mark never chose
          // anything.
          this.record({ kind: "resumed", detail: `Projection matched the canonical head but carried a FOREIGN lineage mark (${mark?.lineageId ?? "?"} ≠ ${durableLineage}); the mark was discarded and the durable envelope lineage resumed.` });
        }
        this.lifecycleState = "ready";
        return { status: "resumed", detail: `Resumed canonical schematic head at sequence ${envelope.snapshotRevision.headSequence}.` };
      }
      if (decision.action === "rebase-local-newer") {
        try {
          await this.openLineage(projectionState, "rebased", "Saved schematic provably saw the canonical head and carries newer legacy edits; canonical lineage rebased onto it (prior history quarantined).");
        } catch (error) {
          // B06.3: quarantine MUST succeed before the envelope is replaced.
          this.lifecycleState = "conflicted";
          this.conflict = { kind: "projection-conflict", canonicalEnvelope: envelope, detail: "quarantine-failed" };
          const detail = `Your local edits could not be kept yet: the existing canonical history could not be preserved first (${error instanceof Error ? error.message : String(error)}). Nothing was changed — retry or choose the canonical history.`;
          this.record({ kind: "projection-conflict", detail });
          return { status: "projection-conflict", detail, reason: "quarantine-failed", canonicalState: headState };
        }
        this.lifecycleState = "ready";
        return { status: "rebased-local-newer", detail: "Local edits newer than the canonical history were kept; the canonical lineage was rebased onto them (the previous history was quarantined)." };
      }
      if (decision.action === "recover-canonical") {
        await this.resumeHead(envelope);
        // Remember the stale projection so it can never rebase backward, and
        // require UI adoption before the session becomes ready.
        this.staleProjectionDigests.add(schematicStateDigest(projectionState));
        this.pendingAdoptionDigest = schematicStateDigest(headState);
        this.record({ kind: "recovered-canonical", detail: `Projection (${decision.reason}) superseded by canonical head sequence ${envelope.snapshotRevision.headSequence}; awaiting UI adoption.` });
        return {
          status: "recovered-canonical",
          detail: "A newer canonical schematic state was recovered from durable history; the older locally-saved copy was not applied (it is preserved as a backup).",
          state: headState,
          reason: decision.reason,
        };
      }
      // Conflict: preserve BOTH sides, overwrite neither, require a choice.
      this.lifecycleState = "conflicted";
      this.conflict = { kind: "projection-conflict", canonicalEnvelope: envelope, detail: decision.reason };
      const detail = `The locally saved schematic and the durable canonical history disagree in a way that cannot be ordered safely (${decision.reason}). Neither side was changed — choose which to keep; the other will be preserved.`;
      this.record({ kind: "projection-conflict", detail });
      return { status: "projection-conflict", detail, reason: decision.reason, canonicalState: headState };
    });
  }

  /**
   * Adoption handshake: the UI proves it applied the recovered canonical
   * state. Only then does the session become ready.
   */
  confirmAdoption(adoptedState: SchematicState): boolean {
    if (this.disposed || this.pendingAdoptionDigest === null) return false;
    if (schematicStateDigest(adoptedState) !== this.pendingAdoptionDigest) return false;
    this.pendingAdoptionDigest = null;
    this.lifecycleState = "ready";
    this.record({ kind: "adopted", detail: "Recovered canonical state adopted by the UI; session ready." });
    return true;
  }

  /**
   * Explicit conflict resolution: keep the LOCAL projection. The durable
   * envelope is quarantined (recoverable), then a fresh lineage starts from
   * the projection.
   */
  resolveConflictKeepLocal(projectionState: SchematicState): Promise<SchematicHydrationOutcome> {
    return this.enqueue(async (): Promise<SchematicHydrationOutcome> => {
      const conflict = this.conflict;
      if (!conflict || !this.store) return { status: "unavailable", detail: "No conflict to resolve." };
      // B07.1 — keep-local means "start a lineage from this projection"; an
      // identity-invalid projection can never become canonical.
      const keepIssues = validateSchematicStateIntegrity(projectionState);
      if (keepIssues.length > 0) {
        const detail = `Your local schematic was NOT applied: it fails identity validation (${keepIssues[0]}). Nothing was changed — repair the local data or adopt the canonical history.`;
        this.record({ kind: "projection-conflict", detail });
        return { status: "invalid-projection", detail, issues: keepIssues };
      }
      try {
        // B06.3: quarantine MUST succeed before the envelope is replaced; on
        // failure the conflict (and its recovery choices) remain intact.
        await this.openLineage(projectionState, "rebased", "Conflict resolved: local projection kept; previous canonical history quarantined.");
      } catch (error) {
        const detail = `Your local schematic was NOT applied: the existing canonical history could not be preserved first (${error instanceof Error ? error.message : String(error)}). Nothing was changed — you can retry or choose another recovery.`;
        this.record({ kind: "projection-conflict", detail });
        return conflict.kind === "corrupt-history"
          ? { status: "corrupt-history", detail }
          : { status: "projection-conflict", detail, reason: "quarantine-failed", canonicalState: conflict.canonicalEnvelope ? fromCanonicalSchematic(parseCanonicalSchematic(conflict.canonicalEnvelope.canonicalSnapshot.schematic)!) : projectionState };
      }
      this.conflict = null;
      this.lifecycleState = "ready";
      return { status: "rebased-local-newer", detail: "Your local schematic was kept. The previous canonical history was preserved in quarantine." };
    });
  }

  /**
   * Explicit conflict resolution: adopt the CANONICAL head. Returns the
   * canonical state; the caller applies it and completes the adoption
   * handshake (the projection should be preserved by the caller).
   */
  resolveConflictAdoptCanonical(): Promise<SchematicHydrationOutcome> {
    return this.enqueue(async (): Promise<SchematicHydrationOutcome> => {
      const conflict = this.conflict;
      // B07.2 — adoption is offered for ordinary projection conflicts AND
      // for an identity-invalid projection whose durable canonical head is
      // intact (the only recovery the invalid side may take).
      if (!conflict || (conflict.kind !== "projection-conflict" && conflict.kind !== "invalid-projection") || !conflict.canonicalEnvelope) {
        return { status: "unavailable", detail: "No canonical head is available to adopt." };
      }
      const canonical = parseCanonicalSchematic(conflict.canonicalEnvelope.canonicalSnapshot.schematic);
      if (!canonical) return { status: "corrupt-history", detail: "The canonical head became unreadable." };
      this.conflict = null;
      await this.resumeHead(conflict.canonicalEnvelope);
      const headState = fromCanonicalSchematic(canonical);
      this.pendingAdoptionDigest = schematicStateDigest(headState);
      this.lifecycleState = "hydrating";
      return { status: "recovered-canonical", detail: "Canonical history adopted; your local copy was preserved.", state: headState, reason: "untrusted-projection" };
    });
  }

  /**
   * Explicit corrupt-history recovery: quarantine the RAW stored value
   * (recoverable), then start a fresh lineage from the visible projection.
   * The caller must have warned that old canonical history is superseded.
   */
  recoverStartFresh(projectionState: SchematicState): Promise<SchematicHydrationOutcome> {
    return this.enqueue(async (): Promise<SchematicHydrationOutcome> => {
      if (!this.store) return { status: "unavailable", detail: "Durable storage is unavailable." };
      // B07.1 — explicit recovery still cannot mint a lineage from an
      // identity-invalid projection.
      const freshIssues = validateSchematicStateIntegrity(projectionState);
      if (freshIssues.length > 0) {
        const detail = `Recovery was NOT performed: the visible schematic fails identity validation (${freshIssues[0]}). Nothing was changed anywhere.`;
        this.record({ kind: "corrupt-history", detail });
        return { status: "invalid-projection", detail, issues: freshIssues };
      }
      try {
        // openLineage quarantines any existing (even corrupt) value first and
        // THROWS on failure — the primary is then left untouched and the
        // recovery choice stays available.
        await this.openLineage(projectionState, "opened", "Explicit recovery: fresh canonical lineage started; prior history preserved in quarantine.");
      } catch (error) {
        const detail = `Recovery was NOT performed: the existing history could not be preserved first (${error instanceof Error ? error.message : String(error)}). Nothing was changed — you can retry.`;
        this.record({ kind: "corrupt-history", detail });
        return { status: "corrupt-history", detail };
      }
      this.conflict = null;
      this.lifecycleState = "ready";
      return { status: "fresh", detail: "A fresh canonical history was started from your visible schematic. The previous history was preserved in quarantine." };
    });
  }

  /**
   * B07.2/B07.3 — EXPLICIT lifecycle projection adoption. The only
   * sanctioned way a state that did not come from this session's own
   * commits becomes the canonical head: AI generation/apply, topology/tidy
   * apply, checkpoint restore, and sheet-size changes reach this through
   * the coordinator's transactional lifecycle gateway. Validates
   * identity/geometry, quarantines the prior envelope first (B06.3), and
   * no-ops when the state is already the head or a known canonical state.
   * Interactive commands can NEVER trigger this path. B07.3: returns a
   * TYPED outcome so the gateway can report structured failures.
   */
  adoptLifecycleProjection(state: SchematicState, reason: string): Promise<SchematicLifecycleAdoptionResult> {
    if (this.lifecycle !== "ready") {
      const code = this.lifecycle === "unavailable" ? "no-service" as const : "not-ready" as const;
      return Promise.resolve({ ok: false, code, detail: `Lifecycle projection not adopted: session is ${this.lifecycle}.` });
    }
    return this.enqueue<SchematicLifecycleAdoptionResult>(async () => {
      if (!this.service) return { ok: false, code: "no-service", detail: "Lifecycle projection not adopted: no canonical service." };
      const digest = schematicStateDigest(state);
      if (this.staleProjectionDigests.has(digest)) {
        return { ok: false, code: "stale-superseded", detail: "Lifecycle projection refused: it was superseded by recovered canonical history." };
      }
      if (this.currentUiDigest() === digest || this.knownCanonicalDigests.has(digest)) {
        return { ok: true, code: "already-canonical", detail: "Lifecycle projection already canonical." };
      }
      const issues = validateSchematicStateIntegrity(state);
      if (issues.length > 0) {
        this.record({ kind: "rejected", detail: `lifecycle adoption refused: ${issues[0]}` });
        return { ok: false, code: "invalid", detail: `Lifecycle projection refused: it fails identity validation (${issues[0]}).` };
      }
      try {
        await this.openLineage(state, "rebased", `Lifecycle replacement adopted: ${reason} (prior canonical history quarantined).`);
      } catch (error) {
        return { ok: false, code: "quarantine-failed", detail: `Lifecycle projection not adopted: the previous canonical history could not be preserved first (${error instanceof Error ? error.message : String(error)}).` };
      }
      return { ok: true, code: "adopted", detail: `Canonical lineage rebased onto the lifecycle replacement (${reason}).` };
    });
  }

  /** Queue-serialized canonical execution of one migrated schematic action. */
  execute(currentState: SchematicState, request: SchematicCommandRequest): Promise<SchematicCommandResult> {
    // B06.2: structural lifecycle gate, checked SYNCHRONOUSLY at call time —
    // a command issued while the session is not ready is rejected before it
    // can enter the queue, so it can never run against a later state.
    const gate = this.lifecycleGate(request.label);
    if (gate) return Promise.resolve(gate);
    return this.enqueue(() => this.runExecute(currentState, request));
  }

  /**
   * Reconcile a SchematicHistory undo/redo target onto the canonical
   * lineage via the verified replay contract. B07.3: runs BEFORE the
   * history cursor moves or the projection changes (the page's
   * transactional history job applies UI only on `ok: true`), and returns
   * a truthful outcome instead of swallowing failures:
   *
   *  - ok: exact verified replay, a successful documented reconcile-rebase
   *    of a non-canonical entry, or target-already-head;
   *  - !ok: session not ready, identity-invalid target, stale
   *    (recovery-superseded) target, or a quarantine-blocked rebase — the
   *    canonical head, cursor, and projection must stay unchanged.
   */
  reconcileHistoryStep(direction: "undo" | "redo", restoredState: SchematicState): Promise<{ ok: boolean; detail: string }> {
    if (this.lifecycle !== "ready") {
      return Promise.resolve({ ok: false, detail: `The schematic's canonical history is ${this.lifecycle}; ${direction} was not applied.` });
    }
    return this.enqueue(async () => {
      if (!this.service || !this.executor) return { ok: false, detail: "No canonical service; nothing was applied." };
      const restoredDigest = schematicStateDigest(restoredState);
      const headDigest = this.currentUiDigest();
      if (restoredDigest === headDigest) return { ok: true, detail: "Target already equals the canonical head." };
      const link = [...this.links.values()].find((candidate) =>
        direction === "undo"
          ? candidate.resultUiDigest === headDigest && candidate.baseUiDigest === restoredDigest
          : candidate.baseUiDigest === headDigest && candidate.resultUiDigest === restoredDigest,
      );
      if (!link) {
        if (this.staleProjectionDigests.has(restoredDigest)) {
          return { ok: false, detail: `${direction} target was superseded by recovered canonical history; nothing was applied.` };
        }
        // B07.1 — never rebase onto an identity-invalid restored snapshot.
        const restoredIssues = validateSchematicStateIntegrity(restoredState);
        if (restoredIssues.length > 0) {
          this.record({ kind: "reconcile-rebased", detail: `${direction} reconcile rebase refused: restored state fails identity validation (${restoredIssues[0]}); canonical head left untouched.` });
          return { ok: false, detail: `${direction} target fails identity validation (${restoredIssues[0]}); nothing was applied.` };
        }
        try {
          await this.openLineage(restoredState, "reconcile-rebased", `${direction} of a non-canonical entry — lineage rebased onto the restored schematic.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.record({ kind: "reconcile-rebased", detail: `${direction} reconcile rebase blocked (quarantine failed: ${message}); canonical head left untouched.` });
          return { ok: false, detail: `${direction} could not preserve the existing canonical history first (${message}); nothing was applied.` };
        }
        return { ok: true, detail: `${direction} of a non-canonical entry reconciled by a documented lineage rebase.` };
      }
      const occurrence = (this.reconcileCounts.get(`${direction}:${link.transactionId}`) ?? 0) + 1;
      this.reconcileCounts.set(`${direction}:${link.transactionId}`, occurrence);
      const result = await this.executor.executeUndoRedo({
        referencedTransactionId: link.transactionId,
        direction,
        actor: this.actor,
        expectedLineage: { ...this.identity, lineageId: this.lineage },
        expectedHeadRevision: this.service.currentRevision(),
        expectedSourceStateDigest: direction === "undo" ? link.resultSemanticDigest : link.baseSemanticDigest,
        expectedResultStateDigest: direction === "undo" ? link.baseSemanticDigest : link.resultSemanticDigest,
        idempotencyKey: `${direction}:${link.transactionId}:${occurrence}`,
        reason: `${direction === "undo" ? "Undo" : "Redo"} schematic change`,
      });
      const reconciled = result.status !== "rejected" && this.currentUiDigest() === restoredDigest;
      if (!reconciled) {
        try {
          await this.openLineage(restoredState, "reconcile-rebased", `Canonical ${direction} of ${link.transactionId} failed (${result.status === "rejected" ? result.reasonCode : "digest mismatch"}); rebased onto the restored schematic.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.record({ kind: "reconcile-rebased", detail: `${direction} reconcile rebase blocked (quarantine failed: ${message}); canonical head left untouched.` });
          return { ok: false, detail: `${direction} could not be reconciled and the fallback rebase could not preserve history (${message}); nothing was applied.` };
        }
        return { ok: true, detail: `${direction} reconciled by a documented lineage rebase after replay failure.` };
      }
      this.record({ kind: direction === "undo" ? "undo-reconciled" : "redo-reconciled", detail: `${direction} of ${link.transactionId} recorded as canonical transaction ${result.transactionId}.`, transactionId: result.transactionId });
      return { ok: true, detail: `${direction} of ${link.transactionId} replayed canonically.` };
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private lifecycleGate(label: string): SchematicCommandResult | null {
    const state = this.lifecycle;
    if (state === "ready") return null;
    const [reasonCode, message] =
      state === "hydrating" || state === "unopened"
        ? ["session_not_ready" as const, `"${label}" was not applied: the schematic's canonical history is still loading. Try again in a moment.`]
        : state === "conflicted"
          ? ["session_conflicted" as const, `"${label}" was not applied: the schematic history needs an explicit recovery choice first.`]
          : ["session_unavailable" as const, `"${label}" was not applied: durable schematic storage is unavailable, so canonical editing is disabled.`];
    this.record({ kind: "rejected", detail: `${label}: ${reasonCode}.` });
    return { ok: false, status: "rejected", reasonCode, message, diagnostics: [reasonCode.toUpperCase()] };
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(() => (this.disposed ? Promise.reject(new Error("SCHEMATIC_SESSION_DISPOSED")) : task()));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private record(event: SchematicSessionEvent): void {
    this.eventLog.push(event);
  }

  private canonicalStateFor(state: SchematicState): CanonicalProjectState {
    return {
      schemaVersion: "sirkit.engineering.v1",
      ...this.identity,
      // The schematic session pins an empty board: schematic transactions
      // touch only the schematic domain, and the PCB editor owns the live
      // board through its own session/lineage.
      pcb: createEmptyBoard(),
      schematic: toCanonicalSchematic(state),
      pinnedAssets: [],
    };
  }

  private currentUiDigest(): string {
    const canonical = this.service!.currentProject().schematic as CanonicalSchematic;
    return schematicStateDigest(fromCanonicalSchematic(canonical));
  }

  private rememberDigest(digest: string): void {
    this.knownCanonicalDigests.add(digest);
    if (this.knownCanonicalDigests.size > KNOWN_DIGEST_LIMIT) {
      const oldest = this.knownCanonicalDigests.values().next().value;
      if (oldest !== undefined) this.knownCanonicalDigests.delete(oldest);
    }
  }

  /**
   * B06.3 — quarantine of an EXISTING envelope is MANDATORY before any
   * overwrite. When something sits at the key (valid or corrupt) and cannot
   * be preserved, this THROWS and the caller leaves the primary untouched.
   * When nothing exists, no quarantine is required.
   */
  private async quarantineExistingEnvelope(label: string): Promise<void> {
    const store = this.store!;
    let exists = false;
    try {
      exists = (await store.load(this.identity.projectId, this.identity.branchId)) !== null;
    } catch {
      exists = true; // a corrupt value IS an existing value — it must be preserved
    }
    if (!exists) return;
    if (!store.preserveEnvelope) throw new Error("QUARANTINE_UNAVAILABLE: this store cannot preserve the existing canonical history");
    const preserved = await store.preserveEnvelope(this.identity.projectId, this.identity.branchId, label);
    if (!preserved) throw new Error("QUARANTINE_FAILED: the existing canonical history was not preserved");
  }

  /**
   * B06.3 — deterministic, durable lineage migration for envelopes predating
   * lineage persistence (or carrying a malformed lineage). The migrated
   * lineage derives from the envelope's OWN genesis digest (never from a
   * projection mark), the prior raw value is quarantined first, and the
   * migration is recorded in the envelope's migration history — a later
   * reload loads the SAME migrated lineage without re-migrating.
   */
  private async migrateLegacyEnvelopeLineage(envelope: ProjectPersistenceEnvelope): Promise<ProjectPersistenceEnvelope> {
    const store = this.store!;
    const genesisDigest = envelope.transactionLog.length > 0
      ? envelope.transactionLog[0].transaction.baseRevision.canonicalStateDigest
      : envelope.snapshotRevision.canonicalStateDigest;
    const lineageId = deriveExecutorLineageId({ ...this.identity, genesisStateDigest: genesisDigest, parent: null });
    await this.quarantineExistingEnvelope(`lineage-migration-${envelope.integrityManifest.envelopeDigest.slice(5, 17)}`);
    const migrated = createPersistenceEnvelope({
      project: structuredClone(envelope.canonicalSnapshot),
      revision: structuredClone(envelope.snapshotRevision),
      transactionLog: structuredClone(envelope.transactionLog),
      buildId: this.buildId,
      lineageId,
      migrationHistory: [
        ...structuredClone(envelope.migrationHistory),
        { migrationId: "b06.3-lineage-backfill", fromVersion: "no-lineage", toVersion: lineageId, actorId: "schematic-session", completedAt: new Date().toISOString(), preDigest: envelope.integrityManifest.envelopeDigest, postDigest: envelope.integrityManifest.snapshotDigest },
      ],
    });
    const persisted = await store.restore(migrated);
    this.record({ kind: "resumed", detail: `Legacy envelope migrated to durable lineage ${lineageId} (prior value quarantined; migration recorded).` });
    return persisted;
  }

  /** Start a FRESH lineage from `state`. Quarantine of any existing envelope
   *  MUST succeed first (this throws otherwise; nothing is replaced). */
  private async openLineage(state: SchematicState, why: SchematicSessionEvent["kind"], detail?: string): Promise<void> {
    const store = this.store!;
    // B07.1 — a fresh lineage can only ever start from an identity-valid
    // state (defense in depth: every caller validates first).
    const integrityIssues = validateSchematicStateIntegrity(state);
    if (integrityIssues.length > 0) throw new Error(`SCHEMATIC_IDENTITY_INVALID: ${integrityIssues[0]}`);
    await this.quarantineExistingEnvelope(`rebase-${Date.now()}`);
    const canonicalState = this.canonicalStateFor(state);
    const revision = computeProjectRevision(canonicalState);
    this.lineage = deriveExecutorLineageId({
      ...this.identity,
      genesisStateDigest: revision.canonicalStateDigest,
      parent: this.lineage || null,
    });
    this.links.clear();
    this.reconcileCounts.clear();
    this.knownCanonicalDigests.clear();
    const envelope = createPersistenceEnvelope({ project: canonicalState, revision, transactionLog: [], buildId: this.buildId, lineageId: this.lineage });
    await store.restore(envelope);
    this.service = await EngineeringTransactionService.open(canonicalState, { buildId: this.buildId, store });
    this.executor = new CanonicalExecutor(this.service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: this.channel, lineageId: this.lineage });
    this.rememberDigest(schematicStateDigest(state));
    this.record({ kind: why, detail: detail ?? `Canonical schematic lineage ${this.lineage} derived from the current editor state.` });
  }

  /**
   * Resume the EXISTING durable head (no envelope replacement).
   * B06.3: the lineage comes EXCLUSIVELY from the validated durable envelope
   * — a projection mark can never choose, replace, or invent it. (The
   * derive fallback exists only for a defensive impossible-path: callers
   * migrate legacy envelopes before resuming.)
   */
  private async resumeHead(envelope: ProjectPersistenceEnvelope): Promise<void> {
    this.links.clear();
    this.reconcileCounts.clear();
    this.knownCanonicalDigests.clear();
    this.lineage = envelopeLineage(envelope) ?? deriveExecutorLineageId({
      ...this.identity,
      genesisStateDigest: envelope.transactionLog[0]?.transaction.baseRevision.canonicalStateDigest ?? envelope.snapshotRevision.canonicalStateDigest,
      parent: null,
    });
    this.service = await EngineeringTransactionService.open(structuredClone(envelope.canonicalSnapshot), { buildId: this.buildId, store: this.store! });
    this.executor = new CanonicalExecutor(this.service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: this.channel, lineageId: this.lineage });
    this.rememberDigest(this.currentUiDigest());
    this.record({ kind: "resumed", detail: `Resumed durable schematic head sequence ${envelope.snapshotRevision.headSequence} on lineage ${this.lineage}.` });
  }

  private async runExecute(currentState: SchematicState, request: SchematicCommandRequest): Promise<SchematicCommandResult> {
    // Re-check inside the queue: the lifecycle may have changed while queued
    // (e.g. dispose or a conflict raised by an earlier task).
    const gate = this.lifecycleGate(request.label);
    if (gate) return gate;
    const incomingDigest = schematicStateDigest(currentState);
    // B06.2: a snapshot proven stale by canonical recovery is permanently
    // refused — it must NEVER rebase the canonical store backward.
    if (this.staleProjectionDigests.has(incomingDigest)) {
      this.record({ kind: "rejected", detail: `${request.commandId}: stale pre-recovery snapshot refused.` });
      return {
        ok: false,
        status: "rejected",
        reasonCode: "stale_revision",
        message: `"${request.label}" was refused: it was based on a schematic state that was superseded by recovered canonical history. Nothing was applied.`,
        diagnostics: ["STALE_PRE_RECOVERY_SNAPSHOT"],
      };
    }
    if (!this.service) {
      // Defensive: the lifecycle gate requires `ready`, and every ready path
      // creates the service — an execute without one is a contract breach.
      this.record({ kind: "rejected", detail: `${request.commandId}: no canonical service (session never opened).` });
      return {
        ok: false,
        status: "rejected",
        reasonCode: "session_not_ready",
        message: `"${request.label}" was not applied: the schematic's canonical history is not open.`,
        diagnostics: ["SESSION_SERVICE_UNAVAILABLE"],
      };
    }
    // B07.2 — INTERACTIVE FAIL-SAFE: an interactive command whose base is
    // neither the canonical head nor a known canonical ancestor is REFUSED.
    // The legacy behavior (silently rebasing the lineage onto the unknown
    // state) let an uncommitted gesture PREVIEW become lineage genesis when
    // an ordinary command raced a drag. Lifecycle replacements that
    // legitimately need a rebase (AI generation, checkpoint restore, sheet
    // resize) go through the EXPLICIT typed adoptLifecycleProjection method;
    // a preview digest can never qualify as an authoritative base.
    if (this.currentUiDigest() !== incomingDigest && !this.knownCanonicalDigests.has(incomingDigest)) {
      this.record({ kind: "rejected", detail: `${request.commandId}: unknown base projection refused (no interactive rebase).` });
      return {
        ok: false,
        status: "rejected",
        reasonCode: "stale_revision",
        message: `"${request.label}" was refused: the editor state is not the canonical schematic head (an uncommitted preview or unadopted state). Nothing was applied.`,
        diagnostics: ["UNKNOWN_BASE_PROJECTION"],
      };
    }
    // B06.1: a caller whose snapshot is a known canonical ANCESTOR is merely
    // behind the serialized queue — execution proceeds against the CURRENT
    // head (operations are built from it below), never by rebasing backwards.
    const service = this.service!;
    const executor = this.executor!;
    // B06.1 (sealed proposals): base-digest precondition, verified at the
    // actual queued execution position.
    if (request.expectedBaseDigest !== undefined && this.currentUiDigest() !== request.expectedBaseDigest) {
      this.record({ kind: "rejected", detail: `${request.commandId}: stale_revision — base digest precondition failed.` });
      return {
        ok: false,
        status: "rejected",
        reasonCode: "stale_revision",
        message: `"${request.label}" was refused: the schematic changed after this action was prepared. Nothing was applied.`,
        diagnostics: ["EXPECTED_BASE_DIGEST_MISMATCH"],
      };
    }
    // B09.1 — head-mark precondition at the ACTUAL queued execution
    // position: lineage + head sequence + canonical head digest must all
    // still match the mark the caller verified a sealed proposal against.
    if (request.expectedHeadMark !== undefined) {
      const mark = this.headMark();
      if (!mark
        || mark.lineageId !== request.expectedHeadMark.lineageId
        || mark.headSequence !== request.expectedHeadMark.headSequence
        || mark.canonicalStateDigest !== request.expectedHeadMark.canonicalStateDigest) {
        this.record({ kind: "rejected", detail: `${request.commandId}: stale_revision — head-mark precondition failed.` });
        return {
          ok: false,
          status: "rejected",
          reasonCode: "stale_revision",
          message: `"${request.label}" was refused: the canonical schematic head moved after this action was verified. Nothing was applied.`,
          diagnostics: ["EXPECTED_HEAD_MARK_MISMATCH"],
        };
      }
    }
    const canonical = service.currentProject().schematic as CanonicalSchematic;
    const operations = request.buildOperations(structuredClone(canonical));
    if (operations.length === 0) {
      this.record({ kind: "noop", detail: `${request.commandId}: no effective operations.` });
      return { ok: true, status: "noop", state: fromCanonicalSchematic(canonical), label: request.label };
    }
    const expectedRevision = service.currentRevision();
    const idempotencyKey = request.idempotencyKey ?? `ui:${engineeringDigest({
      commandId: request.commandId,
      base: expectedRevision.canonicalStateDigest,
      headSequence: expectedRevision.headSequence,
      operations,
    }).slice(5)}`;
    const baseUiDigest = this.currentUiDigest();

    const result = await executor.execute({
      commandId: request.commandId,
      actor: this.actor,
      expectedRevision,
      idempotencyKey,
      reason: request.label,
      operations,
      provenance: { source: "ui", toolVersion: this.buildId, ...(request.provenanceCandidateId !== undefined ? { candidateId: request.provenanceCandidateId } : {}) },
    });

    if (result.status === "rejected") {
      // Legacy parity: a semantically empty action stays silent.
      if (result.reasonCode === "invalid" && result.diagnostics.some((item) => item === "NO_OP_TRANSACTION" || item === "NO_SEMANTIC_REVISION_CHANGE")) {
        this.record({ kind: "noop", detail: `${request.commandId}: canonical no-op.` });
        return { ok: true, status: "noop", state: currentState, label: request.label };
      }
      this.record({ kind: "rejected", detail: `${request.commandId}: ${result.reasonCode} — ${result.diagnostics.join("; ")}` });
      return {
        ok: false,
        status: "rejected",
        reasonCode: result.reasonCode,
        message: rejectionMessage(request.label, result.reasonCode, result.diagnostics),
        diagnostics: result.diagnostics,
      };
    }

    const nextState = fromCanonicalSchematic(service.currentProject().schematic as CanonicalSchematic);
    const resultUiDigest = schematicStateDigest(nextState);
    this.rememberDigest(baseUiDigest);
    this.rememberDigest(resultUiDigest);
    if (result.status === "idempotent_replay") {
      this.record({ kind: "replayed", detail: `${request.commandId}: duplicate submission replayed transaction ${result.transactionId}.`, transactionId: result.transactionId });
      return { ok: true, status: "idempotent_replay", state: nextState, label: request.label, transactionId: result.transactionId, headMark: this.headMark() ?? undefined };
    }
    this.links.set(result.transactionId, {
      transactionId: result.transactionId,
      baseUiDigest,
      resultUiDigest,
      baseSemanticDigest: result.semanticDigestBefore ?? "",
      resultSemanticDigest: result.semanticDigestAfter ?? "",
    });
    if (this.links.size > 200) {
      const oldest = this.links.keys().next().value;
      if (oldest !== undefined) this.links.delete(oldest);
    }
    this.record({ kind: "executed", detail: `${request.commandId}: transaction ${result.transactionId} → sequence ${result.recordSequence}.`, transactionId: result.transactionId });
    return {
      ok: true,
      status: "executed",
      state: nextState,
      label: request.label,
      transactionId: result.transactionId,
      revisionBefore: result.revisionBefore.canonicalStateDigest,
      revisionAfter: result.revisionAfter.canonicalStateDigest,
      invalidatedArtifactKinds: result.invalidatedArtifacts.map((item) => item.artifactKind),
      headMark: this.headMark() ?? undefined,
    };
  }
}

function rejectionMessage(label: string, reasonCode: ExecutionRejectionCode, diagnostics: string[]): string {
  const summary = diagnostics[0] ? ` (${diagnostics[0]})` : "";
  switch (reasonCode) {
    case "stale_revision":
      return `"${label}" was refused: the schematic changed underneath this action. Nothing was applied.`;
    case "unauthorized":
      return `"${label}" was refused: this session is not authorized for that operation${summary}.`;
    case "persistence_failed":
      return `"${label}" could not be committed and was rolled back${summary}. The schematic is unchanged.`;
    case "approval_required":
      return `"${label}" requires approval that this session cannot supply${summary}.`;
    default:
      return `"${label}" failed validation${summary}. Nothing was applied.`;
  }
}
