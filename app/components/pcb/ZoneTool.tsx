"use client";

/**
 * Zone drawing tool + dialogs (PCB Stage 11).
 *
 * `ZoneTool` owns pointer/keyboard interaction while the editor's tool is
 * "zone" (press Z): left-click adds polygon vertices, double-click or Enter
 * closes (≥ 3 vertices), Escape cancels the in-flight polygon, right-click
 * deletes the zone under the cursor. Closing opens a small net/layer/
 * appearance dialog; confirming dispatches ONE `AddZone` command through the
 * Stage 5 history (undo removes the whole zone). The fill itself is poured by
 * `useZoneFills` after the commit — never here.
 *
 * `AddPlaneDialog` is the "Fill layer as plane" path: pick a copper layer +
 * net, get a board-outline zone via `makePlaneZone` (4-layer inner planes are
 * just zones on in1/in2).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Container, Graphics } from "pixi.js";
import type { PcbScene, ScenePointerEvent } from "@/app/lib/pcb/render/scene";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { PcbBoard, Zone } from "@/app/lib/pcb/types";
import type { Vec2 } from "@/app/lib/pcb/geometry";
import { COPPER_LAYERS, LAYERS, type LayerId } from "@/app/lib/pcb/layers";
import { NM_PER_MM } from "@/app/lib/pcb/units";
import {
  mutateBoardWithZoneCommand,
  zoneCommandLabel,
  type ZoneCommand,
} from "@/app/lib/pcb/zones/command";
import { pointInPolygon } from "@/app/lib/pcb/zones/geometry";
import { ACCENT_COLOR } from "@/app/lib/pcb/render/colors";

const mm = (nm: number): number => nm / NM_PER_MM;

/** Double-click close: second click within this distance of the last vertex. */
const CLOSE_DIST_NM = 500_000; // 0.5 mm
const CLOSE_MS = 400;

let zoneSeq = 0;
const zoneSalt = Math.random().toString(36).slice(2, 8);
const freshZoneId = (): string => `zone-${zoneSalt}-${++zoneSeq}`;

function copperLayerOptions(stackup: 2 | 4): { id: LayerId; name: string }[] {
  return COPPER_LAYERS.filter((l) => stackup === 4 || (l !== "in1" && l !== "in2")).map((l) => ({
    id: l,
    name: LAYERS.find((d) => d.id === l)?.displayName ?? l,
  }));
}

function defaultNetId(board: PcbBoard): number {
  const gnd = board.nets.find((n) => /^(gnd|ground|vss)$/i.test(n.name));
  return (gnd ?? board.nets.find((n) => n.id !== 0))?.id ?? 0;
}

const selectClass =
  "bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-300 focus:outline-none focus:border-teal-600";

