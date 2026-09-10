/**
 * [B17-F] The SAFE receiver for the agent's `layout_candidate_ready` event:
 * a structurally verified `sirkit.layout-candidate.v1` artifact (schema,
 * kind, digest intact) or nothing. Receiving a candidate grants nothing —
 * the editor's candidate store re-verifies its base revision, generation
 * and expiry, and only the human's Apply runs the B17-E apply path.
 */
import { LAYOUT_CANDIDATE_SCHEMA, layoutCandidateIntact, type LayoutCandidate } from "../pcb/candidates/layout-candidate";

export interface ReceivedLayoutCandidate {
  candidate: LayoutCandidate;
  runId: string | null;
  toolId: string | null;
}

export function receiveLayoutCandidateEvent(event: Record<string, unknown>): ReceivedLayoutCandidate | null {
  if (event.type !== "layout_candidate_ready") return null;
  const raw = event.candidate;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.schema !== LAYOUT_CANDIDATE_SCHEMA) return null;
  if (candidate.kind !== "placement" && candidate.kind !== "routing") return null;
  if (typeof candidate.candidateId !== "string" || typeof candidate.digest !== "string") return null;
  if (candidate.producer !== "agent") return null;
  let intact = false;
  try { intact = layoutCandidateIntact(candidate as unknown as LayoutCandidate); } catch { intact = false; }
  if (!intact) return null;
  return {
    candidate: candidate as unknown as LayoutCandidate,
    runId: typeof event.runId === "string" ? event.runId : null,
    toolId: typeof event.toolId === "string" ? event.toolId : null,
  };
}
