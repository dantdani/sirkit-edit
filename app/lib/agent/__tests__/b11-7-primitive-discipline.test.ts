/**
 * B11.7 — permanent regressions for primitive JSON discipline and the
 * truthful captured-record guard.
 *
 * Every counterexample here was reproduced against production code BEFORE the
 * fix (see artifacts/ai-control-plane-b11-7/pre-edit-counterexamples.md).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { capturePlainJson, isCapturedRecord, isOwnedCapture } from "../plain-capture";
import { projectBoardForReplay, projectCapturedBoard, validateBoardShape, type BoardProjectionResult } from "../pcb-shape-projection";
import { projectReplayContext, validateReplayContext, type ContextProjectionResult } from "../replay-context";
import { replayCapsule, validateReplayCapsule, type ReplayCapsule } from "../replay-capsule";
import { buildEvaluationCases } from "../evaluation-cases";
import { canonicalJson } from "../../engineering/stable";
import { createEmptyBoard } from "../../pcb/types";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";

const ROOT = process.cwd();
const pins = (JSON.parse(readFileSync(join(ROOT, "artifacts", "ai-control-plane-b11", "replay-trace-pins.json"), "utf8")) as { pins: Record<string, string> }).pins;
type Rec = Record<string, unknown>;
const capsuleFor = (caseId: string): ReplayCapsule => buildEvaluationCases(pins).find((item) => item.caseId === caseId)!.capsule;
const clone = <T>(value: T): T => structuredClone(value);

const NON_JSON_PRIMITIVES: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["symbol", Symbol("synthetic")],
  ["bigint", BigInt(1)],
  ["NaN", Number.NaN],
  ["+Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
];
const JSON_PRIMITIVES: Array<[string, unknown]> = [
  ["null", null],
  ["zero", 0],
  ["finite number", 1.5],
  ["string", "x"],
  ["true", true],
  ["false", false],
];

/**
 * [B11.7 §C] THE reusable successful-result JSON invariant. For every
 * `ok: true` projection result:
 *  - `JSON.stringify(result)` does not throw;
 *  - `value` remains PRESENT after serialization (it cannot vanish the way
 *    `undefined`/symbol values do);
 *  - parsing the serialized result preserves the value's semantics
 *    (canonical-JSON equality after a serialize→parse round trip);
 *  - a recursive walk finds only valid JSON primitives and plain
 *    arrays/objects — every number finite; no undefined, bigint, symbol, or
 *    function at any depth.
 */
