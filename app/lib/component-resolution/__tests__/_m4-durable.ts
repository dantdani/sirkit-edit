/**
 * [PR-L6, 2026-10-19] Test-only helpers for runbook M.4 / M.5 item 7 (existing-board replacement): the PRODUCTION Schematic -> PCB path
 * a fresh browser drives, run in-process through the REAL route handlers (POST /api/physical-bindings, POST /api/pcb-sync
 * publish_demo_snapshot -> preflight -> apply, GET /api/pcb-sync?include=manufacturing) - the real PcbSynchronizationService over the
 * durable repositories, the real footprint resolver over the physical bindings, the real atomic resource provider.
 *
 * The CALLING suite declares the module seams (vi.mock is hoisted per file) exactly as the B16.1C acceptance suite does:
 *  - `@/app/lib/durable-workflow/runtime` -> one InMemoryDurableWorkflowRepository;
 *  - `@/app/lib/physical-binding/server-repository` -> one shared InMemoryPhysicalBindingRepository;
 *  - `@/app/lib/atomic/server-catalog` -> the published snapshots the suite serves (the fixture runtime catalog plus its own).
 * Nothing here mocks anything; it only builds the requests a browser sends and reads the answers.
 */
import { expect } from "vitest";
import { GET as physicalBindingsGet, POST as physicalBindings } from "@/app/api/physical-bindings/route";
import { GET as pcbSyncGet, POST as pcbSyncPost } from "@/app/api/pcb-sync/route";
import { pcbBoardInstanceId, pcbDesignInstanceId } from "@/app/lib/pcb/board-identity";
import type { PcbSyncFetch } from "@/app/lib/pcb-sync/client";
import type { PcbSyncBoardRecord, PcbSyncPreflightResult } from "@/app/lib/pcb-sync/types";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { SchematicState } from "@/lib/schematic-types";
import { applyRequest, getRequest, jsonRequest, preflightRequest, publicationRequest, readJson, signInAs, type LaidOutSchematic } from "@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/harness";
import { buildNetlist, type NetlistPartData } from "@/app/lib/pcb/netlist-bridge";

export type M4Scope = { tenantId: string; projectId: string; branchId: string };

/** The schematic as the browser holds it: the state and the catalog lookup its netlist is built with. */
export function laidOut(state: SchematicState, parts: ReadonlyMap<string, CachedPart>): LaidOutSchematic {
  const getPart = (partId: string): NetlistPartData | null => parts.get(partId) ?? null;
  return { state, netlist: buildNetlist(state, getPart), getPart };
}

