"use client";

/**
 * Properties inspector (PCB Stage 17 Phase B) — the right-column panel that
 * makes the board click-inspect-edit like a real EDA. Renders nothing while
 * the selection is empty; single-kind selections get their kind inspector,
 * mixed selections get the shared-fields inspector.
 *
 * Every edit flows through `applyEdits` (the single mutation path): fields
 * never touch the board directly, batches are one undo step, and validation
 * errors surface as a toast — never a silent no-op.
 */

import { Crosshair, Trash2 } from "lucide-react";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbScene } from "@/app/lib/pcb/render/scene";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { DrcRules, DrcPresetId } from "@/app/lib/pcb/drc/types";
import type { SelectionStore } from "@/app/lib/pcb/selection";
import type { EditCommand, SelectionRef } from "@/app/lib/pcb/edit/commands";
import { selectionBBoxCenter } from "@/app/lib/pcb/edit/apply";
import { applyEditsCanonical } from "@/app/lib/engineering/editor-adapter";
import { previewEdits, type EditPreview } from "@/app/lib/pcb/edit/preview";
import { getItems, type ResolvedItem } from "@/app/lib/pcb/selection-queries";
import { useSelection } from "./hooks/useSelection";
import { netLabel } from "./inspectors/shared";
import { TrackInspector } from "./inspectors/TrackInspector";
import { ViaInspector } from "./inspectors/ViaInspector";
import { PadInspector, type PadItem } from "./inspectors/PadInspector";
import { FootprintInspector } from "./inspectors/FootprintInspector";
import { ZoneInspector } from "./inspectors/ZoneInspector";
import { TextInspector } from "./inspectors/TextInspector";
import { MixedInspector } from "./inspectors/MixedInspector";
import { ArrangeSection } from "./inspectors/ArrangeSection"; // Stage 17 Phase D
import { AssistBox } from "./AssistBox"; // Stage 17 Phase D

const KIND_WORD: Record<ResolvedItem["kind"], string> = {
  via: "via",
  track: "track",
  zone: "zone",
  text: "text item",
  footprint: "part",
  pad: "pad",
};

function headerText(board: PcbBoard, items: ResolvedItem[]): string {
  if (items.length === 1) {
    const item = items[0];
    switch (item.kind) {
      case "via":
        return `Via ${item.via.id} · ${netLabel(board, item.via.netId)}`;
      case "track":
        return `Track · ${netLabel(board, item.track.netId)}`;
      case "zone":
        return `Zone · ${netLabel(board, item.zone.netId)}`;
      case "text":
        return `Silk text`;
      case "footprint":
        return item.footprint.ref;
      case "pad":
        return `Pad ${item.pad.number || "NPTH"} · ${item.footprint.ref}`;
    }
  }
  const kinds = new Set(items.map((i) => i.kind));
  if (kinds.size === 1) {
    const word = KIND_WORD[items[0].kind];
    return `${items.length} ${word}${items.length === 1 ? "" : "s"}`;
  }
  return `${items.length} items · mixed`;
}

export function Inspector({
  board,
  selection,
  getHistory,
  scene,
  rules,
  presetId,
  toast,
  onRefillZones,
}: {
  board: PcbBoard;
  selection: SelectionStore;
  getHistory: () => PcbHistory | null;
  scene: PcbScene | null;
  rules: DrcRules;
  presetId: DrcPresetId;
  toast(message: string): void;
  onRefillZones?(): void;
}) {
  const set = useSelection(selection);
  const items = getItems(board, set.refs);
  if (items.length === 0) return null;

  // B03: slice-representable batches execute through the canonical executor;
  // everything else falls back to the legacy path inside applyEditsCanonical.
  const commit = (cmds: EditCommand[]): void => {
    const h = getHistory();
    if (!h) return;
    void applyEditsCanonical(h, cmds).then((result) => {
      if (!result.ok && result.errors[0]) toast(result.errors[0]);
    });
  };
  const preview = (cmds: EditCommand[]): EditPreview => previewEdits(board, cmds, rules);

  const kinds = new Set(items.map((i) => i.kind));
  const kind = kinds.size === 1 ? items[0].kind : "mixed";

  const deletable: SelectionRef[] = set.refs.filter(
    (r) => r.kind === "track" || r.kind === "via" || r.kind === "zone" || r.kind === "text",
  );
  const hasFootprints = set.refs.some((r) => r.kind === "footprint");

  const body = (() => {
    switch (kind) {
      case "track":
        return (
          <TrackInspector
            board={board}
            items={items.flatMap((i) => (i.kind === "track" ? [i.track] : []))}
            commit={commit}
            preview={preview}
          />
        );
      case "via":
        return (
          <ViaInspector
            board={board}
            items={items.flatMap((i) => (i.kind === "via" ? [i.via] : []))}
            commit={commit}
            preview={preview}
          />
        );
      case "pad":
        return (
          <PadInspector
            board={board}
            items={items.flatMap((i): PadItem[] =>
              i.kind === "pad" ? [{ footprint: i.footprint, pad: i.pad, netId: i.netId }] : [],
            )}
          />
        );
      case "footprint":
        return (
          <FootprintInspector
            board={board}
            items={items.flatMap((i) => (i.kind === "footprint" ? [i.footprint] : []))}
            commit={commit}
          />
        );
      case "zone":
        return (
          <ZoneInspector
            board={board}
            items={items.flatMap((i) => (i.kind === "zone" ? [i.zone] : []))}
            commit={commit}
            onRefill={onRefillZones}
          />
        );
      case "text":
        return (
          <TextInspector
            items={items.flatMap((i) => (i.kind === "text" ? [i.text] : []))}
            commit={commit}
          />
        );
      default:
        return <MixedInspector board={board} items={items} commit={commit} />;
    }
  })();

  return (
    <div className="flex flex-col min-h-0 border-t border-zinc-800">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-baseline gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Properties
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-zinc-400">
          {headerText(board, items)}
        </span>
      </div>
      <div className="overflow-y-auto py-1">
        {body}
        <ArrangeSection refs={set.refs} commit={commit} />
      </div>
      <div className="px-3 py-1.5 border-t border-zinc-800/60 flex items-center gap-2">
        <button
          type="button"
          onClick={() => scene?.centerOn(selectionBBoxCenter(board, set.refs))}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          <Crosshair className="size-3" />
          Zoom to
        </button>
        {(deletable.length > 0 || hasFootprints) && (
          <button
            type="button"
            onClick={() => {
              if (deletable.length > 0) {
                commit([{ op: "delete-items", refs: deletable }]);
              }
              if (hasFootprints) {
                toast(
                  "Footprints can't be deleted on the board — remove the part from the schematic and re-sync.",
                );
              }
            }}
            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="size-3" />
            Delete
          </button>
        )}
      </div>
      <AssistBox
        board={board}
        getSelectionRefs={() => selection.get().refs}
        getHistory={getHistory}
        rules={rules}
        presetId={presetId}
        toast={toast}
      />
    </div>
  );
}
