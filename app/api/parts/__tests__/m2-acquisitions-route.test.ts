/**
 * [PR-L/M integration, 2026-10-18] F2: GET/POST /api/parts/acquisitions through its canonical wrappers and its handlers (section M2, design
 * M2.1) - the route's OWN authorization and refusal logic, which before this suite only the browser proof's happy path reached:
 *
 *  - the wrappers: an anonymous caller 401; a cross-origin POST from a member 403 (exact-origin CSRF); a viewer's POST 403 (the policy
 *    row's editor roles); a forbidden top-level body key (a URL, bytes, a board, a snapshot ...) 400 - each before any backend read;
 *  - the handlers: an unknown operation 400 and an undeclared key for the operation 400, both before the task runtime is composed; no
 *    durable store on this server 503 for GET and POST;
 *  - the component review INBOX is read in the catalog governance project ONLY: unconfigured governance 403 UNCONFIGURED; another
 *    project, another tenant with the governance project's id, or another branch 403 FORBIDDEN (the scope comes from the trusted context,
 *    never a query or body field); the governance project itself 200 (M.5 item 5: a foreign or private caller reads nothing);
 *  - a viewer cannot start or control a task (the service's role gate, 403).
 *
 * In-memory durable repository; no database, provider, embedding, CAD source or network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({ dbReads: 0, storeReads: 0 }));
vi.mock("@/app/lib/db/client", () => ({ getDb: () => { probes.dbReads += 1; throw new Error("no database in this suite"); } }));
vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  const repository = new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => { probes.storeReads += 1; return repository; } };
});

import { GET, POST } from "../acquisitions/route";
import { handleAcquisitionGet, handleAcquisitionPost, type AcquisitionRouteDeps } from "../acquisitions/handler";
import { injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import type { MembershipRole } from "@/app/lib/auth/project-membership";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { policyFor } from "@/app/lib/auth/route-policy";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { resetComponentResolutionRuntimeFactory, setComponentResolutionRuntimeFactory, type ComponentResolutionRuntime } from "@/app/lib/component-resolution/task/runtime";
import type { ProjectRole } from "@/app/lib/engineering/types";

const PATH = "/api/parts/acquisitions";
const GOVERNANCE = { tenantId: "local", projectId: "m2-route-governance" } as const;
const DESIGN = "m2-route-design";
const FOREIGN_TENANT = "another-tenant";
const USERS = { editor: "u-acq-editor", viewer: "u-acq-viewer", admin: "u-acq-admin" } as const;
type User = keyof typeof USERS;
const ROLE: Record<User, MembershipRole> = { editor: "editor", viewer: "viewer", admin: "admin" };

function signIn(user: User): void {
  injectIdentity({ userId: USERS[user] });
  injectMembership((Object.keys(USERS) as User[]).flatMap((name) => ["local", FOREIGN_TENANT].flatMap((tenantId) => [GOVERNANCE.projectId, DESIGN].map((projectId) => ({ tenantId, projectId, userId: USERS[name], role: ROLE[name] })))));
}
const selector = (projectId: string, tenantId = "local", branchId = "main") => ({ "x-sirkit-tenant-id": tenantId, "x-sirkit-project-id": projectId, "x-sirkit-branch-id": branchId });
function post(body: unknown, options: { projectId?: string; headers?: Record<string, string> } = {}): Request {
  return new Request(`http://localhost${PATH}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...selector(options.projectId ?? DESIGN), ...options.headers }, body: JSON.stringify(body) });
}
function get(query: string, projectId = DESIGN, tenantId = "local", branchId = "main"): Request {
  return new Request(`http://localhost${PATH}${query}`, { method: "GET", headers: { origin: "http://localhost", ...selector(projectId, tenantId, branchId) } });
}
const payload = async (res: Response): Promise<Record<string, unknown>> => (await res.clone().json()) as Record<string, unknown>;
const START = { operation: "start", request: { componentIds: ["kc-d1"] }, schematic: { components: [], wires: [] } };
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
const noBackendRead = () => expect({ db: probes.dbReads, store: probes.storeReads }).toEqual({ db: 0, store: 0 });
function runtimeWith(governance: ComponentResolutionRuntime["governance"]): ComponentResolutionRuntime {
  return { repository: new InMemoryDurableWorkflowRepository(), clock: () => Date.parse("2026-10-18T10:00:00.000Z"), durability: "process-memory", fixture: false, governance, environment: {} };
}
function context(role: ProjectRole, projectId = DESIGN, actorKind: "human" | "ai" = "human"): TrustedRequestContext {
  return { principalId: `u-${role}`, tenantId: "local", projectId, branchId: "main", actor: { actorId: actorKind === "ai" ? "agent:assistant" : `u-${role}`, actorKind, sessionId: "s", role }, sessionIdentity: "s", authMethod: "local_dev", authStrength: "aal1", membershipRevision: "mbr-1", correlationId: "c-1" } as TrustedRequestContext;
}
/** stub deps that count how often the runtime is composed */
function countingDeps(runtime: ComponentResolutionRuntime | null): AcquisitionRouteDeps & { composed: number } {
  const deps = { composed: 0, runtime: () => { deps.composed += 1; return runtime; }, catalog: () => null };
  return deps;
}

