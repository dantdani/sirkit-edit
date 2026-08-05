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
import { createRouteTool, type RouteToolState } from "@/app/lib/pcb/route-tool";
import { routeCommandLabel, mutateBoardWithCommand } from "@/app/lib/pcb/route-tool.commands";
import { computeElectricalTruth } from "@/app/lib/pcb/electrical-truth";
import { renderRoutePreview } from "@/app/lib/pcb/render/route-preview";
import { getNetClass } from "@/app/lib/pcb/netclass";
import { resolveRoutingProfile } from "@/app/lib/pcb/routing-profile";

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
  status: RouteToolStatusView | null;
}

export interface RouteToolStatusView {
  status: "ready" | "walking-around" | "blocked";
  mode: "direct" | "walk-around" | "blocked";
  alternatives: number;
  selected: number;
  elapsedMs: number;
  explanation: string;
}

function statusFromState(state: RouteToolState): RouteToolStatusView | null {
  if (state.kind !== "routing" || !state.preview.smartStatus) return null;
  const candidates = state.preview.candidates ?? [];
  const selected = Math.max(0, candidates.findIndex((candidate) => candidate.id === state.preview.selectedCandidateId));
  const chosen = candidates[selected];
  return {
    status: state.preview.smartStatus,
    mode: chosen?.mode ?? "blocked",
    alternatives: candidates.length,
    selected: candidates.length ? selected + 1 : 0,
    elapsedMs: state.preview.searchElapsedMs ?? 0,
    explanation: state.preview.smartExplanation ?? "Smart Route is ready.",
  };
}

function sameStatus(a: RouteToolStatusView | null, b: RouteToolStatusView | null): boolean {
  return a?.status === b?.status
    && a?.mode === b?.mode
    && a?.alternatives === b?.alternatives
    && a?.selected === b?.selected
    && a?.explanation === b?.explanation
    && Math.round(a?.elapsedMs ?? 0) === Math.round(b?.elapsedMs ?? 0);
}

const EMPTY_BOARD = createEmptyBoard();

export function useRouteTool(editor: RouteToolEditor): RouteToolHandle {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<RouteToolStatusView | null>(null);
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
        const event = "historyEvents" in cmd ? cmd.historyEvents?.at(-1) : undefined;
        const netId = "netId" in cmd
          ? cmd.netId
          : cmd.kind === "CommitRouteCandidate"
            ? cmd.candidate.request.startAnchor?.netId ?? cmd.candidate.delta.createdTracks[0]?.netId
          : cmd.kind === "PlaceViaAndFlipLayer"
            ? cmd.via.netId
            : cmd.kind === "StretchTrack"
              ? cmd.after[0]?.netId
              : undefined;
        const layer = cmd.kind === "PlaceViaAndFlipLayer"
          ? cmd.via.layers[0]
          : cmd.kind === "CommitRouteCandidate"
            ? cmd.candidate.request.preferredLayer ?? cmd.candidate.delta.createdTracks[0]?.layer
          : cmd.kind === "CommitRouteSegment"
            ? cmd.segments[0]?.layer
            : cmd.kind === "StretchTrack"
              ? cmd.after[0]?.layer
              : undefined;
        h.execute(routeCommandLabel(cmd, h.present), (draft) => mutateBoardWithCommand(draft, cmd), {
          operationType: cmd.kind,
          ...(netId === undefined ? {} : { netId }),
          ...(layer === undefined ? {} : { layer }),
          ...(cmd.kind === "CommitRouteCandidate"
            ? { details: { candidateId: cmd.candidate.candidateId, candidateDigest: cmd.candidate.candidateDigest, mode: cmd.candidate.request.routeMode, posture: cmd.candidate.request.posture } }
            : event ? { details: { candidateId: event.candidateId, mode: event.mode, direction: event.direction, rules: event.rules } } : {}),
        });
      },
      {
        undo: () => getHistory()?.undo(),
        getActiveLayer: () => editorRef.current.getActiveLayer?.() ?? "copperTop",
        netClass: (netId) => getNetClass(getBoard(), netId),
        routingProfile: (netId) => resolveRoutingProfile(getBoard(), netId),
        onProtected: (objectIds) => editorRef.current.toast?.(
          `${objectIds.length} locked copper object${objectIds.length === 1 ? " was" : "s were"} protected. Unlock explicitly before modifying.`,
        ),
      },
    );

    // Preview lives above every physical layer, so hiding Board Outline or
    // changing the active copper layer never hides the in-progress route.
    const previewContainer = new Container();
    previewContainer.eventMode = "none";
    let previewParent: Container | null = null;
    try {
      previewParent = scene.getOverlayContainer();
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
        scene.setAirwires(computeElectricalTruth(b).realized.airwires);
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
          const next = statusFromState(tool.state);
          setStatus((current) => sameStatus(current, next) ? current : next);
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
              editorRef.current.toast?.("Ripped up selected route segment");
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
      setStatus(null);
      renderRoutePreview({ kind: "idle" }, getLayer, previewContainer); // clear + tooltip null
      previewParent?.removeChild(previewContainer);
      previewContainer.destroy({ children: true });
    };
  }, [active, scene]);

  return { activate, deactivate, active, status };
}
