/**
 * [B20 D2] Hidden release tools and cross-project access — the EXHAUSTIVE, POPULATION-WIDE sweep (OD-104).
 *
 * Every descriptor of the canonical registry, under every mapped stored role, called through `POST /api/mcp`. That is the
 * one thing no existing suite does: B3 case 7 proves two withheld reads plus `sirkit.manufacturing.release`, B3 case 8 the
 * five proposals, B4 case 5 the listed-means-served ratchet. D2 composes over those and asserts what only a whole-
 * population run can: that every unserved name answers ONE identical body of cardinality 1, that the trace records each
 * one, and that NO durable query, board read, lineage read, component-authority read or extra membership read happened on
 * any of them.
 *
 * DEC-5: the two refusal kinds are PARTITIONED before anything is asserted. Mixing them is the defect the partition
 * removes: a blanket "every spy is 0" would be false for the served reads, which are expected to do durable work.
 * DEC-6: absence of work is proven by counting SPIES, never by timing.
 *
 * Every literal is derived from the landed lists at run time. The harness is B3's verbatim (in-memory membership, in-memory
 * durable workflow, the durable board fixture, a frozen clock): no database, no network.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_TOKEN_LIFETIME_S, MCP_TOKEN_SECRET_ENV, __setMcpServerClockForTests, mintMcpAccessToken, verifyMcpAccessToken } from "@/app/lib/auth/mcp-bearer";
import { membershipRevisionOf, PROJECT_ROLE_FROM_MEMBERSHIP, type InMemoryProjectMembershipRepository, type MembershipRole } from "@/app/lib/auth/project-membership";
import { injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { createDurableBoardReader, durableCanonicalState, DURABLE_READ_ONLY_VIEW_ERROR, readOnlyDurableWorkflow } from "@/app/lib/engineering/durable-read-bundle";
import { MCP_EXCLUSION_REASONS, mcpExposureReport, INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS, type McpExclusionReason } from "@/app/lib/engineering/mcp-exposure";
import { computeProjectRevision } from "@/app/lib/engineering/revision";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { ReadToolInvocationService } from "@/app/lib/engineering/tool-invocation";
import type { ProjectRole } from "@/app/lib/engineering/types";
import { durableAuthoritySource, durableBoardFixture, FIXTURE_SCOPE, publishDurableBoard } from "@/app/lib/engineering/__tests__/_durable-board-fixture";
import { encodeMcpNameHeader } from "@/app/lib/mcp/http-transport";
import { resetMcpInboundLimitsForTests } from "@/app/lib/mcp/server/inbound-limits";
import { MCP_JSON_RPC_ERROR_CODES, MCP_JSON_RPC_MESSAGES } from "@/app/lib/mcp/server/protocol";
import { MCP_READ_EXEMPT_TOOL_IDS, membershipReverifier, resetMcpReadInvokerFactory, resetMcpReadStateForTests, setMcpReadInvokerFactory, type McpReadDependencies } from "@/app/lib/mcp/server/read-call";
import { resetMcpReadTraceSinkFactory } from "@/app/lib/mcp/server/read-trace";
import { mcpServerTraceRing, MCP_SERVER_TRACE_OUTCOMES, MCP_SERVER_TRACE_RING_MAX, resetMcpServerTraceSinkFactory, type McpServerRequestTrace } from "@/app/lib/mcp/server/request-trace";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { POST } from "../route";
import { resetMcpReadDependenciesFactory, setMcpReadDependenciesFactory } from "../read-runtime";

const dbCalls = vi.hoisted(() => ({ getDb: 0, getSqlClient: 0 }));
vi.mock("@/app/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/db/client")>();
  return { ...actual, getDb: () => { dbCalls.getDb += 1; throw new Error("getDb reached in a test"); }, getSqlClient: () => { dbCalls.getSqlClient += 1; throw new Error("getSqlClient reached in a test"); } };
});

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b20/mcp-adversarial.md";
const SUITE = "app/api/mcp/__tests__/b20-d2-never-reachable-sweep.test.ts";
const B3_SUITE = "app/api/mcp/__tests__/b20-b3-mcp-tools-call-reads.test.ts";
const B4_SUITE = "app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts";

const ORIGIN = "https://mcp.example.com";
const URL_MCP = `${ORIGIN}/api/mcp`;
const SECRET = ["d2", "fixture", "mcp", "token", "secret", "0123456789abcdef"].join("-");
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const V = "2026-07-28";
const META = { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientCapabilities": {} };
const STORED_ROLES = Object.freeze(Object.keys(PROJECT_ROLE_FROM_MEMBERSHIP) as MembershipRole[]);
/** one subject per role, so no endpoint-limiter key ever reaches its 120-per-window bound during the sweep */
const USER_OF: Readonly<Record<MembershipRole, string>> = Object.freeze(Object.fromEntries(STORED_ROLES.map((role) => [role, `user-d2-${role}`])) as Record<MembershipRole, string>);

let now = T0;
let repo: InMemoryProjectMembershipRepository;
let workflow: InMemoryDurableWorkflowRepository;
let board: PcbBoard;
let authority: Awaited<ReturnType<typeof durableAuthoritySource>>;
let randomCounter = 0;

/**
 * DEC-6: the durable seams, counted. Reset per case; never a wall-clock assertion.
 * [B20 D review] regressions-2: TWO layers are counted, because the pipeline never touches the repository itself — it
 * receives the read-only VIEW (`readOnlyDurableWorkflow`), which delegates reads and refuses every write without
 * delegating. `workflowRead`/`workflowWrite` count the repository's own methods; `viewRead`/`viewWrite` count what the
 * pipeline asked of the view. E1c proves both write counters move when a write is attempted, so a 0 here is measured, not
 * vacuous; the write CLAIM of the sweep is the structural one (the view is what protects the store).
 */
type ReadScope = { tenantId: string; projectId: string; branchId: string };
const spies = { boardRead: 0, componentAuthority: 0, membership: 0, workflowRead: 0, workflowWrite: 0, viewRead: 0, viewWrite: 0, unclassified: [] as string[], scopes: [] as ReadScope[] };
const resetSpies = (): void => { spies.boardRead = 0; spies.componentAuthority = 0; spies.membership = 0; spies.workflowRead = 0; spies.workflowWrite = 0; spies.viewRead = 0; spies.viewWrite = 0; spies.unclassified = []; spies.scopes = []; };
const spySum = (s: Omit<typeof spies, "unclassified" | "scopes">): number => s.boardRead + s.componentAuthority + s.membership + s.workflowRead + s.workflowWrite + s.viewRead + s.viewWrite;
const spyTotal = (): number => spySum(spies);
/** The repository's OWN method names, classified by name — never by a prefix regex (E1c asserts the classification is total). */
const WORKFLOW_WRITE_METHODS: ReadonlySet<string> = new Set(["commit", "claimOutbox", "completeOutbox", "failOutbox"]);
const WORKFLOW_READ_METHODS: ReadonlySet<string> = new Set(["loadHead", "listHeads", "loadRecord", "history", "getReplay", "listOutbox"]);

function stubMcp(): void {
  vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
  vi.stubEnv(MCP_TOKEN_SECRET_ENV, SECRET);
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", undefined);
  vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", undefined);
  vi.stubEnv("SIRKIT_AUTH_MODE", undefined);
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", undefined);
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
}

function member(role: MembershipRole, options: { user?: string; projectId?: string; tenantId?: string; version?: number; state?: "active" | "revoked" } = {}): void {
  repo.set({
    tenantId: options.tenantId ?? FIXTURE_SCOPE.tenantId, projectId: options.projectId ?? FIXTURE_SCOPE.projectId, userId: options.user ?? USER_OF[role],
    role, state: options.state ?? "active", version: options.version ?? 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "test",
  });
}

