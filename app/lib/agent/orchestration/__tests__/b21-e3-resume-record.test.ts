/**
 * [B21 E3] The route-level resume's durable record (OD-122's userMessageDigest ledger; D21-4 at the route): the aggregate
 * `agent.orchestration-resume.v1` BESIDE the run's own record on the SAME repository (E2b's trace-record precedent), so the run's
 * history - which the scheduler resumes from, the merge chains its verdicts in and B, D, D2 and D3 pin - is untouched. Three closed
 * entries: the coordinator's first turn (the resume binding - the owner, the message, the provider and the plan as digests - and its
 * final text, recorded whole and exactly), ONE specialist artifact per userMessageDigest (the durable idempotency key IS the ledger:
 * a second claim for the same message writes nothing and reads back as a replay), and the follow-up turn's answer. Every load is
 * digest-verified and re-judged; a malformed or hostile entry is a closed refusal; no outbox effect. No network, no model.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableAggregateRecord, DurableCommitRequest, DurableCommitResult, DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { judgeOrchestrationText } from "../contracts";
import {
  DurableOrchestrationResumeStore, DurableOrchestrationRunStore, ORCHESTRATION_RESUME_AGGREGATE_TYPE, ORCHESTRATION_RESUME_ANSWER_WITHHELD, ORCHESTRATION_RESUME_EVENT_NAME,
  ORCHESTRATION_RESUME_BOUNDS, ORCHESTRATION_RESUME_KINDS, ORCHESTRATION_RESUME_RECORD_SCHEMA, decodeResumeAnswer, encodeResumeAnswer, orchestrationResumeAnswerDigest,
  orchestrationResumeIdempotencyKey, orchestrationResumeRecordDigest, orchestrationResumeStoreOf, resolveOrchestrationRunStore, ORCHESTRATION_RESUME_CREDENTIAL_SHAPES, resumeAnswerCredentialShape,
  type OrchestrationResumeInput, type OrchestrationRunScope, type OrchestrationRunStore,
} from "../store";
import { COORDINATOR_ARTIFACT_EVENTS } from "@/app/api/chat/orchestration-runtime";

const SCOPE: OrchestrationRunScope = { tenantId: "tenant-e3", projectId: "project-e3", branchId: "main", runId: "run-0e3a0000-0000-4000-8000-000000000001" };
const WORKFLOW_SCOPE = { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId };
const T0 = "2026-09-27T12:00:00.000Z";
const T1 = "2026-09-27T12:00:01.000Z";
const DIGEST = (name: string): string => engineeringDigest({ fixture: name });
const MESSAGE = DIGEST("message");
const coordinator = (over: Partial<Extract<OrchestrationResumeInput, { kind: "coordinator" }>> = {}): OrchestrationResumeInput => ({ kind: "coordinator", ownerDigest: DIGEST("owner"), userMessageDigest: MESSAGE, provider: "openai", planDigest: DIGEST("plan"), answer: "(fixture) the coordinator's first answer.", artifacts: [], ...over });
const claim = (over: Partial<Extract<OrchestrationResumeInput, { kind: "artifact" }>> = {}): OrchestrationResumeInput => ({ kind: "artifact", userMessageDigest: MESSAGE, taskId: "task-3-schematic", attempt: 0, actionIndex: 0, artifactKind: "sirkit.schematic-replacement-proposal.v2", artifactDigest: DIGEST("artifact-a"), ordinal: 0, ...over }); // [B21 E3 fix: coverage-5] + the claiming request's ordinal
const followUp = (): OrchestrationResumeInput => ({ kind: "follow-up", answerDigest: orchestrationResumeAnswerDigest("(fixture) the follow-up answer.") });
const start = (ordinal: number): OrchestrationResumeInput => ({ kind: "resume", ordinal, claim: DIGEST(`claim-${ordinal}`) }); // [B21 E3 lead] a start carries its request's claim id
const settled = (ordinal: number, presented = false): OrchestrationResumeInput => ({ kind: "settled", ordinal, presented }); // [B21 E3 fix: coverage-5] + whether that request presented the message's artifact
const char = (code: number): string => String.fromCharCode(code);
/** a key-shaped string assembled at run time (never a literal) */
const keyShaped = (): string => ["sk-", "ant-api03-", "A".repeat(40)].join("");
/** what Postgres's jsonb refuses in JSON text: a NUL and a lone surrogate written as an escape (an odd run of backslashes before `u`) */
const JSONB_REFUSED = new RegExp(`(?<!${char(92)}${char(92)})(?:${char(92)}${char(92)}${char(92)}${char(92)})*${char(92)}${char(92)}u(?:0000|d[89a-f][0-9a-f]{2})`, "i");
class JsonbRepository extends InMemoryDurableWorkflowRepository {
  override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
    if (JSONB_REFUSED.test(JSON.stringify(request.operations.map((operation) => operation.payload)))) throw new Error("unsupported Unicode escape sequence");
    return super.commit(request);
  }
}
/** the raw resume records of every run of the scope (or of one run), as the substrate holds them */
async function rawRecords(repository: InMemoryDurableWorkflowRepository, runId: string | null = SCOPE.runId, scope = WORKFLOW_SCOPE): Promise<Array<DurableAggregateRecord<Record<string, unknown>>>> {
  const heads = await repository.listHeads<Record<string, unknown>>({ aggregateType: ORCHESTRATION_RESUME_AGGREGATE_TYPE, scope });
  const histories = await Promise.all(heads.filter((head) => runId === null || head.payload.runId === runId).map((head) => repository.history<Record<string, unknown>>({ scope, aggregateType: head.aggregateType, aggregateKey: head.aggregateKey })));
  return histories.flat();
}

