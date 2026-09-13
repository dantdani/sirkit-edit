/**
 * [B19-E E3 b, d] The durable atomic publication boundary against a real, migrated PostgreSQL (PGlite).
 *
 * Reproduced before the fix (recorded in the E3 report):
 *  - the revision insert used `onConflictDoNothing()` with no target, so a content-changed revision colliding with a published
 *    one on (logicalPartId, revision) was silently dropped while the transaction still wrote its audit row, its new rows and
 *    reported success;
 *  - an identical re-publish wrote a second publish audit row;
 *  - there was no way to withdraw a published revision: `publication_state` is part of the record hash, so it cannot be
 *    edited in place, and no append-only status record existed.
 *
 * Reproduced in the E3 review (before its fix): re-publishing a deprecated, superseded or revoked revision resolved with the
 * original audit id, and an identical re-publish wrote a new `parts_atomic_links` row with no audit row naming it.
 *
 * Reproduced in the second E3 review: with the withdrawal's app-layer reason, role and self-successor checks all deleted, the
 * d suite stayed green (its unanchored regexes matched drizzle's failed-query text of the migration CHECK backstop).
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
const fault = vi.hoisted(() => ({ insertInto: null as string | null }));

/** The ORM, or (while a fault is armed) the ORM whose transactions fail when they insert into the named table. */
function database(): typeof orm {
  if (!fault.insertInto) return orm;
  return new Proxy(orm, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return (run: (tx: unknown) => Promise<unknown>) => target.transaction((tx) => run(new Proxy(tx, {
        get(inner, key, innerReceiver) {
          if (key !== "insert") return Reflect.get(inner, key, innerReceiver);
          return (table: Table) => {
            if (getTableName(table) === fault.insertInto) throw new Error("B19E_INJECTED_INSERT_FAILURE");
            return inner.insert(table);
          };
        },
      })));
    },
  });
}
vi.mock("../../db/client", () => ({ getDb: () => database() }));

import { publishPortableAtomicSnapshot, validatePortableSnapshotForPublication, withdrawPublishedAtomicRevision } from "../server-repository";
import { createAtomicRevision } from "../catalog";
import { normalizeValueKey } from "../value-key";
import type { AtomicPartRevision, AuditEvent, LicenseRecord, PortableAtomicSnapshot } from "../types";
import { blinkerCatalog, BLINKER_PART_IDS } from "@/app/lib/fixture-runtime/blinker/catalog";

const PUBLISHER = { actorId: "user:fixture-publisher", actorRole: "publisher" as const };
const COLLISION_LICENSE: LicenseRecord = { id: "license_b19e_collision", spdxId: "MIT", name: "B19-E collision fixture", rawRedistribution: "redistributable", derivedRedistribution: "redistributable", exportDisposition: "redistributable" };

function snapshotFor(partId: string, value: string): PortableAtomicSnapshot {
  const catalog = blinkerCatalog();
  return structuredClone(catalog.snapshots.get(catalog.revisionFor(partId, value)!)!);
}

function reissue(revision: AtomicPartRevision, patch: Partial<AtomicPartRevision>): AtomicPartRevision {
  const { id: _id, semanticHash: _hash, validatorVersion: _validator, schemaVersion: _schema, ...rest } = structuredClone(revision);
  void _id; void _hash; void _validator; void _schema;
  return structuredClone(createAtomicRevision({ ...rest, ...patch }));
}

/** The same exact part with changed content (an added license and policy) under the SAME (logicalPartId, revision). */
function contentChanged(snapshot: PortableAtomicSnapshot, patch: Partial<AtomicPartRevision> = {}): PortableAtomicSnapshot {
  const next = structuredClone(snapshot);
  next.licenses = [...next.licenses, COLLISION_LICENSE];
  next.atomicRevision = reissue(snapshot.atomicRevision, { licenseIds: [...snapshot.atomicRevision.licenseIds, COLLISION_LICENSE.id], policyVersion: "b19-e-changed/1", ...patch });
  return next;
}

