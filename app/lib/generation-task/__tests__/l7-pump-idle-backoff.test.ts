/**
 * [PR-L7, 2026-10-20] Runbook L.8 step 7 (regression gates): the pump's idle backoff and the fixture's in-process nudge.
 *
 * The fixture worker's HTTP pump posted `/api/generation-worker` every second while idle (812 of 2,206 requests of one local fixture
 * browser run), loading the dev server in every browser job. A request that finds nothing to run now waits `idleTickMs`, each further
 * consecutive empty answer doubles the wait up to `idleMaxMs` (8 s by default), and an answer that settled a slice resets it. With the
 * backoff alone the browser specs started their tasks later (a Start or Resume waited out the worker's sleep: l5 case 1 8.8 s -> 20.6 s),
 * so the fixture server HOLDS an idle request instead (`?hold=<ms>`, `runHeldPumpedSlice`) and the fixture container's in-process work
 * signal - notified by every durable commit that schedules outbox work - wakes it at once:
 *
 *  1. the wait itself: 1 s, 2 s, 4 s, then 8 s for every further empty answer; a ceiling below the first wait is the first wait;
 *  2. a server that does not hold (no `heldMs`): the client sleeps the doubling gaps, a settled slice is followed at once by the next
 *     request and the next empty answer starts over at 1 s; a minute of idling is ten requests, not sixty;
 *  3. a failed request keeps its own backoff, and once the server answers again the idle wait starts over at 1 s;
 *  4. stop() wakes a worker sleeping at the ceiling at once: no request after it, nothing left in flight;
 *  5. a holding server (`heldMs`): the client sleeps nothing and asks for the same doubling as holds (0, 1, 2, 4, 8, 8 s); work that
 *     arrives during a hold is answered at once and the next request asks no hold;
 *  6. the server side: `pumpHoldMsOf` reads only a positive integer up to 8 s; the work signal wakes a waiter on notify, at once when
 *     the version already moved, never on timeout or abort; `runHeldPumpedSlice` re-ticks only when woken, keeps holding the rest of
 *     the hold after a wake that found nothing, and answers no `heldMs` without a signal;
 *  7. through the REAL routes under the fixture runtime: an idle held pump request is answered when its hold is spent, and a Start
 *     wakes a held request at once - the plan slice runs in that same request, long before its 8 s hold.
 *
 * A stub fetch and vitest's fake timers (cases 1-5), the real signal (6), the real start and pump routes over the fixture container's
 * in-memory store and the fixture's scripted ports (7). No provider, no database, no network; nothing is written to disk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUMP_IDLE_MAX_MS, createPumpTransport, pumpIdleWaitMs } from "../worker/pump-transport";
import { PUMP_HOLD_MAX_MS, pumpHoldMsOf, runHeldPumpedSlice, type PumpedSliceAnswer } from "../worker/runtime";
import { createFixtureWorkSignal } from "../../fixture-runtime/container";

type Answer = "empty" | "slice" | "fail";
const SLICE = { kind: "plan", sliceId: "generation-task:l7-backoff:s1", outcome: "planned", state: "queued", detail: "planned 1 block(s)" };

/** A pump transport over a stub fetch that answers `script` in order (then empty), recording the fake clock at every request; a
 *  `holding` server waits the asked hold (unless `workAt` falls inside it: then it answers the slice at that instant) and answers `heldMs`. */
