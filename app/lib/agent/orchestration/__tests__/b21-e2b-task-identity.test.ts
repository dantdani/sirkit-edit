/**
 * [B21 E2b] The task identity a per-task trace carries, under the lead's reading of OD-112 (discovery section 10, B21-E2 run 1; D21-41):
 * the per-task trace document's run id is `<runId>:<n>-<role>` and its block carries the task's INDEX and role - never the literal
 * task id `task-<n>-<role>`, which the v1 validator reads as an OpenAI key (the redaction authority's UNANCHORED diagnostics pattern,
 * kept on purpose since B19-D). (1) Every task id the scheduler mints round-trips through index and role (`specialistTaskId` /
 * `specialistTaskIdentity`, and the trace run id `specialistTraceRunId` / `specialistTraceIdentity`). (2) Through the REAL recorder and
 * validator the literal task id is still refused and the index-and-role run id is accepted, for every task of every DAG - the shared
 * rule and the nine scanned files unchanged. (3) The WHOLE finalized document of real specialist runs (REAL scheduler, loop, gateway,
 * registry, recorder and validator) and its durable record hold no string `task-<n>-` anywhere, although the specialist's own inputs
 * carry the task id: where each string of the trace comes from is stated case by case. No network, no model.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { AgentTraceRecorder, InMemoryTraceSink } from "@/app/lib/agent/trace-recorder";
import { validateAgentRunTrace } from "@/app/lib/agent/trace";
import { containsSecretShapedText, sanitizeTraceText } from "@/app/lib/agent/redaction";
import type { AgentStep, ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { SPECIALIST_ROLES, type SpecialistRole } from "../contracts";
import { DAG_ROLE_LISTS } from "../router";
import { planTasks, specialistRunId } from "../scheduler";
import { MAX_TASK_INDEX, specialistTaskId, specialistTaskIdentity, specialistTraceIdentity, specialistTraceRunId, validateOrchestrationTrace } from "../trace-attribution";
import { E2Adapter, E2_RUN_ID, runE2Dag, type E2Behaviour } from "./_e2-fixtures";

const ROOT = process.cwd();
/** a run id of the route's own shape (`run-<uuid>`) */
const ROUTE_RUN_ID = "run-7f7c3c52-0d0b-4d8e-9a57-6c1b3b0d8e11";
const SPECIALISTS = SPECIALIST_ROLES.filter((role) => role !== "coordinator") as SpecialistRole[];
/** sha256 of redaction.ts at HEAD 41330e6 (git show HEAD:app/lib/agent/redaction.ts | sha256sum): E2b narrows no pattern */
const REDACTION_AT_HEAD = "c42672c6e1d3bfbcf5c1daed611b32a347d06f66b8bc0ef1e7c79f46c782c0e8";
const TASK_ID_TEXT = /task-\d+-/;

/** every string and every key of a JSON value, with its path */
function strings(value: unknown, path = "$"): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${path}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [[`${path}#key`, key] as [string, string], ...strings(item, `${path}.${key}`)]);
}
function traceOf(runId: string) {
  const recorder = new AgentTraceRecorder({ runId, traceId: "trace-e2b-probe", provider: "openai", promptVersion: "1.4.0", promptDigest: "p", registryDigest: "r", scope: { tenantId: "t", projectId: "p", branchId: "b" }, contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null } }, new InMemoryTraceSink(), () => 0);
  recorder.recordRunStarted();
  recorder.recordStep({ model: "gpt-fake", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
  recorder.recordTerminal("completed", null);
  return recorder.finalize({ outcome: "completed", failureReason: null });
}
/** the E2 adapter behind a recorder of what each specialist's loop was handed: its system text and its objective */
class Witness implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly seen: Array<{ system: string; userMessage: string }> = [];
  constructor(private readonly inner: E2Adapter) {}
  async start(input: Parameters<ProviderAgentAdapter["start"]>[0]): Promise<AgentStep> {
    this.seen.push({ system: input.system, userMessage: input.userMessage });
    return this.inner.start(input);
  }
  async continueWith(input: Parameters<ProviderAgentAdapter["continueWith"]>[0]): Promise<AgentStep> {
    return this.inner.continueWith(input);
  }
}

vi.stubGlobal("fetch", () => { throw new Error("no network"); });

