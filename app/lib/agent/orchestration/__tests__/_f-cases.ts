/**
 * [B21 F] The twelve runbook evaluations of B21-F (runbook :861-874) AS DATA (not a test file; no vitest import): one row per runbook
 * line, its sentence, its classes (deterministic offline / browser / model-in-loop record-only), the suite case that proves it, what that
 * case asserts, its evidence and the replay pins that cover it. `scripts/generate-b21-artifacts.ts` renders the rows into
 * `artifacts/ai-control-plane-b21/evaluation-matrix.{csv,json}` and `b21-f-evaluation.test.ts` case 14 byte-gates both files against
 * the SAME rendering, so the matrix can never drift from the suite.
 */
import { canonicalJson } from "@/app/lib/engineering/stable";

/** The sentences the evaluations send (each routes as its case states; the D3 scenario-17 sentences are D3's own, re-used verbatim). */
export const B21_F_SENTENCES = Object.freeze({
  deleteReplace: "Delete U1 and replace it with the approved lower-power part while preserving compatible nets.",
  vias: "Change every via on the 5 V net to 0.7 mm diameter and 0.35 mm drill.",
  dimensions: "Add horizontal and vertical dimensions for the board and mounting holes.",
  view3d: "Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometric view.",
  compactScenario5: "Place the board compactly, keep decoupling close to U1, route it, and show me anything that failed.",
  compact: "Compact the placement and reroute the affected traces.",
  timer: "Replace the NE555 timer U1 with a lower-power timer.",
  timerBothSeal: "Swap the NE555 (U1) for a lower-power CMOS timer.",
  missing: "Replace U1, the NE555, with a low-power CMOS timer.",
  stale: "Can you swap U1 for a CMOS timer?",
  timeout: "Design a 555 timer LED blinker.",
  quota: "Build me a 5V buck converter board.",
  malicious: "Create a complete circuit for a USB-powered temperature logger.",
  rejectResume: "Replace U1 with a low-power timer for the blinker.", /** [B21 F2b] F12 in the browser (D21-45): its scripted follow-up turn fails while it presents */ rejectResumeBrowser: "Replace U1 with a lower-power timer for the LED circuit.",
});

export const B21_F_SUITE = "app/lib/agent/orchestration/__tests__/b21-f-evaluation.test.ts";
export const B21_F_CAPSULE_SUITE = "app/lib/agent/orchestration/__tests__/b21-f-replay-capsule.test.ts";
/** [B21 F2] The browser class of the rows the task marks (B21-F: BLOCKED; D21-43 decided) - F4's: the flag-on spec on its own Playwright config (evaluation-matrix.md section 4). */ export const BROWSER_PROVEN = "PROVEN: e2e-orchestration/specialist-orchestration.spec.ts on playwright.orchestration.config.ts, the orchestration flag on, run after the existing suite (evaluation-matrix.md section 4)";
/** [B21 F2 fix: security-1, coverage-1, tests-01] F6's: two providers in the browser, but the review is cancelled and the envelope never reaches the page. */ export const BROWSER_PROVEN_IN_PART_F6 = "PROVEN IN PART: e2e-orchestration/specialist-orchestration.spec.ts test 2 on playwright.orchestration.config.ts (the circuit specialist routed to anthropic, every other role on the page's openai) - the scenario-17 sentence from the composer, the E2 status line, each role's provider; a verifier decides and the one sealed replacement is presented once (the review cancelled); both parties seal and disagree: ONE escalation over 2 source(s), nothing presented; the principal's approval and the escalation's exact authority (the follow-up's envelope, which the page never receives) stay offline, case 6 (evaluation-matrix.md section 4)"; /** [B21 F2] F12's: the scripted agent's follow-up turn never fails in the browser, so a run that presented cannot stand down there ([B21 F2 fix: coverage-2] D21-45). */ export const BROWSER_PROVEN_IN_PART_F12 = "PROVEN IN PART: e2e-orchestration/specialist-orchestration.spec.ts test 3 - E3's resume on the chat surface after the human's Stop during F9's scripted stall (the offer, the same message, the resuming line, the first answer replayed, the stalled specialist started again until its own deadline, one follow-up, nothing presented); the rejected presentation and already_presented stay offline, case 12 - tracked as D21-45 (evaluation-matrix.md section 4)"; /** [B21 F2b] F12's since B21-F2b (D21-45 closed; the in-part class above is F2's, kept for its record): test 4 presents, rejects, stands down and resumes in the browser. */ export const BROWSER_PROVEN_F12 = "PROVEN: e2e-orchestration/specialist-orchestration.spec.ts tests 3 and 4 on playwright.orchestration.config.ts - test 4 (B21-F2b, D21-45 closed): the schematic specialist's replacement presented once and rejected through its review's own Cancel, the run stood down (its scripted follow-up turn failed, provider_overloaded) and the page offered the resume; the same message resumed under the same run id - the first answer and the four committed specialists replayed, nothing presented again (already_presented), one follow-up answer; test 3: E3's resume after the human's Stop during F9's scripted stall; the record's one claim and a second resume's resume_completed are the server's, case 12 (evaluation-matrix.md section 4)";
/** [B21 F fix: coverage-1] What the record-only live command (`scripts/run-b21-live-orchestration-evaluation.ts`) CAN run for a row -
 *  `b21-f-replay-capsule.test.ts` case 9 derives each row's class from the command's own case list and the capsules' scripted faults. */