function scripted(script: readonly Answer[], options: { holding?: boolean; workAt?: number } = {}) {
  const at: number[] = [];
  const holds: number[] = [];
  let index = 0;
  let workAt = options.workAt;
  const body = (answer: Answer, heldMs: number | null) => ({ ok: true, tick: { at: new Date().toISOString(), claims: [], started: answer === "slice" ? [SLICE.sliceId] : [] }, ran: answer === "slice" ? SLICE : null, ...(heldMs === null ? {} : { heldMs }) });
  const fetch = (async (url: string) => {
    const started = Date.now();
    at.push(started);
    const hold = Number(new URL(url).searchParams.get("hold") ?? 0);
    holds.push(hold);
    const answer = script[index++] ?? "empty";
    if (answer === "fail") return { ok: false, status: 503, json: async () => ({ ok: false, code: "GENERATION_TASK_STORE_UNAVAILABLE" }) };
    if (!options.holding) return { ok: true, status: 200, json: async () => body(answer, null) };
    if (answer === "empty" && hold > 0) {
      const wake = workAt !== undefined && workAt >= started && workAt < started + hold ? workAt - started : null;
      await new Promise((resolve) => setTimeout(resolve, wake ?? hold));
      if (wake !== null) { workAt = undefined; return { ok: true, status: 200, json: async () => body("slice", wake) }; }
      return { ok: true, status: 200, json: async () => body("empty", hold) };
    }
    return { ok: true, status: 200, json: async () => body(answer, 0) };
  }) as unknown as typeof globalThis.fetch;
  const transport = createPumpTransport({ origin: "http://localhost:3999", workerId: "w-l7-backoff", secret: "l7-backoff-test-only", fetch });
  return { transport, at, holds, gaps: (): number[] => at.slice(1).map((time, i) => time - at[i]!) };
}
/** Advance the fake clock in small steps until `count` requests were made (or the bound is spent). */
async function until(at: readonly number[], count: number, boundMs = 120_000): Promise<void> {
  for (let spent = 0; at.length < count && spent < boundMs; spent += 250) await vi.advanceTimersByTimeAsync(250);
}

describe("[PR-L7] the pump transport's idle backoff (the worker process's side)", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("1. the wait after the n-th consecutive empty answer: 1 s, 2 s, 4 s, then the 8 s ceiling; a ceiling below the first wait is the first wait", () => {
    expect(PUMP_IDLE_MAX_MS).toBe(8_000);
    expect(PUMP_HOLD_MAX_MS).toBe(PUMP_IDLE_MAX_MS); // the server never holds longer than the client's ceiling
    expect([1, 2, 3, 4, 5, 6, 50, 10_000].map((streak) => pumpIdleWaitMs(streak, 1_000))).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000, 8_000]);
    expect(pumpIdleWaitMs(0, 1_000)).toBe(1_000);
    expect([1, 2, 3].map((streak) => pumpIdleWaitMs(streak, 500, 1_500))).toEqual([500, 1_000, 1_500]);
    expect(pumpIdleWaitMs(4, 2_000, 1_000)).toBe(2_000);
  });

  it("2. a server that does not hold: the gaps double to the ceiling, a settled slice is followed at once by the next request and resets the wait; a minute of idling is ten requests, not sixty", async () => {
    const { transport, at, holds, gaps } = scripted(["empty", "empty", "empty", "empty", "empty", "empty", "slice"]);
    transport.start();
    await until(at, 10);
    expect(gaps().slice(0, 9)).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 0, 1_000, 2_000]);
    expect(holds.every((hold) => hold === 0)).toBe(true); // no hold is asked of a server that never answered heldMs
    await transport.stop({ graceMs: 0 });
    const idle = scripted([]);
    idle.transport.start();
    const from = Date.now();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(idle.at.filter((time) => time - from < 60_000).map((time) => time - from)).toEqual([0, 1_000, 3_000, 7_000, 15_000, 23_000, 31_000, 39_000, 47_000, 55_000]);
    await idle.transport.stop({ graceMs: 0 });
  });

  it("3. a failed request keeps its own backoff (2 s after the first failure); once the server answers again the idle wait starts over at 1 s", async () => {
    const { transport, at, gaps } = scripted(["empty", "empty", "empty", "empty", "fail", "empty", "empty"]);
    transport.start();
    await until(at, 8);
    expect(gaps().slice(0, 7)).toEqual([1_000, 2_000, 4_000, 8_000, 2_000, 1_000, 2_000]);
    await transport.stop({ graceMs: 0 });
  });

  it("4. stop() wakes a worker sleeping at the ceiling at once: no request after it, nothing left in flight", async () => {
    const { transport, at } = scripted([]);
    transport.start();
    await until(at, 5); // the fifth request: the worker now sleeps the 8 s ceiling
    const made = at.length;
    await vi.advanceTimersByTimeAsync(1_000);
    let stopped = false;
    const stopping = transport.stop({ graceMs: 0 }).then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(at.length).toBe(made);
    expect(transport.health()).toMatchObject({ mode: "pump", running: 0, stopping: true });
  });

  it("5. a holding server: the client sleeps nothing and asks the doubling as holds; work arriving during a hold is answered at once, and the next request asks no hold", async () => {
    const from = Date.now();
    const { transport, at, holds, gaps } = scripted([], { holding: true, workAt: from + 20_000 });
    transport.start();
    await until(at, 9);
    // requests at 0 (no hold), 0 (+1 s), 1 s (+2 s), 3 s (+4 s), 7 s (+8 s), 15 s (+8 s; the work at 20 s answers it after 5 s), then at once
    expect(holds.slice(0, 9)).toEqual([0, 1_000, 2_000, 4_000, 8_000, 8_000, 0, 1_000, 2_000]);
    expect(at.slice(0, 7).map((time) => time - from)).toEqual([0, 0, 1_000, 3_000, 7_000, 15_000, 20_000]);
    expect(gaps()[5]).toBe(5_000); // the pickup: the slice is answered the instant the work arrives, not at the end of the 8 s hold
    const stopping = transport.stop({ graceMs: 0 }); // a request is held: stop() aborts it after the grace (the stub answers when its hold is spent)
    await vi.advanceTimersByTimeAsync(PUMP_HOLD_MAX_MS);
    await stopping;
  });
});

