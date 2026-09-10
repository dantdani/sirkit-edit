/**
 * B11.6 — permanent regressions for projection ownership and complete
 * exported-boundary totality.
 *
 * Every counterexample here was reproduced against production code BEFORE the
 * fix (see artifacts/ai-control-plane-b11-6/pre-edit-counterexamples.md).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { capturePlainJson, isCapturedRecord, isOwnedCapture, scanPlainJson } from "../plain-capture";
import { projectBoardForReplay, projectCapturedBoard, validateBoardShape } from "../pcb-shape-projection";
import { projectReplayContext, validateCapturedReplayContext, validateReplayContext } from "../replay-context";
import { findNonPlainJsonPath, findSecretShapedPath, validateAgentRunTrace } from "../trace";
import {
  parseReplayCapsule, replayCapsule, ReplayCapsuleInvalidError,
  validateReplayCapsule, type ReplayCapsule,
} from "../replay-capsule";
import { buildEvaluationCases } from "../evaluation-cases";
import { canonicalJson } from "../../engineering/stable";
import { createEmptyBoard } from "../../pcb/types";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { AGENT_EXPOSABLE_OPERATION_CLASSES, INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const pins = (JSON.parse(readFileSync(join(ROOT, "artifacts", "ai-control-plane-b11", "replay-trace-pins.json"), "utf8")) as { pins: Record<string, string> }).pins;
type Rec = Record<string, unknown>;
const capsuleFor = (caseId: string): ReplayCapsule => buildEvaluationCases(pins).find((item) => item.caseId === caseId)!.capsule;
const clone = <T>(value: T): T => structuredClone(value);
const revoked = (): unknown => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; };

/** Collect every object reachable from a PLAIN value (test inputs are plain
 *  unless stated otherwise; hostile inputs get dedicated non-walking probes). */
function reachableObjects(value: unknown, out = new Set<object>()): Set<object> {
  if (value === null || typeof value !== "object") return out;
  if (out.has(value)) return out;
  out.add(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) reachableObjects(descriptor.value, out);
  }
  return out;
}

/** THE identity-walk: no object in `projected` may be reachable from `caller`. */
function assertNoSharedIdentity(projected: unknown, caller: unknown, label: string): void {
  const callerObjects = reachableObjects(caller);
  for (const candidate of reachableObjects(projected)) {
    expect(callerObjects.has(candidate), `${label}: a caller-owned object survived in the projection`).toBe(false);
  }
}

// ─── 1–3. board projection ownership (R1/R2) ────────────────────────────────

