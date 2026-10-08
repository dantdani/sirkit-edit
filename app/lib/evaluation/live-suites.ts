/**
 * [B24-B3] The opt-in live suites and the non-live opt-in gates, as data, with the one gate they share (D24-19, OD-209; runbook B24-E
 * `:1123` "If any resource is unavailable, mark that gate `BLOCKED-LIVE-QUALIFICATION`; do not convert a fake-backed result into a live
 * claim." and `:147` "Missing evidence must remain missing or unknown; never invent a pass.").
 *
 * A registered suite runs on its flag alone, and inside each gated block it registers `beforeAll(() => assertLiveResources(id))` once:
 * with the flag set and a resource absent the block fails `NOT EXERCISED: <id>: <names> absent while <flag> is set` before any case
 * body runs, never skips and never passes. Without the flag it skips, and its state is `not exercised`. `LIVE_SUITES` holds the suites
 * whose flag arms a live resource (a model, an identity platform, a distributor, a real executable); `NON_LIVE_GATES` holds the opt-ins
 * whose flag arms a scheduled or otherwise non-live run, set only by the CI job the entry names (lead decision D2): such an entry
 * carries no catalog class and no LB id. `b24-b3-live-suite-honesty` holds every line-start `.runIf(`/`.skipIf(` gate of the tree to
 * one of four kinds, these two registries among them, and pins this data to B24-B1's catalog, the register and the workflows.
 *
 * Pure in the manner of app/lib/db/test-qualification.ts: no test-framework import and no side effect. It reads an environment only as
 * a parameter (`process.env` by default) and the file system only to ask whether a named absolute path exists; it reports names, never
 * a value.
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { EvalClass } from "./golden-catalog";

export type LiveEnvironment = Readonly<Record<string, string | undefined>>;

/** How a flag arms its suite: exactly "1", or a path (set when non-empty; the path is then also its resource). */
export type LiveFlagKind = "exact-1" | "path";
export interface LiveFlag {
  readonly name: string;
  readonly kind: LiveFlagKind;
  /** The flag's value, read by its name (so the environment-name census sees each name where it is read). */
  readonly read: (env: LiveEnvironment) => string | undefined;
}

/** A resource, by name only, with its check. */
export type LiveResource =
  | { readonly check: "set"; readonly name: string }
  | { readonly check: "oneOf"; readonly names: readonly string[] }
  | { readonly check: "absolutePathExists"; readonly name: string }
  | { readonly check: "pattern"; readonly name: string; readonly pattern: string; readonly flags: string }
  | { readonly check: "hostPlatform"; readonly platform: string };
export const LIVE_RESOURCE_CHECKS = Object.freeze(["set", "oneOf", "absolutePathExists", "pattern", "hostPlatform"] as const);

/** What the records say: a run exercised the resource (with the record that says so), or none did and why. */
export type RecordedState =
  | { readonly state: "exercised"; readonly date: string; readonly record: string; readonly outcome: string }
  | { readonly state: "not exercised"; readonly reason: string };

export interface LiveSuiteEntry {
  /** the file stem */
  readonly id: string;
  readonly path: string;
  readonly flag: LiveFlag;
  readonly resources: readonly LiveResource[];
  /** a sub-resource that gates one case only (that case is skipped without it, never passed) */
  readonly optional: readonly LiveResource[];
  /** B24-B1's class, equal to the catalog row that links the suite (the two unlinked entries state theirs, OD-230) */
  readonly evaluationClass: EvalClass;
  /** register LB ids; empty only for a lead-local resource with a recorded exercised run */
  readonly blockers: readonly string[];
  readonly recorded: RecordedState;
}

