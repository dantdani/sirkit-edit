import { providerAuthoritative } from "./provider";
import type { NetlistLoweringManifest, SimulationExecutionEnvironment, SimulatorProviderDefinition } from "./types";
import { bindSimulationAuthority } from "@/app/lib/computation/simulation-authority";

export interface ExecutionAuthorization { authorized: boolean; mode: "authoritative" | "diagnostic_only" | "denied"; codes: string[] }
export function authorizeSimulationExecution(input: { provider: SimulatorProviderDefinition; environment: SimulationExecutionEnvironment; manifest: NetlistLoweringManifest; availableContentDigests: string[]; requestedNetwork: boolean; requestedTimeoutMs: number; requestedOutputBytes: number; /** [B22-C review] the server's environment registry, passed by the route; absent, no environment is the server's */ serverEnvironments?: readonly SimulationExecutionEnvironment[] }): ExecutionAuthorization {
  // [B22-C] D22-6, OD-138: the provider and the environment are the server's copies, resolved by id and digest; a body copy that
  // differs, or names one the server does not hold, is refused with its closed code and nothing below reads the body's.
  // [B22-C review] regressions-1: the registry is the caller's argument (this module is in the client bundle); none is fail-closed
  const binding = bindSimulationAuthority({ provider: input.provider, environment: input.environment }, input.serverEnvironments ?? []);
  if (!binding.provider || !binding.environment) return { authorized: false, mode: "denied", codes: uniqueCodes([...binding.codes]) };
  const provider = binding.provider, environment = binding.environment;
  const codes: string[] = [];
  if (environment.providerRevisionId !== provider.deterministicDigest || input.manifest.providerRevisionId !== provider.deterministicDigest) codes.push("CD10_EXECUTION_PROVIDER_PIN_MISMATCH");
  if (input.requestedNetwork || environment.networkPolicy !== "deny") codes.push("CD10_EXECUTION_NETWORK_NOT_DENIED");
  if (!environment.executableOrImageDigest) codes.push("CD10_EXECUTION_BINARY_DIGEST_MISSING");
  if (input.requestedTimeoutMs > environment.resourceLimits.timeoutMs || input.requestedOutputBytes > environment.resourceLimits.outputBytes || environment.resourceLimits.memoryMiB < 1) codes.push("CD10_EXECUTION_RESOURCE_LIMIT_INVALID");
  if (input.manifest.modelIncludeAndDigestMappings.some((item) => !input.availableContentDigests.includes(item.contentDigest) || item.sandboxRelativePath.includes("..") || /^[A-Za-z]:|^\//.test(item.sandboxRelativePath))) codes.push("CD10_EXECUTION_INCLUDE_NOT_SANDBOXED");
  if (input.manifest.structuralValidationResults.some((item) => item.state !== "pass")) codes.push("CD10_EXECUTION_LOWERING_AUDIT_FAILED");
  const authoritative = providerAuthoritative(provider, environment) && codes.length === 0;
  if (authoritative) return { authorized: true, mode: "authoritative", codes: [] };
  const diagnostic = provider.reviewState === "diagnostic_only" && !codes.some((code) => code.includes("INCLUDE_NOT_SANDBOXED") || code.includes("RESOURCE_LIMIT"));
  return { authorized: diagnostic, mode: diagnostic ? "diagnostic_only" : "denied", codes: uniqueCodes(codes.length ? codes : ["CD10_EXECUTION_PROVIDER_NOT_AUTHORITATIVE"]) };
}
function uniqueCodes(codes: string[]): string[] { return [...new Set(codes)].sort(); }

/** CD-10 deliberately does not spawn a process until an OS/container sandbox implementation is independently validated. */
export async function executeAuthoritativeSimulation(): Promise<never> { throw new Error("CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX"); }
