/**
 * [B23-A2] A structural no-order route check (D23-12), beside B19-E's name check. B19-E reads each `route.ts` file's own text for
 * `/placeOrder|checkout|addToCart|purchaseOrder/` (b19-e-no-purchase-tripwire.test.ts:168, :302-307), so a route that delegates to a
 * handler module, or names its operation `submitOrder`, passes it. Here: no route policy row is `spend` (and the gate refuses one
 * whatever its shape), and no route's runtime import closure - delegated handler modules included - reaches a module that declares
 * or calls an order, purchase or checkout port. B19-E's tripwire stays as it is.
 *
 * [B23-A2 review] A port is any NAME a reached module declares or calls, not only a top-level export: a module-private function, a
 * class member, an object-literal property and a called property chain (a vendor client's `orders.create(...)`) are ports too. A
 * name check still cannot see a neutrally named function that posts to an order endpoint; that egress is the classification's
 * `observation-query` (b23-a-route-vocabulary), a stated limit here.
 *
 * Nothing is written to disk; no route is called.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { allRoutePolicies, policyFor, routeVocabularyViolations } from "@/app/lib/auth/route-policy";
import { listRouteFiles, routePathOf } from "@/app/lib/auth/route-tree";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
/** B19-E's route check, verbatim (b19-e-no-purchase-tripwire.test.ts:168). */
const B19E_ORDER_OPERATIONS = /placeOrder|checkout|addToCart|purchaseOrder/;

/** The words of an identifier: camelCase, PascalCase, snake_case and SCREAMING_CASE, lower-cased. */
function identifierWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter((word) => word !== "").map((word) => word.toLowerCase());
}
const ORDER_VERBS = new Set(["place", "submit", "create", "confirm", "send", "make", "new", "pay", "purchase", "cancel"]);
const CART_VERBS = new Set(["add", "fill", "populate", "submit", "create", "checkout"]);
/** An exported binding that names an order, purchase, checkout, cart-fill or payment operation (a port that could spend). */
function isOrderPortName(name: string): boolean {
  const words = identifierWords(name);
  if (words.some((word) => /^purchas/.test(word) || word === "checkout" || word === "payment" || word === "payments" || word === "pay" || word === "buy")) return true;
  if (words.some((word) => word === "order" || word === "orders") && words.some((word) => ORDER_VERBS.has(word))) return true;
  if (words.some((word) => word === "cart") && words.some((word) => CART_VERBS.has(word))) return true;
  return false;
}
/** [B23-A2] Reviewed: modules whose exports read like the vocabulary but are no port, one reason each. Each is reached by no route today. */
/** [B23-A2 review] + the look-alikes the declared-name scan finds in route closures (`reached`: a route's closure holds the module). */
const NOT_A_PORT: Readonly<Record<string, { readonly names: readonly string[]; readonly reason: string; readonly reached: boolean }>> = {
  "app/lib/kicad/pinned-checkout.ts": { names: ["PinnedCheckoutError", "ensurePinnedCheckout"], reason: "a git checkout of the pinned KiCad library sources; no commerce", reached: false },
  "app/lib/release-engineering/governance.ts": { names: ["placePurchaseOrder"], reason: "the CD-12 refusing stub: it only throws its literal (b23-a-cd12-stubs)", reached: false },
  "app/lib/distributors/lifecycle.ts": { names: ["last_time_buy"], reason: "a component lifecycle status (a last-time-buy notice) and its rank; a status word, never an operation", reached: true },
  "app/lib/risk-scoring.ts": { names: ["last_time_buy"], reason: "the lifecycle status's risk weight (a last-time-buy notice); a status word, never an operation", reached: true },
  "app/lib/bom/build.ts": { names: ["last_time_buy"], reason: "the BOM summary's count of last-time-buy lifecycle notices; a status word, never an operation", reached: true },
  "app/lib/component-selection/sourcing.ts": { names: ["buyUnits"], reason: "the units an offline sourcing scenario would need (minimum order and multiple applied): a number, never an operation", reached: true },
  "app/api/release-engineering/propose/route.ts": { names: ["hasExternalOrPurchasingSideEffects"], reason: "the CD-12 propose answer's statement that it has no external or purchasing side effect (b23-a-cd12-stubs case 3 pins it false)", reached: true },
};

