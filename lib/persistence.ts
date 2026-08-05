import type { SchematicState } from "./schematic-types";
import { isPageSize, DEFAULT_PAGE_SIZE } from "./schematic-types";
import type { PcbBoard } from "@/app/lib/pcb";
import { migrateBoardElectricalIdentities } from "@/app/lib/pcb/integrity";
import type { AiProjectSettings } from "@/app/lib/llm/types";
import type { ManufacturingReleaseManifest } from "@/app/lib/pcb/readiness/types";
import type { ProjectComponentPin } from "@/app/lib/atomic/types";
import { portableSnapshotIntegrityErrors } from "@/app/lib/atomic/portable";
import { migrateBoardConstraintState } from "@/app/lib/constraints/legacy";
import type { DesignRequirementsPackage } from "@/app/lib/requirements/types";
import { validateDesignRequirementsPackage } from "@/app/lib/requirements/validation";
import type { ArchitectureProjectState } from "@/app/lib/architecture/types";
import { validateArchitectureProjectState } from "@/app/lib/architecture/project";
import type { PowerProjectState } from "@/app/lib/power/types";
import { validatePowerProjectState } from "@/app/lib/power/project";
import type { InterfaceProjectState } from "@/app/lib/interfaces/types";
import { validateInterfaceProjectState } from "@/app/lib/interfaces/project";
import type { CircuitKnowledgeProjectState } from "@/app/lib/circuit-knowledge/types";
import { validateCircuitKnowledgeProjectState } from "@/app/lib/circuit-knowledge/project";
import type { ComponentSelectionProjectState } from "@/app/lib/component-selection/types";
import { validateComponentSelectionProjectState } from "@/app/lib/component-selection/project";
import type { CalculationProjectState } from "@/app/lib/calculation/types";
import { validateCalculationProjectState } from "@/app/lib/calculation/project";
import type { SchematicProjectState } from "@/app/lib/schematic-compiler/types";
import { validateSchematicProjectState } from "@/app/lib/schematic-compiler/project";
import type { CircuitVerificationProjectState } from "@/app/lib/circuit-verification/types";
import { validateCircuitVerificationProjectState } from "@/app/lib/circuit-verification/project";
import type { ModelSimulationProjectState } from "@/app/lib/model-simulation/types";
import { validateModelSimulationProject } from "@/app/lib/model-simulation/project";
import type { FirmwareBringUpProjectState } from "@/app/lib/firmware-bringup/types";
import { validateFirmwareBringUpProject } from "@/app/lib/firmware-bringup/project";
import type { ReleaseEngineeringProjectState } from "@/app/lib/release-engineering/types";
import { validateReleaseEngineeringProject } from "@/app/lib/release-engineering/project";
import type { FullFlowProjectState } from "@/app/lib/full-flow/types";
import { validateFullFlowProject } from "@/app/lib/full-flow/project";

/** Persisted, user-visible AI interaction — never keys, never hidden reasoning. */
export type StoredChatMessage =
  | { id: string; role: "user" | "assistant"; content: string }
  | { id: string; role: "log"; title: string; status: "running" | "done" | "error"; entries: { id: string; text: string; status: "running" | "done" | "error" }[] };

/**
 * Local working PCB copy. The durable server board (pcb-sync) stays the
 * authority for what was ever APPLIED; the working copy carries the user's
 * editor work (moves, routing, zones) layered on an exact authoritative base.
 * `baseRevision`/`baseDigest` name that base — when the server has moved past
 * it, the copies have diverged and the working copy must not silently win.
 */
export type PcbWorkingCopy = {
  board: PcbBoard;
  baseRevision: string | null;
  baseDigest: string | null;
  updatedAt: number;
  /** B03: canonical-executor head this board was at when last saved.
   *  Written only after a successful canonical mutation reached autosave;
   *  absent on legacy projects and after legacy-path edits. Verified against
   *  the loaded board on hydration — a stale claim is refused, never adopted. */
  canonicalHead?: PcbCanonicalHead | null;
};

/** Identifies the canonical working-copy head for reload/hydration.
 *  v1 (B03): CONTENT-equivalence claim only — reload verifies the board and
 *  derives a fresh lineage. v2 (B03.1): adds the durable lineage identity;
 *  together with the persisted envelope it enables verified EXACT-head
 *  restoration (sequence, head transaction, integrity-chained log). Every
 *  verification failure falls closed to the v1 behavior. */
export type PcbCanonicalHead = {
  schemaVersion: 1 | 2;
  /** B03.1 (v2): durable lineage identity for exact-head restoration. */
  lineageId?: string;
  /** Fill-normalized semantic lineage digest of the board (B03 adapter rule). */
  lineageDigest: string;
  /** Full pcb2-… content revision of the saved board (informational pin). */
  boardSemanticRevision: string;
  headSequence: number;
  headTransactionId: string;
  /** Canonical-state digest of the executor head this board corresponds to. */
  canonicalStateDigest: string;
};

/** Downstream-stage evidence identity for staleness detection (Section 8). */
export type PcbStageEvidence = {
  /** pcbRevisionId of the board content when routing last completed. */
  routedBoardRevision?: string;
  routedAt?: number;
  /** pcbRevisionId of the board content when a release was produced. */
  releasedBoardRevision?: string;
  releasedAt?: number;
  releaseId?: string;
};

/** Version of the persisted project record shape. Absent = 1 (pre-R06). */
export const PROJECT_SCHEMA_VERSION = 2;

export type SavedProject = {
  id: string;
  name: string;
  state: SchematicState;
  createdAt: number;
  updatedAt: number;
  /** Record-shape version; absent means 1 (pre-R06 records). */
  schemaVersion?: number;
  /** Persisted user prompts + user-visible AI responses (R06). */
  chat?: StoredChatMessage[];
  /** Last design prompt (used for regenerate / cross-verify flows). */
  designPrompt?: string;
  /** The workspace tab the user was in (R06 workflow-stage persistence). */
  workflowView?: string;
  /** Local working PCB copy — editor work not yet in a durable apply (R06). */
  pcbWorking?: PcbWorkingCopy;
  /** Diverged working copy preserved instead of silently overwritten (R06). */
  pcbWorkingConflict?: PcbWorkingCopy & { reason: string };
  /** Downstream-stage evidence identity for staleness detection (R06). */
  pcbStages?: PcbStageEvidence;
  // PCB layout state (Stage 1+). JSON-serializable by construction — all
  // numbers/strings/arrays; a 200-part board with embedded footprint defs is
  // ~600 KB, fine for localStorage.
  pcb?: PcbBoard;
  // Historical, non-semantic manufacturing records. Live readiness is always
  // recomputed; these manifests never authorize a later release.
  pcbReleases?: ManufacturingReleaseManifest[];
  // AI provider selection/history is project metadata only. It never mutates
  // `state` or `pcb`, and embeddings remain fixed to OpenAI.
  ai?: AiProjectSettings;
  /** Exact immutable selections keyed by schematic component instance id. */
  componentSelections?: Record<string, ProjectComponentPin>;
  /** CD-1 authoritative requirements package. Planned obligations are not evidence. */
  requirements?: DesignRequirementsPackage;
  /** CD-2 candidate set and human selection. It is independent of schematic/PCB state. */
  architecture?: ArchitectureProjectState;
  /** CD-3 power architecture, pinned to one exact human-selected CD-2 decision. */
  power?: PowerProjectState;
  /** Superseded CD-3 states retained as immutable audit history after upstream invalidation. */
  powerHistory?: PowerProjectState[];
  /** CD-4 interface/pinmux/clock/reset/boot/debug planning. It never mutates schematic or PCB state. */
  interfacePlanning?: InterfaceProjectState;
  /** Superseded CD-4 states retained after exact upstream or component-fact invalidation. */
  interfacePlanningHistory?: InterfaceProjectState[];
  /** CD-5 executable circuit knowledge state. Recipes remain separate from schematic and PCB truth. */
  circuitKnowledge?: CircuitKnowledgeProjectState;
  /** Superseded CD-5 states retained after an upstream/library dependency change. */
  circuitKnowledgeHistory?: CircuitKnowledgeProjectState[];
  /** CD-6 exact-part and preliminary joint-BOM state; never a production release. */
  componentSelectionProgram?: ComponentSelectionProjectState;
  /** Immutable superseded CD-6 states retained after upstream/catalog invalidation. */
  componentSelectionProgramHistory?: ComponentSelectionProjectState[];
  /** CD-7 deterministic calculation state; it cannot mutate schematic or PCB truth. */
  calculationProgram?: CalculationProjectState;
  /** Immutable superseded CD-7 states retained after any pinned CD-1 through CD-6 change. */
  calculationProgramHistory?: CalculationProjectState[];
  /** CD-8 coordinate-independent semantic schematic compilation state. */
  schematicCompilationProgram?: SchematicProjectState;
  /** Immutable superseded CD-8 states retained after any CD-1 through CD-7 change. */
  schematicCompilationProgramHistory?: SchematicProjectState[];
  /** CD-9 circuit verification evidence. It is derived only from the approved CD-8 semantic graph. */
  circuitVerificationProgram?: CircuitVerificationProjectState;
  /** Immutable superseded CD-9 evidence retained after any upstream semantic change. */
  circuitVerificationProgramHistory?: CircuitVerificationProjectState[];
  /** CD-10 model-backed simulation evidence; legacy SPICE projects are not imported as authority. */
  modelSimulationProgram?: ModelSimulationProjectState;
  /** Immutable superseded CD-10 evidence retained after a pinned CD-8/CD-9/model/testbench change. */
  modelSimulationProgramHistory?: ModelSimulationProjectState[];
  /** CD-11 firmware/test/DFT/calibration/bring-up co-design metadata; never hardware execution evidence. */
  firmwareBringUpProgram?: FirmwareBringUpProjectState;
  /** Immutable superseded CD-11 packages retained after any pinned CD-1 through CD-10 change. */
  firmwareBringUpProgramHistory?: FirmwareBringUpProjectState[];
  /** CD-12 supply-chain/manufacturing/release evidence. It never represents a purchase or physical build by itself. */
  releaseEngineeringProgram?: ReleaseEngineeringProjectState;
  /** Immutable superseded CD-12 release candidates retained after upstream, PCB, sourcing, artifact, or policy invalidation. */
  releaseEngineeringProgramHistory?: ReleaseEngineeringProjectState[];
  /** CD-13 durable full-flow runs; orchestration metadata never replaces lower-stage engineering truth. */
  fullFlowProgram?: FullFlowProjectState;
  /** Immutable archived CD-13 project states retained across release/stage-policy successors. */
  fullFlowProgramHistory?: FullFlowProjectState[];
};

