/**
 * B16.0.3 §B — STRUCTURAL authorization-boundary detection.
 *
 * The B16.0.2 gate used a text/regex scan: a route "reached the boundary" if
 * the source MENTIONED an approved helper anywhere — so a mention in a
 * comment, a string, a type position, an unused import, or unreachable code
 * would have satisfied it. This module replaces that with a real AST analysis
 * (the repository's own `typescript`), so only an ACTUAL, REACHABLE call to an
 * approved boundary helper — whose callee identifier is genuinely imported and
 * not shadowed — counts.
 *
 * A route passes only when it contains a `CallExpression` whose callee is an
 * approved boundary-helper identifier, that identifier is bound by an
 * `import` in the same file (never a local same-named declaration), and the
 * call is reachable (not inside a statically-false `if`, not after an
 * unconditional `return`/`throw` at the same statement level, not the dead
 * branch of a statically-true `if`).
 *
 * TEST-ONLY: imported exclusively by the authorization gate. It imports
 * `typescript`, so it must never enter the production runtime graph.
 */

import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

/** The identifiers a file binds through a VALUE `import` (named, default,
 *  namespace). A `import type` binding is EXCLUDED — a type-only binding can
 *  never be a runtime call. */
function importedBindings(sf: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>(); // name -> module specifier
  sf.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !node.importClause) return;
    const clause = node.importClause;
    if (clause.isTypeOnly) return; // `import type { ... }` — no runtime binding
    const specifier = ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
    if (clause.name) names.set(clause.name.text, specifier); // default import
    const nb = clause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if (el.isTypeOnly) continue; // `import { type X }`
        names.set(el.name.text, specifier);
      }
    }
    if (nb && ts.isNamespaceImport(nb)) names.set(nb.name.text, specifier);
  });
  return names;
}

/** Detailed VALUE imports: local name → { specifier, importedName } where
 *  `importedName` is the ORIGINAL exported symbol (the `propertyName` of an
 *  `import { orig as local }`, else the local name). Used to defeat
 *  alias/re-export laundering — an approved wrapper must be imported under its
 *  REAL exported name from the canonical module, not merely bound to a
 *  same-looking local identifier. */
interface ImportBinding { specifier: string; importedName: string }
function importedBindingsDetailed(sf: ts.SourceFile): Map<string, ImportBinding> {
  const names = new Map<string, ImportBinding>();
  sf.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !node.importClause) return;
    const clause = node.importClause;
    if (clause.isTypeOnly) return;
    const specifier = ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
    if (clause.name) names.set(clause.name.text, { specifier, importedName: "default" });
    const nb = clause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if (el.isTypeOnly) continue;
        names.set(el.name.text, { specifier, importedName: el.propertyName?.text ?? el.name.text });
      }
    }
    // A namespace import (`* as ns`) can never be an approved-wrapper CALL by a
    // bare identifier, so it is intentionally NOT recorded as a wrapper source.
  });
  return names;
}

/** The ONE canonical module that may define an approved route wrapper. */
const CANONICAL_WRAPPER_MODULE = ["app", "lib", "auth", "route-handlers.ts"] as const;

/** Is `callee` an approved wrapper imported under its REAL name from the exact
 *  canonical `app/lib/auth/route-handlers.ts`, which actually declares an
 *  exported function of that name? Rejects `./evil`, `import { evil as
 *  authenticatedJsonRoute }`, same-named locals, and re-export laundering. */
function isCanonicalWrapper(callee: string, detailed: Map<string, ImportBinding>, fromFile: string, rootDir: string): boolean {
  const binding = detailed.get(callee);
  if (!binding) return false;
  if (!(APPROVED_ROUTE_WRAPPERS as readonly string[]).includes(binding.importedName)) return false; // aliased-from-evil
  const target = resolveLocalModule(fromFile, binding.specifier, rootDir);
  if (!target) return false;
  const canonical = join(rootDir, ...CANONICAL_WRAPPER_MODULE);
  if (target.replace(/\\/g, "/") !== canonical.replace(/\\/g, "/")) return false; // ./evil or any non-canonical module
  // The canonical module must DECLARE (not re-export) an exported function of
  // that name — defeats a re-export-laundered barrel.
  const src = readFileSync(target, "utf8");
  const sf = ts.createSourceFile(target, src, ts.ScriptTarget.Latest, true, scriptKindFor(target));
  return findExportedFunction(sf, binding.importedName) !== null;
}

/** Identifiers declared LOCALLY at any scope (function/const/let/var/class) —
 *  used to reject a call to a same-named LOCAL that merely shadows the import
 *  name (an imported-only guarantee). */
function locallyDeclaredNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return names;
}

function isFalsyLiteral(expr: ts.Expression): boolean {
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isNumericLiteral(expr) && Number(expr.text) === 0) return true;
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    // !true / !1 → false
    const o = expr.operand;
    if (o.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (ts.isNumericLiteral(o) && Number(o.text) !== 0) return true;
  }
  return false;
}
function isTruthyLiteral(expr: ts.Expression): boolean {
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (ts.isNumericLiteral(expr) && Number(expr.text) !== 0) return true;
  return false;
}

/** Is a node reachable — not in a statically-dead branch, not after an
 *  unconditional terminator among its preceding block siblings. */
function isReachable(node: ts.Node): boolean {
  let cur: ts.Node = node;
  while (cur.parent) {
    const parent = cur.parent;
    if (ts.isIfStatement(parent)) {
      if (parent.thenStatement === cur && isFalsyLiteral(parent.expression)) return false;
      if (parent.elseStatement === cur && isTruthyLiteral(parent.expression)) return false;
    }
    if ((ts.isBlock(parent) || ts.isSourceFile(parent)) && ts.isStatement(cur as ts.Statement)) {
      const statements = (parent as ts.Block | ts.SourceFile).statements;
      const idx = statements.indexOf(cur as ts.Statement);
      if (idx > 0) {
        for (let i = 0; i < idx; i += 1) {
          const s = statements[i]!;
          if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) return false;
        }
      }
    }
    cur = parent;
  }
  return true;
}

export interface BoundaryCallResult {
  /** A reachable, imported-callee call to an approved helper exists. */
  reached: boolean;
  /** The approved helper names actually CALLED (reachable + imported). */
  calledHelpers: string[];
  /** Names that appear ONLY as a mention (comment/string/type/import) but are
   *  never a reachable imported call — for diagnostics/tripwires. */
  mentionedNotCalled: string[];
}

/**
 * Analyze a source file: does it contain a reachable, imported call to any of
 * `approvedNames`?  Comments, strings, type references, unused imports, and
 * unreachable code never count.
 */
export function analyzeBoundaryCalls(source: string, approvedNames: readonly string[], filePath = "route.ts"): BoundaryCallResult {
  const approved = new Set(approvedNames);
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, scriptKindFor(filePath));
  const imported = importedBindings(sf);
  const localDecls = locallyDeclaredNames(sf);
  const called = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (approved.has(name) && imported.has(name) && !localDecls.has(name) && isReachable(node)) {
        called.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  const mentionedNotCalled = [...approved].filter((n) => !called.has(n) && source.includes(n));
  return { reached: called.size > 0, calledHelpers: [...called].sort(), mentionedNotCalled };
}

/** Convenience boolean. */
export function callsApprovedBoundary(source: string, approvedNames: readonly string[], filePath = "route.ts"): boolean {
  return analyzeBoundaryCalls(source, approvedNames, filePath).reached;
}

// ── Transitive boundary resolution (route → _scope.ts → terminal) ────────────

/** The TERMINAL boundary primitives: the functions that ACTUALLY enforce
 *  identity/CSRF or the constant-time worker secret. A family `_scope.ts`
 *  helper reaches the boundary by (transitively) calling one of these. */
export const TERMINAL_BOUNDARY_HELPERS = [
  "authorizeRequest",             // the shared adapter (authorize.ts)
  "scopedTrustedJson",            // wraps authorizeRequest (authorize.ts)
  "resolveTrustedRequestContext", // the resolver authorizeRequest wraps
  "verifyWorkerSecret",           // worker constant-time secret boundary
  "timingSafeEqual",              // inline constant-time worker secret (node:crypto)
] as const;

// [B16.0.6 §B] Boundary RESULT CONTRACTS, keyed by exact resolved symbol +
// module provenance — never inferred from syntax or a bare name. A union-result
// boundary can be refused ONLY via an awaited binding and its `.ok` discriminant
// (its raw result is always a truthy object); a boolean/nullable boundary via a
// bare negation of the (awaited-if-async) call.
const UNION_RESULT_TERMINALS: ReadonlyArray<{ symbol: string; moduleSuffix: string }> = [
  { symbol: "authorizeRequest", moduleSuffix: "app/lib/auth/authorize.ts" },
  { symbol: "scopedTrustedJson", moduleSuffix: "app/lib/auth/authorize.ts" },
  { symbol: "resolveTrustedRequestContext", moduleSuffix: "app/lib/auth/trusted-request-context.ts" },
];
const BOOLEAN_RESULT_TERMINALS: ReadonlyArray<{ symbol: string; moduleSuffix: string }> = [
  { symbol: "timingSafeEqual", moduleSuffix: "node:crypto" },     // boolean
  { symbol: "verifyWorkerSecret", moduleSuffix: "app/lib/auth/worker-principal.ts" }, // nullable object → bare negation
];
function suffixMatch(resolvedAbsOrSpecifier: string, suffix: string): boolean {
  const norm = resolvedAbsOrSpecifier.replace(/\\/g, "/");
  return norm === suffix || norm.endsWith("/" + suffix);
}
/** The contract of a DIRECTLY-imported terminal callee, by provenance (exact
 *  resolved module + original exported symbol). */
function directTerminalContract(callee: string, detailed: Map<string, ImportBinding>, fromFile: string, rootDir: string): "union" | "boolean" | null {
  const b = detailed.get(callee);
  if (!b) return null;
  const resolved = resolveLocalModule(fromFile, b.specifier, rootDir); // null for node:/npm
  const provenance = resolved ?? b.specifier; // builtins match by specifier (e.g. node:crypto)
  for (const t of UNION_RESULT_TERMINALS) if (b.importedName === t.symbol && suffixMatch(provenance, t.moduleSuffix)) return "union";
  for (const t of BOOLEAN_RESULT_TERMINALS) if (b.importedName === t.symbol && suffixMatch(provenance, t.moduleSuffix)) return "boolean";
  return null;
}

