"use client";

/**
 * React glue for the interactive routing tool (PCB Stage 7). Owns the tool's
 * lifecycle while route mode is active: subscribes to the scene's pointer
 * stream and window keyboard, drives the rAF-throttled preview redraw, and
 * commits every action through Stage 5's history stack (one undoable entry per
 * gesture). When active it refreshes airwires from Stage 6's
 * `computeConnectivity` so the rats-nest follows committed copper (the pad-MST
 * source that select-move installs ignores tracks — this is the wave-end swap,
 * scoped to route mode here so the tool's UX is correct today).
 *
 * The tool core (createRouteTool) is Pixi/React-free and unit-tested; this hook
 * is the untested-by-design integration seam.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Container } from "pixi.js";
import type { PcbScene, ScenePointerEvent } from "@/app/lib/pcb/render/scene";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { LayerId } from "@/app/lib/pcb/layers";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { createRouteTool } from "@/app/lib/pcb/route-tool";
import { routeCommandLabel, mutateBoardWithCommand } from "@/app/lib/pcb/route-tool.commands";
import { computeConnectivity } from "@/app/lib/pcb/connectivity-board";
import { renderRoutePreview } from "@/app/lib/pcb/render/route-preview";

export interface RouteToolEditor {
  scene: PcbScene | null;
  /** The CURRENT history (PcbEditor recreates it on board reseed). */
  getHistory: () => PcbHistory | null;
  getActiveLayer?: () => LayerId;
  toast?: (message: string) => void;
}

export interface RouteToolHandle {
  activate(): void;
  deactivate(): void;
  active: boolean;
}

const EMPTY_BOARD = createEmptyBoard();

export function useRouteTool(editor: RouteToolEditor): RouteToolHandle {
  const [active, setActive] = useState(false);
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor; // keep getHistory/getActiveLayer/toast fresh
  });

  const activate = useCallback(() => setActive(true), []);
  const deactivate = useCallback(() => setActive(false), []);

  const scene = editor.scene;

  useEffect(() => {
    if (!active || !scene) return;

    const getHistory = (): PcbHistory | null => editorRef.current.getHistory();
    const getBoard = () => getHistory()?.present ?? EMPTY_BOARD;

    const tool = createRouteTool(
      getBoard,
      (cmd) => {
        const h = getHistory();
        if (!h) return;
        h.execute(routeCommandLabel(cmd, h.present), (draft) => mutateBoardWithCommand(draft, cmd));
      },
      {
        undo: () => getHistory()?.undo(),
        getActiveLayer: () => editorRef.current.getActiveLayer?.() ?? "copperTop",
      },
    );

    // Preview lives on a fresh container parented to the stable `edge` layer
    // (never cleared by copper/footprint rebuilds), so it survives setBoard.
    const previewContainer = new Container();
    previewContainer.eventMode = "none";
    let previewParent: Container | null = null;
    try {
      previewParent = scene.getLayerContainer("edge");
      previewParent.addChild(previewContainer);
    } catch {
      previewParent = null;
    }

    const getLayer = (layer: LayerId): Container => scene.getLayerContainer(layer);

    // Airwires follow committed copper (connectivity), refreshed only when the
    // board identity actually changes (i.e., after a commit — not every move).
    let lastBoard: unknown = null;
    const refreshAirwires = (): void => {
      const b = getBoard();
      if (b === lastBoard) return;
      lastBoard = b;
      try {
        scene.setAirwires(computeConnectivity(b).airwires);
      } catch {
        /* board unmounted mid-frame */
      }
    };

    let renderRaf = 0;
    let airRaf = 0;
    const scheduleRender = (): void => {
      if (!renderRaf) {
        renderRaf = requestAnimationFrame(() => {
          renderRaf = 0;
          renderRoutePreview(tool.state, getLayer, previewContainer);
        });
      }
      // Airwires get their OWN handle, cancel+re-registered on every call so this
      // refresh is ordered AFTER select-move's history subscriber, which fires
      // SYNCHRONOUSLY during a commit in the event we just processed. rAF runs in
      // registration order, so ours wins the frame — installing connectivity
      // (track-aware) airwires over select-move's pad-MST. (refreshAirwires is a
      // no-op when the board is unchanged, so plain moves cost nothing.)
      if (airRaf) cancelAnimationFrame(airRaf);
      airRaf = requestAnimationFrame(() => {
        airRaf = 0;
        refreshAirwires();
      });
    };

    const offPointer = scene.onPointer((e: ScenePointerEvent) => {
      switch (e.type) {
        case "down":
          if (e.buttons & 2) {
            // Right-click → rip up the net under the cursor.
            if (tool.ripupNetAt(e.world)) {
              editorRef.current.toast?.("Ripped up net");
              scheduleRender();
            }
            return;
          }
          if (e.buttons & 1) {
            tool.onPointerDown(e.world, { shiftKey: e.modifiers.shift, altKey: e.modifiers.alt });
            scheduleRender();
          }
          return;
        case "move":
          tool.onPointerMove(e.world);
          scheduleRender();
          return;
        case "up":
          tool.onPointerUp(e.world);
          scheduleRender();
          return;
        case "leave":
          return;
      }
    });

    const onKey = (ev: KeyboardEvent): void => {
      const t = ev.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      let handled = true;
      switch (ev.key) {
        case "v":
        case "V":
          tool.onKey("V");
          break;
        case "Escape":
          tool.onKey("Escape");
          break;
        case "Backspace":
          tool.onKey("Backspace");
          break;
        case "x":
        case "X":
          tool.onKey("X");
          break;
        case "Tab":
          tool.onKey("Tab");
          break;
        default:
          handled = false;
      }
      if (handled) {
        ev.preventDefault();
        scheduleRender();
      }
    };
    window.addEventListener("keydown", onKey);

    scheduleRender();

    return () => {
      window.removeEventListener("keydown", onKey);
      offPointer();
      if (renderRaf) cancelAnimationFrame(renderRaf);
      if (airRaf) cancelAnimationFrame(airRaf);
      tool.cancel();
      renderRoutePreview({ kind: "idle" }, getLayer, previewContainer); // clear + tooltip null
      previewParent?.removeChild(previewContainer);
      previewContainer.destroy({ children: true });
    };
  }, [active, scene]);

  return { activate, deactivate, active };
}
