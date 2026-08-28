/**
 * B11.4 §F — the PCB shape descriptor builder, as an importable PURE function.
 *
 * B11.3's drift proof executed the CLI and, to make a reachable PCB type
 * change, wrote real files: it created `app/lib/pcb/__b113probe__.types.ts` and
 * (in the byte-comparison half) rewrote the checked-in descriptor. Both are
 * repository paths, so an interrupted run could leave the tree modified —
 * which is exactly what happened during B11.3 (see B11.4 R7).
 *
 * This module removes the need for either. `buildPcbShapeDescriptor` accepts an
 * IN-MEMORY SOURCE OVERLAY and a virtual `ts.CompilerHost`, so a drift proof
 * can mutate a reachable type without a single byte reaching disk. The CLI in
 * `generate-pcb-shape-descriptor.ts` is a thin wrapper around this.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

export const DESCRIPTOR_VERSION = "sirkit.pcb-shape-descriptor.v1";
export const DEFAULT_ENTRY = "app/lib/pcb/types.ts";
export const DEFAULT_ENTRY_TYPE = "PcbBoard";
export const DESCRIPTOR_OUT = join("app", "lib", "agent", "generated", "pcb-shape-descriptor.ts");

// ─── Descriptor IR ───────────────────────────────────────────────────────────

export type ShapeNode =
  | { k: "string" }
  | { k: "number" }
  | { k: "boolean" }
  | { k: "null" }
  | { k: "literal"; v: string | number | boolean }
  | { k: "array"; item: ShapeNode }
  | { k: "tuple"; items: ShapeNode[] }
  | { k: "object"; props: Array<{ name: string; optional: boolean; type: ShapeNode }>; index: { key: "string" | "number"; of: ShapeNode } | null }
  | { k: "union"; discriminant: string | null; variants: ShapeNode[] }
  | { k: "ref"; id: string };

export interface Descriptor {
  schema: typeof DESCRIPTOR_VERSION;
  root: string;
  nodes: Record<string, ShapeNode>;
  sources: string[];
}

export class GenerationFailure extends Error {
  constructor(readonly path: string, readonly detail: string) {
    super(`UNSUPPORTED_SHAPE at ${path}: ${detail}`);
    this.name = "GenerationFailure";
  }
}

export interface BuildOptions {
  /** Repo root. Defaults to `process.cwd()`. */
  root?: string;
  /** Repo-relative entry file. Defaults to `app/lib/pcb/types.ts`. */
  entry?: string;
  /**
   * IN-MEMORY source overlay: repo-relative path → file text. Overlaid files
   * are never read from disk and are never written. This is how the drift
   * proof mutates a reachable PCB type without touching the repository.
   */
  overlay?: Readonly<Record<string, string>>;
}

export interface BuildResult {
  content: string;
  descriptor: Descriptor;
  sourceDigest: string;
  graphDigest: string;
  summary: string;
}

// ─── Program, with an optional in-memory overlay ─────────────────────────────

function normalizePath(root: string, absolute: string): string {
  return relative(root, resolve(absolute)).split("\\").join("/");
}

function createProgram(root: string, entryFile: string, overlay: Readonly<Record<string, string>>): { program: ts.Program; checker: ts.TypeChecker } {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, skipLibCheck: true };

  const overlayKeys = Object.keys(overlay);
  const host = ts.createCompilerHost(options, true);
  if (overlayKeys.length > 0) {
    const overlaid = new Map<string, string>();
    for (const key of overlayKeys) overlaid.set(resolve(root, key).split("\\").join("/"), overlay[key]!);
    const lookup = (fileName: string): string | undefined => overlaid.get(resolve(fileName).split("\\").join("/"));
    const baseGetSourceFile = host.getSourceFile.bind(host);
    const baseReadFile = host.readFile.bind(host);
    const baseFileExists = host.fileExists.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      const text = lookup(fileName);
      if (text !== undefined) return ts.createSourceFile(fileName, text, languageVersion, true);
      return baseGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    };
    host.readFile = (fileName) => lookup(fileName) ?? baseReadFile(fileName);
    host.fileExists = (fileName) => lookup(fileName) !== undefined || baseFileExists(fileName);
    // The overlay is READ-ONLY by construction: `writeFile` is disabled so an
    // overlaid build can never emit anything, anywhere.
    host.writeFile = () => { throw new Error("the descriptor builder never emits files"); };
  }

  const program = ts.createProgram({ rootNames: [join(root, entryFile)], options, host });
  return { program, checker: program.getTypeChecker() };
}

