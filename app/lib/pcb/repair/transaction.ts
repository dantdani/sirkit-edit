import { produce } from "immer";
import { commitPcbCandidate } from "@/app/lib/engineering/pcb-commit-gateway";
import type { PcbBoard } from "../types";
import type { PcbHistory } from "../history";
import { compileEdits } from "../edit/apply";
import { runDrc } from "../drc/run-drc";
import { applyZoneFillCandidate, computeZoneFillCandidate } from "../zones/fill-lifecycle";
import { pcbRevisionId } from "../ai/snapshot";
import { stableHash } from "../smart-routing/hash";
import { validateLockedCopperUnchanged } from "../integrity";
import type {
  AutorouteRepairExecutor,
  PCBRepairPlan,
  RepairFix,
  RepairMetrics,
  RepairTransactionPreview,
} from "./types";

export function refillZonesForRepair(board: PcbBoard, requestedIds?: ReadonlySet<string>): PcbBoard {
  let current = board;
  const ids = requestedIds ?? new Set(board.zones.map((zone) => zone.id));
  for (const zone of current.zones) {
    if (!ids.has(zone.id)) continue;
    const result = computeZoneFillCandidate(current, zone);
    current = produce(current, (draft) => {
      applyZoneFillCandidate(draft, result);
    });
  }
  return current;
}

