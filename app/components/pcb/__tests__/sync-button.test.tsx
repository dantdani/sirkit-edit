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

    fireEvent.click(screen.getByRole("button", { name: "Schematic to PCB" }));
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onOptions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Schematic to PCB placement options" }));
    expect(onOptions).toHaveBeenCalledTimes(1);
  });
});
