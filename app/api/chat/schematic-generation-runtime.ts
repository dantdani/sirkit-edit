/**
 * [PR-D] The chat route's ONE approved boundary to Build-mode generation (OD-243): the server resolver for the port behind
 * `sirkit.schematic.generate-proposal`. [PR-L, 2026-10-18] Runbook L.5, increment 5 (task-worker-contract.md section 8): the port is
 * the DURABLE generation-task service - the SAME `GenerationTaskService` (app/lib/generation-task/service.ts) over the SAME resolved
 * task store (app/lib/generation-task/runtime.ts) the routes `POST /api/generation-tasks` / `GET /api/generation-tasks[/id]` call, so a
 * chat start is a Build start with origin `chat`: the same closed request, idempotency, one active task per project and branch, editor
 * roles, provider rule and allowance. The chat closure no longer reaches the build loop through here (the worker runs the design in
 * finite slices; this module only starts, lists and reads tasks); the agent layer (app/lib/agent/generation-proposals.ts) never
 * imports the service, it is handed this port by the chat route exactly as the external reads and the named computations are.
 *
 * Mirrors computation-runtime.ts: the default is the REAL production port, failing CLOSED to null when no design can be accepted here -
 * no durable task store (normal mode without DATABASE_URL: nothing is accepted, never a process-local fallback advertised as recoverable),
 * or the run's provider is not servable (the fixture runtime always is: its scripted provider answers, no credits; otherwise the
 * provider's key must be configured on the server - presence only, the value is never read here). Off, the three generation tools are
 * withheld from the run (the fact is false; discovery never advertises them). A test setter exists with a deterministic reset; it is
 * never a production path. The build-multi route reads nothing from here (OD-106 stands: it imports the generation directly).
 */
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import type { LLMProviderId } from "@/app/lib/llm/types";
import type { SchematicGenerationPort } from "@/app/lib/agent/generation-proposals";
import { resolveGenerationTaskService } from "@/app/lib/generation-task/runtime";
import { generationScopeOf, type GenerationTaskService } from "@/app/lib/generation-task/service";

export type SchematicGenerationPortFactory = (provider: LLMProviderId) => SchematicGenerationPort | null;

/** The server setting that configures each provider (presence decides availability; the value is never read here). */
export const PROVIDER_KEY_SETTINGS: Readonly<Record<LLMProviderId, string>> = Object.freeze({ openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" });

/** Whether a generation can run here for `provider`: the fixture runtime (scripted answers), or the provider's key is configured. */
export function schematicGenerationServable(provider: LLMProviderId, environment: Record<string, string | undefined> = process.env): boolean {
  if (fixtureRuntimeEnabled(environment)) return true;
  const setting = PROVIDER_KEY_SETTINGS[provider];
  return setting !== undefined && (environment[setting] ?? "").trim().length > 0;
}

const NOT_FOUND = Object.freeze({ status: 404, body: { ok: false, code: "GENERATION_TASK_NOT_FOUND", error: "No such design task in this project." } });

/** The port over ONE service: every call canonicalizes the trusted scope first (a malformed scope is the uniform not-found). */
export function generationTaskPortOver(service: GenerationTaskService): SchematicGenerationPort {
  return {
    durability: service.durability,
    async start(input) {
      const scope = generationScopeOf(input.scope);
      if (!scope) return { status: NOT_FOUND.status, body: { ...NOT_FOUND.body } };
      return service.start(scope, input.principal, input.body, "chat", input.chatRunId);
    },
    async list(rawScope) {
      const scope = generationScopeOf(rawScope);
      return scope ? service.list(scope) : { status: NOT_FOUND.status, body: { ...NOT_FOUND.body } };
    },
    async inspect(rawScope, taskId, options) {
      const scope = generationScopeOf(rawScope);
      return scope ? service.inspect(scope, taskId, { includeResult: options.includeResult }) : { status: NOT_FOUND.status, body: { ...NOT_FOUND.body } };
    },
  };
}

const DEFAULT_FACTORY: SchematicGenerationPortFactory = (provider) => {
  if (!schematicGenerationServable(provider)) return null;
  const service = resolveGenerationTaskService({ providerServable: (candidate) => schematicGenerationServable(candidate) });
  return service ? generationTaskPortOver(service) : null;
};
let portFactory: SchematicGenerationPortFactory = DEFAULT_FACTORY;

/** Test-only override; restore via `resetSchematicGenerationPortFactory`. */
export function setSchematicGenerationPortFactory(factory: SchematicGenerationPortFactory): void {
  portFactory = factory;
}

/** Restore the production default (deterministic test isolation). */
export function resetSchematicGenerationPortFactory(): void {
  portFactory = DEFAULT_FACTORY;
}

/** Resolve the port for one run, or null to withhold the generation tools. Never throws. */
export function resolveSchematicGenerationPort(provider: LLMProviderId): SchematicGenerationPort | null {
  try {
    return portFactory(provider);
  } catch {
    return null;
  }
}
