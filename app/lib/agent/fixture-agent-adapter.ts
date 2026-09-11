/**
 * [B18-C I10] A SCRIPTED agent adapter for the browser harness — never a
 * model. Reachable ONLY through `agentAdapterFor` when the fixture runtime is
 * enabled (non-production, local_dev identity) AND `SIRKIT_FIXTURE_AGENT=
 * scripted` opts in; a source-scan tripwire pins that nothing else constructs
 * it. It turns a small, fixed set of whole user instructions into the tool
 * calls a model would make — through the REAL loop, gateway, seal, minter,
 * grant store and browser ritual — so the end-to-end proofs exercise every
 * authority check with no provider:
 *
 *  - "Move <REF> <n> mm to the right|left|up|down." → selection.inspect (the
 *    user selected <REF> in the editor), then move-footprint to the absolute
 *    target;
 *  - "Flip <REF> to the bottom|top." → selection.inspect, then
 *    rotate-side-footprint { side } (the seal fills the rotation by the
 *    editor's own Flip rule);
 *  - "Add silkscreen text <TEXT> at <x>, <y>." → silkscreen-text add (mm);
 *  - "Undo that." / "Redo." → undo-redo-granted { direction };
 *  - anything else → a plain reply that names the scripted instructions.
 *
 * It reads ONLY what a model would: the user's message, the advertised tools
 * and the tool results.
 */
import type { AgentStep, ProviderAgentAdapter, ProviderToolDeclaration } from "./contracts";
import type { LLMProviderId } from "../llm/types";

export const FIXTURE_AGENT_ENV = "SIRKIT_FIXTURE_AGENT";
export const FIXTURE_AGENT_SCRIPTED = "scripted";
export const FIXTURE_AGENT_MODEL = "sirkit-fixture-agent";
const NM_PER_MM = 1_000_000;

interface SelectedFootprint { id: string; ref: string; x: number; y: number }
type Planned =
  | { kind: "reply"; text: string }
  | { kind: "select-then"; ref: string; build: (item: SelectedFootprint) => { toolId: string; args: Record<string, unknown> } }
  | { kind: "call"; toolId: string; args: Record<string, unknown> };

const MOVE = /^(?:please\s+)?move\s+([a-z]+\d+)\s+(\d+(?:\.\d+)?)\s*mm\s+(?:to\s+the\s+)?(right|left|up|down)$/i;
const FLIP = /^(?:please\s+)?flip\s+([a-z]+\d+)\s+(?:on)?to\s+the\s+(top|bottom)(?:\s+side)?$/i;
const SILK = /^(?:please\s+)?add\s+silkscreen\s+text\s+(.{1,64}?)\s+at\s+(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*mm)?$/i;
const REPLAY = /^(?:please\s+)?(undo|redo)(?:\s+that)?$/i;
const VECTORS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({ right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] });
/** [B18-D I6] A model may write text beside an execution call that claims the change is made; the scripted agent does, so
 *  the browser proof can show it never reaches the answer (it is released as a note once the run ends). */
export const FIXTURE_INTERIM_TEXT = "(fixture interim) Done — the change is already made.";
const EXECUTION_TOOL_IDS: ReadonlySet<string> = new Set(["sirkit.pcb.move-footprint", "sirkit.pcb.rotate-side-footprint", "sirkit.pcb.silkscreen-text", "sirkit.pcb.undo-redo-granted"]);

