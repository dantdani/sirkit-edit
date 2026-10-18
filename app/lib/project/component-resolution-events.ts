/**
 * [PR-M, 2026-10-18] Runbook sections M.2.4-M.2.6 and M.4: the page's SAFE intake of the agent's `component_resolution_ready` event and
 * the sentences the page writes about a resolution batch - the generation-proposal-events.ts / draft-request-events.ts pattern:
 *
 *  - `receiveComponentResolutionEvent` (from app/lib/component-resolution/resolution-events.ts) narrows the event to a structurally
 *    verified `sirkit.component-resolution-proposal.v1` batch (schema, closed key set, item / operation coherence, every sealed
 *    digest) or nothing; `componentResolutionCurrency` checks it against the LIVE editor (scope, expiry, head, base digest) before it
 *    is offered - a fabricated, altered, foreign, expired or stale batch offers nothing and the page says why;
 *  - `componentResolutionReview` projects the sealed batch to what the review dialog shows per target instance: the reference and
 *    stable id, the old and the new identity (current part, the exact candidate revision, its package / footprint), the proved pin
 *    mapping, the polarity on each terminal, the material warnings and what stays unchanged - nothing the artifact does not carry,
 *    never a claim of electrical equivalence;
 *  - `RESOLUTION_PROGRESS` and the line builders are the run log's PUBLIC progress, each tied to a real event: a resolution tool the
 *    run started (inspecting, searching, checking mappings), the sealed batch received (awaiting review), the real receipt (committed
 *    with the new schematic revision) and the recomputed Prepare PCB preflight and design checks (preflight updated). No synthetic
 *    narration, no private reasoning.
 *
 * Receiving, checking or displaying a batch mutates NOTHING and grants nothing; applying it is the human's Approve on the dialog,
 * through resolution-approval-controller.internal.ts. Pure and node-free.
 */
import { COMPONENT_RESOLUTION_READY_EVENT, componentResolutionCurrency, componentResolutionReviewRows, receiveComponentResolutionEvent, type ComponentResolutionReviewRow, type ReceivedComponentResolution } from "../component-resolution/resolution-events";
import type { SealedResolutionProposal } from "../component-resolution/resolution-proposal";
import type { PcbSyncPreflightReport } from "../pcb-sync/preflight-read";
import type { DesignCheck } from "../schematic/design-checks";

export { COMPONENT_RESOLUTION_READY_EVENT, componentResolutionCurrency, receiveComponentResolutionEvent, type ReceivedComponentResolution };

/** The receipt fields the page states (structural: the approved-resolution receipt satisfies it, so this module - and the dialog and the
 *  page through it - imports no apply code; only the page's trusted controller reaches the apply service). */
export interface ResolutionReceiptView {
  receiptId: string;
  transactionId: string;
  headAfter: { headSequence: number; canonicalStateDigest: string };
  items: ReadonlyArray<{ refDes: string; target: { exactMpn: string } }>;
}

/** The run-log line of a resolution tool the run STARTED (a real `tool_started` event), keyed by tool id. */
export const RESOLUTION_PROGRESS: Readonly<Record<string, string>> = Object.freeze({
  "sirkit.schematic.instance-inspect": "Inspecting the unresolved instances on the sheet (stable ids, catalog pins, nets, polarity; no PCB needed)",
  "sirkit.parts.candidate-search": "Searching the local library for eligible published revisions",
  "sirkit.schematic.propose-component-resolution": "Checking candidate pin mappings, polarity and packages, and sealing one batch for your review",
});

/** At most this many instances one "Find a replacement in the library" request names (a resolution batch holds at most 20). */
export const MAX_FIND_REPLACEMENT_INSTANCES = 20;

/** The ONE sentence the Missing parts list's "Find a replacement in the library" sends through the composer's ask route: the references
 *  and their stable instance ids (a reference is a label; the id is the durable target the assistant's tools are given). */
export function findReplacementSentence(instances: ReadonlyArray<{ componentId: string; refDes: string }>): string {
  const named = instances.slice(0, MAX_FIND_REPLACEMENT_INSTANCES);
  const refs = named.map((instance) => instance.refDes);
  const list = refs.length <= 1 ? refs.join("") : `${refs.slice(0, -1).join(", ")} and ${refs[refs.length - 1]}`;
  return `Find a replacement in the library for ${list} (instances ${named.map((instance) => instance.componentId).join(", ")}).`;
}

/** The public progress line of one agent event, or null when the event is not a resolution step (the page's generic line stands). */
export function resolutionProgressLine(event: { type?: unknown; toolId?: unknown }): string | null {
  if (event.type !== "tool_started" || typeof event.toolId !== "string") return null;
  return Object.hasOwn(RESOLUTION_PROGRESS, event.toolId) ? RESOLUTION_PROGRESS[event.toolId]! : null;
}

export interface ComponentResolutionReviewItem extends ComponentResolutionReviewRow {
  /** the exact candidate revision and its identities, verbatim */
  revision: { atomicPartRevisionId: string; exactMpn: string; manufacturer: string; footprint: string; catalogPartId: string };
  /** each polar terminal and the net it stays on, e.g. `cathode: pin 1 -> pin 1 on TIMING` (empty for a non-polar part) */
  polarity: string[];
  /** what this item keeps, stated */
  unchanged: string[];
}

