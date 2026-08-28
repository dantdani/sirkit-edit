/**
 * B11.3 §B — the RECURSIVE, descriptor-driven PCB board projector.
 *
 * B11.2's replay-context contract was exact only at the `PcbBoard` TOP LEVEL:
 * nested PCB objects and arrays were carried wholesale by a shallow `pick`, so
 * an unknown field on `outline`, `outline.origin`, `nets[0]`, `tracks[0]`, or
 * `tracks[0].start` validated AND executed (reproduced pre-edit as B11.3
 * R1–R5). `validatePcbBoardStructure` validates engineering semantics; it has
 * never rejected unknown keys, and it is not being changed to.
 *
 * This module closes that gap WITHOUT a competing PCB definition. Every fact
 * about what a PCB object may contain comes from
 * `generated/pcb-shape-descriptor.ts`, produced by the TypeScript compiler API
 * from `app/lib/pcb/types.ts:PcbBoard`. There is no second, hand-written PCB
 * key table anywhere in replay validation — the CI drift gate proves it.
 *
 * The two exported functions are one traversal seen two ways:
 *
 *  - `projectBoardForReplay(raw)` — pure projection. Carries only
 *    authoritative fields, preserves array order and tuple structure, keeps
 *    legitimate dynamic `Record` keys, selects the correct union variant,
 *    never mutates the source, never coerces or repairs a value.
 *  - `validateBoardShape(raw)` — the same walk, reporting precise, redacted
 *    paths for unknown keys, type mismatches, bad record keys, and
 *    unsatisfiable union variants.
 *
 * THE INVARIANT:
 *
 *   canonicalJson(projectBoardForReplay(raw)) === canonicalJson(raw)
 *
 * holds exactly when the board contains nothing the authoritative type graph
 * does not declare. `validateReplayContext` enforces both the precise issues
 * and the round-trip, so anything the projector would discard refuses before
 * sink creation, context assembly, discovery, gateway construction, loop
 * execution, or tool invocation.
 *
 * Deliberate separation: this is a STRUCTURAL contract only. A structurally
 * exact board may still be semantically invalid, and that stays the job of
 * `validatePcbBoardStructure` — see `e04-invalid-board`.
 */

import { PCB_SHAPE_DESCRIPTOR } from "./generated/pcb-shape-descriptor";
import type { PcbShapeDescriptor, PcbShapeNode } from "./pcb-shape-types";
import { redactPathSegment, sanitizeTraceText } from "./redaction";
import { capturePlainJson, isOwnedCapture, type PlainJsonValue } from "./plain-capture";

/** Mirrors `REPLAY_CONTEXT_BOUNDS`; a regression pins the two together. The
 *  values are duplicated rather than imported to keep this module free of any
 *  dependency on the replay-context consumer. */
export const PCB_PROJECTION_BOUNDS = Object.freeze({
  maxDepth: 24,
  maxNodes: 100_000,
  maxArrayEntries: 20_000,
  maxIssues: 12,
});

type Rec = Record<string, unknown>;

/** [B11.4] `Array.isArray` THROWS on a revoked proxy, so even this predicate
 *  is guarded. A non-reflectable value is never a record. */
const isRec = (value: unknown): value is Rec => {
  if (typeof value !== "object" || value === null) return false;
  const array = reflect(() => Array.isArray(value));
  return array.ok && !array.value;
};

/** [B11.4] Guard for a reflective operation a hostile Proxy may make throw. */
function reflect<T>(run: () => T): { ok: true; value: T } | { ok: false } {
  try { return { ok: true, value: run() }; } catch { return { ok: false }; }
}

/**
 * [B11.5 §A] Install an untrusted key as an own DATA property. Ordinary
 * assignment (`out[key] = value`) invokes the legacy `__proto__` setter, which
 * either DISCARDS a numeric value or REPLACES the destination's prototype
 * (B11.5 R1). `defineProperty` cannot invoke a setter.
 */
function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Key names are echoed into diagnostics, so they are sanitized and bounded. */
const safeKey = (key: string): string => redactPathSegment(key, 60);

interface WalkResult {
  /** The projected value: authoritative fields only. */
  value: unknown;
  /** Precise, redacted issue paths. Empty ⇔ structurally exact. */
  issues: string[];
}

