/**
 * useSilkTool (PCB Stage 16) — canvas interaction for the silkscreen tool.
 * Mirrors ZoneTool's pattern: a Pixi preview Graphics parented on the stable
 * "edge" container, pointer events via scene.onPointer, Esc cancels the
 * in-progress item, Enter/second-click commits. Every commit is ONE AddSilk
 * through the Stage 5 history (single undo).
 *
 * Modes: text (click → inline input, commit handled by SilkTool.tsx),
 * line (click-chain; each segment commits as its own AddSilk), rect
 * (click-move-click; Shift constrains square), circle (click-move-click;
 * Shift snaps the radius to 0.5 mm).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { produce } from "immer";
import { Container, Graphics } from "pixi.js";
import { commitPcbCandidate } from "@/app/lib/engineering/pcb-commit-gateway";
import type { PcbScene, ScenePointerEvent } from "@/app/lib/pcb/render/scene";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { Vec2 } from "@/app/lib/pcb/geometry";
import { NM_PER_MM } from "@/app/lib/pcb/units";
import { layerColor } from "@/app/lib/pcb/render/colors";
import type { SilkItem, SilkLayer } from "@/app/lib/pcb/silk/types";
import { DEFAULT_SILK_STROKE_NM, DEFAULT_SILK_TEXT_HEIGHT_NM } from "@/app/lib/pcb/silk/types";
import {
  mutateBoardWithSilkCommand,
  silkCommandLabel,
  type SilkCommand,
} from "@/app/lib/pcb/silk/commands";

export type SilkMode = "text" | "line" | "rect" | "circle";

const mm = (nm: number): number => nm / NM_PER_MM;
const RADIUS_SNAP_NM = 500_000; // Shift: 0.5 mm radius steps

let silkSeq = 0;
const silkSalt = Math.random().toString(36).slice(2, 8);
const freshSilkId = (): string => `silk-${silkSalt}-${++silkSeq}`;

export interface SilkToolHandle {
  mode: SilkMode;
  setMode(mode: SilkMode): void;
  layer: SilkLayer;
  setLayer(layer: SilkLayer): void;
  toggleLayer(): void;
  heightMm: number;
  setHeightMm(v: number): void;
  strokeMm: number;
  setStrokeMm(v: number): void;
  /** Text mode: the click position awaiting its inline input; null otherwise. */
  pendingTextAt: Vec2 | null;
  commitText(text: string): void;
  cancelText(): void;
}

export interface SilkToolEditor {
  scene: PcbScene | null;
  active: boolean;
  getHistory: () => PcbHistory | null;
  toast?: (message: string) => void;
}

