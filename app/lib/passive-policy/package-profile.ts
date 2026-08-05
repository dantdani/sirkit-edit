import { assertProfileDigest } from "./stable";
import type { NormalizedPackageIdentity, PassivePackageProfile } from "./types";

const CHIP_IDENTITIES: Record<string, Omit<NormalizedPackageIdentity, "acceptedAliases">> = {
  "0201/0603": { identitySystem: "metric_imperial_explicit", canonicalId: "chip:0201-imperial:0603-metric", imperialCode: "0201", metricCode: "0603", lengthUm: 600, widthUm: 300 },
  "0402/1005": { identitySystem: "metric_imperial_explicit", canonicalId: "chip:0402-imperial:1005-metric", imperialCode: "0402", metricCode: "1005", lengthUm: 1000, widthUm: 500 },
  "0603/1608": { identitySystem: "metric_imperial_explicit", canonicalId: "chip:0603-imperial:1608-metric", imperialCode: "0603", metricCode: "1608", lengthUm: 1600, widthUm: 800 },
  "0805/2012": { identitySystem: "metric_imperial_explicit", canonicalId: "chip:0805-imperial:2012-metric", imperialCode: "0805", metricCode: "2012", lengthUm: 2000, widthUm: 1250 },
  "1206/3216": { identitySystem: "metric_imperial_explicit", canonicalId: "chip:1206-imperial:3216-metric", imperialCode: "1206", metricCode: "3216", lengthUm: 3200, widthUm: 1600 },
};

export function normalizePassivePackageIdentity(raw: string): NormalizedPackageIdentity {
  const text = raw.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
  if (!text || text.length > 96 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error("PP_PACKAGE_IDENTITY_INVALID");
  if (/^(?:0201|0402|0603|0805|1206)$/.test(text)) throw new Error("PP_PACKAGE_ALIAS_AMBIGUOUS");
  const explicitPair = /^(0201|0402|0603|0805|1206)\s*(?:imperial)?\s*(?:\/|equivalent to|,)\s*(0603|1005|1608|2012|3216)\s*(?:metric)?$/.exec(text);
  const oneSystem = /^(0201|0402|0603|0805|1005|1206|1608|2012|3216)\s+(imperial|metric)$/.exec(text);
  let key: string | undefined;
  if (explicitPair) key = `${explicitPair[1]}/${explicitPair[2]}`;
  else if (oneSystem?.[2] === "imperial") key = Object.keys(CHIP_IDENTITIES).find((item) => item.startsWith(`${oneSystem[1]}/`));
  else if (oneSystem?.[2] === "metric") key = Object.keys(CHIP_IDENTITIES).find((item) => item.endsWith(`/${oneSystem[1]}`));
  const identity = key ? CHIP_IDENTITIES[key] : undefined; if (!identity) throw new Error("PP_PACKAGE_IDENTITY_UNSUPPORTED_OR_CONFLICTING");
  return { ...identity, acceptedAliases: [`${identity.imperialCode} imperial`, `${identity.metricCode} metric`, `${identity.imperialCode} imperial / ${identity.metricCode} metric`] };
}

export function validatePassivePackageProfile(profile: PassivePackageProfile, acceptedAssemblyProfileId?: string): string[] {
  const errors: string[] = [];
  try { assertProfileDigest(profile); } catch (error) { errors.push(error instanceof Error ? error.message : "PP_PROFILE_DIGEST_INVALID"); }
  try { const normalized = normalizePassivePackageIdentity(`${profile.normalizedPackageIdentity.imperialCode} imperial / ${profile.normalizedPackageIdentity.metricCode} metric`); if (normalized.canonicalId !== profile.normalizedPackageIdentity.canonicalId) errors.push("PP_PROFILE_PACKAGE_IDENTITY_MISMATCH"); } catch { errors.push("PP_PROFILE_PACKAGE_IDENTITY_INVALID"); }
  const footprint = profile.exactFootprintAssetIdentity, mapping = profile.stage4MappingProfileRef;
  if (!footprint.assetVersionId || !footprint.contentDigest || footprint.availability !== "available" || footprint.validationState !== "valid" || footprint.packageCompatibility !== "compatible") errors.push("PP_PROFILE_EXACT_FOOTPRINT_UNAVAILABLE");
  if (mapping.state !== "verified" || mapping.verifierVersion !== "sirkit.mapping-verifier/4.0.0" || !mapping.verificationTier || !["exact_part", "package_family", "curated_pair"].includes(mapping.verificationTier) || mapping.mappingApprovalState !== "approved" || mapping.mappingFreshnessState !== "current" || mapping.mappingConflictState !== "none" || mapping.mappingLifecycleState !== "active" || mapping.footprintAssetVersionId !== footprint.assetVersionId || mapping.footprintContentDigest !== footprint.contentDigest || !mapping.mappingRevisionId || !mapping.mappingContentDigest || !mapping.mappingDependencyDigest || !mapping.verificationResultDigest) errors.push("PP_PROFILE_STAGE4_MAPPING_UNACCEPTED");
  if (profile.approvalState !== "approved" || profile.technicalState !== "valid" || profile.freshnessState !== "current" || profile.lifecycleState !== "active") errors.push("PP_PROFILE_STATE_UNUSABLE");
  if (profile.supportedPassiveClasses.some((item) => !["resistor", "capacitor"].includes(item))) errors.push("PP_PROFILE_CLASS_OUTSIDE_SUPPORTED_CAPABILITY");
  if (acceptedAssemblyProfileId && !profile.assemblyProfileIds.includes(acceptedAssemblyProfileId)) errors.push("PP_PROFILE_ASSEMBLY_UNACCEPTED");
  if (profile.feasibilityEnvelope.numericRanges.length > 64 || profile.feasibilityEnvelope.allowedTechnologies.length > 32) errors.push("PP_PROFILE_ENVELOPE_LIMIT_EXCEEDED");
  return [...new Set(errors)].sort();
}
