/**
 * [B23-B2] Step 5 and the send behind step 4 (runbook :978-979; D23-4, D23-5's receipt half; OD-167): the provider exchange's
 * durable record `mfg.provider-exchange.v1` (`exchange-ledger.ts`, one silent aggregate per scope, board and provider, B22's
 * `computation.evidence.v1` design: CAS on the revision, an idempotent append, every digest re-verified on load, no outbox effect)
 * and the one sending module (`provider-egress.ts`), reached from the exchange service only after B1's revalidation, a consumed
 * plan and an admitting answer.
 *
 * Each attempt is keyed by its idempotency key and moves `prepared -> sent -> acknowledged | rejected |
 * UNKNOWN_PENDING_RECONCILIATION` (or `prepared -> not_sent` when the boundary refused it before any byte left). `prepared` is
 * written before the send and `sent` immediately before the bytes are handed over, so a crash never hides a send. Any timeout,
 * abort, transport error, server error or unreadable answer after the send started is UNKNOWN_PENDING_RECONCILIATION: it is never
 * retried, never handed to the outbox, and a commit with the same key replays the record and sends nothing. The record keeps the
 * provider's receipt id, the response digest, `retrievedAt`, the package and release digests, the descriptor and capability-profile
 * versions and bounded normalized fields - never the raw answer, never the archive or file bytes; a provider whose terms forbid
 * storage keeps ids, digests and timestamps only.
 *
 * D23-4 and D23-5's counterexample (`0c78e93`): no exchange record, no idempotency key on the wire and no UNKNOWN_PENDING state
 * anywhere; the B1 commit answers `PX_SEND_UNAVAILABLE` even with a forged admission (`provider-exchange.ts:348`).
 *
 * The durable store is the in-memory durable-workflow repository (the PostgreSQL concurrency case is
 * `database/__tests__/b23-b-exchange-ledger-pglite.test.ts`, run in the database-delivery job). The provider is the in-process fake
 * behind the real boundary. Nothing is written to disk and nothing leaves the process.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import { DurableOutboxDispatcher, type DurableEffectHandler } from "@/app/lib/durable-workflow/outbox";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { durableWorkflowDigest } from "@/app/lib/durable-workflow/stable";
import type { DurableAggregateRecord, DurableCommitRequest, DurableCommitResult, DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import type { admitProviderOperation } from "../provider-admission";
import { PROVIDER_REGISTRY_VERSION, PROVIDER_ROWS, type ProviderRow } from "../provider-registry";
import { OUTBOUND_MANIFEST_PATH, buildOutboundPackage, type OutboundPackage } from "../outbound-package";
import { PROVIDER_EXCHANGE_ERRORS, ProviderExchangeService, type ProviderExchangeActor, type ProviderExchangePlan, type ProviderExchangePorts, type ProviderExchangeScope } from "../provider-exchange";
import * as egressModule from "../provider-egress";
import { PROVIDER_TRANSFER_DESCRIPTORS, TRANSFER_DESCRIPTOR_BOUNDS, sendProviderExchange, transferDescriptorFor, validateTransferDescriptor, type ProviderTransferDescriptor } from "../provider-egress";
import * as ledgerModule from "../exchange-ledger";
import { PROVIDER_EXCHANGE_AGGREGATE_TYPE, ProviderExchangeLedgerIntegrityError, ProviderExchangeLedgerTransitionError, createProviderExchangeLedger, exchangeAttemptInput, validateExchangeAttempt, type ExchangeAggregate } from "../exchange-ledger";
import { setManufacturingTraceSinkForTests } from "@/app/lib/pcb/fab/manufacturing-errors";
import { SYNTHETIC_BOARD, SYNTHETIC_SCOPE, syntheticLedgerRecord, syntheticRelease } from "./_b23-b-release-fixture";
import { FAKE_AUTH_HEADER, FAKE_ENV, FAKE_HOST, FAKE_ROW, FAKE_ROWS, FAKE_URL, PUBLIC_RESOLVE, RAW_SENTINEL, acknowledgementText, fakeCredential, fakeDescriptor, fakeProvider, readMultipart, type FakeAnswer } from "./_b23-b2-fake-provider";

const SCOPE = { tenantId: SYNTHETIC_SCOPE.tenantId, projectId: SYNTHETIC_SCOPE.projectId, branchId: SYNTHETIC_SCOPE.branchId };
const ADMIN: ProviderExchangeActor = { actorId: "u-b23-admin", actorKind: "human", role: "project_admin" };
const AUTHORITY = { revision: 4, recordDigest: "sha256:authority-record-b23", boardRevision: SYNTHETIC_BOARD.revision, boardDigest: SYNTHETIC_BOARD.digest };
const T0 = Date.parse("2026-10-04T12:00:00.000Z");
const ISO0 = new Date(T0).toISOString();
const PREVIEW = { designId: SYNTHETIC_SCOPE.designId, boardId: SYNTHETIC_SCOPE.boardId, expectedAuthorityRevision: 4, expectedAuthorityDigest: AUTHORITY.recordDigest, providerId: "jlcpcb", operationId: "pcb-quote", purpose: "quote" };
const AGGREGATE: ExchangeAggregate = { scope: SCOPE, designId: SYNTHETIC_SCOPE.designId, boardId: SYNTHETIC_SCOPE.boardId, providerId: "jlcpcb" };
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const text = new TextEncoder();
/** A forged admitting answer: the reviewed admission refuses every transfer in B23, so only a forged one reaches the send. */
const forgedAdmit: typeof admitProviderOperation = (_registry, providerId, operationId) => ({ admitted: true, providerId: providerId as "jlcpcb", operationId, tier: "dfm_quote_transfer", via: "handoff", credentialReferences: [] });

/** A repository that records every commit request it is asked for (and can tamper with what it reads back). */
function recording(inner: DurableWorkflowRepository, tamper?: (record: DurableAggregateRecord) => DurableAggregateRecord) {
  const commits: Array<DurableCommitRequest<object>> = [];
  const touch = <T extends DurableAggregateRecord | null>(record: T): T => (record && tamper ? tamper(structuredClone(record)) as T : record);
  const repository: DurableWorkflowRepository = {
    loadHead: async (identity) => touch(await inner.loadHead(identity)) as never,
    listHeads: (input) => inner.listHeads(input),
    loadRecord: async (scope, recordId) => touch(await inner.loadRecord(scope, recordId)) as never,
    history: async (identity) => (await inner.history(identity)).map((record) => touch(record)) as never,
    getReplay: async (scope, scopeKey, key) => {
      const replay = await inner.getReplay(scope, scopeKey, key);
      return (replay ? { ...replay, records: replay.records.map((record) => touch(record)) } : null) as never;
    },
    commit: async (request) => { commits.push(structuredClone(request) as DurableCommitRequest<object>); return inner.commit(request) as Promise<DurableCommitResult<never>>; },
    claimOutbox: (input) => inner.claimOutbox(input),
    completeOutbox: (input) => inner.completeOutbox(input),
    failOutbox: (input) => inner.failOutbox(input),
    listOutbox: (input) => inner.listOutbox(input),
  };
  return { repository, commits };
}

/** [B23-B2 review, 2026-10-04] Every method of `inner`, bound (a class instance cannot be spread). */
function delegate(inner: DurableWorkflowRepository): DurableWorkflowRepository {
  return {
    loadHead: (identity) => inner.loadHead(identity),
    listHeads: (input) => inner.listHeads(input),
    loadRecord: (scope, recordId) => inner.loadRecord(scope, recordId),
    history: (identity) => inner.history(identity),
    getReplay: (scope, scopeKey, key) => inner.getReplay(scope, scopeKey, key),
    commit: (request) => inner.commit(request),
    claimOutbox: (input) => inner.claimOutbox(input),
    completeOutbox: (input) => inner.completeOutbox(input),
    failOutbox: (input) => inner.failOutbox(input),
    listOutbox: (input) => inner.listOutbox(input),
  };
}
/** [B23-B2 review, 2026-10-04] A store whose commits a rule may fail ("fail": nothing written) or delay (ms), by request. */
function faulty(inner: DurableWorkflowRepository, rule: (request: DurableCommitRequest<object>) => "fail" | number | undefined): DurableWorkflowRepository {
  return {
    ...delegate(inner),
    commit: async (request) => {
      const verdict = rule(request as DurableCommitRequest<object>);
      if (verdict === "fail") throw new Error("DW_STORE_UNAVAILABLE");
      if (typeof verdict === "number") await new Promise((resolve) => setTimeout(resolve, verdict));
      return inner.commit(request);
    },
  };
}
const phaseOf = (request: DurableCommitRequest<object>): string => request.idempotencyKey.split(":").at(-1)!;

interface WorldOptions { nonceBase?: number; randomNonce?: boolean; scope?: ProviderExchangeScope; boardId?: string; actor?: ProviderExchangeActor; answer?: FakeAnswer | ((index: number) => FakeAnswer); descriptor?: ProviderTransferDescriptor | null; repository?: DurableWorkflowRepository; env?: Record<string, string | undefined>; resolve?: () => Promise<string[]>; admit?: typeof admitProviderOperation | null; ledgerPort?: boolean; registry?: readonly ProviderRow[] } // [B23-B2 lead, 2026-10-04] low-3: `registry`, a reviewed registry revision
function world(options: WorldOptions = {}) {
  const inner = options.repository ?? new InMemoryDurableWorkflowRepository();
  const rec = recording(inner);
  const provider = fakeProvider(options.answer ?? "acknowledge");
  let nonce = options.nonceBase ?? 0;
  let clock = T0;
  const release = syntheticRelease();
  const ledger = createProviderExchangeLedger(rec.repository);
  const scope = options.scope ?? SCOPE;
  const actor = options.actor ?? ADMIN;
  const service = new ProviderExchangeService({
    now: () => clock,
    ...(options.randomNonce ? {} : { nonce: () => (nonce += 1).toString(16).padStart(32, "0") }), // [B23-B2 review, 2026-10-04] randomNonce: the server's own random nonce (a real restart)
    env: options.env ?? { [FAKE_ENV]: fakeCredential() },
    registry: options.registry ?? FAKE_ROWS,
    ...(options.admit === null ? {} : { admit: options.admit ?? forgedAdmit }),
    transfer: { ...(options.descriptor === null ? {} : { descriptors: [options.descriptor ?? fakeDescriptor()] }), egress: { fetch: provider.fetch, resolve: options.resolve ?? PUBLIC_RESOLVE } },
  });
  const ports: ProviderExchangePorts = {
    revalidate: async () => ({ ok: true, authority: { ...AUTHORITY }, locator: { ...SYNTHETIC_SCOPE, expectedBoardRevision: AUTHORITY.boardRevision, expectedBoardDigest: AUTHORITY.boardDigest } }),
    regenerate: async () => release,
    ledger: async () => [syntheticLedgerRecord(release)],
    ...(options.ledgerPort === false ? {} : { exchangeLedger: ledger }),
  };
  const request = { ...PREVIEW, ...(options.boardId ? { boardId: options.boardId } : {}) };
  const preview = async (): Promise<ProviderExchangePlan> => {
    const answer = await service.preview({ actor, scope, request, ports, correlationId: "corr-b23-b2" });
    if (!answer.ok) throw new Error(`preview refused: ${JSON.stringify(answer.refusal)}`);
    return answer.plan;
  };
  const commitRaw = (body: Record<string, unknown>) => service.commit({ actor, scope, request: body, ports, correlationId: "corr-b23-b2" });
  const commit = (plan: ProviderExchangePlan, key: string) => commitRaw({ planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: key });
  const exchange = async (key: string) => { const plan = await preview(); return { plan, answer: await commit(plan, key) }; };
  return { inner, repository: rec.repository, commits: rec.commits, provider, service, ports, ledger, release, preview, commit, commitRaw, exchange, advance: (ms: number) => { clock += ms; } };
}
const envelope = (answer: Awaited<ReturnType<ProviderExchangeService["commit"]>>) => {
  if (answer.ok) throw new Error("a commit answers its recorded envelope");
  return answer.refusal;
};
function outboundPackage(): OutboundPackage {
  const release = syntheticRelease();
  const built = buildOutboundPackage({ release, ledger: syntheticLedgerRecord(release) });
  if (!built.ok) throw new Error(built.refusal);
  return built.package;
}

