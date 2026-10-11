/**
 * [B24-A1] D24-10, OD-199 - the versioned deployment configuration: one deep-frozen `sirkit.deployment-configuration.v1` record,
 * digested by `engineeringDigest`, of everything that decides what this deployment's AI and tools do:
 *  - the deployment profile and the auth mode;
 *  - OpenAI's model and reasoning effort, and the Anthropic model setting; [B24-A1 review] coverage-4: and every provider SDK client
 *    Sirkit builds, by the code that builds it, each with its timeout and retries - the agent coordinator's and a specialist's, the
 *    llmRouter's (behind the model-calling routes), the embedding client and the parts-search reranker;
 *  - the specialist role table (`ROLE_PROVIDER_POLICY` with the server's validated overrides);
 *  - the three registry versions, each beside an `engineeringDigest` of the rows production reads (so a row change without a version
 *    bump still moves the record): the acquisition sources, the MCP servers, and the manufacturing providers' `PROVIDER_ROWS`;
 *  - the embedding and parts-search rerank models, COPIED here (their modules import a provider SDK; the copies are pinned by
 *    `b24-a1-configuration`), and the runtime profiles, REFERENCED through `runtimeProfiles()` (never re-created);
 *  - the tool registry digest, whether each provider key is present, and every flag state of the inventory.
 * It holds names and closed states only - never a value of a secret, URL, origin or key. `deploymentConfiguration()` builds it once
 * per process, at first use, over `process.env`; `/api/ready` reports its digest. Attaching the digest to trace records is B24-C2's
 * (OD-208), after a durable trace exists (B24-C1).
 */
import { SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION } from "@/app/lib/acquisition/source-registry";
import { ROLE_MODELS_ENV, ROLE_PROVIDER_POLICY, parseRoleModelOverrides, type RoleProviderChoice } from "@/app/lib/agent/orchestration/provider-policy";
import type { SpecialistRole } from "@/app/lib/agent/orchestration/contracts";
import { resolveDeploymentProfile, type DeploymentProfile } from "@/app/lib/auth/deployment-profile";
import { resolveAuthMode, type AuthMode } from "@/app/lib/auth/mode";
import { runtimeProfiles } from "@/app/lib/computation/runtime-profile";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { anthropicModelSetting } from "@/app/lib/llm/anthropic-config";
import { OPENAI_REASONING_MODEL_FAMILY, configuredOpenAIModel, type OpenAIReasoningEffort } from "@/app/lib/llm/openai-config";
import { PROVIDER_REGISTRY_VERSION, PROVIDER_ROWS } from "@/app/lib/manufacturing-providers/provider-registry";
import { MCP_SERVER_REGISTRY, MCP_SERVER_REGISTRY_VERSION } from "@/app/lib/mcp/server-registry";
import { FLAG_INVENTORY, type FlagInventoryEntry, type FlagKind } from "./flag-inventory";

type Environment = Readonly<Record<string, string | undefined>>;

export const DEPLOYMENT_CONFIGURATION_SCHEMA = "sirkit.deployment-configuration.v1" as const;

