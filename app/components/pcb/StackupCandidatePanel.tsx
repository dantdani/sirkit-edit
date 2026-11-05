"use client";

/**
 * [PR-G, 2026-10-17] The PREVIEW of the agent's stackup / via-policy recommendation (`sirkit.stackup-candidate.v1`, received by the page
 * as `stackup_candidate_ready` and handed to PcbEditor after the SAFE receiver and the live-revision check): the current stackup beside
 * the recommended one, the layer roles and plane nets, the manufacturing preset with its release qualification AS THE CANDIDATE STATES
 * IT, the via profiles with their manufacturer-minimum check, what accepting invalidates (the cited rules), what was not validated
 * and what the chain does not support. Two controls: Accept - the editor's EXISTING stackup change (the Stackup selector's one
 * canonical `pcb.board-geometry` transaction, `applyStackupProfile` in PcbEditor) after the base revision is re-checked against the
 * live board - and Discard. The candidate itself never writes the board; a stale preview disables Accept and says why.
 */
import type { StackupCandidate } from "@/app/lib/pcb/candidates/stackup-candidate";

export function StackupCandidatePanel({ candidate, liveRevision, now, busy, onAccept, onDiscard }: {
  candidate: StackupCandidate;
  /** the live board's revision (null: no board) - a mismatch with the candidate's base disables Accept */
  liveRevision: string | null;
  /** the editor's clock tick (epoch ms; PcbEditor ticks it while a preview is open) - the expiry is judged against it, never against a clock read during render */
  now: number;
  busy: boolean;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const { base, recommendation, invalidation, notValidated, unsupported } = candidate;
  const expired = !(Date.parse(candidate.expiresAt) > now);
  const stale = liveRevision === null || liveRevision !== base.revision;
  const blocker = liveRevision === null ? "No board is loaded." : stale ? "The board moved since the recommendation was sealed; it is stale. Ask the assistant again." : expired ? "The recommendation expired; ask the assistant again." : null;
  const layerWords = (layers: typeof recommendation.layers) => layers.map((layer) => `${layer.displayName} (${layer.role}${layer.planeNet ? `: ${layer.planeNet.name}` : ""}${layer.autorouteEnabled ? "" : ", not routed"})`).join(", ");
  return (
    <section data-testid="stackup-candidate-panel" data-candidate-id={candidate.candidateId} data-stale={stale ? "true" : "false"} aria-label="Agent stackup recommendation preview" className="rounded border border-zinc-700 bg-zinc-950/95 p-2 text-[11px] text-zinc-300 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-zinc-100">Stackup recommendation (preview) — the board is unchanged until you accept</div>
        <button type="button" onClick={onDiscard} aria-label="Discard the stackup recommendation" data-testid="stackup-candidate-discard" className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-zinc-200 hover:border-zinc-500">Discard</button>
      </div>
      <dl className="mt-1.5 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1">
        <dt className="text-zinc-500">Current</dt>
        <dd data-testid="stackup-candidate-current">{base.stackup.physicalLayerCount} copper layers{base.stackup.profileId ? ` (${base.stackup.profileId})` : ""}, {base.stackup.routableSignalLayerCount} routable signal; preset {base.manufacturingPresetId}. {layerWords(base.stackup.layers)}</dd>
        <dt className="text-zinc-500">Recommended</dt>
        <dd data-testid="stackup-candidate-recommended">{recommendation.physicalLayerCount} copper layers ({recommendation.profileId}), {recommendation.routableSignalLayerCount} routable signal, {recommendation.boardThicknessMm} mm. {layerWords(recommendation.layers)}{recommendation.planes.length > 0 ? `; planes ${recommendation.planes.map((plane) => `${plane.layer} = ${plane.net.name}`).join(", ")}` : "; no plane net named"}.</dd>
        <dt className="text-zinc-500">Manufacturing</dt>
        <dd data-testid="stackup-candidate-manufacturing" data-release-qualified={recommendation.manufacturing.releaseQualified ? "true" : "false"}>{recommendation.manufacturing.presetId} — {recommendation.manufacturing.name} ({recommendation.manufacturing.fab}, {recommendation.manufacturing.copperLayerCount} copper layers). {recommendation.manufacturing.qualificationNote} Minimums: clearance {recommendation.manufacturing.limitsNm.clearanceNm} nm, track {recommendation.manufacturing.limitsNm.minTrackWidthNm} nm, via outer {recommendation.manufacturing.limitsNm.minViaOuterNm} nm, drill {recommendation.manufacturing.limitsNm.minViaDrillNm} nm, annular ring {recommendation.manufacturing.limitsNm.minAnnularRingNm} nm.{recommendation.manufacturing.presetId !== base.manufacturingPresetId ? " Accept also selects this preset for the DRC panel's checks." : ""}</dd>
        <dt className="text-zinc-500">Vias</dt>
        <dd data-testid="stackup-candidate-vias">{recommendation.viaPolicy.technology} vias only. {recommendation.viaPolicy.padstacks.length === 0 ? "No via profile named." : recommendation.viaPolicy.padstacks.map((entry) => `${entry.name} (${entry.outerNm}/${entry.drillNm} nm, ${entry.source}${entry.meetsManufacturingMinimum ? "" : `; BELOW the preset's minimum — ${entry.note ?? ""}`})`).join("; ")}</dd>
        <dt className="text-zinc-500">Invalidates</dt>
        <dd data-testid="stackup-candidate-invalidation" data-invalidates={invalidation.dependentApprovalsInvalidated ? "true" : "false"}>{invalidation.dependentApprovalsInvalidated ? `Yes — ${[invalidation.changesLayerCount ? "the layer count" : null, invalidation.changesProfile ? "the stackup profile" : null, invalidation.changesManufacturingPreset ? "the manufacturing preset" : null].filter(Boolean).join(", ")} change: a new board revision; every placement / routing candidate retires; qualification and release re-run from scratch (${invalidation.rules.length} rules cited by the artifact).` : "No — it matches the board's current stackup."}</dd>
        <dt className="text-zinc-500">Not validated</dt>
        <dd>{notValidated.join(" ")}</dd>
        <dt className="text-zinc-500">Unsupported</dt>
        <dd>{unsupported.viaTechnologies.join(", ")} vias; {unsupported.materialsAndImpedance} — {unsupported.reason}.</dd>
        {recommendation.rationale ? <><dt className="text-zinc-500">Assistant&apos;s rationale</dt><dd className="text-zinc-400">{recommendation.rationale} (the assistant&apos;s words, not a check)</dd></> : null}
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAccept} disabled={busy || blocker !== null} aria-describedby={blocker ? `${candidate.candidateId}-blocker` : undefined} data-testid="stackup-candidate-accept" className="rounded border border-teal-600 px-2 py-0.5 text-teal-200 hover:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Applying…" : "Accept — set this stackup"}</button>
        <span className="text-zinc-500">Accept commits one canonical board-geometry transaction (one undo entry), exactly as the toolbar&apos;s Stackup selector does; nothing is manufactured, qualified or released by it.</span>
        {blocker ? <span id={`${candidate.candidateId}-blocker`} data-testid="stackup-candidate-blocker" className="text-amber-300" role="status">{blocker}</span> : null}
      </div>
    </section>
  );
}