beforeEach(() => { resetAdmissionControl(); });

describe("[B23-B2] the exchange record mfg.provider-exchange.v1 and the send (OD-167, D23-4, D23-5)", () => {
  it("1. an acknowledged exchange: prepared -> sent -> acknowledged in one aggregate per scope, board and provider; the record keeps the receipt id, the response digest, retrievedAt, the package and release digests, the descriptor and capability-profile versions and the declared bounded fields - never the raw answer and never a file byte", async () => {
    const w = world();
    const { plan, answer } = await w.exchange("key-ack-0001");
    const result = envelope(answer);
    expect(result).toMatchObject({ status: 200, code: "PX_EXCHANGE_ACKNOWLEDGED", body: { ok: true, sent: true, state: "acknowledged", planId: plan.planId, requestDigest: plan.requestDigest, idempotent: false, receipt: { providerReceiptId: "fake-receipt-1", retrievedAt: ISO0 } } });
    // [B23-B2 review, 2026-10-04] regressions-4: the sentence travels in `error` for every code, where the panel reads it (B1's envelope)
    expect(result.body.error).toBe(PROVIDER_EXCHANGE_ERRORS.PX_EXCHANGE_ACKNOWLEDGED.message);
    expect(Object.keys(result.body)).not.toContain("message");
    expect(readFileSync(join(process.cwd(), "app/components/pcb/ProviderExchangePanel.tsx"), "utf8")).toContain('message: typeof body.error === "string" ? body.error : "The server gave no reason."');
    expect(w.provider.calls).toBe(1);
    const history = await w.ledger.history(AGGREGATE);
    expect(history.map((record) => [record.revision, record.phase, record.attempt.state])).toEqual([[1, "prepared", "prepared"], [2, "sent", "sent"], [3, "settled", "acknowledged"]]);
    expect(new Set(history.map((record) => record.aggregateKey)).size).toBe(1);
    const attempt = (await w.ledger.attempt(AGGREGATE, "key-ack-0001"))!;
    const pkg = outboundPackage();
    expect(attempt).toEqual({
      idempotencyKey: "key-ack-0001",
      planId: plan.planId,
      planDigest: plan.planDigest, // [B23-B2 review, 2026-10-04] tests-3: a restart's commit names the plan by id and digest, as B1's store does
      providerIdempotencyKey: w.provider.received[0]!.headers["idempotency-key"], // [B23-B2 review, 2026-10-04] security-2: the key the provider saw (case 17)
      requestDigest: plan.requestDigest,
      committedBy: ADMIN.actorId,
      operationId: "pcb-quote",
      purpose: "quote",
      descriptor: { registryVersion: PROVIDER_REGISTRY_VERSION, registryDigest: durableWorkflowDigest(FAKE_ROW), transferVersion: "0.0.1" },
      capabilityProfile: { profileId: "jlcpcb-2l", version: 2 },
      release: { releaseId: w.release.releaseId, archiveSha256: w.release.archiveSha256 },
      outboundPackageDigest: pkg.outboundPackageDigest,
      retention: "normalized",
      statusRead: "not_declared",
      state: "acknowledged",
      preparedAt: ISO0,
      sentAt: ISO0,
      settledAt: ISO0,
      sendStarted: true,
      request: { bytes: w.provider.received[0]!.body.byteLength, sha256: sha256(w.provider.received[0]!.body) },
      response: { status: 200, contentType: "application/json", bytes: text.encode(acknowledgementText(0)).byteLength, sha256: sha256(acknowledgementText(0)) },
      receipt: { providerReceiptId: "fake-receipt-1", retrievedAt: ISO0 },
      normalized: { status: "received", quotedDays: 5, accepted: true },
      failure: null,
    });
    expect(plan.outbound.outboundPackageDigest).toBe(pkg.outboundPackageDigest);
    expect(attempt.providerIdempotencyKey).toMatch(/^sx-[0-9a-f]{64}$/);
    expect(validateExchangeAttempt(attempt)).toEqual([]);
    // never the raw answer, never a file or archive byte: in what was committed, in what is stored, in the answer
    const committed = JSON.stringify(w.commits);
    const stored = JSON.stringify(history);
    for (const [label, haystack] of [["committed", committed], ["stored", stored], ["answer", JSON.stringify(result)]] as const) {
      expect(haystack, label).not.toContain(RAW_SENTINEL);
      expect(haystack, label).not.toContain("G04 synthetic");
      expect(haystack, label).not.toContain("synthetic-archive:");
      expect(haystack, label).not.toContain("n".repeat(300));
    }
    expect(w.commits.map((request) => request.outbox)).toEqual([[], [], []]);
    expect(w.commits.every((request) => request.operations.every((operation) => operation.aggregateType === PROVIDER_EXCHANGE_AGGREGATE_TYPE))).toBe(true);
  });

  it("2. after the send started, a timeout, a transport error, a server error, an unreadable answer, an answer without a receipt id, an oversized answer or a redirect is UNKNOWN_PENDING_RECONCILIATION: exactly one transport call, never retried, never handed to the outbox, and the same key replays it", async () => {
    const cases: ReadonlyArray<readonly [FakeAnswer, string, boolean]> = [
      ["hang", "timeout", false],
      ["network", "network_error", false],
      ["server-error", "http_503", true],
      ["unparseable", "receipt_unreadable", true],
      ["no-receipt", "receipt_unreadable", true],
      ["oversized", "response_too_large", false],
      ["redirect", "redirect_refused", false],
    ];
    for (const [answer, failure, answered] of cases) {
      resetAdmissionControl(); // each case on a closed breaker: three ambiguous answers in a row open it (b23-b-provider-meter case 6)
      const w = world({ answer, descriptor: fakeDescriptor({ deadlineMs: 150 }) });
      const { plan, answer: first } = await w.exchange(`key-${answer}`);
      expect(envelope(first), answer).toMatchObject({ status: 502, code: "PX_EXCHANGE_UNKNOWN_PENDING_RECONCILIATION", body: { ok: false, sent: true, state: "UNKNOWN_PENDING_RECONCILIATION", failure, idempotent: false } });
      expect(w.provider.calls, answer).toBe(1);
      const attempt = (await w.ledger.attempt(AGGREGATE, `key-${answer}`))!;
      expect(attempt, answer).toMatchObject({ state: "UNKNOWN_PENDING_RECONCILIATION", sendStarted: true, failure, receipt: null, normalized: {} });
      expect(attempt.response !== null, `${answer}: a response digest only for an answer read`).toBe(answered);
      if (answered) expect(JSON.stringify(attempt), answer).not.toContain(RAW_SENTINEL);
      // the same key: replayed, nothing sent
      const again = await w.commit(plan, `key-${answer}`);
      expect(envelope(again), answer).toMatchObject({ code: "PX_EXCHANGE_UNKNOWN_PENDING_RECONCILIATION", body: { idempotent: true } });
      expect(w.provider.calls, answer).toBe(1);
      expect((await w.ledger.history(AGGREGATE)).map((record) => record.phase), answer).toEqual(["prepared", "sent", "settled"]);
      // the outbox holds nothing to run, now or after any lease could have expired
      const sends: DurableEffectHandler = async () => { await w.provider.fetch(FAKE_URL, { method: "POST" }); };
      const dispatcher = new DurableOutboxDispatcher(w.repository, new Map([["mfg.provider-exchange@1", sends]]));
      for (const now of [ISO0, new Date(T0 + 2 * 86_400_000).toISOString()]) expect(await dispatcher.dispatch({ workerId: "b23-b2", now }), answer).toEqual({ claimed: 0, completed: 0, retried: 0, failed: 0 });
      expect(await w.repository.listOutbox(), answer).toEqual([]);
      expect(w.provider.calls, answer).toBe(1);
    }
    // the caller's abort after the send started is UNKNOWN too (the send path takes the caller's signal)
    const provider = fakeProvider("hang");
    const controller = new AbortController();
    const aborting: typeof fetch = async (input, init) => { setTimeout(() => controller.abort(), 10); return provider.fetch(input, init); };
    const outcome = await sendProviderExchange({ descriptor: fakeDescriptor(), package: outboundPackage(), idempotencyKey: "key-abort", env: { [FAKE_ENV]: fakeCredential() }, beforeSend: async () => undefined, signal: controller.signal }, { fetch: aborting, resolve: PUBLIC_RESOLVE, clock: () => T0 });
    expect(outcome).toMatchObject({ state: "UNKNOWN_PENDING_RECONCILIATION", sendStarted: true, failure: "aborted" });
    expect(provider.calls).toBe(1);
  });

  it("3. a provider's refusal is rejected (its status and the answer's digest kept, no receipt, no normalized field); a rate limit is rejected and pauses the provider, so the next exchange is not sent at all", async () => {
    const w = world({ answer: (index) => (index === 0 ? "reject" : "acknowledge") });
    const { answer } = await w.exchange("key-reject");
    expect(envelope(answer)).toMatchObject({ status: 422, code: "PX_EXCHANGE_REJECTED", body: { ok: false, sent: true, state: "rejected", failure: "http_422" } });
    expect(await w.ledger.attempt(AGGREGATE, "key-reject")).toMatchObject({ state: "rejected", receipt: null, normalized: {}, response: { status: 422, contentType: "application/json" } });
    expect(w.provider.calls).toBe(1);
    const limited = world({ answer: "rate-limit" });
    expect(envelope((await limited.exchange("key-429")).answer)).toMatchObject({ code: "PX_EXCHANGE_REJECTED", body: { state: "rejected", failure: "http_429" } });
    const paused = envelope((await limited.exchange("key-after-429")).answer);
    expect(paused).toMatchObject({ status: 429, code: "PX_PROVIDER_PAUSED", body: { sent: false, state: "not_sent", failure: "paused_breaker_open" } });
    expect(limited.provider.calls).toBe(1);
  });

  it("4. the boundary refuses before any byte leaves - no answer from DNS, a private address, a missing credential, a package over the descriptor's ceiling: not_sent, recorded prepared -> not_sent, the transport never called", async () => {
    const pkgBytes = outboundPackage().files.reduce((sum, file) => sum + file.bytes, 0);
    const cases: ReadonlyArray<readonly [string, WorldOptions, string]> = [
      ["no answer from DNS", { resolve: async () => { throw new Error("ENOTFOUND"); } }, "dns_failed"],
      ["a private address", { resolve: async () => ["10.1.2.3"] }, "address_blocked"],
      ["a missing credential", { env: {} }, "credentials_missing"],
      ["over the ceiling", { descriptor: fakeDescriptor({ maxRequestBytes: Math.floor(pkgBytes / 2) }) }, "request_too_large"],
    ];
    for (const [label, options, failure] of cases) {
      const w = world(options);
      const { answer } = await w.exchange(`key-${failure}`);
      expect(envelope(answer), label).toMatchObject({ status: 503, code: "PX_EXCHANGE_NOT_SENT", body: { ok: false, sent: false, state: "not_sent", failure } });
      expect(w.provider.calls, label).toBe(0);
      expect((await w.ledger.history(AGGREGATE)).map((record) => [record.phase, record.attempt.state]), label).toEqual([["prepared", "prepared"], ["settled", "not_sent"]]);
      expect(await w.ledger.attempt(AGGREGATE, `key-${failure}`), label).toMatchObject({ sendStarted: false, sentAt: null, request: null, response: null, receipt: null });
    }
  });

  it("5. a duplicate commit replays the record and sends nothing: the same key on the same service replays its envelope (B1's store); after a restart - a new service with the server's random nonce, its plans and keys in memory gone - the same plan id, digest and key answer the recorded outcome from the durable record, the key with another plan id or digest is refused, an unknown key answers PX_PLAN_NOT_FOUND, and a fresh plan under the key is refused durably; the ledger replays an identical prepare [B23-B2 review, 2026-10-04] tests-3: a real restart (the first round re-sealed the same plan id from the fake nonce and clock, which production cannot)", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const w = world({ repository });
    const { plan, answer } = await w.exchange("key-dup");
    expect(envelope(answer)).toMatchObject({ code: "PX_EXCHANGE_ACKNOWLEDGED", body: { idempotent: false } });
    expect(envelope(await w.commit(plan, "key-dup"))).toMatchObject({ status: 200, code: "PX_EXCHANGE_ACKNOWLEDGED", body: { idempotent: true, receipt: { providerReceiptId: "fake-receipt-1" } } });
    expect(w.provider.calls).toBe(1);
    // a restart: a new service (the server's random nonce; its plans and keys in memory are gone) over the same durable store
    const restarted = world({ repository, randomNonce: true });
    expect(envelope(await restarted.commit(plan, "key-dup"))).toMatchObject({ status: 200, code: "PX_EXCHANGE_ACKNOWLEDGED", body: { idempotent: true, sent: true, planId: plan.planId, requestDigest: plan.requestDigest, receipt: { providerReceiptId: "fake-receipt-1" } } });
    expect(envelope(await restarted.commitRaw({ planId: plan.planId, planDigest: `dw1-${"0".repeat(64)}`, idempotencyKey: "key-dup" }))).toMatchObject({ status: 409, code: "PX_IDEMPOTENCY_KEY_REUSE_CONFLICT" });
    expect(envelope(await restarted.commitRaw({ planId: "provider-exchange-plan:another", planDigest: plan.planDigest, idempotencyKey: "key-dup" }))).toMatchObject({ status: 409, code: "PX_IDEMPOTENCY_KEY_REUSE_CONFLICT" });
    expect(envelope(await restarted.commit(plan, "key-never-used"))).toMatchObject({ status: 404, code: "PX_PLAN_NOT_FOUND" });
    // a fresh plan after the restart under the same key: refused durably, nothing sent
    const second = await restarted.exchange("key-dup");
    expect(second.plan.planId).not.toBe(plan.planId);
    expect(envelope(second.answer)).toMatchObject({ status: 409, code: "PX_IDEMPOTENCY_KEY_REUSE_CONFLICT", body: { sent: false } });
    expect(restarted.provider.calls).toBe(0);
    expect((await w.ledger.history(AGGREGATE)).length).toBe(3);
    // the ledger itself: an identical prepare replays the current record
    const replay = await w.ledger.prepare({ aggregate: AGGREGATE, attempt: exchangeAttemptInput({ plan, key: "key-dup", actorId: ADMIN.actorId, descriptor: fakeDescriptor(), capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } }), at: ISO0 });
    expect(replay).toMatchObject({ ok: true, replayed: true, attempt: { state: "acknowledged", idempotencyKey: "key-dup" } });
    expect((await w.ledger.history(AGGREGATE)).length).toBe(3);
  });

  it("6. two concurrent commits send once: through the ledger the second append of the same attempt meets the first and replays it - by the revision check when both appends start together, by the replay row when the second runs after the first committed (as PostgreSQL serializes them); through the service the plan is consumed once (B1), whichever key the second commit carries", async () => {
    const w = world();
    const plan = await w.preview();
    const descriptor = fakeDescriptor();
    const input = exchangeAttemptInput({ plan, key: "key-race", actorId: ADMIN.actorId, descriptor, capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } });
    const pkg = outboundPackage();
    const once = async (ledger: typeof w.ledger, provider: typeof w.provider) => {
      const begun = await ledger.prepare({ aggregate: AGGREGATE, attempt: input, at: ISO0 });
      if (!begun.ok || begun.replayed) return begun;
      const outcome = await sendProviderExchange({ descriptor, package: pkg, idempotencyKey: begun.attempt.providerIdempotencyKey, env: { [FAKE_ENV]: fakeCredential() }, beforeSend: async (request) => { await ledger.markSent({ aggregate: AGGREGATE, idempotencyKey: "key-race", request, at: ISO0 }); } }, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE, clock: () => T0 }); // [B23-B2 review, 2026-10-04] security-2: the derived key, as the service sends it
      return { ok: true as const, replayed: false, attempt: await ledger.settle({ aggregate: AGGREGATE, idempotencyKey: "key-race", outcome, at: ISO0 }) };
    };
    const results = await Promise.all([once(w.ledger, w.provider), once(w.ledger, w.provider)]);
    expect(results.map((result) => (result.ok ? result.replayed : "refused")).sort()).toEqual([false, true]);
    expect(w.provider.calls).toBe(1);
    expect((await w.ledger.load(AGGREGATE))?.attempts.map((attempt) => [attempt.idempotencyKey, attempt.state])).toEqual([["key-race", "acknowledged"]]);
    // the replay row's path: both read no attempt, then each append runs only after the one before it committed (one transaction at
    // a time); the second meets the first's replay row, so nothing it holds is new and it sends nothing
    const inner = new InMemoryDurableWorkflowRepository();
    let queue: Promise<unknown> = Promise.resolve();
    const serialized: DurableWorkflowRepository = { ...recording(inner).repository, commit: (request) => { const run = queue.then(() => inner.commit(request)); queue = run.catch(() => undefined); return run as never; } };
    const serialLedger = createProviderExchangeLedger(serialized);
    const serialProvider = fakeProvider();
    const serial = await Promise.all([once(serialLedger, serialProvider), once(serialLedger, serialProvider)]);
    expect(serial.map((result) => (result.ok ? result.replayed : "refused")).sort()).toEqual([false, true]);
    expect(serialProvider.calls).toBe(1);
    // through the service: one plan, two concurrent commits (the same key, then another key)
    for (const keys of [["key-a", "key-a"], ["key-b", "key-c"]] as const) {
      const v = world();
      const shared = await v.preview();
      const answers = await Promise.all(keys.map((key) => v.commit(shared, key)));
      expect(answers.map((answer) => envelope(answer).code).sort(), keys.join("/")).toEqual(["PX_EXCHANGE_ACKNOWLEDGED", "PX_PLAN_CONSUMED"]);
      expect(v.provider.calls, keys.join("/")).toBe(1);
    }
  });

  it("7. a provider whose terms forbid storage keeps ids, digests and timestamps only: no normalized field is recorded, and a record that carries one is refused", async () => {
    const w = world({ descriptor: fakeDescriptor({ retention: "ids_digests_timestamps_only" }) });
    expect(envelope((await w.exchange("key-ids-only")).answer)).toMatchObject({ code: "PX_EXCHANGE_ACKNOWLEDGED" });
    const attempt = (await w.ledger.attempt(AGGREGATE, "key-ids-only"))!;
    expect(attempt).toMatchObject({ retention: "ids_digests_timestamps_only", normalized: {}, receipt: { providerReceiptId: "fake-receipt-1", retrievedAt: ISO0 }, response: { sha256: sha256(acknowledgementText(0)) } });
    expect(validateExchangeAttempt({ ...attempt, normalized: { status: "received" } })).toContain("$.normalized");
    // [B23-B2 review, 2026-10-04] coverage-6: the exact record - Sirkit's own classification (state, failure) and the answer's protocol
    // status, size and digest; no provider-chosen text (the media type is stored empty), no normalized field (OD-184 (k))
    expect(Object.fromEntries(["state", "failure", "response", "receipt", "normalized", "sendStarted"].map((key) => [key, (attempt as unknown as Record<string, unknown>)[key]]))).toEqual({
      state: "acknowledged",
      failure: null,
      response: { status: 200, contentType: "", bytes: text.encode(acknowledgementText(0)).byteLength, sha256: sha256(acknowledgementText(0)) },
      receipt: { providerReceiptId: "fake-receipt-1", retrievedAt: ISO0 },
      normalized: {},
      sendStarted: true,
    });
    expect(validateExchangeAttempt({ ...attempt, response: { ...attempt.response!, contentType: "application/json" } })).toContain("$.response");
    const rejected = world({ answer: "reject", descriptor: fakeDescriptor({ retention: "ids_digests_timestamps_only" }) });
    await rejected.exchange("key-ids-only-reject");
    expect(await rejected.ledger.attempt(AGGREGATE, "key-ids-only-reject")).toMatchObject({ state: "rejected", failure: "http_422", response: { status: 422, contentType: "" } });
    // bounded on every record: at most 16 fields of short text, a finite number or a boolean
    const normal = (await world().exchange("key-normal")).answer;
    expect(envelope(normal).code).toBe("PX_EXCHANGE_ACKNOWLEDGED");
    const base = { ...attempt, retention: "normalized" as const };
    expect(validateExchangeAttempt({ ...base, normalized: { note: "n".repeat(257) } })).toContain("$.normalized");
    expect(validateExchangeAttempt({ ...base, normalized: { count: Number.POSITIVE_INFINITY } })).toContain("$.normalized");
    expect(validateExchangeAttempt({ ...base, normalized: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`f${index}`, index])) })).toContain("$.normalized");
    expect(validateExchangeAttempt({ ...base, normalized: { nested: { a: 1 } } as never })).toContain("$.normalized");
  });

  it("8. every digest is re-verified on load: a stored record whose payload no longer matches its digest, whose attempt digest is wrong, or whose replay disagrees with the stored record is refused with one closed error", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const w = world({ repository: inner });
    await w.exchange("key-verify");
    expect(await w.ledger.attempt(AGGREGATE, "key-verify")).toMatchObject({ state: "acknowledged" });
    const forged = (mutate: (payload: Record<string, unknown>) => void, redigest: boolean) => (record: DurableAggregateRecord): DurableAggregateRecord => {
      const payload = structuredClone(record.payload) as Record<string, unknown>;
      mutate(payload);
      return { ...record, payload, recordDigest: redigest ? durableWorkflowDigest(payload) : record.recordDigest };
    };
    const tamperings: ReadonlyArray<readonly [string, (record: DurableAggregateRecord) => DurableAggregateRecord]> = [
      ["a changed receipt, digest kept", forged((payload) => { (payload.attempt as Record<string, unknown>).receipt = { providerReceiptId: "forged", retrievedAt: ISO0 }; }, false)],
      ["a changed receipt, record digest recomputed but not the attempt digest", forged((payload) => { (payload.attempt as Record<string, unknown>).receipt = { providerReceiptId: "forged", retrievedAt: ISO0 }; }, true)],
      ["another aggregate type", (record) => ({ ...record, aggregateType: "computation.evidence.v1" })],
      ["a record digest that is not the stored one", (record) => ({ ...record, recordDigest: `dw1-${"0".repeat(64)}` })],
    ];
    for (const [label, tamper] of tamperings) {
      const tampered = createProviderExchangeLedger(recording(inner, tamper).repository);
      await expect(tampered.attempt(AGGREGATE, "key-verify"), label).rejects.toBeInstanceOf(ProviderExchangeLedgerIntegrityError);
      await expect(tampered.history(AGGREGATE), label).rejects.toBeInstanceOf(ProviderExchangeLedgerIntegrityError);
      await expect(tampered.load(AGGREGATE), label).rejects.toBeInstanceOf(ProviderExchangeLedgerIntegrityError);
    }
    // [B23-B2 review, 2026-10-04] tests-5: a REPLAY that disagrees with the record stored under its id (records and heads read as
    // stored), each caught by its own check: a self-consistent replay record that is not the stored one (the digest comparison), a
    // replay record whose payload no longer matches its own digest (the replay's verification), and a replay pointing at another
    // phase's or another key's valid record (the phase and key check)
    await w.exchange("key-verify-other");
    expect(await w.ledger.attempt(AGGREGATE, "key-verify-other")).toMatchObject({ state: "acknowledged" });
    type ReplayRewrite = (record: DurableAggregateRecord, at: { scope: Parameters<DurableWorkflowRepository["getReplay"]>[0]; scopeKey: string; key: string }) => Promise<DurableAggregateRecord>;
    const replaysRewritten = (rewrite: ReplayRewrite): DurableWorkflowRepository => ({
      ...delegate(inner),
      getReplay: async (scope, scopeKey, key) => {
        const replay = await inner.getReplay(scope, scopeKey, key);
        if (!replay || key !== "attempt:key-verify:settled") return replay as never;
        return { ...replay, records: await Promise.all(replay.records.map((record) => rewrite(structuredClone(record), { scope, scopeKey, key }))) } as never;
      },
    });
    const otherRecord = async (at: { scope: Parameters<DurableWorkflowRepository["getReplay"]>[0]; scopeKey: string }, key: string): Promise<DurableAggregateRecord> => (await inner.getReplay(at.scope, at.scopeKey, key))!.records[0]!;
    const replayTamperings: ReadonlyArray<readonly [string, ReplayRewrite]> = [
      ["a self-consistent replay record that is not the stored one", async (record) => {
        const payload = structuredClone(record.payload) as Record<string, unknown>;
        const attempt = payload.attempt as Record<string, unknown>;
        attempt.receipt = { providerReceiptId: "forged", retrievedAt: ISO0 };
        payload.attemptDigest = durableWorkflowDigest(attempt);
        return { ...record, payload, recordDigest: durableWorkflowDigest(payload) };
      }],
      ["a replay record whose payload no longer matches its own digest", async (record) => {
        const payload = structuredClone(record.payload) as Record<string, unknown>;
        (payload.attempt as Record<string, unknown>).receipt = { providerReceiptId: "forged", retrievedAt: ISO0 };
        return { ...record, payload };
      }],
      ["the settled replay pointing at the same key's prepared record", async (_record, at) => otherRecord(at, "attempt:key-verify:prepared")],
      ["the settled replay pointing at another key's settled record", async (_record, at) => otherRecord(at, "attempt:key-verify-other:settled")],
    ];
    for (const [label, rewrite] of replayTamperings) {
      const tampered = createProviderExchangeLedger(replaysRewritten(rewrite));
      await expect(tampered.attempt(AGGREGATE, "key-verify"), label).rejects.toBeInstanceOf(ProviderExchangeLedgerIntegrityError);
      expect((await tampered.history(AGGREGATE)).length, label).toBe(6); // the records themselves are intact
    }
  });

  it("9. no outbox effect, ever, and no outbox handler performs a send: every commit carries an empty outbox; an attempt interrupted after `sent` (a crash before its answer was recorded) leaves nothing to claim, even once any lease has expired, and a commit with its key answers IN_FLIGHT and sends nothing [B23-B2 review, 2026-10-04] tests-3: here the interrupted record is written through the ledger while the plan is still held; case 16 interrupts a real send and restarts the service", async () => {
    const w = world();
    const plan = await w.preview();
    const descriptor = fakeDescriptor();
    const begun = await w.ledger.prepare({ aggregate: AGGREGATE, attempt: exchangeAttemptInput({ plan, key: "key-crash", actorId: ADMIN.actorId, descriptor, capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } }), at: ISO0 });
    expect(begun).toMatchObject({ ok: true, replayed: false });
    await w.ledger.markSent({ aggregate: AGGREGATE, idempotencyKey: "key-crash", request: { bytes: 1, sha256: "a".repeat(64) }, at: ISO0 });
    // ... and the process stopped here: no answer recorded
    expect(await w.ledger.attempt(AGGREGATE, "key-crash")).toMatchObject({ state: "sent", sendStarted: true, settledAt: null });
    const handlers = new Map<string, DurableEffectHandler>([["mfg.provider-exchange@1", async () => { await w.provider.fetch(FAKE_URL, { method: "POST" }); }], ["mfg.release-recorded@1", async () => { await w.provider.fetch(FAKE_URL, { method: "POST" }); }]]);
    const dispatcher = new DurableOutboxDispatcher(w.repository, handlers);
    for (const now of [ISO0, new Date(T0 + 30_000).toISOString(), new Date(T0 + 7 * 86_400_000).toISOString()]) {
      expect(await dispatcher.dispatch({ workerId: "b23-b2", now, leaseMs: 1 })).toEqual({ claimed: 0, completed: 0, retried: 0, failed: 0 });
      expect(await w.repository.claimOutbox({ workerId: "b23-b2-reclaim", now, leaseUntil: new Date(Date.parse(now) + 1).toISOString(), limit: 100 })).toEqual([]);
    }
    expect(await w.repository.listOutbox()).toEqual([]);
    const answer = envelope(await w.commit(plan, "key-crash"));
    expect(answer).toMatchObject({ status: 409, code: "PX_EXCHANGE_IN_FLIGHT", body: { idempotent: true, state: "sent" } });
    expect(w.provider.calls).toBe(0);
    expect(w.commits.every((request) => Array.isArray(request.outbox) && request.outbox.length === 0)).toBe(true);
    expect(w.commits.length).toBe(2);
  });

  it("10. in production no provider is admitted, so the route's service still ends provider_not_admitted before any byte leaves: no transfer descriptor exists, the fake one fails against the reviewed registry, and the reviewed admission refuses even with one; a forged admission without a reviewed descriptor or without the durable record sends nothing either", async () => {
    expect(PROVIDER_TRANSFER_DESCRIPTORS).toEqual([]);
    expect(Object.isFrozen(PROVIDER_TRANSFER_DESCRIPTORS)).toBe(true);
    expect(validateTransferDescriptor(fakeDescriptor(), PROVIDER_ROWS).sort()).toEqual(["$.auth.env", "$.operationId", "$.registry.rowDigest", "$.url", "row.idempotency", "row.limits.upload"]);
    for (const row of PROVIDER_ROWS) expect(row.endpoint.hosts.length === 0 || row.b19Source !== null, row.id).toBe(true);
    expect(transferDescriptorFor([fakeDescriptor()], PROVIDER_ROWS, "jlcpcb", "pcb-quote")).toBeNull();
    const reviewed = world({ admit: null });
    expect(envelope((await reviewed.exchange("key-prod")).answer)).toMatchObject({ status: 409, code: "PX_PROVIDER_NOT_ADMITTED", body: { refusal: "provider_not_admitted", sent: false } });
    const noDescriptor = world({ descriptor: null });
    expect(envelope((await noDescriptor.exchange("key-no-descriptor")).answer)).toMatchObject({ status: 409, code: "PX_SEND_UNAVAILABLE", body: { sent: false } });
    const noLedger = world({ ledgerPort: false });
    expect(envelope((await noLedger.exchange("key-no-ledger")).answer)).toMatchObject({ status: 409, code: "PX_SEND_UNAVAILABLE", body: { sent: false } });
    for (const quiet of [reviewed, noDescriptor, noLedger]) {
      expect(quiet.provider.calls).toBe(0);
      expect(quiet.commits).toEqual([]);
    }
  });

  it("11. the transfer descriptor is reviewed against its registry row, and each rule bites: the ceiling and part bounds, HTTPS on a host the row lists, no query or credentials in the URL, the row's version and digest, a board-file transfer operation that is enabled, a recorded upload limit and idempotency fact, a credential named by the row and carried in a plain header, a closed retention, a declared status read naming a read operation, and bounded meters", () => {
    expect(validateTransferDescriptor(fakeDescriptor(), FAKE_ROWS)).toEqual([]);
    expect(transferDescriptorFor([fakeDescriptor()], FAKE_ROWS, "jlcpcb", "pcb-quote")).toEqual(fakeDescriptor());
    const bites: ReadonlyArray<readonly [string, Partial<ProviderTransferDescriptor>]> = [
      ["$.maxRequestBytes", { maxRequestBytes: 64 * 1024 * 1024 + 1 }],
      ["$.maxRequestBytes", { maxRequestBytes: 0 }],
      ["$.maxParts", { maxParts: 65 }],
      ["$.deadlineMs", { deadlineMs: 120_001 }],
      ["$.maxResponseBytes", { maxResponseBytes: 1_048_577 }],
      ["$.url", { url: `http://${FAKE_HOST}/v1/quote-uploads` }],
      ["$.url", { url: "https://elsewhere.example/v1/quote-uploads" }],
      ["$.url", { url: `${FAKE_URL}?token=x` }],
      ["$.url", { url: `https://user:secret@${FAKE_HOST}/v1/quote-uploads` }],
      ["$.registry.version", { registry: { version: "0.9.0", rowDigest: durableWorkflowDigest(FAKE_ROW) } }],
      ["$.registry.rowDigest", { registry: { version: PROVIDER_REGISTRY_VERSION, rowDigest: `dw1-${"0".repeat(64)}` } }],
      ["$.operationId", { operationId: "manual-quote-upload" }],
      ["$.operationId", { operationId: "pcb-order" }],
      ["$.operationId", { operationId: "no-such-operation" }],
      ["$.auth.env", { auth: { kind: "header", header: "X-Fake-Provider-Token", env: "SIRKIT_UNLISTED_TOKEN" } }],
      ["$.auth.header", { auth: { kind: "header", header: "Idempotency-Key", env: FAKE_ENV } }],
      ["$.auth.header", { auth: { kind: "header", header: "Authorization: x", env: FAKE_ENV } }],
      ["$.retention", { retention: "forever" as never }],
      ["$.statusRead", { statusRead: { declared: true, operationId: "pcb-quote" } }],
      ["$.receipt", { receipt: { idField: "receiptId", fields: ["receiptId"] } }],
      ["$.receipt", { receipt: { idField: "receipt id", fields: [] } }],
      ["$.meter", { meter: { requestsPerMinute: 0, requestsPerDay: 500, consecutiveFailuresToOpen: 3, openMs: 60_000 } }],
      ["$.meter", { meter: { requestsPerMinute: 30, requestsPerDay: 500, consecutiveFailuresToOpen: 3, openMs: 0 } }],
      ["$.schema", { schema: "sirkit.provider-transfer-descriptor.v0" as never }],
    ];
    for (const [problem, overrides] of bites) expect(validateTransferDescriptor(fakeDescriptor(overrides), FAKE_ROWS), `${problem} ${JSON.stringify(overrides)}`).toContain(problem);
    const unrecorded = FAKE_ROWS.map((row) => (row.id === "jlcpcb" ? { ...FAKE_ROW, limits: { ...FAKE_ROW.limits, upload: { value: "UNKNOWN" as const, reason: "not read" } } } : row));
    expect(validateTransferDescriptor({ ...fakeDescriptor(), registry: { version: PROVIDER_REGISTRY_VERSION, rowDigest: durableWorkflowDigest(unrecorded.find((row) => row.id === "jlcpcb")) } }, unrecorded)).toContain("row.limits.upload");
    expect(transferDescriptorFor([fakeDescriptor({ maxParts: 65 })], FAKE_ROWS, "jlcpcb", "pcb-quote")).toBeNull();
  });

  it("12. reconciliation is recorded, not built: the record says whether the descriptor declares a human-initiated status read; neither module exports a reconciliation or status-read operation", async () => {
    const w = world({ descriptor: fakeDescriptor({ statusRead: { declared: true, operationId: "quote-status" } }) });
    expect(envelope((await w.exchange("key-status")).answer).code).toBe("PX_EXCHANGE_ACKNOWLEDGED");
    expect(await w.ledger.attempt(AGGREGATE, "key-status")).toMatchObject({ statusRead: "declared" });
    for (const name of [...Object.keys(egressModule), ...Object.keys(ledgerModule)]) expect(name, name).not.toMatch(/reconcil|statusread|readstatus|poll/i);
  });

  it("13. what leaves is exactly the package the plan named: the six files and the provider manifest, byte for byte, as one multipart POST to the descriptor's URL with the credential in a header, Idempotency-Key when declared, and the request's digest recorded", async () => {
    const w = world();
    const { plan } = await w.exchange("key-exact");
    const [sent] = w.provider.received;
    expect(sent!.url).toBe(FAKE_URL);
    expect(sent!.method).toBe("POST");
    expect(sent!.headers[FAKE_AUTH_HEADER.toLowerCase()]).toBe(fakeCredential());
    // [B23-B2 review, 2026-10-04] reviewed pin move (was toBe("key-exact")), security-2: the header carries the server-derived key, never the client's
    expect(sent!.headers["idempotency-key"]).toMatch(/^sx-[0-9a-f]{64}$/);
    expect(sent!.headers["idempotency-key"]).toBe((await w.ledger.attempt(AGGREGATE, "key-exact"))!.providerIdempotencyKey);
    const parts = await readMultipart(sent!);
    const pkg = outboundPackage();
    expect(parts.map((entry) => [entry.field, entry.name])).toEqual([...pkg.files.map((file) => ["files", file.path]), ["manifest", OUTBOUND_MANIFEST_PATH]]);
    for (const file of pkg.files) expect(parts.find((entry) => entry.name === file.path)!.bytes, file.path).toEqual(file.content);
    expect(parts.at(-1)!.bytes).toEqual(pkg.manifest.content);
    expect(plan.outbound.files.map((file) => file.sha256)).toEqual(pkg.files.map((file) => sha256(file.content)));
    expect(await w.ledger.attempt(AGGREGATE, "key-exact")).toMatchObject({ request: { bytes: sent!.body.byteLength, sha256: sha256(sent!.body) } });
    // undeclared idempotency: the same exchange carries no Idempotency-Key
    const undeclared = world({ descriptor: fakeDescriptor({ idempotencyKeyHeader: false }) });
    await undeclared.exchange("key-undeclared");
    expect(Object.keys(undeclared.provider.received[0]!.headers)).not.toContain("idempotency-key");
  });

  // ─── [B23-B2 review, 2026-10-04] the adversarial review's confirmed findings, each reproduced first ──────────────────────────────

  it("14. the deadline bounds the `sent` mark: a mark slower than the descriptor's deadline hands nothing over - the exchange ends not_sent (timeout), the record settles prepared -> sent -> not_sent with nothing handed over, and the breaker learns nothing; a mark that fails ends not_sent (record_unavailable), never a network error [B23-B2 review, 2026-10-04] regressions-1, tests-1, coverage-4", async () => {
    const tight = fakeDescriptor({ deadlineMs: 100, meter: { requestsPerMinute: 30, requestsPerDay: 500, consecutiveFailuresToOpen: 1, openMs: 60_000 } });
    const w = world({ repository: faulty(new InMemoryDurableWorkflowRepository(), (request) => (phaseOf(request) === "sent" ? 400 : undefined)), descriptor: tight });
    const { answer } = await w.exchange("key-slow-mark");
    expect(envelope(answer)).toMatchObject({ status: 503, code: "PX_EXCHANGE_NOT_SENT", body: { ok: false, sent: false, state: "not_sent", failure: "timeout", idempotent: false } });
    expect(w.provider.calls).toBe(0);
    expect((await w.ledger.history(AGGREGATE)).map((record) => [record.phase, record.attempt.state])).toEqual([["prepared", "prepared"], ["sent", "sent"], ["settled", "not_sent"]]);
    expect(await w.ledger.attempt(AGGREGATE, "key-slow-mark")).toMatchObject({ state: "not_sent", sendStarted: false, failure: "timeout", response: null, receipt: null });
    // one failure would open this breaker: the next exchange goes, so the mark's deadline was no failure of the provider
    const next = world({ descriptor: tight });
    expect(envelope((await next.exchange("key-after-slow-mark")).answer).code).toBe("PX_EXCHANGE_ACKNOWLEDGED");
    // a mark that fails: nothing handed over, recorded prepared -> not_sent under its own code
    const failing = world({ repository: faulty(new InMemoryDurableWorkflowRepository(), (request) => (phaseOf(request) === "sent" ? "fail" : undefined)) });
    expect(envelope((await failing.exchange("key-failed-mark")).answer)).toMatchObject({ status: 503, code: "PX_EXCHANGE_NOT_SENT", body: { sent: false, state: "not_sent", failure: "record_unavailable" } });
    expect(failing.provider.calls).toBe(0);
    expect((await failing.ledger.history(AGGREGATE)).map((record) => [record.phase, record.attempt.state])).toEqual([["prepared", "prepared"], ["settled", "not_sent"]]);
  });

  it("15. an answer that cannot be recorded is never lost and never resent: the settle is retried (a durable write, never a send); if it still fails, the answer carries the provider's receipt and the response's status, size and digest with recorded false, the record stays sent, and the same key replays that answer; a settle that fails once is recorded on retry; a media type with a control character is recorded (no usable JSON type: UNKNOWN), not refused [B23-B2 review, 2026-10-04] coverage-1, tests-2", async () => {
    const settleFails = () => {
      const seen = { settles: 0 };
      const repository = faulty(new InMemoryDurableWorkflowRepository(), (request) => {
        if (phaseOf(request) !== "settled") return undefined;
        seen.settles += 1;
        return "fail";
      });
      return { seen, repository };
    };
    const store = settleFails();
    const acked = world({ repository: store.repository });
    const { plan, answer } = await acked.exchange("key-unrecorded");
    const result = envelope(answer);
    expect(result).toMatchObject({ status: 502, code: "PX_EXCHANGE_UNKNOWN_PENDING_RECONCILIATION", body: { ok: false, sent: true, state: "UNKNOWN_PENDING_RECONCILIATION", observed: "acknowledged", failure: "record_unavailable", recorded: false, idempotent: false, receipt: { providerReceiptId: "fake-receipt-1", retrievedAt: ISO0 }, response: { status: 200, bytes: text.encode(acknowledgementText(0)).byteLength, sha256: sha256(acknowledgementText(0)) } } });
    expect(JSON.stringify(result)).not.toContain(RAW_SENTINEL);
    expect(store.seen.settles).toBeGreaterThanOrEqual(2); // retried, and bounded (it ended)
    expect(acked.provider.calls).toBe(1);
    expect(await acked.ledger.attempt(AGGREGATE, "key-unrecorded")).toMatchObject({ state: "sent", settledAt: null });
    expect(envelope(await acked.commit(plan, "key-unrecorded"))).toMatchObject({ status: 502, body: { idempotent: true, recorded: false, receipt: { providerReceiptId: "fake-receipt-1" } } });
    expect(acked.provider.calls).toBe(1);
    // a server error that cannot be recorded: its status and digest are answered
    const failed = world({ repository: settleFails().repository, answer: "server-error" });
    expect(envelope((await failed.exchange("key-unrecorded-503")).answer)).toMatchObject({ status: 502, body: { observed: "UNKNOWN_PENDING_RECONCILIATION", failure: "record_unavailable", recorded: false, receipt: null, response: { status: 503 } } });
    // a settle that fails once is recorded on retry
    let first = true;
    const once = world({ repository: faulty(new InMemoryDurableWorkflowRepository(), (request) => {
      if (phaseOf(request) !== "settled" || !first) return undefined;
      first = false;
      return "fail";
    }) });
    expect(envelope((await once.exchange("key-retried")).answer)).toMatchObject({ status: 200, code: "PX_EXCHANGE_ACKNOWLEDGED", body: { idempotent: false } });
    expect(await once.ledger.attempt(AGGREGATE, "key-retried")).toMatchObject({ state: "acknowledged", receipt: { providerReceiptId: "fake-receipt-1" } });
    expect(once.provider.calls).toBe(1);
    // a control character in the answer's media type: recorded, the media type stored empty, UNKNOWN (no usable JSON type)
    const control = world({ answer: "control-media-type" });
    const controlled = envelope((await control.exchange("key-control")).answer);
    expect(controlled).toMatchObject({ status: 502, code: "PX_EXCHANGE_UNKNOWN_PENDING_RECONCILIATION", body: { failure: "receipt_unreadable", idempotent: false } });
    expect(Object.keys(controlled.body)).not.toContain("recorded");
    expect(await control.ledger.attempt(AGGREGATE, "key-control")).toMatchObject({ state: "UNKNOWN_PENDING_RECONCILIATION", failure: "receipt_unreadable", response: { status: 200, contentType: "" } });
  });

  it("16. an interrupted exchange is never resent behind a person's back: when a sent exchange's answer could not be recorded (the record stays sent) and the server restarts, a fresh preview of the same package to the same provider under a fresh key answers PX_EXCHANGE_IN_FLIGHT and sends nothing, and so does the interrupted plan's own key; two concurrent commits of one package under two plans send once [B23-B2 review, 2026-10-04] coverage-2, tests-3", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    let down = true;
    const first = world({ repository: faulty(inner, (request) => (down && phaseOf(request) === "settled" ? "fail" : undefined)) });
    const interrupted = await first.exchange("key-interrupted");
    expect(envelope(interrupted.answer)).toMatchObject({ status: 502, body: { recorded: false, sent: true } });
    expect(first.provider.calls).toBe(1);
    down = false;
    // the restart: a new service (the server's random nonce) over the same store
    const after = world({ repository: inner, randomNonce: true });
    const again = await after.exchange("key-fresh");
    expect(envelope(again.answer)).toMatchObject({ status: 409, code: "PX_EXCHANGE_IN_FLIGHT", body: { sent: false, inFlight: { planId: interrupted.plan.planId, state: "sent" }, idempotent: false } });
    expect(envelope(await after.commit(interrupted.plan, "key-interrupted"))).toMatchObject({ status: 409, code: "PX_EXCHANGE_IN_FLIGHT", body: { idempotent: true, state: "sent" } });
    expect(after.provider.calls).toBe(0);
    expect((await after.ledger.load(AGGREGATE))?.attempts.map((attempt) => [attempt.idempotencyKey, attempt.state])).toEqual([["key-interrupted", "sent"]]);
    // two concurrent commits of one package under two plans (two previews, two keys): one sends, the other answers in flight
    const v = world();
    const [p1, p2] = [await v.preview(), await v.preview()];
    const answers = await Promise.all([v.commit(p1, "key-one"), v.commit(p2, "key-two")]);
    expect(answers.map((entry) => envelope(entry).code).sort()).toEqual(["PX_EXCHANGE_ACKNOWLEDGED", "PX_EXCHANGE_IN_FLIGHT"]);
    expect(v.provider.calls).toBe(1);
  });

  it("17. the provider never receives the client's idempotency key: the Idempotency-Key sent is derived on the server from the scope, the board, the provider, the plan and the key (sx- and 64 hex), recorded on the attempt and re-derived on load, and different for the same client key in another project [B23-B2 review, 2026-10-04] security-2, coverage-3", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const w = world({ repository: inner });
    await w.exchange("shared-client-key");
    const header = w.provider.received[0]!.headers["idempotency-key"]!;
    expect(header).toMatch(/^sx-[0-9a-f]{64}$/);
    expect(header).not.toContain("shared-client-key");
    expect((await w.ledger.attempt(AGGREGATE, "shared-client-key"))!.providerIdempotencyKey).toBe(header);
    const tenant: ProviderExchangeScope = { tenantId: "tenant-b23-other", projectId: SCOPE.projectId, branchId: SCOPE.branchId };
    const other = world({ scope: tenant });
    expect(envelope((await other.exchange("shared-client-key")).answer).code).toBe("PX_EXCHANGE_ACKNOWLEDGED");
    const otherHeader = other.provider.received[0]!.headers["idempotency-key"]!;
    expect(otherHeader).toMatch(/^sx-[0-9a-f]{64}$/);
    expect(otherHeader).not.toBe(header);
    // a stored key that is not its own derivation is refused on load, even with every digest recomputed
    const forged = (record: DurableAggregateRecord): DurableAggregateRecord => {
      const payload = structuredClone(record.payload) as Record<string, unknown>;
      const attempt = payload.attempt as Record<string, unknown>;
      attempt.providerIdempotencyKey = `sx-${"0".repeat(64)}`;
      payload.attemptDigest = durableWorkflowDigest(attempt);
      return { ...record, payload, recordDigest: durableWorkflowDigest(payload) };
    };
    await expect(createProviderExchangeLedger(recording(inner, forged).repository).history(AGGREGATE)).rejects.toBeInstanceOf(ProviderExchangeLedgerIntegrityError);
  });

  it("18. only the call that wrote `sent` may hand the bytes over: two concurrent sent marks of one prepared attempt - exactly one resolves, the other is refused, and one sent record exists [B23-B2 review, 2026-10-04] tests-7", async () => {
    const w = world();
    const plan = await w.preview();
    expect(await w.ledger.prepare({ aggregate: AGGREGATE, attempt: exchangeAttemptInput({ plan, key: "key-mark", actorId: ADMIN.actorId, descriptor: fakeDescriptor(), capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } }), at: ISO0 })).toMatchObject({ ok: true, replayed: false });
    const marks = await Promise.allSettled([1, 2].map(() => w.ledger.markSent({ aggregate: AGGREGATE, idempotencyKey: "key-mark", request: { bytes: 1, sha256: "a".repeat(64) }, at: ISO0 })));
    expect(marks.map((mark) => mark.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(marks.flatMap((mark) => (mark.status === "rejected" ? [mark.reason] : []))[0]).toBeInstanceOf(ProviderExchangeLedgerTransitionError);
    expect((await w.ledger.history(AGGREGATE)).map((record) => record.phase)).toEqual(["prepared", "sent"]);
  });

  it("19. a concurrent first append that PostgreSQL refuses by its unique index (23505: no head row yet) is contention, like a revision conflict: the loser retries on the new head, so two first attempts of different packages are both recorded [B23-B2 review, 2026-10-04] tests-8", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const seen = { translated: 0, heads: 0 };
    const release: Array<() => void> = [];
    const unique: DurableWorkflowRepository = {
      ...delegate(inner),
      // the first two head reads wait for each other: both appends see no head row, as two concurrent first commits do
      loadHead: async (identity) => {
        const head = await inner.loadHead(identity);
        if (seen.heads < 2) { seen.heads += 1; await new Promise<void>((resolve) => { release.push(resolve); if (release.length === 2) release.forEach((go) => go()); }); }
        return head as never;
      },
      commit: async (request) => {
        try {
          return await inner.commit(request);
        } catch (error) {
          if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT" && request.operations[0]!.expectedRevision === 0) {
            seen.translated += 1;
            throw new Error("query failed", { cause: Object.assign(new Error('duplicate key value violates unique constraint "durable_workflow_heads_pkey"'), { code: "23505" }) });
          }
          throw error;
        }
      },
    };
    const ledger = createProviderExchangeLedger(unique);
    const w = world();
    const plan = await w.preview();
    const attemptFor = (key: string, digest: string) => exchangeAttemptInput({ plan: { ...plan, requestDigest: digest, outbound: { ...plan.outbound, outboundPackageDigest: `mfg-outbound-${digest.slice(-64)}` } }, key, actorId: ADMIN.actorId, descriptor: fakeDescriptor(), capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } }); // [B23-B2 lead, 2026-10-04] low-3, moved in place: two packages are two package digests (the in-flight check keys on the package, no longer the request digest)
    const both = await Promise.all([ledger.prepare({ aggregate: AGGREGATE, attempt: attemptFor("key-first-a", `dw1-${"a".repeat(64)}`), at: ISO0 }), ledger.prepare({ aggregate: AGGREGATE, attempt: attemptFor("key-first-b", `dw1-${"b".repeat(64)}`), at: ISO0 })]);
    expect(both).toMatchObject([{ ok: true, replayed: false }, { ok: true, replayed: false }]);
    expect(seen.translated).toBeGreaterThanOrEqual(1);
    expect((await ledger.history(AGGREGATE)).map((record) => [record.revision, record.attempt.idempotencyKey]).sort()).toEqual([[1, expect.any(String)], [2, expect.any(String)]]);
  });

  it("20. a record that keeps moving refuses the exchange (PX_EXCHANGE_CONTENDED after the bounded revision retries) and an attempt the record refuses as invalid answers PX_SEND_UNAVAILABLE: nothing is sent either way [B23-B2 review, 2026-10-04] tests-2", async () => {
    const seen = { prepares: 0 };
    const moving = world({ repository: { ...delegate(new InMemoryDurableWorkflowRepository()), commit: async () => { seen.prepares += 1; throw new Error("DW_OPTIMISTIC_REVISION_CONFLICT"); } } });
    expect(envelope((await moving.exchange("key-moving")).answer)).toMatchObject({ status: 409, code: "PX_EXCHANGE_CONTENDED", body: { sent: false } });
    expect(seen.prepares).toBe(8);
    expect(moving.provider.calls).toBe(0);
    const invalid = world({ actor: { ...ADMIN, actorId: "u".repeat(201) } });
    expect(envelope((await invalid.exchange("key-invalid")).answer)).toMatchObject({ status: 409, code: "PX_SEND_UNAVAILABLE", body: { sent: false } });
    expect(invalid.provider.calls).toBe(0);
    expect(invalid.commits).toEqual([]);
  });

  it("21. the route's B16.0.2 classification says durable read only while no reviewed transfer descriptor exists: with one, a commit writes the exchange record, and the row must then say read-write [B23-B2 review, 2026-10-04] regressions-3", () => {
    /** Why the row's durable access is wrong for the descriptors that exist (null: it is right). */
    const violation = (descriptors: readonly unknown[], durable: string): string | null => {
      const expected = descriptors.length === 0 ? "read" : "read-write";
      return durable === expected ? null : `with ${descriptors.length} reviewed transfer descriptor(s) the commit ${descriptors.length === 0 ? "writes nothing" : "writes mfg.provider-exchange.v1"}, so the row must say ${expected}, not ${durable}`;
    };
    const row = routeResourceClassification().find((entry) => entry.path === "/api/pcb/provider-exchange" && entry.method === "POST")!;
    expect(row.durableAccess).toBe("read");
    expect(violation(PROVIDER_TRANSFER_DESCRIPTORS, row.durableAccess)).toBeNull();
    // the rule bites: one reviewed descriptor and the row still read
    expect(violation([fakeDescriptor()], row.durableAccess)).toMatch(/must say read-write, not read$/);
    expect(violation([fakeDescriptor()], "read-write")).toBeNull();
  });

  it("22. a key names at most one attempt per project, as B1's store does, and after a restart too: a key used on one board is refused on another board of the project (nothing sent) and on another provider; the same key in another project is that project's own [B23-B2 review, 2026-10-04] tests-4", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const boardA = world({ repository });
    expect(envelope((await boardA.exchange("key-shared")).answer).code).toBe("PX_EXCHANGE_ACKNOWLEDGED");
    // a restart (the server's random nonce, B1's store empty), then another board of the same project under the same key
    const boardB = world({ repository, randomNonce: true, boardId: "board:proj-b23-other" });
    expect(envelope((await boardB.exchange("key-shared")).answer)).toMatchObject({ status: 409, code: "PX_IDEMPOTENCY_KEY_REUSE_CONFLICT", body: { sent: false } });
    expect(boardB.provider.calls).toBe(0);
    expect(await boardB.ledger.load({ ...AGGREGATE, boardId: "board:proj-b23-other" })).toBeNull();
    // ... and another provider of the same board (the record itself: no reviewed descriptor exists for a second provider)
    const plan = await boardB.preview();
    const attempt = exchangeAttemptInput({ plan, key: "key-shared", actorId: ADMIN.actorId, descriptor: fakeDescriptor(), capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } });
    expect(await boardB.ledger.prepare({ aggregate: { ...AGGREGATE, providerId: "macrofab" }, attempt, at: ISO0 })).toMatchObject({ ok: false, code: "key_reuse_conflict", attempt: { idempotencyKey: "key-shared", state: "acknowledged" } });
    // another project's key namespace is its own
    const elsewhere = { ...AGGREGATE, scope: { ...SCOPE, projectId: "proj-b23-elsewhere" } };
    expect(await boardB.ledger.prepare({ aggregate: elsewhere, attempt, at: ISO0 })).toMatchObject({ ok: true, replayed: false });
  });

  // ─── [B23-B2 lead, 2026-10-04] the independent check's three low findings, each reproduced first ────────────────────────────────

  it("23. the production composition reads the durable record before PX_PLAN_NOT_FOUND: with the exchange record composed as the route composes it (route.ts:62) and the production service (the reviewed registry and admission, the empty transfer table), a commit whose plan this instance does not hold - an unknown plan, another project's plan - answers PX_PLAN_NOT_FOUND 404 only after three replay reads under its key in the requester's project, and a store that cannot be read answers the release route's MFG_DURABLE_STORE_UNAVAILABLE 503 after one, never PX_PLAN_NOT_FOUND; steps 1 and 2 never run for them; the in-process refusals read nothing, and a held plan's commit ends PX_PROVIDER_NOT_ADMITTED with no record read [B23-B2 lead, 2026-10-04] low-1", async () => {
    const traces: string[] = [];
    setManufacturingTraceSinkForTests((entry) => { traces.push(entry.code); });
    try {
      const inner = new InMemoryDurableWorkflowRepository();
      const state = { down: false };
      const reads: string[] = [];
      const unavailable = (): never => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); };
      const store: DurableWorkflowRepository = {
        ...delegate(inner),
        getReplay: async (scope, scopeKey, key) => { reads.push(`getReplay ${scope.projectId} ${key}`); if (state.down) unavailable(); return inner.getReplay(scope, scopeKey, key); },
        loadRecord: async (scope, recordId) => { reads.push("loadRecord"); if (state.down) unavailable(); return inner.loadRecord(scope, recordId); },
        loadHead: async (identity) => { reads.push("loadHead"); if (state.down) unavailable(); return inner.loadHead(identity); },
        history: async (identity) => { reads.push("history"); if (state.down) unavailable(); return inner.history(identity); },
      };
      const steps: string[] = [];
      const release = syntheticRelease();
      const ports: ProviderExchangePorts = {
        revalidate: async () => { steps.push("revalidate"); return { ok: true, authority: { ...AUTHORITY }, locator: { ...SYNTHETIC_SCOPE, expectedBoardRevision: AUTHORITY.boardRevision, expectedBoardDigest: AUTHORITY.boardDigest } }; },
        regenerate: async () => { steps.push("regenerate"); return release; },
        ledger: async () => { steps.push("ledger"); return [syntheticLedgerRecord(release)]; },
        exchangeLedger: createProviderExchangeLedger(store), // the route's composition (route.ts:62)
      };
      const service = new ProviderExchangeService({ env: {}, now: () => T0 }); // the route's service: the reviewed registry and admission, the production transfer table, the server's nonce
      const previewed = await service.preview({ actor: ADMIN, scope: SCOPE, request: PREVIEW, ports, correlationId: "corr-b23-low1" });
      if (!previewed.ok) throw new Error(JSON.stringify(previewed.refusal));
      const plan = previewed.plan;
      const commit = (request: Record<string, unknown>, scope: ProviderExchangeScope = SCOPE) => service.commit({ actor: ADMIN, scope, request, ports, correlationId: "corr-b23-low1" });
      const phases = (project: string, key: string) => ["settled", "sent", "prepared"].map((phase) => `getReplay ${project} attempt:${key}:${phase}`);
      steps.length = 0;
      reads.length = 0;
      // the in-process refusals read nothing, the store down or not
      state.down = true;
      expect(envelope(await commit({ planId: plan.planId, planDigest: plan.planDigest }))).toMatchObject({ status: 400, code: "PX_PLAN_REQUIRED" });
      expect(envelope(await commit({ planId: plan.planId, planDigest: `dw1-${"0".repeat(64)}`, idempotencyKey: "key-low1-digest" }))).toMatchObject({ status: 409, code: "PX_PLAN_DIGEST_MISMATCH" });
      expect(reads).toEqual([]);
      // a plan this instance does not hold, with the store unreadable: the release route's envelope after one read, never PX_PLAN_NOT_FOUND
      expect(envelope(await commit({ planId: "provider-exchange-plan:unknown", planDigest: plan.planDigest, idempotencyKey: "key-low1-down" }))).toMatchObject({ status: 503, code: "MFG_DURABLE_STORE_UNAVAILABLE", body: { ok: false, correlationId: "corr-b23-low1" } });
      expect(reads).toEqual(phases(SCOPE.projectId, "key-low1-down").slice(0, 1));
      reads.length = 0;
      expect(envelope(await commit({ planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "key-low1-down-other" }, { ...SCOPE, projectId: "another-project" }))).toMatchObject({ status: 503, code: "MFG_DURABLE_STORE_UNAVAILABLE" });
      expect(reads).toEqual(phases("another-project", "key-low1-down-other").slice(0, 1));
      expect(traces).toEqual(["MFG_DURABLE_STORE_UNAVAILABLE", "MFG_DURABLE_STORE_UNAVAILABLE"]);
      // the store readable: three replay reads under the requester's project, then PX_PLAN_NOT_FOUND
      state.down = false;
      reads.length = 0;
      expect(envelope(await commit({ planId: "provider-exchange-plan:unknown", planDigest: plan.planDigest, idempotencyKey: "key-low1-up" }))).toMatchObject({ status: 404, code: "PX_PLAN_NOT_FOUND" });
      expect(reads).toEqual(phases(SCOPE.projectId, "key-low1-up"));
      reads.length = 0;
      expect(envelope(await commit({ planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "key-low1-other" }, { ...SCOPE, projectId: "another-project" }))).toMatchObject({ status: 404, code: "PX_PLAN_NOT_FOUND" });
      expect(reads).toEqual(phases("another-project", "key-low1-other"));
      expect(steps).toEqual([]);
      // the held plan is still committable: steps 1 and 2 re-run, the reviewed admission refuses, and no record is read or written
      reads.length = 0;
      expect(envelope(await commit({ planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "key-low1-held" }))).toMatchObject({ status: 409, code: "PX_PROVIDER_NOT_ADMITTED", body: { sent: false } });
      expect(steps).toEqual(["revalidate", "regenerate", "ledger"]);
      expect(reads).toEqual([]);
    } finally {
      setManufacturingTraceSinkForTests(null);
    }
  });

  it("24. a not_sent outcome that cannot be recorded never claims a record: a missing credential during a store outage (the settle fails three times) answers PX_EXCHANGE_NOT_SENT with recorded false, and its sentence says nothing was sent and never that the exchange was recorded; the record stays prepared [B23-B2 lead, 2026-10-04] low-2", async () => {
    const w = world({ repository: faulty(new InMemoryDurableWorkflowRepository(), (request) => (phaseOf(request) === "settled" ? "fail" : undefined)), env: {} });
    const answer = envelope((await w.exchange("key-unrecorded-not-sent")).answer);
    expect(answer).toMatchObject({ status: 503, code: "PX_EXCHANGE_NOT_SENT", body: { ok: false, sent: false, state: "not_sent", observed: "not_sent", failure: "record_unavailable", recorded: false, idempotent: false } });
    expect(answer.body.error).toBe(PROVIDER_EXCHANGE_ERRORS.PX_EXCHANGE_NOT_SENT.message);
    expect(String(answer.body.error)).toContain("Nothing was sent");
    expect(String(answer.body.error)).not.toMatch(/recorded/i);
    expect(PROVIDER_EXCHANGE_ERRORS.PX_PROVIDER_PAUSED.message).not.toMatch(/recorded/i);
    expect(w.provider.calls).toBe(0);
    expect(await w.ledger.attempt(AGGREGATE, "key-unrecorded-not-sent")).toMatchObject({ state: "prepared", settledAt: null, sendStarted: false });
  });

  it("25. a prepared attempt that provably sent nothing never blocks forever: after a store outage left it prepared (its not_sent settle failed), a new commit of the package within ten minutes of its preparation answers PX_EXCHANGE_IN_FLIGHT naming it, with a sentence that covers a prepared attempt; once it is ten minutes old a new commit settles it not_sent (abandoned) and sends, once; its own key, after a restart, then answers that it was not sent [B23-B2 lead, 2026-10-04] low-2", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const store = { down: true };
    const first = world({ repository: faulty(inner, (request) => (store.down && phaseOf(request) === "settled" ? "fail" : undefined)), env: {} });
    const stuck = await first.exchange("key-stuck");
    expect(envelope(stuck.answer)).toMatchObject({ status: 503, code: "PX_EXCHANGE_NOT_SENT", body: { sent: false, recorded: false } });
    expect(await first.ledger.attempt(AGGREGATE, "key-stuck")).toMatchObject({ state: "prepared" });
    store.down = false;
    // a restart, the credential present: within the bound the prepared attempt still holds the package
    const after = world({ repository: inner, randomNonce: true });
    const early = envelope((await after.exchange("key-early")).answer);
    expect(early).toMatchObject({ status: 409, code: "PX_EXCHANGE_IN_FLIGHT", body: { sent: false, inFlight: { planId: stuck.plan.planId, state: "prepared", preparedAt: ISO0, sentAt: null } } });
    after.advance(10 * 60_000 - 1);
    expect(envelope((await after.exchange("key-almost")).answer)).toMatchObject({ status: 409, code: "PX_EXCHANGE_IN_FLIGHT" });
    expect(after.provider.calls).toBe(0);
    // ten minutes after it was prepared: the next commit settles it not_sent (abandoned) and sends, once
    after.advance(1);
    expect(envelope((await after.exchange("key-late")).answer)).toMatchObject({ status: 200, code: "PX_EXCHANGE_ACKNOWLEDGED", body: { sent: true } });
    expect(after.provider.calls).toBe(1);
    expect((await after.ledger.load(AGGREGATE))?.attempts.map((attempt) => [attempt.idempotencyKey, attempt.state, attempt.failure])).toEqual([["key-stuck", "not_sent", "abandoned"], ["key-late", "acknowledged", null]]);
    expect(await after.ledger.attempt(AGGREGATE, "key-stuck")).toMatchObject({ sendStarted: false, sentAt: null, request: null, settledAt: new Date(T0 + 10 * 60_000).toISOString() });
    // the abandoned plan's own key after another restart: not sent, and nothing is sent
    const again = world({ repository: inner, randomNonce: true });
    expect(envelope(await again.commit(stuck.plan, "key-stuck"))).toMatchObject({ status: 503, code: "PX_EXCHANGE_NOT_SENT", body: { idempotent: true, sent: false, state: "not_sent", failure: "abandoned" } });
    expect(again.provider.calls).toBe(0);
    // the in-flight answer's sentence covers a prepared attempt (when it stops blocking), not only one whose files may have left
    expect(String(early.body.error)).toContain("(state prepared)");
  });

  it("26. an abandoned attempt can never be sent, whichever lands first: a sent mark after the abandoning prepare is refused; a sent mark that lands first keeps its attempt open, so the new prepare is refused in flight however old the sent attempt is; a mark that read the attempt prepared but commits after the abandonment is refused on the new head, and an abandonment that read it prepared but commits after its mark is skipped, so the new prepare is refused in flight; the bound is ten minutes, five times the longest deadline a reviewed descriptor may declare [B23-B2 lead, 2026-10-04] low-2", async () => {
    const w = world();
    const [p1, p2] = [await w.preview(), await w.preview()]; // two plans of one package
    const input = (plan: ProviderExchangePlan, key: string) => exchangeAttemptInput({ plan, key, actorId: ADMIN.actorId, descriptor: fakeDescriptor(), capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } });
    const late = new Date(T0 + 10 * 60_000).toISOString();
    const mark = { bytes: 1, sha256: "a".repeat(64) };
    // (i) the abandoning prepare lands first: the old attempt's sent mark is refused, so nothing may be handed over
    expect(await w.ledger.prepare({ aggregate: AGGREGATE, attempt: input(p1, "key-old"), at: ISO0 })).toMatchObject({ ok: true, replayed: false });
    expect(await w.ledger.prepare({ aggregate: AGGREGATE, attempt: input(p2, "key-new"), at: late })).toMatchObject({ ok: true, replayed: false });
    await expect(w.ledger.markSent({ aggregate: AGGREGATE, idempotencyKey: "key-old", request: mark, at: late })).rejects.toBeInstanceOf(ProviderExchangeLedgerTransitionError);
    expect(await w.ledger.attempt(AGGREGATE, "key-old")).toMatchObject({ state: "not_sent", failure: "abandoned", sendStarted: false, settledAt: late });
    expect((await w.ledger.history(AGGREGATE)).map((record) => [record.attempt.idempotencyKey, record.phase, record.attempt.state])).toEqual([["key-old", "prepared", "prepared"], ["key-old", "settled", "not_sent"], ["key-new", "prepared", "prepared"]]);
    // (ii) the sent mark lands first: the attempt stays open, and a new prepare a day later is refused in flight
    const marked = { ...AGGREGATE, boardId: "board:proj-b23-marked" };
    expect(await w.ledger.prepare({ aggregate: marked, attempt: input(p1, "key-old-2"), at: ISO0 })).toMatchObject({ ok: true });
    await w.ledger.markSent({ aggregate: marked, idempotencyKey: "key-old-2", request: mark, at: ISO0 });
    expect(await w.ledger.prepare({ aggregate: marked, attempt: input(p2, "key-new-2"), at: new Date(T0 + 86_400_000).toISOString() })).toMatchObject({ ok: false, code: "in_flight", attempt: { idempotencyKey: "key-old-2", state: "sent" } });
    // (iii) a mark that read its attempt prepared, held until the abandonment committed: refused on the new head, never written
    const inner = new InMemoryDurableWorkflowRepository();
    const gate: { open: () => void; reached: () => void } = { open: () => undefined, reached: () => undefined };
    const opened = new Promise<void>((resolve) => { gate.open = resolve; });
    const reached = new Promise<void>((resolve) => { gate.reached = resolve; });
    const holding: DurableWorkflowRepository = {
      ...delegate(inner),
      commit: async (request) => {
        if (request.idempotencyKey === "attempt:key-old-3:sent") { gate.reached(); await opened; } // the mark read its attempt prepared, and waits here
        const result = await inner.commit(request);
        if (request.idempotencyKey === "attempt:key-old-3:settled") gate.open();
        return result;
      },
    };
    const held = createProviderExchangeLedger(holding);
    expect(await held.prepare({ aggregate: AGGREGATE, attempt: input(p1, "key-old-3"), at: ISO0 })).toMatchObject({ ok: true });
    const pending = held.markSent({ aggregate: AGGREGATE, idempotencyKey: "key-old-3", request: mark, at: late });
    const settled = pending.then(() => "written", (error: unknown) => (error instanceof ProviderExchangeLedgerTransitionError ? "refused" : `threw ${String(error)}`));
    await reached;
    expect(await held.prepare({ aggregate: AGGREGATE, attempt: input(p2, "key-new-3"), at: late })).toMatchObject({ ok: true, replayed: false });
    expect(await settled).toBe("refused");
    expect((await held.history(AGGREGATE)).map((record) => [record.attempt.idempotencyKey, record.phase])).toEqual([["key-old-3", "prepared"], ["key-old-3", "settled"], ["key-new-3", "prepared"]]);
    // (iv) an abandonment that read its attempt prepared, held until that attempt's sent mark committed: skipped on the new head, so the
    // sent attempt stays open and the new prepare is refused in flight (never an abandoned record over a sent one)
    const inner4 = new InMemoryDurableWorkflowRepository();
    const gate4: { open: () => void; reached: () => void } = { open: () => undefined, reached: () => undefined };
    const opened4 = new Promise<void>((resolve) => { gate4.open = resolve; });
    const reached4 = new Promise<void>((resolve) => { gate4.reached = resolve; });
    const holding4: DurableWorkflowRepository = {
      ...delegate(inner4),
      commit: async (request) => {
        if (request.idempotencyKey === "attempt:key-old-4:settled") { gate4.reached(); await opened4; } // the abandonment read its attempt prepared, and waits here
        return inner4.commit(request);
      },
    };
    const held4 = createProviderExchangeLedger(holding4);
    expect(await held4.prepare({ aggregate: AGGREGATE, attempt: input(p1, "key-old-4"), at: ISO0 })).toMatchObject({ ok: true });
    const abandoning = held4.prepare({ aggregate: AGGREGATE, attempt: input(p2, "key-new-4"), at: late });
    await reached4;
    expect(await held4.markSent({ aggregate: AGGREGATE, idempotencyKey: "key-old-4", request: mark, at: late })).toMatchObject({ state: "sent" });
    gate4.open();
    expect(await abandoning).toMatchObject({ ok: false, code: "in_flight", attempt: { idempotencyKey: "key-old-4", state: "sent" } });
    expect((await held4.history(AGGREGATE)).map((record) => [record.attempt.idempotencyKey, record.phase])).toEqual([["key-old-4", "prepared"], ["key-old-4", "sent"]]);
    // the bound
    expect(ledgerModule.EXCHANGE_PREPARED_ABANDON_MS).toBe(10 * 60_000);
    expect(ledgerModule.EXCHANGE_PREPARED_ABANDON_MS).toBeGreaterThanOrEqual(5 * TRANSFER_DESCRIPTOR_BOUNDS.maxDeadlineMs);
  });

  it("27. one package to one provider is in flight at a time across a registry revision: an attempt left sent (its answer unrecorded), then a reviewed registry revision - the row's digest moves and the descriptor is re-reviewed against it, so the request digest moves - then a fresh preview and commit of the same package to the same provider answers PX_EXCHANGE_IN_FLIGHT and sends nothing; another package, or another operation of the provider, is its own exchange [B23-B2 lead, 2026-10-04] low-3", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const store = { down: true };
    const first = world({ repository: faulty(inner, (request) => (store.down && phaseOf(request) === "settled" ? "fail" : undefined)) });
    const interrupted = await first.exchange("key-before-revision");
    expect(envelope(interrupted.answer)).toMatchObject({ status: 502, body: { recorded: false, sent: true } });
    expect(first.provider.calls).toBe(1);
    store.down = false;
    // a reviewed registry revision: the row moves (its digest with it), and the transfer descriptor is re-reviewed against the new row
    const revisedRow: ProviderRow = { ...FAKE_ROW, limits: { ...FAKE_ROW.limits, upload: "a fake provider's recorded limit, revised: 4 MiB a request (tests only)" } };
    const revisedRows = FAKE_ROWS.map((row) => (row.id === "jlcpcb" ? revisedRow : row));
    const revisedDescriptor = fakeDescriptor({ version: "0.0.2", registry: { version: PROVIDER_REGISTRY_VERSION, rowDigest: durableWorkflowDigest(revisedRow) } });
    expect(validateTransferDescriptor(revisedDescriptor, revisedRows)).toEqual([]);
    const after = world({ repository: inner, randomNonce: true, registry: revisedRows, descriptor: revisedDescriptor });
    const plan = await after.preview();
    expect(plan.requestDigest).not.toBe(interrupted.plan.requestDigest);
    expect(plan.outbound.outboundPackageDigest).toBe(interrupted.plan.outbound.outboundPackageDigest);
    expect(envelope(await after.commit(plan, "key-after-revision"))).toMatchObject({ status: 409, code: "PX_EXCHANGE_IN_FLIGHT", body: { sent: false, inFlight: { planId: interrupted.plan.planId, state: "sent" } } });
    expect(after.provider.calls).toBe(0);
    expect((await after.ledger.load(AGGREGATE))?.attempts.map((attempt) => [attempt.idempotencyKey, attempt.state])).toEqual([["key-before-revision", "sent"]]);
    // the record itself: another package of the provider, or the same package to another operation, is its own exchange
    const base = exchangeAttemptInput({ plan, key: "key-other-package", actorId: ADMIN.actorId, descriptor: revisedDescriptor, capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } });
    expect(await after.ledger.prepare({ aggregate: AGGREGATE, attempt: { ...base, outboundPackageDigest: `mfg-outbound-${"9".repeat(64)}` }, at: ISO0 })).toMatchObject({ ok: true, replayed: false });
    expect(await after.ledger.prepare({ aggregate: AGGREGATE, attempt: { ...base, idempotencyKey: "key-other-operation", operationId: "dfm-readiness" }, at: ISO0 })).toMatchObject({ ok: true, replayed: false });
    expect(await after.ledger.prepare({ aggregate: AGGREGATE, attempt: { ...base, idempotencyKey: "key-same-package" }, at: ISO0 })).toMatchObject({ ok: false, code: "in_flight", attempt: { idempotencyKey: "key-before-revision" } });
  });

  it("28. a string PostgreSQL's jsonb refuses never reaches the record: a provider field holding a lone UTF-16 surrogate is dropped at normalisation (the other declared fields kept), so the acknowledged settle can land; the record refuses a lone surrogate wherever it keeps text, and a well-formed pair is text [B23-B2 lead, 2026-10-04] low-2", async () => {
    const w = world({ answer: "lone-surrogate" });
    expect(envelope((await w.exchange("key-lone")).answer)).toMatchObject({ status: 200, code: "PX_EXCHANGE_ACKNOWLEDGED" });
    const attempt = (await w.ledger.attempt(AGGREGATE, "key-lone"))!;
    expect(attempt.normalized).toEqual({ quotedDays: 5, accepted: true });
    const high = String.fromCharCode(0xd800), low = String.fromCharCode(0xdc00);
    expect(validateExchangeAttempt({ ...attempt, normalized: { status: `rec${high}eived` } })).toContain("$.normalized");
    expect(validateExchangeAttempt({ ...attempt, normalized: { status: `${low}received` } })).toContain("$.normalized");
    expect(validateExchangeAttempt({ ...attempt, normalized: { status: `received${high}` } })).toContain("$.normalized");
    expect(validateExchangeAttempt({ ...attempt, committedBy: `u-${high}` })).toContain("$.committedBy");
    expect(validateExchangeAttempt({ ...attempt, normalized: { status: `received ${String.fromCodePoint(0x1f600)}` } })).toEqual([]);
  });
});
