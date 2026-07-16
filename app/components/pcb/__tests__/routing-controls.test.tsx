/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { ensureBoardPadstacks } from "@/app/lib/pcb/padstack/migrate";
import { RoutingControls } from "../RoutingControls";

describe("RoutingControls", () => {
  it("offers explicit new-route width and via choices", () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    const onChange = vi.fn();
    render(<RoutingControls board={board} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("New route copper width"), { target: { value: "750000" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      trackWidthMode: "custom",
      customTrackWidthNm: 750_000,
    }));

    fireEvent.change(screen.getByLabelText("New route via preset"), { target: { value: "via-power" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      viaMode: "padstack",
      viaPadstackId: "via-power",
    }));
  });

  it("shows the live walk-around mode and alternative selector", () => {
    render(
      <RoutingControls
        board={buildRoutedDemo()}
        onChange={vi.fn()}
        status={{
          status: "walking-around",
          mode: "walk-around",
          alternatives: 2,
          selected: 1,
          elapsedMs: 4.2,
          explanation: "Direct copper was blocked, so Smart Route walked around it.",
        }}
      />,
    );
    expect(screen.getByText("Walking around")).toBeTruthy();
    expect(screen.getByText("1/2 · Tab")).toBeTruthy();
    expect(screen.getByText(/Direct copper was blocked/)).toBeTruthy();
  });
});
