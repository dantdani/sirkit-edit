/**
 * [B23-B1] Step 3, approval of a named provider and purpose (runbook :977; D23-7, OD-164, OD-166): the exchange service's `preview`
 * returns a sealed outbound plan - provider id, descriptor version and digest, purpose, operation, the exact file list with bytes and
 * sha256, every metadata field, the release and authority identity, the request digest and a 10-minute expiry - and stores it in
 * memory, as B22-B's sealed computation request does (server-sealed digest and nonce, human-only exact-digest approval, consumed
 * once; OD-183). `commit` needs `planId`, `planDigest` and an idempotency key (the route adds the opt-in header), re-runs step 1,
 * refuses an expired plan, a moved input and a reused key with a different plan, and in B23 always ends refused
 * `provider_not_admitted` AFTER revalidation and approval: nothing is sent and no fetch happens. Only a human project
 * administrator acts; every other actor is refused before any port (durable read) is called.
 *
 * The ports are in-process fakes over a synthetic release. Nothing is written to disk and nothing leaves the process.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { durableWorkflowDigest } from "@/app/lib/durable-workflow/stable";
import { admitProviderOperation } from "../provider-admission";
import { PROVIDER_REGISTRY_VERSION, PROVIDER_ROWS, type ProviderRow } from "../provider-registry";
import { buildOutboundPackage, OUTBOUND_FIELD_PATHS, WITHHELD_SOURCE_FIELDS } from "../outbound-package";
import {
  BOARD_FILE_EXCHANGES,
  PROVIDER_EXCHANGE_KEY_RETENTION_MS,
  PROVIDER_EXCHANGE_LIMITS,
  PROVIDER_EXCHANGE_PLAN_TTL_MS,
  ProviderExchangeService,
  verifyProviderExchangePlan,
  type ProviderExchangeActor,
  type ProviderExchangePlan,
  type ProviderExchangePorts,
} from "../provider-exchange";
import { SYNTHETIC_ACTOR, SYNTHETIC_BOARD, SYNTHETIC_SCOPE, syntheticLedgerRecord, syntheticRelease } from "./_b23-b-release-fixture";
import { ManufacturingReleaseGateError } from "@/app/lib/pcb/fab/release-gate";
import { setManufacturingTraceSinkForTests } from "@/app/lib/pcb/fab/manufacturing-errors";

const SCOPE = { tenantId: SYNTHETIC_SCOPE.tenantId, projectId: SYNTHETIC_SCOPE.projectId, branchId: SYNTHETIC_SCOPE.branchId };
const ADMIN: ProviderExchangeActor = { actorId: "u-b23-admin", actorKind: "human", role: "project_admin" };
const AUTHORITY = { revision: 4, recordDigest: "sha256:authority-record-b23", boardRevision: SYNTHETIC_BOARD.revision, boardDigest: SYNTHETIC_BOARD.digest };
const T0 = Date.parse("2026-10-03T12:00:00.000Z");
const PREVIEW = { designId: SYNTHETIC_SCOPE.designId, boardId: SYNTHETIC_SCOPE.boardId, expectedAuthorityRevision: 4, expectedAuthorityDigest: AUTHORITY.recordDigest, providerId: "jlcpcb", operationId: "pcb-quote", purpose: "quote" };

/** In-process fake ports over the synthetic release, counting every call (a durable read or a regeneration). */
function fakePorts(state: { release?: ReturnType<typeof syntheticRelease>; ledger?: boolean; refuse?: { status: number; code: string } } = {}) {
  const calls: string[] = [];
  const release = state.release ?? syntheticRelease();
  const ports: ProviderExchangePorts = {
    revalidate: async (input) => {
      calls.push(`revalidate:${String(input.expectedAuthorityRevision)}`);
      if (state.refuse) return { ok: false, response: Response.json({ ok: false, code: state.refuse.code, error: "refused", correlationId: "corr-b23" }, { status: state.refuse.status }) };
      return { ok: true, authority: { ...AUTHORITY }, locator: { ...SYNTHETIC_SCOPE, expectedBoardRevision: AUTHORITY.boardRevision, expectedBoardDigest: AUTHORITY.boardDigest } };
    },
    regenerate: async () => { calls.push("regenerate"); return state.release ?? release; },
    ledger: async () => { calls.push("ledger"); return state.ledger === false ? [] : [syntheticLedgerRecord(state.release ?? release)]; },
  };
  return { ports, calls, release };
}

function service(options: { now?: () => number; registry?: readonly ProviderRow[]; admit?: typeof admitProviderOperation; limits?: Partial<typeof PROVIDER_EXCHANGE_LIMITS> } = {}) {
  let nonce = 0;
  return new ProviderExchangeService({ now: options.now ?? (() => T0), nonce: () => (nonce += 1).toString(16).padStart(32, "0"), env: {}, ...(options.registry ? { registry: options.registry } : {}), ...(options.admit ? { admit: options.admit } : {}), ...(options.limits ? { limits: options.limits } : {}) });
}

async function previewed(svc: ProviderExchangeService, ports: ProviderExchangePorts, request: Record<string, unknown> = PREVIEW): Promise<ProviderExchangePlan> {
  const answer = await svc.preview({ actor: ADMIN, scope: SCOPE, request, ports, correlationId: "corr-b23" });
  if (!answer.ok) throw new Error(`preview refused: ${JSON.stringify(answer.refusal)}`);
  return answer.plan;
}

const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("B23-B1: no fetch may happen"); }); // never a real request
afterEach(() => { fetchSpy.mockClear(); });

