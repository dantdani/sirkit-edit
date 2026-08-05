import { providerAuthoritative } from "./provider";
import type { NetlistLoweringManifest, SimulationExecutionEnvironment, SimulatorProviderDefinition } from "./types";

export interface ExecutionAuthorization { authorized: boolean; mode: "authoritative" | "diagnostic_only" | "denied"; codes: string[] }
export function authorizeSimulationExecution(input: { provider: SimulatorProviderDefinition; environment: SimulationExecutionEnvironment; manifest: NetlistLoweringManifest; availableContentDigests: string[]; requestedNetwork: boolean; requestedTimeoutMs: number; requestedOutputBytes: number }): ExecutionAuthorization {
  const codes: string[] = [];
  if (input.environment.providerRevisionId !== input.provider.deterministicDigest || input.manifest.providerRevisionId !== input.provider.deterministicDigest) codes.push("CD10_EXECUTION_PROVIDER_PIN_MISMATCH");
  if (input.requestedNetwork || input.environment.networkPolicy !== "deny") codes.push("CD10_EXECUTION_NETWORK_NOT_DENIED");
  if (!input.environment.executableOrImageDigest) codes.push("CD10_EXECUTION_BINARY_DIGEST_MISSING");
  if (input.requestedTimeoutMs > input.environment.resourceLimits.timeoutMs || input.requestedOutputBytes > input.environment.resourceLimits.outputBytes || input.environment.resourceLimits.memoryMiB < 1) codes.push("CD10_EXECUTION_RESOURCE_LIMIT_INVALID");
  if (input.manifest.modelIncludeAndDigestMappings.some((item) => !input.availableContentDigests.includes(item.contentDigest) || item.sandboxRelativePath.includes("..") || /^[A-Za-z]:|^\//.test(item.sandboxRelativePath))) codes.push("CD10_EXECUTION_INCLUDE_NOT_SANDBOXED");
  if (input.manifest.structuralValidationResults.some((item) => item.state !== "pass")) codes.push("CD10_EXECUTION_LOWERING_AUDIT_FAILED");
  const authoritative = providerAuthoritative(input.provider, input.environment) && codes.length === 0;
  if (authoritative) return { authorized: true, mode: "authoritative", codes: [] };
  const diagnostic = input.provider.reviewState === "diagnostic_only" && !codes.some((code) => code.includes("INCLUDE_NOT_SANDBOXED") || code.includes("RESOURCE_LIMIT"));
  return { authorized: diagnostic, mode: diagnostic ? "diagnostic_only" : "denied", codes: uniqueCodes(codes.length ? codes : ["CD10_EXECUTION_PROVIDER_NOT_AUTHORITATIVE"]) };
}
function uniqueCodes(codes: string[]): string[] { return [...new Set(codes)].sort(); }

/** CD-10 deliberately does not spawn a process until an OS/container sandbox implementation is independently validated. */
export async function executeAuthoritativeSimulation(): Promise<never> { throw new Error("CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX"); }
