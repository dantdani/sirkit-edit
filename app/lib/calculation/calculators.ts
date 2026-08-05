import { addIntervals, divideIntervals, multiplyIntervals, pointInterval, subtractIntervals } from "./interval";
import { powerRational, rational } from "./rational";
import { addQuantities, compareQuantitiesExact, dimensionsEqual, quantityFromCanonical } from "./units";
import type { CalculationEvidenceState, EngineeringInterval, EngineeringQuantity } from "./types";

export interface BoundedCalculation {
  state: CalculationEvidenceState;
  interval?: EngineeringInterval;
  evidenceClass: "guaranteed" | "characterized_estimate" | "unknown";
  diagnostics: string[];
}

function positive(interval: EngineeringInterval): void {
  const zero = quantityFromCanonical("zero", rational(0), interval.dimension, { canonicalUnit: interval.lowerBound.canonicalUnit, unitKind: interval.lowerBound.unitKind });
  if (compareQuantitiesExact(interval.lowerBound, zero) <= 0) throw new Error("CD7_MODEL_INPUT_NOT_STRICTLY_POSITIVE");
}

function calculate(evidence: BoundedCalculation["evidenceClass"], fn: () => EngineeringInterval, diagnostics: string[] = []): BoundedCalculation {
  if (evidence === "unknown") return { state: "unknown", evidenceClass: evidence, diagnostics: ["CD7_CALCULATION_INPUT_EVIDENCE_UNKNOWN", ...diagnostics] };
  try {
    return { state: evidence === "guaranteed" ? "pass" : "external_review_required", interval: fn(), evidenceClass: evidence, diagnostics };
  } catch (error) {
    return { state: "unsupported", evidenceClass: evidence, diagnostics: [error instanceof Error ? error.message : String(error), ...diagnostics] };
  }
}

export function loadedDividerBounds(input: { inputVoltage: EngineeringInterval; topResistance: EngineeringInterval; bottomResistance: EngineeringInterval; loadResistance?: EngineeringInterval; evidenceClass: BoundedCalculation["evidenceClass"] }): BoundedCalculation {
  return calculate(input.evidenceClass, () => {
    positive(input.topResistance); positive(input.bottomResistance); if (input.loadResistance) positive(input.loadResistance);
    const effectiveBottom = input.loadResistance
      ? divideIntervals(multiplyIntervals(input.bottomResistance, input.loadResistance), addIntervals(input.bottomResistance, input.loadResistance))
      : input.bottomResistance;
    return multiplyIntervals(input.inputVoltage, divideIntervals(effectiveBottom, addIntervals(input.topResistance, effectiveBottom)));
  });
}

export function rcTimeConstantBounds(input: { resistance: EngineeringInterval; capacitance: EngineeringInterval; evidenceClass: BoundedCalculation["evidenceClass"] }): BoundedCalculation {
  return calculate(input.evidenceClass, () => { positive(input.resistance); positive(input.capacitance); return multiplyIntervals(input.resistance, input.capacitance); });
}

export function staticPowerBounds(input: { voltage: EngineeringInterval; current: EngineeringInterval; evidenceClass: BoundedCalculation["evidenceClass"] }): BoundedCalculation {
  return calculate(input.evidenceClass, () => multiplyIntervals(input.voltage, input.current));
}

export function ldoLossBounds(input: { inputVoltage: EngineeringInterval; outputVoltage: EngineeringInterval; outputCurrent: EngineeringInterval; groundCurrent?: EngineeringInterval; evidenceClass: BoundedCalculation["evidenceClass"] }): BoundedCalculation {
  return calculate(input.evidenceClass, () => {
    const passLoss = multiplyIntervals(subtractIntervals(input.inputVoltage, input.outputVoltage), input.outputCurrent);
    return input.groundCurrent ? addIntervals(passLoss, multiplyIntervals(input.inputVoltage, input.groundCurrent)) : passLoss;
  });
}

export function idealAdcLsbBounds(input: { referenceVoltage: EngineeringInterval; resolutionBits: number; evidenceClass: BoundedCalculation["evidenceClass"] }): BoundedCalculation {
  return calculate(input.evidenceClass, () => {
    if (!Number.isSafeInteger(input.resolutionBits) || input.resolutionBits < 1 || input.resolutionBits > 64) throw new Error("CD7_ADC_RESOLUTION_UNSUPPORTED");
    const divisor = quantityFromCanonical("adc-code-count", powerRational(rational(2), input.resolutionBits), input.referenceVoltage.dimension, { canonicalUnit: input.referenceVoltage.lowerBound.canonicalUnit, unitKind: input.referenceVoltage.lowerBound.unitKind });
    const dimensionlessDivisor = quantityFromCanonical("adc-code-count", divisor.exactValue, { mass: 0, length: 0, time: 0, current: 0, temperature: 0, amount: 0, luminous_intensity: 0, angle: 0 });
    return divideIntervals(input.referenceVoltage, pointInterval(dimensionlessDivisor));
  }, ["Ideal quantization only; INL, DNL, reference, source impedance, and noise require explicit models."]);
}

export function simpleSteadyStateJunctionEstimate(input: { ambient: EngineeringInterval; dissipation: EngineeringInterval; thetaJa: EngineeringInterval; evidenceClass: BoundedCalculation["evidenceClass"] }): BoundedCalculation {
  return calculate(input.evidenceClass === "guaranteed" ? "characterized_estimate" : input.evidenceClass, () => {
    const riseRaw = multiplyIntervals(input.dissipation, input.thetaJa);
    if (!dimensionsEqual(riseRaw.dimension, input.ambient.dimension)) throw new Error("CD7_THERMAL_DIMENSION_MISMATCH");
    const lowerRise = quantityFromCanonical("junction-rise", riseRaw.lowerBound.exactValue, input.ambient.dimension, { canonicalUnit: input.ambient.lowerBound.canonicalUnit, unitKind: "affine_delta" });
    const upperRise = quantityFromCanonical("junction-rise", riseRaw.upperBound.exactValue, input.ambient.dimension, { canonicalUnit: input.ambient.upperBound.canonicalUnit, unitKind: "affine_delta" });
    return {
      ...addIntervals(input.ambient, { ...riseRaw, lowerBound: lowerRise, upperBound: upperRise, dimension: input.ambient.dimension }),
    };
  }, ["Theta-JA is a board-condition estimate, never a guaranteed junction-temperature proof without a qualified thermal model."]);
}

export function addAbsoluteTemperatureAndDelta(absolute: EngineeringQuantity, delta: EngineeringQuantity): EngineeringQuantity {
  if (absolute.unitKind !== "affine_absolute" || delta.unitKind !== "affine_delta") throw new Error("CD7_TEMPERATURE_SEMANTICS_INVALID");
  return addQuantities(absolute, delta);
}
