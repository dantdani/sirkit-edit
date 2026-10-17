/**
 * [PR-G, 2026-10-17] The SAFE receiver for the agent's `draft_request_ready` event (the part draft request,
 * `sirkit.parts.draft-request`, app/lib/agent/draft-request-proposals.ts; OD-248): a structurally verified
 * `sirkit.part-draft-request.v1` artifact (schema, exact key set, the constant `unverified`, both sealed digests intact) or nothing. A
 * fabricated, altered or malformed event yields null and offers nothing. Receiving a request mutates NOTHING and files nothing: the
 * page shows it as a REVIEW TASK card in the run log (the part, the documented facts with their sources, the missing facts, the
 * PCB-assignment blockers) whose ONE action opens the EXISTING Build Library evidence review (`AtomicPublicationReviewSection`,
 * POST /api/components/atomic/publication submit_request - humans only, the same path MissingPartsList's draft action opens)
 * prefilled from the sealed spec; a person submits it there, a reviewer approves, a different administrator publishes.
 *
 * `draftRequestCurrency` is the intake's currency check against the LIVE editor (the generation proposal's recipe, shared through
 * sheet-artifact-currency.ts). `draftRequestPublicationPrefill` and `draftRequestCardLines` are pure projections of the sealed
 * artifact for the form and the card; neither adds a fact the artifact does not carry (a symbol or footprint reference is never
 * invented: the person picks them at submission). Pure and node-free.
 */
import { DRAFT_REQUEST_SCHEMA, verifySealedPartDraftRequestIntegrity, type SealedPartDraftRequest } from "../agent/draft-request-proposals";
import { UNRESOLVED_MISSING_LABEL } from "../pcb-sync/unresolved-instances";
import { auditRunId, sheetArtifactCurrency, type SheetArtifactCurrency, type SheetArtifactLiveEditor } from "./sheet-artifact-currency";

/** The run-log card's message id prefix (the page renders the card's one action for a live card with this prefix). */
export const DRAFT_REQUEST_CARD_ID_PREFIX = "draft-request:";
/** The sentence of the card's one action, as the control reads. */
export const DRAFT_REQUEST_OPEN_LABEL = "Open the publication request";

export interface ReceivedDraftRequest {
  proposal: SealedPartDraftRequest;
  /** audit metadata only (never authority): the run that sealed it */
  runId: string | null;
}

/** Narrow an agent `draft_request_ready` event payload without granting anything. */
export function receiveDraftRequestEvent(
  event: { type?: unknown; runId?: unknown; proposal?: unknown; [key: string]: unknown } | null | undefined,
): ReceivedDraftRequest | null {
  if (!event || typeof event !== "object") return null;
  if (event.type !== "draft_request_ready") return null;
  const proposal = event.proposal;
  if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) return null;
  if ((proposal as { schema?: unknown }).schema !== DRAFT_REQUEST_SCHEMA) return null;
  if (!verifySealedPartDraftRequestIntegrity(proposal).ok) return null;
  return { proposal: proposal as SealedPartDraftRequest, runId: auditRunId(event.runId) };
}

/** The intake's currency check against the live editor (scope, expiry, head, base - in that order); every refusal is the page's sentence. */
export function draftRequestCurrency(proposal: SealedPartDraftRequest, live: SheetArtifactLiveEditor): SheetArtifactCurrency {
  return sheetArtifactCurrency(proposal, live, "draft request");
}

/** The publication form's prefill (AtomicPublicationPrefill's fields, computed without React): the sealed spec in the form's own
 *  fields. Symbol and footprint stay null (the sealed request never names an asset; the person picks them). `partId` is the catalog
 *  part the cross-check compared against, when it ran - the form offers the link only then. */
