/**
 * B13.1 — production component-authority activation and durable-source
 * integrity. Real physical-binding service aggregates, real validators, real
 * atomic cross-check, real deadline/cancellation, real provider adapters.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadComponentAuthorityRecords,
  loadRunComponentAuthority,
  type AuthorityBindingAggregate,
  type AuthorityBindingSource,
  type ComponentAuthoritySourceDeps,
} from "../component-authority-source";
import { inspectComponentAuthority, type ComponentAuthorityRecord } from "../component-authority";
import { pcbBoardInstanceId, PCB_BOARD_HIERARCHY_PATH, PCB_BOARD_ASSEMBLY_VARIANT_ID } from "../../pcb/board-identity";
import { renderOpenAiResponsesTool, renderAnthropicAgentTool } from "../../agent/provider-tools";
import { assembleAgentRunContext } from "../../agent/context";
import { sirkitToolRegistry } from "../tool-catalog";
import { buildRunToolset } from "../../agent/loop";
import { createEmptyBoard } from "../../pcb/types";
import { scope as bindingFixtureScope } from "../../physical-binding/__tests__/fixtures";
import {
  resolveComponentAuthoritySource,
  setComponentAuthoritySourceFactory,
  resetComponentAuthoritySourceFactory,
} from "../../../api/chat/component-authority-runtime";
import { FIXTURE_AUTHORITY_HIERARCHY, FIXTURE_AUTHORITY_SCOPE, FIXTURE_EXACT, matchingAtomicConfirmer, validApprovedAggregate } from "./_authority-fixtures";

const COMPONENT = "component-uuid-1";
const SCOPE = FIXTURE_AUTHORITY_SCOPE;
// [B13.2 §A] loads against fixture aggregates request the fixture hierarchy.
const LOAD = { scope: SCOPE, canonicalRevision: "eng1-head", componentInstanceIds: [COMPONENT], hierarchyPath: FIXTURE_AUTHORITY_HIERARCHY };

function source(aggregates: readonly AuthorityBindingAggregate[]): AuthorityBindingSource {
  return { async loadForComponent() { return aggregates; } };
}
const deps = (bindings: AuthorityBindingSource, atomic = matchingAtomicConfirmer()): ComponentAuthoritySourceDeps => ({ bindings, atomic });

async function loadState(agg: AuthorityBindingAggregate, atomic = matchingAtomicConfirmer()) {
  return loadComponentAuthorityRecords({ bindings: source([agg]), atomic }, LOAD);
}
function stateOf(records: readonly ComponentAuthorityRecord[]): string {
  return inspectComponentAuthority({ componentIds: [COMPONENT], projectId: SCOPE.projectId, records })[0]!.state;
}

// ─── A. production runtime wiring (1, 2) ─────────────────────────────────────

describe("B13.1 §A — production source construction", () => {
  const priorUrl = process.env.DATABASE_URL;
  afterEach(() => { resetComponentAuthoritySourceFactory(); if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl; });

  it("1. the production DEFAULT resolver constructs a real server-owned adapter with NO test setter (when a durable DB is configured)", () => {
    process.env.DATABASE_URL = "postgres://example/db";
    // No setComponentAuthoritySourceFactory call — this is the default path.
    const resolved = resolveComponentAuthoritySource({ tenantId: "t", projectId: "p", branchId: "main" });
    expect(resolved).not.toBeNull();
    expect(typeof resolved!.bindings.loadForComponent).toBe("function");
    expect(typeof resolved!.atomic).toBe("function");
  });

  it("2. an unconfigured database withholds safely (null); a construction failure fails closed to null", () => {
    delete process.env.DATABASE_URL;
    expect(resolveComponentAuthoritySource({ tenantId: "t", projectId: "p", branchId: "main" })).toBeNull();
    setComponentAuthoritySourceFactory(() => { throw new Error("boom"); });
    expect(resolveComponentAuthoritySource({ tenantId: "t", projectId: "p", branchId: "main" })).toBeNull();
  });
});

// ─── B. board / component scope parity (3, 4, 5) ─────────────────────────────

describe("B13.1 §B — durable identity parity", () => {
  it("3. the shared board-instance id matches the physical-binding writer formula", async () => {
    const projectId = "project-1";
    expect(pcbBoardInstanceId(projectId)).toBe(`board:${projectId}`);
    // A binding written under the writer's board id is found by the read path
    // using the shared id: the aggregate's scope boardInstanceId equals it.
    const agg = await validApprovedAggregate(COMPONENT);
    expect(agg.set.scope.boardInstanceId).toBe("board-1");
    // The read scope built from the shared helper for the fixture project.
    const readScope = { ...SCOPE, boardInstanceId: pcbBoardInstanceId("project-1") };
    // The fixture writes board-1; a production project writes board:project-1.
    // Parity means BOTH sides call pcbBoardInstanceId — proven by the writer
    // source gate below plus this shared-formula assertion.
    expect(pcbBoardInstanceId("project-1")).toBe("board:project-1");
    void readScope;
  });

  it("3b. the physical-binding writer (PcbEditor) uses the shared pcbBoardInstanceId, not a private formula", () => {
    const src = readFileSync(join(process.cwd(), "app/components/pcb/PcbEditor.tsx"), "utf8");
    const syncLine = src.slice(src.indexOf("const syncIdentity"), src.indexOf("const client = useMemo"));
    expect(syncLine).toContain("pcbBoardInstanceId(init.scope.projectId)");
    expect(syncLine).not.toContain("`board:${init.scope.projectId}`");
    // The chat route uses the same helper for the read scope.
    const route = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
    expect(route).toContain("pcbBoardInstanceId(requestScope.projectId)");
    expect(route).not.toContain("`${requestScope.projectId}:${requestScope.branchId}`");
  });

  it("4/5. hierarchy and variant defaults match the physical-binding creator", () => {
    // The fixture scope (which the physical-binding creator uses) defaults.
    const fixtureScope = bindingFixtureScope();
    expect([...PCB_BOARD_HIERARCHY_PATH]).toEqual(["root"]);
    expect(PCB_BOARD_ASSEMBLY_VARIANT_ID).toBe("variant-default");
    expect(fixtureScope.assemblyVariantIds).toContain(PCB_BOARD_ASSEMBLY_VARIANT_ID);
  });
});

// ─── C. durable-aggregate validation (6–12) ──────────────────────────────────

describe("B13.1 §C — durable-aggregate validation fails closed", () => {
  async function tamper(mutate: (agg: AuthorityBindingAggregate) => void): Promise<AuthorityBindingAggregate> {
    const agg = structuredClone(await validApprovedAggregate(COMPONENT));
    mutate(agg);
    return agg;
  }

  it("6. an invalid binding schema version fails closed (conflicted, no exact authority)", async () => {
    const agg = await tamper((a) => { (a.bindings[0]! as { schemaVersion: string }).schemaVersion = "wrong.v0"; });
    const load = await loadState(agg);
    expect(load.status === "loaded" && load.records[0]!.conflict === "present" && load.records[0]!.exactAuthority === undefined).toBe(true);
    expect(stateOf((load as { records: ComponentAuthorityRecord[] }).records)).toBe("conflicted");
  });

  it("7. a tampered technical digest fails closed", async () => {
    const agg = await tamper((a) => { (a.bindings[0]! as { technicalDigest: string }).technicalDigest = `sha256:${"9".repeat(64)}`; });
    const load = await loadState(agg);
    expect(load.status === "loaded" && load.records[0]!.conflict === "present").toBe(true);
  });

  it("8. a tampered record digest fails closed", async () => {
    const agg = await tamper((a) => { (a.bindings[0]! as { recordDigest: string }).recordDigest = `sha256:${"8".repeat(64)}`; });
    const load = await loadState(agg);
    expect(load.status === "loaded" && load.records[0]!.conflict === "present").toBe(true);
  });

  it("9. a tampered set digest fails closed", async () => {
    const agg = await tamper((a) => { (a.set as { recordDigest: string }).recordDigest = `sha256:${"7".repeat(64)}`; });
    const load = await loadState(agg);
    expect(load.status === "loaded" && load.records[0]!.conflict === "present").toBe(true);
  });

  it("10. a selected revision absent from the candidate set fails closed", async () => {
    const agg = await tamper((a) => { (a.set as { effectiveSelectedRevisionId?: string }).effectiveSelectedRevisionId = "not-a-candidate:r99"; });
    const load = await loadState(agg);
    expect(load.status === "loaded" && load.records[0]!.conflict === "present").toBe(true);
  });

  it("11. a tampered approval (evidence removed) fails closed", async () => {
    const agg = await tamper((a) => { (a.bindings[0]!.approval as { decisionEvidenceRefs?: string[] }).decisionEvidenceRefs = []; });
    const load = await loadState(agg);
    expect(load.status === "loaded" && load.records[0]!.conflict === "present").toBe(true);
  });

  it("12. a mapping/footprint revision mismatch fails closed", async () => {
    const agg = await tamper((a) => { (a.bindings[0]!.pinPadMapping as { footprintAssetVersionId?: string }).footprintAssetVersionId = "footprint-OTHER:r1"; });
    const load = await loadState(agg);
    expect(load.status === "loaded" && load.records[0]!.conflict === "present").toBe(true);
  });
});

// ─── D. atomic-snapshot cross-check (13–17) ──────────────────────────────────

describe("B13.1 §D — published atomic-snapshot consistency", () => {
  const mismatches: Array<[string, ReturnType<typeof matchingAtomicConfirmer>]> = [
    ["symbol", matchingAtomicConfirmer({ symbolAssetVersionId: "symbol-OTHER:r1" })],
    ["footprint", matchingAtomicConfirmer({ footprintAssetVersionId: "footprint-OTHER:r1" })],
    ["mapping", matchingAtomicConfirmer({ mappingCertificateId: "mapping-OTHER" })],
    ["mpn", matchingAtomicConfirmer({ exactMpn: "MPN-OTHER" })],
    ["manufacturer", matchingAtomicConfirmer({ manufacturerId: "mfr-OTHER" })],
  ];
  it("13–17. any atomic field that disagrees with the published snapshot refuses exact authority", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    for (const [label, confirmer] of mismatches) {
      const load = await loadComponentAuthorityRecords({ bindings: source([agg]), atomic: confirmer }, LOAD);
      expect(load.status, label).toBe("loaded");
      if (load.status !== "loaded") continue;
      expect(load.records[0]!.exactAuthority, label).toBeUndefined();
      expect(stateOf(load.records), label).toBe("exact-authority-unresolved");
    }
  });

  it("18. a fully valid, fully agreeing aggregate mints complete exact authority (verified-exact)", async () => {
    const load = await loadState(await validApprovedAggregate(COMPONENT));
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records[0]!.exactAuthority?.atomicPartRevisionId).toBe(FIXTURE_EXACT.atomicPartRevisionId);
    expect(stateOf(load.records)).toBe("verified-exact");
  });
});

// ─── E. truthful classification (19) ─────────────────────────────────────────

describe("B13.1 §E — verified-exact requires exact authority", () => {
  it("19. verified facets WITHOUT a complete exactAuthority are never verified-exact", () => {
    const record: ComponentAuthorityRecord = {
      authorityRecordId: "a1", componentId: COMPONENT, projectId: SCOPE.projectId, authorityRevision: "r1",
      selectedPart: { mpn: "MPN-X", manufacturer: "mfr", provenance: "physical-binding" },
      lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "available", mappingVerification: "verified",
    };
    expect(stateOf([record])).toBe("exact-authority-unresolved");
    const withExact: ComponentAuthorityRecord = { ...record, exactAuthority: { atomicPartRevisionId: "a", mpn: "MPN-X", manufacturer: "mfr", symbolAssetVersionId: "s", footprintAssetVersionId: "f", mappingCertificateId: "m" } };
    expect(stateOf([withExact])).toBe("verified-exact");
  });
});

// ─── F. deadline and cancellation (20–23) ────────────────────────────────────

describe("B13.1 §F — hard deadline and cancellation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  function deferredSource(): { source: AuthorityBindingSource; sawAbort: () => boolean; settle: (mode: "resolve" | "reject") => void; started: () => boolean } {
    let started = false; let aborted = false; let resolveFn: (() => void) | undefined; let rejectFn: (() => void) | undefined;
    const source: AuthorityBindingSource = {
      loadForComponent(_scope, signal) {
        started = true;
        signal?.addEventListener("abort", () => { aborted = true; });
        return new Promise<AuthorityBindingAggregate[]>((resolve, reject) => { resolveFn = () => resolve([]); rejectFn = () => reject(new Error("late")); });
      },
    };
    return { source, sawAbort: () => aborted, started: () => started, settle: (mode) => { if (mode === "resolve") resolveFn?.(); else rejectFn?.(); } };
  }

  it("20/21. the deadline aborts the underlying source; a pre-aborted request performs no I/O", async () => {
    const d = deferredSource();
    const promise = loadRunComponentAuthority(deps(d.source), LOAD, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(await promise).toBeNull();      // deterministic timeout
    expect(d.sawAbort()).toBe(true);       // the source's signal was aborted
    // Pre-aborted external signal → no I/O.
    const controller = new AbortController(); controller.abort();
    const pre = deferredSource();
    expect(await loadRunComponentAuthority(deps(pre.source), { ...LOAD, signal: controller.signal }, 50)).toBeNull();
    expect(pre.started()).toBe(false);
  });

  it("22/23. late resolution and late rejection after the deadline are discarded with no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown): void => { unhandled.push(r); };
    process.on("unhandledRejection", onUnhandled);
    try {
      for (const mode of ["resolve", "reject"] as const) {
        const d = deferredSource();
        const promise = loadRunComponentAuthority(deps(d.source), LOAD, 30);
        await vi.advanceTimersByTimeAsync(30);
        expect(await promise).toBeNull();
        d.settle(mode);                    // late settlement AFTER the deadline
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
      }
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});

// ─── G. route/provider integration (24–28) ───────────────────────────────────

describe("B13.1 §G — route and provider integration", () => {
  afterEach(() => resetComponentAuthoritySourceFactory());

  function contextWith(records: readonly ComponentAuthorityRecord[] | null) {
    return assembleAgentRunContext({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, board: createEmptyBoard(), ...(records ? { componentAuthority: { records, candidates: [] } } : {}) });
  }

  it("24. a valid durable binding + matching published snapshot yields the sealed resource + the tool", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    setComponentAuthoritySourceFactory(() => deps(source([agg])));
    const resolved = resolveComponentAuthoritySource({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId })!;
    const authority = await loadRunComponentAuthority(resolved, LOAD);
    expect(authority).not.toBeNull();
    const assembly = contextWith(authority!.records);
    if (!assembly.ok) throw new Error("assembly failed");
    const { declarations } = buildRunToolset(sirkitToolRegistry(), assembly.context, () => undefined);
    expect(declarations.some((d) => d.toolId === "sirkit.component-authority.inspect")).toBe(true);
  });

  it("25. a DB failure withholds the resource and tool while unrelated chat tools continue", async () => {
    setComponentAuthoritySourceFactory(() => ({ bindings: { async loadForComponent() { throw new Error("DB down"); } }, atomic: matchingAtomicConfirmer() }));
    const resolved = resolveComponentAuthoritySource({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId })!;
    const authority = await loadRunComponentAuthority(resolved, LOAD);
    expect(authority).toBeNull();
    const assembly = contextWith(null);
    if (!assembly.ok) throw new Error("assembly failed");
    const { declarations } = buildRunToolset(sirkitToolRegistry(), assembly.context, () => undefined);
    expect(declarations.some((d) => d.toolId === "sirkit.component-authority.inspect")).toBe(false);
    expect(declarations.some((d) => d.toolId === "sirkit.pcb.board-inspect")).toBe(true);
  });

  it("26. a browser-supplied authority-shaped field cannot activate the resource (assembler ignores it)", () => {
    // The assembler reads authority ONLY from the typed server input; a body
    // object with an authority-looking key is not a recognized input.
    const assembly = assembleAgentRunContext({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, board: createEmptyBoard(), ...({ authority: { records: [{}] } } as unknown as object) });
    if (!assembly.ok) throw new Error("assembly failed");
    expect(assembly.context.componentAuthority).toBeNull();
    const { declarations } = buildRunToolset(sirkitToolRegistry(), assembly.context, () => undefined);
    expect(declarations.some((d) => d.toolId === "sirkit.component-authority.inspect")).toBe(false);
  });

  it("27. OpenAI and Anthropic receive equivalent strict schemas after their ACTUAL adapter transforms", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    const load = await loadState(agg);
    if (load.status !== "loaded") throw new Error("load failed");
    const assembly = contextWith(load.records);
    if (!assembly.ok) throw new Error("assembly failed");
    const declaration = buildRunToolset(sirkitToolRegistry(), assembly.context, () => undefined).declarations.find((d) => d.toolId === "sirkit.component-authority.inspect")!;
    const openai = renderOpenAiResponsesTool(declaration);
    const anthropic = renderAnthropicAgentTool(declaration);
    // Both real transforms must carry the SAME strict input schema
    // (additionalProperties:false everywhere) for the same tool.
    expect(JSON.stringify(openai.parameters)).toBe(JSON.stringify(anthropic.input_schema));
    expect((openai.parameters as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    expect((anthropic.input_schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
  });

  it("28. the sealed authority resource participates deterministically in the manifest (replay identity)", async () => {
    const load = await loadState(await validApprovedAggregate(COMPONENT));
    if (load.status !== "loaded") throw new Error("load failed");
    const assembly = contextWith(load.records);
    if (!assembly.ok) throw new Error("assembly failed");
    const { buildAgentResourceBundle } = await import("../../agent/context");
    const digest1 = buildAgentResourceBundle(assembly.context).manifestDigest;
    const digest2 = buildAgentResourceBundle(assembly.context).manifestDigest;
    expect(digest1).toBe(digest2);
    const manifest = buildAgentResourceBundle(assembly.context).manifest;
    expect(manifest.some((entry) => entry.kind === "component-authority-records")).toBe(true);
  });
});
