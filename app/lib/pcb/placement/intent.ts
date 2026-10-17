/**
 * [PR-F, 2026-10-17] The structured placement INTENT (`sirkit.placement-intent.v1`) the agent's `sirkit.placement.propose` may
 * carry (directive section 8): functional groups and placement regions, relative placement and orientation, explicit component
 * coordinates and side, pin-specific proximity, separation and routing corridors, critical-net priorities. Every item is bound to
 * EXACT identities of the source revision - a component is `{ ref, instanceId }` and BOTH must name the same footprint, a net is
 * `{ name, id }` and both must name the same board net - and every length is in millimetres in the board's world frame
 * (`PLACEMENT_INTENT_FRAME_STATEMENT`, read from app/lib/pcb/units.ts and app/lib/pcb/geometry.ts, never assumed).
 *
 * Two pure functions, no engine of their own:
 *  - `compilePlacementIntent` validates and binds ALL-OR-NOTHING (an unknown identity refuses the whole intent as blockers data) and
 *    derives the engine seed (`PlacementIntentSeed`): the explicit coordinates, a region's centroid for a grouped member without
 *    coordinates, and a position beside the reference for a proximity item without coordinates; the EXISTING engine then runs its
 *    orientation refinement (pinned orientations kept), exact legalization, hard anchors, hard validator and objectives unchanged;
 *  - `evaluatePlacementIntent` compares the SELECTED candidate with the intent and writes the CONFLICT list (component, what the
 *    intent asked, what happened): a locked / fixed instance the intent tried to move (the lock is preserved), a keepout (a locked
 *    obstacle, a constraint region, the intent's own corridor), a request outside the board, a coordinate legalization moved, an
 *    orientation the allowed set refused, a group member outside its region, an unmet proximity or separation, a corridor entered,
 *    the seeded candidate replaced by a legal one. Nothing is discarded silently; what is satisfied is listed too.
 *
 * The scope gate (directive section 2): a board over PLACEMENT_SCOPE_LIMIT physical instances is classified `unsupported-scope` in
 * the candidate's data - the intent is recorded, NOT seeded, and the B17-F engine run stands on its own; never a refusal without
 * words, never a fabricated success. Critical-net priorities travel as data (`not-enforced-by-placement`): the placement engine
 * takes no net-priority input, and saying otherwise would be an invented capability.
 */
import type { BBox, Vec2 } from "../geometry";
import { bboxFitsPolygon, bboxIntersectsPolygon, bboxesOverlap, courtyardFitsOutline, worldCourtyardBBox } from "../autoplace/geometry";
import { padWorldPosition } from "../geometry-copper";
import type { PcbBoard } from "../types";
import { mmToNm } from "../units";
import { boardWithPlacement } from "./geometry";
import type { PlacementCandidate, PlacementIntentSeed, PlacementProblem, PlacementRunResult, PlacementTransform } from "./types";

export const PLACEMENT_INTENT_SCHEMA = "sirkit.placement-intent.v1" as const;
export const PLACEMENT_INTENT_UNITS = "mm" as const;
export const PLACEMENT_INTENT_FRAME = "board-world" as const;
/** The frame, stated from the model's own authorities (units.ts, geometry.ts, types.ts), never assumed. */
export const PLACEMENT_INTENT_FRAME_STATEMENT = "board-world frame: the board's integer-nanometre world frame (app/lib/pcb/units.ts: +x right, +y DOWN, the KiCad file convention), written here in millimetres (up to 6 decimals; 1 nm resolution); the origin is the world origin (0, 0) - a rectangular outline's own `origin` (board.outline.origin, usually (0, 0)) is NOT subtracted; a component's position is its footprint origin (FootprintInstance.at); rotation is in whole degrees, positive COUNTER-CLOCKWISE as seen on screen (app/lib/pcb/geometry.ts: (1, 0) rotated +90 lands at (0, -1), screen up), restricted to 0 | 90 | 180 | 270; side bottom mirrors the footprint across x (x -> -x) before the rotation (transformPoint)" as const;
/** Directive section 2: the qualified initial scope. */
export const PLACEMENT_SCOPE_LIMIT = 50;
export const PLACEMENT_SCOPE_COUNTING_RULE = "every footprint instance on the board is one physical package (connectors and repeated parts included; a multi-unit symbol is already ONE footprint after Schematic to PCB - the board model has no symbol-unit concept), de-duplicated by syncIdentity.componentInstanceId where present, else by footprint id; mechanical-only footprints count too; a low count never implies low electrical complexity" as const;
export const MAX_INTENT_LIST_ITEMS = 64;
export const MAX_INTENT_POLYGON_POINTS = 32;
export const MAX_INTENT_TEXT_CHARS = 200;
/** |coordinate| and distances are bounded to a board-sized range in millimetres (10 m) - a value outside is malformed, not legalized. */
export const MAX_INTENT_COORDINATE_MM = 10_000;
/** The conflict list is bounded per corridor so a corridor over the whole board cannot flood the candidate. */
const MAX_CORRIDOR_CONFLICTS = 16;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ROTATIONS: readonly IntentRotation[] = [0, 90, 180, 270];

export interface IntentComponentRef { ref: string; instanceId: string }
export interface IntentNetRef { name: string; id: number }
export type IntentSide = "top" | "bottom";
export type IntentRotation = 0 | 90 | 180 | 270;
export type IntentRegionSide = IntentSide | "both";
export type IntentNetPriority = 1 | 2 | 3;