const STORAGE_PREFIX    = "sirkit:project:";
const STORAGE_INDEX_KEY = "sirkit:projectIndex";

function invalidateCalculationForUpstream(project: SavedProject, stage: "CD-1" | "CD-2" | "CD-3" | "CD-4" | "CD-5" | "CD-6", currentDigest: string | undefined): Partial<SavedProject> {
  if (!project.calculationProgram) return {};
  const pinned = project.calculationProgram.problem.upstreamRevisionRefs.find((item) => item.stage === stage)?.digest;
  if (pinned && currentDigest && pinned === currentDigest) return {};
  return { calculationProgram: undefined, calculationProgramHistory: [...(project.calculationProgramHistory ?? []), structuredClone(project.calculationProgram)].slice(-50) };
}

function invalidateSchematicCompilationForUpstream(project: SavedProject, stage: "CD-1" | "CD-2" | "CD-3" | "CD-4" | "CD-5" | "CD-6" | "CD-7", currentDigest: string | undefined): Partial<SavedProject> {
  if (!project.schematicCompilationProgram) return { ...(project.circuitVerificationProgram ? { circuitVerificationProgram: undefined, circuitVerificationProgramHistory: [...(project.circuitVerificationProgramHistory ?? []), structuredClone(project.circuitVerificationProgram)].slice(-50) } : {}), ...archiveModelSimulation(project) };
  const pinned = project.schematicCompilationProgram.problem.upstreamRevisionRefs.find((item) => item.stage === stage)?.digest;
  if (pinned && currentDigest && pinned === currentDigest) return {};
  return { schematicCompilationProgram: undefined, schematicCompilationProgramHistory: [...(project.schematicCompilationProgramHistory ?? []), structuredClone(project.schematicCompilationProgram)].slice(-50), ...(project.circuitVerificationProgram ? { circuitVerificationProgram: undefined, circuitVerificationProgramHistory: [...(project.circuitVerificationProgramHistory ?? []), structuredClone(project.circuitVerificationProgram)].slice(-50) } : {}), ...archiveModelSimulation(project) };
}

function archiveModelSimulation(project: SavedProject): Partial<SavedProject> { return { ...(project.modelSimulationProgram ? { modelSimulationProgram: undefined, modelSimulationProgramHistory: [...(project.modelSimulationProgramHistory ?? []), structuredClone(project.modelSimulationProgram)].slice(-50) } : {}), ...archiveFirmwareBringUp(project) }; }
function archiveFullFlow(project: SavedProject): Partial<SavedProject> { return project.fullFlowProgram ? { fullFlowProgram: undefined, fullFlowProgramHistory: [...(project.fullFlowProgramHistory ?? []), structuredClone(project.fullFlowProgram)].slice(-50) } : {}; }
function archiveReleaseEngineering(project: SavedProject): Partial<SavedProject> { return { ...(project.releaseEngineeringProgram ? { releaseEngineeringProgram: undefined, releaseEngineeringProgramHistory: [...(project.releaseEngineeringProgramHistory ?? []), structuredClone(project.releaseEngineeringProgram)].slice(-50) } : {}), ...archiveFullFlow(project) }; }
function archiveFirmwareBringUp(project: SavedProject): Partial<SavedProject> { return { ...(project.firmwareBringUpProgram ? { firmwareBringUpProgram: undefined, firmwareBringUpProgramHistory: [...(project.firmwareBringUpProgramHistory ?? []), structuredClone(project.firmwareBringUpProgram)].slice(-50) } : {}), ...archiveReleaseEngineering(project) }; }

// ─── Index helpers ────────────────────────────────────────────────────────────

