/**
 * [B16-C.4] Fabrication-rule authority — the ONE builder of the manufacturing
 * rule profile a qualification pins and a release re-validates.
 *
 * Reproduced ambiguity (OD-1): the DRC preset carried a single
 * `minAnnularRingMm 0.15` that was documented as the VIA ring, checked only on
 * vias, and copied into the release profile as "minAnnularRing" — while the
 * manufacturer states a separate, higher plated-through-hole minimum. A
 * component pad with a 0.16 mm ring therefore passed DRC and qualification.
 *
 * Contract:
 *  - the limits are read from the DRC preset (one source of truth; the
 *    release gate proves profile == enforced rules field by field);
 *  - the evidence carries source URLs, the retrieval date, the effective scope
 *    and an explicit expiry (retrieval + RULE_PROFILE_VALIDITY_DAYS);
 *  - only `jlcpcb-2l` is a qualified profile; other presets carry an inherited
 *    PTH value and are NOT buildable here (runbook: do not broaden to other
 *    manufacturers or stackups without implemented profiles and tests).
 */

import { getPreset } from "../drc/presets";
import type { DrcPresetId } from "../drc/types";
import { mmToNm } from "../units";
import { getFabPreset } from "./presets";
import { MANUFACTURING_RULE_PROFILE_SCHEMA, manufacturingRuleProfileDigest, type ManufacturingRuleProfile, type ManufacturingRuleProfileEvidence } from "./release-manifest";

/** A transcription of manufacturer limits is trusted for one year, then must be re-retrieved. */
export const RULE_PROFILE_VALIDITY_DAYS = 365;

export const QUALIFIED_RULE_PROFILE_IDS: ReadonlySet<DrcPresetId> = new Set<DrcPresetId>(["jlcpcb-2l"]);

