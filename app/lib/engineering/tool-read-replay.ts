/**
 * B05/B05.1 — deterministic replay-fixture builder for activated read
 * bindings.
 *
 * Builds a small, fully deterministic engineering snapshot (no Date, no
 * randomness, no providers), seals every resource in a versioned
 * digest-verified envelope, runs every activated read binding against the
 * pinned bundle, and emits `ReadReplayFixture`s whose expected output
 * digests, consumed-resource manifest digests, and verification states CI
 * can re-verify model-free. Shared by the artifact generator and the tests.
 */

import type { CapturedViewContext } from "../agent/view-context";
import { createEmptyBoard, type FootprintInstance, type PcbBoard, type Track, type Via } from "../pcb/types";
import { getPreset as getDrcPreset } from "../pcb/drc/presets";
import { FAB_PRESETS } from "../pcb/fab/presets";
import {
  buildReadResourceBundle,
  consumedManifest,
  sealResourceEnvelope,
  type ReadResourceBundle,
} from "./resource-envelopes";
import { computeProjectRevision } from "./revision";
import { engineeringDigest } from "./stable";
import { ACTIVATED_READ_BINDINGS } from "./tool-bindings-readonly";
import type { ReadReplayFixture, ReadVerificationState } from "./tool-invocation";
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

const SCOPE = { tenantId: "tenant-fixture", projectId: "project-fixture", branchId: "main" } as const;

/** Deterministic pinned bundle: canonical state + every auxiliary resource. */
/** [B17-F] a deterministic captured view context: three surfaces, fixed session ids/revisions, a two-entry timeline. */
export function replayFixtureViewContext(): CapturedViewContext {
  return {
    schema: "sirkit.view-context.v1",
    surfaces: ["pcb", "pcb3d", "workspace"],
    editors: {
      pcb: { editor: "pcb", sessionId: "vs-fixture-pcb", viewRevision: 3, state: { camera: { kind: "fit-board", seq: 1 }, layers: { active: "F.Cu" }, grid: true, selection: { refs: [{ kind: "footprint", id: "u1" }], primary: { kind: "footprint", id: "u1" }, digest: "eng1-fixtureselection00" }, highlight: null, measurement: null } },
      pcb3d: { editor: "pcb3d", sessionId: "vs-fixture-pcb3d", viewRevision: 1, state: { open: false, preset: "iso", finish: "green" } },
      workspace: { editor: "workspace", sessionId: "vs-fixture-workspace", viewRevision: 2, state: { tab: "pcb", available: ["schematic", "pcb"] } },
    },
    timeline: {
      entries: [
        { seq: 1, at: 1_700_000_000_000, store: "schematic", kind: "hydrate", label: "Loaded project", actor: "system", head: { store: "schematic", entryCount: 0, digest: "eng1-fixtureschematic0" } },
        { seq: 2, at: 1_700_000_001_000, store: "pcb", kind: "commit", label: "Move U1", actor: "human", head: { store: "pcb", historyId: "hist-fixture", headSequence: 1, entryCount: 1 }, ref: { transactionId: "tx-fixture-1" } },
      ],
      eligibleUndo: { ok: true, code: null, operation: { store: "pcb", kind: "commit", label: "Move U1", seq: 2 } },
    },
  };
}

