import { atomValue, findChildList, parseSafeSExpression } from "./safe-sexpression";
import type { SchematicCompilerCapabilityProfile } from "./types";

export interface KiCadInspection {
  format: "kicad_sch" | "unknown";
  declaredVersion?: string;
  generator?: string;
  parserState: "parsed" | "invalid" | "resource_limit";
  semanticAdapterState: "supported" | "unsupported_version" | "not_implemented" | "invalid";
  diagnostics: string[];
}

/** Quarantine boundary only: parsing syntax does not claim semantic import support. */
export function inspectKiCadSchematic(source: string, profile: SchematicCompilerCapabilityProfile): KiCadInspection {
  try {
    const root = parseSafeSExpression(source, { maximumBytes: profile.limits.maximumSExpressionBytes, maximumDepth: profile.limits.maximumSExpressionDepth, maximumTokens: profile.limits.maximumSExpressionTokens });
    const format = atomValue(root.kind === "list" ? root.children[0] : undefined);
    if (format !== "kicad_sch") return { format: "unknown", parserState: "invalid", semanticAdapterState: "invalid", diagnostics: ["CD8_KICAD_ROOT_INVALID"] };
    const versionNode = findChildList(root, "version"), generatorNode = findChildList(root, "generator"), declaredVersion = versionNode?.kind === "list" ? atomValue(versionNode.children[1]) : undefined, generator = generatorNode?.kind === "list" ? atomValue(generatorNode.children[1]) : undefined;
    if (!declaredVersion) return { format: "kicad_sch", generator, parserState: "invalid", semanticAdapterState: "invalid", diagnostics: ["CD8_KICAD_VERSION_MISSING"] };
    if (!profile.supportedKiCadVersions.includes(declaredVersion)) return { format: "kicad_sch", declaredVersion, generator, parserState: "parsed", semanticAdapterState: "unsupported_version", diagnostics: ["CD8_KICAD_VERSION_UNSUPPORTED"] };
    return { format: "kicad_sch", declaredVersion, generator, parserState: "parsed", semanticAdapterState: "not_implemented", diagnostics: ["CD8_KICAD_SEMANTIC_ADAPTER_NOT_CERTIFIED"] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error), resource = message.includes("LIMIT");
    return { format: "unknown", parserState: resource ? "resource_limit" : "invalid", semanticAdapterState: "invalid", diagnostics: [message] };
  }
}
