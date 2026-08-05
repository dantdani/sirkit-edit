import { describe, expect, it } from "vitest";
import { createEmptyBoard, type PcbBoard, type Track, type Via } from "../types";
import { mmToNm } from "../units";
import { applyRouteCommand, buildRipupNetCommand, type RouteCommand } from "../route-tool.commands";
import { applyEdits } from "../edit/apply";
import { createHistory } from "../history";
import { buildAutorouteCandidate } from "../autoroute/verification";
import { PCBToolService } from "../ai/pcb-tool-service";
import { getPreset } from "../drc/presets";

function track(id: string, locked: boolean): Track {
  return {
    id,
    layer: "copperTop",
    width: mmToNm(0.25),
    start: { x: 0, y: 0 },
    end: { x: mmToNm(5), y: 0 },
    netId: 1,
    locked,
    source: "human",
  };
}

function via(id: string, locked: boolean): Via {
  return {
    id,
    at: { x: mmToNm(5), y: 0 },
    size: mmToNm(0.8),
    drill: mmToNm(0.4),
    netId: 1,
    layers: ["copperTop", "copperBottom"],
    locked,
    source: "human",
  };
}

function board(): PcbBoard {
  const result = createEmptyBoard();
  result.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
  result.tracks = [track("locked-track", true), track("free-track", false)];
  result.vias = [via("locked-via", true), via("free-via", false)];
  result.padstacks = [
    { id: "ps-a", name: "A", kind: "via", outerNm: mmToNm(0.8), drillNm: mmToNm(0.4), tented: true, zoneConnect: "solid" },
    { id: "ps-b", name: "B", kind: "via", outerNm: mmToNm(1), drillNm: mmToNm(0.5), tented: true, zoneConnect: "solid" },
  ];
  result.vias[0].padstackId = "ps-a";
  result.zones = [{
    id: "locked-zone", layer: "copperTop", netId: 1, locked: true,
    polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
    appearance: "solid", connection: "thermal", fill: [], dirty: true,
  }];
  return result;
}

