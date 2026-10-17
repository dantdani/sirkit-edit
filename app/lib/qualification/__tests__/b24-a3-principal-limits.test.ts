/**
 * [B24-A3] Part 2 (B24-A3b): the per-principal windows on authenticated spend (D24-8, OD-197; discovery section 8 item 8). Every
 * authenticated row that is provider credit or expensive - 40 at the A3a tree, `/api/chat` included - has one fixed window per
 * (method, path), keyed `[tenantId, projectId, principalId]` from the trusted context only: provider credit 60, expensive 50 and
 * `/api/chat` 60 requests per 60 s (the task proposed 10 and 20; existing suites and the browser job count more - abuse-controls.md
 * section 15). The window is taken in `authorizeRequest`'s authenticated branch after membership and role (so
 * before the media type and the body, for the 39 `authenticatedJsonRoute` rows), and in `agentStreamRoute` after `authorizeActor`
 * (chat reads its body first by design, its step 3). Any refusal refuses (fail closed, as MCP's endpoint window): 429
 * `PRINCIPAL_RATE_LIMITED` with `Retry-After` and no-store. Q8: a flag-off chat run makes no `requestLlmProviderAdmission` call, so
 * the per-principal window is that path's control.
 *
 * Failing first on the A3a tree: no authenticated row has a window (request N+1 reaches the handler) and `PRINCIPAL_ABUSE_LIMITS`
 * does not exist (page section 18). Identity and membership are the injected test seams (`app/lib/auth/test-support.ts`); the
 * handlers are counting stubs inside the real wrappers, and the chat runs answer through the real adapters over an in-process fake
 * SDK client (the b21-e4-chat-first-turn pattern). Nothing is written to disk and nothing leaves the process.
 * [B24-A3 review, 2026-10-08] Case 2 now pins the Retry-After value (tests-03), case 8 derives the build loop's reach from the runtime
 * import graph (tests-05); case 9 pins the windows' clock under the fixture runtime's frozen clock (regressions-1: the browser job's
 * chat runs are never one window), case 10 the fail-closed enforcement sites (tests-02). Case 9 failed first on the reviewed tree
 * (page section 21); cases 2, 8 and 10 were proved sensitive by mutation.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { DurableOrchestrationRunStore } from "@/app/lib/agent/orchestration/store";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { agentStreamRoute, authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { resetAbuseLimitsForTests } from "@/app/lib/auth/abuse-limits";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import { classifyRouteMethodForm } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { listRouteFiles, routePathOf } from "@/app/lib/auth/route-tree";

type Params = Record<string, unknown>;
const state = vi.hoisted(() => ({ sdkCalls: 0, llmAdmissions: 0 }));

// the REAL adapters over a fake SDK client: one scripted coordinator turn per chat run, every call counted (b21-e4's pattern)
vi.mock("@/app/lib/agent/adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/adapters")>();
  const usage = { input_tokens: 3, output_tokens: 5 };
  const openai = {
    responses: {
      create: async (params: Params) => {
        void params;
        state.sdkCalls += 1;
        const text = "(scripted) one coordinator turn";
        return { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }], output_text: text, status: "completed", model: "scripted", usage };
      },
    },
  };
  return {
    ...original,
    agentAdapterFor: () => new original.OpenAIAgentAdapter(openai as never, "gpt-fake", undefined),
    agentAdapterForRole: (_role: string, _provider: string, model?: string) => new original.OpenAIAgentAdapter(openai as never, model, undefined, 0),
  };
});
// Q8: every LLM-provider admission the process asks for, counted (the meters themselves are the real ones)
vi.mock("@/app/lib/acquisition/admission-control", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/acquisition/admission-control")>();
  return {
    ...original,
    requestLlmProviderAdmission: (...args: Parameters<typeof original.requestLlmProviderAdmission>) => {
      state.llmAdmissions += 1;
      return original.requestLlmProviderAdmission(...args);
    },
  };
});

import { POST as chatPost, EDITOR_CONTEXT_SCHEMA } from "@/app/api/chat/route";
import { ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, setOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const keyOf = (row: { method: string; path: string }): string => `${row.method} ${row.path}`;

/** The reviewed values (OD-197 as A3 applies it; the page's part 2 table states the same): requests per 60 s per principal. */
const CREDIT = 60;
const EXPENSIVE = 50; // [B24-A3b, 2026-10-07] the task proposed 10; two existing suite files send 43 to one expensive row in one window, so 50 (A3b's stated choice)
const CHAT = 60; // [B24-A3b, 2026-10-07] the task proposed 20; e2e/agent-execution.spec.ts sends about 20 chat runs in its first minute, so 60 (A3b's stated choice)
const CREDIT_ROW = "POST /api/architecture/propose";
const EXPENSIVE_ROW = "POST /api/pcb/autoroute";