/**
 * [B23-A2 review security-4, coverage-3, tests-4] Every runtime name a module DECLARES or CALLS, at any depth: functions and classes
 * (exported or module-private, and a named function expression), variables, class members (methods, properties, accessors),
 * object-literal properties (shorthand included), export-list names (the local name of an aliased one too), and each called
 * property chain joined (`client.orders.create(...)` reads `client_orders_create`). Types are no port: interfaces, type aliases
 * and type annotations are skipped. (A2 read top-level exported names only, so a class method, an object property, a private
 * helper and an anonymous default export calling a vendor client were invisible.)
 * [B23-A2 lead, 2026-10-02] And every runtime IMPORT binding (named - the imported name and its local alias -, default, namespace and
 * `import x = require(...)`; a type-only import is no port), every DESTRUCTURED binding (its local name and the property it reads, in
 * a variable or a parameter), a call through a SINGLE part (`createOrder(lines)`, `this.placeOrder(lines)`), a string-keyed member
 * joined into its chain (`client["placeOrder"](...)` reads `client_placeOrder`), and each constructed chain (`new sdk.CheckoutSession()`
 * reads `sdk_CheckoutSession`): a vendor SDK's order function imported by name from a package and called directly, or destructured from
 * a client, was invisible (the independent check of the review fixes).
 */
function declaredNames(path: string, source: string): string[] {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names = new Set<string>();
  const nameOf = (name: ts.Node | undefined): void => {
    if (name !== undefined && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name))) names.add(name.text.replace(/^#/, ""));
  };
  const chainOf = (expression: ts.Expression): string[] | null => {
    if (ts.isIdentifier(expression)) return [expression.text];
    if (ts.isPropertyAccessExpression(expression)) {
      const head = chainOf(expression.expression);
      return [...(head ?? []), expression.name.text];
    }
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) return [...(chainOf(expression.expression) ?? []), expression.argumentExpression.text]; // [B23-A2 lead, 2026-10-02] a string key is a member name
    if (ts.isCallExpression(expression) || ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression)) return chainOf(expression.expression);
    if (expression.kind === ts.SyntaxKind.ThisKeyword) return [];
    return null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isImportDeclaration(node)) { // [B23-A2 lead, 2026-10-02] a runtime import binding is a name too; a type-only one is none
      const clause = node.importClause;
      if (clause !== undefined && !clause.isTypeOnly) {
        nameOf(clause.name);
        const bindings = clause.namedBindings;
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) nameOf(bindings.name);
        if (bindings !== undefined && ts.isNamedImports(bindings)) for (const element of bindings.elements) if (!element.isTypeOnly) { nameOf(element.name); nameOf(element.propertyName); }
      }
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) { if (!node.isTypeOnly) nameOf(node.name); return; } // [B23-A2 lead, 2026-10-02]
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) nameOf(node.name);
    else if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) nameOf(node.name);
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) nameOf(node.name);
    else if (ts.isBindingElement(node)) { if (ts.isIdentifier(node.name)) nameOf(node.name); nameOf(node.propertyName); } // [B23-A2 lead, 2026-10-02] a destructured binding and the property it reads
    else if (ts.isExportSpecifier(node) && !node.isTypeOnly) { nameOf(node.name); nameOf(node.propertyName); }
    else if (ts.isCallExpression(node) || ts.isNewExpression(node)) { // [B23-A2 lead, 2026-10-02] + a construction
      const chain = chainOf(node.expression);
      if (chain !== null && chain.length > 0) names.add(chain.join("_")); // [B23-A2 lead, 2026-10-02] a single-part call too (was > 1)
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return [...names];
}

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
/** The runtime import closure of one entry, each file with the chain that first reaches it (importClosure's order and edges). */
function closureOf(files: FileMap, entry: string): Map<string, readonly string[]> {
  const chains = new Map<string, readonly string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const target of edgesOf(files, file)) {
      if (chains.has(target)) continue;
      chains.set(target, [...chains.get(file)!, target]);
      queue.push(target);
    }
  }
  return chains;
}

