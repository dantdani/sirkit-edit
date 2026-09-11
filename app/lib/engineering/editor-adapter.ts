/**
 * B03 — canonical editor adapter.
 *
 * Routes the migrated PCB editor mutation slice (move / rotate / side /
 * track edit / non-footprint delete / all-footprint arrange) through the B02
 * `CanonicalExecutor` at runtime while preserving the shipped UI exactly:
 *
 *  - CANONICAL-FIRST: for a migrated action the executor applies the
 *    operations; the editor board is then set FROM the canonical result in
 *    ONE `PcbHistory.execute` (the board-repair `replaceBoardContents`
 *    pattern). One UI action → one canonical transaction → one undo entry.
 *    There is no independent legacy mutation and no dual write.
 *  - Actions the operation vocabulary cannot represent EXACTLY (silk-text
 *    delete, zone/text re-layer, mixed-kind arrange, locked-flag patches)
 *    stay on the legacy `applyEdits` path — `applyEditsCanonical` falls back
 *    synchronously, so unmigrated behavior is byte-for-byte unchanged.
 *  - LINEAGE: the session tracks the canonical head against the editor board
 *    using a fill-normalized semantic digest (zone fills are derived state,
 *    recomputed outside the undo log by `applyDerived`). When a legacy
 *    mutation moves the board off the canonical head, the next canonical
 *    action REBASES: the service reopens from the current board as a new
 *    lineage, recorded in the adapter event log. Rebase is the only
 *    reconciliation rule; the adapter never guesses a merge.
 *  - UNDO/REDO: the wrapped history keeps the synchronous Immer patch
 *    undo/redo the UI depends on. For entries created by this adapter it then
 *    reconciles the canonical lineage by submitting the durable record's
 *    inverse (or forward) operations as a NEW `pcb.undo-redo-canonical`
 *    transaction — an audited inverse, never a log rewind. If the entry is
 *    not the lineage head the reconcile falls back to a rebase.
 *  - IDEMPOTENCY: keys derive from (command, base revision digest, operation
 *    content) — a duplicate submission of the same action on the same base
 *    replays the original transaction and creates no second undo entry.
 *  - PERSISTENCE: `headMetadataFor(board)` yields a `PcbCanonicalHead` only
 *    when the given board IS the canonical head; autosave stores it, and
 *    `bind` verifies a persisted claim against the loaded board on hydration
 *    (stale claims are refused and recorded, never adopted). Projects
 *    without metadata open exactly as before — nothing is rewritten on open.
 *
 * No agent-callable tool imports this module; provenance is always
 * `{ source: "ui" }`.
 */

import type { PcbCanonicalHead } from "@/lib/persistence";
import { applyEdits, compileEdits } from "../pcb/edit/apply";
import { describeEdits } from "../pcb/edit/describe";
import type { EditCommand, EditResult, SelectionRef } from "../pcb/edit/commands";
import { compilePcbBoardDelta } from "./pcb-delta";
import type { PcbHistory, PcbHistoryMetadata } from "../pcb/history";
import { pcbRevisionId } from "../pcb/revision";
import type { PcbBoard } from "../pcb/types";
import { ACTION_COVERAGE_REGISTRY } from "./action-registry";
import { CanonicalExecutor, deriveExecutorLineageId, type ExecutionRejectionCode, type ExecutionResult, REPLAY_COMMAND_ID } from "./executor";
import { createEditorSessionChannel } from "./interactive-channel.internal";
import { isBareHistoryAuthorized } from "./pcb-bare-authority.internal";
import { createPersistenceEnvelope, InMemoryAtomicProjectStore, validatePersistenceEnvelope, type AtomicProjectStore } from "./persistence";
import { computeProjectRevision } from "./revision";
import { engineeringDigest } from "./stable";
import { canonicalLineageDigest } from "./semantic-board-digest"; // [B18-C review]
import { EngineeringTransactionService } from "./transaction-service";
import type { CanonicalProjectState, EngineeringActor, EngineeringOperation, ProjectPersistenceEnvelope, ProjectRevision } from "./types";

// ─── Identity + lineage digest ───────────────────────────────────────────────

export interface CanonicalEditorIdentity {
  tenantId: string;
  projectId: string;
  branchId: string;
}

/**
 * Semantic lineage digest: the board with zone-fill DERIVED state normalized
 * away. `applyDerived` zone refills change board content without a history
 * entry; excluding fills keeps refills from being misread as lineage drift.
 * [B18-C review] The one implementation lives in `./semantic-board-digest`
 * (pure; shared with the granted-execution builder and ritual) — re-exported.
 */
export { canonicalLineageDigest };

// ─── Structured results + event log ──────────────────────────────────────────

export type CanonicalCommitResult =
  | {
      ok: true;
      status: "executed" | "idempotent_replay" | "noop";
      transactionId?: string;
      revisionBefore?: ProjectRevision;
      revisionAfter?: ProjectRevision;
      changeSetDigest?: string;
      invalidatedArtifactKinds?: string[];
    }
  | {
      ok: false;
      status: "rejected";
      /** B08.2 taxonomy: `session_retired` = the history WAS canonical and
       *  its session was retired by a lifecycle replacement;
       *  `canonical_authority_missing` = never bound AND no bare-history
       *  capability — the composition simply lacks mutation authority. */
      reasonCode: ExecutionRejectionCode | "session_retired" | "canonical_authority_missing";
      /** Human-readable, toast-ready failure — never silently dropped. */
      message: string;
      diagnostics: string[];
    };

export interface CanonicalAdapterEvent {
  kind:
    | "opened"
    | "head-restored"
    | "envelope-rejected"
    | "envelope-persist-failed"
    | "claim-verified"
    | "claim-stale"
    | "executed"
    | "replayed"
    | "noop"
    | "rejected"
    | "rebased"
    | "undo-reconciled"
    | "redo-reconciled"
    | "reconcile-rebased";
  detail: string;
  transactionId?: string;
  lineageId?: string;
}

/** [B15.3] see `CanonicalEditorSession.durableIdempotencyEvidence`. */
export type PcbDurableIdempotencyEvidence =
  | { kind: "unavailable" }
  | { kind: "absent" }
  | { kind: "corrupt"; detail: string }
  | {
      kind: "found";
      record: Readonly<{
        transactionId: string;
        clientOperationId: string;
        status: string;
        operationCount: number;
        projectId: string;
        branchId: string;
        lineageId: string | null;
        resultHeadSequence: number | null;
        resultCanonicalStateDigest: string | null;
        provenanceCandidateId: string | null;
      }>;
    };