describe("C-03 locked copper invariant", () => {
  it("denies a direct locked-track stretch at the mutation boundary", () => {
    const before = board();
    const locked = before.tracks[0];
    const afterGeometry = { ...locked, end: { x: mmToNm(9), y: 0 } };
    const command: RouteCommand = { kind: "StretchTrack", before: [locked], after: [afterGeometry] };
    const after = applyRouteCommand(before, command);
    expect(after).toEqual(before);
    expect(after.tracks[0]).toEqual(locked);
  });

  it("rip-up reports and preserves locked tracks/vias while removing unlocked copper", () => {
    const before = board();
    const command = buildRipupNetCommand(before, 1);
    expect(command.kind).toBe("RipupNet");
    if (command.kind !== "RipupNet") return;
    expect(command.removed.tracks.map((item) => item.id)).toEqual(["free-track"]);
    expect(command.removed.vias.map((item) => item.id)).toEqual(["free-via"]);
    expect(command.removed.protected?.tracks.map((item) => item.id)).toEqual(["locked-track"]);
    expect(command.removed.protected?.vias.map((item) => item.id)).toEqual(["locked-via"]);

    const after = applyRouteCommand(before, command);
    expect(after.tracks).toEqual([before.tracks[0]]);
    expect(after.vias).toEqual([before.vias[0]]);
  });

  it("generic batch edits reject the entire command when selection mixes locked and unlocked copper", () => {
    const history = createHistory(board());
    const result = applyEdits(history, [{
      op: "delete-items",
      refs: [{ kind: "track", id: "locked-track" }, { kind: "track", id: "free-track" }],
    }]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics?.find((diagnostic) => diagnostic.code === "LOCKED_OBJECT_MUTATION_DENIED")?.objectIds)
      .toEqual(["track:locked-track"]);
    expect(history.present.tracks.map((item) => item.id)).toEqual(["locked-track", "free-track"]);
    expect(history.entries).toHaveLength(0);
  });

  it("denies width, layer, position, and via changes until an explicit unlock transaction", () => {
    const history = createHistory(board());
    expect(applyEdits(history, [{ op: "set-track-width", ids: ["locked-track"], widthNm: mmToNm(1) }]).ok).toBe(false);
    expect(applyEdits(history, [{ op: "set-item-layer", refs: [{ kind: "track", id: "locked-track" }], layer: "copperBottom" }]).ok).toBe(false);
    expect(applyEdits(history, [{ op: "set-position", ref: { kind: "via", id: "locked-via" }, atNm: { x: 10, y: 10 } }]).ok).toBe(false);
    expect(applyEdits(history, [{ op: "set-via-padstack", viaIds: ["locked-via"], padstackId: "ps-b" }]).ok).toBe(false);
    expect(applyEdits(history, [{ op: "edit-padstack", id: "ps-a", patch: { outerNm: mmToNm(1.2) } }]).ok).toBe(false);
    expect(applyEdits(history, [{ op: "set-zone-props", id: "locked-zone", patch: { netId: 0 } }]).ok).toBe(false);
    expect(applyEdits(history, [{ op: "delete-items", refs: [{ kind: "via", id: "locked-via" }] }]).ok).toBe(false);
    expect(history.entries).toHaveLength(0);

    const unlock = applyEdits(history, [{
      op: "set-copper-locked",
      refs: [{ kind: "track", id: "locked-track" }, { kind: "via", id: "locked-via" }],
      locked: false,
    }]);
    expect(unlock.ok).toBe(true);
    expect(history.entries).toHaveLength(1);
    expect(applyEdits(history, [{ op: "set-track-width", ids: ["locked-track"], widthNm: mmToNm(1) }]).ok).toBe(true);
    expect(history.present.tracks.find((item) => item.id === "locked-track")?.width).toBe(mmToNm(1));
    history.undo();
    expect(history.present.tracks.find((item) => item.id === "locked-track")?.width).toBe(mmToNm(0.25));
    history.undo();
    expect(history.present.tracks.find((item) => item.id === "locked-track")?.locked).toBe(true);
  });

  it("autoroute candidate construction cannot replace, renet, or move locked copper", () => {
    const before = board();
    const maliciousTrack = {
      ...before.tracks[0], id: "locked-track", netId: 0,
      start: { x: mmToNm(20), y: mmToNm(20) }, end: { x: mmToNm(30), y: mmToNm(20) },
    };
    const maliciousVia = { ...before.vias[0], id: "locked-via", netId: 0, at: { x: mmToNm(30), y: mmToNm(30) } };
    const candidate = buildAutorouteCandidate(before, { tracks: [maliciousTrack], vias: [maliciousVia] });
    expect(candidate.tracks.find((item) => item.id === "locked-track")).toEqual(before.tracks[0]);
    expect(candidate.vias.find((item) => item.id === "locked-via")).toEqual(before.vias[0]);
  });

  it("a lock added after an AI rip-up preview invalidates apply and preserves the mixed net", async () => {
    const initial = board();
    initial.tracks[1] = { ...initial.tracks[1], source: "autorouter", locked: false };
    const history = createHistory(initial);
    const service = new PCBToolService({ history, rules: getPreset("jlcpcb-2l").rules });
    const output = await service.call("ripup_nets", { netIds: [1] }) as { preview: { id: string } };
    history.execute("Lock generated track", (draft) => {
      const track = draft.tracks.find((item) => item.id === "free-track");
      if (track) track.locked = true;
    });
    const applied = await service.applyTransaction({ previewId: output.preview.id, approvedFixIds: [] });
    expect(applied.ok).toBe(false);
    expect(history.present.tracks.map((item) => ({ id: item.id, locked: item.locked }))).toEqual([
      { id: "locked-track", locked: true },
      { id: "free-track", locked: true },
    ]);
  });
});