/** The scripted plan for one whole instruction (exported for the harness's unit proofs). */
export function planFixtureInstruction(message: string): Planned {
  const text = message.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").trim();
  const move = MOVE.exec(text);
  if (move) {
    const delta = Math.round(Number(move[2]) * NM_PER_MM);
    const [dx, dy] = VECTORS[move[3]!.toLowerCase()]!;
    return { kind: "select-then", ref: move[1]!.toUpperCase(), build: (item) => ({ toolId: "sirkit.pcb.move-footprint", args: { moves: [{ footprintId: item.id, x: item.x + dx * delta, y: item.y + dy * delta }] } }) };
  }
  const flip = FLIP.exec(text);
  if (flip) {
    const side = flip[2]!.toLowerCase();
    return { kind: "select-then", ref: flip[1]!.toUpperCase(), build: (item) => ({ toolId: "sirkit.pcb.rotate-side-footprint", args: { targets: [{ footprintId: item.id, rotationDeg: null, side }] } }) };
  }
  const silk = SILK.exec(text);
  if (silk) {
    const at = { x: Math.round(Number(silk[2]) * NM_PER_MM), y: Math.round(Number(silk[3]) * NM_PER_MM) };
    return { kind: "call", toolId: "sirkit.pcb.silkscreen-text", args: { edits: [{ op: "add", silkId: null, text: silk[1], layer: "silkTop", atNm: at, heightNm: null, strokeWidthNm: null }] } };
  }
  const replay = REPLAY.exec(text);
  if (replay) return { kind: "call", toolId: "sirkit.pcb.undo-redo-granted", args: { direction: replay[1]!.toLowerCase() } };
  return { kind: "reply", text: "(fixture agent) I follow only the harness's scripted instructions: move or flip a selected part, add silkscreen text, undo, redo." };
}

function selectedFootprints(outputText: string | undefined): SelectedFootprint[] {
  try {
    const parsed = JSON.parse(outputText ?? "") as { output?: { items?: unknown } };
    const items = Array.isArray(parsed.output?.items) ? parsed.output.items : [];
    return items.flatMap((raw) => {
      const item = raw as Record<string, unknown>;
      return item.kind === "footprint" && typeof item.id === "string" && typeof item.ref === "string" && Number.isSafeInteger(item.x) && Number.isSafeInteger(item.y)
        ? [{ id: item.id, ref: item.ref, x: item.x as number, y: item.y as number }]
        : [];
    });
  } catch {
    return [];
  }
}

function statusOf(outputText: string | undefined): string {
  try {
    const parsed = JSON.parse(outputText ?? "") as { status?: unknown };
    return typeof parsed.status === "string" ? parsed.status : "an unparsed result";
  } catch {
    return "an unparsed result";
  }
}

export class FixtureAgentAdapter implements ProviderAgentAdapter {
  private planned: Planned = { kind: "reply", text: "" };
  private awaitingSelection = false;
  private seq = 0;

  constructor(readonly provider: LLMProviderId) {}

  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 0, outputTokens: 0 }, model: FIXTURE_AGENT_MODEL, continuation: { provider: this.provider, state: null }, ...partial };
  }

  private call(tools: readonly ProviderToolDeclaration[], toolId: string, args: Record<string, unknown>): AgentStep {
    const declaration = tools.find((tool) => tool.toolId === toolId);
    if (!declaration) return this.step({ text: `(fixture agent) ${toolId} is not available to this run; nothing was done.` });
    this.seq += 1;
    return this.step({ text: EXECUTION_TOOL_IDS.has(toolId) ? FIXTURE_INTERIM_TEXT : "", toolCalls: [{ callId: `fx-${this.seq}`, providerName: declaration.providerName, argumentsText: JSON.stringify(args) }] });
  }

  async start(input: Parameters<ProviderAgentAdapter["start"]>[0]): Promise<AgentStep> {
    this.planned = planFixtureInstruction(input.userMessage);
    if (this.planned.kind === "reply") return this.step({ text: this.planned.text });
    if (this.planned.kind === "select-then") {
      this.awaitingSelection = true;
      return this.call(input.tools, "sirkit.selection.inspect", {});
    }
    return this.call(input.tools, this.planned.toolId, this.planned.args);
  }

  async continueWith(input: Parameters<ProviderAgentAdapter["continueWith"]>[0]): Promise<AgentStep> {
    const planned = this.planned;
    const outputText = input.results[0]?.outputText;
    if (this.awaitingSelection && planned.kind === "select-then") {
      this.awaitingSelection = false;
      const item = selectedFootprints(outputText).find((candidate) => candidate.ref.toUpperCase() === planned.ref);
      if (!item) return this.step({ text: `(fixture agent) ${planned.ref} is not selected in the editor; select it and ask again. Nothing was done.` });
      const next = planned.build(item);
      return this.call(input.tools, next.toolId, next.args);
    }
    return this.step({ text: `(fixture agent) the tool answered ${statusOf(outputText)}.` });
  }
}
