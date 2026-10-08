/**
 * [B24-B3] The two-provider capsule of the record-only model-in-loop command (D24-18 offline; OD-125, OD-216). Not a test file and no
 * vitest import: `b24-b3-model-in-loop` replays it offline, and `scripts/run-b21-live-orchestration-evaluation.ts` reaches it only
 * through `liveTwoProviderCases()` when `SIRKIT_LIVE_ORCHESTRATION_PROVIDER` is exactly `both`.
 *
 * The DAG is B21's full-circuit-creation one (f09/f10/f11's sentence and plan: circuit topology, schematic, verification critic), with
 * one role on each provider: the coordinator and two specialists on OpenAI, the schematic specialist routed to Anthropic the way
 * `_f-capsules.ts` routes a task whose provider differs from the capsule's (the role-models setting, `model: "inherit"`). Scenario 17's
 * component-replacement DAG was not used: its component authority cannot reach the replay without editing `replay-context.ts`, one of
 * the nine B11-scanned files (`tripwires.ts:13`; OD-113). Offline every turn is scripted; a live run answers every turn from a model on
 * the provider its role is routed to, so it can show two providers answering one DAG - and it cannot force a disagreement or a fallback
 * (a live model answers every turn, OD-125): LB-9 stays BLOCKED-LIVE-QUALIFICATION.
 *
 * It is never one of B21's `orchestration` cases: `buildOrchestrationEvaluationCases()` keeps its seven cases and four task graphs
 * (`b21-f-replay-capsule` case 1), and B21's replay pins do not move.
 */
import { buildOrchestrationEvaluationCases, type OrchestrationEvaluationCase, type OrchestrationReplay } from "@/app/lib/agent/orchestration/__tests__/_f-capsules";
import type { CapsuleStep, CapsuleTask } from "@/app/lib/agent/replay-capsule";

export const TWO_PROVIDER_CASE_ID = "b24-b3-two-provider-dag" as const;
/** The router's rule for the capsule's sentence (B21-F's f09/f10/f11 DAG). */
export const TWO_PROVIDER_DAG_RULE = "D-full-circuit-creation" as const;
/** Which provider answers which role. */
export const TWO_PROVIDER_ROUTES = Object.freeze({ coordinator: "openai", "circuit-topology": "openai", schematic: "anthropic", "verification-critic": "openai" } as const);

/** A scripted result step for `role`, the base step's shape with its role and summary replaced. */
function resultStep(base: CapsuleStep, role: string, summary: string): CapsuleStep {
  const call = base.toolCalls[0]!;
  const args = { ...(JSON.parse(call.argumentsText) as Record<string, unknown>), role, summary };
  return { ...base, toolCalls: [{ ...call, callId: `call-result-${role}`, argumentsText: JSON.stringify(args) }] };
}
const check = (id: string, evaluate: (replay: OrchestrationReplay) => { pass: boolean; detail: string }) => ({ id, evaluate });

/** The case: f09's sentence, context and coordinator turns; three benign specialist results; the schematic role on Anthropic. */
export function twoProviderCase(): OrchestrationEvaluationCase {
  const base = buildOrchestrationEvaluationCases().find((entry) => entry.caseId === "f09-timeout-dag")!;
  const capsule = structuredClone(base.capsule);
  const template = capsule.tasks!.find((task) => task.role === "schematic")!.steps[0]!;
  const tasks: CapsuleTask[] = [
    { index: 1, role: "circuit-topology", provider: TWO_PROVIDER_ROUTES["circuit-topology"], steps: [resultStep(template, "circuit-topology", "(scripted) a 555 astable drives the LED through a resistor.")] },
    { index: 3, role: "schematic", provider: TWO_PROVIDER_ROUTES.schematic, steps: [resultStep(template, "schematic", "(scripted) the schematic holds U1.")] },
    { index: 4, role: "verification-critic", provider: TWO_PROVIDER_ROUTES["verification-critic"], steps: [resultStep(template, "verification-critic", "(scripted) nothing to verify yet.")] },
  ];
  const finished = ["circuit-topology:accepted", "schematic:accepted", "verification-critic:accepted"];
  const traced = ["1-circuit-topology@openai:completed", "3-schematic@anthropic:completed", "4-verification-critic@openai:completed"];
  return {
    ...base,
    caseId: TWO_PROVIDER_CASE_ID,
    title: "Two providers answer one full-circuit-creation DAG: the schematic specialist on Anthropic, the rest on OpenAI",
    capsule: { ...capsule, caseId: TWO_PROVIDER_CASE_ID, provider: TWO_PROVIDER_ROUTES.coordinator, tasks },
    scriptedFault: null,
    checks: [
      check("one-terminal", (replay) => { const terminals = replay.events.filter((event) => event.type === "run_completed" || event.type === "run_failed"); return { pass: terminals.length === 1 && replay.events.at(-1) === terminals[0], detail: `terminals=${terminals.length}` }; }),
      check(`route:dag:${TWO_PROVIDER_DAG_RULE}`, (replay) => ({ pass: replay.route.kind === "dag" && replay.route.rule === TWO_PROVIDER_DAG_RULE, detail: `${replay.route.kind}:${String(replay.route.rule)}` })),
      check(`finished:${finished.join(",")}`, (replay) => { const actual = replay.events.flatMap((event) => (event.type === "specialist_finished" ? [`${event.role}:${event.status}`] : [])); return { pass: actual.join(",") === finished.join(","), detail: actual.join(",") }; }),
      check(`task-traces:${traced.join(",")}`, (replay) => { const actual = replay.taskTraces.map((entry) => `${entry.runId.slice(entry.runId.indexOf(":") + 1)}@${entry.provider}:${entry.terminal}`); return { pass: actual.join(",") === traced.join(","), detail: actual.join(",") }; }),
      check("terminal:run_completed", (replay) => ({ pass: replay.events.at(-1)?.type === "run_completed", detail: String(replay.events.at(-1)?.type) })),
    ],
  };
}
