/**
 * B11.4 §A — THE shared hook-free capture for untrusted documents.
 *
 * Every earlier stage validated the CALLER'S OBJECT and then let production
 * code keep reading it. Four things went wrong with that, each reproduced
 * against production code before this module existed:
 *
 *  - `JSON.stringify` and `canonicalJson` INVOKE `toJSON`. A self-deleting
 *    `toJSON` on `context.board.outline` ran once during validation, removed
 *    itself, and the capsule then validated clean and executed (B11.4 R1/R2).
 *  - Ordinary property reads (`value[key]`, `value.entries()`) invoke getters,
 *    so a validated document could yield different content afterwards.
 *  - Nothing stopped the caller from MUTATING the capsule after validation:
 *    `replayCapsule` kept reading the caller's object, so a mutation landed in
 *    the executed run and moved the trace digest (B11.4 R3).
 *  - A revoked or trap-throwing `Proxy` made every validator THROW instead of
 *    refusing (B11.4 R4).
 *
 * `capturePlainJson` closes all four at once. It reads exclusively through
 * `Reflect.ownKeys` and `Reflect.getOwnPropertyDescriptor`, takes values from
 * `descriptor.value` (never through a property access), refuses accessors
 * before they can run, refuses functions (which is what a `toJSON` hook is)
 * without invoking them, and copies everything it accepts into a fresh,
 * deep-frozen, plain-data snapshot. After capture the caller's object is
 * irrelevant: later mutation, later proxy behaviour, and later hook
 * installation cannot affect anything.
 *
 * It is TOTAL: every reflective operation is attempted inside a guard, and any
 * failure becomes a bounded structured issue instead of an exception.
 */

import { redactPathSegment } from "./redaction";

/** A value that survived capture: plain JSON data, nothing else. */
export type PlainJsonValue = string | number | boolean | null | PlainJsonValue[] | { [key: string]: PlainJsonValue };

export type DeepReadonly<T> =
  T extends (infer Element)[] ? ReadonlyArray<DeepReadonly<Element>>
  : T extends ReadonlyArray<infer Element> ? ReadonlyArray<DeepReadonly<Element>>
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T;

export type CaptureResult =
  | { ok: true; value: PlainJsonValue }
  | { ok: false; issues: string[] };

export const CAPTURE_BOUNDS = Object.freeze({
  maxDepth: 32,
  maxNodes: 200_000,
  maxArrayEntries: 20_000,
  maxStringChars: 100_000,
  maxKeyChars: 200,
  maxIssues: 12,
});

const INDEX_KEY = /^(0|[1-9][0-9]*)$/;

/**
 * [B11.5 §B] Key names are echoed into diagnostics, so they go through THE
 * shared redaction authority — not a local ASCII stripper. B11.5 R2 showed the
 * previous behaviour leaked a credential-shaped key name verbatim into capture
 * issues, `validateReplayCapsule` issues, and `ReplayCapsuleInvalidError`.
 */
const safeKeyName = redactPathSegment;

/** Run a reflective operation that a hostile Proxy may make throw. */
function attempt<T>(run: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: run() };
  } catch {
    return { ok: false };
  }
}

/** Sentinel distinguishing "descriptor rejected" from a legitimate value. */
const MISSING = Symbol("capture-missing");

interface CaptureState {
  nodes: number;
  issues: string[];
  /** Ancestors on the CURRENT path — cycle detection without retaining a
   *  reference to anything after the walk finishes. */
  ancestors: Set<object>;
  /** [B11.5 §C] `false` runs the identical guarded walk WITHOUT building a
   *  snapshot, so `findNonPlainJsonPath` can be total by sharing this code
   *  instead of re-implementing reflective traversal with unguarded
   *  `Object.*` enumeration. */
  collect: boolean;
}

function fail(state: CaptureState, issue: string): null {
  if (state.issues.length < CAPTURE_BOUNDS.maxIssues) state.issues.push(issue);
  return null;
}

/**
 * Capture one value. Returns the captured plain data, or `null` after pushing
 * at least one issue. NEVER invokes a getter, setter, coercion method, or
 * `toJSON`, and never throws.
 */
