/**
 * B05 — read-only invocation layer tests (updated for B05.1 bundles).
 *
 * Covers: policy rechecks independent of discovery, allowlisted binding
 * resolution negatives, input/output validation and safety, timeout/
 * cancellation, redaction, revision pinning, component authority
 * truthfulness, context-envelope determinism, model-free replay,
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
import { resolveReadBinding, ACTIVATED_READ_BINDINGS, type ActivatedReadBinding } from "../tool-bindings-readonly";
import type { ReadResourceBundle } from "../resource-envelopes";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import {
  ReadToolInvocationService,
  replayReadFixture,
  type ReadInvocationRequest,
  type ReadReplayFixture,
} from "../tool-invocation";
import { renderRegistryJson } from "../tool-registry";
import { buildReadReplayFixtures, replayFixtureBundle } from "../tool-read-replay";
import { AGENT_EXPOSABLE_OPERATION_CLASSES } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const registry = sirkitToolRegistry();

function bundle(): ReadResourceBundle {
  return replayFixtureBundle();
}

function contextFor(b: ReadResourceBundle, overrides?: Partial<DiscoveryContext>): DiscoveryContext {
  const state = b.canonicalState.content;
  return {
    tenantId: state.tenantId,
    projectId: state.projectId,
    branchId: state.branchId,
    actorId: "local-editor", actorRole: "pcb_editor",
    grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "run_automation", "export_project"],
    channel: "interactive-ui",
    currentRevisionDigest: computeProjectRevision(state).canonicalStateDigest,
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
function requestFor(b: ReadResourceBundle, toolId: string, overrides?: Partial<ReadInvocationRequest>): ReadInvocationRequest {
  requestCounter += 1;
  const state = b.canonicalState.content;
  return {
    invocationId: `inv-${requestCounter}`,
    toolId,
    tenantId: state.tenantId,
    projectId: state.projectId,
    branchId: state.branchId,
    actorId: "local-editor", actorRole: "pcb_editor",
    grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "run_automation", "export_project"],
    channel: "interactive-ui",
    canonicalRevisionDigest: computeProjectRevision(state).canonicalStateDigest,
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
    const b = bundle();
    const bad = await service().invoke(requestFor(b, "sirkit.does.not-exist"), contextFor(b), b);
    expect(bad.status).toBe("not_registered");
    const badVersion = await service().invoke(requestFor(b, "sirkit.validation.drc-run", { toolVersion: "9.9.9" }), contextFor(b), b);
    expect(badVersion.status).toBe("not_registered");
  });

  it("2+21. tool not discoverable in the CURRENT context → refused even with valid everything else", async () => {
    const b = bundle();
    const excluded = contextFor(b, { requestedCategories: ["parts"] });
    const result = await service().invoke(requestFor(b, "sirkit.validation.drc-run"), excluded, b);
    expect(result.status).toBe("not_discoverable");
  });

  it("22. a forged discovery digest grants nothing", async () => {
    const b = bundle();
    const excluded = contextFor(b, { requestedCategories: ["parts"] });
    const genuine = discoverTools(registry, contextFor(b));
    const forged = await service().invoke(
      requestFor(b, "sirkit.validation.drc-run", { discoveryDigest: genuine.digest }),
      excluded, b,
    );
    expect(forged.status).toBe("not_discoverable");
  });

  it("7. capability refusal at invocation time (defense in depth)", async () => {
    const b = bundle();
    const split = await service().invoke(
      requestFor(b, "sirkit.validation.drc-run", { grantedCapabilities: [] }),
      contextFor(b), b,
    );
    expect(split.status).toBe("unauthorized");
  });

  it("8. tenant/project/branch mismatch → scope_mismatch", async () => {
    const b = bundle();
    const result = await service().invoke(
      requestFor(b, "sirkit.validation.drc-run", { projectId: "project-other" }),
      contextFor(b, { projectId: "project-other" }), b,
    );
    expect(result.status).toBe("scope_mismatch");
  });

  it("9. stale pinned revision → stale_revision before any engineering facts", async () => {
    const b = bundle();
    const result = await service().invoke(
      requestFor(b, "sirkit.validation.drc-run", { canonicalRevisionDigest: "eng1-stale" }),
      contextFor(b, { currentRevisionDigest: "eng1-stale" }), b,
    );
    expect(result.status).toBe("stale_revision");
  });

  it("10. wrong lineage on a lineage-requiring descriptor is refused", async () => {
    const b = bundle();
    const patched = [{ ...registry.get("sirkit.validation.drc-run")!, requiresLineage: true }];
    const { ToolRegistry } = await import("../tool-registry");
    const lineageService = new ReadToolInvocationService(new ToolRegistry(patched), { now: () => 1 });
    const result = await lineageService.invoke(
      requestFor(b, "sirkit.validation.drc-run", { lineageId: "lin1-wrong" }),
      contextFor(b, { lineageId: "lin1-actual" }), b,
    );
    expect(result.status).toBe("scope_mismatch");
  });

  it("11. canonical authority-source mismatch → authority_unavailable", async () => {
    const b = bundle();
    const result = await service().invoke(
      requestFor(b, "sirkit.validation.drc-run", { authoritySource: "catalog" }),
      contextFor(b), b,
    );
    expect(result.status).toBe("authority_unavailable");
  });
});

describe("binding resolution (allowlist only)", () => {
  it("3. callable descriptor without an allowlisted binding → not_callable", async () => {
    const b = bundle();
    const result = await service({ bindings: [] }).invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
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
});

describe("input/output validation and safety", () => {
  it("12. invalid input schema → invalid_input", async () => {
    const b = bundle();
    const result = await service().invoke(
      requestFor(b, "sirkit.pcb.board-inspect", { args: { projectId: 42 as unknown as string } }),
      contextFor(b), b,
    );
    expect(result.status).toBe("invalid_input");
  });

  it("13. prototype-pollution input → invalid_input", async () => {
    const b = bundle();
    const args = JSON.parse('{"projectId":"ok","__proto__":{"polluted":true}}') as Record<string, unknown>;
    const result = await service().invoke(requestFor(b, "sirkit.pcb.board-inspect", { args }), contextFor(b), b);
    expect(result.status).toBe("invalid_input");
  });

  it("14. oversized input → invalid_input", async () => {
    const b = bundle();
    const result = await service().invoke(
      requestFor(b, "sirkit.pcb.board-inspect", { args: { projectId: "x".repeat(50_000) } }),
      contextFor(b), b,
    );
    expect(result.status).toBe("invalid_input");
  });

  it("15+16+26. binding timeout and cancellation remain intact", async () => {
    const b = bundle();
    const slow: ActivatedReadBinding = {
      ...ACTIVATED_READ_BINDINGS.find((binding) => binding.toolId === "sirkit.validation.drc-run")!,
      invoke: () => new Promise(() => undefined),
    };
    const slowService = service({ bindings: [slow] });
    const timedOut = await slowService.invoke(requestFor(b, "sirkit.validation.drc-run", { timeoutMs: 20 }), contextFor(b), b);
    expect(timedOut.status).toBe("timeout");
    const controller = new AbortController();
    const pending = slowService.invoke(requestFor(b, "sirkit.validation.drc-run", { cancellation: controller.signal }), contextFor(b), b);
    controller.abort();
    expect((await pending).status).toBe("cancelled");
  });

  it("17+26. binding exceptions are redacted — no stacks, messages, or upstream bodies", async () => {
    const b = bundle();
    const exploding: ActivatedReadBinding = {
      ...ACTIVATED_READ_BINDINGS.find((binding) => binding.toolId === "sirkit.validation.drc-run")!,
      invoke: () => { throw new Error("SECRET-DB-PASSWORD=hunter2 at /home/user/secret.ts:42"); },
    };
    const result = await service({ bindings: [exploding] }).invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(result.status).toBe("implementation_failed");
    const text = JSON.stringify(result);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("secret.ts");
    expect(text).toContain("details redacted");
  });

  it("18+19. invalid output schema and output-size limits", async () => {
    const b = bundle();
    const wrongShape: ActivatedReadBinding = {
      ...ACTIVATED_READ_BINDINGS.find((binding) => binding.toolId === "sirkit.validation.drc-run")!,
      invoke: () => ({ notReport: true }),
    };
    const invalid = await service({ bindings: [wrongShape] }).invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(invalid.status).toBe("invalid_output");
    const huge: ActivatedReadBinding = {
      ...wrongShape,
      invoke: () => ({ report: { blob: "y".repeat(10_000) }, pinned: {} }),
    };
    const tooBig = await service({ bindings: [huge], maxOutputBytes: 1_000 }).invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    expect(tooBig.status).toBe("invalid_output");
  });
});

describe("successful reads: determinism, pinning, normalization", () => {
  it("20. deterministic success result with digests, consumed resources, and trace", async () => {
    const b1 = bundle();
    const b2 = bundle();
    const svc = service();
    const a = await svc.invoke(requestFor(b1, "sirkit.pcb.revision-inspect"), contextFor(b1), b1);
    const c = await service().invoke(requestFor(b2, "sirkit.pcb.revision-inspect"), contextFor(b2), b2);
    expect(a.status).toBe("succeeded");
    if (a.status !== "succeeded" || c.status !== "succeeded") throw new Error("unreachable");
    expect(a.outputDigest).toBe(c.outputDigest);
    expect(a.verification).toBe("canonical-revision-verified");
    expect(a.consumedResources.map((entry) => entry.kind)).toEqual(["canonical-state"]);
    expect(a.resourceManifestDigest).toBe(b1.manifestDigest);
    const trace = svc.traces().at(-1)!;
    expect(trace.status).toBe("succeeded");
    expect(trace.resourceManifestDigest).toBe(b1.manifestDigest);
    expect(trace.capabilityDecision).toBe("granted:read_project");
  });

  it("23. board snapshot is revision-pinned with normalized timing", async () => {
    const b = bundle();
    const result = await service().invoke(requestFor(b, "sirkit.pcb.board-inspect"), contextFor(b), b);
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("unreachable");
    const snapshot = result.output.snapshot as Record<string, unknown>;
    expect(snapshot.generatedInMs).toBe(0);
    expect(result.sourceRevisionDigest).toBe(computeProjectRevision(b.canonicalState.content).canonicalStateDigest);
  });

  it("24+25. DRC and connectivity results normalize deterministically; DRC is composite-verified", async () => {
    const b = bundle();
    const drcA = await service().invoke(requestFor(b, "sirkit.validation.drc-run"), contextFor(b), b);
    const bB = bundle();
    const drcB = await service().invoke(requestFor(bB, "sirkit.validation.drc-run"), contextFor(bB), bB);
    if (drcA.status !== "succeeded" || drcB.status !== "succeeded") throw new Error("expected success");
    expect(drcA.outputDigest).toBe(drcB.outputDigest);
    expect(drcA.verification).toBe("composite-resources-verified");
    expect((drcA.output.report as Record<string, Record<string, unknown>>).stats.elapsedMs).toBe(0);
    const conn = await service().invoke(requestFor(b, "sirkit.validation.connectivity-verify"), contextFor(b), b);
    if (conn.status !== "succeeded") throw new Error("expected success");
    expect(conn.verification).toBe("canonical-revision-verified");
    const nets = (conn.output.report as { nets: Array<{ netId: number }> }).nets;
    expect(nets.map((net) => net.netId)).toEqual([...nets.map((net) => net.netId)].sort((x, y) => x - y));
  });

  it("26b. selection inspection resolves the SEALED current selection (B10: empty input — no model-invented refs)", async () => {
    const b = bundle();
    const result = await service().invoke(
      requestFor(b, "sirkit.selection.inspect", { args: {} }),
      contextFor(b), b,
    );
    if (result.status !== "succeeded") throw new Error(`expected success, got ${result.status}`);
    const output = result.output as { items: Array<{ id: string; kind: string }>; droppedRefs: string[] };
    expect(output.items.map((item) => item.id)).toEqual(["u1", "t1"]); // the sealed selection-snapshot refs, resolved
    expect(output.droppedRefs).toEqual([]);
    // [B10] model-supplied refs are refused by the strict empty schema.
    const invented = await service().invoke(
      requestFor(b, "sirkit.selection.inspect", { args: { refs: [{ kind: "footprint", id: "u1" }] } }),
      contextFor(b), b,
    );
    expect(invented.status).toBe("invalid_input");
  });

  it("30. manufacturing readiness is inspection only — no authority write, no release artifact", async () => {
    const b = bundle();
    const before = engineeringDigest(b);
    const result = await service().invoke(requestFor(b, "sirkit.manufacturing.readiness-inspect"), contextFor(b), b);
    expect(result.status).toBe("succeeded");
    expect(engineeringDigest(b)).toBe(before);
  });

  it("37. activated bindings never mutate the supplied bundle", async () => {
    const b = bundle();
    const before = engineeringDigest(b);
    for (const binding of ACTIVATED_READ_BINDINGS) {
      // [B10] selection inspection takes NO args — it reads the sealed
      // current selection.
      const args = {};
      // [B09] the schematic accessor is category "schematic" — clear the
      // editor pin so it is discoverable in this fixture context.
      const context = contextFor(b, binding.toolId === "sirkit.schematic.inspect" ? { currentEditor: "" } : {});
      const result = await service().invoke(requestFor(b, binding.toolId, { args }), context, b);
      expect(result.status, binding.toolId).toBe("succeeded");
    }
    expect(engineeringDigest(b)).toBe(before);
  });
});

describe("component authority truthfulness", () => {
  const record = (componentId: string, extra: Record<string, unknown>): never => ({
    authorityRecordId: `auth:${componentId}`, componentId, authorityRevision: "rev-1", ...extra,
  }) as never;

  it("27+28. verified / unresolved / stale / conflicting / exact-missing-footprint fixtures", () => {
    const summaries = inspectComponentAuthority({
      componentIds: ["c-verified", "c-facets-no-exact", "c-unresolved", "c-stale", "c-conflict", "c-no-footprint"],
      records: [
        record("c-verified", { selectedPart: { mpn: "M1", manufacturer: "A", package: "P", provenance: "physical-binding" }, lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "available", mappingVerification: "verified", exactAuthority: { atomicPartRevisionId: "ar1", mpn: "M1", manufacturer: "A", symbolAssetVersionId: "s1", footprintAssetVersionId: "f1", mappingCertificateId: "m1" } }),
        record("c-facets-no-exact", { selectedPart: { mpn: "M5", manufacturer: "E", provenance: "physical-binding" }, lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "available", mappingVerification: "verified" }),
        record("c-unresolved", { lifecycle: "draft", approval: "unreviewed", freshness: "unknown", conflict: "none", footprintAsset: "missing", mappingVerification: "missing" }),
        record("c-stale", { selectedPart: { mpn: "M2", manufacturer: "B", provenance: "atomic-link" }, lifecycle: "selected", approval: "approved", freshness: "stale", conflict: "none", footprintAsset: "available", mappingVerification: "verified" }),
        record("c-conflict", { selectedPart: { mpn: "M3", manufacturer: "C", provenance: "physical-binding" }, lifecycle: "selected", approval: "approved", freshness: "current", conflict: "present", footprintAsset: "available", mappingVerification: "verified" }),
        record("c-no-footprint", { selectedPart: { mpn: "M4", manufacturer: "D", provenance: "manual-selection" }, lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "unresolved", mappingVerification: "pending" }),
      ],
    });
    const byId = new Map(summaries.map((summary) => [summary.componentId, summary]));
    expect(byId.get("c-verified")!.state).toBe("verified-exact");
    expect(byId.get("c-verified")!.exactPart!.mpn).toBe("M1");
    expect(byId.get("c-verified")!.authority!.recordId).toBe("auth:c-verified");
    // [B13.1 §E] clean facets WITHOUT server-owned exact authority are truthful,
    // never verified-exact.
    expect(byId.get("c-facets-no-exact")!.state).toBe("exact-authority-unresolved");
    expect(byId.get("c-unresolved")!.state).toBe("unresolved");
    expect(byId.get("c-stale")!.state).toBe("stale");
    expect(byId.get("c-conflict")!.state).toBe("conflicted");
    expect(byId.get("c-no-footprint")!.state).toBe("exact-missing-footprint");
  });

  it("29. a search candidate is NEVER treated as selected authority", () => {
    const [summary] = inspectComponentAuthority({
      componentIds: ["c-cand"],
      records: [],
      candidates: [{ componentId: "c-cand", mpn: "TEMPTING-123", manufacturer: "Shiny", displayText: "TEMPTING-123 Shiny SOIC-8" }],
    });
    expect(summary.state).toBe("candidate-only");
    expect(summary.exactPart).toBeNull();
    expect(summary.authority).toBeNull();
    expect(summary.searchCandidates).toEqual([{ mpn: "TEMPTING-123", manufacturer: "Shiny" }]);
  });
});

describe("context envelope", () => {
  it("31. deterministic envelope and digest", () => {
    const b = bundle();
    const authority = b.auxiliary.find((envelope) => envelope.kind === "component-authority-records")!;
    const input = {
      canonicalState: b.canonicalState.content, authoritySource: "local-working-copy", authorityStatus: "verified" as const,
      currentEditor: "pcb",
      componentAuthority: { componentIds: ["u1", "u2"], ...(authority.content as { records: never[] }) },
      resourceManifestDigest: b.manifestDigest,
    };
    const a = assembleEngineeringContext(structuredClone(input));
    const c = assembleEngineeringContext(structuredClone(input));
    expect(a.contextDigest).toBe(c.contextDigest);
    expect(a.resourceManifestDigest).toBe(b.manifestDigest);
    expect(canonicalJson(a)).toBe(canonicalJson(c));
  });

  it("32. budget truncation is reported explicitly", () => {
    const b = bundle();
    const envelope = assembleEngineeringContext({
      canonicalState: b.canonicalState.content, authoritySource: "local-working-copy", authorityStatus: "verified",
      currentEditor: "pcb",
      selection: [{ kind: "footprint", id: "u1" }, { kind: "footprint", id: "u2" }, { kind: "track", id: "t1" }],
      budget: { maxSelection: 2 },
    });
    expect(envelope.selection.status).toBe("present");
    if (envelope.selection.status === "present") expect(envelope.selection.data).toHaveLength(2);
    expect(envelope.truncation).toEqual([{ section: "selection", kept: 2, dropped: 1 }]);
  });

  it("33. unknown and omitted sections are distinguishable", () => {
    const b = bundle();
    const envelope = assembleEngineeringContext({
      canonicalState: b.canonicalState.content, authoritySource: "local-working-copy", authorityStatus: "verified", currentEditor: "pcb",
    });
    expect(envelope.selection.status).toBe("omitted");
    expect(envelope.validationFailures.status).toBe("unknown");
    expect(envelope.readiness.status).toBe("unknown");
  });
});

describe("replay", () => {
  it("34. model-free replay reproduces output digest, consumed manifest digest, and verification state", async () => {
    const fixtures = await buildReadReplayFixtures();
    expect(fixtures).toHaveLength(ACTIVATED_READ_BINDINGS.length);
    for (const fixture of fixtures) {
      const outcome = await replayReadFixture(fixture);
      expect(outcome.state, fixture.toolId).toBe("match");
    }
  });

  it("35. replay detects changed output digests and tampered bundles", async () => {
    const fixtures = await buildReadReplayFixtures();
    const fixture = fixtures.find((candidate) => candidate.toolId === "sirkit.validation.drc-run")!;
    const tamperedDigest: ReadReplayFixture = { ...fixture, expectedOutputDigest: "eng1-forged" };
    expect((await replayReadFixture(tamperedDigest)).state).toBe("mismatch");
    const tamperedBundle: ReadReplayFixture = structuredClone(fixture);
    tamperedBundle.bundle.canonicalState.content.pcb.tracks.push({ id: "t-injected", layer: "copperTop", width: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, netId: 1, source: "human" });
    expect((await replayReadFixture(tamperedBundle)).state).toBe("failed"); // envelope digest mismatch
  });
});

describe("architecture + prior-stage consistency", () => {
  const B05_FILES = [
    "app/lib/engineering/tool-invocation.ts",
    "app/lib/engineering/tool-bindings-readonly.ts",
    "app/lib/engineering/tool-io-validation.ts",
    "app/lib/engineering/resource-envelopes.ts",
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

  it("38. agent discovery yields only explicitly exposed read/propose tools — never mutation capability", () => {
    // [B09] the agent channel now carries the activated read/proposal set;
    // it can still NEVER contain a mutation-capable class.
    const b = bundle();
    for (const channel of ["assistant-agent", "automation"] as const) {
      const included = discoverTools(registry, contextFor(b, { channel })).included;
      for (const item of included) {
        const descriptor = registry.get(item.toolId, item.version)!;
        expect(descriptor.agentExposed, item.toolId).toBe(true);
        expect(AGENT_EXPOSABLE_OPERATION_CLASSES).toContain(descriptor.operationClass);
      }
    }
  });

  it("40. generated B04 + B05 artifacts remain byte-consistent", async () => {
    const { renderToolRegistryCsv, renderNonCallableCoverageCsv } = await import("../tool-registry");
    const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
    expect(read("artifacts/ai-control-plane-b04/tool-registry.csv")).toBe(renderToolRegistryCsv(registry));
    expect(read("artifacts/ai-control-plane-b04/non-callable-coverage.csv")).toBe(renderNonCallableCoverageCsv(registry));
    const fixtures = await buildReadReplayFixtures();
    expect(read("artifacts/ai-control-plane-b05/read-replay-fixtures.json")).toBe(renderRegistryJson({ schema: "sirkit.read-replay-fixtures.v2", fixtures }));
  });
});
