"use client";

import { projectSelectorHeaders, withProjectSelectorQuery, type ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { throwAiResponseError, withAiBrain, type AiRequestOwnership } from "@/app/lib/ai-preferences";
import { preselectedOperationIndexes } from "@/app/lib/spice/ai-approval"; // [B22-A1] OD-150
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  AudioWaveform,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Copy,
  Download,
  FileArchive,
  FileJson,
  FileText,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  Layers3,
  Library,
  ListChecks,
  Loader2,
  Microscope,
  PanelBottom,
  Play,
  Plus,
  Redo2,
  Save,
  Search,
  Settings2,
  Sparkles,
  SquareFunction,
  Table2,
  TestTube2,
  Thermometer,
  Trash2,
  Undo2,
  Upload,
  Variable,
  WandSparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SchematicState } from "@/lib/schematic-types";
import { ensurePartLoaded, type CachedPart } from "@/app/lib/parts-cache";
import { SpiceWaveformPlot } from "./SpiceWaveformPlot";
import { createId, stableHash } from "@/app/lib/spice/identity";
import {
  applyAiProposal,
  createDefaultTest,
  createSimulationProject,
  duplicateTest,
  refreshDesignRevision,
  updateTest,
} from "@/app/lib/spice/project";
import {
  loadStudioLayout,
  loadStudioProject,
  loadStudioRuns,
  saveStudioLayout,
  saveStudioProject,
  saveStudioRuns,
  type StudioLayout,
} from "@/app/lib/spice/persistence";
import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import { buildSpiceReport, compareRunRecords, reportToHtml, reportToJson } from "@/app/lib/spice/report";
import { inferPinMap } from "@/app/lib/spice/models";
import { formatEngineering } from "@/app/lib/spice/units";
import type {
  AiStudioOperation,
  AiStudioProposal,
  Measurement,
  ModelBinding,
  ModelImportReport,
  NetlistBundle,
  ReadinessReport,
  RunBatchRecord,
  RunPlanEstimate,
  RunRecord,
  RunStatus,
  SimulationAnalysis,
  SimulationPartSnapshot,
  SimulationProject,
  SimulationTest,
  Specification,
} from "@/app/lib/spice/types";

type Workspace = StudioLayout["activeWorkspace"];
type SetupSection = "tests" | "models" | "variables" | "analyses" | "sweeps" | "corners" | "monte-carlo" | "signals" | "measurements" | "specifications" | "run-plans";

interface CompileResponse {
  readiness: ReadinessReport;
  netlist: NetlistBundle;
  irSummary: {
    nodes: number;
    devices: number;
    models: Array<{ id: string; name: string; version: string; status: string }>;
    analyses: Array<{ id: string; name: string; type: string }>;
    outputs: Array<{ id: string; label: string; expression: string }>;
    warnings: string[];
  };
}

interface ResultPane {
  id: string;
  title: string;
  signals: string[];
}

const WORKSPACES: Array<{ id: Workspace; label: string; icon: LucideIcon }> = [
  { id: "setup", label: "Simulation Setup", icon: Settings2 },
  { id: "runs", label: "Runs", icon: Activity },
  { id: "results", label: "Results", icon: AudioWaveform },
  { id: "models", label: "Models", icon: Library },
  { id: "reports", label: "Reports", icon: FileArchive },
];

const SECTIONS: Array<{ id: SetupSection; label: string; icon: LucideIcon }> = [
  { id: "tests", label: "Tests", icon: TestTube2 },
  { id: "models", label: "Model assignments", icon: Library },
  { id: "variables", label: "Variables", icon: Variable },
  { id: "analyses", label: "Analyses", icon: SquareFunction },
  { id: "sweeps", label: "Sweeps", icon: Braces },
  { id: "corners", label: "Corners", icon: Layers3 },
  { id: "monte-carlo", label: "Monte Carlo", icon: BarChart3 },
  { id: "signals", label: "Signals to save", icon: AudioWaveform },
  { id: "measurements", label: "Measurements", icon: Gauge },
  { id: "specifications", label: "Specifications", icon: ListChecks },
  { id: "run-plans", label: "Run plans", icon: Play },
];

const STATUS_STYLE: Record<RunStatus, string> = {
  queued: "text-zinc-400 bg-zinc-800",
  preparing: "text-sky-300 bg-sky-950",
  netlisting: "text-sky-300 bg-sky-950",
  validating: "text-indigo-300 bg-indigo-950",
  running: "text-amber-300 bg-amber-950",
  "post-processing": "text-purple-300 bg-purple-950",
  completed: "text-emerald-300 bg-emerald-950",
  failed: "text-red-300 bg-red-950",
  cancelled: "text-zinc-400 bg-zinc-900",
};

function partSnapshot(part: CachedPart): SimulationPartSnapshot {
  return { id: part.id, name: part.name, mpn: part.mpn, manufacturer: part.manufacturer, pins: part.pins };
}

