/**
 * [B19-D I5e row 05] The candidate list the rerank model sees. Every catalog string is bounded and cleaned — name and MPN as
 * well as description (only description was cut before) — because the rerank decides which parts survive the trim.
 */
import type { AiPartResult } from "@/app/lib/parts-search";
import { boundUntrustedText } from "@/app/lib/untrusted-text";

export interface RerankCandidate {
  index: number;
  name: string;
  mpn: string;
  category: string;
  pinCount: number;
  description: string;
  physicalAuthority?: "verified";
  verifiedFootprint?: string;
}

export function rerankCandidatePayload(candidates: readonly AiPartResult[]): RerankCandidate[] {
  return candidates.map((candidate, index) => ({
    index,
    name: boundUntrustedText(candidate.name, 128),
    mpn: boundUntrustedText(candidate.mpn ?? "", 128),
    category: boundUntrustedText(candidate.mainCategory, 64),
    pinCount: candidate.pins.length,
    description: boundUntrustedText(candidate.description ?? "", 200),
    // Surfaced so the reranker does not demote a part that can actually be manufactured below one that has no footprint
    // authority.
    ...(candidate.physicalAuthority === "verified" ? { physicalAuthority: "verified" as const, verifiedFootprint: boundUntrustedText(candidate.verifiedFootprint ?? "", 128) } : {}),
  }));
}
