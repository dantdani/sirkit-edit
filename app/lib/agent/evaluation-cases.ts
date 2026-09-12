/**
 * B11 — the permanent evaluation matrix (16 minimum cases). Every case is
 * a sanitized replay capsule executed provider-free through the real
 * control plane. Trace digests are pinned in a committed generated file so
 * loop/registry/prompt drift fails EXPLICITLY.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { sirkitToolRegistry } from "../engineering/tool-catalog";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "../prompts";
import { engineeringDigest } from "../engineering/stable";
import { schematicStateDigest } from "../engineering/schematic-model";
import { buildNetlist } from "../pcb/netlist-bridge";
import { createEmptyBoard, type PcbBoard } from "../pcb/types";
import { LLMProviderError } from "../llm/errors";
import { projectAgentNetlist } from "./netlist-validation";
import { agentProviderName } from "./provider-tools";
import { AGENT_REPLAY_CAPSULE_SCHEMA, type CapsuleStep, type ReplayCapsule } from "./replay-capsule";
import { AGENT_REPLAY_CONTEXT_SCHEMA } from "./replay-context";
import { checks, EVALUATION_CASE_SCHEMA, type EvaluationCase, type EvaluationCategory } from "./evaluation";
import type { AgentTraceSink } from "./trace-recorder";

const SCOPE = { tenantId: "local", projectId: "eval", branchId: "main" };
const MARK = { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" };

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const KICAD_SCHEMATIC: SchematicState = {
  components: [], wires: [],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU" }],
  netLabels: [],
};
/**
 * [B11.2] A board that is EXACT in shape (every `PcbBoard` key present, no
 * unknown keys — the versioned replay context requires this) but that the
 * authoritative `validatePcbBoardStructure` REFUSES: the track carries an
 * empty identity. The case's meaning is unchanged — an invalid board still
 * withholds the canonical resource and every dependent tool — while the
 * transport itself is now well formed.
 */
function invalidBoard(): PcbBoard {
  const board = createEmptyBoard();
  board.tracks.push({ id: "", layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 3_000_000 }, end: { x: 5_000_000, y: 3_000_000 }, netId: 0, source: "human" });
  return board;
}

function boardWithTrack(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
  board.tracks.push({ id: "t1", layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 3_000_000 }, end: { x: 5_000_000, y: 3_000_000 }, netId: 1, source: "human" });
  return board;
}

const ALL_READS = [
  "sirkit.manufacturing.readiness-inspect",
  "sirkit.pcb.board-inspect",
  "sirkit.pcb.mechanical-inspect", // [B18-E E11] the bounded mechanical read: exposed wherever the full board snapshot is
  "sirkit.pcb.revision-inspect",
  "sirkit.project.canonical-revision-inspect",
  "sirkit.schematic.inspect",
  "sirkit.validation.connectivity-verify",
  "sirkit.validation.drc-run",
];
const PROPOSE = "sirkit.schematic.propose-tier1-edit";
/** [B17-F] the shared layout candidates: exposed whenever a verified canonical board exists (project_admin actor). */
const LAYOUT_PROPOSALS = ["sirkit.placement.propose", "sirkit.routing.propose"];
const SELECTION = "sirkit.selection.inspect";

function step(overrides?: Partial<CapsuleStep>): CapsuleStep {
  return { text: "done", toolCalls: [], stopReason: "completed", model: "scripted-model", usage: { inputTokens: 10, outputTokens: 5 }, ...overrides };
}

function callStep(toolId: string, argumentsText = "{}"): CapsuleStep {
  return step({ text: "", stopReason: "tool_use", toolCalls: [{ callId: `call-${toolId}`, providerName: agentProviderName(toolId), argumentsText }] });
}

/** Committed trace-digest pins (generated; drift fails explicitly). */
export type TraceDigestPins = Record<string, string>;

