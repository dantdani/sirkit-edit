import JSZip from "jszip";
import { groupDrills } from "./native/drill";
import { parseGerber } from "./native/gerber-parser";
import { verifyGerberLayer } from "./native/gerber-verify";
import { sha256, stableJson } from "./native/stable";
import type { ManufacturingIr, NativeFabFile } from "./native/types";
import { parseXnc } from "./native/xnc-parser";
import { verifyXnc } from "./native/xnc-verify";
import type { ManufacturingReleaseFile, ManufacturingReleaseManifestV1 } from "./release-manifest";
import { validateManifestContentDigest } from "./release-manifest";

export const MFG01_VALIDATOR_ID = "sirkit-independent-fab-readback/1" as const;
const MAX_FILES = 64;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

export interface ManufacturingValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ManufacturingReadbackResult {
  validatorId: typeof MFG01_VALIDATOR_ID;
  valid: boolean;
  issues: ManufacturingValidationIssue[];
  readbackDigest: string;
  gerber: Array<{ path: string; mirLayerId: string; apertures: number; objects: number; fileFunction?: string }>;
  drills: Array<{ path: string; drillGroupId: string; tools: number; hits: number; fileFunction?: string }>;
  expectedPrimitives: number;
  parsedPrimitives: number;
  expectedDrills: number;
  parsedDrills: number;
}

export interface ExtractedReleaseArchive {
  manifest: ManufacturingReleaseManifestV1;
  manifestPath: string;
  files: Array<{ path: string; bytes: Uint8Array }>;
}

export function releasePathIssue(path: string): string | undefined {
  if (!path || path.includes("\0")) return "path is empty or contains NUL";
  if (path.includes("\\")) return "backslashes are forbidden";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "absolute and drive-letter paths are forbidden";
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return "empty, dot, and parent segments are forbidden";
  if (path.length > 240) return "path exceeds 240 characters";
  return undefined;
}

function pathIssues(paths: string[]): ManufacturingValidationIssue[] {
  const issues: ManufacturingValidationIssue[] = [];
  const seen = new Map<string, string>();
  for (const path of paths) {
    const invalid = releasePathIssue(path);
    if (invalid) issues.push({ code: "MFG_ARCHIVE_PATH_UNSAFE", message: invalid, path });
    const folded = path.toLocaleLowerCase("en-US");
    const earlier = seen.get(folded);
    if (earlier) issues.push({ code: "MFG_ARCHIVE_PATH_COLLISION", message: `${path} collides with ${earlier}.`, path });
    else seen.set(folded, path);
  }
  return issues;
}

function requiredRoleIssues(records: ManufacturingReleaseFile[], mir: ManufacturingIr): ManufacturingValidationIssue[] {
  const roles = new Set(records.map((record) => record.role));
  const issues: ManufacturingValidationIssue[] = [];
  const requireRole = (role: ManufacturingReleaseFile["role"]): void => {
    if (!roles.has(role)) issues.push({ code: "MFG_REQUIRED_FILE_MISSING", message: `Required ${role} output is missing.` });
  };
  for (const role of ["copper_top", "copper_bottom", "mask_top", "mask_bottom", "outline", "readme"] as const) requireRole(role);
  if (mir.drills.some((drill) => drill.plated)) requireRole("pth_drill");
  if (mir.drills.some((drill) => !drill.plated)) requireRole("npth_drill");
  for (const [layerId, role] of [["silkTop", "silk_top"], ["silkBottom", "silk_bottom"]] as const) {
    if ((mir.layers.find((layer) => layer.id === layerId)?.primitives.length ?? 0) > 0) requireRole(role);
  }
  return issues;
}

