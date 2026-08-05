import { computeElectricalTruth, type ElectricalTruthReport } from "../pcb/electrical-truth";
import { runDrc } from "../pcb/drc/run-drc";
import type { DrcResult, DrcRules } from "../pcb/drc/types";
import type { PcbBoard } from "../pcb/types";
import { canonicalJson, engineeringDigest, engineeringId } from "./stable";
import type { EngineeringChangeSet, ProjectRevision } from "./types";

export interface CanonicalElectricalOracle {
  designRevision: string;
  intended: ElectricalTruthReport["intended"];
  assigned: Omit<ElectricalTruthReport["assigned"], "physicalPads"> & { physicalPadIds: string[] };
  nets: Array<Pick<ElectricalTruthReport["nets"][number], "stableNetId" | "state" | "intentState" | "assignmentState" | "realizationState" | "endpointKeys" | "terminalGroupIds" | "physicalPadInstanceIds" | "conductiveClusters" | "requiredConnections" | "completedConnections" | "remainingConnections" | "shortIds" | "unresolvedCodes">>;
  shorts: ElectricalTruthReport["shorts"];
  orphanCopper: ElectricalTruthReport["orphanCopper"];
  unresolved: ElectricalTruthReport["unresolved"];
  realized: Pick<ElectricalTruthReport["realized"], "state" | "requiredConnections" | "completedConnections" | "remainingConnections" | "routedNets" | "totalNets" | "airwires">;
}

export function canonicalElectricalTruth(report: ElectricalTruthReport): CanonicalElectricalOracle {
  return { designRevision: report.designRevision, intended: report.intended, assigned: { state: report.assigned.state, terminalGroups: report.assigned.terminalGroups, missingEndpointKeys: report.assigned.missingEndpointKeys, unaccountedPadInstanceIds: report.assigned.unaccountedPadInstanceIds, physicalPadIds: report.assigned.physicalPads.map((pad) => pad.id).sort() }, nets: report.nets.map((net) => ({ stableNetId: net.stableNetId, state: net.state, intentState: net.intentState, assignmentState: net.assignmentState, realizationState: net.realizationState, endpointKeys: net.endpointKeys, terminalGroupIds: net.terminalGroupIds, physicalPadInstanceIds: net.physicalPadInstanceIds, conductiveClusters: net.conductiveClusters, requiredConnections: net.requiredConnections, completedConnections: net.completedConnections, remainingConnections: net.remainingConnections, shortIds: net.shortIds, unresolvedCodes: net.unresolvedCodes })).sort((a, b) => a.stableNetId.localeCompare(b.stableNetId)), shorts: [...report.shorts].sort((a, b) => a.id.localeCompare(b.id)), orphanCopper: [...report.orphanCopper].sort((a, b) => a.objectId.localeCompare(b.objectId)), unresolved: [...report.unresolved].sort((a, b) => a.code.localeCompare(b.code) || a.objectIds.join().localeCompare(b.objectIds.join())), realized: { state: report.realized.state, requiredConnections: report.realized.requiredConnections, completedConnections: report.realized.completedConnections, remainingConnections: report.realized.remainingConnections, routedNets: report.realized.routedNets, totalNets: report.realized.totalNets, airwires: [...report.realized.airwires].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))) } };
}

export function canonicalDrc(result: DrcResult): unknown { return { schemaVersion: result.schemaVersion, checkVersion: result.checkVersion, execution: result.execution, completedChecks: result.completedChecks, designRevision: result.designRevision, ok: result.ok, violations: result.violations.map((item) => ({ ...item, items: [...item.items].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))), objectIds: [...(item.objectIds ?? [])].sort(), constraintIds: [...(item.constraintIds ?? [])].sort() })).sort((a, b) => a.id.localeCompare(b.id)), presetId: result.presetId, constraintProgramHash: result.constraintProgramHash, ruleResolutionHash: result.ruleResolutionHash, electrical: result.electrical, summary: result.summary };
}

export interface DifferentialVerificationResult {
  verificationId: string;
  revision: ProjectRevision;
  mode: "full_fallback" | "shadow";
  incrementalStrategy: "unaffected_cache_reuse" | "broad_full_fallback";
  electrical: { incrementalDigest: string; fullDigest: string; equivalent: boolean };
  drc: { incrementalDigest: string; fullDigest: string; equivalent: boolean };
  divergenceSignatures: string[];
  fallbackUsed: boolean;
  durationMs: number;
  objectsExamined: number;
  changeSetTransactionId: string;
}

/**
 * Safe Stage 10 shadow boundary. A true deletion-capable incremental graph is not yet trusted,
 * so affected connectivity/DRC work uses the authoritative full fallback and says so explicitly.
 */
export function runDifferentialVerification(input: { board: PcbBoard; revision: ProjectRevision; changeSet: EngineeringChangeSet; rules: DrcRules; injectedIncremental?: { electrical?: unknown; drc?: unknown } }): DifferentialVerificationResult {
  const started = performance.now(); const electricalFull = canonicalElectricalTruth(computeElectricalTruth(input.board)); const drcFull = canonicalDrc(runDrc(input.board, input.rules));
  const electricalIncremental = input.injectedIncremental?.electrical ?? electricalFull; const drcIncremental = input.injectedIncremental?.drc ?? drcFull; const electricalFullDigest = engineeringDigest(electricalFull); const electricalIncrementalDigest = engineeringDigest(electricalIncremental); const drcFullDigest = engineeringDigest(drcFull); const drcIncrementalDigest = engineeringDigest(drcIncremental); const signatures: string[] = [];
  if (electricalFullDigest !== electricalIncrementalDigest) signatures.push(engineeringId("divergence:electrical", { expected: electricalFullDigest, actual: electricalIncrementalDigest, transaction: input.changeSet.transactionId })); if (drcFullDigest !== drcIncrementalDigest) signatures.push(engineeringId("divergence:drc", { expected: drcFullDigest, actual: drcIncrementalDigest, transaction: input.changeSet.transactionId }));
  return { verificationId: engineeringId("differential-verification", { revision: input.revision.canonicalStateDigest, transaction: input.changeSet.transactionId, electricalFullDigest, drcFullDigest }), revision: structuredClone(input.revision), mode: input.injectedIncremental ? "shadow" : "full_fallback", incrementalStrategy: "broad_full_fallback", electrical: { incrementalDigest: electricalIncrementalDigest, fullDigest: electricalFullDigest, equivalent: electricalFullDigest === electricalIncrementalDigest }, drc: { incrementalDigest: drcIncrementalDigest, fullDigest: drcFullDigest, equivalent: drcFullDigest === drcIncrementalDigest }, divergenceSignatures: signatures, fallbackUsed: !input.injectedIncremental, durationMs: performance.now() - started, objectsExamined: input.board.tracks.length + input.board.vias.length + input.board.zones.length + input.board.footprints.reduce((sum, footprint) => sum + footprint.def.pads.length, 0), changeSetTransactionId: input.changeSet.transactionId };
}
