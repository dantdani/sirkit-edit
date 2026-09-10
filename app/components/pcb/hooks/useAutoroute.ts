/** One-click bounded multilayer FreeRouting completion.
 *
 * [B17-E] `run()` no longer commits: it produces the SHARED routing candidate
 * (`sirkit.layout-candidate.v1`, scoped to the requested nets when the caller
 * names them) and registers it in the editor's candidate store — a ghost of
 * its copper is previewed, the board stays unchanged — and `apply()` commits
 * it through `applyLayoutCandidate`: ONE canonical transaction with the
 * exact base revision + lifecycle generation re-checked at serialized
 * execution time and locked copper preserved. `discard()` retires it.
 */

import { projectSelectorHeaders, type ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { PcbBoardLifecycleScope } from "@/app/lib/pcb/lifecycle/board-lifecycle";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import type { SesLayerUsage } from "@/app/lib/pcb/dsn/read-ses";
import { buildAutorouteImportCommand } from "@/app/lib/pcb/autoroute/command";
import { applyRouteCommand } from "@/app/lib/pcb/route-tool.commands";
import { computeElectricalTruth } from "@/app/lib/pcb/electrical-truth";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import type { DrcRules } from "@/app/lib/pcb/drc/types";
import type { LayerId } from "@/app/lib/pcb/layers";
import type { AutoroutePassReport, AutorouteUnresolvedConnection } from "@/app/lib/pcb/autoroute/completion";
import { applyLayoutCandidate, produceRoutingCandidate, type AutorouteResponseLike, type LayoutCandidateStore, type RoutingLayoutCandidate } from "@/app/lib/pcb/candidates/layout-candidate";
import { pcbRevisionId } from "@/app/lib/pcb/ai/snapshot";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import type { DrcPresetId } from "@/app/lib/pcb/drc/types";
import type { ReadinessReport } from "@/app/lib/pcb/readiness/types";

export interface AutorouteEditor {
  getHistory: () => PcbHistory | null;
  /** B08.2 — capture THE board lifecycle scope at submission: every side
   *  effect (progress, results, errors, toasts, commit submission) verifies
   *  it after every await; the scope's signal aborts the in-flight fetch on
   *  lifecycle replacement. Absent (tests without an owner) → unscoped. */
  captureLifecycle?: () => PcbBoardLifecycleScope;
  toast?: (message: string) => void;
  getDrcRules?: () => DrcRules;
  getNetlist?: () => PcbNetlist | null;
  getDrcPresetId?: () => DrcPresetId;
  /** [B16.0.2 §B] the active project identity — sent as a SELECTOR only; the
   *  autoroute route is authenticated + project-scoped on the server. */
  getScope?: () => ProjectSelectorScope | null;
  /** [B17-E] the editor's shared candidate store and lifecycle generation. */
  candidates?: LayoutCandidateStore;
  getGeneration?: () => number | undefined;
}

export type AutorouteState = "idle" | "queued" | "running" | "preview" | "complete" | "partial" | "failed" | "cancelled";

export interface AutorouteResult {
  status: "complete" | "partial";
  /** [B17-E] `preview` = the candidate's projected board (unchanged until Apply); `applied` = the committed board. */
  phase: "preview" | "applied";
  scope: { netIds: number[] | "all" };
  tracksImported: number;
  viasImported: number;
  routedNets: number;
  totalNets: number;
  drcErrors?: number;
  requiredConnections: number;
  completedConnections: number;
  remainingConnections: number;
  layerUsage: Partial<Record<LayerId, SesLayerUsage>>;
  passCount: number;
  acceptedPasses: number;
  failures: AutorouteUnresolvedConnection[];
  passReports: AutoroutePassReport[];
  debugDirectory?: string;
  fabricationReadiness: ReadinessReport;
}

export interface AutorouteRunScope {
  /** Route only these nets (a reroute of the selection); absent = the whole board. */
  netIds?: number[];
}

export interface AutorouteHandle {
  state: AutorouteState;
  elapsedMs: number;
  lastResult?: AutorouteResult;
  /** [B17-E] the routing candidate awaiting Apply / Discard (registered in the store). */
  candidate?: RoutingLayoutCandidate;
  lastError?: string;
  run(scope?: AutorouteRunScope): Promise<void>;
  apply(candidateId?: string): Promise<void>;
  discard(candidateId?: string): void;
  cancel(): void;
  /** B08.2 — lifecycle replacement: abort the in-flight request, discard
   *  results/errors, and release the NEW generation from the old busy flag.
   *  Silent (never toasts) — the replacement is not a user cancellation. */
  invalidate(): void;
}

interface AutorouteApiResponse extends AutorouteResponseLike {
  error?: string;
  stats?: { elapsedMs?: number; tracksImported?: number; viasImported?: number; layerUsage?: Partial<Record<LayerId, SesLayerUsage>> };
  debugDirectory?: string;
}

export function useAutoroute(editor: AutorouteEditor): AutorouteHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });
  const [state, setState] = useState<AutorouteState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastResult, setLastResult] = useState<AutorouteResult>();
  const [candidate, setCandidate] = useState<RoutingLayoutCandidate>();
  const [lastError, setLastError] = useState<string>();
  // B08.2 — request-keyed busy ownership: `active` names the EXACT run that
  // owns the busy flag and whether its generation is still current. A run
  // whose generation ended no longer blocks a fresh-generation run, and a
  // stale run's finalizer can never release a newer run's flag.
  const activeRef = useRef<{ requestId: string; isCurrent: () => boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const responseMetaRef = useRef<{ layerUsage: Partial<Record<LayerId, SesLayerUsage>>; debugDirectory?: string; engine: string }>({ layerUsage: {}, engine: "" });

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const toast = (message: string): void => editorRef.current.toast?.(message);

  const cancel = useCallback(() => {
    if (!activeRef.current) return;
    abortRef.current?.abort();
    abortRef.current = null;
    activeRef.current = null;
    setState("cancelled");
    toast("Autoroute cancelled; board unchanged");
  }, []);

  const invalidate = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeRef.current = null;
    setState("idle");
    setElapsedMs(0);
    setLastResult(undefined);
    setCandidate(undefined);
    setLastError(undefined);
  }, []);

  /** The routed board's truth (electrical + DRC) for a summary — of the projection during preview, of the committed board after apply. */
  const summarize = (board: PcbBoard, routing: RoutingLayoutCandidate, phase: AutorouteResult["phase"]): AutorouteResult => {
    const electricalTruth = computeElectricalTruth(board);
    const drcRules = editorRef.current.getDrcRules?.();
    const drcErrors = drcRules ? runDrc(board, drcRules).violations.filter((violation) => violation.severity === "error").length : undefined;
    const remainingConnections = electricalTruth.realized.remainingConnections;
    return {
      status: routing.completion.status === "complete" && remainingConnections === 0 ? "complete" : "partial",
      phase,
      scope: routing.scope,
      tracksImported: routing.stats.tracks,
      viasImported: routing.stats.vias,
      routedNets: electricalTruth.realized.routedNets,
      totalNets: electricalTruth.realized.totalNets,
      drcErrors,
      requiredConnections: electricalTruth.realized.requiredConnections,
      completedConnections: electricalTruth.realized.completedConnections,
      remainingConnections,
      layerUsage: responseMetaRef.current.layerUsage,
      passCount: routing.completion.passCount,
      acceptedPasses: routing.completion.acceptedPasses,
      failures: routing.completion.failures,
      passReports: routing.completion.passReports,
      debugDirectory: responseMetaRef.current.debugDirectory,
      fabricationReadiness: routing.readiness as ReadinessReport,
    };
  };

  const run = useCallback(async (scopeInput?: AutorouteRunScope): Promise<void> => {
    // Busy only while the owning run's GENERATION is still current — a
    // lifecycle replacement releases the new generation immediately.
    if (activeRef.current?.isCurrent()) return;
    // B08.2 — the lifecycle scope is captured at SUBMISSION and verified
    // after every await; generation (never the digest pin alone) decides
    // staleness, so a same-digest checkpoint restore still invalidates.
    const scope = editorRef.current.captureLifecycle?.() ?? null;
    const owned = (): boolean => scope === null || scope.isCurrent();
    const requestId = scope?.requestId ?? `autoroute-local-${++requestSeqRef.current}`;
    const board: PcbBoard = editorRef.current.getHistory()?.present ?? createEmptyBoard();
    const baseRevision = pcbRevisionId(board);
    const netIds = scopeInput?.netIds && scopeInput.netIds.length > 0 ? [...new Set(scopeInput.netIds)].sort((a, b) => a - b) : undefined;
    activeRef.current = { requestId, isCurrent: owned };
    setState("queued");
    setLastError(undefined);
    setElapsedMs(0);
    const startedAt = Date.now();
    const elapsedTimer = setInterval(() => {
      if (owned()) setElapsedMs(Date.now() - startedAt);
    }, 250);
    const controller = new AbortController();
    abortRef.current = controller;
    const onLifecycleAbort = (): void => controller.abort();
    scope?.signal.addEventListener("abort", onLifecycleAbort, { once: true });

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!owned()) return;
      setState("running");
      const response = await fetch("/api/pcb/autoroute", {
        method: "POST",
        headers: { "content-type": "application/json", ...projectSelectorHeaders(editorRef.current.getScope?.() ?? null) },
        body: JSON.stringify({
          board,
          netlist: editorRef.current.getNetlist?.() ?? undefined,
          fabPresetId: editorRef.current.getDrcPresetId?.(),
          // [B17-E] the server refuses a mismatched base (409) and routes only the requested nets.
          sourceRevision: baseRevision,
          ...(netIds ? { netIds } : {}),
        }),
        signal: controller.signal,
      });
      const body = await response.json() as AutorouteApiResponse;
      if (!owned()) return; // stale: the candidate is discarded silently
      if (!response.ok || !body.ok || !body.routes) {
        throw new Error(body.error ?? `Autoroute failed (${response.status})`);
      }
      if (!body.readiness) throw new Error("Autoroute response is missing the authoritative fabrication-readiness report.");
      const history = editorRef.current.getHistory();
      if (!history) throw new Error("No board to apply routes to");
      if (pcbRevisionId(history.present) !== baseRevision) {
        throw new Error("Board changed while autorouting; the stale route candidate was discarded.");
      }
      // [B17-E] the shared candidate — pinned to the base revision and the lifecycle generation, scoped to the request.
      const produced = produceRoutingCandidate({ board: history.present, response: body, producer: "editor", netIds, generation: editorRef.current.getGeneration?.() });
      if ("ok" in produced) throw new Error(produced.message);
      responseMetaRef.current = { layerUsage: body.stats?.layerUsage ?? {}, debugDirectory: body.debugDirectory, engine: body.engine?.version ? `Freerouting ${body.engine.version} local · ` : "" };
      // The projection the candidate would produce: the summary (and readiness) the user reviews before Apply.
      const projected = applyRouteCommand(history.present, buildAutorouteImportCommand(history.present, produced.routes));
      if (produced.candidateRevision && pcbRevisionId(projected) !== produced.candidateRevision) {
        throw new Error("Autoroute candidate provenance check failed; board was left unchanged.");
      }
      editorRef.current.candidates?.register(produced);
      const result = summarize(projected, produced, "preview");
      if (!owned()) return;
      setCandidate(produced);
      setLastResult(result);
      setState("preview");
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      const scopeLabel = netIds ? `${netIds.length} selected net${netIds.length === 1 ? "" : "s"}` : "board";
      toast(`${responseMetaRef.current.engine}Routing candidate ready for the ${scopeLabel} — ${result.completedConnections}/${result.requiredConnections} connections would be completed · ${result.tracksImported} tracks · ${result.acceptedPasses}/${result.passCount} passes in ${seconds}s. Review the ghost and apply explicitly.`);
    } catch (error) {
      if (controller.signal.aborted) return; // user cancel or lifecycle abort
      if (!owned()) return; // stale generation: errors belong to nobody
      const raw = error instanceof Error ? error.message : String(error);
      const message = raw === "jar-missing"
        ? "Local Freerouting is not installed — run npm run setup:freerouting (no API key required)"
        : raw === "java-missing"
          ? "Freerouting's local Java runtime is missing — run npm run setup:freerouting"
          : raw;
      setLastError(message);
      setState("failed");
      toast(`Autoroute failed: ${message}`);
    } finally {
      clearInterval(elapsedTimer);
      scope?.signal.removeEventListener("abort", onLifecycleAbort);
      // Request-keyed release: only THIS run may clear its own ownership.
      if (activeRef.current?.requestId === requestId) activeRef.current = null;
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const resolveCandidate = (candidateId?: string): RoutingLayoutCandidate | undefined => {
    if (candidateId) {
      const found = editorRef.current.candidates?.get(candidateId);
      return found?.kind === "routing" ? found : undefined;
    }
    return candidate;
  };

  const apply = useCallback(async (candidateId?: string): Promise<void> => {
    const pending = resolveCandidate(candidateId);
    const history = editorRef.current.getHistory();
    if (!pending || !history) return;
    const applyScope = editorRef.current.captureLifecycle?.() ?? null;
    const applyOwned = (): boolean => applyScope === null || applyScope.isCurrent();
    // [B17-E] ONE canonical transaction through the shared apply path (base revision, generation, scope, provenance re-checked).
    const commit = await applyLayoutCandidate({ history, candidate: pending, actorId: "user:pcb-editor", actor: "autorouter", generation: editorRef.current.getGeneration?.() });
    if (!applyOwned()) return;
    if (!commit.ok) {
      if ("code" in commit && (commit.code === "STALE_REVISION" || commit.code === "STALE_GENERATION" || commit.code === "EXPIRED")) {
        editorRef.current.candidates?.retire(pending.candidateId, "stale");
        if (!candidateId || pending.candidateId === candidate?.candidateId) setCandidate(undefined);
      }
      setLastError(commit.message);
      setState("failed");
      toast(`Autoroute apply rejected: ${commit.message}`);
      return;
    }
    editorRef.current.candidates?.retire(pending.candidateId, "applied");
    const result = summarize(history.present, pending, "applied");
    setCandidate(undefined);
    setLastResult(result);
    setState(result.status);
    const drcChip = result.drcErrors === undefined ? "" : ` · DRC: ${result.drcErrors} error${result.drcErrors === 1 ? "" : "s"}`;
    if (result.status === "complete") {
      toast(`Autoroute applied — ${result.completedConnections}/${result.requiredConnections} connections completed · 0 unrouted · ${result.passCount} pass${result.passCount === 1 ? "" : "es"}${drcChip}`);
    } else {
      const blocker = result.failures[0]?.primaryBlockers[0] ? ` · ${result.failures[0].primaryBlockers[0]}` : "";
      toast(`Autoroute applied (partial) — ${result.completedConnections}/${result.requiredConnections} connections completed · ${result.remainingConnections} remain${blocker}${drcChip}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

  const discard = useCallback((candidateId?: string): void => {
    const pending = resolveCandidate(candidateId);
    if (pending) editorRef.current.candidates?.retire(pending.candidateId, "discarded");
    if (!candidateId || pending?.candidateId === candidate?.candidateId) {
      setCandidate(undefined);
      setLastResult(undefined);
      setState("idle");
    }
    toast("Routing candidate discarded; board unchanged.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

  return { state, elapsedMs, lastResult, candidate, lastError, run, apply, discard, cancel, invalidate };
}