function downloadText(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function countForSection(test: SimulationTest, project: SimulationProject, section: SetupSection): number {
  if (section === "tests") return project.tests.length;
  if (section === "models") return project.modelBindings.length;
  if (section === "variables") return test.variables.length;
  if (section === "analyses") return test.analyses.length;
  if (section === "sweeps") return test.sweeps.length;
  if (section === "corners") return test.cornerSets.reduce((sum, set) => sum + set.corners.length, 0);
  if (section === "monte-carlo") return test.monteCarlo?.enabled ? test.monteCarlo.samples : 0;
  if (section === "signals") return test.outputs.length;
  if (section === "measurements") return test.measurements.length;
  if (section === "specifications") return test.specifications.length;
  return project.runPlans.length;
}

function operationLabel(operation: AiStudioOperation): string {
  switch (operation.op) {
    case "create-test": return `Create test “${operation.test.name}”`;
    case "duplicate-test": return `Duplicate test as “${operation.name}”`;
    case "assign-model": return `Assign model ${operation.binding.modelId} to ${operation.binding.componentId}`;
    case "add-overlay-element": return `Add ${operation.element.kind} “${operation.element.name}”`;
    case "set-variable": return `Set ${operation.variable.name} = ${operation.variable.value}${operation.variable.unit}`;
    case "configure-analysis": return `Configure ${operation.analysis.type.toUpperCase()} “${operation.analysis.name}”`;
    case "configure-sweep": return `Sweep ${operation.sweep.variable}`;
    case "configure-corners": return `Add ${operation.cornerSet.corners.length} corners`;
    case "define-measurement": return `Measure ${operation.measurement.name}`;
    case "define-specification": return `Specify ${operation.specification.name}`;
    case "set-solver-profile": return `Use solver profile ${operation.profile.name}`;
    case "request-run": return `Run plan ${operation.runPlanId}`;
    case "propose-design-patch": return `Design patch: ${operation.description}`;
  }
}

export default function SpiceStudio({ schematic, legacyPanel, aiOwnership, projectScope = null }: {
  schematic: SchematicState;
  /** [B16.0.2 §B] the ACTIVE project identity from the page (selector only —
   *  never authority). Run/bundle/event/model routes are project-scoped on
   *  the server; without a scope those surfaces are unavailable. */
  projectScope?: ProjectSelectorScope | null;
  legacyPanel?: ReactNode;
  /** B07.5 (failure F) — capture the OWNER of an AI request at submission
   *  (the page passes its project-generation scope factory). Provider-
   *  failure events and retries carry this owner and refuse once it is
   *  stale; without it, requests fall back to component-lifetime ownership. */
  aiOwnership?: () => AiRequestOwnership;
}) {
  const schematicHash = useMemo(() => stableHash(schematic), [schematic]);
  const [project, setProject] = useState<SimulationProject>(() => refreshDesignRevision(loadStudioProject() ?? createSimulationProject(schematic), schematic));
  const projectRef = useRef(project);
  const [runs, setRuns] = useState<RunRecord[]>(() => loadStudioRuns());
  const runsRef = useRef(runs);
  const [layout, setLayout] = useState<StudioLayout>(() => loadStudioLayout());
  const [activeTestId, setActiveTestId] = useState(project.tests[0].id);
  const [section, setSection] = useState<SetupSection>("tests");
  const [parts, setParts] = useState<SimulationPartSnapshot[]>([]);
  const [compile, setCompile] = useState<CompileResponse | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [activeRunPlanId, setActiveRunPlanId] = useState(project.runPlans[0].id);
  const [activeBatch, setActiveBatch] = useState<RunBatchRecord | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);
  const [resultPanes, setResultPanes] = useState<ResultPane[]>([{ id: createId("pane"), title: "Primary", signals: [] }]);
  const [activePaneId, setActivePaneId] = useState<string>(resultPanes[0].id);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [modelImport, setModelImport] = useState<ModelImportReport | null>(null);
  const [modelImportBusy, setModelImportBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiQuestion, setAiQuestion] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AiStudioProposal | null>(null);
  const [approvedOps, setApprovedOps] = useState<Set<number>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  // B07.5 — component-lifetime half of AI request ownership: a response
  // (or provider-failure dispatch/retry) arriving after unmount is dead.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  const pastRef = useRef<SimulationProject[]>([]);
  const futureRef = useRef<SimulationProject[]>([]);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());

  const activeTest = project.tests.find((test) => test.id === activeTestId) ?? project.tests[0];
  const activePlan = project.runPlans.find((plan) => plan.id === activeRunPlanId) ?? project.runPlans[0];
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const comparisonRun = runs.find((run) => run.id === compareRunId) ?? null;
  const estimate = useMemo<RunPlanEstimate | null>(() => {
    try { return activePlan ? estimateRunPlan(project, activePlan.id) : null; } catch { return null; }
  }, [activePlan, project]);

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { runsRef.current = runs; }, [runs]);

  useEffect(() => {
    const timer = window.setTimeout(() => setProject((current) => refreshDesignRevision(current, schematic)), 0);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schematicHash]);

  useEffect(() => {
    const timer = setTimeout(() => saveStudioProject(project), 250);
    return () => clearTimeout(timer);
  }, [project]);
  useEffect(() => {
    const timer = setTimeout(() => saveStudioRuns(runs), 700);
    return () => clearTimeout(timer);
  }, [runs]);
  useEffect(() => { saveStudioLayout(layout); }, [layout]);

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set((schematic.kicadComponents ?? []).map((component) => component.partId))];
    void Promise.all(ids.map((id) => ensurePartLoaded(id).catch(() => null))).then((loaded) => {
      if (!cancelled) setParts(loaded.filter((part): part is CachedPart => Boolean(part)).map(partSnapshot));
    });
    return () => { cancelled = true; };
  }, [schematicHash, schematic.kicadComponents]);

  useEffect(() => {
    if (!activeTest) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCompiling(true);
      try {
        const analysisId = activeTest.analyses.find((analysis) => analysis.enabled)?.id;
        const response = await fetch("/api/spice/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, testId: activeTest.id, analysisId, parts }), signal: controller.signal });
        const data = await response.json() as { ok?: boolean; error?: string } & CompileResponse;
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Compilation failed");
        setCompile({ readiness: data.readiness, netlist: data.netlist, irSummary: data.irSummary });
        setCompileError(null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") { setCompileError(error instanceof Error ? error.message : String(error)); setCompile(null); }
      } finally { if (!controller.signal.aborted) setCompiling(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activeTest, parts, project]);

  useEffect(() => {
    if (!selectedRun || selectedRun.waveforms.length === 0) return;
    const timer = window.setTimeout(() => setResultPanes((panes) => panes.map((pane, index) => index === 0 && pane.signals.length === 0 ? { ...pane, signals: [selectedRun.waveforms[0].name] } : pane)), 0);
    return () => window.clearTimeout(timer);
  }, [selectedRun]);

  const commitProject = useCallback((next: SimulationProject) => {
    pastRef.current.push(projectRef.current);
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
    setHistoryState({ canUndo: true, canRedo: false });
    projectRef.current = next;
    setProject(next);
  }, []);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(projectRef.current);
    projectRef.current = previous;
    setProject(previous);
    setHistoryState({ canUndo: pastRef.current.length > 0, canRedo: true });
  }, []);
  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(projectRef.current);
    projectRef.current = next;
    setProject(next);
    setHistoryState({ canUndo: true, canRedo: futureRef.current.length > 0 });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((open) => !open); return; }
      if (editing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      if (event.key === "Escape") { setPaletteOpen(false); setAiOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, undo]);

  useEffect(() => () => { for (const source of eventSourcesRef.current.values()) source.close(); }, []);

  function mutateActiveTest(mutator: (test: SimulationTest) => void, reason: string) {
    commitProject(updateTest(projectRef.current, activeTest.id, mutator, reason));
  }

  function setWorkspace(workspace: Workspace) {
    setLayout((current) => ({ ...current, activeWorkspace: workspace }));
  }

  function mergeRun(run: RunRecord) {
    setRuns((current) => [run, ...current.filter((candidate) => candidate.id !== run.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setSelectedRunId((current) => current ?? run.id);
  }

  async function startRuns(runPlanId = activePlan.id, projectOverride = projectRef.current) {
    setAiError(null);
    const response = await fetch("/api/spice/runs", { method: "POST", headers: { "Content-Type": "application/json", ...projectSelectorHeaders(projectScope) }, body: JSON.stringify({ project: projectOverride, runPlanId, parts }) });
    const data = await response.json() as { ok?: boolean; error?: string; batch?: RunBatchRecord };
    if (!response.ok || !data.batch) throw new Error(data.error ?? "Could not start run plan");
    setActiveBatch(data.batch);
    const initial = await fetch(`/api/spice/runs?ids=${data.batch.runIds.join(",")}`, { headers: projectSelectorHeaders(projectScope) }).then((result) => result.json()) as { runs: RunRecord[] };
    initial.runs.forEach(mergeRun);
    for (const runId of data.batch.runIds) {
      // EventSource cannot set headers: the project SELECTOR travels as query
      // parameters (opaque ids only — never design data, never authority).
      const source = new EventSource(withProjectSelectorQuery(`/api/spice/runs/${runId}/events`, projectScope));
      eventSourcesRef.current.set(runId, source);
      source.addEventListener("run", (event) => {
        const run = JSON.parse((event as MessageEvent).data) as RunRecord;
        mergeRun(run);
        if (["completed", "failed", "cancelled"].includes(run.status)) { source.close(); eventSourcesRef.current.delete(runId); }
      });
      source.onerror = () => { source.close(); eventSourcesRef.current.delete(runId); };
    }
    setWorkspace("runs");
  }

  async function cancelRun(runId: string) {
    const response = await fetch(`/api/spice/runs/${runId}`, { method: "DELETE", headers: projectSelectorHeaders(projectScope) });
    const data = await response.json() as { run?: RunRecord };
    if (data.run) mergeRun(data.run);
  }

  async function importModel(file: File) {
    setModelImportBusy(true);
    try {
      const content = await file.text();
      const response = await fetch("/api/spice/models/import", { method: "POST", headers: { "Content-Type": "application/json", ...projectSelectorHeaders(projectScope) }, body: JSON.stringify({ fileName: file.name, content }) });
      const data = await response.json() as { ok?: boolean; error?: string; report?: ModelImportReport };
      if (!response.ok || !data.report) throw new Error(data.error ?? "Model import failed");
      setModelImport(data.report);
    } catch (error) { setAiError(error instanceof Error ? error.message : String(error)); }
    finally { setModelImportBusy(false); }
  }

  function addImportedModel() {
    if (!modelImport) return;
    const next = structuredClone(projectRef.current);
    next.modelAssets.push(modelImport.candidate);
    next.revision += 1; next.updatedAt = new Date().toISOString();
    commitProject(next); setModelImport(null);
  }

  async function smokeImportedModel() {
    if (!modelImport) return;
    setModelImportBusy(true);
    try {
      const response = await fetch("/api/spice/models/smoke-test", { method: "POST", headers: { "Content-Type": "application/json", ...projectSelectorHeaders(projectScope) }, body: JSON.stringify({ model: modelImport.candidate }) });
      const data = await response.json() as { ok?: boolean; error?: string; model?: ModelImportReport["candidate"]; check?: { message?: string } };
      if (data.model) setModelImport((current) => current ? { ...current, candidate: data.model! } : current);
      if (!response.ok || !data.ok) throw new Error(data.error ?? data.check?.message ?? "Model smoke test failed");
      setAiError(null);
    } catch (error) { setAiError(error instanceof Error ? error.message : String(error)); }
    finally { setModelImportBusy(false); }
  }

  async function askAi() {
    if (!aiInstruction.trim()) return;
    // B07.5 (failure F) — explicit request ownership captured at
    // SUBMISSION: the page's project generation (when provided) AND this
    // component's lifetime. throwAiResponseError dispatches no provider-
    // failure event and its retry refuses once this owner is stale, and no
    // response content (question/proposal/error) is applied to a stale
    // owner. The busy flag is component-lifetime (it guards this
    // component's own submission path).
    const pageOwner = aiOwnership?.();
    const ownership: AiRequestOwnership = { isCurrent: () => aliveRef.current && (pageOwner ? pageOwner.isCurrent() : true) };
    setAiBusy(true); setAiError(null); setAiQuestion(null); setProposal(null);
    try {
      const response = await fetch("/api/spice/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(withAiBrain({ instruction: aiInstruction, project, testId: activeTest.id, parts, runs: runs.slice(0, 12) })) });
      const data = await response.json() as { ok?: boolean; error?: string; question?: string; proposal?: AiStudioProposal };
      if (!response.ok) await throwAiResponseError(new Response(JSON.stringify(data), { status: response.status, headers: { "Content-Type": "application/json" } }), () => void askAi(), ownership);
      if (!ownership.isCurrent()) return;
      if (!data.ok) throw new Error(data.error ?? "AI setup failed");
      if (data.question) setAiQuestion(data.question);
      if (data.proposal) {
        setProposal(data.proposal);
        setApprovedOps(new Set(preselectedOperationIndexes(data.proposal))); // [B22-A1] OD-150: never a deck-reaching operation or a run request
      }
    } catch (error) { if (ownership.isCurrent()) setAiError(error instanceof Error ? error.message : String(error)); }
    finally { if (aliveRef.current) setAiBusy(false); }
  }

  async function applyProposal() {
    if (!proposal) return;
    const indexes = [...approvedOps];
    const next = applyAiProposal(projectRef.current, proposal, indexes);
    commitProject(next);
    const runRequests = proposal.operations.filter((entry, index): entry is { approval: "automatic" | "review" | "explicit"; operation: Extract<AiStudioOperation, { op: "request-run" }> } => indexes.includes(index) && entry.operation.op === "request-run");
    setProposal(null); setAiInstruction(""); setAiOpen(false);
    for (const request of runRequests) await startRuns(request.operation.runPlanId, next);
  }

  function togglePaneSignal(name: string) {
    setResultPanes((panes) => panes.map((pane) => pane.id === activePaneId ? { ...pane, signals: pane.signals.includes(name) ? pane.signals.filter((signal) => signal !== name) : [...pane.signals, name] } : pane));
  }

  function exportRunCsv(run: RunRecord) {
    const headers = [run.waveforms[0]?.xName ?? "index", ...run.waveforms.map((waveform) => waveform.name)];
    const count = Math.max(0, ...run.waveforms.map((waveform) => waveform.y.length));
    const rows = Array.from({ length: count }, (_, index) => [run.waveforms[0]?.x[index] ?? index, ...run.waveforms.map((waveform) => waveform.y[index] ?? "")].join(","));
    downloadText(`${run.id}.csv`, [headers.join(","), ...rows].join("\n"), "text/csv");
  }

  const commandActions = [
    ...WORKSPACES.map((workspace) => ({ id: `workspace:${workspace.id}`, label: `Open ${workspace.label}` })),
    { id: "run", label: "Run active plan" },
    { id: "ai", label: "Open AI setup engineer" },
    { id: "undo", label: "Undo setup change" },
    { id: "redo", label: "Redo setup change" },
    { id: "create-test", label: "Create test" },
  ].filter((action) => action.label.toLowerCase().includes(paletteQuery.toLowerCase()));

  function executeCommand(id: string) {
    if (id.startsWith("workspace:")) setWorkspace(id.slice("workspace:".length) as Workspace);
    else if (id === "run") void startRuns();
    else if (id === "ai") setAiOpen(true);
    else if (id === "undo") undo();
    else if (id === "redo") redo();
    else if (id === "create-test") {
      const next = structuredClone(projectRef.current);
      const test = createDefaultTest(next.activeDesignRevisionId);
      next.tests.push(test);
      next.revision++;
      commitProject(next);
      setActiveTestId(test.id);
    }
  }

  const running = runs.some((run) => !["completed", "failed", "cancelled"].includes(run.status));
  const readiness = compile?.readiness;

  return (
    <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex h-12 shrink-0 items-center border-b border-zinc-800 bg-zinc-950 px-3">
        <div className="mr-5 flex items-center gap-2"><div className="grid size-7 place-items-center rounded-md bg-teal-500/15 text-teal-300"><FlaskConical className="size-4" /></div><div><div className="text-xs font-semibold">SPICE Studio</div><div className="text-[9px] uppercase tracking-[0.2em] text-zinc-600">revision {project.revision}</div></div></div>
        <nav className="flex h-full items-center gap-1">
          {WORKSPACES.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setWorkspace(id)} className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition ${layout.activeWorkspace === id ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"}`}><Icon className="size-3.5" />{label}</button>)}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={undo} disabled={!historyState.canUndo} className="rounded p-2 text-zinc-500 hover:bg-zinc-900 hover:text-white disabled:opacity-30" title="Undo setup change"><Undo2 className="size-4" /></button>
          <button onClick={redo} disabled={!historyState.canRedo} className="rounded p-2 text-zinc-500 hover:bg-zinc-900 hover:text-white disabled:opacity-30" title="Redo setup change"><Redo2 className="size-4" /></button>
          <button onClick={() => setPaletteOpen(true)} className="ml-1 flex items-center gap-2 rounded-md border border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-200"><Search className="size-3.5" />Command <kbd className="rounded bg-zinc-800 px-1 text-[9px]">Ctrl K</kbd></button>
          <button onClick={() => setAiOpen(true)} className="ml-1 flex items-center gap-1.5 rounded-md bg-teal-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-teal-400"><Sparkles className="size-3.5" />AI setup</button>
        </div>
      </header>

      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/70 px-3 text-[11px]">
        <select value={activeRunPlanId} onChange={(event) => setActiveRunPlanId(event.target.value)} className="h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-zinc-200">{project.runPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>
        <span className={`flex items-center gap-1 ${readiness?.ready ? "text-emerald-400" : "text-amber-400"}`}>{compiling ? <Loader2 className="size-3 animate-spin" /> : readiness?.ready ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}{compiling ? "Checking readiness" : readiness ? readiness.ready ? "Ready" : `${readiness.blocking} blocking · ${readiness.warnings} warnings` : compileError ?? "Not checked"}</span>
        <span className="text-zinc-500">ngspice · {estimate?.totalRuns ?? 0} run{estimate?.totalRuns === 1 ? "" : "s"} · ~{estimate?.estimatedSeconds ?? 0}s · {formatEngineering(estimate?.estimatedOutputBytes ?? 0, "B")}</span>
        <span className="ml-auto text-zinc-600">Autosaved</span>
        {running ? <button onClick={() => runs.filter((run) => !["completed", "failed", "cancelled"].includes(run.status)).forEach((run) => void cancelRun(run.id))} className="flex h-7 items-center gap-1.5 rounded bg-red-500/15 px-3 text-red-300 hover:bg-red-500/25"><CircleStop className="size-3.5" />Stop</button>
          : <button onClick={() => void startRuns().catch((error) => setAiError(String(error)))} disabled={!readiness?.ready || !estimate?.totalRuns} className="flex h-7 items-center gap-1.5 rounded bg-teal-500 px-4 font-medium text-zinc-950 hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"><Play className="size-3.5 fill-current" />Run</button>}
      </div>

      <div className="min-h-0 flex-1">
        {layout.activeWorkspace === "setup" && <SetupWorkspace project={project} activeTest={activeTest} activeTestId={activeTestId} setActiveTestId={setActiveTestId} section={section} setSection={setSection} compile={compile} compiling={compiling} schematic={schematic} countFor={(sectionId) => countForSection(activeTest, project, sectionId)} mutateTest={mutateActiveTest} commitProject={commitProject} parts={parts} />}
        {layout.activeWorkspace === "runs" && <RunsWorkspace runs={runs} selectedRunId={selectedRun?.id ?? null} onSelect={(id) => { setSelectedRunId(id); setWorkspace("results"); }} onCancel={(id) => void cancelRun(id)} batch={activeBatch} />}
        {layout.activeWorkspace === "results" && <ResultsWorkspace run={selectedRun} runs={runs} compareRun={comparisonRun} compareRunId={compareRunId} setCompareRunId={setCompareRunId} panes={resultPanes} activePaneId={activePaneId} setActivePaneId={setActivePaneId} setPanes={setResultPanes} toggleSignal={togglePaneSignal} exportCsv={exportRunCsv} legacyPanel={legacyPanel} legacyOpen={legacyOpen} setLegacyOpen={setLegacyOpen} projectScope={projectScope} />}
        {layout.activeWorkspace === "models" && <ModelsWorkspace project={project} schematic={schematic} parts={parts} report={modelImport} busy={modelImportBusy} onFile={importModel} onSmoke={() => void smokeImportedModel()} onAdd={addImportedModel} onDismiss={() => setModelImport(null)} commitProject={commitProject} />}
        {layout.activeWorkspace === "reports" && <ReportsWorkspace project={project} runs={runs} />}
      </div>

      {aiOpen && <AiDrawer instruction={aiInstruction} setInstruction={setAiInstruction} busy={aiBusy} error={aiError} question={aiQuestion} proposal={proposal} approved={approvedOps} setApproved={setApprovedOps} onAsk={() => void askAi()} onApply={() => void applyProposal().catch((error) => setAiError(String(error)))} onClose={() => setAiOpen(false)} />}
      {paletteOpen && <div className="absolute inset-0 z-[80] flex justify-center bg-black/60 pt-[12vh]" onMouseDown={() => setPaletteOpen(false)}><div className="h-fit w-[520px] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center border-b border-zinc-800 px-3"><Search className="size-4 text-zinc-500" /><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Search simulation commands…" className="h-11 flex-1 bg-transparent px-3 text-sm outline-none" /><kbd className="text-[10px] text-zinc-600">ESC</kbd></div><div className="max-h-80 overflow-auto p-1">{commandActions.map((action) => <button key={action.id} onClick={() => { executeCommand(action.id); setPaletteOpen(false); setPaletteQuery(""); }} className="block w-full rounded px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white">{action.label}</button>)}</div></div></div>}
    </div>
  );
}

function SetupWorkspace(props: {
  project: SimulationProject;
  activeTest: SimulationTest;
  activeTestId: string;
  setActiveTestId(id: string): void;
  section: SetupSection;
  setSection(section: SetupSection): void;
  compile: CompileResponse | null;
  compiling: boolean;
  schematic: SchematicState;
  countFor(section: SetupSection): number;
  mutateTest(mutator: (test: SimulationTest) => void, reason: string): void;
  commitProject(project: SimulationProject): void;
  parts: SimulationPartSnapshot[];
}) {
  const { project, activeTest: test, section, compile, schematic } = props;
  return <div className="flex h-full min-h-0">
    <aside className="w-[268px] shrink-0 overflow-auto border-r border-zinc-800 bg-zinc-950 p-2">
      <div className="mb-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Testbench hierarchy</div>
      {SECTIONS.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => props.setSection(id)} className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${section === id ? "bg-teal-500/10 text-teal-300" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}><Icon className="size-3.5" /><span className="flex-1">{label}</span><span className="rounded bg-zinc-900 px-1.5 text-[9px] text-zinc-600">{props.countFor(id)}</span>{id === "tests" && <ChevronDown className="size-3" />}</button>)}
      <div className="my-2 border-t border-zinc-800" />
      {project.tests.map((candidate) => <button key={candidate.id} onClick={() => { props.setActiveTestId(candidate.id); props.setSection("tests"); }} className={`mb-1 flex w-full items-center gap-2 rounded border px-2 py-2 text-left text-[11px] ${candidate.id === props.activeTestId ? "border-teal-500/30 bg-teal-500/5 text-zinc-100" : "border-transparent text-zinc-500 hover:border-zinc-800"}`}><span className={`size-2 rounded-full ${candidate.enabled ? "bg-emerald-400" : "bg-zinc-700"}`} /><span className="min-w-0 flex-1 truncate">{candidate.name}</span><span className="text-[9px] text-zinc-700">r{candidate.revision}</span></button>)}
    </aside>
    <main className="min-w-0 flex-1 overflow-auto bg-zinc-950 p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-start justify-between"><div><div className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">{test.parentTestId ? "Inherited test" : "Simulation test"}</div><h2 className="mt-1 text-lg font-semibold">{test.name}</h2><p className="mt-1 text-xs text-zinc-500">{test.description ?? "Reusable non-destructive simulation scenario"}</p></div><span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-500">Design {test.baseDesignRevisionId.slice(0, 15)} · test r{test.revision}</span></div>
        <ReadinessSummary compile={compile} compiling={props.compiling} />
        <SchematicOverview schematic={schematic} test={test} />
        {compile && <div className="grid grid-cols-4 gap-2">{[["IR nodes", compile.irSummary.nodes], ["Devices", compile.irSummary.devices], ["Models", compile.irSummary.models.length], ["Outputs", compile.irSummary.outputs.length]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"><div className="text-[10px] uppercase text-zinc-600">{label}</div><div className="mt-1 text-xl font-semibold text-zinc-200">{value}</div></div>)}</div>}
        {compile?.readiness.issues.length ? <div className="space-y-2"><h3 className="text-xs font-semibold text-zinc-300">Readiness findings</h3>{compile.readiness.issues.map((issue) => <div key={issue.id} className={`rounded-lg border p-3 ${issue.severity === "error" ? "border-red-900/60 bg-red-950/20" : issue.severity === "warning" ? "border-amber-900/60 bg-amber-950/10" : "border-zinc-800"}`}><div className="flex gap-2"><AlertTriangle className={`mt-0.5 size-4 shrink-0 ${issue.severity === "error" ? "text-red-400" : "text-amber-400"}`} /><div><div className="text-xs font-medium">{issue.title}</div><p className="mt-1 text-[11px] text-zinc-400">{issue.message}</p><p className="mt-1 text-[10px] text-zinc-600">Why: {issue.why}</p>{issue.fixes.length > 0 && <div className="mt-2 flex gap-1">{issue.fixes.map((fix) => <span key={fix.label} className="rounded bg-zinc-800 px-2 py-1 text-[9px] text-zinc-400">{fix.kind}: {fix.label}</span>)}</div>}</div></div></div>)}</div> : null}
      </div>
    </main>
    <aside className="w-[320px] shrink-0 overflow-auto border-l border-zinc-800 bg-zinc-950 p-3"><SetupInspector {...props} /></aside>
  </div>;
}

function ReadinessSummary({ compile, compiling }: { compile: CompileResponse | null; compiling: boolean }) {
  if (compiling) return <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400"><Loader2 className="mr-2 size-4 animate-spin" />Recompiling canonical IR and readiness checks…</div>;
  if (!compile) return <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-300">Compilation is unavailable. Review the error in the run bar.</div>;
  const report = compile.readiness;
  return <div className={`flex items-center gap-3 rounded-lg border p-3 ${report.ready ? "border-emerald-900/50 bg-emerald-950/15" : "border-amber-900/50 bg-amber-950/15"}`}>{report.ready ? <CheckCircle2 className="size-5 text-emerald-400" /> : <AlertCircle className="size-5 text-amber-400" />}<div><div className="text-xs font-semibold">{report.ready ? "Ready for controlled execution" : "Readiness review required"}</div><div className="mt-0.5 text-[10px] text-zinc-500">{report.blocking} blocking · {report.warnings} warnings · checked {new Date(report.checkedAt).toLocaleTimeString()}</div></div></div>;
}

function SchematicOverview({ schematic, test }: { schematic: SchematicState; test: SimulationTest }) {
  const points = [
    ...schematic.components.map((component) => ({ x: component.x, y: component.y })),
    ...(schematic.kicadComponents ?? []).map((component) => ({ x: component.x, y: component.y })),
    ...schematic.wires.flatMap((wire) => wire.vertices),
  ];
  const minX = Math.min(0, ...points.map((point) => point.x)) - 50;
  const maxX = Math.max(500, ...points.map((point) => point.x)) + 50;
  const minY = Math.min(0, ...points.map((point) => point.y)) - 50;
  const maxY = Math.max(300, ...points.map((point) => point.y)) + 50;
  return <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0b0b0e]"><div className="flex items-center border-b border-zinc-800 px-3 py-2"><Microscope className="mr-2 size-3.5 text-teal-400" /><span className="text-xs font-medium">Production schematic + simulation overlay</span><span className="ml-auto text-[9px] text-zinc-600">overlay is non-destructive</span></div><svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="h-72 w-full bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px]">
    {schematic.wires.map((wire) => <polyline key={wire.id} points={wire.vertices.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#52525b" strokeWidth="2" />)}
    {schematic.components.map((component) => <g key={component.id} transform={`translate(${component.x} ${component.y})`}><rect x="-24" y="-14" width="48" height="28" rx="5" fill="#18181b" stroke="#14b8a6" strokeWidth="1.5" /><text y="-20" textAnchor="middle" fill="#a1a1aa" fontSize="10">{component.id}</text><text y="4" textAnchor="middle" fill="#e4e4e7" fontSize="8">{component.value}</text></g>)}
    {(schematic.kicadComponents ?? []).map((component) => <g key={component.id} transform={`translate(${component.x} ${component.y})`}><rect x="-30" y="-20" width="60" height="40" rx="4" fill="#172033" stroke="#60a5fa" strokeWidth="1.5" /><text y="-25" textAnchor="middle" fill="#93c5fd" fontSize="10">{component.refDes}</text><text y="4" textAnchor="middle" fill="#dbeafe" fontSize="8">{component.value.slice(0, 18)}</text></g>)}
    {(schematic.netLabels ?? []).map((label) => <g key={label.id} transform={`translate(${label.position.x} ${label.position.y})`}><circle r="4" fill="#f59e0b" /><text x="7" y="-5" fill="#fbbf24" fontSize="9">{label.name}</text></g>)}
  </svg>{test.overlay.elements.length > 0 && <div className="flex flex-wrap gap-2 border-t border-zinc-800 p-2">{test.overlay.elements.map((element) => <span key={element.id} className="rounded border border-dashed border-purple-500/50 bg-purple-500/10 px-2 py-1 text-[9px] text-purple-300">{element.kind} · {element.name}</span>)}</div>}</div>;
}

function SetupInspector(props: Parameters<typeof SetupWorkspace>[0]) {
  const { project, activeTest: test, section, mutateTest, commitProject } = props;
  const label = SECTIONS.find((item) => item.id === section)?.label ?? section;
  return <div><div className="mb-3 flex items-center gap-2 border-b border-zinc-800 pb-2"><SlidersIcon section={section} /><div><div className="text-xs font-semibold">{label}</div><div className="text-[9px] text-zinc-600">Basic controls · advanced fields disclosed</div></div></div>
    {section === "tests" && <div className="space-y-3"><Field label="Test name"><input value={test.name} onChange={(event) => mutateTest((draft) => { draft.name = event.target.value; }, "Rename test")} className="studio-input" /></Field><Field label="Description"><textarea value={test.description ?? ""} onChange={(event) => mutateTest((draft) => { draft.description = event.target.value; }, "Update test description")} className="studio-input min-h-20 resize-y" /></Field><Field label="Temperature"><div className="flex"><input type="number" value={test.environment.temperatureC} onChange={(event) => mutateTest((draft) => { draft.environment.temperatureC = Number(event.target.value); }, "Set temperature")} className="studio-input rounded-r-none" /><span className="grid place-items-center rounded-r border border-l-0 border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-500">°C</span></div></Field><button onClick={() => { const next = duplicateTest(project, test.id, `${test.name} copy`); commitProject(next); props.setActiveTestId(next.tests.at(-1)!.id); }} className="studio-button w-full"><Copy className="size-3.5" />Duplicate test</button></div>}
    {section === "variables" && <VariableInspector test={test} mutate={mutateTest} />}
    {section === "analyses" && <AnalysisInspector test={test} mutate={mutateTest} />}
    {section === "sweeps" && <SweepInspector test={test} mutate={mutateTest} />}
    {section === "corners" && <CornerInspector test={test} mutate={mutateTest} />}
    {section === "monte-carlo" && <MonteCarloInspector test={test} mutate={mutateTest} />}
    {section === "signals" && <OutputInspector test={test} mutate={mutateTest} />}
    {section === "measurements" && <MeasurementInspector test={test} mutate={mutateTest} />}
    {section === "specifications" && <SpecificationInspector test={test} mutate={mutateTest} />}
    {section === "run-plans" && <RunPlanInspector project={project} test={test} commit={commitProject} />}
    {section === "models" && <div className="space-y-2 text-[11px] text-zinc-500"><p>Model assignments are managed in the Models workspace, where pin maps and provenance remain visible.</p><button onClick={() => { /* parent nav remains accessible */ }} className="studio-button w-full"><Library className="size-3.5" />{project.modelBindings.length} assigned</button></div>}
  </div>;
}

function SlidersIcon({ section }: { section: SetupSection }) { const Icon = SECTIONS.find((item) => item.id === section)?.icon ?? Settings2; return <Icon className="size-4 text-teal-400" />; }
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="block"><span className="mb-1 flex items-center justify-between text-[10px] font-medium text-zinc-500">{label}{hint && <span className="font-normal text-zinc-700">{hint}</span>}</span>{children}</label>; }
function Empty({ children }: { children: ReactNode }) { return <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[10px] text-zinc-600">{children}</div>; }

function VariableInspector({ test, mutate }: { test: SimulationTest; mutate: (fn: (test: SimulationTest) => void, reason: string) => void }) {
  return <div className="space-y-2">{test.variables.map((variable) => <div key={variable.id} className="rounded border border-zinc-800 bg-zinc-900/40 p-2"><div className="flex gap-1"><input value={variable.name} onChange={(event) => mutate((draft) => { draft.variables.find((item) => item.id === variable.id)!.name = event.target.value; }, "Rename variable")} className="studio-input min-w-0 flex-1" /><input value={variable.value} onChange={(event) => mutate((draft) => { draft.variables.find((item) => item.id === variable.id)!.value = event.target.value; }, "Set variable value")} className="studio-input w-20" /><button onClick={() => mutate((draft) => { draft.variables = draft.variables.filter((item) => item.id !== variable.id); }, "Delete variable")} className="studio-icon"><Trash2 className="size-3" /></button></div><input value={variable.description ?? ""} onChange={(event) => mutate((draft) => { draft.variables.find((item) => item.id === variable.id)!.description = event.target.value; }, "Describe variable")} placeholder="Description" className="studio-input mt-1" /></div>)}{test.variables.length === 0 && <Empty>No design variables yet.</Empty>}<button onClick={() => mutate((draft) => { draft.variables.push({ id: createId("variable"), name: `VAR${draft.variables.length + 1}`, value: "1", unit: "", enabled: true }); }, "Add variable")} className="studio-button w-full"><Plus className="size-3.5" />Add variable</button></div>;
}

function AnalysisInspector({ test, mutate }: { test: SimulationTest; mutate: (fn: (test: SimulationTest) => void, reason: string) => void }) {
  function patch(id: string, value: Partial<SimulationAnalysis>) { mutate((draft) => { Object.assign(draft.analyses.find((item) => item.id === id)!, value); }, "Update analysis"); }
  return <div className="space-y-2">{test.analyses.map((analysis) => <details key={analysis.id} open className="rounded border border-zinc-800 bg-zinc-900/40"><summary className="flex cursor-pointer list-none items-center gap-2 p-2"><input type="checkbox" checked={analysis.enabled} onChange={(event) => patch(analysis.id, { enabled: event.target.checked })} onClick={(event) => event.stopPropagation()} /><span className="flex-1 text-xs">{analysis.name}</span><span className="rounded bg-zinc-800 px-1.5 text-[9px] uppercase text-teal-300">{analysis.type}</span></summary><div className="space-y-2 border-t border-zinc-800 p-2"><input value={analysis.name} onChange={(event) => patch(analysis.id, { name: event.target.value })} className="studio-input" />{analysis.type === "tran" && <><Field label="Output step"><input value={analysis.outputStep} onChange={(event) => patch(analysis.id, { outputStep: event.target.value } as Partial<SimulationAnalysis>)} className="studio-input" /></Field><Field label="Stop time"><input value={analysis.stopTime} onChange={(event) => patch(analysis.id, { stopTime: event.target.value } as Partial<SimulationAnalysis>)} className="studio-input" /></Field><Field label="Maximum solver step"><input value={analysis.maxStep ?? ""} onChange={(event) => patch(analysis.id, { maxStep: event.target.value } as Partial<SimulationAnalysis>)} className="studio-input" /></Field></>}{analysis.type === "ac" && <><Field label="Frequency range"><div className="flex gap-1"><input value={analysis.startFrequency} onChange={(event) => patch(analysis.id, { startFrequency: event.target.value } as Partial<SimulationAnalysis>)} className="studio-input" /><input value={analysis.stopFrequency} onChange={(event) => patch(analysis.id, { stopFrequency: event.target.value } as Partial<SimulationAnalysis>)} className="studio-input" /></div></Field><Field label="Points / scale"><div className="flex gap-1"><input type="number" value={analysis.points} onChange={(event) => patch(analysis.id, { points: Number(event.target.value) } as Partial<SimulationAnalysis>)} className="studio-input" /><select value={analysis.scale} onChange={(event) => patch(analysis.id, { scale: event.target.value as "dec" } as Partial<SimulationAnalysis>)} className="studio-input"><option>dec</option><option>oct</option><option>lin</option></select></div></Field></>}{analysis.type === "dc" && <><input value={analysis.source} onChange={(event) => patch(analysis.id, { source: event.target.value } as Partial<SimulationAnalysis>)} placeholder="Source, e.g. V1" className="studio-input" /><div className="grid grid-cols-3 gap-1"><input value={analysis.start} onChange={(event) => patch(analysis.id, { start: event.target.value } as Partial<SimulationAnalysis>)} className="studio-input" /><input value={analysis.stop} onChange={(event) => patch(analysis.id, { stop: event.target.value } as Partial<SimulationAnalysis>)} className="studio-input" /><input value={analysis.step} onChange={(event) => patch(analysis.id, { step: event.target.value } as Partial<SimulationAnalysis>)} className="studio-input" /></div></>}{analysis.type === "noise" && <><input value={analysis.output} onChange={(event) => patch(analysis.id, { output: event.target.value } as Partial<SimulationAnalysis>)} placeholder="Output: v(out)" className="studio-input" /><input value={analysis.inputSource} onChange={(event) => patch(analysis.id, { inputSource: event.target.value } as Partial<SimulationAnalysis>)} placeholder="Input source: V1" className="studio-input" /></>}<Field label="Advanced ngspice directives" hint="reviewed"><textarea value={(analysis.advancedDirectives ?? []).join("\n")} onChange={(event) => patch(analysis.id, { advancedDirectives: event.target.value.split(/\r?\n/).filter(Boolean) })} placeholder=".options …" className="studio-input min-h-16 font-mono text-[10px]" /></Field><button onClick={() => mutate((draft) => { draft.analyses = draft.analyses.filter((item) => item.id !== analysis.id); }, "Delete analysis")} className="studio-button w-full text-red-300"><Trash2 className="size-3" />Delete</button></div></details>)}<div className="grid grid-cols-3 gap-1">{(["op", "tran", "ac", "dc", "noise"] as const).map((type) => <button key={type} onClick={() => mutate((draft) => { draft.analyses.push(defaultAnalysis(type)); }, `Add ${type} analysis`)} className="studio-button justify-center uppercase">+ {type}</button>)}</div></div>;
}

function defaultAnalysis(type: "op" | "tran" | "ac" | "dc" | "noise"): SimulationAnalysis {
  const base = { id: createId("analysis"), name: `${type.toUpperCase()} analysis`, enabled: true };
  if (type === "op") return { ...base, type };
  if (type === "tran") return { ...base, type, outputStep: "1u", stopTime: "10m", maxStep: "1u" };
  if (type === "ac") return { ...base, type, scale: "dec", points: 100, startFrequency: "1Hz", stopFrequency: "10MegHz" };
  if (type === "dc") return { ...base, type, source: "V1", start: "0", stop: "5", step: "0.1" };
  return { ...base, type, output: "v(out)", inputSource: "V1", scale: "dec", points: 100, startFrequency: "1Hz", stopFrequency: "1MegHz" };
}

function SweepInspector({ test, mutate }: { test: SimulationTest; mutate: (fn: (test: SimulationTest) => void, reason: string) => void }) {
  return <div className="space-y-2">{test.sweeps.map((sweep) => <div key={sweep.id} className="rounded border border-zinc-800 p-2"><div className="flex items-center gap-1"><input type="checkbox" checked={sweep.enabled} onChange={(event) => mutate((draft) => { draft.sweeps.find((item) => item.id === sweep.id)!.enabled = event.target.checked; }, "Toggle sweep")} /><input value={sweep.variable} onChange={(event) => mutate((draft) => { draft.sweeps.find((item) => item.id === sweep.id)!.variable = event.target.value; }, "Change sweep variable")} className="studio-input flex-1" /><button onClick={() => mutate((draft) => { draft.sweeps = draft.sweeps.filter((item) => item.id !== sweep.id); }, "Delete sweep")} className="studio-icon"><Trash2 className="size-3" /></button></div><div className="mt-1 text-[9px] text-zinc-600">{sweep.definition.kind} · {sweep.definition.kind === "list" || sweep.definition.kind === "expression" ? sweep.definition.values.join(", ") : `${sweep.definition.start} → ${sweep.definition.stop}`}</div></div>)}{test.sweeps.length === 0 && <Empty>No parameter sweeps.</Empty>}<button onClick={() => mutate((draft) => { draft.sweeps.push({ id: createId("sweep"), name: "Parameter sweep", variable: draft.variables[0]?.name ?? "PARAM", definition: { kind: "list", values: ["0.9", "1", "1.1"] }, enabled: true }); }, "Add sweep")} className="studio-button w-full"><Plus className="size-3.5" />Add list sweep</button></div>;
}

function CornerInspector({ test, mutate }: { test: SimulationTest; mutate: (fn: (test: SimulationTest) => void, reason: string) => void }) {
  return <div className="space-y-2">{test.cornerSets.map((set) => <div key={set.id} className="rounded border border-zinc-800 p-2"><div className="text-xs font-medium">{set.name}</div>{set.corners.map((corner) => <div key={corner.id} className="mt-1 flex items-center gap-2 rounded bg-zinc-900 p-1.5 text-[10px]"><input type="checkbox" checked={corner.enabled} onChange={(event) => mutate((draft) => { draft.cornerSets.find((item) => item.id === set.id)!.corners.find((item) => item.id === corner.id)!.enabled = event.target.checked; }, "Toggle corner")} /><span className="flex-1">{corner.name}</span><span className="text-zinc-600">{corner.temperatureC ?? test.environment.temperatureC}°C</span></div>)}</div>)}{test.cornerSets.length === 0 && <Empty>No corner sets.</Empty>}<button onClick={() => mutate((draft) => { draft.cornerSets.push({ id: createId("cornerset"), name: "Temperature extremes", mode: "listed", enabled: true, corners: [{ id: createId("corner"), name: "Cold", variableValues: {}, modelSections: {}, temperatureC: -20, enabled: true }, { id: createId("corner"), name: "Typical", variableValues: {}, modelSections: {}, temperatureC: 27, enabled: true }, { id: createId("corner"), name: "Hot", variableValues: {}, modelSections: {}, temperatureC: 85, enabled: true }] }); }, "Add corner template")} className="studio-button w-full"><Thermometer className="size-3.5" />Add -20/27/85°C template</button></div>;
}

function MonteCarloInspector({ test, mutate }: { test: SimulationTest; mutate: (fn: (test: SimulationTest) => void, reason: string) => void }) {
  const mc = test.monteCarlo ?? { enabled: false, samples: 100, seed: 12345, method: "latin-hypercube" as const, includeNominal: true };
  return <div className="space-y-3"><label className="flex items-center gap-2 rounded border border-zinc-800 p-2 text-xs"><input type="checkbox" checked={mc.enabled} onChange={(event) => mutate((draft) => { draft.monteCarlo = { ...mc, enabled: event.target.checked }; }, "Toggle Monte Carlo")} /><span className="flex-1">Enable statistical study</span></label><Field label="Samples"><input type="number" min="1" max="100000" value={mc.samples} onChange={(event) => mutate((draft) => { draft.monteCarlo = { ...mc, samples: Number(event.target.value) }; }, "Set Monte Carlo samples")} className="studio-input" /></Field><Field label="Random seed"><input type="number" value={mc.seed} onChange={(event) => mutate((draft) => { draft.monteCarlo = { ...mc, seed: Number(event.target.value) }; }, "Set Monte Carlo seed")} className="studio-input" /></Field><Field label="Sampling"><select value={mc.method} onChange={(event) => mutate((draft) => { draft.monteCarlo = { ...mc, method: event.target.value as "random" | "latin-hypercube" }; }, "Set sampling method")} className="studio-input"><option value="latin-hypercube">Latin hypercube</option><option value="random">Random</option></select></Field><p className="text-[10px] text-zinc-600">Distributions live on design variables. Seeds and method are recorded in every immutable manifest.</p></div>;
}

function OutputInspector({ test, mutate }: { test: SimulationTest; mutate: (fn: (test: SimulationTest) => void, reason: string) => void }) {
  return <div className="space-y-2">{test.outputs.map((output) => <div key={output.id} className="flex gap-1"><input type="checkbox" checked={output.enabled} onChange={(event) => mutate((draft) => { draft.outputs.find((item) => item.id === output.id)!.enabled = event.target.checked; }, "Toggle output")} /><input value={output.expression} onChange={(event) => mutate((draft) => { draft.outputs.find((item) => item.id === output.id)!.expression = event.target.value; }, "Edit output expression")} className="studio-input min-w-0 flex-1 font-mono" /><button onClick={() => mutate((draft) => { draft.outputs = draft.outputs.filter((item) => item.id !== output.id); }, "Delete output")} className="studio-icon"><Trash2 className="size-3" /></button></div>)}<button onClick={() => mutate((draft) => { draft.outputs.push({ id: createId("output"), label: "Signal", expression: "v(out)", unit: "V", enabled: true }); }, "Add saved output")} className="studio-button w-full"><Plus className="size-3.5" />Add signal</button></div>;
}

function MeasurementInspector({ test, mutate }: { test: SimulationTest; mutate: (fn: (test: SimulationTest) => void, reason: string) => void }) {
  return <div className="space-y-2">{test.measurements.map((measurement) => <div key={measurement.id} className="rounded border border-zinc-800 p-2"><div className="flex items-center gap-1"><input value={measurement.name} onChange={(event) => mutate((draft) => { draft.measurements.find((item) => item.id === measurement.id)!.name = event.target.value; }, "Rename measurement")} className="studio-input flex-1" /><button onClick={() => mutate((draft) => { draft.measurements = draft.measurements.filter((item) => item.id !== measurement.id); }, "Delete measurement")} className="studio-icon"><Trash2 className="size-3" /></button></div><div className="mt-1 grid grid-cols-2 gap-1"><select value={measurement.operator} onChange={(event) => mutate((draft) => { draft.measurements.find((item) => item.id === measurement.id)!.operator = event.target.value as Measurement["operator"]; }, "Change measurement operator")} className="studio-input"><option value="max">max</option><option value="min">min</option><option value="average">average</option><option value="rms">RMS</option><option value="ripple">ripple</option><option value="rise-time">rise time</option><option value="settling-time">settling time</option><option value="phase-margin">phase margin</option><option value="gain-margin">gain margin</option><option value="average-power">average power</option><option value="thd">THD</option></select><input value={measurement.expression} onChange={(event) => mutate((draft) => { draft.measurements.find((item) => item.id === measurement.id)!.expression = event.target.value; }, "Edit measurement expression")} className="studio-input font-mono" /></div><div className="mt-1 flex gap-1"><input value={measurement.from ?? ""} onChange={(event) => mutate((draft) => { draft.measurements.find((item) => item.id === measurement.id)!.from = event.target.value || undefined; }, "Set measurement window")} placeholder="from" className="studio-input" /><input value={measurement.to ?? ""} onChange={(event) => mutate((draft) => { draft.measurements.find((item) => item.id === measurement.id)!.to = event.target.value || undefined; }, "Set measurement window")} placeholder="to" className="studio-input" /></div></div>)}{test.measurements.length === 0 && <Empty>No measurements.</Empty>}<button onClick={() => mutate((draft) => { draft.measurements.push({ id: createId("measurement"), name: "Output maximum", operator: "max", expression: "v(out)", unit: "V", enabled: true }); }, "Add measurement")} className="studio-button w-full"><Plus className="size-3.5" />Add measurement</button></div>;
}

function SpecificationInspector({ test, mutate }: { test: SimulationTest; mutate: (fn: (test: SimulationTest) => void, reason: string) => void }) {
  return <div className="space-y-2">{test.specifications.map((specification) => <div key={specification.id} className="rounded border border-zinc-800 p-2"><div className="flex gap-1"><input value={specification.name} onChange={(event) => mutate((draft) => { draft.specifications.find((item) => item.id === specification.id)!.name = event.target.value; }, "Rename specification")} className="studio-input min-w-0 flex-1" /><button onClick={() => mutate((draft) => { draft.specifications = draft.specifications.filter((item) => item.id !== specification.id); }, "Delete specification")} className="studio-icon"><Trash2 className="size-3" /></button></div><div className="mt-1 flex gap-1"><select value={specification.comparison} onChange={(event) => mutate((draft) => { draft.specifications.find((item) => item.id === specification.id)!.comparison = event.target.value as Specification["comparison"]; }, "Change specification comparison")} className="studio-input w-20"><option>&lt;=</option><option>&lt;</option><option>&gt;=</option><option>&gt;</option><option>between</option></select><input type="number" value={specification.limit} onChange={(event) => mutate((draft) => { draft.specifications.find((item) => item.id === specification.id)!.limit = Number(event.target.value); }, "Set specification limit")} className="studio-input" /><input value={specification.unit} onChange={(event) => mutate((draft) => { draft.specifications.find((item) => item.id === specification.id)!.unit = event.target.value; }, "Set specification unit")} className="studio-input w-16" /></div></div>)}{test.specifications.length === 0 && <Empty>Specifications turn measurements into an engineering datasheet.</Empty>}<button disabled={test.measurements.length === 0} onClick={() => mutate((draft) => { const measurement = draft.measurements[0]; draft.specifications.push({ id: createId("spec"), name: `${measurement.name} limit`, measurementId: measurement.id, comparison: "<=", limit: 1, unit: measurement.unit ?? "", severity: "error", applicableTestIds: [draft.id], enabled: true }); }, "Add specification")} className="studio-button w-full"><Plus className="size-3.5" />Add specification</button></div>;
}

function RunPlanInspector({ project, test, commit }: { project: SimulationProject; test: SimulationTest; commit: (project: SimulationProject) => void }) {
  return <div className="space-y-2">{project.runPlans.map((plan) => <div key={plan.id} className="rounded border border-zinc-800 p-2"><input value={plan.name} onChange={(event) => { const next = structuredClone(project); next.runPlans.find((item) => item.id === plan.id)!.name = event.target.value; commit(next); }} className="studio-input" /><label className="mt-2 flex items-center gap-2 text-[10px]"><input type="checkbox" checked={plan.testIds.includes(test.id)} onChange={(event) => { const next = structuredClone(project); const target = next.runPlans.find((item) => item.id === plan.id)!; target.testIds = event.target.checked ? [...new Set([...target.testIds, test.id])] : target.testIds.filter((id) => id !== test.id); commit(next); }} />Include active test</label><div className="mt-2 grid grid-cols-2 gap-1"><label className="text-[9px] text-zinc-600">Concurrency<input type="number" min="1" max="8" value={plan.concurrency} onChange={(event) => { const next = structuredClone(project); next.runPlans.find((item) => item.id === plan.id)!.concurrency = Number(event.target.value); commit(next); }} className="studio-input mt-1" /></label><label className="flex items-end gap-2 pb-2 text-[9px] text-zinc-500"><input type="checkbox" checked={plan.includeMonteCarlo} onChange={(event) => { const next = structuredClone(project); next.runPlans.find((item) => item.id === plan.id)!.includeMonteCarlo = event.target.checked; commit(next); }} />Monte Carlo</label></div></div>)}</div>;
}

function RunsWorkspace({ runs, selectedRunId, onSelect, onCancel, batch }: { runs: RunRecord[]; selectedRunId: string | null; onSelect(id: string): void; onCancel(id: string): void; batch: RunBatchRecord | null }) {
  return <div className="h-full overflow-auto p-5"><div className="mx-auto max-w-7xl"><div className="mb-5 flex items-end justify-between"><div><div className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">Simulation orchestrator</div><h2 className="mt-1 text-xl font-semibold">Run monitor</h2></div>{batch && <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs"><span className="text-zinc-500">Batch </span>{batch.completed}/{batch.total} completed · {batch.failed} failed</div>}</div>{runs.length === 0 ? <Empty>No runs yet. Execute the active plan from the persistent run bar.</Empty> : <div className="overflow-hidden rounded-xl border border-zinc-800"><table className="w-full text-left text-xs"><thead className="bg-zinc-900 text-[10px] uppercase text-zinc-600"><tr><th className="px-3 py-2">Run</th><th>Status</th><th>Progress</th><th>Started</th><th>Evidence</th><th /></tr></thead><tbody>{runs.map((run) => <tr key={run.id} onDoubleClick={() => onSelect(run.id)} className={`border-t border-zinc-800 hover:bg-zinc-900/60 ${run.id === selectedRunId ? "bg-teal-500/5" : ""}`}><td className="max-w-md px-3 py-3"><div className="truncate font-medium text-zinc-200">{run.label}</div><div className="mt-0.5 font-mono text-[9px] text-zinc-700">{run.id}</div></td><td><span className={`rounded px-2 py-1 text-[9px] font-medium ${STATUS_STYLE[run.status]}`}>{run.status}</span></td><td className="w-44"><div className="mr-4 h-1.5 rounded bg-zinc-800"><div className="h-full rounded bg-teal-500 transition-all" style={{ width: `${run.progress}%` }} /></div></td><td className="text-[10px] text-zinc-500">{new Date(run.createdAt).toLocaleTimeString()}</td><td className="text-[10px] text-zinc-500">{run.waveforms.length} traces · {run.scalars.length} scalar</td><td className="pr-3 text-right"><button onClick={() => onSelect(run.id)} className="studio-button">Open</button>{!["completed", "failed", "cancelled"].includes(run.status) && <button onClick={() => onCancel(run.id)} className="studio-icon ml-1 text-red-400"><CircleStop className="size-3.5" /></button>}</td></tr>)}</tbody></table></div>}</div></div>;
}

function ResultsWorkspace(props: { run: RunRecord | null; runs: RunRecord[]; compareRun: RunRecord | null; compareRunId: string | null; setCompareRunId(id: string | null): void; panes: ResultPane[]; activePaneId: string; setActivePaneId(id: string): void; setPanes(fn: (panes: ResultPane[]) => ResultPane[]): void; toggleSignal(name: string): void; exportCsv(run: RunRecord): void; legacyPanel?: ReactNode; legacyOpen: boolean; setLegacyOpen(open: boolean): void; projectScope: ProjectSelectorScope | null }) {
  const { run } = props;
  if (!run) return <div className="grid h-full place-items-center text-sm text-zinc-600">Run a test plan or choose a stored result.</div>;
  const comparison = props.compareRun ? compareRunRecords(run, props.compareRun) : null;
  return <div className="flex h-full min-h-0 flex-col"><div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-[11px]"><select value={run.id} disabled className="h-7 max-w-md rounded border border-zinc-700 bg-zinc-900 px-2"><option>{run.label}</option></select><GitCompareArrows className="ml-2 size-3.5 text-zinc-600" /><select value={props.compareRunId ?? ""} onChange={(event) => props.setCompareRunId(event.target.value || null)} className="h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-zinc-300"><option value="">Compare against…</option>{props.runs.filter((candidate) => candidate.id !== run.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select><button onClick={() => props.exportCsv(run)} className="studio-button ml-auto"><Download className="size-3.5" />CSV</button><button onClick={() => downloadText(`${run.id}.json`, JSON.stringify(run, null, 2), "application/json")} className="studio-button"><FileJson className="size-3.5" />JSON</button>{run.manifest && <a href={withProjectSelectorQuery(`/api/spice/runs/${run.id}/bundle`, props.projectScope)} className="studio-button"><FileArchive className="size-3.5" />Run bundle</a>}{props.legacyPanel && <button onClick={() => props.setLegacyOpen(!props.legacyOpen)} className="studio-button"><PanelBottom className="size-3.5" />Quick scope</button>}</div>
    {props.legacyOpen && props.legacyPanel ? <div className="relative min-h-0 flex-1">{props.legacyPanel}</div> : <div className="flex min-h-0 flex-1"><aside className="w-60 shrink-0 overflow-auto border-r border-zinc-800 p-2"><div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-600">Signals</div>{run.waveforms.map((waveform) => { const active = props.panes.find((pane) => pane.id === props.activePaneId)?.signals.includes(waveform.name); return <button key={waveform.id} onClick={() => props.toggleSignal(waveform.name)} className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${active ? "bg-teal-500/10 text-teal-300" : "text-zinc-400 hover:bg-zinc-900"}`}><span className="size-1.5 rounded-full bg-teal-400" /><span className="min-w-0 flex-1 truncate">{waveform.name}</span><span className="text-[9px] text-zinc-700">{waveform.unit}</span></button>})}<button onClick={() => { const pane = { id: createId("pane"), title: `Pane ${props.panes.length + 1}`, signals: [] }; props.setPanes((panes) => [...panes, pane]); props.setActivePaneId(pane.id); }} className="studio-button mt-2 w-full"><Plus className="size-3.5" />Add pane</button></aside><main className="min-w-0 flex-1 overflow-auto p-3"><div className="space-y-3">{props.panes.map((pane) => <div key={pane.id} onClick={() => props.setActivePaneId(pane.id)} className={props.activePaneId === pane.id ? "ring-1 ring-teal-500/60 rounded-lg" : ""}><SpiceWaveformPlot title={pane.title} series={run.waveforms.filter((waveform) => pane.signals.includes(waveform.name))} xScale={run.waveforms[0]?.xName.toLowerCase() === "frequency" ? "log" : "linear"} height={Math.max(260, Math.floor(520 / props.panes.length))} /></div>)}</div></main><aside className="w-80 shrink-0 overflow-auto border-l border-zinc-800 p-3"><div className="mb-3 flex items-center gap-2"><Table2 className="size-4 text-teal-400" /><div className="text-xs font-semibold">Measurements & specifications</div></div>{run.scalars.length === 0 ? <Empty>No scalar results for this run.</Empty> : <div className="space-y-1">{run.scalars.map((scalar) => <div key={scalar.id} className="rounded border border-zinc-800 p-2"><div className="flex items-center"><span className="min-w-0 flex-1 truncate text-[11px]">{scalar.name}</span><span className={`rounded px-1.5 py-0.5 text-[8px] uppercase ${scalar.status === "pass" ? "bg-emerald-950 text-emerald-300" : scalar.status === "fail" || scalar.status === "error" ? "bg-red-950 text-red-300" : scalar.status === "warning" ? "bg-amber-950 text-amber-300" : "bg-zinc-800 text-zinc-500"}`}>{scalar.status}</span></div><div className="mt-1 font-mono text-sm text-zinc-200">{scalar.value === undefined ? "—" : formatEngineering(scalar.value, scalar.unit ?? "", 7)}</div>{scalar.message && <div className="mt-1 text-[9px] text-zinc-600">{scalar.message}</div>}</div>)}</div>}{comparison && <div className="mt-4 rounded border border-zinc-800 p-2"><div className="text-[10px] font-semibold uppercase text-zinc-500">Comparison · {comparison.status}</div>{comparison.scalarChanges.slice(0, 8).map((change) => <div key={change.name} className="mt-1 flex justify-between text-[9px]"><span>{change.name}</span><span className={change.delta && change.delta > 0 ? "text-amber-400" : "text-zinc-500"}>{change.delta === undefined ? "—" : formatEngineering(change.delta, "", 4)}</span></div>)}</div>}</aside></div>}
    {!props.legacyOpen && <div className="h-36 shrink-0 overflow-auto border-t border-zinc-800 bg-black p-2 font-mono text-[10px] text-zinc-500"><div className="mb-1 text-zinc-700">SIMULATION CONSOLE · {run.manifest?.simulator.version ?? "manifest pending"}</div>{run.events.map((event) => <div key={event.sequence}><span className="text-zinc-700">{new Date(event.timestamp).toLocaleTimeString()} </span><span className="text-teal-700">[{event.status}]</span> {event.message}</div>)}{run.stderr && <pre className="mt-2 whitespace-pre-wrap text-red-400/70">{run.stderr}</pre>}</div>}
  </div>;
}

function ModelsWorkspace(props: { project: SimulationProject; schematic: SchematicState; parts: SimulationPartSnapshot[]; report: ModelImportReport | null; busy: boolean; onFile(file: File): void; onSmoke(): void; onAdd(): void; onDismiss(): void; commitProject(project: SimulationProject): void }) {
  const partMap = new Map(props.parts.map((part) => [part.id, part]));
  function assign(componentId: string, partId: string, modelId: string) {
    const part = partMap.get(partId); const model = props.project.modelAssets.find((candidate) => candidate.id === modelId); if (!part || !model) return;
    const inferred = inferPinMap(part, model);
    const binding: ModelBinding = { id: createId("binding"), componentId, modelId, pinMap: inferred.pinMap, parameterOverrides: {}, confidence: inferred.confidence, assignedBy: "user", reviewed: inferred.confidence === 1, createdAt: new Date().toISOString() };
    const next = structuredClone(props.project); next.modelBindings = [...next.modelBindings.filter((candidate) => candidate.componentId !== componentId), binding]; next.revision++; props.commitProject(next);
  }
  return <div className="h-full overflow-auto p-5"><div className="mx-auto max-w-7xl space-y-5"><div className="flex items-end justify-between"><div><div className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">Governed simulation assets</div><h2 className="mt-1 text-xl font-semibold">Model registry</h2></div><label className="studio-button cursor-pointer bg-teal-500 text-zinc-950 hover:bg-teal-400"><Upload className="size-3.5" />{props.busy ? "Parsing…" : "Import model"}<input type="file" accept=".lib,.cir,.sp,.spice,.mod,.model,.va,.vams" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onFile(file); }} /></label></div>{props.report && <div className="rounded-xl border border-teal-900/60 bg-teal-950/10 p-4"><div className="flex items-start"><div className="flex-1"><div className="text-sm font-semibold">Import review · {props.report.fileName}</div><div className="mt-1 text-xs text-zinc-500">{props.report.dialect} · {props.report.declarations.length} declarations · checksum {props.report.candidate.checksum.slice(0, 16)}… · <span className={props.report.candidate.validationStatus === "smoke-tested" ? "text-emerald-400" : "text-amber-400"}>{props.report.candidate.validationStatus}</span></div></div><button onClick={props.onDismiss} className="studio-icon"><X className="size-4" /></button></div><div className="mt-3 grid grid-cols-2 gap-3"><div><div className="mb-1 text-[10px] uppercase text-zinc-600">Candidate subcircuits</div>{props.report.declarations.map((declaration) => <div key={`${declaration.line}-${declaration.name}`} className="rounded bg-zinc-900 p-2 text-[10px]"><strong>{declaration.kind} {declaration.name}</strong><div className="mt-1 font-mono text-zinc-600">{declaration.pins.join(" · ") || "primitive model"}</div></div>)}</div><div><div className="mb-1 text-[10px] uppercase text-zinc-600">Warnings & reversible patches</div>{props.report.warnings.map((warning) => <div key={warning} className="mb-1 flex gap-1 text-[10px] text-amber-400"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{warning}</div>)}{props.report.candidate.transforms.map((transform) => <div key={transform.id} className="mt-1 rounded border border-zinc-800 p-2 text-[9px]"><div>{transform.description}</div><div className="mt-1 font-mono text-red-400/60 line-through">{transform.original}</div><div className="font-mono text-emerald-400/60">{transform.replacement}</div><span className="mt-1 inline-block text-zinc-600">Not applied</span></div>)}</div></div><div className="mt-3 flex justify-end gap-2"><button onClick={props.onDismiss} className="studio-button">Cancel</button><button onClick={props.onSmoke} disabled={props.busy || props.report.candidate.validationStatus === "smoke-tested"} className="studio-button"><FlaskConical className="size-3.5" />{props.busy ? "Testing…" : "Run smoke test"}</button><button onClick={props.onAdd} className="studio-button bg-teal-500 text-zinc-950"><Save className="size-3.5" />Add governed asset</button></div></div>}
    <div className="grid grid-cols-[1fr_340px] gap-4"><div className="overflow-hidden rounded-xl border border-zinc-800"><table className="w-full text-left text-xs"><thead className="bg-zinc-900 text-[9px] uppercase text-zinc-600"><tr><th className="px-3 py-2">Model</th><th>Type</th><th>Provenance</th><th>Validation</th><th>License</th></tr></thead><tbody>{props.project.modelAssets.map((model) => <tr key={model.id} className="border-t border-zinc-800"><td className="px-3 py-2"><div className="font-medium">{model.name}</div><div className="font-mono text-[8px] text-zinc-700">{model.checksum.slice(0, 20)}</div></td><td className="text-[10px] text-zinc-500">{model.modelType}</td><td className="text-[10px] text-zinc-500">{model.provenance}</td><td><span className={`rounded px-1.5 py-0.5 text-[9px] ${model.validationStatus === "trusted" ? "bg-emerald-950 text-emerald-300" : model.validationStatus === "unverified" ? "bg-amber-950 text-amber-300" : "bg-sky-950 text-sky-300"}`}>{model.validationStatus}</span></td><td className="text-[10px] text-zinc-600">{model.license ?? "unknown"}</td></tr>)}</tbody></table></div><aside className="rounded-xl border border-zinc-800 p-3"><div className="mb-3 text-xs font-semibold">Component model status</div>{(props.schematic.kicadComponents ?? []).length === 0 ? <Empty>Theory primitives use trusted built-ins.</Empty> : (props.schematic.kicadComponents ?? []).map((component) => { const binding = props.project.modelBindings.find((candidate) => candidate.componentId === component.id); return <div key={component.id} className="mb-2 rounded border border-zinc-800 p-2"><div className="flex items-center"><span className="font-mono text-xs">{component.refDes}</span><span className={`ml-auto size-2 rounded-full ${binding ? "bg-emerald-400" : "bg-red-400"}`} /></div><div className="mt-1 truncate text-[9px] text-zinc-600">{partMap.get(component.partId)?.name ?? component.value}</div><select value={binding?.modelId ?? ""} onChange={(event) => assign(component.id, component.partId, event.target.value)} className="studio-input mt-2"><option value="">No model assigned</option>{props.project.modelAssets.filter((model) => !["primitive"].includes(model.modelType)).map((model) => <option key={model.id} value={model.id}>{model.name} · {model.validationStatus}</option>)}</select>{binding && <div className="mt-1 text-[9px] text-zinc-600">Pin-map confidence {(binding.confidence * 100).toFixed(0)}% · {binding.reviewed ? "reviewed" : "review required"}</div>}</div>; })}</aside></div>
  </div></div>;
}

function ReportsWorkspace({ project, runs }: { project: SimulationProject; runs: RunRecord[] }) {
  const report = useMemo(() => buildSpiceReport(project, runs), [project, runs]);
  return <div className="h-full overflow-auto p-5"><div className="mx-auto max-w-6xl"><div className="mb-5 flex items-end justify-between"><div><div className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">Reproducible qualification</div><h2 className="mt-1 text-xl font-semibold">Reports & regression</h2></div><div className="flex gap-2"><button onClick={() => downloadText("sirkit-spice-report.json", reportToJson(report), "application/json")} className="studio-button"><FileJson className="size-3.5" />JSON bundle</button><button onClick={() => downloadText("sirkit-spice-report.html", reportToHtml(report), "text/html")} className="studio-button bg-teal-500 text-zinc-950"><FileText className="size-3.5" />HTML report</button></div></div><div className="grid grid-cols-4 gap-3">{[["Design revision", report.designRevisionId.slice(0, 12)], ["Recorded runs", report.runIds.length], ["Governed models", report.modelInventory.length], ["Warnings", report.warnings.length]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-zinc-800 p-4"><div className="text-[9px] uppercase text-zinc-600">{label}</div><div className="mt-2 text-lg font-semibold">{value}</div></div>)}</div><h3 className="mb-2 mt-6 text-sm font-semibold">Specification datasheet</h3><div className="overflow-auto rounded-xl border border-zinc-800"><table className="min-w-full text-left text-[10px]"><thead className="bg-zinc-900 text-zinc-600"><tr><th className="px-3 py-2">Specification</th>{report.runIds.map((id) => <th key={id} className="px-2">{id.slice(0, 8)}</th>)}</tr></thead><tbody>{report.specificationMatrix.length === 0 ? <tr><td className="p-6 text-center text-zinc-600" colSpan={Math.max(1, report.runIds.length + 1)}>Define and run specifications to populate the datasheet.</td></tr> : report.specificationMatrix.map((row) => <tr key={row.specification} className="border-t border-zinc-800"><td className="px-3 py-2 font-medium">{row.specification} <span className="text-zinc-600">{row.unit}</span></td>{row.cells.map((cell) => <td key={cell.runId} className="px-2"><span className={`rounded px-1.5 py-0.5 uppercase ${cell.status === "pass" ? "bg-emerald-950 text-emerald-300" : cell.status === "fail" || cell.status === "error" ? "bg-red-950 text-red-300" : "bg-zinc-800 text-zinc-500"}`}>{cell.status}</span>{cell.value !== undefined && <div className="mt-1 font-mono">{formatEngineering(cell.value, row.unit, 5)}</div>}</td>)}</tr>)}</tbody></table></div>{report.warnings.length > 0 && <div className="mt-5 rounded-xl border border-amber-900/50 bg-amber-950/10 p-4"><div className="text-xs font-semibold text-amber-300">Disclosure & approximations</div><ul className="mt-2 list-disc space-y-1 pl-4 text-[10px] text-zinc-400">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}</div></div>;
}

function AiDrawer(props: { instruction: string; setInstruction(value: string): void; busy: boolean; error: string | null; question: string | null; proposal: AiStudioProposal | null; approved: Set<number>; setApproved(value: Set<number>): void; onAsk(): void; onApply(): void; onClose(): void }) {
  return <div className="absolute inset-y-0 right-0 z-[70] flex w-[430px] flex-col border-l border-teal-900/50 bg-zinc-950 shadow-2xl"><div className="flex h-12 items-center border-b border-zinc-800 px-3"><div className="grid size-7 place-items-center rounded bg-teal-500/15 text-teal-300"><Bot className="size-4" /></div><div className="ml-2"><div className="text-xs font-semibold">AI simulation engineer</div><div className="text-[9px] text-zinc-600">Typed tools · evidence-bound · reviewable</div></div><button onClick={props.onClose} className="studio-icon ml-auto"><X className="size-4" /></button></div><div className="min-h-0 flex-1 overflow-auto p-3"><div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 text-[10px] text-zinc-500"><Check className="mr-1 inline size-3 text-emerald-400" />Only proposed measurements and specifications arrive selected. Tests, overlays, variables, analyses, sweeps, corners, models, solver settings and run requests reach the simulator: select each one you approve. Production-design changes remain gated.</div><textarea value={props.instruction} onChange={(event) => props.setInstruction(event.target.value)} placeholder="Verify startup, ripple, stability, and current across temperature and component tolerance…" className="studio-input mt-3 min-h-28 resize-y text-xs" /><button onClick={props.onAsk} disabled={props.busy || !props.instruction.trim()} className="studio-button mt-2 w-full justify-center bg-teal-500 text-zinc-950 hover:bg-teal-400 disabled:opacity-40">{props.busy ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}{props.busy ? "Inspecting and building proposal…" : "Build structured testbench"}</button>{props.error && <div className="mt-3 rounded border border-red-900/50 bg-red-950/20 p-2 text-[10px] text-red-300">{props.error}</div>}{props.question && <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">{props.question}</div>}{props.proposal && <div className="mt-4"><div className="text-sm font-semibold">{props.proposal.summary}</div><p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{props.proposal.rationale}</p><div className="mt-3 space-y-1.5">{props.proposal.operations.map((entry, index) => <label key={index} className={`flex cursor-pointer gap-2 rounded border p-2 ${props.approved.has(index) ? "border-teal-800 bg-teal-950/20" : "border-zinc-800"}`}><input type="checkbox" checked={props.approved.has(index)} onChange={(event) => { const next = new Set(props.approved); if (event.target.checked) next.add(index); else next.delete(index); props.setApproved(next); }} /><div className="min-w-0 flex-1"><div className="text-[11px] text-zinc-200">{operationLabel(entry.operation)}</div><span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[8px] uppercase ${entry.approval === "automatic" ? "bg-emerald-950 text-emerald-300" : entry.approval === "review" ? "bg-amber-950 text-amber-300" : "bg-red-950 text-red-300"}`}>{entry.approval}</span></div></label>)}</div>{props.proposal.assumptions.length > 0 && <div className="mt-3 text-[10px] text-zinc-600"><strong>Assumptions:</strong> {props.proposal.assumptions.join(" · ")}</div>}{props.proposal.uncertainty && <div className="mt-2 text-[10px] text-amber-500"><strong>Uncertainty:</strong> {props.proposal.uncertainty}</div>}{props.proposal.evidence.length > 0 && <div className="mt-2 text-[9px] text-zinc-600">{props.proposal.evidence.length} internal evidence reference(s) attached.</div>}</div>}</div>{props.proposal && <div className="border-t border-zinc-800 p-3"><button onClick={props.onApply} disabled={props.approved.size === 0} className="studio-button w-full justify-center bg-teal-500 text-zinc-950 disabled:opacity-40"><Check className="size-4" />Apply {props.approved.size} approved change{props.approved.size === 1 ? "" : "s"}</button></div>}</div>;
}
