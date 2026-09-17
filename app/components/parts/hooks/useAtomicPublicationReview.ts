"use client";

/**
 * [B19-E E4] The browser side of atomic publication review: a thin client over GET/POST /api/components/atomic/publication.
 *
 * The server decides everything — the governance project, roles and humans only (the viewer block is server-derived), the
 * evidence it assembles, whether approval and publication are allowed, and who may withdraw. This hook lists requests, sends
 * a person's request, decision, publication or withdrawal, and re-reads the durable result. Nothing is kept in browser
 * storage, and nothing sent carries a reviewer stamp, a source class or evidence.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ATOMIC_PUBLICATION_ROUTE, type AtomicFactDisposition, type AtomicPublicationLink, type AtomicPublicationRequestView, type AtomicPublicationResolution, type AtomicPublicationSpec, type AtomicPublicationViewer } from "@/app/lib/atomic/publication-review-contract";

export type AtomicPublicationListing =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; viewer: AtomicPublicationViewer; membershipVerified: boolean; requests: AtomicPublicationRequestView[] }
  | { status: "failed"; code: string; message: string };

export interface UseAtomicPublicationReviewInput {
  enabled: boolean;
  scopeHeaders(): Record<string, string>;
  fetchImpl?: typeof fetch;
  onNotice?(message: string): void;
  refreshToken?: number;
}

export interface AtomicPublicationResolveInput {
  requestId: string;
  decision: "approve" | "reject";
  reason: string;
  reviewEvidenceDigest?: string;
  resolutions?: AtomicPublicationResolution[];
  factDispositions?: Array<Pick<AtomicFactDisposition, "factId" | "disposition" | "note">>;
}

export interface UseAtomicPublicationReviewResult {
  listing: AtomicPublicationListing;
  busy: string | null;
  lastError: { operation: string; code: string; message: string; detail: string[] } | null;
  /** [B19-E E4 review] what an accepted action did not do (a request for a part that already has an open one) */
  notice: string | null;
  refresh(): Promise<void>;
  submit(input: { spec: AtomicPublicationSpec; links: AtomicPublicationLink[]; reason: string }): Promise<boolean>;
  resolve(input: AtomicPublicationResolveInput): Promise<boolean>;
  publish(requestId: string, reason: string): Promise<boolean>;
  withdraw(requestId: string, reason: string): Promise<boolean>;
  /** [B19-E E5] deprecate, supersede or revoke a published revision (a project administrator; the server checks the edge) */
  withdrawRevision(input: { revisionId: string; to: "deprecated" | "superseded" | "revoked"; successorRevisionId?: string; reason: string }): Promise<boolean>;
}

type Failure = { operation: string; code: string; message: string; detail: string[] };

const GOVERNANCE_WORDS = "Atomic catalog publication happens only in the catalog governance project.";
const ALREADY_OPEN_WORDS = "A request for this exact part and profile is already open with the same evidence; it is shown below. Nothing new was requested.";

async function readFailure(response: Response, operation: string): Promise<Failure> {
  const body = (await response.json().catch(() => null)) as { code?: unknown; error?: unknown; detail?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 80) : `HTTP_${response.status}`;
  const detail = Array.isArray(body?.detail) ? body!.detail.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 300)) : [];
  const message = code.startsWith("ATOMIC_PUBLICATION_GOVERNANCE") ? GOVERNANCE_WORDS
    : response.status === 403 ? "You do not have permission for this publication action."
    : typeof body?.error === "string" && body.error !== code ? body.error.slice(0, 300)
    : `The server refused the request (${code}).`;
  return { operation, code, message, detail };
}

