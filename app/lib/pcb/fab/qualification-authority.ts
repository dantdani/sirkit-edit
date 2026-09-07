/**
 * B16.1C §D — server-owned component/package authority for qualification.
 *
 * Reproduced defect (B16.1C pre-edit probe P5/P6): `/api/pcb/qualify`
 * derived every footprint's package class from a regular expression over the
 * footprint id string and stamped `authority: "proven"` unconditionally, so a
 * board with NO binding, footprint, or pin-mapping records at all qualified,
 * and on synchronized boards (whose `footprintId` is an opaque asset version
 * id) every part silently fell into `non_hdi_other`.
 *
 * This module replaces the guess with the physical-binding authority the
 * synchronization step already committed for each footprint:
 *
 *   board footprint.syncIdentity ──▶ selected ComponentPhysicalBinding
 *     (bindingRevisionId, footprintAssetVersionId, footprintContentDigest,
 *      mappingCertificateId, componentInstanceId must ALL match)
 *       ──▶ binding.package (identity system, canonical name, mounting,
 *            pin count) ──▶ CLOSED vocabulary ──▶ AutonomousPackageClass
 *
 * No regular expression, no substring guess: an entry either matches the
 * exact vocabulary tuple or the footprint is refused. Missing, unapproved,
 * unverified, mismatched, or conflicting authority fails CLOSED with a
 * bounded, human-readable blocker list. The result also carries a real
 * component-authority digest over the exact tuples it accepted.
 */

import type { AutonomousDesignDeclaration, AutonomousPackageClass } from "../autonomous/capability-profile";
import type { PcbBoard } from "../types";
import type { ComponentPhysicalBinding } from "../../physical-binding/types";
import type { PhysicalBindingRepository } from "../../physical-binding/repository";
import { sha256, stableJson } from "./native/stable";
import { compareCodePoints } from "@/app/lib/stable-compare";

export const QUALIFICATION_PACKAGE_VOCABULARY_VERSION = "sirkit.qualification-package-vocabulary.v1";

type Mounting = "smd" | "through_hole";

interface VocabularyEntry {
  identitySystem: ComponentPhysicalBinding["package"] extends infer P ? (P extends { identitySystem: infer S } ? S : never) : never;
  /** Exact canonical package name (as the binding authority records it), or a sourceToken for chip passives. */
  match: { canonicalName: string } | { sourceToken: string };
  mountingTechnology: Mounting;
  pinCount: number;
  packageClass: AutonomousPackageClass;
}

/**
 * The tested, closed vocabulary. Every entry corresponds to a footprint the
 * two-layer bare-board profile has actually placed, routed, and released in
 * the repository's fixtures/tests. Extending it is a reviewed code change.
 */
export const QUALIFICATION_PACKAGE_VOCABULARY: readonly VocabularyEntry[] = Object.freeze([
  { identitySystem: "metric_imperial_explicit", match: { sourceToken: "0603" }, mountingTechnology: "smd", pinCount: 2, packageClass: "passive_smd_0603_0805" },
  { identitySystem: "metric_imperial_explicit", match: { sourceToken: "0805" }, mountingTechnology: "smd", pinCount: 2, packageClass: "passive_smd_0603_0805" },
  { identitySystem: "manufacturer", match: { canonicalName: "SOIC-8 3.9x4.9mm P1.27mm" }, mountingTechnology: "smd", pinCount: 8, packageClass: "soic_tssop" },
  { identitySystem: "manufacturer", match: { canonicalName: "SOIC-14 3.9x8.7mm P1.27mm" }, mountingTechnology: "smd", pinCount: 14, packageClass: "soic_tssop" },
  { identitySystem: "manufacturer", match: { canonicalName: "SOIC-16 3.9x9.9mm P1.27mm" }, mountingTechnology: "smd", pinCount: 16, packageClass: "soic_tssop" },
  { identitySystem: "manufacturer", match: { canonicalName: "TSSOP-8 4.4x3mm P0.65mm" }, mountingTechnology: "smd", pinCount: 8, packageClass: "soic_tssop" },
  { identitySystem: "manufacturer", match: { canonicalName: "TSSOP-14 4.4x5mm P0.65mm" }, mountingTechnology: "smd", pinCount: 14, packageClass: "soic_tssop" },
  { identitySystem: "manufacturer", match: { canonicalName: "TSSOP-16 4.4x5mm P0.65mm" }, mountingTechnology: "smd", pinCount: 16, packageClass: "soic_tssop" },
  ...[1, 2, 3, 4, 5, 6].map((n): VocabularyEntry => ({ identitySystem: "manufacturer", match: { canonicalName: `PinHeader 1x0${n} P2.54mm Vertical` }, mountingTechnology: "through_hole", pinCount: n, packageClass: "through_hole_header" })),
]);

