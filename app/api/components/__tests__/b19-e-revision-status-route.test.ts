/**
 * [B19-E E5 a] POST /api/components/revision-status — a member reads the catalog status of the atomic revisions a project pins.
 *
 * A bounded read through the canonical wrapper: 401 for an anonymous caller, exact-origin CSRF, 403 for a caller who is not a
 * member of the project the selector names — all BEFORE any catalog read; 413 over 16 KB; 400 for a malformed id, more than
 * 500 ids or an undeclared key. The route-policy, classification and action-coverage rows name it (parts.catalog-read).
 *
 * Reproduced on the unchanged code: the route did not exist.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({ statusReads: 0, dbReads: 0, fail: false }));
vi.mock("@/app/lib/db/client", () => ({ getDb: () => { probes.dbReads += 1; throw new Error("no database in this suite"); } }));
vi.mock("@/app/lib/atomic/server-catalog", () => ({
  loadAtomicRevisionStatus: async (ids: readonly string[]) => {
    probes.statusReads += 1;
    if (probes.fail) throw new Error("B19E_E5_STATUS_READ_FAILED postgres://user:secret@db");
    const out = new Map<string, unknown>();
    for (const id of ids) {
      if (id === "rev-published") out.set(id, { revisionId: id, logicalPartId: "lp", state: "published", selectable: true, pinnable: true });
      if (id === "rev-superseded") out.set(id, { revisionId: id, logicalPartId: "lp", state: "superseded", selectable: false, pinnable: true, successorRevisionId: "rev-published", since: "2026-09-13T00:00:00.000Z", reason: "replaced by rev 2" });
      if (id === "rev-revoked") out.set(id, { revisionId: id, logicalPartId: "lp", state: "revoked", selectable: false, pinnable: false, since: "2026-09-13T00:00:00.000Z" });
      // [B19-E E5 review] a chain: rev-chain-start (revoked) names rev-superseded, which names rev-published
      if (id === "rev-chain-start") out.set(id, { revisionId: id, logicalPartId: "lp", state: "revoked", selectable: false, pinnable: false, successorRevisionId: "rev-superseded", since: "2026-09-12T00:00:00.000Z" });
      // a cycle no API can build, bounded anyway
      if (id === "rev-cycle-a") out.set(id, { revisionId: id, logicalPartId: "lp", state: "superseded", selectable: false, pinnable: true, successorRevisionId: "rev-cycle-b" });
      if (id === "rev-cycle-b") out.set(id, { revisionId: id, logicalPartId: "lp", state: "superseded", selectable: false, pinnable: true, successorRevisionId: "rev-cycle-a" });
    }
    return out;
  },
}));

import { POST } from "../revision-status/route";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { allRoutePolicies, policyFor } from "@/app/lib/auth/route-policy";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import { classifyRouteMethodForm } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "@/app/lib/engineering/action-registry";
import { ATOMIC_REVISION_ID_PATTERN } from "@/app/lib/atomic/revision-status";

const PATH = "/api/components/revision-status";
const PROJECT = "p-e5-status";
const selector = (projectId = PROJECT) => ({ "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${PATH}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...selector(), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
const payload = async (res: Response): Promise<Record<string, unknown>> => (await res.clone().json()) as Record<string, unknown>;
const noRead = () => expect({ status: probes.statusReads, db: probes.dbReads }).toEqual({ status: 0, db: 0 });

beforeEach(() => { probes.statusReads = 0; probes.dbReads = 0; probes.fail = false; });
afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("[B19-E E5 a] the route's registrations", () => {
  it("is a member read (every member role, CSRF on POST, no provider credit, no write) with exactly one POST row", () => {
    expect(policyFor(PATH, "POST")).toMatchObject({ authClass: "authenticated-read", identitySource: "trusted-context", requiresAuth: true, requiresCsrf: true, providerCredit: false, authoritativeWrite: false, releaseOrQualification: false, permittedRoles: ["viewer", "commenter", "pcb_editor", "automation", "reviewer", "project_admin", "migration_admin"] });
    expect(allRoutePolicies().filter((row) => row.path === PATH).map((row) => row.method)).toEqual(["POST"]);
  });

  it("is classified as a durable catalog read that is never public and never project data", () => {
    expect(routeResourceClassification().find((row) => row.path === PATH && row.method === "POST")).toMatchObject({ isPublic: false, durableAccess: "read", projectDataSensitivity: "none", providerCredit: false, externalProcess: "", authoritativeWrite: false });
  });

  it("is a canonical wrapper recorded under parts.catalog-read", () => {
    const file = join(process.cwd(), "app", "api", "components", "revision-status", "route.ts");
    expect(classifyRouteMethodForm(readFileSync(file, "utf8"), "POST", file, process.cwd()).form).toBe("canonical-wrapper");
    expect(API_ROUTE_COVERAGE.find((entry) => entry.path === PATH)).toEqual({ path: PATH, methods: ["POST"], recordId: "parts.catalog-read", class: "read" });
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "parts.catalog-read")!.sources).toContain("app/api/components/revision-status/route.ts");
  });

  it("the id pattern is the replacement-authority route's REVISION_PATTERN", () => {
    const source = readFileSync(join(process.cwd(), "app", "api", "replacement-authority", "route.ts"), "utf8");
    const declared = /const REVISION_PATTERN = \/(.*)\/;/.exec(source)?.[1];
    expect(declared).toBeTruthy();
    expect(new RegExp(declared!).source).toBe(ATOMIC_REVISION_ID_PATTERN.source);
  });
});

describe("[B19-E E5 a] refused before any catalog read", () => {
  it("an anonymous caller gets 401", async () => {
    stubProduction();
    expect((await POST(post({ revisionIds: ["rev-published"] }))).status).toBe(401);
    noRead();
  });

  it("a cross-origin POST from a member is refused (CSRF)", async () => {
    stubProduction();
    injectAuthorizedPrincipal({ userId: "u-e5", projectId: PROJECT, role: "viewer" });
    expect((await POST(post({ revisionIds: ["rev-published"] }, { origin: "http://evil.example" }))).status).toBe(403);
    noRead();
  });

  it("a member of another project is 403 for this project's selector", async () => {
    injectAuthorizedPrincipal({ userId: "u-e5", projectId: "p-e5-elsewhere", role: "admin" });
    const res = await POST(post({ revisionIds: ["rev-published"] }));
    expect(res.status).toBe(403);
    noRead();
  });

  it("a body over 16 KB is 413", async () => {
    injectAuthorizedPrincipal({ userId: "u-e5", projectId: PROJECT, role: "viewer" });
    expect((await POST(post({ revisionIds: ["rev-published"], padding: "x".repeat(17_000) }))).status).toBe(413);
    noRead();
  });

  it.each([
    ["a malformed id", { revisionIds: ["rev published"] }],
    ["an id with a control character", { revisionIds: [`rev${String.fromCharCode(0)}x`] }],
    ["an over-long id", { revisionIds: [`r${"x".repeat(512)}`] }],
    ["a non-string id", { revisionIds: [42] }],
    ["a missing list", {}],
    ["a list that is not an array", { revisionIds: "rev-published" }],
    ["more than 500 ids", { revisionIds: Array.from({ length: 501 }, (_, index) => `rev-${index}`) }],
    ["an undeclared key", { revisionIds: ["rev-published"], projectId: "other" }],
  ])("%s is 400", async (_label, body) => {
    injectAuthorizedPrincipal({ userId: "u-e5", projectId: PROJECT, role: "viewer" });
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    noRead();
  });
});

describe("[B19-E E5 a] a member's status read", () => {
  it("answers each id's state, successor and selectability; an id that names no published revision is unpublished; no-store", async () => {
    injectAuthorizedPrincipal({ userId: "u-e5", projectId: PROJECT, role: "viewer" });
    const res = await POST(post({ revisionIds: ["rev-published", "rev-superseded", "rev-revoked", "rev-missing", "rev-published"] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect(body.statuses).toEqual([
      { revisionId: "rev-published", state: "published", selectable: true, pinnable: true, successorRevisionId: null, selectableSuccessorRevisionId: null, since: null },
      { revisionId: "rev-superseded", state: "superseded", selectable: false, pinnable: true, successorRevisionId: "rev-published", selectableSuccessorRevisionId: "rev-published", since: "2026-09-13T00:00:00.000Z" },
      { revisionId: "rev-revoked", state: "revoked", selectable: false, pinnable: false, successorRevisionId: null, selectableSuccessorRevisionId: null, since: "2026-09-13T00:00:00.000Z" },
      { revisionId: "rev-missing", state: "unpublished", selectable: false, pinnable: false, successorRevisionId: null, selectableSuccessorRevisionId: null, since: null },
    ]);
    expect(probes.statusReads).toBe(1);
  });

  it("a named successor that was itself withdrawn: the answer also names the first selectable revision of the chain (bounded, cycle-safe)", async () => {
    // [B19-E E5 review] a revoked revision's successor can later be superseded, and a revoked revision never gets a new event
    injectAuthorizedPrincipal({ userId: "u-e5", projectId: PROJECT, role: "viewer" });
    const res = await POST(post({ revisionIds: ["rev-chain-start", "rev-cycle-a"] }));
    expect(res.status).toBe(200);
    expect((await payload(res)).statuses).toEqual([
      { revisionId: "rev-chain-start", state: "revoked", selectable: false, pinnable: false, successorRevisionId: "rev-superseded", selectableSuccessorRevisionId: "rev-published", since: "2026-09-12T00:00:00.000Z" },
      { revisionId: "rev-cycle-a", state: "superseded", selectable: false, pinnable: true, successorRevisionId: "rev-cycle-b", selectableSuccessorRevisionId: null, since: null },
    ]);
    expect(probes.statusReads).toBeLessThanOrEqual(1 + 8);
  });

  it("exactly 500 ids are accepted; an empty list reads nothing", async () => {
    injectAuthorizedPrincipal({ userId: "u-e5", projectId: PROJECT, role: "viewer" });
    expect((await POST(post({ revisionIds: Array.from({ length: 500 }, (_, index) => `rev-${index}`) }))).status).toBe(200);
    expect(probes.statusReads).toBe(1);
    const empty = await POST(post({ revisionIds: [] }));
    expect([empty.status, (await payload(empty)).statuses]).toEqual([200, []]);
    expect(probes.statusReads).toBe(1);
  });

  it("a failed read answers one fixed sentence and never the driver's text", async () => {
    injectAuthorizedPrincipal({ userId: "u-e5", projectId: PROJECT, role: "viewer" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    probes.fail = true;
    const res = await POST(post({ revisionIds: ["rev-published"] }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("could not be read");
    expect(text).not.toMatch(/secret|postgres|B19E_E5/);
  });
});
