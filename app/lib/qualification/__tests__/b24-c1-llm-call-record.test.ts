/**
 * [B24-C1] D24-21, OD-207 - the LLM call record. Twenty-two model-egress paths besides `/api/chat` (B23-A2's derived column) called a
 * model and kept no durable record of it; each provider call made inside one of them now leaves one `sirkit.llm-call-record.v1`
 * (`app/lib/observability/llm-call-record.ts`), kept as `llm.call-record.v1` (`llm-call-record-store.ts`) through the sink
 * `instrumentation.ts` binds (`llm-call-record-runtime.ts`).
 *
 * Red first (recorded on observability-and-replay.md): at a405db9 this suite fails to load (the seam is missing), and the pre-edit
 * probe - a public parts search under the fixture runtime, its embedding call counted by a fake SDK - found no `llm.call-record.v1`
 * head.
 *
 *  1. the 22 paths, each through its REAL exported handler with fake SDKs (`openai`, `@anthropic-ai/sdk`) and a fake database client:
 *     every provider call leaves exactly one record carrying the path, the method, the scope, the fake's provider, model and tokens
 *     and `completed`; the eight multi-call paths give N >= 2 records numbered 1..N under one request reference; no stored value holds
 *     the prompt, query, answer or provider-message sentinels;
 *  2. a public request the A3 limiter refuses makes no provider call and writes no record;
 *  3. one injected failure per call point: the record's outcome is the classified reason and the response is byte-identical with and
 *     without the sink bound; a provider's own `missing_credentials` through the router is recorded; a missing key before an
 *     embedding or a rerank leaves no call and no record;
 *  4. the fixture runtime: the router short-circuit records nothing; a public search records into the fixture's repository;
 *  5. the contract, the seam (passthrough of the very answer and error objects, timing, classification, the stream, unscoped, unbound),
 *     the store, the runtime's failure classes and its one-at-a-time appends, and the binding (`register()` binds under nodejs only);
 *  6. the census and the import gates: the 22 derived paths, their wrappers, no agent adapter in their closures, the provider importers,
 *     every SDK call site inside the seam, the six SDK importers, the closures of the four call-point modules, the approved importers;
 *  7. [B24-C1 review 2, security-7] the reserved operator scope is a property of the id space: its tenant id lies outside the
 *     trusted-context selector rule, so no authenticated request can record into it or read it as its own.
 *
 * No network, no model, no database: every SDK and the database client are in-process fakes; nothing is written to disk.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Params = Record<string, unknown>;
type Call = { provider: "openai" | "anthropic"; kind: "generate" | "embedding" | "rerank"; model: string; inputTokens: number | null; outputTokens: number | null };
const sdk = vi.hoisted(() => ({
  calls: [] as Array<{ provider: "openai" | "anthropic"; kind: "generate" | "embedding" | "rerank"; model: string; inputTokens: number | null; outputTokens: number | null }>,
  turns: {} as Record<string, number>,
  /** the next call of this kind throws this error instead of answering */
  fail: {} as Partial<Record<"anthropic" | "openai" | "embedding" | "rerank", () => unknown>>,
  /** the database fake's answers, one per awaited query (an empty list when the queue is empty) */
  db: [] as unknown[][],
}));
const SENTINEL = vi.hoisted(() => ({ prompt: "B24C1-SENTINEL-PROMPT", query: "B24C1-SENTINEL-QUERY", answer: "B24C1-SENTINEL-ANSWER", provider: "B24C1-SENTINEL-PROVIDER-MESSAGE" }));

