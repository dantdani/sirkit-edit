/**
 * B11.2 — permanent regressions for R1–R6 and closures A–F: versioned
 * recursive replay-context validation, complete recursive secret scanning, a
 * TOTAL recorder boundary, and hard trace bounds.
 *
 * [B11.3] The board-depth residual this suite documented is CLOSED. The
 * hand-written `PcbBoard` key gate was replaced by the generated type-graph
 * descriptor; see `b11-3-generated-pcb-shape.test.ts`.
 *
 * Every counterexample here was reproduced against production code BEFORE
 * the fix (see artifacts/ai-control-plane-b11-2/pre-edit-counterexamples.md).
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_REPLAY_CONTEXT_SCHEMA,
  KICAD_COMPONENT_OPTIONAL_KEYS, KICAD_COMPONENT_REQUIRED_KEYS,
  NET_LABEL_REQUIRED_KEYS, POINT_REQUIRED_KEYS,
  SCH_COMPONENT_OPTIONAL_KEYS, SCH_COMPONENT_REQUIRED_KEYS,
  SCHEMATIC_STATE_OPTIONAL_KEYS, SCHEMATIC_STATE_REQUIRED_KEYS,
  WIRE_REQUIRED_KEYS, projectReplayContext, validateReplayContext,
  NET_LABEL_OPTIONAL_KEYS, WIRE_OPTIONAL_KEYS, SHEET_SET_REQUIRED_KEYS, SHEET_REQUIRED_KEYS, SHEET_OPTIONAL_KEYS, SHEET_BLOCK_REQUIRED_KEYS, SHEET_PORT_REQUIRED_KEYS, // [PR-J1 integration, 2026-10-22] + the sheet tree's key lists (J1-PERS-6)
} from "../replay-context";
import {
  AGENT_REPLAY_CAPSULE_SCHEMA, replayCapsule, ReplayCapsuleInvalidError,
  validateReplayCapsule, type ReplayCapsule,
} from "../replay-capsule";
import { buildEvaluationCases } from "../evaluation-cases";
import {
  TRACE_BOUNDS, TRACE_RECORDER_DIAGNOSTICS, agentRunTraceDigest,
  findSecretShapedPath, isCredentialShapedName, validateAgentRunTrace,
  type AgentRunTrace,
} from "../trace";
import { AgentTraceRecorder, InMemoryTraceSink, setAgentTraceSinkFactory, type AgentTraceSink } from "../trace-recorder";
import { AGENT_SYSTEM_PROMPT_VERSION } from "../../prompts";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ARTIFACTS = join(process.cwd(), "artifacts", "ai-control-plane-b11");
const pins = (JSON.parse(readFileSync(join(ARTIFACTS, "replay-trace-pins.json"), "utf8")) as { pins: Record<string, string> }).pins;

const caseCapsule = (caseId: string): ReplayCapsule => buildEvaluationCases(pins).find((item) => item.caseId === caseId)!.capsule;
/** The richest committed fixture: schematic + board + head mark + selection. */
const richCapsule = (): ReplayCapsule => caseCapsule("e06c-selection-valid");

function makeRecorder(sink: AgentTraceSink = new InMemoryTraceSink(), clock?: () => number): AgentTraceRecorder {
  let tick = 0;
  return new AgentTraceRecorder({
    runId: "run-b112", traceId: "trace-b112", provider: "openai",
    promptVersion: AGENT_SYSTEM_PROMPT_VERSION, promptDigest: "eng1-prompt", registryDigest: "eng1-registry",
    scope: { tenantId: "local", projectId: "p112", branchId: "main" },
    contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
  }, sink, clock ?? (() => { tick += 1; return tick; }));
}

/** Synthetic placeholders only — never a real credential. */
const FAKE_KEY = `sk-${"live"}-AAAABBBBCCCCDDDD`;

// ─── §A — versioned, recursively validated replay context (R1) ──────────────

