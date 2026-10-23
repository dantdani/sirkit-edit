// @vitest-environment jsdom
/**
 * [PR-J4, 2026-10-23] Runbook J.3 item 4 (OD-258 items 3, 4): the Organize into sheets preview and the rail-named label normalisation in
 * the Sheets navigator (SheetNavigator.tsx), driven through the real hook and controller against the page-mimicking host (_j3-harness.tsx);
 * every command runs the executor's own operation code, so the refusals and the transactions are the real ones.
 *
 *  1. single-sheet drone: the panel offers Organize into sheets; the preview lists the four proposed groups with their hubs, parts and
 *     ports, the "check these" entries and no residue; Apply is ONE schematic.move-to-sheet transaction ("Organized 41 parts into 4
 *     sheets") after which the document has five sheets, every identity and the pin-to-net partition kept, the lens still on the overview;
 *     no crypto.randomUUID is drawn;
 *  2. Apply re-plans on the canonical base: a base whose connections moved under the preview is refused, the document unchanged, the
 *     notice shown;
 *  3. the label-tool GND case: the preview is refused with the planner's SHEET_MOVE_NOT_EQUIVALENT naming the label, the normalisation
 *     offer lists the one label; Normalise is ONE schematic.sheet-structure transaction after which the preview re-plans and Apply works;
 *  4. every control of the panel and the two dialogs has a name worded for a person; a sheet switch closes the preview (SR-3);
 *  5. a sheet with one subsystem: the refusal (ORGANIZE_NOTHING_TO_SPLIT) is shown inline with its code and Apply stays disabled.
 * jsdom; no network; nothing on disk.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { fromCanonicalSchematic, schematicStateDigest, type CanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { droneFixtureState, fixturePartLookup } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { J4_DRONE_PROPOSAL } from "@/app/lib/schematic/__tests__/_j4-organize-fixtures";
import { organizeSheetId } from "@/app/lib/schematic/sheet-organization";
import type { SchematicState } from "@/lib/schematic-types";
import type { SchematicSheetLens } from "../hooks/useSchematicSheetLens";
import { FakePage, Harness, MemoryStorage, recordingGraph, settle } from "./_j3-harness";

let latest: SchematicSheetLens | null = null;
const lens = (): SchematicSheetLens => { if (!latest) throw new Error("no lens yet"); return latest; };
const onLens = (next: SchematicSheetLens): void => { latest = next; };
const lookup = fixturePartLookup();
const identity = (state: SchematicState) => state.kicadComponents!.map(({ x: _x, y: _y, rotation: _r, sheetId: _s, ...rest }) => { void _x; void _y; void _r; void _s; return rest; });
/** The tree popover, opened when it is not already (the chip toggles it). */
const openPanel = (): HTMLElement => { const open = screen.queryByTestId("sheets-panel"); if (open) return open; fireEvent.click(screen.getByTestId("sheets-chip")); return screen.getByTestId("sheets-panel"); };
const nameOf = (element: HTMLElement): string => {
  const explicit = element.getAttribute("aria-label");
  if (explicit) return explicit.trim();
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) return (element.closest("label")?.textContent ?? "").replace(/\s+/g, " ").trim();
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
};
const controls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("button, input, select, [role='treeitem'], [role='tree']")];

