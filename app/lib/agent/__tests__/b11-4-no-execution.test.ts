/**
 * B11.4 §E — a TRUTHFUL no-execution proof.
 *
 * B11.1–B11.3 all asserted that an invalid capsule "executes nothing" by
 * instrumenting `setAgentTraceSinkFactory` and checking it was never called.
 * B11.4 R6 reproduced why that proved nothing: `replayCapsule` constructs
 * `new InMemoryTraceSink()` directly and never calls the factory at all, so
 * the counter is **0 for a valid capsule too**. The assertion could not
 * distinguish "refused before execution" from "executed completely".
 *
 * This suite instruments the ACTUAL boundaries by module-mocking the modules
 * `replay-capsule.ts` imports, delegating to the real implementations so the
 * PRODUCTION replay function is what runs:
 *
 *   context assembly      → assembleAgentRunContext
 *   resource construction → buildAgentResourceBundle
 *   discovery             → buildRunToolset
 *   gateway construction  → createAgentToolGateway
 *   loop execution        → runAgentLoop      (which is what calls adapter.start/continueWith)
 *   registry construction → sirkitToolRegistry
 *   recorder construction → the injected `clock`, called by the recorder
 *   the caller's sink     → `options.sink`
 *
 * A VALID control capsule must trigger every probe — otherwise the test could
 * not detect execution — and an INVALID one must trigger none.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const calls: Record<string, number> = {};
const bump = (name: string): void => { calls[name] = (calls[name] ?? 0) + 1; };

vi.mock("../context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../context")>();
  return {
    ...actual,
    assembleAgentRunContext: (...args: Parameters<typeof actual.assembleAgentRunContext>) => {
      bump("context-assembly");
      return actual.assembleAgentRunContext(...args);
    },
    buildAgentResourceBundle: (...args: Parameters<typeof actual.buildAgentResourceBundle>) => {
      bump("resource-construction");
      return actual.buildAgentResourceBundle(...args);
    },
  };
});

vi.mock("../loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../loop")>();
  return {
    ...actual,
    buildRunToolset: (...args: Parameters<typeof actual.buildRunToolset>) => {
      bump("discovery");
      return actual.buildRunToolset(...args);
    },
    runAgentLoop: (...args: Parameters<typeof actual.runAgentLoop>) => {
      bump("loop-execution");
      return actual.runAgentLoop(...args);
    },
  };
});

vi.mock("../gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway")>();
  return {
    ...actual,
    createAgentToolGateway: (...args: Parameters<typeof actual.createAgentToolGateway>) => {
      bump("gateway-construction");
      return actual.createAgentToolGateway(...args);
    },
  };
});

vi.mock("../../engineering/tool-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../engineering/tool-catalog")>();
  return {
    ...actual,
    sirkitToolRegistry: (...args: Parameters<typeof actual.sirkitToolRegistry>) => {
      bump("registry-construction");
      return actual.sirkitToolRegistry(...args);
    },
  };
});

const { replayCapsule, ReplayCapsuleInvalidError } = await import("../replay-capsule");
const { buildEvaluationCases } = await import("../evaluation-cases");
type ReplayCapsule = import("../replay-capsule").ReplayCapsule;
type AgentTraceSink = import("../trace-recorder").AgentTraceSink;

const pins = (JSON.parse(readFileSync(join(process.cwd(), "artifacts", "ai-control-plane-b11", "replay-trace-pins.json"), "utf8")) as { pins: Record<string, string> }).pins;
const validCapsule = (): ReplayCapsule => buildEvaluationCases(pins).find((item) => item.caseId === "e03-valid-board")!.capsule;

/** A sink handed in through `ReplayOptions` — the caller's own boundary. */
function probeSink(): AgentTraceSink {
  return {
    append: () => { bump("caller-sink"); },
    complete: () => { bump("caller-sink"); },
  };
}

const PROBES = [
  "context-assembly", "resource-construction", "discovery",
  "gateway-construction", "loop-execution", "registry-construction",
  "recorder-clock", "caller-sink",
] as const;

const observed = (): string[] => PROBES.filter((probe) => (calls[probe] ?? 0) > 0);

