/**
 * [B21 D3] The published pin-facts reads for a proposing specialist (OD-109 amended). The runtime - the specialists' composition
 * root, `app/api/chat/orchestration-runtime.ts`, never the route - resolves the SAME source the route resolves
 * (`resolveReplacementPinFactsSource`) and builds the specialist gateway with the SAME bounded reader the coordinator's gateway
 * receives (`loadRunReplacementPinFacts`, bound to the request's own signal and `DEFAULT_PIN_FACTS_DEADLINE_MS`) - that ONE option
 * and nothing else: no minter, no prompt version, no port, no executor. Proven: the options the specialist gateway is built with,
 * enumerated through the production runtime (the gateway factory observed); the reader's import closure walked as A's gate walks
 * the orchestration modules - it reaches no grant, approval, reauthorization, release, executor or build module, its provider-SDK
 * reach is exactly the recorded D21-32 chain and its one network client the catalog's own database client, and every module it
 * adds to the runtime's closure is one the coordinator's composition root (the route) already reaches through the same reader; an
 * ABSENT source (no configured catalog) leaves the specialist's replacement blocked `current-pin-authority-unavailable` exactly as
 * the coordinator's, never faked; the reader is bound to the request's signal (an aborted request aborts the read, a pre-aborted one
 * never reads) and to the deadline.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectProductionFiles, moduleReferences, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentToolInvocationGateway } from "@/app/lib/agent/contracts";
import { createAgentToolGateway, type AgentGatewayOptions } from "@/app/lib/agent/gateway";
import { DEFAULT_PIN_FACTS_DEADLINE_MS, loadRunReplacementPinFacts, resolveReplacementPinFactsSource, setReplacementPinFactsSourceFactory, type ReplacementPinFactsSource } from "@/app/api/chat/replacement-facts-runtime";
import { resetOrchestrationStoreFactory, resetSpecialistSchedulerFactory, routerFactsOf, runOrchestratedChat, setOrchestrationStoreFactory, setSpecialistSchedulerFactory, specialistGatewayOptions } from "@/app/api/chat/orchestration-runtime";
import { DurableOrchestrationRunStore } from "../store";
import { routeTaskComplexity } from "../router";
import { runSpecialistDag, specialistContextFor } from "../scheduler";
import { ToolCallingSpecialists, type SpecialistScript } from "./_d2-fixtures";
import { CURRENT_FACTS, REPLACEMENT, SCENARIO_17, TIMER, installCatalog, principalOf, resetCatalog, timerContext, timerEditor } from "./_d3-fixtures";

/** Every gateway the process constructs, observed: its options object (null when none) and the instance, in construction order. */
const built = vi.hoisted(() => ({ gateways: [] as Array<{ options: Record<string, unknown> | null; instance: unknown }> }));
vi.mock("@/app/lib/agent/gateway", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/gateway")>();
  return {
    ...original,
    createAgentToolGateway: (registry: Parameters<typeof original.createAgentToolGateway>[0], options?: Parameters<typeof original.createAgentToolGateway>[1]) => {
      const instance = original.createAgentToolGateway(registry, options);
      built.gateways.push({ options: options ? (options as Record<string, unknown>) : null, instance });
      return instance;
    },
  };
});

const ROOT = process.cwd();
const REGISTRY = sirkitToolRegistry();
const READER = "app/api/chat/replacement-facts-runtime.ts";
const RUNTIME = "app/api/chat/orchestration-runtime.ts";
const ROUTE = "app/api/chat/route.ts";
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
/** A's forbidden families (b21-a-import-gates.test.ts), by prefix, plus the API tree the reader itself lives in. */
const FAMILY_PREFIXES: ReadonlyArray<[string, string]> = [["GRANTS", "app/lib/execution-grant/"], ["REAUTH", "app/lib/project/membership-reauthorization"], ["APPROVALS", "app/lib/engineering/approved-"], ["APPROVALS", "app/lib/engineering/agent-execution-journal"], ["RELEASE", "app/lib/pcb/fab/"], ["EXECUTOR", "app/lib/engineering/executor.ts"], ["BUILD_MULTI", "app/api/schematic/build-multi/"], ["BUILD_LOOP", "app/lib/build-loop.ts"], ["API", "app/api/"]];
const familyOf = (path: string): string | null => FAMILY_PREFIXES.find(([, prefix]) => path.startsWith(prefix) && !path.includes("/__tests__/"))?.[0] ?? null;
const SDK_SPECIFIER = /^(?:openai|@anthropic-ai\/sdk)(?:\/.*)?$/;
/** the bare (package or node built-in) specifiers a closure imports for its VALUE, each with the first chain that imports it */
function bareRuntimeSpecifiers(files: FileMap, closure: ReadonlyMap<string, readonly string[]>): Map<string, string> {
  const found = new Map<string, string>();
  for (const [file, chain] of closure) {
    const source = files.get(file)!;
    const runtime = runtimeDeclarationSpecifiers(file, source);
    for (const reference of moduleReferences(file, source)) {
      if (reference.kind === "import-type") continue;
      if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
      if (reference.specifier.startsWith(".") || reference.specifier.startsWith("@/")) continue;
      if (!found.has(reference.specifier)) found.set(reference.specifier, [...chain, reference.specifier].join(" -> "));
    }
  }
  return found;
}

