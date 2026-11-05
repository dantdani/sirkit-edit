/**
 * [PR-L, 2026-10-17] Shared seams of the increment-3 worker suites (l3-continuation, l3-long-task, l3-fencing, l3-crash-resume,
 * l3-strategies): a SIMULATED clock with the worker's interval timers driven by it, a scripted model port, a fake catalog port, trusted
 * scopes and memberships, the four-motor drone plan with pin-valid offline parts, and a driver that ticks a real `GenerationWorker` over
 * a real `GenerationTaskStore` until the task settles. No provider, no database, no network: a test that needs PostgreSQL brings PGlite
 * itself. Not a suite (no `.test.` in the name).
 *
 * The simulated clock: the suites fake `Date` only (`vi.useFakeTimers({ toFake: ["Date"] })`), so the slice core's windows
 * (`Date.now()`), the store's leases and the worker's renewals all read ONE clock, while promises and `setImmediate` stay real. The
 * worker's renewal and control-poll intervals are registered with `SimulatedTime` and fire as simulated time passes inside a model call.
 */
import { vi } from "vitest";
import { durableWorkflowDigest } from "../../durable-workflow/stable";
import type { DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import { InMemoryProjectMembershipRepository, type ProjectMembershipRecord } from "../../auth/project-membership";
import { LLMProviderError, type LLMProviderFailureReason } from "../../llm/errors";
import type { LLMMessage, LLMRequest, LLMResponse, LLMToolCall } from "../../llm/types";
import type { AiAlternateResult, AiPartResult } from "../../parts-search";
import type { BuildCatalogPort, BuildLlmPort } from "../../schematic/build-loop-slice";
import type { GenerationAllowanceUnit, GenerationTaskHead } from "../contracts";
import { GenerationTaskStore, type GenerationTaskStoreOptions } from "../store";
import type { GenerationStrategyId } from "../vocabulary";
import { createGenerationSliceRevalidator } from "../worker/runtime";
import { GenerationWorker, type GenerationWorkerOptions, type GenerationWorkerPolicy, type WorkerTimers } from "../worker/worker";

export const T0 = Date.parse("2026-10-17T12:00:00.000Z");
export const EDITOR = "user-l3-editor";
export const scopeFor = (name: string): DurableWorkflowScope => ({ tenantId: "tenant-l3", projectId: `project-l3-${name}`, branchId: "main" });
const iso = (ms: number) => new Date(ms).toISOString();

// ─── Simulated time ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Let every pending promise chain of the in-memory store settle (a few macrotask turns). */
export async function settle(turns = 4): Promise<void> {
  for (let index = 0; index < turns; index += 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
}

/** One clock for the store, the worker and the slice windows. Requires `vi.useFakeTimers({ toFake: ["Date"] })`. */
export class SimulatedTime implements WorkerTimers {
  private readonly intervals = new Map<number, { run: () => void; every: number; next: number }>();
  private nextId = 1;
  constructor(start = T0) { vi.setSystemTime(start); }
  now(): number { return Date.now(); }
  readonly clock = (): number => Date.now();
  setInterval(run: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.intervals.set(id, { run, every: Math.max(1, ms), next: Date.now() + Math.max(1, ms) });
    return id;
  }
  clearInterval(handle: unknown): void { this.intervals.delete(handle as number); }
  setTimeout(run: () => void, ms: number): unknown { return setTimeout(run, ms); }
  clearTimeout(handle: unknown): void { clearTimeout(handle as ReturnType<typeof setTimeout>); }
  /** Let `ms` of simulated time pass, firing the registered intervals (renewal, control poll) as they fall due. */
  async advance(ms: number): Promise<void> {
    const target = Date.now() + Math.max(0, ms);
    for (;;) {
      let due: { id: number; next: number } | null = null;
      for (const [id, entry] of this.intervals) if (entry.next <= target && (due === null || entry.next < due.next)) due = { id, next: entry.next };
      if (!due) break;
      vi.setSystemTime(Math.max(due.next, Date.now())); // never backwards (a concurrent jump may have moved the clock on)
      const entry = this.intervals.get(due.id)!;
      entry.next += entry.every;
      entry.run();
      await settle(2);
    }
    vi.setSystemTime(Math.max(target, Date.now()));
    await settle(2);
  }
  /** Jump straight to `at` (no interval fires: the worker is idle between ticks). */
  jump(at: number): void { if (at > Date.now()) vi.setSystemTime(at); }
}

// ─── Memberships ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function membership(scope: DurableWorkflowScope, userId = EDITOR, role: ProjectMembershipRecord["role"] = "editor", state: ProjectMembershipRecord["state"] = "active"): ProjectMembershipRecord {
  return { tenantId: scope.tenantId, projectId: scope.projectId, userId, role, state, version: 1, createdAt: iso(T0), updatedAt: iso(T0), auditActorId: "l3-fixture" };
}

// ─── The fake catalog ────────────────────────────────────────────────────────────────────────────────────────────────────

export function part(partId: string, name: string, mainCategory: string, pins: readonly string[]): AiPartResult {
  return { partId, name, mpn: `MPN-${partId}`, description: `Offline pin-valid fixture (${name}); not a component recommendation.`, mainCategory, pins: pins.map((pin, index) => ({ number: String(index + 1), name: pin, type: /GND|VDD|VIN|VOUT|VBAT/.test(pin) ? "power_in" : "passive" })), lifecycleStatus: "active", similarity: 0.9 };
}
export const PARTS = Object.freeze({
  mcu: part("p-mcu", "Offline flight MCU", "Microcontrollers", ["VDD", "GND", "PA0", "PA1", "PA2", "PA3", "SDA", "SCL"]),
  imu: part("p-imu", "Offline 6-axis IMU", "Sensors", ["VDD", "GND", "SDA", "SCL"]),
  cap: part("p-cap", "Offline 100 nF capacitor", "Capacitors", ["1", "2"]),
  reg: part("p-reg", "Offline 3.3 V LDO regulator", "Power Management", ["VIN", "VOUT", "GND"]),
  bat: part("p-bat", "Offline 2-pin battery connector", "Connectors", ["VBAT", "GND"]),
  fet: part("p-fet", "Offline logic-level N-MOSFET", "Transistors", ["G", "D", "S"]),
  diode: part("p-diode", "Offline Schottky flyback diode", "Diodes", ["A", "K"]),
});

/** A catalog whose searches are answered by keyword rules; every call is recorded. */
export class FakeCatalog implements BuildCatalogPort {
  readonly identity = { catalogProfile: "fixture-scripted" as const, embeddingModel: "text-embedding-3-small" };
  readonly parts = new Map<string, AiPartResult>();
  readonly rules: Array<{ pattern: RegExp; partIds: string[] }> = [];
  readonly searches: Array<{ query: string; category: string | undefined }> = [];
  readonly alternatesAsked: string[] = [];
  readonly byIds: string[][] = [];
  alternates = new Map<string, string[]>();
  /** a generated part for any query matching `candidate <n>` (a block that surfaces something new every turn) */
  generateCandidates = false;
  constructor() { for (const value of Object.values(PARTS)) this.parts.set(value.partId, structuredClone(value)); }
  rule(pattern: RegExp, ...partIds: string[]): this { this.rules.push({ pattern, partIds }); return this; }
  add(value: AiPartResult, pattern: RegExp): this { this.parts.set(value.partId, structuredClone(value)); return this.rule(pattern, value.partId); }
  async searchParts(query: string, category: string | undefined, limit: number): Promise<AiPartResult[]> {
    this.searches.push({ query, category });
    const candidate = /candidate (\d+)/i.exec(query);
    if (this.generateCandidates && candidate) {
      const generated = part(`p-cand-${candidate[1]}`, `Offline candidate ${candidate[1]}`, "Transistors", ["G", "D", "S"]);
      this.parts.set(generated.partId, generated);
      return [structuredClone(generated)];
    }
    const ids = this.rules.filter((entry) => entry.pattern.test(query)).flatMap((entry) => entry.partIds);
    return [...new Set(ids)].slice(0, limit).map((id) => structuredClone(this.parts.get(id)!));
  }
  async findAlternates(partId: string): Promise<AiAlternateResult[]> {
    this.alternatesAsked.push(partId);
    return (this.alternates.get(partId) ?? []).map((id) => ({ partId: id, name: this.parts.get(id)!.name, mpn: null, manufacturer: null, lifecycleStatus: "active", score: 90, kind: "drop_in", matchReasons: ["same pins"], pinCount: this.parts.get(id)!.pins.length }));
  }
  async partsByIds(ids: string[]): Promise<AiPartResult[]> {
    this.byIds.push([...ids]);
    return ids.filter((id) => this.parts.has(id)).map((id) => structuredClone(this.parts.get(id)!));
  }
}
export function droneCatalog(): FakeCatalog {
  return new FakeCatalog()
    .rule(/mcu|microcontroller|flight controller/i, "p-mcu").rule(/imu|gyro|accelerometer/i, "p-imu").rule(/capacitor|decoupling/i, "p-cap")
    .rule(/regulator|ldo|3\.3/i, "p-reg").rule(/battery|connector/i, "p-bat").rule(/mosfet|transistor/i, "p-fet").rule(/diode|schottky|flyback/i, "p-diode");
}

// ─── The scripted model ──────────────────────────────────────────────────────────────────────────────────────────────────

export const reply = (toolCalls: LLMToolCall[], extra: Partial<LLMResponse> = {}): LLMResponse => ({ provider: "openai", model: "offline-l3", text: "", toolCalls, stopReason: "tool_use", usage: { inputTokens: 400, outputTokens: 60 }, ...extra });
export const search = (id: string, query: string, category?: string): LLMToolCall => ({ id, name: "search_parts", input: { query, ...(category ? { category } : {}) } });
export const submit = (id: string, netlist: object): LLMToolCall => ({ id, name: "submit_schematic", input: netlist as Record<string, unknown> });
export const alternatesCall = (id: string, partId: string): LLMToolCall => ({ id, name: "find_alternates", input: { partId, kind: "all" } });

/** The first user message's text (without a compaction note). */
export function firstText(messages: readonly LLMMessage[]): string {
  const first = messages[0]?.content;
  if (typeof first === "string") return first;
  const text = first?.[0];
  return text && text.type === "text" ? text.text : "";
}
export interface TurnContext {
  /** the turn of this conversation: one more than its assistant messages */
  turn: number;
  /** the block name ("" for the single design) */
  block: string;
  strategy: GenerationStrategyId;
  request: LLMRequest;
  first: string;
}
export type BlockScript = (context: TurnContext) => LLMResponse | Promise<LLMResponse>;
export type PlanScript = (request: LLMRequest, call: number) => LLMResponse | Promise<LLMResponse>;
/** A thrown provider failure, with the provider's Retry-After when given. */
export const providerError = (reason: LLMProviderFailureReason, retryAfterMs?: number): LLMProviderError => new LLMProviderError("openai", reason, reason === "rate_limit" ? 429 : reason === "overloaded" ? 529 : undefined, undefined, undefined, undefined, retryAfterMs);

/** The model port: the plan and each block answered by its script; each call takes `callMs(request)` of simulated time. */
export class ScriptedModel implements BuildLlmPort {
  readonly requests: LLMRequest[] = [];
  readonly calls: Array<{ kind: "plan" | "subplan" | "block"; block: string; strategy: GenerationStrategyId; turn: number; at: number }> = [];
  planCalls = 0;
  private blockCallsInProvider = 0;
  private readonly waiters: Array<{ count: number; resolve: () => void }> = [];
  /** Resolves once `count` block calls have reached the provider (their simulated duration passed; the answer is being decided):
   *  an event, never a polling deadline. */
  whenBlockCalls(count: number): Promise<void> {
    if (this.blockCallsInProvider >= count) return Promise.resolve();
    return new Promise((resolve) => { this.waiters.push({ count, resolve }); });
  }
  /** an override answering (or throwing) before the scripts, e.g. a hung or failing provider; return undefined to fall through */
  intercept: ((request: LLMRequest, kind: "plan" | "subplan" | "block", block: string) => Promise<LLMResponse | undefined> | LLMResponse | undefined) | null = null;
  constructor(
    private readonly scripts: { plan: PlanScript; blocks: Record<string, BlockScript>; subplan?: PlanScript },
    private readonly time: SimulatedTime | null = null,
    private readonly callMs: (kind: "plan" | "subplan" | "block", block: string) => number = () => 0,
  ) {}
  async generate(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push({ ...request, messages: structuredClone(request.messages), signal: undefined });
    const first = firstText(request.messages);
    const isPlan = typeof request.toolChoice === "object" && request.toolChoice !== null && request.toolChoice.name === "submit_plan";
    const kind: "plan" | "subplan" | "block" = isPlan ? (first.startsWith("Block: ") ? "subplan" : "plan") : "block";
    const block = /^Block: ([^\n]+)/.exec(first)?.[1] ?? "";
    const strategy = (/\[Design strategy (S[1-6]-[a-z-]+):/.exec(first)?.[1] ?? "S1-baseline") as GenerationStrategyId;
    const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
    this.calls.push({ kind, block, strategy, turn, at: Date.now() });
    const ms = this.callMs(kind, block);
    if (this.time && ms > 0) await this.time.advance(ms);
    if (request.signal?.aborted) throw new LLMProviderError("openai", "cancelled");
    if (kind === "block") {
      this.blockCallsInProvider += 1;
      for (const waiter of this.waiters.splice(0)) { if (this.blockCallsInProvider >= waiter.count) waiter.resolve(); else this.waiters.push(waiter); }
    }
    const intercepted = this.intercept ? await this.intercept(request, kind, block) : undefined;
    if (intercepted) return intercepted;
    if (kind === "plan") { this.planCalls += 1; return this.scripts.plan(request, this.planCalls); }
    if (kind === "subplan") return (this.scripts.subplan ?? (() => reply([])))(request, 0);
    const script = this.scripts.blocks[block] ?? this.scripts.blocks[""];
    if (!script) throw new Error(`no script for block ${block}`);
    return script({ turn, block, strategy, request, first });
  }
  callsOf(block: string): number { return this.calls.filter((call) => call.kind === "block" && call.block === block).length; }
}

// ─── The four-motor drone (the owner's request) ─────────────────────────────────────────────────────────────────────────

export const DRONE_PROMPT = "build me a simple drone controlling circuitly with 4 motors just a simple one";
export const DRONE_BLOCKS = Object.freeze([
  { name: "Flight controller", brief: "An MCU with an IMU on I2C and four PWM outputs.", sharedNets: ["+3V3", "GND", "PWM1", "PWM2", "PWM3", "PWM4"] },
  { name: "Power", brief: "A 1S battery input and a 3.3 V regulator.", sharedNets: ["VBAT", "+3V3", "GND"] },
  { name: "Motor drivers", brief: "Four logic-level N-MOSFET low-side channels with flyback diodes.", sharedNets: ["VBAT", "GND", "PWM1", "PWM2", "PWM3", "PWM4"] },
]);
export const planReply = (blocks: ReadonlyArray<{ name: string; brief: string; sharedNets: readonly string[] }> = DRONE_BLOCKS): LLMResponse =>
  reply([{ id: "call_plan", name: "submit_plan", input: { rationale: "A flight controller, its power stage and four motor channels.", blocks: blocks.map((block) => ({ ...block, sharedNets: [...block.sharedNets] })) } }], { stopReason: "tool_use", usage: { inputTokens: 900, outputTokens: 300 } });
const label = (pin: string, labelName: string) => ({ kind: "label", pin, labelName });
export const NETLISTS = Object.freeze({
  "Flight controller": {
    components: [{ refDes: "U1", partId: "p-mcu", value: "MCU", role: "processor" }, { refDes: "U2", partId: "p-imu", value: "IMU", role: "input" }, { refDes: "C1", partId: "p-cap", value: "100nF", role: "passive" }],
    connections: [label("U1.VDD", "+3V3"), label("U1.GND", "GND"), label("U2.VDD", "+3V3"), label("U2.GND", "GND"), { from: "U1.SDA", to: "U2.SDA" }, { from: "U1.SCL", to: "U2.SCL" }, label("U1.PA0", "PWM1"), label("U1.PA1", "PWM2"), label("U1.PA2", "PWM3"), label("U1.PA3", "PWM4"), label("C1.1", "+3V3"), label("C1.2", "GND")],
    explanation: "MCU and IMU on I2C; four PWM outputs to the motor channels.",
  },
  Power: {
    components: [{ refDes: "J1", partId: "p-bat", value: "1S", role: "connector" }, { refDes: "U3", partId: "p-reg", value: "3.3V LDO", role: "regulator" }, { refDes: "C2", partId: "p-cap", value: "100nF", role: "passive" }],
    connections: [label("J1.VBAT", "VBAT"), label("J1.GND", "GND"), label("U3.VIN", "VBAT"), label("U3.VOUT", "+3V3"), label("U3.GND", "GND"), label("C2.1", "+3V3"), label("C2.2", "GND")],
    explanation: "Battery input and a 3.3 V rail.",
  },
  "Motor drivers": {
    components: [1, 2, 3, 4].flatMap((n) => [{ refDes: `Q${n}`, partId: "p-fet", value: "N-MOSFET", role: "output" }, { refDes: `D${n}`, partId: "p-diode", value: "Schottky", role: "support", parentRefDes: `Q${n}` }]),
    connections: [1, 2, 3, 4].flatMap((n) => [label(`Q${n}.G`, `PWM${n}`), label(`Q${n}.S`, "GND"), { from: `Q${n}.D`, to: `D${n}.A` }, label(`D${n}.K`, "VBAT")]),
    explanation: "Four low-side channels with flyback diodes.",
  },
} as const);
const SEARCHES: Readonly<Record<string, readonly string[]>> = Object.freeze({ "Flight controller": ["flight controller mcu", "imu gyro", "decoupling capacitor"], Power: ["battery connector", "3.3 v ldo regulator", "decoupling capacitor"], "Motor drivers": ["logic level mosfet", "schottky flyback diode"] });
/** The default block script: search each of the block's parts, then submit its netlist. */
export function standardBlock(name: keyof typeof NETLISTS): BlockScript {
  const queries = SEARCHES[name]!;
  return ({ turn }) => (turn <= queries.length ? reply([search(`call_${name.replace(/\W/g, "")}_${turn}`, queries[turn - 1]!)]) : reply([submit(`call_${name.replace(/\W/g, "")}_submit_${turn}`, NETLISTS[name])]));
}
export const droneScripts = (overrides: Partial<Record<keyof typeof NETLISTS, BlockScript>> = {}) => ({
  plan: () => planReply(),
  blocks: { "Flight controller": standardBlock("Flight controller"), Power: standardBlock("Power"), "Motor drivers": standardBlock("Motor drivers"), ...overrides } as Record<string, BlockScript>,
});

// ─── The environment ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface L3Env {
  repository: DurableWorkflowRepository;
  store: GenerationTaskStore;
  time: SimulatedTime;
  memberships: InMemoryProjectMembershipRepository;
  scope: DurableWorkflowScope;
  /** a worker over this environment (a NEW instance each call: a restart) */
  worker(options?: { workerId?: string; llm?: BuildLlmPort; catalog?: BuildCatalogPort; policy?: Partial<GenerationWorkerPolicy>; store?: GenerationTaskStore; timers?: WorkerTimers; log?: (line: string) => void; runInScope?: GenerationWorkerOptions["runInScope"] }): GenerationWorker;
  logs: string[];
}
export function l3Env(input: { name: string; repository: DurableWorkflowRepository; model?: BuildLlmPort; catalog: BuildCatalogPort; storeOptions?: Omit<GenerationTaskStoreOptions, "repository" | "clock">; providerServable?: (provider: string) => boolean }): L3Env {
  const time = new SimulatedTime();
  const scope = scopeFor(input.name);
  const memberships = new InMemoryProjectMembershipRepository();
  memberships.set(membership(scope));
  const store = new GenerationTaskStore({ repository: input.repository, clock: time.clock, ...(input.storeOptions ?? {}) });
  const logs: string[] = [];
  let count = 0;
  return {
    repository: input.repository, store, time, memberships, scope, logs,
    worker: (options = {}) => new GenerationWorker({
      store: options.store ?? store, workerId: options.workerId ?? `worker-${input.name}-${(count += 1)}`, ports: { llm: options.llm ?? input.model ?? new ScriptedModel(droneScripts()), catalog: options.catalog ?? input.catalog },
      revalidate: createGenerationSliceRevalidator({ membership: () => memberships, providerServable: (provider) => (input.providerServable ? input.providerServable(provider) : true) }),
      clock: time.clock, random: () => 0.5, timers: options.timers ?? time, policy: { concurrency: 1, ...(options.policy ?? {}) },
      log: options.log ?? ((line) => { logs.push(line); }), ...(options.runInScope ? { runInScope: options.runInScope } : {}),
    }),
  };
}

let requestCounter = 0;
export const clientRequestId = (): string => `00000000-0000-4000-8000-${(requestCounter += 1).toString(16).padStart(12, "0")}`;
/** Accept a task the way the start API will (increment 4): the trusted scope, an editor principal, the Build pin. */
export async function startTask(env: Pick<L3Env, "store" | "scope">, options: { prompt?: string; allowanceUnit?: GenerationAllowanceUnit; principalId?: string } = {}): Promise<GenerationTaskHead> {
  const started = await env.store.createOrAttach({
    scope: env.scope, principal: { principalId: options.principalId ?? EDITOR, role: "pcb_editor", membershipRevision: "mbr1-0123456789abcdef" }, origin: "build", chatRunId: null,
    request: { clientRequestId: clientRequestId(), prompt: options.prompt ?? DRONE_PROMPT, provider: "openai" },
    base: { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin", headMark: null },
    identities: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small", promptDigests: { plan: durableWorkflowDigest("plan"), build: durableWorkflowDigest("build"), subsystem: durableWorkflowDigest("subsystem") } },
    providerServable: true, ...(options.allowanceUnit ? { allowanceUnit: options.allowanceUnit } : {}),
  });
  if (!started.ok) throw new Error(`start refused: ${started.code}`);
  return started.task;
}

export async function head(env: Pick<L3Env, "store" | "scope">, taskId: string): Promise<GenerationTaskHead> {
  const loaded = await env.store.load(env.scope, taskId);
  if (!loaded.ok) throw new Error(`load refused: ${loaded.code}`);
  return loaded.task;
}

/** Tick `worker` until `until(task)` holds; when nothing is claimable, let simulated time pass to the next due slice (the worker idles). */
export async function drive(env: Pick<L3Env, "store" | "scope" | "time">, worker: GenerationWorker, taskId: string, options: { until: (task: GenerationTaskHead) => boolean; maxTicks?: number; idleStepMs?: number }): Promise<{ task: GenerationTaskHead; ticks: number }> {
  const maxTicks = options.maxTicks ?? 200;
  let last: GenerationTaskHead | null = null;
  const describe = (task: GenerationTaskHead | null) => (task ? ` (state ${task.state}, blocker ${task.blocker?.code ?? "none"}, pending ${JSON.stringify(Object.values(task.pending).map((entry) => [entry.kind, entry.blockId, entry.state]))}, blocks ${JSON.stringify(Object.values(task.blocks).map((block) => [block?.blockId, block?.status, block?.strategy, block?.turnsUsed]))}, last events ${task.milestones.slice(-4).map((event) => event.type).join(",")})` : "");
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const ran = await worker.runOnce();
    const task = await head(env, taskId);
    last = task;
    if (options.until(task)) return { task, ticks: tick };
    if (ran.tick.started.length === 0) {
      const due = Object.values(task.pending).filter((entry) => entry.owner === null).map((entry) => Date.parse(entry.notBefore));
      if (!due.length) throw new Error(`the task settled without meeting the condition (tick ${tick})${describe(task)}`);
      env.time.jump(Math.max(Math.min(...due), env.time.now() + (options.idleStepMs ?? 1_000)));
    }
  }
  throw new Error(`the condition did not hold after ${maxTicks} ticks${describe(last)}`);
}
export const settledOrWaiting = (task: GenerationTaskHead): boolean => ["awaiting-review", "waiting-for-resource", "failed", "cancelled", "paused", "succeeded", "stale"].includes(task.state);

// ─── [PR-J, 2026-10-22] Runbook J.7: more logical blocks than worker slots ──────────────────────────────────────────────────
// Appended after the last line, so no cited line moves. The drone as EIGHT subsystem blocks (the task's block limit) from the same
// pin-valid offline parts: more blocks than one worker's three slots, each block a search per part and one submission (2-3 calls).

export const EIGHT_BLOCK_PROMPT = "build me a simple drone controlling circuitly with 4 motors, one subsystem block per motor channel";
export const EIGHT_BLOCKS = Object.freeze([
  { name: "Flight controller", brief: "An MCU with four PWM outputs and an I2C bus.", sharedNets: ["+3V3", "GND", "SDA", "SCL", "PWM1", "PWM2", "PWM3", "PWM4"] },
  { name: "Inertial sensor", brief: "A 6-axis IMU on the I2C bus.", sharedNets: ["+3V3", "GND", "SDA", "SCL"] },
  { name: "Battery input", brief: "A 1S battery connector with a bulk capacitor.", sharedNets: ["VBAT", "GND"] },
  { name: "3.3 V regulator", brief: "A 3.3 V LDO regulator fed from the battery.", sharedNets: ["VBAT", "+3V3", "GND"] },
  ...[1, 2, 3, 4].map((n) => ({ name: `Motor channel ${n}`, brief: `One logic-level N-MOSFET low-side switch with a flyback diode for motor ${n}.`, sharedNets: ["VBAT", "GND", `PWM${n}`] })),
]);
const pinsTo = (refDes: string, pins: Readonly<Record<string, string>>) => Object.entries(pins).map(([pin, net]) => label(`${refDes}.${pin}`, net));
const motorChannel = (n: number) => ({
  components: [{ refDes: "Q1", partId: "p-fet", value: "N-MOSFET", role: "output" }, { refDes: "D1", partId: "p-diode", value: "Schottky", role: "support", parentRefDes: "Q1" }],
  connections: [label("Q1.G", `PWM${n}`), label("Q1.S", "GND"), { from: "Q1.D", to: "D1.A" }, label("D1.K", "VBAT")],
  explanation: `Low-side channel ${n} with a flyback diode.`,
});
/** Each of the eight blocks' netlist (refDes repeat across blocks on purpose: the merge de-collides them) and its searches, one per part. */
export const EIGHT_BLOCK_DESIGNS: Readonly<Record<string, { netlist: object; searches: readonly string[] }>> = Object.freeze({
  "Flight controller": {
    netlist: { components: [{ refDes: "U1", partId: "p-mcu", value: "MCU", role: "processor" }, { refDes: "C1", partId: "p-cap", value: "100nF", role: "passive" }], connections: [...pinsTo("U1", { VDD: "+3V3", GND: "GND", SDA: "SDA", SCL: "SCL", PA0: "PWM1", PA1: "PWM2", PA2: "PWM3", PA3: "PWM4" }), ...pinsTo("C1", { 1: "+3V3", 2: "GND" })], explanation: "MCU with four PWM outputs on the I2C bus." },
    searches: ["flight controller mcu", "decoupling capacitor"],
  },
  "Inertial sensor": {
    netlist: { components: [{ refDes: "U1", partId: "p-imu", value: "IMU", role: "input" }, { refDes: "C1", partId: "p-cap", value: "100nF", role: "passive" }], connections: [...pinsTo("U1", { VDD: "+3V3", GND: "GND", SDA: "SDA", SCL: "SCL" }), ...pinsTo("C1", { 1: "+3V3", 2: "GND" })], explanation: "IMU on the I2C bus." },
    searches: ["imu gyro", "decoupling capacitor"],
  },
  "Battery input": {
    netlist: { components: [{ refDes: "J1", partId: "p-bat", value: "1S", role: "connector" }, { refDes: "C1", partId: "p-cap", value: "100nF", role: "passive" }], connections: [...pinsTo("J1", { VBAT: "VBAT", GND: "GND" }), ...pinsTo("C1", { 1: "VBAT", 2: "GND" })], explanation: "Battery input." },
    searches: ["battery connector", "decoupling capacitor"],
  },
  "3.3 V regulator": {
    netlist: { components: [{ refDes: "U1", partId: "p-reg", value: "3.3V LDO", role: "regulator" }, { refDes: "C1", partId: "p-cap", value: "100nF", role: "passive" }], connections: [...pinsTo("U1", { VIN: "VBAT", VOUT: "+3V3", GND: "GND" }), ...pinsTo("C1", { 1: "+3V3", 2: "GND" })], explanation: "3.3 V rail from the battery." },
    searches: ["ldo regulator", "decoupling capacitor"],
  },
  ...Object.fromEntries([1, 2, 3, 4].map((n) => [`Motor channel ${n}`, { netlist: motorChannel(n), searches: ["logic level mosfet", "schottky flyback diode"] }])),
});
/** One of the eight blocks: search each part, then submit (calls = searches + 1). */
export function eightBlock(name: string): BlockScript {
  const design = EIGHT_BLOCK_DESIGNS[name]!, tag = name.replace(/\W/g, "");
  return ({ turn }) => (turn <= design.searches.length ? reply([search(`call_${tag}_${turn}`, design.searches[turn - 1]!)]) : reply([submit(`call_${tag}_submit_${turn}`, design.netlist)]));
}
/** The eight-block plan's scripts (`plan` answers the eight blocks; a block's script by its name). */
export const eightBlockScripts = (overrides: Partial<Record<string, BlockScript>> = {}) => ({
  plan: () => planReply(EIGHT_BLOCKS),
  blocks: { ...Object.fromEntries(EIGHT_BLOCKS.map((block) => [block.name, eightBlock(block.name)])), ...overrides } as Record<string, BlockScript>,
});
/** The model calls the eight-block design makes when nothing goes wrong: one plan call and, per block, its searches plus one submission. */
export const EIGHT_BLOCK_CALLS = 1 + EIGHT_BLOCKS.reduce((sum, block) => sum + EIGHT_BLOCK_DESIGNS[block.name]!.searches.length + 1, 0);
