/**
 * [B24-D3] THE ACCESSIBLE-NAME RULE over B17-A's control sites (D24-32; OD-215 "a B17-A accessible-name rule").
 *
 * It takes B17-A's sites as `scanControlSites` finds them (control-surface.ts; `DEFAULT_CONTROL_ROOTS`) and re-parses each surface
 * with the same TypeScript API, recomputing every node's B17 key (`surface|kind|element|label|handler[#n]`) with the same label
 * order and the exported `summarizeHandler`. The recomputed key multiset must equal B17-A's exactly (b24-d3-accessible-names case
 * 1), and the join is on the key: B17-A records the attribute's line only and sorts its sites by key, so (surface, line, kind,
 * element) is not unique (AssignmentQueuePanel.tsx holds two `<button type="button" onClick=…>` on one line, twice).
 *
 * Every site gets exactly one closed status:
 *   named:<source>   aria-labelledby | aria-label | label-wrap (an ancestor <label>) | label-for (an id a htmlFor in the same file
 *                    names) | text (a literal, expression or sr-only child) | title | palette-title | forwarded (a call site of a
 *                    component in NAME_FORWARDING, whose own JSX forwards the prop - read by AST);
 *   exempt:<reason>  dialog-titled (a shared Dialog whose DialogContent holds a DialogTitle) | form-submit (a form whose submit control
 *                    is named by a listed source) | listener (a shortcut or gesture listener) | click-shield (B17's
 *                    internal.stop-propagation) | backdrop (BACKDROP_EXEMPTIONS: a pointer-only dismiss that a named, keyboard-
 *                    reachable control also closes; the reason names it) | canvas-gesture (inside a canvas declared non-accessible,
 *                    CANVAS_HOSTS; the reason names the Go-to alternative);
 *   unnamed          no source: a placeholder, data-testid, name or id is never a name (detail `placeholder-only` where it applies).
 *
 * The census covers HANDLER sites only (B17-A records the attributes of CONTROL_EVENT_ATTRIBUTES): a focusable control with no
 * handler - a submit button, a link, an icon-only button with no onClick - is outside it (accessibility.md section 2, the 4.1.2 row).
 *
 * Node-only (fs access). Imported only by its suite (b24-d3-accessible-names) and its generator (scripts/generate-b24-accessible-
 * names.ts); case 9 proves it with importClosure. It edits nothing: control-surface.ts and control-registry.ts are unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { PCB_CANVAS_STATEMENT, SCHEMATIC_CANVAS_STATEMENT } from "../accessibility/statements";
import { CONTROL_EVENT_ATTRIBUTES, listControlSurfaceFiles, summarizeHandler, type ControlKind } from "./control-surface";

// ─── the closed vocabularies ─────────────────────────────────────────────────

export const NAME_SOURCES = Object.freeze(["aria-labelledby", "aria-label", "label-wrap", "label-for", "text", "title", "palette-title", "forwarded"] as const);
export type NameSource = (typeof NAME_SOURCES)[number];
export const EXEMPT_REASONS = Object.freeze(["dialog-titled", "form-submit", "listener", "click-shield", "backdrop", "canvas-gesture"] as const);
export type ExemptReason = (typeof EXEMPT_REASONS)[number];
export type AccessibleNameStatus = `named:${NameSource}` | `exempt:${ExemptReason}` | "unnamed";

// ─── the scope (OD-215's surfaces) ───────────────────────────────────────────

export type ScopeGroup = "chat" | "approval dialogs" | "side panels" | "B23";
/** A region of one file: the body of one named function, or one JSX element picked by its tag and one fact about it. */
export type ScopeRegion =
  | { readonly kind: "function"; readonly name: string }
  | { readonly kind: "element"; readonly tag: string; readonly classIncludes?: string; readonly holdsTestId?: string; readonly holdsTitle?: string };
export interface ScopeEntry {
  readonly group: ScopeGroup;
  readonly surface: string;
  /** null: the whole file. */
  readonly region: ScopeRegion | null;
}

const PCB = "app/components/pcb/";
const PAGE = "app/page.tsx";
const whole = (group: ScopeGroup, surface: string): ScopeEntry => Object.freeze({ group, surface, region: null });
const inPage = (group: ScopeGroup, region: ScopeRegion): ScopeEntry => Object.freeze({ group, surface: PAGE, region: Object.freeze(region) });

/** OD-215's surfaces, closed: the chat, the approval dialogs, the side panels and B23's panels. A change is a reviewed pin move
 *  (accessibility.md section 1 lists exactly these, b24-d3-accessible-names case 10). */
export const ACCESSIBILITY_SCOPE: readonly ScopeEntry[] = Object.freeze([
  whole("chat", "app/components/chat/AutonomyModeControl.tsx"),
  whole("chat", "app/components/chat/ChatMarkdown.tsx"),
  whole("chat", "app/components/chat/ExecutionEntryActions.tsx"), whole("chat", "app/components/chat/GenerationTaskStatus.tsx"), // [PR-L, 2026-10-17] reviewed scope move (runbook L.4): the durable design task's status card (Stop design, Pause / Resume design, Retry block, Start again) in its activity entry, appended in place
  inPage("chat", { kind: "element", tag: "aside", classIncludes: "sirkit-chat-panel" }),
  inPage("chat", { kind: "function", name: "MessageBubble" }),
  whole("approval dialogs", `${PCB}GrantedExecutionDialog.tsx`),
  whole("approval dialogs", `${PCB}PcbProposalReviewDialog.tsx`),
  whole("approval dialogs", `${PCB}BoardRevisionDialog.tsx`),
  whole("approval dialogs", `${PCB}SnapshotConflictDialog.tsx`),
  whole("approval dialogs", "app/components/schematic/ReplacementReviewDialog.tsx"),
  inPage("approval dialogs", { kind: "element", tag: "Dialog", holdsTestId: "schematic-proposal-review" }),
  inPage("approval dialogs", { kind: "element", tag: "Dialog", holdsTitle: "AI edit proposal — review before applying" }),
  inPage("side panels", { kind: "element", tag: "aside", classIncludes: "border-r border-zinc-800" }),
  whole("side panels", `${PCB}AssignmentQueuePanel.tsx`),
  whole("side panels", `${PCB}BoardRepairPanel.tsx`),
  whole("side panels", `${PCB}ComponentReviewPanel.tsx`),
  whole("side panels", `${PCB}DrcPanel.tsx`),
  whole("side panels", `${PCB}LayerPanel.tsx`),
  whole("side panels", `${PCB}ManufacturingWorkflowPanel.tsx`),
  whole("side panels", `${PCB}MappingVerificationPanel.tsx`),
  whole("side panels", `${PCB}PadstackPanel.tsx`),
  whole("side panels", `${PCB}PassivePackagePolicyPanel.tsx`),
  whole("side panels", `${PCB}PcbSyncReadinessPanel.tsx`),
  whole("side panels", `${PCB}RoutingRulesPanel.tsx`),
  whole("side panels", "app/components/parts/AtomicPublicationReviewPanel.tsx"),
  whole("side panels", "app/components/editor/BuildLibraryPanel.tsx"),
  whole("B23", `${PCB}ProviderExchangePanel.tsx`),
  whole("B23", `${PCB}ProviderObservationList.tsx`),
]);

