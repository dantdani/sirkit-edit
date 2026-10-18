/**
 * [PR-M, 2026-10-17] Section M.2.3: the COMPATIBILITY / EVIDENCE evaluation of one candidate exact revision against one schematic
 * instance - pure, deterministic, and the ONE judgement the candidate search's buckets and the resolution proposal both use.
 *
 * It compares what the circuit actually uses - the instance's connected pins with their functions (from the CURRENT catalog
 * symbol, never a browser pin list), the nets on them and the polarity they carry, the functional class of the part, and any
 * package / mounting / rating requirement stated for the task - with the candidate's server-owned evidence: the catalog part the
 * instance would be drawn from, the PUBLISHED symbol of the exact revision, its footprint's pads and mounting, the APPROVED mapping
 * certificate (symbol pin -> pad) and the revision's published engineering claims. It returns
 *
 *   compatible    every connected pin maps to exactly one candidate pin of the same function and electrical type that the approved
 *                 certificate maps to a pad, the class and every stated requirement hold, the assets are complete and selectable;
 *   incompatible  a fact contradicts the requirement (another class, a connected pin with no counterpart, a withdrawn revision, a
 *                 stated package / mounting / rating the evidence contradicts, a catalog symbol that differs from the published one);
 *   unresolved    the evidence needed to decide is absent or ambiguous (two candidate pins of one function, an unknown class, a
 *                 stated rating no published claim proves, an incomplete certificate) - never guessed into either side;
 *
 * with the reasons, the evidence it read, the exact pin mapping and whether the mapping is a PERMUTATION (proved by function, not
 * by number). Pin count, a display name or a package hint alone never makes a candidate compatible, and a compatible result is a
 * pin-function / package (/ stated-rating) match - it is never labelled full electrical equivalence: ratings nobody stated were not
 * compared, and the result says so.
 */
import type { KicadPin } from "../kicad/types";
import type { AtomicRevisionStatus } from "../atomic/revision-status";
import type { QuantityDimension } from "../atomic/types";
import type { PublishedRevisionEvidence } from "./evidence";
import { electricalTypeGroup, POLAR_TWO_TERMINAL_CLASSES, pinFunctionOf, type FunctionalClass, type PinFunction } from "./pin-functions";

export const COMPATIBILITY_SCHEMA = "sirkit.component-compatibility.v1" as const;
/** What a compatible result may claim - never more. */
export const COMPATIBILITY_EQUIVALENCE_NOTE = "a match of pin function, pin-to-pad mapping, class and the stated package / rating requirements over server-owned evidence; it is not a complete electrical equivalence proof (ratings nobody stated were not compared)" as const;
const POSITION_TOLERANCE_MM = 1e-6;
const ACCEPTED_CLAIM_STATES: ReadonlySet<string> = new Set(["source_backed", "verified"]);
/** The claim limits that can PROVE a stated requirement. A `typical` figure (and characterization-only, test-condition,
 *  configurable or derating context) is never a guarantee, so it never proves one - it leaves the requirement unproven. */
const RATING_LIMITS: ReadonlySet<string> = new Set(["absolute_maximum", "recommended_operating", "guaranteed", "nominal"]);
/** Limits whose figure is a CEILING the part withstands (a rating), not a characteristic of the part itself. */
const RATING_CEILING_LIMITS: ReadonlySet<string> = new Set(["absolute_maximum", "recommended_operating"]);

export interface RatingRequirement { property: string; dimension: QuantityDimension; min?: number; max?: number }
export interface ResolutionRequirement {
  /** The class the replacement must have; absent: the current part's own class (which must then be known). */
  functionalClass?: FunctionalClass;
  mounting?: "smd" | "through_hole";
  /** A package code the candidate's footprint name must contain (case and -/_ insensitive), e.g. "SOD-123". */
  packageCode?: string;
  ratings?: readonly RatingRequirement[];
}

export interface CurrentPinFact { number: string; name: string; electricalType: string; function: PinFunction; netName: string | null }
/** The instance side: its catalog part's symbol pins (server catalog) with the nets the sheet connects them to. */
export interface CurrentInstanceFacts {
  componentId: string;
  refDes: string;
  partId: string;
  value: string;
  functionalClass: FunctionalClass;
  pins: readonly CurrentPinFact[];
  /** The current catalog part's footprint hint - a hint, never package authority (stated as such in a warning). */
  footprintHint: string | null;
}

