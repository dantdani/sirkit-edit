/**
 * [B18-B] The browser ritual for a server-minted execution grant — the B15.3
 * approved-apply order, re-derived for grants (never imported from
 * `approved-pcb-mutations`, whose importer set is pinned):
 *
 *  capture + re-derive digests → expiry → live authority (current lifecycle,
 *  interlock, scope, canonical session) → in-memory claim → journal lookup +
 *  canonical evidence (recovery disposition FIRST) → live currency (revision,
 *  head, lineage, validation policy, selection) → RECOMPILE through the shared
 *  builder and byte-match → durable PREPARE (attempt nonce → attempt id →
 *  commitment) → CONSUME on the server (one compare-and-set burn; a refusal
 *  changes nothing) → journal grant-consumed → commit lease → EXACTLY ONE
 *  canonical transaction (idempotencyKey = grantId, provenance = commitment,
 *  actor "ai") → postconditions → committed → adopted → receipt → autosave →
 *  SETTLE on the server from the receipt.
 *
 * Every refusal before the consume leaves the grant issued and the board
 * untouched; every failure after the consume settles truthfully
 * (`not-committed` when nothing landed, `poisoned` when a landed commit
 * cannot be verified) — the awaited run never learns "executed" from
 * anything but the settled durable record.
 */
import { pcbBoardInstanceId } from "../pcb/board-identity";
import { pcbRevisionId } from "../pcb/revision";
import { resolvePcbValidationPolicy } from "../pcb/proposal/sealed-pcb-edit-proposal";
import { runDrc } from "../pcb/drc/run-drc";
import type { DrcPresetId } from "../pcb/drc/types";
import type { PcbHistory } from "../pcb/history";
import type { PcbBoard } from "../pcb/types";
import { refillZoneFillsAtomically, zoneFillIsCurrent } from "../pcb/zones/fill-lifecycle"; // [B18-C review 2]
import type { ExecutionGrantTransport, TenderBody } from "../project/execution-grant-client";
import type { ProjectSelectorScope } from "../project/project-selector";
import { AgentExecutionJournal, buildExecutionReceipt, type AgentExecutionJournalEntry, type ExecutionReceipt } from "./agent-execution-journal";
import { canonicalSessionFor, historyBindingState, type CanonicalEditorSession } from "./editor-adapter";
import { GRANT_SETTLE_GRACE_MS, attemptIdFor, isExecutionFamily, parsePublicExecutionGrant, verifyPublicGrantCoherence, REPLAY_FAMILY } from "./execution-grant";
import { buildExecutionOperations, planFromOperations, type BuiltExecution } from "./execution-operations";
import { canonicalLineageDigest } from "./semantic-board-digest"; // [B18-C review]
import { KERNEL_OPERATION_BINDINGS } from "./executor";
import type { ProjectCommitInterlock } from "./project-commit-interlock";
import type { EngineeringOperation } from "./types";

export const GRANTED_EXECUTION_CONFIRM_ACTION = "granted-execution-card:confirm" as const;

// ── the in-memory claim registry (a COPY of the B15.3 registry; never shared) ──
type RegistryState = { state: "in-flight" } | { state: "consumed"; receipt: ExecutionReceipt } | { state: "poisoned" };
export class GrantedExecutionRegistry {
  private readonly states = new Map<string, RegistryState>();
  claim(identityKey: string): { ok: true } | { ok: false; code: "already-in-flight" | "identity-poisoned" } | { ok: false; code: "already-applied"; receipt: ExecutionReceipt } {
    const existing = this.states.get(identityKey);
    if (existing?.state === "in-flight") return { ok: false, code: "already-in-flight" };
    if (existing?.state === "consumed") return { ok: false, code: "already-applied", receipt: existing.receipt };
    if (existing?.state === "poisoned") return { ok: false, code: "identity-poisoned" };
    this.states.set(identityKey, { state: "in-flight" });
    return { ok: true };
  }
  release(identityKey: string): void { if (this.states.get(identityKey)?.state === "in-flight") this.states.delete(identityKey); }
  consume(identityKey: string, receipt: ExecutionReceipt): void { this.states.set(identityKey, { state: "consumed", receipt }); }
  poison(identityKey: string): void { this.states.set(identityKey, { state: "poisoned" }); }
}
export const grantedExecutionRegistry = new GrantedExecutionRegistry();

export type GrantedExecutionRefusalCode =
  | "grant-invalid" | "grant-expired" | "confirmation-required" | "session-superseded" | "foreign-scope"
  | "already-in-flight" | "identity-poisoned" | "recovery-required"
  | "stale-revision" | "stale-history" | "stale-lineage" | "stale-selection" | "policy-mismatch" | "recompile-mismatch"
  | "consume-refused" | "commit-rejected" | "execution-failed";

export type GrantedExecutionOutcome =
  /** [B18-D I4] `validations` and `undoEligible`: exactly what the server settlement received — the checks the editor ran on the
   *  committed board (null for an execution that was already applied) and whether it is still the latest, undoable change. */
  | { ok: true; status: "committed" | "already-applied"; receipt: ExecutionReceipt; autosaveSettled: boolean; settled: "settled" | "settle-failed"; validations: { drc: { ran: boolean; violations: number } } | null; undoEligible: boolean }
  /** `changed`: whether the board changed (true only after a landed commit that could not be verified). */
  | { ok: false; status: "refused"; code: GrantedExecutionRefusalCode; message: string; changed: boolean; serverCode: string | null };

export interface GrantedExecutionInput {
  /** The received public grant (bounded, re-parsed here; never trusted by reference). */
  grant: unknown;
  /** The human's explicit confirmation click for a preview_then_confirm grant; null for execute_explicit. */
  confirmation: { actionId: string } | null;
  history: PcbHistory;
  interlock: ProjectCommitInterlock;
  journal: AgentExecutionJournal;
  transport: ExecutionGrantTransport;
  stillCurrent(): boolean;
  tenantId?: string;
  currentProjectId: string;
  currentBranchId: string;
  activeDrcPresetId: string;
  /** The live selection digest (view-session/targets) when the grant's targets were resolved from a selection. */
  liveSelectionDigest?: () => string | null;
  originRunId: string | null;
  registry?: GrantedExecutionRegistry;
  settleAutosave?: () => boolean;
  now?: () => number;
  /** Test seam: the 32-hex attempt nonce. */
  attemptNonce?: () => string;
  signal?: AbortSignal;
}

