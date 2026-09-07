"use client";

/**
 * B16.1C §F — the visible manufacturing workflow: hydration status, the
 * explicit workflow state reconstructed from durable truth, qualification /
 * release actions that are disabled while the same operation is pending, a
 * SEPARATE administrator confirmation for release, explicit idempotent
 * retry, actionable bounded errors, and the release result (filename,
 * archive digest, authority revision, download).
 */

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { UseManufacturingWorkflowResult } from "./hooks/useManufacturingWorkflow";

const STATE_LABEL: Record<string, string> = {
  idle: "No durable board yet — synchronize the schematic to the PCB",
  hydrating_project: "Reading durable truth…",
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
  routeStaleNotice?: string | null;
}

export function ManufacturingWorkflowPanel({ workflow, qualifying, canQualify, onQualify, routeStaleNotice = null }: ManufacturingWorkflowPanelProps) {
  const { hydration, truth, releasing, releaseConfirmation, releaseResult, error, canRequestRelease } = workflow;
  const state = qualifying ? "qualifying" : releasing ? "releasing" : releaseConfirmation ? "awaiting_release_authorization" : error?.operation === "release" ? "release_failed" : workflow.workflow?.state ?? (hydration.status === "loading" ? "hydrating_project" : "idle");
  const identity = workflow.workflow?.identity;
  const pending = qualifying || releasing || hydration.status === "loading";
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
        <span>authority {truth?.authority ? `r${truth.authority.revision}${truth.authority.current ? "" : " (stale)"} ${short(truth.authority.recordDigest, 18)}` : "none"}</span>
        <span>release {truth?.latestRelease ? `${truth.latestRelease.filename}${truth.latestRelease.current ? "" : " (stale)"}` : "none"}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" data-testid="p2g-qualify" onClick={onQualify} disabled={pending || !canQualify} title={!canQualify ? "Needs an applied durable board — run Schematic → PCB and apply the plan first" : "Server-side autonomous placement + real routing + RC01–RC03 verification"} className="rounded border border-zinc-600 px-2 py-1 hover:border-teal-500 disabled:opacity-50">
          {qualifying ? "Qualifying…" : "Qualify & route"}
        </button>
        <button type="button" data-testid="p2g-request-release" onClick={workflow.requestRelease} disabled={pending || !canRequestRelease || routeStaleNotice !== null} title={routeStaleNotice ? `Release blocked — ${routeStaleNotice}` : !canRequestRelease ? "Release needs a CURRENT qualification authority for this exact board" : "Request a verified manufacturing release (administrator confirmation follows)"} className="rounded border border-zinc-600 px-2 py-1 hover:border-teal-500 disabled:opacity-50">
          {releasing ? "Releasing…" : "Request release"}
        </button>
        {error && (
          <button type="button" data-testid="p2g-retry" onClick={() => void workflow.retry()} disabled={pending} className="rounded border border-amber-500/60 px-2 py-1 text-amber-200 hover:border-amber-400 disabled:opacity-50">
            Retry {error.operation === "hydrate" ? "hydration" : "release"}
          </button>
        )}
        <button type="button" data-testid="p2g-refresh" onClick={() => void workflow.refresh()} disabled={pending} className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:border-zinc-500 disabled:opacity-50">Refresh</button>
      </div>
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
          <div className="text-teal-200/70">Gerbers generated and independently read back on the server. This is not a fabricated, ordered, assembled, or electrically certified board.</div>
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
          <DialogFooter>
            <Button variant="ghost" onClick={workflow.cancelRelease} disabled={releasing}>Cancel</Button>
            <Button data-testid="p2g-authorize-release" onClick={() => void workflow.authorizeRelease()} disabled={releasing}>{releasing ? "Releasing…" : "Authorize release"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
