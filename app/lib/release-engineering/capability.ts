import { finalizeCd12 } from "./stable";
import type { Cd12CapabilityProfile } from "./types";

export function defaultCd12CapabilityProfile(): Cd12CapabilityProfile { return finalizeCd12<Cd12CapabilityProfile>({
  profileId: "low-voltage-embedded-release-engineering-v1", version: "1.0.0",
  supportedDomains: ["two_to_four_layer_rigid_fr4", "ordinary_smt_tht", "authorized_distributor_observations", "exact_variant_bom", "prototype_to_moderate_volume", "deterministic_artifact_manifests", "prototype_pilot_build_readiness_with_human_approval"],
  externalReviewDomains: ["fabricator_process_acceptance", "assembler_process_acceptance", "quote_exceptions", "physical_first_article", "factory_yield", "regulatory_and_customer_acceptance"],
  unsupportedDomains: ["direct_purchasing", "broker_authentication", "regulated_life_safety", "export_control_legal_advice", "flex_rigid_flex", "hdi_microvia", "exotic_materials", "high_voltage_high_energy", "autonomous_production_release"],
  limits: { maximumVariants: 64, maximumUsages: 100_000, maximumBomLines: 25_000, maximumOffers: 1_000_000, maximumAllocations: 100_000, maximumAlternates: 100_000, maximumCapabilityFacts: 100_000, maximumArtifacts: 10_000, maximumArchiveBytes: 2_000_000_000 },
  policies: { identity: "cd12-exact-manufacturer-part/1", variant: "cd12-total-population-projection/1", bom: "cd12-authoritative-usage-lineage/1", sourcing: "cd12-volatile-nonreservation-evidence/1", money: "cd12-exact-decimal/1", alternate: "cd12-full-dimension-reverification/1", assembly: "cd12-exact-package-process-evidence/1", capability: "cd12-site-scoped-capability/1", dfmDft: "cd12-preflight-external-review-separation/1", artifact: "cd12-inner-manifest-cross-consistency/1", governance: "cd12-exact-digest-segregation/1", security: "cd12-untrusted-input-no-side-effects/1", readiness: "cd12-fixed-level-evidence-matrix/1" },
  approvalState: "approved", deterministicDigest: ""
}); }

