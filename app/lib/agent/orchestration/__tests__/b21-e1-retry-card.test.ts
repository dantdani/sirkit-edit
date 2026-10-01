// @vitest-environment jsdom
/**
 * [B21 E1] (D21-18, OD-115) The provider-failure card never offers Retry for a provider that is out of credits
 * (`provider_insufficient_quota` - a retry cannot succeed until someone adds credits; today it was offered) or that Sirkit's own
 * breaker has paused (`provider_breaker_open` - a retry would be refused without a call). Proven through the PRODUCTION settlement
 * (`run-consumer.ts`, the module page.tsx delegates to) and the shared card's JSON path (`throwAiResponseError`): the owned event is
 * still dispatched WITH the new-run closure - the card and its "Use <other> instead" stay, the human's own choice, and the Switch
 * still sends the message again on the other provider ([B21 E1 fix] regressions-1) - but marked `retryOffered: false`, so the card's
 * existing Retry button renders disabled. No control is added or removed (the B17-A inventory is unchanged).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AiProviderUnavailableError, throwAiResponseError, type AiProviderFailureDetail } from "@/app/lib/ai-preferences";
import { isRetryableReason } from "@/app/lib/llm/errors";
import { PROVIDER_FAILURES_WITHOUT_RETRY, isRecoverableProviderFailure, performProviderSwitch, providerRetryOffered, settleAgentRunFailure } from "@/app/lib/agent/run-consumer";

const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");
const details: AiProviderFailureDetail[] = [];
const listener = (event: Event): void => { details.push((event as CustomEvent<AiProviderFailureDetail>).detail); };
window.addEventListener("sirkit:ai-provider-failure", listener);
afterEach(() => { details.length = 0; });

describe("[B21 E1] no Retry for quota or an open breaker", () => {
  it("1. out of credits or paused by the breaker: the card is still shown (the owned event dispatched, `recovered`) with its Retry WITHHELD (`retryOffered: false`) - its Retry stays disabled and nothing starts a run - while the new-run closure rides along for its \"Use <other> instead\"; a transient provider failure keeps its Retry, which starts a NEW run", () => {
    for (const reason of ["provider_insufficient_quota", "provider_breaker_open"]) {
      const runs: string[] = [];
      const settlement = settleAgentRunFailure({ reason, provider: "openai", ownership: { isCurrent: () => true }, startNewRun: () => runs.push("new-run") });
      expect(settlement.recovered, reason).toBe(true);
      const detail = details.pop()!;
      expect(detail.provider, reason).toBe("openai");
      expect(detail.retryOffered, reason).toBe(false); // the card's Retry is withheld
      expect(typeof detail.retry, reason).toBe("function"); // [B21 E1 fix: regressions-1] the Switch's new run is kept (B09.2)
      expect(runs, reason).toEqual([]); // the settlement itself starts nothing
      expect(isRecoverableProviderFailure(reason), reason).toBe(true); // the card itself is unchanged
      expect(providerRetryOffered(reason), reason).toBe(false);
    }
    for (const reason of ["provider_rate_limit", "provider_network", "provider_overloaded", "provider_unrequested_output"]) {
      const runs: string[] = [];
      settleAgentRunFailure({ reason, provider: "anthropic", ownership: { isCurrent: () => true }, startNewRun: () => runs.push("new-run") });
      const detail = details.pop()!;
      expect(detail.retryOffered, reason).toBeUndefined(); // offered
      expect(detail.retry, reason).toBeDefined();
      detail.retry!();
      expect(runs, reason).toEqual(["new-run"]);
      expect(providerRetryOffered(reason), reason).toBe(true);
    }
    for (const reason of ["provider_cancelled", "cancelled", "deadline"]) expect(providerRetryOffered(reason), reason).toBe(false);
  });

  it("2. the reasons without Retry are pinned and agree with the classifier (insufficient_quota was never retryable, errors.ts); the card's Retry is disabled when no closure is dispatched OR the failure withholds it (`retryOffered: false`), and its Switch keeps the closure - an in-place page.tsx edit that adds no control", () => {
    expect(PROVIDER_FAILURES_WITHOUT_RETRY).toEqual(["provider_insufficient_quota", "provider_breaker_open"]);
    expect(Object.isFrozen(PROVIDER_FAILURES_WITHOUT_RETRY)).toBe(true);
    expect(isRetryableReason("insufficient_quota")).toBe(false);
    const page = read("app/page.tsx");
    expect(page).toContain("lastAiRetryRef.current = detail.retry ?? null;");
    expect(page).toContain("setAiProviderFailure({ provider: detail.provider, retryOffered: detail.retryOffered !== false });");
    expect(page).toContain("disabled={!lastAiRetryRef.current || !aiProviderFailure.retryOffered}");
    expect(page).toContain("startNewRun: lastAiRetryRef.current,");
    expect(read("app/lib/agent/run-consumer.ts")).toContain("retry: input.startNewRun, ownership: input.ownership, ...(providerRetryOffered(input.reason) ? {} : { retryOffered: false as const })");
    expect(read("app/lib/ai-preferences.ts")).toContain("providerRetryWithheld(`provider_${data.reason}`) ? { retryOffered: false as const } : {}");
  });

  it("3. [B21 E1 fix: regressions-1] after a no-credits failure \"Use <other> instead\" still sends the message again on the OTHER provider: the page's own wiring (its listener stores the dispatched closure, its Switch hands that closure to `performProviderSwitch`) selects the other provider BEFORE the new run starts (B09.2's contract); the Retry stays withheld", () => {
    let selected = "openai";
    const sent: string[] = [];
    settleAgentRunFailure({ reason: "provider_insufficient_quota", provider: "openai", ownership: { isCurrent: () => true }, startNewRun: () => sent.push(`send-on:${selected}`) });
    const detail = details.pop()!;
    // the page's listener: `lastAiRetryRef.current = detail.retry ?? null;` and the card's state (case 2 pins both lines)
    const lastAiRetry = detail.retry ?? null;
    const card = { provider: detail.provider, retryOffered: detail.retryOffered !== false };
    expect(!lastAiRetry || !card.retryOffered).toBe(true); // the Retry button's `disabled`
    const next = performProviderSwitch(card.provider, { selectProvider: (provider) => { selected = provider; }, startNewRun: lastAiRetry });
    expect(next).toBe("anthropic");
    expect(sent).toEqual(["send-on:anthropic"]);
  });

  it("4. [B21 E1 fix: tests-retry-card-claim] the SHARED card's other path - a 503 `provider_unavailable` body (generate, edit, review, tidy) through `throwAiResponseError` - withholds Retry for `insufficient_quota` the same way, the Switch's closure kept; a rate limit keeps its Retry", async () => {
    const body = (reason: string): Response => ({ json: async () => ({ ok: false, code: "provider_unavailable", provider: "openai", reason, retryable: false, error: "(fake) the provider failed." }) }) as unknown as Response;
    let retried = 0;
    await expect(throwAiResponseError(body("insufficient_quota"), () => { retried += 1; }, { isCurrent: () => true })).rejects.toBeInstanceOf(AiProviderUnavailableError);
    const quota = details.pop()!;
    expect(quota.retryOffered).toBe(false);
    quota.retry!();
    expect(retried).toBe(1); // the closure is the Switch's new run
    await expect(throwAiResponseError(body("rate_limit"), () => undefined, { isCurrent: () => true })).rejects.toBeInstanceOf(AiProviderUnavailableError);
    expect(details.pop()!.retryOffered).toBeUndefined();
  });
});
