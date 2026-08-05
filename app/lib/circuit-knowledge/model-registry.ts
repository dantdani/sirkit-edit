import type { QuantityDimension } from "../constraints/types";
import { circuitDigest } from "./stable";
import { EXPRESSION_MODEL_REGISTRY_VERSION } from "./types";

export interface RegisteredRecipeModelAdapter { adapterId: string; version: string; inputDimensions: QuantityDimension[]; outputDimensions: QuantityDimension[]; executionOwner: "CD-7"; implementationRef: string; sourceRequired: true; deterministicDigest: string; }
function adapter(input: Omit<RegisteredRecipeModelAdapter, "deterministicDigest" | "executionOwner" | "sourceRequired">): RegisteredRecipeModelAdapter { const base = { ...input, executionOwner: "CD-7" as const, sourceRequired: true as const }; return { ...base, deterministicDigest: circuitDigest(base) }; }
export const RECIPE_MODEL_ADAPTERS: readonly RegisteredRecipeModelAdapter[] = [
  adapter({ adapterId: "ohms_law_power", version: "1.0.0", inputDimensions: ["voltage", "current"], outputDimensions: ["power"], implementationRef: "CD-7:ohms-law-power" }),
  adapter({ adapterId: "rc_time_constant", version: "1.0.0", inputDimensions: ["resistance", "capacitance"], outputDimensions: ["time"], implementationRef: "CD-7:rc-time-constant" }),
  adapter({ adapterId: "resistive_divider_ratio", version: "1.0.0", inputDimensions: ["resistance", "resistance"], outputDimensions: ["dimensionless"], implementationRef: "CD-7:resistive-divider-ratio" }),
];
export const RECIPE_MODEL_ADAPTER_REGISTRY_DIGEST = circuitDigest({ version: EXPRESSION_MODEL_REGISTRY_VERSION, adapters: RECIPE_MODEL_ADAPTERS });
export function findRecipeModelAdapter(adapterId: string, version: string): RegisteredRecipeModelAdapter | undefined { return RECIPE_MODEL_ADAPTERS.find((item) => item.adapterId === adapterId && item.version === version); }