describe("[PR-L7] the idle hold (the server's side)", () => {
  const EMPTY: PumpedSliceAnswer = { tick: { at: "2026-10-20T12:00:00.000Z", claims: [], started: [] }, ran: null };
  const RAN = { tick: EMPTY.tick, ran: { kind: "plan", sliceId: "s1", outcome: "planned", detail: "x" } } as unknown as PumpedSliceAnswer;
  const now = (): number => performance.now();

  it("6. pumpHoldMsOf reads a positive integer up to 8 s; the work signal wakes on notify, at once when the version moved, never on timeout or abort; runHeldPumpedSlice re-ticks only when woken and keeps holding after a wake that found nothing", async () => {
    expect([undefined, "", "0", "-5", "1.5", "abc", "08", "250", "8000", "9000", "99999999"].map(pumpHoldMsOf)).toEqual([0, 0, 0, 0, 0, 0, 0, 250, 8_000, 8_000, 0]);
    const work = createFixtureWorkSignal();
    const since = work.version();
    setTimeout(() => work.notify(), 30);
    expect(await work.wait(5_000, { since })).toBe(true);
    expect(await work.wait(5_000, { since })).toBe(true); // the version already moved past `since`: at once
    expect(await work.wait(40, { since: work.version() })).toBe(false);
    const aborted = new AbortController();
    setTimeout(() => aborted.abort(), 20);
    expect(await work.wait(5_000, { since: work.version(), signal: aborted.signal })).toBe(false);
    // no signal in this process: one tick, no hold, no heldMs
    let runs = 0;
    expect(await runHeldPumpedSlice({ run: async () => { runs += 1; return EMPTY; }, holdMs: 8_000, work: null, now })).toEqual(EMPTY);
    expect(runs).toBe(1);
    // a signal and a hold: an irrelevant commit at 30 ms re-ticks (still nothing) and the request keeps holding the rest; the work
    // committed at 120 ms is run at once
    runs = 0;
    const answers = [EMPTY, EMPTY, RAN];
    setTimeout(() => work.notify(), 30);
    setTimeout(() => work.notify(), 120);
    const held = await runHeldPumpedSlice({ run: async () => answers[runs++]!, holdMs: 5_000, work, now });
    expect(held.ran).toEqual(RAN.ran); // a spent hold never re-ticks: the slice ran only because the second commit woke the request
    expect(runs).toBe(3);
    expect(held.heldMs).toBeGreaterThanOrEqual(100);
    // a hold that is spent: one tick, heldMs about the hold; a hold of 0: heldMs 0 (the client learns that this server holds)
    runs = 0;
    const spent = await runHeldPumpedSlice({ run: async () => { runs += 1; return EMPTY; }, holdMs: 60, work, now });
    expect([runs, spent.ran, spent.heldMs! >= 50]).toEqual([1, null, true]);
    expect((await runHeldPumpedSlice({ run: async () => EMPTY, holdMs: 0, work, now })).heldMs).toBe(0);
    // work committed WHILE the tick ran (after the version was read) wakes the wait at once
    runs = 0;
    const raced = await runHeldPumpedSlice({ run: async () => { runs += 1; if (runs === 1) work.notify(); return runs === 1 ? EMPTY : RAN; }, holdMs: 5_000, work, now });
    expect([runs, raced.ran !== null, raced.heldMs! < 1_000]).toEqual([2, true, true]);
  });
});