interface Budget {
  nodes: number;
  exhausted: boolean;
}

class Walker {
  constructor(private readonly descriptor: PcbShapeDescriptor) {}

  private resolve(node: PcbShapeNode, seen = 0): PcbShapeNode | null {
    if (node.k !== "ref") return node;
    if (seen > 16) return null; // a ref cycle with no object in between
    const target = this.descriptor.nodes[node.id];
    return target ? this.resolve(target, seen + 1) : null;
  }

  walk(value: unknown, node: PcbShapeNode, path: string, depth: number, budget: Budget): WalkResult {
    if (budget.exhausted) return { value, issues: [] };
    if (depth > PCB_PROJECTION_BOUNDS.maxDepth) {
      budget.exhausted = true;
      return { value, issues: [`${path}: exceeds the maximum board nesting depth`] };
    }
    budget.nodes += 1;
    if (budget.nodes > PCB_PROJECTION_BOUNDS.maxNodes) {
      budget.exhausted = true;
      return { value, issues: [`${path}: exceeds the maximum board node count`] };
    }

    const resolved = this.resolve(node);
    if (resolved === null) return { value, issues: [`${path}: the generated descriptor has an unresolvable type reference`] };

    switch (resolved.k) {
      case "string":
        return { value, issues: typeof value === "string" ? [] : [`${path}: must be a string`] };
      case "number":
        return { value, issues: typeof value === "number" && Number.isFinite(value) ? [] : [`${path}: must be a finite number`] };
      case "boolean":
        return { value, issues: typeof value === "boolean" ? [] : [`${path}: must be a boolean`] };
      case "null":
        return { value, issues: value === null ? [] : [`${path}: must be null`] };
      case "literal":
        return { value, issues: value === resolved.v ? [] : [`${path}: must be the literal ${JSON.stringify(resolved.v)}`] };
      case "array":
        return this.walkArray(value, resolved.item, path, depth, budget);
      case "tuple":
        return this.walkTuple(value, resolved.items, path, depth, budget);
      case "object":
        return this.walkObject(value, resolved, path, depth, budget);
      case "union":
        return this.walkUnion(value, resolved, path, depth, budget);
      default:
        return { value, issues: [`${path}: unsupported descriptor node`] };
    }
  }

  private walkArray(value: unknown, item: PcbShapeNode, path: string, depth: number, budget: Budget): WalkResult {
    const arrayCheck = reflect(() => Array.isArray(value));
    if (!arrayCheck.ok) return { value, issues: [`${path}: is not reflectable (revoked or hostile proxy)`] };
    if (!arrayCheck.value) return { value, issues: [`${path}: must be an array`] };
    const array = value as unknown[];
    if (array.length > PCB_PROJECTION_BOUNDS.maxArrayEntries) {
      budget.exhausted = true;
      return { value, issues: [`${path}: exceeds ${PCB_PROJECTION_BOUNDS.maxArrayEntries} entries`] };
    }
    // [B11.3/B11.4 §D] `validateBoardShape` must be SOUND STANDALONE: its
    // documented contract is "empty ⇔ structurally exact", so every array
    // discipline the context-level gates apply is repeated here. B11.4 R5
    // reproduced the gap — a sparse `tracks` array returned `[]` from this
    // function while `validateReplayContext` refused it.
    const prototype = reflect(() => Reflect.getPrototypeOf(array));
    if (!prototype.ok) return { value, issues: [`${path}: is not reflectable (hostile trap)`] };
    if (prototype.value !== Array.prototype) return { value, issues: [`${path}: must be a plain array (unexpected prototype)`] };
    if (Object.getOwnPropertySymbols(array).length > 0) return { value, issues: [`${path}: must not carry symbol keys`] };
    let indexCount = 0;
    for (const key of Object.getOwnPropertyNames(array)) {
      if (key === "length") continue;
      if (!/^(0|[1-9][0-9]*)$/.test(key)) {
        return { value, issues: [`${path}.${safeKey(key)}: an array must carry only index properties`] };
      }
      // Read the DESCRIPTOR, never the value: an accessor at an INDEX would be
      // invoked by `.map` below and could return different content after
      // validation.
      const descriptor = reflect(() => Object.getOwnPropertyDescriptor(array, key));
      if (!descriptor.ok) return { value, issues: [`${path}[${key}]: is not reflectable (hostile trap)`] };
      if (descriptor.value === undefined) return { value, issues: [`${path}[${key}]: unreadable property descriptor`] };
      if (typeof descriptor.value.get === "function" || typeof descriptor.value.set === "function") {
        return { value, issues: [`${path}[${key}]: must be a data property, not an accessor`] };
      }
      if (descriptor.value.enumerable !== true) return { value, issues: [`${path}: must not carry non-enumerable properties`] };
      indexCount += 1;
    }
    // A SPARSE array's holes are not own properties: `.map` preserves them and
    // `canonicalJson` renders them as `null`, so both sides of the round-trip
    // are blind to the difference.
    if (indexCount !== array.length) return { value, issues: [`${path}: must not be a sparse array`] };
    const issues: string[] = [];
    // Array ORDER is preserved exactly; nothing is sorted, filtered, or padded.
    const projected = array.map((element, index) => {
      const result = this.walk(element, item, `${path}[${index}]`, depth + 1, budget);
      for (const issue of result.issues) if (issues.length < PCB_PROJECTION_BOUNDS.maxIssues) issues.push(issue);
      return result.value;
    });
    return { value: projected, issues };
  }