describe("[B21 D3] the published pin-facts reads reach the replacement's sealer in a specialist run - and nothing else does", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", ""); // the shell never decides an outcome: no production source is ever built from the environment
    built.gateways = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetCatalog();
    resetOrchestrationStoreFactory();
    resetSpecialistSchedulerFactory();
  });

  it("1. the specialist gateway is built with the pin-facts reader and NOTHING ELSE: through the production runtime the one gateway it constructs carries exactly `replacementPinFacts` (the scheduler receives that very instance); `specialistGatewayOptions` returns that one key - never a minter, a prompt version, a port, an executor or a service; without a configured source it returns nothing and the runtime builds the specialist gateway with NO option at all (B21-C's structural shape); in the runtime's text the specialist gateway has one construction, over that function, whose body reads the route's source and the route's reader", async () => {
    const catalog = await installCatalog();
    const live = await principalOf();
    const editor = await timerEditor();
    const context = timerContext(editor, catalog.authority, live);
    const handed: AgentToolInvocationGateway[] = [];
    setSpecialistSchedulerFactory(() => async (plan, coordinator, deps) => { handed.push(deps.gateway); return runSpecialistDag(plan, coordinator, deps); });
    const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    setOrchestrationStoreFactory(() => store);
    const plan = routeTaskComplexity(SCENARIO_17, routerFactsOf(context));
    if (plan.kind !== "dag") throw new Error("scenario 17 must route to a DAG");
    const coordinatorGateway = createAgentToolGateway(REGISTRY, { promptVersion: AGENT_SYSTEM_PROMPT_VERSION });
    built.gateways = [];
    const controller = new AbortController();
    await runOrchestratedChat({ request: { runId: "run-b21d3-options", provider: "openai", history: [], userMessage: SCENARIO_17, budget: DEFAULT_AGENT_BUDGET, signal: controller.signal }, deps: { adapter: new ToolCallingSpecialists({}), gateway: coordinatorGateway, registry: REGISTRY, context, system: AGENT_SYSTEM_PROMPT, emit: () => undefined }, plan, startedAt: Date.now() });
    expect(built.gateways).toHaveLength(1);
    expect(Object.keys(built.gateways[0]!.options ?? {})).toEqual(["replacementPinFacts"]);
    expect(typeof built.gateways[0]!.options!.replacementPinFacts).toBe("function");
    expect(handed).toEqual([built.gateways[0]!.instance]);
    // the function itself: exactly one key whatever the signal; the closed list of what it never carries
    const options = specialistGatewayOptions(new AbortController().signal);
    expect(Object.keys(options ?? {})).toEqual(["replacementPinFacts"]);
    const never: ReadonlyArray<keyof AgentGatewayOptions> = ["executionGrants", "promptVersion", "externalAcquisition", "mcpObservation", "routingExecutor", "readService", "proposalService", "layoutProposalService", "externalReadService", "mcpObservationService", "now"];
    for (const key of never) expect(options, key).not.toHaveProperty(key);
    // no configured catalog: no option at all - and the runtime builds the specialist gateway exactly as B21-C left it
    setReplacementPinFactsSourceFactory(() => null);
    expect(resolveReplacementPinFactsSource()).toBeNull();
    expect(specialistGatewayOptions()).toBeUndefined();
    built.gateways = [];
    await runOrchestratedChat({ request: { runId: "run-b21d3-options-none", provider: "openai", history: [], userMessage: SCENARIO_17, budget: DEFAULT_AGENT_BUDGET }, deps: { adapter: new ToolCallingSpecialists({}), gateway: coordinatorGateway, registry: REGISTRY, context, system: AGENT_SYSTEM_PROMPT, emit: () => undefined }, plan, startedAt: Date.now() });
    expect(built.gateways.map((entry) => entry.options)).toEqual([null]);
    // the runtime's text: one specialist-gateway construction, over the one function, which names the route's source and reader only
    const runtime = read(RUNTIME);
    expect(runtime.match(/createAgentToolGateway\(/g)).toHaveLength(1);
    expect(runtime).toContain("const specialistGateway = createAgentToolGateway(deps.registry, specialistGatewayOptions(request.signal));");
    expect(runtime).toContain('import { DEFAULT_PIN_FACTS_DEADLINE_MS, loadRunReplacementPinFacts, resolveReplacementPinFactsSource } from "./replacement-facts-runtime";');
    const body = runtime.slice(runtime.indexOf("export function specialistGatewayOptions("));
    expect(body).toContain("return { replacementPinFacts: (atomicPartRevisionId, role) => loadRunReplacementPinFacts(source, atomicPartRevisionId, signal, DEFAULT_PIN_FACTS_DEADLINE_MS, role) };");
    for (const forbidden of ["executionGrants", "createExecutionGrantMinter", "promptVersion", "externalAcquisition", "mcpObservation", "routingExecutor", "resolveExternalAcquisitionPort", "resolveMcpObservationPort", "Freerouting"]) expect(body, forbidden).not.toContain(forbidden);
    // the SAME reader and deadline the route hands the coordinator's gateway (route.ts, unchanged by D3)
    expect(read(ROUTE)).toContain("loadRunReplacementPinFacts(replacementFactsSource, atomicPartRevisionId, signal, DEFAULT_PIN_FACTS_DEADLINE_MS, role)");
  }, 180_000);

  it("2. the reader's import closure, walked as A's gate walks the orchestration modules: it reaches no grant, reauthorization, approval, release, executor or build module; its only API-tree members are the reader and its cancellable reads; its provider-SDK reach is exactly the recorded D21-32 chain (the database client's schema); its one network client is that database client (the catalog read itself); the SIX modules it adds to the runtime's closure are named and every one is already in the coordinator's composition root's closure (the route reaches them through the same reader), and the SDK and the database client were already in the runtime's own closure (D21-32) - nothing the coordinator's read does not already use", () => {
    const production = collectProductionFiles(ROOT);
    const reader = importClosure(production, [READER]);
    expect(reader.size).toBeGreaterThan(20); // not vacuous
    const families = [...reader].flatMap(([file, chain]) => { const family = familyOf(file); return family === null ? [] : [`${family}: ${chain.join(" -> ")}`]; });
    expect(families).toEqual([`API: ${READER}`, `API: ${READER} -> app/api/chat/authority-cancellable-reads.ts`]);
    const bare = bareRuntimeSpecifiers(production, reader);
    expect([...bare.keys()].filter((specifier) => SDK_SPECIFIER.test(specifier)).map((specifier) => bare.get(specifier))).toEqual([`${READER} -> app/lib/db/client.ts -> app/lib/db/schema.ts -> app/lib/embeddings.ts -> openai`]);
    // the network-capable clients: the catalog read's database client only (node:net is `isIP`, an address parser - ip-policy.ts)
    const NETWORK = /^(?:postgres|undici|axios|node-fetch|ws|node:(?:https?|http2|dns(?:\/promises)?|tls|dgram|net))$/;
    expect([...bare.keys()].filter((specifier) => NETWORK.test(specifier)).sort()).toEqual(["node:net", "postgres"]);
    expect(bare.get("postgres")).toBe(`${READER} -> app/lib/db/client.ts -> postgres`);
    expect(read("app/lib/net/ip-policy.ts")).toMatch(/^import \{ isIP \} from "node:net";$/m);
    // what the reader ADDS to the runtime's closure (the runtime walked with the reader as a bridge: its closure before D3's import)
    const runtimeBefore = importClosure(production, [RUNTIME], new Set([READER]));
    const added = [...reader.keys()].filter((file) => !runtimeBefore.has(file)).sort();
    expect(added).toEqual(["app/api/chat/authority-cancellable-reads.ts", READER, "app/lib/atomic/revision-status-sql.ts", "app/lib/atomic/server-catalog.ts", "app/lib/fixture-runtime/blinker/authority.ts", "app/lib/physical-binding/server-repository.ts"]);
    // ... every one already reached by the coordinator's composition root WITHOUT the runtime (the route imports the reader itself)
    const routeWithoutRuntime = importClosure(production, [ROUTE], new Set([RUNTIME]));
    for (const file of added) expect(routeWithoutRuntime.has(file), file).toBe(true);
    expect(read(ROUTE)).toMatch(/^import \{ DEFAULT_PIN_FACTS_DEADLINE_MS, loadRunReplacementPinFacts, resolveReplacementPinFactsSource \} from "\.\/replacement-facts-runtime";$/m);
    // ... and the SDK chain and the database client were in the runtime's closure before D3 (D21-32, through the durable runtime)
    const before = bareRuntimeSpecifiers(production, runtimeBefore);
    expect(before.has("openai")).toBe(true);
    expect(before.has("postgres")).toBe(true);
    expect(runtimeBefore.has("app/lib/db/client.ts")).toBe(true);
    // the one module with a writer class among the added (the physical-binding repository) is reached for the fixture runtime's
    // AUTHORITY source; the fixture pin-facts source beside it reads the committed catalog's published snapshots only
    const fixture = read("app/lib/fixture-runtime/blinker/authority.ts");
    const from = fixture.indexOf("export function fixtureReplacementPinFactsSource(");
    const pinFactsSource = fixture.slice(from, fixture.indexOf("\n}\n", from) + 2);
    expect(pinFactsSource).toContain("loadPublishedPortableSnapshot(atomicPartRevisionId)");
    expect(pinFactsSource).not.toMatch(/Repository|commit\(|insert|update|delete/i);
    const readerText = read(READER);
    expect(readerText).not.toMatch(/\.(?:commit|insert|update|delete|execute)\(/);
  }, 180_000);

  it("3. an ABSENT source (no configured catalog) leaves the specialist's replacement BLOCKED `current-pin-authority-unavailable` exactly as the coordinator's: through the production runtime the schematic specialist is offered the replacement (the loop's prerequisites are the head mark and the authority, not the source), its call is refused by the family's assembler with that blocker and seals nothing - nothing is faked, nothing presented; the coordinator's gateway built as the route builds it without a source blocks the same call with the same blocker", async () => {
    const catalog = await installCatalog(undefined, { pinFacts: null });
    expect(resolveReplacementPinFactsSource()).toBeNull();
    const live = await principalOf();
    const editor = await timerEditor();
    const context = timerContext(editor, catalog.authority, live);
    const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    setOrchestrationStoreFactory(() => store);
    const plan = routeTaskComplexity(SCENARIO_17, routerFactsOf(context));
    if (plan.kind !== "dag") throw new Error("scenario 17 must route to a DAG");
    const adapter = new ToolCallingSpecialists({ schematic: { call: { toolId: REPLACEMENT, args: { componentId: TIMER } } } } satisfies Record<string, SpecialistScript>);
    const events: AgentRunEvent[] = [];
    const coordinatorGateway = createAgentToolGateway(REGISTRY, { promptVersion: AGENT_SYSTEM_PROMPT_VERSION }); // the route's composition without a source: no pin-facts option
    await runOrchestratedChat({ request: { runId: "run-b21d3-no-source", provider: "openai", history: [], userMessage: SCENARIO_17, budget: DEFAULT_AGENT_BUDGET }, deps: { adapter, gateway: coordinatorGateway, registry: REGISTRY, context, system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event) }, plan, startedAt: Date.now() });
    expect(adapter.starts.find((start) => start.role === "schematic")!.tools).toContain(REPLACEMENT);
    const specialist = JSON.parse(adapter.continued.find((entry) => entry.task === "task-3-schematic")!.results[0]!.outputText) as { ok: boolean; status: string; blockers: Array<{ code: string }> };
    expect(specialist).toMatchObject({ ok: false, status: "proposal_blocked" });
    expect(specialist.blockers.map((blocker) => blocker.code)).toEqual(["current-pin-authority-unavailable"]);
    expect(events.filter((event) => event.type === "proposal_ready")).toEqual([]);
    const committed = (await store.history({ tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId: "run-b21d3-no-source" })).filter((entry) => entry.record.kind === "result").map((entry) => (entry.record as unknown as { document: { proposedActions: unknown[] } }).document.proposedActions.length);
    expect(committed).toEqual([0, 0, 0, 0]);
    // the coordinator's own call, the same component, the same verified state: the same blocker
    const descriptor = REGISTRY.get(REPLACEMENT)!;
    const outcome = await coordinatorGateway.invoke({ runId: "run-b21d3-no-source", provider: "openai", callId: "call-coordinator", toolId: REPLACEMENT, version: descriptor.version, args: { componentId: TIMER }, context, timeoutMs: 5_000 });
    expect(outcome.kind === "proposal-blocked" && outcome.blockers.map((blocker) => blocker.code)).toEqual(["current-pin-authority-unavailable"]);
    // and the specialist's own context through a gateway built by the runtime's function with no source: the same again
    const bare = createAgentToolGateway(REGISTRY, specialistGatewayOptions());
    const own = await bare.invoke({ runId: "run-b21d3-no-source:task-3-schematic", provider: "openai", callId: "call-specialist", toolId: REPLACEMENT, version: descriptor.version, args: { componentId: TIMER }, context: specialistContextFor(context, "schematic"), timeoutMs: 5_000 });
    expect(own.kind === "proposal-blocked" && own.blockers.map((blocker) => blocker.code)).toEqual(["current-pin-authority-unavailable"]);
  }, 180_000);

  it("4. the reader is bound to the REQUEST's signal and to DEFAULT_PIN_FACTS_DEADLINE_MS: through the runtime, the specialist gateway's reader answers the catalog before the request is aborted and, once it is, never reads again (no I/O, null); an in-flight read settles null the moment the request aborts and its own read is aborted; a read that outlives the deadline settles null at exactly the deadline and is aborted - never earlier", async () => {
    // through the runtime: the options object the runtime built for THIS request
    const catalog = await installCatalog();
    const live = await principalOf();
    const editor = await timerEditor();
    const context = timerContext(editor, catalog.authority, live);
    setOrchestrationStoreFactory(() => new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository()));
    setSpecialistSchedulerFactory(() => async () => ({ kind: "refused", reason: "plan_empty", detail: "the reader is what this case observes" }));
    const plan = routeTaskComplexity(SCENARIO_17, routerFactsOf(context));
    if (plan.kind !== "dag") throw new Error("scenario 17 must route to a DAG");
    const request = new AbortController();
    const coordinatorGateway = createAgentToolGateway(REGISTRY, { promptVersion: AGENT_SYSTEM_PROMPT_VERSION });
    built.gateways = [];
    await runOrchestratedChat({ request: { runId: "run-b21d3-signal", provider: "openai", history: [], userMessage: SCENARIO_17, budget: DEFAULT_AGENT_BUDGET, signal: request.signal }, deps: { adapter: new ToolCallingSpecialists({}), gateway: coordinatorGateway, registry: REGISTRY, context, system: AGENT_SYSTEM_PROMPT, emit: () => undefined }, plan, startedAt: Date.now() });
    const reader = built.gateways[0]!.options!.replacementPinFacts as NonNullable<AgentGatewayOptions["replacementPinFacts"]>;
    expect(await reader("rev-current", "current")).toEqual(CURRENT_FACTS);
    const readsBefore = catalog.pinFacts!.reads.length;
    expect(readsBefore).toBe(1);
    expect(catalog.pinFacts!.reads[0]!.signal).toBeInstanceOf(AbortSignal); // the settlement machine's own signal, never the caller's
    request.abort();
    expect(await reader("rev-current", "current")).toBeNull();
    expect(catalog.pinFacts!.reads).toHaveLength(readsBefore); // pre-aborted: no I/O
    // an in-flight read and the request's abort
    const hanging = (): ReplacementPinFactsSource & { signals: AbortSignal[] } => {
      const signals: AbortSignal[] = [];
      return { signals, loadPinFacts: (_revision, signal) => { if (signal) signals.push(signal); return new Promise(() => { /* never answers */ }); } };
    };
    const slow = hanging();
    setReplacementPinFactsSourceFactory(() => slow);
    const inFlight = new AbortController();
    const pending = specialistGatewayOptions(inFlight.signal)!.replacementPinFacts!("rev-current", "current");
    await Promise.resolve();
    expect(slow.signals).toHaveLength(1);
    expect(slow.signals[0]!.aborted).toBe(false);
    inFlight.abort();
    expect(await pending).toBeNull();
    expect(slow.signals[0]!.aborted).toBe(true);
    // the deadline: pending one millisecond before it, null at it, its read aborted
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const late = hanging();
    setReplacementPinFactsSourceFactory(() => late);
    let settled: unknown = "pending";
    const timed = specialistGatewayOptions(new AbortController().signal)!.replacementPinFacts!("rev-current", "target").then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(DEFAULT_PIN_FACTS_DEADLINE_MS - 1);
    expect(settled).toBe("pending");
    expect(late.signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await timed;
    expect(settled).toBeNull();
    expect(late.signals[0]!.aborted).toBe(true);
    // the route's reader, the same function under the same deadline: identical settlement
    expect(DEFAULT_PIN_FACTS_DEADLINE_MS).toBe(5_000);
    expect(await loadRunReplacementPinFacts(late, "rev-current", AbortSignal.abort(), DEFAULT_PIN_FACTS_DEADLINE_MS, "current")).toBeNull();
  }, 180_000);
});
