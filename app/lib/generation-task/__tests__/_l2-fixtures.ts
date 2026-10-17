/**
 * [PR-L, 2026-10-17] Shared inputs of the increment-2 suites (l2-task-contracts, l2-task-store, l2-generation-task-pglite): a
 * controllable task clock, trusted scopes, a valid start request, a provider-neutral build-loop conversation, a plan and a merged
 * result. Pure data and builders: no repository, no provider, no network. Not a suite (no `.test.` in the name).
 */
import { durableWorkflowDigest } from "../../durable-workflow/stable";
import type { LLMMessage } from "../../llm/types";
import { buildLoopCheckpoint, type BuildLoopCheckpoint, type GenerationPartFacts } from "../checkpoint";
import { buildGenerationTaskResult, type GenerationTaskResultPayload } from "../contracts";
import type { GenerationSliceLease, GenerationSliceRevalidator, GenerationTaskStartInput } from "../store";

export const SCOPE = { tenantId: "tenant-l2", projectId: "project-l2", branchId: "main" } as const;
export const OTHER_TENANT = { tenantId: "tenant-l2-other", projectId: "project-l2", branchId: "main" } as const;
export const OTHER_PROJECT = { tenantId: "tenant-l2", projectId: "project-l2-other", branchId: "main" } as const;
export const T0 = Date.parse("2026-10-17T12:00:00.000Z");
export const SCHEMATIC_DIGEST = "eng1-0123456789abcdef0123456789abcdef";
export const MOVED_DIGEST = "eng1-fedcba9876543210fedcba9876543210";
export const HEAD_MARK = { lineageId: "lin1-0123456789abcdef", headSequence: 7, canonicalStateDigest: "eng1-00112233445566778899aabbccddeeff" };

/** A manual clock: `advance(ms)` moves the task clock the store reads for leases and timestamps. */
export function manualClock(start = T0): { now: () => number; advance: (ms: number) => number; set: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms), set: (ms) => { current = ms; } };
}

let requestCounter = 0;
/** A distinct, valid client request uuid per call (v4 shape). */
export function clientRequestId(seed?: number): string {
  const n = seed ?? (requestCounter += 1);
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

export function startInput(overrides: Partial<GenerationTaskStartInput> & { prompt?: string; requestId?: string } = {}): GenerationTaskStartInput {
  const { prompt, requestId, ...rest } = overrides;
  return {
    scope: { ...SCOPE },
    principal: { principalId: "user-l2-editor", role: "pcb_editor", membershipRevision: "mbr1-0123456789abcdef" },
    origin: "build",
    chatRunId: null,
    request: { clientRequestId: requestId ?? clientRequestId(), prompt: prompt ?? "build me a simple drone controlling circuit with 4 motors just a simple one", provider: "openai" },
    base: { schematicDigest: SCHEMATIC_DIGEST, recipe: "build-pin", headMark: null },
    identities: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small", promptDigests: { plan: durableWorkflowDigest("plan-prompt"), build: durableWorkflowDigest("build-prompt"), subsystem: durableWorkflowDigest("subsystem-prompt") } },
    providerServable: true,
    ...rest,
  };
}

export const ALLOW: GenerationSliceRevalidator = async () => ({ ok: true });

export const PLAN = {
  planner: { state: "planned" as const, blocks: 3 },
  rationale: "A flight controller, a power stage and four brushed motor channels.",
  assumptions: ["Brushed DC motors driven by logic-level N-MOSFETs", "A single 1S LiPo supply"],
  blocks: [
    { name: "Flight controller", brief: "MCU with an IMU and four PWM outputs", sharedNets: ["+3V3", "GND", "PWM1", "PWM2", "PWM3", "PWM4"] },
    { name: "Power", brief: "1S LiPo input and a 3.3 V regulator", sharedNets: ["VBAT", "+3V3", "GND"] },
    { name: "Motor drivers", brief: "Four N-MOSFET low-side channels with flyback diodes", sharedNets: ["VBAT", "GND", "PWM1", "PWM2", "PWM3", "PWM4"] },
  ],
};

export function part(partId: string, name = `Part ${partId}`): GenerationPartFacts {
  return { partId, name, mpn: `MPN-${partId}`, description: `Catalog part ${partId}`, mainCategory: "Transistors", pins: [{ number: "1", name: "G", type: "input" }, { number: "2", name: "D", type: "passive" }, { number: "3", name: "S", type: "passive" }], lifecycleStatus: "active", similarity: 0.83 };
}

/** One complete loop turn: a search call and its answer. */
export function searchTurn(index: number, partIds: readonly string[]): LLMMessage[] {
  const id = `call_${index}`;
  return [
    { role: "assistant", content: [{ type: "text", text: `Searching for candidates, step ${index}.` }, { type: "tool_call", id, name: "search_parts", input: { query: `logic level n-mosfet ${index}`, category: "Transistors" } }] },
    { role: "user", content: [{ type: "tool_result", toolCallId: id, output: JSON.stringify(partIds.map((partId) => ({ partId, name: `Part ${partId}`, mainCategory: "Transistors" }))) }] },
  ];
}
export function conversation(turns: number, prompt = "Design block b1: the flight controller."): LLMMessage[] {
  const messages: LLMMessage[] = [{ role: "user", content: prompt }];
  for (let index = 1; index <= turns; index += 1) messages.push(...searchTurn(index, [`p-${index}a`, `p-${index}b`]));
  return messages;
}

export const NETLIST = {
  components: [{ refDes: "Q1", partId: "p-1a", value: "AO3400", role: "output" as const }, { refDes: "D1", partId: "p-1b", value: "SS14", role: "support" as const, parentRefDes: "Q1" }],
  connections: [{ from: "Q1.D", to: "D1.A" }, { kind: "label" as const, pin: "Q1.S", labelName: "GND" }],
  explanation: "One low-side motor channel.",
};

export function checkpointFor(lease: GenerationSliceLease, options: { turns?: number; saved?: boolean; at?: string } = {}): BuildLoopCheckpoint {
  const turns = options.turns ?? 2;
  return buildLoopCheckpoint({
    taskId: lease.taskId, blockId: lease.blockId!, sliceId: lease.sliceId, attempt: lease.attempt, fence: lease.fence, at: options.at ?? new Date(T0).toISOString(), strategy: "S1-baseline",
    messages: conversation(turns), surfaced: [part("p-1a"), part("p-1b")], ercRejections: 0, turnsUsed: turns, nudges: 0,
    searches: { [durableWorkflowDigest("search-1")]: { resultDigest: durableWorkflowDigest("result-1"), partIds: ["p-1a", "p-1b"], count: 2 } },
    result: options.saved ? { netlist: NETLIST, explanation: "Saved block.", erc: { state: "passed", criticalCount: 0, warningCount: 0 } } : null,
  });
}

export function resultFor(taskId: string, blocks: Array<{ blockId: "b1" | "b2" | "b3" | "main"; recordId: string; recordDigest: string }>, at: string, omitted: string[] = []): GenerationTaskResultPayload {
  return buildGenerationTaskResult({
    taskId, at, status: omitted.length ? "partial" : "complete", omittedBlocks: omitted, netlist: NETLIST, explanation: "Merged drone controller.",
    electricalCheck: { state: "findings", criticalCount: 0, warningCount: 1, findings: ["U1.VDD: decoupling capacitor recommended"] }, planner: PLAN.planner,
    sharedNets: { checked: 7, findings: [] }, blocks,
  });
}
