// Fab bundle orchestrator (PCB Stage 14) — the pinned entry point.
//
// Capture immutable snapshot → evaluate scoped release policy →
// write .kicad_pcb to a temp dir → kicad-cli gerbers + drill (never emit
// RS-274X/Excellon ourselves) → rename per the fab preset's layerBundle →
// our own pick-and-place + BOM CSVs → zip (jszip) with a README → cleanup.
// Every failure is a typed exception the API route maps to an HTTP status.

import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import JSZip from "jszip";
import { writeKicadPcb } from "../kicad/write-pcb";
import { computeElectricalTruth, type ElectricalTruthReport } from "../electrical-truth";
import { layerHeaderEntries } from "../kicad/layer-map";
import type { BundleInput, BundleResult, FabPreset } from "./types";
import { KicadCliError } from "./types";
import type { KicadCliRunner, RunKicadCliResult } from "./kicad-cli-runner";
import { runKicadCli } from "./kicad-cli-runner";
import { computeBomRows, emitBomCsv } from "./emit-bom";
import { emitPositionCsv } from "./emit-position";
import { evaluatePcbFabricationReadiness } from "../readiness/evaluate";
import { createManufacturingReleaseManifest, prepareManufacturingRelease } from "../readiness/release";
import { sha256 } from "./native/stable";

const CLI_TIMEOUT_MS = 60_000; // per invocation (pinned)

/** Test seam + env plumbing; production callers pass nothing. */
export interface BuildBundleOptions {
  cliPath?: string; // default: env KICAD_CLI, else 'kicad-cli' on PATH
  runner?: KicadCliRunner; // default: real subprocess
}

function safeName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return clean.length > 0 ? clean.slice(0, 80) : "sirkit-board";
}

function checkCli(result: RunKicadCliResult, step: string): asserts result is Extract<RunKicadCliResult, { ok: true }> {
  if (result.ok) return;
  if (result.error === "cli-missing") {
    throw new KicadCliError("cli-missing", `kicad-cli not found (set KICAD_CLI or add it to PATH) — ${step}`, result.stderr);
  }
  if (result.error === "timeout") {
    throw new KicadCliError("timeout", `kicad-cli timed out during ${step}`, result.stderr);
  }
  throw new KicadCliError("cli-failed", `kicad-cli failed during ${step}`, result.stderr);
}

// kicad-cli's own gerber naming varies by KiCad version: 8 writes
// `<stem>-F_Cu.gbr` / `<stem>-F_SilkS.gbr`; 9/10 write `<stem>-F_Cu.gtl` /
// `<stem>-F_Silkscreen.gto` (protel extensions + user-facing layer names).
// Collection is therefore SCAN-based: match on the layer-name segment under
// either naming, ignore the extension.
const USER_NAME_BY_KICAD: ReadonlyMap<string, string> = new Map(
  layerHeaderEntries(4)
    .filter((e) => e.userName !== undefined)
    .map((e) => [e.name, e.userName as string]),
);

function gerberNameCandidates(stem: string, kicadName: string): string[] {
  const variants = [kicadName, USER_NAME_BY_KICAD.get(kicadName)].filter(
    (v): v is string => v !== undefined,
  );
  return variants.map((v) => `${stem}-${v.replace(/[. ]/g, "_")}`);
}

/** `{boardName}_cpl.csv` + side → `<board>_cpl_top.csv`. */
function posFilename(preset: FabPreset, boardName: string, side: "top" | "bottom" | null): string {
  const base = preset.pos.filename.replace("{boardName}", boardName);
  if (!side) return base;
  return base.includes(".") ? base.replace(/(\.[^.]+)$/, `_${side}$1`) : `${base}_${side}`;
}