/** `retrievedAt` + RULE_PROFILE_VALIDITY_DAYS as an ISO date (YYYY-MM-DD). */
export function ruleProfileExpiry(retrievedAt: string): string {
  const base = Date.parse(`${retrievedAt}T00:00:00.000Z`);
  if (!Number.isFinite(base)) throw new Error(`RULE_PROFILE_RETRIEVED_AT_INVALID: ${retrievedAt}`);
  return new Date(base + RULE_PROFILE_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * JLCPCB 1-2 layer capabilities as retrieved on 2026-09-09 (CONFIRMED against
 * the live page). The enforced preset stays deliberately conservative (via
 * 0.6/0.3 mm, ring 0.15 mm); the PTH ring enforces the manufacturer's
 * RECOMMENDED 0.25 mm, with the 0.18 mm absolute minimum recorded, not used.
 */
export const JLCPCB_2L_RULE_PROFILE_EVIDENCE: ManufacturingRuleProfileEvidence = Object.freeze({
  sourceRefs: Object.freeze(["https://jlcpcb.com/capabilities/pcb-capabilities"]) as unknown as string[],
  retrievedAt: "2026-09-09",
  expiresAt: ruleProfileExpiry("2026-09-09"),
  scope: "JLCPCB 1-2 layer rigid FR-4, 1 oz outer copper, plated-through-hole prototype; bare board",
  notes: Object.freeze([
    "2-layer minimum via hole size / via diameter: 0.15 mm / 0.25 mm (preferred minimum via hole 0.2 mm); the preset enforces 0.3 mm / 0.6 mm (via ring 0.15 mm).",
    "2-layer PTH annular ring, 1 oz: recommended 0.25 mm or above, absolute minimum 0.18 mm; the preset enforces the recommended 0.25 mm.",
    "PTH drill diameter 2-layer: 0.15 - 6.3 mm; NPTH minimum 0.50 mm.",
    "Hole-to-hole spacing: via 0.2 mm, pad 0.45 mm; the preset enforces 0.5 mm for both.",
    "1 oz minimum track / spacing: 0.10 / 0.10 mm; the preset enforces 0.127 / 0.127 mm.",
    "Copper clearance from routed board edges >= 0.2 mm; the preset enforces 0.3 mm.",
  ]) as unknown as string[],
});

export interface BuildManufacturingRuleProfileInput {
  presetId: DrcPresetId;
  evidence: ManufacturingRuleProfileEvidence;
  construction?: Partial<ManufacturingRuleProfile["construction"]>;
}

const JLCPCB_2L_CONSTRUCTION: ManufacturingRuleProfile["construction"] = { copperLayers: 2, copperThicknessUm: 35, boardThicknessMm: 1.6, material: "FR-4", maxBoardWidthMm: 100, maxBoardHeightMm: 80 };

export function buildManufacturingRuleProfile(input: BuildManufacturingRuleProfileInput): ManufacturingRuleProfile {
  if (!QUALIFIED_RULE_PROFILE_IDS.has(input.presetId)) throw new Error(`RULE_PROFILE_NOT_QUALIFIED: ${input.presetId} has no source-pinned manufacturing rule profile`);
  const drc = getPreset(input.presetId);
  const fab = getFabPreset(input.presetId);
  const rules = drc.rules.default;
  const content: Omit<ManufacturingRuleProfile, "digest"> = {
    schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA,
    profileId: fab.id,
    version: drc.version,
    manufacturer: drc.fab,
    processName: "Economy rigid two-layer PTH prototype",
    evidence: { sourceRefs: [...input.evidence.sourceRefs], retrievedAt: input.evidence.retrievedAt, expiresAt: input.evidence.expiresAt, scope: input.evidence.scope, notes: [...input.evidence.notes] },
    construction: { ...JLCPCB_2L_CONSTRUCTION, ...(input.construction ?? {}) },
    limitsNm: {
      minTraceWidth: rules.minTrackWidthNm,
      minSpace: rules.clearanceNm,
      minDrill: rules.minViaDrillNm,
      minFinishedHole: rules.minViaDrillNm,
      minViaAnnularRing: rules.minAnnularRingNm,
      minPthAnnularRing: rules.minPthAnnularRingNm,
      minCopperToEdge: rules.minEdgeClearanceNm,
      minHoleToEdge: rules.minEdgeClearanceNm,
      solderMaskExpansion: mmToNm(0.05),
      minSolderMaskSliver: mmToNm(0.1),
      minSilkscreenWidth: mmToNm(0.15),
      minSilkscreenClearance: rules.minSilkPadClearanceNm,
    },
    maskPolicy: { componentPads: "explicit_or_profile_opening", defaultViaTenting: "tented" },
    specialFeatures: { slots: "unsupported", castellations: "unsupported", edgePlating: "unsupported", flex: "unsupported" },
    assembly: { supported: false },
  };
  return { ...content, digest: manufacturingRuleProfileDigest(content) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Structural evidence validation shared by the release gate and the release route (no clock: the caller supplies the instant). */
export function ruleProfileEvidenceStatus(evidence: ManufacturingRuleProfileEvidence | undefined, atIso: string): "ok" | "missing" | "invalid_window" | "expired" | "not_yet_valid" {
  if (!evidence || !Array.isArray(evidence.sourceRefs) || evidence.sourceRefs.length === 0 || evidence.sourceRefs.some((ref) => typeof ref !== "string" || !/^https?:\/\//.test(ref) && !ref.startsWith("controlled:"))) return "missing";
  if (typeof evidence.scope !== "string" || evidence.scope.length === 0 || !ISO_DATE.test(evidence.retrievedAt) || !ISO_DATE.test(evidence.expiresAt)) return "missing";
  const retrieved = Date.parse(`${evidence.retrievedAt}T00:00:00.000Z`);
  const expires = Date.parse(`${evidence.expiresAt}T00:00:00.000Z`);
  const at = Date.parse(atIso);
  if (!Number.isFinite(retrieved) || !Number.isFinite(expires) || !Number.isFinite(at)) return "missing";
  if (expires <= retrieved || expires - retrieved > (RULE_PROFILE_VALIDITY_DAYS + 1) * 24 * 60 * 60 * 1000) return "invalid_window";
  if (at < retrieved) return "not_yet_valid";
  if (at > expires + 24 * 60 * 60 * 1000 - 1) return "expired"; // the expiry date itself is still valid
  return "ok";
}