function describeRegion(entry: ScopeEntry): string {
  const region = entry.region;
  if (region === null) return `\`${entry.surface}\` (the whole file)`;
  if (region.kind === "function") return `\`${entry.surface}\`, inside \`function ${region.name}\``;
  if (region.classIncludes !== undefined) return `\`${entry.surface}\`, inside the \`<${region.tag}>\` whose class names \`${region.classIncludes}\``;
  if (region.holdsTestId !== undefined) return `\`${entry.surface}\`, inside the \`<${region.tag}>\` holding \`data-testid="${region.holdsTestId}"\``;
  return `\`${entry.surface}\`, inside the \`<${region.tag}>\` titled "${region.holdsTitle ?? ""}"`;
}

/** The scope as the page lists it, one line per entry, in order. */
export function renderScopeList(): string[] {
  return ACCESSIBILITY_SCOPE.map((entry) => `- ${entry.group}: ${describeRegion(entry)}`);
}

// ─── the closed exemption and forwarding lists ───────────────────────────────

export interface NameForwarding {
  /** The file that defines the component and holds its call sites. */
  readonly surface: string;
  readonly component: string;
  readonly prop: string;
  /** What the component's own JSX does with the prop on its handler-bearing element (read by AST, `nameForwardingProblems`). */
  readonly forwardsTo: "aria-label" | "title" | "text";
}
export const NAME_FORWARDING: readonly NameForwarding[] = Object.freeze([
  Object.freeze({ surface: PAGE, component: "ActivityBarButton", prop: "label", forwardsTo: "aria-label" as const }),
  Object.freeze({ surface: PAGE, component: "ViewTab", prop: "label", forwardsTo: "text" as const }),
  Object.freeze({ surface: "app/components/bom/BomView.tsx", component: "KindToggle", prop: "label", forwardsTo: "text" as const }),
]);

export interface BackdropExemption {
  /** The B17 key of the backdrop's click site. */
  readonly key: string;
  /** The accessible name of the named, keyboard-reachable button that also closes the overlay (in the same file; accname order). */
  readonly closedBy: string;
}
export const BACKDROP_EXEMPTIONS: readonly BackdropExemption[] = Object.freeze([
  Object.freeze({ key: "app/page.tsx|click|div|(none)|setMoreMenuOpen", closedBy: "More checks" }),
]);

export interface CanvasHost {
  readonly surface: string;
  readonly tag: string;
  /** The attribute that picks the host element: [name, literal value or `{expression}` text]. */
  readonly pick: readonly [string, string];
  /** The statement constant (accessibility/statements.ts) its aria-label carries, by name or as its literal value. */
  readonly statement: "SCHEMATIC_CANVAS_STATEMENT" | "PCB_CANVAS_STATEMENT";
  /** The keyboard alternative: the Go to component field. */
  readonly goTo: { readonly surface: string; readonly testId: string; readonly name: string };
}
export const CANVAS_HOSTS: readonly CanvasHost[] = Object.freeze([
  Object.freeze({ surface: PAGE, tag: "svg", pick: Object.freeze(["data-testid", "schematic-canvas"] as const), statement: "SCHEMATIC_CANVAS_STATEMENT" as const, goTo: Object.freeze({ surface: PAGE, testId: "schematic-goto-input", name: "Go to component" }) }),
  Object.freeze({ surface: `${PCB}PcbCanvas.tsx`, tag: "div", pick: Object.freeze(["ref", "{hostRef}"] as const), statement: "PCB_CANVAS_STATEMENT" as const, goTo: Object.freeze({ surface: `${PCB}PcbToolbar.tsx`, testId: "pcb-goto-input", name: "Go to component" }) }),
]);
const STATEMENT_VALUES: Readonly<Record<CanvasHost["statement"], string>> = Object.freeze({ SCHEMATIC_CANVAS_STATEMENT, PCB_CANVAS_STATEMENT });

// ─── B17-A's key, recomputed (control-surface.ts's label order and handler summary; nothing there is edited) ─────

/** `addEventListener` events B17-A records (control-surface.ts LISTENER_EVENTS, not exported there; the same table). */
const LISTENER_EVENTS: Readonly<Record<string, ControlKind>> = Object.freeze({
  keydown: "shortcut", keyup: "shortcut", keypress: "shortcut",
  pointerdown: "gesture", pointermove: "gesture", pointerup: "gesture", mousedown: "gesture", mouseup: "gesture", wheel: "gesture", dblclick: "gesture", contextmenu: "gesture",
});
const LABEL_ATTRIBUTES = ["data-testid", "aria-label", "title", "placeholder", "name", "id"] as const;

