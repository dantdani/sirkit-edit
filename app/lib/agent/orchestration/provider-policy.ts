/**
 * [B21 E1] The provider layer of a specialist run (OD-115, OD-117; D21-18, D21-19): which provider and model each role runs on, the
 * compatible-fallback rule, and the llm-provider meters every specialist call passes through. Implemented against the dated facts in
 * artifacts/ai-control-plane-b21/provider-reference-notes.md, never remembered provider knowledge; every provider-specific feature
 * stays inside the adapters (this module names no SDK, renders nothing itself and calls no provider).
 *
 * The role table is DATA and every role INHERITS by default: the user's chosen provider (the coordinator's) and that provider's one
 * configured model - today's behaviour. Overrides come ONLY from the server environment (`SIRKIT_ORCHESTRATION_ROLE_MODELS`, a bounded
 * JSON map under a closed schema) - never from the request body, whose closed key set has no place for one; a map the schema refuses
 * approves NOTHING (every specialist refused `provider_policy_invalid`, visibly - never a partial or silently ignored map). A model the
 * pinned family rules of its provider do not all classify (`openai-config.ts`, `anthropic-config.ts` - the rule objects themselves,
 * never copies) is refused for a role until it is qualified live (LB-9); the provider's configured model is always qualified (today's
 * behaviour). [PR-F, 2026-10-17] A profile whose admission is pinned to the server env (gpt-6-astra) is qualified ONLY as the configured model or when the role map names it (`serverEnvAdmission`, appended). The coordinator is never routed here: its adapter is `agentAdapterFor`'s, unchanged, and it never switches provider
 * mid-run (route.ts:13-15 stands).
 *
 * A specialist whose provider is PAUSED by the llm-provider breaker runs on the other provider ONLY when every declaration it would
 * be offered - its role's tools and the strict result tool - renders identically through the two `provider-tools.ts` renderers (the
 * parity check the three-way parity gate uses) inside the wire subset, the other provider's configured model is qualified and not
 * paused; otherwise its task is escalated `provider_unavailable` with no call. With two providers a role's fallback IS the
 * coordinator's provider, and the scheduler stops the DAG before any specialist while the coordinator's provider is paused - so a
 * fallback happens only for a role the server env routed away from the coordinator's provider. Degraded mode is always visible.
 */
import type { LLMProviderId } from "../../llm/types";
import { LLMProviderError } from "../../llm/errors";
import { OPENAI_NO_TEMPERATURE_MODEL_FAMILY, OPENAI_REASONING_MODEL_FAMILY, configuredOpenAIModel, openAIModelProfile } from "../../llm/openai-config"; // [PR-F, 2026-10-17] + the profile (its admission pin), in place
import { ANTHROPIC_TEMPERATURE_MODEL_FAMILY, configuredAnthropicModel } from "../../llm/anthropic-config";
import { currentLlmProviderPause, recordLlmProviderOutcome, requestLlmProviderAdmission, type AdmissionPause, type AdmissionPurpose, type LlmProviderAdmission, type LlmProviderOutcome, type LlmProviderTicket } from "../../acquisition/admission-control";
import { canonicalJson } from "../../engineering/stable";
import { renderAgentProviderParity, renderAnthropicAgentTool, renderOpenAiResponsesTool, validateWireSubset } from "../provider-tools";
import type { ProviderAgentAdapter, ProviderToolDeclaration } from "../contracts";
import { SPECIALIST_ROLES, type SpecialistRole } from "./contracts";

// ─── The role table and its server-env override (OD-117) ──────────────────────────────────────────────────────────────────

export interface RoleProviderChoice { readonly provider: LLMProviderId | "inherit"; readonly model: string | "inherit" }
/** Every role's default: inherit the coordinator's provider and that provider's configured model (today's behaviour). */
export const ROLE_PROVIDER_POLICY: Readonly<Record<SpecialistRole, RoleProviderChoice>> = Object.freeze(Object.fromEntries(SPECIALIST_ROLES.map((role) => [role, Object.freeze({ provider: "inherit", model: "inherit" })])) as Record<SpecialistRole, RoleProviderChoice>);
/** The one server-env variable a role override is read from. */
export const ROLE_MODELS_ENV = "SIRKIT_ORCHESTRATION_ROLE_MODELS" as const;
export const ROLE_MODELS_BOUNDS = Object.freeze({ maxChars: 2_048, maxEntries: 8 });
/** A model id the override may name (lowercase, digits and . _ -), never a free string. */
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const OVERRIDE_PROVIDERS: readonly string[] = ["openai", "anthropic", "inherit"];
const ROUTED_ROLES: readonly string[] = SPECIALIST_ROLES.filter((role) => role !== "coordinator");
/** The closed reasons a specialist is not run on a route (its task's dissent `escalated`). */
export const PROVIDER_ROUTE_REFUSALS = Object.freeze(["provider_policy_invalid", "model_unqualified", "provider_unavailable"] as const);
export type ProviderRouteRefusal = (typeof PROVIDER_ROUTE_REFUSALS)[number];