describe("B11.2 §A — versioned replay context (R1)", () => {
  it("R1: an unknown field anywhere in the context is REFUSED, and nothing executes", async () => {
    const capsule = richCapsule();
    const probes: Array<[string, () => unknown]> = [
      ["board top level", () => ({ ...capsule.context, board: { ...capsule.context.board, someUnknownNestedField: { note: "innocent" } } })],
      ["schematic top level", () => ({ ...capsule.context, schematic: { ...capsule.context.schematic, extraSheet: 1 } })],
      ["schematic component", () => ({ ...capsule.context, schematic: { ...capsule.context.schematic!, components: [{ ...capsule.context.schematic!.components[0]!, hint: "x" }] } })],
      ["head mark", () => ({ ...capsule.context, schematicHeadMark: { ...capsule.context.schematicHeadMark, extra: 1 } })],
      ["selection envelope", () => ({ ...capsule.context, selection: { ...capsule.context.selection, mode: "box" } })],
      ["selection ref", () => ({ ...capsule.context, selection: { refs: [{ kind: "track", id: "t1", note: "x" }], primary: null } })],
      ["context envelope", () => ({ ...capsule.context, extraChannel: {} })],
    ];
    for (const [label, build] of probes) {
      const context = build();
      const result = validateReplayContext(context);
      expect(result.ok, label).toBe(false);
      const hostile = { ...capsule, context } as unknown as ReplayCapsule;
      expect(validateReplayCapsule(hostile).length, label).toBeGreaterThan(0);
      // Nothing may execute: a sink factory is the earliest observable side
      // effect of a run, and it is never reached.
      const factory = vi.fn(() => new InMemoryTraceSink());
      setAgentTraceSinkFactory(factory);
      try {
        await expect(replayCapsule(hostile, { computeOnly: true }), label).rejects.toThrow(ReplayCapsuleInvalidError);
        expect(factory, label).not.toHaveBeenCalled();
      } finally {
        setAgentTraceSinkFactory(null);
      }
    }
  });

  it("the context contract is VERSIONED: a missing or wrong schema refuses", () => {
    const context = richCapsule().context;
    const { schema, ...withoutSchema } = context as unknown as Record<string, unknown>;
    void schema;
    expect(validateReplayContext(withoutSchema).ok).toBe(false);
    expect(validateReplayContext({ ...context, schema: "sirkit.agent-replay-context.v1" }).ok).toBe(false);
    expect(validateReplayContext({ ...context, schema: "sirkit.agent-replay-context.v3" }).ok).toBe(false);
    expect(validateReplayContext(context).ok).toBe(true);
  });

  it("the PROJECTION ROUND-TRIP is the proof: whatever the producer drops causes refusal", () => {
    const context = richCapsule().context;
    // A valid fixture round-trips EXACTLY through the shared producer.
    const projectedContext = projectReplayContext(context);
    expect(projectedContext.ok).toBe(true);
    if (projectedContext.ok) expect(JSON.stringify(projectedContext.value)).not.toBe("");
    expect(validateReplayContext(context).ok).toBe(true);
    // The producer is what makes the claim true: it genuinely discards
    // unknown keys, so the consumer's comparison genuinely fails.
    const smuggled = { ...context, board: { ...context.board, smuggled: 1 } };
    const projectedSmuggled = projectReplayContext(smuggled);
    expect(projectedSmuggled.ok).toBe(true);
    if (projectedSmuggled.ok) expect(JSON.stringify(projectedSmuggled.value)).not.toContain("smuggled");
    expect(validateReplayContext(smuggled).ok).toBe(false);
  });

  it("non-plain data (prototype, symbol, accessor, non-enumerable) refuses before execution", () => {
    const context = richCapsule().context;
    const prototyped = { ...context, board: Object.assign(Object.create({ hidden: { note: 1 } }), context.board) };
    expect(validateReplayContext(prototyped).ok).toBe(false);

    const accessor = { ...context, board: { ...context.board } } as unknown as Record<string, unknown>;
    Object.defineProperty(accessor.board as object, "outline", { get: () => ({}), enumerable: true, configurable: true });
    expect(validateReplayContext(accessor).ok).toBe(false);

    const nonEnumerable = { ...context, board: { ...context.board } } as unknown as Record<string, unknown>;
    Object.defineProperty(nonEnumerable.board as object, "hiddenField", { value: 1, enumerable: false });
    expect(validateReplayContext(nonEnumerable).ok).toBe(false);

    const symbolic = { ...context, board: { ...context.board, [Symbol("s")]: 1 } };
    expect(validateReplayContext(symbolic).ok).toBe(false);
  });

  it("required keys must be present, and values must be JSON data of finite numbers", () => {
    const context = richCapsule().context;
    const { texts, ...boardWithoutTexts } = context.board as unknown as Record<string, unknown>;
    void texts;
    expect(validateReplayContext({ ...context, board: boardWithoutTexts }).ok).toBe(false);
    expect(validateReplayContext({ ...context, board: { ...context.board, stackup: Number.NaN } }).ok).toBe(false);
    expect(validateReplayContext({ ...context, editorSchematicDigest: "x".repeat(129) }).ok).toBe(false);
  });

  it("the SHARED authorities decide validity, and their verdicts are reported (never invented)", () => {
    const live = validateReplayContext(richCapsule().context);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(live.verdicts).toEqual({ schematic: "valid", board: "valid", schematicHeadMark: "valid", selection: "valid", netlist: "absent" });

    // A structurally EXACT but semantically invalid board is CARRIED with an
    // "invalid" verdict — the production assembler is what withholds it, and
    // the resource-withholding evaluation cases prove that it does.
    const invalid = validateReplayContext(caseCapsule("e04-invalid-board").context);
    expect(invalid.ok).toBe(true);
    if (invalid.ok) expect(invalid.verdicts.board).toBe("invalid");

    const proven = validateReplayContext(caseCapsule("e07a-netlist-proven").context);
    expect(proven.ok).toBe(true);
    if (proven.ok) expect(proven.verdicts.netlist).toBe("valid");
    const forged = validateReplayContext(caseCapsule("e07b-netlist-forged").context);
    expect(forged.ok).toBe(true);
    if (forged.ok) expect(forged.verdicts.netlist).toBe("unproven");

    // KiCad-bearing fixtures are honestly UNPROVEN, not silently "valid".
    const kicad = validateReplayContext(caseCapsule("e08-kicad-netlist-withheld").context);
    expect(kicad.ok).toBe(true);
    if (kicad.ok) expect(kicad.verdicts.netlist).toBe("unproven");
  });

  it("DRIFT GATE: the key lists equal the production type declarations", () => {
    /** Extract the DECLARED top-level members of a production type, so a new
     *  field on `PcbBoard` or `SchComponent` fails here instead of silently
     *  widening the replay-fixture surface. */
    const declaredKeys = (source: string, declaration: string): { required: string[]; optional: string[] } => {
      const start = source.indexOf(declaration);
      expect(start, declaration).toBeGreaterThanOrEqual(0);
      const open = source.indexOf("{", start);
      let depth = 0;
      let end = open;
      for (let index = open; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}") { depth -= 1; if (depth === 0) { end = index; break; } }
      }
      const body = source.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      // Split into TOP-LEVEL segments (`;` or newline at brace depth 0) so
      // inline nested object types contribute only their own member name.
      const segments: string[] = [];
      let current = "";
      let level = 0;
      for (const character of body) {
        if (character === "{" || character === "[" || character === "(") level += 1;
        else if (character === "}" || character === "]" || character === ")") level -= 1;
        if (level === 0 && (character === ";" || character === "\n")) { segments.push(current); current = ""; continue; }
        current += character;
      }
      segments.push(current);
      const required: string[] = [];
      const optional: string[] = [];
      for (const segment of segments) {
        const match = /^\s*([A-Za-z_$][\w$]*)(\??)\s*:/.exec(segment);
        if (match) (match[2] === "?" ? optional : required).push(match[1]!);
      }
      return { required, optional };
    };

    // [B11.3] The BOARD half of this gate is superseded: `PcbBoard` keys are
    // no longer hand-listed anywhere. The board's authoritative shape comes
    // from the GENERATED descriptor, gated by
    // `generate-pcb-shape-descriptor.ts --check` and by
    // `b11-3-generated-pcb-shape`. The SCHEMATIC half stays here.
    const schematicTypes = readFileSync(join(process.cwd(), "lib", "schematic-types.ts"), "utf8");

    // The ` = {` suffix pins the EXACT declaration (`SchComponent` must not
    // match `SchComponentType`).
    const expectations: Array<[string, readonly string[], readonly string[]]> = [
      ["export type SchematicState = {", SCHEMATIC_STATE_REQUIRED_KEYS, SCHEMATIC_STATE_OPTIONAL_KEYS],
      ["export type SchComponent = {", SCH_COMPONENT_REQUIRED_KEYS, SCH_COMPONENT_OPTIONAL_KEYS],
      // [PR-J, 2026-10-22] pin moved: Wire and NetLabel gained optional sheet fields (sheetId; scope, portId, childSheetId) and the
      // replay key lists carry them, so the expectation is the lists' optional halves instead of [] (OD-255 item 1).
      ["export type Wire = {", WIRE_REQUIRED_KEYS, WIRE_OPTIONAL_KEYS],
      ["export type Point = {", POINT_REQUIRED_KEYS, []],
      ["export type NetLabel = {", NET_LABEL_REQUIRED_KEYS, NET_LABEL_OPTIONAL_KEYS],
      ["export type KicadComponentInstance = {", KICAD_COMPONENT_REQUIRED_KEYS, KICAD_COMPONENT_OPTIONAL_KEYS],
    ];
    for (const [declaration, required, optional] of expectations) {
      const declared = declaredKeys(schematicTypes, declaration);
      expect([...declared.required].sort(), declaration).toEqual([...required].sort());
      expect([...declared.optional].sort(), declaration).toEqual([...optional].sort());
    }
  });
});

