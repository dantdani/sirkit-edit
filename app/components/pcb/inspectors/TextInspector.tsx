"use client";

/**
 * Silk text inspector (PCB Stage 17 Phase B). Content (single item), cap
 * height, stroke width and silk layer — all through `set-text-props`.
 */

import { useEffect, useRef, useState } from "react";
import type { SilkTextItem } from "@/app/lib/pcb/silk/types";
import type { EditCommand } from "@/app/lib/pcb/edit/commands";
import { NumberField } from "./fields/NumberField";
import { LayerField } from "./fields/LayerField";

export function TextInspector({
  items,
  commit,
}: {
  items: SilkTextItem[];
  commit(cmds: EditCommand[]): void;
}) {
  const single = items.length === 1 ? items[0] : null;
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(null), [single?.text]);

  const commitText = (): void => {
    if (!single || draft === null) return;
    const text = draft;
    setDraft(null);
    if (text.length === 0 || text === single.text) return;
    commit([{ op: "set-text-props", id: single.id, patch: { text } }]);
  };

  return (
    <>
      {single && (
        <div className="px-3 py-1 flex items-center gap-2">
          <label className="w-16 shrink-0 text-[11px] text-zinc-500">Text</label>
          <input
            ref={inputRef}
            type="text"
            aria-label="Text"
            value={draft ?? single.text}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitText();
                inputRef.current?.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
                inputRef.current?.blur();
              }
            }}
            className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-teal-600"
          />
        </div>
      )}
      <NumberField
        label="Size"
        unit="mm"
        scaleFromNm={1e-6}
        values={items.map((t) => t.heightNm)}
        onCommit={(nm) =>
          commit(
            items.map((t) => ({
              op: "set-text-props" as const,
              id: t.id,
              patch: { sizeNm: nm },
            })),
          )
        }
      />
      <NumberField
        label="Stroke"
        unit="mm"
        scaleFromNm={1e-6}
        values={items.map((t) => t.strokeWidthNm)}
        onCommit={(nm) =>
          commit(
            items.map((t) => ({
              op: "set-text-props" as const,
              id: t.id,
              patch: { thicknessNm: nm },
            })),
          )
        }
      />
      <LayerField
        values={items.map((t) => t.layer)}
        allowed={["silkTop", "silkBottom"]}
        onCommit={(layer) =>
          commit(
            items.map((t) => ({
              op: "set-text-props" as const,
              id: t.id,
              patch: { layer },
            })),
          )
        }
      />
    </>
  );
}
