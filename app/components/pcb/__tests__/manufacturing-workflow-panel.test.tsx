// @vitest-environment jsdom
/**
 * B16.1C §F/§H.8–§H.10 — the visible manufacturing workflow in a fresh
 * browser: hydration from durable truth after every refresh, the explicit
 * workflow state, buttons disabled while pending, a SEPARATE administrator
 * authorization naming the exact authority, request-owned single-flight
 * release, bounded actionable errors with explicit idempotent retry, and the
 * release result (filename, digest, authority revision, download).
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
const RELEASE = { releaseId: "mfg-release-0123456789abcdef", archiveSha256: "a".repeat(64), manifestContentDigest: "mfg-manifest-1", filename: "sirkit-board-p2g-6789abcdef.zip", authorityRecordDigest: AUTHORITY.recordDigest, authorityRevision: 3, boardRevision: BOARD.revision, actor: "u-admin", releasedAt: "2026-09-07T12:30:00.000Z", current: true };

function truthClient(sequence: Array<{ found: boolean; truth: PcbSyncManufacturingTruth | null } | { failure: string }>): { client: PcbSyncClient; calls: number } {
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

function releaseResponse(): Response {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  return new Response(bytes, { status: 200, headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${RELEASE.filename}"`, "X-Sirkit-Release-Id": RELEASE.releaseId, "X-Sirkit-Archive-Sha256": RELEASE.archiveSha256, "X-Sirkit-Manifest-Digest": RELEASE.manifestContentDigest, "X-Sirkit-Board-Revision": BOARD.revision, "X-Sirkit-Authority-Revision": "3", "X-Sirkit-Authority-Digest": AUTHORITY.recordDigest, "X-Sirkit-Release-Recorded": "created", "X-Sirkit-Correlation-Id": "corr-ok" } });
}

const SCOPE_HEADERS = () => ({ "content-type": "application/json", "x-sirkit-tenant-id": IDENTITY.tenantId, "x-sirkit-project-id": IDENTITY.projectId, "x-sirkit-branch-id": IDENTITY.branchId });

function Harness(props: Omit<UseManufacturingWorkflowInput, "ownedOps" | "lifecycle" | "scopeHeaders"> & { qualifying?: boolean }) {
  // One lifecycle owner + registry per mount (as PcbEditor does) — stable identities, never re-created per render.
  const [owner] = useState(() => { const created = new PcbBoardLifecycleOwner(); created.adopt({ tenantId: IDENTITY.tenantId, projectId: IDENTITY.projectId, branchId: IDENTITY.branchId, boardId: IDENTITY.boardId }); return created; });
  const [registry] = useState(() => new PcbOwnedOperationRegistry(owner));
  const workflow = useManufacturingWorkflow({ ...props, ownedOps: registry, lifecycle: owner, scopeHeaders: SCOPE_HEADERS });
  return <ManufacturingWorkflowPanel workflow={workflow} qualifying={props.qualifying ?? false} canQualify={workflow.hydration.status === "loaded" && workflow.hydration.boardRevision !== null} onQualify={() => undefined} />;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const stateOf = () => screen.getByTestId("p2g-workflow-state").getAttribute("data-state");
const releaseButton = () => screen.getByTestId("p2g-request-release") as HTMLButtonElement;
const url = { create: 0, revoke: 0 };
Object.defineProperty(URL, "createObjectURL", { value: () => { url.create += 1; return `blob:release-${url.create}`; }, configurable: true });
Object.defineProperty(URL, "revokeObjectURL", { value: () => { url.revoke += 1; }, configurable: true });

describe("manufacturing workflow panel (fresh browser)", () => {
  it("H.8 refresh after schematic apply: no durable board yet → idle, release disabled, hydration visible", async () => {
    const { client } = truthClient([{ found: false, truth: { snapshot: null, authority: null, latestRelease: null } }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} />);
    await waitFor(() => expect(screen.getByTestId("p2g-hydration").textContent).toBe("Durable truth loaded"));
    expect(stateOf()).toBe("idle");
    expect(releaseButton().disabled).toBe(true);
    expect((screen.getByTestId("p2g-qualify") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("p2g-identity").textContent).toContain("authority none");
  });

  it("H.9 refresh after PCB apply: durable board found, no authority → awaiting_qualification; release stays disabled", async () => {
    const { client } = truthClient([{ found: true, truth: { snapshot: { revision: 1, snapshotDigest: "d", schematicRevision: "schematic:abc", schematicDigest: "s" }, authority: null, latestRelease: null } }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} />);
    await waitFor(() => expect(stateOf()).toBe("awaiting_qualification"));
    expect((screen.getByTestId("p2g-qualify") as HTMLButtonElement).disabled).toBe(false);
    expect(releaseButton().disabled).toBe(true);
    expect(releaseButton().title).toMatch(/CURRENT qualification authority/);
  });

  it("H.10 refresh after qualification: current authority → qualified; separate admin authorization names the exact authority; single-flight release; result shows filename/digest/authority; refresh shows released", async () => {
    const { client } = truthClient([
      { found: true, truth: { snapshot: { revision: 1, snapshotDigest: "d", schematicRevision: "schematic:abc", schematicDigest: "s" }, authority: AUTHORITY, latestRelease: null } },
      { found: true, truth: { snapshot: { revision: 1, snapshotDigest: "d", schematicRevision: "schematic:abc", schematicDigest: "s" }, authority: AUTHORITY, latestRelease: RELEASE } },
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
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ boardId: IDENTITY.boardId, designId: IDENTITY.designId, expectedAuthorityRevision: 3, expectedAuthorityDigest: AUTHORITY.recordDigest });
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
    expect(result.textContent).toMatch(/not a fabricated, ordered, assembled, or electrically certified board/);
    expect(onReleased).toHaveBeenCalledTimes(1);
    // The panel re-reads durable truth after the release: the ledgered release is current → released.
    await waitFor(() => expect(stateOf()).toBe("released"));
    expect(screen.getByTestId("p2g-identity").textContent).toContain(RELEASE.filename);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounded failure with correlation id → explicit idempotent retry; stale confirmation surfaces the server's refusal", async () => {
    const { client } = truthClient([{ found: true, truth: { snapshot: null, authority: AUTHORITY, latestRelease: null } }]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false, code: "MFG_AUTHORITY_CONFIRMATION_MISMATCH", error: "The manufacturing authority changed after the administrator's confirmation. Review the current authority and confirm again.", correlationId: "corr-stale" }, { status: 409, headers: { "X-Sirkit-Correlation-Id": "corr-stale" } }))
      .mockResolvedValueOnce(releaseResponse());
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(stateOf()).toBe("qualified"));
    fireEvent.click(releaseButton());
    fireEvent.click(await screen.findByTestId("p2g-authorize-release"));
    const error = await screen.findByTestId("p2g-error");
    expect(error.textContent).toContain("MFG_AUTHORITY_CONFIRMATION_MISMATCH");
    expect(error.textContent).toContain("confirm again");
    expect(error.textContent).toContain("corr-stale");
    expect(error.textContent).not.toMatch(/stack|node_modules/);
    expect(stateOf()).toBe("release_failed");
    expect(screen.queryByTestId("p2g-release-result")).toBeNull();
    fireEvent.click(screen.getByTestId("p2g-retry"));
    await screen.findByTestId("p2g-release-result");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toMatchObject({ expectedAuthorityRevision: 3 });
    expect(screen.queryByTestId("p2g-error")).toBeNull();
  });

  it("hydration failure is visible and retryable; a stale authority (board moved on) never enables release", async () => {
    const { client } = truthClient([{ failure: "PS_NETWORK_UNAVAILABLE" }, { found: true, truth: { snapshot: null, authority: { ...AUTHORITY, current: false, boardRevision: "pcb2-older" }, latestRelease: { ...RELEASE, current: false } } }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} />);
    await waitFor(() => expect(screen.getByTestId("p2g-hydration").textContent).toContain("Hydration failed (PS_NETWORK_UNAVAILABLE)"));
    expect(screen.getByTestId("p2g-error").textContent).toMatch(/could not be reached/);
    fireEvent.click(screen.getByTestId("p2g-retry"));
    await waitFor(() => expect(stateOf()).toBe("awaiting_qualification"));
    expect(screen.getByTestId("p2g-identity").textContent).toContain("(stale)");
    expect(releaseButton().disabled).toBe(true);
  });

  it("qualification pending disables both actions", async () => {
    const { client } = truthClient([{ found: true, truth: { snapshot: null, authority: AUTHORITY, latestRelease: null } }]);
    render(<Harness client={client} identity={IDENTITY} hasSchematic schematicBaseDigest="sha256:base" refreshToken={0} qualifying />);
    await waitFor(() => expect(stateOf()).toBe("qualifying"));
    expect(releaseButton().disabled).toBe(true);
    expect((screen.getByTestId("p2g-qualify") as HTMLButtonElement).disabled).toBe(true);
  });
});