function captureValue(value: unknown, label: string, depth: number, state: CaptureState): PlainJsonValue | null {
  if (state.issues.length >= CAPTURE_BOUNDS.maxIssues) return null;
  if (depth > CAPTURE_BOUNDS.maxDepth) return fail(state, `${label}: exceeds the maximum capture depth`);
  state.nodes += 1;
  if (state.nodes > CAPTURE_BOUNDS.maxNodes) return fail(state, `${label}: exceeds the maximum captured node count`);

  // ── primitives ──
  // NOTE: a captured `null` and a capture FAILURE both surface as `null`, so
  // every call site checks `state.issues` immediately after recursing.
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "string") {
    const text = value as string;
    if (text.length > CAPTURE_BOUNDS.maxStringChars) return fail(state, `${label}: string exceeds ${CAPTURE_BOUNDS.maxStringChars} chars`);
    return text;
  }
  if (kind === "number") {
    const numeric = value as number;
    if (!Number.isFinite(numeric)) return fail(state, `${label}: must be a finite number`);
    return numeric;
  }
  if (kind === "boolean") return value as boolean;
  if (kind === "undefined") return fail(state, `${label}: undefined is not JSON data`);
  if (kind === "function") return fail(state, `${label}: a function is not JSON data (it is never invoked)`);
  if (kind === "symbol") return fail(state, `${label}: a symbol is not JSON data`);
  if (kind === "bigint") return fail(state, `${label}: a bigint is not JSON data`);
  if (kind !== "object") return fail(state, `${label}: unsupported value kind`);

  const target = value as object;
  if (state.ancestors.has(target)) return fail(state, `${label}: is cyclic`);

  // ── shape: array or plain object? `Array.isArray` THROWS on a revoked proxy ──
  const arrayCheck = attempt(() => Array.isArray(target));
  if (!arrayCheck.ok) return fail(state, `${label}: is not reflectable (revoked or hostile proxy)`);

  const prototypeCheck = attempt(() => Reflect.getPrototypeOf(target));
  if (!prototypeCheck.ok) return fail(state, `${label}: its prototype is not reflectable (hostile trap)`);
  const prototype = prototypeCheck.value;

  const keysCheck = attempt(() => Reflect.ownKeys(target));
  if (!keysCheck.ok) return fail(state, `${label}: its own keys are not reflectable (hostile trap)`);
  const ownKeys = keysCheck.value;

  for (const key of ownKeys) {
    if (typeof key === "symbol") return fail(state, `${label}: must not carry symbol keys`);
  }

  state.ancestors.add(target);
  try {
    return arrayCheck.value
      ? captureArray(target as unknown[], ownKeys as string[], prototype, label, depth, state)
      : captureObject(target, ownKeys as string[], prototype, label, depth, state);
  } finally {
    state.ancestors.delete(target);
  }
}

function captureArray(target: unknown[], ownKeys: string[], prototype: object | null, label: string, depth: number, state: CaptureState): PlainJsonValue | null {
  if (prototype !== Array.prototype) return fail(state, `${label}: must be a plain array (unexpected prototype)`);

  const lengthDescriptor = attempt(() => Reflect.getOwnPropertyDescriptor(target, "length"));
  if (!lengthDescriptor.ok) return fail(state, `${label}: its length is not reflectable (hostile trap)`);
  const rawLength = lengthDescriptor.value?.value;
  if (typeof rawLength !== "number" || !Number.isSafeInteger(rawLength) || rawLength < 0) {
    return fail(state, `${label}: has no well-formed length`);
  }
  if (rawLength > CAPTURE_BOUNDS.maxArrayEntries) return fail(state, `${label}: exceeds ${CAPTURE_BOUNDS.maxArrayEntries} entries`);

  let indexCount = 0;
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (!INDEX_KEY.test(key)) return fail(state, `${label}.${safeKeyName(key)}: an array must carry only index properties`);
    indexCount += 1;
  }
  // A SPARSE array's holes are not own properties; they would serialize as
  // `null` and silently change meaning.
  if (indexCount !== rawLength) return fail(state, `${label}: must not be a sparse array`);

  const captured: PlainJsonValue[] = [];
  for (let index = 0; index < rawLength; index += 1) {
    const descriptor = attempt(() => Reflect.getOwnPropertyDescriptor(target, String(index)));
    if (!descriptor.ok) return fail(state, `${label}[${index}]: is not reflectable (hostile trap)`);
    const element = readDataDescriptor(descriptor.value, `${label}[${index}]`, state);
    if (element === MISSING) return null;
    const child = captureValue(element, `${label}[${index}]`, depth + 1, state);
    if (state.issues.length > 0) return null;
    if (state.collect) captured.push(child as PlainJsonValue);
  }
  return captured;
}

