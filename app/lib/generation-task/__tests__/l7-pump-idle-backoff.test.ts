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
 *
 * [PR-L7 verify, 2026-10-20] The review round's cases (L7-HOLD-1 to -8), each red without its fix or against the mutation it names:
 *  5. (amended) the stub honours the request's signal, so stop() with no grace must ABORT the held request - it settles before any
 *     further time passes (red if stop() or post() drop the abort);
 *  8. the client never asks more hold than a server holds (`PUMP_HOLD_MAX_MS`) and sleeps the part of an asked hold the answer says
 *     was not kept: a server that answers `heldMs` without holding gets the plain backoff, not a tight loop (L7-HOLD-3);
 *  9. stop() while an idle request is held: the request ends with its hold, inside the default grace, nothing aborted (L7-HOLD-8);
 * 10. under fake timers: no timer, waiter or abort listener outlives a woken, aborted or timed-out wait; an abort mid-hold ends
 *     `runHeldPumpedSlice` at once with no further tick; a request gone before its hold is never held; a request that never waited
 *     answers `heldMs: 0` exactly, even on a clock that moved between its two reads (L7-HOLD-1, L7-HOLD-5);
 * 11. through the real route: a held request whose request goes away is answered at once - the hold's own timer is fake, so only the
 *     abort can end it - and leaves nothing behind (L7-HOLD-1);
 * 12. the container's nudge: only a commit with an effect on a topic the pump claims wakes it (never an audit effect, never a
 *     replay), and a slice re-queued for now wakes it too; a re-queue for later or a terminal failure does not (L7-HOLD-2, -7).
 * Timing (L7-HOLD-6): the `heldMs` assertions read a duration measured in production code, which the B24-D1 threshold census cannot
 * see; their upper bounds (case 6 `< 1_000`, case 7 `< 8_000`) were removed as redundant with the ordering proofs (a spent hold never
 * re-ticks), and the lower bounds that remain are ordering proofs too. Case 7 keeps two real-clock dependencies: its 8 s hold (a Start
 * slower than about 7.85 s would fail it) and the 150 ms sleep before the Start.
 */
import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUMP_IDLE_MAX_MS, createPumpTransport, pumpIdleWaitMs } from "../worker/pump-transport";
import { PUMP_HOLD_MAX_MS, pumpHoldMsOf, runHeldPumpedSlice, type PumpedSliceAnswer } from "../worker/runtime";
import { createFixtureWorkSignal } from "../../fixture-runtime/container";

type Answer = "empty" | "slice" | "fail";
const SLICE = { kind: "plan", sliceId: "generation-task:l7-backoff:s1", outcome: "planned", state: "queued", detail: "planned 1 block(s)" };

/** A pump transport over a stub fetch that answers `script` in order (then empty), recording the fake clock at every request; a
 *  `holding` server waits the asked hold (unless `workAt` falls inside it: then it answers the slice at that instant) and answers `heldMs`.
 *  [PR-L7 verify, 2026-10-20] The holding stub reads the hold as the route does (`pumpHoldMsOf`), honours the request's signal (an abort
 *  ends the hold with an AbortError, counted by `aborted()`), and an `"unkept"` server answers `heldMs: 0` at once whatever it was asked
 *  (from its 51st request it fails with a 503, so a client that never sleeps stops at its failure backoff - a fake timer - instead of
 *  spinning the microtask queue forever). */
