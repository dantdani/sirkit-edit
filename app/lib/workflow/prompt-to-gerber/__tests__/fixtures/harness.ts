/**
 * B16.1C §H — the shared deterministic harness for the prompt-to-Gerber
 * acceptance and recovery suites.
 *
 * Nothing in here registers module mocks (Vitest hoists `vi.mock` per test
 * file, so every suite declares its own seams with `registerPipelineMocks`'s
 * documented block). This module only owns the deterministic plumbing:
 *
 *  - a frozen wall clock (Date only — timers keep running) so every
 *    timestamp-derived identity (binding revisions, plan ids, audit ids,
 *    board records) is byte-stable across runs and machines;
 *  - deterministic `crypto.randomUUID` so schematic component instance ids
 *    (and therefore every downstream durable identity) are reproducible;
 *  - server-derived identity injection (`injectAuthorizedPrincipal`) for the
 *    fresh-browser roles: an editor proposes/approves, an admin releases;
 *  - Request builders for the canonical routes (same-origin, selector headers);
 *  - the client-side steps a fresh browser performs in-process: layout of the
 *    proposed netlist, the pcb-sync publication graph, hydration reads.
 */

import { vi } from "vitest";
import { injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, pcbBoardInstanceId, pcbDesignInstanceId } from "@/app/lib/pcb/board-identity";
import { buildNetlist, buildPcbSyncPublicationGraph, type NetlistPartData, type PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import { PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, PCB_SYNC_REQUEST_VERSION, type PcbSyncApplyRequest, type PcbSyncDemoSnapshotPublicationRequest, type PcbSyncPreflightRequest } from "@/app/lib/pcb-sync/types";
import { autoLayoutBuildValidated } from "@/lib/build-auto-layout";
import type { BuildLogicalNetlist, SchematicState } from "@/lib/schematic-types";
import type { CachedPart } from "@/app/lib/parts-cache";

export const FIXED_NOW = "2026-09-09T12:00:00.000Z"; // [B16-C.4] at or after the rule-profile evidence retrieval date (2026-09-09), else every release is "not yet valid"
export const SCOPE = { tenantId: "local", projectId: "b16-1c-blinker", branchId: "main" } as const;
export const BOARD_ID = pcbBoardInstanceId(SCOPE.projectId);
export const DESIGN_ID = pcbDesignInstanceId(SCOPE.projectId);
export const ASSEMBLY_VARIANT_ID = PCB_BOARD_ASSEMBLY_VARIANT_ID;

export type Role = "viewer" | "commenter" | "editor" | "reviewer" | "admin";
export const USERS = { editor: "u-fresh-editor", admin: "u-fresh-admin", viewer: "u-fresh-viewer", reviewer: "u-fresh-reviewer" } as const;

/** Freeze Date (not timers) at FIXED_NOW; returns the restore function. */
export function freezeClock(now = FIXED_NOW): () => void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  return () => vi.useRealTimers();
}

/** Deterministic component instance ids; returns the restore function. */
export function deterministicUuids(prefix = "b16-1c-inst"): () => void {
  let counter = 0;
  const spy = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation((() => `${prefix}-${String(++counter).padStart(4, "0")}`) as typeof crypto.randomUUID);
  return () => spy.mockRestore();
}

export function signInAs(role: Role, scope: { tenantId: string; projectId: string; branchId?: string } = SCOPE): void {
  resetInjectedIdentity();
  const userId = role === "admin" ? USERS.admin : role === "editor" ? USERS.editor : role === "reviewer" ? USERS.reviewer : USERS.viewer;
  injectIdentity({ userId });
  // [B16-C.2] the project's OTHER members keep their memberships while this user is signed in —
  // a reviewer's session must never read as the editor's revocation (which retires the
  // editor's pending review request). Each browser session is one user; the project is shared.
  injectMembership(allFreshBrowserMemberships(scope));
}

/** Every fresh-browser user with their standing role in the project. */
export function allFreshBrowserMemberships(scope: { tenantId: string; projectId: string } = SCOPE): Array<{ tenantId: string; projectId: string; userId: string; role: Role }> {
  return [
    { tenantId: scope.tenantId, projectId: scope.projectId, userId: USERS.admin, role: "admin" },
    { tenantId: scope.tenantId, projectId: scope.projectId, userId: USERS.editor, role: "editor" },
    { tenantId: scope.tenantId, projectId: scope.projectId, userId: USERS.reviewer, role: "reviewer" },
    { tenantId: scope.tenantId, projectId: scope.projectId, userId: USERS.viewer, role: "viewer" },
  ];
}
/** An UNAUTHENTICATED browser (the identity provider verifies to null) — not the local-dev default principal. */
export function signOut(): void { injectIdentity(null); }
/** Restore the default identity/membership factories (test teardown). */
export function restoreIdentity(): void { resetInjectedIdentity(); }

