// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NumberField } from "../inspectors/fields/NumberField";
import { TextInspector } from "../inspectors/TextInspector";
import { PadstackEditor } from "../padstack/PadstackEditor";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { EditPreview } from "@/app/lib/pcb/edit/preview";
import type { Padstack } from "@/app/lib/pcb/padstack/types";
import type { SilkTextItem } from "@/app/lib/pcb/silk/types";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const rules = getPreset("jlcpcb-2l").rules;
const emptyPreview: EditPreview = { errors: [], violations: [] };
const focus = (input: HTMLElement): void => { act(() => input.focus()); expect(document.activeElement).toBe(input); };
const padstack = (id: string): Padstack => ({ id, name: `Stack ${id}`, kind: "via", outerNm: 600_000, drillNm: 300_000, tented: true, zoneConnect: "solid" });
const text = (id: string): SilkTextItem => ({ id, kind: "text", text: "Original", layer: "silkTop", position: { x: 0, y: 0 }, heightNm: 1_000_000, strokeWidthNm: 150_000, rotationDeg: 0, mirror: false, anchor: "center" });

describe("numeric draft lifecycle through focused DOM events", () => {
  it("Enter commits once even when its programmatic blur fires synchronously", () => {
    const commit = vi.fn();
    render(<NumberField label="Width" unit="mm" scaleFromNm={1e-6} values={[250_000]} onCommit={commit} />);
    const input = screen.getByLabelText("Width");
    focus(input);
    fireEvent.change(input, { target: { value: "0.4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(document.activeElement).not.toBe(input);
    expect(commit).toHaveBeenCalledExactlyOnceWith(400_000);
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("Escape's programmatic blur never commits the cancelled value or runs its preview", () => {
    vi.useFakeTimers();
    const commit = vi.fn(), preview = vi.fn().mockReturnValue(emptyPreview);
    render(<NumberField label="Width" unit="mm" scaleFromNm={1e-6} values={[250_000]} onCommit={commit} preview={preview} />);
    const input = screen.getByLabelText("Width");
    focus(input);
    fireEvent.change(input, { target: { value: "0.4" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(document.activeElement).not.toBe(input);
    expect(input).toHaveProperty("value", "0.25");
    act(() => vi.advanceTimersByTime(500));
    expect(commit).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    // Cancellation must not suppress a subsequent ordinary blur.
    focus(input);
    fireEvent.change(input, { target: { value: "0.5" } });
    act(() => input.blur());
    expect(commit).toHaveBeenCalledExactlyOnceWith(500_000);
  });

  it("an external value change clears a draft and cancels the old debounce", () => {
    vi.useFakeTimers();
    const commit = vi.fn(), preview = vi.fn().mockReturnValue(emptyPreview);
    const view = render(<NumberField label="Width" unit="mm" scaleFromNm={1e-6} values={[250_000]} onCommit={commit} preview={preview} />);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "0.4" } });
    act(() => vi.advanceTimersByTime(100));
    view.rerender(<NumberField label="Width" unit="mm" scaleFromNm={1e-6} values={[300_000]} onCommit={commit} preview={preview} />);
    expect(screen.getByLabelText("Width")).toHaveProperty("value", "0.3");
    act(() => vi.advanceTimersByTime(500));
    expect(preview).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByLabelText("Width"));
    expect(commit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "0.6" } });
    act(() => vi.advanceTimersByTime(150));
    expect(preview).toHaveBeenCalledExactlyOnceWith(600_000);
  });

  it("a unit change cancels the old preview and converts only the new draft", () => {
    vi.useFakeTimers();
    const commit = vi.fn(), preview = vi.fn().mockReturnValue(emptyPreview);
    const view = render(<NumberField label="Width" unit="mm" scaleFromNm={1e-6} values={[250_000]} onCommit={commit} preview={preview} />);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "0.4" } });
    view.rerender(<NumberField label="Width" unit="nm" scaleFromNm={1} values={[250_000]} onCommit={commit} preview={preview} />);
    expect(screen.getByLabelText("Width")).toHaveProperty("value", "250000");
    act(() => vi.advanceTimersByTime(150));
    expect(preview).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "400000" } });
    fireEvent.blur(screen.getByLabelText("Width"));
    expect(commit).toHaveBeenCalledExactlyOnceWith(400_000);
  });

  it("an external change hides an already-rendered warning immediately", () => {
    vi.useFakeTimers();
    const preview = vi.fn().mockReturnValue({ errors: ["Old preview warning"], violations: [] } satisfies EditPreview);
    const view = render(<NumberField label="Width" values={[250_000]} onCommit={() => {}} preview={preview} />);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "400000" } });
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByText(/Old preview warning/)).toBeDefined();
    view.rerender(<NumberField label="Width" values={[300_000]} onCommit={() => {}} preview={preview} />);
    expect(screen.queryByText(/Old preview warning/)).toBeNull();
  });
});