/** The closed kinds of a non-live gate: `scheduled-benchmark` when its job runs only on schedule or dispatch, `non-live` otherwise. */
export const NON_LIVE_GATE_KINDS = Object.freeze(["scheduled-benchmark", "non-live"] as const);
export type NonLiveGateKind = (typeof NON_LIVE_GATE_KINDS)[number];
export interface NonLiveGateEntry {
  readonly id: string;
  readonly path: string;
  readonly kind: NonLiveGateKind;
  readonly flag: LiveFlag & { readonly kind: "exact-1" };
  /** the CI job that sets the flag: its workflow file and job id */
  readonly job: { readonly workflow: string; readonly id: string };
  readonly resources: readonly LiveResource[];
  /** the CI state only: `exercised` only with a record of a run of the job it names */
  readonly recorded: RecordedState;
  /** a measured local run, by its log's name: never the recorded state, never a run in CI */
  readonly localRun?: { readonly date: string; readonly log: string; readonly result: string };
}

const NGSPICE_PINNED: readonly LiveResource[] = [
  { check: "absolutePathExists", name: "SIRKIT_NGSPICE_INSTALL_ROOT" },
  { check: "set", name: "SIRKIT_NGSPICE_INSTALL_SHA256" },
  { check: "hostPlatform", platform: "win32-x64" },
];

const ENTRIES: readonly LiveSuiteEntry[] = [
  {
    id: "assist-live",
    path: "app/api/pcb/edit/__tests__/assist-live.test.ts",
    flag: { name: "PCB_ASSIST_LIVE", kind: "exact-1", read: (env) => env.PCB_ASSIST_LIVE },
    resources: [{ check: "set", name: "ANTHROPIC_API_KEY" }],
    optional: [],
    evaluationClass: "model_in_loop",
    blockers: ["LB-2", "LB-7"],
    recorded: { state: "not exercised", reason: "no run with the flag and a funded Anthropic key is recorded; before B24-B3 its request was refused 400 before any model call, and the route would have sent it to OpenAI (D24-18)" },
  },
  {
    id: "b19-e-live-contract",
    path: "app/lib/acquisition/__tests__/b19-e-live-contract.test.ts",
    flag: { name: "SIRKIT_LIVE_ACQUISITION_CONTRACT", kind: "exact-1", read: (env) => env.SIRKIT_LIVE_ACQUISITION_CONTRACT },
    resources: [{ check: "set", name: "DIGIKEY_CLIENT_ID" }, { check: "set", name: "DIGIKEY_CLIENT_SECRET" }, { check: "oneOf", names: ["OCTOPART_API_KEY", "NEXAR_API_KEY"] }],
    optional: [],
    evaluationClass: "external_provider_staging",
    blockers: ["LB-15"],
    recorded: { state: "not exercised", reason: "no vendor credentials in any execution environment (artifacts/ai-control-plane-b19/final-verdict.md:27)" },
  },
  {
    id: "b16-1b-live-qualification",
    path: "app/lib/auth/__tests__/b16-1b-live-qualification.test.ts",
    flag: { name: "SIRKIT_LIVE_AUTH_QUALIFICATION", kind: "exact-1", read: (env) => env.SIRKIT_LIVE_AUTH_QUALIFICATION },
    resources: [
      { check: "pattern", name: "SIRKIT_AUTH_QUALIFICATION_PROJECT", pattern: "^sirkit-auth-qualification-[a-z0-9-]+$", flags: "i" },
      { check: "set", name: "SIRKIT_AUTH_QUALIFICATION_BASE_URL" },
      { check: "set", name: "SIRKIT_AUTH_QUALIFICATION_EMAIL" },
      { check: "set", name: "SIRKIT_AUTH_QUALIFICATION_PASSWORD" },
      { check: "set", name: "SIRKIT_AUTH_QUALIFICATION_PROJECT_ID" },
    ],
    optional: [{ check: "set", name: "SIRKIT_AUTH_QUALIFICATION_DATABASE_URL" }],
    evaluationClass: "external_provider_staging",
    blockers: ["LB-1", "LB-13"],
    recorded: { state: "not exercised", reason: "no isolated Supabase project or qualification account exists (LB-1, OD-6, OD-191)" },
  },
  {
    id: "kicad-cli-oracle",
    path: "app/lib/pcb/__tests__/kicad-cli-oracle.test.ts",
    flag: { name: "KICAD_CLI", kind: "path", read: (env) => env.KICAD_CLI },
    resources: [{ check: "absolutePathExists", name: "KICAD_CLI" }],
    optional: [],
    evaluationClass: "physical_hardware",
    blockers: ["LB-17"],
    recorded: { state: "not exercised", reason: "no run is recorded; before B24-B3 its first case exported an empty board, so its comparison could not have run as titled (D24-19)" },
  },
  {
    id: "worker-integration",
    path: "app/lib/spice/__tests__/worker-integration.test.ts",
    flag: { name: "SPICE_WORKER_LIVE", kind: "exact-1", read: (env) => env.SPICE_WORKER_LIVE },
    resources: NGSPICE_PINNED,
    optional: [],
    evaluationClass: "physical_hardware",
    blockers: ["LB-10"],
    recorded: { state: "not exercised", reason: "no run with the flag and the pinned ngspice install is recorded (the B22 records name it only as skipped)" },
  },
  {
    id: "b22-a3-runner-live",
    path: "app/lib/computation/__tests__/b22-a3-runner-live.test.ts",
    flag: { name: "SIRKIT_B22_LIVE_RUNNER", kind: "exact-1", read: (env) => env.SIRKIT_B22_LIVE_RUNNER },
    resources: NGSPICE_PINNED,
    optional: [],
    evaluationClass: "physical_hardware",
    blockers: ["LB-10"],
    recorded: { state: "exercised", date: "2026-10-01", record: "artifacts/ai-control-plane-b22/discovery.md:569", outcome: "the lead's run with the pinned install: 4 of 5 at first (case 4's deck never simulated), then 5 of 5; case 5 CONFIRMED that ngspice's echo of USERPROFILE expands to the server's value (OD-156)" },
  },
  {
    id: "b22-d-adversarial-live",
    path: "app/lib/computation/__tests__/b22-d-adversarial-live.test.ts",
    flag: { name: "SIRKIT_B22_LIVE_RUNNER", kind: "exact-1", read: (env) => env.SIRKIT_B22_LIVE_RUNNER },
    resources: NGSPICE_PINNED,
    optional: [],
    evaluationClass: "physical_hardware",
    blockers: ["LB-10"],
    recorded: { state: "exercised", date: "2026-10-02", record: "artifacts/ai-control-plane-b22/adversarial-matrix.md:323", outcome: "the lead's run with the pinned install: 12 of 13 passed; case 4 (symlink/hardlink tricks) NOT CONTAINED" },
  },
];

