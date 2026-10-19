/**
 * [PR-M, 2026-10-18] Section M2 (design M2.2): the `kicad-bundled` adapter - the official KiCad libraries at the reviewed pinned commits,
 * read from the operator's local checkout under `data/` through the SAME reader the publication authoring uses (`bundledKicadLibrary`:
 * one file per reference, never outside its directory, the ingest byte bound). ZERO network: no egress import.
 *
 * Before any read the checkout's HEAD must be the pinned commit (`KICAD_LIBRARY_PINS`; the operator scripts make and verify it,
 * pinned-checkout.ts); otherwise every request is `checkout_not_pinned` - a checkout at another commit would make the recorded revision
 * untrue. The bytes are the working tree's bytes (their line endings follow the operator's git configuration and are recorded).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { bundledKicadLibrary, type BundledKicadLibrary } from "../../atomic/authoring";
import { sha256 } from "../../atomic/stable";
import { KICAD_LIBRARY_PINS } from "../../kicad/pinned-checkout";
import { CAD_SOURCE_REGISTRY, CAD_SOURCE_REGISTRY_VERSION, cadAssetPolicy } from "../cad-source-registry";
import { recordCadSourceOutcome, requestCadSourceAdmission, type AdmissionPurpose, type CadSourceMeterPolicy } from "../admission-control"; // [PR-L/M integration, 2026-10-18] M2-SEC-9: the row's quota is metered (no network: the meter is process state)
import type { CadAssetRequest, CadRetrieveOutcome, CadSourceAdapter } from "./types";

/** The commit a local checkout's HEAD names (a detached HEAD, a loose ref or a packed ref), or null. */
export function libraryHeadCommit(directory: string): string | null {
  try {
    const gitDir = path.join(directory, ".git");
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (refs\/[A-Za-z0-9._/-]+)$/.exec(head)?.[1];
    if (!ref || ref.includes("..")) return null;
    const loose = path.join(gitDir, ...ref.split("/"));
    if (existsSync(loose)) {
      const value = readFileSync(loose, "utf8").trim();
      return /^[0-9a-f]{40}$/.test(value) ? value : null;
    }
    const packed = readFileSync(path.join(gitDir, "packed-refs"), "utf8").split(/\r?\n/).find((line) => line.endsWith(` ${ref}`));
    const value = packed?.split(" ")[0] ?? "";
    return /^[0-9a-f]{40}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export interface BundledAdapterOptions { root?: string; library?: BundledKicadLibrary; clock?: () => number; head?: (directory: string) => string | null; /** [PR-L/M integration, 2026-10-18] the meter purpose (OD-40); a person by default */ purpose?: AdmissionPurpose }

export function createBundledCadAdapter(options: BundledAdapterOptions = {}): CadSourceAdapter {
  const root = options.root ?? process.cwd();
  const library = options.library ?? bundledKicadLibrary(root);
  const clock = options.clock ?? Date.now;
  const head = options.head ?? libraryHeadCommit;
  const entry = CAD_SOURCE_REGISTRY["kicad-bundled"];
  // [PR-L/M integration, 2026-10-18] M2-SEC-9: the row's declared bound (quota.requestsPerMinute, "to keep one task from monopolising the
  // server") is METERED like a network source's: one admission per file read, at the caller's purpose share (OD-40), a spent window a PAUSE
  // with its retry time (the task schedules it); the read's outcome settles the meter (a missing file is neutral)
  const purpose = options.purpose ?? "interactive";
  const key = { kind: "cad-source" as const, sourceId: entry.id };
  const meter: CadSourceMeterPolicy = { displayName: entry.displayName, requestsPerMinute: entry.quota.requestsPerMinute, consecutiveFailuresToOpen: entry.resilience.breaker.consecutiveFailuresToOpen, openMs: entry.resilience.breaker.openMs };
  return {
    sourceId: "kicad-bundled",
    transport: "local-pinned-checkout",
    async retrieve(request: CadAssetRequest): Promise<CadRetrieveOutcome> {
      if (request.signal?.aborted) return { ok: false, code: "aborted", message: "the retrieval was cancelled" };
      const policy = cadAssetPolicy(entry, request.kind);
      if (!policy.accepted) return { ok: false, code: "kind_refused", message: `${entry.displayName} does not provide ${request.kind} assets: ${policy.refusal}` };
      const which = request.kind === "symbol" ? "symbols" : "footprints";
      const pin = KICAD_LIBRARY_PINS[which].commit;
      const directory = path.join(root, "data", request.kind === "symbol" ? "kicad-symbols" : "kicad-footprints");
      if (!existsSync(directory)) return { ok: false, code: "checkout_unavailable", message: `the pinned KiCad ${which} checkout is not present on this server (data/ is operator data; pnpm ingest:kicad makes it)` };
      const at = head(directory);
      if (at !== pin) return { ok: false, code: "checkout_not_pinned", message: `the local KiCad ${which} checkout is not at the reviewed pinned commit ${pin.slice(0, 12)}; nothing was read` };
      if (!request.library) return { ok: false, code: "path_refused", message: "a KiCad asset is named library:name" };
      const admitted = requestCadSourceAdmission(key, meter, clock(), purpose);
      if (!admitted.allowed) return { ok: false, code: admitted.reason === "breaker_open" ? "breaker_open" : "quota_exhausted", message: admitted.message, retryAtMs: admitted.retryAtMs };
      const text = request.kind === "symbol" ? library.symbol(request.library, request.name) : library.footprint(request.library, request.name);
      recordCadSourceOutcome(key, meter, text === null ? "neutral" : "success", clock());
      if (text === null) return { ok: false, code: "not_found", message: `${request.kind} ${request.library}:${request.name} is not in the pinned KiCad ${which} checkout` };
      const byteLength = Buffer.byteLength(text, "utf8");
      if (byteLength > policy.maxBytes) return { ok: false, code: "response_too_large", message: `${request.kind} ${request.library}:${request.name} is larger than ${policy.maxBytes} bytes` };
      const locator = request.kind === "symbol" ? `data/kicad-symbols/${request.library}.kicad_symdir/${request.name}.kicad_sym` : `data/kicad-footprints/${request.library}.pretty/${request.name}.kicad_mod`;
      return { ok: true, object: { kind: request.kind, sourceId: "kicad-bundled", registryVersion: CAD_SOURCE_REGISTRY_VERSION, library: request.library, name: request.name, locator, ref: pin, text, sha256: sha256(text), byteLength, mediaType: request.kind === "symbol" ? "application/x-kicad-symbol" : "application/x-kicad-footprint", retrievedAt: new Date(clock()).toISOString() } };
    },
  };
}
