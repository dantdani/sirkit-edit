/**
 * [B19-B I3b] The quota meters, the circuit breaker and the coalescer on their own, with an explicit clock.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { currentPause, makeCoalescer, recordOutcome, requestAdmission, resetAdmissionControl, windowEnd, windowStart } from "../admission-control";
import { SOURCE_REGISTRY } from "../source-registry";

const T0 = Date.UTC(2026, 8, 30, 23, 59, 10); // 2026-09-30T23:59:10Z: the last minute of a day and of a month

beforeEach(() => resetAdmissionControl());

describe("[B19-B I3b] windows are the calendar the vendors count in", () => {
  it("minute, UTC day and UTC month boundaries", () => {
    expect(new Date(windowStart("minute", T0)).toISOString()).toBe("2026-09-30T23:59:00.000Z");
    expect(new Date(windowEnd("minute", windowStart("minute", T0))).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(new Date(windowStart("day", T0)).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(new Date(windowEnd("day", windowStart("day", T0))).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(new Date(windowStart("month", T0)).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(new Date(windowEnd("month", windowStart("month", T0))).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(new Date(windowEnd("month", Date.UTC(2026, 11, 1))).toISOString(), "December rolls into the next year").toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("[B19-B I3b] quotas", () => {
  it("every window is enforced: DigiKey's day holds even when each minute is fresh", () => {
    let now = Date.UTC(2026, 8, 13, 0, 0, 0);
    let allowed = 0;
    for (let minute = 0; minute < 10; minute++) {
      for (let i = 0; i < 120; i++) if (requestAdmission("digikey", 1, now).allowed) allowed += 1;
      now += 60_000;
    }
    expect(allowed, "1000 a day, even though ten minutes allow 1200").toBe(1000);
    const refused = requestAdmission("digikey", 1, now);
    expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: Date.UTC(2026, 8, 14) });
  });

  it("a refused request reserves nothing, and cost 0 never consumes quota", () => {
    for (let i = 0; i < 120; i++) requestAdmission("digikey", 1, T0);
    expect(requestAdmission("digikey", 1, T0).allowed).toBe(false);
    expect(requestAdmission("digikey", 0, T0), "a token request is not a product request").toEqual({ allowed: true });
    expect(requestAdmission("digikey", 1, T0 + 60_000).allowed, "the next minute opens (the day still has room)").toBe(true);
  });

  it("Nexar counts matched parts per month and resets on the 1st", () => {
    expect(requestAdmission("octopart", 2000, T0).allowed).toBe(true);
    expect(requestAdmission("octopart", 1, T0)).toMatchObject({ allowed: false, reason: "quota_exhausted" });
    expect(requestAdmission("octopart", 1, Date.UTC(2026, 9, 1)).allowed).toBe(true);
  });
});

describe("[B19-B I3b] the circuit breaker", () => {
  const { consecutiveFailuresToOpen, openMs } = SOURCE_REGISTRY.digikey.resilience.breaker;

  function fail(times: number, at: number): void {
    for (let i = 0; i < times; i++) {
      expect(requestAdmission("digikey", 0, at).allowed).toBe(true);
      recordOutcome("digikey", "failure", at);
    }
  }

  it("opens after the registered number of consecutive failures, and a success in between resets the count", () => {
    fail(consecutiveFailuresToOpen - 1, T0);
    requestAdmission("digikey", 0, T0);
    recordOutcome("digikey", "success", T0);
    fail(consecutiveFailuresToOpen - 1, T0);
    expect(requestAdmission("digikey", 0, T0).allowed, "still closed").toBe(true);
    recordOutcome("digikey", "failure", T0);
    expect(requestAdmission("digikey", 0, T0)).toMatchObject({ allowed: false, reason: "breaker_open", retryAtMs: T0 + openMs });
    expect(currentPause("digikey", T0)?.message).toMatch(/paused after repeated failures/);
  });

  it("after the open period exactly one trial goes; its failure re-opens, its success closes", () => {
    fail(consecutiveFailuresToOpen, T0);
    const later = T0 + openMs;
    expect(requestAdmission("digikey", 0, later).allowed, "the trial").toBe(true);
    expect(requestAdmission("digikey", 0, later).allowed, "nothing else while the trial is out").toBe(false);
    recordOutcome("digikey", "failure", later);
    expect(requestAdmission("digikey", 0, later + 1).allowed, "one failed trial re-opens at once").toBe(false);

    const muchLater = later + openMs;
    expect(requestAdmission("digikey", 0, muchLater).allowed).toBe(true);
    recordOutcome("digikey", "success", muchLater);
    expect(requestAdmission("digikey", 0, muchLater).allowed).toBe(true);
    expect(currentPause("digikey", muchLater)).toBeNull();
  });

  it("a 429 opens it at once; a neutral answer (a 4xx that is not a failure) never counts", () => {
    requestAdmission("mouser", 1, T0);
    recordOutcome("mouser", "rate_limited", T0);
    expect(requestAdmission("mouser", 1, T0)).toMatchObject({ allowed: false, reason: "breaker_open" });

    for (let i = 0; i < 20; i++) {
      requestAdmission("octopart", 1, T0);
      recordOutcome("octopart", "neutral", T0);
    }
    expect(currentPause("octopart", T0)).toBeNull();
  });

  it("breakers are per source", () => {
    fail(consecutiveFailuresToOpen, T0);
    expect(requestAdmission("octopart", 1, T0).allowed).toBe(true);
  });
});

describe("[B19-B I3b] coalescing", () => {
  it("a second identical call joins the first, and the key is free again once it settles — rejection included", async () => {
    const coalesce = makeCoalescer<number>();
    let runs = 0;
    let release: (value: number) => void = () => undefined;
    const first = coalesce("k", () => { runs += 1; return new Promise<number>((resolve) => { release = resolve; }); });
    const second = coalesce("k", () => { runs += 1; return Promise.resolve(-1); });
    release(7);
    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(runs).toBe(1);

    await expect(coalesce("k", () => { runs += 1; return Promise.reject(new Error("vendor down")); })).rejects.toThrow("vendor down");
    expect(await coalesce("k", () => { runs += 1; return Promise.resolve(8); })).toBe(8);
    expect(runs).toBe(3);
  });
});
