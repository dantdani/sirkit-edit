/**
 * [K2, 2026-11-04] Section K, increment K2 (runbook K.4, OD-260 item 5): the remaining allowance the client view used to drop (K1 case
 * 6), shown in the Work log - over the generation task's REAL server snapshot (the store, an in-memory durable repository, the fixture
 * clock) and the browser's reader. Units of the task's own allowance (model calls, output and input tokens, catalog searches), never a
 * price. No paid call, no provider, no database.
 *
 *  1. the reader keeps the snapshot's allowance exactly; the line names every dimension the unit has (input tokens only for an operator
 *     unit with an input dimension) and the extensions used;
 *  2. a malformed allowance is dropped, never half-read, and the rest of the snapshot still reads;
 *  3. the line reaches the Work log of the task's activity entry through the generation fold, and only for the log's own project.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { durableWorkflowDigest } from "@/app/lib/durable-workflow/stable";
import { GenerationTaskStore } from "@/app/lib/generation-task/store";
import { GENERATION_TASK_ALLOWANCE_UNIT } from "@/app/lib/generation-task/contracts";
import { buildGenerationTaskSnapshot } from "@/app/lib/generation-task/snapshot";
import { generationTaskAllowanceText, readGenerationTaskSnapshot, reduceGenerationTaskView } from "@/app/lib/project/generation-task-client";
import { emptyWorkLog, reduceWorkLogGeneration } from "@/app/lib/project/work-log";

const T0 = Date.parse("2026-11-04T12:00:00.000Z");
const SCOPE = { tenantId: "tenant-k2", projectId: "project-k2-allowance", branchId: "main" } as const;

async function serverSnapshot(): Promise<Record<string, unknown>> {
  const store = new GenerationTaskStore({ repository: new InMemoryDurableWorkflowRepository(), clock: () => T0 });
  const started = await store.createOrAttach({
    scope: SCOPE, principal: { principalId: "user-k2-editor", role: "pcb_editor", membershipRevision: "mbr1-0123456789abcdef" }, origin: "build", chatRunId: null,
    request: { clientRequestId: "00000000-0000-4000-8000-0000000000b2", prompt: "a simple LED blinker", provider: "openai" },
    base: { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin", headMark: null },
    identities: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small", promptDigests: { plan: durableWorkflowDigest("plan"), build: durableWorkflowDigest("build"), subsystem: durableWorkflowDigest("subsystem") } },
    providerServable: true,
  });
  if (!started.ok) throw new Error(`start refused: ${started.code}`);
  return JSON.parse(JSON.stringify(buildGenerationTaskSnapshot(started.task, { nowMs: T0, processing: [] }))) as Record<string, unknown>;
}

describe("[K2] the remaining-allowance line", () => {
  it("1. the reader keeps the snapshot's allowance exactly; the line names every dimension the unit has and the extensions used - units, never money", async () => {
    const server = await serverSnapshot();
    const view = readGenerationTaskSnapshot(server)!;
    expect(view.allowance).toEqual(server.allowance);
    expect(view.allowance!.remaining).toMatchObject({ modelCalls: GENERATION_TASK_ALLOWANCE_UNIT.modelCalls, outputTokens: GENERATION_TASK_ALLOWANCE_UNIT.outputTokens, catalogSearches: GENERATION_TASK_ALLOWANCE_UNIT.catalogSearches });
    expect(generationTaskAllowanceText(view)).toBe("Allowance left: 60 model calls · 480,000 output tokens · 300 catalog searches (task units, not money; 0 of 4 extensions used)");
    const operator = { ...view, allowance: { ...view.allowance!, extensions: 2, remaining: { modelCalls: 1, outputTokens: 1, catalogSearches: 0, inputTokens: 250_000 } } };
    expect(generationTaskAllowanceText(operator)).toBe("Allowance left: 1 model call · 1 output token · 250,000 input tokens · 0 catalog searches (task units, not money; 2 of 4 extensions used)");
    for (const text of [generationTaskAllowanceText(view)!, generationTaskAllowanceText(operator)!]) expect(text).not.toMatch(/\$|USD|dollar|cent|price/i);
    expect(generationTaskAllowanceText({})).toBeNull();
  });

  it("2. a malformed allowance is dropped, never half-read, and the rest of the snapshot still reads", async () => {
    const server = await serverSnapshot();
    const allowance = server.allowance as Record<string, unknown>;
    for (const bad of [null, "60 calls", { ...allowance, remaining: { modelCalls: -1, outputTokens: 1, catalogSearches: 1 } }, { ...allowance, remaining: { modelCalls: 1, outputTokens: "many", catalogSearches: 1 } }, { ...allowance, windowEndsAt: 7 }, { ...allowance, remaining: { modelCalls: 1, outputTokens: 1, catalogSearches: 1, inputTokens: Number.NaN } }]) {
      const view = readGenerationTaskSnapshot({ ...server, allowance: bad });
      expect(view, JSON.stringify(bad)).not.toBeNull();
      expect(view).not.toHaveProperty("allowance");
      expect(generationTaskAllowanceText(view!)).toBeNull();
    }
    const { allowance: _omitted, ...without } = server; void _omitted;
    expect(readGenerationTaskSnapshot(without)).not.toHaveProperty("allowance");
  });

  it("3. the line reaches the Work log of the task's activity entry through the generation fold, and only for the log's own project", async () => {
    const reduced = reduceGenerationTaskView(null, { task: readGenerationTaskSnapshot(await serverSnapshot())!, events: [], gap: false }).view;
    const log = reduceWorkLogGeneration(emptyWorkLog({ projectId: SCOPE.projectId, branchId: SCOPE.branchId }), reduced, [], false);
    expect(log.allowance).toBe(generationTaskAllowanceText(reduced));
    expect(log.follows).toEqual([{ kind: "generation", taskId: reduced.taskId, cursor: 0, terminal: false, state: reduced.state }]);
    const foreign = emptyWorkLog({ projectId: "another-project", branchId: "main" });
    expect(reduceWorkLogGeneration(foreign, reduced, [], false)).toBe(foreign);
  });
});