export const MODEL_IN_LOOP_LIVE_DAG = "RECORDED (OD-125): the record-only command runs this case's DAG live - never run; BLOCKED-LIVE-QUALIFICATION (LB-9)";
export const MODEL_IN_LOOP_SHAPE_ONLY = "RECORDED (OD-125): the record-only command runs the DAG's shape live, NOT its scripted fault (a live model answers every turn) - never run; BLOCKED-LIVE-QUALIFICATION (LB-9)";
export const MODEL_IN_LOOP_NO_PATH = "NO LIVE PATH: the record-only command runs no capsule for this case (proven offline only); BLOCKED-LIVE-QUALIFICATION (LB-9)";

export interface B21FCase {
  readonly id: string;
  readonly runbookLine: number;
  readonly item: string;
  readonly sentence: string;
  readonly route: string;
  readonly offline: string;
  readonly browser: string;
  readonly modelInLoop: string;
  /** the `it(` title head in B21_F_SUITE: "<n>. <runbook item>" (followed there by " (:<line>)") */
  readonly suiteCase: string;
  readonly assertions: string;
  readonly evidence: string;
  /** the replay capsules (replay-trace-pins-b21.json) that cover the case, or none */
  readonly pins: readonly string[];
}
const row = (entry: Omit<B21FCase, "offline" | "browser" | "modelInLoop"> & { browser?: string; modelInLoop?: string }): B21FCase => Object.freeze({ ...entry, offline: "PROVEN", browser: entry.browser ?? "not required", modelInLoop: entry.modelInLoop ?? MODEL_IN_LOOP_NO_PATH });

