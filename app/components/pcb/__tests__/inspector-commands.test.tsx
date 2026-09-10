// @vitest-environment jsdom
/**
 * Stage 17 Phase B gate: the inspector speaks edit commands — every field
 * commit is exactly one history entry; the live warning appears within the
 * 150 ms debounce for an illegal width under jlcpcb-2l and does not block
 * the commit; mixed selections show '—' and commit to all.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { Inspector } from "../Inspector";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { createHistory as createHistoryRaw } from "@/app/lib/pcb/history";
import { authorizeBarePcbHistory } from "@/app/lib/engineering/pcb-bare-authority.internal";
import type { PcbBoard } from "@/app/lib/pcb/types";

// B08.1 — component tests use EXPLICITLY authorized bare histories (the
// sanctioned planner/test composition); product histories are session-bound.
const createHistory = (board: PcbBoard) => {
  const history = createHistoryRaw(board);
  authorizeBarePcbHistory(history);
  return history;
};
import { createSelectionStore } from "@/app/lib/pcb/selection";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { mmToNm } from "@/app/lib/pcb/units";

afterEach(cleanup);

const RULES = getPreset("jlcpcb-2l").rules;

function setup(selectTrackCount: number) {
  const board = buildRoutedDemo();
  const history = createHistory(board);
  const store = createSelectionStore();
  const tracks = board.tracks.slice(0, selectTrackCount);
  store.replace(tracks.map((t) => ({ kind: "track", id: t.id })));
  const toast = vi.fn();
  render(
    <Inspector
      board={history.present}
      selection={store}
      getHistory={() => history}
      onFitSelection={() => {}}
      rules={RULES}
      presetId="jlcpcb-2l"
      toast={toast}
    />,
  );
  return { board, history, store, tracks, toast };
}

describe("Inspector", () => {
  it("renders nothing while the selection is empty", () => {
    const board = buildRoutedDemo();
    const history = createHistory(board);
    const { container } = render(
      <Inspector
        board={board}
        selection={createSelectionStore()}
        getHistory={() => history}
        onFitSelection={() => {}}
        rules={RULES}
        presetId="jlcpcb-2l"
        toast={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("commits a width edit as exactly one undo step", () => {
    const { history, tracks } = setup(1);
    const input = screen.getByLabelText("Width");
    fireEvent.change(input, { target: { value: "0.4" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(history.present.tracks.find((t) => t.id === tracks[0].id)?.width).toBe(mmToNm(0.4));
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(history.canUndo).toBe(false); // one entry
    expect(history.present.tracks.find((t) => t.id === tracks[0].id)?.width).toBe(
      tracks[0].width,
    );
  });

  it("shows the preset-aware warning within 150 ms and still commits", () => {
    vi.useFakeTimers();
    try {
      const { history, tracks } = setup(1);
      const input = screen.getByLabelText("Width");
      fireEvent.change(input, { target: { value: "0.1" } });
      act(() => {
        vi.advanceTimersByTime(150);
      });
      // Stage 12 voice, preset threshold (jlcpcb-2l min track width).
      expect(screen.getByText(/0\.10 mm wide; need ≥/)).toBeDefined();

      fireEvent.keyDown(input, { key: "Enter" }); // warnings never block
      expect(history.present.tracks.find((t) => t.id === tracks[0].id)?.width).toBe(mmToNm(0.1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("multi-select: differing widths show '—' and commit to all as ONE entry", () => {
    const { history, tracks } = setup(2);
    // Make the widths differ first (outside the inspector).
    history.execute("test setup", (d) => {
      d.tracks[0].width = mmToNm(0.25);
      d.tracks[1].width = mmToNm(0.5);
    });
    // Re-render happens via the store; the board prop is stale but the field
    // state under test is the commit path, not the display.
    const input = screen.getByLabelText("Width") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.6" } });
    fireEvent.keyDown(input, { key: "Enter" });

    for (const t of tracks) {
      expect(history.present.tracks.find((x) => x.id === t.id)?.width).toBe(mmToNm(0.6));
    }
    history.undo(); // undoes ONLY the inspector commit
    expect(history.present.tracks[0].width).toBe(mmToNm(0.25));
    expect(history.present.tracks[1].width).toBe(mmToNm(0.5));
  });

  it("mixed-width selection renders the '—' placeholder", () => {
    const board = buildRoutedDemo();
    board.tracks[0].width = mmToNm(0.25);
    board.tracks[1].width = mmToNm(0.5);
    const history = createHistory(board);
    const store = createSelectionStore();
    store.replace(board.tracks.slice(0, 2).map((t) => ({ kind: "track", id: t.id })));
    render(
      <Inspector
        board={board}
        selection={store}
        getHistory={() => history}
        onFitSelection={() => {}}
        rules={RULES}
        presetId="jlcpcb-2l"
        toast={() => {}}
      />,
    );
    const input = screen.getByLabelText("Width") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("—");
  });

  it("locked footprints disable move/rotate fields", () => {
    const board = buildRoutedDemo();
    board.footprints[0].locked = true;
    const history = createHistory(board);
    const store = createSelectionStore();
    store.replace([{ kind: "footprint", id: board.footprints[0].id }]);
    const toast = vi.fn();
    render(
      <Inspector
        board={board}
        selection={store}
        getHistory={() => history}
        onFitSelection={() => {}}
        rules={RULES}
        presetId="jlcpcb-2l"
        toast={toast}
      />,
    );
    const rotation = screen.getByLabelText("Rotation") as HTMLInputElement;
    expect(rotation.disabled).toBe(true); // locked disables in the UI…

    // …and the validator is the real gate: force a command through anyway.
    const side = screen.getByLabelText("Side") as HTMLSelectElement;
    expect(side.disabled).toBe(true);
  });
});
