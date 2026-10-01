/**
 * [B21 F2b] The scripted follow-up failure the browser's F12 test needs (D21-45, the lead's option (a)), OFFLINE. The scripted fixture
 * agent's coordinator follow-up turn fails with ONE scripted provider failure - overloaded, HTTP 529, the answer b21-f-evaluation case
 * 12's fake SDK client gives that turn - for ONE sentence (`B21_F_SENTENCES.rejectResumeBrowser`) and only while the merged envelope
 * says that request PRESENTED the run's artifact; every other script's answer is unchanged. Case 1 walks the script table and every
 * approval outcome through the scripted agent itself; case 2 sends the sentence through the PRODUCTION chat POST with the orchestration
 * flag on (the real adapters over the fake SDK clients, which fault NOTHING here: the failure is the scripted agent's own) - presented
 * once, stood down, resumed under the same run id with nothing presented again (`already_presented`) and the follow-up turn answering
 * once - the offline twin of `e2e-orchestration/specialist-orchestration.spec.ts` test 4, but for the rejection ([B21 F2b review: tests-4]):
 * the human's rejection (the review's own Cancel) is page-side: the browser proves it, spec test 4 - offline, the page's consumer
 * receives the family's sealed proposal and nothing is applied, before and after the resume. No network, no model, no credential;
 * never a wall clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { receiveReplacementProposalEvent } from "@/app/lib/project/replacement-proposal-events";
import { routeComposerMessage } from "@/app/lib/project/composer-routing";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { LLMProviderError } from "@/app/lib/llm/errors";
import type { ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import { FIXTURE_FOLLOW_UP_FAILURE, FIXTURE_FOLLOW_UP_FAILURES, FIXTURE_FOLLOW_UP_HEAD, FIXTURE_ROLE_SCRIPTS, FixtureAgentAdapter, fixtureSentenceKey, planFixtureInstruction } from "@/app/lib/agent/fixture-agent-adapter";
import { DurableOrchestrationRunStore, orchestrationResumeStoreOf } from "../store";
import { SPECIALIST_APPROVAL_OUTCOMES } from "../merge";
import { routeTaskComplexity } from "../router";
import { SPECIALIST_RESULT_TOOL_ID, SPECIALIST_RESULT_TOOL_NAME } from "../result-tool";
import { installCatalog, resetCatalog, timerEditor, type TimerEditor } from "./_d3-fixtures";
import { fixtureClientLog, type FixtureClientLog } from "./_f-fixture-clients";
import { B21_F_SENTENCES } from "./_f-cases";

const state = vi.hoisted(() => ({ log: null as FixtureClientLog | null }));

vi.mock("@/app/lib/agent/adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/adapters")>();
  const { FixtureAgentAdapter: Fixture } = await import("@/app/lib/agent/fixture-agent-adapter");
  const clients = await import("@/app/lib/agent/orchestration/__tests__/_f-fixture-clients");
  /** the REAL adapter class over a fake SDK client answering from ONE scripted fixture agent (b21-f-evaluation's harness) */
  const build = (provider: "openai" | "anthropic", model: string | undefined, maxRetries: number | undefined) => {
    const fixture = new Fixture(provider);
    const log = state.log ?? clients.fixtureClientLog();
    return provider === "openai"
      ? new original.OpenAIAgentAdapter(clients.fixtureOpenAIClient(fixture, log) as never, model ?? undefined, undefined, maxRetries ?? 2)
      : new original.AnthropicAgentAdapter(clients.fixtureAnthropicClient(fixture, log) as never, model ?? undefined, maxRetries);
  };
  return {
    ...original,
    agentAdapterFor: (provider: "openai" | "anthropic") => build(provider, undefined, undefined),
    agentAdapterForRole: (_role: string, provider: "openai" | "anthropic", model?: string) => build(provider, model, original.SPECIALIST_SDK_MAX_RETRIES),
  };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "@/app/api/chat/route";
import { ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, setOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";

const NEWLINE = String.fromCharCode(10);
const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
const FACTS = { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor" as const, autonomyMode: "proposal_only" as const, selectionCount: 0 };
type Event = Record<string, unknown>;
type Posted = { status: number; runId: string | null; json: Record<string, unknown> | null; events: Event[] };

/** The chat body the page sends (b21-f-evaluation's `chatBody`): the message, the schematic and its head mark, the PCB working copy. */
function timerBody(editor: TimerEditor, sentence: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const board: PcbBoard = createEmptyBoard();
  const schematic: SchematicState = editor.visible();
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE, schematicState: schematic, schematicHeadMark: editor.editor.headMark(),
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(schematic), authoritySource: "local-working-copy" },
    ...extra,
  };
}
async function post(body: unknown): Promise<Posted> {
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const runId = response.headers.get("X-Sirkit-Run-Id");
  const text = await response.text();
  const ndjson = (response.headers.get("Content-Type") ?? "").includes("ndjson");
  return { status: response.status, runId, json: ndjson ? null : (JSON.parse(text) as Record<string, unknown>), events: ndjson ? text.trim().split(NEWLINE).map((line) => JSON.parse(line) as Event) : [] };
}
const of = (events: Event[], type: string): Event[] => events.filter((event) => event.type === type);
const lines = (events: Event[]): string[] => events.flatMap((event) => (typeof event.message === "string" ? [event.message] : []));
const terminals = (events: Event[]): Event[] => events.filter((event) => event.type === "run_completed" || event.type === "run_failed");
const ARTIFACT_EVENTS = new Set(["proposal_ready", "pcb_proposal_ready", "layout_candidate_ready", "execution_grant_ready"]);
const artifactsOf = (events: Event[]): Event[] => events.filter((event) => ARTIFACT_EVENTS.has(String(event.type)));
const texts = (events: Event[]): string[] => of(events, "text_delta").map((event) => String(event.text));
const startedRoles = (log: FixtureClientLog): string[] => log.calls.filter((call) => call.turn === "start").map((call) => (call.followUp ? "coordinator-2" : call.role));
/** one run_started first, exactly ONE terminal and last */
function expectOneRun(events: Event[]): void {
  expect(events[0]).toMatchObject({ type: "run_started" });
  expect(of(events, "run_started")).toHaveLength(1);
  expect(terminals(events)).toHaveLength(1);
  expect(events.at(-1)).toBe(terminals(events)[0]);
}
/** a follow-up turn's user message as the runtime words its head: the envelope's header line, then the document with its approval */
const envelope = (outcome: string): string => `${FIXTURE_FOLLOW_UP_HEAD}, JUDGED - data${NEWLINE}${JSON.stringify({ stop: "completed", approval: { outcome, presented: null }, specialists: [], escalations: [] })}`;
const declaration = (providerName: string, toolId: string): ProviderToolDeclaration => ({ providerName, toolId, version: "1.0.0", description: "", inputSchema: {} });

