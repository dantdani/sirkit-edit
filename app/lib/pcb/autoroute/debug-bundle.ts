import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { PcbBoard } from "../types";
import { computeConnectivity } from "../connectivity-board";
import type { DsnValidationReport } from "../dsn/preflight";
import type { SesResult } from "../dsn/read-ses";
import type { AutorouteVerification } from "./verification";

export interface AutorouteDebugBundleInput {
  jobId: string;
  inputBoard: PcbBoard;
  candidateBoard: PcbBoard;
  dsnText: string;
  sesText: string;
  freeroutingLog: string;
  validation: DsnValidationReport;
  parsed: SesResult;
  verification: AutorouteVerification;
  elapsedMs: number;
}

const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function connectivitySummary(board: PcbBoard): unknown {
  const connectivity = computeConnectivity(board);
  return {
    completion: connectivity.completion,
    airwires: connectivity.airwires,
    shorts: connectivity.shorts,
    orphans: connectivity.orphans,
    nets: [...connectivity.nets.values()],
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
  await Promise.all([
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
  ]);
  return directory;
}
