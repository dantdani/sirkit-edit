/**
 * B04 — tool registry, discovery, and provider-adapter tests.
 *
 * Covers the required matrix: registry validation and digests, deterministic
 * contextual fail-closed discovery with explicit exclusions, truthful
 * callability classification (schemas are not implementations), the
 * no-agent-mutation invariant, provider-schema parity, architectural purity
 * scans, and CI byte-matching of generated artifacts.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderActionToolabilityCsv } from "../action-registry";
import { SIRKIT_TOOL_CATALOG, sirkitToolRegistry } from "../tool-catalog";
import { GRANTED_EXECUTION_TOOLS, GRANTED_EXECUTION_TOOL_IDS, grantedExecutionViolations } from "../granted-execution-families"; // [B18-C I3]
import { resolveReadBinding } from "../tool-bindings-readonly";
import {
  discoverTools,
  type DiscoveryContext,
} from "../tool-discovery";
import {
  anthropicSemanticCore,
  openAiSemanticCore,
  renderAnthropicTool,
  renderOpenAiTool,
  renderProviderParityReport,
} from "../tool-provider-adapters";
import {
  renderNonCallableCoverageCsv,
  renderRegistryJson,
  renderToolRegistryCsv,
  ToolRegistry,
  validateLifecycleTransition,
  validateToolDescriptor,
  type ToolDescriptor,
} from "../tool-registry";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const registry = sirkitToolRegistry();

function editorContext(overrides?: Partial<DiscoveryContext>): DiscoveryContext {
  return {
    tenantId: "tenant-a", projectId: "project-a", branchId: "main",
    actorId: "local-editor", actorRole: "pcb_editor",
    grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "run_automation", "export_project"],
    channel: "interactive-ui",
    currentRevisionDigest: "eng1-headdigest",
    lineageId: "lin1-lineage",
    currentEditor: "pcb",
    selectedKinds: ["footprint", "track", "via", "zone"],
    projectState: ["board-present", "schematic-present", "catalog-available"],
    availableAuthority: ["local-working-copy", "durable-server-board", "catalog"],
    providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 100 },
    riskCeiling: "destructive",
    approvalsAvailable: ["reversible", "topology-or-geometry", "destructive"],
    enabledFlags: [],
    requestedCategories: [],
    ...overrides,
  };
}

function sample(overrides?: Partial<ToolDescriptor>): ToolDescriptor {
  return {
    ...(SIRKIT_TOOL_CATALOG.find((item) => item.toolId === "sirkit.validation.drc-run")!),
    ...overrides,
  };
}

const KNOWN_COMMANDS = new Set(["validation.erc-drc", "pcb.move-footprint"]);

describe("registry validation (fail closed)", () => {
  it("1. duplicate tool id/version registration is rejected", () => {
    expect(() => new ToolRegistry([sample(), sample()], KNOWN_COMMANDS)).toThrow(/duplicate tool id\/version/);
    // Distinct versions of the same id are fine.
    expect(() => new ToolRegistry([sample(), sample({ version: "1.0.1" })], KNOWN_COMMANDS)).not.toThrow();
  });

  it("2. invalid lifecycle transitions and metadata are rejected", () => {
    expect(validateLifecycleTransition("draft", "active")).toEqual([]);
    expect(validateLifecycleTransition("active", "deprecated")).toEqual([]);
    expect(validateLifecycleTransition("retired", "active")).toHaveLength(1);
    expect(validateLifecycleTransition("deprecated", "draft")).toHaveLength(1);
    expect(() => new ToolRegistry([sample({ lifecycle: "deprecated" })], KNOWN_COMMANDS)).toThrow(/deprecation metadata/);
    expect(() => new ToolRegistry([sample({ lifecycle: "bogus" as never })], KNOWN_COMMANDS)).toThrow(/lifecycle/);
  });

  it("3. missing security metadata fails closed — never permissive defaults", () => {
    const missingSideEffects = { ...sample() } as Record<string, unknown>;
    delete missingSideEffects.sideEffects;
    expect(validateToolDescriptor(missingSideEffects as unknown as ToolDescriptor, KNOWN_COMMANDS).join(" ")).toContain("side-effect");
    const missingApproval = { ...sample() } as Record<string, unknown>;
    delete missingApproval.approvalTier;
    expect(validateToolDescriptor(missingApproval as unknown as ToolDescriptor, KNOWN_COMMANDS).join(" ")).toContain("approval");
    const missingExposure = { ...sample() } as Record<string, unknown>;
    delete missingExposure.agentExposed;
    expect(validateToolDescriptor(missingExposure as unknown as ToolDescriptor, KNOWN_COMMANDS).join(" ")).toContain("agent-exposure");
    const missingCallability = { ...sample() } as Record<string, unknown>;
    delete missingCallability.callability;
    expect(validateToolDescriptor(missingCallability as unknown as ToolDescriptor, KNOWN_COMMANDS).join(" ")).toContain("callability");
  });

  it("4. unknown B01 command references are rejected", () => {
    expect(() => new ToolRegistry([sample({ owningCommandId: "pcb.not-a-command" })], KNOWN_COMMANDS)).toThrow(/unknown B01 command/);
  });

  it("5. the registry digest is deterministic", () => {
    const again = new ToolRegistry(SIRKIT_TOOL_CATALOG);
    expect(again.digest()).toBe(registry.digest());
    expect(registry.digest()).toMatch(/^eng1-/);
  });

  it("callable without a binding is impossible; agent-exposed mutation is impossible", () => {
    expect(() => new ToolRegistry([sample({ binding: { status: "unbound" }, callability: "callable" })], KNOWN_COMMANDS)).toThrow(/never be callable/);
    // [B18-C I3] the B04 invariant's subject is a mutation that is NOT a reviewed granted execution (edit-track: Tier 2,
    // never granted); the granted move keeps the invariant the moment it loses its reviewed shape.
    const catalog = (id: string) => SIRKIT_TOOL_CATALOG.find((item) => item.toolId === id)!;
    const commands = new Set(["pcb.move-footprint", "pcb.edit-track", "pcb.delete-item"]);
    expect(() => new ToolRegistry([{ ...catalog("sirkit.pcb.edit-track"), agentExposed: true }], commands)).toThrow(/agent-exposed mutation capability is forbidden/);
    expect(() => new ToolRegistry([{ ...catalog("sirkit.pcb.edit-track"), agentExposed: true, executionMode: "granted" }], commands)).toThrow(/agent-exposed mutation capability is forbidden/);
    expect(() => new ToolRegistry([{ ...catalog("sirkit.pcb.move-footprint"), executionMode: undefined }], commands)).toThrow(/agent-exposed mutation capability is forbidden/);
    expect(() => new ToolRegistry([{ ...catalog("sirkit.pcb.delete-item"), agentExposed: true, executionMode: "granted" }], commands)).toThrow(/legal only on a mutate tool|forbidden/);
    expect(() => new ToolRegistry([catalog("sirkit.pcb.move-footprint")], commands)).not.toThrow();
  });
});

describe("discovery engine (deterministic, contextual, fail closed)", () => {
  it("6+17. stable ordering and deterministic digest", () => {
    const a = discoverTools(registry, editorContext());
    const b = discoverTools(registry, editorContext());
    expect(a.included).toEqual(b.included);
    expect(a.digest).toBe(b.digest);
    const ids = a.included.map((item) => `${item.category}|${item.toolId}`);
    expect(ids).toEqual([...ids].sort());
    // A changed context changes the digest.
    const c = discoverTools(registry, editorContext({ riskCeiling: "read" }));
    expect(c.digest).not.toBe(a.digest);
  });

  it("7. role and capability filtering", () => {
    const viewer = discoverTools(registry, editorContext({ actorRole: "viewer", grantedCapabilities: ["read_project"] }));
    // [B17-F] a viewer may READ and drive their OWN view (view-session commands never touch engineering state); never propose.
    expect(viewer.included.every((item) => item.operationClass === "read" || item.operationClass === "view-session")).toBe(true);
    expect(viewer.included.some((item) => item.operationClass === "propose")).toBe(false);
    expect(viewer.excluded.some((entry) => entry.reason === "role_not_permitted")).toBe(true);
    const noCaps = discoverTools(registry, editorContext({ grantedCapabilities: [] }));
    expect(noCaps.included).toEqual([]);
    expect(noCaps.excluded.some((entry) => entry.reason === "capability_missing")).toBe(true);
  });

  it("8. revision/lineage requirement filtering", () => {
    const noLineage = discoverTools(registry, editorContext({ lineageId: "", currentRevisionDigest: "" }));
    expect(noLineage.included.some((item) => item.toolId === "sirkit.pcb.move-footprint")).toBe(false);
    const reasons = noLineage.excluded.filter((entry) => entry.toolId === "sirkit.pcb.move-footprint").map((entry) => entry.reason);
    expect(reasons).toContain("revision_required");
    // Reads survive without a canonical lineage.
    expect(noLineage.included.some((item) => item.toolId === "sirkit.validation.drc-run")).toBe(true);
  });

  it("9. selection-kind filtering", () => {
    const nothingSelected = discoverTools(registry, editorContext({ selectedKinds: [] }));
    // [B18-C I3] the subject is edit-track (track-selection gated for good); move-footprint names its targets by stable
    // id, so a selection no longer gates it.
    expect(nothingSelected.included.some((item) => item.toolId === "sirkit.pcb.edit-track")).toBe(false);
    expect(nothingSelected.excluded.some((entry) => entry.toolId === "sirkit.pcb.edit-track" && entry.reason === "selection_kind_missing")).toBe(true);
    expect(nothingSelected.included.some((item) => item.toolId === "sirkit.pcb.move-footprint")).toBe(true);
    const trackOnly = discoverTools(registry, editorContext({ selectedKinds: ["track"] }));
    expect(trackOnly.included.some((item) => item.toolId === "sirkit.pcb.edit-track")).toBe(true);
    // [B18-C I5] arrange names its targets by stable id (no selection gate); the negative moves to the tools that stay
    // selection-gated: under a footprint-only selection, delete-item (track/via/zone) and edit-track (track) are excluded.
    const footprintOnly = discoverTools(registry, editorContext({ selectedKinds: ["footprint"] }));
    for (const id of ["sirkit.pcb.delete-item", "sirkit.pcb.edit-track"]) expect(footprintOnly.excluded.some((entry) => entry.toolId === id && entry.reason === "selection_kind_missing"), id).toBe(true);
  });

  it("10. risk-ceiling filtering", () => {
    const readOnly = discoverTools(registry, editorContext({ riskCeiling: "read" }));
    expect(readOnly.included.every((item) => item.operationClass === "read")).toBe(true);
    expect(readOnly.excluded.some((entry) => entry.reason === "risk_ceiling")).toBe(true);
    const proposeCeiling = discoverTools(registry, editorContext({ riskCeiling: "propose" }));
    expect(proposeCeiling.included.some((item) => item.operationClass === "propose")).toBe(true);
    expect(proposeCeiling.included.some((item) => item.operationClass === "mutate" || item.operationClass === "destructive")).toBe(false);
    // Unknown ceiling value falls closed to read-only.
    const unknown = discoverTools(registry, editorContext({ riskCeiling: "everything" as never }));
    expect(unknown.included.every((item) => item.operationClass === "read")).toBe(true);
  });

  it("11. approval filtering", () => {
    const noApprovals = discoverTools(registry, editorContext({ approvalsAvailable: [] }));
    expect(noApprovals.included.some((item) => item.toolId === "sirkit.pcb.delete-item")).toBe(false);
    expect(noApprovals.excluded.some((entry) => entry.toolId === "sirkit.pcb.delete-item" && entry.reason === "approval_unavailable")).toBe(true);
    expect(noApprovals.included.some((item) => item.toolId === "sirkit.validation.drc-run")).toBe(true);
  });

  it("12. feature-flag filtering", () => {
    const flagged = new ToolRegistry([sample({ featureFlag: "b04-experimental" })], KNOWN_COMMANDS);
    const withoutFlag = discoverTools(flagged, editorContext());
    expect(withoutFlag.included).toEqual([]);
    expect(withoutFlag.excluded[0]?.reason).toBe("feature_flag_disabled");
    const withFlag = discoverTools(flagged, editorContext({ enabledFlags: ["b04-experimental"] }));
    expect(withFlag.included).toHaveLength(1);
  });

  it("13. provider-capability filtering", () => {
    const noSchema = discoverTools(registry, editorContext({ providerCapabilities: { supportsJsonSchema: false, toolNameMaxLength: 64, maxToolCount: 100 } }));
    expect(noSchema.included).toEqual([]);
    expect(noSchema.excluded.some((entry) => entry.reason === "provider_schema_unsupported")).toBe(true);
    const shortNames = discoverTools(registry, editorContext({ providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 20, maxToolCount: 100 } }));
    expect(shortNames.excluded.some((entry) => entry.reason === "provider_name_length")).toBe(true);
    const twoTools = discoverTools(registry, editorContext({ providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 2 } }));
    expect(twoTools.included).toHaveLength(2);
    expect(twoTools.excluded.some((entry) => entry.reason === "provider_tool_count")).toBe(true);
  });

  it("14. category filtering", () => {
    const partsOnly = discoverTools(registry, editorContext({ requestedCategories: ["parts"], currentEditor: "" }));
    expect(partsOnly.included.length).toBeGreaterThan(0);
    expect(partsOnly.included.every((item) => item.category === "parts")).toBe(true);
    expect(partsOnly.excluded.some((entry) => entry.reason === "category_not_requested")).toBe(true);
  });

  it("15. deterministic schema/token budgeting", () => {
    const unbudgeted = discoverTools(registry, editorContext());
    const total = unbudgeted.included.reduce((sum, item) => sum + item.schemaBytes, 0);
    const budgeted = discoverTools(registry, editorContext({ maxSchemaBytes: Math.floor(total / 2) }));
    expect(budgeted.included.length).toBeLessThan(unbudgeted.included.length);
    expect(budgeted.excluded.some((entry) => entry.reason === "budget_exceeded")).toBe(true);
    expect(discoverTools(registry, editorContext({ maxSchemaBytes: Math.floor(total / 2) })).digest).toBe(budgeted.digest);
  });

  it("16. every exclusion carries an explicit reason and included+excluded covers the discoverable registry", () => {
    const result = discoverTools(registry, editorContext({ riskCeiling: "read" }));
    for (const entry of result.excluded) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.toolId).toMatch(/^sirkit\./);
    }
    const seen = new Set([...result.included.map((item) => item.toolId), ...result.excluded.map((entry) => entry.toolId)]);
    for (const descriptor of registry.list()) {
      if (descriptor.discovery === "discoverable") expect(seen.has(descriptor.toolId), descriptor.toolId).toBe(true);
    }
  });
});

describe("truthful classification", () => {
  it("18+19. missing implementations and schema-only declarations are non-callable", () => {
    // [B09] sirkit.schematic.inspect gained a real reusable accessor
    // (schematic-read.ts) and left this list.
    // [B17-F] the view descriptors are now bound view-session tools (bus commands) and left this list.
    for (const toolId of ["sirkit.pcb.create-via", "sirkit.pcb.zone-edit"]) {
      const inspection = registry.inspectBinding(toolId);
      expect(inspection.state, toolId).toBe("not_callable");
      if (inspection.state === "not_callable") expect(inspection.reason).toContain("schema declarations are not implementations");
    }
    expect(registry.inspectBinding("sirkit.does.not-exist")).toEqual({ state: "not_registered" });
  });

  it("20. agent discovery yields ONLY explicitly agent-exposed read/propose tools; internal-only stays invisible", () => {
    // [B09] the agent channel is no longer empty — but it may contain ONLY
    // descriptors that are explicitly agentExposed, and only read/propose
    // operation classes. Every included tool is re-checked here.
    const agent = discoverTools(registry, editorContext({ channel: "assistant-agent", riskCeiling: "propose" }));
    expect(agent.included.length).toBeGreaterThan(0);
    for (const item of agent.included) {
      const descriptor = registry.get(item.toolId, item.version)!;
      expect(descriptor.agentExposed, item.toolId).toBe(true);
      expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
    }
    expect(agent.excluded.some((entry) => entry.toolId === "sirkit.schematic.add-component")).toBe(false); // internal-only: invisible to agents
  });

  it("21. migrated PCB mutations are runtime-executable metadata for trusted UI; only a reviewed granted execution is agent-exposed", () => {
    for (const toolId of ["sirkit.pcb.move-footprint", "sirkit.pcb.rotate-side-footprint", "sirkit.pcb.edit-track", "sirkit.pcb.delete-item", "sirkit.pcb.arrange"]) {
      const descriptor = registry.get(toolId)!;
      // [B18-C I3] exposed exactly when the mutation is a reviewed granted execution; executionMode only then.
      expect(descriptor.agentExposed, toolId).toBe(GRANTED_EXECUTION_TOOL_IDS.includes(toolId));
      expect(descriptor.executionMode === "granted", toolId).toBe(GRANTED_EXECUTION_TOOL_IDS.includes(toolId));
      expect(descriptor.callability, toolId).toBe("callable");
      expect(descriptor.binding.status, toolId).toBe("bound-mutation-editor-session");
      expect(descriptor.binding.canonicalCommandId, toolId).toBe(descriptor.owningCommandId);
    }
    // Interactive UI discovery includes them; agent/automation discovery
    // NEVER includes any mutation-capable class ([B09]: reads/proposals may
    // now appear, mutations still cannot).
    const ui = discoverTools(registry, editorContext());
    expect(ui.included.some((item) => item.toolId === "sirkit.pcb.move-footprint")).toBe(true);
    for (const channel of ["assistant-agent", "automation"] as const) {
      const included = discoverTools(registry, editorContext({ channel, riskCeiling: "propose" })).included;
      expect(included.every((item) => isAgentExposableDescriptor(registry.get(item.toolId, item.version)!)), channel).toBe(true);
      expect(included.some((item) => item.toolId.startsWith("sirkit.pcb.move") || item.toolId === "sirkit.pcb.delete-item"), channel).toBe(false);
    }
    // [B18-C I3] the agent channel includes the granted move ONLY with the server-derived grant context; automation never;
    // the actor's own edit_placement never counts on the agent channel.
    const grantContext: Partial<DiscoveryContext> = { grantedCapabilities: ["read_project"], grantableCapabilities: ["edit_placement"], grantLineageId: "lin1-pcb", riskCeiling: "mutate", approvalsAvailable: ["reversible"] };
    expect(discoverTools(registry, editorContext({ channel: "assistant-agent", ...grantContext })).included.map((item) => item.toolId)).toContain("sirkit.pcb.move-footprint");
    expect(discoverTools(registry, editorContext({ channel: "automation", ...grantContext })).included.map((item) => item.toolId)).not.toContain("sirkit.pcb.move-footprint");
    expect(discoverTools(registry, editorContext({ channel: "assistant-agent", riskCeiling: "mutate", approvalsAvailable: ["reversible"] })).included.map((item) => item.toolId)).not.toContain("sirkit.pcb.move-footprint");
  });

  it("22. canonical undo/redo is absent from every discovery channel", () => {
    for (const channel of ["interactive-ui", "assistant-agent", "automation", "api"] as const) {
      const result = discoverTools(registry, editorContext({ channel }));
      expect(result.included.some((item) => item.toolId === "sirkit.pcb.undo-redo-canonical"), channel).toBe(false);
    }
    // Non-UI channels do not even learn it exists.
    const agent = discoverTools(registry, editorContext({ channel: "assistant-agent" }));
    expect(agent.excluded.some((entry) => entry.toolId === "sirkit.pcb.undo-redo-canonical")).toBe(false);
  });

  it("23. manufacturing release is not agent executable and not callable as a tool", () => {
    const release = registry.get("sirkit.manufacturing.release")!;
    expect(release.agentExposed).toBe(false);
    expect(release.callability).toBe("not-callable");
    expect(release.binding.status).toBe("unbound");
    for (const channel of ["interactive-ui", "assistant-agent", "automation", "api"] as const) {
      expect(discoverTools(registry, editorContext({ channel })).included.some((item) => item.toolId === "sirkit.manufacturing.release"), channel).toBe(false);
    }
  });

  it("24. [B18-C I7] dimensions are a reviewed granted execution (was [B09.1] implemented but unbound): bound to the canonical editor session, re-tiered reversible (OD-13), agent-visible ONLY with the server-derived grant context", () => {
    const dimension = registry.get("sirkit.pcb.dimension")!;
    expect(dimension.version).toBe("1.2.0");
    expect(dimension.callability).toBe("callable");
    expect(dimension.lifecycle).toBe("active");
    expect(dimension.approvalTier).toBe("reversible");
    expect(dimension.agentExposed).toBe(GRANTED_EXECUTION_TOOL_IDS.includes(dimension.toolId));
    expect(dimension.executionMode).toBe("granted");
    expect(dimension.binding).toMatchObject({ status: "bound-mutation-editor-session", canonicalCommandId: "pcb.dimension" });
    expect(discoverTools(registry, editorContext({ channel: "assistant-agent", riskCeiling: "propose" })).included.some((item) => item.toolId === "sirkit.pcb.dimension")).toBe(false);
    const grantContext: Partial<DiscoveryContext> = { grantedCapabilities: ["read_project"], grantableCapabilities: ["edit_placement"], grantLineageId: "lin1-pcb", riskCeiling: "mutate", approvalsAvailable: ["reversible"] };
    expect(discoverTools(registry, editorContext({ channel: "assistant-agent", ...grantContext })).included.map((item) => item.toolId)).toContain("sirkit.pcb.dimension");
    expect(discoverTools(registry, editorContext({ channel: "automation", ...grantContext })).included.map((item) => item.toolId)).not.toContain("sirkit.pcb.dimension");
  });

  it("[B09] exactly the activated agent set is exposed, and EVERY exposed descriptor is backed by a real activated binding (tripwire)", () => {
    const exposed = registry.list().filter((descriptor) => descriptor.agentExposed).map((descriptor) => descriptor.toolId).sort();
    // [B17-F] the exact set is the ONE reviewed intentional list (agent-exposure.ts); the report derives both sides.
    expect(exposed).toEqual([...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS]);
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [], count: INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length });
    for (const descriptor of registry.list().filter((item) => item.agentExposed)) {
      if (descriptor.operationClass === "read") {
        // A registry declaration is NOT executable coverage: the read tool
        // must resolve against the B05 allowlist.
        const resolution = resolveReadBinding(descriptor);
        expect(resolution.state, descriptor.toolId).toBe("resolved");
      } else if (descriptor.operationClass === "propose") {
        expect(["sirkit.schematic.propose-component-replacement", "sirkit.schematic.propose-tier1-edit", "sirkit.pcb.propose-bounded-edit", "sirkit.placement.propose", "sirkit.routing.propose"]).toContain(descriptor.toolId); // B14: + replacement proposal; B15.3: + bounded PCB proposal; B17-F: + the shared layout candidates
        expect(descriptor.binding.status).toBe("bound-proposal");
        expect(descriptor.sideEffects).toBe("proposal-artifact");
      } else if (descriptor.operationClass === "view-session") {
        // [B17-F] a view-session tool is a bound bus-command tool: session-state only, no authority, explicit commands.
        expect(descriptor.binding.status, descriptor.toolId).toBe("bound-view-session");
        expect(descriptor.sideEffects, descriptor.toolId).toBe("session-state");
        expect(descriptor.requiredAuthority, descriptor.toolId).toEqual(["none"]);
        expect(descriptor.viewCommands?.length ?? 0, descriptor.toolId).toBeGreaterThan(0);
      } else if (descriptor.operationClass === "mutate") {
        // [B18-C I3] an exposed mutation is a reviewed Tier 1 granted execution bound to the canonical editor session.
        expect(GRANTED_EXECUTION_TOOL_IDS, descriptor.toolId).toContain(descriptor.toolId);
        expect(descriptor.binding.status, descriptor.toolId).toBe("bound-mutation-editor-session");
        expect(descriptor.executionMode, descriptor.toolId).toBe("granted");
        expect(grantedExecutionViolations(descriptor), descriptor.toolId).toEqual([]);
      } else {
        throw new Error(`agent-exposed descriptor with forbidden class: ${descriptor.toolId} (${descriptor.operationClass})`);
      }
    }
    // No destructive/release/undo descriptor is exposed; a mutation is exposed exactly when it is a reviewed granted
    // execution; a view-session descriptor is exposed ONLY as a bound bus-command tool.
    for (const descriptor of registry.list()) {
      if (["destructive", "release"].includes(descriptor.operationClass)) {
        expect(descriptor.agentExposed, descriptor.toolId).toBe(false);
      }
      if (descriptor.operationClass === "mutate") {
        expect(descriptor.agentExposed, descriptor.toolId).toBe(GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId));
      }
      if (descriptor.operationClass === "view-session" && descriptor.agentExposed) {
        expect(descriptor.binding.status, descriptor.toolId).toBe("bound-view-session");
      }
    }
  });
});

describe("provider adapters", () => {
  it("25. [B09.1] ONE provider-rendering truth: flat OpenAI Responses shape + strict Anthropic shape, semantically equivalent over the wire subset; incompatible schemas fail closed", () => {
    const parity = renderProviderParityReport(registry.list());
    expect(parity.schema).toBe("sirkit.provider-schema-parity.v2");
    const compatible = parity.tools.filter((entry) => entry.wireCompatible);
    expect(compatible.length).toBeGreaterThanOrEqual(8);
    expect(compatible.every((entry) => entry.semanticallyEquivalent)).toBe(true);
    for (const descriptor of registry.list()) {
      const entry = parity.tools.find((item) => item.toolId === descriptor.toolId)!;
      if (!entry.wireCompatible) {
        // Rendering fails closed instead of forwarding unsupported keywords.
        expect(() => renderOpenAiTool(descriptor), descriptor.toolId).toThrow(/STRICT_SCHEMA_UNSUPPORTED/);
        continue;
      }
      const openAi = renderOpenAiTool(descriptor);
      const anthropic = renderAnthropicTool(descriptor);
      // Current shapes: FLAT Responses function tool + strict Anthropic tool.
      expect(openAi.type).toBe("function");
      expect((openAi as unknown as Record<string, unknown>).function).toBeUndefined();
      expect(openAi.strict).toBe(true);
      expect(anthropic.strict).toBe(true);
      expect(openAiSemanticCore(openAi), descriptor.toolId).toEqual(anthropicSemanticCore(anthropic));
      expect(openAi.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  it("26+28. adapters and all B04 production modules contain no execution or provider-SDK imports", () => {
    const files = [
      "app/lib/engineering/tool-registry.ts",
      "app/lib/engineering/tool-catalog.ts",
      "app/lib/engineering/tool-discovery.ts",
      "app/lib/engineering/tool-provider-adapters.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const imports = [...source.matchAll(/^import[^;]+from\s+"([^"]+)";?$/gm)].map((match) => match[1]);
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/openai|anthropic|@ai-sdk|\/llm\/|api\/|components\//);
        expect(specifier.startsWith("./") || specifier.startsWith("../"), `${file} imports ${specifier}`).toBe(true);
        // No runtime dependency on the executor, adapter, or channel modules —
        // binding metadata NAMES symbols as strings, it never imports them.
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/\/executor$|\.\/executor$|editor-adapter|interactive-channel/);
      }
      expect(source).not.toMatch(/fetch\(|axios|XMLHttpRequest/);
      expect(source).not.toContain("interactive-channel.internal");
    }
  });

  // Importing the full barrel transitively loads the PCB engine — allow
  // for cold-transform time well beyond the 5s default.
  it("27. the public barrel still cannot supply the interactive channel", { timeout: 30_000 }, async () => {
    const barrel = await import("../index");
    expect(Object.keys(barrel)).not.toContain("InteractiveUiChannel");
    expect(Object.keys(barrel)).not.toContain("createEditorSessionChannel");
  });
});

describe("generated artifacts + B01 consistency", () => {
  const artifactDir = join(process.cwd(), "artifacts", "ai-control-plane-b04");
  const read = (name: string): string => readFileSync(join(artifactDir, name), "utf8").replaceAll("\r\n", "\n");

  it("committed artifacts byte-match the registry rendering", async () => {
    const { renderProviderParityReport: renderParity } = await import("../tool-provider-adapters");
    expect(existsSync(join(artifactDir, "tool-registry.csv")), "run: npx tsx scripts/generate-tool-registry-artifacts.ts").toBe(true);
    expect(read("tool-registry.csv")).toBe(renderToolRegistryCsv(registry));
    expect(read("non-callable-coverage.csv")).toBe(renderNonCallableCoverageCsv(registry));
    expect(read("provider-schema-parity.json")).toBe(renderRegistryJson(renderParity(registry.list())));
  });

  it("29. the B01 matrices remain byte-consistent with the action registry", () => {
    const committed = readFileSync(join(process.cwd(), "artifacts", "ai-control-plane-b01", "ui-command-toolability-matrix.csv"), "utf8");
    expect(committed.replaceAll("\r\n", "\n")).toBe(renderActionToolabilityCsv());
  });

  it("coverage report references only real B01 commands and names the unmigrated mutation surface", () => {
    const coverage = registry.coverageReport();
    expect(coverage.descriptorCount).toBe(SIRKIT_TOOL_CATALOG.length);
    expect(coverage.referencedCommandIds).toContain("pcb.move-footprint");
    // [B18-C I6] pcb.silkscreen-text is referenced by its granted-execution descriptor; every reviewed family is referenced.
    expect(coverage.unreferencedMutationCapableCommands).not.toContain("pcb.silkscreen-text");
    for (const tool of GRANTED_EXECUTION_TOOLS) expect(coverage.referencedCommandIds, tool.family).toContain(tool.family);
  });
});
