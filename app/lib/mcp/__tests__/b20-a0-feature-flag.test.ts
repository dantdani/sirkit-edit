/**
 * [B20 A0] The MCP feature flag (OD-54, flag part): off unless `SIRKIT_MCP_ENABLED` is exactly "1"; `SIRKIT_MCP_DISABLED_SERVERS`
 * can only remove approved servers, never add one. Both are read through the repository's environment-record pattern, no
 * value is ever echoed, and both are documented in `.env.example` without values.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_DISABLED_SERVERS_ENV, MCP_ENABLED_ENV, mcpFeatureState } from "../rollout";
import { admittedMcpServer, validateMcpServerRegistry } from "../server-registry";
import { fixtureServer } from "./_fixtures";

describe("[B20 A0] SIRKIT_MCP_ENABLED", () => {
  it("is off by default and off when unset or blank", () => {
    expect(MCP_ENABLED_ENV).toBe("SIRKIT_MCP_ENABLED");
    expect(mcpFeatureState({})).toEqual({ enabled: false, disabledServers: [] });
    expect(mcpFeatureState({ SIRKIT_MCP_ENABLED: undefined })).toEqual({ enabled: false, disabledServers: [] });
    expect(mcpFeatureState({ SIRKIT_MCP_ENABLED: "" }).enabled).toBe(false);
    expect(mcpFeatureState({ SIRKIT_MCP_ENABLED: "   " }).enabled).toBe(false);
  });

  it("only the exact string 1 enables: a padded 1 does not (read untrimmed, as SIRKIT_DB_QUALIFICATION is; the .env.local loader trims unquoted file values before they reach the environment)", () => {
    expect(mcpFeatureState({ SIRKIT_MCP_ENABLED: "1" }).enabled).toBe(true);
    expect(mcpFeatureState({ SIRKIT_MCP_ENABLED: " 1 " }).enabled).toBe(false);
    expect(mcpFeatureState({ SIRKIT_MCP_ENABLED: `1${String.fromCharCode(10)}` }).enabled).toBe(false);
    expect(mcpFeatureState({ SIRKIT_MCP_ENABLED: `${String.fromCharCode(9)}1` }).enabled).toBe(false);
  });

  it.each(["true", "yes", "TRUE", "on", "enabled", "01", "1.0", "11", "1;", "0", "false"])("%s does not enable", (value) => {
    expect(mcpFeatureState({ SIRKIT_MCP_ENABLED: value }).enabled).toBe(false);
  });

  it("reads process.env only when called without an environment (never at module load)", () => {
    const previous = process.env[MCP_ENABLED_ENV];
    try {
      delete process.env[MCP_ENABLED_ENV];
      expect(mcpFeatureState().enabled).toBe(false);
      process.env[MCP_ENABLED_ENV] = "1";
      expect(mcpFeatureState().enabled).toBe(true);
    } finally {
      if (previous === undefined) delete process.env[MCP_ENABLED_ENV];
      else process.env[MCP_ENABLED_ENV] = previous;
    }
  });
});

describe("[B20 A0] SIRKIT_MCP_DISABLED_SERVERS", () => {
  it("is a comma-separated id list: trimmed, lower-cased, de-duplicated, sorted, blanks dropped", () => {
    expect(MCP_DISABLED_SERVERS_ENV).toBe("SIRKIT_MCP_DISABLED_SERVERS");
    expect(mcpFeatureState({ SIRKIT_MCP_DISABLED_SERVERS: " docs-Example , zeta,, ,alpha,docs-example " }).disabledServers).toEqual(["alpha", "docs-example", "zeta"]);
    expect(mcpFeatureState({ SIRKIT_MCP_DISABLED_SERVERS: "" }).disabledServers).toEqual([]);
    expect(mcpFeatureState({ SIRKIT_MCP_DISABLED_SERVERS: " , ," }).disabledServers).toEqual([]);
    expect(mcpFeatureState({ SIRKIT_MCP_DISABLED_SERVERS: "a" }).enabled, "the list never enables anything").toBe(false);
  });

  it("the returned state is frozen", () => {
    const state = mcpFeatureState({ SIRKIT_MCP_ENABLED: "1", SIRKIT_MCP_DISABLED_SERVERS: "a" });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.disabledServers)).toBe(true);
  });
});

describe("[B20 A0] the flag at the admission point: it can only remove", () => {
  const approved = fixtureServer();
  const second = fixtureServer({ id: "docs-second" });
  const disabled = fixtureServer({ id: "docs-disabled", state: { status: "disabled", ownerDecision: "OD-48", reason: "fixture; disabled by decision" } });
  const blocked = fixtureServer({ id: "docs-blocked", state: { status: "blocked", ownerDecision: "OD-48", reason: "fixture; blocked by decision" } });
  const rows = [approved, second, disabled, blocked];
  const ON = { SIRKIT_MCP_ENABLED: "1" };

  it("the fixture rows are a valid registry", () => {
    expect(validateMcpServerRegistry(rows)).toEqual([]);
  });

  it("with the flag off every server is refused with feature_disabled, an approved one included", () => {
    expect(admittedMcpServer("docs-example", {}, rows)).toMatchObject({ admitted: false, refusal: "feature_disabled" });
    expect(admittedMcpServer("docs-example", { SIRKIT_MCP_ENABLED: "true" }, rows)).toMatchObject({ admitted: false, refusal: "feature_disabled" });
  });

  it("with the flag on an approved server is admitted unless the operator listed it", () => {
    expect(admittedMcpServer("docs-example", ON, rows)).toEqual({ admitted: true, entry: approved });
    const refused = admittedMcpServer("docs-example", { ...ON, SIRKIT_MCP_DISABLED_SERVERS: "Docs-Example" }, rows);
    expect(refused).toMatchObject({ admitted: false, refusal: "operator_disabled" });
    expect(refused.admitted ? "" : refused.message).toContain("SIRKIT_MCP_DISABLED_SERVERS");
    expect(admittedMcpServer("docs-second", { ...ON, SIRKIT_MCP_DISABLED_SERVERS: "docs-example" }, rows), "only the listed id is removed").toEqual({ admitted: true, entry: second });
  });

  it("listing a disabled, blocked or unknown id never admits it, and the registry state wins over the list", () => {
    const env = { ...ON, SIRKIT_MCP_DISABLED_SERVERS: "docs-disabled,docs-blocked,nobody" };
    expect(admittedMcpServer("docs-disabled", env, rows)).toMatchObject({ admitted: false, refusal: "disabled" });
    expect(admittedMcpServer("docs-blocked", env, rows)).toMatchObject({ admitted: false, refusal: "blocked" });
    expect(admittedMcpServer("nobody", env, rows)).toMatchObject({ admitted: false, refusal: "unknown_server" });
  });

  it("no environment value is ever echoed in a refusal", () => {
    const env = { SIRKIT_MCP_ENABLED: "SENTINEL-not-one", SIRKIT_MCP_DISABLED_SERVERS: "docs-example,SENTINEL-listed" };
    const off = admittedMcpServer("docs-example", env, rows);
    expect(off.admitted ? "" : off.message).not.toContain("SENTINEL");
    const listed = admittedMcpServer("docs-example", { ...env, SIRKIT_MCP_ENABLED: "1" }, rows);
    expect(listed).toMatchObject({ admitted: false, refusal: "operator_disabled" });
    expect(listed.admitted ? "" : listed.message).not.toContain("SENTINEL");
  });
});

describe("[B20 A0] .env.example documents both variables without a value", () => {
  it("names SIRKIT_MCP_ENABLED and SIRKIT_MCP_DISABLED_SERVERS as commented, empty assignments", () => {
    const example = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    expect(example).toMatch(/^# SIRKIT_MCP_ENABLED=\s*$/m);
    expect(example).toMatch(/^# SIRKIT_MCP_DISABLED_SERVERS=\s*$/m);
    expect(example).not.toMatch(/^SIRKIT_MCP_ENABLED=1/m);
  });
});
