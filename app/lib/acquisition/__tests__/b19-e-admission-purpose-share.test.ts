/**
 * [B19-E E2] A per-purpose share of each source's quota (OD-40): the agent purpose may spend at most 25% of every window a
 * source registers, while an interactive search by a person still admits up to the whole window. Meters are per process.
 */
import { afterEach, describe, expect, it } from "vitest";
import { currentPause, previewAdmission, PURPOSE_QUOTA_SHARE, requestAdmission, resetAdmissionControl } from "../admission-control";

const T0 = Date.UTC(2026, 8, 13, 12, 0, 0);

afterEach(() => resetAdmissionControl());

describe("[B19-E E2] the agent purpose is held to its share", () => {
  it("the shares are interactive 1 and agent 0.25", () => {
    expect(PURPOSE_QUOTA_SHARE).toEqual({ interactive: 1, agent: 0.25 });
  });

  it("DigiKey per minute: the agent is refused at 30 of 120 while an interactive request still admits", () => {
    expect(requestAdmission("digikey", 30, T0, "agent")).toEqual({ allowed: true });
    const refused = requestAdmission("digikey", 1, T0, "agent");
    expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: T0 + 60_000 });
    expect(refused.allowed ? "" : refused.message).toMatch(/agent/);
    expect(requestAdmission("digikey", 1, T0, "interactive"), "a person's search still admits").toEqual({ allowed: true });
    expect(requestAdmission("digikey", 89, T0), "the default purpose is interactive").toEqual({ allowed: true });
    expect(requestAdmission("digikey", 1, T0, "interactive"), "the whole window is still the ceiling").toMatchObject({ allowed: false, reason: "quota_exhausted" });
  });

  it("Nexar per month: the agent may reserve 500 matched parts of 2000, never 501", () => {
    expect(requestAdmission("octopart", 496, T0, "agent")).toEqual({ allowed: true });
    expect(requestAdmission("octopart", 5, T0, "agent"), "496 + 5 > 500").toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: Date.UTC(2026, 9, 1) });
    expect(requestAdmission("octopart", 4, T0, "agent")).toEqual({ allowed: true });
    expect(requestAdmission("octopart", 5, T0, "interactive")).toEqual({ allowed: true });
  });

  it("interactive use counts against the whole window the agent shares", () => {
    expect(requestAdmission("digikey", 100, T0, "interactive")).toEqual({ allowed: true });
    expect(requestAdmission("digikey", 20, T0, "agent")).toEqual({ allowed: true });
    expect(requestAdmission("digikey", 1, T0, "agent"), "120 of 120 used, though the agent used only 20").toMatchObject({ allowed: false, reason: "quota_exhausted" });
  });

  it("previewAdmission reserves nothing and answers for a cost and a purpose; currentPause answers per purpose", () => {
    expect(previewAdmission("octopart", 5, T0, "agent")).toBeNull();
    expect(requestAdmission("octopart", 498, T0, "agent")).toEqual({ allowed: true });
    expect(previewAdmission("octopart", 3, T0, "agent")).toMatchObject({ reason: "quota_exhausted" });
    expect(previewAdmission("octopart", 2, T0, "agent")).toBeNull();
    expect(previewAdmission("octopart", 2, T0, "agent"), "a preview never reserved the two").toBeNull();
    expect(requestAdmission("octopart", 2, T0, "agent")).toEqual({ allowed: true });
    expect(currentPause("octopart", T0, "agent")).toMatchObject({ reason: "quota_exhausted" });
    expect(currentPause("octopart", T0, "interactive")).toBeNull();
    expect(currentPause("octopart", T0)).toBeNull();
  });
});