export interface CandidateRevisionFacts {
  catalogPartId: string;
  valueKey: string;
  link: { revisionId: string; symbolVersionId: string; footprintVersionId: string; mappingCertificateId: string; footprintFullName: string };
  /** The candidate catalog part's symbol pins (what the canvas draws once partId names it). */
  catalogPins: readonly KicadPin[];
  catalogFunctionalClass: FunctionalClass;
  catalogFunctionalClassEvidence: string;
  status: AtomicRevisionStatus | null;
  evidence: PublishedRevisionEvidence | null;
}

export type CompatibilityReasonCode =
  | "revision-unpublished" | "revision-withdrawn" | "evidence-unavailable" | "link-evidence-mismatch" | "asset-missing" | "mapping-incomplete"
  | "catalog-symbol-differs" | "functional-class-unknown" | "functional-class-mismatch" | "connected-pin-unmapped" | "ambiguous-pin-function"
  | "electrical-type-mismatch" | "pin-not-mapped-to-pad" | "pin-mapping-not-one-to-one" | "mounting-mismatch" | "package-mismatch" | "mounting-unknown"
  | "rating-violated" | "rating-unproven" | "current-pins-unavailable";

export interface PinMappingEntry { fromPin: string; toPin: string; function: string; pads: string[]; connected: boolean }

export interface CompatibilityResult {
  schema: typeof COMPATIBILITY_SCHEMA;
  verdict: "compatible" | "incompatible" | "unresolved";
  /** Bucket of the candidate: eligible (compatible), or why not. */
  bucket: "eligible" | "draft" | "missing-asset" | "withdrawn" | "incompatible" | "unresolved";
  mode: "same-part-binding" | "part-replacement";
  equivalence: "pin-function-and-package" | "pin-function-package-and-stated-ratings" | null;
  reasons: Array<{ code: CompatibilityReasonCode; detail: string }>;
  warnings: string[];
  evidence: string[];
  mapping: PinMappingEntry[] | null;
  permutation: boolean;
  ratings: Array<{ property: string; required: string; candidate: string | null; state: "satisfied" | "violated" | "unproven" }>;
}

const packageKey = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

function quantityText(value: { min?: number; max?: number }): string {
  return [value.min !== undefined ? `>= ${value.min}` : null, value.max !== undefined ? `<= ${value.max}` : null].filter(Boolean).join(" and ");
}

