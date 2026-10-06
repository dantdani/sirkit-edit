/**
 * [B24-A1] The flag inventory and the sandbox switch (D24-11, OD-200).
 *
 * `FLAG_INVENTORY` is data: every `SIRKIT_*` environment name read in code (comments aside) under app/, lib/, components/, scripts/,
 * the root configs and both Playwright configs, outside tests, with its kind, default, direction, owner file:line and the owner's
 * exported name constant; every other `SIRKIT_` token is a reviewed exclusion with its reason. Each flag's default and parse is
 * pinned through its owner ([B24-A1 review] tests-1: as the deployment configuration RECORDS the state, never a copy of the parse kept
 * here). The sandbox switch `SIRKIT_DIAGNOSTIC_RUNNER_DISABLED` - any non-blank value, the `SIRKIT_ORDERING_DISABLED` precedent -
 * refuses every run and every install check of B22's diagnostic runner first, with `NGSPICE_DIAGNOSTIC_DISABLED` ([B24-A1 review]
 * coverage-6: a version line already probed is answered from memory, case 10); nothing turns anything on, and production simulation
 * stays BLOCKED.
 *
 * Failing first on 8664964: the inventory and the switch do not exist, and with the variable set to "1" a fake-host pinned run still
 * reaches its install check (page section 8). Nothing is written to disk and no process is started: the runner reads a fake host
 * and an install root that does not exist, so its install check fails closed before any spawn.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_DISABLE_ENV, SOURCE_REGISTRY, admitSource, type AcquisitionSourceId } from "@/app/lib/acquisition/source-registry";
import { assignmentQueueFeatureState } from "@/app/lib/assignment-queue/rollout";
import { resolveAuthMode } from "@/app/lib/auth/mode";
import {
  DIAGNOSTIC_RUNNER_DISABLE_ENV,
  DiagnosticRunnerError,
  __resetDiagnosticRunnerCachesForTests,
  __setDiagnosticRunnerHostForTests,
  diagnosticNgspiceVersion,
  diagnosticRunnerDisabled,
  diagnosticRunnerState,
  runDiagnosticNgspice,
  verifyDiagnosticInstall,
} from "@/app/lib/computation/diagnostic-runner";
import { databaseQualification } from "@/app/lib/db/test-qualification";
import { buildDeploymentConfiguration } from "@/app/lib/deployment/configuration";
import { FLAG_DIRECTIONS, FLAG_INVENTORY, FLAG_INVENTORY_EXCLUSIONS, FLAG_KINDS, type FlagInventoryEntry } from "@/app/lib/deployment/flag-inventory";
import { FIXTURE_CLOCK_DEFAULT, fixtureClockInstant } from "@/app/lib/fixture-runtime/clock";
import { fixtureRuntimeRequested } from "@/app/lib/fixture-runtime/mode";
import { fixtureRouterMode } from "@/app/lib/fixture-runtime/router";
import { footprintResolverShadowEnabled } from "@/app/lib/footprint-resolver/shadow";
import { configuredAnthropicModel } from "@/app/lib/llm/anthropic-config";
import { DEFAULT_OPENAI_MODEL, configuredOpenAIModel, configuredOpenAIReasoningEffort } from "@/app/lib/llm/openai-config";
import { orderingEnablement } from "@/app/lib/manufacturing-providers/ordering-enablement";
import { admitProviderOperation } from "@/app/lib/manufacturing-providers/provider-admission";
import { PROVIDER_ROWS } from "@/app/lib/manufacturing-providers/provider-registry";
import { mappingStage4FeatureState } from "@/app/lib/mapping-verification/rollout";
import { MCP_DISABLED_SERVERS_ENV, mcpFeatureState } from "@/app/lib/mcp/rollout";
import { passivePolicyFeatureState } from "@/app/lib/passive-policy/rollout";
import { pcbSyncFeatureState } from "@/app/lib/pcb-sync/rollout";
import { physicalBindingShadowEnabled } from "@/app/lib/physical-binding/shadow";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const PAGE = "artifacts/ai-control-plane-b24/environments-and-deployment.md";
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
type Env = Record<string, string | undefined>;
const byName = (name: string): FlagInventoryEntry => {
  const entry = FLAG_INVENTORY.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`not inventoried: ${name}`);
  return entry;
};
const ownerLine = (entry: FlagInventoryEntry): string => {
  const [file, line] = entry.owner.split(":") as [string, string];
  return lines(file)[Number(line) - 1] ?? "";
};

// ── [B24-A1 review] tests-1: the record's flag states against the OWNERS (no copy of the parse is kept here) ──────────────────────

/** A flag's state as the deployment configuration RECORDS it (configuration.ts's flagState, reached through the record). */
function recordState(name: string, value: string | undefined): string {
  const flag = buildDeploymentConfiguration(value === undefined ? {} : { [name]: value }).flags.find((candidate) => candidate.name === name);
  if (!flag) throw new Error(`not recorded: ${name}`);
  return flag.state;
}
const alone = (name: string, value: string | undefined): Env => (value === undefined ? {} : { [name]: value });
/** The list parse the three list owners spell identically (source-registry.ts, provider-admission.ts, mcp/rollout.ts; pinned in case 4);
 *  MCP's owner exposes its result, so it answers for all three. */