/** Exact-tuple classification. Returns "unknown" for anything outside the vocabulary. */
export function packageClassFromBinding(pkg: NonNullable<ComponentPhysicalBinding["package"]>): AutonomousPackageClass {
  for (const entry of QUALIFICATION_PACKAGE_VOCABULARY) {
    if (entry.identitySystem !== pkg.identitySystem) continue;
    if (entry.mountingTechnology !== pkg.mountingTechnology) continue;
    if (typeof pkg.pinCount !== "number" || entry.pinCount !== pkg.pinCount) continue;
    if ("canonicalName" in entry.match ? entry.match.canonicalName !== pkg.canonicalName : entry.match.sourceToken !== pkg.sourceToken) continue;
    return entry.packageClass;
  }
  return "unknown";
}

export interface QualificationAuthorityBlocker {
  code:
    | "QA_SYNC_IDENTITY_MISSING"
    | "QA_BINDING_NOT_FOUND"
    | "QA_BINDING_NOT_APPROVED"
    | "QA_BINDING_NOT_SELECTED"
    | "QA_BINDING_IDENTITY_MISMATCH"
    | "QA_MAPPING_NOT_VERIFIED"
    | "QA_PACKAGE_AUTHORITY_MISSING"
    | "QA_PACKAGE_UNSUPPORTED"
    | "QA_PACKAGE_CLASS_CONFLICT";
  message: string;
  objectIds: string[];
}

export interface QualifiedComponentTuple {
  componentInstanceId: string;
  footprintInstanceId: string;
  footprintId: string;
  bindingRevisionId: string;
  footprintAssetVersionId: string;
  footprintContentDigest: string;
  mappingCertificateId: string;
  symbolAssetVersionId: string;
  packageIdentityId: string;
  packageRevisionId: string;
  packageCanonicalName: string;
  packageClass: AutonomousPackageClass;
  exactPartId: string | null;
  atomicPartRevisionId: string | null;
}

export interface QualificationComponentAuthority {
  schemaVersion: "sirkit.qualification-component-authority.v1";
  vocabularyVersion: typeof QUALIFICATION_PACKAGE_VOCABULARY_VERSION;
  tuples: QualifiedComponentTuple[];
  footprintQualifications: AutonomousDesignDeclaration["footprintQualifications"];
  /** Digests over the sorted tuple facets — the values the release manifest binds. */
  bindingRevision: string;
  footprintLibraryRevision: string;
  mappingRevision: string;
  assemblyVariantRevision: string;
  digest: string;
}

export type QualificationAuthorityResult =
  | { ok: true; authority: QualificationComponentAuthority }
  | { ok: false; blockers: QualificationAuthorityBlocker[] };

function blocker(code: QualificationAuthorityBlocker["code"], message: string, objectIds: string[]): QualificationAuthorityBlocker {
  return { code, message, objectIds: [...new Set(objectIds)].sort() };
}

function facetDigest(kind: string, values: string[]): string {
  return `${kind}-${sha256(stableJson([...values].sort()))}`;
}

/**
 * Resolve the package/footprint/mapping authority for every footprint on the
 * board from the physical-binding repository. Pure with respect to the board;
 * read-only with respect to the repository.
 */