/** Evaluate one candidate exact revision for one instance. Pure. */
export function evaluateCompatibility(input: { current: CurrentInstanceFacts; candidate: CandidateRevisionFacts; requirement?: ResolutionRequirement }): CompatibilityResult {
  const { current, candidate } = input;
  const requirement = input.requirement ?? {};
  const reasons: CompatibilityResult["reasons"] = [];
  const warnings: string[] = [];
  const evidence: string[] = [];
  const ratings: CompatibilityResult["ratings"] = [];
  const mode: CompatibilityResult["mode"] = candidate.catalogPartId === current.partId ? "same-part-binding" : "part-replacement";
  const result = (verdict: CompatibilityResult["verdict"], bucket: CompatibilityResult["bucket"], mapping: PinMappingEntry[] | null = null): CompatibilityResult => ({
    schema: COMPATIBILITY_SCHEMA,
    verdict,
    bucket,
    mode,
    equivalence: verdict === "compatible" ? ((requirement.ratings ?? []).length > 0 ? "pin-function-package-and-stated-ratings" : "pin-function-and-package") : null,
    reasons,
    warnings,
    evidence,
    mapping,
    permutation: (mapping ?? []).some((entry) => entry.fromPin !== entry.toPin),
    ratings,
  });

  // ── 1. The revision: published and selectable (a new binding never lands on a withdrawn revision). ──────────────────────
  const revisionId = candidate.link.revisionId;
  if (!candidate.status) {
    reasons.push({ code: "revision-unpublished", detail: `revision ${revisionId.slice(0, 80)} is not a published revision (a draft or an unknown id); a draft is never assignable` });
    return result("unresolved", "draft");
  }
  if (!candidate.status.selectable) {
    reasons.push({ code: "revision-withdrawn", detail: `revision ${revisionId.slice(0, 80)} is ${candidate.status.state}${candidate.status.successorRevisionId ? ` (successor ${candidate.status.successorRevisionId.slice(0, 80)})` : ""}; a withdrawn revision is never newly selected` });
    return result("incompatible", "withdrawn");
  }
  evidence.push(`catalog status: ${revisionId.slice(0, 80)} is published and selectable`);
  const published = candidate.evidence;
  if (!published || published.atomicPartRevisionId !== revisionId) {
    reasons.push({ code: "evidence-unavailable", detail: `the published snapshot of revision ${revisionId.slice(0, 80)} could not be read; nothing about its symbol, footprint or mapping is known` });
    return result("unresolved", "missing-asset");
  }

  // ── 2. The catalog link names exactly the published revision's assets; the assets are complete. ───────────────────────
  if (published.symbol.versionId !== candidate.link.symbolVersionId) {
    reasons.push({ code: "link-evidence-mismatch", detail: "the catalog link names a symbol version the published revision does not bind" });
    return result("incompatible", "incompatible");
  }
  if (!published.footprint) {
    reasons.push({ code: "asset-missing", detail: "the published revision binds no footprint" });
    return result("unresolved", "missing-asset");
  }
  if (published.footprint.versionId !== candidate.link.footprintVersionId) {
    reasons.push({ code: "link-evidence-mismatch", detail: "the catalog link names a footprint version the published revision does not bind" });
    return result("incompatible", "incompatible");
  }
  if (!published.mapping) {
    reasons.push({ code: "asset-missing", detail: "the published revision carries no approved pin-to-pad mapping certificate for its primary bundle" });
    return result("unresolved", "missing-asset");
  }
  if (published.mapping.id !== candidate.link.mappingCertificateId || published.mapping.symbolVersionId !== published.symbol.versionId || published.mapping.footprintVersionId !== published.footprint.versionId) {
    reasons.push({ code: "link-evidence-mismatch", detail: "the approved mapping certificate does not name the linked symbol and footprint versions" });
    return result("incompatible", "incompatible");
  }
  if (!published.mapping.complete) {
    reasons.push({ code: "mapping-incomplete", detail: "the mapping certificate lists missing or ambiguous terminals, pins or pads" });
    return result("unresolved", "missing-asset");
  }
  evidence.push(`published assets: symbol ${published.symbol.libraryNickname}:${published.symbol.symbolName}, footprint ${published.footprint.libraryNickname}:${published.footprint.footprintName} (${published.footprint.mountingTechnology}), approved mapping ${published.mapping.id.slice(0, 64)}`);
  if (published.exactPart) evidence.push(`exact part: ${published.exactPart.exactMpn}${published.exactPart.manufacturerName ? ` by ${published.exactPart.manufacturerName}` : ""}`);

  // ── 3. The catalog part the instance would be drawn from must draw the published symbol's pins. ───────────────────────
  for (const pin of published.plannerPins) {
    const drawn = candidate.catalogPins.find((entry) => entry.number === pin.number);
    if (!drawn || drawn.name.trim() !== pin.name.trim() || Math.abs(drawn.position.x - pin.position.x) > POSITION_TOLERANCE_MM || Math.abs(drawn.position.y - pin.position.y) > POSITION_TOLERANCE_MM) {
      reasons.push({ code: "catalog-symbol-differs", detail: `catalog part ${candidate.catalogPartId.slice(0, 64)} does not draw published pin ${pin.number.slice(0, 16)} (${pin.name.slice(0, 24)}) where the published symbol has it; the canvas would not show the published symbol` });
      return result("incompatible", "incompatible");
    }
  }
  if (candidate.catalogPins.length !== published.plannerPins.length) {
    reasons.push({ code: "catalog-symbol-differs", detail: `catalog part ${candidate.catalogPartId.slice(0, 64)} has ${candidate.catalogPins.length} pin(s), the published symbol ${published.plannerPins.length}` });
    return result("incompatible", "incompatible");
  }

  // ── 4. The functional class. ─────────────────────────────────────────────────────────────────────────────────────────────
  const requiredClass = requirement.functionalClass ?? current.functionalClass;
  if (requiredClass === "unknown") {
    reasons.push({ code: "functional-class-unknown", detail: `the class of ${current.refDes.slice(0, 32)}'s part is not stated by its catalog record and no class was required` });
    return result("unresolved", "unresolved");
  }
  if (candidate.catalogFunctionalClass !== requiredClass) {
    reasons.push({ code: "functional-class-mismatch", detail: `the candidate is a ${candidate.catalogFunctionalClass} (${candidate.catalogFunctionalClassEvidence}); the instance needs a ${requiredClass}` });
    return result("incompatible", "incompatible");
  }
  evidence.push(`class: ${requiredClass} on both sides (candidate ${candidate.catalogFunctionalClassEvidence})`);

  // ── 5. The pin mapping, by function, over the approved certificate. ─────────────────────────────────────────────────────
  if (current.pins.length === 0) {
    reasons.push({ code: "current-pins-unavailable", detail: `${current.refDes.slice(0, 32)}'s symbol pins are not known from a server catalog record` });
    return result("unresolved", "unresolved");
  }
  const padsByPin = new Map<string, string[]>();
  for (const entry of published.mapping.entries) {
    if (entry.classification !== "electrical") continue;
    for (const number of entry.symbolPinNumbers) padsByPin.set(number, [...(padsByPin.get(number) ?? []), ...entry.padNumbers]);
  }
  const targetPins = published.symbol.pins.map((pin) => ({ ...pin, function: pinFunctionOf(pin, requiredClass) }));
  const mapping: PinMappingEntry[] = [];
  const usedTargets = new Set<string>();
  for (const pin of current.pins) {
    const connected = pin.netName !== null;
    const matches = targetPins.filter((target) => target.function.key === pin.function.key);
    if (matches.length === 0) {
      if (!connected) continue;
      reasons.push({ code: "connected-pin-unmapped", detail: `${current.refDes.slice(0, 32)} pin ${pin.number.slice(0, 16)} (${pin.function.key}) is connected to ${pin.netName!.slice(0, 48)} but the candidate has no pin of that function` });
      return result("incompatible", "incompatible");
    }
    if (matches.length > 1) {
      if (!connected) continue;
      reasons.push({ code: "ambiguous-pin-function", detail: `${matches.length} candidate pins carry the function ${pin.function.key}; the mapping of connected pin ${pin.number.slice(0, 16)} is ambiguous` });
      return result("unresolved", "unresolved");
    }
    const target = matches[0]!;
    if (electricalTypeGroup(pin.electricalType) !== electricalTypeGroup(target.electricalType)) {
      if (!connected) continue;
      reasons.push({ code: "electrical-type-mismatch", detail: `pin ${pin.number.slice(0, 16)} is ${pin.electricalType} but candidate pin ${target.number.slice(0, 16)} is ${target.electricalType}` });
      return result("incompatible", "incompatible");
    }
    const pads = padsByPin.get(target.number) ?? [];
    if (pads.length === 0) {
      if (!connected) continue;
      reasons.push({ code: "pin-not-mapped-to-pad", detail: `candidate pin ${target.number.slice(0, 16)} (${target.function.key}) is not mapped to an electrical pad by the approved certificate` });
      return result("incompatible", "incompatible");
    }
    if (usedTargets.has(target.number)) {
      reasons.push({ code: "pin-mapping-not-one-to-one", detail: `two pins of ${current.refDes.slice(0, 32)} would map to candidate pin ${target.number.slice(0, 16)}` });
      return result("incompatible", "incompatible");
    }
    usedTargets.add(target.number);
    mapping.push({ fromPin: pin.number, toPin: target.number, function: pin.function.key, pads: [...pads].sort(), connected });
  }
  for (const target of targetPins) {
    if (usedTargets.has(target.number)) continue;
    if ((padsByPin.get(target.number) ?? []).length > 0 && electricalTypeGroup(target.electricalType) !== "no_connect") warnings.push(`candidate pin ${target.number.slice(0, 16)} (${target.function.key}) has no counterpart on the instance and stays unconnected`);
  }
  const polar = (POLAR_TWO_TERMINAL_CLASSES as readonly string[]).includes(requiredClass);
  if (polar) {
    for (const terminal of ["anode", "cathode"] as const) {
      const from = current.pins.find((pin) => pin.function.key === terminal);
      if (from?.netName) evidence.push(`polarity: the ${terminal} stays on ${from.netName.slice(0, 48)} (pin ${from.number} -> ${mapping.find((entry) => entry.fromPin === from.number)?.toPin ?? "?"})`);
    }
  }
  evidence.push(`pin mapping by function over the approved certificate: ${mapping.map((entry) => `${entry.fromPin}->${entry.toPin} (${entry.function}; pad ${entry.pads.join("/")})`).join(", ")}`);

  // ── 6. Package / mounting: a STATED requirement decides; otherwise the change is a material warning. ───────────────────
  const footprintName = `${published.footprint.libraryNickname}:${published.footprint.footprintName}`;
  if (requirement.mounting) {
    if (published.footprint.mountingTechnology === "unknown" || published.footprint.mountingTechnology === "mixed") {
      reasons.push({ code: "mounting-unknown", detail: `the candidate footprint ${footprintName.slice(0, 80)} states ${published.footprint.mountingTechnology} mounting; ${requirement.mounting} was required` });
      return result("unresolved", "unresolved", mapping);
    }
    if (published.footprint.mountingTechnology !== requirement.mounting) {
      reasons.push({ code: "mounting-mismatch", detail: `the candidate footprint is ${published.footprint.mountingTechnology}; ${requirement.mounting} was required` });
      return result("incompatible", "incompatible", mapping);
    }
  }
  if (requirement.packageCode && !packageKey(footprintName).includes(packageKey(requirement.packageCode))) {
    reasons.push({ code: "package-mismatch", detail: `the candidate footprint ${footprintName.slice(0, 80)} is not package ${requirement.packageCode.slice(0, 32)}` });
    return result("incompatible", "incompatible", mapping);
  }
  if (!requirement.mounting && !requirement.packageCode) {
    warnings.push(`package: the replacement footprint is ${footprintName.slice(0, 80)} (${published.footprint.mountingTechnology})${current.footprintHint ? `; the original catalog part only hinted ${current.footprintHint.slice(0, 80)}, which was never package authority` : ""} - no package or mounting was required, so confirm it suits the board`);
  }

  // ── 7. Ratings: a STATED requirement must be proven by a published claim; nothing is inferred. ──────────────────────────
  let unproven = false;
  for (const rating of requirement.ratings ?? []) {
    const required = quantityText(rating);
    const claims = published.claims.filter((claim) => claim.property.toLowerCase() === rating.property.toLowerCase() && claim.quantity?.dimension === rating.dimension && ACCEPTED_CLAIM_STATES.has(claim.state) && RATING_LIMITS.has(claim.limit) && claim.evidenceCount > 0);
    if (claims.length === 0) {
      ratings.push({ property: rating.property, required, candidate: null, state: "unproven" });
      unproven = true;
      continue;
    }
    // [PR-M, 2026-10-17] review fix: each stated bound is compared with the candidate's WORST CASE over every accepted claim. A floor
    // (`min`) is met by a rating's ceiling (an absolute-maximum / recommended-operating `max`: the part withstands at least that) or
    // by a characteristic's guaranteed minimum; a ceiling (`max`) by the guaranteed maximum. One violating claim decides; a claim
    // that states no figure for the bound proves nothing (never the typical value, never the other end of its range).
    const worst = (claim: (typeof claims)[number], bound: "min" | "max"): number | undefined => {
      const quantity = claim.quantity!;
      if (bound === "max") return quantity.max ?? quantity.value;
      return RATING_CEILING_LIMITS.has(claim.limit) ? (quantity.max ?? quantity.value) : (quantity.min ?? quantity.value);
    };
    const shownParts: string[] = [];
    let state: "satisfied" | "violated" | "unproven" = "satisfied";
    for (const bound of ["min", "max"] as const) {
      const limit = rating[bound];
      if (limit === undefined) continue;
      const figures = claims.flatMap((claim) => { const figure = worst(claim, bound); return figure === undefined ? [] : [{ figure, claim }]; });
      if (figures.length === 0) { if (state === "satisfied") state = "unproven"; continue; }
      const decisive = figures.reduce((pick, entry) => (bound === "min" ? (entry.figure < pick.figure ? entry : pick) : (entry.figure > pick.figure ? entry : pick)));
      shownParts.push(`${bound === "min" ? "worst-case floor" : "worst-case ceiling"} ${decisive.figure} (${decisive.claim.limit}, ${decisive.claim.state})`);
      if (bound === "min" ? decisive.figure < limit : decisive.figure > limit) state = "violated";
    }
    const shown = shownParts.length > 0 ? shownParts.join("; ") : null;
    ratings.push({ property: rating.property, required, candidate: shown, state });
    if (state === "unproven") { unproven = true; continue; }
    if (state === "violated") {
      reasons.push({ code: "rating-violated", detail: `${rating.property}: the published claim ${shown ?? "?"} does not meet ${required}` });
      return result("incompatible", "incompatible", mapping);
    }
  }
  if (unproven) {
    reasons.push({ code: "rating-unproven", detail: `no published claim proves ${ratings.filter((entry) => entry.state === "unproven").map((entry) => entry.property).join(", ")}; a rating is never inferred from a name or a description` });
    return result("unresolved", "unresolved", mapping);
  }
  if ((requirement.ratings ?? []).length === 0) warnings.push("ratings: no circuit rating requirement was stated, so none was compared - this is a pin-function and package match, not an electrical equivalence proof");
  if (mode === "part-replacement") warnings.push(`identity: the part changes from catalog part ${current.partId.slice(0, 64)} to ${candidate.catalogPartId.slice(0, 64)}${published.exactPart ? ` (exact part ${published.exactPart.exactMpn})` : ""}; the value "${current.value.slice(0, 32)}" and the reference ${current.refDes.slice(0, 32)} are kept`);
  return result("compatible", "eligible", mapping);
}
