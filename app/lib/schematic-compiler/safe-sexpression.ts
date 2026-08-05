export type SafeSExpression = { kind: "atom" | "string"; value: string } | { kind: "list"; children: SafeSExpression[] };
export interface SafeSExpressionLimits { maximumBytes: number; maximumDepth: number; maximumTokens: number; }

type Token = { kind: "open" | "close" | "atom" | "string"; value?: string };

export function tokenizeSafeSExpression(source: string, limits: SafeSExpressionLimits): Token[] {
  if (new TextEncoder().encode(source).byteLength > limits.maximumBytes) throw new Error("CD8_SEXPR_BYTE_LIMIT");
  const tokens: Token[] = [];
  let cursor = 0;
  const push = (token: Token) => { tokens.push(token); if (tokens.length > limits.maximumTokens) throw new Error("CD8_SEXPR_TOKEN_LIMIT"); };
  while (cursor < source.length) {
    const character = source[cursor];
    if (/\s/.test(character)) { cursor++; continue; }
    if (character === ";") { while (cursor < source.length && source[cursor] !== "\n") cursor++; continue; }
    if (character === "(") { push({ kind: "open" }); cursor++; continue; }
    if (character === ")") { push({ kind: "close" }); cursor++; continue; }
    if (character === '"') {
      cursor++;
      let value = "", terminated = false;
      while (cursor < source.length) {
        const next = source[cursor++];
        if (next === '"') { terminated = true; break; }
        if (next === "\\") {
          if (cursor >= source.length) throw new Error("CD8_SEXPR_UNTERMINATED_ESCAPE");
          const escaped = source[cursor++];
          value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
        } else value += next;
      }
      if (!terminated) throw new Error("CD8_SEXPR_UNTERMINATED_STRING");
      push({ kind: "string", value });
      continue;
    }
    const start = cursor;
    while (cursor < source.length && !/[\s();]/.test(source[cursor])) cursor++;
    if (start === cursor) throw new Error("CD8_SEXPR_TOKEN_INVALID");
    push({ kind: "atom", value: source.slice(start, cursor) });
  }
  return tokens;
}

export function parseSafeSExpression(source: string, limits: SafeSExpressionLimits): SafeSExpression {
  const tokens = tokenizeSafeSExpression(source, limits), roots: SafeSExpression[] = [], stack: Array<SafeSExpression & { kind: "list" }> = [];
  for (const token of tokens) {
    if (token.kind === "open") {
      if (stack.length + 1 > limits.maximumDepth) throw new Error("CD8_SEXPR_DEPTH_LIMIT");
      const list: SafeSExpression & { kind: "list" } = { kind: "list", children: [] };
      if (stack.length) stack[stack.length - 1].children.push(list); else roots.push(list);
      stack.push(list);
    } else if (token.kind === "close") {
      if (!stack.length) throw new Error("CD8_SEXPR_UNEXPECTED_CLOSE");
      stack.pop();
    } else {
      if (!stack.length) throw new Error("CD8_SEXPR_ATOM_OUTSIDE_ROOT");
      stack[stack.length - 1].children.push({ kind: token.kind, value: token.value! });
    }
  }
  if (stack.length) throw new Error("CD8_SEXPR_UNTERMINATED_LIST");
  if (roots.length !== 1 || roots[0].kind !== "list") throw new Error("CD8_SEXPR_ROOT_CARDINALITY");
  return roots[0];
}

export const atomValue = (node: SafeSExpression | undefined): string | undefined => node && node.kind !== "list" ? node.value : undefined;
export function findChildList(root: SafeSExpression, head: string): SafeSExpression | undefined {
  if (root.kind !== "list") return undefined;
  return root.children.find((child) => child.kind === "list" && atomValue(child.children[0]) === head);
}
