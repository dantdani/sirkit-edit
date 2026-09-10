/**
 * B09 — the agent chat route: a versioned NDJSON streaming event protocol
 * over the provider-neutral single-agent tool loop.
 *
 * Every line is one JSON event `{ v: 1, runId, seq, ...AgentRunEvent }`.
 * The route assembles the run context server-side (LOCAL_ONLY actor —
 * request bodies and models can never supply actor/role/capability/
 * authority claims), discovers the exact exposed toolset for the run,
 * executes reads through the real B05/B05.1 boundary and proposals through
 * the sealed proposal gateway, and never exposes raw provider bodies,
 * stacks, secrets, or hidden reasoning.
 *
 * Provider failures BEFORE streaming begins remain structured 503s
 * (existing classification). No silent cross-provider fallback exists;
 * a provider switch is a new run with a new run id, chosen by the user.
 */

import { randomUUID } from "node:crypto";
import { agentAdapterFor } from "@/app/lib/agent/adapters";
import { assembleAgentRunContext, parseSelectionRef } from "@/app/lib/agent/context";
import { agentStreamRoute } from "@/app/lib/auth/route-handlers";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent } from "@/app/lib/agent/contracts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { runAgentLoop } from "@/app/lib/agent/loop";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { requestedProvider } from "@/app/lib/llm/request";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";
import { buildAgentResourceBundle } from "@/app/lib/agent/context";
import { loadRunComponentAuthority } from "@/app/lib/engineering/component-authority-source";
import { resolveComponentAuthoritySource } from "./component-authority-runtime";
import { loadRunReplacementPinFacts, resolveReplacementPinFactsSource } from "./replacement-facts-runtime";
import { pcbBoardInstanceId, PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH } from "@/app/lib/pcb/board-identity";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { agentRunTraceDigest, validateAgentRunTrace } from "@/app/lib/agent/trace";
import { AgentTraceRecorder, createAgentTraceSink } from "@/app/lib/agent/trace-recorder";
import { resolveFreeroutingRuntime } from "@/app/lib/pcb/autoroute/runtime";
import { resolveAgentAutonomyRepository } from "@/app/lib/agent/autonomy-store";
import { createExecutionGrantMinter } from "@/app/lib/execution-grant/mint";
import type { AgentExecutionGrantMinter } from "@/app/lib/agent/contracts";
import type { AgentAutonomySetting } from "@/app/lib/engineering/permission-tiers";
import { createFreeroutingPassExecutor } from "@/app/lib/pcb/autoroute/freerouting-pass-executor";

export const CHAT_PROTOCOL_VERSION = 1;

/** [B10] documented board-capable request limit: the ACTUAL request-body
 *  byte count is bounded before JSON parsing (never Content-Length alone). */
export const MAX_CHAT_REQUEST_BYTES = 8_000_000;

export const EDITOR_CONTEXT_SCHEMA = "sirkit.editor-context.v1";

/** [B10] exact allowed top-level keys — anything else (authority, actor,
 *  role, capability, approval, durable-board, release, idempotency claims,
 *  or the obsolete boardState contract) refuses the request. */
const ALLOWED_BODY_KEYS = new Set(["provider", "messages", "scope", "schematicState", "schematicHeadMark", "editorContext", "viewContext"]);
const ALLOWED_EDITOR_CONTEXT_KEYS = ["schema", "scope", "board", "pcbRevisionId", "selection", "netlist", "schematicDigest", "authoritySource"] as const;
/** [B15.3] optional nullable capture keys — shape-validated in the context
 *  assembler; absence only withholds the PCB proposal tool. */
const OPTIONAL_EDITOR_CONTEXT_KEYS = ["pcbProposalBasis"] as const;

/** [B10.1] authority-shaped key names refuse BY NAME wherever they appear
 *  nested inside request control objects (never silently ignored). */
const AUTHORITY_CLAIM_KEYS = new Set([
  "actor", "actorId", "actorRole", "role", "capability", "capabilities",
  "authority", "authoritySource", "approvals", "approval", "release",
  "durableBoard", "durable-board", "idempotency", "idempotencyKey",
  // [B18-B] grant-, attempt-, decision- and explicitness-shaped claims
  "executionGrant", "grant", "grantId", "nonce", "attemptId", "consumption", "explicit", "explicitUserRequest", "autonomy", "decision", "tier",
]);

/** [B10.1] reusable EXACT-KEY validation for nested control objects: every
 *  key outside `allowed` refuses (authority-shaped keys refuse by name),
 *  and every `required` key must be present. Bounded, redacted messages. */