/** The model's intent as the input schema admits it (millimetres, exact identities). */
export interface PlacementIntentInput {
  schema: typeof PLACEMENT_INTENT_SCHEMA;
  units: typeof PLACEMENT_INTENT_UNITS;
  frame: typeof PLACEMENT_INTENT_FRAME;
  regions?: Array<{ id: string; name?: string; polygonMm: Array<{ x: number; y: number }>; side?: IntentRegionSide }>;
  groups?: Array<{ id: string; name?: string; members: IntentComponentRef[]; regionId?: string }>;
  placements?: Array<{ component: IntentComponentRef; xMm: number; yMm: number; rotationDeg?: IntentRotation; side?: IntentSide }>;
  proximity?: Array<{ component: IntentComponentRef; pad?: string; near: IntentComponentRef; nearPad?: string; maxDistanceMm: number; reason?: string }>;
  separations?: Array<{ component: IntentComponentRef; from: IntentComponentRef; minDistanceMm: number; reason?: string }>;
  corridors?: Array<{ id: string; name?: string; polygonMm: Array<{ x: number; y: number }>; side?: IntentRegionSide; nets?: IntentNetRef[] }>;
  criticalNets?: Array<{ net: IntentNetRef; priority: IntentNetPriority; reason?: string }>;
}

/** The bound intent, in integer nanometres (the seed and the evaluation read this, never the raw input). */
export interface CompiledPlacementIntent {
  schema: typeof PLACEMENT_INTENT_SCHEMA;
  units: typeof PLACEMENT_INTENT_UNITS;
  frame: typeof PLACEMENT_INTENT_FRAME;
  frameStatement: typeof PLACEMENT_INTENT_FRAME_STATEMENT;
  components: IntentComponentRef[];
  nets: IntentNetRef[];
  regions: Array<{ id: string; name: string | null; polygon: Vec2[]; side: IntentRegionSide }>;
  groups: Array<{ id: string; name: string | null; members: IntentComponentRef[]; regionId: string | null }>;
  placements: Array<{ component: IntentComponentRef; position: Vec2; rotationDeg: IntentRotation | null; side: IntentSide | null }>;
  proximity: Array<{ component: IntentComponentRef; pad: string | null; near: IntentComponentRef; nearPad: string | null; maxDistanceNm: number; reason: string | null }>;
  separations: Array<{ component: IntentComponentRef; from: IntentComponentRef; minDistanceNm: number; reason: string | null }>;
  corridors: Array<{ id: string; name: string | null; polygon: Vec2[]; side: IntentRegionSide; nets: IntentNetRef[] }>;
  criticalNets: Array<{ net: IntentNetRef; priority: IntentNetPriority; reason: string | null }>;
  itemCount: number;
}

export type PlacementIntentBlockerCode = "intent-malformed" | "units-unsupported" | "frame-unsupported" | "empty-intent" | "too-many-items" | "unknown-component" | "identity-mismatch" | "unknown-net" | "unknown-pad" | "unknown-region" | "duplicate-id" | "polygon-malformed" | "value-out-of-range";
export interface PlacementIntentBlocker { code: PlacementIntentBlockerCode; detail: string }
export type PlacementIntentCompilation = { ok: true; intent: CompiledPlacementIntent; seed: PlacementIntentSeed } | { ok: false; blockers: PlacementIntentBlocker[] };

export type PlacementScopeClassification = "qualified" | "unsupported-scope";
export interface PlacementScope { physicalInstanceCount: number; limit: number; classification: PlacementScopeClassification; countingRule: typeof PLACEMENT_SCOPE_COUNTING_RULE }

export type PlacementIntentConflictKind = "locked" | "keepout" | "outside-board" | "legalized" | "orientation" | "region" | "proximity" | "separation" | "corridor" | "candidate-replaced" | "not-applied";
/** One conflict: the component (null for a whole-intent conflict), what the intent asked, what happened instead - both in millimetres. */
export interface PlacementIntentConflict { kind: PlacementIntentConflictKind; component: IntentComponentRef | null; intent: string; happened: string }
export interface PlacementIntentSatisfied { kind: "placement" | "group" | "proximity" | "separation" | "corridor"; component: IntentComponentRef | null; detail: string }

/** The intent block of the placement candidate (`PlacementLayoutCandidate.intent`): the bound intent's identities, the scope, the seed, the conflicts. */
export interface PlacementIntentOutcome {
  schema: typeof PLACEMENT_INTENT_SCHEMA;
  units: typeof PLACEMENT_INTENT_UNITS;
  frame: typeof PLACEMENT_INTENT_FRAME;
  frameStatement: typeof PLACEMENT_INTENT_FRAME_STATEMENT;
  scope: PlacementScope;
  /** false when the scope is unsupported: the intent was recorded and checked for identity, not seeded into the engine. */
  applied: boolean;
  itemCount: number;
  bindings: { components: IntentComponentRef[]; nets: IntentNetRef[] };
  seededInstanceIds: string[];
  selectedInitializer: PlacementCandidate["initializer"] | null;
  /** The intent-seeded candidate's fate (null when none ran): legal or not, with its hard violation codes. */
  seededCandidate: { candidateId: string; legal: boolean; selected: boolean; violationCodes: string[] } | null;
  conflicts: PlacementIntentConflict[];
  satisfied: PlacementIntentSatisfied[];
  /** DATA for the reviewer and the routing step: the placement engine takes no net-priority input and enforces none of these. */
  criticalNets: Array<{ net: IntentNetRef; priority: IntentNetPriority; reason: string | null; enforcement: "not-enforced-by-placement" }>;
}

// ── Scope ────────────────────────────────────────────────────────────────────

