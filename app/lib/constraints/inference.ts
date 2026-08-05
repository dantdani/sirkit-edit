import type { PcbBoard } from "@/app/lib/pcb/types";
import type { ConstraintRelationship } from "./types";
import { stableConstraintId } from "./stable";

export interface RelationshipInferenceProposal {
  id: string;
  confidence: number;
  status: "proposed";
  reason: string;
  relationship: ConstraintRelationship;
}

/** Bounded, inspectable proposal producer. Its results are never auto-activated. */
export function inferDifferentialPairCandidates(board: PcbBoard): RelationshipInferenceProposal[] {
  const byName = new Map(board.nets.filter((net) => net.id !== 0 && net.stableId).map((net) => [net.name.toUpperCase(), net]));
  const proposals: RelationshipInferenceProposal[] = [];
  const seen = new Set<string>();
  for (const net of byName.values()) {
    const match = /^(.*?)(?:[_-]?)(P|\+)$/.exec(net.name.toUpperCase());
    if (!match || !net.stableId) continue;
    const base = match[1];
    const negative = [...byName.values()].find((candidate) => candidate.stableId && new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[_-]?)(?:N|-)$`, "i").test(candidate.name));
    if (!negative?.stableId) continue;
    const pairKey = [net.stableId, negative.stableId].sort().join("\0");
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    const relationship: ConstraintRelationship = {
      id: stableConstraintId("inferred-differential-pair", pairKey),
      revision: 1,
      kind: "differential_pair",
      members: [
        { role: "positive", targetType: "net", targetId: net.stableId, order: 0 },
        { role: "negative", targetType: "net", targetId: negative.stableId, order: 1 },
      ],
      origin: { kind: "deterministic_inference", sourceId: "net-name-pair-inference", sourceRevision: "1", confidence: 0.35, reviewState: "proposed" },
      evidenceIds: [],
      lifecycle: "draft",
    };
    proposals.push({ id: stableConstraintId("relationship-proposal", relationship), confidence: 0.35, status: "proposed", reason: `Names ${net.name} and ${negative.name} resemble differential polarity. Stable relationship approval is still required.`, relationship });
  }
  return proposals.sort((a, b) => a.id.localeCompare(b.id));
}

