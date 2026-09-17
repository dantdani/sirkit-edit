/**
 * [B19-E E4] e, f — two-person publication from a reviewed request, against a real, migrated PostgreSQL (PGlite): the durable
 * request aggregate (PostgreSQL durable-workflow repository), the E3-hardened publication transaction and the catalog
 * identity reads.
 *
 *  e. the revision, its parts_atomic_links rows and its audit row commit together, and a failure inside the transaction leaves
 *     none of them (the request stays approved and a retry publishes); publishing before approval writes nothing; a mapping
 *     backed only by distributor evidence is still refused by evaluateApproval;
 *  f. the aggregate's payload and its full append-only history (records and replays) carry no distributor price, stock,
 *     description, SKU or URL.
 *
 * Reproduced on the unchanged code: the request aggregate, the draft authoring and the identity read did not exist.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { getTableName, type Table } from "drizzle-orm";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
// [B19-E E4 review follow-up] commitAnswerLost: the transaction commits, and then its caller is answered with a connection failure
const fault = vi.hoisted(() => ({ insertInto: null as string | null, commitAnswerLost: false }));

function database(): typeof orm {
  if (!fault.insertInto && !fault.commitAnswerLost) return orm;
  return new Proxy(orm, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return (run: (tx: unknown) => Promise<unknown>) => target.transaction((tx) => run(new Proxy(tx, {
        get(inner, key, innerReceiver) {
          if (key !== "insert") return Reflect.get(inner, key, innerReceiver);
          return (table: Table) => {
            if (getTableName(table) === fault.insertInto) throw new Error("B19E_E4_INJECTED_INSERT_FAILURE");
            return inner.insert(table);
          };
        },
      }))).then((result) => {
        if (fault.commitAnswerLost) throw new Error("B19E_E4_COMMIT_ANSWER_LOST");
        return result;
      });
    },
  });
}
vi.mock("../../db/client", () => ({ getDb: () => database() }));

import { PostgresDurableWorkflowRepository } from "../../durable-workflow/server-repository";
import { observationFromPricing } from "../../acquisition/quarantine";
import type { PartPricing } from "../../distributors/types";
import { publishPortableAtomicSnapshot, validatePortableSnapshotForPublication } from "../server-repository";
import { loadAtomicAuthoringIdentity, loadAtomicLinkTargets, loadAtomicRevisionStatus } from "../server-catalog";
import { evaluateApproval } from "../validation";
import { ATOMIC_PUBLICATION_AGGREGATE, DurableAtomicPublicationStore, publishAtomicPublicationRequest, PUBLISH_MARKER_LEASE_MS, resolveAtomicPublicationRequest, submitAtomicPublicationRequest, withdrawAtomicPublicationRequest, type StoredAtomicPublication } from "../publication-review";
import type { AtomicPublicationRequest } from "../publication-review-contract";
import type { PortableAtomicSnapshot } from "../types";
import { fixtureDeps, GOVERNANCE, human, ne555Spec, T_SUBMIT, USERS, type FixtureDeps } from "./_publication-fixtures";

const editor = human(USERS.editor, "pcb_editor");
const reviewer = human(USERS.reviewer, "reviewer");
const admin = human(USERS.admin, "project_admin");
const at = (minutes: number) => new Date(T_SUBMIT.getTime() + minutes * 60_000);

const SENTINELS = ["123.456", "98765", "SENTINEL-DESCRIPTION", "SENTINEL-SKU-4412", "sentinel-product-page", "sentinel-datasheet.pdf"];
function sentinelObservation(distributor: "digikey" | "octopart-aggregated") {
  const pricing: PartPricing = {
    distributor, mpn: "NE555DR", manufacturer: "Texas Instruments", description: "SENTINEL-DESCRIPTION 555 timer", datasheet: "https://www.ti.com/sentinel-datasheet.pdf",
    inStock: 98_765, minOrderQty: 1, priceBreaks: [{ qty: 1, price: 123.456, currency: "USD" }], bestUnitPrice: 123.456,
    productUrl: distributor === "digikey" ? "https://www.digikey.com/sentinel-product-page" : "https://octopart.com/sentinel-product-page", package: "Cut Tape", sku: "SENTINEL-SKU-4412",
    lifecycleStatus: "active", lifecycleRaw: "Active", fetchedAt: T_SUBMIT.getTime(),
  };
  return observationFromPricing(pricing, { rawContentHash: null, retrievedAt: T_SUBMIT });
}

let partId = "";
/** [B19-E E4 review] another exact part (LM7805) and a generic part (Device:R, no MPN) */
let lm7805PartId = "";
let resistorPartId = "";
const published: PortableAtomicSnapshot[] = [];