const BASE = Date.UTC(2026, 9, 7, 9, 0, 0);
const startCase = (index: number): void => { vi.setSystemTime(BASE + index * 600_000); };
const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

/** A counting stub inside the REAL authenticatedJsonRoute: the policy, the window and the body read are the wrapper's own. */
const handled = { count: 0 };
const stubRoute = authenticatedJsonRoute({ maxBytes: 4_096 }, () => { handled.count += 1; return Response.json({ ok: true }); });
const PROJECT_HEADERS = (projectId: string): Record<string, string> => ({ "content-type": "application/json", "x-sirkit-project-id": projectId });
const send = (rowKey: string, projectId = "project-a"): Promise<Response> => {
  const [method, path] = rowKey.split(" ") as [string, string];
  return stubRoute(new Request(`http://localhost${path}`, { method, headers: PROJECT_HEADERS(projectId), body: "{}" }));
};
/** A plain-object request whose body counts every byte a reader demands (highWaterMark 0: it never primes itself). */
function countedRequest(path: string, counter: { pulled: number }): Request {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      counter.pulled += 2;
      controller.enqueue(new Uint8Array([123, 125]));
      controller.close();
    },
  }, { highWaterMark: 0 });
  return { url: `http://localhost${path}`, method: "POST", headers: new Headers(PROJECT_HEADERS("project-a")), body, signal: undefined } as unknown as Request;
}
async function burst(count: number, sendOne: () => Promise<Response>): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) statuses.push((await sendOne()).status);
  return statuses;
}
/** The 429 every refused per-principal request answers. */
async function expectPrincipalRefusal(response: Response): Promise<void> {
  expect(response.status).toBe(429);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const retry = response.headers.get("Retry-After");
  expect(retry).toMatch(/^[0-9]+$/);
  expect(Number(retry)).toBeGreaterThanOrEqual(1);
  expect(Number(retry)).toBeLessThanOrEqual(60);
  expect(await response.json()).toMatchObject({ ok: false, code: "PRINCIPAL_RATE_LIMITED" });
}
const asUser = (userId: string): void => { injectIdentity({ userId }); };
const MEMBERS = [
  { projectId: "project-a", userId: "user-a", role: "admin" as const },
  { projectId: "project-b", userId: "user-a", role: "admin" as const },
  { projectId: "project-a", userId: "user-b", role: "admin" as const },
  { projectId: "project-a", userId: "user-viewer", role: "viewer" as const },
];

// ── the chat request (b21-e4-chat-first-turn's flag-off body) ────────────────────────────────────────────────────────────────────
const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
const SCHEMATIC: SchematicState = {
  components: [], wires: [], netLabels: [],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" }],
};
function chatBody(sentence: string): Record<string, unknown> {
  const board = createEmptyBoard();
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE, schematicState: SCHEMATIC,
    schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(SCHEMATIC, SCOPE) },
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(SCHEMATIC), authoritySource: "local-working-copy" },
  };
}
const chat = (): Promise<Response> => chatPost(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(chatBody("Move R3 2 mm to the right.")) }));

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", "");
  vi.stubEnv("SIRKIT_OPENAI_MODEL", "");
  vi.stubEnv("SIRKIT_TRUSTED_CLIENT_IP_HEADER", undefined);
  resetAbuseLimitsForTests();
  resetAdmissionControl();
  setOrchestrationStoreFactory(() => new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository()));
  injectMembership(MEMBERS);
  asUser("user-a");
  handled.count = 0;
  state.sdkCalls = 0;
  state.llmAdmissions = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetInjectedIdentity();
  resetOrchestrationStoreFactory();
  resetAdmissionControl();
  resetAbuseLimitsForTests();
});