describe("B11.6 §A — board projection never returns caller identity", () => {
  it("1: projectBoardForReplay(revokedProxy) does not throw and does not return the proxy", () => {
    const proxy = revoked();
    expect(() => projectBoardForReplay(proxy)).not.toThrow();
    const projected = projectBoardForReplay(proxy);
    expect(projected.ok).toBe(false);
    if (!projected.ok) {
      expect(projected.issues.length).toBeGreaterThan(0);
      expect(projected.issues[0]).toContain("not reflectable");
    }
    // The failure result is a plain owned object — nothing hostile inside.
    expect(Object.values(projected).some((part) => Object.is(part, proxy))).toBe(false);
  });

  it("2: a nested hostile proxy never survives in a projected board", () => {
    // (a) a REVOKED proxy in the slot: capture refuses the board outright, so
    // there is no projection for it to hide in.
    const boardWithRevoked = createEmptyBoard() as unknown as Rec;
    ((boardWithRevoked.outline as Rec).origin as Rec).x = revoked();
    const refused = projectBoardForReplay(boardWithRevoked);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.issues.join(" ")).toContain("not reflectable");

    // (b) a get-trap proxy over an empty target: its data descriptors ARE
    // capturable, so it captures to an OWNED `{}` — the projection reports the
    // wrong-typed slot, and NOTHING in the result can fire the caller's trap.
    let trapFired = 0;
    const hostile = new Proxy({}, { get() { trapFired += 1; throw new Error("hostile get"); } });
    const board = createEmptyBoard() as unknown as Rec;
    ((board.outline as Rec).origin as Rec).x = hostile;
    expect(validateBoardShape(board).join(" ")).toContain("board.outline.origin.x");
    const projected = projectBoardForReplay(board);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const projectedX = (((projected.value as Rec).outline as Rec).origin as Rec).x;
    expect(Object.is(projectedX, hostile), "the caller's proxy survived in the projection").toBe(false);
    const before = trapFired;
    expect(() => JSON.stringify(projected.value)).not.toThrow();
    expect(() => Object.keys(projectedX as object)).not.toThrow();
    expect(trapFired, "reading the projection fired the caller's get trap").toBe(before);
    expect(Object.isFrozen(projectedX)).toBe(true);
  });

  it("2b: a wrong-typed PLAIN object is carried for diagnostics — as an OWNED copy only", () => {
    const callerOwned = { deliberately: "wrong-typed" };
    const board = createEmptyBoard() as unknown as Rec;
    ((board.outline as Rec).origin as Rec).x = callerOwned;

    const projected = projectBoardForReplay(board);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.issues.join(" ")).toContain("board.outline.origin.x");
    const projectedX = (((projected.value as Rec).outline as Rec).origin as Rec).x;
    // Available for deterministic diagnostics…
    expect(projectedX).toEqual(callerOwned);
    // …but never the caller's object.
    expect(Object.is(projectedX, callerOwned)).toBe(false);
    expect(Object.isFrozen(projectedX)).toBe(true);
  });

  it("3: IDENTITY-WALK — no projection result shares any object with the caller, at any depth", () => {
    const board = createEmptyBoard() as unknown as Rec;
    ((board.outline as Rec).origin as Rec).x = { wrong: { typed: [1, 2] } };
    (board.nets as Rec[]).push({ id: 5, name: "SIG", stableId: "net:sig", endpointKeys: ["a::1"] } as never);

    const projected = projectBoardForReplay(board);
    expect(projected.ok).toBe(true);
    if (projected.ok) assertNoSharedIdentity(projected.value, board, "board projection");

    const context = clone(capsuleFor("e03-valid-board").context);
    const projectedContext = projectReplayContext(context);
    expect(projectedContext.ok).toBe(true);
    if (projectedContext.ok) assertNoSharedIdentity(projectedContext.value, context, "context projection");

    const accepted = validateReplayContext(context);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) assertNoSharedIdentity(accepted.context, context, "accepted context");
  });
});

// ─── 4–6. context boundary totality (R3/R4) ─────────────────────────────────