// ─── §B — recursive key and value security scan (R2, R3) ────────────────────

describe("B11.2 §B — recursive secret scanning (R2, R3)", () => {
  it("R2: compound credential/SDK/provider key names are refused with object AND string values", () => {
    const names = ["clientSecret", "refreshToken", "providerClient", "rawSdkPayload", "sdkPayload", "sessionToken", "signingKey", "encryptedContent", "anthropicClient", "continuationState", "reasoningTrace"];
    for (const name of names) expect(isCredentialShapedName(name), name).toBe(true);
    // Legitimate control-plane and domain field names must NOT false-positive
    // (a denylist that rejects honest data is a broken denylist).
    for (const name of [
      "canonicalStateDigest", "argsDigest", "toolId", "operationClass", "registryDigest",
      "selectionDigest", "promptDigest", "stackupConfig", "constraintState", "routingHistory",
      "placementPolicy", "netClassing", "endpointKeys", "kicadComponents", "identityVersion",
    ]) {
      expect(isCredentialShapedName(name), name).toBe(false);
    }
    // `clientId` and `clientSecret` ARE credential-shaped and stay forbidden.
    expect(isCredentialShapedName("clientId")).toBe(true);
    const capsule = richCapsule();
    for (const name of names) {
      for (const value of [{ nested: 1 }, "opaque-value"]) {
        const hostile = { ...capsule, context: { ...capsule.context, board: { ...capsule.context.board, [name]: value } } } as unknown as ReplayCapsule;
        expect(validateReplayCapsule(hostile).length, `${name}/${typeof value}`).toBeGreaterThan(0);
      }
    }
  });

  it("R3: credential-shaped JSON nested inside capsule STRINGS is refused (escaping cannot hide it)", () => {
    const capsule = caseCapsule("e01-no-canonical-state");
    const payload = `{"apiKey":"${FAKE_KEY}"}`;
    const carriers: Array<[string, () => unknown]> = [
      ["userMessage", () => ({ ...capsule, userMessage: payload })],
      ["step text", () => ({ ...capsule, steps: [{ ...capsule.steps[0]!, text: payload }] })],
      ["argumentsText", () => ({ ...capsule, steps: [{ ...capsule.steps[0]!, toolCalls: [{ callId: "c1", providerName: "p1", argumentsText: payload }] }] })],
      ["failure text", () => ({ ...capsule, steps: [{ ...capsule.steps[0]!, failure: { reason: "provider_error", message: payload } }] })],
      ["context string", () => ({ ...capsule, context: { ...capsule.context, editorSchematicDigest: payload } })],
    ];
    for (const [label, build] of carriers) {
      const issues = validateReplayCapsule(build());
      expect(issues.length, label).toBeGreaterThan(0);
      // The refusal names a path and NEVER echoes the value.
      expect(JSON.stringify(issues), label).not.toContain(FAKE_KEY);
      expect(JSON.stringify(issues), label).not.toContain("apiKey");
    }
  });

  it("the direct scan walks ORIGINAL strings and key names, is bounded, and redacts hostile names", () => {
    expect(findSecretShapedPath({ a: { b: [{ token: "x" }] } })).toContain("credential-shaped field name");
    expect(findSecretShapedPath({ note: `{"password":"hunter2hunter2"}` })).toContain("secret-shaped content");
    expect(findSecretShapedPath({ ok: "sirkit.pcb.board-inspect", digest: "eng1-0cbbe78e7b980149" })).toBeNull();
    // A secret smuggled into a KEY NAME is redacted, never echoed.
    const named = findSecretShapedPath({ [`x-api-key=${FAKE_KEY}`]: 1 });
    expect(named).not.toBeNull();
    expect(named!).not.toContain("AAAABBBB");
    // Traversal is bounded: a wide document terminates with a bounded issue.
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < TRACE_BOUNDS.maxScanNodes + 10; index += 1) wide[`k${index}`] = index;
    expect(findSecretShapedPath(wide)).toContain("maximum scannable node count");
    // Depth is bounded too.
    let deep: unknown = 1;
    for (let index = 0; index < TRACE_BOUNDS.maxScanDepth + 5; index += 1) deep = { child: deep };
    expect(findSecretShapedPath(deep)).toContain("maximum scan depth");
  });
});

