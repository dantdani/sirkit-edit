import { portableSnapshotIntegrityErrors } from "../atomic/portable";
import type { PortableAtomicSnapshot } from "../atomic/types";
import { resolveExactIdentity } from "./identity";
import { selectionDigest, selectionId } from "./stable";
import type { CatalogQuery, CatalogQueryResult, EngineeringCatalogSnapshot } from "./types";

export function createEngineeringCatalogSnapshot(input: { portableSnapshots: PortableAtomicSnapshot[]; recipeOverlayRevisionIds: string[]; sourceAdapterRevisionIds: string[]; publicationPolicyRevision: string; createdAt: string }): EngineeringCatalogSnapshot {
  const snapshots = structuredClone(input.portableSnapshots).sort((a, b) => a.atomicRevision.id.localeCompare(b.atomicRevision.id)); const ids = new Set<string>();
  for (const snapshot of snapshots) {
    const errors = portableSnapshotIntegrityErrors(snapshot); if (errors.length) throw new Error(`CD6_ATOMIC_SNAPSHOT_INVALID:${snapshot.atomicRevision.id}:${errors.join(",")}`);
    if (ids.has(snapshot.atomicRevision.id)) throw new Error("CD6_ATOMIC_REVISION_ID_REUSE"); ids.add(snapshot.atomicRevision.id);
    if (!snapshot.exactPart || snapshot.atomicRevision.exactPartId !== snapshot.exactPart.id) throw new Error(`CD6_EXACT_PART_REQUIRED:${snapshot.atomicRevision.id}`);
  }
  const resolutions = snapshots.map((snapshot) => resolveExactIdentity({ manufacturerId: snapshot.exactPart!.manufacturerId, mpn: snapshot.exactPart!.exactMpn, snapshots, now: input.createdAt }));
  const base: Omit<EngineeringCatalogSnapshot, "catalogSnapshotId" | "deterministicDigest"> = { atomicPartRevisionIds: snapshots.map((item) => item.atomicRevision.id), manufacturerFamilyRevisionIds: [...new Set(snapshots.flatMap((item) => item.family ? [item.family.id] : []))].sort(), cadBundleRevisionIds: [...new Set(snapshots.flatMap((item) => item.atomicRevision.cadBundles.map((bundle) => selectionDigest(bundle))))].sort(), claimEvidenceRevisionIds: [...new Set(snapshots.flatMap((item) => item.evidence.map((evidence) => evidence.id)))].sort(), recipeOverlayRevisionIds: [...input.recipeOverlayRevisionIds].sort(), modelRevisionIds: [...new Set(snapshots.flatMap((item) => item.models.map((model) => model.versionId)))].sort(), sourceAdapterRevisionIds: [...input.sourceAdapterRevisionIds].sort(), publicationPolicyRevision: input.publicationPolicyRevision, portableSnapshots: snapshots, identityResolutions: resolutions, createdAt: input.createdAt };
  const withId = { ...base, catalogSnapshotId: selectionId("engineering-catalog", base) }; return { ...withId, deterministicDigest: selectionDigest(withId) };
}
export function validateEngineeringCatalogSnapshot(value: EngineeringCatalogSnapshot): string[] { const errors: string[] = []; if (value.deterministicDigest !== selectionDigest({ ...value, deterministicDigest: undefined })) errors.push("CD6_CATALOG_DIGEST_MISMATCH"); if (value.atomicPartRevisionIds.length !== value.portableSnapshots.length || new Set(value.atomicPartRevisionIds).size !== value.atomicPartRevisionIds.length) errors.push("CD6_CATALOG_ATOMIC_MANIFEST_INVALID"); for (const snapshot of value.portableSnapshots) if (portableSnapshotIntegrityErrors(snapshot).length || !value.atomicPartRevisionIds.includes(snapshot.atomicRevision.id)) errors.push("CD6_CATALOG_PORTABLE_SNAPSHOT_INVALID"); if (value.identityResolutions.some((item) => item.deterministicDigest !== selectionDigest({ ...item, deterministicDigest: undefined }))) errors.push("CD6_CATALOG_IDENTITY_RESOLUTION_INVALID"); return [...new Set(errors)].sort(); }
export function createCatalogQuery(input: Omit<CatalogQuery, "queryId" | "deterministicDigest"> & { queryId?: string }): CatalogQuery { if (input.pageSize < 1 || input.pageSize > 256) throw new Error("CD6_CATALOG_PAGE_SIZE_INVALID"); const base = structuredClone({ ...input, queryId: input.queryId ?? selectionId("catalog-query", input) }); return { ...base, deterministicDigest: selectionDigest(base) }; }
export function queryEngineeringCatalog(snapshot: EngineeringCatalogSnapshot, query: CatalogQuery): CatalogQueryResult {
  if (query.catalogSnapshotId !== snapshot.catalogSnapshotId || query.deterministicDigest !== selectionDigest({ ...query, deterministicDigest: undefined })) throw new Error("CD6_CATALOG_QUERY_SNAPSHOT_OR_DIGEST_MISMATCH");
  const start = query.cursor ? Number.parseInt(query.cursor, 10) : 0; if (!Number.isSafeInteger(start) || start < 0) throw new Error("CD6_CATALOG_CURSOR_INVALID"); const rejected: Array<{ revisionId: string; reason: string }> = [];
  const matches = snapshot.portableSnapshots.filter((item) => {
    const revision = item.atomicRevision;
    const categoryClaim = item.claims.find((claim) => claim.property === "category" && ["source_backed", "verified"].includes(claim.state) && typeof claim.value === "string");
    const category = item.genericDevice?.category ?? (typeof categoryClaim?.value === "string" ? categoryClaim.value : undefined);
    if (revision.publicationState !== "published" || !item.exactPart || item.exactPart.state !== "active") { rejected.push({ revisionId: revision.id, reason: "identity_not_published_active" }); return false; }
    if (query.categories.length && (!category || !query.categories.includes(category))) { rejected.push({ revisionId: revision.id, reason: "category_mismatch" }); return false; }
    if (query.exactAtomicRevisionIds.length && !query.exactAtomicRevisionIds.includes(revision.id)) { rejected.push({ revisionId: revision.id, reason: "exact_revision_filter" }); return false; }
    if (query.manufacturerIds.length && (!item.manufacturer || !query.manufacturerIds.includes(item.manufacturer.id))) { rejected.push({ revisionId: revision.id, reason: "manufacturer_filter" }); return false; }
    return true;
  }).sort((a, b) => a.atomicRevision.id.localeCompare(b.atomicRevision.id));
  const page = matches.slice(start, start + query.pageSize); const next = start + page.length < matches.length ? String(start + page.length) : undefined; const base: Omit<CatalogQueryResult, "deterministicDigest"> = { queryId: query.queryId, catalogSnapshotId: snapshot.catalogSnapshotId, atomicRevisionIds: page.map((item) => item.atomicRevision.id), rejectedRevisionIds: rejected.sort((a, b) => a.revisionId.localeCompare(b.revisionId)), nextCursor: next, explainPlan: ["pinned_snapshot", "published_exact_identity", "category", "exact_revision", "manufacturer", "stable_revision_order", "bounded_page", "hard_predicates_deferred_to_gate_pipeline"], searchCoverageState: next ? "bounded" : "exhaustive_snapshot" }; return { ...base, deterministicDigest: selectionDigest(base) };
}
