/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncButton } from "../SyncButton";

afterEach(cleanup);

describe("SyncButton", () => {
  it("keeps one-click schematic-to-PCB separate from optional placement settings", () => {
    const onSync = vi.fn();
    const onOptions = vi.fn();
    render(<SyncButton dirty={false} syncing={false} onSync={onSync} onOptions={onOptions} />);

    fireEvent.click(screen.getByRole("button", { name: "Schematic to PCB: synchronises the whole project (1 sheet)" })); // [PR-J4 integration, 2026-10-23] pin move: the control states it synchronises the whole project (OD-258 item 6; was "Schematic to PCB")
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onOptions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Schematic to PCB placement options" }));
    expect(onOptions).toHaveBeenCalledTimes(1);
  });
});
