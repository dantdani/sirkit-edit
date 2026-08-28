/**
 * B16.0.11 §C/§E — BOM confinement gate.
 *
 * Proves structurally that:
 *  - all 12 BOM route methods are canonical wrappers (exact provenance);
 *  - NO BOM route imports or invokes the removed `bomScope` (no parallel
 *    authorization path that could bypass the canonical wrapper);
 *  - `_scope.ts` is Request-FREE (no authorizeRequest import, no Request
 *    parameter) — it only projects the trusted context;
 *  - no BOM route consumes a raw URL/Request (query flows only through the
 *    wrapper's bounded frozen projection).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRouteMethodForm } from "./_boundary-analysis";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

const BOM_METHODS: ReadonlyArray<[string, string]> = [
  ["POST", "app/api/bom/route.ts"],
  ["POST", "app/api/bom/cart/digikey/route.ts"],
  ["POST", "app/api/bom/cart/lcsc/route.ts"],
  ["POST", "app/api/bom/cart/mouser/route.ts"],
  ["POST", "app/api/bom/export-csv/route.ts"],
  ["POST", "app/api/bom/procurement-packet/route.ts"],
  ["POST", "app/api/bom/diff/route.ts"],
  ["GET", "app/api/bom/notifications/route.ts"],
  ["PATCH", "app/api/bom/notifications/route.ts"],
  ["DELETE", "app/api/bom/notifications/route.ts"],
  ["POST", "app/api/bom/snapshot/route.ts"],
  ["GET", "app/api/bom/snapshot/route.ts"],
];

describe("B16.0.11 — all 12 BOM methods are canonical wrappers", () => {
  it.each(BOM_METHODS)("%s %s classifies canonical-wrapper by exact provenance", (method, rel) => {
    const c = classifyRouteMethodForm(read(rel), method, join(ROOT, rel), ROOT);
    expect(c.form, `${method} ${rel}`).toBe("canonical-wrapper");
  });
});

describe("B16.0.11 §E — no bomScope bypass path remains", () => {
  const routeFiles = [...new Set(BOM_METHODS.map(([, rel]) => rel))];
  it.each(routeFiles)("%s does not import or invoke bomScope", (rel) => {
    const src = read(rel);
    expect(src.includes("bomScope"), rel).toBe(false); // bomOwnershipScope only
    expect(/bomOwnershipScope\(/.test(src) || !rel.includes("diff") && !rel.includes("snapshot") && !rel.includes("notifications"), rel).toBe(true);
  });
  it("_scope.ts is Request-free: no authorizeRequest import, no Request parameter, no exported bomScope", () => {
    const src = read("app/api/bom/_scope.ts");
    expect(src.includes("authorizeRequest")).toBe(false);
    expect(/\(\s*request\s*:\s*Request/.test(src)).toBe(false);
    expect(/export (async )?function bomScope\b/.test(src)).toBe(false);
    expect(src.includes("export function bomOwnershipScope")).toBe(true);
    expect(src.includes("BOM_FORBIDDEN_BODY_KEYS")).toBe(true);
    expect(src.includes("export function bomNotFound")).toBe(true);
  });
  it("no BOM route constructs a raw URL from a request (query flows only through meta.query)", () => {
    for (const rel of routeFiles) {
      const src = read(rel);
      expect(/new URL\(\s*req(uest)?\.url/.test(src), rel).toBe(false);
    }
  });
  it("repository-wide: NO production module invokes a bomScope( call anymore", () => {
    // the helper is deleted; this pins against re-introduction under the old name
    for (const rel of routeFiles) expect(read(rel).match(/bomScope\s*\(/), rel).toBeNull();
    expect(read("app/api/bom/_scope.ts").match(/bomScope\s*\(/)).toBeNull();
  });
});