function calleeText(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const object = expression.expression;
    const root = ts.isIdentifier(object) ? object.text
      : ts.isPropertyAccessExpression(object) && ts.isIdentifier(object.expression) ? `${object.expression.text}.${object.name.text}`
      : ts.isThisTypeNode(object) ? "this"
      : ts.isCallExpression(object) ? `${calleeText(object.expression) ?? "?"}()`
      : ts.isNonNullExpression(object) ? (calleeText(object.expression) ?? "?")
      : "?";
    return `${root}.${expression.name.text}`;
  }
  if (ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) return calleeText(expression.expression);
  return null;
}
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}
function attributeLiteral(attribute: ts.JsxAttribute): string | null {
  const initializer = attribute.initializer;
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const expression = initializer.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (ts.isTemplateExpression(expression)) return expression.head.text + expression.templateSpans.map((span) => `*${span.literal.text}`).join("");
    if (ts.isConditionalExpression(expression)) {
      const a = literalText(expression.whenTrue), b = literalText(expression.whenFalse);
      if (a && b) return `${a}|${b}`;
      if (a || b) return `${a ?? b}|*`;
    }
  }
  return null;
}
function jsxText(node: ts.Node, out: string[], depth: number): void {
  if (depth > 2) return;
  for (const child of node.getChildren()) {
    if (ts.isJsxText(child)) {
      const text = child.text.replace(/\s+/g, " ").trim();
      if (text) out.push(text);
    } else if (ts.isJsxExpression(child) && child.expression) {
      const text = literalText(child.expression);
      if (text) out.push(text);
      else if (ts.isConditionalExpression(child.expression)) {
        const a = literalText(child.expression.whenTrue), b = literalText(child.expression.whenFalse);
        if (a && b) out.push(`${a}|${b}`); else if (a || b) out.push(`${a ?? b}|*`);
      }
    } else if (ts.isJsxElement(child) || ts.isJsxFragment(child) || child.kind === ts.SyntaxKind.SyntaxList) {
      jsxText(child, out, depth + 1);
    }
  }
}
function b17Label(opening: ts.JsxOpeningLikeElement): string {
  const attributes = new Map<string, string>();
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
    const value = attributeLiteral(attribute);
    if (value !== null) attributes.set(attribute.name.text, value);
  }
  for (const name of LABEL_ATTRIBUTES) {
    const value = attributes.get(name);
    if (value) return value.replace(/\s+/g, " ").trim();
  }
  if (ts.isJsxOpeningElement(opening) && ts.isJsxElement(opening.parent)) {
    const texts: string[] = [];
    jsxText(opening.parent, texts, 0);
    const joined = texts.join(" ").replace(/\s+/g, " ").trim();
    if (joined) return joined.length > 60 ? `${joined.slice(0, 57)}…` : joined;
  }
  return "(none)";
}
function tagOf(opening: ts.JsxOpeningLikeElement): string {
  const name = opening.tagName;
  return ts.isIdentifier(name) ? name.text : ts.isPropertyAccessExpression(name) ? `${calleeText(name) ?? "?"}` : name.getText();
}
function paletteAction(node: ts.ObjectLiteralExpression): { id: string; title: string | null; run: ts.Expression | undefined } | null {
  let id: string | null = null, title: string | null = null, hasTitle = false, run: ts.Expression | undefined, hasRun = false;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    if (property.name.text === "id") id = literalText(property.initializer) ?? (ts.isTemplateExpression(property.initializer) ? property.initializer.head.text + "*" : null);
    if (property.name.text === "title") { hasTitle = true; title = literalText(property.initializer) ?? "*"; }
    if (property.name.text === "run") { hasRun = true; run = property.initializer; }
  }
  return id && hasRun ? { id, title: hasTitle ? title : null, run } : null;
}

// ─── JSX facts ───────────────────────────────────────────────────────────────

type AttributeValue = { readonly kind: "literal"; readonly text: string } | { readonly kind: "expression"; readonly text: string; readonly shown: string } | { readonly kind: "bare" };
function attributeValue(opening: ts.JsxOpeningLikeElement, name: string): AttributeValue | null {
  for (const property of opening.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== name) continue;
    const initializer = property.initializer;
    if (!initializer) return { kind: "bare" };
    if (ts.isStringLiteral(initializer)) return { kind: "literal", text: initializer.text };
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      const expression = initializer.expression;
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return { kind: "literal", text: expression.text };
      return { kind: "expression", text: expression.getText(), shown: shownExpression(expression) };
    }
    return { kind: "bare" };
  }
  return null;
}
/** What a person reads of an expression value, as far as the source says: a template's literal parts with `*` for each value, a
 *  conditional's two literal branches, or `*`. */
function shownExpression(expression: ts.Expression): string {
  if (ts.isTemplateExpression(expression)) return expression.head.text + expression.templateSpans.map((span) => `*${span.literal.text}`).join("");
  if (ts.isConditionalExpression(expression)) {
    const a = literalText(expression.whenTrue), b = literalText(expression.whenFalse);
    if (a !== null || b !== null) return `${a ?? "*"}|${b ?? "*"}`;
  }
  return "*";
}
const named = (value: AttributeValue | null): value is AttributeValue => value !== null && (value.kind === "expression" || (value.kind === "literal" && value.text.trim().length > 0));
const shown = (value: AttributeValue): string => (value.kind === "literal" ? value.text : value.kind === "expression" ? value.shown : "").replace(/\s+/g, " ").trim();
const clip = (text: string): string => (text.length > 60 ? `${text.slice(0, 57)}…` : text);
const elementOf = (opening: ts.JsxOpeningLikeElement): ts.JsxElement | ts.JsxSelfClosingElement => (ts.isJsxOpeningElement(opening) ? opening.parent : opening);
const openingOf = (element: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxOpeningLikeElement => (ts.isJsxElement(element) ? element.openingElement : element);
const unwrap = (expression: ts.Expression): ts.Expression => {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isNonNullExpression(inner)) inner = inner.expression;
  return inner;
};

/** The pieces of a name computed from content: JSX text, literal and expression children, child aria-labels and image alts;
 *  `*` stands for a value known only at run time. Children marked aria-hidden contribute nothing; `exclude` is skipped. */
