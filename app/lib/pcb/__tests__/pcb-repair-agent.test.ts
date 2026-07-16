import { describe, expect, it } from "vitest";
import type { FootprintDef, FootprintInstance, PcbBoard, Track } from "../types";
import { createEmptyBoard } from "../types";
import { mmToNm } from "../units";
import { getPreset } from "../drc/presets";
import { runDrc } from "../drc/run-drc";
import { planDrcRepairs } from "../repair/planner";
import { applyRepairTransaction, automaticallySelectedFixes, previewRepairTransaction } from "../repair/transaction";
import { createHistory } from "../history";
import { buildAIPcbSnapshot, diffAIPcbSnapshots } from "../ai/snapshot";
import { validateNoRuleWeakening } from "../repair/approval-policy";
import { PCB_AI_TOOLS } from "../ai/pcb-tool-schemas";
import { PCBToolService } from "../ai/pcb-tool-service";

const padDef: FootprintDef = {
  libName: "RepairFixture",
  name: "P1",
  attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
  pads: [{
    number: "1",
    type: "smd",
    shape: { kind: "circle", radius: mmToNm(0.2) },
    at: { x: 0, y: 0 },
    rotationDeg: 0,
    layers: ["copperTop"],
  }],
  graphics: [],
  courtyardBBox: { minX: mmToNm(-0.4), minY: mmToNm(-0.4), maxX: mmToNm(0.4), maxY: mmToNm(0.4) },
  bodyBBox: { minX: mmToNm(-0.3), minY: mmToNm(-0.3), maxX: mmToNm(0.3), maxY: mmToNm(0.3) },
  models: [],
  rawSexpr: "",
};

function repair71Board(): PcbBoard {
  const footprints: FootprintInstance[] = Array.from({ length: 72 }, (_, index) => ({
    id: `p${index}`,
    ref: `P${index + 1}`,
    footprintId: "RepairFixture:P1",
    def: padDef,
    at: { x: mmToNm(5 + index * 2), y: mmToNm(5) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": 1 },
  }));
  const tracks: Track[] = Array.from({ length: 71 }, (_, index) => ({
    id: `thin-${index}`,
    layer: "copperTop",
    width: mmToNm(0.05),
    start: { ...footprints[index].at },
    end: { ...footprints[index + 1].at },
    netId: 1,
    source: "autorouter",
  }));
  return {
    ...createEmptyBoard(),
    outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(152), height: mmToNm(10) },
    nets: [{ id: 0, name: "" }, { id: 1, name: "FIXTURE" }],
    footprints,
    tracks,
  };
}