function assertJsonInvariant(result: BoardProjectionResult | ContextProjectionResult, label: string): void {
  expect(result.ok, `${label}: expected ok:true`).toBe(true);
  if (!result.ok) return;

  let serialized = "";
  expect(() => { serialized = JSON.stringify(result); }, `${label}: JSON.stringify threw`).not.toThrow();
  const parsed = JSON.parse(serialized) as Rec;
  expect(Object.prototype.hasOwnProperty.call(parsed, "value"), `${label}: value vanished during serialization`).toBe(true);
  expect(canonicalJson(parsed.value), `${label}: serialization changed the value's meaning`).toBe(canonicalJson(result.value));

  const walk = (value: unknown, path: string): void => {
    if (value === null) return;
    const kind = typeof value;
    expect(kind === "string" || kind === "number" || kind === "boolean" || kind === "object", `${label}: ${path} is a ${kind}`).toBe(true);
    if (kind === "number") expect(Number.isFinite(value as number), `${label}: ${path} is non-finite`).toBe(true);
    if (kind !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((element, index) => walk(element, `${path}[${index}]`));
      return;
    }
    expect(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${label}: ${path} has a foreign prototype`).toBe(true);
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      expect("value" in descriptor, `${label}: ${path}.${key} is an accessor`).toBe(true);
      expect(descriptor.value !== undefined, `${label}: ${path}.${key} is undefined`).toBe(true);
      expect(typeof descriptor.value !== "function" && typeof descriptor.value !== "symbol" && typeof descriptor.value !== "bigint", `${label}: ${path}.${key} is non-JSON`).toBe(true);
      walk(descriptor.value, `${path}.${key}`);
    }
    expect(Object.getOwnPropertySymbols(value).length, `${label}: ${path} carries symbol keys`).toBe(0);
  };
  walk(result.value, "value");
}

// ─── 1–5. one primitive discipline (R1) ─────────────────────────────────────

describe("B11.7 §A — one primitive discipline (R1)", () => {
  it("1: all non-JSON primitive roots REFUSE from every projection entry point", () => {
    for (const [label, value] of NON_JSON_PRIMITIVES) {
      // Capture refuses, and every projection must agree with it.
      expect(capturePlainJson(value, "$").ok, `capture(${label})`).toBe(false);
      for (const [name, run] of [
        ["projectBoardForReplay", () => projectBoardForReplay(value)],
        ["projectCapturedBoard", () => projectCapturedBoard(value)],
        ["projectReplayContext", () => projectReplayContext(value)],
      ] as const) {
        const result = run();
        expect(result.ok, `${name}(${label}) reported ok:true for data capture refuses`).toBe(false);
        if (!result.ok) {
          expect(result.issues.length, `${name}(${label})`).toBeGreaterThan(0);
          expect(result.issues.length).toBeLessThanOrEqual(12);
          // deterministic
          const again = run();
          expect(again.ok).toBe(false);
          if (!again.ok) expect(again.issues).toEqual(result.issues);
        }
      }
      expect(validateBoardShape(value).length, `validateBoardShape(${label})`).toBeGreaterThan(0);
    }
  });

  it("2/3/4: bigint never escapes; NaN/Infinity are not normalized to null; undefined/symbol cannot vanish", () => {
    for (const [label, value] of NON_JSON_PRIMITIVES) {
      for (const result of [projectBoardForReplay(value), projectCapturedBoard(value)]) {
        // Refused — so nothing to serialize wrongly. The serialization of the
        // REFUSAL itself is well-formed and value-free.
        expect(result.ok, label).toBe(false);
        let serialized = "";
        expect(() => { serialized = JSON.stringify(result); }, `${label}: refusal not serializable`).not.toThrow();
        expect(serialized).not.toContain('"value"');
        expect(serialized).toContain('"ok":false');
      }
    }
    // NESTED non-finite numbers are refused by capture too — they can never be
    // smuggled inside an otherwise-plain board and come out as null.
    const board = createEmptyBoard() as unknown as Rec;
    ((board.outline as Rec).origin as Rec).x = Number.NaN;
    const projected = projectBoardForReplay(board);
    expect(projected.ok).toBe(false);
    if (!projected.ok) expect(projected.issues.join(" ")).toContain("finite");
  });

  it("5: valid-JSON primitive roots receive deterministic STRUCTURAL issues, never authority", () => {
    for (const [label, value] of JSON_PRIMITIVES) {
      const board = projectBoardForReplay(value);
      expect(board.ok, `board(${label})`).toBe(true);
      if (board.ok) {
        expect(board.issues.length, `board(${label}) had no structural issue`).toBeGreaterThan(0);
        expect(board.issues.join(" ")).toContain("must be a plain object");
        assertJsonInvariant(board, `board(${label})`);
      }
      const context = projectReplayContext(value);
      expect(context.ok, `context(${label})`).toBe(true);
      if (context.ok) {
        expect(context.issues.length, `context(${label}) had no structural issue — R1's empty-issue case`).toBeGreaterThan(0);
        expect(context.issues.join(" ")).toContain("must be a plain object");
        assertJsonInvariant(context, `context(${label})`);
      }
      // …and validation never accepts them.
      expect(validateReplayContext(value).ok, label).toBe(false);
    }
  });
});

// ─── 6. the truthful captured-record guard (R2) ─────────────────────────────

