import { extractLibrary, fileTag } from "@/app/lib/kicad/extract";
import { findChild, getNumber, getString, parseSExp } from "@/app/lib/kicad/sexp";
import { parseKicadMod } from "@/app/lib/pcb/kicad-mod";
import { child, children, parseSexpr } from "@/app/lib/pcb/sexpr";
import type { SNode } from "@/app/lib/pcb/sexpr";
import type { PadShape } from "@/app/lib/pcb/geometry";
import type { AssetOrigin, FootprintAssetVersion, ModelAssetVersion, SymbolAssetVersion } from "./types";
import { assertBoundedSExpression, INGEST_LIMITS } from "./security";
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
  const parsed = Number(version);
  // Product scope: modern S-expression libraries (KiCad 6 through the KiCad
  // 10-era formats exercised by this repository). Newer versions quarantine
  // until the matrix and fixtures are updated.
  return Number.isInteger(parsed) && parsed >= 20210108 && parsed <= 20269999;
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
  const unsupportedSymbolFeatures = containsHead(lossless, new Set(["alternate", "swap_group", "pin_swap"]));
  const extendsByName = new Map<string, string>();
  for (const node of children(lossless, "symbol")) {
    const nameNode = node.items[1];
    const name = nameNode && nameNode.kind !== "list"
      ? (nameNode.kind === "number" ? nameNode.raw : nameNode.value)
      : undefined;
    const parent = atomValue(child(node, "extends"), 1);
    if (name && parent) extendsByName.set(name, parent);
  }
  return extractLibrary([input.source]).map((symbol) => {
    // Version the exact source library bytes. This is intentionally
    // conservative for inherited symbols: parent edits invalidate descendants.
    const contentHash = sha256(input.source);
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
      unitCount: Math.max(1, ...pins.map((pin) => pin.unit)),
      bodyStyles: [...new Set(pins.map((pin) => pin.bodyStyle))].sort((a, b) => a - b),
      pins,
      properties: symbol.properties,
      footprintFilters: (symbol.properties["ki_fp_filters"] ?? "").split(/\s+/).filter(Boolean),
      rawContentObjectId: contentId("raw", contentHash),
      validationState: supported && unsupportedSymbolFeatures.length === 0 ? "valid" as const : "unsupported" as const,
      diagnostics: [
        ...(!supported ? [{ severity: "error" as const, code: "unsupported_symbol_version", message: `Unsupported KiCad symbol format ${formatVersion}` }] : []),
        ...unsupportedSymbolFeatures.map((feature) => ({ severity: "error" as const, code: "unsupported_symbol_semantics", message: `Unsupported symbol semantic token retained verbatim: ${feature}` })),
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
      const xs = shape.points.map((point) => point.x);
      const ys = shape.points.map((point) => point.y);
      return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
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
  const formatVersion = atomValue(child(syntaxTree, "version"), 1) ?? "legacy";
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
  const unsupportedSemanticTokens = containsHead(syntaxTree, new Set(["zone", "keepout", "group", "net_tie_pad_groups"]));
  if (containsEmbeddedFontData(syntaxTree)) unsupportedSemanticTokens.push("embedded_fonts");
  const supported = formatVersion === "legacy" || supportedDateVersion(formatVersion);
  const diagnostics = [
    ...warnings.map((message) => ({ severity: "warning" as const, code: "kicad_footprint_limitation", message })),
    ...(!supported ? [{ severity: "error" as const, code: "unsupported_footprint_version", message: `Unsupported KiCad footprint format ${formatVersion}` }] : []),
    ...unsupportedSemanticTokens.map((feature) => ({ severity: "error" as const, code: "unsupported_footprint_semantics", message: `Unsupported footprint semantic token retained verbatim: ${feature}` })),
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
    modelReferences: footprint.models.map((model) => ({
      path: model.path,
      state: "missing" as const,
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
    validationState: !supported || unsupportedGeometry.length || unsupportedSemanticTokens.length ? "unsupported" : warnings.length ? "valid_with_limitations" : "valid",
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
