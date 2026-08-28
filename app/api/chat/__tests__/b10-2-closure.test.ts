/**
 * B10.2 — authoritative-netlist proof and final request-boundary closure.
 * Permanent regressions for R1–R5, driven through the PRODUCTION
 * validator → assembler → resource envelope → readiness chain and the
 * PRODUCTION chat route (controlled provider adapter; everything else
 * real).
 */

import { describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { assembleAgentRunContext, buildAgentResourceBundle } from "@/app/lib/agent/context";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import {
  AGENT_NETLIST_SCHEMA,
  projectAgentNetlist,
  proveAgentNetlist,
  validateAgentNetlistProjection,
  type AgentNetlistProjection,
} from "@/app/lib/agent/netlist-validation";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { buildNetlist } from "@/app/lib/pcb/netlist-bridge";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";

vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start() {
      return { text: "ok", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
    },
    async continueWith() { throw new Error("not used"); },
  }),
}));

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";

const SCOPE = { tenantId: "local", projectId: "p102", branchId: "main" };
/** One resistor — the R1 counterexample schematic. */
const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
/** Two wired resistors — a NET-BEARING theory-only schematic (r1.right at
 *  (130,100) meets the wire meeting r2.left at (170,100)). */
const WIRED: SchematicState = {
  components: [
    { id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" },
    { id: "r2", type: "resistor", x: 200, y: 100, rotation: 0, value: "1k" },
  ],
  wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 170, y: 100 }] }],
};

function assembleNetlist(netlist: unknown, schematic: SchematicState = SCHEMATIC) {
  const assembly = assembleAgentRunContext({
    ...SCOPE, schematic, board: createEmptyBoard(),
    netlist, editorSchematicDigest: schematicStateDigest(schematic),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly;
}

async function readinessParity(context: ReturnType<typeof assembleNetlist>["context"]) {
  const gateway = createAgentToolGateway(sirkitToolRegistry());
  const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.manufacturing.readiness-inspect", version: "1.0.0", args: {}, context, timeoutMs: 5000 });
  if (outcome.kind !== "read" || !outcome.ok) throw new Error(`expected readiness read, got ${JSON.stringify(outcome).slice(0, 160)}`);
  return (outcome.output as { report: { parity: { source: string; state: string; intendedComponents: string[]; missingComponents: string[] } } }).report.parity;
}

describe("B10.2 §A — server-proven netlist truth (R1/R2/R3)", () => {
  it("R1: the EMPTY projection against a non-empty physical schematic cannot seal and cannot produce authoritative-netlist/pass readiness", async () => {
    const empty = { schema: AGENT_NETLIST_SCHEMA, components: [], nets: [] };
    const proof = proveAgentNetlist(empty, SCHEMATIC);
    expect(proof.ok).toBe(false);
    const assembly = assembleNetlist(empty);
    expect(assembly.context.netlist).toBeNull();
    expect(assembly.warnings.some((warning) => warning.includes("does not agree exactly with the server-derived netlist"))).toBe(true);
    const bundle = buildAgentResourceBundle(assembly.context);
    expect(bundle.auxiliary.some((envelope) => envelope.kind === "netlist")).toBe(false); // never sealed
    const parity = await readinessParity(assembly.context);
    expect(parity.source).toBe("unavailable");
    expect(["unknown", "stale"]).toContain(parity.state); // never authoritative pass
  });

  it("omitted physical components withhold; added simulation-only components refuse", () => {
    // WIRED has r1 AND r2 — a projection omitting r2 is an omission.
    const partial = projectAgentNetlist(buildNetlist(WIRED));
    const omitted: AgentNetlistProjection = { ...partial, components: partial.components.filter((component) => component.id !== "r2") };
    expect(proveAgentNetlist(omitted, WIRED).ok).toBe(false);
    // A schematic carrying a voltage source: the source is NOT a physical
    // component — a projection including it refuses at the validator.
    const withSource: SchematicState = { components: [...SCHEMATIC.components, { id: "v1", type: "voltage-source", x: 300, y: 100, rotation: 0, value: "5V" }], wires: [] };
    const simProjection = { schema: AGENT_NETLIST_SCHEMA, components: [{ id: "v1", ref: "v1", pins: [{ number: "1" }] }], nets: [] };
    expect(validateAgentNetlistProjection(simProjection, withSource).some((issue) => issue.includes("not a component of the verified schematic"))).toBe(true);
    expect(proveAgentNetlist(simProjection, withSource).ok).toBe(false);
    // Ground symbols equally never enter the physical projection.
    const withGround: SchematicState = { components: [...SCHEMATIC.components, { id: "g1", type: "ground", x: 300, y: 200, rotation: 0, value: "" }], wires: [] };
    const groundProjection = { schema: AGENT_NETLIST_SCHEMA, components: [{ id: "g1", ref: "g1", pins: [{ number: "1" }] }], nets: [] };
    expect(proveAgentNetlist(groundProjection, withGround).ok).toBe(false);
  });

  it("R2: resistor pin 999 refuses; altered theory pin names refuse", () => {
    const pin999 = { schema: AGENT_NETLIST_SCHEMA, components: [{ id: "r1", ref: "r1", pins: [{ number: "999" }] }], nets: [] };
    expect(validateAgentNetlistProjection(pin999, SCHEMATIC).some((issue) => issue.includes("theory pin contract"))).toBe(true);
    expect(proveAgentNetlist(pin999, SCHEMATIC).ok).toBe(false);
    const renamed = { schema: AGENT_NETLIST_SCHEMA, components: [{ id: "r1", ref: "r1", pins: [{ number: "1", name: "anode" }, { number: "2", name: "right" }] }], nets: [] };
    expect(validateAgentNetlistProjection(renamed, SCHEMATIC).some((issue) => issue.includes("theory pin contract"))).toBe(true);
  });

  it("rewritten net topology refuses; the VALID exact theory-only projection succeeds and seals the SERVER-OWNED content", async () => {
    const derived = projectAgentNetlist(buildNetlist(WIRED));
    expect(derived.nets.length).toBeGreaterThan(0); // the wire formed a real net
    // Topology rewrite: drop one node from the net (and its endpoint key).
    const rewritten: AgentNetlistProjection = {
      ...derived,
      nets: derived.nets.map((net) => ({ ...net, nodes: net.nodes.slice(0, 1), endpointKeys: net.endpointKeys.slice(0, 1) })),
    };
    expect(proveAgentNetlist(rewritten, WIRED).ok).toBe(false);
    // The exact derivation proves and seals — content is the SERVER copy.
    const proof = proveAgentNetlist(derived, WIRED);
    if (!proof.ok) throw new Error(proof.reason);
    const assembly = assembleNetlist(derived, WIRED);
    expect(assembly.context.netlist).toEqual(proof.content);
    const bundle = buildAgentResourceBundle(assembly.context);
    expect(bundle.auxiliary.some((envelope) => envelope.kind === "netlist")).toBe(true);
  });

  it("a PROVEN theory netlist against an empty board produces a REAL missing-component parity failure (board disagreement stays a readiness diagnosis)", async () => {
    const assembly = assembleNetlist(projectAgentNetlist(buildNetlist(WIRED)), WIRED);
    expect(assembly.context.netlist).not.toBeNull(); // proven and sealed
    const parity = await readinessParity(assembly.context);
    expect(parity.source).toBe("authoritative-netlist");
    expect(parity.state).toBe("fail");
    expect(parity.missingComponents).toEqual(["r1", "r2"]);
  });

  it("KiCad-bearing schematics with no trusted server resolver withhold netlist authority EXPLICITLY (parity not evaluated, never authoritative)", async () => {
    const kicadSchematic: SchematicState = {
      components: [], wires: [],
      kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU" }],
      netLabels: [],
    };
    const claimed = { schema: AGENT_NETLIST_SCHEMA, components: [{ id: "u1-id", ref: "U1", pins: [{ number: "1" }] }], nets: [] };
    const proof = proveAgentNetlist(claimed, kicadSchematic);
    expect(proof.ok).toBe(false);
    if (proof.ok) throw new Error("unreachable");
    expect(proof.reason).toContain("trusted server-side component pin authority is unavailable");
    const assembly = assembleNetlist(claimed, kicadSchematic);
    expect(assembly.context.netlist).toBeNull();
    expect(assembly.warnings.some((warning) => warning.includes("pin authority is unavailable"))).toBe(true);
    const parity = await readinessParity(assembly.context);
    expect(parity.source).toBe("unavailable");
    expect(["unknown", "stale"]).toContain(parity.state);
  });
});

describe("B10.2 §B — exact selection contract (R4)", () => {
  function editorContext(selection: unknown) {
    const board = createEmptyBoard();
    return {
      schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board,
      pcbRevisionId: pcbRevisionId(board), selection,
      netlist: null, schematicDigest: null, authoritySource: "local-working-copy",
    };
  }
  function post(selection: unknown): Promise<Response> {
    return POST(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", messages: [{ role: "user", content: "hi" }], scope: SCOPE, schematicState: SCHEMATIC, editorContext: editorContext(selection) }),
    }));
  }

  it("R4: selection without primary returns 400 BEFORE provider invocation; malformed primary refuses; null primary and a valid ref pass the contract", async () => {
    const missing = await post({ refs: [] });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toContain('missing the required key "primary"');
    const malformed = await post({ refs: [], primary: { kind: "track" } }); // no id
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: string }).error).toContain("structurally valid selection reference");
    const nullPrimary = await post({ refs: [], primary: null });
    expect(nullPrimary.status).toBe(200);
    const validPrimary = await post({ refs: [{ kind: "track", id: "t1" }], primary: { kind: "track", id: "t1" } });
    expect(validPrimary.status).toBe(200);
  });
});

