"use client";

/**
 * Padstack library panel (PCB Stage 17 Phase C) — a right-column view (NOT a
 * modal) toggled by the toolbar's Padstacks button. Library edits are always
 * global: the `edit-padstack` command updates every via using the padstack in
 * the same undo step (the registry's denormalization invariant).
 */

import { useState } from "react";
import { Copy, Plus, Trash2, X } from "lucide-react";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { DrcRules } from "@/app/lib/pcb/drc/types";
import type { EditCommand } from "@/app/lib/pcb/edit/commands";
import { applyEdits } from "@/app/lib/pcb/edit/apply";
import { usageCount, nextPadstackId } from "@/app/lib/pcb/padstack/registry";
import { formatMm } from "@/app/lib/pcb/units";
import { PadstackPreviewSvg } from "./padstack/PadstackPreviewSvg";
import { PadstackEditor } from "./padstack/PadstackEditor";

export function PadstackPanel({
  board,
  getHistory,
  rules,
  toast,
  onClose,
}: {
  board: PcbBoard;
  getHistory: () => PcbHistory | null;
  rules: DrcRules;
  toast(message: string): void;
  onClose(): void;
}) {
  const padstacks = board.padstacks ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(padstacks[0]?.id ?? null);
  const selected = padstacks.find((p) => p.id === selectedId) ?? padstacks[0] ?? null;

  const commit = (cmds: EditCommand[]): void => {
    const h = getHistory();
    if (!h) return;
    const result = applyEdits(h, cmds);
    if (!result.ok && result.errors[0]) toast(result.errors[0]);
  };

  const addNew = (): void => {
    const id = nextPadstackId(board);
    commit([
      {
        op: "create-padstack",
        padstack: {
          name: "New via 0.6/0.3",
          kind: "via",
          outerNm: 600_000,
          drillNm: 300_000,
          tented: true,
          zoneConnect: "solid",
        },
      },
    ]);
    setSelectedId(id);
  };

  const duplicate = (): void => {
    if (!selected) return;
    const id = nextPadstackId(board);
    commit([
      {
        op: "create-padstack",
        padstack: {
          name: `${selected.name} copy`,
          kind: "via",
          outerNm: selected.outerNm,
          drillNm: selected.drillNm,
          tented: selected.tented,
          zoneConnect: selected.zoneConnect,
        },
      },
    ]);
    setSelectedId(id);
  };

  const selectedUsage = selected ? usageCount(board, selected.id) : 0;

  return (
    <div className="flex flex-col min-h-0 border-t border-zinc-800">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 flex-1">
          Padstacks
        </span>
        <button
          type="button"
          aria-label="Close padstacks"
          onClick={onClose}
          className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="max-h-44 overflow-y-auto">
        {padstacks.map((p) => {
          const used = usageCount(board, p.id);
          const active = selected?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left border-l-2 transition-colors ${
                active
                  ? "border-teal-500 bg-zinc-800/60"
                  : "border-transparent hover:bg-zinc-800/40"
              }`}
            >
              <PadstackPreviewSvg
                outerNm={p.outerNm}
                drillNm={p.drillNm}
                tented={p.tented}
                size={20}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-zinc-200 truncate">{p.name}</span>
                <span className="block text-[10px] text-zinc-600">
                  {formatMm(p.outerNm)}/{formatMm(p.drillNm)} mm
                </span>
              </span>
              {used > 0 && (
                <span className="shrink-0 px-1 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-400">
                  Used {used}×
                </span>
              )}
            </button>
          );
        })}
        {padstacks.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-zinc-600">No padstacks yet.</p>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-zinc-800/60 flex items-center gap-2">
        <button
          type="button"
          onClick={addNew}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <Plus className="size-3" />
          New
        </button>
        <button
          type="button"
          onClick={duplicate}
          disabled={!selected}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
        >
          <Copy className="size-3" />
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => selected && commit([{ op: "delete-padstack", id: selected.id }])}
          disabled={!selected || selectedUsage > 0}
          title={
            selectedUsage > 0
              ? `Used by ${selectedUsage} via${selectedUsage === 1 ? "" : "s"} — switch those vias to another padstack first.`
              : undefined
          }
          className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-red-400/80"
        >
          <Trash2 className="size-3" />
          Delete
        </button>
      </div>

      {selected && (
        <div className="overflow-y-auto">
          <PadstackEditor key={selected.id} padstack={selected} rules={rules} commit={commit} />
        </div>
      )}
    </div>
  );
}
