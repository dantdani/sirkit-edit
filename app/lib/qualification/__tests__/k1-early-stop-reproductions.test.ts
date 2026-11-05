/**
 * [K1, 2026-11-04] Section K, increment K1 (runbook K.8 step 1, "current behavior/reproductions"; OD-260): the early stops and gaps the
 * section K map found (artifacts/product-reliability-simple-ui/work-log-and-assets/k-map.md sections 1.3, 2.1 and 6.1), each verified
 * against the code at 22db67c9 and reproduced by driving the REAL production modules - the durable acquisition task store and its slice
 * runner over the fixture runtime's catalog and durable repository, the CAD egress path over the committed fixture transport, the chat
 * loop with its real gateway and registry (a scripted provider stands in for the model), the generation task's server snapshot and the
 * browser's reader, the atomic asset and approval code, and the 3D scene builder. Nothing is re-implemented here.
 *
 * CONVENTION (one for the whole file): every case is an ordinary `it` that asserts the CURRENT behaviour as the production code behaves
 * today, cites the code at file:line in its title, and names the K increment that changes it. That increment MUST rewrite the case to
 * its new contract in the same commit: the case goes red the moment the behaviour changes, so no flip happens silently. `it.fails` is
 * not used, because an expected failure also passes on an unrelated error and so could not prove that a reproduction is real.
 *
 *  1. the acquisition task's 3 failed claims end the WHOLE task in a `source_unavailable` wait with no schedule (K3);
 *  2. one pass over the admitted CAD sources ends `no_matching_asset` with no next strategy and no schedule (K3);
 *  3. the chat run's third identical acquisition-status read was refused `repeated_call` ("its result has not changed") although the
 *     durable task changed between the reads - [K2, 2026-11-04] rewritten: the guard keys a live task's status read on its stored revision;
 *  4. a Retry-After above one hour is clipped to one hour in the CAD egress path (K3);
 *  5. starting an acquisition from the chat answered a plain read: no typed event reached the activity entry - [K2, 2026-11-04]
 *     rewritten: the typed acquisition_task_ready event;
 *  6. the browser's task view dropped `allowance.remaining` - [K2, 2026-11-04] rewritten: kept, and the Work log's allowance line;
 *  7. `createModelAsset` turns a caller's `inspected: true` into `safe` without reading the bytes, which then satisfies the mechanical
 *     profile; no production module calls it (K5);
 *  8. the 3D footprints are courtyard boxes with no placeholder label, shown under a "Parts" toggle (K6);
 *  9. the ingestion page helper retries twice and clips a Retry-After to 5 s, and no production module calls it - a tripwire: K adopts
 *     nothing from it (no K increment changes it).
 *
 * Offline and US$0: no paid call, no provider, no database (the fixture runtime's in-memory durable repository), and the global `fetch`
 * is a recording stub that every case leaves uncalled; the one CAD transport is the committed fixture transport. The production-caller
 * tripwires (cases 7 and 9) read the source tree once at module load. Nothing is written to disk and no process is started.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resetCadAcquisitionPortFactory, resolveCadAcquisitionPort } from "@/app/api/chat/cad-acquisition-runtime";
import { resolveRevisionEvidencePort } from "@/app/api/chat/revision-evidence-runtime";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "@/app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { createFixtureCadTransport, FIXTURE_CAD_HOST } from "@/app/lib/fixture-runtime/cad-source/transport";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { CAD_ACQUISITION_BLOCKER_TEXT, CAD_ACQUISITION_START_TOOL_ID, CAD_ACQUISITION_STATUS_TOOL_ID } from "@/app/lib/acquisition/cad-acquisition-contract";
import { CAD_RETRY_AFTER_MAX_MS, fetchCadAsset, retryAfterAt } from "@/app/lib/acquisition/cad-egress";
import { resetComponentResolutionRuntimeFactory, resolveComponentResolutionRuntime, componentResolutionStoreOf, type ComponentResolutionRuntime } from "@/app/lib/component-resolution/task/runtime";
import { ComponentResolutionService } from "@/app/lib/component-resolution/task/service";
import { ComponentResolutionTaskStore } from "@/app/lib/component-resolution/task/store";
import { COMPONENT_RESOLUTION_POLICY, COMPONENT_RESOLUTION_SLICE_TOPIC, componentResolutionTaskView, type ComponentResolutionTaskHead } from "@/app/lib/component-resolution/task/contracts";
import { componentResolutionTopicRunner } from "@/app/lib/component-resolution/task/topic-runner";
import { componentResolutionSlicePorts, resetCadSourceInjection, setCadSourceInjection } from "@/app/lib/component-resolution/task/worker-runtime";
import { cadSourceIdentity } from "@/app/lib/component-resolution/acquisition/source-identity";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { runAgentLoop } from "@/app/lib/agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type AgentToolResult, type ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { refusedLineLabel, toolLineLabel } from "@/app/lib/project/chat-run-view";
import { resolutionProgressLine } from "@/app/lib/project/component-resolution-events";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { durableWorkflowDigest } from "@/app/lib/durable-workflow/stable";
import { GenerationTaskStore } from "@/app/lib/generation-task/store";
import { GENERATION_TASK_ALLOWANCE_UNIT } from "@/app/lib/generation-task/contracts";
import { buildGenerationTaskSnapshot } from "@/app/lib/generation-task/snapshot";
import { generationTaskAllowanceText, generationTaskCountsText, readGenerationTaskSnapshot, reduceGenerationTaskView } from "@/app/lib/project/generation-task-client";
import { createModelAsset } from "@/app/lib/atomic/kicad-assets";
import { ATOMIC_VALIDATOR_VERSION, evaluateApproval, type ValidationContext } from "@/app/lib/atomic/validation";
import type { AtomicPartRevision, ModelAssetVersion } from "@/app/lib/atomic/types";
import { collectAdapterPages, SourceAdapterError, type SourceAdapter } from "@/app/lib/atomic/ingestion";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { buildScene, disposeScene } from "@/app/lib/pcb/3d/build-scene";
import { isPlaceholderCandidate } from "@/app/lib/pcb/3d/geom/footprint-mesh";
import { DEFAULT_PALETTE_ID, PALETTES } from "@/app/lib/pcb/3d/palette";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const SCOPE = { tenantId: "local", projectId: "k1-reproductions", branchId: "main" } as const;
/** the editor's canonical schematic head mark (the browser sends one beside its sheet; the start is a propose-class tool) */
const HEAD_MARK = { lineageId: "lin1-4b10000000000001", headSequence: 3, canonicalStateDigest: "eng1-0123456789abcdef" };
const PERSON = { principalId: "user:k1-editor", role: "pcb_editor" as const, membershipRevision: null, actorKind: "human" as const };
/** the dimmer's two 1N4148 steering diodes: no published exact revision in the fixture catalog, so they are acquired */
const REQUEST = { componentIds: [DIMMER_INSTANCE_IDS.D1, DIMMER_INSTANCE_IDS.D2], requirement: { mounting: "through_hole", packageCode: "DO-35" } };
const SYMBOL_1N4148_PATH = "/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym";
const HOUR_MS = 3_600_000;

