"use client";

/**
 * Layer panel (PCB Stage 3). Rows come from Stage 1's canonical LAYERS table,
 * filtered by board.stackup (in1/in2 hidden on 2-layer boards).
 * Product constraint: KiCad layer names (F.Cu) never appear in the UI —
 * always displayName ("Top Copper").
 */

import { Eye, EyeOff } from "lucide-react";
import { LAYERS, type LayerId } from "@/app/lib/pcb/layers";

export function LayerPanel({
  stackup,
  activeLayer,
  isVisible,
  onToggleVisible,
  onActivate,
}: {
  stackup: 2 | 4;
  activeLayer: LayerId;
  isVisible: (layer: LayerId) => boolean;
  onToggleVisible: (layer: LayerId) => void;
  onActivate: (layer: LayerId) => void;
}) {
  const rows = LAYERS.filter(
    (l) => stackup === 4 || (l.id !== "in1" && l.id !== "in2"),
  );

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
        Layers
      </div>
      <div className="overflow-y-auto">
        {rows.map((layer) => {
          const active = layer.id === activeLayer;
          const visible = isVisible(layer.id);
          return (
            <div
              key={layer.id}
              onClick={() => onActivate(layer.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer border-l-2 transition-colors ${
                active
                  ? "border-teal-500 bg-zinc-800/60"
                  : "border-transparent hover:bg-zinc-800/40"
              }`}
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
              <button
                type="button"
                aria-label={`Toggle ${layer.displayName} visibility`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisible(layer.id);
                }}
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
