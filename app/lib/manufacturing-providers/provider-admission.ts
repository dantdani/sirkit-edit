/**
 * [B23-A1] Admission per provider and per operation tier (OD-162).
 *
 * A pure decision over the registry and the environment it is GIVEN (never `process.env`):
 *  - every dfm_quote_transfer and every ordering operation refuses `provider_not_admitted` in B23, whatever the row's state or the
 *    environment says: no row is admitted for a transfer or an order (OD-160; LB-11, LB-12);
 *  - a row `validateProviderRegistry` refuses admits nothing (`provider_not_admitted`): a forged revision is not a reviewed one;
 *  - an operator may switch a provider, or one `provider:operation`, OFF with SIRKIT_MANUFACTURING_DISABLED_PROVIDERS; nothing can
 *    switch one on;
 *  - a blocked or disabled operation refuses with its own reason and owner decision;
 *  - every other API operation (a manufacturer's, or a distributor's order or status read) refuses `provider_not_admitted`: B23
 *    calls no provider API beyond a distributor's B19 read; an API operation is never admitted as a hand-off, whatever tier it
 *    claims, and only an `api` read at read_observation recorded from B19 is delegated;
 *  - a distributor's read is exactly its B19 source's admission (`admitSource`): B19's states, B19's own operator switch and B19's
 *    credential references; the answer names the variables and never carries a value;
 *  - an enabled hand-off is admitted as a hand-off: no host, no credential, nothing called.
 * Refusal messages name variables, never values. No route, tool or composition root calls this in A1.
 */
import { admitSource } from "../acquisition/source-registry";
import { tierRank, validateProviderRegistry, type OperationTier, type ProviderId, type ProviderRow } from "./provider-registry";

/** The operator's off-only switch: a comma-separated list of provider ids or `provider:operation` pairs (case- and space-tolerant). */
export const PROVIDER_OPERATOR_DISABLE_ENV = "SIRKIT_MANUFACTURING_DISABLED_PROVIDERS";

export const PROVIDER_ADMISSION_REFUSALS = ["unknown_provider", "unknown_operation", "provider_not_admitted", "operator_disabled", "blocked", "disabled", "credentials_missing"] as const;
export type ProviderAdmissionRefusal = (typeof PROVIDER_ADMISSION_REFUSALS)[number];

export type ProviderAdmission =
  | {
      readonly admitted: true;
      readonly providerId: ProviderId;
      readonly operationId: string;
      readonly tier: OperationTier;
      /** a hand-off a person completes, or a read through the distributor's B19 source admission */
      readonly via: "handoff" | "b19_source";
      /** the environment variable NAMES the B19 source reads (never their values); empty for a hand-off */
      readonly credentialReferences: readonly string[];
    }
  | { readonly admitted: false; readonly providerId: string; readonly operationId: string; readonly refusal: ProviderAdmissionRefusal; readonly message: string };

export function admitProviderOperation(
  registry: readonly ProviderRow[],
  providerId: string,
  operationId: string,
  env: Readonly<Record<string, string | undefined>>,
): ProviderAdmission {
  const refuse = (refusal: ProviderAdmissionRefusal, message: string): ProviderAdmission => ({ admitted: false, providerId, operationId, refusal, message });
  const row = registry.find((candidate) => candidate.id === providerId);
  if (!row) return refuse("unknown_provider", "No provider with that id is registered.");
  const entry = row.operations.find((candidate) => candidate.id === operationId);
  if (!entry) return refuse("unknown_operation", `${row.displayName} registers no operation with that id.`);
  const name = `${row.displayName} ${entry.id} (${entry.tier})`;
  // structural, before the row's own state: B23 admits no provider for a transfer or an order
  if (tierRank(entry.tier) >= tierRank("dfm_quote_transfer")) {
    return refuse("provider_not_admitted", `${name} is not admitted: B23 admits no provider for a transfer or an order (no owner account, OD-160). The operation is recorded ${entry.state}: ${entry.reason}`);
  }
  // [B23-A1 review] a row the validator refuses is an unreviewed revision (a relabelled tier, channel or credential); nothing in it is admitted
  if (validateProviderRegistry([row]).length > 0) return refuse("provider_not_admitted", `${name} is not admitted: its registry row fails validateProviderRegistry, so it is not a reviewed revision.`);
  const switchedOff = (env[PROVIDER_OPERATOR_DISABLE_ENV] ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (switchedOff.includes(row.id) || switchedOff.includes(`${row.id}:${entry.id}`)) return refuse("operator_disabled", `${name} is switched off by the operator (${PROVIDER_OPERATOR_DISABLE_ENV}).`);
  const decision = row.apiAccess.ownerDecision ? ` (${row.apiAccess.ownerDecision})` : "";
  if (entry.state === "blocked") return refuse("blocked", `${name} is blocked: ${entry.reason}${decision}`);
  if (entry.state === "disabled") return refuse("disabled", `${name} is disabled: ${entry.reason}${decision}`);
  // [B23-A1 review] structural, whatever the row says of itself (see structuralDelegation)
  const delegation = structuralDelegation(row, entry);
  if (delegation === "handoff") {
    return { admitted: true, providerId: row.id, operationId: entry.id, tier: "handoff", via: "handoff", credentialReferences: [] };
  }
  if (delegation === "refuse" || row.b19Source === null) {
    return refuse("provider_not_admitted", `${name} is not admitted: B23 calls no provider API beyond a distributor's B19 read, and a hand-off is never an API call (LB-11).`);
  }
  const source = admitSource(row.b19Source, env);
  if (!source.admitted) return refuse(source.refusal, source.message); // B19's refusals are a subset of these, its message names variables only
  return { admitted: true, providerId: row.id, operationId: entry.id, tier: entry.tier, via: "b19_source", credentialReferences: Object.freeze(Object.keys(source.secrets)) };
}

/**
 * [B23-A1 review; exported by the B23-A1 lead, 2026-10-02] The structural layer, applied after the validator and the row's own state:
 * a hand-off is never an API call and carries no credential, and the one API operation ever delegated is a distributor's B19 read at
 * read_observation; every other API operation is a B23 record (B23 calls no provider API). A validated registry never reaches its
 * refusal, so `b23-a-provider-admission` case 11 calls it directly to show it bites on its own (defence in depth).
 */
export function structuralDelegation(row: ProviderRow, entry: ProviderRow["operations"][number]): "handoff" | "b19_source" | "refuse" {
  if (entry.tier === "handoff" && entry.channel !== "api" && entry.auth === "none") return "handoff";
  if (row.b19Source !== null && entry.source === "b19-registry" && entry.channel === "api" && entry.tier === "read_observation") return "b19_source";
  return "refuse";
}
