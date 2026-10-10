/**
 * [B24-A2] D24-4, OD-195 - the environment-name census: data only, no import (so neither the worker-principal nor the mcp-bearer
 * import gate can trip: b16-0-1-ci-gates.test.ts:247-264, b20-b2-import-gates.test.ts:74), and nothing here reads the environment.
 *
 * One row per name the code reads: the name, its class, its reader (a repository path whose code holds the name) and, for an
 * undeclared class, the reason. `b24-a2-env-names` re-derives the names from the tree (a TypeScript scan, comments ignored: reads
 * off `process.env` or an identifier named `env` or `environment`, string literals of environment-name shape under a closed prefix
 * list, and the names that come from data) and holds every hit to a row, every row to its reader, B24-A1's flag inventory to the
 * kind -> class map below, and `.env.example` to the declared classes: each declared once, nothing else declared.
 *
 * The classes are closed. Declared in `.env.example`: secret, configuration, flag, rotation-previous. Not declared, each for its
 * reason (UNDECLARED_CLASS_REASONS): fixture, qualification-opt-in, platform, child-passthrough, not-an-environment-name.
 * OD-195 as applied narrows "`.env.example` declares every name the code reads" to "every name of a declared class".
 */

export const ENVIRONMENT_NAME_CLASSES = Object.freeze(["secret", "configuration", "flag", "rotation-previous", "fixture", "qualification-opt-in", "platform", "child-passthrough", "not-an-environment-name"] as const);
export type EnvironmentNameClass = (typeof ENVIRONMENT_NAME_CLASSES)[number];
export const DECLARED_ENVIRONMENT_NAME_CLASSES = Object.freeze(["secret", "configuration", "flag", "rotation-previous"] as const);
type UndeclaredClass = Exclude<EnvironmentNameClass, (typeof DECLARED_ENVIRONMENT_NAME_CLASSES)[number]>;

/** Why a class is not declared in `.env.example`. */
export const UNDECLARED_CLASS_REASONS: Readonly<Record<UndeclaredClass, string>> = Object.freeze({
  fixture: "honoured only outside production: it selects a fixture runtime, a scripted agent, a recorded router or a frozen clock for tests and the browser proof, and a deployment never sets it",
  "qualification-opt-in": "arms an opt-in test or live run (a real-database qualification, a live evaluation, a router recording); CI and a deployment never set it",
  platform: "set by the runtime, the toolchain or the test harness - NODE_ENV, NEXT_RUNTIME, NODE_OPTIONS and the like - never by a Sirkit operator",
  "child-passthrough": "handed through to a child process (KICAD_CONFIG_HOME to kicad-cli, from the operator's environment); Sirkit never reads it for itself",
  "not-an-environment-name": "a literal that only looks like an environment name - SIRKIT_D1N4148 is a SPICE model name, the others refusal codes; nothing reads it from an environment",
});

/** D16: B24-A1's flag-inventory kinds -> census classes (a `secret` whose name ends in _PREVIOUS is `rotation-previous`). */
export const FLAG_KIND_TO_CLASS = Object.freeze({
  "enable-flag": "flag",
  "disable-switch": "flag",
  "rollout-stage": "flag",
  shadow: "flag",
  fixture: "fixture",
  "live-test-gate": "qualification-opt-in",
  configuration: "configuration",
  secret: "secret",
  tooling: "platform",
} as const);

export interface EnvironmentNameRow {
  readonly name: string;
  readonly class: EnvironmentNameClass;
  /** a repository path whose code (comments aside) holds the name */
  readonly reader: string;
  /** null for a declared class; why it is not declared otherwise */
  readonly reason: string | null;
}

const declared = (name: string, cls: (typeof DECLARED_ENVIRONMENT_NAME_CLASSES)[number], reader: string): EnvironmentNameRow => ({ name, class: cls, reader, reason: null });
const undeclared = (name: string, cls: UndeclaredClass, reader: string, reason: string): EnvironmentNameRow => ({ name, class: cls, reader, reason });