type BoundaryContract = "union" | "boolean" | "unknown";
/** The RESULT CONTRACT of a callee that is (transitively) an authorization
 *  boundary: `union` (`{ ok }` — refuse via awaited `.ok`), `boolean` (refuse via
 *  bare negation), or `unknown` (unverifiable → the caller must fail closed).
 *  Determined by which contract TERMINAL the callee reaches, resolved by exact
 *  module provenance. Union dominates boolean when both are reachable. */
function contractFromFunctionBody(fn: ts.FunctionLikeDeclarationBase, sf: ts.SourceFile, detailed: Map<string, ImportBinding>, imported: Map<string, string>, filePath: string, rootDir: string, seen: Set<string>, depth: number): BoundaryContract {
  if (!fn.body || depth <= 0) return "unknown";
  let boolean = false;
  const calls = calleeNamesIn(fn.body);
  for (const name of calls) {
    const direct = directTerminalContract(name, detailed, filePath, rootDir);
    if (direct === "union") return "union";
    if (direct === "boolean") boolean = true;
  }
  // follow imported callees (scoped families in _scope.ts, wrappers, etc.)
  for (const name of new Set(calls)) {
    const spec = imported.get(name);
    if (!spec) continue;
    const c = contractOfImportedSymbol(name, detailed.get(name)?.importedName ?? name, spec, filePath, rootDir, seen, depth - 1);
    if (c === "union") return "union";
    if (c === "boolean") boolean = true;
  }
  return boolean ? "boolean" : "unknown";
}
function contractOfImportedSymbol(localName: string, importedName: string, specifier: string, fromFile: string, rootDir: string, seen: Set<string>, depth: number): BoundaryContract {
  if (depth <= 0) return "unknown";
  const target = resolveLocalModule(fromFile, specifier, rootDir);
  if (!target) return "unknown"; // node/npm — not a local boundary module
  const key = `${target}#${importedName}`;
  if (seen.has(key)) return "unknown";
  seen.add(key);
  const src = readFileSync(target, "utf8");
  const sf = ts.createSourceFile(target, src, ts.ScriptTarget.Latest, true, scriptKindFor(target));
  const fn = findExportedFunction(sf, importedName);
  if (!fn) return "unknown";
  return contractFromFunctionBody(fn, sf, importedBindingsDetailed(sf), importedBindings(sf), target, rootDir, seen, depth);
}
function boundaryContractOf(callee: string, sf: ts.SourceFile, imported: Map<string, string>, detailed: Map<string, ImportBinding>, filePath: string, rootDir: string): BoundaryContract {
  const direct = directTerminalContract(callee, detailed, filePath, rootDir);
  if (direct) return direct;
  const seen = new Set<string>();
  // local function (e.g. the worker route's `authorized`)
  const local = findLocalFunction(sf, callee);
  if (local) return contractFromFunctionBody(local, sf, detailed, imported, filePath, rootDir, seen, 6);
  // imported boundary (scoped family / wrapper factory)
  const spec = imported.get(callee);
  if (spec) return contractOfImportedSymbol(callee, detailed.get(callee)?.importedName ?? callee, spec, filePath, rootDir, seen, 6);
  return "unknown";
}
/** Is the initializer of an awaited-guard binding actually `await`ed? */
function guardBindingIsAwaited(stmt: ts.Statement, binding: string): boolean {
  if (!ts.isVariableStatement(stmt)) return false;
  for (const decl of stmt.declarationList.declarations) {
    if (ts.isIdentifier(decl.name) && decl.name.text === binding && decl.initializer) return ts.isAwaitExpression(decl.initializer);
  }
  return false;
}
/** Is a resolved boundary function asynchronous (so an inline `if (!f(req))`
 *  without `await` tests a truthy Promise and never refuses)? */
function calleeIsAsync(callee: string, sf: ts.SourceFile, imported: Map<string, string>, filePath: string, rootDir: string): boolean {
  const isAsyncFn = (fn: ts.FunctionLikeDeclarationBase): boolean =>
    ts.canHaveModifiers(fn) ? (ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false) : false;
  const local = findLocalFunction(sf, callee);
  if (local) return isAsyncFn(local);
  const spec = imported.get(callee);
  if (!spec) return false;
  const target = resolveLocalModule(filePath, spec, rootDir);
  if (!target) return false; // node builtin (timingSafeEqual) — sync
  const src = readFileSync(target, "utf8");
  const tsf = ts.createSourceFile(target, src, ts.ScriptTarget.Latest, true, scriptKindFor(target));
  const fn = findExportedFunction(tsf, importedBindingsDetailed(sf).get(callee)?.importedName ?? callee);
  return fn ? isAsyncFn(fn) : false;
}

/** All reachable, imported CALLS in a file: `{ name, specifier }`, regardless
 *  of an approved set — used to follow the delegation chain. */
export function reachableImportedCalls(source: string, filePath = "route.ts"): Array<{ name: string; specifier: string }> {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  const imported = importedBindings(sf);
  const localDecls = locallyDeclaredNames(sf);
  const calls: Array<{ name: string; specifier: string }> = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const specifier = imported.get(name);
      if (specifier !== undefined && !localDecls.has(name) && isReachable(node) && !seen.has(name)) {
        seen.add(name);
        calls.push({ name, specifier });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return calls;
}

/** Resolve a local module specifier to an on-disk `.ts(x)` path (or null for a
 *  bare package / node builtin). */
export function resolveLocalModule(fromFile: string, specifier: string, rootDir: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(rootDir, specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(dirname(fromFile), specifier);
  else return null; // node builtin or npm package — not a local file to follow
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Does the handler at `entryPath` reach a TERMINAL authorization boundary — a
 * direct terminal call, OR a call to a family helper defined in a `_scope.ts`
 * module that (transitively) reaches a terminal? Purely structural, bounded by
 * a `seen` set and by only following `_scope.ts` modules (where the family
 * boundary helpers live).
 */
export function reachesAuthorizationBoundary(entryPath: string, rootDir: string, seen = new Set<string>()): boolean {
  const abs = entryPath.startsWith(rootDir) ? entryPath : join(rootDir, entryPath);
  if (seen.has(abs)) return false;
  seen.add(abs);
  if (!existsSync(abs)) return false;
  const source = readFileSync(abs, "utf8");
  // A direct terminal call in this file settles it.
  if (analyzeBoundaryCalls(source, TERMINAL_BOUNDARY_HELPERS, abs).reached) return true;
  // Otherwise follow every reachable imported call into a `_scope.ts` module
  // and recurse (the family boundary helpers live there).
  for (const { specifier } of reachableImportedCalls(source, abs)) {
    const target = resolveLocalModule(abs, specifier, rootDir);
    if (target && target.replace(/\\/g, "/").endsWith("/_scope.ts")) {
      if (reachesAuthorizationBoundary(target, rootDir, seen)) return true;
    }
  }
  return false;
}

// ── B16.0.4 §A — METHOD-SCOPED, LOAD-BEARING, GUARD-FIRST analysis ────────────

/**
 * The audited route WRAPPERS from `app/lib/auth/route-handlers.ts`. An exported
 * method assigned directly from one of these (`export const POST = authenticated
 * JsonRoute(...)`) is load-bearing BY CONSTRUCTION: the wrapper runs
 * authorization (and, for authenticated/worker kinds, the bounded body read)
 * and only invokes the callback with the already-authorized context and the
 * already-bounded body — the callback structurally cannot run until the
 * boundary succeeded, and cannot reach the raw request body. */
export const APPROVED_ROUTE_WRAPPERS = [
  "authenticatedJsonRoute",
  "authenticatedRoute",
  "publicJsonRoute",
  "workerJsonRoute",
  // [B16.0.8 §B] foundation extensions — all defined in the same canonical module.
  "publicRoute",
  "workerRoute",
  "kicadLibraryRoute",
  // [B16.0.14 §B] selector-envelope authorization (CSRF-before-body; identity,
  // membership and role resolved AFTER the bounded selector is extracted).
  "selectorEnvelopeJsonRoute",
  // [B16.0.24 §E/§F] the body-scope STREAMING agent boundary (sole adopter:
  // /api/chat — gated in b16-0-24-tranche17-confinement).
  "agentStreamRoute",
] as const;

export type MethodBoundaryVerdict =
  | { ok: true; method: string; via: "wrapper" | "factory" | "guard-first"; detail: string }
  | { ok: false; method: string; reason: string };

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
const BODY_CONSUMING_APIS = ["json", "text", "arrayBuffer", "blob", "formData"] as const;
/** Callees that read request METADATA (never body/durable) or are pure — safe
 *  to run before authorization. */
const SAFE_GLOBAL_CALLEES = new Set([
  "URL", "URLSearchParams", "Number", "String", "Boolean", "JSON", "Object", "Array",
  "Math", "Date", "Set", "Map", "Response", "Headers", "structuredClone", "parseInt",
  "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "btoa", "atob", "Buffer", "TextEncoder", "TextDecoder",
]);
/** Authorization-ADJACENT primitives that are safe to run before the identity
 *  guard: CSRF/media pre-checks and BOUNDED body readers (never durable,
 *  provider, or mutation work). A route that legitimately needs the body to
 *  derive its project selector (chat, apply-authorization) reads it BOUNDED
 *  and CSRF-checked before resolving membership; the identity guard's refusal
 *  still dominates all durable/provider work. */
const SAFE_PREAUTH_PRIMITIVES = new Set([
  "requireSameOrigin", "requireJsonContentType",
  "readBoundedStream", "readBoundedBody", "readBoundedJsonBody", "readBoundedJsonObject",
  "boundedJsonRefusalResponse",
]);

interface ExportedMethod {
  method: string;
  wrapper?: string;
  /** `export const M = factory(...)` where factory is imported. */
  factory?: { name: string; specifier: string };
  fn?: ts.FunctionLikeDeclarationBase & ts.Node;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

/** Locate the exported handler for one HTTP method. */
function findExportedMethod(sf: ts.SourceFile, method: string, imported: Map<string, string>, detailed: Map<string, ImportBinding>, fromFile: string, rootDir: string): ExportedMethod | null {
  let found: ExportedMethod | null = null;
  sf.forEachChild((node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === method && hasExportModifier(node)) {
      found = { method, fn: node };
      return;
    }
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== method || !decl.initializer) continue;
        const init = decl.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) { found = { method, fn: init }; return; }
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
          const callee = init.expression.text;
          // A wrapper is trusted ONLY when resolved to the exact canonical
          // module under its REAL exported name (defeats ./evil, aliased-from-
          // evil, same-named locals, re-export laundering). A non-canonical
          // callee is treated as an opaque FACTORY and its returned closure is
          // analyzed instead (fails closed if unguarded/unresolvable).
          if (isCanonicalWrapper(callee, detailed, fromFile, rootDir)) { found = { method, wrapper: callee }; return; }
          // Follow as a factory using the ORIGINAL exported name (defeats
          // `import { evil as authenticatedJsonRoute }` — we resolve `evil`,
          // not the innocent-looking local alias).
          const binding = detailed.get(callee);
          if (binding) { found = { method, factory: { name: binding.importedName, specifier: binding.specifier } }; return; }
        }
      }
    }
  });
  return found;
}