function scripted(script: readonly Answer[], options: { holding?: boolean | "unkept"; workAt?: number; idleMaxMs?: number } = {}) {
  const at: number[] = [];
  const holds: number[] = [];
  let index = 0;
  let aborts = 0;
  let workAt = options.workAt;
  const body = (answer: Answer, heldMs: number | null) => ({ ok: true, tick: { at: new Date().toISOString(), claims: [], started: answer === "slice" ? [SLICE.sliceId] : [] }, ran: answer === "slice" ? SLICE : null, ...(heldMs === null ? {} : { heldMs }) });
  const fetch = (async (url: string, init?: RequestInit) => {
    const started = Date.now();
    at.push(started);
    const asked = new URL(url).searchParams.get("hold");
    holds.push(Number(asked ?? 0));
    const hold = pumpHoldMsOf(asked ?? undefined); // [PR-L7 verify, 2026-10-20] the route's own parse: at most 8 s, an 8-digit hold is none
    const answer = script[index++] ?? "empty";
    if (answer === "fail" || (options.holding === "unkept" && at.length > 50)) return { ok: false, status: 503, json: async () => ({ ok: false, code: "GENERATION_TASK_STORE_UNAVAILABLE" }) };
    if (!options.holding) return { ok: true, status: 200, json: async () => body(answer, null) };
    if (options.holding === "unkept") return { ok: true, status: 200, json: async () => body(answer, 0) };
    if (answer === "empty" && hold > 0) {
      const wake = workAt !== undefined && workAt >= started && workAt < started + hold ? workAt - started : null;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, wake ?? hold);
        init?.signal?.addEventListener("abort", () => { clearTimeout(timer); aborts += 1; reject(new DOMException("The pump request was aborted.", "AbortError")); }, { once: true }); // [PR-L7 verify, 2026-10-20]
      });
      if (wake !== null) { workAt = undefined; return { ok: true, status: 200, json: async () => body("slice", wake) }; }
      return { ok: true, status: 200, json: async () => body("empty", hold) };
    }
    return { ok: true, status: 200, json: async () => body(answer, 0) };
  }) as unknown as typeof globalThis.fetch;
  const transport = createPumpTransport({ origin: "http://localhost:3999", workerId: "w-l7-backoff", secret: "l7-backoff-test-only", fetch, ...(options.idleMaxMs !== undefined ? { idleMaxMs: options.idleMaxMs } : {}) });
  return { transport, at, holds, aborted: (): number => aborts, gaps: (): number[] => at.slice(1).map((time, i) => time - at[i]!) };
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
    const { transport, at, holds, aborted, gaps } = scripted([], { holding: true, workAt: from + 20_000 });
    transport.start();
    await until(at, 9);
    // requests at 0 (no hold), 0 (+1 s), 1 s (+2 s), 3 s (+4 s), 7 s (+8 s), 15 s (+8 s; the work at 20 s answers it after 5 s), then at once
    expect(holds.slice(0, 9)).toEqual([0, 1_000, 2_000, 4_000, 8_000, 8_000, 0, 1_000, 2_000]);
    expect(at.slice(0, 7).map((time) => time - from)).toEqual([0, 0, 1_000, 3_000, 7_000, 15_000, 20_000]);
    expect(gaps()[5]).toBe(5_000); // the pickup: the slice is answered the instant the work arrives, not at the end of the 8 s hold
    // [PR-L7 verify, 2026-10-20] L7-HOLD-1: the ninth request is held (2 s, from 21 s); stop() with no grace ABORTS it - the stub honours
    // the request's signal - so stop() settles before any further time passes (it waited out the stub's hold before)
    let stopped = false;
    const stopping = transport.stop({ graceMs: 0 }).then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect([stopped, aborted(), at.length, Date.now() - from]).toEqual([true, 1, 9, 21_000]);
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
    expect([runs, raced.ran !== null]).toEqual([2, true]); // [PR-L7 verify, 2026-10-20] L7-HOLD-6: was also `raced.heldMs! < 1_000`, a real-clock bound the census cannot see; a missed version would leave the 5 s hold to time out with runs 1
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
    expect(answered.body.heldMs).toBeGreaterThanOrEqual(100); // [PR-L7 verify, 2026-10-20] L7-HOLD-6: the `< 8_000` upper bound that followed is removed - `ran: plan` above already proves the wake (a spent hold never re-ticks)
  });
});

// ── [PR-L7 verify, 2026-10-20] The review round's regression cases (8-12) ─────────────────────────────────────────────────────────

