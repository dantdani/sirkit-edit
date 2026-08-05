import path from "node:path";
import { child, children, parseSexpr, str } from "@/app/lib/pcb/sexpr";
import { assertBoundedSExpression, resolvePermittedPath, type SafePathPolicy } from "./security";

export type LibraryKind = "symbol" | "footprint";
export type LibraryScope = "global" | "project";

export interface LibraryTableEntry {
  nickname: string;
  kind: LibraryKind;
  type: string;
  uri: string;
  options: string;
  description: string;
  scope: LibraryScope;
  order: number;
}

export interface ResolvedLibrary extends LibraryTableEntry {
  resolvedPath: string | null;
  shadowed: LibraryTableEntry[];
  diagnostics: string[];
}

export function parseLibraryTable(source: string, kind: LibraryKind, scope: LibraryScope): LibraryTableEntry[] {
  assertBoundedSExpression(source);
  const root = parseSexpr(source);
  const expected = kind === "symbol" ? "sym_lib_table" : "fp_lib_table";
  const head = root.items[0];
  if (!head || head.kind !== "symbol" || head.value !== expected) throw new Error(`Expected (${expected} ...)`);
  return children(root, "lib").map((node, order) => ({
    nickname: child(node, "name") ? str(child(node, "name")!, 1) : "",
    kind,
    type: child(node, "type") ? str(child(node, "type")!, 1) : "",
    uri: child(node, "uri") ? str(child(node, "uri")!, 1) : "",
    options: child(node, "options") ? str(child(node, "options")!, 1) : "",
    description: child(node, "descr") ? str(child(node, "descr")!, 1) : "",
    scope,
    order,
  }));
}

/** Project entries override globals; collisions within one scope are errors. */
export function resolveLibraryTables(input: {
  global: LibraryTableEntry[];
  project: LibraryTableEntry[];
  projectDirectory: string;
  pathPolicy: SafePathPolicy;
}): ResolvedLibrary[] {
  const byNickname = new Map<string, LibraryTableEntry[]>();
  for (const item of [...input.global, ...input.project]) {
    const list = byNickname.get(item.nickname) ?? [];
    list.push(item);
    byNickname.set(item.nickname, list);
  }
  return [...byNickname.entries()].sort(([a], [b]) => a.localeCompare(b)).map((entry) => {
    const candidates = entry[1];
    const project = candidates.filter((item) => item.scope === "project");
    const global = candidates.filter((item) => item.scope === "global");
    const selectedPool = project.length ? project : global;
    const selected = selectedPool.sort((a, b) => a.order - b.order)[0];
    const diagnostics: string[] = [];
    if (selectedPool.length > 1) diagnostics.push(`duplicate nickname "${selected.nickname}" in ${selected.scope} table`);
    const variables = { ...input.pathPolicy.variables, KIPRJMOD: input.projectDirectory };
    let resolvedPath: string | null = null;
    if (selectedPool.length > 1) {
      // Ambiguous same-scope nicknames are not usable until configuration is fixed.
      resolvedPath = null;
    } else if (selected.type.toLowerCase() === "kicad") {
      try {
        resolvedPath = resolvePermittedPath(selected.uri, { ...input.pathPolicy, variables });
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : "path resolution failed");
      }
    } else {
      diagnostics.push(`library type ${selected.type || "(missing)"} is not a filesystem KiCad library`);
    }
    return { ...selected, resolvedPath, shadowed: candidates.filter((item) => item !== selected), diagnostics };
  });
}

export function sourceIdentityPath(resolvedPath: string, roots: string[]): string {
  const root = roots.map((item) => path.resolve(item)).find((item) => {
    const relative = path.relative(item, path.resolve(resolvedPath));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  return root ? path.relative(root, resolvedPath).replace(/\\/g, "/") : "[external]";
}
