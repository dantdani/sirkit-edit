import { finalizeSimulation } from "./stable";
import type { ModelSimulationCapabilityProfile } from "./types";

export function defaultModelSimulationCapabilityProfile(): ModelSimulationCapabilityProfile {
  return finalizeSimulation<ModelSimulationCapabilityProfile>({
    profileId: "low-voltage-embedded-model-simulation-v1", version: "1.0.0",
    supportedAnalyses: ["operating_point", "dc_sweep", "transient", "ac", "discrete_corner"],
    diagnosticOnlyAnalyses: ["noise", "distortion", "monte_carlo", "worst_case"],
    unsupportedDomains: ["firmware_or_rtl_without_cosim", "rf_microwave_antenna", "ddr_pcie_serdes_eye", "full_board_si_pi_emc", "detailed_cfd_thermal", "high_energy_fault_signoff", "regulatory_certification", "functional_safety_certification", "long_term_reliability_without_models"],
    limits: { maximumComponents: 2_000, maximumModels: 2_000, maximumTerminals: 40_000, maximumTestbenches: 1_000, maximumRequiredInstances: 500_000, maximumRuns: 10_000, maximumWaveformSignals: 2_000, maximumWaveformPointsPerSignal: 5_000_000, maximumArtifactBytes: 100 * 1024 * 1024, maximumMonteCarloSamples: 10_000, maximumRunSeconds: 120 },
    policies: { modelIdentity: "cd10-exact-model-identity/1", terminalMapping: "cd10-no-positional-terminal-guess/1", applicability: "cd10-claim-specific-applicability/1", provider: "cd10-validated-provider-selection/1", lowering: "cd10-graph-ir-provider-audit/1", numerical: "cd10-explicit-numerical-uncertainty/1", convergence: "cd10-visible-bounded-retry/1", measurement: "cd10-authoritative-waveform-measurement/1", assertion: "cd10-typed-uncertainty-aware-assertion/1", cache: "cd10-complete-semantic-cache-key/1", readiness: "cd10-denominator-first-readiness/1", sandbox: "cd10-network-deny-content-addressed-sandbox/1" },
    approvalState: "approved", deterministicDigest: "",
  });
}