describe("[B21 F2b] the scripted follow-up failure of the browser's F12 sentence (D21-45)", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", ""); vi.stubEnv("SIRKIT_OPENAI_MODEL", ""); vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7");
    vi.stubGlobal("fetch", () => { throw new Error("no network"); });
    resetAdmissionControl();
    state.log = fixtureClientLog();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetAdmissionControl();
    resetCatalog();
    resetOrchestrationStoreFactory();
    state.log = null;
  });

  it("1. the failure is scoped to ONE sentence and ONE approval outcome: for every script-table sentence (and one with no script) under every approval outcome the scripted agent's follow-up turn answers from the envelope - except the browser's F12 sentence while its envelope says `presented`, whose follow-up turn fails with the scripted provider failure (an `LLMProviderError`, overloaded, 529 - case 12's vocabulary, the loop's `provider_overloaded`) on either provider; that sentence routes to the replacement DAG and reaches the assistant from the composer, and its first turn and specialists play the scripts of case 12's sentence", async () => {
    const key = fixtureSentenceKey(B21_F_SENTENCES.rejectResumeBrowser);
    expect(FIXTURE_FOLLOW_UP_FAILURES).toEqual([key]);
    expect(FIXTURE_FOLLOW_UP_FAILURE).toEqual({ reason: "overloaded", status: 529 });
    expect(routeTaskComplexity(B21_F_SENTENCES.rejectResumeBrowser, FACTS)).toMatchObject({ kind: "dag", rule: "D-component-replacement" });
    expect(routeComposerMessage(B21_F_SENTENCES.rejectResumeBrowser, true).route, "E4's composer: a genuine replacement request asks the assistant").toBe("ask");
    expect(FIXTURE_ROLE_SCRIPTS[key], "the same script as case 12's sentence: only the schematic specialist proposes").toEqual(FIXTURE_ROLE_SCRIPTS[fixtureSentenceKey(B21_F_SENTENCES.rejectResume)]);
    // every sentence of the table and one with no script, under every approval outcome the runtime can state
    for (const sentence of [...Object.keys(FIXTURE_ROLE_SCRIPTS), "what is on the board"]) {
      for (const outcome of SPECIALIST_APPROVAL_OUTCOMES) {
        const turn = new FixtureAgentAdapter("openai").start({ system: "coordinator", history: [{ role: "user", text: "Earlier message." }, { role: "assistant", text: "(fixture agent) earlier" }, { role: "user", text: sentence }, { role: "assistant", text: "(fixture agent) first" }], userMessage: envelope(outcome), tools: [] });
        if (sentence === key && outcome === "presented") {
          const failure = await turn.then(() => null, (error: unknown) => error);
          expect(failure, `${sentence} / ${outcome}`).toBeInstanceOf(LLMProviderError);
          expect(failure, `${sentence} / ${outcome}`).toMatchObject({ provider: "openai", reason: "overloaded", providerStatus: 529 });
        } else {
          expect((await turn).text, `${sentence} / ${outcome}`).toBe(`(fixture agent) The specialists' results as the deterministic merge judged them: 0 accepted, 0 withheld; 0 escalation(s); approval: ${outcome}. Nothing was applied; the human decides.`);
        }
      }
    }
    // on the other provider too, and keyed on the LAST user message of the conversation only
    await expect(new FixtureAgentAdapter("anthropic").start({ system: "coordinator", history: [{ role: "user", text: B21_F_SENTENCES.rejectResumeBrowser }, { role: "assistant", text: "(fixture agent) first" }], userMessage: envelope("presented"), tools: [] })).rejects.toMatchObject({ provider: "anthropic", reason: "overloaded", providerStatus: 529 });
    expect((await new FixtureAgentAdapter("openai").start({ system: "coordinator", history: [{ role: "user", text: B21_F_SENTENCES.rejectResumeBrowser }, { role: "assistant", text: "(fixture agent) first" }, { role: "user", text: "Something else." }], userMessage: envelope("presented"), tools: [] })).text).toContain("approval: presented.");
    expect((await new FixtureAgentAdapter("openai").start({ system: "coordinator", history: [], userMessage: envelope("presented"), tools: [] })).text).toContain("approval: presented.");
    // the sentence's own first turn is the plain scripted reply (never a failure), as case 12's sentence's is
    for (const sentence of [B21_F_SENTENCES.rejectResumeBrowser, B21_F_SENTENCES.rejectResume]) {
      expect(planFixtureInstruction(sentence).kind, sentence).toBe("reply");
      expect((await new FixtureAgentAdapter("openai").start({ system: "coordinator", history: [], userMessage: sentence, tools: [] })).text, sentence).toMatch(/^\(fixture agent\) I follow only the harness's scripted instructions/);
    }
    // its schematic specialist resolves U1 by the schematic read first, then (below, through the POST) seals the exact replacement
    const tools = [declaration(SPECIALIST_RESULT_TOOL_NAME, SPECIALIST_RESULT_TOOL_ID), declaration("sirkit_schematic_inspect", "sirkit.schematic.inspect")];
    const objective = (sentence: string): string => `As the schematic specialist, address this request with reads and, only where a change is warranted, ONE sealed proposal of your role and report structured evidence: ${sentence}`;
    for (const sentence of [B21_F_SENTENCES.rejectResumeBrowser, B21_F_SENTENCES.rejectResume]) {
      const step = await new FixtureAgentAdapter("openai").start({ system: `frame${NEWLINE}Role: schematic${NEWLINE}`, history: [], userMessage: objective(sentence), tools });
      expect(step.toolCalls.map((call) => call.providerName), sentence).toEqual(["sirkit_schematic_inspect"]);
    }
  });

  it("2. through the PRODUCTION chat POST (the flag on; the fake SDK clients fault nothing - the failure is the scripted agent's own): the browser's F12 sentence presents the schematic specialist's replacement ONCE and stands down (`follow_up_failed`, `provider_overloaded`); the page's consumer receives the sealed proposal and nothing is applied ([B21 F2b review: tests-4] the human's rejection (the review's own Cancel) is page-side: the browser proves it, spec test 4); the resume under the same run id replays the first turn and the four committed specialists, presents NOTHING again (`already_presented`) and its follow-up turn answers ONCE; a second resume is 409 `resume_completed` - and case 12's own sentence sent the same way is unchanged: its follow-up turn answers in its first request", async () => {
    const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    setOrchestrationStoreFactory(() => store);
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    const sentence = B21_F_SENTENCES.rejectResumeBrowser;
    const first = await post(timerBody(editor, sentence));
    expectOneRun(first.events);
    expect(state.log!.followUpFails, "no fault of the fake client").toBe(false);
    expect(artifactsOf(first.events).map((event) => event.type), "presented ONCE").toEqual(["proposal_ready"]);
    expect(lines(first.events).filter((line) => line.startsWith("Orchestration: presented for approval: task-3-schematic action 0 ("))).toHaveLength(1);
    expect(of(first.events, "degraded").map((event) => [event.reason, event.message]), "stood down AFTER presenting: the scripted follow-up failure").toEqual([["follow_up_failed", "Orchestration: the follow-up coordinator turn did not complete (provider_overloaded); the assistant's answer above stands."]]);
    expect(first.events.findIndex((event) => event.type === "degraded")).toBeGreaterThan(first.events.findIndex((event) => event.type === "proposal_ready"));
    expect(state.log!.calls.filter((call) => call.followUp), "the follow-up call reached the scripted agent, which failed it").toHaveLength(1);
    expect(terminals(first.events)).toEqual([expect.objectContaining({ type: "run_completed" })]);
    // the page's consumer receives the family's sealed proposal and the server applied nothing: it awaits the human (whose Cancel is page-side: spec test 4)
    expect(receiveReplacementProposalEvent(artifactsOf(first.events)[0]!)).not.toBeNull();
    expect(editor.executed()).toBe(0);
    // the same message again, resuming the run
    state.log = fixtureClientLog();
    const resumed = await post(timerBody(editor, sentence, { resumeRunId: first.runId }));
    expect([resumed.status, resumed.runId]).toEqual([200, first.runId]);
    expectOneRun(resumed.events);
    expect(startedRoles(state.log), "no specialist and no first turn called again: the follow-up only").toEqual(["coordinator-2"]);
    expect(of(resumed.events, "specialist_finished").map((event) => [event.role, event.status])).toEqual([["circuit-topology", "replayed"], ["component-sourcing-evidence", "replayed"], ["schematic", "replayed"], ["verification-critic", "replayed"]]);
    expect(artifactsOf(resumed.events), "NOTHING presented again").toEqual([]);
    expect(lines(resumed.events).filter((line) => line.startsWith("Orchestration: nothing from the specialists is presented for approval (already_presented): "))).toHaveLength(1);
    expect(of(resumed.events, "degraded"), "the follow-up answered").toEqual([]);
    expect(texts(resumed.events).filter((text) => text.startsWith("(fixture agent) The specialists' results")), "ONE follow-up answer").toEqual([expect.stringContaining("approval: already_presented.")]);
    expect(terminals(resumed.events)).toEqual([expect.objectContaining({ type: "run_completed" })]);
    const record = (await orchestrationResumeStoreOf(store)!.history({ ...SCOPE, runId: first.runId! })).map((entry) => entry.entry.kind);
    expect(record.filter((kind) => kind === "artifact"), "ONE artifact claim for the message").toHaveLength(1);
    expect(record.at(-1)).toBe("follow-up");
    expect(editor.executed()).toBe(0);
    // the run is finished: a second resume is refused before any call
    state.log = fixtureClientLog();
    const finished = await post(timerBody(editor, sentence, { resumeRunId: first.runId }));
    expect([finished.status, finished.json?.code]).toEqual([409, "resume_completed"]);
    expect(state.log.calls).toEqual([]);
    // case 12's own sentence through the same harness, no fault: its script's follow-up answers in its first request (unchanged)
    state.log = fixtureClientLog();
    const unchanged = await post(timerBody(await timerEditor(SCOPE), B21_F_SENTENCES.rejectResume));
    expectOneRun(unchanged.events);
    expect(artifactsOf(unchanged.events).map((event) => event.type)).toEqual(["proposal_ready"]);
    expect(of(unchanged.events, "degraded")).toEqual([]);
    expect(texts(unchanged.events).filter((text) => text.startsWith("(fixture agent) The specialists' results"))).toEqual([expect.stringContaining("approval: presented.")]);
  });
});
