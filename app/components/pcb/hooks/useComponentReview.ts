"use client";

/**
 * [B16-C.2] The browser side of the component-binding REVIEW HANDOFF.
 *
 * Publishing an exact component binding is a reviewer / administrator act.
 * This hook lets an editor REQUEST review of a component's exact candidate,
 * lets a reviewer LIST the pending requests with the server-projected
 * evidence and APPROVE / REJECT them, and lets the editor resume from the
 * durable result after any refresh. Everything here is a thin client over
 * the canonical `/api/physical-bindings` route: the server decides roles
 * (the viewer block is server-derived), performs the binding under the
 * reviewer's identity, and retires requests whose requester lost authority.
 * Nothing is remembered in browser storage.
 *
 * [B19-E E5] With `catalogStatus`, the hook also reads the catalog status of every bound revision (POST
 * /api/components/revision-status) and, for a withdrawn revision that names a successor, previews the upgrade diff
 * (`preview_atomic_successor`) and asks the server to rebind to it with the previewed digest and a reason
 * (`rebind_atomic_successor`) — a reviewer's or administrator's act the server enforces again.
 *
 * [B19-E E5 review] For a component on a withdrawn or unpublished revision it also reads the effective approved binding
 * (`list_effective_atomic_selections`): a successor preview is offered only where that binding is the withdrawn revision, and the
 * successor previewed is the first selectable revision of the chain. The request and bind bodies come from the helpers below,
 * which carry the placed instance's symbol version (the server blocks a symbol that differs from the revision's).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentReviewRequest, ComponentReviewStatus } from "@/app/lib/physical-binding/review-handoff";
import { ATOMIC_REVISION_STATUS_ROUTE, type AtomicRevisionStatusView } from "@/app/lib/atomic/revision-status";
import type { AtomicSuccessorPreview } from "@/app/lib/physical-binding/atomic-successor";

export interface ReviewableComponent { id: string; refDes: string; atomicPartRevisionId: string; /** [B19-E E5] the installed symbol version */ symbolAssetVersionId?: string }

/** [B19-E E5 review] A placed instance as a reviewable component (with its installed symbol version); null without an exact revision. */
export function reviewableComponentOf(instance: { id: string; refDes: string; atomicPartRevisionId?: string; symbolAssetVersionId?: string }): ReviewableComponent | null {
  if (!instance.atomicPartRevisionId) return null;
  return { id: instance.id, refDes: instance.refDes, atomicPartRevisionId: instance.atomicPartRevisionId, ...(instance.symbolAssetVersionId ? { symbolAssetVersionId: instance.symbolAssetVersionId } : {}) };
}

/** [B19-E E5 review] The PCB sync's bind body: the placed instance's exact revision and, when it has one, its installed symbol version. */
export function atomicBindRequestBody(instance: { id: string; atomicPartRevisionId: string; symbolAssetVersionId?: string }, boardInstanceId: string): Record<string, string> {
  return { operation: "bind_atomic_selection", componentInstanceId: instance.id, boardInstanceId, atomicPartRevisionId: instance.atomicPartRevisionId, ...(instance.symbolAssetVersionId ? { symbolAssetVersionId: instance.symbolAssetVersionId } : {}) };
}

/** [B19-E E5 review] A review request body, with the installed symbol version when the component has one. */
function reviewRequestBody(component: ReviewableComponent, boardInstanceId: string, reason: string): Record<string, string> {
  return { operation: "request_atomic_review", componentInstanceId: component.id, boardInstanceId, atomicPartRevisionId: component.atomicPartRevisionId, ...(component.symbolAssetVersionId ? { symbolAssetVersionId: component.symbolAssetVersionId } : {}), reason };
}

/** [B19-E E5 review] The server reads at most this many components' effective bindings at once. */
const EFFECTIVE_SELECTION_BATCH = 50;

export interface ComponentReviewViewer { actorId: string; role: string; actorKind: string; canRequest: boolean; canResolve: boolean }

export type ComponentReviewListing =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; at: number; viewer: ComponentReviewViewer; membershipVerified: boolean; requests: Array<ComponentReviewRequest & { revision: number }> }
  | { status: "failed"; code: string; message: string };