export function selectorHeaders(scope: { tenantId: string; projectId: string; branchId: string } = SCOPE): Record<string, string> {
  return { "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId };
}

export function jsonRequest(path: string, body: unknown, options: { headers?: Record<string, string>; scope?: { tenantId: string; projectId: string; branchId: string }; method?: string } = {}): Request {
  return new Request(`http://localhost${path}`, { method: options.method ?? "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...selectorHeaders(options.scope), ...(options.headers ?? {}) }, body: JSON.stringify(body) });
}

export function getRequest(path: string, options: { headers?: Record<string, string>; scope?: { tenantId: string; projectId: string; branchId: string } } = {}): Request {
  return new Request(`http://localhost${path}`, { method: "GET", headers: { origin: "http://localhost", ...selectorHeaders(options.scope), ...(options.headers ?? {}) } });
}

export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.clone().json()) as T;
}

// ── the browser's own steps, run in-process ────────────────────────────────

export interface LaidOutSchematic { state: SchematicState; netlist: PcbNetlist; getPart: (partId: string) => NetlistPartData | null }

/** What the browser does with a proposal after the user approves it: lay it out and derive the netlist. */
export function layoutProposal(proposal: BuildLogicalNetlist, parts: Map<string, CachedPart>): LaidOutSchematic & { validationOk: boolean; violations: string[] } {
  const { state, validation } = autoLayoutBuildValidated(proposal, parts);
  const getPart = (partId: string): NetlistPartData | null => parts.get(partId) ?? null;
  return { state, netlist: buildNetlist(state, getPart), getPart, validationOk: validation.ok, violations: validation.violations.map((item) => item.message) };
}

/** The exact publication request `PcbEditor` builds (same revision-token scheme). */
export function publicationRequest(schematic: LaidOutSchematic, input: { expectedSnapshotRevision: number; requestedAt?: string; boardId?: string; designId?: string; suffix?: string }): PcbSyncDemoSnapshotPublicationRequest {
  const graph = buildPcbSyncPublicationGraph(schematic.state, schematic.getPart);
  const token = graph.sourceDigest.replace(/^sha256:/, "").slice(0, 40) + (input.suffix ?? "");
  return { requestSchemaVersion: PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, requestId: `publish:${token}`, designId: input.designId ?? DESIGN_ID, boardId: input.boardId ?? BOARD_ID, boardName: "Main Board", projectRevision: `project:${token}`, designRevision: `design:${token}`, schematicRevision: `schematic:${token}`, componentSetRevision: `components:${token}`, netGraphRevision: `netgraph:${token}`, assemblyVariantId: ASSEMBLY_VARIANT_ID, assemblyVariantRevision: "variant:default:1", librarySnapshotRevision: "library:current:1", expectedSnapshotRevision: input.expectedSnapshotRevision, idempotencyKey: `publish:${token}`, components: graph.components, nets: graph.nets, prerequisiteIssues: graph.prerequisiteIssues, sourceDigest: graph.sourceDigest, requestedAt: input.requestedAt ?? new Date().toISOString() };
}

export function preflightRequest(input: { schematicRevision: string; current?: { revision: string } | null; requestedAt?: string; boardId?: string; designId?: string; requestId?: string }): Omit<PcbSyncPreflightRequest, "tenantId" | "projectId" | "branchId" | "actorContext"> {
  const boardId = input.boardId ?? BOARD_ID;
  return { requestSchemaVersion: PCB_SYNC_REQUEST_VERSION, requestId: input.requestId ?? `preflight:${input.schematicRevision}`, designId: input.designId ?? DESIGN_ID, schematicRevision: input.schematicRevision, assemblyVariantId: ASSEMBLY_VARIANT_ID, target: input.current ? { kind: "existing_board", boardId, expectedBoardRevision: input.current.revision } : { kind: "new_board", boardId, boardName: "Main Board", boardFormatVersion: "sirkit-json-pcb/1" }, resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0", syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", requestedAt: input.requestedAt ?? new Date().toISOString(), mode: "prepare_apply" };
}

export function applyRequest(plan: { planId: string; planDigest: string }, input: { requestedAt?: string; boardId?: string; designId?: string; idempotencyKey?: string; requestId?: string } = {}): Omit<PcbSyncApplyRequest, "tenantId" | "projectId" | "branchId" | "actorContext"> {
  return { requestSchemaVersion: "sirkit.pcb-sync-apply-request.v1", requestId: input.requestId ?? `apply:${plan.planId}`, designId: input.designId ?? DESIGN_ID, boardId: input.boardId ?? BOARD_ID, planId: plan.planId, planDigest: plan.planDigest, expectedPlanLifecycle: "applicable", confirmation: "apply_exact_plan", idempotencyKey: input.idempotencyKey ?? `apply:${plan.planId}:${plan.planDigest}`, warningAcknowledgements: [], requestedAt: input.requestedAt ?? new Date().toISOString() };
}
