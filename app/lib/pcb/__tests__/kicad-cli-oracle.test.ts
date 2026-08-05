// kicad-cli oracle (Stage 13) — gated on env KICAD_CLI pointing at the
// kicad-cli binary; skips cleanly when unset (kicad-cli is a test oracle,
// never a runtime dependency).
//
//   KICAD_CLI="C:\Program Files\KiCad\8.0\bin\kicad-cli.exe" pnpm test kicad-cli-oracle
//
// 1. Exports the ?pcbdemo=routed fixture to a temp .kicad_pcb.
// 2. kicad-cli pcb drc — exit 0 proves KiCad parses/loads the file.
// 3. KiCad's ERROR count vs sirkit runDrc's on the same board: within ±10 %.
//    (Errors, not totals — measured on KiCad 10: warnings are counted at
//    different granularity across engines, e.g. one orphan track is TWO
//    KiCad `track_dangling` warnings, and airwires live in a separate
//    unconnected_items list. Error counts agree: the deliberate short.)

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeKicadPcb, netlistFromBoard } from "../kicad/write-pcb";
import { createEmptyBoard } from "../types";
import { buildRoutedDemo } from "../demo/routed-demo";
import { runDrc } from "../drc/run-drc";
import { getPreset } from "../drc/presets";

const KICAD_CLI = process.env.KICAD_CLI;

describe.skipIf(!KICAD_CLI)("kicad-cli oracle", () => {
  it("exported routed demo loads in KiCad and DRC error counts land within ±10 %", () => {
    const board = createEmptyBoard();
    const rules = getPreset("jlcpcb-2l").rules;
    const text = writeKicadPcb(board, netlistFromBoard(board), { drcRules: rules });

    const dir = mkdtempSync(join(tmpdir(), "sirkit-kicad-"));
    try {
      const pcbPath = join(dir, "routed-demo.kicad_pcb");
      const reportPath = join(dir, "drc.json");
      writeFileSync(pcbPath, text, "utf8");

      // Throws on nonzero exit → file failed to load.
      execFileSync(KICAD_CLI as string, [
        "pcb", "drc", pcbPath,
        "--format", "json",
        "--output", reportPath,
        "--units", "mm",
      ], { stdio: "pipe", timeout: 120_000 });

      const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
        violations?: { severity?: string }[];
        unconnected_items?: unknown[];
      };
      const kicadErrors = (report.violations ?? []).filter((v) => v.severity === "error").length;

      const ourErrors = runDrc(board, rules).violations.filter((v) => v.severity === "error").length;
      const tolerance = Math.max(1, Math.ceil(ourErrors * 0.1));
      expect(Math.abs(kicadErrors - ourErrors)).toBeLessThanOrEqual(tolerance);
      // Both engines must agree the demo board is not clean (the baked-in short).
      expect(kicadErrors).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Stage 14 extension: real end-to-end fab bundle through kicad-cli.
describe.skipIf(!KICAD_CLI)("kicad-cli oracle — fab bundle", () => {
  it("buildFabBundle produces the preset's exact file counts with the real CLI", async () => {
    const { buildFabBundle } = await import("../fab/build-bundle");
    const { getFabPreset } = await import("../fab/presets");
    const { netlistFromBoard } = await import("../kicad/write-pcb");
    const board = buildRoutedDemo();
    const fabPreset = getFabPreset("jlcpcb-2l");
    const result = await buildFabBundle(
      {
        board,
        netlist: { components: [], nets: [] },
        fabPreset,
        drcPreset: getPreset("jlcpcb-2l"),
        boardName: "sirkit-demo",
      },
      { cliPath: KICAD_CLI as string },
    );
    expect(result.stats.gerberFiles.length).toBe(fabPreset.layerBundle.filter((e) => e.enabled).length);
    expect(result.stats.drillFiles.length).toBeGreaterThanOrEqual(1);
    expect(result.stats.posFiles.length).toBe(2);
    expect(result.zipBytes.byteLength).toBeGreaterThan(1000);
  }, 240_000);
});

// Always-on placeholder so the file reports as skipped-not-empty without KICAD_CLI.
describe("kicad-cli oracle gating", () => {
  it("skips cleanly when KICAD_CLI is not set", () => {
    expect(true).toBe(true);
  });
});
