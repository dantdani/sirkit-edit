// @vitest-environment jsdom
/**
 * [PR-B] The inspector's selection identity and the live-preview hint's lifetime (assignment checkpoint B.2).
 *
 *  1. A same-kind selection with equal values (track A → track B, both 0.25 mm) must never let A's pending draft target B:
 *     the editable subtree is keyed to the selected references' identities, so B shows its own value. A board refresh that
 *     keeps the same selection keeps the subtree and the draft in it (keyed to the selection, not the board revision).
 *  2. A preview hint is RETIRED when its field's identity changes, not hidden: an A→B→A round trip (an external edit and
 *     its undo) does not revive the old warning without a new preview.
 *
 * Failing first on the pending tree (2026-10-14): case 1 showed "0.4" (A's draft) on B; case 2 showed the old warning again
 * after the round trip with the preview function called once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "../Inspector";
import { NumberField } from "../inspectors/fields/NumberField";
import { createSelectionStore, type SelectionStore } from "@/app/lib/pcb/selection";
import { createEmptyBoard, type PcbBoard, type Track } from "@/app/lib/pcb/types";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { EditPreview } from "@/app/lib/pcb/edit/preview";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const preset = getPreset("jlcpcb-2l");
const track = (id: string, width = 250_000): Track => ({ id, layer: "copperTop", width, start: { x: 0, y: 0 }, end: { x: 1_000_000, y: 0 }, netId: 0 });
const boardWith = (tracks: Track[]): PcbBoard => ({ ...createEmptyBoard(), tracks });
const inspector = (board: PcbBoard, selection: SelectionStore) => (
  <Inspector board={board} selection={selection} getHistory={() => null} onFitSelection={() => {}} rules={preset.rules} presetId="jlcpcb-2l" toast={() => {}} />
);

describe("inspector selection identity", () => {
  it("a same-kind, same-value selection switch discards the previous item's draft; a same-selection board refresh keeps it", () => {
    const selection = createSelectionStore();
    selection.replace([{ kind: "track", id: "t-a" }]);
    const view = render(inspector(boardWith([track("t-a"), track("t-b")]), selection));
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "0.4" } });
    expect(screen.getByLabelText("Width")).toHaveProperty("value", "0.4");

    act(() => selection.replace([{ kind: "track", id: "t-b" }]));
    expect(screen.getByLabelText("Width")).toHaveProperty("value", "0.25"); // B's own value, never A's draft

    act(() => selection.replace([{ kind: "track", id: "t-a" }]));
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "0.3" } });
    view.rerender(inspector(boardWith([track("t-a"), track("t-b"), track("t-c")]), selection)); // another item changed; the selection did not
    expect(screen.getByLabelText("Width")).toHaveProperty("value", "0.3");
  });
});

describe("live-preview hint lifetime", () => {
  it("an A→B→A external round trip does not revive the old warning without a new preview", () => {
    vi.useFakeTimers();
    const preview = vi.fn().mockReturnValue({ errors: ["Old preview warning"], violations: [] } satisfies EditPreview);
    const field = (values: number[]) => <NumberField label="Width" values={values} onCommit={() => {}} preview={preview} />;
    const view = render(field([250_000]));
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "400000" } });
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByText(/Old preview warning/)).toBeDefined();
    view.rerender(field([300_000]));
    expect(screen.queryByText(/Old preview warning/)).toBeNull();
    view.rerender(field([250_000]));
    expect(screen.queryByText(/Old preview warning/)).toBeNull();
    expect(preview).toHaveBeenCalledTimes(1);
  });
});
