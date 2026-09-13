import { EXTENDS_MAX_DEPTH, extractLibrary, fileTag } from "@/app/lib/kicad/extract";
import { findChild, getNumber, getString, parseSExp } from "@/app/lib/kicad/sexp";
import { parseKicadMod } from "@/app/lib/pcb/kicad-mod";
import { child, children, parseSexpr } from "@/app/lib/pcb/sexpr";
import type { SNode } from "@/app/lib/pcb/sexpr";
import type { PadShape } from "@/app/lib/pcb/geometry";
import type { AssetOrigin, FootprintAssetVersion, ModelAssetVersion, SymbolAssetVersion } from "./types";
import { assertBoundedSExpression, IngestSecurityError, INGEST_LIMITS, modelReferencePathIssue } from "./security";
import { contentId, semanticHash, sha256 } from "./stable";

export const KICAD_ASSET_PARSER_VERSION = "sirkit.kicad-assets/1";

function assetVersionId(kind: "symbolv" | "footprintv" | "modelv", contentHash: string, origin: AssetOrigin): string {
  // Exact version identity includes the immutable bytes and their independent
  // source/license binding. `contentHash` still exposes byte deduplication.
  return contentId(kind, semanticHash({ contentHash, sourceRecordId: origin.sourceRecordId, licenseId: origin.licenseId, libraryNickname: origin.libraryNickname, logicalName: origin.logicalName }));
}

function atomValue(node: ReturnType<typeof child> | undefined, index: number): string | undefined {
  const item = node?.items[index];
  if (!item || item.kind === "list") return undefined;
  return item.kind === "number" ? item.raw : item.value;
}