function capsule(input: {
  caseId: string;
  provider?: "openai" | "anthropic";
  context: Partial<ReplayCapsule["context"]>;
  steps: CapsuleStep[];
  discoveredTools: string[];
  toolOutcomes: ReplayCapsule["expected"]["toolOutcomes"];
  terminal: ReplayCapsule["expected"]["terminal"];
  pins: TraceDigestPins;
}): ReplayCapsule {
  return {
    schema: AGENT_REPLAY_CAPSULE_SCHEMA,
    caseId: input.caseId,
    provider: input.provider ?? "openai",
    promptVersion: AGENT_SYSTEM_PROMPT_VERSION,
    promptDigest: engineeringDigest({ schema: "sirkit.agent-prompt.v1", prompt: AGENT_SYSTEM_PROMPT }),
    registryDigest: sirkitToolRegistry().digest(),
    scope: SCOPE,
    context: {
      schema: AGENT_REPLAY_CONTEXT_SCHEMA,
      schematic: null, board: null, schematicHeadMark: null,
      selection: null, netlist: null, editorSchematicDigest: null,
      ...input.context,
    },
    userMessage: "inspect the project",
    steps: input.steps,
    expected: {
      discoveredTools: input.discoveredTools,
      toolOutcomes: input.toolOutcomes,
      terminal: input.terminal,
      traceDigest: input.pins[input.caseId] ?? "(unpinned)",
    },
  };
}

/** A sink that always throws — proves recorder failure cannot alter the run. */
export class ThrowingTraceSink implements AgentTraceSink {
  append(): void { throw new Error("sink append failed"); }
  complete(): void { throw new Error("sink complete failed"); }
}