describe("engine-grounded PCB repair", () => {
  it("groups and repairs the 71-error fixture without weakening rules or introducing errors", async () => {
    const board = repair71Board();
    const rules = getPreset("jlcpcb-2l").rules;
    const before = runDrc(board, rules);
    expect(before.readiness.errors).toBe(71);
    expect(before.violations.every((violation) => violation.kind === "minTrackWidth")).toBe(true);
    const plan = planDrcRepairs(board, before, rules);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].rootCause).toBe("generated_width_mismatch");
    const selected = automaticallySelectedFixes(plan).map((fix) => fix.id);
    expect(selected).toHaveLength(71);
    const preview = await previewRepairTransaction(board, plan, selected);
    expect(preview.status).toBe("preview");
    expect(preview.metrics).toMatchObject({ errorsBefore: 71, errorsAfter: 0, newViolationsIntroduced: 0 });
    expect(board.tracks.every((track) => track.width === mmToNm(0.05))).toBe(true); // preview is pure

    const history = createHistory(board);
    expect(applyRepairTransaction(history, plan, preview, []).ok).toBe(true);
    expect(runDrc(history.present, rules).readiness.errors).toBe(0);
    expect(history.events.at(-1)).toMatchObject({ actor: "ai", operation: "pcb_repair", transactionId: preview.id });
    history.undo();
    expect(history.present.tracks.every((track) => track.width === mmToNm(0.05))).toBe(true);
  }, 15_000);

  it("builds a versioned all-layer snapshot with exact normalized DRC values under the performance target", () => {
    const board = repair71Board();
    const snapshot = buildAIPcbSnapshot(board, { schematicParity: "pass" });
    expect(snapshot.schemaVersion).toBe("sirkit.ai-pcb.v1");
    expect(snapshot.units).toBe("mm");
    expect(snapshot.drcSummary.errors).toBe(71);
    expect(snapshot.drcSummary.violations[0]).toMatchObject({
      type: "minTrackWidth",
      fixability: "safe_auto",
      actual: { value: 0.05, unit: "mm" },
    });
    expect(snapshot.layerUsage).toHaveLength(2);
    expect(snapshot.generatedInMs).toBeLessThan(250);
  });

  it("rejects rule weakening and never auto-selects edits to human-authored copper", () => {
    const board = repair71Board();
    board.tracks[0].source = "human";
    const preset = getPreset("jlcpcb-2l");
    const weakened = { ...preset.rules, default: { ...preset.rules.default, clearanceNm: 0 } };
    expect(validateNoRuleWeakening(preset.rules, weakened)).toContain("Repair policy forbids lowering default clearanceNm.");
    const plan = planDrcRepairs(board, runDrc(board, preset.rules), preset.rules);
    const humanFix = plan.fixes.find((fix) => fix.affectedObjectIds.includes("track:thin-0"));
    expect(humanFix?.requiresApproval).toBe(true);
    expect(automaticallySelectedFixes(plan).some((fix) => fix.id === humanFix?.id)).toBe(false);
  });

  it("invalidates a stale preview after a concurrent user edit", async () => {
    const board = repair71Board();
    const rules = getPreset("jlcpcb-2l").rules;
    const plan = planDrcRepairs(board, runDrc(board, rules), rules);
    const changed = { ...board, tracks: board.tracks.map((track, index) => index === 0 ? { ...track, width: mmToNm(0.2) } : track) };
    const preview = await previewRepairTransaction(changed, plan, automaticallySelectedFixes(plan).map((fix) => fix.id));
    expect(preview.status).toBe("rejected");
    expect(preview.blockers).toContain("Board revision changed after this repair plan was created.");
  });

  it("exposes one provider-neutral, read-first tool contract with exact object lookup", async () => {
    const names = PCB_AI_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      "get_footprint", "get_net", "get_track", "get_via", "get_zone",
      "preview_drc_repairs", "apply_drc_repairs", "undo_transaction",
      "run_autorouter", "reroute_nets", "ripup_nets", "optimize_local_placement", "refill_zones", "verify_connectivity",
    ]));
    const board = repair71Board();
    const service = new PCBToolService({ history: createHistory(board), rules: getPreset("jlcpcb-2l").rules });
    expect(await service.call("get_track", { trackId: "thin-0" })).toMatchObject({
      id: "thin-0", widthMm: 0.05, source: "autorouter",
    });
    expect(await service.call("get_manufacturer_profile")).toMatchObject({
      immutableDuringRepair: true,
      ruleWeakeningAllowed: false,
    });
  });

  it("diffs exact snapshot objects by stable ID", () => {
    const board = repair71Board();
    const before = buildAIPcbSnapshot(board);
    const changedBoard = { ...board, tracks: board.tracks.map((track, index) => index === 0 ? { ...track, width: mmToNm(0.2) } : track) };
    const after = buildAIPcbSnapshot(changedBoard);
    const diff = diffAIPcbSnapshots(before, after);
    expect(diff.changed).toBe(true);
    expect(diff.collections.tracks.changed).toEqual(["thin-0"]);
    expect(diff.collections.tracks.added).toEqual([]);
    expect(diff.collections.tracks.removed).toEqual([]);
  });

  it("previews and applies an approval-gated native footprint containment repair", async () => {
    const board: PcbBoard = {
      ...createEmptyBoard(),
      outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(10), height: mmToNm(10) },
      footprints: [{
        id: "edge-part",
        ref: "J1",
        footprintId: "RepairFixture:P1",
        def: padDef,
        at: { x: mmToNm(0.1), y: mmToNm(5) },
        rotationDeg: 0,
        side: "top",
        padNets: { "1": 0 },
        bodyMayOverhang: false,
      }],
    };
    const rules = getPreset("jlcpcb-2l").rules;
    const drc = runDrc(board, rules);
    expect(drc.violations.some((violation) => violation.kind === "padOutsideBoard")).toBe(true);
    const plan = planDrcRepairs(board, drc, rules);
    const placementFixes = plan.fixes.filter((fix) => fix.action.kind === "edit" && fix.affectedObjectIds.some((id) => id.includes("edge-part")));
    expect(placementFixes.length).toBeGreaterThan(0);
    expect(placementFixes.every((fix) => fix.requiresApproval)).toBe(true);
    const preview = await previewRepairTransaction(board, plan, placementFixes.map((fix) => fix.id));
    expect(preview.blockers).toEqual([]);
    expect(preview.metrics.movedFootprints).toBe(1);
    expect(preview.metrics.errorsAfter).toBeLessThan(preview.metrics.errorsBefore);
    const history = createHistory(board);
    expect(applyRepairTransaction(history, plan, preview, []).ok).toBe(false);
    expect(applyRepairTransaction(history, plan, preview, placementFixes.map((fix) => fix.id)).ok).toBe(true);
  });

  it("routes through the provider-neutral backend tool while preserving manual copper", async () => {
    const board = repair71Board();
    board.tracks[0] = { ...board.tracks[0], source: "human", locked: true, width: mmToNm(0.25) };
    let protectedTrackObserved = false;
    const service = new PCBToolService({
      history: createHistory(board),
      rules: getPreset("jlcpcb-2l").rules,
      autoroute: async (routingBoard, netIds) => {
        protectedTrackObserved = routingBoard.tracks.some((track) => track.id === "thin-0" && track.source === "human" && track.locked);
        expect(netIds).toEqual([1]);
        return {
          tracks: board.tracks.map((track) => track.source === "human" ? track : { ...track, width: mmToNm(0.25), source: "autorouter" as const }),
          vias: [],
        };
      },
    });
    const output = await service.call("reroute_nets", { netIds: [1] }) as { preview: { metrics: { errorsAfter: number }; blockers: string[] } };
    expect(protectedTrackObserved).toBe(true);
    expect(output.preview.metrics.errorsAfter).toBe(0);
    expect(output.preview.blockers).toEqual([]);
  });
});