export function useAtomicPublicationReview(input: UseAtomicPublicationReviewInput): UseAtomicPublicationReviewResult {
  const { enabled, refreshToken = 0, onNotice } = input;
  const fetchImpl = input.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  const [listing, setListing] = useState<AtomicPublicationListing>({ status: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  // callers may pass fresh functions on every render: read them through refs so `refresh` stays stable
  const headersRef = useRef(input.scopeHeaders);
  const fetchRef = useRef(fetchImpl);
  useEffect(() => { headersRef.current = input.scopeHeaders; fetchRef.current = fetchImpl; });
  const hasFetch = fetchImpl !== null;

  const refresh = useCallback(async (): Promise<void> => {
    const fetchFn = fetchRef.current;
    if (!enabled || !fetchFn) { setListing({ status: "idle" }); return; }
    const mine = ++generation.current;
    setListing((current) => (current.status === "loaded" ? current : { status: "loading" }));
    try {
      const response = await fetchFn(ATOMIC_PUBLICATION_ROUTE, { method: "GET", headers: { ...headersRef.current() } });
      if (mine !== generation.current) return;
      if (!response.ok) { const failure = await readFailure(response, "list"); setListing({ status: "failed", code: failure.code, message: failure.message }); return; }
      const body = (await response.json()) as { viewer: AtomicPublicationViewer; membershipVerified: boolean; requests: AtomicPublicationRequestView[] };
      setListing({ status: "loaded", viewer: body.viewer, membershipVerified: body.membershipVerified, requests: Array.isArray(body.requests) ? body.requests : [] });
    } catch {
      if (mine === generation.current) setListing({ status: "failed", code: "NETWORK", message: "The publication requests could not be read (network)." });
    }
  }, [enabled]);

  // deferred one tick so the read never sets state synchronously inside the effect
  useEffect(() => {
    if (!hasFetch) return;
    const tick = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(tick);
  }, [refresh, refreshToken, hasFetch]);

  const run = useCallback(async (label: string, operation: string, body: Record<string, unknown>, expected: number[]): Promise<boolean> => {
    const fetchFn = fetchRef.current;
    if (busy || !fetchFn) return false;
    setBusy(label);
    setLastError(null);
    setNotice(null);
    try {
      const response = await fetchFn(ATOMIC_PUBLICATION_ROUTE, { method: "POST", headers: { "content-type": "application/json", ...headersRef.current() }, body: JSON.stringify(body) });
      if (!expected.includes(response.status)) {
        const failure = await readFailure(response, operation);
        setLastError(failure);
        onNotice?.(`${failure.message} (${failure.code})`);
        return false;
      }
      // [B19-E E4 review] an accepted submit that created nothing says so, instead of silently showing the open request again
      if (operation === "submit") {
        const answer = (await response.json().catch(() => null)) as { created?: unknown } | null;
        if (answer?.created === false) { setNotice(ALREADY_OPEN_WORDS); onNotice?.(ALREADY_OPEN_WORDS); }
      }
      return true;
    } catch {
      const failure = { operation, code: "NETWORK", message: "The publication action could not reach the server.", detail: [] };
      setLastError(failure);
      onNotice?.(failure.message);
      return false;
    } finally {
      setBusy(null);
      await refresh();
    }
  }, [busy, refresh, onNotice]);

  const submit = useCallback((request: { spec: AtomicPublicationSpec; links: AtomicPublicationLink[]; reason: string }) =>
    run("submit", "submit", { operation: "submit_request", ...request.spec, links: request.links, reason: request.reason }, [200, 201]), [run]);

  const resolve = useCallback((request: AtomicPublicationResolveInput) =>
    run(`resolve:${request.requestId}`, "resolve", { operation: "resolve_request", requestId: request.requestId, decision: request.decision, reason: request.reason, ...(request.decision === "approve" ? { reviewEvidenceDigest: request.reviewEvidenceDigest, resolutions: request.resolutions ?? [], factDispositions: request.factDispositions ?? [] } : {}) }, [200]), [run]);

  const publish = useCallback((requestId: string, reason: string) =>
    run(`publish:${requestId}`, "publish", { operation: "publish_request", requestId, reason }, [200]), [run]);

  const withdraw = useCallback((requestId: string, reason: string) =>
    run(`withdraw:${requestId}`, "withdraw", { operation: "withdraw_request", requestId, reason }, [200]), [run]);

  const withdrawRevision = useCallback((input: { revisionId: string; to: "deprecated" | "superseded" | "revoked"; successorRevisionId?: string; reason: string }) =>
    run(`withdraw-revision:${input.revisionId}`, "withdraw-revision", { operation: "withdraw_revision", revisionId: input.revisionId, to: input.to, ...(input.successorRevisionId ? { successorRevisionId: input.successorRevisionId } : {}), reason: input.reason }, [200]), [run]);

  return { listing, busy, lastError, notice, refresh, submit, resolve, publish, withdraw, withdrawRevision };
}