function captureObject(target: object, ownKeys: string[], prototype: object | null, label: string, depth: number, state: CaptureState): PlainJsonValue | null {
  // `Object.create(null)` is plain data; anything else with a foreign
  // prototype can expose inherited members the capture would not see.
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(state, `${label}: must be a plain object (unexpected prototype)`);
  }

  // [B11.5 §A] The destination starts with a NULL prototype and every accepted
  // key is installed with `Object.defineProperty`. Ordinary assignment onto
  // `{}` invokes the legacy `__proto__` setter: B11.5 R1 reproduced BOTH
  // failure modes — a numeric `__proto__` was silently DISCARDED (contradicting
  // the "no accepted field is silently discarded" invariant) and an
  // object-valued one REPLACED THE SNAPSHOT'S PROTOTYPE. `defineProperty`
  // cannot invoke a setter, so every accepted own string key — `__proto__`,
  // `constructor`, `prototype`, and ordinary `Record<string, V>` keys alike —
  // is preserved byte-for-byte as an own enumerable data property.
  const captured: Record<string, PlainJsonValue> = Object.create(null) as Record<string, PlainJsonValue>;
  for (const key of ownKeys) {
    if (key.length > CAPTURE_BOUNDS.maxKeyChars) return fail(state, `${label}: carries an oversized key name`);
    const path = `${label}.${safeKeyName(key)}`;
    const descriptor = attempt(() => Reflect.getOwnPropertyDescriptor(target, key));
    if (!descriptor.ok) return fail(state, `${path}: is not reflectable (hostile trap)`);
    const raw = readDataDescriptor(descriptor.value, path, state);
    if (raw === MISSING) return null;
    // `toJSON` is refused as a FUNCTION VALUE by `captureValue`, so it is
    // never invoked — that is the whole point of reading descriptors.
    const child = captureValue(raw, path, depth + 1, state);
    if (state.issues.length > 0) return null;
    if (!state.collect) continue;
    Object.defineProperty(captured, key, { value: child as PlainJsonValue, enumerable: true, writable: true, configurable: true });
  }
  if (!state.collect) return captured;
  // Restore the ordinary plain-object prototype. The own `__proto__` data
  // property (if any) SHADOWS the inherited accessor, so this cannot undo it.
  Object.setPrototypeOf(captured, Object.prototype);
  return captured;
}

/**
 * Extract a value from an own-property descriptor WITHOUT reading the
 * property. An accessor is refused here, before it can run.
 */
function readDataDescriptor(descriptor: PropertyDescriptor | undefined, path: string, state: CaptureState): unknown | typeof MISSING {
  if (descriptor === undefined) { fail(state, `${path}: own property vanished during capture`); return MISSING; }
  if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
    fail(state, `${path}: must be a data property, not an accessor`);
    return MISSING;
  }
  if (descriptor.enumerable !== true) { fail(state, `${path}: must not be a non-enumerable property`); return MISSING; }
  return descriptor.value;
}

/**
 * [B11.6 §A] THE OWNERSHIP REGISTRY. Every container this module creates is
 * recorded here at freeze time. Membership is an UNFORGEABLE, O(1), trap-free
 * proof that a value is one of our own snapshots:
 *
 *  - a caller cannot insert into a module-private `WeakSet`;
 *  - `WeakSet.has` is identity-based — it invokes NO proxy traps and cannot
 *    throw, even on a revoked proxy;
 *  - it holds no strong reference, so snapshots are collected normally.
 *
 * This is what lets the captured-only fast paths (`validateCapturedReplayContext`,
 * `projectCapturedBoard`, …) skip re-capturing data that is already ours —
 * preserving the parse-once invariant — while remaining TOTAL and identity-safe
 * for any other input, which silently falls back to capture-first.
 */
const OWNED_CAPTURES = new WeakSet<object>();

