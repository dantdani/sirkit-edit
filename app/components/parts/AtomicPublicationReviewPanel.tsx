"use client";

/**
 * [B19-E E4] The visible atomic publication review (mirrors the component-binding review panel).
 *
 * An editor requests evidence review of an exact MPN: the symbol and footprint BY REFERENCE into the bundled KiCad library,
 * and the terminal table, package and datasheet citation they entered (the server records those as organization-authored under
 * that person). A reviewer sees the evidence the server assembled — each distributor fact by its labels only (source, cached or
 * live, observed, expires, stale), each document fact with its value — resolves the manufacturer and every conflict, rejects or
 * marks reviewed every quarantined fact, and approves; Approve stays disabled, with the reason shown, until all of that is done.
 * A different administrator publishes. Roles come from the server's viewer block; the server enforces every rule again.
 *
 * [B19-E E5] On a published request an administrator may withdraw the revision: deprecate, supersede (naming the successor) or
 * revoke, with a reason (OD-37, OD-38). Existing pins keep a deprecated or superseded revision; a revoked one fails closed.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { utcMinute } from "@/app/lib/acquisition/source-labels";
import { projectSelectorHeaders, type ProjectSelectorScope } from "@/app/lib/project/project-selector";
import {
  ATOMIC_PUBLICATION_BANNER,
  approvalBlockers,
  publishBlockers,
  requiredResolutionProperties,
  withdrawRevisionBlockers,
  resolvableFact,
  type AtomicPublicationLink, // [PR-M, 2026-10-18]
  type AtomicPublicationRequestView,
  type AtomicPublicationSpec,
  type ImportReviewFact,
  type ImportReviewLink,
  type ImportReviewProfile, // [PR-G]
  type ReviewDraftChoices,
  type WithdrawRevisionDraft,
} from "@/app/lib/atomic/publication-review-contract";
import { useAtomicPublicationReview, type UseAtomicPublicationReviewResult } from "./hooks/useAtomicPublicationReview";

export interface AtomicPublicationPrefill {
  exactMpn?: string;
  symbol?: { library: string; name: string } | null;
  footprint?: { library: string; name: string } | null;
  manufacturer?: string | null;
  partId?: string | null;
  /**
   * [B19-E E4 review] the part already has a default link: a publication never repoints one, so no link is offered.
   * [B19-E E4 review follow-up] a default link whose revision was withdrawn (or is missing) counts: it is still the part's link.
   */
  alreadyLinked?: boolean;
  /** [PR-G, 2026-10-17] the request's remaining fields, prefilled from a sealed agent draft request (app/lib/project/draft-request-events.ts
   *  `draftRequestPublicationPrefill`): the publication spec in the form's own fields; absent on every other caller (the form starts empty). */
  profile?: ImportReviewProfile;
  /** the terminal table as the textarea holds it: one `number function [pads]` line per pin */
  terminals?: string;
  packageCode?: string;
  mounting?: "smd" | "through_hole";
  datasheetUrl?: string;
  datasheetLocator?: string;
  /** [PR-M, 2026-10-18] Section M2: an ACQUIRED review package (a component review inbox handoff): the spec names the stored symbol and
   *  footprint objects (`acquired`), the links (or the one discovery row) the handoff decided, and what the person must still confirm.
   *  The symbol and footprint stay the acquired objects; every other field stays editable; nothing is requested until the person submits. */
  acquisition?: { handoffId: string; spec: AtomicPublicationSpec; links: AtomicPublicationLink[]; discovery: { valueKey: string } | null; notes: string[]; missing: string[]; conflicts: string[] };
}

const STATE_CLASS: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-200",
  approved: "bg-sky-500/20 text-sky-200",
  published: "bg-emerald-500/20 text-emerald-200",
  rejected: "bg-red-500/20 text-red-200",
  withdrawn: "bg-zinc-800 text-zinc-400",
  retired: "bg-zinc-800 text-zinc-400",
};

type SubmitDraft = { exactMpn: string; profile: "schematic_only" | "pcb_assignable"; symbolLibrary: string; symbolName: string; footprintLibrary: string; footprintName: string; terminals: string; packageCode: string; mounting: "smd" | "through_hole"; datasheetUrl: string; datasheetLocator: string; manufacturer: string; linkPart: boolean; reason: string };

