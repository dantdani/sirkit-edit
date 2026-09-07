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
 *
 * [B16-A] corrections against the review of PR #5:
 *  - F12: a durable record that failed integrity verification on the server
 *    is a FAILED hydration (with its code), never "no authority";
 *  - F14: release can only be requested when the server says this viewer
 *    may authorize one (`truth.viewer.canRelease`), and the reason is exposed;
 *  - F19: a retry after the server refused the CONFIRMED authority as stale
 *    (`MFG_AUTHORITY_CONFIRMATION_MISMATCH` / `MFG_AUTHORITY_STALE`) never
 *    resends the same pins — it re-hydrates and asks the administrator to
 *    confirm the FRESH authority; transport/5xx failures keep the explicit
 *    idempotent resend.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PcbSyncClient, PcbSyncClientFailureKind, PcbSyncManufacturingTruth } from "@/app/lib/pcb-sync/client";
import { runOwnedRelease, type PcbOwnedOperationRegistry } from "@/app/lib/pcb/lifecycle/owned-operations";
import type { PcbBoardLifecycleOwner } from "@/app/lib/pcb/lifecycle/board-lifecycle";
import { reconstruct } from "@/app/lib/workflow/prompt-to-gerber/machine";
import type { PromptToGerberSnapshot, WorkflowScope } from "@/app/lib/workflow/prompt-to-gerber/types";

export type ManufacturingHydration =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; at: number; boardRevision: string | null; boardDigest: string | null; truth: PcbSyncManufacturingTruth | null }
  | { status: "failed"; code: string; detail?: string };
type LoadedHydration = Extract<ManufacturingHydration, { status: "loaded" }>;

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

export type ManufacturingReleaseConfirmation = { authorityRevision: number; authorityDigest: string; boardRevision: string; componentAuthorityDigest: string; fabricationProfileId: string; qualifiedAt: string };

export interface UseManufacturingWorkflowResult {
  hydration: ManufacturingHydration;
  truth: PcbSyncManufacturingTruth | null;
  workflow: PromptToGerberSnapshot | null;
  releasing: boolean;
  /** Presented for the administrator's separate confirmation; null when none is requested. */
  releaseConfirmation: null | ManufacturingReleaseConfirmation;
  releaseResult: ManufacturingReleaseResult | null;
  error: ManufacturingWorkflowError | null;
  canRequestRelease: boolean;
  /** [B16-A F14] whether the server-derived viewer may authorize a release, and why not when it cannot. */
  releaseCapability: { allowed: boolean; reason: string | null };
  requestRelease(): void;
  cancelRelease(): void;
  /** The administrator's explicit authorization of the presented authority. */
  authorizeRelease(): Promise<void>;
  /** Explicit retry of the last failed operation: idempotent resend for transport failures; re-hydration + a NEW confirmation for a stale one. */
  retry(): Promise<void>;
  refresh(): Promise<void>;
}

/** [B16-A F14] the reason shown to a viewer the server says may not authorize a release. */
export const RELEASE_CAPABILITY_REASON = "Only a project administrator can authorize a manufacturing release.";
const RELEASE_CAPABILITY_UNKNOWN = "Release capability is unknown until durable truth is loaded.";
/** [B16-A F19] refusals that name the CONFIRMED authority as stale — the same pins can only be refused again. */
const STALE_CONFIRMATION_CODES = new Set(["MFG_AUTHORITY_CONFIRMATION_MISMATCH", "MFG_AUTHORITY_STALE"]);
const INTEGRITY_SUBJECTS = ["authority", "snapshot", "latestRelease"] as const;
const SUMMARY_READ_FAILED = "PS_MANUFACTURING_SUMMARY_READ_FAILED";

type LastFailure = { operation: "hydrate" } | { operation: "release"; authorityRevision: number; authorityDigest: string; code: string };

function parseFailure(response: Response, body: Record<string, unknown> | null): { code: string; message: string; correlationId: string | null } {
  const code = typeof body?.code === "string" ? body.code : `HTTP_${response.status}`;
  const message = typeof body?.error === "string" ? body.error : response.status === 401 ? "You are not signed in." : response.status === 403 ? "Only a project administrator can release." : "The release could not be completed.";
  const correlationId = typeof body?.correlationId === "string" ? body.correlationId : response.headers.get("X-Sirkit-Correlation-Id");
  return { code, message, correlationId };
}

function hydrationFailureMessage(failure: { kind: PcbSyncClientFailureKind; code: string }): string {
  if (failure.code === "PS_API_INVALID_RESPONSE") return "The server's answer could not be verified (PS_API_INVALID_RESPONSE). Nothing changed — retry.";
  return failure.kind === "retryable" ? "The server could not be reached. Nothing changed — retry when it is back." : `Durable truth could not be loaded (${failure.code}).`;
}

/** [B16-A F12] the first bounded code of a durable subject the server could not verify, or null when every subject verified. */
function corruptIntegrityCode(truth: PcbSyncManufacturingTruth | null): string | null {
  if (!truth || !INTEGRITY_SUBJECTS.some((subject) => truth.integrity?.[subject] === "corrupt")) return null;
  return truth.integrity.codes[0] ?? SUMMARY_READ_FAILED;
}

