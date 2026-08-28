import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { KicadPin } from "../../kicad/types";
import type { SchematicState } from "@/lib/schematic-types";
import type { FootprintSearchHit } from "../../pcb/footprint-api-types";
import { parseKicadMod } from "../../pcb/kicad-mod";
import { syncFromSchematic, type FootprintResolver, type PartLookup } from "../../pcb/netlist-bridge";
import { bindingScope, scopedBindingJson } from "../../../api/physical-bindings/_scope";
import { migrateLegacyPhysicalBinding } from "../legacy";
import { withPhysicalBindingShadow } from "../shadow";
import { ACTOR, NOW, scope } from "./fixtures";

const pins: KicadPin[] = [
  { number: "1", name: "~", type: "passive", position: { x: -2.54, y: 0 }, orientation: 0, length: 1.27 },
  { number: "2", name: "~", type: "passive", position: { x: 2.54, y: 0 }, orientation: 180, length: 1.27 },
];

function actualResolver(): FootprintResolver {
  const rawSexpr = readFileSync(fileURLToPath(new URL("../../pcb/__tests__/fixtures/R_0805_2012Metric.kicad_mod", import.meta.url)), "utf8");
  const def = parseKicadMod(rawSexpr, "Resistor_SMD");
  const hit: FootprintSearchHit = { id: "fixture-r0805", libName: "Resistor_SMD", name: def.name, fullName: "Resistor_SMD:R_0805_2012Metric", description: def.description ?? null, padCount: def.pads.length, attrSmd: true, attrTht: false, bodyBBox: def.bodyBBox, score: 1 };
  return { resolve: async (name) => name === hit.fullName ? hit : null, detail: async (id) => id === hit.id ? { libName: hit.libName, rawSexpr } : null };
}

describe("release-critical shadow equivalence, API scope, and SQL migration", () => {
  it("proves enabling Stage 1 shadow leaves the actual legacy PCB sync board/netlist/mutation result unchanged", async () => {
    const schematic: SchematicState = { components: [], wires: [], kicadComponents: [{ id: "component-r1", partId: "part-r", x: 100, y: 100, rotation: 0, refDes: "R1", value: "10k" }] };
    const getPart: PartLookup = () => ({ pins, footprintHint: "Resistor_SMD:R_0805_2012Metric", name: "R", description: "Resistor", mpn: null });
    const binding = migrateLegacyPhysicalBinding({ sourceSchemaVersion: "legacy", scope: scope("component-r1"), rawComponent: { footprintHint: "Resistor_SMD:R_0805_2012Metric" }, actor: { ...ACTOR, actorKind: "system_migration", role: "migration_admin" }, migratedAt: NOW }).candidate;
    const disabled = await withPhysicalBindingShadow({ production: () => syncFromSchematic(schematic, undefined, { getPart, resolver: actualResolver() }), binding, legacyFootprint: "Resistor_SMD:R_0805_2012Metric", assessedAt: NOW, enabled: false });
    let observed = false;
    const enabled = await withPhysicalBindingShadow({ production: () => syncFromSchematic(schematic, undefined, { getPart, resolver: actualResolver() }), binding, legacyFootprint: "Resistor_SMD:R_0805_2012Metric", assessedAt: NOW, enabled: true, observe: (comparison) => { observed = true; expect(comparison.productionBehaviorChanged).toBe(false); } });
    expect(observed).toBe(true);
    expect(enabled).toEqual(disabled);
    expect(enabled.board.footprints[0]?.footprintId).toBe("Resistor_SMD:R_0805_2012Metric");
  });

  it("requires explicit authenticated project scope and rejects oversized API input", async () => {
    // B16.0: identity/role are SERVER-DERIVED. A missing project selector is
    // refused; the tenant/project SELECTOR is honored; role no longer comes
    // from a header.
    expect(await bindingScope(new Request("http://localhost/api/physical-bindings"))).toMatchObject({ ok: false });
    const headers = { "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main" };
    expect(await bindingScope(new Request("http://localhost/api/physical-bindings", { headers }))).toMatchObject({ ok: true, scope: { tenantId: "tenant-1", projectId: "project-1" } });
    // B16.0.1: the shared adapter validates the media type BEFORE the size
    // bound, so the oversized probe must declare application/json to reach
    // the 413 byte-ceiling refusal.
    const oversized = await scopedBindingJson(new Request("http://localhost/api/physical-bindings", { method: "POST", headers: { ...headers, origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ payload: "x".repeat(2_000_001) }) }));
    expect(oversized).toMatchObject({ ok: false, response: { status: 413 } });
  });

  it("keeps the Stage 1 migration additive and free of destructive PCB/schematic statements", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../../drizzle/0022_footprint_binding_stage01.sql", import.meta.url)), "utf8");
    expect(sql).toContain("physical_binding_revisions");
    expect(sql).toContain("physical_binding_migration_records");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|ALTER\s+TABLE)\b/i);
    expect(sql).not.toMatch(/pcb_|schematic_/i);
  });
});