describe("B10.2 §C — non-blocking bounded reader (R5)", () => {
  function hostileStream(cancelBehavior: "never-settles" | "rejects" | "throws"): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
    const chunk = new Uint8Array(1_000_000).fill(120);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; if (pulled <= 12) controller.enqueue(chunk); else controller.close(); },
      cancel() {
        if (cancelBehavior === "never-settles") return new Promise<void>(() => undefined);
        if (cancelBehavior === "rejects") return Promise.reject(new Error("hostile cancel rejection"));
        throw new Error("hostile synchronous cancel throw");
      },
    });
    return { stream, pulled: () => pulled };
  }

  it("R5: a NEVER-SETTLING cancel cannot delay the 413 — the response settles exactly once and reading stopped at the ceiling", async () => {
    const { stream, pulled } = hostileStream("never-settles");
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as never));
    expect(response.status).toBe(413); // settles without racing a timeout
    expect(pulled()).toBeLessThanOrEqual(10);
  });

  it("a REJECTING cancel and a synchronously THROWING cancel produce the 413 with no unhandled rejection", async () => {
    for (const behavior of ["rejects", "throws"] as const) {
      const rejections: unknown[] = [];
      const onRejection = (reason: unknown) => { rejections.push(reason); };
      process.on("unhandledRejection", onRejection);
      try {
        const { stream } = hostileStream(behavior);
        const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as never));
        expect(response.status, behavior).toBe(413);
        await new Promise((resolve) => setImmediate(resolve)); // let any stray rejection surface
        expect(rejections, behavior).toEqual([]);
      } finally {
        process.off("unhandledRejection", onRejection);
      }
    }
  });
});