export async function resolveQualificationComponentAuthority(input: {
  board: PcbBoard;
  scope: { tenantId: string; projectId: string; branchId: string; boardId: string };
  bindings: Pick<PhysicalBindingRepository, "listSelectedPeers">;
}): Promise<QualificationAuthorityResult> {
  const blockers: QualificationAuthorityBlocker[] = [];
  const tuples: QualifiedComponentTuple[] = [];
  const classesByFootprintId = new Map<string, Set<AutonomousPackageClass>>();
  const variants = new Set<string>();

  for (const footprint of [...input.board.footprints].sort((a, b) => compareCodePoints(a.id, b.id))) {
    const identity = footprint.syncIdentity;
    if (!identity) {
      blockers.push(blocker("QA_SYNC_IDENTITY_MISSING", `Footprint ${footprint.ref} carries no synchronization identity (binding, footprint asset, mapping certificate).`, [footprint.id]));
      continue;
    }
    const peers = await input.bindings.listSelectedPeers({
      tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId,
      boardInstanceId: input.scope.boardId, componentInstanceId: identity.componentInstanceId, hierarchyPath: ["root"], assemblyVariantIds: [],
    });
    const binding = peers.find((candidate) => candidate.revisionId === identity.bindingRevisionId);
    if (!binding) {
      blockers.push(blocker("QA_BINDING_NOT_FOUND", `Footprint ${footprint.ref} references binding revision ${identity.bindingRevisionId} which is not the selected binding for its component.`, [footprint.id, identity.componentInstanceId]));
      continue;
    }
    if (binding.componentIdentity.componentInstanceId !== identity.componentInstanceId) {
      blockers.push(blocker("QA_BINDING_IDENTITY_MISMATCH", `Footprint ${footprint.ref} binding belongs to another component instance.`, [footprint.id, binding.revisionId]));
      continue;
    }
    if (binding.lifecycleState !== "selected") {
      blockers.push(blocker("QA_BINDING_NOT_SELECTED", `Footprint ${footprint.ref} binding is ${binding.lifecycleState}, not selected.`, [footprint.id, binding.revisionId]));
      continue;
    }
    if (binding.approval.state !== "approved") {
      blockers.push(blocker("QA_BINDING_NOT_APPROVED", `Footprint ${footprint.ref} binding is ${binding.approval.state}, not approved.`, [footprint.id, binding.revisionId]));
      continue;
    }
    const asset = binding.footprint;
    const mapping = binding.pinPadMapping;
    if (!asset || asset.assetVersionId !== identity.footprintAssetVersionId || asset.contentDigest !== identity.footprintContentDigest) {
      blockers.push(blocker("QA_BINDING_IDENTITY_MISMATCH", `Footprint ${footprint.ref} asset version or content digest differs from its binding.`, [footprint.id, binding.revisionId]));
      continue;
    }
    if (mapping.state !== "verified" || !mapping.mappingCertificateId || mapping.mappingCertificateId !== identity.mappingCertificateId) {
      blockers.push(blocker("QA_MAPPING_NOT_VERIFIED", `Footprint ${footprint.ref} pin-to-pad mapping is ${mapping.state} or does not match the synchronized certificate.`, [footprint.id, binding.revisionId]));
      continue;
    }
    const pkg = binding.package;
    if (!pkg || pkg.mountingTechnology === "unknown" || pkg.mountingTechnology === "mixed" || !pkg.canonicalName.trim()) {
      blockers.push(blocker("QA_PACKAGE_AUTHORITY_MISSING", `Footprint ${footprint.ref} binding carries no usable physical package authority.`, [footprint.id, binding.revisionId]));
      continue;
    }
    const packageClass = packageClassFromBinding(pkg);
    if (packageClass === "unknown" || packageClass === "bga_hdi") {
      blockers.push(blocker("QA_PACKAGE_UNSUPPORTED", `Footprint ${footprint.ref} package "${pkg.canonicalName}" (${pkg.mountingTechnology}, ${pkg.pinCount ?? "?"} pins) is outside the qualified vocabulary.`, [footprint.id, binding.revisionId]));
      continue;
    }
    const set = classesByFootprintId.get(footprint.footprintId) ?? new Set<AutonomousPackageClass>();
    set.add(packageClass);
    classesByFootprintId.set(footprint.footprintId, set);
    for (const variant of binding.scope.assemblyVariantIds) variants.add(variant);
    tuples.push({
      componentInstanceId: identity.componentInstanceId,
      footprintInstanceId: footprint.id,
      footprintId: footprint.footprintId,
      bindingRevisionId: binding.revisionId,
      footprintAssetVersionId: asset.assetVersionId,
      footprintContentDigest: asset.contentDigest ?? "",
      mappingCertificateId: mapping.mappingCertificateId,
      symbolAssetVersionId: identity.symbolAssetVersionId,
      packageIdentityId: pkg.packageIdentityId,
      packageRevisionId: pkg.packageRevisionId,
      packageCanonicalName: pkg.canonicalName,
      packageClass,
      exactPartId: binding.exactPart?.exactPartId ?? null,
      atomicPartRevisionId: binding.exactPart?.atomicPartRevisionId ?? null,
    });
  }

  for (const [footprintId, classes] of classesByFootprintId) {
    if (classes.size > 1) blockers.push(blocker("QA_PACKAGE_CLASS_CONFLICT", `Footprint asset ${footprintId} resolves to conflicting package classes (${[...classes].sort().join(", ")}).`, [footprintId]));
  }
  if (blockers.length) return { ok: false, blockers: blockers.sort((a, b) => compareCodePoints(a.code, b.code) || compareCodePoints(a.objectIds.join(","), b.objectIds.join(","))) };

  const footprintQualifications: AutonomousDesignDeclaration["footprintQualifications"] = {};
  for (const [footprintId, classes] of [...classesByFootprintId].sort(([a], [b]) => compareCodePoints(a, b))) {
    footprintQualifications[footprintId] = { packageClass: [...classes][0]!, authority: "proven" };
  }
  const sorted = [...tuples].sort((a, b) => compareCodePoints(a.componentInstanceId, b.componentInstanceId));
  const content: Omit<QualificationComponentAuthority, "digest"> = {
    schemaVersion: "sirkit.qualification-component-authority.v1",
    vocabularyVersion: QUALIFICATION_PACKAGE_VOCABULARY_VERSION,
    tuples: sorted,
    footprintQualifications,
    bindingRevision: facetDigest("bindings", sorted.map((t) => t.bindingRevisionId)),
    footprintLibraryRevision: facetDigest("footprints", sorted.map((t) => `${t.footprintAssetVersionId}|${t.footprintContentDigest}`)),
    mappingRevision: facetDigest("mappings", sorted.map((t) => t.mappingCertificateId)),
    assemblyVariantRevision: facetDigest("variants", [...variants]),
  };
  return { ok: true, authority: { ...content, digest: `qualification-authority-${sha256(stableJson(content))}` } };
}
