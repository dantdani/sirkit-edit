// @vitest-environment jsdom
/**
 * [PR-B24 multitab, 2026-10-22] The PCB editor's toast (hooks/useToastDismissal.ts): a dismissal clears only the show it was armed
 * for. PR #16's CI run 39795211563 failed multi-tab case 1 at "B says the apply failed": the stale tab's refused apply DID set
 * "Apply failed: PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH" (the trace's screencast paints it), and it was gone within 0.4 s - the
 * earlier "Sync blocked" toast's 6 s timer came due after the new toast's commit and before React's passive effects cleared it,
 * and its unconditional clear erased the answer. Case 1 reproduces that ordering exactly: a LAYOUT effect (it runs in the commit,
 * before the passive effects) lets the clock reach the earlier timer's due time. The probe composes the toast exactly as the
 * editor does (`useReducer(showToast, initial, firstToast)` + `useToastDismissal`); cases 1-3 and 5 are red on the former `useState` +
 * `[toast]`-keyed effect, case 4 holds on both; the source pins hold the editor to this composition, edited in place.
 */
import { useLayoutEffect, useReducer, type Dispatch } from "react";
import { readFileSync } from "node:fs";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_DISMISS_MS, firstToast, showToast, useToastDismissal, type ToastAction } from "../hooks/useToastDismissal";

const SYNC_BLOCKED = "Sync blocked: PS_SCHEMATIC_REVISION_MISMATCH";
const APPLY_FAILED = "Apply failed: PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH";

let setToast: Dispatch<ToastAction> = () => undefined;
const expose = (dispatch: Dispatch<ToastAction>): void => { setToast = dispatch; };
/** The editor's composition; `onCommit` runs in a layout effect of the commit that put `toast` on screen. */
function Probe({ initial = null, onCommit }: { initial?: string | null; onCommit?: (toast: string | null) => void }) {
  const [shownToast, dispatch] = useReducer(showToast, initial, firstToast);
  const toast = shownToast.text;
  useToastDismissal(shownToast, dispatch);
  expose(dispatch);
  useLayoutEffect(() => { onCommit?.(toast); }, [toast, onCommit]);
  return <div data-testid="toast">{toast ?? ""}</div>;
}
const shown = (): string => screen.getByTestId("toast").textContent ?? "";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("[PR-B24 multitab] a toast's dismissal clears only the show it was armed for", () => {
  it("1. CI 39795211563's order: the earlier toast's dismissal comes due between the newer toast's commit and the passive effects - the newer toast stays its full window", () => {
    let overdue = false;
    const lateTimer = (toast: string | null): void => {
      if (toast !== APPLY_FAILED || overdue) return;
      overdue = true;
      vi.advanceTimersByTime(20); // the commit is painted; the earlier "Sync blocked" timer is now due and fires before the cleanup
    };
    render(<Probe onCommit={lateTimer} />);
    act(() => { setToast(SYNC_BLOCKED); });
    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS - 10); });
    expect(shown()).toBe(SYNC_BLOCKED);
    act(() => { setToast(APPLY_FAILED); });
    expect(overdue).toBe(true);
    expect(shown(), "the refused apply's answer is not erased by the earlier toast's timer").toBe(APPLY_FAILED);
    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS - 100); });
    expect(shown()).toBe(APPLY_FAILED);
    act(() => { vi.advanceTimersByTime(200); });
    expect(shown()).toBe("");
  });

  it("2. the earlier dismissal and the newer show in one batch: the newer show stays", () => {
    render(<Probe />);
    act(() => { setToast(SYNC_BLOCKED); });
    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS - 10); });
    act(() => { setToast(APPLY_FAILED); vi.advanceTimersByTime(20); });
    expect(shown()).toBe(APPLY_FAILED);
    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS - 100); });
    expect(shown()).toBe(APPLY_FAILED);
  });

  it("3. the same text shown again re-arms its full window (a second identical answer is not cut short by the first one's timer)", () => {
    render(<Probe />);
    act(() => { setToast(APPLY_FAILED); });
    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS - 100); });
    act(() => { setToast(APPLY_FAILED); });
    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS - 100); });
    expect(shown()).toBe(APPLY_FAILED);
    act(() => { vi.advanceTimersByTime(200); });
    expect(shown()).toBe("");
  });

  it("4. unchanged otherwise: the initial toast and every show leave after 6 s; an explicit clear clears at once", () => {
    render(<Probe initial="Board loaded with 1 diagnostic." />);
    expect(shown()).toBe("Board loaded with 1 diagnostic.");
    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS - 1); });
    expect(shown()).toBe("Board loaded with 1 diagnostic.");
    act(() => { vi.advanceTimersByTime(1); });
    expect(shown()).toBe("");
    act(() => { setToast(SYNC_BLOCKED); });
    expect(shown()).toBe(SYNC_BLOCKED);
    act(() => { setToast(null); });
    expect(shown()).toBe("");
    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS * 2); });
    expect(shown()).toBe("");
    expect(TOAST_DISMISS_MS).toBe(6000);
  });

  it("5. the reducer: a text or null is a new show; a dismissal applies only to the show on screen", () => {
    const first = firstToast("a");
    expect(first).toEqual({ text: "a", show: 0 });
    const second = showToast(first, "a");
    expect(second).toEqual({ text: "a", show: 1 });
    expect(showToast(second, { dismiss: 0 })).toBe(second);
    expect(showToast(second, { dismiss: 1 })).toEqual({ text: null, show: 1 });
    expect(showToast(second, null)).toEqual({ text: null, show: 2 });
    const cleared = { text: null, show: 3 };
    expect(showToast(cleared, { dismiss: 3 })).toBe(cleared);
  });
});

