"use client";

/**
 * B16.1C §C/§F — the browser side of the prompt-to-Gerber workflow for the
 * manufacturing stages: durable-truth hydration, the explicit workflow
 * state, the separate administrator release confirmation, request-owned
 * release execution, explicit idempotent retry, and the release result.
 *
 * Coordinates the existing authorities only: the board is loaded through
 * the canonical pcb-sync read, qualification stays the editor's owned
 * `handleQualify`, release goes through the canonical `/api/pcb/release`
 * route (human project administrator, server-side re-verification), and
 * nothing here mutates editor state directly.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PcbSyncClient, PcbSyncManufacturingTruth } from "@/app/lib/pcb-sync/client";
import { runOwnedRelease, type PcbOwnedOperationRegistry } from "@/app/lib/pcb/lifecycle/owned-operations";
import type { PcbBoardLifecycleOwner } from "@/app/lib/pcb/lifecycle/board-lifecycle";
import { reconstruct } from "@/app/lib/workflow/prompt-to-gerber/machine";
import type { PromptToGerberSnapshot, WorkflowScope } from "@/app/lib/workflow/prompt-to-gerber/types";

export type ManufacturingHydration =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; at: number; boardRevision: string | null; boardDigest: string | null; truth: PcbSyncManufacturingTruth | null }
  | { status: "failed"; code: string; detail?: string };

export interface ManufacturingReleaseResult {
  releaseId: string;
  filename: string;
  archiveSha256: string;
  manifestContentDigest: string | null;
  authorityRevision: number;
  authorityDigest: string;
  boardRevision: string;
  recorded: "created" | "existing" | "unknown";
  /** Object URL of the downloaded ZIP (revoked when the hook unmounts). */
  blobUrl: string | null;
  byteLength: number;
}

export interface ManufacturingWorkflowError { operation: "hydrate" | "release"; code: string; message: string; correlationId: string | null }

export interface ManufacturingWorkflowIdentity { tenantId: string; projectId: string; branchId: string; designId: string; boardId: string }

export interface UseManufacturingWorkflowInput {
  client: PcbSyncClient | null;
  identity: ManufacturingWorkflowIdentity | null;
  /** Selector headers for the canonical release route (identity/role are server-derived). */
  scopeHeaders(): Record<string, string>;
  ownedOps: PcbOwnedOperationRegistry;
  lifecycle: Pick<PcbBoardLifecycleOwner, "capture">;
  /** Local canonical schematic presence (for reconstruction). */
  hasSchematic: boolean;
  schematicBaseDigest: string | null;
  /** Bumped by the editor after every verified server adoption (sync apply, qualification). */
  refreshToken: number;
  /** Optional transport override (tests). */
  fetchImpl?: typeof fetch;
  onNotice?(message: string): void;
  /** Persist release evidence into the project record (owned-gated by the caller). */
  onReleased?(result: ManufacturingReleaseResult): void;
}

export interface UseManufacturingWorkflowResult {
  hydration: ManufacturingHydration;
  truth: PcbSyncManufacturingTruth | null;
  workflow: PromptToGerberSnapshot | null;
  releasing: boolean;
  /** Presented for the administrator's separate confirmation; null when none is requested. */
  releaseConfirmation: null | { authorityRevision: number; authorityDigest: string; boardRevision: string; componentAuthorityDigest: string; fabricationProfileId: string; qualifiedAt: string };
  releaseResult: ManufacturingReleaseResult | null;
  error: ManufacturingWorkflowError | null;
  canRequestRelease: boolean;
  requestRelease(): void;
  cancelRelease(): void;
  /** The administrator's explicit authorization of the presented authority. */
  authorizeRelease(): Promise<void>;
  /** Explicit, idempotent retry of the last failed operation. */
  retry(): Promise<void>;
  refresh(): Promise<void>;
}

function parseFailure(response: Response, body: Record<string, unknown> | null): { code: string; message: string; correlationId: string | null } {
  const code = typeof body?.code === "string" ? body.code : `HTTP_${response.status}`;
  const message = typeof body?.error === "string" ? body.error : response.status === 401 ? "You are not signed in." : response.status === 403 ? "Only a project administrator can release." : "The release could not be completed.";
  const correlationId = typeof body?.correlationId === "string" ? body.correlationId : response.headers.get("X-Sirkit-Correlation-Id");
  return { code, message, correlationId };
}