function NetLayerFields({
  board,
  netId,
  layer,
  onNetId,
  onLayer,
}: {
  board: PcbBoard;
  netId: number;
  layer: LayerId;
  onNetId: (id: number) => void;
  onLayer: (layer: LayerId) => void;
}) {
  return (
    <>
      <label className="flex items-center justify-between gap-2">
        <span className="text-zinc-500">Net</span>
        <select
          aria-label="Zone net"
          value={netId}
          onChange={(e) => onNetId(Number(e.target.value))}
          className={selectClass}
        >
          {board.nets
            .filter((n) => n.id !== 0)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name || `net ${n.id}`}
              </option>
            ))}
          <option value={0}>No net</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-zinc-500">Layer</span>
        <select
          aria-label="Zone layer"
          value={layer}
          onChange={(e) => onLayer(e.target.value as LayerId)}
          className={selectClass}
        >
          {copperLayerOptions(board.stackup).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

// ─── Zone draw tool ──────────────────────────────────────────────────────────

export interface ZoneToolProps {
  scene: PcbScene | null;
  active: boolean;
  board: PcbBoard;
  getHistory: () => PcbHistory | null;
  /** Preferred layer for the new zone (the editor's active copper layer). */
  activeLayer: LayerId;
  toast?: (message: string) => void;
}

export function ZoneTool({ scene, active, board, getHistory, activeLayer, toast }: ZoneToolProps) {
  const [pendingPolygon, setPendingPolygon] = useState<Vec2[] | null>(null);
  const [netId, setNetId] = useState(() => defaultNetId(board));
  const [layer, setLayer] = useState<LayerId>(
    COPPER_LAYERS.includes(activeLayer) ? activeLayer : "copperTop",
  );
  const [appearance, setAppearance] = useState<"solid" | "hatched">("solid");

  const stateRef = useRef({ getHistory, toast, pendingPolygon, board });
  useEffect(() => {
    stateRef.current = { getHistory, toast, pendingPolygon, board };
  });

  // Refresh dialog defaults each time the tool activates (render-time
  // state adjustment — no cascading effect).
  const [wasActive, setWasActive] = useState(false);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) {
      setNetId(defaultNetId(board));
      setLayer(COPPER_LAYERS.includes(activeLayer) ? activeLayer : "copperTop");
    }
  }

  const commit = useCallback((cmd: ZoneCommand): void => {
    const h = stateRef.current.getHistory();
    if (!h) return;
    h.execute(zoneCommandLabel(cmd, h.present), (draft) => mutateBoardWithZoneCommand(draft, cmd));
  }, []);

  useEffect(() => {
    if (!active || !scene) return;

    const vertices: Vec2[] = [];
    let cursor: Vec2 | null = null;
    let lastClickAt = 0;

    const container = new Container();
    container.eventMode = "none";
    const g = new Graphics();
    g.eventMode = "none";
    container.addChild(g);
    let parent: Container | null = null;
    try {
      parent = scene.getLayerContainer("edge"); // stable across copper rebuilds
      parent.addChild(container);
    } catch {
      parent = null;
    }

    const redraw = (): void => {
      g.clear();
      if (vertices.length === 0) return;
      g.moveTo(mm(vertices[0].x), mm(vertices[0].y));
      for (let i = 1; i < vertices.length; i++) g.lineTo(mm(vertices[i].x), mm(vertices[i].y));
      if (cursor) g.lineTo(mm(cursor.x), mm(cursor.y));
      if (vertices.length >= 3) g.lineTo(mm(vertices[0].x), mm(vertices[0].y));
      g.stroke({ width: 1.5, pixelLine: true, color: ACCENT_COLOR, alpha: 0.9 });
      for (const v of vertices) {
        g.circle(mm(v.x), mm(v.y), 0.3).fill({ color: ACCENT_COLOR, alpha: 0.9 });
      }
    };

    const reset = (): void => {
      vertices.length = 0;
      cursor = null;
      redraw();
    };

    const finish = (): void => {
      if (vertices.length < 3) return;
      setPendingPolygon(vertices.map((v) => ({ ...v })));
      reset();
    };

    const deleteZoneAt = (world: Vec2): void => {
      const h = stateRef.current.getHistory();
      if (!h) return;
      // Later zones win the pick too (draw-order precedence).
      const zones = h.present.zones;
      for (let i = zones.length - 1; i >= 0; i--) {
        if (zones[i].polygon.length >= 3 && pointInPolygon(world, zones[i].polygon)) {
          const cmd: ZoneCommand = { kind: "DeleteZone", before: zones[i] };
          commit(cmd);
          stateRef.current.toast?.("Zone deleted");
          return;
        }
      }
    };

    const offPointer = scene.onPointer((e: ScenePointerEvent) => {
      if (stateRef.current.pendingPolygon) return; // dialog open — freeze the canvas tool
      switch (e.type) {
        case "down": {
          if (e.buttons & 2) {
            if (vertices.length > 0) reset();
            else deleteZoneAt(e.world);
            return;
          }
          if ((e.buttons & 1) === 0) return;
          const now = performance.now();
          const last = vertices[vertices.length - 1];
          const isDoubleClick =
            last !== undefined &&
            now - lastClickAt < CLOSE_MS &&
            Math.hypot(e.world.x - last.x, e.world.y - last.y) < CLOSE_DIST_NM;
          lastClickAt = now;
          if (isDoubleClick && vertices.length >= 3) {
            finish();
            return;
          }
          if (!isDoubleClick) {
            vertices.push({ ...e.world });
            redraw();
          }
          return;
        }
        case "move":
          cursor = e.world;
          redraw();
          return;
        case "up":
        case "leave":
          return;
      }
    });

    const onKey = (ev: KeyboardEvent): void => {
      const t = ev.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      ) {
        return;
      }
      if (stateRef.current.pendingPolygon) return; // dialog handles its own keys
      if (ev.key === "Enter") {
        ev.preventDefault();
        finish();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        reset();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      offPointer();
      parent?.removeChild(container);
      container.destroy({ children: true });
    };
  }, [active, scene, commit]);

  if (!pendingPolygon) return null;

  const addZone = (): void => {
    const zone: Zone = {
      id: freshZoneId(),
      layer,
      netId,
      polygon: pendingPolygon,
      appearance,
      connection: "thermal",
      fill: [],
      dirty: true,
    };
    commit({ kind: "AddZone", zone });
    setPendingPolygon(null);
    toast?.(`Zone added — filling…`);
  };

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 w-56 p-3 rounded border border-zinc-700 bg-zinc-900/95 shadow-lg text-xs flex flex-col gap-2">
      <p className="font-medium text-zinc-200">New zone</p>
      <NetLayerFields board={board} netId={netId} layer={layer} onNetId={setNetId} onLayer={setLayer} />
      <label className="flex items-center justify-between gap-2">
        <span className="text-zinc-500">Appearance</span>
        <select
          aria-label="Zone appearance"
          value={appearance}
          onChange={(e) => setAppearance(e.target.value === "hatched" ? "hatched" : "solid")}
          className={selectClass}
        >
          <option value="solid">Solid</option>
          <option value="hatched">Hatched</option>
        </select>
      </label>
      <div className="flex justify-end gap-2 mt-1">
        <button
          type="button"
          onClick={() => setPendingPolygon(null)}
          className="px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={addZone}
          className="px-2 py-1 rounded bg-teal-600 text-white hover:bg-teal-500 transition-colors"
        >
          Add zone
        </button>
      </div>
    </div>
  );
}

