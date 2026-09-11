/**
 * [B18-C I9] Scenario 8 — the never-execution sweep over the WHOLE production
 * registry, through the REAL gateway with a REAL minter bound (explicit
 * autonomy, an explicit-looking message, a grantable run) and without one:
 *
 *  - no mutate / destructive / release descriptor outside the reviewed
 *    granted-execution list, and nothing in a Tier 3 family, ever yields an
 *    execution grant — and the minter is never called for one; every other
 *    descriptor (read, propose, view-session) can never be a granted execution;
 *  - a reviewed execution forced to Tier 2 is refused by the seal
 *    (`tier_exceeded`); the canonical never-granted COMMAND rule refuses a
 *    renamed tool whatever its id;
 *  - nested delegation — arguments naming another tool, an approval, a grant or
 *    a follow-up call — is refused as invalid under the strict key grammar and
 *    mints nothing.
 */
import { describe, expect, it } from "vitest";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway } from "../gateway";
import { sealExecutionIntent } from "../execution-intents";
import type { AgentExecutionGrantMinter, AgentRunContext } from "../contracts";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { GRANTED_EXECUTION_TOOLS, GRANTED_EXECUTION_TOOL_IDS, NEVER_GRANTED_COMMAND_IDS, grantedExecutionViolations, isGrantedExecutionDescriptor, type GrantedExecutionTool } from "../../engineering/granted-execution-families";
import { TIER3_FAMILY_PATTERN, defaultAutonomySetting, permissionTierOfDescriptor, type AgentAutonomySetting } from "../../engineering/permission-tiers";
import type { ExecutionFamily } from "../../engineering/execution-grant";
import type { ToolDescriptor } from "../../engineering/tool-registry";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { ExecutionGrantStore } from "../../execution-grant/store";
import { createExecutionGrantMinter } from "../../execution-grant/mint";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { AGENT_SYSTEM_PROMPT_VERSION } from "../../prompts";

const SCOPE = { tenantId: "local", projectId: "p18", branchId: "main" };
const T0 = Date.parse("2026-09-11T12:00:00.000Z");
const registry = sirkitToolRegistry();
const BOARD = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
const R3 = BOARD.footprints.find((f) => f.ref === "R3")!;
const BASIS = { historyHeadSequence: 4, historyHeadLabel: null, lineageId: "lin1-0000000000000001", activeDrcPresetId: DEFAULT_PRESET_ID };
const MOVE_ARGS = { moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(2), y: R3.at.y }] };
const EXPLICIT: AgentAutonomySetting = { ...defaultAutonomySetting(SCOPE), mode: "execute_explicit_tier1", revision: 1, updatedAt: "2026-09-11T11:00:00.000Z", updatedBy: { principalId: "u-admin", membershipRevision: "mbr1-z", role: "project_admin" } };

function context(): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE, board: BOARD, pcbProposalBasis: BASIS,
    verifiedActor: { principalId: "u-1", actorRole: "project_admin", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    executionGrantsAvailable: true,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
function minting(): { minter: AgentExecutionGrantMinter; calls: () => number } {
  let seq = 0;
  let calls = 0;
  const real = createExecutionGrantMinter({
    principalId: "u-1", role: "project_admin", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-1", correlationId: "corr-sweep",
    scope: SCOPE, boardInstanceId: null, autonomy: EXPLICIT, userMessage: "Move R3 2 mm to the right.",
    runId: "run-sweep", provider: "openai", store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), now: () => T0, randomHex: () => (seq += 1).toString(16).padStart(32, "c"),
  });
  return { minter: { mint: (request) => { calls += 1; return real.mint(request); }, awaitSettlement: (id, o) => real.awaitSettlement(id, o), retireIssued: (r, e) => real.retireIssued(r, e) }, calls: () => calls };
}
const RISKY_CLASSES = new Set(["mutate", "destructive", "release"]);
const risky = (descriptor: ToolDescriptor): boolean => RISKY_CLASSES.has(descriptor.operationClass) || TIER3_FAMILY_PATTERN.test(descriptor.toolId) || permissionTierOfDescriptor(descriptor) === 3;