describe("B11.6 §B — every exported boundary is total", () => {
  const statefulFamilies: Array<[string, () => unknown]> = [
    ["revoked", revoked],
    ["stateful ownKeys", () => { let calls = 0; return new Proxy([1, 2], { ownKeys(target) { calls += 1; if (calls > 1) throw new Error("stateful"); return Reflect.ownKeys(target); } }); }],
    ["stateful getPrototypeOf", () => { let calls = 0; return new Proxy([1], { getPrototypeOf(target) { calls += 1; if (calls > 1) throw new Error("stateful"); return Reflect.getPrototypeOf(target); } }); }],
    ["stateful gOPD", () => { let calls = 0; return new Proxy({ a: 1, b: 2 }, { getOwnPropertyDescriptor(target, key) { calls += 1; if (calls > 1) throw new Error("stateful"); return Reflect.getOwnPropertyDescriptor(target, key); } }); }],
    ["stateful get", () => { let calls = 0; return new Proxy([1, 2, 3], { get(target, key, receiver) { calls += 1; if (calls > 2) throw new Error("stateful"); return Reflect.get(target, key, receiver); } }); }],
    ["stateful has", () => new Proxy({ a: 1 }, { has() { throw new Error("stateful has"); } })],
    ["nested hostile", () => ({ outer: [{ inner: revoked() }] })],
  ];

  const boundaries: Array<[string, (value: unknown) => unknown]> = [
    ["projectBoardForReplay", (value) => projectBoardForReplay(value)],
    ["projectCapturedBoard", (value) => projectCapturedBoard(value)],
    ["validateBoardShape", (value) => validateBoardShape(value)],
    ["projectReplayContext", (value) => projectReplayContext(value)],
    ["validateReplayContext", (value) => validateReplayContext(value)],
    ["validateCapturedReplayContext", (value) => validateCapturedReplayContext(value)],
    ["validateReplayCapsule", (value) => validateReplayCapsule(value)],
    ["parseReplayCapsule", (value) => parseReplayCapsule(value)],
    ["validateAgentRunTrace", (value) => validateAgentRunTrace(value as never)],
    ["findNonPlainJsonPath", (value) => findNonPlainJsonPath(value, "$")],
    ["findSecretShapedPath", (value) => findSecretShapedPath(value, "$")],
    ["capturePlainJson", (value) => capturePlainJson(value, "$")],
    ["scanPlainJson", (value) => scanPlainJson(value, "$")],
    ["isCapturedRecord", (value) => isCapturedRecord(value)],
    ["isOwnedCapture", (value) => isOwnedCapture(value)],
  ];

  it("4/5/6: no boundary throws for any hostile family — 7 families × 15 boundaries", () => {
    for (const [family, make] of statefulFamilies) {
      for (const [name, run] of boundaries) {
        expect(() => run(make()), `${name}(${family})`).not.toThrow();
      }
    }
  });

  it("4: projectReplayContext(revokedProxy) refuses explicitly", () => {
    const result = projectReplayContext(revoked());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("not reflectable");
  });

  it("5: validateCapturedReplayContext is total AND never returns foreign identity", () => {
    // Hostile: refused.
    expect(validateCapturedReplayContext(revoked()).ok).toBe(false);
    // Foreign PLAIN input: accepted-or-refused through the capture-first path,
    // so an accepted context is never the caller's object.
    const plain = clone(capsuleFor("e03-valid-board").context);
    const result = validateCapturedReplayContext(plain);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.is(result.context, plain)).toBe(false);
      expect(isOwnedCapture(result.context)).toBe(true);
      assertNoSharedIdentity(result.context, plain, "validateCapturedReplayContext");
    }
    // OWNED input: the zero-copy fast path.
    const owned = capturePlainJson(plain, "context");
    expect(owned.ok).toBe(true);
    if (owned.ok) {
      const fast = validateCapturedReplayContext(owned.value);
      expect(fast.ok).toBe(true);
      if (fast.ok) expect(Object.is(fast.context, owned.value)).toBe(true);
    }
  });

  it("the ownership registry is unforgeable from outside", () => {
    // A caller cannot mint ownership: deep-frozen plain data is still foreign.
    const forged = Object.freeze({ schema: "sirkit.agent-replay-context.v2" });
    expect(isOwnedCapture(forged)).toBe(false);
    // Only values produced by capture are owned.
    const captured = capturePlainJson({ a: 1 }, "$");
    expect(captured.ok).toBe(true);
    if (captured.ok) {
      expect(isOwnedCapture(captured.value)).toBe(true);
      expect(isOwnedCapture(structuredClone(captured.value))).toBe(false);
    }
  });
});

// ─── 7–8. preserved counters and the depth contract (R5) ────────────────────

