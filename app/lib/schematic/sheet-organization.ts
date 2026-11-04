/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.3 item 4 "Organize into sheets"; J.6 acceptance; OD-258 item 4): the pure
 * ORGANISE planner. Two halves, both deterministic and free of I/O and randomness:
 *
 *  - `proposeSheetGroups(state, getPart, { sourceSheetId, hints })`: a grouping PROPOSAL from connectivity and part roles alone.
 *    Hubs are the parts a subsystem forms around: processors (role "processor": a U-prefixed part or one with more than 8 pins),
 *    regulators (catalog category) and connectors (J). Every other part belongs to a hub. The non-hub parts first form CLUSTERS over
 *    the signal nets (a net that is neither a power / ground rail nor touches more than HIGH_FANOUT_NET_PARTS parts); each cluster
 *    attaches, as one piece, to the hub it WEIGHS most towards: the weight is the number of signal nets the cluster shares with the hub,
 *    then the hub's specificity (a shared passive - an I2C pull-up between an MCU and a sensor, a gate resistor between an MCU and a
 *    driver stage - goes to the hub with FEWER signal nets, the peripheral, not the controller). A cluster whose weight ties between
 *    hubs goes by the caller's hints (the generation plan's blocks, when known), then to the hub with the smaller reference designator,
 *    and is LISTED under "check these" (OD-258 item 4: a usable proposal, not a refusal). A cluster that touches no signal net at all
 *    (a decoupling capacitor on +3V3 and GND, a battery header on VBAT) is weighed by the power rails it shares with each group -
 *    ground is universal and carries no weight - with the same hint / smaller-reference tie-break, and is listed too; one that shares
 *    nothing forms its own group when it holds two parts or more, else stays where it is (the residue). Hub groups with the SAME
 *    structure (one connector, one MOSFET, two resistors, one diode, four times over) are one group: repeated channels are one
 *    subsystem. A small connector group (fewer than MIN_CONNECTOR_GROUP parts, every hub a connector) is an interface of the subsystem
 *    it talks to and is folded into the group it shares the most signal nets with (then the most power rails). Fewer than two groups
 *    refuse ORGANIZE_NOTHING_TO_SPLIT; a connectivity error or an unresolved part refuses ORGANIZE_CONNECTIVITY_INVALID naming it.
 *  - `planOrganizeIntoSheets(state, groups, getPart, options)`: the plan for ANY grouping handed in as the closed `OrganizeGroupInput`
 *    shape (the proposal above, or J5's organise proposal tool): one `planMoveToSheet` per group, chained on the previous step's result,
 *    each to a NEW child sheet of the source sheet with a free block slot and the operation-id prefix `<prefix>:<i>` (distinct per
 *    group: the executor's DUPLICATE_OPERATION_ID guard), every step proven by the planner (the pin-to-net partition and the component
 *    identities unchanged; the cut nets carried by explicit ports - SIG<n> for an unnamed one). The concatenated operations are ONE
 *    schematic.move-to-sheet transaction (one undo step); the whole batch is applied once more with the executor's own code and its
 *    result must equal the chain's, and the final partition digest must equal the original's. Any refused step refuses the WHOLE plan
 *    with that step's message and nothing is changed (J.3 item 4: an ambiguous or non-equivalent split never changes the design).
 *    [PR-J5 integration, 2026-10-26] review J5R-AI-1: a group takes its parts' whole WIRE CHAINS (a page-drawn route of several
 *    segments; a route that also reaches a part outside the group stays and ends at the new port's sheet pin), and a step that would
 *    leave a wire end in the air or a wire island on any sheet is refused ORGANIZE_DRAWING_DEGRADED - the partition proof cannot see it.
 *
 * Ids: a new sheet's id is a content digest of its sorted reference designators (`organizeSheetId`), so the same grouping always
 * yields the same ids and operation ids - no random draw (the fixture browser's uuid sequence is untouched). Theory (ideal) parts are
 * not organised by this planner: it groups catalog (KiCad) parts, the ones a crowded Build page holds.
 */

import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry"; // [PR-J5 integration, 2026-10-26] review J5R-AI-1: the wire chains and the drawing check
import type { KicadPin } from "@/app/lib/kicad/types";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { PIN_NAMES, ROOT_SHEET_ID, normalizeComponentRole, type KicadComponentInstance, type Point, type SchematicState } from "@/lib/schematic-types";
import { resolveProjectConnectivity, type ConnectivityDiagnostic, type PartPinsLookup, type ProjectNet } from "./project-connectivity";
import { freeBlockSlot, type PartPinsSource } from "./sheet-lens"; // [PR-J5 integration, 2026-10-26] - attachedSelection: the organise planner follows wire chains (groupEntities)
import { PORT_NAME_PATTERN, planMoveToSheet, type MoveCrossing, type MoveEntityRef, type MoveRefusalCode } from "./sheet-operations"; // [PR-J5, 2026-10-23] + PORT_NAME_PATTERN (interfaceNames)
import { assertWholeProject, sheetOf, sheetsOf } from "./sheets";

/** The part lookup the planner needs: pins (connectivity) and the catalog category (regulators are hubs). The parts cache
 *  (`getCachedPart`) and the fixture catalog satisfy it; a lookup that knows no category still works (roles come from the reference). */
export type OrganizePartSource = (partId: string) => { pins: readonly KicadPin[]; mainCategory?: string | null } | null | undefined;

/** A net touching more than this many parts of the sheet carries no grouping weight (it is a bus or a rail in all but name). */
export const HIGH_FANOUT_NET_PARTS = 6;
/** A group of connectors alone with fewer parts than this is an interface of the subsystem it talks to, not a subsystem. */
export const MIN_CONNECTOR_GROUP = 3;
/** The longest sheet name the proposal mints (the validator allows 120; the navigator 80). */
const MAX_SHEET_NAME = 80;

// ── the closed input shape (J5's proposal tool hands the same) ──────────────────────────────────────────────────────────────

export interface OrganizeGroupInput {
  /** The new sheet's name (sibling-unique under the source sheet; no "/"; at most 80 characters). */
  name: string;
  /** Reference designators of the catalog parts the group holds (each on the source sheet, each in exactly one group). */
  refs: readonly string[];
}

/** A grouping hint: a named block of reference designators (the generation plan's blocks). Hints break ties only. */
export interface OrganizeHint { name: string; refs: readonly string[] }

export type OrganizeRefusalCode = "ORGANIZE_CONNECTIVITY_INVALID" | "ORGANIZE_NOTHING_TO_SPLIT" | "ORGANIZE_GROUPS_INVALID" | "ORGANIZE_NOT_EQUIVALENT" | "ORGANIZE_REFUSED" | "ORGANIZE_DRAWING_DEGRADED" | MoveRefusalCode; // [PR-J5 integration, 2026-10-26] + ORGANIZE_DRAWING_DEGRADED (review J5R-AI-1)

export interface OrganizeProposalGroup extends OrganizeGroupInput {
  /** The hubs the group formed around (reference designators, natural order). */
  hubs: string[];
  /** Why these parts are one group, for the preview. */
  reason: string;
}

export interface OrganizeCheck {
  /** The parts whose placement a tie-break decided (one entry per cluster), natural order. */
  refs: string[];
  /** The group they were placed in. */
  group: string;
  /** The groups that weighed the same. */
  alternatives: string[];
  reason: string;
}

export type OrganizeProposal =
  | { ok: true; sourceSheetId: string; groups: OrganizeProposalGroup[]; residue: Array<{ ref: string; reason: string }>; checkThese: OrganizeCheck[] }
  | { ok: false; code: OrganizeRefusalCode; message: string; refs: string[]; diagnostics: ConnectivityDiagnostic[] };

export interface OrganizePlanStep {
  group: OrganizeGroupInput;
  sheetId: string;
  moved: { components: number; wires: number; labels: number };
  /** The nets the group's boundary cuts, each carried by an explicit port (SIG<n> for an unnamed net). */
  crossings: MoveCrossing[];
  renamedNets: Array<{ netId: string; from: string; to: string | null }>;
}

export type OrganizePlan =
  | { ok: true; operations: EngineeringOperation[]; inverseOperations: EngineeringOperation[]; after: SchematicState; preview: { sourceSheetId: string; steps: OrganizePlanStep[]; componentCount: number; partitionDigest: string } }
  | { ok: false; code: OrganizeRefusalCode; message: string; step: { name: string; refs: string[] } | null; diagnostics: ConnectivityDiagnostic[] };

// ── shared helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Reference designators in natural order: the letter prefix, then the number (R2 before R10), then code points. */
export function compareRefDes(a: string, b: string): number {
  const parse = (ref: string): [string, number] => { const match = /^([A-Za-z_]*)(\d*)/.exec(ref.trim()); return [(match?.[1] ?? "").toUpperCase(), match?.[2] ? Number(match[2]) : Number.POSITIVE_INFINITY]; };
  const [pa, na] = parse(a), [pb, nb] = parse(b);
  return compareCodePoints(pa, pb) || (na - nb) || compareCodePoints(a, b);
}

const sortRefs = (refs: Iterable<string>): string[] => [...new Set(refs)].sort(compareRefDes);

/** The new sheet's id for a group: a content digest of its sorted reference designators (the same group always gets the same id). */
export function organizeSheetId(refs: readonly string[]): string {
  return `sheet-org-${engineeringDigest({ schema: "sirkit.organize-sheet-id.v1", refs: sortRefs(refs) }).replace(/^eng1-/, "").slice(0, 12)}`;
}

/** A proposal's sheet name as the validator accepts it: no "/", trimmed, at most MAX_SHEET_NAME characters, never empty. */
export function organizeSheetName(raw: string): string {
  const cleaned = raw.replace(/\//g, "-").replace(/\s+/g, " ").trim();
  const bounded = cleaned.length > MAX_SHEET_NAME ? cleaned.slice(0, MAX_SHEET_NAME).trim() : cleaned;
  return bounded.length > 0 ? bounded : "Subsystem";
}

interface PartInfo { instance: KicadComponentInstance; refDes: string; role: ReturnType<typeof normalizeComponentRole>; category: string; hub: boolean; signalNets: number; value: string; partName: string }

const lookupOf = (getPart: OrganizePartSource): PartPinsLookup => (partId) => { const part = getPart(partId); return part ? { pins: part.pins } : null; };

// ── the proposal ────────────────────────────────────────────────────────────────────────────────────────────────────────────

class Grouping {
  readonly members = new Set<string>();
  constructor(readonly id: number, readonly hubs: string[]) { for (const hub of hubs) this.members.add(hub); }
}

/** The deterministic grouping proposal of the parts on `sourceSheetId` (the root by default). See the module header. */
export function proposeSheetGroups(state: SchematicState, getPart: OrganizePartSource, options: { sourceSheetId?: string; hints?: readonly OrganizeHint[] } = {}): OrganizeProposal {
  assertWholeProject(state, "organize-sheets");
  const sourceSheetId = options.sourceSheetId ?? ROOT_SHEET_ID;
  const hints = options.hints ?? [];
  const lookup = lookupOf(getPart);
  const conn = resolveProjectConnectivity(state, lookup);
  const refuse = (code: OrganizeRefusalCode, message: string, refs: string[] = [], diagnostics: ConnectivityDiagnostic[] = []): OrganizeProposal => ({ ok: false, code, message, refs, diagnostics });
  if (!conn.ok) return refuse("ORGANIZE_CONNECTIVITY_INVALID", `The project's connectivity has errors (${conn.diagnostics.filter((item) => item.severity === "error").map((item) => item.code).join(", ")}); fix them before organising it into sheets. Nothing was changed.`, [], conn.diagnostics.filter((item) => item.severity === "error"));
  const onSheet = (state.kicadComponents ?? []).filter((item) => sheetOf(item) === sourceSheetId);
  if (!sheetsOf(state).some((sheet) => sheet.id === sourceSheetId)) return refuse("ORGANIZE_GROUPS_INVALID", `Sheet ${sourceSheetId} does not exist. Nothing was changed.`);
  const unresolved = sortRefs(onSheet.filter((item) => !getPart(item.partId)).map((item) => item.refDes));
  if (unresolved.length > 0) return refuse("ORGANIZE_CONNECTIVITY_INVALID", `The pins of ${unresolved.join(", ")} are not loaded, so the grouping cannot be proven to keep every connection. Wait until all parts are loaded, then try again. Nothing was changed.`, unresolved);
  if (onSheet.length === 0) return refuse("ORGANIZE_NOTHING_TO_SPLIT", "This sheet holds no catalog parts to organise. Nothing was changed.");

  // the parts and their roles
  const parts = new Map<string, PartInfo>();
  const byId = new Map<string, PartInfo>();
  for (const instance of onSheet) {
    const part = getPart(instance.partId)!;
    const role = normalizeComponentRole(undefined, instance.refDes, part.pins.length);
    const category = part.mainCategory ?? "";
    const info: PartInfo = { instance, refDes: instance.refDes, role, category, hub: role === "processor" || role === "connector" || /regulator/i.test(category), signalNets: 0, value: instance.value.trim(), partName: "" };
    parts.set(instance.refDes, info);
    byId.set(instance.id, info);
  }
  // the nets of the sheet: rails (power / ground), signal nets (2..HIGH_FANOUT parts), the rest carry no weight
  interface NetInfo { net: ProjectNet; refs: string[]; kind: "power" | "ground" | "signal" | "none" }
  const nets: NetInfo[] = [];
  for (const net of conn.nets) {
    const refs = sortRefs(net.pins.map((pin) => byId.get(pin.componentId)?.refDes).filter((ref): ref is string => ref !== undefined));
    if (refs.length === 0) continue;
    const kind: NetInfo["kind"] = net.kind === "power" || net.kind === "ground" ? net.kind : refs.length >= 2 && refs.length <= HIGH_FANOUT_NET_PARTS ? "signal" : "none";
    nets.push({ net, refs, kind });
  }
  const signalNets = nets.filter((item) => item.kind === "signal");
  for (const item of signalNets) for (const ref of item.refs) parts.get(ref)!.signalNets += 1;
  const hubs = [...parts.values()].filter((info) => info.hub).map((info) => info.refDes).sort(compareRefDes);
  if (hubs.length < 2) return refuse("ORGANIZE_NOTHING_TO_SPLIT", hubs.length === 0 ? "No part on this sheet is a processor, regulator or connector, so there is no subsystem to organise around. Nothing was changed." : `This sheet forms one subsystem around ${hubs[0]} - nothing to split. Nothing was changed.`, hubs);

  // non-hub clusters over the signal nets (hubs never join two clusters)
  const clusterOf = new Map<string, string>();
  const find = (ref: string): string => { let root = ref; while (clusterOf.get(root) !== undefined && clusterOf.get(root) !== root) root = clusterOf.get(root)!; return root; };
  const union = (a: string, b: string): void => { const ra = find(a), rb = find(b); if (ra !== rb) clusterOf.set(compareRefDes(ra, rb) <= 0 ? rb : ra, compareRefDes(ra, rb) <= 0 ? ra : rb); };
  for (const info of parts.values()) if (!info.hub) clusterOf.set(info.refDes, info.refDes);
  for (const item of signalNets) { const nonHubs = item.refs.filter((ref) => !parts.get(ref)!.hub); for (let index = 1; index < nonHubs.length; index += 1) union(nonHubs[0]!, nonHubs[index]!); }
  const clusters = new Map<string, string[]>();
  for (const info of parts.values()) if (!info.hub) { const root = find(info.refDes); clusters.set(root, [...(clusters.get(root) ?? []), info.refDes]); }

  const hintOf = (ref: string): OrganizeHint | undefined => hints.find((hint) => hint.refs.includes(ref));
  const sameHint = (refs: readonly string[], candidate: readonly string[]): boolean => { const hint = refs.map(hintOf).find((item) => item !== undefined); return hint !== undefined && candidate.some((ref) => hint.refs.includes(ref)); };

  // groups form around the hubs
  const groups: Grouping[] = hubs.map((hub, index) => new Grouping(index, [hub]));
  const groupOfRef = new Map<string, Grouping>();
  for (const group of groups) for (const hub of group.hubs) groupOfRef.set(hub, group);
  const checkThese: OrganizeCheck[] = [];
  const residue: Array<{ ref: string; reason: string }> = [];
  const pendingRailOnly: string[][] = [];
  const ownGroups: string[][] = [];
  const describe = (group: Grouping): string => group.hubs.join(", ");

  // 1. signal clusters attach to hubs by weight (shared signal nets, then the hub's specificity), ties by hint then the smaller reference
  for (const [, clusterRefs] of [...clusters.entries()].sort(([a], [b]) => compareRefDes(a, b))) {
    const refs = sortRefs(clusterRefs);
    const votes = new Map<string, Set<string>>();
    for (const item of signalNets) {
      if (!item.refs.some((ref) => refs.includes(ref))) continue;
      for (const ref of item.refs) if (parts.get(ref)!.hub) votes.set(ref, new Set([...(votes.get(ref) ?? []), item.net.id]));
    }
    if (votes.size === 0) { pendingRailOnly.push(refs); continue; }
    const ranked = [...votes.entries()].map(([hub, shared]) => ({ hub, weight: shared.size, specificity: parts.get(hub)!.signalNets }))
      .sort((a, b) => (b.weight - a.weight) || (a.specificity - b.specificity) || compareRefDes(a.hub, b.hub));
    const top = ranked.filter((entry) => entry.weight === ranked[0]!.weight);
    let chosen = top[0]!.hub;
    let rule = "";
    if (top.length > 1) {
      const hinted = top.filter((entry) => sameHint(refs, [entry.hub]));
      if (hinted.length >= 1) { chosen = hinted.sort((a, b) => (a.specificity - b.specificity) || compareRefDes(a.hub, b.hub))[0]!.hub; rule = `the plan's block names ${chosen}`; }
      else if (top.filter((entry) => entry.specificity === top[0]!.specificity).length === 1) { chosen = top[0]!.hub; rule = `${chosen} has fewer signals (${top[0]!.specificity}) than ${top.slice(1).map((entry) => `${entry.hub} (${entry.specificity})`).join(", ")}: the shared part goes to the peripheral`; }
      else { chosen = top.filter((entry) => entry.specificity === top[0]!.specificity).sort((a, b) => compareRefDes(a.hub, b.hub))[0]!.hub; rule = `${chosen} has the smaller reference designator`; }
      checkThese.push({ refs, group: chosen, alternatives: top.map((entry) => entry.hub).filter((hub) => hub !== chosen), reason: `${refs.join(", ")} share${refs.length === 1 ? "s" : ""} ${ranked[0]!.weight} signal net${ranked[0]!.weight === 1 ? "" : "s"} with each of ${top.map((entry) => entry.hub).join(", ")}; placed with ${chosen} because ${rule}.` });
    }
    const group = groupOfRef.get(chosen)!;
    for (const ref of refs) { group.members.add(ref); groupOfRef.set(ref, group); }
  }

  // 2. repeated channels: hub groups with the same structure are one subsystem
  const signature = (group: Grouping): string => JSON.stringify([group.hubs.map((hub) => parts.get(hub)!.instance.partId).sort(compareCodePoints), [...group.members].filter((ref) => !group.hubs.includes(ref)).map((ref) => [parts.get(ref)!.instance.partId, parts.get(ref)!.value]).sort((a, b) => compareCodePoints(a.join("\u0000"), b.join("\u0000")))]);
  const bySignature = new Map<string, Grouping[]>();
  for (const group of groups) bySignature.set(signature(group), [...(bySignature.get(signature(group)) ?? []), group]);
  const merged = new Set<Grouping>();
  const mergeInto = (target: Grouping, source: Grouping): void => { for (const ref of source.members) { target.members.add(ref); groupOfRef.set(ref, target); } merged.add(source); };
  const repeated: Grouping[] = [];
  for (const same of bySignature.values()) {
    if (same.length < 2 || same[0]!.members.size < 2) continue;
    const [first, ...rest] = same.sort((a, b) => compareRefDes(a.hubs[0]!, b.hubs[0]!));
    const combined = new Grouping(first!.id, same.flatMap((group) => group.hubs).sort(compareRefDes));
    for (const group of same) mergeInto(combined, group);
    repeated.push(combined);
    void rest;
  }
  let live = [...groups.filter((group) => !merged.has(group)), ...repeated].sort((a, b) => compareRefDes(a.hubs[0]!, b.hubs[0]!));

  // 3. a small connector group is an interface of the subsystem it talks to
  const sharedNets = (a: Grouping, b: Grouping, kinds: ReadonlyArray<NetInfo["kind"]>): number => nets.filter((item) => kinds.includes(item.kind) && item.refs.some((ref) => a.members.has(ref)) && item.refs.some((ref) => b.members.has(ref))).length;
  const pickGroup = (refs: readonly string[], candidates: Grouping[], weightOf: (group: Grouping) => number, railsOnly: boolean): { group: Grouping; tie: Grouping[]; rule: string } | null => {
    const ranked = candidates.map((group) => ({ group, weight: weightOf(group) })).filter((entry) => entry.weight > 0).sort((a, b) => (b.weight - a.weight) || compareRefDes(a.group.hubs[0]!, b.group.hubs[0]!));
    if (ranked.length === 0) return null;
    const top = ranked.filter((entry) => entry.weight === ranked[0]!.weight).map((entry) => entry.group);
    if (top.length === 1) return { group: top[0]!, tie: [], rule: "" };
    const hinted = top.filter((group) => sameHint(refs, [...group.members]));
    if (hinted.length >= 1) return { group: hinted[0]!, tie: top, rule: `the plan's block names ${describe(hinted[0]!)}` };
    if (!railsOnly) {
      const specific = [...top].sort((a, b) => Math.min(...a.hubs.map((hub) => parts.get(hub)!.signalNets)) - Math.min(...b.hubs.map((hub) => parts.get(hub)!.signalNets)) || compareRefDes(a.hubs[0]!, b.hubs[0]!));
      if (Math.min(...specific[0]!.hubs.map((hub) => parts.get(hub)!.signalNets)) < Math.min(...specific[1]!.hubs.map((hub) => parts.get(hub)!.signalNets))) return { group: specific[0]!, tie: top, rule: `${describe(specific[0]!)} has fewer signals: the shared part goes to the peripheral` };
    }
    return { group: top[0]!, tie: top, rule: `${top[0]!.hubs[0]} has the smaller reference designator` };
  };
  for (const group of [...live]) {
    if (!(group.members.size < MIN_CONNECTOR_GROUP && group.hubs.every((hub) => parts.get(hub)!.role === "connector"))) continue;
    const others = live.filter((other) => other !== group);
    const refs = sortRefs(group.members);
    const picked = pickGroup(refs, others, (other) => sharedNets(group, other, ["signal"]), false) ?? pickGroup(refs, others, (other) => sharedNets(group, other, ["power"]), true);
    if (!picked) continue; // shares nothing: stays a group of its own (or residue below)
    if (picked.tie.length > 1) checkThese.push({ refs, group: describe(picked.group), alternatives: picked.tie.filter((other) => other !== picked.group).map(describe), reason: `${refs.join(", ")} (a connector with ${group.members.size === 1 ? "nothing" : `${group.members.size - 1} part(s)`} attached) weigh${refs.length === 1 ? "s" : ""} the same towards ${picked.tie.map(describe).join(" and ")}; placed with ${describe(picked.group)} because ${picked.rule}.` });
    mergeInto(picked.group, group);
    live = live.filter((other) => other !== group);
  }

  // 4. rail-only clusters: the power rails shared with each group (ground carries no weight); ties by hint, then the smaller reference
  for (const refs of pendingRailOnly) {
    const picked = pickGroup(refs, live, (group) => nets.filter((item) => item.kind === "power" && item.refs.some((ref) => refs.includes(ref)) && item.refs.some((ref) => group.members.has(ref))).length, true);
    const rails = sortRefs(nets.filter((item) => (item.kind === "power" || item.kind === "ground") && item.refs.some((ref) => refs.includes(ref))).map((item) => item.net.name ?? "?"));
    if (!picked) {
      if (refs.length >= 2) ownGroups.push(refs);
      else for (const ref of refs) residue.push({ ref, reason: rails.length > 0 ? `${ref} connects to ${rails.join(", ")} only and shares no power rail with a subsystem: it stays here; move it by hand if it belongs to one.` : `${ref} connects to nothing on this sheet: it stays here.` });
      continue;
    }
    if (picked.tie.length > 1) checkThese.push({ refs, group: describe(picked.group), alternatives: picked.tie.filter((other) => other !== picked.group).map(describe), reason: `${refs.join(", ")} connect${refs.length === 1 ? "s" : ""} to rails only (${rails.join(", ")}), which ${picked.tie.map(describe).join(", ")} all share; placed with ${describe(picked.group)} because ${picked.rule}.` });
    for (const ref of refs) { picked.group.members.add(ref); groupOfRef.set(ref, picked.group); }
  }

  // 5. isolated clusters of two or more parts are their own group; a group left with one part dissolves into the residue
  const finalGroups: Array<{ hubs: string[]; refs: string[]; reason: string }> = [];
  for (const group of live) {
    const refs = sortRefs(group.members);
    if (refs.length < 2) { for (const ref of refs) residue.push({ ref, reason: `${ref} forms no subsystem with any other part on this sheet: it stays here.` }); continue; }
    const attached = refs.filter((ref) => !group.hubs.includes(ref));
    finalGroups.push({ hubs: group.hubs, refs, reason: group.hubs.length > 1 ? `${group.hubs.length} channels of the same structure (${group.hubs.join(", ")}), ${attached.length} part(s) around them.` : `${group.hubs[0]} with the ${attached.length} part(s) connected to it.` });
  }
  for (const refs of ownGroups) finalGroups.push({ hubs: [], refs, reason: `${refs.join(", ")} connect to each other and to no subsystem.` });
  if (finalGroups.length < 2) return refuse("ORGANIZE_NOTHING_TO_SPLIT", finalGroups.length === 1 ? `The parts on this sheet form one subsystem (${finalGroups[0]!.hubs.join(", ") || finalGroups[0]!.refs.slice(0, 4).join(", ")}) - nothing to split. Nothing was changed.` : "The parts on this sheet form no subsystem of two or more parts. Nothing was changed.", hubs);

  // names: the hint block that names the primary hub, else the primary hub's value (its part name when empty), repeated channels by
  // their common value prefix; sibling-unique under the source sheet and within the proposal
  const taken = new Set(sheetsOf(state).filter((sheet) => sheet.parentId === sourceSheetId).map((sheet) => sheet.name.trim().toLowerCase()));
  const unique = (base: string): string => { let name = organizeSheetName(base); for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = organizeSheetName(`${base} ${n}`); taken.add(name.toLowerCase()); return name; };
  const primaryHub = (group: { hubs: string[]; refs: string[] }): string | null => group.hubs.filter((hub) => parts.get(hub)!.role !== "connector").sort(compareRefDes)[0] ?? group.hubs[0] ?? null;
  const nameOf = (group: { hubs: string[]; refs: string[] }): string => {
    const primary = primaryHub(group);
    const hint = primary ? hintOf(primary) : group.refs.map(hintOf).find((item) => item !== undefined);
    if (hint && hint.name.trim().length > 0) return hint.name;
    if (primary === null) return `Parts ${group.refs[0]}-${group.refs[group.refs.length - 1]}`;
    const info = parts.get(primary)!;
    if (group.hubs.length > 1) {
      const values = group.hubs.map((hub) => parts.get(hub)!.value || hub);
      let prefix = values[0]!;
      for (const value of values) { let index = 0; while (index < prefix.length && index < value.length && prefix[index] === value[index]) index += 1; prefix = prefix.slice(0, index); }
      prefix = prefix.replace(/[\d_\-\s.]+$/, "");
      const label = prefix.length >= 2 ? prefix : info.category || "Channel";
      return `${label} x${group.hubs.length} (${group.hubs[0]}-${group.hubs[group.hubs.length - 1]})`;
    }
    return `${info.value || info.category || primary} (${primary})`;
  };
  const proposed: OrganizeProposalGroup[] = finalGroups
    .sort((a, b) => compareRefDes(a.hubs[0] ?? a.refs[0]!, b.hubs[0] ?? b.refs[0]!))
    .map((group) => ({ name: unique(nameOf(group)), refs: group.refs, hubs: group.hubs, reason: group.reason }));
  return { ok: true, sourceSheetId, groups: proposed, residue: residue.sort((a, b) => compareRefDes(a.ref, b.ref)), checkThese };
}

// ── the plan ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Why `groups` cannot be planned over the parts of `sourceSheetId`, or null. */
export function validateOrganizeGroups(state: SchematicState, groups: readonly OrganizeGroupInput[], sourceSheetId: string): string | null {
  if (groups.length === 0) return "No group was named.";
  const onSheet = new Map((state.kicadComponents ?? []).filter((item) => sheetOf(item) === sourceSheetId).map((item) => [item.refDes, item] as const));
  const siblings = new Set(sheetsOf(state).filter((sheet) => sheet.parentId === sourceSheetId).map((sheet) => sheet.name.trim().toLowerCase()));
  const seenRefs = new Set<string>();
  const seenNames = new Set<string>();
  const ids = new Set(sheetsOf(state).map((sheet) => sheet.id));
  for (const group of groups) {
    const name = group.name.trim();
    if (name.length === 0) return "A group needs a name.";
    if (name.length > MAX_SHEET_NAME) return `The group name "${name.slice(0, 20)}..." is longer than ${MAX_SHEET_NAME} characters.`;
    if (name.includes("/")) return `The group name "${name}" cannot contain "/" (it separates the sheet path).`;
    if (siblings.has(name.toLowerCase())) return `A sheet named "${name}" already exists here.`;
    if (seenNames.has(name.toLowerCase())) return `Two groups are both named "${name}".`;
    seenNames.add(name.toLowerCase());
    if (group.refs.length === 0) return `Group "${name}" holds no part.`;
    for (const ref of group.refs) {
      if (!onSheet.has(ref)) return `${ref} (group "${name}") is not a catalog part on this sheet.`;
      if (seenRefs.has(ref)) return `${ref} is in two groups.`;
      seenRefs.add(ref);
    }
    if (ids.has(organizeSheetId(group.refs))) return `A sheet for exactly the parts of group "${name}" already exists.`;
  }
  return null;
}

/** A port anchor (hierarchical label, sheet pin): it belongs to the sheet structure and never moves. */
const isPortAnchor = (label: { scope?: string }): boolean => label.scope === "hierarchical" || label.scope === "sheet-pin";

/**
 * [PR-J5 integration, 2026-10-26] review J5R-AI-1 (OPEN ISSUE J5-C-1): the entities a group takes along, following WIRE CHAINS (it took
 * one hop of wire per pin, so a route the page drew as several segments left its inner segments behind - refused as ambiguous, or, for
 * a cut route, sealed with wire ends in the air). A chain is the wires of the source sheet joined vertex to vertex anywhere but at a pin
 * (the route's segments and junctions); it stops at every pin. A chain whose pins all belong to the group's parts, and which touches no
 * port anchor, moves WHOLE with the local labels on it. A chain that also reaches a part outside the group (a cut route) stays on the
 * source sheet, and the points where it met the group's pins are the parent-side anchor points handed to the move planner: the new
 * port's sheet pin terminates the route where the moved pin was. The local labels at the group's own pins move with the parts.
 */
interface GroupAttachment { entities: MoveEntityRef[]; parentAnchorPoints: Point[] }
function groupEntities(state: SchematicState, refs: readonly string[], getPart: PartPinsSource): GroupAttachment | string {
  const instances: KicadComponentInstance[] = [];
  for (const ref of refs) {
    const instance = (state.kicadComponents ?? []).find((item) => item.refDes === ref);
    if (!instance) return `${ref} is not in the project.`;
    instances.push(instance);
  }
  const sheetId = sheetOf(instances[0]!);
  const members = new Set(instances.map((item) => item.id));
  // the pin sites of the sheet: point -> the components with a pin there
  const pinOwners = new Map<string, Set<string>>();
  const memberPins = new Map<string, Point[]>();
  const addPin = (point: Point, owner: string): void => { const key = pointKey(point); pinOwners.set(key, new Set([...(pinOwners.get(key) ?? []), owner])); };
  for (const instance of state.kicadComponents ?? []) {
    if (sheetOf(instance) !== sheetId) continue;
    const part = getPart(instance.partId);
    if (!part) continue; // an unresolved part: the move planner refuses it by name (SHEET_MOVE_CONNECTIVITY_INVALID, review J1-OPS-4)
    const points = part.pins.map((pin) => kicadPinWorldPos(instance, pin));
    for (const point of points) addPin(point, instance.id);
    if (members.has(instance.id)) memberPins.set(instance.id, points);
  }
  for (const component of state.components) if (sheetOf(component) === sheetId) for (const pin of PIN_NAMES[component.type] ?? []) addPin(pinWorldPos(component, pin), component.id);
  const labels = (state.netLabels ?? []).filter((label) => sheetOf(label) === sheetId);
  const anchorPoints = new Set(labels.filter(isPortAnchor).map((label) => pointKey(label.position)));
  // the chains: wires of the sheet sharing a vertex that is not a pin site
  const wires = state.wires.filter((wire) => sheetOf(wire) === sheetId && (wire.vertices?.length ?? 0) >= 2);
  const root = wires.map((_, index) => index);
  const find = (index: number): number => { while (root[index] !== index) { root[index] = root[root[index]!]!; index = root[index]!; } return index; };
  const byPoint = new Map<string, number[]>();
  wires.forEach((wire, index) => { for (const key of new Set(wire.vertices.map(pointKey))) byPoint.set(key, [...(byPoint.get(key) ?? []), index]); });
  for (const [key, list] of byPoint) { if (pinOwners.has(key)) continue; for (const other of list.slice(1)) { const a = find(list[0]!), b = find(other); if (a !== b) root[Math.max(a, b)] = Math.min(a, b); } }
  const chainPoints = new Map<number, Set<string>>();
  wires.forEach((wire, index) => { const chain = find(index); const points = chainPoints.get(chain) ?? new Set<string>(); for (const vertex of wire.vertices) points.add(pointKey(vertex)); chainPoints.set(chain, points); });
  const moves = (chain: number): boolean => [...chainPoints.get(chain)!].every((key) => !anchorPoints.has(key) && [...(pinOwners.get(key) ?? [])].every((owner) => members.has(owner)));

  const seen = new Set<string>();
  const entities: MoveEntityRef[] = [];
  const parentAnchorPoints: Point[] = [];
  const anchored = new Set<string>();
  const take = (entity: MoveEntityRef): void => { const key = `${entity.family}:${entity.id}`; if (!seen.has(key)) { seen.add(key); entities.push(entity); } };
  for (const instance of instances) {
    take({ family: "kicad", id: instance.id });
    const pins = memberPins.get(instance.id) ?? [];
    const pinKeys = new Set(pins.map(pointKey));
    const chains = new Set(wires.flatMap((wire, index) => (wire.vertices.some((vertex) => pinKeys.has(pointKey(vertex))) ? [find(index)] : [])));
    const moved = new Set([...chains].filter(moves));
    const reached = new Set<string>(pinKeys);
    wires.forEach((wire, index) => { if (moved.has(find(index))) { take({ family: "wire", id: wire.id }); for (const vertex of wire.vertices) reached.add(pointKey(vertex)); } });
    for (const label of labels) if (!isPortAnchor(label) && reached.has(pointKey(label.position))) take({ family: "label", id: label.id });
    // a cut route stays: the moved pins it met are its parent-side anchor points (in pin order; one per point)
    for (const pin of pins) { const key = pointKey(pin); if (anchored.has(key)) continue; if ([...chains].some((chain) => !moved.has(chain) && chainPoints.get(chain)!.has(key))) { anchored.add(key); parentAnchorPoints.push({ x: pin.x, y: pin.y }); } }
  }
  return { entities, parentAnchorPoints };
}

/**
 * [PR-J5 integration, 2026-10-26] review J5R-AI-1: the DRAWING defects of every sheet - wire ends at no pin, no label (of any scope) and
 * no other wire's vertex (dangling), and wire islands (wires joined vertex to vertex) that touch no pin and no label - by sheet id, each
 * as `wireId@x,y` / the island's wire ids (sorted, `+`-joined). The pin-to-net partition cannot see them (a dangling end joins nothing),
 * so the organise planner refuses a step that leaves a NEW one on any sheet: an electrically equivalent but broken drawing is never
 * sealed. [PR-J5 integration, 2026-10-26] a defect the drawing already had (the same wire end, the same island) is not new when the
 * move carries it to another sheet - the move keeps wire ids and points - so it never masks the re-plan's own refusal (j4-organize-dialog 2).
 */
export function sheetDrawingDefects(state: SchematicState, getPart: PartPinsSource): Map<string, { danglingEnds: string[]; islands: string[] }> {
  const sites = new Set<string>();
  const at = (sheetId: string, point: Point): string => `${sheetId}\u0000${pointKey(point)}`;
  for (const instance of state.kicadComponents ?? []) for (const pin of getPart(instance.partId)?.pins ?? []) sites.add(at(sheetOf(instance), kicadPinWorldPos(instance, pin)));
  for (const component of state.components) for (const pin of PIN_NAMES[component.type] ?? []) sites.add(at(sheetOf(component), pinWorldPos(component, pin)));
  for (const label of state.netLabels ?? []) sites.add(at(sheetOf(label), label.position));
  const wires = state.wires.filter((wire) => (wire.vertices?.length ?? 0) >= 2);
  const vertexWires = new Map<string, Set<number>>();
  wires.forEach((wire, index) => { for (const vertex of wire.vertices) { const key = at(sheetOf(wire), vertex); vertexWires.set(key, new Set([...(vertexWires.get(key) ?? []), index])); } });
  const out = new Map<string, { danglingEnds: string[]; islands: string[] }>();
  const entry = (sheetId: string) => { const found = out.get(sheetId) ?? { danglingEnds: [], islands: [] }; out.set(sheetId, found); return found; };
  for (const sheet of sheetsOf(state)) entry(sheet.id);
  const root = wires.map((_, index) => index);
  const find = (index: number): number => { while (root[index] !== index) { root[index] = root[root[index]!]!; index = root[index]!; } return index; };
  for (const list of vertexWires.values()) { const items = [...list]; for (const other of items.slice(1)) { const a = find(items[0]!), b = find(other); if (a !== b) root[Math.max(a, b)] = Math.min(a, b); } }
  const touches = new Map<number, boolean>();
  wires.forEach((wire, index) => {
    const sheetId = sheetOf(wire);
    for (const end of [wire.vertices[0]!, wire.vertices[wire.vertices.length - 1]!]) {
      const key = at(sheetId, end);
      if (!sites.has(key) && ![...(vertexWires.get(key) ?? [])].some((other) => other !== index)) entry(sheetId).danglingEnds.push(`${wire.id}@${end.x},${end.y}`);
    }
    const chain = find(index);
    touches.set(chain, (touches.get(chain) ?? false) || wire.vertices.some((vertex) => sites.has(at(sheetId, vertex))));
  });
  const islandWires = new Map<number, string[]>();
  wires.forEach((wire, index) => { const chain = find(index); if (!touches.get(chain)) islandWires.set(chain, [...(islandWires.get(chain) ?? []), wire.id]); });
  for (const [chain, ids] of islandWires) entry(sheetOf(wires[chain]!)).islands.push([...ids].sort(compareCodePoints).join("+"));
  return out;
}

/** The first sheet of `after` holding a drawing defect `before` did not have anywhere (a dangling wire end or a wire island, by key), with
 *  the new ones, or null. [PR-J5 integration, 2026-10-26] by key across the whole document (was: a per-sheet count, so a defect the base
 *  already had, carried to the new sheet by the move, refused a sound organisation). */
function degradedSheet(before: ReturnType<typeof sheetDrawingDefects>, after: ReturnType<typeof sheetDrawingDefects>): { sheetId: string; danglingEnds: string[]; islands: string[] } | null {
  const had = new Set([...before.values()].flatMap((entry) => [...entry.danglingEnds.map((key) => `end:${key}`), ...entry.islands.map((key) => `island:${key}`)]));
  for (const [sheetId, now] of after) {
    const danglingEnds = now.danglingEnds.filter((key) => !had.has(`end:${key}`));
    const islands = now.islands.filter((key) => !had.has(`island:${key}`));
    if (danglingEnds.length > 0 || islands.length > 0) return { sheetId, danglingEnds, islands };
  }
  return null;
}

/**
 * Plan organising `groups` into new child sheets of `sourceSheetId` as ONE schematic.move-to-sheet transaction (see the module header).
 * Pure and deterministic: the same input yields the same operations, ids included.
 */
export function planOrganizeIntoSheets(state: SchematicState, groups: readonly OrganizeGroupInput[], getPart: OrganizePartSource, options: { sourceSheetId?: string; rootName?: string; operationIdPrefix?: string; portNames?: Readonly<Record<string, string>> } = {}): OrganizePlan {
  assertWholeProject(state, "organize-sheets");
  const sourceSheetId = options.sourceSheetId ?? ROOT_SHEET_ID;
  const prefix = options.operationIdPrefix ?? "organize";
  const refuse = (code: OrganizeRefusalCode, message: string, step: { name: string; refs: string[] } | null = null, diagnostics: ConnectivityDiagnostic[] = []): OrganizePlan => ({ ok: false, code, message, step, diagnostics });
  const problem = validateOrganizeGroups(state, groups, sourceSheetId);
  if (problem !== null) return refuse("ORGANIZE_GROUPS_INVALID", `${problem} Nothing was changed.`);
  // [PR-J5, 2026-10-23] OD-259 item 4: the caller's names for unnamed crossings, keyed by the SIG<n> the chain mints (the organise
  // proposal reports them); each key must name a port the chain actually mints, each value is validated by planMoveToSheet
  const portNames = options.portNames ?? {};
  for (const [key, value] of Object.entries(portNames)) {
    if (!/^SIG\d{1,4}$/.test(key)) return refuse("ORGANIZE_GROUPS_INVALID", `interfaceNames keys name the SIG<n> ports of unnamed crossing nets ("${key.slice(0, 40)}" is not one). Nothing was changed.`);
    if (typeof value !== "string" || !PORT_NAME_PATTERN.test(value)) return refuse("ORGANIZE_GROUPS_INVALID", `The interface name for ${key} must be 1-64 letters, digits, "_", "+", "-" or ".". Nothing was changed.`);
  }
  const lookup = lookupOf(getPart);
  const pinsSource: PartPinsSource = (partId) => getPart(partId) ?? null;
  const before = resolveProjectConnectivity(state, lookup);
  if (!before.ok) return refuse("ORGANIZE_CONNECTIVITY_INVALID", "The project's connectivity has errors; fix them before organising it into sheets. Nothing was changed.", null, before.diagnostics.filter((item) => item.severity === "error"));

  let current = state;
  const operations: EngineeringOperation[] = [];
  const inverseOperations: EngineeringOperation[] = [];
  const steps: OrganizePlanStep[] = [];
  for (const [index, group] of groups.entries()) {
    const attachment = groupEntities(current, group.refs, pinsSource);
    if (typeof attachment === "string") return refuse("ORGANIZE_GROUPS_INVALID", `${attachment} Nothing was changed.`, { name: group.name, refs: [...group.refs] });
    const { entities, parentAnchorPoints } = attachment; // [PR-J5 integration, 2026-10-26] review J5R-AI-1: whole wire chains, and the anchor points of the cut ones
    const sheetId = organizeSheetId(group.refs);
    const renamedDefaults = steps.flatMap((step) => step.crossings.flatMap((crossing) => (crossing.renamedFrom !== undefined ? [crossing.renamedFrom] : []))); const plan = planMoveToSheet(current, { entities, target: { newSheet: { id: sheetId, name: group.name.trim(), block: freeBlockSlot(current, sourceSheetId) } }, rootName: options.rootName ?? "Overview", operationIdPrefix: `${prefix}:${index}`, ...(options.portNames ? { portNames: options.portNames } : {}), ...(renamedDefaults.length > 0 ? { reservedPortNames: renamedDefaults } : {}), ...(parentAnchorPoints.length > 0 ? { parentAnchorPoints } : {}) }, lookup); // [PR-J5, 2026-10-23] + portNames, reservedPortNames (+ reservedPortNames: an earlier step's renamed SIG<n> stays taken, so the reported keys keep their numbers; in place)
    // any refused step refuses the whole plan: an ambiguous or non-equivalent split never changes the design (J.3 item 4)
    if (!plan.ok) return refuse(plan.code, `Group "${group.name}" (${group.refs.join(", ")}): ${plan.message}`, { name: group.name, refs: [...group.refs] }, plan.diagnostics);
    // [PR-J5 integration, 2026-10-26] review J5R-AI-1: the partition proof cannot see a broken DRAWING (a wire end in the air joins nothing), so
    // a step that leaves more dangling wire ends or wire islands on any sheet is refused: an equivalent but degraded drawing is never sealed
    const degraded = degradedSheet(sheetDrawingDefects(current, pinsSource), sheetDrawingDefects(plan.after, pinsSource));
    if (degraded !== null) {
      const sheetName = sheetsOf(plan.after).find((sheet) => sheet.id === degraded.sheetId)?.name ?? degraded.sheetId;
      return refuse("ORGANIZE_DRAWING_DEGRADED", `Group "${group.name}" (${group.refs.join(", ")}): the move would leave ${degraded.danglingEnds.length} wire end(s) unconnected${degraded.islands.length > 0 ? ` and ${degraded.islands.length} wire piece(s) touching no pin or label` : ""} on sheet "${sheetName}" (a wire route of the group meets several of its pins and a part outside it, so no single port can end it); put that route's parts in one group, or move them by hand. Nothing was changed.`, { name: group.name, refs: [...group.refs] });
    }
    operations.push(...plan.operations);
    inverseOperations.unshift(...plan.inverseOperations);
    steps.push({ group: { name: group.name.trim(), refs: [...group.refs] }, sheetId, moved: plan.preview.moved, crossings: plan.preview.crossings, renamedNets: plan.preview.renamedNets });
    current = plan.after;
  }
  // [PR-J5, 2026-10-23] a supplied interface name that no step consumed names a port the plan does not mint: refused, nothing changed
  const consumed = new Set(steps.flatMap((step) => step.crossings.flatMap((crossing) => (crossing.renamedFrom !== undefined ? [crossing.renamedFrom] : []))));
  const unconsumed = Object.keys(portNames).filter((key) => !consumed.has(key)).sort(compareCodePoints);
  if (unconsumed.length > 0) return refuse("ORGANIZE_GROUPS_INVALID", `interfaceNames names ${unconsumed.join(", ")}, but the organisation mints no such port (its unnamed crossings are ${[...new Set(steps.flatMap((step) => step.crossings.filter((crossing) => crossing.netName === null).map((crossing) => crossing.renamedFrom ?? crossing.port.name)))].sort(compareCodePoints).join(", ") || "none"}). Nothing was changed.`);

  // the whole chain as ONE batch through the executor's own code: its result is the chain's, and the partition is the original's
  let batched: SchematicState;
  try { batched = fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(state), operations).schematic); }
  catch (error) { return refuse("ORGANIZE_REFUSED", `The organisation cannot be applied as one transaction: ${error instanceof Error ? error.message : String(error)} Nothing was changed.`); }
  if (schematicStateDigest(batched) !== schematicStateDigest(current)) return refuse("ORGANIZE_REFUSED", "The organisation applied as one transaction differs from the planned steps. Nothing was changed.");
  const after = resolveProjectConnectivity(current, lookup);
  if (!after.ok || after.partitionDigest !== before.partitionDigest) return refuse("ORGANIZE_NOT_EQUIVALENT", "The organisation would change which pins are connected. Nothing was changed.", null, after.diagnostics.filter((item) => item.severity === "error"));
  return {
    ok: true,
    operations,
    inverseOperations,
    after: current,
    preview: { sourceSheetId, steps, componentCount: steps.reduce((sum, step) => sum + step.moved.components, 0), partitionDigest: after.partitionDigest },
  };
}

/** The ports a plan creates, by name, in step order (the preview's "interfaces"). */
export function organizePlanPorts(plan: Extract<OrganizePlan, { ok: true }>): Array<{ sheetId: string; sheetName: string; ports: string[] }> {
  return plan.preview.steps.map((step) => ({ sheetId: step.sheetId, sheetName: step.group.name, ports: [...new Set(step.crossings.map((crossing) => crossing.port.name))].sort(compareCodePoints) }));
}

/** A proposal's groups as the closed input shape alone (no hubs, no reasons): what Apply re-plans on the canonical base. */
export function organizeGroupInputs(proposal: Extract<OrganizeProposal, { ok: true }>): OrganizeGroupInput[] {
  return proposal.groups.map((group) => ({ name: group.name, refs: [...group.refs] }));
}
