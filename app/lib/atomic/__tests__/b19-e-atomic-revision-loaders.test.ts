/**
 * [B19-E E3 e, f, g] Who reads a withdrawn revision, against a real, migrated PostgreSQL (PGlite).
 *
 * OD-38: a deprecated or superseded revision keeps serving the pins that already name it (export, PCB sync, component
 * authority) but is excluded from every NEW selection, binding and link read; a revoked revision fails closed everywhere.
 *
 * Reproduced before the fix (recorded in the E3 report): there was no status record or status loader; the published loader,
 * the chat's raw-SQL confirmation, the catalog list, the KiCad category, catalog search, `/api/parts/[id]` and
 * `getFullPartsByIds` all served every `publication_state = 'published'` row with `approved: true` hard-coded, so Build
 * auto-layout attached authority from any linked revision; and a bind replay answered `alreadyBound` without looking at the
 * revision again.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { captureSchemaSnapshot } from "../../db/migrations/verify-schema";
import * as verifySchema from "../../db/migrations/verify-schema";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../db/client", () => ({ getDb: () => orm }));
// catalog search runs lexical-only here: no embedding provider, and no reranking provider can be constructed
vi.mock("@/app/lib/embeddings", async (original) => ({ ...(await original() as object), embedQuery: vi.fn(async () => { throw new Error("B19E_NO_EMBEDDING_PROVIDER"); }) }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { constructor() { throw new Error("B19E_NO_RERANK_PROVIDER"); } } }));

import { createAtomicRevision } from "../catalog";
import * as serverCatalog from "../server-catalog";
import { publishPortableAtomicSnapshot, withdrawPublishedAtomicRevision } from "../server-repository";
import { loadAtomicSearchView } from "../server-search";
import { normalizeValueKey } from "../value-key";
import { semanticHash } from "../stable";
import type { AtomicPartRevision, PortableAtomicSnapshot } from "../types";
import { blinkerCatalog, BLINKER_PART_IDS } from "@/app/lib/fixture-runtime/blinker/catalog";
import * as cancellable from "@/app/api/chat/authority-cancellable-reads";
import type { CancellableAuthorityQuery, CancellableAuthoritySqlClient } from "@/app/api/chat/authority-cancellable-reads";
import { GET as atomicCatalogGet } from "@/app/api/components/atomic/route";
import { GET as kicadCategoryGet } from "@/app/api/kicad/v1/parts/category/[id]/route";
import { GET as partDetailGet } from "@/app/api/parts/[id]/route";
import { getFullPartsByIds, searchPartsForAI } from "@/app/lib/parts-search";
import { autoLayoutBuild } from "@/lib/build-auto-layout";
import { bindAtomicSelection } from "@/app/lib/physical-binding/atomic-binding";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "@/app/lib/physical-binding/repository";
import type { EngineeringActor } from "@/app/lib/engineering/types";

const PUBLISHER = { actorId: "user:fixture-publisher", actorRole: "publisher" as const };
const REASON = "B19-E E3 loader proof";

function snapshotFor(partId: string, value: string): PortableAtomicSnapshot {
  const catalog = blinkerCatalog();
  return structuredClone(catalog.snapshots.get(catalog.revisionFor(partId, value)!)!);
}

function successorOf(snapshot: PortableAtomicSnapshot): PortableAtomicSnapshot {
  const { id: _id, semanticHash: _hash, validatorVersion: _validator, schemaVersion: _schema, ...rest } = structuredClone(snapshot.atomicRevision);
  void _id; void _hash; void _validator; void _schema;
  const next = structuredClone(snapshot);
  next.atomicRevision = structuredClone(createAtomicRevision({ ...rest, revision: rest.revision + 1, policyVersion: "b19-e-successor/1" })) as AtomicPartRevision;
  return next;
}

/** postgres.js-shaped cancellable client over PGlite, so the chat's raw SQL runs against the same database. */
const rawClient: CancellableAuthoritySqlClient = {
  unsafe(text: string, params: string[]): CancellableAuthorityQuery {
    const promise = pg.db.query<Record<string, unknown>>(text, params).then((result) => result.rows);
    return Object.assign(promise, { cancel: () => {} }) as unknown as CancellableAuthorityQuery;
  },
};

