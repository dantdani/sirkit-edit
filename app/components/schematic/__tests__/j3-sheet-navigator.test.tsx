// @vitest-environment jsdom
/**
 * [PR-J3, 2026-10-22] Runbook J.3 items 1, 3, 6, 7 (OD-255 item 7; OD-257 items 1, 2, 6): the Sheets navigator (SheetNavigator.tsx)
 * driven through the real hook and controller against the page-mimicking host (_j3-harness.tsx); every command runs the executor's
 * own operation code, so the refusals and the transactions are the real ones.
 *
 *  1. single-sheet: the chip reads "1 sheet", the panel offers New sheet (and Move to sheet) only; creating the first sheet is one
 *     sheet-structure transaction, the chip becomes the tree, and no id came from crypto.randomUUID;
 *  2. multi-sheet: the tree lists Overview + children in array order; arrow keys move the focus, Enter opens, Escape closes and returns
 *     the focus to the chip; a subsystem block's double-click opens its sheet; Back opens the parent;
 *  3. every control has a name worded for a person (text, aria-label or a wrapping label), the panel and every dialog included;
 *  4. Delete on a populated sheet: the impact text (what it holds, the two-step path), Move contents to parent (one move-to-sheet
 *     transaction, the partition kept), then Delete sheet (one sheet-structure transaction): two undo steps, back to one sheet, the
 *     lens on the overview;
 *  5. Move to sheet: the preview lists the IMU crossings I2C_SCL / I2C_SDA / IMU_INT1 to a new sheet "IMU" (no renamed net), Apply is
 *     ONE move-to-sheet transaction, the overview shows the block with its three ports, the lens stays on the overview;
 *  6. Move is disabled with the planner's own message while a part's pins are unresolved;
 *  7. Apply re-plans on the canonical base: a base that moved under the preview is refused, the document unchanged, the notice shown;
 *  8. Follow signal: the overview's I2C_SCL sheet pin lists "IMU › I2C_SCL"; choosing it opens the IMU sheet and replays the highlight
 *     and the focus on the view bus;
 *  9. Rename, Add port and Up / Down through their controls; a refused rename (a sibling's name) surfaces in the notice and changes
 *     nothing;
 * 10. [PR-J3 integration, 2026-10-23] J3N-6: the move plan is pure (two previews of one input are identical, operation ids included; the
 *     applied transaction stamps its own ids) and is not recomputed by a re-render with the same inputs, only by a changed one.
 * [PR-J3 integration, 2026-10-23] Test 2 also pins J3N-5 (the overview block opens on Enter / Space; the chip's aria-controls names the
 * panel only while it is in the DOM) and test 6 pins J3N-3 (the planner's SHEET_MOVE_* code shown inline and as data-code).
 * jsdom; no network; nothing on disk.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import type { PartPinsSource } from "@/app/lib/schematic/sheet-lens";
import * as sheetOperations from "@/app/lib/schematic/sheet-operations";
import { createSheetOperation } from "@/app/lib/schematic/sheet-operations";
import { MOVE_PREVIEW_PREFIX } from "../hooks/sheet-navigation-controller";
import { droneFixtureState } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { ROOT_SHEET_ID, type SchematicState } from "@/lib/schematic-types";
import type { SchematicSheetLens } from "../hooks/useSchematicSheetLens";
import { FakePage, Harness, MemoryStorage, fakeSurface, getPart, imuSplit, lookup, recordingGraph, settle } from "./_j3-harness";

let latest: SchematicSheetLens | null = null;
const lens = (): SchematicSheetLens => { if (!latest) throw new Error("no lens yet"); return latest; };
const onLens = (next: SchematicSheetLens): void => { latest = next; };
const summary = () => screen.getByTestId("lens");
const apply = (state: SchematicState, operations: EngineeringOperation[]): SchematicState => fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(state), operations).schematic);

/** The IMU split plus an empty sibling sheet "Power". */
function splitWithPower(): { state: SchematicState; u3Id: string } {
  const { after, u3Id } = imuSplit();
  return { state: apply(after, [createSheetOperation(after, { operationId: "t:power", sheet: { id: "sheet-power", name: "Power", parentId: ROOT_SHEET_ID, block: { x: 3200, y: 900, width: 300, height: 200 } } })]), u3Id };
}