function supportedDateVersion(version: string): boolean {
  // Product scope: modern S-expression libraries (KiCad 6 through the KiCad
  // 10-era formats exercised by this repository). Newer versions quarantine
  // until the matrix and fixtures are updated.
  // [B19-D I5d row 48] a KiCad format version is a real calendar date (YYYYMMDD); `20261399` is not a format, it is noise.
  if (!/^\d{8}$/.test(version)) return false;
  const year = Number(version.slice(0, 4));
  const month = Number(version.slice(4, 6));
  const day = Number(version.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  const isCalendarDate = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isCalendarDate && Number(version) >= 20210108 && year <= 2026;
}

function containsHead(node: SNode, names: ReadonlySet<string>): string[] {
  if (node.kind !== "list") return [];
  const found = new Set<string>();
  const head = node.items[0];
  if (head?.kind === "symbol" && names.has(head.value)) found.add(head.value);
  for (const childNode of node.items) for (const name of containsHead(childNode, names)) found.add(name);
  return [...found].sort();
}

/** True only for `(embedded_fonts ...)` nodes that are not the benign `no` flag. */
function containsEmbeddedFontData(node: SNode): boolean {
  if (node.kind !== "list") return false;
  const head = node.items[0];
  if (head?.kind === "symbol" && head.value === "embedded_fonts") {
    const value = node.items[1];
    const flag = value && value.kind !== "list" ? (value.kind === "number" ? value.raw : value.value) : undefined;
    if (flag !== "no") return true;
  }
  return node.items.some((childNode) => containsEmbeddedFontData(childNode));
}

export function parseSymbolAssets(input: {
  source: string;
  origin: Omit<AssetOrigin, "logicalName">;
}): SymbolAssetVersion[] {
  assertBoundedSExpression(input.source);
  const parsed = parseSExp(input.source);
  if (fileTag(parsed) !== "kicad_symbol_lib") throw new Error("Not a KiCad symbol library");
  if (!Array.isArray(parsed)) throw new Error("Invalid symbol library root");
  const formatVersion = String(getNumber(findChild(parsed, "version")?.[1]) ?? "unknown");
  const generator = getString(findChild(parsed, "generator")?.[1]) ?? undefined;
  const supported = supportedDateVersion(formatVersion);
  const lossless = parseSexpr(input.source);
  // [B19-D I5d row 48] an embedded payload (files, or font data other than the `no` flag) is content no reviewer has seen
  const unsupportedSymbolFeatures = containsHead(lossless, new Set(["alternate", "swap_group", "pin_swap", "embedded_files"]));
  if (containsEmbeddedFontData(lossless)) unsupportedSymbolFeatures.push("embedded_fonts");
  unsupportedSymbolFeatures.sort();
  const extendsByName = new Map<string, string>();
  for (const node of children(lossless, "symbol")) {
    const nameNode = node.items[1];
    const name = nameNode && nameNode.kind !== "list"
      ? (nameNode.kind === "number" ? nameNode.raw : nameNode.value)
      : undefined;
    const parent = atomValue(child(node, "extends"), 1);
    if (name && parent) extendsByName.set(name, parent);
  }
  const symbols = extractLibrary([input.source]);
  // [B19-D I5d rows 37, 44, 45] resource refusals come before any per-pin work: an inheritance chain beyond the bound, a
  // symbol with more pins than any real part, or `extends` children multiplying one large parent's pins
  let expandedPins = 0;
  for (const symbol of symbols) {
    if (symbol.issues.some((issue) => issue.code === "extends_depth")) {
      throw new IngestSecurityError("extends_depth", `A symbol's extends chain is deeper than ${EXTENDS_MAX_DEPTH} levels`);
    }
    if (symbol.pins.length > INGEST_LIMITS.maxSymbolPins) {
      throw new IngestSecurityError("too_many_pins", `A symbol has more than ${INGEST_LIMITS.maxSymbolPins} pins`);
    }
    expandedPins += symbol.pins.length;
    if (expandedPins > INGEST_LIMITS.maxExpandedSymbolPins) {
      throw new IngestSecurityError("expanded_pin_budget", `The library expands to more than ${INGEST_LIMITS.maxExpandedSymbolPins} pins after inheritance`);
    }
  }
  // Version the exact source library bytes. This is intentionally
  // conservative for inherited symbols: parent edits invalidate descendants.
  const contentHash = sha256(input.source); // [B19-D I5d row 44] once per library, not once per symbol
  return symbols.map((symbol) => {
    const origin: AssetOrigin = { ...input.origin, logicalName: symbol.name };
    const pins = symbol.pins.map((pin, index) => ({
      id: `spin_${semanticHash({ number: pin.number, unit: pin.unit ?? 1, body: pin.bodyStyle ?? 1, index }).slice(0, 32)}`,
      number: pin.number,
      name: pin.name,
      electricalType: pin.type,
      unit: pin.unit ?? 1,
      bodyStyle: pin.bodyStyle ?? 1,
      hidden: pin.hidden ?? false,
      stacked: pin.stacked ?? false,
      position: pin.position,
      orientation: pin.orientation,
      length: pin.length,
    }));
    const semantic = {
      symbolName: symbol.name,
      extends: extendsByName.get(symbol.name) ?? undefined,
      pins,
      properties: symbol.properties,
      formatVersion,
      generator,
    };
    const assetSemanticHash = semanticHash(semantic);
    return {
      kind: "symbol" as const,
      logicalAssetId: `symbol_${semanticHash({ source: origin.sourceRecordId, nickname: origin.libraryNickname, name: symbol.name }).slice(0, 32)}`,
      versionId: assetVersionId("symbolv", contentHash, origin),
      contentHash,
      semanticHash: assetSemanticHash,
      origin,
      formatVersion,
      generator,
      symbolName: symbol.name,
      extends: extendsByName.get(symbol.name) ?? undefined,
      aliases: [],
      unitCount: pins.reduce((most, pin) => Math.max(most, pin.unit), 1), // [B19-D I5d row 37] no argument spread
      bodyStyles: [...new Set(pins.map((pin) => pin.bodyStyle))].sort((a, b) => a - b),
      pins,
      properties: symbol.properties,
      footprintFilters: (symbol.properties["ki_fp_filters"] ?? "").split(/\s+/).filter(Boolean),
      rawContentObjectId: contentId("raw", contentHash),
      // [B19-D I5d rows 08, 45] a duplicate name, a cyclic or dangling extends, or a missing definition block is not a
      // trustworthy definition: retained for review, never valid
      validationState: supported && unsupportedSymbolFeatures.length === 0 && symbol.issues.length === 0 ? "valid" as const : "unsupported" as const,
      diagnostics: [
        ...(!supported ? [{ severity: "error" as const, code: "unsupported_symbol_version", message: `Unsupported KiCad symbol format ${formatVersion}` }] : []),
        ...unsupportedSymbolFeatures.map((feature) => ({ severity: "error" as const, code: "unsupported_symbol_semantics", message: `Unsupported symbol semantic token retained verbatim: ${feature}` })),
        ...symbol.issues.map((issue) => ({ severity: "error" as const, code: issue.code, message: issue.message })),
      ],
      rawSymbolSExpression: symbol.symbolRaw,
    };
  });
}

function shapeDimensions(shape: PadShape): { width: number; height: number } {
  switch (shape.kind) {
    case "circle": return { width: shape.radius * 2, height: shape.radius * 2 };
    case "rect":
    case "roundrect":
    case "oval": return { width: shape.width, height: shape.height };
    case "polygon": {
      if (!shape.points.length) return { width: 0, height: 0 };
      // [B19-D I5d row 37] a fold, not an argument spread: a large polygon must not throw a RangeError
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const point of shape.points) {
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
      return { width: maxX - minX, height: maxY - minY };
    }
  }
}

export function parseFootprintAsset(input: {
  source: string;
  libraryNickname: string;
  origin: Omit<AssetOrigin, "logicalName">;
}): FootprintAssetVersion {
  assertBoundedSExpression(input.source);
  const syntaxTree = parseSexpr(input.source);
  // [B19-D I5d row 37] the pad count is policy, checked before the footprint parser does per-pad work
  if (children(syntaxTree, "pad").length > INGEST_LIMITS.maxFootprintPads) {
    throw new IngestSecurityError("too_many_pads", `A footprint has more than ${INGEST_LIMITS.maxFootprintPads} pads`);
  }
  const rootHead = syntaxTree.items[0]?.kind === "symbol" ? syntaxTree.items[0].value : undefined;
  const declaredVersion = atomValue(child(syntaxTree, "version"), 1);
  const formatVersion = declaredVersion ?? "legacy";
  const generator = atomValue(child(syntaxTree, "generator"), 1);
  const warnings: string[] = [];
  const footprint = parseKicadMod(input.source, input.libraryNickname, warnings);
  const contentHash = sha256(input.source);
  const origin: AssetOrigin = { ...input.origin, logicalName: footprint.name };
  const pads = footprint.pads.map((pad, index) => {
    const size = shapeDimensions(pad.shape);
    return {
      id: `pad_${semanticHash({ version: contentHash, index, number: pad.number, at: pad.at }).slice(0, 32)}`,
      number: pad.number,
      padType: pad.type,
      shape: pad.shape.kind,
      xNm: pad.at.x,
      yNm: pad.at.y,
      rotationDeg: pad.rotationDeg,
      widthNm: size.width,
      heightNm: size.height,
      drillNm: pad.drill?.diameter,
      plated: pad.plated,
      solderMaskMarginNm: pad.solderMaskMarginNm,
      solderPasteMarginNm: pad.solderPasteMarginNm,
      solderPasteMarginRatio: pad.solderPasteMarginRatio,
      layers: [...pad.layers],
      mechanical: pad.number === "" || pad.type === "np_thru_hole",
    };
  });
  const unsupportedGeometry = warnings.filter((warning) => /approximated|unknown pad shape|dropped|unmapped layer/i.test(warning));
  // `(embedded_fonts no)` is a KiCad 9+ presentational flag present in every
  // current-format file and carries no pad/copper/courtyard semantics — only an
  // actual embedded font payload (`embedded_fonts yes`) is unsupported.
  // [B19-D I5d row 48] embedded files are a payload no reviewer has seen
  const unsupportedSemanticTokens = containsHead(syntaxTree, new Set(["zone", "keepout", "group", "net_tie_pad_groups", "embedded_files"]));
  if (containsEmbeddedFontData(syntaxTree)) unsupportedSemanticTokens.push("embedded_fonts");
  // [B19-D I5d row 48] only the legacy `module` root is versionless; a `footprint` root always carries its format date
  const supported = declaredVersion === undefined ? rootHead === "module" : supportedDateVersion(declaredVersion);
  // [B19-D I5d row 48] a model reference names one KiCad model directory and a model file inside it — nothing else
  const modelPathIssues = footprint.models.map((model) => modelReferencePathIssue(model.path));
  const diagnostics = [
    ...warnings.map((message) => ({ severity: "warning" as const, code: "kicad_footprint_limitation", message })),
    ...(!supported ? [{ severity: "error" as const, code: "unsupported_footprint_version", message: declaredVersion === undefined ? "KiCad footprint declares no format version" : `Unsupported KiCad footprint format ${formatVersion}` }] : []),
    ...unsupportedSemanticTokens.map((feature) => ({ severity: "error" as const, code: "unsupported_footprint_semantics", message: `Unsupported footprint semantic token retained verbatim: ${feature}` })),
    ...modelPathIssues.flatMap((issue) => issue ? [{ severity: "error" as const, code: "model_path_rejected", message: `3D model reference refused (${issue})` }] : []),
  ];
  const semantic = {
    footprintName: footprint.name,
    attributes: footprint.attributes,
    pads,
    graphics: footprint.graphics,
    models: footprint.models,
  };
  return {
    kind: "footprint",
    logicalAssetId: `footprint_${semanticHash({ source: origin.sourceRecordId, nickname: origin.libraryNickname, name: footprint.name }).slice(0, 32)}`,
    versionId: assetVersionId("footprintv", contentHash, origin),
    contentHash,
    semanticHash: semanticHash(semantic),
    origin,
    formatVersion,
    generator,
    footprintName: footprint.name,
    mountingTechnology: footprint.attributes.smd && footprint.attributes.throughHole
      ? "mixed"
      : footprint.attributes.smd ? "smd" : footprint.attributes.throughHole ? "through_hole" : "unknown",
    pads,
    modelReferences: footprint.models.map((model, index) => ({
      path: model.path,
      state: modelPathIssues[index] ? "blocked" as const : "missing" as const,
      offset: model.offset ?? [0, 0, 0],
      rotation: model.rotate ?? [0, 0, 0],
      scale: model.scale ?? [1, 1, 1],
    })),
    geometrySummary: {
      bodyWidthNm: footprint.bodyBBox.maxX - footprint.bodyBBox.minX,
      bodyLengthNm: footprint.bodyBBox.maxY - footprint.bodyBBox.minY,
      courtyardWidthNm: footprint.courtyardBBox ? footprint.courtyardBBox.maxX - footprint.courtyardBBox.minX : undefined,
      courtyardLengthNm: footprint.courtyardBBox ? footprint.courtyardBBox.maxY - footprint.courtyardBBox.minY : undefined,
      hasFab: footprint.graphics.some((graphic) => graphic.layer === "fabTop" || graphic.layer === "fabBottom"),
      hasSilk: footprint.graphics.some((graphic) => graphic.layer === "silkTop" || graphic.layer === "silkBottom"),
      unsupportedGeometry,
    },
    rawContentObjectId: contentId("raw", contentHash),
    // Any approximation is retained for display but cannot become trusted
    // geometry or pass PCB approval.
    validationState: !supported || unsupportedGeometry.length || unsupportedSemanticTokens.length || modelPathIssues.some(Boolean) ? "unsupported" : warnings.length ? "valid_with_limitations" : "valid",
    diagnostics,
  };
}

export function createModelAsset(input: {
  bytes: Uint8Array;
  origin: AssetOrigin;
  mediaType: "model/step" | "model/vrml";
  units?: string;
  coordinateConvention?: string;
  inspected: boolean;
  diagnostics?: string[];
}): ModelAssetVersion {
  if (input.bytes.byteLength > INGEST_LIMITS.maxModelBytes) throw new Error(`3D model exceeds ${INGEST_LIMITS.maxModelBytes} bytes`);
  const contentHash = sha256(input.bytes);
  return {
    kind: "model",
    logicalAssetId: `model_${semanticHash({ source: input.origin.sourceRecordId, name: input.origin.logicalName }).slice(0, 32)}`,
    versionId: assetVersionId("modelv", contentHash, input.origin),
    contentHash,
    origin: input.origin,
    mediaType: input.mediaType,
    coordinateConvention: input.coordinateConvention ?? null,
    units: input.units ?? null,
    inspectionState: input.inspected ? "safe" : "not_inspected",
    rawContentObjectId: contentId("raw", contentHash),
    diagnostics: (input.diagnostics ?? []).map((message) => ({ severity: "warning", code: "model_inspection", message })),
  };
}

export function rawContentObject(input: {
  content: string;
  mediaType: string;
  encoding?: "utf8" | "base64";
  licenseId: string;
  confidential?: boolean;
}) {
  const encoding = input.encoding ?? "utf8";
  const bytes = encoding === "base64" ? Buffer.from(input.content, "base64").byteLength : Buffer.byteLength(input.content, "utf8");
  const contentHash = sha256(encoding === "base64" ? Buffer.from(input.content, "base64") : input.content);
  return {
    id: contentId("raw", contentHash),
    contentHash,
    mediaType: input.mediaType,
    encoding,
    content: input.content,
    bytes,
    licenseId: input.licenseId,
    confidential: input.confidential ?? false,
  } as const;
}