export type RoleModelOverrides = Partial<Record<SpecialistRole, RoleProviderChoice>>;
/** The override map under its closed schema: absent or blank is no override; anything the schema refuses approves NOTHING. */
export function parseRoleModelOverrides(raw: string | undefined): { ok: true; overrides: RoleModelOverrides } | { ok: false; detail: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, overrides: {} };
  if (raw.length > ROLE_MODELS_BOUNDS.maxChars) return { ok: false, detail: `it exceeds ${ROLE_MODELS_BOUNDS.maxChars} characters` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, detail: "it is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, detail: "it is not a JSON object of roles" };
  const duplicate = duplicateKeyOf(raw); // [B21 E1 fix] JSON.parse keeps a duplicated key's LAST value silently: a key named twice refuses the map
  if (duplicate !== null) return { ok: false, detail: `the key "${duplicate.slice(0, 40)}" is named twice in one object (a duplicate would be resolved silently, last one wins)` };
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > ROLE_MODELS_BOUNDS.maxEntries) return { ok: false, detail: `it names more than ${ROLE_MODELS_BOUNDS.maxEntries} roles` };
  const overrides: RoleModelOverrides = {};
  for (const [role, value] of entries) {
    if (!ROUTED_ROLES.includes(role)) return { ok: false, detail: `"${role.slice(0, 40)}" is not a specialist role (the coordinator is never routed by it)` };
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, detail: `the entry for ${role} is not an object` };
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== "model,provider") return { ok: false, detail: `the entry for ${role} must hold exactly "provider" and "model"` };
    const { provider, model } = value as { provider: unknown; model: unknown };
    if (typeof provider !== "string" || !OVERRIDE_PROVIDERS.includes(provider)) return { ok: false, detail: `the provider for ${role} must be "openai", "anthropic" or "inherit"` };
    if (typeof model !== "string" || (model !== "inherit" && !MODEL_ID.test(model))) return { ok: false, detail: `the model for ${role} must be "inherit" or a model id` };
    overrides[role as SpecialistRole] = Object.freeze({ provider: provider as RoleProviderChoice["provider"], model });
  }
  return { ok: true, overrides };
}

/** The provider's one configured model (the variables the coordinator's adapters read, from the environment handed in). */
export function configuredModelOf(provider: LLMProviderId, environment: Readonly<Record<string, string | undefined>>): string {
  return provider === "openai" ? configuredOpenAIModel(environment) : configuredAnthropicModel(environment);
}
/** The pinned model-family rules per provider: the SAME objects the provider modules apply (read, never copied). */
export const MODEL_FAMILY_RULES: Readonly<Record<LLMProviderId, readonly RegExp[]>> = Object.freeze({ openai: Object.freeze([OPENAI_REASONING_MODEL_FAMILY, OPENAI_NO_TEMPERATURE_MODEL_FAMILY]), anthropic: Object.freeze([ANTHROPIC_TEMPERATURE_MODEL_FAMILY]) });
/** Qualified for a role: the provider's configured model (today's behaviour), or a model EVERY pinned rule of its provider classifies - [PR-F, 2026-10-17] and, when its profile pins admission to the server env, one the role map names. */
export function qualifiedModel(provider: LLMProviderId, model: string, environment: Readonly<Record<string, string | undefined>>): boolean {
  return model === configuredModelOf(provider, environment) || (MODEL_FAMILY_RULES[provider].every((rule) => rule.test(model)) && serverEnvAdmission(provider, model, environment)); // [PR-F, 2026-10-17] in place: gpt-6-astra is never admitted by its family rule alone
}

/** Where a specialist runs: its provider and model, whether the table inherited them or the server env set them, its SDK's own
 *  retries (none, OD-115), and - for a compatible fallback - where it was routed from and why. */