  private walkTuple(value: unknown, items: readonly PcbShapeNode[], path: string, depth: number, budget: Budget): WalkResult {
    if (!Array.isArray(value)) return { value, issues: [`${path}: must be a tuple array`] };
    if (value.length !== items.length) return { value, issues: [`${path}: must be a tuple of exactly ${items.length} elements`] };
    const issues: string[] = [];
    const projected = items.map((item, index) => {
      const result = this.walk(value[index], item, `${path}[${index}]`, depth + 1, budget);
      for (const issue of result.issues) if (issues.length < PCB_PROJECTION_BOUNDS.maxIssues) issues.push(issue);
      return result.value;
    });
    return { value: projected, issues };
  }

  private walkObject(
    value: unknown,
    node: Extract<PcbShapeNode, { k: "object" }>,
    path: string,
    depth: number,
    budget: Budget,
  ): WalkResult {
    if (!isRec(value)) return { value, issues: [`${path}: must be a plain object`] };
    // Non-plain JavaScript (prototype-carried, symbol-keyed, accessor-backed,
    // non-enumerable) is refused by `findNonPlainJsonPath` before this walk
    // runs; the own-property discipline here is the second line.
    const issues: string[] = [];
    const projected: Rec = {};
    const declared = new Map(node.props.map((prop) => [prop.name, prop]));

    for (const prop of node.props) {
      const present = Object.prototype.hasOwnProperty.call(value, prop.name) && value[prop.name] !== undefined;
      if (!present) {
        if (!prop.optional && issues.length < PCB_PROJECTION_BOUNDS.maxIssues) issues.push(`${path}.${prop.name}: missing required key`);
        continue;
      }
      const result = this.walk(value[prop.name], prop.type, `${path}.${prop.name}`, depth + 1, budget);
      for (const issue of result.issues) if (issues.length < PCB_PROJECTION_BOUNDS.maxIssues) issues.push(issue);
      defineOwn(projected, prop.name, result.value);
    }

    for (const key of Object.keys(value)) {
      if (declared.has(key)) continue;
      if (value[key] === undefined) continue; // invisible to canonical JSON
      if (node.index === null) {
        // NO index signature ⇒ dynamic keys are illegal here. The key is
        // DROPPED from the projection, which is what makes the round-trip
        // detect it even when this issue list is already full.
        if (issues.length < PCB_PROJECTION_BOUNDS.maxIssues) {
          issues.push(`${path}.${safeKey(key)}: unknown key — the authoritative PCB type declares no such field`);
        }
        continue;
      }
      if (node.index.key === "number" && !isCanonicalIntegerKey(key)) {
        // `Record<number, V>` in JSON has canonical integer-string keys.
        if (issues.length < PCB_PROJECTION_BOUNDS.maxIssues) {
          issues.push(`${path}.${safeKey(key)}: this record is keyed by number, so the key must be a canonical safe-integer string`);
        }
        continue;
      }
      const result = this.walk(value[key], node.index.of, `${path}.${safeKey(key)}`, depth + 1, budget);
      for (const issue of result.issues) if (issues.length < PCB_PROJECTION_BOUNDS.maxIssues) issues.push(issue);
      defineOwn(projected, key, result.value);
    }

    return { value: projected, issues };
  }

