/**
 * IPC-2152 current-based trace-width calculator (PCB Stage 10). Public math —
 * the widely-cited chart approximation, not any proprietary/GPL source.
 *
 * MVP scope: external layers, 1 oz copper. Internal-layer derating and 2 oz
 * are post-MVP; the function is parameterized so they slot in later (internal
 * currently uses the external table with an explanatory note).
 *
 * Formula (external): required copper cross-section, then width = area /
 * thickness:
 *   area(mils²) = (I / (k · ΔT^b))^(1/c)
 *   width(mils) = area / (1.378 · copperOz)      // 1.378 mils = 1 oz thickness
 *   width(nm)   = width(mils) · 25400
 *
 * Constant note: the older IPC-2221 external constant k=0.048 yields ~0.78 mm
 * for 2 A / 10 °C — well below the IPC-2152 reference. IPC-2152 gives wider
 * traces; K_EXTERNAL below is calibrated so 2 A / 10 °C / 1 oz external →
 * ~1.24 mm (the pinned reference point), matching the newer standard.
 */

export interface Ipc2152Input {
  currentAmps: number;
  copperOz: 1 | 2; // MVP: 1 only, but parameterized
  tempRiseCelsius: number; // typical 10 or 20
  layer: "external" | "internal"; // MVP: external table used for all layers
}

export interface Ipc2152Result {
  widthNm: number; // required minimum width
  explanation: string;
}

// External-layer constants (IPC-2152-calibrated for the pinned 1.24 mm reference).
const K_EXTERNAL = 0.0344;
const B = 0.44;
const C = 0.725;
/** 1 oz copper ≈ 1.378 mils thick; width = area / (thickness · oz). */
const OZ_THICKNESS_MILS = 1.378;
const MILS_TO_NM = 25400;
/** Fabrication floor — never recommend thinner than 0.15 mm regardless of current. */
const MIN_WIDTH_NM = 150_000;

export function ipc2152Width(input: Ipc2152Input): Ipc2152Result {
  const { currentAmps, copperOz, tempRiseCelsius, layer } = input;

  const i = Math.max(currentAmps, 0);
  const dT = Math.max(tempRiseCelsius, 0.0001); // guard ΔT^b against 0
  const areaMils2 = Math.pow(i / (K_EXTERNAL * Math.pow(dT, B)), 1 / C);
  const widthMils = areaMils2 / (OZ_THICKNESS_MILS * copperOz);
  const widthNm = Math.max(Math.round(widthMils * MILS_TO_NM), MIN_WIDTH_NM);

  const internalNote = layer === "internal" ? " (assumes external layer — internal derating is post-MVP)" : "";
  const explanation = `${currentAmps} A @ ${tempRiseCelsius} °C rise, ${copperOz} oz Cu ${layer} → ${(widthNm / 1e6).toFixed(2)} mm${internalNote}`;

  return { widthNm, explanation };
}
