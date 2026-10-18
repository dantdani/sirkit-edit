/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4: the FIXTURE runtime's model and catalog ports for the durable generation worker (the
 * slices of `app/lib/generation-task/worker/slices.ts`), so the browser proofs run the REAL task lifecycle - start, worker claim, plan,
 * block, merge, review - with zero credits and no database.
 *
 * Truth boundary: like the request-lifetime fixture (`build-loop.ts`: "the recorded blinker design is the provider's answer"), every
 * design request is answered with the RECORDED blinker design, never a design made for the request. The difference is only how it
 * arrives: here a scripted provider answers the slice core's real turns as a model would - the planner call gets no decomposition
 * (the router's fixture answer), the first build turn searches the fixture catalog for the five recorded parts, the next submits the
 * recorded netlist referencing the partIds those searches surfaced - so the slice core's own submission validation, ERC gate,
 * checkpoints and the merge run unchanged. Each scripted call takes `FIXTURE_GENERATION_TURN_MS` (an abort ends it at once), so a
 * browser can observe a running design; the calls are labelled `fixture-provider` and send nothing anywhere.
 *
 * Reachable only under the fixture runtime (`fixtureContainer()` throws otherwise).
 */
import { BLINKER_NETLIST } from "./blinker/catalog";
import { fixtureContainer } from "./container";
import { EMBEDDING_MODEL } from "../embeddings";
import type { LLMMessage, LLMRequest, LLMResponse, LLMToolCall } from "../llm/types";
import type { AiPartResult } from "../parts-search";
import type { BuildCatalogPort, BuildLlmPort } from "../schematic/build-loop-slice";

/** How long one scripted provider call takes (a model turn is never instant; a browser proof can see a running design). */
export const FIXTURE_GENERATION_TURN_MS = 1_000;
export const FIXTURE_GENERATION_MODEL = "fixture-provider";

/** The searches the scripted provider makes before it submits: one per recorded part (query, catalog category). */
export const FIXTURE_GENERATION_SEARCHES = Object.freeze([
  { query: "NE555 timer SOIC-8", category: "Timer" },
  { query: "0805 resistor", category: "Resistor" },
  { query: "0805 capacitor", category: "Capacitor" },
  { query: "0805 LED", category: "LED" },
  { query: "2-pin 2.54 mm header connector", category: "Connector" },
] as const);

const wait = (ms: number, signal: AbortSignal | undefined): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason instanceof Error ? signal.reason : new Error("FIXTURE_PROVIDER_ABORTED")); return; }
  const handle = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = (): void => { clearTimeout(handle); reject(signal?.reason instanceof Error ? signal.reason : new Error("FIXTURE_PROVIDER_ABORTED")); };
  signal?.addEventListener("abort", onAbort, { once: true });
});

const toolCallsOf = (messages: readonly LLMMessage[], name: string): number => messages.reduce((sum, message) => sum + (message.role === "assistant" && Array.isArray(message.content) ? message.content.filter((part) => part.type === "tool_call" && part.name === name).length : 0), 0);

/** The scripted provider's answer to one request, from the conversation alone (deterministic; no state of its own). */
export function fixtureGenerationAnswer(request: LLMRequest): LLMResponse {
  const base = { provider: request.provider, model: FIXTURE_GENERATION_MODEL, text: "", usage: { inputTokens: 0, outputTokens: 0 } };
  const choice = request.toolChoice;
  // the planner: no decomposition (the router's fixture answer), so the request is designed as one circuit
  if (typeof choice === "object" && choice !== null && choice.name === "submit_plan") return { ...base, toolCalls: [], stopReason: "end_turn" };
  const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
  if (toolCallsOf(request.messages, "search_parts") === 0) {
    const toolCalls: LLMToolCall[] = FIXTURE_GENERATION_SEARCHES.map((search, index) => ({ id: `fixture-t${turn}-search-${index + 1}`, name: "search_parts", input: { query: search.query, category: search.category } }));
    return { ...base, toolCalls, stopReason: "tool_use" };
  }
  const netlist = structuredClone(BLINKER_NETLIST);
  return { ...base, toolCalls: [{ id: `fixture-t${turn}-submit`, name: "submit_schematic", input: { components: netlist.components, connections: netlist.connections, explanation: netlist.explanation } }], stopReason: "tool_use" };
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
      return scored.slice(0, Math.max(0, limit)).map((entry) => aiPartOf(entry.part, Math.min(1, entry.score / Math.max(1, words.length))));
    },
    async findAlternates() { return []; },
    async partsByIds(ids) {
      const parts = fixtureContainer().catalog.cachedParts;
      return [...new Set(ids)].flatMap((id) => { const part = parts.get(id); return part ? [aiPartOf(part, 1)] : []; });
    },
  };
}
