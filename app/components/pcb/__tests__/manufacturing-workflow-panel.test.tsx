// @vitest-environment jsdom
/**
 * B16.1C §F/§H.8–§H.10 — the visible manufacturing workflow in a fresh
 * browser: hydration from durable truth after every refresh, the explicit
 * workflow state, buttons disabled while pending, a SEPARATE administrator
 * authorization naming the exact authority, request-owned single-flight
 * release, bounded actionable errors with explicit idempotent retry, and the
 * release result (filename, digest, authority revision, download).
 *
 * B16-A (review of PR #5): F12 a corrupt durable record is a FAILED hydration
 * (never "authority none"); F13 a failed hydration has its own visible state;
 * F14 the server-derived viewer decides whether release can be requested;
 * F18 the result text names Sirkit's own read-back; F19 a retry after a stale
 * confirmation re-hydrates and asks for a NEW confirmation instead of
 * resending the refused pins, while a transport failure keeps the idempotent
 * resend of the same pins.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManufacturingWorkflowPanel } from "../ManufacturingWorkflowPanel";
import { useManufacturingWorkflow, type UseManufacturingWorkflowInput } from "../hooks/useManufacturingWorkflow";
import { PcbOwnedOperationRegistry } from "@/app/lib/pcb/lifecycle/owned-operations";
import { PcbBoardLifecycleOwner } from "@/app/lib/pcb/lifecycle/board-lifecycle";
import type { PcbSyncClient, PcbSyncManufacturingTruth } from "@/app/lib/pcb-sync/client";

const IDENTITY = { tenantId: "local", projectId: "p2g", branchId: "main", designId: "design:p2g", boardId: "board:p2g" };
const BOARD = { revision: "pcb2-routed-0000000000", digest: "pb1-routed" };
const AUTHORITY = { revision: 3, recordDigest: "sha256:authority-record-digest", boardRevision: BOARD.revision, boardDigest: BOARD.digest, schematicRevision: "schematic:abc", schematicDigest: "sha256:sch", componentAuthorityDigest: "qualification-authority-abc", fabricationProfileId: "jlcpcb-2l", qualifiedAt: "2026-09-07T12:00:00.000Z", actor: "u-editor", current: true };
const AUTHORITY_R4 = { ...AUTHORITY, revision: 4, recordDigest: "sha256:requalified-record-digest", qualifiedAt: "2026-09-07T12:20:00.000Z" };
const RELEASE = { releaseId: "mfg-release-0123456789abcdef", archiveSha256: "a".repeat(64), manifestContentDigest: "mfg-manifest-1", filename: "sirkit-board-p2g-6789abcdef.zip", authorityRecordDigest: AUTHORITY.recordDigest, authorityRevision: 3, boardRevision: BOARD.revision, actor: "u-admin", releasedAt: "2026-09-07T12:30:00.000Z", current: true };
const SNAPSHOT = { revision: 1, snapshotDigest: "d", schematicRevision: "schematic:abc", schematicDigest: "s" };
const INTEGRITY_OK: PcbSyncManufacturingTruth["integrity"] = { authority: "ok", snapshot: "ok", latestRelease: "ok", codes: [] };
const ADMIN_VIEWER: PcbSyncManufacturingTruth["viewer"] = { role: "project_admin", actorKind: "human", canRelease: true };
const EDITOR_VIEWER: PcbSyncManufacturingTruth["viewer"] = { role: "pcb_editor", actorKind: "human", canRelease: false };

/** Server truth as the summary reader emits it: every subject verified, an administrator viewing, unless overridden. */
function truth(partial: Partial<PcbSyncManufacturingTruth> = {}): PcbSyncManufacturingTruth {
  return { snapshot: null, authority: null, latestRelease: null, integrity: INTEGRITY_OK, viewer: ADMIN_VIEWER, ...partial };
}

function truthClient(sequence: Array<{ found: boolean; truth: PcbSyncManufacturingTruth | null } | { failure: string }>): { client: PcbSyncClient; readonly calls: number } {
  const state = { client: null as unknown as PcbSyncClient, calls: 0 };
  const client = {
    loadBoardWithManufacturing: vi.fn(async () => {
      const step = sequence[Math.min(state.calls, sequence.length - 1)]!;
      state.calls += 1;
      if ("failure" in step) return { ok: false as const, kind: "retryable" as const, code: step.failure, status: 503 };
      return { ok: true as const, value: { load: step.found ? { resultSchemaVersion: "sirkit.pcb-sync-board-load-result.v1", status: "found" as const, scope: { ...IDENTITY }, record: { ...IDENTITY, revision: BOARD.revision, digest: BOARD.digest, board: {} as never, updatedAt: "2026-09-07T12:00:00.000Z" } } : { resultSchemaVersion: "sirkit.pcb-sync-board-load-result.v1", status: "not_found" as const, scope: { ...IDENTITY } }, manufacturing: step.truth } };
    }),
  } as unknown as PcbSyncClient;
  state.client = client;
  return state;
}