/** The block statements of a function-like node, or null (expression body). */
function bodyStatements(fn: ts.FunctionLikeDeclarationBase): readonly ts.Statement[] | null {
  const body = fn.body;
  if (body && ts.isBlock(body)) return body.statements;
  return null;
}

/** Every callee-identifier name called anywhere in a node subtree. */
function calleeNamesIn(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) names.push(n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** The root identifier name of a (possibly chained) property access. */
function rootIdentifier(expr: ts.Expression): string | null {
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur) || ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isCallExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isNewExpression(cur)) { return ts.isIdentifier(cur.expression) ? cur.expression.text : null; } // `new TextDecoder(...)` → TextDecoder
    break;
  }
  return ts.isIdentifier(cur) ? cur.text : null;
}

/** Local function/const-arrow names whose bodies are provably PURE for the
 *  purposes of pre-auth ordering: no body read, and every call is to a
 *  boundary, a safe global/preauth primitive, request metadata, or another
 *  such local pure helper (fixpoint). e.g. a validation predicate
 *  `function object(v){ return Boolean(v) && typeof v === "object"; }`. */
/** Module-level `const X = new Set(...)/new Map(...)/[...]/{...}/literal` names —
 *  member calls on these (e.g. `ALLOWED_BODY_KEYS.has(k)`) are pure data reads,
 *  safe before authorization. */
function computeSafeDataRoots(sf: ts.SourceFile): Set<string> {
  const roots = new Set<string>();
  const pure = (raw: ts.Expression): boolean => {
    let e = raw;
    while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression; // unwrap `as const`, parens
    if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && ["Set", "Map", "WeakSet", "WeakMap"].includes(e.expression.text)) return true;
    return ts.isArrayLiteralExpression(e) || ts.isObjectLiteralExpression(e) || ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || ts.isRegularExpressionLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword;
  };
  for (const node of sf.statements) { // MODULE TOP-LEVEL only — not locals inside handlers
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && pure(d.initializer)) roots.add(d.name.text);
      }
    }
  }
  return roots;
}

const importedPureMemo = new Map<string, boolean>();

/** Find an exported function/const-arrow named `name` in a parsed module. */
function findExportedFunction(sf: ts.SourceFile, name: string): ts.FunctionLikeDeclarationBase | null {
  let fn: ts.FunctionLikeDeclarationBase | null = null;
  sf.forEachChild((node) => {
    if (fn) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && hasExportModifier(node)) fn = node;
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fn = d.initializer;
      }
    }
  });
  return fn;
}

/** Is a function body PURE — no body read, and every call resolves to a
 *  safe global/primitive, local pure helper, safe-data member, or an
 *  imported-pure callee (transitive, memoized, depth-bounded)? An opaque or
 *  unresolvable import is treated as IMPURE (default deny). */
function isFunctionPure(fn: ts.FunctionLikeDeclarationBase, sf: ts.SourceFile, filePath: string, rootDir: string, depth: number): boolean {
  const body = fn.body;
  if (!body) return false;
  const imported = importedBindings(sf);
  const safeDataRoots = computeSafeDataRoots(sf);
  const neverBoundary = (): boolean => false;
  const dangerousRoots = moduleDangerousRoots(sf, imported, safeDataRoots, neverBoundary);
  const safeLocals = computeSafeLocalCallees(sf, neverBoundary, safeDataRoots, dangerousRoots);
  const params = new Set<string>();
  for (const p of fn.parameters) if (ts.isIdentifier(p.name)) params.add(p.name.text);
  let pure = true;
  const visit = (n: ts.Node): void => {
    if (!pure) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && (BODY_CONSUMING_APIS as readonly string[]).includes(n.expression.name.text)) { pure = false; return; }
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c)) {
        const nm = c.text;
        if (!(SAFE_GLOBAL_CALLEES.has(nm) || SAFE_PREAUTH_PRIMITIVES.has(nm) || safeLocals.has(nm) || params.has(nm) || (imported.has(nm) && isImportedCalleePure(nm, imported.get(nm)!, filePath, rootDir, depth - 1)))) { pure = false; return; }
      } else if (ts.isPropertyAccessExpression(c)) {
        const root = rootIdentifier(c.expression);
        if (root !== null && dangerousRoots.has(root)) { pure = false; return; }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return pure;
}

/** Resolve an imported callee's defining module and prove its exported
 *  function is pure. Opaque/unresolvable/not-found ⇒ false (dangerous). */
function isImportedCalleePure(name: string, specifier: string, fromFile: string, rootDir: string, depth: number): boolean {
  if (depth <= 0) return false;
  const target = resolveLocalModule(fromFile, specifier, rootDir);
  if (!target) return false;
  const key = `${target}#${name}`;
  const cached = importedPureMemo.get(key);
  if (cached !== undefined) return cached;
  importedPureMemo.set(key, false); // cycle guard: assume impure while computing
  const src = readFileSync(target, "utf8");
  const sf = ts.createSourceFile(target, src, ts.ScriptTarget.Latest, true, scriptKindFor(target));
  const fn = findExportedFunction(sf, name);
  const result = fn ? isFunctionPure(fn, sf, target, rootDir, depth) : false;
  importedPureMemo.set(key, result);
  return result;
}

/** Module-level const names bound to an IMPURE value — a call or a `new` of a
 *  non-collection class (a service/durable/provider instance, e.g.
 *  `const service = new PcbSynchronizationService(...)`, `const workflow =
 *  getDurableWorkflowRepository()`). Member calls on these before auth are a
 *  durable/provider risk. */
function computeImpureModuleConsts(sf: ts.SourceFile, safeDataRoots: Set<string>): Set<string> {
  const names = new Set<string>();
  for (const node of sf.statements) { // MODULE TOP-LEVEL only — a local `const x = f()` inside a handler is data, not a service
    if (ts.isVariableStatement(node) && !node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))) {
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer || safeDataRoots.has(d.name.text)) continue;
        const e = d.initializer;
        if (ts.isCallExpression(e)) names.add(d.name.text);
        if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && !["Set", "Map", "WeakSet", "WeakMap", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "Date"].includes(e.expression.text)) names.add(d.name.text);
      }
    }
  }
  return names;
}

/** Roots whose MEMBER calls are dangerous before authorization: imported value
 *  bindings and impure module-level instances (services/durable/provider) that
 *  are not themselves boundaries or safe primitives. Member calls on local
 *  data (params, loop vars, parsed body fields) are never dangerous. */
function moduleDangerousRoots(sf: ts.SourceFile, imported: Map<string, string>, safeDataRoots: Set<string>, isBoundary: (n: string) => boolean): Set<string> {
  const roots = new Set<string>();
  for (const name of imported.keys()) if (!isBoundary(name) && !SAFE_PREAUTH_PRIMITIVES.has(name) && !SAFE_GLOBAL_CALLEES.has(name)) roots.add(name);
  for (const name of computeImpureModuleConsts(sf, safeDataRoots)) if (!isBoundary(name)) roots.add(name);
  return roots;
}

function computeSafeLocalCallees(sf: ts.SourceFile, isBoundary: (n: string) => boolean, safeDataRoots: Set<string>, dangerousRoots: Set<string>): Set<string> {
  const defs = new Map<string, ts.FunctionLikeDeclarationBase>();
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) defs.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) defs.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  ts.forEachChild(sf, collect);
  const safe = new Set<string>();
  const bodyReadsAnywhere = (node: ts.Node): boolean => {
    let hit = false;
    const v = (n: ts.Node): void => {
      if (hit) return;
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && (BODY_CONSUMING_APIS as readonly string[]).includes(n.expression.name.text)) hit = true;
      ts.forEachChild(n, v);
    };
    v(node);
    return hit;
  };
  const calleeOk = (name: string): boolean => isBoundary(name) || SAFE_GLOBAL_CALLEES.has(name) || SAFE_PREAUTH_PRIMITIVES.has(name) || safe.has(name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, fn] of defs) {
      if (safe.has(name)) continue;
      const body = fn.body;
      if (!body) continue;
      if (bodyReadsAnywhere(body)) continue;
      const params = new Set<string>();
      for (const p of fn.parameters) if (ts.isIdentifier(p.name)) params.add(p.name.text);
      let clean = true;
      const v = (n: ts.Node): void => {
        if (!clean) return;
        if (ts.isCallExpression(n)) {
          const c = n.expression;
          if (ts.isIdentifier(c)) { if (!(calleeOk(c.text) || params.has(c.text))) clean = false; }
          else if (ts.isPropertyAccessExpression(c)) {
            const root = rootIdentifier(c.expression);
            if (root !== null && dangerousRoots.has(root) && !isBoundary(root)) clean = false; // member call on a service/import
          }
        }
        ts.forEachChild(n, v);
      };
      v(body);
      if (clean) { safe.add(name); changed = true; }
    }
  }
  return safe;
}

