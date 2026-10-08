/**
 * [B24-A1] D24-11, OD-200 - the flag inventory: data only (frozen), no import; nothing here reads the environment.
 *
 * Every `SIRKIT_*` environment name read in code (comments aside) under app/, lib/, components/, scripts/, the root configs and both
 * Playwright configs, outside tests, with its kind, its default, its direction, its owner (file:line, the line that holds the name)
 * and the owner's exported name constant where one exists (null otherwise). Every other `SIRKIT_` token in that code is a reviewed
 * exclusion below, one reason each. `b24-a1-flags` re-derives the census from the tree and pins each flag's default and parse through
 * its owner, so a name read in code but missing here, or an entry whose owner moved, fails it. Live-suite flags read only by tests
 * are B24-B3's (OD-209).
 *
 * The kinds are closed. B24-A2 states and pins the map from them to its census classes (D16): enable-flag, disable-switch,
 * rollout-stage and shadow -> flag; live-test-gate -> qualification-opt-in; tooling -> platform; fixture, configuration and secret one
 * to one, except that a secret whose name ends in _PREVIOUS maps to rotation-previous (A2's refinement). A new kind is a reviewed
 * change to both.
 * The directions: `enables` (setting it can only turn something on, from an off default), `disables` (it can only turn something
 * off), `selects` (it chooses a value), `supplies` (it supplies a credential). The `rule` is how the owner parses the value, for the
 * flag kinds; the deployment configuration (configuration.ts) applies it to record each flag's state.
 */

export const FLAG_KINDS = Object.freeze(["enable-flag", "disable-switch", "rollout-stage", "shadow", "fixture", "live-test-gate", "configuration", "secret", "tooling"] as const);
export type FlagKind = (typeof FLAG_KINDS)[number];
export const FLAG_DIRECTIONS = Object.freeze(["enables", "disables", "selects", "supplies"] as const);
export type FlagDirection = (typeof FLAG_DIRECTIONS)[number];

/** How the owner parses the value: exactly one string; any non-blank value; a comma-separated list (non-empty once trimmed); a stage
 *  (trimmed and lower-cased, one of the values, else off); exactly `true` once trimmed and lower-cased; or a value it reads as given. */
export type FlagRule =
  | { readonly parse: "exact"; readonly value: string }
  | { readonly parse: "non-blank" }
  | { readonly parse: "list" }
  | { readonly parse: "stage"; readonly values: readonly string[] }
  | { readonly parse: "true" }
  | { readonly parse: "value" };

export interface FlagInventoryEntry {
  readonly name: string;
  readonly kind: FlagKind;
  /** the state (flag kinds) or the value the owner uses when the variable is unset */
  readonly default: string;
  readonly direction: FlagDirection;
  /** `file:line`, the line that holds the name (its constant's declaration, or the read itself) */
  readonly owner: string;
  readonly constant: string | null;
  readonly rule: FlagRule;
}

const EXACT_ONE: FlagRule = { parse: "exact", value: "1" };
const VALUE: FlagRule = { parse: "value" };

