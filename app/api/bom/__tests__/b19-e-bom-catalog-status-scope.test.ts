/**
 * [B19-E E5 review] Which BOM builds read the atomic catalog status.
 *
 * The line badge is the BOM workbench's (/api/bom: an authenticated project read). The CSV export, the procurement packet and
 * the three cart routes are public, cache-only builds whose outputs never show a status, so they never read the catalog: the
 * status used to be attached on every build, which let an anonymous request of 10 000 distinct atomic ids run twenty catalog
 * queries outside the B19-D table bound. The table bound now counts distinct atomic revision ids too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const probes = vi.hoisted(() => ({ statusCalls: [] as string[][] }));
vi.mock("@/app/lib/db/client", () => {
  // every query chain resolves to no rows: the part catalog is empty and the build still completes
  const chain: unknown = new Proxy(function query() {}, { get: (_target, key) => (key === "then" ? (resolve: (rows: unknown[]) => void) => resolve([]) : chain), apply: () => chain });
  return { getDb: () => chain };
});
vi.mock("@/app/lib/atomic/server-catalog", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadAtomicRevisionStatus: async (ids: readonly string[]) => {
    probes.statusCalls.push([...ids]);
    return new Map();
  },
}));

import { BOM_TABLE_LIMITS } from "@/app/lib/bom-builder";
import { POST as bomPost } from "../route";
import { POST as digikeyPost } from "../cart/digikey/route";
import { POST as lcscPost } from "../cart/lcsc/route";
import { POST as mouserPost } from "../cart/mouser/route";
import { POST as exportCsvPost } from "../export-csv/route";
import { POST as packetPost } from "../procurement-packet/route";

const PROJECT = "proj-b19e-e5";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const req = (path: string, body: unknown): Request => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
const atomicState = (count: number) => ({ components: [], wires: [], kicadComponents: Array.from({ length: count }, (_, index) => ({ id: `k${index}`, partId: "p-shared", refDes: `U${index + 1}`, value: "v", x: 0, y: 0, rotation: 0, atomicPartRevisionId: `atomic_rev_${index}` })) });

const PUBLIC = [
  ["export-csv", "/api/bom/export-csv", exportCsvPost],
  ["procurement-packet", "/api/bom/procurement-packet", packetPost],
  ["cart/digikey", "/api/bom/cart/digikey", digikeyPost],
  ["cart/lcsc", "/api/bom/cart/lcsc", lcscPost],
  ["cart/mouser", "/api/bom/cart/mouser", mouserPost],
] as const;

afterEach(() => {
  resetInjectedIdentity();
  probes.statusCalls.length = 0;
});

describe("[B19-E E5 review] the public BOM builds never read the atomic catalog", () => {
  it.each(PUBLIC)("[%s] builds a table of atomic lines without one status read", async (_name, path, handler) => {
    const res = await handler(req(path, { state: atomicState(3), pricingChoice: "none" }));
    expect(res.status, (await res.clone().text()).slice(0, 200)).toBe(200);
    expect(probes.statusCalls).toEqual([]);
  });

  it("/api/bom (a project member's workbench read) reads the status once and each line carries it", async () => {
    injectAuthorizedPrincipal({ userId: "u-e5", tenantId: "local", projectId: PROJECT, role: "viewer" });
    const res = await bomPost(req("/api/bom", { state: atomicState(3), pricingChoice: "none" }));
    expect(res.status).toBe(200);
    expect(probes.statusCalls.map((ids) => [...ids].sort())).toEqual([["atomic_rev_0", "atomic_rev_1", "atomic_rev_2"]]);
    const body = (await res.json()) as { rows: Array<{ catalogStatus?: unknown }> };
    expect(body.rows.map((row) => row.catalogStatus)).toEqual([0, 1, 2].map(() => ({ state: "unpublished", successorRevisionId: null })));
  });
});

describe("[B19-E E5 review] the table bound counts distinct atomic revision ids", () => {
  it("more distinct atomic revisions than the bound is 413 before any read, on a public and on the member route", async () => {
    const count = BOM_TABLE_LIMITS.distinctAtomicRevisions + 1;
    expect(count).toBeLessThanOrEqual(BOM_TABLE_LIMITS.instances);
    const exported = await exportCsvPost(req("/api/bom/export-csv", { state: atomicState(count), pricingChoice: "none" }));
    expect([exported.status, ((await exported.json()) as { code?: string }).code]).toEqual([413, "BOM_TABLE_TOO_LARGE"]);
    injectAuthorizedPrincipal({ userId: "u-e5", tenantId: "local", projectId: PROJECT, role: "viewer" });
    const member = await bomPost(req("/api/bom", { state: atomicState(count), pricingChoice: "none" }));
    expect([member.status, ((await member.json()) as { code?: string }).code]).toEqual([413, "BOM_TABLE_TOO_LARGE"]);
    expect(probes.statusCalls).toEqual([]);
  });

  it("exactly the bound is accepted", async () => {
    injectAuthorizedPrincipal({ userId: "u-e5", tenantId: "local", projectId: PROJECT, role: "viewer" });
    const res = await bomPost(req("/api/bom", { state: atomicState(BOM_TABLE_LIMITS.distinctAtomicRevisions), pricingChoice: "none" }));
    expect(res.status).toBe(200);
  });
});