function getIndex(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function setIndex(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(ids));
  } catch {
    // quota exceeded or unavailable
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function listProjects(): SavedProject[] {
  const ids = getIndex();
  const projects: SavedProject[] = [];
  for (const id of ids) {
    const p = loadProject(id);
    if (p) projects.push(p);
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadProject(id: string): SavedProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const project = JSON.parse(raw) as SavedProject;
    if (project.requirements && (!validateDesignRequirementsPackage(project.requirements) || project.requirements.projectId !== project.id)) return null;
    if (project.architecture && (!validateArchitectureProjectState(project.architecture) || project.architecture.projectId !== project.id)) return null;
    if (project.power && (!validatePowerProjectState(project.power) || project.power.projectId !== project.id || project.power.problem.architectureRef.candidateDigest !== project.architecture?.selection?.candidateDigest)) return null;
    if (project.powerHistory?.some((item) => !validatePowerProjectState(item) || item.projectId !== project.id)) return null;
    if (project.interfacePlanning && (!validateInterfaceProjectState(project.interfacePlanning) || project.interfacePlanning.projectId !== project.id || project.interfacePlanning.problem.requirementsPackageRevision.digest !== project.requirements?.deterministicDigest || project.interfacePlanning.problem.systemArchitectureCandidateRevision.candidateDigest !== project.architecture?.selection?.candidateDigest || project.interfacePlanning.problem.powerArchitectureCandidateRevision.candidateDigest !== project.power?.selection?.candidateDigest)) return null;
    if (project.interfacePlanningHistory?.some((item) => !validateInterfaceProjectState(item) || item.projectId !== project.id)) return null;
    if (project.circuitKnowledge && (validateCircuitKnowledgeProjectState(project.circuitKnowledge).length || project.circuitKnowledge.projectId !== project.id || project.circuitKnowledge.problem.requirementsPackageRevision.digest !== project.requirements?.deterministicDigest || project.circuitKnowledge.problem.systemArchitectureCandidateRevision.digest !== project.architecture?.selection?.candidateDigest || project.circuitKnowledge.problem.powerArchitectureCandidateRevision.digest !== project.power?.selection?.candidateDigest || project.circuitKnowledge.problem.interfaceContractSetRevision.digest !== project.interfacePlanning?.selection?.candidateDigest)) return null;
    if (project.circuitKnowledgeHistory?.some((item) => validateCircuitKnowledgeProjectState(item).length || item.projectId !== project.id)) return null;
    if (project.componentSelectionProgram && (validateComponentSelectionProjectState(project.componentSelectionProgram).length || project.componentSelectionProgram.projectId !== project.id || project.componentSelectionProgram.problem.requirementsPackageRevision.digest !== project.requirements?.deterministicDigest || project.componentSelectionProgram.problem.systemArchitectureCandidateRevision.digest !== project.architecture?.selection?.candidateDigest || project.componentSelectionProgram.problem.powerArchitectureCandidateRevision.digest !== project.power?.selection?.candidateDigest || project.componentSelectionProgram.problem.interfacePlanningCandidateRevision.digest !== project.interfacePlanning?.selection?.candidateDigest || project.componentSelectionProgram.problem.recipeBindingProblemRevision.stateDigest !== project.circuitKnowledge?.deterministicDigest)) return null;
    if (project.componentSelectionProgramHistory?.some((item) => validateComponentSelectionProjectState(item).length || item.projectId !== project.id)) return null;
    if (project.calculationProgram && (validateCalculationProjectState(project.calculationProgram).length || project.calculationProgram.projectId !== project.id || project.calculationProgram.problem.upstreamRevisionRefs.find((item) => item.stage === "CD-1")?.digest !== project.requirements?.deterministicDigest || project.calculationProgram.problem.upstreamRevisionRefs.find((item) => item.stage === "CD-2")?.digest !== project.architecture?.selection?.candidateDigest || project.calculationProgram.problem.upstreamRevisionRefs.find((item) => item.stage === "CD-3")?.digest !== project.power?.selection?.candidateDigest || project.calculationProgram.problem.upstreamRevisionRefs.find((item) => item.stage === "CD-4")?.digest !== project.interfacePlanning?.selection?.candidateDigest || project.calculationProgram.problem.upstreamRevisionRefs.find((item) => item.stage === "CD-5")?.digest !== project.circuitKnowledge?.deterministicDigest || project.calculationProgram.problem.upstreamRevisionRefs.find((item) => item.stage === "CD-6")?.digest !== project.componentSelectionProgram?.deterministicDigest)) return null;
    if (project.calculationProgramHistory?.some((item) => validateCalculationProjectState(item).length || item.projectId !== project.id)) return null;
    if (project.schematicCompilationProgram) { const refs = new Map(project.schematicCompilationProgram.problem.upstreamRevisionRefs.map((item) => [item.stage, item.digest])); if (validateSchematicProjectState(project.schematicCompilationProgram).length || project.schematicCompilationProgram.projectId !== project.id || refs.get("CD-1") !== project.requirements?.deterministicDigest || refs.get("CD-2") !== project.architecture?.selection?.candidateDigest || refs.get("CD-3") !== project.power?.selection?.candidateDigest || refs.get("CD-4") !== project.interfacePlanning?.selection?.candidateDigest || refs.get("CD-5") !== project.circuitKnowledge?.deterministicDigest || refs.get("CD-6") !== project.componentSelectionProgram?.deterministicDigest || refs.get("CD-7") !== project.calculationProgram?.deterministicDigest) return null; }
    if (project.schematicCompilationProgramHistory?.some((item) => validateSchematicProjectState(item).length || item.projectId !== project.id)) return null;
    if (project.circuitVerificationProgram && (validateCircuitVerificationProjectState(project.circuitVerificationProgram).length || project.circuitVerificationProgram.projectId !== project.id || project.circuitVerificationProgram.problem.cd8ProjectDigest !== project.schematicCompilationProgram?.deterministicDigest)) return null;
    if (project.circuitVerificationProgramHistory?.some((item) => validateCircuitVerificationProjectState(item).length || item.projectId !== project.id)) return null;
    if (project.modelSimulationProgram && (validateModelSimulationProject(project.modelSimulationProgram).length || project.modelSimulationProgram.projectId !== project.id || project.modelSimulationProgram.problem.circuitVerificationProjectDigest !== project.circuitVerificationProgram?.deterministicDigest || project.modelSimulationProgram.problem.cd8ProjectDigest !== project.schematicCompilationProgram?.deterministicDigest)) return null;
    if (project.modelSimulationProgramHistory?.some((item) => validateModelSimulationProject(item).length || item.projectId !== project.id)) return null;
    if (project.firmwareBringUpProgram && (validateFirmwareBringUpProject(project.firmwareBringUpProgram).length || project.firmwareBringUpProgram.projectId !== project.id || project.firmwareBringUpProgram.problem.simulationReadinessReportDigest !== project.modelSimulationProgram?.readinessReports.at(-1)?.deterministicDigest)) return null;
    if (project.firmwareBringUpProgramHistory?.some((item) => validateFirmwareBringUpProject(item).length || item.projectId !== project.id)) return null;
    if (project.releaseEngineeringProgram && (validateReleaseEngineeringProject(project.releaseEngineeringProgram).length || project.releaseEngineeringProgram.projectId !== project.id || project.releaseEngineeringProgram.problem.firmwareBringUpProjectDigest !== project.firmwareBringUpProgram?.deterministicDigest || project.releaseEngineeringProgram.problem.firmwareTestBringUpPackageDigest !== project.firmwareBringUpProgram?.packages.at(-1)?.deterministicDigest)) return null;
    if (project.releaseEngineeringProgramHistory?.some((item) => validateReleaseEngineeringProject(item).length || item.projectId !== project.id)) return null;
    if (project.fullFlowProgram && (validateFullFlowProject(project.fullFlowProgram).length || project.fullFlowProgram.projectId !== project.id)) return null;
    if (project.fullFlowProgramHistory?.some((item) => validateFullFlowProject(item).length || item.projectId !== project.id)) return null;
    if (!project.pcb) return project;
    const identityMigration = migrateBoardElectricalIdentities(project.pcb, id);
    const constraintMigration = migrateBoardConstraintState(identityMigration.board, id);
    return { ...project, pcb: constraintMigration.board };
  } catch {
    return null;
  }
}

/**
 * R06 salvage loader. `loadProject` deliberately returns null when any staged
 * sub-state fails validation — correct for the CD-stage pages, but the editor
 * must NEVER lose project identity (and mint a fresh id) because one optional
 * sub-state is corrupt. This loader keeps the core design fields and reports
 * which optional fields were dropped, so the caller can tell the user.
 */
export function loadProjectSalvaged(id: string): { project: SavedProject; dropped: string[] } | null {
  const strict = loadProject(id);
  if (strict) return { project: strict, dropped: [] };
  let raw: string | null;
  try { raw = localStorage.getItem(STORAGE_PREFIX + id); } catch { return null; }
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id !== id || typeof record.name !== "string" || typeof record.state !== "object" || record.state === null) return null;
  // Core design truth only; every staged sub-state is dropped (they failed
  // strict validation as a set — do not guess which one is at fault).
  const dropped = ["requirements", "architecture", "power", "powerHistory", "interfacePlanning", "interfacePlanningHistory", "circuitKnowledge", "circuitKnowledgeHistory", "componentSelectionProgram", "componentSelectionProgramHistory", "calculationProgram", "calculationProgramHistory", "schematicCompilationProgram", "schematicCompilationProgramHistory", "circuitVerificationProgram", "circuitVerificationProgramHistory", "modelSimulationProgram", "modelSimulationProgramHistory", "firmwareBringUpProgram", "firmwareBringUpProgramHistory", "releaseEngineeringProgram", "releaseEngineeringProgramHistory", "fullFlowProgram", "fullFlowProgramHistory"].filter((key) => record[key] !== undefined);
  const project: SavedProject = {
    id: record.id,
    name: record.name,
    state: record.state as SchematicState,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
    ...(typeof record.schemaVersion === "number" ? { schemaVersion: record.schemaVersion } : {}),
    ...(Array.isArray(record.chat) ? { chat: record.chat as StoredChatMessage[] } : {}),
    ...(typeof record.designPrompt === "string" ? { designPrompt: record.designPrompt } : {}),
    ...(typeof record.workflowView === "string" ? { workflowView: record.workflowView } : {}),
    ...(record.pcbWorking && typeof record.pcbWorking === "object" ? { pcbWorking: record.pcbWorking as PcbWorkingCopy } : {}),
    ...(record.pcbWorkingConflict && typeof record.pcbWorkingConflict === "object" ? { pcbWorkingConflict: record.pcbWorkingConflict as PcbWorkingCopy & { reason: string } } : {}),
    ...(record.pcbStages && typeof record.pcbStages === "object" ? { pcbStages: record.pcbStages as PcbStageEvidence } : {}),
    ...(isPcbBoardLike(record.pcb) ? { pcb: record.pcb } : {}),
    ...(record.ai && typeof record.ai === "object" ? { ai: record.ai as AiProjectSettings } : {}),
    ...(record.componentSelections && typeof record.componentSelections === "object" ? { componentSelections: record.componentSelections as Record<string, ProjectComponentPin> } : {}),
  };
  return { project, dropped };
}

