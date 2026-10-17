/**
 * [PR-D d2] The component review request, `sirkit.component.review-request`, registered with the disposition UNAVAILABLE and its
 * honest reason: the editor's two review paths (the Component review panel's Request review and the Build Library's Request evidence
 * review) are human-only on the server, so no service exists that an agent may call and none was invented.
 *
 *  - the descriptor is registered, valid, not callable, unbound with a reason naming both human paths, never exposed, Tier 1 by
 *    derivation (a reversible mutation of the human path), its owning action record real;
 *  - discovery excludes it everywhere with the reason: not_agent_exposed on the agent channel (the run toolset never offers it),
 *    not_callable on the interactive channel; the gateway refuses an invocation;
 *  - the reason is grounded in the sources: both review services assert a human actor.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sirkitToolRegistry } from "../tool-catalog";
import { validateToolDescriptor, type ToolDescriptor } from "../tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport } from "../agent-exposure";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS, mcpExposureReport } from "../mcp-exposure";
import { NEVER_EXPOSED_TOOL_PATTERNS } from "../granted-execution-families";
import { TIER3_FLOOR_PATTERN, permissionTierOfDescriptor } from "../permission-tiers";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { buildRunToolset } from "../../agent/loop";
import { createEmptyBoard } from "../../pcb/types";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const TOOL = "sirkit.component.review-request";
const descriptor = (): ToolDescriptor => registry.get(TOOL)!;
const SCOPE = { tenantId: "local", projectId: "p-prd-review", branchId: "main" };
const SHEET = { components: [], wires: [], netLabels: [], kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-u1", symbolAssetVersionId: "sym-u1" }] };

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

describe("PR-D d2 component.review-request — disposition unavailable, by honest reason", () => {
  it("is registered and valid, NOT callable, unbound with a reason naming both human review paths, never agent-exposed, outside every exposure list; its owning action record exists", () => {
    const d = descriptor();
    expect(validateToolDescriptor(d, KNOWN)).toEqual([]);
    expect(d).toMatchObject({
      version: "1.0.0", lifecycle: "active", owningCommandId: "pcb.component-review", category: "pcb", operationClass: "mutate", sideEffects: "engineering-state", approvalTier: "reversible",
      requiredCapability: "edit_components", requiredRoles: ["pcb_editor", "reviewer", "project_admin"], discovery: "discoverable", callability: "not-callable", agentExposed: false,
      binding: { status: "unbound" },
    });
    expect(d.executionMode).toBeUndefined();
    expect(d.grantOnly).toBeUndefined();
    expect(d.binding.notes).toContain("app/lib/physical-binding/review-handoff.ts requestComponentReview");
    expect(d.binding.notes).toContain("app/lib/atomic/publication-review.ts submitAtomicPublicationRequest");
    expect(d.binding.notes).toContain("owner decision");
    expect(d.description).toContain("UNAVAILABLE to the assistant, because");
    expect(registry.inspectBinding(TOOL)).toMatchObject({ state: "not_callable", reason: expect.stringContaining("no trusted runtime implementation exists") });
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).not.toContain(TOOL);
    expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS).not.toContain(TOOL);
    expect(MCP_WITHHELD_TOOL_IDS).not.toContain(TOOL);
    expect(agentExposureReport(registry).ok).toBe(true);
    expect(mcpExposureReport(registry).ok).toBe(true);
    expect(permissionTierOfDescriptor(d)).toBe(1); // a reversible mutation of the HUMAN path; the agent never executes it
    expect(TIER3_FLOOR_PATTERN.test(TOOL)).toBe(false);
    for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(TOOL), String(pattern)).toBe(false); // not a never-exposed id: unavailable by the absence of a service, not by a ban
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "pcb.component-review")).toMatchObject({ kind: "mutate", approvalTier: "reversible", toolExposure: "none" });
  });

  it("discovery excludes it with the reason on every channel: not_agent_exposed to the agent (never offered to the model), not_callable to the interactive channel even for an editor with the capability; the gateway refuses an invocation", async () => {
    const assembly = assembleAgentRunContext({ ...SCOPE, schematic: SHEET, board: createEmptyBoard(), verifiedActor: { principalId: "u-1", actorRole: "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" } });
    if (!assembly.ok) throw new Error(assembly.reason);
    const context = assembly.context;
    const agent = discoverTools(registry, context.discovery);
    expect(agent.included.some((item) => item.toolId === TOOL)).toBe(false);
    expect(agent.excluded.find((item) => item.toolId === TOOL)?.reason).toBe("not_agent_exposed");
    expect(buildRunToolset(registry, context, () => undefined).declarations.map((declaration) => declaration.toolId)).not.toContain(TOOL);
    const interactive: DiscoveryContext = {
      ...context.discovery, channel: "interactive-ui", actorRole: "pcb_editor", grantedCapabilities: ["read_project", "edit_components"], currentEditor: "pcb",
      projectState: ["board-present", "schematic-present"], availableAuthority: ["local-working-copy", "durable-server-board"], riskCeiling: "destructive", approvalsAvailable: ["reversible", "topology-or-geometry", "destructive"],
    };
    const ui = discoverTools(registry, interactive);
    expect(ui.included.some((item) => item.toolId === TOOL)).toBe(false);
    expect(ui.excluded.find((item) => item.toolId === TOOL)?.reason).toBe("not_callable");
    const outcome = await createAgentToolGateway(registry).invoke({ runId: "run-prd-review", provider: "openai", callId: "call-rr-1", toolId: TOOL, version: "1.0.0", args: { componentInstanceId: "u1-id" }, context, timeoutMs: 5_000 });
    expect(outcome).toMatchObject({ kind: "refused", ok: false });
  });

  it("the reason is grounded: both existing review services assert a human actor on the server, and the editor's handoff names the human path", () => {
    const handoff = read("app/lib/physical-binding/review-handoff.ts");
    expect(handoff).toContain('assertHuman(input.actor, REVIEW_REQUESTER_ROLES, "PB_REVIEW_REQUEST_FORBIDDEN");');
    expect(handoff).toMatch(/if \(actor\.actorKind !== "human" \|\| !roles\.has\(actor\.role\)\) throw new Error\(code\);/);
    const publication = read("app/lib/atomic/publication-review.ts");
    expect(publication).toContain("No AI actor can take any step.");
    expect(publication).toContain("export function isHumanPublicationActor(actor: EngineeringActor): boolean");
    expect(read("app/components/pcb/PcbEditor.tsx")).toContain('detail?.handoff === "request_atomic_review"');
    expect(read("app/components/pcb/hooks/useComponentReview.ts")).toContain('operation: "request_atomic_review"');
  });
});
