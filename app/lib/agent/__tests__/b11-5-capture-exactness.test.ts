/**
 * B11.5 — permanent regressions for capture exactness, diagnostic redaction,
 * and true validator totality.
 *
 * Every counterexample here was reproduced against production code BEFORE the
 * fix (see artifacts/ai-control-plane-b11-5/pre-edit-counterexamples.md).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { capturePlainJson, scanPlainJson } from "../plain-capture";
import { REDACTED_KEY_SEGMENT, redactPathSegment } from "../redaction";
import { projectBoardForReplay, validateBoardShape } from "../pcb-shape-projection";
import { projectReplayContext, validateReplayContext } from "../replay-context";
import {
  parseReplayCapsule, replayCapsule, ReplayCapsuleInvalidError,
  validateReplayCapsule, type ReplayCapsule,
} from "../replay-capsule";
import { findNonPlainJsonPath, findSecretShapedPath, validateAgentRunTrace } from "../trace";
import { buildEvaluationCases } from "../evaluation-cases";
import { canonicalJson } from "../../engineering/stable";
import { createEmptyBoard } from "../../pcb/types";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const pins = (JSON.parse(readFileSync(join(ROOT, "artifacts", "ai-control-plane-b11", "replay-trace-pins.json"), "utf8")) as { pins: Record<string, string> }).pins;
type Rec = Record<string, unknown>;
const capsuleFor = (caseId: string): ReplayCapsule => buildEvaluationCases(pins).find((item) => item.caseId === caseId)!.capsule;
const clone = <T>(value: T): T => structuredClone(value);

/** Install an own ENUMERABLE DATA property — a plain assignment would invoke
 *  the legacy `__proto__` setter instead of creating one. */
function withOwnProto<T extends object>(target: T, value: unknown): T {
  Object.defineProperty(target, "__proto__", { value, enumerable: true, writable: true, configurable: true });
  return target;
}
const ownProtoValue = (target: object): unknown => Object.getOwnPropertyDescriptor(target, "__proto__")?.value;
const hasOwnProto = (target: object): boolean => Object.prototype.hasOwnProperty.call(target, "__proto__");

/** A footprint whose `padNets` Record carries an own `__proto__` key. */
function boardWithProtoPadNets(protoValue: unknown): Rec {
  const board = createEmptyBoard() as unknown as Rec;
  (board.footprints as unknown[]).push({
    id: "fp1", ref: "R1", footprintId: "lib:R_0805", at: { x: 0, y: 0 }, rotationDeg: 0, side: "top",
    padNets: withOwnProto({ "1": 1 } as Rec, protoValue),
    def: {
      libName: "lib", name: "R_0805",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "()",
    },
  });
  return board;
}

// ─── 1–6. capture exactness ─────────────────────────────────────────────────

