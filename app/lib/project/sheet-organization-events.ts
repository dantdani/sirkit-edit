/**
 * [PR-J5, 2026-10-23] Runbook J.3 item 4, J.6 items 4 and 6 (OD-259 items 4 and 5): the page's SAFE intake of the agent's
 * `sheet_organization_ready` event - the sealed ORGANISE proposal `sirkit.sheet-organization-proposal.v1`
 * (app/lib/engineering/sheet-organization-proposal.ts, the tool's own module) - and the sentences the page writes about it, on the
 * generation-proposal-events.ts / component-resolution-events.ts pattern:
 *
 *  - `receiveSheetOrganizationEvent` narrows the event to an INTEGRITY-verified sealed proposal (schema, exact keys, well-formed scope
 *    and binding, the sealed identity digest) or nothing; `sheetOrganizationCurrency` checks it against the LIVE editor (scope, expiry,
 *    head mark, the base digest as the chat run posted it - the ONE sheet-artifact currency, sheet-artifact-currency.ts) before it is
 *    offered: a fabricated, altered, foreign, expired or stale proposal offers nothing and the page says why;
 *  - `sheetOrganizationReview` projects the sealed FACTS to what the review card shows: the sheets with their members, the interfaces
 *    (the crossing nets and the ports that carry them), the parts left on the source sheet, "check these" (parts the connectivity
 *    grouping would place elsewhere), the board names that change, the equivalence (the partition digest, the component count) -
 *    nothing the artifact does not carry; the card's Approve is blocked, with the reason, while the proposal is stale or already applied;
 *  - `sheetOrganizationReplanBase` is the state the Approve re-plans on: the canonical base with the page's sheet-size fallback, the
 *    same recipe the chat run posted and the seal digested (so the sealed base digest and the re-plan's agree byte for byte).
 *
 * Receiving, checking or displaying a proposal mutates NOTHING and grants nothing. Applying it is the human's Approve on the card,
 * which runs J4's one organise transaction (`schematic.move-to-sheet`) through the Sheets controller's `applyOrganizeProposal`: the
 * sealed groups re-planned on the canonical base inside the serialized queue (`replanSheetOrganization`, the tool's own re-plan) and
 * applied only when the operations digest and the partition digest equal the sealed ones. Discard records nothing. Pure and node-free.
 */
import {
  SHEET_ORGANIZATION_PROPOSAL_SCHEMA,
  replanSheetOrganization,
  sheetOrganizationAlreadyApplied,
  verifySealedSheetOrganizationProposalIntegrity,
  type SealedSheetOrganizationProposal,
} from "../engineering/sheet-organization-proposal";
import type { PageSize, SchematicState } from "@/lib/schematic-types";
import { auditRunId, sheetArtifactCurrency, type SheetArtifactCurrency, type SheetArtifactLiveEditor } from "./sheet-artifact-currency";

export { SHEET_ORGANIZATION_PROPOSAL_SCHEMA, replanSheetOrganization, sheetOrganizationAlreadyApplied, type SealedSheetOrganizationProposal };

/** The agent event the page names in its stream consumer (app/lib/agent/contracts.ts `AgentRunEvent`). */
export const SHEET_ORGANIZATION_READY_EVENT = "sheet_organization_ready" as const;
/** The noun the currency sentences use. */
export const SHEET_ORGANIZATION_NOUN = "sheet organisation";

export interface ReceivedSheetOrganization {
  proposal: SealedSheetOrganizationProposal;
  /** audit metadata only (never authority): the run that proposed it */
  runId: string | null;
}

/** Narrow an agent `sheet_organization_ready` event payload: an integrity-verified sealed proposal or nothing (never half-read). */
export function receiveSheetOrganizationEvent(event: { type?: unknown; runId?: unknown; proposal?: unknown; [key: string]: unknown } | null | undefined): ReceivedSheetOrganization | null {
  if (!event || typeof event !== "object" || event.type !== SHEET_ORGANIZATION_READY_EVENT) return null;
  const proposal = event.proposal;
  if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal) || (proposal as { schema?: unknown }).schema !== SHEET_ORGANIZATION_PROPOSAL_SCHEMA) return null;
  if (!verifySealedSheetOrganizationProposalIntegrity(proposal).ok) return null;
  return { proposal: proposal as SealedSheetOrganizationProposal, runId: auditRunId(event.runId) };
}

/** The proposal's currency against the live editor: this project and branch, unexpired, the live head mark, the posted base digest. */
export function sheetOrganizationCurrency(proposal: SealedSheetOrganizationProposal, live: SheetArtifactLiveEditor): SheetArtifactCurrency {
  return sheetArtifactCurrency(proposal, live, SHEET_ORGANIZATION_NOUN);
}

/** The base the Approve re-plans on: the canonical state with the page's sheet-size fallback (the chat run's posting recipe). */
export function sheetOrganizationReplanBase(canonical: SchematicState, fallbackPageSize: PageSize | undefined): SchematicState {
  return canonical.pageSize !== undefined || fallbackPageSize === undefined ? canonical : { ...canonical, pageSize: fallbackPageSize };
}

