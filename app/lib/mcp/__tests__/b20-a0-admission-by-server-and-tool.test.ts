/**
 * [B20 A0] Admission control generalised to a key: a distributor source (unchanged), or an MCP server with an optional tool.
 * An MCP call is admitted only when the server's minute window AND, where the row defines one, the tool's minute window
 * both admit it; the breaker is per server; the agent purpose is held to its share (OD-40) on both windows; meters stay per
 * process (OD-53). The distributor sources keep their exact outcomes and sentences.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  admissionKeyString,
  currentMcpPause,
  currentPause,
  previewMcpAdmission,
  PURPOSE_QUOTA_SHARE,
  recordMcpOutcome,
  recordOutcome,
  requestAdmission,
  requestMcpAdmission,
  resetAdmissionControl,
} from "../../acquisition/admission-control";
import { SOURCE_REGISTRY } from "../../acquisition/source-registry";
import { MCP_SERVER_LIMIT_BOUNDS, validateMcpServerRegistry } from "../server-registry";
import { fixtureServer, T0 } from "./_fixtures";

afterEach(() => resetAdmissionControl());

const server = fixtureServer(); // 10/minute; search 4/minute; read 10/minute; breaker 3 failures -> 60 s
const other = fixtureServer({ id: "docs-other" });
const MINUTE = 60_000;

describe("[B20 A0] the admission key", () => {
  it("names a distributor source, an MCP server, or one tool of an MCP server", () => {
    expect(admissionKeyString({ kind: "acquisition-source", id: "digikey" })).toBe("acquisition-source:digikey");
    expect(admissionKeyString({ kind: "mcp-server", serverId: "docs-example" })).toBe("mcp-server:docs-example");
    expect(admissionKeyString({ kind: "mcp-server", serverId: "docs-example", tool: "search" })).toBe("mcp-server:docs-example/tool:search");
    // [B21 E1] a reviewed extension of the kind union (OD-115): an LLM provider, with an optional model window - the three kinds above unchanged
    expect(admissionKeyString({ kind: "llm-provider", provider: "openai", model: "gpt-5.6-sol" })).toBe("llm-provider:openai/model:gpt-5.6-sol");
  });

  it("the fixture rows are valid registry rows", () => {
    expect(validateMcpServerRegistry([server, other])).toEqual([]);
  });
});

describe("[B20 A0] the server window", () => {
  it("admits the registered requests per minute and refuses the next one without reserving anything", () => {
    for (let i = 0; i < 10; i++) expect(requestMcpAdmission(server, undefined, 1, T0)).toEqual({ allowed: true });
    const refused = requestMcpAdmission(server, undefined, 1, T0);
    expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: T0 + MINUTE });
    expect(refused.allowed ? "" : refused.message).toMatch(/MCP server "docs-example" is paused: its quota of 10 requests per minute is used up until 2026-09-17T12:01:00.000Z/);
    expect(requestMcpAdmission(server, undefined, 1, T0 + MINUTE), "the next minute opens").toEqual({ allowed: true });
  });

  it("a cost of 0 consumes nothing but still respects the breaker", () => {
    for (let i = 0; i < 10; i++) requestMcpAdmission(server, undefined, 1, T0);
    expect(requestMcpAdmission(server, undefined, 0, T0)).toEqual({ allowed: true });
    expect(requestMcpAdmission(server, "search", 0, T0)).toEqual({ allowed: true });
  });

  it("servers are metered separately from each other and from the distributor sources", () => {
    for (let i = 0; i < 10; i++) requestMcpAdmission(server, undefined, 1, T0);
    expect(requestMcpAdmission(other, undefined, 1, T0)).toEqual({ allowed: true });
    expect(requestAdmission("digikey", 1, T0)).toEqual({ allowed: true });
    for (let i = 0; i < 119; i++) requestAdmission("digikey", 1, T0);
    expect(requestAdmission("digikey", 1, T0).allowed).toBe(false);
    expect(requestMcpAdmission(other, undefined, 1, T0), "a full DigiKey window does not touch an MCP server").toEqual({ allowed: true });
  });
});

describe("[B20 A0] the tool window", () => {
  it("a tool with its own window is refused at that window while the server and other tools still admit", () => {
    for (let i = 0; i < 4; i++) expect(requestMcpAdmission(server, "search", 1, T0)).toEqual({ allowed: true });
    const refused = requestMcpAdmission(server, "search", 1, T0);
    expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: T0 + MINUTE });
    expect(refused.allowed ? "" : refused.message).toMatch(/MCP server "docs-example" tool "search" is paused: its quota of 4 requests per minute/);
    expect(requestMcpAdmission(server, "read", 1, T0), "another tool").toEqual({ allowed: true });
    expect(requestMcpAdmission(server, undefined, 1, T0), "the server itself (6 of 10 used)").toEqual({ allowed: true });
  });

  it("a tool refusal reserves nothing in the server window", () => {
    for (let i = 0; i < 5; i++) requestMcpAdmission(server, "search", 1, T0); // 4 admitted, 1 refused
    for (let i = 0; i < 6; i++) expect(requestMcpAdmission(server, "read", 1, T0), `read ${i}`).toEqual({ allowed: true }); // 4 + 6 = 10
    expect(requestMcpAdmission(server, "read", 1, T0)).toMatchObject({ allowed: false, reason: "quota_exhausted" });
  });

  it("BOTH windows are required: a tool with room is still refused when the server window is full", () => {
    for (let i = 0; i < 2; i++) requestMcpAdmission(server, "search", 1, T0);
    for (let i = 0; i < 8; i++) requestMcpAdmission(server, "read", 1, T0);
    const refused = requestMcpAdmission(server, "search", 1, T0);
    expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted" });
    expect(refused.allowed ? "" : refused.message, "the server window is the one that refused").toMatch(/MCP server "docs-example" is paused/);
    expect(refused.allowed ? "" : refused.message).not.toMatch(/tool "search"/);
  });

  it("a tool the row does not name is metered by the server window only; prototype names are not tool windows", () => {
    for (let i = 0; i < 10; i++) expect(requestMcpAdmission(server, "unnamed", 1, T0)).toEqual({ allowed: true });
    expect(requestMcpAdmission(server, "unnamed", 1, T0)).toMatchObject({ allowed: false, reason: "quota_exhausted" });
    resetAdmissionControl();
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(requestMcpAdmission(server, name, 1, T0), name).toEqual({ allowed: true });
      expect(previewMcpAdmission(server, name, 1, T0), name).toBeNull();
    }
  });
});

describe("[B20 A0] the breaker is per server and covers every tool", () => {
  function fail(entry = server, times = entry.limits.breaker.failureThreshold, at = T0): void {
    for (let i = 0; i < times; i++) {
      expect(requestMcpAdmission(entry, undefined, 0, at).allowed).toBe(true);
      recordMcpOutcome(entry, "failure", at);
    }
  }

  it("opens after the registered failures; a success in between resets the count", () => {
    fail(server, 2);
    requestMcpAdmission(server, undefined, 0, T0);
    recordMcpOutcome(server, "success", T0);
    fail(server, 2);
    expect(requestMcpAdmission(server, undefined, 0, T0).allowed, "still closed").toBe(true);
    recordMcpOutcome(server, "failure", T0);
    const refused = requestMcpAdmission(server, undefined, 0, T0);
    expect(refused).toMatchObject({ allowed: false, reason: "breaker_open", retryAtMs: T0 + 60_000 });
    expect(refused.allowed ? "" : refused.message).toMatch(/MCP server "docs-example" is paused after repeated failures/);
    expect(requestMcpAdmission(server, "search", 1, T0), "a tool call is refused by the server's breaker").toMatchObject({ allowed: false, reason: "breaker_open" });
    expect(currentMcpPause(server, undefined, T0)).toMatchObject({ reason: "breaker_open" });
    expect(currentMcpPause(server, "search", T0)).toMatchObject({ reason: "breaker_open" });
    expect(requestMcpAdmission(other, undefined, 1, T0), "another server is untouched").toEqual({ allowed: true });
    expect(requestAdmission("digikey", 1, T0), "a distributor source is untouched").toEqual({ allowed: true });
  });

  it("after the cooldown exactly one trial goes; its failure re-opens, its success closes", () => {
    fail();
    const later = T0 + 60_000;
    expect(requestMcpAdmission(server, "search", 1, later).allowed, "the trial").toBe(true);
    expect(requestMcpAdmission(server, "read", 1, later).allowed, "nothing else while the trial is out").toBe(false);
    recordMcpOutcome(server, "failure", later);
    expect(requestMcpAdmission(server, undefined, 0, later + 1).allowed, "one failed trial re-opens at once").toBe(false);
    const muchLater = later + 60_000;
    expect(requestMcpAdmission(server, undefined, 0, muchLater).allowed).toBe(true);
    recordMcpOutcome(server, "success", muchLater);
    expect(requestMcpAdmission(server, undefined, 0, muchLater).allowed).toBe(true);
    expect(currentMcpPause(server, undefined, muchLater)).toBeNull();
  });

  it("a rate-limited answer opens it at once; a neutral answer never counts", () => {
    requestMcpAdmission(server, undefined, 1, T0);
    recordMcpOutcome(server, "rate_limited", T0);
    expect(requestMcpAdmission(server, undefined, 1, T0)).toMatchObject({ allowed: false, reason: "breaker_open" });
    for (let i = 0; i < 20; i++) {
      requestMcpAdmission(other, undefined, 0, T0);
      recordMcpOutcome(other, "neutral", T0);
    }
    expect(currentMcpPause(other, undefined, T0)).toBeNull();
  });
});

describe("[B20 A0] the agent purpose is held to its share on both windows (OD-40)", () => {
  const wide = fixtureServer({ id: "docs-wide", limits: { ...server.limits, requestsPerMinute: 20, perTool: { search: { requestsPerMinute: 4 } } } }); // agent: 5 server, 1 search

  it("server window: the agent is refused at 25% while an interactive request still admits", () => {
    expect(PURPOSE_QUOTA_SHARE).toEqual({ interactive: 1, agent: 0.25 });
    expect(requestMcpAdmission(wide, undefined, 5, T0, "agent")).toEqual({ allowed: true });
    const refused = requestMcpAdmission(wide, undefined, 1, T0, "agent");
    expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: T0 + MINUTE });
    expect(refused.allowed ? "" : refused.message).toMatch(/MCP server "docs-wide" is paused for the agent: its share of 5 requests per minute \(OD-40\)/);
    expect(requestMcpAdmission(wide, undefined, 1, T0, "interactive")).toEqual({ allowed: true });
    expect(requestMcpAdmission(wide, undefined, 1, T0), "the default purpose is interactive").toEqual({ allowed: true });
  });

  it("tool window: the agent's share of a tool window is enforced even when its server share has room", () => {
    expect(requestMcpAdmission(wide, "search", 1, T0, "agent")).toEqual({ allowed: true });
    const refused = requestMcpAdmission(wide, "search", 1, T0, "agent");
    expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted" });
    expect(refused.allowed ? "" : refused.message).toMatch(/tool "search" is paused for the agent: its share of 1 requests per minute \(OD-40\)/);
    expect(requestMcpAdmission(wide, "read", 1, T0, "agent"), "another tool within the server share").toEqual({ allowed: true });
    expect(requestMcpAdmission(wide, "search", 1, T0, "interactive"), "a person may still use the tool window").toEqual({ allowed: true });
  });

  it("interactive use counts against the whole window the agent shares", () => {
    expect(requestMcpAdmission(wide, undefined, 18, T0, "interactive")).toEqual({ allowed: true });
    expect(requestMcpAdmission(wide, undefined, 2, T0, "agent")).toEqual({ allowed: true });
    expect(requestMcpAdmission(wide, undefined, 1, T0, "agent"), "20 of 20 used, though the agent used only 2").toMatchObject({ allowed: false, reason: "quota_exhausted" });
  });

  it("a window at the registry's lower bound still gives the agent one request: the bound (4) exists so the 25% share never rounds to 0", () => {
    const low = MCP_SERVER_LIMIT_BOUNDS.requestsPerMinute[0];
    const tight = fixtureServer({ id: "docs-tight", limits: { ...server.limits, requestsPerMinute: low, perTool: { search: { requestsPerMinute: low } } } });
    expect(validateMcpServerRegistry([tight])).toEqual([]);
    expect(Math.floor(low * PURPOSE_QUOTA_SHARE.agent)).toBeGreaterThanOrEqual(1);
    expect(requestMcpAdmission(tight, "search", 1, T0, "agent")).toEqual({ allowed: true });
    expect(requestMcpAdmission(tight, "search", 1, T0, "agent")).toMatchObject({ allowed: false, reason: "quota_exhausted" });
    expect(requestMcpAdmission(tight, "search", 1, T0, "interactive"), "a person still has the rest of the window").toEqual({ allowed: true });
  });

  it("previewMcpAdmission reserves nothing and answers per purpose and per tool; currentMcpPause answers per purpose", () => {
    expect(previewMcpAdmission(wide, "search", 1, T0, "agent")).toBeNull();
    expect(requestMcpAdmission(wide, "search", 1, T0, "agent")).toEqual({ allowed: true });
    expect(previewMcpAdmission(wide, "search", 1, T0, "agent")).toMatchObject({ reason: "quota_exhausted" });
    expect(previewMcpAdmission(wide, "search", 1, T0, "interactive")).toBeNull();
    expect(previewMcpAdmission(wide, "read", 1, T0, "agent")).toBeNull();
    expect(previewMcpAdmission(wide, "read", 1, T0, "agent"), "a preview never reserved").toBeNull();
    expect(currentMcpPause(wide, "search", T0, "agent")).toMatchObject({ reason: "quota_exhausted" });
    expect(currentMcpPause(wide, "search", T0)).toBeNull();
    expect(currentMcpPause(wide, undefined, T0, "agent")).toBeNull();
  });
});

describe("[B20 A0] the distributor sources keep their exact outcomes (B19-B I3b, B19-E E2)", () => {
  it("DigiKey: 120 a minute, 1000 a day, the same sentences", () => {
    let now = Date.UTC(2026, 8, 13, 0, 0, 0);
    let allowed = 0;
    for (let minute = 0; minute < 10; minute++) {
      for (let i = 0; i < 120; i++) if (requestAdmission("digikey", 1, now).allowed) allowed += 1;
      now += MINUTE;
    }
    expect(allowed).toBe(1000);
    const refused = requestAdmission("digikey", 1, now);
    expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: Date.UTC(2026, 8, 14) });
    expect(refused.allowed ? "" : refused.message).toBe("DigiKey pricing is paused: its quota of 1000 requests per day is used up until 2026-09-14T00:00:00.000Z.");
  });

  it("the breaker sentence and the agent-share sentence are unchanged", () => {
    const { consecutiveFailuresToOpen, openMs } = SOURCE_REGISTRY.digikey.resilience.breaker;
    for (let i = 0; i < consecutiveFailuresToOpen; i++) {
      requestAdmission("digikey", 0, T0);
      recordOutcome("digikey", "failure", T0);
    }
    expect(requestAdmission("digikey", 0, T0)).toMatchObject({ allowed: false, reason: "breaker_open", retryAtMs: T0 + openMs });
    expect(currentPause("digikey", T0)?.message).toBe(`DigiKey pricing is paused after repeated failures; it will be tried again after ${new Date(T0 + openMs).toISOString()}.`);
    expect(requestAdmission("octopart", 500, T0, "agent")).toEqual({ allowed: true });
    const refused = requestAdmission("octopart", 1, T0, "agent");
    expect(refused.allowed ? "" : refused.message).toBe("Octopart (Nexar) is paused for the agent: its share of 500 matched parts per month (OD-40) is used up until 2026-10-01T00:00:00.000Z.");
  });

  it("resetAdmissionControl forgets the MCP meters as well", () => {
    for (let i = 0; i < 10; i++) requestMcpAdmission(server, "search", 1, T0);
    resetAdmissionControl();
    expect(requestMcpAdmission(server, "search", 1, T0)).toEqual({ allowed: true });
  });
});
