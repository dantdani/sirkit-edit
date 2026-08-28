/**
 * B10.1 §B/§C/§D — exact nested request shapes, the streaming bounded body
 * reader, and the authority-neutral netlist contract, driven through the
 * PRODUCTION route/assembler (controlled provider adapter; loop, gateway,
 * and context assembly are real).
 */

import { describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import {
  AGENT_NETLIST_SCHEMA,
  projectAgentNetlist,
  validateAgentNetlistProjection,
  type AgentNetlistProjection,
} from "@/app/lib/agent/netlist-validation";
import { schematicEndpointKey } from "@/app/lib/pcb/integrity";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { buildNetlist, type PcbNetlist } from "@/app/lib/pcb/netlist-bridge";

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

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const SCOPE = { tenantId: "local", projectId: "p101", branchId: "main" };
const BASE = { provider: "openai", messages: [{ role: "user", content: "hi" }], scope: SCOPE };

function boardWithTrack(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
  board.tracks.push({ id: "t1", layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 3_000_000 }, end: { x: 5_000_000, y: 3_000_000 }, netId: 1, source: "human" });
  return board;
}

function editorContext(overrides?: Record<string, unknown>) {
  const board = boardWithTrack();
  return {
    schema: EDITOR_CONTEXT_SCHEMA,
    scope: SCOPE,
    board,
    pcbRevisionId: pcbRevisionId(board),
    selection: { refs: [], primary: null },
    netlist: null,
    schematicDigest: schematicStateDigest(SCHEMATIC),
    authoritySource: "local-working-copy",
    ...overrides,
  };
}

function post(body: unknown): Promise<Response> {
  return POST(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

// ─── §B — exact nested request shapes ────────────────────────────────────────

describe("B10.1 §B — exact nested request shapes (R3)", () => {
  it("scope.actor / scope.capabilities and equivalent embedded-scope claims REFUSE by name", async () => {
    for (const claim of [{ actor: "admin" }, { capabilities: ["release"] }, { role: "project_admin" }, { authority: "durable-server-board" }]) {
      const response = await post({ ...BASE, scope: { ...SCOPE, ...claim } });
      expect(response.status, JSON.stringify(claim)).toBe(400);
      expect(await errorOf(response)).toContain("authority-shaped key");
    }
    const unknown = await post({ ...BASE, scope: { ...SCOPE, telemetry: 1 } });
    expect(unknown.status).toBe(400);
    expect(await errorOf(unknown)).toContain("unexpected key");
    const incomplete = await post({ ...BASE, scope: { tenantId: "local", projectId: "p101" } });
    expect(incomplete.status).toBe(400);
    expect(await errorOf(incomplete)).toContain("missing the required key");
  });

  it("editorContext.scope extra keys refuse; the COMPLETE editor-context contract is required; selection shape is exact", async () => {
    const scopeClaim = await post({ ...BASE, schematicState: SCHEMATIC, editorContext: editorContext({ scope: { ...SCOPE, role: "project_admin" } }) });
    expect(scopeClaim.status).toBe(400);
    expect(await errorOf(scopeClaim)).toContain("authority-shaped key");

    const context = editorContext();
    delete (context as Record<string, unknown>).selection; // incomplete contract
    const incomplete = await post({ ...BASE, schematicState: SCHEMATIC, editorContext: context });
    expect(incomplete.status).toBe(400);
    expect(await errorOf(incomplete)).toContain('missing the required key "selection"');

    const selectionClaim = await post({ ...BASE, schematicState: SCHEMATIC, editorContext: editorContext({ selection: { refs: [], primary: null, approvals: [] } }) });
    expect(selectionClaim.status).toBe(400);
    expect(await errorOf(selectionClaim)).toContain("authority-shaped key");
  });

  it("message objects are EXACTLY {role, content}: extra authority keys refuse instead of being silently dropped", async () => {
    const claim = await post({ ...BASE, messages: [{ role: "user", content: "hi", authority: "durable-server-board" }] });
    expect(claim.status).toBe(400);
    expect(await errorOf(claim)).toContain("authority-shaped key");
    const unknown = await post({ ...BASE, messages: [{ role: "user", content: "hi", metadata: {} }] });
    expect(unknown.status).toBe(400);
    expect(await errorOf(unknown)).toContain("unexpected key");
  });

  it("R5-adjacent (R3.7): a MISMATCHED client PCB revision hint fails closed as a corrupt/non-atomic editor context", async () => {
    const response = await post({ ...BASE, schematicState: SCHEMATIC, editorContext: editorContext({ pcbRevisionId: "pcb2-0000000000000000" }) });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toContain("corrupt or non-atomic editor context");
  });
});

// ─── §C — streaming bounded body reader ──────────────────────────────────────

describe("B10.1 §C — streaming request limit (R5)", () => {
  it("consumption STOPS at the byte ceiling: bytes after the limit are never read", async () => {
    const chunk = new Uint8Array(1_000_000).fill(120); // 1 MB per chunk
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled <= 12) controller.enqueue(chunk); // 12 MB offered
        else controller.close();
      },
    });
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as never));
    expect(response.status).toBe(413);
    // The limit (8 MB) is crossed on the 9th chunk — the reader cancels
    // there instead of consuming all 12 (pre-fix it pulled all 13).
    expect(pulled).toBeLessThanOrEqual(10);
    expect(pulled).toBeGreaterThanOrEqual(9);
  });

  it("a valid small body still parses after the bounded read; invalid UTF-8 refuses deterministically", async () => {
    const ok = await post({ ...BASE, messages: [] });
    expect(ok.status).toBe(400); // parses fine, refuses on empty messages
    expect(await errorOf(ok)).toContain("user message");
    const invalidUtf8 = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) }));
    expect(invalidUtf8.status).toBe(400);
    expect(await errorOf(invalidUtf8)).toContain("not valid UTF-8");
  });
});