export interface DraftRequestPublicationPrefill {
  exactMpn: string;
  manufacturer: string | null;
  partId: string | null;
  symbol: null;
  footprint: null;
  profile: SealedPartDraftRequest["draftRequest"]["profile"];
  /** the form's terminal table, one line per pin: `number function [pads]` (the form joins the middle tokens as the function) */
  terminals: string;
  packageCode: string;
  mounting: "smd" | "through_hole";
  datasheetUrl: string;
  datasheetLocator: string;
}

export function draftRequestPublicationPrefill(proposal: SealedPartDraftRequest): DraftRequestPublicationPrefill {
  const spec = proposal.draftRequest;
  return {
    exactMpn: spec.exactMpn,
    manufacturer: spec.manufacturer?.canonicalName ?? null,
    partId: proposal.catalogCrossCheck.state === "checked" ? proposal.catalogCrossCheck.partId : null,
    symbol: null,
    footprint: null,
    profile: spec.profile,
    terminals: spec.terminals.map((terminal) => `${terminal.number} ${terminal.function.replace(/\s+/g, " ").trim()} ${terminal.pads.join(",")}`).join("\n"),
    packageCode: spec.package?.code ?? "",
    mounting: spec.package?.mounting ?? "smd",
    datasheetUrl: spec.datasheet?.url ?? "",
    datasheetLocator: spec.datasheet?.locator ?? "",
  };
}

const utcMinute = (at: number): string => new Date(at).toISOString().slice(11, 16);

/** The review-task card: its title and its text rows, every row a fact the sealed artifact carries (never the model's prose). */
export function draftRequestCardLines(proposal: SealedPartDraftRequest): { title: string; lines: string[] } {
  const { instance, draftRequest: spec } = proposal;
  const lines: string[] = [
    `Part: ${instance.refDes} (${instance.family === "kicad" ? "catalog part" : "Theory symbol"}) — ${UNRESOLVED_MISSING_LABEL[instance.missing]}; review path: ${instance.reviewPath}`,
    `Requested draft: exact MPN ${spec.exactMpn}; manufacturer ${spec.manufacturer?.canonicalName ?? "not documented"}; package ${spec.package ? `${spec.package.code}, ${spec.package.mounting === "smd" ? "surface mount" : "through hole"}` : "not documented"}; ${spec.terminals.length} pin${spec.terminals.length === 1 ? "" : "s"} in the pin table; profile ${spec.profile}; datasheet ${spec.datasheet ? spec.datasheet.locator : "not cited"}. Verification: ${proposal.verification} — nothing here is a certificate, an approval or a publication.`,
    ...proposal.documented.map((fact) => `Documented: ${fact.fact} = ${fact.value} (source: ${fact.source})`),
    ...proposal.missing.map((fact) => `Missing: ${fact}`),
    proposal.pcbAssignment.blocked
      ? `PCB assignment: BLOCKED — ${proposal.pcbAssignment.blockers.join("; ")}`
      : "PCB assignment: not blocked by the documented facts — the deterministic mapping checks and the human publication still decide",
    proposal.catalogCrossCheck.state === "checked"
      ? `Catalog cross-check: compared against catalog part ${proposal.catalogCrossCheck.partId} (${proposal.catalogCrossCheck.compared.join(", ") || "nothing comparable"}); no conflict`
      : `Catalog cross-check: unavailable — ${proposal.catalogCrossCheck.reason}`,
    `Path: ${proposal.reviewTask.path}. ${proposal.reviewTask.decides}`,
    `Never: ${proposal.reviewTask.neverClaims}`,
    `Sealed by the assistant (${proposal.provenance.provider}) for this sheet; expires ${utcMinute(proposal.expiresAt)} UTC. "${DRAFT_REQUEST_OPEN_LABEL}" below opens the Build Library's evidence review prefilled from this request (this session only; after a reload, ask the assistant again). Nothing is requested until a person submits it there.`,
  ];
  return { title: `Review task — unverified draft request for ${instance.refDes} (${spec.exactMpn})`, lines };
}
