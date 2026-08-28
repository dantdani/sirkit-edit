import JSZip from "jszip";
import { createManufacturingSnapshot } from "./snapshot";
import { compileManufacturingIr } from "./mir";
import { writeGerberLayer } from "./gerber-writer";
import { parseGerber } from "./gerber-parser";
import { verifyGerberLayer } from "./gerber-verify";
import { drillGroupAsGerberLayer, groupDrills, writeXnc } from "./drill";
import { parseXnc } from "./xnc-parser";
import { verifyXnc } from "./xnc-verify";
import { emitGerberJob, emitNativeBom, emitNativePlacement, type JobFileEntry } from "./ancillary";
import { safeFabName, sha256, stableJson, utf8 } from "./stable";
import type {
  FabDiagnostic,
  ManufacturingSnapshot,
  MirLayer,
  NativeFabCompileInput,
  NativeFabCompileResult,
  NativeFabFile,
  NativeFabManifest,
  NativeFabStageReport,
} from "./types";
import { NativeFabBlockedError } from "./types";
import { evaluatePcbFabricationReadiness } from "../../readiness/evaluate";
import { createManufacturingReleaseManifest, prepareManufacturingRelease } from "../../readiness/release";

const FIXED_ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");

function countDiagnostics(diagnostics: FabDiagnostic[]): { errors: number; warnings: number; infos: number } {
  return {
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    infos: diagnostics.filter((item) => item.severity === "info").length,
  };
}

function blockIfErrors(stage: string, diagnostics: FabDiagnostic[]): void {
  const errors = diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new NativeFabBlockedError(`${stage} blocked native manufacturing output with ${errors.length} error(s).`, diagnostics);
  }
}

function file(
  path: string,
  kind: NativeFabFile["kind"],
  mediaType: string,
  content: string | Uint8Array,
): NativeFabFile {
  const bytes = typeof content === "string" ? utf8(content) : content;
  return { path, kind, mediaType, bytes, sha256: sha256(bytes) };
}

function suffixForLayer(snapshot: ManufacturingSnapshot, layer: MirLayer): string {
  const preset = snapshot.fabPreset.layerBundle.find((entry) => entry.layerId === layer.sourceLayer);
  if (preset) return preset.fileSuffix;
  const fallback: Record<string, string> = {
    edge: "-Profile.gbr",
    "component-top": "-Component-Top.gbr",
    "component-bottom": "-Component-Bottom.gbr",
  };
  return fallback[layer.id] ?? `-${safeFabName(layer.filenameRole)}.gbr`;
}

function prefix(snapshot: ManufacturingSnapshot, basename: string): string {
  const root = snapshot.fabPreset.zipRootFolder?.replace(/^\/+|\/+$/g, "");
  return root ? `${root}/${basename}` : basename;
}

async function deterministicZip(files: NativeFabFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const item of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    zip.file(item.path, item.bytes, {
      date: FIXED_ZIP_DATE,
      createFolders: false,
      unixPermissions: 0o100644,
    });
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "STORE",
    platform: "UNIX",
    streamFiles: false,
  });
}

function stage(
  stages: NativeFabStageReport[],
  name: string,
  started: number,
  diagnostics: FabDiagnostic[],
): void {
  stages.push({
    stage: name,
    status: diagnostics.some((item) => item.severity === "error") ? "failed" : "passed",
    elapsedMs: Date.now() - started,
    diagnostics,
  });
}

