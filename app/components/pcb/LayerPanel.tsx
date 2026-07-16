"use client";

/**
 * Layer panel (PCB Stage 3). Rows come from Stage 1's canonical LAYERS table,
 * filtered by board.stackup (in1/in2 hidden on 2-layer boards).
 * Product constraint: KiCad layer names (F.Cu) never appear in the UI —
 * always displayName ("Top Copper").
 */

import { Eye, EyeOff, Focus, Layers3 } from "lucide-react";
import { LAYERS, type LayerId } from "@/app/lib/pcb/layers";

export function LayerPanel({
  stackup,
  activeLayer,
  isVisible,
  onToggleVisible,
  onActivate,
  onIsolate,
  onShowAllCopper,
  layerUsage,
}: {
  stackup: 2 | 4;
  activeLayer: LayerId;
  isVisible: (layer: LayerId) => boolean;
  onToggleVisible: (layer: LayerId) => void;
  onActivate: (layer: LayerId) => void;
  onIsolate: (layer: LayerId) => void;
  onShowAllCopper: () => void;
  layerUsage?: Partial<Record<LayerId, { segments: number; trackLengthNm: number }>>;
}) {
  const rows = LAYERS.filter(
    (l) => stackup === 4 || (l.id !== "in1" && l.id !== "in2"),
  );

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-zinc-800">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Layers</p>
        <p className="mt-0.5 text-[10px] normal-case tracking-normal text-zinc-600">Click a row to focus its copper · eye toggles visibility</p>
        <div className="mt-2 flex gap-1">
          <button type="button" onClick={() => onIsolate(activeLayer)} className="flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-1 text-[9px] text-zinc-400 hover:text-zinc-200">
            <Focus className="size-3" /> Isolate
          </button>
          <button type="button" onClick={onShowAllCopper} className="flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-1 text-[9px] text-zinc-400 hover:text-zinc-200">
            <Layers3 className="size-3" /> Show copper
          </button>
        </div>
      </div>
      <div className="overflow-y-auto">
        {rows.map((layer) => {
          const active = layer.id === activeLayer;
          const visible = isVisible(layer.id);
          return (
            <div
              key={layer.id}
              className={`group flex items-center gap-1 pr-3 border-l-2 transition-colors ${
                active
                  ? "border-teal-500 bg-zinc-800/60"
                  : "border-transparent hover:bg-zinc-800/40"
              }`}
            >
              <button
                type="button"
                aria-label={`Activate ${layer.displayName}`}
                aria-pressed={active}
                onClick={() => onActivate(layer.id)}
                className="min-w-0 flex-1 flex items-center gap-2 pl-2 py-1.5 text-left"
              >
                <span
                  className="size-3 shrink-0 rounded-[3px] border border-zinc-700"
                  style={{ backgroundColor: layer.defaultColor }}
                />
                <span
                  className={`flex-1 text-xs truncate ${
                    active ? "text-zinc-100" : visible ? "text-zinc-300" : "text-zinc-600"
                  }`}
                >
                  {layer.displayName}
                </span>
                {layerUsage?.[layer.id] && (
                  <span className="text-[8px] text-zinc-600">{layerUsage[layer.id]!.segments}</span>
                )}
                {active && <span className="text-[8px] font-semibold tracking-wider text-teal-400">ACTIVE</span>}
              </button>
              <button
                type="button"
                aria-label={`Toggle ${layer.displayName} visibility`}
                onClick={() => onToggleVisible(layer.id)}
                className="shrink-0 p-0.5 rounded text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                {visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
