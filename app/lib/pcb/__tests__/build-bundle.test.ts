// Fab bundle orchestrator (Stage 14). kicad-cli is fully mocked — the fake
// runner fabricates the files the real CLI would write, so these tests never
// need KiCad installed (the kicad-cli-oracle test covers the real thing).

import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import { basename, join } from "path";
import JSZip from "jszip";
import { buildFabBundle } from "../fab/build-bundle";
import type { KicadCliRunner } from "../fab/kicad-cli-runner";
import { FabExportGatedByDrc } from "../fab/types";
import { getFabPreset } from "../fab/presets";
import { getPreset } from "../drc/presets";
import { buildRoutedDemo } from "../demo/routed-demo";
import { netlistFromBoard } from "../kicad/write-pcb";
import { computeFill } from "../zones/compute-fill";
import { makeEffectiveClearance } from "../zones/types";
import { emitZone } from "../kicad/emit-zone";

/** Writes exactly the files kicad-cli would, based on the args it receives. */
const fakeRunner: KicadCliRunner = async ({ args }) => {
  const command = args[2]; // 'gerbers' | 'drill'
  const pcbPath = args[3];
  const stem = basename(pcbPath, ".kicad_pcb");
  const outDir = args[args.indexOf("--output") + 1];
  await mkdir(outDir, { recursive: true });
  if (command === "gerbers") {
    const layers = args[args.indexOf("--layers") + 1].split(",");
    for (const layer of layers) {
      await writeFile(join(outDir, `${stem}-${layer.replace(/\./g, "_")}.gbr`), "G04 fake gerber*\nM02*\n");
    }
  } else if (command === "drill") {
    await writeFile(join(outDir, `${stem}-PTH.drl`), "M48\nMETRIC\nM30\n");
    if (args.includes("--excellon-separate-th")) {
      await writeFile(join(outDir, `${stem}-NPTH.drl`), "M48\nMETRIC\nM30\n");
    }
  }
  return { ok: true, stdout: "", stderr: "", elapsedMs: 1 };
};

const jlc = getFabPreset("jlcpcb-2l");
const jlcDrc = getPreset("jlcpcb-2l");

function demoInput(overrideDrcFail: boolean) {
  const board = buildRoutedDemo(); // deliberately fails DRC (one short baked in)
  return {
    board,
    netlist: netlistFromBoard(board),
    fabPreset: jlc,
    drcPreset: jlcDrc,
    overrideDrcFail,
    boardName: "sirkit-demo",
  };
}

describe("buildFabBundle", () => {
  it("(a)+(c) demo + jlcpcb-2l (override — demo has a deliberate short) → full bundle stats", async () => {
    const result = await buildFabBundle(demoInput(true), { runner: fakeRunner, cliPath: "fake" });

    expect(result.stats.gerberFiles.length).toBe(7);
    expect(result.stats.gerberFiles).toContain("sirkit-demo.GTL");
    expect(result.stats.gerberFiles).toContain("sirkit-demo.GML");
    expect(result.stats.drillFiles.length).toBeGreaterThanOrEqual(1);
    expect(result.stats.posFiles).toEqual(["sirkit-demo_cpl_top.csv", "sirkit-demo_cpl_bottom.csv"]);
    expect(result.stats.bomFile).toBe("sirkit-demo_bom.csv");
    expect(result.stats.drcErrors).toBeGreaterThan(0); // exported via override
    expect(result.filename).toMatch(/^sirkit-demo-jlcpcb-2l-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(result.stats.totalBytes).toBe(result.zipBytes.byteLength);
    expect(result.zipBytes.byteLength).toBeGreaterThan(0);

    // Zip layout: everything under the preset's root folder + README (pinned).
    const zip = await JSZip.loadAsync(result.zipBytes);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names).toContain("gerber/sirkit-demo.GTL");
    expect(names).toContain("gerber/sirkit-demo-PTH.drl");
    expect(names).toContain("gerber/sirkit-demo_cpl_top.csv");
    expect(names).toContain("gerber/sirkit-demo_bom.csv");
    expect(names).toContain("gerber/README.txt");
    const readme = await zip.file("gerber/README.txt")!.async("string");
    expect(readme).toContain(jlc.notes);
    expect(readme).toContain("override");
  });

  it("(b) DRC failing without override → throws FabExportGatedByDrc with violations", async () => {
    const promise = buildFabBundle(demoInput(false), { runner: fakeRunner, cliPath: "fake" });
    await expect(promise).rejects.toBeInstanceOf(FabExportGatedByDrc);
    await promise.catch((e: FabExportGatedByDrc) => {
      expect(e.violations.length).toBeGreaterThan(0);
    });
  });

  it("cli-missing from the runner surfaces as a typed KicadCliError", async () => {
    const missingRunner: KicadCliRunner = async () => ({
      ok: false,
      error: "cli-missing",
      stderr: "spawn kicad-cli ENOENT",
      elapsedMs: 1,
    });
    await expect(
      buildFabBundle(demoInput(true), { runner: missingRunner, cliPath: "fake" }),
    ).rejects.toMatchObject({ name: "KicadCliError", kind: "cli-missing" });
  });

  it("flat-zip presets (pcbway) put files at the zip root", async () => {
    const board = buildRoutedDemo();
    const result = await buildFabBundle(
      {
        board,
        netlist: netlistFromBoard(board),
        fabPreset: getFabPreset("pcbway-standard"),
        drcPreset: getPreset("pcbway-standard"),
        overrideDrcFail: true,
        boardName: "sirkit-demo",
      },
      { runner: fakeRunner, cliPath: "fake" },
    );
    const zip = await JSZip.loadAsync(result.zipBytes);
    expect(zip.file("sirkit-demo-F_Cu.gbr")).toBeTruthy();
    expect(zip.file("README.txt")).toBeTruthy();
    expect(result.stats.posFiles).toEqual(["sirkit-demo-pos.csv"]);
  });

  it("zone copper reaches the .kicad_pcb: poured fill emits hole-free filled_polygons", () => {
    const board = buildRoutedDemo();
    // Stretch the demo zone up to y=30 mm so it overlaps GND copper (R2's GND
    // pad + the GND run at y≈37) — otherwise island removal rightly drops the
    // whole pour. The net-0 orphan track at y=52 sits fully inside → a real
    // hole, exercising the fracture path.
    const zone = {
      ...board.zones[0],
      polygon: [
        { x: 6_000_000, y: 30_000_000 },
        { x: 28_000_000, y: 30_000_000 },
        { x: 28_000_000, y: 57_000_000 },
        { x: 6_000_000, y: 57_000_000 },
      ],
    };
    const fill = computeFill({
      board,
      zone,
      effectiveClearance: makeEffectiveClearance(board, zone),
    });
    expect(fill.regions.length).toBeGreaterThan(0);
    expect(fill.regions.some((r) => r.holes.length > 0)).toBe(true); // the orphan-track hole
    const filled = { ...zone, fill: fill.regions, dirty: false };
    const text = emitZone(filled, board, netlistFromBoard(board));
    const count = (text.match(/\(filled_polygon/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(fill.regions.length);
    expect(text).toContain("(polygon");
    expect(text).toContain(`(net_name "GND")`);
  });
});
