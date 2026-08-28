/**
 * B15 §A — the BOUNDED PCB edit operation contract.
 *
 * The provider's input is SEMANTIC and BOUNDED. It never contains a board, a
 * candidate board, a raw canonical command, an arbitrary command id, a
 * mutation receipt, an approval credential, or an authoritative id for a NEW
 * board object — Sirkit mints those deterministically from the sealed base
 * identity plus the operation index.
 *
 * Validation is TOTAL and fail-closed: NO input — including proxies whose
 * reflection traps throw — can escape as an exception. [B15.1 §A] every
 * reflection, cloning, and serialization boundary is wrapped and yields a
 * bounded refusal instead. Strict object shapes, unknown-field refusal, an
 * operation-count ceiling, depth/array/string/identifier/coordinate bounds,
 * finite integer nanometre coordinates, and refusal of functions,
 * accessors, symbols, exotic prototypes, and prototype-pollution keys.
 *
 * The byte ceiling is measured EXACTLY: the accepted payload is normalized
 * and serialized, and its real UTF-8 length is measured with `TextEncoder`
 * — structural punctuation, quoting, escaping, and multibyte characters all
 * count. (The previous approximate budget undercounted a 40,649-byte
 * payload as under 32,768.)
 *
 * The payload is deep-cloned through a JSON-primitive round trip and frozen
 * BEFORE validation or compilation, so no accessor or prototype trick can
 * observe or alter the validated value afterwards, and the caller's value is
 * never mutated.
 *
 * The nine allowed operation kinds are exactly those the existing canonical
 * B08 delta compiler can express (`move_footprint`, `add_track`,
 * `update_track`, `add_via`, `update_via`, `update_routing_preferences`,
 * `update_net_classing`, `add|update|remove_dimension`,
 * `add|update_keepout`). Anything else — deletion of copper/footprints/
 * zones/padstacks, rip-up, net reassignment, zone or fill edits, outline or
 * stackup edits, protection changes, replacement, sync/binding/authority,
 * auto-place/route/repair apply, release, or view controls — is REFUSED
 * here rather than improvised.
 */

export const BOUNDED_PCB_EDIT_SCHEMA = "sirkit.pcb-bounded-edit-request.v1" as const;

/** Hard ceilings. Every one is enforced before any board is touched. */
export const BOUNDED_EDIT_LIMITS = {
  maxOperations: 16,
  maxRequestBytes: 32_768,
  maxDepth: 8,
  maxArrayLength: 64,
  maxStringLength: 256,
  maxIdentifierLength: 128,
  /** Board coordinates: ±10 m in integer nanometres. */
  maxCoordinateNm: 10_000_000_000,
  /** Geometry magnitudes (widths, drills, offsets, text heights). */
  minSizeNm: 1_000,
  maxSizeNm: 100_000_000,
  maxNetId: 1_000_000,
  /** Kept BELOW maxStringLength so the specific intent refusal fires first. */
  maxIntentLength: 240,
} as const;