export async function compileNativeFabPackage(input: NativeFabCompileInput): Promise<NativeFabCompileResult> {
  const stages: NativeFabStageReport[] = [];
  const allDiagnostics: FabDiagnostic[] = [];

  const prepared = prepareManufacturingRelease({
    board: input.board,
    disposition: input.releaseDisposition ?? "verified_manufacturing_release",
    priorReport: input.priorReadinessReport,
    evaluate: (board) => evaluatePcbFabricationReadiness({
      board,
      netlist: input.schematicIntentAvailable === false ? undefined : input.netlist,
      fabPreset: input.fabPreset,
      drcPreset: input.drcPreset,
      exporter: "sirkit-native",
      waivers: input.waivers,
    }),
  });

  let started = Date.now();
  const { snapshot, diagnostics: snapshotDiagnostics } = createManufacturingSnapshot({ ...input, board: prepared.snapshot });
  allDiagnostics.push(...snapshotDiagnostics);
  stage(stages, "immutable-snapshot", started, snapshotDiagnostics);
  const snapshotBlocking = prepared.disposition === "verified_manufacturing_release"
    ? snapshotDiagnostics
    : snapshotDiagnostics.filter((diagnostic) => diagnostic.category !== "drc" && diagnostic.code !== "SNAPSHOT_STALE_ZONE_FILL");
  blockIfErrors("Immutable snapshot", snapshotBlocking);

  started = Date.now();
  const mir = compileManufacturingIr(snapshot);
  const mirDiagnostics = mir.diagnostics;
  allDiagnostics.push(...mirDiagnostics);
  stage(stages, "manufacturing-ir", started, mirDiagnostics);
  blockIfErrors("Manufacturing IR", mirDiagnostics);

  started = Date.now();
  const files: NativeFabFile[] = [];
  const jobEntries: JobFileEntry[] = [];
  const emittedLayers: Array<{ layer: MirLayer; path: string; text: string }> = [];
  for (const layer of mir.layers) {
    const basename = `${snapshot.boardName}${suffixForLayer(snapshot, layer)}`;
    const path = prefix(snapshot, basename);
    const output = writeGerberLayer(snapshot, mir, layer);
    files.push(file(path, "gerber", "application/vnd.gerber", output.text));
    emittedLayers.push({ layer, path, text: output.text });
    jobEntries.push({
      path: basename,
      fileFunction: layer.fileFunction,
      filePolarity: layer.polarity,
      fileFormat: "Gerber",
    });
  }

  const drillGroups = groupDrills(mir);
  if (snapshot.recipe.includeGerberDrill) {
    for (const group of drillGroups) {
      const layer = drillGroupAsGerberLayer(group);
      const basename = `${snapshot.boardName}-${group.id}.gbr`;
      const path = prefix(snapshot, basename);
      const output = writeGerberLayer(snapshot, mir, layer);
      files.push(file(path, "gerber", "application/vnd.gerber", output.text));
      emittedLayers.push({ layer, path, text: output.text });
      jobEntries.push({ path: basename, fileFunction: layer.fileFunction, filePolarity: "Positive", fileFormat: "Gerber" });
    }
  }
  const emittedXnc: Array<{ path: string; text: string; group: (typeof drillGroups)[number] }> = [];
  if (snapshot.recipe.includeXnc) {
    for (const group of drillGroups) {
      const basename = `${snapshot.boardName}-${group.id}.xnc`;
      const path = prefix(snapshot, basename);
      const text = writeXnc(group);
      files.push(file(path, "xnc", "application/x-excellon", text));
      emittedXnc.push({ path, text, group });
      jobEntries.push({ path: basename, fileFunction: group.fileFunction, fileFormat: "XNC" });
    }
  }
  stage(stages, "format-compilers", started, []);

  started = Date.now();
  const verificationDiagnostics: FabDiagnostic[] = [];
  for (const output of emittedLayers) {
    verificationDiagnostics.push(...verifyGerberLayer(output.layer, parseGerber(output.text), output.path));
  }
  for (const output of emittedXnc) {
    verificationDiagnostics.push(...verifyXnc(output.group, parseXnc(output.text), output.path));
  }
  allDiagnostics.push(...verificationDiagnostics);
  stage(stages, "independent-parse-back", started, verificationDiagnostics);
  blockIfErrors("Independent parse-back", verificationDiagnostics);

  started = Date.now();
  const placementName = `${snapshot.boardName}-placement.csv`;
  const bomName = snapshot.fabPreset.bom.filename.replace("{boardName}", snapshot.boardName);
  if (snapshot.recipe.includePlacement) {
    files.push(file(prefix(snapshot, placementName), "placement", "text/csv", emitNativePlacement(snapshot)));
  }
  if (snapshot.recipe.includeBom) {
    files.push(file(prefix(snapshot, bomName), "bom", "text/csv", emitNativeBom(snapshot)));
  }
  const jobName = `${snapshot.boardName}.gbrjob`;
  files.push(file(prefix(snapshot, jobName), "job", "application/json", emitGerberJob(snapshot, mir, jobEntries)));
  files.push(file(
    prefix(snapshot, "README.txt"),
    "readme",
    "text/plain",
    [
      `${snapshot.boardName} - Sirkit native manufacturing package`,
      "",
      ...(input.releaseDisposition === "engineering_prototype_export" ? [
        "NOTICE: this is an ENGINEERING PROTOTYPE EXPORT of a client working copy - NOT a verified manufacturing release.",
        "It is unsuitable as deterministic release evidence; verified release is produced only by the server-authoritative release flow.",
        `Attribution (server-derived from the authenticated session): actor=${input.actor ?? "unattributed"}; project=${input.projectIdentity ?? snapshot.boardName}.`,
        "",
      ] : []),
      "Status: native beta, independently parsed and geometry-checked before packaging.",
      "Production policy: keep the KiCad-assisted export as fallback until external CAM and fabricator acceptance gates pass.",
      `Snapshot: ${snapshot.sourceHash}`,
      `Recipe: ${snapshot.recipe.id} v${snapshot.recipe.version} (${snapshot.recipe.mode})`,
      "Coordinates: millimetres, board lower-left origin, +X right, +Y up, no layer mirroring.",
      "",
      "The Gerber Job file contains only values known by Sirkit. Material, finish, thickness and commercial terms are intentionally not invented.",
      "See manifest.json for hashes, standards revisions and package provenance.",
      "",
    ].join("\r\n"),
  ));
  stage(stages, "assembly-deliverables", started, []);

  started = Date.now();
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const releaseManifest = createManufacturingReleaseManifest({
    prepared,
    projectIdentity: input.projectIdentity ?? snapshot.boardName,
    exporterVersion: "sirkit-native-fab/1",
    generatedAt,
    actor: input.actor,
    artifacts: files.map((item) => ({ path: item.path, kind: item.kind, bytes: item.bytes.byteLength, sha256: item.sha256 })),
  });
  files.push(file(prefix(snapshot, "release-manifest.json"), "manifest", "application/json", `${JSON.stringify(releaseManifest, null, 2)}\n`));
  const packageId = sha256(stableJson({
    snapshot: snapshot.sourceHash,
    recipe: snapshot.recipe,
    files: files.map((item) => ({ path: item.path, sha256: item.sha256 })).sort((a, b) => a.path.localeCompare(b.path)),
  }));
  const manifest: NativeFabManifest = {
    schemaVersion: "sirkit.native-fab-manifest.v2",
    packageId,
    snapshotHash: snapshot.sourceHash,
    recipe: { id: snapshot.recipe.id, version: snapshot.recipe.version, mode: snapshot.recipe.mode },
    generator: { vendor: "Sirkit", application: "Sirkit Fab Compiler", version: "0.1.0" },
    standards: { gerber: snapshot.recipe.gerberRevision, xnc: snapshot.recipe.xncRevision, gerberJob: "2020.08" },
    signoff: prepared.disposition === "verified_manufacturing_release" ? "pcb-fabrication-checks-passed" : "engineering-prototype-unverified",
    releaseTransactionId: releaseManifest.transactionId,
    readinessReportId: prepared.report.reportId,
    planeCertificates: snapshot.planeCertificates,
    files: files
      .map((item) => ({ path: item.path, kind: item.kind, bytes: item.bytes.byteLength, sha256: item.sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    diagnostics: countDiagnostics(allDiagnostics),
  };
  files.push(file(prefix(snapshot, "manifest.json"), "manifest", "application/json", `${JSON.stringify(manifest, null, 2)}\n`));
  const zipBytes = await deterministicZip(files);
  const packageSha256 = sha256(zipBytes);
  stage(stages, "deterministic-package", started, []);

  return {
    zipBytes,
    filename: `${snapshot.boardName}-${snapshot.fabPreset.id}-native-${packageId.slice(0, 12)}.zip`,
    packageSha256,
    manifest,
    files,
    stages,
    diagnostics: allDiagnostics,
    readiness: prepared.report,
    releaseManifest,
  };
}

export function summarizeNativePreflight(result: NativeFabCompileResult): {
  packageId: string;
  packageSha256: string;
  files: Array<{ path: string; kind: NativeFabFile["kind"]; bytes: number; sha256: string }>;
  diagnostics: FabDiagnostic[];
  stages: NativeFabStageReport[];
  readiness: NativeFabCompileResult["readiness"];
} {
  return {
    packageId: result.manifest.packageId,
    packageSha256: result.packageSha256,
    files: result.files.map((item) => ({ path: item.path, kind: item.kind, bytes: item.bytes.byteLength, sha256: item.sha256 })),
    diagnostics: result.diagnostics,
    stages: result.stages,
    readiness: result.readiness,
  };
}