/** The request-parameter names of a function-like node (first param + aliases
 *  introduced in its body via `const r = request`). */
function requestNames(fn: ts.FunctionLikeDeclarationBase): Set<string> {
  const names = new Set<string>();
  const p = fn.parameters[0];
  if (p && ts.isIdentifier(p.name)) names.add(p.name.text);
  const body = fn.body;
  if (body) {
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isIdentifier(n.initializer) && names.has(n.initializer.text)) names.add(n.name.text);
      ts.forEachChild(n, visit);
    };
    visit(body);
  }
  return names;
}

/** Analyze a factory's returned handler closure (the handler it returns). Reads
 *  the factory's defining module from disk. Bounded by `depth`. */
function analyzeFactoryReturn(name: string, specifier: string, fromFile: string, rootDir: string, depth: number): MethodBoundaryVerdict {
  if (depth <= 0) return { ok: false, method: name, reason: "factory-recursion-limit" };
  const target = resolveLocalModule(fromFile, specifier, rootDir);
  if (!target) return { ok: false, method: name, reason: `factory ${name} module not resolvable` };
  const src = readFileSync(target, "utf8");
  const sf = ts.createSourceFile(target, src, ts.ScriptTarget.Latest, true, scriptKindFor(target));
  const imported = importedBindings(sf);
  let factoryFn: ts.FunctionLikeDeclarationBase | null = null;
  sf.forEachChild((node) => {
    if (factoryFn) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && hasExportModifier(node)) factoryFn = node;
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) factoryFn = d.initializer;
      }
    }
  });
  if (!factoryFn) return { ok: false, method: name, reason: `factory ${name} not found in ${relative(rootDir, target).replaceAll("\\", "/")}` };
  // `factoryFn` is assigned inside the forEachChild callback above; TS's
  // control-flow analysis cannot see that mutation across the closure and
  // narrows the annotated `let` to `never` after the guard. Bind it to an
  // explicitly-typed const (the factory path is exercised by the §A factory
  // tripwires) so the property access below type-checks against the real type.
  const factory: ts.FunctionLikeDeclarationBase = factoryFn;
  // find the returned handler closure: a `return <arrow/fn>` in the factory body,
  // or a concise-body arrow `(...) => (req) => {...}`.
  let returned: (ts.FunctionLikeDeclarationBase & ts.Node) | null = null;
  const fbody = factory.body;
  if (fbody && !ts.isBlock(fbody) && (ts.isArrowFunction(fbody) || ts.isFunctionExpression(fbody))) returned = fbody;
  if (fbody && ts.isBlock(fbody)) {
    const visit = (n: ts.Node): void => {
      if (returned) return;
      if (ts.isReturnStatement(n) && n.expression && (ts.isArrowFunction(n.expression) || ts.isFunctionExpression(n.expression))) returned = n.expression;
      // do not descend into nested function bodies other than the top return
      if (!ts.isFunctionDeclaration(n) && !ts.isFunctionExpression(n) && !ts.isArrowFunction(n) || n === factory) ts.forEachChild(n, visit);
    };
    ts.forEachChild(fbody, visit);
  }
  if (!returned) return { ok: false, method: name, reason: `factory ${name} returns no analyzable handler closure` };
  const verdict = analyzeHandlerBody(returned, sf, target, rootDir, imported, depth - 1);
  return verdict.ok
    ? { ok: true, method: name, via: "factory", detail: `${name} → ${verdict.detail}` }
    : { ok: false, method: name, reason: `factory ${name}: ${verdict.reason}` };
}

/** Local names (functions or `const x = factory(...)`/`const x = arrow`) whose
 *  bodies/returns reach a terminal boundary — worker `authorized()`, factory
 *  delegates like `boardGet`. */
function localBoundaryNames(sf: ts.SourceFile, imported: Map<string, string>, filePath: string, rootDir: string, depth: number): Set<string> {
  const result = new Set<string>();
  const reachesViaCallees = (node: ts.Node): boolean => {
    for (const callee of calleeNamesIn(node)) {
      if ((TERMINAL_BOUNDARY_HELPERS as readonly string[]).includes(callee) && imported.has(callee)) return true;
      const spec = imported.get(callee);
      if (spec) { const t = resolveLocalModule(filePath, spec, rootDir); if (t && reachesAuthorizationBoundary(t, rootDir)) return true; }
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body && reachesViaCallees(node.body)) result.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body && reachesViaCallees(init.body)) result.add(node.name.text);
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
        const spec = imported.get(init.expression.text);
        if (spec && analyzeFactoryReturn(init.expression.text, spec, filePath, rootDir, depth).ok) result.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return result;
}

function isBoundaryCallee(name: string, imported: Map<string, string>, localBoundaries: Set<string>, filePath: string, rootDir: string): boolean {
  if ((TERMINAL_BOUNDARY_HELPERS as readonly string[]).includes(name) && imported.has(name)) return true;
  if (localBoundaries.has(name)) return true;
  const spec = imported.get(name);
  if (!spec) return false;
  const target = resolveLocalModule(filePath, spec, rootDir);
  return Boolean(target && reachesAuthorizationBoundary(target, rootDir));
}

/** `const <id> = await <callee>(...)` → { binding, callee } | null. */
function awaitedGuardBinding(stmt: ts.Statement): { binding: string; callee: string } | null {
  if (!ts.isVariableStatement(stmt)) return null;
  for (const decl of stmt.declarationList.declarations) {
    if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
    let expr: ts.Expression = decl.initializer;
    if (ts.isAwaitExpression(expr)) expr = expr.expression;
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return { binding: decl.name.text, callee: expr.expression.text };
  }
  return null;
}

function unwrapExpr(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
  return cur;
}

/** Does `expr` test the AUTHORIZATION TOKEN and evaluate TRUE exactly when
 *  authorization did NOT succeed (so a terminating then-branch fails closed)?
 *  `matchesToken(e)` recognizes the token: `<binding>.ok`, the bare boolean
 *  `<binding>`, or a boundary CALL `B(req)`. Accepts only the canonical
 *  negations — `!token`, `token === false`, `token !== true`. A compound
 *  (`&&`/`||`) or wrong-polarity (`token` alone, `token === true`) is REJECTED
 *  (fail closed), which is what defeats `if (authorized.ok) return …` and
 *  `if (!other.ok && authorized) …`. */
function isNegativeAuthorizationTest(expr: ts.Expression, matchesToken: (e: ts.Expression) => boolean): boolean {
  const e = unwrapExpr(expr);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    return matchesToken(unwrapExpr(e.operand)); // !token
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op !== ts.SyntaxKind.EqualsEqualsEqualsToken && op !== ts.SyntaxKind.ExclamationEqualsEqualsToken) return false; // reject && / || / other
    const left = unwrapExpr(e.left), right = unwrapExpr(e.right);
    const isFalse = (n: ts.Expression): boolean => n.kind === ts.SyntaxKind.FalseKeyword;
    const isTrue = (n: ts.Expression): boolean => n.kind === ts.SyntaxKind.TrueKeyword;
    const neg = (tok: ts.Expression, lit: ts.Expression): boolean =>
      matchesToken(tok) && ((op === ts.SyntaxKind.EqualsEqualsEqualsToken && isFalse(lit)) || (op === ts.SyntaxKind.ExclamationEqualsEqualsToken && isTrue(lit)));
    return neg(left, right) || neg(right, left);
  }
  return false;
}

/** ONLY `<binding>.ok` (a union-result discriminant). A bare `<binding>` is
 *  NOT a refusal for a union result — the object is always truthy (R1). */
function unionBindingMatcher(binding: string): (e: ts.Expression) => boolean {
  return (e: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === binding && e.name.text === "ok";
}
/** ONLY the bare boolean `<binding>` (for a genuine boolean/nullable result). */
function booleanBindingMatcher(binding: string): (e: ts.Expression) => boolean {
  return (e: ts.Expression): boolean => ts.isIdentifier(e) && e.text === binding;
}

function thenTerminates(then: ts.Statement): boolean {
  return ts.isReturnStatement(then) || ts.isThrowStatement(then) || (ts.isBlock(then) && then.statements.some((s) => ts.isReturnStatement(s) || ts.isThrowStatement(s)));
}

/** The index of the first reachable refusal `if (<matcher>) return|throw` at or
 *  after `afterIndex`, plus the if-statement; or null. */
function findRefusalGuard(stmts: readonly ts.Statement[], matcher: (e: ts.Expression) => boolean, afterIndex: number): { index: number; ifStmt: ts.IfStatement } | null {
  for (let k = afterIndex; k < stmts.length; k += 1) {
    const stmt = stmts[k]!;
    if (ts.isIfStatement(stmt) && isReachable(stmt) && isNegativeAuthorizationTest(stmt.expression, matcher) && thenTerminates(stmt.thenStatement)) return { index: k, ifStmt: stmt };
  }
  return null;
}

interface InlineBoundary { callee: string; awaited: boolean }
/** An `if (!<maybe await> B(req)…) return …` whose negated operand is a boundary
 *  CALL — returns the callee and whether it was awaited, or null. */
function inlineBoundaryInfo(stmt: ts.Statement, isBoundary: (n: string) => boolean): InlineBoundary | null {
  if (!ts.isIfStatement(stmt) || !thenTerminates(stmt.thenStatement)) return null;
  let found: InlineBoundary | null = null;
  const matchesBoundaryCall = (e: ts.Expression): boolean => {
    let inner: ts.Expression = e;
    let awaited = false;
    if (ts.isAwaitExpression(inner)) { awaited = true; inner = unwrapExpr(inner.expression); }
    inner = unwrapExpr(inner);
    if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && isBoundary(inner.expression.text)) {
      found = { callee: inner.expression.text, awaited };
      return true;
    }
    return false;
  };
  if (!isNegativeAuthorizationTest(stmt.expression, matchesBoundaryCall)) return null;
  return found;
}

/** A statement that returns a guarded delegate for its (sub)path:
 *  `return B(req)` or `if (cond) return B(req)` where B is a boundary. */
