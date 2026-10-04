/**
 * [B23-A2] The Tier 3 vocabulary (OD-173, D23-8, D23-12): data leaving Sirkit is Tier 3 by STRUCTURE, never only by a word in an id.
 *
 * A new side effect, `external-transfer` (a tool side effect and its action-registry equivalent), computes Tier 3 wherever a tier is
 * computed, whatever the id, class or approval tier says. A forged descriptor carrying it under an innocuous id is Tier 3, never
 * agent-exposed, never MCP-listed, outside every B21 role row and refused by the never-execution sweep. The id floor gains OD-173's
 * seven stems only after a census over the generated tool and action CSVs proves that no current id changes tier (B22's five
 * computation ids included) and no B21 role row changes; the router's nine chat families stay as B21 pinned them. The B21 withdrawal
 * drops every `external-*` authority and keeps dropping B22's `computation-engine`; the chat-closure tripwire forbids the egress
 * module and the provider directory; a consumed MCP server row may not approve a tool whose name matches the floor.
 *
 * [B23-A2 review] The sweep cases run on registry DOUBLES that skip the validator, so only the side effect can stop what they hold
 * (with controls proving each double is not vacuous); discovery refuses the side effect itself; the floor gains the word `pay`, the
 * consumed-tool name floor gains the money and data-leaving words, and the agent port applies that floor too.
 *
 * No network, no model and no provider call; nothing is written to disk.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import type { AgentExecutionGrantMinter, AgentRunContext } from "@/app/lib/agent/contracts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { sealExecutionIntent } from "@/app/lib/agent/execution-intents";
import { TIER3_FAMILIES } from "@/app/lib/agent/orchestration/router";
import { INTENTIONAL_ROLE_TOOL_IDS, roleExposureReport, roleToolViolations } from "@/app/lib/agent/orchestration/role-tools";
import { SPECIALIST_CONTEXT_CLAIMS, deriveSpecialistContext, isWithdrawnAuthority, specialistContextClaims, withdrawAuthority } from "@/app/lib/agent/orchestration/scheduler";
import { SPECIALIST_ROLES } from "@/app/lib/agent/orchestration/contracts";
import { ACTION_COVERAGE_REGISTRY, ACTION_SIDE_EFFECTS, validateActionCoverageRegistry, type ActionCoverageRecord } from "@/app/lib/engineering/action-registry";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure";
import type { ExecutionFamily } from "@/app/lib/engineering/execution-grant";
import { GRANTED_EXECUTION_TOOLS, grantedExecutionViolations, type GrantedExecutionTool } from "@/app/lib/engineering/granted-execution-families";
import { MCP_EXCLUSION_REASONS, mcpExclusionReason, mcpExposureReport } from "@/app/lib/engineering/mcp-exposure";
import {
  EXTERNAL_TRANSFER_SIDE_EFFECT, TIER3_B23_STEMS, TIER3_FAMILY_PATTERN, TIER3_FLOOR_PATTERN, decideAgentExecution, defaultAutonomySetting,
  permissionTierOfAction, permissionTierOfApproval, permissionTierOfDescriptor, type AgentAutonomySetting, type PermissionTier,
} from "@/app/lib/engineering/permission-tiers";
import { discoverTools } from "@/app/lib/engineering/tool-discovery";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { TOOL_AUTHORITY_SOURCES, TOOL_SIDE_EFFECTS, ToolRegistry, validateToolDescriptor, type ToolDescriptor } from "@/app/lib/engineering/tool-registry";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { ExecutionGrantStore } from "@/app/lib/execution-grant/store";
import { createExecutionGrantMinter } from "@/app/lib/execution-grant/mint";
import { mcpAgentRoster, mcpAgentToolAllowlist } from "@/app/lib/mcp/agent-port";
import { MCP_SERVER_REGISTRY, validateMcpServerRegistry } from "@/app/lib/mcp/server-registry";
import { mcpToolsListDigest } from "@/app/lib/mcp/tool-discovery";
import { fixtureServer } from "@/app/lib/mcp/__tests__/_fixtures";
import { tool, wideServer } from "@/app/lib/mcp/__tests__/_fake-mcp-server";
import { importClosure } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { mmToNm } from "@/app/lib/pcb/units";
import { AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const registry = sirkitToolRegistry();
const KNOWN_COMMANDS = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const SCOPE = { tenantId: "t-b23a2", projectId: "p-b23a2", branchId: "main" };
const T0 = Date.parse("2026-10-02T12:00:00.000Z");
const BOARD = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
const R3 = BOARD.footprints.find((footprint) => footprint.ref === "R3")!;
/** b18-c-never-execution-sweep's MOVE_ARGS: one valid move, so a seal can refuse only on what it is testing. */
const MOVE_ARGS = { moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(2), y: R3.at.y }] };
const BASIS = { historyHeadSequence: 4, historyHeadLabel: null, lineageId: "lin1-0000000000000001", activeDrcPresetId: DEFAULT_PRESET_ID };
const EXPLICIT: AgentAutonomySetting = { ...defaultAutonomySetting(SCOPE), mode: "execute_explicit_tier1", revision: 1, updatedAt: "2026-10-02T11:00:00.000Z", updatedBy: { principalId: "u-admin", membershipRevision: "mbr1-z", role: "project_admin" } };
/** The nine stems at 79fa18b, the router's chat families: the floor B21 pinned. */
const FAMILY_STEMS = ["release", "publish", "publica", "upload", "order", "purchas", "qualif", "ship", "deliver"];
const B23_STEMS = ["quote", "dfm", "submit", "checkout", "cart", "buy", "payment"];
/** [B23-A2 review security-5] the word-bounded `pay` (a bare stem would catch payload and display), OD-182 (h). */
const PAY_WORD = "(?<![a-z0-9])pay(?![a-z0-9])";
const B23_STEM_PATTERN = new RegExp(`(${[...B23_STEMS, PAY_WORD].join("|")})`, "i");

