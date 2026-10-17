/**
 * [PR-F, 2026-10-17] The STACKUP / VIA-POLICY candidate (`sirkit.stackup-candidate.v1`): a sealed, revision-bound RECOMMENDATION
 * of a layer count, layer roles, reference planes, power distribution and a through-via profile, chosen ONLY among what this tree
 * already defines and qualifies (directive section 9):
 *  - the layer-count / layer-role profiles are `STACKUP_PROFILES` (app/lib/pcb/stackup.ts: simple-2, signal-plane-4, all-signal-4,
 *    dense-4) - physical layer count and ROUTABLE signal-layer count are stated apart (`routableCopperLayers` excludes planes);
 *  - the manufacturing profiles are the DRC presets (app/lib/pcb/drc/presets) with their fab preset's copper layer bundle
 *    (app/lib/pcb/fab/presets); which of them is RELEASE-qualified is `QUALIFIED_RULE_PROFILE_IDS` (app/lib/pcb/fab/rule-profile.ts:
 *    jlcpcb-2l only) and the candidate says so per preset instead of implying a release path;
 *  - the via profiles are the board's via padstacks and the seeded class defaults (app/lib/pcb/padstack: `kind: "via"`, through
 *    vias - the model's only via), each checked against the preset's minimum outer / drill / annular ring and marked, never dropped.
 *
 * Anything else - blind, buried, micro, via-in-pad or stacked vias, a material, dielectric, copper weight, thickness or impedance
 * claim, a layer count outside 2 / 4 - is REFUSED AS DATA with the one reason `UNSUPPORTED_CHAIN_REASON`: representation, rules,
 * routing, import / export, verification, manufacturer support and cost / approval policy are not proven for it here.
 *
 * A different layer count or profile INVALIDATES dependent approvals, and the candidate carries the rules that say so (revision.ts,
 * layout-candidate.ts, placement/transaction.ts, readiness/preflight.ts, fab/release-gate.ts, fab/rule-profile.ts, zones/plane.ts).
 * Nothing is applied: the human path is the PCB editor's Stackup selector (one canonical `pcb.board-geometry` transaction).
 */
import { engineeringDigest } from "../../engineering/stable";
import { getPreset, PRESETS } from "../drc/presets";
import type { DrcPresetId } from "../drc/types";
import { getFabPresetForDrc } from "../fab/presets";
import { QUALIFIED_RULE_PROFILE_IDS } from "../fab/rule-profile";
import { LAYERS } from "../layers";
import { DEFAULT_PADSTACKS } from "../padstack/defaults";
import type { Padstack } from "../padstack/types";
import { classifyPlacementScope, type PlacementScope } from "../placement/intent";
import { pcbRevisionId } from "../revision";
import { getBoardStackup, STACKUP_PROFILES, stackupProfile, type BoardStackup, type CopperLayer, type StackupProfileId } from "../stackup";
import type { PcbBoard } from "../types";

