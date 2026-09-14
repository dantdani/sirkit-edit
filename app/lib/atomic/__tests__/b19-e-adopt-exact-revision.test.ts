/**
 * [B19-E E5 g] "Use published exact revision": a manually placed KiCad instance adopts the exact atomic identity of the part's
 * selectable link for its value — the same link resolution Build auto-layout uses — or nothing.
 *
 * The ids come only from the part's `atomicAssignments` (which /api/parts/[id] fills from selectable links only, approved): a
 * value whose own link was withdrawn never falls back to the default link, an unapproved entry is never adopted, and an unlinked
 * part adopts nothing. Adoption is identity only: authority still needs the reviewed physical binding downstream.
 *
 * Reproduced on the unchanged code: the link resolution was private to autoLayoutBuild and manual placement never carried an
 * exact identity.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adoptPublishedExactRevision, autoLayoutBuild, publishedAtomicIdentity } from "@/lib/build-auto-layout";
import { kicadPlacementCommand } from "@/lib/kicad-placement";
import { normalizeValueKey } from "@/app/lib/atomic/value-key";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { fromCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { diffSchematicGraphOps } from "@/app/lib/engineering/schematic-graph";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { classifyControlSites } from "@/app/lib/engineering/control-registry";
import { scanControlSites } from "@/app/lib/engineering/control-surface";

const link = (revisionId: string, approved: boolean = true) => ({ revisionId, symbolVersionId: `sym-${revisionId}`, footprintVersionId: `fp-${revisionId}`, mappingCertificateId: `map-${revisionId}`, footprintFullName: "Resistor_SMD:R_0805_2012Metric", approved: approved as true });
const part = (extra: Partial<CachedPart> = {}): CachedPart => ({ id: "part-r", name: "R", description: null, mpn: null, manufacturer: null, datasheet: null, footprintHint: null, mainCategory: "Resistor", libraryName: "Device", pins: [], symbolRaw: "", properties: { Value: "10k" }, ...extra });
const identityOf = (revisionId: string) => ({ atomicPartRevisionId: revisionId, symbolAssetVersionId: `sym-${revisionId}`, footprintAssetVersionId: `fp-${revisionId}`, mappingCertificateId: `map-${revisionId}` });

describe("[B19-E E5 g] adopting a published exact revision", () => {
  it("adopts the value's own selectable link, else the default link", () => {
    const linked = part({ atomicAssignments: { "10k": link("rev-10k"), "": link("rev-default") } });
    // [B19-E E5 review follow-up] an adopted identity names the value it was resolved for
    expect(adoptPublishedExactRevision(linked, "10k")).toEqual({ ...identityOf("rev-10k"), forValue: "10k" });
    expect(adoptPublishedExactRevision(linked, "4k7")).toEqual({ ...identityOf("rev-default"), forValue: "4k7" });
  });

  it("an unlinked part, a null part, or a value whose own link was withdrawn adopts nothing", () => {
    expect(adoptPublishedExactRevision(part(), "10k")).toBeNull();
    expect(adoptPublishedExactRevision(null, "10k")).toBeNull();
    const withdrawn = part({ atomicAssignments: { "": link("rev-default") }, withdrawnValueKeys: ["10k"] });
    expect(adoptPublishedExactRevision(withdrawn, "10k")).toBeNull();
  });

  it("an entry that is not approved (not a selectable link) is never adopted", () => {
    expect(adoptPublishedExactRevision(part({ atomicAssignments: { "10k": link("rev-10k", false) } }), "10k")).toBeNull();
  });

  it("it is the resolution Build auto-layout uses: the same identity lands on an auto-laid instance", () => {
    const linked = part({ atomicAssignments: { "10k": link("rev-10k") } });
    expect(publishedAtomicIdentity(linked, "10k")).toEqual(identityOf("rev-10k"));
    const state = autoLayoutBuild({ components: [{ refDes: "R1", partId: "part-r", value: "10k", role: "passive" }], connections: [], explanation: "b19-e-e5" }, new Map([["part-r", linked]]));
    const [instance] = state.kicadComponents ?? [];
    expect({ atomicPartRevisionId: instance!.atomicPartRevisionId, symbolAssetVersionId: instance!.symbolAssetVersionId, footprintAssetVersionId: instance!.footprintAssetVersionId, mappingCertificateId: instance!.mappingCertificateId }).toEqual(identityOf("rev-10k"));
  });
});

describe("[B19-E E5 review] from the button to the canonical schematic.add-component command", () => {
  const empty = (): SchematicState => ({ components: [], kicadComponents: [], wires: [], netLabels: [] });
  async function place(exactIdentity: ReturnType<typeof adoptPublishedExactRevision>) {
    const state = empty();
    const editor = new SchematicEditorSession({ tenantId: "local", projectId: "p-b19e-e5-adopt", branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
    await editor.openForProject(state, null);
    const command = kicadPlacementCommand({ id: "k-placed", partId: "part-r", x: 120, y: 80, rotation: 0, value: "10k", refDesFor: (existing) => `R${existing.length + 1}`, exactIdentity });
    const result = await editor.execute(state, { commandId: "schematic.add-component", label: command.label, buildOperations: (canonical) => diffSchematicGraphOps(canonical, command.recipe(fromCanonicalSchematic(canonical))) });
    if (!result.ok) throw new Error(`placement rejected: ${JSON.stringify(result).slice(0, 300)}`);
    return { label: command.label, instance: result.state.kicadComponents?.[0] };
  }

  it("an adopted identity lands on the placed instance through the canonical session; a linked part's four ids, nothing else", async () => {
    const identity = adoptPublishedExactRevision(part({ atomicAssignments: { "10k": link("rev-10k") } }), "10k");
    const placed = await place(identity);
    expect(placed.label).toBe("Placed part (published exact revision)");
    expect(placed.instance).toMatchObject({ id: "k-placed", partId: "part-r", refDes: "R1", value: "10k", ...identityOf("rev-10k") });
  });

  // [B19-E E5 review follow-up] the identity was resolved for one value; a placement whose value differs (the part cache not yet
  // filled gives "", or another value) must not carry that value's revision
  it("an identity adopted for 10k is dropped when the placement's own value is not 10k", async () => {
    const identity = adoptPublishedExactRevision(part({ atomicAssignments: { "10k": link("rev-10k") } }), "10k");
    for (const value of ["", "4k7", "10 k", "10K"]) {
      const command = kicadPlacementCommand({ id: "k-other", partId: "part-r", x: 0, y: 0, rotation: 0, value, refDesFor: () => "R1", exactIdentity: identity });
      const [instance] = command.recipe({ components: [], kicadComponents: [], wires: [], netLabels: [] }).kicadComponents;
      const sameValue = normalizeValueKey(value) === normalizeValueKey("10k"); // the link's own key rule decides "the same value"
      expect(command.label, JSON.stringify(value)).toBe(sameValue ? "Placed part (published exact revision)" : "Placed part");
      expect(instance!.atomicPartRevisionId ?? null, JSON.stringify(value)).toBe(sameValue ? "rev-10k" : null);
    }
  });

  it("an unlinked part, or a value whose own link was withdrawn, places a plain instance with no exact identity", async () => {
    for (const source of [part(), part({ atomicAssignments: { "": link("rev-default") }, withdrawnValueKeys: ["10k"] })]) {
      const placed = await place(adoptPublishedExactRevision(source, "10k"));
      expect(placed.label).toBe("Placed part");
      for (const key of ["atomicPartRevisionId", "symbolAssetVersionId", "footprintAssetVersionId", "mappingCertificateId"]) expect(placed.instance).not.toHaveProperty(key);
    }
  });

  it("app/page.tsx wires the Build Library's resolved identity into the placement click (never re-read from the part cache)", () => {
    const page = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");
    expect(page).toMatch(/<BuildLibraryPanel onSelectForPlacement=\{startKicadPlacement\}/);
    expect(page).toMatch(/function startKicadPlacement\(partId: string, options\?: \{ exactIdentity\?: AdoptedAtomicIdentity \}\) \{\s*setPlacementPartId\(partId\);\s*setPlacementExactIdentity\(options\?\.exactIdentity \?\? null\);/);
    expect(page).toMatch(/placementExactIdentity=\{placementExactIdentity\}/);
    const click = /tool === "kicad-place"\) \{[\s\S]*?\} else if \(tool === "wire"\)/.exec(page)?.[0] ?? "";
    expect(click).toMatch(/kicadPlacementCommand\(\{[^}]*exactIdentity: placementExactIdentity[^}]*\}\)/);
    expect(click).toMatch(/graph\.run\(placement\.label, "schematic\.add-component", placement\.recipe\)/);
    expect(click).not.toMatch(/adoptPublishedExactRevision\(|getCachedPart\([^)]*\)[\s\S]*atomicPartRevisionId/);
  });

  it("the plain Place control keeps its own unannotated inventory row; Use published exact revision has its own rule and note", () => {
    const { classified } = classifyControlSites(scanControlSites(process.cwd()));
    const surface = "app/components/editor/BuildLibraryPanel.tsx";
    const place = classified.filter((row) => row.surface === surface && row.handler === "onPlace");
    expect(place.map((row) => [row.ruleId, row.note])).toEqual([["schematic.add-component", ""]]);
    const exact = classified.filter((row) => row.surface === surface && row.handler === "placeExactRevision");
    expect(exact.map((row) => row.ruleId)).toEqual(["schematic.add-component-exact-revision"]);
    expect(exact[0]!.recordIds).toEqual(["schematic.add-component"]);
    expect(exact[0]!.note).toMatch(/^\[B19-E E5\] Use published exact revision/);
  });
});