/** Directive section 2: physical instances = footprint instances, de-duplicated by the sync identity (a multi-unit symbol is one footprint). */
export function countPhysicalInstances(board: Pick<PcbBoard, "footprints">): number {
  return new Set(board.footprints.map((footprint) => footprint.syncIdentity?.componentInstanceId ?? footprint.id)).size;
}

export function classifyPlacementScope(board: Pick<PcbBoard, "footprints">, limit = PLACEMENT_SCOPE_LIMIT): PlacementScope {
  const physicalInstanceCount = countPhysicalInstances(board);
  return { physicalInstanceCount, limit, classification: physicalInstanceCount > limit ? "unsupported-scope" : "qualified", countingRule: PLACEMENT_SCOPE_COUNTING_RULE };
}

// ── Compile (validate, bind, seed) ───────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const mm = (nm: number): string => (nm / 1_000_000).toFixed(3);
const point = (position: Vec2): string => `(${mm(position.x)}, ${mm(position.y)}) mm`;
const compareRefs = (left: IntentComponentRef, right: IntentComponentRef): number => left.instanceId.localeCompare(right.instanceId) || left.ref.localeCompare(right.ref);

class IntentCompiler {
  readonly blockers: PlacementIntentBlocker[] = [];
  private readonly componentsById = new Map<string, IntentComponentRef>();
  private readonly netsById = new Map<number, IntentNetRef>();
  constructor(private readonly board: PcbBoard) {}

  block(code: PlacementIntentBlockerCode, detail: string): void {
    if (this.blockers.length < 32) this.blockers.push({ code, detail: detail.slice(0, 300) });
  }

  text(value: unknown, where: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_INTENT_TEXT_CHARS) { this.block("intent-malformed", `${where}: must be a string of 1 to ${MAX_INTENT_TEXT_CHARS} characters.`); return null; }
    return value;
  }

  id(value: unknown, where: string, seen: Set<string>): string | null {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) { this.block("intent-malformed", `${where}: id must match ${String(ID_PATTERN)}.`); return null; }
    if (seen.has(value)) { this.block("duplicate-id", `${where}: id "${value}" is used twice.`); return null; }
    seen.add(value);
    return value;
  }

  list(value: unknown, where: string): unknown[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) { this.block("intent-malformed", `${where}: must be a list.`); return []; }
    if (value.length > MAX_INTENT_LIST_ITEMS) { this.block("too-many-items", `${where}: at most ${MAX_INTENT_LIST_ITEMS} items.`); return []; }
    return value;
  }

  mmValue(value: unknown, where: string, positive: boolean): number | null {
    if (!finite(value) || Math.abs(value) > MAX_INTENT_COORDINATE_MM || (positive && value <= 0)) { this.block("value-out-of-range", `${where}: must be a finite number in millimetres${positive ? " above 0" : ""} within ${MAX_INTENT_COORDINATE_MM} mm.`); return null; }
    return mmToNm(value);
  }

  /** Both `ref` and `instanceId` must name the SAME footprint of this revision (a display name is never identity on its own). */
  component(value: unknown, where: string): IntentComponentRef | null {
    if (!isRecord(value) || typeof value.ref !== "string" || typeof value.instanceId !== "string" || value.ref.length === 0 || value.ref.length > MAX_INTENT_TEXT_CHARS || value.instanceId.length === 0 || value.instanceId.length > MAX_INTENT_TEXT_CHARS) { this.block("intent-malformed", `${where}: a component is { ref, instanceId } (both strings).`); return null; }
    const footprint = this.board.footprints.find((candidate) => candidate.id === value.instanceId);
    if (!footprint) { this.block("unknown-component", `${where}: no footprint instance "${value.instanceId.slice(0, 80)}" is on this board revision.`); return null; }
    if (footprint.ref !== value.ref) { this.block("identity-mismatch", `${where}: instance "${value.instanceId.slice(0, 80)}" is ${footprint.ref} on this board, not "${value.ref.slice(0, 40)}".`); return null; }
    const bound = { ref: footprint.ref, instanceId: footprint.id };
    this.componentsById.set(bound.instanceId, bound);
    return bound;
  }

  pad(component: IntentComponentRef | null, value: unknown, where: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || value.length === 0 || value.length > 16) { this.block("intent-malformed", `${where}: a pad number is a string of 1 to 16 characters.`); return null; }
    if (component && !this.board.footprints.find((candidate) => candidate.id === component.instanceId)?.def.pads.some((pad) => pad.number === value && pad.type !== "np_thru_hole")) { this.block("unknown-pad", `${where}: ${component.ref} has no pad "${value}".`); return null; }
    return value;
  }

  net(value: unknown, where: string): IntentNetRef | null {
    if (!isRecord(value) || typeof value.name !== "string" || !Number.isInteger(value.id) || value.name.length > MAX_INTENT_TEXT_CHARS) { this.block("intent-malformed", `${where}: a net is { name, id } (a string and an integer).`); return null; }
    const net = this.board.nets.find((candidate) => candidate.id === value.id && candidate.id !== 0);
    if (!net || net.name !== value.name) { this.block("unknown-net", `${where}: no net with id ${String(value.id).slice(0, 12)} named "${value.name.slice(0, 40)}" is on this board revision${net ? ` (id ${net.id} is "${net.name}")` : ""}.`); return null; }
    const bound = { name: net.name, id: net.id };
    this.netsById.set(bound.id, bound);
    return bound;
  }

  polygon(value: unknown, where: string): Vec2[] | null {
    if (!Array.isArray(value) || value.length < 3 || value.length > MAX_INTENT_POLYGON_POINTS) { this.block("polygon-malformed", `${where}: polygonMm needs 3 to ${MAX_INTENT_POLYGON_POINTS} points.`); return null; }
    const points: Vec2[] = [];
    for (const [index, raw] of value.entries()) {
      if (!isRecord(raw)) { this.block("polygon-malformed", `${where}: point ${index} is not { x, y }.`); return null; }
      const x = this.mmValue(raw.x, `${where}[${index}].x`, false);
      const y = this.mmValue(raw.y, `${where}[${index}].y`, false);
      if (x === null || y === null) return null;
      points.push({ x, y });
    }
    const area = points.reduce((sum, current, index) => { const next = points[(index + 1) % points.length]!; return sum + current.x * next.y - next.x * current.y; }, 0) / 2;
    if (Math.abs(area) < 1) { this.block("polygon-malformed", `${where}: the polygon has no area.`); return null; }
    return points;
  }

  side(value: unknown, where: string, allowBoth: boolean): IntentRegionSide | null {
    if (value === undefined || value === null) return null;
    if (value === "top" || value === "bottom" || (allowBoth && value === "both")) return value;
    this.block("intent-malformed", `${where}: side must be top or bottom${allowBoth ? " or both" : ""}.`);
    return null;
  }

  rotation(value: unknown, where: string): IntentRotation | null {
    if (value === undefined || value === null) return null;
    if (typeof value === "number" && (ROTATIONS as readonly number[]).includes(value)) return value as IntentRotation;
    this.block("value-out-of-range", `${where}: rotationDeg must be 0, 90, 180 or 270 (whole degrees, counter-clockwise as seen on screen).`);
    return null;
  }

  components(): IntentComponentRef[] { return [...this.componentsById.values()].sort(compareRefs); }
  nets(): IntentNetRef[] { return [...this.netsById.values()].sort((left, right) => left.id - right.id); }
}