export function validateFabricationFiles(input: {
  files: NativeFabFile[];
  records: ManufacturingReleaseFile[];
  mir: ManufacturingIr;
}): ManufacturingReadbackResult {
  const issues: ManufacturingValidationIssue[] = [
    ...pathIssues(input.files.map((file) => file.path)),
    ...requiredRoleIssues(input.records, input.mir),
  ];
  const fileByPath = new Map(input.files.map((file) => [file.path, file]));
  const gerber: ManufacturingReadbackResult["gerber"] = [];
  const drills: ManufacturingReadbackResult["drills"] = [];
  let expectedPrimitives = 0;
  let parsedPrimitives = 0;
  let expectedDrills = 0;
  let parsedDrills = 0;
  const drillGroups = new Map(groupDrills(input.mir).map((group) => [group.id, group]));

  for (const record of [...input.records].sort((left, right) => left.path.localeCompare(right.path))) {
    const file = fileByPath.get(record.path);
    if (!file) {
      issues.push({ code: "MFG_MANIFEST_FILE_MISSING", message: "Manifest file is absent.", path: record.path });
      continue;
    }
    if (file.bytes.byteLength === 0) issues.push({ code: "MFG_FILE_EMPTY", message: "Manufacturing file is empty.", path: file.path });
    if (file.bytes.byteLength !== record.bytes || sha256(file.bytes) !== record.sha256) issues.push({ code: "MFG_FILE_CHECKSUM_MISMATCH", message: "File bytes do not match the manifest record.", path: file.path });
    const text = new TextDecoder().decode(file.bytes);
    if (record.kind === "gerber") {
      const layer = input.mir.layers.find((candidate) => candidate.id === record.mirLayerId);
      if (!layer) {
        issues.push({ code: "MFG_GERBER_LAYER_MAPPING_INVALID", message: `Unknown MIR layer ${record.mirLayerId ?? "<missing>"}.`, path: file.path });
        continue;
      }
      const parsed = parseGerber(text);
      for (const diagnostic of verifyGerberLayer(layer, parsed, file.path).filter((item) => item.severity === "error")) {
        issues.push({ code: diagnostic.code, message: diagnostic.message, path: file.path });
      }
      expectedPrimitives += layer.primitives.length;
      parsedPrimitives += parsed.objects.length;
      gerber.push({ path: file.path, mirLayerId: layer.id, apertures: parsed.apertures.size, objects: parsed.objects.length, fileFunction: parsed.fileAttributes[".FileFunction"]?.join(",") });
    } else if (record.kind === "xnc") {
      const group = record.drillGroupId ? drillGroups.get(record.drillGroupId) : undefined;
      if (!group) {
        issues.push({ code: "MFG_DRILL_GROUP_MAPPING_INVALID", message: `Unknown drill group ${record.drillGroupId ?? "<missing>"}.`, path: file.path });
        continue;
      }
      const expectedRole = group.plated ? "pth_drill" : "npth_drill";
      if (record.role !== expectedRole) issues.push({ code: "MFG_DRILL_PLATING_MAPPING_INVALID", message: `Drill group plating requires ${expectedRole}, not ${record.role}.`, path: file.path });
      const parsed = parseXnc(text);
      for (const diagnostic of verifyXnc(group, parsed, file.path).filter((item) => item.severity === "error")) {
        issues.push({ code: diagnostic.code, message: diagnostic.message, path: file.path });
      }
      expectedDrills += group.drills.length;
      parsedDrills += parsed.objects.length;
      drills.push({ path: file.path, drillGroupId: group.id, tools: parsed.tools.size, hits: parsed.objects.length, fileFunction: parsed.fileFunction });
    }
  }
  if (expectedPrimitives !== parsedPrimitives) issues.push({ code: "MFG_PRIMITIVE_CONSERVATION_FAILED", message: `Expected ${expectedPrimitives} parsed Gerber primitives, received ${parsedPrimitives}.` });
  if (expectedDrills !== parsedDrills) issues.push({ code: "MFG_DRILL_CONSERVATION_FAILED", message: `Expected ${expectedDrills} drill objects, received ${parsedDrills}.` });
  const summary = {
    validatorId: MFG01_VALIDATOR_ID,
    gerber: gerber.sort((a, b) => a.path.localeCompare(b.path)),
    drills: drills.sort((a, b) => a.path.localeCompare(b.path)),
    expectedPrimitives,
    parsedPrimitives,
    expectedDrills,
    parsedDrills,
  };
  return { ...summary, valid: issues.length === 0, issues, readbackDigest: `mfg-readback-${sha256(stableJson(summary))}` };
}

export function validateReleaseFileSet(input: {
  files: NativeFabFile[];
  manifest: ManufacturingReleaseManifestV1;
  mir: ManufacturingIr;
}): ManufacturingReadbackResult {
  const result = validateFabricationFiles({ files: input.files, records: input.manifest.files, mir: input.mir });
  const issues = [...result.issues];
  if (!validateManifestContentDigest(input.manifest)) issues.push({ code: "MFG_MANIFEST_DIGEST_INVALID", message: "Manifest canonical content digest is invalid." });
  const expected = new Set(input.manifest.files.map((record) => record.path));
  for (const file of input.files) if (!expected.has(file.path)) issues.push({ code: "MFG_UNEXPECTED_FILE", message: "File is not declared by the manifest.", path: file.path });
  for (const absent of input.manifest.intentionallyAbsent) if (input.manifest.files.some((file) => file.role === absent.role)) issues.push({ code: "MFG_ABSENCE_CONTRADICTION", message: `${absent.role} is both present and intentionally absent.` });
  return { ...result, valid: issues.length === 0, issues };
}

export async function extractAndValidateReleaseArchive(bytes: Uint8Array): Promise<ExtractedReleaseArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch (error) {
    throw new Error(`MFG_ARCHIVE_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length === 0 || entries.length > MAX_FILES) throw new Error("MFG_ARCHIVE_FILE_COUNT_INVALID");
  const originalPaths = entries.map((entry) => (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name);
  const unsafe = pathIssues(originalPaths);
  if (unsafe.length) throw new Error(`${unsafe[0].code}: ${unsafe[0].message}`);
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  let total = 0;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const content = await entry.async("uint8array");
    total += content.byteLength;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error("MFG_ARCHIVE_UNCOMPRESSED_LIMIT_EXCEEDED");
    files.push({ path: entry.name, bytes: content });
  }
  const manifestFile = files.find((file) => file.path.endsWith("/release-manifest.json") || file.path === "release-manifest.json");
  if (!manifestFile) throw new Error("MFG_RELEASE_MANIFEST_MISSING");
  let manifest: ManufacturingReleaseManifestV1;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes)) as ManufacturingReleaseManifestV1;
  } catch {
    throw new Error("MFG_RELEASE_MANIFEST_INVALID_JSON");
  }
  if (manifest.schemaVersion !== "sirkit.pcb-manufacturing-release.v1" || !validateManifestContentDigest(manifest)) throw new Error("MFG_RELEASE_MANIFEST_INVALID");
  const expected = new Map(manifest.files.map((record) => [record.path, record]));
  for (const file of files) {
    if (file.path === manifestFile.path) continue;
    const record = expected.get(file.path);
    if (!record || record.bytes !== file.bytes.byteLength || record.sha256 !== sha256(file.bytes)) throw new Error(`MFG_ARCHIVE_CHECKSUM_MISMATCH:${file.path}`);
    expected.delete(file.path);
  }
  if (expected.size) throw new Error(`MFG_ARCHIVE_FILE_MISSING:${[...expected.keys()].sort()[0]}`);
  return { manifest, manifestPath: manifestFile.path, files };
}