function findEntryType(program: ts.Program, checker: ts.TypeChecker, entryFile: string, entryType: string): ts.Type {
  const source = program.getSourceFile(entryFile);
  if (!source) throw new Error(`entry file not in program: ${entryFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
  const symbol = exports.find((candidate) => candidate.getName() === entryType);
  if (!symbol) throw new Error(`${entryType} is not exported from ${entryFile}`);
  return checker.getDeclaredTypeOfSymbol(symbol);
}

// ─── Walker ──────────────────────────────────────────────────────────────────

class ShapeWalker {
  private readonly nodes = new Map<string, ShapeNode>();
  private readonly inProgress = new Set<string>();
  private readonly sources = new Set<string>();

  constructor(private readonly checker: ts.TypeChecker, private readonly root: string) {}

  /** Stable identity for a NAMED type: `<repo-relative file>#<name>`. */
  private namedId(type: ts.Type): string | null {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    if (!symbol) return null;
    const name = symbol.getName();
    if (!name || name === "__type" || name === "__object") return null;
    const declaration = symbol.declarations?.[0];
    if (!declaration) return null;
    const file = declaration.getSourceFile();
    if (file.isDeclarationFile) return null; // lib.d.ts / node_modules → not a local named type
    const path = normalizePath(this.root, file.fileName);
    if (!ts.isInterfaceDeclaration(declaration) && !ts.isTypeAliasDeclaration(declaration)) return null;
    // [B11.3] FAIL CLOSED on a local GENERIC named type: the node id carries no
    // type arguments, so two instantiations would collapse onto one node.
    if ((declaration.typeParameters?.length ?? 0) > 0) {
      throw new GenerationFailure(
        `${path}#${name}`,
        "local GENERIC types are not supported: the node id carries no type arguments, so two instantiations would collapse onto one descriptor node. Either make the type non-generic or extend the id scheme to include type arguments.",
      );
    }
    this.sources.add(path);
    return `${path}#${name}`;
  }

  walk(type: ts.Type, path: string, depth = 0): ShapeNode {
    if (depth > 60) throw new GenerationFailure(path, "type nesting exceeded the generator depth limit");
    const id = this.namedId(type);
    if (id !== null) {
      if (this.nodes.has(id) || this.inProgress.has(id)) return { k: "ref", id };
      this.inProgress.add(id);
      const node = this.describe(type, path, depth);
      this.inProgress.delete(id);
      this.nodes.set(id, node);
      return { k: "ref", id };
    }
    return this.describe(type, path, depth);
  }

  private describe(type: ts.Type, path: string, depth: number): ShapeNode {
    const { checker } = this;
    const flags = type.flags;

    if (flags & ts.TypeFlags.Any) throw new GenerationFailure(path, "`any` is not a validatable shape");
    if (flags & ts.TypeFlags.Unknown) throw new GenerationFailure(path, "`unknown` is not a validatable shape");
    if (flags & ts.TypeFlags.Never) throw new GenerationFailure(path, "`never` is not inhabitable");
    if (flags & ts.TypeFlags.ESSymbolLike) throw new GenerationFailure(path, "symbols are not JSON data");
    if (flags & ts.TypeFlags.BigIntLike) throw new GenerationFailure(path, "bigint is not JSON data");
    if (flags & ts.TypeFlags.Void) throw new GenerationFailure(path, "`void` is not JSON data");

    if (flags & ts.TypeFlags.StringLiteral) return { k: "literal", v: (type as ts.StringLiteralType).value };
    if (flags & ts.TypeFlags.NumberLiteral) return { k: "literal", v: (type as ts.NumberLiteralType).value };
    if (flags & ts.TypeFlags.BooleanLiteral) return { k: "literal", v: checker.typeToString(type) === "true" };
    if (flags & ts.TypeFlags.String) return { k: "string" };
    if (flags & ts.TypeFlags.Number) return { k: "number" };
    if (flags & ts.TypeFlags.Boolean) return { k: "union", discriminant: null, variants: [{ k: "literal", v: true }, { k: "literal", v: false }] };
    if (flags & ts.TypeFlags.Null) return { k: "null" };

    if (type.isUnion()) return this.describeUnion(type, path, depth);
    if (type.isIntersection()) throw new GenerationFailure(path, "intersection types are not supported by the generator (no precise adapter exists)");

    if (checker.isTupleType(type)) {
      const reference = type as ts.TupleTypeReference;
      const target = reference.target;
      if (target.hasRestElement) throw new GenerationFailure(path, "rest elements in tuples are not supported");
      if (target.minLength !== target.fixedLength) throw new GenerationFailure(path, "optional tuple elements are not supported");
      const elements = checker.getTypeArguments(reference);
      return { k: "tuple", items: elements.map((element, index) => this.walk(element, `${path}[${index}]`, depth + 1)) };
    }
    if (checker.isArrayType(type)) {
      const [element] = checker.getTypeArguments(type as ts.TypeReference);
      if (!element) throw new GenerationFailure(path, "array element type could not be resolved");
      return { k: "array", item: this.walk(element, `${path}[]`, depth + 1) };
    }

    if (flags & ts.TypeFlags.Object) {
      if (type.getCallSignatures().length > 0) throw new GenerationFailure(path, "function types are not JSON data");
      if (type.getConstructSignatures().length > 0) throw new GenerationFailure(path, "class/constructor types are not JSON data");
      const symbol = type.getSymbol();
      const declaration = symbol?.declarations?.[0];
      if (declaration && (ts.isClassDeclaration(declaration) || ts.isEnumDeclaration(declaration))) {
        throw new GenerationFailure(path, "class and enum types are not JSON data");
      }

      const stringIndex = checker.getIndexInfoOfType(type, ts.IndexKind.String);
      const numberIndex = checker.getIndexInfoOfType(type, ts.IndexKind.Number);
      if (numberIndex && stringIndex) throw new GenerationFailure(path, "types carrying BOTH string and number index signatures are ambiguous");
      const isMapped = (((type as ts.ObjectType).objectFlags ?? 0) & ts.ObjectFlags.Mapped) !== 0;
      if (declaration?.getSourceFile().isDeclarationFile && !isMapped && !stringIndex && !numberIndex) {
        throw new GenerationFailure(path, `external/opaque type \`${checker.typeToString(type)}\` is not a validatable shape`);
      }

      const props: Array<{ name: string; optional: boolean; type: ShapeNode }> = [];
      for (const property of checker.getPropertiesOfType(type)) {
        const name = property.getName();
        if (name.startsWith("__")) throw new GenerationFailure(`${path}.${name}`, "internal/synthetic member");
        const optional = (property.getFlags() & ts.SymbolFlags.Optional) !== 0;
        const declared = property.declarations?.[0];
        const propertyType = checker.getTypeOfSymbolAtLocation(property, declared ?? (symbol?.declarations?.[0] as ts.Node));
        props.push({ name, optional, type: this.walk(this.stripUndefined(propertyType), `${path}.${name}`, depth + 1) });
      }
      props.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

      const indexInfo = stringIndex ?? numberIndex;
      const index = indexInfo
        ? { key: (stringIndex ? "string" : "number") as "string" | "number", of: this.walk(this.stripUndefined(indexInfo.type), `${path}[key]`, depth + 1) }
        : null;

      if (props.length === 0 && index === null) {
        throw new GenerationFailure(path, `\`${checker.typeToString(type)}\` has no members and no index signature`);
      }
      return { k: "object", props, index };
    }

    throw new GenerationFailure(path, `unhandled type \`${checker.typeToString(type)}\` (flags ${flags})`);
  }

  private stripUndefined(type: ts.Type): ts.Type {
    if (!type.isUnion()) return type;
    const kept = type.types.filter((member) => !(member.flags & ts.TypeFlags.Undefined));
    if (kept.length === type.types.length) return type;
    if (kept.length === 1) return kept[0]!;
    return type;
  }

  private describeUnion(type: ts.UnionType, path: string, depth: number): ShapeNode {
    const members = type.types.filter((member) => !(member.flags & ts.TypeFlags.Undefined));
    if (members.length === 0) throw new GenerationFailure(path, "union collapsed to `undefined`");
    if (members.length === 1) return this.walk(members[0]!, path, depth + 1);

    const booleanish = members.filter((member) => member.flags & ts.TypeFlags.BooleanLiteral);
    const rest = members.filter((member) => !(member.flags & ts.TypeFlags.BooleanLiteral));
    const variants: ShapeNode[] = [];
    if (booleanish.length === 2) variants.push({ k: "boolean" });
    else for (const member of booleanish) variants.push(this.walk(member, path, depth + 1));
    for (const [index, member] of rest.entries()) variants.push(this.walk(member, `${path}|${index}`, depth + 1));

    return { k: "union", discriminant: this.findDiscriminant(members, variants), variants };
  }

  private findDiscriminant(members: readonly ts.Type[], variants: readonly ShapeNode[]): string | null {
    const objectVariants = members.filter((member) => (member.flags & ts.TypeFlags.Object) !== 0 && !this.checker.isArrayType(member) && !this.checker.isTupleType(member));
    if (objectVariants.length !== members.length || objectVariants.length !== variants.length) return null;
    const first = this.checker.getPropertiesOfType(objectVariants[0]!);
    for (const candidate of first) {
      const name = candidate.getName();
      const values: string[] = [];
      let ok = true;
      for (const variant of objectVariants) {
        const property = this.checker.getPropertyOfType(variant, name);
        if (!property) { ok = false; break; }
        const declared = property.declarations?.[0];
        if (!declared) { ok = false; break; }
        const propertyType = this.checker.getTypeOfSymbolAtLocation(property, declared);
        if (!(propertyType.flags & ts.TypeFlags.StringLiteral)) { ok = false; break; }
        values.push((propertyType as ts.StringLiteralType).value);
      }
      if (ok && new Set(values).size === values.length) return name;
    }
    return null;
  }

  finish(root: ShapeNode): Descriptor {
    if (root.k !== "ref") throw new Error("the entry type must resolve to a named node");
    return {
      schema: DESCRIPTOR_VERSION,
      root: root.id,
      nodes: Object.fromEntries([...this.nodes.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      sources: [...this.sources].sort(),
    };
  }
}

// ─── Deterministic emission ──────────────────────────────────────────────────

/** Canonical JSON: recursively key-sorted, `undefined` dropped. Independent of
 *  the app's copy so the builder has no runtime dependency on app code. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

export function digestOf(text: string): string {
  return `sha256-${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32)}`;
}

function render(descriptor: Descriptor, sourceDigest: string, graphDigest: string): string {
  const body = JSON.stringify(canonical(descriptor), null, 2);
  return `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by \`scripts/generate-pcb-shape-descriptor.ts\` from the TypeScript
 * type graph reachable from \`app/lib/pcb/types.ts:PcbBoard\`, using the
 * compiler API and type checker.
 *
 * Regenerate:  npx tsx scripts/generate-pcb-shape-descriptor.ts
 * CI gate:     npx tsx scripts/generate-pcb-shape-descriptor.ts --check
 *
 * \`PCB_SHAPE_SOURCE_DIGEST\` covers the exact bytes of every contributing
 * source file; \`PCB_SHAPE_GRAPH_DIGEST\` covers the emitted descriptor. A
 * change to any reachable PCB type moves both and fails CI until regenerated.
 */

import type { PcbShapeDescriptor } from "../pcb-shape-types";

export const PCB_SHAPE_SOURCE_DIGEST = ${JSON.stringify(sourceDigest)} as const;
export const PCB_SHAPE_GRAPH_DIGEST = ${JSON.stringify(graphDigest)} as const;

export const PCB_SHAPE_DESCRIPTOR: PcbShapeDescriptor = ${body} as const;
`;
}

/**
 * Build the descriptor. PURE with respect to the filesystem: it reads sources
 * (honouring the overlay) and returns text. It never writes anything.
 */
export function buildPcbShapeDescriptor(options: BuildOptions = {}): BuildResult {
  const root = options.root ?? process.cwd();
  const entry = options.entry ?? DEFAULT_ENTRY;
  const overlay = options.overlay ?? {};

  const { program, checker } = createProgram(root, entry, overlay);
  const entryType = findEntryType(program, checker, join(root, entry), DEFAULT_ENTRY_TYPE);
  const walker = new ShapeWalker(checker, root);
  const descriptor = walker.finish(walker.walk(entryType, DEFAULT_ENTRY_TYPE));

  const readSource = (path: string): string => {
    const overlaid = overlay[path];
    const text = overlaid ?? readFileSync(join(root, path), "utf8");
    return text.split("\r\n").join("\n");
  };
  const sourceDigest = digestOf(descriptor.sources.map((path) => `${path}\u0000${readSource(path)}`).join("\u0001"));
  const graphDigest = digestOf(JSON.stringify(canonical(descriptor)));
  const summary = `${Object.keys(descriptor.nodes).length} named types from ${descriptor.sources.length} source files; graph ${graphDigest}; sources ${sourceDigest}`;
  return { content: render(descriptor, sourceDigest, graphDigest), descriptor, sourceDigest, graphDigest, summary };
}

export type CompareResult =
  | { ok: true; summary: string }
  | { ok: false; reason: "missing" | "drift" | "unsupported-shape"; detail: string; summary?: string };

/**
 * Compare a fresh generation against a checked-in descriptor TEXT. Read-only
 * by construction — the caller supplies the text, so this function cannot be
 * made to write.
 */
export function comparePcbShapeDescriptor(checkedIn: string | null, options: BuildOptions = {}): CompareResult {
  let built: BuildResult;
  try {
    built = buildPcbShapeDescriptor(options);
  } catch (error) {
    if (error instanceof GenerationFailure) return { ok: false, reason: "unsupported-shape", detail: error.message };
    throw error;
  }
  if (checkedIn === null) return { ok: false, reason: "missing", detail: "the checked-in descriptor is missing", summary: built.summary };
  if (checkedIn.split("\r\n").join("\n") !== built.content) {
    return { ok: false, reason: "drift", detail: "the checked-in PCB shape descriptor does not match a fresh generation", summary: built.summary };
  }
  return { ok: true, summary: built.summary };
}