export interface SheetOrganizationReviewGroup { sheetId: string; name: string; members: string[] }
export interface SheetOrganizationReviewInterface {
  /** "PWM_OUT (was SIG1): U1 OUT to R2's sheet" style line, built from the sealed facts only */
  line: string;
  portName: string;
  net: string | null;
  childSheetName: string;
}
export interface SheetOrganizationReview {
  proposalId: string;
  expiresAt: number;
  /** the sheet whose parts are organised (the overview in 1.0.0) */
  sourceSheetName: string;
  groups: SheetOrganizationReviewGroup[];
  interfaces: SheetOrganizationReviewInterface[];
  /** the parts the model left unassigned (they stay on the source sheet, OD-259 item 4) */
  unassigned: string[];
  checkThese: Array<{ refs: string[]; group: string; alternatives: string[]; reason: string }>;
  /** why "check these" could not be derived, when it could not */
  checkNote: string | null;
  /** board names that change (connections do not), "from -> to" */
  renamedNets: string[];
  equivalence: { partitionDigest: string; componentCount: number; operationCount: number };
  /** the model's rationale, as sealed (provenance.note), bounded for the card */
  rationale: string;
  /** why Approve is disabled (stale, expired, foreign, already applied), or null when it can be approved */
  approveBlockedReason: string | null;
}

const MAX_RATIONALE_CHARS = 600;

/** The card's view of one sealed proposal (a pure projection; group order is the proposal's). `live` decides whether Approve is open. */
export function sheetOrganizationReview(proposal: SealedSheetOrganizationProposal, live: { currency: SheetArtifactCurrency; alreadyApplied: boolean }): SheetOrganizationReview {
  const interfaces = proposal.interfaces.map((entry) => ({
    line: `${entry.portName}${entry.net === null ? (entry.defaultName && entry.defaultName !== entry.portName ? ` (was ${entry.defaultName}, an unnamed net)` : " (an unnamed net)") : ` (net ${entry.net})`}: a port of "${entry.childSheetName}" with its sheet pin on the ${entry.parentSheetId === proposal.sourceSheetId ? proposal.rootName : entry.parentSheetId}${entry.hierarchicalLabels > 1 ? `, ${entry.hierarchicalLabels} labels inside` : ""}`,
    portName: entry.portName,
    net: entry.net,
    childSheetName: entry.childSheetName,
  }));
  const approveBlockedReason = live.alreadyApplied
    ? "This organisation is already applied (a sheet it would create exists); nothing to approve."
    : live.currency.ok ? null : `Approve is disabled: ${live.currency.detail}`;
  return {
    proposalId: proposal.proposalId,
    expiresAt: proposal.expiresAt,
    sourceSheetName: proposal.rootName,
    groups: proposal.groups.map((group) => ({ sheetId: group.sheetId, name: group.name, members: group.members.map((member) => member.refDes) })),
    interfaces,
    unassigned: [...proposal.unassigned],
    checkThese: proposal.checkThese.map((check) => ({ refs: [...check.refs], group: check.group, alternatives: [...check.alternatives], reason: check.reason })),
    checkNote: proposal.checkNote,
    renamedNets: proposal.renamedNets.map((entry) => `${entry.from} -> ${entry.to ?? "(unnamed)"}`),
    equivalence: { partitionDigest: proposal.equivalence.partitionDigest, componentCount: proposal.equivalence.componentCount, operationCount: proposal.operationCount },
    rationale: proposal.provenance.note.length > MAX_RATIONALE_CHARS ? `${proposal.provenance.note.slice(0, MAX_RATIONALE_CHARS - 1)}…` : proposal.provenance.note,
    approveBlockedReason,
  };
}

const sheetNamesOf = (proposal: SealedSheetOrganizationProposal): string => proposal.groups.map((group) => `"${group.name}" (${group.members.length})`).join(", ");

/** The run log's and the chat's sentences about one proposal (the page's own words; nothing here claims a change before the apply). */
export const sheetOrganizationLines = Object.freeze({
  dropped: (): string => "A sheet organisation the assistant proposed was dropped by this page: it failed the integrity checks. Nothing was changed and no review is offered.",
  notOffered: (detail: string): string => `Sheet organisation not offered — ${detail}`,
  awaitingReview: (proposal: SealedSheetOrganizationProposal): string => `Awaiting your review: organise ${proposal.groups.reduce((sum, group) => sum + group.members.length, 0)} parts into ${proposal.groups.length} sheet${proposal.groups.length === 1 ? "" : "s"} - ${sheetNamesOf(proposal)}${proposal.interfaces.length > 0 ? `; ${proposal.interfaces.length} interface${proposal.interfaces.length === 1 ? "" : "s"} (${proposal.interfaces.map((entry) => entry.portName).join(", ")})` : "; no interface"}${proposal.unassigned.length > 0 ? `; ${proposal.unassigned.join(", ")} stay on the ${proposal.rootName}` : ""}. Nothing has changed yet; approve or discard it in the review card.`,
  applied: (proposal: SealedSheetOrganizationProposal): string => `Organised into ${proposal.groups.length} sheet${proposal.groups.length === 1 ? "" : "s"} (${proposal.groups.map((group) => group.name).join(", ")}) in ONE undoable transaction; the pin-to-net partition and every part identity are unchanged.`,
  refused: (message: string): string => `The sheet organisation was not applied: ${message}`,
  discarded: (): string => "Sheet organisation discarded — nothing was changed and nothing was recorded.",
});

/** The transaction's label (the history entry): what the Sheets navigator's own Organize says, with the proposer named. */
export function sheetOrganizationApplyLabel(proposal: SealedSheetOrganizationProposal): string {
  const parts = proposal.groups.reduce((sum, group) => sum + group.members.length, 0);
  return `Organized ${parts} part${parts === 1 ? "" : "s"} into ${proposal.groups.length} sheets (assistant proposal)`;
}
