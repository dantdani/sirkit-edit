"use client";

/**
 * Assignment queue (PCB Stage 4): slide-over listing components the sync
 * couldn't auto-resolve. Per row: AI suggestions (on-demand — POST
 * /api/pcb/assign/suggest) and a manual search over Stage 2's footprint
 * library. Picking either writes the footprint and removes the row.
 */

import { useState } from "react";
import { Loader2, Search, Sparkles, X } from "lucide-react";
import type { NetlistComponent } from "@/app/lib/pcb/netlist-bridge";
import type { FootprintSearchHit } from "@/app/lib/pcb/footprint-api-types";
import type { SuggestCandidate } from "@/app/api/pcb/assign/suggest/route";

export interface QueueItem {
  componentId: string;
  ref: string;
  reason: string;
  component: NetlistComponent;
}

export type FootprintPick = { id: string; fullName: string };

export function AssignmentQueue({
  open,
  items,
  onClose,
  onAssign,
}: {
  open: boolean;
  items: QueueItem[];
  onClose: () => void;
  onAssign: (componentId: string, pick: FootprintPick) => Promise<void>;
}) {
  return (
    <div
      className={`absolute inset-y-0 right-0 z-40 w-96 max-w-full transform transition-transform duration-200 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      aria-hidden={!open}
    >
      <div className="h-full flex flex-col border-l border-zinc-800 bg-zinc-900/95 backdrop-blur">
        <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-zinc-800">
          <span className="text-xs font-medium text-zinc-200">
            Footprint assignment
            {items.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                {items.length}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assignment queue"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="p-4 text-xs text-zinc-500">
              Nothing needs attention — every component has a footprint.
            </p>
          ) : (
            items.map((item) => (
              <QueueRow key={item.componentId} item={item} onAssign={onAssign} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function QueueRow({
  item,
  onAssign,
}: {
  item: QueueItem;
  onAssign: (componentId: string, pick: FootprintPick) => Promise<void>;
}) {
  const [suggesting, setSuggesting] = useState(false);
  const [candidates, setCandidates] = useState<SuggestCandidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<FootprintSearchHit[] | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pinCount = item.component.pins.length;

  async function suggest(): Promise<void> {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/pcb/assign/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ component: item.component }),
      });
      if (!res.ok) throw new Error(`suggest failed (${res.status})`);
      const data = (await res.json()) as { candidates?: SuggestCandidate[] };
      setCandidates(data.candidates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  }

  async function search(): Promise<void> {
    if (query.trim() === "") return;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query, limit: "8" });
      if (pinCount > 0) params.set("padCount", String(pinCount));
      const res = await fetch(`/api/pcb/footprints/search?${params}`);
      if (!res.ok) throw new Error(`search failed (${res.status})`);
      const data = (await res.json()) as { hits?: FootprintSearchHit[] };
      setHits(data.hits ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function pick(p: FootprintPick): Promise<void> {
    setAssigning(p.id);
    setError(null);
    try {
      await onAssign(item.componentId, p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAssigning(null);
    }
  }

  return (
    <div className="border-b border-zinc-800/70 px-3 py-2.5 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-zinc-200">{item.ref}</span>
        {item.component.value && <span className="text-zinc-400">{item.component.value}</span>}
        {item.component.package && <span className="text-zinc-500">{item.component.package}</span>}
        <span className="ml-auto text-zinc-500">{pinCount} pins</span>
      </div>
      <p className="mt-0.5 text-zinc-500">{item.reason}</p>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void suggest()}
          disabled={suggesting}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors disabled:opacity-50"
        >
          {suggesting ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          Suggest (AI)
        </button>
        <div className="flex-1 flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
            placeholder="Search footprints…"
            aria-label={`Search footprints for ${item.ref}`}
            className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-teal-600"
          />
          <button
            type="button"
            onClick={() => void search()}
            disabled={searching}
            aria-label="Search"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {searching ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}
          </button>
        </div>
      </div>

      {error && <p className="mt-1.5 text-red-400">{error}</p>}

      {candidates !== null && (
        <ul className="mt-2 space-y-1">
          {candidates.length === 0 && <li className="text-zinc-500">No AI candidates found.</li>}
          {candidates.map((c) => (
            <li key={c.footprintId} className="rounded border border-zinc-800 bg-zinc-950/60 p-1.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-zinc-300" title={c.fullName}>{c.fullName}</span>
                <span className="ml-auto shrink-0 text-teal-500">{Math.round(c.confidence * 100)}%</span>
                <PickButton
                  busy={assigning === c.footprintId}
                  onPick={() => void pick({ id: c.footprintId, fullName: c.fullName })}
                />
              </div>
              <p className="mt-0.5 text-zinc-500">{c.reason}</p>
            </li>
          ))}
        </ul>
      )}

      {hits !== null && (
        <ul className="mt-2 space-y-1">
          {hits.length === 0 && <li className="text-zinc-500">No matches.</li>}
          {hits.map((h) => (
            <li key={h.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/60 p-1.5">
              <span className="truncate text-zinc-300" title={h.fullName}>{h.fullName}</span>
              <span className="ml-auto shrink-0 text-zinc-500">{h.padCount} pads</span>
              <PickButton busy={assigning === h.id} onPick={() => void pick({ id: h.id, fullName: h.fullName })} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PickButton({ busy, onPick }: { busy: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      className="shrink-0 px-1.5 py-0.5 rounded bg-teal-600/80 text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : "Use"}
    </button>
  );
}