beforeEach(() => {
  probes.dbReads = 0; probes.storeReads = 0;
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
});
afterEach(() => {
  resetInjectedIdentity();
  resetComponentResolutionRuntimeFactory();
  vi.unstubAllEnvs();
});

describe("[PR-L/M integration F2] the route's registrations", () => {
  it("GET is a member read; POST is an authenticated propose row for the editor roles, with CSRF and no provider credit", () => {
    expect(policyFor(PATH, "GET")).toMatchObject({ requiresAuth: true, requiresCsrf: false, providerCredit: false });
    expect(policyFor(PATH, "POST")).toMatchObject({ requiresAuth: true, requiresCsrf: true, providerCredit: false });
    const roles: readonly string[] = policyFor(PATH, "POST")!.permittedRoles;
    expect(roles).toEqual(expect.arrayContaining(["pcb_editor", "reviewer", "project_admin"]));
    for (const role of ["viewer", "commenter"]) expect(roles).not.toContain(role); // a person who may not edit never posts here
  });
});

describe("[PR-L/M integration F2] the wrappers refuse before any backend read", () => {
  it("an anonymous caller gets 401 for GET and POST", async () => {
    stubProduction();
    expect((await GET(get(""))).status).toBe(401);
    expect((await POST(post(START))).status).toBe(401);
    noBackendRead();
  });

  it("a cross-origin POST from a member is refused (exact-origin CSRF)", async () => {
    stubProduction();
    signIn("editor");
    expect((await POST(post(START, { headers: { origin: "http://evil.example" } }))).status).toBe(403);
    noBackendRead();
  });

  it("a viewer's POST is 403 (the policy row's editor roles), whatever the operation", async () => {
    signIn("viewer");
    for (const body of [START, { operation: "control", taskId: "cr-task:0123456789abcdef0123456789abcdef", action: "cancel", clientActionId: "a1" }, { operation: "handoff", taskId: "cr-task:0123456789abcdef0123456789abcdef", clientActionId: "a2" }]) {
      expect((await POST(post(body))).status, String(body.operation)).toBe(403);
    }
    noBackendRead();
  });

  it.each(["url", "bytes", "board", "snapshot", "assets", "evidence", "approval", "content"])("a top-level `%s` is refused by the wrapper (400) before the handler runs", async (key) => {
    signIn("editor");
    const res = await POST(post({ ...START, [key]: key === "url" ? "https://evil.example/x.kicad_sym" : "x" }));
    expect([res.status, (await payload(res)).code]).toEqual([400, "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN"]);
    noBackendRead();
  });
});