/** A forged descriptor under an innocuous id: the board read, renamed, carrying the external-transfer side effect, not exposed. */
const INNOCUOUS_ID = "sirkit.pcb.board-share";
function forged(over: Partial<ToolDescriptor> = {}): ToolDescriptor {
  const base = registry.get("sirkit.pcb.board-inspect")!;
  return { ...base, toolId: INNOCUOUS_ID, title: "Board share", description: "Shares the current board with a third party.", sideEffects: "external-transfer", agentExposed: false, ...over };
}
/** [B23-A2 review tests-1] A registry DOUBLE that skips `validateToolDescriptor` - a crafted registry no production path builds (the
 *  ToolRegistry constructor validates every descriptor and refuses an exposed transfer): the real class's methods over exactly
 *  these descriptors and granted rows, so only the rule a case names can stop what it holds. */
function unvalidated(descriptors: readonly ToolDescriptor[], granted: readonly GrantedExecutionTool[] = GRANTED_EXECUTION_TOOLS): ToolRegistry {
  const ordered = Object.freeze([...descriptors].sort((a, b) => a.toolId.localeCompare(b.toolId) || a.version.localeCompare(b.version)));
  const byKey = new Map(descriptors.map((descriptor) => [`${descriptor.toolId}@${descriptor.version}`, descriptor] as const));
  return Object.assign(Object.create(ToolRegistry.prototype) as object, { byKey, ordered, grantedTools: Object.freeze([...granted]) }) as unknown as ToolRegistry;
}
/** The tier rule at 79fa18b (before B23-A2): the nine-stem floor, then the approval vocabulary. */
const legacyToolTier = (descriptor: ToolDescriptor): PermissionTier => (TIER3_FAMILY_PATTERN.test(descriptor.toolId) ? 3 : permissionTierOfApproval(descriptor.approvalTier, descriptor.operationClass));
const legacyActionTier = (record: ActionCoverageRecord): PermissionTier =>
  (TIER3_FAMILY_PATTERN.test(record.id) ? 3 : record.area === "view" && record.approvalTier === "none" ? 0 : permissionTierOfApproval(record.approvalTier, record.kind));
/** The first column of a generated CSV (an id never holds a comma or a quote). */
const csvIds = (path: string): string[] => read(path).split(NEWLINE).slice(1).filter((line) => line !== "").map((line) => line.split(",")[0]!);

