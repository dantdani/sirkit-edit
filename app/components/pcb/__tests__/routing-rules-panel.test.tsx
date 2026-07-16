/** @vitest-environment jsdom */

import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { createHistory } from "@/app/lib/pcb/history";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { useNetClass } from "../hooks/useNetClass";
import { RoutingRulesPanel } from "../RoutingRulesPanel";

function Harness() {
  const [board, setBoard] = useState<PcbBoard>(() => buildRoutedDemo());
  const [history] = useState(() => createHistory(board));
  useEffect(() => history.subscribe((next) => setBoard(next)), [history]);
  const netClasses = useNetClass({ getHistory: () => history });
  return <RoutingRulesPanel board={board} netClasses={netClasses} toast={vi.fn()} />;
}

afterEach(cleanup);

describe("RoutingRulesPanel", () => {
  it("classifies rail nets through the undoable board history", async () => {
    render(<Harness />);
    expect(screen.getAllByText("Default")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Classify nets deterministically" }));
    await waitFor(() => expect(screen.getAllByText("Power")).toHaveLength(2));
    expect(screen.getAllByText("Default")).toHaveLength(1);
  });

  it("opens a spacious manual editor and applies validated width/via rules", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Edit routing rules" }));
    expect(screen.getByRole("dialog", { name: "Routing rules editor" })).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Track width (mm)" }), { target: { value: "0.55" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(screen.getByText(/0\.55 mm/)).toBeTruthy());
  });
});