const refuse = (code: GrantedExecutionRefusalCode, message: string, extra: { changed?: boolean; serverCode?: string | null } = {}): GrantedExecutionOutcome =>
  ({ ok: false, status: "refused", code, message, changed: extra.changed ?? false, serverCode: extra.serverCode ?? null });

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* [B18-C I5] the grant's plan is re-derived by `planFromOperations` (execution-operations.ts) — the ONE inverse. */

async function withRetry<T extends { ok: boolean; status: number | null }>(call: () => Promise<T>): Promise<T> {
  const first = await call();
  if (first.ok || first.status !== null) return first; // a server answer (even a refusal) is final; only transport failures retry once
  return call();
}

/** The settle exchange, best-effort with one retry; never throws. A successful COMMITTED report marks the journal entry settled (when a journal is given). */
async function settleOnServer(input: { transport: ExecutionGrantTransport; scope: ProjectSelectorScope; entry: Pick<AgentExecutionJournalEntry, "grantId" | "grantDigest" | "attemptId" | "commitment" | "identityKey">; settlement: TenderSettlement; signal?: AbortSignal; journal?: AgentExecutionJournal }): Promise<boolean> {
  try {
    const result = await withRetry(() => input.transport.settle(input.scope, { grantId: input.entry.grantId, grantDigest: input.entry.grantDigest, attemptId: input.entry.attemptId, commitment: input.entry.commitment, settlement: input.settlement }, input.signal));
    if (result.ok && input.journal && input.settlement.outcome === "committed") { try { await input.journal.markSettled(input.entry.identityKey); } catch { /* the sweep re-sends an idempotent report */ } }
    return result.ok;
  } catch { return false; }
}
type TenderSettlement = Parameters<ExecutionGrantTransport["settle"]>[1]["settlement"];
const NOT_COMMITTED = (detail: string): TenderSettlement => ({ outcome: "not-committed", transactionId: null, revisionBefore: null, revisionAfter: null, headSequenceAfter: null, changeSetDigest: null, receiptDigest: detail.slice(0, 60) === "" ? null : null, validations: null, undoEligible: false });
const POISONED: TenderSettlement = { outcome: "poisoned", transactionId: null, revisionBefore: null, revisionAfter: null, headSequenceAfter: null, changeSetDigest: null, receiptDigest: null, validations: null, undoEligible: false };
/** [B18-C I4] `validations`: the DRC the ritual ran on the committed board (null when none ran for THIS commit — a recovery
 *  settlement); `undoEligible`: DERIVED from the live history (the latest applied entry is this transaction). */
const committedSettlement = (receipt: ExecutionReceipt, changeSetDigest: string | null, validations: TenderSettlement["validations"], undoEligible: boolean): TenderSettlement => ({ outcome: "committed", transactionId: receipt.transactionId, revisionBefore: receipt.pcbRevisionBefore, revisionAfter: receipt.pcbRevisionAfter, headSequenceAfter: receipt.headSequenceAfter, changeSetDigest, receiptDigest: receipt.receiptId, validations, undoEligible });

/**
 * [B18-C I4] The settlement's validations: the SAME DRC engine and preset rules the editor's own DRC uses (`runDrc` under the
 * grant's validation policy), run synchronously on the committed board. `violations` counts ERRORS (the fab gate's measure;
 * warnings are not counted). A preset that no longer resolves, an aborted run or an engine fault reports `ran: false` — never
 * a fabricated count. Zones whose derived fill is not current (the kernel re-marks them on a move) are evaluated once the
 * editor refills them.
 */
export function settlementValidations(board: PcbBoard, presetId: string): { drc: { ran: boolean; violations: number } } {
  const resolved = resolvePcbValidationPolicy(presetId);
  if (!resolved) return { drc: { ran: false, violations: 0 } };
  try {
    // [B18-C review 2] the kernel empties every zone fill it re-marks, and a net whose pour is not current is "unknown" to the
    // connectivity check (its incomplete-net errors are skipped) — so the count is taken on the board the editor holds once its
    // refill lands: the same pure refill (computeZoneFillCandidate / applyZoneFillCandidate) its zone-fill hook runs.
    const evaluated = board.zones.some((zone) => !zoneFillIsCurrent(board, zone)) ? refillZoneFillsAtomically(board) : board;
    const result = runDrc(evaluated, resolved.rules, { presetId: presetId as DrcPresetId }); // the resolver just proved it names a real preset
    if (result.execution !== "completed") return { drc: { ran: false, violations: 0 } };
    return { drc: { ran: true, violations: result.violations.filter((violation) => violation.severity === "error").length } };
  } catch {
    return { drc: { ran: false, violations: 0 } };
  }
}

/** [B18-C I4] Undo eligibility DERIVED from the live history: undo is available and the latest applied entry is this transaction.
 *  [B18-C review 2] only the LIVE bound history counts — a board-lifecycle adoption retires the session, and the editor's Undo
 *  can no longer reach the change even though the retired history still lists it. */
export function undoEligibleFor(history: PcbHistory, transactionId: string): boolean {
  if (historyBindingState(history) !== "active") return false;
  if (!history.canUndo) return false;
  const applied = history.entries.filter((entry) => entry.state === "applied");
  return applied.at(-1)?.metadata.transactionId === transactionId;
}

/** [B18-C I8] The provenance a landed commit of this entry carries: the chain-protected commitment for a builder family; for a
 *  replay, the executor's own link `<direction>:<referenced transaction>` (the replay is bound to its grant by the idempotency
 *  key — the grant id — which is exactly what the evidence lookup matches). */
function expectedProvenanceFor(entry: AgentExecutionJournalEntry): string {
  const replay = entry.family === REPLAY_FAMILY ? entry.grant.binding.proposal.replay : undefined;
  return replay ? `${replay.direction}:${replay.referencedTransactionId}` : entry.commitment;
}

/** [B18-C review 3] The live board's revision while it still IS `transactionId`'s result (its zone fills as the editor holds
 *  them); null once anything moved past it — the caller then records the revision the grant pinned. */
function liveRevisionAfterFor(session: CanonicalEditorSession, history: PcbHistory, transactionId: string): string | null {
  const live = history.committedPresent;
  return session.headMetadataFor(live)?.headTransactionId === transactionId ? pcbRevisionId(live) : null;
}

