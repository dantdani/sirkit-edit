"use client";

/**
 * [PR-J3, 2026-10-22] Runbook J.1 / J.3 item 1 (OD-255 item 7): the OVERVIEW's subsystem blocks. For every child sheet of the active
 * sheet it draws the sheet symbol (`SchematicSheet.block`, or a deterministic default cell when none is stored - see
 * app/lib/schematic/sheet-lens.ts `sheetBlockOf`), its name, its port count and its ports along the block's edges (inputs and
 * power_in on the left, the rest on the right). A double-click opens the sheet (view.canvas-navigation). Rendered by the editor
 * inside its world group through the `sheetLayer` prop, so coordinates are sheet px; the sheet pins themselves are labels and are
 * drawn by the editor's label map (ScopedNetLabelGlyph). Presentation only: nothing here changes the document.
 */

import type { SchematicSheet, SchematicState } from "@/lib/schematic-types";
import { sheetBlockOf } from "@/app/lib/schematic/sheet-lens";
import { sheetsOf } from "@/app/lib/schematic/sheets";

export interface SheetBlocksLayerProps {
  state: SchematicState;
  activeSheetId: string;
  openSheet: (sheetId: string) => void;
}

const INBOUND = new Set(["input", "power_in"]);

export function SheetBlocksLayer({ state, activeSheetId, openSheet }: SheetBlocksLayerProps) {
  if (state.sheets === undefined) return null;
  const children: SchematicSheet[] = sheetsOf(state).filter((sheet) => sheet.parentId === activeSheetId);
  if (children.length === 0) return null;
  return (
    <g data-testid="sheet-blocks">
      {children.map((sheet) => {
        const block = sheetBlockOf(state, sheet);
        const ports = sheet.ports ?? [];
        const left = ports.filter((port) => INBOUND.has(port.direction));
        const right = ports.filter((port) => !INBOUND.has(port.direction));
        return (
          <g
            key={sheet.id}
            data-testid={`sheet-block-${sheet.id}`}
            data-sheet-name={sheet.name}
            data-port-count={ports.length}
            role="button"
            aria-label={`Open sheet ${sheet.name}`}
            style={{ cursor: "pointer" }}
            onDoubleClick={() => openSheet(sheet.id)}
          >
            <rect x={block.x} y={block.y} width={block.width} height={block.height} rx={4} fill="#0f766e" fillOpacity={0.08} stroke="#14b8a6" strokeWidth={1.5} strokeDasharray="6 3" />
            <text x={block.x + block.width / 2} y={block.y - 10} textAnchor="middle" fontSize={16} fontWeight={600} fontFamily="monospace" fill="#5eead4" style={{ userSelect: "none" }}>
              {sheet.name}
            </text>
            <text x={block.x + block.width / 2} y={block.y + block.height + 18} textAnchor="middle" fontSize={11} fontFamily="monospace" fill="#5eead4" fillOpacity={0.8} style={{ userSelect: "none" }}>
              {ports.length === 1 ? "1 port" : `${ports.length} ports`} · double-click to open
            </text>
            {left.map((port, index) => (
              <text key={port.id} x={block.x + 8} y={block.y + 20 + index * 20} fontSize={11} fontFamily="monospace" fill="#99f6e4" dominantBaseline="middle" style={{ userSelect: "none" }}>
                {`▸ ${port.name}`}
              </text>
            ))}
            {right.map((port, index) => (
              <text key={port.id} x={block.x + block.width - 8} y={block.y + 20 + index * 20} fontSize={11} fontFamily="monospace" fill="#99f6e4" textAnchor="end" dominantBaseline="middle" style={{ userSelect: "none" }}>
                {`${port.name} ▸`}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}