describe("[B24-A3] part 2: the per-principal windows on authenticated spend (D24-8, OD-197)", () => {
  it("1. the registry: frozen, keyed `<METHOD> <path>`, exactly the census's 40 authenticated provider-credit or expensive rows, each a valid window at its class's value (provider credit 60, expensive 50, /api/chat 60 per 60 s; 10,000 keys) with a reason over 40 characters; with ABUSE_LIMITS the key set is exactly the 43 gated rows plus sign-in", async () => {
    const limits = await import("@/app/lib/auth/abuse-limits") as unknown as Record<string, unknown>;
    const registry = limits.PRINCIPAL_ABUSE_LIMITS as Readonly<Record<string, { perPrincipal: { limit: number; windowMs: number; maxKeys: number }; kind: string; reason: string }>> | undefined;
    expect(typeof registry, "PRINCIPAL_ABUSE_LIMITS is exported by abuse-limits.ts").toBe("object");
    expect(Object.isFrozen(registry)).toBe(true);
    const rows = routeResourceClassification();
    const census = rows.filter((row) => !row.isPublic && (row.providerCredit || row.expensive));
    expect(census).toHaveLength(40);
    expect(Object.keys(registry!).sort()).toEqual(census.map(keyOf).sort());
    const { validateFixedWindowLimit } = await import("@/app/lib/mcp/server/inbound-limits");
    for (const row of census) {
      const key = keyOf(row);
      const entry = registry![key]!;
      expect(Object.isFrozen(entry), key).toBe(true);
      expect(validateFixedWindowLimit(entry.perPrincipal), key).toEqual([]);
      const kind = key === "POST /api/chat" ? "chat" : row.expensive ? "expensive" : "provider-credit";
      expect({ kind: entry.kind, limit: entry.perPrincipal.limit }, key).toEqual({ kind, limit: kind === "chat" ? CHAT : kind === "expensive" ? EXPENSIVE : CREDIT });
      expect([entry.perPrincipal.windowMs, entry.perPrincipal.maxKeys], key).toEqual([60_000, 10_000]);
      expect(entry.reason.length, key).toBeGreaterThan(40);
    }
    const gated = rows.filter((row) => row.providerCredit || row.expensive || (row.isPublic && row.modelEgress)).map(keyOf);
    expect(gated).toHaveLength(43);
    const both = [...Object.keys(limits.ABUSE_LIMITS as object), ...Object.keys(registry!)];
    expect(new Set(both).size).toBe(both.length);
    expect(both.sort()).toEqual([...gated, "POST /api/auth/signin"].sort());
  });

  it("2. counterexample (red on the A3a tree): one principal sends limit + 1 requests to an authenticated provider-credit row - the first 60 reach the handler and request 61 is refused 429 PRINCIPAL_RATE_LIMITED before the media type and before any body byte; the same principal in another project, and another principal in the same project, are still admitted", { timeout: 60_000 }, async () => {
    startCase(2);
    const first = await burst(CREDIT, () => send(CREDIT_ROW));
    expect(first.filter((status) => status !== 200)).toEqual([]);
    expect(handled.count).toBe(CREDIT);
    advance(30_500); // [B24-A3 review, 2026-10-08] tests-03: Retry-After is what is left of the window (60 s from its first request), 29.5 s rounded up
    const counter = { pulled: 0 };
    const refusal = await stubRoute(countedRequest("/api/architecture/propose", counter));
    expect(refusal.headers.get("Retry-After")).toBe("30");
    await expectPrincipalRefusal(refusal);
    expect(counter.pulled).toBe(0);
    // the window runs before the media type: a text/plain request is 429, not 415
    await expectPrincipalRefusal(await stubRoute(new Request("http://localhost/api/architecture/propose", { method: "POST", headers: { ...PROJECT_HEADERS("project-a"), "content-type": "text/plain" }, body: "{}" })));
    expect(handled.count).toBe(CREDIT);
    expect((await send(CREDIT_ROW, "project-b")).status).toBe(200);
    asUser("user-b");
    expect((await send(CREDIT_ROW)).status).toBe(200);
    expect(handled.count).toBe(CREDIT + 2);
  });

  it("3. an expensive row admits 50 per principal per minute and the 51st is refused; another row keeps its own window; after the window the principal is admitted again", { timeout: 60_000 }, async () => {
    startCase(3);
    const statuses = await burst(EXPENSIVE + 1, () => send(EXPENSIVE_ROW));
    expect(statuses.slice(0, EXPENSIVE).filter((status) => status !== 200)).toEqual([]);
    expect(statuses[EXPENSIVE]).toBe(429);
    expect((await send("POST /api/pcb/export/gerbers")).status).toBe(200);
    expect((await send(CREDIT_ROW)).status).toBe(200);
    advance(60_000);
    expect((await send(EXPENSIVE_ROW)).status).toBe(200);
  });

  it("4. membership and role come first and consume nothing: an unauthenticated request (401), a non-member (403) and a viewer on an editor row (403) leave the principal's window whole", { timeout: 60_000 }, async () => {
    startCase(4);
    injectIdentity({ userId: "user-a", authenticated: false });
    expect((await burst(EXPENSIVE + 5, () => send(EXPENSIVE_ROW))).filter((status) => status !== 401)).toEqual([]);
    asUser("user-a");
    expect((await burst(EXPENSIVE + 5, () => send(EXPENSIVE_ROW, "project-c"))).filter((status) => status !== 403)).toEqual([]);
    asUser("user-viewer");
    expect((await burst(EXPENSIVE + 5, () => send(EXPENSIVE_ROW))).filter((status) => status !== 403)).toEqual([]);
    expect(handled.count).toBe(0);
    asUser("user-a");
    expect((await burst(EXPENSIVE, () => send(EXPENSIVE_ROW))).filter((status) => status !== 200)).toEqual([]);
    await expectPrincipalRefusal(await send(EXPENSIVE_ROW));
  });

  it("5. /api/chat: 60 runs per principal per minute, the window taken in agentStreamRoute after membership and role and after its body read (by design); run 61 is refused 429 PRINCIPAL_RATE_LIMITED with no model call - and Q8: with SIRKIT_ORCHESTRATION_ENABLED unset the 60 runs make 0 requestLlmProviderAdmission calls (one SDK call each), so the per-principal window is that path's control", { timeout: 120_000 }, async () => {
    startCase(5);
    resetInjectedIdentity(); // chat's local-development principal, as the chat suites use it
    expect(process.env[ORCHESTRATION_ENABLED_ENV]).toBeUndefined();
    for (let index = 0; index < CHAT; index += 1) {
      const response = await chat();
      expect(response.status, `run ${index + 1}`).toBe(200);
      expect(response.headers.get("Content-Type") ?? "", `run ${index + 1}`).toContain("ndjson");
      await response.text();
    }
    expect(state.sdkCalls).toBe(CHAT);
    expect(state.llmAdmissions).toBe(0);
    await expectPrincipalRefusal(await chat());
    expect(state.sdkCalls).toBe(CHAT);
    // the window is the wrapper's: any agentStreamRoute handler on /api/chat meets the same exhausted window, before its handler runs
    const stub = agentStreamRoute({ maxBytes: 1_024, defaultScope: SCOPE }, () => Response.json({ ok: true }));
    const other = await stub(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    await expectPrincipalRefusal(other);
  });

  it("6. fail closed, per (method, path): any refusal of a per-principal window refuses (an invalid clock, a key outside ID_PATTERN), as MCP's endpoint window does; a row with no entry is not limited here; exhausting one row leaves the next row's window whole", async () => {
    startCase(6);
    const limits = await import("@/app/lib/auth/abuse-limits") as unknown as Record<string, unknown>;
    const take = limits.takePrincipalAbuseLimit as ((routeKey: string, parts: readonly string[], nowMs: number) => { ok: boolean; reason?: string } | null) | undefined;
    expect(typeof take, "takePrincipalAbuseLimit is exported by abuse-limits.ts").toBe("function");
    expect(take!(CREDIT_ROW, ["local", "project-a", "user-a"], -1)).toMatchObject({ ok: false, reason: "clock_invalid" });
    expect(take!(CREDIT_ROW, ["local", "project-a", "not an id"], Date.now())).toMatchObject({ ok: false, reason: "key_invalid" });
    expect(take!("GET /api/parts/categories", ["local", "project-a", "user-a"], Date.now())).toBeNull();
    expect(take!("POST /api/parts/search", ["local", "project-a", "user-a"], Date.now())).toBeNull();
    for (let index = 0; index < EXPENSIVE; index += 1) expect(take!(EXPENSIVE_ROW, ["local", "project-a", "user-a"], Date.now())).toMatchObject({ ok: true });
    expect(take!(EXPENSIVE_ROW, ["local", "project-a", "user-a"], Date.now())).toMatchObject({ ok: false, reason: "limited" });
    expect(take!("POST /api/pcb/qualify", ["local", "project-a", "user-a"], Date.now())).toMatchObject({ ok: true });
  });

  it("7. the enforcement sites, in place: authorizeRequest's authenticated branch takes the window after authorizeContext and before it answers; agentStreamRoute takes it after authorizeActor and before its handler; route-handlers.ts keeps its 1,093 lines; every PRINCIPAL_ABUSE_LIMITS row adopts authenticatedJsonRoute or agentStreamRoute (the B16.0.7 classifier)", { timeout: 60_000 }, async () => { // [B24-A3b] about 1 s here (40 route files through the classifier): an explicit budget for CI
    const authorize = read("app/lib/auth/authorize.ts").split(NEWLINE);
    const authz = authorize.findIndex((line) => line.includes("const authz = authorizeContext(context, policy);"));
    const answer = authorize.findIndex((line) => line.includes('return { ok: true, kind: "authenticated", policy, context };'));
    expect(authz).toBeGreaterThan(0);
    expect(answer).toBeGreaterThan(authz);
    const branch = authorize.slice(authz, answer + 1).join(NEWLINE);
    expect(branch.indexOf("principalRateLimitRefusal(context, policy)")).toBeGreaterThan(branch.indexOf("if (authz)"));
    expect(branch.indexOf("principalRateLimitRefusal(context, policy)")).toBeLessThan(branch.indexOf('return { ok: true, kind: "authenticated"'));
    const handlers = read("app/lib/auth/route-handlers.ts").split(NEWLINE);
    expect(handlers).toHaveLength(1_093); // 1,092 lines and the final newline (b24-a1-environment-profile case 9 pins the same)
    const start = handlers.findIndex((line) => line.startsWith("export function agentStreamRoute("));
    const end = handlers.findIndex((line, index) => index > start && line.startsWith("    return handler({ context: trusted.context, body, scope"));
    const stream = handlers.slice(start, end + 1).join(NEWLINE);
    expect(stream.indexOf("readBoundedStream(request.body")).toBeGreaterThan(0);
    expect(stream.indexOf("principalRateLimitRefusal(trusted.context, policy)")).toBeGreaterThan(stream.indexOf("authorizeActor(trusted.context.actor, policy)"));
    expect(stream.indexOf("principalRateLimitRefusal(trusted.context, policy)")).toBeGreaterThan(stream.indexOf("readBoundedStream(request.body"));
    expect(read("app/lib/auth/route-handlers.ts").split("principalRateLimitRefusal(").length - 1).toBe(1);
    const { PRINCIPAL_ABUSE_LIMITS } = await import("@/app/lib/auth/abuse-limits") as unknown as { PRINCIPAL_ABUSE_LIMITS: Record<string, unknown> };
    const files = new Map(listRouteFiles(ROOT).map((file) => [routePathOf(ROOT, file), file] as const));
    for (const key of Object.keys(PRINCIPAL_ABUSE_LIMITS)) {
      const [method, path] = key.split(" ") as [string, string];
      const file = files.get(path)!;
      expect(file, key).toBeTruthy();
      const form = classifyRouteMethodForm(readFileSync(file, "utf8"), method, file, ROOT);
      const expected = key === "POST /api/chat" ? "agentStreamRoute" : "authenticatedJsonRoute";
      expect(form.form === "canonical-wrapper" && form.wrapper === expected, `${key}: ${JSON.stringify(form)}`).toBe(true);
    }
  });

  it("8. the two authenticated embedding paths are bounded by their routes' windows, not the `embedding` key: POST /api/pcb/assign/suggest keeps the service's default embedQuery, and the build loop (searchPartsForAI) is reached only from gated routes ([B24-A3 review, 2026-10-08] tests-05: derived from the runtime import graph - the modules that import searchPartsForAI are exactly the build loop, every route whose runtime closure reaches one of them is a PRINCIPAL_ABUSE_LIMITS row, however it imports; and the tool-catalog binding stays unexposed to the agent and to MCP)", { timeout: 120_000 }, async () => {
    const { PRINCIPAL_ABUSE_LIMITS } = await import("@/app/lib/auth/abuse-limits") as unknown as { PRINCIPAL_ABUSE_LIMITS: Record<string, { perPrincipal: { limit: number } }> };
    expect(PRINCIPAL_ABUSE_LIMITS["POST /api/pcb/assign/suggest"]?.perPrincipal.limit).toBe(CREDIT);
    expect(read("app/api/pcb/assign/suggest/route.ts")).not.toMatch(/embedding-admission|admittedEmbedQuery/);
    expect(read("app/lib/parts-search.ts")).not.toMatch(/embedding-admission|admittedEmbedQuery/);
    expect(read("app/lib/build-loop.ts")).toContain("searchPartsForAI(");
    // the runtime import graph of every production file (type-only declarations erased: the b23-a-route-vocabulary rule), built with a
    // yield between files so the worker is never blocked for long
    const { collectProductionFiles, moduleReferences, resolveSpecifier } = await import("@/app/lib/project/__tests__/_import-gate-helpers");
    const { fileOf, runtimeDeclarationSpecifiers } = await import("@/app/lib/mcp/server/__tests__/_import-closure");
    const files = collectProductionFiles(ROOT);
    const PARTS_SEARCH = "app/lib/parts-search.ts";
    const importersOf = new Map<string, Set<string>>();
    const callers = new Set<string>();
    let walked = 0;
    for (const [file, source] of files) {
      if ((walked += 1) % 200 === 0) await new Promise<void>((resolve) => { setImmediate(resolve); });
      const runtime = runtimeDeclarationSpecifiers(file, source);
      for (const reference of moduleReferences(file, source)) {
        if (reference.kind === "import-type") continue;
        if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
        const resolution = resolveSpecifier(file, reference.specifier);
        if (resolution.kind !== "module") continue;
        const target = fileOf(files, resolution.module);
        if (target === null) continue;
        if (!importersOf.has(target)) importersOf.set(target, new Set());
        importersOf.get(target)!.add(file);
        // a module that takes searchPartsForAI from parts-search: by name, or by a namespace or star form that hands every export on
        if (target === PARTS_SEARCH && (/\bsearchPartsForAI\b/.test(source) || /import\s*\*\s*as|export\s*\*\s*from/.test(source))) callers.add(file);
      }
    }
    expect([...callers].sort(), "the modules that import searchPartsForAI").toEqual(["app/lib/build-loop.ts"]);
    // every file that reaches a caller through runtime imports (reverse closure), and the routes among them
    const reaching = new Set<string>(callers);
    const queue = [...callers];
    while (queue.length > 0) for (const importer of importersOf.get(queue.shift()!) ?? []) if (!reaching.has(importer)) { reaching.add(importer); queue.push(importer); }
    const routes = listRouteFiles(ROOT).map((file) => ({ file: relative(ROOT, file).replaceAll(String.fromCharCode(92), "/"), path: routePathOf(ROOT, file) }));
    const gatedPaths = routes.filter((route) => reaching.has(route.file)).map((route) => route.path).sort();
    expect(gatedPaths, "the routes whose runtime closure reaches the build loop").toEqual(["/api/chat", "/api/schematic/build", "/api/schematic/build-multi", "/api/schematic/edit-build"]); // [PR-G, 2026-10-17] reviewed pin move: + /api/chat - since product reliability D (OD-243) the chat route injects the ONE shared Build generation as the agent's generate-proposal port (app/api/chat/schematic-generation-runtime.ts -> app/lib/schematic/build-multi-generation.ts -> build-loop.ts), so its runtime closure reaches searchPartsForAI; it is a PRINCIPAL_ABUSE_LIMITS row (the chat window, taken in agentStreamRoute: case 7), one generation per run under BUILD_BUDGET
    for (const path of gatedPaths) expect(PRINCIPAL_ABUSE_LIMITS[`POST ${path}`]?.perPrincipal.limit, path).toBe(path === "/api/chat" ? CHAT : CREDIT); // [PR-G, 2026-10-17] the chat row is held to its own window (CHAT), the build routes to the provider-credit window
    // the registered tool whose binding names searchPartsForAI is exposed to neither the agent nor MCP
    const { sirkitToolRegistry } = await import("@/app/lib/engineering/tool-catalog");
    const { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } = await import("@/app/lib/engineering/agent-exposure");
    const { mcpExposureReport } = await import("@/app/lib/engineering/mcp-exposure");
    const registry = sirkitToolRegistry();
    const bound = registry.list().filter((descriptor) => JSON.stringify(descriptor).includes("searchPartsForAI")).map((descriptor) => (descriptor as { toolId: string }).toolId);
    expect(bound).toEqual(["sirkit.parts.search"]);
    expect((INTENTIONAL_AGENT_EXPOSED_TOOL_IDS as readonly string[]).includes("sirkit.parts.search")).toBe(false);
    expect(mcpExposureReport(registry).excludedByReason.not_agent_exposed).toContain("sirkit.parts.search");
  });

  it("9. [B24-A3 review, 2026-10-08] regressions-1 (red on the reviewed tree): the per-principal windows read a clock the fixture runtime does not freeze - with the browser job's frozen clock installed, the local-development principal's chat window (60) and a provider-credit row's window (60) each refuse request 61 and, once the real clock has moved 61 s (the frozen Date.now() has not), admit again: a browser run's whole chat count is never one window", { timeout: 120_000 }, async () => {
    startCase(9);
    const start = Date.now();
    const clock = await import("@/app/lib/fixture-runtime/clock");
    expect(clock.installFixtureClock({ SIRKIT_FIXTURE_RUNTIME: "blinker", SIRKIT_AUTH_MODE: "local_dev", NODE_ENV: "development", SIRKIT_FIXTURE_CLOCK: new Date(start).toISOString() })).not.toBeNull(); // frozen at this case's start, so no earlier window is in its future
    try {
      const frozen = Date.now();
      expect(frozen).toBe(start);
      expect((await burst(CREDIT, () => send(CREDIT_ROW))).filter((status) => status !== 200)).toEqual([]);
      await expectPrincipalRefusal(await send(CREDIT_ROW));
      resetInjectedIdentity(); // chat's local-development principal
      const chatStub = agentStreamRoute({ maxBytes: 1_024, defaultScope: SCOPE }, () => Response.json({ ok: true }));
      const chatOnce = (): Promise<Response> => chatStub(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
      expect((await burst(CHAT, chatOnce)).filter((status) => status !== 200)).toEqual([]);
      await expectPrincipalRefusal(await chatOnce());
      vi.setSystemTime(start + 61_000); // the faked real clock moves; the fixture runtime's frozen Date.now() does not
      expect(Date.now()).toBe(frozen);
      expect((await chatOnce()).status, "the chat window rolled over on the real clock").toBe(200);
      injectMembership(MEMBERS);
      asUser("user-a");
      expect((await send(CREDIT_ROW)).status, "the provider-credit window rolled over on the real clock").toBe(200);
    } finally {
      clock.uninstallFixtureClock();
    }
  });

  it("10. [B24-A3 review, 2026-10-08] tests-02: both per-principal enforcement sites fail closed on every refusal reason, not only `limited` - with an invalid clock (clock_invalid) a provider-credit row (authorizeRequest) and the chat wrapper (agentStreamRoute) answer 429 PRINCIPAL_RATE_LIMITED before their handlers and before any body byte; principalRateLimitRefusal refuses a context whose principal id is outside ID_PATTERN (key_invalid); with a valid clock both are admitted", { timeout: 60_000 }, async () => {
    vi.setSystemTime(-1);
    expect(Date.now()).toBe(-1);
    const counter = { pulled: 0 };
    await expectPrincipalRefusal(await stubRoute(countedRequest("/api/architecture/propose", counter)));
    expect([counter.pulled, handled.count]).toEqual([0, 0]);
    resetInjectedIdentity();
    let chatHandled = 0;
    const chatStub = agentStreamRoute({ maxBytes: 1_024, defaultScope: SCOPE }, () => { chatHandled += 1; return Response.json({ ok: true }); });
    const chatOnce = (): Promise<Response> => chatStub(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    await expectPrincipalRefusal(await chatOnce());
    expect(chatHandled).toBe(0);
    startCase(10);
    expect((await chatOnce()).status).toBe(200);
    expect(chatHandled).toBe(1);
    injectMembership(MEMBERS);
    asUser("user-a");
    expect((await send(CREDIT_ROW)).status).toBe(200);
    const { principalRateLimitRefusal } = await import("@/app/lib/auth/authorize");
    const { policyFor } = await import("@/app/lib/auth/route-policy");
    const forged = { tenantId: "local", projectId: "project-a", principalId: "not an id" } as unknown as Parameters<typeof principalRateLimitRefusal>[0];
    const refused = principalRateLimitRefusal(forged, policyFor("/api/architecture/propose", "POST")!);
    expect(refused).not.toBeNull();
    await expectPrincipalRefusal(refused!);
    expect(principalRateLimitRefusal({ ...forged, principalId: "user-z" } as typeof forged, policyFor("/api/architecture/propose", "POST")!)).toBeNull();
  });
});
