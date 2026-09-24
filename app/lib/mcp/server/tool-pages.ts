/**
 * [B20 C2] The pagination of `tools/list` (D20-14, pagination half; OD-97, OD-98). MCP revision 2026-07-28,
 * server/utilities/pagination: an opaque cursor, a page size the server decides, an OPTIONAL `nextCursor`, and an invalid
 * cursor answered `-32602`; server/utilities/caching: every `resultType: "complete"` list result carries `ttlMs` and
 * `cacheScope`, and every page of one list request carries the SAME `cacheScope`.
 *
 * The cursor is SECRETLESS and STATELESS: `tl1-` plus 16 hex of a digest over {schema, listingDigest, pageSize, offset}.
 * The server never stores one; it RECOMPUTES the cursors it would mint for the caller's current served listing and this
 * page size, and accepts a presented value only by exact equality with one of them. So a registry change, a role change or
 * a page-size change invalidates every outstanding cursor (the client restarts from no cursor), and a cursor is never a
 * handle, a key or anything a peer can steer: nothing a peer wrote is hashed, normalized, traced or echoed.
 *
 * The SHAPE of a present cursor (a string of exactly 20 characters, judged BEFORE any pattern) is decided by the caller
 * before the listing is computed, so a malformed cursor costs nothing and answers identically whatever the registry does.
 *
 * Pure: no I/O, clock or randomness; it imports the repository's digest helper and nothing else. Nothing here throws.
 */
import { engineeringDigest } from "../../engineering/stable";

/** OD-97: the page size, and the reviewed bounds a test hook may move within. */
export const MCP_TOOLS_LIST_PAGE_SIZE = 32;
export const MCP_TOOLS_LIST_PAGE_SIZE_BOUNDS = Object.freeze([1, 128] as const);
export const MCP_TOOLS_LIST_CURSOR_SCHEMA = "sirkit.mcp-tools-list-cursor.v1" as const;
export const MCP_TOOLS_LIST_CURSOR_PATTERN = /^tl1-[0-9a-f]{16}$/;
export const MCP_TOOLS_LIST_CURSOR_CHARS = 20;

export type McpToolsListCursorInput = { readonly present: false } | { readonly present: true; readonly value: unknown };
export type McpToolsListPage<T> =
  | { readonly kind: "page"; readonly tools: readonly T[]; readonly nextCursor?: string }
  | { readonly kind: "invalid_cursor" }
  | { readonly kind: "internal" };

/** A page size the server will use: a safe integer inside the reviewed bounds (S3). */
export function validateMcpToolsListPageSize(value: unknown): string[] {
  const [minimum, maximum] = MCP_TOOLS_LIST_PAGE_SIZE_BOUNDS;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return [`page size: must be a safe integer`];
  if (value < minimum || value > maximum) return [`page size: must be within [${minimum}, ${maximum}]`];
  return [];
}

let pageSize: number = MCP_TOOLS_LIST_PAGE_SIZE;
/** The page size in force (the constant, unless a test hook moved it within the bounds). */
export function mcpToolsListPageSize(): number {
  return pageSize;
}
/** Test hook (the `__setMcpServerClockForTests` precedent): false on an invalid value, and the size is left unchanged. */
export function __setMcpToolsListPageSizeForTests(value: unknown): boolean {
  if (validateMcpToolsListPageSize(value).length > 0) return false;
  pageSize = value as number;
  return true;
}
export function __resetMcpToolsListPageSizeForTests(): void {
  pageSize = MCP_TOOLS_LIST_PAGE_SIZE;
}

/** The cursor the server would mint for `offset` of the caller's listing at `size`: 20 characters, `tl1-` and 16 hex. */
export function mcpToolsListCursor(listingDigest: string, size: number, offset: number): string {
  return `tl1-${engineeringDigest({ schema: MCP_TOOLS_LIST_CURSOR_SCHEMA, listingDigest, pageSize: size, offset }).slice(5)}`;
}

/** The SHAPE of a presented cursor: a string, its length judged before the pattern ever sees it (S5). */
export function mcpToolsListCursorWellFormed(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length !== MCP_TOOLS_LIST_CURSOR_CHARS) return false;
  return MCP_TOOLS_LIST_CURSOR_PATTERN.test(value);
}

/**
 * One page of `served.tools`, in the listing's own order. A present cursor is accepted only when it is well-formed AND
 * exactly equal to a cursor this server would mint for THIS listing digest, THIS page size and one of the offsets it
 * actually pages to (`size`, `2·size`, … below the count) — never offset 0, never a non-multiple, never the count. The
 * last page carries no `nextCursor` key at all. Never throws: an unreadable listing or an invalid size is `internal`.
 */
export function mcpToolsListPage<T>(served: { readonly tools: readonly T[]; readonly listingDigest: unknown }, cursor: McpToolsListCursorInput, size: number): McpToolsListPage<T> {
  try {
    if (typeof served !== "object" || served === null) return { kind: "internal" };
    const tools = served.tools;
    const listingDigest = served.listingDigest;
    if (!Array.isArray(tools) || typeof listingDigest !== "string" || listingDigest.length === 0) return { kind: "internal" };
    if (validateMcpToolsListPageSize(size).length > 0) return { kind: "internal" };
    const count = tools.length;
    let offset = 0;
    if (cursor.present) {
      if (!mcpToolsListCursorWellFormed(cursor.value)) return { kind: "invalid_cursor" };
      let matched = -1;
      for (let candidate = size; candidate < count; candidate += size) {
        if (mcpToolsListCursor(listingDigest, size, candidate) === cursor.value) { matched = candidate; break; }
      }
      if (matched < 0) return { kind: "invalid_cursor" };
      offset = matched;
    }
    const page = tools.slice(offset, offset + size);
    const next = offset + size;
    return next < count
      ? { kind: "page", tools: page, nextCursor: mcpToolsListCursor(listingDigest, size, next) }
      : { kind: "page", tools: page };
  } catch {
    return { kind: "internal" };
  }
}