async function tokenFor(options: { user: string; projectId?: string; tenantId?: string; branchId?: string } = { user: "" }): Promise<string> {
  const projectId = options.projectId ?? FIXTURE_SCOPE.projectId;
  const tenantId = options.tenantId ?? FIXTURE_SCOPE.tenantId;
  const record = await repo.loadActiveMembership({ tenantId, projectId, userId: options.user });
  if (!record) throw new Error(`fixture: no membership for ${options.user}`);
  const minted = mintMcpAccessToken({ subject: options.user, tenantId, projectId, branchId: options.branchId ?? "main", membershipRevision: membershipRevisionOf(record) }, { environment: process.env, nowMs: now });
  if (!minted.ok) throw new Error(`fixture: mint ${minted.reason}`);
  return minted.token;
}

/** The read dependencies with every durable seam counted (DEC-6). */
function spiedReadDeps(overrides: Partial<McpReadDependencies> = {}): McpReadDependencies {
  // `DurableBoardReader` and `McpMembershipReverifier` are OBJECTS with one method each: the spy wraps the METHOD, so the
  // pipeline's own `typeof reader.load !== "function"` guard still sees what it expects. The reader is built over the
  // spied VIEW of the spied repository, so both layers are counted (see `spies`), and every scope the reader is asked for
  // is recorded, so "the other project's rows were never read" is measured on the argument, not inferred from a count.
  const reader = createDurableBoardReader(spiedView(readOnlyDurableWorkflow(workflow)));
  const reverifier = membershipReverifier(() => repo);
  return {
    boardReader: { load: (...args: Parameters<typeof reader.load>) => { spies.boardRead += 1; const scope = args[0] as ReadScope; spies.scopes.push({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }); return reader.load(...args); } },
    componentAuthority: () => { spies.componentAuthority += 1; return authority; },
    membership: { reverify: (...args: Parameters<typeof reverifier.reverify>) => { spies.membership += 1; return reverifier.reverify(...args); } },
    now: () => now,
    randomBytes: (size) => { randomCounter += 1; return Uint8Array.from({ length: size }, (_value, index) => (randomCounter * 13 + index) % 256); },
    ...overrides,
  };
}

/**
 * The durable repository with its reads and writes counted BY THE REPOSITORY'S OWN METHOD NAMES: the lineage and board
 * store D2 proves untouched. A method neither list names is counted as a write AND recorded as unclassified, so a new
 * repository method can never slip past as a read.
 */
function spiedWorkflow(inner: InMemoryDurableWorkflowRepository): InMemoryDurableWorkflowRepository {
  const target = inner as unknown as Record<string, unknown>;
  const proxied = new Proxy(target, {
    get(source, key: string | symbol) {
      const value = Reflect.get(source, key);
      if (typeof value !== "function" || typeof key !== "string") return value;
      return (...args: unknown[]) => {
        if (WORKFLOW_WRITE_METHODS.has(key)) spies.workflowWrite += 1;
        else if (WORKFLOW_READ_METHODS.has(key)) spies.workflowRead += 1;
        else { spies.workflowWrite += 1; spies.unclassified.push(key); }
        return (value as (...rest: unknown[]) => unknown).apply(source, args);
      };
    },
  });
  return proxied as unknown as InMemoryDurableWorkflowRepository;
}

/**
 * The read-only VIEW with what the pipeline asks of it counted: the view is frozen, so it is re-wrapped method by method
 * (a Proxy over a frozen object could not answer a wrapper without breaking the invariants). `viewWrite` counts the four
 * refusing write methods being ASKED; whether the ask reached the repository is `workflowWrite`'s.
 */
function spiedView(view: DurableWorkflowRepository): DurableWorkflowRepository {
  const wrapped: Record<string, unknown> = {};
  for (const key of Object.keys(view)) {
    const method = (view as unknown as Record<string, unknown>)[key];
    if (typeof method !== "function") continue;
    wrapped[key] = (...args: unknown[]) => {
      if (WORKFLOW_WRITE_METHODS.has(key)) spies.viewWrite += 1;
      else spies.viewRead += 1;
      return (method as (...rest: unknown[]) => unknown).apply(view, args);
    };
  }
  return Object.freeze(wrapped) as unknown as DurableWorkflowRepository;
}

type Message = Record<string, unknown>;
const callRpc = (name: unknown, args: unknown = {}, meta: Record<string, unknown> = {}, id: unknown = 1): Message =>
  ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: { ...META, ...meta } } });