export interface CanonicalCommitRequest {
  commandId: string;
  label: string;
  /**
   * Build the EXACT operations for this action against the board the lineage
   * head holds when the (serialized) commit runs. Returning [] is a no-op
   * (legacy parity: no entry, no transaction). All geometry must be integer nm.
   */
  buildOperations(board: PcbBoard): EngineeringOperation[];
  metadata?: Partial<PcbHistoryMetadata>;
  /**
   * Pin a stable action-scoped idempotency key (e.g. a retry of one gesture).
   * Default: content-derived — same command + base + operations ⇒ same key,
   * so an identical duplicate submission replays instead of double-applying.
   */
  idempotencyKey?: string;
  /**
   * [B15.3] optional chain-protected commitment recorded as the durable
   * transaction's `provenance.candidateId` — the approved-PCB-apply boundary
   * binds its receipt commitment here so non-canonical receipt scalars are
   * provable ONLY via the hash-chained canonical history (never a plain
   * caller-computable checksum). Purely additive; absent for every other
   * caller.
   */
  provenanceCandidateId?: string;
}

/** [B18-C I8] One granted undo / redo of a referenced durable transaction (see `CanonicalEditorSession.replayUnderGrant`). */
export interface CanonicalReplayRequest {
  direction: "undo" | "redo";
  referencedTransactionId: string;
  /** The grant id — the replay transaction's clientOperationId, so the durable idempotency evidence finds it. */
  idempotencyKey: string;
  /** The canonical head sequence the grant was issued against. */
  expectedBaseHeadSequence: number;
  label: string;
  metadata?: Partial<PcbHistoryMetadata>;
}

// ─── Session ─────────────────────────────────────────────────────────────────

const SESSIONS = new WeakMap<PcbHistory, CanonicalEditorSession>();
/** B08.1 — histories whose canonical session was RETIRED (lifecycle
 *  replacement/unmount). Deleting the active binding must never erase the
 *  fact that the history WAS canonical: a retired history is permanently
 *  ineligible for any bare-history fallback. */
const RETIRED = new WeakSet<PcbHistory>();

/** The session bound to a (wrapped) history instance, if any. */
export function canonicalSessionFor(history: PcbHistory | null | undefined): CanonicalEditorSession | null {
  return history ? (SESSIONS.get(history) ?? null) : null;
}

export type PcbHistoryBindingState = "active" | "retired" | "unbound";

/** B08.1 — explicit binding state: absence from the active map is NOT
 *  authority for legacy mutation (retired ≠ never-bound). */
export function historyBindingState(history: PcbHistory | null | undefined): PcbHistoryBindingState {
  if (!history) return "unbound";
  if (SESSIONS.has(history)) return "active";
  if (RETIRED.has(history)) return "retired";
  return "unbound";
}

export interface BindCanonicalOptions {
  /** Persisted head claim from the working copy; verified, never trusted. */
  claim?: PcbCanonicalHead | null;
  store?: AtomicProjectStore;
  /**
   * B03.1: durable envelope store (IndexedDB in the browser). When present,
   * every committed transaction mirrors the full validated persistence
   * envelope, and a verified claim reopens the service at the EXACT canonical
   * head (sequence, head transaction, integrity-chained log). Absent → reload
   * is content-equivalence only (fresh lineage), exactly like B03.
   */
  durableStore?: AtomicProjectStore;
  actor?: EngineeringActor;
  buildId?: string;
}

export interface BoundCanonicalEditor {
  /** Drop-in `PcbHistory` with canonical-aware undo/redo. Hand THIS to the editor and tools. */
  history: PcbHistory;
  session: CanonicalEditorSession;
}

/**
 * Wrap a fresh `PcbHistory` (created for a board arriving from hydration,
 * sync, or restore) in a canonical session. Synchronous — the underlying
 * transaction service opens lazily; commits queue behind it. Binding never
 * mutates the board and never writes persistence.
 */
export function bindCanonicalEditorSession(
  raw: PcbHistory,
  identity: CanonicalEditorIdentity,
  options?: BindCanonicalOptions,
): BoundCanonicalEditor {
  const session = new CanonicalEditorSession(raw, identity, options);
  const history = session.wrappedHistory;
  SESSIONS.set(history, session);
  return { history, session };
}

interface LineageLink {
  transactionId: string;
  /** Fill-normalized BOARD digests (adapter's rebase-decision rule). */
  baseLineageDigest: string;
  resultLineageDigest: string;
  /** SEMANTIC state digests (the executor's verified-replay contract). */
  baseSemanticDigest: string;
  resultSemanticDigest: string;
}

export class CanonicalEditorSession {
  readonly wrappedHistory: PcbHistory;

  private readonly delegate: PcbHistory;
  private readonly identity: CanonicalEditorIdentity;
  private readonly actor: EngineeringActor;
  private readonly buildId: string;
  private readonly claim: PcbCanonicalHead | null;
  private readonly initialStore: AtomicProjectStore | undefined;
  private readonly durableStore: AtomicProjectStore | undefined;
  /**
   * B03.1: trusted interactive-session authority. Created HERE — by the
   * editor-session composition — and held privately; it is injected into the
   * session's executors and nothing else. It never appears in events,
   * results, persisted metadata, or serialized state.
   */
  private readonly channel = createEditorSessionChannel("pcb-editor interactive session");