/**
 * R06 field patcher: update a subset of a project's R06 fields in one durable
 * write. REPORTS failure (quota/serialization) — callers surface it visibly.
 */
export function saveProjectFields(
  id: string,
  patch: Partial<Pick<SavedProject, "name" | "state" | "chat" | "designPrompt" | "workflowView" | "pcbWorking" | "pcbWorkingConflict" | "pcbStages" | "ai">>,
): boolean {
  const salvaged = loadProjectSalvaged(id);
  if (!salvaged) return false;
  // Preserve the raw stored record byte-shape for fields we are not patching —
  // the salvage projection must not silently drop staged sub-states on save.
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_PREFIX + id); } catch { return false; }
  if (!raw) return false;
  let stored: Record<string, unknown>;
  try { stored = JSON.parse(raw) as Record<string, unknown>; } catch { return false; }
  const updated = { ...stored, ...patch, schemaVersion: PROJECT_SCHEMA_VERSION, updatedAt: Date.now() };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete (updated as Record<string, unknown>)[key];
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

export function saveProject(project: SavedProject): SavedProject {
  const updated: SavedProject = { ...project, updatedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_PREFIX + updated.id, JSON.stringify(updated));
    const index = getIndex();
    if (!index.includes(updated.id)) {
      setIndex([...index, updated.id]);
    }
  } catch {
    // quota exceeded or unavailable
  }
  return updated;
}

/**
 * Update only a project's `pcb` field (PCB Stage 4 board autosave). Unlike
 * saveProject this REPORTS failure — a 200-part board with embedded footprint
 * defs is a few hundred KB, and a silent quota drop would lose layout work.
 */
export function saveProjectPcb(id: string, pcb: PcbBoard | undefined): boolean {
  const project = loadProject(id);
  if (!project) return false;
  const updated: SavedProject = { ...project, pcb, updatedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated));
    return true;
  } catch {
    return false; // quota exceeded or storage unavailable
  }
}

export function createProject(name: string, state: SchematicState): SavedProject {
  const now = Date.now();
  return saveProject({
    id: crypto.randomUUID(),
    name,
    state,
    createdAt: now,
    updatedAt: now,
  });
}

export function duplicateProject(id: string, newName: string): SavedProject | null {
  const original = loadProject(id);
  if (!original) return null;
  const duplicate = createProject(newName, original.state);
  return saveProject({
    ...duplicate,
    ai: original.ai,
    componentSelections: original.componentSelections
      ? structuredClone(original.componentSelections)
      : undefined,
  });
}

