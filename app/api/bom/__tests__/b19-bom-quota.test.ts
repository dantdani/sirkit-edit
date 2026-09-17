/**
 * [B19-B I2] Who may spend paid distributor quota, and what a failure may say — at the routes.
 *
 * Six BOM routes price a schematic. Before B19 all six were PUBLIC and all six priced LIVE, so any unauthenticated caller
 * could spend a metered vendor quota; `/api/bom` additionally honoured a caller-sent `forceRefresh`, and reflected the raw
 * error message of any failure back to that caller.
 *
 * After I2:
 *  - `/api/bom` — the BOM workbench, where a person actually asks for fresh prices — is an AUTHENTICATED project read that
 *    spends provider credit, and it is the route that asks for live pricing (and may force a refresh);
 *  - the CSV export, the procurement packet and the three cart routes stay public, and price from the cache ONLY: an
 *    export reflects the BOM the person already priced, and never spends quota on its own;
 *  - no route repeats a failure's own text.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { policyFor } from "@/app/lib/auth/route-policy";

vi.mock("@/app/lib/bom-builder", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, buildBomRows: vi.fn() };
});
vi.mock("@/app/lib/bom/build", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, buildBom: vi.fn(), bomToCsv: vi.fn(() => "csv-bytes\n") };
});
import { buildBomRows } from "@/app/lib/bom-builder";
import { buildBom } from "@/app/lib/bom/build";
const mockRows = vi.mocked(buildBomRows);
const mockBuild = vi.mocked(buildBom);

import { POST as bomPost } from "../route";
import { POST as digikeyPost } from "../cart/digikey/route";
import { POST as lcscPost } from "../cart/lcsc/route";
import { POST as mouserPost } from "../cart/mouser/route";
import { POST as exportCsvPost } from "../export-csv/route";
import { POST as packetPost } from "../procurement-packet/route";

const PROJECT = "proj-b19";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const STATE = { components: [], wires: [], kicadComponents: [{ id: "k1", partId: "p-555", refDes: "U1", value: "NE555", x: 0, y: 0, rotation: 0 }] };
const RESULT = { ok: true, rows: [], estimatedProjectCost: null, riskSummary: { overallScore: 0 } };

function req(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body: JSON.stringify(body) });
}
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
/** The pricing options a build call was made with, whichever builder and argument shape the route used. */
function pricingOptionsOf(call: readonly unknown[]): { live?: unknown; forceRefresh?: unknown } {
  const third = call[2];
  return typeof third === "object" && third !== null ? (third as { live?: unknown; forceRefresh?: unknown }) : { forceRefresh: third };
}

afterEach(() => {
  resetInjectedIdentity();
  vi.unstubAllEnvs();
  mockRows.mockReset();
  mockBuild.mockReset();
});

describe("[B19-B I2] no public route can spend paid distributor quota", () => {
  const PUBLIC = [
    ["export-csv", "/api/bom/export-csv", exportCsvPost],
    ["procurement-packet", "/api/bom/procurement-packet", packetPost],
    ["cart/digikey", "/api/bom/cart/digikey", digikeyPost],
    ["cart/lcsc", "/api/bom/cart/lcsc", lcscPost],
    ["cart/mouser", "/api/bom/cart/mouser", mouserPost],
  ] as const;

  it.each(PUBLIC)("[%s] stays public, and prices from the cache only — it never asks for live pricing or a refresh", async (_name, path, handler) => {
    expect(policyFor(path, "POST")?.requiresAuth, "still public: an export needs no account").toBe(false);
    mockRows.mockResolvedValue(RESULT as never);
    mockBuild.mockResolvedValue(RESULT as never);
    stubProduction(); // a REAL anonymous caller: production auth, no identity
    const res = await handler(req(path, { state: STATE, pricingChoice: "all", forceRefresh: true, live: true }));
    expect(res.status).toBe(200);
    const calls = [...mockRows.mock.calls, ...mockBuild.mock.calls];
    expect(calls).toHaveLength(1);
    const options = pricingOptionsOf(calls[0]!);
    expect(options.live, "a body claiming `live: true` is not a grant").not.toBe(true);
    expect(options.forceRefresh, "and neither is `forceRefresh`").not.toBe(true);
  });
});

describe("[B19-B I2] /api/bom: live pricing belongs to a project member", () => {
  it("is an authenticated project read that is declared to spend provider credit", () => {
    const policy = policyFor("/api/bom", "POST");
    expect(policy).toMatchObject({ requiresAuth: true, providerCredit: true, identitySource: "trusted-context" });
  });

  it("an anonymous caller is refused before any pricing is attempted", async () => {
    stubProduction();
    const res = await bomPost(req("/api/bom", { state: STATE, pricingChoice: "all", forceRefresh: true }));
    expect(res.status).toBe(401);
    expect(mockRows, "no build, so no vendor call").not.toHaveBeenCalled();
  });

  it("a project member gets live pricing, and their refresh is honoured", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: PROJECT, role: "viewer" });
    mockRows.mockResolvedValue(RESULT as never);
    const res = await bomPost(req("/api/bom", { state: STATE, pricingChoice: "digikey", forceRefresh: true }));
    expect(res.status).toBe(200);
    expect(mockRows.mock.calls[0]![1]).toBe("digikey");
    expect(pricingOptionsOf(mockRows.mock.calls[0]!)).toEqual({ live: true, forceRefresh: true });
  });
});

describe("[B19-B I2] a failure is reported, never repeated", () => {
  it("/api/bom answers a build failure with a fixed sentence, not the failure's own text", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: PROJECT, role: "viewer" });
    mockRows.mockRejectedValue(new Error("connect ECONNREFUSED db-7.corp.internal:5432 password=hunter2 key=MOUSER-KEY"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await bomPost(req("/api/bom", { state: STATE, pricingChoice: "all" }));
    expect(res.status).toBe(500);
    const text = await res.text();
    for (const leaked of ["ECONNREFUSED", "db-7", "hunter2", "MOUSER-KEY"]) expect(text, text).not.toContain(leaked);
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "The BOM could not be built. Try again; if it persists, the server log has the details." });
  });

  it.each([
    ["export-csv", "/api/bom/export-csv", exportCsvPost],
    ["procurement-packet", "/api/bom/procurement-packet", packetPost],
    ["cart/digikey", "/api/bom/cart/digikey", digikeyPost],
  ] as const)("[%s] a build failure never repeats its own text either", async (_name, path, handler) => {
    const leaky = new Error("connect ECONNREFUSED db-7.corp.internal:5432 password=hunter2");
    mockRows.mockRejectedValue(leaky);
    mockBuild.mockRejectedValue(leaky);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handler(req(path, { state: STATE, pricingChoice: "none" }));
    const text = await res.text();
    for (const leaked of ["ECONNREFUSED", "db-7", "hunter2"]) expect(text, text).not.toContain(leaked);
  });
});