export async function buildFabBundle(
  input: BundleInput,
  opts: BuildBundleOptions = {},
): Promise<BundleResult> {
  const t0 = Date.now();
  const { fabPreset, drcPreset, netlist } = input;
  const boardName = safeName(input.boardName);
  const runner = opts.runner ?? runKicadCli;
  const cliPath = opts.cliPath ?? process.env.KICAD_CLI ?? "kicad-cli";

  // ── 1. Immutable, scoped manufacturing-release gate ─────────────────────
  const prepared = prepareManufacturingRelease({
    board: input.board,
    disposition: input.releaseDisposition ?? "verified_manufacturing_release",
    priorReport: input.priorReadinessReport,
    evaluate: (snapshot) => evaluatePcbFabricationReadiness({
      board: snapshot,
      netlist: input.schematicIntentAvailable === false ? undefined : netlist,
      fabPreset,
      drcPreset,
      exporter: "kicad-assisted",
      waivers: input.waivers,
    }),
  });
  const board = prepared.snapshot;
  const electricalTruth = computeElectricalTruth(board);
  const drcErrors = prepared.report.metrics.drcErrors;
  const drcWarnings = prepared.report.metrics.drcWarnings;

  // ── 2. Board → .kicad_pcb in a temp dir ─────────────────────────────────
  const pcbText = writeKicadPcb(board, netlist, { boardName, drcRules: drcPreset.rules });

  const tmp = await mkdtemp(join(tmpdir(), "sirkit-fab-"));
  try {
    const pcbPath = join(tmp, `${boardName}.kicad_pcb`);
    await writeFile(pcbPath, pcbText, "utf8");

    const zip = new JSZip();
    const root = fabPreset.zipRootFolder
      ? zip.folder(fabPreset.zipRootFolder.replace(/\/+$/, ""))!
      : zip;
    const zipped: string[] = [];
    const releaseArtifacts: Array<{ path: string; kind: string; bytes: number; sha256: string }> = [];
    const add = (name: string, data: string | Uint8Array): void => {
      root.file(name, data);
      zipped.push(name);
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      releaseArtifacts.push({
        path: fabPreset.zipRootFolder ? `${fabPreset.zipRootFolder.replace(/\/+$/, "")}/${name}` : name,
        kind: name.endsWith(".csv") ? "assembly" : name.endsWith(".drl") ? "drill" : name.endsWith(".json") ? "manifest" : name.endsWith(".txt") ? "readme" : "gerber",
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
    };
    const electricalManifest = (report: ElectricalTruthReport): unknown => ({
      schemaVersion: report.schemaVersion,
      designRevision: report.designRevision,
      intended: report.intended,
      assigned: {
        state: report.assigned.state,
        terminalGroups: report.assigned.terminalGroups,
        missingEndpointKeys: report.assigned.missingEndpointKeys,
        unaccountedPadInstanceIds: report.assigned.unaccountedPadInstanceIds,
      },
      realized: {
        state: report.realized.state,
        requiredConnections: report.realized.requiredConnections,
        completedConnections: report.realized.completedConnections,
        remainingConnections: report.realized.remainingConnections,
      },
      nets: report.nets,
      shorts: report.shorts,
      orphanCopper: report.orphanCopper,
      unresolved: report.unresolved,
    });
    add("SIRKIT_ELECTRICAL_TRUTH.json", `${JSON.stringify(electricalManifest(electricalTruth), null, 2)}\n`);
    add("SIRKIT_READINESS_REPORT.json", `${JSON.stringify(prepared.report, null, 2)}\n`);

    // ── 3. Gerbers (kicad-cli), renamed per the fab's layerBundle ──────────
    const enabledLayers = fabPreset.layerBundle.filter((e) => e.enabled);
    const gerberDir = join(tmp, "gerbers");
    checkCli(
      await runner({
        cliPath,
        args: [
          "pcb", "export", "gerbers", pcbPath,
          "--output", gerberDir,
          "--layers", enabledLayers.map((e) => e.kicadName).join(","),
        ],
        timeoutMs: CLI_TIMEOUT_MS,
        cwd: tmp,
      }),
      "gerber export",
    );

    const produced = await readdir(gerberDir);
    const gerberFiles: string[] = [];
    for (const entry of enabledLayers) {
      const candidates = gerberNameCandidates(boardName, entry.kicadName);
      const found = produced.find((f) => candidates.includes(f.replace(/\.[^.]+$/, "")));
      if (!found) {
        throw new KicadCliError(
          "cli-failed",
          `kicad-cli produced no gerber for layer ${entry.kicadName} (files: ${produced.join(", ") || "none"})`,
        );
      }
      const target = `${boardName}${entry.fileSuffix}`;
      add(target, await readFile(join(gerberDir, found)));
      gerberFiles.push(target);
    }

    // ── 4. Drill (kicad-cli Excellon) ──────────────────────────────────────
    const drillDir = join(tmp, "drill");
    checkCli(
      await runner({
        cliPath,
        args: [
          "pcb", "export", "drill", pcbPath,
          "--output", drillDir,
          "--format", "excellon",
          "--excellon-units", fabPreset.drill.format === "excellon-2:4-inch" ? "in" : "mm",
          "--excellon-zeros-format", "decimal",
          "--drill-origin", "absolute",
          ...(fabPreset.drill.separateNPTH ? ["--excellon-separate-th"] : []),
        ],
        timeoutMs: CLI_TIMEOUT_MS,
        cwd: tmp,
      }),
      "drill export",
    );

    const drillFiles: string[] = [];
    for (const name of (await readdir(drillDir)).filter((f) => f.endsWith(".drl")).sort()) {
      add(name, await readFile(join(drillDir, name)));
      drillFiles.push(name);
    }
    if (drillFiles.length === 0) {
      throw new KicadCliError("cli-failed", "kicad-cli produced no .drl drill files");
    }

    // ── 5. Pick-and-place (our emitter — column layouts are per-fab data) ──
    const posFiles: string[] = [];
    if (fabPreset.pos.splitBySide) {
      for (const side of ["top", "bottom"] as const) {
        const name = posFilename(fabPreset, boardName, side);
        add(name, emitPositionCsv(board, fabPreset.pos.format, side));
        posFiles.push(name);
      }
    } else {
      const name = posFilename(fabPreset, boardName, null);
      add(name, emitPositionCsv(board, fabPreset.pos.format, "both"));
      posFiles.push(name);
    }

    // ── 6. BOM ─────────────────────────────────────────────────────────────
    const bomFile = fabPreset.bom.filename.replace("{boardName}", boardName);
    add(bomFile, emitBomCsv(computeBomRows(board, netlist), fabPreset.bom.columns));

    // ── 7. README (pinned: not optional) ───────────────────────────────────
    const generatedAt = new Date().toISOString();
    add(
      "README.txt",
      [
        `${boardName} — manufacturing bundle for ${fabPreset.fab} (${fabPreset.name})`,
        `Generated by sirkit on ${generatedAt}.`,
        "",
        fabPreset.notes,
        "",
        `Release disposition: ${prepared.disposition === "verified_manufacturing_release" ? "verified PCB fabrication checks" : "unverified engineering prototype export"}.`,
        `Readiness: ${prepared.report.overallState} (${prepared.report.reportId}).`,
        `DRC (${drcPreset.name}): ${drcErrors} error(s), ${drcWarnings} warning(s).`,
        "",
        "Files:",
        ...zipped.map((f) => `  ${f}`),
      ].join("\r\n") + "\r\n",
    );

    const releaseManifest = createManufacturingReleaseManifest({
      prepared,
      projectIdentity: input.projectIdentity ?? boardName,
      exporterVersion: "kicad-assisted/1",
      generatedAt,
      actor: input.actor,
      artifacts: releaseArtifacts,
    });
    add("SIRKIT_RELEASE_MANIFEST.json", `${JSON.stringify(releaseManifest, null, 2)}\n`);

    const zipBytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const date = new Date().toISOString().slice(0, 10);
    return {
      zipBytes,
      sourceRevision: electricalTruth.designRevision,
      readiness: prepared.report,
      releaseManifest,
      filename: `${boardName}-${fabPreset.id}-${date}.zip`,
      stats: {
        drcErrors,
        drcWarnings,
        gerberFiles,
        drillFiles,
        posFiles,
        bomFile,
        totalBytes: zipBytes.byteLength,
        elapsedMs: Date.now() - t0,
      },
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
