/**
 * [B20 D1] The standing adversarial harness (not a test file): ONE hostile MCP server driven through the WHOLE composed
 * client in ONE agent run — `discoverMcpServer` -> `listMcpTools` -> `callMcpTool` (through `mcpPostAuthorized` on a
 * client-credentials row) -> `normalizeMcpToolResult` -> `callMcpToolForAgent` -> `McpObservationReadService` -> the
 * `GatewayInvocationOutcome` and its `ExternalToolAttribution`.
 *
 * It composes the landed fakes (`_fake-mcp-server.ts`, `_fake-authorization-server.ts`, `_fixtures.ts`) and adds exactly two
 * things D1 needs and no A-suite has: the RUN COMPOSER (`hostileWorld` / `hostileRun`) and the LEAK SWEEP
 * (`nothingLeaked`). No new fake transport, no new fixture row shape, no network, no DNS, no real credential: every
 * credential is an obvious fake assembled at run time (S8) and the global fetch is poisoned by the suite.
 *
 * It never throws: a throw anywhere inside the composed run is `stage: "threw"`, which fails every case that reads it.
 *
 * [B20 D1] The leak sweep does NOT use `JSON.stringify` (DEC-4): that drops `undefined`, functions, symbol keys and
 * non-enumerable properties, never emits an assigned `__proto__` and THROWS on a `BigInt` or a cycle, so a sweep over it
 * would be unfalsifiable exactly where a leak would hide. `nothingLeaked` walks own properties through `Reflect.ownKeys`
 * and checks each object's prototype, under its own bounds, and reports a throw as a violation instead of swallowing it.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext } from "../../agent/context";
import type { AgentRunContext, ExternalToolAttribution, GatewayInvocationOutcome } from "../../agent/contracts";
import { verifyAgentContextIntegrity } from "../../agent/gateway";
import {
  EXTERNAL_RESULT_CLASSES, McpObservationReadService, MCP_OBSERVATION_TOOL_ID, MCP_PORT_REFUSAL_CODES, OBSERVATION_BLOCK_DISPOSITIONS, OBSERVATION_STRUCTURED_STATES,
  type McpObservationCallAnswer, type McpObservationCallRequest, type McpObservationPort, type McpObservationToolsAnswer, type McpObservationToolsRequest,
} from "../../agent/mcp-observation-reads";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import type { ToolRegistry } from "../../engineering/tool-registry";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { createMcpAgentPort, type McpAgentPortOptions } from "../agent-port";
import { skeletonOf } from "../http-transport";
import { mcpTextReadsAsDirective } from "../foreign-tools";
import { MCP_BLOCK_DISPOSITIONS, MCP_CONTENT_TYPES, MCP_STRUCTURED_STATES, type McpObservationRecord } from "../observation";
import { mcpServerEntry, type McpAgentDisclosure, type McpServerRegistryEntry } from "../server-registry";
import { mcpToolsListDigest } from "../tool-discovery";
import { PUBLIC, wideServer, type FakeCall } from "./_fake-mcp-server";
import { T0 } from "./_fixtures";

// ── Fixed sentences (FACT 1: `SENTENCES` is NOT exported by `app/lib/agent/mcp-observation-reads.ts`) ─────────────────
/**
 * The templates exactly as that module writes them. D1 never imports them: case 20 pins these literals against the
 * module read as TEXT, so a sentence change breaks one case loudly instead of nineteen silently.
 */
export const SENTENCE_TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
  transport_failed: "MCP server {server} gave no usable answer.",
  input_required_unsupported: "The server asked for input this client never offers; the call was not completed.",
  cancelled: "The external tool read was cancelled.",
  run_call_limit: "This run has used its 4 external server operations; answer from the results you already have.",
  authorization_failed: "Sirkit could not authorize this call to MCP server {server}.",
  upstream_error: "MCP server {server} answered with an error.",
  listing_failed: "MCP server {server} did not list its tools in a form this client accepts.",
  paused: "Calls to MCP server {server} are paused{retry}.",
});

