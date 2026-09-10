/**
 * B05.1 — authority-resource pinning tests.
 *
 * Negative coverage for the resource-envelope contract: missing/wrong-kind/
 * duplicate/corrupt/stale/foreign/incompatible resources, manifest and
 * dependency digest verification, undeclared-resource isolation, truthful
 * composite verification states, pinned DRC/readiness/authority provenance,
 * context source references, and bundle-pinned replay.
 */
import { describe, expect, it } from "vitest";
import { assembleEngineeringContext } from "../context-assembler";
import { computeProjectRevision } from "../revision";
import { engineeringDigest } from "../stable";
import { sirkitToolRegistry } from "../tool-catalog";
import {
  buildReadResourceBundle,
  sealResourceEnvelope,
  validateReadResourceBundle,
  type ReadAuthorityResourceEnvelope,
  type ReadResourceBundle,
} from "../resource-envelopes";
import { ACTIVATED_READ_BINDINGS, type ActivatedReadBinding } from "../tool-bindings-readonly";
import { inspectComponentAuthority } from "../component-authority";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import {
  ReadToolInvocationService,
  replayReadFixture,
  type ReadInvocationRequest,
} from "../tool-invocation";
import { buildReadReplayFixtures, replayFixtureBundle } from "../tool-read-replay";
import { AGENT_EXPOSABLE_OPERATION_CLASSES } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const registry = sirkitToolRegistry();
const SCOPE = { tenantId: "tenant-fixture", projectId: "project-fixture", branchId: "main" };

function bundle(): ReadResourceBundle {
  return replayFixtureBundle();
}

/** Rebuild a valid bundle after transforming its auxiliary envelopes. */
function rebuilt(b: ReadResourceBundle, transform: (aux: ReadAuthorityResourceEnvelope[]) => ReadAuthorityResourceEnvelope[]): ReadResourceBundle {
  return buildReadResourceBundle(b.canonicalState, transform([...b.auxiliary]));
}

function contextFor(b: ReadResourceBundle, overrides?: Partial<DiscoveryContext>): DiscoveryContext {
  const state = b.canonicalState.content;
  return {
    tenantId: state.tenantId, projectId: state.projectId, branchId: state.branchId,
    actorId: "local-editor", actorRole: "pcb_editor",
    grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "run_automation", "export_project"],
    channel: "interactive-ui",
    currentRevisionDigest: computeProjectRevision(state).canonicalStateDigest,
    lineageId: "lin1-fixture", currentEditor: "pcb",
    selectedKinds: ["footprint", "track", "via", "zone"],
    projectState: ["board-present", "schematic-present", "catalog-available"],
    availableAuthority: ["local-working-copy", "durable-server-board", "catalog"],
    providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 100 },
    riskCeiling: "destructive",
    approvalsAvailable: ["reversible", "topology-or-geometry", "destructive"],
    enabledFlags: [], requestedCategories: [],
    ...overrides,
  };
}

