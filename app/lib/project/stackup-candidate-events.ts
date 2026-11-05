/**
 * [PR-G, 2026-10-17] The SAFE receiver for the agent's `stackup_candidate_ready` event (the stackup / via-policy proposal,
 * `sirkit.stackup.propose`, app/lib/agent/stackup-proposals.ts over app/lib/pcb/candidates/stackup-candidate.ts; OD-249): a
 * structurally verified `sirkit.stackup-candidate.v1` artifact (schema, producer, ids, content digest intact) or nothing - the
 * layout-candidate receiver's pattern (app/lib/project/layout-candidate-events.ts). Receiving a candidate mutates NOTHING: the page
 * checks it against the LIVE board's revision and hands it to the PCB editor, which shows it as a PREVIEW the human accepts or
 * discards; Accept runs the editor's EXISTING stackup change (PcbEditor's Stackup selector path - one canonical `pcb.board-geometry`
 * transaction, `applyStackupProfile`), after re-checking the base revision; the candidate itself never writes the board.
 *
 * `verifyStackupCandidateAgainstBoard` is the one check both the page (at receipt) and the editor (at preview and again at Accept)
 * run: digest intact, base revision = the live board's `pcbRevisionId`, not expired. `stackupCandidateChatLine` is the page's own
 * run-log sentence for a current candidate. Pure and node-free.
 */
import { STACKUP_CANDIDATE_SCHEMA, stackupCandidateIntact, type StackupCandidate } from "../pcb/candidates/stackup-candidate";
import { auditRunId } from "./sheet-artifact-currency";

export interface ReceivedStackupCandidate {
  candidate: StackupCandidate;
  /** audit metadata only (never authority): the run that sealed it */
  runId: string | null;
}

/** Narrow an agent `stackup_candidate_ready` event payload without granting anything. */
export function receiveStackupCandidateEvent(event: Record<string, unknown> | null | undefined): ReceivedStackupCandidate | null {
  if (!event || typeof event !== "object") return null;
  if (event.type !== "stackup_candidate_ready") return null;
  const raw = event.candidate;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.schema !== STACKUP_CANDIDATE_SCHEMA || candidate.producer !== "agent") return null;
  if (typeof candidate.candidateId !== "string" || typeof candidate.digest !== "string" || typeof candidate.expiresAt !== "string") return null;
  if (typeof candidate.base !== "object" || candidate.base === null || typeof (candidate.base as { revision?: unknown }).revision !== "string") return null;
  if (typeof candidate.recommendation !== "object" || candidate.recommendation === null) return null;
  let intact = false;
  try { intact = stackupCandidateIntact(candidate as unknown as StackupCandidate); } catch { intact = false; }
  if (!intact) return null;
  return { candidate: candidate as unknown as StackupCandidate, runId: auditRunId(event.runId) };
}

export type StackupCandidateVerdict =
  | { ok: true }
  | { ok: false; code: "altered" | "no-board" | "expired" | "stale-revision"; detail: string };

/** The one check before a preview and again before Accept: intact, this board's revision, unexpired. Every refusal is a sentence. */
export function verifyStackupCandidateAgainstBoard(candidate: StackupCandidate, liveRevision: string | null, now: number): StackupCandidateVerdict {
  let intact = false;
  try { intact = stackupCandidateIntact(candidate); } catch { intact = false; }
  if (!intact) return { ok: false, code: "altered", detail: "the recommendation's digest does not match its content; nothing was changed." };
  if (liveRevision === null) return { ok: false, code: "no-board", detail: "no board is loaded in the PCB editor; nothing was changed." };
  const expires = Date.parse(candidate.expiresAt);
  if (!Number.isFinite(expires) || !(expires > now)) return { ok: false, code: "expired", detail: "the recommendation expired before it could be reviewed; ask for it again. Nothing was changed." };
  if (candidate.base.revision !== liveRevision) return { ok: false, code: "stale-revision", detail: `the board moved since the recommendation was sealed (sealed for revision ${candidate.base.revision.slice(0, 20)}, the board is at ${liveRevision.slice(0, 20)}); it is stale and was not offered. Nothing was changed.` };
  return { ok: true };
}

/** The page's own sentence for a current candidate: what it recommends against what the board has, what accepting invalidates, and
 *  that nothing changed. The qualification note is the candidate's own data (never "manufacturable"). */
export function stackupCandidateChatLine(candidate: StackupCandidate): string {
  const { base, recommendation, invalidation } = candidate;
  const current = `${base.stackup.physicalLayerCount}-layer${base.stackup.profileId ? ` ${base.stackup.profileId}` : ""} (${base.stackup.routableSignalLayerCount} routable signal)`;
  const next = `${recommendation.physicalLayerCount}-layer ${recommendation.profileId} (${recommendation.routableSignalLayerCount} routable signal${recommendation.planes.length > 0 ? `; planes ${recommendation.planes.map((plane) => `${plane.layer}=${plane.net.name}`).join(", ")}` : ""})`;
  const vias = recommendation.viaPolicy.padstacks.length === 0 ? "no via profile named" : `${recommendation.viaPolicy.padstacks.length} through-via profile${recommendation.viaPolicy.padstacks.length === 1 ? "" : "s"}${recommendation.viaPolicy.padstacks.some((entry) => !entry.meetsManufacturingMinimum) ? ", some below the preset's minimum (the preview marks each)" : ""}`;
  const change = invalidation.dependentApprovalsInvalidated ? `Accepting it changes the board's stackup${invalidation.changesLayerCount ? " and layer count" : ""} and INVALIDATES dependent approvals (${invalidation.rules.length} rules cited in the preview): placement and routing candidates retire, qualification and release re-run from scratch.` : "It matches the board's current stackup: accepting it changes nothing but records the choice.";
  return `Stackup recommendation ready — review it in the PCB editor's preview and accept or discard it; the board is unchanged until you accept. Current: ${current}. Recommended: ${next}; manufacturing preset ${recommendation.manufacturing.presetId} (${recommendation.manufacturing.releaseQualified ? "release-qualified rule profile" : "NOT release-qualified: DRC and export preflight run, the manufacturing release does not"}); ${vias}. ${change} Not validated: not DRC-checked, not routed, no impedance or signal-integrity claim.`;
}