function durableDeps(): FixtureDeps {
  const deps = fixtureDeps({
    workflow: new PostgresDurableWorkflowRepository(),
    loadIdentity: loadAtomicAuthoringIdentity,
    loadLinkTargets: loadAtomicLinkTargets, // [B19-E E4 review] the production link reader
    loadRevisionStatus: loadAtomicRevisionStatus,
    publish: async (input) => {
      published.push(structuredClone(input.snapshot));
      return publishPortableAtomicSnapshot(input);
    },
  });
  deps.store = new DurableAtomicPublicationStore(deps.workflow);
  return deps;
}

function resolution(request: AtomicPublicationRequest) {
  const manufacturer = request.evidence.facts.find((fact) => fact.property === "manufacturer" && fact.sourceClass === "organization_authored")!;
  return { reviewEvidenceDigest: request.evidence.reviewEvidenceDigest, resolutions: [{ property: "manufacturer", factId: manufacturer.factId, reason: "named by the datasheet" }], factDispositions: [] };
}

async function submitAndApprove(deps: FixtureDeps, spec = ne555Spec(), links = [{ partId, valueKey: "" }]): Promise<StoredAtomicPublication> {
  deps.setNow(at(0));
  const { stored } = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, membershipRevision: null, spec, links, reason: "publish the exact part" });
  deps.setNow(at(5));
  return resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: reviewer, requestId: stored.request.requestId, decision: "approve", reason: "verified against the datasheet", ...resolution(stored.request) });
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return (await pg.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params as never)).rows[0]!.n;
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  // [B19-E E4 review] a linked catalog part is the KiCad symbol the revision uses (Timer:NE555D), and names the exact MPN
  const library = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('Timer', 'test') RETURNING id`);
  partId = (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, mpn, properties, pins, symbol_raw) VALUES ($1, 'NE555D', 'NE555DR', '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id])).rows[0]!.id;
  const regulators = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('Regulator_Linear', 'test') RETURNING id`);
  lm7805PartId = (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, mpn, properties, pins, symbol_raw) VALUES ($1, 'L7805', 'LM7805', '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [regulators.rows[0]!.id])).rows[0]!.id;
  const device = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('Device', 'test') RETURNING id`);
  resistorPartId = (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw) VALUES ($1, 'R', '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [device.rows[0]!.id])).rows[0]!.id;
}, 120_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => { fault.insertInto = null; fault.commitAnswerLost = false; });

describe("[B19-E E4 e] the publication transaction", () => {
  it("publishing before approval is refused and writes nothing", async () => {
    const deps = durableDeps();
    deps.setNow(at(0));
    const { stored } = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, membershipRevision: null, spec: ne555Spec(), links: [{ partId, valueKey: "" }], reason: "early" });
    const before = await count("atomic_part_revisions");
    await expect(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: stored.request.requestId, reason: "too early" })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_NOT_APPROVED", status: 409 });
    expect(await count("atomic_part_revisions")).toBe(before);
    expect(await count("atomic_audit_events WHERE action = 'publish'")).toBe(0);
  });

  it("a failure inside the transaction leaves no revision, link or audit row; the request stays approved and a retry publishes", async () => {
    const deps = durableDeps();
    const approved = await submitAndApprove(deps);
    expect(approved.request.status).toBe("approved");
    fault.insertInto = "atomic_audit_events";
    deps.setNow(at(10));
    await expect(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" })).rejects.toBeTruthy();
    fault.insertInto = null;
    expect(await count("atomic_part_revisions")).toBe(0);
    expect(await count("parts_atomic_links")).toBe(0);
    expect(await count("atomic_audit_events")).toBe(0);
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request.status).toBe("approved");

    deps.setNow(at(12));
    const done = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" });
    expect(done.request.status).toBe("published");
    const revisionId = done.request.publication!.revisionId;
    const revisions = await pg.db.query<{ id: string; publication_state: string }>(`SELECT id, publication_state FROM atomic_part_revisions`);
    expect(revisions.rows).toEqual([{ id: revisionId, publication_state: "published" }]);
    const links = await pg.db.query<{ atomic_part_revision_id: string; value_key: string; footprint_full_name: string }>(`SELECT atomic_part_revision_id, value_key, footprint_full_name FROM parts_atomic_links WHERE part_id = $1`, [partId]);
    expect(links.rows).toEqual([{ atomic_part_revision_id: revisionId, value_key: "", footprint_full_name: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" }]);
    const audits = await pg.db.query<{ id: string; actor_id: string; object_id: string }>(`SELECT id, actor_id, object_id FROM atomic_audit_events WHERE action = 'publish'`);
    expect(audits.rows).toEqual([{ id: done.request.publication!.auditId, actor_id: USERS.admin, object_id: revisionId }]);
    // the published revision names two different humans, and it is selectable
    const stored = await pg.db.query<{ revision_data: { reviewHistory: Array<{ action: string; actorId: string }> } }>(`SELECT revision_data FROM atomic_part_revisions WHERE id = $1`, [revisionId]);
    expect(stored.rows[0]!.revision_data.reviewHistory.map((event) => [event.action, event.actorId])).toEqual([["submit", USERS.editor], ["approve", USERS.reviewer], ["publish", USERS.admin]]);
    expect((await loadAtomicRevisionStatus([revisionId])).get(revisionId)).toMatchObject({ state: "published", selectable: true });
    // the aggregate's history is append-only: every transition is its own record
    const history = await deps.workflow.history({ scope: GOVERNANCE, aggregateType: ATOMIC_PUBLICATION_AGGREGATE, aggregateKey: approved.key });
    // [B19-E E4 review] expectation moved: the failed attempt now clears its marker (a fourth "approved" record, with no marker), so
    // a withdrawal is not held for the publication lease after a rollback
    expect(history.map((record) => [(record.payload as AtomicPublicationRequest).status, Boolean((record.payload as AtomicPublicationRequest).publishing)])).toEqual([["pending", false], ["approved", false], ["approved", true], ["approved", false], ["approved", true], ["published", false]]);
  });

  it("a second request for the same exact part reuses its manufacturer, exact part and logical part, and takes the next revision number", async () => {
    const deps = durableDeps();
    const approved = await submitAndApprove(deps, ne555Spec({ datasheet: { url: "https://www.ti.com/lit/ds/symlink/ne555.pdf", locator: "revised datasheet, Table 1" } }), []);
    deps.setNow(at(20));
    const done = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish the revised citation" });
    const rows = await pg.db.query<{ id: string; logical_part_id: string; exact_part_id: string; revision: number }>(`SELECT id, logical_part_id, exact_part_id, revision FROM atomic_part_revisions ORDER BY revision`);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[1]!.id).toBe(done.request.publication!.revisionId);
    expect(rows.rows[1]!.logical_part_id).toBe(rows.rows[0]!.logical_part_id);
    expect(rows.rows[1]!.exact_part_id).toBe(rows.rows[0]!.exact_part_id);
    expect(rows.rows[1]!.revision).toBeGreaterThan(rows.rows[0]!.revision);
    expect(await count("atomic_exact_parts")).toBe(1);
    expect(await count("atomic_manufacturers")).toBe(1);
  });

  it("a mapping backed only by distributor evidence is still refused by evaluateApproval, and publishes nothing", async () => {
    const snapshot = structuredClone(published.at(-1)!);
    // the pin-to-pad mapping rests on the terminal table alone (the KiCad library carries no manufacturer terminal table): a
    // table whose source were a distributor catalog would leave the mapping with no engineering authority
    const organization = snapshot.sources.find((source) => source.sourceClass === "organization_authored")!;
    organization.sourceClass = "distributor_catalog";
    const context = {
      symbols: new Map([[snapshot.symbol.versionId, snapshot.symbol]]), footprints: new Map([[snapshot.footprint!.versionId, snapshot.footprint!]]), models: new Map(), mappings: new Map([[snapshot.mapping!.id, snapshot.mapping!]]),
      claims: new Map(), licenses: new Map(snapshot.licenses.map((license) => [license.id, license])), evidence: new Map(snapshot.evidence.map((item) => [item.id, item])),
      sourceRecords: new Map(snapshot.sourceRecords.map((item) => [item.id, item])), sources: new Map(snapshot.sources.map((item) => [item.id, item])),
    };
    expect(snapshot.mapping!.evidenceIds.every((id) => snapshot.sourceRecords.find((record) => record.id === snapshot.evidence.find((item) => item.id === id)?.sourceRecordId)?.sourceId === organization.id)).toBe(true);
    const decision = evaluateApproval(snapshot.atomicRevision, "pcb_assignable", context);
    expect(decision.eligible).toBe(false);
    expect(decision.blockers.join(" ")).toMatch(/rests on no engineering-authoritative evidence/);
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", { actorId: USERS.admin, actorRole: "publisher" })).toThrow(/rests on no engineering-authoritative evidence/);
    const before = { revisions: await count("atomic_part_revisions"), audits: await count("atomic_audit_events") };
    await expect(publishPortableAtomicSnapshot({ snapshot, actorId: USERS.admin, actorRole: "publisher", requiredProfile: "pcb_assignable", reason: "distributor-only mapping" })).rejects.toThrow(/engineering-authoritative/);
    expect({ revisions: await count("atomic_part_revisions"), audits: await count("atomic_audit_events") }).toEqual(before);
  });
});

describe("[B19-E E4 f] retention: no distributor values in the aggregate or its history", () => {
  it("the payload, every history record and every replay carry no distributor price, stock, description, SKU or URL", async () => {
    const deps = durableDeps();
    deps.observations = [sentinelObservation("digikey"), sentinelObservation("octopart-aggregated")];
    const spec = ne555Spec({ exactMpn: "NE555DR", datasheet: { url: null, locator: "datasheet table 1" } });
    const approved = await submitAndApprove(deps, spec, []);
    expect(approved.request.evidence.facts.some((fact) => fact.sourceId === "digikey")).toBe(true);
    deps.setNow(at(30));
    const done = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" });
    expect(done.request.status).toBe("published");
    const records = await pg.db.query<{ payload: string }>(`SELECT payload::text AS payload FROM durable_workflow_records WHERE aggregate_type = $1`, [ATOMIC_PUBLICATION_AGGREGATE]);
    const replays = await pg.db.query<{ result: string }>(`SELECT result::text AS result FROM durable_workflow_replays`);
    const outbox = await pg.db.query<{ payload: string }>(`SELECT payload::text AS payload FROM durable_workflow_outbox`);
    expect(records.rows.length).toBeGreaterThanOrEqual(4);
    const text = [...records.rows.map((row) => row.payload), ...replays.rows.map((row) => row.result), ...outbox.rows.map((row) => row.payload)].join("\n");
    for (const sentinel of SENTINELS) expect(text, sentinel).not.toContain(sentinel);
    expect(text).not.toMatch(/digikey\.com|octopart\.com/);
    // what IS kept for the distributor facts: ids, value hashes, source ids, times and the registry version
    const kept = done.request.evidence.facts.filter((fact) => fact.sourceId === "digikey");
    for (const fact of kept) expect({ value: fact.value, locator: fact.locator, hash: /^[0-9a-f]{64}$/.test(fact.valueHash), retrievedAt: fact.distributor?.retrievedAt }).toEqual({ value: null, locator: null, hash: true, retrievedAt: T_SUBMIT.toISOString() });
  });
});

describe("[B19-E E4 review] the confirmed findings against PostgreSQL", () => {
  const rows = async () => ({ revisions: await count("atomic_part_revisions"), audits: await count("atomic_audit_events"), links: await count("parts_atomic_links") });

  it("security-unreviewed-links: the production link reader refuses a link to another exact part or another symbol at submit", async () => {
    const deps = durableDeps();
    deps.setNow(at(50));
    for (const [link, detail] of [[{ partId: lm7805PartId, valueKey: "" }, "LINK_MPN_MISMATCH"], [{ partId: resistorPartId, valueKey: "10k" }, "LINK_SYMBOL_MISMATCH"], [{ partId: "00000000-0000-4000-8000-000000000000", valueKey: "" }, "LINK_PART_NOT_FOUND"]] as const) {
      await expect(submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, membershipRevision: null, spec: ne555Spec({ exactMpn: "NE555PWR" }), links: [link], reason: "link another part" }), detail).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_LINK_REFUSED", status: 409, detail: [detail] });
    }
    // the NE555D part is already linked by the publication above
    await expect(submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, membershipRevision: null, spec: ne555Spec({ exactMpn: "NE555DR" }), links: [{ partId, valueKey: "" }], reason: "link again" })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_LINK_REFUSED", detail: ["LINK_ALREADY_LINKED"] });
  });

  it("security-unreviewed-links: the publication transaction itself refuses a link to a catalog part whose MPN is another part's, and writes nothing", async () => {
    const deps = durableDeps();
    // the review's own checks are bypassed: only the transaction stands between the link and the catalog
    deps.publish = async (input) => publishPortableAtomicSnapshot({ ...input, links: [{ partId: lm7805PartId, valueKey: "" }] });
    const approved = await submitAndApprove(deps, ne555Spec({ exactMpn: "NE555DRG4" }), []);
    expect(approved.request.status).toBe("approved");
    const before = await rows();
    deps.setNow(at(60));
    const error = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" }).then(() => null, (caught: { code?: string; cause?: unknown }) => caught);
    expect(error?.code).toBe("ATOMIC_PUBLICATION_PUBLISH_REFUSED");
    expect(String((error?.cause as Error | undefined)?.message)).toMatch(/MPN/);
    expect(await rows()).toEqual(before);
    expect(await count("parts_atomic_links WHERE part_id = $1", [lm7805PartId])).toBe(0);
  });

  it("security-approved-request-authority-not-rechecked: an approval whose approver lost membership is retired at publication and writes nothing", async () => {
    const deps = durableDeps();
    const approved = await submitAndApprove(deps, ne555Spec({ exactMpn: "NE555DT" }), []);
    const approver = await deps.memberships.loadActiveMembership({ tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId, userId: USERS.reviewer });
    deps.memberships.set({ ...approver!, state: "revoked", version: 2 });
    const before = await rows();
    deps.setNow(at(70));
    await expect(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_RETIRED", status: 409, detail: ["APPROVER_MEMBERSHIP_REVOKED"] });
    expect(await rows()).toEqual(before);
    const history = await deps.workflow.history({ scope: GOVERNANCE, aggregateType: ATOMIC_PUBLICATION_AGGREGATE, aggregateKey: approved.key });
    expect((history.at(-1)!.payload as AtomicPublicationRequest)).toMatchObject({ status: "retired", retirement: { reasonCode: "APPROVER_MEMBERSHIP_REVOKED" } });
  });

  it("security-idempotency-key-poisoning: keys planted through ordinary requests cannot make a publication a no-op on the PostgreSQL repository", async () => {
    const deps = durableDeps();
    const approved = await submitAndApprove(deps, ne555Spec({ exactMpn: "NE555DRE4" }), []);
    for (const [exactMpn, key] of [["NE555PE4", `atomic-publication-publishing:${approved.request.requestId}:${approved.revision}`], ["NE555PE3", `atomic-publication-published:${approved.request.requestId}:${approved.revision + 1}`]] as const) {
      await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, membershipRevision: null, spec: ne555Spec({ exactMpn }), links: [], reason: "plant", idempotencyKey: key });
    }
    deps.setNow(at(80));
    const done = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" });
    expect(done.request.status).toBe("published");
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request).toMatchObject({ status: "published", publication: { revisionId: done.request.publication!.revisionId } });
  });
});

describe("[B19-E E4 review follow-up] the independent checker's items against PostgreSQL", () => {
  const editor2 = human(USERS.editor2, "pcb_editor");
  const statuses = (payloads: AtomicPublicationRequest[], replacingId: string | null = null) => payloads.map((payload) => [payload.requestId === replacingId ? "replacing" : "own", payload.status, Boolean(payload.publishing)]);

  it("correctness-record-publication-onto-replaced-request: a late publication never records onto the request that replaced its own; the revision stays in the catalog", async () => {
    const deps = durableDeps();
    const spec = ne555Spec({ exactMpn: "NE555DRQ1" });
    const approved = await submitAndApprove(deps, spec, []);
    const markedAt = at(90);
    let replacingId: string | null = null;
    let revisionId: string | null = null;
    deps.publish = async (input) => {
      // the transaction is still uncommitted after the lease: the requester withdraws and an editor asks again (same key)
      deps.setNow(new Date(markedAt.getTime() + PUBLISH_MARKER_LEASE_MS + 60_000));
      await withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: approved.request.requestId, reason: "the lease ran out" });
      replacingId = (await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor2, membershipRevision: null, spec, links: [], reason: "ask again" })).stored.request.requestId;
      revisionId = input.snapshot.atomicRevision.id;
      return publishPortableAtomicSnapshot(input);
    };
    deps.setNow(markedAt);
    const error = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" }).then(() => null, (caught: unknown) => caught);
    expect(error).toMatchObject({ code: "ATOMIC_PUBLICATION_REQUEST_REPLACED", status: 409, detail: [approved.request.requestId, replacingId] });
    const history = await deps.workflow.history({ scope: GOVERNANCE, aggregateType: ATOMIC_PUBLICATION_AGGREGATE, aggregateKey: approved.key });
    expect(statuses(history.map((record) => record.payload as AtomicPublicationRequest), replacingId)).toEqual([["own", "pending", false], ["own", "approved", false], ["own", "approved", true], ["own", "withdrawn", true], ["replacing", "pending", false]]);
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request).toMatchObject({ requestId: replacingId, status: "pending" });
    expect((await loadAtomicRevisionStatus([revisionId!])).get(revisionId!)).toMatchObject({ state: "published", selectable: true });
  });

  it("correctness-ambiguous-publish-failure-clears-marker: only a failure inside the transaction is a known rollback; an answer lost at COMMIT with an unreadable status keeps the marker, and a retry records the one revision", async () => {
    const deps = durableDeps();
    const rejections: unknown[] = [];
    deps.publish = async (input) => publishPortableAtomicSnapshot(input).catch((caught: unknown) => { rejections.push(caught); throw caught; });

    // inside the transaction: rolled back, never marked as an unknown outcome
    const rolledBack = await submitAndApprove(deps, ne555Spec({ exactMpn: "NE555DRQ2" }), []);
    fault.insertInto = "atomic_audit_events";
    deps.setNow(at(100));
    await expect(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: rolledBack.request.requestId, reason: "publish" })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_PUBLISH_REFUSED" });
    fault.insertInto = null;
    expect((rejections.at(-1) as { commitOutcomeUnknown?: unknown }).commitOutcomeUnknown).toBeUndefined();
    expect((await deps.store.get(GOVERNANCE, rolledBack.key))!.request.publishing).toBeUndefined();

    // at COMMIT: the revision committed, the answer was lost, and the status read that should decide fails
    const lost = await submitAndApprove(deps, ne555Spec({ exactMpn: "NE555DRQ3" }), []);
    let statusDown = false;
    deps.loadRevisionStatus = async (ids) => { if (statusDown) throw new Error("B19E_E4_STATUS_READ_FAILED"); return loadAtomicRevisionStatus(ids); };
    const publishing = deps.publish;
    deps.publish = async (input) => {
      fault.commitAnswerLost = true;
      try {
        return await publishing(input);
      } finally {
        fault.commitAnswerLost = false;
        statusDown = true;
      }
    };
    deps.setNow(at(110));
    await expect(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: lost.request.requestId, reason: "publish" })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN", status: 409 });
    expect((rejections.at(-1) as { commitOutcomeUnknown?: unknown }).commitOutcomeUnknown).toBe(true);
    const kept = (await deps.store.get(GOVERNANCE, lost.key))!.request;
    expect(kept.status).toBe("approved");
    const revisionId = kept.publishing!.revisionId;
    expect(await count("atomic_part_revisions WHERE id = $1", [revisionId])).toBe(1);

    statusDown = false;
    deps.publish = publishing;
    deps.setNow(at(111));
    const recorded = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.admin2, "project_admin"), requestId: lost.request.requestId, reason: "again" });
    expect(recorded.request).toMatchObject({ status: "published", publication: { revisionId, publishedBy: { actorId: USERS.admin } } });
    expect(await count("atomic_part_revisions WHERE exact_part_id = (SELECT exact_part_id FROM atomic_part_revisions WHERE id = $1)", [revisionId])).toBe(1);
    const history = await deps.workflow.history({ scope: GOVERNANCE, aggregateType: ATOMIC_PUBLICATION_AGGREGATE, aggregateKey: lost.key });
    expect(statuses(history.map((record) => record.payload as AtomicPublicationRequest))).toEqual([["own", "pending", false], ["own", "approved", false], ["own", "approved", true], ["own", "published", false]]);
  });
});
