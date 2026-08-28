import { afterEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { createSchematicProjectState } from "@/app/lib/schematic-compiler/project";
import { readyGraph, validProblem, validSignoff } from "@/app/lib/schematic-compiler/__tests__/fixtures";
import { POST as compare } from "../compare/route";
import { POST as diff } from "../diff/route";
import { POST as exportState } from "../export/route";
import { POST as validateGraph } from "../graph/validate/route";
import { POST as inspect } from "../kicad/inspect/route";
import { POST as layout } from "../layout/route";
import { POST as transaction } from "../transaction/route";
import { POST as variants } from "../variants/route";

// B16.0.1: identity/role are SERVER-DERIVED (trusted context) — x-sirkit-actor-id /
// x-sirkit-role / x-sirkit-actor-kind are never read by production routes; only the
// tenant/project/branch SELECTOR headers remain (never authority). Legitimate
// requests carry a same-origin Origin header.
const headers = { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test" };
const request = (path: string, body: unknown, scoped = true, override: Record<string, string> = {}) => new Request(`http://localhost/api/schematic-compiler/${path}`, { method: "POST", headers: scoped ? { ...headers, ...override } : { "content-type": "application/json" }, body: JSON.stringify(body) });

afterEach(() => { resetInjectedIdentity(); });

describe("CD-8 typed API boundaries", () => {
  it("requires tenant project branch and actor scope", async () => {
    // B16.0.1: the old "missing scope headers => 401" relied on caller-asserted
    // identity headers, which no longer exist. The equivalent-or-stronger
    // server-derived assertions: an unauthenticated caller is refused 401
    // before anything else, and the selector headers remain REQUIRED as a
    // project selector (400 without one) — a selector, never authority.
    injectIdentity(null);
    const unauthenticated = await validateGraph(request("graph/validate", { graph: readyGraph() }));
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ ok: false, code: "AUTH_UNAUTHENTICATED" });
    resetInjectedIdentity();
    const unselected = await validateGraph(request("graph/validate", { graph: readyGraph() }, false));
    expect(unselected.status).toBe(400);
    expect(await unselected.json()).toMatchObject({ ok: false, code: "AUTH_PROJECT_SELECTOR_REQUIRED" });
  });
  it("validates a pinned coordinate-independent graph", async () => { const response = await validateGraph(request("graph/validate", { graph: readyGraph() })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, counts: { components: 1, pins: 2, nets: 2 } }); });
  it("returns explicit variant projections", async () => { const response = await variants(request("variants", { graph: readyGraph(), variantId: "variant:default" })); const body = await response.json() as { projections: Array<{ populatedComponentInstanceIds: string[] }> }; expect(response.status).toBe(200); expect(body.projections[0].populatedComponentInstanceIds).toHaveLength(1); });
  it("marks layout output as view-only", async () => { const graph = readyGraph(), response = await layout(request("layout", { graph, sheetInstanceId: graph.sheetInstances[0].sheetInstanceId })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, authority: "view_only", semanticGraphDigest: graph.deterministicDigest }); });
  it("quarantines KiCad syntax because no version is certified", async () => { const response = await inspect(request("kicad/inspect", { source: "(kicad_sch (version 20250114))" })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, authority: "quarantine_inspection_only", inspection: { semanticAdapterState: "unsupported_version" }, semanticImport: null }); });
  it("cannot issue a production round-trip certificate without a certified adapter", async () => { const graph = readyGraph(), response = await compare(request("compare", { source: graph, reparsed: graph, artifactManifestId: "manifest:test" })); expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ ok: false, certificate: { certificateState: "unsupported_construct" } }); });
  it("separates semantic diff from diagram state", async () => { const graph = readyGraph(), response = await diff(request("diff", { base: graph, candidate: graph })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, diff: { connectivityChanges: [], diagramOnlyChanges: [] } }); });
  it("denies direct AI graph transactions", async () => {
    // B16.0.1: an AI/automation actor can no longer be ASSERTED over HTTP at
    // all — identity headers are never read, the trusted context mints human
    // actors only, and the transaction policy permits only pcb_editor /
    // reviewer / project_admin membership. The stronger boundary assertion: a
    // viewer-membership principal FORGING privileged identity headers is
    // refused 403 AUTH_ROLE_DENIED server-side, BEFORE the transaction layer
    // (were the headers still trusted, the forged project_admin role would
    // have been accepted). The lib-level AI-actor denial
    // (CD8_TRANSACTION_UNAUTHORIZED) stays covered by
    // app/lib/schematic-compiler/__tests__/lifecycle.test.ts.
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant:test", projectId: "project:test", role: "viewer" });
    const state = createSchematicProjectState({ projectId: "project:test", branchId: "branch:test", upstreamSignoff: validSignoff(), problem: validProblem() });
    const response = await transaction(request("transaction", { state, operations: [{ operationId: "op", kind: "add_graph", graph: readyGraph() }], reason: "direct mutation", idempotencyKey: "ai:test", baseStateDigest: state.deterministicDigest }, true, { "x-sirkit-actor-kind": "ai", "x-sirkit-actor-id": "actor:forged", "x-sirkit-role": "project_admin" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, code: "AUTH_ROLE_DENIED" });
  });
  it("requires an approved lossless candidate before export", async () => { const state = createSchematicProjectState({ projectId: "project:test", branchId: "branch:test", upstreamSignoff: validSignoff(), problem: validProblem() }), response = await exportState(request("export", { state })); expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ ok: false, status: "NOT_RELEASED" }); });
});
