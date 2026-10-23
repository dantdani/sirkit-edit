/**
 * [PR-J3, 2026-10-22] Runbook section J increment 3 (OD-255 item 6, OD-257 item 3): the pure AI replace-result guard.
 *
 * Until sheet-aware generation lands (J5-2), every AI replace-style result - a generated schematic (Build), an edited one
 * (/api/schematic/edit -> edit-build) and a tidied one (/api/schematic/layout-critic) - is ONE flat page: it carries no `sheets` and
 * no `sheetId`. Adopting such a result over a multi-sheet document would silently flatten the project (every child sheet, port and
 * sheet pin gone; the parts pasted back onto the overview). This module decides, purely, whether that is about to happen and words
 * the refusal; the page calls it (in place, app/page.tsx) at:
 *
 *  - the Build composer's start, BEFORE a generation task is started (no task, no spend; OD-257 item 3): `multiSheetReplaceRefusal(base)`;
 *  - the edit path and Tidy, BEFORE their provider-bound requests (the same function: both pipelines produce a flat result);
 *  - the offer of a generated result (chat-started tasks reach the project through the offer) and the FINAL apply boundary, where
 *    the incoming state is known: `flatReplacementRefusal(base, incoming)` - null when the incoming state carries its own sheets
 *    (a J5-2 sheet-aware result passes through to the existing review).
 *
 * The message names the sheet count and the sheet names (bounded, so a project with many or long names still reads in one toast) and
 * ends with the page's "Nothing was changed." wording. Pure: no I/O, no randomness, no React, no page import.
 */

import type { SchematicState } from "@/lib/schematic-types";

/** The most sheet names the message lists; the rest are counted ("and N more"). */
export const SHEET_REPLACE_GUARD_MAX_NAMES = 4;
/** A sheet name longer than this is shortened in the message (the document keeps the full name). */
export const SHEET_REPLACE_GUARD_MAX_NAME_LENGTH = 16;
/** The upper bound of a message, whatever the sheet count and names (a page toast; a test proves it for 512 long-named sheets). */
export const SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH = 240;
export const SHEET_REPLACE_GUARD_TAIL = "Sheet-aware generation is not available yet. Nothing was changed." as const;

type SheetsOf = Pick<SchematicState, "sheets">;

function shortName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > SHEET_REPLACE_GUARD_MAX_NAME_LENGTH ? `${trimmed.slice(0, SHEET_REPLACE_GUARD_MAX_NAME_LENGTH - 1)}…` : trimmed;
}

/** The sheet names as the message lists them: document order (root first), at most `SHEET_REPLACE_GUARD_MAX_NAMES`, each shortened. */
export function sheetNamesForMessage(base: SheetsOf): string {
  const names = (base.sheets?.sheets ?? []).map((sheet) => shortName(sheet.name));
  const shown = names.slice(0, SHEET_REPLACE_GUARD_MAX_NAMES);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/**
 * The refusal for ANY flat (single-page) AI result over `base`: a message when `base` is a multi-sheet document, null for a
 * single-sheet one. For the call sites where the result does not exist yet (the Build start, the edit request, Tidy): every one of
 * those pipelines produces a flat page until J5-2.
 */
export function multiSheetReplaceRefusal(base: SheetsOf): string | null {
  const sheets = base.sheets?.sheets ?? [];
  if (base.sheets === undefined || sheets.length === 0) return null;
  const count = sheets.length;
  return `This project has ${count} schematic sheet${count === 1 ? "" : "s"} (${sheetNamesForMessage(base)}). A flat AI result would replace them. ${SHEET_REPLACE_GUARD_TAIL}`;
}

/**
 * The refusal for a KNOWN incoming result: a message when a FLAT `incoming` state (no `sheets`) would replace a multi-sheet `base`;
 * null when the base is single-sheet, and null when the incoming state carries its own sheet tree (it is not a flattening - the
 * existing review and the canonical validator judge it).
 */
export function flatReplacementRefusal(base: SheetsOf, incoming: SheetsOf): string | null {
  if (incoming.sheets !== undefined) return null;
  return multiSheetReplaceRefusal(base);
}