const GATES: readonly NonLiveGateEntry[] = [
  {
    id: "b24-b2-corpus-nightly",
    path: "app/lib/qualification/__tests__/b24-b2-corpus-nightly.test.ts",
    kind: "scheduled-benchmark",
    flag: { name: "SIRKIT_B24_CORPUS_NIGHTLY", kind: "exact-1", read: (env) => env.SIRKIT_B24_CORPUS_NIGHTLY },
    job: { workflow: ".github/workflows/benchmark.yml", id: "benchmark-nightly" },
    resources: [],
    recorded: { state: "not exercised", reason: "no scheduled or dispatched run of benchmark-nightly is recorded since B24-B2 admitted the suite" },
    localRun: { date: "2026-10-08", log: "b2-corpus-flagged-2", result: "red: 51 passed, 2 blocked, 5 failing of 58 - the three CD-9 packages fail correctness (D24-41, owned by B24-D1)" },
  },
];

const freezeResources = (resources: readonly LiveResource[]): readonly LiveResource[] => Object.freeze(resources.map((resource) => Object.freeze(resource.check === "oneOf" ? { ...resource, names: Object.freeze([...resource.names]) } : { ...resource })));
export const LIVE_SUITES: readonly LiveSuiteEntry[] = Object.freeze(ENTRIES.map((entry) => Object.freeze({ ...entry, flag: Object.freeze({ ...entry.flag }), resources: freezeResources(entry.resources), optional: freezeResources(entry.optional), blockers: Object.freeze([...entry.blockers]), recorded: Object.freeze({ ...entry.recorded }) })));
export const NON_LIVE_GATES: readonly NonLiveGateEntry[] = Object.freeze(GATES.map((entry) => Object.freeze({ ...entry, flag: Object.freeze({ ...entry.flag }), job: Object.freeze({ ...entry.job }), resources: freezeResources(entry.resources), recorded: Object.freeze({ ...entry.recorded }), ...(entry.localRun ? { localRun: Object.freeze({ ...entry.localRun }) } : {}) })));

