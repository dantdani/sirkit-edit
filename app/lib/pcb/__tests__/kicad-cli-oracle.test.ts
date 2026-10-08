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
//    unconnected_items list. Error counts agree: the deliberate short.) [B24-B3, 2026-10-08] D24-19, OD-209: step 1 now exports the routed demo (it exported an empty board, so the comparison could not run as titled) behind a NOT MEASURED positive control; with KICAD_CLI set to a path that does not exist each block fails NOT EXERCISED before any case body runs; recorded `not exercised` (LB-17).

import { beforeAll, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeKicadPcb, netlistFromBoard } from "../kicad/write-pcb";
import { assertLiveResources, liveSuite, liveSuiteState } from "../../evaluation/live-suites"; // [B24-B3, 2026-10-08] in place of createEmptyBoard, which the first case no longer exports
import { buildRoutedDemo } from "../demo/routed-demo";
import { runDrc } from "../drc/run-drc";
import { getPreset } from "../drc/presets";

const KICAD_CLI = process.env.KICAD_CLI;

describe.skipIf(!KICAD_CLI)("kicad-cli oracle", () => {
  it("exported routed demo loads in KiCad and DRC error counts land within ±10 %", () => {
    const board = buildRoutedDemo(); // [B24-B3, 2026-10-08] was the empty board (createEmptyBoard), which has no short, so `kicadErrors > 0` could never hold
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
      expect(ourErrors, "NOT MEASURED: our DRC finds no error on the exported board, so the comparison below would observe nothing").toBeGreaterThan(0); // [B24-B3, 2026-10-08] the positive control, asserted first
      const tolerance = Math.max(1, Math.ceil(ourErrors * 0.1));
      expect(Math.abs(kicadErrors - ourErrors)).toBeLessThanOrEqual(tolerance);
      // Both engines must agree the demo board is not clean (the baked-in short).
      expect(kicadErrors).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  beforeAll(() => assertLiveResources("kicad-cli-oracle")); // [B24-B3, 2026-10-08] D24-19, OD-209: KICAD_CLI must be an existing absolute path, else NOT EXERCISED
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

  beforeAll(() => assertLiveResources("kicad-cli-oracle")); // [B24-B3, 2026-10-08] D24-19, OD-209: the same gate in this block
});

// Always-on placeholder so the file reports as skipped-not-empty without KICAD_CLI. [B24-B3, 2026-10-08] It asserts the gate's state (was an expect(true)).
describe("kicad-cli oracle gating", () => {
  it("skips cleanly when KICAD_CLI is not set", () => {
    const state = liveSuiteState(liveSuite("kicad-cli-oracle"), process.env);
    expect(state.state === "not_exercised" && state.reason === "flag_unset").toBe(!KICAD_CLI);
  });
});