// P published; D deprecated; S superseded by S2; R revoked; S2 published (a successor); M never existed
const ids = { P: "", D: "", S: "", R: "", S2: "", M: "atomic_b19e_missing" };
let partId = "";
/** [B19-E E3 review] a part with a value-agnostic '' default AND value links to withdrawn or missing revisions */
let defaultedPartId = "";

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const P = snapshotFor(BLINKER_PART_IDS.timer, "NE555");
  const D = snapshotFor(BLINKER_PART_IDS.resistor, "10k");
  const S = snapshotFor(BLINKER_PART_IDS.resistor, "56k");
  const R = snapshotFor(BLINKER_PART_IDS.resistor, "330");
  const S2 = successorOf(S);
  for (const snapshot of [P, D, S, R, S2]) await publishPortableAtomicSnapshot({ snapshot, ...PUBLISHER, requiredProfile: "pcb_assignable", reason: REASON });
  Object.assign(ids, { P: P.atomicRevision.id, D: D.atomicRevision.id, S: S.atomicRevision.id, R: R.atomicRevision.id, S2: S2.atomicRevision.id });
  await withdrawPublishedAtomicRevision({ ...PUBLISHER, revisionId: ids.D, to: "deprecated", reason: REASON });
  await withdrawPublishedAtomicRevision({ ...PUBLISHER, revisionId: ids.S, to: "superseded", successorRevisionId: ids.S2, reason: REASON });
  await withdrawPublishedAtomicRevision({ ...PUBLISHER, revisionId: ids.R, to: "revoked", reason: REASON });

  const library = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('Device', 'Resistor') RETURNING id`);
  partId = (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw) VALUES ($1, 'R', '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id])).rows[0]!.id;
  const link = (part: string, value: string, revisionId: string) => pg.db.query(
    `INSERT INTO parts_atomic_links (part_id, value_key, atomic_part_revision_id, symbol_asset_version_id, footprint_asset_version_id, mapping_certificate_id, footprint_full_name) VALUES ($1, $2, $3, 'sym', 'fp', 'map', 'Resistor_SMD:R_0805_2012Metric')`,
    [part, normalizeValueKey(value), revisionId],
  );
  // links written directly (the seed's shape): one per value, no value-agnostic default
  for (const [value, revisionId] of [["1k", ids.P], ["2k", ids.D], ["3k", ids.S], ["4k", ids.R], ["5k", ids.M]] as const) await link(partId, value, revisionId);
  const searchPart = async (name: string, generic: boolean) => (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw, is_generic) VALUES ($1, $2, '{}'::jsonb, '[]'::jsonb, '', $3) RETURNING id`, [library.rows[0]!.id, name, generic])).rows[0]!.id;
  const authorityPart = await searchPart("b19eauthority", false);
  await link(authorityPart, "1k", ids.P);
  await link(authorityPart, "2k", ids.D);
  const withdrawnGeneric = await searchPart("b19ewithdrawngeneric", true);
  await link(withdrawnGeneric, "2k", ids.D);
  await link(withdrawnGeneric, "4k", ids.R);
  const selectableGeneric = await searchPart("b19eselectablegeneric", true);
  await link(selectableGeneric, "1k", ids.P);
  defaultedPartId = await searchPart("b19edefaulted", false);
  await link(defaultedPartId, "", ids.S2);
  await link(defaultedPartId, "2k", ids.D);
  await link(defaultedPartId, "5k", ids.M);
}, 180_000);
afterAll(async () => { await pg?.close(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("[B19-E E3 e] status and loaders: selectable for new selection, pinned for existing pins (OD-38)", () => {
  it("loadAtomicRevisionStatus reports each revision's catalog state, successor and selectability; unknown ids are absent", async () => {
    const status = await serverCatalog.loadAtomicRevisionStatus([ids.P, ids.D, ids.S, ids.R, ids.S2, ids.M, ids.P]);
    expect([...status.keys()].sort()).toEqual([ids.P, ids.D, ids.S, ids.R, ids.S2].sort());
    expect(status.get(ids.P)).toMatchObject({ state: "published", selectable: true, pinnable: true });
    expect(status.get(ids.D)).toMatchObject({ state: "deprecated", selectable: false, pinnable: true });
    expect(status.get(ids.S)).toMatchObject({ state: "superseded", selectable: false, pinnable: true, successorRevisionId: ids.S2 });
    expect(status.get(ids.R)).toMatchObject({ state: "revoked", selectable: false, pinnable: false });
    expect(status.get(ids.S2)).toMatchObject({ state: "published", selectable: true });
    expect((await serverCatalog.loadAtomicRevisionStatus([])).size).toBe(0);
  });

  it("the selectable loader refuses deprecated, superseded and revoked; the pinned loader keeps deprecated and superseded and refuses revoked", async () => {
    const shape = async (load: (id: string) => Promise<PortableAtomicSnapshot | null>) => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([key, id]) => [key, (await load(id))?.atomicRevision.id === id])));
    expect(await shape(serverCatalog.loadSelectablePortableSnapshot)).toEqual({ P: true, D: false, S: false, R: false, S2: true, M: false });
    expect(await shape(serverCatalog.loadPublishedPortableSnapshot)).toEqual({ P: true, D: true, S: true, R: false, S2: true, M: false });
  });

  it("parity table: the drizzle loaders and the chat's raw-SQL reads agree for every state, in both modes", async () => {
    const rows: Array<[string, string, boolean, boolean, boolean]> = [];
    for (const [key, id] of Object.entries(ids)) {
      for (const mode of ["pinned", "selectable"] as const) {
        const drizzleSide = (mode === "pinned" ? await serverCatalog.loadPublishedPortableSnapshot(id) : await serverCatalog.loadSelectablePortableSnapshot(id)) !== null;
        const confirmation = (await cancellable.confirmPublishedAtomicRevisionCancellable(rawClient, id, undefined, mode)) !== null;
        const pinFacts = (await cancellable.loadPublishedSymbolPinFactsCancellable(rawClient, id, undefined, mode)) !== null;
        rows.push([key, mode, drizzleSide, confirmation, pinFacts]);
      }
    }
    expect(rows.filter(([, , drizzleSide, confirmation, pinFacts]) => drizzleSide !== confirmation || drizzleSide !== pinFacts)).toEqual([]);
    expect(rows.filter(([, , served]) => served).map(([key, mode]) => `${key}:${mode}`)).toEqual(["P:pinned", "P:selectable", "D:pinned", "S:pinned", "S2:pinned", "S2:selectable"]);
  });

  it("the default raw-SQL mode is the pinned one (existing pins keep their authority)", async () => {
    expect(await cancellable.confirmPublishedAtomicRevisionCancellable(rawClient, ids.D, undefined)).not.toBeNull();
    expect(await cancellable.confirmPublishedAtomicRevisionCancellable(rawClient, ids.R, undefined)).toBeNull();
    expect(await cancellable.loadPublishedSymbolPinFactsCancellable(rawClient, ids.R, undefined)).toBeNull();
  });
});