describe("[B21 E3] the resume record beside the run's (agent.orchestration-resume.v1)", () => {
  it("1. the five closed entries append and read back digest-verified in revision order - the coordinator's binding digests, provider, plan and its answer EXACTLY, a request's start and its end; the stored payload is closed; no outbox effect; the run's OWN history is untouched", async () => {
    expect([...ORCHESTRATION_RESUME_KINDS]).toEqual(["coordinator", "artifact", "follow-up", "resume", "settled"]);
    for (const event of COORDINATOR_ARTIFACT_EVENTS) expect(ORCHESTRATION_RESUME_EVENT_NAME.test(event), event).toBe(true); // every coordinator artifact event the runtime records has the record's closed shape
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationResumeStore(repository);
    expect(await store.append({ scope: SCOPE, at: T0, entry: coordinator({ artifacts: ["proposal_ready"] }) })).toMatchObject({ ok: true, revision: 1, replayed: false });
    expect(await store.append({ scope: SCOPE, at: T0, entry: settled(0) })).toMatchObject({ ok: true, revision: 2, replayed: false });
    expect(await store.append({ scope: SCOPE, at: T1, entry: start(1), expectedRevision: 2 })).toMatchObject({ ok: true, revision: 3, replayed: false });
    expect(await store.append({ scope: SCOPE, at: T1, entry: claim() })).toMatchObject({ ok: true, revision: 4, replayed: false });
    expect(await store.append({ scope: SCOPE, at: T1, entry: followUp() })).toMatchObject({ ok: true, revision: 5, replayed: false });
    const history = await store.history(SCOPE);
    expect(history.map((entry) => [entry.revision, entry.at, entry.entry.kind])).toEqual([[1, T0, "coordinator"], [2, T0, "settled"], [3, T1, "resume"], [4, T1, "artifact"], [5, T1, "follow-up"]]);
    expect(history[0]!.entry).toEqual({ kind: "coordinator", ownerDigest: DIGEST("owner"), userMessageDigest: MESSAGE, provider: "openai", planDigest: DIGEST("plan"), answer: "(fixture) the coordinator's first answer.", answerDigest: orchestrationResumeAnswerDigest("(fixture) the coordinator's first answer."), answerWithheld: null, artifacts: ["proposal_ready"] });
    expect([history[1]!.entry, history[2]!.entry, history[3]!.entry]).toEqual([settled(0), start(1), claim()]);
    const stored = await rawRecords(repository);
    expect(stored.map((record) => Object.keys(record.payload).sort())).toEqual(Array.from({ length: 5 }, () => ["at", "entry", "revision", "runId", "schema"]));
    expect(stored.every((record) => record.payload.schema === ORCHESTRATION_RESUME_RECORD_SCHEMA && record.payload.runId === SCOPE.runId)).toBe(true);
    expect(Object.keys(stored[0]!.payload.entry as object).sort()).toEqual(["answer", "answerDigest", "answerWithheld", "artifacts", "kind", "ownerDigest", "planDigest", "provider", "userMessageDigest"]);
    expect(await repository.listOutbox()).toEqual([]);
    // the run's own record on the same repository: nothing there
    expect(await new DurableOrchestrationRunStore(repository).history(SCOPE)).toEqual([]);
  });

  it("2. the idempotency keys ARE the ledger: the coordinator entry once, the follow-up once, a request's start and its end once per ordinal, and ONE artifact per userMessageDigest - a second claim for the same message (even for another artifact) writes nothing and reads back as a replay; a claim under another message digest is its own; another run's keys never collide", async () => {
    expect(orchestrationResumeIdempotencyKey(SCOPE.runId, coordinator())).toBe(`orchestration-resume:${SCOPE.runId}:coordinator`);
    expect(orchestrationResumeIdempotencyKey(SCOPE.runId, claim())).toBe(`orchestration-resume:${SCOPE.runId}:artifact:${MESSAGE}`);
    expect(orchestrationResumeIdempotencyKey(SCOPE.runId, followUp())).toBe(`orchestration-resume:${SCOPE.runId}:follow-up`);
    expect(orchestrationResumeIdempotencyKey(SCOPE.runId, start(2))).toBe(`orchestration-resume:${SCOPE.runId}:resume:2`);
    expect(orchestrationResumeIdempotencyKey(SCOPE.runId, settled(0))).toBe(`orchestration-resume:${SCOPE.runId}:settled:0`);
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationResumeStore(repository);
    await store.append({ scope: SCOPE, at: T0, entry: coordinator() });
    expect(await store.append({ scope: SCOPE, at: T1, entry: coordinator({ answer: "another answer" }) })).toMatchObject({ ok: true, revision: 1, replayed: true });
    expect(await store.append({ scope: SCOPE, at: T1, entry: claim() })).toMatchObject({ ok: true, revision: 2, replayed: false });
    expect(await store.append({ scope: SCOPE, at: T1, entry: claim({ taskId: "task-1-circuit-topology", artifactKind: "sirkit.schematic-tier1-proposal.v3", artifactDigest: DIGEST("artifact-b") }) })).toMatchObject({ ok: true, revision: 2, replayed: true });
    expect(await store.append({ scope: SCOPE, at: T1, entry: claim() })).toMatchObject({ ok: true, revision: 2, replayed: true });
    expect(await store.append({ scope: SCOPE, at: T1, entry: claim({ userMessageDigest: DIGEST("another message") }) })).toMatchObject({ ok: true, revision: 3, replayed: false });
    const history = await store.history(SCOPE);
    expect(history.map((entry) => entry.entry.kind)).toEqual(["coordinator", "artifact", "artifact"]);
    expect(history[0]!.entry).toMatchObject({ answer: "(fixture) the coordinator's first answer." });
    expect(history[1]!.entry).toMatchObject({ taskId: "task-3-schematic", artifactDigest: DIGEST("artifact-a") });
    // another run of the same branch: its own partition and aggregate
    const other = { ...SCOPE, runId: "run-0e3a0000-0000-4000-8000-000000000002" };
    expect(await store.append({ scope: other, at: T0, entry: claim() })).toMatchObject({ ok: true, revision: 1, replayed: false });
    expect((await store.history(other)).map((entry) => entry.entry.kind)).toEqual(["artifact"]);
  });

  it("3. the answer is recorded WHOLE and EXACTLY: control, format and separator characters, a NUL, a lone surrogate, astral text, quotes and backslashes round-trip; the stored text passes the orchestration text rule and a jsonb column's refusals; an answer over the bound, or one holding a credential-shaped value, is WITHHELD (answer null, a closed reason, its digest kept) - never stored", async () => {
    const hostile = ["a", char(0), char(13), char(10), char(9), char(0x7f), char(0x85), char(0x200b), char(0x202e), char(0x2028), char(0x2029), char(0xfeff), char(0xd800), "b", char(0xdc00), char(0xd83d) + char(0xde00), char(0xdb40) + char(0xdc01), "\"", char(92), "u0000", "z"].join("");
    const encoded = encodeResumeAnswer(hostile);
    expect(judgeOrchestrationText(encoded, ORCHESTRATION_RESUME_BOUNDS.maxAnswerChars)).toBeNull();
    expect(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(encoded)).toBe(false);
    expect(decodeResumeAnswer(encoded)).toBe(hostile);
    expect(decodeResumeAnswer("not json")).toBeNull();
    expect(decodeResumeAnswer(JSON.stringify(42))).toBeNull();
    const repository = new JsonbRepository();
    const store = new DurableOrchestrationResumeStore(repository);
    expect(await store.append({ scope: SCOPE, at: T0, entry: coordinator({ answer: hostile }) })).toMatchObject({ ok: true });
    const [entry] = await store.history(SCOPE);
    expect(entry!.entry).toMatchObject({ kind: "coordinator", answer: hostile, answerDigest: orchestrationResumeAnswerDigest(hostile), answerWithheld: null });
    expect([...ORCHESTRATION_RESUME_ANSWER_WITHHELD]).toEqual(["answer_too_long", "answer_refused"]);
    for (const [label, answer, withheld] of [["too long", "x".repeat(ORCHESTRATION_RESUME_BOUNDS.maxAnswerChars + 1), "answer_too_long"], ["credential-shaped", `the key is ${keyShaped()} - keep it`, "answer_refused"]] as const) {
      const scope = { ...SCOPE, runId: `run-0e3a0000-0000-4000-8000-00000000000${label === "too long" ? 3 : 4}` };
      expect(await store.append({ scope, at: T0, entry: coordinator({ answer }) }), label).toMatchObject({ ok: true });
      const [withheldEntry] = await store.history(scope);
      expect(withheldEntry!.entry, label).toMatchObject({ kind: "coordinator", answer: null, answerDigest: orchestrationResumeAnswerDigest(answer), answerWithheld: withheld });
      expect(JSON.stringify(await rawRecords(repository, null)), label).not.toContain(keyShaped());
    }
  });

  it("4. a malformed or hostile entry is ONE closed refusal (`invalid_record`) and nothing is written: an unknown kind, a missing or extra key, a bad digest, provider, id, attempt or index, an artifact event outside the closed shape or too many, a non-string answer, an accessor, a throwing Proxy, a bad scope or time, a request's start or end outside its ordinal bounds, an expected revision that is not a non-negative integer", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationResumeStore(repository);
    const accessor = Object.defineProperty({ ...claim() }, "taskId", { get: () => "task-3-schematic", enumerable: true });
    const proxy = new Proxy({ ...claim() }, { ownKeys: () => { throw new Error("hostile"); } });
    const cases: Array<[string, unknown, OrchestrationRunScope?, string?]> = [
      ["unknown kind", { ...claim(), kind: "grant" }], ["extra key", { ...claim(), approval: true }], ["missing key", Object.fromEntries(Object.entries(claim()).filter(([key]) => key !== "taskId"))],
      ["bad digest", claim({ artifactDigest: "sha256:abc" })], ["bad message digest", coordinator({ userMessageDigest: "eng1-XYZ" })], ["bad provider", { ...coordinator(), provider: "gemini" }],
      ["bad task id", claim({ taskId: " task" })], ["negative attempt", claim({ attempt: -1 })], ["fractional index", claim({ actionIndex: 0.5 })], ["index over the bound", claim({ actionIndex: ORCHESTRATION_RESUME_BOUNDS.maxActionIndex + 1 })],
      ["a malformed artifact event", coordinator({ artifacts: ["Proposal Ready!"] })], ["a non-string artifact event", { ...coordinator(), artifacts: [7] }], ["too many artifacts", coordinator({ artifacts: Array.from({ length: ORCHESTRATION_RESUME_BOUNDS.maxArtifacts + 1 }, () => "proposal_ready") })],
      ["non-string answer", { ...coordinator(), answer: 42 }], ["accessor", accessor], ["throwing proxy", proxy], ["a credential-shaped id", claim({ taskId: keyShaped() })],
      ["bad scope", claim(), { ...SCOPE, runId: "run id with spaces" }], ["bad time", claim(), SCOPE, "2026-09-27"],
      ["a start with ordinal 0 (the coordinator's own)", start(0)], ["a negative end", settled(-1)], ["a fractional start", start(1.5)], ["a start over the bound", start(ORCHESTRATION_RESUME_BOUNDS.maxOrdinal + 1)], ["a start with an extra key", { ...start(1), at: T0 }],
    ];
    for (const [label, entry, scope, at] of cases) {
      const outcome = await store.append({ scope: scope ?? SCOPE, at: at ?? T0, entry: entry as OrchestrationResumeInput });
      expect(outcome, label).toMatchObject({ ok: false, code: "invalid_record" });
    }
    for (const expectedRevision of [-1, 0.5, Number.NaN, "1"]) {
      expect(await store.append({ scope: SCOPE, at: T0, entry: coordinator(), expectedRevision: expectedRevision as number }), String(expectedRevision)).toMatchObject({ ok: false, code: "invalid_record" });
    }
    expect(await rawRecords(repository, null)).toEqual([]);
  });

  it("5. every load is verified: a record whose entry, digest, revision, schema or run id was altered in storage, or that belongs to another scope or aggregate, is refused with the one mismatch sentence; a stored answer that no longer decodes to its digest likewise; another project's scope reads nothing", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationResumeStore(repository);
    await store.append({ scope: SCOPE, at: T0, entry: coordinator() });
    await store.append({ scope: SCOPE, at: T1, entry: claim() });
    const pristine = await rawRecords(repository);
    const tampered = (mutate: (records: Array<DurableAggregateRecord<Record<string, unknown>>>) => void): DurableWorkflowRepository => {
      const records = structuredClone(pristine);
      mutate(records);
      return { history: async () => structuredClone(records), loadHead: async () => structuredClone(records.at(-1) ?? null) } as unknown as DurableWorkflowRepository;
    };
    /** [B21 E3 fix: tests-6] an ENTRY forged in storage with its record digest RECOMPUTED (the digest is unkeyed): the entry's own
     *  re-judgement on load is then what refuses it, never the record digest */
    const forged = (index: number, change: (entry: Record<string, unknown>) => void) => (records: Array<DurableAggregateRecord<Record<string, unknown>>>): void => {
      change(records[index]!.payload.entry as Record<string, unknown>);
      records[index]!.recordDigest = orchestrationResumeRecordDigest(records[index]!.payload as never);
    };
    const mutations: Array<[string, (records: Array<DurableAggregateRecord<Record<string, unknown>>>) => void]> = [
      ["the artifact digest", forged(1, (entry) => { entry.artifactDigest = "sha256:forged"; })],
      ["the record digest", (records) => { records[0]!.recordDigest = DIGEST("forged"); }],
      ["the revision", (records) => { records[1]!.payload.revision = 5; }],
      ["the schema", (records) => { records[0]!.payload.schema = "sirkit.orchestration-resume-record.v0"; }],
      ["the run id", (records) => { records[0]!.payload.runId = "run-0e3a0000-0000-4000-8000-000000000009"; }],
      ["the answer (its digest kept)", forged(0, (entry) => { entry.answer = encodeResumeAnswer("a different answer"); })],
      ["the answer encoded another way (a raw newline)", forged(0, (entry) => { entry.answer = JSON.stringify("(fixture) the coordinator's first answer."); entry.answer = `${String(entry.answer).slice(0, -1)}${char(10)}"`; })],
      ["an answer beside a withheld reason", forged(0, (entry) => { entry.answerWithheld = "answer_refused"; })],
      ["an extra key", forged(1, (entry) => { entry.approval = true; })],
      ["an unknown kind", forged(1, (entry) => { entry.kind = "grant"; })],
      ["an artifact event outside the closed shape", forged(0, (entry) => { entry.artifacts = ["Proposal Ready!"]; })],
      ["a record of another scope", (records) => { records[0]!.scope = { ...records[0]!.scope, projectId: "project-other" }; }],
      ["a record of another aggregate", (records) => { records[1]!.aggregateKey = `${records[1]!.aggregateKey}-other`; }],
    ];
    for (const [label, mutate] of mutations) {
      await expect(new DurableOrchestrationResumeStore(tampered(mutate)).history(SCOPE), label).rejects.toThrow(/^AGENT_ORCHESTRATION_RESUME_MISMATCH$/);
    }
    // the forged records pass the record digest: the entry's re-judgement is what refused them
    for (const [index, change] of [[1, (entry: Record<string, unknown>) => { entry.approval = true; }], [0, (entry: Record<string, unknown>) => { entry.answer = encodeResumeAnswer("a different answer"); }]] as const) {
      const records = structuredClone(pristine);
      forged(index, change)(records);
      expect(orchestrationResumeRecordDigest(records[index]!.payload as never)).toBe(records[index]!.recordDigest);
    }
    expect(await store.history({ ...SCOPE, projectId: "project-other" })).toEqual([]);
  });

  it("6. the resume store is derived from the DURABLE record only, on the SAME repository (what the store appends lands beside the run's records); a store double or the unavailable default has none", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const run = new DurableOrchestrationRunStore(repository);
    const resume = orchestrationResumeStoreOf(run);
    expect(resume).toBeInstanceOf(DurableOrchestrationResumeStore);
    expect(orchestrationResumeStoreOf(run)).toBe(resume); // one per durable record
    await resume!.append({ scope: SCOPE, at: T0, entry: coordinator() });
    expect(await rawRecords(repository)).toHaveLength(1);
    const double: OrchestrationRunStore = { revision: async () => 0, history: async () => [], append: async () => ({ ok: true, revision: 1, recordDigest: DIGEST("x"), replayed: false }) };
    expect(orchestrationResumeStoreOf(double)).toBeNull();
    expect(orchestrationResumeStoreOf(resolveOrchestrationRunStore())).toBeNull();
  });

  it("7. a request's START is claimed by compare-and-set against the head its caller read: an explicit expected revision that is not the head is `stale_revision` and writes nothing; two claims of one ordinal from one head - exactly one commits, the other LOSES (a compare-and-set refusal, or a replay of the winner's key); an end is written once per ordinal; without an expected revision an entry lands on the head as before", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationResumeStore(repository);
    await store.append({ scope: SCOPE, at: T0, entry: coordinator() });
    await store.append({ scope: SCOPE, at: T0, entry: settled(0) });
    // a caller that read the head at revision 1 (before the end landed): its claim is refused, nothing written
    expect(await store.append({ scope: SCOPE, at: T1, entry: start(1), expectedRevision: 1 })).toMatchObject({ ok: false, code: "stale_revision" });
    expect((await store.history(SCOPE)).map((entry) => entry.entry.kind)).toEqual(["coordinator", "settled"]);
    // two callers that read the same head claim the same ordinal: exactly one commits
    const claims = await Promise.all([store.append({ scope: SCOPE, at: T1, entry: start(1), expectedRevision: 2 }), store.append({ scope: SCOPE, at: T1, entry: start(1), expectedRevision: 2 })]);
    expect(claims.map((outcome) => (outcome.ok && !outcome.replayed ? "claimed" : (outcome.ok && outcome.replayed) || (!outcome.ok && outcome.code === "stale_revision") ? "lost" : "other")).sort()).toEqual(["claimed", "lost"]);
    expect(await store.append({ scope: SCOPE, at: T1, entry: start(1), expectedRevision: 3 })).toMatchObject({ ok: true, revision: 3, replayed: true }); // a later claim of a taken ordinal reads back the winner's
    expect(await store.append({ scope: SCOPE, at: T1, entry: settled(1) })).toMatchObject({ ok: true, revision: 4, replayed: false });
    expect(await store.append({ scope: SCOPE, at: T1, entry: settled(1) })).toMatchObject({ ok: true, revision: 4, replayed: true });
    expect((await store.history(SCOPE)).map((entry) => [entry.entry.kind, "ordinal" in entry.entry ? entry.entry.ordinal : null])).toEqual([["coordinator", null], ["settled", 0], ["resume", 1], ["settled", 1]]);
  });

  it("8. [B21 E3 fix: security-1] a coordinator answer holding ANY credential shape the resume record knows is WITHHELD (`answer_refused`, its digest kept) and never stored - a PEM private key, an AWS key id, a GitHub or Slack token, a JWT, a database URL with a password, a lower-case `*_secret=` / `*_token=` / `password=` pair - beside the shared rule's key shapes; an engineering answer that merely names a token or a short setting is stored whole", async () => {
    const samples: Array<[string, string]> = [
      ["pem-private-key", ["-".repeat(5), "BEGIN RSA PRIVATE KEY", "-".repeat(5), char(10), "M".repeat(40)].join("")],
      ["pem-private-key", ["-".repeat(5), "BEGIN PGP PRIVATE KEY BLOCK", "-".repeat(5), char(10), "M".repeat(40)].join("")], // [B21 E3 lead]
      ["aws-key-id", ["AK", "IA", "Q".repeat(16)].join("")],
      ["github-token", ["gh", "p_", "a".repeat(36)].join("")],
      ["slack-token", ["xo", "xb-", "1".repeat(12), "-", "b".repeat(24)].join("")],
      ["jwt", ["ey", "J", "a".repeat(20), ".ey", "J", "b".repeat(20), ".", "c".repeat(20)].join("")],
      ["url-password", ["postgres", "://svc:", "p".repeat(12), "@db.example.test:5432/app"].join("")],
      ["secret-pair", ["client", "_secret=", "z".repeat(24)].join("")],
      ["secret-pair", ["api", "_token: ", "y".repeat(24)].join("")],
      ["secret-pair", ["pass", "word=", "x".repeat(12)].join("")],
    ];
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationResumeStore(repository);
    for (const [index, [shape, value]] of samples.entries()) {
      const answer = `(fixture) the configuration you pasted: ${value} - keep it private.`;
      const scope = { ...SCOPE, runId: `run-0e3a0000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}` };
      expect(await store.append({ scope, at: T0, entry: coordinator({ answer }) }), shape).toMatchObject({ ok: true });
      const [entry] = await store.history(scope);
      expect(entry!.entry, shape).toMatchObject({ kind: "coordinator", answer: null, answerDigest: orchestrationResumeAnswerDigest(answer), answerWithheld: "answer_refused" });
      expect(JSON.stringify(await rawRecords(repository, null, WORKFLOW_SCOPE)), shape).not.toContain(value);
      expect(resumeAnswerCredentialShape(answer), shape).toBe(shape);
    }
    expect([...new Set(samples.map(([shape]) => shape))]).toEqual(ORCHESTRATION_RESUME_CREDENTIAL_SHAPES.map((shape) => shape.name));
    for (const benign of ["The timer's max_tokens = 4096 setting is unrelated; the token bucket refills every second.", "Set password protection on the export (the field is named password).", "U1's datasheet: eyJ is not a JWT prefix here."]) {
      expect(resumeAnswerCredentialShape(benign), benign).toBeNull();
      const scope = { ...SCOPE, runId: "run-0e3a0000-0000-4000-8000-0000000002aa" };
      await store.append({ scope, at: T0, entry: coordinator({ answer: benign }) });
    }
    expect((await store.history({ ...SCOPE, runId: "run-0e3a0000-0000-4000-8000-0000000002aa" }))[0]!.entry).toMatchObject({ answer: "The timer's max_tokens = 4096 setting is unrelated; the token bucket refills every second.", answerWithheld: null });
    // every shape's quantifiers are bounded: a hostile answer at the bound is judged at once, never a quadratic scan
    for (const hostile of ["a.".repeat(30_000), "eyJ".repeat(20_000), `${"x".repeat(40)}${" ".repeat(59_000)}=`, `${"-".repeat(5)}BEGIN `.repeat(5_000), "token.".repeat(8_000), `postgres://${"u".repeat(59_000)}`]) {
      const began = performance.now();
      expect(resumeAnswerCredentialShape(hostile)).toBeNull();
      expect(performance.now() - began, hostile.slice(0, 12)).toBeLessThan(1_000);
    }
  });

  it("9. [B21 E3 fix: coverage-5] a ledger claim carries the ORDINAL of the request that claimed it and a request's settled end whether THAT request presented the message's artifact - both closed: an ordinal outside the bounds, a `presented` that is not a boolean, a claim or an end missing either is one closed refusal and writes nothing; both round-trip", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationResumeStore(repository);
    await store.append({ scope: SCOPE, at: T0, entry: coordinator() });
    const refusals: Array<[string, unknown]> = [
      ["a claim with no ordinal", Object.fromEntries(Object.entries(claim()).filter(([key]) => key !== "ordinal"))], ["a claim over the ordinal bound", claim({ ordinal: ORCHESTRATION_RESUME_BOUNDS.maxOrdinal + 1 })],
      ["a negative claim ordinal", claim({ ordinal: -1 })], ["an end with no presented", { kind: "settled", ordinal: 0 }], ["an end whose presented is a string", { kind: "settled", ordinal: 0, presented: "no" }],
      ["an end whose presented is a number", { kind: "settled", ordinal: 0, presented: 1 }], ["a start with a presented", { kind: "resume", ordinal: 1, presented: false }],
    ];
    for (const [label, entry] of refusals) expect(await store.append({ scope: SCOPE, at: T0, entry: entry as OrchestrationResumeInput }), label).toMatchObject({ ok: false, code: "invalid_record" });
    expect(await store.append({ scope: SCOPE, at: T0, entry: settled(0, false) })).toMatchObject({ ok: true, revision: 2 });
    expect(await store.append({ scope: SCOPE, at: T1, entry: start(1), expectedRevision: 2 })).toMatchObject({ ok: true, revision: 3 });
    expect(await store.append({ scope: SCOPE, at: T1, entry: claim({ ordinal: 1 }) })).toMatchObject({ ok: true, revision: 4 });
    expect(await store.append({ scope: SCOPE, at: T1, entry: settled(1, true) })).toMatchObject({ ok: true, revision: 5 });
    expect((await store.history(SCOPE)).slice(1).map((entry) => entry.entry)).toEqual([settled(0, false), start(1), claim({ ordinal: 1 }), settled(1, true)]);
  });
});