  /**
   * Union variant selection.
   *
   * With a discriminant the variant is chosen exactly — so a field belonging
   * to ANOTHER variant is an unknown key on the selected one and refuses.
   * Without one, every variant is evaluated and the first CLEAN one wins;
   * if none is clean, the variant with the fewest issues supplies the
   * diagnostics (deterministic: descriptor order breaks ties).
   */
  private walkUnion(
    value: unknown,
    node: Extract<PcbShapeNode, { k: "union" }>,
    path: string,
    depth: number,
    budget: Budget,
  ): WalkResult {
    if (node.discriminant !== null && isRec(value)) {
      const tag = value[node.discriminant];
      for (const variant of node.variants) {
        const resolved = this.resolve(variant);
        if (!resolved || resolved.k !== "object") continue;
        const marker = resolved.props.find((prop) => prop.name === node.discriminant);
        const markerType = marker ? this.resolve(marker.type) : null;
        if (markerType && markerType.k === "literal" && markerType.v === tag) {
          return this.walk(value, variant, path, depth, budget);
        }
      }
      return {
        value,
        issues: [`${path}.${safeKey(String(node.discriminant))}: ${typeof tag === "string" ? `"${sanitizeTraceText(tag, 40)}"` : "value"} is not a declared variant of this union`],
      };
    }

    let best: WalkResult | null = null;
    for (const variant of node.variants) {
      // Each attempt gets its own EXHAUSTION flag so a failed variant cannot
      // poison the one that actually matches — but its work is CHARGED to the
      // shared node counter either way, so N variants cannot multiply the
      // total traversal allowance.
      const attemptBudget: Budget = { nodes: budget.nodes, exhausted: false };
      const result = this.walk(value, variant, path, depth, attemptBudget);
      budget.nodes = attemptBudget.nodes;
      if (result.issues.length === 0 && !attemptBudget.exhausted) {
        return result;
      }
      if (best === null || result.issues.length < best.issues.length) best = result;
    }
    return best ?? { value, issues: [`${path}: matches no declared variant of this union`] };
  }
}

/** `Record<number, V>` keys become canonical integer strings in JSON. */
function isCanonicalIntegerKey(key: string): boolean {
  if (key.length === 0 || key.length > 20) return false;
  const parsed = Number(key);
  return Number.isSafeInteger(parsed) && String(parsed) === key;
}

const WALKER = new Walker(PCB_SHAPE_DESCRIPTOR as PcbShapeDescriptor);

function freshBudget(): Budget {
  return { nodes: 0, exhausted: false };
}

/**
 * [B11.6 §D] THE projection result contract.
 *
 *  - `{ ok: true, value, issues: [] }` — the input was capturable and
 *    structurally exact; `value` is the OWNED, deep-frozen projection.
 *  - `{ ok: true, value, issues: [...] }` — the input was capturable plain
 *    JSON but structurally invalid (unknown keys, wrong-typed values, …);
 *    `value` is still an OWNED projection carrying the wrong-typed plain
 *    values for deterministic validation diagnostics. It must never be
 *    treated as authoritative content — `issues` says why.
 *  - `{ ok: false, issues }` — the input could not be captured at all
 *    (hostile proxy, accessor, hook, cycle, sparse array, capture bound), or
 *    the projection traversal exhausted its bounds. There is NO value:
 *    failure is never encoded as the caller's raw input.
 *
 * On every path the result contains ONLY owned data. No caller object, proxy,
 * accessor-backed object, or other caller-owned identity appears at any depth
 * — on success or on refusal (B11.6 R1/R2).
 */
export type BoardProjectionResult =
  | { ok: true; value: PlainJsonValue; issues: string[] }
  | { ok: false; issues: string[] };

/** Freeze the projection's NEW containers. Children come from the captured
 *  snapshot, which is already deep-frozen, so no caller object is ever
 *  frozen. */
function freezeProjection<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeProjection(child);
  }
  return value;
}