describe("B11.7 §B — isCapturedRecord is truthful (R2)", () => {
  it("6: every required case", () => {
    // Foreign values — NONE was produced by capture, so all are false.
    expect(isCapturedRecord({}), "ordinary object").toBe(false);
    expect(isCapturedRecord(Object.freeze({})), "frozen caller object").toBe(false);
    expect(isCapturedRecord(new Date()), "Date instance").toBe(false);
    expect(isCapturedRecord(new Proxy({}, {})), "benign proxy").toBe(false);
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => isCapturedRecord(proxy), "revoked proxy must not throw").not.toThrow();
    expect(isCapturedRecord(proxy), "revoked proxy").toBe(false);

    // Capture outputs — the only true cases, and only for records.
    const captured = capturePlainJson({ nested: { child: 1 } }, "$");
    expect(captured.ok).toBe(true);
    if (captured.ok) {
      expect(isCapturedRecord(captured.value), "captured object").toBe(true);
      expect(isCapturedRecord((captured.value as Rec).nested), "nested captured object").toBe(true);
    }
    const capturedArray = capturePlainJson([1, 2], "$");
    expect(capturedArray.ok).toBe(true);
    if (capturedArray.ok) expect(isCapturedRecord(capturedArray.value), "captured array").toBe(false);

    // The documented distinction: PROJECTION outputs are owned but not
    // captured — their new containers are built by the projector.
    const projected = projectBoardForReplay(createEmptyBoard());
    expect(projected.ok).toBe(true);
    if (projected.ok) {
      // Valid containers in a projection are PROJECTOR-BUILT — owned and
      // frozen, but not captures.
      expect(isCapturedRecord(projected.value), "projected-but-not-captured root").toBe(false);
      expect(isOwnedCapture(projected.value), "projection roots are not registry captures").toBe(false);
      expect(isCapturedRecord((projected.value as Rec).outline), "projector-built child").toBe(false);
    }
    // A WRONG-TYPED carried subtree is the one place captured identity flows
    // into a projection — and it IS a capture (registry-owned, frozen).
    const wrongTyped = createEmptyBoard() as unknown as Rec;
    ((wrongTyped.outline as Rec).origin as Rec).x = { carried: { deep: 1 } };
    const diagnostic = projectBoardForReplay(wrongTyped);
    expect(diagnostic.ok).toBe(true);
    if (diagnostic.ok) {
      const carried = (((diagnostic.value as Rec).outline as Rec).origin as Rec).x;
      expect(isCapturedRecord(carried), "wrong-typed carried subtree is a capture").toBe(true);
      expect(isOwnedCapture(carried)).toBe(true);
    }
  });
});

// ─── 7. the successful-result JSON invariant (§C) ───────────────────────────

describe("B11.7 §C — every ok:true result satisfies the JSON invariant", () => {
  it("7: primitives, boards, contexts, committed contexts, and special keys", () => {
    // Every supported primitive root.
    for (const [label, value] of JSON_PRIMITIVES) {
      assertJsonInvariant(projectBoardForReplay(value), `board root ${label}`);
      assertJsonInvariant(projectReplayContext(value), `context root ${label}`);
    }

    // Valid and invalid boards.
    assertJsonInvariant(projectBoardForReplay(createEmptyBoard()), "valid board");
    const invalidBoard = createEmptyBoard() as unknown as Rec;
    invalidBoard.unknownKey = { nested: [1] };
    invalidBoard.formatVersion = "wrong";
    assertJsonInvariant(projectBoardForReplay(invalidBoard), "invalid board");

    // Valid and invalid contexts.
    const context = clone(capsuleFor("e06c-selection-valid").context);
    assertJsonInvariant(projectReplayContext(context), "valid context");
    const invalidContext = { ...clone(capsuleFor("e03-valid-board").context), extraChannel: 1 };
    assertJsonInvariant(projectReplayContext(invalidContext), "invalid context");

    // All committed evaluation contexts.
    for (const evaluationCase of buildEvaluationCases(pins)) {
      assertJsonInvariant(projectReplayContext(clone(evaluationCase.capsule.context)), `committed context ${evaluationCase.caseId}`);
    }

    // Special keys, including __proto__ preservation from B11.5.
    const board = createEmptyBoard() as unknown as Rec;
    const footprint = {
      id: "fp1", ref: "R1", footprintId: "lib:R", at: { x: 0, y: 0 }, rotationDeg: 0, side: "top",
      padNets: {} as Rec,
      def: { libName: "l", name: "n", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "()" },
    };
    Object.defineProperty(footprint.padNets, "__proto__", { value: 42, enumerable: true, writable: true, configurable: true });
    Object.defineProperty(footprint.padNets, "constructor", { value: 7, enumerable: true, writable: true, configurable: true });
    Object.defineProperty(footprint.padNets, "prototype", { value: 9, enumerable: true, writable: true, configurable: true });
    (board.footprints as unknown[]).push(footprint);
    const special = projectBoardForReplay(board);
    assertJsonInvariant(special, "board with __proto__/constructor/prototype keys");
    if (special.ok) {
      const padNets = (((special.value as Rec).footprints as Rec[])[0]!).padNets as Rec;
      expect(Object.getOwnPropertyDescriptor(padNets, "__proto__")?.value).toBe(42);
      expect(Object.getOwnPropertyDescriptor(padNets, "constructor")?.value).toBe(7);
      expect(Object.getOwnPropertyDescriptor(padNets, "prototype")?.value).toBe(9);
      expect(Object.getPrototypeOf(padNets) === Object.prototype || Object.getPrototypeOf(padNets) === null).toBe(true);
    }
  });
});

