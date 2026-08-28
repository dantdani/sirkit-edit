"use client";

/**
 * B08 — canvas interaction for the dimension-annotation tool. Mirrors the
 * silk tool's pattern: a Pixi preview Graphics on the stable "edge"
 * container, pointer events via scene.onPointer, Escape cancels the
 * in-progress dimension. Three clicks: endpoint A, endpoint B, then the
 * offset click places the dimension line — committing ONE canonical
 * transaction (pcb.dimension → add_dimension) through the gateway.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { produce } from "immer";
import { Container, Graphics } from "pixi.js";
import { commitPcbCandidate } from "@/app/lib/engineering/pcb-commit-gateway";
import type { PcbScene, ScenePointerEvent } from "@/app/lib/pcb/render/scene";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { Vec2 } from "@/app/lib/pcb/geometry";
import { NM_PER_MM } from "@/app/lib/pcb/units";
import { ACCENT_COLOR } from "@/app/lib/pcb/render/colors";
import { DEFAULT_SILK_STROKE_NM, DEFAULT_SILK_TEXT_HEIGHT_NM } from "@/app/lib/pcb/silk/types";
import type { BoardDimension, DimensionKind } from "@/app/lib/pcb/types";

const mm = (nm: number): number => nm / NM_PER_MM;

let dimensionSeq = 0;
const dimensionSalt = Math.random().toString(36).slice(2, 8);
const freshDimensionId = (): string => `dim-${dimensionSalt}-${++dimensionSeq}`;

export interface DimensionToolHandle {
  kind: DimensionKind;
  setKind(kind: DimensionKind): void;
}

export interface DimensionToolEditor {
  scene: PcbScene | null;
  active: boolean;
  getHistory: () => PcbHistory | null;
  toast?: (message: string) => void;
}

export function useDimensionTool({ scene, active, getHistory, toast }: DimensionToolEditor): DimensionToolHandle {
  const [kind, setKind] = useState<DimensionKind>("aligned");
  const stateRef = useRef({ getHistory, toast, kind });
  useEffect(() => {
    stateRef.current = { getHistory, toast, kind };
  });

  const commit = useCallback((a: Vec2, b: Vec2, offsetPoint: Vec2): void => {
    const h = stateRef.current.getHistory();
    if (!h) return;
    const dimensionKind = stateRef.current.kind;
    // Offset = signed distance from the measured span to the third click.
    let offsetNm: number;
    if (dimensionKind === "horizontal") offsetNm = Math.round(offsetPoint.y - a.y);
    else if (dimensionKind === "vertical") offsetNm = Math.round(offsetPoint.x - a.x);
    else {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      offsetNm = Math.round(((offsetPoint.x - a.x) * (-dy / len)) + ((offsetPoint.y - a.y) * (dx / len)));
    }
    if (offsetNm === 0) offsetNm = Math.round(2 * NM_PER_MM);
    const dimension: BoardDimension = {
      id: freshDimensionId(),
      kind: dimensionKind,
      a: { x: Math.round(a.x), y: Math.round(a.y) },
      b: { x: Math.round(b.x), y: Math.round(b.y) },
      offsetNm,
      layer: "silkTop",
      unit: "mm",
      precision: 2,
      textHeightNm: DEFAULT_SILK_TEXT_HEIGHT_NM,
      strokeWidthNm: DEFAULT_SILK_STROKE_NM,
    };
    void commitPcbCandidate(h, {
      commandId: "pcb.dimension",
      label: "Add dimension",
      buildCandidate: (board) => produce(board, (draft) => {
        (draft.dimensions ??= []).push(dimension);
      }),
    }).then((result) => {
      if (!result.ok) stateRef.current.toast?.(result.message);
    });
  }, []);

  useEffect(() => {
    if (!active || !scene) return;
    const points: Vec2[] = [];
    const container = new Container();
    container.eventMode = "none";
    const preview = new Graphics();
    preview.eventMode = "none";
    container.addChild(preview);
    scene.getLayerContainer("edge").addChild(container);

    let cursor: Vec2 | null = null;
    const redraw = (): void => {
      preview.clear();
      const stroke = { width: 0.15, color: ACCENT_COLOR, alpha: 0.9 };
      const line = [...points, ...(cursor ? [cursor] : [])];
      if (line.length >= 2) {
        preview.moveTo(mm(line[0].x), mm(line[0].y));
        for (let i = 1; i < line.length; i++) preview.lineTo(mm(line[i].x), mm(line[i].y));
        preview.stroke(stroke);
      }
      for (const point of points) {
        preview.circle(mm(point.x), mm(point.y), 0.4).fill({ color: ACCENT_COLOR, alpha: 0.9 });
      }
    };

    const onPointer = scene.onPointer((event: ScenePointerEvent) => {
      if (event.type === "move") { cursor = { ...event.world }; redraw(); return; }
      if (event.type !== "down") return;
      if ((event.buttons & 2) !== 0) { points.length = 0; redraw(); return; } // right click resets
      if ((event.buttons & 1) === 0) return;
      points.push({ ...event.world });
      if (points.length === 3) {
        commit(points[0], points[1], points[2]);
        points.length = 0;
      }
      redraw();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { points.length = 0; redraw(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      onPointer();
      window.removeEventListener("keydown", onKey);
      container.parent?.removeChild(container);
      container.destroy({ children: true });
    };
  }, [active, scene, commit]);

  return { kind, setKind };
}
