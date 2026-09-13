/**
 * Parse SchGen's generated schematic DSL into a NormalizedNetlist for
 * cross-verification — WITHOUT executing the code.
 *
 * SchGen represents a schematic as a Python program calling a small API:
 *   add_schematic_symbol(symbol_lib=, symbol_name=, ..., reference=, value=, ...)
 *   add_label(label_pos, label_text, label_ref, ...)
 *   connect_pins(sym_a, pin_a, sym_b, pin_b)
 * The netlist is fully recoverable from those three calls: components from
 * add_schematic_symbol, named nets from add_label + connect_pins (a label is a
 * one-pin symbol referenced by its label_ref). We statically scan the source for
 * those calls rather than running it — no arbitrary-code-execution risk, and the
 * connection graph comes straight from connect_pins (no geometry needed).
 *
 * Limitation: static parsing sees only literal top-level calls. If the model
 * emits helper functions / loops that generate calls dynamically, those are
 * missed — `coverage` reports how much was interpreted so callers can downgrade
 * or skip a low-coverage parse rather than trust a partial netlist.
 */

import {
  classifyComponent,
  type NormalizedNetlist,
  type NormComponent,
  type NormNet,
} from "./netlist-crosscheck";

export type SchGenParseResult = {
  netlist: NormalizedNetlist;
  coverage: { symbols: number; labels: number; connections: number; unparsedCalls: number };
};

/** Split the argument list of a call on top-level commas (ignores nested parens/brackets/strings). */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (ch === quote && inner[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; cur += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; cur += ch; continue; }
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parse a call's args into positional list + keyword map. */
function parseCallArgs(inner: string): { pos: string[]; kw: Map<string, string> } {
  const pos: string[] = [];
  const kw = new Map<string, string>();
  for (const arg of splitArgs(inner)) {
    const eq = arg.indexOf("=");
    // Only treat as kwarg if the '=' is a top-level assignment (identifier=).
    if (eq > 0 && /^[A-Za-z_]\w*$/.test(arg.slice(0, eq).trim())) {
      kw.set(arg.slice(0, eq).trim(), arg.slice(eq + 1).trim());
    } else {
      pos.push(arg.trim());
    }
  }
  return { pos, kw };
}

// Find every `fn(...)` call in the source, returning the inner arg text. Handles
// nested parens within the call.
function findCalls(src: string, fn: string): string[] {
  const calls: string[] = [];
  const re = new RegExp(`\\b${fn}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    let quote: string | null = null;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (quote) { if (ch === quote && src[i - 1] !== "\\") quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    if (depth === 0) calls.push(src.slice(start, i - 1));
  }
  return calls;
}

export function parseSchGenSource(python: string): SchGenParseResult {
  const components: NormComponent[] = [];
  const symLibName = new Map<string, string>(); // refDes → "lib:name" (for classification)
  const labelText = new Map<string, string>();  // label_ref → label_text (net name)
  const labelRefs = new Set<string>();             // every label_ref, named or not

  // 1) Components.
  const symCalls = findCalls(python, "add_schematic_symbol");
  for (const inner of symCalls) {
    const { pos, kw } = parseCallArgs(inner);
    // Signature: (symbol_lib, symbol_name, pos_x, pos_y, reference, value, rotation, mirror)
    const lib = unquote(kw.get("symbol_lib") ?? pos[0] ?? "");
    const name = unquote(kw.get("symbol_name") ?? pos[1] ?? "");
    const ref = unquote(kw.get("reference") ?? pos[4] ?? "");
    const value = unquote(kw.get("value") ?? pos[5] ?? "");
    if (!ref) continue;
    symLibName.set(ref, `${lib}:${name}`);
    components.push({ refDes: ref, klass: classifyComponent(ref, name, value), value: value || null });
  }

  // 2) Labels (named nets).
  const labelCalls = findCalls(python, "add_label");
  for (const inner of labelCalls) {
    const { pos, kw } = parseCallArgs(inner);
    // Signature: (label_pos, label_text, label_ref, label_type, text_orient)
    const text = unquote(kw.get("label_text") ?? pos[1] ?? "");
    const ref = unquote(kw.get("label_ref") ?? pos[2] ?? "");
    // [B19-D I5e row 32] a label names a net only when it is a net name (the grammar the build prompt states: upper-case
    // letters, digits, underscore, '-', '/', a leading '+', at most 32 characters). Any other label still connects its pins,
    // but it names nothing — a sentence written by the independent model never becomes a net name shown to anyone.
    if (ref && text) {
      labelRefs.add(ref);
      const name = text.toUpperCase();
      if (/^[+A-Z0-9_\-/]{1,32}$/.test(name)) labelText.set(ref, name);
    }
  }

  // 3) Connections → union endpoints; a label endpoint carries its net name.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = parent.get(x);
    if (r === undefined) { parent.set(x, x); return x; }
    while (r !== x) { x = r; r = parent.get(x) ?? x; }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const netNameOf = new Map<string, string>(); // endpoint → net name (via label)
  let connCount = 0;
  for (const inner of findCalls(python, "connect_pins")) {
    const { pos, kw } = parseCallArgs(inner);
    const symA = unquote(kw.get("sym_a") ?? pos[0] ?? "");
    const pinA = unquote(kw.get("pin_a") ?? pos[1] ?? "");
    const symB = unquote(kw.get("sym_b") ?? pos[2] ?? "");
    const pinB = unquote(kw.get("pin_b") ?? pos[3] ?? "");
    if (!symA || !symB) continue;
    connCount++;

    const resolve = (sym: string, pin: string): string => {
      // A label reference contributes its net name rather than a pin endpoint.
      if (labelRefs.has(sym)) return `@${sym}`; // sentinel node for the label
      return `${sym}.${pin}`;
    };
    const a = resolve(symA, pinA);
    const b = resolve(symB, pinB);
    union(a, b);
    if (labelText.has(symA)) netNameOf.set(a, labelText.get(symA)!);
    if (labelText.has(symB)) netNameOf.set(b, labelText.get(symB)!);
  }

  // Group endpoints into nets; drop the label sentinel nodes from endpoint lists.
  const groups = new Map<string, NormNet>();
  for (const node of parent.keys()) {
    const root = find(node);
    const net = groups.get(root) ?? { name: null, endpoints: [] };
    const nm = netNameOf.get(node);
    if (nm && (net.name === null || nm === "GND")) net.name = nm;
    if (!node.startsWith("@")) net.endpoints.push(node);
    groups.set(root, net);
  }

  return {
    netlist: { components, nets: [...groups.values()] },
    coverage: {
      symbols: symCalls.length,
      labels: labelCalls.length,
      connections: connCount,
      unparsedCalls: 0,
    },
  };
}
