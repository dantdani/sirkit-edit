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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentReviewRequest, ComponentReviewStatus } from "@/app/lib/physical-binding/review-handoff";

export interface ReviewableComponent { id: string; refDes: string; atomicPartRevisionId: string }

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
}

type Failure = { operation: string; code: string; message: string };

async function readFailure(response: Response, operation: string): Promise<Failure> {
  const body = (await response.json().catch(() => null)) as { code?: string; error?: string } | null;
  const code = body?.code ?? `HTTP_${response.status}`;
  const message = response.status === 403 ? "You do not have permission for this review action." : response.status === 409 ? "The review request changed on the server — refresh and look again." : body?.error && body.error !== code ? body.error : `The server refused the request (${code}).`;
  return { operation, code, message };
}

export function useComponentReview(input: UseComponentReviewInput): UseComponentReviewResult {
  const { enabled, boardInstanceId, components, refreshToken = 0, onNotice } = input;
  const fetchImpl = input.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  const [listing, setListing] = useState<ComponentReviewListing>({ status: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<Failure | null>(null);
  const generation = useRef(0);
  // Callers may pass a fresh `scopeHeaders` / `fetchImpl` on every render; read
  // them through refs so `refresh` stays stable and the mount effect runs once
  // per (enabled, board, refreshToken) — never once per render.
  const headersRef = useRef(input.scopeHeaders);
  const fetchRef = useRef(fetchImpl);
  useEffect(() => { headersRef.current = input.scopeHeaders; fetchRef.current = fetchImpl; });
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
  }, [enabled, boardInstanceId, hasFetch, post]);

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
    return run(`request:${component.id}`, "request", { operation: "request_atomic_review", componentInstanceId: component.id, boardInstanceId, atomicPartRevisionId: component.atomicPartRevisionId, reason: reason ?? `Exact binding review requested for ${component.refDes}` }, [200, 201]);
  }, [boardInstanceId, run]);

  const requestAll = useCallback(async (reason?: string): Promise<{ requested: number; failed: number }> => {
    if (!boardInstanceId || !hasFetch || busy) return { requested: 0, failed: 0 };
    setBusy("request:all");
    setLastError(null);
    let requested = 0, failed = 0;
    try {
      for (const row of rows) {
        if (row.state === "approved" || row.state === "pending") continue;
        const response = await post({ operation: "request_atomic_review", componentInstanceId: row.component.id, boardInstanceId, atomicPartRevisionId: row.component.atomicPartRevisionId, reason: reason ?? `Exact binding review requested for ${row.component.refDes}` });
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

  const pendingCount = listing.status === "loaded" ? listing.requests.filter((item) => item.status === "pending").length : 0;

  return { listing, rows, pendingCount, busy, lastError, refresh, request, requestAll, resolve, withdraw };
}