const ENTRIES: readonly FlagInventoryEntry[] = [
  { name: "SIRKIT_ACQUISITION_DISABLED_SOURCES", kind: "disable-switch", default: "unset", direction: "disables", owner: "app/lib/acquisition/source-registry.ts:556", constant: "OPERATOR_DISABLE_ENV", rule: { parse: "list" } },
  { name: "SIRKIT_ANTHROPIC_MODEL", kind: "configuration", default: "claude-opus-4-7", direction: "selects", owner: "app/lib/llm/anthropic-config.ts:15", constant: null, rule: VALUE },
  { name: "SIRKIT_ASSIGNMENT_QUEUE_STAGE6", kind: "rollout-stage", default: "off", direction: "enables", owner: "app/lib/assignment-queue/rollout.ts:2", constant: "ASSIGNMENT_QUEUE_FEATURE_FLAG", rule: { parse: "stage", values: ["observe", "opt_in"] } },
  { name: "SIRKIT_ATOMIC_CATALOG_PROJECT_ID", kind: "configuration", default: "unset (no catalog governance project: publication is refused)", direction: "selects", owner: "app/lib/atomic/publication-review.ts:55", constant: "ATOMIC_CATALOG_PROJECT_ENV", rule: VALUE },
  { name: "SIRKIT_ATOMIC_CATALOG_TENANT_ID", kind: "configuration", default: "unset (no catalog governance tenant: publication is refused)", direction: "selects", owner: "app/lib/atomic/publication-review.ts:57", constant: "ATOMIC_CATALOG_TENANT_ENV", rule: VALUE },
  { name: "SIRKIT_AUTH_MODE", kind: "configuration", default: "local_dev", direction: "selects", owner: "app/lib/auth/mode.ts:19", constant: "SIRKIT_AUTH_MODE_ENV", rule: VALUE },
  { name: "SIRKIT_B16_1C_RECORD_ROUTES", kind: "live-test-gate", default: "off", direction: "enables", owner: "app/lib/pcb/autonomous/router-fixture.ts:88", constant: null, rule: EXACT_ONE },
  { name: "SIRKIT_DB_POOL_MAX", kind: "configuration", default: "8", direction: "selects", owner: "app/lib/db/client.ts:41", constant: null, rule: VALUE },
  { name: "SIRKIT_DB_QUALIFICATION", kind: "live-test-gate", default: "off", direction: "enables", owner: "app/lib/db/test-qualification.ts:40", constant: "DB_QUALIFICATION_MARKER", rule: EXACT_ONE },
  { name: "SIRKIT_DB_QUALIFICATION_URL", kind: "secret", default: "unset (the database gate stays off)", direction: "supplies", owner: "app/lib/db/test-qualification.ts:42", constant: "DB_QUALIFICATION_URL", rule: VALUE },
  { name: "SIRKIT_DEPLOYMENT_ENV", kind: "configuration", default: "unset (a production runtime refuses sensitive routes)", direction: "selects", owner: "app/lib/auth/deployment-profile.ts:21", constant: "DEPLOYMENT_PROFILE_ENV", rule: VALUE },
  { name: "SIRKIT_DIAGNOSTIC_RUNNER_DISABLED", kind: "disable-switch", default: "unset", direction: "disables", owner: "app/lib/computation/diagnostic-runner.ts:764", constant: "DIAGNOSTIC_RUNNER_DISABLE_ENV", rule: { parse: "non-blank" } },
  { name: "SIRKIT_E2E_BASE_URL", kind: "tooling", default: "http://localhost:3000", direction: "selects", owner: "scripts/e2e-prompt-to-gerber.ts:29", constant: null, rule: VALUE },
  { name: "SIRKIT_E2E_ORCHESTRATION_PORT", kind: "tooling", default: "3101", direction: "selects", owner: "playwright.orchestration.config.ts:17", constant: null, rule: VALUE },
  { name: "SIRKIT_E2E_PORT", kind: "tooling", default: "3100", direction: "selects", owner: "playwright.config.ts:17", constant: null, rule: VALUE },
  { name: "SIRKIT_EXPECTED_ORIGIN", kind: "configuration", default: "unset (the request URL in local development; refused in a production runtime)", direction: "selects", owner: "app/lib/auth/expected-origin.ts:36", constant: "SIRKIT_EXPECTED_ORIGIN_ENV", rule: VALUE },
  { name: "SIRKIT_FIXTURE_AGENT", kind: "fixture", default: "unset (a model, never the scripted agent)", direction: "selects", owner: "app/lib/agent/fixture-agent-adapter.ts:33", constant: "FIXTURE_AGENT_ENV", rule: VALUE },
  { name: "SIRKIT_FIXTURE_CLOCK", kind: "fixture", default: "2026-09-09T12:00:00.000Z", direction: "selects", owner: "app/lib/fixture-runtime/clock.ts:24", constant: "FIXTURE_CLOCK_ENV", rule: VALUE },
  { name: "SIRKIT_FIXTURE_ROUTER", kind: "fixture", default: "replay", direction: "selects", owner: "app/lib/fixture-runtime/router.ts:23", constant: "FIXTURE_ROUTER_ENV", rule: VALUE },
  { name: "SIRKIT_FIXTURE_ROUTER_DUMP", kind: "fixture", default: "unset (no dump)", direction: "selects", owner: "app/lib/fixture-runtime/router.ts:27", constant: "FIXTURE_ROUTER_DUMP_ENV", rule: VALUE },
  { name: "SIRKIT_FIXTURE_ROUTER_FIXTURE", kind: "fixture", default: "unset (e2e/fixtures/blinker-route-fixture.json)", direction: "selects", owner: "app/lib/fixture-runtime/router.ts:24", constant: "FIXTURE_ROUTER_FIXTURE_ENV", rule: VALUE },
  { name: "SIRKIT_FIXTURE_RUNTIME", kind: "fixture", default: "unset (off; only blinker requests it, never in a production runtime)", direction: "selects", owner: "app/lib/fixture-runtime/mode.ts:27", constant: "FIXTURE_RUNTIME_ENV", rule: VALUE },
  { name: "SIRKIT_FOOTPRINT_RESOLVER_SHADOW", kind: "shadow", default: "off", direction: "enables", owner: "app/lib/footprint-resolver/shadow.ts:3", constant: "FOOTPRINT_RESOLVER_SHADOW_FLAG", rule: { parse: "true" } },
  { name: "SIRKIT_FREEROUTING_INSTALL_ROOT", kind: "configuration", default: "unset (no pinned install)", direction: "selects", owner: "app/lib/computation/runtime-profile.ts:513", constant: null, rule: VALUE },
  { name: "SIRKIT_FREEROUTING_INSTALL_SHA256", kind: "configuration", default: "unset (unpinned)", direction: "selects", owner: "app/lib/computation/runtime-profile.ts:36", constant: null, rule: VALUE },
  { name: "SIRKIT_KICAD_CLI_INSTALL_ROOT", kind: "configuration", default: "unset (no pinned install)", direction: "selects", owner: "app/lib/computation/runtime-profile.ts:450", constant: null, rule: VALUE },
  { name: "SIRKIT_KICAD_CLI_INSTALL_SHA256", kind: "configuration", default: "unset (unpinned)", direction: "selects", owner: "app/lib/computation/runtime-profile.ts:35", constant: null, rule: VALUE },
  { name: "SIRKIT_LIVE_ORCHESTRATION_EVALUATION", kind: "live-test-gate", default: "off", direction: "enables", owner: "scripts/run-b21-live-orchestration-evaluation.ts:32", constant: "LIVE_FLAG", rule: EXACT_ONE },
  { name: "SIRKIT_LIVE_ORCHESTRATION_PROVIDER", kind: "live-test-gate", default: "openai", direction: "selects", owner: "scripts/run-b21-live-orchestration-evaluation.ts:33", constant: "LIVE_PROVIDER_FLAG", rule: VALUE },
  { name: "SIRKIT_MANUFACTURING_DISABLED_PROVIDERS", kind: "disable-switch", default: "unset", direction: "disables", owner: "app/lib/manufacturing-providers/provider-admission.ts:23", constant: "PROVIDER_OPERATOR_DISABLE_ENV", rule: { parse: "list" } },
  { name: "SIRKIT_MAPPING_STAGE4", kind: "rollout-stage", default: "off", direction: "enables", owner: "app/lib/mapping-verification/rollout.ts:2", constant: "MAPPING_STAGE4_FLAG", rule: { parse: "stage", values: ["observe", "opt_in", "authoritative_supported_profile"] } },
  { name: "SIRKIT_MCP_DISABLED_SERVERS", kind: "disable-switch", default: "unset", direction: "disables", owner: "app/lib/mcp/rollout.ts:13", constant: "MCP_DISABLED_SERVERS_ENV", rule: { parse: "list" } },
  { name: "SIRKIT_MCP_ENABLED", kind: "enable-flag", default: "off", direction: "enables", owner: "app/lib/mcp/rollout.ts:12", constant: "MCP_ENABLED_ENV", rule: EXACT_ONE },
  { name: "SIRKIT_MCP_TOKEN_SECRET", kind: "secret", default: "unset (the MCP endpoint answers 503 MCP_NOT_CONFIGURED)", direction: "supplies", owner: "app/lib/auth/mcp-bearer.ts:35", constant: "MCP_TOKEN_SECRET_ENV", rule: VALUE }, { name: "SIRKIT_MCP_TOKEN_SECRET_PREVIOUS", kind: "secret", default: "unset (only the current key verifies)", direction: "supplies", owner: "app/lib/auth/mcp-bearer.ts:555", constant: "MCP_TOKEN_SECRET_PREVIOUS_ENV", rule: VALUE }, // [B24-A2, 2026-10-06] appended on this line (D16; deliverable 5), so the lines after it keep their numbers: the previous MCP signing key, verification only (OD-195)
  { name: "SIRKIT_NAMED_COMPUTATIONS", kind: "enable-flag", default: "off", direction: "enables", owner: "app/api/chat/computation-runtime.ts:20", constant: "NAMED_COMPUTATIONS_SETTING", rule: EXACT_ONE },
  { name: "SIRKIT_NGSPICE_INSTALL_ROOT", kind: "configuration", default: "unset (no pinned install)", direction: "selects", owner: "app/lib/computation/runtime-profile.ts:338", constant: null, rule: VALUE },
  { name: "SIRKIT_NGSPICE_INSTALL_SHA256", kind: "configuration", default: "unset (unpinned)", direction: "selects", owner: "app/lib/computation/runtime-profile.ts:33", constant: null, rule: VALUE },
  { name: "SIRKIT_NGSPICE_OCI_IMAGE", kind: "configuration", default: "unset (unpinned)", direction: "selects", owner: "app/lib/computation/runtime-profile.ts:34", constant: null, rule: VALUE },
  { name: "SIRKIT_OCI_CLI_PATH", kind: "configuration", default: "unset (no host client)", direction: "selects", owner: "app/lib/computation/runtime-profile.ts:40", constant: null, rule: VALUE },
  { name: "SIRKIT_OCI_CLI_SHA256", kind: "configuration", default: "unset (unpinned)", direction: "selects", owner: "app/lib/computation/runtime-profile.ts:40", constant: null, rule: VALUE },
  { name: "SIRKIT_OPENAI_MODEL", kind: "configuration", default: "gpt-5.6-sol", direction: "selects", owner: "app/lib/llm/openai-config.ts:41", constant: null, rule: VALUE },
  { name: "SIRKIT_OPENAI_REASONING_EFFORT", kind: "configuration", default: "high", direction: "selects", owner: "app/lib/llm/openai-config.ts:48", constant: null, rule: VALUE },
  { name: "SIRKIT_ORCHESTRATION_ENABLED", kind: "enable-flag", default: "off", direction: "enables", owner: "app/api/chat/orchestration-runtime.ts:39", constant: "ORCHESTRATION_ENABLED_ENV", rule: EXACT_ONE },
  { name: "SIRKIT_ORCHESTRATION_ROLE_MODELS", kind: "configuration", default: "unset (every role inherits)", direction: "selects", owner: "app/lib/agent/orchestration/provider-policy.ts:39", constant: "ROLE_MODELS_ENV", rule: VALUE },
  { name: "SIRKIT_ORDERING_DISABLED", kind: "disable-switch", default: "unset", direction: "disables", owner: "app/lib/manufacturing-providers/ordering-enablement.ts:41", constant: "ORDERING_OPERATOR_DISABLE_ENV", rule: { parse: "non-blank" } },
  { name: "SIRKIT_PASSIVE_POLICY_STAGE5", kind: "rollout-stage", default: "off", direction: "enables", owner: "app/lib/passive-policy/rollout.ts:2", constant: "PASSIVE_POLICY_FEATURE_FLAG", rule: { parse: "stage", values: ["observe", "opt_in", "authoritative_supported_profile"] } },
  { name: "SIRKIT_PCB_SYNC_STAGE3", kind: "rollout-stage", default: "off", direction: "enables", owner: "app/lib/pcb-sync/rollout.ts:4", constant: "PCB_SYNC_STAGE3_FLAG", rule: { parse: "stage", values: ["observe", "opt_in", "authoritative_safe_profile"] } },
  { name: "SIRKIT_PHYSICAL_BINDING_SHADOW", kind: "shadow", default: "off", direction: "enables", owner: "app/lib/physical-binding/shadow.ts:5", constant: "PHYSICAL_BINDING_SHADOW_FLAG", rule: { parse: "true" } }, { name: "SIRKIT_TRUSTED_CLIENT_IP_HEADER", kind: "configuration", default: "unset (no per-client window: each public window is one bucket shared by every caller)", direction: "selects", owner: "app/lib/auth/abuse-limits.ts:70", constant: "TRUSTED_CLIENT_IP_HEADER_ENV", rule: VALUE }, // [B24-A3, 2026-10-06] appended on this line (D16), so the lines after it keep their numbers: the trusted proxy header that keys the public per-client windows (OD-197); its state only, never its value
  { name: "SIRKIT_WORKFLOW_WORKER_SECRET", kind: "secret", default: "unset (every worker route answers 401)", direction: "supplies", owner: "app/lib/auth/worker-principal.ts:14", constant: "WORKER_SECRET_ENV", rule: VALUE }, { name: "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS", kind: "secret", default: "unset (only the current secret verifies)", direction: "supplies", owner: "app/lib/auth/worker-principal.ts:63", constant: "WORKER_SECRET_PREVIOUS_ENV", rule: VALUE }, // [B24-A2, 2026-10-06] appended on this line (D16; deliverable 5): the previous worker secret, verification only (OD-195)
];