export interface ComponentReviewRow {
  component: ReviewableComponent;
  /** The request that currently governs this component + candidate, if any. */
  request: (ComponentReviewRequest & { revision: number }) | null;
  state: ComponentReviewStatus | "none";
}

export interface UseComponentReviewInput {
  enabled: boolean;
  scopeHeaders(): Record<string, string>;
  boardInstanceId: string | null;
  components: ReviewableComponent[];
  refreshToken?: number;
  fetchImpl?: typeof fetch;
  onNotice?(message: string): void;
  /** [B19-E E5] read the bound revisions' catalog status and offer successor preview and rebind */
  catalogStatus?: boolean;
}

export interface UseComponentReviewResult {
  listing: ComponentReviewListing;
  rows: ComponentReviewRow[];
  pendingCount: number;
  busy: string | null;
  lastError: { operation: string; code: string; message: string } | null;
  refresh(): Promise<void>;
  request(component: ReviewableComponent, reason?: string): Promise<boolean>;
  requestAll(reason?: string): Promise<{ requested: number; failed: number }>;
  resolve(requestId: string, decision: "approve" | "reject", reason: string): Promise<boolean>;
  withdraw(requestId: string, reason?: string): Promise<boolean>;
  /** [B19-E E5] catalog status by revision id (empty without the `catalogStatus` option) */
  statuses: Readonly<Record<string, AtomicRevisionStatusView>>;
  /** [B19-E E5] the successor preview each component last received, by component id */
  previews: Readonly<Record<string, AtomicSuccessorPreview>>;
  /**
   * [B19-E E5 review] for a component on a withdrawn or unpublished revision: the exact revision its effective approved binding
   * names (null: none), by component id; absent until read
   */
  effectiveRevisions: Readonly<Record<string, string | null>>;
  previewSuccessor(component: ReviewableComponent): Promise<boolean>;
  rebindSuccessor(component: ReviewableComponent, reason: string): Promise<boolean>;
}

type Failure = { operation: string; code: string; message: string };

async function readFailure(response: Response, operation: string): Promise<Failure> {
  const body = (await response.json().catch(() => null)) as { code?: string; error?: string } | null;
  const code = body?.code ?? `HTTP_${response.status}`;
  const message = response.status === 403 ? "You do not have permission for this review action." : response.status === 409 ? "The review request changed on the server — refresh and look again." : body?.error && body.error !== code ? body.error : `The server refused the request (${code}).`;
  return { operation, code, message };
}