/** Persist one already-compiled immutable requirements package revision. */
export function saveProjectRequirements(id: string, requirements: DesignRequirementsPackage): boolean {
  if (requirements.projectId !== id || !validateDesignRequirementsPackage(requirements)) return false;
  const project = loadProject(id);
  if (!project) return false;
  if (project.requirements && requirements.revision <= project.requirements.revision && requirements.deterministicDigest !== project.requirements.deterministicDigest) return false;
  const invalidatesPower = Boolean(project.power && project.power.problem.requirementsPackageRef.digest !== requirements.deterministicDigest);
  const invalidatesInterfaces = Boolean(project.interfacePlanning && project.interfacePlanning.problem.requirementsPackageRevision.digest !== requirements.deterministicDigest);
  const invalidatesCircuitKnowledge = Boolean(project.circuitKnowledge && project.circuitKnowledge.problem.requirementsPackageRevision.digest !== requirements.deterministicDigest);
  const invalidatesComponentSelection = Boolean(project.componentSelectionProgram && project.componentSelectionProgram.problem.requirementsPackageRevision.digest !== requirements.deterministicDigest);
  const updated: SavedProject = { ...project, requirements: structuredClone(requirements), ...(invalidatesPower ? { power: undefined, powerHistory: [...(project.powerHistory ?? []), structuredClone(project.power!)].slice(-50) } : {}), ...((invalidatesPower || invalidatesInterfaces) && project.interfacePlanning ? { interfacePlanning: undefined, interfacePlanningHistory: [...(project.interfacePlanningHistory ?? []), structuredClone(project.interfacePlanning)].slice(-50) } : {}), ...((invalidatesPower || invalidatesInterfaces || invalidatesCircuitKnowledge) && project.circuitKnowledge ? { circuitKnowledge: undefined, circuitKnowledgeHistory: [...(project.circuitKnowledgeHistory ?? []), structuredClone(project.circuitKnowledge)].slice(-50) } : {}), ...((invalidatesPower || invalidatesInterfaces || invalidatesCircuitKnowledge || invalidatesComponentSelection) && project.componentSelectionProgram ? { componentSelectionProgram: undefined, componentSelectionProgramHistory: [...(project.componentSelectionProgramHistory ?? []), structuredClone(project.componentSelectionProgram)].slice(-50) } : {}), ...invalidateCalculationForUpstream(project, "CD-1", requirements.deterministicDigest), ...invalidateSchematicCompilationForUpstream(project, "CD-1", requirements.deterministicDigest), updatedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

/** Persist a complete integrity-checked CD-2 state without mutating design geometry. */
export function saveProjectArchitecture(id: string, architecture: ArchitectureProjectState): boolean {
  if (architecture.projectId !== id || !validateArchitectureProjectState(architecture)) return false;
  const project = loadProject(id); if (!project) return false;
  if (project.requirements && architecture.problem.requirementsPackageRef.digest !== project.requirements.deterministicDigest) return false;
  const selectedDigest = architecture.selection?.candidateDigest; const decisionDigest = architecture.selection?.deterministicDigest;
  const invalidatesPower = Boolean(project.power && (project.power.problem.architectureRef.candidateDigest !== selectedDigest || project.power.problem.architectureRef.decisionDigest !== decisionDigest));
  const invalidatesInterfaces = Boolean(project.interfacePlanning && (project.interfacePlanning.problem.systemArchitectureCandidateRevision.candidateDigest !== selectedDigest || project.interfacePlanning.problem.systemArchitectureCandidateRevision.decisionDigest !== decisionDigest));
  const invalidatesCircuitKnowledge = Boolean(project.circuitKnowledge && (project.circuitKnowledge.problem.systemArchitectureCandidateRevision.digest !== selectedDigest || project.circuitKnowledge.problem.systemArchitectureCandidateRevision.decisionDigest !== decisionDigest));
  const invalidatesComponentSelection = Boolean(project.componentSelectionProgram && (project.componentSelectionProgram.problem.systemArchitectureCandidateRevision.digest !== selectedDigest || project.componentSelectionProgram.problem.systemArchitectureCandidateRevision.decisionDigest !== decisionDigest));
  const updated: SavedProject = { ...project, architecture: structuredClone(architecture), ...(invalidatesPower ? { power: undefined, powerHistory: [...(project.powerHistory ?? []), structuredClone(project.power!)].slice(-50) } : {}), ...((invalidatesPower || invalidatesInterfaces) && project.interfacePlanning ? { interfacePlanning: undefined, interfacePlanningHistory: [...(project.interfacePlanningHistory ?? []), structuredClone(project.interfacePlanning)].slice(-50) } : {}), ...((invalidatesPower || invalidatesInterfaces || invalidatesCircuitKnowledge) && project.circuitKnowledge ? { circuitKnowledge: undefined, circuitKnowledgeHistory: [...(project.circuitKnowledgeHistory ?? []), structuredClone(project.circuitKnowledge)].slice(-50) } : {}), ...((invalidatesPower || invalidatesInterfaces || invalidatesCircuitKnowledge || invalidatesComponentSelection) && project.componentSelectionProgram ? { componentSelectionProgram: undefined, componentSelectionProgramHistory: [...(project.componentSelectionProgramHistory ?? []), structuredClone(project.componentSelectionProgram)].slice(-50) } : {}), ...invalidateCalculationForUpstream(project, "CD-2", selectedDigest), ...invalidateSchematicCompilationForUpstream(project, "CD-2", selectedDigest), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist an integrity-checked CD-3 state without mutating schematic or PCB design. */
export function saveProjectPower(id: string, power: PowerProjectState): boolean {
  if (power.projectId !== id || !validatePowerProjectState(power)) return false;
  const project = loadProject(id); if (!project?.architecture?.selection) return false;
  if (power.problem.requirementsPackageRef.digest !== project.requirements?.deterministicDigest || power.problem.architectureRef.candidateDigest !== project.architecture.selection.candidateDigest || power.problem.architectureRef.decisionDigest !== project.architecture.selection.deterministicDigest) return false;
  const selectedDigest = power.selection?.candidateDigest; const decisionDigest = power.selection?.deterministicDigest;
  const invalidatesInterfaces = Boolean(project.interfacePlanning && (project.interfacePlanning.problem.powerArchitectureCandidateRevision.candidateDigest !== selectedDigest || project.interfacePlanning.problem.powerArchitectureCandidateRevision.decisionDigest !== decisionDigest));
  const invalidatesCircuitKnowledge = Boolean(project.circuitKnowledge && (project.circuitKnowledge.problem.powerArchitectureCandidateRevision.digest !== selectedDigest || project.circuitKnowledge.problem.powerArchitectureCandidateRevision.decisionDigest !== decisionDigest));
  const invalidatesComponentSelection = Boolean(project.componentSelectionProgram && (project.componentSelectionProgram.problem.powerArchitectureCandidateRevision.digest !== selectedDigest || project.componentSelectionProgram.problem.powerArchitectureCandidateRevision.decisionDigest !== decisionDigest));
  const updated: SavedProject = { ...project, power: structuredClone(power), ...(invalidatesInterfaces && project.interfacePlanning ? { interfacePlanning: undefined, interfacePlanningHistory: [...(project.interfacePlanningHistory ?? []), structuredClone(project.interfacePlanning)].slice(-50) } : {}), ...((invalidatesInterfaces || invalidatesCircuitKnowledge) && project.circuitKnowledge ? { circuitKnowledge: undefined, circuitKnowledgeHistory: [...(project.circuitKnowledgeHistory ?? []), structuredClone(project.circuitKnowledge)].slice(-50) } : {}), ...((invalidatesInterfaces || invalidatesCircuitKnowledge || invalidatesComponentSelection) && project.componentSelectionProgram ? { componentSelectionProgram: undefined, componentSelectionProgramHistory: [...(project.componentSelectionProgramHistory ?? []), structuredClone(project.componentSelectionProgram)].slice(-50) } : {}), ...invalidateCalculationForUpstream(project, "CD-3", selectedDigest), ...invalidateSchematicCompilationForUpstream(project, "CD-3", selectedDigest), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist an integrity-checked CD-4 planning state without mutating schematic or PCB design. */
export function saveProjectInterfacePlanning(id: string, interfacePlanning: InterfaceProjectState): boolean {
  if (interfacePlanning.projectId !== id || !validateInterfaceProjectState(interfacePlanning)) return false;
  const project = loadProject(id); if (!project?.requirements || !project.architecture?.selection || !project.power?.selection) return false;
  const problem = interfacePlanning.problem;
  if (problem.requirementsPackageRevision.digest !== project.requirements.deterministicDigest || problem.systemArchitectureCandidateRevision.candidateDigest !== project.architecture.selection.candidateDigest || problem.systemArchitectureCandidateRevision.decisionDigest !== project.architecture.selection.deterministicDigest || problem.powerArchitectureCandidateRevision.candidateDigest !== project.power.selection.candidateDigest || problem.powerArchitectureCandidateRevision.decisionDigest !== project.power.selection.deterministicDigest) return false;
  const selectedDigest = interfacePlanning.selection?.candidateDigest; const decisionDigest = interfacePlanning.selection?.deterministicDigest;
  const invalidatesCircuitKnowledge = Boolean(project.circuitKnowledge && (project.circuitKnowledge.problem.interfaceContractSetRevision.digest !== selectedDigest || project.circuitKnowledge.problem.interfaceContractSetRevision.decisionDigest !== decisionDigest));
  const invalidatesComponentSelection = Boolean(project.componentSelectionProgram && (project.componentSelectionProgram.problem.interfacePlanningCandidateRevision.digest !== selectedDigest || project.componentSelectionProgram.problem.interfacePlanningCandidateRevision.decisionDigest !== decisionDigest));
  const updated: SavedProject = { ...project, interfacePlanning: structuredClone(interfacePlanning), ...(invalidatesCircuitKnowledge && project.circuitKnowledge ? { circuitKnowledge: undefined, circuitKnowledgeHistory: [...(project.circuitKnowledgeHistory ?? []), structuredClone(project.circuitKnowledge)].slice(-50) } : {}), ...((invalidatesCircuitKnowledge || invalidatesComponentSelection) && project.componentSelectionProgram ? { componentSelectionProgram: undefined, componentSelectionProgramHistory: [...(project.componentSelectionProgramHistory ?? []), structuredClone(project.componentSelectionProgram)].slice(-50) } : {}), ...invalidateCalculationForUpstream(project, "CD-4", selectedDigest), ...invalidateSchematicCompilationForUpstream(project, "CD-4", selectedDigest), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist an integrity-checked CD-5 state without instantiating or mutating schematic/PCB design. */
export function saveProjectCircuitKnowledge(id: string, circuitKnowledge: CircuitKnowledgeProjectState): boolean {
  if (circuitKnowledge.projectId !== id || validateCircuitKnowledgeProjectState(circuitKnowledge).length) return false;
  const project = loadProject(id); if (!project?.requirements || !project.architecture?.selection || !project.power?.selection || !project.interfacePlanning?.selection) return false;
  const problem = circuitKnowledge.problem;
  if (problem.requirementsPackageRevision.digest !== project.requirements.deterministicDigest || problem.systemArchitectureCandidateRevision.digest !== project.architecture.selection.candidateDigest || problem.systemArchitectureCandidateRevision.decisionDigest !== project.architecture.selection.deterministicDigest || problem.powerArchitectureCandidateRevision.digest !== project.power.selection.candidateDigest || problem.powerArchitectureCandidateRevision.decisionDigest !== project.power.selection.deterministicDigest || problem.interfaceContractSetRevision.digest !== project.interfacePlanning.selection.candidateDigest || problem.interfaceContractSetRevision.decisionDigest !== project.interfacePlanning.selection.deterministicDigest) return false;
  const invalidatesComponentSelection = Boolean(project.componentSelectionProgram && project.componentSelectionProgram.problem.recipeBindingProblemRevision.stateDigest !== circuitKnowledge.deterministicDigest);
  const updated: SavedProject = { ...project, circuitKnowledge: structuredClone(circuitKnowledge), ...(invalidatesComponentSelection && project.componentSelectionProgram ? { componentSelectionProgram: undefined, componentSelectionProgramHistory: [...(project.componentSelectionProgramHistory ?? []), structuredClone(project.componentSelectionProgram)].slice(-50) } : {}), ...invalidateCalculationForUpstream(project, "CD-5", circuitKnowledge.deterministicDigest), ...invalidateSchematicCompilationForUpstream(project, "CD-5", circuitKnowledge.deterministicDigest), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist one integrity-checked CD-6 state without mutating schematic or PCB truth. */
export function saveProjectComponentSelectionProgram(id: string, componentSelectionProgram: ComponentSelectionProjectState): boolean {
  if (componentSelectionProgram.projectId !== id || validateComponentSelectionProjectState(componentSelectionProgram).length) return false;
  const project = loadProject(id); if (!project?.requirements || !project.architecture?.selection || !project.power?.selection || !project.interfacePlanning?.selection || !project.circuitKnowledge) return false;
  const problem = componentSelectionProgram.problem;
  if (problem.requirementsPackageRevision.digest !== project.requirements.deterministicDigest || problem.systemArchitectureCandidateRevision.digest !== project.architecture.selection.candidateDigest || problem.systemArchitectureCandidateRevision.decisionDigest !== project.architecture.selection.deterministicDigest || problem.powerArchitectureCandidateRevision.digest !== project.power.selection.candidateDigest || problem.powerArchitectureCandidateRevision.decisionDigest !== project.power.selection.deterministicDigest || problem.interfacePlanningCandidateRevision.digest !== project.interfacePlanning.selection.candidateDigest || problem.interfacePlanningCandidateRevision.decisionDigest !== project.interfacePlanning.selection.deterministicDigest || problem.recipeBindingProblemRevision.stateDigest !== project.circuitKnowledge.deterministicDigest) return false;
  const updated: SavedProject = { ...project, componentSelectionProgram: structuredClone(componentSelectionProgram), ...invalidateCalculationForUpstream(project, "CD-6", componentSelectionProgram.deterministicDigest), ...invalidateSchematicCompilationForUpstream(project, "CD-6", componentSelectionProgram.deterministicDigest), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist one integrity-checked CD-7 state without mutating schematic or PCB truth. */
export function saveProjectCalculationProgram(id: string, calculationProgram: CalculationProjectState): boolean {
  if (calculationProgram.projectId !== id || validateCalculationProjectState(calculationProgram).length) return false;
  const project = loadProject(id); if (!project?.requirements || !project.architecture?.selection || !project.power?.selection || !project.interfacePlanning?.selection || !project.circuitKnowledge || !project.componentSelectionProgram) return false;
  const refs = new Map(calculationProgram.problem.upstreamRevisionRefs.map((item) => [item.stage, item.digest]));
  if (refs.get("CD-1") !== project.requirements.deterministicDigest || refs.get("CD-2") !== project.architecture.selection.candidateDigest || refs.get("CD-3") !== project.power.selection.candidateDigest || refs.get("CD-4") !== project.interfacePlanning.selection.candidateDigest || refs.get("CD-5") !== project.circuitKnowledge.deterministicDigest || refs.get("CD-6") !== project.componentSelectionProgram.deterministicDigest) return false;
  const updated: SavedProject = { ...project, calculationProgram: structuredClone(calculationProgram), ...invalidateSchematicCompilationForUpstream(project, "CD-7", calculationProgram.deterministicDigest), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist one integrity-checked CD-8 semantic compiler state without overwriting the legacy editor or PCB. */
export function saveProjectSchematicCompilationProgram(id: string, schematicCompilationProgram: SchematicProjectState): boolean {
  if (schematicCompilationProgram.projectId !== id || validateSchematicProjectState(schematicCompilationProgram).length) return false;
  const project = loadProject(id); if (!project?.requirements || !project.architecture?.selection || !project.power?.selection || !project.interfacePlanning?.selection || !project.circuitKnowledge || !project.componentSelectionProgram || !project.calculationProgram) return false;
  const refs = new Map(schematicCompilationProgram.problem.upstreamRevisionRefs.map((item) => [item.stage, item.digest]));
  if (refs.get("CD-1") !== project.requirements.deterministicDigest || refs.get("CD-2") !== project.architecture.selection.candidateDigest || refs.get("CD-3") !== project.power.selection.candidateDigest || refs.get("CD-4") !== project.interfacePlanning.selection.candidateDigest || refs.get("CD-5") !== project.circuitKnowledge.deterministicDigest || refs.get("CD-6") !== project.componentSelectionProgram.deterministicDigest || refs.get("CD-7") !== project.calculationProgram.deterministicDigest) return false;
  const invalidatesCircuitVerification = Boolean(project.circuitVerificationProgram && project.circuitVerificationProgram.problem.cd8ProjectDigest !== schematicCompilationProgram.deterministicDigest);
  const updated: SavedProject = { ...project, schematicCompilationProgram: structuredClone(schematicCompilationProgram), ...(invalidatesCircuitVerification ? { circuitVerificationProgram: undefined, circuitVerificationProgramHistory: [...(project.circuitVerificationProgramHistory ?? []), structuredClone(project.circuitVerificationProgram!)].slice(-50), ...archiveModelSimulation(project) } : {}), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist integrity-checked CD-9 evidence without mutating schematic or PCB truth. */
export function saveProjectCircuitVerificationProgram(id: string, circuitVerificationProgram: CircuitVerificationProjectState): boolean {
  if (circuitVerificationProgram.projectId !== id || validateCircuitVerificationProjectState(circuitVerificationProgram).length) return false;
  const project = loadProject(id);
  if (!project?.schematicCompilationProgram || circuitVerificationProgram.problem.cd8ProjectDigest !== project.schematicCompilationProgram.deterministicDigest) return false;
  const invalidatesCd10 = Boolean(project.modelSimulationProgram && project.modelSimulationProgram.problem.circuitVerificationProjectDigest !== circuitVerificationProgram.deterministicDigest);
  const updated: SavedProject = { ...project, circuitVerificationProgram: structuredClone(circuitVerificationProgram), ...(invalidatesCd10 ? archiveModelSimulation(project) : {}), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist integrity-checked CD-10 metadata. Authoritative waveform/model bytes remain content-addressed backend artifacts. */
export function saveProjectModelSimulationProgram(id: string, modelSimulationProgram: ModelSimulationProjectState): boolean {
  if (modelSimulationProgram.projectId !== id || validateModelSimulationProject(modelSimulationProgram).length) return false;
  const project = loadProject(id); if (!project?.schematicCompilationProgram || !project.circuitVerificationProgram) return false;
  if (modelSimulationProgram.problem.cd8ProjectDigest !== project.schematicCompilationProgram.deterministicDigest || modelSimulationProgram.problem.circuitVerificationProjectDigest !== project.circuitVerificationProgram.deterministicDigest) return false;
  const invalidatesCd11 = Boolean(project.firmwareBringUpProgram && project.firmwareBringUpProgram.problem.simulationReadinessReportDigest !== modelSimulationProgram.readinessReports.at(-1)?.deterministicDigest);
  const updated: SavedProject = { ...project, modelSimulationProgram: structuredClone(modelSimulationProgram), ...(invalidatesCd11 ? archiveFirmwareBringUp(project) : {}), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist an integrity-checked CD-11 co-design package without changing schematic, PCB, firmware, or hardware evidence. */
export function saveProjectFirmwareBringUpProgram(id: string, firmwareBringUpProgram: FirmwareBringUpProjectState): boolean {
  if (firmwareBringUpProgram.projectId !== id || validateFirmwareBringUpProject(firmwareBringUpProgram).length) return false;
  const project = loadProject(id); if (!project?.modelSimulationProgram) return false;
  const latest = project.modelSimulationProgram.readinessReports.at(-1); if (!latest || firmwareBringUpProgram.problem.simulationReadinessReportDigest !== latest.deterministicDigest) return false;
  const invalidatesCd12 = Boolean(project.releaseEngineeringProgram && project.releaseEngineeringProgram.problem.firmwareBringUpProjectDigest !== firmwareBringUpProgram.deterministicDigest);
  const updated: SavedProject = { ...project, firmwareBringUpProgram: structuredClone(firmwareBringUpProgram), ...(invalidatesCd12 ? archiveReleaseEngineering(project) : {}), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist an integrity-checked CD-12 release-engineering state without creating orders, factory evidence, or release authority. */
export function saveProjectReleaseEngineeringProgram(id: string, releaseEngineeringProgram: ReleaseEngineeringProjectState): boolean {
  if (releaseEngineeringProgram.projectId !== id || validateReleaseEngineeringProject(releaseEngineeringProgram).length) return false;
  const project = loadProject(id); if (!project?.firmwareBringUpProgram) return false;
  const pkg = project.firmwareBringUpProgram.packages.at(-1), decision = project.firmwareBringUpProgram.readinessDecisions.at(-1);
  if (!pkg || !decision || decision.verdict !== "ready" || pkg.readinessState !== "ready" || releaseEngineeringProgram.problem.firmwareBringUpProjectDigest !== project.firmwareBringUpProgram.deterministicDigest || releaseEngineeringProgram.problem.firmwareTestBringUpPackageDigest !== pkg.deterministicDigest) return false;
  const updated: SavedProject = { ...project, releaseEngineeringProgram: structuredClone(releaseEngineeringProgram), ...(project.fullFlowProgram ? archiveFullFlow(project) : {}), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist integrity-checked CD-13 event/candidate/trace state without committing lower-stage engineering truth. */
export function saveProjectFullFlowProgram(id: string, fullFlowProgram: FullFlowProjectState): boolean {
  if (fullFlowProgram.projectId !== id || validateFullFlowProject(fullFlowProgram).length) return false;
  const project = loadProject(id); if (!project) return false;
  const updated: SavedProject = { ...project, fullFlowProgram: structuredClone(fullFlowProgram), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }
}

/** Persist one exact atomic selection and its schematic instance IDs atomically. */
export function saveProjectComponentSelection(
  projectId: string,
  componentInstanceId: string,
  pin: ProjectComponentPin,
): boolean {
  if (pin.embeddedSnapshot.atomicRevision.id !== pin.atomicRevisionId) return false;
  if (pin.embeddedSnapshot.symbol.versionId !== pin.symbolVersionId) return false;
  if (pin.footprintVersionId && pin.embeddedSnapshot.footprint?.versionId !== pin.footprintVersionId) return false;
  if (pin.mappingCertificateId && pin.embeddedSnapshot.mapping?.id !== pin.mappingCertificateId) return false;
  if (pin.modelVersionIds.some((id) => !pin.embeddedSnapshot.models.some((model) => model.versionId === id))) return false;
  if (portableSnapshotIntegrityErrors(pin.embeddedSnapshot).length > 0) return false;
  const project = loadProject(projectId);
  if (!project) return false;
  const instances = project.state.kicadComponents ?? [];
  if (!instances.some((instance) => instance.id === componentInstanceId)) return false;
  const priorAtomicRevision = project.componentSelections?.[componentInstanceId]?.atomicRevisionId;
  const invalidatesExactInterfaceAllocation = Boolean(priorAtomicRevision && priorAtomicRevision !== pin.atomicRevisionId && project.interfacePlanning?.candidates.some((candidate) => candidate.exactAllocationCandidates.length));
  const updated: SavedProject = {
    ...project,
    state: {
      ...project.state,
      kicadComponents: instances.map((instance) => instance.id === componentInstanceId
        ? {
            ...instance,
            atomicPartRevisionId: pin.atomicRevisionId,
            symbolAssetVersionId: pin.symbolVersionId,
            footprintAssetVersionId: pin.footprintVersionId,
            mappingCertificateId: pin.mappingCertificateId,
            selectionRecordId: pin.selectionRecordId,
          }
        : instance),
    },
    componentSelections: {
      ...(project.componentSelections ?? {}),
      [componentInstanceId]: structuredClone(pin),
    },
    ...(invalidatesExactInterfaceAllocation && project.interfacePlanning ? { interfacePlanning: undefined, interfacePlanningHistory: [...(project.interfacePlanningHistory ?? []), structuredClone(project.interfacePlanning)].slice(-50) } : {}),
    ...(project.componentSelectionProgram ? { componentSelectionProgram: undefined, componentSelectionProgramHistory: [...(project.componentSelectionProgramHistory ?? []), structuredClone(project.componentSelectionProgram)].slice(-50) } : {}),
    ...(project.calculationProgram ? { calculationProgram: undefined, calculationProgramHistory: [...(project.calculationProgramHistory ?? []), structuredClone(project.calculationProgram)].slice(-50) } : {}),
    ...(project.schematicCompilationProgram ? { schematicCompilationProgram: undefined, schematicCompilationProgramHistory: [...(project.schematicCompilationProgramHistory ?? []), structuredClone(project.schematicCompilationProgram)].slice(-50) } : {}),
    ...(project.circuitVerificationProgram ? { circuitVerificationProgram: undefined, circuitVerificationProgramHistory: [...(project.circuitVerificationProgramHistory ?? []), structuredClone(project.circuitVerificationProgram)].slice(-50) } : {}),
    ...archiveModelSimulation(project),
    ...archiveFirmwareBringUp(project),
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

export function renameProject(id: string, newName: string): SavedProject | null {
  const project = loadProject(id);
  if (!project) return null;
  return saveProject({ ...project, name: newName });
}

export function deleteProject(id: string): boolean {
  try {
    const index = getIndex();
    if (!index.includes(id)) return false;
    localStorage.removeItem(STORAGE_PREFIX + id);
    setIndex(index.filter((i) => i !== id));
    return true;
  } catch {
    return false;
  }
}

export function clearAllProjects(): void {
  const ids = getIndex();
  for (const id of ids) {
    try { localStorage.removeItem(STORAGE_PREFIX + id); } catch { /* ignore */ }
  }
  setIndex([]);
}

export function exportProjectJSON(project: SavedProject): string {
  return JSON.stringify(project, null, 2);
}

// ─── Import / validation ──────────────────────────────────────────────────────

export function isStoredChatMessage(v: unknown): v is StoredChatMessage {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  if (typeof m["id"] !== "string") return false;
  if (m["role"] === "user" || m["role"] === "assistant") return typeof m["content"] === "string";
  if (m["role"] !== "log") return false;
  return typeof m["title"] === "string"
    && (m["status"] === "running" || m["status"] === "done" || m["status"] === "error")
    && Array.isArray(m["entries"])
    && (m["entries"] as unknown[]).every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return typeof e["id"] === "string" && typeof e["text"] === "string" && (e["status"] === "running" || e["status"] === "done" || e["status"] === "error");
    });
}

function isPoint(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p["x"] === "number" && typeof p["y"] === "number";
}

export function isComponent(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c["id"] === "string" &&
    typeof c["type"] === "string" &&
    typeof c["x"] === "number" &&
    typeof c["y"] === "number" &&
    (c["rotation"] === 0 || c["rotation"] === 90 || c["rotation"] === 180 || c["rotation"] === 270) &&
    typeof c["value"] === "string"
  );
}

export function isWire(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w["id"] === "string" &&
    Array.isArray(w["vertices"]) &&
    (w["vertices"] as unknown[]).every(isPoint)
  );
}

export function isNetLabel(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l["id"] === "string" &&
    isPoint(l["position"]) &&
    typeof l["name"] === "string" &&
    (l["kind"] === "label" || l["kind"] === "power" || l["kind"] === "ground") &&
    (l["orientation"] === 0 || l["orientation"] === 90 || l["orientation"] === 180 || l["orientation"] === 270)
  );
}

/** Persist a completed release record without mutating the PCB design. */
export function saveProjectPcbRelease(id: string, release: ManufacturingReleaseManifest): boolean {
  try {
    // Historical evidence must not materialize lazy board migrations or mutate
    // the semantic design as a side effect. Read and preserve the stored PCB
    // byte shape directly for this metadata-only transaction.
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return false;
    const project = JSON.parse(raw) as SavedProject;
    const existing = project.pcbReleases ?? [];
    const releases = [
      ...existing.filter((item) => item.transactionId !== release.transactionId),
      release,
    ].slice(-100);
    const updated: SavedProject = { ...project, pcbReleases: releases, updatedAt: Date.now() };
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

export function isPcbBoardLike(v: unknown): v is PcbBoard {
  if (typeof v !== "object" || v === null) return false;
  const board = v as Record<string, unknown>;
  return board["formatVersion"] === 1
    && (board["stackup"] === 2 || board["stackup"] === 4)
    && Array.isArray(board["nets"])
    && Array.isArray(board["footprints"])
    && Array.isArray(board["tracks"])
    && Array.isArray(board["vias"])
    && Array.isArray(board["zones"])
    && Array.isArray(board["texts"]);
}

export function isKicadInstance(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const k = v as Record<string, unknown>;
  return (
    typeof k["id"] === "string" &&
    typeof k["partId"] === "string" &&
    typeof k["x"] === "number" &&
    typeof k["y"] === "number" &&
    (k["rotation"] === 0 || k["rotation"] === 90 || k["rotation"] === 180 || k["rotation"] === 270) &&
    typeof k["refDes"] === "string" &&
    typeof k["value"] === "string" &&
    (k["atomicPartRevisionId"] === undefined || typeof k["atomicPartRevisionId"] === "string") &&
    (k["symbolAssetVersionId"] === undefined || typeof k["symbolAssetVersionId"] === "string") &&
    (k["footprintAssetVersionId"] === undefined || typeof k["footprintAssetVersionId"] === "string") &&
    (k["mappingCertificateId"] === undefined || typeof k["mappingCertificateId"] === "string") &&
    (k["selectionRecordId"] === undefined || typeof k["selectionRecordId"] === "string")
  );
}

function isProjectComponentPin(v: unknown): v is ProjectComponentPin {
  if (typeof v !== "object" || v === null) return false;
  const pin = v as Record<string, unknown>;
  const embedded = pin["embeddedSnapshot"];
  if (typeof embedded !== "object" || embedded === null) return false;
  const snapshot = embedded as Record<string, unknown>;
  const revision = snapshot["atomicRevision"];
  const symbol = snapshot["symbol"];
  const footprint = snapshot["footprint"];
  const mapping = snapshot["mapping"];
  const models = snapshot["models"];
  return (
    typeof pin["selectionRecordId"] === "string" &&
    typeof pin["atomicRevisionId"] === "string" &&
    typeof pin["symbolVersionId"] === "string" &&
    Array.isArray(pin["modelVersionIds"]) &&
    (pin["modelVersionIds"] as unknown[]).every((id) => typeof id === "string") &&
    typeof revision === "object" && revision !== null &&
    (revision as Record<string, unknown>)["id"] === pin["atomicRevisionId"] &&
    typeof symbol === "object" && symbol !== null &&
    (symbol as Record<string, unknown>)["versionId"] === pin["symbolVersionId"] &&
    (pin["footprintVersionId"] === undefined || (
      typeof footprint === "object" && footprint !== null &&
      (footprint as Record<string, unknown>)["versionId"] === pin["footprintVersionId"]
    )) &&
    (pin["mappingCertificateId"] === undefined || (
      typeof mapping === "object" && mapping !== null &&
      (mapping as Record<string, unknown>)["id"] === pin["mappingCertificateId"]
    )) &&
    Array.isArray(models) &&
    (pin["modelVersionIds"] as string[]).every((id) =>
      models.some((model) => typeof model === "object" && model !== null && (model as Record<string, unknown>)["versionId"] === id),
    ) &&
    portableSnapshotIntegrityErrors(snapshot as unknown as ProjectComponentPin["embeddedSnapshot"]).length === 0
  );
}

export function importProjectJSON(json: string): SavedProject | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "Invalid JSON" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { error: "Invalid project format" };
  }
  const p = parsed as Record<string, unknown>;

  if (typeof p["name"] !== "string") return { error: "Missing or invalid name" };
  if (typeof p["state"] !== "object" || p["state"] === null) return { error: "Missing state" };

  const state = p["state"] as Record<string, unknown>;
  if (!Array.isArray(state["components"])) return { error: "Missing components array" };
  if (!Array.isArray(state["wires"]))      return { error: "Missing wires array" };
  if (!(state["components"] as unknown[]).every(isComponent)) {
    return { error: "Invalid component in components array" };
  }
  if (!(state["wires"] as unknown[]).every(isWire)) {
    return { error: "Invalid wire in wires array" };
  }
  // kicadComponents is optional; migrate older saves to [] and validate when present.
  const kicad = state["kicadComponents"];
  if (kicad !== undefined && (!Array.isArray(kicad) || !kicad.every(isKicadInstance))) {
    return { error: "Invalid kicadComponents array" };
  }
  state["kicadComponents"] = Array.isArray(kicad) ? kicad : [];

  // netLabels is optional; migrate older saves to [] and validate when present.
  const labels = state["netLabels"];
  if (labels !== undefined && (!Array.isArray(labels) || !labels.every(isNetLabel))) {
    return { error: "Invalid netLabels array" };
  }
  state["netLabels"] = Array.isArray(labels) ? labels : [];

  // pageSize is optional; reject a present-but-invalid value, migrate older
  // saves that lack it to the default.
  const ps = state["pageSize"];
  if (ps !== undefined && !isPageSize(ps)) {
    return { error: "Invalid pageSize" };
  }
  state["pageSize"] = isPageSize(ps) ? ps : DEFAULT_PAGE_SIZE;

  const now = Date.now();
  const projectId = crypto.randomUUID();
  let pcb: PcbBoard | undefined;
  if (p["pcb"] !== undefined) {
    if (!isPcbBoardLike(p["pcb"])) return { error: "Invalid PCB board" };
    const migration = migrateBoardElectricalIdentities(p["pcb"], projectId);
    const blocking = migration.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (blocking) return { error: `Invalid PCB board: ${blocking.summary}` };
    const constraintMigration = migrateBoardConstraintState(migration.board, projectId);
    const constraintBlocking = constraintMigration.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (constraintBlocking) return { error: `Invalid PCB constraints: ${constraintBlocking.summary}` };
    pcb = constraintMigration.board;
  }
  const rawAi = p["ai"];
  let ai: AiProjectSettings | undefined;
  if (typeof rawAi === "object" && rawAi !== null) {
    const candidate = rawAi as Record<string, unknown>;
    if (candidate.brain === "openai" || candidate.brain === "anthropic") {
      ai = {
        brain: candidate.brain,
        embeddings: "openai",
        providerHistory: Array.isArray(candidate.providerHistory)
          ? (candidate.providerHistory as AiProjectSettings["providerHistory"])
          : [],
      };
    }
  }
  let componentSelections: Record<string, ProjectComponentPin> | undefined;
  const rawSelections = p["componentSelections"];
  if (rawSelections !== undefined) {
    if (typeof rawSelections !== "object" || rawSelections === null || Array.isArray(rawSelections)) {
      return { error: "Invalid componentSelections" };
    }
    const entries = Object.entries(rawSelections as Record<string, unknown>);
    if (!entries.every(([, value]) => isProjectComponentPin(value))) {
      return { error: "Invalid atomic component selection" };
    }
    componentSelections = Object.fromEntries(entries) as Record<string, ProjectComponentPin>;
  }
  if (p["requirements"] !== undefined) {
    // Imported projects receive a new project identity. Rebinding stable requirement
    // IDs must be an explicit fork transaction; silently rewriting provenance is unsafe.
    return { error: "Imported requirements need an explicit CD-1 project-fork migration" };
  }
  if (p["architecture"] !== undefined) {
    // CD-2 IDs and decisions pin the original project, branch, and CD-1 digest.
    // A project import creates a new identity, so silent rebinding is forbidden.
    return { error: "Imported architecture needs an explicit CD-2 project-fork migration" };
  }
  if (p["power"] !== undefined) {
    // CD-3 pins both upstream stages and cannot be silently rebound to the new import identity.
    return { error: "Imported power architecture needs an explicit CD-3 project-fork migration" };
  }
  if (p["powerHistory"] !== undefined) return { error: "Imported power history needs an explicit CD-3 project-fork migration" };
  if (p["interfacePlanning"] !== undefined) return { error: "Imported interface planning needs an explicit CD-4 project-fork migration" };
  if (p["interfacePlanningHistory"] !== undefined) return { error: "Imported interface planning history needs an explicit CD-4 project-fork migration" };
  if (p["circuitKnowledge"] !== undefined) return { error: "Imported circuit knowledge needs an explicit CD-5 project-fork migration" };
  if (p["circuitKnowledgeHistory"] !== undefined) return { error: "Imported circuit knowledge history needs an explicit CD-5 project-fork migration" };
  if (p["componentSelectionProgram"] !== undefined) return { error: "Imported component selection needs an explicit CD-6 project-fork migration" };
  if (p["componentSelectionProgramHistory"] !== undefined) return { error: "Imported component selection history needs an explicit CD-6 project-fork migration" };
  if (p["calculationProgram"] !== undefined) return { error: "Imported calculation state needs an explicit CD-7 project-fork migration" };
  if (p["calculationProgramHistory"] !== undefined) return { error: "Imported calculation history needs an explicit CD-7 project-fork migration" };
  if (p["schematicCompilationProgram"] !== undefined) return { error: "Imported semantic schematic state needs an explicit CD-8 project-fork migration" };
  if (p["schematicCompilationProgramHistory"] !== undefined) return { error: "Imported semantic schematic history needs an explicit CD-8 project-fork migration" };
  if (p["circuitVerificationProgram"] !== undefined) return { error: "Imported circuit verification state needs an explicit CD-9 project-fork migration" };
  if (p["circuitVerificationProgramHistory"] !== undefined) return { error: "Imported circuit verification history needs an explicit CD-9 project-fork migration" };
  if (p["modelSimulationProgram"] !== undefined) return { error: "Imported model simulation state needs an explicit CD-10 project-fork migration" };
  if (p["modelSimulationProgramHistory"] !== undefined) return { error: "Imported model simulation history needs an explicit CD-10 project-fork migration" };
  if (p["firmwareBringUpProgram"] !== undefined) return { error: "Imported firmware bring-up state needs an explicit CD-11 project-fork migration" };
  if (p["firmwareBringUpProgramHistory"] !== undefined) return { error: "Imported firmware bring-up history needs an explicit CD-11 project-fork migration" };
  if (p["releaseEngineeringProgram"] !== undefined) return { error: "Imported release-engineering state needs an explicit CD-12 project-fork migration" };
  if (p["releaseEngineeringProgramHistory"] !== undefined) return { error: "Imported release-engineering history needs an explicit CD-12 project-fork migration" };
  if (p["fullFlowProgram"] !== undefined) return { error: "Imported full-flow state needs an explicit CD-13 project-fork migration" };
  if (p["fullFlowProgramHistory"] !== undefined) return { error: "Imported full-flow history needs an explicit CD-13 project-fork migration" };
  return saveProject({
    id: projectId,
    name: p["name"] as string,
    state: state as unknown as SchematicState,
    createdAt: typeof p["createdAt"] === "number" ? p["createdAt"] : now,
    updatedAt: now,
    ...(pcb ? { pcb } : {}),
    ...(ai ? { ai } : {}),
    ...(componentSelections ? { componentSelections } : {}),
  });
}
