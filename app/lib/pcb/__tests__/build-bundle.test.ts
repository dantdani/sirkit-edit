import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import { basename, join } from "path";
import JSZip from "jszip";
import { buildFabBundle } from "../fab/build-bundle";
import type { KicadCliRunner } from "../fab/kicad-cli-runner";
import { getFabPreset } from "../fab/presets";
import { getPreset } from "../drc/presets";
import { buildRoutedDemo } from "../demo/routed-demo";
import { netlistFromBoard } from "../kicad/write-pcb";
import { createEmptyBoard } from "../types";
import { ManufacturingReleaseBlockedError } from "../readiness/release";

const fakeRunner: KicadCliRunner = async ({ args }) => {
  const command = args[2];
  const pcbPath = args[3];
  const stem = basename(pcbPath, ".kicad_pcb");
  const outDir = args[args.indexOf("--output") + 1];
  await mkdir(outDir, { recursive: true });
  if (command === "gerbers") {
    const layers = args[args.indexOf("--layers") + 1].split(",");
    for (const layer of layers) await writeFile(join(outDir, `${stem}-${layer.replace(/\./g, "_")}.gbr`), "G04 fake gerber*\nM02*\n");
  } else if (command === "drill") {
    await writeFile(join(outDir, `${stem}-PTH.drl`), "M48\nMETRIC\nM30\n");
    if (args.includes("--excellon-separate-th")) await writeFile(join(outDir, `${stem}-NPTH.drl`), "M48\nMETRIC\nM30\n");
  }
  return { ok: true, stdout: "", stderr: "", elapsedMs: 1 };
};

function validInput(fabId: "jlcpcb-2l" | "pcbway-standard" = "jlcpcb-2l") {
  return {
    board: createEmptyBoard(),
    netlist: { components: [], nets: [] },
    fabPreset: getFabPreset(fabId),
    drcPreset: getPreset(fabId),
    boardName: "sirkit-demo",
  };
}

describe("buildFabBundle release transaction", () => {
  it("generates a verified exact-snapshot bundle with readiness and release manifests", async () => {
    const result = await buildFabBundle(validInput(), { runner: fakeRunner, cliPath: "fake" });
    expect(result.stats.gerberFiles).toContain("sirkit-demo.GTL");
    expect(result.stats.drillFiles.length).toBeGreaterThanOrEqual(1);
    expect(result.stats.drcErrors).toBe(0);
    expect(result.readiness.overallState).toBe("ready");
    expect(result.releaseManifest).toMatchObject({ verified: true, designRevision: result.sourceRevision });

    const zip = await JSZip.loadAsync(result.zipBytes);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    expect(names).toContain("gerber/SIRKIT_READINESS_REPORT.json");
    expect(names).toContain("gerber/SIRKIT_RELEASE_MANIFEST.json");
    expect(names).toContain("gerber/README.txt");
    expect(await zip.file("gerber/README.txt")!.async("string")).toContain("verified PCB fabrication checks");
  });

  it("denies a false verified release before invoking the exporter", async () => {
    const board = buildRoutedDemo();
    let exporterInvoked = false;
    const guardedRunner: KicadCliRunner = async (request) => {
      exporterInvoked = true;
      return fakeRunner(request);
    };
    await expect(buildFabBundle({
      board,
      netlist: netlistFromBoard(board),
      schematicIntentAvailable: false,
      fabPreset: getFabPreset("jlcpcb-2l"),
      drcPreset: getPreset("jlcpcb-2l"),
      boardName: "blocked",
    }, { runner: guardedRunner, cliPath: "fake" })).rejects.toBeInstanceOf(ManufacturingReleaseBlockedError);
    expect(exporterInvoked).toBe(false);
  });

  it("surfaces a typed CLI failure only after readiness authorization", async () => {
    const missingRunner: KicadCliRunner = async () => ({ ok: false, error: "cli-missing", stderr: "ENOENT", elapsedMs: 1 });
    await expect(buildFabBundle(validInput(), { runner: missingRunner, cliPath: "fake" }))
      .rejects.toMatchObject({ name: "KicadCliError", kind: "cli-missing" });
  });

  it("supports flat ZIP profiles while preserving release evidence", async () => {
    const result = await buildFabBundle(validInput("pcbway-standard"), { runner: fakeRunner, cliPath: "fake" });
    const zip = await JSZip.loadAsync(result.zipBytes);
    expect(zip.file("sirkit-demo-F_Cu.gbr")).toBeTruthy();
    expect(zip.file("SIRKIT_RELEASE_MANIFEST.json")).toBeTruthy();
  });

  it("labels a requested engineering artifact as non-verified even when checks pass", async () => {
    const result = await buildFabBundle({ ...validInput(), releaseDisposition: "engineering_prototype_export" }, { runner: fakeRunner, cliPath: "fake" });
    expect(result.releaseManifest).toMatchObject({ verified: false, disposition: "engineering_prototype_export" });
    expect(result.readiness.overallState).toBe("ready");
  });
});
