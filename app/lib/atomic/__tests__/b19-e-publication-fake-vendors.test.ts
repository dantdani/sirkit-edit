/**
 * [B19-E E4 i] End to end against fake DigiKey and Nexar servers (DistributorEgress injection) and a real, migrated PostgreSQL
 * (PGlite): a live BOM pricing lookup puts the vendors' answers in the offer cache; a publication request then shows those
 * observations as CACHED labels (rawContentHash null) — never Mouser or LCSC — and the request, its approval and its
 * publication make ZERO vendor requests: the review reads the cache only and spends no quota.
 *
 * Reproduced on the unchanged code: the offer-cache observation reader and the request aggregate did not exist.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../db/client", () => ({ getDb: () => orm }));

const vendors = vi.hoisted(() => ({ requests: [] as string[], built: [] as string[] }));
vi.mock("../../distributors/clients", async () => {
  const { makeDigiKeyClient } = await import("../../distributors/digikey");
  const { makeOctopartClient } = await import("../../distributors/octopart");
  const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  const transport: typeof fetch = async (input) => {
    const url = String(input);
    vendors.requests.push(new URL(url).hostname);
    if (url.includes("/oauth2/token")) return json({ access_token: "fake-access", expires_in: 600 });
    if (url.includes("api.digikey.com")) return json({ Products: [{ ManufacturerProductNumber: "NE555DR", Manufacturer: { Name: "Texas Instruments" }, QuantityAvailable: 4_242, StandardPricing: [{ BreakQuantity: 1, UnitPrice: 0.77 }], ProductStatus: { Status: "Active" }, ProductUrl: "https://www.digikey.com/fake-ne555dr" }] });
    return json({ data: { s0: { results: [{ part: { mpn: "NE555DR", manufacturer: { name: "Texas Instruments" }, totalAvail: 1_313, lifecycleStatus: "Production", sellers: [] } }] } } });
  };
  const egress = { fetch: transport, resolve: async (): Promise<string[]> => ["93.184.216.34"] };
  const clients = new Map<string, unknown>();
  const secret = (...parts: string[]) => parts.join("-");
  return {
    admittedDistributorClient: (id: string) => {
      if (!clients.has(id)) {
        vendors.built.push(id);
        clients.set(id, id === "digikey" ? makeDigiKeyClient({ clientId: secret("fake", "dk", "id"), clientSecret: secret("fake", "dk", "secret"), egress }) : id === "octopart" ? makeOctopartClient({ apiKey: secret("fake", "nexar", "token"), egress }) : null);
      }
      return clients.get(id) ?? null;
    },
  };
});

import { getPricingFor } from "../../distributors";
import { clearPricingCache } from "../../distributors/cache";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { loadCachedExternalObservations } from "../../acquisition/offer-cache-observations";
import { PostgresDurableWorkflowRepository } from "../../durable-workflow/server-repository";
import { publishPortableAtomicSnapshot } from "../server-repository";
import { loadAtomicAuthoringIdentity, loadAtomicLinkTargets, loadAtomicRevisionStatus } from "../server-catalog";
import { DurableAtomicPublicationStore, publishAtomicPublicationRequest, resolveAtomicPublicationRequest, submitAtomicPublicationRequest } from "../publication-review";
import { fixtureDeps, GOVERNANCE, human, ne555Spec, USERS } from "./_publication-fixtures";

let partId = "";

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  // [B19-E E4 review] a linked catalog part is the KiCad symbol the revision uses (Timer:NE555D)
  const library = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('Timer', 'test') RETURNING id`);
  partId = (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, mpn, properties, pins, symbol_raw) VALUES ($1, 'NE555D', 'NE555DR', '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id])).rows[0]!.id;
}, 120_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => {
  vi.stubGlobal("fetch", () => { throw new Error("a vendor was reached outside the egress boundary"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearPricingCache();
  resetAdmissionControl();
});

describe("[B19-E E4 i] fake vendors -> offer cache -> a cache-only publication review", () => {
  it("the request shows cached DigiKey and Nexar labels, no Mouser or LCSC, and request, approval and publication call no vendor", async () => {
    // 1. a live pricing lookup (the BOM path) reaches the fake servers and fills the offer cache
    const priced = await getPricingFor([{ partId, mpn: "NE555DR" }], "all", { live: true });
    expect(priced.size).toBe(1);
    expect(new Set(vendors.requests)).toEqual(new Set(["api.digikey.com", "api.nexar.com"]));
    const cached = await pg.db.query<{ distributor: string; mpn: string }>(`SELECT distributor, mpn FROM part_offers ORDER BY distributor`);
    expect(cached.rows).toEqual([{ distributor: "digikey", mpn: "NE555DR" }, { distributor: "octopart-aggregated", mpn: "NE555DR" }]);
    expect(vendors.built).not.toContain("lcsc");

    // 2. from here on, no vendor may be asked
    vendors.requests.length = 0;
    const deps = fixtureDeps({
      workflow: new PostgresDurableWorkflowRepository(),
      loadObservations: loadCachedExternalObservations,
      loadIdentity: loadAtomicAuthoringIdentity,
      loadLinkTargets: loadAtomicLinkTargets, // [B19-E E4 review] the production link reader
      loadRevisionStatus: loadAtomicRevisionStatus,
      publish: publishPortableAtomicSnapshot,
    });
    deps.store = new DurableAtomicPublicationStore(deps.workflow);
    deps.setNow(new Date());
    const { stored } = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.editor, "pcb_editor"), membershipRevision: null, spec: ne555Spec(), links: [{ partId, valueKey: "" }], reason: "publish from the cache" });
    const distributorFacts = stored.request.evidence.facts.filter((fact) => fact.distributor !== null);
    expect(new Set(distributorFacts.map((fact) => fact.sourceId))).toEqual(new Set(["digikey", "octopart"]));
    for (const fact of distributorFacts) expect(fact.distributor).toMatchObject({ basis: "cached", rawContentHash: null });
    expect(stored.request.evidence.facts.some((fact) => /mouser|lcsc/i.test(fact.sourceId))).toBe(false);
    expect(distributorFacts.find((fact) => fact.sourceId === "digikey")!.distributor!.displayName).toBe("DigiKey");

    const manufacturer = stored.request.evidence.facts.find((fact) => fact.property === "manufacturer" && fact.sourceClass === "organization_authored")!;
    deps.setNow(new Date(Date.now() + 60_000));
    const approved = await resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.reviewer, "reviewer"), requestId: stored.request.requestId, decision: "approve", reason: "verified", reviewEvidenceDigest: stored.request.evidence.reviewEvidenceDigest, resolutions: [{ property: "manufacturer", factId: manufacturer.factId, reason: "datasheet" }], factDispositions: [] });
    expect(approved.request.status).toBe("approved");
    deps.setNow(new Date(Date.now() + 120_000));
    const published = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.admin, "project_admin"), requestId: stored.request.requestId, reason: "publish" });
    expect(published.request.status).toBe("published");

    expect(vendors.requests).toEqual([]);
    const links = await pg.db.query<{ atomic_part_revision_id: string }>(`SELECT atomic_part_revision_id FROM parts_atomic_links WHERE part_id = $1`, [partId]);
    expect(links.rows.map((row) => row.atomic_part_revision_id)).toEqual([published.request.publication!.revisionId]);
  }, 60_000);

  it("[B19-E E4 review] tests-b-ttl-state-unreachable: an approval after the loader has dropped the DigiKey row (1 h retention) still matches the request's digest", async () => {
    vendors.requests.length = 0;
    const deps = fixtureDeps({ workflow: new PostgresDurableWorkflowRepository(), loadObservations: loadCachedExternalObservations, loadIdentity: loadAtomicAuthoringIdentity, loadLinkTargets: loadAtomicLinkTargets, loadRevisionStatus: loadAtomicRevisionStatus, publish: publishPortableAtomicSnapshot });
    deps.store = new DurableAtomicPublicationStore(deps.workflow);
    // only DigiKey's row is cached for this case (Nexar's longer retention would keep the vendor spelling in the evidence)
    await pg.db.query(`DELETE FROM part_offers WHERE distributor <> 'digikey'`);
    const refreshed = await pg.db.query<{ ms: number }>(`SELECT (extract(epoch FROM max(last_refreshed_at)) * 1000)::float8 AS ms FROM part_offers WHERE distributor = 'digikey'`);
    const refreshedAt = Number(refreshed.rows[0]!.ms);
    expect(Number.isFinite(refreshedAt)).toBe(true);
    // the request's own spelling differs from the vendors' ("NE555DR") only in case
    deps.setNow(new Date(refreshedAt + 60_000));
    const { stored } = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.editor, "pcb_editor"), membershipRevision: null, spec: ne555Spec({ exactMpn: "ne555dr", profile: "schematic_only" }), links: [], reason: "a request spelled in lower case" });
    expect(stored.request.evidence.facts.some((fact) => fact.sourceId === "digikey")).toBe(true);

    const later = new Date(refreshedAt + 61 * 60_000);
    expect((await loadCachedExternalObservations("ne555dr", later)).filter((observation) => observation.sourceId === "digikey")).toEqual([]);
    deps.setNow(later);
    const manufacturer = stored.request.evidence.facts.find((fact) => fact.property === "manufacturer" && fact.sourceClass === "organization_authored")!;
    const approved = await resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.reviewer, "reviewer"), requestId: stored.request.requestId, decision: "approve", reason: "verified", reviewEvidenceDigest: stored.request.evidence.reviewEvidenceDigest, resolutions: [{ property: "manufacturer", factId: manufacturer.factId, reason: "datasheet" }], factDispositions: [] });
    expect(approved.request.status).toBe("approved");
    expect(vendors.requests).toEqual([]);
  }, 60_000);
});
