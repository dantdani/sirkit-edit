/**
 * [B19-D I5e row 19] The BOM routes bound the table they are asked to price before touching the database.
 *
 * Every BOM route checked only that `state.components` is an array. `kicadComponents` was iterated unvalidated, and every
 * distinct part id went into one `IN (...)` list, so an eight-megabyte public request of seventy thousand part ids reached
 * the database (and a non-array `kicadComponents` crashed the build).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const db = vi.hoisted(() => ({ reached: 0 }));
vi.mock("@/app/lib/db/client", () => ({ getDb: vi.fn(() => { db.reached++; throw new Error("db must not be reached"); }) }));

import { BOM_TABLE_LIMITS } from "@/app/lib/bom-builder";
import { POST as bomPost } from "../route";
import { POST as mouserPost } from "../cart/mouser/route";
import { POST as exportCsvPost } from "../export-csv/route";
import { POST as packetPost } from "../procurement-packet/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-b19", "x-sirkit-branch-id": "main" };

function req(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
}

function hugeState() {
  const kicadComponents = Array.from({ length: 60_000 }, (_, i) => ({ id: `k${i}`, partId: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`, refDes: `R${i}`, value: "1", x: 0, y: 0, rotation: 0 }));
  return { components: [], wires: [], kicadComponents };
}

afterEach(() => {
  resetInjectedIdentity();
  db.reached = 0;
});

const PUBLIC = [
  ["cart/mouser", "/api/bom/cart/mouser", mouserPost],
  ["procurement-packet", "/api/bom/procurement-packet", packetPost],
  ["export-csv", "/api/bom/export-csv", exportCsvPost],
] as const;

describe("[B19-D I5e row 19] an oversized BOM table is refused before the database", () => {
  it("the request under test fits the routes' 8 MB body bound (so the table bound, not the body bound, is what refuses)", () => {
    expect(new TextEncoder().encode(JSON.stringify({ state: hugeState() })).byteLength).toBeLessThan(8_000_000);
    expect(60_000).toBeGreaterThan(BOM_TABLE_LIMITS.instances);
  });

  it.each(PUBLIC)("[%s] 60 000 part instances → 413 BOM_TABLE_TOO_LARGE, database never reached", async (_name, path, handler) => {
    const res = await handler(req(path, { state: hugeState(), pricingChoice: "none" }));
    expect([413, 422]).toContain(res.status);
    expect(await res.json()).toMatchObject({ ok: false, code: "BOM_TABLE_TOO_LARGE" });
    expect(db.reached).toBe(0);
  });

  it("[/api/bom] the same for a project member", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-b19", role: "viewer" });
    const res = await bomPost(req("/api/bom", { state: hugeState(), pricingChoice: "none" }));
    expect([413, 422]).toContain(res.status);
    expect(await res.json()).toMatchObject({ ok: false, code: "BOM_TABLE_TOO_LARGE" });
    expect(db.reached).toBe(0);
  });

  it.each(PUBLIC)("[%s] a kicadComponents that is not a list of part instances is a 400", async (_name, path, handler) => {
    for (const kicadComponents of ["x", [5], [{ id: "k", refDes: "R1", value: "1" }]]) {
      const res = await handler(req(path, { state: { components: [], wires: [], kicadComponents }, pricingChoice: "none" }));
      expect(res.status, JSON.stringify(kicadComponents)).toBe(400);
    }
    expect(db.reached).toBe(0);
  });

  it("an empty table still builds without the database (baseline)", async () => {
    const res = await exportCsvPost(req("/api/bom/export-csv", { state: { components: [], wires: [], kicadComponents: [] }, pricingChoice: "none" }));
    expect(res.status).toBe(200);
    expect(db.reached).toBe(0);
  });
});