export interface SpecialistRoute {
  readonly role: SpecialistRole;
  readonly provider: LLMProviderId;
  readonly model: string;
  readonly source: "inherit" | "env";
  readonly sdkMaxRetries: 0;
  readonly fallbackFrom: { readonly provider: LLMProviderId; readonly model: string; readonly pause: string } | null;
}
export interface RouteRefusal { readonly code: ProviderRouteRefusal; readonly role: SpecialistRole; readonly provider: LLMProviderId; readonly model: string | null; readonly detail: string }

/** A role's route under the table and the server env (never a request field): the coordinator's provider and its configured model
 *  unless the env overrides them; a refused map, the coordinator itself or an unqualified model is a refusal with a visible detail. */
export function resolveRoleRoute(role: SpecialistRole, coordinatorProvider: LLMProviderId, environment: Readonly<Record<string, string | undefined>>): { ok: true; route: SpecialistRoute } | { ok: false; refusal: RouteRefusal } {
  const refuse = (code: ProviderRouteRefusal, provider: LLMProviderId, model: string | null, detail: string): { ok: false; refusal: RouteRefusal } => ({ ok: false, refusal: Object.freeze({ code, role, provider, model, detail }) });
  if (role === "coordinator") return refuse("provider_policy_invalid", coordinatorProvider, null, "the coordinator is never routed by the role policy: its adapter is agentAdapterFor's, unchanged");
  const parsed = parseRoleModelOverrides(environment[ROLE_MODELS_ENV]);
  if (!parsed.ok) return refuse("provider_policy_invalid", coordinatorProvider, null, `${ROLE_MODELS_ENV} is refused: ${parsed.detail}; it approves nothing, so no specialist runs until it is fixed`);
  const override = parsed.overrides[role];
  const choice = override ?? ROLE_PROVIDER_POLICY[role];
  const provider = choice.provider === "inherit" ? coordinatorProvider : choice.provider;
  const model = choice.model === "inherit" ? configuredModelOf(provider, environment) : choice.model;
  if (!qualifiedModel(provider, model, environment)) return refuse("model_unqualified", provider, model, `${model} on ${provider} is outside the pinned family rules of ${provider} (${MODEL_FAMILY_RULES[provider].map((rule) => `/${rule.source}/`).join(", ")}) and is not its configured model: refused for ${role} until it is qualified live (LB-9)`);
  return { ok: true, route: Object.freeze({ role, provider, model, source: override ? "env" : "inherit", sdkMaxRetries: 0, fallbackFrom: null }) };
}

// ─── The compatible fallback ────────────────────────────────────────────────────────────────────────────────────────────

export type FallbackVerdict = { compatible: true } | { compatible: false; detail: string };
/** Compatible when every declaration the run would be offered - its role's tools and the strict result tool - sits inside the wire
 *  subset and renders identically through both renderers (`renderAgentProviderParity`), and the result tool's rendered schema is the
 *  SAME strict schema on both providers. */
export function fallbackCompatibility(declarations: readonly ProviderToolDeclaration[], resultTool: ProviderToolDeclaration): FallbackVerdict {
  const offered = [...declarations, resultTool];
  const outside = offered.filter((declaration) => validateWireSubset(declaration.inputSchema).length > 0).map((declaration) => declaration.toolId);
  if (outside.length > 0) return { compatible: false, detail: `${outside.join(", ")} carry a schema outside the wire subset` };
  // the three-way parity gate's own rule, reused, and the same rule over the renderers the adapters import (what each provider is sent)
  const parity = renderAgentProviderParity(offered).tools.filter((tool) => !tool.semanticallyEquivalent).map((tool) => tool.toolId);
  const sent = offered.filter((declaration) => {
    const openai = renderOpenAiResponsesTool(declaration);
    const anthropic = renderAnthropicAgentTool(declaration);
    return openai.strict !== true || anthropic.strict !== true || canonicalJson({ name: openai.name, description: openai.description, schema: openai.parameters }) !== canonicalJson({ name: anthropic.name, description: anthropic.description, schema: anthropic.input_schema });
  }).map((declaration) => declaration.toolId);
  const differing = [...new Set([...parity, ...sent])];
  if (differing.length > 0) return { compatible: false, detail: `${differing.join(", ")} do not render identically on both providers` };
  if (canonicalJson(renderOpenAiResponsesTool(resultTool).parameters) !== canonicalJson(renderAnthropicAgentTool(resultTool).input_schema)) return { compatible: false, detail: "the result tool is not the same strict schema on both providers" };
  return { compatible: true };
}

// ─── The llm-provider meters (OD-115) ────────────────────────────────────────────────────────────────────────────────────

/** The meters a specialist call passes through (production: the process's own, `admission-control.ts`); an admitted call's outcome is
 *  recorded with the ticket it was admitted under ([B21 E1 fix]: a stale call's outcome never moves the breaker). */