/**
 * The sentence the service renders for `code` on `serverId` (`{server}` becomes the quoted id; `{retry}` becomes
 * ` until <ISO time>` of Sirkit's own pause, or nothing; double spaces collapse) — exactly the renderer case 20 pins.
 */
export function sentenceOf(code: keyof typeof SENTENCE_TEMPLATES | string, serverId = "", retryAtMs: number | null = null): string {
  const template = SENTENCE_TEMPLATES[code];
  if (template === undefined) throw new Error(`_hostile-server: no pinned sentence for ${code}`);
  const retry = retryAtMs !== null && Number.isFinite(retryAtMs) ? ` until ${new Date(retryAtMs).toISOString()}` : "";
  return template.replace("{server}", serverId === "" ? "" : `"${serverId}"`).replace("{retry}", retry).replace(/ {2,}/g, " ");
}

// ── The composed run ──────────────────────────────────────────────────────────

export const HOSTILE_PRINCIPAL = Object.freeze({ tenantId: "tenant-d1", projectId: "project-d1-0001", principalId: "principal-d1-0001" });
export const HOSTILE_RUN_ID = "run-d1-000000000001";

const SCHEMATIC: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [{ id: "k1", partId: "lib:ne555", x: 100, y: 100, rotation: 0, refDes: "U1", value: "NE555" }] };
const BOARD: unknown = JSON.parse(JSON.stringify(makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2)));

let registryMemo: ToolRegistry | null = null;
/** The production registry, built once per process: `sirkitToolRegistry()` is expensive and D1 never mutates it. */
export function hostileRegistry(): ToolRegistry {
  registryMemo ??= sirkitToolRegistry();
  return registryMemo;
}