describe("[PR-L7 verify] the transport against a server that does not keep the hold it answers, and stop() while an idle request is held", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("8. the client never asks more hold than a server holds and sleeps the part of an asked hold the server did not keep: a server answering heldMs without holding gets the plain backoff, never a tight loop", async () => {
    // L7-HOLD-3: a server that answers heldMs 0 at once whatever it was asked (or a proxy that drops the query string)
    const unkept = scripted([], { holding: "unkept" });
    unkept.transport.start();
    await until(unkept.at, 7);
    expect(unkept.holds.slice(0, 7)).toEqual([0, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
    expect(unkept.gaps().slice(0, 6)).toEqual([0, 1_000, 2_000, 4_000, 8_000, 8_000]); // the doubling, slept here (all 0 before the fix)
    const unkeptStopping = unkept.transport.stop({ graceMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await unkeptStopping;
    // a ceiling far above what a server holds: the hold asked stays at PUMP_HOLD_MAX_MS (asked 16 s, 32 s, ... before the fix; at
    // 10,000,000 ms the route's parse reads no hold at all, and the answer came back at once)
    const high = scripted([], { holding: true, idleMaxMs: 10_000_000 });
    high.transport.start();
    await until(high.at, 8);
    expect(high.holds.slice(0, 8)).toEqual([0, 1_000, 2_000, 4_000, PUMP_HOLD_MAX_MS, PUMP_HOLD_MAX_MS, PUMP_HOLD_MAX_MS, PUMP_HOLD_MAX_MS]);
    expect(high.gaps().slice(0, 7)).toEqual([0, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
    const highStopping = high.transport.stop({ graceMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await highStopping;
    expect(high.aborted()).toBe(1); // the eighth request was held when stop() came: aborted at the (zero) grace
  });

  it("9. stop() while an idle request is held: the request is in flight, not asleep, so it ends with its hold - inside the default grace, nothing aborted; stopping an idle worker against a holding server takes up to PUMP_HOLD_MAX_MS", async () => {
    // L7-HOLD-8: the behaviour the transport's header now states
    const from = Date.now();
    const { transport, at, holds, aborted } = scripted([], { holding: true });
    transport.start();
    await until(at, 5); // the fifth request (at 7 s) asks the 8 s hold
    expect([holds[4], at[4]! - from]).toEqual([PUMP_HOLD_MAX_MS, 7_000]);
    let stopped = false;
    const stopping = transport.stop().then(() => { stopped = true; }); // the default grace: 10 s
    await vi.advanceTimersByTimeAsync(PUMP_HOLD_MAX_MS - 1);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect([stopped, aborted(), at.length]).toEqual([true, 0, 5]);
    await stopping;
  });
});

describe("[PR-L7 verify] the hold ends at an abort, and no wait outlives itself (fake timers)", () => {
  const EMPTY: PumpedSliceAnswer = { tick: { at: "2026-10-20T12:00:00.000Z", claims: [], started: [] }, ran: null };
  const RAN = { tick: EMPTY.tick, ran: { kind: "plan", sliceId: "s1", outcome: "planned", detail: "x" } } as unknown as PumpedSliceAnswer;
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("10. a woken, an aborted and a timed-out wait leave no timer, waiter or abort listener; an abort mid-hold ends runHeldPumpedSlice at once with no further tick; a request gone before its hold is never held; a request that never waited answers heldMs 0 exactly", async () => {
    const work = createFixtureWorkSignal();
    const now = (): number => Date.now();
    const baseline = vi.getTimerCount();
    /** pending timers above the baseline, pending waits, abort listeners on `signal` */
    const live = (signal?: AbortSignal): number[] => [vi.getTimerCount() - baseline, work.waiting(), signal ? getEventListeners(signal, "abort").length : 0];
    // L7-HOLD-1 (3): a woken wait
    const request = new AbortController();
    const woken = work.wait(5_000, { since: work.version(), signal: request.signal });
    expect(live(request.signal)).toEqual([1, 1, 1]);
    work.notify();
    expect(await woken).toBe(true);
    expect(live(request.signal)).toEqual([0, 0, 0]);
    // an aborted wait
    const aborted = work.wait(5_000, { since: work.version(), signal: request.signal });
    expect(live(request.signal)).toEqual([1, 1, 1]);
    request.abort();
    expect(await aborted).toBe(false);
    expect(live(request.signal)).toEqual([0, 0, 0]);
    // a wait whose time runs out
    const timedOut = work.wait(100, { since: work.version() });
    expect(live()).toEqual([1, 1, 0]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await timedOut).toBe(false);
    expect(live()).toEqual([0, 0, 0]);
    // L7-HOLD-1 (1): an abort mid-hold ends the hold at once - one tick, no re-tick, answered before any further time passes
    let runs = 0;
    const midHold = new AbortController();
    const answers: Array<PumpedSliceAnswer & { heldMs?: number }> = [];
    void runHeldPumpedSlice({ run: async () => { runs += 1; return EMPTY; }, holdMs: 5_000, work, now, signal: midHold.signal }).then((answer) => { answers.push(answer); });
    await vi.advanceTimersByTimeAsync(20);
    expect([answers.length, ...live(midHold.signal)]).toEqual([0, 1, 1, 1]); // held
    midHold.abort();
    await vi.advanceTimersByTimeAsync(0); // no time passes: only the abort can end the hold here
    expect(answers).toEqual([{ ...EMPTY, heldMs: 20 }]);
    expect([runs, ...live(midHold.signal)]).toEqual([1, 0, 0, 0]);
    // a request already gone: one tick and no hold, even when work was committed while that tick ran
    runs = 0;
    const gone = new AbortController();
    gone.abort();
    const early = await runHeldPumpedSlice({ run: async () => { runs += 1; if (runs === 1) work.notify(); return EMPTY; }, holdMs: 5_000, work, now, signal: gone.signal });
    expect([runs, early.ran, early.heldMs]).toEqual([1, null, 0]);
    // L7-HOLD-5: a request that never waited answers heldMs 0 exactly, on a clock that moves between every two reads
    let reads = 0;
    const stepping = (): number => (reads += 1);
    expect((await runHeldPumpedSlice({ run: async () => EMPTY, holdMs: 0, work, now: stepping })).heldMs).toBe(0);
    expect((await runHeldPumpedSlice({ run: async () => RAN, holdMs: 5_000, work, now: stepping })).heldMs).toBe(0);
    expect(live()).toEqual([0, 0, 0]);
  });
});

describe("[PR-L7 verify] under the fixture runtime: an aborted held request and the container's nudge", () => {
  const SECRET = ["l7", "pump", "verify", "secret", "for", "tests"].join("-");
  beforeEach(() => {
    vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", SECRET);
  });
  afterEach(async () => {
    vi.useRealTimers();
    const { resetFixtureContainer } = await import("@/app/lib/fixture-runtime/container");
    const { resetInjectedIdentity } = await import("@/app/lib/auth/test-support");
    resetInjectedIdentity();
    resetFixtureContainer();
    vi.unstubAllEnvs();
  });

  it("11. a held pump request whose request goes away is answered at once - its hold's own timer is fake, so only the abort can end it - with no further tick, and leaves no wait, timer or listener behind", { timeout: 60_000 }, async () => {
    const { injectAuthorizedPrincipal } = await import("@/app/lib/auth/test-support");
    const { POST: pump } = await import("@/app/api/generation-worker/route");
    const { fixtureContainer } = await import("@/app/lib/fixture-runtime/container");
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-l7", role: "editor" });
    const request = (hold: number, signal?: AbortSignal): Request => new Request(`http://localhost/api/generation-worker${hold ? `?hold=${hold}` : ""}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, ...(signal ? { signal } : {}) });
    expect(await (await pump(request(0))).json()).toMatchObject({ ok: true, ran: null, heldMs: 0 }); // the container and the route, warmed on real timers
    const { work } = fixtureContainer();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // Date stays the fixture's own clock
    const baseline = vi.getTimerCount();
    const gone = new AbortController();
    const answers: Array<Record<string, unknown>> = [];
    void pump(request(PUMP_HOLD_MAX_MS, gone.signal)).then(async (response) => { answers.push(await response.json() as Record<string, unknown>); });
    for (let turn = 0; turn < 10_000 && work.waiting() === 0; turn += 1) await vi.advanceTimersByTimeAsync(0); // real event-loop turns with no fake time passing; the loop ends as soon as the request is held
    expect([work.waiting(), answers.length], "the request is held").toEqual([1, 0]);
    gone.abort();
    for (let turn = 0; turn < 10_000 && answers.length === 0; turn += 1) await vi.advanceTimersByTimeAsync(0);
    expect(answers).toEqual([expect.objectContaining({ ok: true, ran: null })]);
    expect([work.waiting(), vi.getTimerCount() - baseline]).toEqual([0, 0]);
  });

  it("12. the container's nudge: a commit wakes held requests only when it has an effect on a topic the pump claims (never an audit effect, never a replay), and a slice re-queued for now wakes them too; a re-queue for later or a terminal failure does not", async () => {
    const { fixtureContainer, FIXTURE_PUMP_TOPICS } = await import("@/app/lib/fixture-runtime/container");
    const { GENERATION_SLICE_TOPIC } = await import("@/app/lib/generation-task/contracts");
    const { COMPONENT_RESOLUTION_SLICE_TOPIC } = await import("@/app/lib/component-resolution/task/contracts");
    expect(FIXTURE_PUMP_TOPICS).toEqual([GENERATION_SLICE_TOPIC, COMPONENT_RESOLUTION_SLICE_TOPIC]); // the topics claimSlices and componentResolutionTopic claim
    const { durableRepository: repository, work } = fixtureContainer();
    const scope = { tenantId: "local", projectId: "proj-l7-nudge", branchId: "main" };
    const owner = { aggregateType: "l7.nudge", aggregateKey: "a" };
    const AT = "2026-10-20T12:00:00.000Z";
    const LATER = "2026-10-20T12:00:30.000Z";
    let revision = 0;
    /** commit one effect on `topic` under `key`; did the work signal move? */
    const commit = async (topic: string, key: string): Promise<boolean> => {
      const before = work.version();
      const committed = await repository.commit({ scope, scopeKey: "l7-nudge", idempotencyKey: key, operations: [{ ...owner, expectedRevision: revision, payload: { key } }], outbox: [{ owner, eventType: "l7.nudge", eventVersion: 1, topic, payload: { key } }], result: {}, committedAt: AT });
      if (!committed.idempotent) revision += 1;
      return work.version() !== before;
    };
    // L7-HOLD-7: the audit effects the pump never claims (an execution grant's, an autonomy change's) wake nothing
    expect(await commit("agent.execution-grant-issued", "grant")).toBe(false);
    expect(await commit("agent.autonomy-changed", "autonomy")).toBe(false);
    expect(await commit(GENERATION_SLICE_TOPIC, "generation")).toBe(true);
    expect(await commit(COMPONENT_RESOLUTION_SLICE_TOPIC, "resolution")).toBe(true);
    expect(await commit(GENERATION_SLICE_TOPIC, "generation")).toBe(false); // the same commit replayed: nothing new to claim
    expect(revision).toBe(4);
    /** claim the one pending event on `topic`, then fail it; did the work signal move? */
    const requeue = async (topic: string, retryAt: string, terminal: boolean): Promise<boolean> => {
      const claimed = await repository.claimOutbox({ workerId: "w-l7-nudge", now: AT, leaseUntil: LATER, limit: 1, topics: [topic], scope });
      expect(claimed.map((event) => event.topic)).toEqual([topic]);
      const before = work.version();
      await repository.failOutbox({ scope, eventId: claimed[0]!.eventId, workerId: "w-l7-nudge", leaseToken: claimed[0]!.leaseToken!, errorCode: "L7_NUDGE_TEST", failedAt: AT, retryAt, terminal });
      return work.version() !== before;
    };
    // L7-HOLD-2: a slice released for immediate takeover (releaseSlice: retryAt = now) is claimable at once, with no commit carrying effects
    expect(await requeue(GENERATION_SLICE_TOPIC, AT, false)).toBe(true);
    expect(await requeue(GENERATION_SLICE_TOPIC, LATER, false)).toBe(false); // a not-before still ahead: nothing claimable now
    expect(await requeue(COMPONENT_RESOLUTION_SLICE_TOPIC, AT, true)).toBe(false); // terminal: nothing to claim
  });
});