describe("silk text draft identity", () => {
  it.each(["Enter", "Escape"])("focused %s settles exactly once without stale blur mutation", (key) => {
    const commit = vi.fn();
    render(<TextInspector items={[text("a")]} commit={commit} />);
    const input = screen.getByLabelText("Text");
    focus(input);
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key });
    expect(document.activeElement).not.toBe(input);
    if (key === "Enter") expect(commit).toHaveBeenCalledExactlyOnceWith([{ op: "set-text-props", id: "a", patch: { text: "Changed" } }]);
    else expect(commit).not.toHaveBeenCalled();
  });

  it("changing to another item with identical source text discards the old draft", () => {
    const commit = vi.fn();
    const view = render(<TextInspector items={[text("a")]} commit={commit} />);
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Draft for A" } });
    view.rerender(<TextInspector items={[text("b")]} commit={commit} />);
    expect(screen.getByLabelText("Text")).toHaveProperty("value", "Original");
    fireEvent.blur(screen.getByLabelText("Text"));
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("padstack pending edits stay with their committed selection", () => {
  it("A-to-B selection flushes A to its original callback and never edits B with A's draft", () => {
    vi.useFakeTimers();
    const a = padstack("a"), b = padstack("b"), commitA = vi.fn(), commitB = vi.fn();
    const view = render(<PadstackEditor padstack={a} rules={rules} commit={commitA} />);
    fireEvent.change(screen.getByLabelText("Padstack name"), { target: { value: "Edited A" } });
    act(() => vi.advanceTimersByTime(100));
    view.rerender(<PadstackEditor padstack={b} rules={rules} commit={commitB} />);
    expect(commitA).toHaveBeenCalledExactlyOnceWith([{ op: "edit-padstack", id: "a", patch: { name: "Edited A" } }]);
    expect(commitB).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Padstack name")).toHaveProperty("value", "Stack b");
    act(() => vi.advanceTimersByTime(1000));
    expect(commitA).toHaveBeenCalledTimes(1);
    expect(commitB).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Outer diameter"), { target: { value: "0.8" } });
    act(() => vi.advanceTimersByTime(500));
    expect(commitB).toHaveBeenCalledExactlyOnceWith([{ op: "edit-padstack", id: "b", patch: { outerNm: 800_000 } }]);
    expect(a.name).toBe("Stack a");
    expect(b.outerNm).toBe(600_000);
  });

  it("unmount flushes pending edits once and cancels the debounce", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const view = render(<PadstackEditor padstack={padstack("a")} rules={rules} commit={commit} />);
    fireEvent.change(screen.getByLabelText("Padstack name"), { target: { value: "Final A" } });
    view.unmount();
    expect(commit).toHaveBeenCalledExactlyOnceWith([{ op: "edit-padstack", id: "a", patch: { name: "Final A" } }]);
    act(() => vi.advanceTimersByTime(1000));
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