describe("[B19-E E3 e] new-selection reads list only selectable revisions", () => {
  it("the atomic catalog list and its snapshot id exclude withdrawn revisions", async () => {
    const response = await atomicCatalogGet(new Request("http://localhost/api/components/atomic?limit=100"));
    const body = await response.json() as { ok: boolean; items: Array<{ id: string; publicationState: string }>; catalogSnapshotId: string };
    expect(body.ok).toBe(true);
    expect(body.items.map((item) => item.id).sort()).toEqual([ids.P, ids.S2].sort());
    // [B19-E E3 review] the snapshot id is derived (as the route derives it) from the same selectable set the items list
    expect(body.catalogSnapshotId).toBe(`catalog_${semanticHash([ids.P, ids.S2].sort())}`);
  });

  it("the KiCad published category lists only selectable revisions", async () => {
    const token = ["b19e", "kicad", "fake"].join("-");
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", token);
    const response = await kicadCategoryGet(new Request("http://localhost/api/kicad/v1/parts/category/published.json", { headers: { authorization: `Token ${token}` } }), { params: Promise.resolve({ id: "published.json" }) });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Array<{ id: string }>).map((item) => item.id).sort()).toEqual([ids.P, ids.S2].sort());
  });

  it("catalog search sees only selectable revisions", async () => {
    const view = await loadAtomicSearchView();
    expect([...view.publishedRevisionIds].sort()).toEqual([ids.P, ids.S2].sort());
    expect([...view.revisions.keys()].sort()).toEqual([ids.P, ids.S2].sort());
  });
});