function exactObjectShape(value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return `${label} must be an object`;
  for (const key of Object.keys(value)) {
    if (required.includes(key) || optional.includes(key)) continue;
    return AUTHORITY_CLAIM_KEYS.has(key)
      ? `${label} carries the authority-shaped key "${key.slice(0, 40)}" — actor, role, capability, authority, approval, release, durable-board, and idempotency claims are refused`
      : `${label} carries an unexpected key "${key.slice(0, 40)}"`;
  }
  for (const key of required) {
    if ((value as Record<string, unknown>)[key] === undefined) return `${label} is missing the required key "${key}"`;
  }
  return null;
}

// [B16.0.24 §E] the streaming bounded read (identical B10.1/B10.2 semantics,
// including the 413 board-capable envelope) now lives in `agentStreamRoute`;
// the former exported `readBoundedBody` helper was inlined into that wrapper.

interface ChatBody {
  provider?: unknown;
  messages?: unknown;
  scope?: unknown;
  schematicState?: unknown;
  schematicHeadMark?: unknown;
  editorContext?: unknown;
  /** [B17-F] the captured view context (`sirkit.view-context.v1`) — exact-key
   *  validated and bounded by the assembler; malformed ⇒ view tools withheld. */
  viewContext?: unknown;
}

function parseHistory(value: unknown): Array<{ role: "user" | "assistant"; text: string }> {
  if (!Array.isArray(value)) return [];
  const turns: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const message = item as Record<string, unknown>;
    if ((message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.length > 0) {
      turns.push({ role: message.role, text: message.content.slice(0, 20_000) });
    }
  }
  return turns;
}

