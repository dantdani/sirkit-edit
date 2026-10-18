/**
 * [PR-M, 2026-10-18] Section M2 (design M2.2, M2.7): the adapters of the two NETWORK CAD sources, both through `cad-egress.ts` (the
 * bounded egress path) and nothing else:
 *
 *  - `fixture-kicad`: the fixture host, admitted only when the composition root states the fixture runtime (or a test injects it);
 *    its transport is app/lib/fixture-runtime/cad-source/transport.ts (real committed bytes);
 *  - `kicad-gitlab`: gitlab.com's repository-files API at the pinned refs. Written so the reviewed shape exists, but its registry row
 *    is BLOCKED (OD-M2-3): `fetchCadAsset` refuses it before any request, whatever the environment. It is never called.
 */
import { KICAD_LIBRARY_PINS } from "../../kicad/pinned-checkout";
import { fetchCadAsset, type CadEgressDeps } from "../cad-egress";
import type { CadSourceId } from "../cad-source-registry";
import type { CadAssetRequest, CadRetrieveOutcome, CadSourceAdapter } from "./types";

function networkAdapter(sourceId: Extract<CadSourceId, "fixture-kicad" | "kicad-gitlab">, deps: CadEgressDeps): CadSourceAdapter {
  return {
    sourceId,
    transport: "https",
    async retrieve(request: CadAssetRequest): Promise<CadRetrieveOutcome> {
      const ref = request.kind === "symbol" ? KICAD_LIBRARY_PINS.symbols.commit : request.kind === "footprint" ? KICAD_LIBRARY_PINS.footprints.commit : undefined;
      const outcome = await fetchCadAsset(sourceId, { kind: request.kind, values: { ...(request.library ? { library: request.library } : {}), name: request.name, ...(ref ? { ref } : {}) }, ...(request.signal ? { signal: request.signal } : {}) }, deps);
      if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message, ...(outcome.retryAtMs !== undefined ? { retryAtMs: outcome.retryAtMs } : {}) };
      return { ok: true, object: { kind: request.kind, sourceId, registryVersion: outcome.registryVersion, library: request.library, name: request.name, locator: outcome.url, ref: request.kind === "datasheet" ? null : ref ?? null, text: outcome.text, sha256: outcome.sha256, byteLength: outcome.byteLength, mediaType: outcome.contentType, retrievedAt: outcome.retrievedAt } };
    },
  };
}

/** The fixture source's adapter over an injected transport (the fixture runtime's, or a test's). */
export function createFixtureCadAdapter(deps: CadEgressDeps & { fetch: typeof fetch; resolve: (hostname: string) => Promise<string[]> }): CadSourceAdapter {
  return networkAdapter("fixture-kicad", deps);
}

/** The gitlab.com adapter. Its row is blocked (OD-M2-3): every request is refused by admission before anything is sent. */
export function createGitlabCadAdapter(deps: CadEgressDeps = {}): CadSourceAdapter {
  return networkAdapter("kicad-gitlab", deps);
}
