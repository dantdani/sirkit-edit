/**
 * [B19-E E5 d] An upgrade target must be a published, never-withdrawn revision of the same logical part.
 *
 * Withdrawal is append-only (the revision row stays `published`), so the diff takes the target's catalog status as an input:
 * a deprecated, superseded or revoked target blocks, and so does a target whose own publication state is not `published`
 * (a draft, a revision in review, an approved-but-unpublished one, or an in-memory catalog's withdrawn record).
 *
 * Reproduced on the unchanged code: only `publicationState === "revoked"` blocked; a deprecated or superseded status, and every
 * unpublished state, produced a clean diff.
 */
import { describe, expect, it } from "vitest";
import { createAtomicRevision } from "../catalog";
import { diffAtomicSnapshots, diffAtomicUpgrade } from "../project";
import type { AtomicPartRevision, PortableAtomicSnapshot } from "../types";
import { blinkerCatalog, BLINKER_PART_IDS } from "@/app/lib/fixture-runtime/blinker/catalog";

function snapshotFor(partId: string, value: string): PortableAtomicSnapshot {
  const catalog = blinkerCatalog();
  return structuredClone(catalog.snapshots.get(catalog.revisionFor(partId, value)!)!);
}

function successorOf(snapshot: PortableAtomicSnapshot, patch: Partial<AtomicPartRevision> = {}): PortableAtomicSnapshot {
  const { id: _id, semanticHash: _hash, validatorVersion: _validator, schemaVersion: _schema, ...rest } = structuredClone(snapshot.atomicRevision);
  void _id; void _hash; void _validator; void _schema;
  const next = structuredClone(snapshot);
  next.atomicRevision = structuredClone(createAtomicRevision({ ...rest, revision: rest.revision + 1, policyVersion: "b19-e-e5-successor/1", ...patch })) as AtomicPartRevision;
  return next;
}

const emptyHashes = { symbolSemanticHashes: new Map<string, string>(), footprintSemanticHashes: new Map<string, string>(), mappingSemanticHashes: new Map<string, string>(), claimSemanticHashes: new Map<string, string>(), guidanceSemanticHashes: new Map<string, string>() };

describe("[B19-E E5 d] diffAtomicUpgrade blocks withdrawn and unpublished targets", () => {
  const from = snapshotFor(BLINKER_PART_IDS.resistor, "330");
  const to = successorOf(from);

  it("a published successor of the same part with identical assets has no blockers", () => {
    const diff = diffAtomicSnapshots(from, to, "published");
    expect(diff.blockers).toEqual([]);
    expect(diff).toMatchObject({ fromRevisionId: from.atomicRevision.id, toRevisionId: to.atomicRevision.id });
  });

  it.each(["deprecated", "superseded"] as const)("a %s target blocks (OD-38: withdrawn revisions are excluded from new selection)", (state) => {
    const diff = diffAtomicSnapshots(from, to, state);
    expect(diff.blockers).toContain(`target revision is ${state}`);
    expect(diff.safeForAutomaticMetadataRefresh).toBe(false);
  });

  it("a revoked target blocks and is marked revoked_target", () => {
    const diff = diffAtomicSnapshots(from, to, "revoked");
    expect(diff.blockers).toContain("target revision is revoked");
    expect(diff.impacts).toContain("revoked_target");
  });

  it.each(["quarantined", "draft", "needs_review", "approved"] as const)("an unpublished target (%s) blocks", (publicationState) => {
    const target = successorOf(from, { publicationState });
    const diff = diffAtomicUpgrade({ from: from.atomicRevision, to: target.atomicRevision, ...emptyHashes, toStatus: "published" });
    expect(diff.blockers).toContain("target revision is not published");
  });

  it.each(["deprecated", "superseded"] as const)("an in-memory catalog record in the %s state blocks without a status input", (publicationState) => {
    const target = successorOf(from, { publicationState });
    const diff = diffAtomicUpgrade({ from: from.atomicRevision, to: target.atomicRevision, ...emptyHashes });
    expect(diff.blockers).toContain(`target revision is ${publicationState}`);
  });

  it("each reason is reported once, and a different logical part still blocks", () => {
    const other = snapshotFor(BLINKER_PART_IDS.capacitor, "10uF");
    const diff = diffAtomicSnapshots(from, successorOf(other, { publicationState: "revoked" }), "revoked");
    expect(diff.blockers.filter((blocker) => blocker === "target revision is revoked")).toHaveLength(1);
    expect(diff.blockers).toContain("target is a different logical part");
  });

  it("the snapshot diff compares the real asset hashes: a changed footprint is a geometry change", () => {
    // asset versions are content-addressed: a changed footprint is a new version id with its own hash
    const changed = successorOf(from, { cadBundles: from.atomicRevision.cadBundles.map((cad) => ({ ...cad, footprintVersionId: "footprintv_changed_geometry" })) });
    changed.footprint = { ...changed.footprint!, versionId: "footprintv_changed_geometry", semanticHash: "changed-geometry" };
    const diff = diffAtomicSnapshots(from, changed, "published");
    expect(diff.impacts).toContain("footprint_geometry_change");
    expect(diff.blockers).toEqual([]);
  });
});
