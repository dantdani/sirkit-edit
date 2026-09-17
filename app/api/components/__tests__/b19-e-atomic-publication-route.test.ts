/**
 * [B19-E E4] g, h — GET/POST /api/components/atomic/publication through the canonical wrappers.
 *
 *  h. anonymous 401; cross-origin (CSRF) refused; 403 outside the catalog governance project, when no governance project is
 *     configured, and for an AI actor; 413 oversize; 400 for an unknown operation; and NO database or durable-store read
 *     happens before all of that has passed;
 *  g. the body can never carry authority: a snapshot, asset bytes, facts, values, evidence, a source class or a reviewer
 *     stamp is refused, at the top level (the wrapper's forbidden keys) and inside nested objects (closed shapes).
 *
 * Reproduced on the unchanged code: the route did not exist.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({ dbReads: 0, storeReads: 0, observationReads: 0, identityReads: 0 }));
vi.mock("@/app/lib/db/client", () => ({ getDb: () => { probes.dbReads += 1; throw new Error("no database in this suite"); } }));
vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  const repository = new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => { probes.storeReads += 1; return repository; } };
});
vi.mock("@/app/lib/acquisition/offer-cache-observations", () => ({ loadCachedExternalObservations: async () => { probes.observationReads += 1; return []; } }));
vi.mock("@/app/lib/atomic/server-catalog", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadAtomicAuthoringIdentity: async () => { probes.identityReads += 1; return { manufacturerId: null, exactPartId: null, logicalPartId: null, latestRevision: 0 }; },
  loadAtomicRevisionStatus: async () => new Map(),
}));
vi.mock("@/app/lib/atomic/server-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/atomic/server-repository")>();
  return { ...actual, publishPortableAtomicSnapshot: vi.fn(async (input: Parameters<typeof actual.publishPortableAtomicSnapshot>[0]) => { actual.validatePortableSnapshotForPublication(input.snapshot, input.requiredProfile, { actorId: input.actorId, actorRole: input.actorRole }); return { revisionId: input.snapshot.atomicRevision.id, auditId: "audit_route" }; }) };
});
vi.mock("@/app/lib/atomic/authoring", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { fixtureKicadLibrary } = await import("@/app/lib/atomic/__tests__/_kicad-fixture-library");
  return { ...actual, bundledKicadLibrary: () => fixtureKicadLibrary() };
});

import { GET, POST } from "../atomic/publication/route";
import { handleAtomicPublicationPost } from "../atomic/publication/handler";
import { injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import type { MembershipRole } from "@/app/lib/auth/project-membership";
import { allRoutePolicies, policyFor } from "@/app/lib/auth/route-policy";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import { classifyRouteMethodForm } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "@/app/lib/engineering/action-registry";
import { ne555Spec } from "@/app/lib/atomic/__tests__/_publication-fixtures";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import type { AtomicPublicationRequest } from "@/app/lib/atomic/publication-review-contract";

const PATH = "/api/components/atomic/publication";
const GOVERNANCE = "sirkit-catalog-governance";
const DESIGN = "a-design-project";
const USERS = { editor: "u-route-editor", reviewer: "u-route-reviewer", admin: "u-route-admin", viewer: "u-route-viewer", bot: "agent:catalog-bot" } as const;
type User = keyof typeof USERS;
const ROLE: Record<User, MembershipRole> = { editor: "editor", reviewer: "reviewer", admin: "admin", viewer: "viewer", bot: "admin" };

/** [B19-E E4 review] another tenant that also has a project whose id is the governance project's */
const FOREIGN_TENANT = "another-tenant";
function signIn(user: User): void {
  injectIdentity({ userId: USERS[user] });
  injectMembership((Object.keys(USERS) as User[]).flatMap((name) => ["local", FOREIGN_TENANT].flatMap((tenantId) => [GOVERNANCE, DESIGN].map((projectId) => ({ tenantId, projectId, userId: USERS[name], role: ROLE[name] })))));
}
const selector = (projectId: string, tenantId = "local") => ({ "x-sirkit-tenant-id": tenantId, "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
function post(body: unknown, options: { projectId?: string; tenantId?: string; headers?: Record<string, string> } = {}): Request {
  return new Request(`http://localhost${PATH}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...selector(options.projectId ?? GOVERNANCE, options.tenantId), ...options.headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function get(projectId = GOVERNANCE, tenantId = "local"): Request {
  return new Request(`http://localhost${PATH}`, { method: "GET", headers: { origin: "http://localhost", ...selector(projectId, tenantId) } });
}
const payload = async (res: Response): Promise<Record<string, unknown>> => (await res.clone().json()) as Record<string, unknown>;
const SUBMIT = { operation: "submit_request", ...ne555Spec(), links: [], reason: "publish the exact timer" };
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
const noBackendRead = () => expect({ db: probes.dbReads, store: probes.storeReads, observations: probes.observationReads, identity: probes.identityReads }).toEqual({ db: 0, store: 0, observations: 0, identity: 0 });

beforeEach(() => {
  probes.dbReads = 0; probes.storeReads = 0; probes.observationReads = 0; probes.identityReads = 0;
  vi.stubEnv("SIRKIT_ATOMIC_CATALOG_PROJECT_ID", GOVERNANCE);
  vi.stubEnv("SIRKIT_ATOMIC_CATALOG_TENANT_ID", "local"); // [B19-E E4 review] gates-1: the governance scope names its tenant
});
afterEach(() => {
  resetInjectedIdentity();
  vi.unstubAllEnvs();
});

describe("[B19-E E4] the route's registrations", () => {
  it("GET is a member read; POST is an authenticated mutation for editors, reviewers and administrators, with CSRF", () => {
    expect(policyFor(PATH, "GET")).toMatchObject({ authClass: "authenticated-read", identitySource: "trusted-context", requiresAuth: true, requiresCsrf: false, authoritativeWrite: false, providerCredit: false });
    expect(policyFor(PATH, "POST")).toMatchObject({ authClass: "authenticated-mutation", identitySource: "trusted-context", requiresAuth: true, requiresCsrf: true, authoritativeWrite: true, providerCredit: false, permittedRoles: ["pcb_editor", "reviewer", "project_admin"] });
    // the same shape as the physical-bindings review handoff rows
    const shape = (row: ReturnType<typeof policyFor>) => ({ ...row, path: undefined, evidence: undefined });
    expect(shape(policyFor(PATH, "POST"))).toEqual(shape(policyFor("/api/physical-bindings", "POST")));
    expect(shape(policyFor(PATH, "GET"))).toEqual(shape(policyFor("/api/physical-bindings", "GET")));
    expect(allRoutePolicies().filter((row) => row.path === PATH).map((row) => row.method).sort()).toEqual(["GET", "POST"]);
  });

  it("is classified as durable project data, never public", () => {
    for (const method of ["GET", "POST"]) {
      expect(routeResourceClassification().find((row) => row.path === PATH && row.method === method)).toMatchObject({ isPublic: false, durableAccess: "read-write", projectDataSensitivity: "project-durable", providerCredit: false });
    }
  });

  it("both methods are canonical wrappers, covered by parts.atomic-publication-review (a mutation, never a tool, destructive tier)", () => {
    const file = join(process.cwd(), "app", "api", "components", "atomic", "publication", "route.ts");
    const source = readFileSync(file, "utf8");
    for (const method of ["GET", "POST"]) expect(classifyRouteMethodForm(source, method, file, process.cwd()).form).toBe("canonical-wrapper");
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "parts.atomic-publication-review")).toMatchObject({ kind: "mutate", toolExposure: "none", approvalTier: "destructive", status: "implemented" });
    expect(API_ROUTE_COVERAGE.find((entry) => entry.path === PATH)).toEqual({ path: PATH, methods: ["GET", "POST"], recordId: "parts.atomic-publication-review", class: "mutate" });
  });
});

describe("[B19-E E4 h] refused before any backend read", () => {
  it("an anonymous caller gets 401", async () => {
    stubProduction();
    expect((await POST(post(SUBMIT))).status).toBe(401);
    expect((await GET(get())).status).toBe(401);
    noBackendRead();
  });

  it("a cross-origin POST from a member is refused (CSRF)", async () => {
    stubProduction();
    signIn("editor");
    expect((await POST(post(SUBMIT, { headers: { origin: "http://evil.example" } }))).status).toBe(403);
    noBackendRead();
  });

  it("outside the governance project: 403", async () => {
    signIn("admin");
    const res = await POST(post(SUBMIT, { projectId: DESIGN }));
    expect(res.status).toBe(403);
    expect((await payload(res)).code).toBe("ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN");
    const listed = await GET(get(DESIGN));
    expect(listed.status).toBe(403);
    noBackendRead();
  });

  it("when no governance project is configured: 403 for every operation", async () => {
    vi.stubEnv("SIRKIT_ATOMIC_CATALOG_PROJECT_ID", "");
    signIn("admin");
    for (const body of [SUBMIT, { operation: "resolve_request", requestId: "r", decision: "reject", reason: "x" }, { operation: "publish_request", requestId: "r", reason: "x" }, { operation: "withdraw_request", requestId: "r", reason: "x" }]) {
      const res = await POST(post(body));
      expect(res.status, String(body.operation)).toBe(403);
      expect((await payload(res)).code).toBe("ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED");
    }
    expect((await GET(get())).status).toBe(403);
    noBackendRead();
  });

  it("[B19-E E4 review] gates-1: another tenant's project with the governance project's id is 403, for every operation and the list", async () => {
    signIn("admin");
    for (const body of [SUBMIT, { operation: "resolve_request", requestId: "r", decision: "reject", reason: "x" }, { operation: "publish_request", requestId: "r", reason: "x" }, { operation: "withdraw_request", requestId: "r", reason: "x" }]) {
      const res = await POST(post(body, { tenantId: FOREIGN_TENANT }));
      expect([res.status, (await payload(res)).code], String(body.operation)).toEqual([403, "ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN"]);
    }
    const listed = await GET(get(GOVERNANCE, FOREIGN_TENANT));
    expect([listed.status, (await payload(listed)).code]).toEqual([403, "ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN"]);
    noBackendRead();
  });

  it("[B19-E E4 review] gates-1: when the governance tenant is not configured, every operation is 403 UNCONFIGURED", async () => {
    vi.stubEnv("SIRKIT_ATOMIC_CATALOG_TENANT_ID", "");
    signIn("admin");
    for (const body of [SUBMIT, { operation: "publish_request", requestId: "r", reason: "x" }]) {
      const res = await POST(post(body));
      expect([res.status, (await payload(res)).code], String(body.operation)).toEqual([403, "ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED"]);
    }
    expect([(await GET(get())).status]).toEqual([403]);
    noBackendRead();
  });

  it("an AI actor (an agent: principal, or an ai actor kind) is refused for every operation", async () => {
    signIn("bot");
    for (const body of [SUBMIT, { operation: "resolve_request", requestId: "r", decision: "approve", reason: "x" }, { operation: "publish_request", requestId: "r", reason: "x" }, { operation: "withdraw_request", requestId: "r", reason: "x" }]) {
      const res = await POST(post(body));
      expect(res.status, String(body.operation)).toBe(403);
      expect((await payload(res)).code).toBe("ATOMIC_PUBLICATION_HUMAN_REQUIRED");
    }
    const context = { principalId: "u", tenantId: "local", projectId: GOVERNANCE, branchId: "main", actor: { actorId: "u-model", actorKind: "ai", sessionId: "s", role: "project_admin" }, sessionIdentity: "s", authMethod: "supabase_cookie", authStrength: "aal1", membershipRevision: "m", correlationId: "c" } as unknown as TrustedRequestContext;
    const direct = await handleAtomicPublicationPost({ context, body: SUBMIT }, { env: { SIRKIT_ATOMIC_CATALOG_PROJECT_ID: GOVERNANCE, SIRKIT_ATOMIC_CATALOG_TENANT_ID: "local" }, review: () => { throw new Error("the review was composed before the actor was checked"); } });
    expect([direct.status, (await payload(direct)).code]).toEqual([403, "ATOMIC_PUBLICATION_HUMAN_REQUIRED"]);
    noBackendRead();
  });

  it("a role outside the operation's roles is 403 before any read: an editor resolving, a reviewer publishing, a viewer posting", async () => {
    signIn("editor");
    expect((await payload(await POST(post({ operation: "resolve_request", requestId: "r", decision: "approve", reason: "x" })))).code).toBe("ATOMIC_PUBLICATION_FORBIDDEN");
    signIn("reviewer");
    expect((await payload(await POST(post({ operation: "publish_request", requestId: "r", reason: "x" })))).code).toBe("ATOMIC_PUBLICATION_FORBIDDEN");
    signIn("viewer");
    expect((await POST(post(SUBMIT))).status).toBe(403);
    noBackendRead();
  });

  it("an oversized body is 413 and an unknown operation is 400", async () => {
    signIn("editor");
    expect((await POST(post({ ...SUBMIT, reason: "x".repeat(70_000) }))).status).toBe(413);
    const unknown = await POST(post({ operation: "publish_everything" }));
    expect([unknown.status, (await payload(unknown)).code]).toEqual([400, "ATOMIC_PUBLICATION_OPERATION_UNSUPPORTED"]);
    const missing = await POST(post({ reason: "no operation" }));
    expect(missing.status).toBe(400);
    noBackendRead();
  });
});

describe("[B19-E E4 g] the body never carries authority", () => {
  it.each(["snapshot", "assets", "facts", "sourceClass", "values", "reviewerId", "reviewedAt", "evidence"])("a top-level `%s` is refused", async (key) => {
    signIn("reviewer");
    const res = await POST(post({ ...SUBMIT, [key]: key === "snapshot" ? { atomicRevision: {} } : "manufacturer_datasheet" }));
    expect([res.status, (await payload(res)).code]).toEqual([400, "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN"]);
    noBackendRead();
  });

  it.each([
    ["asset bytes in the symbol reference", { ...SUBMIT, symbol: { library: "Timer", name: "NE555D", content: "(kicad_symbol_lib (symbol \"NE555D\"))" } }],
    ["a source class on a terminal row", { ...SUBMIT, terminals: [{ number: "1", function: "GND", pads: ["1"], sourceClass: "manufacturer_datasheet" }] }],
    ["a source class on the citation", { ...SUBMIT, datasheet: { url: null, locator: "p.1", sourceClass: "manufacturer_datasheet" } }],
    ["a reviewer stamp on a fact disposition", { operation: "resolve_request", requestId: "r", decision: "approve", reason: "x", factDispositions: [{ factId: "fact_x", disposition: "reviewed", reviewerId: "u-someone-else", reviewedAt: "2026-01-01T00:00:00.000Z" }] }],
    ["an undeclared top-level field", { ...SUBMIT, revision: 1 }],
    ["a snapshot hidden in a link", { ...SUBMIT, links: [{ partId: "00000000-0000-4000-8000-000000000000", valueKey: "", snapshot: {} }] }],
  ])("%s is refused", async (_label, body) => {
    signIn("reviewer");
    const res = await POST(post(body));
    expect([res.status, (await payload(res)).code]).toEqual([400, "ATOMIC_PUBLICATION_INPUT_INVALID"]);
  });
});

describe("[B19-E E4] the route end to end (in-memory stores, bundled-library fixture)", () => {
  it("an editor submits, the viewer list shows it, a reviewer approves, an administrator publishes", async () => {
    signIn("editor");
    const created = await POST(post(SUBMIT));
    const createdBody = await payload(created);
    expect(created.status, JSON.stringify(createdBody).slice(0, 400)).toBe(201);
    const request = createdBody.request as AtomicPublicationRequest;
    expect(request.status).toBe("pending");
    expect(created.headers.get("cache-control")).toBe("no-store");

    signIn("viewer");
    const listed = await GET(get());
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    const listing = await payload(listed);
    expect(listing.viewer).toMatchObject({ role: "viewer", canSubmit: false, canResolve: false, canPublish: false });
    expect((listing.requests as AtomicPublicationRequest[]).map((item) => item.requestId)).toEqual([request.requestId]);

    signIn("reviewer");
    const manufacturer = request.evidence.facts.find((fact) => fact.property === "manufacturer")!;
    const approved = await POST(post({ operation: "resolve_request", requestId: request.requestId, decision: "approve", reason: "verified", reviewEvidenceDigest: request.evidence.reviewEvidenceDigest, resolutions: [{ property: "manufacturer", factId: manufacturer.factId, reason: "datasheet" }], factDispositions: [] }));
    const approvedBody = await payload(approved);
    expect(approved.status, JSON.stringify(approvedBody).slice(0, 400)).toBe(200);
    expect((approvedBody.request as AtomicPublicationRequest).status).toBe("approved");

    signIn("admin");
    const published = await POST(post({ operation: "publish_request", requestId: request.requestId, reason: "publish" }));
    const publishedBody = await payload(published);
    expect(published.status, JSON.stringify(publishedBody).slice(0, 400)).toBe(200);
    expect((publishedBody.request as AtomicPublicationRequest).status).toBe("published");
    expect(probes.dbReads).toBe(0);
  });

  it("a refusal from the review is its own truthful status: a stale digest is 409", async () => {
    signIn("editor");
    const request = (await payload(await POST(post({ ...SUBMIT, exactMpn: "NE555DRG4" })))).request as AtomicPublicationRequest;
    signIn("reviewer");
    const res = await POST(post({ operation: "resolve_request", requestId: request.requestId, decision: "approve", reason: "x", reviewEvidenceDigest: `sha256:${"0".repeat(64)}`, resolutions: [], factDispositions: [] }));
    expect([res.status, (await payload(res)).code]).toEqual([409, "ATOMIC_PUBLICATION_EVIDENCE_CHANGED"]);
  });
});

// [B19-E E4 review follow-up] a refusal code that reaches a person always carries its message (a renamed or added code
// without one used to fall back to the bare code), and the two unknown-outcome and replaced-request codes say what happened
describe("[B19-E E4 review follow-up] every refusal code has a client message", () => {
  it("each code the aggregate can raise has a message, and the late-publication and unknown-outcome messages are specific", async () => {
    const { ATOMIC_PUBLICATION_MESSAGES } = await import("../atomic/publication/handler");
    const { ATOMIC_PUBLICATION_ERROR_STATUS } = await import("@/app/lib/atomic/publication-review");
    const missing = Object.keys(ATOMIC_PUBLICATION_ERROR_STATUS).filter((code) => typeof (ATOMIC_PUBLICATION_MESSAGES as Record<string, string>)[code] !== "string");
    expect(missing).toEqual([]);
    expect(ATOMIC_PUBLICATION_MESSAGES.ATOMIC_PUBLICATION_REQUEST_REPLACED).toMatch(/published request, then the new one/);
    const unknown = ATOMIC_PUBLICATION_MESSAGES.ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN;
    expect(unknown).toMatch(/held/);
    expect(unknown, "never promises a retry will succeed while the status cannot be read").toMatch(/until .*can be read/);
  });
});