const publish = (snapshot: PortableAtomicSnapshot, extra: { links?: Array<{ partId: string; valueKey: string }> } = {}) =>
  publishPortableAtomicSnapshot({ snapshot, ...PUBLISHER, requiredProfile: "pcb_assignable", reason: "B19-E E3 durable proof", ...extra });

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await pg.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params as never);
  return result.rows[0]!.n;
}

/** [B19-E E3 review] The rejection's message with its causes (drizzle wraps the PostgreSQL error as the cause). */
async function rejectionText(attempt: Promise<unknown>): Promise<string> {
  const failure = await attempt.then(() => null, (error: unknown) => error);
  expect(failure, "the attempt was refused").not.toBeNull();
  const parts: string[] = [];
  for (let error = failure as { message?: unknown; cause?: unknown } | undefined, depth = 0; error && depth < 4; error = error.cause as typeof error, depth += 1) parts.push(String(error.message ?? error));
  return parts.join(" <- ");
}

let partId = "";
let otherPartId = "";

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const library = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('b19-e-lib', 'test') RETURNING id`);
  partId = (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw) VALUES ($1, 'NE555D', '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id])).rows[0]!.id;
  otherPartId = (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw) VALUES ($1, 'R', '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id])).rows[0]!.id;
}, 120_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => { fault.insertInto = null; });

describe("[B19-E E3 b] a revision-number collision is never silently dropped", () => {
  it("a content-changed revision colliding on (logicalPartId, revision) throws and writes no revision, audit, license or link", async () => {
    const original = snapshotFor(BLINKER_PART_IDS.timer, "NE555");
    await publish(original);
    const collision = contentChanged(original);
    expect(collision.atomicRevision.id).not.toBe(original.atomicRevision.id);
    expect([collision.atomicRevision.logicalPartId, collision.atomicRevision.revision]).toEqual([original.atomicRevision.logicalPartId, original.atomicRevision.revision]);

    // [B19-E E3 review] the collision is a valid publication on its own, so only the database's (logical_part_id, revision)
    // uniqueness or the re-select can refuse it — never an earlier validation rule, which would make this proof vacuous
    expect(() => validatePortableSnapshotForPublication(collision, "pcb_assignable", PUBLISHER)).not.toThrow();
    expect(await rejectionText(publish(collision, { links: [{ partId, valueKey: "" }] }))).toMatch(/atomic_part_logical_revision_uniq|duplicate key|does not match the revision/);
    expect(await count(`atomic_part_revisions WHERE logical_part_id = $1`, [original.atomicRevision.logicalPartId])).toBe(1);
    expect(await count(`atomic_part_revisions WHERE id = $1`, [collision.atomicRevision.id])).toBe(0);
    expect(await count(`atomic_audit_events WHERE object_id = $1`, [collision.atomicRevision.id])).toBe(0);
    expect(await count(`atomic_licenses WHERE id = $1`, [COLLISION_LICENSE.id])).toBe(0);
    expect(await count(`parts_atomic_links WHERE part_id = $1`, [partId])).toBe(0);
  });

  it("an identical re-publish is idempotent: the same revision and audit id, no second row of either", async () => {
    const snapshot = snapshotFor(BLINKER_PART_IDS.resistor, "10k");
    const first = await publish(snapshot);
    const again = await publish(structuredClone(snapshot));
    expect(again).toEqual(first);
    expect(await count(`atomic_part_revisions WHERE id = $1`, [snapshot.atomicRevision.id])).toBe(1);
    expect(await count(`atomic_audit_events WHERE object_id = $1 AND action = 'publish'`, [snapshot.atomicRevision.id])).toBe(1);
  });

  it("links[] are written in the same transaction, derived from the published snapshot", async () => {
    const snapshot = snapshotFor(BLINKER_PART_IDS.resistor, "56k");
    await publish(snapshot, { links: [{ partId: otherPartId, valueKey: "56k" }] });
    const rows = (await pg.db.query(`SELECT value_key, atomic_part_revision_id, symbol_asset_version_id, footprint_asset_version_id, mapping_certificate_id, footprint_full_name FROM parts_atomic_links WHERE part_id = $1`, [otherPartId])).rows;
    expect(rows).toEqual([{ value_key: "56k", atomic_part_revision_id: snapshot.atomicRevision.id, symbol_asset_version_id: snapshot.symbol.versionId, footprint_asset_version_id: snapshot.footprint!.versionId, mapping_certificate_id: snapshot.mapping!.id, footprint_full_name: `Resistor_SMD:${snapshot.footprint!.footprintName}` }]);
    // re-publishing the identical revision with the identical link changes nothing
    await publish(structuredClone(snapshot), { links: [{ partId: otherPartId, valueKey: "56k" }] });
    expect(await count(`parts_atomic_links WHERE part_id = $1`, [otherPartId])).toBe(1);
  });

  it("a link that would repoint an existing link, or is not a normalized value key, refuses the whole publication", async () => {
    const snapshot = snapshotFor(BLINKER_PART_IDS.resistor, "330");
    await expect(publish(snapshot, { links: [{ partId: otherPartId, valueKey: "56k" }] })).rejects.toThrow(/link/);
    await expect(publish(snapshot, { links: [{ partId: otherPartId, valueKey: "330 Ohm" }] })).rejects.toThrow(/value key/);
    expect(await count(`atomic_part_revisions WHERE id = $1`, [snapshot.atomicRevision.id])).toBe(0);
    expect(await count(`atomic_audit_events WHERE object_id = $1`, [snapshot.atomicRevision.id])).toBe(0);
    expect((await pg.db.query<{ id: string }>(`SELECT atomic_part_revision_id AS id FROM parts_atomic_links WHERE part_id = $1`, [otherPartId])).rows.map((row) => row.id)).toEqual([snapshotFor(BLINKER_PART_IDS.resistor, "56k").atomicRevision.id]);
  });

  it("a failure after the revision insert rolls the revision back with the audit row", async () => {
    const snapshot = snapshotFor(BLINKER_PART_IDS.capacitor, "10nF");
    fault.insertInto = "atomic_audit_events";
    await expect(publish(snapshot)).rejects.toThrow(/B19E_INJECTED_INSERT_FAILURE/);
    fault.insertInto = null;
    expect(await count(`atomic_part_revisions WHERE id = $1`, [snapshot.atomicRevision.id])).toBe(0);
    await publish(snapshot);
    expect(await count(`atomic_part_revisions WHERE id = $1`, [snapshot.atomicRevision.id])).toBe(1);
  });
});

describe("[B19-E E3 d] withdrawal is append-only, human, reasoned and follows the legal edges", () => {
  const base = { ...PUBLISHER, reason: "B19-E E3 withdrawal proof" };
  let led: PortableAtomicSnapshot, successor: PortableAtomicSnapshot, otherPart: PortableAtomicSnapshot;

  const events = async (revisionId: string) => (await pg.db.query<{ to_state: string; successor_revision_id: string | null; actor_id: string; actor_role: string; reason: string; audit_event_id: string }>(
    `SELECT to_state, successor_revision_id, actor_id, actor_role, reason, audit_event_id FROM atomic_revision_status_events WHERE revision_id = $1 ORDER BY at, to_state`, [revisionId])).rows;
  const audits = async (revisionId: string) => count(`atomic_audit_events WHERE object_id = $1 AND action <> 'publish'`, [revisionId]);

  beforeAll(async () => {
    led = snapshotFor(BLINKER_PART_IDS.led, "LED");
    successor = structuredClone(led);
    successor.atomicRevision = reissue(led.atomicRevision, { revision: led.atomicRevision.revision + 1, policyVersion: "b19-e-successor/1" });
    otherPart = snapshotFor(BLINKER_PART_IDS.capacitor, "100nF");
    await publish(led);
    await publish(successor);
    await publish(otherPart);
  });

  it("an unknown or never-published revision cannot be withdrawn", async () => {
    await expect(withdrawPublishedAtomicRevision({ ...base, revisionId: "atomic_unknown", to: "deprecated" })).rejects.toThrow(/not a published/);
    expect(await count(`atomic_revision_status_events`)).toBe(0);
  });

  /**
   * [B19-E E3 review 2] A pre-validation refusal is proven by its own message, anchored at the start, and by opening no
   * transaction. An unanchored /reason/, /role/ or /successor/ also matched drizzle's "Failed query: insert into
   * atomic_revision_status_events (..., successor_revision_id, actor_id, actor_role, reason, ...)" text, so with the app check
   * deleted the migration-0030 CHECK refused the insert, the transaction rolled back, and the case stayed green.
   */
  async function refusedBeforeAnyTransaction(attempt: () => Promise<unknown>, message: RegExp): Promise<void> {
    const opened = vi.spyOn(orm, "transaction");
    try {
      await expect(attempt()).rejects.toThrow(message);
      expect(opened, "a pre-validation refusal opens no transaction").not.toHaveBeenCalled();
    } finally {
      opened.mockRestore();
    }
  }

  it.each([
    ["a missing reason", { reason: "" }, /^Atomic withdrawal reason is required$/],
    ["a blank reason", { reason: "   " }, /^Atomic withdrawal reason is required$/],
    ["a reviewer", { actorRole: "reviewer" }, /^Atomic withdrawal role "reviewer" is not publisher or admin$/],
    ["an agent role", { actorRole: "agent" }, /^Atomic withdrawal role "agent" is not publisher or admin$/],
    ["an agent actor claiming publisher", { actorId: "agent:librarian" }, /^Atomic withdrawal requires a human actor /],
    ["an LLM actor claiming admin", { actorId: "llm:extractor", actorRole: "admin" }, /^Atomic withdrawal requires a human actor /],
    ["an OCR actor", { actorId: " ocr:worker" }, /^Atomic withdrawal requires a human actor /],
    ["a target state that is not a withdrawal", { to: "published" }, /^"published" is not a withdrawal state$/],
  ] as const)("%s is refused before anything is written", async (_label, patch, message) => {
    await refusedBeforeAnyTransaction(() => withdrawPublishedAtomicRevision({ ...base, revisionId: led.atomicRevision.id, to: "deprecated", ...(patch as object) } as never), message);
    expect(await events(led.atomicRevision.id)).toEqual([]);
    expect(await audits(led.atomicRevision.id)).toBe(0);
  });

  it("a successor must be a selectable revision of the same logical part, and superseded requires one", async () => {
    const attempt = (patch: object) => withdrawPublishedAtomicRevision({ ...base, revisionId: led.atomicRevision.id, to: "superseded", ...patch } as never);
    await refusedBeforeAnyTransaction(() => attempt({}), /^A superseded revision requires a successor revision$/);
    await refusedBeforeAnyTransaction(() => attempt({ successorRevisionId: led.atomicRevision.id }), /^A revision cannot be its own successor$/);
    await expect(attempt({ successorRevisionId: otherPart.atomicRevision.id })).rejects.toThrow(/^A successor must be a revision of the same logical part$/);
    await expect(attempt({ successorRevisionId: "atomic_unknown" })).rejects.toThrow(/^Successor atomic_unknown is not a selectable published revision$/);
    expect(await events(led.atomicRevision.id)).toEqual([]);
    expect(await audits(led.atomicRevision.id)).toBe(0);
  });

  it("a failure after the audit insert rolls back both the audit row and the event", async () => {
    fault.insertInto = "atomic_revision_status_events";
    await expect(withdrawPublishedAtomicRevision({ ...base, revisionId: led.atomicRevision.id, to: "deprecated" })).rejects.toThrow(/B19E_INJECTED_INSERT_FAILURE/);
    fault.insertInto = null;
    expect(await events(led.atomicRevision.id)).toEqual([]);
    expect(await audits(led.atomicRevision.id)).toBe(0);
  });

  it("published -> deprecated -> superseded -> revoked, each step one event and one audit row; illegal edges refused", async () => {
    const id = led.atomicRevision.id;
    const deprecated = await withdrawPublishedAtomicRevision({ ...base, revisionId: id, to: "deprecated", successorRevisionId: successor.atomicRevision.id });
    expect(deprecated).toMatchObject({ revisionId: id, to: "deprecated", from: "published" });
    await expect(withdrawPublishedAtomicRevision({ ...base, revisionId: id, to: "deprecated" })).rejects.toThrow(/Illegal withdrawal deprecated -> deprecated/);

    await withdrawPublishedAtomicRevision({ ...base, actorId: "user:catalog-admin", actorRole: "admin", revisionId: id, to: "superseded", successorRevisionId: successor.atomicRevision.id });
    await expect(withdrawPublishedAtomicRevision({ ...base, revisionId: id, to: "deprecated" })).rejects.toThrow(/Illegal withdrawal superseded -> deprecated/);

    await withdrawPublishedAtomicRevision({ ...base, revisionId: id, to: "revoked", reason: "recalled" });
    for (const to of ["deprecated", "superseded", "revoked"] as const) {
      await expect(withdrawPublishedAtomicRevision({ ...base, revisionId: id, to, successorRevisionId: successor.atomicRevision.id })).rejects.toThrow(/Illegal withdrawal revoked/);
    }

    const rows = await events(id);
    expect(rows.map((row) => [row.to_state, row.successor_revision_id, row.actor_id, row.actor_role])).toEqual([
      ["deprecated", successor.atomicRevision.id, "user:fixture-publisher", "publisher"],
      ["superseded", successor.atomicRevision.id, "user:catalog-admin", "admin"],
      ["revoked", null, "user:fixture-publisher", "publisher"],
    ]);
    expect(rows.map((row) => row.reason)).toEqual(["B19-E E3 withdrawal proof", "B19-E E3 withdrawal proof", "recalled"]);
    expect(await audits(id)).toBe(3);
    for (const row of rows) expect(await count(`atomic_audit_events WHERE id = $1 AND object_id = $2 AND action = $3`, [row.audit_event_id, id, row.to_state])).toBe(1);
    // the revision row itself is never edited: withdrawal is append-only (publication_state is in the record hash)
    expect((await pg.db.query<{ state: string }>(`SELECT publication_state AS state FROM atomic_part_revisions WHERE id = $1`, [id])).rows).toEqual([{ state: "published" }]);
  });

  it("a withdrawn revision can no longer be named as a successor", async () => {
    await expect(withdrawPublishedAtomicRevision({ ...base, revisionId: successor.atomicRevision.id, to: "superseded", successorRevisionId: led.atomicRevision.id })).rejects.toThrow(/selectable/);
    expect(await events(successor.atomicRevision.id)).toEqual([]);
  });

  it("[review] a deprecated-only or a superseded-only revision is not selectable either, so neither can be named as a successor", async () => {
    // led above was revoked by the time it was named; these two were never revoked, so a revoked-only check would accept them
    const [deprecatedOnly, supersededOnly, target] = [2, 3, 4].map((step) => {
      const next = structuredClone(led);
      next.atomicRevision = reissue(led.atomicRevision, { revision: led.atomicRevision.revision + step, policyVersion: `b19-e-successor-${step}/1` });
      return next;
    });
    for (const snapshot of [deprecatedOnly!, supersededOnly!, target!]) await publish(snapshot);
    await withdrawPublishedAtomicRevision({ ...base, revisionId: deprecatedOnly!.atomicRevision.id, to: "deprecated" });
    await withdrawPublishedAtomicRevision({ ...base, revisionId: supersededOnly!.atomicRevision.id, to: "superseded", successorRevisionId: target!.atomicRevision.id });
    expect((await events(deprecatedOnly!.atomicRevision.id)).map((row) => row.to_state)).toEqual(["deprecated"]);
    expect((await events(supersededOnly!.atomicRevision.id)).map((row) => row.to_state)).toEqual(["superseded"]);
    for (const [label, successorRevisionId] of [["deprecated", deprecatedOnly!.atomicRevision.id], ["superseded", supersededOnly!.atomicRevision.id]] as const) {
      for (const to of ["deprecated", "superseded"] as const) {
        await expect(withdrawPublishedAtomicRevision({ ...base, revisionId: target!.atomicRevision.id, to, successorRevisionId }), `${to} naming a ${label} successor`).rejects.toThrow(/selectable/);
      }
    }
    expect(await events(target!.atomicRevision.id)).toEqual([]);
    expect(await audits(target!.atomicRevision.id)).toBe(0);
  });
});

describe("[B19-E E3 review] a withdrawn revision is never re-published or linked, and a re-publish adds no link", () => {
  const parts = { withdrawn: "", written: "", added: "" };

  beforeAll(async () => {
    const library = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('b19-e-review-lib', 'test') RETURNING id`);
    for (const key of Object.keys(parts) as Array<keyof typeof parts>) {
      parts[key] = (await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw) VALUES ($1, $2, '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id, `b19e-review-${key}`])).rows[0]!.id;
    }
  });

  it("re-publishing a deprecated, superseded or revoked revision is refused, with or without links, and writes no link or audit row", async () => {
    const snapshot = snapshotFor(BLINKER_PART_IDS.capacitor, "10uF");
    const next = structuredClone(snapshot);
    next.atomicRevision = reissue(snapshot.atomicRevision, { revision: snapshot.atomicRevision.revision + 1, policyVersion: "b19-e-review-successor/1" });
    const id = snapshot.atomicRevision.id;
    await publish(snapshot);
    await publish(next);
    const valueKey = normalizeValueKey("10uF");
    for (const step of [{ to: "deprecated" }, { to: "superseded", successorRevisionId: next.atomicRevision.id }, { to: "revoked" }] as const) {
      await withdrawPublishedAtomicRevision({ ...PUBLISHER, reason: "B19-E E3 review proof", revisionId: id, ...step });
      await expect(publish(structuredClone(snapshot)), `${step.to}, no links`).rejects.toThrow(/withdrawn/);
      await expect(publish(structuredClone(snapshot), { links: [{ partId: parts.withdrawn, valueKey }] }), `${step.to}, with a link`).rejects.toThrow(/withdrawn/);
      expect(await count(`parts_atomic_links WHERE part_id = $1 OR atomic_part_revision_id = $2`, [parts.withdrawn, id])).toBe(0);
      expect(await count(`atomic_audit_events WHERE object_id = $1 AND action = 'publish'`, [id])).toBe(1);
    }
  });

  it("an identical re-publish cannot add a link its publication did not write; replaying the written links stays idempotent; the audit row names the approver and the links", async () => {
    const snapshot = snapshotFor(BLINKER_PART_IDS.header, "PWR_5V");
    const id = snapshot.atomicRevision.id;
    const valueKey = normalizeValueKey("PWR_5V");
    const first = await publish(snapshot, { links: [{ partId: parts.written, valueKey }] });
    await expect(publish(structuredClone(snapshot), { links: [{ partId: parts.added, valueKey }] })).rejects.toThrow(/re-publish/);
    await expect(publish(structuredClone(snapshot), { links: [{ partId: parts.written, valueKey }, { partId: parts.added, valueKey }] })).rejects.toThrow(/re-publish/);
    expect((await pg.db.query<{ part_id: string }>(`SELECT part_id FROM parts_atomic_links WHERE atomic_part_revision_id = $1`, [id])).rows.map((row) => row.part_id)).toEqual([parts.written]);
    expect(await count(`atomic_audit_events WHERE object_id = $1`, [id])).toBe(1);
    expect(await publish(structuredClone(snapshot), { links: [{ partId: parts.written, valueKey }] })).toEqual(first);
    expect(await publish(structuredClone(snapshot))).toEqual(first);
    expect(await count(`atomic_audit_events WHERE object_id = $1`, [id])).toBe(1);
    const [audit] = (await pg.db.query<{ event: AuditEvent }>(`SELECT event FROM atomic_audit_events WHERE id = $1`, [first.auditId])).rows;
    expect(audit!.event.detail).toMatchObject({ approverId: "user:fixture-reviewer", actorRole: "publisher", links: [{ partId: parts.written, valueKey }] });
  });
});