function contentOf(children: ts.NodeArray<ts.JsxChild>, exclude: ts.Node | null, out: string[], depth: number): void {
  if (depth > 12) return;
  for (const child of children) {
    if (child === exclude) continue;
    if (ts.isJsxText(child)) {
      const text = child.text.replace(/\s+/g, " ").trim();
      if (text) out.push(text);
    } else if (ts.isJsxExpression(child)) {
      if (child.expression) expressionContent(child.expression, exclude, out, depth + 1);
    } else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      elementContent(child, exclude, out, depth + 1);
    } else if (ts.isJsxFragment(child)) {
      contentOf(child.children, exclude, out, depth + 1);
    }
  }
}
function elementContent(element: ts.JsxElement | ts.JsxSelfClosingElement, exclude: ts.Node | null, out: string[], depth: number): void {
  if (element === exclude) return;
  const opening = openingOf(element);
  const hidden = attributeValue(opening, "aria-hidden");
  if (hidden !== null && (hidden.kind === "bare" || hidden.text === "true")) return;
  const label = attributeValue(opening, "aria-label");
  if (named(label)) { out.push(shown(label)); return; }
  if (tagOf(opening) === "img") {
    const alt = attributeValue(opening, "alt");
    if (named(alt)) out.push(shown(alt));
    return;
  }
  if (ts.isJsxElement(element)) contentOf(element.children, exclude, out, depth);
}
function expressionContent(expression: ts.Expression, exclude: ts.Node | null, out: string[], depth: number): void {
  const inner = unwrap(expression);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) { if (inner.text.trim()) out.push(inner.text.replace(/\s+/g, " ").trim()); return; }
  if (ts.isNumericLiteral(inner)) { out.push(inner.text); return; }
  if (ts.isTemplateExpression(inner)) { out.push(inner.head.text + inner.templateSpans.map((span) => `*${span.literal.text}`).join("")); return; }
  if (ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner)) { elementContent(inner, exclude, out, depth); return; }
  if (ts.isJsxFragment(inner)) { contentOf(inner.children, exclude, out, depth); return; }
  if (ts.isConditionalExpression(inner)) { expressionContent(inner.whenTrue, exclude, out, depth); expressionContent(inner.whenFalse, exclude, out, depth); return; }
  if (ts.isBinaryExpression(inner)) {
    const operator = inner.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) { expressionContent(inner.right, exclude, out, depth); return; }
    if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) { expressionContent(inner.left, exclude, out, depth); expressionContent(inner.right, exclude, out, depth); return; }
    out.push("*");
    return;
  }
  if (inner.kind === ts.SyntaxKind.NullKeyword || inner.kind === ts.SyntaxKind.TrueKeyword || inner.kind === ts.SyntaxKind.FalseKeyword) return;
  if (ts.isIdentifier(inner) && inner.text === "undefined") return;
  if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === "map") {
    const callback = inner.arguments[0];
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      if (ts.isBlock(callback.body)) {
        const visit = (node: ts.Node): void => {
          if (ts.isReturnStatement(node) && node.expression) expressionContent(node.expression, exclude, out, depth + 1);
          else if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
        };
        ts.forEachChild(callback.body, visit);
      } else expressionContent(callback.body, exclude, out, depth + 1);
      return;
    }
  }
  out.push("*"); // an identifier, a member or a call: text known only at run time
}
const contentName = (element: ts.JsxElement | ts.JsxSelfClosingElement, exclude: ts.Node | null = null): string => {
  if (!ts.isJsxElement(element)) return "";
  const out: string[] = [];
  contentOf(element.children, exclude, out, 0);
  return out.join(" ").replace(/\s+/g, " ").trim();
};

/** Elements whose name never comes from their content (an option list is not a name). */
const FIELD_TAGS = new Set(["input", "select", "textarea", "Input", "Textarea"]);
/** ARIA's name-from-contents: native buttons, links, summaries, options, table rows and cells and headings; an element whose
 *  explicit role is one of those roles; and a component call site (a capitalised or dotted tag such as `Button`), which renders
 *  its own control. A generic element (div, span, li, p) and an SVG shape never take a name from their content. */