describe("B11.5 §A — capture preserves every accepted own key (R1)", () => {
  it("1: a NUMERIC __proto__ is retained as an own data property", () => {
    const captured = capturePlainJson(withOwnProto({ keep: 1 } as Rec, 42), "$");
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const snapshot = captured.value as Rec;
    expect(hasOwnProto(snapshot), "the own __proto__ key was silently discarded").toBe(true);
    expect(ownProtoValue(snapshot)).toBe(42);
    expect(snapshot.keep).toBe(1);
  });

  it("2: an OBJECT-valued __proto__ does not change the captured prototype", () => {
    const injected = { injected: true };
    const captured = capturePlainJson(withOwnProto({ keep: 1 } as Rec, injected), "$");
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const snapshot = captured.value as Rec;
    expect(Object.getPrototypeOf(snapshot), "the captured prototype was replaced").toBe(Object.prototype);
    expect(hasOwnProto(snapshot)).toBe(true);
    expect(ownProtoValue(snapshot)).toEqual(injected);
    // …and it is a COPY: the caller's object is not shared.
    expect(ownProtoValue(snapshot)).not.toBe(injected);
  });

  it("3: the captured __proto__ child is deeply frozen", () => {
    const captured = capturePlainJson(withOwnProto({ keep: 1 } as Rec, { nested: { deep: [1, 2] } }), "$");
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const child = ownProtoValue(captured.value as Rec) as Rec;
    expect(Object.isFrozen(captured.value)).toBe(true);
    expect(Object.isFrozen(child)).toBe(true);
    expect(Object.isFrozen(child.nested)).toBe(true);
    expect(Object.isFrozen((child.nested as Rec).deep)).toBe(true);
  });

  it("4: constructor and prototype keys round-trip", () => {
    const source = { constructor: 1, prototype: 2, ordinary: 3, valueOf: "text", hasOwnProperty: null };
    const captured = capturePlainJson(source, "$");
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const snapshot = captured.value as Rec;
    for (const key of Object.keys(source)) {
      expect(Object.prototype.hasOwnProperty.call(snapshot, key), key).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(source);
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
  });

  it("5: a padNets Record containing own __proto__: 42 survives validateReplayContext exactly", () => {
    const board = boardWithProtoPadNets(42);
    expect(validateBoardShape(board), "Record<string, number> permits the key").toEqual([]);
    const context = { ...capsuleFor("e03-valid-board").context, board };
    const result = validateReplayContext(context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const padNets = (((result.context.board as unknown as Rec).footprints as Rec[])[0]!).padNets as Rec;
    expect(hasOwnProto(padNets), "the accepted key was SILENTLY DISCARDED").toBe(true);
    expect(ownProtoValue(padNets)).toBe(42);
    expect(Object.getPrototypeOf(padNets)).toBe(Object.prototype);
  });

  it("6: JSON and canonical round-trip equality includes those keys", () => {
    const board = boardWithProtoPadNets(42);
    // The projector must not lose it either — otherwise the round-trip
    // invariant would refuse a board the type graph legitimately permits.
    const projectedBoard = projectBoardForReplay(board);
    expect(projectedBoard.ok).toBe(true);
    if (!projectedBoard.ok) return;
    expect(canonicalJson(projectedBoard.value)).toBe(canonicalJson(board));
    expect(JSON.stringify(projectedBoard.value)).toContain('"__proto__":42');

    const context = { ...capsuleFor("e03-valid-board").context, board };
    const result = validateReplayContext(context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projectedContext = projectReplayContext(result.context);
    expect(projectedContext.ok).toBe(true);
    if (projectedContext.ok) expect(canonicalJson(projectedContext.value)).toBe(canonicalJson(result.context));
    expect(JSON.stringify(result.context)).toContain('"__proto__":42');
  });

  it("an object-valued __proto__ inside a real context does not poison any prototype", () => {
    const board = boardWithProtoPadNets({ polluted: true });
    const context = { ...capsuleFor("e03-valid-board").context, board };
    const result = validateReplayContext(context);
    // The value type is `number`, so this is a TYPE violation and must refuse —
    // but it must refuse cleanly, without prototype injection anywhere.
    expect(result.ok).toBe(false);
    expect(({} as Rec).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Rec).polluted).toBeUndefined();
  });
});

// ─── 7. diagnostic redaction ────────────────────────────────────────────────

describe("B11.5 §B — diagnostics never carry untrusted values or key content (R2)", () => {
  const MARKER = `sk-${"live"}-B115SYNTHETIC0000`;
  const hostileKey = `apiKey=${MARKER}`;

  it("7: a synthetic marker in a KEY NAME never reaches issues or the thrown message", async () => {
    const document: Rec = {};
    document[hostileKey] = () => 1; // the VALUE causes the refusal
    const captured = capturePlainJson(document, "capsule");
    expect(captured.ok).toBe(false);
    if (captured.ok) return;
    expect(JSON.stringify(captured.issues)).not.toContain("B115SYNTHETIC");
    expect(JSON.stringify(captured.issues)).toContain(REDACTED_KEY_SEGMENT);

    const capsule = { ...capsuleFor("e03-valid-board") } as unknown as Rec;
    capsule[hostileKey] = () => 1;
    const issues = validateReplayCapsule(capsule);
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain("B115SYNTHETIC");
    expect(JSON.stringify(issues)).not.toContain("apiKey");

    let message = "";
    try {
      await replayCapsule(capsule as unknown as ReplayCapsule, { computeOnly: true });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("REPLAY_CAPSULE_INVALID");
    expect(message).not.toContain("B115SYNTHETIC");
    expect(message).not.toContain("apiKey");
  });

  it("the same marker never reaches context, trace, board or secret-scan diagnostics", () => {
    const board = createEmptyBoard() as unknown as Rec;
    (board as Rec)[hostileKey] = 1;
    const boardIssues = validateBoardShape(board);
    expect(boardIssues.length).toBeGreaterThan(0);
    expect(JSON.stringify(boardIssues)).not.toContain("B115SYNTHETIC");

    const contextResult = validateReplayContext({ ...capsuleFor("e03-valid-board").context, [hostileKey]: 1 });
    expect(contextResult.ok).toBe(false);
    if (!contextResult.ok) expect(JSON.stringify(contextResult.issues)).not.toContain("B115SYNTHETIC");

    const traceIssues = validateAgentRunTrace({ [hostileKey]: 1 } as never);
    expect(traceIssues.length).toBeGreaterThan(0);
    expect(JSON.stringify(traceIssues)).not.toContain("B115SYNTHETIC");

    const secret = findSecretShapedPath({ [hostileKey]: "value" });
    expect(secret).not.toBeNull();
    expect(secret!).not.toContain("B115SYNTHETIC");

    const nonPlain = findNonPlainJsonPath({ [hostileKey]: () => 1 }, "$");
    expect(nonPlain).not.toBeNull();
    expect(nonPlain!).not.toContain("B115SYNTHETIC");
  });

  it("redaction is deterministic, bounded, and still useful", () => {
    expect(redactPathSegment("apiKey")).toBe(REDACTED_KEY_SEGMENT);
    expect(redactPathSegment("apiKey")).toBe(redactPathSegment("apiKey")); // deterministic
    // An ordinary key survives unchanged — diagnostics stay readable.
    for (const key of ["formatVersion", "tracks", "innocentUnknownKey", "__proto__", "constructor"]) {
      expect(redactPathSegment(key), key).toBe(key);
    }
    expect(redactPathSegment("x".repeat(500)).length).toBeLessThanOrEqual(60);
    // Control characters and non-ASCII cannot carry a terminal payload.
    expect(redactPathSegment("a\u001b[31mb‮")).toBe("a?[31mb?");
    // There is ONE classifier: the capture path and the trace path agree.
    expect(scanPlainJson({ apiKey: () => 1 }, "$")).toContain(REDACTED_KEY_SEGMENT);
  });
});

// ─── 8. true totality ───────────────────────────────────────────────────────

describe("B11.5 §C — stateful proxies cannot throw from any public boundary (R3)", () => {
  const families: Array<[string, () => unknown]> = [
    ["stateful ownKeys", () => { let calls = 0; return new Proxy([1, 2], { ownKeys(target) { calls += 1; if (calls > 1) throw new Error("stateful ownKeys"); return Reflect.ownKeys(target); } }); }],
    ["stateful getPrototypeOf", () => { let calls = 0; return new Proxy([1], { getPrototypeOf(target) { calls += 1; if (calls > 1) throw new Error("stateful getPrototypeOf"); return Reflect.getPrototypeOf(target); } }); }],
    ["stateful getOwnPropertyDescriptor", () => { let calls = 0; return new Proxy({ a: 1, b: 2 }, { getOwnPropertyDescriptor(target, key) { calls += 1; if (calls > 1) throw new Error("stateful gOPD"); return Reflect.getOwnPropertyDescriptor(target, key); } }); }],
    ["stateful get/length", () => { let calls = 0; return new Proxy([1, 2, 3], { get(target, key, receiver) { calls += 1; if (calls > 2) throw new Error("stateful get"); return Reflect.get(target, key, receiver); } }); }],
    ["stateful has/defineProperty", () => { let calls = 0; return new Proxy({ a: 1 }, { has() { throw new Error("stateful has"); }, ownKeys(target) { calls += 1; if (calls > 1) throw new Error("stateful ownKeys"); return Reflect.ownKeys(target); } }); }],
    ["nested stateful", () => ({ outer: { inner: (() => { let calls = 0; return new Proxy([1, 2], { ownKeys(target) { calls += 1; if (calls > 1) throw new Error("stateful ownKeys"); return Reflect.ownKeys(target); } }); })() } })],
    ["revoked", () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; }],
    ["all-throwing", () => new Proxy({}, { ownKeys() { throw new Error("x"); }, getOwnPropertyDescriptor() { throw new Error("x"); }, getPrototypeOf() { throw new Error("x"); }, get() { throw new Error("x"); } })],
  ];

  const boundaries: Array<[string, (value: unknown) => unknown]> = [
    ["capturePlainJson", (value) => capturePlainJson(value, "$")],
    ["scanPlainJson", (value) => scanPlainJson(value, "$")],
    ["findNonPlainJsonPath", (value) => findNonPlainJsonPath(value, "$")],
    ["findSecretShapedPath", (value) => findSecretShapedPath(value, "$")],
    ["validateBoardShape", (value) => validateBoardShape(value)],
    ["projectBoardForReplay", (value) => projectBoardForReplay(value)],
    ["validateAgentRunTrace", (value) => validateAgentRunTrace(value as never)],
    ["validateReplayCapsule", (value) => validateReplayCapsule(value)],
    ["parseReplayCapsule", (value) => parseReplayCapsule(value)],
    ["validateReplayContext", (value) => validateReplayContext(value)],
  ];

  it("8: every claimed-total boundary refuses instead of throwing, for every proxy family", () => {
    for (const [family, make] of families) {
      for (const [name, run] of boundaries) {
        expect(() => run(make()), `${name}(${family})`).not.toThrow();
      }
    }
  });

  it("a proxy is never treated as safe because one preliminary trap succeeded", () => {
    // `ownKeys` succeeds once — exactly the shape that defeated the previous
    // guard-then-re-enumerate implementation.
    let calls = 0;
    const oneShot = new Proxy({ a: 1 }, {
      ownKeys(target) { calls += 1; if (calls > 1) throw new Error("stateful ownKeys"); return Reflect.ownKeys(target); },
    });
    const issue = findNonPlainJsonPath(oneShot, "$");
    // Either it captured cleanly from the single enumeration, or it refused —
    // but it must never throw, and it must never return a hostile projection.
    expect(typeof issue === "string" || issue === null).toBe(true);
    const captured = capturePlainJson(oneShot, "$");
    if (captured.ok) {
      expect(captured.value).not.toBe(oneShot);
      expect(Object.isFrozen(captured.value)).toBe(true);
    }
  });

  it("a hostile caller proxy is never returned as if it were a safe projection", () => {
    const hostile = new Proxy({ schema: "sirkit.agent-replay-context.v2" }, { get() { throw new Error("get trap"); } });
    const result = validateReplayContext(hostile);
    if (result.ok) expect(Object.is(result.context, hostile)).toBe(false);
    const projected = projectBoardForReplay(hostile);
    // [B11.6] this proxy traps only `get`, which capture never invokes — so it
    // captures to an OWNED copy. The projection may therefore succeed with
    // issues, but on EVERY path it must carry no caller identity and no
    // executable behaviour: reading the result can never fire the get trap.
    if (projected.ok) {
      // `Object.is`, not a matcher: vitest probes matcher arguments for
      // asymmetric matchers, which would itself fire the get trap.
      expect(Object.is(projected.value, hostile)).toBe(false);
      expect(projected.issues.length).toBeGreaterThan(0);
      expect(() => JSON.stringify(projected.value)).not.toThrow();
      expect(Object.isFrozen(projected.value)).toBe(true);
    } else {
      expect(projected.issues.length).toBeGreaterThan(0);
    }
    expect(validateBoardShape(hostile).length).toBeGreaterThan(0);
    // A REVOKED proxy, by contrast, cannot be captured at all: explicit failure.
    const { proxy: revokedBoard, revoke } = Proxy.revocable({}, {});
    revoke();
    const refused = projectBoardForReplay(revokedBoard);
    expect(refused.ok).toBe(false);
  });
});

// ─── 9–12. preserved B11.4 closures ─────────────────────────────────────────

describe("B11.5 §D — every B11.4 closure is preserved", () => {
  it("9: toJSON and accessor counters remain zero", async () => {
    const capsule = clone(capsuleFor("e03-valid-board"));
    let hookCalls = 0;
    let getterReads = 0;
    const outline = capsule.context.board!.outline as unknown as Rec;
    outline.toJSON = function selfDeleting(this: Rec) { hookCalls += 1; delete this.toJSON; return this; };
    const second = clone(capsuleFor("e03-valid-board"));
    Object.defineProperty(second.context.board!.outline, "origin", {
      get: () => { getterReads += 1; return { x: 0, y: 0 }; }, enumerable: true, configurable: true,
    });

    expect(validateReplayCapsule(capsule).length).toBeGreaterThan(0);
    await expect(replayCapsule(capsule, { computeOnly: true })).rejects.toThrow(ReplayCapsuleInvalidError);
    expect(hookCalls).toBe(0);
    expect(outline.toJSON).not.toBeUndefined();

    expect(validateReplayCapsule(second).length).toBeGreaterThan(0);
    expect(getterReads).toBe(0);
  });

  it("10: caller mutation after replayCapsule remains irrelevant", async () => {
    const capsule = clone(capsuleFor("e10-proposal-only"));
    const pending = replayCapsule(capsule, { computeOnly: true });
    capsule.steps[capsule.steps.length - 1] = { ...capsule.steps[capsule.steps.length - 1]!, text: "B115-MUTATED" };
    (capsule.context.board!.nets as unknown as Rec[]).push({ id: 77, name: "B115-INJECTED" } as never);
    (capsule.expected as Rec).traceDigest = "eng1-B115-FORGED";
    const outcome = await pending;
    expect(JSON.stringify(outcome.events)).not.toContain("B115-");
    expect(outcome.traceDigest).toBe(pins["e10-proposal-only"]);
  });

  it("sparse/malformed arrays still refuse, and all 19 pins hold", async () => {
    const board = createEmptyBoard() as unknown as Rec;
    const sparse: unknown[] = [];
    sparse[3] = { id: "t", layer: "copperTop", width: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 0 };
    board.tracks = sparse;
    expect(validateBoardShape(board).join(" ")).toContain("sparse");

    for (const evaluationCase of buildEvaluationCases(pins)) {
      expect(validateReplayCapsule(evaluationCase.capsule), evaluationCase.caseId).toEqual([]);
      const outcome = await replayCapsule(evaluationCase.capsule, { ...evaluationCase.options, computeOnly: true });
      expect(outcome.traceDigest, evaluationCase.caseId).toBe(pins[evaluationCase.caseId]);
    }
  });

  it("static exposure remains exactly the intentional agent-exposed set (ELEVEN read/propose tools when written; the set has since grown by reviewed moves, B20-A4 among them, and the assertion counts the set itself)", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
  });

  it("12: NO test anywhere in the repository writes under app/, lib/, scripts/ or artifacts/", () => {
    const writers = ["writeFile" + "Sync", "rm" + "Sync", "mkdir" + "Sync", "appendFile" + "Sync", "unlink" + "Sync", "cp" + "Sync", "rmdir" + "Sync", "createWriteStream"];
    /**
     * A small set of test files calls a writing primitive. None is excluded
     * blindly — each is admitted only while its JUSTIFICATION still holds,
     * asserted below. If someone removes the `tmpdir()` confinement or the
     * `UPDATE_GOLDEN` guard, this gate fails.
     */
    const justified: Record<string, (source: string) => boolean> = {
      // Writes only inside `mkdtempSync(join(tmpdir(), …))` — an OS temp dir.
      "kicad-cli-oracle.test.ts": (source) => source.includes("mkdtempSync(join(tmpdir()"),
      // Writes the golden fixture ONLY under an explicit opt-in env flag.
      "kicad-write-pcb.test.ts": (source) => source.includes("if (process.env.UPDATE_GOLDEN)"),
      // [B14.4] builds its scan-surface fixture EXCLUSIVELY under an OS temp
      // scratch root; EVERY write-primitive call line in the file must be
      // rooted at that scratchRoot, or the admission lapses.
      "b14-4-ast-import-gates.test.ts": (source) =>
        source.includes("const scratchRoot = join(tmpdir(), `b14-4-scan-surface-")
        && !source.split("\n").some((line) =>
          /(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream)\s*\(/.test(line)
          && !line.includes("scratchRoot")),
      // [B16.0.4 §A] writes on-disk factory-fixture modules EXCLUSIVELY under an
      // OS temp scratch root (`mkdtempSync(join(tmpdir(), "b16-0-4-factory-scan-"))`);
      // EVERY write-primitive line must be rooted at that `scratchRoot`.
      "b16-0-4-authorization-and-body-gates.test.ts": (source) =>
        source.includes('mkdtempSync(join(tmpdir(), "b16-0-4-factory-scan-"))')
        && !source.split("\n").some((line) =>
          /(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream)\s*\(/.test(line)
          && !line.includes("scratchRoot")),
      // [B16.0.5 §A] writes re-export-laundering fixture modules EXCLUSIVELY
      // under an OS temp scratch root; EVERY write-primitive line rooted at it.
      "b16-0-5-analyzer-hardening.test.ts": (source) =>
        source.includes('mkdtempSync(join(tmpdir(), "b16-0-5-reexport-scan-"))')
        && !source.split("\n").some((line) =>
          /(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream)\s*\(/.test(line)
          && !line.includes("scratchRoot")),
      // [B16.0.6 §C] writes provenance-fixture modules EXCLUSIVELY under an OS
      // temp scratch root; EVERY write-primitive line rooted at it.
      "b16-0-6-analyzer-hardening.test.ts": (source) =>
        source.includes('mkdtempSync(join(tmpdir(), "b16-0-6-provenance-scan-"))')
        && !source.split("\n").some((line) =>
          /(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream)\s*\(/.test(line)
          && !line.includes("scratchRoot")),
      // [B16-B] copies the migration folder into `mkdtempSync(join(tmpdir(), "sirkit-manifest-"))`
      // scratch dirs (`dir`, `dir2`) to reproduce checksum drift / unregistered
      // files; EVERY write-primitive line must be rooted at one of them.
      "b16-b-migrations.test.ts": (source) =>
        source.includes('mkdtempSync(join(tmpdir(), "sirkit-manifest-"))')
        && !source.split("\n").some((line) =>
          /(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream)\s*\(/.test(line)
          && !/\bdir2?\b/.test(line)),
      // [B16-B] writes a throwaway drizzle-kit config EXCLUSIVELY under the
      // git-ignored `node_modules/.cache/sirkit-b16b-export` (the config must
      // resolve drizzle-kit from the repository's node_modules); never under
      // app/, lib/, scripts/ or artifacts/. EVERY write-primitive line is rooted
      // at that cache (`cache`) or the per-run dir inside it (`config`).
      "b16-b-schema-parity.test.ts": (source) =>
        source.includes('join(process.cwd(), "node_modules", ".cache", "sirkit-b16b-export")')
        && !source.split("\n").some((line) =>
          /(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream)\s*\(/.test(line)
          && !/\b(?:cache|config)\b/.test(line)),
      // [B19-E E4] builds throwaway KiCad library fixtures (and a symlink or junction that leaves the library) EXCLUSIVELY
      // under OS temp scratch roots `mkdtempSync(path.join(tmpdir(), "b19e-e4-kicad-…"))` (`root`, and `symbols` inside it);
      // EVERY write-primitive line — the symlink included — must be rooted at one of them, or the admission lapses.
      "b19-e-publication-boundaries.test.ts": (source) =>
        source.includes('mkdtempSync(path.join(tmpdir(), "b19e-e4-kicad-')
        && !source.split("\n").some((line) =>
          /(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream|symlinkSync)\s*\(/.test(line)
          && !/\b(?:root|symbols)\b/.test(line)),
      // [B22 lead, 2026-10-02] B22-A1 writes a stand-in JAR and reader files EXCLUSIVELY under its OS temp scratch root
      // `mkdtempSync(join(tmpdir(), "sirkit-b22a1-tools-"))` (`WORK`, `JAR` and `path` inside it), and its faked FreeRouting writes the
      // session file at the output path the runner passes (`args[out + 1]`, inside the runner's OS temp directory); EVERY write-primitive
      // line must be rooted at one of them, or the admission lapses. (Found by the lead: B22-A1 added these writes and its gates did not
      // run this suite.)
      "b22-a1-tool-output-bounds.test.ts": (source) =>
        source.includes('mkdtempSync(join(tmpdir(), "sirkit-b22a1-tools-"))')
        && !source.split("\n").some((line) =>
          /(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream|symlinkSync)\s*\(/.test(line)
          && !/\b(?:WORK|JAR|path)\b|args\[out \+ 1\]/.test(line)),
      // [B22 lead, 2026-10-02] B22-A2 builds install-tree fixtures EXCLUSIVELY under OS temp scratch roots
      // `mkdtempSync(join(tmpdir(), "sirkit-b22-a2-tree-"))` (`root`, `full` and `first` inside one, removed through `temporaryRoots`);
      // EVERY write-primitive line must be rooted at one of them, or the admission lapses.
      "b22-a2-runtime-profile.test.ts": (source) =>
        source.includes('mkdtempSync(join(tmpdir(), "sirkit-b22-a2-tree-"))')
        && !source.split("\n").some((line) =>
          /(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream|symlinkSync)\s*\(/.test(line)
          && !/\b(?:root|full|first)\b/.test(line)),
    };

    const offenders: string[] = [];
    const scan = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        if (name === "node_modules" || name === ".next" || name === ".git") continue;
        const path = join(directory, name);
        if (statSync(path).isDirectory()) { scan(path); continue; }
        if (!/\.test\.tsx?$/.test(name)) continue;
        if (name === "b11-5-capture-exactness.test.ts") continue; // this file names the primitives
        const source = readFileSync(path, "utf8");
        const writes = writers.filter((writer) => source.includes(`${writer}(`));
        if (writes.length === 0) continue;
        const justification = justified[name];
        if (justification !== undefined) {
          expect(justification(source), `${name}: its documented justification no longer holds`).toBe(true);
          continue;
        }
        for (const writer of writes) offenders.push(`${name}: ${writer}`);
      }
    };
    for (const root of ["app", "lib", "scripts"]) scan(join(ROOT, root));
    expect(offenders).toEqual([]);

    // Every B11 suite in particular imports no writing primitive at all.
    const agentTests = join(ROOT, "app", "lib", "agent", "__tests__");
    for (const name of readdirSync(agentTests)) {
      if (!/^b11.*\.test\.tsx?$/.test(name)) continue;
      const source = readFileSync(join(agentTests, name), "utf8");
      for (const writer of writers) {
        if (name === "b11-5-capture-exactness.test.ts") continue;
        expect(source.includes(`${writer}(`), `${name}: ${writer}`).toBe(false);
      }
    }
  });
});
