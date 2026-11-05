/**
 * [PR-M, 2026-10-17] Section M.2.4-M.2.5: the SAFE receiver of the agent's `component_resolution_ready` event - the client-side
 * intake the page's review dialog (the next round) calls before it offers a sealed resolution batch for review. It mirrors the
 * other sheet-artifact receivers (app/lib/project/draft-request-events.ts, module-contract-events.ts):
 *
 *  - `receiveComponentResolutionEvent` narrows the event payload to a structurally verified `sirkit.component-resolution-proposal.v1`
 *    artifact (schema, closed key set, item / operation coherence, every sealed digest: `verifySealedResolutionProposalIntegrity`)
 *    or nothing. A fabricated, altered or malformed event yields null and offers nothing;
 *  - `componentResolutionCurrency` is the intake's currency check against the LIVE editor (scope, expiry, head, base - the one shared
 *    sheet-artifact recipe, app/lib/project/sheet-artifact-currency.ts), worded for the batch;
 *  - `componentResolutionReviewRows` projects the sealed batch to what the dialog shows per instance: the reference and stable id,
 *    the old and the new identity, the proved pin mapping, the nets kept and the material warnings - nothing the artifact does not
 *    carry, and never a claim of electrical equivalence.
 *
 * Receiving, checking or displaying a batch mutates NOTHING and grants nothing. Applying it is the human's Apply on the review
 * dialog: the page issues the one-shot approval intent (resolution-approval.internal.ts) and calls `applyApprovedResolutionProposal`
 * (approved-resolution-mutations.ts) with a fresh-facts channel; this module reaches neither. Pure and node-free.
 */
import { auditRunId, sheetArtifactCurrency, type SheetArtifactCurrency, type SheetArtifactLiveEditor } from "../project/sheet-artifact-currency";
import { RESOLUTION_PROPOSAL_SCHEMA, verifySealedResolutionProposalIntegrity, type SealedResolutionProposal } from "./resolution-proposal";

/** The loop's event type for a sealed resolution batch (app/lib/agent/contracts.ts `AgentRunEvent`). */
export const COMPONENT_RESOLUTION_READY_EVENT = "component_resolution_ready" as const;
/** What a resolution batch is called in the page's sentences. */
export const COMPONENT_RESOLUTION_NOUN = "component resolution" as const;

export interface ReceivedComponentResolution {
  proposal: SealedResolutionProposal;
  /** audit metadata only (never authority): the run that sealed it */
  runId: string | null;
}

/** Narrow an agent `component_resolution_ready` event payload without granting anything. */
export function receiveComponentResolutionEvent(
  event: { type?: unknown; runId?: unknown; proposal?: unknown; [key: string]: unknown } | null | undefined,
): ReceivedComponentResolution | null {
  if (!event || typeof event !== "object") return null;
  if (event.type !== COMPONENT_RESOLUTION_READY_EVENT) return null;
  const proposal = event.proposal;
  if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) return null;
  if ((proposal as { schema?: unknown }).schema !== RESOLUTION_PROPOSAL_SCHEMA) return null;
  let verified: ReturnType<typeof verifySealedResolutionProposalIntegrity>;
  try {
    verified = verifySealedResolutionProposalIntegrity(proposal as SealedResolutionProposal);
  } catch {
    return null; // a structurally hostile payload (e.g. a non-array where an array is sealed) offers nothing
  }
  if (!verified.ok) return null;
  return { proposal: proposal as SealedResolutionProposal, runId: auditRunId(event.runId) };
}

/** The intake's currency check against the live editor (scope, expiry, head, base - in that order); every refusal is the page's sentence. */
export function componentResolutionCurrency(proposal: SealedResolutionProposal, live: SheetArtifactLiveEditor): SheetArtifactCurrency {
  return sheetArtifactCurrency(proposal, live, COMPONENT_RESOLUTION_NOUN);
}

export interface ComponentResolutionReviewRow {
  componentInstanceId: string;
  refDes: string;
  value: string;
  /** e.g. `catalog part <id> (no published exact revision)` */
  from: string;
  /** e.g. `1N4148W-7-F by Diodes Incorporated - revision <id>, footprint Diode_SMD:D_SOD-123` */
  to: string;
  mode: "same-part-binding" | "part-replacement";
  /** `1 -> 1 cathode (pad 1)` per mapped pin; a permutation is stated as one */
  mapping: string[];
  permutation: boolean;
  netsKept: string[];
  warnings: string[];
  /** what the compatibility proof established - never more */
  established: string;
}

const ESTABLISHED: Readonly<Record<SealedResolutionProposal["impact"]["items"][number]["equivalence"], string>> = Object.freeze({
  "pin-function-and-package": "pin functions, the pin-to-pad mapping and the package were checked against server-owned evidence; no rating was required, so none was compared - this is not an electrical equivalence proof",
  "pin-function-package-and-stated-ratings": "pin functions, the pin-to-pad mapping, the package and the stated ratings were checked against server-owned evidence; ratings nobody stated were not compared - this is not a complete electrical equivalence proof",
});

/** The dialog's rows, one per instance in item order (a pure projection of the sealed batch). */
export function componentResolutionReviewRows(proposal: SealedResolutionProposal): ComponentResolutionReviewRow[] {
  return proposal.impact.items.map((item) => ({
    componentInstanceId: item.componentInstanceId,
    refDes: item.refDes,
    value: item.value,
    from: `catalog part ${item.current.partId}${item.current.missing === "published_exact_revision" ? " (no published exact revision)" : item.current.missing === "symbol_asset" ? " (published revision without its installed symbol asset)" : ""}`,
    to: `${item.target.exactMpn}${item.target.manufacturer ? ` by ${item.target.manufacturer}` : ""} - revision ${item.target.atomicPartRevisionId}, footprint ${item.target.footprintFullName}`,
    mode: item.mode,
    mapping: item.mapping.map((entry) => `${entry.fromPin} -> ${entry.toPin} ${entry.function.replace(/^name:/, "")}${entry.pads.length > 0 ? ` (pad ${entry.pads.join("/")})` : ""}${entry.connected ? "" : " (unconnected)"}`),
    permutation: item.permutation,
    netsKept: item.nets.map((entry) => `pin ${entry.pin}: ${entry.net}`),
    warnings: [...item.warnings],
    established: ESTABLISHED[item.equivalence],
  }));
}