// ─── §D — authority-neutral netlist contract ─────────────────────────────────

describe("B10.1 §D — authority-neutral netlist (R4)", () => {
  const digest = () => schematicStateDigest(SCHEMATIC);
  function assembleNetlist(netlist: unknown) {
    const assembly = assembleAgentRunContext({ ...SCOPE, schematic: SCHEMATIC, board: boardWithTrack(), netlist, editorSchematicDigest: digest() });
    if (!assembly.ok) throw new Error(assembly.reason);
    return assembly;
  }
  function projection(overrides?: Partial<AgentNetlistProjection>): AgentNetlistProjection {
    // [B10.2] the default is the exact server derivation; overrides create
    // the counterexamples.
    return { ...projectAgentNetlist(buildNetlist(SCHEMATIC)), ...overrides };
  }
  const CONTRACT_PINS = [{ number: "1", name: "left" }, { number: "2", name: "right" }];

  it("R4: a GHOST component (not in the verified schematic) refuses; a WRONG display reference refuses", () => {
    const ghost = projection({ components: [{ id: "ghost", ref: "GHOST1", pins: [{ number: "1" }] }], nets: [] });
    expect(validateAgentNetlistProjection(ghost, SCHEMATIC).some((issue) => issue.includes("not a component of the verified schematic"))).toBe(true);
    const wrongRef = projection({ components: [{ id: "r1", ref: "R99", pins: CONTRACT_PINS }], nets: [] });
    expect(validateAgentNetlistProjection(wrongRef, SCHEMATIC).some((issue) => issue.includes("does not agree with the schematic's display reference"))).toBe(true);
    const assembly = assembleNetlist(ghost);
    expect(assembly.context.netlist).toBeNull();
    expect(assembly.warnings.some((warning) => warning.includes("netlist resource was withheld"))).toBe(true);
  });

  it("duplicate endpoint ACROSS nets refuses; endpointKeys/nodes disagreement refuses; duplicate identities refuse", () => {
    const key1 = schematicEndpointKey("r1", "1");
    const crossNet = projection({
      nets: [
        { id: 1, name: "A", nodes: [{ componentId: "r1", pinNumber: "1" }], endpointKeys: [key1] },
        { id: 2, name: "B", nodes: [{ componentId: "r1", pinNumber: "1" }], endpointKeys: [key1] },
      ],
    });
    expect(validateAgentNetlistProjection(crossNet, SCHEMATIC).some((issue) => issue.includes("multiple nets"))).toBe(true);
    const disagreement = projection({
      nets: [{ id: 1, name: "A", nodes: [{ componentId: "r1", pinNumber: "1" }], endpointKeys: [schematicEndpointKey("r1", "2")] }],
    });
    expect(validateAgentNetlistProjection(disagreement, SCHEMATIC).some((issue) => issue.includes("do not agree exactly"))).toBe(true);
    const duplicateNet = projection({
      nets: [
        { id: 1, name: "A", nodes: [], endpointKeys: [] },
        { id: 1, name: "B", nodes: [], endpointKeys: [] },
      ],
    });
    expect(validateAgentNetlistProjection(duplicateNet, SCHEMATIC).some((issue) => issue.includes("duplicate net identity"))).toBe(true);
  });

  it("authority-bearing fields REFUSE by name server-side AND are absent from the transported projection", () => {
    const hostile = {
      schema: AGENT_NETLIST_SCHEMA,
      components: [{ id: "r1", ref: "r1", pins: [{ number: "1" }], pinPadMapping: { certified: true } }],
      nets: [],
    };
    expect(validateAgentNetlistProjection(hostile, SCHEMATIC).some((issue) => issue.includes("authority-shaped field"))).toBe(true);
    const atomic = { schema: AGENT_NETLIST_SCHEMA, components: [{ id: "r1", ref: "r1", pins: [{ number: "1" }], atomicAssignment: { approved: true } }], nets: [] };
    expect(validateAgentNetlistProjection(atomic, SCHEMATIC).some((issue) => issue.includes("authority-shaped field"))).toBe(true);

    // The browser-side projection STRIPS every authority-bearing field.
    // [B10.2] the "live" netlist is the REAL derivation with injected
    // authority-bearing fields — projection must strip them and the result
    // must still be provably the derivation.
    const derived = buildNetlist(SCHEMATIC);
    const full: PcbNetlist = {
      components: derived.components.map((component) => ({
        ...component, mpn: "RC0603", package: "0603",
        footprintHint: "Resistor_SMD:R_0603",
        pinPadMapping: { certified: true } as never,
        atomicPartRevisionId: "rev-9",
        atomicAssignment: { revisionId: "r", symbolVersionId: "s", footprintVersionId: "f", mappingCertificateId: "m", footprintFullName: "x", approved: true },
      })),
      nets: derived.nets,
    };
    const projected = projectAgentNetlist(full);
    expect(JSON.stringify(projected)).not.toMatch(/pinPadMapping|atomicAssignment|atomicPartRevisionId|mpn|footprintHint|package/);
    expect(projected.components[0]!.pins[0]).toEqual({ number: "1", name: "left" });
    // …and the SAME projection passes the server contract and seals.
    expect(validateAgentNetlistProjection(projected, SCHEMATIC)).toEqual([]);
    const assembly = assembleNetlist(projected);
    expect(assembly.context.netlist).not.toBeNull();
    expect(JSON.stringify(assembly.context.netlist)).not.toContain("pinPadMapping");
  });

  it("board/netlist disagreement stays a READINESS diagnosis, not a malformed resource: a valid projection seals even though the board has no matching footprints", () => {
    const assembly = assembleNetlist(projection());
    expect(assembly.context.netlist).not.toBeNull(); // board is empty of footprints — still sealed
  });
});
