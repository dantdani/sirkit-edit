"use client";

/**
 * B16.1C §F — the visible manufacturing workflow: hydration status, the
 * explicit workflow state reconstructed from durable truth, qualification /
 * release actions that are disabled while the same operation is pending, a
 * SEPARATE administrator confirmation for release, explicit idempotent
 * retry, actionable bounded errors, and the release result (filename,
 * archive digest, authority revision, download).
 *
 * [B16-A] F13: a failed hydration renders its own state — never the idle
 * label; F14: a viewer the server says may not release sees the button
 * disabled with the reason; F18: the result text says exactly what was
 * verified (Sirkit's own read-back, not a third-party DFM check).
 */

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProviderObservationList } from "./ProviderObservationList"; import type { UseManufacturingWorkflowResult } from "./hooks/useManufacturingWorkflow"; import { ProviderExchangePanel } from "./ProviderExchangePanel"; // [B23-B1] appended in place: every later line keeps the number B16-B23 pages cite [B23-B3] the observation list is imported first on this line, so B1's cited text stays whole

const STATE_LABEL: Record<string, string> = {
  idle: "No durable board yet — synchronize the schematic to the PCB",
  hydrating_project: "Reading durable truth…",
  hydration_failed: "Durable truth could not be read — retry hydration",
  awaiting_qualification: "Durable board synchronized — qualification needed",
  qualifying: "Qualifying (server-owned placement + routing)…",
  qualification_failed: "Qualification failed",
  qualified: "Qualified — release can be requested",
  awaiting_release_authorization: "Awaiting administrator authorization",
  releasing: "Releasing…",
  release_failed: "Release failed",
  released: "Released",
};

const short = (value: string | null | undefined, n = 14) => value ? `${value.slice(0, n)}…` : "—";

export interface ManufacturingWorkflowPanelProps {
  workflow: UseManufacturingWorkflowResult;
  qualifying: boolean;
  canQualify: boolean;
  onQualify(): void;
  routeStaleNotice?: string | null; /** [PR-L6, 2026-10-19] runbook M.4 / M.5-7 (OD-253 item 8): the board is behind the schematic (schematic-drift.ts, derived from facts) - Request release and Authorize release stay disabled with this reason */ boardBehindNotice?: string | null;
}

