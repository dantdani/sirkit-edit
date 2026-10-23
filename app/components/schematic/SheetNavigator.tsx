"use client";

/**
 * [PR-J3, 2026-10-22] Runbook J.3 items 1, 3, 6, 7 (OD-255 item 7; OD-257 items 1, 2, 6): the SHEETS NAVIGATOR - a chip at the
 * canvas' bottom-right with a tree popover. Rendered by app/page.tsx beside the schematic editor with the sheet lens's
 * `navigatorProps`; every control calls the controller (`SheetNavigatorApi`), never the document.
 *
 *  - Single-sheet project: the chip reads "1 sheet" and the panel offers one action, New sheet (J.3: a small circuit never needs
 *    a tree).
 *  - Multi-sheet project: the chip row (always visible) carries Back (the parent), the breadcrumb (the active sheet's path), the
 *    chip (the sheet count; opens the tree), Move to sheet and Follow signal; the panel shows the tree (arrow keys move, Enter opens,
 *    Escape closes, Home / End) and the focused sheet's actions (New sheet, Rename, Up, Down, Add port, Delete).
 *  - Every structural change is a dialog with a preview and one explicit button: New / Rename / Add port (one sheet-structure
 *    transaction each), Delete (the impact; a populated sheet offers "Move contents to parent" first - a previewed move-to-sheet
 *    transaction - then "Delete sheet": two transactions, two undo steps), Move to sheet (the planner's preview: what moves, every
 *    crossing net with its port, sheet pin and hierarchical label, the nets whose board name changes, the offset; Apply re-plans on
 *    the canonical base; the dialog is disabled with the planner's own message while it refuses, e.g. unresolved part pins), Follow
 *    signal (the interface anchors of this sheet and where each reaches: "<sheet path> > <label>").
 *  - Previews are keyed by the lens activation: a sheet switch closes them (SR-3).
 * Controls are named for a person (text, aria-label or a wrapping label); data-testids are the J3 plan's.
 */

import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHEET_PORT_DIRECTIONS, sheetPathName, sheetsOf } from "@/app/lib/schematic/sheets";
import type { InterfaceSignal } from "@/app/lib/schematic/sheet-lens";
import { ROOT_SHEET_ID, type SchematicSheet, type SchematicState, type SheetPortDirection } from "@/lib/schematic-types";
import type { MovePlanMode, PlannedMove, SheetNavigatorApi } from "./hooks/sheet-navigation-controller";

export type { SheetNavigatorApi } from "./hooks/sheet-navigation-controller";

export interface SheetNavigatorProps {
  /** The whole project (authoritative). */
  state: SchematicState;
  activeSheetId: string;
  /** The lens activation: previews opened under another activation are closed. */
  activation: number;
  notice: string | null;
  controller: SheetNavigatorApi;
}

type DialogState =
  | { kind: "new"; parentId: string }
  | { kind: "rename"; sheetId: string }
  | { kind: "port"; sheetId: string }
  | { kind: "delete"; sheetId: string }
  | { kind: "move"; newSheetId: string }
  | { kind: "follow" };

interface Drafts {
  name: string;
  direction: SheetPortDirection;
  moveMode: Exclude<MovePlanMode, "contents">;
  /** "new" or an existing sheet id. */
  moveTarget: string;
}

const DIRECTION_WORDS: Readonly<Record<SheetPortDirection, string>> = Object.freeze({ input: "input", output: "output", bidirectional: "bidirectional", passive: "passive", power_in: "power in", power_out: "power out" });

const button = "h-7 inline-flex items-center gap-1 rounded px-2 text-[11px] font-mono text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent transition";
const primary = "h-7 inline-flex items-center gap-1 rounded px-2.5 text-[11px] font-mono bg-teal-700 text-white hover:bg-teal-600 disabled:opacity-40 disabled:hover:bg-teal-700 transition";
const field = "h-7 w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none";

/** The tree in display order: depth-first, siblings in document order. */
function flattenTree(sheets: readonly SchematicSheet[]): Array<{ sheet: SchematicSheet; depth: number }> {
  const byParent = new Map<string | null, SchematicSheet[]>();
  for (const sheet of sheets) byParent.set(sheet.parentId, [...(byParent.get(sheet.parentId) ?? []), sheet]);
  const out: Array<{ sheet: SchematicSheet; depth: number }> = [];
  const visit = (parentId: string | null, depth: number, seen: Set<string>): void => {
    for (const sheet of byParent.get(parentId) ?? []) {
      if (seen.has(sheet.id)) continue;
      seen.add(sheet.id);
      out.push({ sheet, depth });
      visit(sheet.id, depth + 1, seen);
    }
  };
  visit(null, 0, new Set());
  return out;
}

