import { describe, expect, it } from "vitest";
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

const headers = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test", "x-sirkit-actor-id": "actor:test", "x-sirkit-role": "reviewer" };
const request = (path: string, body: unknown, scoped = true, override: Record<string, string> = {}) => new Request(`http://localhost/api/schematic-compiler/${path}`, { method: "POST", headers: scoped ? { ...headers, ...override } : { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("CD-8 typed API boundaries", () => {
  it("requires tenant project branch and actor scope", async () => { expect((await validateGraph(request("graph/validate", { graph: readyGraph() }, false))).status).toBe(401); });
  it("validates a pinned coordinate-independent graph", async () => { const response = await validateGraph(request("graph/validate", { graph: readyGraph() })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, counts: { components: 1, pins: 2, nets: 2 } }); });
  it("returns explicit variant projections", async () => { const response = await variants(request("variants", { graph: readyGraph(), variantId: "variant:default" })); const body = await response.json() as { projections: Array<{ populatedComponentInstanceIds: string[] }> }; expect(response.status).toBe(200); expect(body.projections[0].populatedComponentInstanceIds).toHaveLength(1); });
  it("marks layout output as view-only", async () => { const graph = readyGraph(), response = await layout(request("layout", { graph, sheetInstanceId: graph.sheetInstances[0].sheetInstanceId })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, authority: "view_only", semanticGraphDigest: graph.deterministicDigest }); });
  it("quarantines KiCad syntax because no version is certified", async () => { const response = await inspect(request("kicad/inspect", { source: "(kicad_sch (version 20250114))" })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, authority: "quarantine_inspection_only", inspection: { semanticAdapterState: "unsupported_version" }, semanticImport: null }); });
  it("cannot issue a production round-trip certificate without a certified adapter", async () => { const graph = readyGraph(), response = await compare(request("compare", { source: graph, reparsed: graph, artifactManifestId: "manifest:test" })); expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ ok: false, certificate: { certificateState: "unsupported_construct" } }); });
  it("separates semantic diff from diagram state", async () => { const graph = readyGraph(), response = await diff(request("diff", { base: graph, candidate: graph })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, diff: { connectivityChanges: [], diagramOnlyChanges: [] } }); });
  it("denies direct AI graph transactions", async () => { const state = createSchematicProjectState({ projectId: "project:test", branchId: "branch:test", upstreamSignoff: validSignoff(), problem: validProblem() }), response = await transaction(request("transaction", { state, operations: [{ operationId: "op", kind: "add_graph", graph: readyGraph() }], reason: "direct mutation", idempotencyKey: "ai:test", baseStateDigest: state.deterministicDigest }, true, { "x-sirkit-actor-kind": "ai", "x-sirkit-role": "automation" })); expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ ok: false, record: { state: "rejected", diagnostics: ["CD8_TRANSACTION_UNAUTHORIZED"] } }); });
  it("requires an approved lossless candidate before export", async () => { const state = createSchematicProjectState({ projectId: "project:test", branchId: "branch:test", upstreamSignoff: validSignoff(), problem: validProblem() }), response = await exportState(request("export", { state })); expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ ok: false, status: "NOT_RELEASED" }); });
});
