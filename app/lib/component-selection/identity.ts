import { normalizeMpnSearchKey } from "../atomic/identity";
import type { PortableAtomicSnapshot } from "../atomic/types";
import { selectionDigest, selectionId } from "./stable";
import type { ExactIdentityResolution } from "./types";

export interface EvidenceBackedAlias { manufacturerId: string; alias: string; exactManufacturerPartId: string; evidenceIds: string[]; state: "approved" | "proposed" | "rejected"; validFrom: string; validTo?: string; }
function exactPublished(value: string): string { return value.normalize("NFKC").trim().toUpperCase(); }

export function resolveExactIdentity(input: { manufacturerId: string; mpn: string; snapshots: readonly PortableAtomicSnapshot[]; aliases?: readonly EvidenceBackedAlias[]; now?: string }): ExactIdentityResolution {
  const originalMpn = input.mpn; const normalizedSearchKey = normalizeMpnSearchKey(originalMpn); const now = Date.parse(input.now ?? new Date().toISOString());
  const exact = input.snapshots.filter((snapshot) => snapshot.exactPart?.manufacturerId === input.manufacturerId && snapshot.atomicRevision.exactPartId === snapshot.exactPart.id && exactPublished(snapshot.exactPart.exactMpn) === exactPublished(originalMpn));
  const aliasMatches = (input.aliases ?? []).filter((alias) => alias.state === "approved" && alias.manufacturerId === input.manufacturerId && exactPublished(alias.alias) === exactPublished(originalMpn) && alias.evidenceIds.length && Date.parse(alias.validFrom) <= now && (!alias.validTo || Date.parse(alias.validTo) > now));
  const aliasIds = new Set(aliasMatches.map((item) => item.exactManufacturerPartId)); const candidates = [...new Set([...exact.map((item) => item.exactPart!.id), ...aliasIds])].sort();
  const snapshotCandidates = input.snapshots.filter((snapshot) => snapshot.exactPart?.manufacturerId === input.manufacturerId && candidates.includes(snapshot.exactPart.id));
  const exactActive = snapshotCandidates.filter((item) => item.exactPart?.state === "active" && item.atomicRevision.publicationState === "published");
  const prefixMatches = input.snapshots.filter((snapshot) => snapshot.exactPart?.manufacturerId === input.manufacturerId && snapshot.exactPart.normalizedSearchKey.startsWith(normalizedSearchKey) && snapshot.exactPart.normalizedSearchKey !== normalizedSearchKey);
  let state: ExactIdentityResolution["state"] = "unresolved"; let explanation = "No exact manufacturer-scoped published identity matches.";
  if (!originalMpn.trim() || normalizedSearchKey.length < 3 || (!candidates.length && prefixMatches.length)) { state = "incomplete"; explanation = "The supplied MPN is incomplete; suffix/package/grade identity is unresolved."; }
  else if (candidates.length > 1 || exactActive.length > 1) { state = "ambiguous"; explanation = "More than one exact identity is supported by the supplied identifier/aliases."; }
  else if (snapshotCandidates.some((item) => item.exactPart?.state === "revoked" || item.atomicRevision.publicationState === "revoked")) { state = "revoked"; explanation = "The resolved exact identity or atomic revision is revoked."; }
  else if (exactActive.length === 1) { state = "exact"; explanation = aliasMatches.length ? "Resolved by an approved evidence-backed alias within manufacturer namespace." : "Resolved by exact manufacturer namespace and published MPN."; }
  const selected = exactActive.length === 1 ? exactActive[0] : undefined;
  const base: Omit<ExactIdentityResolution, "resolutionId" | "deterministicDigest"> = { manufacturerId: input.manufacturerId, originalMpn, normalizedSearchKey, exactManufacturerPartId: selected?.exactPart?.id, atomicPartRevisionId: selected?.atomicRevision.id, state, aliasEvidenceIds: [...new Set(aliasMatches.flatMap((item) => item.evidenceIds))].sort(), candidateExactPartIds: candidates, explanation };
  const withId = { ...base, resolutionId: selectionId("identity-resolution", base) }; return { ...withId, deterministicDigest: selectionDigest(withId) };
}