/** The trusted walk over data that is PROVEN ours. */
function runCapturedProjection(captured: unknown): BoardProjectionResult {
  const descriptor = PCB_SHAPE_DESCRIPTOR as PcbShapeDescriptor;
  const budget = freshBudget();
  const { value, issues } = WALKER.walk(captured, { k: "ref", id: descriptor.root }, "board", 0, budget);
  if (budget.exhausted) {
    // A partially projected board must never look authoritative.
    return { ok: false, issues: issues.length > 0 ? issues : ["board: traversal bounds were exhausted, so the board is refused rather than partially projected"] };
  }
  return { ok: true, value: freezeProjection(value) as PlainJsonValue, issues };
}

/**
 * [B11.6 §A] THE public board projection: CAPTURE, then project the capture.
 *
 * B11.6 R1/R2 reproduced why the previous shape was wrong: the walker returned
 * the CALLER'S value on refusal (`projectBoardForReplay(revokedProxy) ===
 * revokedProxy`) and carried caller-owned nested objects verbatim for
 * wrong-typed slots, so reading the "projection" could still execute the
 * caller's proxy traps. Capture-first makes every value in the result an
 * owned, frozen copy by construction, on success and refusal alike.
 *
 * Data that is ALREADY one of our snapshots (proven by the unforgeable
 * ownership registry, never by caller-controllable evidence) skips the
 * re-capture, which is what keeps replay parse-once.
 */
export function projectBoardForReplay(raw: unknown): BoardProjectionResult {
  // [B11.7 §A] ONE primitive discipline: the ONLY bypass is the unforgeable
  // ownership registry. B11.7 R1 reproduced what the previous
  // "non-object primitives skip capture" shortcut cost: `undefined`, symbols,
  // bigints, `NaN`, and `Infinity` — every one of which capture REFUSES —
  // sailed into `ok: true` results, where a bigint made `JSON.stringify`
  // THROW, non-finite numbers silently became `null`, and `undefined`/symbol
  // values vanished from the serialized result. Capture-first restores the
  // invariant: a projection can never report `ok: true` with data
  // `capturePlainJson` would refuse. Valid-JSON primitive roots (`null`,
  // finite numbers, booleans, strings) capture fine and then earn a
  // deterministic STRUCTURAL issue from the walker — capturable but never
  // authoritative.
  if (isOwnedCapture(raw)) return runCapturedProjection(raw);
  const captured = capturePlainJson(raw, "board");
  if (!captured.ok) return { ok: false, issues: captured.issues };
  return runCapturedProjection(captured.value);
}

/**
 * [B11.6 §A] TRUSTED captured-data projector, exported for the parse-once
 * path (`replay-context.ts` projects the board slice of an already-captured
 * context). Runtime-ENFORCED, not merely documented: input that is not in the
 * ownership registry falls back to the capture-first public path, so misuse
 * with caller-owned or hostile input is total and identity-safe — it can never
 * silently treat foreign data as trusted.
 */
export function projectCapturedBoard(captured: unknown): BoardProjectionResult {
  return projectBoardForReplay(captured);
}

/** The same walk, reporting precise redacted paths. Empty ⇔ structurally
 *  exact. [B11.6] Total by capture-first: hostile input yields the capture
 *  refusal; captured input is walked exactly as before. */
export function validateBoardShape(raw: unknown): string[] {
  return projectBoardForReplay(raw).issues;
}

/**
 * [B11.3] Every field name the AUTHORITATIVE PCB type graph declares. Derived
 * from the generated descriptor at module load — never hand-typed — so it can
 * never drift from `app/lib/pcb/types.ts`.
 */
export const PCB_DECLARED_FIELD_NAMES: ReadonlySet<string> = (() => {
  const names = new Set<string>();
  const walk = (node: PcbShapeNode): void => {
    if (node.k === "object") {
      for (const prop of node.props) { names.add(prop.name); walk(prop.type); }
      if (node.index) walk(node.index.of);
    } else if (node.k === "array") walk(node.item);
    else if (node.k === "tuple") for (const item of node.items) walk(item);
    else if (node.k === "union") for (const variant of node.variants) walk(variant);
  };
  for (const node of Object.values((PCB_SHAPE_DESCRIPTOR as PcbShapeDescriptor).nodes)) walk(node);
  return names;
})();

export { PCB_SHAPE_DESCRIPTOR };
export { PCB_SHAPE_GRAPH_DIGEST, PCB_SHAPE_SOURCE_DIGEST } from "./generated/pcb-shape-descriptor";