export type BoundedPcbEditOperation =
  | { kind: "move_footprint"; footprintId: string; to: { x: number; y: number } }
  | { kind: "rotate_footprint"; footprintId: string; rotationDeg: number }
  | { kind: "add_track"; layer: string; netId: number; widthNm: number; start: { x: number; y: number }; end: { x: number; y: number } }
  | { kind: "update_track"; trackId: string; start?: { x: number; y: number }; end?: { x: number; y: number }; widthNm?: number }
  | { kind: "add_via"; at: { x: number; y: number }; netId: number; sizeNm: number; drillNm: number; layers: [string, string]; padstackId?: string }
  | { kind: "update_via"; viaId: string; at?: { x: number; y: number }; sizeNm?: number; drillNm?: number; padstackId?: string }
  | { kind: "set_routing_preference"; customTrackWidthNm?: number; routeMode?: "highlight_stop" | "walk_around" | "shove"; posture?: "orthogonal" | "octilinear_a" | "octilinear_b" | "arbitrary"; viaPadstackId?: string }
  | { kind: "set_net_class_rule"; netIds: number[]; trackWidthNm?: number; clearanceNm?: number; viaSizeNm?: number; viaDrillNm?: number }
  | { kind: "add_dimension"; dimensionKind: "aligned" | "horizontal" | "vertical"; a: { x: number; y: number }; b: { x: number; y: number }; offsetNm: number; layer: string; unit: "mm" | "in"; precision: 0 | 1 | 2 | 3 | 4; textHeightNm: number; strokeWidthNm: number }
  | { kind: "update_dimension"; dimensionId: string; a?: { x: number; y: number }; b?: { x: number; y: number }; offsetNm?: number; precision?: 0 | 1 | 2 | 3 | 4 }
  | { kind: "remove_dimension"; dimensionId: string }
  | { kind: "add_keepout"; name?: string; polygon: Array<{ x: number; y: number }>; layers: string[]; forbidTracks: boolean; forbidVias: boolean }
  | { kind: "update_keepout"; keepoutId: string; name?: string; polygon?: Array<{ x: number; y: number }>; layers?: string[]; forbidTracks?: boolean; forbidVias?: boolean };

export type BoundedPcbEditOperationKind = BoundedPcbEditOperation["kind"];

export const BOUNDED_EDIT_OPERATION_KINDS: readonly BoundedPcbEditOperationKind[] = [
  "move_footprint", "rotate_footprint", "add_track", "update_track", "add_via", "update_via",
  "set_routing_preference", "set_net_class_rule",
  "add_dimension", "update_dimension", "remove_dimension", "add_keepout", "update_keepout",
] as const;

/**
 * Operation intents that are EXPLICITLY out of scope for B15. They are named
 * so a refusal can be specific ("deletion is not available to proposals")
 * instead of a generic unknown-kind error — and so the permanent suite can
 * assert every one of them refuses.
 */
export const EXCLUDED_EDIT_INTENTS: readonly string[] = [
  "delete_footprint", "delete_track", "delete_via", "delete_zone", "delete_component",
  "remove_track", "remove_via", "remove_zone", "remove_footprint", "remove_padstack",
  "rip_up", "ripup", "reassign_net", "set_track_net", "set_via_net",
  "add_zone", "update_zone", "fill_zone", "refill_zones",
  "update_board_outline", "update_stackup", "set_copper_protection", "set_footprint_protection",
  "replace_component", "sync_placement", "update_binding", "update_authority",
  "auto_place_apply", "autoroute_apply", "board_repair_apply",
  "manufacturing_release", "fabrication_export", "view_control", "session_control",
] as const;

export interface BoundedEditRequest {
  /** Short human-readable statement of intent, shown in the review surface. */
  intent: string;
  operations: BoundedPcbEditOperation[];
}

export type BoundedEditRefusal = { code: BoundedEditRefusalCode; detail: string };

export type BoundedEditRefusalCode =
  | "malformed"
  | "unknown-field"
  | "too-many-operations"
  | "too-large"
  | "too-deep"
  | "excluded-operation"
  | "unknown-operation"
  | "invalid-value"
  | "hostile-input";

export type BoundedEditParse =
  | { ok: true; request: BoundedEditRequest }
  | { ok: false; refusal: BoundedEditRefusal };

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * [B15.1 §A] Guarded reflection. A Proxy may throw from ANY trap
 * (`ownKeys`, `getPrototypeOf`, `getOwnPropertyDescriptor`, `get`), so every
 * reflective read is wrapped and a throw becomes a bounded refusal marker
 * rather than an escaping exception.
 */
const REFLECTION_FAILED = Symbol("reflection-failed");

function safeGetPrototypeOf(value: object): unknown | typeof REFLECTION_FAILED {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    return REFLECTION_FAILED;
  }
}

function safeOwnKeys(value: object): Array<string | symbol> | typeof REFLECTION_FAILED {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return REFLECTION_FAILED;
  }
}

