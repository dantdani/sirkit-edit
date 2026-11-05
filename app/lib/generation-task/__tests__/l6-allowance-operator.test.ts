/**
 * [PR-L6, 2026-10-19] OD-252 item 1, OD-253 item 6 (live-run.md H, D1 and D2): an operator may only LOWER the per-task allowance, and
 * the unit gains an OPTIONAL input-token dimension.
 *
 *  1. `resolveGenerationAllowanceUnit` reads the five environment names: an integer >= 1 lowers its field; zero, a sign, a fraction, text
 *     and a value above the default are ignored (the default field stands); the input name sets the optional input dimension; nothing
 *     set is no operator unit at all (undefined: every task keeps the default unit, as before);
 *  2. the head judge: a unit carrying `inputTokens` validates, a PERSISTED head without `inputTokens` or `uncertainInputTokens` (every head
 *     already in the owner's database) still validates, a unit above the default and an input unit of 0 are refused; an uncertain input
 *     bound in the usage and an in-flight input bound on a reservation validate;
 *  3. the service creates every start with the operator's unit (the snapshot's remaining allowance says so), and a start body that tries
 *     to carry an allowance is refused by the closed body shape;
 *  4. the chat's start (`generationTaskPortOver`) is the same service and gets the same unit;
 *  5. the composition root reads the names once into the runtime, and the routes' service is built with them.
 *
 * In-memory durable repository; no provider, no database, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { durableWorkflowDigest } from "../../durable-workflow/stable";
import { generationTaskPortOver } from "@/app/api/chat/schematic-generation-runtime";
import {
  GENERATION_ALLOWANCE_ENV, GENERATION_TASK_ALLOWANCE_UNIT, generationAllowanceLimits, generationAllowanceRefusal, generationCommitted, generationInputRemaining, generationTaskHeadIssue,
  resolveGenerationAllowanceUnit, type GenerationAllowanceUnit, type GenerationTaskHead,
} from "../contracts";
import { resetGenerationTaskRuntimeFactory, resolveGenerationTaskRuntime, resolveGenerationTaskService, setGenerationTaskRuntimeFactory } from "../runtime";
import { GenerationTaskService } from "../service";
import { GenerationTaskStore } from "../store";
import { startTask } from "./_l3-worker-fixtures";

const SCOPE = { tenantId: "tenant-l6-allowance", projectId: "project-l6-allowance", branchId: "main" };
const PRINCIPAL = { principalId: "user-l6-allowance", role: "pcb_editor" as const, membershipRevision: "mbr1-0123456789abcdef" };
const IDENTITIES = { catalogProfile: "fixture-scripted" as const, embeddingModel: "text-embedding-3-small", promptDigests: { plan: durableWorkflowDigest("plan"), build: durableWorkflowDigest("build"), subsystem: durableWorkflowDigest("subsystem") } };
const OPERATOR: GenerationAllowanceUnit = { modelCalls: 24, outputTokens: 57_344, catalogSearches: 120, wallClockMs: 6 * 3_600_000, inputTokens: 450_000 };
let requests = 0;
const body = (extra: Record<string, unknown> = {}) => ({ clientRequestId: `00000000-0000-4000-8000-${(requests += 1).toString(16).padStart(12, "0")}`, prompt: "a 555 LED blinker", base: { schematicDigest: "eng1-0123456789abcdef", recipe: "build-pin" }, ...extra });
function service(allowanceUnit?: GenerationAllowanceUnit): { service: GenerationTaskService; store: GenerationTaskStore } {
  const repository = new InMemoryDurableWorkflowRepository();
  const store = new GenerationTaskStore({ repository });
  return { store, service: new GenerationTaskService({ store, repository, clock: () => Date.now(), providerServable: () => true, identities: () => IDENTITIES, durability: "durable", ...(allowanceUnit ? { allowanceUnit } : {}) }) };
}

afterEach(() => { vi.unstubAllEnvs(); resetGenerationTaskRuntimeFactory(); });

describe("[PR-L6] the operator may only lower the per-task allowance (OD-252 item 1, OD-253 item 6)", () => {
  it("1. resolveGenerationAllowanceUnit: integers >= 1 lower their field; garbage and values above the default are ignored; nothing set is no operator unit", () => {
    expect(Object.values(GENERATION_ALLOWANCE_ENV)).toEqual(["SIRKIT_GENERATION_ALLOWANCE_MODEL_CALLS", "SIRKIT_GENERATION_ALLOWANCE_OUTPUT_TOKENS", "SIRKIT_GENERATION_ALLOWANCE_INPUT_TOKENS", "SIRKIT_GENERATION_ALLOWANCE_CATALOG_SEARCHES", "SIRKIT_GENERATION_ALLOWANCE_WALL_CLOCK_MS"]);
    expect(resolveGenerationAllowanceUnit({})).toBeUndefined();
    expect(resolveGenerationAllowanceUnit({ [GENERATION_ALLOWANCE_ENV.modelCalls]: "12" })).toEqual({ ...GENERATION_TASK_ALLOWANCE_UNIT, modelCalls: 12 });
    expect(resolveGenerationAllowanceUnit({ [GENERATION_ALLOWANCE_ENV.modelCalls]: " 12 " })).toEqual({ ...GENERATION_TASK_ALLOWANCE_UNIT, modelCalls: 12 });
    for (const garbage of ["0", "-1", "abc", "61", "12.5", "1e1", "", " ", "0012"]) expect(resolveGenerationAllowanceUnit({ [GENERATION_ALLOWANCE_ENV.modelCalls]: garbage }), garbage).toBeUndefined();
    expect(resolveGenerationAllowanceUnit({ [GENERATION_ALLOWANCE_ENV.outputTokens]: "480001" })).toBeUndefined(); // above the default: never raised
    expect(resolveGenerationAllowanceUnit({ [GENERATION_ALLOWANCE_ENV.outputTokens]: "480000" })).toBeUndefined(); // equal: nothing lowered
    expect(resolveGenerationAllowanceUnit({ [GENERATION_ALLOWANCE_ENV.outputTokens]: "480001", [GENERATION_ALLOWANCE_ENV.catalogSearches]: "120" })).toEqual({ ...GENERATION_TASK_ALLOWANCE_UNIT, catalogSearches: 120 });
    // the input dimension is optional: absent unless named, then any integer 1..ceiling
    expect(resolveGenerationAllowanceUnit({ [GENERATION_ALLOWANCE_ENV.modelCalls]: "24" })!.inputTokens).toBeUndefined();
    expect(resolveGenerationAllowanceUnit({ [GENERATION_ALLOWANCE_ENV.inputTokens]: "450000" })).toEqual({ ...GENERATION_TASK_ALLOWANCE_UNIT, inputTokens: 450_000 });
    for (const garbage of ["0", "-5", "lots", "100000001"]) expect(resolveGenerationAllowanceUnit({ [GENERATION_ALLOWANCE_ENV.inputTokens]: garbage }), garbage).toBeUndefined();
    const all = Object.fromEntries(Object.entries({ modelCalls: "24", outputTokens: "57344", inputTokens: "450000", catalogSearches: "120", wallClockMs: String(6 * 3_600_000) }).map(([key, value]) => [GENERATION_ALLOWANCE_ENV[key as keyof typeof GENERATION_ALLOWANCE_ENV], value]));
    expect(resolveGenerationAllowanceUnit(all)).toEqual(OPERATOR);
    expect(GENERATION_TASK_ALLOWANCE_UNIT).toEqual({ modelCalls: 60, outputTokens: 480_000, catalogSearches: 300, wallClockMs: 72 * 3_600_000 }); // the default (and the manuals) unchanged
  });

  it("2. the head judge: an input unit validates; a persisted head without the new keys still validates; a unit above the default or an input unit of 0 is refused", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new GenerationTaskStore({ repository });
    const legacy = await startTask({ store, scope: SCOPE });
    expect(legacy.allowance.unit).not.toHaveProperty("inputTokens");
    expect(legacy.usage).not.toHaveProperty("uncertainInputTokens");
    expect(generationTaskHeadIssue(legacy)).toBeNull(); // the owner's existing rows: no input key anywhere
    expect(generationInputRemaining(legacy)).toBeNull();
    const operated = await startTask({ store, scope: { ...SCOPE, projectId: "project-l6-allowance-2" } }, { allowanceUnit: OPERATOR });
    expect(operated.allowance.unit).toEqual(OPERATOR);
    expect(generationTaskHeadIssue(operated)).toBeNull();
    const variant = (mutate: (head: GenerationTaskHead) => void): string | null => { const head = structuredClone(operated); mutate(head); return generationTaskHeadIssue(head); };
    expect(variant((head) => { head.usage.uncertainInputTokens = 9_000; })).toBeNull();
    expect(variant((head) => { head.allowance.unit.modelCalls = 61; })).toMatch(/allowance\.unit\.modelCalls/);
    expect(variant((head) => { head.allowance.unit.inputTokens = 0; })).toMatch(/allowance\.unit\.inputTokens/);
    expect(variant((head) => { (head.usage as Record<string, number>).uncertainInputTokens = -1; })).toMatch(/usage\.uncertainInputTokens/);
    expect(variant((head) => { (head.usage as Record<string, number>).inputTokenGuess = 1; })).toMatch(/usage: an unknown key/);
    // the limits multiply by the units; committed input counts the reported, the uncertain and the in-flight bounds
    const extended = structuredClone(operated);
    extended.allowance.units = 3; extended.allowance.extensions = [1, 2].map((n) => ({ principalId: PRINCIPAL.principalId, clientActionId: `extend-${n}`, at: extended.createdAt }));
    expect(generationAllowanceLimits(extended.allowance)).toMatchObject({ modelCalls: 72, inputTokens: 1_350_000 });
    extended.usage.inputTokens = 1_000_000; extended.usage.uncertainInputTokens = 200_000;
    extended.reservations = [{ sliceId: `${extended.taskId}:s1`, attempt: 1, modelCalls: 1, outputTokens: 4_096, inputTokens: 100_000, state: "uncertain", at: extended.createdAt }];
    expect(generationTaskHeadIssue(extended)).toBeNull();
    expect(generationCommitted(extended).inputTokens).toBe(1_300_000);
    expect(generationInputRemaining(extended)).toBe(50_000);
    const now = Date.parse(extended.createdAt) + 1_000;
    expect(generationAllowanceRefusal(extended, { modelCalls: 1, outputTokens: 4_096 }, now)).toBeNull(); // 50 000 left: a call may still be admitted
    extended.reservations[0]!.inputTokens = 150_000;
    expect(generationAllowanceRefusal(extended, { modelCalls: 1, outputTokens: 4_096 }, now)).toBe("allowance_exhausted"); // settled + uncertain + in flight >= the limit
    expect(generationAllowanceRefusal(extended, { modelCalls: 0, outputTokens: 0 }, now)).toBeNull(); // the merge makes no model call
  });

  it("3. the service starts every task with the operator's unit (its snapshot says so); a body carrying an allowance is refused by the closed shape", async () => {
    const { service: withOperator } = service(OPERATOR);
    const started = await withOperator.start(SCOPE, PRINCIPAL, body());
    expect(started.status).toBe(202);
    const snapshot = started.body.task as { taskId: string; allowance: { remaining: Record<string, number>; units: number } };
    expect(snapshot.allowance).toMatchObject({ units: 1, remaining: { modelCalls: 24, outputTokens: 57_344, catalogSearches: 120, inputTokens: 450_000 } });
    const { service: plain, store } = service();
    const defaults = await plain.start(SCOPE, PRINCIPAL, body());
    expect((defaults.body.task as { allowance: { remaining: Record<string, number> } }).allowance.remaining).toEqual({ modelCalls: 60, outputTokens: 480_000, catalogSearches: 300 }); // no input key: nothing changes
    const loaded = await store.load(SCOPE, (defaults.body.task as { taskId: string }).taskId);
    expect(loaded.ok && loaded.task.allowance.unit).toEqual(GENERATION_TASK_ALLOWANCE_UNIT);
    for (const key of ["allowance", "allowanceUnit", "inputTokens"]) {
      const refused = await withOperator.start({ ...SCOPE, projectId: `project-l6-${key}` }, PRINCIPAL, body({ [key]: { modelCalls: 60, inputTokens: 100_000_000 } }));
      expect(refused, key).toMatchObject({ status: 400, body: { code: "GENERATION_TASK_INVALID_REQUEST", issue: "body: an unknown key is refused" } });
    }
  });

  it("4. the chat's start is the same service: a chat start gets the operator's unit", async () => {
    const { service: withOperator, store } = service(OPERATOR);
    const port = generationTaskPortOver(withOperator);
    const answer = await port.start({ scope: { ...SCOPE, projectId: "project-l6-chat" }, principal: { principalId: PRINCIPAL.principalId, role: PRINCIPAL.role, membershipRevision: PRINCIPAL.membershipRevision }, chatRunId: "chat-run-l6", body: { ...body(), provider: "openai", base: { schematicDigest: "eng1-0123456789abcdef", recipe: "chat-sheet" } } });
    expect(answer.status).toBe(202);
    const taskId = (answer.body.task as { taskId: string }).taskId;
    const loaded = await store.load({ ...SCOPE, projectId: "project-l6-chat" }, taskId);
    expect(loaded.ok && loaded.task).toMatchObject({ initiator: { origin: "chat", chatRunId: "chat-run-l6" }, allowance: { unit: OPERATOR, units: 1 } });
  });

  it("5. the composition root reads the names once into the runtime; the routes' service creates tasks with that unit", async () => {
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    vi.stubEnv("DATABASE_URL", "postgres://l6:l6@127.0.0.1:1/never-connected"); // the repository is constructed, never used
    vi.stubEnv(GENERATION_ALLOWANCE_ENV.modelCalls, "24");
    vi.stubEnv(GENERATION_ALLOWANCE_ENV.inputTokens, "450000");
    expect(resolveGenerationTaskRuntime()).toMatchObject({ durability: "durable", allowanceUnit: { ...GENERATION_TASK_ALLOWANCE_UNIT, modelCalls: 24, inputTokens: 450_000 } });
    vi.stubEnv(GENERATION_ALLOWANCE_ENV.modelCalls, "");
    vi.stubEnv(GENERATION_ALLOWANCE_ENV.inputTokens, "");
    expect(resolveGenerationTaskRuntime()).not.toHaveProperty("allowanceUnit");
    // the routes' service over a runtime that carries the operator's unit
    const repository = new InMemoryDurableWorkflowRepository();
    setGenerationTaskRuntimeFactory(() => ({ repository, clock: () => Date.now(), durability: "durable", catalogProfile: "fixture-scripted", allowanceUnit: OPERATOR }));
    const routes = resolveGenerationTaskService({ providerServable: () => true })!;
    const started = await routes.start({ ...SCOPE, projectId: "project-l6-root" }, PRINCIPAL, body());
    const loaded = await new GenerationTaskStore({ repository }).load({ ...SCOPE, projectId: "project-l6-root" }, (started.body.task as { taskId: string }).taskId);
    expect(loaded.ok && loaded.task.allowance.unit).toEqual(OPERATOR);
  });
});
