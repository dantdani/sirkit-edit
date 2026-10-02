/**
 * [B22-C] The server's simulation authority binding (discovery D22-6, OD-138; runbook B22-C :926, :928; global :138). CD-10's
 * execute and readiness evaluations took the provider and the execution environment from the request body and compared only the
 * body's own fields and FNV digests, which any client can recompute, so a self-declared validated pair reached
 * `authorized: true, mode: "authoritative"` (then the 501) and a verified readiness report. Here both are resolved from the server
 * by id and digest instead: the provider from the server's own provider set (the diagnostic ngspice provider and the unreviewed
 * analytical reference provider - a reviewer's approval is a body claim the server does not hold), the environment from the B22-A2
 * runtime-profile registry. A body copy that names an id the server does not hold, or differs from the server's copy in any field,
 * is refused with a closed code; the evaluation then reads only the server's copies.
 *
 * Nothing here is `validated` or authoritative-eligible, so the binding never opens execution: the CD-10 501 and the throwing stub
 * stay (OD-134). Pure: no process, no file, no network, no setting.
 *
 * [B22-C review] regressions-1: browser-safe. The pure evaluators that call the binding (`readiness.ts`, `safe-execution.ts`) are in
 * the editor's client bundle (through `lib/persistence` and the CD-11 consumer), so this module imports nothing node-only: the
 * environments are the caller's argument - the server's registry, read by `simulation-authority-server.ts` in the two routes, or
 * none, in which case every body environment is refused (fail-closed).
 */
import { analyticalReferenceProvider, diagnosticNgspiceProvider } from "@/app/lib/model-simulation/provider";
import type { SimulationExecutionEnvironment, SimulatorProviderDefinition } from "@/app/lib/model-simulation/types";

/** [B22-C] The closed refusals, in the order a caller reports the first one (the provider's before the environment's). */
export const SIMULATION_AUTHORITY_BINDING_CODES = Object.freeze([
  "CD10_PROVIDER_NOT_SERVER_REGISTERED",
  "CD10_PROVIDER_BODY_MISMATCH",
  "CD10_ENVIRONMENT_NOT_SERVER_REGISTERED",
  "CD10_ENVIRONMENT_BODY_MISMATCH",
] as const);
export type SimulationAuthorityBindingCode = (typeof SIMULATION_AUTHORITY_BINDING_CODES)[number];

export interface SimulationAuthorityBinding {
  /** The server's copy of the provider, or null when the body named none the server holds. */
  readonly provider: SimulatorProviderDefinition | null;
  /** The server's copy of the environment (a runtime profile), or null when the body named none the registry holds. */
  readonly environment: SimulationExecutionEnvironment | null;
  readonly codes: readonly SimulationAuthorityBindingCode[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** [B22-C] The providers the server holds, frozen: neither is validated or authoritative-eligible. */
export function serverSimulationProviders(): readonly SimulatorProviderDefinition[] {
  return Object.freeze([deepFreeze(diagnosticNgspiceProvider()), deepFreeze(analyticalReferenceProvider())]);
}

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Canonical JSON: object keys sorted, `undefined` members dropped as JSON drops them, so a JSON round trip compares equal. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonical(item))).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort(byCodeUnits).map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
const field = (value: unknown, key: string): unknown => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined);

/** The server's copy the body names by id and digest, or the refusal. */
function resolve<T extends { deterministicDigest: string }>(body: unknown, held: readonly T[], idKey: "providerId" | "environmentId", unknownCode: SimulationAuthorityBindingCode, mismatchCode: SimulationAuthorityBindingCode): { copy: T | null; code: SimulationAuthorityBindingCode | null } {
  const id = field(body, idKey);
  const server = typeof id === "string" ? held.find((candidate) => (candidate as unknown as Record<string, unknown>)[idKey] === id) : undefined;
  if (!server) return { copy: null, code: unknownCode };
  if (field(body, "deterministicDigest") !== server.deterministicDigest || canonical(body) !== canonical(server)) return { copy: null, code: mismatchCode };
  return { copy: server, code: null };
}

/**
 * [B22-C] Resolve a body's provider and environment to the server's copies by id and digest (OD-138). Each side is the server's
 * frozen copy when the body names an id the server holds AND equals that copy field for field; otherwise it is null and its closed
 * code is reported. The caller evaluates only the copies returned. [B22-C review] `environments` is the server's registry as its
 * caller read it (`serverSimulationEnvironments()`); a caller with none passes `[]` and every environment is refused.
 */
export function bindSimulationAuthority(input: { readonly provider: unknown; readonly environment: unknown }, environments: readonly SimulationExecutionEnvironment[]): SimulationAuthorityBinding {
  const provider = resolve(input.provider, serverSimulationProviders(), "providerId", "CD10_PROVIDER_NOT_SERVER_REGISTERED", "CD10_PROVIDER_BODY_MISMATCH");
  const environment = resolve<SimulationExecutionEnvironment>(input.environment, environments, "environmentId", "CD10_ENVIRONMENT_NOT_SERVER_REGISTERED", "CD10_ENVIRONMENT_BODY_MISMATCH");
  const codes = [provider.code, environment.code].filter((code): code is SimulationAuthorityBindingCode => code !== null);
  return { provider: provider.copy, environment: environment.copy, codes };
}

export function isSimulationAuthorityBindingCode(code: unknown): code is SimulationAuthorityBindingCode {
  return typeof code === "string" && (SIMULATION_AUTHORITY_BINDING_CODES as readonly string[]).includes(code);
}

/** [B22-C] The first binding refusal among `codes` (in the closed order), or null: the code a 409 names. */
export function simulationAuthorityRefusal(codes: readonly unknown[] | undefined): SimulationAuthorityBindingCode | null {
  const present = new Set((codes ?? []).filter(isSimulationAuthorityBindingCode));
  return SIMULATION_AUTHORITY_BINDING_CODES.find((code) => present.has(code)) ?? null;
}
