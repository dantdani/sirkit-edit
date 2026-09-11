// @vitest-environment jsdom
/**
 * [B18-D I8] The chat entry's "Undo this change": one button, no inputs; the click passes nothing (the page knows which
 * change); disabled with its reason when the change is no longer the latest operation.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionEntryActions } from "../ExecutionEntryActions";

afterEach(cleanup);

describe("B18-D I8 — Undo this change", () => {
  it("an eligible change: one enabled button; the click passes nothing; no inputs", () => {
    const onUndo = vi.fn();
    render(<ExecutionEntryActions eligible reason={null} onUndo={onUndo} />);
    const button = screen.getByTestId("execution-undo") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Undo this change");
    fireEvent.click(button);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith();
    expect(screen.queryByTestId("execution-undo-reason")).toBeNull();
    expect(document.body.querySelectorAll("input, textarea, select, [contenteditable]").length).toBe(0);
  });

  it("a change that is no longer the latest: the button is disabled and says why", () => {
    const onUndo = vi.fn();
    render(<ExecutionEntryActions eligible={false} reason="no longer the latest operation — use the revision history" onUndo={onUndo} />);
    const button = screen.getByTestId("execution-undo") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onUndo).not.toHaveBeenCalled();
    expect(screen.getByTestId("execution-undo-reason").textContent).toBe("no longer the latest operation — use the revision history");
  });
});
