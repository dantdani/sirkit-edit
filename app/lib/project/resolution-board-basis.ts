/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7 (OD-253 item 8): the DURABLE board a reviewed component replacement is assessed against
 * (app/lib/component-resolution/board-impact.ts), read through the EXISTING board read - `PcbSyncClient.loadBoardWithManufacturing`,
 * GET /api/pcb-sync?boardId&include=manufacturing (no new route): the authoritative board record the preflight, the qualification and
 * the release read, plus the server's qualification authority head and latest release. Never the browser working copy (it may hold
 * unsaved edits and is not authority).
 *
 *  - the board id is the project's primary board (`pcbBoardInstanceId`); a superseded board revision is followed ONCE to the lineage's
 *    current revision, as the PCB editor's load does; a second hop is refused (`unavailable`), never followed blindly;
 *  - `not_found` is a truthful answer: `no-board` (Prepare PCB has not created a board yet);
 *  - any failure is `unavailable` with its bounded code: the page keeps Approve disabled and the controller refuses (fail closed).
 *
 * No `crypto.randomUUID` draw (the fixture router replay is keyed by the browser's uuid sequence), no write, no clock.
 */
import { pcbBoardInstanceId } from "../pcb/board-identity";
import { PcbSyncClient, type PcbSyncFetch } from "../pcb-sync/client";
import type { ResolutionBoardBasis } from "../component-resolution/board-impact";

export interface ResolutionBoardBasisScope { tenantId: string; projectId: string; branchId: string }

/** Load the basis for one project scope. `request` is the platform fetch unless a test routes it into the real handler. */
export async function loadResolutionBoardBasis(scope: ResolutionBoardBasisScope, request?: PcbSyncFetch): Promise<ResolutionBoardBasis> {
  const client = request ? new PcbSyncClient({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }, request) : new PcbSyncClient({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId });
  let boardId = pcbBoardInstanceId(scope.projectId);
  for (let hop = 0; hop < 2; hop++) {
    let loaded: Awaited<ReturnType<PcbSyncClient["loadBoardWithManufacturing"]>>;
    try {
      loaded = await client.loadBoardWithManufacturing(boardId);
    } catch (error) {
      return { state: "unavailable", code: "PS_NETWORK_UNAVAILABLE", detail: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
    }
    if (!loaded.ok) return loaded.kind === "not_found" ? { state: "no-board", boardId } : { state: "unavailable", code: loaded.code.slice(0, 80), detail: (loaded.detail ?? `the board read answered ${loaded.status}`).slice(0, 200) };
    const { load, manufacturing } = loaded.value;
    if (load.lineage && load.lineage.currentBoardId !== boardId) {
      if (hop > 0) return { state: "unavailable", code: "PS_BOARD_LINEAGE_UNSTABLE", detail: `board ${boardId} was itself superseded by ${load.lineage.currentBoardId}` };
      boardId = load.lineage.currentBoardId;
      continue;
    }
    if (load.status !== "found" || !load.record) return { state: "no-board", boardId };
    if (load.record.tenantId !== scope.tenantId || load.record.projectId !== scope.projectId || load.record.branchId !== scope.branchId || load.record.boardId !== boardId) {
      return { state: "unavailable", code: "PS_BOARD_SCOPE_MISMATCH", detail: "the board read answered for another scope" };
    }
    if (!manufacturing) return { state: "unavailable", code: "PS_MANUFACTURING_TRUTH_MISSING", detail: "the board read carried no manufacturing truth" };
    return {
      state: "board",
      boardId,
      record: load.record,
      authority: manufacturing.authority ? { revision: manufacturing.authority.revision, recordDigest: manufacturing.authority.recordDigest, current: manufacturing.authority.current } : null,
      latestRelease: manufacturing.latestRelease ? { releaseId: manufacturing.latestRelease.releaseId, current: manufacturing.latestRelease.current } : null,
    };
  }
  return { state: "unavailable", code: "PS_BOARD_LINEAGE_UNSTABLE", detail: "the board lineage did not settle" };
}