/** [PR-M, 2026-10-18] The terminal table of a spec as the textarea holds it (`number function pads`, the parser's own format). */
function terminalText(terminals: AtomicPublicationSpec["terminals"]): string {
  return terminals.map((terminal) => `${terminal.number} ${terminal.function || terminal.number} ${terminal.pads.join(",")}`).join("\n");
}

const EMPTY_CHOICES: ReviewDraftChoices = { resolutions: {}, dispositions: {}, reason: "" };
const EMPTY_WITHDRAWAL: WithdrawRevisionDraft = { to: "deprecated", successorRevisionId: "", reason: "" };
const inputClass = "rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-100";

/** "1 GND" or "1 GND 1,1A" per line: terminal number, function, optional pads (defaults to the terminal number). */
function parseTerminalTable(text: string): AtomicPublicationSpec["terminals"] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    // [PR-G, 2026-10-17] `number function [pads]`: the first token is the number, the LAST token the pads when three or more tokens are
    // given, and everything between is the function (a sealed draft request's "GND: ground" keeps its space; a two-token line is
    // number + function as before, its pads the number).
    const [number = "", ...rest] = line.split(/\s+/);
    const pads = rest.length >= 2 ? rest.pop()! : "";
    return { number, function: rest.join(" "), pads: pads ? pads.split(",").filter(Boolean) : [number] };
  });
}

function specFrom(draft: SubmitDraft): AtomicPublicationSpec {
  return {
    exactMpn: draft.exactMpn.trim(),
    profile: draft.profile,
    symbol: draft.symbolLibrary.trim() && draft.symbolName.trim() ? { library: draft.symbolLibrary.trim(), name: draft.symbolName.trim() } : null,
    footprint: draft.footprintLibrary.trim() && draft.footprintName.trim() ? { library: draft.footprintLibrary.trim(), name: draft.footprintName.trim() } : null,
    terminals: parseTerminalTable(draft.terminals),
    package: draft.packageCode.trim() ? { code: draft.packageCode.trim(), mounting: draft.mounting } : null,
    datasheet: draft.datasheetLocator.trim() ? { url: draft.datasheetUrl.trim() || null, locator: draft.datasheetLocator.trim() } : null,
    manufacturer: draft.manufacturer.trim() ? { canonicalName: draft.manufacturer.trim(), officialDomains: [] } : null,
  };
}

function factLabel(fact: ImportReviewFact): string {
  if (fact.distributor) {
    return `${fact.distributor.displayName} · ${fact.distributor.basis} · observed ${utcMinute(Date.parse(fact.distributor.retrievedAt))} · ${fact.stale ? "stale" : `expires ${utcMinute(Date.parse(fact.distributor.expiresAt))}`} · value kept as a hash only`;
  }
  return `${fact.value ?? ""} — ${fact.sourceClass}${fact.superseded ? " (superseded)" : ""}${fact.locator ? ` · ${fact.locator}` : ""}`;
}

/** [B19-E E4 review] A link as the server read its catalog part: the symbol, the MPN it names, the value and the part id. */
function linkLabel(link: ImportReviewLink): string {
  return `${link.partSymbol || "part not found"} · ${link.partMpn ? `MPN ${link.partMpn}` : "no MPN (generic part)"} · ${link.valueKey === "" ? "default value" : `value ${link.valueKey}`} · part ${link.partId}`;
}

function publishLinksText(links: readonly ImportReviewLink[]): string {
  return links.length === 0 ? "Publishing writes no catalog part link." : `Publishing writes ${links.length} link${links.length === 1 ? "" : "s"}: ${links.map(linkLabel).join("; ")}`;
}