/** Adopt a landed commit proven by canonical evidence: committed → adopted → receipt; returns the receipt. */
async function adoptProvenCommit(input: { journal: AgentExecutionJournal; entry: AgentExecutionJournalEntry; evidence: { transactionId: string; resultHeadSequence: number | null; resultCanonicalStateDigest: string | null; provenanceCandidateId: string | null }; now: number; liveRevisionAfter: string | null }): Promise<{ ok: true; receipt: ExecutionReceipt } | { ok: false; kind: "mismatch" | "journal"; detail: string }> {
  const { journal, entry, evidence } = input;
  if (evidence.provenanceCandidateId !== expectedProvenanceFor(entry)) return { ok: false, kind: "mismatch", detail: "the canonical record's chain-protected commitment does not match this grant's journal entry" };
  if (evidence.resultHeadSequence !== null && evidence.resultHeadSequence !== entry.baseHeadSequence + 1) return { ok: false, kind: "mismatch", detail: "the canonical record's result head does not match the expected single advance" };
  let current = entry;
  if (current.state === "grant-consumed") {
    // The grant pinned the exact revision its operations produce from the base; a proven single advance under this commitment landed exactly that.
    // [B18-C review 3] ... in the fill-normalized domain: while the live board still IS the proven result, its own revision is recorded.
    const revisionAfter = input.liveRevisionAfter ?? entry.grant.binding.proposal.expectedPcbRevisionAfter;
    const marked = await journal.markCommitted(entry.identityKey, { committedAt: input.now, transactionId: evidence.transactionId, pcbRevisionBefore: entry.basePcbRevisionId, pcbRevisionAfter: revisionAfter, headSequenceAfter: entry.baseHeadSequence + 1 });
    if (!marked.ok) return { ok: false, kind: "journal", detail: `the journal could not adopt the proven commit (${marked.reason})` };
    current = { ...current, state: "canonical-committed", committedAt: input.now, transactionId: evidence.transactionId, pcbRevisionBefore: entry.basePcbRevisionId, pcbRevisionAfter: revisionAfter, headSequenceAfter: entry.baseHeadSequence + 1 };
  }
  if (current.transactionId !== evidence.transactionId) return { ok: false, kind: "mismatch", detail: "the journal claims a different transaction than the canonical record proves" };
  if (current.state === "canonical-committed") {
    const adopted = await journal.markAdopted(entry.identityKey);
    if (!adopted.ok) return { ok: false, kind: "journal", detail: `the journal could not record the adoption (${adopted.reason})` };
    current = { ...current, state: "adopted" };
  }
  let receipt = current.receipt;
  if (!receipt) {
    receipt = buildExecutionReceipt({
      grantId: current.grantId, identityKey: current.identityKey, attemptId: current.attemptId, transactionId: current.transactionId!, committedAt: current.committedAt ?? input.now,
      pcbRevisionBefore: current.pcbRevisionBefore!, pcbRevisionAfter: current.pcbRevisionAfter!, headSequenceAfter: current.headSequenceAfter!,
      approvalActor: current.decision === "execute_explicit" ? "server-grant:execute_explicit" : "human:confirmed-preview",
      authorization: current.authorization, commitment: current.commitment,
    });
    const finalized = await journal.finalizeReceipt(entry.identityKey, receipt);
    if (!finalized.ok) return { ok: false, kind: "journal", detail: `the receipt could not be finalized (${finalized.reason})` };
  }
  return { ok: true, receipt };
}