/** [B24-A1 review] coverage-4: one SDK client's options as its construction site passes them; "sdk-default" where it passes none. */
export type ClientSetting = number | "sdk-default";
export interface ProviderClientOptions {
  readonly timeoutMs: ClientSetting;
  readonly maxRetries: ClientSetting;
}
const client = (timeoutMs: ClientSetting, maxRetries: ClientSetting): ProviderClientOptions => Object.freeze({ timeoutMs, maxRetries });
/** Every OpenAI client Sirkit builds, copied from its construction site (each pinned by reading that site, `b24-a1-configuration` 14). */
export const OPENAI_CLIENTS = Object.freeze({
  /** the agent loop's coordinator: adapters.ts:112, its retries the constructor's default (:106) */
  agentCoordinator: client(120_000, 2),
  /** a specialist's: the same line, `SPECIALIST_SDK_MAX_RETRIES` (adapters.ts:312) */
  agentSpecialist: client(120_000, 0),
  /** the llmRouter's provider (openai-provider.ts:152-156), behind the model-calling routes */
  llmRouter: client(600_000, 5),
  /** the embedding client (embeddings.ts:25) */
  embeddings: client("sdk-default", "sdk-default"),
});
/** Every Anthropic client Sirkit builds, copied from its construction site (pinned the same way). */
export const ANTHROPIC_CLIENTS = Object.freeze({
  /** the coordinator: adapters.ts:213, its retries the SDK's default (the constructor sets none, :208) */
  agentCoordinator: client(120_000, "sdk-default"),
  /** a specialist's: the same line, `SPECIALIST_SDK_MAX_RETRIES` */
  agentSpecialist: client(120_000, 0),
  /** the llmRouter's provider (anthropic-provider.ts:100) */
  llmRouter: client("sdk-default", "sdk-default"),
  /** the parts-search reranker (parts-search.ts:222) */
  partsSearchRerank: client("sdk-default", "sdk-default"),
});
/** Copied from `EMBEDDING_MODEL` (app/lib/embeddings.ts:11), never imported: that module imports the OpenAI SDK. */
export const EMBEDDING_CONFIGURATION = Object.freeze({ provider: "openai" as const, model: "text-embedding-3-small" });
/** Copied from `RERANK_MODEL` (app/lib/parts-search.ts:215, not exported), never imported: that module imports the Anthropic SDK. */
export const PARTS_SEARCH_RERANK_CONFIGURATION = Object.freeze({ provider: "anthropic" as const, model: "claude-haiku-4-5" });
/** The reasoning efforts `configuredOpenAIReasoningEffort` accepts (openai-config.ts:3, not exported), copied; pinned equal. */
const OPENAI_REASONING_EFFORTS: readonly OpenAIReasoningEffort[] = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
/** The inventory kinds whose state the record carries. */
const FLAG_STATE_KINDS: readonly FlagKind[] = Object.freeze(["enable-flag", "disable-switch", "rollout-stage", "shadow"]);

export type KeyPresence = "present" | "absent";
export type AnthropicModelRecord =
  | { readonly state: "default" | "configured"; readonly model: string }
  | { readonly state: "refused"; readonly refusal: "SIRKIT_ANTHROPIC_MODEL_EMPTY" | "SIRKIT_ANTHROPIC_MODEL_PADDED" };
export interface RegistryVersion {
  readonly version: string;
  readonly digest: string;
}

export interface DeploymentConfiguration {
  readonly schema: typeof DEPLOYMENT_CONFIGURATION_SCHEMA;
  readonly profile: DeploymentProfile;
  readonly authMode: AuthMode;
  readonly providers: {
    readonly openai: { readonly model: string; readonly reasoningEffort: OpenAIReasoningEffort | null; readonly apiKey: KeyPresence; readonly clients: typeof OPENAI_CLIENTS };
    readonly anthropic: { readonly model: AnthropicModelRecord; readonly apiKey: KeyPresence; readonly clients: typeof ANTHROPIC_CLIENTS };
  };
  readonly roleTable:
    | { readonly state: "default" | "overridden"; readonly roles: Readonly<Record<SpecialistRole, RoleProviderChoice>> }
    | { readonly state: "provider_policy_invalid"; readonly roles: null };
  readonly registries: { readonly source: RegistryVersion; readonly mcpServers: RegistryVersion; readonly providers: RegistryVersion };
  readonly embeddings: typeof EMBEDDING_CONFIGURATION;
  readonly partsSearchRerank: typeof PARTS_SEARCH_RERANK_CONFIGURATION;
  readonly runtimeProfiles: readonly { readonly id: string; readonly deterministicDigest: string; readonly pinned: boolean }[];
  readonly toolRegistryDigest: string;
  readonly flags: readonly { readonly name: string; readonly kind: FlagKind; readonly state: string }[];
  readonly digest: string;
}

/** The effort by the rule of openai-config.ts:47-50, over the environment handed in (that reader takes process.env only). */
function reasoningEffortOf(environment: Environment, model: string): OpenAIReasoningEffort | null {
  if (!OPENAI_REASONING_MODEL_FAMILY.test(model)) return null;
  const configured = environment.SIRKIT_OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  if (!configured) return "high";
  return OPENAI_REASONING_EFFORTS.find((effort) => effort === configured) ?? "high";
}

