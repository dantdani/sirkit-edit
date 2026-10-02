/**
 * [B22-B review] tests-2: the chat route's named-computation wiring, driven through `POST /api/chat` (the B19-E E6 / B20-A4 pattern).
 * The route resolves the port through its ONE boundary (`app/api/chat/computation-runtime.ts`), once per request; the same resolution
 * feeds the gateway (the port) and both context assemblies (the fact), so the model is offered the three reads only when a port is
 * bound: with `SIRKIT_NAMED_COMPUTATIONS=1` and a server process that carries no V8 heap-size flag (OD-158; regressions-1 - what
 * `next dev` writes into its server's NODE_OPTIONS). A scripted model (in-process fake adapter) calls the analytical equation; the
 * port is the REAL one over the bounded engine host (a worker thread inside the test process). A factory that throws fails closed,
 * and the request body can never claim the fact or the port. No network, no database, no model, no process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { InMemoryTraceSink, setAgentTraceSinkFactory } from "@/app/lib/agent/trace-recorder";
import { validateAgentRunTrace } from "@/app/lib/agent/trace";
import type { ComputationPortRequest } from "@/app/lib/agent/computation-reads";
import { createComputationPort } from "@/app/lib/computation/computation-port";

const SCOPE = { tenantId: "local", projectId: "project-b22b-chat-0001", branchId: "main" };
const BOARD = JSON.parse(JSON.stringify(makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2)));
const SCHEMATIC: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [{ id: "k1", partId: "lib:ne555", x: 100, y: 100, rotation: 0, refDes: "U1", value: "NE555" }] };
const BASIS = { historyHeadSequence: 4, historyHeadLabel: null, lineageId: "lin1-0000000000000001", activeDrcPresetId: DEFAULT_PRESET_ID };
const READS = ["sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse"];
const EQUATION = READS[0]!;
const DIVIDER = { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000, r: null, c: null, time: null, frequency: null };

const seen = vi.hoisted(() => ({ tools: [] as string[][], inputs: [] as unknown[], plan: [] as Array<{ toolId: string; args: Record<string, unknown> }> }));

vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => {
    let index = 0;
    const next = (tools: ReadonlyArray<{ toolId: string; providerName: string }>) => {
      const step = seen.plan[index];
      index += 1;
      const found = step ? tools.find((entry) => entry.toolId === step.toolId) : undefined;
      if (!step || !found) return { text: "done", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
      return { text: "", toolCalls: [{ callId: `c-${index}`, providerName: found.providerName, argumentsText: JSON.stringify(step.args) }], stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
    };
    return {
      provider: "openai",
      async start(input: { tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
        seen.inputs.push(input);
        seen.tools.push(input.tools.map((entry) => entry.toolId));
        return next(input.tools);
      },
      async continueWith(input: { tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
        seen.inputs.push(input);
        return next(input.tools);
      },
    };
  },
}));

import { POST, EDITOR_CONTEXT_SCHEMA } from "@/app/api/chat/route";
import { resetComputationPortFactory, resolveComputationPort, setComputationPortFactory } from "@/app/api/chat/computation-runtime";

function body(extra: Record<string, unknown> = {}) {
  return {
    provider: "openai", messages: [{ role: "user", content: "What is the divider's output voltage?" }], scope: SCOPE, schematicState: SCHEMATIC,
    editorContext: {
      schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board: BOARD, pcbRevisionId: pcbRevisionId(BOARD), selection: { refs: [], primary: null }, netlist: null,
      schematicDigest: schematicStateDigest(SCHEMATIC), authoritySource: "local-working-copy", pcbProposalBasis: BASIS,
    },
    ...extra,
  };
}
const post = async (payload: unknown) => {
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
  const text = await response.text();
  return { status: response.status, text, events: text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; toolId?: string; status?: string }) };
};
const offered = (index = 0): string[] => (seen.tools[index] ?? []).filter((toolId) => toolId.startsWith("sirkit.computation."));

let sink: InMemoryTraceSink;
beforeEach(() => {
  seen.tools.length = 0;
  seen.inputs.length = 0;
  seen.plan.length = 0;
  resetAdmissionControl();
  sink = new InMemoryTraceSink();
  setAgentTraceSinkFactory(() => sink);
  vi.stubGlobal("fetch", () => { throw new Error("the chat route reached the global fetch"); });
  vi.stubEnv("NODE_OPTIONS", "");
  vi.stubEnv("SIRKIT_NAMED_COMPUTATIONS", "");
});
afterEach(() => {
  resetComputationPortFactory();
  setAgentTraceSinkFactory(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("[B22-B review] the chat route's named-computation boundary (tests-2)", () => {
  it("1. off by default: without SIRKIT_NAMED_COMPUTATIONS=1 the model is offered none of the three reads; a body that claims the fact or the port is refused 400", async () => {
    seen.plan.push({ toolId: EQUATION, args: DIVIDER });
    const { status, events } = await post(body());
    expect(status).toBe(200);
    expect(seen.tools[0]!.length).toBeGreaterThan(0);
    expect(offered()).toEqual([]);
    expect(events.filter((event) => event.toolId?.startsWith("sirkit.computation."))).toEqual([]);
    vi.stubEnv("SIRKIT_NAMED_COMPUTATIONS", "1");
    for (const key of ["computationAvailable", "computation"]) {
      const { status: claimed } = await post(body({ [key]: true }));
      expect(claimed, key).toBe(400);
    }
  });

  it("2. opted in (the production default factory, SIRKIT_NAMED_COMPUTATIONS=1, no heap flag): the three reads are offered and the model's call is answered by the REAL port through the bounded engine host - the divider's quantities reach the model as labelled evidence; the trace validates", { timeout: 60_000 }, async () => {
    vi.stubEnv("SIRKIT_NAMED_COMPUTATIONS", "1");
    seen.plan.push({ toolId: EQUATION, args: DIVIDER });
    const { status, events } = await post(body());
    expect(status).toBe(200);
    expect(offered().sort()).toEqual([...READS].sort());
    expect(events.filter((event) => event.type === "tool_finished" && event.toolId === EQUATION).map((event) => event.status)).toEqual(["succeeded"]);
    const modelInputs = JSON.stringify(seen.inputs);
    expect(modelInputs).toContain("computation_evidence");
    expect(modelInputs).toContain("not_authoritative");
    expect(modelInputs).toMatch(/3\.33333333/);
    expect(sink.completed).not.toBeNull();
    expect(validateAgentRunTrace(sink.completed)).toEqual([]);
  });

  it("3. one resolution per request feeds the gateway and both assemblies: the port is asked with the run's server-derived scope and its server-held canonical board by revision digest; a factory that returns null withholds the reads and asks nothing", { timeout: 60_000 }, async () => {
    const asked: ComputationPortRequest[] = [];
    let resolutions = 0;
    setComputationPortFactory(() => {
      resolutions += 1;
      const port = createComputationPort();
      return { evaluate: (request) => { asked.push(request); return port.evaluate(request); } };
    });
    seen.plan.push({ toolId: EQUATION, args: DIVIDER });
    const { status } = await post(body());
    expect(status).toBe(200);
    expect(resolutions).toBe(1);
    expect(offered().sort()).toEqual([...READS].sort());
    expect(asked).toHaveLength(1);
    expect(asked[0]!.scope).toEqual(SCOPE);
    expect(asked[0]!.kindId).toBe(EQUATION);
    expect(asked[0]!.input).toEqual({ equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 });
    expect(asked[0]!.canonicalBoard?.digest).toBe(sink.completed!.contextDigests.canonicalRevisionDigest);
    seen.tools.length = 0;
    seen.plan.length = 0;
    seen.plan.push({ toolId: EQUATION, args: DIVIDER });
    setComputationPortFactory(() => { resolutions += 1; return null; });
    await post(body());
    expect(resolutions).toBe(2);
    expect(offered()).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it("4. fails closed: a factory that throws withholds the three reads (the request still answers 200); opted in on a server whose NODE_OPTIONS carries a V8 heap-size flag - `next dev`'s - the default factory binds no port, so the reads are withheld rather than offered and refused on every call (regressions-1)", async () => {
    setComputationPortFactory(() => { throw new Error("port construction failed"); });
    expect(resolveComputationPort()).toBeNull();
    seen.plan.push({ toolId: EQUATION, args: DIVIDER });
    expect((await post(body())).status).toBe(200);
    expect(offered()).toEqual([]);
    resetComputationPortFactory();
    vi.stubEnv("SIRKIT_NAMED_COMPUTATIONS", "1");
    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=7936");
    seen.tools.length = 0;
    expect((await post(body())).status).toBe(200);
    expect(offered()).toEqual([]);
  });
});
