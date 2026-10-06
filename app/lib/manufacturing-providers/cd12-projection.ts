/**
 * [B23-A1] The CD-12 projection (OD-161): a pure function from a provider-registry row to CD-12's existing
 * `ProcurementProviderDescriptor`. No third descriptor shape: CD-12's vocabulary stays as it is, and the registry row stays the
 * reviewed source each reference points back to.
 *
 * CD-12 has no "assembler" and no unqualified "distributor": an assembler projects to CD-12's "manufacturer", a distributor to its
 * "authorized_distributor", and the one aggregated B19 source (Octopart via Nexar) to its "approved_aggregator". These are CD-12's
 * words for the provider's kind; they carry no authorization evidence (CD-12 keeps that on its supplier identities).
 */
import { SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION } from "../acquisition/source-registry";
import { createProviderDescriptor } from "../release-engineering/providers";
import type { ProcurementProviderDescriptor } from "../release-engineering/types";
import { PROVIDER_REGISTRY_VERSION, renderFact, type ProviderKind, type ProviderRow } from "./provider-registry";

export const CD12_PROVIDER_KIND: Readonly<Record<ProviderKind, ProcurementProviderDescriptor["providerKind"]>> = Object.freeze({
  manufacturer: "manufacturer",
  assembler: "manufacturer",
  quote_service: "formal_quote",
  distributor: "authorized_distributor",
});

/** CD-12's kind word for a row: B19 records Octopart's observations as aggregated (`octopart-aggregated`). */
export function cd12ProviderKind(row: ProviderRow): ProcurementProviderDescriptor["providerKind"] {
  if (row.b19Source !== null && SOURCE_REGISTRY[row.b19Source].distributorName.endsWith("-aggregated")) return "approved_aggregator";
  return CD12_PROVIDER_KIND[row.kind];
}

export function toProcurementProviderDescriptor(row: ProviderRow): ProcurementProviderDescriptor {
  const self = `provider-registry@${PROVIDER_REGISTRY_VERSION}#${row.id}`;
  return createProviderDescriptor({
    providerId: row.id,
    providerVersion: PROVIDER_REGISTRY_VERSION,
    providerKind: cd12ProviderKind(row),
    regionAccountScope: [`region: ${renderFact(row.regionCurrency.region)}`, `currency: ${renderFact(row.regionCurrency.currency)}`, `account: ${renderFact(row.credentials.accountScope)}`],
    authenticationRef: `${self}.credentials`,
    // a distributor's licence for the data Sirkit keeps is B19's; for every other row the registry's terms for what Sirkit sends
    licenseRef: row.b19Source !== null ? `source-registry@${SOURCE_REGISTRY_VERSION}#${row.b19Source}.license` : `${self}.outboundTerms`,
    retentionPolicyRef: `${self}.outboundTerms.retention`,
    semanticsRef: self,
  });
}
