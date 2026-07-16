import type { NativeFabRecipe } from "./types";

export const STRICT_NATIVE_RECIPE: NativeFabRecipe = Object.freeze({
  schemaVersion: "sirkit.native-fab-recipe.v1",
  id: "sirkit-strict-modern",
  version: 1,
  mode: "strict-modern",
  reproducible: true,
  gerberRevision: "2026.05",
  xncRevision: "2021.11",
  coordinateDecimals: 6,
  includeGerberDrill: true,
  includeXnc: true,
  includeComponentLayers: true,
  includePlacement: true,
  includeBom: true,
});

export const BROAD_NATIVE_RECIPE: NativeFabRecipe = Object.freeze({
  ...STRICT_NATIVE_RECIPE,
  id: "sirkit-broad-compatibility",
  mode: "broad-compatibility",
});