describe("[B21 E2b] the per-task trace's task identity: the index and the role, never the literal task id (D21-41)", () => {
  it("1. every scheduler task id round-trips through index and role: for every DAG the router plans and for every specialist role at every index 1..MAX_TASK_INDEX, `specialistTaskIdentity(taskId)` gives the index and role `planTasks` used and `specialistTaskId(index, role)` gives the task id back; the per-task trace run id `<runId>:<n>-<role>` round-trips through `specialistTraceIdentity` and never holds the task id; anything else is refused (null)", () => {
    const lists: Array<readonly SpecialistRole[]> = [...Object.values(DAG_ROLE_LISTS), Array.from({ length: MAX_TASK_INDEX }, (_, index) => SPECIALISTS[index % SPECIALISTS.length]!)];
    let checked = 0;
    for (const roles of lists) {
      for (const [position, task] of planTasks(roles).entries()) {
        const identity = specialistTaskIdentity(task.taskId);
        expect(identity, task.taskId).toEqual({ taskIndex: position + 1, role: task.role });
        expect(specialistTaskId(identity!.taskIndex, identity!.role)).toBe(task.taskId);
        const traceRunId = specialistTraceRunId(ROUTE_RUN_ID, identity!.taskIndex, identity!.role);
        expect(traceRunId).toBe(`${ROUTE_RUN_ID}:${position + 1}-${task.role}`);
        expect(specialistTraceIdentity(traceRunId)).toEqual({ parentRunId: ROUTE_RUN_ID, taskIndex: position + 1, role: task.role });
        expect(traceRunId).not.toMatch(TASK_ID_TEXT);
        checked += 1;
      }
    }
    for (const role of SPECIALISTS) for (let index = 1; index <= MAX_TASK_INDEX; index += 1) {
      expect(specialistTaskIdentity(specialistTaskId(index, role))).toEqual({ taskIndex: index, role });
      expect(specialistTraceIdentity(specialistTraceRunId(E2_RUN_ID, index, role))).toEqual({ parentRunId: E2_RUN_ID, taskIndex: index, role });
    }
    expect(checked).toBeGreaterThan(MAX_TASK_INDEX);
    for (const bad of ["task-0-schematic", "task-01-schematic", `task-${MAX_TASK_INDEX + 1}-schematic`, "task-1-coordinator", "task-1-unknown-role", "task-1-schematic ", "task-1-", "schematic", "1-schematic", "TASK-1-schematic", ""]) expect(specialistTaskIdentity(bad), bad).toBeNull();
    for (const bad of [`${ROUTE_RUN_ID}:task-1-schematic`, `${ROUTE_RUN_ID}:0-schematic`, `${ROUTE_RUN_ID}:1-coordinator`, `${ROUTE_RUN_ID}:${MAX_TASK_INDEX + 1}-schematic`, "1-schematic", ":1-schematic", `run with spaces:1-schematic`, `task-1-circuit-topology:1-schematic`, `${ROUTE_RUN_ID}:1-schematic:2`]) expect(specialistTraceIdentity(bad), bad).toBeNull();
  });

  it("2. D21-41 under the lead's reading, through the REAL recorder and validator: for every task of every DAG the literal run id `<runId>:<taskId>` is still `trace_validation_failure` (the redaction authority is byte-identical to HEAD, its unanchored `sk-` diagnostics pattern kept, and the validator still scans every string) while `<runId>:<n>-<role>` validates with no diagnostic; every task id reads as a key to the shared rule and no index-and-role trace run id does", () => {
    const redaction = readFileSync(join(ROOT, "app/lib/agent/redaction.ts"));
    expect(createHash("sha256").update(redaction).digest("hex")).toBe(REDACTION_AT_HEAD);
    expect(redaction.toString("utf8")).toContain("/sk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style keys");
    expect(readFileSync(join(ROOT, "app/lib/agent/trace.ts"), "utf8")).toContain('const secretPath = findSecretShapedPath(trace, "trace");');
    const tasks = new Map(Object.values(DAG_ROLE_LISTS).flatMap((roles) => planTasks(roles)).map((task) => [task.taskId, task]));
    expect(tasks.size).toBeGreaterThanOrEqual(8);
    for (const task of tasks.values()) {
      expect(containsSecretShapedText(task.taskId), task.taskId).toBe(true);
      expect(sanitizeTraceText(task.taskId), task.taskId).toBe("ta[redacted]");
      const literal = traceOf(specialistRunId(ROUTE_RUN_ID, task.taskId));
      expect(validateAgentRunTrace(literal), task.taskId).toContain("trace.runId: contains secret-shaped content");
      expect(literal.recorderDiagnostics, task.taskId).toContain("trace_validation_failure");
      const identity = specialistTaskIdentity(task.taskId)!;
      const runId = specialistTraceRunId(ROUTE_RUN_ID, identity.taskIndex, identity.role);
      expect(containsSecretShapedText(runId), runId).toBe(false);
      const accepted = traceOf(runId);
      expect(validateAgentRunTrace(accepted), runId).toEqual([]);
      expect(accepted.recorderDiagnostics, runId).toEqual([]);
    }
  });

  it("3. the WHOLE finalized document of real specialist runs holds no `task-<n>-` in any string or key, nor does its durable record - though the specialist's inputs carry the task id: its request run id is `<runId>:<taskId>` and its system text names `Task: <taskId>`, and the system text reaches the trace ONLY as the prompt digest; the objective never reaches it; tool arguments and results only as digests; the warning lines are the loop's own (its toolset lines and an unknown tool's name) and the book's closed line per refused call ([B21 E2b fix: coverage-2]), with no task id; the identities are the book's (`<runId>:<n>-<role>`, a trace id, the scope) - every document validates", async () => {
    const script: Record<string, E2Behaviour> = { "circuit-topology": { kind: "read-then-result", toolId: "sirkit.validation.connectivity-verify" }, "verification-critic": { kind: "call-unknown" } };
    const witness = new Witness(new E2Adapter(script));
    const run = await runE2Dag(["circuit-topology", "verification-critic"], script, { traced: true, adapter: witness });
    expect(run.settled).toEqual({ recorded: 2, failures: [] });
    const documents = run.book!.documents();
    expect(documents).toHaveLength(2);
    // the inputs DID carry the task id: the loop's request run id and the system text
    const specialistRuns = run.ran!.tasks.map((task) => task.specialistRunId);
    expect(specialistRuns).toEqual([specialistRunId(E2_RUN_ID, "task-1-circuit-topology"), specialistRunId(E2_RUN_ID, "task-2-verification-critic")]);
    for (const specialistRun of specialistRuns) expect(specialistRun).toMatch(TASK_ID_TEXT);
    expect(witness.seen.map((seen) => /^Task: (.+)$/m.exec(seen.system)?.[1])).toEqual(["task-1-circuit-topology", "task-2-verification-critic"]);
    for (const [index, document] of documents.entries()) {
      const seen = witness.seen[index]!;
      // the system text (which names the task) enters only as the prompt digest; the objective not at all
      expect(document.trace.promptDigest).toBe(engineeringDigest({ schema: "sirkit.agent-prompt.v1", prompt: seen.system }));
      const found = strings(document);
      expect(found.some(([, text]) => text.includes(seen.userMessage.slice(0, 40)))).toBe(false);
      expect(found.filter(([, text]) => TASK_ID_TEXT.test(text)), `document ${index + 1}`).toEqual([]);
      expect(validateOrchestrationTrace(document)).toEqual([]);
      expect(validateAgentRunTrace(document.trace)).toEqual([]);
      // the tool calls: identities and digests only
      for (const event of document.trace.events) if (event.kind === "tool_invocation") { expect(event.argsDigest).toMatch(/^eng1-/); expect(event.outputDigest === null || /^eng1-/.test(event.outputDigest)).toBe(true); }
    }
    const [circuit, critic] = documents;
    expect(circuit!.trace.events.filter((event) => event.kind === "tool_invocation")).toHaveLength(1);
    // the warning lines are the loop's own: its toolset lines (a tool this run cannot offer) and, for the critic's unknown call, the
    // line naming the tool the model asked for - on the critic's own document, with no task id
    expect(critic!.trace.warnings).toContain('The model requested unknown tool "sirkit_release_now" — refused.');
    for (const document of documents) for (const warning of document.trace.warnings) expect(warning).toMatch(/^(?:Tool sirkit\.[a-z.-]+ unavailable: |The model requested unknown tool "|A tool call was refused before it ran: )/); // [B21 E2b fix: coverage-2] + the book's closed line per refused call (`refusedCallLine`)
    expect(critic!.trace.warnings).toContain("A tool call was refused before it ran: an unknown tool (unknown_tool).");
    expect(critic!.trace.runId).toBe(`${E2_RUN_ID}:2-verification-critic`);
    // the durable records, read back through the store: no string or key holds a task id either
    for (const document of documents) {
      const history = await run.traceStore!.history({ tenantId: run.context.tenantId, projectId: run.context.projectId, branchId: run.context.branchId }, document.trace.runId);
      expect(history).toHaveLength(1);
      expect(strings(history[0]!.record).filter(([, text]) => TASK_ID_TEXT.test(text))).toEqual([]);
    }
  });
});