function returnsGuardedDelegate(stmt: ts.Statement, isBoundary: (n: string) => boolean): boolean {
  const checkReturn = (r: ts.Statement): boolean => {
    if (!ts.isReturnStatement(r) || !r.expression) return false;
    let e: ts.Expression = r.expression;
    if (ts.isAwaitExpression(e)) e = e.expression;
    return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && isBoundary(e.expression.text);
  };
  if (checkReturn(stmt)) return true;
  if (ts.isIfStatement(stmt)) {
    const then = stmt.thenStatement;
    if (checkReturn(then)) return true;
    if (ts.isBlock(then) && then.statements.length === 1 && checkReturn(then.statements[0]!)) return true;
  }
  return false;
}

// ── B16.0.5 §B — interprocedural REQUEST-TAINT body-read engine ───────────────
//
// The B16.0.4 detector matched only `<param>.json()` on a conventional name. It
// missed helper-forwarding, destructuring, property extraction, nested aliases,
// element access, call/apply, and clone laundering (all reproduced pre-edit).
// This engine tracks the Request through those forms, transitively into local
// and imported application helpers, and reports EVERY body read — permitting a
// read only inside the exact canonical bounded-reader authority.

/** The sanctioned body sinks: passing a Request to one of these is the ONLY
 *  approved way to consume the body. We never flag or follow these. */
const CANONICAL_BODY_READER_NAMES = new Set([
  "readBoundedStream", "readBoundedBody", "readBoundedJsonBody", "readBoundedJsonObject", "scopedTrustedJson",
]);
function isCanonicalReaderName(name: string): boolean {
  return CANONICAL_BODY_READER_NAMES.has(name) || /^readBounded/.test(name) || /^scoped[A-Za-z0-9]*Json$/.test(name);
}

interface TaintState {
  reqVals: Set<string>;                 // vars holding a Request
  bodyMethods: Set<string>;             // vars holding a bound body method (json/text/…)
  bodyStreams: Set<string>;             // vars holding `request.body`
  containers: Map<string, Set<string>>; // objVar → property names holding a tainted Request
}
function newTaint(seed: Iterable<string>): TaintState {
  return { reqVals: new Set(seed), bodyMethods: new Set(), bodyStreams: new Set(), containers: new Map() };
}

/** Does `e` evaluate to a tainted Request (identifier alias, `.clone()`, or a
 *  container property that holds one)? */
function isTaintedRequestExpr(e: ts.Expression, st: TaintState): boolean {
  const u = unwrapExpr(e);
  if (ts.isIdentifier(u)) return st.reqVals.has(u.text);
  if (ts.isAwaitExpression(u)) return isTaintedRequestExpr(u.expression, st);
  if (ts.isCallExpression(u) && ts.isPropertyAccessExpression(u.expression) && u.expression.name.text === "clone") {
    return isTaintedRequestExpr(u.expression.expression, st); // request.clone()
  }
  if (ts.isPropertyAccessExpression(u) && ts.isIdentifier(u.expression)) {
    const props = st.containers.get(u.expression.text);
    if (props?.has(u.name.text)) return true;
  }
  if (ts.isElementAccessExpression(u) && ts.isIdentifier(u.expression)) {
    const props = st.containers.get(u.expression.text);
    if (props && (props.has("[]") || (u.argumentExpression && ts.isStringLiteralLike(u.argumentExpression) && props.has(u.argumentExpression.text)))) return true;
  }
  return false;
}

/** Grow the taint sets to a fixpoint over `fn`'s declarations. */
function growTaint(fn: ts.FunctionLikeDeclarationBase, st: TaintState): void {
  const body = fn.body;
  if (!body) return;
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const init = unwrapExpr(n.initializer);
        if (ts.isIdentifier(n.name)) {
          const name = n.name.text;
          if (!st.reqVals.has(name) && isTaintedRequestExpr(init, st)) { st.reqVals.add(name); changed = true; }
          else if (ts.isPropertyAccessExpression(init) && isTaintedRequestExpr(init.expression, st)) {
            if ((BODY_CONSUMING_APIS as readonly string[]).includes(init.name.text) && !st.bodyMethods.has(name)) { st.bodyMethods.add(name); changed = true; }
            if (init.name.text === "body" && !st.bodyStreams.has(name)) { st.bodyStreams.add(name); changed = true; }
          } else if (ts.isObjectLiteralExpression(init)) {
            for (const p of init.properties) {
              if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && isTaintedRequestExpr(p.initializer, st)) {
                const set = st.containers.get(name) ?? new Set<string>();
                if (!set.has(p.name.text)) { set.add(p.name.text); st.containers.set(name, set); changed = true; }
              }
            }
          } else if (ts.isArrayLiteralExpression(init)) {
            for (const el of init.elements) if (isTaintedRequestExpr(el, st)) {
              const set = st.containers.get(name) ?? new Set<string>();
              if (!set.has("[]")) { set.add("[]"); st.containers.set(name, set); changed = true; }
            }
          }
        } else if (ts.isObjectBindingPattern(n.name) && isTaintedRequestExpr(init, st)) {
          // const { json, text, body } = request
          for (const el of n.name.elements) {
            const orig = (el.propertyName && ts.isIdentifier(el.propertyName)) ? el.propertyName.text : (ts.isIdentifier(el.name) ? el.name.text : "");
            const local = ts.isIdentifier(el.name) ? el.name.text : "";
            if (!local) continue;
            if ((BODY_CONSUMING_APIS as readonly string[]).includes(orig) && !st.bodyMethods.has(local)) { st.bodyMethods.add(local); changed = true; }
            if (orig === "body" && !st.bodyStreams.has(local)) { st.bodyStreams.add(local); changed = true; }
          }
        }
      }
      // Assignment aliases: `alias = request` (R5) and `({ json } = request)`.
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const lhs = n.left; const rhs = unwrapExpr(n.right);
        if (ts.isIdentifier(lhs)) {
          if (!st.reqVals.has(lhs.text) && isTaintedRequestExpr(rhs, st)) { st.reqVals.add(lhs.text); changed = true; }
          else if (ts.isPropertyAccessExpression(rhs) && isTaintedRequestExpr(rhs.expression, st)) {
            if ((BODY_CONSUMING_APIS as readonly string[]).includes(rhs.name.text) && !st.bodyMethods.has(lhs.text)) { st.bodyMethods.add(lhs.text); changed = true; }
            if (rhs.name.text === "body" && !st.bodyStreams.has(lhs.text)) { st.bodyStreams.add(lhs.text); changed = true; }
          }
        } else if (ts.isObjectLiteralExpression(lhs) && isTaintedRequestExpr(rhs, st)) {
          for (const p of lhs.properties) {
            let orig = "", local = "";
            if (ts.isShorthandPropertyAssignment(p)) { orig = p.name.text; local = p.name.text; }
            else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ts.isIdentifier(p.initializer)) { orig = p.name.text; local = p.initializer.text; }
            if (!local) continue;
            if ((BODY_CONSUMING_APIS as readonly string[]).includes(orig) && !st.bodyMethods.has(local)) { st.bodyMethods.add(local); changed = true; }
            if (orig === "body" && !st.bodyStreams.has(local)) { st.bodyStreams.add(local); changed = true; }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(body);
  }
}

/** The parameter name at index `i` of a function-like node, or null. */
function paramNameAt(fn: ts.FunctionLikeDeclarationBase, i: number): string | null {
  const p = fn.parameters[i];
  return p && ts.isIdentifier(p.name) ? p.name.text : null;
}

/** Find a local function/const-arrow named `name` in this file. */
function findLocalFunction(sf: ts.SourceFile, name: string): ts.FunctionLikeDeclarationBase | null {
  let fn: ts.FunctionLikeDeclarationBase | null = null;
  const visit = (node: ts.Node): void => {
    if (fn) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) fn = node;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) fn = node.initializer;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return fn;
}

/** Every body read reachable from `node` given taint `st`, following calls that
 *  forward a tainted Request into local/imported application helpers (never
 *  into a canonical bounded reader). Bounded by `depth` + `visited`. */
function bodyReadsFrom(node: ts.Node, st: TaintState, sf: ts.SourceFile, filePath: string, rootDir: string, imported: Map<string, string>, depth: number, visited: Set<string>): BodyReadUse[] {
  const uses: BodyReadUse[] = [];
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const push = (api: string, alias: string, n: ts.Node): void => { uses.push({ api, alias, line: lineOf(n) }); };

  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      // T.api() / T.body.getReader() / T.json.call() / streamVar.getReader()
      if (ts.isPropertyAccessExpression(callee)) {
        const recv = unwrapExpr(callee.expression); // unwrap `!`/parens: request.body!.getReader()
        const api = callee.name.text;
        if ((BODY_CONSUMING_APIS as readonly string[]).includes(api) && isTaintedRequestExpr(recv, st)) push(api, "request", n);
        else if (api === "getReader") {
          if (ts.isPropertyAccessExpression(recv) && recv.name.text === "body" && isTaintedRequestExpr(recv.expression, st)) push("body.getReader", "request.body", n);
          else if (ts.isIdentifier(recv) && st.bodyStreams.has(recv.text)) push("body.getReader", `${recv.text}`, n);
        } else if (api === "call" || api === "apply" || api === "bind") {
          // <bodymethod>.call(...) — bodymethod is `req.json` or a bodyMethods var
          if (ts.isPropertyAccessExpression(recv) && (BODY_CONSUMING_APIS as readonly string[]).includes(recv.name.text) && isTaintedRequestExpr(recv.expression, st)) push(recv.name.text, `request.${recv.name.text}.${api}`, n);
          else if (ts.isIdentifier(recv) && st.bodyMethods.has(recv.text)) push(`${recv.text}`, `${recv.text}.${api}`, n);
        }
      }
      // T["json"]()
      if (ts.isElementAccessExpression(callee) && callee.argumentExpression && ts.isStringLiteralLike(callee.argumentExpression) && (BODY_CONSUMING_APIS as readonly string[]).includes(callee.argumentExpression.text) && isTaintedRequestExpr(callee.expression, st)) {
        push(callee.argumentExpression.text, "request[]", n);
      }
      // bare body-method call: json()
      if (ts.isIdentifier(callee) && st.bodyMethods.has(callee.text)) push(callee.text, callee.text, n);
      // helper(taintedReq) — follow into non-canonical local/imported helpers
      if (ts.isIdentifier(callee) && !isCanonicalReaderName(callee.text)) {
        for (let i = 0; i < n.arguments.length; i += 1) {
          if (!isTaintedRequestExpr(n.arguments[i]!, st)) continue;
          followHelper(callee.text, i);
        }
      }
    }
    ts.forEachChild(n, visit);
  };

  const followHelper = (name: string, argIdx: number): void => {
    if (depth <= 0) return;
    // in-file helper
    const local = findLocalFunction(sf, name);
    if (local) {
      const pname = paramNameAt(local, argIdx);
      const key = `${filePath}#${name}#${argIdx}`;
      if (pname && !visited.has(key)) {
        visited.add(key);
        const inner = newTaint([pname]);
        growTaint(local, inner);
        if (local.body) uses.push(...bodyReadsFrom(local.body, inner, sf, filePath, rootDir, imported, depth - 1, visited));
      }
      return;
    }
    // imported local helper
    const spec = imported.get(name);
    if (!spec) return;
    const target = resolveLocalModule(filePath, spec, rootDir);
    if (!target) return;
    const key = `${target}#${name}#${argIdx}`;
    if (visited.has(key)) return;
    visited.add(key);
    const src = readFileSync(target, "utf8");
    const tsf = ts.createSourceFile(target, src, ts.ScriptTarget.Latest, true, scriptKindFor(target));
    const tfn = findExportedFunction(tsf, name) ?? findLocalFunction(tsf, name);
    if (!tfn) return;
    const pname = paramNameAt(tfn, argIdx);
    if (!pname) return;
    const inner = newTaint([pname]);
    growTaint(tfn, inner);
    const timported = importedBindings(tsf);
    if (tfn.body) uses.push(...bodyReadsFrom(tfn.body, inner, tsf, target, rootDir, timported, depth - 1, visited));
  };

  visit(node);
  return uses;
}