describe("B18-C I9 — the never-execution sweep (scenario 8)", () => {
  it("no risky descriptor outside the reviewed list ever yields an execution grant, with or without a minter, and the minter is never called for one; nothing else can ever be a granted execution", async () => {
    const m = minting();
    const gateways = [createAgentToolGateway(registry, { executionGrants: m.minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION }), createAgentToolGateway(registry, { promptVersion: AGENT_SYSTEM_PROMPT_VERSION })];
    const ctx = context();
    const sweep = registry.list().filter((descriptor) => risky(descriptor) && !GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId));
    expect(sweep.length).toBeGreaterThan(0);
    for (const descriptor of sweep) {
      for (const gateway of gateways) {
        const outcome = await gateway.invoke({ runId: "run-sweep", provider: "openai", toolId: descriptor.toolId, version: descriptor.version, args: {}, context: ctx, timeoutMs: 5_000, callId: `call-${descriptor.toolId}` });
        expect(outcome.kind, descriptor.toolId).not.toBe("execution-grant");
        expect(outcome.ok, descriptor.toolId).toBe(false);
      }
    }
    expect(m.calls()).toBe(0);
    for (const descriptor of registry.list().filter((item) => !risky(item))) {
      expect(isGrantedExecutionDescriptor(descriptor), descriptor.toolId).toBe(false);
      expect(grantedExecutionViolations(descriptor).length, descriptor.toolId).toBeGreaterThan(0);
    }
    for (const descriptor of registry.list().filter((item) => ["destructive", "release"].includes(item.operationClass) || TIER3_FAMILY_PATTERN.test(item.toolId))) {
      expect(GRANTED_EXECUTION_TOOL_IDS, descriptor.toolId).not.toContain(descriptor.toolId);
    }
  });

  it("a reviewed execution forced to Tier 2 is refused by the seal; the never-granted COMMAND rule refuses a renamed tool whatever its id", () => {
    const move = registry.get("sirkit.pcb.move-footprint")!;
    expect(sealExecutionIntent({ descriptor: { ...move, approvalTier: "topology-or-geometry" }, args: MOVE_ARGS, context: context() })).toMatchObject({ ok: false, status: "tier_exceeded" });
    for (const command of NEVER_GRANTED_COMMAND_IDS) {
      const renamed: ToolDescriptor = { ...move, toolId: `sirkit.pcb.renamed-${command.replace(/[^a-z0-9]+/gi, "-")}`, owningCommandId: command, binding: { ...move.binding, canonicalCommandId: command } };
      const rows: GrantedExecutionTool[] = [...GRANTED_EXECUTION_TOOLS, { toolId: renamed.toolId, family: command as ExecutionFamily, reason: "test: a reviewed-looking row for a never-granted command" }];
      expect(grantedExecutionViolations(renamed, rows), command).toContain(`canonical command ${command} can never be granted`);
      expect(sealExecutionIntent({ descriptor: renamed, args: MOVE_ARGS, context: context() }), command).toMatchObject({ ok: false, status: "not_callable" });
    }
  });

  it("nested delegation — another tool, an approval, a grant or a follow-up call named in the arguments — is refused as invalid and mints nothing", async () => {
    const m = minting();
    const gateway = createAgentToolGateway(registry, { executionGrants: m.minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION });
    const move = registry.get("sirkit.pcb.move-footprint")!;
    const cases: Array<[string, Record<string, unknown>]> = [
      ["another tool", { ...MOVE_ARGS, toolId: "sirkit.pcb.delete-item" }],
      ["an approval", { ...MOVE_ARGS, approval: { approved: true } }],
      ["a grant", { ...MOVE_ARGS, grantId: `xg-${"0".repeat(32)}` }],
      ["a follow-up call", { ...MOVE_ARGS, then: { toolId: "sirkit.manufacturing.release", args: {} } }],
      ["a smuggled field inside a move", { moves: [{ ...MOVE_ARGS.moves[0], approved: true }] }],
    ];
    for (const [label, args] of cases) {
      const outcome = await gateway.invoke({ runId: "run-sweep", provider: "openai", toolId: move.toolId, version: move.version, args, context: context(), timeoutMs: 5_000, callId: `call-${label}` });
      expect(outcome, label).toMatchObject({ kind: "refused", ok: false });
      expect((outcome as { status: string }).status, label).toMatch(/invalid/);
    }
    expect(m.calls()).toBe(0);
  });
});