/** Validate and bind the whole intent (all-or-nothing) and derive the engine seed. */
export function compilePlacementIntent(board: PcbBoard, input: unknown): PlacementIntentCompilation {
  const compiler = new IntentCompiler(board);
  if (!isRecord(input)) return { ok: false, blockers: [{ code: "intent-malformed", detail: "intent must be an object." }] };
  if (input.schema !== PLACEMENT_INTENT_SCHEMA) compiler.block("intent-malformed", `intent.schema must be "${PLACEMENT_INTENT_SCHEMA}".`);
  if (input.units !== PLACEMENT_INTENT_UNITS) compiler.block("units-unsupported", `intent.units must be "${PLACEMENT_INTENT_UNITS}" (millimetres in the board-world frame); no other unit is accepted.`);
  if (input.frame !== PLACEMENT_INTENT_FRAME) compiler.block("frame-unsupported", `intent.frame must be "${PLACEMENT_INTENT_FRAME}": ${PLACEMENT_INTENT_FRAME_STATEMENT}`);
  const known = new Set(["schema", "units", "frame", "regions", "groups", "placements", "proximity", "separations", "corridors", "criticalNets"]);
  for (const key of Object.keys(input)) if (!known.has(key)) compiler.block("intent-malformed", `intent.${key.slice(0, 40)}: unknown key.`);

  const regionIds = new Set<string>();
  const regions: CompiledPlacementIntent["regions"] = [];
  for (const [index, raw] of compiler.list(input.regions, "intent.regions").entries()) {
    const where = `intent.regions[${index}]`;
    if (!isRecord(raw)) { compiler.block("intent-malformed", `${where}: not an object.`); continue; }
    const id = compiler.id(raw.id, where, regionIds);
    const polygon = compiler.polygon(raw.polygonMm, where);
    const side = compiler.side(raw.side, where, true) ?? "both";
    const name = compiler.text(raw.name, `${where}.name`);
    if (id && polygon) regions.push({ id, name, polygon, side });
  }
  const groupIds = new Set<string>();
  const groups: CompiledPlacementIntent["groups"] = [];
  for (const [index, raw] of compiler.list(input.groups, "intent.groups").entries()) {
    const where = `intent.groups[${index}]`;
    if (!isRecord(raw)) { compiler.block("intent-malformed", `${where}: not an object.`); continue; }
    const id = compiler.id(raw.id, where, groupIds);
    const members = compiler.list(raw.members, `${where}.members`).map((member, memberIndex) => compiler.component(member, `${where}.members[${memberIndex}]`)).filter((member): member is IntentComponentRef => member !== null);
    if (members.length === 0) compiler.block("intent-malformed", `${where}: a group needs at least one member.`);
    let regionId: string | null = null;
    if (raw.regionId !== undefined && raw.regionId !== null) {
      if (typeof raw.regionId !== "string" || !regionIds.has(raw.regionId)) compiler.block("unknown-region", `${where}: regionId names no region of this intent.`);
      else regionId = raw.regionId;
    }
    if (id) groups.push({ id, name: compiler.text(raw.name, `${where}.name`), members: [...members].sort(compareRefs), regionId });
  }
  const placedIds = new Set<string>();
  const placements: CompiledPlacementIntent["placements"] = [];
  for (const [index, raw] of compiler.list(input.placements, "intent.placements").entries()) {
    const where = `intent.placements[${index}]`;
    if (!isRecord(raw)) { compiler.block("intent-malformed", `${where}: not an object.`); continue; }
    const component = compiler.component(raw.component, `${where}.component`);
    const x = compiler.mmValue(raw.xMm, `${where}.xMm`, false);
    const y = compiler.mmValue(raw.yMm, `${where}.yMm`, false);
    const rotationDeg = compiler.rotation(raw.rotationDeg, `${where}.rotationDeg`);
    const side = compiler.side(raw.side, `${where}.side`, false) as IntentSide | null;
    if (component && placedIds.has(component.instanceId)) compiler.block("duplicate-id", `${where}: ${component.ref} is placed twice.`);
    if (component && x !== null && y !== null) { placedIds.add(component.instanceId); placements.push({ component, position: { x, y }, rotationDeg, side }); }
  }
  const proximity: CompiledPlacementIntent["proximity"] = [];
  for (const [index, raw] of compiler.list(input.proximity, "intent.proximity").entries()) {
    const where = `intent.proximity[${index}]`;
    if (!isRecord(raw)) { compiler.block("intent-malformed", `${where}: not an object.`); continue; }
    const component = compiler.component(raw.component, `${where}.component`);
    const near = compiler.component(raw.near, `${where}.near`);
    const pad = compiler.pad(component, raw.pad, `${where}.pad`);
    const nearPad = compiler.pad(near, raw.nearPad, `${where}.nearPad`);
    const maxDistanceNm = compiler.mmValue(raw.maxDistanceMm, `${where}.maxDistanceMm`, true);
    if (component && near && component.instanceId === near.instanceId) compiler.block("intent-malformed", `${where}: a component cannot be near itself.`);
    if (component && near && maxDistanceNm !== null) proximity.push({ component, pad, near, nearPad, maxDistanceNm, reason: compiler.text(raw.reason, `${where}.reason`) });
  }
  const separations: CompiledPlacementIntent["separations"] = [];
  for (const [index, raw] of compiler.list(input.separations, "intent.separations").entries()) {
    const where = `intent.separations[${index}]`;
    if (!isRecord(raw)) { compiler.block("intent-malformed", `${where}: not an object.`); continue; }
    const component = compiler.component(raw.component, `${where}.component`);
    const from = compiler.component(raw.from, `${where}.from`);
    const minDistanceNm = compiler.mmValue(raw.minDistanceMm, `${where}.minDistanceMm`, true);
    if (component && from && component.instanceId === from.instanceId) compiler.block("intent-malformed", `${where}: a component cannot be separated from itself.`);
    if (component && from && minDistanceNm !== null) separations.push({ component, from, minDistanceNm, reason: compiler.text(raw.reason, `${where}.reason`) });
  }
  const corridorIds = new Set<string>();
  const corridors: CompiledPlacementIntent["corridors"] = [];
  for (const [index, raw] of compiler.list(input.corridors, "intent.corridors").entries()) {
    const where = `intent.corridors[${index}]`;
    if (!isRecord(raw)) { compiler.block("intent-malformed", `${where}: not an object.`); continue; }
    const id = compiler.id(raw.id, where, corridorIds);
    const polygon = compiler.polygon(raw.polygonMm, where);
    const side = compiler.side(raw.side, where, true) ?? "both";
    const nets = compiler.list(raw.nets, `${where}.nets`).map((net, netIndex) => compiler.net(net, `${where}.nets[${netIndex}]`)).filter((net): net is IntentNetRef => net !== null).sort((left, right) => left.id - right.id);
    if (id && polygon) corridors.push({ id, name: compiler.text(raw.name, `${where}.name`), polygon, side, nets });
  }
  const criticalNetIds = new Set<number>();
  const criticalNets: CompiledPlacementIntent["criticalNets"] = [];
  for (const [index, raw] of compiler.list(input.criticalNets, "intent.criticalNets").entries()) {
    const where = `intent.criticalNets[${index}]`;
    if (!isRecord(raw)) { compiler.block("intent-malformed", `${where}: not an object.`); continue; }
    const net = compiler.net(raw.net, `${where}.net`);
    const priority = raw.priority;
    if (priority !== 1 && priority !== 2 && priority !== 3) compiler.block("value-out-of-range", `${where}.priority: must be 1, 2 or 3 (1 is the most critical).`);
    if (net && criticalNetIds.has(net.id)) compiler.block("duplicate-id", `${where}: net ${net.name} is listed twice.`);
    if (net && (priority === 1 || priority === 2 || priority === 3)) { criticalNetIds.add(net.id); criticalNets.push({ net, priority, reason: compiler.text(raw.reason, `${where}.reason`) }); }
  }
  const itemCount = regions.length + groups.length + placements.length + proximity.length + separations.length + corridors.length + criticalNets.length;
  if (compiler.blockers.length === 0 && itemCount === 0) compiler.block("empty-intent", "the intent carries no item (regions, groups, placements, proximity, separations, corridors or criticalNets).");
  if (compiler.blockers.length > 0) return { ok: false, blockers: compiler.blockers };

  // ── The seed: explicit coordinates first; a grouped member without coordinates starts at its region's centroid; a proximity
  //    item without coordinates starts beside its reference (the legalizer resolves the overlap). Deterministic order throughout.
  const seedPlacements: Record<string, Partial<PlacementTransform>> = {};
  const pinned = new Set<string>();
  for (const item of [...placements].sort((left, right) => compareRefs(left.component, right.component))) {
    seedPlacements[item.component.instanceId] = { position: { ...item.position }, ...(item.rotationDeg !== null ? { rotationDeg: item.rotationDeg } : {}), ...(item.side !== null ? { side: item.side } : {}) };
    if (item.rotationDeg !== null || item.side !== null) pinned.add(item.component.instanceId);
  }
  const centroid = (polygon: Vec2[]): Vec2 => ({ x: Math.round(polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length), y: Math.round(polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length) });
  for (const group of [...groups].sort((left, right) => left.id.localeCompare(right.id))) {
    const region = group.regionId ? regions.find((candidate) => candidate.id === group.regionId) : undefined;
    if (!region) continue;
    for (const member of group.members) {
      if (seedPlacements[member.instanceId]) continue;
      seedPlacements[member.instanceId] = { position: centroid(region.polygon), ...(region.side !== "both" ? { side: region.side } : {}) };
      if (region.side !== "both") pinned.add(member.instanceId);
    }
  }
  const positionOf = (component: IntentComponentRef): Vec2 | null => seedPlacements[component.instanceId]?.position ?? board.footprints.find((candidate) => candidate.id === component.instanceId)?.at ?? null;
  for (const item of [...proximity].sort((left, right) => compareRefs(left.component, right.component) || compareRefs(left.near, right.near))) {
    if (seedPlacements[item.component.instanceId]) continue;
    const anchor = positionOf(item.near);
    if (!anchor) continue;
    seedPlacements[item.component.instanceId] = { position: { x: Math.round(anchor.x + item.maxDistanceNm / 2), y: anchor.y } };
  }
  const intent: CompiledPlacementIntent = {
    schema: PLACEMENT_INTENT_SCHEMA, units: PLACEMENT_INTENT_UNITS, frame: PLACEMENT_INTENT_FRAME, frameStatement: PLACEMENT_INTENT_FRAME_STATEMENT,
    components: compiler.components(), nets: compiler.nets(),
    regions: [...regions].sort((left, right) => left.id.localeCompare(right.id)),
    groups: [...groups].sort((left, right) => left.id.localeCompare(right.id)),
    placements: [...placements].sort((left, right) => compareRefs(left.component, right.component)),
    proximity: [...proximity].sort((left, right) => compareRefs(left.component, right.component) || compareRefs(left.near, right.near)),
    separations: [...separations].sort((left, right) => compareRefs(left.component, right.component) || compareRefs(left.from, right.from)),
    corridors: [...corridors].sort((left, right) => left.id.localeCompare(right.id)),
    criticalNets: [...criticalNets].sort((left, right) => left.net.id - right.net.id),
    itemCount,
  };
  return { ok: true, intent, seed: { placements: seedPlacements, orientationPinnedIds: [...pinned].sort(), preferSeeded: true } };
}

