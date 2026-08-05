import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { PcbBoard } from "../types";
import { computeElectricalTruth } from "../electrical-truth";
import type { DsnValidationReport } from "../dsn/preflight";
import type { SesResult } from "../dsn/read-ses";
import type { AutorouteVerification } from "./verification";
import type { AutorouteAttemptArtifact } from "./completion";
import type { ReadinessReport } from "../readiness/types";

export interface AutorouteDebugBundleInput {
  jobId: string;
  routeAttemptId: string;
  sourceRevision: string;
  candidateRevision: string;
  inputBoard: PcbBoard;
  candidateBoard: PcbBoard;
  dsnText: string;
  sesText: string;
  freeroutingLog: string;
  validation: DsnValidationReport;
  parsed: SesResult;
  verification: AutorouteVerification;
  readiness: ReadinessReport;
  elapsedMs: number;
  attempts: AutorouteAttemptArtifact[];
}

const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function connectivitySummary(board: PcbBoard): unknown {
  const report = computeElectricalTruth(board);
  return {
    schemaVersion: report.schemaVersion,
    designRevision: report.designRevision,
    intended: report.intended,
    assigned: report.assigned,
    realized: {
      state: report.realized.state,
      requiredConnections: report.realized.requiredConnections,
      completedConnections: report.realized.completedConnections,
      remainingConnections: report.realized.remainingConnections,
      airwires: report.realized.airwires,
    },
    nets: report.nets,
    shorts: report.shorts,
    orphanCopper: report.orphanCopper,
    unresolved: report.unresolved,
  };
}

/** Writes a self-contained local diagnostic bundle. It never includes environment variables or API keys. */
export async function writeAutorouteDebugBundle(input: AutorouteDebugBundleInput): Promise<string> {
  const directory = join(tmpdir(), "sirkit-autoroute", input.jobId);
  await mkdir(directory, { recursive: true });
  const importMapping = {
    tracks: input.parsed.tracks.map((track) => ({ id: track.id, netId: track.netId, layer: track.layer })),
    vias: input.parsed.vias.map((via) => ({ id: via.id, netId: via.netId, layers: via.layers })),
    unknownLayers: input.parsed.unknownLayers,
    errors: input.parsed.errors,
  };
  const attempts = input.attempts.map((attempt) => ({
    routeAttemptId: attempt.routeAttemptId,
    reportedRouteAttemptId: attempt.reportedRouteAttemptId,
    pass: attempt.pass,
    sourceRevision: attempt.sourceRevision,
    reportedSourceRevision: attempt.reportedSourceRevision,
    candidateRevision: attempt.candidateRevision,
    phase: attempt.phase,
    targetNetIds: attempt.targetNetIds,
    effort: attempt.effort,
    engineMaxPasses: attempt.engineMaxPasses,
    evidence: attempt.evidence,
    connectivityBefore: attempt.connectivityBefore,
    connectivityAfter: attempt.connectivityAfter,
    drcBefore: attempt.drcBefore,
    drcAfter: attempt.drcAfter,
    decision: attempt.decision,
    rejectionReasons: attempt.rejectionReasons,
    returnedCandidate: attempt.returnedCandidate,
    elapsedMs: attempt.elapsedMs,
  }));
  await Promise.all([
    writeFile(join(directory, "attempt-manifest.json"), pretty({
      schemaVersion: "sirkit.autoroute-attempt.v2",
      jobId: input.jobId,
      routeAttemptId: input.routeAttemptId,
      sourceRevision: input.sourceRevision,
      candidateRevision: input.candidateRevision,
      accepted: true,
      returnedCandidate: true,
      attempts,
    }), "utf8"),
    writeFile(join(directory, "input-board.json"), pretty(input.inputBoard), "utf8"),
    writeFile(join(directory, "input-board.dsn"), input.dsnText, "utf8"),
    writeFile(join(directory, "freerouting-output.ses"), input.sesText, "utf8"),
    writeFile(join(directory, "freerouting.log"), input.freeroutingLog, "utf8"),
    writeFile(join(directory, "dsn-validation.json"), pretty(input.validation), "utf8"),
    writeFile(join(directory, "import-mapping.json"), pretty(importMapping), "utf8"),
    writeFile(join(directory, "route-stats.json"), pretty({ elapsedMs: input.elapsedMs, layerUsage: input.parsed.layerUsage }), "utf8"),
    writeFile(join(directory, "connectivity-before.json"), pretty(connectivitySummary(input.inputBoard)), "utf8"),
    writeFile(join(directory, "connectivity-after.json"), pretty(connectivitySummary(input.candidateBoard)), "utf8"),
    writeFile(join(directory, "drc-after.json"), pretty(input.verification.violations), "utf8"),
    writeFile(join(directory, "autoroute-summary.json"), pretty(input.verification), "utf8"),
    writeFile(join(directory, "pcb-fabrication-readiness.json"), pretty(input.readiness), "utf8"),
  ]);
  return directory;
}