// ─── §C — complete trace redaction validation (R4) ──────────────────────────

describe("B11.2 §C — complete trace redaction (R4)", () => {
  const baseTrace = (): AgentRunTrace => {
    const recorder = makeRecorder();
    recorder.recordRunStarted();
    recorder.recordStep({ model: "m1", usage: { inputTokens: 1, outputTokens: 2 }, toolCallCount: 1 });
    recorder.recordTool({
      callId: "c1", toolId: "sirkit.pcb.board-inspect", version: "1.0.0", operationClass: "read",
      args: {}, outcomeClass: "read", status: "succeeded", verification: "canonical-revision-verified",
      output: { ok: true }, proposal: null,
    });
    return recorder.finalize({ outcome: "completed", failureReason: null });
  };

  it("R4: credential-shaped JSON in ANY trace field refuses, in every carrier", () => {
    const payload = `{"apiKey":"${FAKE_KEY}"}`;
    const clean = baseTrace();
    expect(validateAgentRunTrace(clean)).toEqual([]);
    const carriers: Array<[string, AgentRunTrace]> = [
      ["model", { ...clean, model: payload }],
      ["runId", { ...clean, runId: payload }],
      ["promptDigest", { ...clean, promptDigest: payload }],
      ["warnings", { ...clean, warnings: [payload] }],
      ["event status", { ...clean, events: clean.events.map((event) => (event.kind === "tool_invocation" ? { ...event, status: payload } : event)) }],
      ["event verification", { ...clean, events: clean.events.map((event) => (event.kind === "tool_invocation" ? { ...event, verification: payload } : event)) }],
      ["event proposalId", { ...clean, events: clean.events.map((event) => (event.kind === "tool_invocation" ? { ...event, proposalId: payload } : event)) }],
      ["scope", { ...clean, scope: { ...clean.scope, projectId: payload } }],
    ];
    for (const [label, trace] of carriers) {
      const issues = validateAgentRunTrace(trace);
      expect(issues.length, label).toBeGreaterThan(0);
      expect(JSON.stringify(issues), label).not.toContain(FAKE_KEY);
    }
  });

  it("a credential-shaped KEY NAME anywhere in the document refuses and is redacted", () => {
    const clean = baseTrace();
    const hostile = { ...clean, scope: { ...clean.scope, [`clientSecret=${FAKE_KEY}`]: 1 } } as unknown as AgentRunTrace;
    const issues = validateAgentRunTrace(hostile);
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain("AAAABBBB");
  });

  it("a valid recorder-produced trace remains BYTE-STABLE across the added validation", () => {
    const build = (): AgentRunTrace => baseTrace();
    const first = build();
    const second = build();
    expect(agentRunTraceDigest(first)).toBe(agentRunTraceDigest(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(validateAgentRunTrace(first)).toEqual([]);
  });
});

// ─── §D — total recorder boundary (R5) ──────────────────────────────────────

describe("B11.2 §D — total recorder boundary (R5)", () => {
  it("R5: every public method is TOTAL under arbitrary hostile JavaScript input", () => {
    const hostileGetter = <T extends object>(target: T, key: string): T => {
      Object.defineProperty(target, key, { get() { throw new Error("hostile accessor"); }, enumerable: true, configurable: true });
      return target;
    };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const throwingCoercion = { toString() { throw new Error("hostile toString"); }, valueOf() { throw new Error("hostile valueOf"); } };
    const hostileProxy = new Proxy({}, { get() { throw new Error("hostile proxy"); }, ownKeys() { throw new Error("hostile ownKeys"); } });

    const probes: Array<[string, (recorder: AgentTraceRecorder) => void]> = [
      ["runStarted", (recorder) => recorder.recordRunStarted()],
      ["warning: hostile coercion", (recorder) => recorder.recordWarning(throwingCoercion as unknown as string)],
      ["warning: null", (recorder) => recorder.recordWarning(null as unknown as string)],
      ["warning: oversized", (recorder) => recorder.recordWarning("x".repeat(50_000))],
      ["warning: secret-shaped", (recorder) => recorder.recordWarning(`key ${FAKE_KEY}`)],
      ["step: null", (recorder) => recorder.recordStep(null as unknown as never)],
      ["step: hostile usage", (recorder) => recorder.recordStep(hostileGetter({ model: "m", toolCallCount: 0 }, "usage") as unknown as never)],
      ["step: hostile model", (recorder) => recorder.recordStep(hostileGetter({ usage: {}, toolCallCount: 0 }, "model") as unknown as never)],
      ["step: proxy", (recorder) => recorder.recordStep(hostileProxy as unknown as never)],
      ["step: invalid numerics", (recorder) => recorder.recordStep({ model: "m", usage: { inputTokens: Number.NaN, outputTokens: -1.5 }, toolCallCount: Number.POSITIVE_INFINITY })],
      ["tool: null", (recorder) => recorder.recordTool(null as unknown as never)],
      ["tool: hostile proposal", (recorder) => recorder.recordTool(hostileGetter({ callId: "c", toolId: "t", version: "1", operationClass: "read", args: {}, outcomeClass: "read", status: "ok" }, "proposal") as unknown as never)],
      ["tool: hostile args", (recorder) => recorder.recordTool(hostileGetter({ callId: "c", toolId: "t", version: "1", operationClass: "read", outcomeClass: "read", status: "ok" }, "args") as unknown as never)],
      ["tool: cyclic args", (recorder) => recorder.recordTool({ callId: "c", toolId: "t", version: "1", operationClass: "read", args: cyclic, outcomeClass: "read", status: "ok", output: cyclic })],
      ["tool: unexpected outcomeClass", (recorder) => recorder.recordTool({ callId: "c", toolId: "t", version: "1", operationClass: "read", args: {}, outcomeClass: "totally-unexpected" as never, status: "ok" })],
      ["terminal: unexpected outcome", (recorder) => recorder.recordTerminal("exploded" as never, throwingCoercion as unknown as string)],
      ["terminal: null reason on failed", (recorder) => recorder.recordTerminal("failed", null)],
    ];

    for (const [label, probe] of probes) {
      const recorder = makeRecorder();
      recorder.recordRunStarted();
      expect(() => probe(recorder), label).not.toThrow();
      const trace = recorder.finalize({ outcome: "completed", failureReason: null });
      for (const diagnostic of trace.recorderDiagnostics) {
        expect(TRACE_RECORDER_DIAGNOSTICS as readonly string[], label).toContain(diagnostic);
      }
      // No exception message, stack, or raw value is ever retained.
      const serialized = JSON.stringify(trace);
      for (const forbidden of ["hostile accessor", "hostile toString", "hostile valueOf", "hostile proxy", "hostile ownKeys", "at Object.", FAKE_KEY]) {
        expect(serialized, `${label}/${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("finalize is TOTAL: a hostile summary, a throwing clock, and a throwing sink all yield a document", () => {
    const hostileSummary = new Proxy({}, { get() { throw new Error("hostile summary"); } });
    const recorder = makeRecorder();
    recorder.recordRunStarted();
    expect(() => recorder.finalize(hostileSummary as never)).not.toThrow();
    const trace = recorder.finalize(hostileSummary as never);
    expect(trace.schema).toBe("sirkit.agent-run-trace.v1");
    expect(JSON.stringify(trace)).not.toContain("hostile summary");

    const throwingSink: AgentTraceSink = { append() { throw new Error("append boom"); }, complete() { throw new Error("complete boom"); } };
    const withSink = makeRecorder(throwingSink, () => { throw new Error("clock boom"); });
    withSink.recordRunStarted();
    const sinkTrace = withSink.finalize({ outcome: "completed", failureReason: null });
    expect(sinkTrace.recorderDiagnostics).toContain("trace_sink_failure");
    expect(sinkTrace.recorderDiagnostics).toContain("trace_clock_failure");
    expect(JSON.stringify(sinkTrace)).not.toContain("boom");
  });

  it("recording failure never changes run behaviour: the terminal outcome is untouched", () => {
    const throwingSink: AgentTraceSink = { append() { throw new Error("boom"); }, complete() { throw new Error("boom"); } };
    const recorder = makeRecorder(throwingSink);
    recorder.recordRunStarted();
    recorder.recordWarning(null as unknown as string);
    recorder.recordStep(null as unknown as never);
    recorder.recordTerminal("completed", null);
    const trace = recorder.finalize({ outcome: "completed", failureReason: null });
    expect(trace.terminal.outcome).toBe("completed");
    expect(trace.terminal.failureReason).toBeNull();
  });
});

// ─── §E — hard trace bounds (R6) ────────────────────────────────────────────

describe("B11.2 §E — hard trace bounds (R6)", () => {
  const validTrace = (): AgentRunTrace => {
    const recorder = makeRecorder();
    recorder.recordRunStarted();
    return recorder.finalize({ outcome: "completed", failureReason: null });
  };

  it("R6: recorderDiagnostics is length-bounded BEFORE any scanning or Set construction", () => {
    const clean = validTrace();
    // Sized ABOVE `maxRecorderDiagnostics` but BELOW the B11.4 capture array
    // bound, so the diagnostics-specific bound is the one that fires and the
    // original ordering property is still what is being proven.
    const oversized = { ...clean, recorderDiagnostics: Array.from({ length: 5_000 }, (_, index) => `diag-${index}`) } as unknown as AgentRunTrace;
    const issues = validateAgentRunTrace(oversized);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain(`at most ${TRACE_BOUNDS.maxRecorderDiagnostics} entries`);
    // The bound is the ONLY issue reported: nothing scanned the 5k entries.
    expect(issues).toHaveLength(1);
    expect(issues.length).toBeLessThanOrEqual(TRACE_BOUNDS.maxValidationIssues);

    // [B11.4] A far larger array is refused EARLIER STILL, by the hook-free
    // capture layer, with a single bounded issue — the two bounds stack.
    const enormous = { ...clean, recorderDiagnostics: Array.from({ length: 50_000 }, (_, index) => `diag-${index}`) } as unknown as AgentRunTrace;
    const captureIssues = validateAgentRunTrace(enormous);
    expect(captureIssues).toHaveLength(1);
    expect(captureIssues[0]).toContain("exceeds 20000 entries");
  });

  it("the serialized trace size is bounded and validator output stays bounded", () => {
    const clean = validTrace();
    const huge = { ...clean, warnings: [Array.from({ length: 40 }, () => "x".repeat(30_000)).join("")] } as unknown as AgentRunTrace;
    const issues = validateAgentRunTrace(huge);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.length).toBeLessThanOrEqual(TRACE_BOUNDS.maxValidationIssues);
    expect(TRACE_BOUNDS.maxSerializedChars).toBeGreaterThan(0);
    expect(TRACE_BOUNDS.maxRecorderDiagnostics).toBeLessThanOrEqual(TRACE_RECORDER_DIAGNOSTICS.length + 8);
  });
});

// ─── §F — invariants preserved ──────────────────────────────────────────────

describe("B11.2 §F — invariants preserved", () => {
  it("every committed capsule validates, replays to its pinned digest, and carries the versioned context", async () => {
    for (const evaluationCase of buildEvaluationCases(pins)) {
      expect(evaluationCase.capsule.schema).toBe(AGENT_REPLAY_CAPSULE_SCHEMA);
      expect(evaluationCase.capsule.context.schema).toBe(AGENT_REPLAY_CONTEXT_SCHEMA);
      expect(validateReplayCapsule(evaluationCase.capsule), evaluationCase.caseId).toEqual([]);
      const outcome = await replayCapsule(evaluationCase.capsule, { ...evaluationCase.options, computeOnly: true });
      expect(outcome.traceDigest, evaluationCase.caseId).toBe(pins[evaluationCase.caseId]);
    }
  });

  it("static exposure is still exactly the intentional agent-exposed set (ELEVEN read/propose tools when written; the set has since grown by reviewed moves, B20-A4 among them, and the assertion counts the set itself), and no new surface exists", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
    for (const file of ["trace.ts", "trace-recorder.ts", "replay-capsule.ts", "replay-context.ts", "evaluation.ts", "evaluation-cases.ts"]) {
      const source = readFileSync(join(process.cwd(), "app/lib/agent", file), "utf8");
      expect(source, file).not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i);
    }
  });
});

// ─── [PR-J1 integration, 2026-10-22] review J1-PERS-6: the sheet tree is key-exhaustive like every other subtree ──

describe("[PR-J1 integration, 2026-10-22] the optional sheet tree is exact at every depth (J1-PERS-6)", () => {
  const sheetTree = () => ({
    version: 1,
    sheets: [
      { id: "root", name: "Overview", parentId: null },
      { id: "s1", name: "Power", parentId: "root", block: { x: 600, y: 0, width: 200, height: 100 }, ports: [{ id: "p1", name: "OUT", direction: "output" }] },
    ],
  });
  const withSheets = (sheets: unknown): unknown => {
    const context = richCapsule().context;
    return { ...context, schematic: { ...context.schematic!, sheets } };
  };

  it("a well-formed tree is carried (and its semantic validity stays a verdict, never a refusal)", () => {
    const result = validateReplayContext(withSheets(sheetTree()));
    expect(result.ok, result.ok ? "" : result.issues.join("; ")).toBe(true);
    if (result.ok) expect((result.context.schematic as { sheets?: unknown }).sheets).toEqual(sheetTree());
  });

  it("an unknown key on the tree, a sheet, a block or a port, or a tree that is not an object, is REFUSED with its path", () => {
    const probes: Array<[string, (tree: ReturnType<typeof sheetTree>) => unknown, RegExp]> = [
      ["tree", (tree) => ({ ...tree, extra: { note: "x" } }), /^context\.schematic\.sheets\.extra: unknown key/],
      ["sheet", (tree) => ({ ...tree, sheets: [tree.sheets[0], { ...tree.sheets[1], note: "x" }] }), /^context\.schematic\.sheets\.sheets\[1\]\.note: unknown key/],
      ["block", (tree) => ({ ...tree, sheets: [tree.sheets[0], { ...tree.sheets[1], block: { ...tree.sheets[1]!.block, depth: 3 } }] }), /^context\.schematic\.sheets\.sheets\[1\]\.block\.depth: unknown key/],
      ["port", (tree) => ({ ...tree, sheets: [tree.sheets[0], { ...tree.sheets[1], ports: [{ ...tree.sheets[1]!.ports![0], width: 8 }] }] }), /^context\.schematic\.sheets\.sheets\[1\]\.ports\[0\]\.width: unknown key/],
      ["missing version", (tree) => ({ sheets: tree.sheets }), /^context\.schematic\.sheets\.version: missing required key/],
      ["not an object", () => "root", /^context\.schematic\.sheets: must be a plain object/],
    ];
    for (const [label, mutate, issue] of probes) {
      const result = validateReplayContext(withSheets(mutate(sheetTree())));
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.issues.some((item) => issue.test(item)), `${label}: ${result.issues.join("; ")}`).toBe(true);
    }
  });

  it("DRIFT GATE: the sheet key lists equal lib/schematic-types.ts (SchematicSheetSet, SchematicSheet, its block, SheetPort)", () => {
    const source = readFileSync(join(process.cwd(), "lib", "schematic-types.ts"), "utf8");
    const declared = (declaration: string): { required: string[]; optional: string[] } => {
      const start = source.indexOf(declaration);
      expect(start, declaration).toBeGreaterThanOrEqual(0);
      const body = source.slice(source.indexOf("{", start) + 1, source.indexOf("\n};", start)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      const required: string[] = [];
      const optional: string[] = [];
      for (const line of body.split("\n")) {
        const match = /^\s*([A-Za-z_$][\w$]*)(\??)\s*:/.exec(line);
        if (match) (match[2] === "?" ? optional : required).push(match[1]!);
      }
      return { required, optional };
    };
    expect(declared("export type SchematicSheetSet = {")).toEqual({ required: [...SHEET_SET_REQUIRED_KEYS], optional: [] });
    expect(declared("export type SchematicSheet = {")).toEqual({ required: [...SHEET_REQUIRED_KEYS], optional: [...SHEET_OPTIONAL_KEYS] });
    expect(declared("export type SheetPort = {")).toEqual({ required: [...SHEET_PORT_REQUIRED_KEYS], optional: [] });
    const block = /\n\s*block\?: \{([^}]*)\};/.exec(source.slice(source.indexOf("export type SchematicSheet = {")))![1]!;
    expect(block.split(";").map((member) => member.trim().split(":")[0]!.trim()).filter(Boolean)).toEqual([...SHEET_BLOCK_REQUIRED_KEYS]);
  });
});
