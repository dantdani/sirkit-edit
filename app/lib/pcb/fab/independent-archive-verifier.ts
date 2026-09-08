/**
 * B16.1C §E/§G — INDEPENDENT verification of a Sirkit verified-release ZIP.
 *
 * Deliberately shares no decision logic with the release generator
 * (`release-gate.ts`, the native Gerber/Excellon writers, or the internal
 * readback). It re-reads the archive with its own minimal RS-274X and
 * Excellon lexers, recomputes every digest with its own canonicalization, and
 * cross-checks the geometry against the manifest's declared board and counts.
 * If this reader and the generator's readback disagree, the archive is not
 * trustworthy — that disagreement is the point of having a second reader.
 *
 * Scope: structural and geometric truth of the FILES. This is not board-house
 * DFM, not electrical simulation, and not a certification of a physical board.
 */

import { createHash } from "node:crypto";
import JSZip from "jszip";
import { compareCodePoints } from "@/app/lib/stable-compare";

export interface ArchiveCheck { name: string; ok: boolean; detail: string }
export interface ArchiveVerification {
  ok: boolean;
  checks: ArchiveCheck[];
  summary: {
    members: string[];
    releaseId: string | null;
    manifestContentDigest: string | null;
    boardRevision: string | null;
    outlineBBoxNm: { minX: number; minY: number; maxX: number; maxY: number } | null;
    copperFlashes: Record<string, number>;
    copperDraws: Record<string, number>;
    drillHits: number;
    drillTools: Record<string, number>;
  };
}

interface ManifestFile { path: string; role: string; kind: string; bytes: number; sha256: string }
interface Manifest {
  schemaVersion: string;
  releaseId: string;
  manifestContentDigest: string;
  source: { boardRevision: string; boardDigest: string };
  board: { widthNm: number; heightNm: number; copperLayers: number };
  counts: { components: number; pads: number; nets: number; tracks: number; vias: number; platedHoles: number; nonPlatedHoles: number };
  manufacturingProfile: { limitsNm: { minDrill: number; minTraceWidth: number; minCopperToEdge: number } };
  files: ManifestFile[];
}

const ROLE_FUNCTION: Record<string, RegExp> = {
  copper_top: /^Copper,L1,Top$/, copper_bottom: /^Copper,L(\d+),Bot$/, mask_top: /^Soldermask,Top$/, mask_bottom: /^Soldermask,Bot$/,
  silk_top: /^Legend,Top$/, silk_bottom: /^Legend,Bot$/, outline: /^Profile,(NP|P)$/,
};
const ROLE_EXTENSION: Record<string, RegExp> = {
  copper_top: /\.GTL$/, copper_bottom: /\.GBL$/, mask_top: /\.GTS$/, mask_bottom: /\.GBS$/, silk_top: /\.GTO$/, silk_bottom: /\.GBO$/,
  outline: /\.(GML|GKO|GM1)$/, pth_drill: /\.(xnc|XNC|drl|DRL|txt|TXT)$/, npth_drill: /\.(xnc|XNC|drl|DRL|txt|TXT)$/, gerber_job: /\.gbrjob$/, readme: /\.txt$/i,
};

function sha256(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }

/** Independent canonical JSON: sorted keys, undefined dropped, -0 → 0 (the manifest's declared digest definition). */
function canonical(value: unknown): string {
  const norm = (item: unknown): unknown => Array.isArray(item) ? item.map(norm) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => compareCodePoints(a, b)).map(([k, v]) => [k, norm(v)])) : typeof item === "number" && Object.is(item, -0) ? 0 : item;
  return JSON.stringify(norm(value));
}

interface GerberScan {
  fileFunction: string | null; polarity: string | null; sameCoordinates: string | null; projectId: string | null;
  formatOk: boolean; unitsMm: boolean; terminated: boolean;
  apertures: Map<number, { shape: string; sizeNm: number }>; undefinedApertures: number[];
  flashes: Array<{ x: number; y: number; sizeNm: number }>; draws: Array<{ x1: number; y1: number; x2: number; y2: number; sizeNm: number }>;
  regionCount: number; firstMove: { x: number; y: number } | null; lastPoint: { x: number; y: number } | null;
}