export async function executeGrantedOperation(input: GrantedExecutionInput): Promise<GrantedExecutionOutcome> {
  const now = input.now ?? (() => Date.now());
  const registry = input.registry ?? grantedExecutionRegistry;
  const tenantId = input.tenantId ?? "local";

  // 1. Capture by bounded round trip; re-derive every digest.
  let raw: unknown;
  try { raw = JSON.parse(JSON.stringify(input.grant)); } catch { return refuse("grant-invalid", "The execution grant is not a well-formed artifact. Nothing was changed."); }
  const grant = parsePublicExecutionGrant(raw);
  if (!grant) return refuse("grant-invalid", "The execution grant failed structural verification. Nothing was changed.");
  const coherence = verifyPublicGrantCoherence(grant);
  if (!coherence.ok) return refuse("grant-invalid", `The execution grant is not coherent (${coherence.reason}). Nothing was changed.`);
  const b = grant.binding;
  if (b.session.editor !== "pcb" || !b.base.pcb || !isExecutionFamily(b.operation.family)) return refuse("grant-invalid", "The execution grant is not a PCB grant this editor can execute. Nothing was changed.");
  if (b.operation.requiresHumanApproval && !input.confirmation) return refuse("confirmation-required", "This change needs your explicit confirmation of the exact preview. Nothing was changed.");
  if (!b.operation.requiresHumanApproval && input.confirmation) return refuse("grant-invalid", "An explicit-execution grant does not take a confirmation. Nothing was changed.");
  const identityKey = grant.identityKey;
  const scope: ProjectSelectorScope = { tenantId: b.scope.tenantId, projectId: b.scope.projectId, branchId: b.scope.branchId };
  const base = b.base.pcb;
  /** An execute_explicit grant refused BEFORE the consume is cancelled durably (best-effort) so the awaiting run is answered at once instead of at the settlement timeout; preview grants stay for the human. */
  const refuseExplicit = async (code: GrantedExecutionRefusalCode, message: string): Promise<GrantedExecutionOutcome> => {
    if (b.operation.decision === "execute_explicit") { try { await input.transport.cancel(scope, { grantId: grant.grantId, grantDigest: grant.grantDigest, reason: "session_superseded" }, input.signal); } catch { /* the grant expires lazily */ } }
    return refuse(code, message);
  };

  // 2. Expiry (the server re-checks).
  if (Date.parse(b.expiresAt) <= now()) return refuse("grant-expired", "The execution grant has expired. Ask again. Nothing was changed.");

  // 3. Live authority.
  if (!input.stillCurrent()) return refuseExplicit("session-superseded", "The board or project changed while the grant was pending. Nothing was changed.");
  if (input.interlock.retired) return refuseExplicit("session-superseded", "The project is retiring; the execution was refused. Nothing was changed.");
  if (b.scope.tenantId !== tenantId || b.scope.projectId !== input.currentProjectId || b.scope.branchId !== input.currentBranchId
    || (b.scope.boardInstanceId !== null && b.scope.boardInstanceId !== pcbBoardInstanceId(input.currentProjectId))) {
    return refuseExplicit("foreign-scope", "The grant belongs to a different project, branch, or board instance. Nothing was changed.");
  }
  const session = canonicalSessionFor(input.history);
  if (!session) return refuseExplicit("session-superseded", "The board has no active canonical editing session. Nothing was changed.");

  // 4. In-memory claim.
  const claim = registry.claim(identityKey);
  if (!claim.ok) {
    if (claim.code === "already-applied") {
      // The journal, not memory, says whether the server holds the report; a finalized-but-unsettled entry is re-sent now.
      const lookup = await input.journal.lookup(identityKey);
      const finalized = lookup.kind === "entry" && lookup.entry.state === "receipt-finalized" ? lookup.entry : null;
      const undoEligible = undoEligibleFor(input.history, claim.receipt.transactionId);
      const settled = finalized ? await settleOnServer({ transport: input.transport, scope, entry: finalized, settlement: committedSettlement(claim.receipt, null, null, undoEligible), signal: input.signal, journal: input.journal }) : true;
      return { ok: true, status: "already-applied", receipt: claim.receipt, autosaveSettled: true, settled: settled ? "settled" : "settle-failed", validations: null, undoEligible };
    }
    if (claim.code === "already-in-flight") return refuse("already-in-flight", "This grant is already being executed. Nothing further was changed.");
    return refuse("identity-poisoned", "A previous execution of this grant could not be verified; it is permanently refused. Ask again.");
  }

  let leaseRelease: (() => void) | null = null;
  let committedButUnfinalized = false;
  let consumedOnServer = false; // [B18-C review V4] the server burned the grant for this attempt
  let commitAttempted = false;  // [B18-C review V4] session.commit was called
  let entryForSettle: Pick<AgentExecutionJournalEntry, "identityKey" | "grantId" | "grantDigest" | "attemptId" | "commitment"> | null = null;
  try {
    // 5. Journal + canonical evidence: the recovery disposition FIRST.
    const lookup = await input.journal.lookup(identityKey);
    const evidence = await session.durableIdempotencyEvidence(grant.grantId);
    if (lookup.kind === "unavailable" || evidence.kind === "unavailable") { registry.release(identityKey); return refuseExplicit("recovery-required", "Durable replay evidence is unavailable; the execution was not attempted. Retry when storage is available."); }
    if (lookup.kind === "corrupt" || evidence.kind === "corrupt") { registry.release(identityKey); return refuseExplicit("recovery-required", "The durable replay records for this grant are corrupt; the execution was refused. Inspect the canonical history."); }
    let entry: AgentExecutionJournalEntry | null = lookup.kind === "entry" ? lookup.entry : null;
    if (entry) {
      if (entry.grantId !== grant.grantId || entry.grantDigest !== grant.grantDigest || entry.operationsDigest !== b.proposal.operationsDigest
        || entry.authorization.principalId !== b.authorization.principalId || entry.authorization.membershipRevision !== b.authorization.membershipRevision
        || entry.basePcbRevisionId !== base.pcbRevisionId || entry.baseHeadSequence !== base.headSequence || entry.lineageId !== base.lineageId) {
        registry.release(identityKey);
        return refuse("recovery-required", "The durable journal entry for this grant is not coherent with the grant; the execution was refused. Inspect the canonical history.");
      }
      if (entry.state === "poisoned") { registry.poison(identityKey); return refuse("identity-poisoned", "A previous execution of this grant could not be verified; it is permanently refused. Ask again."); }
      if (entry.state === "abandoned") { registry.release(identityKey); return refuse("grant-invalid", `This grant was abandoned earlier (${entry.abandonReason ?? "unknown"}); nothing was changed then and nothing changes now. Ask again.`); }
      if (entry.state !== "prepared") {
        // grant-consumed / committed / adopted / finalized: the journal claims progress — the canonical history decides.
        if (evidence.kind === "found") {
          const adopted = await adoptProvenCommit({ journal: input.journal, entry, evidence: evidence.record, now: now(), liveRevisionAfter: liveRevisionAfterFor(session, input.history, evidence.record.transactionId) });
          if (!adopted.ok) {
            if (adopted.kind === "journal") { registry.release(identityKey); return refuse("recovery-required", `${adopted.detail}; the proven commit stays pending for the recovery sweep. The board HAS changed.`, { changed: true }); }
            // The ledger holds a transaction under this grant that does not match it: poison AND report it (never "nothing changed").
            registry.poison(identityKey); await input.journal.poison(identityKey);
            await settleOnServer({ transport: input.transport, scope, entry, settlement: POISONED, signal: input.signal });
            return refuse("recovery-required", `${adopted.detail}; recovery is refused. The board HAS changed — inspect the canonical history.`, { changed: true });
          }
          registry.consume(identityKey, adopted.receipt);
          const undoEligible = undoEligibleFor(input.history, adopted.receipt.transactionId);
          const settled = await settleOnServer({ transport: input.transport, scope, entry, settlement: committedSettlement(adopted.receipt, null, null, undoEligible), signal: input.signal, journal: input.journal });
          return { ok: true, status: "already-applied", receipt: adopted.receipt, autosaveSettled: true, settled: settled ? "settled" : "settle-failed", validations: null, undoEligible };
        }
        if (entry.state === "grant-consumed") {
          // Consumed, no evidence yet: another tab (or this one, moments ago) owns the commit window — zero writes.
          registry.release(identityKey);
          return refuse("already-in-flight", "This grant was consumed and its commit is in flight elsewhere. Nothing further was changed.");
        }
        registry.poison(identityKey); await input.journal.poison(identityKey);
        await settleOnServer({ transport: input.transport, scope, entry, settlement: POISONED, signal: input.signal });
        return refuse("recovery-required", "The durable journal claims a commit the canonical history cannot prove; the execution is permanently refused for this grant. Inspect the canonical history.", { changed: true });
      }
      if (evidence.kind === "found") {
        // prepared WITH evidence cannot happen truthfully (a commit needs the consume first) — never adopt.
        registry.poison(identityKey); await input.journal.poison(identityKey);
        await settleOnServer({ transport: input.transport, scope, entry, settlement: POISONED, signal: input.signal });
        return refuse("recovery-required", "A canonical transaction exists for a grant that was never consumed; recovery is refused. Inspect the canonical history.", { changed: true });
      }
    }

    // 6. Live currency — after the disposition, before anything durable.
    const liveBoard = input.history.committedPresent;
    const liveRevision = pcbRevisionId(liveBoard);
    const head = session.headMetadataFor(liveBoard);
    const liveSelection = input.liveSelectionDigest?.() ?? null;
    const drift = (): { code: GrantedExecutionRefusalCode; message: string } | null => {
      if (liveRevision !== base.pcbRevisionId) return { code: "stale-revision", message: "The board changed since the grant was issued. Ask again. Nothing was changed." };
      if (!head) return { code: "stale-revision", message: "The live board is not the canonical session head. Nothing was changed." };
      if (head.headSequence !== base.headSequence) return { code: "stale-history", message: "The board history advanced since the grant was issued. Ask again. Nothing was changed." };
      if (head.lineageId !== base.lineageId) return { code: "stale-lineage", message: "The editing session lineage changed since the grant was issued. Nothing was changed." };
      if (input.activeDrcPresetId !== base.validationPolicy.presetId) return { code: "policy-mismatch", message: `The active DRC preset (${input.activeDrcPresetId}) differs from the grant's validation policy (${base.validationPolicy.presetId}). Ask again. Nothing was changed.` };
      const resolved = resolvePcbValidationPolicy(base.validationPolicy.presetId);
      if (!resolved || String(resolved.policy.presetVersion) !== base.validationPolicy.presetVersion || resolved.policy.rulesDigest !== base.validationPolicy.rulesDigest) return { code: "policy-mismatch", message: "The grant's validation policy no longer matches the canonical preset registry. Ask again. Nothing was changed." };
      if (b.targets.resolvedFrom === "selection" && liveSelection !== null && liveSelection !== b.targets.selectionDigest) return { code: "stale-selection", message: "The selection the grant was resolved from has changed. Ask again. Nothing was changed." };
      return null;
    };
    const drifted = drift();
    if (drifted) {
      registry.release(identityKey);
      // Drift retires the grant durably so it cannot be spent later (best-effort; the server's own checks would burn it anyway).
      if (!entry) { try { await input.transport.cancel(scope, { grantId: grant.grantId, grantDigest: grant.grantDigest, reason: "session_superseded" }, input.signal); } catch { /* the grant expires lazily */ } }
      return refuse(drifted.code, drifted.message);
    }

    // 7. RECOMPILE through the shared builder against the live board; byte-match; kinds inside the family's kernel binding.
    //    [B18-C I8] a replay grant has no operations: the session confirms, from its durable records, that the referenced
    //    change is still the one to undo (the head) or to redo (the head is the undo that reverted it).
    const replay = b.operation.family === REPLAY_FAMILY ? (b.proposal.replay ?? null) : null;
    let built: BuiltExecution | null = null;
    if (b.operation.family === REPLAY_FAMILY) {
      if (!replay || !session.isReplayEligible(replay.direction, replay.referencedTransactionId)) { registry.release(identityKey); return refuseExplicit("recompile-mismatch", `The change to ${replay?.direction ?? "replay"} is no longer the latest change on the board. Ask again. Nothing was changed.`); }
    } else {
      const plan = planFromOperations(b.operation.family, b.proposal.operations);
      const rebuilt = plan ? buildExecutionOperations(liveBoard, plan) : null;
      if (!rebuilt || !rebuilt.ok) { registry.release(identityKey); return refuseExplicit("recompile-mismatch", `The grant's operations no longer compile against the live board${rebuilt && !rebuilt.ok ? ` (${rebuilt.code})` : ""}. Ask again. Nothing was changed.`); }
      if (rebuilt.operationsDigest !== b.proposal.operationsDigest || rebuilt.previewDigest !== b.proposal.previewDigest || rebuilt.resultRevision !== b.proposal.expectedPcbRevisionAfter) { registry.release(identityKey); return refuseExplicit("recompile-mismatch", "The recompiled operations do not byte-match the grant. Ask again. Nothing was changed."); }
      const allowed = (KERNEL_OPERATION_BINDINGS as Record<string, readonly string[]>)[b.operation.family] ?? [];
      if (rebuilt.operations.some((operation: EngineeringOperation) => !allowed.includes(operation.kind))) { registry.release(identityKey); return refuseExplicit("recompile-mismatch", "An operation kind is outside the family's kernel binding. Nothing was changed."); }
      built = rebuilt;
    }

    // 8. Durable PREPARE (reusing an earlier prepared attempt exactly).
    if (!entry) {
      const attemptNonce = (input.attemptNonce ?? randomNonce)();
      const preparedAt = now();
      const attemptId = attemptIdFor({ identityKey, preparedAt: new Date(preparedAt).toISOString(), attemptNonce });
      const prepared = await input.journal.prepare({
        identityKey, grantId: grant.grantId, grantDigest: grant.grantDigest, attemptNonce, attemptId, family: b.operation.family, decision: b.operation.decision, editor: "pcb",
        tenantId: b.scope.tenantId, projectId: b.scope.projectId, branchId: b.scope.branchId, boardInstanceId: pcbBoardInstanceId(input.currentProjectId), lineageId: base.lineageId,
        basePcbRevisionId: base.pcbRevisionId, baseBoardDigest: base.boardDigest, baseHeadSequence: base.headSequence, validationPolicy: { ...base.validationPolicy },
        authorization: { principalId: b.authorization.principalId, membershipRevision: b.authorization.membershipRevision }, originRunId: input.originRunId,
        operationCount: b.proposal.operationCount, operationsDigest: b.proposal.operationsDigest, previewDigest: b.proposal.previewDigest, grant, preparedAt,
      });
      if (!prepared.ok) { registry.release(identityKey); return refuseExplicit("recovery-required", `The durable journal could not record the prepare (${prepared.reason}); the execution was not attempted. Nothing was changed.`); }
      const reloaded = await input.journal.lookup(identityKey);
      if (reloaded.kind !== "entry") { registry.release(identityKey); return refuseExplicit("recovery-required", "The prepared journal entry could not be read back; the execution was not attempted. Nothing was changed."); }
      entry = reloaded.entry;
    }
    entryForSettle = entry;

    // 9–10. CONSUME on the server — the one-shot burn. A refusal changes nothing.
    const tender: TenderBody = {
      grantId: grant.grantId, grantDigest: grant.grantDigest, attemptId: entry.attemptId,
      tender: { operationsDigest: b.proposal.operationsDigest, commitment: entry.commitment, confirmation: input.confirmation ? { actionId: input.confirmation.actionId, previewDigest: b.proposal.previewDigest } : null, live: { pcbRevisionId: liveRevision, headSequence: head!.headSequence, lineageId: head!.lineageId ?? null, selectionDigest: liveSelection } },
    };
    const consumed = await withRetry(() => input.transport.tender(scope, tender, input.signal));
    if (!consumed.ok && consumed.status === null) {
      // No ANSWER (transport failure twice): the server may hold the consumption under this attempt — the entry stays
      // prepared and the recovery sweep finishes it (re-tender with the same attempt, or abandon after the window).
      registry.release(identityKey);
      return refuse("recovery-required", `The server could not be reached to execute the grant (${consumed.code}); the attempt stays recorded and recovery will finish it. Nothing has been changed by this editor.`, { serverCode: consumed.code });
    }
    if (!consumed.ok) {
      registry.release(identityKey);
      await input.journal.abandon(identityKey, `consume refused: ${consumed.code}`);
      const reason = consumed.reason ? ` (${consumed.reason})` : "";
      return refuse("consume-refused", `The server refused the execution${reason}: ${consumed.message} Nothing was changed.`, { serverCode: consumed.reason ?? consumed.code });
    }
    consumedOnServer = true;
    // 11. Journal grant-consumed.
    const markedConsumed = await input.journal.markConsumed(identityKey, { consumedAt: now() });
    if (!markedConsumed.ok) {
      registry.release(identityKey);
      await settleOnServer({ transport: input.transport, scope, entry, settlement: NOT_COMMITTED("journal"), signal: input.signal });
      await input.journal.abandon(identityKey, "journal could not record the consume");
      return refuse("recovery-required", "The grant was consumed but the durable journal could not record it; the commit was not attempted and the grant was settled as not committed. Nothing was changed.");
    }

    // 12. Commit lease around the durable-commit critical section only.
    if (!input.stillCurrent() || input.interlock.retired) {
      registry.release(identityKey);
      await settleOnServer({ transport: input.transport, scope, entry, settlement: NOT_COMMITTED("superseded"), signal: input.signal });
      await input.journal.abandon(identityKey, "session superseded before commit");
      return refuse("session-superseded", "The project changed before the commit; the grant was settled as not committed. Nothing was changed.");
    }
    const lease = input.interlock.acquireCommitLease();
    if (!lease.ok) {
      registry.release(identityKey);
      await settleOnServer({ transport: input.transport, scope, entry, settlement: NOT_COMMITTED("lease"), signal: input.signal });
      await input.journal.abandon(identityKey, "commit lease refused");
      return refuse("session-superseded", "The project is retiring; the grant was settled as not committed. Nothing was changed.");
    }
    leaseRelease = () => lease.lease.release();

    // 13. EXACTLY ONE canonical transaction; the serialized build re-pins the exact base.
    const revisionBefore = liveRevision;
    let commit: Awaited<ReturnType<CanonicalEditorSession["commit"]>>;
    commitAttempted = true;
    try {
      const metadata = { actor: "ai" as const, reason: `Granted execution ${grant.grantId} (${b.operation.decision})` };
      // [B18-C review 3] a replay's label names its direction and both sides (its "after" alone can read "(removed)").
      const label = (replay ? `AI: ${replay.direction} — ${b.proposal.preview.before} → ${b.proposal.preview.after}` : `AI: ${b.proposal.preview.after}`).slice(0, 120);
      // [B18-C I8] a replay goes through the session's verified replay path (canonical first); every other family commits
      // its grant's exact operations.
      commit = replay
        ? await session.replayUnderGrant({ direction: replay.direction, referencedTransactionId: replay.referencedTransactionId, idempotencyKey: grant.grantId, expectedBaseHeadSequence: base.headSequence, label, metadata })
        : await session.commit({
          commandId: b.operation.family,
          label,
          idempotencyKey: grant.grantId,
          provenanceCandidateId: entry.commitment,
          metadata,
          buildOperations: (board: PcbBoard) => {
            if (pcbRevisionId(board) !== base.pcbRevisionId) throw new Error("The board changed at the serialized commit position; the grant base is stale.");
            return built!.operations;
          },
        });
    } catch (error) {
      // [B18-C review V4] the commit promise REJECTED instead of answering. A disposed session rejects before its queued task
      // starts (provably nothing ran); otherwise the canonical ledger decides whether anything landed for this grant.
      const detail = error instanceof Error ? error.message : String(error);
      const neverStarted = detail === "CANONICAL_SESSION_DISPOSED";
      const evidence = neverStarted ? null : await session.durableIdempotencyEvidence(grant.grantId).catch(() => ({ kind: "unavailable" as const }));
      if (neverStarted || evidence?.kind === "absent") {
        registry.release(identityKey);
        await settleOnServer({ transport: input.transport, scope, entry, settlement: NOT_COMMITTED("threw"), signal: input.signal });
        await input.journal.abandon(identityKey, `the commit did not run: ${detail.slice(0, 80)}`);
        return refuse("commit-rejected", `The canonical commit did not run (${detail.slice(0, 120)}); the grant was settled as not committed. Nothing was changed.`);
      }
      if (evidence?.kind === "found") {
        registry.poison(identityKey); await input.journal.poison(identityKey);
        await settleOnServer({ transport: input.transport, scope, entry, settlement: POISONED, signal: input.signal });
        return refuse("recovery-required", `The commit threw (${detail.slice(0, 120)}) after a transaction landed for this grant; it could not be verified. The board HAS changed — inspect the canonical history.`, { changed: true });
      }
      // The canonical ledger cannot answer: the consumed journal entry stays for the recovery sweep, which settles from evidence.
      return refuse("recovery-required", `The commit threw (${detail.slice(0, 120)}) and the canonical ledger could not confirm the outcome; recovery will settle it. The board may have changed — check it.`, { changed: true });
    }
    if (!commit.ok || commit.status === "noop") {
      registry.release(identityKey);
      await settleOnServer({ transport: input.transport, scope, entry, settlement: NOT_COMMITTED("rejected"), signal: input.signal });
      await input.journal.abandon(identityKey, `commit ${commit.ok ? "noop" : "rejected"}`);
      return refuse("commit-rejected", commit.ok ? "The canonical executor reported no effective change; the grant was settled as not committed. Nothing was changed." : `${commit.message} The grant was settled as not committed. Nothing was changed.`);
    }
    committedButUnfinalized = true;
    const transactionId = commit.transactionId ?? "";
    if (commit.status === "idempotent_replay" || transactionId.length === 0) {
      registry.poison(identityKey); await input.journal.poison(identityKey);
      await settleOnServer({ transport: input.transport, scope, entry, settlement: POISONED, signal: input.signal });
      return refuse("recovery-required", "The commit answered without a fresh transaction identity; recovery required. The board may have changed.", { changed: true });
    }

    // 14. Postconditions on the LIVE result.
    const afterBoard = input.history.committedPresent;
    const afterHead = session.headMetadataFor(afterBoard);
    // [B18-C review V0] "exactly the grant landed" is decided in the fill-normalized semantic domain (the kernel re-marks zone
    // fills dirty and the editor may refill them before this runs); the head advance and the lineage stay exact.
    // [B18-C I8] a replay lands exactly when two durable records agree (the replay's recorded result is the referenced change's other side).
    // [B18-C review 3] ... at its RECORDED position (the single advance) on the grant's lineage — from the durable records, never
    // the live board: the user may already have pressed Undo (a later, separate step queued behind the replay).
    const headSequenceAfter = base.headSequence + 1;
    const landedExactly = replay
      ? session.replayResultVerified(replay.direction, replay.referencedTransactionId, transactionId, headSequenceAfter) && session.lineageId === base.lineageId
      : canonicalLineageDigest(afterBoard) === built!.resultLineageDigest && afterHead !== null && afterHead.headSequence === headSequenceAfter && afterHead.lineageId === base.lineageId;
    if (!landedExactly) {
      registry.poison(identityKey); await input.journal.poison(identityKey);
      await settleOnServer({ transport: input.transport, scope, entry, settlement: POISONED, signal: input.signal });
      return refuse("recovery-required", "The commit landed but its result does not match the grant; recovery required. The board HAS changed — inspect the canonical history.", { changed: true });
    }
    // The revision after is the live board's; a replay the user already stepped past records the revision its grant pinned.
    const afterRevision = replay ? (liveRevisionAfterFor(session, input.history, transactionId) ?? b.proposal.expectedPcbRevisionAfter) : pcbRevisionId(afterBoard);

    // 15–17. committed → adopted → receipt → finalized.
    const committedAt = now();
    const marked = await input.journal.markCommitted(identityKey, { committedAt, transactionId, pcbRevisionBefore: revisionBefore, pcbRevisionAfter: afterRevision, headSequenceAfter });
    if (!marked.ok) { registry.poison(identityKey); return refuse("recovery-required", "The change was committed but its durable record could not be updated; recovery required. The board HAS changed.", { changed: true }); }
    const adopted = await input.journal.markAdopted(identityKey);
    if (!adopted.ok) { registry.poison(identityKey); return refuse("recovery-required", "The change was committed but its durable adoption could not be recorded; recovery required. The board HAS changed.", { changed: true }); }
    const receipt = buildExecutionReceipt({
      grantId: grant.grantId, identityKey, attemptId: entry.attemptId, transactionId, committedAt,
      pcbRevisionBefore: revisionBefore, pcbRevisionAfter: afterRevision, headSequenceAfter,
      approvalActor: b.operation.decision === "execute_explicit" ? "server-grant:execute_explicit" : "human:confirmed-preview",
      authorization: { principalId: b.authorization.principalId, membershipRevision: b.authorization.membershipRevision }, commitment: entry.commitment,
    });
    const finalized = await input.journal.finalizeReceipt(identityKey, receipt);
    if (!finalized.ok) { registry.poison(identityKey); return refuse("recovery-required", "The change was committed but its receipt could not be finalized; recovery required. The board HAS changed.", { changed: true }); }
    registry.consume(identityKey, receipt);
    leaseRelease(); leaseRelease = null;

    let autosaveSettled = true;
    if (input.settleAutosave) { try { autosaveSettled = input.settleAutosave() === true; } catch { autosaveSettled = false; } }

    // 18. SETTLE on the server from the receipt (best-effort, one retry; the sweep re-settles from the finalized entry).
    // [B18-D I4] computed ONCE: the same checks and undo eligibility settle the server record and reach the editor's report.
    const validations = settlementValidations(afterBoard, base.validationPolicy.presetId);
    const undoEligible = input.stillCurrent() && !input.interlock.retired && undoEligibleFor(input.history, transactionId);
    const settled = await settleOnServer({ transport: input.transport, scope, entry, settlement: committedSettlement(receipt, commit.changeSetDigest ?? null, validations, undoEligible), signal: input.signal, journal: input.journal });
    return { ok: true, status: "committed", receipt, autosaveSettled, settled: settled ? "settled" : "settle-failed", validations, undoEligible };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (committedButUnfinalized) {
      registry.poison(identityKey);
      try { await input.journal.poison(identityKey); } catch { /* fail-closed already */ }
      if (entryForSettle) await settleOnServer({ transport: input.transport, scope, entry: entryForSettle, settlement: POISONED, signal: input.signal });
      return refuse("recovery-required", `The execution failed after the commit phase (${detail}); recovery required. The board may have changed.`, { changed: true });
    }
    // [B18-C review V4] burned on the server but no commit was attempted: provably nothing landed — settle it truthfully.
    if (consumedOnServer && !commitAttempted && entryForSettle) {
      registry.release(identityKey);
      await settleOnServer({ transport: input.transport, scope, entry: entryForSettle, settlement: NOT_COMMITTED("threw"), signal: input.signal });
      try { await input.journal.abandon(identityKey, `failed before the commit: ${detail.slice(0, 80)}`); } catch { /* the sweep reconciles from the server state */ }
      return refuse("execution-failed", `The execution failed before the commit (${detail}); the consumed grant was settled as not committed. Nothing was changed.`);
    }
    if (commitAttempted) {
      return refuse("recovery-required", `The execution failed around the commit (${detail}); recovery will settle it from the canonical ledger. The board may have changed — check it.`, { changed: true });
    }
    registry.release(identityKey);
    return refuse("execution-failed", `The execution failed before any commit (${detail}). Nothing was changed.`);
  } finally {
    leaseRelease?.();
  }
}

