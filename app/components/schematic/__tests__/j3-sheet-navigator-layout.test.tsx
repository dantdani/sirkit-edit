// @vitest-environment jsdom
/**
 * [PR-J3, 2026-10-22] Runbook J.3 (OD-255 item 7): the Sheets navigator never swallows a canvas click. The navigator is a right-aligned
 * flex column (notice, panel, chip row) as wide as its widest child, so with the tree open its EMPTY area beside the panel sat over the
 * schematic and took the pointer: in the fixture browser proof a +3V3 placement on the IMU sheet (e2e/j3-multi-sheet.spec.ts case 1)
 * hit the container (`elementFromPoint` -> sheets-navigator) and placed nothing. The column takes no pointer events; each visible child
 * takes its own. jsdom cannot hit-test, so this pins the structure the browser proof relies on: the column is `pointer-events-none`,
 * every rendered child of it is `pointer-events-auto`, with the panel open and closed, with and without a notice.
 *
 * Likewise every dialog scrolls inside the viewport: the Move preview for U2 (15 crossings) was taller than a 768 px viewport and its
 * Apply button sat below the fold with no scrollable ancestor (case 2 of the same proof could not click it); each DialogContent is
 * `max-h-[90vh] overflow-y-auto` (source pin: jsdom has no layout).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SchematicSheetLens } from "../hooks/useSchematicSheetLens";
import { FakePage, Harness, MemoryStorage, imuSplit, recordingGraph, settle } from "./_j3-harness";

let latest: SchematicSheetLens | null = null;
const onLens = (next: SchematicSheetLens): void => { latest = next; };
afterEach(() => { cleanup(); latest = null; });

const classesOf = (element: Element): string[] => (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

function expectTransparentColumn(): void {
  const column = screen.getByTestId("sheets-navigator");
  expect(classesOf(column)).toContain("pointer-events-none");
  expect(classesOf(column)).toContain("absolute");
  const children = [...column.children];
  expect(children.length).toBeGreaterThan(0);
  for (const child of children) expect(classesOf(child), child.getAttribute("data-testid") ?? child.getAttribute("role") ?? child.tagName).toContain("pointer-events-auto");
}

describe("[PR-J3] the Sheets navigator's column takes no pointer events; its children do", () => {
  it("chip row only; with the tree open; with a notice shown", async () => {
    const { after } = imuSplit();
    const page = new FakePage(after);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    expectTransparentColumn();
    expect(screen.getByTestId("sheets-chip-row").getAttribute("class")).toContain("pointer-events-auto");
    fireEvent.click(screen.getByTestId("sheets-chip"));
    await settle();
    expect(screen.getByTestId("sheets-panel")).toBeTruthy();
    expectTransparentColumn();
    // a notice: open a sheet that does not exist
    latest!.controller.openSheet("sheet-missing");
    await settle();
    expect(screen.getByTestId("sheets-notice").textContent).toMatch(/does not exist/);
    expectTransparentColumn();
    expect(screen.getByTestId("sheets-navigator").children).toHaveLength(3);
  });

  it("every dialog of the navigator scrolls inside 90vh (the Move preview can be taller than a 768 px viewport)", () => {
    const source = readFileSync(join(process.cwd(), "app/components/schematic/SheetNavigator.tsx"), "utf8");
    const contents = [...source.matchAll(/<DialogContent className="([^"]*)"/g)].map((match) => match[1]!);
    expect(contents.length).toBeGreaterThanOrEqual(6); // new, rename, port, delete, move, follow
    for (const classes of contents) {
      expect(classes.split(/\s+/), classes).toEqual(expect.arrayContaining(["max-h-[90vh]", "overflow-y-auto"]));
    }
  });
});