const ROWS: readonly EnvironmentNameRow[] = [
  // ── secret ──
  declared("ANTHROPIC_API_KEY", "secret", "app/lib/llm/anthropic-provider.ts"),
  declared("DATABASE_URL", "secret", "app/lib/db/client.ts"),
  declared("DIGIKEY_CLIENT_ID", "secret", "app/lib/acquisition/source-registry.ts"),
  declared("DIGIKEY_CLIENT_SECRET", "secret", "app/lib/acquisition/source-registry.ts"),
  declared("HF_TOKEN", "secret", "app/lib/schgen/endpoint-client.ts"),
  declared("KICAD_HTTP_LIBRARY_TOKEN", "secret", "app/lib/atomic/server-auth.ts"),
  declared("MOUSER_API_KEY", "secret", "app/lib/acquisition/source-registry.ts"),
  declared("NEXAR_API_KEY", "secret", "app/lib/acquisition/source-registry.ts"),
  declared("OCTOPART_API_KEY", "secret", "app/lib/acquisition/source-registry.ts"),
  declared("OPENAI_API_KEY", "secret", "app/lib/llm/openai-provider.ts"),
  declared("SCHGEN_ENDPOINT_TOKEN", "secret", "app/lib/schgen/endpoint-client.ts"),
  declared("SIRKIT_DB_QUALIFICATION_URL", "secret", "app/lib/db/test-qualification.ts"),
  declared("SIRKIT_MCP_TOKEN_SECRET", "secret", "app/lib/auth/mcp-bearer.ts"),
  declared("SIRKIT_WORKFLOW_WORKER_SECRET", "secret", "app/lib/auth/worker-principal.ts"),
  // ── rotation-previous (verification only) ──
  declared("KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS", "rotation-previous", "app/lib/atomic/server-auth.ts"),
  declared("SIRKIT_MCP_TOKEN_SECRET_PREVIOUS", "rotation-previous", "app/lib/auth/mcp-bearer.ts"),
  declared("SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS", "rotation-previous", "app/lib/auth/worker-principal.ts"),
  // ── configuration ──
  declared("FREEROUTING_JAR", "configuration", "app/lib/pcb/autoroute/runtime.ts"),
  declared("FREEROUTING_JAVA", "configuration", "app/lib/pcb/autoroute/runtime.ts"),
  declared("JAVA_HOME", "configuration", "app/lib/pcb/autoroute/runtime.ts"),
  declared("KICAD_CLI", "configuration", "app/lib/pcb/fab/build-bundle.ts"),
  declared("NEXT_PUBLIC_SUPABASE_ANON_KEY", "configuration", "app/lib/auth/mode.ts"),
  declared("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "configuration", "app/lib/auth/mode.ts"),
  declared("NEXT_PUBLIC_SUPABASE_URL", "configuration", "app/lib/auth/mode.ts"),
  declared("SCHGEN_ENDPOINT_URL", "configuration", "app/lib/schgen/endpoint-client.ts"),
  declared("SIRKIT_ANTHROPIC_MODEL", "configuration", "app/lib/llm/anthropic-config.ts"),
  declared("SIRKIT_ATOMIC_CATALOG_PROJECT_ID", "configuration", "app/lib/atomic/publication-review.ts"),
  declared("SIRKIT_ATOMIC_CATALOG_TENANT_ID", "configuration", "app/lib/atomic/publication-review.ts"),
  declared("SIRKIT_AUTH_MODE", "configuration", "app/lib/auth/mode.ts"),
  declared("SIRKIT_DB_POOL_MAX", "configuration", "app/lib/db/client.ts"),
  declared("SIRKIT_DEPLOYMENT_ENV", "configuration", "app/lib/auth/deployment-profile.ts"),
  declared("SIRKIT_EXPECTED_ORIGIN", "configuration", "app/lib/auth/expected-origin.ts"),
  declared("SIRKIT_FREEROUTING_INSTALL_ROOT", "configuration", "app/lib/computation/runtime-profile.ts"),
  declared("SIRKIT_FREEROUTING_INSTALL_SHA256", "configuration", "app/lib/computation/runtime-profile.ts"),
  declared("SIRKIT_KICAD_CLI_INSTALL_ROOT", "configuration", "app/lib/computation/runtime-profile.ts"),
  declared("SIRKIT_KICAD_CLI_INSTALL_SHA256", "configuration", "app/lib/computation/runtime-profile.ts"),
  declared("SIRKIT_NGSPICE_INSTALL_ROOT", "configuration", "app/lib/computation/runtime-profile.ts"),
  declared("SIRKIT_NGSPICE_INSTALL_SHA256", "configuration", "app/lib/computation/runtime-profile.ts"),
  declared("SIRKIT_NGSPICE_OCI_IMAGE", "configuration", "app/lib/computation/runtime-profile.ts"),
  declared("SIRKIT_OCI_CLI_PATH", "configuration", "app/lib/computation/runtime-profile.ts"),
  declared("SIRKIT_OCI_CLI_SHA256", "configuration", "app/lib/computation/runtime-profile.ts"),
  declared("SIRKIT_OPENAI_MODEL", "configuration", "app/lib/llm/openai-config.ts"),
  declared("SIRKIT_OPENAI_REASONING_EFFORT", "configuration", "app/lib/llm/openai-config.ts"),
  declared("SIRKIT_ORCHESTRATION_ROLE_MODELS", "configuration", "app/lib/agent/orchestration/provider-policy.ts"), declared("SIRKIT_TRUSTED_CLIENT_IP_HEADER", "configuration", "app/lib/auth/abuse-limits.ts"), // [B24-A3, 2026-10-06] appended on this line, configuration by D16's map from A1's kind (OD-197)
  // ── flag ──
  declared("SIRKIT_ACQUISITION_DISABLED_SOURCES", "flag", "app/lib/acquisition/source-registry.ts"),
  declared("SIRKIT_ASSIGNMENT_QUEUE_STAGE6", "flag", "app/lib/assignment-queue/rollout.ts"),
  declared("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED", "flag", "app/lib/computation/diagnostic-runner.ts"),
  declared("SIRKIT_FOOTPRINT_RESOLVER_SHADOW", "flag", "app/lib/footprint-resolver/shadow.ts"),
  declared("SIRKIT_MANUFACTURING_DISABLED_PROVIDERS", "flag", "app/lib/manufacturing-providers/provider-admission.ts"),
  declared("SIRKIT_MAPPING_STAGE4", "flag", "app/lib/mapping-verification/rollout.ts"),
  declared("SIRKIT_MCP_DISABLED_SERVERS", "flag", "app/lib/mcp/rollout.ts"),
  declared("SIRKIT_MCP_ENABLED", "flag", "app/lib/mcp/rollout.ts"),
  declared("SIRKIT_NAMED_COMPUTATIONS", "flag", "app/api/chat/computation-runtime.ts"),
  declared("SIRKIT_ORCHESTRATION_ENABLED", "flag", "app/api/chat/orchestration-runtime.ts"),
  declared("SIRKIT_ORDERING_DISABLED", "flag", "app/lib/manufacturing-providers/ordering-enablement.ts"),
  declared("SIRKIT_PASSIVE_POLICY_STAGE5", "flag", "app/lib/passive-policy/rollout.ts"),
  declared("SIRKIT_PCB_SYNC_STAGE3", "flag", "app/lib/pcb-sync/rollout.ts"),
  declared("SIRKIT_PHYSICAL_BINDING_SHADOW", "flag", "app/lib/physical-binding/shadow.ts"),
  // ── fixture ──
  undeclared("SIRKIT_FIXTURE_AGENT", "fixture", "app/lib/agent/fixture-agent-adapter.ts", "the scripted agent for the browser proof, honoured only under the fixture runtime"),
  undeclared("SIRKIT_FIXTURE_CLOCK", "fixture", "app/lib/fixture-runtime/clock.ts", "the fixture runtime's frozen clock (the pinned release identities depend on it)"),
  undeclared("SIRKIT_FIXTURE_ROUTER", "fixture", "app/lib/fixture-runtime/router.ts", "replay or record the committed router recording, under the fixture runtime only"),
  undeclared("SIRKIT_FIXTURE_ROUTER_DUMP", "fixture", "app/lib/fixture-runtime/router.ts", "a folder the fixture router dumps its runs to, for re-recording only"),
  undeclared("SIRKIT_FIXTURE_ROUTER_FIXTURE", "fixture", "app/lib/fixture-runtime/router.ts", "the router recording the fixture runtime replays, for tests and the browser proof"),
  undeclared("SIRKIT_FIXTURE_RUNTIME", "fixture", "app/lib/fixture-runtime/mode.ts", "the fixture runtime itself (blinker); refused in a production runtime"),
  // ── qualification-opt-in ──
  undeclared("SIRKIT_B16_1C_RECORD_ROUTES", "qualification-opt-in", "app/lib/pcb/autonomous/router-fixture.ts", "re-records B16-1C's router fixtures with the local router, an operator's opt-in"), /* [B24-B3, 2026-10-08] D24-19, OD-209: the opt-in live suites' flags and resources, read by name in B24-B3's registry; appended on these lines so no line moves (D16: live-test-gate -> qualification-opt-in) */ undeclared("PCB_ASSIST_LIVE", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "arms the opt-in assist-live suite against a real Anthropic model (provider credit)"), undeclared("SPICE_WORKER_LIVE", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "arms the opt-in SPICE worker suite against the pinned local ngspice install"), undeclared("SIRKIT_B22_LIVE_RUNNER", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "arms B22's two opt-in live suites against the pinned local ngspice install"), undeclared("SIRKIT_B24_CORPUS_NIGHTLY", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "arms B24-B2's corpus run, set only by benchmark-nightly's vitest step (a non-live gate, lead decision D2)"),
  undeclared("SIRKIT_DB_QUALIFICATION", "qualification-opt-in", "app/lib/db/test-qualification.ts", "the marker that arms the opt-in real-database qualification suites"), undeclared("SIRKIT_LIVE_AUTH_QUALIFICATION", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "arms the opt-in live production-auth matrix against an isolated Supabase project"), undeclared("SIRKIT_AUTH_QUALIFICATION_PROJECT", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "the isolated-project marker the live-auth matrix requires (a sirkit-auth-qualification- name)"), undeclared("SIRKIT_AUTH_QUALIFICATION_BASE_URL", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "the address of the production-mode server the live-auth matrix calls"), undeclared("SIRKIT_AUTH_QUALIFICATION_PROJECT_ID", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "the project the live-auth qualification account is a member of"),
  undeclared("SIRKIT_LIVE_ORCHESTRATION_EVALUATION", "qualification-opt-in", "scripts/run-b21-live-orchestration-evaluation.ts", "arms B21's record-only live orchestration evaluation (provider credit)"),
  undeclared("SIRKIT_LIVE_ORCHESTRATION_PROVIDER", "qualification-opt-in", "scripts/run-b21-live-orchestration-evaluation.ts", "selects the provider of B21's live orchestration evaluation"), /* [B24-D1, 2026-10-09] D24-27, D24-28, OD-212 (lead decisions D15, D16): the benchmark flag (live-test-gate -> qualification-opt-in: measurement only, set by benchmark-latency's vitest step env), the results directory and the CI start second (tooling -> platform: set by the job, never by an operator), and GITHUB_STEP_SUMMARY, the runner's step-summary path the headroom script and the latency gate append to when set (platform; no inventory entry: not a Sirkit name); appended on these lines so no line moves */ undeclared("SIRKIT_B24_BENCHMARK", "qualification-opt-in", "app/lib/qualification/latency-results-writer.ts", "arms B24-D1's two latency benchmark suites (measurement only; a non-live gate), set only by benchmark-latency's vitest step; never by an operator or a deployment"), undeclared("SIRKIT_B24_BENCHMARK_DIR", "platform", "app/lib/qualification/latency-results-writer.ts", "the absolute results directory outside the repository the benchmark-latency job sets in its env (the writer refuses an unset, relative or in-repository path)"), undeclared("SIRKIT_JOB_STARTED_AT", "platform", "scripts/ci-job-headroom.ts", "the job's start second, set by a CI job's first step into GITHUB_ENV and read by the OD-30 headroom step only; never a flag"), undeclared("GITHUB_STEP_SUMMARY", "platform", "scripts/ci-job-headroom.ts", "GitHub Actions' step-summary file, set by the runner for every step; the OD-30 headroom step and B24-D1's latency gate append one table to it when set, and write nothing else to it; never a flag"), undeclared("SIRKIT_AUTH_QUALIFICATION_EMAIL", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "the dedicated qualification account's sign-in name for the live-auth matrix"), undeclared("SIRKIT_AUTH_QUALIFICATION_PASSWORD", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "the dedicated qualification account's credential for the live-auth matrix (never logged)"), undeclared("SIRKIT_AUTH_QUALIFICATION_DATABASE_URL", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "the isolated project's database for the live-auth membership canary (optional)"), undeclared("SIRKIT_LIVE_ACQUISITION_CONTRACT", "qualification-opt-in", "app/lib/evaluation/live-suites.ts", "arms the operator-run live distributor contract check (vendor quota)"),
  // ── platform ──
  undeclared("LC_ALL", "platform", "app/lib/computation/runtime-profile.ts", "the locale a runtime profile requires of a child process environment (C)"),
  undeclared("NEXT_RUNTIME", "platform", "instrumentation.ts", "set by Next.js: nodejs or edge, read by the instrumentation hook"),
  undeclared("NODE_ENV", "platform", "app/lib/auth/mode.ts", "set by Next.js and the toolchain; production is the production runtime (mode.ts)"),
  undeclared("NODE_OPTIONS", "platform", "app/lib/computation/engine-host.ts", "the Node.js options of the process, read for its heap flags"),
  undeclared("SIRKIT_E2E_BASE_URL", "platform", "scripts/e2e-prompt-to-gerber.ts", "the acceptance driver's server address, a developer tool"),
  undeclared("SIRKIT_E2E_ORCHESTRATION_PORT", "platform", "playwright.orchestration.config.ts", "the port of the orchestration browser proof's server, a test harness setting"),
  undeclared("SIRKIT_E2E_PORT", "platform", "scripts/dev-fixture.mjs", "the port of the fixture browser proof's server, a test harness setting"),
  undeclared("TZ", "platform", "app/lib/computation/runtime-profile.ts", "the time zone a runtime profile requires of a child process environment (UTC)"),
  // ── child-passthrough ──
  undeclared("KICAD_CONFIG_HOME", "child-passthrough", "app/lib/pcb/fab/kicad-cli-runner.ts", "kicad-cli's own configuration folder, passed through from the operator's environment to the child only"),
  // ── not-an-environment-name ──
  undeclared("SIRKIT_ANTHROPIC_MODEL_EMPTY", "not-an-environment-name", "app/lib/llm/anthropic-config.ts", "a refusal code of the Anthropic model setting (an empty value), never read from an environment"),
  undeclared("SIRKIT_ANTHROPIC_MODEL_PADDED", "not-an-environment-name", "app/lib/llm/anthropic-config.ts", "a refusal code of the Anthropic model setting (a padded value), never read from an environment"),
  undeclared("SIRKIT_D1N4148", "not-an-environment-name", "app/lib/spice/ir.ts", "the name of Sirkit's own 1N4148 diode SPICE model (a .model card)"),
];

const byName = (a: EnvironmentNameRow, b: EnvironmentNameRow): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The census, sorted by name. */
export const ENVIRONMENT_NAMES: readonly EnvironmentNameRow[] = Object.freeze([...ROWS].sort(byName).map((row) => Object.freeze({ ...row })));