/** The confirmation an administrator is asked for: exactly the CURRENT authority of the board this hydration loaded, or nothing. */
function confirmationFor(loaded: LoadedHydration): ManufacturingReleaseConfirmation | null {
  const authority = loaded.truth?.authority;
  if (!authority?.current || loaded.boardRevision !== authority.boardRevision) return null;
  return { authorityRevision: authority.revision, authorityDigest: authority.recordDigest, boardRevision: authority.boardRevision, componentAuthorityDigest: authority.componentAuthorityDigest, fabricationProfileId: authority.fabricationProfileId, qualifiedAt: authority.qualifiedAt };
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
  const lastFailedRef = useRef<LastFailure | null>(null);
  const blobRef = useRef<string | null>(null);
  useEffect(() => () => { if (blobRef.current) { try { URL.revokeObjectURL(blobRef.current); } catch { /* ignore */ } } }, []);

  /** Reads durable truth and returns the loaded hydration, or null when the read failed, a
   *  subject failed integrity verification, or the board was replaced locally meanwhile. */
  const hydrate = useCallback(async (): Promise<LoadedHydration | null> => {
    if (!client || !identity) { setHydration({ status: "idle" }); return null; }
    setHydration({ status: "loading" });
    const scope = lifecycle.capture();
    const loaded = await client.loadBoardWithManufacturing(identity.boardId);
    if (!scope.isCurrent()) return null;
    if (!loaded.ok) {
      setHydration({ status: "failed", code: loaded.code, detail: loaded.detail });
      setError({ operation: "hydrate", code: loaded.code, message: hydrationFailureMessage(loaded), correlationId: null });
      lastFailedRef.current = { operation: "hydrate" };
      return null;
    }
    const truth = loaded.value.manufacturing;
    // [B16-A F12] a durable record the server could not verify is NOT "nothing qualified yet".
    const corrupt = corruptIntegrityCode(truth);
    if (corrupt) {
      setHydration({ status: "failed", code: corrupt });
      setError({ operation: "hydrate", code: corrupt, message: `A durable manufacturing record failed integrity verification (${corrupt}). Nothing can be released until an operator inspects it.`, correlationId: null });
      lastFailedRef.current = { operation: "hydrate" };
      return null;
    }
    const record = loaded.value.load.status === "found" ? loaded.value.load.record ?? null : null;
    const next: LoadedHydration = { status: "loaded", at: Date.now(), boardRevision: record?.revision ?? null, boardDigest: record?.digest ?? null, truth };
    setHydration(next);
    setError((current) => current?.operation === "hydrate" ? null : current);
    return next;
  }, [client, identity, lifecycle]);
  const refresh = useCallback(async (): Promise<void> => { await hydrate(); }, [hydrate]);

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

  // [B16-A F14] the server-derived viewer decides; the browser never guesses a role.
  const releaseCapability = useMemo<UseManufacturingWorkflowResult["releaseCapability"]>(() => {
    if (truth?.viewer?.canRelease === true) return { allowed: true, reason: null };
    return { allowed: false, reason: truth?.viewer ? RELEASE_CAPABILITY_REASON : RELEASE_CAPABILITY_UNKNOWN };
  }, [truth]);
  const authorityCurrentForBoard = hydration.status === "loaded" && confirmationFor(hydration) !== null;
  const canRequestRelease = authorityCurrentForBoard && releaseCapability.allowed && !releasing;

  const requestRelease = useCallback((): void => {
    if (!releaseCapability.allowed) { onNotice?.(releaseCapability.reason ?? RELEASE_CAPABILITY_REASON); return; }
    const confirmation = hydration.status === "loaded" ? confirmationFor(hydration) : null;
    if (!confirmation) { onNotice?.("Release needs a CURRENT qualification authority for this board. Run Qualify & route first."); return; }
    setError(null);
    setReleaseConfirmation(confirmation);
  }, [hydration, releaseCapability, onNotice]);
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
        const code = failure.code ?? "MFG_RELEASE_FAILED";
        setError({ operation: "release", code, message: failure.message, correlationId: failure.correlationId ?? null });
        lastFailedRef.current = { operation: "release", authorityRevision, authorityDigest, code };
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
    if (!STALE_CONFIRMATION_CODES.has(failed.code)) { await executeRelease(failed.authorityRevision, failed.authorityDigest); return; }
    // [B16-A F19] the server refused the CONFIRMED pins as stale, so resending
    // them is not a retry — it is the same refusal. Re-read durable truth and,
    // when it carries a current authority this viewer may release, ask the
    // administrator to confirm THAT authority. Nothing is sent from here.
    const fresh = await hydrate();
    if (!fresh) return;
    const viewerCanRelease = fresh.truth?.viewer?.canRelease === true;
    const confirmation = viewerCanRelease ? confirmationFor(fresh) : null;
    if (!confirmation) { onNotice?.(viewerCanRelease ? "No CURRENT qualification authority exists for this board any more. Run Qualify & route again before requesting a release." : RELEASE_CAPABILITY_REASON); return; }
    lastFailedRef.current = null;
    setError(null);
    setReleaseConfirmation(confirmation);
  }, [releasing, refresh, hydrate, executeRelease, onNotice]);

  return { hydration, truth, workflow, releasing, releaseConfirmation, releaseResult, error, canRequestRelease, releaseCapability, requestRelease, cancelRelease, authorizeRelease, retry, refresh };
}