function releaseResponse(authority: { revision: number; recordDigest: string } = AUTHORITY): Response {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  return new Response(bytes, { status: 200, headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${RELEASE.filename}"`, "X-Sirkit-Release-Id": RELEASE.releaseId, "X-Sirkit-Archive-Sha256": RELEASE.archiveSha256, "X-Sirkit-Manifest-Digest": RELEASE.manifestContentDigest, "X-Sirkit-Board-Revision": BOARD.revision, "X-Sirkit-Authority-Revision": String(authority.revision), "X-Sirkit-Authority-Digest": authority.recordDigest, "X-Sirkit-Release-Recorded": "created", "X-Sirkit-Correlation-Id": "corr-ok" } });
}

function refusal(code: string, status: number, error: string, correlationId: string): Response {
  return Response.json({ ok: false, code, error, correlationId }, { status, headers: { "X-Sirkit-Correlation-Id": correlationId } });
}

const SCOPE_HEADERS = () => ({ "content-type": "application/json", "x-sirkit-tenant-id": IDENTITY.tenantId, "x-sirkit-project-id": IDENTITY.projectId, "x-sirkit-branch-id": IDENTITY.branchId });

function Harness(props: Omit<UseManufacturingWorkflowInput, "ownedOps" | "lifecycle" | "scopeHeaders"> & { qualifying?: boolean }) {
  // One lifecycle owner + registry per mount (as PcbEditor does) — stable identities, never re-created per render.
  const [owner] = useState(() => { const created = new PcbBoardLifecycleOwner(); created.adopt({ tenantId: IDENTITY.tenantId, projectId: IDENTITY.projectId, branchId: IDENTITY.branchId, boardId: IDENTITY.boardId }); return created; });
  const [registry] = useState(() => new PcbOwnedOperationRegistry(owner));
  const workflow = useManufacturingWorkflow({ ...props, ownedOps: registry, lifecycle: owner, scopeHeaders: SCOPE_HEADERS });
  return (
    <>
      <ManufacturingWorkflowPanel workflow={workflow} qualifying={props.qualifying ?? false} canQualify={workflow.hydration.status === "loaded" && workflow.hydration.boardRevision !== null} onQualify={() => undefined} />
      {/* Test-only: reaches the hook's own guard even when the panel's button is disabled. */}
      <button type="button" data-testid="harness-force-request" onClick={workflow.requestRelease}>force request</button>
    </>
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const stateOf = () => screen.getByTestId("p2g-workflow-state").getAttribute("data-state");
const releaseButton = () => screen.getByTestId("p2g-request-release") as HTMLButtonElement;
const releaseBody = (fetchImpl: ReturnType<typeof vi.fn>, call: number) => JSON.parse(String((fetchImpl.mock.calls[call] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
const url = { create: 0, revoke: 0 };
Object.defineProperty(URL, "createObjectURL", { value: () => { url.create += 1; return `blob:release-${url.create}`; }, configurable: true });
Object.defineProperty(URL, "revokeObjectURL", { value: () => { url.revoke += 1; }, configurable: true });

describe("manufacturing workflow panel (fresh browser)", () => {
  it("H.8 refresh after schematic apply: no durable board yet → idle, release disabled, hydration visible", async () => {
    const { client } = truthClient([{ found: false, truth: truth() }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} />);
    await waitFor(() => expect(screen.getByTestId("p2g-hydration").textContent).toBe("Durable truth loaded"));
    expect(stateOf()).toBe("idle");
    expect(releaseButton().disabled).toBe(true);
    expect((screen.getByTestId("p2g-qualify") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("p2g-identity").textContent).toContain("authority none");
    expect(screen.queryByTestId("p2g-release-capability")).toBeNull(); // an administrator sees no capability caveat
  });

  it("H.9 refresh after PCB apply: durable board found, no authority → awaiting_qualification; release stays disabled", async () => {
    const { client } = truthClient([{ found: true, truth: truth({ snapshot: SNAPSHOT }) }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} />);
    await waitFor(() => expect(stateOf()).toBe("awaiting_qualification"));
    expect((screen.getByTestId("p2g-qualify") as HTMLButtonElement).disabled).toBe(false);
    expect(releaseButton().disabled).toBe(true);
    expect(releaseButton().title).toMatch(/CURRENT qualification authority/);
  });

  it("H.10 refresh after qualification: current authority → qualified; separate admin authorization names the exact authority; single-flight release; result shows filename/digest/authority; refresh shows released", async () => {
    const { client } = truthClient([
      { found: true, truth: truth({ snapshot: SNAPSHOT, authority: AUTHORITY }) },
      { found: true, truth: truth({ snapshot: SNAPSHOT, authority: AUTHORITY, latestRelease: RELEASE }) },
    ]);
    let resolveRelease: (response: Response) => void = () => undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { resolveRelease = resolve; }));
    const onReleased = vi.fn();
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} fetchImpl={fetchImpl as unknown as typeof fetch} onReleased={onReleased} />);
    await waitFor(() => expect(stateOf()).toBe("qualified"));
    expect(releaseButton().disabled).toBe(false);
    fireEvent.click(releaseButton());
    // The administrator's SEPARATE confirmation names the exact sealed authority.
    const confirmation = await screen.findByTestId("p2g-release-confirmation");
    expect(confirmation.textContent).toContain("r3");
    expect(confirmation.textContent).toContain(AUTHORITY.recordDigest);
    expect(confirmation.textContent).toContain(BOARD.revision);
    expect(confirmation.textContent).toContain("jlcpcb-2l");
    expect(stateOf()).toBe("awaiting_release_authorization");
    expect(fetchImpl).not.toHaveBeenCalled(); // nothing is sent until the administrator authorizes
    const authorize = screen.getByTestId("p2g-authorize-release") as HTMLButtonElement;
    fireEvent.click(authorize);
    fireEvent.click(authorize); // double click → single request
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(releaseBody(fetchImpl, 0)).toEqual({ boardId: IDENTITY.boardId, designId: IDENTITY.designId, expectedAuthorityRevision: 3, expectedAuthorityDigest: AUTHORITY.recordDigest });
    expect(stateOf()).toBe("releasing");
    expect(releaseButton().disabled).toBe(true);
    await act(async () => { resolveRelease(releaseResponse()); });
    const result = await screen.findByTestId("p2g-release-result");
    expect(screen.getByTestId("p2g-release-filename").textContent).toBe(RELEASE.filename);
    expect(screen.getByTestId("p2g-release-sha").textContent).toBe(RELEASE.archiveSha256);
    expect(screen.getByTestId("p2g-release-authority").textContent).toBe("3");
    expect(result.textContent).toContain(RELEASE.releaseId);
    expect(result.textContent).toContain("ledger created");
    expect((screen.getByTestId("p2g-download") as HTMLAnchorElement).getAttribute("download")).toBe(RELEASE.filename);
    // [F18] the result says exactly what was verified — Sirkit's own read-back, not a third-party check, not a board.
    expect(result.textContent).toMatch(/read back on the server by Sirkit's internal parser \(not a third-party DFM check\)/);
    expect(result.textContent).toMatch(/not a fabricated, ordered, assembled, or electrically certified board/);
    expect(result.textContent).not.toMatch(/independently read back/);
    expect(onReleased).toHaveBeenCalledTimes(1);
    // The panel re-reads durable truth after the release: the ledgered release is current → released.
    await waitFor(() => expect(stateOf()).toBe("released"));
    expect(screen.getByTestId("p2g-identity").textContent).toContain(RELEASE.filename);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("F19 stale confirmation: the server's refusal is surfaced; retry re-hydrates and asks the administrator to confirm the FRESH authority — the refused pins are never resent", async () => {
    const source = truthClient([
      { found: true, truth: truth({ authority: AUTHORITY }) },
      { found: true, truth: truth({ authority: AUTHORITY_R4 }) }, // re-qualified between the confirmation and the request
    ]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(refusal("MFG_AUTHORITY_CONFIRMATION_MISMATCH", 409, "The manufacturing authority changed after the administrator's confirmation. Review the current authority and confirm again.", "corr-stale"))
      .mockResolvedValueOnce(releaseResponse(AUTHORITY_R4));
    render(<Harness client={source.client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(stateOf()).toBe("qualified"));
    fireEvent.click(releaseButton());
    expect((await screen.findByTestId("p2g-release-confirmation")).textContent).toContain("r3");
    fireEvent.click(await screen.findByTestId("p2g-authorize-release"));
    const error = await screen.findByTestId("p2g-error");
    expect(error.textContent).toContain("MFG_AUTHORITY_CONFIRMATION_MISMATCH");
    expect(error.textContent).toContain("confirm again");
    expect(error.textContent).toContain("corr-stale");
    expect(error.textContent).not.toMatch(/stack|node_modules/);
    expect(stateOf()).toBe("release_failed");
    expect(screen.queryByTestId("p2g-release-result")).toBeNull();
    expect(screen.queryByTestId("p2g-release-confirmation")).toBeNull();
    expect(source.calls).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The retry itself sends NOTHING: it re-reads durable truth and presents a NEW confirmation naming the fresh authority.
    fireEvent.click(screen.getByTestId("p2g-retry"));
    const fresh = await screen.findByTestId("p2g-release-confirmation");
    expect(source.calls).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fresh.textContent).toContain("r4");
    expect(fresh.textContent).toContain(AUTHORITY_R4.recordDigest);
    expect(fresh.textContent).not.toContain(AUTHORITY.recordDigest);
    expect(stateOf()).toBe("awaiting_release_authorization");
    expect(screen.queryByTestId("p2g-error")).toBeNull();
    // Only after the administrator authorizes AGAIN does a request go out — pinned to the fresh authority.
    fireEvent.click(screen.getByTestId("p2g-authorize-release"));
    await screen.findByTestId("p2g-release-result");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(releaseBody(fetchImpl, 1)).toEqual({ boardId: IDENTITY.boardId, designId: IDENTITY.designId, expectedAuthorityRevision: 4, expectedAuthorityDigest: AUTHORITY_R4.recordDigest });
    expect(screen.getByTestId("p2g-release-authority").textContent).toBe("4");
    expect(screen.queryByTestId("p2g-error")).toBeNull();
  });

  it("F19 stale authority (board moved on): retry re-hydrates; with no current authority nothing is sent and no dialog opens", async () => {
    const onNotice = vi.fn();
    const source = truthClient([
      { found: true, truth: truth({ authority: AUTHORITY }) },
      { found: true, truth: truth({ authority: { ...AUTHORITY, current: false, boardRevision: "pcb2-older" } }) },
    ]);
    const fetchImpl = vi.fn().mockResolvedValueOnce(refusal("MFG_AUTHORITY_STALE", 409, "The qualification authority no longer describes the board's current durable revision.", "corr-moved"));
    render(<Harness client={source.client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} fetchImpl={fetchImpl as unknown as typeof fetch} onNotice={onNotice} />);
    await waitFor(() => expect(stateOf()).toBe("qualified"));
    fireEvent.click(releaseButton());
    fireEvent.click(await screen.findByTestId("p2g-authorize-release"));
    expect((await screen.findByTestId("p2g-error")).textContent).toContain("MFG_AUTHORITY_STALE");
    fireEvent.click(screen.getByTestId("p2g-retry"));
    await waitFor(() => expect(source.calls).toBe(2));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/Qualify & route again/)));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("p2g-release-confirmation")).toBeNull();
    expect(screen.getByTestId("p2g-identity").textContent).toContain("(stale)");
    expect(releaseButton().disabled).toBe(true);
  });

  it("F19 transport failure (503): the explicit retry resends the SAME pins idempotently, without re-hydrating first", async () => {
    const source = truthClient([{ found: true, truth: truth({ authority: AUTHORITY }) }]);
    let loadsAtResend = -1;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(refusal("MFG_DURABLE_STORE_UNAVAILABLE", 503, "The durable store is unavailable. Nothing changed — retry.", "corr-503"))
      .mockImplementationOnce(async () => { loadsAtResend = source.calls; return releaseResponse(); });
    render(<Harness client={source.client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(stateOf()).toBe("qualified"));
    fireEvent.click(releaseButton());
    fireEvent.click(await screen.findByTestId("p2g-authorize-release"));
    const error = await screen.findByTestId("p2g-error");
    expect(error.textContent).toContain("MFG_DURABLE_STORE_UNAVAILABLE");
    expect(error.textContent).toContain("corr-503");
    expect(stateOf()).toBe("release_failed");
    fireEvent.click(screen.getByTestId("p2g-retry"));
    await screen.findByTestId("p2g-release-result");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(releaseBody(fetchImpl, 1)).toEqual(releaseBody(fetchImpl, 0));
    expect(releaseBody(fetchImpl, 1)).toMatchObject({ expectedAuthorityRevision: 3, expectedAuthorityDigest: AUTHORITY.recordDigest });
    expect(loadsAtResend).toBe(1); // the resend went out against the already-confirmed pins, not after a fresh read
    expect(screen.queryByTestId("p2g-error")).toBeNull();
  });

  it("F13 a failed hydration renders its own state — never the idle label", async () => {
    const { client } = truthClient([{ failure: "PS_NETWORK_UNAVAILABLE" }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} />);
    await waitFor(() => expect(stateOf()).toBe("hydration_failed"));
    expect(screen.getByTestId("p2g-workflow-state").textContent).toBe("Durable truth could not be read — retry hydration");
    expect(screen.getByTestId("p2g-workflow-state").textContent).not.toMatch(/No durable board yet/);
    expect(screen.getByTestId("p2g-identity").textContent).toContain("authority unreadable");
    expect(screen.getByTestId("p2g-identity").textContent).not.toContain("authority none");
    expect(releaseButton().disabled).toBe(true);
    expect(screen.getByTestId("p2g-retry").textContent).toContain("hydration");
  });

  it("F12 a durable record that failed integrity verification is a FAILED hydration with its code; release is blocked and nothing is shown as 'authority none'", async () => {
    const { client } = truthClient([{ found: true, truth: truth({ snapshot: SNAPSHOT, integrity: { authority: "corrupt", snapshot: "ok", latestRelease: "absent", codes: ["MFG_AUTHORITY_RECORD_DIGEST_MISMATCH"] } }) }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} />);
    await waitFor(() => expect(screen.getByTestId("p2g-hydration").textContent).toBe("Hydration failed (MFG_AUTHORITY_RECORD_DIGEST_MISMATCH)"));
    expect(stateOf()).toBe("hydration_failed");
    const error = screen.getByTestId("p2g-error");
    expect(error.textContent).toContain("MFG_AUTHORITY_RECORD_DIGEST_MISMATCH");
    expect(error.textContent).toMatch(/failed integrity verification \(MFG_AUTHORITY_RECORD_DIGEST_MISMATCH\)\. Nothing can be released until an operator inspects it\./);
    expect(screen.getByTestId("p2g-identity").textContent).not.toContain("authority none");
    expect(screen.getByTestId("p2g-identity").textContent).toContain("authority unreadable");
    expect(releaseButton().disabled).toBe(true);
    expect((screen.getByTestId("p2g-qualify") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("p2g-retry").textContent).toContain("hydration");
    expect(screen.queryByTestId("p2g-release-confirmation")).toBeNull();
  });

  it("F14 a viewer the server says may not release (pcb_editor) sees Request release disabled with the reason; no dialog opens, even through the hook's own entry point", async () => {
    const onNotice = vi.fn();
    const { client } = truthClient([{ found: true, truth: truth({ snapshot: SNAPSHOT, authority: AUTHORITY, viewer: EDITOR_VIEWER }) }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} onNotice={onNotice} />);
    await waitFor(() => expect(stateOf()).toBe("qualified")); // the durable truth IS qualified — only this viewer may not release it
    expect(releaseButton().disabled).toBe(true);
    expect(releaseButton().title).toBe("Only a project administrator can authorize a manufacturing release.");
    expect(screen.getByTestId("p2g-release-capability").textContent).toBe("Only a project administrator can authorize a manufacturing release.");
    fireEvent.click(releaseButton());
    fireEvent.click(screen.getByTestId("harness-force-request"));
    expect(screen.queryByTestId("p2g-release-confirmation")).toBeNull();
    expect(screen.queryByTestId("p2g-release-dialog")).toBeNull();
    expect(stateOf()).toBe("qualified");
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith("Only a project administrator can authorize a manufacturing release.");
  });

  it("hydration failure is visible and retryable; a stale authority (board moved on) never enables release", async () => {
    const { client } = truthClient([{ failure: "PS_NETWORK_UNAVAILABLE" }, { found: true, truth: truth({ authority: { ...AUTHORITY, current: false, boardRevision: "pcb2-older" }, latestRelease: { ...RELEASE, current: false } }) }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} />);
    await waitFor(() => expect(screen.getByTestId("p2g-hydration").textContent).toContain("Hydration failed (PS_NETWORK_UNAVAILABLE)"));
    expect(screen.getByTestId("p2g-error").textContent).toMatch(/could not be reached/);
    fireEvent.click(screen.getByTestId("p2g-retry"));
    await waitFor(() => expect(stateOf()).toBe("awaiting_qualification"));
    expect(screen.getByTestId("p2g-identity").textContent).toContain("(stale)");
    expect(releaseButton().disabled).toBe(true);
  });

  it("qualification pending disables both actions", async () => {
    const { client } = truthClient([{ found: true, truth: truth({ authority: AUTHORITY }) }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} qualifying />);
    await waitFor(() => expect(stateOf()).toBe("qualifying"));
    expect(releaseButton().disabled).toBe(true);
    expect((screen.getByTestId("p2g-qualify") as HTMLButtonElement).disabled).toBe(true);
  });
});
