/**
 * B16-A (review findings F6/F20) — the administrator's confirmation of the
 * EXACT authority is a server invariant of POST /api/pcb/release.
 *
 * Reproduced defect: the pins were enforced only when the client volunteered
 * them; a same-origin project_admin POST that omitted both keys released
 * whatever authority head existed. This suite pins: missing pins → 400
 * MFG_AUTHORITY_CONFIRMATION_REQUIRED (after the 404 "nothing qualified"
 * answer); wrong TYPES (string revision, empty digest) → 400; a mismatched
 * pin → 409 MFG_AUTHORITY_CONFIRMATION_MISMATCH naming the current head; a
 * MATCHING pin → 200 through the real route; undeclared body keys → 400
 * MFG_API_UNKNOWN_FIELD with zero durable work.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { authoritativeBoardDigest } from "@/app/lib/pcb/fab/release-gate";

const getHead = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/authority-store", async (orig) => ({ ...(await orig() as object), DurableManufacturingAuthorityStore: class { getHead = getHead; loader = () => vi.fn(); } }));
const ledgerRecord = vi.hoisted(() => vi.fn(async () => ({ created: true, record: { releaseId: "rel-abcdef123456" } })));
vi.mock("@/app/lib/pcb/fab/release-ledger", async (orig) => ({ ...(await orig() as object), DurableManufacturingReleaseLedger: class { record = ledgerRecord; latest = vi.fn(async () => null); list = vi.fn(async () => []); } }));
vi.mock("@/app/lib/durable-workflow/runtime", () => ({ getDurableWorkflowRepository: () => ({ loadHead: async () => null }) })); // [B16-C.1] the release route reads the board lineage (none recorded → current)
const getBoardHead = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/pcb-sync/route", () => ({ stage3Repository: { getBoardHead }, stage3BindingRepository: { listSelectedPeers: vi.fn(async () => []) } }));
const releasePackage = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/release-gate", async (orig) => ({ ...(await orig() as object), releaseManufacturingPackage: releasePackage }));

import { POST as release, RELEASE_BODY_KEYS } from "../route";
import { MANUFACTURING_RULE_PROFILE_SCHEMA } from "@/app/lib/pcb/fab/release-manifest";
import { ruleProfileExpiry } from "@/app/lib/pcb/fab/rule-profile";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const req = (body: Record<string, unknown>) => new Request("http://localhost/api/pcb/release", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const DIGEST = authoritativeBoardDigest(createEmptyBoard());
const TODAY = new Date().toISOString().slice(0, 10);
const HEAD = { authority: { boardRevision: "rev-9", boardDigest: DIGEST, manufacturingRuleProfile: { schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA, evidence: { sourceRefs: ["https://jlcpcb.com/capabilities/pcb-capabilities"], retrievedAt: TODAY, expiresAt: ruleProfileExpiry(TODAY), scope: "JLCPCB 1-2 layer rigid FR-4 (test stub)", notes: [] }, profileId: "jlcpcb-2l" }, schematic: { revision: "schematic:1", digest: "sha256:sch" }, componentAuthority: { digest: "component-authority-x" }, qualificationAuthority: { digest: "qualification-authority-x" } }, revision: 4, recordDigest: "sha256:authority-record-4" };
const BOARD = { record: { board: createEmptyBoard(), revision: "rev-9", digest: DIGEST }, aggregateRevision: 7 };
function admin(): void { injectAuthorizedPrincipal({ userId: "u-admin", tenantId: "local", projectId: "proj-1", role: "admin" }); }
function nothingReleased(): void { expect(releasePackage).not.toHaveBeenCalled(); expect(ledgerRecord).not.toHaveBeenCalled(); }

afterEach(() => { resetInjectedIdentity(); getHead.mockReset(); getBoardHead.mockReset(); releasePackage.mockReset(); ledgerRecord.mockClear(); });

describe("POST /api/pcb/release — mandatory confirmation of the exact authority (B16-A F6)", () => {
  it("the body is closed to the declared keys", () => {
    expect([...RELEASE_BODY_KEYS].sort()).toEqual(["boardId", "designId", "expectedAuthorityDigest", "expectedAuthorityRevision", "format"]);
  });

  it("an administrator POST WITHOUT pins is refused 400 MFG_AUTHORITY_CONFIRMATION_REQUIRED, naming the current head, before the board read", async () => {
    admin();
    getHead.mockResolvedValueOnce(HEAD);
    const response = await release(req({ designId: "d1", boardId: "b1" }));
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ code: "MFG_AUTHORITY_CONFIRMATION_REQUIRED", authorityRevision: 4, authorityDigest: "sha256:authority-record-4" });
    expect(getBoardHead).not.toHaveBeenCalled();
    nothingReleased();
  });

  it.each([
    ["string revision", { expectedAuthorityRevision: "4", expectedAuthorityDigest: "sha256:authority-record-4" }],
    ["zero revision", { expectedAuthorityRevision: 0, expectedAuthorityDigest: "sha256:authority-record-4" }],
    ["fractional revision", { expectedAuthorityRevision: 4.5, expectedAuthorityDigest: "sha256:authority-record-4" }],
    ["empty digest", { expectedAuthorityRevision: 4, expectedAuthorityDigest: "" }],
    ["digest not a string", { expectedAuthorityRevision: 4, expectedAuthorityDigest: 4 }],
    ["revision only", { expectedAuthorityRevision: 4 }],
    ["digest only", { expectedAuthorityDigest: "sha256:authority-record-4" }],
  ])("a pin of the wrong shape (%s) is refused 400 MFG_AUTHORITY_CONFIRMATION_REQUIRED — a loose comparison never passes it as a match", async (_label, pins) => {
    admin();
    getHead.mockResolvedValueOnce(HEAD);
    const response = await release(req({ designId: "d1", boardId: "b1", ...pins }));
    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe("MFG_AUTHORITY_CONFIRMATION_REQUIRED");
    nothingReleased();
  });

  it.each([
    ["revision", { expectedAuthorityRevision: 3, expectedAuthorityDigest: "sha256:authority-record-4" }],
    ["digest", { expectedAuthorityRevision: 4, expectedAuthorityDigest: "sha256:authority-record-3" }],
  ])("a confirmation of a DIFFERENT authority (%s) is refused 409 MFG_AUTHORITY_CONFIRMATION_MISMATCH naming the current head", async (_label, pins) => {
    admin();
    getHead.mockResolvedValueOnce(HEAD);
    const response = await release(req({ designId: "d1", boardId: "b1", ...pins }));
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ code: "MFG_AUTHORITY_CONFIRMATION_MISMATCH", authorityRevision: 4, authorityDigest: "sha256:authority-record-4" });
    expect(getBoardHead).not.toHaveBeenCalled();
    nothingReleased();
  });

  it("a MATCHING confirmation releases through the real route (200) and the ledger names the confirmed head", async () => {
    admin();
    getHead.mockResolvedValueOnce(HEAD);
    getBoardHead.mockResolvedValueOnce(BOARD);
    releasePackage.mockResolvedValueOnce({ releaseId: "rel-abcdef123456", archiveSha256: "sha256:arch", manifest: { manifestContentDigest: "mfg-manifest-1" }, validation: { ok: true }, archiveBytes: new Uint8Array([1, 2, 3]) });
    const response = await release(req({ designId: "d1", boardId: "b1", expectedAuthorityRevision: 4, expectedAuthorityDigest: "sha256:authority-record-4" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Sirkit-Authority-Revision")).toBe("4");
    expect(response.headers.get("X-Sirkit-Authority-Digest")).toBe("sha256:authority-record-4");
    expect(releasePackage).toHaveBeenCalledTimes(1);
    expect(ledgerRecord).toHaveBeenCalledTimes(1);
    expect((ledgerRecord.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1]).toMatchObject({ authorityRevision: 4, authorityRecordDigest: "sha256:authority-record-4" });
  });

  it("nothing qualified → 404 MFG_AUTHORITY_NOT_FOUND is answered before the confirmation is demanded", async () => {
    admin();
    getHead.mockResolvedValueOnce(null);
    const response = await release(req({ designId: "d1", boardId: "b1" }));
    expect(response.status).toBe(404);
    expect((await json(response)).code).toBe("MFG_AUTHORITY_NOT_FOUND");
    nothingReleased();
  });

  it.each([
    ["an undeclared key", { designId: "d1", boardId: "b1", expectedAuthorityRevision: 4, expectedAuthorityDigest: "x", seeds: [1] }, ["seeds"]],
    ["a client scope", { designId: "d1", boardId: "b1", expectedAuthorityRevision: 4, expectedAuthorityDigest: "x", projectId: "other", tenantId: "other" }, ["projectId", "tenantId"]],
    ["an unknown format", { designId: "d1", boardId: "b1", expectedAuthorityRevision: 4, expectedAuthorityDigest: "x", format: "raw" }, ["format"]],
  ])("%s is refused 400 MFG_API_UNKNOWN_FIELD with ZERO durable work", async (_label, body, fields) => {
    admin();
    const response = await release(req(body));
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ code: "MFG_API_UNKNOWN_FIELD", fields });
    expect(getHead).not.toHaveBeenCalled();
    expect(getBoardHead).not.toHaveBeenCalled();
    nothingReleased();
  });
});