/** Minimal RS-274X lexer: extended commands, aperture definitions, D01/D02/D03 with a current point. */
function scanGerber(text: string): GerberScan {
  const scan: GerberScan = { fileFunction: null, polarity: null, sameCoordinates: null, projectId: null, formatOk: false, unitsMm: false, terminated: false, apertures: new Map(), undefinedApertures: [], flashes: [], draws: [], regionCount: 0, firstMove: null, lastPoint: null };
  let current: number | null = null; let point: { x: number; y: number } | null = null; let inRegion = false;
  let pendingMacro: string | null = null;
  const macros = new Map<string, number>();
  // Tokenize: extended commands are `%…%` blocks (one or more `*`-terminated
  // statements inside); word commands are `*`-terminated outside any block.
  const commands: Array<{ extended: boolean; body: string }> = [];
  const lexer = /%([^%]*)%|([^*%]+)\*/g;
  for (let match = lexer.exec(text); match; match = lexer.exec(text)) {
    if (match[1] !== undefined) for (const statement of match[1].split("*")) { if (statement.trim()) commands.push({ extended: true, body: statement.trim() }); }
    else if (match[2] !== undefined && match[2].trim()) commands.push({ extended: false, body: match[2].trim() });
  }
  for (const token of commands) {
    const command = token.body;
    if (token.extended) {
      const body = command;
      const tf = /^TF\.([A-Za-z]+),(.*)$/.exec(body);
      if (tf) {
        if (tf[1] === "FileFunction") scan.fileFunction = tf[2]!;
        if (tf[1] === "FilePolarity") scan.polarity = tf[2]!;
        if (tf[1] === "SameCoordinates") scan.sameCoordinates = tf[2]!;
        if (tf[1] === "ProjectId") scan.projectId = tf[2]!;
        continue;
      }
      if (body === "FSLAX46Y46") { scan.formatOk = true; continue; }
      if (body === "MOMM") { scan.unitsMm = true; continue; }
      // Aperture macro: `AM<name>` followed by `*`-separated primitives (already
      // split by the lexer — the primitives arrive as the following statements).
      const am = /^AM([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(body);
      if (am) { pendingMacro = am[1]!; macros.set(pendingMacro, 0); continue; }
      if (pendingMacro && /^\d+,/.test(body)) {
        // Primitive extents (mm): code 21 = center line (w,h), code 1 = circle (d at x,y), code 4/5 = outline/polygon (diameter or vertices).
        const fields = body.split(",").map(Number);
        const code = fields[0];
        let extent = 0;
        if (code === 21) extent = Math.max(fields[2] ?? 0, fields[3] ?? 0) + 2 * Math.max(Math.abs(fields[4] ?? 0), Math.abs(fields[5] ?? 0));
        else if (code === 1) extent = (fields[2] ?? 0) + 2 * Math.max(Math.abs(fields[3] ?? 0), Math.abs(fields[4] ?? 0));
        else if (code === 5) extent = (fields[5] ?? 0) + 2 * Math.max(Math.abs(fields[3] ?? 0), Math.abs(fields[4] ?? 0));
        else if (code === 4) { const coords = fields.slice(3, 3 + 2 * (fields[2] ?? 0)); extent = 2 * Math.max(0, ...coords.map(Math.abs)); }
        macros.set(pendingMacro, Math.max(macros.get(pendingMacro) ?? 0, extent));
        continue;
      }
      pendingMacro = null;
      const ad = /^ADD(\d+)([A-Za-z_$][A-Za-z0-9_$]*)(?:,([\d.X-]+))?$/.exec(body);
      if (ad) {
        const name = ad[2]!;
        if (ad[3] !== undefined && /^[CROP]$/.test(name)) {
          const dims = ad[3].split("X").map(Number);
          // mm → nm; size = the largest dimension (conservative for the inside-board check).
          scan.apertures.set(Number(ad[1]), { shape: name, sizeNm: Math.round(Math.max(...dims) * 1_000_000) });
        } else if (macros.has(name)) {
          scan.apertures.set(Number(ad[1]), { shape: `macro:${name}`, sizeNm: Math.round((macros.get(name) ?? 0) * 1_000_000) });
        } else {
          scan.undefinedApertures.push(Number(ad[1]));
        }
        continue;
      }
      continue;
    }
    if (command === "G36") { inRegion = true; scan.regionCount += 1; continue; }
    if (command === "G37") { inRegion = false; continue; }
    if (command === "M02") { scan.terminated = true; continue; }
    const select = /^D(\d+)$/.exec(command);
    if (select) { current = Number(select[1]); if (current >= 10 && !scan.apertures.has(current)) scan.undefinedApertures.push(current); continue; }
    const op = /^(?:X(-?\d+))?(?:Y(-?\d+))?D0([123])$/.exec(command);
    if (op) {
      const x: number = op[1] !== undefined ? Number(op[1]) : (point?.x ?? 0);
      const y: number = op[2] !== undefined ? Number(op[2]) : (point?.y ?? 0);
      const sizeNm = current !== null ? scan.apertures.get(current)?.sizeNm ?? 0 : 0;
      if (op[3] === "2") { if (!scan.firstMove) scan.firstMove = { x, y }; }
      else if (op[3] === "1") { if (point && !inRegion) scan.draws.push({ x1: point.x, y1: point.y, x2: x, y2: y, sizeNm }); }
      else if (op[3] === "3") scan.flashes.push({ x, y, sizeNm });
      point = { x, y }; scan.lastPoint = point;
    }
  }
  return scan;
}

interface ExcellonScan { header: boolean; metric: boolean; terminated: boolean; tools: Map<number, number>; hits: Array<{ x: number; y: number; tool: number }>; undefinedTools: number[] }

/** Minimal Excellon/XNC lexer: header, metric, tool table, tool selection, hits, M30. */
function scanExcellon(text: string): ExcellonScan {
  const scan: ExcellonScan = { header: false, metric: false, terminated: false, tools: new Map(), hits: [], undefinedTools: [] };
  let inHeader = false; let tool: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    if (line === "M48") { scan.header = true; inHeader = true; continue; }
    if (line === "%" ) { inHeader = false; continue; }
    if (line === "METRIC" || line.startsWith("METRIC,")) { scan.metric = true; continue; }
    if (line === "M30") { scan.terminated = true; continue; }
    const def = /^T(\d+)C([\d.]+)$/.exec(line);
    if (def && inHeader) { scan.tools.set(Number(def[1]), Number(def[2])); continue; }
    const select = /^T(\d+)$/.exec(line);
    if (select) { tool = Number(select[1]); if (!scan.tools.has(tool)) scan.undefinedTools.push(tool); continue; }
    const hit = /^X(-?[\d.]+)Y(-?[\d.]+)$/.exec(line);
    if (hit && tool !== null) { scan.hits.push({ x: Number(hit[1]), y: Number(hit[2]), tool }); continue; }
  }
  return scan;
}

export async function verifyReleaseArchiveIndependently(bytes: Uint8Array, expectations: { archiveSha256?: string; boardRevision?: string; releaseId?: string; expectedComponents?: number } = {}): Promise<ArchiveVerification> {
  const checks: ArchiveCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };
  const summary: ArchiveVerification["summary"] = { members: [], releaseId: null, manifestContentDigest: null, boardRevision: null, outlineBBoxNm: null, copperFlashes: {}, copperDraws: {}, drillHits: 0, drillTools: {} };

  if (expectations.archiveSha256) check("archive sha256 matches the expected digest", sha256(bytes) === expectations.archiveSha256, sha256(bytes));
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch (error) { check("archive parses as ZIP", false, error instanceof Error ? error.message : String(error)); return { ok: false, checks, summary }; }
  const members = Object.values(zip.files).filter((file) => !file.dir);
  summary.members = members.map((file) => file.name).sort();
  check("archive parses as ZIP with members", members.length > 0, `${members.length} members`);
  check("every member is a plain file under gerber/ with a safe name", members.every((file) => /^gerber\/[A-Za-z0-9._-]+$/.test(file.name)), summary.members.join(", "));
  check("no duplicate member names", new Set(summary.members).size === summary.members.length, `${new Set(summary.members).size} unique`);
  check("every member timestamp is the fixed epoch (deterministic archive)", members.every((file) => file.date.getUTCFullYear() === 1980 && file.date.getUTCMonth() === 0 && file.date.getUTCDate() === 1), [...new Set(members.map((file) => file.date.toISOString()))].join(", "));

  const manifestMember = zip.file("gerber/release-manifest.json");
  if (!manifestMember) { check("manifest gerber/release-manifest.json present", false, "missing"); return { ok: false, checks, summary }; }
  let manifest: Manifest;
  try { manifest = JSON.parse(await manifestMember.async("string")) as Manifest; } catch (error) { check("manifest parses as JSON", false, error instanceof Error ? error.message : String(error)); return { ok: false, checks, summary }; }
  summary.releaseId = manifest.releaseId; summary.manifestContentDigest = manifest.manifestContentDigest; summary.boardRevision = manifest.source?.boardRevision ?? null;
  check("manifest schema is sirkit.pcb-manufacturing-release.v1", manifest.schemaVersion === "sirkit.pcb-manufacturing-release.v1", String(manifest.schemaVersion));
  const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "releaseId" && key !== "manifestContentDigest"));
  const recomputedDigest = `mfg-manifest-${sha256(canonical(content))}`;
  check("manifest content digest recomputes independently (sorted-key canonical JSON)", recomputedDigest === manifest.manifestContentDigest, recomputedDigest.slice(0, 32) + "…");
  const recomputedReleaseId = `mfg-release-${sha256(`${manifest.manifestContentDigest}\0${manifest.source.boardDigest}`).slice(0, 32)}`;
  check("release id recomputes from manifest digest + board digest", recomputedReleaseId === manifest.releaseId, manifest.releaseId);
  if (expectations.releaseId) check("release id matches the expected release", manifest.releaseId === expectations.releaseId, manifest.releaseId);
  if (expectations.boardRevision) check("manifest board revision matches the qualified board", manifest.source.boardRevision === expectations.boardRevision, manifest.source.boardRevision);
  if (expectations.expectedComponents !== undefined) check("manifest component count matches the design", manifest.counts.components === expectations.expectedComponents, String(manifest.counts.components));

  // Member ↔ manifest reconciliation with independently computed hashes.
  const declared = new Set(manifest.files.map((file) => file.path));
  check("member set equals manifest files plus the manifest itself (no extra, no missing)", JSON.stringify(summary.members) === JSON.stringify([...declared, "gerber/release-manifest.json"].sort()), `${declared.size} declared`);
  const contents = new Map<string, Uint8Array>();
  for (const file of manifest.files) {
    const member = zip.file(file.path);
    if (!member) { check(`member ${file.path} present`, false, "missing"); continue; }
    const data = await member.async("uint8array");
    contents.set(file.path, data);
    check(`${file.role}: bytes and sha256 match the manifest`, data.byteLength === file.bytes && sha256(data) === file.sha256, `${data.byteLength} bytes, ${sha256(data).slice(0, 16)}…`);
    const extension = ROLE_EXTENSION[file.role];
    if (extension) check(`${file.role}: filename uses the Protel-style extension`, extension.test(file.path), file.path.split("/").pop() ?? file.path);
  }
  for (const role of ["copper_top", "copper_bottom", "mask_top", "mask_bottom", "outline", "pth_drill", "gerber_job"]) check(`required role ${role} present`, manifest.files.some((file) => file.role === role), manifest.files.filter((file) => file.role === role).map((file) => file.path).join(", ") || "absent");

  // Gerber layers.
  const gerbers = manifest.files.filter((file) => file.kind === "gerber");
  const scans = new Map<string, GerberScan>();
  for (const file of gerbers) {
    const data = contents.get(file.path); if (!data) continue;
    const scan = scanGerber(new TextDecoder().decode(data));
    scans.set(file.role, scan);
    check(`${file.role}: RS-274X header (FSLAX46Y46, MOMM) and M02 terminator`, scan.formatOk && scan.unitsMm && scan.terminated, `format ${scan.formatOk}, mm ${scan.unitsMm}, M02 ${scan.terminated}`);
    const expectedFunction = ROLE_FUNCTION[file.role];
    if (expectedFunction) check(`${file.role}: TF.FileFunction matches the role`, Boolean(scan.fileFunction && expectedFunction.test(scan.fileFunction)), scan.fileFunction ?? "none");
    check(`${file.role}: file polarity declared`, scan.polarity === (file.role.startsWith("mask") ? "Negative" : "Positive"), scan.polarity ?? "none");
    check(`${file.role}: every selected aperture is defined`, scan.undefinedApertures.length === 0, scan.undefinedApertures.length ? `undefined D${scan.undefinedApertures.join(", D")}` : `${scan.apertures.size} apertures`);
  }
  const coordinateIds = new Set([...scans.values()].map((scan) => scan.sameCoordinates));
  check("all Gerber layers share one coordinate system id (TF.SameCoordinates)", coordinateIds.size === 1 && !coordinateIds.has(null), [...coordinateIds].join(", "));
  const projectIds = new Set([...scans.values()].map((scan) => scan.projectId));
  check("all Gerber layers share one project id (TF.ProjectId)", projectIds.size === 1 && !projectIds.has(null), [...projectIds].map((id) => id?.slice(0, 40)).join(", "));

  // Outline closure and declared board size.
  const outline = scans.get("outline");
  let bbox: ArchiveVerification["summary"]["outlineBBoxNm"] = null;
  if (outline) {
    const points = outline.draws.flatMap((draw) => [{ x: draw.x1, y: draw.y1 }, { x: draw.x2, y: draw.y2 }]);
    if (points.length) {
      bbox = { minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)) };
      summary.outlineBBoxNm = bbox;
    }
    check("outline is a closed polyline (returns to its first move)", Boolean(outline.firstMove && outline.lastPoint && outline.firstMove.x === outline.lastPoint.x && outline.firstMove.y === outline.lastPoint.y && outline.draws.length >= 4), `${outline.draws.length} segments`);
    check("outline bounding box equals the manifest board size", Boolean(bbox && bbox.maxX - bbox.minX === manifest.board.widthNm && bbox.maxY - bbox.minY === manifest.board.heightNm), bbox ? `${(bbox.maxX - bbox.minX) / 1e6} x ${(bbox.maxY - bbox.minY) / 1e6} mm vs manifest ${manifest.board.widthNm / 1e6} x ${manifest.board.heightNm / 1e6} mm` : "no outline geometry");
    check("outline has no flashes (profile only)", outline.flashes.length === 0, `${outline.flashes.length} flashes`);
  }

  // Copper: every pad flashes, every track draws, everything inside the outline.
  const inside = (x: number, y: number, halfNm: number): boolean => Boolean(bbox && x - halfNm >= bbox.minX && x + halfNm <= bbox.maxX && y - halfNm >= bbox.minY && y + halfNm <= bbox.maxY);
  let copperFlashes = 0, copperDraws = 0;
  for (const role of ["copper_top", "copper_bottom"]) {
    const scan = scans.get(role); if (!scan) continue;
    summary.copperFlashes[role] = scan.flashes.length; summary.copperDraws[role] = scan.draws.length;
    copperFlashes += scan.flashes.length; copperDraws += scan.draws.length;
    const outsideFlash = scan.flashes.filter((flash) => !inside(flash.x, flash.y, flash.sizeNm / 2)).length;
    const outsideDraw = scan.draws.filter((draw) => !inside(draw.x1, draw.y1, draw.sizeNm / 2) || !inside(draw.x2, draw.y2, draw.sizeNm / 2)).length;
    check(`${role}: all copper inside the outline (aperture extents included)`, outsideFlash === 0 && outsideDraw === 0, `${outsideFlash} flashes / ${outsideDraw} draws outside`);
    const thin = scan.draws.filter((draw) => draw.sizeNm > 0 && draw.sizeNm < manifest.manufacturingProfile.limitsNm.minTraceWidth).length;
    check(`${role}: no track narrower than the profile minimum trace width`, thin === 0, `${thin} thin draws (min ${manifest.manufacturingProfile.limitsNm.minTraceWidth / 1e6} mm)`);
  }
  check("copper flashes across both layers cover every pad at least once", copperFlashes >= manifest.counts.pads, `${copperFlashes} flashes for ${manifest.counts.pads} pads`);
  check("copper draws across both layers cover every track segment", copperDraws >= manifest.counts.tracks, `${copperDraws} draws for ${manifest.counts.tracks} tracks`);
  for (const role of ["mask_top", "mask_bottom"]) {
    const scan = scans.get(role), copper = scans.get(role === "mask_top" ? "copper_top" : "copper_bottom");
    if (!scan || !copper) continue;
    check(`${role}: mask openings exist and do not exceed same-side copper flashes`, scan.flashes.length + scan.regionCount > 0 && scan.flashes.length <= copper.flashes.length, `${scan.flashes.length} openings vs ${copper.flashes.length} copper flashes`);
  }

  // Drill.
  const drill = manifest.files.find((file) => file.role === "pth_drill");
  if (drill && contents.get(drill.path)) {
    const scan = scanExcellon(new TextDecoder().decode(contents.get(drill.path)!));
    summary.drillHits = scan.hits.length;
    for (const [tool, diameter] of scan.tools) summary.drillTools[`T${tool}`] = diameter;
    check("pth_drill: Excellon header (M48, METRIC) and M30 terminator", scan.header && scan.metric && scan.terminated, `header ${scan.header}, metric ${scan.metric}, M30 ${scan.terminated}`);
    check("pth_drill: every selected tool is defined", scan.undefinedTools.length === 0, scan.undefinedTools.length ? `undefined T${scan.undefinedTools.join(", T")}` : `${scan.tools.size} tools`);
    check("pth_drill: hit count equals the manifest plated-hole count", scan.hits.length === manifest.counts.platedHoles, `${scan.hits.length} hits vs ${manifest.counts.platedHoles} plated holes`);
    const minDrillMm = manifest.manufacturingProfile.limitsNm.minDrill / 1e6;
    check("pth_drill: every tool diameter within the profile drill range", [...scan.tools.values()].every((diameter) => diameter >= minDrillMm && diameter <= 6.3), [...scan.tools.values()].map((d) => `${d} mm`).join(", ") || "no tools");
    const outsideHits = scan.hits.filter((hit) => !inside(Math.round(hit.x * 1e6), Math.round(hit.y * 1e6), Math.round(((scan.tools.get(hit.tool) ?? 0) * 1e6) / 2))).length;
    check("pth_drill: every hole inside the outline", outsideHits === 0, `${outsideHits} outside`);
    const bottom = scans.get("copper_bottom");
    if (bottom) check("pth_drill: every plated hole has a bottom-copper flash at the same position", scan.hits.every((hit) => bottom.flashes.some((flash) => Math.abs(flash.x - Math.round(hit.x * 1e6)) <= 1000 && Math.abs(flash.y - Math.round(hit.y * 1e6)) <= 1000)), `${scan.hits.length} holes checked`);
  }

  // Gerber job file.
  const job = manifest.files.find((file) => file.role === "gerber_job");
  if (job && contents.get(job.path)) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(contents.get(job.path)!)) as { GeneralSpecs?: { LayerNumber?: number }; FilesAttributes?: Array<{ Path?: string }> };
      const listed = (parsed.FilesAttributes ?? []).map((item) => item.Path).filter((path): path is string => typeof path === "string").sort();
      // The job file describes every image/drill member that ships (Gerber layers + XNC drills) — nothing more, nothing less.
      const basenames = manifest.files.filter((file) => file.kind === "gerber" || file.kind === "xnc").map((file) => file.path.split("/").pop()!).sort();
      check("gerber_job: FilesAttributes list exactly the shipped Gerber/drill members", JSON.stringify(listed) === JSON.stringify(basenames), listed.join(", "));
      check("gerber_job: two copper layers declared", parsed.GeneralSpecs?.LayerNumber === 2 && manifest.board.copperLayers === 2, String(parsed.GeneralSpecs?.LayerNumber));
    } catch (error) { check("gerber_job parses as JSON", false, error instanceof Error ? error.message : String(error)); }
  }

  return { ok: checks.every((item) => item.ok), checks, summary };
}