export function useManufacturingWorkflow(input: UseManufacturingWorkflowInput): UseManufacturingWorkflowResult {
  const { client, identity, scopeHeaders, ownedOps, lifecycle, hasSchematic, schematicBaseDigest, refreshToken, fetchImpl, onNotice, onReleased } = input;
  const [hydration, setHydration] = useState<ManufacturingHydration>({ status: "idle" });
  const [releaseConfirmation, setReleaseConfirmation] = useState<UseManufacturingWorkflowResult["releaseConfirmation"]>(null);
  const [releaseResult, setReleaseResult] = useState<ManufacturingReleaseResult | null>(null);
  const [error, setError] = useState<ManufacturingWorkflowError | null>(null);
  // Busy state derives from the request-owned registry (single-flight per kind), never an ambient boolean.
  const subscribeReleasing = useCallback((listener: () => void) => ownedOps.subscribe(listener), [ownedOps]);
  const readReleasing = useCallback(() => ownedOps.busy("release"), [ownedOps]);
  const releasing = useSyncExternalStore(subscribeReleasing, readReleasing, readReleasing);
  const lastFailedRef = useRef<null | { operation: "hydrate" | "release"; authorityRevision?: number; authorityDigest?: string }>(null);
  const blobRef = useRef<string | null>(null);
  useEffect(() => () => { if (blobRef.current) { try { URL.revokeObjectURL(blobRef.current); } catch { /* ignore */ } } }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!client || !identity) { setHydration({ status: "idle" }); return; }
    setHydration({ status: "loading" });
    const scope = lifecycle.capture();
    const loaded = await client.loadBoardWithManufacturing(identity.boardId);
    if (!scope.isCurrent()) return;
    if (!loaded.ok) {
      setHydration({ status: "failed", code: loaded.code, detail: loaded.detail });
      setError({ operation: "hydrate", code: loaded.code, message: loaded.kind === "retryable" ? "The server could not be reached. Nothing changed — retry when it is back." : `Durable truth could not be loaded (${loaded.code}).`, correlationId: null });
      lastFailedRef.current = { operation: "hydrate" };
      return;
    }
    const record = loaded.value.load.status === "found" ? loaded.value.load.record ?? null : null;
    setHydration({ status: "loaded", at: Date.now(), boardRevision: record?.revision ?? null, boardDigest: record?.digest ?? null, truth: loaded.value.manufacturing });
    setError((current) => current?.operation === "hydrate" ? null : current);
  }, [client, identity, lifecycle]);

  // Deferred so the effect body itself never sets state synchronously
  // (the hydration read starts on the next tick; the token forces re-reads).
  useEffect(() => {
    const tick = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(tick);
  }, [refresh, refreshToken]);

  const truth = hydration.status === "loaded" ? hydration.truth : null;
  const workflow = useMemo<PromptToGerberSnapshot | null>(() => {
    if (!identity || hydration.status !== "loaded") return null;
    const scope: WorkflowScope = { tenantId: identity.tenantId, projectId: identity.projectId, branchId: identity.branchId, designId: identity.designId, boardId: identity.boardId };
    return reconstruct(scope, {
      boardFound: hydration.boardRevision !== null,
      boardRevision: hydration.boardRevision,
      boardDigest: hydration.boardDigest,
      snapshot: hydration.truth?.snapshot ? { revision: hydration.truth.snapshot.revision, schematicRevision: hydration.truth.snapshot.schematicRevision } : null,
      authority: hydration.truth?.authority ? { revision: hydration.truth.authority.revision, recordDigest: hydration.truth.authority.recordDigest, boardRevision: hydration.truth.authority.boardRevision, componentAuthorityDigest: hydration.truth.authority.componentAuthorityDigest, current: hydration.truth.authority.current } : null,
      latestRelease: hydration.truth?.latestRelease ? { releaseId: hydration.truth.latestRelease.releaseId, archiveSha256: hydration.truth.latestRelease.archiveSha256, filename: hydration.truth.latestRelease.filename, authorityRevision: hydration.truth.latestRelease.authorityRevision, current: hydration.truth.latestRelease.current } : null,
    }, { hasSchematic, schematicBaseDigest }, new Date(hydration.at).toISOString());
  }, [identity, hydration, hasSchematic, schematicBaseDigest]);

  const canRequestRelease = Boolean(truth?.authority?.current && hydration.status === "loaded" && hydration.boardRevision === truth?.authority?.boardRevision && !releasing);

  const requestRelease = useCallback((): void => {
    if (!truth?.authority?.current || hydration.status !== "loaded") { onNotice?.("Release needs a CURRENT qualification authority for this board. Run Qualify & route first."); return; }
    setError(null);
    setReleaseConfirmation({ authorityRevision: truth.authority.revision, authorityDigest: truth.authority.recordDigest, boardRevision: truth.authority.boardRevision, componentAuthorityDigest: truth.authority.componentAuthorityDigest, fabricationProfileId: truth.authority.fabricationProfileId, qualifiedAt: truth.authority.qualifiedAt });
  }, [truth, hydration.status, onNotice]);
  const cancelRelease = useCallback((): void => { setReleaseConfirmation(null); }, []);

  const executeRelease = useCallback(async (authorityRevision: number, authorityDigest: string): Promise<void> => {
    if (!identity) return;
    const doFetch = fetchImpl ?? ((request: RequestInfo | URL, init?: RequestInit) => fetch(request, init));
    await runOwnedRelease<ManufacturingReleaseResult>(ownedOps, {
      release: async () => {
        try {
          const response = await doFetch("/api/pcb/release", { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ boardId: identity.boardId, designId: identity.designId, expectedAuthorityRevision: authorityRevision, expectedAuthorityDigest: authorityDigest }) });
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
            const failure = parseFailure(response, body);
            return { ok: false, message: failure.message, code: failure.code, correlationId: failure.correlationId ?? undefined };
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          const releaseId = response.headers.get("X-Sirkit-Release-Id") ?? "";
          const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `sirkit-${identity.boardId.replace(/[^A-Za-z0-9_-]/g, "-")}-${releaseId.slice(-12)}.zip`;
          const recordedHeader = response.headers.get("X-Sirkit-Release-Recorded");
          let blobUrl: string | null = null;
          try { blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/zip" })); } catch { blobUrl = null; }
          return { ok: true, value: {
            releaseId, filename, archiveSha256: response.headers.get("X-Sirkit-Archive-Sha256") ?? "", manifestContentDigest: response.headers.get("X-Sirkit-Manifest-Digest"),
            authorityRevision: Number(response.headers.get("X-Sirkit-Authority-Revision") ?? authorityRevision), authorityDigest: response.headers.get("X-Sirkit-Authority-Digest") ?? authorityDigest,
            boardRevision: response.headers.get("X-Sirkit-Board-Revision") ?? "", recorded: recordedHeader === "created" || recordedHeader === "existing" ? recordedHeader : "unknown", blobUrl, byteLength: bytes.byteLength,
          } };
        } catch (cause) {
          return { ok: false, message: `Release request failed: ${cause instanceof Error ? cause.message : String(cause)}`, code: "MFG_CLIENT_TRANSPORT" };
        }
      },
      fail: (failure) => {
        setError({ operation: "release", code: failure.code ?? "MFG_RELEASE_FAILED", message: failure.message, correlationId: failure.correlationId ?? null });
        lastFailedRef.current = { operation: "release", authorityRevision, authorityDigest };
        setReleaseConfirmation(null);
      },
      complete: (released) => {
        if (blobRef.current && blobRef.current !== released.blobUrl) { try { URL.revokeObjectURL(blobRef.current); } catch { /* ignore */ } }
        blobRef.current = released.blobUrl;
        setReleaseResult(released);
        setReleaseConfirmation(null);
        setError(null);
        lastFailedRef.current = null;
        onReleased?.(released);
        if (released.blobUrl && typeof document !== "undefined") {
          const anchor = document.createElement("a");
          anchor.href = released.blobUrl; anchor.download = released.filename; anchor.rel = "noopener";
          anchor.click();
        }
        void refresh();
      },
      settleStale: () => { onNotice?.("The release request completed on the server, but this board was replaced locally while it ran. Reload the manufacturing truth to see the ledgered release."); },
    });
  }, [identity, fetchImpl, ownedOps, scopeHeaders, onReleased, onNotice, refresh]);

  const authorizeRelease = useCallback(async (): Promise<void> => {
    const confirmation = releaseConfirmation;
    if (!confirmation || releasing) return;
    await executeRelease(confirmation.authorityRevision, confirmation.authorityDigest);
  }, [releaseConfirmation, releasing, executeRelease]);

  const retry = useCallback(async (): Promise<void> => {
    const failed = lastFailedRef.current;
    if (!failed || releasing) return;
    if (failed.operation === "hydrate") { await refresh(); return; }
    if (failed.authorityRevision !== undefined && failed.authorityDigest) await executeRelease(failed.authorityRevision, failed.authorityDigest);
  }, [releasing, refresh, executeRelease]);

  return { hydration, truth, workflow, releasing, releaseConfirmation, releaseResult, error, canRequestRelease, requestRelease, cancelRelease, authorizeRelease, retry, refresh };
}