vi.mock("@anthropic-ai/sdk", () => {
  /** the route's first-turn tool call, by the tools it offers (later turns answer text only) */
  const firstCall = (tools: string[]): { name: string; input: Record<string, unknown> } | null => {
    if (tools.includes("search_parts")) return { name: "search_parts", input: { query: `1k resistor 0805 ${SENTINEL.query}` } };
    if (tools.includes("search_footprints")) return { name: "search_footprints", input: { query: `0805 resistor ${SENTINEL.query}` } };
    if (tools.includes("query_items")) return { name: "query_items", input: { kind: "track" } };
    if (tools.includes("inspect_schematic")) return { name: "inspect_schematic", input: {} };
    if (tools.includes("get_board_summary")) return { name: "b24c1_not_allowed", input: {} };
    return null;
  };
  const usage = { input_tokens: 11, output_tokens: 7 };
  return {
    default: class {
      messages = {
        create: async (params: Params) => {
          const tools = ((params.tools ?? []) as Array<{ name: string }>).map((tool) => tool.name);
          const choice = params.tool_choice as { name?: string } | undefined;
          if (choice?.name === "rank_parts") {
            const failure = sdk.fail.rerank;
            sdk.fail.rerank = undefined;
            if (failure) throw failure();
            sdk.calls.push({ provider: "anthropic", kind: "rerank", model: "claude-haiku-fake-b24c1", inputTokens: 5, outputTokens: 2 });
            return { content: [{ type: "tool_use", id: "toolu_rank", name: "rank_parts", input: { ranking: [1, 0] } }], stop_reason: "tool_use", model: "claude-haiku-fake-b24c1", usage: { input_tokens: 5, output_tokens: 2 } };
          }
          const failure = sdk.fail.anthropic;
          sdk.fail.anthropic = undefined;
          if (failure) throw failure();
          sdk.calls.push({ provider: "anthropic", kind: "generate", model: "claude-fake-b24c1", inputTokens: 11, outputTokens: 7 });
          const signature = [...tools].sort().join(",");
          const turn = (sdk.turns[signature] = (sdk.turns[signature] ?? 0) + 1);
          const call = tools.includes("submit_plan") ? { name: "submit_plan", input: { blocks: [], rationale: "one block" } }
            : tools.includes("emit_rule_delta") ? { name: "emit_rule_delta", input: { changes: "not-a-list" } } // invalid on every attempt: the route retries once
            : turn === 1 ? firstCall(tools) : null;
          if (call) return { content: [{ type: "tool_use", id: `toolu_${turn}`, name: call.name, input: call.input }], stop_reason: "tool_use", model: "claude-fake-b24c1", usage };
          return { content: [{ type: "text", text: `(fake) ${SENTINEL.answer}` }], stop_reason: "end_turn", model: "claude-fake-b24c1", usage };
        },
      };
    },
  };
});
vi.mock("openai", () => ({
  default: class {
    responses = {
      create: async () => {
        const failure = sdk.fail.openai;
        sdk.fail.openai = undefined;
        if (failure) throw failure();
        sdk.calls.push({ provider: "openai", kind: "generate", model: "gpt-fake-b24c1", inputTokens: 13, outputTokens: 5 });
        const text = `(fake) ${SENTINEL.answer}`;
        return { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }], output_text: text, status: "completed", model: "gpt-fake-b24c1", usage: { input_tokens: 13, output_tokens: 5 } };
      },
    };
    embeddings = {
      create: async (params: { input: string[] }) => {
        const failure = sdk.fail.embedding;
        sdk.fail.embedding = undefined;
        if (failure) throw failure();
        sdk.calls.push({ provider: "openai", kind: "embedding", model: "text-embedding-3-small", inputTokens: 9, outputTokens: null });
        return { data: params.input.map(() => ({ embedding: new Array(1536).fill(0.01) })), model: "text-embedding-3-small", usage: { prompt_tokens: 9, total_tokens: 9 } };
      },
    };
  },
}));
vi.mock("@/app/lib/db/client", () => {
  const chain = (): unknown => new Proxy(() => {}, {
    get: (_target, property) => (property === "then" ? (resolve: (rows: unknown) => void) => resolve(sdk.db.length > 0 ? sdk.db.shift()! : []) : () => chain()),
    apply: () => chain(),
  });
  return { getDb: () => chain() };
});
// the domain validators the B16.0 tranche suites stub the same way (b16-0-16, -17, -18, -19), so a minimal pinned problem reaches the
// provider call; the routes, the router, the providers, embeddings, parts-search, the build loop and the footprint search are REAL
vi.mock("@/app/lib/calculation/problem", async (orig) => ({ ...(await orig() as object), validateCircuitCalculationProblem: () => [] }));
vi.mock("@/app/lib/schematic-compiler/problem", async (orig) => ({ ...(await orig() as object), validateSchematicCompilationProblem: () => [] }));
vi.mock("@/app/lib/schematic-compiler/graph", async (orig) => ({ ...(await orig() as object), validateSchematicGraph: () => ({ valid: true, diagnostics: [] }) }));
vi.mock("@/app/lib/component-selection/problem", async (orig) => ({ ...(await orig() as object), validateComponentSelectionProblem: () => [] }));
vi.mock("@/app/lib/component-selection/catalog", async (orig) => ({ ...(await orig() as object), validateEngineeringCatalogSnapshot: () => [] }));
vi.mock("@/app/lib/circuit-knowledge/source", async (orig) => ({ ...(await orig() as object), validateRecipeSourceBundle: () => [], validateClaimPromotion: () => [] }));
vi.mock("@/app/lib/circuit-verification/problem", async (orig) => ({ ...(await orig() as object), validateCircuitVerificationProblem: () => [] }));

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { resetAbuseLimitsForTests, takePublicAbuseLimit, PUBLIC_SEARCH_GLOBAL_LIMIT } from "@/app/lib/auth/abuse-limits";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import { classifyRouteMethodForm } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { listRouteFiles, routePathOf } from "@/app/lib/auth/route-tree";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { canonicalDurableScope } from "@/app/lib/durable-workflow/stable";
import { ID_PATTERN } from "@/app/lib/auth/trusted-request-context";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { fixtureContainer, resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { LLMRouter, llmRouter } from "@/app/lib/llm/router";
import { LLMProviderError } from "@/app/lib/llm/errors";
import { configuredOpenAIModel } from "@/app/lib/llm/openai-config";
import type { LLMChunk, LLMProvider, LLMRequest, LLMResponse } from "@/app/lib/llm/types";
import { architectureProblem } from "@/app/lib/architecture/__tests__/fixtures";
import { powerProblem } from "@/app/lib/power/__tests__/fixtures";
import { interfaceProblem, interfaceProblemInput } from "@/app/lib/interfaces/__tests__/fixtures";
import { finalizeVerification } from "@/app/lib/circuit-verification/stable";
import type { FullOracleRun } from "@/app/lib/circuit-verification/types";
import { createSimulationProject } from "@/app/lib/spice/project";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { buildDigest, buildItemIndex } from "@/app/lib/pcb/edit/digest";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { LLM_CALL_FAILURE_REASONS, LLM_CALL_KINDS, LLM_CALL_OUTCOMES, LLM_CALL_RECORD_KEYS, LLM_CALL_RECORD_SCHEMA, PUBLIC_MODEL_EGRESS_SCOPE, bindLlmCallRecordSink, boundLlmCallRecordSink, currentLlmCallScope, llmCallSeamCounts, recordModelCall, recordModelStream, resetLlmCallSeamCounts, validateLlmCallRecord, withLlmCallScope, type LlmCallRecord, type LlmCallRecordEntry } from "@/app/lib/observability/llm-call-record";
import { DurableLlmCallRecordStore, LLM_CALL_AGGREGATE_TYPE, LLM_CALL_RECORD_MISMATCH, LlmCallRecordIntegrityError, llmCallRecordDigest, type LoadedLlmCallRecord } from "@/app/lib/observability/llm-call-record-store";
import { LLM_CALL_PENDING_BOUND, LLM_CALL_WRITE_FAILURES, bindDurableLlmCallRecordSink, drainLlmCallRecordWrites, durableLlmCallRecordSink, llmCallRecordWriteCounts, resetLlmCallRecordStoreFactory, resetLlmCallRecordWriteCounts, setLlmCallRecordStoreFactory } from "@/app/lib/observability/llm-call-record-runtime";
import { register } from "@/instrumentation";
import { embedBatch } from "@/app/lib/embeddings";
import { classifyEmbeddingError } from "@/app/lib/embedding-admission";

import { POST as architecturePropose } from "@/app/api/architecture/propose/route";
import { POST as calculationPropose } from "@/app/api/calculation/propose/route";
import { POST as circuitKnowledgePropose } from "@/app/api/circuit-knowledge/propose/route";
import { POST as circuitVerificationPropose } from "@/app/api/circuit-verification/propose/route";
import { POST as componentSelectionPropose } from "@/app/api/component-selection/propose/route";
import { POST as interfacesPropose } from "@/app/api/interfaces/propose/route";
import { POST as partsSearch } from "@/app/api/parts/search/route";
import { POST as aiRulesFromBrief } from "@/app/api/pcb/ai-rules/from-brief/route";
import { POST as assignSuggest } from "@/app/api/pcb/assign/suggest/route";
import { POST as editAssist } from "@/app/api/pcb/edit/assist/route";
import { GET as footprintsSearch } from "@/app/api/pcb/footprints/search/route";
import { POST as repairAgent } from "@/app/api/pcb/repair/agent/route";
import { POST as powerPropose } from "@/app/api/power/propose/route";
import { POST as schematicPost } from "@/app/api/schematic/route";
import { POST as schematicCompilerPropose } from "@/app/api/schematic-compiler/propose/route";
import { POST as schematicBuild } from "@/app/api/schematic/build/route";
import { POST as schematicBuildMulti } from "@/app/api/schematic/build-multi/route";
import { POST as schematicEdit } from "@/app/api/schematic/edit/route";
import { POST as schematicEditBuild } from "@/app/api/schematic/edit-build/route";
import { POST as layoutCritic } from "@/app/api/schematic/layout-critic/route";
import { POST as schematicReview } from "@/app/api/schematic/review/route";
import { POST as spiceAi } from "@/app/api/spice/ai/route";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
type Scope = { tenantId: string; projectId: string; branchId: string };
const LOCAL: Scope = { tenantId: "local", projectId: "proj-1", branchId: "main" };
const scopeOf = (problem: { tenantId?: string; projectId: string; branchId: string }): Scope => ({ tenantId: problem.tenantId ?? "local", projectId: problem.projectId, branchId: problem.branchId });
/** Two catalog rows: the build loop's search finds two candidates, so its rerank call is made. */
const SEARCH_ROWS = (): unknown[][] => [[
  { id: "part-b24c1-a", name: "R_0805 1k", mpn: "RC0805FR-071KL", description: "resistor", mainCategory: "resistor", pins: [{ number: "1", name: "~", type: "passive" }, { number: "2", name: "~", type: "passive" }], lifecycleStatus: "active", similarity: 0.9 },
  { id: "part-b24c1-b", name: "R_0805 1k2", mpn: "RC0805FR-071K2L", description: "resistor", mainCategory: "resistor", pins: [{ number: "1", name: "~", type: "passive" }, { number: "2", name: "~", type: "passive" }], lifecycleStatus: "active", similarity: 0.8 },
], [], [], []];
const seedProject = () => {
  const project = createSimulationProject(dividerSchematic());
  const test = project.tests[0]!;
  test.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
  return project;
};

type Handler = (request: Request) => Promise<Response>;
interface Spec { method: "POST" | "GET"; handler: Handler; scope: () => Scope | "public"; multi: boolean; body?: () => Record<string, unknown>; query?: string; db?: () => unknown[][] }
/** The 22 paths and how each is driven offline; the census case pins this table's keys to the derived column. */
const SPECS: Readonly<Record<string, Spec>> = {
  "/api/architecture/propose": { method: "POST", handler: architecturePropose, multi: false, scope: () => scopeOf(architectureProblem()), body: () => ({ problem: architectureProblem(), userRequest: `explore ${SENTINEL.prompt}`, provider: "anthropic" }) },
  "/api/calculation/propose": { method: "POST", handler: calculationPropose, multi: false, scope: () => LOCAL, body: () => ({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1", calculationObligations: [{ obligationId: "o1", requestedAnalysisKinds: ["dc"] }] }, userRequest: `plan the divider ${SENTINEL.prompt}`, approvedModelRevisionIds: ["mr1"], provider: "openai" }) },
  "/api/circuit-knowledge/propose": { method: "POST", handler: circuitKnowledgePropose, multi: false, scope: () => LOCAL, body: () => ({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, sourceBundle: { sourceBundleId: "sb1", sourceLocations: [] }, userRequest: `extract ${SENTINEL.prompt}`, provider: "openai" }) },
  "/api/circuit-verification/propose": { method: "POST", handler: circuitVerificationPropose, multi: false, scope: () => LOCAL, body: () => ({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, run: finalizeVerification({ runId: "run:1", runKind: "full", problemDigest: "p1", graphDigest: "g1", findings: [], deterministicDigest: "" } as unknown as FullOracleRun), userRequest: `help ${SENTINEL.prompt}`, provider: "openai" }) },
  "/api/component-selection/propose": { method: "POST", handler: componentSelectionPropose, multi: false, scope: () => LOCAL, body: () => ({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1", catalogSnapshotRevision: "c1", componentRoleRequirements: [{ roleRequirementId: "role:1", category: "resistor", blockerIds: [] }] }, catalog: { deterministicDigest: "c1", atomicPartRevisionIds: ["rev:1"] }, userRequest: `find a resistor ${SENTINEL.prompt}`, provider: "openai" }) },
  "/api/interfaces/propose": { method: "POST", handler: interfacesPropose, multi: false, scope: () => scopeOf(interfaceProblem()), body: () => {
    const input = interfaceProblemInput();
    const architecture = input.architectureState.candidates.find((candidate) => candidate.candidateId === input.architectureState.selection!.candidateId)!;
    const power = input.powerState.candidates.find((candidate) => candidate.candidateId === input.powerState.selection!.candidateId)!;
    return { problem: interfaceProblem(), architecture, power, userRequest: `explore ${SENTINEL.prompt}`, provider: "anthropic" };
  } },
  "/api/parts/search": { method: "POST", handler: partsSearch, multi: false, scope: () => "public", body: () => ({ query: `1k resistor ${SENTINEL.query}` }) },
  "/api/pcb/ai-rules/from-brief": { method: "POST", handler: aiRulesFromBrief, multi: true, scope: () => LOCAL, body: () => ({ provider: "anthropic", brief: `2A USB-C power board ${SENTINEL.prompt}`, board: { netNames: ["VBUS", "GND", "DP", "DN"], hasIcs: true } }) },
  "/api/pcb/assign/suggest": { method: "POST", handler: assignSuggest, multi: true, scope: () => LOCAL, body: () => ({ component: { id: "c1", ref: "R1", value: "1k", pins: [{ number: "1", name: "~" }, { number: "2", name: "~" }] }, provider: "anthropic" }) },
  "/api/pcb/edit/assist": { method: "POST", handler: editAssist, multi: true, scope: () => LOCAL, body: () => { const board = buildRoutedDemo(); return { provider: "anthropic", instruction: `make all GND traces 0.5 mm ${SENTINEL.prompt}`, digest: buildDigest(board, []), items: buildItemIndex(board) }; } },
  "/api/pcb/footprints/search": { method: "GET", handler: footprintsSearch, multi: false, scope: () => "public", query: `?q=${encodeURIComponent(`0805 resistor ${SENTINEL.query}`)}` },
  "/api/pcb/repair/agent": { method: "POST", handler: repairAgent, multi: true, scope: () => LOCAL, body: () => ({ board: createEmptyBoard(), instruction: `check ${SENTINEL.prompt}`, provider: "anthropic" }) },
  "/api/power/propose": { method: "POST", handler: powerPropose, multi: false, scope: () => scopeOf(powerProblem()), body: () => ({ problem: powerProblem(), userRequest: `explore ${SENTINEL.prompt}`, provider: "anthropic" }) },
  "/api/schematic": { method: "POST", handler: schematicPost, multi: false, scope: () => LOCAL, body: () => ({ prompt: `an RC filter ${SENTINEL.prompt}`, provider: "anthropic" }) },
  "/api/schematic-compiler/propose": { method: "POST", handler: schematicCompilerPropose, multi: false, scope: () => LOCAL, body: () => ({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, graph: { projectId: "proj-1", graphId: "graph:g1", deterministicDigest: "g1", components: [], units: [], pins: [], nets: [], endpoints: [], sheetInstances: [], portDefinitions: [], portBindings: [], bundleDefinitions: [] }, userRequest: `plan the netting ${SENTINEL.prompt}`, provider: "openai" }) },
  "/api/schematic/build": { method: "POST", handler: schematicBuild, multi: true, scope: () => LOCAL, db: SEARCH_ROWS, body: () => ({ prompt: `a 1k pull-up ${SENTINEL.prompt}`, provider: "anthropic" }) },
  "/api/schematic/build-multi": { method: "POST", handler: schematicBuildMulti, multi: true, scope: () => LOCAL, db: SEARCH_ROWS, body: () => ({ prompt: `a small circuit ${SENTINEL.prompt}`, provider: "anthropic" }) },
  "/api/schematic/edit": { method: "POST", handler: schematicEdit, multi: false, scope: () => LOCAL, body: () => ({ instruction: `set R1 to 2k ${SENTINEL.prompt}`, components: [{ refDes: "R1", kind: "res", value: "1k" }], provider: "anthropic" }) },
  "/api/schematic/edit-build": { method: "POST", handler: schematicEditBuild, multi: true, scope: () => LOCAL, db: SEARCH_ROWS, body: () => ({ instruction: `add a 1k pull-up ${SENTINEL.prompt}`, netlist: { components: [], connections: [] }, provider: "anthropic" }) },
  "/api/schematic/layout-critic": { method: "POST", handler: layoutCritic, multi: false, scope: () => LOCAL, body: () => ({ state: { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", refDes: "R1", x: 0, y: 0, rotation: 0, value: "1k" }] }, image: "data:image/png;base64,aGk=", provider: "anthropic" }) },
  "/api/schematic/review": { method: "POST", handler: schematicReview, multi: false, scope: () => LOCAL, body: () => ({ components: [{ refDes: "R1", kind: "res", value: "1k" }], nets: [], provider: "anthropic" }) },
  "/api/spice/ai": { method: "POST", handler: spiceAi, multi: true, scope: () => LOCAL, body: () => ({ instruction: `inspect the divider ${SENTINEL.prompt}`, project: seedProject(), provider: "anthropic" }) },
};
const PATHS = Object.keys(SPECS).sort();

/** Build the request for one path (an authenticated member of the scope, or an anonymous caller for the two public paths); `as` names another member's scope. */
function requestFor(path: string, spec: Spec, as?: Scope): Request {
  const scope = as ?? spec.scope();
  const headers: Record<string, string> = { origin: "http://localhost" };
  if (scope !== "public") {
    injectAuthorizedPrincipal({ userId: "b24c1-member", tenantId: scope.tenantId, projectId: scope.projectId, role: "editor" });
    Object.assign(headers, { "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId });
  }
  if (spec.method === "GET") return new Request(`http://localhost${path}${spec.query ?? ""}`, { method: "GET", headers });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(spec.body!()) });
}
let repository = new InMemoryDurableWorkflowRepository();
const store = (): DurableLlmCallRecordStore => new DurableLlmCallRecordStore(repository);
/** Every record written for `scope`, after every scheduled write settled. */
async function recordsOf(scope: Scope): Promise<LoadedLlmCallRecord[]> {
  await drainLlmCallRecordWrites();
  return store().list(scope);
}
/** One path driven once: its response bytes, the SDK calls it made and the records it left. */
async function drive(path: string): Promise<{ status: number; text: string; calls: Call[]; records: LlmCallRecord[]; scope: Scope }> {
  const spec = SPECS[path]!;
  const resolved = spec.scope();
  const scope = resolved === "public" ? { ...PUBLIC_MODEL_EGRESS_SCOPE } : resolved;
  sdk.db = spec.db ? spec.db() : [];
  const before = sdk.calls.length;
  const earlier = new Set((await recordsOf(scope)).map((entry) => entry.record.callId));
  const response = await spec.handler(requestFor(path, spec));
  const text = await response.text();
  const records = (await recordsOf(scope)).map((entry) => entry.record).filter((record) => record.routeId === path && !earlier.has(record.callId));
  return { status: response.status, text, calls: sdk.calls.slice(before), records, scope };
}
const shape = (entry: { provider: string; kind: string; model: string; inputTokens: number | null; outputTokens: number | null }): string => `${entry.kind}|${entry.provider}|${entry.model}|${entry.inputTokens}|${entry.outputTokens}`;
const apiError = (status: number | undefined, message: string, extra: Record<string, unknown> = {}): Error => Object.assign(new Error(message), status === undefined ? {} : { status }, extra);
/** What `fn` throws synchronously (null when it returns). */
const thrownBy = (fn: () => unknown): unknown => { try { fn(); return null; } catch (thrown) { return thrown; } };

beforeAll(() => { bindDurableLlmCallRecordSink(); });
afterAll(() => { bindLlmCallRecordSink(null); });
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("OPENAI_API_KEY", ["fake", "b24c1", "openai"].join("-"));
  vi.stubEnv("ANTHROPIC_API_KEY", ["fake", "b24c1", "anthropic"].join("-"));
  vi.stubGlobal("fetch", () => { throw new Error("no network in b24-c1-llm-call-record"); });
  repository = new InMemoryDurableWorkflowRepository();
  setLlmCallRecordStoreFactory(() => new DurableLlmCallRecordStore(repository));
  bindDurableLlmCallRecordSink();
  resetAbuseLimitsForTests();
  resetAdmissionControl();
  resetLlmCallSeamCounts();
  resetLlmCallRecordWriteCounts();
  sdk.calls = [];
  sdk.turns = {};
  sdk.fail = {};
  sdk.db = [];
});
afterEach(async () => {
  await drainLlmCallRecordWrites();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetInjectedIdentity();
  resetLlmCallRecordStoreFactory();
  resetAbuseLimitsForTests();
  resetAdmissionControl();
});

describe("[B24-C1] every provider call of the 22 model-egress paths leaves one call record (D24-21, OD-207)", () => {
  it.each(PATHS)("1. %s: each SDK call leaves exactly one record - the path, the method, the scope, the fake's provider, model and tokens, `completed` - numbered 1..N under one request reference (N >= 2 on a multi-call path); no stored value holds a prompt, query, answer or provider-message sentinel", { timeout: 60_000 }, async (path) => {
    const spec = SPECS[path]!;
    const driven = await drive(path);
    expect(driven.calls.length, `${path}: the fake SDK saw no call (status ${driven.status})`).toBeGreaterThanOrEqual(spec.multi ? 2 : 1);
    expect(driven.records).toHaveLength(driven.calls.length);
    for (const record of driven.records) {
      expect(validateLlmCallRecord(record), path).toEqual([]);
      expect(record).toMatchObject({ schema: LLM_CALL_RECORD_SCHEMA, routeId: path, method: spec.method, outcome: "completed" });
      expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(driven.records.map((record) => shape(record)).sort()).toEqual(driven.calls.map((call) => shape(call)).sort());
    expect(new Set(driven.records.map((record) => record.requestRef)).size).toBe(1);
    expect(driven.records.map((record) => record.seq).sort((a, b) => a - b)).toEqual(driven.calls.map((_, index) => index + 1));
    expect(new Set(driven.records.map((record) => record.callId)).size).toBe(driven.records.length);
    const stored = JSON.stringify(await recordsOf(driven.scope));
    for (const sentinel of Object.values(SENTINEL)) expect(stored, sentinel).not.toContain(sentinel);
    expect(stored).not.toContain("SENTINEL");
    expect(llmCallRecordWriteCounts()).toMatchObject({ written: driven.records.length, refused: 0, write_failed: 0, dropped: 0, store_unavailable: 0 });
    expect(llmCallSeamCounts()).toMatchObject({ recorded: driven.records.length, invalid: 0, sink_failed: 0, unbound: 0 });
  });

  it("1b. the multi-call paths show their call points: the build loops' embedding and rerank, the footprint search's embedding inside assign/suggest, and both public searches' one embedding under the reserved operator scope with no principal", { timeout: 60_000 }, async () => {
    const build = await drive("/api/schematic/build");
    expect(new Set(build.records.map((record) => record.kind))).toEqual(new Set(["generate", "embedding", "rerank"]));
    const assign = await drive("/api/pcb/assign/suggest");
    expect(assign.records.map((record) => record.kind).sort()).toEqual(["embedding", "generate", "generate"]);
    for (const path of ["/api/parts/search", "/api/pcb/footprints/search"]) {
      const driven = await drive(path);
      expect(driven.scope).toEqual(PUBLIC_MODEL_EGRESS_SCOPE);
      expect(driven.records.map((record) => [record.kind, record.provider, record.model, record.inputTokens, record.outputTokens])).toEqual([["embedding", "openai", "text-embedding-3-small", 9, null]]);
      expect(Object.keys(driven.records[0]!)).toEqual([...LLM_CALL_RECORD_KEYS]);
    }
  });

  it("2. a public request A3's limiter refuses (the route's global window spent) makes no provider call and writes no record", { timeout: 60_000 }, async () => {
    const now = Date.now();
    for (let index = 0; index < PUBLIC_SEARCH_GLOBAL_LIMIT.limit; index += 1) takePublicAbuseLimit("POST /api/parts/search", null, now);
    const refused = await drive("/api/parts/search");
    expect(refused.status).toBe(429);
    expect(refused.calls).toEqual([]);
    expect(refused.records).toEqual([]);
    expect(llmCallSeamCounts()).toMatchObject({ recorded: 0, unscoped: 0 });
  });
});

describe("[B24-C1] one injected failure per call point: the classified reason, and the response unchanged byte for byte", () => {
  /** Drive `path` twice with the same failure: once with the durable sink bound, once with no sink; the bytes must match. */
  async function bothWays(path: string, arm: () => void): Promise<{ bound: Awaited<ReturnType<typeof drive>>; unbound: Awaited<ReturnType<typeof drive>> }> {
    arm();
    const bound = await drive(path);
    resetAdmissionControl();
    resetAbuseLimitsForTests();
    sdk.turns = {};
    bindLlmCallRecordSink(null);
    try {
      arm();
      const unbound = await drive(path);
      return { bound, unbound };
    } finally {
      bindDurableLlmCallRecordSink();
    }
  }

  it("3. generate through the router (Anthropic 429 -> rate_limit; OpenAI 401 -> authentication; a provider's own missing key -> missing_credentials), an embedding (429 -> rate_limit) and a rerank (529 -> overloaded): each failed call's record carries the classified reason and the configured model, no token count and no provider text; the response is the same bytes bound and unbound", { timeout: 120_000 }, async () => {
    const cases: Array<{ path: string; arm: () => void; outcome: string; kind: string; status?: number }> = [
      { path: "/api/schematic/review", arm: () => { sdk.fail.anthropic = () => apiError(429, `${SENTINEL.provider} rate limited`); }, outcome: "rate_limit", kind: "generate", status: 503 },
      { path: "/api/schematic-compiler/propose", arm: () => { sdk.fail.openai = () => apiError(401, `${SENTINEL.provider} invalid key`); }, outcome: "authentication", kind: "generate", status: 503 },
      { path: "/api/schematic", arm: () => { sdk.fail.anthropic = () => apiError(undefined, `Could not resolve authentication method. Expected either apiKey or authToken to be set. ${SENTINEL.provider}`); }, outcome: "missing_credentials", kind: "generate", status: 503 },
      { path: "/api/parts/search", arm: () => { sdk.fail.embedding = () => apiError(429, `${SENTINEL.provider} slow down`, { code: "rate_limit_exceeded" }); }, outcome: "rate_limit", kind: "embedding", status: 200 },
      { path: "/api/schematic/build", arm: () => { sdk.fail.rerank = () => apiError(529, `${SENTINEL.provider} overloaded`); }, outcome: "overloaded", kind: "rerank" },
    ];
    for (const entry of cases) {
      const { bound, unbound } = await bothWays(entry.path, entry.arm);
      if (entry.status !== undefined) expect(bound.status, entry.path).toBe(entry.status);
      expect(unbound.status, entry.path).toBe(bound.status);
      expect(unbound.text, entry.path).toBe(bound.text);
      const failed = bound.records.filter((record) => record.outcome !== "completed");
      expect(failed.map((record) => [record.kind, record.outcome, record.inputTokens, record.outputTokens]), entry.path).toEqual([[entry.kind, entry.outcome, null, null]]);
      expect(unbound.records, entry.path).toEqual([]);
      expect(JSON.stringify(bound.records), entry.path).not.toContain("SENTINEL");
    }
    expect((await recordsOf(LOCAL)).find((entry) => entry.record.outcome === "authentication")!.record.model).toBe(configuredOpenAIModel()); // the configured model (no answer carried one)
    expect(LLM_CALL_FAILURE_REASONS).toHaveLength(12);
    // [B24-C1 review, 2026-10-08] correctness-2: the seam-free baseline is the error itself - each call point hands its caller the very
    // object the SDK or the provider threw, never a normalized copy (A3's meter classifies the SDK's own status and code from it)
    const scope = { routeId: "/api/schematic/build", method: "POST", scope: LOCAL };
    const embeddingError = apiError(429, `${SENTINEL.provider} slow down`, { code: "rate_limit_exceeded" });
    sdk.fail.embedding = () => embeddingError;
    const embedded = await withLlmCallScope(scope, () => embedBatch(["probe"])).then(() => null, (thrown: unknown) => thrown);
    expect(embedded).toBe(embeddingError);
    expect(classifyEmbeddingError(embedded)).toBe("rate_limited");
    const providerError = apiError(529, `${SENTINEL.provider} overloaded`);
    const raw: LLMProvider = { id: "anthropic", generate: async () => { throw providerError; }, stream: () => { throw providerError; }, supportsTools: () => true, supportsVision: () => true };
    expect(await withLlmCallScope(scope, () => new LLMRouter([raw]).generate({ provider: "anthropic", messages: [{ role: "user", content: "x" }] })).then(() => null, (thrown: unknown) => thrown)).toBe(providerError);
    const seamed = (await recordsOf(LOCAL)).map((entry) => entry.record).filter((record) => record.outcome === "rate_limit" || record.outcome === "overloaded");
    expect(seamed.filter((record) => record.kind === "embedding" && record.outcome === "rate_limit")).toHaveLength(1);
    expect(seamed.filter((record) => record.kind === "generate" && record.outcome === "overloaded")).toHaveLength(1);
  });

  it("3b. a failure before any request leaves Sirkit writes no record: without OPENAI_API_KEY an embedding throws before the seam, and without ANTHROPIC_API_KEY the search makes no rerank call (fresh module instances; the seam's state is on globalThis, so they share the bound sink)", { timeout: 60_000 }, async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.resetModules();
    const fresh = await import("@/app/lib/embeddings");
    const seam = await import("@/app/lib/observability/llm-call-record");
    expect(seam.boundLlmCallRecordSink()).toBe(durableLlmCallRecordSink);
    await expect(withLlmCallScope({ routeId: "/api/schematic/build", method: "POST", scope: LOCAL }, () => fresh.embedBatch(["probe"]))).rejects.toThrow(/OPENAI_API_KEY is not set/);
    expect(sdk.calls).toEqual([]);
    vi.stubEnv("OPENAI_API_KEY", ["fake", "b24c1", "openai"].join("-"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.resetModules();
    const search = await import("@/app/lib/parts-search");
    sdk.db = SEARCH_ROWS();
    const results = await withLlmCallScope({ routeId: "/api/schematic/build", method: "POST", scope: LOCAL }, () => search.searchPartsForAI("1k resistor", undefined, 5));
    expect(results.length).toBe(2);
    expect(sdk.calls.map((call) => call.kind)).toEqual(["embedding"]);
    expect((await recordsOf(LOCAL)).map((entry) => entry.record.kind)).toEqual(["embedding"]);
  });
});

describe("[B24-C1] the fixture runtime", () => {
  it("4. under the fixture runtime the router's short-circuit records nothing (no provider call), while a public search reaches embedBatch and records into the fixture's in-memory repository through the production default store", { timeout: 60_000 }, async () => {
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    resetLlmCallRecordStoreFactory();
    try {
      await expect(withLlmCallScope({ routeId: "/api/schematic/review", method: "POST", scope: LOCAL }, () => llmRouter.generate({ provider: "anthropic", messages: [{ role: "user", content: "x" }] }))).rejects.toMatchObject({ reason: "missing_credentials" });
      expect(llmCallSeamCounts().recorded).toBe(0);
      const response = await partsSearch(requestFor("/api/parts/search", SPECS["/api/parts/search"]!));
      expect(response.status).toBe(200);
      await drainLlmCallRecordWrites();
      const heads = await fixtureContainer().durableRepository.listHeads({ aggregateType: LLM_CALL_AGGREGATE_TYPE, scope: PUBLIC_MODEL_EGRESS_SCOPE });
      expect(heads.map((head) => (head.payload as LlmCallRecord).kind)).toEqual(["embedding"]);
      expect(sdk.calls.map((call) => call.kind)).toEqual(["embedding"]);
    } finally {
      resetFixtureContainer();
    }
  });
});

describe("[B24-C1] the contract, the seam, the store, the runtime and the binding", () => {
  const valid = (): LlmCallRecord => ({ schema: LLM_CALL_RECORD_SCHEMA, callId: "llmc-11111111-2222-4333-8444-555555555555", requestRef: "llmr-66666666-7777-4888-9999-000000000000", seq: 1, routeId: "/api/schematic/review", method: "POST", provider: "anthropic", model: "claude-fake-b24c1", kind: "generate", inputTokens: 11, outputTokens: 7, latencyMs: 3, outcome: "completed", startedAt: "2026-10-08T12:00:00.000Z" });

  it("5. the contract: exactly the fourteen keys; the closed kinds and the thirteen outcomes (the twelve failure reasons of llm/errors.ts, in order, and completed); bounded integers, null tokens, an exact policy path, a bounded model id; a secret-shaped value, a raw URL, an extra key and an unknown outcome are refused, and no issue echoes a value", () => {
    expect([...LLM_CALL_RECORD_KEYS]).toEqual(["schema", "callId", "requestRef", "seq", "routeId", "method", "provider", "model", "kind", "inputTokens", "outputTokens", "latencyMs", "outcome", "startedAt"]);
    expect([...LLM_CALL_KINDS]).toEqual(["generate", "stream", "embedding", "rerank"]);
    const union = /export type LLMProviderFailureReason =([\s\S]*?);/.exec(read("app/lib/llm/errors.ts"))![1]!;
    expect([...LLM_CALL_FAILURE_REASONS]).toEqual([...union.matchAll(/\| "([a-z_]+)"/g)].map((match) => match[1]));
    expect([...LLM_CALL_OUTCOMES]).toEqual(["completed", ...LLM_CALL_FAILURE_REASONS]);
    expect(validateLlmCallRecord(valid())).toEqual([]);
    expect(validateLlmCallRecord({ ...valid(), inputTokens: null, outputTokens: null })).toEqual([]);
    const secret = ["sk", "ant", "b24c1".repeat(6)].join("-");
    const refused: Array<[string, Record<string, unknown>]> = [
      ["seq 0", { seq: 0 }], ["a fractional seq", { seq: 1.5 }], ["negative tokens", { inputTokens: -1 }], ["latency past a day", { latencyMs: 86_400_001 }],
      ["a raw URL", { routeId: "https://example.test/api/schematic/review?q=1" }], ["an expanded id", { routeId: "/api/parts/Part 1" }], ["a lower-case method", { method: "post" }],
      ["a third provider", { provider: "mistral" }], ["a model with spaces", { model: "claude fake" }], ["a long model", { model: "m".repeat(129) }], ["a secret-shaped model", { model: secret }],
      ["an unknown kind", { kind: "chat" }], ["an unknown outcome", { outcome: "provider_down" }], ["a local time", { startedAt: "2026-10-08T12:00:00" }], ["a bad call id", { callId: "call-1" }],
      ["an extra key", { prompt: "x" }],
    ];
    for (const [name, change] of refused) {
      const issues = validateLlmCallRecord({ ...valid(), ...change });
      expect(issues.length, name).toBeGreaterThan(0);
      expect(issues.join(" "), name).not.toContain(secret);
    }
    const { model: _model, ...missing } = valid();
    void _model;
    expect(validateLlmCallRecord(missing).length).toBeGreaterThan(0);
    expect(validateLlmCallRecord(null)).toEqual(["record: not a plain object"]);
  });

  it("6. the seam passes an answer and an error through unchanged (the same objects; a synchronous throw stays synchronous), times the call, classifies the failure, numbers the request's calls, and writes nothing outside a scope (`unscoped`) or with no sink bound (`unbound`)", async () => {
    const answer = { model: "claude-fake-b24c1", usage: { inputTokens: 2, outputTokens: 3 } };
    const meta = { provider: "anthropic" as const, model: "claude-configured", kind: "generate" as const, usage: (result: typeof answer) => ({ model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }) };
    expect(await recordModelCall(meta, async () => answer)).toBe(answer);
    expect(llmCallSeamCounts()).toMatchObject({ unscoped: 1, recorded: 0 });
    const scope = { routeId: "/api/schematic/review", method: "POST", scope: LOCAL };
    const error = new LLMProviderError("anthropic", "overloaded");
    await withLlmCallScope(scope, async () => {
      expect(currentLlmCallScope()).toEqual({ routeId: "/api/schematic/review", method: "POST", scope: LOCAL });
      expect(await recordModelCall(meta, () => new Promise<typeof answer>((resolve) => { setTimeout(() => resolve(answer), 25); }))).toBe(answer);
      expect(await recordModelCall(meta, async () => { throw error; }).then(() => null, (thrown: unknown) => thrown)).toBe(error);
      const sync = new Error("thrown synchronously");
      expect(thrownBy(() => recordModelCall(meta, () => { throw sync; }))).toBe(sync); // [B24-C1 review, 2026-10-08] correctness-2: the same object, thrown synchronously
      const sdkError = apiError(403, "model gpt-x is not available"); // [B24-C1 review, 2026-10-08] correctness-2: a RAW SDK error (toProviderError hands an LLMProviderError back unchanged, so only a raw one shows a normalized copy)
      expect(await recordModelCall({ ...meta, provider: "openai" }, async () => { throw sdkError; }).then(() => null, (thrown: unknown) => thrown)).toBe(sdkError);
    });
    expect(currentLlmCallScope()).toBeNull();
    const records = (await recordsOf(LOCAL)).map((entry) => entry.record).sort((a, b) => a.seq - b.seq);
    expect(records.map((record) => [record.seq, record.outcome, record.model])).toEqual([[1, "completed", "claude-fake-b24c1"], [2, "overloaded", "claude-configured"], [3, "unknown", "claude-configured"], [4, "model_access", "claude-configured"]]);
    expect(records[0]!.latencyMs).toBeGreaterThanOrEqual(20);
    expect(new Set(records.map((record) => record.requestRef)).size).toBe(1);
    bindLlmCallRecordSink(null);
    try {
      await withLlmCallScope(scope, () => recordModelCall(meta, async () => answer));
    } finally {
      bindDurableLlmCallRecordSink();
    }
    expect(llmCallSeamCounts()).toMatchObject({ unscoped: 1, unbound: 1, recorded: 4 });
    expect((await recordsOf(LOCAL))).toHaveLength(4);
    const throwing = { write: () => { throw new Error("sink down"); } };
    bindLlmCallRecordSink(throwing);
    try {
      expect(await withLlmCallScope(scope, () => recordModelCall(meta, async () => answer))).toBe(answer);
      await drainLlmCallRecordWrites();
    } finally {
      bindDurableLlmCallRecordSink();
    }
    expect(llmCallSeamCounts().sink_failed).toBe(1);
  });

  it("7. the stream: `LLMRouter.stream` passes every chunk through and writes ONE record when the iteration ends - `completed` with the done chunk's model and tokens (a consumer that stops AT the done chunk included), the classified reason when it throws (the thrown object passed through unchanged), `cancelled` when the consumer stops before the done chunk; outside a scope it writes nothing", async () => {
    const done: LLMResponse = { provider: "openai", model: "gpt-stream-b24c1", text: "ok", toolCalls: [], usage: { inputTokens: 4, outputTokens: 6 } };
    let mode: "done" | "throw" = "done";
    const streamError = Object.assign(new Error("socket hang up"), { name: "APIConnectionError" }); // [B24-C1 review, 2026-10-08] correctness-2: a RAW error, classified `network`
    const provider: LLMProvider = {
      id: "openai",
      generate: async () => done,
      async *stream(): AsyncIterable<LLMChunk> {
        yield { type: "text_delta", text: "o" };
        if (mode === "throw") throw streamError;
        yield { type: "text_delta", text: "k" };
        yield { type: "done", response: done };
      },
      supportsTools: () => true,
      supportsVision: () => true,
    };
    const router = new LLMRouter([provider]);
    const request: LLMRequest = { provider: "openai", messages: [{ role: "user", content: "x" }] };
    const scope = { routeId: "/api/spice/ai", method: "POST", scope: LOCAL };
    const chunks: LLMChunk[] = [];
    await withLlmCallScope(scope, async () => { for await (const chunk of router.stream(request)) chunks.push(chunk); });
    expect(chunks.map((chunk) => chunk.type)).toEqual(["text_delta", "text_delta", "done"]);
    mode = "throw";
    expect(await withLlmCallScope(scope, async () => { for await (const chunk of router.stream(request)) void chunk; }).then(() => null, (thrown: unknown) => thrown)).toBe(streamError);
    mode = "done";
    await withLlmCallScope(scope, async () => { for await (const chunk of router.stream(request)) { void chunk; break; } });
    await withLlmCallScope(scope, async () => { for await (const chunk of router.stream(request)) { if (chunk.type === "done") break; } }); // [B24-C1 review, 2026-10-08] correctness-3: stopped AT the done chunk: completed, with its usage
    for await (const chunk of router.stream(request)) void chunk;
    const records = (await recordsOf(LOCAL)).map((entry) => entry.record);
    expect(records.map((record) => [record.kind, record.outcome, record.model, record.inputTokens, record.outputTokens]).sort()).toEqual([
      ["stream", "cancelled", configuredOpenAIModel(), null, null],
      ["stream", "completed", "gpt-stream-b24c1", 4, 6],
      ["stream", "completed", "gpt-stream-b24c1", 4, 6],
      ["stream", "network", configuredOpenAIModel(), null, null],
    ].sort());
    expect(llmCallSeamCounts().unscoped).toBe(1);
    const failure = new LLMProviderError("anthropic", "bad_request");
    expect(() => withLlmCallScope(scope, () => recordModelStream({ provider: "anthropic", model: "claude-configured", kind: "stream" }, () => { throw failure; }, () => null))).toThrow(failure);
    expect((await recordsOf(LOCAL)).filter((entry) => entry.record.outcome === "bad_request").map((entry) => entry.record.model)).toEqual(["claude-configured"]);
  });

  it("8. the store: one aggregate per call id at revision 1 under its scope; the same record again is a replay; a record the validator refuses and a scope the substrate would rewrite write nothing; load and list re-verify, and a tampered digest, record or key is LLM_CALL_RECORD_MISMATCH", async () => {
    const records = store();
    const record = valid();
    expect(await records.append({ scope: LOCAL, record: { ...record, model: "claude fake" } })).toMatchObject({ ok: false, code: "invalid_record" });
    expect(await records.append({ scope: { ...LOCAL, projectId: " proj-1" }, record })).toMatchObject({ ok: false, code: "invalid_scope" });
    const first = await records.append({ scope: LOCAL, record });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(await records.append({ scope: LOCAL, record })).toEqual({ ...first, replayed: true });
    expect((await records.load(LOCAL, record.callId))!.record).toEqual(record);
    expect(await records.load({ ...LOCAL, projectId: "proj-2" }, record.callId)).toBeNull();
    expect((await records.list(LOCAL)).map((entry) => [entry.revision, entry.recordDigest === llmCallRecordDigest(record)])).toEqual([[1, true]]);
    const tampered = (edit: (row: DurableAggregateRecord<LlmCallRecord>) => void): DurableLlmCallRecordStore => new DurableLlmCallRecordStore(new Proxy(repository, {
      get(target, property) {
        if (property === "loadHead") return async (identity: DurableAggregateIdentity) => { const row = await target.loadHead<LlmCallRecord>(identity); if (row) edit(row); return row; };
        if (property === "listHeads") return async (input: { aggregateType: string; scope: Scope; limit?: number }) => { const rows = await target.listHeads<LlmCallRecord>(input); for (const row of rows) edit(row); return rows; };
        return Reflect.get(target, property, target);
      },
    }) as DurableWorkflowRepository);
    const edits: Record<string, (row: DurableAggregateRecord<LlmCallRecord>) => void> = {
      digest: (row) => { row.recordDigest = `${row.recordDigest}0`; },
      outcome: (row) => { row.payload.outcome = "network"; },
      "another call's id, digest recomputed": (row) => { row.payload.callId = "llmc-99999999-2222-4333-8444-555555555555"; row.recordDigest = llmCallRecordDigest(row.payload); }, // a whole, self-consistent rewrite (record and digest) is not detectable without a signature: RECORDED on the page
      "an extra key": (row) => { (row.payload as unknown as Record<string, unknown>).prompt = "x"; row.recordDigest = llmCallRecordDigest(row.payload); },
      revision: (row) => { row.revision = 2; },
    };
    for (const [name, edit] of Object.entries(edits)) {
      for (const read of [(store: DurableLlmCallRecordStore) => store.load(LOCAL, record.callId), (store: DurableLlmCallRecordStore) => store.list(LOCAL)]) {
        const error = await read(tampered(edit)).then(() => null, (thrown: unknown) => thrown);
        expect(error, name).toBeInstanceOf(LlmCallRecordIntegrityError);
        expect((error as LlmCallRecordIntegrityError).code, name).toBe(LLM_CALL_RECORD_MISMATCH);
      }
    }
  });

  it("9. the runtime's failure classes are counted, never thrown: a store factory that throws (`store_unavailable`), a refusal (`refused`), a rejecting repository (`write_failed`) and a write past the pending bound (`dropped`, the bound counting queued writes); the appends run one at a time", async () => {
    expect([...LLM_CALL_WRITE_FAILURES]).toEqual(["store_unavailable", "refused", "write_failed", "dropped"]);
    const entry = (index: number): LlmCallRecordEntry => ({ scope: LOCAL, record: { ...valid(), callId: `llmc-11111111-2222-4333-8444-${String(index).padStart(12, "0")}` } });
    setLlmCallRecordStoreFactory(() => { throw new Error("factory down"); });
    durableLlmCallRecordSink.write(entry(1));
    await drainLlmCallRecordWrites();
    setLlmCallRecordStoreFactory(() => ({ append: async () => ({ ok: false, code: "invalid_record", message: "refused" }), load: async () => null, list: async () => [] }));
    durableLlmCallRecordSink.write(entry(2));
    await drainLlmCallRecordWrites();
    const rejecting = new Proxy(new InMemoryDurableWorkflowRepository(), { get: (target, property) => (property === "commit" ? async () => { throw new Error("connection reset"); } : Reflect.get(target, property, target)) }) as DurableWorkflowRepository;
    setLlmCallRecordStoreFactory(() => new DurableLlmCallRecordStore(rejecting));
    durableLlmCallRecordSink.write(entry(3));
    await drainLlmCallRecordWrites();
    // [B24-C1 review, 2026-10-08] correctness-4: the appends run ONE at a time (the instrumentation bundle may hold a database client of
    // its own, INFERRED; serial writes keep it to one session): while the first append is held, no second one starts, and the pending
    // bound counts the queued writes, so the 257th is dropped at once
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    let started = 0;
    let inFlight = 0;
    let peak = 0;
    setLlmCallRecordStoreFactory(() => ({ append: async () => { started += 1; inFlight += 1; peak = Math.max(peak, inFlight); await gate; inFlight -= 1; return { ok: true, recordDigest: "x", replayed: false }; }, load: async () => null, list: async () => [] }));
    for (let index = 0; index <= LLM_CALL_PENDING_BOUND; index += 1) durableLlmCallRecordSink.write(entry(100 + index));
    try {
      expect(llmCallRecordWriteCounts().dropped).toBe(1);
      await vi.waitFor(() => expect(started).toBeGreaterThanOrEqual(1));
      for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => { setImmediate(resolve); });
      expect(started, "a second append started while the first was held").toBe(1);
    } finally {
      open(); // a failed expectation never leaves the writes held for the next case
    }
    await drainLlmCallRecordWrites();
    expect(peak).toBe(1);
    expect(started).toBe(LLM_CALL_PENDING_BOUND);
    expect(llmCallRecordWriteCounts()).toEqual({ written: LLM_CALL_PENDING_BOUND, replayed: 0, store_unavailable: 1, refused: 1, write_failed: 1, dropped: 1 });
  });

  it("10. the binding: `register()` binds the durable sink under NEXT_RUNTIME=nodejs only, after the fixture clock, and the sink registry is on globalThis", async () => {
    bindLlmCallRecordSink(null);
    try {
      vi.stubEnv("NEXT_RUNTIME", "edge");
      await register();
      expect(boundLlmCallRecordSink()).toBeNull();
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      await register();
      // the instance register() imported (a fresh one after case 3b's module reset, the same module as this import resolves)
      expect(boundLlmCallRecordSink()).toBe((await import("@/app/lib/observability/llm-call-record-runtime")).durableLlmCallRecordSink);
    } finally {
      bindDurableLlmCallRecordSink();
    }
    const source = read("instrumentation.ts");
    expect(source.indexOf("installFixtureClock();")).toBeLessThan(source.indexOf("bindDurableLlmCallRecordSink();"));
    expect(source.indexOf('if (process.env.NEXT_RUNTIME !== "nodejs") return;')).toBeLessThan(source.indexOf("llm-call-record-runtime"));
    expect(read("app/lib/observability/llm-call-record.ts")).toMatch(/Symbol\.for\("sirkit\.b24-c1\.llm-call-record-seam"\)/);
  });
});

// ── The census and the import gates ─────────────────────────────────────────────────────────────────────────────────────────
const SEAM = "app/lib/observability/llm-call-record.ts";
const CALL_STORE = "app/lib/observability/llm-call-record-store.ts";
const CALL_RUNTIME = "app/lib/observability/llm-call-record-runtime.ts";
const CALL_POINTS = ["app/lib/auth/route-handlers.ts", "app/lib/llm/router.ts", "app/lib/embeddings.ts", "app/lib/parts-search.ts"] as const;
/** [B24-C1] The runtime closures of the four modules at a405db9 (measured before C1b; the baseline each closure must keep). */
const BASELINE_CLOSURES: Readonly<Record<(typeof CALL_POINTS)[number], readonly string[]>> = {
  "app/lib/auth/route-handlers.ts": ["app/lib/atomic/server-auth.ts", "app/lib/auth/abuse-limits.ts", "app/lib/auth/authorize.ts", "app/lib/auth/bounded-fetch.ts", "app/lib/auth/constant-time.ts", "app/lib/auth/deployment-profile.ts", "app/lib/auth/expected-origin.ts", "app/lib/auth/identity-provider.ts", "app/lib/auth/identity-runtime.ts", "app/lib/auth/mcp-bearer.ts", "app/lib/auth/mode.ts", "app/lib/auth/postgres-membership.ts", "app/lib/auth/project-membership.ts", "app/lib/auth/request-security.ts", "app/lib/auth/route-handlers.ts", "app/lib/auth/route-policy.ts", "app/lib/auth/session-liveness.ts", "app/lib/auth/trusted-request-context.ts", "app/lib/auth/worker-principal.ts", "app/lib/db/client.ts", "app/lib/db/connection-security.ts", "app/lib/db/schema.ts", "app/lib/embeddings.ts", "app/lib/engineering/authorization.ts", "app/lib/engineering/stable.ts", "app/lib/fixture-runtime/clock.ts", "app/lib/fixture-runtime/mode.ts", "app/lib/http/bounded-json.ts", "app/lib/http/bounded-stream.ts", "app/lib/mcp/rollout.ts", "app/lib/mcp/server/inbound-limits.ts", "app/lib/mcp/server/protocol.ts", "app/lib/pcb/pad-identity.ts", "app/lib/pcb/padstack/registry.ts", "app/lib/pcb/revision.ts", "app/lib/pcb/smart-routing/hash.ts", "app/lib/stable-compare.ts"],
  "app/lib/llm/router.ts": ["app/lib/auth/mode.ts", "app/lib/fixture-runtime/mode.ts", "app/lib/llm/anthropic-config.ts", "app/lib/llm/anthropic-model-guard.ts", "app/lib/llm/anthropic-provider.ts", "app/lib/llm/context.ts", "app/lib/llm/errors.ts", "app/lib/llm/openai-config.ts", "app/lib/llm/openai-provider.ts", "app/lib/llm/router.ts"],
  "app/lib/embeddings.ts": ["app/lib/embeddings.ts"],
  "app/lib/parts-search.ts": ["app/lib/acquisition/source-registry.ts", "app/lib/atomic/catalog.ts", "app/lib/atomic/claims.ts", "app/lib/atomic/guidance.ts", "app/lib/atomic/kicad-assets.ts", "app/lib/atomic/mapping.ts", "app/lib/atomic/revision-status-sql.ts", "app/lib/atomic/security.ts", "app/lib/atomic/stable.ts", "app/lib/atomic/validation.ts", "app/lib/atomic/value-key.ts", "app/lib/auth/mode.ts", "app/lib/db/client.ts", "app/lib/db/connection-security.ts", "app/lib/db/schema.ts", "app/lib/distributors/lifecycle-sql.ts", "app/lib/durable-workflow/repository.ts", "app/lib/durable-workflow/stable.ts", "app/lib/durable-workflow/types.ts", "app/lib/embeddings.ts", "app/lib/fixture-runtime/blinker/catalog.ts", "app/lib/fixture-runtime/clock.ts", "app/lib/fixture-runtime/container.ts", "app/lib/fixture-runtime/mode.ts", "app/lib/kicad/extract.ts", "app/lib/kicad/sexp.ts", "app/lib/kicad/types.ts", "app/lib/net/href-policy.ts", "app/lib/net/ip-policy.ts", "app/lib/parts-rerank-payload.ts", "app/lib/parts-search.ts", "app/lib/pcb/geometry.ts", "app/lib/pcb/kicad-mod.ts", "app/lib/pcb/layers.ts", "app/lib/pcb/sexpr.ts", "app/lib/pcb/units.ts", "app/lib/physical-binding/conflicts.ts", "app/lib/physical-binding/domain.ts", "app/lib/physical-binding/identity.ts", "app/lib/physical-binding/readiness.ts", "app/lib/physical-binding/repository.ts", "app/lib/physical-binding/stable.ts", "app/lib/physical-binding/transitions.ts", "app/lib/physical-binding/types.ts", "app/lib/physical-binding/validation.ts", "app/lib/prompts.ts", "app/lib/stable-compare.ts", "app/lib/untrusted-text.ts", "lib/schematic-types.ts"],
};
const SEAM_CLOSURE = [SEAM, "app/lib/llm/errors.ts", "app/lib/llm/types.ts", "app/lib/agent/redaction.ts"]; // [B24-C2, 2026-10-08] reviewed pin move: + app/lib/agent/redaction.ts, reached through llm/errors.ts since B24-C2 runs the provider's message through the redaction authority (D24-25); the module is dependency-neutral (it imports nothing), so no closure grows beyond it
const NEVER_IN_CALL_POINTS = ["app/lib/durable-workflow/runtime.ts", "app/lib/durable-workflow/server-repository.ts", CALL_STORE, CALL_RUNTIME];
let production: FileMap | null = null;
const files = (): FileMap => (production ??= collectProductionFiles(ROOT));
function runtimeEdges(map: FileMap, file: string): string[] {
  const source = map.get(file)!;
  const runtime = runtimeDeclarationSpecifiers(file, source);
  const edges: string[] = [];
  for (const reference of moduleReferences(file, source)) {
    if (reference.kind === "import-type") continue;
    if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
    const resolution = resolveSpecifier(file, reference.specifier);
    if (resolution.kind !== "module") continue;
    const target = fileOf(map, resolution.module);
    if (target !== null && !edges.includes(target)) edges.push(target);
  }
  return edges;
}
function importersOf(map: FileMap, target: string): string[] {
  const name = target.split("/").at(-1)!.replace(/\.ts$/, "");
  return [...map.keys()].filter((file) => file !== target && map.get(file)!.includes(name) && runtimeEdges(map, file).includes(target)).sort();
}
/** Every SDK call (`<client>.embeddings.create(` / `<client>.messages.create(`) in `path`, and whether it sits inside an argument of `recordModelCall(`. */
function sdkCallSites(path: string): Array<{ line: number; seamed: boolean }> {
  const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: Array<{ line: number; seamed: boolean }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "create" && ts.isPropertyAccessExpression(node.expression.expression) && ["embeddings", "messages"].includes(node.expression.expression.name.text)) {
      let seamed = false;
      for (let parent: ts.Node | undefined = node.parent; parent !== undefined; parent = parent.parent) {
        if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "recordModelCall") { seamed = true; break; }
      }
      sites.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, seamed });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sites;
}

describe("[B24-C1] the census and the import gates (section 7)", () => {
  it("11. the census: the 22 paths are DERIVED (B23-A2's model_egress rows, /api/chat aside: 21 POST and one GET) and are exactly this suite's table; each path's export is one of the three scope-entering wrappers; no route file of the 22 reaches the agent adapters; the providers' production importers are exactly the router and B24-B3's record-only command; every SDK call site in embeddings.ts and parts-search.ts sits inside recordModelCall; the SDK importers are the six a405db9 holds", { timeout: 180_000 }, async () => {
    const rows = routeResourceClassification().filter((row) => row.modelEgress);
    expect(rows.filter((row) => row.path === "/api/chat").map((row) => row.method)).toEqual(["POST"]);
    const derived = rows.filter((row) => row.path !== "/api/chat");
    expect(derived).toHaveLength(22);
    expect(derived.map((row) => `${row.method} ${row.path}`).sort()).toEqual(PATHS.map((path) => `${SPECS[path]!.method} ${path}`).sort());
    expect(derived.filter((row) => row.method === "GET").map((row) => row.path)).toEqual(["/api/pcb/footprints/search"]);
    const map = files();
    const routeFiles = new Map(listRouteFiles(ROOT).map((file) => [routePathOf(ROOT, file), relative(ROOT, file).split("\\").join("/")] as const));
    for (const row of derived) {
      const file = routeFiles.get(row.path)!;
      const form = classifyRouteMethodForm(read(file), row.method, join(ROOT, file), ROOT);
      expect(form.form === "canonical-wrapper" && ["authenticatedJsonRoute", "publicJsonRoute", "publicRoute"].includes(form.wrapper), `${row.path}: ${JSON.stringify(form)}`).toBe(true);
      expect(form.form === "canonical-wrapper" && (form.wrapper === "authenticatedJsonRoute") === !row.isPublic, row.path).toBe(true);
      expect(importClosure(map, [file]).has("app/lib/agent/adapters.ts"), row.path).toBe(false);
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (const provider of ["app/lib/llm/openai-provider.ts", "app/lib/llm/anthropic-provider.ts"]) expect(importersOf(map, provider), provider).toEqual(["app/lib/llm/router.ts", "scripts/run-b21-live-orchestration-evaluation.ts"]);
    expect(sdkCallSites("app/lib/embeddings.ts")).toEqual([{ line: 50, seamed: true }]);
    expect(sdkCallSites("app/lib/parts-search.ts").map((site) => site.seamed)).toEqual([true]);
    const importers = [...map].filter(([path, source]) => moduleReferences(path, source).some((reference) => /^(?:openai|@anthropic-ai\/sdk)(?:\/.*)?$/.test(reference.specifier))).map(([path]) => path).sort();
    expect(importers).toEqual(["app/lib/agent/adapters.ts", "app/lib/embeddings.ts", "app/lib/evaluation/live-contract-clients.ts", "app/lib/llm/anthropic-provider.ts", "app/lib/llm/openai-provider.ts", "app/lib/parts-search.ts"]);
  });

  it("12. the import gates: the seam is pure (node:async_hooks, node:crypto, ../llm/types, ../llm/errors); each call-point module's closure is its a405db9 closure plus the seam, llm/errors and llm/types only, and holds no durable runtime, server repository, call-record store or runtime; the seam's importers are the four call points and app/lib/observability/; the store's are the runtime and app/lib/observability/; the runtime's one production importer is instrumentation.ts; no module constructs a PostgreSQL repository but the durable runtime; an injected store import in a call point is caught, a type-only import is not", { timeout: 180_000 }, async () => {
    const map = files();
    expect([...runtimeDeclarationSpecifiers(SEAM, map.get(SEAM)!)].sort()).toEqual(["../llm/errors", "../llm/types", "node:async_hooks", "node:crypto"]);
    expect([...runtimeDeclarationSpecifiers(CALL_STORE, map.get(CALL_STORE)!)].sort()).toEqual(["../durable-workflow/stable", "../engineering/stable", "./llm-call-record"]);
    expect([...runtimeDeclarationSpecifiers(CALL_RUNTIME, map.get(CALL_RUNTIME)!)].sort()).toEqual(["../durable-workflow/runtime", "./llm-call-record", "./llm-call-record-store"]);
    for (const entry of CALL_POINTS) {
      const closure = [...importClosure(map, [entry]).keys()].sort();
      expect(closure, entry).toEqual([...new Set([...BASELINE_CLOSURES[entry], ...SEAM_CLOSURE])].sort());
      expect(closure.filter((file) => NEVER_IN_CALL_POINTS.includes(file)), entry).toEqual([]);
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(importersOf(map, SEAM).filter((file) => !file.startsWith("app/lib/observability/"))).toEqual([...CALL_POINTS].sort());
    expect(importersOf(map, CALL_STORE).filter((file) => !file.startsWith("app/lib/observability/"))).toEqual([]);
    expect(importersOf(map, CALL_STORE)).toContain(CALL_RUNTIME);
    expect(importersOf(map, CALL_RUNTIME)).toEqual(["instrumentation.ts"]);
    expect([...map].filter(([, source]) => /new\s+PostgresDurableWorkflowRepository\s*\(/.test(source)).map(([path]) => path)).toEqual(["app/lib/durable-workflow/runtime.ts"]);
    const probe = (path: string, append: string): FileMap => new Map(map).set(path, `${map.get(path)!}\n${append}\n`);
    const router = "app/lib/llm/router.ts";
    const caught = importClosure(probe(router, 'import { DurableLlmCallRecordStore } from "../observability/llm-call-record-store";\nexport const b24c1Probe = DurableLlmCallRecordStore;'), [router]);
    expect(caught.get(CALL_STORE)).toEqual([router, CALL_STORE]);
    expect(importClosure(probe(router, 'import type { LlmCallRecordStore } from "../observability/llm-call-record-store";\nexport type B24c1Probe = LlmCallRecordStore;'), [router]).has(CALL_STORE)).toBe(false);
  });
});

// ── [B24-C1 review 2, 2026-10-08] the reserved operator scope (security-7) ───────────────────────────────────────────────────────
describe("[B24-C1 review 2] the reserved operator scope is unreachable by any authenticated selector", () => {
  it("13. (security-7) a member provisioned under the operator tenant and project is refused before any provider call - the selector is malformed (AUTH_SELECTOR_MALFORMED), no call, no record - because the operator tenant id lies outside ID_PATTERN, the trusted context's selector rule, while the substrate keeps the scope as written; a reachable look-alike tenant is admitted and records under ITS scope, which is not the operator's", { timeout: 60_000 }, async () => {
    const operator: Scope = { ...PUBLIC_MODEL_EGRESS_SCOPE };
    const spec = SPECS["/api/schematic/review"]!;
    const before = sdk.calls.length;
    const refused = await spec.handler(requestFor("/api/schematic/review", spec, operator)); // an in-memory membership accepts any tenant string, as a provisioned row would
    const refusal = await refused.text();
    expect(refused.status, refusal).toBe(400);
    expect(JSON.parse(refusal)).toMatchObject({ ok: false, code: "AUTH_SELECTOR_MALFORMED" });
    expect(sdk.calls.length).toBe(before);
    expect(await recordsOf(operator)).toEqual([]);
    expect(llmCallSeamCounts()).toMatchObject({ recorded: 0, unscoped: 0 });
    // the reservation is a property of the id space, not of a rule a later selector path could miss
    expect(ID_PATTERN.test(operator.tenantId)).toBe(false);
    expect(canonicalDurableScope(operator)).toEqual(operator); // and the substrate stores it as written (b24-c1-durable-records-pglite 5: on PostgreSQL too)
    expect(PUBLIC_MODEL_EGRESS_SCOPE).toEqual({ tenantId: "~sirkit-operator", projectId: "public-model-egress", branchId: "main" });
    // the look-alike: a tenant id inside the pattern is admitted - one provider call, one record under ITS scope (the fake answers this
    // route's call with text, so the handler itself answers 500 `no review returned`, as in case 1; the selector's admission is the point)
    const lookalike: Scope = { tenantId: "sirkit-operator", projectId: operator.projectId, branchId: operator.branchId };
    resetInjectedIdentity();
    const admitted = await spec.handler(requestFor("/api/schematic/review", spec, lookalike));
    expect(admitted.status).not.toBe(400);
    expect(sdk.calls.length).toBe(before + 1);
    expect((await recordsOf(lookalike)).map((entry) => [entry.record.routeId, entry.record.outcome])).toEqual([["/api/schematic/review", "completed"]]);
    expect(await recordsOf(operator)).toEqual([]);
  });
});