/** A body read within `node` given the handler's taint `st` — the api name of
 *  the FIRST read, or null. Interprocedural (in-file + imported helpers). */
function bodyReadIn(node: ts.Node, st: TaintState, sf: ts.SourceFile, filePath: string, rootDir: string, imported: Map<string, string>): string | null {
  const reads = bodyReadsFrom(node, st, sf, filePath, rootDir, imported, 4, new Set());
  return reads.length ? reads[0]!.api : null;
}

/** A call in this statement that is FORBIDDEN before authorization (a durable/
 *  provider/process/mutation call — anything not a boundary, request-metadata,
 *  or pure-global call). Returns a reason or null. */
function forbiddenPreAuthCall(stmt: ts.Statement, isBoundary: (n: string) => boolean, taint: TaintState, safeLocals: Set<string>, dangerousRoots: Set<string>, isPureImported: (name: string) => boolean, sf: ts.SourceFile, filePath: string, rootDir: string, imported: Map<string, string>): string | null {
  const body = bodyReadIn(stmt, taint, sf, filePath, rootDir, imported);
  if (body) return `body is read (${body}) before authorization`;
  let reason: string | null = null;
  const visit = (n: ts.Node): void => {
    if (reason) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee)) {
        const name = callee.text;
        if (!isBoundary(name) && !SAFE_GLOBAL_CALLEES.has(name) && !SAFE_PREAUTH_PRIMITIVES.has(name) && !safeLocals.has(name) && !isPureImported(name)) { reason = `a non-authorization call (${name}) precedes the authorization boundary`; return; }
      } else if (ts.isPropertyAccessExpression(callee)) {
        const root = rootIdentifier(callee.expression);
        const m = callee.name.text;
        // Only a member call on an IMPORTED value or an impure module-level
        // instance (a service/durable/provider object) is forbidden pre-auth;
        // string/array/metadata methods on local data are safe.
        if (root !== null && dangerousRoots.has(root) && !isBoundary(root)) { reason = `a durable/provider call (${root}.${m}) precedes the authorization boundary`; return; }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(stmt);
  return reason;
}

/** The core guard-first walk over a handler function's body. Shared by route
 *  methods and factory-returned closures. */
function analyzeHandlerBody(fn: ts.FunctionLikeDeclarationBase & ts.Node, sf: ts.SourceFile, filePath: string, rootDir: string, imported: Map<string, string>, depth: number): { ok: true; detail: string } | { ok: false; reason: string } {
  const localBoundaries = localBoundaryNames(sf, imported, filePath, rootDir, depth);
  const isBoundary = (name: string): boolean => isBoundaryCallee(name, imported, localBoundaries, filePath, rootDir) || localBoundaries.has(name);
  const safeDataRoots = computeSafeDataRoots(sf);
  const dangerousRoots = moduleDangerousRoots(sf, imported, safeDataRoots, isBoundary);
  const safeLocals = computeSafeLocalCallees(sf, isBoundary, safeDataRoots, dangerousRoots);
  const isPureImported = (name: string): boolean => { const spec = imported.get(name); return spec !== undefined && isImportedCalleePure(name, spec, filePath, rootDir, 4); };
  const detailed = importedBindingsDetailed(sf);
  const taint = newTaint(requestNames(fn));
  growTaint(fn, taint);
  const stmts = bodyStatements(fn);
  if (!stmts) {
    // expression-bodied arrow: `(req) => B(req)` delegate
    const b = fn.body;
    if (b && !ts.isBlock(b)) {
      let e: ts.Expression = b as ts.Expression;
      if (ts.isAwaitExpression(e)) e = e.expression;
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && isBoundary(e.expression.text)) return { ok: true, detail: `delegate ${e.expression.text}` };
    }
    return { ok: false, reason: "handler has no block body and is not a guarded delegate" };
  }
  let sawDelegate = false;
  // Forbidden work (durable/provider/body/mutation) anywhere inside a branch —
  // used to prove the refusal branch ONLY refuses (R2/R3) and that nothing runs
  // between the boundary binding and its refusal (R1).
  const branchForbiddenWork = (branch: ts.Statement): string | null => {
    const inner = ts.isBlock(branch) ? branch.statements : [branch];
    for (const s of inner) { const f = forbiddenPreAuthCall(s, isBoundary, taint, safeLocals, dangerousRoots, isPureImported, sf, filePath, rootDir, imported); if (f) return f; }
    return null;
  };
  for (let idx = 0; idx < stmts.length; idx += 1) {
    const stmt = stmts[idx]!;
    if (!isReachable(stmt)) continue;
    const g = awaitedGuardBinding(stmt);
    if (g && isBoundary(g.callee)) {
      const contract = boundaryContractOf(g.callee, sf, imported, detailed, filePath, rootDir);
      let matcher: ((e: ts.Expression) => boolean) | null = null;
      if (contract === "union") {
        if (!guardBindingIsAwaited(stmt, g.binding)) return { ok: false, reason: `union-result boundary ${g.callee} must be AWAITED before its .ok is checked` };
        matcher = unionBindingMatcher(g.binding);
      } else if (contract === "boolean") {
        // [R4] an async boolean boundary bound WITHOUT await is a truthy Promise.
        if (calleeIsAsync(g.callee, sf, imported, filePath, rootDir) && !guardBindingIsAwaited(stmt, g.binding)) return { ok: false, reason: `async boolean boundary ${g.callee} bound WITHOUT await — the Promise is truthy and never refuses` };
        matcher = booleanBindingMatcher(g.binding);
      } else {
        return { ok: false, reason: `boundary ${g.callee} has an UNKNOWN result contract — cannot verify its refusal (declare it in boundary metadata)` };
      }
      const refusal = findRefusalGuard(stmts, matcher, idx + 1);
      if (!refusal) return { ok: false, reason: `authorization result of ${g.callee} is IGNORED (no reachable refusal of ${g.binding})` };
      // [R1] nothing may run between the authorization and its refusal.
      for (let k = idx + 1; k < refusal.index; k += 1) { const f = forbiddenPreAuthCall(stmts[k]!, isBoundary, taint, safeLocals, dangerousRoots, isPureImported, sf, filePath, rootDir, imported); if (f) return { ok: false, reason: `work runs between authorization and its refusal: ${f}` }; }
      // [R2/R3] the refusal branch must ONLY refuse — no durable/body/provider/mutation work.
      const branchWork = branchForbiddenWork(refusal.ifStmt.thenStatement);
      if (branchWork) return { ok: false, reason: `protected work inside the refusal branch: ${branchWork}` };
      return { ok: true, detail: `${g.callee} → !${g.binding}${contract === "union" ? ".ok" : ""} refused (${contract}); dominance holds` };
    }
    const inline = inlineBoundaryInfo(stmt, isBoundary);
    if (inline) {
      const contract = boundaryContractOf(inline.callee, sf, imported, detailed, filePath, rootDir);
      if (contract === "boolean") {
        if (calleeIsAsync(inline.callee, sf, imported, filePath, rootDir) && !inline.awaited) return { ok: false, reason: `async boolean boundary ${inline.callee} used inline WITHOUT await — the Promise is truthy and never refuses` };
        // [R2/R3] the inline refusal branch must ONLY refuse.
        const branchWork = branchForbiddenWork((stmt as ts.IfStatement).thenStatement);
        if (branchWork) return { ok: false, reason: `protected work inside the refusal branch: ${branchWork}` };
        return { ok: true, detail: `inline boolean boundary ${inline.callee} returns on refusal; dominance holds` };
      }
      // A union-result (or unknown) boundary can NEVER be refused inline — its
      // raw result is always a truthy object (R1/R2 fail here).
      return { ok: false, reason: `boundary ${inline.callee} returns a ${contract} result and cannot be refused by a bare inline negation (bind it and check .ok)` };
    }
    if (returnsGuardedDelegate(stmt, isBoundary)) {
      sawDelegate = true;
      // an UNCONDITIONAL guarded-delegate return covers the remaining path.
      if (ts.isReturnStatement(stmt)) return { ok: true, detail: "unconditional guarded delegate" };
      continue;
    }
    const forbidden = forbiddenPreAuthCall(stmt, isBoundary, taint, safeLocals, dangerousRoots, isPureImported, sf, filePath, rootDir, imported);
    if (forbidden) return { ok: false, reason: forbidden };
    // metadata-only / no-call statement — safe to precede authorization.
  }
  return { ok: false, reason: sawDelegate ? "conditional delegate paths but no exhaustive authorization guard" : "handler makes no load-bearing authorization guard" };
}

