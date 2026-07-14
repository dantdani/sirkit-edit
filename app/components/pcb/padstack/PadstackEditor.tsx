"use client";

/**
 * Padstack detail form (PCB Stage 17 Phase C). Edits auto-commit through
 * `edit-padstack` debounced 500 ms — each flush is ONE undo entry that also
 * updates every via using the padstack (the registry's denormalization).
 * The live preview SVG and the preset-aware warnings track the PENDING
 * values, so feedback is immediate while commits stay coalesced.
 */

import { useEffect, useRef, useState } from "react";
import type { Padstack, PadstackInput } from "@/app/lib/pcb/padstack/types";
import type { DrcRules } from "@/app/lib/pcb/drc/types";
import type { EditCommand } from "@/app/lib/pcb/edit/commands";
import { fmtMm } from "@/app/lib/pcb/drc/format";
import { nmToMm, mmToNm } from "@/app/lib/pcb/units";
import { PadstackPreviewSvg } from "./PadstackPreviewSvg";

const FLUSH_MS = 500;

function fieldClass(): string {
  return "flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-teal-600";
}

/** Preset-aware warnings in the Stage 12 voice — hints, never blockers. */
function warningsFor(p: PadstackInput, rules: DrcRules): string[] {
  const out: string[] = [];
  const d = rules.default;
  if (p.outerNm < d.minViaOuterNm) {
    out.push(`Outer ${fmtMm(p.outerNm)} mm is below the ${fmtMm(d.minViaOuterNm)} mm minimum this fab plates.`);
  }
  if (p.drillNm < d.minViaDrillNm) {
    out.push(`Drill ${fmtMm(p.drillNm)} mm is below the ${fmtMm(d.minViaDrillNm)} mm minimum this fab drills.`);
  }
  const annular = (p.outerNm - p.drillNm) / 2;
  if (p.drillNm < p.outerNm && annular < d.minAnnularRingNm) {
    out.push(`Annular ring ${fmtMm(annular)} mm is below the ${fmtMm(d.minAnnularRingNm)} mm this fab needs.`);
  }
  if (p.drillNm >= p.outerNm) {
    out.push("Drill must be smaller than the outer diameter.");
  }
  return out;
}

export function PadstackEditor({
  padstack,
  rules,
  commit,
}: {
  padstack: Padstack;
  rules: DrcRules;
  commit(cmds: EditCommand[]): void;
}) {
  const [pending, setPending] = useState<Partial<PadstackInput>>({});
  // Raw text for the dim inputs so intermediate states ("0.", "") type fine.
  const [outerText, setOuterText] = useState<string | null>(null);
  const [drillText, setDrillText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => {});

  const effective: PadstackInput = { ...padstack, ...pending };

  flushRef.current = () => {
    if (Object.keys(pending).length === 0) return;
    commit([{ op: "edit-padstack", id: padstack.id, patch: pending }]);
    setPending({});
    setOuterText(null);
    setDrillText(null);
  };

  const stage = (patch: Partial<PadstackInput>): void => {
    setPending((prev) => ({ ...prev, ...patch }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), FLUSH_MS);
  };

  // Flush pending edits when the selection moves on / the panel unmounts.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      flushRef.current();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [padstack.id],
  );

  const stageDim = (key: "outerNm" | "drillNm", text: string): void => {
    if (key === "outerNm") setOuterText(text);
    else setDrillText(text);
    const v = Number(text.trim().replace(",", "."));
    if (Number.isFinite(v) && v > 0) stage({ [key]: mmToNm(v) });
  };

  const warnings = warningsFor(effective, rules);

  return (
    <div className="border-t border-zinc-800/60">
      <div className="px-3 py-2 flex items-center gap-3">
        <PadstackPreviewSvg
          outerNm={effective.outerNm}
          drillNm={effective.drillNm}
          tented={effective.tented}
          size={48}
        />
        <div className="min-w-0 flex-1 text-[10px] text-zinc-500 leading-relaxed">
          <p>Outer {fmtMm(effective.outerNm)} mm</p>
          <p>Drill {fmtMm(effective.drillNm)} mm</p>
          <p>Ring {fmtMm(Math.max((effective.outerNm - effective.drillNm) / 2, 0))} mm</p>
        </div>
      </div>
      <div className="px-3 py-1 flex items-center gap-2">
        <label className="w-16 shrink-0 text-[11px] text-zinc-500">Name</label>
        <input
          type="text"
          aria-label="Padstack name"
          value={pending.name ?? padstack.name}
          onChange={(e) => stage({ name: e.target.value })}
          className={fieldClass()}
        />
      </div>
      <div className="px-3 py-1 flex items-center gap-2">
        <label className="w-16 shrink-0 text-[11px] text-zinc-500">Outer</label>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Outer diameter"
          value={outerText ?? String(nmToMm(effective.outerNm))}
          onChange={(e) => stageDim("outerNm", e.target.value)}
          className={fieldClass()}
        />
        <span className="shrink-0 text-[10px] text-zinc-600 w-6">mm</span>
      </div>
      <div className="px-3 py-1 flex items-center gap-2">
        <label className="w-16 shrink-0 text-[11px] text-zinc-500">Drill</label>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Drill diameter"
          value={drillText ?? String(nmToMm(effective.drillNm))}
          onChange={(e) => stageDim("drillNm", e.target.value)}
          className={fieldClass()}
        />
        <span className="shrink-0 text-[10px] text-zinc-600 w-6">mm</span>
      </div>
      <label className="px-3 py-1 flex items-center gap-2 cursor-pointer">
        <span className="w-16 shrink-0 text-[11px] text-zinc-500">Tented</span>
        <input
          type="checkbox"
          aria-label="Tented"
          checked={effective.tented}
          onChange={(e) => stage({ tented: e.target.checked })}
          className="size-3.5 accent-teal-600"
        />
      </label>
      <div className="px-3 py-1 flex items-center gap-2">
        <label className="w-16 shrink-0 text-[11px] text-zinc-500">Zones</label>
        <select
          aria-label="Zone connect"
          value={effective.zoneConnect}
          onChange={(e) => stage({ zoneConnect: e.target.value as "solid" | "thermal" })}
          className={fieldClass()}
        >
          <option value="solid">Solid connection</option>
          <option value="thermal">Thermal relief</option>
        </select>
      </div>
      {warnings.map((w) => (
        <p key={w} className="px-3 py-0.5 text-[11px] leading-snug text-amber-400">
          ⚠ {w}
        </p>
      ))}
    </div>
  );
}
