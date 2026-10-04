/**
 * [B23-B1] Step 1, revalidate immediately before upload (runbook :975; D23-7). The release route's route-only checks - the
 * administrator's pins, the current-head comparison, lineage, release-instant expiry and the 366-day age - are one exported server
 * function, `revalidateReleaseAuthority` (app/api/pcb/release/route.ts); the release gate already re-checks scope, board identity,
 * profile schema and `sourceDate`-relative expiry. The release route calls it and refuses every case it refused before with the
 * same codes, statuses and bodies; the provider exchange runs the SAME function at preview and again at commit, so an authority,
 * board or profile that moves between preview and commit refuses with no egress.
 *
 * The durable stores and the release gate are in-process fakes (the pattern of the release route's own suites). Nothing is written
 * to disk and nothing leaves the process: `fetch` is spied and must never be called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { authoritativeBoardDigest } from "@/app/lib/pcb/fab/release-gate";
import { MANUFACTURING_RULE_PROFILE_SCHEMA } from "@/app/lib/pcb/fab/release-manifest";
import { ruleProfileExpiry } from "@/app/lib/pcb/fab/rule-profile";
import { syntheticLedgerRecord, syntheticRelease } from "./_b23-b-release-fixture";

const getHead = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/authority-store", async (orig) => ({ ...(await orig() as object), DurableManufacturingAuthorityStore: class { getHead = getHead; loader = () => vi.fn(); } }));
const ledgerRecord = vi.hoisted(() => vi.fn(async () => ({ created: true, record: { releaseId: "rel-abcdef123456" } })));
const ledgerList = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
vi.mock("@/app/lib/pcb/fab/release-ledger", async (orig) => ({ ...(await orig() as object), DurableManufacturingReleaseLedger: class { record = ledgerRecord; list = ledgerList; latest = vi.fn(async () => null); } }));
vi.mock("@/app/lib/durable-workflow/runtime", () => ({ getDurableWorkflowRepository: () => ({ loadHead: async () => null }) }));
const lineage = vi.hoisted(() => ({ describe: vi.fn(), resolveCurrent: vi.fn() }));
vi.mock("@/app/lib/pcb-sync/board-lineage", async (orig) => ({ ...(await orig() as object), DurableBoardLineageStore: class { describe = lineage.describe; resolveCurrent = lineage.resolveCurrent; } }));
const getBoardHead = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/pcb-sync/route", () => ({ stage3Repository: { getBoardHead }, stage3BindingRepository: { listSelectedPeers: vi.fn(async () => []) } }));
const releasePackage = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/release-gate", async (orig) => ({ ...(await orig() as object), releaseManufacturingPackage: releasePackage }));

import { POST as release, revalidateReleaseAuthority } from "@/app/api/pcb/release/route";
import { POST as exchange } from "@/app/api/pcb/provider-exchange/route";
import { PROVIDER_EXCHANGE_COMMIT_HEADER, PROVIDER_EXCHANGE_COMMIT_OPT_IN } from "../provider-exchange";
import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { ManufacturingReleaseGateError } from "@/app/lib/pcb/fab/release-gate";
import { setManufacturingTraceSinkForTests } from "@/app/lib/pcb/fab/manufacturing-errors";

const NOW = "2026-10-03T12:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const post = (path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body: JSON.stringify(body) });
const DIGEST = authoritativeBoardDigest(createEmptyBoard());
const evidence = (retrievedAt: string, expiresAt = ruleProfileExpiry(retrievedAt)) => ({ sourceRefs: ["https://jlcpcb.com/capabilities/pcb-capabilities"], retrievedAt, expiresAt, scope: "JLCPCB 1-2 layer rigid FR-4 (test stub)", notes: [] });
function head(overrides: { revision?: number; recordDigest?: string; profile?: Record<string, unknown> } = {}) {
  return { authority: { boardRevision: "rev-9", boardDigest: DIGEST, manufacturingRuleProfile: overrides.profile ?? { schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA, evidence: evidence(isoDate(Date.parse(NOW) - 30 * DAY)), profileId: "jlcpcb-2l" }, schematic: { revision: "schematic:1", digest: "sha256:sch" }, componentAuthority: { digest: "component-authority-x" }, qualificationAuthority: { digest: "qualification-authority-x" } }, revision: overrides.revision ?? 4, recordDigest: overrides.recordDigest ?? "sha256:authority-record-4" };
}
const BOARD = (revision = "rev-9", board = createEmptyBoard()) => ({ record: { board, revision, digest: "pcb-sync-digest" }, aggregateRevision: 7 });
const PINS = { expectedAuthorityRevision: 4, expectedAuthorityDigest: "sha256:authority-record-4" };
const SCOPE_BODY = { designId: "d1", boardId: "b1" };
const PREVIEW = { operation: "preview", ...SCOPE_BODY, ...PINS, providerId: "jlcpcb", operationId: "pcb-quote", purpose: "quote" };
const json = async (response: Response) => (await response.clone().json()) as Record<string, unknown>;
function admin(): void { injectAuthorizedPrincipal({ userId: "u-admin", tenantId: "local", projectId: "proj-1", role: "admin" }); }
const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("B23-B1: no fetch may happen"); }); // never a real request

/** One refusal case of step 1: how to arrange the durable state, and the code and status the release route answers. */
interface Case { name: string; code: string; status: number; arrange(): void; pins?: Record<string, unknown> }
const CASES: Case[] = [
  { name: "no authority head", code: "MFG_AUTHORITY_NOT_FOUND", status: 404, arrange: () => { getHead.mockResolvedValue(null); } },
  { name: "no pins", code: "MFG_AUTHORITY_CONFIRMATION_REQUIRED", status: 400, arrange: () => { getHead.mockResolvedValue(head()); }, pins: {} },
  { name: "a mistyped pin", code: "MFG_AUTHORITY_CONFIRMATION_REQUIRED", status: 400, arrange: () => { getHead.mockResolvedValue(head()); }, pins: { expectedAuthorityRevision: "4", expectedAuthorityDigest: "sha256:authority-record-4" } },
  { name: "a moved authority", code: "MFG_AUTHORITY_CONFIRMATION_MISMATCH", status: 409, arrange: () => { getHead.mockResolvedValue(head({ revision: 5, recordDigest: "sha256:authority-record-5" })); } },
  { name: "a superseded board", code: "MFG_BOARD_SUPERSEDED", status: 409, arrange: () => { getHead.mockResolvedValue(head()); lineage.describe.mockResolvedValue({ state: "superseded", supersededBy: { boardId: "b2" } }); lineage.resolveCurrent.mockResolvedValue({ currentBoardId: "b2" }); } },
  { name: "no authoritative board", code: "MFG_AUTHORITATIVE_BOARD_NOT_FOUND", status: 404, arrange: () => { getHead.mockResolvedValue(head()); getBoardHead.mockResolvedValue(null); } },
  { name: "a board at another revision", code: "MFG_AUTHORITY_STALE", status: 409, arrange: () => { getHead.mockResolvedValue(head()); getBoardHead.mockResolvedValue(BOARD("rev-10")); } },
  { name: "a board with another digest at the same revision", code: "MFG_AUTHORITY_STALE", status: 409, arrange: () => { getHead.mockResolvedValue(head()); getBoardHead.mockResolvedValue(BOARD("rev-9", { ...createEmptyBoard(), name: "moved" } as ReturnType<typeof createEmptyBoard>)); } },
  { name: "a pre-split (v1) profile", code: "MFG_RULE_PROFILE_SCHEMA_RETIRED", status: 422, arrange: () => { getHead.mockResolvedValue(head({ profile: { schemaVersion: "sirkit.manufacturing-rule-profile.v1" } })); } },
  { name: "expired profile evidence", code: "MFG_RULE_PROFILE_EXPIRED", status: 422, arrange: () => { getHead.mockResolvedValue(head({ profile: { schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA, evidence: evidence(isoDate(Date.parse(NOW) - 400 * DAY)), profileId: "jlcpcb-2l" } })); } },
  { name: "future-dated profile evidence", code: "MFG_RULE_PROFILE_STALE_AT_RELEASE", status: 422, arrange: () => { getHead.mockResolvedValue(head({ profile: { schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA, evidence: evidence(isoDate(Date.parse(NOW) + 2 * DAY)), profileId: "jlcpcb-2l" } })); } },
  { name: "profile evidence older than 366 days at release time", code: "MFG_RULE_PROFILE_STALE_AT_RELEASE", status: 422, arrange: () => { const retrieved = Date.parse(NOW) - 366 * DAY - 2 * 60 * 60 * 1000; getHead.mockResolvedValue(head({ profile: { schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA, evidence: evidence(isoDate(retrieved), isoDate(retrieved + 366 * DAY)), profileId: "jlcpcb-2l" } })); } },
];

