"use client";

/**
 * React glue for net classes (PCB Stage 10). Reads the current board through
 * Stage 5's history stack (same accessor pattern as useRouteTool) and commits
 * every classing change as one undoable history entry.
 *
 * Note: the pinned spec shows `useNetClass()` with no args, but the hook needs
 * board/history access to function — it takes a small `NetClassEditor` (the
 * getHistory/getPinNames accessors PcbEditor already has), mirroring
 * useRouteTool's editor param.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbHistory } from "@/app/lib/pcb/history";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { getNetClass, ensureNetClassing, type NetClass, type NetClassId, type RuleDelta } from "@/app/lib/pcb/netclass";
import { reclassifyBoard } from "@/app/lib/pcb/netclass-rules";
import { throwAiResponseError, withAiBrain } from "@/app/lib/ai-preferences";

export interface NetClassEditor {
  /** The CURRENT history (PcbEditor recreates it on board reseed). */
  getHistory: () => PcbHistory | null;
  /** instanceId → (padNumber → schematic pin name), for the IC-power-pin
   *  topology heuristic. Absent → topology rule 3 is skipped. */
  getPinNames?: () => Record<string, Record<string, string>> | undefined;
}

export interface NetClassHandle {
  getClassForNet(netId: number): NetClass;
  runAutoClassify(): void;
  suggestBrief(brief: string): Promise<{ ok: true; delta: RuleDelta } | { ok: false; error: string }>;
  applyDelta(delta: RuleDelta): void;
  applyManualRules(netId: number, values: {
    classId: NetClassId;
    trackWidthNm: number;
    clearanceNm: number;
    viaSizeNm: number;
    viaDrillNm: number;
  }): void;
  applyBrief(brief: string): Promise<{ ok: true } | { ok: false; error: string }>;
  latestDelta?: RuleDelta;
}

const EMPTY_BOARD = createEmptyBoard();

/** Heuristic: a footprint with ≥6 pads is treated as an IC (for the brief). */
function boardHasIcs(board: PcbBoard): boolean {
  return board.footprints.some((f) => f.def.pads.length >= 6);
}

function boardNetNames(board: PcbBoard): string[] {
  return board.nets.filter((n) => n.id !== 0 && n.name).map((n) => n.name);
}

export function useNetClass(editor: NetClassEditor): NetClassHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });
  const [latestDelta, setLatestDelta] = useState<RuleDelta | undefined>(undefined);

  const getBoard = useCallback((): PcbBoard => editorRef.current.getHistory()?.present ?? EMPTY_BOARD, []);

  const getClassForNet = useCallback((netId: number): NetClass => getNetClass(getBoard(), netId), [getBoard]);

  const runAutoClassify = useCallback((): void => {
    const h = editorRef.current.getHistory();
    if (!h) return;
    const pinNames = editorRef.current.getPinNames?.();
    h.execute("Auto-classify nets", (draft) => reclassifyBoard(draft, { pinNames }));
  }, []);

  const suggestBrief = useCallback(
    async (brief: string): Promise<{ ok: true; delta: RuleDelta } | { ok: false; error: string }> => {
      const board = getBoard();
      try {
        const res = await fetch("/api/pcb/ai-rules/from-brief", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(withAiBrain({
            brief,
            board: { netNames: boardNetNames(board), hasIcs: boardHasIcs(board) },
          })),
        });
        const body = (await res.json()) as { ok: boolean; delta?: RuleDelta; error?: string };
        if (!res.ok || !body.ok || !body.delta) {
          if (!res.ok) {
            await throwAiResponseError(new Response(JSON.stringify(body), {
              status: res.status,
              headers: { "Content-Type": "application/json" },
            }));
          }
          return { ok: false, error: body.error ?? `Request failed (${res.status})` };
        }
        const delta = body.delta;
        // Append the delta, then reclassify: a fresh auto-classified base plus the
        // full sorted delta log — order-independent and deterministic.
        return { ok: true, delta };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [getBoard],
  );

  const applyDelta = useCallback((delta: RuleDelta): void => {
    const h = editorRef.current.getHistory();
    if (!h) return;
    const pinNames = editorRef.current.getPinNames?.();
    h.execute(`AI routing rules: ${(delta.brief ?? delta.explanation).slice(0, 40)}`, (draft) => {
      ensureNetClassing(draft).ruleDeltas.push(delta);
      reclassifyBoard(draft, { pinNames });
    });
    setLatestDelta(delta);
  }, []);

  const applyBrief = useCallback(async (brief: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    const proposal = await suggestBrief(brief);
    if (!proposal.ok) return proposal;
    applyDelta(proposal.delta);
    return { ok: true };
  }, [applyDelta, suggestBrief]);

  const applyManualRules = useCallback((
    netId: number,
    values: { classId: NetClassId; trackWidthNm: number; clearanceNm: number; viaSizeNm: number; viaDrillNm: number },
  ): void => {
    const h = editorRef.current.getHistory();
    if (!h) return;
    const netName = h.present.nets.find((net) => net.id === netId)?.name || `Net ${netId}`;
    const delta: RuleDelta = {
      id: `manual-routing-${Date.now()}-${netId}`,
      createdAt: new Date().toISOString(),
      source: "manual",
      changes: [{
        className: values.classId,
        trackWidthNm: values.trackWidthNm,
        clearanceNm: values.clearanceNm,
        viaSizeNm: values.viaSizeNm,
        viaDrillNm: values.viaDrillNm,
        appliesTo: { kind: "nets", netIds: [netId] },
      }],
      explanation: `Manual routing rules for ${netName}`,
    };
    const pinNames = editorRef.current.getPinNames?.();
    h.execute(`Edit routing rules for ${netName}`, (draft) => {
      ensureNetClassing(draft).ruleDeltas.push(delta);
      reclassifyBoard(draft, { pinNames });
    }, {
      operationType: "routing-rules",
      affectedObjects: [`net:${netId}`],
      netId,
      details: { ...values },
    });
    setLatestDelta(delta);
  }, []);

  return { getClassForNet, runAutoClassify, suggestBrief, applyDelta, applyManualRules, applyBrief, latestDelta };
}