describe("[B23-B1] step 3: the sealed outbound plan (OD-166, D23-7)", () => {
  it("1. preview lists every file and every field: provider id, descriptor version and digest, purpose, operation, the exact file list with bytes and sha256, every metadata field, release and authority identity, the request digest, and a 10-minute expiry", async () => {
    const { ports, release } = fakePorts();
    const plan = await previewed(service(), ports);
    const row = PROVIDER_ROWS.find((candidate) => candidate.id === "jlcpcb")!;
    const built = buildOutboundPackage({ release, ledger: syntheticLedgerRecord(release) });
    if (!built.ok) throw new Error(built.refusal);
    expect(plan.provider).toEqual({ providerId: "jlcpcb", displayName: row.displayName, operationId: "pcb-quote", operationName: row.operations.find((entry) => entry.id === "pcb-quote")!.providerName, descriptorVersion: PROVIDER_REGISTRY_VERSION, descriptorDigest: durableWorkflowDigest(row) });
    expect(plan.purpose).toBe("quote");
    expect(plan.outbound.files).toEqual(built.package.files.map(({ path, role, kind, mediaType, bytes, sha256 }) => ({ path, role, kind, mediaType, bytes, sha256 })));
    expect(plan.outbound.files.map((entry) => entry.path)).toEqual(["gerber/board-proj-b23-pth-1-2.xnc", "gerber/board-proj-b23.GBL", "gerber/board-proj-b23.GML", "gerber/board-proj-b23.GTL", "gerber/board-proj-b23.GTS", "gerber/board-proj-b23.gbrjob"]);
    expect(plan.outbound.manifest).toEqual({ path: built.package.manifest.path, bytes: built.package.manifest.bytes, sha256: built.package.manifest.sha256 });
    expect(plan.outbound.metadata).toEqual(built.package.manifest.value);
    expect(plan.outbound.fields).toEqual([...OUTBOUND_FIELD_PATHS]);
    expect(plan.outbound.withheldFiles).toEqual(["gerber/README.txt", "gerber/release-manifest.json"]);
    expect(plan.outbound.outboundPackageDigest).toBe(built.package.outboundPackageDigest);
    expect(plan.release).toEqual({ releaseId: release.releaseId, archiveSha256: release.archiveSha256, manifestContentDigest: release.manifest.manifestContentDigest, filename: release.filename });
    expect(plan.authority).toEqual(AUTHORITY);
    expect(plan.requestDigest).toBe(durableWorkflowDigest({ providerId: "jlcpcb", operationId: "pcb-quote", purpose: "quote", descriptorVersion: PROVIDER_REGISTRY_VERSION, descriptorDigest: durableWorkflowDigest(row), outboundPackageDigest: built.package.outboundPackageDigest, releaseId: release.releaseId, archiveSha256: release.archiveSha256 }));
    expect(PROVIDER_EXCHANGE_PLAN_TTL_MS).toBe(10 * 60_000);
    expect(plan.createdAt).toBe(new Date(T0).toISOString());
    expect(plan.expiresAt).toBe(new Date(T0 + 10 * 60_000).toISOString());
    expect(plan.createdBy).toEqual({ actorId: ADMIN.actorId });
    expect(plan.scope).toEqual(SCOPE);
    // preview states the admission answer; it never asks a provider anything
    expect(plan.admission).toMatchObject({ admitted: false, refusal: "provider_not_admitted" });
    expect(verifyProviderExchangePlan(plan)).toEqual([]);
    expect(Object.isFrozen(plan) && Object.isFrozen(plan.outbound) && Object.isFrozen(plan.outbound.files)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("2. only a reviewed board-file exchange of a dfm_quote_transfer operation is offered: a parameters-only quote, an assembly quote, a parts quote, an ordering or hand-off operation, an unknown provider and a purpose the operation does not serve are refused before any port is called", async () => {
    expect(BOARD_FILE_EXCHANGES.map((entry) => `${entry.providerId}/${entry.operationId}/${entry.purpose}`)).toEqual(["jlcpcb/pcb-quote/quote", "oshpark/import-upload/quote", "oshpark/api-upload/quote", "macrofab/dfm-readiness/dfm", "macrofab/pcb-quote/quote"]);
    for (const entry of BOARD_FILE_EXCHANGES) {
      const row = PROVIDER_ROWS.find((candidate) => candidate.id === entry.providerId)!;
      expect(row.operations.find((operation) => operation.id === entry.operationId)?.tier, `${entry.providerId}/${entry.operationId}`).toBe("dfm_quote_transfer");
    }
    const refusedRequests: Array<Record<string, unknown>> = [
      { ...PREVIEW, providerId: "pcbway", operationId: "pcb-quotation" },
      { ...PREVIEW, providerId: "pcbway", operationId: "smt-quotation" },
      { ...PREVIEW, providerId: "digikey", operationId: "quote" },
      { ...PREVIEW, providerId: "jlcpcb", operationId: "pcb-order" },
      { ...PREVIEW, providerId: "jlcpcb", operationId: "manual-quote-upload" },
      { ...PREVIEW, providerId: "boardhouse", operationId: "pcb-quote" },
      { ...PREVIEW, purpose: "dfm" },
      { ...PREVIEW, purpose: "order" },
      { ...PREVIEW, providerId: ["jlcpcb"] },
    ];
    for (const request of refusedRequests) {
      const { ports, calls } = fakePorts();
      const answer = await service().preview({ actor: ADMIN, scope: SCOPE, request, ports, correlationId: "corr-b23" });
      expect(answer.ok ? "ok" : answer.refusal.code, JSON.stringify(request)).toBe("PX_EXCHANGE_NOT_OFFERED");
      expect(calls, JSON.stringify(request)).toEqual([]);
    }
    const { ports, calls } = fakePorts();
    const scopeless = await service().preview({ actor: ADMIN, scope: SCOPE, request: { ...PREVIEW, boardId: "" }, ports, correlationId: "corr-b23" });
    expect(scopeless.ok ? "ok" : scopeless.refusal).toMatchObject({ status: 400, code: "PX_API_SCOPE_REQUIRED" });
    expect(calls).toEqual([]);
  });

  it("3. a release that is not in the ledger, or whose regenerated identity disagrees with its ledger record, never yields a plan", async () => {
    const unledgered = fakePorts({ ledger: false });
    const answer = await service().preview({ actor: ADMIN, scope: SCOPE, request: PREVIEW, ports: unledgered.ports, correlationId: "corr-b23" });
    expect(answer.ok ? "ok" : answer.refusal).toMatchObject({ status: 409, code: "PX_RELEASE_NOT_LEDGERED" });
    const release = syntheticRelease();
    const moved = { ...release, archiveSha256: "0".repeat(64) };
    const mismatched = fakePorts({ release: moved });
    // the fake ledger records the moved digest too, so only the recomputed archive hash disagrees
    const refused = await service().preview({ actor: ADMIN, scope: SCOPE, request: PREVIEW, ports: { ...mismatched.ports, ledger: async () => [syntheticLedgerRecord(moved)] }, correlationId: "corr-b23" });
    expect(refused.ok ? "ok" : refused.refusal).toMatchObject({ status: 409, code: "PX_PACKAGE_REFUSED", body: { refusal: "archive_digest_mismatch" } });
  });

  it("4. commit requires planId, planDigest and an idempotency key; an unknown plan, another project's plan and a wrong digest are refused before any port is called; [B23-B2 lead, 2026-10-04] low-1: with these ports, which hold no exchange record - the provider exchange route composes one (app/api/pcb/provider-exchange/route.ts:62), and there an unknown plan or another project's plan is refused PX_PLAN_NOT_FOUND only after that record is read under its key, and a store that cannot be read answers MFG_DURABLE_STORE_UNAVAILABLE 503 (b23-b-exchange-ledger case 23)", async () => {
    const svc = service();
    const { ports, calls } = fakePorts();
    const plan = await previewed(svc, ports);
    calls.length = 0;
    const commit = (request: Record<string, unknown>, scope: { tenantId: string; projectId: string; branchId: string } = SCOPE) => svc.commit({ actor: ADMIN, scope, request, ports, correlationId: "corr-b23" });
    for (const request of [{}, { planId: plan.planId }, { planId: plan.planId, planDigest: plan.planDigest }, { planDigest: plan.planDigest, idempotencyKey: "key-1" }, { planId: 7, planDigest: plan.planDigest, idempotencyKey: "key-1" }, { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "" }]) {
      const answer = await commit(request);
      expect(answer.ok ? "ok" : answer.refusal.code, JSON.stringify(request)).toBe("PX_PLAN_REQUIRED");
    }
    expect(await commit({ planId: "provider-exchange-plan:unknown", planDigest: plan.planDigest, idempotencyKey: "key-1" })).toMatchObject({ ok: false, refusal: { status: 404, code: "PX_PLAN_NOT_FOUND" } });
    expect(await commit({ planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "key-2" }, { ...SCOPE, projectId: "another-project" })).toMatchObject({ ok: false, refusal: { status: 404, code: "PX_PLAN_NOT_FOUND" } });
    expect(await commit({ planId: plan.planId, planDigest: otherDigest(plan.planDigest), idempotencyKey: "key-3" })).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PLAN_DIGEST_MISMATCH" } });
    expect(calls).toEqual([]);
    // the plan is still committable: none of those refusals consumed it
    expect(await commit({ planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "key-4" })).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED" } });
  });

  it("5. an expired plan is refused (10 minutes after preview) and nothing is re-read; one millisecond earlier the commit proceeds to revalidation", async () => {
    let now = T0;
    const svc = service({ now: () => now });
    const { ports, calls } = fakePorts();
    const plan = await previewed(svc, ports);
    calls.length = 0;
    now = T0 + PROVIDER_EXCHANGE_PLAN_TTL_MS;
    expect(await svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "late" }, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PLAN_EXPIRED" } });
    expect(calls).toEqual([]);
    const second = await previewed(svc, ports);
    calls.length = 0;
    now = Date.parse(second.expiresAt) - 1;
    expect(await svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: second.planId, planDigest: second.planDigest, idempotencyKey: "in-time" }, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED" } });
    expect(calls).toEqual(["revalidate:4", "regenerate", "ledger"]);
  });

  it("6. a moved input refuses with nothing sent: a step-1 refusal passes through with its own code and status; a release, package or descriptor that moved since the preview is PX_PLAN_INPUT_MOVED; the commit never consults admission", async () => {
    const admit = vi.fn(admitProviderOperation);
    // (a) step 1 refuses at commit (the authority moved): the release route's own refusal, verbatim
    {
      const svc = service({ admit });
      const ok = fakePorts();
      const plan = await previewed(svc, ok.ports);
      admit.mockClear(); // preview states admission (informational); a commit that refuses earlier never consults it
      const moved = fakePorts({ refuse: { status: 409, code: "MFG_AUTHORITY_CONFIRMATION_MISMATCH" } });
      expect(await svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "a" }, ports: moved.ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { status: 409, code: "MFG_AUTHORITY_CONFIRMATION_MISMATCH" } });
      expect(moved.calls).toEqual(["revalidate:4"]);
    }
    // (b) the regenerated release differs from the previewed one (another archive, another package)
    {
      const svc = service({ admit });
      const plan = await previewed(svc, fakePorts().ports);
      admit.mockClear();
      const other = fakePorts({ release: syntheticRelease({ variant: " moved" }) });
      expect(await svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "b" }, ports: other.ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PLAN_INPUT_MOVED" } });
    }
    // (c) the provider descriptor moved (a reviewed revision changed the row): the plan's descriptor digest no longer matches
    {
      let registry: readonly ProviderRow[] = PROVIDER_ROWS;
      const svc = new ProviderExchangeService({ now: () => T0, nonce: () => "c".repeat(32), env: {}, admit, registry: () => registry });
      const plan = await previewed(svc, fakePorts().ports);
      admit.mockClear();
      registry = PROVIDER_ROWS.map((row) => (row.id === "jlcpcb" ? { ...row, notes: [...row.notes, "a later reviewed note"] } : row));
      expect(await svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "c" }, ports: fakePorts().ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PLAN_INPUT_MOVED" } });
    }
    expect(admit).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("7. the idempotency key: the same key and plan replays the recorded outcome without re-running anything; the same key with a different plan is refused; a plan is consumed once (a second key is refused)", async () => {
    const svc = service();
    const { ports, calls } = fakePorts();
    const plan = await previewed(svc, ports);
    const other = await previewed(svc, ports);
    calls.length = 0;
    const commit = (planId: string, planDigest: string, idempotencyKey: string) => svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId, planDigest, idempotencyKey }, ports, correlationId: "corr-b23" });
    const first = await commit(plan.planId, plan.planDigest, "key-x");
    expect(first).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PROVIDER_NOT_ADMITTED", body: { refusal: "provider_not_admitted", sent: false, idempotent: false } } });
    expect(calls).toEqual(["revalidate:4", "regenerate", "ledger"]);
    const replay = await commit(plan.planId, plan.planDigest, "key-x");
    expect(replay).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PROVIDER_NOT_ADMITTED", body: { refusal: "provider_not_admitted", sent: false, idempotent: true } } });
    expect(calls).toHaveLength(3);
    expect(await commit(other.planId, other.planDigest, "key-x")).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_IDEMPOTENCY_KEY_REUSE_CONFLICT" } });
    expect(await commit(plan.planId, plan.planDigest, "key-y")).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PLAN_CONSUMED" } });
    expect(calls).toHaveLength(3);
    // two commits racing on one plan: one runs, the other finds it consumed
    const raced = await previewed(svc, ports);
    calls.length = 0;
    const [a, b] = await Promise.all([commit(raced.planId, raced.planDigest, "race-a"), commit(raced.planId, raced.planDigest, "race-b")]);
    expect([a, b].map((answer) => (answer.ok ? "ok" : answer.refusal.code)).sort()).toEqual(["PX_PLAN_CONSUMED", "PX_PROVIDER_NOT_ADMITTED"]);
    expect(calls).toEqual(["revalidate:4", "regenerate", "ledger"]);
  });

  it("8. only a human project administrator acts: ai, automation and system_migration actors and every non-admin role are refused before any port (durable read) is called, for preview and commit alike", async () => {
    const svc = service();
    const { ports, calls } = fakePorts();
    const plan = await previewed(svc, ports);
    calls.length = 0;
    const actors: ProviderExchangeActor[] = [
      { actorId: "agent-1", actorKind: "ai", role: "project_admin" },
      { actorId: "automation-1", actorKind: "automation", role: "project_admin" },
      { actorId: "migration-1", actorKind: "system_migration", role: "project_admin" },
      ...(["viewer", "commenter", "pcb_editor", "reviewer", "automation", "migration_admin"] as const).map((role) => ({ actorId: `u-${role}`, actorKind: "human", role })),
    ];
    for (const actor of actors) {
      const preview = await svc.preview({ actor, scope: SCOPE, request: PREVIEW, ports, correlationId: "corr-b23" });
      expect(preview.ok ? "ok" : preview.refusal, `${actor.actorKind}/${actor.role}`).toMatchObject({ status: 403, code: "PX_HUMAN_ADMIN_REQUIRED" });
      const commit = await svc.commit({ actor, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: `k-${actor.actorId}` }, ports, correlationId: "corr-b23" });
      expect(commit.ok ? "ok" : commit.refusal, `${actor.actorKind}/${actor.role}`).toMatchObject({ status: 403, code: "PX_HUMAN_ADMIN_REQUIRED" });
    }
    expect(calls).toEqual([]);
    // the refused attempts consumed nothing: the administrator's commit still reaches its end
    expect(await svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "admin" }, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED" } });
  });

  it("9. in B23 commit always ends refused provider_not_admitted after revalidation and approval, for every offered exchange and whatever the environment holds; even a forged admitting answer sends nothing (there is no send) [B23-B2, 2026-10-04: the send exists since B2, but no reviewed transfer descriptor does, so a forged admission still answers PX_SEND_UNAVAILABLE and sends nothing (b23-b-exchange-ledger case 10)]", async () => {
    for (const entry of BOARD_FILE_EXCHANGES) {
      const svc = service();
      const { ports, calls } = fakePorts();
      const plan = await previewed(svc, ports, { ...PREVIEW, providerId: entry.providerId, operationId: entry.operationId, purpose: entry.purpose });
      calls.length = 0;
      const answer = await svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "k" }, ports, correlationId: "corr-b23" });
      expect(answer, `${entry.providerId}/${entry.operationId}`).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PROVIDER_NOT_ADMITTED", body: { refusal: "provider_not_admitted", sent: false, planId: plan.planId, requestDigest: plan.requestDigest } } });
      expect(calls).toEqual(["revalidate:4", "regenerate", "ledger"]);
    }
    const forged = vi.fn((): ReturnType<typeof admitProviderOperation> => ({ admitted: true, providerId: "jlcpcb", operationId: "pcb-quote", tier: "dfm_quote_transfer", via: "handoff", credentialReferences: [] }));
    const svc = service({ admit: forged });
    const { ports } = fakePorts();
    const plan = await previewed(svc, ports);
    expect(await svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "forged" }, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_SEND_UNAVAILABLE", body: { sent: false } } });
    expect(forged).toHaveBeenCalledTimes(2); // preview's informational answer, then commit's
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("10. the plan is sealed by the server (B22-B's pattern): a server nonce makes every plan id distinct while the request digest names what would leave; a stored plan's digest is recomputed and any changed field is detected", async () => {
    const svc = service();
    const { ports } = fakePorts();
    const a = await previewed(svc, ports);
    const b = await previewed(svc, ports);
    expect(a.planId).not.toBe(b.planId);
    expect(a.planDigest).not.toBe(b.planDigest);
    expect(a.requestDigest).toBe(b.requestDigest);
    expect(a.planId).toMatch(/^provider-exchange-plan:[0-9a-f]{32}$/);
    for (const forged of [{ ...a, purpose: "dfm" }, { ...a, outbound: { ...a.outbound, files: a.outbound.files.slice(1) } }, { ...a, expiresAt: new Date(T0 + 60 * 60_000).toISOString() }, { ...a, scope: { ...a.scope, projectId: "elsewhere" } }]) {
      expect(verifyProviderExchangePlan(forged as ProviderExchangePlan)).toContain("the plan digest does not match its content");
    }
    expect(verifyProviderExchangePlan({ ...a, extra: true } as unknown as ProviderExchangePlan)).toEqual(["the plan's keys are not the closed set"]);
  });
});

