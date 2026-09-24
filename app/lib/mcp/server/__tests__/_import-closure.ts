/**
 * [B20 B3 review] The runtime import closure the MCP import gates walk (b20-b2-import-gates J2, b20-b3-import-gates G1 and
 * G7; not a test file). Moved here unchanged from J2 so every gate follows the same edges, with one addition: BRIDGES. A
 * bridge file is neither started from nor walked through, so "every runtime chain from the entries to X passes through a
 * bridge" is exactly "X is not in the closure bridged at those files".
 */
import ts from "typescript";
import { PRODUCTION_SOURCE_EXTENSIONS, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";

/** The specifiers a file imports or re-exports for their VALUES (a declaration whose every binding is type-only is erased). */
export function runtimeDeclarationSpecifiers(path: string, source: string): Set<string> {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specifiers = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const allTypes = bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && allTypes));
      if (!typeOnly) specifiers.add(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const clause = statement.exportClause;
      const allTypes = clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
      if (!statement.isTypeOnly && !allTypes) specifiers.add(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

// [B20 B2 lead] Sirkit's filesystems are case-insensitive, like the direct-import helper this closure replaced
// (_import-gate-helpers.ts referencesModule): a case-variant specifier reaches the same file, so it is resolved by folded path.
const FOLDED_INDEX = new WeakMap<FileMap, ReadonlyMap<string, string>>();
function foldedIndex(files: FileMap): ReadonlyMap<string, string> {
  let index = FOLDED_INDEX.get(files);
  if (index === undefined) {
    const built = new Map<string, string>();
    for (const file of files.keys()) if (!built.has(file.toLowerCase())) built.set(file.toLowerCase(), file);
    index = built;
    FOLDED_INDEX.set(files, index);
  }
  return index;
}
export function fileOf(files: FileMap, module: string): string | null {
  for (const candidate of [module, `${module}/index`]) {
    for (const extension of PRODUCTION_SOURCE_EXTENSIONS) {
      const exact = `${candidate}${extension}`;
      if (files.has(exact)) return exact;
      const folded = foldedIndex(files).get(exact.toLowerCase());
      if (folded !== undefined) return folded;
    }
  }
  return null;
}

/**
 * The runtime import closure of `entries` over `files`, each reached file with the chain that first reaches it: every static
 * import, re-export, import-equals, dynamic import and require whose specifier resolves to a production file is followed,
 * except a declaration whose bindings are all type-only (erased at run time) and an `import("…")` type. A file in `bridges`
 * is neither an entry nor walked through.
 */
export function importClosure(files: FileMap, entries: readonly string[], bridges: ReadonlySet<string> = new Set()): Map<string, readonly string[]> {
  const starts = entries.filter((entry) => !bridges.has(entry));
  const chains = new Map<string, readonly string[]>(starts.map((entry) => [entry, [entry]]));
  const queue = [...starts];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = files.get(file)!;
    const runtime = runtimeDeclarationSpecifiers(file, source);
    for (const reference of moduleReferences(file, source)) {
      if (reference.kind === "import-type") continue;
      if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
      const resolution = resolveSpecifier(file, reference.specifier);
      if (resolution.kind !== "module") continue;
      const target = fileOf(files, resolution.module);
      if (target === null || chains.has(target) || bridges.has(target)) continue;
      chains.set(target, [...chains.get(file)!, target]);
      queue.push(target);
    }
  }
  return chains;
}