const CONTENT_NAMED_TAGS = new Set(["button", "a", "summary", "option", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"]);
const CONTENT_NAMED_ROLES = new Set(["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "checkbox", "switch", "treeitem", "row", "cell", "gridcell", "columnheader", "rowheader", "heading", "tooltip"]);
function takesNameFromContent(opening: ts.JsxOpeningLikeElement, tag: string): boolean {
  if (FIELD_TAGS.has(tag)) return false;
  const role = attributeValue(opening, "role");
  if (role !== null && role.kind === "literal") return CONTENT_NAMED_ROLES.has(role.text);
  if (/^[A-Z]/.test(tag) || tag.includes(".")) return true;
  return CONTENT_NAMED_TAGS.has(tag);
}
/** Elements a <label> names (by wrapping them or by its htmlFor). */
const LABELABLE_TAGS = new Set(["input", "select", "textarea", "button", "meter", "output", "progress", "Input", "Textarea", "Button"]);
const NATIVE_CONTROL_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary", "Button", "Input", "Textarea"]);
const SVG_TAGS = new Set(["svg", "g", "rect", "circle", "ellipse", "line", "path", "polyline", "polygon", "text", "tspan", "foreignObject", "use", "image"]);
const NON_INTERACTIVE_TAGS = new Set(["div", "span", "li", "ul", "ol", "tr", "td", "th", "p", "section", "article", "aside", "header", "footer", "nav", "main", "img", ...SVG_TAGS]);
const SHARED_DIALOG_MODULE = "@/components/ui/dialog";

// ─── per-file facts ──────────────────────────────────────────────────────────

interface Site {
  readonly surface: string;
  readonly kind: ControlKind;
  readonly element: string;
  readonly label: string;
  readonly handler: string;
  readonly line: number;
  readonly node: ts.Node;
  readonly opening: ts.JsxOpeningLikeElement | null;
  readonly palette: { readonly title: string | null } | null;
  key: string;
}
interface FileFacts {
  readonly surface: string;
  readonly source: ts.SourceFile;
  /** The nodes of the file's scope regions (empty when the file is out of scope; the SourceFile when the whole file is in). */
  readonly regions: readonly ts.Node[];
  /** Declared canvas hosts in this file: the host element nodes whose role is img and whose name is their statement. */
  readonly declaredHosts: ReadonlyArray<{ readonly host: CanvasHost; readonly node: ts.JsxElement | ts.JsxSelfClosingElement }>;
  /** htmlFor attribute values with their label's content name. */
  readonly labelsFor: ReadonlyArray<{ readonly value: AttributeValue; readonly name: string }>;
  readonly importsSharedDialog: boolean;
}

const inside = (node: ts.Node, region: ts.Node): boolean => node.getStart() >= region.getStart() && node.end <= region.end;
const lineOf = (source: ts.SourceFile, node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const parse = (surface: string, text: string): ts.SourceFile => ts.createSourceFile(surface, text, ts.ScriptTarget.ES2022, true, surface.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const yieldToHost = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

function jsxElements(root: ts.Node): Array<ts.JsxElement | ts.JsxSelfClosingElement> {
  const found: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function regionNodes(source: ts.SourceFile, region: ScopeRegion): ts.Node[] {
  if (region.kind === "function") {
    const found: ts.Node[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === region.name) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  }
  return jsxElements(source).filter((element) => {
    const opening = openingOf(element);
    if (tagOf(opening) !== region.tag || !ts.isJsxElement(element)) return false;
    if (region.classIncludes !== undefined) {
      const className = opening.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === "className");
      return className !== undefined && className.initializer !== undefined && className.initializer.getText().includes(region.classIncludes);
    }
    if (region.holdsTestId !== undefined) return jsxElements(element).some((inner) => { const value = attributeValue(openingOf(inner), "data-testid"); return value?.kind === "literal" && value.text === region.holdsTestId; });
    return jsxElements(element).some((inner) => tagOf(openingOf(inner)) === "DialogTitle" && contentName(inner) === region.holdsTitle);
  });
}

function fileFacts(surface: string, source: ts.SourceFile, scopeProblems: string[]): FileFacts {
  const regions: ts.Node[] = [];
  for (const entry of ACCESSIBILITY_SCOPE) {
    if (entry.surface !== surface) continue;
    if (entry.region === null) { regions.push(source); continue; }
    const nodes = regionNodes(source, entry.region);
    if (nodes.length !== 1) scopeProblems.push(`${describeRegion(entry)}: ${nodes.length} matches (exactly one expected)`);
    regions.push(...nodes);
  }
  const elements = jsxElements(source);
  const declaredHosts = CANVAS_HOSTS.filter((host) => host.surface === surface).flatMap((host) => elements
    .filter((element) => { const opening = openingOf(element); const value = attributeValue(opening, host.pick[0]); return tagOf(opening) === host.tag && value !== null && value.kind !== "bare" && (value.kind === "literal" ? value.text : `{${value.text}}`) === host.pick[1]; })
    .filter((element) => {
      const opening = openingOf(element);
      const role = attributeValue(opening, "role"), label = attributeValue(opening, "aria-label");
      return role?.kind === "literal" && role.text === "img" && label !== null && ((label.kind === "literal" && label.text === STATEMENT_VALUES[host.statement]) || (label.kind === "expression" && label.text === host.statement));
    })
    .map((node) => ({ host, node })));
  const labelsFor = elements.flatMap((element) => {
    const value = attributeValue(openingOf(element), "htmlFor");
    return value !== null && value.kind !== "bare" ? [{ value, name: contentName(element) }] : [];
  });
  const importsSharedDialog = source.statements.some((statement) => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === SHARED_DIALOG_MODULE);
  return { surface, source, regions, declaredHosts, labelsFor, importsSharedDialog };
}

/** The sites of one surface, in B17-A's visiting order (control-surface.ts scanControlSites), keys not yet assigned. */
function sitesOf(surface: string, source: ts.SourceFile): Site[] {
  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
        const kind = CONTROL_EVENT_ATTRIBUTES[attribute.name.text];
        if (!kind) continue;
        const initializer = attribute.initializer;
        const handler = summarizeHandler(initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined);
        sites.push({ surface, kind, element: tagOf(node), label: b17Label(node), handler, line: lineOf(source, attribute), node: attribute, opening: node, palette: null, key: "" });
      }
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "addEventListener") {
      const eventName = node.arguments[0] ? literalText(node.arguments[0]) : null;
      const listenerKind = eventName ? LISTENER_EVENTS[eventName] : undefined;
      if (eventName && listenerKind) {
        const target = calleeText(node.expression.expression) ?? "?";
        const listener = node.arguments[1];
        const handler = listener ? (ts.isIdentifier(listener) ? listener.text : summarizeHandler(listener)) : "noop";
        sites.push({ surface, kind: listenerKind, element: target, label: `${eventName}:${handler}`, handler, line: lineOf(source, node), node, opening: null, palette: null, key: "" });
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      const palette = paletteAction(node);
      if (palette) sites.push({ surface, kind: "palette", element: "palette", label: palette.id, handler: summarizeHandler(palette.run), line: lineOf(source, node), node, opening: null, palette: { title: palette.title }, key: "" });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/** B17-A's stable keys: identical (surface, kind, element, label, handler) get an ordinal suffix in document order. The base names
 *  the surface, so one surface's sites take the same keys alone as in the whole scan. */
function keyed(sites: Site[]): Site[] {
  const counts = new Map<string, number>();
  for (const site of sites) {
    const base = `${site.surface}|${site.kind}|${site.element}|${site.label}|${site.handler}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    site.key = n === 1 ? base : `${base}#${n}`;
  }
  return sites;
}

// ─── the statuses ────────────────────────────────────────────────────────────

interface Status { readonly status: AccessibleNameStatus; readonly detail: string }

function nameOf(site: Site, facts: FileFacts): Status | null {
  const opening = site.opening!;
  const tag = tagOf(opening);
  const labelledBy = attributeValue(opening, "aria-labelledby");
  if (named(labelledBy)) return { status: "named:aria-labelledby", detail: clip(shown(labelledBy)) };
  const label = attributeValue(opening, "aria-label");
  if (named(label)) return { status: "named:aria-label", detail: clip(shown(label)) };
  const element = elementOf(opening);
  if (LABELABLE_TAGS.has(tag)) {
    for (let parent: ts.Node | undefined = element.parent; parent !== undefined && !ts.isSourceFile(parent); parent = parent.parent) {
      if (ts.isJsxElement(parent) && tagOf(parent.openingElement) === "label") {
        const text = contentName(parent, element);
        if (text) return { status: "named:label-wrap", detail: clip(text) };
        break;
      }
    }
    const id = attributeValue(opening, "id");
    if (id !== null && id.kind !== "bare") {
      const labelled = facts.labelsFor.find((entry) => entry.value.kind === id.kind && entry.value.text === id.text && entry.name.length > 0);
      if (labelled) return { status: "named:label-for", detail: clip(labelled.name) };
    }
  }
  if (takesNameFromContent(opening, tag)) {
    const text = contentName(element);
    if (text.length > 0) return { status: "named:text", detail: clip(text) };
  }
  const title = attributeValue(opening, "title");
  if (named(title)) return { status: "named:title", detail: clip(shown(title)) };
  const forwarding = NAME_FORWARDING.find((entry) => entry.component === tag && entry.surface === site.surface);
  if (forwarding) {
    const value = attributeValue(opening, forwarding.prop);
    if (named(value)) return { status: "named:forwarded", detail: clip(`${forwarding.prop} to ${forwarding.forwardsTo}: ${shown(value)}`) };
  }
  return null;
}

function unnamedDetail(opening: ts.JsxOpeningLikeElement): string {
  if (named(attributeValue(opening, "placeholder"))) return "placeholder-only";
  if (named(attributeValue(opening, "data-testid"))) return "testid-only";
  if (named(attributeValue(opening, "name"))) return "name-only";
  if (named(attributeValue(opening, "id"))) return "id-only";
  return "none";
}

/** A shared Dialog's title: the content name of the DialogTitle inside its DialogContent, or null when there is none. */
function dialogTitle(element: ts.JsxElement | ts.JsxSelfClosingElement): string | null {
  if (!ts.isJsxElement(element)) return null;
  for (const content of jsxElements(element).filter((inner) => tagOf(openingOf(inner)) === "DialogContent")) {
    for (const title of jsxElements(content).filter((inner) => tagOf(openingOf(inner)) === "DialogTitle")) {
      const text = contentName(title);
      if (text) return text;
    }
  }
  return null;
}

/** A form's submit controls: its buttons with no type or type="submit", and its submit inputs. */
function submitControls(form: ts.JsxElement): Array<ts.JsxElement | ts.JsxSelfClosingElement> {
  return jsxElements(form).filter((inner) => {
    if (inner === form) return false;
    const opening = openingOf(inner);
    const tag = tagOf(opening), type = attributeValue(opening, "type");
    if (tag === "button" || tag === "Button") return type === null || (type.kind === "literal" && type.text === "submit");
    return tag === "input" && type?.kind === "literal" && type.text === "submit";
  });
}

function backdropShapeProblem(site: Site): string | null {
  const opening = site.opening;
  if (opening === null || site.kind !== "click") return "not a JSX click site";
  if (!NON_INTERACTIVE_TAGS.has(tagOf(opening))) return `a <${tagOf(opening)}> is not a backdrop`;
  if (!ts.isJsxSelfClosingElement(opening)) return "a backdrop holds no content";
  const handlers = opening.attributes.properties.filter((property) => ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && CONTROL_EVENT_ATTRIBUTES[property.name.text] !== undefined);
  if (handlers.length !== 1) return "a backdrop carries its click handler only";
  if (site.handler.includes(",")) return `a backdrop only dismisses (handler ${site.handler})`;
  return null;
}

function statusOf(site: Site, facts: FileFacts): Status {
  if (site.kind === "shortcut" || site.kind === "gesture") return { status: "exempt:listener", detail: site.label };
  if (site.kind === "palette") return site.palette?.title ? { status: "named:palette-title", detail: clip(site.palette.title) } : { status: "unnamed", detail: "untitled-palette-action" };
  const opening = site.opening!;
  if (/^(e|event)\.stopPropagation$/.test(site.handler)) return { status: "exempt:click-shield", detail: "" };
  if (site.kind !== "change" && site.kind !== "submit" && site.kind !== "dialog") {
    const declared = facts.declaredHosts.find((entry) => inside(opening, entry.node));
    if (declared) return { status: "exempt:canvas-gesture", detail: `go to: ${declared.host.goTo.name} (${declared.host.goTo.testId})` };
  }
  const backdrop = BACKDROP_EXEMPTIONS.find((entry) => entry.key === site.key);
  if (backdrop && backdropShapeProblem(site) === null) return { status: "exempt:backdrop", detail: `closed by ${backdrop.closedBy}` };
  if (site.kind === "dialog" && tagOf(opening) === "Dialog" && facts.importsSharedDialog) {
    const title = dialogTitle(elementOf(opening));
    return title !== null ? { status: "exempt:dialog-titled", detail: clip(title) } : { status: "unnamed", detail: "untitled-dialog" };
  }
  if (site.kind === "submit" && tagOf(opening) === "form" && ts.isJsxOpeningElement(opening)) {
    const submits = submitControls(opening.parent);
    if (submits.length === 0) return { status: "unnamed", detail: "no-submit-control" };
    const names = submits.map((control) => nameOf({ ...site, opening: openingOf(control) }, facts));
    return names.every((name) => name !== null) ? { status: "exempt:form-submit", detail: clip(names.map((name) => name!.detail).join(" | ")) } : { status: "unnamed", detail: "unnamed-submit" };
  }
  return nameOf(site, facts) ?? { status: "unnamed", detail: unnamedDetail(opening) };
}

// ─── the census ──────────────────────────────────────────────────────────────

export interface AccessibleNameRow {
  readonly key: string;
  readonly surface: string;
  readonly kind: ControlKind;
  readonly element: string;
  /** 1-based line at scan time (evidence only; never part of the key, never in the CSV). */
  readonly line: number;
  readonly inScope: boolean;
  readonly status: AccessibleNameStatus;
  readonly detail: string;
}
export type StructuralRule = "positive-tabindex" | "negative-tabindex-native" | "non-interactive-handler";
export interface StructuralProblem { readonly rule: StructuralRule; readonly surface: string; readonly line: number; readonly detail: string }
export interface AccessibleNameCensus {
  /** Every site, sorted by key as B17-A sorts them. */
  readonly rows: readonly AccessibleNameRow[];
  /** In scope only. */
  readonly structural: readonly StructuralProblem[];
  /** A scope region that matches no element, or more than one. */
  readonly scopeProblems: readonly string[];
  /** The recomputed B17 keys, in visiting order (case 1 compares their multiset with scanControlSites'). */
  readonly recomputedKeys: readonly string[];
}

function structuralProblems(facts: FileFacts, sites: readonly Site[], statuses: ReadonlyMap<Site, Status>): StructuralProblem[] {
  const problems: StructuralProblem[] = [];
  const inScope = (node: ts.Node): boolean => facts.regions.some((region) => inside(node, region));
  for (const element of jsxElements(facts.source)) {
    const opening = openingOf(element);
    if (!inScope(opening)) continue;
    const tabIndex = attributeValue(opening, "tabIndex");
    if (tabIndex === null) continue;
    const value = tabIndex.kind === "literal" ? Number(tabIndex.text) : tabIndex.kind === "expression" ? Number(tabIndex.text.replace(/\s+/g, "")) : Number.NaN;
    if (value > 0) problems.push({ rule: "positive-tabindex", surface: facts.surface, line: lineOf(facts.source, opening), detail: `<${tagOf(opening)} tabIndex=${tabIndex.kind === "bare" ? "" : tabIndex.kind === "literal" ? tabIndex.text : `{${tabIndex.text}}`}>` });
    if (value === -1 && NATIVE_CONTROL_TAGS.has(tagOf(opening))) problems.push({ rule: "negative-tabindex-native", surface: facts.surface, line: lineOf(facts.source, opening), detail: `<${tagOf(opening)} tabIndex={-1}>` });
  }
  for (const site of sites) {
    const opening = site.opening;
    if (opening === null || !inScope(opening) || (site.kind !== "click" && site.kind !== "double-click" && site.kind !== "key")) continue;
    if (!NON_INTERACTIVE_TAGS.has(tagOf(opening)) || statuses.get(site)!.status.startsWith("exempt:")) continue;
    const role = attributeValue(opening, "role"), tabIndex = attributeValue(opening, "tabIndex"), keyHandler = attributeValue(opening, "onKeyDown");
    const focusable = tabIndex !== null && ((tabIndex.kind === "literal" && tabIndex.text === "0") || (tabIndex.kind === "expression" && tabIndex.text === "0"));
    if (role === null || !focusable || keyHandler === null) problems.push({ rule: "non-interactive-handler", surface: facts.surface, line: site.line, detail: `${site.key}: a <${tagOf(opening)}> with a ${site.kind} handler needs a role, tabIndex={0} and a key handler` });
  }
  return problems;
}

/** The census over every surface B17-A scans (async: it yields between surfaces so a test worker stays responsive). */
export async function computeAccessibleNameCensus(cwd: string): Promise<AccessibleNameCensus> {
  const scopeProblems: string[] = [];
  const all: Array<{ readonly site: Site; readonly facts: FileFacts }> = [];
  const byFile: Array<{ readonly facts: FileFacts; readonly sites: Site[] }> = [];
  const surfaces = listControlSurfaceFiles(cwd);
  for (const entry of ACCESSIBILITY_SCOPE) if (!surfaces.includes(entry.surface)) scopeProblems.push(`${entry.surface}: not a scanned surface`);
  for (const surface of surfaces) {
    const source = parse(surface, readFileSync(join(cwd, surface), "utf8"));
    const facts = fileFacts(surface, source, scopeProblems);
    const sites = sitesOf(surface, source);
    byFile.push({ facts, sites });
    for (const site of sites) all.push({ site, facts });
    await yieldToHost();
  }
  keyed(all.map(({ site }) => site));
  const statuses = new Map<Site, Status>();
  for (const { site, facts } of all) statuses.set(site, statusOf(site, facts));
  const rows = all.map(({ site, facts }): AccessibleNameRow => ({
    key: site.key, surface: site.surface, kind: site.kind, element: site.element, line: site.line,
    inScope: facts.regions.some((region) => inside(site.node, region)),
    ...statuses.get(site)!,
  }));
  const structural = byFile.flatMap(({ facts, sites }) => structuralProblems(facts, sites, statuses));
  return {
    rows: [...rows].sort((a, b) => a.key.localeCompare(b.key)),
    structural,
    scopeProblems,
    recomputedKeys: all.map(({ site }) => site.key),
  };
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function renderAccessibleNameCensusCsv(rows: readonly AccessibleNameRow[]): string {
  const header = ["key", "surface", "kind", "element", "in_scope", "status", "detail"];
  const body = [...rows].sort((a, b) => a.key.localeCompare(b.key)).map((row) => [row.key, row.surface, row.kind, row.element, row.inScope ? "yes" : "no", row.status, row.detail]);
  return [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

/** The keys a committed census CSV lists as `unnamed` (RFC 4180 quoting, as `renderAccessibleNameCensusCsv` writes it). */
export function unnamedKeysOfCensusCsv(text: string): Set<string> {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return new Set(rows.slice(1).filter((cells) => cells[5] === "unnamed").map((cells) => cells[0]!));
}

export interface AccessibleNameCensusSummary {
  readonly schemaVersion: "sirkit.accessible-name-census-summary.v1";
  readonly sites: number;
  readonly surfaces: number;
  readonly byStatus: Record<string, number>;
  readonly inScope: { readonly sites: number; readonly surfaces: number; readonly byStatus: Record<string, number>; readonly structuralProblems: number };
  readonly outOfScope: { readonly sites: number; readonly unnamed: number };
}

const tally = (rows: readonly AccessibleNameRow[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

export function summarizeAccessibleNameCensus(census: AccessibleNameCensus): AccessibleNameCensusSummary {
  const inScope = census.rows.filter((row) => row.inScope), outOfScope = census.rows.filter((row) => !row.inScope);
  return {
    schemaVersion: "sirkit.accessible-name-census-summary.v1",
    sites: census.rows.length,
    surfaces: new Set(census.rows.map((row) => row.surface)).size,
    byStatus: tally(census.rows),
    inScope: { sites: inScope.length, surfaces: new Set(inScope.map((row) => row.surface)).size, byStatus: tally(inScope), structuralProblems: census.structural.length },
    outOfScope: { sites: outOfScope.length, unnamed: outOfScope.filter((row) => row.status === "unnamed").length },
  };
}

// ─── the exemption, forwarding and dialog checks ─────────────────────────────

/** The closed exemptions hold: each backdrop entry is one dismiss-only backdrop whose closing control is a button, accessibly named, in the same
 *  file; each canvas host is declared once (role img, its statement) and its Go-to field exists, named. */
export function exemptionProblems(cwd: string, census: AccessibleNameCensus): string[] {
  const problems: string[] = [];
  const sources = new Map<string, ts.SourceFile>();
  const sourceOf = (surface: string): ts.SourceFile => {
    let source = sources.get(surface);
    if (!source) { source = parse(surface, readFileSync(join(cwd, surface), "utf8")); sources.set(surface, source); }
    return source;
  };
  for (const entry of BACKDROP_EXEMPTIONS) {
    const rows = census.rows.filter((row) => row.key === entry.key);
    if (rows.length !== 1) { problems.push(`${entry.key}: ${rows.length} sites (exactly one expected)`); continue; }
    const source = sourceOf(rows[0]!.surface);
    const site = keyed(sitesOf(rows[0]!.surface, source)).find((candidate) => candidate.key === entry.key);
    const shape = site ? backdropShapeProblem(site) : "not found";
    if (shape !== null) problems.push(`${entry.key}: ${shape}`);
    // [B24-D3 review, 2026-10-10] security-2: the closer is found by its ACCESSIBLE name, computed in accname's order as the census
    // computes it (a title is only a description when the content names the button), never by its title alone.
    const facts = fileFacts(rows[0]!.surface, source, []);
    const closers = jsxElements(source).filter((element) => {
      const opening = openingOf(element);
      if (!["button", "Button"].includes(tagOf(opening)) || attributeValue(opening, "onClick") === null) return false;
      const name = nameOf({ surface: rows[0]!.surface, kind: "click", element: tagOf(opening), label: "", handler: "", line: lineOf(source, opening), node: opening, opening, palette: null, key: "" }, facts);
      return name !== null && name.detail === entry.closedBy;
    });
    if (closers.length === 0) problems.push(`${entry.key}: no button named "${entry.closedBy}" with a click handler in ${rows[0]!.surface}`);
  }
  for (const host of CANVAS_HOSTS) {
    const facts = fileFacts(host.surface, sourceOf(host.surface), []);
    if (facts.declaredHosts.filter((entry) => entry.host === host).length !== 1) problems.push(`${host.surface}: the <${host.tag}> canvas host is not declared once (role="img", aria-label ${host.statement})`);
    const goTo = jsxElements(sourceOf(host.goTo.surface)).filter((element) => { const value = attributeValue(openingOf(element), "data-testid"); return value?.kind === "literal" && value.text === host.goTo.testId; });
    const name = goTo.length === 1 ? attributeValue(openingOf(goTo[0]!), "aria-label") : null;
    if (goTo.length !== 1 || name?.kind !== "literal" || name.text !== host.goTo.name) problems.push(`${host.goTo.surface}: ${host.goTo.testId} is not one field named "${host.goTo.name}"`);
  }
  for (const row of census.rows.filter((candidate) => candidate.status === "exempt:canvas-gesture")) {
    if (!CANVAS_HOSTS.some((host) => host.surface === row.surface)) problems.push(`${row.key}: a canvas gesture outside every declared host`);
  }
  return problems;
}

/** Each forwarding entry is true of its component's own JSX: the handler-bearing element puts the prop where the entry says. */
export function nameForwardingProblems(cwd: string): string[] {
  const problems: string[] = [];
  for (const entry of NAME_FORWARDING) {
    const source = parse(entry.surface, readFileSync(join(cwd, entry.surface), "utf8"));
    const definitions = source.statements.filter((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === entry.component);
    if (definitions.length !== 1) { problems.push(`${entry.surface}: function ${entry.component} is not declared once`); continue; }
    const carriers = jsxElements(definitions[0]!).filter((element) => attributeValue(openingOf(element), "onClick") !== null);
    const forwards = carriers.some((element) => {
      const opening = openingOf(element);
      if (entry.forwardsTo === "text") return ts.isJsxElement(element) && element.children.some((child) => ts.isJsxExpression(child) && child.expression !== undefined && ts.isIdentifier(child.expression) && child.expression.text === entry.prop);
      const value = attributeValue(opening, entry.forwardsTo);
      return value?.kind === "expression" && value.text === entry.prop;
    });
    if (!forwards) problems.push(`${entry.surface}: ${entry.component} does not forward ${entry.prop} to ${entry.forwardsTo} on its handler-bearing element`);
  }
  return problems;
}

export interface DialogFact { readonly surface: string; readonly line: number; readonly inScope: boolean; readonly titled: boolean }

/** Every shared Dialog (`@/components/ui/dialog`) on a scanned surface, in scope or not, with whether its content is titled. */
export function sharedDialogs(cwd: string): DialogFact[] {
  const facts: DialogFact[] = [];
  for (const surface of listControlSurfaceFiles(cwd)) {
    const text = readFileSync(join(cwd, surface), "utf8");
    if (!text.includes(SHARED_DIALOG_MODULE)) continue;
    const source = parse(surface, text);
    const file = fileFacts(surface, source, []);
    if (!file.importsSharedDialog) continue;
    for (const element of jsxElements(source).filter((candidate) => tagOf(openingOf(candidate)) === "Dialog")) {
      facts.push({ surface, line: lineOf(source, element), inScope: file.regions.some((region) => inside(element, region)), titled: dialogTitle(element) !== null });
    }
  }
  return facts;
}

/** Every hand-rolled dialog: a JSX `role="dialog"` literal on a scanned surface. */
export function handRolledDialogs(cwd: string): Array<{ readonly surface: string; readonly line: number }> {
  const found: Array<{ surface: string; line: number }> = [];
  for (const surface of listControlSurfaceFiles(cwd)) {
    const text = readFileSync(join(cwd, surface), "utf8");
    if (!text.includes("dialog")) continue;
    const source = parse(surface, text);
    for (const element of jsxElements(source)) {
      const role = attributeValue(openingOf(element), "role");
      if (role?.kind === "literal" && role.text === "dialog") found.push({ surface, line: lineOf(source, element) });
    }
  }
  return found;
}