const frozenRule = (rule: FlagRule): FlagRule => Object.freeze(rule.parse === "stage" ? { ...rule, values: Object.freeze([...rule.values]) } : { ...rule });
export const FLAG_INVENTORY: readonly FlagInventoryEntry[] = Object.freeze(ENTRIES.map((entry) => Object.freeze({ ...entry, rule: frozenRule(entry.rule) })));

/** A `SIRKIT_` token in code that is not an environment name read there (exact, by prefix, or an inventoried name's `_ENV` constant),
 *  or an inventoried name mentioned in a string that reads nothing; `sites` are the file:line places it stands (re-derived at 8664964).
 *  This module itself is the reviewed list, not a reader: the census does not scan it. */
export interface FlagInventoryExclusion {
  readonly token: string;
  readonly match: "exact" | "prefix" | "name-constant" | "mention";
  readonly names: readonly string[];
  readonly sites: readonly string[];
  readonly reason: string;
}

const EXCLUSIONS: readonly FlagInventoryExclusion[] = [
  { token: "SIRKIT_D1N4148", match: "exact", names: [], sites: ["app/lib/spice/ir.ts:234", "app/lib/spice/project.ts:72"], reason: "the name of Sirkit's own 1N4148 diode SPICE model (a .model card), not an environment name" },
  { token: "SIRKIT_ELECTRICAL_TRUTH", match: "exact", names: [], sites: ["app/lib/pcb/fab/build-bundle.ts:150"], reason: "the bundle file name SIRKIT_ELECTRICAL_TRUTH.json written into the fabrication bundle, not an environment name" },
  { token: "SIRKIT_READINESS_REPORT", match: "exact", names: [], sites: ["app/lib/pcb/fab/build-bundle.ts:151"], reason: "the bundle file name SIRKIT_READINESS_REPORT.json written into the fabrication bundle, not an environment name" },
  { token: "SIRKIT_RELEASE_MANIFEST", match: "exact", names: [], sites: ["app/lib/pcb/fab/build-bundle.ts:265", "app/components/pcb/hooks/useFabExport.ts:94", "app/components/pcb/hooks/useFabExport.ts:95"], reason: "the bundle file name SIRKIT_RELEASE_MANIFEST.json, written by the bundle builder and looked for by the export hook" },
  { token: "SIRKIT_STAGE_", match: "prefix", names: [], sites: ["app/lib/requirements/capability.ts:48"], reason: "the stage-report document names (docs/stage-reports/SIRKIT_STAGE_*.md) cited as capability evidence, not environment names" },
  { token: "SIRKIT_MINTED_ID", match: "exact", names: [], sites: [], reason: "a module-local regular-expression constant of the B23-D evidence contract (a Sirkit-minted id), not an environment name; its module is named by no other production file, so no site is spelled here" },
  { token: "SIRKIT_TOOL_CATALOG", match: "exact", names: [], sites: ["app/lib/engineering/tool-catalog.ts:108"], reason: "the tool catalog's exported constant (the reviewed tool descriptors), not an environment name" },
  { token: "SIRKIT_ANTHROPIC_MODEL_EMPTY", match: "exact", names: [], sites: ["app/lib/llm/anthropic-config.ts:21"], reason: "a refusal code of the Anthropic model setting (an empty SIRKIT_ANTHROPIC_MODEL), not an environment name" },
  { token: "SIRKIT_ANTHROPIC_MODEL_PADDED", match: "exact", names: [], sites: ["app/lib/llm/anthropic-config.ts:21"], reason: "a refusal code of the Anthropic model setting (a padded SIRKIT_ANTHROPIC_MODEL), not an environment name" },
  { token: "_ENV", match: "name-constant", names: [], sites: ["app/lib/auth/mode.ts:19", "app/lib/auth/expected-origin.ts:36"], reason: "an identifier naming an inventoried environment name's constant (SIRKIT_AUTH_MODE_ENV, SIRKIT_EXPECTED_ORIGIN_ENV): the name plus _ENV" },
  { token: "SIRKIT_ATOMIC_CATALOG_", match: "mention", names: ["SIRKIT_ATOMIC_CATALOG_PROJECT_ID", "SIRKIT_ATOMIC_CATALOG_TENANT_ID"], sites: ["app/lib/engineering/action-registry.ts:158"], reason: "both names stand inside the atomic publication record's description string, which reads nothing; publication-review.ts:55, :57 is where they are read" },
];

export const FLAG_INVENTORY_EXCLUSIONS: readonly FlagInventoryExclusion[] = Object.freeze(EXCLUSIONS.map((exclusion) => Object.freeze({ ...exclusion, names: Object.freeze([...exclusion.names]), sites: Object.freeze([...exclusion.sites]) })));
