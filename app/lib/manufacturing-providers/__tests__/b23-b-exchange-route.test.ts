/**
 * [B23-B1] The route (OD-174, OD-164): `POST /api/pcb/provider-exchange`, one route file with two operations named by a closed body
 * field (`operation: "preview" | "commit"`, OD-183). Its policy row is a canonical route with `externalTransfer: true` and
 * `spend: false`, human-only (a trusted session), CSRF-checked, `project_admin` only and never public; its classification row
 * carries `outboundEgress: "files"` (declared with the transfer row, never derived) and `modelEgress: false`, and the B22 process
 * census derives no process for it. The census moves once, to 166 / 163 / 3 / 0. The handler refuses authority-shaped keys, every
 * actor but a human project administrator (before any durable read), any undeclared key, and a commit without the opt-in header;
 * preview never sends and commit ends refused `provider_not_admitted` (no provider is admitted in B23, so no fetch happens).
 *
 * The durable stores and the release gate are in-process fakes. Nothing is written to disk and nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { authoritativeBoardDigest } from "@/app/lib/pcb/fab/release-gate";
import { MANUFACTURING_RULE_PROFILE_SCHEMA } from "@/app/lib/pcb/fab/release-manifest";
import { ruleProfileExpiry } from "@/app/lib/pcb/fab/rule-profile";
import { syntheticLedgerRecord, syntheticRelease } from "./_b23-b-release-fixture";

const scopeActor = vi.hoisted(() => ({ actorKind: null as string | null, role: null as string | null }));
vi.mock("@/app/api/pcb-sync/_scope", async (orig) => {
  const actual = await orig() as Record<string, unknown> & { pcbSyncScopeFromContext: (context: unknown) => { actor: Record<string, unknown> } };
  return { ...actual, pcbSyncScopeFromContext: (context: unknown) => { const scope = actual.pcbSyncScopeFromContext(context); return { ...scope, actor: { ...scope.actor, ...(scopeActor.actorKind ? { actorKind: scopeActor.actorKind } : {}), ...(scopeActor.role ? { role: scopeActor.role } : {}) } }; } };
});
const getHead = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/authority-store", async (orig) => ({ ...(await orig() as object), DurableManufacturingAuthorityStore: class { getHead = getHead; loader = () => vi.fn(); } }));
const ledgerList = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
vi.mock("@/app/lib/pcb/fab/release-ledger", async (orig) => ({ ...(await orig() as object), DurableManufacturingReleaseLedger: class { record = vi.fn(); list = ledgerList; latest = vi.fn(async () => null); } }));
vi.mock("@/app/lib/durable-workflow/runtime", () => ({ getDurableWorkflowRepository: () => ({ loadHead: async () => null }) }));
const getBoardHead = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/pcb-sync/route", () => ({ stage3Repository: { getBoardHead }, stage3BindingRepository: { listSelectedPeers: vi.fn(async () => []) } }));
const releasePackage = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/release-gate", async (orig) => ({ ...(await orig() as object), releaseManufacturingPackage: releasePackage }));

import { POST as exchange } from "@/app/api/pcb/provider-exchange/route";
import { allRoutePolicies, policyFor, routeVocabularyViolations } from "@/app/lib/auth/route-policy";
import { outboundEgressViolations, routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import { listRouteFiles, routePathOf } from "@/app/lib/auth/route-tree";
import { classifyRouteMethodForm, exportedHttpMethods } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "@/app/lib/engineering/action-registry";
import { permissionTierOfAction } from "@/app/lib/engineering/permission-tiers";
import { classifyControlSites } from "@/app/lib/engineering/control-registry";
import { scanControlSites } from "@/app/lib/engineering/control-surface";
import { PROVIDER_EXCHANGE_CHOICES } from "@/app/components/pcb/ProviderExchangePanel";
import { BOARD_FILE_EXCHANGES, PROVIDER_EXCHANGE_COMMIT_HEADER, PROVIDER_EXCHANGE_COMMIT_OPT_IN, PROVIDER_EXCHANGE_FORBIDDEN_KEYS } from "../provider-exchange";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PATH = "/api/pcb/provider-exchange";
const ROUTE_FILE = "app/api/pcb/provider-exchange/route.ts";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost${PATH}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body: JSON.stringify(body) });
const json = async (response: Response) => (await response.clone().json()) as Record<string, unknown>;
const DIGEST = authoritativeBoardDigest(createEmptyBoard());
const TODAY = "2026-10-03";
const HEAD = { authority: { boardRevision: "rev-9", boardDigest: DIGEST, manufacturingRuleProfile: { schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA, evidence: { sourceRefs: ["https://jlcpcb.com/capabilities/pcb-capabilities"], retrievedAt: "2026-09-09", expiresAt: ruleProfileExpiry("2026-09-09"), scope: "JLCPCB 1-2 layer rigid FR-4 (test stub)", notes: [] }, profileId: "jlcpcb-2l" }, schematic: { revision: "schematic:1", digest: "sha256:sch" }, componentAuthority: { digest: "component-authority-x" }, qualificationAuthority: { digest: "qualification-authority-x" } }, revision: 4, recordDigest: "sha256:authority-record-4" };
const BOARD = { record: { board: createEmptyBoard(), revision: "rev-9", digest: "pcb-sync-digest" }, aggregateRevision: 7 };
const PREVIEW = { operation: "preview", designId: "d1", boardId: "b1", expectedAuthorityRevision: 4, expectedAuthorityDigest: "sha256:authority-record-4", providerId: "jlcpcb", operationId: "pcb-quote", purpose: "quote" };
const OPT_IN = { [PROVIDER_EXCHANGE_COMMIT_HEADER]: PROVIDER_EXCHANGE_COMMIT_OPT_IN };
function admin(): void { injectAuthorizedPrincipal({ userId: "u-admin", tenantId: "local", projectId: "proj-1", role: "admin" }); }
/** [B23-B1 review, 2026-10-04] Production authentication configured with obvious fakes, assembled at runtime (never contacted). */
const configuredProductionAuth = (): Record<string, string> => ({ SIRKIT_AUTH_MODE: "production", NEXT_PUBLIC_SUPABASE_URL: ["https://auth", "invalid"].join("."), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ["fake", "publishable", "value"].join("-"), SIRKIT_EXPECTED_ORIGIN: "http://localhost" });
const durableReads = () => getHead.mock.calls.length + getBoardHead.mock.calls.length + releasePackage.mock.calls.length + ledgerList.mock.calls.length;
const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("B23-B1: no fetch may happen"); }); // never a real request

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  getHead.mockReset(); getBoardHead.mockReset(); releasePackage.mockReset(); ledgerList.mockReset(); fetchSpy.mockClear();
  getHead.mockResolvedValue(HEAD); getBoardHead.mockResolvedValue(BOARD);
  const synthetic = syntheticRelease();
  releasePackage.mockResolvedValue(synthetic);
  ledgerList.mockResolvedValue([syntheticLedgerRecord(synthetic)]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); resetInjectedIdentity(); scopeActor.actorKind = null; scopeActor.role = null; });

