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
  // [B24-C2] OD-199, OD-208: publish A1's deployment configuration digest for the attribution documents of this process. The record is
  // built here (once, at start-up) because the chat route may not import it: it digests the provider registry, which must stay out
  // of the chat closure (b19-d's FORBIDDEN list). A record that cannot be built publishes nothing: the attribution then carries null
  // and the closed diagnostic, and start-up is never blocked.
  try {
    const { deploymentConfiguration } = await import("./app/lib/deployment/configuration");
    const { publishDeploymentConfigurationDigest } = await import("./app/lib/observability/deployment-configuration-digest");
    publishDeploymentConfigurationDigest(deploymentConfiguration().digest);
  } catch { /* the attribution records deployment_configuration_unavailable */ }
}