// ── the production-caller tripwires' one walk (module load: a tree walk inside a case body can outrun vitest's default under load) ──
const SOURCE_ROOTS = ["app", "lib", "components", "scripts"];
function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(join(ROOT, dir)); } catch { return out; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const path = `${dir}/${entry}`;
    if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(entry)) out.push(path);
    else if (!entry.includes(".")) sourceFiles(path, out);
  }
  return out;
}
const PRODUCTION_SOURCES: ReadonlyArray<{ path: string; text: string }> = SOURCE_ROOTS.flatMap((root) => sourceFiles(root)).map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));
const productionFilesNaming = (needle: string): string[] => PRODUCTION_SOURCES.filter((file) => file.text.includes(needle)).map((file) => file.path).sort();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);

const fetched: string[] = [];
beforeEach(() => {
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("DATABASE_URL", "");
  resetFixtureContainer();
  resetComponentResolutionRuntimeFactory();
  resetCadAcquisitionPortFactory();
  resetCadSourceInjection();
  resetAdmissionControl();
  fetched.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => { fetched.push(String(input)); throw new Error("K1 reaches no host: the CAD transport is the committed fixture"); }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetFixtureContainer();
  resetComponentResolutionRuntimeFactory();
  resetCadAcquisitionPortFactory();
  resetCadSourceInjection();
  resetAdmissionControl();
  expect(fetched).toEqual([]);
});