/** A flag's state by its owner's parse, as the inventory records it; never the value itself. */
function flagState(entry: FlagInventoryEntry, environment: Environment): string {
  const value = environment[entry.name];
  const rule = entry.rule;
  switch (rule.parse) {
    case "exact":
      return value === rule.value ? "on" : "off";
    case "non-blank":
      return typeof value === "string" && value.trim() !== "" ? "set" : "unset";
    case "list":
      return (value ?? "").split(",").some((item) => item.trim() !== "") ? "set" : "unset";
    case "stage": {
      const stage = value?.trim().toLowerCase();
      return stage !== undefined && rule.values.includes(stage) ? stage : "off";
    }
    case "true":
      return value?.trim().toLowerCase() === "true" ? "on" : "off";
    default:
      return typeof value === "string" && value.trim() !== "" ? "set" : "unset";
  }
}

const presence = (value: string | undefined): KeyPresence => (typeof value === "string" && value.trim() !== "" ? "present" : "absent");

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The record for one environment (pure but for the module constants it reads). */
export function buildDeploymentConfiguration(environment: Environment = process.env): DeploymentConfiguration {
  const openaiModel = configuredOpenAIModel(environment);
  const anthropic = anthropicModelSetting(environment);
  const overrides = parseRoleModelOverrides(environment[ROLE_MODELS_ENV]);
  const roleTable: DeploymentConfiguration["roleTable"] = !overrides.ok
    ? { state: "provider_policy_invalid", roles: null }
    : { state: Object.keys(overrides.overrides).length > 0 ? "overridden" : "default", roles: { ...ROLE_PROVIDER_POLICY, ...overrides.overrides } };
  const body: Omit<DeploymentConfiguration, "digest"> = {
    schema: DEPLOYMENT_CONFIGURATION_SCHEMA,
    profile: { ...resolveDeploymentProfile(environment) },
    authMode: resolveAuthMode(environment),
    providers: {
      openai: { model: openaiModel, reasoningEffort: reasoningEffortOf(environment, openaiModel), apiKey: presence(environment.OPENAI_API_KEY), clients: OPENAI_CLIENTS },
      anthropic: {
        model: anthropic.ok ? { state: anthropic.source, model: anthropic.model } : { state: "refused", refusal: anthropic.refusal },
        apiKey: presence(environment.ANTHROPIC_API_KEY),
        clients: ANTHROPIC_CLIENTS,
      },
    },
    roleTable,
    registries: {
      source: { version: SOURCE_REGISTRY_VERSION, digest: engineeringDigest(SOURCE_REGISTRY) },
      mcpServers: { version: MCP_SERVER_REGISTRY_VERSION, digest: engineeringDigest(MCP_SERVER_REGISTRY) },
      providers: { version: PROVIDER_REGISTRY_VERSION, digest: engineeringDigest(PROVIDER_ROWS) },
    },
    embeddings: { ...EMBEDDING_CONFIGURATION },
    partsSearchRerank: { ...PARTS_SEARCH_RERANK_CONFIGURATION },
    runtimeProfiles: runtimeProfiles((name) => environment[name]).map((profile) => ({ id: profile.profileId, deterministicDigest: profile.deterministicDigest, pinned: profile.executable.expectedDigest.state === "pinned" })),
    toolRegistryDigest: sirkitToolRegistry().digest(),
    flags: FLAG_INVENTORY.filter((entry) => FLAG_STATE_KINDS.includes(entry.kind)).map((entry) => ({ name: entry.name, kind: entry.kind, state: flagState(entry, environment) })),
  };
  return deepFreeze({ ...body, digest: engineeringDigest(body) });
}

let cached: DeploymentConfiguration | null = null;

/** This process's record: built once, at first use, over `process.env`. */
export function deploymentConfiguration(): DeploymentConfiguration {
  cached ??= buildDeploymentConfiguration(process.env);
  return cached;
}

/** Tests only: forget the process's record, so the next call rebuilds it. */
export function __resetDeploymentConfigurationForTests(): void {
  cached = null;
}
