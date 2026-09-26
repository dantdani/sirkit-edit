/**
 * [B21 D2] A test double for the families' sealers, for the B21-D suites that judge HAND-SEALED artifacts (not a test file).
 * Since B21-D2 a specialist's result carries ONLY what its own run's gateway sealed: the scheduler collects the run's own
 * `proposal_ready` / `pcb_proposal_ready` / `layout_candidate_ready` events and refuses any other entry the model wrote
 * (`proposal_not_sealed_in_run`) before the merge. An artifact a suite seals in TEST code with a production sealer (a stale, a
 * foreign, a re-sealed or a non-exact one - inputs the merge must still judge, defense in depth) can therefore reach the merge only
 * as the run's own seal event. This wrapper around the INJECTED loop (`SchedulerDeps.runLoop`, which the composition root binds
 * to the real `runAgentLoop`) runs the real loop and then relays one family event per entry of the scripted final text's
 * `proposedActions`, standing in for the gateway's seal. It is never a production path: production binds the real loop, whose
 * seal events only a gateway seal produces (b21-d2-provenance proves that path end to end).
 */
import type { AgentRunEvent } from "@/app/lib/agent/contracts";
import type { SpecialistLoop } from "../scheduler";

const FAMILY_EVENT: Readonly<Record<string, (runId: string, payload: Record<string, unknown>) => AgentRunEvent>> = Object.freeze({
  "sirkit.schematic-tier1-proposal.v3": (runId, payload) => ({ type: "proposal_ready", runId, toolId: "sirkit.schematic.propose-tier1-edit", proposal: payload as never }),
  "sirkit.schematic-replacement-proposal.v2": (runId, payload) => ({ type: "proposal_ready", runId, toolId: "sirkit.schematic.propose-component-replacement", proposal: payload as never }),
  "sirkit.pcb-bounded-edit-proposal.v2": (runId, payload) => ({ type: "pcb_proposal_ready", runId, toolId: "sirkit.pcb.propose-bounded-edit", proposal: payload as never }),
  "sirkit.layout-candidate.v1": (runId, payload) => ({ type: "layout_candidate_ready", runId, toolId: payload.kind === "placement" ? "sirkit.placement.propose" : "sirkit.routing.propose", candidate: payload as never }),
});

/** The injected loop, relaying the scripted result's artifacts as the run's own seal events (after the real loop returned). */
export function relaySeals(loop: SpecialistLoop): SpecialistLoop {
  return async (request, deps) => {
    const result = await loop(request, deps);
    if (result.status !== "completed") return result;
    let actions: unknown[] = [];
    try {
      const parsed = JSON.parse(result.finalText) as { proposedActions?: unknown };
      actions = Array.isArray(parsed.proposedActions) ? parsed.proposedActions : [];
    } catch {
      actions = [];
    }
    for (const action of actions) {
      const payload = typeof action === "object" && action !== null ? (action as { payload?: unknown }).payload : undefined;
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) continue;
      const schema = String((payload as { schema?: unknown }).schema);
      if (Object.hasOwn(FAMILY_EVENT, schema)) deps.emit(FAMILY_EVENT[schema]!(request.runId, payload as Record<string, unknown>));
    }
    return result;
  };
}