export interface ComponentResolutionReview {
  proposalId: string;
  items: ComponentResolutionReviewItem[];
  /** the components the batch does not touch */
  unaffectedComponents: number;
  /** what the change invalidates downstream, as sealed */
  downstream: string[];
  expiresAt: number;
}

/** The dialog's view of one sealed batch (a pure projection; item order is the batch's). */
export function componentResolutionReview(proposal: SealedResolutionProposal): ComponentResolutionReview {
  const rows = componentResolutionReviewRows(proposal);
  return {
    proposalId: proposal.proposalId,
    items: proposal.impact.items.map((item, index) => {
      const netOf = (pin: string): string | null => item.nets.find((entry) => entry.pin === pin)?.net ?? null;
      const polarity = item.mapping
        .filter((entry) => entry.function === "anode" || entry.function === "cathode")
        .map((entry) => `${entry.function}: pin ${entry.fromPin} -> pin ${entry.toPin}${entry.pads.length > 0 ? ` (pad ${entry.pads.join("/")})` : ""} ${netOf(entry.fromPin) ? `stays on ${netOf(entry.fromPin)}` : "unconnected"}`);
      return {
        ...rows[index]!,
        revision: { atomicPartRevisionId: item.target.atomicPartRevisionId, exactMpn: item.target.exactMpn, manufacturer: item.target.manufacturer, footprint: item.target.footprintFullName, catalogPartId: item.target.catalogPartId },
        polarity,
        unchanged: [
          `reference ${item.refDes} and its stable id`,
          `value ${item.value || "(none)"}`,
          "placement and rotation",
          item.nets.length > 0 ? `every connection (${item.nets.map((entry) => `pin ${entry.pin}: ${entry.net}`).join(", ")})` : "no connection to keep",
        ],
      };
    }),
    unaffectedComponents: proposal.impact.unaffectedComponents,
    downstream: [...proposal.impact.downstream],
    expiresAt: proposal.expiresAt,
  };
}

const refsOf = (proposal: SealedResolutionProposal): string => proposal.impact.items.map((item) => item.refDes).join(", ");
const targetsOf = (proposal: SealedResolutionProposal): string => [...new Set(proposal.impact.items.map((item) => `${item.target.exactMpn} (revision ${item.target.atomicPartRevisionId.slice(0, 18)}…)`))].join(", ");

/** The run log's and the chat's sentences about one batch (the page's own words; nothing here claims a change before the receipt). */
export const resolutionLines = Object.freeze({
  dropped: (): string => "A component resolution the assistant issued was dropped by this page: it failed the integrity checks. Nothing was changed and no review is offered.",
  notOffered: (detail: string): string => `Component resolution not offered — ${detail}`,
  awaitingReview: (proposal: SealedResolutionProposal): string => `Awaiting your review: one batch for ${refsOf(proposal)} → ${targetsOf(proposal)}, with the proved pin mapping. Nothing has changed yet; approve or discard it in the review dialog.`,
  committed: (receipt: ResolutionReceiptView, alreadyApplied: boolean): string => `${alreadyApplied ? "Already committed" : "Committed"}: ${receipt.items.map((item) => item.refDes).join(", ")} resolved to ${[...new Set(receipt.items.map((item) => item.target.exactMpn))].join(", ")} in ONE canonical transaction ${receipt.transactionId.slice(0, 12)}… — new schematic revision ${receipt.headAfter.headSequence} (head ${receipt.headAfter.canonicalStateDigest.slice(0, 16)}…), receipt ${receipt.receiptId.slice(0, 16)}…; references, values, placements and nets verified; undoable.`,
  refused: (message: string): string => `The component resolution was not applied: ${message}`,
  discarded: (): string => "Component resolution discarded — nothing was changed and nothing was recorded.",
});

/** The run log's lines after a committed batch: the recomputed Prepare PCB preflight and the design checks, as they stand. */
export function resolutionAftermathLines(report: PcbSyncPreflightReport, checks: readonly DesignCheck[]): string[] {
  const preflight = report.status === "ready_for_server_preparation"
    ? `Prepare PCB preflight updated: no instance is refused any more (${report.instances.kicadWithPublishedRevision} of ${report.instances.kicad} catalog instances carry a published exact revision). The server stages — bindings, publication, the durable preflight — have not run yet: Prepare PCB runs them; not checked is not a pass.`
    : `Prepare PCB preflight updated: ${report.unresolved.count} instance(s) are still refused — ${report.unresolved.rows.map((row) => `${row.refDes} (${row.missingLabel})`).join(", ")}${report.unresolved.truncated > 0 ? `, and ${report.unresolved.truncated} more` : ""}.`;
  const electrical = checks.filter((check) => check.id !== "bom").map((check) => `${check.label} — ${check.state === "pass" ? "pass" : check.state === "findings" ? `${check.count} finding(s): ${check.findings.slice(0, 2).join("; ")}` : `not run (${check.reason ?? "unknown"})`}`).join(" · ");
  return [preflight, `Electrical check on the new revision: ${electrical || "not run"}.`];
}
