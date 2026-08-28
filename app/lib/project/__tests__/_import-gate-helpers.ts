/**
 * [B14.4 §E] shared AST-based import-gate helpers for the capability
 * boundary walkers.
 *
 * HISTORY. The B14.2 gates matched ONE raw path substring, which a
 * same-directory `./replacement-reauthorization` specifier evaded. B14.3
 * replaced that with regex specifier extraction + path resolution — but
 * independent verification proved the REGEXES were not complete either:
 * a comment inside the argument parentheses of a dynamic import, a comment between
 * `from` and its literal, an escaped literal (`-` for `-`), and a
 * statically concatenated `import("…-" + "…")` all parse as valid
 * TypeScript yet extracted nothing. B14.4 therefore replaces extraction
 * with the TYPESCRIPT PARSER itself (the repository's existing `typescript`
 * dependency — no new dependency): comments and formatting cannot affect an
 * AST, and `StringLiteralLike.text` is the DECODED module name.
 *
 * EXTRACTION (per file, parsed with the extension-correct ScriptKind):
 *  - ImportDeclaration (incl. side-effect and type-only imports);
 *  - ExportDeclaration WITH a moduleSpecifier (re-exports, `export * from`);
 *  - ImportEqualsDeclaration with an external module reference
 *    (`import x = require("…")`);
 *  - ImportTypeNode (`import("…").T` in type positions);
 *  - dynamic `import(…)` CallExpressions;
 *  - `require(…)` CallExpressions — with NO exemption of any kind. [B14.5]
 *    the former file-wide `declaresLocalRequire` exemption was proven
 *    unsound: an unrelated NESTED binding named `require` (even a
 *    parameter deep inside one function) suppressed classification of
 *    every `require()` call in the file, including genuinely global ones,
 *    and the pinned production file could be POISONED by prepending a
 *    global `require()` of a protected module. Classification is now
 *    unconditional; a declaration named `require` is itself a
 *    module-loader boundary violation surfaced by
 *    `requireShadowDeclarations()`, which the production gate pins at
 *    ZERO. Whole-file exemptions, path allowlists, and source-digest
 *    exemptions are FORBIDDEN.
 *
 * LOADER MINTING [B14.5, adversarial audit]: `require` is not the only way
 * to obtain a CommonJS loader. `createRequire()` (node:module) mints one
 * bound to ANY name, so a three-line ESM file could load a protected module
 * with no identifier named `require` anywhere. Loader-minting calls are
 * therefore tracked: bindings initialized from `createRequire(…)` are
 * LOADER ALIASES whose calls classify exactly like `require(…)`,
 * immediately-invoked forms are classified directly, `Module._load`
 * reflection is treated as a loader, and any UNCLASSIFIED reference to
 * `createRequire` fails closed as an opaque load.
 *
 * NAME POSITIONS [B14.5, adversarial audit]: an identifier spelled
 * `require` in a NAME position — a member name (`config.require`), an
 * object/JSX/type/enum member key, an import/export specifier name — does
 * not denote the loader binding and is NOT reported. Excluding these cannot
 * hide a loader call (a call has the loader as its callee or base, both
 * classified) and prevents idiomatic non-loader code from failing the pin.
 *
 * PARSE DIAGNOSTICS [B14.5]: `sourceParseDiagnostics()` reports the
 * TypeScript parser's syntactic diagnostics as bounded records. A gate
 * that silently consumed an error-recovered AST could call malformed
 * source boundary-clean; the production suite therefore pins the scanned
 * tree at ZERO parse diagnostics and proves malformed fixtures in EVERY
 * supported extension trip the gate. For the JS-family extensions the
 * parser alone is not enough: TypeScript accepts TS-only grammar under
 * every ScriptKind and reports "…can only be used in TypeScript files" from
 * its JS pass instead, so those four extensions are additionally probed
 * with `ts.transpileModule({reportDiagnostics:true})` — TypeScript's own
 * SYNTACTIC channel — and the results are merged.
 *
 * STATIC EVALUATION of dynamic import()/require() arguments accepts ONLY
 * side-effect-free statically known strings: string literals,
 * no-substitution template literals, parenthesized forms of those, and
 * binary `+` concatenations composed entirely of them. Nothing is ever
 * executed. An argument outside that grammar is an OPAQUE MODULE LOAD,
 * surfaced by `opaqueModuleLoads()` — the capability gate fails closed on
 * it rather than ignoring it.
 *
 * RESOLUTION canonicalizes specifiers to repo-relative extensionless
 * module identities: `@/x` → `x`; `./`/`../` resolved segment-by-segment
 * against the importer's directory; one trailing SUPPORTED source
 * extension stripped; traversal above the repository root is REJECTED and
 * surfaced via `rootEscapingImports()`; bare package specifiers are not
 * repo modules. The authoritative comparison is canonical module identity
 * — never raw substring matching. DETECTION compares case-insensitively
 * (a case-variant spelling resolves to the protected module on the
 * case-insensitive filesystems Sirkit develops on), while APPROVAL is
 * exact-case, so a case-variant spelling by anyone — approved or not — is
 * flagged.
 */

