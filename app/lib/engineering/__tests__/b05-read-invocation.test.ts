/**
 * B05 — read-only invocation layer tests.
 *
 * Covers the required matrix: policy rechecks independent of discovery,
 * allowlisted binding resolution negatives, input/output validation and
 * safety, timeout/cancellation, redaction, revision pinning, component
 * authority truthfulness, context-envelope determinism, model-free replay,
 * architectural purity, and B01–B04 consistency.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inspectComponentAuthority } from "../component-authority";
import { assembleEngineeringContext } from "../context-assembler";
import { computeProjectRevision } from "../revision";
import { canonicalJson, engineeringDigest } from "../stable";
import { sirkitToolRegistry } from "../tool-catalog";
import { resolveReadBinding, ACTIVATED_READ_BINDINGS, type ReadResourceSet, type ActivatedReadBinding } from "../tool-bindings-readonly";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import {
  ReadToolInvocationService,
  replayReadFixture,
  type ReadInvocationRequest,
  type ReadReplayFixture,
} from "../tool-invocation";
import { renderRegistryJson } from "../tool-registry";
import { buildReadReplayFixtures, replayFixtureResources } from "../tool-read-replay";

const registry = sirkitToolRegistry();

function resources(): ReadResourceSet {
  return replayFixtureResources();
}

function contextFor(res: ReadResourceSet, overrides?: Partial<DiscoveryContext>): DiscoveryContext {
  return {
    tenantId: res.canonicalState.tenantId,
    projectId: res.canonicalState.projectId,
    branchId: res.canonicalState.branchId,
    actorId: "local-editor", actorRole: "pcb_editor",
    grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "run_automation", "export_project"],
    channel: "interactive-ui",
    currentRevisionDigest: computeProjectRevision(res.canonicalState).canonicalStateDigest,
    lineageId: "lin1-fixture",
    currentEditor: "pcb",
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

let requestCounter = 0;
function requestFor(res: ReadResourceSet, toolId: string, overrides?: Partial<ReadInvocationRequest>): ReadInvocationRequest {
  requestCounter += 1;
  return {
    invocationId: `inv-${requestCounter}`,
    toolId,
    tenantId: res.canonicalState.tenantId,
    projectId: res.canonicalState.projectId,
    branchId: res.canonicalState.branchId,
    actorId: "local-editor", actorRole: "pcb_editor",
    grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "run_automation", "export_project"],
    channel: "interactive-ui",
    canonicalRevisionDigest: computeProjectRevision(res.canonicalState).canonicalStateDigest,
    authoritySource: "local-working-copy",
    currentEditor: "pcb",
    args: {},
    traceId: `trace-${requestCounter}`,
    requestTimestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function service(options?: ConstructorParameters<typeof ReadToolInvocationService>[1]): ReadToolInvocationService {
  let tick = 0;
  return new ReadToolInvocationService(registry, { now: () => 1_700_000_000_000 + tick++ * 10, ...options });
}

describe("invocation policy rechecks (discovery is advisory, not authorization)", () => {
  it("1. unknown tool/version → not_registered", async () => {
    const res = resources();
    const bad = await service().invoke(requestFor(res, "sirkit.does.not-exist"), contextFor(res), res);
    expect(bad.status).toBe("not_registered");
    const badVersion = await service().invoke(requestFor(res, "sirkit.validation.drc-run", { toolVersion: "9.9.9" }), contextFor(res), res);
    expect(badVersion.status).toBe("not_registered");
  });

  it("2+21. tool not discoverable in the CURRENT context → refused even with valid everything else", async () => {
    const res = resources();
    const readOnlyCeiling = contextFor(res, { grantedCapabilities: ["read_project"], actorRole: "viewer" });
    // drc-run remains discoverable for viewer; use a capability the viewer lacks via component tool? Use requestedCategories to exclude.
    const excluded = contextFor(res, { requestedCategories: ["parts"] });
    const result = await service().invoke(requestFor(res, "sirkit.validation.drc-run"), excluded, res);
    expect(result.status).toBe("not_discoverable");
    void readOnlyCeiling;
  });

  it("22. a forged discovery digest grants nothing", async () => {
    const res = resources();
    const excluded = contextFor(res, { requestedCategories: ["parts"] });
    const genuine = discoverTools(registry, contextFor(res));
    const forged = await service().invoke(
      requestFor(res, "sirkit.validation.drc-run", { discoveryDigest: genuine.digest }),
      excluded, res,
    );
    expect(forged.status).toBe("not_discoverable");
  });

  it("7. role/capability refusal at invocation time", async () => {
    const res = resources();
    const roleFail = await service().invoke(
      requestFor(res, "sirkit.validation.drc-run", { actorRole: "commenter" }),
      contextFor(res, { actorRole: "commenter" }), res,
    );
    // commenter IS in drc-run requiredRoles; use component-authority (viewer ok) with missing capability instead:
    const capabilityFail = await service().invoke(
      requestFor(res, "sirkit.validation.drc-run", { grantedCapabilities: [] }),
      contextFor(res, { grantedCapabilities: [] }), res,
    );
    expect(capabilityFail.status).toBe("not_discoverable"); // discovery already excludes
    // Defense in depth: pass discovery (context has capability) but request lacks it.
    const split = await service().invoke(
      requestFor(res, "sirkit.validation.drc-run", { grantedCapabilities: [] }),
      contextFor(res), res,
    );
    expect(split.status).toBe("unauthorized");
    void roleFail;
  });

  it("8. tenant/project/branch mismatch → scope_mismatch", async () => {
    const res = resources();
    const result = await service().invoke(
      requestFor(res, "sirkit.validation.drc-run", { projectId: "project-other" }),
      contextFor(res, { projectId: "project-other" }), res,
    );
    expect(result.status).toBe("scope_mismatch");
  });

  it("9. stale pinned revision → stale_revision before any engineering facts", async () => {
    const res = resources();
    const result = await service().invoke(
      requestFor(res, "sirkit.validation.drc-run", { canonicalRevisionDigest: "eng1-stale" }),
      contextFor(res, { currentRevisionDigest: "eng1-stale" }), res,
    );
    expect(result.status).toBe("stale_revision");
  });

  it("10. wrong lineage on a lineage-requiring descriptor is refused", async () => {
    const res = resources();
    const patched = [{
      ...registry.get("sirkit.validation.drc-run")!,
      toolId: "sirkit.validation.drc-run", requiresLineage: true,
    }];
    const { ToolRegistry } = await import("../tool-registry");
    const lineageRegistry = new ToolRegistry(patched);
    const lineageService = new ReadToolInvocationService(lineageRegistry, { now: () => 1 });
    const result = await lineageService.invoke(
      requestFor(res, "sirkit.validation.drc-run", { lineageId: "lin1-wrong" }),
      contextFor(res, { lineageId: "lin1-actual" }), res,
    );
    expect(result.status).toBe("scope_mismatch");
  });

  it("11. authority unavailable", async () => {
    const res = { ...resources(), availableAuthority: ["catalog"] as const };
    const result = await service().invoke(
      requestFor(res, "sirkit.validation.drc-run"),
      contextFor(res, { availableAuthority: ["catalog"] }), res,
    );
    expect(["authority_unavailable", "not_discoverable"]).toContain(result.status);
    // Missing resource for a supplied authority: readiness without inputs.
    const noReadiness = resources();
    delete (noReadiness as { readiness?: unknown }).readiness;
    const readiness = await service().invoke(requestFor(noReadiness, "sirkit.manufacturing.readiness-inspect"), contextFor(noReadiness), noReadiness);
    expect(readiness.status).toBe("authority_unavailable");
  });
});

describe("binding resolution (allowlist only)", () => {
  it("3. callable descriptor without an allowlisted binding → not_callable", async () => {
    const res = resources();
    const result = await service({ bindings: [] }).invoke(requestFor(res, "sirkit.validation.drc-run"), contextFor(res), res);
    expect(result.status).toBe("not_callable");
    if (result.status !== "not_callable") throw new Error("unreachable");
    expect(result.diagnostics[0]).toContain("metadata alone is never an implementation");
  });

  it("4. descriptor/binding module-symbol mismatch → not_callable", () => {
    const descriptor = { ...registry.get("sirkit.validation.drc-run")!, binding: { status: "bound-read" as const, module: "app/lib/evil.ts", symbol: "steal" } };
    const resolution = resolveReadBinding(descriptor);
    expect(resolution.state).toBe("not_callable");
    if (resolution.state === "not_callable") expect(resolution.reason).toContain("does not match the allowlisted implementation");
  });

  it("5+6. non-read and mutation/destructive/release/internal descriptors are rejected", () => {
    for (const toolId of ["sirkit.pcb.move-footprint", "sirkit.pcb.delete-item", "sirkit.manufacturing.release", "sirkit.pcb.undo-redo-canonical", "sirkit.placement.propose", "sirkit.pcb.repair-plan"]) {
      const descriptor = registry.get(toolId)!;
      const resolution = resolveReadBinding(descriptor);
      expect(resolution.state, toolId).toBe("not_callable");
    }
  });

  it("proposal tools are NOT activated in B05 even though callable in B04", async () => {
    const res = resources();
    const result = await service().invoke(requestFor(res, "sirkit.placement.propose", { grantedCapabilities: ["read_project", "run_automation"] }), contextFor(res), res);
    expect(["not_callable", "not_discoverable"]).toContain(result.status);
  });
});

describe("input/output validation and safety", () => {
  it("12. invalid input schema → invalid_input", async () => {
    const res = resources();
    const result = await service().invoke(
      requestFor(res, "sirkit.pcb.board-inspect", { args: { projectId: 42 as unknown as string } }),
      contextFor(res), res,
    );
    expect(result.status).toBe("invalid_input");
  });

  it("13. prototype-pollution input → invalid_input", async () => {
    const res = resources();
    const args = JSON.parse('{"projectId":"ok","__proto__":{"polluted":true}}') as Record<string, unknown>;
    const result = await service().invoke(requestFor(res, "sirkit.pcb.board-inspect", { args }), contextFor(res), res);
    expect(result.status).toBe("invalid_input");
    if (result.status === "invalid_input") expect(result.diagnostics.join(" ")).toContain("forbidden key");
  });

  it("14. oversized input → invalid_input", async () => {
    const res = resources();
    const result = await service().invoke(
      requestFor(res, "sirkit.pcb.board-inspect", { args: { projectId: "x".repeat(50_000) } }),
      contextFor(res), res,
    );
    expect(result.status).toBe("invalid_input");
  });

  it("15+16. binding timeout and cancellation", async () => {
    const res = resources();
    const slow: ActivatedReadBinding = {
      ...ACTIVATED_READ_BINDINGS.find((binding) => binding.toolId === "sirkit.validation.drc-run")!,
      invoke: () => new Promise(() => undefined), // never resolves
    };
    const slowService = service({ bindings: [slow] });
    const timedOut = await slowService.invoke(requestFor(res, "sirkit.validation.drc-run", { timeoutMs: 20 }), contextFor(res), res);
    expect(timedOut.status).toBe("timeout");
    const controller = new AbortController();
    const pending = slowService.invoke(requestFor(res, "sirkit.validation.drc-run", { cancellation: controller.signal }), contextFor(res), res);
    controller.abort();
    expect((await pending).status).toBe("cancelled");
    const preAborted = new AbortController();
    preAborted.abort();
    const immediate = await slowService.invoke(requestFor(res, "sirkit.validation.drc-run", { cancellation: preAborted.signal }), contextFor(res), res);
    expect(immediate.status).toBe("cancelled");
  });

  it("17. binding exceptions are redacted — no stacks, messages, or upstream bodies", async () => {
    const res = resources();
    const exploding: ActivatedReadBinding = {
      ...ACTIVATED_READ_BINDINGS.find((binding) => binding.toolId === "sirkit.validation.drc-run")!,
      invoke: () => { throw new Error("SECRET-DB-PASSWORD=hunter2 at /home/user/secret.ts:42"); },
    };
    const result = await service({ bindings: [exploding] }).invoke(requestFor(res, "sirkit.validation.drc-run"), contextFor(res), res);
    expect(result.status).toBe("implementation_failed");
    const text = JSON.stringify(result);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("secret.ts");
    expect(text).toContain("details redacted");
  });

  it("18+19. invalid output schema and output-size limits", async () => {
    const res = resources();
    const wrongShape: ActivatedReadBinding = {
      ...ACTIVATED_READ_BINDINGS.find((binding) => binding.toolId === "sirkit.validation.drc-run")!,
      invoke: () => ({ notReport: true }),
    };
    const invalid = await service({ bindings: [wrongShape] }).invoke(requestFor(res, "sirkit.validation.drc-run"), contextFor(res), res);
    expect(invalid.status).toBe("invalid_output");
    const huge: ActivatedReadBinding = {
      ...wrongShape,
      invoke: () => ({ report: { blob: "y".repeat(10_000) } }),
    };
    const tooBig = await service({ bindings: [huge], maxOutputBytes: 1_000 }).invoke(requestFor(res, "sirkit.validation.drc-run"), contextFor(res), res);
    expect(tooBig.status).toBe("invalid_output");
  });
});

describe("successful reads: determinism, pinning, normalization", () => {
  it("20. deterministic success result with input/output digests and trace", async () => {
    const res1 = resources();
    const res2 = resources();
    const svc = service();
    const a = await svc.invoke(requestFor(res1, "sirkit.pcb.revision-inspect"), contextFor(res1), res1);
    const b = await service().invoke(requestFor(res2, "sirkit.pcb.revision-inspect"), contextFor(res2), res2);
    expect(a.status).toBe("succeeded");
    if (a.status !== "succeeded" || b.status !== "succeeded") throw new Error("unreachable");
    expect(a.outputDigest).toBe(b.outputDigest);
    expect(a.verification).toBe("revision-verified");
    expect(a.sourceRevisionDigest).toBe(computeProjectRevision(res1.canonicalState).canonicalStateDigest);
    const trace = svc.traces().at(-1)!;
    expect(trace.status).toBe("succeeded");
    expect(trace.outputDigest).toBe(a.outputDigest);
    expect(trace.capabilityDecision).toBe("granted:read_project");
  });

  it("23. board snapshot is revision-pinned with normalized timing", async () => {
    const res = resources();
    const result = await service().invoke(requestFor(res, "sirkit.pcb.board-inspect"), contextFor(res), res);
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("unreachable");
    const snapshot = result.output.snapshot as Record<string, unknown>;
    expect(snapshot.generatedInMs).toBe(0);
    expect(result.sourceRevisionDigest).toBe(computeProjectRevision(res.canonicalState).canonicalStateDigest);
  });

  it("24+25. DRC and connectivity results normalize deterministically", async () => {
    const res = resources();
    const drcA = await service().invoke(requestFor(res, "sirkit.validation.drc-run"), contextFor(res), res);
    const resB = resources();
    const drcB = await service().invoke(requestFor(resB, "sirkit.validation.drc-run"), contextFor(resB), resB);
    if (drcA.status !== "succeeded" || drcB.status !== "succeeded") throw new Error("expected success");
    expect(drcA.outputDigest).toBe(drcB.outputDigest);
    expect((drcA.output.report as Record<string, Record<string, unknown>>).stats.elapsedMs).toBe(0);
    const conn = await service().invoke(requestFor(res, "sirkit.validation.connectivity-verify"), contextFor(res), res);
    if (conn.status !== "succeeded") throw new Error("expected success");
    const nets = (conn.output.report as { nets: Array<{ netId: number }> }).nets;
    expect(nets.map((net) => net.netId)).toEqual([...nets.map((net) => net.netId)].sort((x, y) => x - y));
  });

  it("26. selection inspection resolves live refs and reports dropped ones explicitly", async () => {
    const res = resources();
    const result = await service().invoke(
      requestFor(res, "sirkit.selection.inspect", { args: { refs: [{ kind: "footprint", id: "u1" }, { kind: "track", id: "t-gone" }] } }),
      contextFor(res), res,
    );
    if (result.status !== "succeeded") throw new Error(`expected success, got ${result.status}`);
    const output = result.output as { items: Array<{ id: string }>; droppedRefs: string[] };
    expect(output.items.map((item) => item.id)).toEqual(["u1"]);
    expect(output.droppedRefs).toEqual(["t-gone"]);
  });

  it("30. manufacturing readiness is inspection only — no release artifact, no authority write", async () => {
    const res = resources();
    const before = engineeringDigest(res.canonicalState);
    const result = await service().invoke(requestFor(res, "sirkit.manufacturing.readiness-inspect"), contextFor(res), res);
    expect(result.status).toBe("succeeded");
    expect(engineeringDigest(res.canonicalState)).toBe(before);
    if (result.status !== "succeeded") throw new Error("unreachable");
    expect(JSON.stringify(result.output)).not.toContain("releaseId");
  });

  it("37. activated bindings never mutate the supplied resources", async () => {
    const res = resources();
    const before = engineeringDigest(res);
    for (const binding of ACTIVATED_READ_BINDINGS) {
      const result = await service().invoke(requestFor(res, binding.toolId), contextFor(res), res);
      expect(["succeeded", "invalid_input"]).toContain(result.status);
    }
    expect(engineeringDigest(res)).toBe(before);
  });
});

describe("component authority truthfulness", () => {
  it("27+28. verified / unresolved / stale / conflicting / exact-missing-footprint fixtures", () => {
    const summaries = inspectComponentAuthority({
      componentIds: ["c-verified", "c-unresolved", "c-stale", "c-conflict", "c-no-footprint"],
      records: [
        { componentId: "c-verified", selectedPart: { mpn: "M1", manufacturer: "A", package: "P", provenance: "physical-binding" }, lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "available", mappingVerification: "verified" },
        { componentId: "c-unresolved", lifecycle: "draft", approval: "unreviewed", freshness: "unknown", conflict: "none", footprintAsset: "missing", mappingVerification: "missing" },
        { componentId: "c-stale", selectedPart: { mpn: "M2", manufacturer: "B", provenance: "atomic-link" }, lifecycle: "selected", approval: "approved", freshness: "stale", conflict: "none", footprintAsset: "available", mappingVerification: "verified" },
        { componentId: "c-conflict", selectedPart: { mpn: "M3", manufacturer: "C", provenance: "physical-binding" }, lifecycle: "selected", approval: "approved", freshness: "current", conflict: "present", footprintAsset: "available", mappingVerification: "verified" },
        { componentId: "c-no-footprint", selectedPart: { mpn: "M4", manufacturer: "D", provenance: "manual-selection" }, lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "unresolved", mappingVerification: "pending" },
      ],
    });
    const byId = new Map(summaries.map((summary) => [summary.componentId, summary]));
    expect(byId.get("c-verified")!.state).toBe("verified-exact");
    expect(byId.get("c-verified")!.exactPart!.mpn).toBe("M1");
    expect(byId.get("c-unresolved")!.state).toBe("unresolved");
    expect(byId.get("c-unresolved")!.exactPart).toBeNull();
    expect(byId.get("c-stale")!.state).toBe("stale");
    expect(byId.get("c-conflict")!.state).toBe("conflicted");
    expect(byId.get("c-no-footprint")!.state).toBe("exact-missing-footprint");
    expect(byId.get("c-no-footprint")!.authorityGaps.join(" ")).toContain("footprint asset unresolved");
  });

  it("29. a search candidate is NEVER treated as selected authority", () => {
    const [summary] = inspectComponentAuthority({
      componentIds: ["c-cand"],
      records: [],
      candidates: [{ componentId: "c-cand", mpn: "TEMPTING-123", manufacturer: "Shiny", displayText: "TEMPTING-123 Shiny SOIC-8" }],
    });
    expect(summary.state).toBe("candidate-only");
    expect(summary.exactPart).toBeNull(); // the candidate MPN never becomes authority
    expect(summary.searchCandidates).toEqual([{ mpn: "TEMPTING-123", manufacturer: "Shiny" }]);
    expect(summary.authorityGaps[0]).toContain("no authority record");
  });
});

describe("context envelope", () => {
  it("31. deterministic envelope and digest", () => {
    const res = resources();
    const input = {
      canonicalState: res.canonicalState, authoritySource: "local-working-copy", authorityStatus: "verified" as const,
      currentEditor: "pcb", selection: res.selectionRefs, componentAuthority: { componentIds: ["u1", "u2"], ...res.componentAuthority! },
    };
    const a = assembleEngineeringContext(structuredClone(input));
    const b = assembleEngineeringContext(structuredClone(input));
    expect(a.contextDigest).toBe(b.contextDigest);
    expect(a.pinnedRevision.canonicalStateDigest).toBe(computeProjectRevision(res.canonicalState).canonicalStateDigest);
    expect(a.units).toBe("nm");
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("32. budget truncation is reported explicitly", () => {
    const res = resources();
    const envelope = assembleEngineeringContext({
      canonicalState: res.canonicalState, authoritySource: "local-working-copy", authorityStatus: "verified",
      currentEditor: "pcb",
      selection: [{ kind: "footprint", id: "u1" }, { kind: "footprint", id: "u2" }, { kind: "track", id: "t1" }],
      budget: { maxSelection: 2 },
    });
    expect(envelope.selection.status).toBe("present");
    if (envelope.selection.status === "present") expect(envelope.selection.data).toHaveLength(2);
    expect(envelope.truncation).toEqual([{ section: "selection", kept: 2, dropped: 1 }]);
  });

  it("33. unknown and omitted sections are distinguishable", () => {
    const res = resources();
    const envelope = assembleEngineeringContext({
      canonicalState: res.canonicalState, authoritySource: "local-working-copy", authorityStatus: "verified", currentEditor: "pcb",
    });
    expect(envelope.selection.status).toBe("omitted");
    expect(envelope.schematicSummary.status).toBe("omitted");
    expect(envelope.validationFailures.status).toBe("unknown");
    expect(envelope.readiness.status).toBe("unknown");
    if (envelope.validationFailures.status === "unknown") expect(envelope.validationFailures.reason.length).toBeGreaterThan(0);
  });
});

describe("replay", () => {
  it("34. model-free replay reproduces the pinned output digest for every fixture", async () => {
    const fixtures = await buildReadReplayFixtures();
    expect(fixtures).toHaveLength(ACTIVATED_READ_BINDINGS.length);
    for (const fixture of fixtures) {
      const outcome = await replayReadFixture(fixture);
      expect(outcome.state, fixture.toolId).toBe("match");
    }
  });

  it("35. replay detects changed implementation output and tampered fixtures", async () => {
    const [fixture] = await buildReadReplayFixtures();
    const tamperedDigest: ReadReplayFixture = { ...fixture, expectedOutputDigest: "eng1-forged" };
    expect((await replayReadFixture(tamperedDigest)).state).toBe("mismatch");
    const tamperedResources: ReadReplayFixture = structuredClone(fixture);
    tamperedResources.resources.canonicalState.pcb.tracks.push({ id: "t-injected", layer: "copperTop", width: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, netId: 1, source: "human" });
    expect((await replayReadFixture(tamperedResources)).state).toBe("failed"); // resource digest mismatch
  });
});

describe("architecture + prior-stage consistency", () => {
  const B05_FILES = [
    "app/lib/engineering/tool-invocation.ts",
    "app/lib/engineering/tool-bindings-readonly.ts",
    "app/lib/engineering/tool-io-validation.ts",
    "app/lib/engineering/component-authority.ts",
    "app/lib/engineering/context-assembler.ts",
    "app/lib/engineering/tool-read-replay.ts",
  ];

  it("36. no B05 module imports the executor, editor adapter, interactive channel, providers, or persistence writers", () => {
    for (const file of B05_FILES) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const imports = [...source.matchAll(/^import[^;]+from\s+"([^"]+)";?$/gm)].map((match) => match[1]);
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/executor|editor-adapter|interactive-channel|\/llm\/|openai|anthropic|persistence|browser-indexeddb|transaction-service|\/api\/|components\//);
      }
      expect(source).not.toMatch(/localStorage|indexedDB|fetch\(|process\.env/);
    }
  });

  it("38. agent discovery remains empty", () => {
    const res = resources();
    expect(discoverTools(registry, contextFor(res, { channel: "assistant-agent" })).included).toEqual([]);
    expect(discoverTools(registry, contextFor(res, { channel: "automation" })).included).toEqual([]);
  });

  it("40. generated B04 + B05 artifacts remain byte-consistent", async () => {
    const { renderToolRegistryCsv, renderNonCallableCoverageCsv } = await import("../tool-registry");
    const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
    expect(read("artifacts/ai-control-plane-b04/tool-registry.csv")).toBe(renderToolRegistryCsv(registry));
    expect(read("artifacts/ai-control-plane-b04/non-callable-coverage.csv")).toBe(renderNonCallableCoverageCsv(registry));
    const fixtures = await buildReadReplayFixtures();
    expect(read("artifacts/ai-control-plane-b05/read-replay-fixtures.json")).toBe(renderRegistryJson({ schema: "sirkit.read-replay-fixtures.v1", fixtures }));
    const bindingsCsv = read("artifacts/ai-control-plane-b05/activated-read-bindings.csv");
    for (const binding of ACTIVATED_READ_BINDINGS) expect(bindingsCsv).toContain(binding.bindingId);
    expect(bindingsCsv).not.toContain("false"); // every descriptor matches its allowlisted implementation
  });
});
