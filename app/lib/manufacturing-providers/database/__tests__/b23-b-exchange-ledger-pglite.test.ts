/**
 * [B23-B2] The exchange record on PostgreSQL (discovery section 8 item 10; D23-4, OD-167): `mfg.provider-exchange.v1` over the
 * PostgreSQL durable-workflow repository, against a real, migrated PostgreSQL (PGlite, in process, nothing on disk).
 *
 *  1. two concurrent exchanges of one attempt send ONCE: the second append meets the first (its replay row, or the head's revision)
 *     and replays it; two different attempts on one aggregate are both recorded, each sent once (the revision check retried for the
 *     second, never the send);
 *  2. no outbox effect on PostgreSQL either: the outbox table stays empty, and the re-claim of a `processing` event whose lease
 *     expired (`server-repository.ts:32`) finds nothing, so no handler can ever re-run a send;
 *  3. what PostgreSQL holds - records, heads and replays - carries no raw answer and no file or archive byte, and every record
 *     re-verifies on load;
 *  4. [B23-B2 review, 2026-10-04] two concurrent exchanges of ONE package under two keys send once (the other is refused in flight),
 *     and a key used on one board names no new attempt on another board of the project (the key namespace is the project scope);
 *  5. [B23-B2 lead, 2026-10-04] low-2: PostgreSQL's jsonb refuses a lone UTF-16 surrogate, and the exchange drops such a provider field
 *     at normalisation, so the settle lands.
 *
 * Stated limit (RECORDED): PGlite is one connection and runs one transaction at a time, so case 1 proves the replay and revision
 * paths, not two interleaved server transactions; the isolation level of a production server stays UNKNOWN (section 8 item 10 is
 * narrowed, not closed). This suite starts PostgreSQL, so it lives outside the B23 test directory (a prompt-to-gerber directory
 * filter) and runs in the database-delivery job by an explicit entry (b19-e-ci-job-scope).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../db/schema";
import { loadMigrationManifest } from "../../../db/migrations/manifest";
import { migrateDatabase } from "../../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../../db/client", () => ({ getDb: () => orm }));

import { resetAdmissionControl } from "../../../acquisition/admission-control";
import { DurableOutboxDispatcher } from "../../../durable-workflow/outbox";
import { PostgresDurableWorkflowRepository } from "../../../durable-workflow/server-repository";
import { buildOutboundPackage, type OutboundPackage } from "../../outbound-package";
import { sendProviderExchange } from "../../provider-egress";
import { createProviderExchangeLedger, exchangeAttemptInput, type ExchangeAggregate } from "../../exchange-ledger";
import { SYNTHETIC_SCOPE, syntheticLedgerRecord, syntheticRelease } from "../../__tests__/_b23-b-release-fixture";
import { FAKE_ENV, PUBLIC_RESOLVE, RAW_SENTINEL, fakeCredential, fakeDescriptor, fakeProvider } from "../../__tests__/_b23-b2-fake-provider";

const T0 = Date.parse("2026-10-04T12:00:00.000Z");
const ISO0 = new Date(T0).toISOString();
const SCOPE = { tenantId: SYNTHETIC_SCOPE.tenantId, projectId: SYNTHETIC_SCOPE.projectId, branchId: SYNTHETIC_SCOPE.branchId };
let aggregateCount = 0;
/** A fresh aggregate per case (one board each), so the cases never share a head. */
const aggregate = (): ExchangeAggregate => ({ scope: SCOPE, designId: SYNTHETIC_SCOPE.designId, boardId: `board:pglite-${(aggregateCount += 1)}`, providerId: "jlcpcb" });
/** [B23-B2 review, 2026-10-04] `pkg` names the package (the request digest): attempts of one package and provider block each other while unsettled. [B23-B2 lead, 2026-10-04] low-3, moved in place: `pkg` names the package digest too, which the in-flight check now keys on (was a fixed package digest). */
const PLAN = (key: string, pkg = "c") => ({ planId: `provider-exchange-plan:${key}`, planDigest: `dw1-${"9".repeat(64)}`, requestDigest: `dw1-${pkg.repeat(64)}`, purpose: "quote" as const, provider: { operationId: "pcb-quote", descriptorVersion: "1.0.0", descriptorDigest: `dw1-${"d".repeat(64)}` }, release: { releaseId: "mfg-release-pglite", archiveSha256: "e".repeat(64) }, outbound: { outboundPackageDigest: `mfg-outbound-${pkg.repeat(64)}` } });