const routeEntries = listRouteFiles(ROOT).map((file) => ({ path: routePathOf(ROOT, file), file: relative(ROOT, file).split("\\").join("/") }));
const portCache = new WeakMap<FileMap, Map<string, string[]>>();
/** Every route whose runtime import closure reaches a module exporting an order port (reviewed look-alikes aside), with the chain. */
async function orderPortReach(files: FileMap, routes: ReadonlyArray<{ path: string; file: string }>): Promise<string[]> {
  const found: string[] = [];
  let ports = portCache.get(files);
  if (ports === undefined) {
    ports = new Map();
    portCache.set(files, ports);
  }
  for (const { path, file } of routes) {
    for (const [member, chain] of closureOf(files, file)) {
      let named = ports.get(member);
      if (named === undefined) {
        named = declaredNames(member, files.get(member)!).filter((name) => isOrderPortName(name) && !(NOT_A_PORT[member]?.names.includes(name) ?? false));
        ports.set(member, named);
      }
      for (const port of named) found.push(`${path}: ${port} (${chain.join(" -> ")})`);
    }
    await new Promise((resolve) => setImmediate(resolve)); // yield between walks (lead lesson 3)
  }
  return found;
}
let production: FileMap | null = null;
const productionFiles = (): FileMap => (production ??= collectProductionFiles(ROOT));

