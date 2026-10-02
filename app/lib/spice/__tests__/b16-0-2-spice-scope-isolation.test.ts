/**
 * B16.0.2 §B (SPICE) — complete project/object ownership for runs.
 *
 * R1/R2 closure. Scope-A and scope-B runs are seeded through the REAL job
 * store (the worker is stubbed so no ngspice process runs); every route
 * surface (list / get / cancel / bundle / events / waveforms) is exercised
 * through the REAL handlers with injected identities:
 *  - anonymous → 401 before any lookup;
 *  - a project-B member → uniform 404 for project-A runs (never contents,
 *    never a listener, never a cancellation);
 *  - the owner → the run; query-string selectors work for the header-less
 *    surfaces (EventSource / anchor download);
 *  - listener counts and cancellation state prove isolation in the store.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workerState: { resolveAll: Array<() => void> } = { resolveAll: [] };
vi.mock("@/app/lib/spice/server/worker", () => ({
  NGSPICE_EXECUTABLE: "ngspice-stub", // [B22 closeout, 2026-10-02] no longer read: worker.ts exports no executable since B22-A3 (OD-135) - a dead mock key, kept so the cited range does not move
  executeRunPoint: async (input: { signal: AbortSignal; onEvent: (event: { status: string; progress: number; message: string }) => void }) => {
    input.onEvent({ status: "running", progress: 10, message: "stubbed" });
    await new Promise<void>((resolve) => {
      workerState.resolveAll.push(resolve);
      input.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    if (input.signal.aborted) throw new Error("aborted");
    return { status: "completed" as const, progress: 100, waveforms: [], scalars: [], diagnostics: [], stdout: "", stderr: "" };
  },
}));

import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { __resetJobStoreForTests, cancelRun, getBatch, getRun, getRuns, runListenerCount, startRunPlan, subscribeRun } from "../server/job-store";
import { createSimulationProject } from "../project";
import { dividerSchematic } from "./fixtures";
import { GET as runsGet, POST as runsPost } from "@/app/api/spice/runs/route";
import { GET as runGet, DELETE as runDelete } from "@/app/api/spice/runs/[id]/route";
import { GET as bundleGet } from "@/app/api/spice/runs/[id]/bundle/route";
import { GET as eventsGet } from "@/app/api/spice/runs/[id]/events/route";
import { GET as waveformsGet } from "@/app/api/spice/runs/[id]/waveforms/route";
import { policyFor } from "@/app/lib/auth/route-policy";

const A = { tenantId: "local", projectId: "project-A", branchId: "main" };
const B = { tenantId: "local", projectId: "project-B", branchId: "main" };
const headersFor = (scope: typeof A, extra: Record<string, string> = {}) => ({ "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId, ...extra });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function seedProject() {
  const project = createSimulationProject(dividerSchematic());
  const t = project.tests[0];
  t.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
  t.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
  return project;
}

let runA = "";
let runB = "";
let batchA = "";

beforeEach(() => {
  __resetJobStoreForTests();
  workerState.resolveAll = [];
  const aProject = seedProject();
  const a = startRunPlan({ scope: A, project: aProject, runPlanId: aProject.runPlans[0].id, maxRuns: 10 });
  runA = a.runIds[0]; batchA = a.id;
  const bProject = seedProject();
  const b = startRunPlan({ scope: B, project: bProject, runPlanId: bProject.runPlans[0].id, maxRuns: 10 });
  runB = b.runIds[0];
});
afterEach(() => { resetInjectedIdentity(); __resetJobStoreForTests(); });

describe("B16.0.2 §B — the job store binds every run/batch to the trusted scope", () => {
  it("startRunPlan REQUIRES a well-formed trusted scope and records it on run + batch", () => {
    const project = seedProject();
    expect(() => startRunPlan({ scope: undefined as unknown as typeof A, project, runPlanId: project.runPlans[0].id })).toThrow(/trusted project scope/);
    expect(() => startRunPlan({ scope: { tenantId: "", projectId: "p", branchId: "main" }, project, runPlanId: project.runPlans[0].id })).toThrow(/trusted project scope/);
    expect(getRun(runA, A)?.scope).toEqual(A);
    expect(getBatch(batchA, A)?.scope).toEqual(A);
  });

  it("foreign-scope accessors learn NOTHING: getRun null, getRuns empty, getBatch null, cancelRun false (state untouched), subscribeRun inert", () => {
    expect(getRun(runA, B)).toBeNull();
    expect(getRuns(B, [runA])).toEqual([]);
    expect(getRuns(B).map((r) => r.id)).toEqual([runB]);
    expect(getBatch(batchA, B)).toBeNull();
    expect(cancelRun(runA, B)).toBe(false);
    expect(getRun(runA, A)?.status).not.toBe("cancelled");
    let invoked = 0;
    const unsubscribe = subscribeRun(runA, B, () => { invoked += 1; });
    expect(invoked).toBe(0);
    expect(runListenerCount(runA)).toBe(0);
    unsubscribe(); // inert
    // owner subscription works and is counted
    let ownerInvoked = 0;
    const off = subscribeRun(runA, A, () => { ownerInvoked += 1; });
    expect(ownerInvoked).toBe(1);
    expect(runListenerCount(runA)).toBe(1);
    off();
    expect(runListenerCount(runA)).toBe(0);
  });

  it("a sibling scope (same project id, different tenant/branch) is a FOREIGN scope", () => {
    expect(getRun(runA, { ...A, branchId: "feature" })).toBeNull();
    expect(getRun(runA, { ...A, tenantId: "other-tenant" })).toBeNull();
    expect(cancelRun(runA, { ...A, branchId: "feature" })).toBe(false);
  });

  it("the job store exposes NO unscoped accessor (every read/list/cancel/subscribe export takes a scope)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), "app", "lib", "spice", "server", "job-store.ts"), "utf8");
    const exported = [...source.matchAll(/^export function (\w+)\(([^)]*)\)/gm)].map((m) => ({ name: m[1], params: m[2] }));
    const scoped = exported.filter((e) => ["getRun", "getRuns", "getBatch", "cancelRun", "subscribeRun"].includes(e.name));
    expect(scoped.length).toBe(5);
    for (const e of scoped) expect(e.params, e.name).toMatch(/scope: RunScope/);
    expect(exported.find((e) => e.name === "startRunPlan")).toBeDefined();
    expect(source).toContain("scope: RunScope;"); // the required input field
  });
});

describe("B16.0.2 §B — every route surface authorizes BEFORE lookup and enforces the exact scope", () => {
  it("policy: every SPICE run route method is authenticated (none public)", () => {
    for (const [path, method] of [["/api/spice/runs", "GET"], ["/api/spice/runs", "POST"], ["/api/spice/runs/x", "GET"], ["/api/spice/runs/x", "DELETE"], ["/api/spice/runs/x/bundle", "GET"], ["/api/spice/runs/x/events", "GET"], ["/api/spice/runs/x/waveforms", "GET"]] as const) {
      const policy = policyFor(path, method);
      expect(policy?.requiresAuth, `${method} ${path}`).toBe(true);
      expect(policy?.identitySource, `${method} ${path}`).toBe("trusted-context");
    }
  });

  it("R1: anonymous callers get 401 on bundle / events / waveforms / list / get / delete — never a lookup result", async () => {
    injectIdentity(null);
    for (const [label, response] of [
      ["bundle", await bundleGet(new Request(`http://localhost/api/spice/runs/${runA}/bundle`, { headers: headersFor(A) }), params(runA))],
      ["events", await eventsGet(new Request(`http://localhost/api/spice/runs/${runA}/events`, { headers: headersFor(A) }), params(runA))],
      ["waveforms", await waveformsGet(new Request(`http://localhost/api/spice/runs/${runA}/waveforms`, { headers: headersFor(A) }), params(runA))],
      ["list", await runsGet(new Request(`http://localhost/api/spice/runs?ids=${runA}`, { headers: headersFor(A) }))],
      ["get", await runGet(new Request(`http://localhost/api/spice/runs/${runA}`, { headers: headersFor(A) }), params(runA))],
      ["delete", await runDelete(new Request(`http://localhost/api/spice/runs/${runA}`, { method: "DELETE", headers: headersFor(A, { origin: "http://localhost" }) }), params(runA))],
    ] as const) {
      expect(response.status, label).toBe(401);
    }
    expect(runListenerCount(runA)).toBe(0);
    expect(getRun(runA, A)?.status).not.toBe("cancelled");
  });

  it("R2: a project-B member gets a UNIFORM 404 for project-A runs on every surface; nothing is disclosed, subscribed, or cancelled", async () => {
    injectAuthorizedPrincipal({ userId: "member-b", tenantId: "local", projectId: "project-B", role: "editor" });
    const missing = "run_does-not-exist";
    for (const id of [runA, missing]) {
      const get = await runGet(new Request(`http://localhost/api/spice/runs/${id}`, { headers: headersFor(B) }), params(id));
      expect(get.status).toBe(404);
      expect(await get.json()).toEqual({ ok: false, code: "SPICE_RUN_NOT_FOUND", error: "Run not found" });
      const bundle = await bundleGet(new Request(`http://localhost/api/spice/runs/${id}/bundle`, { headers: headersFor(B) }), params(id));
      expect(bundle.status).toBe(404);
      expect(await bundle.json()).toEqual({ ok: false, code: "SPICE_RUN_NOT_FOUND", error: "Run not found" });
      const waveforms = await waveformsGet(new Request(`http://localhost/api/spice/runs/${id}/waveforms`, { headers: headersFor(B) }), params(id));
      expect(waveforms.status).toBe(404);
      const events = await eventsGet(new Request(`http://localhost/api/spice/runs/${id}/events`, { headers: headersFor(B) }), params(id));
      expect(events.status).toBe(404);
      expect(events.headers.get("content-type")).not.toContain("event-stream");
      const del = await runDelete(new Request(`http://localhost/api/spice/runs/${id}`, { method: "DELETE", headers: headersFor(B, { origin: "http://localhost" }) }), params(id));
      expect(del.status).toBe(404);
    }
    // list as B never includes A's run, even when asked for it by id
    const list = await runsGet(new Request(`http://localhost/api/spice/runs?ids=${runA},${runB}&batchId=${batchA}`, { headers: headersFor(B) }));
    const body = (await list.json()) as { runs: Array<{ id: string }>; batch: unknown };
    expect(body.runs.map((r) => r.id)).toEqual([runB]);
    expect(body.batch).toBeNull();
    // isolation proven in the store: no listener, not cancelled
    expect(runListenerCount(runA)).toBe(0);
    expect(getRun(runA, A)?.status).not.toBe("cancelled");
  });

  it("the owner reaches its run on every surface; events authorizes BEFORE the stream and adds exactly one listener; cancel works", async () => {
    injectAuthorizedPrincipal({ userId: "member-a", tenantId: "local", projectId: "project-A", role: "editor" });
    const get = await runGet(new Request(`http://localhost/api/spice/runs/${runA}`, { headers: headersFor(A) }), params(runA));
    expect(get.status).toBe(200);
    expect(((await get.json()) as { run: { id: string; scope: typeof A } }).run.scope).toEqual(A);
    const waveforms = await waveformsGet(new Request(`http://localhost/api/spice/runs/${runA}/waveforms`, { headers: headersFor(A) }), params(runA));
    expect(waveforms.status).toBe(200);
    // bundle: the run has no reproducibility artifacts yet → 409 (owner-only detail)
    const bundle = await bundleGet(new Request(`http://localhost/api/spice/runs/${runA}/bundle`, { headers: headersFor(A) }), params(runA));
    expect(bundle.status).toBe(409);
    // events via QUERY selector (EventSource cannot set headers)
    expect(runListenerCount(runA)).toBe(0);
    const events = await eventsGet(new Request(`http://localhost/api/spice/runs/${runA}/events?tenantId=local&projectId=project-A&branchId=main`), params(runA));
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const reader = events.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: run");
    expect(runListenerCount(runA)).toBe(1);
    await reader.cancel();
    expect(runListenerCount(runA)).toBe(0);
    // cancel as owner
    const del = await runDelete(new Request(`http://localhost/api/spice/runs/${runA}`, { method: "DELETE", headers: headersFor(A, { origin: "http://localhost" }) }), params(runA));
    expect(del.status).toBe(200);
    expect(getRun(runA, A)?.status).toBe("cancelled");
    // a second cancel is 409 (already finished) — still owner-only
    const again = await runDelete(new Request(`http://localhost/api/spice/runs/${runA}`, { method: "DELETE", headers: headersFor(A, { origin: "http://localhost" }) }), params(runA));
    expect(again.status).toBe(409);
  });

  it("a query-string selector naming a FOREIGN project is refused by membership (403) — selectors are never authority", async () => {
    injectAuthorizedPrincipal({ userId: "member-b", tenantId: "local", projectId: "project-B", role: "editor" });
    const events = await eventsGet(new Request(`http://localhost/api/spice/runs/${runA}/events?tenantId=local&projectId=project-A&branchId=main`), params(runA));
    expect(events.status).toBe(403);
    expect(runListenerCount(runA)).toBe(0);
    const bundle = await bundleGet(new Request(`http://localhost/api/spice/runs/${runA}/bundle?projectId=project-A`), params(runA));
    expect(bundle.status).toBe(403);
  });

  it("POST /api/spice/runs binds the new batch to the TRUSTED scope, not the body's project id; a viewer may list but not start", async () => {
    injectAuthorizedPrincipal({ userId: "member-a", tenantId: "local", projectId: "project-A", role: "editor" });
    const project = seedProject();
    project.id = "simproj-client-asserted";
    const started = await runsPost(new Request("http://localhost/api/spice/runs", { method: "POST", headers: headersFor(A, { origin: "http://localhost", "content-type": "application/json" }), body: JSON.stringify({ project, runPlanId: project.runPlans[0].id, parts: [] }) }));
    expect(started.status).toBe(202);
    const { batch } = (await started.json()) as { batch: { id: string; runIds: string[]; scope: typeof A; projectId: string } };
    expect(batch.scope).toEqual(A);
    expect(batch.projectId).toBe("simproj-client-asserted"); // display-only assertion
    expect(getRun(batch.runIds[0], A)?.scope).toEqual(A);
    expect(getRun(batch.runIds[0], B)).toBeNull();
    // viewer: GET ok, POST refused by role
    injectAuthorizedPrincipal({ userId: "viewer-a", tenantId: "local", projectId: "project-A", role: "viewer" });
    const list = await runsGet(new Request("http://localhost/api/spice/runs", { headers: headersFor(A) }));
    expect(list.status).toBe(200);
    const refused = await runsPost(new Request("http://localhost/api/spice/runs", { method: "POST", headers: headersFor(A, { origin: "http://localhost", "content-type": "application/json" }), body: JSON.stringify({ project, runPlanId: project.runPlans[0].id }) }));
    expect(refused.status).toBe(403);
    const refusedCancel = await runDelete(new Request(`http://localhost/api/spice/runs/${runA}`, { method: "DELETE", headers: headersFor(A, { origin: "http://localhost" }) }), params(runA));
    expect(refusedCancel.status).toBe(403);
  });
});
