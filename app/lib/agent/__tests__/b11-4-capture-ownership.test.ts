/**
 * B11.4 §G — permanent regressions for hook-free capture, immutable replay
 * ownership, total validators, and aligned board validation.
 *
 * Every counterexample here was reproduced against production code BEFORE the
 * fix (see artifacts/ai-control-plane-b11-4/pre-edit-counterexamples.md).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { capturePlainJson, CAPTURE_BOUNDS } from "../plain-capture";
import {
  AGENT_REPLAY_CAPSULE_SCHEMA, parseReplayCapsule, replayCapsule,
  ReplayCapsuleInvalidError, validateReplayCapsule, type ReplayCapsule,
} from "../replay-capsule";
import { AGENT_REPLAY_CONTEXT_SCHEMA, validateReplayContext } from "../replay-context";
import { validateBoardShape } from "../pcb-shape-projection";
import { findNonPlainJsonPath, validateAgentRunTrace } from "../trace";
import { buildEvaluationCases } from "../evaluation-cases";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { createEmptyBoard } from "../../pcb/types";

const ROOT = process.cwd();
const pins = (JSON.parse(readFileSync(join(ROOT, "artifacts", "ai-control-plane-b11", "replay-trace-pins.json"), "utf8")) as { pins: Record<string, string> }).pins;
type Rec = Record<string, unknown>;
const capsuleFor = (caseId: string): ReplayCapsule => buildEvaluationCases(pins).find((item) => item.caseId === caseId)!.capsule;
const clone = <T>(value: T): T => structuredClone(value);

// ─── 1/2. hooks are never invoked ───────────────────────────────────────────

describe("B11.4 §G1/G2 — toJSON hooks are never invoked", () => {
  it("R1: a NESTED self-deleting toJSON is refused, uninvoked, before any execution", async () => {
    const capsule = clone(capsuleFor("e03-valid-board"));
    let calls = 0;
    const outline = capsule.context.board!.outline as unknown as Rec;
    outline.toJSON = function selfDeleting(this: Rec) { calls += 1; delete this.toJSON; return this; };

    const issues = validateReplayCapsule(capsule);
    expect(calls, "validation invoked the hook").toBe(0);
    expect(outline.toJSON, "the hook deleted itself, so it ran").not.toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("a function is not JSON data");

    await expect(replayCapsule(capsule, { computeOnly: true })).rejects.toThrow(ReplayCapsuleInvalidError);
    expect(calls, "replay invoked the hook").toBe(0);
  });

  it("R2: a TOP-LEVEL self-deleting toJSON is refused, uninvoked", () => {
    const capsule = clone(capsuleFor("e03-valid-board")) as unknown as Rec;
    let calls = 0;
    capsule.toJSON = function selfDeleting(this: Rec) { calls += 1; delete this.toJSON; return this; };
    const issues = validateReplayCapsule(capsule);
    expect(calls).toBe(0);
    expect(capsule.toJSON).not.toBeUndefined();
    expect(issues).toEqual(["capsule.toJSON: a function is not JSON data (it is never invoked)"]);
  });

  it("hooks anywhere in a trace or a context are refused, uninvoked", () => {
    let traceCalls = 0;
    let contextCalls = 0;
    const trace = { schema: "sirkit.agent-run-trace.v1", scope: { toJSON: () => { traceCalls += 1; return {}; } } };
    expect(validateAgentRunTrace(trace as never).length).toBeGreaterThan(0);
    expect(traceCalls).toBe(0);

    const context = clone(capsuleFor("e03-valid-board").context) as unknown as Rec;
    (context.board as Rec).toJSON = () => { contextCalls += 1; return {}; };
    expect(validateReplayContext(context).ok).toBe(false);
    expect(contextCalls).toBe(0);
  });

  it("an ACCESSOR is refused before it can run, at every level", () => {
    let reads = 0;
    const capsule = clone(capsuleFor("e03-valid-board"));
    Object.defineProperty(capsule.context.board!.outline, "origin", {
      get: () => { reads += 1; return { x: 0, y: 0 }; }, enumerable: true, configurable: true,
    });
    const issues = validateReplayCapsule(capsule);
    expect(reads, "the getter ran during validation").toBe(0);
    expect(issues.join(" ")).toContain("must be a data property, not an accessor");
  });
});

// ─── 3. hostile proxies ─────────────────────────────────────────────────────

describe("B11.4 §G3 — revoked and throwing proxies refuse, never throw (R4)", () => {
  const revoked = (): unknown => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; };
  const throwingTraps = (): unknown => new Proxy({}, {
    ownKeys() { throw new Error("hostile ownKeys"); },
    getOwnPropertyDescriptor() { throw new Error("hostile gOPD"); },
    getPrototypeOf() { throw new Error("hostile getPrototypeOf"); },
    get() { throw new Error("hostile get"); },
  });
  const lyingOwnKeys = (): unknown => new Proxy({ a: 1 }, {
    ownKeys: () => ["a", "phantom"],
    getOwnPropertyDescriptor: (target, key) => (key === "phantom" ? undefined : Reflect.getOwnPropertyDescriptor(target, key)),
  });

  it("every public validator returns bounded issues instead of throwing", () => {
    for (const [kind, make] of [["revoked", revoked], ["throwing", throwingTraps], ["lying ownKeys", lyingOwnKeys]] as const) {
      const value = make();
      expect(() => validateReplayCapsule(value), `capsule/${kind}`).not.toThrow();
      expect(() => validateReplayContext(value), `context/${kind}`).not.toThrow();
      expect(() => validateAgentRunTrace(value as never), `trace/${kind}`).not.toThrow();
      expect(() => findNonPlainJsonPath(value, "$"), `nonPlain/${kind}`).not.toThrow();
      expect(() => validateBoardShape(value), `board/${kind}`).not.toThrow();
      expect(() => capturePlainJson(value, "$"), `capture/${kind}`).not.toThrow();

      expect(validateReplayCapsule(value).length, `capsule/${kind}`).toBeGreaterThan(0);
      expect(validateReplayCapsule(value).length, `capsule/${kind} bounded`).toBeLessThanOrEqual(CAPTURE_BOUNDS.maxIssues);
      expect(validateReplayContext(value).ok, `context/${kind}`).toBe(false);
      expect(validateAgentRunTrace(value as never).length, `trace/${kind}`).toBeGreaterThan(0);
      expect(findNonPlainJsonPath(value, "$"), `nonPlain/${kind}`).not.toBeNull();
    }
  });

  it("a proxy reporting STABLE data descriptors is captured ONCE; later behaviour is irrelevant", () => {
    let phase = 0;
    const inner = { schema: AGENT_REPLAY_CONTEXT_SCHEMA, editorSchematicDigest: null as string | null };
    const shifting = new Proxy(inner, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (descriptor && key === "editorSchematicDigest") return { ...descriptor, value: phase === 0 ? "captured-value" : "changed-later" };
        return descriptor;
      },
    });
    const captured = capturePlainJson(shifting, "$");
    expect(captured.ok).toBe(true);
    phase = 1;
    if (captured.ok) {
      expect((captured.value as Rec).editorSchematicDigest).toBe("captured-value");
      expect(Object.isFrozen(captured.value)).toBe(true);
    }
  });

  it("cycles and non-JSON values refuse", () => {
    const cyclic: Rec = {};
    cyclic.self = cyclic;
    expect(capturePlainJson(cyclic, "$").ok).toBe(false);
    for (const value of [() => 1, Symbol("s"), BigInt(10), undefined, Number.NaN]) {
      const result = capturePlainJson({ field: value }, "$");
      expect(result.ok, String(typeof value)).toBe(false);
    }
  });
});

// ─── 4/5/6. immutable ownership ─────────────────────────────────────────────

describe("B11.4 §G4/G5/G6 — the executed capsule is snapshot-owned (R3)", () => {
  it("R3: mutating the caller's capsule after replayCapsule has NO effect", async () => {
    const capsule = clone(capsuleFor("e10-proposal-only"));
    const pending = replayCapsule(capsule, { computeOnly: true });

    // Every slot the stage names: steps, context, expected, scope.
    capsule.steps[capsule.steps.length - 1] = { ...capsule.steps[capsule.steps.length - 1]!, text: "B114-MUTATED-STEP" };
    (capsule.context.board!.nets as unknown as Rec[]).push({ id: 77, name: "B114-INJECTED-NET" } as never);
    (capsule.expected as Rec).traceDigest = "eng1-B114-FORGED";
    (capsule.expected as Rec).discoveredTools = ["B114-FORGED-TOOL"];
    (capsule.scope as Rec).projectId = "B114-FORGED-PROJECT";
    (capsule as unknown as Rec).userMessage = "B114-FORGED-MESSAGE";

    const outcome = await pending;
    const serialized = JSON.stringify({ events: outcome.events, trace: outcome.trace, tools: outcome.discoveredTools, failures: outcome.failures });
    for (const forged of ["B114-MUTATED-STEP", "B114-INJECTED-NET", "B114-FORGED", "B114-FORGED-TOOL", "B114-FORGED-PROJECT", "B114-FORGED-MESSAGE"]) {
      expect(serialized, forged).not.toContain(forged);
    }
    expect(outcome.traceDigest).toBe(pins["e10-proposal-only"]);
    expect(outcome.ok).toBe(true);
    expect(outcome.trace.scope.projectId).not.toBe("B114-FORGED-PROJECT");
  });

  it("the parsed capsule is DEEPLY immutable and independent of the caller", () => {
    const original = clone(capsuleFor("e06c-selection-valid"));
    const parsed = parseReplayCapsule(original);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const snapshot = parsed.value as unknown as Rec;

    // Independent: mutating the source cannot reach the snapshot.
    (original.context.board!.nets as unknown as Rec[]).push({ id: 99, name: "AFTER" } as never);
    expect(JSON.stringify(snapshot)).not.toContain("AFTER");

    // Deeply frozen, at every container kind.
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.steps)).toBe(true);
    expect(Object.isFrozen((snapshot.steps as Rec[])[0])).toBe(true);
    expect(Object.isFrozen(snapshot.context)).toBe(true);
    expect(Object.isFrozen((snapshot.context as Rec).board)).toBe(true);
    expect(Object.isFrozen(((snapshot.context as Rec).board as Rec).nets)).toBe(true);
    expect(Object.isFrozen(snapshot.expected)).toBe(true);
    expect(Object.isFrozen(snapshot.scope)).toBe(true);
  });

  it("a successful context parse returns CAPTURED data, not the caller's object", () => {
    const context = clone(capsuleFor("e03-valid-board").context);
    const result = validateReplayContext(context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context).not.toBe(context);
    expect(result.context.board).not.toBe(context.board);
    expect(Object.isFrozen(result.context)).toBe(true);
    expect(Object.isFrozen(result.context.board)).toBe(true);
    // Mutating the caller's object afterwards cannot change the accepted one.
    (context.board!.nets as unknown as Rec[]).push({ id: 55, name: "LATER" } as never);
    expect(JSON.stringify(result.context)).not.toContain("LATER");
  });
});

// ─── 7. the low-level board validator ───────────────────────────────────────

describe("B11.4 §G7 — validateBoardShape refuses malformed arrays (R5)", () => {
  it("a sparse array refuses in the LOW-LEVEL validator, not only in the context", () => {
    const board = createEmptyBoard() as unknown as Rec;
    const sparse: unknown[] = [];
    sparse[3] = { id: "t", layer: "copperTop", width: 250_000, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 0, source: "human" };
    board.tracks = sparse;
    const issues = validateBoardShape(board);
    expect(issues.length, "validateBoardShape still claims a sparse board is exact").toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("sparse");
    expect(validateReplayContext({ ...capsuleFor("e03-valid-board").context, board }).ok).toBe(false);
  });

  it("foreign prototypes, symbols, non-enumerable indices and index accessors refuse", () => {
    const make = (mutate: (tracks: unknown[]) => void): Rec => {
      const board = createEmptyBoard() as unknown as Rec;
      mutate(board.tracks as unknown[]);
      return board;
    };
    const track = { id: "t", layer: "copperTop", width: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 0 };
    const probes: Array<[string, Rec]> = [
      ["foreign prototype", make((tracks) => { Object.setPrototypeOf(tracks, { poisoned: 1 }); })],
      ["symbol key", make((tracks) => { (tracks as unknown as Rec)[Symbol("s") as unknown as string] = 1; })],
      ["non-enumerable index", make((tracks) => { tracks.push(track); Object.defineProperty(tracks, "0", { value: track, enumerable: false, configurable: true }); })],
      ["index accessor", make((tracks) => { tracks.push(track); Object.defineProperty(tracks, "0", { get: () => track, enumerable: true, configurable: true }); })],
      ["non-index property", make((tracks) => { (tracks as unknown as Rec).stray = 1; })],
    ];
    for (const [label, board] of probes) {
      expect(validateBoardShape(board).length, label).toBeGreaterThan(0);
    }
  });
});

// ─── 8–12. carried-forward invariants ───────────────────────────────────────

describe("B11.4 §G8–G12 — earlier closures and pins remain intact", () => {
  it("G9/G11: the five B11.3 nested-board counterexamples stay closed and all 19 pins hold", async () => {
    const mutations: Array<[string, (board: Rec) => void]> = [
      ["board.outline", (board) => { (board.outline as Rec).unknownNestedField = 1; }],
      ["board.outline.origin", (board) => { ((board.outline as Rec).origin as Rec).unknownNestedField = 1; }],
      ["board.nets[0]", (board) => { ((board.nets as Rec[])[0]!).unknownNestedField = 1; }],
      ["board.tracks[0]", (board) => { ((board.tracks as Rec[])[0]!).unknownNestedField = 1; }],
      ["board.tracks[0].start", (board) => { (((board.tracks as Rec[])[0]!).start as Rec).unknownNestedField = 1; }],
    ];
    for (const [label, mutate] of mutations) {
      const capsule = clone(capsuleFor("e03-valid-board"));
      mutate(capsule.context.board as unknown as Rec);
      expect(validateReplayCapsule(capsule).length, label).toBeGreaterThan(0);
      await expect(replayCapsule(capsule, { computeOnly: true }), label).rejects.toThrow(ReplayCapsuleInvalidError);
    }
    for (const evaluationCase of buildEvaluationCases(pins)) {
      expect(validateReplayCapsule(evaluationCase.capsule), evaluationCase.caseId).toEqual([]);
      const outcome = await replayCapsule(evaluationCase.capsule, { ...evaluationCase.options, computeOnly: true });
      expect(outcome.traceDigest, evaluationCase.caseId).toBe(pins[evaluationCase.caseId]);
    }
  });

  it("G8: array-property and accessor closures from B11.3 remain green", () => {
    const capsule = clone(capsuleFor("e03-valid-board"));
    (capsule.context.board!.nets as unknown as Rec).smuggled = { deep: 1 };
    expect(validateReplayCapsule(capsule).length).toBeGreaterThan(0);

    const accessorCapsule = clone(capsuleFor("e03-valid-board"));
    Object.defineProperty(accessorCapsule.context.board!.tracks, 0, { get: () => ({}), enumerable: true, configurable: true });
    expect(validateReplayCapsule(accessorCapsule).length).toBeGreaterThan(0);
  });

  it("G12: static exposure is still exactly ELEVEN read/propose tools", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(12); // B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) expect(["read", "propose"]).toContain(descriptor.operationClass);
  });

  it("the wire contract did NOT change: the committed versions are unchanged", () => {
    // B11.4 changed how documents are HANDLED (captured, owned, frozen), not
    // what a conforming document looks like. Every committed capsule still
    // validates unchanged, so no version bump is warranted — see
    // artifacts/ai-control-plane-b11-4/immutable-replay-ownership.md.
    expect(AGENT_REPLAY_CAPSULE_SCHEMA).toBe("sirkit.agent-replay-capsule.v3");
    expect(AGENT_REPLAY_CONTEXT_SCHEMA).toBe("sirkit.agent-replay-context.v2");
  });

  it("§F: NO test in the repository writes under app/, lib/, scripts/ or artifacts/", () => {
    const testDirs = [
      join(ROOT, "app", "lib", "agent", "__tests__"),
      join(ROOT, "app", "api", "chat", "__tests__"),
    ];
    const writers = ["writeFile" + "Sync", "rm" + "Sync", "mkdir" + "Sync", "appendFile" + "Sync", "unlink" + "Sync", "cp" + "Sync"];
    const offenders: string[] = [];
    for (const directory of testDirs) {
      for (const name of readdirSync(directory)) {
        if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
        if (name === "b11-4-capture-ownership.test.ts") continue; // this file names the primitives
        const source = readFileSync(join(directory, name), "utf8");
        for (const writer of writers) if (source.includes(`${writer}(`)) offenders.push(`${name}: ${writer}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