function assembled(overrides: Record<string, unknown> = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    tenantId: HOSTILE_PRINCIPAL.tenantId, projectId: HOSTILE_PRINCIPAL.projectId, branchId: "main", schematic: SCHEMATIC, board: BOARD,
    verifiedActor: { principalId: HOSTILE_PRINCIPAL.principalId, actorRole: "viewer", membershipRevision: "mbr1-d1", authMethod: "local_dev" },
    mcpObservationAvailable: true, ...overrides,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

/**
 * An approved, flag-admitted row pinned to `defs`, whose operator approved exactly `agentTools` (A4L: fail closed).
 * `perTool` is emptied: the fixture row's four-search-a-minute window is an A0 admission property, and a D1 case that
 * drives several hostile scripts in one frozen minute would otherwise read `admission_refused` where it asserts an
 * attack's answer. The rest of the row is the landed fixture shape (DEC-3).
 */
export function hostileRow(id: string, defs: readonly unknown[], agentTools: readonly string[], overrides: Partial<McpServerRegistryEntry> = {}): McpServerRegistryEntry {
  const base = wideServer(id);
  return wideServer(id, {
    descriptorPin: { toolsListDigest: mcpToolsListDigest(defs), pinnedAt: "2026-09-23" },
    agentDisclosure: "permitted",
    agentTools: [...agentTools].sort(),
    limits: { ...base.limits, perTool: {} },
    ...overrides,
  });
}

export const HOSTILE_ENV_ON: Readonly<Record<string, string>> = Object.freeze({ SIRKIT_MCP_ENABLED: "1" });

export interface HostileRequest {
  operation: "servers" | "tools" | "call";
  serverId?: string;
  toolName?: string;
  /** the `arguments` of a `call`, serialised into `argumentsJson` by the service's own argument shape */
  args?: Record<string, unknown>;
  runId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  disclosure?: "permitted" | "prohibited" | "unknown";
}

export interface HostileRun {
  /** "agent" when the composed run answered; "threw" when anything on the path threw or rejected (S4) */
  stage: "agent" | "threw";
  thrown: string | null;
  agent: {
    kind: string;
    ok: boolean;
    status: string | null;
    /** the diagnostics the agent is told, joined — the fixed sentence for a refusal */
    text: string;
    /** the MODEL-BOUND projection: exactly what `finish` re-validated and handed to the loop */
    output: unknown;
  };
  outcome: GatewayInvocationOutcome;
  /** the raw port answer the service consumed (null when the service never reached the port) */
  port: McpObservationCallAnswer | McpObservationToolsAnswer | null;
  observation: McpObservationRecord | null;
  attribution: ExternalToolAttribution | null;
  calls: readonly FakeCall[];
  resolves: readonly string[];
  elapsedMs: number;
}

/** Exactly what `fakeMcpServer(...)` and `authWorld(...)` already return: the recorder and the in-process transport. */
export interface HostileFake { readonly calls: readonly FakeCall[]; readonly transport: typeof fetch }

export interface HostileWorldOptions {
  entries: readonly McpServerRegistryEntry[];
  /** the landed fake, composed unchanged (DEC-3): never the global fetch, never a new transport */
  fake: HostileFake;
  resolve?: (hostname: string) => Promise<string[]>;
  env?: Readonly<Record<string, string | undefined>>;
  clock?: () => number;
  tokenProvider?: NonNullable<McpAgentPortOptions["deps"]>["tokenProvider"];
}

export interface HostileWorld {
  readonly calls: readonly FakeCall[];
  readonly resolves: readonly string[];
  readonly port: McpObservationPort;
  readonly service: McpObservationReadService;
  run(request: HostileRequest): Promise<HostileRun>;
  /** how many of the run's 4 server operations were charged */
  budgetSpent(runId?: string): number;
}

/** The port answer the service last consumed, captured without changing what the service sees. */
function recordingPort(inner: McpObservationPort, sink: { last: McpObservationCallAnswer | McpObservationToolsAnswer | null }): McpObservationPort {
  return Object.freeze({
    servers: () => inner.servers(),
    tools: async (request: McpObservationToolsRequest) => {
      const answer = await inner.tools(request);
      sink.last = answer;
      return answer;
    },
    call: async (request: McpObservationCallRequest) => {
      const answer = await inner.call(request);
      sink.last = answer;
      return answer;
    },
  });
}

export function hostileWorld(options: HostileWorldOptions): HostileWorld {
  const calls = options.fake.calls;
  const resolves: string[] = [];
  const baseResolve = options.resolve ?? PUBLIC;
  const resolve = async (hostname: string): Promise<string[]> => {
    resolves.push(hostname);
    return baseResolve(hostname);
  };
  const sink: { last: McpObservationCallAnswer | McpObservationToolsAnswer | null } = { last: null };
  // through a function, so TypeScript's control-flow analysis does not narrow `sink.last` to `null` for the rest of `run`
  const forgetLastAnswer = (): void => { sink.last = null; };
  const inner = createMcpAgentPort({
    principal: HOSTILE_PRINCIPAL,
    entries: options.entries,
    env: { ...HOSTILE_ENV_ON, ...(options.env ?? {}) },
    clock: options.clock ?? (() => T0),
    deps: { fetch: options.fake.transport, resolve, ...(options.tokenProvider ? { tokenProvider: options.tokenProvider } : {}) },
  });
  const port = recordingPort(inner, sink);
  const registry = hostileRegistry();
  /**
   * [B20 D review] tests-08: the disclosure is read from the injected ROWS through the production lookup
   * (`mcpServerEntry(serverId, entries)?.agentDisclosure ?? "unknown"` — the service's own default with the committed
   * registry replaced by this world's entries, since fixture rows are never committed under OD-48). A case that wants to
   * force a value names `request.disclosure`; case 10, which asserts the label FOLLOWS THE ROW, must not.
   */
  let override: McpAgentDisclosure | null = null;
  const disclosureOf = (serverId: string): McpAgentDisclosure => override ?? mcpServerEntry(serverId, options.entries)?.agentDisclosure ?? "unknown";
  const service = new McpObservationReadService(registry, { port, integrity: verifyAgentContextIntegrity, disclosureOf });

  return Object.freeze({
    get calls(): readonly FakeCall[] { return calls; },
    get resolves(): readonly string[] { return resolves; },
    port,
    service,
    budgetSpent: (runId = HOSTILE_RUN_ID) => service.operationsUsed(runId),
    run: async (request: HostileRequest): Promise<HostileRun> => {
      forgetLastAnswer();
      override = request.disclosure ?? null;
      const args = {
        operation: request.operation,
        serverId: request.serverId ?? "",
        toolName: request.toolName ?? "",
        argumentsJson: request.args === undefined ? "" : JSON.stringify(request.args),
      };
      const descriptor = registry.get(MCP_OBSERVATION_TOOL_ID)!;
      const started = Date.now();
      let outcome: GatewayInvocationOutcome;
      try {
        outcome = await service.invoke({
          toolId: MCP_OBSERVATION_TOOL_ID, version: descriptor.version, args, context: assembled(),
          runId: request.runId ?? HOSTILE_RUN_ID, timeoutMs: request.timeoutMs ?? 15_000,
          ...(request.signal ? { signal: request.signal } : {}),
        });
      } catch (error) {
        return Object.freeze({
          stage: "threw" as const, thrown: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          agent: { kind: "threw", ok: false, status: null, text: "", output: null },
          outcome: { kind: "refused", ok: false, toolId: MCP_OBSERVATION_TOOL_ID, version: descriptor.version, status: "threw", diagnostics: [] } as GatewayInvocationOutcome,
          port: sink.last, observation: null, attribution: null, calls: [...calls], resolves: [...resolves], elapsedMs: Date.now() - started,
        });
      }
      const refused = outcome.kind === "refused";
      const attribution = "external" in outcome ? (outcome.external ?? null) : null;
      const observation = sink.last !== null && sink.last.ok && sink.last.kind === "observation" ? sink.last.observation : null;
      return Object.freeze({
        stage: "agent" as const,
        thrown: null,
        agent: {
          kind: outcome.kind,
          ok: outcome.ok,
          status: refused ? (outcome as { status: string }).status : null,
          text: refused ? (outcome as { diagnostics: string[] }).diagnostics.join(" ") : "",
          output: "output" in outcome ? outcome.output : null,
        },
        outcome,
        port: sink.last,
        observation,
        attribution,
        calls: [...calls],
        resolves: [...resolves],
        elapsedMs: Date.now() - started,
      });
    },
  });
}

/** One composed run over one fresh world: the common case. */
export async function hostileRun(options: HostileWorldOptions, request: HostileRequest): Promise<HostileRun> {
  return hostileWorld(options).run(request);
}

// ── The leak sweep (DEC-4) ────────────────────────────────────────────────────

/** S5: the sweep's own bounds, judged before the work each bounds. */
export const LEAK_SWEEP_BOUNDS = Object.freeze({ maxNodes: 20_000, maxDepth: 12, maxChars: 1_048_576 });

const OK_PROTOTYPES: readonly unknown[] = [Object.prototype, Array.prototype, null];
/** The four keys untrusted peer text may live under, and nowhere else. */
export const UNTRUSTED_KEYS: ReadonlySet<string> = new Set(["untrustedText", "untrustedValue", "untrustedTitle", "untrustedDescription"]);

/**
 * [B20 D1] Sirkit's OWN closed vocabularies, which an answer legitimately carries as values. They are not peer text, and
 * the directive rule below must not judge them: the A2 matcher reads `withheld_credential` as a directive (it names a
 * credential), so a sweep that judged Sirkit's own disposition names would fire on the very refusal it is asserting.
 * Every member is a closed union read from its own module, never a literal typed here.
 */
const CLOSED_VOCABULARY: ReadonlySet<string> = new Set<string>([
  ...MCP_BLOCK_DISPOSITIONS, ...MCP_STRUCTURED_STATES, ...MCP_CONTENT_TYPES,
  ...OBSERVATION_BLOCK_DISPOSITIONS, ...OBSERVATION_STRUCTURED_STATES, ...EXTERNAL_RESULT_CLASSES, ...MCP_PORT_REFUSAL_CODES,
  // the two the service adds when disclosure withholds a block or a value
  "withheld_disclosure",
]);

export interface Found { readonly text: string; readonly path: string; readonly untrusted: boolean }

interface Walked { readonly strings: readonly Found[]; readonly violations: readonly string[] }

/** Every string of `value` with its path and whether it lies under an untrusted key — the sweep's own reading, for a case that asserts WHERE a planted literal survived (case 11). */
export function sweptStrings(value: unknown, label = "value"): readonly Found[] {
  return walkValue(value, label).strings;
}

/**
 * Every string of `value` — each own key and each leaf, at every depth — with the path it sits at and whether it is under
 * an untrusted key, plus every structural violation found on the way. Bounded (S5). Never swallows a throw: a property
 * that cannot be read, an accessor, a cycle past the node budget and an exotic prototype are all reported.
 */
function walkValue(value: unknown, label: string): Walked {
  const strings: Found[] = [];
  const violations: string[] = [];
  const seen = new Set<object>();
  let nodes = 0;
  let chars = 0;
  const stack: Array<{ value: unknown; path: string; depth: number; untrusted: boolean }> = [{ value, path: label, depth: 0, untrusted: false }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    nodes += 1;
    if (nodes > LEAK_SWEEP_BOUNDS.maxNodes) { violations.push(`${label}: the sweep hit its ${LEAK_SWEEP_BOUNDS.maxNodes}-node bound at ${frame.path}`); break; }
    if (frame.depth > LEAK_SWEEP_BOUNDS.maxDepth) { violations.push(`${label}: the sweep hit its depth bound at ${frame.path}`); continue; }
    const next = frame.value;
    if (typeof next === "string") {
      chars += next.length;
      if (chars > LEAK_SWEEP_BOUNDS.maxChars) { violations.push(`${label}: the sweep hit its ${LEAK_SWEEP_BOUNDS.maxChars}-character bound at ${frame.path}`); break; }
      strings.push({ text: next, path: frame.path, untrusted: frame.untrusted });
      continue;
    }
    if (typeof next === "function") { violations.push(`${label}: a function reached the answer at ${frame.path}`); continue; }
    if (typeof next === "bigint") { violations.push(`${label}: a BigInt reached the answer at ${frame.path}`); continue; }
    if (typeof next !== "object" || next === null) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    const prototype: unknown = Object.getPrototypeOf(next);
    if (!OK_PROTOTYPES.includes(prototype)) violations.push(`${label}: an exotic prototype at ${frame.path}`);
    if (Object.hasOwn(next, "__proto__")) violations.push(`${label}: an OWN "__proto__" property at ${frame.path}`);
    let keys: Array<string | symbol>;
    try {
      keys = Reflect.ownKeys(next);
    } catch (error) {
      violations.push(`${label}: Reflect.ownKeys threw at ${frame.path} (${String(error)})`);
      continue;
    }
    for (const key of keys) {
      if (typeof key === "symbol") {
        violations.push(`${label}: a symbol key at ${frame.path} (${String(key.description ?? "")})`);
        continue;
      }
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(next, key);
      } catch (error) {
        violations.push(`${label}: reading the descriptor of ${frame.path}.${key} threw (${String(error)})`);
        continue;
      }
      if (descriptor === undefined) continue;
      if (descriptor.get !== undefined || descriptor.set !== undefined) {
        violations.push(`${label}: an accessor property at ${frame.path}.${key}`);
        continue;
      }
      const untrusted = frame.untrusted || UNTRUSTED_KEYS.has(key);
      // an ARRAY index is not a key a peer chose; every other own key is a string the sweep reads
      if (!Array.isArray(next)) strings.push({ text: key, path: `${frame.path}.${key}`, untrusted: frame.untrusted });
      stack.push({ value: descriptor.value, path: `${frame.path}.${key}`, depth: frame.depth + 1, untrusted });
    }
  }
  return { strings, violations };
}

