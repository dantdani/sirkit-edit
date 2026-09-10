/**
 * [B17-A] UI CONTROL SURFACE scanner — every actionable entry point of the
 * application, read from the source AS IT IS with the TypeScript compiler API
 * (never a regex over labels): JSX event handlers (click, double-click,
 * context menu, pointer/mouse down, key down, change, dialog open/close,
 * submit, drag/drop), window/document `keydown` listeners (keyboard
 * shortcuts) and command-palette actions.
 *
 * Every site gets a STABLE KEY derived from what a human would recognise —
 * the surface file, the event kind, the element, its label (test id,
 * aria-label, title, text) and a summary of what the handler calls — never a
 * line number. The B17-A registry (`control-registry.ts`) classifies every key
 * (semantic command / presentation-only view command / internal / unavailable
 * with a visible reason); the CI gate fails on a key without a classification
 * and on a classification without a control.
 *
 * Node-only (fs access). Never import from client code.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

export const CONTROL_EVENT_ATTRIBUTES: Readonly<Record<string, ControlKind>> = Object.freeze({
  onClick: "click",
  onDoubleClick: "double-click",
  onContextMenu: "context-menu",
  onPointerDown: "pointer",
  onMouseDown: "pointer",
  onKeyDown: "key",
  onChange: "change",
  onValueChange: "change",
  onOpenChange: "dialog",
  onSubmit: "submit",
  onDrop: "drop",
  onDragStart: "drag",
});

export type ControlKind =
  | "click" | "double-click" | "context-menu" | "pointer" | "key" | "change" | "dialog" | "submit" | "drop" | "drag"
  | "shortcut" | "gesture" | "palette";

/** `addEventListener` events that are keyboard shortcuts or pointer gestures registered outside JSX. */
const LISTENER_EVENTS: Readonly<Record<string, ControlKind>> = Object.freeze({
  keydown: "shortcut", keyup: "shortcut", keypress: "shortcut",
  pointerdown: "gesture", pointermove: "gesture", pointerup: "gesture", mousedown: "gesture", mouseup: "gesture", wheel: "gesture", dblclick: "gesture", contextmenu: "gesture",
});

export interface ControlSite {
  /** Stable key: `<surface>|<kind>|<element>|<label>|<handler>[#n]`. */
  key: string;
  /** Repo-relative POSIX path. */
  surface: string;
  kind: ControlKind;
  /** JSX tag (`button`, `Button`, `select`, `Dialog`, …), `window`/`document` for listeners, `palette` for palette actions. */
  element: string;
  /** Human-recognisable label: data-testid > aria-label > title > text > placeholder > name > (none). */
  label: string;
  /** What the handler does, summarised: callee names / setters / `dispatch:<type>` / `noop` / an identifier. */
  handler: string;
  /** 1-based line at scan time (evidence only; never part of the key). */
  line: number;
}

/** Surfaces scanned by default: the page, every component (tests excluded) and the PCB render scene
 *  (whose canvas listener is the entry point of every PCB pointer gesture). */
export const DEFAULT_CONTROL_ROOTS = ["app/page.tsx", "app/components", "app/lib/pcb/render/scene.ts"] as const;

function walkFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walkFiles(full, out);
    } else if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

export function listControlSurfaceFiles(cwd: string, roots: readonly string[] = DEFAULT_CONTROL_ROOTS): string[] {
  const files: string[] = [];
  for (const root of roots) {
    const full = join(cwd, root);
    if (statSync(full).isDirectory()) walkFiles(full, files);
    else files.push(full);
  }
  return files.map((file) => relative(cwd, file).split(sep).join("/")).sort();
}

// ─── handler summary ────────────────────────────────────────────────────────

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

