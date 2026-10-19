/**
 * [PR-L6 integration, 2026-10-19] F6 (the engine review of increment 6): the chat's task inspection answers for a REACHABLE large head.
 *
 * Increment 6 added `plan.coverage`, filled `plan.assumptions` and `block.missing` to the public snapshot. At their bounds (8 blocks
 * waiting at S6 with 3 reported roles each - role 120, query 200, category 64 characters - 8 assumptions and 8 coverage lines of 200, a
 * 600-character rationale, 8 activity lines) the projection exceeds GENERATION_TASK_INSPECT_MAX_CHARS, and the inspection refused as
 * invalid_output - exactly when chat must report the blocker (L.7 item 8). The bound is kept; an oversized projection is shortened
 * (queries, then categories, then extra roles, then trailing assumptions and coverage, then old activity) and marked `truncated`.
 *
 *  1. the worst-case head inspects as a bounded read (`truncated: true`), every block still naming its first missing role;
 *  2. a report that fits is returned unchanged (no `truncated` key).
 *
 * The real gateway and inspection service over a fake task port (no store, no provider, no database, no network).
 */
import { describe, expect, it } from "vitest";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { createEmptyBoard } from "../../pcb/types";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway } from "../gateway";
import type { AgentRunContext, GatewayInvocationOutcome } from "../contracts";
import type { SchematicGenerationPort } from "../generation-proposals";
import { GENERATION_TASK_INSPECT_MAX_CHARS, GENERATION_TASK_INSPECT_TOOL_ID } from "../generation-task-tools";

const registry = sirkitToolRegistry();
const T0 = Date.parse("2026-10-19T09:00:00.000Z");
const TASK_ID = `generation-task:${"ab".repeat(16)}`;
const text = (label: string, length: number) => `${label} `.padEnd(length, "x");

/** A public snapshot at increment 6's bounds (the shape buildGenerationTaskSnapshot answers; the projection is an allowlist copy). */
function snapshot(large: boolean): Record<string, unknown> {
  const blocks = Array.from({ length: 8 }, (_, index) => ({
    blockId: `b${index + 1}`, name: text(`Block ${index + 1}`, large ? 120 : 20), status: "blocked", strategy: "S6-missing-part", turnsUsed: 6, blocker: "missing_part",
    missing: Array.from({ length: large ? 3 : 1 }, (_, role) => ({ role: text(`role ${index}.${role}`, large ? 120 : 30), query: text(`query ${index}.${role}`, large ? 200 : 30), category: text("Category", large ? 64 : 12) })),
  }));
  return {
    schema: "sirkit.generation-task-snapshot.v1", taskId: TASK_ID, scope: { tenantId: "local", projectId: "proj-1", branchId: "main" },
    state: "waiting-for-resource", terminal: false, phase: "blocked", origin: "chat", provider: "openai", createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), serverNow: new Date(T0).toISOString(),
    liveness: "idle",
    plan: { planner: "planned", rationale: text("Rationale", large ? 600 : 40), assumptions: Array.from({ length: 8 }, (_, index) => text(`assumption ${index}`, large ? 200 : 30)), coverage: Array.from({ length: 8 }, (_, index) => text(`coverage ${index}`, large ? 200 : 30)), blocks },
    blocker: { code: "missing_part", message: text("A part is missing", 400), resolution: text("Add or approve the part", 400), evidence: null },
    failure: null, usage: { modelCalls: 40, catalogSearches: 90 }, allowance: { units: 1 }, base: null, result: null, review: null, control: { cancelRequested: false },
    actions: ["retry-block", "review-partial"], retryBlocks: blocks.map((block) => block.blockId), eventCursor: "e-1",
    activity: Array.from({ length: 8 }, (_, index) => ({ at: new Date(T0 + index).toISOString(), text: text(`activity ${index}`, 160) })),
  };
}
function port(task: Record<string, unknown>): SchematicGenerationPort {
  return {
    durability: "durable",
    start: async () => ({ status: 500, body: {} }),
    list: async () => ({ status: 200, body: { active: task, recent: [] } }),
    inspect: async () => ({ status: 200, body: { task } }),
  };
}
function context(): AgentRunContext {
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "proj-1", branchId: "main", schematic: { components: [], wires: [], netLabels: [], kicadComponents: [], pageSize: "A4" }, board: createEmptyBoard(),
    schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" },
    verifiedActor: { principalId: "u1", actorRole: "pcb_editor", membershipRevision: "mbr1-l6", authMethod: "local_dev" }, schematicGenerationAvailable: true,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
function inspect(task: Record<string, unknown>): Promise<GatewayInvocationOutcome> {
  const gateway = createAgentToolGateway(registry, { schematicGeneration: port(task), now: () => T0 });
  return gateway.invoke({ runId: "run-l6-inspect", provider: "openai", callId: "call-1", toolId: GENERATION_TASK_INSPECT_TOOL_ID, version: registry.get(GENERATION_TASK_INSPECT_TOOL_ID)!.version, args: { taskId: TASK_ID }, context: context(), timeoutMs: 10_000 });
}

describe("[PR-L6 integration] F6: the task inspection fits its bound instead of refusing", () => {
  it("1. the worst-case head inspects as a bounded, truncated read; every block still names its first missing role", async () => {
    const task = snapshot(true);
    expect(JSON.stringify(task).length).toBeGreaterThan(GENERATION_TASK_INSPECT_MAX_CHARS); // reachable above the bound
    const outcome = await inspect(task);
    expect(outcome, JSON.stringify(outcome).slice(0, 300)).toMatchObject({ kind: "read", ok: true });
    if (outcome.kind !== "read") throw new Error("read expected");
    expect(JSON.stringify(outcome.output).length).toBeLessThanOrEqual(GENERATION_TASK_INSPECT_MAX_CHARS);
    const report = (outcome.output as { report: Record<string, any> }).report; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(report.truncated).toBe(true);
    expect(report.truncation).toMatch(/shortened to fit its bound/);
    expect(report.task.state).toBe("waiting-for-resource");
    expect(report.task.blocker.code).toBe("missing_part");
    for (const [index, block] of (report.task.plan.blocks as Array<{ missing: Array<{ role: string }> }>).entries()) expect(block.missing[0]!.role).toContain(`role ${index}.0`);
  });

  it("2. a report that fits is returned unchanged", async () => {
    const outcome = await inspect(snapshot(false));
    if (outcome.kind !== "read") throw new Error(`read expected: ${JSON.stringify(outcome).slice(0, 300)}`);
    const report = (outcome.output as { report: Record<string, unknown> }).report;
    expect(report).not.toHaveProperty("truncated");
    expect((report.task as { plan: { blocks: Array<{ missing: unknown[] }> } }).plan.blocks[0]!.missing[0]).toHaveProperty("query");
  });
});
