// Throwaway (Stage 16 verification): the story-demo flow headless — place →
// (skip autoroute: no Freerouting here) → GND plane → silk labels → real
// kicad-cli fab bundle. Asserts the silk text physically lands in the .GTO.
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { buildStoryDemo } from "../app/lib/pcb/demo/story-demo";
import { autoPlace } from "../app/lib/pcb/autoplace/auto-place";
import { applyPlacements } from "../app/lib/pcb/autoplace/command";
import { makePlaneZone } from "../app/lib/pcb/zones/plane";
import { computeFill } from "../app/lib/pcb/zones/compute-fill";
import { makeEffectiveClearance } from "../app/lib/pcb/zones/types";
import { applySilkCommand } from "../app/lib/pcb/silk/commands";
import type { SilkItem } from "../app/lib/pcb/silk/types";
import { buildFabBundle } from "../app/lib/pcb/fab/build-bundle";
import { getFabPreset } from "../app/lib/pcb/fab/presets";
import { getPreset } from "../app/lib/pcb/drc/presets";
import { netlistFromBoard } from "../app/lib/pcb/kicad/write-pcb";
import { mmToNm } from "../app/lib/pcb/units";

async function main(): Promise<void> {
  // 1. Place
  let board = buildStoryDemo();
  const placed = autoPlace(board, null);
  board = applyPlacements(board, placed);
  const inside = board.footprints.filter((f) => f.at.x >= 0 && f.at.x <= mmToNm(40)).length;
  console.log(`auto-place: ${inside}/${board.footprints.length} footprints inside the outline`);

  // 2. GND plane (fill computed like useZoneFills would)
  const plane = makePlaneZone(board, "copperTop", 1);
  const fill = computeFill({ board, zone: plane, effectiveClearance: makeEffectiveClearance(board, plane) });
  board = { ...board, zones: [{ ...plane, fill: fill.regions, dirty: false }] };
  console.log(`zone fill: ${fill.regions.length} regions`);

  // 3. Silk labels
  const silk: SilkItem[] = [
    { kind: "text", id: "s1", layer: "silkTop", position: { x: mmToNm(20), y: mmToNm(27) }, text: "sirkit-demo", heightNm: mmToNm(1), strokeWidthNm: mmToNm(0.15), rotationDeg: 0, mirror: false, anchor: "center" },
    { kind: "text", id: "s2", layer: "silkTop", position: { x: mmToNm(20), y: mmToNm(28.7) }, text: "REV 1.0", heightNm: mmToNm(0.8), strokeWidthNm: mmToNm(0.15), rotationDeg: 0, mirror: false, anchor: "center" },
    { kind: "circle", id: "s3", layer: "silkTop", center: { x: mmToNm(2), y: mmToNm(2) }, radiusNm: mmToNm(0.5), strokeWidthNm: mmToNm(0.15), filled: true },
  ];
  for (const item of silk) board = applySilkCommand(board, { kind: "AddSilk", item });

  // 4. Fab bundle through the real CLI (DRC gate exercised too)
  const result = await buildFabBundle(
    {
      board,
      netlist: netlistFromBoard(board),
      fabPreset: getFabPreset("jlcpcb-2l"),
      drcPreset: getPreset("jlcpcb-2l"),
      overrideDrcFail: true, // unrouted (no Freerouting in this env) → airwire errors expected
      boardName: "sirkit-story",
    },
    { cliPath: process.env.KICAD_CLI },
  );
  console.log(`bundle: ${result.filename} — ${result.stats.totalBytes} bytes, drcErrors ${result.stats.drcErrors}, ${result.stats.elapsedMs} ms`);

  const zip = await JSZip.loadAsync(result.zipBytes);
  const gto = await zip.file("gerber/sirkit-story.GTO")!.async("string");
  // KiCad plots gr_text as stroke draws — the GTO must carry substantial data.
  const drawOps = (gto.match(/D01\*/g) ?? []).length;
  console.log(`GTO: ${gto.length} bytes, ${drawOps} draw ops (silk text present: ${drawOps > 100})`);
  if (drawOps <= 100) throw new Error("GTO suspiciously empty — silk text missing?");
  const out = process.argv[2];
  if (out) writeFileSync(`${out}/${result.filename}`, result.zipBytes);
}

void main();