describe("[B23-A2] the structural no-order route check (D23-12)", () => {
  it("1. no route policy row is spend: every row carries spend: false, and the gate refuses a spend row whatever its shape - human-only, CSRF and project administrators included", () => {
    const policies = allRoutePolicies();
    expect(policies.length).toBe(168); // [B24-A1, 2026-10-06] reviewed census move (OD-198), was 166: + GET /api/health and GET /api/ready, neither spend; [B23-B1, 2026-10-03] reviewed census move (OD-174), was 165: + POST /api/pcb/provider-exchange, a transfer row that is not spend
    expect(policies.filter((policy) => policy.spend !== false).map((policy) => `${policy.method} ${policy.path}`)).toEqual([]);
    const release = policyFor("/api/pcb/release", "POST")!;
    expect(routeVocabularyViolations([{ ...release, releaseOrQualification: false, spend: true }])).toEqual(["POST /api/pcb/release: spend_in_b23"]);
    expect(routeVocabularyViolations(policies.map((policy) => (policy.path === "/api/bom/cart/digikey" ? { ...policy, spend: true } : policy)))).toEqual([
      "POST /api/bom/cart/digikey: spend_in_b23", "POST /api/bom/cart/digikey: public", "POST /api/bom/cart/digikey: not_human_session",
      "POST /api/bom/cart/digikey: no_csrf", "POST /api/bom/cart/digikey: any_member",
    ]);
  });

  it("2. no route's runtime import closure - delegated handler modules included - reaches a module that declares or calls an order, purchase or checkout port; the walk is importClosure's", { timeout: 120_000 }, async () => {
    const files = productionFiles();
    expect(routeEntries.length).toBeGreaterThan(140);
    expect(await orderPortReach(files, routeEntries)).toEqual([]);
    for (const path of ["/api/bom/cart/digikey", "/api/release-engineering/propose", "/api/pcb/release", "/api/chat"]) {
      const file = routeEntries.find((entry) => entry.path === path)!.file;
      expect([...closureOf(files, file).keys()].sort(), path).toEqual([...importClosure(files, [file]).keys()].sort());
    }
  });

  it("3. the check bites where B19-E's cannot: a route whose route.ts names only a helper, the helper delegating to a module that declares submitOrder, passes B19-E's text check and is caught here, with its chain; so are the other port names and a port re-exported under another name", async () => {
    const files = productionFiles();
    const routeText = 'import { handle } from "./handler";\nexport const POST = (request: Request) => handle(request);\n';
    expect(B19E_ORDER_OPERATIONS.test(routeText)).toBe(false);
    for (const port of ["submitOrder", "createOrder", "placePurchaseOrder", "checkout", "startCheckout", "addToCart", "fillCart", "confirmPayment", "buyParts", "PLACE_ORDER"]) {
      const injected = new Map(files);
      injected.set("app/api/b23-probe/route.ts", routeText);
      injected.set("app/api/b23-probe/handler.ts", 'import { send } from "@/app/lib/b23-probe/vendor";\nexport const handle = (request: Request) => send(request);\n');
      injected.set("app/lib/b23-probe/vendor.ts", `export async function ${port}(lines: unknown) { return lines; }\nexport const send = (value: unknown) => ${port}(value);\n`);
      expect(await orderPortReach(injected, [{ path: "/api/b23-probe", file: "app/api/b23-probe/route.ts" }]), port).toEqual([
        `/api/b23-probe: ${port} (app/api/b23-probe/route.ts -> app/api/b23-probe/handler.ts -> app/lib/b23-probe/vendor.ts)`,
      ]);
    }
    const reexport = new Map(files);
    reexport.set("app/api/b23-probe/route.ts", 'export { forward as POST } from "@/app/lib/b23-probe/vendor";\n');
    reexport.set("app/lib/b23-probe/vendor.ts", "const submitOrder = async () => null;\nexport { submitOrder as forward };\n");
    expect(B19E_ORDER_OPERATIONS.test(reexport.get("app/api/b23-probe/route.ts")!)).toBe(false);
    expect(await orderPortReach(reexport, [{ path: "/api/b23-probe", file: "app/api/b23-probe/route.ts" }])).toEqual(["/api/b23-probe: submitOrder (app/api/b23-probe/route.ts -> app/lib/b23-probe/vendor.ts)"]);
  });

  it("3b. [B23-A2 review] the shapes a vendor client takes are ports too, each behind a delegating handler B19-E cannot see: a class method, an object-literal property (and its shorthand), a module-private function wrapped by a neutral export, an anonymous default export calling an SDK's order chain, and a called client chain; [B23-A2 lead, 2026-10-02] and a function imported by name from a package (called, handed on or renamed), a destructured binding (called, or renamed and handed on), a call through a single identifier (a parameter, an inherited method on this), a string-keyed call and a constructed namespace class", async () => {
    const files = productionFiles();
    const routeText = 'import { handle } from "./handler";\nexport const POST = (request: Request) => handle(request);\n';
    const probes: Array<[string, string, string]> = [
      ["a class method", "export class VendorClient { async placeOrder(lines: unknown) { return lines; } }\nexport const send = (value: unknown) => new VendorClient().placeOrder(value);\n", "placeOrder"],
      ["an object property", "export const vendor = { submitOrder: async (lines: unknown) => lines };\nexport const send = (value: unknown) => vendor.submitOrder(value);\n", "submitOrder"],
      ["an object shorthand", "const createOrder = async (lines: unknown) => lines;\nexport const vendor = { createOrder };\nexport const send = (value: unknown) => vendor.createOrder(value);\n", "createOrder"],
      ["a module-private function", "async function submitOrder(lines: unknown) { return lines; }\nexport const send = (value: unknown) => submitOrder(value);\n", "submitOrder"],
      ["an anonymous default export", "declare const client: { orders: { create(lines: unknown): unknown } };\nexport default async function (lines: unknown) { return client.orders.create(lines); }\nexport const send = (value: unknown) => value;\n", "client_orders_create"],
      ["a called checkout chain", "declare const sdk: { checkout: { sessions: { create(lines: unknown): unknown } } };\nexport const send = (value: unknown) => sdk.checkout.sessions.create(value);\n", "sdk_checkout_sessions_create"],
      // [B23-A2 lead, 2026-10-02] the independent check's scenarios: an import binding, a destructured binding and a call through a
      // single identifier were invisible (the scan returned at every import declaration, named a variable only when its name is an
      // identifier, and recorded a call only when its chain had more than one part). The first two probes are the check's own
      // cases; each later one is seen by one new rule alone (an import, a binding element, a single-part call, a string key, `new`).
      ["a function imported by name from a package, called directly", 'import { createOrder } from "vendor-sdk";\nexport const send = (value: unknown) => createOrder(value);\n', "createOrder"],
      ["a destructured binding from a package client, called", 'import { makeVendorClient } from "vendor-sdk";\nconst { placeOrder } = makeVendorClient();\nexport const send = (value: unknown) => placeOrder(value);\n', "placeOrder"],
      ["an imported binding handed on, never called", 'import { placeOrder } from "vendor-sdk";\nexport const handlers = [placeOrder];\nexport const send = (value: unknown) => value;\n', "placeOrder"],
      ["a renamed import", 'import { submitOrder as forward } from "vendor-sdk";\nexport const send = (value: unknown) => forward(value);\n', "submitOrder"],
      ["a renamed destructured binding, handed on", 'import { makeVendorClient } from "vendor-sdk";\nconst { submitOrder: go } = makeVendorClient();\nexport const handlers = [go];\nexport const send = (value: unknown) => value;\n', "submitOrder"],
      ["a single-identifier call of a parameter", "export const makeSend = (confirmPayment: (value: unknown) => unknown) => (value: unknown) => confirmPayment(value);\nexport const send = makeSend((value) => value);\n", "confirmPayment"],
      ["an inherited method called on this", 'import { VendorBase } from "vendor-sdk";\nexport class Vendor extends VendorBase { forward(value: unknown) { return this.placeOrder(value); } }\nexport const send = (value: unknown) => new Vendor().forward(value);\n', "placeOrder"],
      ["a string-keyed call", 'declare const client: Record<string, (value: unknown) => unknown>;\nexport const send = (value: unknown) => client["placeOrder"](value);\n', "client_placeOrder"],
      ["a class constructed from a namespace import", 'import * as sdk from "vendor-sdk";\nexport const send = (value: unknown) => new sdk.CheckoutSession(value);\n', "sdk_CheckoutSession"],
    ];
    const missed: string[] = []; // [B23-A2 lead, 2026-10-02] every probe is judged, so a red run names each shape the scan misses
    for (const [label, vendor, port] of probes) {
      const injected = new Map(files);
      injected.set("app/api/b23-probe/route.ts", routeText);
      injected.set("app/api/b23-probe/handler.ts", 'import { send } from "@/app/lib/b23-probe/vendor";\nexport const handle = (request: Request) => send(request);\n');
      injected.set("app/lib/b23-probe/vendor.ts", vendor);
      expect(B19E_ORDER_OPERATIONS.test(routeText) || B19E_ORDER_OPERATIONS.test(injected.get("app/api/b23-probe/handler.ts")!), label).toBe(false);
      const reach = await orderPortReach(injected, [{ path: "/api/b23-probe", file: "app/api/b23-probe/route.ts" }]);
      if (!reach.includes(`/api/b23-probe: ${port} (app/api/b23-probe/route.ts -> app/api/b23-probe/handler.ts -> app/lib/b23-probe/vendor.ts)`)) missed.push(`${label}: ${port} not in [${reach.join("; ")}]`);
    }
    expect(missed, "every vendor-client shape is a port").toEqual([]);
  });

  it("4. precision: the vocabulary's look-alikes are not ports (a sort order, an order-by, a publication request, a cart CSV), and each reviewed look-alike module declares exactly its names and is reached by a route exactly as recorded", { timeout: 120_000 }, async () => {
    for (const name of ["sortOrder", "orderBy", "LAYER_ORDER", "reorder", "border", "submitAtomicPublicationRequest", "toDigiKeyCsv", "cartFormats", "CART_COLUMNS", "quoteText", "renderOrderSummary", "submitted", "payload", "display"]) expect(isOrderPortName(name), name).toBe(false);
    for (const name of ["placeOrder", "place_order", "submitOrder", "createOrders", "cancelOrder", "purchaseOrder", "purchase", "checkout", "addToCart", "payment", "payInvoice", "buyNow", "PLACE_ORDER"]) expect(isOrderPortName(name), name).toBe(true);
    const files = productionFiles();
    const reached = new Set<string>();
    for (const { file } of routeEntries) {
      for (const member of closureOf(files, file).keys()) reached.add(member);
      await new Promise((resolve) => setImmediate(resolve));
    }
    for (const [module, reviewed] of Object.entries(NOT_A_PORT)) {
      expect(declaredNames(module, files.get(module)!).filter(isOrderPortName).sort(), module).toEqual([...reviewed.names].sort());
      expect(reviewed.reason.length, module).toBeGreaterThan(20);
      expect(reached.has(module), `${module} reached by a route`).toBe(reviewed.reached);
    }
  });

  it("5. B19-E's name check stays as it is: its pattern and its route walk are unchanged", () => {
    const tripwire = read("app/lib/engineering/__tests__/b19-e-no-purchase-tripwire.test.ts");
    expect(tripwire).toContain("const ORDER_OPERATIONS = /placeOrder|checkout|addToCart|purchaseOrder/;");
    expect(tripwire).toContain("expect(routes.filter((file) => ORDER_OPERATIONS.test(readFileSync(join(cwd, file), \"utf8\")))).toEqual([]);");
  });
});