let counter = 0;
function requestFor(b: ReadResourceBundle, toolId: string, overrides?: Partial<ReadInvocationRequest>): ReadInvocationRequest {
  counter += 1;
  const state = b.canonicalState.content;
  return {
    invocationId: `inv51-${counter}`, toolId,
    tenantId: state.tenantId, projectId: state.projectId, branchId: state.branchId,
    actorId: "local-editor", actorRole: "pcb_editor",
    grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "run_automation", "export_project"],
    channel: "interactive-ui",
    canonicalRevisionDigest: computeProjectRevision(state).canonicalStateDigest,
    authoritySource: "local-working-copy", currentEditor: "pcb",
    args: {}, traceId: `trace51-${counter}`, requestTimestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function service(): ReadToolInvocationService {
  let tick = 0;
  return new ReadToolInvocationService(registry, { now: () => 1_700_000_000_000 + tick++ * 10 });
}

describe("bundle integrity (fail closed, structured codes)", () => {
  it("1. missing required auxiliary resource → missing_resource", async () => {
    const b = rebuilt(bundle(), (aux) => aux.filter((envelope) => envelope.kind !== "drc-rules"));
    const result = await service().invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(result.status).toBe("missing_resource");
    // 12+17. DRC requires pinned rules; readiness requires pinned presets.
    const noPresets = rebuilt(bundle(), (aux) => aux.filter((envelope) => envelope.kind !== "fab-preset"));
    const readiness = await service().invoke(requestFor(noPresets, "sirkit.manufacturing.readiness-inspect"), contextFor(noPresets), noPresets);
    expect(readiness.status).toBe("missing_resource");
    // 14. component authority requires pinned records.
    const noAuthority = rebuilt(bundle(), (aux) => aux.filter((envelope) => envelope.kind !== "component-authority-records"));
    const authority = await service().invoke(requestFor(noAuthority, "sirkit.component-authority.inspect"), contextFor(noAuthority), noAuthority);
    expect(authority.status).toBe("missing_resource");
  });

  it("2. an unknown resource kind fails closed as corrupt", () => {
    const b = bundle();
    const evil = { ...b.auxiliary[0], kind: "totally-new-kind" } as unknown as ReadAuthorityResourceEnvelope;
    const failures = validateReadResourceBundle(buildReadResourceBundle(b.canonicalState, [evil]), SCOPE);
    expect(failures.some((failure) => failure.code === "corrupt_resource" && failure.detail.includes("unknown resource kind"))).toBe(true);
  });

  it("3. duplicate resource ids → duplicate_resource", async () => {
    const base = bundle();
    const rules = base.auxiliary.find((envelope) => envelope.kind === "drc-rules")!;
    // A VALID envelope (correct digest) that collides on resource id.
    const dupe = sealResourceEnvelope({
      ...base.auxiliary.find((envelope) => envelope.kind === "drc-preset")!,
      resourceId: rules.resourceId,
    });
    const b = rebuilt(base, (aux) => [...aux.filter((envelope) => envelope.kind !== "drc-preset"), dupe]);
    const result = await service().invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(result.status).toBe("duplicate_resource");
  });

  it("4. corrupt content digest → corrupt_resource before any facts", async () => {
    const b = bundle();
    (b.auxiliary.find((envelope) => envelope.kind === "drc-rules")!.content as Record<string, unknown>).tampered = true;
    const result = await service().invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(result.status).toBe("corrupt_resource");
  });

  it("5. corrupt manifest digest → manifest_mismatch (dominates non-corruption issues)", async () => {
    const b = bundle();
    const forged = { ...b, manifestDigest: "eng1-forged" };
    const result = await service().invoke(requestFor(forged, "sirkit.validation.drc-run"), contextFor(forged), forged);
    expect(result.status).toBe("manifest_mismatch");
  });

  it("6. foreign tenant/project/branch envelope → foreign_resource", async () => {
    const base = bundle();
    const foreign = sealResourceEnvelope({
      ...base.auxiliary.find((envelope) => envelope.kind === "drc-rules")!,
      projectId: "project-other",
      sourceCanonicalRevision: undefined,
    });
    const b = rebuilt(base, (aux) => [...aux.filter((envelope) => envelope.kind !== "drc-rules"), foreign]);
    const result = await service().invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(result.status).toBe("foreign_resource");
  });

  it("7. stale resource → stale_resource", async () => {
    const base = bundle();
    const stale = sealResourceEnvelope({ ...base.auxiliary.find((envelope) => envelope.kind === "drc-rules")!, freshness: "stale" });
    const b = rebuilt(base, (aux) => [...aux.filter((envelope) => envelope.kind !== "drc-rules"), stale]);
    const result = await service().invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(result.status).toBe("stale_resource");
  });

  it("8+18. incompatible canonical revision (incl. readiness netlist) → incompatible_resource_revision", async () => {
    const base = bundle();
    const incompatible = sealResourceEnvelope({ ...base.auxiliary.find((envelope) => envelope.kind === "drc-rules")!, sourceCanonicalRevision: "eng1-other-revision" });
    const b = rebuilt(base, (aux) => [...aux.filter((envelope) => envelope.kind !== "drc-rules"), incompatible]);
    const result = await service().invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(result.status).toBe("incompatible_resource_revision");
    // Netlist pinned to a different canonical revision fails the same way.
    const netlist = sealResourceEnvelope({
      ...SCOPE, resourceId: "res:netlist:fixture", kind: "netlist" as const,
      authoritySource: "local-working-copy" as const, authorityStatus: "verified" as const,
      sourceVersion: "schematic-rev-9", sourceCanonicalRevision: "eng1-not-this-board",
      producer: "fixture", producerVersion: "1.0.0", freshness: "current" as const,
      content: { components: [], nets: [] },
    });
    const withNetlist = rebuilt(bundle(), (aux) => [...aux, netlist]);
    const readiness = await service().invoke(requestFor(withNetlist, "sirkit.manufacturing.readiness-inspect"), contextFor(withNetlist), withNetlist);
    expect(readiness.status).toBe("incompatible_resource_revision");
  });

  it("9. dependency-digest mismatch → dependency_mismatch", async () => {
    const base = bundle();
    const rules = base.auxiliary.find((envelope) => envelope.kind === "drc-rules")!;
    const dependent = sealResourceEnvelope({
      ...base.auxiliary.find((envelope) => envelope.kind === "drc-preset")!,
      dependencyDigests: { [rules.resourceId]: "eng1-old-digest" },
    });
    const b = rebuilt(base, (aux) => [...aux.filter((envelope) => envelope.kind !== "drc-preset"), dependent]);
    const result = await service().invoke(requestFor(b, "sirkit.manufacturing.readiness-inspect"), contextFor(b), b);
    expect(result.status).toBe("dependency_mismatch");
  });
});

describe("declared-resource isolation + truthful verification", () => {
  it("10. a binding cannot consume undeclared resources — they are structurally absent", async () => {
    const b = bundle();
    const snoop: ActivatedReadBinding = {
      ...ACTIVATED_READ_BINDINGS.find((binding) => binding.toolId === "sirkit.pcb.revision-inspect")!,
      // Output schema allows only {revision: string} — encode the observation.
      invoke: (_args, resources) => ({
        revision: JSON.stringify({
          sawDrcRules: resources.drcRules !== undefined,
          sawAuthority: resources.componentAuthority !== undefined,
          sawPresets: resources.fabPreset !== undefined || resources.drcPreset !== undefined,
          sawSelection: resources.selection !== undefined,
        }),
      }),
    };
    const svc = new ReadToolInvocationService(registry, { bindings: [snoop], now: () => 1 });
    const result = await svc.invoke(requestFor(b, "sirkit.pcb.revision-inspect"), contextFor(b), b);
    if (result.status !== "succeeded") throw new Error(`expected success, got ${result.status}`);
    const seen = JSON.parse(result.output.revision as string) as Record<string, boolean>;
    expect(seen).toEqual({ sawDrcRules: false, sawAuthority: false, sawPresets: false, sawSelection: false });
  });

  it("11. canonical-only reads report canonical-revision-verified; composites report composite-resources-verified", async () => {
    const b = bundle();
    const canonical = await service().invoke(requestFor(b, "sirkit.project.canonical-revision-inspect"), contextFor(b), b);
    if (canonical.status !== "succeeded") throw new Error("expected success");
    expect(canonical.verification).toBe("canonical-revision-verified");
    expect(canonical.consumedResources).toHaveLength(1);
    const composite = await service().invoke(requestFor(b, "sirkit.manufacturing.readiness-inspect"), contextFor(b), b);
    if (composite.status !== "succeeded") throw new Error("expected success");
    expect(composite.verification).toBe("composite-resources-verified");
    expect(composite.consumedResources.map((entry) => entry.kind).sort()).toEqual(["canonical-state", "drc-preset", "fab-preset"]);
  });

  it("13. DRC output identifies rules resource, engine version, and report digest", async () => {
    const b = bundle();
    const result = await service().invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    if (result.status !== "succeeded") throw new Error("expected success");
    const pinned = result.output.pinned as Record<string, unknown>;
    const rules = b.auxiliary.find((envelope) => envelope.kind === "drc-rules")!;
    expect(pinned.drcRules).toEqual({ resourceId: rules.resourceId, kind: "drc-rules", sourceVersion: rules.sourceVersion, contentDigest: rules.contentDigest });
    expect(pinned.engineVersion).toBe("pcb-drc/2");
    expect(pinned.boardRevision).toMatch(/^pcb2-/);
    expect(pinned.reportDigest).toMatch(/^eng1-/);
  });

  it("17b. readiness output pins presets and never claims release authority", async () => {
    const b = bundle();
    const result = await service().invoke(requestFor(b, "sirkit.manufacturing.readiness-inspect"), contextFor(b), b);
    if (result.status !== "succeeded") throw new Error("expected success");
    const pinned = result.output.pinned as Record<string, Record<string, unknown>>;
    expect(pinned.fabPreset.kind).toBe("fab-preset");
    expect(pinned.drcPreset.kind).toBe("drc-preset");
    expect(JSON.stringify(result.output)).not.toMatch(/releaseId|releaseAuthority/);
  });

  it("19. post-invocation resource mutation discards the output", async () => {
    const b = bundle();
    const mutator: ActivatedReadBinding = {
      ...ACTIVATED_READ_BINDINGS.find((binding) => binding.toolId === "sirkit.validation.drc-run")!,
      invoke: (_args, resources) => {
        // A hostile/buggy implementation mutating a consumed resource mid-run.
        (resources.drcRules!.rules as unknown as Record<string, unknown>).tampered = true;
        return { report: { ok: true }, pinned: {} };
      },
    };
    const svc = new ReadToolInvocationService(registry, { bindings: [mutator], now: () => 1 });
    const result = await svc.invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(["stale_resource", "corrupt_resource"]).toContain(result.status);
  });

  it("20+21. composite success and traces carry consumed-resource references, digests only", async () => {
    const b = bundle();
    const svc = service();
    const result = await svc.invoke(requestFor(b, "sirkit.component-authority.inspect"), contextFor(b), b);
    if (result.status !== "succeeded") throw new Error("expected success");
    const authority = b.auxiliary.find((envelope) => envelope.kind === "component-authority-records")!;
    expect(result.consumedResources.some((entry) => entry.resourceId === authority.resourceId && entry.contentDigest === authority.contentDigest)).toBe(true);
    const trace = svc.traces().at(-1)!;
    expect(trace.resourceManifestDigest).toBe(b.manifestDigest);
    expect(trace.consumedResources!.map((entry) => entry.resourceId)).toContain(authority.resourceId);
    // Digests and identities only — no resource contents in traces.
    expect(JSON.stringify(svc.traces())).not.toContain("FIX-100");
  });
});

describe("component-authority pinning", () => {
  it("15+16. foreign records rejected; conflicting records never merged; results name authority digests", () => {
    const summaries = inspectComponentAuthority({
      componentIds: ["c-dup", "c-foreign"],
      projectId: "project-fixture",
      records: [
        { authorityRecordId: "a1", componentId: "c-dup", authorityRevision: "r1", lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "available", mappingVerification: "verified", selectedPart: { mpn: "A", manufacturer: "X", provenance: "physical-binding" } },
        { authorityRecordId: "a2", componentId: "c-dup", authorityRevision: "r2", lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "available", mappingVerification: "verified", selectedPart: { mpn: "B", manufacturer: "Y", provenance: "physical-binding" } },
        { authorityRecordId: "a3", componentId: "c-foreign", projectId: "project-OTHER", authorityRevision: "r1", lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "available", mappingVerification: "verified", selectedPart: { mpn: "C", manufacturer: "Z", provenance: "physical-binding" } },
      ],
    });
    const byId = new Map(summaries.map((summary) => [summary.componentId, summary]));
    const dup = byId.get("c-dup")!;
    expect(dup.state).toBe("conflicted");
    expect(dup.exactPart).toBeNull(); // neither record wins silently
    expect(dup.authorityGaps.join(" ")).toContain("refusing to merge");
    const foreign = byId.get("c-foreign")!;
    expect(foreign.state).toBe("unknown");
    expect(foreign.exactPart).toBeNull();
    expect(foreign.authorityGaps.join(" ")).toContain("foreign-project authority record was rejected");
  });
});

describe("context sections reference sources and refuse incompatible revisions", () => {
  it("22+23", () => {
    const b = bundle();
    const canonicalRevision = computeProjectRevision(b.canonicalState.content).canonicalStateDigest;
    const compatible = assembleEngineeringContext({
      canonicalState: b.canonicalState.content, authoritySource: "local-working-copy", authorityStatus: "verified", currentEditor: "pcb",
      readinessSummary: { status: "not_ready", blockingCount: 2, sourceRevision: canonicalRevision },
      sources: { readiness: { resourceId: "res:readiness:1", sourceVersion: "v1", contentDigest: "eng1-x", freshness: "current", sourceCanonicalRevision: canonicalRevision } },
      resourceManifestDigest: b.manifestDigest,
    });
    expect(compatible.readiness.status).toBe("present");
    if (compatible.readiness.status === "present") expect(compatible.readiness.source?.resourceId).toBe("res:readiness:1");
    expect(compatible.resourceManifestDigest).toBe(b.manifestDigest);
    expect(compatible.auxiliarySources).toHaveLength(1);

    const incompatible = assembleEngineeringContext({
      canonicalState: b.canonicalState.content, authoritySource: "local-working-copy", authorityStatus: "verified", currentEditor: "pcb",
      readinessSummary: { status: "ready", blockingCount: 0, sourceRevision: "eng1-old" },
      sources: { readiness: { resourceId: "res:readiness:old", sourceVersion: "v1", contentDigest: "eng1-y", freshness: "current", sourceCanonicalRevision: "eng1-old" } },
    });
    expect(incompatible.readiness.status).toBe("unavailable"); // never silently combined
    const stale = assembleEngineeringContext({
      canonicalState: b.canonicalState.content, authoritySource: "local-working-copy", authorityStatus: "verified", currentEditor: "pcb",
      readinessSummary: { status: "ready", blockingCount: 0, sourceRevision: canonicalRevision },
      sources: { readiness: { resourceId: "res:readiness:stale", sourceVersion: "v1", contentDigest: "eng1-z", freshness: "stale", sourceCanonicalRevision: canonicalRevision } },
    });
    expect(stale.readiness.status).toBe("stale"); // distinct from unknown/omitted/unavailable
  });
});

describe("bundle-pinned replay", () => {
  it("24. replay detects an auxiliary-resource change with the board unchanged", async () => {
    const fixtures = await buildReadReplayFixtures();
    const fixture = fixtures.find((candidate) => candidate.toolId === "sirkit.validation.drc-run")!;
    const tampered = structuredClone(fixture);
    // Change ONLY the DRC rules (board untouched), reseal + rebuild manifest
    // so the bundle is internally consistent — the pinned digests still catch it.
    const rules = tampered.bundle.auxiliary.find((envelope) => envelope.kind === "drc-rules")!;
    const changedRules = sealResourceEnvelope({ ...rules, content: { ...(rules.content as unknown as Record<string, unknown>), extra: 1 } });
    tampered.bundle = buildReadResourceBundle(tampered.bundle.canonicalState, [
      ...tampered.bundle.auxiliary.filter((envelope) => envelope.kind !== "drc-rules"),
      changedRules,
    ]);
    const outcome = await replayReadFixture(tampered);
    expect(outcome.state).toBe("mismatch"); // consumed manifest digest changed
  });

  it("25. replay detects forged resource and manifest digests", async () => {
    const fixtures = await buildReadReplayFixtures();
    const fixture = fixtures.find((candidate) => candidate.toolId === "sirkit.validation.drc-run")!;
    const forgedContent = structuredClone(fixture);
    (forgedContent.bundle.auxiliary.find((envelope) => envelope.kind === "drc-rules")!.content as Record<string, unknown>).evil = true;
    expect((await replayReadFixture(forgedContent)).state).toBe("failed"); // content digest mismatch
    const forgedManifest = structuredClone(fixture);
    forgedManifest.bundle.manifestDigest = "eng1-forged";
    expect((await replayReadFixture(forgedManifest)).state).toBe("failed"); // manifest mismatch
    const forgedConsumed = structuredClone(fixture);
    forgedConsumed.expectedConsumedManifestDigest = "eng1-forged";
    expect((await replayReadFixture(forgedConsumed)).state).toBe("mismatch");
  });
});

describe("prior gates", () => {
  it("27+28. no mutation/release binding is activated in the READ allowlist; agent discovery carries only exposed read/propose tools", () => {
    for (const binding of ACTIVATED_READ_BINDINGS) expect(binding.kind).toBe("read");
    // [B09] the agent channel now includes the activated read/proposal set;
    // every included tool must be explicitly exposed and non-mutating.
    const b = bundle();
    for (const item of discoverTools(registry, contextFor(b, { channel: "assistant-agent" })).included) {
      const descriptor = registry.get(item.toolId, item.version)!;
      expect(descriptor.agentExposed, item.toolId).toBe(true);
      expect(AGENT_EXPOSABLE_OPERATION_CLASSES).toContain(descriptor.operationClass);
    }
  });

  it("digest helper sanity: bundles are content-addressed", () => {
    const a = bundle();
    const c = bundle();
    expect(a.manifestDigest).toBe(c.manifestDigest);
    expect(engineeringDigest(a)).toBe(engineeringDigest(c));
  });
});