/** The state of one registered suite or gate: names only, never a value. */
export type LiveSuiteState =
  | { readonly state: "not_exercised"; readonly reason: "flag_unset" }
  | { readonly state: "not_exercised"; readonly reason: "resource_absent"; readonly missing: string[] }
  | { readonly state: "requested" };

/** This host as the diagnostic runner names a platform (`win32-x64`, `linux-x64`). */
export function hostPlatform(): string {
  return `${process.platform}-${process.arch}`;
}

/** Each resource's name as a message or a page states it. */
export function resourceLabels(resources: readonly LiveResource[]): string[] {
  return resources.map((resource) => (resource.check === "oneOf" ? resource.names.join(" or ") : resource.check === "hostPlatform" ? `host ${resource.platform}` : resource.name));
}

const filled = (value: string | undefined): value is string => typeof value === "string" && value !== "";
function present(resource: LiveResource, env: LiveEnvironment, exists: (path: string) => boolean, platform: string): boolean {
  switch (resource.check) {
    case "set":
      return filled(env[resource.name]);
    case "oneOf":
      return resource.names.some((name) => filled(env[name]));
    case "absolutePathExists": {
      const value = env[resource.name];
      return filled(value) && isAbsolute(value.trim()) && exists(resolve(value.trim()));
    }
    case "pattern":
      return filled(env[resource.name]) && new RegExp(resource.pattern, resource.flags).test(env[resource.name]!);
    case "hostPlatform":
      return platform === resource.platform;
  }
}

/** Is the flag set: exactly "1", or (a path flag) any non-empty value, as the suite's own gate reads it. */
export function liveFlagSet(flag: LiveFlag, env: LiveEnvironment): boolean {
  const value = flag.read(env);
  return flag.kind === "exact-1" ? value === "1" : typeof value === "string" && value !== "";
}

/** The state of a registered suite or gate under `env`: the flag first, then every resource, by name. */
export function liveSuiteState(entry: LiveSuiteEntry | NonLiveGateEntry, env: LiveEnvironment, exists: (path: string) => boolean = existsSync, platform: string = hostPlatform()): LiveSuiteState {
  if (!liveFlagSet(entry.flag, env)) return { state: "not_exercised", reason: "flag_unset" };
  const missing = entry.resources.filter((resource) => !present(resource, env, exists, platform));
  return missing.length > 0 ? { state: "not_exercised", reason: "resource_absent", missing: resourceLabels(missing) } : { state: "requested" };
}

/** The registered suite or gate with this id, or a loud failure. */
export function liveSuite(id: string): LiveSuiteEntry | NonLiveGateEntry {
  const entry = [...LIVE_SUITES, ...NON_LIVE_GATES].find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`LIVE_SUITE_UNKNOWN: ${id}`);
  return entry;
}

/** The gate each registered block runs first: it throws `NOT EXERCISED` when the flag is set and a resource is absent (names only). */
export function assertLiveResources(id: string, env: LiveEnvironment = process.env): LiveSuiteState {
  const entry = liveSuite(id);
  const state = liveSuiteState(entry, env);
  if (state.state === "not_exercised" && state.reason === "resource_absent") throw new Error(`NOT EXERCISED: ${id}: ${state.missing.join(", ")} absent while ${entry.flag.name} is set`);
  return state;
}