import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type FileMap = Map<string, string>;

export const PRODUCTION_SOURCE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs",
] as const;

export type ModuleReferenceKind =
  | "static-import"
  | "re-export"
  | "import-equals"
  | "import-type"
  | "dynamic-import"
  | "require";

export interface ModuleReference {
  kind: ModuleReferenceKind;
  /** The DECODED (or statically evaluated) specifier text. */
  specifier: string;
}

export interface OpaqueModuleLoad {
  file: string;
  kind: "dynamic-import" | "require";
  /** Source text of the non-static argument, for reporting. */
  argumentText: string;
}

interface FileModuleFacts {
  references: ModuleReference[];
  opaqueLoads: Array<{ kind: "dynamic-import" | "require"; argumentText: string }>;
  /** [B14.5] declarations named `require` — boundary violations, never
   *  exemptions. */
  requireShadows: Array<{ kind: string; position: number }>;
}

export interface RequireShadowDeclaration {
  file: string;
  /** The declaration form that shadows the CommonJS loader name. */
  kind: string;
  line: number;
  character: number;
}

export interface ParseDiagnosticRecord {
  file: string;
  code: number;
  message: string;
  line: number | null;
  character: number | null;
}

/** Bounds on diagnostic reporting (record count and message length). */
const MAX_DIAGNOSTIC_RECORDS = 100;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 200;

// ─── Parsing ─────────────────────────────────────────────────────────────────

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS; // .ts, .mts, .cts
}

/** Side-effect-free static string evaluation — NOTHING is executed. */
function staticStringValue(expression: ts.Expression): string | null {
  if (ts.isStringLiteralLike(expression)) return expression.text; // decoded
  if (ts.isParenthesizedExpression(expression)) return staticStringValue(expression.expression);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(expression.left);
    if (left === null) return null;
    const right = staticStringValue(expression.right);
    if (right === null) return null;
    return left + right;
  }
  return null;
}

/**
 * [B14.5] Every declaration that shadows the CommonJS loader name, at ANY
 * scope. These are reported as BOUNDARY VIOLATIONS (the production tree is
 * pinned at zero) — they never suppress classification of anything.
 */