describe("[PR-L/M integration F2] the handlers' own refusals", () => {
  it("an unknown operation and an undeclared key for the operation are 400 before the task runtime is composed", async () => {
    const deps = countingDeps(runtimeWith({ tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId }));
    const unknown = await handleAcquisitionPost({ context: context("pcb_editor"), body: { operation: "publish" } }, deps);
    expect([unknown.status, (await payload(unknown)).code]).toEqual([400, "COMPONENT_RESOLUTION_OPERATION_UNSUPPORTED"]);
    const extra = await handleAcquisitionPost({ context: context("pcb_editor"), body: { operation: "handoff", taskId: "cr-task:0123456789abcdef0123456789abcdef", clientActionId: "a1", extra: 1 } }, deps);
    expect([extra.status, (await payload(extra)).code]).toEqual([400, "COMPONENT_RESOLUTION_INVALID_REQUEST"]);
    expect(String((await payload(extra)).error)).toContain('unexpected key "extra" for handoff');
    const smuggled = await handleAcquisitionPost({ context: context("pcb_editor"), body: { operation: "control", taskId: "t", action: "cancel", clientActionId: "a", tenantId: "other" } }, deps);
    expect([smuggled.status, (await payload(smuggled)).code]).toEqual([400, "COMPONENT_RESOLUTION_INVALID_REQUEST"]);
    expect(deps.composed).toBe(0);
  });

  it("no durable store on this server: 503 for GET (list, one task, the inbox) and POST, nothing accepted", async () => {
    const deps = countingDeps(null);
    for (const query of [{}, { taskId: "cr-task:0123456789abcdef0123456789abcdef" }, { inbox: "1" }] as Array<Record<string, string>>) {
      const res = await handleAcquisitionGet({ context: context("viewer"), query }, deps);
      expect([res.status, (await payload(res)).code], JSON.stringify(query)).toEqual([503, "COMPONENT_RESOLUTION_STORE_UNAVAILABLE"]);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    const res = await handleAcquisitionPost({ context: context("pcb_editor"), body: START }, deps);
    expect([res.status, (await payload(res)).code]).toEqual([503, "COMPONENT_RESOLUTION_STORE_UNAVAILABLE"]);
  });

  it("a viewer cannot start or control a task (the service's role gate), even past the wrapper", async () => {
    const deps = countingDeps(runtimeWith({ tenantId: null, projectId: null }));
    const started = await handleAcquisitionPost({ context: context("viewer"), body: START }, deps);
    expect([started.status, (await payload(started)).code]).toEqual([403, "COMPONENT_RESOLUTION_FORBIDDEN"]);
    const controlled = await handleAcquisitionPost({ context: context("viewer"), body: { operation: "control", taskId: "cr-task:0123456789abcdef0123456789abcdef", action: "cancel", clientActionId: "a1" } }, deps);
    expect([controlled.status, (await payload(controlled)).code]).toEqual([403, "COMPONENT_RESOLUTION_FORBIDDEN"]);
  });
});

describe("[PR-L/M integration F2] the component review inbox is read in the governance project only (the trusted scope)", () => {
  it("unconfigured governance: 403 UNCONFIGURED", async () => {
    setComponentResolutionRuntimeFactory(() => runtimeWith({ tenantId: null, projectId: null }));
    signIn("admin");
    const res = await GET(get("?inbox=1", GOVERNANCE.projectId));
    expect([res.status, (await payload(res)).code]).toEqual([403, "ACQUISITION_HANDOFF_GOVERNANCE_UNCONFIGURED"]);
  });

  it("another project, another tenant with the governance project's id, or another branch: 403 FORBIDDEN; the governance project itself: 200", async () => {
    setComponentResolutionRuntimeFactory(() => runtimeWith({ tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId }));
    signIn("admin");
    for (const [projectId, tenantId, branchId] of [[DESIGN, "local", "main"], [GOVERNANCE.projectId, FOREIGN_TENANT, "main"], [GOVERNANCE.projectId, "local", "feature"]] as const) {
      const res = await GET(get("?inbox=1", projectId, tenantId, branchId));
      expect([res.status, (await payload(res)).code], `${tenantId}/${projectId}/${branchId}`).toEqual([403, "ACQUISITION_HANDOFF_GOVERNANCE_FORBIDDEN"]);
      expect((await payload(res)).handoffs).toBeUndefined();
    }
    const inbox = await GET(get("?inbox=1", GOVERNANCE.projectId));
    expect(inbox.status).toBe(200);
    expect(await payload(inbox)).toMatchObject({ ok: true, handoffs: [] });
    // the same governance check at the handler, with the scope taken from the trusted context only
    const deps = countingDeps(runtimeWith({ tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId }));
    const foreign = await handleAcquisitionGet({ context: context("project_admin", DESIGN), query: { inbox: "1", projectId: GOVERNANCE.projectId } }, deps);
    expect([foreign.status, (await payload(foreign)).code]).toEqual([403, "ACQUISITION_HANDOFF_GOVERNANCE_FORBIDDEN"]);
  });
});