function safeDescriptor(value: object, key: string): PropertyDescriptor | undefined | typeof REFLECTION_FAILED {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return REFLECTION_FAILED;
  }
}

function safeRead(value: object, key: string): unknown | typeof REFLECTION_FAILED {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return REFLECTION_FAILED;
  }
}

/** [B15.2 §A] `Array.isArray` throws on a REVOKED proxy. */
function safeIsArray(value: unknown): boolean | typeof REFLECTION_FAILED {
  try {
    return Array.isArray(value);
  } catch {
    return REFLECTION_FAILED;
  }
}

/** [B15.2 §A] a hostile array's `length` getter may throw. */
function safeLength(value: unknown[]): number | typeof REFLECTION_FAILED {
  try {
    const length = value.length;
    return typeof length === "number" && Number.isSafeInteger(length) && length >= 0 ? length : REFLECTION_FAILED;
  } catch {
    return REFLECTION_FAILED;
  }
}

/** [B15.2 §A] index reads are trapped too — never iterate a hostile array. */
function safeIndex(value: unknown[], index: number): unknown | typeof REFLECTION_FAILED {
  try {
    return value[index];
  } catch {
    return REFLECTION_FAILED;
  }
}
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function refuse(code: BoundedEditRefusalCode, detail: string): BoundedEditParse {
  return { ok: false, refusal: { code, detail } };
}

/**
 * Reject anything that is not a JSON primitive/array/plain object, any
 * prototype-pollution key, any accessor, and any structure exceeding the
 * depth/array/string bounds. Runs on the RAW input before cloning, so a
 * hostile getter never executes twice and never observes validation.
 */
function scanHostile(value: unknown, depth: number): BoundedEditRefusal | null {
  if (depth > BOUNDED_EDIT_LIMITS.maxDepth) return { code: "too-deep", detail: `The request nests deeper than ${BOUNDED_EDIT_LIMITS.maxDepth} levels.` };
  if (value === null) return null;
  const type = typeof value;
  if (type === "string") {
    if ((value as string).length > BOUNDED_EDIT_LIMITS.maxStringLength) {
      return { code: "too-large", detail: `A string exceeds ${BOUNDED_EDIT_LIMITS.maxStringLength} characters.` };
    }
    return null;
  }
  if (type === "number") {
    if (!Number.isFinite(value as number)) return { code: "invalid-value", detail: "A numeric field is not finite." };
    return null;
  }
  if (type === "boolean") return null;
  if (type === "function" || type === "symbol" || type === "bigint" || type === "undefined") {
    return { code: "hostile-input", detail: `A field carries a ${type}, which is never accepted.` };
  }
  const isArray = safeIsArray(value);
  if (isArray === REFLECTION_FAILED) {
    return { code: "hostile-input", detail: "A field could not be classified (revoked or throwing proxy)." };
  }
  if (isArray) {
    const length = safeLength(value as unknown[]);
    if (length === REFLECTION_FAILED) {
      return { code: "hostile-input", detail: "An array's length could not be read (throwing trap)." };
    }
    if (length > BOUNDED_EDIT_LIMITS.maxArrayLength) {
      return { code: "too-large", detail: `An array exceeds ${BOUNDED_EDIT_LIMITS.maxArrayLength} entries.` };
    }
    for (let index = 0; index < length; index += 1) {
      const entry = safeIndex(value as unknown[], index);
      if (entry === REFLECTION_FAILED) {
        return { code: "hostile-input", detail: "An array entry could not be read (throwing index trap)." };
      }
      const refusal = scanHostile(entry, depth + 1);
      if (refusal) return refusal;
    }
    return null;
  }
  // Plain objects only — no class instances, no exotic prototypes. Every
  // reflective read below is GUARDED: a throwing proxy trap refuses.
  const prototype = safeGetPrototypeOf(value as object);
  if (prototype === REFLECTION_FAILED) {
    return { code: "hostile-input", detail: "A field's prototype could not be inspected (throwing reflection trap)." };
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return { code: "hostile-input", detail: "A field carries a non-plain object (exotic prototype)." };
  }
  const keys = safeOwnKeys(value as object);
  if (keys === REFLECTION_FAILED) {
    return { code: "hostile-input", detail: "A field's keys could not be enumerated (throwing reflection trap)." };
  }
  for (const key of keys) {
    if (typeof key === "symbol") return { code: "hostile-input", detail: "A field carries a symbol key." };
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) return { code: "hostile-input", detail: `A field uses the reserved key "${key}".` };
    const descriptor = safeDescriptor(value as object, key);
    if (descriptor === REFLECTION_FAILED) {
      return { code: "hostile-input", detail: `The field "${key.slice(0, 40)}" could not be inspected (throwing reflection trap).` };
    }
    if (descriptor && (descriptor.get || descriptor.set)) {
      return { code: "hostile-input", detail: `The field "${key.slice(0, 40)}" is an accessor, which is never accepted.` };
    }
    const child = safeRead(value as object, key);
    if (child === REFLECTION_FAILED) {
      return { code: "hostile-input", detail: `The field "${key.slice(0, 40)}" could not be read (throwing reflection trap).` };
    }
    const refusal = scanHostile(child, depth + 1);
    if (refusal) return refusal;
  }
  return null;
}

function closedKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): BoundedEditRefusal | null {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      return { code: "unknown-field", detail: `${label} carries an unknown field ("${key.slice(0, 40)}").` };
    }
  }
  return null;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value)
    && Math.abs(value) <= BOUNDED_EDIT_LIMITS.maxCoordinateNm;
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value)
    && value >= BOUNDED_EDIT_LIMITS.minSizeNm && value <= BOUNDED_EDIT_LIMITS.maxSizeNm;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
    && value.length <= BOUNDED_EDIT_LIMITS.maxIdentifierLength && IDENTIFIER_PATTERN.test(value);
}

/** A keepout name: a NON-EMPTY bounded string. Empty is not an explicit
 *  removal in this product contract, so it is refused rather than silently
 *  clearing the name. */
function isKeepoutName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= BOUNDED_EDIT_LIMITS.maxStringLength;
}

function isNetId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= BOUNDED_EDIT_LIMITS.maxNetId;
}

function point(value: unknown, label: string): BoundedEditRefusal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { code: "invalid-value", detail: `${label} must be a point object.` };
  }
  const record = value as Record<string, unknown>;
  const unknown = closedKeys(record, ["x", "y"], label);
  if (unknown) return unknown;
  if (!isCoordinate(record.x) || !isCoordinate(record.y)) {
    return { code: "invalid-value", detail: `${label} must carry finite integer nanometre x/y within ±${BOUNDED_EDIT_LIMITS.maxCoordinateNm}.` };
  }
  return null;
}

/** Rotation values Sirkit accepts for a footprint (quarter turns). */
const ROTATIONS = new Set([0, 90, 180, 270]);