beforeEach(() => { for (const key of Object.keys(calls)) delete calls[key]; });
afterEach(() => { vi.clearAllMocks(); });

describe("B11.4 §E — an invalid capsule reaches NO execution boundary", () => {
  const run = async (capsule: unknown): Promise<void> => {
    await replayCapsule(capsule as ReplayCapsule, {
      computeOnly: true,
      sink: probeSink(),
      clock: () => { bump("recorder-clock"); return 1; },
    });
  };

  it("the CONTROL capsule triggers EVERY probe — the test can detect execution", async () => {
    await run(validCapsule());
    expect(observed().sort()).toEqual([...PROBES].sort());
  });

  it("hook-bearing, unknown-field, and hostile capsules trigger NONE of them", async () => {
    const hostileProxy = new Proxy({}, { ownKeys() { throw new Error("hostile"); }, getOwnPropertyDescriptor() { throw new Error("hostile"); }, getPrototypeOf() { throw new Error("hostile"); } });
    const revoked = (() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; })();

    const cases: Array<[string, () => unknown]> = [
      ["nested toJSON hook", () => {
        const capsule = structuredClone(validCapsule());
        (capsule.context.board!.outline as unknown as Record<string, unknown>).toJSON = () => ({});
        return capsule;
      }],
      ["top-level toJSON hook", () => {
        const capsule = structuredClone(validCapsule()) as unknown as Record<string, unknown>;
        capsule.toJSON = () => ({});
        return capsule;
      }],
      ["nested accessor", () => {
        const capsule = structuredClone(validCapsule());
        Object.defineProperty(capsule.context.board!, "outline", { get: () => ({}), enumerable: true, configurable: true });
        return capsule;
      }],
      ["unknown board field", () => {
        const capsule = structuredClone(validCapsule());
        (capsule.context.board as unknown as Record<string, unknown>).b114Unknown = 1;
        return capsule;
      }],
      ["sparse array", () => {
        const capsule = structuredClone(validCapsule());
        const sparse: unknown[] = [];
        sparse[3] = { id: "t", layer: "copperTop", width: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 0 };
        (capsule.context.board as unknown as Record<string, unknown>).tracks = sparse;
        return capsule;
      }],
      ["revoked proxy", () => revoked],
      ["throwing proxy", () => hostileProxy],
      ["cyclic capsule", () => {
        const capsule = structuredClone(validCapsule()) as unknown as Record<string, unknown>;
        capsule.self = capsule;
        return capsule;
      }],
    ];

    // Materialize every hostile document BEFORE the counters are cleared:
    // building a fixture calls `buildEvaluationCases`, which legitimately
    // constructs the tool registry. Only `replayCapsule` is under measurement.
    const materialized = cases.map(([label, build]) => [label, build()] as const);
    for (const [label, document] of materialized) {
      for (const key of Object.keys(calls)) delete calls[key];
      await expect(run(document), label).rejects.toThrow(ReplayCapsuleInvalidError);
      expect(observed(), `${label} reached an execution boundary`).toEqual([]);
    }
  });

  it("MUTATION TEST: a guard that lets execution happen FAILS", async () => {
    // Deliberately execute a valid capsule, then assert the same guard the
    // test above uses. If `observed()` were vacuous — as the B11.1–B11.3
    // sink-factory assertion was — this expectation could not fail.
    await run(validCapsule());
    let guardHeld = true;
    try {
      expect(observed()).toEqual([]);
    } catch {
      guardHeld = false;
    }
    expect(guardHeld, "the no-execution guard is vacuous: it passed while a run executed").toBe(false);
    expect(observed().length).toBeGreaterThanOrEqual(PROBES.length);
  });

  it("the sink supplied through ReplayOptions is untouched for an invalid capsule", async () => {
    const sink = probeSink();
    const capsule = structuredClone(validCapsule()) as unknown as Record<string, unknown>;
    capsule.b114Unknown = 1;
    await expect(replayCapsule(capsule as unknown as ReplayCapsule, { computeOnly: true, sink })).rejects.toThrow(ReplayCapsuleInvalidError);
    expect(calls["caller-sink"] ?? 0).toBe(0);
  });
});