export function ManufacturingWorkflowPanel({ workflow, qualifying, canQualify, onQualify, routeStaleNotice = null, boardBehindNotice = null }: ManufacturingWorkflowPanelProps) {
  const { hydration, truth, releasing, releaseConfirmation, releaseResult, error, canRequestRelease, releaseCapability } = workflow;
  // [B16-A F13] a failed hydration is its own state; "idle" is reserved for a truthful "no durable board yet".
  const state = qualifying ? "qualifying" : releasing ? "releasing" : releaseConfirmation ? "awaiting_release_authorization" : error?.operation === "release" ? "release_failed" : workflow.workflow?.state ?? (hydration.status === "loading" ? "hydrating_project" : hydration.status === "failed" ? "hydration_failed" : "idle");
  const identity = workflow.workflow?.identity;
  const pending = qualifying || releasing || hydration.status === "loading";
  const unreadable = hydration.status === "failed";
  const releaseTitle = boardBehindNotice ? `Release blocked — ${boardBehindNotice}` : routeStaleNotice ? `Release blocked — ${routeStaleNotice}` : !releaseCapability.allowed ? releaseCapability.reason ?? "This viewer may not authorize a manufacturing release" : !canRequestRelease ? "Release needs a CURRENT qualification authority for this exact board" : "Request a verified manufacturing release (administrator confirmation follows)";
  return (
    <div className="rounded border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-[11px] text-zinc-200 shadow" data-testid="p2g-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-zinc-100">Manufacturing workflow</span>
        <span data-testid="p2g-hydration" className={hydration.status === "failed" ? "text-red-300" : "text-zinc-400"}>
          {hydration.status === "loading" ? "Hydrating durable truth…" : hydration.status === "loaded" ? "Durable truth loaded" : hydration.status === "failed" ? `Hydration failed (${hydration.code})` : "Not hydrated"}
        </span>
        <span data-testid="p2g-workflow-state" data-state={state} className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-100">{STATE_LABEL[state] ?? state}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-zinc-400" data-testid="p2g-identity">
        <span>board {short(identity?.boardRevision ?? (hydration.status === "loaded" ? hydration.boardRevision : null))}</span>
        <span>authority {unreadable ? "unreadable" : truth?.authority ? `r${truth.authority.revision}${truth.authority.current ? "" : " (stale)"} ${short(truth.authority.recordDigest, 18)}` : "none"}</span>
        <span>release {unreadable ? "unreadable" : truth?.latestRelease ? `${truth.latestRelease.filename}${truth.latestRelease.current ? "" : " (stale)"}` : "none"}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" data-testid="p2g-qualify" onClick={onQualify} disabled={pending || !canQualify} title={!canQualify ? "Needs an applied durable board — run Schematic → PCB and apply the plan first" : "Server-side autonomous placement + real routing + RC01–RC03 verification"} className="rounded border border-zinc-600 px-2 py-1 hover:border-teal-500 disabled:opacity-50">
          {qualifying ? "Qualifying…" : "Qualify & route"}
        </button>
        <button type="button" data-testid="p2g-request-release" onClick={workflow.requestRelease} disabled={pending || !canRequestRelease || !releaseCapability.allowed || routeStaleNotice !== null || boardBehindNotice !== null} title={releaseTitle} className="rounded border border-zinc-600 px-2 py-1 hover:border-teal-500 disabled:opacity-50">
          {releasing ? "Releasing…" : "Request release"}
        </button>
        {error && (
          <button type="button" data-testid="p2g-retry" onClick={() => void workflow.retry()} disabled={pending} className="rounded border border-amber-500/60 px-2 py-1 text-amber-200 hover:border-amber-400 disabled:opacity-50">
            Retry {error.operation === "hydrate" ? "hydration" : "release"}
          </button>
        )}
        <button type="button" data-testid="p2g-refresh" onClick={() => void workflow.refresh()} disabled={pending} className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:border-zinc-500 disabled:opacity-50">Refresh</button>
      </div>
      {hydration.status === "loaded" && !releaseCapability.allowed && releaseCapability.reason && (
        <div className="mt-1 text-zinc-400" data-testid="p2g-release-capability">{releaseCapability.reason}</div>
      )}
      {error && (
        <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-200" data-testid="p2g-error">
          <span className="font-medium">{error.code}</span> — {error.message}
          {error.correlationId && <span className="ml-2 text-red-300/80">(correlation {error.correlationId})</span>}
        </div>
      )}
      {releaseResult && (
        <div className="mt-2 rounded border border-teal-500/40 bg-teal-500/10 px-2 py-1 text-teal-100" data-testid="p2g-release-result">
          <div>Released <span className="font-mono" data-testid="p2g-release-filename">{releaseResult.filename}</span> ({releaseResult.byteLength} bytes)</div>
          <div className="text-teal-200/90">archive sha256 <span className="font-mono" data-testid="p2g-release-sha">{releaseResult.archiveSha256}</span></div>
          <div className="text-teal-200/90">release id <span className="font-mono">{releaseResult.releaseId}</span> · authority r<span data-testid="p2g-release-authority">{releaseResult.authorityRevision}</span> {short(releaseResult.authorityDigest, 18)} · board {short(releaseResult.boardRevision)} · ledger {releaseResult.recorded}</div>
          {releaseResult.blobUrl && <a href={releaseResult.blobUrl} download={releaseResult.filename} data-testid="p2g-download" className="underline">Download again</a>}
          <div className="text-teal-200/70">Gerbers generated and read back on the server by Sirkit&apos;s internal parser (not a third-party DFM check). This is not a fabricated, ordered, assembled, or electrically certified board.</div>
        </div>
      )}
      <Dialog open={releaseConfirmation !== null} onOpenChange={(open) => { if (!open) workflow.cancelRelease(); }}>
        <DialogContent data-testid="p2g-release-dialog">
          <DialogHeader>
            <DialogTitle>Authorize manufacturing release?</DialogTitle>
            <DialogDescription>A project administrator authorizes the release of exactly this sealed qualification authority. The server re-reads the durable authority, re-verifies parity, routing, DRC and capability, regenerates the Gerber/Excellon files, reads them back independently, and refuses if anything moved.</DialogDescription>
          </DialogHeader>
          {releaseConfirmation && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-zinc-300" data-testid="p2g-release-confirmation">
              <dt>Authority</dt><dd className="font-mono">r{releaseConfirmation.authorityRevision} · {releaseConfirmation.authorityDigest}</dd>
              <dt>Board revision</dt><dd className="font-mono">{releaseConfirmation.boardRevision}</dd>
              <dt>Component authority</dt><dd className="font-mono">{releaseConfirmation.componentAuthorityDigest}</dd>
              <dt>Fabrication profile</dt><dd>{releaseConfirmation.fabricationProfileId}</dd>
              <dt>Qualified at</dt><dd>{releaseConfirmation.qualifiedAt}</dd>
            </dl>
          )}
          <DialogFooter>{boardBehindNotice && <p className="mr-auto self-center text-[11px] text-amber-300" data-testid="p2g-release-board-behind">Release blocked — {boardBehindNotice}</p>}{/* [PR-L6, 2026-10-19] plain text, no control */}
            <Button variant="ghost" onClick={workflow.cancelRelease} disabled={releasing}>Cancel</Button>
            <Button data-testid="p2g-authorize-release" onClick={() => void workflow.authorizeRelease()} disabled={releasing || boardBehindNotice !== null}>{releasing ? "Releasing…" : "Authorize release"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* [B23-B1] the provider exchange, offered only for a CURRENT ledgered release of a CURRENT authority (B23-B "given a current deterministic release") */}
      {workflow.workflow && truth?.authority?.current && truth.latestRelease?.current && (
        <ProviderExchangePanel scope={workflow.workflow.scope} authority={{ revision: truth.authority.revision, recordDigest: truth.authority.recordDigest }} canAct={releaseCapability.allowed} />
      )}
      {/* [B23-B3] the provider observations (external, never Sirkit proof), shown whatever the authority: a stale one stays listed, labelled stale (OD-168, OD-169) [B23-B3 review, 2026-10-04] coverage-5: while the hydration is loaded; a hydration that failed integrity verification shows no durable truth, these included (fail closed, B16-A F12) */}
      {truth?.observations && <ProviderObservationList observations={truth.observations} />}
    </div>
  );
}