export const B21_F_CASES: readonly B21FCase[] = Object.freeze([
  row({ id: "F1", runbookLine: 863, item: "delete/replace component", sentence: B21_F_SENTENCES.deleteReplace, route: "dag D-component-replacement", suiteCase: "1. delete/replace component", assertions: "the coordinator's own first turn seals the server-chosen replacement (one proposal_ready); OD-122 keeps the four specialists read-only - none is offered a proposal (coordinator_artifact_held); envelope approval coordinator_sealed; four accepted results; the coordinator trace holds the read and the seal", evidence: `${B21_F_SUITE} case 1`, pins: [] }),
  row({ id: "F2", runbookLine: 864, item: "via changes", sentence: B21_F_SENTENCES.vias, route: "single S-default", suiteCase: "2. via changes", assertions: "one coordinator turn, no plan or specialist event, nothing in the orchestration record; the via read happens before any answer; the capsule replay checks the router's single answer, then one loop", evidence: `${B21_F_SUITE} case 2; ${B21_F_CAPSULE_SUITE}`, pins: ["f02-vias-single"] }),
  row({ id: "F3", runbookLine: 865, item: "dimensions", sentence: B21_F_SENTENCES.dimensions, route: "single S-default", suiteCase: "3. dimensions", assertions: "one coordinator turn, no plan or specialist event, nothing in the record; the bounded mechanical read happens before any plan; the capsule replay checks the router's single answer, then one loop", evidence: `${B21_F_SUITE} case 3; ${B21_F_CAPSULE_SUITE}`, pins: ["f03-dimensions-single"] }),
  row({ id: "F4", runbookLine: 866, item: "3D control request routed directly without a swarm", sentence: B21_F_SENTENCES.view3d, route: "single S-default", browser: BROWSER_PROVEN, suiteCase: "4. 3D control request routed directly without a swarm", assertions: "the router answers single before any model call; exactly one provider call and zero specialists; stream run_started, text_delta, run_completed; no orchestration event; nothing in the record; one trace document with one step; the capsule replay checks the router's single answer, then one loop", evidence: `${B21_F_SUITE} case 4; ${B21_F_CAPSULE_SUITE}`, pins: ["f04-view3d-single"] }),
  row({ id: "F5", runbookLine: 867, item: "compact placement/routing", sentence: B21_F_SENTENCES.compact, route: "dag D-bounded-pcb-proposal (the runbook's scenario-5 sentence stays single)", suiteCase: "5. compact placement/routing", assertions: "the scenario-5 sentence routes single; the DAG phrasing runs the coordinator, the PCB specialist and the follow-up; the specialist reads the board and is accepted; its per-task trace document holds the read", evidence: `${B21_F_SUITE} case 5; ${B21_F_CAPSULE_SUITE}`, pins: ["f05-compact-dag"], modelInLoop: MODEL_IN_LOOP_LIVE_DAG }),
  row({ id: "F6", runbookLine: 868, item: "lower-power timer replacement with provider disagreement", sentence: `${B21_F_SENTENCES.timer} / ${B21_F_SENTENCES.timerBothSeal}`, route: "dag D-component-replacement", browser: BROWSER_PROVEN_IN_PART_F6, suiteCase: "6. lower-power timer replacement with provider disagreement", assertions: "circuit-topology on anthropic, schematic on openai (server-env routing); a verifier decides: the Tier 1 compiler refuses the delete, the exact replacement seals, is presented once and approved by the run's principal through the existing path; both seal: both contradicted, one escalation citing the exact authority, nothing presented; no live path can produce this disagreement (the record-only command runs one provider for every turn)", evidence: `${B21_F_SUITE} case 6`, pins: [] }),
  row({ id: "F7", runbookLine: 869, item: "missing component evidence", sentence: B21_F_SENTENCES.missing, route: "dag D-component-replacement", suiteCase: "7. missing component evidence", assertions: "the sourcing specialist returns no evidence and a blocking question; no evidence reference appears anywhere in the record or the follow-up's envelope (the merge invents none); [B21 F3] the merge records the gap - the result stays accepted, its decision record names evidence-missing and the envelope marks that entry no evidence cited (D21-44); with no authority binding the sourcing specialist is not run (role_has_no_tools) and its task records the gap as dissent escalated", evidence: `${B21_F_SUITE} case 7`, pins: [] }),
  row({ id: "F8", runbookLine: 870, item: "stale revision during parallel specialists", sentence: B21_F_SENTENCES.stale, route: "dag D-component-replacement", suiteCase: "8. stale revision during parallel specialists", assertions: "results committed against H1; the resume at H2 marks each stale (dissent with the committed digest) and re-runs it once under its next attempt; the H1 records stay unchanged; a resume at an unmoved head replays", evidence: `${B21_F_SUITE} case 8`, pins: [] }),
  row({ id: "F9", runbookLine: 871, item: "one specialist timeout", sentence: B21_F_SENTENCES.timeout, route: "dag D-full-circuit-creation", suiteCase: "9. one specialist timeout", assertions: "the stalled specialist's own deadline ends it: escalated deadline for that task only; every later specialist runs; the follow-up answers over the partial set; one terminal", evidence: `${B21_F_SUITE} case 9; ${B21_F_CAPSULE_SUITE}`, pins: ["f09-timeout-dag"], modelInLoop: MODEL_IN_LOOP_SHAPE_ONLY }),
  row({ id: "F10", runbookLine: 872, item: "provider quota failure", sentence: B21_F_SENTENCES.quota, route: "dag D-full-circuit-creation", suiteCase: "10. provider quota failure", assertions: "a specialist's (metered) 429 insufficient_quota opens the breaker at once; no further paid call; degraded provider_outage; no Retry offered; the next request makes no call (run_failed provider_breaker_open); D21-42's limit: a 429 on the coordinator's first turn (gated, not metered) fails the request provider_insufficient_quota and leaves the breaker closed, so the next request makes its one paid call again", evidence: `${B21_F_SUITE} cases 10 and 16; ${B21_F_CAPSULE_SUITE}`, pins: ["f10-quota-dag"], modelInLoop: MODEL_IN_LOOP_SHAPE_ONLY }),
  row({ id: "F11", runbookLine: 873, item: "malicious specialist result", sentence: B21_F_SENTENCES.malicious, route: "dag D-full-circuit-creation", suiteCase: "11. malicious specialist result", assertions: "a release tool, an approval claim and a secret are refused by A's gate before content (tool_request_not_permitted, unknown_key, secret_shaped_text); a directive in prose stays an unverified claim inside the data envelope of a turn OFFERED reads only; nothing sealed, presented or applied", evidence: `${B21_F_SUITE} case 11; ${B21_F_CAPSULE_SUITE}`, pins: ["f11-malicious-dag"], modelInLoop: MODEL_IN_LOOP_SHAPE_ONLY }),
  row({ id: "F12", runbookLine: 874, item: "human rejection and resume", sentence: B21_F_SENTENCES.rejectResume, route: "dag D-component-replacement", browser: BROWSER_PROVEN_F12, suiteCase: "12. human rejection and resume", assertions: "the first request presents the replacement and stands down; the human rejects it (nothing applied); the resume replays the first turn and every committed specialist, presents nothing again (already_presented) and runs the follow-up once; a second resume is resume_completed", evidence: `${B21_F_SUITE} case 12`, pins: [] }),
]);

export const EVALUATION_MATRIX_SCHEMA = "sirkit.b21-evaluation-matrix.v1" as const;
const MATRIX_HEADER = ["id", "runbook_line", "item", "sentence", "route", "offline", "browser", "model_in_loop", "suite_case", "assertions", "evidence", "pins"] as const;
const csvCell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
/** The CSV rendering (one header row and one row per case; LF line ends; a final newline). */
export function evaluationMatrixCsv(): string {
  const rows = B21_F_CASES.map((entry) => [entry.id, String(entry.runbookLine), entry.item, entry.sentence, entry.route, entry.offline, entry.browser, entry.modelInLoop, entry.suiteCase, entry.assertions, entry.evidence, entry.pins.join(";") || "(none)"].map(csvCell).join(","));
  return [MATRIX_HEADER.join(","), ...rows].join("\n") + "\n";
}
/** The JSON rendering (canonical JSON; a final newline). */
export function evaluationMatrixJson(): string {
  return canonicalJson({ schema: EVALUATION_MATRIX_SCHEMA, runbook: "Sirkit_Remaining_Builder_Master_Runbook.md :859-874", cases: B21_F_CASES }) + "\n";
}
