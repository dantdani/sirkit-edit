/**
 * [B22-B] The chat route's ONE approved boundary to the named computations (OD-139, OD-140): the server resolver for the port behind
 * `sirkit.computation.analytical-equation`, `sirkit.computation.artifact-compare` and `sirkit.computation.artifact-parse`.
 *
 * Mirrors external-acquisition-runtime.ts: the default is the REAL production port (`createComputationPort`, over the server process's
 * one bounded engine host), failing CLOSED to null. The port is bound to a run ONLY when the server opts in with
 * `SIRKIT_NAMED_COMPUTATIONS=1` (OD-158, default off): the engine host's worker entry is a file the host resolves next to itself
 * (`new URL("./engine-worker.mjs", import.meta.url)`), and how `next build` bundles it was not measured in B22-B (no build was run),
 * so production chat stays unchanged until the owner qualifies it. Off, the three tools are withheld from every run (the fact is
 * false). A test setter exists with a deterministic reset; it is never a production path.
 *
 * It imports the computation port and nothing else. No MCP route, no specialist and no other route reaches it.
 */
import { computationEngineServable, createComputationPort } from "@/app/lib/computation/computation-port";
import type { ComputationPort } from "@/app/lib/agent/computation-reads";

export type ComputationPortFactory = () => ComputationPort | null;

/** The server setting that opts a deployment into the named computations (OD-158). Exactly "1" enables them. */
export const NAMED_COMPUTATIONS_SETTING = "SIRKIT_NAMED_COMPUTATIONS";

/** [B22-B review] regressions-1: opted in AND the engine host can run here (no V8 heap-size flag on the server process - `next dev`
 *  sets one unless NEXT_DISABLE_MEM_OVERRIDE=1); otherwise no port, so the three reads are withheld rather than offered and refused. */
const DEFAULT_FACTORY: ComputationPortFactory = () => (process.env[NAMED_COMPUTATIONS_SETTING] === "1" && computationEngineServable() ? createComputationPort() : null);
let portFactory: ComputationPortFactory = DEFAULT_FACTORY;

/** Test-only override; restore via `resetComputationPortFactory`. */
export function setComputationPortFactory(factory: ComputationPortFactory): void {
  portFactory = factory;
}

/** Restore the production default (deterministic test isolation). */
export function resetComputationPortFactory(): void {
  portFactory = DEFAULT_FACTORY;
}

/** Resolve the port for one run, or null to withhold the three tools. Never throws. */
export function resolveComputationPort(): ComputationPort | null {
  try {
    return portFactory();
  } catch {
    return null;
  }
}
