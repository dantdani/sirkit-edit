// @vitest-environment jsdom
/**
 * B09.2 §G — provider failure recovery proven through PRODUCTION code
 * (`app/lib/agent/run-consumer.ts`, the exact module page.tsx delegates
 * to), not a test-local reimplementation.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { AiProviderFailureDetail } from "../../ai-preferences";
import { isRecoverableProviderFailure, performProviderSwitch, resolveProviderSwitch, settleAgentRunFailure } from "../run-consumer";

const AI_PROVIDER_FAILURE_EVENT = "sirkit:ai-provider-failure";

function captureFailureEvents(): { detail: () => AiProviderFailureDetail | null; dispose: () => void } {
  let captured: AiProviderFailureDetail | null = null;
  const listener = (event: Event) => { captured = (event as CustomEvent<AiProviderFailureDetail>).detail; };
  window.addEventListener(AI_PROVIDER_FAILURE_EVENT, listener);
  return { detail: () => captured, dispose: () => window.removeEventListener(AI_PROVIDER_FAILURE_EVENT, listener) };
}

describe("B09.2 §G — production run-failure settlement", () => {
  const disposers: Array<() => void> = [];
  afterEach(() => { while (disposers.length) disposers.pop()!(); });

  it("classification: every provider_* reason except provider_cancelled is recoverable; cancellation/deadline/internal reasons are not", () => {
    for (const reason of ["provider_insufficient_quota", "provider_rate_limited", "provider_http_500", "provider_network"]) {
      expect(isRecoverableProviderFailure(reason), reason).toBe(true);
    }
    for (const reason of ["provider_cancelled", "cancelled", "deadline", "toolset_invalid", "internal_error"]) {
      expect(isRecoverableProviderFailure(reason), reason).toBe(false);
    }
  });

  it("a REAL recoverable provider failure on the CURRENT run dispatches the owned recovery event, and its retry starts a NEW run", () => {
    const capture = captureFailureEvents();
    disposers.push(capture.dispose);
    const runs: string[] = [];
    const settlement = settleAgentRunFailure({
      reason: "provider_insufficient_quota",
      provider: "openai",
      ownership: { isCurrent: () => true },
      startNewRun: () => runs.push("new-run"),
    });
    expect(settlement.recovered).toBe(true);
    const detail = capture.detail();
    expect(detail).not.toBeNull();
    expect(detail!.provider).toBe("openai");
    // Retry is the injected NEW-run starter (fresh scope + fresh AbortController at the call site).
    expect(detail!.retry).toBeDefined();
    detail!.retry!();
    expect(runs).toEqual(["new-run"]);
  });

  it("a STALE run settles nothing — no card, no retry", () => {
    const capture = captureFailureEvents();
    disposers.push(capture.dispose);
    const settlement = settleAgentRunFailure({
      reason: "provider_insufficient_quota",
      provider: "anthropic",
      ownership: { isCurrent: () => false },
      startNewRun: () => { throw new Error("must never run"); },
    });
    expect(settlement.recovered).toBe(false);
    expect(capture.detail()).toBeNull();
  });

  it("cancelled and deadline terminations recover NOTHING even when current", () => {
    const capture = captureFailureEvents();
    disposers.push(capture.dispose);
    for (const reason of ["cancelled", "provider_cancelled", "deadline"]) {
      const settlement = settleAgentRunFailure({
        reason, provider: "openai",
        ownership: { isCurrent: () => true },
        startNewRun: () => { throw new Error("must never run"); },
      });
      expect(settlement.recovered, reason).toBe(false);
    }
    expect(capture.detail()).toBeNull();
  });

  it("Switch selects the alternative provider BEFORE the new run starts, and the new run observes the selection", () => {
    const order: string[] = [];
    let selected: string | null = null;
    const next = performProviderSwitch("openai", {
      selectProvider: (provider) => { order.push(`select:${provider}`); selected = provider; },
      startNewRun: () => order.push(`run-with:${selected}`),
    });
    expect(next).toBe("anthropic");
    expect(order).toEqual(["select:anthropic", "run-with:anthropic"]);
    expect(resolveProviderSwitch("anthropic")).toBe("openai");
    // A missing retry handle (no prior message) still performs the selection without throwing.
    const selections: string[] = [];
    expect(performProviderSwitch("anthropic", { selectProvider: (provider) => selections.push(provider), startNewRun: null })).toBe("openai");
    expect(selections).toEqual(["openai"]);
  });
});
