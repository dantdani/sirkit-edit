/**
 * [B23-B2] The `manufacturing-provider` admission key (OD-165; D23-3): a reviewed extension of the `AdmissionKey` union
 * (`app/lib/acquisition/admission-control.ts:50`) with a minute and a day window and a breaker taken from the provider's transfer
 * descriptor, and an AGENT SHARE OF 0 - an agent request is refused whatever the windows hold, reserving nothing. The send path
 * (`provider-egress.ts`) consults the meter before the transport and feeds it every outcome. The distributor, MCP and LLM meters keep
 * their keys and behaviour (their suites run unchanged).
 *
 * The meters are in-process; every case resets them. The transport is the in-process fake provider behind the real boundary.
 * Nothing is written to disk and nothing leaves the process.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  MANUFACTURING_PROVIDER_AGENT_SHARE,
  admissionKeyString,
  currentManufacturingProviderPause,
  currentPause,
  recordManufacturingProviderOutcome,
  requestAdmission,
  requestManufacturingProviderAdmission,
  resetAdmissionControl,
  type ManufacturingProviderMeterPolicy,
} from "@/app/lib/acquisition/admission-control";
import { buildOutboundPackage, type OutboundPackage } from "../outbound-package";
import { sendProviderExchange } from "../provider-egress";
import { syntheticLedgerRecord, syntheticRelease } from "./_b23-b-release-fixture";
import { FAKE_ENV, PUBLIC_RESOLVE, fakeCredential, fakeDescriptor, fakeProvider, type FakeAnswer } from "./_b23-b2-fake-provider";

const KEY = { kind: "manufacturing-provider", providerId: "jlcpcb" } as const;
const POLICY: ManufacturingProviderMeterPolicy = { requestsPerMinute: 2, requestsPerDay: 3, consecutiveFailuresToOpen: 2, openMs: 60_000 };
const T0 = Date.parse("2026-10-04T10:00:00.000Z");
const MINUTE = 60_000;

function outboundPackage(): OutboundPackage {
  const release = syntheticRelease();
  const built = buildOutboundPackage({ release, ledger: syntheticLedgerRecord(release) });
  if (!built.ok) throw new Error(built.refusal);
  return built.package;
}

beforeEach(() => { resetAdmissionControl(); });

describe("[B23-B2] the manufacturing-provider meter (OD-165)", () => {
  it("1. the key is a reviewed extension of the union: manufacturing-provider:<id>, and every earlier kind keeps its spelling", () => {
    expect(admissionKeyString(KEY)).toBe("manufacturing-provider:jlcpcb");
    expect(admissionKeyString({ kind: "acquisition-source", id: "digikey" })).toBe("acquisition-source:digikey");
    expect(admissionKeyString({ kind: "mcp-server", serverId: "srv" })).toBe("mcp-server:srv");
    expect(admissionKeyString({ kind: "mcp-server", serverId: "srv", tool: "t" })).toBe("mcp-server:srv/tool:t");
    expect(admissionKeyString({ kind: "llm-provider", provider: "openai" })).toBe("llm-provider:openai");
    expect(admissionKeyString({ kind: "llm-provider", provider: "anthropic", model: "m" })).toBe("llm-provider:anthropic/model:m");
  });

  it("2. the quota: the descriptor's minute and day windows, each refused when used up with when to try again, and a window that ends lets the next request through", () => {
    expect(requestManufacturingProviderAdmission(KEY, POLICY, T0)).toEqual({ allowed: true });
    expect(requestManufacturingProviderAdmission(KEY, POLICY, T0 + 1)).toEqual({ allowed: true });
    expect(requestManufacturingProviderAdmission(KEY, POLICY, T0 + 2)).toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: T0 + MINUTE });
    expect(requestManufacturingProviderAdmission(KEY, POLICY, T0 + MINUTE)).toEqual({ allowed: true });
    const dayEnd = Date.parse("2026-10-05T00:00:00.000Z");
    expect(requestManufacturingProviderAdmission(KEY, POLICY, T0 + 2 * MINUTE)).toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: dayEnd });
    expect(currentManufacturingProviderPause(KEY, POLICY, T0 + 2 * MINUTE)).toMatchObject({ reason: "quota_exhausted", retryAtMs: dayEnd });
    expect(requestManufacturingProviderAdmission(KEY, POLICY, dayEnd)).toEqual({ allowed: true });
  });

  it("3. the breaker: consecutive failures open it, nothing is admitted while it is open, one trial goes when the period ends, a success closes it and a rate limit opens it at once", () => {
    const roomy: ManufacturingProviderMeterPolicy = { ...POLICY, requestsPerMinute: 50, requestsPerDay: 500 };
    for (let index = 0; index < 2; index += 1) {
      expect(requestManufacturingProviderAdmission(KEY, roomy, T0 + index)).toEqual({ allowed: true });
      recordManufacturingProviderOutcome(KEY, roomy, "failure", T0 + index);
    }
    expect(requestManufacturingProviderAdmission(KEY, roomy, T0 + 10)).toMatchObject({ allowed: false, reason: "breaker_open", retryAtMs: T0 + 1 + roomy.openMs });
    const reopen = T0 + 1 + roomy.openMs;
    expect(requestManufacturingProviderAdmission(KEY, roomy, reopen)).toEqual({ allowed: true }); // the one trial
    expect(requestManufacturingProviderAdmission(KEY, roomy, reopen + 1)).toMatchObject({ allowed: false, reason: "breaker_open" }); // one at a time
    recordManufacturingProviderOutcome(KEY, roomy, "success", reopen + 2);
    expect(requestManufacturingProviderAdmission(KEY, roomy, reopen + 3)).toEqual({ allowed: true });
    recordManufacturingProviderOutcome(KEY, roomy, "rate_limited", reopen + 4);
    expect(requestManufacturingProviderAdmission(KEY, roomy, reopen + 5)).toMatchObject({ allowed: false, reason: "breaker_open", retryAtMs: reopen + 4 + roomy.openMs });
  });

  it("4. the agent's share is 0: an agent request is refused on a fresh meter, naming OD-165, and reserves nothing - a person still has the whole window", () => {
    expect(MANUFACTURING_PROVIDER_AGENT_SHARE).toBe(0);
    for (let index = 0; index < 5; index += 1) {
      const refused = requestManufacturingProviderAdmission(KEY, POLICY, T0 + index, "agent");
      expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted" });
      if (!refused.allowed) expect(refused.message).toMatch(/agent.*share.*0.*OD-165/);
    }
    expect(currentManufacturingProviderPause(KEY, POLICY, T0, "agent")).toMatchObject({ reason: "quota_exhausted" });
    expect(currentManufacturingProviderPause(KEY, POLICY, T0, "interactive")).toBeNull();
    expect(requestManufacturingProviderAdmission(KEY, POLICY, T0 + 10)).toEqual({ allowed: true });
    expect(requestManufacturingProviderAdmission(KEY, POLICY, T0 + 11)).toEqual({ allowed: true });
  });

  it("5. each meter is its own: a manufacturing provider at its limit leaves a distributor source and another provider untouched, and a distributor at its limit leaves the provider untouched", () => {
    requestManufacturingProviderAdmission(KEY, POLICY, T0);
    requestManufacturingProviderAdmission(KEY, POLICY, T0 + 1);
    expect(requestManufacturingProviderAdmission(KEY, POLICY, T0 + 2)).toMatchObject({ allowed: false });
    expect(requestManufacturingProviderAdmission({ kind: "manufacturing-provider", providerId: "macrofab" }, POLICY, T0 + 2)).toEqual({ allowed: true });
    expect(currentPause("digikey", T0 + 2)).toBeNull();
    expect(requestAdmission("digikey", 1, T0 + 2)).toEqual({ allowed: true });
    resetAdmissionControl();
    for (let index = 0; index < 10_000 && requestAdmission("digikey", 1, T0).allowed; index += 1) { /* fill DigiKey's minute window */ }
    expect(currentPause("digikey", T0)).toMatchObject({ reason: "quota_exhausted" });
    expect(requestManufacturingProviderAdmission(KEY, POLICY, T0)).toEqual({ allowed: true });
  });

  it("6. the send path consults the meter before the transport and feeds it every outcome: a paused provider is not sent to (no transport call), server errors open the breaker, a rate limit opens it at once and a trial's acknowledgement closes it", async () => {
    const pkg = outboundPackage();
    const env = { [FAKE_ENV]: fakeCredential() };
    let clock = T0;
    const send = async (answer: FakeAnswer, descriptor = fakeDescriptor({ meter: { requestsPerMinute: 50, requestsPerDay: 500, consecutiveFailuresToOpen: 2, openMs: 60_000 } })) => {
      const provider = fakeProvider(answer);
      const outcome = await sendProviderExchange({ descriptor, package: pkg, idempotencyKey: `meter-${clock}`, env, beforeSend: async () => undefined }, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE, clock: () => clock });
      clock += 1;
      return { outcome, calls: provider.calls };
    };
    // a used-up window: not sent, the transport never called
    const tight = fakeDescriptor({ meter: { requestsPerMinute: 1, requestsPerDay: 500, consecutiveFailuresToOpen: 2, openMs: 60_000 } });
    expect((await send("acknowledge", tight)).outcome.state).toBe("acknowledged");
    const paused = await send("acknowledge", tight);
    expect(paused.outcome).toMatchObject({ state: "not_sent", sendStarted: false, failure: "paused_quota_exhausted" });
    expect(paused.calls).toBe(0);
    resetAdmissionControl();
    // two server errors open the breaker; the next send is refused before the transport
    expect((await send("server-error")).outcome.state).toBe("UNKNOWN_PENDING_RECONCILIATION");
    expect((await send("server-error")).outcome.state).toBe("UNKNOWN_PENDING_RECONCILIATION");
    const open = await send("acknowledge");
    expect(open.outcome).toMatchObject({ state: "not_sent", failure: "paused_breaker_open" });
    expect(open.calls).toBe(0);
    // after the open period one trial goes; its acknowledgement closes the breaker
    clock += 60_000;
    expect((await send("acknowledge")).outcome.state).toBe("acknowledged");
    expect((await send("acknowledge")).outcome.state).toBe("acknowledged");
    // a rate limit is a rejection, and opens the breaker at once
    expect((await send("rate-limit")).outcome).toMatchObject({ state: "rejected", failure: "http_429" });
    const limited = await send("acknowledge");
    expect(limited.outcome).toMatchObject({ state: "not_sent", failure: "paused_breaker_open" });
    expect(limited.calls).toBe(0);
  });

  it("7. a provider's refusal other than a rate limit, and the caller's abort, teach the breaker nothing: more of either than the failures that open it, and an acknowledgement still goes through [B23-B2 review, 2026-10-04] tests-6", async () => {
    const pkg = outboundPackage();
    const env = { [FAKE_ENV]: fakeCredential() };
    const descriptor = fakeDescriptor({ meter: { requestsPerMinute: 50, requestsPerDay: 500, consecutiveFailuresToOpen: 2, openMs: 60_000 } });
    let clock = T0;
    const send = async (answer: FakeAnswer, abortAfterMs?: number) => {
      const provider = fakeProvider(answer);
      const controller = new AbortController();
      const transport: typeof fetch = async (input, init) => { if (abortAfterMs !== undefined) setTimeout(() => controller.abort(), abortAfterMs); return provider.fetch(input, init); };
      const outcome = await sendProviderExchange({ descriptor, package: pkg, idempotencyKey: `meter-${clock}`, env, beforeSend: async () => undefined, signal: controller.signal }, { fetch: transport, resolve: PUBLIC_RESOLVE, clock: () => clock });
      clock += 1;
      return { outcome, calls: provider.calls };
    };
    for (let index = 0; index < 3; index += 1) expect((await send("reject")).outcome).toMatchObject({ state: "rejected", failure: "http_422" });
    expect((await send("acknowledge")).outcome.state).toBe("acknowledged");
    for (let index = 0; index < 3; index += 1) expect((await send("hang", 5)).outcome).toMatchObject({ state: "UNKNOWN_PENDING_RECONCILIATION", failure: "aborted" });
    const after = await send("acknowledge");
    expect(after.outcome.state).toBe("acknowledged");
    expect(after.calls).toBe(1);
    expect(currentManufacturingProviderPause(KEY, descriptor.meter, clock)).toBeNull();
  });
});