function totalTrackLength(board: PcbBoard): number {
  return board.tracks.reduce((sum, track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0);
}

function generatedCopper(item: PcbBoard["tracks"][number] | PcbBoard["vias"][number]): boolean {
  return item.locked !== true && (item.source === "ai" || item.source === "autorouter");
}

function repairMetrics(
  before: PcbBoard,
  after: PcbBoard,
  plan: PCBRepairPlan,
  newViolationIds: string[],
  reroutedNetIds: number[],
): RepairMetrics {
  const beforeDrc = plan.drcBefore;
  const afterDrc = runDrc(after, plan.rules);
  const beforePositions = new Map(before.footprints.map((footprint) => [footprint.id, `${footprint.at.x},${footprint.at.y},${footprint.rotationDeg},${footprint.side}`]));
  const movedFootprints = after.footprints.filter((footprint) => beforePositions.get(footprint.id) !== `${footprint.at.x},${footprint.at.y},${footprint.rotationDeg},${footprint.side}`).length;
  return {
    errorsBefore: beforeDrc.summary.errors,
    errorsAfter: afterDrc.summary.errors,
    warningsBefore: beforeDrc.summary.warnings,
    warningsAfter: afterDrc.summary.warnings,
    unroutedBefore: beforeDrc.summary.unroutedConnections,
    unroutedAfter: afterDrc.summary.unroutedConnections,
    totalTrackLengthBefore: totalTrackLength(before),
    totalTrackLengthAfter: totalTrackLength(after),
    viaCountBefore: before.vias.length,
    viaCountAfter: after.vias.length,
    movedFootprints,
    reroutedNets: reroutedNetIds.map((id) => before.nets.find((net) => net.id === id)?.name || `net${id}`),
    newViolationsIntroduced: newViolationIds.length,
  };
}

export async function previewRepairTransaction(
  board: PcbBoard,
  plan: PCBRepairPlan,
  selectedFixIds: string[],
  autoroute?: AutorouteRepairExecutor,
): Promise<RepairTransactionPreview> {
  const blockers: string[] = [];
  if (pcbRevisionId(board) !== plan.baseRevisionId) blockers.push("Board revision changed after this repair plan was created.");
  const selectedSet = new Set(selectedFixIds);
  const fixes = plan.fixes.filter((fix) => selectedSet.has(fix.id));
  const commands = fixes.flatMap((fix) => fix.action.kind === "edit" ? [fix.action.command] : []);
  const compiled = compileEdits(board, commands);
  blockers.push(...compiled.errors);
  let candidate = compiled.result;

  const reroutedNetIds = [...new Set(fixes.flatMap((fix) => fix.action.kind === "reroute_nets" ? fix.action.netIds : []))];
  if (reroutedNetIds.length > 0) {
    if (!autoroute) {
      blockers.push("Selected repairs require the local autorouter, but no routing executor is available.");
    } else {
      const targets = new Set(reroutedNetIds);
      const routingInput: PcbBoard = {
        ...candidate,
        tracks: candidate.tracks.filter((track) => !targets.has(track.netId) || !generatedCopper(track)),
        vias: candidate.vias.filter((via) => !targets.has(via.netId) || !generatedCopper(via)),
      };
      const routed = await autoroute(routingInput, reroutedNetIds);
      const tracks = routed.tracks.filter((track) => targets.has(track.netId)).map((track) => ({ ...track, source: "ai" as const }));
      const vias = routed.vias.filter((via) => targets.has(via.netId)).map((via) => ({ ...via, source: "ai" as const }));
      if (tracks.length === 0 && vias.length === 0) {
        blockers.push("The autorouter returned no copper for the affected nets.");
      } else {
        candidate = {
          ...candidate,
          tracks: [
            ...candidate.tracks.filter((track) => !targets.has(track.netId) || !generatedCopper(track)),
            ...tracks.filter((track) => !candidate.tracks.some((existing) => !generatedCopper(existing) && existing.id === track.id)),
          ],
          vias: [
            ...candidate.vias.filter((via) => !targets.has(via.netId) || !generatedCopper(via)),
            ...vias.filter((via) => !candidate.vias.some((existing) => !generatedCopper(existing) && existing.id === via.id)),
          ],
        };
      }
    }
  }

  const requestedZones = new Set(fixes.flatMap((fix) => fix.action.kind === "refill_zones" ? fix.action.zoneIds : []));
  if (commands.length > 0 || reroutedNetIds.length > 0) for (const zone of candidate.zones) requestedZones.add(zone.id);
  if (requestedZones.size > 0) candidate = refillZonesForRepair(candidate, requestedZones);

  blockers.push(...validateLockedCopperUnchanged(board, candidate).map((diagnostic) => diagnostic.summary));

  const drcAfter = runDrc(candidate, plan.rules);
  const beforeIds = new Set(plan.drcBefore.violations.map((violation) => violation.id));
  const afterIds = new Set(drcAfter.violations.map((violation) => violation.id));
  const newViolationIds = drcAfter.violations
    .filter((violation) => violation.severity === "error" && !beforeIds.has(violation.id))
    .map((violation) => violation.id);
  const resolvedViolationIds = plan.drcBefore.violations.filter((violation) => !afterIds.has(violation.id)).map((violation) => violation.id);
  if (newViolationIds.length > 0) blockers.push(`Candidate introduces ${newViolationIds.length} new error-level violation${newViolationIds.length === 1 ? "" : "s"}.`);
  if (drcAfter.summary.errors > plan.drcBefore.summary.errors) blockers.push("Candidate increases the total DRC error count.");
  const metrics = repairMetrics(board, candidate, plan, newViolationIds, reroutedNetIds);
  if (
    fixes.length > 0 &&
    metrics.errorsAfter === metrics.errorsBefore &&
    metrics.warningsAfter === metrics.warningsBefore &&
    metrics.unroutedAfter === metrics.unroutedBefore
  ) {
    blockers.push("Candidate does not measurably improve DRC or connectivity.");
  }
  const previewId = `repair-tx-${stableHash(`${plan.id}|${selectedFixIds.sort().join("|")}|${pcbRevisionId(candidate)}`)}`;
  return {
    id: previewId,
    planId: plan.id,
    baseRevisionId: plan.baseRevisionId,
    selectedFixIds: fixes.map((fix) => fix.id),
    sourceViolationIds: [...new Set(fixes.flatMap((fix) => fix.sourceViolationIds))],
    affectedObjectIds: [...new Set(fixes.flatMap((fix) => fix.affectedObjectIds))],
    candidateBoard: candidate,
    drcBefore: plan.drcBefore,
    drcAfter,
    metrics,
    newViolationIds,
    resolvedViolationIds,
    blockers,
    status: blockers.length === 0 ? "preview" : "rejected",
  };
}

const REPAIR_COMMAND_ID = "pcb.board-repair";

export async function applyRepairTransaction(
  history: PcbHistory,
  plan: PCBRepairPlan,
  preview: RepairTransactionPreview,
  approvedFixIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (preview.status === "rejected" || preview.blockers.length > 0) return { ok: false, error: preview.blockers[0] ?? "Repair preview was rejected." };
  if (pcbRevisionId(history.present) !== preview.baseRevisionId) return { ok: false, error: "Board changed after preview; generate a new repair plan." };
  const lockedMutation = validateLockedCopperUnchanged(history.present, preview.candidateBoard)[0];
  if (lockedMutation) return { ok: false, error: lockedMutation.summary };
  const approved = new Set(approvedFixIds);
  const missingApproval = plan.fixes.find((fix) => preview.selectedFixIds.includes(fix.id) && fix.requiresApproval && !approved.has(fix.id));
  if (missingApproval) return { ok: false, error: `${missingApproval.title} requires explicit approval.` };
  if (preview.metrics.newViolationsIntroduced > 0) return { ok: false, error: "Repair introduces new violations." };
  // B08 — the approved repair applies as ONE canonical transaction: the
  // preview's base pin is re-verified against the board at serialized
  // execution time and the candidate is delta-compiled (never a raw
  // whole-board history write). A rejected/stale preview mutates nothing.
  const result = await commitPcbCandidate(history, {
    commandId: REPAIR_COMMAND_ID,
    label: "AI PCB repair",
    idempotencyKey: `repair:${preview.id}`,
    metadata: {
      operationType: "pcb_repair",
      actor: "ai",
      reason: `Applied ${preview.selectedFixIds.length} validated PCB repair${preview.selectedFixIds.length === 1 ? "" : "s"}.`,
      sourceViolationIds: preview.sourceViolationIds,
      transactionId: preview.id,
      affectedObjects: preview.affectedObjectIds,
      // The repair's own id also rides in the details: a bound canonical session records the executor's transaction id as
      // the entry's `transactionId` (B03), and the repair's undo must still find THIS repair there.
      details: { metrics: preview.metrics, fixIds: preview.selectedFixIds, repairTransactionId: preview.id },
    },
    buildCandidate: (board) => {
      if (pcbRevisionId(board) !== preview.baseRevisionId) throw new Error("Board changed after preview; generate a new repair plan.");
      return structuredClone(preview.candidateBoard);
    },
  });
  if (!result.ok) return { ok: false, error: result.message };
  preview.status = "committed";
  return { ok: true };
}

/**
 * Whether `entry` is the repair `repairTransactionId`, matched by the repair's own id in the entry's details: a bound
 * canonical session records the executor's transaction id (`tx:<command>:<idempotency key>`) as the entry's `transactionId`,
 * so that field never equals the repair id there. A canonical entry must also have been committed under the repair command
 * (its B03 details); a bare-history entry still carries the repair id as its `transactionId`.
 */
function isRepairEntry(entry: PcbHistory["entries"][number] | undefined, repairTransactionId: string): boolean {
  const metadata = entry?.metadata;
  if (metadata?.operationType !== "pcb_repair" || metadata.details?.repairTransactionId !== repairTransactionId) return false;
  const b03 = metadata.details.b03 as { commandId?: unknown } | undefined;
  return b03 === undefined ? metadata.transactionId === repairTransactionId : b03.commandId === REPAIR_COMMAND_ID;
}

export function undoRepairTransaction(history: PcbHistory, transactionId: string): { ok: boolean; error?: string } {
  const latest = [...history.entries].reverse().find((entry) => entry.state === "applied");
  if (!isRepairEntry(latest, transactionId)) {
    return { ok: false, error: "Only the most recent repair transaction can be undone directly." };
  }
  // [B18-D review] the editor's history can refuse a step (while an AI change is being made it holds undo and redo): never
  // report an undo that did not happen.
  if (!history.canUndo) return { ok: false, error: "The editor refused the undo right now (an AI change may be in progress); nothing was undone. Try again when it finishes." };
  history.undo();
  const after = [...history.entries].reverse().find((entry) => entry.state === "applied");
  if (isRepairEntry(after, transactionId)) return { ok: false, error: "The editor did not undo the repair; nothing was undone." };
  return { ok: true };
}

export function automaticallySelectedFixes(plan: PCBRepairPlan): RepairFix[] {
  return plan.fixes.filter((fix) => !fix.requiresApproval && fix.action.kind !== "manual_review");
}