export interface LlmProviderAdmissionPort {
  pause(provider: LLMProviderId, model: string | undefined, purpose: AdmissionPurpose, now: number): AdmissionPause | null;
  request(provider: LLMProviderId, model: string | undefined, purpose: AdmissionPurpose, now: number): LlmProviderAdmission;
  record(provider: LLMProviderId, model: string | undefined, ticket: LlmProviderTicket, outcome: LlmProviderOutcome, now: number): void;
}
const keyOf = (provider: LLMProviderId, model: string | undefined): { kind: "llm-provider"; provider: LLMProviderId; model?: string } => ({ kind: "llm-provider", provider, ...(model === undefined ? {} : { model }) });
export const PROCESS_LLM_PROVIDER_ADMISSION: LlmProviderAdmissionPort = Object.freeze<LlmProviderAdmissionPort>({
  pause: (provider, model, purpose, now) => currentLlmProviderPause(keyOf(provider, model), now, purpose),
  request: (provider, model, purpose, now) => requestLlmProviderAdmission(keyOf(provider, model), now, purpose),
  record: (provider, model, ticket, outcome, now) => recordLlmProviderOutcome(keyOf(provider, model), ticket, outcome, now),
});

/** What an admitted call's failure tells the breaker: a rate limit, no credits, a transient failure, or nothing (an abandoned call, a
 *  refused answer, a configuration error - none of which says the provider is out). */
export function llmProviderOutcomeOf(error: unknown): LlmProviderOutcome {
  if (!(error instanceof LLMProviderError)) return "inconclusive";
  if (error.reason === "rate_limit") return "rate_limited";
  if (error.reason === "insufficient_quota") return "insufficient_quota";
  if (error.reason === "overloaded" || error.reason === "timeout" || error.reason === "network") return "failure";
  return "inconclusive";
}

/** An adapter behind the meters - a specialist's under the agent's share, [B21 E1 fix] the follow-up coordinator turn's as `interactive`:
 *  every call is admitted first (the purpose's share, the breaker) - a refused call is never sent, its pause captured and the run
 *  stopped - and every admitted call's outcome recorded exactly once with its ticket (an abandoned call, when the run's signal aborts
 *  first, as `inconclusive`: not counted). */
export function admittedAdapter(adapter: ProviderAgentAdapter, route: { readonly provider: LLMProviderId; readonly model?: string }, admission: LlmProviderAdmissionPort, now: () => number, purpose: AdmissionPurpose = "agent"): { adapter: ProviderAgentAdapter; capture: { paused: AdmissionPause | null } } {
  const capture: { paused: AdmissionPause | null } = { paused: null };
  const call = async <T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> => {
    const admitted = admission.request(route.provider, route.model, purpose, now());
    if (!admitted.allowed) {
      const { allowed: _refused, ...pause } = admitted;
      void _refused;
      capture.paused ??= pause;
      throw new Error("LLM_PROVIDER_PAUSED");
    }
    const { ticket } = admitted;
    let settled = false;
    const settle = (outcome: LlmProviderOutcome): void => {
      if (settled) return;
      settled = true;
      admission.record(route.provider, route.model, ticket, outcome, now());
    };
    const onAbort = (): void => settle("inconclusive");
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const value = await run();
      settle("success");
      return value;
    } catch (error) {
      settle(llmProviderOutcomeOf(error));
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };
  return {
    capture,
    adapter: {
      provider: adapter.provider,
      start: (input) => call(input.signal, () => adapter.start(input)),
      continueWith: (input) => call(input.signal, () => adapter.continueWith(input)),
    },
  };
}

// ─── The route decision of one specialist attempt ─────────────────────────────────────────────────────────────────────────

/** The provider layer the composition root hands the scheduler (the route: `productionSpecialistProviders`). */
export interface SpecialistProviders {
  /** a route's adapter (production: `agentAdapterForRole` - its own SDK client, `maxRetries: 0`) */
  adapterFor(route: SpecialistRoute): ProviderAgentAdapter;
  admission: LlmProviderAdmissionPort;
  /** the server environment the role policy reads (never a request field) */
  environment: Readonly<Record<string, string | undefined>>;
}
export type SpecialistRouteDecision = { kind: "run"; route: SpecialistRoute } | { kind: "refused"; refusal: RouteRefusal };

const otherProvider = (provider: LLMProviderId): LLMProviderId => (provider === "openai" ? "anthropic" : "openai");