describe("[B23-B1] POST /api/pcb/provider-exchange: the policy and classification rows (OD-174)", () => {
  it("1. one canonical, human-only transfer row: externalTransfer, not spend, CSRF, project_admin only, never public, never the release vocabulary; the vocabulary gates pass; the two release rows stand", () => {
    const row = policyFor(PATH, "POST");
    expect(row).toMatchObject({ authClass: "authenticated-mutation", identitySource: "trusted-context", requiresAuth: true, permittedRoles: ["project_admin"], providerCredit: false, requiresCsrf: true, authoritativeWrite: false, releaseOrQualification: false, externalTransfer: true, spend: false });
    expect(policyFor(PATH, "GET")).toBeNull();
    expect(routeVocabularyViolations()).toEqual([]);
    expect(routeVocabularyViolations([row!])).toEqual([]);
    const policies = allRoutePolicies();
    expect(policies.filter((policy) => policy.externalTransfer).map((policy) => `${policy.method} ${policy.path}`)).toEqual([`POST ${PATH}`]);
    expect(policies.filter((policy) => policy.spend)).toEqual([]);
    expect(policies.filter((policy) => policy.releaseOrQualification).map((policy) => policy.path).sort()).toEqual(["/api/pcb/qualify", "/api/pcb/release"]);
  });

  it("2. its classification row: outboundEgress files (declared with the transfer row), modelEgress false, no external process, a durable read of project data, never public; the classification gates pass and the committed CSV carries the row", () => {
    const rows = routeResourceClassification().filter((row) => row.path === PATH);
    expect(rows).toEqual([{ path: PATH, method: "POST", isPublic: false, durableAccess: "read", projectDataSensitivity: "project-durable", providerCredit: false, externalProcess: "", expensive: true, authoritativeWrite: false, releaseOrQualification: false, staticOrCatalog: false, outboundEgress: "files", modelEgress: false }]);
    expect(routeResourceClassification().filter((row) => row.outboundEgress === "files").map((row) => row.path)).toEqual([PATH]);
    expect(outboundEgressViolations()).toEqual([]);
    expect(read("artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv").split(NEWLINE)).toContain(`${PATH},POST,false,read,project-durable,false,,true,false,false,false,files,false`);
    expect(read("artifacts/ai-control-plane-b16-0-1/exact-route-authorization-policy.csv").split(NEWLINE).filter((line) => line.startsWith(`${PATH},`))).toHaveLength(1);
  });

  it("3. the census moves once, by this one route file: 166 route methods = 163 canonical + 3 factories + 0 raw ([B24-A1, 2026-10-06] B24-A1's health and readiness since: 168 = 165 + 3 + 0); the route is a canonical wrapper; B23 has exactly one route file", () => {
    let total = 0, canonical = 0, factories = 0, raw = 0;
    const exchangeFiles: string[] = [];
    for (const file of listRouteFiles(ROOT)) {
      const src = readFileSync(file, "utf8");
      if (routePathOf(ROOT, file).includes("provider")) exchangeFiles.push(relative(ROOT, file).split("\\").join("/"));
      for (const method of exportedHttpMethods(src, file)) {
        total += 1;
        const form = classifyRouteMethodForm(src, method, file, ROOT).form;
        if (form === "canonical-wrapper") canonical += 1; else if (form === "factory") factories += 1; else raw += 1;
      }
    }
    expect({ total, canonical, factories, raw }).toEqual({ total: 177, canonical: 174, factories: 3, raw: 0 }); // [PR-M, 2026-10-18] reviewed census move (runbook M.3, section M2), was 175 / 172: + GET and POST /api/parts/acquisitions (the durable CAD acquisition task; authenticatedRoute and authenticatedJsonRoute), two canonical wrappers, 0 raw stays 0; [PR-M, 2026-10-18] reviewed census move (runbook M.2.5), was 174 / 171: + POST /api/component-resolution-authority, one canonical wrapper; [PR-L, 2026-10-17] reviewed census move (runbook L.4), was 168 / 165: + the six generation-task methods, six canonical wrappers; [B24-A1, 2026-10-06] reviewed census move (OD-198), was 166 / 163: + GET /api/health and GET /api/ready, two canonical wrappers
    expect(exchangeFiles).toEqual([ROUTE_FILE]);
    const src = read(ROUTE_FILE);
    expect(exportedHttpMethods(src, join(ROOT, ROUTE_FILE))).toEqual(["POST"]);
    expect(classifyRouteMethodForm(src, "POST", join(ROOT, ROUTE_FILE), ROOT).form).toBe("canonical-wrapper");
  });

  it("4. in B1 the route reaches no connection: its runtime import closure is the release route's plus the reviewed B23 modules - no egress boundary, no process spawner, no new transport (the send is B2's) [B23-B2, 2026-10-04] reviewed pin move: since B2 the closure adds the one sending module (provider-egress.ts), the exchange record, the meters and the egress boundary, which it reaches only through provider-egress.ts; still no process spawner, no distributor egress and no other transport [B23-B3 review, 2026-10-04] regressions-2: and every B23 module of the closure - the ones the release route's closure now holds through GET /api/pcb-sync's route module included - holds no connection primitive; that shared part is pinned exactly", { timeout: 120_000 }, () => { // [B23-B3 review, 2026-10-04] + the closure gates' timeout: its two walks took 5.6 s and 6.5 s here (b3f-00, b3f-01), over vitest's 5 s default
    const files = collectProductionFiles(ROOT);
    const exchangeClosure = importClosure(files, [ROUTE_FILE]);
    const releaseClosure = importClosure(files, ["app/api/pcb/release/route.ts"]);
    const added = [...exchangeClosure.keys()].filter((member) => !releaseClosure.has(member)).sort();
    expect(added).toEqual([
      "app/api/pcb/provider-exchange/route.ts",
      "app/lib/acquisition/admission-control.ts", // [B23-B2, 2026-10-04] the manufacturing-provider meter (OD-165)
      // "app/lib/acquisition/source-registry.ts", [B23-B3, 2026-10-04] reviewed pin move: now in the release route's closure too (it imports the board store from GET /api/pcb-sync's route module, which composes the observation reader over the exchange record and the registry), so no longer added
      // "app/lib/manufacturing-providers/exchange-ledger.ts", [B23-B2, 2026-10-04] the durable exchange record (OD-167) [B23-B3, 2026-10-04] reviewed pin move: now in the release route's closure too (it imports the board store from GET /api/pcb-sync's route module, which composes the observation reader over the exchange record and the registry), so no longer added
      "app/lib/manufacturing-providers/outbound-package.ts",
      "app/lib/manufacturing-providers/provider-admission.ts",
      "app/lib/manufacturing-providers/provider-egress.ts", // [B23-B2, 2026-10-04] the one sending module
      "app/lib/manufacturing-providers/provider-exchange.ts",
      // "app/lib/manufacturing-providers/provider-registry.ts", [B23-B3, 2026-10-04] reviewed pin move: now in the release route's closure too (it imports the board store from GET /api/pcb-sync's route module, which composes the observation reader over the exchange record and the registry), so no longer added
      "app/lib/net/outbound-fetch.ts", // [B23-B2, 2026-10-04] the egress boundary, reached only through provider-egress.ts (below)
    ]);
    expect(exchangeClosure.has("app/api/pcb/release/route.ts")).toBe(true);
    for (const forbidden of ["app/lib/distributors/egress.ts", "app/lib/pcb/autoroute/runner.ts", "app/lib/pcb/fab/kicad-cli-runner.ts", "app/lib/computation/diagnostic-runner.ts", "app/lib/computation/engine-host.ts"]) expect(exchangeClosure.has(forbidden), forbidden).toBe(false); // [B23-B2, 2026-10-04] reviewed pin move: the egress boundary left this list (it is reached, below)
    expect(importClosure(files, [ROUTE_FILE], new Set(["app/lib/manufacturing-providers/provider-egress.ts"])).has("app/lib/net/outbound-fetch.ts"), "[B23-B2] the boundary only through provider-egress.ts").toBe(false);
    // the added modules hold no connection primitive: no fetch call, no network or model SDK import; [B23-B2, 2026-10-04] the boundary aside, whose one global fetch is the transport census's reviewed site (b23-a-route-vocabulary case 8)
    for (const member of added.filter((file) => file !== "app/lib/net/outbound-fetch.ts")) expect(files.get(member)!, member).not.toMatch(/\bfetch\(|from "(?:node:)?(?:https?|net|tls|http2|dgram)"|from "(?:undici|axios|node-fetch|ws|openai|@anthropic-ai\/sdk)"/);
    // [B23-B3 review, 2026-10-04] regressions-2: the three entries commented out above are scanned still. The release route's closure now
    // holds B23 modules through GET /api/pcb-sync's route module (its board-store import, `release/route.ts:45`), which composes the
    // observation reader; that shared part is pinned exactly, it reaches no sender, and every B23 module of the exchange closure - added
    // or shared - holds no connection primitive
    const B23_MODULE = /^app\/lib\/manufacturing-providers\/|^app\/lib\/acquisition\/(?:admission-control|source-registry)\.ts$/;
    expect([...releaseClosure.keys()].filter((file) => B23_MODULE.test(file)).sort()).toEqual([
      "app/lib/acquisition/source-registry.ts",
      "app/lib/manufacturing-providers/exchange-ledger.ts",
      "app/lib/manufacturing-providers/provider-observation.ts",
      "app/lib/manufacturing-providers/provider-registry.ts",
      "app/lib/manufacturing-providers/provider-text-screen.ts",
    ]);
    for (const sender of ["app/lib/manufacturing-providers/provider-egress.ts", "app/lib/manufacturing-providers/provider-exchange.ts", "app/lib/net/outbound-fetch.ts"]) expect(releaseClosure.has(sender), sender).toBe(false);
    const scanned = [...exchangeClosure.keys()].filter((file) => B23_MODULE.test(file) || added.includes(file)).filter((file) => file !== "app/lib/net/outbound-fetch.ts").sort();
    expect(scanned.filter((file) => !added.includes(file))).toEqual(["app/lib/acquisition/source-registry.ts", "app/lib/manufacturing-providers/exchange-ledger.ts", "app/lib/manufacturing-providers/provider-observation.ts", "app/lib/manufacturing-providers/provider-registry.ts", "app/lib/manufacturing-providers/provider-text-screen.ts"]);
    for (const member of scanned) expect(files.get(member)!, member).not.toMatch(/\bfetch\(|from "(?:node:)?(?:https?|net|tls|http2|dgram)"|from "(?:undici|axios|node-fetch|ws|openai|@anthropic-ai\/sdk)"/);
  });
});

describe("[B23-B1] POST /api/pcb/provider-exchange: the handler's perimeter", () => {
  it("5. the wrapper refuses a cross-origin request and a signed-out caller, and a member who is not a project administrator, before any durable read", async () => {
    admin();
    // the exact-origin check is the B16.0.1 wrapper property behind requiresCsrf: true; it runs only in the production auth mode, and
    // [B23-B1 review, 2026-10-04] tests-2: only once production authentication is configured (unconfigured, every request is refused
    // earlier, AUTH_PRODUCTION_NOT_CONFIGURED, whatever its origin). Obvious fakes configure it; nothing is contacted (identity is injected)
    for (const [name, value] of Object.entries(configuredProductionAuth())) vi.stubEnv(name, value);
    const cross = await exchange(post(PREVIEW, { origin: "https://elsewhere.example" }));
    expect(cross.status).toBe(403);
    expect((await json(cross)).code).toBe("AUTH_CROSS_ORIGIN_DENIED");
    expect(durableReads()).toBe(0);
    // the control: the same request from the expected origin passes the wrapper and is previewed
    const same = await exchange(post(PREVIEW));
    expect(same.status, JSON.stringify(await json(same)).slice(0, 300)).toBe(200);
    vi.unstubAllEnvs();
    getHead.mockClear(); getBoardHead.mockClear(); releasePackage.mockClear(); ledgerList.mockClear();
    injectIdentity(null);
    expect((await exchange(post(PREVIEW))).status).toBe(401);
    resetInjectedIdentity();
    injectAuthorizedPrincipal({ userId: "u-editor", tenantId: "local", projectId: "proj-1", role: "editor" });
    const editor = await exchange(post(PREVIEW));
    expect(editor.status).toBe(403);
    expect((await json(editor)).code).toBe("AUTH_ROLE_DENIED");
    expect(durableReads()).toBe(0);
  });

  it.each([["ai"], ["automation"], ["system_migration"]])("6. an administrator membership whose actor kind is %s is refused PX_HUMAN_ADMIN_REQUIRED before any durable read, for preview and commit", async (kind) => {
    admin();
    scopeActor.actorKind = kind;
    for (const body of [PREVIEW, { operation: "commit", planId: "provider-exchange-plan:x", planDigest: "dw1-x", idempotencyKey: "k" }]) {
      const response = await exchange(post(body, OPT_IN));
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({ ok: false, code: "PX_HUMAN_ADMIN_REQUIRED" });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(durableReads()).toBe(0);
  });

  it("7. a human whose derived role is not project_admin is refused even if the membership policy let the request through", async () => {
    admin();
    scopeActor.role = "pcb_editor";
    const response = await exchange(post(PREVIEW));
    expect(response.status).toBe(403);
    expect((await json(response)).code).toBe("PX_HUMAN_ADMIN_REQUIRED");
    expect(durableReads()).toBe(0);
  });

  it("8. authority-shaped keys are refused first; the operation field is closed; each operation's body is closed to its declared keys; none of these reaches a durable read", async () => {
    admin();
    expect([...PROVIDER_EXCHANGE_FORBIDDEN_KEYS].sort()).toEqual(["actor", "actorId", "actorKind", "archive", "board", "branchId", "bytes", "credentials", "endpoint", "files", "headers", "host", "manifest", "package", "path", "projectId", "role", "snapshot", "tenantId", "url"]);
    for (const key of PROVIDER_EXCHANGE_FORBIDDEN_KEYS) {
      const response = await exchange(post({ ...PREVIEW, [key]: "x" }));
      expect(response.status, key).toBe(400);
      expect((await json(response)).code, key).toBe("AUTH_AUTHORITATIVE_INPUT_FORBIDDEN");
    }
    for (const operation of [undefined, "send", "apply", "Preview", ["preview"]]) {
      const response = await exchange(post({ ...PREVIEW, operation }));
      expect(response.status, String(operation)).toBe(400);
      expect((await json(response)).code, String(operation)).toBe("PX_API_OPERATION_REQUIRED");
    }
    const unknown = await exchange(post({ ...PREVIEW, quantity: 5, planId: "p" }));
    expect(unknown.status).toBe(400);
    expect(await json(unknown)).toMatchObject({ code: "PX_API_UNKNOWN_FIELD", fields: ["planId", "quantity"] });
    const commitUnknown = await exchange(post({ operation: "commit", planId: "p", planDigest: "d", idempotencyKey: "k", providerId: "jlcpcb" }, OPT_IN));
    expect(await json(commitUnknown)).toMatchObject({ code: "PX_API_UNKNOWN_FIELD", fields: ["providerId"] });
    expect(durableReads()).toBe(0);
  });

  it("9. commit needs the explicit opt-in header with the exact value; without it nothing is read or sent", async () => {
    admin();
    const preview = await exchange(post(PREVIEW));
    expect(preview.status, JSON.stringify(await json(preview)).slice(0, 300)).toBe(200);
    const plan = (await json(preview)).plan as { planId: string; planDigest: string };
    const reads = durableReads();
    for (const headers of ([{}, { [PROVIDER_EXCHANGE_COMMIT_HEADER]: "true" }, { [PROVIDER_EXCHANGE_COMMIT_HEADER]: PROVIDER_EXCHANGE_COMMIT_OPT_IN.toUpperCase() }, { [PROVIDER_EXCHANGE_COMMIT_HEADER]: `${PROVIDER_EXCHANGE_COMMIT_OPT_IN}_v2` }] as Array<Record<string, string>>)) {
      const refused = await exchange(post({ operation: "commit", planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "k1" }, headers));
      expect(refused.status).toBe(403);
      expect((await json(refused)).code).toBe("PX_COMMIT_OPT_IN_REQUIRED");
    }
    expect(durableReads()).toBe(reads);
    const committed = await exchange(post({ operation: "commit", planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "k1" }, OPT_IN));
    expect(committed.status).toBe(409);
    expect(await json(committed)).toMatchObject({ ok: false, code: "PX_PROVIDER_NOT_ADMITTED", refusal: "provider_not_admitted", sent: false, planId: plan.planId });
  });

  it("10. preview never sends: an administrator's preview answers the plan (every file and field, the 10-minute expiry, no provider admitted) and makes no fetch; the commit makes none either", async () => {
    admin();
    const response = await exchange(post(PREVIEW));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const plan = body.plan as Record<string, unknown> & { outbound: { files: unknown[]; fields: string[] }; admission: Record<string, unknown>; createdAt: string; expiresAt: string };
    expect(body).toMatchObject({ ok: true, operation: "preview", sent: false });
    expect(plan.outbound.files).toHaveLength(6);
    expect(plan.outbound.fields.length).toBeGreaterThan(5);
    expect(Date.parse(plan.expiresAt) - Date.parse(plan.createdAt)).toBe(10 * 60_000);
    expect(plan.admission).toMatchObject({ admitted: false, refusal: "provider_not_admitted" });
    await exchange(post({ operation: "commit", planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "k-send" }, OPT_IN));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("[B23-B1] the action record, the route coverage and the panel's controls", () => {
  it("11. the route belongs to one new Tier 3 record carrying external-transfer: never tool-exposed, approval tier release; the panel's preview and commit are semantic controls of it and its provider choice is a view control", () => {
    const record = ACTION_COVERAGE_REGISTRY.find((candidate) => candidate.id === "manufacturing.provider-exchange")!;
    expect(record).toMatchObject({ kind: "destructive", status: "implemented", toolExposure: "none", approvalTier: "release", sideEffects: "external-transfer" });
    expect(permissionTierOfAction(record)).toBe(3);
    expect(ACTION_COVERAGE_REGISTRY.filter((candidate) => candidate.sideEffects === "external-transfer").map((candidate) => candidate.id)).toEqual(["manufacturing.provider-exchange"]);
    expect(API_ROUTE_COVERAGE.find((entry) => entry.path === PATH)).toEqual({ path: PATH, methods: ["POST"], recordId: "manufacturing.provider-exchange", class: "destructive" });
    const { classified } = classifyControlSites(scanControlSites(ROOT));
    const panel = classified.filter((row) => row.surface === "app/components/pcb/ProviderExchangePanel.tsx");
    expect(panel.map((row) => `${row.kind}:${row.handler}:${row.classification}:${row.recordIds.join("|")}`).sort()).toEqual([
      "click:exchange.commit:semantic:manufacturing.provider-exchange",
      "click:exchange.preview:semantic:manufacturing.provider-exchange",
      "change:exchange.choose:view:",
    ].sort());
  });

  it("12. the panel offers exactly the server's reviewed board-file exchanges, in order", () => {
    expect(PROVIDER_EXCHANGE_CHOICES.map(({ providerId, operationId, purpose }) => ({ providerId, operationId, purpose }))).toEqual(BOARD_FILE_EXCHANGES.map(({ providerId, operationId, purpose }) => ({ providerId, operationId, purpose })));
  });
});