// ─── 8–12. preserved invariants ─────────────────────────────────────────────

describe("B11.7 §D — every prior closure is preserved", () => {
  it("8: no successful projection shares caller object identity", () => {
    const board = createEmptyBoard() as unknown as Rec;
    ((board.outline as Rec).origin as Rec).x = { wrong: { typed: true } };
    const projected = projectBoardForReplay(board);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const callerObjects = new Set<object>();
    const collect = (value: unknown): void => {
      if (value === null || typeof value !== "object" || callerObjects.has(value)) return;
      callerObjects.add(value);
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && "value" in descriptor) collect(descriptor.value);
      }
    };
    collect(board);
    const check = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(callerObjects.has(value)).toBe(false);
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && "value" in descriptor) check(descriptor.value);
      }
    };
    check(projected.value);
  });

  it("9: hostile-proxy totality remains green across the projection surface", () => {
    const families: Array<() => unknown> = [
      () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; },
      () => new Proxy({}, { ownKeys() { throw new Error("x"); }, getOwnPropertyDescriptor() { throw new Error("x"); }, getPrototypeOf() { throw new Error("x"); } }),
      () => { let calls = 0; return new Proxy([1, 2], { ownKeys(target) { calls += 1; if (calls > 1) throw new Error("stateful"); return Reflect.ownKeys(target); } }); },
    ];
    for (const make of families) {
      for (const run of [projectBoardForReplay, projectCapturedBoard, projectReplayContext, validateBoardShape, isCapturedRecord, isOwnedCapture]) {
        expect(() => run(make())).not.toThrow();
      }
    }
  });

  it("10: the B11.6 counterexamples remain closed", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const refused = projectBoardForReplay(proxy);
    expect(refused.ok).toBe(false);
    expect(Object.values(refused).some((part) => Object.is(part, proxy))).toBe(false);
    expect(projectReplayContext(proxy).ok).toBe(false);
    expect(validateReplayContext(proxy).ok).toBe(false);
  });

  it("11: all 19 evaluation capsules validate and retain their pins", async () => {
    for (const evaluationCase of buildEvaluationCases(pins)) {
      expect(validateReplayCapsule(evaluationCase.capsule), evaluationCase.caseId).toEqual([]);
      const outcome = await replayCapsule(evaluationCase.capsule, { ...evaluationCase.options, computeOnly: true });
      expect(outcome.traceDigest, evaluationCase.caseId).toBe(pins[evaluationCase.caseId]);
    }
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(12); // B15.3: + sirkit.pcb.propose-bounded-edit
  });

  it("12: no B11 test writes repository paths", () => {
    const writers = ["writeFile" + "Sync", "rm" + "Sync", "mkdir" + "Sync", "appendFile" + "Sync", "unlink" + "Sync", "cp" + "Sync", "createWriteStream"];
    const scan = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) { scan(path); continue; }
        if (!/^b11.*\.test\.tsx?$/.test(name)) continue;
        const source = readFileSync(path, "utf8");
        for (const writer of writers) expect(source.includes(`${writer}(`), `${name}: ${writer}`).toBe(false);
      }
    };
    scan(join(ROOT, "app", "lib", "agent", "__tests__"));
    scan(join(ROOT, "app", "api", "chat", "__tests__"));
  });
});