function outboundPackage(): OutboundPackage {
  const release = syntheticRelease();
  const built = buildOutboundPackage({ release, ledger: syntheticLedgerRecord(release) });
  if (!built.ok) throw new Error(built.refusal);
  return built.package;
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
}, 120_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => { resetAdmissionControl(); });

/** One whole exchange of `key` against the PostgreSQL record: prepare, and only for a fresh attempt, send and settle. */
async function exchangeOnce(target: ExchangeAggregate, key: string, provider: ReturnType<typeof fakeProvider>, pkg: OutboundPackage, packageId = "c") {
  const ledger = createProviderExchangeLedger(new PostgresDurableWorkflowRepository());
  const descriptor = fakeDescriptor();
  const begun = await ledger.prepare({ aggregate: target, attempt: exchangeAttemptInput({ plan: PLAN(key, packageId), key, actorId: "u-b23-admin", descriptor, capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } }), at: ISO0 });
  if (!begun.ok || begun.replayed) return { sent: false, begun };
  const outcome = await sendProviderExchange({ descriptor, package: pkg, idempotencyKey: begun.attempt.providerIdempotencyKey, env: { [FAKE_ENV]: fakeCredential() }, beforeSend: async (request) => { await ledger.markSent({ aggregate: target, idempotencyKey: key, request, at: ISO0 }); } }, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE, clock: () => T0 }); // [B23-B2 review, 2026-10-04] the server-derived provider key (security-2)
  return { sent: true, attempt: await ledger.settle({ aggregate: target, idempotencyKey: key, outcome, at: ISO0 }) };
}