describe("[B19-E E3 f] atomicAssignments are omitted for withdrawn or missing revisions; approved is derived", () => {
  it("getFullPartsByIds carries only the selectable link, approved", async () => {
    const [part] = await getFullPartsByIds([partId]);
    expect(part!.atomicAssignments).toEqual({ [normalizeValueKey("1k")]: { revisionId: ids.P, symbolVersionId: "sym", footprintVersionId: "fp", mappingCertificateId: "map", footprintFullName: "Resistor_SMD:R_0805_2012Metric", approved: true } });
  });

  it("/api/parts/[id] carries only the selectable link, approved", async () => {
    const response = await partDetailGet(new Request(`http://localhost/api/parts/${partId}`), { params: Promise.resolve({ id: partId }) });
    const body = await response.json() as { ok: boolean; part: { atomicAssignments?: Record<string, { revisionId: string; approved: boolean }> } };
    expect(body.ok).toBe(true);
    expect(Object.entries(body.part.atomicAssignments ?? {}).map(([key, value]) => [key, value.revisionId, value.approved])).toEqual([[normalizeValueKey("1k"), ids.P, true]]);
  });

  it("catalog search claims verified physical authority and orderable values only from selectable links, and hides a generic whose links are all withdrawn", async () => {
    const authority = await searchPartsForAI("b19eauthority", undefined, 5);
    expect(authority.map((item) => [item.name, item.physicalAuthority, item.orderableValues])).toEqual([["b19eauthority", "verified", [normalizeValueKey("1k")]]]);
    expect(await searchPartsForAI("b19ewithdrawngeneric", undefined, 5)).toEqual([]);
    expect((await searchPartsForAI("b19eselectablegeneric", undefined, 5)).map((item) => [item.name, item.physicalAuthority])).toEqual([["b19eselectablegeneric", "verified"]]);
  });

  // [B19-E E3 review] a value whose own link was withdrawn (or points at a missing revision) must not silently take the
  // value-agnostic '' default instead: that default can be a different exact part. It fails closed and carries no authority.
  it("a withdrawn or missing value link never falls back to the part's '' default", async () => {
    const [part] = await getFullPartsByIds([defaultedPartId]);
    expect(Object.keys(part!.atomicAssignments ?? {})).toEqual([""]);
    expect([...(part!.withdrawnValueKeys ?? [])].sort()).toEqual([normalizeValueKey("2k"), normalizeValueKey("5k")].sort());
    const response = await partDetailGet(new Request(`http://localhost/api/parts/${defaultedPartId}`), { params: Promise.resolve({ id: defaultedPartId }) });
    const body = await response.json() as { part: { atomicAssignments?: Record<string, unknown>; withdrawnValueKeys?: string[] } };
    expect([...(body.part.withdrawnValueKeys ?? [])].sort()).toEqual([normalizeValueKey("2k"), normalizeValueKey("5k")].sort());
    const parts = new Map([[defaultedPartId, { ...part!, pins: [] }]]);
    const netlist = { components: ["2k", "5k", "7k"].map((value, index) => ({ refDes: `R${index + 1}`, partId: defaultedPartId, value, role: "passive" as const })), connections: [], explanation: "b19-e" };
    const authority = Object.fromEntries((autoLayoutBuild(netlist, parts).kicadComponents ?? []).map((component) => [component.refDes, component.atomicPartRevisionId ?? null]));
    expect(authority).toEqual({ R1: null, R2: null, R3: ids.S2 }); // 7k has no own link, so the default applies (baseline)
  });

  it("Build auto-layout attaches authority only from the selectable link", async () => {
    const parts = new Map((await getFullPartsByIds([partId])).map((part) => [part.id, { ...part, pins: [] }]));
    const netlist = { components: ["1k", "2k", "3k", "4k", "5k"].map((value, index) => ({ refDes: `R${index + 1}`, partId, value, role: "passive" as const })), connections: [], explanation: "b19-e" };
    const state = autoLayoutBuild(netlist, parts);
    const authority = Object.fromEntries((state.kicadComponents ?? []).map((component) => [component.refDes, component.atomicPartRevisionId ?? null]));
    expect(authority).toEqual({ R1: ids.P, R2: null, R3: null, R4: null, R5: null });
  });

  // [B19-E E4 review follow-up] correctness-already-linked-withdrawn-default: a '' default link whose revision was withdrawn (or is
  // missing) is reported too, so a person is never offered a default link the publication would refuse (LINK_ALREADY_LINKED).
  // The parts above keep their expectations: none has a '' link to a withdrawn or missing revision (defaultedPartId's '' is S2).
  it("a withdrawn or missing '' default link is reported in withdrawnValueKeys; a value still finds no link through it", async () => {
    const library = await pg.db.query<{ id: string }>(`SELECT id FROM libraries WHERE name = 'Device' LIMIT 1`);
    const part = async (name: string) => (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw) VALUES ($1, $2, '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id, name])).rows[0]!.id;
    const withdrawnDefault = await part("b19ezdefaultdeprecated");
    const missingDefault = await part("b19ezdefaultmissing");
    const insertLink = (partIdValue: string, valueKey: string, revisionId: string) => pg.db.query(
      `INSERT INTO parts_atomic_links (part_id, value_key, atomic_part_revision_id, symbol_asset_version_id, footprint_asset_version_id, mapping_certificate_id, footprint_full_name) VALUES ($1, $2, $3, 'sym', 'fp', 'map', 'Resistor_SMD:R_0805_2012Metric')`,
      [partIdValue, valueKey, revisionId],
    );
    await insertLink(withdrawnDefault, "", ids.D);
    await insertLink(withdrawnDefault, normalizeValueKey("1k"), ids.P);
    await insertLink(missingDefault, "", ids.M);

    const loaded = new Map((await getFullPartsByIds([withdrawnDefault, missingDefault])).map((item) => [item.id, item]));
    expect([Object.keys(loaded.get(withdrawnDefault)!.atomicAssignments ?? {}), loaded.get(withdrawnDefault)!.withdrawnValueKeys]).toEqual([[normalizeValueKey("1k")], [""]]);
    expect([loaded.get(missingDefault)!.atomicAssignments, loaded.get(missingDefault)!.withdrawnValueKeys]).toEqual([undefined, [""]]);
    for (const [id, assignments] of [[withdrawnDefault, [normalizeValueKey("1k")]], [missingDefault, []]] as const) {
      const response = await partDetailGet(new Request(`http://localhost/api/parts/${id}`), { params: Promise.resolve({ id }) });
      const body = await response.json() as { part: { atomicAssignments?: Record<string, unknown>; withdrawnValueKeys?: string[] } };
      expect([Object.keys(body.part.atomicAssignments ?? {}), body.part.withdrawnValueKeys], id).toEqual([assignments, [""]]);
    }
    // valueKeyLink is unchanged: its fallback check reads a value's own key, so a value without its own link still finds none
    const parts = new Map([...loaded.values()].map((item) => [item.id, { ...item, pins: [] }]));
    const netlist = { components: [[withdrawnDefault, "1k"], [withdrawnDefault, "7k"], [missingDefault, "7k"], [missingDefault, ""]].map(([id, value], index) => ({ refDes: `R${index + 1}`, partId: id!, value: value!, role: "passive" as const })), connections: [], explanation: "b19-e" };
    const authority = Object.fromEntries((autoLayoutBuild(netlist, parts).kicadComponents ?? []).map((component) => [component.refDes, component.atomicPartRevisionId ?? null]));
    expect(authority).toEqual({ R1: ids.P, R2: null, R3: null, R4: null });
  });
});

describe("[B19-E E3 g] binding reads the revision's status; the schema carries the status table", () => {
  const scope = { tenantId: "local", projectId: "b19-e-bind", branchId: "main" };
  const reviewer: EngineeringActor = { actorId: "u-b19e-reviewer", actorKind: "human", sessionId: "b19-e", role: "reviewer" };

  it("a new bind needs a selectable revision; a replay keeps a deprecated pin but refuses a revoked one", async () => {
    const repository = new InMemoryPhysicalBindingRepository();
    const service = new PhysicalBindingService(repository);
    const bind = (componentInstanceId: string, atomicPartRevisionId: string) => bindAtomicSelection(service, repository, { scope, actor: reviewer, boardInstanceId: "board-b19e", componentInstanceId, atomicPartRevisionId });

    // new binds: deprecated, superseded, revoked and missing revisions are not selectable
    for (const id of [ids.D, ids.S, ids.R, ids.M]) await expect(bind(`c-new-${id.slice(-6)}`, id)).rejects.toThrow(/PB_ATOMIC_REVISION_NOT_FOUND/);

    // a published revision binds, then is revoked: the replay no longer answers alreadyBound
    const fresh = snapshotFor(BLINKER_PART_IDS.capacitor, "10uF");
    await publishPortableAtomicSnapshot({ snapshot: fresh, ...PUBLISHER, requiredProfile: "pcb_assignable", reason: REASON });
    const first = await bind("c-revoked", fresh.atomicRevision.id);
    expect(first.alreadyBound).toBe(false);
    expect((await bind("c-revoked", fresh.atomicRevision.id)).alreadyBound).toBe(true);

    const kept = snapshotFor(BLINKER_PART_IDS.capacitor, "100nF");
    await publishPortableAtomicSnapshot({ snapshot: kept, ...PUBLISHER, requiredProfile: "pcb_assignable", reason: REASON });
    expect((await bind("c-deprecated", kept.atomicRevision.id)).alreadyBound).toBe(false);

    await withdrawPublishedAtomicRevision({ ...PUBLISHER, revisionId: fresh.atomicRevision.id, to: "revoked", reason: REASON });
    await withdrawPublishedAtomicRevision({ ...PUBLISHER, revisionId: kept.atomicRevision.id, to: "deprecated", reason: REASON });
    await expect(bind("c-revoked", fresh.atomicRevision.id)).rejects.toThrow(/PB_ATOMIC_REVISION_REVOKED/);
    expect(await bind("c-deprecated", kept.atomicRevision.id)).toMatchObject({ alreadyBound: true });
  });

  it("verify-schema: the status table, its checks, keys and indexes hold on the migrated database", async () => {
    const rows = verifySchema.verifyAtomicRevisionStatusEvents(await captureSchemaSnapshot(pg));
    expect(rows.filter((row) => !row.ok), JSON.stringify(rows.filter((row) => !row.ok))).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });

  it("the checks are executable: a non-withdrawal state, a blank reason, a self-successor, a non-human actor and a repeated state are refused", async () => {
    const auditId = (await pg.db.query<{ id: string }>(`SELECT id FROM atomic_audit_events LIMIT 1`)).rows[0]!.id;
    const insert = (patch: Record<string, string | null>) => {
      const row = { id: `status_b19e_${Math.random().toString(36).slice(2)}`, revision_id: ids.P, to_state: "deprecated", successor_revision_id: null, actor_id: "user:x", actor_role: "publisher", reason: "r", audit_event_id: auditId, ...patch };
      return pg.db.query(`INSERT INTO atomic_revision_status_events (id, revision_id, to_state, successor_revision_id, actor_id, actor_role, reason, at, audit_event_id) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)`, [row.id, row.revision_id, row.to_state, row.successor_revision_id, row.actor_id, row.actor_role, row.reason, row.audit_event_id]);
    };
    await expect(insert({ to_state: "published" })).rejects.toThrow(/check/i);
    await expect(insert({ reason: "  " })).rejects.toThrow(/check/i);
    await expect(insert({ successor_revision_id: ids.P })).rejects.toThrow(/check/i);
    await expect(insert({ actor_id: "agent:librarian" })).rejects.toThrow(/check/i);
    await expect(insert({ actor_role: "reviewer" })).rejects.toThrow(/check/i);
    await expect(insert({ revision_id: ids.M })).rejects.toThrow(/foreign key/i);
    await expect(insert({ revision_id: ids.D })).rejects.toThrow(/unique|duplicate/i); // D already has its deprecated event
    expect(await serverCatalog.loadSelectablePortableSnapshot(ids.P)).not.toBeNull();
  });
});
