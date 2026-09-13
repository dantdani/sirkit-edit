/**
 * [B19-E E1] Nothing in Sirkit reads as, or acts as, buying parts.
 *
 * The BOM workbench builds distributor import FILES and a sourcing worksheet; it never places an order, never fills a
 * vendor cart and never opens or navigates to a vendor's upload page on the person's behalf (the person clicks a link).
 * These tripwires read the source as it is:
 *  1. no control label, title, aria-label or UI copy uses purchase wording (every production .tsx under app/ and
 *     components/);
 *  2. no production source opens or navigates to a distributor upload page (any open(...), location.assign / replace,
 *     location.href =, or a programmatic click on a link with an href or target);
 *  3. no API route implements an order, checkout or cart operation;
 *  4. the distributor import and sourcing worksheet routes price from the cache only: they never pass `live` (pricing
 *     options are absent or a literal), never import the outbound fetch boundary or a distributor client ([B19-E E2 review]
 *     the shared admitted clients and the external candidate search included).
 * Each checker is also run against a reintroduced violation, so a tripwire that stops biting fails here too.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { listControlSurfaceFiles, scanControlSites } from "../control-surface";
import { DISTRIBUTOR_UPLOAD_URLS } from "@/app/lib/distributor-links";

const cwd = process.cwd();
const PURCHASE_WORDING = /add to cart|checkout|\bbuy\b|place (an )?order|purchase order|order now|project cart|populate your cart/i;
/** "Last Time Buy" is a manufacturer lifecycle status (LTB), not an action; it is the one phrase read past. */
const LIFECYCLE_TERM = /\blast[- ]time[- ]buy\b/gi;
const hasPurchaseWording = (text: string): boolean => PURCHASE_WORDING.test(text.replace(LIFECYCLE_TERM, ""));

