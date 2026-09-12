/**
 * [B18-C I2] `/api/chat` derives ONE server fact — a human session principal
 * with a readable autonomy setting — and uses it for BOTH the execution-grant
 * minter binding and the context assembly (grantability additionally needs a
 * Tier 1 execute role, the verified board and the PCB history basis, derived
 * by the assembler). The gateway and the loop receive the SAME minter closure
 * and the gateway the system prompt version; an unreadable autonomy setting
 * binds nothing and the run stays proposal-only. Driven through the
 * PRODUCTION POST handler (controlled adapter; the real loop runs).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { DurableAgentAutonomyRepository, resetAgentAutonomyRepositoryFactory, setAgentAutonomyRepositoryFactory, type resolveAgentAutonomyRepository } from "@/app/lib/agent/autonomy-store";
import { ExecutionGrantStore, resetExecutionGrantStoreFactory, setExecutionGrantStoreFactory } from "@/app/lib/execution-grant/store";
import { AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";

const state = vi.hoisted(() => ({
  observed: [] as Array<{ gatewayMinter: unknown; promptVersion: unknown; loopMinter: unknown; flag: boolean; ceiling: string; grantable: readonly string[]; role: string; warnings: readonly string[] }>,
  lastGateway: { executionGrants: undefined as unknown, promptVersion: undefined as unknown },
}));

vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start() { return { text: "ok", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "scripted", continuation: { provider: "openai", state: null } }; },
    async continueWith() { throw new Error("not used"); },
  }),
}));

vi.mock("@/app/lib/agent/gateway", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/gateway")>();
  return {
    ...original,
    createAgentToolGateway: (...args: Parameters<typeof original.createAgentToolGateway>) => {
      state.lastGateway = { executionGrants: args[1]?.executionGrants, promptVersion: args[1]?.promptVersion };
      return original.createAgentToolGateway(...args);
    },
  };
});

vi.mock("@/app/lib/agent/loop", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/loop")>();
  return {
    ...original,
    runAgentLoop: async (...args: Parameters<typeof original.runAgentLoop>) => {
      const deps = args[1];
      state.observed.push({
        gatewayMinter: state.lastGateway.executionGrants, promptVersion: state.lastGateway.promptVersion, loopMinter: deps.executionGrants,
        flag: deps.context.executionGrantsAvailable, ceiling: deps.context.discovery.riskCeiling, grantable: deps.context.discovery.grantableCapabilities ?? [],
        role: deps.context.actor.actorRole, warnings: deps.contextWarnings ?? [],
      });
      return original.runAgentLoop(...args);
    },
  };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";

const SCOPE = { tenantId: "local", projectId: "p18c", branchId: "main" };
const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
// The wire form of the board (what the route validates and re-digests).
const BOARD = JSON.parse(JSON.stringify(makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2)));
const BASIS = { historyHeadSequence: 4, historyHeadLabel: null, lineageId: "lin1-0000000000000001", activeDrcPresetId: DEFAULT_PRESET_ID };

function body(options: { basis?: boolean } = {}) {
  return {
    provider: "openai", messages: [{ role: "user", content: "Move R3 2 mm to the right." }], scope: SCOPE, schematicState: SCHEMATIC,
    editorContext: {
      schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board: BOARD, pcbRevisionId: pcbRevisionId(BOARD), selection: { refs: [], primary: null }, netlist: null,
      schematicDigest: schematicStateDigest(SCHEMATIC), authoritySource: "local-working-copy", ...(options.basis === false ? {} : { pcbProposalBasis: BASIS }),
    },
  };
}
async function post(payload: unknown): Promise<{ status: number; text: string }> {
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
  // Drain the stream so the run (inside the stream's start) completes.
  const text = await response.text();
  return { status: response.status, text };
}

beforeEach(() => {
  setExecutionGrantStoreFactory(() => new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()));
});
afterEach(() => {
  state.observed.length = 0;
  state.lastGateway = { executionGrants: undefined, promptVersion: undefined };
  resetAgentAutonomyRepositoryFactory();
  resetExecutionGrantStoreFactory();
});

describe("B18-C I2 — /api/chat: one fact binds the minter and tells assembly", () => {
  it("a readable autonomy setting + the local human principal + board + basis: the SAME minter closure reaches the gateway and the loop, the gateway gets the prompt version, and the context is grantable", async () => {
    setAgentAutonomyRepositoryFactory(() => new DurableAgentAutonomyRepository(new InMemoryDurableWorkflowRepository()));
    const { status, text } = await post(body());
    expect(status, text.slice(0, 300)).toBe(200);
    expect(state.observed).toHaveLength(1);
    const run = state.observed[0]!;
    expect(run.loopMinter).toBeDefined();
    expect(run.gatewayMinter).toBe(run.loopMinter);
    expect(run.promptVersion).toBe(AGENT_SYSTEM_PROMPT_VERSION);
    expect(run).toMatchObject({ flag: true, ceiling: "mutate", grantable: ["edit_placement"] });
  });

  it("the same fact without a PCB basis: the minter is bound but the context is NOT grantable (no lineage to pin a grant to)", async () => {
    setAgentAutonomyRepositoryFactory(() => new DurableAgentAutonomyRepository(new InMemoryDurableWorkflowRepository()));
    const { status } = await post(body({ basis: false }));
    expect(status).toBe(200);
    const run = state.observed[0]!;
    expect(run.loopMinter).toBeDefined();
    expect(run.gatewayMinter).toBe(run.loopMinter);
    expect(run).toMatchObject({ flag: false, ceiling: "propose", grantable: [] });
  });

  it("an unreadable autonomy setting binds NOTHING: no minter anywhere, the context is not grantable and the run says it is proposal-only", async () => {
    const failing = { async get() { throw new Error("autonomy store unavailable"); } } as unknown as ReturnType<typeof resolveAgentAutonomyRepository>;
    setAgentAutonomyRepositoryFactory(() => failing);
    const { status } = await post(body());
    expect(status).toBe(200);
    const run = state.observed[0]!;
    expect(run.loopMinter).toBeUndefined();
    expect(run.gatewayMinter).toBeUndefined();
    expect(run.promptVersion).toBe(AGENT_SYSTEM_PROMPT_VERSION);
    expect(run).toMatchObject({ flag: false, ceiling: "propose", grantable: [] });
    expect(run.warnings).toContain("The project's agent autonomy setting could not be read; this run is proposal-only.");
  });
});
