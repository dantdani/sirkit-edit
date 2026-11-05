/**
 * [PR-M, 2026-10-18] Section M2 (design M2.2): the one shape every CAD source adapter answers - one asset, its exact text and its
 * provenance, or a closed refusal (with the retry time a rate limit or an open breaker gives). Browser-safe types only.
 */
import type { CadEgressFailureCode } from "../cad-egress";
import type { CadAssetKind, CadSourceId } from "../cad-source-registry";

export interface CadAssetRequest {
  kind: Exclude<CadAssetKind, "model">;
  /** the KiCad library (a symbol or footprint); null for a datasheet */
  library: string | null;
  name: string;
  signal?: AbortSignal;
}

export interface CadRetrieval {
  kind: CadAssetRequest["kind"];
  sourceId: CadSourceId;
  registryVersion: string;
  library: string | null;
  name: string;
  /** origin + path (network) or the checkout path (local); never a query string */
  locator: string;
  /** the pinned commit read (null for a datasheet text without one) */
  ref: string | null;
  text: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  retrievedAt: string;
}

export type CadAdapterFailureCode = CadEgressFailureCode | "checkout_unavailable" | "checkout_not_pinned";
export type CadRetrieveOutcome = { ok: true; object: CadRetrieval } | { ok: false; code: CadAdapterFailureCode; message: string; retryAtMs?: number };

export interface CadSourceAdapter {
  readonly sourceId: CadSourceId;
  /** network: requests go through `cad-egress.ts`; local: a file read */
  readonly transport: "local-pinned-checkout" | "https";
  retrieve(request: CadAssetRequest): Promise<CadRetrieveOutcome>;
}