export const STACKUP_CANDIDATE_SCHEMA = "sirkit.stackup-candidate.v1" as const;
export const STACKUP_CANDIDATE_TTL_MS = 30 * 60 * 1000;
/** Directive section 9: the ONE reason every unsupported stackup / via request is refused with (as data, never a silent drop). */
export const UNSUPPORTED_CHAIN_REASON = "unsupported until the complete chain is proven" as const;
export const SUPPORTED_VIA_TECHNOLOGY = "through" as const;
export const UNSUPPORTED_VIA_TECHNOLOGIES = Object.freeze(["blind", "buried", "microvia", "via-in-pad", "stacked"] as const);
/** Request keys that name a capability the chain does not prove; each refuses with UNSUPPORTED_CHAIN_REASON (the exact reason, as data). */
export const UNSUPPORTED_REQUEST_KEYS = Object.freeze(["blindVias", "buriedVias", "microvias", "viaInPad", "stackedVias", "material", "dielectric", "dielectricConstant", "impedance", "impedanceTargets", "impedanceOhms", "copperWeightOz", "copperThicknessUm", "boardThicknessMm", "layerCount", "layers"] as const);
/** The qualified layer-count / layer-role profiles, exactly the tree's (app/lib/pcb/stackup.ts STACKUP_PROFILES). */
export const STACKUP_PROFILE_IDS: readonly StackupProfileId[] = Object.freeze(Object.keys(STACKUP_PROFILES) as StackupProfileId[]);
/** The manufacturing profiles, exactly the tree's DRC presets (two- and four-layer; release qualification stated per preset). */
export const MANUFACTURING_PRESET_IDS: readonly DrcPresetId[] = Object.freeze(PRESETS.map((preset) => preset.id));
export const PLANE_LAYER_IDS = Object.freeze(["in1", "in2"] as const);
export const MAX_STACKUP_RATIONALE_CHARS = 600;
export const MAX_STACKUP_VIA_PROFILES = 8;
/** The human path (cited for the reviewer): PcbEditor's Stackup selector commits ONE canonical pcb.board-geometry transaction. */
export const STACKUP_HUMAN_PATH = "the PCB editor's Stackup selector (app/components/pcb/PcbEditor.tsx onStackupChange -> commitPcbCandidate pcb.board-geometry: board.stackup, board.stackupConfig = stackupProfile(...) and reconcileStackupPlaneZones in the SAME transaction, one undo entry); this candidate applies nothing" as const;
/** The existing revision / approval rules a stackup change runs into (cited, not restated). */
export const STACKUP_INVALIDATION_RULES: readonly string[] = Object.freeze([
  "app/lib/pcb/revision.ts: pcbRevisionPayload covers board.stackup and board.stackupConfig, so a stackup change is a NEW canonical board revision (sirkit.pcb-revision.v2)",
  "app/lib/pcb/candidates/layout-candidate.ts: verifyLayoutCandidate refuses a candidate whose base.revision differs (STALE_REVISION) - every live placement / routing candidate retires with zero mutation",
  "app/lib/pcb/placement/transaction.ts: applyPlacementCandidate refuses STALE_BOARD when the board revision differs from the problem's sourceBoardRevision; STALE_PROGRAM when the constraint program changed",
  "app/lib/pcb/readiness/preflight.ts: runExportPreflight reports MANUFACTURING_STACKUP_MISMATCH when the enabled copper layers differ from the fab preset's layerBundle",
  "app/lib/pcb/fab/release-gate.ts: validateRuleProfile fails MFG_RULE_PROFILE_CONSTRUCTION_MISMATCH unless the profile's copperLayers and board.stackup are both 2; the RC03 evidence must carry the CURRENT boardRevision and boardDigest, so a qualification is re-run after any stackup change",
  "app/lib/pcb/fab/rule-profile.ts: QUALIFIED_RULE_PROFILE_IDS holds jlcpcb-2l only; buildManufacturingRuleProfile throws RULE_PROFILE_NOT_QUALIFIED for every other preset",
  "app/lib/pcb/zones/plane.ts: reconcileStackupPlaneZones re-materializes the stackup plane zones in the same transaction as the stackup edit; their fills are derived copper, recomputed for the new revision",
]);

export interface StackupNetRef { name: string; id: number }
export interface StackupPlaneRequest { layer: (typeof PLANE_LAYER_IDS)[number]; net: StackupNetRef }
/** The request as the input schema admits it. */
export interface StackupProposalRequest {
  profileId: StackupProfileId;
  manufacturingProfileId?: DrcPresetId;
  planes?: StackupPlaneRequest[];
  viaPadstackIds?: string[];
  viaTechnology?: typeof SUPPORTED_VIA_TECHNOLOGY;
  rationale?: string;
}

export interface StackupLayerRecommendation {
  id: CopperLayer["id"];
  kicadName: CopperLayer["name"];
  displayName: string;
  order: number;
  role: CopperLayer["role"];
  autorouteEnabled: boolean;
  preferredDirection: CopperLayer["preferredDirection"];
  planeNet: StackupNetRef | null;
  defaultTraceWidthMm: number | null;
}
export interface StackupSummary { profileId: StackupProfileId | null; physicalLayerCount: number; routableSignalLayerCount: number; layers: StackupLayerRecommendation[] }
export interface StackupViaProfile { id: string; name: string; outerNm: number; drillNm: number; tented: boolean; source: "board" | "default"; meetsManufacturingMinimum: boolean; note: string | null }
export interface StackupCandidate {
  schema: typeof STACKUP_CANDIDATE_SCHEMA;
  candidateId: string;
  producer: "agent";
  createdAt: string;
  expiresAt: string;
  /** sha256 over the candidate CONTENT (everything but `digest`, `createdAt`, `expiresAt`). */
  digest: string;
  base: { revision: string; stackup: StackupSummary; manufacturingPresetId: string };
  recommendation: {
    profileId: StackupProfileId;
    boardThicknessMm: number;
    physicalLayerCount: number;
    routableSignalLayerCount: number;
    layers: StackupLayerRecommendation[];
    routing: BoardStackup["routing"];
    planes: StackupPlaneRequest[];
    manufacturing: { presetId: DrcPresetId; name: string; fab: string; version: number; verifiedAt: string; copperLayerCount: number; releaseQualified: boolean; qualificationNote: string; limitsNm: { clearanceNm: number; minTrackWidthNm: number; minViaOuterNm: number; minViaDrillNm: number; minAnnularRingNm: number; minPthAnnularRingNm: number } };
    viaPolicy: { technology: typeof SUPPORTED_VIA_TECHNOLOGY; padstacks: StackupViaProfile[] };
    rationale: string | null;
  };
  scope: PlacementScope;
  invalidation: { changesLayerCount: boolean; changesProfile: boolean; changesManufacturingPreset: boolean; dependentApprovalsInvalidated: boolean; rules: string[] };
  unsupported: { viaTechnologies: string[]; materialsAndImpedance: string; reason: typeof UNSUPPORTED_CHAIN_REASON };
  notValidated: string[];
  humanPath: typeof STACKUP_HUMAN_PATH;
}