/** A human reviewer binds every atomically resolved instance to its published revision on the board (POST /api/physical-bindings). */
export async function bindAll(state: SchematicState, scope: M4Scope, boardId = pcbBoardInstanceId(scope.projectId)): Promise<Map<string, { setId: string; bindingRevisionId: string }>> {
  signInAs("reviewer", scope);
  const bound = new Map<string, { setId: string; bindingRevisionId: string }>();
  for (const instance of state.kicadComponents ?? []) {
    if (!instance.atomicPartRevisionId) continue;
    const response = await physicalBindings(jsonRequest("/api/physical-bindings", { operation: "bind_atomic_selection", componentInstanceId: instance.id, boardInstanceId: boardId, atomicPartRevisionId: instance.atomicPartRevisionId, ...(instance.symbolAssetVersionId ? { symbolAssetVersionId: instance.symbolAssetVersionId } : {}) }, { scope }));
    const body = await readJson<{ ok: boolean; code?: string; setId: string; bindingRevisionId: string }>(response);
    expect(response.status, `${instance.refDes}: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(300);
    bound.set(instance.id, { setId: body.setId, bindingRevisionId: body.bindingRevisionId });
  }
  return bound;
}

/** What a reviewer's bind of ANOTHER revision onto an instance answers while its earlier binding is in effect (status and code). */
export async function bindOne(scope: M4Scope, componentInstanceId: string, atomicPartRevisionId: string, boardId = pcbBoardInstanceId(scope.projectId)): Promise<{ status: number; code: string | null }> {
  signInAs("reviewer", scope);
  const response = await physicalBindings(jsonRequest("/api/physical-bindings", { operation: "bind_atomic_selection", componentInstanceId, boardInstanceId: boardId, atomicPartRevisionId }, { scope }));
  const body = await readJson<{ code?: string }>(response);
  return { status: response.status, code: body.code ?? null };
}

/**
 * A human reviewer supersedes an instance's effective binding through the EXISTING generic transition operation (API only: the page
 * has no control for it - the open item this increment records). The set then has no effective selection, so the new revision binds.
 */
export async function supersedeBinding(scope: M4Scope, binding: { setId: string; bindingRevisionId: string }): Promise<void> {
  signInAs("reviewer", scope);
  const read = await physicalBindingsGet(getRequest(`/api/physical-bindings?setId=${encodeURIComponent(binding.setId)}`, { scope }));
  const set = await readJson<{ set: { revision: number; effectiveSelectedRevisionId: string | null } }>(read);
  expect(read.status).toBe(200);
  const response = await physicalBindings(jsonRequest("/api/physical-bindings", { operation: "transition", setId: binding.setId, transition: { schemaVersion: "sirkit.physical-binding-transition.v1", action: "supersede", bindingRevisionId: set.set.effectiveSelectedRevisionId ?? binding.bindingRevisionId, expectedSetRevision: set.set.revision, idempotencyKey: `m4-supersede-${binding.setId}-${set.set.revision}`, reason: "the schematic instance was re-resolved to another published revision" } }, { scope }));
  expect(response.status, JSON.stringify(await readJson(response)).slice(0, 300)).toBe(200);
}

/** The board read a browser makes (GET /api/pcb-sync?boardId&include=manufacturing). */
export async function readBoard(scope: M4Scope, boardId = pcbBoardInstanceId(scope.projectId)): Promise<PcbSyncBoardRecord | null> {
  signInAs("editor", scope);
  const response = await pcbSyncGet(getRequest(`/api/pcb-sync?boardId=${encodeURIComponent(boardId)}&include=manufacturing`, { scope }));
  const body = await readJson<{ result: { status: string; record?: PcbSyncBoardRecord } }>(response);
  return body.result.status === "found" ? body.result.record ?? null : null;
}

/** The platform fetch a `PcbSyncClient` uses, routed into the REAL GET /api/pcb-sync handler (a same-origin browser's headers). */
export function routedBoardFetch(scope: M4Scope): PcbSyncFetch {
  return async (input, init) => {
    signInAs("editor", scope);
    const href = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, "http://localhost").toString();
    const headers = new Headers(init?.headers);
    headers.set("origin", "http://localhost");
    return pcbSyncGet(new Request(href, { ...init, headers }));
  };
}

export interface M4SyncOutcome { preflight: PcbSyncPreflightResult; applied: boolean; record: PcbSyncBoardRecord | null; schematicRevision: string }

/**
 * The editor's Schematic -> PCB: publish the schematic snapshot (against the current snapshot revision), preflight against the
 * existing board (or a new one), and - when the preflight is ready - apply the exact plan. Returns the preflight as the server
 * answered it and the board record after.
 */
export async function preparePcb(schematic: LaidOutSchematic, scope: M4Scope, input: { expectedSnapshotRevision: number; boardId?: string; apply?: boolean; suffix?: string }): Promise<M4SyncOutcome> {
  signInAs("editor", scope);
  const boardId = input.boardId ?? pcbBoardInstanceId(scope.projectId);
  const designId = pcbDesignInstanceId(scope.projectId);
  const publication = publicationRequest(schematic, { expectedSnapshotRevision: input.expectedSnapshotRevision, boardId, designId, ...(input.suffix ? { suffix: input.suffix } : {}) });
  const published = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "publish_demo_snapshot", request: publication }, { scope }));
  expect(published.status, JSON.stringify(await readJson(published)).slice(0, 400)).toBeLessThan(300);
  const current = await readBoard(scope, boardId);
  signInAs("editor", scope);
  const preflightResponse = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preflight", request: preflightRequest({ schematicRevision: publication.schematicRevision, current, boardId, designId, requestId: `preflight:${publication.schematicRevision}:${current?.revision ?? "new"}` }) }, { scope }));
  const preflightBody = await readJson<{ ok: boolean; result: PcbSyncPreflightResult }>(preflightResponse);
  expect(preflightResponse.status, JSON.stringify(preflightBody).slice(0, 400)).toBe(200);
  const preflight = preflightBody.result;
  let applied = false;
  if ((input.apply ?? true) && preflight.status === "ready_to_apply" && preflight.plan) {
    const response = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "apply", request: applyRequest(preflight.plan, { boardId, designId }) }, { scope, headers: { "x-sirkit-pcb-sync-opt-in": "true" } }));
    const body = await readJson<{ result: { status: string } }>(response);
    expect(response.status, JSON.stringify(body).slice(0, 400)).toBe(200);
    expect(body.result.status).toBe("applied");
    applied = true;
  }
  return { preflight, applied, record: await readBoard(scope, boardId), schematicRevision: publication.schematicRevision };
}
