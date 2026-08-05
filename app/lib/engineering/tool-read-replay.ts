/**
 * B05 — deterministic replay-fixture builder for activated read bindings.
 *
 * Builds a small, fully deterministic engineering snapshot (no Date, no
 * randomness, no providers), runs every activated read binding against it,
 * and emits pinned `ReadReplayFixture`s whose expected output digests CI can
 * re-verify model-free. Shared by the artifact generator and the test suite.
 */

import { createEmptyBoard, type FootprintInstance, type PcbBoard, type Track, type Via } from "../pcb/types";
import { getPreset as getDrcPreset } from "../pcb/drc/presets";
import { FAB_PRESETS } from "../pcb/fab/presets";
import { engineeringDigest } from "./stable";
import { ACTIVATED_READ_BINDINGS, type ReadResourceSet } from "./tool-bindings-readonly";
import type { ReadReplayFixture } from "./tool-invocation";
import type { CanonicalProjectState } from "./types";

function footprint(id: string, x: number): FootprintInstance {
  return {
    id, ref: id.toUpperCase(), footprintId: "fixture:empty",
    def: {
      libName: "fixture", name: "empty",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads: [], graphics: [], bodyBBox: { minX: -500_000, minY: -500_000, maxX: 500_000, maxY: 500_000 },
      models: [], rawSexpr: "(footprint fixture)",
    },
    at: { x, y: 2_000_000 }, rotationDeg: 0, side: "top", padNets: {},
  };
}

const track = (id: string): Track => ({ id, layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 3_000_000 }, end: { x: 5_000_000, y: 3_000_000 }, netId: 1, source: "human" });
const via = (id: string): Via => ({ id, at: { x: 3_000_000, y: 3_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] });

export function replayFixtureBoard(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
  board.footprints.push(footprint("u1", 2_000_000), footprint("u2", 8_000_000));
  board.tracks.push(track("t1"));
  board.vias.push(via("v1"));
  return board;
}

export function replayFixtureResources(): ReadResourceSet {
  const canonicalState: CanonicalProjectState = {
    schemaVersion: "sirkit.engineering.v1",
    tenantId: "tenant-fixture", projectId: "project-fixture", branchId: "main",
    pcb: replayFixtureBoard(),
    pinnedAssets: [],
  };
  const drcPreset = getDrcPreset("jlcpcb-2l");
  const fabPreset = FAB_PRESETS.find((preset) => preset.id === "jlcpcb-2l")!;
  return {
    canonicalState,
    authoritySource: "local-working-copy",
    availableAuthority: ["local-working-copy", "durable-server-board"],
    selectionRefs: [{ kind: "footprint", id: "u1" }, { kind: "track", id: "t1" }],
    componentAuthority: {
      records: [
        {
          componentId: "u1",
          selectedPart: { mpn: "FIX-100", manufacturer: "Fixture Corp", package: "SOIC-8", provenance: "physical-binding" },
          lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none",
          footprintAsset: "available", mappingVerification: "verified",
          permittedAlternatives: ["FIX-100B"], evidenceRefs: ["binding:fixture:u1"],
        },
        {
          componentId: "u2",
          lifecycle: "draft", approval: "unreviewed", freshness: "unknown", conflict: "none",
          footprintAsset: "unresolved", mappingVerification: "missing",
        },
      ],
      candidates: [{ componentId: "u2", mpn: "CAND-200", manufacturer: "Maybe Inc", displayText: "candidate from search" }],
    },
    drcRules: drcPreset.rules,
    readiness: { fabPreset, drcPreset },
  };
}

/** Per-tool fixture args (deterministic; [] = default empty args). */
const FIXTURE_ARGS: Record<string, Record<string, unknown>> = {
  "sirkit.selection.inspect": { refs: [{ kind: "footprint", id: "u1" }, { kind: "track", id: "t1" }, { kind: "via", id: "v-dead" }] },
  "sirkit.component-authority.inspect": { componentIds: ["u1", "u2", "u3"] },
};

export async function buildReadReplayFixtures(): Promise<ReadReplayFixture[]> {
  const fixtures: ReadReplayFixture[] = [];
  for (const binding of [...ACTIVATED_READ_BINDINGS].sort((a, b) => a.toolId.localeCompare(b.toolId))) {
    const resources = replayFixtureResources();
    const args = FIXTURE_ARGS[binding.toolId] ?? {};
    const output = await Promise.resolve(binding.invoke(structuredClone(args), resources));
    fixtures.push({
      schema: "sirkit.read-replay-fixture.v1",
      toolId: binding.toolId,
      toolVersion: "1.0.0",
      bindingId: binding.bindingId,
      bindingVersion: binding.bindingVersion,
      args,
      resources,
      resourceDigest: engineeringDigest(resources),
      expectedOutputDigest: engineeringDigest({ tool: binding.toolId, version: "1.0.0", output }),
    });
  }
  return fixtures;
}
