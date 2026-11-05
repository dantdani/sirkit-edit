/**
 * [PR-M, 2026-10-18] Section M2 test helpers: the fixture CAD files (committed verbatim copies of the pinned KiCad blobs plus the
 * original MIT pin tables), the 1N4148 / 1N4001 targets, the production parsers over them, and a small HOSTILE corpus (each entry a real
 * refusal class of the parsers' limits). Nothing here is product logic.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFootprintAsset, parseSymbolAssets } from "@/app/lib/atomic/kicad-assets";
import { composeSymbolLibrary } from "@/app/lib/acquisition/kicad-library-compose";
import type { AcquisitionTarget } from "@/app/lib/component-resolution/acquisition/candidate";

const ROOT = join(process.cwd(), "app", "lib", "fixture-runtime", "cad-source");
export const fixtureFile = (relative: string): string => readFileSync(join(ROOT, ...relative.split("/")), "utf8");
export const SYMBOL_1N4148 = fixtureFile("kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym");
export const SYMBOL_1N4001 = fixtureFile("kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym");
export const FOOTPRINT_DO35 = fixtureFile("kicad-footprints/Diode_THT.pretty/D_DO-35_SOD27_P7.62mm_Horizontal.kicad_mod");
export const FOOTPRINT_DO41 = fixtureFile("kicad-footprints/Diode_THT.pretty/D_DO-41_SOD81_P10.16mm_Horizontal.kicad_mod");
export const PIN_TABLE_1N4148 = fixtureFile("datasheets/1N4148.pin-table.txt");

export const ORIGIN = { sourceRecordId: "record_m2_fixture", libraryNickname: "Diode", sourceUri: "fixture://m2", licenseId: "license_kicad_cc_by_sa_4" };

export function composed1N4148(): string {
  const outcome = composeSymbolLibrary(SYMBOL_1N4148, "1N4148", new Map([["1N4001", SYMBOL_1N4001]]));
  if (!outcome.ok) throw new Error(outcome.detail);
  return outcome.text;
}
export const symbolAsset = (text: string, name: string) => parseSymbolAssets({ source: text, origin: ORIGIN }).find((asset) => asset.symbolName === name) ?? null;
export const footprintAsset = (text: string) => parseFootprintAsset({ source: text, libraryNickname: "Diode_THT", origin: { ...ORIGIN, libraryNickname: "Diode_THT" } });

export function target1N4148(over: Partial<AcquisitionTarget> = {}): AcquisitionTarget {
  return { componentIds: ["kc-d1", "kc-d2"], refDes: ["D1", "D2"], value: "1N4148", catalogPartId: "00000000-0000-4000-8000-000000004148", catalogMpn: "1N4148", symbol: { library: "Diode", name: "1N4148" }, footprint: { library: "Diode_THT", name: "D_DO-35_SOD27_P7.62mm_Horizontal" }, exactMpn: "1N4148", packageCode: "DO-35", mounting: "through_hole", ...over };
}

/** A small hostile corpus: each is refused (or marked unsupported) by the production parsers' limits - never a valid asset. */
export const HOSTILE_SYMBOLS: ReadonlyArray<[string, string]> = [
  ["nesting deeper than the preflight bound", `(kicad_symbol_lib (version 20241209) (symbol "1N4148" ${"(a ".repeat(200)}${")".repeat(200)}))`],
  ["more pins than any real part", `(kicad_symbol_lib (version 20241209) (symbol "1N4148" ${Array.from({ length: 10_050 }, (_, index) => `(pin passive line (at 0 0 0) (length 1) (name "P") (number "${index + 1}"))`).join(" ")}))`],
  ["an embedded payload", `(kicad_symbol_lib (version 20241209) (symbol "1N4148" (pin passive line (at 0 0 0) (length 1) (name "K") (number "1")) (embedded_files (file (name "x") (data "AAAA")))))`],
  ["content after the library root", `(kicad_symbol_lib (version 20241209) (symbol "1N4148" (pin passive line (at 0 0 0) (length 1) (name "K") (number "1")))) (junk)`],
  ["an impossible format date", `(kicad_symbol_lib (version 20261399) (symbol "1N4148" (pin passive line (at 0 0 0) (length 1) (name "K") (number "1"))))`],
];