describe("B11.6 §C — preserved contracts", () => {
  it("7: toJSON and accessor counters remain zero across the new projection path", () => {
    let hookCalls = 0;
    let getterReads = 0;
    const board = createEmptyBoard() as unknown as Rec;
    (board.outline as Rec).toJSON = () => { hookCalls += 1; return {}; };
    const second = createEmptyBoard() as unknown as Rec;
    Object.defineProperty(second.outline as Rec, "origin", { get: () => { getterReads += 1; return { x: 0, y: 0 }; }, enumerable: true, configurable: true });

    expect(projectBoardForReplay(board).ok).toBe(false);
    // The hook-bearing context refuses at CAPTURE — a function is not JSON —
    // and on every path the hook is never invoked.
    expect(projectReplayContext({ board }).ok).toBe(false);
    expect(validateBoardShape(second).length).toBeGreaterThan(0);
    expect(hookCalls).toBe(0);
    expect(getterReads).toBe(0);
  });

  it("8: the findNonPlainJsonPath depth contract is enforced", () => {
    expect(findNonPlainJsonPath({}, "$", 33)).toContain("depth");
    expect(findNonPlainJsonPath({}, "$", 0)).toBeNull();
    expect(findNonPlainJsonPath({}, "$")).toBeNull();
    // The starting depth counts against the same budget the recursion uses.
    let nested: unknown = 1;
    for (let index = 0; index < 20; index += 1) nested = { child: nested };
    expect(findNonPlainJsonPath(nested, "$", 0)).toBeNull();
    expect(findNonPlainJsonPath(nested, "$", 20)).toContain("depth");
  });

  it("9: valid projections remain byte/canonical equivalent", () => {
    const board = createEmptyBoard();
    const projected = projectBoardForReplay(board);
    expect(projected.ok).toBe(true);
    if (projected.ok) {
      expect(projected.issues).toEqual([]);
      expect(canonicalJson(projected.value)).toBe(canonicalJson(board));
    }
    const context = clone(capsuleFor("e06c-selection-valid").context);
    const projectedContext = projectReplayContext(context);
    expect(projectedContext.ok).toBe(true);
    if (projectedContext.ok) expect(canonicalJson(projectedContext.value)).toBe(canonicalJson(context));
  });

  it("10: structurally invalid plain JSON still yields deterministic bounded diagnostics", () => {
    const board = createEmptyBoard() as unknown as Rec;
    board.formatVersion = "not-a-one";
    (board as Rec).unknownKey = 1;
    const first = projectBoardForReplay(board);
    const second = projectBoardForReplay(board);
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.issues).toEqual(second.issues); // deterministic
    expect(first.issues.length).toBeGreaterThan(0);
    expect(first.issues.length).toBeLessThanOrEqual(12); // bounded
  });
});

// ─── 11–13. replay invariants ───────────────────────────────────────────────

describe("B11.6 §D — replay invariants preserved", () => {
  it("11: replay captures once and executes only its immutable snapshot", async () => {
    const capsule = clone(capsuleFor("e10-proposal-only"));
    const pending = replayCapsule(capsule, { computeOnly: true });
    capsule.steps[capsule.steps.length - 1] = { ...capsule.steps[capsule.steps.length - 1]!, text: "B116-MUTATED" };
    (capsule.expected as Rec).traceDigest = "eng1-B116-FORGED";
    const outcome = await pending;
    expect(JSON.stringify(outcome.events)).not.toContain("B116-");
    expect(outcome.traceDigest).toBe(pins["e10-proposal-only"]);
  });

  it("12: invalid capsules reach no execution boundary (carried by the B11.4 probes)", async () => {
    // The instrumented proof lives in b11-4-no-execution.test.ts; here the
    // refusal itself is asserted for the new hostile families.
    for (const make of [revoked, () => ({ outer: revoked() })]) {
      await expect(replayCapsule(make() as ReplayCapsule, { computeOnly: true })).rejects.toThrow(ReplayCapsuleInvalidError);
    }
  });

  it("13: all 19 evaluation capsules validate and retain their pins", async () => {
    for (const evaluationCase of buildEvaluationCases(pins)) {
      expect(validateReplayCapsule(evaluationCase.capsule), evaluationCase.caseId).toEqual([]);
      const outcome = await replayCapsule(evaluationCase.capsule, { ...evaluationCase.options, computeOnly: true });
      expect(outcome.traceDigest, evaluationCase.caseId).toBe(pins[evaluationCase.caseId]);
    }
  });

  it("static exposure remains exactly ELEVEN read/propose tools", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) expect(AGENT_EXPOSABLE_OPERATION_CLASSES).toContain(descriptor.operationClass);
  });

  it("14: no B11 test writes repository paths", () => {
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