function reset(): void {
  getHead.mockReset(); getBoardHead.mockReset(); releasePackage.mockReset(); ledgerRecord.mockClear(); ledgerList.mockReset(); lineage.describe.mockReset(); lineage.resolveCurrent.mockReset();
  lineage.describe.mockResolvedValue({ state: "current", supersededBy: null });
  getBoardHead.mockResolvedValue(BOARD());
  ledgerList.mockResolvedValue([]);
}
/** Every durable read and generation the routes make (the release route's own perimeter: refused before any of them). */
const durableWork = () => getHead.mock.calls.length + getBoardHead.mock.calls.length + releasePackage.mock.calls.length + ledgerRecord.mock.calls.length + ledgerList.mock.calls.length;

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(NOW)); reset(); fetchSpy.mockClear(); });
afterEach(() => { vi.useRealTimers(); resetInjectedIdentity(); });

describe("[B23-B1] step 1: revalidateReleaseAuthority, shared by the release route and the provider exchange (D23-7)", () => {
  it("1. the route-only checks live in one exported server function that the release route calls; the release route keeps its literals and its order", () => {
    expect(typeof revalidateReleaseAuthority).toBe("function");
    const source = (revalidateReleaseAuthority as unknown as { toString(): string }).toString();
    for (const code of ["MFG_AUTHORITY_NOT_FOUND", "MFG_AUTHORITY_CONFIRMATION_REQUIRED", "MFG_AUTHORITY_CONFIRMATION_MISMATCH", "MFG_BOARD_SUPERSEDED", "MFG_AUTHORITATIVE_BOARD_NOT_FOUND", "MFG_AUTHORITY_STALE", "MFG_RULE_PROFILE_SCHEMA_RETIRED", "MFG_RULE_PROFILE_EXPIRED", "MFG_RULE_PROFILE_STALE_AT_RELEASE"]) expect(source, code).toContain(code);
    const order = ["MFG_AUTHORITY_NOT_FOUND", "MFG_AUTHORITY_CONFIRMATION_REQUIRED", "MFG_AUTHORITY_CONFIRMATION_MISMATCH", "MFG_BOARD_SUPERSEDED", "MFG_AUTHORITATIVE_BOARD_NOT_FOUND", "MFG_AUTHORITY_STALE", "MFG_RULE_PROFILE_SCHEMA_RETIRED", "MFG_RULE_PROFILE_EXPIRED", "MFG_RULE_PROFILE_STALE_AT_RELEASE"].map((code) => source.indexOf(code));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it.each(CASES.map((entry) => [entry.name, entry] as const))("2. %s: the release route, the function itself and the exchange's preview refuse alike - same code, status and body - with no generation and no egress", async (_name, entry) => {
    admin();
    entry.arrange();
    const pins = entry.pins ?? PINS;
    const released = await release(post("/api/pcb/release", { ...SCOPE_BODY, ...pins }));
    expect({ status: released.status, code: (await json(released)).code }).toEqual({ status: entry.status, code: entry.code });
    const direct = await revalidateReleaseAuthority({ store: new DurableManufacturingAuthorityStore({} as never), scope: { tenantId: "local", projectId: "proj-1", branchId: "main" }, ...SCOPE_BODY, expectedAuthorityRevision: pins.expectedAuthorityRevision, expectedAuthorityDigest: pins.expectedAuthorityDigest, correlationId: "corr-direct" });
    expect(direct.ok).toBe(false);
    if (direct.ok) return;
    expect({ status: direct.response.status, code: (await json(direct.response)).code }).toEqual({ status: entry.status, code: entry.code });
    const previewed = await exchange(post("/api/pcb/provider-exchange", { ...PREVIEW, ...("expectedAuthorityRevision" in pins ? pins : { expectedAuthorityRevision: undefined, expectedAuthorityDigest: undefined }) }));
    const releasedBody = await json(released), previewedBody = await json(previewed), directBody = await json(direct.response);
    const strip = (body: Record<string, unknown>) => Object.fromEntries(Object.entries(body).filter(([key]) => key !== "correlationId"));
    expect(previewed.status).toBe(entry.status);
    expect(strip(previewedBody)).toEqual(strip(releasedBody));
    expect(strip(directBody)).toEqual(strip(releasedBody));
    expect(previewed.headers.get("Cache-Control")).toBe("no-store");
    expect(releasePackage).not.toHaveBeenCalled();
    expect(ledgerRecord).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("3. a current authority passes: the function answers the stored head and the locator the release gate re-checks, and the release route goes on to generate and record exactly as before", async () => {
    admin();
    getHead.mockResolvedValue(head());
    const answer = await revalidateReleaseAuthority({ store: new DurableManufacturingAuthorityStore({} as never), scope: { tenantId: "local", projectId: "proj-1", branchId: "main" }, ...SCOPE_BODY, ...PINS, correlationId: "corr" });
    expect(answer).toMatchObject({ ok: true, stored: { revision: 4, recordDigest: "sha256:authority-record-4" }, locator: { tenantId: "local", projectId: "proj-1", branchId: "main", designId: "d1", boardId: "b1", expectedBoardRevision: "rev-9", expectedBoardDigest: DIGEST } });
    releasePackage.mockResolvedValue({ releaseId: "mfg-release-0123456789abcdef0123456789abcdef", archiveSha256: "a".repeat(64), archiveBytes: new Uint8Array([1, 2, 3]), manifest: { manifestContentDigest: "mfg-manifest-1" }, files: [], validation: {} });
    const released = await release(post("/api/pcb/release", { ...SCOPE_BODY, ...PINS }));
    expect(released.status).toBe(200);
    expect(released.headers.get("X-Sirkit-Release-Recorded")).toBe("created");
    expect(releasePackage).toHaveBeenCalledTimes(1);
    expect(releasePackage.mock.calls[0]![0].locator).toEqual(answer.ok ? answer.locator : null);
    expect(ledgerRecord).toHaveBeenCalledTimes(1);
  });
});

describe("[B23-B1] step 1 again at commit: whatever moves between preview and commit refuses with no egress", () => {
  /** A preview that succeeds over a synthetic ledgered release; returns the plan and a commit request builder. */
  async function previewOk(): Promise<{ planId: string; planDigest: string }> {
    admin();
    const synthetic = syntheticRelease();
    if (getHead.getMockImplementation() === undefined) getHead.mockResolvedValue(head());
    releasePackage.mockResolvedValue(synthetic);
    ledgerList.mockResolvedValue([syntheticLedgerRecord(synthetic)]);
    const response = await exchange(post("/api/pcb/provider-exchange", PREVIEW));
    const body = await json(response);
    expect(response.status, JSON.stringify(body).slice(0, 400)).toBe(200);
    const plan = body.plan as { planId: string; planDigest: string };
    return { planId: plan.planId, planDigest: plan.planDigest };
  }
  const commit = (plan: { planId: string; planDigest: string }, key: string) => exchange(post("/api/pcb/provider-exchange", { operation: "commit", planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: key }, { [PROVIDER_EXCHANGE_COMMIT_HEADER]: PROVIDER_EXCHANGE_COMMIT_OPT_IN }));

  // The profile cases keep the authority and its pins as they were and let the clock cross a boundary inside the plan's 10 minutes:
  // the evidence's expiry date ends at midnight, and the 366-day age is crossed three minutes after the preview.
  const EXPIRES = "2026-10-03";
  const AGE_RETRIEVED = Date.parse("2025-10-02T00:00:00.000Z");
  const MOVES: Array<{ name: string; code: string; status: number; before?(): void; move(): void }> = [
    { name: "the authority was re-qualified", code: "MFG_AUTHORITY_CONFIRMATION_MISMATCH", status: 409, move: () => { getHead.mockResolvedValue(head({ revision: 5, recordDigest: "sha256:authority-record-5" })); } },
    { name: "the authority was removed", code: "MFG_AUTHORITY_NOT_FOUND", status: 404, move: () => { getHead.mockResolvedValue(null); } },
    { name: "the board moved to another revision", code: "MFG_AUTHORITY_STALE", status: 409, move: () => { getBoardHead.mockResolvedValue(BOARD("rev-10")); } },
    { name: "the board was superseded", code: "MFG_BOARD_SUPERSEDED", status: 409, move: () => { lineage.describe.mockResolvedValue({ state: "superseded", supersededBy: { boardId: "b2" } }); lineage.resolveCurrent.mockResolvedValue({ currentBoardId: "b2" }); } },
    {
      name: "the profile evidence expired at midnight", code: "MFG_RULE_PROFILE_EXPIRED", status: 422,
      before: () => { vi.setSystemTime(new Date(`${EXPIRES}T23:55:00.000Z`)); getHead.mockResolvedValue(head({ profile: { schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA, evidence: evidence(isoDate(Date.parse(`${EXPIRES}T00:00:00.000Z`) - 365 * DAY), EXPIRES), profileId: "jlcpcb-2l" } })); },
      move: () => { vi.setSystemTime(new Date("2026-10-04T00:01:00.000Z")); },
    },
    {
      name: "the profile evidence crossed the 366-day age", code: "MFG_RULE_PROFILE_STALE_AT_RELEASE", status: 422,
      before: () => { vi.setSystemTime(new Date(AGE_RETRIEVED + 366 * DAY - 3 * 60_000)); getHead.mockResolvedValue(head({ profile: { schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA, evidence: evidence(isoDate(AGE_RETRIEVED), isoDate(AGE_RETRIEVED + 366 * DAY)), profileId: "jlcpcb-2l" } })); },
      move: () => { vi.setSystemTime(new Date(AGE_RETRIEVED + 366 * DAY + 3 * 60_000)); },
    },
  ];

  it.each(MOVES.map((entry) => [entry.name, entry] as const))("4. %s: commit re-runs step 1 and refuses with the release route's own code and status; the release is not regenerated and nothing leaves", async (_name, entry) => {
    entry.before?.();
    const plan = await previewOk();
    releasePackage.mockClear(); ledgerList.mockClear();
    entry.move();
    const response = await commit(plan, `key-${entry.code}`);
    expect({ status: response.status, code: (await json(response)).code }).toEqual({ status: entry.status, code: entry.code });
    expect(releasePackage).not.toHaveBeenCalled();
    expect(ledgerList).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("5. nothing moved: commit re-runs step 1 (one more authority and board read) and ends refused provider_not_admitted, with nothing sent", async () => {
    const plan = await previewOk();
    const before = { head: getHead.mock.calls.length, board: getBoardHead.mock.calls.length };
    const response = await commit(plan, "key-unmoved");
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ ok: false, code: "PX_PROVIDER_NOT_ADMITTED", refusal: "provider_not_admitted", sent: false });
    expect(getHead.mock.calls.length).toBe(before.head + 1);
    expect(getBoardHead.mock.calls.length).toBe(before.board + 1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(durableWork()).toBeGreaterThan(0);
  });

  // [B23-B1 review, 2026-10-04] tests-1: the release gate refuses by throwing (`fail()`), and a durable read can throw; no case drove either
  it("6. a throw at preview keeps the release route's bounded envelope: the gate's own code and status, or MFG_DURABLE_STORE_UNAVAILABLE for a store that cannot be reached; no plan, nothing fetched", async () => {
    const traces: string[] = [];
    setManufacturingTraceSinkForTests((entry) => { traces.push(entry.code); });
    try {
      admin();
      getHead.mockResolvedValue(head());
      releasePackage.mockRejectedValue(new ManufacturingReleaseGateError("MFG_AUTHORITY_BOARD_MISMATCH", "the board drifted"));
      const gate = await exchange(post("/api/pcb/provider-exchange", PREVIEW));
      const gateBody = await json(gate);
      expect({ status: gate.status, code: gateBody.code }).toEqual({ status: 422, code: "MFG_AUTHORITY_BOARD_MISMATCH" });
      expect(Object.keys(gateBody).sort()).toEqual(["code", "correlationId", "error", "ok"]);
      expect(gate.headers.get("X-Sirkit-Correlation-Id")).toBe(gateBody.correlationId);
      expect(ledgerList).not.toHaveBeenCalled(); // refused before the ledger read: no plan was sealed
      getHead.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
      const down = await exchange(post("/api/pcb/provider-exchange", PREVIEW));
      expect({ status: down.status, code: (await json(down)).code }).toEqual({ status: 503, code: "MFG_DURABLE_STORE_UNAVAILABLE" });
      expect(traces).toEqual(["MFG_AUTHORITY_BOARD_MISMATCH", "MFG_DURABLE_STORE_UNAVAILABLE"]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      setManufacturingTraceSinkForTests(null);
    }
  });

  it("7. a throw at commit ends the plan with the bounded envelope: the gate's code and status, recorded as the key's outcome, so the same key replays it (idempotent) and another key finds the plan consumed; neither re-runs anything; nothing fetched", async () => {
    setManufacturingTraceSinkForTests(() => undefined);
    try {
      const plan = await previewOk();
      releasePackage.mockRejectedValue(new ManufacturingReleaseGateError("MFG_AUTHORITY_BOARD_MISMATCH", "the board drifted"));
      const first = await commit(plan, "key-throw");
      expect({ status: first.status, code: (await json(first)).code }).toEqual({ status: 422, code: "MFG_AUTHORITY_BOARD_MISMATCH" });
      const work = durableWork();
      const replay = await commit(plan, "key-throw");
      expect(replay.status).toBe(422);
      expect(await json(replay)).toMatchObject({ ok: false, code: "MFG_AUTHORITY_BOARD_MISMATCH", idempotent: true });
      const other = await commit(plan, "key-other");
      expect({ status: other.status, code: (await json(other)).code }).toEqual({ status: 409, code: "PX_PLAN_CONSUMED" });
      expect(durableWork()).toBe(work);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      setManufacturingTraceSinkForTests(null);
    }
  });
});
