/**
 * B08 — the ONE canonical PCB commit gateway for candidate-producing UI
 * surfaces (route tool, zone tool, silk tool, plane dialog, outline/stackup
 * controls, rules panel, placement settings, auto-place, autoroute import,
 * repair apply, autonomous-layout commit).
 *
 * Callers keep their shipped domain semantics: `buildCandidate(board)` runs
 * the SAME pure mutator they always used against the board at serialized
 * execution time; the gateway delta-compiles the candidate into exact
 * canonical operations and commits ONE transaction through the bound
 * `CanonicalEditorSession` — one PcbHistory entry, structured
 * executed/noop/refused/stale outcomes, never mutate-first-reconcile-later,
 * never a whole-board write, never a silent legacy fallback.
 *
 * B08.1/B08.2 — history binding states are explicit: ACTIVE histories
 * commit canonically; RETIRED histories (their session was disposed by a
 * lifecycle replacement) refuse with `session_retired` and zero mutation;
 * genuinely UNBOUND histories refuse with `canonical_authority_missing`
 * unless the internal TEST-ONLY capability
 * (`pcb-bare-authority.internal.ts`) was granted — no production runtime
 * grants it, and the capability is not reachable from any public export.
 * The B08 source tripwire keeps product surfaces from acquiring new raw
 * writes; the B08.2 boundary gate pins the internal module's importers.
 */

import type { PcbHistory, PcbHistoryMetadata } from "../pcb/history";
import type { PcbBoard } from "../pcb/types";
import { canonicalSessionFor, historyBindingState, type CanonicalCommitResult } from "./editor-adapter";
import { isBareHistoryAuthorized } from "./pcb-bare-authority.internal";
import { compilePcbBoardDelta } from "./pcb-delta";

// B08.2 — bare-history mutation authority is an INTERNAL capability
// (pcb-bare-authority.internal.ts), deliberately NOT re-exported here or
// from the engineering barrel: no product/runtime surface can mint it.

function staleRefusal(label: string, state: "retired" | "unbound"): CanonicalCommitResult {
  // B08.2 taxonomy: a retired history (its session WAS canonical and a
  // lifecycle replacement disposed it) is distinct from a never-bound
  // history that simply lacks any mutation authority.
  return state === "retired"
    ? {
        ok: false, status: "rejected", reasonCode: "session_retired",
        message: `"${label}" was not applied: this board was replaced (lifecycle) and the old editing session is retired. Nothing was changed.`,
        diagnostics: ["HISTORY_RETIRED"],
      }
    : {
        ok: false, status: "rejected", reasonCode: "canonical_authority_missing",
        message: `"${label}" was not applied: this board has no canonical editing session and no bare-history capability. Nothing was changed.`,
        diagnostics: ["HISTORY_UNAUTHORIZED_BARE"],
      };
}

export interface PcbCandidateCommitRequest {
  /** B01 action-registry command id this commit executes under. */
  commandId: string;
  label: string;
  metadata?: Partial<PcbHistoryMetadata>;
  /** Stable idempotency pin (e.g. a candidate id); default content-derived. */
  idempotencyKey?: string;
  /** [B15.3] optional chain-protected receipt commitment recorded as the
   *  durable transaction's `provenance.candidateId` (approved-PCB apply). */
  provenanceCandidateId?: string;
  /**
   * Produce the candidate board from the board at serialized execution
   * time. Return null (or the base board unchanged) for a no-op. THROW to
   * refuse (stale candidate, failed precondition) — the gateway returns a
   * structured rejection with zero mutation.
   */
  buildCandidate(board: PcbBoard): PcbBoard | null;
}

/**
 * Commit one candidate-producing UI action canonically. Resolves with the
 * structured result; refusals carry a toast-ready `message`.
 */
export function commitPcbCandidate(history: PcbHistory, request: PcbCandidateCommitRequest): Promise<CanonicalCommitResult> {
  const session = canonicalSessionFor(history);
  if (!session) {
    // B08.1 — a RETIRED history refuses with zero mutation; an unbound
    // history mutates only under explicit planner/test authorization.
    const state = historyBindingState(history);
    if (state === "retired" || !isBareHistoryAuthorized(history)) {
      return Promise.resolve(staleRefusal(request.label, state === "retired" ? "retired" : "unbound"));
    }
    // Explicitly authorized bare history (planner/test composition only).
    try {
      const base = history.committedPresent;
      const candidate = request.buildCandidate(base);
      if (candidate === null || candidate === base) return Promise.resolve({ ok: true, status: "noop" });
      history.execute(request.label, (draft) => {
        const target = draft as unknown as Record<string, unknown>;
        for (const key of Object.keys(target)) if (!(key in candidate)) delete target[key];
        Object.assign(target, structuredClone(candidate));
      }, request.metadata);
      return Promise.resolve({ ok: true, status: "executed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Promise.resolve({ ok: false, status: "rejected", reasonCode: "invalid", message: `"${request.label}" was refused: ${message}. Nothing was applied.`, diagnostics: [message] });
    }
  }
  return session.commit({
    commandId: request.commandId,
    label: request.label,
    ...(request.metadata ? { metadata: request.metadata } : {}),
    ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
    ...(request.provenanceCandidateId ? { provenanceCandidateId: request.provenanceCandidateId } : {}),
    buildOperations: (board) => {
      const candidate = request.buildCandidate(board);
      if (candidate === null || candidate === board) return [];
      return compilePcbBoardDelta(board, candidate, request.commandId).operations;
    },
  }).catch((error: unknown) => {
    // A disposed session (lifecycle replacement raced the commit) or an
    // infrastructure failure resolves as a STRUCTURED refusal — callers
    // always receive an outcome, and a stale commit never mutates anything.
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const, status: "rejected" as const, reasonCode: "invalid" as const,
      message: `"${request.label}" was not applied: ${message}.`,
      diagnostics: [message],
    };
  });
}