const openPanel = (): HTMLElement => { fireEvent.click(screen.getByTestId("sheets-chip")); return screen.getByTestId("sheets-panel"); };
const treeItems = (): HTMLElement[] => screen.getAllByRole("treeitem");
const nameOf = (element: HTMLElement): string => {
  const explicit = element.getAttribute("aria-label");
  if (explicit) return explicit.trim();
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
    const wrapping = element.closest("label");
    return (wrapping?.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
};
/** Every handler-bearing control in the document right now (the panel, the open dialog's portal). */
const controls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("button, input, select, [role='treeitem'], [role='tree']")];

beforeEach(() => { latest = null; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("[PR-J3] the Sheets navigator", () => {
  it("1. single-sheet: the chip reads 1 sheet; New sheet is one transaction; the tree appears; no crypto.randomUUID draw", async () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID");
    const page = new FakePage(droneFixtureState());
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    expect(screen.getByTestId("sheets-chip").textContent).toContain("1 sheet");
    expect(screen.queryByTestId("sheets-back")).toBeNull();
    const panel = openPanel();
    expect(within(panel).queryByTestId("sheets-tree")).toBeNull();
    expect(within(panel).queryByTestId("sheets-rename")).toBeNull();
    expect(within(panel).queryByTestId("sheets-delete")).toBeNull();
    expect(within(panel).getAllByRole("button").map(nameOf)).toEqual(["New sheet"]);
    expect(within(screen.getByTestId("sheets-chip-row")).getAllByRole("button").map(nameOf)).toEqual(["1 sheet", "Move to sheet…"]); // Move is reachable without the tree, even on one sheet
    expect(screen.queryByTestId("sheets-breadcrumb")).toBeNull();
    fireEvent.click(within(panel).getByTestId("sheets-new"));
    const input = await screen.findByTestId("sheets-new-name");
    expect((screen.getByRole("button", { name: "Create sheet" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "  Power " } });
    await act(async () => { fireEvent.submit(input.closest("form")!); });
    await settle();
    expect(page.commands.map((command) => command.commandId)).toEqual(["schematic.sheet-structure"]);
    expect(page.commands[0]!.label).toBe("Created sheet Power");
    const sheets = page.current().sheets!.sheets;
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Overview", "Power"]);
    expect(sheets[1]!.id).toMatch(/^sheet-[0-9a-f-]{36}$/);
    expect(sheets[1]!.block).toBeDefined();
    expect(randomUUID).not.toHaveBeenCalled();
    expect(screen.getByTestId("sheets-chip").textContent).toContain("2 sheets");
    expect(screen.getByTestId("sheets-tree")).toBeTruthy();
    expect(treeItems().map((item) => item.dataset.sheetName)).toEqual(["Overview", "Power"]);
    expect(summary().dataset.active).toBe(ROOT_SHEET_ID); // creating a sheet does not leave the overview
    expect(screen.queryByTestId("sheets-new-name")).toBeNull(); // the dialog closed on success
    // a second sheet of the same name is refused before anything is submitted
    fireEvent.click(screen.getByTestId("sheets-new"));
    const again = await screen.findByTestId("sheets-new-name");
    fireEvent.change(again, { target: { value: "power" } });
    await act(async () => { fireEvent.submit(again.closest("form")!); });
    await settle();
    expect(page.commands).toHaveLength(1);
    expect(screen.getByTestId("sheets-notice").textContent).toMatch(/already exists here/);
  });

  it("2. multi-sheet: tree order, arrow keys, Enter, Escape back to the chip, the block's double-click, Back", async () => {
    const { state } = splitWithPower();
    const page = new FakePage(state);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    expect(screen.getByTestId("sheets-chip").textContent).toContain("3 sheets");
    expect(screen.getByTestId("sheets-breadcrumb").textContent).toBe("Overview"); // visible with the tree closed
    expect(screen.getByTestId("sheet-block-sheet-imu")).toBeTruthy();
    expect(screen.getByTestId("sheet-block-sheet-power")).toBeTruthy();
    expect(screen.getByTestId("sheet-block-sheet-imu").dataset.portCount).toBe("3");
    expect(screen.getByTestId("sheets-chip").getAttribute("aria-controls")).toBeNull(); // [PR-J3 integration, 2026-10-23] J3N-5: no dangling reference while the panel is not in the DOM
    openPanel();
    expect(screen.getByTestId("sheets-chip").getAttribute("aria-controls")).toBe("sheets-panel");
    expect(document.getElementById("sheets-panel")).toBe(screen.getByTestId("sheets-panel"));
    expect(screen.getByTestId("sheets-breadcrumb").textContent).toBe("Overview");
    expect(treeItems().map((item) => item.dataset.sheetName)).toEqual(["Overview", "IMU", "Power"]);
    expect(treeItems().map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "2"]);
    expect(treeItems()[0]!.tabIndex).toBe(0);
    const tree = screen.getByTestId("sheets-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(treeItems()[1]!.tabIndex).toBe(0);
    expect(document.activeElement).toBe(treeItems()[1]);
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // clamps at the end
    expect(document.activeElement).toBe(treeItems()[2]);
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    fireEvent.keyDown(tree, { key: "Enter" });
    await settle();
    expect(summary().dataset.active).toBe("sheet-imu");
    expect(summary().dataset.kicad).toBe("U3");
    expect(screen.getByTestId("sheets-breadcrumb").textContent).toBe("Overview › IMU");
    expect(screen.getByTestId("sheets-chip").textContent).toContain("3 sheets");
    expect(screen.queryByTestId("sheet-block-sheet-imu")).toBeNull(); // the IMU sheet has no child blocks
    fireEvent.keyDown(screen.getByTestId("sheets-tree"), { key: "Escape" });
    expect(screen.queryByTestId("sheets-panel")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("sheets-chip"));
    expect(screen.getByTestId("sheets-breadcrumb").textContent).toBe("Overview › IMU"); // the breadcrumb outlives the panel
    openPanel();
    fireEvent.keyDown(screen.getByTestId("sheets-rename"), { key: "Escape" }); // Escape from any control inside the panel
    expect(screen.queryByTestId("sheets-panel")).toBeNull();
    // Back opens the parent; a block's double-click opens the child
    fireEvent.click(screen.getByTestId("sheets-back"));
    await settle();
    expect(summary().dataset.active).toBe(ROOT_SHEET_ID);
    fireEvent.doubleClick(screen.getByTestId("sheet-block-sheet-power"));
    await settle();
    expect(summary().dataset.active).toBe("sheet-power");
    expect(summary().dataset.kicad).toBe("");
    expect(lens().activation).toBe(4);
    // [PR-J3 integration, 2026-10-23] J3N-5: the block is announced as a button, so it is focusable and opens on Enter / Space too; a single
    // click still does nothing (a click on the overview never changes the sheet by accident)
    fireEvent.click(screen.getByTestId("sheets-back"));
    await settle();
    const block = screen.getByTestId("sheet-block-sheet-imu");
    expect(block.getAttribute("role")).toBe("button");
    expect(block.getAttribute("tabindex")).toBe("0");
    expect(block.getAttribute("aria-label")).toBe("Open sheet IMU");
    fireEvent.click(block);
    await settle();
    expect(summary().dataset.active).toBe(ROOT_SHEET_ID);
    fireEvent.keyDown(block, { key: "Tab" });
    await settle();
    expect(summary().dataset.active).toBe(ROOT_SHEET_ID);
    fireEvent.keyDown(block, { key: "Enter" });
    await settle();
    expect(summary().dataset.active).toBe("sheet-imu");
    fireEvent.click(screen.getByTestId("sheets-back"));
    await settle();
    fireEvent.keyDown(screen.getByTestId("sheet-block-sheet-power"), { key: " " });
    await settle();
    expect(summary().dataset.active).toBe("sheet-power");
    expect(lens().activation).toBe(8);
    expect(page.commands).toEqual([]); // navigation never touches the document
  });

  it("3. every control has a name worded for a person, in the panel and in every dialog", async () => {
    const { state, u3Id } = splitWithPower();
    const page = new FakePage(state);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} selectedKicadId={u3Id} onLens={onLens} />);
    await settle();
    const unnamed = (): string[] => controls().filter((element) => nameOf(element).length === 0).map((element) => element.outerHTML.slice(0, 120));
    expect(unnamed()).toEqual([]);
    openPanel();
    expect(unnamed()).toEqual([]);
    fireEvent.click(treeItems()[1]!); // the IMU sheet: every action enabled
    await settle();
    for (const [testId, probe] of [["sheets-new", "sheets-new-name"], ["sheets-rename", "sheets-rename-name"], ["sheets-add-port", "sheets-port-name"], ["sheets-delete", "sheets-delete-preview"], ["sheets-move", "sheets-move-preview"], ["sheets-follow", "sheets-follow-panel"]] as const) {
      fireEvent.click(screen.getByTestId(testId));
      await screen.findByTestId(probe);
      expect(unnamed(), testId).toEqual([]);
      fireEvent.click(within(screen.getByTestId(probe).closest("[data-slot='dialog-content']") as HTMLElement).getAllByRole("button").find((button) => (button.textContent ?? "").trim() === (testId === "sheets-follow" ? "Close" : "Cancel"))!);
      await settle();
      expect(screen.queryByTestId(probe)).toBeNull();
    }
  });

  it("4. Delete on a populated sheet: the impact, Move contents to parent, then Delete sheet - two transactions, back to one sheet", async () => {
    const { after } = imuSplit();
    const page = new FakePage(after);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    openPanel();
    fireEvent.click(treeItems()[1]!);
    await settle();
    expect(summary().dataset.active).toBe("sheet-imu");
    fireEvent.click(screen.getByTestId("sheets-delete"));
    const preview = await screen.findByTestId("sheets-delete-preview");
    expect(preview.textContent).toMatch(/Sheet "IMU" still holds 1 component\(s\).*move its contents to the parent sheet first \(one transaction\), then delete the empty sheet \(a second\)\. Nothing was deleted\./);
    expect(preview.textContent).toMatch(/Move contents to the parent: 1 component\(s\)/);
    const confirm = screen.getByTestId("sheets-delete-confirm");
    const moveContents = screen.getByTestId("sheets-delete-move-contents");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect((moveContents as HTMLButtonElement).disabled).toBe(false);
    const partitionBefore = resolveProjectConnectivity(after, lookup).partitionDigest;
    await act(async () => { fireEvent.click(moveContents); });
    await settle();
    expect(page.commands.map((command) => command.commandId)).toEqual(["schematic.move-to-sheet"]);
    expect(page.commands[0]!.options?.expectedBaseDigest).toBe(schematicStateDigest(after));
    expect(page.current().kicadComponents!.find((item) => item.refDes === "U3")!.sheetId).toBeUndefined();
    expect(resolveProjectConnectivity(page.current(), lookup).partitionDigest).toBe(partitionBefore);
    // the dialog is still open, recomputed: only the structure remains, so Delete sheet is enabled
    expect(screen.getByTestId("sheets-delete-preview").textContent).toMatch(/removes its 3 port\(s\) with 6 sheet pin\(s\) and hierarchical label\(s\), then the sheet - one transaction, one undo step/);
    expect(screen.queryByTestId("sheets-delete-move-contents")).toBeNull();
    expect((screen.getByTestId("sheets-delete-confirm") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-delete-confirm")); });
    await settle();
    expect(page.commands.map((command) => command.commandId)).toEqual(["schematic.move-to-sheet", "schematic.sheet-structure"]);
    expect(page.commands[1]!.label).toBe("Deleted sheet IMU");
    expect(page.current().sheets).toBeUndefined();
    expect(schematicStateDigest(page.current())).toBe(schematicStateDigest(droneFixtureState()));
    expect(summary().dataset.active).toBe(ROOT_SHEET_ID);
    expect(lens().legacy).toBe(true);
    expect(screen.getByTestId("sheets-chip").textContent).toContain("1 sheet");
    expect(screen.queryByTestId("sheets-delete-preview")).toBeNull();
  });

  it("5. Move to sheet: the IMU crossings in the preview, ONE move-to-sheet transaction, the block with its ports on the overview", async () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID");
    const drone = droneFixtureState();
    const u3 = drone.kicadComponents!.find((item) => item.refDes === "U3")!;
    const page = new FakePage(drone);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} selectedKicadId={u3.id} onLens={onLens} />);
    await settle();
    openPanel();
    fireEvent.click(screen.getByTestId("sheets-move"));
    const dialog = await screen.findByTestId("sheets-move-preview");
    expect(dialog.textContent).toContain("Moving U3 from the overview");
    expect((screen.getByTestId("sheets-move-target") as HTMLSelectElement).value).toBe("new");
    fireEvent.change(screen.getByTestId("sheets-move-new-name"), { target: { value: "IMU" } });
    const rows = screen.getAllByTestId("sheets-move-crossing");
    expect(rows.map((row) => row.dataset.net).sort()).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1"]);
    expect(rows.every((row) => row.textContent!.includes("on the overview"))).toBe(true);
    expect(screen.getByTestId("sheets-move-plan").textContent).toMatch(/Moves 1 component\(s\), \d+ wire\(s\), \d+ label\(s\) to IMU\./);
    expect(screen.queryByTestId("sheets-move-renamed")).toBeNull();
    expect(screen.queryByTestId("sheets-move-refusal")).toBeNull();
    const applyButton = screen.getByTestId("sheets-move-apply");
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(applyButton); });
    await settle();
    expect(page.commands.map((command) => command.commandId)).toEqual(["schematic.move-to-sheet"]);
    expect(page.commands[0]!.label).toMatch(/^Moved \d+ items to IMU$/);
    expect(page.commands[0]!.options?.expectedBaseDigest).toBe(schematicStateDigest(drone));
    const next = page.current();
    expect(next.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", "IMU"]);
    const imu = next.sheets!.sheets[1]!;
    expect(imu.id).toMatch(/^sheet-[0-9a-f-]{36}$/);
    expect(imu.ports!.map((port) => port.name).sort()).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1"]);
    expect(next.kicadComponents!.find((item) => item.refDes === "U3")!.sheetId).toBe(imu.id);
    expect(next.kicadComponents).toHaveLength(41);
    expect(randomUUID).not.toHaveBeenCalled();
    expect(summary().dataset.active).toBe(ROOT_SHEET_ID); // the move leaves the overview open
    expect(screen.getByTestId(`sheet-block-${imu.id}`).dataset.portCount).toBe("3");
    expect(screen.queryByTestId("sheets-move-preview")).toBeNull();
    // the connected-group mode and an existing target are offered on the next move
    fireEvent.click(screen.getByTestId("sheets-move"));
    await screen.findByTestId("sheets-move-preview");
    const target = screen.getByTestId("sheets-move-target") as HTMLSelectElement;
    expect([...target.options].map((option) => option.value)).toEqual(["new", imu.id]);
    fireEvent.click(screen.getByLabelText(/its connected group on this sheet/));
    expect(screen.getByTestId("sheets-move-refusal").textContent).toMatch(/^The selected part is on sheet "IMU", not on the open sheet; open that sheet to move it\. Nothing was changed\./); // U3 is on the IMU sheet now: never moved blind from another sheet
    expect(screen.getByTestId("sheets-move-refusal").dataset.code).toBe(""); // [PR-J3 integration, 2026-10-23] J3N-3: a refusal of the controller's own (no planner code) shows the message alone
    expect((screen.getByTestId("sheets-move-apply") as HTMLButtonElement).disabled).toBe(true);
  });

  it("6. Move is disabled with the planner's own message while a part's pins are unresolved", async () => {
    const drone = droneFixtureState();
    const u3 = drone.kicadComponents!.find((item) => item.refDes === "U3")!;
    const partial: PartPinsSource = (partId) => (partId === u3.partId ? null : getPart(partId));
    render(<Harness page={new FakePage(drone)} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} selectedKicadId={u3.id} getPart={partial} onLens={onLens} />);
    await settle();
    openPanel();
    fireEvent.click(screen.getByTestId("sheets-move"));
    await screen.findByTestId("sheets-move-preview");
    fireEvent.change(screen.getByTestId("sheets-move-new-name"), { target: { value: "IMU" } });
    expect(screen.getByTestId("sheets-move-refusal").textContent).toMatch(/pins of part .* are not loaded, so the move cannot be proven to keep every connection\. Wait until all parts are loaded, then try again\. Nothing was changed\./);
    expect((screen.getByTestId("sheets-move-apply") as HTMLButtonElement).disabled).toBe(true);
    // [PR-J3 integration, 2026-10-23] J3N-3: the planner's code is shown inline and carried as data-code (two refusals with similar prose stay distinguishable)
    expect(screen.getByTestId("sheets-move-refusal").dataset.code).toBe("SHEET_MOVE_CONNECTIVITY_INVALID");
    expect(screen.getByTestId("sheets-move-refusal").textContent!.startsWith("SHEET_MOVE_CONNECTIVITY_INVALID — The pins of part")).toBe(true);
  });

  it("7. Apply re-plans on the canonical base: a base that moved under the preview is refused, nothing changes, the notice says so", async () => {
    const drone = droneFixtureState();
    const u3 = drone.kicadComponents!.find((item) => item.refDes === "U3")!;
    const page = new FakePage(drone);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} selectedKicadId={u3.id} onLens={onLens} />);
    await settle();
    openPanel();
    fireEvent.click(screen.getByTestId("sheets-move"));
    await screen.findByTestId("sheets-move-preview");
    fireEvent.change(screen.getByTestId("sheets-move-new-name"), { target: { value: "IMU" } });
    // the head moved under the preview: U3 is gone from the canonical base the queue hands to buildOperations
    page.baseForBuild = (canonical) => ({ ...canonical, kicadComponents: canonical.kicadComponents.filter((item) => item.id !== u3.id) });
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-move-apply")); });
    await settle();
    expect(page.commands.map((command) => command.commandId)).toEqual(["schematic.move-to-sheet"]);
    expect(page.failures).toHaveLength(1);
    expect(schematicStateDigest(page.current())).toBe(schematicStateDigest(drone));
    expect(page.current().sheets).toBeUndefined();
    expect(screen.getByTestId("sheets-notice").textContent).toMatch(/does not exist|changed since this move was previewed/);
    expect(screen.getByTestId("sheets-move-preview")).toBeTruthy(); // the dialog stays for a second look
  });

  it("8. Follow signal: the overview's I2C_SCL lists IMU › I2C_SCL; choosing it opens the IMU sheet and replays highlight + focus", async () => {
    const { after } = imuSplit();
    const surface = fakeSurface();
    render(<Harness page={new FakePage(after)} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} bridge={surface.bridge} onLens={onLens} />);
    await settle();
    openPanel();
    fireEvent.click(screen.getByTestId("sheets-follow"));
    const panel = await screen.findByTestId("sheets-follow-panel");
    const headings = [...panel.querySelectorAll<HTMLElement>("[data-testid^='sheets-follow-signal-']")];
    expect(headings.map((heading) => heading.textContent!.split("·")[0]!.trim())).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1"]); // every signal, alphabetical, destinations listed at once
    expect(headings.every((heading) => heading.textContent!.includes("sheet pin"))).toBe(true);
    const destinations = [...panel.querySelectorAll<HTMLElement>("[data-testid^='sheets-follow-destination-']")];
    expect(destinations.length).toBeGreaterThanOrEqual(3);
    expect(destinations.every((item) => item.dataset.sheet === "sheet-imu")).toBe(true);
    const destination = screen.getByTestId("sheets-follow-destination-0"); // I2C_SCL's port anchor on IMU comes first
    expect(destination.textContent!.replace(/\s+/g, "")).toBe("IMU›I2C_SCL(port)");
    await act(async () => { fireEvent.click(destination); });
    await settle();
    expect(summary().dataset.active).toBe("sheet-imu");
    expect(screen.queryByTestId("sheets-follow-panel")).toBeNull();
    expect(screen.getByTestId("sheets-breadcrumb").textContent).toBe("Overview › IMU");
    expect(surface.dispatched.map((envelope) => envelope.commandId)).toEqual(["schematic.clear-selection", "schematic.highlight-net", "schematic.focus"]);
    expect(surface.dispatched[1]!.payload).toEqual({ name: "I2C_SCL" });
    const anchor = after.netLabels!.find((label) => label.scope === "hierarchical" && label.name === "I2C_SCL")!;
    expect(surface.dispatched[2]!.payload).toEqual({ target: { kind: "point", x: anchor.position.x, y: anchor.position.y } });
  });

  it("9. Rename, Add port and Up / Down through their controls; a refused rename surfaces in the notice and changes nothing", async () => {
    const { state } = splitWithPower();
    const page = new FakePage(state);
    render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    openPanel();
    fireEvent.click(treeItems()[1]!); // IMU
    await settle();
    fireEvent.click(screen.getByTestId("sheets-rename"));
    const rename = await screen.findByTestId("sheets-rename-name");
    expect((rename as HTMLInputElement).value).toBe("IMU");
    fireEvent.change(rename, { target: { value: "Power" } });
    await act(async () => { fireEvent.submit(rename.closest("form")!); });
    await settle();
    expect(page.commands).toEqual([]);
    expect(screen.getByTestId("sheets-notice").textContent).toMatch(/A sheet named "Power" already exists here/);
    fireEvent.change(rename, { target: { value: "Inertial" } });
    await act(async () => { fireEvent.submit(rename.closest("form")!); });
    await settle();
    expect(page.commands.map((command) => command.label)).toEqual(["Renamed sheet IMU to Inertial"]);
    expect(page.current().sheets!.sheets[1]!.name).toBe("Inertial");
    expect(screen.getByTestId("sheets-breadcrumb").textContent).toBe("Overview › Inertial");
    fireEvent.click(screen.getByTestId("sheets-add-port"));
    const portName = await screen.findByTestId("sheets-port-name");
    fireEvent.change(portName, { target: { value: "IMU_CS" } });
    fireEvent.change(screen.getByTestId("sheets-port-direction"), { target: { value: "input" } });
    await act(async () => { fireEvent.submit(portName.closest("form")!); });
    await settle();
    expect(page.commands.at(-1)).toMatchObject({ label: "Added port IMU_CS to Inertial", commandId: "schematic.sheet-structure" });
    const inertial = page.current().sheets!.sheets[1]!;
    expect(inertial.ports!.at(-1)).toMatchObject({ name: "IMU_CS", direction: "input" });
    expect(page.current().netLabels!.filter((label) => label.portId === inertial.ports!.at(-1)!.id).map((label) => label.scope).sort()).toEqual(["hierarchical", "sheet-pin"]);
    expect(resolveProjectConnectivity(page.current(), lookup).ok).toBe(true);
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-reorder-down")); });
    await settle();
    expect(page.current().sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", "Power", "Inertial"]);
    expect(treeItems().map((item) => item.dataset.sheetName)).toEqual(["Overview", "Power", "Inertial"]);
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-reorder-down")); }); // cannot move further: refused before any submission
    await settle();
    expect(screen.getByTestId("sheets-notice").textContent).toMatch(/cannot move further down/);
    expect(page.commands).toHaveLength(3);
    expect(page.commands.every((command) => command.commandId === "schematic.sheet-structure")).toBe(true);
  });

  it("10. [PR-J3 integration, 2026-10-23] J3N-6: the move plan is pure and planned once per distinct input, not once per render", async () => {
    const drone = droneFixtureState();
    const u3 = drone.kicadComponents!.find((item) => item.refDes === "U3")!;
    const page = new FakePage(drone);
    const planner = vi.spyOn(sheetOperations, "planMoveToSheet");
    const view = render(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} selectedKicadId={u3.id} onLens={onLens} />);
    await settle();
    // purity: two previews of one input are identical, operation ids included (no counter runs during a render)
    const input = { mode: "selection" as const, selection: { family: "kicad" as const, id: u3.id }, target: { newSheet: { id: "sheet-preview", name: "IMU" } } };
    const first = lens().controller.api.planMove(input);
    const again = lens().controller.api.planMove({ ...input, target: { newSheet: { ...input.target.newSheet } } });
    expect(first).toEqual(again);
    if (!first.ok) throw new Error(first.message);
    expect(first.input.operationIdPrefix).toBe(MOVE_PREVIEW_PREFIX);
    expect(first.plan.operations.every((operation) => operation.operationId.startsWith(`${MOVE_PREVIEW_PREFIX}:`))).toBe(true);
    expect(planner).toHaveBeenCalledTimes(1); // the second preview came from the cache
    planner.mockClear();
    // the dialog: one plan for the opened dialog, none for a re-render with the same inputs, one per changed input
    openPanel();
    fireEvent.click(screen.getByTestId("sheets-move"));
    await screen.findByTestId("sheets-move-preview");
    expect(planner).toHaveBeenCalledTimes(1); // the new sheet's minted id is a new input
    view.rerender(<Harness page={page} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} selectedKicadId={u3.id} onLens={onLens} />);
    await settle();
    expect(planner).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByTestId("sheets-move-new-name"), { target: { value: "I" } });
    fireEvent.change(screen.getByTestId("sheets-move-new-name"), { target: { value: "IM" } });
    fireEvent.change(screen.getByTestId("sheets-move-new-name"), { target: { value: "IMU" } });
    expect(planner).toHaveBeenCalledTimes(4);
    fireEvent.change(screen.getByTestId("sheets-move-new-name"), { target: { value: "IMU " } }); // the trimmed name is the input: no re-plan
    expect(planner).toHaveBeenCalledTimes(4);
    // the applied transaction stamps its own operation ids (the preview's never reach the document)
    planner.mockClear();
    await act(async () => { fireEvent.click(screen.getByTestId("sheets-move-apply")); });
    await settle();
    expect(page.commands.map((command) => command.commandId)).toEqual(["schematic.move-to-sheet"]);
    const applied = planner.mock.calls.find(([, planInput]) => planInput.operationIdPrefix !== MOVE_PREVIEW_PREFIX);
    expect(applied?.[1].operationIdPrefix).toMatch(/^sheets:move:\d+$/);
    expect(page.current().sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", "IMU"]);
  });
});