export interface GrantedExecutionRecoveryInput {
  journal: AgentExecutionJournal;
  history: PcbHistory;
  transport: ExecutionGrantTransport;
  scope: ProjectSelectorScope;
  now?: () => number;
  signal?: AbortSignal;
  /** [B18-C I10b] the in-memory claim registry the page's ritual uses (default: the same module registry). */
  registry?: GrantedExecutionRegistry;
}
export interface GrantedExecutionRecoveryResult { grantId: string; state: AgentExecutionJournalEntry["state"]; action: "adopted-and-settled" | "abandoned-not-committed" | "settled-from-receipt" | "left-in-flight" | "left-issued" | "refused-poisoned" | "unavailable"; detail: string }

/**
 * The hydration sweep (§4.6): finish what a crash interrupted, keyed by the
 * journal ENTRY (its grant, attempt and commitment) — never a new grant.
 * [B18-C I10b] It shares the ritual's claim registry: an execution THIS page is running right now is left to its own ritual
 * (the sweep once adopted and settled an in-flight execution between its consume and its commit record, and the ritual then
 * reported a landed change as "recovery required"); while the sweep works on an entry it holds the claim itself.
 */
export async function recoverGrantedExecutions(input: GrantedExecutionRecoveryInput): Promise<GrantedExecutionRecoveryResult[]> {
  const now = input.now ?? (() => Date.now());
  const registry = input.registry ?? grantedExecutionRegistry;
  const results: GrantedExecutionRecoveryResult[] = [];
  const session = canonicalSessionFor(input.history);
  const pending = await input.journal.pending();
  if (!pending.ok || !session) return [{ grantId: "-", state: "prepared", action: "unavailable", detail: pending.ok ? "no canonical session" : `journal ${pending.reason}` }];
  for (const entry of pending.entries) {
    const push = (action: GrantedExecutionRecoveryResult["action"], detail: string): void => { results.push({ grantId: entry.grantId, state: entry.state, action, detail }); };
    const claim = registry.claim(entry.identityKey);
    if (!claim.ok && claim.code === "already-in-flight") { push("left-in-flight", "this page is executing the grant right now; its own ritual settles it"); continue; }
    try {
      const evidence = await session.durableIdempotencyEvidence(entry.grantId);
      if (evidence.kind === "unavailable" || evidence.kind === "corrupt") { push("unavailable", `canonical evidence ${evidence.kind}`); continue; }
      if (entry.state === "receipt-finalized" && entry.receipt) {
        // The commit is finalized locally; only the server's report is missing — re-send it from the receipt (idempotent on the server).
        const settled = await settleOnServer({ transport: input.transport, scope: input.scope, entry, settlement: committedSettlement(entry.receipt, null, null, undoEligibleFor(input.history, entry.receipt.transactionId)), signal: input.signal, journal: input.journal });
        push("settled-from-receipt", settled ? "settled committed from the finalized receipt" : "settle failed; retry later"); continue;
      }
      if (entry.state === "prepared") {
        if (evidence.kind === "found") {
          await input.journal.poison(entry.identityKey);
          await settleOnServer({ transport: input.transport, scope: input.scope, entry, settlement: POISONED, signal: input.signal });
          push("refused-poisoned", "a transaction exists for a grant that was never consumed"); continue;
        }
        const remote = await input.transport.get(input.scope, entry.grantId, input.signal);
        if (!remote.ok) { push(remote.status === 404 ? "abandoned-not-committed" : "unavailable", remote.message); if (remote.status === 404) await input.journal.abandon(entry.identityKey, "grant unknown to the server"); continue; }
        const status = remote.body.grant.state.status;
        if (status === "issued") { push("left-issued", "the grant is still issued; re-tender or cancel it"); continue; }
        if (status === "consumed" && remote.body.grant.state.consumption?.attemptId === entry.attemptId) {
          await input.journal.markConsumed(entry.identityKey, { consumedAt: Date.parse(remote.body.grant.state.consumption.consumedAt) });
          push("left-in-flight", "the server consumed this attempt; the commit window is open"); continue;
        }
        await input.journal.abandon(entry.identityKey, `server state ${status}`); push("abandoned-not-committed", `the grant is ${status} on the server`); continue;
      }
      if (evidence.kind === "found") {
        const adopted = await adoptProvenCommit({ journal: input.journal, entry, evidence: evidence.record, now: now(), liveRevisionAfter: liveRevisionAfterFor(session, input.history, evidence.record.transactionId) });
        if (!adopted.ok) {
          if (adopted.kind === "journal") { push("unavailable", `${adopted.detail}; the proven commit stays pending`); continue; }
          await input.journal.poison(entry.identityKey);
          await settleOnServer({ transport: input.transport, scope: input.scope, entry, settlement: POISONED, signal: input.signal });
          push("refused-poisoned", adopted.detail); continue;
        }
        const settled = await settleOnServer({ transport: input.transport, scope: input.scope, entry, settlement: committedSettlement(adopted.receipt, null, null, undoEligibleFor(input.history, adopted.receipt.transactionId)), signal: input.signal, journal: input.journal });
        push(entry.state === "grant-consumed" ? "adopted-and-settled" : "settled-from-receipt", settled ? "settled committed" : "settle failed; retry later"); continue;
      }
      // grant-consumed / committed / adopted with NO canonical evidence.
      if (entry.state !== "grant-consumed") {
        await input.journal.poison(entry.identityKey);
        await settleOnServer({ transport: input.transport, scope: input.scope, entry, settlement: POISONED, signal: input.signal });
        push("refused-poisoned", "the journal claims a commit the canonical history cannot prove"); continue;
      }
      const remote = await input.transport.get(input.scope, entry.grantId, input.signal);
      const deadline = remote.ok && remote.body.grant.state.consumption ? Date.parse(remote.body.grant.state.consumption.commitDeadline) : (entry.consumedAt ?? entry.preparedAt) + 60_000;
      if (now() > deadline + GRANT_SETTLE_GRACE_MS || (remote.ok && remote.body.grant.state.status !== "consumed")) {
        await settleOnServer({ transport: input.transport, scope: input.scope, entry, settlement: NOT_COMMITTED("recovery"), signal: input.signal });
        await input.journal.abandon(entry.identityKey, "recovery: no canonical evidence after the commit window");
        push("abandoned-not-committed", "no canonical evidence after the commit window; settled not committed"); continue;
      }
      push("left-in-flight", "the commit window is still open");
    } finally {
      if (claim.ok) registry.release(entry.identityKey);
    }
  }
  return results;
}

export type { CanonicalEditorSession };