/** One attempt's route: the role's route when its provider is not paused; when its provider is OUT (its breaker open) the compatible
 *  fallback on the other provider (its configured model, qualified by definition, not paused); else `provider_unavailable` - never a
 *  call to a paused provider. A window pause (the agent's share of a minute used up) is no outage to fall back from: `provider_unavailable`. */
export function decideSpecialistRoute(input: { role: SpecialistRole; coordinatorProvider: LLMProviderId; providers: SpecialistProviders; now: number; compatibility: () => FallbackVerdict }): SpecialistRouteDecision {
  const resolved = resolveRoleRoute(input.role, input.coordinatorProvider, input.providers.environment);
  if (!resolved.ok) return { kind: "refused", refusal: resolved.refusal };
  const route = resolved.route;
  const pause = input.providers.admission.pause(route.provider, route.model, "agent", input.now);
  if (pause === null) return { kind: "run", route };
  const unavailable = (why: string): SpecialistRouteDecision => ({ kind: "refused", refusal: Object.freeze({ code: "provider_unavailable", role: input.role, provider: route.provider, model: route.model, detail: `${pause.message} ${why}` }) });
  if (pause.reason !== "breaker_open") return unavailable("No fallback: a window pause is no outage (the provider is not out).");
  const other = otherProvider(route.provider);
  const model = configuredModelOf(other, input.providers.environment);
  const verdict = input.compatibility();
  if (!verdict.compatible) return unavailable(`No compatible fallback: ${verdict.detail}.`);
  const otherPause = input.providers.admission.pause(other, model, "agent", input.now);
  if (otherPause !== null) return unavailable(`No fallback: ${otherPause.message}`);
  return { kind: "run", route: Object.freeze({ ...route, provider: other, model, fallbackFrom: Object.freeze({ provider: route.provider, model: route.model, pause: pause.message }) }) };
}

// ─── [B21 E1 fix] A key named twice (coverage-override-duplicate-keys) ─────────────────────────────────────────────────────
// Appended on purpose: a function declaration is hoisted, so no line cited above moves.

/** The first key a JSON text names twice in one object - which `JSON.parse` resolves silently, the last one winning - or null. The text
 *  is already valid JSON (parsed first), so a key is exactly a string that opens an object's member (after `{`, or an object's `,`); its
 *  spelling is read by `JSON.parse`, so an escaped spelling of the same key is the same key. */
function duplicateKeyOf(json: string): string | null {
  const QUOTE = String.fromCharCode(34);
  const BACKSLASH = String.fromCharCode(92);
  const open: Array<Set<string> | null> = []; // one entry per open container: its keys (an object) or null (an array)
  let expectKey = false;
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (char === QUOTE) {
      let end = index + 1;
      while (json[end] !== QUOTE) end += json[end] === BACKSLASH ? 2 : 1;
      const keys = open.at(-1);
      if (expectKey && keys) {
        const key = JSON.parse(json.slice(index, end + 1)) as string;
        if (keys.has(key)) return key;
        keys.add(key);
      }
      expectKey = false;
      index = end;
    } else if (char === "{") {
      open.push(new Set());
      expectKey = true;
    } else if (char === "[") {
      open.push(null);
      expectKey = false;
    } else if (char === "}" || char === "]") {
      open.pop();
      expectKey = false;
    } else if (char === ",") {
      expectKey = open.at(-1) instanceof Set;
    }
  }
  return null;
}

// ─── [PR-F, 2026-10-17] Server-env admission of a qualifiable profile (directive 4; CONTINUATION B: never widen the allowlist because an id parses) ──
// Appended on purpose (a function declaration is hoisted): no line cited above moves.

/** True unless the model's profile pins its admission to the server env (`openAIModelProfile(model).admission === "server-env"`; today
 *  gpt-6-astra: documented 2026-10-17, never qualified live). Such a model is qualified for a role ONLY when the role map names it
 *  exactly - for its provider, or as `inherit` (the route then lands on the coordinator's provider, whose rules still judge it) - or
 *  when it is the provider's configured model (qualifiedModel's first clause). A map the schema refuses names nothing. */
function serverEnvAdmission(provider: LLMProviderId, model: string, environment: Readonly<Record<string, string | undefined>>): boolean {
  if (provider !== "openai" || openAIModelProfile(model).admission !== "server-env") return true;
  const parsed = parseRoleModelOverrides(environment[ROLE_MODELS_ENV]);
  return parsed.ok && Object.values(parsed.overrides).some((choice) => choice.model === model && (choice.provider === provider || choice.provider === "inherit"));
}
