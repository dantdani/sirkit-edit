// @vitest-environment jsdom
/**
 * Stage 17 Phase B gate: field primitives under multi-value selections —
 * mixed values render '—', typing + Enter/blur commits to all, Esc reverts,
 * mixed booleans go indeterminate.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NumberField } from "../inspectors/fields/NumberField";
import { BooleanField } from "../inspectors/fields/BooleanField";
import { SelectField } from "../inspectors/fields/SelectField";

afterEach(cleanup);

describe("NumberField", () => {
  it("shows the shared value in display units", () => {
    render(
      <NumberField label="Width" unit="mm" scaleFromNm={1e-6} values={[250_000, 250_000]} onCommit={() => {}} />,
    );
    expect(screen.getByLabelText("Width")).toHaveProperty("value", "0.25");
  });

  it("renders '—' when values differ", () => {
    render(
      <NumberField label="Width" unit="mm" scaleFromNm={1e-6} values={[250_000, 500_000]} onCommit={() => {}} />,
    );
    const input = screen.getByLabelText("Width") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("—");
  });

  it("commits the typed value (converted to nm) on Enter — to all items", () => {
    const onCommit = vi.fn();
    render(
      <NumberField label="Width" unit="mm" scaleFromNm={1e-6} values={[250_000, 500_000]} onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("Width");
    fireEvent.change(input, { target: { value: "0.3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(300_000);
  });

  it("commits on blur, skips no-op commits, and reverts on Escape", () => {
    const onCommit = vi.fn();
    render(
      <NumberField label="Width" unit="mm" scaleFromNm={1e-6} values={[250_000]} onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("Width") as HTMLInputElement;

    // Escape reverts the draft without committing.
    fireEvent.change(input, { target: { value: "0.4" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("0.25");

    // Blur commits a changed value…
    fireEvent.change(input, { target: { value: "0.4" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(400_000);

    // …but committing the unchanged shared value is a no-op.
    fireEvent.change(input, { target: { value: "0.25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("shows the debounced preview warning without blocking", () => {
    vi.useFakeTimers();
    try {
      const preview = vi.fn().mockReturnValue({
        errors: [],
        violations: [
          {
            id: "v1",
            kind: "minTrackWidth",
            severity: "error",
            items: [],
            location: { x: 0, y: 0 },
            measuredNm: 100_000,
            thresholdNm: 127_000,
            summary: "Track on Top Copper is 0.10 mm wide; need ≥ 0.127 mm.",
            detail: "",
          },
        ],
      });
      const onCommit = vi.fn();
      render(
        <NumberField
          label="Width"
          unit="mm"
          scaleFromNm={1e-6}
          values={[250_000]}
          onCommit={onCommit}
          preview={preview}
        />,
      );
      const input = screen.getByLabelText("Width");
      fireEvent.change(input, { target: { value: "0.1" } });
      expect(preview).not.toHaveBeenCalled(); // debounced
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(preview).toHaveBeenCalledExactlyOnceWith(100_000);
      expect(screen.getByText(/need ≥ 0.127 mm/)).toBeDefined();

      // The warning never blocks: Enter still commits the illegal value.
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(100_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BooleanField", () => {
  it("is indeterminate on mixed values and commits true first", () => {
    const onCommit = vi.fn();
    render(<BooleanField label="Locked" values={[true, false]} onCommit={onCommit} />);
    const box = screen.getByLabelText("Locked") as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    fireEvent.click(box);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("toggles a shared value", () => {
    const onCommit = vi.fn();
    render(<BooleanField label="Locked" values={[true, true]} onCommit={onCommit} />);
    fireEvent.click(screen.getByLabelText("Locked"));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(false);
  });
});

describe("SelectField", () => {
  it("shows '—' on mixed values and commits a chosen option to all", () => {
    const onCommit = vi.fn();
    render(
      <SelectField
        label="Layer"
        values={["copperTop", "copperBottom"]}
        options={[
          { value: "copperTop", label: "Top Copper" },
          { value: "copperBottom", label: "Bottom Copper" },
        ]}
        onCommit={onCommit}
      />,
    );
    const select = screen.getByLabelText("Layer") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "copperTop" } });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("copperTop");
  });
});