// [B16.0.24 §E/§F] canonical body-scope STREAMING wrapper (sole adopter). The
// boundary — media type (415, zero body pulls), the B10.1 streaming bounded
// read (413/400 board-capable envelopes), lenient parse, the body-scope
// projection, trusted-context resolution (verified human identity + LIVE
// membership + same-origin CSRF in production) and the exact chat policy's role
// gate — now lives in `agentStreamRoute`. The callback receives ONLY the
// trusted `context`, the parsed `body`, the derived `scope`, and the request
// `signal` (for disconnect propagation + cancellable server-owned authority
// reads); the raw Request never escapes. Every rich body contract below runs
// AFTER authorization: authority-shaped keys, messages, editorContext, and the
// server-side revision recompute all fail closed, and no body field can become
// verified authority.
export const POST = agentStreamRoute(
  { maxBytes: MAX_CHAT_REQUEST_BYTES, defaultScope: { tenantId: "local", projectId: "local", branchId: "local" } },
  async ({ context, body: parsedBody, signal }) => {
  // [B10] exact allowed keys — the obsolete boardState path and every
  // authority/actor/role/capability/approval/idempotency claim refuse
  // EXPLICITLY (bounded key echo only; never the body).
  for (const key of Object.keys(parsedBody)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      const detail = key === "boardState"
        ? "the top-level boardState contract is obsolete — supply the versioned atomic editorContext instead"
        : `unexpected request key "${key.slice(0, 40)}" (authority, actor, role, capability, approval, durable-board, release, and idempotency claims are refused)`;
      return Response.json({ ok: false, error: detail }, { status: 400 });
    }
  }
  const body = parsedBody as ChatBody;
  const provider = requestedProvider(body.provider);
  // [B10.1] messages: EXACT shape per entry (role + content only) —
  // authority-shaped or unknown message keys refuse instead of being
  // silently dropped by lenient parsing.
  if (!Array.isArray(body.messages)) {
    return Response.json({ ok: false, error: "messages must be an array" }, { status: 400 });
  }
  for (const [index, item] of body.messages.entries()) {
    const shape = exactObjectShape(item, `messages[${index}]`, ["role", "content"]);
    if (shape !== null) return Response.json({ ok: false, error: shape }, { status: 400 });
    const message = item as Record<string, unknown>;
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") {
      return Response.json({ ok: false, error: `messages[${index}] must be { role: "user" | "assistant", content: string }` }, { status: 400 });
    }
  }
  const history = parseHistory(body.messages);
  const last = history.at(-1);
  if (!last || last.role !== "user") {
    return Response.json({ ok: false, error: "messages must end with a non-empty user message" }, { status: 400 });
  }
  const userMessage = last.text;
  const priorHistory = history.slice(0, -1);

  // Project scope: identifiers only — validated, never authority. Absent
  // scope degrades to a tool-less conversational run (nothing to discover).
  // [B10.1] when PRESENT it must be EXACTLY {tenantId, projectId, branchId}
  // strings — nested authority claims (scope.actor, scope.capabilities, …)
  // refuse explicitly.
  let requestScope = { tenantId: "local", projectId: "local", branchId: "local" };
  if (body.scope !== undefined && body.scope !== null) {
    const shape = exactObjectShape(body.scope, "scope", ["tenantId", "projectId", "branchId"]);
    if (shape !== null) return Response.json({ ok: false, error: shape }, { status: 400 });
    const scope = body.scope as Record<string, unknown>;
    if (typeof scope.tenantId !== "string" || typeof scope.projectId !== "string" || typeof scope.branchId !== "string") {
      return Response.json({ ok: false, error: "scope identifiers must be strings" }, { status: 400 });
    }
    requestScope = { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId };
  }

  // [B10] the versioned atomic editor context: exact keys, exact schema,
  // embedded scope MUST equal the request scope, provenance may only be
  // the local working copy. Board/selection/netlist validation (and every
  // digest/revision recomputation) happens server-side in the assembler.
  let editorBoard: unknown;
  let editorSelection: unknown;
  let editorNetlist: unknown;
  let editorSchematicDigest: unknown;
  let editorPcbProposalBasis: unknown;
  let editorRevisionHint: string | null = null;
  if (body.editorContext !== undefined && body.editorContext !== null) {
    // [B10.1] the COMPLETE contract is required when editorContext is
    // present: every key present (netlist/schematicDigest nullable), exact
    // schema, exact embedded scope, exact selection shape, string revision
    // hint, local-working-copy provenance only.
    const shape = exactObjectShape(body.editorContext, "editorContext", ALLOWED_EDITOR_CONTEXT_KEYS, OPTIONAL_EDITOR_CONTEXT_KEYS);
    if (shape !== null) return Response.json({ ok: false, error: shape }, { status: 400 });
    const editorContext = body.editorContext as Record<string, unknown>;
    if (editorContext.schema !== EDITOR_CONTEXT_SCHEMA) {
      return Response.json({ ok: false, error: `unsupported editorContext schema (expected ${EDITOR_CONTEXT_SCHEMA})` }, { status: 400 });
    }
    if (editorContext.authoritySource !== "local-working-copy") {
      return Response.json({ ok: false, error: "editorContext.authoritySource may only be the local working copy — durable/server authority claims are refused" }, { status: 400 });
    }
    const embeddedShape = exactObjectShape(editorContext.scope, "editorContext.scope", ["tenantId", "projectId", "branchId"]);
    if (embeddedShape !== null) return Response.json({ ok: false, error: embeddedShape }, { status: 400 });
    const embedded = editorContext.scope as Record<string, unknown>;
    if (embedded.tenantId !== requestScope.tenantId || embedded.projectId !== requestScope.projectId || embedded.branchId !== requestScope.branchId) {
      return Response.json({ ok: false, error: "editorContext scope does not equal the request scope" }, { status: 400 });
    }
    if (typeof editorContext.pcbRevisionId !== "string" || editorContext.pcbRevisionId.length === 0 || editorContext.pcbRevisionId.length > 200) {
      return Response.json({ ok: false, error: "editorContext.pcbRevisionId must be a bounded string" }, { status: 400 });
    }
    // [B10.2] the selection contract is EXACTLY { refs, primary }: primary
    // must be PRESENT and either null or a structurally valid selection
    // reference — enforced BEFORE any provider invocation.
    const selectionShape = exactObjectShape(editorContext.selection, "editorContext.selection", ["refs", "primary"]);
    if (selectionShape !== null) return Response.json({ ok: false, error: selectionShape }, { status: 400 });
    const selectionValue = editorContext.selection as Record<string, unknown>;
    if (!Array.isArray(selectionValue.refs)) {
      return Response.json({ ok: false, error: "editorContext.selection.refs must be an array" }, { status: 400 });
    }
    if (selectionValue.primary !== null && parseSelectionRef(selectionValue.primary) === null) {
      return Response.json({ ok: false, error: "editorContext.selection.primary must be null or a structurally valid selection reference" }, { status: 400 });
    }
    editorBoard = editorContext.board;
    editorSelection = editorContext.selection;
    editorNetlist = editorContext.netlist ?? undefined;
    editorSchematicDigest = editorContext.schematicDigest ?? undefined;
    editorPcbProposalBasis = editorContext.pcbProposalBasis ?? undefined;
    editorRevisionHint = editorContext.pcbRevisionId;
  }

  // [B16.0.1 §D / B16.0.24 §E] the wrapper already resolved the trusted
  // request identity (verified authenticated principal + ACTIVE membership for
  // the body-supplied project scope), enforced same-origin CSRF (production),
  // and applied the exact chat policy's role gate — all BEFORE this callback,
  // so no provider budget is reachable without them. The server-derived
  // verified principal is threaded into the run: the agent actor, discovery
  // context, and every sealed proposal bind to THIS identity + membership
  // revision, never the local-only owner. `context.tenantId/projectId/branchId`
  // equal the validated `requestScope` (the wrapper used it as the selector).
  const verifiedActor = {
    principalId: context.principalId,
    actorRole: context.actor.role,
    membershipRevision: context.membershipRevision,
    authMethod: context.authMethod,
  };

  // [B18-A] the project's agent autonomy setting is read SERVER-SIDE from the
  // durable store (never from the body). An unavailable store is a truthful
  // warning and the run stays proposal-only — unavailability never widens.
  let autonomy: AgentAutonomySetting | undefined;
  const autonomyWarnings: string[] = [];
  try {
    autonomy = await resolveAgentAutonomyRepository().get({ tenantId: requestScope.tenantId, projectId: requestScope.projectId });
  } catch {
    autonomyWarnings.push("The project's agent autonomy setting could not be read; this run is proposal-only.");
  }

  const assembly = assembleAgentRunContext({
    ...requestScope,
    schematic: body.schematicState,
    board: editorBoard,
    schematicHeadMark: body.schematicHeadMark,
    selection: editorSelection,
    netlist: editorNetlist,
    editorSchematicDigest,
    pcbProposalBasis: editorPcbProposalBasis,
    verifiedActor,
    view: body.viewContext,
    autonomy,
  });
  if (!assembly.ok) {
    return Response.json({ ok: false, error: assembly.reason }, { status: 400 });
  }
  // [B10.1] the client PCB revision hint is RECOMPUTED server-side over the
  // VALIDATED board: a mismatch means the editor context was not one atomic
  // capture (or was corrupted in transit) and fails CLOSED — never silently
  // ignored. (An invalid board never reaches this check: canonical state is
  // withheld and the hint has nothing verified to disagree with.)
  if (editorRevisionHint !== null && assembly.context.canonicalState !== null) {
    const recomputed = pcbRevisionId(assembly.context.canonicalState.pcb);
    if (recomputed !== editorRevisionHint) {
      return Response.json({ ok: false, error: "corrupt or non-atomic editor context: the client PCB revision hint does not match the validated board (recomputed server-side)" }, { status: 400 });
    }
  }

  // [B13] SERVER-OWNED component-authority load — after scope validation and
  // context assembly, bound to THIS run's canonical revision, authenticated
  // server scope ONLY (never the request body). The resolver returns a
  // durable source only when one is configured; in the local-only build it is
  // null, so the resource is withheld and the inspection tool stays unexposed
  // (chat continues unchanged). A load failure/timeout/abort fails CLOSED to
  // null — never a fabricated verified set — and unrelated chat tools keep
  // working. On success the context is re-assembled WITH the server-owned
  // records so the sealed bundle carries the resource.
  let runContext = assembly.context;
  if (runContext.canonicalState && runContext.canonicalRevisionDigest) {
    const source = resolveComponentAuthoritySource(requestScope);
    if (source) {
      const componentInstanceIds = (runContext.schematic?.kicadComponents ?? []).map((component) => component.id);
      const authority = await loadRunComponentAuthority(source, {
        // [B13.1 §B / B13.2 §A] the ONE shared board identity — board
        // instance, hierarchy, and assembly variant all come from the shared
        // module that the physical-binding write path uses (never a second
        // formula, and never a request-supplied value).
        scope: { ...requestScope, boardInstanceId: pcbBoardInstanceId(requestScope.projectId) },
        canonicalRevision: runContext.canonicalRevisionDigest,
        componentInstanceIds,
        hierarchyPath: PCB_BOARD_HIERARCHY_PATH,
        assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID,
        signal,
      });
      if (authority) {
        const reassembled = assembleAgentRunContext({
          ...requestScope,
          schematic: body.schematicState,
          board: editorBoard,
          schematicHeadMark: body.schematicHeadMark,
          selection: editorSelection,
          netlist: editorNetlist,
          editorSchematicDigest,
          pcbProposalBasis: editorPcbProposalBasis,
          componentAuthority: authority,
          verifiedActor,
          view: body.viewContext,
          autonomy,
        });
        // Fail closed: a re-assembly failure keeps the authority-free context.
        if (reassembled.ok) runContext = reassembled.context;
      }
    }
  }

  const runId = `run-${randomUUID()}`;
  const registry = sirkitToolRegistry();
  // [B18-B] the execution-grant MINTER — the only place a grant is created —
  // is built HERE from the trusted request context (verified principal, role,
  // membership revision, session identity, validated scope, the server-read
  // autonomy setting, the literal user instruction) and handed to the gateway
  // and the loop as a closure: the agent layer never sees an instruction, a
  // nonce or a store. Only a human session principal with a readable autonomy
  // setting can be granted anything; otherwise execution is simply unavailable
  // for the run (proposals unaffected — unavailability never widens).
  let executionGrants: AgentExecutionGrantMinter | undefined;
  if (autonomy && context.actor.actorKind === "human" && (context.authMethod === "supabase_cookie" || context.authMethod === "local_dev")) {
    executionGrants = createExecutionGrantMinter({
      principalId: context.principalId,
      role: context.actor.role,
      membershipRevision: context.membershipRevision,
      authClass: context.authMethod,
      sessionIdentity: context.sessionIdentity,
      correlationId: context.correlationId,
      scope: requestScope,
      boardInstanceId: pcbBoardInstanceId(requestScope.projectId),
      autonomy,
      userMessage,
      runId,
      provider,
    });
  }
  // [B14 §B] SERVER-OWNED published pin facts for the replacement proposal
  // path: production cancellable reads (DATABASE_URL-gated), each wrapped in
  // the abort/deadline settlement machine bound to THIS request's signal.
  const replacementFactsSource = resolveReplacementPinFactsSource();
  const gateway = createAgentToolGateway(registry, {
    ...(executionGrants ? { executionGrants } : {}),
    ...(replacementFactsSource
      ? { replacementPinFacts: (atomicPartRevisionId: string) => loadRunReplacementPinFacts(replacementFactsSource, atomicPartRevisionId, signal) }
      : {}),
    // [B17-F] the SAME local FreeRouting pass executor the autoroute route
    // uses, bound to this request's signal and the tool's deadline; an
    // unavailable runtime refuses the routing proposal truthfully.
    routingExecutor: async ({ signal: toolSignal, timeoutMs }) => {
      const runtimeInfo = await resolveFreeroutingRuntime();
      if (!runtimeInfo.ok) return { ok: false, reason: `local routing engine unavailable: ${String(runtimeInfo.error).slice(0, 160)}` };
      const controller = new AbortController();
      for (const source of [signal, toolSignal]) {
        if (!source) continue;
        if (source.aborted) controller.abort();
        else source.addEventListener("abort", () => controller.abort(), { once: true });
      }
      return { ok: true, executor: createFreeroutingPassExecutor({ runtimeInfo, deadline: Date.now() + timeoutMs, signal: controller.signal }) };
    },
  });
  const adapter = agentAdapterFor(provider);
  // [B11] every run produces ONE bounded, redacted, provider-neutral trace.
  // Identity is frozen at construction; the recorder observes normalized
  // events only and can never alter authorization or the run outcome.
  let resourceManifestDigest: string | null = null;
  if (runContext.canonicalState && runContext.canonicalRevisionDigest) {
    try { resourceManifestDigest = buildAgentResourceBundle(runContext).manifestDigest; } catch { resourceManifestDigest = null; }
  }
  // [B11.1] a failing sink factory can never abort the request: it falls
  // back to an isolated in-memory sink and is classified on the trace.
  const traceSink = createAgentTraceSink();
  const traceRecorder = new AgentTraceRecorder({
    runId,
    traceId: `trace-${randomUUID()}`,
    provider,
    promptVersion: AGENT_SYSTEM_PROMPT_VERSION,
    promptDigest: engineeringDigest({ schema: "sirkit.agent-prompt.v1", prompt: AGENT_SYSTEM_PROMPT }),
    registryDigest: registry.digest(),
    scope: requestScope,
    contextDigests: {
      canonicalRevisionDigest: runContext.canonicalRevisionDigest,
      schematicDigest: runContext.schematicDigest,
      selectionDigest: runContext.selectionDigest,
      netlistDigest: runContext.netlistDigest,
      resourceManifestDigest,
    },
  }, traceSink.sink, undefined, traceSink.factoryFailed ? { initialDiagnostics: ["trace_sink_factory_failure"] } : undefined);

  // [B11.1] EVERY route path funnels through ONE finalization attempt.
  // Finalization is passive: it can never throw into the stream, never
  // emit a second UI terminal event, and never change the run outcome.
  const finalizeTrace = (outcome: "completed" | "failed" | "cancelled", failureReason: string | null): void => {
    try {
      if (traceRecorder.isFinalized) return;
      if (!traceRecorder.hasTerminal) traceRecorder.recordTerminal(outcome, failureReason);
      const trace = traceRecorder.finalize({ outcome, failureReason });
      if (validateAgentRunTrace(trace).length === 0) void agentRunTraceDigest(trace);
    } catch { /* tracing is passive */ }
  };
  const abort = new AbortController();
  // [B11.1] the listener is attached AFTER several awaits (bounded read,
  // parsing, context assembly). An AbortSignal that is ALREADY aborted
  // never fires a later-added listener, so a client that disconnected
  // during those awaits would otherwise run to completion — spending
  // provider budget and recording a "completed" trace for an abandoned
  // run. Propagate the existing abort explicitly.
  if (signal.aborted) abort.abort();
  else signal.addEventListener("abort", () => abort.abort(), { once: true });

  const encoder = new TextEncoder();
  let seq = 0;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      // [B11.1] "exactly one UI terminal event" is enforced at the ROUTE as
      // well as inside the loop: the loop's own guard is private to it, so
      // the route keeps its own so no later path (outer catch, finally) can
      // append a second terminal to the stream.
      let streamTerminalEmitted = false;
      const emit = (event: AgentRunEvent): void => {
        const terminal = event.type === "run_completed" || event.type === "run_failed";
        if (terminal && streamTerminalEmitted) return;
        if (terminal) streamTerminalEmitted = true;
        seq += 1;
        controller.enqueue(encoder.encode(JSON.stringify({ v: CHAT_PROTOCOL_VERSION, seq, ...event }) + "\n"));
      };
      // [B11.1] the trace's run_started is recorded HERE, before the loop,
      // so an unexpected loop throw still yields a COMPLETE, valid trace
      // (the run genuinely started). `recordRunStarted` is idempotent, so
      // the loop's own normalized run_started event is a no-op and the
      // event order is unchanged.
      try { traceRecorder.recordRunStarted(); } catch { /* tracing is passive */ }
      try {
        // [B09.1] run_started is emitted FIRST (inside the loop, exactly
        // once); context warnings follow it via contextWarnings.
        const result = await runAgentLoop(
          { runId, provider, history: priorHistory, userMessage, budget: DEFAULT_AGENT_BUDGET, signal: abort.signal },
          {
            adapter,
            gateway,
            registry,
            context: runContext,
            system: AGENT_SYSTEM_PROMPT,
            emit,
            contextWarnings: [...assembly.warnings, ...autonomyWarnings],
            trace: traceRecorder,
            ...(executionGrants ? { executionGrants } : {}),
          },
        );
        // [B11] finalize + validate the trace. A trace/sink failure is
        // classified inside the recorder and can NEVER emit a second
        // terminal event or change the run's outcome. Normal completion,
        // normalized provider failure, cancellation, deadline, and tool
        // refusal all arrive here as the loop's normalized result.
        finalizeTrace(result.status, result.failureReason ?? null);
      } catch {
        // The loop itself converts provider errors into run_failed events;
        // anything reaching here is an unexpected loop throw or a stream
        // infrastructure failure. [B11.1] the trace records the SAME
        // classification before finalization.
        try {
          if (!traceRecorder.hasTerminal) traceRecorder.recordTerminal("failed", "stream_error");
        } catch { /* tracing is passive */ }
        try {
          emit({ type: "run_failed", runId, reason: "stream_error", message: "The agent stream failed (details redacted)." });
        } catch { /* the controller itself failed; finalization still runs */ }
        finalizeTrace("failed", "stream_error");
      } finally {
        // [B11.1] belt and braces: a path that reached neither branch (for
        // example an enqueue failure mid-stream) still finalizes exactly
        // one trace. `finalizeTrace` is idempotent.
        finalizeTrace("failed", "stream_error");
        try { controller.close(); } catch { /* already closed or errored */ }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Sirkit-Chat-Protocol": String(CHAT_PROTOCOL_VERSION),
      "X-Sirkit-AI-Provider": provider,
      "X-Sirkit-Run-Id": runId,
      "Cache-Control": "no-store",
    },
  });
});