export function SheetNavigator({ state, activeSheetId, activation, notice, controller }: SheetNavigatorProps) {
  const { openSheet, goBack, dismissNotice, mintId, currentSelection, createSheet, renameSheet, reorderSheet, addPort, deleteImpact, deleteSheet, planMove, applyMove, interfaceSignals, followDestination } = controller;
  const legacy = state.sheets === undefined;
  const sheets = sheetsOf(state);
  const active = sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0]!;
  const rows = useMemo(() => flattenTree(sheets), [sheets]);
  const [open, setOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{ activation: number; dialog: DialogState } | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({ name: "", direction: "passive", moveMode: "selection", moveTarget: "new" });
  const [busy, setBusy] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  // SR-3: a preview opened under another activation is closed (derived, nothing to run on a switch)
  const dialog = dialogState !== null && dialogState.activation === activation ? dialogState.dialog : null;
  const focused = focusedId !== null && sheets.some((sheet) => sheet.id === focusedId) ? focusedId : activeSheetId;
  const focusedSheet = sheets.find((sheet) => sheet.id === focused) ?? active;
  const path = legacy ? "" : sheetPathName(state, activeSheetId);
  const breadcrumb = path === "" ? "Overview" : `Overview › ${path.split("/").join(" › ")}`;
  const chipText = legacy ? "1 sheet" : `${sheets.length} sheets`;

  const openDialog = (next: DialogState, name = ""): void => {
    setDrafts({ name, direction: "passive", moveMode: "selection", moveTarget: "new" });
    setDialogState({ activation, dialog: next });
  };
  const closeDialog = (): void => { setDialogState(null); };
  const run = async (action: () => Promise<{ ok: boolean }>, closeOnSuccess = true): Promise<void> => {
    setBusy(true);
    try {
      const outcome = await action();
      if (outcome.ok && closeOnSuccess) closeDialog();
    } finally {
      setBusy(false);
    }
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = rows.findIndex((row) => row.sheet.id === focused);
    const moveTo = (next: number): void => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, next))];
      if (!row) return;
      setFocusedId(row.sheet.id);
      itemRefs.current.get(row.sheet.id)?.focus();
    };
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); moveTo(index + 1); break;
      case "ArrowUp": event.preventDefault(); moveTo(index - 1); break;
      case "Home": event.preventDefault(); moveTo(0); break;
      case "End": event.preventDefault(); moveTo(rows.length - 1); break;
      case "Enter": case " ": event.preventDefault(); openSheet(focused); break;
      default: break; // Escape bubbles to the panel
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    setOpen(false);
    chipRef.current?.focus();
  };

  // ── the move preview (asked for on every render of the dialog; [PR-J3 integration, 2026-10-23] J3N-6: the controller's planMove is
  // pure and answers from its cache unless the document, the active sheet, the input, the selection or the unresolved parts changed) ──
  const selection = dialog?.kind === "move" ? currentSelection() : null;
  const moveTargetOptions = useMemo(() => {
    const children = sheets.filter((sheet) => sheet.parentId === activeSheetId);
    const parent = active.parentId === null ? null : sheets.find((sheet) => sheet.id === active.parentId) ?? null;
    return { children, parent };
  }, [sheets, activeSheetId, active.parentId]);
  const planned: PlannedMove | null = dialog?.kind === "move"
    ? planMove({
        mode: drafts.moveMode,
        ...(selection ? { selection: { family: selection.family, id: selection.id } } : {}),
        target: drafts.moveTarget === "new" ? { newSheet: { id: dialog.newSheetId, name: drafts.name.trim() || "New sheet" } } : { sheetId: drafts.moveTarget },
      })
    : null;
  const impact = dialog?.kind === "delete" ? deleteImpact(dialog.sheetId) : null;
  const contentsPlan: PlannedMove | null = impact !== null && impact.populated && impact.childSheets === 0
    ? planMove({ mode: "contents", sourceSheetId: impact.sheetId, target: { sheetId: sheets.find((sheet) => sheet.id === impact.sheetId)?.parentId ?? ROOT_SHEET_ID } })
    : null;
  const signals: InterfaceSignal[] = dialog?.kind === "follow" ? [...interfaceSignals()].sort((a, b) => a.name.localeCompare(b.name) || a.labelId.localeCompare(b.labelId)) : [];
  const destinationRows = signals.flatMap((signal) => signal.destinations.map((destination) => ({ signal, destination })));

  const submitNew = (event: FormEvent): void => { event.preventDefault(); if (dialog?.kind === "new") void run(() => createSheet(drafts.name, dialog.parentId)); };
  const submitRename = (event: FormEvent): void => { event.preventDefault(); if (dialog?.kind === "rename") void run(() => renameSheet(dialog.sheetId, drafts.name)); };
  const submitPort = (event: FormEvent): void => { event.preventDefault(); if (dialog?.kind === "port") void run(() => addPort(dialog.sheetId, drafts.name, drafts.direction)); };

  return (
    // [PR-J3, 2026-10-22] the column is right-aligned and as wide as its widest child (the chip row), so its empty area beside an open
    // panel sat over the canvas and swallowed clicks there (a +3V3 placement on the IMU sheet hit the container, not the sheet): the
    // container takes no pointer events, each visible child takes its own; the dialogs are portaled and unaffected
    <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-1 pointer-events-none" data-testid="sheets-navigator" data-active-sheet={activeSheetId} data-activation={activation}>
      {notice && (
        <div className="pointer-events-auto max-w-[26rem] rounded border border-amber-700/60 bg-zinc-900/95 px-2 py-1 text-[11px] text-amber-300 shadow-sm flex items-start gap-1" role="status">
          <span data-testid="sheets-notice" className="flex-1">{notice}</span>
          <button type="button" className="text-zinc-500 hover:text-zinc-200" onClick={dismissNotice} aria-label="Dismiss the sheets notice"><X className="size-3" /></button>
        </div>
      )}
      {open && (
        <div id="sheets-panel" data-testid="sheets-panel" role="group" aria-label="Sheets" className="pointer-events-auto w-72 max-h-[60vh] overflow-auto rounded-md border border-zinc-800 bg-zinc-900/95 p-2 shadow-lg text-zinc-200" onKeyDown={onPanelKeyDown}>
          <div className="pb-1 border-b border-zinc-800 text-[11px] font-mono text-zinc-500">{legacy ? "One sheet" : `${sheets.length} sheets · ${sheets.length - 1} subsystem${sheets.length === 2 ? "" : "s"}`}</div>
          {legacy ? (
            <div className="py-2 space-y-2">
              <p className="text-[11px] text-zinc-400">This project is one sheet. Create a subsystem sheet to organise it, or move the selected part to a new one (Move to sheet, beside the chip); the overview then shows each sheet as a block with its ports.</p>
              <button type="button" data-testid="sheets-new" className={primary} onClick={() => openDialog({ kind: "new", parentId: ROOT_SHEET_ID })}><Plus className="size-3" /> New sheet</button>
            </div>
          ) : (
            <>
              <div role="tree" aria-label="Sheets" data-testid="sheets-tree" className="py-1" onKeyDown={onTreeKeyDown}>
                {rows.map(({ sheet, depth }) => {
                  const isActive = sheet.id === activeSheetId;
                  const isFocused = sheet.id === focused;
                  return (
                    <div
                      key={sheet.id}
                      ref={(node) => { if (node) itemRefs.current.set(sheet.id, node); else itemRefs.current.delete(sheet.id); }}
                      role="treeitem"
                      aria-level={depth + 1}
                      aria-selected={isActive}
                      aria-current={isActive ? "page" : undefined}
                      tabIndex={isFocused ? 0 : -1}
                      data-testid={`sheets-tree-item-${sheet.id}`}
                      data-sheet-name={sheet.name}
                      className={`flex items-center gap-1 rounded px-1.5 py-1 text-[12px] cursor-pointer ${isActive ? "bg-teal-900/40 text-teal-200" : "hover:bg-zinc-800"} ${isFocused ? "ring-1 ring-zinc-600" : ""}`}
                      style={{ paddingLeft: 6 + depth * 14 }}
                      onClick={() => { setFocusedId(sheet.id); openSheet(sheet.id); }}
                    >
                      <ChevronRight className={`size-3 ${depth === 0 ? "opacity-0" : "text-zinc-600"}`} aria-hidden="true" />
                      <span className="flex-1 truncate">{sheet.parentId === null ? "Overview" : sheet.name}</span>
                      {sheet.parentId !== null && <span className="text-[10px] font-mono text-zinc-500">{(sheet.ports ?? []).length} port{(sheet.ports ?? []).length === 1 ? "" : "s"}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-zinc-800 pt-1 flex flex-wrap gap-1" aria-label={`Actions for sheet ${focusedSheet.parentId === null ? "Overview" : focusedSheet.name}`} role="group">
                <button type="button" data-testid="sheets-new" className={button} onClick={() => openDialog({ kind: "new", parentId: focused })}><Plus className="size-3" /> New sheet</button>
                <button type="button" data-testid="sheets-rename" className={button} onClick={() => openDialog({ kind: "rename", sheetId: focused }, focusedSheet.name)}><Pencil className="size-3" /> Rename</button>
                <button type="button" data-testid="sheets-reorder-up" className={button} disabled={focusedSheet.parentId === null || busy} onClick={() => void run(() => reorderSheet(focused, -1), false)}><ArrowUp className="size-3" /> Up</button>
                <button type="button" data-testid="sheets-reorder-down" className={button} disabled={focusedSheet.parentId === null || busy} onClick={() => void run(() => reorderSheet(focused, 1), false)}><ArrowDown className="size-3" /> Down</button>
                <button type="button" data-testid="sheets-add-port" className={button} disabled={focusedSheet.parentId === null} onClick={() => openDialog({ kind: "port", sheetId: focused })}><Plus className="size-3" /> Add port</button>
                <button type="button" data-testid="sheets-delete" className={button} disabled={focusedSheet.parentId === null} onClick={() => openDialog({ kind: "delete", sheetId: focused })}><Trash2 className="size-3" /> Delete</button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-1 bg-zinc-900/90 border border-zinc-800 rounded-md p-1 shadow-sm" data-testid="sheets-chip-row">
        {!legacy && active.parentId !== null && (
          <button type="button" data-testid="sheets-back" className={button} onClick={goBack} title="Back to the parent sheet"><ChevronLeft className="size-3.5" /> Back</button>
        )}
        {!legacy && <span data-testid="sheets-breadcrumb" className="max-w-56 truncate px-1 text-[11px] font-mono text-zinc-400" title={breadcrumb}>{breadcrumb}</span>}
        <button
          ref={chipRef}
          type="button"
          data-testid="sheets-chip"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? "sheets-panel" : undefined} // [PR-J3 integration, 2026-10-23] J3N-5: the panel is in the DOM only while open
          className={`${button} ${open ? "bg-zinc-800 text-zinc-100" : ""}`}
          onClick={() => setOpen((value) => !value)}
        >
          <Layers className="size-3.5" />
          <span>{chipText}</span>
        </button>
        <button type="button" data-testid="sheets-move" className={button} onClick={() => openDialog({ kind: "move", newSheetId: mintId("sheet") })} title="Move the selected part to another sheet">Move to sheet…</button>
        {!legacy && <button type="button" data-testid="sheets-follow" className={button} onClick={() => openDialog({ kind: "follow" })} title="Where this sheet's signals reach">Follow signal…</button>}
      </div>

      {/* ── dialogs (shared Dialog; each titled; [PR-J3, 2026-10-22] each scrolls inside 90vh: a Move preview with U2's 15 crossings was taller than a 768 px viewport and its Apply button sat below the fold, unreachable) ── */}
      <Dialog open={dialog?.kind === "new"} onOpenChange={(value) => { if (!value && !busy) closeDialog(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-sm">
          <DialogHeader><DialogTitle>New sheet</DialogTitle></DialogHeader>
          <form className="space-y-3 text-sm" onSubmit={submitNew}>
            <p className="text-xs text-zinc-400">A subsystem sheet under {dialog?.kind === "new" ? (sheets.find((sheet) => sheet.id === dialog.parentId)?.parentId === null ? "the overview" : `"${sheets.find((sheet) => sheet.id === dialog.parentId)?.name ?? ""}"`) : "the overview"}; it is drawn there as a block. One transaction, one undo step.</p>
            <label className="block text-xs text-zinc-400">Sheet name
              <input data-testid="sheets-new-name" className={field} value={drafts.name} autoFocus onChange={(event) => setDrafts((current) => ({ ...current, name: event.target.value }))} placeholder="Power, IMU, Motor drivers…" />
            </label>
            <DialogFooter>
              <button type="button" className={button} onClick={closeDialog}>Cancel</button>
              <button type="submit" data-testid="sheets-create" className={primary} disabled={busy || drafts.name.trim().length === 0}>Create sheet</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "rename"} onOpenChange={(value) => { if (!value && !busy) closeDialog(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-sm">
          <DialogHeader><DialogTitle>Rename sheet</DialogTitle></DialogHeader>
          <form className="space-y-3 text-sm" onSubmit={submitRename}>
            <label className="block text-xs text-zinc-400">New name
              <input data-testid="sheets-rename-name" className={field} value={drafts.name} autoFocus onChange={(event) => setDrafts((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <DialogFooter>
              <button type="button" className={button} onClick={closeDialog}>Cancel</button>
              <button type="submit" data-testid="sheets-rename-save" className={primary} disabled={busy || drafts.name.trim().length === 0}>Rename</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "port"} onOpenChange={(value) => { if (!value && !busy) closeDialog(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-sm">
          <DialogHeader><DialogTitle>Add a port</DialogTitle></DialogHeader>
          <form className="space-y-3 text-sm" onSubmit={submitPort}>
            <p className="text-xs text-zinc-400">A port is this sheet&apos;s interface signal: a hierarchical label is placed on the sheet and one sheet pin on its block on the parent sheet. Wire the pin on the parent and the label here. One transaction, one undo step.</p>
            <label className="block text-xs text-zinc-400">Port name
              <input data-testid="sheets-port-name" className={field} value={drafts.name} autoFocus onChange={(event) => setDrafts((current) => ({ ...current, name: event.target.value }))} placeholder="I2C_SCL" />
            </label>
            <label className="block text-xs text-zinc-400">Direction
              <select data-testid="sheets-port-direction" className={field} value={drafts.direction} onChange={(event) => setDrafts((current) => ({ ...current, direction: event.target.value as SheetPortDirection }))}>
                {SHEET_PORT_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{DIRECTION_WORDS[direction]}</option>)}
              </select>
            </label>
            <DialogFooter>
              <button type="button" className={button} onClick={closeDialog}>Cancel</button>
              <button type="submit" data-testid="sheets-port-add" className={primary} disabled={busy || drafts.name.trim().length === 0}>Add port</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "delete"} onOpenChange={(value) => { if (!value && !busy) closeDialog(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>Delete sheet</DialogTitle></DialogHeader>
          {impact && (
            <div className="space-y-3 text-sm" data-testid="sheets-delete-preview">
              <p className="text-xs text-zinc-300">{impact.message}</p>
              <ul className="text-[11px] text-zinc-400 grid grid-cols-2 gap-x-3">
                <li>{impact.components} component(s)</li><li>{impact.wires} wire(s)</li><li>{impact.labels} label(s)</li><li>{impact.ports} port(s), {impact.anchors} anchor(s)</li><li>{impact.childSheets} child sheet(s)</li>
              </ul>
              {contentsPlan !== null && (
                <div className="rounded border border-zinc-800 px-2 py-1.5 text-[11px] text-zinc-300 space-y-1">
                  {contentsPlan.ok ? (
                    <>
                      <div>Move contents to the parent: {contentsPlan.plan.preview.moved.components} component(s), {contentsPlan.plan.preview.moved.wires} wire(s), {contentsPlan.plan.preview.moved.labels} label(s){contentsPlan.offset.dx !== 0 || contentsPlan.offset.dy !== 0 ? ` shifted by (${contentsPlan.offset.dx}, ${contentsPlan.offset.dy}) px to a clear area` : ""}; the connections stay exactly as they are (partition proven).</div>
                      {contentsPlan.plan.preview.crossings.length > 0 && <div className="text-zinc-500">{contentsPlan.plan.preview.crossings.length} net(s) are carried through a port: {contentsPlan.plan.preview.crossings.map((crossing) => crossing.port.name).join(", ")}</div>}
                    </>
                  ) : (
                    // [PR-J3 integration, 2026-10-23] J3N-3: the planner's SHEET_MOVE_* code shown inline and as data-code, as the page's Go to and Undo refusals show theirs
                    <div className="text-amber-300" data-testid="sheets-delete-move-refusal" data-code={contentsPlan.code ?? ""}>{contentsPlan.code ? `${contentsPlan.code} — ` : ""}{contentsPlan.message}</div>
                  )}
                </div>
              )}
              <DialogFooter>
                <button type="button" className={button} onClick={closeDialog}>Cancel</button>
                {impact.populated && impact.childSheets === 0 && (
                  <button type="button" data-testid="sheets-delete-move-contents" className={primary} disabled={busy || contentsPlan === null || !contentsPlan.ok} onClick={() => { if (contentsPlan) void run(() => applyMove(contentsPlan), false); }}>Move contents to parent</button>
                )}
                <button type="button" data-testid="sheets-delete-confirm" className={`${primary} bg-red-800 hover:bg-red-700 disabled:hover:bg-red-800`} disabled={busy || !impact.deletable} onClick={() => void run(() => deleteSheet(impact.sheetId))}>Delete sheet</button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "move"} onOpenChange={(value) => { if (!value && !busy) closeDialog(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader><DialogTitle>Move to sheet</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm" data-testid="sheets-move-preview">
            <p className="text-xs text-zinc-400">
              {selection ? <>Moving <span className="text-teal-300">{selection.label}</span> from {active.parentId === null ? "the overview" : `"${active.name}"`}.</> : "Select a component on this sheet first."}
              {" "}Every net the move cuts is carried by an explicit port: a sheet pin on the parent, a hierarchical label on the child. Identities, values and the pin-to-net partition are unchanged. One transaction, one undo step.
            </p>
            <fieldset className="flex flex-wrap gap-3 text-xs text-zinc-300">
              <legend className="text-zinc-500">What moves</legend>
              <label className="flex items-center gap-1"><input type="radio" name="sheets-move-mode" value="selection" checked={drafts.moveMode === "selection"} onChange={() => setDrafts((current) => ({ ...current, moveMode: "selection" }))} /> the part with its attached wires and local labels</label>
              <label className="flex items-center gap-1"><input type="radio" name="sheets-move-mode" value="group" checked={drafts.moveMode === "group"} onChange={() => setDrafts((current) => ({ ...current, moveMode: "group" }))} /> its connected group on this sheet</label>
            </fieldset>
            <label className="block text-xs text-zinc-400">Target sheet
              <select data-testid="sheets-move-target" className={field} value={drafts.moveTarget} onChange={(event) => setDrafts((current) => ({ ...current, moveTarget: event.target.value }))}>
                <option value="new">A new sheet under {active.parentId === null ? "the overview" : active.name}…</option>
                {moveTargetOptions.children.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}
                {moveTargetOptions.parent && <option value={moveTargetOptions.parent.id}>Up to {moveTargetOptions.parent.parentId === null ? "the overview" : moveTargetOptions.parent.name}</option>}
              </select>
            </label>
            {drafts.moveTarget === "new" && (
              <label className="block text-xs text-zinc-400">New sheet name
                <input data-testid="sheets-move-new-name" className={field} value={drafts.name} onChange={(event) => setDrafts((current) => ({ ...current, name: event.target.value }))} placeholder="IMU" />
              </label>
            )}
            {planned && (planned.ok ? (
              <div className="rounded border border-zinc-800 px-2 py-1.5 text-[11px] text-zinc-300 space-y-1" data-testid="sheets-move-plan">
                <div>Moves {planned.plan.preview.moved.components} component(s), {planned.plan.preview.moved.wires} wire(s), {planned.plan.preview.moved.labels} label(s) to <span className="text-teal-300">{planned.targetName}</span>{planned.offset.dx !== 0 || planned.offset.dy !== 0 ? ` shifted by (${planned.offset.dx}, ${planned.offset.dy}) px to a clear area` : ""}.</div>
                {planned.plan.preview.crossings.length === 0 ? <div className="text-zinc-500">No net is cut: nothing crosses the sheet boundary.</div> : (
                  <table className="w-full text-left text-[11px]">
                    <thead><tr className="text-zinc-500"><th className="pr-2">Net</th><th className="pr-2">Port</th><th className="pr-2">Sheet pin</th><th>Hierarchical label</th></tr></thead>
                    <tbody>
                      {planned.plan.preview.crossings.map((crossing, index) => (
                        <tr key={`${crossing.port.id}:${index}`} data-testid="sheets-move-crossing" data-net={crossing.netName ?? ""}>
                          <td className="pr-2 text-teal-300">{crossing.netName ?? "(unnamed)"}</td>
                          <td className="pr-2">{crossing.port.name}</td>
                          <td className="pr-2 text-zinc-400">on {sheets.find((sheet) => sheet.id === crossing.sheetPin.sheetId)?.parentId === null ? "the overview" : sheets.find((sheet) => sheet.id === crossing.sheetPin.sheetId)?.name ?? crossing.sheetPin.sheetId} at ({crossing.sheetPin.position.x}, {crossing.sheetPin.position.y})</td>
                          <td className="text-zinc-400">{crossing.hierarchicalLabels.length} on {crossing.port.sheetId === planned.plan.preview.createdSheet?.id ? planned.targetName : sheets.find((sheet) => sheet.id === crossing.port.sheetId)?.name ?? crossing.port.sheetId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {planned.plan.preview.renamedNets.length > 0 && (
                  <div className="text-amber-300" data-testid="sheets-move-renamed">Board names change (connections do not): {planned.plan.preview.renamedNets.map((net) => `${net.from} → ${net.to ?? "(unnamed)"}`).join(", ")}</div>
                )}
              </div>
            ) : (
              // [PR-J3 integration, 2026-10-23] J3N-3: the SHEET_MOVE_* code inline and as data-code (a refusal of the controller's own, e.g. no selection, shows the message alone)
              <div className="rounded border border-amber-800/60 px-2 py-1.5 text-[11px] text-amber-300" data-testid="sheets-move-refusal" data-code={planned.code ?? ""}>{planned.code ? `${planned.code} — ` : ""}{planned.message}</div>
            ))}
            <DialogFooter>
              <button type="button" className={button} onClick={closeDialog}>Cancel</button>
              <button type="button" data-testid="sheets-move-apply" className={primary} disabled={busy || planned === null || !planned.ok} onClick={() => { if (planned) void run(() => applyMove(planned)); }}>Apply move</button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "follow"} onOpenChange={(value) => { if (!value) closeDialog(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader><DialogTitle>Follow a signal</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm" data-testid="sheets-follow-panel">
            <p className="text-xs text-zinc-400">Where this sheet&apos;s interface signals (sheet pins, hierarchical labels, global labels) reach on the other sheets. Choosing a destination opens that sheet, highlights the net and centres the anchor.</p>
            {signals.length === 0 ? <p className="text-xs text-zinc-500">This sheet has no cross-sheet signal.</p> : destinationRows.length === 0 ? <p className="text-xs text-zinc-500">The signals of this sheet ({signals.map((signal) => signal.name).join(", ")}) reach no other sheet yet.</p> : (
              <ul className="space-y-1 max-h-[50vh] overflow-auto" aria-label="Destinations by signal">
                {signals.filter((signal) => signal.destinations.length > 0).map((signal) => (
                  <li key={signal.labelId}>
                    <div className="text-[11px] text-zinc-400 pt-1" data-testid={`sheets-follow-signal-${signal.labelId}`}><span className="text-teal-300">{signal.name}</span> · {signal.scope === "sheet-pin" ? "sheet pin" : signal.scope === "hierarchical" ? "hierarchical label" : "global label"}{signal.netName ? ` · net ${signal.netName}` : ""}</div>
                    <ul className="space-y-0.5">
                      {signal.destinations.map((destination) => {
                        const index = destinationRows.findIndex((row) => row.destination.labelId === destination.labelId && row.signal.labelId === signal.labelId);
                        return (
                          <li key={destination.labelId}>
                            <button type="button" data-testid={`sheets-follow-destination-${index}`} data-sheet={destination.sheetId} className={`${button} w-full justify-start`} onClick={() => { closeDialog(); followDestination(destination); }}>
                              <span>{destination.sheetPath === "" ? "Overview" : destination.sheetPath.split("/").join(" › ")}</span><span className="text-zinc-500">›</span><span className="text-teal-300">{destination.labelName}</span><span className="text-zinc-600">{destination.scope === "hierarchical" ? "(port)" : destination.scope === "sheet-pin" ? "(sheet pin)" : destination.scope === "global" ? "(global)" : "(label)"}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <button type="button" className={button} onClick={closeDialog}>Close</button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
