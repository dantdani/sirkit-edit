/**
 * [B19-E E6] The chat route's ONE approved boundary to external acquisition: the server resolver for the agent read port
 * behind sirkit.parts.external-search and sirkit.parts.evidence-read.
 *
 * Mirrors the replacement-facts-runtime pattern: the default is the REAL production port (`resolveAgentReadPort`: withheld in
 * the fixture runtime and on a server without its database), constructed lazily per run with the server's policy, failing
 * CLOSED to null. A test setter exists with a deterministic reset; it is never a production path.
 *
 * It imports the agent read port and nothing else: the chat import-closure ratchet
 * (app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts) stops its walk here and pins that only the chat route
 * imports this file and that this file imports only `app/lib/acquisition/agent-read-port.ts`.
 */
import { resolveAgentReadPort, type AgentReadPortPolicy, type ExternalAcquisitionReadPort } from "@/app/lib/acquisition/agent-read-port";

export type ExternalAcquisitionPortFactory = (policy: AgentReadPortPolicy) => ExternalAcquisitionReadPort | null;

const DEFAULT_FACTORY: ExternalAcquisitionPortFactory = resolveAgentReadPort;
let portFactory: ExternalAcquisitionPortFactory = DEFAULT_FACTORY;

/** Test-only override; restore via `resetExternalAcquisitionPortFactory`. */
export function setExternalAcquisitionPortFactory(factory: ExternalAcquisitionPortFactory): void {
  portFactory = factory;
}

/** Restore the production default (deterministic test isolation). */
export function resetExternalAcquisitionPortFactory(): void {
  portFactory = DEFAULT_FACTORY;
}

/** Resolve the port for one run, or null to withhold both tools. Never throws. */
export function resolveExternalAcquisitionPort(policy: AgentReadPortPolicy): ExternalAcquisitionReadPort | null {
  try {
    return portFactory({ live: policy.live === true });
  } catch {
    return null;
  }
}