function validateOperation(raw: unknown, index: number): BoundedEditRefusal | null {
  const label = `Operation ${index + 1}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { code: "malformed", detail: `${label} is not an object.` };
  }
  const op = raw as Record<string, unknown>;
  const kind = op.kind;
  if (typeof kind !== "string") return { code: "malformed", detail: `${label} has no operation kind.` };
  if ((EXCLUDED_EDIT_INTENTS as readonly string[]).includes(kind)) {
    return { code: "excluded-operation", detail: `${label} requests "${kind}", which bounded PCB proposals never perform. Deletion, rip-up, net reassignment, zones, outline/stackup, protection, replacement, sync, automatic apply, release, and view control are all out of scope.` };
  }
  if (!(BOUNDED_EDIT_OPERATION_KINDS as readonly string[]).includes(kind)) {
    return { code: "unknown-operation", detail: `${label} requests an unknown operation kind ("${kind.slice(0, 40)}").` };
  }

  switch (kind as BoundedPcbEditOperationKind) {
    case "move_footprint": {
      const unknown = closedKeys(op, ["kind", "footprintId", "to"], label);
      if (unknown) return unknown;
      if (!isIdentifier(op.footprintId)) return { code: "invalid-value", detail: `${label} needs a well-formed footprintId.` };
      return point(op.to, `${label} target position`);
    }
    case "rotate_footprint": {
      const unknown = closedKeys(op, ["kind", "footprintId", "rotationDeg"], label);
      if (unknown) return unknown;
      if (!isIdentifier(op.footprintId)) return { code: "invalid-value", detail: `${label} needs a well-formed footprintId.` };
      if (typeof op.rotationDeg !== "number" || !ROTATIONS.has(op.rotationDeg)) {
        return { code: "invalid-value", detail: `${label} rotation must be one of 0, 90, 180, 270 degrees.` };
      }
      return null;
    }
    case "add_track": {
      const unknown = closedKeys(op, ["kind", "layer", "netId", "widthNm", "start", "end"], label);
      if (unknown) return unknown;
      if (!isIdentifier(op.layer)) return { code: "invalid-value", detail: `${label} needs a well-formed layer id.` };
      if (!isNetId(op.netId)) return { code: "invalid-value", detail: `${label} needs a valid net id.` };
      if (!isSize(op.widthNm)) return { code: "invalid-value", detail: `${label} needs an integer track width in nanometres.` };
      return point(op.start, `${label} start`) ?? point(op.end, `${label} end`);
    }
    case "update_track": {
      const unknown = closedKeys(op, ["kind", "trackId", "start", "end", "widthNm"], label);
      if (unknown) return unknown;
      if (!isIdentifier(op.trackId)) return { code: "invalid-value", detail: `${label} needs a well-formed trackId.` };
      if (op.start === undefined && op.end === undefined && op.widthNm === undefined) {
        return { code: "invalid-value", detail: `${label} changes nothing.` };
      }
      if (op.start !== undefined) { const bad = point(op.start, `${label} start`); if (bad) return bad; }
      if (op.end !== undefined) { const bad = point(op.end, `${label} end`); if (bad) return bad; }
      if (op.widthNm !== undefined && !isSize(op.widthNm)) return { code: "invalid-value", detail: `${label} width must be an integer nanometre size.` };
      return null;
    }
    case "add_via": {
      const unknown = closedKeys(op, ["kind", "at", "netId", "sizeNm", "drillNm", "layers", "padstackId"], label);
      if (unknown) return unknown;
      const bad = point(op.at, `${label} position`);
      if (bad) return bad;
      if (!isNetId(op.netId)) return { code: "invalid-value", detail: `${label} needs a valid net id.` };
      if (!isSize(op.sizeNm) || !isSize(op.drillNm)) return { code: "invalid-value", detail: `${label} needs integer nanometre size and drill.` };
      if (op.drillNm >= op.sizeNm) return { code: "invalid-value", detail: `${label} drill must be smaller than the via size.` };
      if (!Array.isArray(op.layers) || op.layers.length !== 2 || !op.layers.every(isIdentifier)) {
        return { code: "invalid-value", detail: `${label} needs exactly two well-formed layer ids.` };
      }
      if (op.padstackId !== undefined && !isIdentifier(op.padstackId)) return { code: "invalid-value", detail: `${label} padstackId is malformed.` };
      return null;
    }
    case "update_via": {
      const unknown = closedKeys(op, ["kind", "viaId", "at", "sizeNm", "drillNm", "padstackId"], label);
      if (unknown) return unknown;
      if (!isIdentifier(op.viaId)) return { code: "invalid-value", detail: `${label} needs a well-formed viaId.` };
      if (op.at === undefined && op.sizeNm === undefined && op.drillNm === undefined && op.padstackId === undefined) {
        return { code: "invalid-value", detail: `${label} changes nothing.` };
      }
      if (op.at !== undefined) { const bad = point(op.at, `${label} position`); if (bad) return bad; }
      if (op.sizeNm !== undefined && !isSize(op.sizeNm)) return { code: "invalid-value", detail: `${label} size must be an integer nanometre value.` };
      if (op.drillNm !== undefined && !isSize(op.drillNm)) return { code: "invalid-value", detail: `${label} drill must be an integer nanometre value.` };
      if (op.padstackId !== undefined && !isIdentifier(op.padstackId)) return { code: "invalid-value", detail: `${label} padstackId is malformed.` };
      return null;
    }
    case "set_routing_preference": {
      const unknown = closedKeys(op, ["kind", "customTrackWidthNm", "routeMode", "posture", "viaPadstackId"], label);
      if (unknown) return unknown;
      if (op.customTrackWidthNm === undefined && op.routeMode === undefined && op.posture === undefined && op.viaPadstackId === undefined) {
        return { code: "invalid-value", detail: `${label} changes nothing.` };
      }
      if (op.customTrackWidthNm !== undefined && !isSize(op.customTrackWidthNm)) return { code: "invalid-value", detail: `${label} track width must be an integer nanometre size.` };
      if (op.routeMode !== undefined && !["highlight_stop", "walk_around", "shove"].includes(op.routeMode as string)) {
        return { code: "invalid-value", detail: `${label} route mode is not recognized.` };
      }
      if (op.posture !== undefined && !["orthogonal", "octilinear_a", "octilinear_b", "arbitrary"].includes(op.posture as string)) {
        return { code: "invalid-value", detail: `${label} posture is not recognized.` };
      }
      if (op.viaPadstackId !== undefined && !isIdentifier(op.viaPadstackId)) return { code: "invalid-value", detail: `${label} padstack id is malformed.` };
      return null;
    }
    case "set_net_class_rule": {
      const unknown = closedKeys(op, ["kind", "netIds", "trackWidthNm", "clearanceNm", "viaSizeNm", "viaDrillNm"], label);
      if (unknown) return unknown;
      if (!Array.isArray(op.netIds) || op.netIds.length === 0 || !op.netIds.every(isNetId)) {
        return { code: "invalid-value", detail: `${label} needs at least one valid net id.` };
      }
      const values = ["trackWidthNm", "clearanceNm", "viaSizeNm", "viaDrillNm"] as const;
      if (values.every((key) => op[key] === undefined)) return { code: "invalid-value", detail: `${label} changes nothing.` };
      for (const key of values) {
        if (op[key] !== undefined && !isSize(op[key])) return { code: "invalid-value", detail: `${label} ${key} must be an integer nanometre size.` };
      }
      return null;
    }
    case "add_dimension": {
      const unknown = closedKeys(op, ["kind", "dimensionKind", "a", "b", "offsetNm", "layer", "unit", "precision", "textHeightNm", "strokeWidthNm"], label);
      if (unknown) return unknown;
      if (!["aligned", "horizontal", "vertical"].includes(op.dimensionKind as string)) return { code: "invalid-value", detail: `${label} dimension kind is not recognized.` };
      const bad = point(op.a, `${label} point A`) ?? point(op.b, `${label} point B`);
      if (bad) return bad;
      if (!isCoordinate(op.offsetNm)) return { code: "invalid-value", detail: `${label} offset must be an integer nanometre value.` };
      if (!isIdentifier(op.layer)) return { code: "invalid-value", detail: `${label} needs a well-formed layer id.` };
      if (op.unit !== "mm" && op.unit !== "in") return { code: "invalid-value", detail: `${label} unit must be mm or in.` };
      if (![0, 1, 2, 3, 4].includes(op.precision as number)) return { code: "invalid-value", detail: `${label} precision must be 0–4.` };
      if (!isSize(op.textHeightNm) || !isSize(op.strokeWidthNm)) return { code: "invalid-value", detail: `${label} text height and stroke width must be integer nanometre sizes.` };
      return null;
    }
    case "update_dimension": {
      const unknown = closedKeys(op, ["kind", "dimensionId", "a", "b", "offsetNm", "precision"], label);
      if (unknown) return unknown;
      if (!isIdentifier(op.dimensionId)) return { code: "invalid-value", detail: `${label} needs a well-formed dimensionId.` };
      if (op.a === undefined && op.b === undefined && op.offsetNm === undefined && op.precision === undefined) {
        return { code: "invalid-value", detail: `${label} changes nothing.` };
      }
      if (op.a !== undefined) { const bad = point(op.a, `${label} point A`); if (bad) return bad; }
      if (op.b !== undefined) { const bad = point(op.b, `${label} point B`); if (bad) return bad; }
      if (op.offsetNm !== undefined && !isCoordinate(op.offsetNm)) return { code: "invalid-value", detail: `${label} offset must be an integer nanometre value.` };
      if (op.precision !== undefined && ![0, 1, 2, 3, 4].includes(op.precision as number)) return { code: "invalid-value", detail: `${label} precision must be 0–4.` };
      return null;
    }
    case "remove_dimension": {
      const unknown = closedKeys(op, ["kind", "dimensionId"], label);
      if (unknown) return unknown;
      if (!isIdentifier(op.dimensionId)) return { code: "invalid-value", detail: `${label} needs a well-formed dimensionId.` };
      return null;
    }
    case "add_keepout": {
      const unknown = closedKeys(op, ["kind", "name", "polygon", "layers", "forbidTracks", "forbidVias"], label);
      if (unknown) return unknown;
      if (op.name !== undefined && !isKeepoutName(op.name)) {
        return { code: "invalid-value", detail: `${label} name must be a non-empty string of at most ${BOUNDED_EDIT_LIMITS.maxStringLength} characters.` };
      }
      if (!Array.isArray(op.polygon) || op.polygon.length < 3) return { code: "invalid-value", detail: `${label} needs a polygon with at least three points.` };
      for (const [index, vertex] of op.polygon.entries()) {
        const bad = point(vertex, `${label} polygon point ${index + 1}`);
        if (bad) return bad;
      }
      if (!Array.isArray(op.layers) || op.layers.length === 0 || !op.layers.every(isIdentifier)) {
        return { code: "invalid-value", detail: `${label} needs at least one well-formed layer id.` };
      }
      if (typeof op.forbidTracks !== "boolean" || typeof op.forbidVias !== "boolean") {
        return { code: "invalid-value", detail: `${label} needs explicit forbidTracks/forbidVias booleans.` };
      }
      return null;
    }
    case "update_keepout": {
      const unknown = closedKeys(op, ["kind", "keepoutId", "name", "polygon", "layers", "forbidTracks", "forbidVias"], label);
      if (unknown) return unknown;
      if (!isIdentifier(op.keepoutId)) return { code: "invalid-value", detail: `${label} needs a well-formed keepoutId.` };
      // [B15.1 §A/R3] the update form validates `name` EXACTLY as the add
      // form does — a non-string (or empty) name is refused, never written
      // into the candidate board.
      if (op.name !== undefined && !isKeepoutName(op.name)) {
        return { code: "invalid-value", detail: `${label} name must be a non-empty string of at most ${BOUNDED_EDIT_LIMITS.maxStringLength} characters.` };
      }
      if (op.name === undefined && op.polygon === undefined && op.layers === undefined
        && op.forbidTracks === undefined && op.forbidVias === undefined) {
        return { code: "invalid-value", detail: `${label} changes nothing.` };
      }
      if (op.polygon !== undefined) {
        if (!Array.isArray(op.polygon) || op.polygon.length < 3) return { code: "invalid-value", detail: `${label} polygon needs at least three points.` };
        for (const [index, vertex] of op.polygon.entries()) {
          const bad = point(vertex, `${label} polygon point ${index + 1}`);
          if (bad) return bad;
        }
      }
      if (op.layers !== undefined && (!Array.isArray(op.layers) || op.layers.length === 0 || !op.layers.every(isIdentifier))) {
        return { code: "invalid-value", detail: `${label} needs at least one well-formed layer id.` };
      }
      if (op.forbidTracks !== undefined && typeof op.forbidTracks !== "boolean") return { code: "invalid-value", detail: `${label} forbidTracks must be a boolean.` };
      if (op.forbidVias !== undefined && typeof op.forbidVias !== "boolean") return { code: "invalid-value", detail: `${label} forbidVias must be a boolean.` };
      return null;
    }
  }
}

/**
 * Parse + validate a raw provider payload into a frozen bounded request.
 * TOTAL: every rejection carries a specific code and a human-readable
 * detail; nothing throws.
 */
/**
 * [B15.2 §A] TOTAL parse. Ordering is load-bearing:
 *   1. guarded hostile inspection of the RAW value;
 *   2. guarded normalization into INERT plain JSON data;
 *   3. exact UTF-8 byte measurement of that normalized data;
 *   4. semantic validation against the INERT data ONLY — the original
 *      proxy-backed value is never read again (B15.1 re-read it, so a
 *      late-throwing trap escaped);
 *   5. deep freeze.
 * The exported entry point additionally carries a final fail-closed
 * exception boundary, so no JavaScript value can escape as an exception.
 */
export function parseBoundedEditRequest(raw: unknown): BoundedEditParse {
  try {
    return parseBoundedEditRequestInner(raw);
  } catch {
    return refuse("hostile-input", "The request could not be inspected safely.");
  }
}

function parseBoundedEditRequestInner(raw: unknown): BoundedEditParse {
  const rootIsArray = safeIsArray(raw);
  if (rootIsArray === REFLECTION_FAILED) {
    return refuse("hostile-input", "The request could not be classified (revoked or throwing proxy).");
  }
  if (typeof raw !== "object" || raw === null || rootIsArray) {
    return refuse("malformed", "The request is not an object.");
  }
  const hostile = scanHostile(raw, 0);
  if (hostile) return { ok: false, refusal: hostile };

  // 2/3. Normalize to inert data and measure its EXACT UTF-8 size FIRST, so
  // every later read is against plain JSON, never the caller's value.
  let serializedRoot: string;
  try {
    serializedRoot = JSON.stringify(raw);
  } catch {
    return refuse("hostile-input", "The request could not be serialized deterministically.");
  }
  if (typeof serializedRoot !== "string") {
    return refuse("hostile-input", "The request could not be serialized deterministically.");
  }
  let inert: unknown;
  try {
    inert = JSON.parse(serializedRoot);
  } catch {
    return refuse("hostile-input", "The request could not be normalized.");
  }
  if (typeof inert !== "object" || inert === null || Array.isArray(inert)) {
    return refuse("malformed", "The request is not an object.");
  }
  const record = inert as Record<string, unknown>;
  const measured = new TextEncoder().encode(serializedRoot).length;
  if (measured > BOUNDED_EDIT_LIMITS.maxRequestBytes) {
    return refuse("too-large", `The request is ${measured} UTF-8 bytes, above the ${BOUNDED_EDIT_LIMITS.maxRequestBytes}-byte bound.`);
  }
  const unknown = closedKeys(record, ["intent", "operations"], "The request");
  if (unknown) return { ok: false, refusal: unknown };
  if (typeof record.intent !== "string" || record.intent.trim().length === 0
    || record.intent.length > BOUNDED_EDIT_LIMITS.maxIntentLength) {
    return refuse("invalid-value", `The request needs a non-empty intent of at most ${BOUNDED_EDIT_LIMITS.maxIntentLength} characters.`);
  }
  if (!Array.isArray(record.operations) || record.operations.length === 0) {
    return refuse("malformed", "The request needs at least one operation.");
  }
  if (record.operations.length > BOUNDED_EDIT_LIMITS.maxOperations) {
    return refuse("too-many-operations", `A bounded PCB proposal carries at most ${BOUNDED_EDIT_LIMITS.maxOperations} operations (received ${record.operations.length}).`);
  }
  for (const [index, operation] of record.operations.entries()) {
    const refusal = validateOperation(operation, index);
    if (refusal) return { ok: false, refusal };
  }
  return { ok: true, request: deepFreeze({ intent: record.intent, operations: record.operations } as BoundedEditRequest) };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