function Evidence({ request, choices, canResolve, setResolution, setManufacturer, setFactDisposition }: {
  request: AtomicPublicationRequestView;
  choices: ReviewDraftChoices;
  canResolve: boolean;
  setResolution(requestId: string, property: string, factId: string): void;
  setManufacturer(requestId: string, factId: string): void;
  setFactDisposition(requestId: string, factId: string, disposition: "rejected" | "reviewed" | ""): void;
}) {
  const { evidence } = request;
  const manufacturers = evidence.facts.filter((fact) => resolvableFact(fact, "manufacturer"));
  const conflicts = requiredResolutionProperties(evidence).filter((property) => property !== "manufacturer");
  return (
    <div className="mt-1 grid gap-1 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[10px] text-zinc-300" data-testid={`atomic-evidence-${request.requestId}`}>
      <div><span className="text-zinc-500">Exact MPN</span> {request.exactMpn} · {request.profile} · registry {evidence.registryVersion} · digest {evidence.reviewEvidenceDigest.slice(0, 19)}…</div>
      {evidence.missing.length > 0 && <div className="text-red-300">Missing: {evidence.missing.join(", ")}</div>}
      {evidence.authoringDiagnostics.map((note) => <div key={note} className="text-amber-300">{note}</div>)}
      {/* [B19-E E4 review] every link the publication would write is part of what the reviewer approves */}
      {evidence.links.length > 0 && (
        <div className="grid gap-0.5" data-testid={`atomic-links-${request.requestId}`}>
          <span className="text-zinc-500">Catalog part links written at publication</span>
          {evidence.links.map((link) => <span key={`${link.partId}|${link.valueKey}`} className="break-all">{linkLabel(link)}</span>)}
        </div>
      )}
      <ul className="grid gap-0.5">
        {evidence.facts.filter((fact) => fact.establishes !== "sourcing").map((fact) => (
          <li key={fact.factId} data-testid={`atomic-fact-${fact.factId}`} className="flex flex-wrap items-center gap-x-2">
            <span className="w-24 text-zinc-500">{fact.property}</span>
            <span className="rounded bg-zinc-800 px-1">{fact.establishes}</span>
            <span className="break-all">{factLabel(fact)}</span>
            {fact.establishes === "quarantined" && canResolve && request.effectiveStatus === "pending" && (
              <select className={inputClass} aria-label={`Disposition of quarantined ${fact.property}`} data-testid={`atomic-disposition-${fact.factId}`} value={choices.dispositions[fact.factId] ?? ""} onChange={(event) => setFactDisposition(request.requestId, fact.factId, event.target.value as "rejected" | "reviewed" | "")}>
                <option value="">decide…</option>
                <option value="rejected">reject</option>
                <option value="reviewed">mark reviewed</option>
              </select>
            )}
          </li>
        ))}
      </ul>
      {canResolve && request.effectiveStatus === "pending" && (
        <div className="grid gap-1">
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-500">Manufacturer</span>
            <select className={inputClass} data-testid={`atomic-manufacturer-${request.requestId}`} value={choices.resolutions.manufacturer ?? ""} onChange={(event) => setManufacturer(request.requestId, event.target.value)}>
              <option value="">choose…</option>
              {manufacturers.map((fact) => <option key={fact.factId} value={fact.factId}>{fact.value} ({fact.sourceClass})</option>)}
            </select>
          </label>
          {conflicts.map((property) => (
            <label key={property} className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-500">Resolve {property}</span>
              <select className={inputClass} data-testid={`atomic-resolution-${request.requestId}-${property}`} value={choices.resolutions[property] ?? ""} onChange={(event) => setResolution(request.requestId, property, event.target.value)}>
                <option value="">choose…</option>
                {evidence.facts.filter((fact) => resolvableFact(fact, property)).map((fact) => <option key={fact.factId} value={fact.factId}>{fact.value} ({fact.sourceClass})</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export interface AtomicPublicationReviewPanelProps {
  review: UseAtomicPublicationReviewResult;
  prefill?: AtomicPublicationPrefill;
}

export function AtomicPublicationReviewPanel({ review, prefill }: AtomicPublicationReviewPanelProps) {
  const { listing, busy } = review;
  const viewer = listing.status === "loaded" ? listing.viewer : null;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, ReviewDraftChoices>>({});
  const [publishReasons, setPublishReasons] = useState<Record<string, string>>({});
  const [withdrawals, setWithdrawals] = useState<Record<string, WithdrawRevisionDraft>>({}); // [B19-E E5] by request id
  const acquired = prefill?.acquisition ?? null; // [PR-M, 2026-10-18] M2: an acquired package prefills the form from its spec
  const [draft, setDraft] = useState<SubmitDraft>(() => acquired ? {
    exactMpn: acquired.spec.exactMpn, profile: acquired.spec.profile,
    symbolLibrary: acquired.spec.symbol?.library ?? "", symbolName: acquired.spec.symbol?.name ?? "",
    footprintLibrary: acquired.spec.footprint?.library ?? "", footprintName: acquired.spec.footprint?.name ?? "",
    terminals: terminalText(acquired.spec.terminals), packageCode: acquired.spec.package?.code ?? "", mounting: acquired.spec.package?.mounting ?? "through_hole",
    datasheetUrl: acquired.spec.datasheet?.url ?? "", datasheetLocator: acquired.spec.datasheet?.locator ?? "", manufacturer: acquired.spec.manufacturer?.canonicalName ?? "", linkPart: false, reason: "",
  } : ({
    exactMpn: prefill?.exactMpn ?? "", profile: prefill?.profile ?? "pcb_assignable", // [PR-G] a sealed draft request names its profile (schematic_only until every C.4 fact is documented)
    symbolLibrary: prefill?.symbol?.library ?? "", symbolName: prefill?.symbol?.name ?? "",
    footprintLibrary: prefill?.footprint?.library ?? "", footprintName: prefill?.footprint?.name ?? "",
    terminals: prefill?.terminals ?? "", packageCode: prefill?.packageCode ?? "", mounting: prefill?.mounting ?? "smd", datasheetUrl: prefill?.datasheetUrl ?? "", datasheetLocator: prefill?.datasheetLocator ?? "", manufacturer: prefill?.manufacturer ?? "", linkPart: false, reason: "", // [PR-G] the sealed spec's fields, or empty
  }));

  const choiceOf = (requestId: string): ReviewDraftChoices => choices[requestId] ?? EMPTY_CHOICES;
  const patchChoices = (requestId: string, patch: (current: ReviewDraftChoices) => ReviewDraftChoices) => setChoices((current) => ({ ...current, [requestId]: patch(current[requestId] ?? EMPTY_CHOICES) }));
  const setResolution = (requestId: string, property: string, factId: string) => patchChoices(requestId, (current) => ({ ...current, resolutions: { ...current.resolutions, [property]: factId } }));
  const setManufacturer = (requestId: string, factId: string) => patchChoices(requestId, (current) => ({ ...current, resolutions: { ...current.resolutions, manufacturer: factId } }));
  const setFactDisposition = (requestId: string, factId: string, disposition: "rejected" | "reviewed" | "") => patchChoices(requestId, (current) => ({ ...current, dispositions: { ...current.dispositions, [factId]: disposition } }));
  const setApproveReason = (requestId: string, reason: string) => patchChoices(requestId, (current) => ({ ...current, reason }));
  const setDraftField = <K extends keyof SubmitDraft>(field: K, value: SubmitDraft[K]) => setDraft((current) => ({ ...current, [field]: value }));

  async function submitRequest() {
    if (acquired) {
      // [PR-M, 2026-10-18] the acquired symbol and footprint objects stay the package's (the server re-verifies every byte); the links or the one
      // discovery row are the handoff's; the person's edits of the other fields are kept
      const spec = specFrom(draft);
      const withObjects: AtomicPublicationSpec = { ...spec, symbol: acquired.spec.symbol, footprint: draft.profile === "pcb_assignable" ? acquired.spec.footprint : spec.footprint };
      await review.submit({ spec: withObjects, links: draft.profile === "pcb_assignable" ? acquired.links : [], reason: draft.reason.trim() || `Component review of the acquired ${draft.exactMpn.trim()} (handoff ${acquired.handoffId.slice(0, 28)})`, ...(acquired.discovery && draft.profile === "pcb_assignable" ? { discovery: acquired.discovery } : {}) });
      return;
    }
    const links = draft.linkPart && prefill?.partId && !prefill.alreadyLinked && draft.profile === "pcb_assignable" ? [{ partId: prefill.partId, valueKey: "" }] : [];
    await review.submit({ spec: specFrom(draft), links, reason: draft.reason.trim() || `Evidence review requested for ${draft.exactMpn.trim()}` });
  }

  async function approveRequest(request: AtomicPublicationRequestView) {
    const current = choiceOf(request.requestId);
    const reason = current.reason.trim();
    const resolutions = requiredResolutionProperties(request.evidence).filter((property) => current.resolutions[property]).map((property) => ({ property, factId: current.resolutions[property]!, reason }));
    const factDispositions = request.evidence.facts.filter((fact) => fact.establishes === "quarantined" && current.dispositions[fact.factId]).map((fact) => ({ factId: fact.factId, disposition: current.dispositions[fact.factId] as "rejected" | "reviewed", note: reason }));
    await review.resolve({ requestId: request.requestId, decision: "approve", reason, reviewEvidenceDigest: request.evidence.reviewEvidenceDigest, resolutions, factDispositions });
  }

  async function rejectRequest(request: AtomicPublicationRequestView) {
    await review.resolve({ requestId: request.requestId, decision: "reject", reason: choiceOf(request.requestId).reason.trim() });
  }

  async function publishRequest(request: AtomicPublicationRequestView) {
    await review.publish(request.requestId, (publishReasons[request.requestId] ?? "").trim());
  }

  async function withdrawRequest(request: AtomicPublicationRequestView) {
    await review.withdraw(request.requestId, "withdrawn by the requester");
  }

  // [B19-E E5] the drafted withdrawal of a published request's revision; nothing is sent until withdrawRevision
  const withdrawalOf = (requestId: string): WithdrawRevisionDraft => withdrawals[requestId] ?? EMPTY_WITHDRAWAL;
  const setWithdrawalDraft = (requestId: string, patch: Partial<WithdrawRevisionDraft>) => setWithdrawals((current) => ({ ...current, [requestId]: { ...(current[requestId] ?? EMPTY_WITHDRAWAL), ...patch } }));

  async function withdrawRevision(request: AtomicPublicationRequestView) {
    const revisionId = request.publication?.revisionId;
    if (!revisionId) return;
    const draft = withdrawalOf(request.requestId);
    const successor = draft.successorRevisionId.trim();
    await review.withdrawRevision({ revisionId, to: draft.to, ...(successor ? { successorRevisionId: successor } : {}), reason: draft.reason.trim() });
  }

  const requests = listing.status === "loaded" ? listing.requests : [];
  return (
    <div className="rounded border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-[11px] text-zinc-200 shadow" data-testid="atomic-publication-panel">
      <div role="note" className="mb-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200" data-testid="atomic-publication-banner">{ATOMIC_PUBLICATION_BANNER}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-zinc-100">Atomic publication review</span>
        <span className="text-zinc-400" data-testid="atomic-publication-viewer">
          {listing.status === "loading" ? "Reading requests…" : listing.status === "failed" ? `Unavailable (${listing.code})` : viewer ? `${viewer.role}${viewer.canPublish ? " · may publish" : viewer.canResolve ? " · may approve" : viewer.canSubmit ? " · may request" : " · read-only"}` : "—"}
        </span>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void review.refresh()} disabled={busy !== null}>Refresh</Button>
      </div>
      {listing.status === "failed" && <div className="mt-1 text-red-300" role="alert">{listing.message}</div>}
      {review.lastError && (
        <div className="mt-1 text-red-300" role="alert" data-testid="atomic-publication-error">
          {review.lastError.message} ({review.lastError.code}){review.lastError.detail.length > 0 ? `: ${review.lastError.detail.join("; ")}` : ""}
        </div>
      )}
      {review.notice && <div className="mt-1 text-sky-300" role="status" data-testid="atomic-publication-notice">{review.notice}</div>}

      {viewer?.canSubmit && (
        <div className="mt-2 grid gap-1 rounded border border-zinc-800 p-2" data-testid="atomic-submit-form">
          <div className="text-zinc-400">Request evidence review of an exact part</div>
          {acquired && (
            <div className="grid gap-0.5 rounded border border-sky-900/60 bg-sky-950/20 p-1 text-[10px] text-zinc-300" data-testid="atomic-submit-acquired" data-handoff={acquired.handoffId}>
              <div className="text-sky-200">Acquired CAD assets (handoff {acquired.handoffId.slice(0, 28)}…): symbol {acquired.spec.symbol ? `${acquired.spec.symbol.library}:${acquired.spec.symbol.name} sha256:${acquired.spec.symbol.acquired?.objectHash.slice(0, 12) ?? ""}…` : "none"} · footprint {acquired.spec.footprint ? `${acquired.spec.footprint.library}:${acquired.spec.footprint.name} sha256:${acquired.spec.footprint.acquired?.objectHash.slice(0, 12) ?? ""}…` : "none"}</div>
              <div>{acquired.links.length > 0 ? `Publishing links catalog part ${acquired.links.map((link) => link.partId).join(", ")}` : acquired.discovery ? "Publishing writes one discovery catalog part for the revision" : "Publishing writes no catalog part link"}</div>
              {acquired.notes.map((note) => <div key={note} className="text-zinc-400">{note}</div>)}
              {acquired.missing.length > 0 && <div className="text-amber-300">Still to confirm: {acquired.missing.join("; ")}</div>}
              {acquired.conflicts.length > 0 && <div className="text-amber-300">Conflicts: {acquired.conflicts.join("; ")}</div>}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            <input className={inputClass} aria-label="Exact MPN" placeholder="Exact MPN" data-testid="atomic-submit-exact-mpn" value={draft.exactMpn} onChange={(event) => setDraftField("exactMpn", event.target.value)} />
            <select className={inputClass} aria-label="Approval profile" value={draft.profile} onChange={(event) => setDraftField("profile", event.target.value as SubmitDraft["profile"])}>
              <option value="pcb_assignable">schematic and PCB</option>
              <option value="schematic_only">schematic only</option>
            </select>
            <input className={inputClass} aria-label="Manufacturer" placeholder="Manufacturer (from the datasheet)" value={draft.manufacturer} onChange={(event) => setDraftField("manufacturer", event.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1">
            <input className={inputClass} aria-label="Symbol library" readOnly={acquired !== null} placeholder="KiCad symbol library" value={draft.symbolLibrary} onChange={(event) => setDraftField("symbolLibrary", event.target.value)} />
            <input className={inputClass} aria-label="Symbol name" readOnly={acquired !== null} placeholder="Symbol" value={draft.symbolName} onChange={(event) => setDraftField("symbolName", event.target.value)} />
            <input className={inputClass} aria-label="Footprint library" readOnly={acquired !== null} placeholder="KiCad footprint library" value={draft.footprintLibrary} onChange={(event) => setDraftField("footprintLibrary", event.target.value)} />
            <input className={inputClass} aria-label="Footprint name" readOnly={acquired !== null} placeholder="Footprint" value={draft.footprintName} onChange={(event) => setDraftField("footprintName", event.target.value)} />
          </div>
          <textarea className={`${inputClass} min-h-[3rem]`} aria-label="Terminal table" placeholder={"Terminal table, one per line: number function [pads]"} value={draft.terminals} onChange={(event) => setDraftField("terminals", event.target.value)} />
          <div className="flex flex-wrap gap-1">
            <input className={inputClass} aria-label="Package code" placeholder="Package (e.g. SOIC-8)" value={draft.packageCode} onChange={(event) => setDraftField("packageCode", event.target.value)} />
            <select className={inputClass} aria-label="Mounting" value={draft.mounting} onChange={(event) => setDraftField("mounting", event.target.value as SubmitDraft["mounting"])}>
              <option value="smd">surface mount</option>
              <option value="through_hole">through hole</option>
            </select>
            <input className={inputClass} aria-label="Datasheet link" placeholder="Datasheet link" value={draft.datasheetUrl} onChange={(event) => setDraftField("datasheetUrl", event.target.value)} />
            <input className={inputClass} aria-label="Datasheet citation" placeholder="Datasheet table or page" value={draft.datasheetLocator} onChange={(event) => setDraftField("datasheetLocator", event.target.value)} />
          </div>
          {prefill?.partId && !prefill.alreadyLinked && (
            <label className="flex items-center gap-1 text-zinc-400">
              <input type="checkbox" checked={draft.linkPart} onChange={(event) => setDraftField("linkPart", event.target.checked)} /> Link this catalog part when published
            </label>
          )}
          {prefill?.partId && prefill.alreadyLinked && <div className="text-zinc-500">This catalog part is already linked to an atomic revision (published, or since withdrawn); a publication never repoints a link, so no link is offered.</div>}
          <div className="flex flex-wrap gap-1">
            <input className={`${inputClass} min-w-[14rem] flex-1`} aria-label="Request reason" placeholder="Why this part" value={draft.reason} onChange={(event) => setDraftField("reason", event.target.value)} />
            <Button size="sm" className="h-6 px-2 text-[10px]" data-testid="atomic-submit" disabled={busy !== null || draft.exactMpn.trim() === ""} onClick={() => void submitRequest()}>Request evidence review</Button>
          </div>
        </div>
      )}

      <ul className="mt-2 grid gap-1">
        {requests.map((request) => {
          const current = choiceOf(request.requestId);
          const approveReasons = approvalBlockers(request, viewer, current);
          const publishReason = publishReasons[request.requestId] ?? "";
          const publishReasonsList = publishBlockers(request, viewer, publishReason);
          const mine = Boolean(viewer && request.requestedBy.actorId === viewer.actorId);
          const open = expanded === request.requestId;
          return (
            <li key={request.requestId} className="rounded px-1 py-0.5 hover:bg-zinc-800/40" data-testid={`atomic-publication-request-${request.requestId}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-zinc-100">{request.exactMpn}</span>
                <span className={`rounded px-1.5 py-0.5 ${STATE_CLASS[request.effectiveStatus] ?? ""}`} data-state={request.effectiveStatus}>{request.effectiveStatus}</span>
                <span className="text-zinc-500">requested by {request.requestedBy.actorId}</span>
                {request.decision && <span className="text-zinc-400">— {request.decision.decision === "approve" ? "approved" : "rejected"} by {request.decision.decidedBy.actorId}: {request.decision.reason}</span>}
                {request.retirement && <span className="text-zinc-400">— {request.retirement.detail}</span>}
                {request.publication && <span className="text-emerald-300">— revision {request.publication.revisionId.slice(0, 18)}…</span>}
                <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px]" data-testid={`atomic-expand-${request.requestId}`} onClick={() => setExpanded(open ? null : request.requestId)}>{open ? "Hide evidence" : "Evidence"}</Button>
                {mine && (request.effectiveStatus === "pending" || request.effectiveStatus === "approved") && (
                  <Button size="sm" variant="outline" className="h-5 px-2 text-[10px]" data-testid={`atomic-withdraw-${request.requestId}`} disabled={busy !== null} onClick={() => void withdrawRequest(request)}>Withdraw</Button>
                )}
              </div>
              {/* [B19-E E5] an administrator withdraws the published revision: deprecate, supersede with its successor, or revoke */}
              {request.effectiveStatus === "published" && request.publication && viewer?.canPublish && (() => {
                const draft = withdrawalOf(request.requestId);
                const blockers = withdrawRevisionBlockers(request.publication.revisionId, viewer, draft);
                return (
                  <div className="mt-1 grid gap-1 rounded border border-zinc-800 p-1" data-testid={`atomic-withdraw-revision-form-${request.requestId}`}>
                    <div className="flex flex-wrap items-center gap-1">
                      <select className={inputClass} aria-label="Withdrawal state" data-testid={`atomic-withdraw-revision-state-${request.requestId}`} value={draft.to} onChange={(event) => setWithdrawalDraft(request.requestId, { to: event.target.value as WithdrawRevisionDraft["to"] })}>
                        <option value="deprecated">deprecate (existing pins keep it)</option>
                        <option value="superseded">supersede by a successor</option>
                        <option value="revoked">revoke (fails closed everywhere)</option>
                      </select>
                      <input className={inputClass} aria-label="Successor revision" placeholder="Successor revision id" data-testid={`atomic-withdraw-revision-successor-${request.requestId}`} value={draft.successorRevisionId} onChange={(event) => setWithdrawalDraft(request.requestId, { successorRevisionId: event.target.value })} />
                      <input className={`${inputClass} min-w-[12rem] flex-1`} aria-label="Withdrawal reason" placeholder="Withdrawal reason" data-testid={`atomic-withdraw-revision-reason-${request.requestId}`} value={draft.reason} onChange={(event) => setWithdrawalDraft(request.requestId, { reason: event.target.value })} />
                      <Button size="sm" variant="destructive" className="h-5 px-2 text-[10px]" data-testid={`atomic-withdraw-revision-${request.requestId}`} disabled={busy !== null || blockers.length > 0} onClick={() => void withdrawRevision(request)}>Withdraw revision</Button>
                    </div>
                    {blockers.length > 0 && <ul className="list-disc pl-4 text-amber-300" data-testid={`atomic-withdraw-revision-blockers-${request.requestId}`}>{blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                  </div>
                );
              })()}
              {open && (
                <>
                  <Evidence request={request} choices={current} canResolve={Boolean(viewer?.canResolve)} setResolution={setResolution} setManufacturer={setManufacturer} setFactDisposition={setFactDisposition} />
                  {request.effectiveStatus === "pending" && viewer?.canResolve && (
                    <div className="mt-1 grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input className={`${inputClass} min-w-[14rem] flex-1`} aria-label="Decision reason" placeholder="Decision reason" data-testid={`atomic-approve-reason-${request.requestId}`} value={current.reason} onChange={(event) => setApproveReason(request.requestId, event.target.value)} />
                        <Button size="sm" className="h-5 px-2 text-[10px]" data-testid={`atomic-approve-${request.requestId}`} disabled={busy !== null || approveReasons.length > 0} onClick={() => void approveRequest(request)}>Approve</Button>
                        <Button size="sm" variant="destructive" className="h-5 px-2 text-[10px]" data-testid={`atomic-reject-${request.requestId}`} disabled={busy !== null || current.reason.trim() === ""} onClick={() => void rejectRequest(request)}>Reject</Button>
                      </div>
                      {approveReasons.length > 0 && <ul className="list-disc pl-4 text-amber-300" data-testid={`atomic-approve-blockers-${request.requestId}`}>{approveReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                    </div>
                  )}
                  {request.effectiveStatus === "approved" && viewer?.canPublish && (
                    <div className="mt-1 grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input className={`${inputClass} min-w-[14rem] flex-1`} aria-label="Publication reason" placeholder="Publication reason" data-testid={`atomic-publish-reason-${request.requestId}`} value={publishReason} onChange={(event) => setPublishReasons((currentReasons) => ({ ...currentReasons, [request.requestId]: event.target.value }))} />
                        <Button size="sm" className="h-5 px-2 text-[10px]" data-testid={`atomic-publish-${request.requestId}`} disabled={busy !== null || publishReasonsList.length > 0} onClick={() => void publishRequest(request)}>Publish revision</Button>
                      </div>
                      {/* [B19-E E4 review] the publisher sees exactly which links the publication writes */}
                      <div className="break-all text-zinc-400" data-testid={`atomic-publish-links-${request.requestId}`}>{publishLinksText(request.evidence.links)}</div>
                      {publishReasonsList.length > 0 && <ul className="list-disc pl-4 text-amber-300" data-testid={`atomic-publish-blockers-${request.requestId}`}>{publishReasonsList.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {listing.status === "loaded" && requests.length === 0 && <div className="mt-1 text-zinc-500">No publication requests.</div>}
    </div>
  );
}

/** [B19-E E4] The panel over its hook, for a project selector (the Build Library mounts it). */
export function AtomicPublicationReviewSection({ projectScope, prefill }: { projectScope: ProjectSelectorScope; prefill?: AtomicPublicationPrefill }) {
  const review = useAtomicPublicationReview({ enabled: true, scopeHeaders: () => projectSelectorHeaders(projectScope) });
  return <AtomicPublicationReviewPanel review={review} prefill={prefill} />;
}