beforeEach(() => { latest = null; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("[PR-J4] Organize into sheets in the Sheets navigator", () => {
  it("1. the preview lists the proposal; Apply is ONE move-to-sheet transaction; identities and the partition kept; no randomUUID", async () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID");
    const drone = droneFixtureState();
    const page = new FakePage(drone);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    const panel = openPanel();
    fireEvent.click(within(panel).getByTestId("sheets-organize"));
    const preview = screen.getByTestId("sheets-organize-preview");
    expect(preview.getAttribute("data-source")).toBe("root");
    const rows = screen.getAllByTestId("sheets-organize-group");
    expect(rows.map((row) => row.getAttribute("data-name"))).toEqual(J4_DRONE_PROPOSAL.map((group) => group.name));
    expect(rows.map((row) => row.getAttribute("data-refs"))).toEqual(J4_DRONE_PROPOSAL.map((group) => group.refs.join(" ")));
    expect(screen.getAllByTestId("sheets-organize-ports").map((cell) => cell.textContent)).toEqual(J4_DRONE_PROPOSAL.map((group) => (group.ports.length ? group.ports.join(", ") : "none")));
    expect(screen.getAllByTestId("sheets-organize-check-item").length).toBe(17);
    expect(screen.queryByTestId("sheets-organize-residue")).toBeNull();
    expect(screen.queryByTestId("sheets-organize-refusal")).toBeNull();
    expect(screen.queryByTestId("sheets-normalise")).toBeNull(); // nothing to normalise on the fixture drone
    const apply = screen.getByTestId("sheets-organize-apply");
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    expect(page.commands).toHaveLength(0); // never auto-applied
    await act(async () => { fireEvent.click(apply); });
    await settle();
    expect(page.commands.map((command) => [command.commandId, command.label])).toEqual([["schematic.move-to-sheet", "Organized 41 parts into 4 sheets"]]);
    expect(page.commands[0]!.options?.expectedBaseDigest).toBe(schematicStateDigest(drone));
    expect(page.failures).toEqual([]);
    const after = page.current();
    expect(after.sheets!.sheets.map((sheet) => sheet.id)).toEqual(["root", ...J4_DRONE_PROPOSAL.map((group) => organizeSheetId([...group.refs]))]);
    expect(identity(after)).toEqual(identity(drone));
    expect(resolveProjectConnectivity(after, lookup).partitionDigest).toBe(resolveProjectConnectivity(drone, lookup).partitionDigest);
    expect(screen.queryByTestId("sheets-organize-preview")).toBeNull();
    expect(lens().activeSheetId).toBe("root");
    expect(screen.getByTestId("sheets-chip").textContent).toContain("5 sheets");
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it("2. Apply re-plans on the canonical base: a base whose connections moved is refused, the document unchanged, the notice shown", async () => {
    const drone = droneFixtureState();
    const page = new FakePage(drone);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    fireEvent.click(within(openPanel()).getByTestId("sheets-organize"));
    expect((screen.getByTestId("sheets-organize-apply") as HTMLButtonElement).disabled).toBe(false);
    // the base moves under the preview: a GND label is deleted on the canonical base (its pin leaves the net: another partition)
    page.baseForBuild = (canonical: CanonicalSchematic) => {
      const state = fromCanonicalSchematic(canonical);
      const gone = state.netLabels!.find((label) => label.kind === "ground")!;
      return applySchematicOperationsToCanonical(canonical, [{ schemaVersion: 1, units: "px", operationId: "t:moved", kind: "schematic_delete_net_label", labelId: gone.id }]).schematic;
    };
    const before = schematicStateDigest(page.current());
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-organize-apply")); });
    await settle();
    expect(page.commands.map((command) => command.commandId)).toEqual(["schematic.move-to-sheet"]);
    expect(page.failures).toHaveLength(1);
    expect(page.failures[0]).toContain("The design changed since this organisation was previewed");
    expect(schematicStateDigest(page.current())).toBe(before);
    expect(page.current().sheets).toBeUndefined();
    expect(screen.getByTestId("sheets-notice").textContent).toContain("The design changed since this organisation was previewed");
  });

  it("3. the label-tool GND case: the refusal names the label, Normalise is ONE sheet-structure transaction, then Apply organises", async () => {
    const drone = droneFixtureState();
    const plain = drone.netLabels!.find((label) => label.kind === "ground")!;
    plain.kind = "label";
    const page = new FakePage(drone);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    fireEvent.click(within(openPanel()).getByTestId("sheets-organize"));
    const refusal = screen.getByTestId("sheets-organize-refusal");
    expect(refusal.getAttribute("data-code")).toBe("SHEET_MOVE_NOT_EQUIVALENT");
    expect(refusal.textContent).toContain(`"GND" at (${plain.position.x}, ${plain.position.y})`);
    expect((screen.getByTestId("sheets-organize-apply") as HTMLButtonElement).disabled).toBe(true);
    const offer = screen.getByTestId("sheets-normalise");
    expect(offer.getAttribute("data-count")).toBe("1");
    expect(screen.getByTestId("sheets-normalise-rule-change").textContent).toContain("2 different nets are all named GND");
    expect(screen.getAllByTestId("sheets-normalise-label").map((item) => item.textContent)).toEqual([`"GND" at (${plain.position.x}, ${plain.position.y}): label → ground`]);
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-normalise-apply")); });
    await settle();
    expect(page.commands.map((command) => [command.commandId, command.label])).toEqual([["schematic.sheet-structure", "Normalised 1 rail-named label"]]);
    expect(page.failures).toEqual([]);
    expect(page.current().netLabels!.find((label) => label.id === plain.id)!.kind).toBe("ground");
    expect(schematicStateDigest(page.current())).toBe("eng1-66f025a6dde8f8c3"); // the fixture drone (its label was minted ground)
    // the preview stays open and re-plans on the normalised document: the proposal is accepted
    expect(screen.queryByTestId("sheets-organize-refusal")).toBeNull();
    expect(screen.queryByTestId("sheets-normalise")).toBeNull();
    expect(screen.getAllByTestId("sheets-organize-group")).toHaveLength(4);
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-organize-apply")); });
    await settle();
    expect(page.commands.map((command) => command.commandId)).toEqual(["schematic.sheet-structure", "schematic.move-to-sheet"]);
    expect(page.current().sheets!.sheets).toHaveLength(5);
  });

  it("4. every control has a name worded for a person; a sheet switch closes the preview", async () => {
    const page = new FakePage(droneFixtureState());
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    fireEvent.click(within(openPanel()).getByTestId("sheets-organize"));
    expect(screen.getByTestId("sheets-organize-preview")).toBeTruthy();
    for (const control of controls()) expect(nameOf(control), control.outerHTML.slice(0, 120)).not.toBe("");
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-organize-apply")); });
    await settle();
    const organized = page.current().sheets!.sheets[1]!.id;
    fireEvent.click(within(openPanel()).getAllByTestId("sheets-organize")[0]!);
    expect(screen.getByTestId("sheets-organize-preview")).toBeTruthy();
    for (const control of controls()) expect(nameOf(control), control.outerHTML.slice(0, 120)).not.toBe("");
    act(() => { lens().controller.openSheet(organized); });
    await settle();
    expect(lens().activeSheetId).toBe(organized);
    expect(screen.queryByTestId("sheets-organize-preview")).toBeNull(); // SR-3: the preview belonged to the previous activation
  });

  it("5. a sheet with one subsystem: ORGANIZE_NOTHING_TO_SPLIT inline with its code; Apply disabled; nothing sent", async () => {
    const drone = droneFixtureState();
    const page = new FakePage(drone);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    fireEvent.click(within(openPanel()).getByTestId("sheets-organize"));
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-organize-apply")); });
    await settle();
    const imu = page.current().sheets!.sheets.find((sheet) => sheet.name.startsWith("LSM6DS3TR-C"))!;
    act(() => { lens().controller.openSheet(imu.id); });
    await settle();
    const panel = openPanel();
    fireEvent.click(within(panel).getByTestId(`sheets-tree-item-${imu.id}`));
    await settle();
    fireEvent.click(within(screen.getByTestId("sheets-panel")).getByTestId("sheets-organize"));
    const refusal = screen.getByTestId("sheets-organize-refusal");
    expect(refusal.getAttribute("data-code")).toBe("ORGANIZE_NOTHING_TO_SPLIT");
    expect(refusal.textContent).toContain("one subsystem around U3");
    expect((screen.getByTestId("sheets-organize-apply") as HTMLButtonElement).disabled).toBe(true);
    expect(page.commands).toHaveLength(1); // the organisation of case 1 only
  });
});