// ── Evaluate (the conflict list) ─────────────────────────────────────────────

const sideMatches = (side: IntentRegionSide, actual: IntentSide): boolean => side === "both" || side === actual;
const envelopeGapNm = (a: BBox, b: BBox): number => Math.hypot(Math.max(0, b.minX - a.maxX, a.minX - b.maxX), Math.max(0, b.minY - a.maxY, a.minY - b.maxY));

/** The intent block for an UNSUPPORTED scope: identities bound, nothing seeded, the classification said in words. */
export function unappliedPlacementIntent(intent: CompiledPlacementIntent, scope: PlacementScope, run: PlacementRunResult | null): PlacementIntentOutcome {
  const selected = run?.candidates.find((candidate) => candidate.candidateId === run.selectedCandidateId) ?? null;
  return {
    schema: intent.schema, units: intent.units, frame: intent.frame, frameStatement: intent.frameStatement, scope, applied: false, itemCount: intent.itemCount,
    bindings: { components: intent.components, nets: intent.nets }, seededInstanceIds: [], selectedInitializer: selected?.initializer ?? null, seededCandidate: null,
    conflicts: [{ kind: "not-applied", component: null, intent: `${intent.itemCount} intent item(s) over ${intent.components.length} component(s)`, happened: `the board holds ${scope.physicalInstanceCount} physical component instances, above the qualified limit of ${scope.limit}: classified ${scope.classification}; the intent was bound and recorded but NOT seeded into the engine, and the candidate is the engine's own run without it` }],
    satisfied: [],
    criticalNets: intent.criticalNets.map((item) => ({ ...item, enforcement: "not-enforced-by-placement" as const })),
  };
}