export interface LeakSecrets {
  /** every token, client id and client secret the run could have sent */
  readonly tokens?: readonly string[];
  /** planted peer markers (the fake authorization world's `MARKER`, a fake's own sentinels) */
  readonly markers?: readonly string[];
  /** any other literal that must not survive (a Location value, a scope the peer named, a challenge text) */
  readonly forbidden?: readonly string[];
  /** extra hostnames beyond the ones the run actually contacted */
  readonly hosts?: readonly string[];
}

const fold = (text: string): string => skeletonOf(text).toLowerCase();

/** Does any of `strings` carry an 8-character window of `subject`'s skeleton? Returns the surviving window or null. */
export function windowSurvivor(strings: readonly Found[], subject: string): { window: string; path: string } | null {
  const folded = fold(subject);
  if (folded.length < 8) return null;
  for (const found of strings) {
    const haystack = fold(found.text);
    for (let start = 0; start + 8 <= folded.length; start += 1) {
      const window = folded.slice(start, start + 8);
      if (haystack.includes(window)) return { window, path: found.path };
    }
  }
  return null;
}

/**
 * The ONE leak assertion of D1 (DEC-4). Over the agent's sentence and MODEL-BOUND projection, the port's answer, the
 * observation record and the trace attribution:
 *  - no 8-character window of the skeleton of any sent token, client id or client secret survives anywhere;
 *  - no planted peer marker and no caller-named forbidden literal survives;
 *  - no hostname the run contacted, and no `<host><path>` of any request it made, survives;
 *  - no `Mcp-Param-*` header value the run sent survives;
 *  - the MODEL-BOUND projection carries no `://` at all;
 *  - no string reads as a directive (`mcpTextReadsAsDirective(...) === "directive"`) outside an untrusted key;
 *  - every object reached has `Object.prototype`, `Array.prototype` or `null` as its prototype, no OWN `__proto__`, no
 *    accessor, no symbol key, no function and no BigInt.
 * Returns the violations; `[]` is the assertion a case makes.
 */
