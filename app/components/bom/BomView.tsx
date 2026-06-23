"use client";

/**
 * Bill of Materials.
 *
 * Walks the schematic's components (idealized Theory parts) + kicadComponents
 * (real catalog parts) and groups them into BOM line items. Grouping key:
 *   - KiCad parts: partId + value  (same symbol, different value = different line,
 *     e.g. a generic "R" symbol used for both 10k and 4.7k)
 *   - Theory parts: type + value
 * Ground symbols are excluded (a net reference, not an orderable part).
 *
 * MPN / footprint / manufacturer / datasheet come from the cached catalog part.
 * Price/stock are intentionally absent — they need a distributor integration
 * (e.g. Digi-Key), which isn't wired up.
 */

import { useEffect, useReducer, useState } from "react";
import type { SchComponent, SchComponentType, KicadComponentInstance } from "@/lib/schematic-types";
import { getCachedPart, ensurePartLoaded, subscribeToPart } from "@/app/lib/parts-cache";

const THEORY_LABEL: Record<SchComponentType, string> = {
  resistor: "Resistor",
  capacitor: "Capacitor",
  inductor: "Inductor",
  diode: "Diode",
  "voltage-source": "Voltage source",
  "current-source": "Current source",
  ground: "Ground",
};

type BomLine = {
  refs: string[];
  description: string;
  value: string;
  mpn: string | null;
  footprint: string | null;
  manufacturer: string | null;
  datasheet: string | null;
};

// Natural refDes order: group by alpha prefix, then numeric suffix (R2 < R10).
function refDesSort(a: string, b: string): number {
  const ma = a.match(/^([A-Za-z]+)(\d*)$/);
  const mb = b.match(/^([A-Za-z]+)(\d*)$/);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1]);
    return (parseInt(ma[2] || "0", 10) || 0) - (parseInt(mb[2] || "0", 10) || 0);
  }
  return a.localeCompare(b);
}

function buildBom(
  components: SchComponent[],
  kicadComponents: KicadComponentInstance[],
): BomLine[] {
  const map = new Map<string, BomLine>();

  for (const k of kicadComponents) {
    const key = `k|${k.partId}|${k.value}`;
    let line = map.get(key);
    if (!line) {
      const part = getCachedPart(k.partId);
      line = {
        refs: [],
        description: part?.name ?? "Loading…",
        value: k.value,
        mpn: part?.mpn ?? null,
        footprint: part?.footprintHint ?? null,
        manufacturer: part?.manufacturer ?? null,
        datasheet: part?.datasheet ?? null,
      };
      map.set(key, line);
    }
    line.refs.push(k.refDes);
  }

  for (const c of components) {
    if (c.type === "ground") continue; // not an orderable part
    const key = `t|${c.type}|${c.value}`;
    let line = map.get(key);
    if (!line) {
      line = {
        refs: [],
        description: THEORY_LABEL[c.type],
        value: c.value,
        mpn: null,
        footprint: null,
        manufacturer: null,
        datasheet: null,
      };
      map.set(key, line);
    }
    line.refs.push(c.id);
  }

  const lines = [...map.values()];
  for (const l of lines) l.refs.sort(refDesSort);
  lines.sort((a, b) => a.description.localeCompare(b.description) || a.value.localeCompare(b.value));
  return lines;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(lines: BomLine[]): string {
  const header = ["Item", "Refs", "Description", "Value", "MPN", "Footprint", "Manufacturer", "Qty", "Datasheet"];
  const rows = lines.map((l, i) => [
    i + 1,
    l.refs.join(" "),
    l.description,
    l.value,
    l.mpn ?? "",
    l.footprint ?? "",
    l.manufacturer ?? "",
    l.refs.length,
    l.datasheet ?? "",
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

const TD = "px-3 py-1.5 align-top border-b border-zinc-800/70";
const TH = "px-3 py-2 text-left font-medium text-zinc-400 sticky top-0 bg-zinc-950 border-b border-zinc-800";
const dash = (v: string | null) => (v && v.trim() !== "" ? v : <span className="text-zinc-600">—</span>);

export function BomView({
  components,
  kicadComponents,
}: {
  components: SchComponent[];
  kicadComponents: KicadComponentInstance[];
}) {
  // Re-render when async KiCad part data lands in the cache.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsubs = kicadComponents.map((k) => subscribeToPart(k.partId, forceRender));
    for (const k of kicadComponents) void ensurePartLoaded(k.partId).then(forceRender).catch(() => {});
    return () => { for (const u of unsubs) u(); };
  }, [kicadComponents]);

  const [copied, setCopied] = useState(false);
  const lines = buildBom(components, kicadComponents);
  const totalQty = lines.reduce((n, l) => n + l.refs.length, 0);

  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(lines));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (lines.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm select-none">
        No components yet — generate or place parts to see the bill of materials.
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-auto bg-zinc-950">
      <div className="flex items-center gap-3 px-3 h-10 border-b border-zinc-800 sticky top-0 bg-zinc-950 z-10">
        <span className="text-xs text-zinc-300 font-medium">Bill of Materials</span>
        <span className="text-xs text-zinc-500">
          {lines.length} line item{lines.length === 1 ? "" : "s"} · {totalQty} component{totalQty === 1 ? "" : "s"}
        </span>
        <button
          onClick={copyCsv}
          className="ml-auto text-xs px-2 h-7 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition"
        >
          {copied ? "Copied!" : "Copy CSV"}
        </button>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-10`}>#</th>
            <th className={TH}>Refs</th>
            <th className={TH}>Description</th>
            <th className={TH}>Value</th>
            <th className={TH}>MPN</th>
            <th className={TH}>Footprint</th>
            <th className={TH}>Manufacturer</th>
            <th className={`${TH} text-right`}>Qty</th>
            <th className={TH}>Datasheet</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {lines.map((l, i) => (
            <tr key={`${l.description}|${l.value}|${i}`} className="hover:bg-zinc-900/50">
              <td className={`${TD} text-zinc-500`}>{i + 1}</td>
              <td className={`${TD} font-mono text-zinc-200`}>{l.refs.join(", ")}</td>
              <td className={TD}>{l.description}</td>
              <td className={`${TD} font-mono`}>{dash(l.value)}</td>
              <td className={`${TD} font-mono`}>{dash(l.mpn)}</td>
              <td className={`${TD} font-mono text-zinc-400`}>{dash(l.footprint)}</td>
              <td className={TD}>{dash(l.manufacturer)}</td>
              <td className={`${TD} text-right tabular-nums`}>{l.refs.length}</td>
              <td className={TD}>
                {l.datasheet ? (
                  <a
                    href={l.datasheet}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal-400 hover:underline"
                  >
                    Datasheet ↗
                  </a>
                ) : (
                  <span className="text-zinc-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="px-3 py-2 text-[11px] text-zinc-600">
        Pricing &amp; stock aren&apos;t shown — they require a distributor integration (e.g. Digi-Key).
      </div>
    </div>
  );
}