describe("[PR-B24 multitab] the PCB editor's toast is this composition, edited in place", () => {
  const source = readFileSync("app/components/pcb/PcbEditor.tsx", "utf8");
  const lines = source.split("\n");
  it("the editor's setToast is the reducer's dispatch over numbered shows, seeded by the board's first diagnostic; the dismissal is useToastDismissal's", () => {
    expect(source).toContain('import { firstToast, showToast, useToastDismissal } from "./hooks/useToastDismissal";');
    expect(source).toContain("const [shownToast, setToast] = useReducer(showToast, init.diagnostics[0]?.summary ?? null, firstToast); const toast = shownToast.text;");
    expect(source).toContain("  useToastDismissal(shownToast, setToast);");
    expect(source).not.toMatch(/useState<string \| null>\(\(\) => init\.diagnostics/);
  });
  it("nothing else in the editor arms a toast dismissal", () => {
    expect(source).not.toMatch(/setTimeout\([^;]*setToast\(/);
    expect(source.match(/useToastDismissal\(/g)).toHaveLength(1);
  });
  it("the edits are in place: the import rides line 143, the state stays on line 471, and the dismissal and its note replace the former effect line for line, so no cited line moves", () => {
    expect(lines[142]).toMatch(/^import \{ usePcbViewSession \} from "\.\/hooks\/usePcbViewSession"; import \{ firstToast, showToast, useToastDismissal \} from "\.\/hooks\/useToastDismissal"; \/\/ \[B17-D\]; \[PR-B24 multitab, 2026-10-22\]/);
    expect(lines[470]).toMatch(/^ {2}const \[shownToast, setToast\] = useReducer\(showToast, /);
    expect(lines[753]).toBe("  // ── Toast auto-dismiss ─────────────────────────────────────────────────────");
    expect(lines[754]).toMatch(/^ {2}useToastDismissal\(shownToast, setToast\); \/\/ \[PR-B24 multitab, 2026-10-22\]/);
    expect(lines.slice(755, 759).every((line) => line.startsWith("  // "))).toBe(true);
    expect(lines[759]).toBe("");
  });
});
