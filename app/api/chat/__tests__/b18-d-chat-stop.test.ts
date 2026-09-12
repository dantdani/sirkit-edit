/**
 * [B18-D I9] Stop (chat-execution-ux.md §8 I9): the page's Stop cancels the chat response's reader and carries nothing.
 * Driven through the PRODUCTION POST handler: cancelling the response body aborts the route's run controller (the
 * stream's `cancel()`), the REAL agent loop — waiting on a provider that never answers — ends `cancelled`, the provider's
 * signal is aborted, and the loop's `finally` retires the run's still-issued explicit grants
 * (`retireIssued("run_cancelled", true)`). The one test seam is the grant minter: this unit environment mints no grants,
 * so the loop receives a recording minter; everything between the body's cancel and the retirement is production code.
 */
import { describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";

const state = vi.hoisted(() => ({
  providerStarted: false,
  providerSignalAborted: false,
  result: null as null | { status: string },
  retired: [] as Array<[string, boolean]>,
}));

vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    start(input: { signal?: AbortSignal }) {
      state.providerStarted = true;
      input.signal?.addEventListener("abort", () => { state.providerSignalAborted = true; }, { once: true });
      return new Promise(() => { /* never answers: only Stop ends this run */ });
    },
    async continueWith() { throw new Error("not used"); },
  }),
}));

vi.mock("@/app/lib/agent/loop", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/loop")>();
  return {
    ...original,
    runAgentLoop: async (request: Parameters<typeof original.runAgentLoop>[0], deps: Parameters<typeof original.runAgentLoop>[1]) => {
      const minter = {
        async mint() { throw new Error("not used"); },
        async awaitSettlement() { throw new Error("not used"); },
        async retireIssued(reason: string, onlyExplicit: boolean) { state.retired.push([reason, onlyExplicit]); return []; },
      } as unknown as NonNullable<typeof deps.executionGrants>;
      const result = await original.runAgentLoop(request, { ...deps, executionGrants: minter });
      state.result = result;
      return result;
    },
  };
});

import { POST } from "../route";

const SCOPE = { tenantId: "local", projectId: "p111", branchId: "main" };
const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };

describe("B18-D I9 — Stop: cancelling the chat response cancels the run", () => {
  it("the body's cancel aborts the run; the real loop ends cancelled and retires its still-issued explicit grants", async () => {
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai", messages: [{ role: "user", content: "hello" }], scope: SCOPE, schematicState: SCHEMATIC }),
    }));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"run_started"')) {
      const { done, value } = await reader.read();
      expect(done, "the run starts before Stop").toBe(false);
      text += decoder.decode(value, { stream: true });
    }
    await vi.waitFor(() => expect(state.providerStarted).toBe(true));
    expect(state.result).toBeNull(); // the run is waiting on the provider
    expect(state.retired).toEqual([]);

    await reader.cancel(); // what the page's Stop does — it carries nothing

    await vi.waitFor(() => expect(state.result).not.toBeNull());
    expect(state.result).toMatchObject({ status: "cancelled" });
    expect(state.providerSignalAborted).toBe(true);
    expect(state.retired).toEqual([["run_cancelled", true]]);
  });
});