// ─── Add plane dialog ────────────────────────────────────────────────────────

export function AddPlaneDialog({
  open,
  board,
  onClose,
  onAdd,
}: {
  open: boolean;
  board: PcbBoard;
  onClose: () => void;
  onAdd: (layer: LayerId, netId: number) => void;
}) {
  const [netId, setNetId] = useState(() => defaultNetId(board));
  const [layer, setLayer] = useState<LayerId>(board.stackup === 4 ? "in1" : "copperBottom");

  // Reset defaults on each open (render-time state adjustment, not an effect).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNetId(defaultNetId(board));
      setLayer(board.stackup === 4 ? "in1" : "copperBottom");
    }
  }

  if (!open) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 w-56 p-3 rounded border border-zinc-700 bg-zinc-900/95 shadow-lg text-xs flex flex-col gap-2">
      <p className="font-medium text-zinc-200">Fill layer as plane</p>
      <NetLayerFields board={board} netId={netId} layer={layer} onNetId={setNetId} onLayer={setLayer} />
      <div className="flex justify-end gap-2 mt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onAdd(layer, netId);
            onClose();
          }}
          className="px-2 py-1 rounded bg-teal-600 text-white hover:bg-teal-500 transition-colors"
        >
          Add plane
        </button>
      </div>
    </div>
  );
}