const LIST_PARSE = '?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);';
const ownerList = (value: string | undefined): string => (mcpFeatureState(alone(MCP_DISABLED_SERVERS_ENV, value)).disabledServers.length > 0 ? "set" : "unset");
/** The two owners this suite does not import (each reads the process alone or drags the chat runtime in; lead note item 9): the exact
 *  value each compares with, read from its owner line. */
const ownerCompare = (path: string, pattern: RegExp): string => {
  const literal = pattern.exec(read(path))?.[1];
  if (literal === undefined) throw new Error(`no compare at ${path}`);
  return literal;
};
/** Each flag-kind name: what its owner makes of one value of that variable alone, in the record's state vocabulary. */
const OWNER_STATE: Readonly<Record<string, (value: string | undefined) => string>> = {
  SIRKIT_ACQUISITION_DISABLED_SOURCES: ownerList,
  SIRKIT_ASSIGNMENT_QUEUE_STAGE6: (value) => assignmentQueueFeatureState(alone("SIRKIT_ASSIGNMENT_QUEUE_STAGE6", value)),
  SIRKIT_DIAGNOSTIC_RUNNER_DISABLED: (value) => (diagnosticRunnerDisabled(alone("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED", value)) ? "set" : "unset"),
  SIRKIT_FOOTPRINT_RESOLVER_SHADOW: (value) => (footprintResolverShadowEnabled(alone("SIRKIT_FOOTPRINT_RESOLVER_SHADOW", value)) ? "on" : "off"),
  SIRKIT_MANUFACTURING_DISABLED_PROVIDERS: ownerList,
  SIRKIT_MAPPING_STAGE4: (value) => mappingStage4FeatureState(alone("SIRKIT_MAPPING_STAGE4", value)),
  SIRKIT_MCP_DISABLED_SERVERS: (value) => (mcpFeatureState(alone("SIRKIT_MCP_DISABLED_SERVERS", value)).disabledServers.length > 0 ? "set" : "unset"),
  SIRKIT_MCP_ENABLED: (value) => (mcpFeatureState(alone("SIRKIT_MCP_ENABLED", value)).enabled ? "on" : "off"),
  SIRKIT_NAMED_COMPUTATIONS: (value) => (value === ownerCompare("app/api/chat/computation-runtime.ts", /process\.env\[NAMED_COMPUTATIONS_SETTING\] === "([^"]*)"/) ? "on" : "off"),
  SIRKIT_ORCHESTRATION_ENABLED: (value) => (value === ownerCompare("app/api/chat/orchestration-runtime.ts", /return environment\[ORCHESTRATION_ENABLED_ENV\] === "([^"]*)";/) ? "on" : "off"),
  SIRKIT_ORDERING_DISABLED: (value) => ((orderingEnablement({ env: alone("SIRKIT_ORDERING_DISABLED", value) }).reasons as readonly string[]).includes("operator_disabled") ? "set" : "unset"),
  SIRKIT_PASSIVE_POLICY_STAGE5: (value) => passivePolicyFeatureState(alone("SIRKIT_PASSIVE_POLICY_STAGE5", value)),
  SIRKIT_PCB_SYNC_STAGE3: (value) => pcbSyncFeatureState(alone("SIRKIT_PCB_SYNC_STAGE3", value)),
  SIRKIT_PHYSICAL_BINDING_SHADOW: (value) => (physicalBindingShadowEnabled(alone("SIRKIT_PHYSICAL_BINDING_SHADOW", value)) ? "on" : "off"),
};

// ── the census (comments stripped, strings kept) ────────────────────────────────────────────────────────────────────────────────────

/** Code with every comment removed (line breaks kept, so line numbers hold); strings and template literals are kept. */
function code(text: string): string {
  let out = "";
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  for (let index = 0; index < text.length; index += 1) {
    const c = text[index]!;
    const next = text[index + 1] ?? "";
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; index += 1; continue; }
      if (c === "/" && next === "*") { state = "block"; index += 1; continue; }
      if (c === "'" || c === '"' || c === "`") state = c;
      out += c;
    } else if (state === "line") {
      if (c === NEWLINE) { state = "code"; out += c; }
    } else if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; index += 1; } else if (c === NEWLINE) out += c;
    } else {
      if (c === BACKSLASH) { out += c + next; index += 1; continue; }
      if (c === state || (c === NEWLINE && state !== "`")) state = "code";
      out += c;
    }
  }
  return out;
}
const SOURCE = /\.(?:tsx?|mts|mjs|cjs|js)$/;
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sources(path);
    return SOURCE.test(entry.name) && !/\.(?:test|spec)\.[a-z]+$/.test(entry.name) ? [path] : [];
  });
}
/** The inventory module is the reviewed list, not a reader: the census does not scan it. */
const INVENTORY = "app/lib/deployment/flag-inventory.ts";
/** Every `SIRKIT_` token in code, with its sites. */
function census(): Map<string, string[]> {
  const files = [...["app", "lib", "components", "scripts"].flatMap((dir) => sources(dir)), ...readdirSync(ROOT, { withFileTypes: true }).filter((entry) => entry.isFile() && SOURCE.test(entry.name)).map((entry) => entry.name)].filter((file) => file !== INVENTORY);
  const found = new Map<string, string[]>();
  for (const file of files) {
    code(read(file)).split(NEWLINE).forEach((line, index) => {
      for (const match of line.matchAll(/SIRKIT_[A-Z0-9_]*[A-Z0-9]/g)) found.set(match[0], [...(found.get(match[0]) ?? []), `${file}:${index + 1}`]);
    });
  }
  return found;
}
const NAMES = new Set(FLAG_INVENTORY.map((entry) => entry.name));
const classify = (token: string): string | null => {
  if (NAMES.has(token)) return "inventory";
  const exclusion = FLAG_INVENTORY_EXCLUSIONS.find((candidate) => (candidate.match === "exact" && candidate.token === token) || (candidate.match === "prefix" && token.startsWith(candidate.token)) || (candidate.match === "name-constant" && token.endsWith(candidate.token) && NAMES.has(token.slice(0, -candidate.token.length))));
  return exclusion ? exclusion.token : null;
};