describe("[PR-L7] through the real start and pump routes under the fixture runtime", () => {
  const SECRET = ["l7", "pump", "hold", "secret", "for", "tests"].join("-");
  const pumpReq = (hold?: number): Request => new Request(`http://localhost/api/generation-worker${hold ? `?hold=${hold}` : ""}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
  beforeEach(() => {
    vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", SECRET);
  });
  afterEach(async () => {
    const { resetFixtureContainer } = await import("@/app/lib/fixture-runtime/container");
    const { resetInjectedIdentity } = await import("@/app/lib/auth/test-support");
    resetInjectedIdentity();
    resetFixtureContainer();
    vi.unstubAllEnvs();
  });

  it("7. an idle held request is answered when its hold is spent; a Start wakes a held request at once and the plan slice runs in it", { timeout: 60_000 }, async () => {
    const { injectAuthorizedPrincipal } = await import("@/app/lib/auth/test-support");
    const { POST: start } = await import("@/app/api/generation-tasks/route");
    const { POST: pump } = await import("@/app/api/generation-worker/route");
    const { BLINKER_ACCEPTANCE_PROMPT } = await import("@/app/lib/fixture-runtime/blinker/catalog");
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-l7", role: "editor" });
    // without a hold: answered at once, heldMs 0 (this server holds); an idle hold of 300 ms is spent and answered empty
    expect(await (await pump(pumpReq())).json()).toMatchObject({ ok: true, ran: null, heldMs: 0 });
    const idle = await (await pump(pumpReq(300))).json();
    expect(idle).toMatchObject({ ok: true, ran: null });
    expect(idle.heldMs).toBeGreaterThanOrEqual(250);
    // a held request (8 s) is waiting; the Start commits the task with its plan slice, and the held request runs it at once (a spent
    // hold never re-ticks, so a plan slice in this answer is the wake's)
    const held = pump(pumpReq(8_000)).then(async (response) => ({ body: await response.json() }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const accepted = await start(new Request("http://localhost/api/generation-tasks", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-l7", "x-sirkit-branch-id": "main" }, body: JSON.stringify({ clientRequestId: "00000000-0000-4000-8000-0000000007a1", prompt: BLINKER_ACCEPTANCE_PROMPT, provider: "openai", base: { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin" } }) }));
    expect(accepted.status).toBe(202);
    const answered = await held;
    expect(answered.body).toMatchObject({ ok: true, ran: { kind: "plan", outcome: "planned" } });
    expect(answered.body.heldMs).toBeGreaterThanOrEqual(100);
    expect(answered.body.heldMs).toBeLessThan(8_000);
  });
});