/** True exactly when `value` is a container this module captured. Total: no
 *  reflective operation touches the value. */
export function isOwnedCapture(value: unknown): boolean {
  return typeof value === "object" && value !== null && OWNED_CAPTURES.has(value);
}

/** Freeze the captured snapshot all the way down and register every container
 *  in the ownership registry. It is our own fresh data, so there are no
 *  accessors and nothing can throw. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    OWNED_CAPTURES.add(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/**
 * Capture an untrusted document as an INDEPENDENT, deeply frozen, plain-JSON
 * snapshot. Never invokes a getter, setter, coercion method, or `toJSON`;
 * never throws; always bounded.
 *
 * The serialized-size bound is applied to the CAPTURED snapshot — never to the
 * caller's object, because `JSON.stringify` would invoke `toJSON`.
 */
export function capturePlainJson(root: unknown, label = "$", maxSerializedChars = 1_000_000): CaptureResult {
  const state: CaptureState = { nodes: 0, issues: [], ancestors: new Set(), collect: true };
  const captured = captureValue(root, label, 0, state);
  if (state.issues.length > 0) return { ok: false, issues: [...state.issues] };

  let serialized: string;
  try {
    serialized = JSON.stringify(captured);
  } catch {
    return { ok: false, issues: [`${label}: the captured snapshot is not serializable`] };
  }
  if (serialized === undefined) return { ok: false, issues: [`${label}: captured to nothing serializable`] };
  if (serialized.length > maxSerializedChars) {
    return { ok: false, issues: [`${label}: exceeds the ${maxSerializedChars}-character serialized bound`] };
  }
  return { ok: true, value: deepFreeze(captured) as PlainJsonValue };
}

/**
 * [B11.5 §C] The IDENTICAL guarded walk in scan-only mode: no snapshot is
 * built, so this is the cheap way to answer "is this plain JSON data?" without
 * a second traversal implementation. Returns the first bounded issue, or null.
 *
 * Sharing the walk is what makes `findNonPlainJsonPath` total: B11.5 R3 showed
 * that guarding one preliminary `Reflect.ownKeys` and then re-enumerating with
 * unguarded `Object.getOwnPropertyNames` / `Object.getOwnPropertySymbols` /
 * `Object.entries` still throws for a STATEFUL proxy whose second trap call
 * fails — and `Object.entries` performs ordinary property reads, which may
 * invoke `get` traps.
 */
export function scanPlainJson(root: unknown, label = "$", startDepth = 0): string | null {
  // [B11.6 R5] `startDepth` preserves the depth semantics of the retained
  // `findNonPlainJsonPath(value, label, depth)` contract: a caller-supplied
  // starting depth counts against the same bound the recursion uses, so
  // `depth > CAPTURE_BOUNDS.maxDepth` at entry reports exhaustion instead of
  // being silently ignored.
  const state: CaptureState = { nodes: 0, issues: [], ancestors: new Set(), collect: false };
  captureValue(root, label, startDepth, state);
  return state.issues.length > 0 ? state.issues[0]! : null;
}

/**
 * True exactly when `value` is a CAPTURED plain object (never an array).
 *
 * [B11.7 §B] The runtime test now matches the TypeScript claim: membership in
 * the ownership registry is required, so an ordinary `{}`, a caller-frozen
 * object, a `Date`, or a benign proxy is `false` — none of them was produced
 * by `capturePlainJson`, so none is known to satisfy `PlainJsonValue`. (The
 * previous test was "any non-array object", an unsound predicate that would
 * have vouched for arbitrary caller data.)
 *
 * DOCUMENTED DISTINCTION: "captured" means produced and registered by
 * `capturePlainJson`. PROJECTION outputs (`projectBoardForReplay(...).value`)
 * are owned and frozen but are NOT captures — their new containers are built
 * by the projector — so this guard reports `false` for them. Nested
 * containers of a capture ARE captures (every container is registered at
 * freeze time).
 *
 * Total: `isOwnedCapture` is trap-free, and owned values are our own plain
 * containers, so nothing here can throw; the `Array.isArray` guard is kept as
 * defence in depth.
 */
export function isCapturedRecord(value: unknown): value is Record<string, PlainJsonValue> {
  if (!isOwnedCapture(value)) return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}