export type StackupCandidateBlockerCode = "request-malformed" | "unsupported-via-technology" | "unsupported-material" | "unsupported-impedance" | "unsupported-layer-count" | "unsupported-profile" | "unsupported-manufacturing-profile" | "profile-layer-mismatch" | "plane-layer-not-plane" | "unknown-net" | "unknown-padstack" | "duplicate-id";
export interface StackupCandidateBlocker { code: StackupCandidateBlockerCode; detail: string }
export type StackupCandidateCompilation = { ok: true; candidate: StackupCandidate } | { ok: false; blockers: StackupCandidateBlocker[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const now = (clock?: () => string): string => (clock ? clock() : new Date().toISOString());

function layerRows(stackup: BoardStackup, planeNetOf: (layer: CopperLayer) => StackupNetRef | null): StackupLayerRecommendation[] {
  return [...stackup.copperLayers].filter((layer) => layer.enabled).sort((a, b) => a.order - b.order).map((layer) => ({
    id: layer.id, kicadName: layer.name, displayName: LAYERS.find((definition) => definition.id === layer.id)?.displayName ?? layer.id, order: layer.order, role: layer.role,
    autorouteEnabled: layer.autorouteEnabled, preferredDirection: layer.preferredDirection, planeNet: planeNetOf(layer), defaultTraceWidthMm: layer.defaultTraceWidthMm ?? null,
  }));
}
/** Physical copper layers vs. ROUTABLE signal layers (enabled, autoroute-enabled, not a plane) - the distinction section 9 requires. */
export function summarizeStackup(stackup: BoardStackup, profileId: StackupProfileId | null, planeNetOf: (layer: CopperLayer) => StackupNetRef | null): StackupSummary {
  const enabled = stackup.copperLayers.filter((layer) => layer.enabled);
  return { profileId, physicalLayerCount: enabled.length, routableSignalLayerCount: enabled.filter((layer) => layer.autorouteEnabled && layer.role !== "plane").length, layers: layerRows(stackup, planeNetOf) };
}

/** The board's current stackup as the candidate's base (its profile id is read from stackupConfig when the config matches the layer count). */
export function currentStackupSummary(board: PcbBoard): StackupSummary {
  const stackup = getBoardStackup(board);
  const configured = board.stackupConfig && board.stackupConfig.copperLayers.length === board.stackup ? board.stackupConfig.profileId : null;
  const netOf = (layer: CopperLayer): StackupNetRef | null => { const net = layer.planeNetId !== undefined ? board.nets.find((candidate) => candidate.id === layer.planeNetId) : undefined; return net ? { name: net.name, id: net.id } : null; };
  return summarizeStackup(stackup, configured ?? (STACKUP_PROFILE_IDS.includes(stackup.profileId) ? stackup.profileId : null), netOf);
}

/** The copper layer count a manufacturing preset's fab bundle enables (the readiness preflight's own rule). */
export function presetCopperLayerCount(presetId: DrcPresetId): number {
  const fab = getFabPresetForDrc(presetId);
  return fab ? fab.layerBundle.filter((layer) => layer.enabled && ["copperTop", "in1", "in2", "copperBottom"].includes(layer.layerId)).length : 0;
}

/** The via profiles the tree defines for this board: its padstacks and the seeded class defaults (through vias only). */
export function availableViaProfiles(board: PcbBoard): Array<{ padstack: Padstack; source: "board" | "default" }> {
  const own = (board.padstacks ?? []).filter((padstack) => padstack.kind === "via").map((padstack) => ({ padstack, source: "board" as const }));
  const defaults = DEFAULT_PADSTACKS.filter((padstack) => !own.some((entry) => entry.padstack.id === padstack.id)).map((padstack) => ({ padstack, source: "default" as const }));
  return [...own, ...defaults].sort((a, b) => a.padstack.id.localeCompare(b.padstack.id));
}

function digestOf(candidate: Omit<StackupCandidate, "digest">): string {
  const content: Record<string, unknown> = { ...candidate };
  delete content.createdAt;
  delete content.expiresAt;
  return engineeringDigest(content);
}
/** Recompute the digest and compare (a tampered or hand-edited candidate is refused at intake). */
export function stackupCandidateIntact(candidate: StackupCandidate): boolean {
  const { digest, ...rest } = candidate;
  return digestOf(rest) === digest;
}

/** Validate the request against the tree's own authorities and seal the recommendation; refusals are blockers DATA, all-or-nothing. */
export function compileStackupCandidate(input: { board: PcbBoard; request: unknown; presetId: string; clock?: () => string; ttlMs?: number }): StackupCandidateCompilation {
  const blockers: StackupCandidateBlocker[] = [];
  const block = (code: StackupCandidateBlockerCode, detail: string): void => { if (blockers.length < 32) blockers.push({ code, detail: detail.slice(0, 300) }); };
  const request = input.request;
  if (!isRecord(request)) return { ok: false, blockers: [{ code: "request-malformed", detail: "the request must be an object." }] };
  // 1. The unsupported capabilities, each refused with the one exact reason - before anything else is read.
  for (const key of UNSUPPORTED_REQUEST_KEYS) {
    if (!(key in request)) continue;
    const code: StackupCandidateBlockerCode = /via/i.test(key) ? "unsupported-via-technology" : /impedance/i.test(key) ? "unsupported-impedance" : /layer/i.test(key) ? "unsupported-layer-count" : "unsupported-material";
    block(code, `${key}: ${UNSUPPORTED_CHAIN_REASON} (representation, rules, routing, import/export, verification, manufacturer support, cost/approval policy)`);
  }
  if (request.viaTechnology !== undefined && request.viaTechnology !== SUPPORTED_VIA_TECHNOLOGY) block("unsupported-via-technology", `viaTechnology ${typeof request.viaTechnology === "string" ? request.viaTechnology.slice(0, 40) : "(not a string)"}: ${UNSUPPORTED_CHAIN_REASON}; only ${SUPPORTED_VIA_TECHNOLOGY} vias are qualified`);
  const known = new Set(["profileId", "manufacturingProfileId", "planes", "viaPadstackIds", "viaTechnology", "rationale", ...UNSUPPORTED_REQUEST_KEYS]);
  for (const key of Object.keys(request)) if (!known.has(key)) block("request-malformed", `${key.slice(0, 40)}: unknown key.`);
  // 2. The layer-count / layer-role profile: exactly the tree's.
  const profileId = typeof request.profileId === "string" && (STACKUP_PROFILE_IDS as readonly string[]).includes(request.profileId) ? (request.profileId as StackupProfileId) : null;
  if (profileId === null) block("unsupported-profile", `profileId ${typeof request.profileId === "string" ? request.profileId.slice(0, 40) : "(missing)"}: ${UNSUPPORTED_CHAIN_REASON}; the qualified profiles are ${STACKUP_PROFILE_IDS.join(", ")}`);
  // 3. The manufacturing profile: a DRC preset whose fab bundle enables the same copper layer count.
  const presetValue = request.manufacturingProfileId ?? input.presetId;
  const presetId = typeof presetValue === "string" && (MANUFACTURING_PRESET_IDS as readonly string[]).includes(presetValue) ? (presetValue as DrcPresetId) : null;
  if (presetId === null) block("unsupported-manufacturing-profile", `manufacturingProfileId ${typeof presetValue === "string" ? presetValue.slice(0, 40) : "(missing)"}: ${UNSUPPORTED_CHAIN_REASON}; the manufacturing profiles are ${MANUFACTURING_PRESET_IDS.join(", ")}`);
  const profile = profileId ? stackupProfile(profileId) : null;
  const copperCount = presetId ? presetCopperLayerCount(presetId) : 0;
  if (profile && presetId && copperCount !== profile.copperLayers.length) block("profile-layer-mismatch", `${profileId} has ${profile.copperLayers.length} copper layers but manufacturing profile ${presetId} fabricates ${copperCount}; choose a matching pair (the export preflight would report MANUFACTURING_STACKUP_MISMATCH).`);
  // 4. Reference planes: only on a layer whose role is plane in the chosen profile, each net an exact board net.
  const planes: StackupPlaneRequest[] = [];
  if (request.planes !== undefined && request.planes !== null) {
    if (!Array.isArray(request.planes) || request.planes.length > PLANE_LAYER_IDS.length) block("request-malformed", `planes: at most ${PLANE_LAYER_IDS.length} entries (one per inner layer).`);
    else for (const [index, raw] of request.planes.entries()) {
      if (!isRecord(raw) || !(PLANE_LAYER_IDS as readonly unknown[]).includes(raw.layer) || !isRecord(raw.net) || typeof raw.net.name !== "string" || !Number.isInteger(raw.net.id)) { block("request-malformed", `planes[${index}]: { layer: in1 | in2, net: { name, id } }.`); continue; }
      const layerId = raw.layer as (typeof PLANE_LAYER_IDS)[number];
      const requested = raw.net as { name: string; id: number };
      if (planes.some((plane) => plane.layer === layerId)) { block("duplicate-id", `planes[${index}]: layer ${layerId} is assigned twice.`); continue; }
      const role = profile?.copperLayers.find((layer) => layer.id === layerId)?.role;
      if (profile && role !== "plane") block("plane-layer-not-plane", `planes[${index}]: ${layerId} is ${role ? `a ${role} layer` : "not a layer"} of ${profileId}; only a plane layer takes a reference net (signal-plane-4 has in1 and in2 as planes).`);
      const net = input.board.nets.find((candidate) => candidate.id === requested.id && candidate.id !== 0);
      if (!net || net.name !== requested.name) { block("unknown-net", `planes[${index}]: no net with id ${String(requested.id).slice(0, 12)} named "${requested.name.slice(0, 40)}" is on this board revision${net ? ` (id ${net.id} is "${net.name}")` : ""}.`); continue; }
      planes.push({ layer: layerId, net: { name: net.name, id: net.id } });
    }
  }
  // 5. Via profiles: among the board's padstacks and the seeded defaults (through vias); each checked against the preset's minima.
  const available = availableViaProfiles(input.board);
  let chosen = available;
  if (request.viaPadstackIds !== undefined && request.viaPadstackIds !== null) {
    if (!Array.isArray(request.viaPadstackIds) || request.viaPadstackIds.length === 0 || request.viaPadstackIds.length > MAX_STACKUP_VIA_PROFILES || !request.viaPadstackIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)) block("request-malformed", `viaPadstackIds: 1 to ${MAX_STACKUP_VIA_PROFILES} padstack ids.`);
    else {
      const ids = [...new Set(request.viaPadstackIds as string[])];
      const unknown = ids.filter((id) => !available.some((entry) => entry.padstack.id === id));
      if (unknown.length > 0) block("unknown-padstack", `viaPadstackIds names via profiles this board and its class defaults do not define: ${unknown.slice(0, 5).join(", ")}; defined: ${available.map((entry) => entry.padstack.id).join(", ")}.`);
      chosen = available.filter((entry) => ids.includes(entry.padstack.id));
    }
  }
  let rationale: string | null = null;
  if (request.rationale !== undefined && request.rationale !== null) {
    if (typeof request.rationale !== "string" || request.rationale.length === 0 || request.rationale.length > MAX_STACKUP_RATIONALE_CHARS) block("request-malformed", `rationale: a string of 1 to ${MAX_STACKUP_RATIONALE_CHARS} characters.`);
    else rationale = request.rationale;
  }
  if (blockers.length > 0 || !profile || !profileId || !presetId) return { ok: false, blockers: blockers.length > 0 ? blockers : [{ code: "request-malformed", detail: "the request could not be compiled." }] };

  const preset = getPreset(presetId);
  const rules = preset.rules.default;
  const planeNetOf = (layer: CopperLayer): StackupNetRef | null => planes.find((plane) => plane.layer === layer.id)?.net ?? null;
  const recommended = summarizeStackup(profile, profileId, planeNetOf);
  const base = currentStackupSummary(input.board);
  const releaseQualified = QUALIFIED_RULE_PROFILE_IDS.has(presetId);
  const padstacks: StackupViaProfile[] = chosen.map(({ padstack, source }) => {
    const ring = (padstack.outerNm - padstack.drillNm) / 2;
    const failures = [padstack.outerNm < rules.minViaOuterNm ? `outer ${padstack.outerNm} nm below minViaOuterNm ${rules.minViaOuterNm}` : null, padstack.drillNm < rules.minViaDrillNm ? `drill ${padstack.drillNm} nm below minViaDrillNm ${rules.minViaDrillNm}` : null, ring < rules.minAnnularRingNm ? `annular ring ${Math.round(ring)} nm below minAnnularRingNm ${rules.minAnnularRingNm}` : null].filter((item): item is string => item !== null);
    return { id: padstack.id, name: padstack.name, outerNm: padstack.outerNm, drillNm: padstack.drillNm, tented: padstack.tented, source, meetsManufacturingMinimum: failures.length === 0, note: failures.length > 0 ? `below ${presetId}: ${failures.join("; ")}` : null };
  });
  const changesLayerCount = recommended.physicalLayerCount !== base.physicalLayerCount;
  const changesProfile = base.profileId !== profileId;
  const changesManufacturingPreset = presetId !== input.presetId;
  const createdAt = now(input.clock);
  const expiresAt = new Date(Date.parse(createdAt) + (input.ttlMs ?? STACKUP_CANDIDATE_TTL_MS)).toISOString();
  const revision = pcbRevisionId(input.board);
  const content: Omit<StackupCandidate, "digest"> = {
    schema: STACKUP_CANDIDATE_SCHEMA,
    candidateId: `sc-${engineeringDigest({ revision, profileId, presetId, planes, padstacks: padstacks.map((entry) => entry.id) }).slice(5)}`,
    producer: "agent",
    createdAt,
    expiresAt,
    base: { revision, stackup: base, manufacturingPresetId: input.presetId },
    recommendation: {
      profileId, boardThicknessMm: profile.boardThicknessMm, physicalLayerCount: recommended.physicalLayerCount, routableSignalLayerCount: recommended.routableSignalLayerCount, layers: recommended.layers, routing: { ...profile.routing }, planes: [...planes].sort((a, b) => a.layer.localeCompare(b.layer)),
      manufacturing: { presetId, name: preset.name, fab: preset.fab, version: preset.version, verifiedAt: preset.verifiedAt, copperLayerCount: copperCount, releaseQualified, qualificationNote: releaseQualified ? "in QUALIFIED_RULE_PROFILE_IDS (app/lib/pcb/fab/rule-profile.ts): a source-pinned manufacturing rule profile exists for the release gate" : `NOT release-qualified: buildManufacturingRuleProfile throws RULE_PROFILE_NOT_QUALIFIED for ${presetId} (QUALIFIED_RULE_PROFILE_IDS holds jlcpcb-2l only); DRC and export preflight run, the manufacturing release does not`, limitsNm: { clearanceNm: rules.clearanceNm, minTrackWidthNm: rules.minTrackWidthNm, minViaOuterNm: rules.minViaOuterNm, minViaDrillNm: rules.minViaDrillNm, minAnnularRingNm: rules.minAnnularRingNm, minPthAnnularRingNm: rules.minPthAnnularRingNm } },
      viaPolicy: { technology: SUPPORTED_VIA_TECHNOLOGY, padstacks },
      rationale,
    },
    scope: classifyPlacementScope(input.board),
    invalidation: { changesLayerCount, changesProfile, changesManufacturingPreset, dependentApprovalsInvalidated: changesLayerCount || changesProfile || changesManufacturingPreset, rules: [...STACKUP_INVALIDATION_RULES] },
    unsupported: { viaTechnologies: [...UNSUPPORTED_VIA_TECHNOLOGIES], materialsAndImpedance: "no material, dielectric, copper weight, thickness or impedance claim is made or accepted: no stackup data and no qualified checker exist for them here", reason: UNSUPPORTED_CHAIN_REASON },
    notValidated: ["not DRC-checked: the preset's rules are quoted, nothing was checked against this board's copper", "not routed: routability of the recommended layers is unmeasured until a routing candidate runs on the changed board", "no impedance, crosstalk or signal-integrity claim", "no manufacturer quote, cost or lead time", "the human applies the stackup and re-runs validation; dependent approvals listed under invalidation re-run from scratch"],
    humanPath: STACKUP_HUMAN_PATH,
  };
  return { ok: true, candidate: { ...content, digest: digestOf(content) } };
}