// ── the acquisition task, started the way the Missing parts panel starts it (the page route's service, a person) ──
function fixtureRuntime(): ComponentResolutionRuntime {
  const runtime = resolveComponentResolutionRuntime();
  if (!runtime?.fixture) throw new Error("the fixture runtime's component-resolution composition did not resolve");
  return runtime;
}
async function startDimmerAcquisition(): Promise<{ runtime: ComponentResolutionRuntime; taskId: string; head: ComponentResolutionTaskHead }> {
  const runtime = fixtureRuntime();
  const service = new ComponentResolutionService({ runtime, catalog: resolveCatalogInspectionPort() });
  const answer = await service.start(SCOPE, PERSON, { request: REQUEST, schematic: fixtureDimmerSheet(), headMark: HEAD_MARK, origin: "page" });
  expect(answer.status, JSON.stringify(answer.body).slice(0, 400)).toBe(202);
  const taskId = (answer.body.task as { taskId: string }).taskId;
  const read = await componentResolutionStoreOf(runtime).get(SCOPE, taskId);
  if (!read) throw new Error("the started task is not stored");
  expect(read.task).toMatchObject({ state: "queued", attempts: [], target: { symbol: { library: "Diode", name: "1N4148" } } });
  return { runtime, taskId, head: read.task };
}
const liveSlices = async (runtime: ComponentResolutionRuntime): Promise<string[]> =>
  (await runtime.repository.listOutbox({ topic: COMPONENT_RESOLUTION_SLICE_TOPIC })).filter((event) => event.state === "pending" || event.state === "processing").map((event) => `${event.state}:${String(event.payload.sliceId)}`);