/**
 * B16.0.4 §A — analyze ONE exported HTTP method for a load-bearing,
 * guard-first authorization boundary. Method-scoped (a sibling method's guard
 * never counts). Accepts the audited wrapper form, an imported handler factory
 * whose returned closure is guarded, or a guard-first handler in which no
 * body/durable/provider call runs before a boundary guard whose refusal is
 * returned/thrown (so authorization dominates and an ignored/late guard fails).
 */
export function analyzeMethodBoundary(source: string, method: string, filePath: string, rootDir: string): MethodBoundaryVerdict {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  const imported = importedBindings(sf);
  const detailed = importedBindingsDetailed(sf);
  const exported = findExportedMethod(sf, method, imported, detailed, filePath, rootDir);
  if (!exported) return { ok: false, method, reason: "exported-handler-not-found" };
  if (exported.wrapper) return { ok: true, method, via: "wrapper", detail: exported.wrapper };
  if (exported.factory) return analyzeFactoryReturn(exported.factory.name, exported.factory.specifier, filePath, rootDir, 4);
  const verdict = analyzeHandlerBody(exported.fn!, sf, filePath, rootDir, imported, 4);
  return verdict.ok ? { ok: true, method, via: "guard-first", detail: verdict.detail } : { ok: false, method, reason: verdict.reason };
}
/** Enumerate the exported HTTP methods declared in a route source. */
export function exportedHttpMethods(source: string, filePath = "route.ts"): string[] {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  const found = new Set<string>();
  sf.forEachChild((node) => {
    const hasExport = ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(node) && node.name && (HTTP_METHODS as readonly string[]).includes(node.name.text) && hasExport) found.add(node.name.text);
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && (HTTP_METHODS as readonly string[]).includes(decl.name.text)) found.add(decl.name.text);
      }
    }
  });
  return [...found];
}

// ── B16.0.7 §D — structural wrapper-adoption classification ───────────────────

export type RouteMethodForm =
  | { form: "canonical-wrapper"; wrapper: string }
  | { form: "factory"; factory: string; specifier: string }
  | { form: "raw-function" }
  | { form: "raw-arrow" }
  | { form: "not-found" };

/** Classify how one exported HTTP method is DECLARED — a canonical wrapper
 *  (resolved to `app/lib/auth/route-handlers.ts` by exact symbol), an imported
 *  factory, a raw `export function`, or a raw arrow. This is the structural
 *  signal the B16.0.7 adoption gate uses: protected/body-consuming methods must
 *  be `canonical-wrapper`. */
export function classifyRouteMethodForm(source: string, method: string, filePath: string, rootDir: string): RouteMethodForm {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  const imported = importedBindings(sf);
  const detailed = importedBindingsDetailed(sf);
  const exported = findExportedMethod(sf, method, imported, detailed, filePath, rootDir);
  if (!exported) return { form: "not-found" };
  if (exported.wrapper) return { form: "canonical-wrapper", wrapper: exported.wrapper };
  if (exported.factory) return { form: "factory", factory: exported.factory.name, specifier: exported.factory.specifier };
  const fn = exported.fn;
  if (fn && ts.isFunctionDeclaration(fn)) return { form: "raw-function" };
  return { form: "raw-arrow" };
}

// ── B16.0.4 §C — direct body-read detection ──────────────────────────────────

export interface BodyReadUse { api: string; alias: string; line: number; method?: string }

// ── B16.0.6 §C/§D — provenance-based, FAIL-CLOSED request-flow enforcement ────
//
// Security by construction: a raw Request (or its body/stream/clone/methods)
// may flow ONLY to a canonical sink resolved by exact module + exported symbol.
// A Request passed to anything else — or a flow the analyzer cannot resolve — is
// a violation. There is NO depth limit and NO name-based reader trust; a
// helper that receives the Request is itself proven safe recursively (to a fixed
// point, cycles rejected), or the flow is rejected.

/** The EXACT canonical request/body sinks, by resolved module suffix + exported
 *  symbol. Nothing is trusted by name — a local or non-canonical function with a
 *  matching name never qualifies. */
const CANONICAL_REQUEST_SINKS: ReadonlyArray<{ moduleSuffix: string; symbols: readonly string[] }> = [
  { moduleSuffix: "app/lib/http/bounded-json.ts", symbols: ["readBoundedJsonBody", "readBoundedJsonObject", "isJsonContentType"] },
  { moduleSuffix: "app/lib/http/bounded-stream.ts", symbols: ["readBoundedStream"] },
  { moduleSuffix: "app/lib/auth/authorize.ts", symbols: ["authorizeRequest", "scopedTrustedJson"] },
  { moduleSuffix: "app/lib/auth/request-security.ts", symbols: ["requireSameOrigin", "requireJsonContentType"] },
  { moduleSuffix: "app/lib/auth/trusted-request-context.ts", symbols: ["resolveTrustedRequestContext"] },
  { moduleSuffix: "app/lib/auth/route-handlers.ts", symbols: ["authenticatedJsonRoute", "authenticatedRoute", "workerJsonRoute", "publicJsonRoute", "publicRoute", "workerRoute", "kicadLibraryRoute", "selectorEnvelopeJsonRoute", "agentStreamRoute"] },
];
function resolvesToCanonicalSink(callee: string, detailed: Map<string, ImportBinding>, fromFile: string, rootDir: string): boolean {
  const b = detailed.get(callee);
  if (!b) return false; // not imported → a local/undeclared name is never canonical
  const resolved = resolveLocalModule(fromFile, b.specifier, rootDir) ?? b.specifier;
  for (const s of CANONICAL_REQUEST_SINKS) if (s.symbols.includes(b.importedName) && suffixMatch(resolved, s.moduleSuffix)) return true;
  return false;
}

/** Stream-consuming methods on `request.body` (a ReadableStream). Any of these
 *  on a tainted body stream is a violation outside the canonical reader. */
const STREAM_CONSUMING_METHODS = new Set(["getReader", "read", "tee", "pipeTo", "pipeThrough", "cancel", "values"]);

interface ConsumerRef { fn: ts.FunctionLikeDeclarationBase & ts.Node; sf: ts.SourceFile; file: string }
/** Resolve `callee` (identifier) to the function that would receive the request:
 *  a local function/arrow, a local `const x = importedFactory(...)` returned
 *  closure, or an imported function. `null` = unresolvable (fail closed). */
function resolveConsumerFunction(callee: string, sf: ts.SourceFile, detailed: Map<string, ImportBinding>, imported: Map<string, string>, filePath: string, rootDir: string): ConsumerRef | "canonical" | null {
  if (resolvesToCanonicalSink(callee, detailed, filePath, rootDir)) return "canonical";
  const local = findLocalFunction(sf, callee);
  if (local && local.body) return { fn: local as ConsumerRef["fn"], sf, file: filePath };
  // local const bound to an imported factory call → its returned closure
  let factoryClosure: ConsumerRef | null = null;
  sf.forEachChild((node) => {
    if (factoryClosure) return;
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === callee && d.initializer && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression)) {
        const facName = d.initializer.expression.text; const b = detailed.get(facName);
        if (!b) continue;
        const target = resolveLocalModule(filePath, b.specifier, rootDir);
        if (!target) continue;
        const fsf = ts.createSourceFile(target, readFileSync(target, "utf8"), ts.ScriptTarget.Latest, true, scriptKindFor(target));
        const facFn = findExportedFunction(fsf, b.importedName);
        const returned = facFn ? returnedClosureOf(facFn) : null;
        if (returned) factoryClosure = { fn: returned, sf: fsf, file: target };
      }
    }
  });
  if (factoryClosure) return factoryClosure;
  const b = detailed.get(callee);
  if (!b) return null; // undeclared / namespace member / dynamic → unresolved
  const target = resolveLocalModule(filePath, b.specifier, rootDir);
  if (!target) return null; // node/npm — cannot verify
  const tsf = ts.createSourceFile(target, readFileSync(target, "utf8"), ts.ScriptTarget.Latest, true, scriptKindFor(target));
  const fn = findExportedFunction(tsf, b.importedName) ?? findLocalFunction(tsf, b.importedName);
  return fn && fn.body ? { fn: fn as ConsumerRef["fn"], sf: tsf, file: target } : null;
}

/** Is passing a tainted Request to `callee` at `paramIndex` safe? Canonical
 *  sinks are safe by definition; any other consumer is safe ONLY if its own body
 *  consumes the tainted parameter safely (recursively). Memoized; cycles and
 *  unresolved consumers are UNSAFE (fail closed). */
