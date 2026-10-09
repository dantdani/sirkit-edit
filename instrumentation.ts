/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * [B16-C.5] The env-gated fixture runtime freezes the server clock at its fixed
 * instant BEFORE any route mints a durable identity (see
 * app/lib/fixture-runtime/clock.ts). A production runtime never enables the
 * fixture runtime, so this is a no-op there.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installFixtureClock } = await import("./app/lib/fixture-runtime/clock");
  installFixtureClock();
  // [B24-C1] D24-21, OD-207: bind the LLM call record's durable sink, after the fixture clock (the record's times read it). The
  // repository is resolved at write time, so this builds no database client; the sink registry is on globalThis, which the route
  // bundles share with this one.
  const { bindDurableLlmCallRecordSink } = await import("./app/lib/observability/llm-call-record-runtime");
  bindDurableLlmCallRecordSink();
}