export function useSilkTool({ scene, active, getHistory, toast }: SilkToolEditor): SilkToolHandle {
  const [mode, setMode] = useState<SilkMode>("text");
  const [layer, setLayer] = useState<SilkLayer>("silkTop");
  const [heightMm, setHeightMm] = useState(mm(DEFAULT_SILK_TEXT_HEIGHT_NM));
  const [strokeMm, setStrokeMm] = useState(mm(DEFAULT_SILK_STROKE_NM));
  const [pendingTextAt, setPendingTextAt] = useState<Vec2 | null>(null);

  const stateRef = useRef({ getHistory, toast, layer, heightMm, strokeMm, pendingTextAt });
  useEffect(() => {
    stateRef.current = { getHistory, toast, layer, heightMm, strokeMm, pendingTextAt };
  });

  const commit = useCallback((item: SilkItem): void => {
    const h = stateRef.current.getHistory();
    if (!h) return;
    const cmd: SilkCommand = { kind: "AddSilk", item };
    // B08 — one silk placement = one canonical transaction (same domain
    // mutator, delta-compiled through the canonical PCB commit gateway).
    void commitPcbCandidate(h, {
      commandId: "pcb.silkscreen-text",
      label: silkCommandLabel(cmd),
      buildCandidate: (board) => produce(board, (draft) => mutateBoardWithSilkCommand(draft, cmd)),
    }).then((result) => {
      if (!result.ok) stateRef.current.toast?.(result.message);
    });
  }, []);

  const strokeNm = useCallback(
    (): number => Math.max(1, Math.round(stateRef.current.strokeMm * NM_PER_MM)),
    [],
  );

  const commitText = useCallback(
    (text: string): void => {
      const at = stateRef.current.pendingTextAt;
      setPendingTextAt(null);
      const trimmed = text.trim();
      if (!at || trimmed.length === 0) return;
      commit({
        kind: "text",
        id: freshSilkId(),
        layer: stateRef.current.layer,
        position: { ...at },
        text: trimmed,
        heightNm: Math.max(100_000, Math.round(stateRef.current.heightMm * NM_PER_MM)),
        strokeWidthNm: strokeNm(),
        rotationDeg: 0,
        mirror: stateRef.current.layer === "silkBottom",
        anchor: "center",
      });
      stateRef.current.toast?.(`Silk text "${trimmed}" added`);
    },
    [commit, strokeNm],
  );

  const cancelText = useCallback((): void => setPendingTextAt(null), []);

  // Reset transient state when the tool deactivates or the mode changes.
  useEffect(() => {
    if (!active) setPendingTextAt(null);
  }, [active]);

  useEffect(() => {
    if (!active || !scene) return;

    // In-progress geometry (line chain / rect corner / circle center).
    let anchor: Vec2 | null = null;
    let cursor: Vec2 | null = null;
    let shift = false;

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

    const constrained = (a: Vec2, b: Vec2): Vec2 => {
      if (mode === "rect" && shift) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        return { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side };
      }
      return b;
    };

    const radiusOf = (a: Vec2, b: Vec2): number => {
      let r = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
      if (shift) r = Math.max(RADIUS_SNAP_NM, Math.round(r / RADIUS_SNAP_NM) * RADIUS_SNAP_NM);
      return r;
    };

    const redraw = (): void => {
      g.clear();
      const color = layerColor(stateRef.current.layer);
      if (!anchor || !cursor) return;
      const end = constrained(anchor, cursor);
      g.moveTo(mm(anchor.x), mm(anchor.y));
      if (mode === "line") g.lineTo(mm(cursor.x), mm(cursor.y));
      else if (mode === "rect") {
        g.rect(
          Math.min(mm(anchor.x), mm(end.x)),
          Math.min(mm(anchor.y), mm(end.y)),
          Math.abs(mm(end.x - anchor.x)),
          Math.abs(mm(end.y - anchor.y)),
        );
      } else if (mode === "circle") {
        g.circle(mm(anchor.x), mm(anchor.y), Math.max(0.01, mm(radiusOf(anchor, cursor))));
      }
      g.stroke({ width: 1.5, pixelLine: true, color, alpha: 0.9 });
    };

    const reset = (): void => {
      anchor = null;
      cursor = null;
      redraw();
    };

    const place = (world: Vec2): void => {
      const s = stateRef.current;
      if (mode === "text") {
        setPendingTextAt({ ...world });
        return;
      }
      if (!anchor) {
        anchor = { ...world };
        return;
      }
      const stroke = Math.max(1, Math.round(s.strokeMm * NM_PER_MM));
      if (mode === "line") {
        commit({ kind: "line", id: freshSilkId(), layer: s.layer, from: { ...anchor }, to: { ...world }, strokeWidthNm: stroke });
        anchor = { ...world }; // chain
      } else if (mode === "rect") {
        const end = constrained(anchor, world);
        commit({ kind: "rect", id: freshSilkId(), layer: s.layer, corner1: { ...anchor }, corner2: end, strokeWidthNm: stroke, filled: false });
        anchor = null;
      } else if (mode === "circle") {
        const r = radiusOf(anchor, world);
        if (r > 0) commit({ kind: "circle", id: freshSilkId(), layer: s.layer, center: { ...anchor }, radiusNm: r, strokeWidthNm: stroke, filled: false });
        anchor = null;
      }
      redraw();
    };

    const offPointer = scene.onPointer((e: ScenePointerEvent) => {
      if (stateRef.current.pendingTextAt) return; // inline input open — freeze
      switch (e.type) {
        case "down":
          if (e.buttons & 2) {
            reset();
            return;
          }
          if ((e.buttons & 1) === 0) return;
          place(e.world);
          return;
        case "move":
          cursor = e.world;
          redraw();
          return;
        case "up":
        case "leave":
          return;
      }
    });

    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift") {
        shift = true;
        redraw();
        return;
      }
      const t = ev.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      ) {
        return;
      }
      if (stateRef.current.pendingTextAt) return; // the inline input owns keys
      if (ev.key === "Escape" || ev.key === "Enter") {
        ev.preventDefault();
        reset(); // Enter ends a line chain; Esc cancels the pending segment
      }
    };
    const onKeyUp = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift") {
        shift = false;
        redraw();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      offPointer();
      parent?.removeChild(container);
      container.destroy({ children: true });
    };
  }, [active, scene, mode, commit]);

  const toggleLayer = useCallback(
    (): void => setLayer((l) => (l === "silkTop" ? "silkBottom" : "silkTop")),
    [],
  );

  return {
    mode,
    setMode,
    layer,
    setLayer,
    toggleLayer,
    heightMm,
    setHeightMm,
    strokeMm,
    setStrokeMm,
    pendingTextAt,
    commitText,
    cancelText,
  };
}