function collectRequireShadows(sourceFile: ts.SourceFile): Array<{ kind: string; position: number }> {
  const shadows: Array<{ kind: string; position: number }> = [];
  const visit = (node: ts.Node): void => {
    const kind =
      ts.isVariableDeclaration(node) ? "variable"
      : ts.isFunctionDeclaration(node) ? "function"
      : ts.isFunctionExpression(node) ? "function-expression"
      : ts.isParameter(node) ? "parameter"
      : ts.isBindingElement(node) ? "binding-element"
      : ts.isImportSpecifier(node) ? "import-specifier"
      : ts.isImportClause(node) ? "import-clause"
      : ts.isNamespaceImport(node) ? "namespace-import"
      : ts.isClassDeclaration(node) ? "class"
      : ts.isClassExpression(node) ? "class-expression"
      : ts.isMethodDeclaration(node) ? "method"
      : ts.isPropertyDeclaration(node) ? "property"
      : ts.isEnumDeclaration(node) ? "enum"
      : ts.isModuleDeclaration(node) ? "namespace"
      : ts.isGetAccessorDeclaration(node) ? "getter"
      : ts.isSetAccessorDeclaration(node) ? "setter"
      : ts.isTypeAliasDeclaration(node) ? "type-alias"
      : ts.isInterfaceDeclaration(node) ? "interface"
      : null;
    if (kind !== null) {
      const name = (node as { name?: ts.Node }).name;
      if (name && ts.isIdentifier(name) && name.text === "require") {
        shadows.push({ kind, position: name.getStart(sourceFile) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return shadows;
}

/** Parsed-source cache shared by every gate (keyed by path, validated by
 *  the exact source string) — the production tree is parsed ONCE per run,
 *  not once per gate invocation. */
/** Is this call a CommonJS-loader MINT (`createRequire(…)`, directly, via a
 *  namespace/member, or through a tracked factory alias)? */
function isLoaderMintingCall(call: ts.CallExpression, factories: ReadonlySet<string>): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === "createRequire" || factories.has(callee.text);
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === "createRequire";
  return false;
}

/** Every `createRequire` identifier used as a minting callee (so it is not
 *  double-reported by the fail-closed identifier fallback). */
function collectMintingCallees(sourceFile: ts.SourceFile): Set<ts.Node> {
  const callees = new Set<ts.Node>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === "createRequire") callees.add(callee);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return callees;
}

/**
 * [B14.5 audit] Names bound to a CommonJS loader minted by `createRequire`.
 * A bounded fixed point also follows factory aliases
 * (`const mk = createRequire; const load = mk(url);`). Calls through these
 * names classify exactly like `require(…)`.
 */
function collectLoaderAliases(sourceFile: ts.SourceFile): Set<string> {
  const factories = new Set<string>(["createRequire"]);
  const loaders = new Set<string>();
  for (let pass = 0; pass < 3; pass += 1) {
    const before = factories.size + loaders.size;
    const visit = (node: ts.Node): void => {
      // `import { createRequire as mk } from "node:module"` — the local name
      // is a factory alias even though it is not a variable declaration.
      if (ts.isImportSpecifier(node) && ts.isIdentifier(node.name)) {
        const imported = node.propertyName ?? node.name;
        if (ts.isIdentifier(imported) && imported.text === "createRequire") factories.add(node.name.text);
      }
      if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer) {
        const initializer = node.initializer;
        const referencesFactory =
          (ts.isIdentifier(initializer) && factories.has(initializer.text))
          || (ts.isPropertyAccessExpression(initializer) && initializer.name.text === "createRequire");
        if (referencesFactory) factories.add(node.name.text);
        else if (ts.isCallExpression(initializer) && isLoaderMintingCall(initializer, factories)) {
          loaders.add(node.name.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (factories.size + loaders.size === before) break;
  }
  return loaders;
}

const sourceFileCache = new Map<string, { source: string; sourceFile: ts.SourceFile }>();

function parsedSource(path: string, source: string): ts.SourceFile {
  const cached = sourceFileCache.get(path);
  if (cached && cached.source === source) return cached.sourceFile;
  // setParentNodes=false: none of the gate visitors need parent links, and
  // skipping them measurably speeds the one-time whole-tree parse.
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, scriptKindFor(path));
  sourceFileCache.set(path, { source, sourceFile });
  return sourceFile;
}

const factsCache = new Map<string, { source: string; facts: FileModuleFacts }>();

function fileModuleFacts(path: string, source: string): FileModuleFacts {
  const cached = factsCache.get(path);
  if (cached && cached.source === source) return cached.facts;
  const sourceFile = parsedSource(path, source);
  const requireShadows = collectRequireShadows(sourceFile);
  const loaderAliases = collectLoaderAliases(sourceFile);
  const references: ModuleReference[] = [];
  const opaqueLoads: FileModuleFacts["opaqueLoads"] = [];
  /** Identifier nodes already consumed as classified loader callees. */
  const classifiedRequireIdentifiers = new Set<ts.Node>();
  /** Positions of DECLARATION names called `require` — already reported as
   *  shadow violations, so they are not double-counted as opaque loads. */
  const shadowNamePositions = new Set(requireShadows.map((shadow) => shadow.position));
  /** Identifiers occupying NAME positions (member/key/specifier names) —
   *  never loader references. */
  const nameOnlyIdentifiers = new Set<ts.Node>();
  /** `createRequire` identifiers consumed as minting callees. */
  const mintingCalleeIdentifiers = collectMintingCallees(sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) {
        references.push({ kind: "static-import", specifier: node.moduleSpecifier.text });
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        references.push({ kind: "re-export", specifier: node.moduleSpecifier.text });
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference) && reference.expression && ts.isStringLiteralLike(reference.expression)) {
        references.push({ kind: "import-equals", specifier: reference.expression.text });
      }
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        references.push({ kind: "import-type", specifier: node.argument.literal.text });
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      // a MEMBER NAME never denotes the loader binding (`config.require`)
      nameOnlyIdentifiers.add(node.name);
    } else if (ts.isPropertyAssignment(node) || ts.isPropertySignature(node)
      || ts.isMethodSignature(node) || ts.isEnumMember(node)
      || ts.isJsxAttribute(node) || ts.isExportSpecifier(node)
      || ts.isTypeParameterDeclaration(node) || ts.isLabeledStatement(node)) {
      // object/type/enum/JSX/specifier KEYS are not loader references
      const name = (node as { name?: ts.Node }).name;
      if (name && ts.isIdentifier(name)) nameOnlyIdentifiers.add(name);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      // [B14.5] UNCONDITIONAL — no declaration anywhere in the file can
      // suppress classification of a module-loader call.
      const isBareRequire = ts.isIdentifier(callee) && callee.text === "require";
      // [B14.4 adversarial hardening] property-access loader shapes:
      // require.resolve / require.context / require.ensure — the callee's
      // BASE identifier is the CommonJS loader, so the call locates (or
      // loads) a module and must be classified, not silently skipped.
      const isRequireProperty = ts.isPropertyAccessExpression(callee)
        && ts.isIdentifier(callee.expression) && callee.expression.text === "require";
      // import.meta.resolve("…") — the ESM equivalent of require.resolve.
      const isImportMetaResolve = ts.isPropertyAccessExpression(callee)
        && callee.name.text === "resolve"
        && ts.isMetaProperty(callee.expression)
        && callee.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
      // [B14.5 audit] loaders minted by createRequire(): an alias call, an
      // immediately-invoked mint, or CommonJS `Module._load` reflection.
      const isLoaderAliasCall = ts.isIdentifier(callee) && loaderAliases.has(callee.text);
      const isMintedCall = ts.isCallExpression(callee) && isLoaderMintingCall(callee, loaderAliases);
      const isModuleLoadReflection = ts.isPropertyAccessExpression(callee)
        && (callee.name.text === "_load" || callee.name.text === "require");
      if (isBareRequire) classifiedRequireIdentifiers.add(callee);
      if (isRequireProperty) classifiedRequireIdentifiers.add((callee as ts.PropertyAccessExpression).expression);
      if (isLoaderAliasCall) classifiedRequireIdentifiers.add(callee);
      if ((isDynamicImport || isBareRequire || isRequireProperty || isImportMetaResolve
        || isLoaderAliasCall || isMintedCall || isModuleLoadReflection) && node.arguments.length > 0) {
        const kind = (isDynamicImport || isImportMetaResolve) ? "dynamic-import" as const : "require" as const;
        const argument = node.arguments[0]!;
        const value = staticStringValue(argument);
        if (value !== null) references.push({ kind, specifier: value });
        else opaqueLoads.push({ kind, argumentText: argument.getText(sourceFile) });
      }
    } else if (ts.isIdentifier(node) && (node.text === "require" || node.text === "createRequire")
      && !classifiedRequireIdentifiers.has(node)
      && !nameOnlyIdentifiers.has(node)
      && !mintingCalleeIdentifiers.has(node)
      && !shadowNamePositions.has(node.getStart(sourceFile))) {
      // [B14.4 adversarial hardening] an UNCLASSIFIED reference to the
      // CommonJS loader — aliasing (`const r = require`), reflection
      // (`module.require`, passing `require` as a value), or any other
      // shape that could load a module without a classifiable argument —
      // FAILS CLOSED as an opaque load. Deliberate over-approximation: a
      // benign property NAMED `require` would also surface here; the
      // production pin (zero opaque loads) keeps that reviewable, never
      // silent.
      opaqueLoads.push({ kind: "require", argumentText: "bare `require` reference (aliasing/reflection)" });
    }
    ts.forEachChild(node, visit);
    // [B14.5 audit] `ts.forEachChild` does NOT descend into a node's JSDoc,
    // so `/** @type {import("…").T} */` — the JS-family spelling of the
    // import-type form — was invisible to extraction. Walk it explicitly.
    for (const doc of (node as { jsDoc?: ts.Node[] }).jsDoc ?? []) visit(doc);
  };
  visit(sourceFile);
  const facts: FileModuleFacts = { references, opaqueLoads, requireShadows };
  factsCache.set(path, { source, facts });
  return facts;
}

/** Every statically resolved module reference in one source (AST-decoded). */
export function moduleReferences(path: string, source: string): ModuleReference[] {
  return fileModuleFacts(path, source).references;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export type SpecifierResolution =
  | { kind: "module"; module: string }
  | { kind: "bare" }
  | { kind: "escapes-root" };

function stripSupportedExtension(path: string): string {
  for (const extension of PRODUCTION_SOURCE_EXTENSIONS) {
    if (path.endsWith(extension)) return path.slice(0, -extension.length);
  }
  return path;
}

/**
 * Canonical repo-relative module identity for a specifier, resolved against
 * the importing file's repo-relative path. `.`/`..` segments are
 * normalized; traversal above the repository root is REJECTED.
 */
export function resolveSpecifier(importerPath: string, specifier: string): SpecifierResolution {
  // Fail-closed canonicalization BEFORE classification: bundler resolvers
  // tolerate Windows backslashes in specifiers and ignore ?query/#fragment
  // suffixes when locating the file, so those spellings must not be able
  // to dodge the identity comparison by classifying as "bare".
  // (?!^): a LEADING `#` is a Node package-imports subpath specifier, not
  // a fragment — it must classify as bare, not be erased to empty.
  const canonical = specifier.replaceAll("\\", "/").replace(/(?!^)[?#][\s\S]*$/, "");
  let stack: string[];
  let parts: string[];
  if (canonical.startsWith("@/")) {
    stack = [];
    parts = canonical.slice(2).split("/");
  } else if (canonical.startsWith("./") || canonical.startsWith("../") || canonical === "." || canonical === "..") {
    stack = importerPath.split("/").slice(0, -1);
    parts = canonical.split("/");
  } else {
    return { kind: "bare" };
  }
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return { kind: "escapes-root" };
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return { kind: "module", module: stripSupportedExtension(stack.join("/")) };
}

/** Case-insensitive identity: a case-variant spelling resolves to the same
 *  file on the case-insensitive filesystems Sirkit develops on. */
function referencesModule(resolution: SpecifierResolution, modulePath: string): boolean {
  return resolution.kind === "module" && resolution.module.toLowerCase() === modulePath.toLowerCase();
}

// ─── Gates ───────────────────────────────────────────────────────────────────

/**
 * Files (outside `approved`, compared exact-case) with ANY AST-extracted
 * module reference that canonically resolves to `modulePath`
 * (repo-relative, extensionless).
 */
export function moduleImportOffenders(
  files: FileMap,
  modulePath: string,
  approved: ReadonlySet<string>,
): string[] {
  const offenders: string[] = [];
  for (const [relPath, source] of files) {
    if (approved.has(relPath)) continue;
    for (const reference of fileModuleFacts(relPath, source).references) {
      if (referencesModule(resolveSpecifier(relPath, reference.specifier), modulePath)) {
        offenders.push(relPath);
        break;
      }
    }
  }
  return offenders;
}

/**
 * Dynamic import()/require() calls whose target is NOT a statically known
 * string. The capability-boundary gate FAILS CLOSED on these — an opaque
 * module load could name anything at runtime, so it must be reviewed, not
 * ignored.
 */
export function opaqueModuleLoads(files: FileMap): OpaqueModuleLoad[] {
  const loads: OpaqueModuleLoad[] = [];
  for (const [relPath, source] of files) {
    for (const load of fileModuleFacts(relPath, source).opaqueLoads) {
      loads.push({ file: relPath, ...load });
    }
  }
  return loads;
}

/** Import specifiers that traverse above the repository root — rejected by
 *  resolution and surfaced here so the suite can assert there are none. */
export function rootEscapingImports(files: FileMap): Array<{ file: string; specifier: string }> {
  const escaping: Array<{ file: string; specifier: string }> = [];
  for (const [relPath, source] of files) {
    for (const reference of fileModuleFacts(relPath, source).references) {
      if (resolveSpecifier(relPath, reference.specifier).kind === "escapes-root") {
        escaping.push({ file: relPath, specifier: reference.specifier });
      }
    }
  }
  return escaping;
}

/**
 * [B14.5] Declarations that shadow the CommonJS loader name `require`, at
 * ANY scope, with their positions. These are BOUNDARY VIOLATIONS requiring
 * explicit review — never exemptions — and the production tree is pinned at
 * ZERO by the permanent suite.
 */
export function requireShadowDeclarations(files: FileMap): RequireShadowDeclaration[] {
  const declarations: RequireShadowDeclaration[] = [];
  for (const [relPath, source] of files) {
    const facts = fileModuleFacts(relPath, source);
    if (facts.requireShadows.length === 0) continue;
    const sourceFile = parsedSource(relPath, source);
    for (const shadow of facts.requireShadows) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(shadow.position);
      declarations.push({ file: relPath, kind: shadow.kind, line: line + 1, character: character + 1 });
    }
  }
  return declarations;
}

/**
 * [B14.5] The TypeScript parser's SYNTACTIC diagnostics for each scanned
 * source, as BOUNDED records (path, code, normalized message, position when
 * available). The parser error-recovers, so a gate that ignored these could
 * declare malformed source boundary-clean; the production suite pins this at
 * ZERO for the complete scanned tree and proves malformed fixtures in every
 * supported extension are reported.
 */
function isJsFamily(path: string): boolean {
  return path.endsWith(".js") || path.endsWith(".jsx") || path.endsWith(".mjs") || path.endsWith(".cjs");
}

/** TypeScript's SYNTACTIC diagnostics for a JS-family source (TS-only syntax
 *  in a JavaScript file is a syntactic error TypeScript reports outside the
 *  parser's own list). */
function jsSyntacticDiagnostics(path: string, source: string): readonly ts.Diagnostic[] {
  try {
    const result = ts.transpileModule(source, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        jsx: ts.JsxEmit.Preserve,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
    });
    return result.diagnostics ?? [];
  } catch {
    return [];
  }
}

export function sourceParseDiagnostics(files: FileMap): ParseDiagnosticRecord[] {
  const records: ParseDiagnosticRecord[] = [];
  for (const [relPath, source] of files) {
    if (records.length >= MAX_DIAGNOSTIC_RECORDS) break;
    const sourceFile = parsedSource(relPath, source);
    // `parseDiagnostics` is the parser's own syntactic diagnostic list. It is
    // an internal property, so it is read defensively — and the permanent
    // malformed-fixture tests fail loudly if the shape ever changes, rather
    // than silently reporting "clean".
    const parsed = (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    // [B14.5 audit] the parser accepts TS-only grammar under EVERY ScriptKind
    // and TypeScript reports "…can only be used in TypeScript files" from its
    // JS pass instead — so JS-family sources are additionally probed through
    // TypeScript's own syntactic channel and the results merged.
    const diagnostics = isJsFamily(relPath) ? [...parsed, ...jsSyntacticDiagnostics(relPath, source)] : parsed;
    for (const diagnostic of diagnostics) {
      if (records.length >= MAX_DIAGNOSTIC_RECORDS) break;
      const position = typeof diagnostic.start === "number"
        ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
        : null;
      records.push({
        file: relPath,
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARS),
        line: position ? position.line + 1 : null,
        character: position ? position.character + 1 : null,
      });
    }
  }
  return records;
}

/**
 * Files (outside `approved`) whose AST contains the given identifier as an
 * Identifier or decoded string literal — covering named imports with
 * aliases (the propertyName), namespace access, destructuring, element
 * access by string, arbitrary-module-namespace import strings, and
 * re-export specifiers. Used for the test-only channel factory name.
 */
export function identifierReferences(
  files: FileMap,
  identifier: string,
  approved: ReadonlySet<string>,
): string[] {
  const offenders: string[] = [];
  for (const [relPath, source] of files) {
    if (approved.has(relPath)) continue;
    const sourceFile = parsedSource(relPath, source);
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if ((ts.isIdentifier(node) && node.text === identifier)
        || (ts.isStringLiteralLike(node) && node.text === identifier)) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (found) offenders.push(relPath);
  }
  return offenders;
}

// ─── The shared production walker (all supported source extensions) ──────────

/** Never production source (or legitimately test-only) at ANY depth. */
const EXCLUDED_AT_EVERY_DEPTH = new Set(["node_modules", ".next", ".git", "__tests__"]);

/**
 * Excluded ONLY at the REPOSITORY ROOT: the repo's non-source trees
 * (stage evidence, the durable data store, static assets, vendored
 * blobs). [B14.4 adversarial finding] a directory with one of these
 * NAMES deeper inside a walked tree — e.g. an `app/data/` or
 * `app/public/` App Router route segment — IS production and IS scanned;
 * the earlier walker excluded these basenames at every depth, silently
 * skipping such route segments.
 */
const EXCLUDED_AT_ROOT_ONLY = new Set(["artifacts", "data", "public", "vendor"]);

/**
 * The production FileMap: the ENTIRE repository walked from its root for
 * EVERY supported source extension (.ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs).
 * [B14.4 adversarial finding] walking only `app/`+`scripts/`+`lib/` left
 * the top-level `components/` tree (reachable via `@/components`) and
 * repository-root production files (Next.js `middleware.ts`,
 * `instrumentation.ts`, configs) unenumerated — a forbidden importer
 * there was invisible to the gate. Whole-root coverage with the two
 * exclusion tiers above closes that class: a future production tree or
 * root file is parsed and gated by construction, not silently skipped;
 * and because ALL eight extensions are inspected under the correct
 * ScriptKind, a future non-.ts importer is gated too.
 */
export function collectProductionFiles(root: string = process.cwd()): FileMap {
  const files: FileMap = new Map();
  const walk = (dir: string, atRoot: boolean): void => {
    for (const entry of readdirSync(dir)) {
      if (EXCLUDED_AT_EVERY_DEPTH.has(entry)) continue;
      if (atRoot && EXCLUDED_AT_ROOT_ONLY.has(entry)) continue;
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) { walk(full, false); continue; }
      if (!PRODUCTION_SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue;
      files.set(relative(root, full).replaceAll("\\", "/"), readFileSync(full, "utf8"));
    }
  };
  walk(root, true);
  return files;
}
