import { compareQuantities, quantityToInteger } from "../constraints/quantity";
import type { ConstraintQuantity } from "../constraints/types";
import { interfaceId } from "./stable";
import type { AnalogSignalContract, InterfaceDiagnostic, LogicLevelContract, SignalEndpoint, VoltageDomainContract } from "./types";

export type CompatibilityResult = { state: "pass" | "fail" | "unknown" | "unsupported" | "external_review_required"; explanation: string; checks: Array<{ check: string; state: "pass" | "fail" | "unknown"; explanation: string }>; obligationIds: string[] };

function unknown(reason: string, subject: string): CompatibilityResult { return { state: "unknown", explanation: reason, checks: [{ check: subject, state: "unknown", explanation: reason }], obligationIds: [interfaceId("electrical-evidence-obligation", { subject, reason })] }; }
function check(name: string, pass: boolean, explanation: string) { return { check: name, state: pass ? "pass" as const : "fail" as const, explanation }; }

export function evaluatePushPullCompatibility(driver: LogicLevelContract, receiver: LogicLevelContract): CompatibilityResult {
  if (!driver.driverOutputHighMinimum || !driver.driverOutputLowMaximum || !receiver.receiverInputHighMinimum || !receiver.receiverInputLowMaximum) return unknown("VOH(min), VOL(max), VIH(min), and VIL(max) source-backed limits are all required; nominal rail voltage is not a substitute.", `${driver.logicContractId}->${receiver.logicContractId}`);
  try {
    const high = compareQuantities(driver.driverOutputHighMinimum, receiver.receiverInputHighMinimum) >= 0;
    const low = compareQuantities(driver.driverOutputLowMaximum, receiver.receiverInputLowMaximum) <= 0;
    const checks = [check("high-level-threshold", high, high ? "Driver guaranteed high meets receiver high threshold." : "Driver guaranteed high is below receiver high threshold."), check("low-level-threshold", low, low ? "Driver guaranteed low meets receiver low threshold." : "Driver guaranteed low exceeds receiver low threshold.")];
    return { state: checks.every((item) => item.state === "pass") ? "pass" : "fail", explanation: checks.map((item) => item.explanation).join(" "), checks, obligationIds: [] };
  } catch { return { state: "unsupported", explanation: "Threshold quantities cannot be compared with the shared quantity model.", checks: [], obligationIds: [interfaceId("electrical-model-obligation", { driver: driver.logicContractId, receiver: receiver.logicContractId })] }; }
}

export function pushPullCompatibilityOracle(driver: LogicLevelContract, receiver: LogicLevelContract): CompatibilityResult["state"] {
  const required: Array<ConstraintQuantity | undefined> = [driver.driverOutputHighMinimum, driver.driverOutputLowMaximum, receiver.receiverInputHighMinimum, receiver.receiverInputLowMaximum];
  if (required.some((item) => !item)) return "unknown";
  try {
    const [voh, vol, vih, vil] = required.map((item) => quantityToInteger(item!, "voltage"));
    return voh >= vih && vol <= vil ? "pass" : "fail";
  } catch { return "unsupported"; }
}

export function evaluateOpenDrainCompatibility(input: { endpoints: SignalEndpoint[]; logicContracts: LogicLevelContract[]; pullDomain?: VoltageDomainContract }): CompatibilityResult {
  if (!input.pullDomain) return unknown("An open-drain/open-collector signal requires an explicit pull-domain contract.", "open-drain-pull-domain");
  if (input.endpoints.some((endpoint) => !["open_drain", "open_collector", "input"].includes(endpoint.electricalDirection))) return { state: "fail", explanation: "A push-pull or otherwise incompatible endpoint participates in the wired signal.", checks: [check("wired-driver-class", false, "All active drivers must be open-drain/open-collector.")], obligationIds: [] };
  if (input.logicContracts.some((contract) => !contract.receiverInputHighMinimum || !contract.receiverInputLowMaximum || !contract.driverOutputLowMaximum)) return unknown("Sink-low, receiver-threshold, pull-strength, leakage, capacitance, and rise-time facts remain incomplete.", input.pullDomain.domainId);
  if (input.endpoints.some((endpoint) => endpoint.unpoweredBehaviorPolicy === "unknown")) return unknown("Powered-off leakage and back-power behavior must be known for every endpoint.", input.pullDomain.domainId);
  return { state: "pass", explanation: "Topology, thresholds, pull domain, and unpowered policies are structurally closed; exact pull sizing remains downstream.", checks: [check("wired-driver-class", true, "All active drivers are wired-logic compatible."), check("pull-domain", true, "The pull domain is explicit.")], obligationIds: [interfaceId("open-drain-sizing-obligation", input.pullDomain.domainId)] };
}

export function evaluateAnalogCompatibility(contract: AnalogSignalContract): CompatibilityResult {
  if (!contract.sourceRange || !contract.receiverInputRange) return unknown("Source and receiver operating ranges are both required for analog compatibility.", contract.analogContractId);
  try {
    const lower = compareQuantities(contract.sourceRange.min, contract.receiverInputRange.min) >= 0;
    const upper = compareQuantities(contract.sourceRange.max, contract.receiverInputRange.max) <= 0;
    const checks = [check("analog-lower-range", lower, lower ? "Source minimum is within the receiver range." : "Source minimum is below the receiver range."), check("analog-upper-range", upper, upper ? "Source maximum is within the receiver range." : "Source maximum exceeds the receiver range.")];
    if (!lower || !upper) return { state: "fail", explanation: "The receiver range does not contain the complete source range.", checks, obligationIds: [] };
    const unknowns = [contract.sourceImpedanceEnvelope, contract.loadImpedanceEnvelope, contract.bandwidthOrSampleRate].filter((item) => !item).length;
    return unknowns ? { state: "unknown", explanation: "Voltage range is compatible, but impedance or bandwidth/acquisition evidence is incomplete.", checks, obligationIds: contract.verificationObligationIds } : { state: "pass", explanation: "Range, impedance, and bandwidth envelopes are present at planning resolution.", checks, obligationIds: contract.verificationObligationIds };
  } catch { return { state: "unsupported", explanation: "Analog ranges cannot be compared with the shared quantity model.", checks: [], obligationIds: contract.verificationObligationIds }; }
}

export function compatibilityDiagnostic(result: CompatibilityResult, refs: string[]): InterfaceDiagnostic | null {
  if (result.state === "pass") return null;
  const code = result.state === "fail" ? "ELECTRICAL_COMPATIBILITY_FAILED" : result.state === "unknown" ? "ELECTRICAL_COMPATIBILITY_UNKNOWN" : "ELECTRICAL_COMPATIBILITY_UNSUPPORTED";
  return { diagnosticId: interfaceId("interface-diagnostic", { code, refs, explanation: result.explanation }), code, severity: result.state === "fail" ? "blocking" : "error", message: result.explanation, objectRefs: [...refs].sort(), requirementRefs: [], blocks: "logical_planning", derivation: "Deterministic electrical-compatibility evaluator", nextAction: "Supply verified conditional limits or add an explicit translator, isolator, or transceiver role and downstream verification obligation.", staleDependencyKeys: [...refs].sort() };
}

