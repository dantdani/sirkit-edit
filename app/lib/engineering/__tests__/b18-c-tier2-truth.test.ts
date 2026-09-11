/**
 * [B18-C I9] Tier-2 truth: via diameter/drill stays a PROPOSAL (contract §5;
 * OD-13's recorded divergence from the runbook's Tier 1 list), and the bounded
 * proposal path is made truthful:
 *
 *  - a size/drill change on a via bound to a padstack is refused
 *    `padstack-bound`, naming the padstack and the fork path (the via would
 *    otherwise claim a padstack it no longer matches);
 *  - retargeting it onto an EXISTING padstack (`update_via { padstackId }`)
 *    compiles — padstack, size and drill atomically;
 *  - a legacy via (no padstack) is still updatable by size/drill, and moving a
 *    bound via is unaffected;
 *  - no via or copper-track command is an execution family, every one is
 *    never-granted, and their tools stay unexposed.
 */
import { describe, expect, it } from "vitest";
import { createEmptyBoard, type PcbBoard } from "../../pcb/types";
import { getPreset, DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { pcbRevisionId } from "../../pcb/revision";
import { compileBoundedPcbEdit } from "../../pcb/proposal/bounded-edit-compiler";
import { isExecutionFamily } from "../execution-grant";
import { NEVER_GRANTED_COMMAND_IDS } from "../granted-execution-families";
import { sirkitToolRegistry } from "../tool-catalog";

const RULES = getPreset(DEFAULT_PRESET_ID).rules;
function board(): PcbBoard {
  const base = createEmptyBoard();
  base.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  base.nets.push({ id: 1, name: "NET1" }, { id: 2, name: "NET2" });
  base.padstacks = [
    { id: "ps-small", name: "Via 0.6/0.3", kind: "via", outerNm: 600_000, drillNm: 300_000, tented: true, zoneConnect: "solid" },
    { id: "ps-big", name: "Via 1.2/0.6", kind: "via", outerNm: 1_200_000, drillNm: 600_000, tented: true, zoneConnect: "solid" },
  ];
  base.vias = [
    { id: "v-bound", at: { x: 30_000_000, y: 30_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"], padstackId: "ps-small" },
    { id: "v-legacy", at: { x: 60_000_000, y: 30_000_000 }, size: 600_000, drill: 300_000, netId: 2, layers: ["copperTop", "copperBottom"] },
  ];
  return base;
}
const compile = (operations: unknown[], source: PcbBoard = board()) => compileBoundedPcbEdit({ board: source, rules: RULES, baseIdentity: pcbRevisionId(source), payload: { intent: "x", operations } });

describe("B18-C I9 — the via proposal path is truthful (scenario 2)", () => {
  it("a size/drill change on a padstack-bound via is refused padstack-bound, naming the padstack and the fork path", () => {
    for (const change of [{ sizeNm: 700_000 }, { drillNm: 350_000 }, { sizeNm: 800_000, drillNm: 400_000 }]) {
      const result = compile([{ kind: "update_via", viaId: "v-bound", ...change }]);
      expect(result, JSON.stringify(change)).toMatchObject({ ok: false, code: "padstack-bound" });
      expect(JSON.stringify(result), JSON.stringify(change)).toMatch(/Via 0\.6\/0\.3 \(ps-small\)/);
      expect(JSON.stringify(result), JSON.stringify(change)).toMatch(/create-padstack/);
    }
  });

  it("retargeting onto an existing padstack compiles — padstack, size and drill atomically; a legacy via is still updatable; moving a bound via is unaffected", () => {
    const retarget = compile([{ kind: "update_via", viaId: "v-bound", padstackId: "ps-big" }]);
    if (!retarget.ok) throw new Error(`${retarget.code}: ${JSON.stringify(retarget)}`);
    expect(retarget.candidate.vias.find((via) => via.id === "v-bound")).toMatchObject({ padstackId: "ps-big", size: 1_200_000, drill: 600_000 });
    expect(compile([{ kind: "update_via", viaId: "v-legacy", sizeNm: 700_000 }])).toMatchObject({ ok: true });
    expect(compile([{ kind: "update_via", viaId: "v-bound", at: { x: 31_000_000, y: 30_000_000 } }])).toMatchObject({ ok: true });
  });

  it("no via or copper-track command is an execution family; each is never-granted; their tools stay unexposed", () => {
    const copper = ["pcb.edit-via", "pcb.create-via", "pcb.padstack", "pcb.edit-track"];
    for (const command of copper) {
      expect(isExecutionFamily(command), command).toBe(false);
      expect(NEVER_GRANTED_COMMAND_IDS, command).toContain(command);
    }
    for (const descriptor of sirkitToolRegistry().list().filter((item) => copper.includes(item.owningCommandId))) expect(descriptor.agentExposed, descriptor.toolId).toBe(false);
  });
});
