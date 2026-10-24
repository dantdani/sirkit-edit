/**
 * [PR-J5, 2026-10-23] Runbook section J increment 5 (OD-259 item 4): the organise planner's optional interface names for the ports of
 * UNNAMED crossing nets (`planMoveToSheet` / `planOrganizeIntoSheets` option `portNames`, keyed by the SIG<n> the planner mints).
 *
 *  1. without `portNames` the plan is today's: the unnamed crossing takes SIG1 and no crossing carries `renamedFrom`;
 *  2. with `portNames: { SIG1: "LINK" }` the port, its hierarchical label and its sheet pin are named LINK, the crossing records
 *     `renamedFrom: "SIG1"`, the partition is unchanged and two plans are byte-identical (no crypto.randomUUID);
 *  3. refusals, nothing changed: a key the plan does not mint (ORGANIZE_GROUPS_INVALID naming it), an invalid name, a name a label of the
 *     project already uses (SHEET_MOVE_REFUSED naming it), a key that is not a SIG<n>.
 * Pure / in-memory over two catalog resistors of the fixture catalog joined by one wire.
 */
import { describe, expect, it, vi } from "vitest";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import type { KicadComponentInstance, SchematicState } from "@/lib/schematic-types";
import { resolveProjectConnectivity } from "../project-connectivity";
import { planOrganizeIntoSheets, type OrganizeGroupInput } from "../sheet-organization";
import { fixtureParts } from "./_j1-fixtures";

const PART = "b16-1c-part-r";
const parts = fixtureParts();
const getPart = (partId: string) => parts.get(partId) ?? null;

/** Two resistors one above the other, R1 pin 2 wired to R2 pin 1 (an unnamed net), plus a stray VCC label on R2 pin 2. */
export function twoResistorFixture(): SchematicState {
  const part = parts.get(PART)!;
  const r1: KicadComponentInstance = { id: "k-r1", partId: PART, x: 400, y: 200, rotation: 0, refDes: "R1", value: "1k" };
  const r2: KicadComponentInstance = { id: "k-r2", partId: PART, x: 400, y: 600, rotation: 0, refDes: "R2", value: "2k" };
  const r1p2 = kicadPinWorldPos(r1, part.pins[1]!);
  const r2p1 = kicadPinWorldPos(r2, part.pins[0]!);
  const r2p2 = kicadPinWorldPos(r2, part.pins[1]!);
  return {
    components: [],
    wires: [{ id: "w-link", vertices: [{ x: r1p2.x, y: r1p2.y }, { x: r2p1.x, y: r2p1.y }] }],
    kicadComponents: [r1, r2],
    netLabels: [{ id: "l-vcc", position: { x: r2p2.x, y: r2p2.y }, name: "VCC", kind: "power", orientation: 0 }],
    pageSize: "A4",
  };
}

const GROUP_A: OrganizeGroupInput[] = [{ name: "Stage A", refs: ["R1"] }];

describe("[PR-J5] interface names for unnamed crossings", () => {
  it("1. without portNames the unnamed crossing takes SIG1 and no crossing carries renamedFrom", () => {
    const plan = planOrganizeIntoSheets(twoResistorFixture(), GROUP_A, getPart);
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
    expect(plan.preview.steps[0]!.crossings.map((crossing) => [crossing.netName, crossing.port.name, "renamedFrom" in crossing])).toEqual([[null, "SIG1", false]]);
  });

  it("2. portNames renames SIG1 to LINK on the port, its hierarchical label and its sheet pin; the partition is unchanged; two plans are byte-identical without a random draw", () => {
    const state = twoResistorFixture();
    const randomUUID = vi.spyOn(crypto, "randomUUID");
    const plan = planOrganizeIntoSheets(state, GROUP_A, getPart, { portNames: { SIG1: "LINK" } });
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
    expect(plan.preview.steps[0]!.crossings.map((crossing) => ({ net: crossing.netName, port: crossing.port.name, renamedFrom: crossing.renamedFrom }))).toEqual([{ net: null, port: "LINK", renamedFrom: "SIG1" }]);
    const sheet = plan.after.sheets!.sheets.find((item) => item.id === plan.preview.steps[0]!.sheetId)!;
    expect(sheet.ports!.map((port) => port.name)).toEqual(["LINK"]);
    expect(plan.after.netLabels!.filter((label) => label.scope === "hierarchical" || label.scope === "sheet-pin").map((label) => label.name)).toEqual(["LINK", "LINK"]);
    expect(plan.after.netLabels!.some((label) => label.name === "SIG1")).toBe(false);
    const after = resolveProjectConnectivity(plan.after, getPart);
    expect(after.ok).toBe(true);
    expect(after.partitionDigest).toBe(resolveProjectConnectivity(state, getPart).partitionDigest);
    expect(after.netOfPin("k-r1::2")!.name).toBe("LINK");
    expect(JSON.stringify(planOrganizeIntoSheets(twoResistorFixture(), GROUP_A, getPart, { portNames: { SIG1: "LINK" } }))).toBe(JSON.stringify(plan));
    expect(randomUUID).not.toHaveBeenCalled();
    randomUUID.mockRestore();
  });

  it("3. refusals change nothing: a port the plan does not mint, an invalid name, a name already used, a key that is not a SIG<n>", () => {
    const state = twoResistorFixture();
    const digest = JSON.stringify(state);
    const unminted = planOrganizeIntoSheets(state, GROUP_A, getPart, { portNames: { SIG7: "LINK" } });
    expect(unminted).toMatchObject({ ok: false, code: "ORGANIZE_GROUPS_INVALID" });
    expect((unminted as { message: string }).message).toContain("SIG7");
    expect((unminted as { message: string }).message).toContain("mints no such port");
    const invalid = planOrganizeIntoSheets(state, GROUP_A, getPart, { portNames: { SIG1: "no spaces/here" } });
    expect(invalid).toMatchObject({ ok: false, code: "ORGANIZE_GROUPS_INVALID" });
    const taken = planOrganizeIntoSheets(state, GROUP_A, getPart, { portNames: { SIG1: "VCC" } });
    expect(taken).toMatchObject({ ok: false, code: "SHEET_MOVE_REFUSED" });
    expect((taken as { message: string }).message).toContain('"VCC"');
    const notSig = planOrganizeIntoSheets(state, GROUP_A, getPart, { portNames: { LINK: "SIG1" } });
    expect(notSig).toMatchObject({ ok: false, code: "ORGANIZE_GROUPS_INVALID" });
    expect(JSON.stringify(state)).toBe(digest);
  });
});
