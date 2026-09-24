/**
 * [B20 B2] The ONE route-tree walker (D-12, OD-66). Next serves App Router route handlers from `app/api` AND from
 * `app/.well-known` (the RFC 9728 protected-resource metadata of the MCP endpoint lives there), so every route inventory — the
 * census, the exact-policy bijection, the B01 coverage, the wrapper adoption, the authorization and body matrices, the
 * migration baseline, the confinement gates, the no-purchase tripwire, the identity-header gates — walks both roots through
 * this module. It is the only file under app/ or scripts/ that recognises a route file by name (tripwire: b20-b2-route-tree),
 * and every route handler Next would serve from app/ must be one it lists (b20-b2-route-tree C8).
 *
 * Node-only (fs): imported by tests, generators and the B01 scanners, never by client code.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** The route roots, repository-relative. `app/.well-known` is pinned to exactly one reviewed file (b20-b2-route-tree C2). */
export const ROUTE_TREE_ROOTS = Object.freeze(["app/api", "app/.well-known"] as const);

const posix = (path: string): string => path.replaceAll("\\", "/");
const byPosixPath = (a: string, b: string): number => {
  const left = posix(a);
  const right = posix(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

/** The three filesystem reads the walker makes; the tests walk a virtual tree through it (b20-b2-route-tree C7). */
export interface RouteTreeFs {
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean };
}
const NODE_FS: RouteTreeFs = { existsSync, readdirSync: (path) => readdirSync(path), statSync };

function walk(fs: RouteTreeFs, dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir)) {
    // [B20 B2 review] below a root only tests (Next ignores `_`-prefixed parts) and dependencies are skipped. Dot and route-group
    // directories ARE walked: Next's route discovery has no dot filter (it serves app/.well-known itself), so a route file under
    // app/api/.x/ is served and must be counted by every inventory (b20-b2-route-tree C7, C8).
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(fs, full, out);
    else if (entry === "route.ts") out.push(full);
  }
}

/** `listRouteFiles` over an injected filesystem. */
export function listRouteFilesWith(rootDir: string, fs: RouteTreeFs): string[] {
  const out: string[] = [];
  for (const root of ROUTE_TREE_ROOTS) {
    const dir = join(rootDir, ...root.split("/"));
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) walk(fs, dir, out);
  }
  return out.sort(byPosixPath);
}

/** Every route file under both roots of `rootDir`, as absolute paths sorted by their POSIX spelling; a missing root yields nothing. */
export function listRouteFiles(rootDir: string): string[] {
  return listRouteFilesWith(rootDir, NODE_FS);
}

/** The URL path a route file serves: `app/api/chat/route.ts` is `/api/chat`; dynamic segments stay literal (`[id]`). */
export function routePathOf(rootDir: string, file: string): string {
  const rel = posix(relative(rootDir, file));
  return "/" + rel.replace(/^app\//, "").replace(/\/route\.ts$/, "");
}

/** Whether a repository-relative POSIX path lies below one of the route roots. */
export function isRouteTreePath(relPath: string): boolean {
  return ROUTE_TREE_ROOTS.some((root) => relPath.startsWith(`${root}/`));
}