describe("[B23-B2] mfg.provider-exchange.v1 on PostgreSQL (PGlite)", () => {
  it("1. two concurrent exchanges of one attempt send once, and two different attempts of two packages on one aggregate are both recorded, each sent once [B23-B2 review, 2026-10-04] the two attempts name two packages: two of ONE package block each other (case 4)", async () => {
    const pkg = outboundPackage();
    const same = aggregate();
    const provider = fakeProvider();
    const results = await Promise.all([exchangeOnce(same, "pg-key-1", provider, pkg), exchangeOnce(same, "pg-key-1", provider, pkg)]);
    expect(results.map((result) => result.sent).sort()).toEqual([false, true]);
    expect(provider.calls).toBe(1);
    const ledger = createProviderExchangeLedger(new PostgresDurableWorkflowRepository());
    expect((await ledger.load(same))?.attempts.map((attempt) => [attempt.idempotencyKey, attempt.state])).toEqual([["pg-key-1", "acknowledged"]]);
    expect((await ledger.history(same)).map((record) => record.phase)).toEqual(["prepared", "sent", "settled"]);
    const other = aggregate();
    const two = fakeProvider();
    const both = await Promise.all([exchangeOnce(other, "pg-key-a", two, pkg, "a"), exchangeOnce(other, "pg-key-b", two, pkg, "b")]);
    expect(both.map((result) => result.sent)).toEqual([true, true]);
    expect(two.calls).toBe(2);
    const loaded = await ledger.load(other);
    expect(loaded?.revision).toBe(6);
    expect(loaded?.attempts.map((attempt) => [attempt.idempotencyKey, attempt.state]).sort()).toEqual([["pg-key-a", "acknowledged"], ["pg-key-b", "acknowledged"]]);
    // a later duplicate of either replays the record and sends nothing
    expect(await exchangeOnce(other, "pg-key-a", two, pkg, "a")).toMatchObject({ sent: false, begun: { ok: true, replayed: true, attempt: { state: "acknowledged" } } });
    expect(two.calls).toBe(2);
  });

  it("2. no outbox effect on PostgreSQL: the outbox table stays empty, and the expired-lease re-claim finds nothing, so no handler can ever re-run a send", async () => {
    const target = aggregate();
    const provider = fakeProvider("server-error");
    const result = await exchangeOnce(target, "pg-key-unknown", provider, outboundPackage());
    expect(result).toMatchObject({ sent: true, attempt: { state: "UNKNOWN_PENDING_RECONCILIATION", failure: "http_503" } });
    const count = await pg.db.query<{ n: number }>("SELECT count(*)::int AS n FROM durable_workflow_outbox");
    expect(count.rows[0]!.n).toBe(0);
    const repository = new PostgresDurableWorkflowRepository();
    for (const now of [ISO0, new Date(T0 + 7 * 86_400_000).toISOString()]) {
      expect(await repository.claimOutbox({ workerId: "b23-b2-reclaim", now, leaseUntil: new Date(Date.parse(now) + 1).toISOString(), limit: 100 })).toEqual([]);
      expect(await new DurableOutboxDispatcher(repository, new Map([["mfg.provider-exchange@1", async () => { await provider.fetch("https://upload.fake-provider.example/v1/quote-uploads", { method: "POST" }); }]])).dispatch({ workerId: "b23-b2", now })).toEqual({ claimed: 0, completed: 0, retried: 0, failed: 0 });
    }
    expect(provider.calls).toBe(1);
  });

  it("3. what PostgreSQL holds carries no raw answer and no file or archive byte, and every stored record re-verifies on load", async () => {
    const target = aggregate();
    await exchangeOnce(target, "pg-key-stored", fakeProvider(), outboundPackage());
    const stored = await pg.db.query<{ payload: unknown }>("SELECT payload FROM durable_workflow_records WHERE aggregate_type = 'mfg.provider-exchange.v1'");
    const replays = await pg.db.query<{ result: unknown }>("SELECT result FROM durable_workflow_replays");
    expect(stored.rows.length).toBeGreaterThanOrEqual(3);
    for (const [label, rows] of [["records", stored.rows], ["replays", replays.rows]] as const) {
      const all = JSON.stringify(rows);
      expect(all, label).not.toContain(RAW_SENTINEL);
      expect(all, label).not.toContain("G04 synthetic");
      expect(all, label).not.toContain("synthetic-archive:");
    }
    const ledger = createProviderExchangeLedger(new PostgresDurableWorkflowRepository());
    expect((await ledger.history(target)).map((record) => record.attempt.state)).toEqual(["prepared", "sent", "acknowledged"]);
    expect(await ledger.attempt(target, "pg-key-stored")).toMatchObject({ state: "acknowledged", receipt: { providerReceiptId: "fake-receipt-1" } });
  });

  it("4. on PostgreSQL too, two concurrent exchanges of ONE package under two keys send once (the other is refused in flight), and a key used on one board names no new attempt on another board of the project [B23-B2 review, 2026-10-04] coverage-2, tests-4", async () => {
    const pkg = outboundPackage();
    const target = aggregate();
    const provider = fakeProvider();
    const results = await Promise.all([exchangeOnce(target, "pg-key-one", provider, pkg, "1"), exchangeOnce(target, "pg-key-two", provider, pkg, "1")]);
    expect(results.map((result) => result.sent).sort()).toEqual([false, true]);
    expect(results.find((result) => !result.sent)).toMatchObject({ begun: { ok: false, code: "in_flight", attempt: { state: expect.stringMatching(/^(?:prepared|sent)$/) } } });
    expect(provider.calls).toBe(1);
    const elsewhere = aggregate();
    const reused = await exchangeOnce(elsewhere, results[0]!.sent ? "pg-key-one" : "pg-key-two", provider, pkg, "2");
    expect(reused).toMatchObject({ sent: false, begun: { ok: false, code: "key_reuse_conflict" } });
    expect(provider.calls).toBe(1);
    expect(await createProviderExchangeLedger(new PostgresDurableWorkflowRepository()).load(elsewhere)).toBeNull();
  });

  it("5. a provider field PostgreSQL's jsonb refuses - a lone UTF-16 surrogate - never reaches the record: PostgreSQL refuses it outright, and the exchange drops it at normalisation (the other declared fields kept), so the acknowledged settle lands and re-verifies [B23-B2 lead, 2026-10-04] low-2", async () => {
    await expect(pg.db.query("SELECT $1::jsonb AS v", [JSON.stringify({ status: `rec${String.fromCharCode(0xd800)}eived` })])).rejects.toThrow();
    const target = aggregate();
    const provider = fakeProvider("lone-surrogate");
    const result = await exchangeOnce(target, "pg-key-lone", provider, outboundPackage());
    expect(result).toMatchObject({ sent: true, attempt: { state: "acknowledged", receipt: { providerReceiptId: "fake-receipt-1" } } });
    expect(result.attempt?.normalized).toEqual({ quotedDays: 5, accepted: true });
    expect(provider.calls).toBe(1);
    const stored = await createProviderExchangeLedger(new PostgresDurableWorkflowRepository()).attempt(target, "pg-key-lone");
    expect(stored).toMatchObject({ state: "acknowledged" });
    expect(stored?.normalized).toEqual({ quotedDays: 5, accepted: true });
  });
});