export function nothingLeaked(run: HostileRun, secrets: LeakSecrets = {}): string[] {
  const violations: string[] = [];
  if (run.stage === "threw") return [`the composed run threw: ${run.thrown ?? "unknown"}`];

  const scopes: Array<{ label: string; value: unknown; noUrls: boolean }> = [
    { label: "projection", value: run.agent.output, noUrls: true },
    { label: "sentence", value: run.agent.text, noUrls: true },
    { label: "attribution", value: run.attribution, noUrls: true },
    { label: "port", value: run.port, noUrls: false },
    { label: "observation", value: run.observation, noUrls: false },
  ];

  const hosts = new Set<string>(secrets.hosts ?? []);
  const origins = new Set<string>();
  const paramValues = new Set<string>();
  for (const call of run.calls) {
    try {
      const url = new URL(call.url);
      hosts.add(url.hostname);
      origins.add(`${url.hostname}${url.pathname}`);
    } catch {
      violations.push(`the fake recorded a request whose URL does not parse: ${call.url.slice(0, 80)}`);
    }
    for (const [name, value] of Object.entries(call.headers)) {
      if (name.toLowerCase().startsWith("mcp-param-") && typeof value === "string" && value.length >= 4) paramValues.add(value);
    }
  }

  for (const scope of scopes) {
    const walked = walkValue(scope.value, scope.label);
    violations.push(...walked.violations);
    for (const token of secrets.tokens ?? []) {
      const survivor = windowSurvivor(walked.strings, token);
      if (survivor !== null) violations.push(`${scope.label}: an 8-character window of a credential survived at ${survivor.path} (${survivor.window})`);
    }
    const literals = [...(secrets.markers ?? []), ...(secrets.forbidden ?? []), ...hosts, ...origins, ...paramValues];
    for (const found of walked.strings) {
      const folded = fold(found.text);
      for (const literal of literals) {
        if (literal.length >= 4 && folded.includes(fold(literal))) violations.push(`${scope.label}: "${literal}" survived at ${found.path}`);
      }
      if (scope.noUrls && found.text.includes("://")) violations.push(`${scope.label}: a URL survived at ${found.path}`);
      if (!found.untrusted && !CLOSED_VOCABULARY.has(found.text) && mcpTextReadsAsDirective(found.text) === "directive") violations.push(`${scope.label}: a directive survived outside an untrusted key at ${found.path}`);
    }
  }
  return violations;
}