function safeRequestConsumer(callee: string, sf: ts.SourceFile, detailed: Map<string, ImportBinding>, imported: Map<string, string>, filePath: string, rootDir: string, paramIndex: number, memo: Map<string, boolean>): boolean {
  const resolved = resolveConsumerFunction(callee, sf, detailed, imported, filePath, rootDir);
  if (resolved === "canonical") return true;
  if (resolved === null) return false;
  const pname = paramNameAt(resolved.fn, paramIndex);
  if (!pname) return false;
  const key = `${resolved.file}#${(resolved.fn.name && ts.isIdentifier(resolved.fn.name)) ? resolved.fn.name.text : callee}#${paramIndex}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  memo.set(key, false); // cycle → unsafe
  const safe = requestFlowViolations(resolved.fn, resolved.sf, resolved.file, rootDir, new Set([pname]), memo).length === 0;
  memo.set(key, safe);
  return safe;
}

/** Every way `fn` lets its tainted request parameters reach the body, escape, or
 *  flow to a non-canonical consumer. Empty ⇒ the function consumes the request
 *  safely. Unresolvable flow ⇒ a violation (never silently clean). */
function requestFlowViolations(fn: ts.FunctionLikeDeclarationBase & ts.Node, sf: ts.SourceFile, filePath: string, rootDir: string, taintedParams: Set<string>, memo: Map<string, boolean>): BodyReadUse[] {
  const detailed = importedBindingsDetailed(sf);
  const imported = importedBindings(sf);
  const st = newTaint(taintedParams);
  growTaint(fn, st);
  const out: BodyReadUse[] = [];
  const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const flag = (reason: string, n: ts.Node): void => { out.push({ api: "flow-violation", alias: reason, line: at(n) }); };
  const body = fn.body;
  if (!body) return out;

  // A tainted-request identifier is permitted ONLY as: the object of a
  // property/element access (metadata), a call/new ARGUMENT (checked below), or
  // the RHS of a simple identifier alias. Anything else — an object/array
  // literal element, a property write, an aggregate return, a for-of source — is
  // a confinement escape (R5–R11).
  // A `request` identifier is a VALUE reference only when it is not a property
  // name, a declaration/binding name, an object-literal key, or an import
  // specifier — `body.request` / `{ request: … }` / `request: Request` are NOT
  // uses of the request parameter.
  const isRequestValueReference = (node: ts.Identifier): boolean => {
    const p = node.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === node) return false;
    if (ts.isQualifiedName(p) && p.right === node) return false;
    if ((ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isBindingElement(p)) && (p as { name?: ts.Node }).name === node) return false;
    if (ts.isBindingElement(p) && p.propertyName === node) return false;
    if ((ts.isPropertyAssignment(p) || ts.isPropertyAccessExpression(p)) && (p as { name?: ts.Node }).name === node) return false;
    if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p)) return false;
    return true;
  };
  const allowedRequestIdentifierContext = (node: ts.Identifier): boolean => {
    let cur: ts.Node = node;
    let parent = cur.parent;
    while (parent && (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent) || ts.isAsExpression(parent) || ts.isAwaitExpression(parent))) { cur = parent; parent = parent.parent; }
    if (!parent) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === cur) return true;
    if (ts.isElementAccessExpression(parent) && parent.expression === cur) return true;
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && (parent.arguments?.some((a) => a === cur) ?? false)) return true;
    if (ts.isVariableDeclaration(parent) && parent.initializer === cur) return true;
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === cur && ts.isIdentifier(parent.left)) return true;
    return false;
  };
  /** Shared handling of call/new arguments that carry request/stream/method. */
  const checkArgs = (callee: ts.Expression, args: readonly ts.Expression[], site: ts.Node): void => {
    for (let i = 0; i < args.length; i += 1) {
      const a = unwrapExpr(args[i]!);
      if (isTaintedRequestExpr(a, st)) {
        if (ts.isIdentifier(callee)) {
          if (!safeRequestConsumer(callee.text, sf, detailed, imported, filePath, rootDir, i, memo)) flag(`Request passed to non-canonical consumer ${callee.text}(arg ${i})`, site);
        } else flag(`Request passed to an unresolved/dynamic callee`, site);
      } else if ((ts.isPropertyAccessExpression(a) && a.name.text === "body" && isTaintedRequestExpr(a.expression, st)) || (ts.isIdentifier(a) && st.bodyStreams.has(a.text))) {
        if (!(ts.isIdentifier(callee) && resolvesToCanonicalSink(callee.text, detailed, filePath, rootDir))) flag(`request body stream passed to a non-canonical consumer`, site);
      } else if (ts.isIdentifier(a) && st.bodyMethods.has(a.text)) {
        flag(`request body method passed as an argument`, site);
      }
    }
  };

  const visit = (n: ts.Node): void => {
    // [R5–R11] a tainted request VALUE reference in a disallowed position.
    if (ts.isIdentifier(n) && st.reqVals.has(n.text) && isRequestValueReference(n) && !allowedRequestIdentifierContext(n)) flag(`Request used in a disallowed position (aggregate/container/store/escape)`, n);
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const recv = unwrapExpr(callee.expression);
        const api = callee.name.text;
        if ((BODY_CONSUMING_APIS as readonly string[]).includes(api) && isTaintedRequestExpr(recv, st)) flag(`request body consumed via .${api}()`, n);
        else if (STREAM_CONSUMING_METHODS.has(api)) {
          if (ts.isPropertyAccessExpression(recv) && recv.name.text === "body" && isTaintedRequestExpr(recv.expression, st)) flag(`request body stream consumed via .body.${api}()`, n);
          else if (ts.isIdentifier(recv) && st.bodyStreams.has(recv.text)) flag(`request body stream consumed via ${recv.text}.${api}()`, n);
        } else if (api === "call" || api === "apply" || api === "bind") {
          if (ts.isPropertyAccessExpression(recv) && (BODY_CONSUMING_APIS as readonly string[]).includes(recv.name.text) && isTaintedRequestExpr(recv.expression, st)) flag(`request body consumed via .${recv.name.text}.${api}()`, n);
          else if (ts.isIdentifier(recv) && st.bodyMethods.has(recv.text)) flag(`request body method invoked via ${recv.text}.${api}()`, n);
        }
      }
      if (ts.isElementAccessExpression(callee) && callee.argumentExpression && ts.isStringLiteralLike(callee.argumentExpression) && (BODY_CONSUMING_APIS as readonly string[]).includes(callee.argumentExpression.text) && isTaintedRequestExpr(callee.expression, st)) flag(`request body consumed via ["${callee.argumentExpression.text}"]()`, n);
      if (ts.isIdentifier(callee) && st.bodyMethods.has(callee.text)) flag(`request body method ${callee.text}() invoked`, n);
      checkArgs(callee, n.arguments, n);
    }
    // [R7] a constructor consuming request / body stream (e.g. new Response(request.body)).
    if (ts.isNewExpression(n) && n.arguments) checkArgs(n.expression, n.arguments, n);
    // [R8] a for-of / for-await over the request body stream or the request.
    if (ts.isForOfStatement(n)) {
      const e = unwrapExpr(n.expression);
      if (isTaintedRequestExpr(e, st) || (ts.isPropertyAccessExpression(e) && e.name.text === "body" && isTaintedRequestExpr(e.expression, st)) || (ts.isIdentifier(e) && st.bodyStreams.has(e.text))) flag(`request/body iterated (for-of/for-await)`, n);
    }
    if (ts.isReturnStatement(n) && n.expression) {
      const e = unwrapExpr(n.expression);
      if (isTaintedRequestExpr(e, st)) flag(`Request returned (escapes the consumer)`, n);
      else if (ts.isPropertyAccessExpression(e) && e.name.text === "body" && isTaintedRequestExpr(e.expression, st)) flag(`request body stream returned`, n);
      else if (ts.isIdentifier(e) && (st.bodyStreams.has(e.text) || st.bodyMethods.has(e.text))) flag(`request body value returned`, n);
    }
    // [R10/R11] a property write storing the request (store.request = request).
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && !ts.isIdentifier(n.left) && isTaintedRequestExpr(unwrapExpr(n.right), st)) flag(`Request stored to a property (${n.left.getText().slice(0, 40)})`, n);
    if (ts.isSpreadElement(n) && isTaintedRequestExpr(n.expression, st)) flag(`Request spread — unresolved flow`, n);
    ts.forEachChild(n, visit);
  };
  visit(body);
  return out;
}

/** [B16.0.6 §C/§D] The §C gate surface: every fail-closed request-flow violation
 *  in a route's exported handlers (including a followed handler factory). Empty
 *  ⇒ the route consumes the body only through the canonical authority. */
export function directBodyReads(source: string, filePath = "route.ts", rootDir = process.cwd()): BodyReadUse[] {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(filePath));
  const imported = importedBindings(sf);
  const detailed = importedBindingsDetailed(sf);
  const uses: BodyReadUse[] = [];
  const memo = new Map<string, boolean>();
  for (const method of exportedHttpMethods(source, filePath)) {
    const exported = findExportedMethod(sf, method, imported, detailed, filePath, rootDir);
    if (!exported) continue;
    let ref: ConsumerRef | null = null;
    if (exported.fn) ref = { fn: exported.fn, sf, file: filePath };
    else if (exported.factory) {
      const target = resolveLocalModule(filePath, exported.factory.specifier, rootDir);
      if (target) {
        const fsf = ts.createSourceFile(target, readFileSync(target, "utf8"), ts.ScriptTarget.Latest, true, scriptKindFor(target));
        const facFn = findExportedFunction(fsf, exported.factory.name);
        const returned = facFn ? returnedClosureOf(facFn) : null;
        if (returned) ref = { fn: returned, sf: fsf, file: target };
        else { uses.push({ api: "flow-violation", alias: `unresolved handler factory ${exported.factory.name}`, line: 0, method }); continue; }
      } else { uses.push({ api: "flow-violation", alias: `unresolved handler factory module for ${exported.factory.name}`, line: 0, method }); continue; }
    }
    // wrapper methods consume the body only inside the canonical reader.
    if (!ref) continue;
    const pname = paramNameAt(ref.fn, 0);
    if (!pname) continue; // no request parameter → no body flow
    for (const u of requestFlowViolations(ref.fn, ref.sf, ref.file, rootDir, new Set([pname]), memo)) uses.push({ ...u, method });
  }
  return uses;
}

/** The handler closure a factory returns (a `return <arrow/fn>` or a
 *  concise-body arrow that returns one). */
function returnedClosureOf(factoryFn: ts.FunctionLikeDeclarationBase): (ts.FunctionLikeDeclarationBase & ts.Node) | null {
  const fbody = factoryFn.body;
  if (!fbody) return null;
  if (!ts.isBlock(fbody) && (ts.isArrowFunction(fbody) || ts.isFunctionExpression(fbody))) return fbody;
  let returned: (ts.FunctionLikeDeclarationBase & ts.Node) | null = null;
  if (ts.isBlock(fbody)) {
    const visit = (n: ts.Node): void => {
      if (returned) return;
      if (ts.isReturnStatement(n) && n.expression && (ts.isArrowFunction(n.expression) || ts.isFunctionExpression(n.expression))) returned = n.expression;
      if (!ts.isFunctionDeclaration(n) && !ts.isFunctionExpression(n) && !ts.isArrowFunction(n)) ts.forEachChild(n, visit);
    };
    ts.forEachChild(fbody, visit);
  }
  return returned;
}