export function replayFixtureBundle(): ReadResourceBundle {
  const canonicalState: CanonicalProjectState = {
    schemaVersion: "sirkit.engineering.v1",
    ...SCOPE,
    pcb: replayFixtureBoard(),
    pinnedAssets: [],
  };
  const canonicalRevision = computeProjectRevision(canonicalState).canonicalStateDigest;
  const common = {
    ...SCOPE,
    authorityStatus: "verified" as const,
    freshness: "current" as const,
    sourceCanonicalRevision: canonicalRevision,
  };
  const canonicalEnvelope = sealResourceEnvelope({
    ...common,
    resourceId: "res:canonical:fixture",
    kind: "canonical-state",
    authoritySource: "local-working-copy",
    sourceVersion: canonicalRevision,
    producer: "b05.1-fixture", producerVersion: "1.0.0",
    content: canonicalState,
  });
  const drcPreset = getDrcPreset("jlcpcb-2l");
  const fabPreset = FAB_PRESETS.find((preset) => preset.id === "jlcpcb-2l")!;
  const auxiliary = [
    sealResourceEnvelope({
      ...common,
      resourceId: "res:selection:fixture",
      kind: "selection-snapshot",
      authoritySource: "local-working-copy",
      sourceVersion: "session-selection",
      producer: "b05.1-fixture", producerVersion: "1.0.0",
      content: [{ kind: "footprint", id: "u1" }, { kind: "track", id: "t1" }],
    }),
    sealResourceEnvelope({
      ...common,
      resourceId: "res:authority:fixture",
      kind: "component-authority-records",
      authoritySource: "durable-server-board",
      sourceVersion: "binding-rev-7",
      producer: "b05.1-fixture", producerVersion: "1.0.0",
      content: {
        records: [
          {
            authorityRecordId: "auth:u1", componentId: "u1", projectId: SCOPE.projectId, authorityRevision: "rev-7",
            selectedPart: { mpn: "FIX-100", manufacturer: "Fixture Corp", package: "SOIC-8", provenance: "physical-binding" },
            lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none",
            footprintAsset: "available", mappingVerification: "verified",
            footprintBindingRevision: "fp-rev-3", mappingVerificationRevision: "map-rev-2", approvalRevision: "appr-rev-1",
            exactAuthority: { atomicPartRevisionId: "rev-7", mpn: "FIX-100", manufacturer: "Fixture Corp", symbolAssetVersionId: "sym-rev-3", footprintAssetVersionId: "fp-rev-3", mappingCertificateId: "map-rev-2", selectionRecordId: "sel-rev-1" },
            permittedAlternatives: ["FIX-100B"], evidenceRefs: ["binding:fixture:u1"],
          },
          {
            authorityRecordId: "auth:u2", componentId: "u2", projectId: SCOPE.projectId, authorityRevision: "rev-2",
            lifecycle: "draft", approval: "unreviewed", freshness: "unknown", conflict: "none",
            footprintAsset: "unresolved", mappingVerification: "missing",
          },
        ],
        candidates: [{ componentId: "u2", mpn: "CAND-200", manufacturer: "Maybe Inc", displayText: "candidate from search" }],
      },
    }),
    // [B17-F] the captured view context (what the editors show) and the project timeline it carries.
    sealResourceEnvelope({
      ...common,
      resourceId: "res:view:fixture",
      kind: "view-state-snapshot",
      authoritySource: "local-working-copy",
      sourceVersion: "view-fixture-1",
      producer: "b17-f-fixture", producerVersion: "1.0.0",
      content: replayFixtureViewContext(),
    }),
    sealResourceEnvelope({
      ...common,
      resourceId: "res:timeline:fixture",
      kind: "project-timeline-snapshot",
      authoritySource: "local-working-copy",
      sourceVersion: "view-fixture-1",
      producer: "b17-f-fixture", producerVersion: "1.0.0",
      content: replayFixtureViewContext(),
    }),
    sealResourceEnvelope({
      ...common,
      resourceId: "res:drc-rules:fixture",
      kind: "drc-rules",
      authoritySource: "catalog",
      sourceVersion: `jlcpcb-2l@v${drcPreset.version}`,
      producer: "pcb/drc/presets", producerVersion: String(drcPreset.version),
      content: drcPreset.rules,
    }),
    sealResourceEnvelope({
      ...common,
      resourceId: "res:fab-preset:fixture",
      kind: "fab-preset",
      authoritySource: "catalog",
      sourceVersion: `jlcpcb-2l@v${fabPreset.version}`,
      producer: "pcb/fab/presets", producerVersion: String(fabPreset.version),
      content: fabPreset,
    }),
    sealResourceEnvelope({
      ...common,
      resourceId: "res:drc-preset:fixture",
      kind: "drc-preset",
      authoritySource: "catalog",
      sourceVersion: `jlcpcb-2l@v${drcPreset.version}`,
      producer: "pcb/drc/presets", producerVersion: String(drcPreset.version),
      content: drcPreset,
    }),
  ];
  return buildReadResourceBundle(canonicalEnvelope, auxiliary);
}

/** Per-tool fixture args (deterministic; {} = default empty args). */
const FIXTURE_ARGS: Record<string, Record<string, unknown>> = {
  "sirkit.selection.inspect": { refs: [{ kind: "footprint", id: "u1" }, { kind: "track", id: "t1" }, { kind: "via", id: "v-dead" }] },
  "sirkit.component-authority.inspect": { componentIds: ["u1", "u2", "u3"] },
  "sirkit.view.read-state": { editor: "pcb" },
  "sirkit.project.history-inspect": { limit: 10 },
};

export async function buildReadReplayFixtures(): Promise<ReadReplayFixture[]> {
  const { buildScopedResources, consumedKindsFor } = await import("./tool-invocation");
  const fixtures: ReadReplayFixture[] = [];
  for (const binding of [...ACTIVATED_READ_BINDINGS].sort((a, b) => a.toolId.localeCompare(b.toolId))) {
    const bundle = replayFixtureBundle();
    const args = FIXTURE_ARGS[binding.toolId] ?? {};
    const consumedKinds = consumedKindsFor(binding, bundle);
    const scoped = buildScopedResources(bundle, consumedKinds);
    const output = await Promise.resolve(binding.invoke(structuredClone(args), scoped));
    fixtures.push({
      schema: "sirkit.read-replay-fixture.v2",
      toolId: binding.toolId,
      toolVersion: "1.0.0",
      bindingId: binding.bindingId,
      bindingVersion: binding.bindingVersion,
      args,
      bundle,
      expectedOutputDigest: engineeringDigest({ tool: binding.toolId, version: "1.0.0", output }),
      expectedConsumedManifestDigest: engineeringDigest({ schema: "sirkit.consumed-manifest.v1", consumed: consumedManifest(bundle, consumedKinds) }),
      expectedVerification: (consumedKinds.length > 1 ? "composite-resources-verified" : "canonical-revision-verified") as ReadVerificationState,
    });
  }
  return fixtures;
}
