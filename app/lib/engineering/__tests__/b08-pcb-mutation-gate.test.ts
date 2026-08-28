/**
 * B08 — PCB mutation tripwire (CI source gate).
 *
 * Watched PCB product surfaces must not acquire NEW raw semantic writes:
 * every `history.execute(` / `h.execute(` / legacy `applyEdits(` call and
 * every `set-board` dispatch below is REGISTERED with its classification.
 * Adding one without updating this registry fails the build — the new site
 * must either commit through the canonical gateway/funnel, be a typed
 * lifecycle adoption, or be explicitly classified here (derived-only,
 * internal, or test-only fallback).
 *
 * Internal use inside PcbHistory and the canonical adapter/gateway is
 * exempt by design (they ARE the commit machinery); derived zone-fill and
 * render caches are classified separately.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface WatchedSurface {
  path: string;
  /** pattern → allowed occurrence count with classification. */
  allowed: Record<string, { count: number; classification: string }>;
}

const RAW_EXECUTE = /\b(?:history|h|delegate|raw)\s*\.\s*execute\s*\(/g;
const LEGACY_APPLY_EDITS = /\bapplyEdits\s*\(/g;
const SET_BOARD = /dispatch\(\{ type: "set-board"/g;
const APPLY_DERIVED = /\.applyDerived\s*\(/g;

const WATCHED: WatchedSurface[] = [
  { path: "app/components/pcb/PcbEditor.tsx", allowed: {
    execute: { count: 0, classification: "every ordinary edit commits through commitPcbCandidate/applyEditsCanonical" },
    applyEdits: { count: 0, classification: "context menu + palette use applyEditsCanonical" },
    setBoard: { count: 2, classification: "adoptBoardLifecycle dispatch (typed lifecycle boundary) + history-echo subscriber" },
    applyDerived: { count: 0, classification: "zone fills live in useZoneFills" },
  } },
  { path: "app/components/pcb/Inspector.tsx", allowed: {
    execute: { count: 0, classification: "canonical funnel only" },
    applyEdits: { count: 0, classification: "applyEditsCanonical only" },
    setBoard: { count: 0, classification: "no board writes" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/components/pcb/ZoneTool.tsx", allowed: {
    execute: { count: 0, classification: "commitPcbCandidate (pcb.zone)" },
    applyEdits: { count: 0, classification: "none" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/components/pcb/PadstackPanel.tsx", allowed: {
    execute: { count: 0, classification: "applyEditsCanonical (pcb.padstack)" },
    applyEdits: { count: 0, classification: "migrated to applyEditsCanonical" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/components/pcb/AssistBox.tsx", allowed: {
    execute: { count: 0, classification: "applyEditsCanonical under declared pcb.assist-edit" },
    applyEdits: { count: 0, classification: "migrated" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/components/pcb/hooks/useRouteTool.ts", allowed: {
    execute: { count: 0, classification: "commitPcbCandidate (pcb.route-copper)" },
    applyEdits: { count: 0, classification: "none" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/components/pcb/hooks/useSilkTool.ts", allowed: {
    execute: { count: 0, classification: "commitPcbCandidate (pcb.silkscreen-text)" },
    applyEdits: { count: 0, classification: "none" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/components/pcb/hooks/useAutoPlace.ts", allowed: {
    execute: { count: 0, classification: "commitPcbCandidate (pcb.auto-place)" },
    applyEdits: { count: 0, classification: "none" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/components/pcb/hooks/useAutoroute.ts", allowed: {
    execute: { count: 0, classification: "commitPcbCandidate (pcb.autoroute-import)" },
    applyEdits: { count: 0, classification: "none" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/components/pcb/hooks/useNetClass.ts", allowed: {
    execute: { count: 0, classification: "commitPcbCandidate (pcb.rules)" },
    applyEdits: { count: 0, classification: "none" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/components/pcb/hooks/usePcbRepair.ts", allowed: {
    execute: { count: 0, classification: "PCBToolService → applyRepairTransaction → commitPcbCandidate (pcb.board-repair)" },
    applyEdits: { count: 0, classification: "none" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/lib/pcb/repair/transaction.ts", allowed: {
    execute: { count: 0, classification: "commitPcbCandidate (pcb.board-repair); undoRepairTransaction uses history.undo (canonical-reconciled)" },
    applyEdits: { count: 0, classification: "previewRepairTransaction uses compileEdits (pure) only" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
  { path: "app/lib/pcb/ai/pcb-tool-service.ts", allowed: {
    execute: { count: 0, classification: "commitSelected → commitPcbCandidate (pcb.autonomous-layout)" },
    applyEdits: { count: 0, classification: "none" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 1, classification: "planRepairs zone refill — DERIVED-ONLY fill write, no semantic state, no history entry" },
  } },
  { path: "app/lib/pcb/tools/select-move.ts", allowed: {
    execute: { count: 4, classification: "TEST-ONLY legacy branches (move/rotate/flip/nudge) taken exclusively when no canonical session is bound; product histories are always session-bound" },
    applyEdits: { count: 1, classification: "TEST-ONLY legacy delete branch (unbound history); canonical branch uses applyEditsCanonical" },
    setBoard: { count: 0, classification: "none" },
    applyDerived: { count: 0, classification: "none" },
  } },
];

describe("B08 — PCB mutation tripwire", () => {
  it("no watched PCB product surface introduces an unclassified raw semantic write", () => {
    const failures: string[] = [];
    for (const surface of WATCHED) {
      const source = readFileSync(resolve(process.cwd(), surface.path), "utf8");
      const counts = {
        execute: (source.match(RAW_EXECUTE) ?? []).length,
        applyEdits: (source.match(LEGACY_APPLY_EDITS) ?? []).length,
        setBoard: (source.match(SET_BOARD) ?? []).length,
        applyDerived: (source.match(APPLY_DERIVED) ?? []).length,
      };
      for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
        if (counts[key] !== surface.allowed[key].count) {
          failures.push(`${surface.path}: ${key} count ${counts[key]} != registered ${surface.allowed[key].count} (${surface.allowed[key].classification})`);
        }
      }
    }
    expect(failures, "new raw PCB writes must be classified in this registry or routed through the canonical gateway").toEqual([]);
  });

  it("the canonical machinery itself remains the only internal execute path (adapter + gateway + edit funnel)", () => {
    const adapter = readFileSync(resolve(process.cwd(), "app/lib/engineering/editor-adapter.ts"), "utf8");
    expect(adapter).toContain("this.delegate.execute("); // canonical result application — internal by design
    const gateway = readFileSync(resolve(process.cwd(), "app/lib/engineering/pcb-commit-gateway.ts"), "utf8");
    expect(gateway).toContain("canonicalSessionFor(history)");
    const apply = readFileSync(resolve(process.cwd(), "app/lib/pcb/edit/apply.ts"), "utf8");
    expect(apply).toContain("history.execute(label"); // the bare-history legacy funnel (unbound histories only)
  });
});