/** Compare the SELECTED candidate with the intent: every item is satisfied or a conflict, never dropped. */
export function evaluatePlacementIntent(input: { problem: PlacementProblem; run: PlacementRunResult; intent: CompiledPlacementIntent; seed: PlacementIntentSeed; scope: PlacementScope; gridNm?: number }): PlacementIntentOutcome {
  const { problem, run, intent, seed, scope } = input;
  const gridNm = Math.max(10_000, Math.round(input.gridNm ?? 100_000));
  const selected = run.candidates.find((candidate) => candidate.candidateId === run.selectedCandidateId) ?? null;
  const seededRun = run.candidates.find((candidate) => candidate.initializer === "intent_seed") ?? null;
  const conflicts: PlacementIntentConflict[] = [];
  const satisfied: PlacementIntentSatisfied[] = [];
  const base: Omit<PlacementIntentOutcome, "conflicts" | "satisfied"> = {
    schema: intent.schema, units: intent.units, frame: intent.frame, frameStatement: intent.frameStatement, scope, applied: true, itemCount: intent.itemCount,
    bindings: { components: intent.components, nets: intent.nets },
    // what the ENGINE seeded: the seed's movable instances (a fixed instance named by the intent is reported as a `locked` conflict below)
    seededInstanceIds: Object.keys(seed.placements).filter((id) => problem.instances.find((instance) => instance.id === id)?.movable === true).sort(),
    selectedInitializer: selected?.initializer ?? null,
    seededCandidate: seededRun ? { candidateId: seededRun.candidateId, legal: seededRun.hardReport.legal, selected: seededRun.candidateId === selected?.candidateId, violationCodes: [...new Set(seededRun.hardReport.violations.map((violation) => violation.code))].sort() } : null,
    criticalNets: intent.criticalNets.map((item) => ({ ...item, enforcement: "not-enforced-by-placement" as const })),
  };
  if (!selected) {
    conflicts.push({ kind: "candidate-replaced", component: null, intent: `${intent.itemCount} intent item(s)`, happened: `the engine produced no hard-legal candidate (termination ${run.termination})${seededRun ? `; the intent-seeded candidate's violations: ${base.seededCandidate!.violationCodes.join(", ") || "none"}` : ""}` });
    return { ...base, conflicts, satisfied };
  }
  if (seededRun && selected.candidateId !== seededRun.candidateId) {
    conflicts.push({ kind: "candidate-replaced", component: null, intent: "the intent-seeded candidate", happened: `it was ${seededRun.hardReport.legal ? "hard-legal but not selected" : `NOT hard-legal (${base.seededCandidate!.violationCodes.join(", ") || "no code"})`}; the engine selected its ${selected.initializer} candidate instead, and the items below are checked against that candidate` });
  }
  const placements = selected.placements;
  const instanceOf = (component: IntentComponentRef) => problem.instances.find((instance) => instance.id === component.instanceId) ?? null;
  const finalEnvelope = (component: IntentComponentRef): BBox | null => {
    const instance = instanceOf(component); const placement = placements[component.instanceId];
    return instance && placement ? worldCourtyardBBox(instance.envelopeLocal, placement.position, placement.rotationDeg, placement.side === "bottom") : null;
  };
  const fixedObstacles = problem.instances.filter((instance) => !instance.movable).map((instance) => ({ instance, envelope: worldCourtyardBBox(instance.envelopeLocal, instance.sourcePosition, instance.sourceRotationDeg, instance.sourceSide === "bottom") }));
  const describeTransform = (position: Vec2, rotationDeg: number | null, side: IntentSide | null): string => `${point(position)}${rotationDeg !== null ? `, ${rotationDeg} deg` : ""}${side ? `, ${side}` : ""}`;

  // Explicit placements.
  for (const item of intent.placements) {
    const instance = instanceOf(item.component); const final = placements[item.component.instanceId];
    const asked = describeTransform(item.position, item.rotationDeg, item.side);
    if (!instance || !final) { conflicts.push({ kind: "legalized", component: item.component, intent: asked, happened: "the candidate carries no transform for this instance" }); continue; }
    if (!instance.movable) {
      conflicts.push({ kind: "locked", component: item.component, intent: asked, happened: `kept at ${describeTransform(instance.sourcePosition, instance.sourceRotationDeg, instance.sourceSide)}: the instance is fixed (${instance.fixedReasons.join(", ")}); the lock is preserved and the engine never moved it` });
      continue;
    }
    const rotation = item.rotationDeg ?? final.rotationDeg; const side = item.side ?? final.side;
    const requestedEnvelope = worldCourtyardBBox(instance.envelopeLocal, item.position, rotation, side === "bottom");
    const where = `it ended at ${describeTransform(final.position, final.rotationDeg, final.side)}`;
    let specific = false;
    if (item.rotationDeg !== null && !instance.allowedRotations.includes(item.rotationDeg)) { conflicts.push({ kind: "orientation", component: item.component, intent: asked, happened: `rotation ${item.rotationDeg} deg is outside the allowed set [${instance.allowedRotations.join(", ")}]; ${where}` }); specific = true; }
    else if (item.rotationDeg !== null && final.rotationDeg !== item.rotationDeg) { conflicts.push({ kind: "orientation", component: item.component, intent: asked, happened: `the rotation was not kept; ${where}` }); specific = true; }
    if (item.side !== null && !instance.allowedSides.includes(item.side)) { conflicts.push({ kind: "orientation", component: item.component, intent: asked, happened: `side ${item.side} is outside the allowed set [${instance.allowedSides.join(", ")}]; ${where}` }); specific = true; }
    else if (item.side !== null && final.side !== item.side) { conflicts.push({ kind: "orientation", component: item.component, intent: asked, happened: `the side was not kept; ${where}` }); specific = true; }
    if (!courtyardFitsOutline(requestedEnvelope, problem.board.outline)) { conflicts.push({ kind: "outside-board", component: item.component, intent: asked, happened: `the placement envelope would leave the board outline; ${where}` }); specific = true; }
    else {
      const obstacle = fixedObstacles.find((candidate) => candidate.instance.id !== instance.id && bboxesOverlap(requestedEnvelope, candidate.envelope));
      if (obstacle) { conflicts.push({ kind: "keepout", component: item.component, intent: asked, happened: `the envelope overlaps the fixed instance ${obstacle.instance.id} (${obstacle.instance.fixedReasons.join(", ")}), which is preserved; ${where}` }); specific = true; }
      for (const regionId of instance.forbiddenRegionIds) {
        const region = problem.regions.find((candidate) => candidate.id === regionId);
        if (region && bboxIntersectsPolygon(requestedEnvelope, region.polygon)) { conflicts.push({ kind: "keepout", component: item.component, intent: asked, happened: `the envelope enters the constraint keepout region ${regionId}; ${where}` }); specific = true; }
      }
      for (const corridor of intent.corridors) if (sideMatches(corridor.side, side) && bboxIntersectsPolygon(requestedEnvelope, corridor.polygon)) { conflicts.push({ kind: "keepout", component: item.component, intent: asked, happened: `the envelope enters the intent's own corridor ${corridor.id}; ${where}` }); specific = true; }
    }
    const dx = final.position.x - item.position.x; const dy = final.position.y - item.position.y;
    const moved = Math.abs(dx) > gridNm / 2 || Math.abs(dy) > gridNm / 2;
    if (moved && !specific) conflicts.push({ kind: "legalized", component: item.component, intent: asked, happened: `exact legalization (grid snap, outline clip, collision nudge, hard anchors) moved it by ${mm(Math.hypot(dx, dy))} mm; ${where}` });
    if (!moved && !specific) satisfied.push({ kind: "placement", component: item.component, detail: `placed at ${describeTransform(final.position, final.rotationDeg, final.side)} (within the ${mm(gridNm)} mm grid snap of the request)` });
  }
  // Groups and their regions.
  for (const group of intent.groups) {
    const region = group.regionId ? intent.regions.find((candidate) => candidate.id === group.regionId) : undefined;
    if (!region) { satisfied.push({ kind: "group", component: null, detail: `group ${group.id} (${group.members.map((member) => member.ref).join(", ")}) recorded; it names no region, so there is nothing to check` }); continue; }
    let outside = 0;
    for (const member of group.members) {
      const envelope = finalEnvelope(member); const final = placements[member.instanceId];
      if (!envelope || !final) continue;
      if (!bboxFitsPolygon(envelope, region.polygon) || !sideMatches(region.side, final.side)) { outside += 1; conflicts.push({ kind: "region", component: member, intent: `inside region ${region.id}${region.side !== "both" ? ` (${region.side})` : ""} as a member of group ${group.id}`, happened: `its envelope is not fully inside the region${!sideMatches(region.side, final.side) ? ` (side ${final.side})` : ""}; it ended at ${point(final.position)}${instanceOf(member)?.movable === false ? " (a fixed instance the engine never moves)" : ""}` }); }
    }
    if (outside === 0) satisfied.push({ kind: "group", component: null, detail: `group ${group.id}: every member (${group.members.map((member) => member.ref).join(", ")}) is inside region ${region.id}` });
  }
  // Pin-specific proximity and separation, measured on the candidate's board.
  const candidateBoard = boardWithPlacement(problem, placements);
  const anchor = (component: IntentComponentRef, pad: string | null): Vec2 | null => {
    const footprint = candidateBoard.footprints.find((candidate) => candidate.id === component.instanceId);
    if (!footprint) return null;
    if (pad === null) return footprint.at;
    const padDef = footprint.def.pads.find((candidate) => candidate.number === pad);
    return padDef ? padWorldPosition(footprint, padDef) : null;
  };
  for (const item of intent.proximity) {
    const from = anchor(item.component, item.pad); const to = anchor(item.near, item.nearPad);
    const asked = `${item.component.ref}${item.pad ? ` pad ${item.pad}` : ""} within ${mm(item.maxDistanceNm)} mm of ${item.near.ref}${item.nearPad ? ` pad ${item.nearPad}` : ""}${item.reason ? ` (${item.reason})` : ""}`;
    if (!from || !to) { conflicts.push({ kind: "proximity", component: item.component, intent: asked, happened: "a named pad or instance is missing from the candidate" }); continue; }
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance > item.maxDistanceNm) conflicts.push({ kind: "proximity", component: item.component, intent: asked, happened: `measured ${mm(distance)} mm${instanceOf(item.component)?.movable === false || instanceOf(item.near)?.movable === false ? " (a fixed instance is involved)" : ""}` });
    else satisfied.push({ kind: "proximity", component: item.component, detail: `${asked}: measured ${mm(distance)} mm` });
  }
  for (const item of intent.separations) {
    const a = finalEnvelope(item.component); const b = finalEnvelope(item.from);
    const asked = `${item.component.ref} at least ${mm(item.minDistanceNm)} mm from ${item.from.ref}${item.reason ? ` (${item.reason})` : ""}`;
    if (!a || !b) { conflicts.push({ kind: "separation", component: item.component, intent: asked, happened: "an instance is missing from the candidate" }); continue; }
    const gap = envelopeGapNm(a, b);
    if (gap < item.minDistanceNm) conflicts.push({ kind: "separation", component: item.component, intent: asked, happened: `the placement envelopes are ${mm(gap)} mm apart` });
    else satisfied.push({ kind: "separation", component: item.component, detail: `${asked}: envelopes ${mm(gap)} mm apart` });
  }
  // Corridors: every instance of the board is checked, not only the intent's.
  for (const corridor of intent.corridors) {
    let entered = 0;
    for (const instance of problem.instances) {
      const final = placements[instance.id];
      if (!final || !sideMatches(corridor.side, final.side)) continue;
      if (bboxIntersectsPolygon(worldCourtyardBBox(instance.envelopeLocal, final.position, final.rotationDeg, final.side === "bottom"), corridor.polygon)) {
        entered += 1;
        if (entered <= MAX_CORRIDOR_CONFLICTS) conflicts.push({ kind: "corridor", component: { ref: problem.board.footprints.find((footprint) => footprint.id === instance.id)?.ref ?? instance.id, instanceId: instance.id }, intent: `corridor ${corridor.id}${corridor.nets.length > 0 ? ` for ${corridor.nets.map((net) => net.name).join(", ")}` : ""} kept free of components`, happened: `its envelope enters the corridor at ${point(final.position)}${instance.movable ? "" : " (a fixed instance the engine never moves)"}` });
      }
    }
    if (entered > MAX_CORRIDOR_CONFLICTS) conflicts.push({ kind: "corridor", component: null, intent: `corridor ${corridor.id}`, happened: `${entered - MAX_CORRIDOR_CONFLICTS} further instance(s) enter it (not listed)` });
    if (entered === 0) satisfied.push({ kind: "corridor", component: null, detail: `corridor ${corridor.id}: no component envelope enters it` });
  }
  return { ...base, conflicts, satisfied };
}