function request(message: Message, token: string | null, overrides: { headers?: Record<string, string | undefined>; url?: string } = {}): Request {
  const params = (message.params ?? {}) as Record<string, unknown>;
  const headers: Record<string, string> = {
    "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": V, "mcp-method": String(message.method),
    ...(message.method === "tools/call" && typeof params.name === "string" ? { "mcp-name": encodeMcpNameHeader(params.name) } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  for (const [name, value] of Object.entries(overrides.headers ?? {})) {
    if (value === undefined) delete headers[name];
    else headers[name] = value;
  }
  return new Request(overrides.url ?? URL_MCP, { method: "POST", headers, body: JSON.stringify(message) });
}

interface Answer { status: number; body: Record<string, unknown>; text: string; headers: Record<string, string> }
async function post(message: Message, token: string | null, overrides: { headers?: Record<string, string | undefined>; url?: string } = {}): Promise<Answer> {
  const response = await POST(request(message, token, overrides));
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { body = {}; }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
  return { status: response.status, body, text, headers };
}

const revisionOf = (value: PcbBoard): string => computeProjectRevision(durableCanonicalState(FIXTURE_SCOPE, value)).canonicalStateDigest;
/** the pipeline's closed refusal code and the revision it names, where the served read writes them */
const metaOf = (body: Record<string, unknown>): Record<string, unknown> => ((body.result as { _meta?: Record<string, unknown> } | undefined)?._meta ?? {});
const refusalOf = (body: Record<string, unknown>): string => String(metaOf(body)["dev.sirkit/refusal"] ?? "");
const currentRevisionOf = (body: Record<string, unknown>): string => String(metaOf(body)["dev.sirkit/currentRevision"] ?? "");
/**
 * The arguments each served read needs to REACH the durable board: the read pipeline judges the arguments (step 5) before
 * it loads the board (step 9), so a sweep with a bare `{}` would refuse two of the nine reads before any durable work and
 * prove nothing about them. These are B3's own fixture arguments; every other id is called with `{}`.
 */
const READ_ARGS: Readonly<Record<string, Record<string, unknown>>> = Object.freeze({
  "sirkit.pcb.via-inspect": { netName: "/root/VCC" },
  "sirkit.component-authority.inspect": { componentIds: ["sync-u1"] },
});
const argsFor = (toolId: string): Record<string, unknown> => READ_ARGS[toolId] ?? {};
const pin = (revision: string): Record<string, unknown> => ({ "dev.sirkit/expectedRevision": revision });
/** the request id normalised away, so two bodies of different requests are comparable */
const shapeOf = (body: Record<string, unknown>): string => JSON.stringify({ ...body, id: 0 });
const traces = (): readonly McpServerRequestTrace[] => mcpServerTraceRing();

/** The registry population and the served listing per role, derived — never typed. */
function population(): { descriptors: readonly string[]; report: ReturnType<typeof mcpExposureReport>; servedFor: Readonly<Record<MembershipRole, readonly string[]>> } {
  const registry = sirkitToolRegistry();
  const descriptors = registry.list().map((descriptor) => descriptor.toolId);
  const report = mcpExposureReport(registry);
  const servedFor = Object.fromEntries(STORED_ROLES.map((stored) => {
    const role: ProjectRole = PROJECT_ROLE_FROM_MEMBERSHIP[stored];
    return [stored, report.actual.filter((id) => registry.get(id)!.requiredRoles.includes(role))];
  })) as unknown as Record<MembershipRole, readonly string[]>;
  return { descriptors, report, servedFor };
}

beforeEach(async () => {
  stubMcp();
  now = T0;
  __setMcpServerClockForTests(() => now);
  resetMcpInboundLimitsForTests();
  resetMcpServerTraceSinkFactory();
  resetMcpReadTraceSinkFactory();
  resetMcpReadStateForTests();
  resetMcpReadInvokerFactory();
  repo = injectMembership([]);
  for (const role of STORED_ROLES) member(role);
  workflow = new InMemoryDurableWorkflowRepository();
  board = durableBoardFixture();
  // the component-authority read needs its own source, exactly as B3's suites give it one; without it that read refuses
  // `durable_board_unavailable` before it ever loads the board, and Partition B would prove nothing about it
  authority = await durableAuthoritySource(["sync-u1", "sync-u2"]);
  await publishDurableBoard(workflow, FIXTURE_SCOPE, board);
  workflow = spiedWorkflow(workflow);
  setMcpReadDependenciesFactory(() => spiedReadDeps());
  resetSpies();
  dbCalls.getDb = 0;
  dbCalls.getSqlClient = 0;
});
afterEach(() => {
  __setMcpServerClockForTests(null);
  resetMcpReadDependenciesFactory();
  resetMcpReadInvokerFactory();
  resetMcpReadStateForTests();
  resetMcpServerTraceSinkFactory();
  resetMcpReadTraceSinkFactory();
  resetInjectedIdentity();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("[B20 D2] the never-reachable sweep", () => {
  it("E1. the partition is exact and DERIVED: every descriptor carries exactly one state — exposed, withheld, or structurally excluded with exactly one of the twelve reasons; the two reviewed lists are disjoint; and the four reasons the code documents as empty carry zero ids", () => {
    const { descriptors, report } = population();
    expect(descriptors.length).toBeGreaterThan(0);
    expect(new Set(descriptors).size).toBe(descriptors.length); // one version per id in the production registry
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.unexpected).toEqual([]);
    expect(report.outsideAgentSet).toEqual([]);
    expect(report.duplicates).toEqual([]);

    const exposed = new Set(report.actual);
    const withheld = new Set(MCP_WITHHELD_TOOL_IDS);
    expect([...exposed].filter((id) => withheld.has(id))).toEqual([]);
    expect([...report.actual].sort()).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS].sort());

    // every descriptor is in exactly one bucket, and the buckets partition the population
    const excludedIds = report.excluded.map((entry) => entry.toolId);
    expect(new Set(excludedIds).size).toBe(excludedIds.length);
    expect([...exposed, ...excludedIds].sort()).toEqual([...descriptors].sort());
    for (const entry of report.excluded) expect(MCP_EXCLUSION_REASONS, entry.toolId).toContain(entry.reason);

    // FACT 16, asserted ONCE here as an emptiness claim: the four reasons the code documents as carrying no production id
    const documentedEmpty: readonly McpExclusionReason[] = ["not_read_or_propose", "side_effects", "not_servable", "not_mcp_reviewed"];
    for (const reason of documentedEmpty) expect(report.excludedByReason[reason], reason).toEqual([]);
    expect(read("app/lib/engineering/mcp-exposure.ts")).toContain("`not_read_or_propose`, `side_effects`, `not_servable` and `not_mcp_reviewed` carry no production id");

    // the derived literals of the day, recorded on the page
    const page = read(PAGE);
    expect(page).toContain(`| descriptors | ${descriptors.length} |`);
    expect(page).toContain(`| MCP-exposed | ${report.actual.length} |`);
    expect(page).toContain(`| withheld | ${MCP_WITHHELD_TOOL_IDS.length} |`);
    expect(page).toContain(`| structurally excluded | ${excludedIds.length - MCP_WITHHELD_TOOL_IDS.length} |`);
  });

  it("E1b. Sirkit's OWN MCP client tool is never servable over Sirkit's MCP server: sirkit.mcp.observation-read is excluded as external_read, is on no role's tools/list, and answers the identical -32602 on tools/call under every mapped role", async () => {
    const { report, servedFor } = population();
    const own = report.excluded.find((entry) => entry.toolId === "sirkit.mcp.observation-read");
    expect(own, "A4's descriptor is in the registry").toBeDefined();
    expect(own!.reason).toBe("external_read");
    // TWO INDEPENDENT GROUNDS, measured: the descriptor's binding status ALONE already yields `external_read`, so removing
    // A4's `external-mcp-observation` clause from `structuralReasonOf` would not change this answer. Both are therefore
    // pinned — the descriptor's own facts, and the rule's text — so a reviewed move of either one is visible here.
    const descriptor = sirkitToolRegistry().get("sirkit.mcp.observation-read")!;
    expect(descriptor.binding.status).toBe("bound-external-read");
    expect(descriptor.requiredAuthority).toContain("external-mcp-observation");
    const rule = read("app/lib/engineering/mcp-exposure.ts");
    expect(rule).toContain('facts.bindingStatus === "bound-external-read"');
    expect(rule).toContain('facts.requiredAuthority.includes("external-mcp-observation")');
    for (const role of STORED_ROLES) expect(servedFor[role], role).not.toContain("sirkit.mcp.observation-read");

    const bodies = new Set<string>();
    for (const role of STORED_ROLES) {
      resetSpies();
      const answer = await post(callRpc("sirkit.mcp.observation-read"), await tokenFor({ user: USER_OF[role] }));
      expect(answer.status, role).toBe(200);
      expect(answer.body.error, role).toEqual({ code: MCP_JSON_RPC_ERROR_CODES.INVALID_PARAMS, message: MCP_JSON_RPC_MESSAGES.UNKNOWN_TOOL });
      expect(spyTotal(), role).toBe(0);
      bodies.add(shapeOf(answer.body));
    }
    expect(bodies.size).toBe(1);
  });

  it("E1c. the durable-write spies are LIVE and the read-only view is what protects the store: the repository's method list is classified in full by NAME, a write attempted on the spied repository moves workflowWrite, a write asked of the spied VIEW moves viewWrite and is refused DW_READ_ONLY_VIEW without ever reaching the repository, and a read through the view reaches both layers", async () => {
    // [B20 D review] regressions-2: a counter that cannot move by construction proves nothing. This case moves each one.
    // the classification is TOTAL over the repository's own prototype, so a new method is a deliberate edit here
    const methods = Object.getOwnPropertyNames(InMemoryDurableWorkflowRepository.prototype).filter((name) => name !== "constructor").sort();
    expect(methods).toEqual([...WORKFLOW_WRITE_METHODS, ...WORKFLOW_READ_METHODS].sort());
    expect([...WORKFLOW_WRITE_METHODS].some((name) => WORKFLOW_READ_METHODS.has(name))).toBe(false);
    // the four mutating methods are exactly the ones the read-only view refuses without delegating
    const view = read("app/lib/engineering/durable-read-bundle.ts");
    for (const name of WORKFLOW_WRITE_METHODS) expect(view, name).toContain(`${name}: readOnlyRefusal,`);

    resetSpies();
    const lease = { workerId: "worker-d2", now: new Date(T0).toISOString(), leaseUntil: new Date(T0 + 1_000).toISOString(), limit: 1 };
    // (i) a write attempted DIRECTLY on the spied repository is counted as a write (the old prefix classifier read it as a read)
    await workflow.claimOutbox(lease);
    expect(spies.workflowWrite).toBe(1);
    expect(spies.workflowRead).toBe(0);
    expect(spies.unclassified).toEqual([]);
    // (ii) the same write asked of the VIEW is counted there, refused, and never reaches the repository
    const readOnly = spiedView(readOnlyDurableWorkflow(workflow));
    await expect(readOnly.claimOutbox(lease)).rejects.toThrow(DURABLE_READ_ONLY_VIEW_ERROR);
    expect(spies.viewWrite).toBe(1);
    expect(spies.workflowWrite).toBe(1); // unchanged: the view did not delegate
    for (const name of ["commit", "completeOutbox", "failOutbox"] as const) {
      await expect((readOnly as unknown as Record<string, (input: unknown) => Promise<unknown>>)[name]!({})).rejects.toThrow(DURABLE_READ_ONLY_VIEW_ERROR);
    }
    expect(spies.viewWrite).toBe(4);
    expect(spies.workflowWrite).toBe(1);
    // (iii) a read through the view reaches both layers
    await readOnly.listHeads({ aggregateType: "d2-probe", scope: { ...FIXTURE_SCOPE } });
    expect(spies.viewRead).toBe(1);
    expect(spies.workflowRead).toBe(1);
  });

  it("E2. the sweep, PARTITIONED (DEC-5): every descriptor x every mapped role through POST /api/mcp — the unknown-tool answers are ONE identical body with no data and every spy 0; the served reads are asserted separately and DO read the board; the trace holds one record per request and never not_served; no response is 429 (composes b20-b3-mcp-tools-call-reads: \"2. role parity over 9 reads × 5 roles: the MCP read succeeds exactly when the native read succeeds for the mapped role; a role-filtered call is B2's identical -32602\" and b20-b4-withhold-proposals: \"5. listed means served (ratchet)\")", { timeout: 600_000 }, async () => {
    // DEC-1 / DEC-2: the committed B and C titles D2 composes over are bound by TITLE STRING
    expect(read(B3_SUITE)).toContain("2. role parity over 9 reads × 5 roles: the MCP read succeeds exactly when the native read succeeds for the mapped role; a role-filtered call is B2's identical -32602");
    expect(read(B4_SUITE)).toContain("5. listed means served (ratchet)");

    const { descriptors, servedFor } = population();
    const tokens: Record<string, string> = {};
    for (const role of STORED_ROLES) tokens[role] = await tokenFor({ user: USER_OF[role] });
    // every request carries the caller's own current pin: a non-exempt read without one refuses `revision_required` at
    // step 4, before the durable board is loaded at step 9, and Partition B would then prove nothing about the board
    const currentRevision = revisionOf(board);

    interface Row { role: MembershipRole; toolId: string; served: boolean; answer: Answer; spies: typeof spies }
    const rows: Row[] = [];
    for (const role of STORED_ROLES) {
      for (const toolId of descriptors) {
        resetSpies();
        const answer = await post(callRpc(toolId, argsFor(toolId), pin(currentRevision)), tokens[role]!);
        rows.push({ role, toolId, served: servedFor[role].includes(toolId), answer, spies: { ...spies } });
      }
    }

    // the population, derived: 42 x 5 today, of which the served listing is nine for four roles and seven for the commenter
    expect(rows.length).toBe(descriptors.length * STORED_ROLES.length);
    const partitionA = rows.filter((row) => !row.served);
    const partitionB = rows.filter((row) => row.served);
    expect(partitionB.length).toBe(STORED_ROLES.reduce((sum, role) => sum + servedFor[role].length, 0));
    expect(partitionA.length + partitionB.length).toBe(rows.length);

    // the tripwire that proves the limiter mitigation held: a silent 429 reads exactly like the refusal A asserts
    expect(rows.filter((row) => row.answer.status === 429)).toEqual([]);

    // Partition A — the unknown-tool answers
    const shapes = new Set(partitionA.map((row) => shapeOf(row.answer.body)));
    expect(shapes.size).toBe(1);
    for (const row of partitionA) {
      const label = `${row.role}/${row.toolId}`;
      expect(row.answer.status, label).toBe(200);
      expect(row.answer.body.error, label).toEqual({ code: MCP_JSON_RPC_ERROR_CODES.INVALID_PARAMS, message: MCP_JSON_RPC_MESSAGES.UNKNOWN_TOOL });
      expect(Object.hasOwn(row.answer.body.error as object, "data"), label).toBe(false);
      expect((row.answer.body as { id?: unknown }).id, label).toBe(1);
      expect(row.answer.body.result, label).toBeUndefined();
      expect(spySum(row.spies), label).toBe(0);
    }

    // Partition B — the served reads
    for (const row of partitionB) {
      const label = `${row.role}/${row.toolId}`;
      expect(row.answer.status, label).toBe(200);
      expect(row.answer.body.result, label).toBeDefined();
      expect(refusalOf(row.answer.body), label).toBe(""); // the FLOOR: every served read, pinned and with its own arguments, really is served
      expect(row.spies.boardRead, label).toBeGreaterThan(0); // by design: step 9 loads the durable board before step 10 judges the pin
      // no write was asked of the read-only view, and none reached the repository (E1c proves both counters can move)
      expect(row.spies.viewWrite, label).toBe(0);
      expect(row.spies.workflowWrite, label).toBe(0);
      expect(row.spies.unclassified, label).toEqual([]);
    }

    // the trace, across both partitions
    const ring = traces();
    expect(ring.length).toBe(rows.length);
    const outcomes = new Set(ring.map((record) => record.outcome));
    expect([...outcomes].every((outcome) => (MCP_SERVER_TRACE_OUTCOMES as readonly string[]).includes(outcome))).toBe(true);
    expect(outcomes.has("not_served")).toBe(false);
    let servedOutcomes = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const record = ring[index]!;
      const label = `${row.role}/${row.toolId}`;
      if (row.served) {
        expect(record.outcome, label).toBe("read_served");
        expect(record.toolId, label).toBe(row.toolId);
        servedOutcomes += 1;
      } else {
        expect(record.outcome, label).toBe("unknown_tool");
        expect(record.toolId, label).toBeNull();
      }
    }
    expect(servedOutcomes).toBe(partitionB.length); // a post-check forced to "changed" would turn every served row into read_refused and fail here
    expect(dbCalls.getDb + dbCalls.getSqlClient).toBe(0);
  });

  it("E3. by exclusion reason, over exactly the reasons that CAN carry an id: each group answers Partition A's single refusal under every role, and a group that comes back empty is a stop rather than a skipped loop", async () => {
    const { report } = population();
    // derived from the landed classification; the four documented-empty reasons are E1's and are not iterated here
    const groups = MCP_EXCLUSION_REASONS.map((reason) => ({ reason, ids: report.excludedByReason[reason] })).filter((group) => group.ids.length > 0);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.map((group) => group.reason).sort()).toEqual(["external_read", "granted_execution", "never_exposed", "not_agent_exposed", "tier3", "view_session", "view_state_read", "withheld"]);

    const bodies = new Set<string>();
    for (const group of groups) {
      expect(group.ids.length, group.reason).toBeGreaterThan(0);
      for (const toolId of group.ids) {
        for (const role of STORED_ROLES) {
          resetSpies();
          const answer = await post(callRpc(toolId), await tokenFor({ user: USER_OF[role] }));
          expect(answer.status, `${group.reason}/${toolId}/${role}`).toBe(200);
          expect(answer.body.error, `${group.reason}/${toolId}/${role}`).toEqual({ code: MCP_JSON_RPC_ERROR_CODES.INVALID_PARAMS, message: MCP_JSON_RPC_MESSAGES.UNKNOWN_TOOL });
          expect(spyTotal(), `${group.reason}/${toolId}/${role}`).toBe(0);
          bodies.add(shapeOf(answer.body));
        }
      }
    }
    expect(bodies.size).toBe(1);
  });

  it("E4. cross-project scope over all served reads: with boards published for another project and another tenant but NONE for the caller, every served read answers no_durable_board and every scope the board reader was asked for is the caller's own; and only when the caller HAS its own board does a foreign project's revision give stale_revision naming the caller's own (composes b20-b3-mcp-tools-call-reads: \"5. another tenant, project or branch reads no_durable_board, and every durable read stays in the token's scope\")", async () => {
    expect(read(B3_SUITE)).toContain("5. another tenant, project or branch reads no_durable_board, and every durable read stays in the token's scope");
    const { report } = population();
    const own: ReadScope = { tenantId: FIXTURE_SCOPE.tenantId, projectId: FIXTURE_SCOPE.projectId, branchId: FIXTURE_SCOPE.branchId };
    // (a) boards elsewhere, none for the caller — step 9 (the durable board) precedes step 10 (the pin), so the answer is
    // no_durable_board whatever revision is pinned
    const empty = new InMemoryDurableWorkflowRepository();
    await publishDurableBoard(empty, { ...FIXTURE_SCOPE, projectId: "proj-other" }, durableBoardFixture());
    await publishDurableBoard(empty, { ...FIXTURE_SCOPE, tenantId: "tenant-other" }, durableBoardFixture());
    workflow = spiedWorkflow(empty);
    setMcpReadDependenciesFactory(() => spiedReadDeps());
    const token = await tokenFor({ user: USER_OF.admin });
    for (const toolId of report.actual) {
      resetSpies();
      const answer = await post(callRpc(toolId, argsFor(toolId), pin(revisionOf(board))), token);
      expect(answer.status, toolId).toBe(200);
      expect(refusalOf(answer.body), toolId).toBe("no_durable_board");
      expect(spies.boardRead, toolId).toBeGreaterThan(0);
      // measured on the ARGUMENT: every scope the reader was asked for is the token's own, never the other project's or tenant's
      expect(spies.scopes.length, toolId).toBe(spies.boardRead);
      for (const scope of spies.scopes) expect(scope, toolId).toEqual(own);
      expect(spies.viewWrite + spies.workflowWrite, toolId).toBe(0);
      expect(JSON.stringify(answer.body).includes("proj-other"), toolId).toBe(false);
      expect(JSON.stringify(answer.body).includes("tenant-other"), toolId).toBe(false);
    }

    // (b) the caller has its own board: only now can a pin be judged, and a foreign revision is stale_revision naming the
    // caller's OWN current revision
    const mine = new InMemoryDurableWorkflowRepository();
    await publishDurableBoard(mine, FIXTURE_SCOPE, board);
    const otherBoard = durableBoardFixture({ variant: 3 });
    const otherRevision = revisionOf(otherBoard);
    expect(otherRevision).not.toBe(revisionOf(board));
    workflow = spiedWorkflow(mine);
    setMcpReadDependenciesFactory(() => spiedReadDeps());
    const nonExempt = report.actual.filter((id) => !(MCP_READ_EXEMPT_TOOL_IDS as readonly string[]).includes(id));
    expect(nonExempt.length).toBeGreaterThan(0);
    for (const toolId of nonExempt) {
      const answer = await post(callRpc(toolId, argsFor(toolId), pin(otherRevision)), token);
      expect(refusalOf(answer.body), toolId).toBe("stale_revision");
      expect(currentRevisionOf(answer.body), toolId).toBe(revisionOf(board));
      expect(JSON.stringify(answer.body).includes(otherRevision), toolId).toBe(false);
    }
  });

  it("E5. stale revision over all served reads: a pin one revision behind is stale_revision with the caller's own current revision and the board loaded ONCE (the post-check and the membership re-read never ran), no pin on a non-exempt read is revision_required with NO board loaded, and the two exempt reads SUCCEED without a pin — an isError false result, the board loaded twice, the membership re-read once (composes b20-b3-mcp-tools-call-reads: \"3. revision parity: a wrong pin is stale_revision natively and over MCP; the right pin succeeds with equal outputs; no pin on a non-exempt read is revision_required\")", async () => {
    expect(read(B3_SUITE)).toContain("3. revision parity: a wrong pin is stale_revision natively and over MCP; the right pin succeeds with equal outputs; no pin on a non-exempt read is revision_required");
    const { report } = population();
    const token = await tokenFor({ user: USER_OF.admin });
    const behind = revisionOf(durableBoardFixture({ variant: 5 }));
    const exempt = new Set<string>(MCP_READ_EXEMPT_TOOL_IDS);

    for (const toolId of report.actual) {
      resetSpies();
      const stale = await post(callRpc(toolId, argsFor(toolId), pin(behind)), token);
      expect(refusalOf(stale.body), `${toolId} stale`).toBe("stale_revision");
      expect(currentRevisionOf(stale.body), `${toolId} stale`).toBe(revisionOf(board));
      // step 10 stops it: the board was loaded once (step 9) and never post-checked (step 14 loads it again), and the
      // membership was never re-read (step 15) — measured on the spies, not inferred
      expect(spies.boardRead, `${toolId} stale`).toBe(1);
      expect(spies.membership, `${toolId} stale`).toBe(0);

      resetSpies();
      const unpinned = await post(callRpc(toolId, argsFor(toolId)), token);
      if (exempt.has(toolId)) {
        expect(refusalOf(unpinned.body), `${toolId} unpinned`).toBe("");
        expect((unpinned.body.result as { isError?: unknown }).isError, `${toolId} unpinned`).toBe(false);
        expect(spies.boardRead, `${toolId} unpinned`).toBe(2); // the load and the post-check
        expect(spies.membership, `${toolId} unpinned`).toBe(1); // re-read exactly once, after the read
      } else {
        expect(refusalOf(unpinned.body), `${toolId} unpinned`).toBe("revision_required");
        expect(spies.boardRead, `${toolId} unpinned`).toBe(0); // step 4 precedes step 9: nothing durable was touched
        expect(spies.membership, `${toolId} unpinned`).toBe(0);
      }
    }
  });

  it("E6. a foreign tenant's board is never read: the durable repository holds tenant-other's board only, and every served read a tenant-local token asks for answers no_durable_board, asks the reader for the token's own scope only, and carries nothing of the other tenant (composes b20-b3-mcp-tools-call-reads: \"5. another tenant, project or branch reads no_durable_board, and every durable read stays in the token's scope\")", async () => {
    expect(read(B3_SUITE)).toContain("5. another tenant, project or branch reads no_durable_board, and every durable read stays in the token's scope");
    const { report } = population();
    const foreign = new InMemoryDurableWorkflowRepository();
    await publishDurableBoard(foreign, { ...FIXTURE_SCOPE, tenantId: "tenant-other" }, durableBoardFixture({ variant: 7 }));
    workflow = spiedWorkflow(foreign);
    setMcpReadDependenciesFactory(() => spiedReadDeps());
    const token = await tokenFor({ user: USER_OF.admin });
    for (const toolId of report.actual) {
      resetSpies();
      const answer = await post(callRpc(toolId, argsFor(toolId), pin(revisionOf(board))), token);
      expect(refusalOf(answer.body), toolId).toBe("no_durable_board");
      expect(spies.scopes.length, toolId).toBeGreaterThan(0);
      for (const scope of spies.scopes) expect(scope.tenantId, toolId).toBe(FIXTURE_SCOPE.tenantId);
      expect(spies.viewWrite + spies.workflowWrite, toolId).toBe(0);
      expect(answer.text.includes("tenant-other"), toolId).toBe(false);
    }
  });

  it("E7. membership, and the challenge as the NO-ORACLE proof: a membership revoked before the request, one whose version changed, one whose ROLE moved after the mint and a plainly bad token give a byte-identical 401 with a byte-identical WWW-Authenticate; a stored role outside the map, set BEFORE the mint so the wrapper reaches the role map, is 403 AUTH_ROLE_UNMAPPED with no challenge and every spy 0; and automation and migration_admin are unreachable", async () => {
    const stale = await tokenFor({ user: USER_OF.viewer });

    // (a) revoked BEFORE the request
    member("viewer", { user: USER_OF.viewer, state: "revoked" });
    resetSpies();
    const revoked = await post(callRpc("sirkit.pcb.board-inspect"), stale);
    expect(revoked.status).toBe(401);
    expect(spyTotal()).toBe(0);

    // (c) the version moved, so the token's membership revision no longer matches the live record
    member("viewer", { user: USER_OF.viewer, state: "active", version: 9 });
    const moved = await post(callRpc("sirkit.pcb.board-inspect"), stale);
    expect(moved.status).toBe(401);

    // a plainly bad token
    const forged = `${stale.slice(0, stale.lastIndexOf(".") + 1)}${"A".repeat(20)}`;
    const bad = await post(callRpc("sirkit.pcb.board-inspect"), forged);
    expect(bad.status).toBe(401);

    // the no-oracle property lives ONLY on the header, and it holds there
    expect(new Set([revoked.headers["www-authenticate"], moved.headers["www-authenticate"], bad.headers["www-authenticate"]]).size).toBe(1);
    expect(new Set([revoked.text, moved.text, bad.text]).size).toBe(1);

    // (d) a stored role outside the map, set BEFORE the mint: the token's revision then matches the live record (the
    // revision digests the role), so the wrapper passes its revision check and REACHES the role map — 403 AUTH_ROLE_UNMAPPED,
    // no challenge (it is not a token refusal), every spy 0. [B20 D review] tests-04: minting first and moving the role
    // after would be refused at the revision check as a 401 and never exercise this branch.
    const unmappedUser = "user-d2-unmapped";
    repo.set({ tenantId: FIXTURE_SCOPE.tenantId, projectId: FIXTURE_SCOPE.projectId, userId: unmappedUser, role: "owner" as MembershipRole, state: "active", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "test" });
    const unmappedToken = await tokenFor({ user: unmappedUser });
    resetSpies();
    const unmapped = await post(callRpc("sirkit.pcb.board-inspect"), unmappedToken);
    expect(unmapped.status).toBe(403);
    expect(unmapped.body).toMatchObject({ ok: false, code: "AUTH_ROLE_UNMAPPED" });
    expect(unmapped.headers["www-authenticate"]).toBeUndefined();
    expect(spyTotal()).toBe(0);
    const mapped = new Set<ProjectRole>(Object.values(PROJECT_ROLE_FROM_MEMBERSHIP));
    expect(mapped.has("automation" as ProjectRole)).toBe(false);
    expect(mapped.has("migration_admin" as ProjectRole)).toBe(false);

    // (e) and a role that moves AFTER the mint is the token refusal — byte-identical to (a), (c) and the forged token
    member("viewer", { user: unmappedUser });
    resetSpies();
    const roleMoved = await post(callRpc("sirkit.pcb.board-inspect"), unmappedToken);
    expect(roleMoved.status).toBe(401);
    expect(roleMoved.text).toBe(revoked.text);
    expect(roleMoved.headers["www-authenticate"]).toBe(revoked.headers["www-authenticate"]);
    expect(spyTotal()).toBe(0);
  });

  it("E7b. a membership revoked DURING the read, swept over every read the admin's listing serves: each answers membership_changed with the result DISCARDED — an isError result with no output and no structuredContent — after the board was loaded and post-checked and the live membership re-read exactly once; and the NEXT request with the same token is the wrapper's identical 401 (composes b20-b3-mcp-tools-call-reads: \"9. a membership revoked during the read is membership_changed; the next request is 401 invalid_token\")", async () => {
    expect(read(B3_SUITE)).toContain("9. a membership revoked during the read is membership_changed; the next request is 401 invalid_token");
    const { servedFor } = population();
    const served = servedFor.admin;
    expect(served.length).toBeGreaterThan(0);
    const token = await tokenFor({ user: USER_OF.admin });
    const reference = await post(callRpc("sirkit.pcb.board-inspect"), `${token.slice(0, token.lastIndexOf(".") + 1)}${"C".repeat(20)}`);
    expect(reference.status).toBe(401);
    // the revocation lands INSIDE the read — after the board load (step 9), inside the B05 invocation (step 12), before the
    // membership re-read (step 15) — exactly as B3 case 9 plants it for one read; here it is swept over every served read
    setMcpReadInvokerFactory((registry) => {
      const service = new ReadToolInvocationService(registry);
      return { invoke: async (...args) => { member("admin", { user: USER_OF.admin, state: "revoked" }); return service.invoke(...args); } };
    });
    for (const toolId of served) {
      member("admin", { user: USER_OF.admin }); // active again at the token's own revision (role, state and version as minted)
      resetSpies();
      const during = await post(callRpc(toolId, argsFor(toolId), pin(revisionOf(board))), token);
      expect(during.status, toolId).toBe(200);
      expect(refusalOf(during.body), toolId).toBe("membership_changed");
      const result = during.body.result as { isError?: unknown; content?: Array<{ text?: string }>; structuredContent?: unknown };
      expect(result.isError, toolId).toBe(true);
      expect(result.structuredContent, toolId).toBeUndefined();
      const text = JSON.parse(result.content?.[0]?.text ?? "{}") as Record<string, unknown>;
      expect(text.ok, toolId).toBe(false);
      expect(text.status, toolId).toBe("membership_changed");
      expect(Object.hasOwn(text, "output"), toolId).toBe(false);
      expect(spies.boardRead, toolId).toBe(2); // the load and the post-check both ran: the read itself completed
      expect(spies.membership, toolId).toBe(1); // and the live re-read is what discarded it
      expect(traces().at(-1)?.outcome, toolId).toBe("read_refused");
      // the next request with the same token: the live membership is revoked, so the wrapper's identical 401
      const next = await post(callRpc(toolId, argsFor(toolId), pin(revisionOf(board))), token);
      expect(next.status, toolId).toBe(401);
      expect(next.text, toolId).toBe(reference.text);
      expect(next.headers["www-authenticate"], toolId).toBe(reference.headers["www-authenticate"]);
    }
  });

  it("E8. tampered tokens, at BOTH layers: every claim altered under the ORIGINAL signature, a non-pinned header (including alg none), an extra claim, a __proto__ claim, a truncated signature and another token's signature are refused before the payload is read; and a payload RE-SIGNED with the fixture secret carrying a wrong audience, issuer, scope, subject, project, tenant, membership revision or an over-long lifetime, plus one re-signed with ANOTHER secret (the fixture secret plus a suffix, 50 bytes), reach the claim checks — each is the identical 401 with the identical body and challenge, the verifier's own verdict per shape is pinned, every spy 0, and (the RECORDED LIMIT) the request trace holds no record of any of them", async () => {
    const token = await tokenFor({ user: USER_OF.editor });
    const [header, payload, signature] = token.split(".") as [string, string, string];
    const decode = (segment: string): Record<string, unknown> => JSON.parse(Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const claims = decode(payload);
    const claimNames = Object.keys(claims);
    expect(claimNames.length).toBeGreaterThanOrEqual(8);

    const others = await tokenFor({ user: USER_OF.viewer });
    // [B20 D review] security-8: a claim altered under the original signature never reaches the claim checks (the header
    // bytes and the constant-time signature are judged first). These shapes are RE-SIGNED with the fixture secret — the
    // same HMAC the module computes — so the claim checks are what refuse them; `verdict` names which layer did.
    const sign = (head: string, body: string, secret: string): string => createHmac("sha256", Buffer.from(secret, "utf8")).update(`${head}.${body}`, "ascii").digest("base64url");
    const resigned = (name: string, mutate: Record<string, unknown>, verdict: string): { name: string; token: string; verdict: string } => {
      const body = encode({ ...claims, ...mutate });
      return { name, token: `${header}.${body}.${sign(header, body, SECRET)}`, verdict };
    };
    const signedTampers = [
      resigned("aud re-signed", { aud: `${String(claims.aud)}-x` }, "wrong_audience"),
      resigned("iss re-signed", { iss: `${String(claims.iss)}-x` }, "wrong_issuer"),
      resigned("scope re-signed", { scope: "sirkit.mcp.admin" }, "claims_invalid"),
      resigned("exp past the lifetime, re-signed", { exp: Number(claims.exp) + MCP_TOKEN_LIFETIME_S + 1 }, "lifetime_exceeded"),
      // the verifier accepts these three (every claim is well formed); the WRAPPER refuses them on the live membership
      resigned("sub re-signed (nobody)", { sub: "user-d2-nobody" }, "ok"),
      resigned("sirkit_project re-signed", { sirkit_project: "proj-second" }, "ok"),
      resigned("sirkit_tenant re-signed", { sirkit_tenant: "tenant-other" }, "ok"),
      resigned("sirkit_mbr re-signed (a well-formed, wrong revision)", { sirkit_mbr: `mbr1-${"0".repeat(16)}` }, "ok"),
      { name: "re-signed with ANOTHER secret (the fixture secret plus a suffix, 50 bytes)", token: `${header}.${payload}.${sign(header, payload, `${SECRET}-other`)}`, verdict: "bad_signature" },
    ];
    const tampered: Array<{ name: string; token: string; verdict: string }> = [
      ...claimNames.map((name) => ({ name: `claim ${name} under the original signature`, token: `${header}.${encode({ ...claims, [name]: typeof claims[name] === "number" ? Number(claims[name]) + 1 : `${String(claims[name])}-x` })}.${signature}`, verdict: "bad_signature" })),
      { name: "a twelfth claim", token: `${header}.${encode({ ...claims, injected: "x" })}.${signature}`, verdict: "bad_signature" },
      { name: "a __proto__ claim", token: `${header}.${encode({ ...claims, ["__proto__"]: { role: "project_admin" } })}.${signature}`, verdict: "bad_signature" },
      { name: "alg none", token: `${encode({ alg: "none", typ: "JWT" })}.${payload}.${signature}`, verdict: "unsupported_algorithm" },
      { name: "another header", token: `${encode({ alg: "HS512", typ: "JWT" })}.${payload}.${signature}`, verdict: "unsupported_algorithm" },
      { name: "a truncated signature", token: `${header}.${payload}.${signature.slice(0, 8)}`, verdict: "bad_signature" },
      { name: "another token's signature", token: `${header}.${payload}.${others.split(".")[2]}`, verdict: "bad_signature" },
      ...signedTampers,
    ];
    expect(tampered.length).toBe(claimNames.length + 6 + signedTampers.length);
    // the verifier's own verdict, so a re-signed shape provably reaches the claim checks and is not a signature refusal
    const expectation = { audience: `${ORIGIN}/api/mcp`, issuer: ORIGIN, nowMs: now };
    for (const entry of tampered) {
      const verified = verifyMcpAccessToken(entry.token, expectation, process.env);
      expect(verified.ok ? "ok" : verified.reason, entry.name).toBe(entry.verdict);
    }
    expect(verifyMcpAccessToken(token, expectation, process.env).ok).toBe(true);

    const before = traces().length;
    const bodies = new Set<string>();
    const challenges = new Set<string>();
    for (const entry of tampered) {
      resetSpies();
      const answer = await post(callRpc("sirkit.pcb.board-inspect"), entry.token);
      expect(answer.status, entry.name).toBe(401);
      expect(spyTotal(), entry.name).toBe(0);
      bodies.add(answer.text);
      challenges.add(answer.headers["www-authenticate"] ?? "");
    }
    expect(bodies.size).toBe(1);
    expect(challenges.size).toBe(1);

    // THE RECORDED LIMIT, never phrased as a security property: `app/lib/mcp/server/request-trace.ts` states that refusals
    // of the wrapper, BEFORE the dispatch runs, are not traced. What compensates is the endpoint limiter (120 per 60 s per
    // tenant/project/subject), which is why a forged-token flood cannot be unbounded.
    expect(traces().length).toBe(before);
    expect(read("app/lib/mcp/server/request-trace.ts")).toContain("Refusals of the wrapper, before the dispatch runs, are not traced (a recorded limit).");
    expect(read("app/lib/mcp/server/inbound-limits.ts")).toContain("limit: 120");
  });

  it("E9. token replay, the server half, each presentation IN ISOLATION so no leftover masks another: (a) the same valid token after its membership revision moves; (b) a token whose subject now belongs to ANOTHER project only; (c) a fresh token after it expires on the injected clock, with the membership untouched — each is the identical 401 with the identical challenge, indistinguishable from a forged token; and (b') a Sirkit MCP token cannot be PRESENTED against a second project at all: scope is a claim, every selector a request could carry is ignored, and the served read stays in the token's own scope", async () => {
    const REVISION_READ = "sirkit.project.canonical-revision-inspect"; // pin-exempt, so a bare call is a served read
    const forgedOf = (token: string): string => `${token.slice(0, token.lastIndexOf(".") + 1)}${"B".repeat(20)}`;

    // (a) the membership revision moves under the SAME token — and nothing else does
    const tokenA = await tokenFor({ user: USER_OF.editor });
    expect((await post(callRpc(REVISION_READ), tokenA)).status).toBe(200);
    member("editor", { user: USER_OF.editor, version: 7 });
    const replayed = await post(callRpc(REVISION_READ), tokenA);
    member("editor", { user: USER_OF.editor }); // restored exactly: the token is valid again, so (a) was the version alone
    expect((await post(callRpc(REVISION_READ), tokenA)).status).toBe(200);

    // (b) the subject now belongs to another project ONLY: the token's own project has no active membership left
    const tokenB = await tokenFor({ user: USER_OF.reviewer });
    expect((await post(callRpc(REVISION_READ), tokenB)).status).toBe(200);
    member("reviewer", { user: USER_OF.reviewer, state: "revoked" });
    member("reviewer", { user: USER_OF.reviewer, projectId: "proj-second" });
    const elsewhere = await post(callRpc(REVISION_READ), tokenB);
    member("reviewer", { user: USER_OF.reviewer });

    // (c) expiry ALONE: a fresh token, the membership never moves, the injected clock passes the lifetime
    const tokenC = await tokenFor({ user: USER_OF.viewer });
    expect((await post(callRpc(REVISION_READ), tokenC)).status).toBe(200);
    now = T0 + (MCP_TOKEN_LIFETIME_S + 1) * 1_000;
    const expired = await post(callRpc(REVISION_READ), tokenC);
    now = T0;
    expect((await post(callRpc(REVISION_READ), tokenC)).status).toBe(200); // valid again on the frozen clock: the clock was the only cause

    const forged = await post(callRpc(REVISION_READ), forgedOf(tokenA));
    const answers = { replayed, elsewhere, expired, forged };
    for (const [name, answer] of Object.entries(answers)) expect(answer.status, name).toBe(401);
    expect(new Set(Object.values(answers).map((answer) => answer.text)).size).toBe(1);
    expect(new Set(Object.values(answers).map((answer) => answer.headers["www-authenticate"])).size).toBe(1);

    // (b') the STRUCTURAL fact behind "presented against a second project": the endpoint derives tenant, project and subject
    // from the token's claims and reads no selector — not a header, not a body scope. A fresh token, the subject a member of
    // proj-second too and proj-second's board published, every selector steering there: the read is served for the TOKEN's
    // project, the reader is asked for that scope only, and nothing of proj-second's board is in the answer.
    const secondBoard = durableBoardFixture({ variant: 2 });
    expect(revisionOf(secondBoard)).not.toBe(revisionOf(board));
    await publishDurableBoard(workflow, { ...FIXTURE_SCOPE, projectId: "proj-second" }, secondBoard);
    member("editor", { user: USER_OF.editor, projectId: "proj-second" });
    const fresh = await tokenFor({ user: USER_OF.editor });
    const message = callRpc("sirkit.pcb.board-inspect", {}, pin(revisionOf(board)));
    const params = message.params as Record<string, unknown>;
    params.scope = { tenantId: "tenant-other", projectId: "proj-second", branchId: "other" };
    params.projectId = "proj-second";
    resetSpies();
    const steered = await post(message, fresh, { headers: { "x-sirkit-tenant-id": "tenant-other", "x-sirkit-project-id": "proj-second", "x-sirkit-branch-id": "other" } });
    expect(steered.status).toBe(200);
    expect(refusalOf(steered.body)).toBe("");
    const record = traces().at(-1)!;
    expect(record.outcome).toBe("read_served");
    expect(record.principal.tenantId).toBe(FIXTURE_SCOPE.tenantId);
    expect(record.principal.projectId).toBe(FIXTURE_SCOPE.projectId);
    expect(spies.scopes.length).toBeGreaterThan(0);
    for (const scope of spies.scopes) expect(scope).toEqual({ tenantId: FIXTURE_SCOPE.tenantId, projectId: FIXTURE_SCOPE.projectId, branchId: FIXTURE_SCOPE.branchId });
    expect(steered.text.includes(revisionOf(board))).toBe(true);
    expect(steered.text.includes(revisionOf(secondBoard))).toBe(false);
    expect(steered.text.includes("proj-second")).toBe(false);
    expect(steered.text.includes("tenant-other")).toBe(false);
    // and the wrapper's source reads the membership from the CLAIMS alone: no selector header and no body scope is read
    // anywhere in `mcpBearerJsonRoute` (the last function of the file, so its body runs to the end)
    const source = read("app/lib/auth/route-handlers.ts");
    const start = source.indexOf("export function mcpBearerJsonRoute(");
    expect(start).toBeGreaterThan(0);
    const wrapper = source.slice(start);
    expect(wrapper).toContain("memberships.loadActiveMembership({ tenantId: claims.tenantId, projectId: claims.projectId, userId: claims.subject })");
    for (const selector of ["x-sirkit-tenant-id", "x-sirkit-project-id", "x-sirkit-branch-id", "params.scope", "params.projectId"]) expect(wrapper.includes(selector), selector).toBe(false);
  });

  it("E10. the withheld set answers exactly as the never-exposed set: all withheld ids under all mapped roles, and sirkit.manufacturing.release, give one byte-identical body — none of them carries an id at all (composes b20-b3-mcp-tools-call-reads: \"7. the withheld reads and sirkit.manufacturing.release answer the identical -32602\" and \"8. all five proposals, withheld since B4, answer B2's identical -32602 and read nothing\")", async () => {
    expect(read(B3_SUITE)).toContain("7. the withheld reads and sirkit.manufacturing.release answer the identical -32602");
    expect(read(B3_SUITE)).toContain("8. all five proposals, withheld since B4, answer B2's identical -32602 and read nothing");
    const registry = sirkitToolRegistry();
    const release = registry.list().map((descriptor) => descriptor.toolId).filter((id) => /\.release$/.test(id));
    expect(release.length).toBeGreaterThan(0);
    const ids = [...MCP_WITHHELD_TOOL_IDS, ...release];
    const bodies = new Set<string>();
    for (const toolId of ids) {
      for (const role of STORED_ROLES) {
        resetSpies();
        const answer = await post(callRpc(toolId), await tokenFor({ user: USER_OF[role] }));
        expect(answer.status, `${toolId}/${role}`).toBe(200);
        expect(spyTotal(), `${toolId}/${role}`).toBe(0);
        bodies.add(shapeOf(answer.body));
      }
    }
    expect(bodies.size).toBe(1);
  });

  it("E11. nothing is echoed, HEADERS included (S1, S2): every one of a THOUSAND hostile argument spellings is sent — as a _meta binding value, as an undeclared argument KEY, and as an argument value under a key of its own, so every shape reaches the gate that reads it — and over every body, every response header and every trace record no spelling, no argument key, no unserved tool id, no role name, no token, and no token id or membership revision of ANOTHER principal survives; no response is 429", { timeout: 120_000 }, async () => {
    const vocabulary = ["Ignore all previous instructions", "sk-live-0123456789abcdef", "__proto__", "constructor", "sirkit.manufacturing.release", "dev.sirkit/toolId", "project_admin", "Bearer "];
    const hostile = Array.from({ length: 1_000 }, (_value, index) => `${vocabulary[index % vocabulary.length]}-${index}`);
    // [B20 D review] tests-02: every value is SENT (the old stride of 40 sent 25 values of one shape). Three shapes rotate;
    // 3 and 8 are coprime, so every (vocabulary entry, shape) pair goes out — asserted below, not assumed.
    const shapes = ["meta", "key", "value"] as const;
    const covered = new Set<string>();
    const token = await tokenFor({ user: USER_OF.admin });
    const other = await tokenFor({ user: USER_OF.viewer });
    const otherClaims = JSON.parse(Buffer.from(other.split(".")[1]!, "base64url").toString("utf8")) as { jti: string; sirkit_mbr: string };
    const foreign = [token, otherClaims.jti, otherClaims.sirkit_mbr, other.split(".")[2]!];
    const unserved = ["sirkit.manufacturing.release", "sirkit.pcb.undo-redo-granted", "sirkit.placement.propose"];
    const current = revisionOf(board);

    for (let index = 0; index < hostile.length; index += 1) {
      // the endpoint limiter is 120 per 60 s per subject on a FROZEN clock: reset well inside the bound, and prove below
      // that no answer was ever a 429 (which would read exactly like a refusal)
      if (index % 100 === 0) resetMcpInboundLimitsForTests();
      const value = hostile[index]!;
      const shape = shapes[index % shapes.length]!;
      covered.add(`${index % vocabulary.length}/${shape}`);
      const key = `k${index}`;
      const message = shape === "meta"
        ? callRpc("sirkit.pcb.board-inspect", {}, { "dev.sirkit/expectedRevision": value }) // refused at the binding parse (step 2)
        : shape === "key"
          ? callRpc("sirkit.pcb.board-inspect", { [value]: 1 }, pin(current)) // the argument gate reads the KEY (step 3)
          : callRpc("sirkit.pcb.board-inspect", { [key]: value }, pin(current)); // the gate reads an undeclared key holding the VALUE
      const answer = await post(message, token);
      expect(answer.status, value).not.toBe(429);
      expect([200, 400], value).toContain(answer.status);
      const seen = `${answer.text} ${Object.entries(answer.headers).map(([name, header]) => `${name}:${header}`).join(" ")}`;
      expect(seen.includes(value), value).toBe(false);
      if (shape === "value") expect(seen.includes(key), key).toBe(false);
      for (const literal of [...foreign, ...unserved, "project_admin"]) expect(seen.includes(literal), `${value}: ${literal}`).toBe(false);
    }
    expect(covered.size).toBe(vocabulary.length * shapes.length);

    // the trace ring holds exactly its capacity, all of them this case's requests, and none carries a spelling, a key, an
    // unserved id or another principal's token id, signature or membership revision (the CALLER's role and revision are the
    // trace's own principal fields and are not echoes)
    const ring = traces();
    expect(ring.length).toBe(MCP_SERVER_TRACE_RING_MAX);
    expect(ring.every((record) => record.method === "tools/call")).toBe(true);
    const written = JSON.stringify(ring);
    for (const value of hostile) expect(written.includes(value), value).toBe(false);
    for (let index = 0; index < hostile.length; index += 1) if (index % shapes.length === 2) expect(written.includes(`"k${index}"`), `k${index}`).toBe(false);
    for (const literal of [...foreign, ...unserved]) expect(written.includes(literal), literal).toBe(false);
  });

  it("E12. the trace records it: one sirkit.mcp-server-request.v1 record per handled request, every outcome in the closed list, toolId null on every Partition A refusal and the served id on every Partition B answer, a tokenIdDigest that matches a digest pattern and equals no token id, and authMethod mcp_bearer", async () => {
    const { report, servedFor } = population();
    const role: MembershipRole = "admin";
    const token = await tokenFor({ user: USER_OF[role] });
    const probe = [...report.actual.slice(0, 3), ...MCP_WITHHELD_TOOL_IDS.slice(0, 3)];
    const before = traces().length;
    for (const toolId of probe) await post(callRpc(toolId, argsFor(toolId), pin(revisionOf(board))), token);
    const written = traces().slice(before);
    expect(written.length).toBe(probe.length);
    for (let index = 0; index < probe.length; index += 1) {
      const record = written[index]!;
      const toolId = probe[index]!;
      expect(record.schema).toBe("sirkit.mcp-server-request.v1");
      expect(record.method).toBe("tools/call");
      expect(MCP_SERVER_TRACE_OUTCOMES as readonly string[], toolId).toContain(record.outcome);
      expect(record.toolId, toolId).toBe(servedFor[role].includes(toolId) ? toolId : null);
      expect(record.principal.authMethod).toBe("mcp_bearer");
      expect(record.principal.tokenIdDigest).toMatch(/^[a-z0-9]+[-:]?[0-9a-f]{8,}$/i);
      expect(token.includes(record.principal.tokenIdDigest)).toBe(false);
      expect(record.principal.role).toBe(PROJECT_ROLE_FROM_MEMBERSHIP[role]);
    }
  });

  it("E13. the page's D2 section states the sweep's derived counts, the partition, the spies, the recorded trace limit and the case it composes over; every citation resolves exactly once; and the stated case counts equal the suites' it( counts", () => {
    const page = read(PAGE);
    expect(page).toMatch(/^## D2\./m);
    const { descriptors, servedFor } = population();
    const served = STORED_ROLES.reduce((sum, role) => sum + servedFor[role].length, 0);
    const total = descriptors.length * STORED_ROLES.length;
    expect(page).toContain(`${total} requests`);
    expect(page).toContain(`${served} served reads`);
    expect(page).toContain(`${total - served} unknown-tool refusals`);
    for (const suite of [SUITE, "app/lib/mcp/server/__tests__/b20-d2-name-spellings.test.ts"]) {
      const cases = (read(suite).match(/^\s*it\(/gm) ?? []).length;
      expect(cases, suite).toBeGreaterThan(0);
      expect(page, suite).toContain(`| \`${suite}\` | ${cases} |`);
    }
    const citations = pageCitations(page);
    expect(citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}`)).toEqual([]);
    expect(page).toContain("OD-104");
    expect(page).toContain("not traced (a recorded limit)");
  });
});