/** [B23-B1 review, 2026-10-04] Whether `value` occurs in `text` with no letter or digit beside it (so `main` is not found in `Domain`). */
function occurs(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(text);
}
/** [B23-B1 review, 2026-10-04] The file-safe form of an id, restated here (the release's file names use it): runs outside [A-Za-z0-9._-] become "-". */
const fileSafe = (value: string): string => (value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "sirkit-board").slice(0, 80);

describe("[B23-B1 review, 2026-10-04] the plan says what leaves; the stores are bounded per project; a key outlives its plan; a throw ends the plan", () => {
  it("11. the plan says what leaves: a Sirkit identifier whose value is in an outbound file name or byte is listed as carried, never as kept in Sirkit; every metadata field the file bytes carry is listed (security-1, coverage-1)", async () => {
    const { ports, release } = fakePorts();
    const plan = await previewed(service(), ports);
    const built = buildOutboundPackage({ release, ledger: syntheticLedgerRecord(release) });
    if (!built.ok) throw new Error(built.refusal);
    const values: Record<(typeof WITHHELD_SOURCE_FIELDS)[number], string> = { tenantId: SYNTHETIC_SCOPE.tenantId, projectId: SYNTHETIC_SCOPE.projectId, branchId: SYNTHETIC_SCOPE.branchId, designId: SYNTHETIC_SCOPE.designId, boardId: SYNTHETIC_SCOPE.boardId, actor: SYNTHETIC_ACTOR };
    // an independent scan of every outbound name and byte (the files and the provider manifest), each id as is and in its file-safe form
    const outbound = [...built.package.files.map((file) => ({ path: file.path, text: new TextDecoder().decode(file.content) })), { path: built.package.manifest.path, text: new TextDecoder().decode(built.package.manifest.content) }];
    const expected = WITHHELD_SOURCE_FIELDS.flatMap((field) => [...new Set([values[field], fileSafe(values[field])])].flatMap((value) => {
      const names = outbound.filter((entry) => occurs(entry.path, value)).map((entry) => entry.path);
      const bytes = outbound.filter((entry) => occurs(entry.text, value)).map((entry) => entry.path);
      return names.length + bytes.length > 0 ? [{ field, value, form: value === values[field] ? "as-is" : "file-safe", names, bytes }] : [];
    }));
    // the synthetic board id board:proj-b23 is board-proj-b23 in every name, each Gerber's TF.ProjectId, the job file and the provider manifest; the project id proj-b23 is inside it
    expect(expected.map((entry) => `${entry.field}=${entry.value}`)).toEqual(["projectId=proj-b23", "boardId=board-proj-b23"]);
    expect(plan.outbound.carried).toEqual(expected);
    expect(plan.outbound.withheldFields).toEqual(WITHHELD_SOURCE_FIELDS.filter((field) => !expected.some((entry) => entry.field === field)));
    expect(plan.outbound.withheldFields).toEqual(["tenantId", "branchId", "designId", "actor"]);
    for (const field of plan.outbound.withheldFields) for (const value of new Set([values[field], fileSafe(values[field])])) for (const entry of outbound) expect(occurs(entry.path, value) || occurs(entry.text, value), `${field} ${value} in ${entry.path}`).toBe(false);
    // every file-level metadata field the bytes carry, verbatim, with the files that carry it
    expect(plan.outbound.embedded).toEqual(built.package.disclosure.embedded);
    const gerbers = built.package.files.filter((file) => file.kind === "gerber").map((file) => file.path);
    expect(plan.outbound.embedded).toContainEqual({ field: "TF.ProjectId", value: `board-proj-b23,00000000-0000-5000-8000-000000000000,${SYNTHETIC_BOARD.revision}`, paths: gerbers });
    expect(plan.outbound.embedded).toContainEqual({ field: "job:GeneralSpecs.ProjectId.Name", value: "board-proj-b23", paths: ["gerber/board-proj-b23.gbrjob"] });
    expect(plan.outbound.embedded).toContainEqual({ field: "TF.FileFunction", value: "Plated,1,2,PTH", paths: ["gerber/board-proj-b23-pth-1-2.xnc"] });
    expect(plan.outbound.embedded).toContainEqual({ field: "G04", value: "synthetic", paths: gerbers });
    expect(verifyProviderExchangePlan(plan)).toEqual([]);
  });

  it("12. the plan store is bounded per project and never evicts a live plan: another project's previews leave this project's plan committable; a project at its limit is refused PX_PLAN_LIMIT_REACHED before any port; expired plans are dropped first; the whole-store backstop refuses, never evicts (security-3, tests-4)", async () => {
    expect(PROVIDER_EXCHANGE_LIMITS).toEqual({ plansPerProject: 32, plans: 2048, keysPerProject: 256, keys: 16_384 }); // [B23-B1 lead, 2026-10-04] keysPerProject was 1024: 16 scopes at that bound filled the key backstop (low-1, case 17)
    expect(PROVIDER_EXCHANGE_KEY_RETENTION_MS).toBe(24 * 60 * 60_000);
    let now = T0;
    const svc = service({ now: () => now });
    const { ports, calls } = fakePorts();
    const OTHER = { ...SCOPE, projectId: "proj-other" };
    const mine = await previewed(svc, ports);
    const answers: string[] = [];
    for (let index = 0; index < 300; index += 1) {
      const answer = await svc.preview({ actor: ADMIN, scope: OTHER, request: PREVIEW, ports, correlationId: "corr-b23" });
      answers.push(answer.ok ? "ok" : `${answer.refusal.status}:${answer.refusal.code}`);
    }
    expect(answers.indexOf("429:PX_PLAN_LIMIT_REACHED")).toBe(32);
    expect(answers.filter((entry) => entry === "ok")).toHaveLength(32);
    expect(new Set(answers.slice(32))).toEqual(new Set(["429:PX_PLAN_LIMIT_REACHED"]));
    expect(svc.heldCounts(OTHER)).toEqual({ plans: 32, openPlans: 32, keys: 0 });
    expect(svc.heldCounts()).toEqual({ plans: 33, openPlans: 33, keys: 0 });
    // a refused preview reads nothing
    calls.length = 0;
    expect(await svc.preview({ actor: ADMIN, scope: OTHER, request: PREVIEW, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { status: 429, code: "PX_PLAN_LIMIT_REACHED" } });
    expect(calls).toEqual([]);
    // the other project's 300 previews evicted nothing: this project's plan still commits
    expect(await svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: mine.planId, planDigest: mine.planDigest, idempotencyKey: "mine" }, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED" } });
    expect(svc.heldCounts(SCOPE)).toEqual({ plans: 1, openPlans: 0, keys: 1 });
    // ten minutes on, every plan has expired: the next preview drops them first and is kept
    now = T0 + PROVIDER_EXCHANGE_PLAN_TTL_MS;
    expect((await svc.preview({ actor: ADMIN, scope: OTHER, request: PREVIEW, ports, correlationId: "corr-b23" })).ok).toBe(true);
    expect(svc.heldCounts()).toEqual({ plans: 1, openPlans: 1, keys: 1 });
    // the backstop over every project together refuses the next project's preview; it evicts nobody
    const small = service({ limits: { plans: 3 } });
    const kept: Array<{ scope: { tenantId: string; projectId: string; branchId: string }; plan: ProviderExchangePlan }> = [];
    for (const projectId of ["p-1", "p-2", "p-3"]) {
      const scope = { ...SCOPE, projectId };
      const answer = await small.preview({ actor: ADMIN, scope, request: PREVIEW, ports, correlationId: "corr-b23" });
      if (!answer.ok) throw new Error(`preview refused: ${answer.refusal.code}`);
      kept.push({ scope, plan: answer.plan });
    }
    expect(await small.preview({ actor: ADMIN, scope: { ...SCOPE, projectId: "p-4" }, request: PREVIEW, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { status: 429, code: "PX_PLAN_LIMIT_REACHED" } });
    for (const { scope, plan } of kept) expect(await small.commit({ actor: ADMIN, scope, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: "k" }, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED" } });
  });

  it("13. an idempotency key outlives its plan: after the plan expired and was dropped, the same key and plan replay the recorded outcome and the same key with another plan is refused; a key is forgotten 24 hours after its commit; a project at its key limit is refused before the plan is consumed (coverage-2, tests-4)", async () => {
    let now = T0;
    const svc = service({ now: () => now });
    const { ports, calls } = fakePorts();
    const commit = (plan: ProviderExchangePlan, idempotencyKey: string, on: ProviderExchangeService = svc) => on.commit({ actor: ADMIN, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey }, ports, correlationId: "corr-b23" });
    const first = await previewed(svc, ports);
    expect(await commit(first, "key-k")).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED", body: { idempotent: false } } });
    now = T0 + PROVIDER_EXCHANGE_PLAN_TTL_MS + 60_000;
    const second = await previewed(svc, ports); // this preview drops the expired first plan
    expect(svc.heldCounts(SCOPE)).toEqual({ plans: 1, openPlans: 1, keys: 1 });
    calls.length = 0;
    expect(await commit(second, "key-k")).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_IDEMPOTENCY_KEY_REUSE_CONFLICT" } });
    expect(await commit(first, "key-k")).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PROVIDER_NOT_ADMITTED", body: { idempotent: true } } });
    expect(calls).toEqual([]);
    // the conflict consumed nothing: the second plan commits under its own key
    expect(await commit(second, "key-2")).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED", body: { idempotent: false } } });
    // 24 hours after its commit the key is forgotten (the stated window, OD-183 (d))
    now = T0 + PROVIDER_EXCHANGE_KEY_RETENTION_MS;
    const third = await previewed(svc, ports);
    expect(await commit(third, "key-k")).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED", body: { idempotent: false } } });
    // a project at its key limit is refused before the plan is consumed; the plan stays open
    const capped = service({ limits: { keysPerProject: 2 } });
    for (const key of ["a", "b"]) expect(await commit(await previewed(capped, ports), key, capped)).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED" } });
    const waiting = await previewed(capped, ports);
    calls.length = 0;
    expect(await commit(waiting, "c", capped)).toMatchObject({ ok: false, refusal: { status: 429, code: "PX_KEY_LIMIT_REACHED" } });
    expect(calls).toEqual([]);
    expect(capped.heldCounts(SCOPE)).toEqual({ plans: 3, openPlans: 1, keys: 2 });
  });

  it("14. a throw at commit (the release gate refuses, or a durable read fails) ends the plan with the release route's bounded envelope, recorded as the key's outcome: the same key replays it, another key finds the plan consumed; nothing is sent (tests-1)", async () => {
    const traces: string[] = [];
    setManufacturingTraceSinkForTests((entry) => { traces.push(`${entry.code}:${entry.correlationId}`); });
    try {
      const svc = service();
      const ok = fakePorts();
      const commit = (plan: ProviderExchangePlan, idempotencyKey: string, ports: ProviderExchangePorts) => svc.commit({ actor: ADMIN, scope: SCOPE, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey }, ports, correlationId: "corr-b23" });
      const gate = await previewed(svc, ok.ports);
      const refusing: ProviderExchangePorts = { ...ok.ports, regenerate: async () => { throw new ManufacturingReleaseGateError("MFG_AUTHORITY_BOARD_MISMATCH", "the board drifted between preview and commit"); } };
      expect(await commit(gate, "k-gate", refusing)).toMatchObject({ ok: false, refusal: { status: 422, code: "MFG_AUTHORITY_BOARD_MISMATCH", body: { ok: false, code: "MFG_AUTHORITY_BOARD_MISMATCH", correlationId: "corr-b23" } } });
      ok.calls.length = 0;
      expect(await commit(gate, "k-gate", ok.ports)).toMatchObject({ ok: false, refusal: { status: 422, code: "MFG_AUTHORITY_BOARD_MISMATCH", body: { idempotent: true } } });
      expect(await commit(gate, "k-other", ok.ports)).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PLAN_CONSUMED" } });
      expect(ok.calls).toEqual([]);
      const store = await previewed(svc, ok.ports);
      const down: ProviderExchangePorts = { ...ok.ports, revalidate: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); } };
      expect(await commit(store, "k-store", down)).toMatchObject({ ok: false, refusal: { status: 503, code: "MFG_DURABLE_STORE_UNAVAILABLE" } });
      expect(await commit(store, "k-store", ok.ports)).toMatchObject({ ok: false, refusal: { status: 503, code: "MFG_DURABLE_STORE_UNAVAILABLE", body: { idempotent: true } } });
      expect(traces).toEqual(["MFG_AUTHORITY_BOARD_MISMATCH:corr-b23", "MFG_DURABLE_STORE_UNAVAILABLE:corr-b23"]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      setManufacturingTraceSinkForTests(null);
    }
  });

  it("15. a wrong digest always differs from the real one, whatever its last character (tests-6)", () => {
    for (const last of "0123456789abcdef") {
      const digest = `dw1-${"a".repeat(63)}${last}`;
      expect(otherDigest(digest), digest).not.toBe(digest);
      expect(otherDigest(digest)).toHaveLength(digest.length);
    }
  });
});

/** [B23-B1 review, 2026-10-04] tests-6: the digest with its last character changed (case 4's old `slice(0, -1) + "0"` equalled a digest ending in 0). */
function otherDigest(digest: string): string {
  return `${digest.slice(0, -1)}${digest.endsWith("0") ? "1" : "0"}`;
}

/** [B23-B1 lead, 2026-10-04] low-1: one project scope previews and commits as far as its own bounds let it - previews until one is
 *  refused, then commits what it holds open until a commit is refused at its key bound (its open plans stay) or a preview is refused
 *  with nothing open. */
async function fillToOwnBounds(svc: ProviderExchangeService, scope: { tenantId: string; projectId: string; branchId: string }, ports: ProviderExchangePorts): Promise<void> {
  const open: ProviderExchangePlan[] = [];
  for (let key = 0; key < 100_000;) {
    const answer = await svc.preview({ actor: ADMIN, scope, request: PREVIEW, ports, correlationId: "corr-b23" });
    if (answer.ok) { open.push(answer.plan); continue; }
    if (open.length === 0) return;
    while (open.length > 0) {
      const plan = open[0]!;
      const done = await svc.commit({ actor: ADMIN, scope, request: { planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: `fill-${key}` }, ports, correlationId: "corr-b23" });
      if (!done.ok && done.refusal.code === "PX_KEY_LIMIT_REACHED") return;
      open.shift();
      key += 1;
    }
  }
  throw new Error("fillToOwnBounds: no bound was reached");
}

describe("[B23-B1 lead, 2026-10-04] the whole-store backstops count only what can block another project (low-1)", () => {
  it("16. two project scopes (two branches of one project) that preview, commit and preview again as far as their own bounds allow never fill the plan backstop - a consumed plan does not count toward it - so a third project still previews and commits; each filling scope holds exactly its own bounds", async () => {
    const svc = service();
    const { ports } = fakePorts();
    const first = { ...SCOPE, projectId: "proj-fill" };
    const second = { ...SCOPE, projectId: "proj-fill", branchId: "branch-fill-2" };
    await fillToOwnBounds(svc, first, ports);
    await fillToOwnBounds(svc, second, ports);
    const third = { ...SCOPE, projectId: "proj-third" };
    const answer = await svc.preview({ actor: ADMIN, scope: third, request: PREVIEW, ports, correlationId: "corr-b23" });
    expect(answer.ok ? "ok" : answer.refusal.code).toBe("ok");
    if (!answer.ok) return;
    expect(await svc.commit({ actor: ADMIN, scope: third, request: { planId: answer.plan.planId, planDigest: answer.plan.planDigest, idempotencyKey: "third" }, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED" } });
    // each filling scope reached its key bound of commits (each consumed plan kept until its expiry) and its open-plan bound, nothing more
    const { plansPerProject, keysPerProject } = PROVIDER_EXCHANGE_LIMITS;
    for (const scope of [first, second]) expect(svc.heldCounts(scope), scope.branchId).toEqual({ plans: keysPerProject + plansPerProject, openPlans: plansPerProject, keys: keysPerProject });
  }, 60_000);

  it("17. the shipped bounds: filling either backstop takes at least 64 project scopes, each at its own bound (2,048 open plans of 32; 16,384 key records of 256 - 24 hours each), so a few scopes never refuse every other project; a consumed plan is kept as a tombstone that still answers another project, a wrong digest, a second key and its expiry exactly as before", async () => {
    const { plans, plansPerProject, keys, keysPerProject } = PROVIDER_EXCHANGE_LIMITS;
    expect({ planScopes: Math.floor(plans / plansPerProject), keyScopes: Math.floor(keys / keysPerProject) }).toEqual({ planScopes: 64, keyScopes: 64 });
    let now = T0;
    const svc = service({ now: () => now });
    const { ports, calls } = fakePorts();
    const plan = await previewed(svc, ports);
    const commit = (planDigest: string, idempotencyKey: string, scope: { tenantId: string; projectId: string; branchId: string } = SCOPE) => svc.commit({ actor: ADMIN, scope, request: { planId: plan.planId, planDigest, idempotencyKey }, ports, correlationId: "corr-b23" });
    expect(await commit(plan.planDigest, "t-1")).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED" } });
    calls.length = 0;
    expect(await commit(plan.planDigest, "t-2", { ...SCOPE, projectId: "elsewhere" })).toMatchObject({ ok: false, refusal: { status: 404, code: "PX_PLAN_NOT_FOUND" } });
    expect(await commit(otherDigest(plan.planDigest), "t-3")).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PLAN_DIGEST_MISMATCH" } });
    expect(await commit(plan.planDigest, "t-4")).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PLAN_CONSUMED" } });
    expect(await commit(plan.planDigest, "t-1")).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED", body: { idempotent: true } } });
    expect(svc.heldCounts(SCOPE)).toEqual({ plans: 1, openPlans: 0, keys: 1 });
    now = Date.parse(plan.expiresAt);
    expect(await commit(plan.planDigest, "t-5")).toMatchObject({ ok: false, refusal: { status: 409, code: "PX_PLAN_EXPIRED" } });
    expect(calls).toEqual([]);
    // the next preview drops the expired tombstone
    await previewed(svc, ports);
    expect(svc.heldCounts(SCOPE)).toEqual({ plans: 1, openPlans: 1, keys: 1 });
  });

  it("18. only open plans count toward the plan backstop: eight project scopes at their own bounds hold more consumed plans than the backstop (8 x 256 + 8 x 32 = 2,304 > 2,048), and a ninth project still previews and commits", async () => {
    const svc = service();
    const { ports } = fakePorts();
    const { plans, plansPerProject, keysPerProject } = PROVIDER_EXCHANGE_LIMITS;
    const scopes = Array.from({ length: 8 }, (_, index) => ({ ...SCOPE, projectId: `proj-many-${index}` }));
    expect(scopes.length * (keysPerProject + plansPerProject)).toBeGreaterThan(plans);
    for (const scope of scopes) await fillToOwnBounds(svc, scope, ports);
    expect(svc.heldCounts()).toEqual({ plans: scopes.length * (keysPerProject + plansPerProject), openPlans: scopes.length * plansPerProject, keys: scopes.length * keysPerProject });
    const ninth = { ...SCOPE, projectId: "proj-ninth" };
    const answer = await svc.preview({ actor: ADMIN, scope: ninth, request: PREVIEW, ports, correlationId: "corr-b23" });
    expect(answer.ok ? "ok" : answer.refusal.code).toBe("ok");
    if (!answer.ok) return;
    expect(await svc.commit({ actor: ADMIN, scope: ninth, request: { planId: answer.plan.planId, planDigest: answer.plan.planDigest, idempotencyKey: "ninth" }, ports, correlationId: "corr-b23" })).toMatchObject({ ok: false, refusal: { code: "PX_PROVIDER_NOT_ADMITTED" } });
  }, 60_000);
});