export function useComponentReview(input: UseComponentReviewInput): UseComponentReviewResult {
  const { enabled, boardInstanceId, components, refreshToken = 0, onNotice, catalogStatus = false } = input;
  const fetchImpl = input.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  const [listing, setListing] = useState<ComponentReviewListing>({ status: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<Failure | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AtomicRevisionStatusView>>({}); // [B19-E E5]
  const [previews, setPreviews] = useState<Record<string, AtomicSuccessorPreview>>({}); // [B19-E E5]
  const [effectiveRevisions, setEffectiveRevisions] = useState<Record<string, string | null>>({}); // [B19-E E5 review]
  const generation = useRef(0);
  // Callers may pass a fresh `scopeHeaders` / `fetchImpl` on every render; read
  // them through refs so `refresh` stays stable and the mount effect runs once
  // per (enabled, board, refreshToken) — never once per render.
  const headersRef = useRef(input.scopeHeaders);
  const fetchRef = useRef(fetchImpl);
  const componentsRef = useRef(components); // [B19-E E5] the status read follows the components without re-creating refresh
  useEffect(() => { headersRef.current = input.scopeHeaders; fetchRef.current = fetchImpl; componentsRef.current = components; });
  const hasFetch = fetchImpl !== null;

  const post = useCallback(async (body: Record<string, unknown>): Promise<Response> => {
    const fetchFn = fetchRef.current;
    if (!fetchFn) throw new Error("fetch unavailable");
    return fetchFn("/api/physical-bindings", { method: "POST", headers: { "content-type": "application/json", ...headersRef.current() }, body: JSON.stringify(body) });
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || !boardInstanceId || !hasFetch) { setListing({ status: "idle" }); return; }
    const mine = ++generation.current;
    setListing((current) => current.status === "loaded" ? current : { status: "loading" });
    try {
      const response = await post({ operation: "list_review_requests", boardInstanceId });
      if (mine !== generation.current) return;
      if (!response.ok) { const failure = await readFailure(response, "list"); setListing({ status: "failed", code: failure.code, message: failure.message }); return; }
      const body = (await response.json()) as { viewer: ComponentReviewViewer; membershipVerified: boolean; requests: Array<ComponentReviewRequest & { revision: number }> };
      setListing({ status: "loaded", at: Date.now(), viewer: body.viewer, membershipVerified: body.membershipVerified, requests: body.requests });
    } catch {
      if (mine === generation.current) setListing({ status: "failed", code: "NETWORK", message: "The review requests could not be read (network)." });
    }
    // [B19-E E5] the bound revisions' catalog status; a failed read leaves the last statuses (the server refuses stale rebinds)
    const revisionIds = [...new Set(componentsRef.current.map((component) => component.atomicPartRevisionId))].slice(0, 500);
    if (catalogStatus && revisionIds.length > 0 && fetchRef.current) {
      try {
        const response = await fetchRef.current(ATOMIC_REVISION_STATUS_ROUTE, { method: "POST", headers: { "content-type": "application/json", ...headersRef.current() }, body: JSON.stringify({ revisionIds }) });
        const body = response.ok ? ((await response.json()) as { statuses?: AtomicRevisionStatusView[] }) : null;
        if (mine === generation.current && Array.isArray(body?.statuses)) {
          const byRevision = Object.fromEntries(body.statuses.map((status) => [status.revisionId, status]));
          setStatuses(byRevision);
          // [B19-E E5 review] the effective approved binding of each component whose revision is not plainly published
          const withdrawn = [...new Set(componentsRef.current.filter((component) => byRevision[component.atomicPartRevisionId] && byRevision[component.atomicPartRevisionId]!.state !== "published").map((component) => component.id))];
          const effective: Record<string, string | null> = {};
          for (let start = 0; start < withdrawn.length; start += EFFECTIVE_SELECTION_BATCH) {
            const read = await post({ operation: "list_effective_atomic_selections", boardInstanceId, componentInstanceIds: withdrawn.slice(start, start + EFFECTIVE_SELECTION_BATCH) });
            const selections = read.ok ? ((await read.json()) as { selections?: Array<{ componentInstanceId: string; atomicPartRevisionId: string | null }> }).selections : null;
            for (const selection of selections ?? []) effective[selection.componentInstanceId] = selection.atomicPartRevisionId;
          }
          if (mine === generation.current) setEffectiveRevisions(effective);
        }
      } catch {
        // the status read is informational; the server decides every rebind
      }
    }
  }, [enabled, boardInstanceId, hasFetch, post, catalogStatus]);

  // Deferred one tick (like the manufacturing hydration) so the read never sets state synchronously inside the effect.
  useEffect(() => {
    const tick = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(tick);
  }, [refresh, refreshToken]);

  const rows = useMemo<ComponentReviewRow[]>(() => {
    const requests = listing.status === "loaded" ? listing.requests : [];
    return components.map((component) => {
      const matching = requests.filter((item) => item.componentInstanceId === component.id && item.atomicPartRevisionId === component.atomicPartRevisionId);
      // The governing request: an approved one wins, then a pending one, else the most recent decision.
      const request = matching.find((item) => item.status === "approved") ?? matching.find((item) => item.status === "pending") ?? matching.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))[0] ?? null;
      return { component, request, state: request?.status ?? "none" };
    });
  }, [components, listing]);

  const run = useCallback(async (label: string, operation: string, body: Record<string, unknown>, expected: number[]): Promise<boolean> => {
    if (busy) return false;
    setBusy(label);
    setLastError(null);
    try {
      const response = await post(body);
      if (!expected.includes(response.status)) {
        const failure = await readFailure(response, operation);
        setLastError(failure);
        onNotice?.(`${failure.message} (${failure.code})`);
        return false;
      }
      return true;
    } catch {
      const failure = { operation, code: "NETWORK", message: "The review action could not reach the server." };
      setLastError(failure); onNotice?.(failure.message);
      return false;
    } finally {
      setBusy(null);
      await refresh();
    }
  }, [busy, post, refresh, onNotice]);

  const request = useCallback(async (component: ReviewableComponent, reason?: string): Promise<boolean> => {
    if (!boardInstanceId) return false;
    return run(`request:${component.id}`, "request", reviewRequestBody(component, boardInstanceId, reason ?? `Exact binding review requested for ${component.refDes}`), [200, 201]);
  }, [boardInstanceId, run]);

  const requestAll = useCallback(async (reason?: string): Promise<{ requested: number; failed: number }> => {
    if (!boardInstanceId || !hasFetch || busy) return { requested: 0, failed: 0 };
    setBusy("request:all");
    setLastError(null);
    let requested = 0, failed = 0;
    try {
      for (const row of rows) {
        if (row.state === "approved" || row.state === "pending") continue;
        const response = await post(reviewRequestBody(row.component, boardInstanceId, reason ?? `Exact binding review requested for ${row.component.refDes}`));
        if (response.status === 200 || response.status === 201) requested += 1;
        else { failed += 1; setLastError(await readFailure(response, "request")); }
      }
    } finally {
      setBusy(null);
      await refresh();
    }
    if (failed > 0) onNotice?.(`Review requested for ${requested} component${requested === 1 ? "" : "s"}; ${failed} could not be requested.`);
    return { requested, failed };
  }, [boardInstanceId, hasFetch, busy, rows, post, refresh, onNotice]);

  const resolve = useCallback((requestId: string, decision: "approve" | "reject", reason: string): Promise<boolean> =>
    run(`resolve:${requestId}`, "resolve", { operation: "resolve_review_request", requestId, decision, reason }, [200]), [run]);

  const withdraw = useCallback((requestId: string, reason?: string): Promise<boolean> =>
    run(`withdraw:${requestId}`, "withdraw", { operation: "withdraw_review_request", requestId, reason: reason ?? "withdrawn by the requester" }, [200]), [run]);

  // [B19-E E5] preview the successor diff (a read); the preview's digest is what a rebind must name. [B19-E E5 review] only from the
  // component's effective approved binding, toward the first selectable revision of the successor chain
  const previewSuccessor = useCallback(async (component: ReviewableComponent): Promise<boolean> => {
    const status = statuses[component.atomicPartRevisionId];
    const successor = status?.selectableSuccessorRevisionId ?? status?.successorRevisionId;
    if (!boardInstanceId || !successor || busy || effectiveRevisions[component.id] !== component.atomicPartRevisionId) return false;
    setBusy(`preview:${component.id}`);
    setLastError(null);
    try {
      const response = await post({ operation: "preview_atomic_successor", componentInstanceId: component.id, boardInstanceId, fromRevisionId: component.atomicPartRevisionId, toRevisionId: successor });
      if (!response.ok) { const failure = await readFailure(response, "preview"); setLastError(failure); onNotice?.(`${failure.message} (${failure.code})`); return false; }
      const body = (await response.json()) as { preview: AtomicSuccessorPreview };
      setPreviews((current) => ({ ...current, [component.id]: body.preview }));
      return true;
    } catch {
      const failure = { operation: "preview", code: "NETWORK", message: "The successor preview could not reach the server." };
      setLastError(failure); onNotice?.(failure.message);
      return false;
    } finally {
      setBusy(null);
    }
  }, [boardInstanceId, statuses, effectiveRevisions, busy, post, onNotice]);

  // [B19-E E5] a reviewer's rebind: the previewed digest and a reason; the server recomputes the diff and refuses any drift
  const rebindSuccessor = useCallback(async (component: ReviewableComponent, reason: string): Promise<boolean> => {
    const preview = previews[component.id];
    if (!boardInstanceId || !preview) return false;
    const ok = await run(`rebind:${component.id}`, "rebind", { operation: "rebind_atomic_successor", componentInstanceId: component.id, boardInstanceId, fromRevisionId: preview.fromRevisionId, toRevisionId: preview.toRevisionId, diffDigest: preview.diffDigest, reason }, [200, 201]);
    if (ok) setPreviews((current) => { const next = { ...current }; delete next[component.id]; return next; });
    return ok;
  }, [boardInstanceId, previews, run]);

  const pendingCount = listing.status === "loaded" ? listing.requests.filter((item) => item.status === "pending").length : 0;

  return { listing, rows, pendingCount, busy, lastError, refresh, request, requestAll, resolve, withdraw, statuses, previews, effectiveRevisions, previewSuccessor, rebindSuccessor };
}