/** Summarise a handler expression: the calls it makes (deduplicated, in order, at most 4). */
export function summarizeHandler(initializer: ts.Expression | undefined): string {
  if (!initializer) return "noop";
  let expression: ts.Node = initializer;
  if (ts.isJsxExpression(expression)) {
    if (!expression.expression) return "noop";
    expression = expression.expression;
  }
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return calleeText(expression) ?? "?";
  // `cond ? onA : onB` / `cond && onA` / `onA ?? onB` — the handler is one of several named handlers.
  if (ts.isConditionalExpression(expression)) {
    const a = calleeText(expression.whenTrue), b = calleeText(expression.whenFalse);
    if (a || b) return `${a ?? "noop"}|${b ?? "noop"}`;
  }
  if (ts.isBinaryExpression(expression) && (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    const a = calleeText(expression.left), b = calleeText(expression.right);
    if (b) return a && !ts.isIdentifier(expression.left) ? `${a}|${b}` : b;
  }
  const calls: string[] = [];
  const seen = new Set<string>();
  const add = (text: string): void => { if (!seen.has(text)) { seen.add(text); calls.push(text); } };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = calleeText(node.expression);
      if (callee) {
        // dispatch({ type: "x" }) / send({ kind: "x" }) → dispatch:x
        const first = node.arguments[0];
        if (first && ts.isObjectLiteralExpression(first)) {
          const typeProp = first.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && (property.name.text === "type" || property.name.text === "kind" || property.name.text === "op" || property.name.text === "operation"));
          const type = typeProp ? literalText(typeProp.initializer) : null;
          add(type ? `${callee}:${type}` : callee);
        } else if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) && /^(fetch|post|get|request|navigate|open|dispatch|run|execute|track|log)$/i.test(callee.split(".").pop() ?? "")) {
          add(`${callee}:${first.text}`);
        } else {
          add(callee);
        }
      }
    } else if (ts.isAwaitExpression(node) || ts.isVoidExpression(node)) {
      // transparent
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  if (calls.length === 0) {
    // assignments / state updates without a call (rare): name the assigned target
    let assigned: string | null = null;
    const findAssign = (node: ts.Node): void => {
      if (assigned) return;
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) assigned = calleeText(node.left) ?? "assign";
      ts.forEachChild(node, findAssign);
    };
    findAssign(expression);
    return assigned ?? "noop";
  }
  return calls.slice(0, 4).join(",");
}

// ─── labels ─────────────────────────────────────────────────────────────────

const LABEL_ATTRIBUTES = ["data-testid", "aria-label", "title", "placeholder", "name", "id"] as const;

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

function elementLabel(opening: ts.JsxOpeningLikeElement): string {
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

function tagName(opening: ts.JsxOpeningLikeElement): string {
  const name = opening.tagName;
  return ts.isIdentifier(name) ? name.text : ts.isPropertyAccessExpression(name) ? `${calleeText(name) ?? "?"}` : name.getText();
}

// ─── scan ───────────────────────────────────────────────────────────────────

function isPaletteActionLiteral(node: ts.ObjectLiteralExpression): { id: string; title: string; run: ts.Expression | undefined } | null {
  let id: string | null = null, title: string | null = null, run: ts.Expression | undefined, hasRun = false;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    if (property.name.text === "id") id = literalText(property.initializer) ?? (ts.isTemplateExpression(property.initializer) ? property.initializer.head.text + "*" : null);
    if (property.name.text === "title") title = literalText(property.initializer) ?? "*";
    if (property.name.text === "run") { hasRun = true; run = property.initializer; }
  }
  return id && hasRun ? { id, title: title ?? "*", run } : null;
}

export function scanControlSites(cwd: string, roots: readonly string[] = DEFAULT_CONTROL_ROOTS): ControlSite[] {
  const sites: ControlSite[] = [];
  for (const surface of listControlSurfaceFiles(cwd, roots)) {
    const text = readFileSync(join(cwd, surface), "utf8");
    const source = ts.createSourceFile(surface, text, ts.ScriptTarget.ES2022, true, surface.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const line = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
          const kind = CONTROL_EVENT_ATTRIBUTES[attribute.name.text];
          if (!kind) continue;
          const initializer = attribute.initializer;
          const handler = summarizeHandler(initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer && ts.isStringLiteral(initializer) ? undefined : undefined);
          sites.push({ key: "", surface, kind, element: tagName(node), label: elementLabel(node), handler, line: line(attribute) });
        }
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "addEventListener") {
        const eventName = node.arguments[0] ? literalText(node.arguments[0]) : null;
        const listenerKind = eventName ? LISTENER_EVENTS[eventName] : undefined;
        if (eventName && listenerKind) {
          const target = calleeText(node.expression.expression) ?? "?";
          const listener = node.arguments[1];
          const handler = listener ? (ts.isIdentifier(listener) ? listener.text : summarizeHandler(listener)) : "noop";
          sites.push({ key: "", surface, kind: listenerKind, element: target, label: `${eventName}:${handler}`, handler, line: line(node) });
        }
      } else if (ts.isObjectLiteralExpression(node)) {
        const palette = isPaletteActionLiteral(node);
        if (palette) sites.push({ key: "", surface, kind: "palette", element: "palette", label: palette.id, handler: summarizeHandler(palette.run), line: line(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  // stable keys: identical (surface, kind, element, label, handler) get an ordinal suffix in document order.
  const counts = new Map<string, number>();
  for (const site of sites) {
    const base = `${site.surface}|${site.kind}|${site.element}|${site.label}|${site.handler}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    site.key = n === 1 ? base : `${base}#${n}`;
  }
  return sites.sort((a, b) => a.key.localeCompare(b.key));
}