export function buildEvaluationCases(pins: TraceDigestPins): EvaluationCase[] {
  const validNetlist = projectAgentNetlist(buildNetlist(SCHEMATIC));
  const forgedNetlist = { ...validNetlist, components: [] };
  const digest = schematicStateDigest(SCHEMATIC);
  const define = (caseId: string, title: string, category: EvaluationCategory, capsuleValue: ReplayCapsule, caseChecks: EvaluationCase["checks"], options?: EvaluationCase["options"]): EvaluationCase => ({
    schema: EVALUATION_CASE_SCHEMA, caseId, title, category, capsule: capsuleValue, checks: caseChecks, ...(options ? { options } : {}),
  });

  return [
    // 1 — no canonical state: board reads unavailable.
    define("e01-no-canonical-state", "No canonical state: board reads unavailable", "resource-withholding",
      capsule({ caseId: "e01-no-canonical-state", context: {}, steps: [step()], discoveredTools: [], toolOutcomes: [], terminal: { outcome: "completed", failureReason: null }, pins }),
      [checks.toolsExactly([]), checks.traceIsClean()]),

    // 2 — schematic + head mark only: proposal availability exact.
    define("e02-schematic-only", "Schematic-only context: proposal only, no reads", "discovery",
      capsule({ caseId: "e02-schematic-only", context: { schematic: SCHEMATIC, schematicHeadMark: MARK }, steps: [step()], discoveredTools: [PROPOSE], toolOutcomes: [], terminal: { outcome: "completed", failureReason: null }, pins }),
      [checks.toolsExactly([PROPOSE]), ...ALL_READS.map((toolId) => checks.toolAbsent(toolId))]),

    // 3 — valid board context: reads are exact and succeed.
    define("e03-valid-board", "Valid board context: board/DRC/connectivity/readiness reads exact", "tool-selection",
      capsule({
        caseId: "e03-valid-board",
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK },
        steps: [callStep("sirkit.pcb.board-inspect"), callStep("sirkit.validation.drc-run"), step()],
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(),
        toolOutcomes: [
          { toolId: "sirkit.pcb.board-inspect", outcomeClass: "read", status: "succeeded" },
          { toolId: "sirkit.validation.drc-run", outcomeClass: "read", status: "succeeded" },
        ],
        terminal: { outcome: "completed", failureReason: null }, pins,
      }),
      [checks.toolsExactly([...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE]), checks.outcomeStatus("sirkit.pcb.board-inspect", "succeeded"), checks.traceIsClean()]),

    // 4 — invalid board: canonical resource and dependent tools withheld.
    define("e04-invalid-board", "Invalid board: canonical resource and dependent tools withheld", "resource-withholding",
      capsule({ caseId: "e04-invalid-board", context: { schematic: SCHEMATIC, board: invalidBoard(), schematicHeadMark: MARK }, steps: [step()], discoveredTools: [PROPOSE], toolOutcomes: [], terminal: { outcome: "completed", failureReason: null }, pins }),
      [checks.toolsExactly([PROPOSE]), checks.toolAbsent("sirkit.pcb.board-inspect")]),

    // 5 — unavailable resource at the invocation boundary: fail closed.
    define("e05-resource-fail-closed", "Absent canonical resource: direct read refuses authority_unavailable", "refusal",
      capsule({
        caseId: "e05-resource-fail-closed",
        context: { schematic: SCHEMATIC, schematicHeadMark: MARK },
        steps: [callStep("sirkit.pcb.board-inspect"), step()],
        discoveredTools: [PROPOSE],
        toolOutcomes: [],
        terminal: { outcome: "completed", failureReason: null }, pins,
      }),
      // The tool is not exposed, so the model's call resolves to nothing:
      // the loop refuses it as an unknown tool and records no invocation.
      [checks.toolsExactly([PROPOSE]), checks.toolAbsent("sirkit.pcb.board-inspect")]),

    // 6 — selection resource absent / malformed / valid.
    define("e06a-selection-absent", "Selection resource absent: selection.inspect withheld", "resource-withholding",
      capsule({ caseId: "e06a-selection-absent", context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK }, steps: [step()], discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(), toolOutcomes: [], terminal: { outcome: "completed", failureReason: null }, pins }),
      [checks.toolAbsent(SELECTION)]),
    define("e06b-selection-malformed", "Selection resource malformed: withheld, other reads unaffected", "resource-withholding",
      capsule({ caseId: "e06b-selection-malformed", context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK, selection: { refs: [{ kind: "track", id: "" }], primary: null } }, steps: [step()], discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(), toolOutcomes: [], terminal: { outcome: "completed", failureReason: null }, pins }),
      [checks.toolAbsent(SELECTION), checks.toolsExactly([...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE])]),
    define("e06c-selection-valid", "Selection resource valid: selection.inspect available and succeeds", "tool-selection",
      capsule({
        caseId: "e06c-selection-valid",
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK, selection: { refs: [{ kind: "track", id: "t1" }], primary: null } },
        steps: [callStep(SELECTION), step()],
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE, SELECTION].sort(),
        toolOutcomes: [{ toolId: SELECTION, outcomeClass: "read", status: "succeeded" }],
        terminal: { outcome: "completed", failureReason: null }, pins,
      }),
      [checks.outcomeStatus(SELECTION, "succeeded")]),

    // 7 — theory netlist proven vs forged withheld.
    define("e07a-netlist-proven", "Theory netlist proven by server derivation: sealed", "resource-withholding",
      capsule({ caseId: "e07a-netlist-proven", context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK, netlist: validNetlist, editorSchematicDigest: digest }, steps: [callStep("sirkit.manufacturing.readiness-inspect"), step()], discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(), toolOutcomes: [{ toolId: "sirkit.manufacturing.readiness-inspect", outcomeClass: "read", status: "succeeded" }], terminal: { outcome: "completed", failureReason: null }, pins }),
      [checks.outcomeStatus("sirkit.manufacturing.readiness-inspect", "succeeded")]),
    define("e07b-netlist-forged", "Forged/omitted netlist: withheld, readiness still runs", "resource-withholding",
      capsule({ caseId: "e07b-netlist-forged", context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK, netlist: forgedNetlist, editorSchematicDigest: digest }, steps: [callStep("sirkit.manufacturing.readiness-inspect"), step()], discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(), toolOutcomes: [{ toolId: "sirkit.manufacturing.readiness-inspect", outcomeClass: "read", status: "succeeded" }], terminal: { outcome: "completed", failureReason: null }, pins }),
      [{
        id: "netlist-withheld-warning",
        evaluate: ({ trace }) => {
          const warned = trace.warnings.some((warning) => warning.includes("netlist resource was withheld"));
          return { pass: warned && trace.contextDigests.netlistDigest === null, detail: `netlistDigest=${trace.contextDigests.netlistDigest ?? "null"} warned=${warned}` };
        },
      }]),

    // 8 — KiCad netlist without server authority: withheld.
    define("e08-kicad-netlist-withheld", "KiCad netlist without server pin authority: withheld", "resource-withholding",
      capsule({ caseId: "e08-kicad-netlist-withheld", context: { schematic: KICAD_SCHEMATIC, board: boardWithTrack(), netlist: { schema: "sirkit.agent-netlist-projection.v1", components: [{ id: "u1-id", ref: "U1", pins: [{ number: "1" }] }], nets: [] }, editorSchematicDigest: schematicStateDigest(KICAD_SCHEMATIC) }, steps: [step()], discoveredTools: [...ALL_READS.filter((toolId) => toolId !== "sirkit.schematic.inspect"), ...LAYOUT_PROPOSALS, "sirkit.schematic.inspect"].sort(), toolOutcomes: [], terminal: { outcome: "completed", failureReason: null }, pins }),
      [{
        id: "kicad-pin-authority-withheld",
        evaluate: ({ trace }) => {
          const warned = trace.warnings.some((warning) => warning.includes("pin authority is unavailable"));
          return { pass: warned && trace.contextDigests.netlistDigest === null, detail: `warned=${warned}` };
        },
      }]),

    // 9 — non-exposed mutation tool: undiscoverable and uncallable.
    define("e09-mutation-not-exposed", "Non-exposed mutation tool cannot be discovered or called", "refusal",
      capsule({
        caseId: "e09-mutation-not-exposed",
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK },
        steps: [callStep("sirkit.pcb.move-footprint"), step()],
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(),
        toolOutcomes: [],
        terminal: { outcome: "completed", failureReason: null }, pins,
      }),
      [checks.toolAbsent("sirkit.pcb.move-footprint"), checks.proposalOnly(), {
        id: "unknown-tool-warning",
        evaluate: ({ trace }) => ({ pass: trace.warnings.some((warning) => warning.includes("unknown tool")), detail: "the model's mutation call was refused as an unknown tool" }),
      }]),

    // 10 — sealed proposal: proposal-only, zero mutation.
    define("e10-proposal-only", "Sealed schematic proposal produces proposal-only output", "proposal-only",
      capsule({
        caseId: "e10-proposal-only",
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK },
        steps: [callStep(PROPOSE, JSON.stringify({ ops: [{ op: "set-value", target: "r1", value: "1k" }] })), step()],
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(),
        toolOutcomes: [{ toolId: PROPOSE, outcomeClass: "proposal", status: "proposal_sealed" }],
        terminal: { outcome: "completed", failureReason: null }, pins,
      }),
      [checks.proposalOnly(), {
        id: "proposal-digest-pinned",
        evaluate: ({ trace }) => {
          const event = trace.events.find((item) => item.kind === "tool_invocation" && item.outcomeClass === "proposal");
          const pinned = event && event.kind === "tool_invocation" && typeof event.proposalId === "string" && typeof event.proposalDigest === "string";
          return { pass: Boolean(pinned), detail: pinned ? "proposal identity + digest recorded" : "missing proposal identity" };
        },
      }]),

    // 11 — terminal safety: exactly one terminal outcome under a budget stop.
    define("e11-terminal-safety", "Budget stop: exactly one terminal outcome, nothing after it", "terminal-safety",
      capsule({
        caseId: "e11-terminal-safety",
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK },
        steps: Array.from({ length: 6 }, () => callStep("sirkit.pcb.board-inspect")),
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(),
        // Cycle detection caps identical calls at maxIdenticalCalls (2);
        // later repeats are refused BEFORE invocation, so only two
        // invocations are traced before the step budget stops the run.
        toolOutcomes: Array.from({ length: 2 }, () => ({ toolId: "sirkit.pcb.board-inspect", outcomeClass: "read", status: "succeeded" })),
        terminal: { outcome: "failed", failureReason: "max_steps" }, pins,
      }),
      [checks.terminalIs("failed", "max_steps"), {
        id: "terminal-is-last-event",
        evaluate: ({ trace }) => {
          const last = trace.events[trace.events.length - 1];
          return { pass: last?.kind === "terminal", detail: `lastEvent=${last?.kind ?? "(none)"}` };
        },
      }]),

    // 12 — provider failure classification is preserved.
    define("e12-provider-quota", "Provider quota failure keeps its normalized classification", "failure-classification",
      capsule({
        caseId: "e12-provider-quota",
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK },
        steps: [step({ failure: { reason: "insufficient_quota", message: "quota exhausted" } })],
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(),
        toolOutcomes: [],
        terminal: { outcome: "failed", failureReason: "provider_insufficient_quota" }, pins,
      }),
      [checks.terminalIs("failed", "provider_insufficient_quota")],
      { failureFactory: () => new LLMProviderError("openai", "insufficient_quota", 429) }),

    // 13 — no automatic cross-provider fallback.
    define("e13-no-fallback", "Provider failure never falls back to another provider", "no-fallback",
      capsule({
        caseId: "e13-no-fallback",
        provider: "anthropic",
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK },
        steps: [step({ failure: { reason: "rate_limit", message: "slow down" } })],
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(),
        toolOutcomes: [],
        terminal: { outcome: "failed", failureReason: "provider_rate_limit" }, pins,
      }),
      [checks.singleProviderNoFallback("anthropic"), checks.terminalIs("failed", "provider_rate_limit")],
      { failureFactory: () => new LLMProviderError("anthropic", "rate_limit", 429) }),

    // 14 — cross-provider normalized parity (the anthropic twin of e03).
    define("e14-parity-anthropic", "Anthropic twin of the board-read run: normalized trace parity", "provider-parity",
      capsule({
        caseId: "e14-parity-anthropic",
        provider: "anthropic",
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK },
        steps: [callStep("sirkit.pcb.board-inspect"), callStep("sirkit.validation.drc-run"), step()],
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(),
        toolOutcomes: [
          { toolId: "sirkit.pcb.board-inspect", outcomeClass: "read", status: "succeeded" },
          { toolId: "sirkit.validation.drc-run", outcomeClass: "read", status: "succeeded" },
        ],
        terminal: { outcome: "completed", failureReason: null }, pins,
      }),
      [checks.singleProviderNoFallback("anthropic"), checks.traceIsClean()]),

    // 15 — secret-shaped values never reach the trace.
    define("e15-redaction", "Secret-shaped context warnings are redacted in the trace", "redaction",
      capsule({
        caseId: "e15-redaction",
        // [B11.1] a DEAD selection ref produces a context-derived warning
        // path; the case proves the trace stays bounded, redacted, and free
        // of provider diagnostics. A secret-shaped fixture can no longer
        // appear here at all — validateReplayCapsule refuses such capsules
        // before execution (proven in the B11.1 suite).
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK, selection: { refs: [{ kind: "track", id: "t-does-not-exist" }], primary: null } },
        steps: [step()],
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE, SELECTION].sort(),
        toolOutcomes: [],
        terminal: { outcome: "completed", failureReason: null }, pins,
      }),
      [checks.traceIsClean()]),

    // 16 — recorder rejection cannot alter authorization or the terminal.
    define("e16-recorder-safety", "Trace-sink failure cannot alter authorization or the terminal result", "recorder-safety",
      capsule({
        caseId: "e16-recorder-safety",
        context: { schematic: SCHEMATIC, board: boardWithTrack(), schematicHeadMark: MARK },
        steps: [callStep("sirkit.pcb.board-inspect"), step()],
        discoveredTools: [...ALL_READS, ...LAYOUT_PROPOSALS, PROPOSE].sort(),
        toolOutcomes: [{ toolId: "sirkit.pcb.board-inspect", outcomeClass: "read", status: "succeeded" }],
        terminal: { outcome: "completed", failureReason: null }, pins,
      }),
      [checks.recorderDiagnostics(["trace_sink_failure"]), checks.terminalIs("completed", null), checks.outcomeStatus("sirkit.pcb.board-inspect", "succeeded")],
      { sink: new ThrowingTraceSink() }),
  ];
}
