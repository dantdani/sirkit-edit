/**
 * [B18-D review] A REAL board repair on the REAL canonical session (the b18c harness): a generated track below the preset's
 * minimum width is imported through the session, and the repair panel's own service (`PCBToolService`) plans, previews and
 * applies the one safe fix that widens it — `pcb.board-repair`, idempotency key `repair:<preview id>`, through the canonical
 * commit gateway exactly as the panel's "Apply" does.
 */
import { produce } from "immer";
import { PCBToolService } from "../../pcb/ai/pcb-tool-service";
import { DEFAULT_PRESET_ID, getPreset } from "../../pcb/drc/presets";
import type { Track } from "../../pcb/types";
import { mmToNm } from "../../pcb/units";
import { commitPcbCandidate } from "../pcb-commit-gateway";
import { composition, type Composed } from "./b18c-harness";

export const THIN_TRACK_ID = "thin-1";
export const THIN_WIDTH = mmToNm(0.05);

export const thinTrackOf = (c: Composed) => c.history.committedPresent.tracks.find((track) => track.id === THIN_TRACK_ID)!;
export const appliedLabels = (c: Composed) => c.history.entries.filter((entry) => entry.state === "applied").map((entry) => entry.label);

/** The session with the thin generated track imported and its repair previewed through the service (not yet applied). */
export async function repairScenario() {
  const c = await composition("execute_explicit_tier1");
  const thin: Track = { id: THIN_TRACK_ID, layer: "copperTop", width: THIN_WIDTH, start: { x: mmToNm(15), y: mmToNm(14) }, end: { x: mmToNm(20), y: mmToNm(14) }, netId: 1, source: "autorouter" };
  const imported = await commitPcbCandidate(c.history, {
    commandId: "pcb.autoroute-import", label: "Import routes",
    buildCandidate: (board) => produce(board, (draft) => { draft.tracks.push(thin); }),
  });
  if (!imported.ok || imported.status !== "executed") throw new Error(`the thin track must import canonically: ${JSON.stringify(imported)}`);
  const service = new PCBToolService({ history: c.history, rules: getPreset(DEFAULT_PRESET_ID).rules });
  const plan = await service.planRepairs("safe_fixes_automatically");
  const widen = plan.fixes.filter((fix) => fix.action.kind === "edit" && fix.action.command.op === "set-track-width" && fix.affectedObjectIds.includes(`track:${THIN_TRACK_ID}`));
  if (widen.length !== 1 || widen[0].requiresApproval) throw new Error(`exactly one safe fix must widen the thin track (found ${widen.length})`);
  const { preview } = await service.previewChanges({ planId: plan.id, fixIds: widen.map((fix) => fix.id) });
  if (preview.blockers.length > 0) throw new Error(`the repair preview must be clean: ${preview.blockers.join("; ")}`);
  return { c, service, preview };
}

/** The same scenario with the repair applied through the service (the panel's "Apply"). */
export async function repairedScenario() {
  const scenario = await repairScenario();
  const applied = await scenario.service.applyTransaction({ previewId: scenario.preview.id, approvedFixIds: [] });
  if (!applied.ok) throw new Error(`the repair must apply: ${applied.error}`);
  await scenario.c.session.whenIdle();
  return scenario;
}
