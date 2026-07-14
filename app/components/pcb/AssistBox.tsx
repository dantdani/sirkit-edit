"use client";

/**
 * AI assist box (PCB Stage 17 Phase D) — the reason this stage exists. Types
 * an instruction, POSTs { instruction, digest, items } to /api/pcb/edit/assist,
 * then runs the returned commands through the CLIENT gate: `compileEdits`
 * against the live board + `previewEdits` dry-run. Output failing either gate
 * is discarded with a visible message, never patched. Valid edits show a
 * pending chip (describeEdits text, affected count, preview violations) —
 * Apply commits ONE undo entry labeled `AI: <instruction>`; nothing ever
 * auto-applies.
 */

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { DrcRules, DrcPresetId } from "@/app/lib/pcb/drc/types";
import type { EditCommand, SelectionRef } from "@/app/lib/pcb/edit/commands";
import { refKey } from "@/app/lib/pcb/edit/commands";
import { applyEdits, compileEdits } from "@/app/lib/pcb/edit/apply";
import { previewEdits } from "@/app/lib/pcb/edit/preview";
import { describeEdits } from "@/app/lib/pcb/edit/describe";
import { buildDigest, buildItemIndex } from "@/app/lib/pcb/edit/digest";

interface PendingEdit {
  commands: EditCommand[];
  instruction: string;
  label: string;
  affected: number;
  violations: string[];
  explanation: string;
}

/** Unique items a batch touches — the pending chip's "N items". */
function countAffected(commands: EditCommand[]): number {
  const keys = new Set<string>();
  for (const cmd of commands) {
    switch (cmd.op) {
      case "set-track-width":
        for (const id of cmd.ids) keys.add(`track:${id}`);
        break;
      case "set-via-padstack":
        for (const id of cmd.viaIds) keys.add(`via:${id}`);
        break;
      case "set-position":
        keys.add(refKey(cmd.ref));
        break;
      case "set-footprint-props":
        keys.add(`footprint:${cmd.id}`);
        break;
      case "set-zone-props":
        keys.add(`zone:${cmd.id}`);
        break;
      case "set-text-props":
        keys.add(`text:${cmd.id}`);
        break;
      case "create-padstack":
      case "edit-padstack":
      case "delete-padstack":
        keys.add(`padstack:${"id" in cmd ? cmd.id : "new"}`);
        break;
      default:
        for (const ref of cmd.refs) keys.add(refKey(ref));
    }
  }
  return keys.size;
}

export function AssistBox({
  board,
  getSelectionRefs,
  getHistory,
  rules,
  presetId,
  toast,
}: {
  board: PcbBoard;
  /** Read at submit time so a stale render never sends a stale selection. */
  getSelectionRefs: () => SelectionRef[];
  getHistory: () => PcbHistory | null;
  rules: DrcRules;
  presetId: DrcPresetId;
  toast(message: string): void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // question or discard message

  const submit = async (): Promise<void> => {
    const instruction = text.trim();
    if (instruction === "" || busy) return;
    setBusy(true);
    setNotice(null);
    setPending(null);
    try {
      const res = await fetch("/api/pcb/edit/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction,
          digest: buildDigest(board, getSelectionRefs(), { presetId }),
          items: buildItemIndex(board),
        }),
      });
      const data = (await res.json()) as {
        commands?: EditCommand[];
        explanation?: string;
        question?: string;
        error?: string;
      };
      if (!res.ok) {
        setNotice(`Assist failed: ${data.error ?? res.statusText}`);
        return;
      }
      if (data.question) {
        setNotice(data.question);
        return;
      }
      const commands = data.commands ?? [];
      if (commands.length === 0) {
        setNotice("The assistant returned no edits.");
        return;
      }

      // CLIENT GATE — re-validate against the live board; discard, never patch.
      const compiled = compileEdits(board, commands);
      if (compiled.errors.length > 0) {
        setNotice(`The AI's edit didn't match the board and was discarded: ${compiled.errors[0]}`);
        return;
      }
      const preview = previewEdits(board, commands, rules);
      setPending({
        commands,
        instruction,
        label: describeEdits(board, commands),
        affected: countAffected(commands),
        violations: preview.violations.map((v) => v.summary),
        explanation: data.explanation ?? "",
      });
    } catch (err) {
      setNotice(`Assist failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const apply = (): void => {
    if (!pending) return;
    const h = getHistory();
    if (!h) return;
    const result = applyEdits(h, pending.commands, `AI: ${pending.instruction}`);
    if (result.ok) {
      toast(pending.label);
      setPending(null);
      setText("");
    } else {
      setNotice(`The edit no longer applies: ${result.errors[0]}`);
      setPending(null);
    }
  };

  return (
    <div className="px-3 py-2 border-t border-zinc-800/60">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 shrink-0 text-teal-500" />
        <input
          type="text"
          aria-label="Assist instruction"
          placeholder="Describe an edit…"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600 disabled:opacity-50"
        />
        {busy && <Loader2 className="size-3.5 shrink-0 animate-spin text-zinc-500" />}
      </div>

      {notice && <p className="mt-1.5 text-[11px] leading-snug text-zinc-400">{notice}</p>}

      {pending && (
        <div className="mt-1.5 rounded border border-teal-900/60 bg-teal-950/30 px-2 py-1.5">
          <p className="text-xs text-zinc-200">{pending.label}</p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            {pending.affected} item{pending.affected === 1 ? "" : "s"} affected
            {pending.explanation ? ` · ${pending.explanation}` : ""}
          </p>
          {pending.violations.slice(0, 2).map((v) => (
            <p key={v} className="mt-0.5 text-[11px] leading-snug text-amber-400">
              ⚠ {v}
            </p>
          ))}
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={apply}
              className="px-2 py-0.5 rounded bg-teal-600 text-[11px] text-white hover:bg-teal-500 transition-colors"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="px-2 py-0.5 rounded text-[11px] text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