describe("[K1] section K's early stops and gaps, reproduced against the current code", () => {
  it("[K1 1] CURRENT component-resolution/task/store.ts:215-229 (policy task/contracts.ts:33): after 3 claimed attempts of one slice lapse, the 4th claim parks the WHOLE task waiting-for-resource with the source_unavailable blocker, no pending slice and no schedule; no source was ever asked - flipped by K3", async () => {
    const { runtime, taskId, head: started } = await startDimmerAcquisition();
    let now = Date.parse(started.createdAt) + 1_000;
    const store = new ComponentResolutionTaskStore({ repository: runtime.repository, clock: () => now });
    const revalidated: number[] = [];
    const outcomes: string[] = [];
    let code: string | undefined;
    for (let claim = 1; claim <= 4; claim += 1) {
      const [outcome] = await store.claimSlices({ workerId: `k1-worker-${claim}`, limit: 1, revalidate: async () => { revalidated.push(claim); return { ok: true }; } });
      outcomes.push(outcome?.outcome ?? "none");
      if (outcome && outcome.outcome !== "claimed") code = outcome.code;
      now += COMPONENT_RESOLUTION_POLICY.leaseMs + 1; // the worker that held the slice died: its lease lapses with nothing committed
    }
    expect(COMPONENT_RESOLUTION_POLICY.maxAttemptsPerSlice).toBe(3);
    expect(outcomes).toEqual(["claimed", "claimed", "claimed", "failed"]);
    expect(code).toBe("COMPONENT_RESOLUTION_ATTEMPTS_EXHAUSTED");
    expect(revalidated).toEqual([1, 2, 3]); // the 4th claim is refused before any re-check

    const head = (await store.get(SCOPE, taskId))!.task;
    expect(head.state).toBe("waiting-for-resource");
    expect(head.pending).toBeNull();
    expect(head.blocker).toMatchObject({ code: "source_unavailable", message: CAD_ACQUISITION_BLOCKER_TEXT.source_unavailable.message, detail: "the slice failed repeatedly; the stored work is kept and Resume schedules it again" });
    // the code says no admitted source can serve the part, yet no source was asked: the fixture source is admitted and untouched
    expect(head.attempts).toEqual([]);
    expect(head.events.at(-1)).toMatchObject({ kind: "waiting_resource", message: "The acquisition slice failed repeatedly; it waits for Resume." });
    expect(componentResolutionTaskView(head).nextAction).toBe("none");
    // no schedule: a week later nothing is claimable; only a person's Resume schedules the task again
    now += 7 * 24 * HOUR_MS;
    expect(await store.claimSlices({ workerId: "k1-worker-later", limit: 10, revalidate: async () => ({ ok: true }) })).toEqual([]);
    expect(await liveSlices(runtime)).toEqual([]);
  });

  it("[K1 2] CURRENT component-resolution/acquisition/pipeline.ts:102-130 and task/slices.ts:154-162: ONE pass over the admitted CAD sources - the only admitted source lacks the symbol, so the task ends blocked no_matching_asset, waiting-for-resource with no next strategy and no schedule - flipped by K3", async () => {
    const { runtime, taskId } = await startDimmerAcquisition();
    const transport = createFixtureCadTransport();
    transport.overrides.set(SYMBOL_1N4148_PATH, { status: 404, headers: { "content-type": "text/plain" }, body: "not found" });
    setCadSourceInjection({ fixtureEgress: { fetch: transport.fetch, resolve: transport.resolve }, fixtureAllowed: true });
    const catalog = resolveCatalogInspectionPort();
    const evidence = resolveRevisionEvidencePort();
    if (!catalog || !evidence) throw new Error("the fixture runtime's catalog and evidence ports did not resolve");
    const store = componentResolutionStoreOf(runtime);
    const runner = componentResolutionTopicRunner({ store, revalidate: async () => ({ ok: true }), ports: () => componentResolutionSlicePorts(runtime, { catalog, evidence }) });
    const slices = await runner.claim({ workerId: "k1-worker", limit: 1 });
    expect(slices).toHaveLength(1);
    const report = await slices[0]!.run({ signal: new AbortController().signal, boundary: async () => "continue" });
    expect(report).toMatchObject({ outcome: "ended", state: "waiting-for-resource", detail: "blocked: no_matching_asset" });

    const head = (await store.get(SCOPE, taskId))!.task;
    expect(head.blocker).toMatchObject({ code: "no_matching_asset", message: CAD_ACQUISITION_BLOCKER_TEXT.no_matching_asset.message });
    expect(head.pending).toBeNull();
    expect(head.stages["source-selection"].status).toBe("blocked");
    // the one pass: the sources the composition did not admit are recorded skips, the one admitted source failed once
    expect(head.attempts.filter((attempt) => attempt.outcome !== "skipped").map((attempt) => [attempt.sourceId, attempt.outcome, attempt.code])).toEqual([["fixture-kicad", "failed", "not_found"]]);
    expect(head.attempts.filter((attempt) => attempt.outcome === "skipped").map((attempt) => attempt.sourceId).sort()).toEqual(["kicad-bundled", "kicad-gitlab"]);
    // exactly one request: no alternate locator, variant, query or source was tried, and nothing records a strategy
    expect(transport.requests).toEqual([`https://${FIXTURE_CAD_HOST}${SYMBOL_1N4148_PATH}`]);
    expect(JSON.stringify(head)).not.toMatch(/strateg/i);
    expect(componentResolutionTaskView(head).nextAction).toBe("none");
    expect(await liveSlices(runtime)).toEqual([]);
  });

  it("[K1 3] [K2, 2026-11-04] REWRITTEN to K2's contract (was CURRENT agent/loop.ts:445-450: the 3rd identical status read refused 'its result has not changed' while the task moved): agent/loop.ts:445-449 keys a status read of a live task on the stored revision the gateway's probe observes (gateway.ts:499, cad-acquisition-reads.ts observedRevision) - after a worker claimed the task between the reads the THIRD identical read runs and reports the real state; with the task unchanged it is still refused, now saying what was proved (the guard stays)", async () => {
    const run = await chatAcquisitionRun({ workerClaimsBeforeThirdRead: true });
    expect(run.result.status).toBe("completed");
    expect(DEFAULT_AGENT_BUDGET.maxIdenticalCalls).toBe(2);
    const status = (callId: string) => run.events.filter((event) => "callId" in event && event.callId === callId && event.type !== "acquisition_task_ready").map((event) => event.type);
    expect(status("c2")).toEqual(["tool_started", "tool_finished"]);
    expect(status("c3")).toEqual(["tool_started", "tool_finished"]);
    expect(status("c4")).toEqual(["tool_started", "tool_finished"]); // the task moved: the third identical read is a new observation
    expect(run.events.filter((event) => event.type === "tool_refused")).toEqual([]);
    const c3 = run.results.flat().find((result) => result.callId === "c3")!;
    const c4 = run.results.flat().find((result) => result.callId === "c4")!;
    expect(reportOf(c3).tasks[0]!.state).toBe("queued");
    expect(reportOf(c4).tasks[0]!.state).toBe("running"); // the read the old guard refused reports what the store really holds
    const stored = (await componentResolutionStoreOf(run.runtime).get(SCOPE, run.taskId))!.task;
    expect(stored.state).toBe("running");
    expect(stored.events.at(-1)).toMatchObject({ kind: "worker_claimed" });

    // the guard itself stays: with the stored task unchanged the third identical read is refused before it runs, truthfully
    const unchanged = await chatAcquisitionRun({ workerClaimsBeforeThirdRead: false });
    const refused = unchanged.events.find((event): event is Extract<AgentRunEvent, { type: "tool_refused" }> => event.type === "tool_refused")!;
    expect(refused).toMatchObject({ callId: "c4", toolId: CAD_ACQUISITION_STATUS_TOOL_ID, status: "repeated_call" });
    const unchangedC4 = unchanged.results.flat().find((result) => result.callId === "c4")!;
    expect(unchangedC4.isError).toBe(true);
    expect(JSON.parse(unchangedC4.outputText)).toEqual({ ok: false, status: "repeated_call", detail: "This exact status read already ran twice in this run and the task it reads is stored unchanged since (the same stored revision); report the state you have, or read it again in a later turn." });
    expect(refusedLineLabel(refused)).toMatch(/refused before running \(repeated_call\) — nothing ran$/);
    expect(unchanged.taskId).toBe(run.taskId); // the second run attached to the SAME task (the start is idempotent), which no worker moved during its reads
    expect((await componentResolutionStoreOf(unchanged.runtime).get(SCOPE, unchanged.taskId))!.task.state).toBe("running");
  });

  it("[K1 4] CURRENT acquisition/cad-egress.ts:60-61 and :80-87: a 429 whose real Retry-After is two hours schedules the next attempt ONE hour out - clipped, as delta-seconds and as an HTTP date - flipped by K3", async () => {
    const NOW = Date.parse("2026-11-04T10:00:00.000Z");
    const transport = createFixtureCadTransport();
    const fetchSymbol = () => fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, { fetch: transport.fetch, resolve: transport.resolve, fixtureAllowed: true, clock: () => NOW });
    expect(CAD_RETRY_AFTER_MAX_MS).toBe(HOUR_MS);
    transport.overrides.set(SYMBOL_1N4148_PATH, { status: 429, headers: { "retry-after": String((2 * HOUR_MS) / 1_000), "content-type": "text/plain" }, body: "slow down" });
    expect(await fetchSymbol()).toMatchObject({ ok: false, code: "rate_limited", status: 429, retryAtMs: NOW + HOUR_MS });
    resetAdmissionControl(); // the rate limit also counts against the source's breaker; a fresh meter so the second request is sent
    transport.overrides.set(SYMBOL_1N4148_PATH, { status: 429, headers: { "retry-after": new Date(NOW + 2 * HOUR_MS).toUTCString(), "content-type": "text/plain" }, body: "slow down" });
    expect(await fetchSymbol()).toMatchObject({ ok: false, code: "rate_limited", status: 429, retryAtMs: NOW + HOUR_MS });
    expect(transport.requests).toHaveLength(2);
    // the parser itself: a wait inside the hour is kept exactly, a longer one is cut to the hour
    expect(retryAfterAt("1800", NOW)).toBe(NOW + 1_800_000);
    expect(retryAfterAt("7200", NOW)).toBe(NOW + HOUR_MS);
  });

  it("[K1 5] [K2, 2026-11-04] REWRITTEN to K2's contract (was CURRENT agent/cad-acquisition-reads.ts:135: a chat start answered a plain read, no typed event, the activity line '— done'): the start answers its own outcome kind (cad-acquisition-reads.ts:135) and the loop emits tool_finished 'acquisition_task_started' and the typed acquisition_task_ready (agent/contracts.ts AgentRunEvent) carrying the task's reference; the model's result text is the read it always got; the activity line says a worker runs it", async () => {
    const run = await chatAcquisitionRun({ workerClaimsBeforeThirdRead: false });
    expect(run.result.status).toBe("completed");
    const forStart = run.events.filter((event) => "callId" in event && event.callId === "c1");
    expect(forStart.map((event) => event.type)).toEqual(["tool_started", "tool_finished", "acquisition_task_ready"]);
    expect(forStart[1]).toMatchObject({ toolId: CAD_ACQUISITION_START_TOOL_ID, ok: true, status: "acquisition_task_started" });
    const ready = forStart[2] as Extract<AgentRunEvent, { type: "acquisition_task_ready" }>;
    expect(ready).toMatchObject({ runId: "run-k1", toolId: CAD_ACQUISITION_START_TOOL_ID, callId: "c1", task: { schema: "sirkit.cad-acquisition-task-ref.v1", taskId: run.taskId, disposition: "started", scope: { projectId: SCOPE.projectId, branchId: SCOPE.branchId }, state: "queued", refDes: ["D1", "D2"] } });
    expect(Object.keys(ready.task).sort()).toEqual(["disposition", "durability", "nextAction", "refDes", "schema", "scope", "stage", "state", "taskId"]); // identities and public state only
    // the model is told exactly what it was told before (the report of a read): no contract change, no version bump
    expect(reportOf(run.results.flat().find((result) => result.callId === "c1")!)).toMatchObject({ mode: "start", attached: false });
    expect([...new Set(run.events.map((event) => event.type))].sort()).toEqual(["acquisition_task_ready", "run_completed", "run_started", "text_delta", "tool_finished", "tool_refused", "tool_started", "warning"]);
    // the union names the event (a generation task has its own: generation_task_ready)
    const contracts = read("app/lib/agent/contracts.ts");
    const union = contracts.slice(contracts.indexOf("export type AgentRunEvent ="), contracts.indexOf("export interface AgentRunResult"));
    expect(union).toContain('type: "generation_task_ready"');
    expect(union).toContain('type: "acquisition_task_ready"');
    // the lines the page's activity entry shows for it: a started line that is a dispatch, and a finished line that is not "done"
    expect(resolutionProgressLine(forStart[0]!)).toBe("Starting (or finding) the durable acquisition task for the part's KiCad assets — no design change");
    const finished = toolLineLabel(forStart[1] as Extract<AgentRunEvent, { type: "tool_finished" }>);
    expect(finished).toMatch(/ — acquisition task started — a worker runs it in saved steps; nothing in the design changed$/);
    expect(finished).not.toMatch(/ — done$/);
    expect((await componentResolutionStoreOf(run.runtime).get(SCOPE, run.taskId))!.task.state).toBe("queued");
  });

  it("[K1 6] [K2, 2026-11-04] REWRITTEN to K2's contract (was CURRENT project/generation-task-client.ts:87-121: the browser's reader dropped allowance.remaining): the reader keeps the server snapshot's allowance (generation-task/snapshot.ts:75, :170; client :110) and generationTaskAllowanceText is the Work log's allowance line - task units, never money; the counts line is unchanged", async () => {
    const T0 = Date.parse("2026-11-04T12:00:00.000Z");
    const store = new GenerationTaskStore({ repository: new InMemoryDurableWorkflowRepository(), clock: () => T0 });
    const started = await store.createOrAttach({
      scope: { tenantId: "tenant-k1", projectId: "project-k1-allowance", branchId: "main" }, principal: { principalId: "user-k1-editor", role: "pcb_editor", membershipRevision: "mbr1-0123456789abcdef" }, origin: "build", chatRunId: null,
      request: { clientRequestId: "00000000-0000-4000-8000-0000000000a1", prompt: "build me a simple drone controlling circuitly with 4 motors just a simple one", provider: "openai" },
      base: { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin", headMark: null },
      identities: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small", promptDigests: { plan: durableWorkflowDigest("plan"), build: durableWorkflowDigest("build"), subsystem: durableWorkflowDigest("subsystem") } },
      providerServable: true,
    });
    if (!started.ok) throw new Error(`start refused: ${started.code}`);
    const server = JSON.parse(JSON.stringify(buildGenerationTaskSnapshot(started.task, { nowMs: T0, processing: [] }))) as { allowance: { remaining: Record<string, number> } };
    expect(server.allowance.remaining).toMatchObject({ modelCalls: GENERATION_TASK_ALLOWANCE_UNIT.modelCalls, outputTokens: GENERATION_TASK_ALLOWANCE_UNIT.outputTokens, catalogSearches: GENERATION_TASK_ALLOWANCE_UNIT.catalogSearches });
    const view = readGenerationTaskSnapshot(server);
    if (!view) throw new Error("the browser's reader refused the server's own snapshot");
    expect(view.allowance?.remaining).toEqual(server.allowance.remaining);
    const reduced = reduceGenerationTaskView(null, { task: view, events: [], gap: false }).view;
    expect(generationTaskCountsText(reduced)).toMatch(/ elapsed · 0 model calls · 0 catalog searches$/);
    expect(generationTaskAllowanceText(reduced)).toBe("Allowance left: 60 model calls · 480,000 output tokens · 300 catalog searches (task units, not money; 0 of 4 extensions used)");
    expect(generationTaskAllowanceText(reduced)).not.toMatch(/\$|USD|dollar|cent/i);
  });

  it("[K1 7] CURRENT atomic/kicad-assets.ts:286-310 (:306): createModelAsset turns the caller's inspected: true into inspectionState 'safe' without reading the bytes (not even VRML here), which satisfies the mechanical profile (atomic/validation.ts:140-145); no production module calls it - flipped by K5", () => {
    const bytes = new TextEncoder().encode("this text is not a 3D model of anything");
    const origin = { sourceRecordId: "record_k1_model", libraryNickname: "K1", logicalName: "K1_Not_A_Model", sourceUri: "fixture://k1/not-a-model.wrl", licenseId: "license_k1_fixture" };
    const claimed = createModelAsset({ bytes, origin, mediaType: "model/vrml", inspected: true });
    const honest = createModelAsset({ bytes, origin, mediaType: "model/vrml", inspected: false });
    expect(claimed.inspectionState).toBe("safe");
    expect(honest.inspectionState).toBe("not_inspected");
    expect(claimed.diagnostics).toEqual([]);
    expect(claimed).not.toHaveProperty("boundingBox");
    expect({ ...claimed, inspectionState: "not_inspected" }).toEqual(honest); // the boolean is the ONLY difference
    // the mechanical profile reads that state alone: the boolean removes the model's blocker
    const modelBlockers = (model: ModelAssetVersion): string[] => evaluateApproval(revisionWithModel(model), "mechanically_complete", contextWithModel(model)).blockers.filter((blocker) => blocker.includes(model.versionId));
    expect(modelBlockers(honest)).toEqual([`3D model ${honest.versionId} is not safely resolved`]);
    expect(modelBlockers(claimed)).toEqual([]);
    expect(productionFilesNaming("createModelAsset(")).toEqual(["app/lib/atomic/kicad-assets.ts"]); // its definition only
  });

  it("[K1 8] CURRENT pcb/3d/geom/footprint-mesh.ts:101-120 and pcb/3d/build-scene.ts:239-251: every footprint renders as a courtyard-sized box named footprint:<ref> with nothing in the scene labelling it a placeholder, and the viewer's toggle calls the boxes 'Parts' (components/pcb/PcbPreview3D.tsx:43) - flipped by K6", () => {
    const board = buildRoutedDemo();
    const scene = buildScene(board, { palette: PALETTES[DEFAULT_PALETTE_ID], showMask: true, showSilk: true, showZones: true, showFootprints: true, showRefdes: true });
    try {
      const expected = board.footprints.filter(isPlaceholderCandidate);
      expect(expected.length).toBeGreaterThan(0);
      expect(scene.footprints.children.map((group) => group.name)).toEqual(expected.map((footprint) => `footprint:${footprint.ref}`));
      for (const group of scene.footprints.children) {
        expect(group.children).toHaveLength(1);
        const box = group.children[0] as THREE.Mesh;
        expect(box).toBeInstanceOf(THREE.Mesh);
        expect(box.geometry).toBeInstanceOf(THREE.BoxGeometry);
        expect(box.name).toBe("");
        expect(group.userData).toEqual({});
        expect(box.userData).toEqual({});
      }
      const labels: string[] = [];
      scene.footprints.traverse((object) => labels.push(object.name, JSON.stringify(object.userData)));
      expect(labels.join(" ")).not.toMatch(/placeholder|approximat|generated|not a manufacturer/i);
    } finally {
      disposeScene(scene);
    }
    const viewer = read("app/components/pcb/PcbPreview3D.tsx");
    expect(viewer).toContain('{ layer: "footprints", label: "Parts" },');
    expect(viewer.match(/placeholder/gi)).toEqual(["placeholder"]); // the focus box's input placeholder ("Focus J1…") only
  });

  it("[K1 9] CURRENT atomic/ingestion.ts:157-207 (:177, :186): collectAdapterPages retries a page twice by default and waits min(5 s, Retry-After) - a 120 s Retry-After becomes 5 s - then gives up; no production module calls it, so K adopts nothing from it (a tripwire: no K increment changes it)", async () => {
    let calls = 0;
    const waits: number[] = [];
    const adapter: SourceAdapter = {
      id: "k1-rate-limited", source: cadSourceIdentity("fixture-kicad"), allowedHosts: [FIXTURE_CAD_HOST],
      async fetchPage() { calls += 1; throw new SourceAdapterError("rate_limited", "the source asked for a 120 s wait", 120_000); },
    };
    await expect(collectAdapterPages(adapter, 60_000, { wait: async (milliseconds) => { waits.push(milliseconds); } })).rejects.toThrow(/120 s wait/);
    expect(calls).toBe(3);
    expect(waits).toEqual([5_000, 5_000]);
    expect(productionFilesNaming("collectAdapterPages(")).toEqual(["app/lib/atomic/ingestion.ts"]); // its definition only
  });
});