  private service: EngineeringTransactionService | null = null;
  private executor: CanonicalExecutor | null = null;
  private lineage = "";
  /** Canonical link per adapter-created transaction (bounded like the undo stack). */
  private readonly links = new Map<string, LineageLink>();
  /** Per-transaction undo/redo occurrence counters (distinct idempotency keys). */
  private readonly reconcileCounts = new Map<string, number>();
  private readonly eventLog: CanonicalAdapterEvent[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(raw: PcbHistory, identity: CanonicalEditorIdentity, options?: BindCanonicalOptions) {
    this.delegate = raw;
    this.identity = identity;
    this.claim = options?.claim ?? null;
    this.initialStore = options?.store;
    this.durableStore = options?.durableStore;
    this.buildId = options?.buildId ?? "b03-editor-adapter";
    // B08: the interactive editor session represents the LOCAL HUMAN OWNER
    // of the project — the composition that also holds the trusted UI
    // channel. The owner legitimately holds protection, stackup/outline,
    // and constraint authority (project_admin), which B08's migrated
    // surfaces (lock toggles, outline/stackup edits, rules) require.
    // Least privilege still binds every OTHER caller: AI/api/worker actors
    // get their own capability sets, AI is categorically refused
    // manage_protection / edit_stackup_outline / edit_components, and
    // caller-supplied actor fields can never widen a channel-less executor.
    this.actor = options?.actor ?? {
      actorId: "local-editor",
      actorKind: "human",
      sessionId: `pcb-editor:${identity.projectId}`,
      role: "project_admin",
    };
    this.wrappedHistory = this.makeWrappedHistory();
    // Open the lineage lazily on the queue so binding stays synchronous.
    // Order: verified EXACT-head restoration first (durable envelope + claim);
    // any failure falls closed to a fresh content-equivalence lineage. Merely
    // binding never mutates the board and never writes persistence.
    this.enqueue(async () => {
      if (this.claim && (await this.tryRestoreExactHead(this.claim))) return;
      await this.openLineage(this.delegate.committedPresent, "opened", this.initialStore);
      if (this.claim) {
        const verified = this.claim.lineageDigest === canonicalLineageDigest(this.delegate.committedPresent);
        this.record({
          kind: verified ? "claim-verified" : "claim-stale",
          detail: verified
            ? `Persisted canonical head ${this.claim.headTransactionId} matches the hydrated board CONTENT (new lineage; exact-head envelope unavailable or not attempted).`
            : `Persisted canonical head ${this.claim.headTransactionId} is STALE for the hydrated board; starting a fresh lineage from the board as loaded.`,
        });
      }
    });
  }

  get events(): readonly CanonicalAdapterEvent[] {
    return this.eventLog;
  }

  /** Await all queued canonical work (tests + deterministic assertions). */
  whenIdle(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    SESSIONS.delete(this.wrappedHistory);
    // B08.1 — tombstone: the history stays permanently "retired".
    RETIRED.add(this.wrappedHistory);
  }

  /** Content-derived durable lineage identity; changes on every rebase, restored verbatim on exact-head reload. */
  get lineageId(): string {
    return this.lineage;
  }

  currentHeadRevision(): ProjectRevision | null {
    return this.service?.currentRevision() ?? null;
  }

  /**
   * Canonical head metadata for persistence — ONLY when `board` semantically
   * IS the canonical head. Returns null before the lineage opened, after a
   * legacy-path divergence, or when disposed: a stale head must never be saved.
   */
  headMetadataFor(board: PcbBoard): PcbCanonicalHead | null {
    if (this.disposed || !this.service) return null;
    const head = this.service.currentRevision();
    const headBoard = this.service.currentProject().pcb;
    const lineageDigest = canonicalLineageDigest(board);
    if (lineageDigest !== canonicalLineageDigest(headBoard)) return null;
    return {
      schemaVersion: 2,
      lineageId: this.lineage,
      lineageDigest,
      boardSemanticRevision: pcbRevisionId(board),
      headSequence: head.headSequence,
      headTransactionId: head.headTransactionId,
      canonicalStateDigest: head.canonicalStateDigest,
    };
  }

  /** Queue-serialized canonical execution of one migrated UI action. */
  commit(request: CanonicalCommitRequest): Promise<CanonicalCommitResult> {
    return this.enqueue(() => this.runCommit(request));
  }

  /**
   * [B18-C I8] Undo or redo ONE referenced durable transaction under a server-minted grant — canonical FIRST: the executor
   * verifies the reference, the lineage position and a pure dry run BEFORE any mutation, and only an accepted replay is
   * published into the editor history (a NEW applied entry, never a stack pop). A refusal mutates nothing and never rebases
   * the lineage (the grant is bound to it). A landed result the durable records cannot confirm throws AFTER the envelope is
   * persisted, so the ritual's canonical-evidence path reports it as landed and unverified — never "nothing changed".
   */
  replayUnderGrant(request: CanonicalReplayRequest): Promise<CanonicalCommitResult> {
    return this.enqueue(() => this.runReplay(request));
  }

  /** [B18-C I8] Whether `transactionId` can be undone (it IS the canonical head) or redone (the head is the replay that undid
   *  it) right now — read-only, from the durable records (never the in-memory links, which a reload clears). */
  isReplayEligible(direction: "undo" | "redo", transactionId: string): boolean {
    if (!this.service || this.disposed) return false;
    const records = this.service.durableRecords();
    const referenced = records.find((item) => item.transaction.transactionId === transactionId);
    if (!referenced || referenced.status !== "accepted" || !referenced.appliedChangeSet?.baseSemanticStateDigest || !referenced.appliedChangeSet.resultSemanticStateDigest) return false;
    const head = this.service.currentRevision();
    if (direction === "undo") return head.headTransactionId === transactionId;
    const top = records.find((item) => item.transaction.transactionId === head.headTransactionId);
    return top?.transaction.provenance?.candidateId === `undo:${transactionId}`;
  }

  /** [B18-C I8] A landed replay is exactly what it claims: its durable record links the referenced transaction and direction,
   *  and its recorded semantic result is the referenced change's other side (two DIFFERENT durable records agree). */
  replayResultVerified(direction: "undo" | "redo", referencedTransactionId: string, transactionId: string): boolean {
    if (!this.service || this.disposed) return false;
    const records = this.service.durableRecords();
    const replay = records.find((item) => item.transaction.transactionId === transactionId);
    const referenced = records.find((item) => item.transaction.transactionId === referencedTransactionId);
    if (!replay?.appliedChangeSet || !referenced?.appliedChangeSet) return false;
    if (replay.transaction.provenance?.candidateId !== `${direction}:${referencedTransactionId}`) return false;
    const expected = direction === "undo" ? referenced.appliedChangeSet.baseSemanticStateDigest : referenced.appliedChangeSet.resultSemanticStateDigest;
    return typeof expected === "string" && expected.length > 0 && replay.appliedChangeSet.resultSemanticStateDigest === expected;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(() =>
      this.disposed
        ? Promise.reject(new Error("CANONICAL_SESSION_DISPOSED"))
        : task(),
    );
    // Keep the chain alive on failures; callers still see the rejection.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private record(event: Omit<CanonicalAdapterEvent, "lineageId">): void {
    this.eventLog.push({ ...event, lineageId: this.lineageId });
  }

  private canonicalStateFor(board: PcbBoard): CanonicalProjectState {
    return {
      schemaVersion: "sirkit.engineering.v1",
      tenantId: this.identity.tenantId,
      projectId: this.identity.projectId,
      branchId: this.identity.branchId,
      pcb: structuredClone(board),
      pinnedAssets: [],
    };
  }

  private async openLineage(board: PcbBoard, why: "opened" | "rebased" | "reconcile-rebased", store?: AtomicProjectStore, detail?: string): Promise<void> {
    const state = this.canonicalStateFor(board);
    // Deterministic content-derived lineage identity: genesis state + parent
    // chain. Persisted in the head claim and the envelope mirror; adopted
    // back verbatim on exact restore; injected into every executor (B03.2).
    this.lineage = deriveExecutorLineageId({
      tenantId: this.identity.tenantId,
      projectId: this.identity.projectId,
      branchId: this.identity.branchId,
      genesisStateDigest: computeProjectRevision(state).canonicalStateDigest,
      parent: this.lineage || null,
    });
    this.links.clear();
    this.reconcileCounts.clear();
    this.service = await EngineeringTransactionService.open(state, {
      buildId: this.buildId,
      store: store ?? new InMemoryAtomicProjectStore(),
    });
    this.executor = new CanonicalExecutor(this.service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: this.channel, lineageId: this.lineage });
    this.record({ kind: why, detail: detail ?? `Canonical lineage ${this.lineageId} derived from the current editor board.` });
  }

