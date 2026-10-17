/**
 * [PR-D] The chat route's ONE approved boundary to Build-mode generation (OD-243): the server resolver for the port behind
 * `sirkit.schematic.generate-proposal`. The port runs `runBuildMultiGeneration` - the SAME function `POST /api/schematic/build-multi`
 * answers with, under the same bounds - for the run's provider; the agent layer (app/lib/agent/generation-proposals.ts) never imports
 * the generation, it is handed this port by the chat route exactly as the external reads and the named computations are.
 *
 * Mirrors computation-runtime.ts: the default is the REAL production port, failing CLOSED to null when no provider can answer - the
 * fixture runtime always can (the build loop answers the recorded design, no credits), otherwise the run's provider must be
 * configured on the server (its key present; the value is never read into anything but the provider SDK). Off, the tool is withheld
 * from the run (the fact is false; discovery never advertises it). A test setter exists with a deterministic reset; it is never a
 * production path. The build-multi route reads nothing from here (OD-106 stands: it imports the generation directly).
 */
import { runBuildMultiGeneration } from "@/app/lib/schematic/build-multi-generation";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import type { LLMProviderId } from "@/app/lib/llm/types";
import type { SchematicGenerationPort } from "@/app/lib/agent/generation-proposals";

export type SchematicGenerationPortFactory = (provider: LLMProviderId) => SchematicGenerationPort | null;

/** The server setting that configures each provider (presence decides availability; the value is never read here). */
export const PROVIDER_KEY_SETTINGS: Readonly<Record<LLMProviderId, string>> = Object.freeze({ openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" });

/** Whether a generation can run here for `provider`: the fixture runtime (recorded answers), or the provider's key is configured. */
export function schematicGenerationServable(provider: LLMProviderId, environment: Record<string, string | undefined> = process.env): boolean {
  if (fixtureRuntimeEnabled(environment)) return true;
  const setting = PROVIDER_KEY_SETTINGS[provider];
  return setting !== undefined && (environment[setting] ?? "").trim().length > 0;
}

const DEFAULT_FACTORY: SchematicGenerationPortFactory = (provider) => (schematicGenerationServable(provider)
  ? { generate: (request) => runBuildMultiGeneration({ prompt: request.prompt, provider: request.provider, deadlineMs: request.deadlineMs }) }
  : null);
let portFactory: SchematicGenerationPortFactory = DEFAULT_FACTORY;

/** Test-only override; restore via `resetSchematicGenerationPortFactory`. */
export function setSchematicGenerationPortFactory(factory: SchematicGenerationPortFactory): void {
  portFactory = factory;
}

/** Restore the production default (deterministic test isolation). */
export function resetSchematicGenerationPortFactory(): void {
  portFactory = DEFAULT_FACTORY;
}

/** Resolve the port for one run, or null to withhold the generation proposal. Never throws. */
export function resolveSchematicGenerationPort(provider: LLMProviderId): SchematicGenerationPort | null {
  try {
    return portFactory(provider);
  } catch {
    return null;
  }
}
