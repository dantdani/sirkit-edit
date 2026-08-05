import { migrateBoardConstraintState } from "../constraints/legacy";
import { computeElectricalTruth } from "../pcb/electrical-truth";
import { migrateBoardElectricalIdentities } from "../pcb/integrity";
import { computeProjectRevision } from "./revision";
import { engineeringDigest, engineeringId } from "./stable";
import type { CanonicalProjectState, ProjectPersistenceEnvelope } from "./types";
import { createPersistenceEnvelope } from "./persistence";

export interface LegacyProjectInput {
  schemaVersion?: number;
  id: string;
  state?: unknown;
  pcb?: CanonicalProjectState["pcb"];
  componentSelections?: Record<string, unknown>;
}

function physicalSignature(board: CanonicalProjectState["pcb"]): unknown {
  const truth = computeElectricalTruth(board); return { counts: { nets: board.nets.length, footprints: board.footprints.length, tracks: board.tracks.length, vias: board.vias.length, zones: board.zones.length }, electrical: { required: truth.realized.requiredConnections, completed: truth.realized.completedConnections, remaining: truth.realized.remainingConnections, shortCount: truth.shorts.length, orphanCount: truth.orphanCopper.length }, geometry: { outline: board.outline, tracks: board.tracks.map((track) => ({ id: track.id, start: track.start, end: track.end, layer: track.layer, width: track.width, netId: track.netId })).sort((a, b) => a.id.localeCompare(b.id)), vias: board.vias.map((via) => ({ id: via.id, at: via.at, layers: via.layers, size: via.size, drill: via.drill, netId: via.netId })).sort((a, b) => a.id.localeCompare(b.id)) } };
}

export function migrateLegacyProject(input: LegacyProjectInput, options: { tenantId: string; branchId?: string; actorId: string; buildId: string }): { envelope: ProjectPersistenceEnvelope; diagnostics: string[]; equivalent: boolean } {
  if ((input.schemaVersion ?? 1) > 1) throw new Error(`FUTURE_PROJECT_SCHEMA:${input.schemaVersion}`); if (!input.pcb) throw new Error("LEGACY_PROJECT_HAS_NO_PCB");
  const beforeSignature = physicalSignature(input.pcb); const beforeDigest = engineeringDigest(beforeSignature); const identity = migrateBoardElectricalIdentities(structuredClone(input.pcb), input.id); const constraints = migrateBoardConstraintState(identity.board, input.id); const afterSignature = physicalSignature(constraints.board); const afterDigest = engineeringDigest(afterSignature); const equivalent = beforeDigest === afterDigest;
  if (!equivalent) throw new Error("MIGRATION_SEMANTIC_DIVERGENCE");
  const project: CanonicalProjectState = { schemaVersion: "sirkit.engineering.v1", tenantId: options.tenantId, projectId: input.id, branchId: options.branchId ?? "main", pcb: constraints.board, schematic: structuredClone(input.state), pinnedAssets: [] }; const revision = computeProjectRevision(project); const migration = { migrationId: engineeringId("migration", { project: input.id, beforeDigest, afterDigest, build: options.buildId }), fromVersion: `legacy:${input.schemaVersion ?? 1}`, toVersion: "sirkit.project-persistence-envelope.v1", actorId: options.actorId, completedAt: new Date().toISOString(), preDigest: beforeDigest, postDigest: afterDigest };
  return { envelope: createPersistenceEnvelope({ project, revision, transactionLog: [], buildId: options.buildId, migrationHistory: [migration] }), diagnostics: [...identity.diagnostics, ...constraints.diagnostics].map((item) => `${item.code}:${item.summary}`), equivalent };
}
