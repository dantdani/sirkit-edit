"use client";

/**
 * [B16-C.2] The visible component-binding REVIEW HANDOFF.
 *
 * Editors see every exact candidate on the board with its durable review
 * state and can REQUEST review (one or all). Reviewers / administrators see
 * the pending requests with the server-projected evidence — exact candidate,
 * symbol, footprint, package, pin-to-pad certificate, source revisions — and
 * APPROVE or REJECT with a reason. Roles come from the server's viewer block,
 * never from the browser; a request the server retired (revoked membership or
 * changed role) shows why. Nothing here binds anything itself.
 *
 * [B19-E E5] Each bound revision's catalog status is shown when it is no longer plainly published (OD-38). For a withdrawn
 * revision that names a successor, anyone who may use the review previews the upgrade diff; a reviewer or administrator
 * rebinds with a reason and the previewed digest (disabled, with the reason shown, while the diff has blockers). The server
 * recomputes the diff and supersedes the old binding and approves the successor in one commit.
 *
 * [B19-E E5 review] Preview successor is offered only while the component's effective approved binding is the withdrawn revision
 * (the server refuses every other move), toward the first selectable revision of the successor chain. When the binding already
 * names another revision, what remains is replacing the schematic instance; with no approved binding, a withdrawn revision is not
 * bound anew and the part is replaced with a published revision. Both are said instead of a preview that would be refused.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ComponentReviewRow, UseComponentReviewResult } from "./hooks/useComponentReview";
import type { AtomicRevisionStatusView } from "@/app/lib/atomic/revision-status";
import type { AtomicSuccessorPreview } from "@/app/lib/physical-binding/atomic-successor";

const STATE_LABEL: Record<ComponentReviewRow["state"], string> = {
  none: "Not requested",
  pending: "Awaiting reviewer",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  retired: "Retired",
};
const STATE_CLASS: Record<ComponentReviewRow["state"], string> = {
  none: "bg-zinc-800 text-zinc-300",
  pending: "bg-amber-500/20 text-amber-200",
  approved: "bg-emerald-500/20 text-emerald-200",
  rejected: "bg-red-500/20 text-red-200",
  withdrawn: "bg-zinc-800 text-zinc-400",
  retired: "bg-zinc-800 text-zinc-400",
};

const short = (value: string | null | undefined, n = 12) => value ? (value.length > n ? `${value.slice(0, n)}…` : value) : "—";

function Evidence({ row }: { row: ComponentReviewRow }) {
  const evidence = row.request?.evidence;
  if (!evidence) return null;
  return (
    <div className="mt-1 grid gap-1 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-[10px] text-zinc-300" data-testid={`review-evidence-${row.component.refDes}`}>
      {/* [B19-E E5] e.g. symbol differs from revision: the server refuses to approve such a request */}
      {(evidence.blockers ?? []).map((blocker) => <div key={blocker} className="text-red-300" data-testid={`review-evidence-blocker-${row.component.refDes}`}>{blocker}</div>)}
      <div><span className="text-zinc-500">Candidate</span> {evidence.candidate.exactMpn} · {evidence.candidate.manufacturerName || evidence.candidate.manufacturerId} · rev {short(evidence.candidate.atomicPartRevisionId, 18)}</div>
      <div><span className="text-zinc-500">Symbol</span> {evidence.symbol.symbolName} ({evidence.symbol.pinCount} pins) · {short(evidence.symbol.versionId, 18)}</div>
      <div><span className="text-zinc-500">Footprint</span> {evidence.footprint ? `${evidence.footprint.libraryNickname ? `${evidence.footprint.libraryNickname}:` : ""}${evidence.footprint.footprintName} · ${evidence.footprint.electricalPadCount} electrical / ${evidence.footprint.mechanicalPadCount} mechanical pads · ${short(evidence.footprint.versionId, 18)}` : "none"}</div>
      <div><span className="text-zinc-500">Package</span> {evidence.package ? `${evidence.package.canonicalName} · ${evidence.package.pinCount} pins · ${evidence.package.mountingTechnology}` : "none"}</div>
      <div>
        <span className="text-zinc-500">Pin → pad</span> {evidence.pinToPad ? `${evidence.pinToPad.state} · ${evidence.pinToPad.entries.length} terminals` : "no certificate"}
        {evidence.pinToPad && (
          <table className="mt-0.5 w-full border-collapse">
            <tbody>
              {evidence.pinToPad.entries.map((entry) => (
                <tr key={entry.terminalId} className="border-t border-zinc-800/60">
                  <td className="pr-2 text-zinc-400">{short(entry.terminalId, 22)}</td>
                  <td className="pr-2">{entry.symbolPinIds.map((id) => id.split(":").pop()).join(", ")}</td>
                  <td>pads {entry.padNumbers.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {evidence.pinToPad && (evidence.pinToPad.missingTerminalIds.length > 0 || evidence.pinToPad.missingPadNumbers.length > 0 || evidence.pinToPad.ambiguous.length > 0) && (
          <div className="text-red-300">missing terminals {evidence.pinToPad.missingTerminalIds.length}, missing pads {evidence.pinToPad.missingPadNumbers.length}, ambiguous {evidence.pinToPad.ambiguous.length}</div>
        )}
      </div>
      <div><span className="text-zinc-500">Sources</span> symbol {short(evidence.sourceRevisions.symbolVersionId, 14)} · footprint {short(evidence.sourceRevisions.footprintVersionId, 14)} · mapping {short(evidence.sourceRevisions.mappingId, 14)} · captured {evidence.sourceRevisions.capturedAt.slice(0, 10)} · {evidence.evidenceRefs.length} evidence refs · {short(evidence.evidenceDigest, 20)}</div>
    </div>
  );
}

/** [B19-E E5] a bound revision's catalog status in words; null while published */
function catalogStatusWords(status: AtomicRevisionStatusView | undefined): string | null {
  if (!status || status.state === "published") return null;
  if (status.state === "unpublished") return "Revision not published";
  // [B19-E E5 review] a named successor that was itself withdrawn: the chain's first selectable revision is the one to move to
  const later = status.selectableSuccessorRevisionId && status.selectableSuccessorRevisionId !== status.successorRevisionId ? ` (itself withdrawn; current successor ${short(status.selectableSuccessorRevisionId, 18)})` : "";
  const successor = status.successorRevisionId ? `successor ${short(status.successorRevisionId, 18)}${later}` : "no successor named";
  if (status.state === "revoked") return `Revoked — fails closed; ${successor}`;
  return `${status.state === "deprecated" ? "Deprecated" : "Superseded"} — existing pin keeps working; ${successor}`;
}

/** [B19-E E5] the successor diff a reviewer reviews, and the rebind (reviewers and administrators only) */
function SuccessorReview({ refDes, preview, canResolve, reason, busy, setReason, rebind }: { refDes: string; preview: AtomicSuccessorPreview; canResolve: boolean; reason: string; busy: boolean; setReason(value: string): void; rebind(): void }) {
  const { diff } = preview;
  const reasons = [...diff.blockers, ...(reason.trim() ? [] : ["Write the rebind reason."])];
  return (
    <div className="mt-1 grid gap-1 rounded border border-sky-900/60 bg-zinc-950/60 p-2 text-[10px] text-zinc-300" data-testid={`review-successor-diff-${refDes}`}>
      <div><span className="text-zinc-500">Successor</span> {short(preview.fromRevisionId, 18)} ({preview.fromStatus}) → {short(preview.toRevisionId, 18)} ({preview.toStatus})</div>
      <div><span className="text-zinc-500">Impacts</span> {diff.impacts.join(", ") || "none"}</div>
      <div><span className="text-zinc-500">Invalidates</span> {diff.invalidates.join(", ") || "nothing"}</div>
      {diff.blockers.length > 0 && <div className="text-red-300">Blocked: {diff.blockers.join("; ")}</div>}
      {canResolve ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-[14rem] flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-100"
            placeholder="Rebind reason (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-testid={`review-successor-reason-${refDes}`}
          />
          <Button size="sm" className="h-5 px-2 text-[10px]" onClick={rebind} disabled={busy || reasons.length > 0} title={reasons.join(" ")} data-testid={`review-successor-rebind-${refDes}`}>Rebind to successor</Button>
        </div>
      ) : (
        <div className="text-zinc-400">Rebinding to the successor is a reviewer or a project administrator&apos;s act.</div>
      )}
    </div>
  );
}

export interface ComponentReviewPanelProps { review: UseComponentReviewResult }

export function ComponentReviewPanel({ review }: ComponentReviewPanelProps) {
  const { listing, rows, busy, pendingCount } = review;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [rebindReasons, setRebindReasons] = useState<Record<string, string>>({}); // [B19-E E5]
  const viewer = listing.status === "loaded" ? listing.viewer : null;
  const requestable = rows.filter((row) => row.state === "none" || row.state === "rejected" || row.state === "withdrawn" || row.state === "retired");
  if (rows.length === 0 && listing.status !== "failed") return null;
  return (
    <div className="rounded border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-[11px] text-zinc-200 shadow" data-testid="component-review-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-zinc-100">Component review</span>
        <span className="text-zinc-400" data-testid="component-review-viewer">
          {listing.status === "loading" ? "Reading review requests…" : listing.status === "failed" ? `Review requests unreadable (${listing.code})` : viewer ? `${viewer.role}${viewer.canResolve ? " · may approve" : viewer.canRequest ? " · may request" : " · read-only"}${listing.status === "loaded" && !listing.membershipVerified ? " · membership unverified" : ""}` : "—"}
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-100" data-testid="component-review-pending">{pendingCount} pending</span>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void review.refresh()} disabled={busy !== null} data-testid="component-review-refresh">Refresh</Button>
        {viewer?.canRequest && requestable.length > 0 && (
          <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => void review.requestAll()} disabled={busy !== null} data-testid="review-request-all">Request review for {requestable.length}</Button>
        )}
      </div>
      {listing.status === "failed" && <div className="mt-1 text-red-300" role="alert">{listing.message}</div>}
      {review.lastError && <div className="mt-1 text-red-300" role="alert" data-testid="component-review-error">{review.lastError.message} ({review.lastError.code})</div>}
      <ul className="mt-1 grid gap-0.5">
        {rows.map((row) => {
          const ref = row.component.refDes;
          const request = row.request;
          const mine = Boolean(viewer && request && request.requestedBy.actorId === viewer.actorId);
          const reason = reasons[ref] ?? "";
          const catalogWords = catalogStatusWords(review.statuses[row.component.atomicPartRevisionId]); // [B19-E E5]
          const status = review.statuses[row.component.atomicPartRevisionId];
          const successor = status?.selectableSuccessorRevisionId ?? status?.successorRevisionId ?? null;
          const preview = review.previews[row.component.id];
          // [B19-E E5 review] undefined until read; the from revision the server accepts is the effective approved binding's
          const effective = review.effectiveRevisions[row.component.id];
          const boundHere = effective === row.component.atomicPartRevisionId;
          const nextStep = !catalogWords || effective === undefined || boundHere ? null
            : effective === null ? "No approved binding on this revision: a withdrawn revision is not bound anew; replace the part with a published revision."
              : `Bound to revision ${short(effective, 18)}: replace this schematic instance with that revision to finish the move.`;
          return (
            <li key={row.component.id} className="rounded px-1 py-0.5 hover:bg-zinc-800/40" data-testid={`review-row-${ref}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="w-10 font-mono text-zinc-100">{ref}</span>
                <span className="text-zinc-400">{request?.evidence.candidate.exactMpn ?? short(row.component.atomicPartRevisionId, 16)}</span>
                <span className={`rounded px-1.5 py-0.5 ${STATE_CLASS[row.state]}`} data-testid={`review-state-${ref}`} data-state={row.state}>{STATE_LABEL[row.state]}</span>
                {row.state === "rejected" && request?.decision && <span className="text-red-300">— {request.decision.reason}</span>}
                {row.state === "retired" && request?.retirement && <span className="text-zinc-400">— {request.retirement.detail}</span>}
                {viewer?.canRequest && (row.state === "none" || row.state === "rejected" || row.state === "withdrawn" || row.state === "retired") && (
                  <Button size="sm" className="h-5 px-2 text-[10px]" onClick={() => void review.request(row.component)} disabled={busy !== null} data-testid={`review-request-${ref}`}>Request review</Button>
                )}
                {row.state === "pending" && mine && (
                  <Button size="sm" variant="outline" className="h-5 px-2 text-[10px]" onClick={() => void review.withdraw(request!.requestId)} disabled={busy !== null} data-testid={`review-withdraw-${ref}`}>Withdraw</Button>
                )}
                {request && (
                  <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px]" onClick={() => setExpanded(expanded === ref ? null : ref)} data-testid={`review-evidence-toggle-${ref}`}>{expanded === ref ? "Hide evidence" : "Evidence"}</Button>
                )}
                {catalogWords && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200" data-testid={`review-catalog-status-${ref}`}>{catalogWords}</span>}
                {catalogWords && successor && boundHere && (viewer?.canRequest || viewer?.canResolve) && (
                  <Button size="sm" variant="outline" className="h-5 px-2 text-[10px]" onClick={() => void review.previewSuccessor(row.component)} disabled={busy !== null} data-testid={`review-successor-preview-${ref}`}>Preview successor</Button>
                )}
              </div>
              {nextStep && <div className="mt-1 text-[10px] text-zinc-400" data-testid={`review-successor-next-${ref}`}>{nextStep}</div>}
              {preview && <SuccessorReview refDes={ref} preview={preview} canResolve={Boolean(viewer?.canResolve)} reason={rebindReasons[ref] ?? ""} busy={busy !== null} setReason={(value) => setRebindReasons((current) => ({ ...current, [ref]: value }))} rebind={() => void review.rebindSuccessor(row.component, (rebindReasons[ref] ?? "").trim())} />}
              {expanded === ref && <Evidence row={row} />}
              {viewer?.canResolve && row.state === "pending" && request && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input
                    className="min-w-[14rem] flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-100"
                    placeholder="Decision reason (required to reject)"
                    value={reason}
                    onChange={(event) => setReasons((current) => ({ ...current, [ref]: event.target.value }))}
                    data-testid={`review-reason-${ref}`}
                  />
                  <Button size="sm" className="h-5 px-2 text-[10px]" onClick={() => void review.resolve(request.requestId, "approve", reason.trim() || `Approved ${ref}: candidate, footprint and pin map verified`)} disabled={busy !== null || (request.evidence.blockers ?? []).length > 0} title={(request.evidence.blockers ?? []).join(" ")} data-testid={`review-approve-${ref}`}>Approve</Button>
                  <Button size="sm" variant="destructive" className="h-5 px-2 text-[10px]" onClick={() => void review.resolve(request.requestId, "reject", reason.trim())} disabled={busy !== null || reason.trim().length === 0} data-testid={`review-reject-${ref}`}>Reject</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
