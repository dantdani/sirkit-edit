/**
 * [PR-J3, 2026-10-22] Runbook section J increment 3 (OD-255 item 6, OD-257 item 3): the pure AI replace-result guard.
 *
 * An AI replace-style result that is ONE flat page - an edited schematic (/api/schematic/edit -> edit-build), a tidied one
 * (/api/schematic/layout-critic), or a generated design the planner did not split into blocks - carries no `sheets` and no `sheetId`.
 * Adopting such a result over a multi-sheet document would silently flatten the project (every child sheet, port and sheet pin gone;
 * the parts pasted back onto the overview). This module decides, purely, whether that is about to happen and words the refusal; the
 * page calls it (in place, app/page.tsx) at:
 *
 *  - the edit path and Tidy, BEFORE their provider-bound requests: `multiSheetReplaceRefusal(base)` (both pipelines produce a flat result);
 *  - the offer of a generated result (chat-started tasks reach the project through the offer) and the FINAL apply boundary, where
 *    the incoming state is known: `flatReplacementRefusal(base, incoming)` - null when the incoming state carries its own sheets
 *    (a sheet-aware result passes through to the existing review).
 *
 * [PR-J5, 2026-10-23] OD-259 item 2 (revising OD-257 item 3): a planned generation result now lays out as sheets (lib/build-sheet-layout.ts)
 * and replaces a multi-sheet project as one undoable transaction (OD-255 item 9), so the Build composer no longer REFUSES at its start
 * on a multi-sheet base: `multiSheetReplaceAdvisory(base)` is the activity step it shows instead (what the result will replace; that a
 * one-page result is refused at review). The refusal stays for a FLAT result at the offer and the apply, and its tail now says what to
 * do (the generation is sheet-aware: ask for the design as subsystem blocks, or start a new project).
 * [PR-J5 integration, 2026-10-26] review B-2: the THEORY composer still refuses at its start, before its provider-bound request
 * (`multiSheetReplaceRefusal(base, "theory")`: no request, no spend) - a Theory result is always one page, so OD-257 item 3 holds there.
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
/** [PR-J5, 2026-10-23] pin move: was "Sheet-aware generation is not available yet. Nothing was changed." - it is available now (OD-259).
 *  [PR-J5 integration, 2026-10-26] review B-5 pin move: was "Ask for the design as subsystem blocks, or start a new project. Nothing was
 *  changed." (84 characters: the 512-sheet worst case reached 246, over the bound); now 69, the worst case 231. */
export const SHEET_REPLACE_GUARD_TAIL = "Ask for subsystem blocks or start a new project. Nothing was changed." as const;
/** [PR-J5 integration, 2026-10-26] review B-2: the Theory composer's tail - a Theory result is always one page (OD-257 item 3 is kept for
 *  Theory; OD-259 item 2 revises the Build composer only), so the refusal says what does work. The worst case is 238 characters. */
export const SHEET_REPLACE_GUARD_THEORY_TAIL = "Theory mode draws one page; use Build or a new project. Nothing was changed." as const;

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
export function multiSheetReplaceRefusal(base: SheetsOf, composer: "default" | "theory" = "default"): string | null {
  const sheets = base.sheets?.sheets ?? [];
  if (base.sheets === undefined || sheets.length === 0) return null;
  const count = sheets.length;
  return `This project has ${count} schematic sheet${count === 1 ? "" : "s"} (${sheetNamesForMessage(base)}). A flat AI result would replace them. ${composer === "theory" ? SHEET_REPLACE_GUARD_THEORY_TAIL : SHEET_REPLACE_GUARD_TAIL}`; // [PR-J5 integration, 2026-10-26] review B-2: + the Theory composer's tail
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

/**
 * [PR-J5, 2026-10-23] OD-259 item 2: the Build composer's ADVISORY on a multi-sheet base (it no longer refuses there): what a generated
 * multi-sheet design replaces, and that a one-page design is refused at review. Null for a single-sheet base. Bounded like the refusal
 * ([PR-J5 integration, 2026-10-26] review B-5 pin move: was "...: a generated multi-sheet design replaces all of them after your review
 * (one undoable step); a one-page design is refused at review." - 255 characters at worst; now 233).
 */
export function multiSheetReplaceAdvisory(base: SheetsOf): string | null {
  const sheets = base.sheets?.sheets ?? [];
  if (base.sheets === undefined || sheets.length === 0) return null;
  const count = sheets.length;
  return `This project has ${count} schematic sheet${count === 1 ? "" : "s"} (${sheetNamesForMessage(base)}): a generated multi-sheet design replaces them after review (one undoable step); a one-page design is refused.`;
}

/** [PR-J5, 2026-10-23] The flat-result refusal with WHY the result stayed one page (the derivation's "Kept on one page" findings), bounded.
 *  [PR-J5 integration, 2026-10-26] review B-5: bounded in LENGTH too (it capped the count of findings only - two long findings made an
 *  889-character banner): the "Why it is one page" tail is cut with "…" so the whole message stays within
 *  SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH; the refusal itself is never cut (it ends "Nothing was changed."). */
export function flatReplacementRefusalWithFindings(refusal: string, findings: readonly string[]): string {
  const kept = findings.filter((finding) => finding.startsWith("Kept on one page:"));
  if (kept.length === 0) return refusal;
  const shown = kept.slice(0, 2).map((finding) => finding.slice("Kept on one page:".length).trim());
  const whole = `${refusal} Why it is one page: ${shown.join(" ")}${kept.length > 2 ? ` (and ${kept.length - 2} more finding${kept.length - 2 === 1 ? "" : "s"})` : ""}`;
  if (whole.length <= SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH) return whole;
  const room = SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH - refusal.length - " Why it is one page: ".length - 1;
  return room > 0 ? `${whole.slice(0, refusal.length + " Why it is one page: ".length + room).trimEnd()}…` : refusal;
}
