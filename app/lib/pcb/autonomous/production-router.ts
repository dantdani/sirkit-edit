/**
 * Production AutonomousRouteExecutor over the bundled local FreeRouting runtime.
 *
 * This is the real RC02 boundary used by autonomous placement/routing outside
 * the browser: DSN is generated and RC01-validated before the router launches,
 * the Java process/output-file/parser/semantic stages are reported separately,
 * and every SES import goes through the strict parser plus candidate
 * construction (protected copper preserved). The RC03 golden-board fixture
 * delegates here so tests exercise the exact production executor.
 */

import { completeAutoroute, type AutoroutePassExecutor } from "../autoroute/completion";
import { resolveFreeroutingRuntime } from "../autoroute/runtime";
import { runFreerouting } from "../autoroute/runner";
import { buildAutorouteCandidate } from "../autoroute/verification";
import { validateDsn } from "../dsn/preflight";
import { parseSes, SesImportError } from "../dsn/read-ses";
import { boardToDsn, writeDsn } from "../dsn/write-dsn";
import { pcbRevisionId } from "../revision";
import { stableHash } from "../smart-routing/hash";
import type { AutonomousRouteExecution, AutonomousRouteExecutor } from "./qualify-layout";

export interface AutonomousRouterOptions {
  /** Prefix for route attempt ids; candidate id is appended per execution. */
  attemptNamespacePrefix?: string;
  maxGlobalPasses?: number;
  maxSelectedNetRetries?: number;
  maxNoImprovementPasses?: number;
  baseEnginePasses?: number;
}

export async function createAutonomousRouteExecutor(
  options: AutonomousRouterOptions = {},
): Promise<AutonomousRouteExecutor> {
  const runtime = await resolveFreeroutingRuntime();
  if (!runtime.ok) throw new Error(`${runtime.error}: ${runtime.stderr}`);
  const prefix = options.attemptNamespacePrefix ?? "rc03";
  return async ({ board, candidateId, rules, timeoutMs, signal }): Promise<AutonomousRouteExecution> => {
    const executor: AutoroutePassExecutor = async (pass) => {
      const dsn = boardToDsn(pass.board, { includeNetIds: pass.targetNetIds });
      const validation = validateDsn(pass.board, dsn);
      const dsnText = writeDsn(dsn);
      const baseEvidence = { dsnDigest: `dsn-${stableHash(dsnText)}`, dsnSourceRevision: dsn.integrity?.sourceRevision, router: { engine: "Freerouting" as const, version: runtime.version, runtime: runtime.javaSource, commandProfile: "headless-offline-cli" as const, maxPasses: pass.engineMaxPasses, timeoutMs } };
      if (!validation.ok) return { ok: false, routeAttemptId: pass.routeAttemptId, authoritativeSourceRevision: pass.requestedSourceRevision, sourceRevision: dsn.integrity?.sourceRevision, phase: "file", error: "DSN preflight failed", elapsedMs: 0, validation, dsnText, evidence: { ...baseEvidence, processStatus: "not-started", outputFileStatus: "not-checked", parserStatus: "not-run", semanticStatus: "not-run" } };
      const routed = await runFreerouting({ dsnText, freeroutingJarPath: runtime.jarPath, javaPath: runtime.javaPath, maxPasses: pass.engineMaxPasses, timeoutMs, signal });
      if (!routed.ok) return { ok: false, routeAttemptId: pass.routeAttemptId, authoritativeSourceRevision: pass.requestedSourceRevision, sourceRevision: dsn.integrity?.sourceRevision, phase: routed.error === "output-empty" ? "file" : "process", error: routed.error, stderr: routed.stderr, elapsedMs: routed.elapsedMs, dsnText, validation, evidence: { ...baseEvidence, processStatus: routed.processStatus, outputFileStatus: routed.outputFileStatus, parserStatus: "not-run", semanticStatus: "not-run" } };
      try {
        const parsed = parseSes(routed.sesText, pass.board, { manifest: dsn.integrity, routeAttemptId: pass.routeAttemptId, sourceRevision: dsn.integrity?.sourceRevision });
        const candidate = buildAutorouteCandidate(pass.board, parsed);
        return { ok: true, routeAttemptId: pass.routeAttemptId, authoritativeSourceRevision: pass.requestedSourceRevision, sourceRevision: parsed.sourceRevision, candidateRevision: pcbRevisionId(candidate), phase: "candidate", candidate, sesText: routed.sesText, dsnText, stderr: routed.stderr, elapsedMs: routed.elapsedMs, layerUsage: parsed.layerUsage, validation, parsed, evidence: { ...baseEvidence, processStatus: routed.processStatus, outputFileStatus: routed.outputFileStatus, sesDigest: `ses-${stableHash(routed.sesText)}`, sesByteLength: routed.sesByteLength, parserStatus: "success", semanticStatus: "success", importedTrackCount: parsed.tracks.length, importedViaCount: parsed.vias.length } };
      } catch (error) {
        return { ok: false, routeAttemptId: pass.routeAttemptId, authoritativeSourceRevision: pass.requestedSourceRevision, sourceRevision: dsn.integrity?.sourceRevision, phase: "parse", error: error instanceof Error ? error.message : String(error), stderr: routed.stderr, elapsedMs: routed.elapsedMs, dsnText, sesText: routed.sesText, validation, parsed: error instanceof SesImportError ? error.result : undefined, evidence: { ...baseEvidence, processStatus: routed.processStatus, outputFileStatus: routed.outputFileStatus, sesDigest: `ses-${stableHash(routed.sesText)}`, sesByteLength: routed.sesByteLength, parserStatus: "rejected", semanticStatus: "rejected" } };
      }
    };
    const completion = await completeAutoroute(board, rules, executor, {
      attemptNamespace: `${prefix}-${candidateId}`,
      maxGlobalPasses: options.maxGlobalPasses ?? 3,
      maxSelectedNetRetries: options.maxSelectedNetRetries ?? 3,
      maxNoImprovementPasses: options.maxNoImprovementPasses ?? 2,
      baseEnginePasses: options.baseEnginePasses ?? 200,
    });
    return { sourceRevision: pcbRevisionId(board), completion };
  };
}