// ── helpers (after the describe block) ──

type AcquisitionReport = { mode: string; attached?: boolean; tasks: Array<{ taskId: string; state: string }> };
function reportOf(result: AgentToolResult): AcquisitionReport {
  const parsed = JSON.parse(result.outputText) as { ok: boolean; output?: { report?: AcquisitionReport } };
  if (!parsed.ok || !parsed.output?.report) throw new Error(`not an acquisition report: ${result.outputText.slice(0, 300)}`);
  return parsed.output.report;
}

function chatContext(): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE, schematic: fixtureDimmerSheet() as SchematicState, schematicHeadMark: HEAD_MARK,
    verifiedActor: { principalId: "user:k1-editor", actorRole: "pcb_editor", membershipRevision: "mbr1-k1", authMethod: "local_dev" },
    catalogInspectionAvailable: true, cadAcquisitionAvailable: true,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

/**
 * One chat run over the production gateway, registry and acquisition port, the model scripted: start the dimmer's acquisition, read its
 * status three times with the same arguments, answer. With `workerClaimsBeforeThirdRead` a worker claims the task's slice (the store's
 * real claim) after the second read returned, so the stored task has changed before the third read is asked for.
 */
async function chatAcquisitionRun(options: { workerClaimsBeforeThirdRead: boolean }) {
  const registry = sirkitToolRegistry();
  const catalog = resolveCatalogInspectionPort();
  const port = resolveCadAcquisitionPort(catalog);
  if (!catalog || !port) throw new Error("the production acquisition port did not resolve under the fixture runtime");
  const runtime = fixtureRuntime();
  const events: AgentRunEvent[] = [];
  const results: AgentToolResult[][] = [];
  const names = { start: "", status: "" };
  let taskId = "";
  const call = (callId: string, providerName: string, args: Record<string, unknown>): AgentStep["toolCalls"][number] => ({ callId, providerName, argumentsText: JSON.stringify(args) });
  const step = (partial: Partial<AgentStep>): AgentStep => ({ text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "k1-scripted", continuation: { provider: "openai", state: null }, ...partial });
  const script: Array<(last: readonly AgentToolResult[]) => Promise<Partial<AgentStep>>> = [
    async () => ({ toolCalls: [call("c1", names.start, REQUEST)] }),
    async (last) => { taskId = reportOf(last[0]!).tasks[0]!.taskId; return { toolCalls: [call("c2", names.status, { taskId })] }; },
    async () => ({ toolCalls: [call("c3", names.status, { taskId })] }),
    async () => {
      if (options.workerClaimsBeforeThirdRead) {
        const claimed = await componentResolutionStoreOf(runtime).claimSlices({ workerId: "k1-worker", limit: 1, revalidate: async () => ({ ok: true }) });
        expect(claimed.map((outcome) => outcome.outcome)).toEqual(["claimed"]);
      }
      return { toolCalls: [call("c4", names.status, { taskId })] };
    },
    async () => ({ text: "The acquisition task is running; I will check it again later." }),
  ];
  let index = 0;
  const adapter: ProviderAgentAdapter = {
    provider: "openai",
    async start(input) {
      names.start = input.tools.find((tool) => tool.toolId === CAD_ACQUISITION_START_TOOL_ID)?.providerName ?? "";
      names.status = input.tools.find((tool) => tool.toolId === CAD_ACQUISITION_STATUS_TOOL_ID)?.providerName ?? "";
      expect(names.start && names.status, "both acquisition tools are declared to the model").toBeTruthy();
      return step(await script[index++]!([]));
    },
    async continueWith(input) {
      results.push([...input.results]);
      return step(await script[index++]!(input.results));
    },
  };
  const gateway = createAgentToolGateway(registry, { catalogInspection: catalog, cadAcquisition: port });
  const result = await runAgentLoop(
    { runId: "run-k1", provider: "openai", history: [], userMessage: "Find the footprint for D1 and D2 and keep checking on it.", budget: DEFAULT_AGENT_BUDGET },
    { adapter, gateway, registry, context: chatContext(), system: "k1 scripted run", emit: (event) => events.push(event) },
  );
  return { result, events, results, taskId, runtime };
}

/** A revision whose one primary bundle names the model (every other asset absent: only the model's own blocker is read). */
function revisionWithModel(model: ModelAssetVersion): AtomicPartRevision {
  return {
    schemaVersion: 1, id: "revision_k1", logicalPartId: "logical_k1", revision: 1, exactPartId: "exact_k1",
    cadBundles: [{ symbolVersionId: "symbolv_k1", footprintVersionId: "footprintv_k1", modelVersionIds: [model.versionId], disposition: "primary_approved" }],
    claimIds: [], guidanceIds: [], offerSnapshotIds: [], licenseIds: [model.origin.licenseId], publicationState: "draft",
    validatorVersion: ATOMIC_VALIDATOR_VERSION, policyVersion: "k1", semanticHash: "0".repeat(64), createdAt: "2026-11-04T00:00:00.000Z", createdBy: "user:k1-editor", reviewHistory: [],
  };
}
function contextWithModel(model: ModelAssetVersion): ValidationContext {
  return { symbols: new Map(), footprints: new Map(), models: new Map([[model.versionId, model]]), mappings: new Map(), claims: new Map(), licenses: new Map() };
}