function context(options: { computation?: boolean } = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE, board: BOARD, pcbProposalBasis: BASIS,
    verifiedActor: { principalId: "u-1", actorRole: "project_admin", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    executionGrantsAvailable: true, externalAcquisitionAvailable: true, mcpObservationAvailable: true, ...(options.computation === false ? {} : { computationAvailable: true }),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
function minting(userMessage = "Share the board with the fab."): { minter: AgentExecutionGrantMinter; calls: () => number } {
  let seq = 0;
  let calls = 0;
  const real = createExecutionGrantMinter({
    principalId: "u-1", role: "project_admin", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-1", correlationId: "corr-b23a2",
    scope: SCOPE, boardInstanceId: null, autonomy: EXPLICIT, userMessage,
    runId: "run-b23a2", provider: "openai", store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), now: () => T0, randomHex: () => (seq += 1).toString(16).padStart(32, "d"),
  });
  return { minter: { mint: (request) => { calls += 1; return real.mint(request); }, awaitSettlement: (id, o) => real.awaitSettlement(id, o), retireIssued: (r, e) => real.retireIssued(r, e) }, calls: () => calls };
}

describe("[B23-A2] the Tier 3 vocabulary (OD-173)", () => {
  it("1. external-transfer is a tool side effect and its action-registry equivalent; a forged descriptor carrying it under an innocuous id is Tier 3 whatever its class, approval tier or id says, and never executes; without it the same descriptor is Tier 0 - the side effect, not a word, makes it Tier 3", () => {
    expect(TOOL_SIDE_EFFECTS).toContain("external-transfer");
    expect([...ACTION_SIDE_EFFECTS]).toEqual(["external-transfer"]);
    expect(EXTERNAL_TRANSFER_SIDE_EFFECT).toBe("external-transfer");
    const descriptor = forged();
    expect(TIER3_FLOOR_PATTERN.test(descriptor.toolId), "the id is innocuous").toBe(false);
    expect(validateToolDescriptor(descriptor, KNOWN_COMMANDS), "a forged, unexposed transfer read is a well-formed descriptor").toEqual([]);
    for (const operationClass of ["read", "propose", "view-session", "mutate", "destructive", "release"] as const) {
      for (const approvalTier of ["none", "reversible", "topology-or-geometry", "destructive", "release"] as const) {
        expect(permissionTierOfDescriptor({ ...descriptor, operationClass, approvalTier }), `${operationClass} / ${approvalTier}`).toBe(3);
      }
    }
    expect(permissionTierOfDescriptor({ ...descriptor, sideEffects: "none" }), "the same read without the side effect").toBe(0);
    expect(permissionTierOfDescriptor({ ...descriptor, sideEffects: "derived-cache" })).toBe(0);
    for (const actorRole of ["project_admin", "pcb_editor", "viewer"] as const) {
      expect(decideAgentExecution({ tier: permissionTierOfDescriptor(descriptor), setting: EXPLICIT, actorRole, explicitUserRequest: true }), actorRole).toMatchObject({ tier: 3, decision: "never", requiresGrant: false });
    }
    // the action equivalent: a read record and a view record (the view shortcut is Tier 0) both become Tier 3 with the side effect
    const readRecord = ACTION_COVERAGE_REGISTRY.find((record) => record.kind === "read" && record.approvalTier === "none" && record.area !== "view" && !TIER3_FLOOR_PATTERN.test(record.id))!;
    const viewRecord = ACTION_COVERAGE_REGISTRY.find((record) => record.area === "view" && record.approvalTier === "none" && !TIER3_FLOOR_PATTERN.test(record.id))!;
    for (const record of [readRecord, viewRecord]) {
      expect(permissionTierOfAction(record), record.id).toBe(0);
      expect(permissionTierOfAction({ ...record, sideEffects: "external-transfer" }), record.id).toBe(3);
    }
    // a record that carries it is never tool-exposed, and only the closed vocabulary validates
    const exposedRecord = ACTION_COVERAGE_REGISTRY.find((record) => record.toolExposure !== "none" && record.status !== "ui-only")!;
    expect(validateActionCoverageRegistry([...ACTION_COVERAGE_REGISTRY.filter((record) => record.id !== exposedRecord.id), { ...exposedRecord, sideEffects: "external-transfer" }])).toEqual([`${exposedRecord.id}: an external-transfer action is never tool-exposed (Tier 3: data leaves Sirkit, OD-173)`]);
    expect(validateActionCoverageRegistry([...ACTION_COVERAGE_REGISTRY.filter((record) => record.id !== exposedRecord.id), { ...exposedRecord, sideEffects: "upload" as never }])).toEqual([`${exposedRecord.id}: unknown side effect (the closed vocabulary is external-transfer)`]);
    expect(validateActionCoverageRegistry([...ACTION_COVERAGE_REGISTRY.filter((record) => record.id !== exposedRecord.id), { ...exposedRecord, toolExposure: "none", sideEffects: "external-transfer" }])).toEqual([]);
  });

  it("2. never agent-exposed, never discovered for an agent, never MCP-listed and outside every B21 role row: the validator refuses an exposed transfer, the exposure rule refuses the side effect, the MCP rule answers tier3 first, and a role row holding it is refused by the side effect alone", () => {
    const exposed = forged({ agentExposed: true });
    expect(validateToolDescriptor(exposed, KNOWN_COMMANDS)).toEqual([`${INNOCUOUS_ID}@${exposed.version}: an external-transfer tool can never be agent-exposed (Tier 3: data leaves Sirkit, OD-173)`]);
    expect(() => new ToolRegistry([...registry.list(), exposed])).toThrow(/an external-transfer tool can never be agent-exposed/);
    // the exposure rule: an exposable class does not make a transfer exposable
    expect(isAgentExposableDescriptor({ ...registry.get("sirkit.pcb.board-inspect")!, sideEffects: "none" })).toBe(true);
    expect(isAgentExposableDescriptor(forged())).toBe(false);
    expect(isAgentExposableDescriptor(exposed)).toBe(false);
    // the registry that carries the forged (unexposed) descriptor: no agent discovers it, MCP excludes it as tier3 first
    const withForged = new ToolRegistry([...registry.list(), forged()]);
    const ctx = context();
    for (const channel of ["assistant-agent", "automation", "mcp"] as const) {
      expect(discoverTools(withForged, { ...ctx.discovery, channel }).included.map((item) => item.toolId), channel).not.toContain(INNOCUOUS_ID);
    }
    // [B23-A2 review tests-1] the loop above holds by the exposure flag alone. Discovery refuses the SIDE EFFECT too: a registry
    // double that skips the validator and claims the transfer read exposed still lists it on no agent, automation or MCP channel,
    // and the same exposed read without the side effect IS listed for the agent (the double is not vacuous)
    const crafted = unvalidated([...registry.list(), exposed]);
    for (const channel of ["assistant-agent", "automation", "mcp"] as const) {
      const result = discoverTools(crafted, { ...ctx.discovery, channel });
      expect(result.included.map((item) => item.toolId), channel).not.toContain(INNOCUOUS_ID);
      if (channel !== "mcp") expect(result.excluded.find((entry) => entry.toolId === INNOCUOUS_ID)?.reason, channel).toBe("not_agent_exposed");
    }
    expect(discoverTools(unvalidated([...registry.list(), { ...exposed, sideEffects: "none" }]), ctx.discovery).included.map((item) => item.toolId), "control: the same exposed read without the side effect").toContain(INNOCUOUS_ID);
    expect(mcpExclusionReason(forged())).toBe("tier3");
    expect(mcpExclusionReason(exposed), "exposure claimed, tier3 still first").toBe("tier3");
    expect(mcpExposureReport(withForged).excludedByReason.tier3).toContain(INNOCUOUS_ID);
    expect(agentExposureReport(withForged)).toMatchObject({ ok: true, count: INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length });
    // B21 role rows: none holds it; a forged row that does is refused, and an exposed id re-classified as a transfer is refused by
    // the side effect alone (the same id without it is admitted)
    for (const role of SPECIALIST_ROLES) expect(INTENTIONAL_ROLE_TOOL_IDS[role], role).not.toContain(INNOCUOUS_ID);
    const table = { ...INTENTIONAL_ROLE_TOOL_IDS, "verification-critic": [...INTENTIONAL_ROLE_TOOL_IDS["verification-critic"], INNOCUOUS_ID].sort() };
    expect(roleExposureReport(withForged, table).violations).toContain(`verification-critic: ${INNOCUOUS_ID} (not_exposed)`);
    const board = registry.get("sirkit.pcb.board-inspect")!;
    expect(roleToolViolations("verification-critic", { toolId: board.toolId, operationClass: board.operationClass, agentExposed: true, sideEffects: board.sideEffects })).toEqual([]);
    expect(roleToolViolations("verification-critic", { toolId: board.toolId, operationClass: board.operationClass, agentExposed: true, sideEffects: "external-transfer" })).toEqual(["never_exposed_pattern"]);
    const double = { get: (toolId: string) => (toolId === board.toolId ? { ...board, sideEffects: "external-transfer" as const } : registry.get(toolId)) };
    const report = roleExposureReport(double);
    expect(report.ok).toBe(false);
    expect(report.violations.filter((line) => line.includes(board.toolId)).every((line) => line.endsWith("(never_exposed_pattern)"))).toBe(true);
    expect(report.violations.some((line) => line.includes(board.toolId))).toBe(true);
  });

  it("3. refused by the never-execution sweep: through the real gateway, with and without a real minter, the forged transfer never yields an execution grant and the minter is never called; dressed up as a reviewed granted execution it is refused by the tier and the side effect, and the seal refuses it", async () => {
    const withForged = new ToolRegistry([...registry.list(), forged()]);
    // the sweep's own selection (b18-c-never-execution-sweep.test.ts): risky by class, by the floor, or by the computed tier
    const RISKY_CLASSES = new Set(["mutate", "destructive", "release"]);
    const risky = (descriptor: ToolDescriptor): boolean => RISKY_CLASSES.has(descriptor.operationClass) || TIER3_FAMILY_PATTERN.test(descriptor.toolId) || permissionTierOfDescriptor(descriptor) === 3;
    expect(risky(forged())).toBe(true);
    expect(TIER3_FAMILY_PATTERN.test(INNOCUOUS_ID) || RISKY_CLASSES.has(forged().operationClass), "selected by the computed tier alone").toBe(false);
    const ctx = context();
    const invoke = (gateway: ReturnType<typeof createAgentToolGateway>, descriptor: ToolDescriptor, args: Record<string, unknown>) =>
      gateway.invoke({ runId: "run-b23a2", provider: "openai", toolId: descriptor.toolId, version: descriptor.version, args, context: ctx, timeoutMs: 5_000, callId: `call-${descriptor.toolId}` });
    const gateways = (target: ToolRegistry, minter: AgentExecutionGrantMinter) => [createAgentToolGateway(target, { executionGrants: minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION }), createAgentToolGateway(target, { promptVersion: AGENT_SYSTEM_PROMPT_VERSION })];
    // [B23-A2 review tests-1] (a) the forged read at ITS version (the board read's 1.1.0; "1.0.0" was not_registered, before any
    // rule ran): refused not_discoverable through both gateways, before a read runs; the minter is never called
    const m = minting();
    for (const gateway of gateways(withForged, m.minter)) expect(await invoke(gateway, forged(), {})).toMatchObject({ kind: "refused", ok: false, status: "not_discoverable" });
    // (b) a registry double that skips the validator and re-labels the EXPOSED board read (its own id, so its read binding resolves)
    // as a transfer: refused not_discoverable, by the side effect alone; the real board read runs (control: the double is not vacuous)
    const board = registry.get("sirkit.pcb.board-inspect")!;
    const exposedRead: ToolDescriptor = { ...board, sideEffects: "external-transfer" };
    expect(board.agentExposed).toBe(true);
    for (const gateway of gateways(unvalidated([...registry.list().filter((descriptor) => descriptor !== board), exposedRead]), m.minter)) expect(await invoke(gateway, exposedRead, {})).toMatchObject({ kind: "refused", ok: false, status: "not_discoverable" });
    expect(await invoke(createAgentToolGateway(registry, { promptVersion: AGENT_SYSTEM_PROMPT_VERSION }), board, {}), "control").toMatchObject({ kind: "read", ok: true });
    expect(m.calls()).toBe(0);
    // (c) a reviewed-looking granted execution that carries the side effect (the move tool, renamed, exposed, mutate, with a
    // reviewed row) in a registry double: only the side effect differs from a granted execution, and it is refused not_callable on
    // the tier with valid move arguments - the minter is never called. The same descriptor without the side effect is minted
    // (control: one call), so the refusal is the side effect's
    const move = registry.get("sirkit.pcb.move-footprint")!;
    const dressed: ToolDescriptor = { ...move, toolId: "sirkit.pcb.move-share", sideEffects: "external-transfer" };
    const rows: GrantedExecutionTool[] = [...GRANTED_EXECUTION_TOOLS, { toolId: dressed.toolId, family: "pcb.move-footprint" as ExecutionFamily, reason: "test: a reviewed-looking row for a transfer" }];
    expect(grantedExecutionViolations(dressed, rows)).toEqual(["permission tier 3 is not Tier 1", "side effects external-transfer are not engineering-state"]);
    expect(grantedExecutionViolations({ ...dressed, sideEffects: "engineering-state" }, rows), "the same row without the side effect is a granted execution").toEqual([]);
    const moved = minting("Move R3 2 mm to the right.");
    for (const gateway of gateways(unvalidated([...registry.list(), dressed], rows), moved.minter)) {
      const outcome = await invoke(gateway, dressed, MOVE_ARGS);
      expect(outcome).toMatchObject({ kind: "refused", ok: false, status: "not_callable" });
      expect((outcome as { diagnostics: string[] }).diagnostics[0]).toBe("sirkit.pcb.move-share is not a reviewed granted execution (permission tier 3 is not Tier 1).");
    }
    expect(moved.calls()).toBe(0);
    const plainMove: ToolDescriptor = { ...dressed, sideEffects: "engineering-state" };
    const control = await invoke(createAgentToolGateway(unvalidated([...registry.list(), plainMove], rows), { executionGrants: moved.minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION }), plainMove, MOVE_ARGS);
    expect(control, "control: without the side effect the double mints").toMatchObject({ kind: "execution-grant", ok: true });
    expect(moved.calls()).toBe(1);
    // (d) the seal, with VALID move arguments (an empty list refused invalid_input after the tier check, so ok:false proved
    // nothing): tier_exceeded for the transfer; the same descriptor without the side effect seals
    expect(sealExecutionIntent({ descriptor: dressed, args: MOVE_ARGS, context: ctx })).toMatchObject({ ok: false, status: "tier_exceeded" });
    expect(sealExecutionIntent({ descriptor: plainMove, args: MOVE_ARGS, context: ctx }), "control").toMatchObject({ ok: true });
  });

  it("4. both port-bound classes forbid an approval tier and refuse the external-transfer side effect, so a bound provider read can reach Tier 3 only through the structural side effect - and no port-bound tool can carry it (9.4)", () => {
    for (const id of ["sirkit.parts.external-search", "sirkit.mcp.observation-read", "sirkit.computation.analytical-equation"]) {
      const descriptor = registry.get(id)!;
      expect(validateToolDescriptor(descriptor, KNOWN_COMMANDS), id).toEqual([]);
      expect(permissionTierOfDescriptor(descriptor), id).toBe(0);
      const binding = descriptor.binding.status;
      expect(validateToolDescriptor({ ...descriptor, approvalTier: "release" }, KNOWN_COMMANDS), id).toContain(`${id}@${descriptor.version}: ${binding} tools carry no approval tier`);
      expect(validateToolDescriptor({ ...descriptor, sideEffects: "external-transfer" }, KNOWN_COMMANDS), id).toEqual(expect.arrayContaining([`${id}@${descriptor.version}: ${binding} tools have no side effects beyond a derived cache`]));
      expect(permissionTierOfDescriptor({ ...descriptor, sideEffects: "external-transfer" }), id).toBe(3);
    }
  });

  it("5. the floor's new stems: quote, dfm, submit, checkout, cart, buy and payment join the id floor; the census over the generated tool and action CSVs proves that no current tool id or action id changes tier - B22's five computation ids included - and that no B21 role row, no MCP exclusion and no router family changes", () => {
    expect([...TIER3_B23_STEMS]).toEqual(B23_STEMS);
    expect(TIER3_FLOOR_PATTERN.source).toBe(`(${[...FAMILY_STEMS, ...B23_STEMS, PAY_WORD].join("|")})`);
    expect(TIER3_FLOOR_PATTERN.flags).toBe("i");
    expect(TIER3_FAMILY_PATTERN.source, "the router's chat families are unchanged (OD-173; discovery section 8 item 16)").toBe(`(${FAMILY_STEMS.join("|")})`);
    expect(TIER3_FAMILIES.map((entry) => entry.family)).toEqual(["release", "publish", "publication", "upload", "order", "purchase", "qualify", "ship", "deliver"]);
    const read0 = registry.get("sirkit.pcb.board-inspect")!;
    for (const id of ["sirkit.parts.quote-request", "sirkit.pcb.dfm-check", "sirkit.bom.submit-list", "sirkit.bom.checkout", "sirkit.bom.cart-fill", "sirkit.parts.buy-now", "sirkit.bom.payment-plan", "sirkit.parts.QUOTE", "sirkit.bom.pay-invoice", "sirkit.bom.pay", "sirkit.bom.PAY_NOW"]) {
      expect(TIER3_FAMILY_PATTERN.test(id), id).toBe(false);
      expect(TIER3_FLOOR_PATTERN.test(id), id).toBe(true);
      expect(permissionTierOfDescriptor({ ...read0, toolId: id }), id).toBe(3);
      expect(permissionTierOfAction({ id: id.replace(/^sirkit\./, ""), kind: "read", approvalTier: "none", area: "parts" }), id).toBe(3);
    }
    // [B23-A2 review security-5] `pay` is word-bounded: a word that merely contains it moves nothing
    for (const id of ["sirkit.pcb.payload-inspect", "sirkit.view.display-mode"]) expect(TIER3_FLOOR_PATTERN.test(id), id).toBe(false);
    // the census: the generated CSVs ARE the registries, and no id in them matches a new stem
    const toolIds = csvIds("artifacts/ai-control-plane-b04/tool-registry.csv");
    const actionIds = csvIds("artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv");
    expect(toolIds).toHaveLength(47);
    expect(actionIds).toHaveLength(104);
    expect([...toolIds].sort()).toEqual(registry.list().map((descriptor) => descriptor.toolId).sort());
    expect(actionIds).toEqual(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
    expect([...toolIds, ...actionIds].filter((id) => B23_STEM_PATTERN.test(id))).toEqual([]);
    const computation = toolIds.filter((id) => id.startsWith("sirkit.computation."));
    expect(computation.sort()).toEqual(["sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse", "sirkit.computation.circuit-analysis", "sirkit.computation.layout-experiment"]);
    for (const id of computation) expect(TIER3_FLOOR_PATTERN.test(id), id).toBe(false);
    // ... and no tier moves: every descriptor and every record computes the tier it computed at 79fa18b, and none carries the side effect
    for (const descriptor of registry.list()) {
      expect(descriptor.sideEffects, descriptor.toolId).not.toBe("external-transfer");
      expect(permissionTierOfDescriptor(descriptor), descriptor.toolId).toBe(legacyToolTier(descriptor));
      expect(mcpExclusionReason(descriptor) === "tier3", descriptor.toolId).toBe(legacyToolTier(descriptor) === 3);
    }
    for (const record of ACTION_COVERAGE_REGISTRY) {
      expect(record.sideEffects, record.id).toBeUndefined();
      expect(permissionTierOfAction(record), record.id).toBe(legacyActionTier(record));
    }
    // B21 role rows: the report is sound and no specialist row holds an id the widened floor reaches
    expect(roleExposureReport(registry)).toMatchObject({ ok: true, violations: [], coordinatorIsExposureList: true });
    for (const role of SPECIALIST_ROLES) for (const id of INTENTIONAL_ROLE_TOOL_IDS[role]) expect(TIER3_FLOOR_PATTERN.test(id), `${role}: ${id}`).toBe(false);
    expect(mcpExposureReport(registry).ok).toBe(true);
  });

  it("6. the B21 withdrawal drops every external-* authority and keeps dropping B22's computation-engine (b22-b-exposure case 4 and the :68 reason order unchanged); the specialist-claims check (:257-258) does not follow: its two names are exactly the vocabulary's external authorities, pinned here so a third cannot be added without it", () => {
    for (const authority of ["external-observation", "external-mcp-observation", "external-transfer", "external-anything", "computation-engine"]) expect(isWithdrawnAuthority(authority), authority).toBe(true);
    for (const authority of ["durable-server-board", "local-working-copy", "catalog", "none", "externalobservation", "computation"]) expect(isWithdrawnAuthority(authority), authority).toBe(false);
    const coordinator = context();
    expect(coordinator.discovery.availableAuthority).toEqual(expect.arrayContaining(["external-observation", "external-mcp-observation", "computation-engine"]));
    const forgedAuthority = { ...coordinator, discovery: { ...coordinator.discovery, availableAuthority: [...coordinator.discovery.availableAuthority, "external-transfer" as never] } };
    for (const [label, derived] of [["withdrawAuthority", withdrawAuthority(forgedAuthority)], ["deriveSpecialistContext", deriveSpecialistContext(forgedAuthority)]] as const) {
      expect(derived.discovery.availableAuthority.filter((authority) => authority.startsWith("external-") || authority === "computation-engine"), label).toEqual([]);
      expect(derived.discovery.availableAuthority, label).toEqual(coordinator.discovery.availableAuthority.filter((authority) => !isWithdrawnAuthority(authority)));
      expect(specialistContextClaims(derived).filter((claim) => claim === "externalAcquisitionAvailable" || claim === "mcpObservationAvailable"), label).toEqual([]);
    }
    // the scheduler's two withdrawals use the predicate (one rule, never a third list of names)
    const scheduler = read("app/lib/agent/orchestration/scheduler.ts").split(NEWLINE);
    expect(scheduler.filter((line) => line.includes("availableAuthority: discovery.availableAuthority.filter("))).toHaveLength(2);
    for (const line of scheduler.filter((candidate) => candidate.includes("availableAuthority: discovery.availableAuthority.filter("))) expect(line).toContain("!isWithdrawnAuthority(authority)");
    expect(MCP_EXCLUSION_REASONS.indexOf("computation")).toBe(MCP_EXCLUSION_REASONS.indexOf("never_exposed") + 1);
    // :257-258 - the claims check names the two external authorities the closed vocabulary holds; a third fails here first
    expect(TOOL_AUTHORITY_SOURCES.filter((authority) => authority.startsWith("external-"))).toEqual(["external-observation", "external-mcp-observation"]);
    expect([...SPECIALIST_CONTEXT_CLAIMS]).toEqual(["executionGrantsAvailable", "grantableCapabilities", "grantLineageId", "riskCeiling", "approvalsAvailable", "actorGrantableCapability", "externalAcquisitionAvailable", "mcpObservationAvailable"]);
  });

  it("7. the chat-closure tripwire also forbids the egress module and the provider directory (a reviewed move of the B19-D list), and the rule is not vacuous: through the two approved boundaries the closure reaches the egress module, around them neither", { timeout: 120_000 }, () => {
    const tripwire = read("app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts").split(NEWLINE);
    const line = tripwire[127]!;
    expect(line.startsWith("  const FORBIDDEN = [")).toBe(true);
    for (const entry of ["admission-control\\.ts$", "lifecycle-sql\\.ts$", "server\\/protocol\\.ts$", "/^app\\/lib\\/net\\/outbound-fetch\\.ts$/", "new RegExp([\"^app/lib/manufacturing\", \"providers/\"].join(\"-\"))"]) expect(line, entry).toContain(entry);
    expect(new RegExp(["^app/lib/manufacturing", "providers/"].join("-")).test("app/lib/manufacturing-providers/provider-registry.ts")).toBe(true);
    const production = collectProductionFiles(ROOT);
    const BOUNDARIES = new Set(["app/api/chat/external-acquisition-runtime.ts", "app/api/chat/mcp-observation-runtime.ts"]);
    const reachesForbidden = (files: ReadonlyMap<string, readonly string[]>): string[] => [...files.keys()].filter((file) => file === "app/lib/net/outbound-fetch.ts" || file.startsWith("app/lib/manufacturing-providers/"));
    expect(reachesForbidden(importClosure(production, ["app/api/chat/route.ts"], BOUNDARIES))).toEqual([]);
    for (const entry of ["app/lib/build-loop.ts", "app/lib/llm/router.ts"]) expect(reachesForbidden(importClosure(production, [entry])), entry).toEqual([]);
    expect(reachesForbidden(importClosure(production, ["app/api/chat/route.ts"])), "through the boundaries").toEqual(["app/lib/net/outbound-fetch.ts"]);
  });

  it("8. a consumed MCP server row may not approve a tool whose name matches the Tier 3 floor or a money or data-leaving word, whatever the tool's annotations say: refused at registry validation with one sentence that claims no completeness and never echoes the name; the registry is empty (OD-48), so no row moves", () => {
    expect(MCP_SERVER_REGISTRY).toHaveLength(0);
    expect(validateMcpServerRegistry()).toEqual([]);
    // [B23-A2 review security-5] the sentence no longer claims completeness: a word list refuses the names it holds and proves no
    // other name harmless, so a row is still approved only by a human review
    const REFUSAL = "an agentTools entry names a Tier 3 operation by the floor's word list (an order, a purchase, a checkout, a cart, a payment, a submission, a quote, an upload, a release, a qualification, a shipment, or design data sent, shared, transferred or exported): such a tool is never approved, whatever its annotations claim; the list proves no other name harmless, so a row is still approved only by a human review (OD-173, D23-12)";
    const label = fixtureServer().id;
    // one fixed sentence for every name (so no name is ever echoed), labelled with the row as every registry violation is
    // [B23-A2 review security-5] + the money and data-leaving words the structural no-order check already treats as ports, in
    // every case the agent's foreign names are spelled in
    for (const name of ["create-order", "place_order", "purchase", "checkout", "add-to-cart", "buy-parts", "submit_design", "get_quote", "upload_gerbers", "dfm-check", "make_payment", "release-board", "publish", "qualify", "ship-boards", "deliver", "PlaceOrder", "quoteRequest", "pay_invoice", "payInvoice", "PAY_NOW", "send_gerbers", "sendGerbers", "transfer_design", "export_gerbers", "share-design", "email_report", "create_po", "procure_parts", "procurementRun"]) {
      const violations = validateMcpServerRegistry([fixtureServer({ agentTools: [name] })]);
      expect(violations.map((violation) => violation.rule), name).toEqual(["agent-tools"]);
      expect(violations.map((violation) => violation.message), name).toEqual([`${label}: ${REFUSAL}`]);
    }
    expect(validateMcpServerRegistry([fixtureServer({ agentTools: ["zq-order-7f3"] })]).map((violation) => violation.message.includes("zq-order-7f3"))).toEqual([false]);
    // one refused name refuses the row's list once, beside benign names
    expect(validateMcpServerRegistry([fixtureServer({ agentTools: ["create-order", "lookup", "search"] })]).map((violation) => violation.message)).toEqual([`${label}: ${REFUSAL}`]);
    for (const names of [[], ["read", "search"], ["lookup"], ["a.b-c_D9"], ["t00", "t31"], ["display_settings", "get_position", "payload_read"]]) expect(validateMcpServerRegistry([fixtureServer({ agentTools: names })]), names.join(",")).toEqual([]);
  });

  it("9. the agent port applies the same name floor (B20-A4L: the port re-checks each agentTools rule because a crafted revision reaches it without the validator): a list naming a floor tool approves NOTHING and its row is off the roster, as the validator refuses the row whole; a list without one is unchanged (D23-12)", () => {
    const ENV = { SIRKIT_MCP_ENABLED: "1" };
    const pinned = (agentTools: readonly string[]) => wideServer("docs-floor", { descriptorPin: { toolsListDigest: mcpToolsListDigest([tool("lookup")]), pinnedAt: "2026-09-21" }, agentDisclosure: "permitted", agentTools: [...agentTools].sort() });
    expect(validateMcpServerRegistry([pinned(["lookup"])])).toEqual([]);
    expect(mcpAgentToolAllowlist(pinned(["lookup"]))).toEqual(new Set(["lookup"]));
    expect(mcpAgentRoster([pinned(["lookup"])], ENV).map((row) => row.id)).toEqual(["docs-floor"]);
    for (const names of [["create-order"], ["create-order", "lookup"], ["lookup", "pay_invoice"], ["send_gerbers"], ["lookup", "submitOrder"]]) {
      const row = pinned(names);
      expect(validateMcpServerRegistry([row]).map((violation) => violation.rule), names.join(",")).toEqual(["agent-tools"]);
      expect(mcpAgentToolAllowlist(row), names.join(",")).toEqual(new Set());
      expect(mcpAgentRoster([row], ENV), names.join(",")).toEqual([]);
    }
  });
});
