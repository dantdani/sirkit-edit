/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4: the FIXTURE runtime's model and catalog ports for the durable generation worker (the
 * slices of `app/lib/generation-task/worker/slices.ts`), so the browser proofs run the REAL task lifecycle - start, worker claim, plan,
 * block, merge, review - with zero credits and no database.
 *
 * Truth boundary: the request-lifetime fixture (`build-loop.ts`) still answers with the recorded blinker design; this port does not.
 * [PR-L6, 2026-10-19] Runbook L.7 items 9-10: its scripted provider (`generation-policy.ts`, recipes in `generation-recipes.ts`) designs
 * by the request's FEATURES - a drone with one to four motors as four planned blocks, a 555 PWM LED dimmer, the 555 LED blinker (the
 * recorded design, transcribed exactly) - from the parts its searches of the fixture catalog actually return; a request with no recipe
 * gets text replies only, never an invented circuit. The slice core's own submission validation, ERC gate, checkpoints and the merge
 * run unchanged. Each scripted call takes `FIXTURE_GENERATION_TURN_MS` (an abort ends it at once), so a browser can observe a running
 * design; the calls are labelled `fixture-provider` and send nothing anywhere. Its search results carry the published authority facts
 * production's search attaches (`orderableValues`, `physicalAuthority`, `verifiedFootprint`).
 *
 * Reachable only under the fixture runtime (`fixtureContainer()` throws otherwise).
 */
import { fixtureContainer } from "./container";
import { scriptedGenerationTurn } from "./generation-policy"; // [PR-L6, 2026-10-19] the scripted provider's engine
import { BLINKER_SEARCHES } from "./generation-recipes";
import { EMBEDDING_MODEL } from "../embeddings";
import type { LLMRequest, LLMResponse } from "../llm/types";
import type { CachedPart } from "../parts-cache";
import type { AiPartResult } from "../parts-search";
import type { BuildCatalogPort, BuildLlmPort } from "../schematic/build-loop-slice";

/** How long one scripted provider call takes (a model turn is never instant; a browser proof can see a running design). */
export const FIXTURE_GENERATION_TURN_MS = 1_000;
export const FIXTURE_GENERATION_MODEL = "fixture-provider";

/** The blinker's recorded searches (query, catalog category): the first query of each blinker recipe role, in order. */
export const FIXTURE_GENERATION_SEARCHES = BLINKER_SEARCHES;

const wait = (ms: number, signal: AbortSignal | undefined): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason instanceof Error ? signal.reason : new Error("FIXTURE_PROVIDER_ABORTED")); return; }
  const handle = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = (): void => { clearTimeout(handle); reject(signal?.reason instanceof Error ? signal.reason : new Error("FIXTURE_PROVIDER_ABORTED")); };
  signal?.addEventListener("abort", onAbort, { once: true });
});

/** The scripted provider's answer to one request, from the conversation alone (deterministic; no state of its own): the engine of
 *  `generation-policy.ts` over the recipes of `generation-recipes.ts`. */
export function fixtureGenerationAnswer(request: LLMRequest): LLMResponse {
  const turn = scriptedGenerationTurn(request);
  return { provider: request.provider, model: FIXTURE_GENERATION_MODEL, text: turn.text, toolCalls: turn.toolCalls, stopReason: turn.stopReason, usage: { inputTokens: 0, outputTokens: 0 } };
}

/** The scripted provider (fixture runtime only). */
export function fixtureGenerationLlmPort(turnMs: number = FIXTURE_GENERATION_TURN_MS): BuildLlmPort {
  return {
    async generate(request) {
      fixtureContainer(); // refuses outside the fixture runtime
      await wait(turnMs, request.signal);
      return fixtureGenerationAnswer(request);
    },
  };
}

function aiPartOf(part: { id: string; name: string; mpn: string | null; description: string | null; mainCategory: string; pins: ReadonlyArray<{ number: string; name: string; type: string }> }, similarity: number): AiPartResult {
  return { partId: part.id, name: part.name, mpn: part.mpn, description: part.description, mainCategory: part.mainCategory, pins: part.pins.map((pin) => ({ number: pin.number, name: pin.name, type: pin.type })), lifecycleStatus: "unknown", similarity };
}

/** [PR-L6, 2026-10-19] The published authority a SEARCH result carries, exactly as production's search attaches it (parts-search.ts
 *  `attachOrderableValues`): a part with an approved link to a selectable (here: not withdrawn) revision is `physicalAuthority`
 *  "verified" with that link's footprint, and its value-specific link keys ('' - the value-agnostic default - excluded), sorted, are
 *  its `orderableValues`. A part with no such link carries none of the three fields. (`partsByIds` stays without them, as production's
 *  `getPartsByIds` is.) */
export function fixtureSearchAuthority(part: Pick<CachedPart, "atomicAssignments" | "withdrawnValueKeys">): Pick<AiPartResult, "orderableValues" | "physicalAuthority" | "verifiedFootprint"> {
  const withdrawn = new Set(part.withdrawnValueKeys ?? []);
  const links = Object.entries(part.atomicAssignments ?? {}).filter(([key, link]) => link?.approved === true && !withdrawn.has(key));
  if (links.length === 0) return {};
  const values = links.map(([key]) => key).filter((key) => key !== "");
  return { physicalAuthority: "verified", verifiedFootprint: links[0]![1].footprintFullName, ...(values.length ? { orderableValues: [...values].sort() } : {}) };
}

/** The committed blinker catalog as a searchable catalog: a part matches when it is in the requested category (when one is named) and
 *  shares a query word with its name, MPN, description or category; the best word overlap first. No embedding, no reranker. */
export function fixtureGenerationCatalogPort(): BuildCatalogPort {
  return {
    identity: { catalogProfile: "fixture-blinker", embeddingModel: EMBEDDING_MODEL },
    async searchParts(query, category, limit) {
      const parts = [...fixtureContainer().catalog.cachedParts.values()];
      const words = query.toLowerCase().split(/[^a-z0-9.]+/).filter((word) => word.length > 1);
      const wanted = typeof category === "string" && category.trim() ? category.trim().toLowerCase() : null;
      const scored = parts
        .filter((part) => wanted === null || part.mainCategory.toLowerCase() === wanted)
        .map((part) => {
          const haystack = `${part.name} ${part.mpn ?? ""} ${part.description ?? ""} ${part.mainCategory}`.toLowerCase();
          return { part, score: words.filter((word) => haystack.includes(word)).length };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || (a.part.id < b.part.id ? -1 : 1));
      return scored.slice(0, Math.max(0, limit)).map((entry) => ({ ...aiPartOf(entry.part, Math.min(1, entry.score / Math.max(1, words.length))), ...fixtureSearchAuthority(entry.part) })); // [PR-L6, 2026-10-19] + the published authority facts
    },
    async findAlternates() { return []; },
    async partsByIds(ids) {
      const parts = fixtureContainer().catalog.cachedParts;
      return [...new Set(ids)].flatMap((id) => { const part = parts.get(id); return part ? [aiPartOf(part, 1)] : []; });
    },
  };
}