// ── the diagnostic runner's fakes ─────────────────────────────────────────────────────────────────────────────────────────────────

const FAKE_SYSTEM_ROOT = ["C:", "Windows"].join(BACKSLASH);
const hostReads = { count: 0 };
function pinnedFakeHost(): void {
  __setDiagnosticRunnerHostForTests({ platform: () => { hostReads.count += 1; return "win32-x64"; }, systemRoot: () => FAKE_SYSTEM_ROOT });
  vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", "b".repeat(64));
  vi.stubEnv("SIRKIT_NGSPICE_INSTALL_ROOT", resolve(tmpdir(), `sirkit-b24-a1-absent-${randomUUID()}`));
}
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof DiagnosticRunnerError ? error.code : `other: ${String(error)}`;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  __setDiagnosticRunnerHostForTests(null);
  __resetDiagnosticRunnerCachesForTests();
  hostReads.count = 0;
});

describe("[B24-A1] the flag inventory (D24-11, OD-200)", () => {
  it("1. the inventory is data and imports nothing; its kinds and directions are closed; every entry is well formed and named once; each owner line holds the name, or declares the owner's exported constant with it", () => {
    expect(read("app/lib/deployment/flag-inventory.ts")).not.toMatch(/^\s*import\b/m);
    expect([...FLAG_KINDS]).toEqual(["enable-flag", "disable-switch", "rollout-stage", "shadow", "fixture", "live-test-gate", "configuration", "secret", "tooling"]);
    expect([...FLAG_DIRECTIONS]).toEqual(["enables", "disables", "selects", "supplies"]);
    expect(new Set(FLAG_INVENTORY.map((entry) => entry.name)).size).toBe(FLAG_INVENTORY.length);
    expect(FLAG_INVENTORY.map((entry) => entry.name)).toEqual([...FLAG_INVENTORY.map((entry) => entry.name)].sort());
    expect(Object.isFrozen(FLAG_INVENTORY)).toBe(true);
    for (const entry of FLAG_INVENTORY) {
      expect(Object.keys(entry).sort(), entry.name).toEqual(["constant", "default", "direction", "kind", "name", "owner", "rule"]);
      expect(entry.name, entry.name).toMatch(/^SIRKIT_[A-Z0-9_]*[A-Z0-9]$/);
      expect(FLAG_KINDS, entry.name).toContain(entry.kind);
      expect(FLAG_DIRECTIONS, entry.name).toContain(entry.direction);
      expect(entry.default.length, entry.name).toBeGreaterThan(0);
      expect(entry.owner, entry.name).toMatch(/^[a-zA-Z0-9_./-]+\.(?:ts|mjs):\d+$/);
      const line = ownerLine(entry);
      if (entry.constant === null) expect(line, entry.name).toContain(entry.name);
      else expect(line, entry.name).toMatch(new RegExp(`export const ${entry.constant}\\b[^=]*= "${entry.name}"`));
    }
    // the reviewed kind of every name (a new name or a changed kind is a reviewed move of this pin, D16)
    const kinds = Object.fromEntries(FLAG_KINDS.map((kind) => [kind, FLAG_INVENTORY.filter((entry) => entry.kind === kind).map((entry) => entry.name)]));
    expect(kinds).toEqual({
      "enable-flag": ["SIRKIT_MCP_ENABLED", "SIRKIT_NAMED_COMPUTATIONS", "SIRKIT_ORCHESTRATION_ENABLED"],
      "disable-switch": ["SIRKIT_ACQUISITION_DISABLED_SOURCES", "SIRKIT_DIAGNOSTIC_RUNNER_DISABLED", "SIRKIT_MANUFACTURING_DISABLED_PROVIDERS", "SIRKIT_MCP_DISABLED_SERVERS", "SIRKIT_ORDERING_DISABLED"],
      "rollout-stage": ["SIRKIT_ASSIGNMENT_QUEUE_STAGE6", "SIRKIT_MAPPING_STAGE4", "SIRKIT_PASSIVE_POLICY_STAGE5", "SIRKIT_PCB_SYNC_STAGE3"],
      shadow: ["SIRKIT_FOOTPRINT_RESOLVER_SHADOW", "SIRKIT_PHYSICAL_BINDING_SHADOW"],
      fixture: ["SIRKIT_FIXTURE_AGENT", "SIRKIT_FIXTURE_CLOCK", "SIRKIT_FIXTURE_ROUTER", "SIRKIT_FIXTURE_ROUTER_DUMP", "SIRKIT_FIXTURE_ROUTER_FIXTURE", "SIRKIT_FIXTURE_RUNTIME"],
      "live-test-gate": ["SIRKIT_B16_1C_RECORD_ROUTES", "SIRKIT_DB_QUALIFICATION", "SIRKIT_LIVE_ORCHESTRATION_EVALUATION", "SIRKIT_LIVE_ORCHESTRATION_PROVIDER"],
      configuration: ["SIRKIT_ANTHROPIC_MODEL", "SIRKIT_ATOMIC_CATALOG_PROJECT_ID", "SIRKIT_ATOMIC_CATALOG_TENANT_ID", "SIRKIT_AUTH_MODE", "SIRKIT_DB_POOL_MAX", "SIRKIT_DEPLOYMENT_ENV", "SIRKIT_EXPECTED_ORIGIN", "SIRKIT_FREEROUTING_INSTALL_ROOT", "SIRKIT_FREEROUTING_INSTALL_SHA256", "SIRKIT_KICAD_CLI_INSTALL_ROOT", "SIRKIT_KICAD_CLI_INSTALL_SHA256", "SIRKIT_NGSPICE_INSTALL_ROOT", "SIRKIT_NGSPICE_INSTALL_SHA256", "SIRKIT_NGSPICE_OCI_IMAGE", "SIRKIT_OCI_CLI_PATH", "SIRKIT_OCI_CLI_SHA256", "SIRKIT_OPENAI_MODEL", "SIRKIT_OPENAI_REASONING_EFFORT", "SIRKIT_ORCHESTRATION_ROLE_MODELS"],
      secret: ["SIRKIT_DB_QUALIFICATION_URL", "SIRKIT_MCP_TOKEN_SECRET", "SIRKIT_MCP_TOKEN_SECRET_PREVIOUS", "SIRKIT_WORKFLOW_WORKER_SECRET", "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS"], // [B24-A2, 2026-10-06] reviewed pin move (D16, task-A2 deliverable 5): + the two previous values B24-A2 reads, kind secret (verification only, OD-195)
      tooling: ["SIRKIT_E2E_BASE_URL", "SIRKIT_E2E_ORCHESTRATION_PORT", "SIRKIT_E2E_PORT"],
    });
    expect(FLAG_INVENTORY).toHaveLength(51); // [B24-A2, 2026-10-06] reviewed pin move: 49 -> 51, the two *_PREVIOUS secrets B24-A2 appends (D16)
    // the auth mode is configuration, never a fixture (B24-A2 stops on a fixture kind for it)
    expect(byName("SIRKIT_AUTH_MODE")).toMatchObject({ kind: "configuration", owner: "app/lib/auth/mode.ts:19", constant: "SIRKIT_AUTH_MODE_ENV" });
    // the names with no exported constant at f663d71 carry null, and their owner line spells the name
    for (const name of ["SIRKIT_DB_POOL_MAX", "SIRKIT_ANTHROPIC_MODEL", "SIRKIT_OPENAI_MODEL", "SIRKIT_OPENAI_REASONING_EFFORT", "SIRKIT_E2E_PORT", "SIRKIT_E2E_ORCHESTRATION_PORT", "SIRKIT_E2E_BASE_URL", "SIRKIT_B16_1C_RECORD_ROUTES", "SIRKIT_NGSPICE_OCI_IMAGE"]) expect(byName(name).constant, name).toBeNull();
  });

  it("2. the census: every SIRKIT_ token in code under app/, lib/, components/, scripts/, the root configs and both Playwright configs, outside tests, is an inventory name or a reviewed exclusion (one reason each, each still matching, each cited site holding it), and every inventory name is read there", () => {
    const tokens = census();
    expect(tokens.size).toBeGreaterThan(50);
    const unclassified = [...tokens.keys()].filter((token) => classify(token) === null).map((token) => `${token} at ${tokens.get(token)!.slice(0, 3).join(", ")}`);
    expect(unclassified).toEqual([]);
    for (const name of NAMES) expect(tokens.has(name), name).toBe(true);
    for (const entry of FLAG_INVENTORY) expect(tokens.get(entry.name), entry.name).toContain(entry.owner);
    for (const exclusion of FLAG_INVENTORY_EXCLUSIONS) {
      expect(exclusion.reason.length, exclusion.token).toBeGreaterThan(30);
      if (exclusion.match !== "mention") expect([...tokens.keys()].some((token) => classify(token) === exclusion.token), `${exclusion.token} is dead`).toBe(true);
      for (const site of exclusion.sites) {
        const [file, line] = site.split(":") as [string, string];
        const text = lines(file)[Number(line) - 1] ?? "";
        expect(exclusion.match === "name-constant" ? /SIRKIT_[A-Z0-9_]*_ENV\b/.test(text) : text.includes(exclusion.match === "mention" ? exclusion.names[0]! : exclusion.token), site).toBe(true);
        if (exclusion.match === "mention") for (const name of exclusion.names) expect(NAMES.has(name) && text.includes(`"`) && text.includes(name), `${site} ${name}`).toBe(true);
      }
    }
    expect(FLAG_INVENTORY_EXCLUSIONS.map((exclusion) => exclusion.token)).toEqual(["SIRKIT_D1N4148", "SIRKIT_ELECTRICAL_TRUTH", "SIRKIT_READINESS_REPORT", "SIRKIT_RELEASE_MANIFEST", "SIRKIT_STAGE_", "SIRKIT_MINTED_ID", "SIRKIT_TOOL_CATALOG", "SIRKIT_ANTHROPIC_MODEL_EMPTY", "SIRKIT_ANTHROPIC_MODEL_PADDED", "_ENV", "SIRKIT_ATOMIC_CATALOG_"]);
    expect([...tokens.values()].flat().some((site) => site.startsWith(`${INVENTORY}:`))).toBe(false);
    // the census bites: a new name read in code, or a dropped entry, is unclassified
    expect(classify("SIRKIT_SOMETHING_NEW")).toBeNull();
    expect(classify("SIRKIT_UNINVENTORIED_ENV")).toBeNull();
    expect(classify("SIRKIT_AUTH_MODE_ENV")).toBe("_ENV");
  });

  it("3. every flag's default, pinned through its owner: with an empty environment MCP, orchestration and named computations are off, the four stages off, both shadows off, every off-only switch unset, the fixtures and live gates off; the configuration defaults are the owners'; [B24-A1 review] each flag default is also the record's state of an unset variable (tests-1), and the effort default holds whatever model the shell exports (tests-4)", () => {
    expect(mcpFeatureState({})).toEqual({ enabled: false, disabledServers: [] });
    expect([assignmentQueueFeatureState({}), mappingStage4FeatureState({}), passivePolicyFeatureState({}), pcbSyncFeatureState({})]).toEqual(["off", "off", "off", "off"]);
    expect([footprintResolverShadowEnabled({}), physicalBindingShadowEnabled({})]).toEqual([false, false]);
    expect(diagnosticRunnerDisabled({})).toBe(false);
    expect(orderingEnablement({ env: {} }).reasons).not.toContain("operator_disabled");
    expect([fixtureRuntimeRequested({}), fixtureRouterMode({}), fixtureClockInstant({})]).toEqual([false, "replay", FIXTURE_CLOCK_DEFAULT]);
    expect(databaseQualification({})).toMatchObject({ enabled: false });
    for (const entry of FLAG_INVENTORY.filter((candidate) => ["enable-flag", "disable-switch", "rollout-stage", "shadow"].includes(candidate.kind))) {
      // [B24-A1 review] tests-1: the default is the record's state of an unset variable, and the owner's
      expect(entry.default, entry.name).toBe(recordState(entry.name, undefined));
      expect(entry.default, entry.name).toBe(OWNER_STATE[entry.name]?.(undefined));
      expect(entry.direction, entry.name).toBe(entry.kind === "disable-switch" ? "disables" : "enables");
    }
    expect(byName("SIRKIT_FIXTURE_ROUTER").default).toBe(fixtureRouterMode({}));
    expect(byName("SIRKIT_FIXTURE_CLOCK").default).toBe(FIXTURE_CLOCK_DEFAULT);
    expect(byName("SIRKIT_ANTHROPIC_MODEL").default).toBe(configuredAnthropicModel({}));
    expect(byName("SIRKIT_OPENAI_MODEL").default).toBe(configuredOpenAIModel({}));
    // [B24-A1 review] tests-4: a shell may export another model; the effort's default is the default model's, whatever it exports
    vi.stubEnv("SIRKIT_OPENAI_MODEL", "o3-mini");
    vi.stubEnv("SIRKIT_OPENAI_REASONING_EFFORT", undefined);
    expect(byName("SIRKIT_OPENAI_REASONING_EFFORT").default).toBe(configuredOpenAIReasoningEffort(DEFAULT_OPENAI_MODEL));
    expect(byName("SIRKIT_AUTH_MODE").default).toBe(resolveAuthMode({}));
    expect(byName("SIRKIT_DB_POOL_MAX").default).toBe("8");
    expect(ownerLine(byName("SIRKIT_DB_POOL_MAX"))).toContain("process.env.SIRKIT_DB_POOL_MAX ?? 8");
    for (const name of ["SIRKIT_DB_QUALIFICATION", "SIRKIT_LIVE_ORCHESTRATION_EVALUATION", "SIRKIT_B16_1C_RECORD_ROUTES"]) expect(byName(name).default, name).toBe("off");
  });

  it("4. [B24-A1 review] tests-1: the RECORD's state of every flag-kind name equals its owner's answer over sample values - exactly \"1\" for MCP, orchestration and named computations (a padded 1, true or yes stay off), the stages trimmed and lower-cased, the shadows exactly true, the off-only switches any non-blank value or a non-empty list; the three list owners spell one parse, and a reviewed id listed is switched off by its owner", { timeout: 30_000 }, () => {
    const flagNames = FLAG_INVENTORY.filter((entry) => ["enable-flag", "disable-switch", "rollout-stage", "shadow"].includes(entry.kind)).map((entry) => entry.name);
    expect(Object.keys(OWNER_STATE).sort()).toEqual([...flagNames].sort());
    expect(buildDeploymentConfiguration({}).flags.map((flag) => flag.name)).toEqual(flagNames);
    const samples = [undefined, "", " ", "1", " 1", "1 ", "true", "TRUE", " true ", "yes", "on", "0", "observe", " OBSERVE ", "opt_in", "authoritative_safe_profile", "authoritative_supported_profile", "x", ",", " , ", "digikey", " DigiKey , x"];
    for (const value of samples) {
      for (const name of flagNames) expect(recordState(name, value), `${name} ${JSON.stringify(value)}`).toBe(OWNER_STATE[name]?.(value));
    }
    // the three list owners spell one parse, so MCP's exposed result answers for all three
    for (const [path, constant] of [["app/lib/acquisition/source-registry.ts", "OPERATOR_DISABLE_ENV"], ["app/lib/manufacturing-providers/provider-admission.ts", "PROVIDER_OPERATOR_DISABLE_ENV"], ["app/lib/mcp/rollout.ts", "MCP_DISABLED_SERVERS_ENV"]] as const) expect(read(path), path).toContain(`[${constant}] ${LIST_PARSE}`);
    // and through the owners' own answers: a listed reviewed id is switched off and recorded set; an empty list switches nothing off
    const secretNames = [...new Set(Object.values(SOURCE_REGISTRY).flatMap((entry) => entry.auth.secrets.flatMap((reference) => [reference.env, ...reference.fallbacks])))];
    const credentials: Env = Object.fromEntries(secretNames.map((name) => [name, ["fake", name.toLowerCase().replaceAll("_", "-"), "b24"].join("-")]));
    const source = (Object.keys(SOURCE_REGISTRY) as AcquisitionSourceId[]).find((id) => admitSource(id, credentials).admitted);
    expect(source).toBeDefined();
    const listedSource = ` ${source!.toUpperCase()} , x`;
    expect(admitSource(source!, { ...credentials, [OPERATOR_DISABLE_ENV]: listedSource })).toMatchObject({ admitted: false, refusal: "operator_disabled" });
    expect(recordState(OPERATOR_DISABLE_ENV, listedSource)).toBe("set");
    const switchedOff = (value: string): boolean => PROVIDER_ROWS.some((row) => row.operations.some((operation) => {
      const answer = admitProviderOperation(PROVIDER_ROWS, row.id, operation.id, { ...credentials, SIRKIT_MANUFACTURING_DISABLED_PROVIDERS: value });
      return !answer.admitted && answer.refusal === "operator_disabled";
    }));
    const provider = PROVIDER_ROWS.find((row) => switchedOff(row.id));
    expect(provider).toBeDefined();
    expect(recordState("SIRKIT_MANUFACTURING_DISABLED_PROVIDERS", ` ${provider!.id.toUpperCase()} `)).toBe("set");
    for (const empty of ["", " , ", ","]) {
      expect(switchedOff(empty), JSON.stringify(empty)).toBe(false);
      expect(admitSource(source!, { ...credentials, [OPERATOR_DISABLE_ENV]: empty }).admitted, JSON.stringify(empty)).toBe(true);
      expect([recordState(OPERATOR_DISABLE_ENV, empty), recordState("SIRKIT_MANUFACTURING_DISABLED_PROVIDERS", empty)], JSON.stringify(empty)).toEqual(["unset", "unset"]);
    }
    expect(byName("SIRKIT_ORCHESTRATION_ENABLED").rule).toEqual({ parse: "exact", value: "1" });
    expect(byName("SIRKIT_NAMED_COMPUTATIONS").rule).toEqual({ parse: "exact", value: "1" });
    expect(byName("SIRKIT_MCP_ENABLED").rule).toEqual({ parse: "exact", value: "1" });
  });

  it("5. the off-only switches only ever turn something off: acquisition sources, manufacturing providers, ordering, MCP servers and the diagnostic runner - set to anything, nothing that was refused is admitted and nothing is turned on", () => {
    const secretNames = [...new Set(Object.values(SOURCE_REGISTRY).flatMap((entry) => entry.auth.secrets.flatMap((reference) => [reference.env, ...reference.fallbacks])))];
    const credentials: Env = Object.fromEntries(secretNames.map((name) => [name, ["fake", name.toLowerCase().replaceAll("_", "-"), "b24"].join("-")]));
    for (const id of Object.keys(SOURCE_REGISTRY) as AcquisitionSourceId[]) {
      const off = admitSource(id, { ...credentials, [OPERATOR_DISABLE_ENV]: id });
      expect(off.admitted, id).toBe(false);
      if (!off.admitted && admitSource(id, credentials).admitted) expect(off.refusal, id).toBe("operator_disabled");
    }
    for (const row of PROVIDER_ROWS) {
      for (const operation of row.operations) {
        const before = admitProviderOperation(PROVIDER_ROWS, row.id, operation.id, credentials);
        const after = admitProviderOperation(PROVIDER_ROWS, row.id, operation.id, { ...credentials, SIRKIT_MANUFACTURING_DISABLED_PROVIDERS: row.id });
        expect(after.admitted, `${row.id}.${operation.id}`).toBe(false);
        if (!before.admitted) expect(after.admitted).toBe(false);
      }
    }
    for (const value of ["1", "true", "0", " x "]) {
      expect(orderingEnablement({ env: { SIRKIT_ORDERING_DISABLED: value } }).enabled, value).toBe(false);
      expect(mcpFeatureState({ SIRKIT_MCP_DISABLED_SERVERS: value }).enabled, value).toBe(false);
      expect(diagnosticRunnerDisabled({ SIRKIT_DIAGNOSTIC_RUNNER_DISABLED: value }), value).toBe(true);
    }
    for (const entry of FLAG_INVENTORY.filter((candidate) => candidate.kind === "disable-switch")) expect(entry, entry.name).toMatchObject({ direction: "disables", default: "unset" });
  });

  it("6. the sandbox switch's parse (A1's own OD entry): \"1\", \"true\", \" 1\" and \"0\" disable; unset, \"\" and \" \" do not - any non-blank value, as SIRKIT_ORDERING_DISABLED reads it; it is read from the process at each call", () => {
    expect(DIAGNOSTIC_RUNNER_DISABLE_ENV).toBe("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED");
    for (const value of ["1", "true", " 1", "0"]) expect(diagnosticRunnerDisabled({ SIRKIT_DIAGNOSTIC_RUNNER_DISABLED: value }), JSON.stringify(value)).toBe(true);
    for (const value of [undefined, "", " "]) expect(diagnosticRunnerDisabled(value === undefined ? {} : { SIRKIT_DIAGNOSTIC_RUNNER_DISABLED: value }), JSON.stringify(value)).toBe(false);
    vi.stubEnv("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED", "1");
    expect(diagnosticRunnerDisabled()).toBe(true);
    vi.stubEnv("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED", " ");
    expect(diagnosticRunnerDisabled()).toBe(false);
    expect(byName("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED")).toMatchObject({ kind: "disable-switch", direction: "disables", default: "unset", rule: { parse: "non-blank" }, constant: "DIAGNOSTIC_RUNNER_DISABLE_ENV" });
  });

  it("7. counterexample (red on 8664964): with the switch set to \"1\" a fake-host pinned install check is still reached; with it, every run and every install check refuses NGSPICE_DIAGNOSTIC_DISABLED first - before the deck screen, the host, any digest, directory or spawn - and unset, the same calls run as before", async () => {
    pinnedFakeHost();
    vi.stubEnv("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED", "1");
    expect(await refusal(verifyDiagnosticInstall())).toBe("NGSPICE_DIAGNOSTIC_DISABLED");
    expect(await refusal(runDiagnosticNgspice({ operation: "version" }))).toBe("NGSPICE_DIAGNOSTIC_DISABLED");
    expect(await refusal(runDiagnosticNgspice({ operation: "run", deck: "* not seeded", readRaw: false }))).toBe("NGSPICE_DIAGNOSTIC_DISABLED");
    expect(hostReads.count).toBe(0);
    expect(diagnosticRunnerState()).toMatchObject({ running: 0, queued: 0, digestComputations: 0, installChecks: 0 });
    let message = "";
    try {
      await verifyDiagnosticInstall();
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toMatch(/^NGSPICE_DIAGNOSTIC_DISABLED: .*SIRKIT_DIAGNOSTIC_RUNNER_DISABLED/);
    expect(message).not.toContain(tmpdir());
    // unset: the deck screen and the install check are reached as before (the install root does not exist: refused, closed)
    vi.stubEnv("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED", "");
    expect(await refusal(runDiagnosticNgspice({ operation: "run", deck: "* not seeded", readRaw: false }))).toBe("NGSPICE_DIAGNOSTIC_DECK_REFUSED");
    expect(await refusal(verifyDiagnosticInstall())).toBe("NGSPICE_DIAGNOSTIC_INSTALL_UNREADABLE");
    expect(hostReads.count).toBeGreaterThanOrEqual(1);
    expect(diagnosticRunnerState().installChecks).toBe(1);
  });

  it("8. in place, no cited line moved: the code appended to the union on :74, the checks prepended on :249 and :633, the reader after :755, B22's C42 (:692) unchanged; the callers map the refusal (/api/simulate 503, the computation executor refuses with the code)", () => {
    const runner = lines("app/lib/computation/diagnostic-runner.ts");
    expect(runner[73]).toMatch(/^ {2}\| "NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED" \| "NGSPICE_DIAGNOSTIC_DISABLED";/);
    expect(runner[248]).toMatch(/^ {2}refuseIfDiagnosticRunnerSwitchedOff\(\); const platform = host\.platform\(\);/);
    expect(runner[632]).toMatch(/^ {2}refuseIfDiagnosticRunnerSwitchedOff\(\); const profile = runtimeProfile\(DIAGNOSTIC_RUNNER_PROFILE_ID\);/);
    expect(runner[633]).toBe('  if (request.operation === "run") {');
    expect(runner[691]).toContain("const read = await readBoundedRawFile(join(directory, DIAGNOSTIC_RAW_OUTPUT_FILE)");
    expect(runner[707]).toBe("  const profile = runtimeProfile(DIAGNOSTIC_RUNNER_PROFILE_ID);");
    expect(runner[708]).toBe("  const root = preflight(profile).root;");
    expect(runner[754]).toBe("}");
    expect(runner.slice(755).join(NEWLINE)).toMatch(/export const DIAGNOSTIC_RUNNER_DISABLE_ENV = "SIRKIT_DIAGNOSTIC_RUNNER_DISABLED";/);
    expect(byName("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED").owner).toMatch(/^app\/lib\/computation\/diagnostic-runner\.ts:(\d+)$/);
    expect(Number(byName("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED").owner.split(":")[1])).toBeGreaterThan(755);
    const simulate = lines("app/api/simulate/route.ts");
    expect(simulate[203]).toContain("if (e instanceof DiagnosticRunnerError) return Response.json({ error: e.message }, { status: 503 });");
    expect(lines("app/lib/computation/request-executors.ts")[116]).toContain('return refused(error instanceof DiagnosticRunnerError ? error.code : "RUNNER_FAILED");');
  });

  it("9. .env.example declares SIRKIT_DIAGNOSTIC_RUNNER_DISABLED commented and empty, after the MCP block (:79); nothing in the inventory enables production simulation", () => {
    const example = lines(".env.example");
    const at = example.findIndex((line) => line === "# SIRKIT_DIAGNOSTIC_RUNNER_DISABLED=");
    expect(at).toBeGreaterThan(78);
    expect(example.filter((line) => /^SIRKIT_DIAGNOSTIC_RUNNER_DISABLED=/.test(line))).toEqual([]);
    expect(example.slice(Math.max(0, at - 4), at).join(NEWLINE)).toMatch(/non-blank/);
    expect(FLAG_INVENTORY.filter((entry) => /SIMULAT|SANDBOX/.test(entry.name))).toEqual([]);
  });

  it("10. [B24-A1 review] coverage-6: the switch's reach, stated as it is - every run and every install check refuse first; a version line already probed for a verified install is answered from memory, with no refusal, no host read and no process; the page and the runner say so and never claim `every entry`", async () => {
    // the runner's per-process state (diagnostic-runner.ts keeps it on globalThis under this key): seed one probed version line
    const runner = (globalThis as unknown as Record<symbol, { versions: Map<string, string> } | undefined>)[Symbol.for("sirkit.computation.diagnostic-runner.v2")];
    expect(runner?.versions).toBeInstanceOf(Map);
    const probed = "c".repeat(64);
    runner!.versions.set(probed, "ngspice-46 (b24-a1 cached fake)");
    pinnedFakeHost();
    vi.stubEnv("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED", "1");
    expect(await diagnosticNgspiceVersion({ verified: probed })).toEqual({ version: "ngspice-46 (b24-a1 cached fake)", installDigest: probed });
    expect(hostReads.count).toBe(0);
    expect(diagnosticRunnerState()).toMatchObject({ running: 0, queued: 0, installChecks: 0 });
    // no verified digest: the install check comes first and refuses; a verified digest with no line goes to a run, which refuses
    expect(await refusal(diagnosticNgspiceVersion())).toBe("NGSPICE_DIAGNOSTIC_DISABLED");
    expect(await refusal(diagnosticNgspiceVersion({ verified: "d".repeat(64) }))).toBe("NGSPICE_DIAGNOSTIC_DISABLED");
    expect(hostReads.count).toBe(0);
    // the statements
    const page = read(PAGE);
    const switchSection = page.slice(page.indexOf(`${NEWLINE}## 3. `), page.indexOf(`${NEWLINE}## 4. `));
    const appended = lines("app/lib/computation/diagnostic-runner.ts").slice(755).join(NEWLINE);
    const lead = page.slice(page.indexOf(`${NEWLINE}## 13. `), page.indexOf(`${NEWLINE}## 14. `));
    for (const [where, text] of [["page section 3", switchSection], ["page section 13", lead], ["diagnostic-runner.ts after :755", appended]] as const) expect(text, where).not.toMatch(/every entry/i);
    expect(switchSection).toMatch(/every run and every install check/);
    expect(switchSection).toMatch(/answered from memory/);
    expect(appended).toMatch(/every run and every install check/);
    expect(lead).toMatch(/\(i\)[^\n]*answered from memory/);
  });
});