function sourceFile(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** Every piece of copy a source can show: string and template literals, JSX text and literal JSX attribute values. */
export function copyStrings(name: string, text: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return; // module paths are not copy
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    else if (ts.isJsxText(node)) {
      const jsx = node.text.replace(/\s+/g, " ").trim();
      if (jsx) out.push(jsx);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(name, text));
  return out;
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
}

/** Production sources: the app, the shared lib and the shared components (tests excluded). */
function productionSources(): string[] {
  const files: string[] = [];
  for (const root of ["app", "lib", "components"]) walk(join(cwd, root), files);
  return files.map((file) => relative(cwd, file).split(sep).join("/")).sort();
}

const UPLOAD_URLS = Object.values(DISTRIBUTOR_UPLOAD_URLS);

function calleeName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${calleeName(expression.expression)}.${expression.name.text}`;
  if (ts.isElementAccessExpression(expression)) return `${calleeName(expression.expression)}[]`;
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isAsExpression(expression)) return calleeName(expression.expression);
  return "?";
}

/** [B19-E E1-C review] any callee named open: window.open, globalThis.window.open, an alias's .open, or a bare open(...) */
const OPENS = /(^|\.)open$/;
const NAVIGATES = /(^|\.)location\.(assign|replace)$/;
const NAVIGATION_TARGET = /(^|\.)location(\.href)?$/;
/** [B19-E E1-C review] a programmatic click on an element */
const CLICKS = /^(.+)\.(click|dispatchEvent)$/;

/** Is `value` a blob URL made here: URL.createObjectURL(...) itself, or a const initialised with it in an enclosing block? */
function isObjectUrl(value: ts.Expression): boolean {
  const created = (expression: ts.Expression | undefined): boolean => !!expression && ts.isCallExpression(expression) && calleeName(expression.expression) === "URL.createObjectURL";
  if (created(value)) return true;
  if (!ts.isIdentifier(value)) return false;
  for (let at: ts.Node | undefined = value.parent; at; at = at.parent) {
    if (!ts.isBlock(at) && !ts.isSourceFile(at)) continue;
    for (const statement of at.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === value.text) return (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 && created(declaration.initializer);
      }
    }
  }
  return false;
}

/**
 * [B19-E E1-C review] Elements that would navigate when clicked: one whose `target` is assigned, or whose `href` is assigned
 * anything but a blob URL made here (`a.href = …`, `a.setAttribute("href", …)`, or a JSX `ref` on an element with `href` or
 * `target`). Keyed by the element expression; the value is the navigation's target text.
 */
function navigatingElements(source: ts.SourceFile): Map<string, string> {
  const elements = new Map<string, string>();
  const add = (element: string, attribute: string, value: ts.Expression | undefined): void => {
    if (attribute === "href" && value && isObjectUrl(value)) return;
    if (attribute !== "href" && attribute !== "target") return;
    elements.set(element, `${elements.get(element) ?? ""}${value ? value.getText(source) : ""},`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
      add(calleeName(node.left.expression), node.left.name.text, node.right);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "setAttribute" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      add(calleeName(node.expression.expression), node.arguments[0].text, node.arguments[1]);
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const ref = attributes.find((attribute) => ts.isIdentifier(attribute.name) && attribute.name.text === "ref");
      const refName = ref?.initializer && ts.isJsxExpression(ref.initializer) && ref.initializer.expression ? calleeName(ref.initializer.expression) : null;
      if (refName) {
        for (const attribute of attributes) {
          if (!ts.isIdentifier(attribute.name)) continue;
          const value = attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer : undefined;
          add(`${refName}.current`, attribute.name.text, value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return elements;
}

/**
 * Programmatic navigation that reaches a distributor upload page: a navigation whose target names DISTRIBUTOR_UPLOAD_URLS
 * or an upload URL, or ANY programmatic navigation in a file that refers to them (a value can travel through a variable).
 * [B19-E E1-C review] Navigation includes any `open` callee and a programmatic click on an element that would navigate.
 */
export function uploadNavigations(name: string, text: string): string[] {
  const refersToUploads = text.includes("DISTRIBUTOR_UPLOAD_URLS") || UPLOAD_URLS.some((url) => text.includes(url));
  // a flag needs the file, or the navigation's target (text within the file), to name an upload URL: nothing else can hit
  if (!refersToUploads) return [];
  const source = sourceFile(name, text);
  const navigating = navigatingElements(source);
  const out: string[] = [];
  const flag = (node: ts.Node, what: string, target: string): void => {
    const direct = target.includes("DISTRIBUTOR_UPLOAD_URLS") || UPLOAD_URLS.some((url) => target.includes(url));
    if (direct || refersToUploads) out.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${what}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression);
      const click = CLICKS.exec(callee);
      if (OPENS.test(callee) || NAVIGATES.test(callee)) flag(node, callee, node.arguments.map((arg) => arg.getText(source)).join(","));
      else if (click && navigating.has(click[1]!)) flag(node, `${callee}() on an element with href or target`, navigating.get(click[1]!)!);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && NAVIGATION_TARGET.test(calleeName(node.left))) {
      flag(node, `${calleeName(node.left)} =`, node.right.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const ORDER_OPERATIONS = /placeOrder|checkout|addToCart|purchaseOrder/;

function apiRoutes(): string[] {
  const files: string[] = [];
  walk(join(cwd, "app/api"), files);
  return files.map((file) => relative(cwd, file).split(sep).join("/")).filter((file) => /\/route\.ts$/.test(file)).sort();
}

/** [B19-E E2 review] the shared admitted clients and the external candidate search reach vendors as surely as a connector does */
const VENDOR_MODULE = /(^|\/)distributors\/(digikey|octopart|mouser|lcsc|egress|clients)(\.ts)?$|(^|\/)net\/outbound-fetch(\.ts)?$|(^|\/)acquisition\/external-search(\.ts)?$/;

/** [B19-E E1-C review] the builders whose third argument carries the pricing options (`live`) */
const PRICING_BUILDERS = new Set(["buildBomRows", "getPricingFor", "buildBom"]);

/**
 * A cache-only export route: no `live` pricing flag, no outbound fetch, no distributor client import (static or dynamic).
 * [B19-E E1-C review] Every pricing builder call (an import alias included) passes no third argument, or an object literal
 * with no spread (a `live` property in it is flagged below); pricing options from a variable or the request body are found.
 */
export function liveVendorReach(name: string, text: string): string[] {
  const source = sourceFile(name, text);
  const out: string[] = [];
  const at = (node: ts.Node, what: string): void => { out.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${what}`); };
  const builders = new Set(PRICING_BUILDERS);
  const aliases = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && node.propertyName && PRICING_BUILDERS.has(node.propertyName.text)) builders.add(node.name.text);
    ts.forEachChild(node, aliases);
  };
  aliases(source);
  const pricingCall = (node: ts.CallExpression): void => {
    const callee = calleeName(node.expression);
    if (!builders.has(callee.slice(callee.lastIndexOf(".") + 1))) return;
    if (node.arguments.some(ts.isSpreadElement)) return at(node, `${callee} with spread arguments`);
    const options = node.arguments[2];
    if (!options) return;
    if (!ts.isObjectLiteralExpression(options)) return at(node, `${callee} third argument is not an object literal: ${options.getText(source)}`);
    if (options.properties.some(ts.isSpreadAssignment)) at(node, `${callee} third argument spreads: ${options.getText(source)}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) pricingCall(node);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && VENDOR_MODULE.test(node.moduleSpecifier.text)) at(node, `imports ${node.moduleSpecifier.text}`);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && VENDOR_MODULE.test(node.arguments[0].text)) at(node, `imports ${node.arguments[0].text}`);
    if (ts.isIdentifier(node) && node.text === "outboundFetch") at(node, "names outboundFetch");
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === "live" && node.initializer.kind !== ts.SyntaxKind.FalseKeyword) at(node, `passes live: ${node.initializer.getText(source)}`);
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "live") at(node, "passes live");
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** The UI sources the wording scans read. [B19-E E1-C review] Every production .tsx under app/ and components/ (route pages
 *  included, tests excluded), plus the control surfaces. */
function wordingScanFiles(): string[] {
  const tsx = productionSources().filter((file) => file.endsWith(".tsx") && /^(app|components)\//.test(file));
  return [...new Set([...tsx, ...listControlSurfaceFiles(cwd)])].sort();
}

/** Every piece of purchase wording in these files' copy; `read` is injectable so a reintroduced violation can be checked. */
function purchaseWordingHits(files: readonly string[], read: (file: string) => string = (file) => readFileSync(join(cwd, file), "utf8")): string[] {
  const hits: string[] = [];
  for (const file of files) {
    for (const text of copyStrings(file, read(file))) if (hasPurchaseWording(text)) hits.push(`${file}: ${text}`);
  }
  return hits;
}

describe("[B19-E E1] no purchase wording on any control or in UI copy", () => {
  it("no scanned control's label (test id, aria-label, title or text) uses purchase wording", () => {
    const sites = scanControlSites(cwd, wordingScanFiles());
    expect(sites.length).toBeGreaterThan(400);
    expect(sites.filter((site) => hasPurchaseWording(site.label)).map((site) => site.key)).toEqual([]);
  });

  it("no UI surface's copy (menu labels, banners, titles, aria-labels) uses purchase wording", () => {
    expect(purchaseWordingHits(wordingScanFiles())).toEqual([]);
  });

  it("[B19-E E1-C review] the scans cover every production .tsx under app/ and components/, route pages included; a route page's purchase copy is found", () => {
    const files = wordingScanFiles();
    const tsx = productionSources().filter((file) => file.endsWith(".tsx") && /^(app|components)\//.test(file));
    expect(tsx).toEqual(expect.arrayContaining(["app/component-selection/page.tsx", "components/ui/button.tsx", "app/components/bom/BomView.tsx"]));
    expect(files).toEqual(expect.arrayContaining(tsx));
    const page = "app/component-selection/page.tsx";
    const reintroduced = (file: string): string => readFileSync(join(cwd, file), "utf8") + (file === page ? '\nexport const Reintroduced = () => <button onClick={() => undefined}>Buy parts</button>;\n' : "");
    expect(purchaseWordingHits(files, reintroduced)).toEqual([`${page}: Buy parts`]);
  });

  it("the checker bites: reintroduced cart and order wording is found; the lifecycle status name is not", () => {
    const flagged = (text: string): boolean => copyStrings("x.tsx", text).some(hasPurchaseWording);
    expect(flagged('const L = { mouser: "Mouser Project Cart" };')).toBe(true);
    expect(flagged("const m = `Upload the file there to populate your cart.`;")).toBe(true);
    expect(flagged('export const B = () => <button title="Place order">Go</button>;')).toBe(true);
    expect(flagged("export const B = () => <button>Buy now</button>;")).toBe(true);
    expect(flagged('export const B = () => <a aria-label="Add to cart" href="#">+</a>;')).toBe(true);
    expect(flagged('const tip = "LTB — Last Time Buy; the manufacturer has announced the final date it accepts orders";')).toBe(false);
    expect(flagged('const m = "No order was placed.";')).toBe(false);
  });
});

describe("[B19-E E1] nothing opens or navigates to a distributor upload page", () => {
  it("no production source opens or navigates to a DISTRIBUTOR_UPLOAD_URLS value", () => {
    const hits = productionSources().flatMap((file) => uploadNavigations(file, readFileSync(join(cwd, file), "utf8")));
    expect(hits).toEqual([]);
  });

  it("the checker bites: every navigation form, direct or through a variable, is found", () => {
    expect(uploadNavigations("a.tsx", 'window.open(DISTRIBUTOR_UPLOAD_URLS[dist], "_blank", "noopener,noreferrer");')).toHaveLength(1);
    expect(uploadNavigations("b.ts", `location.assign("${DISTRIBUTOR_UPLOAD_URLS.mouser}");`)).toHaveLength(1);
    expect(uploadNavigations("c.ts", `window.location.replace("${DISTRIBUTOR_UPLOAD_URLS.lcsc}");`)).toHaveLength(1);
    expect(uploadNavigations("d.ts", "const u = DISTRIBUTOR_UPLOAD_URLS.digikey; window.location.href = u;")).toHaveLength(1);
    expect(uploadNavigations("e.ts", "import { DISTRIBUTOR_UPLOAD_URLS as U } from 'x'; const t = U.digikey; globalThis.open(t);")).toHaveLength(1);
    expect(uploadNavigations("f.ts", "const t = DISTRIBUTOR_UPLOAD_URLS.digikey; window.location = t as never;")).toHaveLength(1);
    // precision: navigation elsewhere, and a plain link the person clicks, are not flagged
    expect(uploadNavigations("g.tsx", 'window.location.assign("/");')).toEqual([]);
    expect(uploadNavigations("h.tsx", "const href = safeHref(DISTRIBUTOR_UPLOAD_URLS.digikey, 'page'); export const L = () => <a href={href} target=\"_blank\" rel=\"noopener noreferrer\">Open</a>;")).toEqual([]);
  });

  it("[B19-E E1-C review] the checker bites: a script-built or ref'd link click, a bare open() and any callee ending in .open are found", () => {
    const refers = 'import { DISTRIBUTOR_UPLOAD_URLS } from "@/app/lib/distributor-links";\n';
    expect(uploadNavigations("i.tsx", `${refers}const a = document.createElement("a"); a.href = DISTRIBUTOR_UPLOAD_URLS.digikey; a.target = "_blank"; a.rel = "noopener noreferrer"; document.body.appendChild(a); a.click();`)).toHaveLength(1);
    expect(uploadNavigations("j.tsx", `${refers}function go(uploadHref: string) { const a = document.createElement("a"); a.href = uploadHref; a.click(); }`)).toHaveLength(1);
    expect(uploadNavigations("k.tsx", `${refers}const a = document.createElement("a"); a.setAttribute("href", u); a.dispatchEvent(new MouseEvent("click"));`)).toHaveLength(1);
    expect(uploadNavigations("l.tsx", `${refers}const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.target = "_blank"; a.click();`)).toHaveLength(1);
    expect(uploadNavigations("m.tsx", `${refers}export function L() { const ref = useRef<HTMLAnchorElement>(null); useEffect(() => { ref.current?.click(); }, []); return <a ref={ref} href={DISTRIBUTOR_UPLOAD_URLS.lcsc} target="_blank">Open</a>; }`)).toHaveLength(1);
    expect(uploadNavigations("n.ts", "open(DISTRIBUTOR_UPLOAD_URLS.lcsc);")).toHaveLength(1);
    expect(uploadNavigations("o.ts", "const t = DISTRIBUTOR_UPLOAD_URLS.mouser; globalThis.window.open(t);")).toHaveLength(1);
    expect(uploadNavigations("p.ts", `const w = window; w.open("${DISTRIBUTOR_UPLOAD_URLS.digikey}");`)).toHaveLength(1);
    // precision: the file download the view makes (a blob URL, no target) is not navigation, nor is a click on a plain element
    expect(uploadNavigations("q.tsx", `${refers}function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }`)).toEqual([]);
    expect(uploadNavigations("r.tsx", `${refers}const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.click();`)).toEqual([]);
    expect(uploadNavigations("s.tsx", `${refers}buttonRef.current?.click();`)).toEqual([]);
  });
});

describe("[B19-E E1] no API route implements an order", () => {
  it("no app/api/**/route.ts names an order, checkout or cart operation", () => {
    const routes = apiRoutes();
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.filter((file) => ORDER_OPERATIONS.test(readFileSync(join(cwd, file), "utf8")))).toEqual([]);
  });

  it("the checker bites", () => {
    for (const text of ["export async function placeOrder() {}", "await vendor.checkout(cart);", "addToCart(sku)", "const purchaseOrder = {};"]) expect(ORDER_OPERATIONS.test(text), text).toBe(true);
  });
});

describe("[B19-E E1] the distributor import and sourcing worksheet routes are cache-only", () => {
  const exportRoutes = (): string[] => {
    const cartDir = join(cwd, "app/api/bom/cart");
    const carts = readdirSync(cartDir).filter((entry) => statSync(join(cartDir, entry)).isDirectory()).map((entry) => `app/api/bom/cart/${entry}/route.ts`);
    return [...carts, "app/api/bom/procurement-packet/route.ts"];
  };

  it("every cart route and the worksheet route exists and never passes live, fetches out or imports a distributor client", () => {
    const routes = exportRoutes();
    expect(routes).toEqual(expect.arrayContaining(["app/api/bom/cart/digikey/route.ts", "app/api/bom/cart/mouser/route.ts", "app/api/bom/cart/lcsc/route.ts", "app/api/bom/procurement-packet/route.ts"]));
    for (const file of routes) expect(existsSync(join(cwd, file)), file).toBe(true);
    expect(routes.flatMap((file) => liveVendorReach(file, readFileSync(join(cwd, file), "utf8")))).toEqual([]);
  });

  it("the checker bites: live pricing, outbound fetch and distributor clients are found", () => {
    expect(liveVendorReach("r.ts", "await buildBomRows(state, choice, { live: true });")).toHaveLength(1);
    expect(liveVendorReach("r.ts", "const live = granted; await buildBomRows(state, choice, { live });")).toHaveLength(1);
    expect(liveVendorReach("r.ts", 'import { outboundFetch } from "@/app/lib/net/outbound-fetch";')).toHaveLength(2);
    expect(liveVendorReach("r.ts", 'import { DigiKeyClient } from "@/app/lib/distributors/digikey";')).toHaveLength(1);
    expect(liveVendorReach("r.ts", 'const m = await import("../../../lib/distributors/mouser");')).toHaveLength(1);
    expect(liveVendorReach("r.ts", 'import { vendorRequest } from "@/app/lib/distributors/egress";')).toHaveLength(1);
    expect(liveVendorReach("r.ts", 'import { toDigiKeyCsv } from "@/app/lib/cart-formats"; await buildBomRows(state, choice, { live: false });')).toEqual([]);
  });

  it("[B19-E E2 review] the checker bites: the shared admitted clients and the external candidate search are vendor reach too", () => {
    expect(liveVendorReach("r.ts", 'import { admittedDistributorClient } from "@/app/lib/distributors/clients";')).toHaveLength(1);
    expect(liveVendorReach("r.ts", 'const { admittedDistributorClient } = await import("../../../lib/distributors/clients.ts");')).toHaveLength(1);
    expect(liveVendorReach("r.ts", 'import { searchExternalCandidates } from "@/app/lib/acquisition/external-search"; await searchExternalCandidates(query, opts);')).toHaveLength(1);
    expect(liveVendorReach("r.ts", 'export { searchExternalCandidates } from "../../../lib/acquisition/external-search";')).toHaveLength(1);
    // precision: the browser-safe contract reaches no vendor
    expect(liveVendorReach("r.ts", 'import { EXTERNAL_SEARCH_MAX_LIMIT } from "@/app/lib/acquisition/external-search-contract";')).toEqual([]);
  });

  it("[B19-E E1-C review] the checker bites: pricing options that are not a literal without live (the request body, a variable, a spread, an alias) are found", () => {
    expect(liveVendorReach("r.ts", "await buildBomRows(stateCheck.state, normalizeChoice(body.pricingChoice), body.pricing ?? {});")).toHaveLength(1);
    expect(liveVendorReach("r.ts", "const options = await pricingOptions(); await getPricingFor(parts, choice, options);")).toHaveLength(1);
    expect(liveVendorReach("r.ts", "await buildBomRows(state, choice, { forceRefresh: false, ...body.pricing });")).toHaveLength(1);
    expect(liveVendorReach("r.ts", 'import { buildBomRows as build } from "@/app/lib/bom-builder"; await build(state, choice, body.pricing);')).toHaveLength(1);
    expect(liveVendorReach("r.ts", "await bomBuilder.buildBomRows(state, choice, opts);")).toHaveLength(1);
    expect(liveVendorReach("r.ts", "await buildBomRows(...args);")).toHaveLength(1);
    // precision: no third argument, or a literal one without live
    expect(liveVendorReach("r.ts", "await buildBomRows(stateCheck.state, normalizeChoice(body.pricingChoice));")).toEqual([]);
    expect(liveVendorReach("r.ts", "await getPricingFor(parts, choice, { forceRefresh: false });")).toEqual([]);
  });
});