  /**
   * B03.1 exact-head restoration. Every check fails CLOSED to a fresh
   * content-equivalence lineage; the loaded board is never touched.
   */
  private async tryRestoreExactHead(claim: PcbCanonicalHead): Promise<boolean> {
    if (!this.durableStore || claim.schemaVersion !== 2 || !claim.lineageId) return false;
    const rejectEnvelope = (reason: string): false => {
      this.record({ kind: "envelope-rejected", detail: `Exact-head restore refused: ${reason}. Falling back to a fresh lineage from the board as loaded.` });
      return false;
    };
    let envelope: ProjectPersistenceEnvelope | null;
    try {
      envelope = await this.durableStore.load(this.identity.projectId, this.identity.branchId);
    } catch (error) {
      return rejectEnvelope(`corrupt or unreadable persisted envelope (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!envelope) return rejectEnvelope("no persisted envelope for this project/branch");
    const integrity = validatePersistenceEnvelope(envelope);
    if (integrity.length > 0) return rejectEnvelope(`integrity chain invalid (${integrity.join(", ")})`);
    if (envelope.projectId !== this.identity.projectId || envelope.branchId !== this.identity.branchId || envelope.canonicalSnapshot.tenantId !== this.identity.tenantId) {
      return rejectEnvelope("envelope belongs to a different tenant/project/branch");
    }
    const head = envelope.snapshotRevision;
    if (head.headSequence !== claim.headSequence || head.headTransactionId !== claim.headTransactionId || head.canonicalStateDigest !== claim.canonicalStateDigest) {
      return rejectEnvelope(`envelope head (${head.headSequence}/${head.headTransactionId}) does not match the persisted claim (${claim.headSequence}/${claim.headTransactionId})`);
    }
    // B03.2: claim and envelope must AGREE on the durable lineage identity —
    // an envelope without one (pre-B03.2) or with a different one is refused.
    if (envelope.lineageId !== claim.lineageId) {
      return rejectEnvelope(`envelope lineage ${envelope.lineageId ?? "(none)"} does not match the claimed lineage ${claim.lineageId}`);
    }
    const board = this.delegate.committedPresent;
    const boardLineageDigest = canonicalLineageDigest(board);
    if (boardLineageDigest !== claim.lineageDigest) return rejectEnvelope("loaded board diverged from the claimed head content");
    if (boardLineageDigest !== canonicalLineageDigest(envelope.canonicalSnapshot.pcb)) return rejectEnvelope("loaded board diverged from the envelope head snapshot");
    if (pcbRevisionId(board) !== claim.boardSemanticRevision) return rejectEnvelope("board semantic revision does not match the claim");
    const store = new InMemoryAtomicProjectStore();
    try {
      await store.restore(envelope);
      this.service = await EngineeringTransactionService.open(envelope.canonicalSnapshot, { buildId: this.buildId, store });
    } catch (error) {
      return rejectEnvelope(`service reopen failed (${error instanceof Error ? error.message : String(error)})`);
    }
    // Restore the lineage identity BEFORE constructing the executor — the
    // executor's immutable lineage id must be the restored one (B03.2).
    this.lineage = claim.lineageId;
    this.executor = new CanonicalExecutor(this.service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: this.channel, lineageId: this.lineage });
    this.links.clear();
    this.reconcileCounts.clear();
    this.record({
      kind: "head-restored",
      detail: `Reopened canonical lineage ${claim.lineageId} at exact head sequence ${head.headSequence} (${head.headTransactionId}) with ${envelope.transactionLog.length} durable record(s).`,
      transactionId: head.headTransactionId,
    });
    return true;
  }

  /**
   * [B15.3] Narrow READ-ONLY durable idempotency evidence for the PCB
   * canonical ledger — mirrors `SchematicEditorSession.durableIdempotencyEvidence`
   * (B12.3 §D): whether the durable store already holds a transaction for
   * `clientOperationId`, and — when it does — frozen bounded metadata.
   * Exposes NO mutation capability and verifies the envelope's FULL
   * integrity chain before answering; recovery may adopt a transaction only
   * when this canonical evidence proves it landed.
   */
  async durableIdempotencyEvidence(clientOperationId: string): Promise<PcbDurableIdempotencyEvidence> {
    if (!this.durableStore || this.disposed) return { kind: "unavailable" };
    let envelope: Awaited<ReturnType<AtomicProjectStore["load"]>>;
    try {
      envelope = await this.durableStore.load(this.identity.projectId, this.identity.branchId);
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
      if (typeof transaction.transactionId !== "string" || transaction.transactionId.length === 0 || !Array.isArray(transaction.operations)) {
        return { kind: "corrupt", detail: "MALFORMED_TRANSACTION_RECORD" };
      }
      return {
        kind: "found",
        record: Object.freeze({
          transactionId: transaction.transactionId,
          clientOperationId,
          status: String(record.status),
          operationCount: transaction.operations.length,
          projectId: this.identity.projectId,
          branchId: this.identity.branchId,
          lineageId: typeof envelope.lineageId === "string" ? envelope.lineageId : null,
          resultHeadSequence: record.resultingRevision?.headSequence ?? null,
          resultCanonicalStateDigest: record.resultingRevision?.canonicalStateDigest ?? null,
          provenanceCandidateId: typeof transaction.provenance?.candidateId === "string" ? transaction.provenance.candidateId : null,
        }),
      };
    } catch {
      return { kind: "corrupt", detail: "EVIDENCE_READ_FAILED" };
    }
  }

  /** Mirror the full validated envelope to the durable store (post-commit only). */
  private async persistEnvelope(): Promise<void> {
    if (!this.durableStore || !this.service || this.disposed) return;
    try {
      await this.durableStore.restore(createPersistenceEnvelope({
        project: this.service.currentProject(),
        revision: this.service.currentRevision(),
        transactionLog: this.service.durableRecords(),
        buildId: this.buildId,
        lineageId: this.lineage,
      }));
    } catch (error) {
      this.record({ kind: "envelope-persist-failed", detail: `Durable envelope mirror failed: ${error instanceof Error ? error.message : String(error)}. Reload will fall back to a fresh lineage.` });
    }
  }

  /** Deterministic rule: any semantic divergence reopens the lineage from the board. */
  private async ensureLineageCurrent(): Promise<void> {
    // `committedPresent` — a gesture's transient preview is NOT lineage drift;
    // the commit diffs from (and undo restores) the pre-transient board.
    if (!this.service) await this.openLineage(this.delegate.committedPresent, "opened");
    const boardDigest = canonicalLineageDigest(this.delegate.committedPresent);
    const headDigest = canonicalLineageDigest(this.service!.currentProject().pcb);
    if (boardDigest !== headDigest) {
      await this.openLineage(this.delegate.committedPresent, "rebased", undefined, "Editor board diverged from the canonical head (legacy-path mutation); rebased onto the current board.");
    }
  }

  private async runReplay(request: CanonicalReplayRequest): Promise<CanonicalCommitResult> {
    type RejectionCode = Extract<CanonicalCommitResult, { ok: false }>["reasonCode"];
    const refuse = (reasonCode: RejectionCode, message: string, diagnostics: string[] = []): CanonicalCommitResult => {
      this.record({ kind: "rejected", detail: `granted ${request.direction} of ${request.referencedTransactionId}: ${reasonCode} — ${message}` });
      return { ok: false, status: "rejected", reasonCode, message, diagnostics };
    };
    // NO lineage repair here: a replay under a grant is bound to the lineage it was issued against — a diverged board refuses.
    if (!this.service || !this.executor) return refuse("stale_revision", "The canonical session has no open lineage. Nothing was changed.");
    const service = this.service;
    if (canonicalLineageDigest(this.delegate.committedPresent) !== canonicalLineageDigest(service.currentProject().pcb)) return refuse("stale_revision", "The editor board diverged from the canonical head. Nothing was changed.");
    const head = service.currentRevision();
    if (head.headSequence !== request.expectedBaseHeadSequence) return refuse("stale_revision", "The history advanced since the grant was issued. Nothing was changed.");
    if (!this.isReplayEligible(request.direction, request.referencedTransactionId)) return refuse("replay_position", `The referenced change is no longer ${request.direction}-eligible at the head. Nothing was changed.`);
    const changeSet = service.durableRecords().find((item) => item.transaction.transactionId === request.referencedTransactionId)!.appliedChangeSet!;
    const result = await this.executor.executeUndoRedo({
      referencedTransactionId: request.referencedTransactionId,
      direction: request.direction,
      actor: this.actor,
      expectedLineage: { ...this.identity, lineageId: this.lineage },
      expectedHeadRevision: head,
      expectedSourceStateDigest: (request.direction === "undo" ? changeSet.resultSemanticStateDigest : changeSet.baseSemanticStateDigest)!,
      expectedResultStateDigest: (request.direction === "undo" ? changeSet.baseSemanticStateDigest : changeSet.resultSemanticStateDigest)!,
      idempotencyKey: request.idempotencyKey,
      reason: request.label,
    });
    if (this.disposed) {
      this.record({ kind: "rejected", detail: `granted ${request.direction}: session retired while the replay was in flight — result not published.` });
      return { ok: false, status: "rejected", reasonCode: "session_retired", message: "The replay was not applied: the board was replaced while it was in flight. Nothing was changed.", diagnostics: ["SESSION_RETIRED_IN_FLIGHT"] };
    }
    // Every executor check and the dry run precede its submit: a rejection mutated nothing.
    if (result.status === "rejected") return refuse(result.reasonCode, `The canonical executor refused the ${request.direction} (${result.reasonCode}). Nothing was changed.`, result.diagnostics);
    const mapped = this.applyExecutionResult({ commandId: REPLAY_COMMAND_ID, label: request.label, metadata: request.metadata, buildOperations: () => [] }, result);
    if (mapped.ok && mapped.status === "executed") {
      await this.persistEnvelope();
      if (canonicalLineageDigest(this.delegate.committedPresent) !== canonicalLineageDigest(service.currentProject().pcb) || !this.replayResultVerified(request.direction, request.referencedTransactionId, mapped.transactionId ?? "")) {
        throw new Error("REPLAY_RESULT_UNVERIFIED");
      }
    }
    return mapped;
  }

  private async runCommit(request: CanonicalCommitRequest): Promise<CanonicalCommitResult> {
    await this.ensureLineageCurrent();
    const service = this.service!;
    const executor = this.executor!;
    const board = this.delegate.committedPresent;
    // B08 — buildOperations may REFUSE (throw) at serialized execution time
    // (unsupported delta, stale candidate pin, failed compile): a structured
    // rejection with zero mutation, never a silent fallback.
    let operations: EngineeringOperation[];
    try {
      operations = request.buildOperations(board);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.record({ kind: "rejected", detail: `${request.commandId}: build refused — ${message}` });
      return { ok: false, status: "rejected", reasonCode: "invalid", message: `"${request.label}" was refused: ${message}. Nothing was applied.`, diagnostics: [message] };
    }
    if (operations.length === 0) {
      this.record({ kind: "noop", detail: `${request.commandId}: no effective operations.` });
      return { ok: true, status: "noop" };
    }
    const expectedRevision = service.currentRevision();
    const idempotencyKey = request.idempotencyKey ?? `ui:${engineeringDigest({
      commandId: request.commandId,
      base: expectedRevision.canonicalStateDigest,
      headSequence: expectedRevision.headSequence,
      operations,
    }).slice(5)}`;

    const result = await executor.execute({
      commandId: request.commandId,
      actor: this.actor,
      expectedRevision,
      idempotencyKey,
      reason: request.label,
      operations,
      provenance: { source: "ui", toolVersion: this.buildId, ...(request.provenanceCandidateId ? { candidateId: request.provenanceCandidateId } : {}) },
    });
    // B08.1 — LINEARIZABLE retirement: if the session was retired while the
    // execution was in flight, the retired operation must not publish into
    // the (detached) editor history, mirror a durable envelope, or update
    // session metadata. The internal service state is discarded with the
    // retired session; callers receive a structured stale result.
    if (this.disposed) {
      this.record({ kind: "rejected", detail: `${request.commandId}: session retired while the commit was in flight — result not published.` });
      return { ok: false, status: "rejected", reasonCode: "session_retired", message: `"${request.label}" was not applied: the board was replaced while the action was in flight. Nothing was changed.`, diagnostics: ["SESSION_RETIRED_IN_FLIGHT"] };
    }
    const mapped = this.applyExecutionResult(request, result);
    if (mapped.ok && mapped.status === "executed") await this.persistEnvelope();
    return mapped;
  }

  private applyExecutionResult(request: CanonicalCommitRequest, result: ExecutionResult): CanonicalCommitResult {
    if (result.status === "rejected") {
      // Legacy parity: a semantically empty action is silent (no entry, no toast).
      if (result.reasonCode === "invalid" && result.diagnostics.some((item) => item === "NO_OP_TRANSACTION" || item === "NO_SEMANTIC_REVISION_CHANGE")) {
        this.record({ kind: "noop", detail: `${request.commandId}: canonical no-op.` });
        return { ok: true, status: "noop" };
      }
      const message = rejectionMessage(request, result.reasonCode, result.diagnostics);
      this.record({ kind: "rejected", detail: `${request.commandId}: ${result.reasonCode} — ${result.diagnostics.join("; ")}` });
      return { ok: false, status: "rejected", reasonCode: result.reasonCode, message, diagnostics: result.diagnostics };
    }

    const service = this.service!;
    const canonicalBoard = service.currentProject().pcb;
    const link: LineageLink = {
      transactionId: result.transactionId,
      // The entry commits from the pre-action board (still un-mutated here) —
      // that is exactly what its undo restores.
      baseLineageDigest: canonicalLineageDigest(this.delegate.committedPresent),
      resultLineageDigest: canonicalLineageDigest(canonicalBoard),
      baseSemanticDigest: result.semanticDigestBefore ?? "",
      resultSemanticDigest: result.semanticDigestAfter ?? "",
    };

    if (result.status === "idempotent_replay") {
      // The original execution already produced the entry; a duplicate submit
      // must not mutate or add a second undo step.
      this.record({ kind: "replayed", detail: `${request.commandId}: duplicate submission replayed transaction ${result.transactionId}.`, transactionId: result.transactionId });
      return {
        ok: true, status: "idempotent_replay", transactionId: result.transactionId,
        revisionBefore: result.revisionBefore, revisionAfter: result.revisionAfter,
        changeSetDigest: result.changeSetDigest,
        invalidatedArtifactKinds: result.invalidatedArtifacts.map((item) => item.artifactKind),
      };
    }

    // Canonical result becomes the editor board — ONE history entry, patches
    // computed from the pre-action (pre-transient) board.
    this.links.set(result.transactionId, link);
    // Bound like the undo stack: links older than any undoable entry are dead.
    if (this.links.size > 400) {
      const oldest = this.links.keys().next().value;
      if (oldest !== undefined) this.links.delete(oldest);
    }
    this.delegate.execute(
      request.label,
      (draft) => replaceBoardContents(draft, canonicalBoard),
      {
        ...request.metadata,
        transactionId: result.transactionId,
        details: {
          ...(request.metadata?.details ?? {}),
          b03: {
            commandId: request.commandId,
            lineageId: this.lineageId,
            headSequenceBefore: result.revisionBefore.headSequence,
            headSequenceAfter: result.revisionAfter.headSequence,
            revisionBefore: result.revisionBefore.canonicalStateDigest,
            revisionAfter: result.revisionAfter.canonicalStateDigest,
            changeSetDigest: result.changeSetDigest,
            invalidatedArtifacts: result.invalidatedArtifacts.map((item) => item.artifactKind),
          },
        },
      },
    );
    this.record({ kind: "executed", detail: `${request.commandId}: transaction ${result.transactionId} → sequence ${result.recordSequence}.`, transactionId: result.transactionId });
    return {
      ok: true, status: "executed", transactionId: result.transactionId,
      revisionBefore: result.revisionBefore, revisionAfter: result.revisionAfter,
      changeSetDigest: result.changeSetDigest,
      invalidatedArtifactKinds: result.invalidatedArtifacts.map((item) => item.artifactKind),
    };
  }

  // ── Undo/redo reconciliation ───────────────────────────────────────────────

  private makeWrappedHistory(): PcbHistory {
    const delegate = this.delegate;
    return {
      get present() { return delegate.present; },
      get committedPresent() { return delegate.committedPresent; },
      get canUndo() { return delegate.canUndo; },
      get canRedo() { return delegate.canRedo; },
      get undoLabel() { return delegate.undoLabel; },
      get redoLabel() { return delegate.redoLabel; },
      get entries() { return delegate.entries; },
      get events() { return delegate.events; },
      execute: (label, mutate, metadata) => delegate.execute(label, mutate, metadata),
      subscribe: (cb) => delegate.subscribe(cb),
      transient: (mutate) => delegate.transient(mutate),
      cancelTransient: () => delegate.cancelTransient(),
      applyDerived: (label, mutate) => delegate.applyDerived(label, mutate),
      undo: (): void => {
        const applied = delegate.entries.filter((entry) => entry.state === "applied");
        const top = applied.at(-1);
        delegate.undo(); // synchronous patch undo — the UI contract
        if (top) void this.scheduleReconcile(top.metadata.transactionId, "undo", top.label);
      },
      redo: (): void => {
        const redoTop = delegate.entries.filter((entry) => entry.state === "redo").at(-1);
        delegate.redo(); // synchronous patch redo — the UI contract
        if (redoTop) void this.scheduleReconcile(redoTop.metadata.transactionId, "redo", redoTop.label);
      },
    };
  }

  private scheduleReconcile(transactionId: string | undefined, direction: "undo" | "redo", label: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.service || !this.executor) return;
      const link = transactionId ? this.links.get(transactionId) : undefined;
      const boardDigest = canonicalLineageDigest(this.delegate.committedPresent);
      if (!link) {
        // Legacy entry (or pre-rebase entry): the patch undo/redo is the
        // authority; realign the lineage deterministically.
        if (boardDigest !== canonicalLineageDigest(this.service.currentProject().pcb)) {
          await this.openLineage(this.delegate.committedPresent, "reconcile-rebased", undefined, `${direction} of a non-canonical entry ("${label}") — lineage rebased onto the restored board.`);
        }
        return;
      }
      const head = this.service.currentRevision();
      const headBoardDigest = canonicalLineageDigest(this.service.currentProject().pcb);
      const expectedPre = direction === "undo" ? link.resultLineageDigest : link.baseLineageDigest;
      const expectedPost = direction === "undo" ? link.baseLineageDigest : link.resultLineageDigest;
      if (headBoardDigest !== expectedPre || boardDigest !== expectedPost) {
        await this.openLineage(this.delegate.committedPresent, "reconcile-rebased", undefined, `${direction} of transaction ${link.transactionId} outside its lineage position — rebased instead of guessing.`);
        return;
      }
      const occurrence = (this.reconcileCounts.get(`${direction}:${link.transactionId}`) ?? 0) + 1;
      this.reconcileCounts.set(`${direction}:${link.transactionId}`, occurrence);
      // B03.1: verified replay — the adapter references the durable
      // transaction; the EXECUTOR selects and verifies the authoritative
      // operations. Nothing here can inject or alter replay operations.
      const result = await this.executor.executeUndoRedo({
        referencedTransactionId: link.transactionId,
        direction,
        actor: this.actor,
        expectedLineage: { ...this.identity, lineageId: this.lineage },
        expectedHeadRevision: head,
        expectedSourceStateDigest: direction === "undo" ? link.resultSemanticDigest : link.baseSemanticDigest,
        expectedResultStateDigest: direction === "undo" ? link.baseSemanticDigest : link.resultSemanticDigest,
        idempotencyKey: `${direction}:${link.transactionId}:${occurrence}`,
        reason: `${direction === "undo" ? "Undo" : "Redo"} ${label}`,
      });
      // B08.1 — retirement during the replay must not touch the detached
      // history's lineage bookkeeping or mirror an envelope.
      if (this.disposed) return;
      const reconciled = result.status !== "rejected" && canonicalLineageDigest(this.service.currentProject().pcb) === boardDigest;
      if (!reconciled) {
        await this.openLineage(this.delegate.committedPresent, "reconcile-rebased", undefined, `Canonical ${direction} of ${link.transactionId} failed (${result.status === "rejected" ? result.reasonCode : "digest mismatch"}); rebased onto the editor board.`);
        return;
      }
      this.record({
        kind: direction === "undo" ? "undo-reconciled" : "redo-reconciled",
        detail: `${direction} of ${link.transactionId} recorded as canonical transaction ${result.transactionId}.`,
        transactionId: result.transactionId,
      });
      await this.persistEnvelope();
    });
  }
}

/** Repair-transaction pattern: replace a draft board's contents wholesale. */
function replaceBoardContents(target: PcbBoard, source: PcbBoard): void {
  const targetRecord = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(targetRecord)) if (!(key in source)) delete targetRecord[key];
  Object.assign(target, structuredClone(source));
}

// ─── EditCommand → canonical operations (Path B) ─────────────────────────────

function allRefs(refs: SelectionRef[], kinds: ReadonlyArray<SelectionRef["kind"]>): boolean {
  return refs.length > 0 && refs.every((ref) => kinds.includes(ref.kind));
}

function sameKindRefs(refs: SelectionRef[]): SelectionRef["kind"] | null {
  if (refs.length === 0) return null;
  const kind = refs[0].kind;
  return refs.every((ref) => ref.kind === kind) ? kind : null;
}

const REF_KIND_COMMANDS: Partial<Record<SelectionRef["kind"], string>> = {
  footprint: "pcb.move-footprint",
  via: "pcb.edit-via",
  track: "pcb.edit-track",
  zone: "pcb.zone",
  text: "pcb.silkscreen-text",
};

/**
 * B08 — classify ONE EditCommand batch to the B01 command it executes
 * under. Every EditCommand op is covered; `null` means the batch mixes
 * command classes — such a batch must run under an explicitly DECLARED
 * compound command (pcb.assist-edit) or is refused. There is NO legacy
 * fallback for session-bound histories.
 */
export function planCanonicalEdits(cmds: EditCommand[]): { commandId: string } | null {
  if (cmds.length === 0) return null;
  const commandIds = new Set<string>();
  for (const cmd of cmds) {
    switch (cmd.op) {
      case "delete-items":
        if (!allRefs(cmd.refs, ["track", "via", "zone", "text", "dimension"])) return null;
        commandIds.add("pcb.delete-item");
        break;
      case "set-track-width":
        if (cmd.ids.length === 0) return null;
        commandIds.add("pcb.edit-track");
        break;
      case "set-item-layer": {
        const kind = sameKindRefs(cmd.refs);
        const commandId = kind === "track" ? "pcb.edit-track" : kind === "zone" ? "pcb.zone" : kind === "text" ? "pcb.silkscreen-text" : null;
        if (!commandId) return null;
        commandIds.add(commandId);
        break;
      }
      case "set-position": {
        const commandId = REF_KIND_COMMANDS[cmd.ref.kind];
        if (!commandId || cmd.ref.kind === "zone") return null;
        commandIds.add(cmd.ref.kind === "text" ? "pcb.silkscreen-text" : cmd.ref.kind === "via" ? "pcb.edit-via" : "pcb.move-footprint");
        break;
      }
      case "move-items":
      case "rotate-items": {
        const kind = sameKindRefs(cmd.refs);
        const commandId = kind ? REF_KIND_COMMANDS[kind] : null;
        if (!commandId) return null;
        commandIds.add(cmd.op === "rotate-items" && kind === "footprint" ? "pcb.rotate-side-footprint" : commandId);
        break;
      }
      case "set-footprint-props":
        if (cmd.patch.locked !== undefined) {
          // Protection is its own command/capability; a patch mixing locked
          // with rotation/side crosses command classes.
          if (cmd.patch.rotationDeg !== undefined || cmd.patch.side !== undefined) return null;
          commandIds.add("pcb.protection");
        } else {
          if (cmd.patch.rotationDeg === undefined && cmd.patch.side === undefined) return null;
          commandIds.add("pcb.rotate-side-footprint");
        }
        break;
      case "set-zone-props":
        commandIds.add("pcb.zone");
        break;
      case "set-text-props":
        commandIds.add("pcb.silkscreen-text");
        break;
      case "align":
      case "distribute":
      case "snap-to-grid":
        if (!allRefs(cmd.refs, ["footprint"])) return null;
        commandIds.add("pcb.arrange");
        break;
      case "create-padstack":
      case "edit-padstack":
      case "delete-padstack":
      case "set-via-padstack":
        commandIds.add("pcb.padstack");
        break;
      case "set-copper-locked":
        commandIds.add("pcb.protection");
        break;
      default:
        return null;
    }
  }
  if (commandIds.size !== 1) return null;
  return { commandId: [...commandIds][0] };
}

// B08 — per-op operation synthesis was REPLACED by the delta compiler: the
// batch is compiled with the SAME legacy compiler (identical validation and
// mutator semantics, including padstack denormalization and silk mirror
// rules), and the compiled result board is delta-compiled into exact
// canonical operations. One implementation of the semantics, zero drift.

function rejectionMessage(request: CanonicalCommitRequest, reasonCode: ExecutionRejectionCode, diagnostics: string[]): string {
  const summary = diagnostics[0] ? ` (${diagnostics[0]})` : "";
  switch (reasonCode) {
    case "stale_revision":
      return `"${request.label}" was refused: the board changed underneath this action. Nothing was applied — retry on the current board.`;
    case "unauthorized":
      return `"${request.label}" was refused: this session is not authorized for that operation${summary}.`;
    case "persistence_failed":
      return `"${request.label}" could not be committed durably and was rolled back${summary}. The board is unchanged — retry.`;
    case "operation_mismatch":
    case "not_executable":
    case "unknown_command":
    case "non_mutating_command":
    case "release_tier_blocked":
    case "approval_required":
      return `"${request.label}" was refused by the canonical executor: ${reasonCode}${summary}.`;
    default:
      return `"${request.label}" failed validation${summary}. Nothing was applied.`;
  }
}

// ─── The migrated applyEdits funnel ──────────────────────────────────────────

/**
 * B08 — canonical `applyEdits`. For a session-bound history EVERY batch runs
 * through the canonical executor: the batch is classified to its B01
 * command (or executes under an explicitly DECLARED compound command), the
 * legacy compiler validates and materializes the result board with the
 * exact shipped semantics, and the delta compiler turns it into one
 * canonical transaction. Unsupported or mixed batches return a structured
 * refusal WITHOUT mutation — a registered semantic action never silently
 * escapes the executor (B08 confirmed defect D). Bare histories (tests,
 * server-side planning) keep the legacy path — no canonical authority
 * exists there to bypass.
 */
export async function applyEditsCanonical(
  history: PcbHistory,
  cmds: EditCommand[],
  labelOverride?: string,
  options?: {
    /** Compound command (e.g. pcb.assist-edit) a MIXED batch executes
     *  under atomically. Ignored when the batch classifies on its own. */
    declaredCommandId?: string;
  },
): Promise<EditResult> {
  const session = canonicalSessionFor(history);
  if (!session) {
    // B08.2 — a RETIRED history refuses with zero mutation; an unbound
    // history uses the legacy funnel only under the internal test-only
    // capability (pcb-bare-authority.internal — no runtime grantor exists).
    if (historyBindingState(history) === "retired" || !isBareHistoryAuthorized(history)) {
      return {
        ok: false,
        errors: [historyBindingState(history) === "retired"
          ? "This board was replaced (lifecycle) and the old editing session is retired; the edit was refused without mutation."
          : "This board has no canonical editing session and no bare-history capability; the edit was refused without mutation."],
        violations: [], label: "", diagnostics: [],
      };
    }
    return applyEdits(history, cmds, labelOverride);
  }
  if (cmds.length === 0) return { ok: true, errors: [], violations: [], label: "", diagnostics: [] };
  const plan = planCanonicalEdits(cmds);
  const commandId = plan?.commandId ?? options?.declaredCommandId ?? null;
  if (!commandId) {
    return {
      ok: false,
      errors: ["This edit batch mixes command classes and no compound command was declared; it was refused without mutation."],
      violations: [], label: "", diagnostics: [],
    };
  }
  const board = history.present;
  const compiled = compileEdits(board, cmds);
  if (compiled.errors.length > 0) {
    return { ok: false, errors: compiled.errors, violations: [], label: "", diagnostics: compiled.diagnostics };
  }
  const label = labelOverride ?? describeEdits(board, cmds);
  const result = await session.commit({
    commandId,
    label,
    buildOperations: (current) => {
      // Re-compile against the board at serialized execution time — the
      // same validation, the same mutator semantics; a batch that no longer
      // compiles refuses with zero mutation.
      const recompiled = compileEdits(current, cmds);
      if (recompiled.errors.length > 0) throw new Error(recompiled.errors[0]);
      return compilePcbBoardDelta(current, recompiled.result, commandId).operations;
    },
  });
  if (result.ok) {
    return { ok: true, errors: [], violations: [], label, diagnostics: [] };
  }
  return { ok: false, errors: [result.message], violations: [], label: "", diagnostics: [] };
}
