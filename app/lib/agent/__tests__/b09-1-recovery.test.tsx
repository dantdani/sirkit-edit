// @vitest-environment jsdom
/**
 * B09.1 §3 — provider-failure recovery restoration: the NDJSON
 * `run_failed provider_*` path dispatches the SAME owned global
 * provider-failure event the legacy JSON path uses (B07.5 ownership
 * preserved), so the existing Retry / Use-other-provider card reappears.
 * Stale owners dispatch nothing; stale retry closures are inert; retries
 * are NEW runs (fresh callbacks), never replays.
 */

import { describe, expect, it } from "vitest";
import { dispatchAiProviderFailure, type AiProviderFailureDetail } from "../../ai-preferences";

function listen(): { events: AiProviderFailureDetail[]; dispose(): void } {
  const events: AiProviderFailureDetail[] = [];
  const listener = (event: Event): void => {
    events.push((event as CustomEvent<AiProviderFailureDetail>).detail);
  };
  window.addEventListener("sirkit:ai-provider-failure", listener);
  return { events, dispose: () => window.removeEventListener("sirkit:ai-provider-failure", listener) };
}

describe("B09.1 §3 — owned provider-failure recovery", () => {
  it("a current-owner provider failure dispatches the recovery event with provider + owned retry (OpenAI and Anthropic)", () => {
    const { events, dispose } = listen();
    let retried = 0;
    for (const provider of ["openai", "anthropic"] as const) {
      dispatchAiProviderFailure({ provider, retry: () => { retried += 1; }, ownership: { isCurrent: () => true } });
    }
    dispose();
    expect(events.map((event) => event.provider)).toEqual(["openai", "anthropic"]);
    // The page listener uses these to render the Retry / switch card.
    expect(events.every((event) => typeof event.retry === "function")).toBe(true);
    expect(events.every((event) => event.stillCurrent?.() === true)).toBe(true);
    events[0]!.retry!();
    expect(retried).toBe(1); // retry fires a NEW send() run in the page
  });

  it("a STALE owner dispatches NOTHING (no card, no retry installed)", () => {
    const { events, dispose } = listen();
    dispatchAiProviderFailure({ provider: "openai", retry: () => { throw new Error("must not run"); }, ownership: { isCurrent: () => false } });
    dispose();
    expect(events).toEqual([]);
  });

  it("a retry closure whose owner went stale AFTER dispatch is inert, and the listener-side stillCurrent re-check reports stale", () => {
    const { events, dispose } = listen();
    let current = true;
    let retried = 0;
    dispatchAiProviderFailure({ provider: "anthropic", retry: () => { retried += 1; }, ownership: { isCurrent: () => current } });
    dispose();
    expect(events).toHaveLength(1);
    current = false; // project switched / generation retired
    expect(events[0]!.stillCurrent?.()).toBe(false); // listener drops the event
    events[0]!.retry!(); // a stashed retry click after the switch
    expect(retried).toBe(0); // inert — nothing targets the new project
  });

  it("cancellation is NOT a provider failure: the page dispatches only for provider_* reasons excluding provider_cancelled (contract mirrored here)", () => {
    // The page-side guard: reason.startsWith("provider_") && reason !== "provider_cancelled".
    const dispatches = (reason: string): boolean => reason.startsWith("provider_") && reason !== "provider_cancelled";
    expect(dispatches("provider_insufficient_quota")).toBe(true);
    expect(dispatches("provider_rate_limit")).toBe(true);
    expect(dispatches("provider_authentication")).toBe(true);
    expect(dispatches("provider_cancelled")).toBe(false);
    expect(dispatches("cancelled")).toBe(false);
    expect(dispatches("deadline")).toBe(false);
    expect(dispatches("max_steps")).toBe(false);
  });
});
