"use client";

import { ChatMarkdown } from "@/app/components/chat/ChatMarkdown";
import { DatasheetLink } from "@/app/components/parts/DatasheetLink"; // [B19-D I5c row 34, review]
import { useState, useRef, useEffect, useLayoutEffect, useReducer, useMemo, useCallback, type Dispatch, type SetStateAction, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
const PcbEditor = dynamic(() => import("@/app/components/pcb/PcbEditor"), { ssr: false }); // Pixi needs window
const SpiceStudio = dynamic(() => import("@/app/components/spice/SpiceStudio"), { ssr: false });
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Cable, CircuitBoard, Box, Receipt, Activity, Play, Download, Settings,
  Settings2, Search, MessageSquare, Circle, Triangle, Zap, Sigma, BatteryCharging,
  Cpu, Component, ChevronDown, ChevronRight, ChevronLeft, Check, AlertTriangle,
  FolderOpen, Package, Maximize2, Minimize2, ChevronsDown, MousePointer, Pencil,
  Scissors, Sparkles, Loader2, Move, Crosshair, GripVertical, X, CircleDot, Tag,
} from "lucide-react";
import { getKeyBindings } from "./lib/keybindings";
import { GRID, snap, pointEquals, pointKey, closestPointOnSegment, distance, pinWorldPos, kicadPinWorldPos, KICAD_SCALE_PX_PER_MM, pointStrictlyOnWireInterior } from "./lib/geometry";
import { findConnectedGroup, splitWiresAtPoint, consolidateWires, type KicadPinSite } from "./lib/connectivity";
import { classifyNets, type NetRole } from "./lib/nets";
import { rangeAwareTickFormatter } from "./lib/format";
import { schDisplayRef, type SchComponent, type Wire, type Point, type SchComponentType, type SchematicState, type KicadComponentInstance, type BuildLogicalNetlist, type NetLabel, type NetLabelKind, type Rotation, type SchematicEditOp, type PageSize } from "@/lib/schematic-types";
import { useSchematicViewSession } from "@/app/components/schematic/hooks/useSchematicViewSession"; // [B17-D]
import { describeExportRefusal } from "@/app/lib/project/io-outcome"; // [B17-E]
import { ProjectOperationTimeline } from "@/app/lib/project/operation-timeline"; // [B17-E]
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { useWorkspaceViewSession } from "@/app/components/workspace/useWorkspaceViewSession"; // [B17-D]
import { WORKSPACE_TABS } from "@/app/lib/view-session/workspace"; // [B17-D]
import { PIN_NAMES, normalizeComponentRole } from "@/lib/schematic-types";
import { pageSizePx, titleBlockPx, PAGE_MARGIN_PX } from "@/lib/page-sizes";
import { generateSchematic } from "@/lib/apply-netlist";
import { autoLayoutBuildValidated } from "@/lib/build-auto-layout";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist";
import { buildReviewInput } from "@/lib/netlist-review";
import { BuildLibraryPanel } from "@/app/components/editor/BuildLibraryPanel";
import { BomView } from "@/app/components/bom/BomView";
import { KicadSymbolInline } from "@/app/components/schematic/KicadSymbol";
import { getCachedPart, ensurePartLoaded, subscribeToPart, type CachedPart } from "@/app/lib/parts-cache";
import {
  AiProviderUnavailableError,
  loadAiBrainPreference,
  saveAiBrainPreference,
  throwAiResponseError,
  type AiRequestOwnership,
} from "@/app/lib/ai-preferences";
import type { LLMProviderId } from "@/app/lib/llm/types";
import { performProviderSwitch, settleAgentRunFailure } from "@/app/lib/agent/run-consumer";
import { EditorContextBridge } from "@/app/lib/agent/editor-context-bridge"; // B10
import { ViewSessionBridge } from "@/app/lib/agent/view-session-bridge"; // [B17-F]
import { useViewSessionBridge } from "@/app/components/view-session/useViewSessionBridge"; // [B17-F]
import { receiveLayoutCandidateEvent } from "@/app/lib/project/layout-candidate-events"; // [B17-F]
import { receiveExecutionGrantReadyEvent, receiveExecutionSettledEvent, type ReceivedExecutionGrant } from "@/app/lib/project/execution-grant-events"; // [B18-B]
import { COMPOSER_ROUTE_LABELS, routeComposerMessage, type ComposerRoute } from "@/app/lib/project/composer-routing"; // [B18-D I1]
import { layoutCandidateChatLine } from "@/app/lib/agent/layout-report"; // [B18-E E17]
import { EXECUTION_ENTRY_ID_PREFIX, editProposalMessages, editRouteProvenanceNote, entryAttemptRefused, entryCancelled, entryEditorOutcome, entryExecuting, entryFromGrant, entryRecovery, entrySettled, entryStateOfLogMessage, entrySuperseded, entryToLogMessage, entryUndoAvailability, entryUndoResult, initialRunView, markGrantLineDropped, projectRunView, replacementChatLines, reduceRunView, refusedLineLabel, restoredEntryLog, runViewGrantDropped, runViewGrantReceived, toolLineLabel, type ExecutionEntry } from "@/app/lib/project/chat-run-view"; // [B18-D I6]
import { ExecutionEntryActions } from "@/app/components/chat/ExecutionEntryActions"; // [B18-D I8]
import { AutonomyModeControl } from "@/app/components/chat/AutonomyModeControl"; // [B18-D I11]
import type { LayoutCandidate } from "@/app/lib/pcb/candidates/layout-candidate"; // [B17-F]
import { listProjects, saveProjectFields, renameProject, deleteProject, type SavedProject, type StoredChatMessage } from "@/lib/persistence";
import { bootstrapCurrentProject, createProjectRecord, loadProjectRecord, markProjectCurrent, type ProjectBootstrap } from "@/app/lib/project/current";
import { createAutosaver, settleAutosaveForTransition, type Autosaver, type SaveStatus } from "@/app/lib/project/autosave";
import { SchematicHistory, type SchematicHistoryView } from "@/app/lib/project/schematic-history";
import { checkpointBelongsToProject, checkpointStore, type ProjectCheckpoint } from "@/app/lib/project/checkpoints";
// B06: canonical schematic semantic mutations — the migrated handlers issue
// shared domain commands through the trusted schematic editor session.
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { describeSchematicProposal } from "@/app/lib/workflow/prompt-to-gerber/review-summary"; // [B16.1C §F]
import type { SchematicCanonicalMark } from "@/app/lib/engineering/schematic-projection";
import { compileTier1Proposal, planSchematicDelete, planSchematicReplacement } from "@/app/lib/engineering/schematic-plans";
import { sealTier1Proposal, TIER1_PROPOSAL_SCHEMA, type SealedTier1Proposal } from "@/app/lib/engineering/schematic-proposals";
import { loadSessionIdentity, sessionAuthorizationBindingFrom, SESSION_IDENTITY_UNAVAILABLE_MESSAGE } from "@/app/lib/project/session-identity";
import { projectSelectorHeaders } from "@/app/lib/project/project-selector";

/**
 * [B16-C.5] Every authenticated AI request names the ACTIVE project as a
 * SELECTOR (`x-sirkit-*` headers) exactly like the simulation and BOM
 * transports do. The trusted-context boundary refuses a selector-less request
 * with `AUTH_PROJECT_SELECTOR_REQUIRED` (400) — the page-level browser proof
 * found the Build-mode generation, edit, review, tidy and second-opinion
 * fetches sending none. A selector is never authority: the server still loads
 * the caller's live membership for that scope.
 */
function aiRequestHeaders(scope: { projectId: string | null; branchId: string }): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...projectSelectorHeaders(scope.projectId ? { tenantId: "local", projectId: scope.projectId, branchId: scope.branchId } : null),
  };
}
import { createMembershipReauthorizer } from "@/app/lib/project/membership-reauthorization";
import { applyApprovedTier1Proposal, approvedMutationAudit, type ApprovedMutationReceipt } from "@/app/lib/engineering/approved-agent-mutations";
import { type ReplacementMutationReceipt } from "@/app/lib/engineering/approved-replacement-mutations";
import { type SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import { approveAndApplyReplacement } from "@/app/lib/project/replacement-approval-controller.internal";
import { receiveReplacementProposalEvent } from "@/app/lib/project/replacement-proposal-events";
import { receivePcbProposalReadyEvent } from "@/app/lib/project/pcb-proposal-events";
import { type SealedPcbEditProposal } from "@/app/lib/pcb/proposal/sealed-pcb-edit-proposal";
import { ReplacementReviewDialog } from "@/app/components/schematic/ReplacementReviewDialog";
import { fromCanonicalSchematic, schematicStateDigest, validateSchematicStateIntegrity } from "@/app/lib/engineering/schematic-model";
import { schematicMarkPatch } from "@/app/lib/engineering/schematic-projection";
import { diffSchematicGraphOps, nextTheoryDisplayRef, type SchematicGraphAfter } from "@/app/lib/engineering/schematic-graph";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { ProjectTransitionCoordinator, type ProjectInstallResult } from "@/app/lib/engineering/project-transition-coordinator";
import { ApprovedMutationJournal } from "@/app/lib/engineering/approved-mutation-journal";
import { IndexedDbApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal-idb";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { evaluateSchematicConsumerGate } from "@/app/lib/engineering/schematic-consumer-gate";
import { LatestRequestGate, OwnedRecoveryDecisionAdapter, OwnedSimulationRunner, ProjectAsyncScopeRegistry, evaluateSuggestionBatch, type ProjectAsyncScope, type ScopedSuggestionBatch } from "@/app/lib/engineering/project-async-scope";
import type { CanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import { exportProjectFile, importProjectFile, PROJECT_FILE_EXTENSION, readProjectFile } from "@/app/lib/project/file";
import { chatHistoryForModel } from "@/app/lib/project/chat-history"; // [B19-D I5e row 32]
import { buildSuggestionInstruction } from "@/app/lib/project/suggestion-instruction"; // [B19-D I5e row 05]
import { requestBoardRestore } from "@/app/lib/pcb/board-restore";
import { Undo2, Redo2, History, Save, FolderInput } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Mode = "theory" | "build";
type View = "schematic" | "pcb" | "3d" | "bom" | "sim";
/** The undoable schematic model state (R06 Section 7). */
type SchematicSnapshot = {
  components: SchComponent[];
  wires: Wire[];
  kicadComponents: KicadComponentInstance[];
  netLabels: NetLabel[];
};
type LeftPanel = "projects" | "library" | null;
// [B19-D I5e row 32] `advisory`: another model's output (build explanation, review, second opinion) — shown, never resent as the assistant's words
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; advisory?: boolean };
type ActivityLogEntry = { id: string; text: string; status: "running" | "done" | "error" };
type ActivityLogMessage = {
  id: string;
  role: "log";
  title: string;
  status: "running" | "done" | "error";
  entries: ActivityLogEntry[];
};
type Message = ChatMessage | ActivityLogMessage;
type AiProviderFailureState = { provider: LLMProviderId };
type AiRuntimeProviderInfo = {
  model: string;
  label: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  appContextCapTokens?: number | null;
  reasoningEffort?: string;
};
type AiRuntimeInfo = {
  providers: Record<LLMProviderId, AiRuntimeProviderInfo>;
  embeddings: { provider: "openai"; model: string };
};
// B07.4 — suggestion items live inside a project/session/base-scoped batch
// (ScopedSuggestionBatch from project-async-scope); the shape matches
// ScopedSuggestionItem.
// B06.2/B07.2/B07.5 — the pending schematic-history recovery decision. The
// record carries its owning PROJECT ID; every recovery decision submission
// re-checks it (and the captured session) against a captured
// ProjectAsyncScope, so a decision begun in one project can never resolve
// into another.
type ActiveSchematicRecovery = {
  kind: "projection-conflict" | "corrupt-history" | "invalid-projection";
  detail: string;
  /** projection-conflict reason (B07.2: "invalid-projection-identity" hides keep-local). */
  reason?: string;
  /** Sanitized validation issues (invalid-projection). */
  issues?: string[];
  canonicalState?: SchematicState;
  projection: SchematicState;
  projectId: string;
};
// "kicad-place" carries no partId itself — the part to place lives in separate
// state (placementPartId), so Tool stays a simple string union. Likewise
// "netlabel-place" carries no name/kind — those live in pendingNetLabel.
type Tool =
  | "select" | "wire" | "delete" | "junction"
  | SchComponentType
  | "kicad-place"
  | "label"            // generic net-label tool: click opens a name input
  | "netlabel-place";  // quick-place of a preset label (GND, +3V3, …)

// Preset for the quick-place buttons in the toolbar.
type PendingNetLabel = { name: string; kind: NetLabelKind };

const QUICK_LABELS: PendingNetLabel[] = [
  { name: "GND",  kind: "ground" },
  { name: "+3V3", kind: "power" },
  { name: "+5V",  kind: "power" },
  { name: "VCC",  kind: "power" },
];

const SUPPORT_SUGGESTION_RE =
  /\b(decoupl|bypass|bulk|pull[-\s]?(up|down)|series|current[-\s]?limit|terminat|bias|capacitor|cap\b|resistor|ferrite|bead|filter|tvs|esd|protection|flyback|bootstrap|crystal|load\s*cap|support)\b/i;
const UNSAFE_APPLY_SUGGESTION_RE =
  /\b(second opinion has more|more\s+(ic|mcu|microcontroller|processor|controller|connector)s?|missing\s+(mcu|microcontroller|processor|controller)|add\s+(an?\s+)?(mcu|microcontroller|processor|controller))\b/i;

function isSupportSuggestion(s: { title: string; detail: string; category?: string }): boolean {
  const text = `${s.category ?? ""} ${s.title} ${s.detail}`;
  return SUPPORT_SUGGESTION_RE.test(text) && !UNSAFE_APPLY_SUGGESTION_RE.test(text);
}

function isGuardedSupportApplyInstruction(text: string): boolean {
  return text.startsWith("Apply ONLY the bounded support-circuit suggestions below.");
}

// Hit-test radius for net labels (delete / drag).
const NET_LABEL_HIT_RADIUS = 15;
type SimMode = "probe" | "move";

type AnalysisType = "tran" | "ac" | "dc" | "op";

type AnalysisConfig =
  | { type: "tran"; tstep: string; tstop: string }
  | { type: "ac"; sweep: "dec" | "oct" | "lin"; points: number; fstart: string; fstop: string }
  | { type: "dc"; source: string; vstart: string; vstop: string; vstep: string }
  | { type: "op" };

type SimResult = {
  analysis: string;
  analysisType: AnalysisType;
  variables: string[];
  points: Record<string, number>[];
  nodeMap: Record<string, string>;
  pinNodes: Record<string, string>;
};

type Pane = {
  id: string;
  signals: Set<string>;
};

const ANALYSIS_STORAGE_KEY = "sirkit:lastAnalysisConfig";

const DEFAULT_ANALYSIS_CONFIGS: { [K in AnalysisType]: Extract<AnalysisConfig, { type: K }> } = {
  tran: { type: "tran", tstep: "10u", tstop: "10m" },
  ac:   { type: "ac", sweep: "dec", points: 10, fstart: "1", fstop: "1Meg" },
  dc:   { type: "dc", source: "V1", vstart: "0", vstop: "10", vstep: "0.1" },
  op:   { type: "op" },
};

const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  tran: "Transient",
  ac:   "AC",
  dc:   "DC sweep",
  op:   "Op point",
};

function loadAnalysisConfig(): AnalysisConfig {
  try {
    const raw = localStorage.getItem(ANALYSIS_STORAGE_KEY);
    if (!raw) return DEFAULT_ANALYSIS_CONFIGS.tran;
    const parsed = JSON.parse(raw) as AnalysisConfig;
    if (parsed && typeof parsed === "object" && "type" in parsed &&
        (parsed.type === "tran" || parsed.type === "ac" ||
         parsed.type === "dc"   || parsed.type === "op")) {
      return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_ANALYSIS_CONFIGS.tran;
}

function pickDefaultSignal(variables: string[], analysisType: AnalysisType): string | null {
  const sweptPattern = /^(time|frequency|v-sweep)$/i;
  const candidates = variables.filter((v) => !sweptPattern.test(v));
  if (analysisType === "ac") {
    const mags = candidates.filter((v) => v.endsWith(".mag")).sort();
    if (mags.length > 0) return mags[mags.length - 1];
  }
  const voltages = candidates.filter((v) => /^v\(.+\)$/i.test(v)).sort();
  if (voltages.length > 0) return voltages[voltages.length - 1];
  return candidates.sort()[candidates.length - 1] ?? null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const theoryParts: { icon: LucideIcon; label: string; note: string; shortcut?: string }[] = [
  { icon: Sigma,           label: "Resistor",        note: "ideal R",    shortcut: "R" },
  { icon: Circle,          label: "Capacitor",       note: "ideal C",    shortcut: "C" },
  { icon: Activity,        label: "Inductor",        note: "ideal L",    shortcut: "L" },
  { icon: BatteryCharging, label: "Voltage source",  note: "DC / AC",   shortcut: "V" },
  { icon: Zap,             label: "Current source",  note: "DC / AC",   shortcut: "I" },
  { icon: Triangle,        label: "Diode",           note: "behavioral", shortcut: "D" },
  { icon: Cpu,             label: "BJT (NPN / PNP)", note: "transistor" },
  { icon: Cpu,             label: "MOSFET (N / P)",  note: "transistor" },
  { icon: Component,       label: "Op-amp",          note: "behavioral" },
  { icon: ChevronsDown,    label: "Ground",          note: "GND",        shortcut: "G" },
];

const SCH_PART_MAP: Record<string, { type: SchComponentType; defaultValue: string } | null> = {
  Resistor:           { type: "resistor",        defaultValue: "10k" },
  Capacitor:          { type: "capacitor",       defaultValue: "100n" },
  Inductor:           { type: "inductor",        defaultValue: "10µ" },
  "Voltage source":   { type: "voltage-source",  defaultValue: "9V" },
  "Current source":   { type: "current-source",  defaultValue: "1m" },
  Diode:              { type: "diode",           defaultValue: "1N4148" },
  Ground:             { type: "ground",          defaultValue: "" },
  "BJT (NPN / PNP)":  null,
  "MOSFET (N / P)":   null,
  "Op-amp":           null,
};

const COMP_DEFAULTS: Record<SchComponentType, string> = {
  resistor: "10k", capacitor: "100n", inductor: "10µ",
  "voltage-source": "9V", "current-source": "1m",
  diode: "1N4148", ground: "",
};

const buildCategories = [
  { label: "Resistors",              count: 4823 },
  { label: "Capacitors",             count: 3210 },
  { label: "Inductors",              count: 412  },
  { label: "Transistors",            count: 1184 },
  { label: "Diodes / LEDs",          count: 967  },
  { label: "Voltage regulators",     count: 542  },
  { label: "ICs / Microcontrollers", count: 2098 },
  { label: "Connectors",             count: 1773 },
  { label: "Crystals / Oscillators", count: 287  },
];

const SCH_TYPE_LABEL: Record<SchComponentType, string> = {
  resistor: "Resistor", capacitor: "Capacitor", inductor: "Inductor",
  "voltage-source": "Voltage Source", "current-source": "Current Source",
  diode: "Diode", ground: "Ground",
};

const SPICE_PREFIX: Record<SchComponentType, string> = {
  resistor: "R", capacitor: "C", inductor: "L", diode: "D",
  "voltage-source": "V", "current-source": "I", ground: "G",
};

const PROBE_COLORS = ["#14b8a6", "#f59e0b", "#f43f5e", "#8b5cf6", "#84cc16", "#0ea5e9"];

const PROBE_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M3 17 L7 13 M5 15 L10 8 L12 10 L17 5 L19 7 L14 12 L12 10' stroke='%2314b8a6' stroke-width='1.5' fill='none' stroke-linecap='round'/><circle cx='3' cy='17' r='1.5' fill='%2314b8a6'/></svg>") 3 17, crosshair`;

// Crosshair with a small filled dot — the Junction tool cursor.
const JUNCTION_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M10 1 V6 M10 14 V19 M1 10 H6 M14 10 H19' stroke='%2314b8a6' stroke-width='1.5' stroke-linecap='round'/><circle cx='10' cy='10' r='2.5' fill='%2314b8a6'/></svg>") 10 10, crosshair`;

const PROBE_PIN_OFFSETS: Record<SchComponentType, Record<string, Point>> = {
  resistor:         { left: { x: -30, y: 0 }, right: { x: 30, y: 0 } },
  capacitor:        { left: { x: -30, y: 0 }, right: { x: 30, y: 0 } },
  inductor:         { left: { x: -30, y: 0 }, right: { x: 30, y: 0 } },
  diode:            { anode: { x: -30, y: 0 }, cathode: { x: 30, y: 0 } },
  "voltage-source": { "+": { x: 0, y: -30 }, "-": { x: 0, y: 30 } },
  "current-source": { "+": { x: 0, y: -30 }, "-": { x: 0, y: 30 } },
  ground:           { pin: { x: 0, y: -20 } },
};

// B07.1 — mirrors spiceName in app/lib/netlist.ts EXACTLY (display-reference
// derived); probe keys must keep matching the emitted element names.
function frontendSpiceName(comp: SchComponent): string {
  const prefix = SPICE_PREFIX[comp.type];
  const display = schDisplayRef(comp).trim().toUpperCase();
  return display.startsWith(prefix) ? display : prefix + display;
}

function compProbeKey(comp: SchComponent): string | null {
  const name = frontendSpiceName(comp).toLowerCase();
  switch (comp.type) {
    case "resistor": case "capacitor": case "inductor":
      return `@${name}[i]`;
    case "diode":
      return `@${name}[id]`;
    case "voltage-source": case "current-source":
      return `i(${name})`;
    case "ground":
      // Ground reference: v(0) is always 0 but useful as a baseline trace.
      return "v(0)";
    default: return null;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

// True for any placement tool (the seven Theory types or KiCad placement).
// Used to gate pointer-events so placement clicks reach the canvas.
function isPlacementTool(t: Tool): boolean {
  return t !== "select" && t !== "wire" && t !== "delete" && t !== "junction";
}

// True only for the seven Theory placement tools (narrows to SchComponentType).
function isTheoryPlacementTool(t: Tool): t is SchComponentType {
  return isPlacementTool(t) && t !== "kicad-place" && t !== "label" && t !== "netlabel-place";
}

// Reference-designator prefix for a KiCad part, from its "Reference" property
// (e.g. "U", "R", "C"). Defaults to "U".
function kicadRefPrefix(part: CachedPart | null): string {
  const ref = part?.properties?.["Reference"];
  const letters = ref ? ref.replace(/[^A-Za-z]/g, "") : "";
  return letters || "U";
}

// Next available reference designator for a part's prefix, scanning existing
// KiCad instances (e.g. "U1", "U2", …).
function nextKicadRefDes(part: CachedPart | null, kicad: KicadComponentInstance[]): string {
  const prefix = kicadRefPrefix(part);
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const k of kicad) {
    const m = re.exec(k.refDes);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

// Default display value for a placed KiCad part: its "Value" property, else name.
function kicadDefaultValue(part: CachedPart | null): string {
  return part?.properties?.["Value"] || part?.name || "";
}

// ─── Wire-tool magnet snap ────────────────────────────────────────────────────

type SnapKind = "pin" | "wire-endpoint" | "wire-interior";
type SnapTarget = { point: Point; kind: SnapKind; wireId?: string };

// Wire-tool snap precedence: pin > wire-endpoint > wire-interior. Within
// a precedence tier the closest hit wins. Returns null if nothing is within
// radius of the cursor.
function findSnapTarget(
  cursor: Point,
  components: SchComponent[],
  wires: Wire[],
  radius: number,
  kicadPinPoints: Point[] = [],
): SnapTarget | null {
  // 1. Pins (Theory components first, then KiCad part pins)
  let best: { target: SnapTarget; d: number } | null = null;
  for (const comp of components) {
    for (const pin of PIN_NAMES[comp.type] ?? []) {
      const p = pinWorldPos(comp, pin);
      const d = distance(cursor, p);
      if (d <= radius && (best === null || d < best.d)) {
        best = { d, target: { point: p, kind: "pin" } };
      }
    }
  }
  for (const p of kicadPinPoints) {
    const d = distance(cursor, p);
    if (d <= radius && (best === null || d < best.d)) {
      best = { d, target: { point: p, kind: "pin" } };
    }
  }
  if (best) return best.target;

  // 2. Wire endpoints
  for (const w of wires) {
    const first = w.vertices[0];
    const last  = w.vertices[w.vertices.length - 1];
    for (const v of [first, last]) {
      if (!v) continue;
      const d = distance(cursor, v);
      if (d <= radius && (best === null || d < best.d)) {
        best = { d, target: { point: v, kind: "wire-endpoint", wireId: w.id } };
      }
    }
  }
  if (best) return best.target;

  // 3. Wire interiors (closest point on each segment, excluding endpoints)
  for (const w of wires) {
    for (let i = 0; i < w.vertices.length - 1; i++) {
      const s = w.vertices[i];
      const e = w.vertices[i + 1];
      const cp = closestPointOnSegment(cursor, s, e);
      if (pointEquals(cp, s) || pointEquals(cp, e)) continue;
      const d = distance(cursor, cp);
      if (d <= radius && (best === null || d < best.d)) {
        best = { d, target: { point: cp, kind: "wire-interior", wireId: w.id } };
      }
    }
  }
  return best?.target ?? null;
}

// ─── Junction tool: wire-crossing detection ──────────────────────────────────

// Crossing point of two axis-aligned segments when one is horizontal, the
// other vertical, and their INTERIORS intersect (strict — endpoint touches
// don't count, so a crossing here is always splittable on both wires).
function perpendicularCrossing(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const aH = a1.y === a2.y && a1.x !== a2.x;
  const bH = b1.y === b2.y && b1.x !== b2.x;
  let h1: Point, h2: Point, v1: Point, v2: Point;
  if (aH && !bH) { h1 = a1; h2 = a2; v1 = b1; v2 = b2; }
  else if (!aH && bH) { h1 = b1; h2 = b2; v1 = a1; v2 = a2; }
  else return null; // parallel (or degenerate) — never a single crossing point
  if (v1.x !== v2.x) return null;
  const x = v1.x;
  const y = h1.y;
  if (x <= Math.min(h1.x, h2.x) || x >= Math.max(h1.x, h2.x)) return null;
  if (y <= Math.min(v1.y, v2.y) || y >= Math.max(v1.y, v2.y)) return null;
  return { x, y };
}

// Nearest point within `radius` of the cursor where two or more wires'
// interiors cross. Wires that don't come within `radius` of the cursor are
// skipped first, which bounds the pairwise sweep to a handful of candidates
// regardless of schematic size.
function findWireCrossingNear(cursor: Point, wires: Wire[], radius: number): Point | null {
  const near: Wire[] = [];
  for (const w of wires) {
    let close = false;
    for (let i = 0; i < w.vertices.length - 1 && !close; i++) {
      const cp = closestPointOnSegment(cursor, w.vertices[i], w.vertices[i + 1]);
      if (distance(cursor, cp) <= radius) close = true;
    }
    if (close) near.push(w);
  }
  let best: { p: Point; d: number } | null = null;
  for (let a = 0; a < near.length; a++) {
    for (let b = a + 1; b < near.length; b++) {
      for (let i = 0; i < near[a].vertices.length - 1; i++) {
        for (let j = 0; j < near[b].vertices.length - 1; j++) {
          const p = perpendicularCrossing(
            near[a].vertices[i], near[a].vertices[i + 1],
            near[b].vertices[j], near[b].vertices[j + 1],
          );
          if (!p) continue;
          const d = distance(cursor, p);
          if (d <= radius && (best === null || d < best.d)) best = { p, d };
        }
      }
    }
  }
  return best?.p ?? null;
}

function screenToWorld(
  e: { clientX: number; clientY: number },
  svg: SVGSVGElement,
  pan: Point,
  zoom: number
): Point {
  const r = svg.getBoundingClientRect();
  return {
    x: snap((e.clientX - r.left - pan.x) / zoom),
    y: snap((e.clientY - r.top  - pan.y) / zoom),
  };
}

function lbend(from: Point, to: Point): Point {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx >= dy ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

// ─── Stretch-mode movement (double-click drag) ───────────────────────────────
// Single-click drag moves the whole connected group rigidly (LTspice F8);
// double-click drag moves ONLY the clicked component, and wires attached to
// its pins stretch to follow (LTspice F7). Junctions with other wires may
// break — that's expected; the user re-wires manually.

const DOUBLE_CLICK_MS = 350;

type DragMode = "rigid" | "stretch";

// Move one end of a polyline by (dx, dy). If the end segment would go
// diagonal, insert an L-bend corner that preserves the segment's ORIGINAL
// direction: a horizontal segment stays horizontal from the unmoved side and
// bends vertically at the moved pin's new x (symmetrically for vertical;
// degenerate zero-length segments default to horizontal-first).
function stretchPolylineEnd(vertices: Point[], end: "first" | "last", dx: number, dy: number): Point[] {
  if (end === "first") {
    return stretchPolylineEnd([...vertices].reverse(), "last", dx, dy).reverse();
  }
  const verts = vertices.map((v) => ({ ...v }));
  const moved = verts[verts.length - 1];
  const target = { x: moved.x + dx, y: moved.y + dy };
  const neighbor = verts[verts.length - 2];
  if (!neighbor) return [target];
  const wasVertical = moved.x === neighbor.x && moved.y !== neighbor.y;
  verts[verts.length - 1] = target;
  if (target.x === neighbor.x || target.y === neighbor.y) {
    // Pin moved along the segment's own axis — the endpoint just slides.
    // Drop the end segment entirely if it collapsed onto the neighbor.
    if (pointEquals(target, neighbor) && verts.length > 2) verts.splice(verts.length - 2, 1);
    return verts;
  }
  const corner = wasVertical
    ? { x: neighbor.x, y: target.y }
    : { x: target.x, y: neighbor.y };
  verts.splice(verts.length - 1, 0, corner);
  return verts;
}

// Stretch-mode wire update: endpoints sitting on one of the moved component's
// ORIGINAL pin positions follow that pin by (dx, dy); all other wires are
// returned untouched. Always called against the drag-start snapshot so
// corners don't accumulate across mousemoves.
function stretchWire(wire: Wire, movedPinKeys: Set<string>, dx: number, dy: number): Wire {
  const first = wire.vertices[0];
  const last = wire.vertices[wire.vertices.length - 1];
  const firstHit = first !== undefined && movedPinKeys.has(pointKey(first));
  const lastHit = wire.vertices.length > 1 && movedPinKeys.has(pointKey(last));
  if (!firstHit && !lastHit) return wire;
  let verts = wire.vertices;
  if (lastHit) verts = stretchPolylineEnd(verts, "last", dx, dy);
  if (firstHit) verts = stretchPolylineEnd(verts, "first", dx, dy);
  return { ...wire, vertices: verts };
}

// ─── Pin topology helpers ─────────────────────────────────────────────────────

// Rotates a local point by the given rotation. Used inside SVG transforms for
// component pin/probe visuals — geometry.pinWorldPos has the snapping-aware
// world-coordinate variant.
function rotatePoint(p: Point, rotation: 0 | 90 | 180 | 270): Point {
  switch (rotation) {
    case 0:   return { x:  p.x, y:  p.y };
    case 90:  return { x: -p.y, y:  p.x };
    case 180: return { x: -p.x, y: -p.y };
    case 270: return { x:  p.y, y: -p.x };
  }
}

// ─── SVG symbol sub-components ───────────────────────────────────────────────

const SK = "#a1a1aa";
const SW = 1.5;

function ResistorSymbol() {
  return <>
    <line x1="-30" y1="0" x2="-14" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <polyline points="-14,0 -10,-8 -6,8 -2,-8 2,8 6,-8 10,8 14,0"
      stroke={SK} strokeWidth={SW} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="14" y1="0" x2="30" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function CapacitorSymbol() {
  return <>
    <line x1="-30" y1="0" x2="-4" y2="0"   stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="-4"  y1="-10" x2="-4" y2="10" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="4"   y1="-10" x2="4"  y2="10" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="4"   y1="0"  x2="30" y2="0"   stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function InductorSymbol() {
  return <>
    <line x1="-30" y1="0" x2="-18" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <path d="M-18,0 A6,6 0 0,1 -6,0 A6,6 0 0,1 6,0 A6,6 0 0,1 18,0"
      stroke={SK} strokeWidth={SW} fill="none" strokeLinecap="round" />
    <line x1="18" y1="0" x2="30" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function DiodeSymbol() {
  return <>
    <line x1="-30" y1="0" x2="-10" y2="0" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <polygon points="-10,-8 -10,8 10,0"
      stroke={SK} strokeWidth={SW} fill={SK} fillOpacity={0.15} strokeLinejoin="round" />
    <line x1="10" y1="-8" x2="10" y2="8"  stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="10" y1="0"  x2="30" y2="0"  stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function VoltageSourceSymbol() {
  return <>
    <line x1="0" y1="-30" x2="0" y2="-14" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <circle cx="0" cy="0" r="14" stroke={SK} strokeWidth={SW} fill="none" />
    <text x="0" y="-4" textAnchor="middle" fontSize={10} fill={SK} fontFamily="monospace">+</text>
    <text x="0" y="8"  textAnchor="middle" fontSize={10} fill={SK} fontFamily="monospace">−</text>
    <line x1="0" y1="14" x2="0" y2="30" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function CurrentSourceSymbol() {
  return <>
    <line x1="0" y1="-30" x2="0" y2="-14" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <circle cx="0" cy="0" r="14" stroke={SK} strokeWidth={SW} fill="none" />
    <line x1="0" y1="8" x2="0" y2="-8" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <polyline points="-4,-4 0,-8 4,-4"
      stroke={SK} strokeWidth={SW} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="0" y1="14" x2="0" y2="30" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

function GroundSymbol() {
  return <>
    <line x1="0"   y1="-20" x2="0"  y2="-8" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="-12" y1="-8"  x2="12" y2="-8" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="-8"  y1="-2"  x2="8"  y2="-2" stroke={SK} strokeWidth={SW} strokeLinecap="round" />
    <line x1="-4"  y1="4"   x2="4"  y2="4"  stroke={SK} strokeWidth={SW} strokeLinecap="round" />
  </>;
}

const COMP_BBOX: Record<SchComponentType, { x: number; y: number; w: number; h: number }> = {
  resistor:         { x: -30, y: -10, w: 60, h: 20 },
  capacitor:        { x: -30, y: -12, w: 60, h: 24 },
  inductor:         { x: -30, y: -8,  w: 60, h: 16 },
  diode:            { x: -30, y: -10, w: 60, h: 20 },
  "voltage-source": { x: -16, y: -32, w: 32, h: 64 },
  "current-source": { x: -16, y: -32, w: 32, h: 64 },
  ground:           { x: -14, y: -22, w: 28, h: 30 },
};

const VALUE_LABEL: Record<SchComponentType, { x: number; y: number; anchor: string } | null> = {
  resistor:         { x: 0,  y: 22, anchor: "middle" },
  capacitor:        { x: 0,  y: 24, anchor: "middle" },
  inductor:         { x: 0,  y: 20, anchor: "middle" },
  diode:            { x: 0,  y: 22, anchor: "middle" },
  "voltage-source": { x: 22, y: 6,  anchor: "start"  },
  "current-source": { x: 22, y: 6,  anchor: "start"  },
  ground:           null,
};

// Reference designator (R1, C2, V1…), placed opposite the value. Grounds are
// conventionally unlabeled.
const REFDES_LABEL: Record<SchComponentType, { x: number; y: number; anchor: string } | null> = {
  resistor:         { x: 0,  y: -14, anchor: "middle" },
  capacitor:        { x: 0,  y: -16, anchor: "middle" },
  inductor:         { x: 0,  y: -12, anchor: "middle" },
  diode:            { x: 0,  y: -14, anchor: "middle" },
  "voltage-source": { x: 22, y: -7,  anchor: "start"  },
  "current-source": { x: 22, y: -7,  anchor: "start"  },
  ground:           null,
};

function ComponentSymbol({
  comp, selected, deleteHovered, dragHighlight, onMouseDown, onMouseEnter, onMouseLeave,
  pointerEvents,
}: {
  comp: SchComponent;
  selected: boolean;
  deleteHovered?: boolean;
  dragHighlight?: DragMode;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  pointerEvents?: "auto" | "none";
}) {
  const bb = COMP_BBOX[comp.type];
  const vl = VALUE_LABEL[comp.type];
  const rl = REFDES_LABEL[comp.type];

  let shape: React.ReactNode;
  switch (comp.type) {
    case "resistor":        shape = <ResistorSymbol />;       break;
    case "capacitor":       shape = <CapacitorSymbol />;      break;
    case "inductor":        shape = <InductorSymbol />;       break;
    case "diode":           shape = <DiodeSymbol />;          break;
    case "voltage-source":  shape = <VoltageSourceSymbol />;  break;
    case "current-source":  shape = <CurrentSourceSymbol />; break;
    case "ground":          shape = <GroundSymbol />;         break;
  }

  return (
    <g
      transform={`translate(${comp.x},${comp.y}) rotate(${comp.rotation})`}
      style={{
        cursor: deleteHovered ? "crosshair"
          : dragHighlight === "stretch" ? "move"
          : dragHighlight === "rigid" ? "grabbing"
          : "grab",
        pointerEvents: pointerEvents ?? "auto",
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <rect
        x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
        fill="transparent"
        pointerEvents={pointerEvents === "none" ? "none" : "all"}
      />
      {shape}
      {dragHighlight === "stretch" && (
        <rect
          x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
          fill="none" stroke="#2dd4bf" strokeWidth={1.5} rx={3}
        />
      )}
      {dragHighlight === "rigid" && (
        <rect
          x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
          fill="none" stroke="#2dd4bf" strokeWidth={0.75} strokeDasharray="4 2" rx={2}
        />
      )}
      {selected && (
        <rect
          x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
          fill="none" stroke="#d4d4d8" strokeWidth={0.75} strokeDasharray="4 2" rx={2}
        />
      )}
      {deleteHovered && (
        <rect
          x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
          fill="#ef4444" fillOpacity={0.15} stroke="#ef4444" strokeWidth={0.75} rx={2}
        />
      )}
      {rl && schDisplayRef(comp) && (
        <text
          x={rl.x} y={rl.y}
          textAnchor={rl.anchor as "middle" | "start"}
          fontSize={10} fontFamily="monospace" fill="#d4d4d8"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {schDisplayRef(comp)}
        </text>
      )}
      {vl && comp.value && (
        <text
          x={vl.x} y={vl.y}
          textAnchor={vl.anchor as "middle" | "start"}
          fontSize={10} fontFamily="monospace" fill="#71717a"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {comp.value}
        </text>
      )}
    </g>
  );
}

function GhostSymbol({ type, x, y, rotation }: { type: SchComponentType; x: number; y: number; rotation: 0 | 90 | 180 | 270 }) {
  const bb = COMP_BBOX[type];
  return (
    <g transform={`translate(${x},${y}) rotate(${rotation})`} opacity={0.5} style={{ pointerEvents: "none" }}>
      <rect x={bb.x} y={bb.y} width={bb.w} height={bb.h}
        fill="none" stroke="#14b8a6" strokeWidth={0.75} strokeDasharray="3 2" rx={2} />
    </g>
  );
}

// ─── Net label rendering ──────────────────────────────────────────────────────

// Display colors for net-label glyphs/text, slightly lighter than the wire
// palette so labels read on the dark canvas.
const LABEL_ROLE_COLORS: Record<NetRole, string> = {
  power: "#f87171",   // red-400
  ground: "#71717a",  // zinc-500
  signal: "#2dd4bf",  // teal-400
  unknown: "#a1a1aa", // zinc-400
};

// Text metrics for net-label names. The text NEVER rotates — only the
// flag/arrow group does — so labels on vertical pins still read left-to-right.
const LABEL_FONT_SIZE = 16;
const LABEL_FONT_WEIGHT = 600;
const LABEL_TEXT_GAP = 6;    // clearance between a flag tip and its text
const LABEL_CHAR_W = 9.6;    // monospace advance at 16px (0.6em)

// Glyph reach from the anchor along the extent direction (world px).
const POWER_TIP = 32;        // stem + wedge (2.0x the KiCad-standard base)
const GROUND_TIP = 28;       // stem + three bars
const LABEL_LEAD = 12;       // generic flag's lead-in line
const LABEL_FLAG_HALF_H = 11;// generic flag half-height (1.8x the old 6)
const VLABEL_BODY = 22;      // compact pentagon body for vertical generic flags

// The world direction a glyph extends after rotation. Natural directions —
// power up, generic east, ground down — must match NATURAL_LABEL_DIRECTION in
// lib/build-auto-layout.ts; `orientation` steps clockwise from there.
type LabelDir = "north" | "east" | "south" | "west";
const LABEL_DIR_ORDER: LabelDir[] = ["north", "east", "south", "west"];
const LABEL_NATURAL_STEP: Record<NetLabelKind, number> = { power: 0, label: 1, ground: 2 };

function labelWorldDir(kind: NetLabelKind, orientation: Rotation): LabelDir {
  return LABEL_DIR_ORDER[(LABEL_NATURAL_STEP[kind] + orientation / 90) % 4];
}

// Horizontal-text placement just past the flag tip, reading outward from the
// pin. East/west text vertical-centers on the flag height ("middle" baseline).
function labelTextProps(dir: LabelDir, tip: number): {
  x: number; y: number;
  textAnchor: "start" | "middle" | "end";
  dominantBaseline: "middle" | "hanging" | "auto";
} {
  const d = tip + LABEL_TEXT_GAP;
  switch (dir) {
    case "north": return { x: 0,  y: -d, textAnchor: "middle", dominantBaseline: "auto" };
    case "south": return { x: 0,  y: d,  textAnchor: "middle", dominantBaseline: "hanging" };
    case "east":  return { x: d,  y: 0,  textAnchor: "start",  dominantBaseline: "middle" };
    case "west":  return { x: -d, y: 0,  textAnchor: "end",    dominantBaseline: "middle" };
  }
}

/**
 * A net label glyph anchored at label.position (the electrical connection
 * point sits at the local origin). Natural directions: power flags point up,
 * ground symbols hang down, generic flags extend east; `orientation` rotates
 * the FLAG clockwise from there. The text never rotates — it sits just past
 * the flag tip (or inside a horizontal generic flag) reading left-to-right.
 */
function NetLabelGlyph({
  label, role, zoom, ghost, deleteHovered, pointerEvents,
  onMouseDown, onMouseEnter, onMouseLeave,
}: {
  label: NetLabel;
  role: NetRole;
  zoom: number;
  ghost?: boolean;
  deleteHovered?: boolean;
  pointerEvents?: "auto" | "none";
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const name = label.name.trim().toUpperCase();
  const dir = labelWorldDir(label.kind, label.orientation);
  const horizontal = dir === "east" || dir === "west";
  let flag: React.ReactNode;   // rotates with label.orientation
  let text: React.ReactNode;   // never rotates

  if (label.kind === "ground") {
    const showName = name !== "GND" && name !== "0";
    flag = (
      <>
        {/* Invisible grab area over the glyph (≥24px thick). */}
        <rect x={-12} y={-2} width={24} height={32} fill="transparent" />
        <line x1={0} y1={0} x2={0} y2={16} stroke="#a1a1aa" strokeWidth={1.5} strokeLinecap="round" />
        <line x1={-9} y1={16} x2={9} y2={16} stroke="#a1a1aa" strokeWidth={1.5} strokeLinecap="round" />
        <line x1={-6} y1={22} x2={6} y2={22} stroke="#a1a1aa" strokeWidth={1.5} strokeLinecap="round" />
        <line x1={-3} y1={28} x2={3} y2={28} stroke="#a1a1aa" strokeWidth={1.5} strokeLinecap="round" />
      </>
    );
    if (showName) {
      const tp = labelTextProps(dir, GROUND_TIP);
      text = (
        <text {...tp} fontSize={LABEL_FONT_SIZE} fontWeight={LABEL_FONT_WEIGHT}
          fontFamily="monospace" fill="#71717a" style={{ userSelect: "none" }}>
          {name}
        </text>
      );
    }
  } else if (label.kind === "power") {
    flag = (
      <>
        <rect x={-14} y={-34} width={28} height={36} fill="transparent" />
        <line x1={0} y1={0} x2={0} y2={-16} stroke="#f87171" strokeWidth={1.5} strokeLinecap="round" />
        <polygon points="-12,-16 12,-16 0,-32" fill="#f87171" />
      </>
    );
    const tp = labelTextProps(dir, POWER_TIP);
    text = (
      <text {...tp} fontSize={LABEL_FONT_SIZE} fontWeight={LABEL_FONT_WEIGHT}
        fontFamily="monospace" fill="#f87171" style={{ userSelect: "none" }}>
        {name}
      </text>
    );
  } else {
    const color = LABEL_ROLE_COLORS[role];
    // Horizontal flags enclose the text, so their width tracks the name;
    // vertical flags stay compact and the text sits past the tip instead.
    const textW = Math.max(20, name.length * LABEL_CHAR_W);
    const flagEnd = horizontal ? LABEL_LEAD + 6 + textW + 6 : LABEL_LEAD + VLABEL_BODY;
    const tip = flagEnd + LABEL_FLAG_HALF_H;
    flag = (
      <>
        <rect x={-2} y={-13} width={tip + 4} height={26} fill="transparent" />
        <line x1={0} y1={0} x2={LABEL_LEAD} y2={0} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
        <polygon
          points={`${LABEL_LEAD},${-LABEL_FLAG_HALF_H} ${flagEnd},${-LABEL_FLAG_HALF_H} ${tip},0 ${flagEnd},${LABEL_FLAG_HALF_H} ${LABEL_LEAD},${LABEL_FLAG_HALF_H}`}
          fill={color} fillOpacity={0.12} stroke={color} strokeWidth={1} strokeLinejoin="round"
        />
      </>
    );
    // Inside the flag when it lies flat (the text IS the flag content);
    // past the tip when the flag points up or down.
    const tp = horizontal
      ? {
          x: dir === "east" ? LABEL_LEAD + 6 : -(LABEL_LEAD + 6),
          y: 0,
          textAnchor: (dir === "east" ? "start" : "end") as "start" | "end",
          dominantBaseline: "middle" as const,
        }
      : labelTextProps(dir, tip);
    text = (
      <text {...tp} fontSize={LABEL_FONT_SIZE} fontWeight={LABEL_FONT_WEIGHT}
        fontFamily="monospace" fill={color} style={{ userSelect: "none" }}>
        {name}
      </text>
    );
  }

  return (
    <g
      transform={`translate(${label.position.x},${label.position.y})`}
      opacity={ghost ? 0.5 : 1}
      style={{ pointerEvents: pointerEvents ?? "none", cursor: deleteHovered ? "crosshair" : "grab" }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Hit target around the anchor. */}
      <circle cx={0} cy={0} r={NET_LABEL_HIT_RADIUS} fill="transparent" />
      {deleteHovered && (
        <circle cx={0} cy={0} r={NET_LABEL_HIT_RADIUS} fill="#ef4444" fillOpacity={0.15}
          stroke="#ef4444" strokeWidth={0.75 / zoom} style={{ pointerEvents: "none" }} />
      )}
      {/* Connection-point dot — marks the exact electrical anchor. */}
      <circle cx={0} cy={0} r={4} fill="#71717a" style={{ pointerEvents: "none" }} />
      {/* Flag/arrow — rotates with orientation. */}
      <g transform={`rotate(${label.orientation})`}>{flag}</g>
      {/* Text — always horizontal. */}
      {text}
    </g>
  );
}

// ─── KiCad instance rendering ──────────────────────────────────────────────────

// Bounding box (world coords) of an instance's pin sites — drives the selection
// halo and ref/value label placement.
function kicadPinBox(instance: KicadComponentInstance, part: CachedPart) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pin of part.pins) {
    const w = kicadPinWorldPos(instance, pin);
    minX = Math.min(minX, w.x); minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x); maxY = Math.max(maxY, w.y);
  }
  if (!Number.isFinite(minX)) {
    return { minX: instance.x - 25, minY: instance.y - 25, maxX: instance.x + 25, maxY: instance.y + 25 };
  }
  return { minX, minY, maxX, maxY };
}

function KicadPlaceholder({ instance }: { instance: KicadComponentInstance }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={instance.x - 25} y={instance.y - 25} width={50} height={50}
        fill="none" stroke="#52525b" strokeWidth={1} strokeDasharray="4 3" rx={3}
      />
      <text x={instance.x} y={instance.y} textAnchor="middle" dominantBaseline="central"
        fontSize={9} fontFamily="monospace" fill="#71717a">loading…</text>
    </g>
  );
}

// Subtle, dark-theme-friendly panel tints so multi-pin ICs read as labeled
// blocks (à la a block diagram). Picked by a stable hash of the category so
// connectors, MCUs, regulators, etc. get visually distinct — but consistent —
// backgrounds.
const BLOCK_TINTS: { fill: string; stroke: string }[] = [
  { fill: "rgba(96,165,250,0.06)",  stroke: "rgba(96,165,250,0.40)" },  // blue
  { fill: "rgba(74,222,128,0.06)",  stroke: "rgba(74,222,128,0.40)" },  // green
  { fill: "rgba(167,139,250,0.06)", stroke: "rgba(167,139,250,0.40)" }, // violet
  { fill: "rgba(251,191,36,0.06)",  stroke: "rgba(251,191,36,0.40)" },  // amber
  { fill: "rgba(45,212,191,0.06)",  stroke: "rgba(45,212,191,0.40)" },  // teal
  { fill: "rgba(244,114,182,0.06)", stroke: "rgba(244,114,182,0.40)" }, // rose
];

function categoryTint(category: string): { fill: string; stroke: string } {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return BLOCK_TINTS[h % BLOCK_TINTS.length];
}

// Parts with at least this many pins render as a tinted block; 2–4-pin passives
// keep their bare symbol art.
const BLOCK_MIN_PINS = 5;

function KicadInstanceView({
  instance, part, selected, deleteHovered, dragHighlight, zoom, pointerEvents,
  onMouseDown, onMouseEnter, onMouseLeave,
}: {
  instance: KicadComponentInstance;
  part: CachedPart | null;
  selected: boolean;
  deleteHovered: boolean;
  dragHighlight?: DragMode;
  zoom: number;
  pointerEvents: "auto" | "none";
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  if (!part) {
    return (
      <g onMouseDown={onMouseDown} style={{ pointerEvents, cursor: "grab" }}>
        <rect
          x={instance.x - 25} y={instance.y - 25} width={50} height={50}
          fill="transparent"
          pointerEvents={pointerEvents === "none" ? "none" : "all"}
        />
        <KicadPlaceholder instance={instance} />
      </g>
    );
  }

  const box = kicadPinBox(instance, part);
  const pad = 8;
  const block = part.pins.length >= BLOCK_MIN_PINS ? categoryTint(part.mainCategory) : null;

  return (
    <g>
      <rect
        x={box.minX - pad} y={box.minY - pad}
        width={box.maxX - box.minX + pad * 2} height={box.maxY - box.minY + pad * 2}
        fill="transparent"
        pointerEvents={pointerEvents === "none" ? "none" : "all"}
        style={{
          cursor: deleteHovered ? "crosshair"
            : dragHighlight === "stretch" ? "move"
            : dragHighlight === "rigid" ? "grabbing"
            : "grab",
        }}
        onMouseDown={onMouseDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
      {/* Block panel behind multi-pin ICs — keeps the real pin geometry (so
          wiring is unchanged) but reads as a labeled block. */}
      {block && (
        <rect
          x={box.minX - pad} y={box.minY - pad}
          width={box.maxX - box.minX + pad * 2} height={box.maxY - box.minY + pad * 2}
          rx={6} fill={block.fill} stroke={block.stroke} strokeWidth={1 / zoom}
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Symbol body — the transform applies mm→px scale, rotation, and origin. */}
      <g
        transform={`translate(${instance.x},${instance.y}) rotate(${instance.rotation}) scale(${KICAD_SCALE_PX_PER_MM})`}
        style={{
          cursor: deleteHovered ? "crosshair"
            : dragHighlight === "stretch" ? "move"
            : dragHighlight === "rigid" ? "grabbing"
            : "grab",
          pointerEvents,
        }}
        onMouseDown={onMouseDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <KicadSymbolInline symbolRaw={part.symbolRaw} />
      </g>

      {/* Pin endpoint dots (world coords, non-interactive). */}
      {part.pins.map((pin, i) => {
        const w = kicadPinWorldPos(instance, pin);
        return <circle key={i} cx={w.x} cy={w.y} r={2 / zoom} fill="#52525b" style={{ pointerEvents: "none" }} />;
      })}

      {/* Drag-mode highlight: solid teal ring for stretch, dashed for rigid. */}
      {dragHighlight === "stretch" && (
        <rect
          x={box.minX - pad} y={box.minY - pad}
          width={box.maxX - box.minX + pad * 2} height={box.maxY - box.minY + pad * 2}
          fill="none" stroke="#2dd4bf" strokeWidth={1.5 / zoom} rx={3}
          style={{ pointerEvents: "none" }}
        />
      )}
      {dragHighlight === "rigid" && (
        <rect
          x={box.minX - pad} y={box.minY - pad}
          width={box.maxX - box.minX + pad * 2} height={box.maxY - box.minY + pad * 2}
          fill="none" stroke="#2dd4bf" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${2 / zoom}`} rx={2}
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Selection halo. */}
      {selected && (
        <rect
          x={box.minX - pad} y={box.minY - pad}
          width={box.maxX - box.minX + pad * 2} height={box.maxY - box.minY + pad * 2}
          fill="none" stroke="#14b8a6" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${2 / zoom}`} rx={2}
          style={{ pointerEvents: "none" }}
        />
      )}
      {deleteHovered && (
        <rect
          x={box.minX - pad} y={box.minY - pad}
          width={box.maxX - box.minX + pad * 2} height={box.maxY - box.minY + pad * 2}
          fill="#ef4444" fillOpacity={0.12} stroke="#ef4444" strokeWidth={1 / zoom} rx={2}
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* RefDes above, value below — horizontal regardless of rotation. */}
      <text x={(box.minX + box.maxX) / 2} y={box.minY - pad - 4}
        textAnchor="middle" fontSize={11} fontFamily="monospace" fill="#d4d4d8"
        style={{ pointerEvents: "none", userSelect: "none" }}>{instance.refDes}</text>
      <text x={(box.minX + box.maxX) / 2} y={box.maxY + pad + 11}
        textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#71717a"
        style={{ pointerEvents: "none", userSelect: "none" }}>{instance.value}</text>
    </g>
  );
}

// ─── Schematic editor ─────────────────────────────────────────────────────────

function SchematicEditor({
  tool, setTool,
  components,
  wires,
  selectedId, setSelectedId,
  wireDraftStart, setWireDraftStart,
  placementRotation,
  kicadComponents,
  selectedKicadId, setSelectedKicadId,
  placementPartId,
  netLabels,
  pendingNetLabel, setPendingNetLabel,
  pageSize, setPageSize,
  onDeleteComponent,
  graph,
  viewScope,
  viewSessionBridge,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  components: SchComponent[];
  wires: Wire[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  wireDraftStart: Point | null;
  setWireDraftStart: Dispatch<SetStateAction<Point | null>>;
  placementRotation: 0 | 90 | 180 | 270;
  kicadComponents: KicadComponentInstance[];
  selectedKicadId: string | null;
  setSelectedKicadId: (id: string | null) => void;
  placementPartId: string | null;
  netLabels: NetLabel[];
  pendingNetLabel: PendingNetLabel | null;
  setPendingNetLabel: (p: PendingNetLabel | null) => void;
  pageSize: PageSize;
  setPageSize: (p: PageSize) => void;
  /** B06: canonical deletion — the editor never filters state directly. */
  onDeleteComponent: (family: "theory" | "kicad", componentId: string) => void;
  /** B07/B07.1: canonical graph commands + the gesture transaction contract.
   *  The editor computes geometry; authority always flows through these —
   *  the canvas holds NO schematic state setters (structurally enforced by
   *  the B07.1 setter gate). `begin` returns false when another gesture owns
   *  the preview; `preview` renders a frame only for the owning gesture. */
  graph: {
    run(label: string, commandId: string, buildAfter: (state: SchematicState) => SchematicGraphAfter | null): void;
    begin(): boolean;
    preview(frame: SchematicGraphAfter): void;
    cancel(): void;
    commit(label: string, finalGraph: SchematicGraphAfter): void;
  };
  /** [B17-D] the project/branch the schematic view session is scoped to. */
  viewScope: { projectId: string; branchId: string };
  /** [B17-F] the page-owned view-session bridge (the schematic surface registers while mounted). */
  viewSessionBridge: ViewSessionBridge;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan]     = useState<Point>({ x: 100, y: 80 });
  const [zoom, setZoom]   = useState(1);
  const [cursor, setCursor] = useState<Point>({ x: -9999, y: -9999 });
  const [inCanvas, setInCanvas] = useState(false);
  const [deleteHoveredId, setDeleteHoveredId] = useState<string | null>(null);
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  // Junction tool: nearest wire crossing within snap radius of the cursor.
  const [junctionHover, setJunctionHover] = useState<Point | null>(null);
  // Label tool: pending name input at a clicked canvas position. Rendering is
  // gated on the label tool being active, so switching tools hides it; commit,
  // Escape, and blur all clear it.
  const [labelDraft, setLabelDraft] = useState<{ pos: Point; text: string } | null>(null);

  const panRef  = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current  = pan;
  zoomRef.current = zoom;

  // Reset pan/zoom so the whole sheet (plus a small frame) fills the viewport.
  const fitToPage = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const { widthPx, heightPx } = pageSizePx(pageSize);
    const FRAME = 48; // screen-px padding around the sheet
    const z = Math.min((r.width - FRAME * 2) / widthPx, (r.height - FRAME * 2) / heightPx);
    const nextZoom = Math.max(0.05, Math.min(4, z));
    setZoom(nextZoom);
    setPan({
      x: (r.width - widthPx * nextZoom) / 2,
      y: (r.height - heightPx * nextZoom) / 2,
    });
  }, [pageSize]);

  // Frame the sheet on mount and whenever the sheet size changes (a manual pick,
  // or the size auto-layout chose for a freshly generated circuit).
  useEffect(() => {
    fitToPage();
  }, [fitToPage]);

  // ── [B17-D] the schematic view session ──────────────────────────────────────
  // Fit, zoom, pan/focus, select and net highlight are `schematic.*` view commands on ONE bus per editor
  // mount; the hook applies bus state to pan/zoom and the page's selection and mirrors the human's own
  // changes (wheel zoom, drag pan, clicks) back through `schematic.observe`.
  const schematicView = useSchematicViewSession({
    projectId: viewScope.projectId,
    branchId: viewScope.branchId,
    actorId: "local",
    sources: { components, kicadComponents, netLabels, pagePx: { width: pageSizePx(pageSize).widthPx, height: pageSizePx(pageSize).heightPx } },
    selectedId,
    selectedKicadId,
    applySelection: (id, family) => {
      if (family === "kicad") { setSelectedId(null); setSelectedKicadId(id); }
      else { setSelectedKicadId(null); setSelectedId(id); }
    },
    camera: { pan, zoom },
    viewportPx: () => { const r = svgRef.current?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : null; },
    applyCamera: (next) => { setZoom(next.zoom); setPan(next.pan); },
    fitToPage,
  });
  // [B17-F] the schematic surface exists for the agent while this editor is mounted.
  useViewSessionBridge(viewSessionBridge, schematicView);
  const [schematicGoTo, setSchematicGoTo] = useState("");
  const [schematicViewNotice, setSchematicViewNotice] = useState<string | null>(null);
  /** Toolbar "Go to": select the component and frame it; a refusal is shown, never guessed around. */
  const goToSchematicComponent = async (ref: string): Promise<void> => {
    const selected = await schematicView.select({ kind: "component", ref });
    if (!selected.ok) { setSchematicViewNotice(`${selected.code} — ${selected.message}`); return; }
    const focused = await schematicView.focus({ kind: "component", ref });
    setSchematicViewNotice(focused.ok ? null : `${focused.code} — ${focused.message}`);
  };
  const schematicViewSummary = JSON.stringify({
    camera: schematicView.view.camera,
    observed: schematicView.view.observed ? { pan: { x: Math.round(schematicView.view.observed.pan.x), y: Math.round(schematicView.view.observed.pan.y) }, zoom: Math.round(schematicView.view.observed.zoom * 1000) / 1000, viewportPx: schematicView.view.observed.viewportPx } : null,
    selection: schematicView.view.selection,
    highlight: schematicView.view.highlight,
  });

  const componentsRef = useRef(components);
  componentsRef.current = components;
  const wiresRef = useRef(wires);
  wiresRef.current = wires;
  const kicadComponentsRef = useRef(kicadComponents);
  kicadComponentsRef.current = kicadComponents;
  const netLabelsRef = useRef(netLabels);
  netLabelsRef.current = netLabels;

  // Re-render when async KiCad part data arrives in the cache. `partVersion`
  // bumps on each load so derived data keyed on the cache recomputes.
  const [partVersion, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsubs = kicadComponents.map((k) => subscribeToPart(k.partId, forceRender));
    for (const k of kicadComponents) {
      void ensurePartLoaded(k.partId).then(forceRender).catch(() => {});
    }
    return () => { for (const u of unsubs) u(); };
  }, [kicadComponents]);

  // Resolved KiCad pin world positions, used by snap, connectivity, and render.
  const kicadPinSites: KicadPinSite[] = kicadComponents.map((k) => {
    const part = getCachedPart(k.partId);
    return { id: k.id, pins: part ? part.pins.map((p) => kicadPinWorldPos(k, p)) : [] };
  });
  const kicadPinPoints: Point[] = kicadPinSites.flatMap((s) => s.pins);
  const kicadPinSitesRef = useRef(kicadPinSites);
  kicadPinSitesRef.current = kicadPinSites;

  // Net classification for diagram-style rendering (colored power rails, net
  // labels). Recomputed when topology changes or a KiCad part loads.
  const nets = useMemo(() => {
    void partVersion; // recompute when an async KiCad part lands in the cache
    return classifyNets(components, wires, kicadComponents, getCachedPart, netLabels);
  }, [components, wires, kicadComponents, partVersion, netLabels]);

  const dragRef = useRef<{
    type: "pan" | "group" | "stretch";
    startMouse: Point;
    startPan: Point;
    startWorldSnapped?: Point;
    groupCompIds?: Set<string>;
    groupWireIds?: Set<string>;
    groupKicadIds?: Set<string>;
    groupLabelIds?: Set<string>;
    initComps?: Map<string, Point>;
    initWires?: Map<string, Point[]>;
    initKicad?: Map<string, Point>;
    initLabels?: Map<string, Point>;
    // Stretch-mode (double-click drag): the lone moved element, its original
    // pin positions, and a drag-start wire snapshot to recompute from.
    stretchKind?: "component" | "kicad";
    stretchId?: string;
    stretchInitPos?: Point;
    stretchPinKeys?: Set<string>;
    stretchBaseWires?: Wire[];
    /** B07: the latest computed preview arrays — pointer frames render these
     *  non-authoritatively; pointer-up commits them as ONE gesture
     *  transaction (the setters below never become authority). */
    preview?: SchematicGraphAfter;
  } | null>(null);

  // Visual feedback for an in-progress drag: rigid mode outlines the whole
  // connected group (dashed teal); stretch mode rings the lone moved element
  // and brightens the wires that are following it.
  const [activeDrag, setActiveDrag] = useState<
    | { mode: "rigid"; compIds: Set<string>; kicadIds: Set<string>; wireIds: Set<string> }
    | { mode: "stretch"; compId: string | null; kicadId: string | null; wireIds: Set<string> }
    | null
  >(null);

  // Double-click detection for stretch-mode drags: second mousedown on the
  // same element within DOUBLE_CLICK_MS enters stretch instead of rigid.
  const lastClickRef = useRef<{ time: number; id: string } | null>(null);
  function detectDoubleClick(id: string, e: React.MouseEvent): boolean {
    const now = e.timeStamp;
    const prev = lastClickRef.current;
    lastClickRef.current = { time: now, id };
    return prev !== null && prev.id === id && now - prev.time <= DOUBLE_CLICK_MS;
  }

  // Global mouse handlers
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current || !svgRef.current) return;
      if (dragRef.current.type === "pan") {
        const dx = e.clientX - dragRef.current.startMouse.x;
        const dy = e.clientY - dragRef.current.startMouse.y;
        setPan({ x: dragRef.current.startPan.x + dx, y: dragRef.current.startPan.y + dy });
      } else if (dragRef.current.type === "group") {
        const rect = svgRef.current.getBoundingClientRect();
        const wx = snap((e.clientX - rect.left - panRef.current.x) / zoomRef.current);
        const wy = snap((e.clientY - rect.top  - panRef.current.y) / zoomRef.current);
        const sw = dragRef.current.startWorldSnapped!;
        const dx = wx - sw.x;
        const dy = wy - sw.y;
        const initC = dragRef.current.initComps!;
        const initW = dragRef.current.initWires!;
        const gC    = dragRef.current.groupCompIds!;
        const gW    = dragRef.current.groupWireIds!;
        // B07: compute the full preview once, render it non-authoritatively,
        // and remember it — pointer-up commits it as ONE gesture transaction.
        const nextComponents = componentsRef.current.map((c) => {
          if (!gC.has(c.id)) return c;
          const init = initC.get(c.id);
          return init ? { ...c, x: init.x + dx, y: init.y + dy } : c;
        });
        const nextWires = wiresRef.current.map((w) => {
          if (!gW.has(w.id)) return w;
          const init = initW.get(w.id);
          return init
            ? { ...w, vertices: init.map(v => ({ x: v.x + dx, y: v.y + dy })) }
            : w;
        });
        const gK = dragRef.current.groupKicadIds;
        const initK = dragRef.current.initKicad;
        const nextKicad = gK && initK
          ? kicadComponentsRef.current.map((k) => {
              if (!gK.has(k.id)) return k;
              const init = initK.get(k.id);
              return init ? { ...k, x: init.x + dx, y: init.y + dy } : k;
            })
          : kicadComponentsRef.current;
        const gL = dragRef.current.groupLabelIds;
        const initL = dragRef.current.initLabels;
        const nextLabels = gL && initL
          ? netLabelsRef.current.map((l) => {
              if (!gL.has(l.id)) return l;
              const init = initL.get(l.id);
              return init ? { ...l, position: { x: init.x + dx, y: init.y + dy } } : l;
            })
          : netLabelsRef.current;
        dragRef.current.preview = { components: nextComponents, wires: nextWires, kicadComponents: nextKicad, netLabels: nextLabels };
        graph.preview(dragRef.current.preview);
      } else if (dragRef.current.type === "stretch") {
        const rect = svgRef.current.getBoundingClientRect();
        const wx = snap((e.clientX - rect.left - panRef.current.x) / zoomRef.current);
        const wy = snap((e.clientY - rect.top  - panRef.current.y) / zoomRef.current);
        const sw = dragRef.current.startWorldSnapped!;
        const dx = wx - sw.x;
        const dy = wy - sw.y;
        const d = dragRef.current;
        const init = d.stretchInitPos!;
        const nextComponents = d.stretchKind === "component"
          ? componentsRef.current.map((c) => (c.id === d.stretchId ? { ...c, x: init.x + dx, y: init.y + dy } : c))
          : componentsRef.current;
        const nextKicad = d.stretchKind === "kicad"
          ? kicadComponentsRef.current.map((k) => (k.id === d.stretchId ? { ...k, x: init.x + dx, y: init.y + dy } : k))
          : kicadComponentsRef.current;
        // Recompute every attached wire from the drag-start snapshot so
        // L-bend corners don't accumulate across mousemoves.
        const pinKeys = d.stretchPinKeys!;
        const nextWires = d.stretchBaseWires!.map((w) => stretchWire(w, pinKeys, dx, dy));
        d.preview = { components: nextComponents, kicadComponents: nextKicad, wires: nextWires };
        graph.preview(d.preview);
      }
    }
    function onMouseUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.type === "pan") return;
      setActiveDrag(null);
      // B07: the completed gesture commits ONE canonical transaction (the
      // stretch result is consolidated exactly like the legacy mouseup did).
      if (!drag.preview) { graph.cancel(); return; } // no movement — nothing to commit
      const finalGraph: SchematicGraphAfter = drag.type === "stretch"
        ? { ...drag.preview, wires: consolidateWires(drag.preview.wires ?? []) }
        : drag.preview;
      const label = drag.type === "stretch"
        ? "Moved component"
        : drag.groupLabelIds && drag.groupLabelIds.size > 0 && (drag.groupCompIds?.size ?? 0) === 0 && (drag.groupKicadIds?.size ?? 0) === 0
          ? "Moved net label"
          : "Moved components";
      graph.commit(label, finalGraph);
    }
    function onKeyDown(e: KeyboardEvent) {
      // B07: Escape cancels an in-flight gesture — the exact pre-gesture
      // projection is restored and nothing commits.
      if (e.key !== "Escape") return;
      const drag = dragRef.current;
      if (!drag || drag.type === "pan") return;
      dragRef.current = null;
      setActiveDrag(null);
      graph.cancel();
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    window.addEventListener("keydown",   onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
      window.removeEventListener("keydown",   onKeyDown);
    };
  }, [graph]);

  // Non-passive wheel zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setZoom((z) => {
        const nz = Math.min(4, Math.max(0.2, z * factor));
        setPan((p) => ({
          x: mx - (mx - p.x) * (nz / z),
          y: my - (my - p.y) * (nz / z),
        }));
        return nz;
      });
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  function getWorld(e: React.MouseEvent): Point {
    if (!svgRef.current) return { x: 0, y: 0 };
    return screenToWorld(e, svgRef.current, pan, zoom);
  }

  function onSvgMouseMove(e: React.MouseEvent) {
    const w = getWorld(e);
    setCursor(w);
    // Magnet snap only fires for the wire tool. Compute the snap target so
    // the preview, click commit, and hover halo all reference the same point.
    if (tool === "wire") {
      // Label anchors snap like pins so wires can attach to a label's point.
      const anchorPoints = [...kicadPinPoints, ...netLabels.map((l) => l.position)];
      setSnapTarget(findSnapTarget(w, components, wires, GRID, anchorPoints));
    } else if (snapTarget !== null) {
      setSnapTarget(null);
    }
    if (tool === "junction") {
      setJunctionHover(findWireCrossingNear(w, wires, GRID * 1.5));
    } else if (junctionHover !== null) {
      setJunctionHover(null);
    }
  }

  function onSvgMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const raw = getWorld(e);
    // In wire mode the click commits at the snap-target point if there is one,
    // so landing on a wire's interior actually splits that wire.
    const w = (tool === "wire" && snapTarget) ? snapTarget.point : raw;

    if (tool === "select") {
      setSelectedId(null);
      setSelectedKicadId(null);
      dragRef.current = {
        type: "pan",
        startMouse: { x: e.clientX, y: e.clientY },
        startPan: { ...pan },
      };
    } else if (tool === "kicad-place") {
      if (!placementPartId) return;
      // B07: placement is a canonical graph command — the snapshot is minted
      // at click time, the insert executes against the serialized head.
      const part = getCachedPart(placementPartId);
      const newId = crypto.randomUUID();
      graph.run("Placed part", "schematic.add-component", (state) => ({
        kicadComponents: [...(state.kicadComponents ?? []), {
          id: newId,
          partId: placementPartId,
          x: w.x, y: w.y,
          rotation: placementRotation,
          refDes: nextKicadRefDes(part, state.kicadComponents ?? []),
          value: kicadDefaultValue(part),
        }],
      }));
      // Stay in kicad-place for LTspice-style repeated placement.
    } else if (tool === "wire") {
      if (!wireDraftStart) {
        // Split any wire whose interior contains the start click point —
        // canonically; a click on empty space is a no-op transaction-wise.
        const localSplit = consolidateWires(splitWiresAtPoint(wires, w));
        if (selectedId !== null &&
            !localSplit.some((sw) => sw.id === selectedId) &&
            !components.some((c) => c.id === selectedId)) {
          setSelectedId(null);
        }
        graph.run("Started wire", "schematic.connect", (state) => ({
          wires: consolidateWires(splitWiresAtPoint(state.wires, w)),
        }));
        setWireDraftStart(w);
      } else {
        const corner = lbend(wireDraftStart, w);
        const draftStart = wireDraftStart;
        const segIds = [crypto.randomUUID(), crypto.randomUUID()];
        const localResult = (base: Wire[]): Wire[] => {
          const segs: Wire[] = [];
          if (!pointEquals(corner, draftStart)) segs.push({ id: segIds[0], vertices: [draftStart, corner] });
          if (!pointEquals(corner, w)) segs.push({ id: segIds[1], vertices: [corner, w] });
          let newWires = splitWiresAtPoint(base, corner);
          newWires = splitWiresAtPoint(newWires, w);
          return consolidateWires([...newWires, ...segs]);
        };
        const localWires = localResult(wires);
        if (selectedId !== null &&
            !localWires.some((sw) => sw.id === selectedId) &&
            !components.some((c) => c.id === selectedId)) {
          setSelectedId(null);
        }
        graph.run("Drew wire", "schematic.connect", (state) => ({ wires: localResult(state.wires) }));
        setWireDraftStart(w);
      }
    } else if (tool === "junction") {
      // Commit at the hovered crossing if there is one (matches the preview
      // dot), else at the grid-snapped click point. Junctions are DERIVED:
      // the tool only SPLITS wires at the crossing (pinned B07 contract).
      const p = junctionHover ?? raw;
      graph.run("Marked junction", "schematic.connect", (state) => {
        const crossing = state.wires.filter((wire) => pointStrictlyOnWireInterior(p, wire));
        // A 1-wire "junction" is pointless — require an actual crossing.
        if (crossing.length < 2) return null;
        return { wires: consolidateWires(splitWiresAtPoint(state.wires, p)) };
      });
      setJunctionHover(null);
      // Stay in junction mode so the user can mark another crossing.
    } else if (tool === "label") {
      // Open the floating name input at the clicked (snapped) position.
      setLabelDraft({ pos: w, text: "" });
    } else if (tool === "netlabel-place") {
      if (!pendingNetLabel) return;
      const pending = pendingNetLabel;
      const newId = crypto.randomUUID();
      graph.run(`Placed ${pending.name} label`, "schematic.connect", (state) => ({
        netLabels: [...(state.netLabels ?? []), { id: newId, position: w, name: pending.name, kind: pending.kind, orientation: 0 as const }],
      }));
      // Stay in placement mode for repeated drops; Esc exits.
    } else if (tool === "delete") {
      // wire/component clicks handled by their own handlers
    } else {
      const type = tool as SchComponentType;
      // B07: theory components mint an immutable stable id plus an editable
      // display reference ("R1"…), assigned against the serialized head.
      const newId = crypto.randomUUID();
      graph.run("Placed component", "schematic.add-component", (state) => ({
        components: [...state.components, {
          id: newId, type,
          x: w.x, y: w.y, rotation: placementRotation,
          value: COMP_DEFAULTS[type],
          refDes: nextTheoryDisplayRef(type, state.components),
        }],
      }));
    }
  }

  function onCompMouseDown(e: React.MouseEvent, comp: SchComponent) {
    if (e.button !== 0) return;

    if (tool === "delete") {
      e.stopPropagation();
      // B06: canonical delete with a deterministic impact plan.
      onDeleteComponent("theory", comp.id);
      setDeleteHoveredId(null);
      return;
    }

    if (tool === "select") {
      e.stopPropagation();
      setSelectedId(comp.id);
      setSelectedKicadId(null);
      if (detectDoubleClick(comp.id, e)) beginStretchDrag({ kind: "component", id: comp.id }, e);
      else beginGroupDrag({ kind: "component", id: comp.id }, e);
    }
    // wire / placement: let click bubble to SVG background handler
  }

  // Select a KiCad instance and start a rigid-group drag, or delete it.
  function onKicadMouseDown(e: React.MouseEvent, kicad: KicadComponentInstance) {
    if (e.button !== 0) return;
    if (tool === "delete") {
      e.stopPropagation();
      // B06: canonical delete with a deterministic impact plan.
      onDeleteComponent("kicad", kicad.id);
      setDeleteHoveredId(null);
      return;
    }
    if (tool === "select") {
      e.stopPropagation();
      setSelectedKicadId(kicad.id);
      setSelectedId(null);
      if (detectDoubleClick(kicad.id, e)) beginStretchDrag({ kind: "kicad", id: kicad.id }, e);
      else beginGroupDrag({ kind: "kicad", id: kicad.id }, e);
    }
  }

  // Shared rigid-group drag setup for Theory components and KiCad instances.
  function beginGroupDrag(
    seed: { kind: "component"; id: string } | { kind: "kicad"; id: string },
    e: React.MouseEvent,
  ) {
    // B07.1: gesture start — refused while another gesture owns the preview
    // or a commit is in flight (no silent overwrite of an active gesture).
    if (!graph.begin()) return;
    const group = findConnectedGroup(
      seed,
      componentsRef.current,
      wiresRef.current,
      kicadPinSitesRef.current,
      netLabelsRef.current,
    );
    const initComps = new Map<string, Point>();
    const initWires = new Map<string, Point[]>();
    const initKicad = new Map<string, Point>();
    const initLabels = new Map<string, Point>();
    for (const id of group.componentIds) {
      const c = componentsRef.current.find((c) => c.id === id);
      if (c) initComps.set(id, { x: c.x, y: c.y });
    }
    for (const id of group.wireIds) {
      const wire = wiresRef.current.find((w) => w.id === id);
      if (wire) initWires.set(id, wire.vertices.map(v => ({ ...v })));
    }
    for (const id of group.kicadInstanceIds) {
      const k = kicadComponentsRef.current.find((k) => k.id === id);
      if (k) initKicad.set(id, { x: k.x, y: k.y });
    }
    for (const id of group.netLabelIds) {
      const l = netLabelsRef.current.find((l) => l.id === id);
      if (l) initLabels.set(id, { ...l.position });
    }
    const rect = svgRef.current!.getBoundingClientRect();
    const wx = snap((e.clientX - rect.left - pan.x) / zoom);
    const wy = snap((e.clientY - rect.top  - pan.y) / zoom);
    dragRef.current = {
      type: "group",
      startMouse: { x: e.clientX, y: e.clientY },
      startPan: pan,
      startWorldSnapped: { x: wx, y: wy },
      groupCompIds: group.componentIds,
      groupWireIds: group.wireIds,
      groupKicadIds: group.kicadInstanceIds,
      groupLabelIds: group.netLabelIds,
      initComps,
      initWires,
      initKicad,
      initLabels,
    };
    setActiveDrag({
      mode: "rigid",
      compIds: group.componentIds,
      kicadIds: group.kicadInstanceIds,
      wireIds: group.wireIds,
    });
  }

  // Stretch-mode drag setup (double-click): only the clicked element moves;
  // wires whose endpoints sit on its pins follow with L-bends. Other wires —
  // including junction partners at the same point — stay put.
  function beginStretchDrag(
    seed: { kind: "component"; id: string } | { kind: "kicad"; id: string },
    e: React.MouseEvent,
  ) {
    // B07.1: gesture start — refused while another gesture owns the preview
    // or a commit is in flight (no silent overwrite of an active gesture).
    if (!graph.begin()) return;
    let origPins: Point[];
    let initPos: Point;
    if (seed.kind === "component") {
      const c = componentsRef.current.find((c) => c.id === seed.id);
      if (!c) { graph.cancel(); return; } // release gesture ownership
      origPins = (PIN_NAMES[c.type] ?? []).map((pin) => pinWorldPos(c, pin));
      initPos = { x: c.x, y: c.y };
    } else {
      const k = kicadComponentsRef.current.find((k) => k.id === seed.id);
      if (!k) { graph.cancel(); return; } // release gesture ownership
      origPins = kicadPinSitesRef.current.find((s) => s.id === seed.id)?.pins ?? [];
      initPos = { x: k.x, y: k.y };
    }
    const pinKeys = new Set(origPins.map(pointKey));
    const baseWires = wiresRef.current.map((w) => ({ ...w, vertices: w.vertices.map((v) => ({ ...v })) }));
    const wireIds = new Set(
      baseWires
        .filter((w) => {
          const f = w.vertices[0];
          const l = w.vertices[w.vertices.length - 1];
          return (f !== undefined && pinKeys.has(pointKey(f))) ||
                 (l !== undefined && pinKeys.has(pointKey(l)));
        })
        .map((w) => w.id),
    );
    const rect = svgRef.current!.getBoundingClientRect();
    const wx = snap((e.clientX - rect.left - pan.x) / zoom);
    const wy = snap((e.clientY - rect.top  - pan.y) / zoom);
    dragRef.current = {
      type: "stretch",
      startMouse: { x: e.clientX, y: e.clientY },
      startPan: pan,
      startWorldSnapped: { x: wx, y: wy },
      stretchKind: seed.kind,
      stretchId: seed.id,
      stretchInitPos: initPos,
      stretchPinKeys: pinKeys,
      stretchBaseWires: baseWires,
    };
    setActiveDrag({
      mode: "stretch",
      compId: seed.kind === "component" ? seed.id : null,
      kicadId: seed.kind === "kicad" ? seed.id : null,
      wireIds,
    });
  }

  function onWireMouseDown(e: React.MouseEvent, wire: Wire) {
    e.stopPropagation();
    if (tool === "delete") {
      graph.run("Deleted wire", "schematic.connect", (state) => ({ wires: state.wires.filter((w) => w.id !== wire.id) }));
      setDeleteHoveredId(null);
    }
  }

  // Delete a net label, or drag it alone (a label is an annotation — moving
  // one must not drag the whole net it names).
  function onLabelMouseDown(e: React.MouseEvent, label: NetLabel) {
    if (e.button !== 0) return;
    if (tool === "delete") {
      e.stopPropagation();
      graph.run("Deleted net label", "schematic.connect", (state) => ({ netLabels: (state.netLabels ?? []).filter((l) => l.id !== label.id) }));
      setDeleteHoveredId(null);
      return;
    }
    if (tool === "select") {
      e.stopPropagation();
      // B07.1: label drag is a gesture — refused while another owns the preview.
      if (!graph.begin()) return;
      const rect = svgRef.current!.getBoundingClientRect();
      const wx = snap((e.clientX - rect.left - pan.x) / zoom);
      const wy = snap((e.clientY - rect.top  - pan.y) / zoom);
      dragRef.current = {
        type: "group",
        startMouse: { x: e.clientX, y: e.clientY },
        startPan: pan,
        startWorldSnapped: { x: wx, y: wy },
        groupCompIds: new Set(),
        groupWireIds: new Set(),
        groupKicadIds: new Set(),
        groupLabelIds: new Set([label.id]),
        initComps: new Map(),
        initWires: new Map(),
        initKicad: new Map(),
        initLabels: new Map([[label.id, { ...label.position }]]),
      };
    }
  }

  // Commit the floating label-name input → a generic net label at the click
  // position. Stays in the label tool for placing more.
  function commitLabelDraft() {
    if (!labelDraft) return;
    const name = labelDraft.text.trim().toUpperCase();
    if (name !== "") {
      const pos = labelDraft.pos;
      const newId = crypto.randomUUID();
      graph.run(`Added net label ${name}`, "schematic.connect", (state) => ({
        netLabels: [...(state.netLabels ?? []), { id: newId, position: pos, name, kind: "label" as const, orientation: 0 as const }],
      }));
    }
    setLabelDraft(null);
  }

  // Effective endpoint for the wire preview: snap target if the cursor is
  // within radius of a pin / wire endpoint / wire interior, else the raw
  // GRID-snapped cursor.
  const effectiveEnd = tool === "wire" && snapTarget ? snapTarget.point : cursor;
  const previewPts: Point[] = [];
  if (wireDraftStart) {
    const corner = lbend(wireDraftStart, effectiveEnd);
    previewPts.push(wireDraftStart);
    if (corner.x !== wireDraftStart.x || corner.y !== wireDraftStart.y) previewPts.push(corner);
    previewPts.push(effectiveEnd);
  }

  // Junction dots: any point touched by 3+ wire endpoints
  const ptCount = new Map<string, number>();
  for (const w of wires) {
    const first = w.vertices[0];
    const last  = w.vertices[w.vertices.length - 1];
    for (const p of [first, last]) {
      if (!p) continue;
      const k = `${p.x},${p.y}`;
      ptCount.set(k, (ptCount.get(k) ?? 0) + 1);
    }
  }
  const junctions: Point[] = [];
  ptCount.forEach((n, k) => {
    if (n >= 3) {
      const [x, y] = k.split(",").map(Number);
      junctions.push({ x, y });
    }
  });

  const isTheoryPlacing = isTheoryPlacementTool(tool);
  const placementPart = tool === "kicad-place" && placementPartId ? getCachedPart(placementPartId) : null;
  const cursorStyle =
    activeDrag?.mode === "stretch" ? "move"
    : activeDrag?.mode === "rigid" ? "grabbing"
    : tool === "select" ? "default"
    : tool === "junction" ? JUNCTION_CURSOR
    : tool === "label" ? "text"
    : "crosshair";

  const statusMsg =
    activeDrag?.mode === "stretch"
      ? "STRETCH — component moves alone, attached wires follow"
      : tool === "wire" && wireDraftStart
      ? "WIRE — click next point  [Esc cancel]"
      : tool === "wire"
      ? "WIRE — click to start  [Esc to exit]"
      : tool === "delete"
      ? "DELETE — click element to remove  [Esc cancel]"
      : tool === "junction"
      ? "JUNCTION — click where two wires cross  [Esc cancel]"
      : tool === "label"
      ? "LABEL — click to name a net  [Enter commit · Esc cancel]"
      : tool === "netlabel-place"
      ? `PLACE ${pendingNetLabel?.name ?? "label"}  [Esc cancel · click place]`
      : tool === "kicad-place"
      ? `PLACE ${placementPart?.name ?? "part"}  [Esc cancel · click place · R rotate]`
      : isTheoryPlacing
      ? `PLACE ${SCH_TYPE_LABEL[tool as SchComponentType]}  [Esc cancel · click place]`
      : "SELECT  [W wire · X delete · R rotate · Del delete · 2×click-drag stretch]";

  // Sheet boundary geometry (world px). The canvas extends well past this so the
  // user has working room, but it marks what gets printed / exported.
  const { widthPx: pageW, heightPx: pageH } = pageSizePx(pageSize);
  const { widthPx: tbW, heightPx: tbH } = titleBlockPx();

  return (
    <div className="absolute inset-0 bg-zinc-950">
      {/* Page-size + fit-to-page controls (top-right) */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-zinc-900/90 border border-zinc-800 rounded-md p-1 backdrop-blur-sm shadow-lg">
        <select
          value={pageSize}
          onChange={(e) => setPageSize(e.target.value as PageSize)}
          title="Sheet size — also sets the KiCad export page"
          className="h-7 text-xs bg-zinc-800 text-zinc-200 border border-zinc-700 rounded px-1.5 outline-none focus:border-zinc-500 cursor-pointer"
        >
          <option value="A5">A5</option>
          <option value="A4">A4</option>
          <option value="A3">A3</option>
          <option value="A2">A2</option>
          <option value="A1">A1</option>
          <option value="USLetter">US Letter</option>
          <option value="USLegal">US Legal</option>
        </select>
        <button
          title="Fit page to view"
          onClick={() => schematicView.fitPage()}
          className="h-7 flex items-center gap-1.5 px-2 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
        >
          <Maximize2 className="size-3.5" />
          <span className="text-[10px] font-mono hidden sm:inline">Fit</span>
        </button>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const ref = schematicGoTo.trim(); if (ref) void goToSchematicComponent(ref); }}>
          <input
            data-testid="schematic-goto-input"
            aria-label="Go to component"
            value={schematicGoTo}
            onChange={(e) => setSchematicGoTo(e.target.value)}
            placeholder="Go to…"
            className="h-7 w-20 rounded border border-zinc-800 bg-zinc-900 px-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <button type="submit" data-testid="schematic-goto" title="Focus the component" className="h-7 px-2 rounded text-[10px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition">Go</button>
        </form>
        {schematicViewNotice && <span data-testid="schematic-notice" className="text-[10px] text-amber-300 truncate max-w-56">{schematicViewNotice}</span>}
      </div>

      {/* Floating toolbar */}
      <div className="absolute top-3 left-3 z-10 flex gap-1 bg-zinc-900/90 border border-zinc-800 rounded-md p-1 backdrop-blur-sm shadow-lg">
        <button
          title="Select"
          onClick={() => { setTool("select"); setWireDraftStart(null); }}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "select"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <MousePointer className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">S</span>
        </button>
        <button
          title="Wire"
          onClick={() => setTool("wire")}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "wire"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Pencil className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">W</span>
        </button>
        <button
          title="Delete"
          onClick={() => setTool("delete")}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "delete"
              ? "bg-red-900/70 text-red-300"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Scissors className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">X</span>
        </button>
        <button
          title="Junction — mark a wire crossing as connected"
          onClick={() => { setTool("junction"); setWireDraftStart(null); }}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "junction"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <CircleDot className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">J</span>
        </button>
        <button
          title="Net label — name a net; same-name labels connect electrically"
          onClick={() => { setTool("label"); setWireDraftStart(null); setPendingNetLabel(null); }}
          className={`h-7 flex items-center gap-1.5 px-2 rounded transition ${
            tool === "label"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Tag className="size-3.5" />
          <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded">T</span>
        </button>
        <div className="w-px self-stretch my-1 bg-zinc-800" />
        {QUICK_LABELS.map((q) => (
          <button
            key={q.name}
            title={`Place a ${q.name} ${q.kind === "ground" ? "ground symbol" : "power port"}`}
            onClick={() => {
              setTool("netlabel-place");
              setPendingNetLabel(q);
              setWireDraftStart(null);
            }}
            className={`h-7 px-1.5 rounded font-mono text-[10px] transition ${
              tool === "netlabel-place" && pendingNetLabel?.name === q.name
                ? "bg-zinc-700 text-zinc-100"
                : q.kind === "ground"
                ? "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                : "text-red-400/80 hover:text-red-300 hover:bg-zinc-800"
            }`}
          >
            {q.name}
          </button>
        ))}
      </div>

      {/* Status bar */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-zinc-600 font-mono select-none">
        {statusMsg}
      </div>

      <svg
        ref={svgRef}
        id="sirkit-schematic-svg"
        data-testid="schematic-canvas"
        data-view={schematicViewSummary}
        data-view-revision={schematicView.viewRevision}
        width="100%"
        height="100%"
        style={{ cursor: cursorStyle, display: "block" }}
        onMouseMove={onSvgMouseMove}
        onMouseDown={onSvgMouseDown}
        onMouseEnter={() => setInCanvas(true)}
        onMouseLeave={() => setInCanvas(false)}
      >
        <defs>
          <pattern
            id="dot-grid"
            x={pan.x % (20 * zoom)}
            y={pan.y % (20 * zoom)}
            width={20 * zoom}
            height={20 * zoom}
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0" cy="0" r={Math.max(0.4, zoom * 0.7)} fill="rgba(255,255,255,0.07)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />

        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Page boundary — drawn under everything; non-scaling strokes keep it
              crisp at any zoom. The canvas extends past it for working room. */}
          <g className="page-boundary" style={{ pointerEvents: "none" }}>
            <rect
              x={0} y={0} width={pageW} height={pageH}
              fill="none" stroke="#52525b" strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={PAGE_MARGIN_PX} y={PAGE_MARGIN_PX}
              width={pageW - 2 * PAGE_MARGIN_PX} height={pageH - 2 * PAGE_MARGIN_PX}
              fill="none" stroke="#3f3f46" strokeWidth={0.5}
              strokeDasharray="4 4" vectorEffect="non-scaling-stroke"
            />
            <rect
              x={pageW - tbW} y={pageH - tbH} width={tbW} height={tbH}
              fill="rgba(82,82,91,0.05)" stroke="#52525b" strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={pageW - 8} y={pageH - tbH / 2}
              textAnchor="end" dominantBaseline="middle"
              fill="#71717a" fontSize={12 / zoom} fontFamily="monospace"
            >{pageSize}</text>
          </g>

          {/* Committed wires */}
          {wires.map((wire) => {
            const pts = wire.vertices.map(v => `${v.x},${v.y}`).join(" ");
            const isDeleteHovered = tool === "delete" && deleteHoveredId === wire.id;
            const isSnapHovered   = tool === "wire" && snapTarget?.wireId === wire.id;
            const isStretching    = activeDrag?.mode === "stretch" && activeDrag.wireIds.has(wire.id);
            const inRigidGroup    = activeDrag?.mode === "rigid"   && activeDrag.wireIds.has(wire.id);
            // Disable wire hit-testing while drawing/placing/junctioning so
            // clicks reach the canvas — this is the headline fix for
            // wire-to-wire connection.
            const hitTargetActive = !(tool === "wire" || tool === "junction" || isPlacementTool(tool));
            return (
              <g key={wire.id}>
                {isSnapHovered && (
                  <polyline
                    points={pts} fill="none"
                    stroke="#14b8a6" strokeWidth={4 / zoom} strokeOpacity={0.3}
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {isDeleteHovered && (
                  <polyline
                    points={pts} fill="none"
                    stroke="#ef4444" strokeWidth={8 / zoom} strokeOpacity={0.3} strokeLinecap="round" strokeLinejoin="round"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {inRigidGroup && (
                  <polyline
                    points={pts} fill="none"
                    stroke="#2dd4bf" strokeWidth={4 / zoom} strokeOpacity={0.2}
                    strokeDasharray={`${4 / zoom} ${2 / zoom}`}
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                <polyline
                  points={pts} fill="none"
                  stroke={isStretching ? "#2dd4bf" : nets.wireColor(wire)}
                  strokeOpacity={isStretching ? 0.8 : 1}
                  strokeWidth={(isStretching ? 1.25 : nets.wireRole(wire) === "unknown" ? 0.75 : 1) / zoom}
                  strokeLinecap="round" strokeLinejoin="miter"
                  style={{ pointerEvents: "none" }}
                />
                {/* Fat transparent hit target — tool-gated so wire mode and
                    placement modes don't intercept clicks. */}
                <polyline
                  points={pts} fill="none"
                  stroke="transparent" strokeWidth={12 / zoom} strokeLinecap="round"
                  style={{
                    cursor: tool === "delete" ? "crosshair" : "default",
                    pointerEvents: hitTargetActive ? "stroke" : "none",
                  }}
                  onMouseDown={(e) => onWireMouseDown(e, wire)}
                  onMouseEnter={() => { if (tool === "delete") setDeleteHoveredId(wire.id); }}
                  onMouseLeave={() => setDeleteHoveredId((prev) => prev === wire.id ? null : prev)}
                />
              </g>
            );
          })}

          {/* Wire draft preview */}
          {previewPts.length >= 2 && (
            <polyline
              points={previewPts.map((p) => `${p.x},${p.y}`).join(" ")}
              stroke="#14b8a6"
              strokeWidth={1 / zoom}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${4 / zoom} ${2 / zoom}`}
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* Junction dots */}
          {junctions.map((j, i) => (
            <circle key={i} cx={j.x} cy={j.y} r={2.5 / zoom} fill="#a1a1aa" style={{ pointerEvents: "none" }} />
          ))}

          {/* Derived rail names — power/ground nets with no explicit label. */}
          {nets.labels.map((l, i) => (
            <text
              key={i}
              x={l.point.x + 4} y={l.point.y - 4}
              textAnchor="start" fontSize={9} fontFamily="monospace" fill={l.color}
              stroke="#09090b" strokeWidth={0.6 / zoom}
              style={{ paintOrder: "stroke", pointerEvents: "none", userSelect: "none" }}
            >
              {l.name}
            </text>
          ))}

          {/* Explicit net labels — power flags, ground symbols, signal flags.
              Same-name labels are electrically one net. */}
          {schematicView.view.highlight && (
            <g data-testid="schematic-highlight" data-net={schematicView.view.highlight.name} pointerEvents="none">
              {netLabels.filter((label) => schematicView.view.highlight!.labelIds.includes(label.id)).map((label) => (
                <circle key={label.id} cx={label.position.x} cy={label.position.y} r={14} fill="none" stroke="#f59e0b" strokeWidth={2 / zoom} />
              ))}
            </g>
          )}
          {netLabels.map((label) => (
            <NetLabelGlyph
              key={label.id}
              label={label}
              role={nets.roleAt(label.position)}
              zoom={zoom}
              deleteHovered={tool === "delete" && deleteHoveredId === label.id}
              pointerEvents={tool === "select" || tool === "delete" ? "auto" : "none"}
              onMouseDown={(e) => onLabelMouseDown(e, label)}
              onMouseEnter={() => { if (tool === "delete") setDeleteHoveredId(label.id); }}
              onMouseLeave={() => setDeleteHoveredId((prev) => prev === label.id ? null : prev)}
            />
          ))}

          {/* Components — pointer-events gated so wire/placement clicks
              go straight through to the canvas. */}
          {components.map((comp) => (
            <ComponentSymbol
              key={comp.id}
              comp={comp}
              selected={comp.id === selectedId}
              deleteHovered={tool === "delete" && deleteHoveredId === comp.id}
              dragHighlight={
                activeDrag?.mode === "stretch"
                  ? (activeDrag.compId === comp.id ? "stretch" : undefined)
                  : activeDrag?.mode === "rigid" && activeDrag.compIds.has(comp.id)
                  ? "rigid"
                  : undefined
              }
              pointerEvents={tool === "wire" || tool === "junction" || isPlacementTool(tool) ? "none" : "auto"}
              onMouseDown={(e) => onCompMouseDown(e, comp)}
              onMouseEnter={() => { if (tool === "delete") setDeleteHoveredId(comp.id); }}
              onMouseLeave={() => setDeleteHoveredId((prev) => prev === comp.id ? null : prev)}
            />
          ))}

          {/* Placed KiCad components */}
          {kicadComponents.map((kicad) => (
            <KicadInstanceView
              key={kicad.id}
              instance={kicad}
              part={getCachedPart(kicad.partId)}
              selected={kicad.id === selectedKicadId}
              deleteHovered={tool === "delete" && deleteHoveredId === kicad.id}
              dragHighlight={
                activeDrag?.mode === "stretch"
                  ? (activeDrag.kicadId === kicad.id ? "stretch" : undefined)
                  : activeDrag?.mode === "rigid" && activeDrag.kicadIds.has(kicad.id)
                  ? "rigid"
                  : undefined
              }
              zoom={zoom}
              pointerEvents={tool === "wire" || tool === "junction" || isPlacementTool(tool) ? "none" : "auto"}
              onMouseDown={(e) => onKicadMouseDown(e, kicad)}
              onMouseEnter={() => { if (tool === "delete") setDeleteHoveredId(kicad.id); }}
              onMouseLeave={() => setDeleteHoveredId((prev) => prev === kicad.id ? null : prev)}
            />
          ))}

          {/* Junction preview: teal dot at the nearest wire crossing. */}
          {tool === "junction" && junctionHover && (
            <circle
              cx={junctionHover.x} cy={junctionHover.y}
              r={4 / zoom}
              fill="rgba(20,184,166,0.35)"
              stroke="#14b8a6"
              strokeWidth={1 / zoom}
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* Snap-target indicator: a small teal dot at the exact snap point. */}
          {tool === "wire" && snapTarget && (
            <circle
              cx={snapTarget.point.x} cy={snapTarget.point.y}
              r={4 / zoom}
              fill="rgba(20,184,166,0.3)"
              stroke="#14b8a6"
              strokeWidth={1 / zoom}
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* Theory ghost preview */}
          {isTheoryPlacing && inCanvas && (
            <GhostSymbol type={tool as SchComponentType} x={cursor.x} y={cursor.y} rotation={placementRotation} />
          )}

          {/* KiCad ghost preview */}
          {tool === "kicad-place" && inCanvas && placementPart && (
            <g transform={`translate(${cursor.x},${cursor.y}) rotate(${placementRotation}) scale(${KICAD_SCALE_PX_PER_MM})`}
               opacity={0.5} style={{ pointerEvents: "none" }}>
              <KicadSymbolInline symbolRaw={placementPart.symbolRaw} />
            </g>
          )}

          {/* Net-label ghost preview */}
          {tool === "netlabel-place" && inCanvas && pendingNetLabel && (
            <NetLabelGlyph
              label={{
                id: "__ghost",
                position: cursor,
                name: pendingNetLabel.name,
                kind: pendingNetLabel.kind,
                orientation: 0,
              }}
              role={pendingNetLabel.kind === "ground" ? "ground" : pendingNetLabel.kind === "power" ? "power" : "signal"}
              zoom={zoom}
              ghost
            />
          )}
        </g>
      </svg>

      {/* Floating name input for the Label tool. */}
      {tool === "label" && labelDraft && (
        <div
          className="absolute z-20"
          style={{
            left: labelDraft.pos.x * zoom + pan.x + 8,
            top:  labelDraft.pos.y * zoom + pan.y - 12,
          }}
        >
          <input
            autoFocus
            value={labelDraft.text}
            placeholder="NET_NAME"
            onChange={(e) =>
              setLabelDraft((d) => (d ? { ...d, text: e.target.value } : d))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitLabelDraft(); }
              else if (e.key === "Escape") { e.preventDefault(); setLabelDraft(null); }
            }}
            onBlur={() => setLabelDraft(null)}
            className="h-6 w-28 bg-zinc-900 border border-teal-600 rounded px-1.5 font-mono text-[11px] uppercase text-zinc-100 placeholder:text-zinc-600 outline-none shadow-lg"
          />
        </div>
      )}
    </div>
  );
}

// ─── Properties panel ────────────────────────────────────────────────────────

/**
 * B06: property inputs commit on blur/Enter (Escape reverts) so one edit is
 * ONE discrete canonical transaction — per-keystroke commits would mint a
 * transaction and history entry per character.
 */
function CommitInput({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  // Render-phase derived-state reset (the React-endorsed pattern): when the
  // committed value changes externally, the draft resyncs without an effect.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); setDraft(value); }
      }}
      className={className}
    />
  );
}

function PropertiesPanel({
  comp, onValueChange, onRotationChange, onDelete, onReferenceChange,
}: {
  comp: SchComponent;
  onValueChange: (v: string) => void;
  onRotationChange: (r: 0 | 90 | 180 | 270) => void;
  onDelete: () => void;
  /** B07: canonical display rename — never rewrites the stable id. */
  onReferenceChange: (v: string) => void;
}) {
  return (
    <div className="absolute top-14 right-4 w-52 z-10 bg-zinc-900/95 border border-zinc-800 rounded-md p-3 backdrop-blur-sm shadow-lg">
      <div className="text-xs uppercase text-zinc-500 mb-0.5 tracking-wide">
        {SCH_TYPE_LABEL[comp.type]}
      </div>
      <div className="mb-2 mt-1">
        <div className="text-[10px] text-zinc-500 mb-1">Reference</div>
        <CommitInput
          value={schDisplayRef(comp)}
          onCommit={onReferenceChange}
          className="h-7 text-xs border-zinc-700 bg-zinc-800"
        />
      </div>

      {comp.type !== "ground" && (
        <div className="mb-3">
          <div className="text-[10px] text-zinc-500 mb-1">Value</div>
          <CommitInput
            value={comp.value}
            onCommit={onValueChange}
            className="h-7 text-xs border-zinc-700 bg-zinc-800"
          />
        </div>
      )}

      <div className="mb-3">
        <div className="text-[10px] text-zinc-500 mb-1">Rotation</div>
        <div className="flex gap-1">
          {([0, 90, 180, 270] as const).map((r) => (
            <button
              key={r}
              onClick={() => onRotationChange(r)}
              className={`flex-1 text-[10px] py-0.5 rounded border transition ${
                comp.rotation === r
                  ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
              }`}
            >
              {r}°
            </button>
          ))}
        </div>
      </div>

      <Button size="sm" variant="destructive" className="w-full h-7 text-xs" onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
}

// Properties panel for a placed KiCad component. Fetches its static catalog
// data via the cache (subscribing so async loads refresh the metadata).
function KicadPropertiesPanel({
  instance, onRefDesChange, onValueChange, onRotate, onDelete, onReplace,
}: {
  instance: KicadComponentInstance;
  onRefDesChange: (v: string) => void;
  onValueChange: (v: string) => void;
  onRotate: () => void;
  onDelete: () => void;
  onReplace: () => void;
}) {
  const [part, setPart] = useState<CachedPart | null>(() => getCachedPart(instance.partId));
  useEffect(() => {
    setPart(getCachedPart(instance.partId));
    const unsub = subscribeToPart(instance.partId, () => setPart(getCachedPart(instance.partId)));
    void ensurePartLoaded(instance.partId).then(setPart).catch(() => {});
    return unsub;
  }, [instance.partId]);

  return (
    <div className="absolute top-14 right-4 w-60 z-10 bg-zinc-900/95 border border-zinc-800 rounded-md p-3 backdrop-blur-sm shadow-lg">
      <div className="text-xs uppercase text-zinc-500 mb-2 tracking-wide truncate">
        {part?.name ?? "KiCad part"}
      </div>

      <div className="mb-2">
        <div className="text-[10px] text-zinc-500 mb-1">Reference designator</div>
        <CommitInput value={instance.refDes} onCommit={onRefDesChange}
          className="h-7 text-xs border-zinc-700 bg-zinc-800" />
      </div>
      <div className="mb-3">
        <div className="text-[10px] text-zinc-500 mb-1">Value</div>
        <CommitInput value={instance.value} onCommit={onValueChange}
          className="h-7 text-xs border-zinc-700 bg-zinc-800" />
      </div>

      <div className="space-y-1 text-[10px] mb-3 border-t border-zinc-800 pt-2">
        {part?.mpn && <KicadMetaRow label="MPN" value={part.mpn} />}
        {part?.manufacturer && <KicadMetaRow label="Mfr" value={part.manufacturer} />}
        {part && <KicadMetaRow label="Library" value={part.libraryName} />}
        {part && <KicadMetaRow label="Pins" value={String(part.pins.length)} />}
        {part?.footprintHint && <KicadMetaRow label="Footprint" value={part.footprintHint} />}
        <DatasheetLink href={part?.datasheet} className="inline-block text-teal-400 hover:text-teal-300 transition pt-0.5">Datasheet ↗</DatasheetLink>
      </div>

      <div className="flex gap-1">
        <Button size="sm" variant="secondary" className="flex-1 h-7 text-[11px]" onClick={onRotate}>Rotate</Button>
        <Button size="sm" variant="destructive" className="flex-1 h-7 text-[11px]" onClick={onDelete}>Delete</Button>
      </div>
      <Button size="sm" variant="ghost" className="w-full h-7 text-[11px] mt-1 text-zinc-400" onClick={onReplace}>
        Replace part…
      </Button>
    </div>
  );
}

function KicadMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-zinc-500 w-16 shrink-0">{label}</span>
      <span className="text-zinc-300 break-all">{value}</span>
    </div>
  );
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState("");
  // [B18-D I1] the user's choice to send a suggested schematic edit or generation to the assistant instead (reset on submit).
  const [composerRouteOverride, setComposerRouteOverride] = useState<ComposerRoute | null>(null);
  const [loading, setLoading]   = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode]         = useState<Mode>("build");
  const [view, setView]         = useState<View>("schematic");
  const [leftPanel, setLeftPanel]           = useState<LeftPanel>(null);
  const [chatOpen, setChatOpen]             = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [chatWidth, setChatWidth]           = useState(384);
  const [leftPanelWidth, setLeftPanelWidth] = useState(240);
  const [aiBrain, setAiBrain] = useState<LLMProviderId>("openai");
  const aiBrainRef = useRef<LLMProviderId>("openai");
  const [aiRuntime, setAiRuntime] = useState<AiRuntimeInfo | null>(null);
  const [aiProviderFailure, setAiProviderFailure] = useState<AiProviderFailureState | null>(null);
  const lastAiRetryRef = useRef<(() => void) | null>(null);

  // Schematic state
  const [tool, setTool]       = useState<Tool>("select");
  const [components, setComponents] = useState<SchComponent[]>([]);
  const [wires, setWires]               = useState<Wire[]>([]);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [wireDraftStart, setWireDraftStart] = useState<Point | null>(null);
  const [placementRotation, setPlacementRotation] = useState<0 | 90 | 180 | 270>(0);

  // KiCad (Build-mode) component state — parallel to Theory components.
  const [kicadComponents, setKicadComponents] = useState<KicadComponentInstance[]>([]);
  const [selectedKicadId, setSelectedKicadId] = useState<string | null>(null);
  const [placementPartId, setPlacementPartId] = useState<string | null>(null);

  // Net labels (both modes) + the preset held by the quick-place tool.
  const [netLabels, setNetLabels] = useState<NetLabel[]>([]);
  const [pendingNetLabel, setPendingNetLabel] = useState<PendingNetLabel | null>(null);

  // Sheet size for the canvas boundary + KiCad export. Auto-layout updates it to
  // fit a generated circuit; the user can override it from the canvas toolbar.
  const [pageSize, setPageSize] = useState<PageSize>("A4");

  // Transient bottom toast (e.g. BOM part-swap confirmations). Auto-dismisses.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }

  // Begin modal placement of a KiCad part (from the Build library panel).
  function startKicadPlacement(partId: string) {
    setPlacementPartId(partId);
    setTool("kicad-place");
    setSelectedId(null);
    setSelectedKicadId(null);
    void ensurePartLoaded(partId).catch(() => {});
  }

  // AI generation state.
  // B07.4 — every busy flag is REQUEST-OWNED: the handler that set it
  // records its scope requestId in the matching ref, and only the SAME
  // request's finally block may clear it (a stale completion can never
  // clear a newer request's busy state). The project-transition reset
  // clears all of them explicitly.
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing]       = useState(false);
  const [isReviewing, setIsReviewing]   = useState(false);
  const [isTidying, setIsTidying]       = useState(false);
  const [isSecondOpinion, setIsSecondOpinion] = useState(false);
  const activeGenerationRef = useRef<string | null>(null);
  const activeEditRef = useRef<string | null>(null);
  const activeReviewRef = useRef<string | null>(null);
  const activeTidyRef = useRef<string | null>(null);
  const activeSecondOpinionRef = useRef<string | null>(null);
  const activeChatRef = useRef<string | null>(null);
  const [lastDesignPrompt, setLastDesignPrompt] = useState("");
  // Post-apply auto pipeline: bumped whenever a machine-generated schematic
  // lands (generate / Tier-2 edit / apply-suggestions). The debounced effect
  // below then auto-runs Tidy (only when the layout is machine-made — never on
  // top of manual placement) followed by the advisory Review.
  const [autoRunToken, setAutoRunToken] = useState(0);
  const autoRunIncludesTidy = useRef(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // B07.4 — suggestions are a SCOPED BATCH (project/session/base ownership),
  // never a bare array: they clear on project transition, go stale when the
  // authoritative base moves, and can only be applied while project,
  // session generation, and exact base digest all still match.
  const [pendingSuggestions, setPendingSuggestions] = useState<ScopedSuggestionBatch | null>(null);
  const [suggestionsMinimized, setSuggestionsMinimized] = useState(false);
  const [genError, setGenError]         = useState<string | null>(null);
  // [B16.1C §F] the ONE pending generated-schematic proposal (also the first
  // generation onto an empty sheet). Nothing is applied until the human
  // approves it in the review dialog, which states exactly what will change.
  const [pendingReplace, setPendingReplace] = useState<{
    state: SchematicState;
    explanation: string;
    prompt: string;
    logId?: string;
    promptAlreadyLogged?: boolean;
    /** B07.3/B07.4 — exact-base invocation pin captured before generation
     *  (with its async scope for project/session-generation currency). */
    pin?: { projectId: string | null; session: SchematicEditorSession | null; baseDigest: string; scope: ProjectAsyncScope };
    /** [B16-A F11] carried from the Tier-2 edit path ("Apply suggestions" must not re-trigger the auto loop). */
    skipAutoRun?: boolean;
    /** [B16-A F11] a validation note the dialog shows alongside the proposal (never blocks the human's decision). */
    validationNote?: string | null;
  } | null>(null);
  // [B16.1C §F] what the pending proposal will change, against the LIVE
  // canonical schematic at review time (recomputed when either changes).
  const pendingProposalSummary = useMemo(() => pendingReplace ? describeSchematicProposal(pendingReplace.state, { components, wires, kicadComponents, netLabels }) : null, [pendingReplace, components, wires, kicadComponents, netLabels]);

  // B06.1: the ONE pending sealed tier-1 proposal. Provider output only ever
  // lands here; nothing mutates until the explicit human apply.
  const [pendingTier1, setPendingTier1] = useState<SealedTier1Proposal | null>(null);
  // B12: the originating agent run id for the pending proposal (audit metadata
  // only — never authority), the in-flight guard that disables Apply, and the
  // verified receipt of the last committed approval.
  const [pendingTier1RunId, setPendingTier1RunId] = useState<string | null>(null);
  const [tier1ApplyBusy, setTier1ApplyBusy] = useState(false);
  const [tier1Receipt, setTier1Receipt] = useState<ApprovedMutationReceipt | null>(null);
  // B14: the ONE pending sealed replacement proposal — same discipline: the
  // provider only ever lands an artifact here; nothing mutates until the
  // explicit human apply revalidates fresh server authority.
  const [pendingReplacement, setPendingReplacement] = useState<SealedReplacementProposal | null>(null);
  const [pendingReplacementRunId, setPendingReplacementRunId] = useState<string | null>(null);
  const [replacementApplyBusy, setReplacementApplyBusy] = useState(false);
  const [replacementReceipt, setReplacementReceipt] = useState<ReplacementMutationReceipt | null>(null);
  // [B15.3] the ONE pending sealed bounded PCB edit proposal — narrowed by
  // the SAFE discriminator only; display grants nothing. Apply authority
  // lives inside PcbEditor (the PCB composition root), never here.
  const [pendingPcbProposal, setPendingPcbProposal] = useState<{ proposal: SealedPcbEditProposal; originRunId: string | null } | null>(null);
  // [B17-F] the ONE pending agent layout candidate (placement / routing) narrowed by the SAFE receiver; the PCB
  // editor registers it in its own candidate store after re-verifying it. Display grants nothing.
  const [pendingLayoutCandidate, setPendingLayoutCandidate] = useState<{ candidate: LayoutCandidate; originRunId: string | null } | null>(null);
  // [B18-B] the ONE pending server-minted execution grant narrowed by the SAFE receiver; the PCB editor runs the
  // granted-execution ritual (preview grants wait for the human's Confirm; explicit grants execute once). Display grants nothing.
  const [pendingExecutionGrant, setPendingExecutionGrant] = useState<{ grant: ReceivedExecutionGrant["grant"]; decision: ReceivedExecutionGrant["decision"]; note: string | null; originRunId: string | null } | null>(null);
  // [B18-D I6/I8] one chat execution entry per grant, kept by grant id (the ref for handlers, the state for rendering).
  // Declared with the other pending grant state so the project reset below can clear it: entries never cross projects.
  const executionEntriesRef = useRef<Map<string, ExecutionEntry>>(new Map());
  const [executionEntries, setExecutionEntries] = useState<ReadonlyMap<string, ExecutionEntry>>(() => new Map());

  // B06.2/B07.2: pending schematic-history recovery decision (projection
  // conflict, corrupt durable history, or an identity-invalid projection
  // with no valid canonical fallback). While set, the session is
  // `conflicted`, canonical mutations are structurally rejected, and every
  // authoritative consumer (export, simulation, PCB sync, autosave,
  // checkpoints) is gated off through evaluateSchematicConsumerGate.
  const [schematicRecovery, setSchematicRecovery] = useState<ActiveSchematicRecovery | null>(null);
  // [B12.5 §C] Blocking activation recovery: a project activation failed in
  // its COMMIT phase (or current-project storage is unavailable at
  // bootstrap). The workspace can no longer claim a consistent installed
  // project, so a non-dismissible modal blocks until reload — neither the
  // target nor the survivor is reported installed.
  const [activationRecovery, setActivationRecovery] = useState<string | null>(null);
  const schematicRecoveryRef = useRef<typeof schematicRecovery>(null);
  useEffect(() => { schematicRecoveryRef.current = schematicRecovery; }, [schematicRecovery]);

  // Simulation state
  // B07.5 (failure E) — every run is request-owned through this runner:
  // scope + request id + base digest captured at invocation, abort on
  // project switch, stale results/errors/finally ignored. Reset (with all
  // the state below) by resetTransientProjectState on project transition.
  const simulationRunnerRef = useRef(new OwnedSimulationRunner());
  const [simResult, setSimResult]       = useState<SimResult | null>(null);
  const [simLoading, setSimLoading]     = useState(false);
  const [simError, setSimError]         = useState<string | null>(null);
  const [panes, setPanes]               = useState<Pane[]>([]);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [simMode, setSimMode]           = useState<SimMode>("probe");
  const [chartPanelOpen, setChartPanelOpen] = useState(true);
  const [analysisConfig, setAnalysisConfig] = useState<AnalysisConfig>(
    () => DEFAULT_ANALYSIS_CONFIGS.tran,
  );

  // Hydrate analysis config from localStorage post-mount (SSR safety).
  useEffect(() => { setAnalysisConfig(loadAnalysisConfig()); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ai/runtime", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((runtime: AiRuntimeInfo | null) => {
        if (runtime) setAiRuntime(runtime);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Could not load AI runtime metadata.");
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const storedBrain = loadAiBrainPreference();
    aiBrainRef.current = storedBrain;
    setAiBrain(storedBrain);
    const onBrainChange = (event: Event) => {
      const detail = (event as CustomEvent<LLMProviderId>).detail;
      if (detail === "openai" || detail === "anthropic") {
        aiBrainRef.current = detail;
        setAiBrain(detail);
      }
    };
    const onProviderFailure = (event: Event) => {
      const detail = (event as CustomEvent<{ provider?: LLMProviderId; retry?: () => void; stillCurrent?: () => boolean }>).detail;
      // B07.5 — the listener re-checks the event's OWNER: a failure whose
      // originating project/session generation (or component lifetime) has
      // ended must never repopulate the active project's failure state.
      if (detail?.stillCurrent?.() === false) return;
      if (detail?.provider === "openai" || detail?.provider === "anthropic") {
        lastAiRetryRef.current = detail.retry ?? null;
        setAiProviderFailure({ provider: detail.provider });
        setChatOpen(true);
      }
    };
    window.addEventListener("sirkit:ai-brain-change", onBrainChange);
    window.addEventListener("sirkit:ai-provider-failure", onProviderFailure);
    return () => {
      window.removeEventListener("sirkit:ai-brain-change", onBrainChange);
      window.removeEventListener("sirkit:ai-provider-failure", onProviderFailure);
    };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(analysisConfig)); }
    catch { /* ignore */ }
  }, [analysisConfig]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // ─── R06: durable project memory, undo/redo, checkpoints ───────────────────
  // One stable project identity; schematic + chat + workflow stage hydrate
  // from the SavedProject record on mount and autosave after every committed
  // mutation. Reload must return the exact same project.
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle", at: 0 });
  const [schHistoryView, setSchHistoryView] = useState<SchematicHistoryView>({ canUndo: false, canRedo: false, entries: [] });
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectList, setProjectList] = useState<SavedProject[]>([]);
  const [pcbMounted, setPcbMounted] = useState(false);
  const [pcbHydrateToken, setPcbHydrateToken] = useState(0);
  const hydratedRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  // Latch the PCB editor mounted the first time it is opened (see the render
  // site: it is hidden, not unmounted, on tab switches).
  useEffect(() => { if (view === "pcb") setPcbMounted(true); }, [view]);
  const schHistoryRef = useRef<SchematicHistory<SchematicSnapshot> | null>(null);
  // ── [B17-E] the project operation timeline: it REFERENCES the two authoritative histories (schematic snapshots,
  // canonical PCB history) and orders their operations; a project-level undo identifies the latest ELIGIBLE
  // operation (the store's head still matches) and delegates to that store's own undo — never cross-store atomicity.
  const [projectTimeline] = useState(() => new ProjectOperationTimeline());
  const projectTimelineEntries = useSyncExternalStore((listener) => projectTimeline.subscribe(listener), () => projectTimeline.entries(), () => projectTimeline.entries());
  const [projectTimelineNotice, setProjectTimelineNotice] = useState<string | null>(null);
  const schematicTimelineHead = useCallback((view: SchematicHistoryView) => ({ store: "schematic" as const, entryCount: view.entries.length, digest: engineeringDigest(view.entries.map((entry) => [entry.label, entry.at])) }), []);
  /** Publish the schematic history view AND record the operation on the project timeline. */
  const publishSchematicHistory = useCallback((kind: "commit" | "undo" | "redo" | "hydrate" | "restore", label?: string) => {
    const history = schHistoryRef.current;
    if (!history) return;
    const view = history.view();
    setSchHistoryView(view);
    projectTimeline.record({ store: "schematic", kind, label: label ?? (kind === "undo" ? view.redoLabel : view.undoLabel) ?? view.entries[view.entries.length - 1]?.label ?? "Schematic edit", actor: kind === "hydrate" || kind === "restore" ? "system" : "human", head: schematicTimelineHead(view) });
  }, [projectTimeline, schematicTimelineHead]);
  const historyLabelRef = useRef<string | null>(null);
  const pendingRecordRef = useRef<{ timer: ReturnType<typeof setTimeout>; snap: SchematicSnapshot; label: string } | null>(null);
  const autosaverRef = useRef<Autosaver | null>(null);
  const projectRef = useRef(project);
  // [B17-D] which editor tab is open is a `workspace.open-editor` view command; tab changes made elsewhere are mirrored.
  const workspaceView = useWorkspaceViewSession({ projectId: project?.id ?? "local", branchId: "main", actorId: "local", tab: view, available: WORKSPACE_TABS, applyTab: (tab) => setView(tab) });
  // [B17-F] ONE page-owned view-session bridge: every live editor view session registers into it; send() captures
  // one bounded view-context snapshot per chat request and server-validated view commands run through it.
  const viewSessionBridgeRef = useRef<ViewSessionBridge | null>(null);
  if (viewSessionBridgeRef.current === null) viewSessionBridgeRef.current = new ViewSessionBridge();
  useViewSessionBridge(viewSessionBridgeRef.current, workspaceView);
  // [B17-F] FIXTURE-RUNTIME diagnostic hook ONLY: when the server rendered the fixture-runtime banner (impossible in
  // production — the runtime refuses there), the deterministic browser journey may drive the bridge directly, exactly
  // as the chat page does with a server-validated request. The bridge grants nothing: the bus's own rules decide.
  useEffect(() => {
    if (typeof document === "undefined" || !document.querySelector('[data-testid="fixture-runtime-banner"]')) return;
    const bridge = viewSessionBridgeRef.current!;
    const host = window as unknown as { __sirkitViewBridge?: { capture(): ReturnType<ViewSessionBridge["capture"]>; execute(raw: unknown): ReturnType<ViewSessionBridge["execute"]> } };
    // The SAME capture the chat request sends (surfaces + the project timeline) and the SAME execute path.
    host.__sirkitViewBridge = { capture: () => bridge.capture(projectTimeline), execute: (raw) => bridge.execute(raw) };
    return () => { delete host.__sirkitViewBridge; };
  }, [projectTimeline]);
  useEffect(() => { projectRef.current = project; }, [project]);
  const liveStateRef = useRef({ components, wires, kicadComponents, netLabels, pageSize, messages, view, lastDesignPrompt });
  useEffect(() => { liveStateRef.current = { components, wires, kicadComponents, netLabels, pageSize, messages, view, lastDesignPrompt }; });
  // R06 wipe guard: between hydrateProject() switching projectRef and the
  // React commit that lands the hydrated values in liveStateRef, the live
  // state still holds the PREVIOUS (possibly initial-empty) values. A flush
  // in that window — pagehide during a slow first paint, autosaver destroy —
  // wrote empty state over a populated record. persistProject refuses to
  // write while this ref names the current project; the effect below clears
  // it in the same commit that carries the hydrated state (setProject and the
  // hydrated setStates batch together), so the first allowed write is always
  // the hydrated one.
  const pendingHydrationForRef = useRef<string | null>(null);
  useEffect(() => {
    if (project && pendingHydrationForRef.current === project.id) pendingHydrationForRef.current = null;
  }, [project, components, wires, kicadComponents, netLabels, messages, view]);

  /** Commit any debounce-pending history record immediately (before undo/redo). */
  const flushPendingRecord = useCallback(() => {
    const pending = pendingRecordRef.current;
    if (!pending || !schHistoryRef.current) return;
    clearTimeout(pending.timer);
    pendingRecordRef.current = null;
    schHistoryRef.current.record(pending.label, pending.snap);
  }, []);

  // ── B07.1/B07.2: the ONLY three functions allowed to write schematic
  // projection state. The structural CI gate (schematic-setter-gate.ts + its
  // test) rejects any raw setComponents/setWires/setKicadComponents/
  // setNetLabels/setAuthoritativeSchematic reference outside these bodies —
  // comments cannot exempt a call site. Every AUTHORITATIVE application
  // notifies the gesture coordinator WITH the applied state, which both
  // orphans stale in-flight results and records the authoritative snapshot
  // that commands and consumers use (B07.2 — never the visible projection,
  // which may be showing an uncommitted preview). Preview frames update the
  // visible projection only.

  const gestureCoordinatorRef = useRef<SchematicGestureCoordinator | null>(null);

  // B07.2 — reactive mirror of the authoritative schematic arrays for
  // rendering-level consumers (PCB editor, SPICE studio, BOM). Updated ONLY
  // inside the two authoritative appliers below (gate-enforced), so a
  // gesture preview can never reach those consumers.
  const [authoritativeSchematic, setAuthoritativeSchematic] = useState<SchematicState>({ components: [], wires: [], kicadComponents: [], netLabels: [] });

  /** Non-authoritative gesture preview frame (never recorded or persisted). */
  const applyGesturePreviewFrame = useCallback((frame: SchematicGraphAfter) => {
    if (frame.components) setComponents(frame.components);
    if (frame.wires) setWires(frame.wires);
    if (frame.kicadComponents) setKicadComponents(frame.kicadComponents);
    if (frame.netLabels) setNetLabels(frame.netLabels);
  }, []);

  /** Adopt a committed canonical result as ONE undoable history entry.
   *  B12.2 §C — the sequencing lives in the SHARED synchronous production
   *  primitive in lib/project/canonical-adoption.ts (also driven directly
   *  by tests): the authoritative projection AND the real SchematicHistory
   *  entry exist before this returns (hence before any approved-mutation
   *  receipt is consumed or commit lease released), the debounce watcher is
   *  suppressed from double-recording, and undo is available immediately. A
   *  failed adoption THROWS so the coordinator reports the job failed — an
   *  approved apply then poisons its proposal identity (recovery path)
   *  instead of displaying success. */
  const applyCanonicalSchematicProjection = useCallback((label: string, state: SchematicState) => {
    const outcome = adoptCanonicalResult<SchematicSnapshot>({
      flushPendingRecord: () => flushPendingRecord(),
      history: () => schHistoryRef.current,
      applyProjection: (authoritative) => {
        // The authoritative snapshot carries pageSize exactly as the
        // canonical state does (present iff canonical); the four arrays are
        // normalized to present-and-owned by the primitive.
        setComponents(authoritative.components);
        setWires(authoritative.wires);
        setKicadComponents(authoritative.kicadComponents!);
        setNetLabels(authoritative.netLabels!);
        setAuthoritativeSchematic(authoritative);
        gestureCoordinatorRef.current?.notifyAuthoritativeProjection(authoritative);
      },
      snapshot: (authoritative) => ({ components: authoritative.components, wires: authoritative.wires, kicadComponents: authoritative.kicadComponents!, netLabels: authoritative.netLabels! }),
      historyRecorded: () => publishSchematicHistory("commit"),
      // The design-state watcher's existing applying-history guard: it
      // clears the flag, schedules autosave, and records NOTHING for this
      // change — the canonical entry above stays the only one.
      suppressEffectRecord: () => { applyingHistoryRef.current = true; },
      scheduleAutosave: () => autosaverRef.current?.schedule(),
    }, label, state);
    if (!outcome.ok) throw new Error(`canonical adoption failed: ${outcome.detail}`);
  }, [flushPendingRecord, publishSchematicHistory]);

  /** Lifecycle replacement (hydration, undo/redo, canonical recovery
   *  adoption, gesture rollback) — applied without recording history. */
  const applyLifecycleSchematicProjection = useCallback((state: SchematicState) => {
    applyingHistoryRef.current = true;
    const authoritative: SchematicState = { components: state.components ?? [], wires: state.wires ?? [], kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [], ...(state.pageSize ? { pageSize: state.pageSize } : {}) };
    setComponents(authoritative.components);
    setWires(authoritative.wires);
    setKicadComponents(authoritative.kicadComponents!);
    setNetLabels(authoritative.netLabels!);
    setAuthoritativeSchematic(authoritative);
    gestureCoordinatorRef.current?.notifyAuthoritativeProjection(authoritative);
  }, []);

  // B07.4 — a suggestion batch goes STALE the moment any authoritative
  // mutation supersedes the base it was produced against: it is cleared,
  // never silently rebased onto the newer schematic.
  useEffect(() => {
    if (!pendingSuggestions) return;
    if (!pendingSuggestions.scope.isCurrent()
      || schematicStateDigest(authoritativeSchematic) !== pendingSuggestions.baseSchematicDigest) {
      setPendingSuggestions(null);
    }
  }, [authoritativeSchematic, pendingSuggestions]);

  /** User prompts + user-visible responses only — no secrets, no hidden reasoning. */
  function toStoredChat(all: Message[]): StoredChatMessage[] {
    return all.slice(-200).map((message) => message.role === "log"
      ? { id: message.id, role: "log" as const, title: message.title, status: message.status, entries: message.entries.map((entry) => ({ id: entry.id, text: entry.text, status: entry.status })) }
      : { id: message.id, role: message.role, content: message.content, ...(message.advisory ? { advisory: true } : {}) });
  }

  /** Reload during a pending operation must show a truthful interrupted state. */
  function fromStoredChat(stored: StoredChatMessage[]): Message[] {
    return stored.map((message) => message.role === "log"
      ? {
          id: message.id, role: "log" as const, title: message.title,
          status: message.status === "running" ? ("error" as const) : message.status,
          // [B18-E E1] a committed AI-change entry's undo hint is replaced by one that stays true after a reload
          entries: restoredEntryLog(message).entries.map((entry) => entry.status === "running" ? { ...entry, status: "error" as const, text: `${entry.text} (interrupted by reload)` } : entry),
        }
      : message);
  }

  const persistProject = useCallback((): { ok: true } | { ok: false; reason: string } => {
    const meta = projectRef.current;
    if (!meta) return { ok: false, reason: "No active project" };
    if (pendingHydrationForRef.current === meta.id) {
      // The hydrated values have not committed into liveStateRef yet — writing
      // now would overwrite the stored record with pre-hydration (empty)
      // state. Refuse; the autosaver keeps the save pending and retries after
      // the commit. If the page dies first, the stored record stays intact —
      // exactly the "preserve the last complete valid revision" contract.
      return { ok: false, reason: "Project hydration has not committed yet; nothing was written" };
    }
    // B07.2 — autosave persists the AUTHORITATIVE schematic (never a gesture
    // preview) and refuses while the canonical history is conflicted: a
    // projection awaiting a recovery decision must not be re-persisted as if
    // it were settled (the stored record stays exactly as it was).
    const autosaveGate = evaluateSchematicConsumerGate({
      lifecycle: schematicSessionRef.current?.lifecycle ?? null,
      recoveryPending: schematicRecoveryRef.current !== null,
      consumer: "autosave",
    });
    if (!autosaveGate.allowed) return { ok: false, reason: autosaveGate.reason };
    const live = liveStateRef.current;
    const authoritative = gestureCoordinatorRef.current!.authoritativeState();
    // B06.3: the projection's canonical-head mark follows the session
    // LIFECYCLE. Ready → the exact state and exact head mark save together.
    // Hydrating/conflicted/unavailable → the active mark is explicitly
    // CLEARED (patches merge, so omission would silently keep a stale mark
    // that this state never adopted). Unopened → untouched.
    const session = schematicSessionRef.current;
    const ok = saveProjectFields(meta.id, {
      state: { components: authoritative.components, wires: authoritative.wires, kicadComponents: authoritative.kicadComponents ?? [], netLabels: authoritative.netLabels ?? [], pageSize: authoritative.pageSize ?? live.pageSize },
      chat: toStoredChat(live.messages),
      designPrompt: live.lastDesignPrompt,
      workflowView: live.view,
      ...schematicMarkPatch(session?.lifecycle ?? "unopened", session?.headMark() ?? null),
    });
    return ok ? { ok: true } : { ok: false, reason: "Browser storage write failed (quota exceeded or storage unavailable)" };
  }, []);

  // B07.5 (failure B) — checkpoint LISTS are owned reads: every load
  // captures a ProjectAsyncScope (project id + session generation +
  // request id) and passes the latest-request gate, so a slower project-A
  // list can never replace project B's list, an older same-generation
  // request can never overwrite a newer refresh, and load ERRORS are
  // scoped the same way. Rows are additionally filtered to the exact
  // project id — a store that somehow returned foreign rows still cannot
  // surface another project's checkpoint in this history dialog.
  const checkpointListGateRef = useRef(new LatestRequestGate());
  const refreshCheckpoints = useCallback(() => {
    const id = projectRef.current?.id;
    if (!id) { setCheckpoints([]); return; }
    const scope = projectScopeRegistryRef.current!.capture();
    if (scope.projectId !== id) return; // registry not yet on this project — the hydration path reloads
    void checkpointListGateRef.current.run(scope, () => checkpointStore().list(id)).then((outcome) => {
      if (outcome.status === "applied") setCheckpoints(outcome.value.filter((row) => checkpointBelongsToProject(row, id)));
      else if (outcome.status === "failed") setCheckpoints([]); // scoped: still current AND newest
      // stale-project / superseded results and errors are ignored entirely.
    });
  }, []);

  // B07.4 — the ambient addCheckpoint helper is GONE: the only checkpoint
  // producer (successful machine adoption) writes immediately inside
  // applySchematic's onAdopted, from the exact adopted candidate to the
  // captured project. No delayed/ambient checkpoint path remains.

  /**
   * B06.2 — adopt a canonical schematic state into the UI and prove adoption
   * to the session (the readiness handshake). History resets to the adopted
   * state so undo cannot resurrect a superseded projection.
   */
  const adoptCanonicalSchematic = useCallback((session: SchematicEditorSession, adopted: SchematicState, label: string) => {
    // B07.5 (failure D) — final mutation boundary: only the ACTIVE mounted
    // session may adopt canonical state into the UI. A late callback holding
    // a superseded captured session must not invalidate the current
    // project's gesture coordinator, replace its projection, or reset its
    // history — even if every upstream scope check were bypassed.
    if (schematicSessionRef.current !== session) return;
    // B07.1: canonical recovery invalidates any pending gesture completion.
    gestureCoordinatorRef.current?.invalidate();
    applyLifecycleSchematicProjection(adopted);
    setSelectedId(null); setSelectedKicadId(null); setWireDraftStart(null);
    schHistoryRef.current = new SchematicHistory<SchematicSnapshot>({
      components: adopted.components, wires: adopted.wires,
      kicadComponents: adopted.kicadComponents ?? [], netLabels: adopted.netLabels ?? [],
    }, { label });
    publishSchematicHistory("restore", label);
    session.confirmAdoption(adopted);
  }, [applyLifecycleSchematicProjection, publishSchematicHistory]);

  /**
   * B07.4 — THE project-transition reset: every project-owned transient
   * field is intentionally reset or hydrated here (tested by the
   * transition-reset matrix). Late callbacks from the previous generation
   * cannot repopulate anything: the scope registry generation has already
   * advanced (fetches aborted, timers canceled) before these run.
   */
  const resetTransientProjectState = useCallback((record: SavedProject) => {
    setPendingReplace(null);            // no stale replacement dialog crosses projects
    setPendingTier1(null);              // no stale sealed proposal
    setPendingTier1RunId(null);         // B12: clear pending approval origin
    setTier1ApplyBusy(false);           // B12: no in-flight apply crosses projects
    setTier1Receipt(null);              // B12: a receipt belongs to its project
    setPendingPcbProposal(null);        // B15.3: no stale PCB proposal crosses projects
    setPendingExecutionGrant(null);     // B18-C review: a pending execution grant never crosses projects (it idles out server-side)
    executionEntriesRef.current.clear(); // [B18-D review] no execution entry crosses projects: a late editor callback for the
    setExecutionEntries(new Map());      // previous project's grant finds nothing to write into the new project's chat
    setSchematicRecovery(null);         // recovery re-evaluated by the new open
    // B07.5 (failure A) — release recovery-decision ownership: the previous
    // project's in-flight decision (if any) is already scope-stale; the new
    // project starts with the gate free and the buttons enabled.
    recoveryDecisionAdapterRef.current.reset();
    setRecoveryDecisionBusy(false);
    // B07.5 (failure B/D) — checkpoint list and selection never cross
    // projects: intentional empty state while the new project's scoped
    // loader runs; the history dialog closes so no stale row can be clicked.
    setCheckpoints([]);
    setHistoryOpen(false);
    // B07.5 (failure E) — simulation state is project-owned: results,
    // errors, panes/probes, active pane, and the loading flag all reset;
    // the runner's active-request ownership releases so an old finally
    // cannot clear a newer request's loading state. (simMode and
    // chartPanelOpen are app-level view preferences and intentionally
    // survive — they carry no project data.)
    simulationRunnerRef.current.reset();
    setSimResult(null);
    setSimError(null);
    setSimLoading(false);
    setPanes([]);
    setActivePaneId(null);
    setPendingSuggestions(null);        // suggestion batches are project-scoped
    setSuggestionsMinimized(false);
    setGenError(null);                  // provider errors never cross projects
    setAiProviderFailure(null);
    lastAiRetryRef.current = null;      // retries never replay across projects
    setIsGenerating(false); activeGenerationRef.current = null;
    setIsEditing(false); activeEditRef.current = null;
    setIsReviewing(false); activeReviewRef.current = null;
    setIsTidying(false); activeTidyRef.current = null;
    setIsSecondOpinion(false); activeSecondOpinionRef.current = null;
    setLoading(false); activeChatRef.current = null;
    // Hydrated (not leaked): the loaded value or an explicit default.
    setLastDesignPrompt(record.designPrompt ?? "");
  }, []);

  // B12.2 §A — the ONE serialized project-transition coordinator: every
  // bootstrap/switch/create/import hydration flows through `request()`.
  // Requests during a pending retirement JOIN the barrier (never bypass);
  // the LATEST target wins; earlier deferred requests are inert; the
  // retiring interlock stays reachable via `currentInterlock()` (no
  // null-interlock window); and no project is disposed while its approved
  // commit lease is held. `beforeInstall` flushes the retiring project's
  // persisted projection so a committed approved edit is durable before the
  // winning target installs.
  const projectTransitionRef = useRef<ProjectTransitionCoordinator | null>(null);
  if (projectTransitionRef.current === null) {
    projectTransitionRef.current = new ProjectTransitionCoordinator({
      // B12.3 §F / B12.6 — the required persistence flush reports a TYPED
      // outcome through the shared production settlement helper. The old
      // inline try/catch was aspirational: Autosaver.flush() reports
      // failure by RETURN VALUE (false, save kept pending), never by
      // throwing, so a failed retiring-project save silently installed
      // the replacement (reproduced pre-edit). The helper treats false
      // AND thrown flushes as transition failure with bounded, redacted
      // detail — the replacement never installs over unpersisted state.
      beforeInstall: () => settleAutosaveForTransition(autosaverRef.current),
    });
  }
  // B12.3 §A / B12.5 §A — the durable approved-mutation replay journal's
  // production store: IndexedDB, whose `saveIf` is a REAL cross-context
  // compare-and-swap (one readwrite transaction) with collision-free
  // [tenant, project, branch] array keys and fail-closed one-shot legacy
  // localStorage migration. One store for the page; a per-apply journal is
  // scoped to the captured tenant/project/branch.
  const approvedJournalStoreRef = useRef<IndexedDbApprovedMutationJournalStore | null>(null);
  if (approvedJournalStoreRef.current === null) approvedJournalStoreRef.current = new IndexedDbApprovedMutationJournalStore();
  // Teardown: pending continuations become inert (StrictMode-remount safe).
  useEffect(() => () => projectTransitionRef.current?.cancelPending(), []);

  /** Apply a loaded project record to the live editor state (the WINNING
   *  transition's install body — runs only after the prior incarnation's
   *  retirement barrier settles).
   *
   *  [B12.5 §C] TRANSACTIONAL ACTIVATION — three explicit phases:
   *   1. PREPARE: pure construction (session, history, projections);
   *      nothing live changes; a throw here is a typed PRE-COMMIT failure
   *      and the survivor stays visible, current and operational.
   *   2. POINTER COMMIT: the typed persistent `markProjectCurrent` write,
   *      still before ANY visible change; a refused write is a PRE-COMMIT
   *      failure (never an installed claim, never visible-B/persisted-A).
   *   3. COMMIT: live adoption composed of setState/ref assignments that
   *      do not throw. Guarded regardless — an unexpected throw here
   *      returns `recovery: true`: the coordinator retires the target's
   *      interlock and the page enters explicit blocking recovery rather
   *      than claiming either project installed. */
  const installProject = useCallback((record: SavedProject, opts?: { announce?: string }): ProjectInstallResult => {
    // ── Phase 1: PREPARE (no live-editor mutation) ──────────────────────
    let prepared: {
      state: SchematicState;
      messages: ReturnType<typeof fromStoredChat>;
      storedView: "schematic" | "pcb" | "3d" | "bom" | "sim" | null;
      history: SchematicHistory<SchematicSnapshot>;
      session: SchematicEditorSession;
      projectionForOpen: SchematicState;
    };
    try {
      const state = record.state;
      const viewCandidate = record.workflowView;
      prepared = {
        state,
        messages: record.chat ? fromStoredChat(record.chat) : [],
        storedView: viewCandidate === "schematic" || viewCandidate === "pcb" || viewCandidate === "3d" || viewCandidate === "bom" || viewCandidate === "sim" ? viewCandidate : null,
        history: new SchematicHistory<SchematicSnapshot>({
          components: state.components ?? [], wires: state.wires ?? [],
          kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [],
        }, { label: "Opened project" }),
        // B06: a fresh canonical schematic session per hydrated project — no
        // phantom history entries, no lineage carry-over across projects.
        session: new SchematicEditorSession({ tenantId: "local", projectId: record.id, branchId: "main" }),
        projectionForOpen: { components: state.components ?? [], wires: state.wires ?? [], kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [], pageSize: state.pageSize },
      };
    } catch (error) {
      return { ok: false, detail: `activation prepare failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    // ── Phase 2: POINTER COMMIT (typed; before any visible change) ──────
    // [B12.4 §E / B12.5 §C] The persisted current-project pointer commits
    // EXACTLY once per successful activation, HERE. Failed or superseded
    // transitions never reach the commit phase, so the pointer can never
    // disagree with the visibly installed project in either direction.
    const marked = markProjectCurrent(record.id);
    if (!marked.ok) {
      prepared.session.dispose();
      return { ok: false, detail: `current-project pointer persistence failed: ${marked.detail}` };
    }
    // ── Phase 3: COMMIT (no-throw by construction; guarded anyway) ──────
    try {
    // B07.1: project switch — any pending gesture completion from the
    // previous project is permanently orphaned before the new state lands.
    gestureCoordinatorRef.current?.invalidate();
    pendingHydrationForRef.current = record.id; // block persists until the hydrated commit lands
    if (pendingRecordRef.current) { clearTimeout(pendingRecordRef.current.timer); pendingRecordRef.current = null; }
    const state = prepared.state;
    applyLifecycleSchematicProjection(state); // hydration is not an undoable edit
    if (state.pageSize) setPageSize(state.pageSize);
    setMessages(prepared.messages);
    if (prepared.storedView !== null) {
      setView(prepared.storedView);
      if (prepared.storedView === "pcb") setPcbMounted(true);
    } else {
      setView("schematic");
    }
    setSelectedId(null); setSelectedKicadId(null); setWireDraftStart(null);
    setProject({ id: record.id, name: record.name });
    projectRef.current = { id: record.id, name: record.name };
    schHistoryRef.current = prepared.history;
    publishSchematicHistory("hydrate", "Opened project");
    // B06.1: the session opens the DURABLE canonical head and reconciles the
    // SavedProject projection against it. A stale projection cannot
    // overwrite a newer canonical head — the head is projected back out.
    schematicSessionRef.current?.dispose();
    const session = prepared.session;
    schematicSessionRef.current = session;
    // B12.2 §A — the incarnation's commit interlock was created by the
    // transition coordinator immediately before this install ran; approved
    // applies read it via projectTransitionRef.current.currentInterlock().
    // B07.4 — begin the new project GENERATION (aborts the previous
    // generation's fetches, cancels its timers, stales its scopes) and then
    // run the explicit transient-state reset.
    projectScopeRegistryRef.current!.beginProject({ projectId: record.id, branchId: "main", session });
    // B10 — the editor-context bridge follows the SAME project generation:
    // hydration retires the previous project's publisher, so a captured
    // chat context can never carry project A's board into project B.
    editorContextBridgeRef.current!.beginProject({ tenantId: "local", projectId: record.id, branchId: "main" });
    resetTransientProjectState(record);
    // B07.5 (failure C) — the hydration scope is captured IN the new
    // generation, tied to the exact new session: BOTH the outcome handler
    // and the error handler below are gated on it, so a slow project-A
    // open that settles (or fails) after a switch to B can neither surface
    // a toast nor change readiness/recovery state in B.
    const hydrationScope = projectScopeRegistryRef.current!.capture();
    const projectionForOpen = prepared.projectionForOpen;
    void session.openForProject(projectionForOpen, record.schematicCanonicalMark ?? null).then((outcome) => {
      if (schematicSessionRef.current !== session || !hydrationScope.isCurrent()) return; // superseded by a later hydrate
      // B07.2 — EXHAUSTIVE outcome handling: every SchematicHydrationOutcome
      // has explicit UI behavior; a future outcome variant fails the
      // compile-time never-check below instead of silently falling through.
      switch (outcome.status) {
        case "fresh":
        case "resumed":
        case "rebased-local-newer":
          break; // session ready; nothing to surface
        case "recovered-canonical":
          // B06.2: preserve the superseded projection BEFORE adopting, then
          // adopt the canonical state and prove adoption to the session.
          saveProjectFields(record.id, { schematicProjectionConflict: { state: projectionForOpen, reason: `superseded by canonical recovery (${outcome.reason})`, at: Date.now() } });
          adoptCanonicalSchematic(session, outcome.state, "Recovered canonical schematic");
          showToast(outcome.detail);
          break;
        case "projection-conflict":
          // Editing is disabled by the session until an explicit choice is
          // made. B07.2: an identity-INVALID local projection may only adopt
          // the canonical side — keep-local is not offered for it.
          setSchematicRecovery({ kind: outcome.status, reason: outcome.reason, detail: outcome.detail, canonicalState: outcome.canonicalState, projection: projectionForOpen, projectId: record.id });
          break;
        case "corrupt-history":
          setSchematicRecovery({ kind: outcome.status, detail: outcome.detail, projection: projectionForOpen, projectId: record.id });
          break;
        case "invalid-projection":
          // B07.2 — the projection itself failed identity/geometry
          // validation and NO valid canonical fallback exists: persistent
          // blocking recovery state. Nothing is edited, exported, simulated,
          // synchronized, autosaved, or checkpointed until repaired.
          setSchematicRecovery({ kind: outcome.status, detail: outcome.detail, issues: outcome.issues, projection: projectionForOpen, projectId: record.id });
          break;
        case "unavailable":
          showToast(outcome.detail);
          break;
        default: {
          const unhandled: never = outcome;
          throw new Error(`Unhandled schematic hydration outcome: ${JSON.stringify(unhandled)}`);
        }
      }
    }).catch((error: unknown) => {
      // B07.5 (failure C) — the CATCH path shares the exact ownership gate
      // of the success path: an old project's open failure never shows a
      // toast (or implies anything about readiness) in the new project.
      // The current project's own hydration failures still surface
      // truthfully; the session's lifecycle remains the structural
      // authority that keeps consumers gated off.
      if (schematicSessionRef.current !== session || !hydrationScope.isCurrent()) return;
      showToast(`Canonical schematic history could not be opened: ${error instanceof Error ? error.message : String(error)}. Canonical schematic editing is disabled.`);
    });
    setPcbHydrateToken((token) => token + 1);
    // B07.5 (failure B) — checkpoints were reset to the intentional empty
    // state inside resetTransientProjectState; the reload goes through the
    // scoped latest-request loader (never an ambient .then(setCheckpoints)).
    refreshCheckpoints();
    // [B12.5 §C] Success is announced as the commit phase's FINAL act —
    // no statement can fail after the toast and contradict it.
    if (opts?.announce) showToast(opts.announce);
    return { ok: true };
    } catch (error) {
      // [B12.5 §C] Commit-phase failure: visible state may be partially
      // adopted — blocking recovery, never a survivor-installed claim.
      return { ok: false, detail: `activation commit failed: ${error instanceof Error ? error.message : String(error)}`, recovery: true };
    }
  }, [adoptCanonicalSchematic, applyLifecycleSchematicProjection, resetTransientProjectState, refreshCheckpoints, publishSchematicHistory]);

  /** B12.2 §A — every hydration entry point routes through the serialized
   *  transition coordinator; only the LATEST requested target installs, and
   *  never while an approved commit lease is still held. */
  const hydrateProject = useCallback((record: SavedProject, opts?: { announce?: string }) => {
    projectTransitionRef.current!.request(
      () => installProject(record, opts),
      // B12.3 §F / B12.5 §C — truthful transition outcomes: a PRE-COMMIT
      // failure toasts "unchanged" (which is now literally guaranteed by
      // the activation protocol); a COMMIT-PHASE failure is BLOCKING
      // recovery — neither project may be claimed installed, so no
      // "unchanged" toast is ever shown for it. The winning install
      // announces itself; superseded requests stay silent.
      (outcome) => {
        if (outcome.status !== "transition-failed") return;
        if (outcome.recovery) {
          setActivationRecovery(outcome.detail);
          return;
        }
        showToast(`Project switch failed: ${outcome.detail}. The current project is unchanged.`);
      },
    );
  }, [installProject]);

  // Mount bootstrap: resolve or create the current project, hydrate, then arm
  // autosave. Runs post-mount because localStorage is browser-only.
  useEffect(() => {
    // [B12.5 §C] Truthful bootstrap: unavailable current-project storage
    // surfaces as explicit blocking recovery (never a phantom workspace
    // that persists nothing), and a resolved-but-unpersisted pointer is
    // REPORTED, not ignored.
    let boot: ProjectBootstrap;
    try {
      boot = bootstrapCurrentProject();
    } catch (error) {
      setActivationRecovery(`Project storage is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!boot.pointerPersisted) showToast("The current-project pointer could not be persisted — after a reload the browser may open a different project.");
    hydrateProject(boot.project);
    if (boot.dropped.length) showToast(`Recovered project "${boot.project.name}" — ${boot.dropped.length} corrupt optional record(s) were set aside: ${boot.dropped.join(", ")}`);
    setProjectList(listProjects());
    const autosaver = createAutosaver(persistProject);
    autosaverRef.current = autosaver;
    const unsubscribe = autosaver.subscribe(setSaveStatus);
    hydratedRef.current = true;
    const flush = () => { autosaver.flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    return () => {
      window.removeEventListener("pagehide", flush);
      unsubscribe();
      autosaver.destroy();
      autosaverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Design-state watcher: records undo history (debounced so a drag becomes
  // one step) and schedules autosave. Hydration/undo/redo set the applying
  // guard so they never re-record themselves.
  useEffect(() => {
    if (!hydratedRef.current || !schHistoryRef.current) return;
    // B07: intermediate pointer frames are non-authoritative previews — they
    // create no history entries and are never persisted. The completed
    // gesture commits canonically (which flows through here after preview
    // ownership clears at pointer-up).
    if (gestureCoordinatorRef.current?.previewActive) return;
    const snap: SchematicSnapshot = { components, wires, kicadComponents, netLabels };
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      autosaverRef.current?.schedule();
      return;
    }
    if (snap.components === schHistoryRef.current.present.components
      && snap.wires === schHistoryRef.current.present.wires
      && snap.kicadComponents === schHistoryRef.current.present.kicadComponents
      && snap.netLabels === schHistoryRef.current.present.netLabels) return;
    const label = historyLabelRef.current ?? "Edited schematic";
    historyLabelRef.current = null;
    if (pendingRecordRef.current) clearTimeout(pendingRecordRef.current.timer);
    pendingRecordRef.current = {
      snap, label,
      timer: setTimeout(() => {
        const pending = pendingRecordRef.current;
        pendingRecordRef.current = null;
        if (pending && schHistoryRef.current) {
          schHistoryRef.current.record(pending.label, pending.snap);
          publishSchematicHistory("commit", pending.label);
        }
      }, 350),
    };
    autosaverRef.current?.schedule();
  }, [components, wires, kicadComponents, netLabels, publishSchematicHistory]);

  // Non-design persisted state (chat, stage, prompt, page size) — autosave only.
  useEffect(() => {
    if (!hydratedRef.current) return;
    autosaverRef.current?.schedule();
  }, [messages, view, lastDesignPrompt, pageSize]);

  const applySchematicSnapshot = useCallback((snap: SchematicSnapshot) => {
    // B07.1: undo/redo replacement also orphans pending gesture completions
    // (the epoch bump inside the lifecycle applier).
    applyLifecycleSchematicProjection({ components: snap.components, wires: snap.wires, kicadComponents: snap.kicadComponents, netLabels: snap.netLabels });
    setSelectedId(null); setSelectedKicadId(null); setWireDraftStart(null);
  }, [applyLifecycleSchematicProjection]);

  /** B07.3 — TRANSACTIONAL undo/redo: the target is peeked without moving
   *  the cursor, canonical reconciliation (verified replay or documented
   *  rebase) runs first as a FIFO queue job (blocking gestures and
   *  commands), and only on success does the cursor move and the
   *  projection apply. A failure keeps cursor, projection, authoritative
   *  state, and canonical head unchanged and reports a structured message. */
  const runHistoryStep = useCallback((direction: "undo" | "redo") => {
    const session = schematicSessionRef.current;
    void gestureCoordinatorRef.current!.runHistoryStep({
      direction,
      peek: () => {
        flushPendingRecord();
        const history = schHistoryRef.current;
        if (!history) return null;
        const snap = direction === "undo" ? history.peekUndo() : history.peekRedo();
        return snap ? { components: snap.components, wires: snap.wires, kicadComponents: snap.kicadComponents, netLabels: snap.netLabels } : null;
      },
      reconcile: (target) => session
        ? session.reconcileHistoryStep(direction, target)
        : Promise.resolve({ ok: false, detail: "Schematic session unavailable." }),
      commitCursor: () => {
        const history = schHistoryRef.current;
        if (!history) return;
        if (direction === "undo") history.undo(); else history.redo();
        publishSchematicHistory(direction);
      },
      applyUi: () => {
        const history = schHistoryRef.current;
        if (!history) return;
        applySchematicSnapshot(history.present);
      },
    }).then((outcome) => {
      if (outcome.status === "refused-busy") showToast(outcome.detail);
      else if (outcome.status === "failed") showToast(`${direction === "undo" ? "Undo" : "Redo"} was not applied: ${outcome.detail}`);
    });
  }, [applySchematicSnapshot, flushPendingRecord, publishSchematicHistory]);

  const undoSchematic = useCallback(() => { runHistoryStep("undo"); }, [runHistoryStep]);
  const redoSchematic = useCallback(() => { runHistoryStep("redo"); }, [runHistoryStep]);
  // [B17-E] the schematic store lends the timeline its own undo and its current head fingerprint.
  useEffect(() => projectTimeline.bindStore("schematic", { undo: () => undoSchematic(), head: () => (schHistoryRef.current ? schematicTimelineHead(schHistoryRef.current.view()) : null) }), [projectTimeline, undoSchematic, schematicTimelineHead]);
  /** Project-level undo: identify the latest eligible operation across both stores and run THAT store's undo; refuse on divergence. */
  const undoLatestProjectOperation = useCallback(async () => {
    const decision = await projectTimeline.undoLatest();
    setProjectTimelineNotice(decision.ok ? null : `${decision.code} — ${decision.message}`);
    if (decision.ok) showToast(`Undid the latest ${decision.operation.store} operation: ${decision.operation.label}`);
  }, [projectTimeline]);

  // ── B06: canonical schematic command execution ─────────────────────────────
  // One migrated user action → one canonical transaction → one history entry.
  // Structured outcomes surface as toasts; there is NO direct-state fallback
  // for migrated actions — a rejected command changes nothing.
  const schematicSessionRef = useRef<SchematicEditorSession | null>(null);

  /** B07.2 — the authoritative schematic base for commands and consumers.
   *  NEVER the visible React projection (which may be an uncommitted
   *  gesture preview): the coordinator records the last authoritatively
   *  applied state. */
  const currentSchematicState = useCallback((): SchematicState => {
    return gestureCoordinatorRef.current!.authoritativeState();
  }, []);

  /** B07.2 — one shared readiness gate for authoritative consumers (export,
   *  simulation, PCB sync, autosave, checkpoints). Reads refs at CALL time
   *  so the decision is always current. */
  const schematicConsumerGate = useCallback((consumer: "export" | "simulation" | "pcb-sync" | "autosave" | "checkpoint" | "edit") =>
    evaluateSchematicConsumerGate({
      lifecycle: schematicSessionRef.current?.lifecycle ?? null,
      recoveryPending: schematicRecoveryRef.current !== null,
      consumer,
    }), []);

  /** B07.3 — sheet-size changes are TRANSACTIONAL lifecycle adoptions on
   *  the interaction queue: the controlled UI value, the authoritative
   *  mirror, and persistence change only AFTER canonical adoption succeeds
   *  (quarantine-first, on the captured session); a failed adoption leaves
   *  the sheet at its previous size with a structured refusal. */
  const changeSheetSize = useCallback((next: PageSize) => {
    const session = schematicSessionRef.current;
    const sheetForProject = projectRef.current?.id ?? null;
    const nextState: SchematicState = { ...gestureCoordinatorRef.current!.authoritativeState(), pageSize: next };
    void gestureCoordinatorRef.current!.adoptLifecycle({
      state: nextState,
      reason: `sheet size changed to ${next}`,
      stillCurrent: () => sheetForProject === null || projectRef.current?.id === sheetForProject,
      adopt: (candidate) => session
        ? session.adoptLifecycleProjection(candidate, `sheet size changed to ${next}`)
        : Promise.resolve({ ok: false as const, code: "no-service" as const, detail: "Schematic session unavailable — the sheet size was not changed." }),
      // Not an undoable operation: route through the lifecycle applier.
      applyUi: (candidate) => applyLifecycleSchematicProjection(candidate),
      onAdopted: () => setPageSize(next),
    }).then((outcome) => {
      if (outcome.status === "adopted" || outcome.status === "canceled-stale-project") return;
      showToast("detail" in outcome ? outcome.detail : "The sheet size was not changed.");
    });
  }, [applyLifecycleSchematicProjection]);

  /**
   * B07.3 — EVERY ordinary canonical command is a FIFO job on the
   * interaction queue: refused while a gesture owns the preview, executed
   * against the LATEST authoritative base at its execution position, and
   * its result adopted into the UI INSIDE the job (before the next job
   * runs) — so no committed result can be silently discarded and the
   * visible authoritative state always equals the durable head after queue
   * settlement. Only a project/session switch cancels a queued command.
   */
  const runSchematicCommand = useCallback(async (
    label: string,
    commandId: string,
    buildOperations: (schematic: CanonicalSchematic) => EngineeringOperation[],
    options?: {
      expectedBaseDigest?: string;
      /** B09.1 — sealed-proposal head-mark precondition, rechecked INSIDE
       *  the session's serialized queue immediately before execution. */
      expectedHeadMark?: SchematicCanonicalMark;
      /** B07.4 — invocation scope captured BEFORE any asynchronous
       *  preflight: the command submits to the CAPTURED session (never the
       *  current ref, which a project switch may have replaced) and is
       *  canceled at execution position when the scope went stale. */
      scope?: ProjectAsyncScope;
    },
  ): Promise<{ ok: boolean; state?: SchematicState }> => {
    const session = options?.scope
      ? (options.scope.session as SchematicEditorSession | null)
      : schematicSessionRef.current;
    if (!session) {
      showToast("Schematic session unavailable — reload the project.");
      return { ok: false };
    }
    const gate = await gestureCoordinatorRef.current!.runCanonicalCommand({
      label,
      ...(options?.scope ? { stillCurrent: () => options.scope!.isCurrent() } : {}),
      execute: (authoritativeBase) =>
        session.execute(authoritativeBase, {
          commandId,
          label,
          buildOperations,
          ...(options?.expectedBaseDigest !== undefined ? { expectedBaseDigest: options.expectedBaseDigest } : {}),
          ...(options?.expectedHeadMark !== undefined ? { expectedHeadMark: options.expectedHeadMark } : {}),
        }),
    });
    switch (gate.status) {
      case "applied":
      case "noop":
        return { ok: true, state: gate.result.ok ? gate.result.state : undefined };
      case "rejected":
        if (!gate.result.ok) showToast(gate.result.message);
        return { ok: false };
      case "refused-gesture-active":
        showToast(`"${label}" was not applied: finish or cancel the current move first. Nothing was changed.`);
        return { ok: false };
      case "canceled-stale":
        // Project/session changed — the old project's durable state (if the
        // command committed there) stands; the new project is untouched.
        return { ok: false };
      case "failed":
        showToast(`"${label}" was not applied: ${gate.error instanceof Error ? gate.error.message : String(gate.error)}. Nothing was changed.`);
        return { ok: false };
    }
  }, []);

  /**
   * Canonical delete. B06.2: the deterministic impact plan is computed
   * INSIDE the serialized session queue against the canonical head at
   * execution position — only static catalog pin data is fetched up front,
   * so a queued delete can never execute a plan built on a stale snapshot.
   */
  const deleteComponentCanonical = useCallback(async (family: "theory" | "kicad", componentId: string) => {
    // B07.4 (failure D) — the invocation scope is captured BEFORE the
    // catalog preflight: after part data resolves, the command may only
    // submit to the CAPTURED project/session; a switch during the await
    // cancels it (part ids and even component ids repeat across projects —
    // a same-id component in another project must never be deleted). The
    // deterministic impact plan is still computed inside the serialized
    // session queue against the latest canonical head of that SAME project.
    const scope = projectScopeRegistryRef.current!.capture();
    let pins: CachedPart["pins"] | undefined;
    let label = "Deleted component";
    if (family === "kicad") {
      const instance = liveStateRef.current.kicadComponents.find((item) => item.id === componentId);
      if (!instance) return;
      const part = getCachedPart(instance.partId) ?? (await ensurePartLoaded(instance.partId));
      if (!scope.isCurrent()) return; // project changed during preflight — cancel silently
      if (!part?.pins) {
        showToast("Part data is unavailable — a safe delete plan cannot be computed.");
        return;
      }
      pins = part.pins;
      label = `Deleted ${instance.refDes}`;
    }
    let refusal: string | null = null;
    const outcome = await runSchematicCommand(label, "schematic.delete-component", (canonical) => {
      const planned = planSchematicDelete(fromCanonicalSchematic(canonical), { family, componentId }, pins);
      if (!planned.ok) {
        // Component already gone at execution position → silent no-op; other
        // refusals surface after the command resolves.
        if (planned.refusal !== "component-not-found") refusal = planned.detail;
        return [];
      }
      return [planned.operation];
    }, { scope });
    if (refusal) {
      scope.ifCurrent(() => showToast(refusal!));
      return;
    }
    if (outcome.ok) {
      scope.ifCurrent(() => {
        setSelectedId(null);
        setSelectedKicadId(null);
      });
    }
  }, [runSchematicCommand]);

  /** Canonical discrete rotate (+90°) for the selected component. */
  const rotateComponentCanonical = useCallback((family: "theory" | "kicad", componentId: string, label: string, absoluteRotation?: Rotation) => {
    void runSchematicCommand(label, "schematic.move-rotate", (schematic) => {
      const array = family === "theory" ? schematic.components : schematic.kicadComponents;
      const component = array.find((item) => item.id === componentId);
      if (!component) return [];
      const rotation = absoluteRotation ?? (((component.rotation + 90) % 360) as Rotation);
      return [{ operationId: `op:sch-rotate:${componentId}`, schemaVersion: 1, units: "px", kind: "schematic_transform_component", family, componentId, x: component.x, y: component.y, rotation }];
    });
  }, [runSchematicCommand]);

  /** Canonical property edit (value / refDes) for one component. */
  const setComponentPropertiesCanonical = useCallback((family: "theory" | "kicad", componentId: string, patch: { value?: string; refDes?: string }, label: string) => {
    void runSchematicCommand(label, "schematic.set-property", () => [
      { operationId: `op:sch-props:${componentId}`, schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family, componentId, patch },
    ]);
  }, [runSchematicCommand]);

  // ── B07: canonical graph commands + the gesture transaction contract ───────
  // Click-driven graph edits recompute their result from the canonical head
  // INSIDE the serialized queue and compile it to primitive operations via
  // the deterministic graph diff. Pointer gestures (drag/stretch/label/SPICE
  // move) render non-authoritative preview frames only; pointer-up commits
  // ONE atomic transaction pinned to the pre-gesture base digest. B07.1: the
  // gesture LIFECYCLE (ownership, cancellation, late-completion gating,
  // project-switch invalidation) lives in the extracted, individually tested
  // SchematicGestureCoordinator — a late success or failure can only touch
  // the projection while its captured epoch is still current, so it can
  // never overwrite a newer command result, hydration, recovery, undo/redo,
  // or another project's state. Intermediate frames are never recorded or
  // persisted (the design-state watcher is suppressed while a gesture owns
  // the preview).

  const applyGesturePreviewFrameRef = useRef(applyGesturePreviewFrame);
  applyGesturePreviewFrameRef.current = applyGesturePreviewFrame;
  const applyCanonicalSchematicProjectionRef = useRef(applyCanonicalSchematicProjection);
  applyCanonicalSchematicProjectionRef.current = applyCanonicalSchematicProjection;
  const applyLifecycleSchematicProjectionRef = useRef(applyLifecycleSchematicProjection);
  applyLifecycleSchematicProjectionRef.current = applyLifecycleSchematicProjection;
  if (gestureCoordinatorRef.current === null) {
    gestureCoordinatorRef.current = new SchematicGestureCoordinator({
      currentState: () => {
        const live = liveStateRef.current;
        return { components: live.components, wires: live.wires, kicadComponents: live.kicadComponents, netLabels: live.netLabels, pageSize: live.pageSize };
      },
      applyPreviewFrame: (frame) => applyGesturePreviewFrameRef.current(frame),
      applyCanonicalProjection: (label, state) => applyCanonicalSchematicProjectionRef.current(label, state),
      applyRollbackProjection: (state) => applyLifecycleSchematicProjectionRef.current(state),
      execute: (base, request) => {
        const session = schematicSessionRef.current;
        return session ? session.execute(base, request) : Promise.resolve(null);
      },
      notify: (message) => { if (message) showToast(message); },
    });
  }
  const gestureCoordinator = gestureCoordinatorRef.current;
  // Unmount: orphan any pending completion so a late result can never write
  // into a dead (or remounted) tree. `invalidate` (not `dispose`) keeps the
  // coordinator usable across a StrictMode dev remount.
  useEffect(() => () => gestureCoordinator.invalidate(), [gestureCoordinator]);

  const graphCommand = useCallback(async (
    label: string,
    commandId: string,
    buildAfter: (state: SchematicState) => SchematicGraphAfter | null,
  ): Promise<{ ok: boolean }> => {
    let failure: string | null = null;
    const outcome = await runSchematicCommand(label, commandId, (canonical) => {
      try {
        const after = buildAfter(fromCanonicalSchematic(canonical));
        return after ? diffSchematicGraphOps(canonical, after) : [];
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        return [];
      }
    });
    if (failure) {
      showToast(`"${label}" was not applied: ${failure}. Nothing was changed.`);
      return { ok: false };
    }
    return { ok: outcome.ok };
  }, [runSchematicCommand]);

  /** The single graph-mutation authority handed to the canvas (stable).
   *  B07.1: the gesture lifecycle delegates to the race-safe coordinator —
   *  `begin` reports ownership (false while another gesture is active or a
   *  commit is in flight), `preview` renders frames only for the owner. */
  const schematicGraphApi = useMemo(() => ({
    run: (label: string, commandId: string, buildAfter: (state: SchematicState) => SchematicGraphAfter | null) => { void graphCommand(label, commandId, buildAfter); },
    begin: () => gestureCoordinator.begin(),
    preview: (frame: SchematicGraphAfter) => gestureCoordinator.preview(frame),
    cancel: () => gestureCoordinator.cancel(),
    commit: (label: string, finalGraph: SchematicGraphAfter) => { void gestureCoordinator.commit(label, finalGraph); },
  }), [graphCommand, gestureCoordinator]);

  // ── B06.1: sealed tier-1 proposal apply/cancel ─────────────────────────────
  // Apply re-verifies the sealed proposal (identity digest, operations
  // digest, expiry, exact base-schematic digest) and executes the EXACT
  // sealed operations as one atomic canonical transaction with the base
  // digest re-checked inside the serialized session queue. Cancel discards
  // without any mutation. Stale or altered proposals are rejected.
  // B12.1 — the explicit "Apply exact proposal" click runs the SHARED
  // approved-execution service (`applyApprovedTier1Proposal`) THROUGH the
  // page's own SchematicGestureCoordinator (§A): the apply serializes with
  // gestures, hand edits, undo/redo, and lifecycle jobs; verification runs
  // against the authoritative head at the serialized execution position; a
  // committed result is adopted by `applyCanonicalSchematicProjection` —
  // one canonical projection update and one SchematicHistory entry — before
  // the service consumes the receipt. The commit interlock (§B) orders the
  // apply's critical section against project transition/retirement.
  const applyTier1Proposal = useCallback(async () => {
    const proposal = pendingTier1;
    if (!proposal || tier1ApplyBusy) return;
    const originRunId = pendingTier1RunId;
    // B07.4 — scope captured BEFORE any async work; the command submits to the
    // captured session and all post-apply UI is project-guarded.
    const scope = projectScopeRegistryRef.current!.capture();
    const applySession = schematicSessionRef.current;
    // B12.2 §A — the interlock comes from the transition coordinator and is
    // NEVER null while a project exists; during a pending transition this is
    // the RETIRING interlock, whose lease acquisition refuses the apply. An
    // apply can never proceed without an interlock.
    const applyInterlock = projectTransitionRef.current!.currentInterlock();
    const currentProjectId = scope.projectId ?? projectRef.current?.id ?? null;
    if (!applySession || !currentProjectId || !applyInterlock) {
      setPendingTier1(null);
      setPendingTier1RunId(null);
      showToast("Proposal rejected: the schematic session is not ready to verify the proposal's scope. Nothing was changed.");
      return;
    }
    setTier1ApplyBusy(true);
    try {
      const outcome = await applyApprovedTier1Proposal({
        proposal,
        session: applySession,
        gateway: gestureCoordinatorRef.current!,
        interlock: applyInterlock,
        // B12.3 §A — durable replay journal scoped to the CAPTURED project.
        journal: new ApprovedMutationJournal(approvedJournalStoreRef.current!, { tenantId: "local", projectId: currentProjectId, branchId: scope.branchId }),
        // [B16.0.1 §F] apply-time membership reauthorization through the ONE
        // narrow same-origin endpoint — the live membership must still match
        // the proposal's sealed authorization binding or the apply refuses.
        reauthorize: createMembershipReauthorizer(),
        stillCurrent: () => scope.isCurrent(),
        currentProjectId,
        currentBranchId: scope.branchId,
        originRunId,
      });
      // Late completions must never write UI state into a replacement project.
      scope.ifCurrent(() => {
        if (outcome.ok) {
          setPendingTier1(null);
          setPendingTier1RunId(null);
          setTier1Receipt(outcome.receipt);
          setSelectedId(null);
          setSelectedKicadId(null);
          const verb = outcome.status === "already-applied" ? "was already applied" : "applied";
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", content: `Proposal ${verb} — canonical transaction ${outcome.receipt.transactionId.slice(0, 12)}… (${outcome.receipt.operationCount} operation(s), verified).` },
          ]);
          autoRunIncludesTidy.current = false;
          setAutoRunToken((t) => t + 1);
        } else {
          // A stale/foreign/verification refusal dismisses the dialog (the
          // proposal can never apply now); a retryable refusal (another
          // apply in flight, or a gesture owning the preview) keeps it.
          if (outcome.code !== "already-in-flight" && outcome.code !== "editor-busy") { setPendingTier1(null); setPendingTier1RunId(null); }
          showToast(outcome.message);
        }
      });
    } finally {
      scope.ifCurrent(() => setTier1ApplyBusy(false));
    }
  }, [pendingTier1, pendingTier1RunId, tier1ApplyBusy]);

  const cancelTier1Proposal = useCallback(() => {
    // Cancel must not race into a successful apply: a busy dialog ignores it.
    if (tier1ApplyBusy) return;
    if (pendingTier1) approvedMutationAudit.record({ at: Date.now(), proposalId: pendingTier1.proposalId, originRunId: pendingTier1RunId, event: "canceled", code: null });
    setPendingTier1(null);
    setPendingTier1RunId(null);
    showToast("Proposal discarded — nothing was changed.");
  }, [tier1ApplyBusy, pendingTier1, pendingTier1RunId]);

  // ── B14: approved exact component replacement (explicit human apply) ───────
  // Same B12 discipline as the Tier-1 apply above: scope captured before any
  // async work; the interlock comes from the transition coordinator; the
  // durable journal is scoped to the CAPTURED project; the apply revalidates
  // fresh server authority through the trusted reauthorization adapter and
  // executes exactly ONE canonical schematic.replace-component transaction.
  const applyReplacementProposal = useCallback(async () => {
    const proposal = pendingReplacement;
    if (!proposal || replacementApplyBusy) return;
    const originRunId = pendingReplacementRunId;
    const scope = projectScopeRegistryRef.current!.capture();
    const applySession = schematicSessionRef.current;
    const applyInterlock = projectTransitionRef.current!.currentInterlock();
    const currentProjectId = scope.projectId ?? projectRef.current?.id ?? null;
    if (!applySession || !currentProjectId || !applyInterlock) {
      setPendingReplacement(null);
      setPendingReplacementRunId(null);
      showToast("Replacement rejected: the schematic session is not ready to verify the proposal's scope. Nothing was changed.");
      return;
    }
    setReplacementApplyBusy(true);
    try {
      // [B14.1 §A] the explicit click flows through the PRODUCTION approval
      // controller, which issues the one-shot interactive approval intent and
      // the authentic reauthorization channel — the service refuses without
      // both, so no other invoker can commit a replacement.
      const outcome = await approveAndApplyReplacement({
        proposal,
        session: applySession,
        gateway: gestureCoordinatorRef.current!,
        interlock: applyInterlock,
        journal: new ApprovedMutationJournal(approvedJournalStoreRef.current!, { tenantId: "local", projectId: currentProjectId, branchId: scope.branchId }),
        stillCurrent: () => scope.isCurrent(),
        currentProjectId,
        currentBranchId: scope.branchId,
        originRunId,
      });
      scope.ifCurrent(() => {
        if (outcome.ok) {
          setPendingReplacement(null);
          setPendingReplacementRunId(null);
          setReplacementReceipt(outcome.receipt);
          setSelectedId(null);
          setSelectedKicadId(null);
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: replacementChatLines.applied({ alreadyApplied: outcome.status === "already-applied", sourcePartId: outcome.receipt.sourcePartId, targetPartId: outcome.receipt.target.partId, transactionId: outcome.receipt.transactionId }) }]);
          autoRunIncludesTidy.current = false;
          setAutoRunToken((t) => t + 1);
        } else {
          if (outcome.code !== "already-in-flight" && outcome.code !== "editor-busy") { setPendingReplacement(null); setPendingReplacementRunId(null); }
          showToast(outcome.message);
          // [B18-E E15] a refused apply used to be a toast and nothing else: the run log kept saying a proposal awaited
          // review and never said the attempt failed. The chat now says it, in the same place the success sentence lands.
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: replacementChatLines.refused(outcome.message) }]);
        }
      });
    } finally {
      scope.ifCurrent(() => setReplacementApplyBusy(false));
    }
  }, [pendingReplacement, pendingReplacementRunId, replacementApplyBusy]);

  const cancelReplacementProposal = useCallback(() => {
    if (replacementApplyBusy) return;
    if (pendingReplacement) approvedMutationAudit.record({ at: Date.now(), proposalId: pendingReplacement.proposalId, originRunId: pendingReplacementRunId, event: "canceled", code: null });
    setPendingReplacement(null);
    setPendingReplacementRunId(null);
    showToast(replacementChatLines.discarded());
    // [B18-E E15] and the chat is told the decision, so the run log does not keep saying a proposal awaits review.
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: replacementChatLines.discarded() }]);
  }, [replacementApplyBusy, pendingReplacement, pendingReplacementRunId]);

  // ── B06.2: explicit schematic-history recovery choices ─────────────────────
  // While a recovery is pending the session is `conflicted` and every
  // canonical mutation is structurally rejected with a truthful message.
  // B06.3: a recovery choice only dismisses the dialog when it SUCCEEDS. A
  // failed quarantine (or any failure outcome) keeps/refreshes the dialog so
  // retry or another choice stays available — preservation is never claimed
  // unless it occurred.
  //
  // B07.5 (failure A) — every recovery decision is an OWNED submission
  // through one shared adapter: a ProjectAsyncScope is captured before
  // submitting, the recovery record's project id and the captured session
  // must match that scope, duplicate clicks are refused while a decision is
  // in flight (the buttons are also disabled), and a completion whose
  // project generation ended updates NOTHING in the new project — no
  // dialog, projection, history, selection, toast, or persistence. An
  // old-session durable recovery may still stand on its own captured
  // session; reopening that project surfaces the resulting canonical state
  // through normal hydration/reconciliation. Quarantine-first semantics
  // live in the session methods and are unchanged.
  const recoveryDecisionAdapterRef = useRef(new OwnedRecoveryDecisionAdapter());
  const [recoveryDecisionBusy, setRecoveryDecisionBusy] = useState(false);
  const submitRecoveryDecision = useCallback(<T,>(
    decide: (session: SchematicEditorSession, recovery: ActiveSchematicRecovery) => Promise<T>,
    applyOutcome: (outcome: T, context: { recovery: ActiveSchematicRecovery; session: SchematicEditorSession }) => void,
  ) => {
    const recovery = schematicRecoveryRef.current;
    const session = schematicSessionRef.current;
    if (!recovery || !session) return;
    const scope = projectScopeRegistryRef.current!.capture();
    setRecoveryDecisionBusy(true);
    void recoveryDecisionAdapterRef.current.submit({
      scope,
      recoveryProjectId: recovery.projectId,
      session,
      decide: (owned) => decide(owned, recovery),
    }).then((result) => {
      // A duplicate click never releases the FIRST decision's busy state.
      if (result.status === "refused-busy") return;
      scope.ifCurrent(() => setRecoveryDecisionBusy(false));
      if (result.status === "applied") {
        // Final mutation boundary: current generation AND the exact session.
        scope.ifCurrent(() => {
          if (schematicSessionRef.current === session) applyOutcome(result.outcome, { recovery, session });
        });
      } else if (result.status === "failed") {
        scope.ifCurrent(() => showToast(`Recovery failed: ${result.error instanceof Error ? result.error.message : String(result.error)}. The recovery dialog stays open — retry or choose another option.`));
      }
      // refused-identity / stale-project: nothing may change in this project.
    });
  }, []);

  const resolveRecoveryKeepLocal = useCallback(() => {
    submitRecoveryDecision(
      (session, recovery) => session.resolveConflictKeepLocal(recovery.projection),
      (outcome, { recovery }) => {
        if (outcome.status === "rebased-local-newer") setSchematicRecovery(null);
        else if (outcome.status === "projection-conflict" || outcome.status === "corrupt-history") {
          setSchematicRecovery({ ...recovery, kind: outcome.status === "corrupt-history" ? "corrupt-history" : "projection-conflict", detail: outcome.detail });
        } else if (outcome.status === "invalid-projection") {
          // B07.2 — keep-local was attempted on an identity-invalid local
          // projection: the session refused; the recovery stays pending with
          // the named issues (the dialog hides keep-local for this state).
          setSchematicRecovery({ ...recovery, kind: "invalid-projection", detail: outcome.detail, issues: outcome.issues });
        }
        showToast(outcome.detail);
      },
    );
  }, [submitRecoveryDecision]);

  const resolveRecoveryAdoptCanonical = useCallback(() => {
    submitRecoveryDecision(
      (session) => session.resolveConflictAdoptCanonical(),
      (outcome, { recovery, session }) => {
        if (outcome.status === "recovered-canonical") {
          // Preserve the local projection only ON success, then adopt — all
          // inside the owned-application boundary, so a late project-A
          // outcome can never persist into or adopt over project B.
          saveProjectFields(recovery.projectId, { schematicProjectionConflict: { state: recovery.projection, reason: "conflict resolved by adopting canonical history", at: Date.now() } });
          setSchematicRecovery(null);
          adoptCanonicalSchematic(session, outcome.state, "Adopted canonical schematic");
        } else if (outcome.status === "projection-conflict" || outcome.status === "corrupt-history") {
          setSchematicRecovery({ ...recovery, detail: outcome.detail });
        }
        showToast(outcome.detail);
      },
    );
  }, [submitRecoveryDecision, adoptCanonicalSchematic]);

  const resolveRecoveryStartFresh = useCallback(() => {
    submitRecoveryDecision(
      (session, recovery) => session.recoverStartFresh(recovery.projection),
      (outcome, { recovery }) => {
        if (outcome.status === "fresh") setSchematicRecovery(null);
        else if (outcome.status === "corrupt-history") setSchematicRecovery({ ...recovery, detail: outcome.detail });
        else if (outcome.status === "invalid-projection") {
          // B07.2 — a fresh lineage cannot be minted from an identity-invalid
          // projection; the blocking recovery state persists with the issues.
          setSchematicRecovery({ ...recovery, kind: "invalid-projection", detail: outcome.detail, issues: outcome.issues });
        }
        showToast(outcome.detail);
      },
    );
  }, [submitRecoveryDecision]);

  /** B07.2 — read-only raw recovery export: downloads the exact stored
   *  projection as JSON so no data is lost while the project is blocked.
   *  Nothing is repaired or rewritten. */
  const downloadRecoveryBackup = useCallback(() => {
    const recovery = schematicRecovery;
    if (!recovery) return;
    const blob = new Blob(
      [JSON.stringify({ projectId: recovery.projectId, exportedAt: new Date().toISOString(), kind: recovery.kind, issues: recovery.issues ?? [], schematic: recovery.projection }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sirkit-recovery-${recovery.projectId}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [schematicRecovery]);

  // Ctrl+Z / Ctrl+Y for the schematic editor (the PCB editor owns its own
  // shortcuts and is gated by its `active` prop while hidden).
  useEffect(() => {
    if (view !== "schematic") return;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      e.preventDefault();
      if (key === "y" || (key === "z" && e.shiftKey)) redoSchematic();
      else undoSchematic();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, undoSchematic, redoSchematic]);

  /**
   * B07.3 — TRANSACTIONAL checkpoint restore: readiness-gated, validated,
   * canonically adopted FIRST (quarantine-first, on the captured session),
   * and only after successful adoption does anything change — schematic
   * projection/history, page size, chat, the pcbWorking record, PCB
   * hydration, the "Restored" toast, and the dialog. On any failure or
   * stale token the prior project stays byte-for-byte unchanged and a
   * structured refusal is shown. Also NOT a recovery bypass: the readiness
   * gate refuses while invalid-projection/conflict recovery is pending.
   */
  const restoreCheckpoint = useCallback((checkpoint: ProjectCheckpoint) => {
    const meta = projectRef.current;
    if (!meta) return;
    // B07.5 (failure B/D) — EXACT-project restore: a checkpoint whose
    // projectId is not the active project is refused before any gate,
    // adoption, or mutation — even if a stale list render or late callback
    // put it in front of the user. No schematic, PCB, chat, dialog, or
    // storage change occurs on mismatch.
    if (!checkpointBelongsToProject(checkpoint, meta.id)) {
      showToast("That checkpoint belongs to a different project and was not restored. Nothing was changed. Open its own project to restore it.");
      return;
    }
    const gate = evaluateSchematicConsumerGate({
      lifecycle: schematicSessionRef.current?.lifecycle ?? null,
      recoveryPending: schematicRecoveryRef.current !== null,
      consumer: "edit",
    });
    if (!gate.allowed) { showToast(gate.reason); return; }
    const restoredState: SchematicState = {
      components: checkpoint.schematic.components ?? [],
      wires: checkpoint.schematic.wires ?? [],
      kicadComponents: checkpoint.schematic.kicadComponents ?? [],
      netLabels: checkpoint.schematic.netLabels ?? [],
      ...(checkpoint.schematic.pageSize ? { pageSize: checkpoint.schematic.pageSize } : { ...(liveStateRef.current.pageSize ? { pageSize: liveStateRef.current.pageSize } : {}) }),
    };
    const session = schematicSessionRef.current;
    const restoredForProject = meta.id;
    // B07.5 — scope of record for the restore: generation-current AND the
    // active project still the checkpoint's owner at the adoption boundary
    // (the identity predicate runs AGAIN here — defense in depth beyond the
    // entry check and beyond React state having been cleared).
    const restoreScope = projectScopeRegistryRef.current!.capture();
    void gestureCoordinator.adoptLifecycle({
      state: restoredState,
      reason: `checkpoint restored: ${checkpoint.label}`,
      stillCurrent: () => restoreScope.isCurrent()
        && projectRef.current?.id === restoredForProject
        && checkpointBelongsToProject(checkpoint, projectRef.current?.id ?? null),
      adopt: (candidate) => session
        ? session.adoptLifecycleProjection(candidate, `checkpoint restored: ${checkpoint.label}`)
        : Promise.resolve({ ok: false as const, code: "no-service" as const, detail: "Schematic session unavailable — reload the project." }),
      applyUi: (candidate) => applyCanonicalSchematicProjection(`Restored checkpoint: ${checkpoint.label}`, candidate),
      onAdopted: () => {
        if (checkpoint.schematic.pageSize) setPageSize(checkpoint.schematic.pageSize);
        if (checkpoint.chat) setMessages(fromStoredChat(checkpoint.chat));
        if (checkpoint.board) {
          // Persist first (survives a crash before the editor consumes it),
          // then hand the exact board to the PCB editor — an explicit restore
          // wins even when the durable server authority has advanced.
          const ok = saveProjectFields(restoredForProject, { pcbWorking: { board: checkpoint.board, baseRevision: checkpoint.boardBase?.revision ?? null, baseDigest: checkpoint.boardBase?.digest ?? null, updatedAt: Date.now() } });
          if (!ok) { showToast("Checkpoint board could not be written to browser storage; schematic was restored, PCB was not."); return; }
          requestBoardRestore(checkpoint.board);
          setPcbMounted(true);
          setPcbHydrateToken((token) => token + 1);
        }
        showToast(`Restored checkpoint: ${checkpoint.label}`);
        setHistoryOpen(false);
      },
    }).then((outcome) => {
      if (outcome.status === "adopted" || outcome.status === "canceled-stale-project") return;
      showToast("detail" in outcome ? outcome.detail : "Checkpoint restore was not applied.");
    });
  }, [applyCanonicalSchematicProjection, gestureCoordinator]);

  const switchProject = useCallback((id: string) => {
    if (projectRef.current?.id === id) return;
    // B12.4 §E — loading a switch target does NOT activate it; the
    // persisted current-project pointer commits only inside the winning
    // install. The one required flush is the transition coordinator's
    // typed beforeInstall hook (no raw autosaver call in a click handler).
    const opened = loadProjectRecord(id);
    if (!opened) { showToast("That project could not be loaded — its record is missing or unreadable. It was not opened and nothing was lost."); return; }
    hydrateProject(opened.project, { announce: `Opened "${opened.project.name}"` });
    if (opened.dropped.length) showToast(`Opened with ${opened.dropped.length} corrupt optional record(s) set aside: ${opened.dropped.join(", ")}`);
    setProjectList(listProjects());
  }, [hydrateProject]);

  const createNewProject = useCallback(() => {
    // B12.4 §E — the record is persisted, but it becomes CURRENT only when
    // its installation wins (markProjectCurrent inside installProject).
    const created = createProjectRecord();
    hydrateProject(created, { announce: `Created "${created.name}"` });
    setProjectList(listProjects());
  }, [hydrateProject]);

  const handleExportProject = useCallback(async () => {
    const meta = projectRef.current;
    if (!meta) return;
    const flushed = autosaverRef.current?.flush() ?? true;
    if (!flushed) { showToast("Cannot export: the latest changes failed to save to browser storage."); return; }
    const result = await exportProjectFile(meta.id);
    if (!result.ok) { showToast(`Export failed: ${result.reason}`); return; }
    const blob = new Blob([result.content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`Project saved to ${result.fileName}`);
  }, []);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const handleImportProjectFile = useCallback(async (file: File) => {
    // [B19-D I5e row 12] the size bound comes before the file is read; the import itself never rejects
    const read = await readProjectFile(file);
    if (!read.ok) { showToast(`Open project failed: ${read.reason}`); return; }
    const result = await importProjectFile(read.content);
    if (!result.ok) { showToast(`Open project failed: ${result.reason}`); return; }
    // B12.4 §E — the imported record/checkpoints are persisted; activation
    // (the pointer) belongs to the winning install.
    // [B17-E] the import creates CANONICAL state after structural + integrity validation; the announcement reports the outcome in full.
    const missing = result.missingParts.length > 0 ? ` · ${result.missingParts.length} catalog part(s) missing: ${result.missingParts.slice(0, 3).join(", ")}${result.missingParts.length > 3 ? ", …" : ""}` : "";
    const copy = result.importedAsCopy ? " · imported as a copy (a project with this id already existed)" : "";
    hydrateProject(result.project, { announce: `Opened "${result.project.name}" from file (${result.checkpointsImported} checkpoint(s) restored${copy}${missing}${result.warnings.length > 0 ? ` · ${result.warnings.length} warning(s)` : ""})` });
    for (const warning of result.warnings) showToast(warning);
    setProjectList(listProjects());
  }, [hydrateProject]);

  const handleRenameProject = useCallback(() => {
    const meta = projectRef.current;
    if (!meta) return;
    const name = window.prompt("Project name", meta.name)?.trim();
    if (!name || name === meta.name) return;
    const renamed = renameProject(meta.id, name);
    if (!renamed) { showToast("Rename failed: the project record could not be updated."); return; }
    setProject({ id: meta.id, name });
    setProjectList(listProjects());
  }, []);

  function selectAiBrain(provider: LLMProviderId) {
    saveAiBrainPreference(provider);
    aiBrainRef.current = provider;
    setAiBrain(provider);
    setAiProviderFailure(null);
  }

  // Panel resize
  const dragging   = useRef<"left" | "right" | null>(null);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      if (dragging.current === "right") {
        const delta = dragStartX.current - e.clientX;
        setChatWidth(Math.min(700, Math.max(240, dragStartW.current + delta)));
      } else {
        const delta = e.clientX - dragStartX.current;
        setLeftPanelWidth(Math.min(500, Math.max(180, dragStartW.current + delta)));
      }
    }
    function onMouseUp() {
      dragging.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, []);

  function startDrag(side: "left" | "right", e: React.MouseEvent) {
    dragging.current   = side;
    dragStartX.current = e.clientX;
    dragStartW.current = side === "right" ? chatWidth : leftPanelWidth;
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  // Global keyboard shortcuts — driven by the centralized binding map
  useEffect(() => {
    const PLACEMENT_TOOLS = new Set<string>([
      "resistor", "capacitor", "inductor", "diode",
      "voltage-source", "current-source", "ground",
    ]);

    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      if (active && (
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable
      )) return;

      const prefix = (e.ctrlKey || e.metaKey) ? "ctrl+" : "";
      const keyStr = prefix + e.key.toLowerCase();

      const binding = getKeyBindings()[keyStr];
      if (!binding) {
        // Junction/label tool shortcuts — handled here rather than in the
        // central binding map so users' custom keybinding files keep working
        // unchanged.
        if (keyStr === "j") {
          e.preventDefault();
          setTool("junction");
          setWireDraftStart(null);
        } else if (keyStr === "t") {
          e.preventDefault();
          setTool("label");
          setWireDraftStart(null);
          setPendingNetLabel(null);
        }
        return;
      }
      e.preventDefault();

      if (binding.action === "set-tool") {
        setTool(binding.tool as Tool);
        setWireDraftStart(null);
      } else if (binding.action === "rotate") {
        // B06: rotation is a canonical schematic.move-rotate command.
        if (selectedId && tool === "select") {
          rotateComponentCanonical("theory", selectedId, "Rotated component");
        } else if (selectedKicadId && tool === "select") {
          rotateComponentCanonical("kicad", selectedKicadId, `Rotated ${liveStateRef.current.kicadComponents.find((k) => k.id === selectedKicadId)?.refDes ?? "component"}`);
        } else if (PLACEMENT_TOOLS.has(tool) || tool === "kicad-place") {
          setPlacementRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270);
        }
      } else if (binding.action === "delete-selection") {
        // B06: deletion is a canonical schematic.delete-component command with
        // a deterministic impact plan (incident wires + labels removed).
        if (selectedId) {
          void deleteComponentCanonical("theory", selectedId);
        } else if (selectedKicadId) {
          void deleteComponentCanonical("kicad", selectedKicadId);
        }
      } else if (binding.action === "exit-tool-or-end-wire") {
        if (wireDraftStart !== null) {
          setWireDraftStart(null);
        } else if (tool !== "select") {
          setTool("select");
          setWireDraftStart(null);
          setPlacementPartId(null);
          setPendingNetLabel(null);
        } else {
          setSelectedId(null);
          setSelectedKicadId(null);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tool, wireDraftStart, selectedId, selectedKicadId, rotateComponentCanonical, deleteComponentCanonical]);

  // Sim-view keyboard shortcuts + reset to probe on enter
  useEffect(() => {
    if (view !== "sim") return;
    setSimMode("probe");
    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      if (e.key === "Escape" || e.key.toLowerCase() === "p") { setSimMode("probe"); e.preventDefault(); }
      else if (e.key.toLowerCase() === "m") { setSimMode("move"); e.preventDefault(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

  function addComponent(type: SchComponentType) {
    setTool(type);
  }

  function toggleLeftPanel(panel: "projects" | "library") {
    setLeftPanel((prev) => (prev === panel ? null : panel));
  }

  function startActivityLog(title: string, firstStep: string, userPrompt?: string): string {
    const id = crypto.randomUUID();
    const entries: ActivityLogEntry[] = [{ id: crypto.randomUUID(), text: firstStep, status: "running" }];
    setMessages((prev) => [
      ...prev,
      ...(userPrompt ? [{ id: crypto.randomUUID(), role: "user" as const, content: userPrompt }] : []),
      { id, role: "log", title, status: "running", entries },
    ]);
    return id;
  }

  function appendActivityStep(logId: string, text: string, status: ActivityLogEntry["status"] = "running") {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.role !== "log" || message.id !== logId) return message;
        return {
          ...message,
          status: status === "error" ? "error" : "running",
          entries: [
            ...message.entries.map((entry) =>
              entry.status === "running" ? { ...entry, status: "done" as const } : entry,
            ),
            { id: crypto.randomUUID(), text, status },
          ],
        };
      }),
    );
  }

  function finishActivityLog(logId: string, text?: string) {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.role !== "log" || message.id !== logId) return message;
        const entries = message.entries.map((entry) =>
          entry.status === "running" ? { ...entry, status: "done" as const } : entry,
        );
        return {
          ...message,
          status: "done",
          entries: text ? [...entries, { id: crypto.randomUUID(), text, status: "done" as const }] : entries,
        };
      }),
    );
  }

  function failActivityLog(logId: string, text: string) {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.role !== "log" || message.id !== logId) return message;
        const entries = message.entries.map((entry) =>
          entry.status === "running" ? { ...entry, status: "error" as const } : entry,
        );
        return {
          ...message,
          status: "error",
          entries: [...entries, { id: crypto.randomUUID(), text, status: "error" as const }],
        };
      }),
    );
  }

  /** B07.3 — append chat content only while the given project is still the
   *  active one: a late asynchronous result must never write into another
   *  project's transcript. (The activity-log update helpers above are
   *  inherently safe — they map by log id, which no longer exists after a
   *  project switch replaces the message list.) */
  function appendChatFor(projectId: string | null, build: (prev: typeof messages) => typeof messages) {
    if (projectId !== null && projectRef.current?.id !== projectId) return;
    setMessages(build);
  }

  // [B18-D I6] one chat execution entry per grant (display only). Kept by grant id so the preview outcome, the explicit
  // settlement and recovery update the same entry; persisted through the existing chat log shape (a reloaded entry is a
  // static record).
  const upsertExecutionEntry = useCallback((entry: ExecutionEntry, insertBeforeId?: string) => {
    executionEntriesRef.current.set(entry.grantId, entry);
    setExecutionEntries((prev) => new Map(prev).set(entry.grantId, entry));
    const message = entryToLogMessage(entry);
    setMessages((prev) => {
      if (prev.some((existing) => existing.id === message.id)) return prev.map((existing) => (existing.id === message.id ? message : existing));
      const at = insertBeforeId ? prev.findIndex((existing) => existing.id === insertBeforeId) : -1;
      return at >= 0 ? [...prev.slice(0, at), message, ...prev.slice(at)] : [...prev, message];
    });
  }, []);

  // [B18-D I9] Stop (chat-execution-ux.md §8 I9): send() registers its run here; Stop cancels the response reader and
  // carries nothing — the route aborts the run, and the loop retires its still-issued explicit grants. An AI change the
  // editor had already started still finishes and is reported in its entry.
  const activeChatRunRef = useRef<{ requestId: string; reader: ReadableStreamDefaultReader<Uint8Array> | null; stopped: boolean } | null>(null);
  const stopChatRun = useCallback(() => {
    const run = activeChatRunRef.current;
    if (!run || run.stopped) return;
    run.stopped = true;
    if (run.reader) void run.reader.cancel().catch(() => undefined);
  }, []);
  // [B18-D I8] "Undo this change" on a committed entry (chat-execution-ux.md §1 item 10): available only for a change
  // still undoable and still the timeline's newest operation, with no AI change in flight. The click carries only the
  // entry's grant id; the page looks up its transaction, the timeline undoes exactly that transaction (NOT_LATEST
  // otherwise) with the PCB store's own Undo, and the result — or the refusal, verbatim — is written into the entry.
  const executionUndoStates = useMemo(() => {
    const newest = projectTimelineEntries[projectTimelineEntries.length - 1];
    const inFlight = [...executionEntries.values()].some((entry) => entry.state === "issued" || entry.state === "executing");
    const states = new Map<string, NonNullable<ReturnType<typeof entryUndoAvailability>>>();
    for (const entry of executionEntries.values()) {
      const availability = entryUndoAvailability(entry, newest, inFlight, projectTimelineEntries); // [B18-D review 2] the timeline, for the one-shot reason
      if (availability) states.set(entry.grantId, availability);
    }
    return states;
  }, [executionEntries, projectTimelineEntries]);
  async function undoAiChange(grantId: string) {
    const entry = executionEntriesRef.current.get(grantId);
    if (!entry?.transaction) return;
    const decision = await projectTimeline.undoLatest({ expectTransactionId: entry.transaction.id });
    const current = executionEntriesRef.current.get(grantId) ?? entry;
    if (decision.ok) {
      upsertExecutionEntry(entryUndoResult(current, { ok: true, afterSeq: decision.operation.seq }));
      showToast(`Undid: ${decision.operation.label}`);
    } else {
      upsertExecutionEntry(entryUndoResult(current, { ok: false, message: decision.message }));
      setProjectTimelineNotice(`${decision.code} — ${decision.message}`);
    }
  }

  async function send(retryText?: string) {
    const text = (retryText ?? input).trim();
    if (!text || loading) return;

    // B07.4 — the chat request is project-scoped: collision-resistant UUID
    // message ids, an abortable fetch, stream chunks/errors gated on the
    // captured scope, and request-owned busy state.
    const scope = projectScopeRegistryRef.current!.capture();
    const runProvider = aiBrainRef.current; // the run's provider, pinned at submission
    const userMsg: ChatMessage  = { id: crypto.randomUUID(), role: "user", content: text };
    const logId                 = crypto.randomUUID();
    const logMsg: ActivityLogMessage = {
      id: logId,
      role: "log",
      title: "Working",
      status: "running",
      entries: [{ id: crypto.randomUUID(), text: "Submitting message", status: "running" }],
    };
    const assistantId           = crypto.randomUUID();
    const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", content: "" };

    setMessages((prev) => [...prev, userMsg, logMsg, assistantMsg]);
    setInput("");
    activeChatRef.current = scope.requestId;
    setLoading(true);
    const chatRun: { requestId: string; reader: ReadableStreamDefaultReader<Uint8Array> | null; stopped: boolean } = { requestId: scope.requestId, reader: null, stopped: false }; // [B18-D I9]
    activeChatRunRef.current = chatRun;
    setAiProviderFailure(null);
    lastAiRetryRef.current = () => void send(text);

    try {
      appendActivityStep(logId, "Calling assistant");
      const apiMessages = chatHistoryForModel([...messages, userMsg]); // [B19-D I5e row 32] advisory output is not replayed
      // B07.3 — chat context is ONE immutable authoritative snapshot (never
      // the visible arrays, which may be showing a gesture preview), and it
      // is validated before it leaves the client: an invalid projection
      // (pending recovery) is simply omitted rather than presented as a
      // trustworthy schematic. schematicState is optional server-side.
      const chatSnapshot = currentSchematicState();
      const chatSnapshotValid = validateSchematicStateIntegrity(chatSnapshot).length === 0;
      // B10 — ONE atomic immutable editor-context snapshot captured for the
      // SAME project/branch generation as this request's scope: the exact
      // PcbEditor working copy (unsaved edits included), live selection,
      // and live netlist. null (unavailable) when no current-generation
      // publisher matches — the run then simply has no PCB resources.
      const chatEditorContext = editorContextBridgeRef.current!.capture({
        tenantId: "local",
        projectId: scope.projectId ?? projectRef.current?.id ?? "local",
        branchId: scope.branchId ?? "main",
      });
      // [B17-F] ONE bounded view-context snapshot (which editor surfaces exist, each view session's revision and
      // state, the project operation timeline). The server validates it exactly; it is never authority.
      const chatViewContext = viewSessionBridgeRef.current!.capture(projectTimeline);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiBrainRef.current,
          messages: apiMessages,
          // B09 — project identity for the run context: identifiers ONLY.
          // Actor/role/capabilities are minted server-side (LOCAL_ONLY
          // factory); nothing in this body carries authority claims.
          scope: {
            tenantId: "local",
            projectId: projectScopeRegistryRef.current?.current.projectId ?? "local",
            branchId: projectScopeRegistryRef.current?.current.branchId ?? "local",
          },
          ...(chatSnapshotValid ? { schematicState: { ...chatSnapshot, pageSize: chatSnapshot.pageSize ?? pageSize } } : {}),
          // B10 — the versioned atomic editor context (schema
          // sirkit.editor-context.v1). The server revalidates the board and
          // recomputes every revision/digest; nothing here is authority.
          ...(chatEditorContext ? { editorContext: chatEditorContext } : {}),
          // [B17-F] the view context (schema sirkit.view-context.v1) — surfaces, view revisions, timeline.
          ...(chatViewContext ? { viewContext: chatViewContext } : {}),
          // B09.1 — the ready session's head mark is a scope LABEL for
          // proposal sealing (verified at apply against the CURRENT
          // session); absent ⇒ the proposal tool is unavailable server-side.
          ...(schematicSessionRef.current?.headMark() ? { schematicHeadMark: schematicSessionRef.current.headMark() } : {}),
        }),
        signal: scope.signal,
      });
      if (!res.ok) await throwAiResponseError(res, lastAiRetryRef.current ?? undefined, { isCurrent: () => scope.isCurrent() });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      chatRun.reader = reader; // [B18-D I9] Stop cancels this reader (a Stop pressed before the response arrived cancels it now)
      if (chatRun.stopped) void reader.cancel().catch(() => undefined);
      const dec    = new TextDecoder();
      appendActivityStep(logId, "Streaming response");
      // B09 — versioned NDJSON agent-event protocol: every event is applied
      // ONLY while the capturing project generation is current; late chunks
      // (text, tool status, proposals, failures) write nothing into a
      // replacement project. Raw provider bodies never reach this client —
      // the route emits only the typed event protocol.
      let ndjsonBuffer = "";
      let runFailure: { reason: string; message: string } | null = null;
      // [B18-D I6] the page half of Rule 2: every event folds into the run view; the answer bubble shows ONLY the final text
      // (labelled while a change the run started is unresolved); interim text is released as notes when the run ends.
      let runView = initialRunView();
      const boardForRefs = chatEditorContext?.board ?? null;
      const refOf = (objectId: string): string | null => boardForRefs?.footprints.find((footprint) => footprint.id === objectId)?.ref ?? null;
      const applyAgentEvent = (event: Record<string, unknown>): void => {
        if (!scope.isCurrent()) return;
        runView = reduceRunView(runView, event);
        switch (event.type) {
          case "text_delta": {
            const answer = projectRunView(runView).answer;
            setMessages((prev) => prev.map((m) => (m.role === "assistant" && m.id === assistantId ? { ...m, content: answer } : m)));
            return;
          }
          case "tool_started": {
            const tag = typeof event.tier === "number" ? `T${event.tier} · ` : "";
            appendActivityStep(logId, `Running Sirkit tool: ${tag}${typeof event.title === "string" ? event.title : "tool"}`);
            return;
          }
          case "tool_finished": {
            appendActivityStep(logId, toolLineLabel(event), event.ok === true ? "done" : "error");
            return;
          }
          case "tool_refused": {
            appendActivityStep(logId, refusedLineLabel(event), "error"); // [B18-D I10] refused before running — nothing ran
            return;
          }
          case "proposal_ready": {
            // The sealed proposal enters the EXISTING exact-proposal review
            // boundary; apply re-verifies identity/operations/base digests
            // and expiry, so a stale or altered artifact can never execute.
            const proposal = event.proposal as SealedTier1Proposal | SealedReplacementProposal | undefined;
            // [B14/B14.1] discriminated union: a sealed REPLACEMENT proposal
            // enters its own review boundary through the PRODUCTION consumer
            // (the same module the integration test drives); receiving it
            // mutates nothing.
            const replacement = receiveReplacementProposalEvent(event);
            if (replacement) {
              setPendingReplacement(replacement.proposal);
              setPendingReplacementRunId(replacement.runId);
              approvedMutationAudit.record({ at: Date.now(), proposalId: replacement.proposal.proposalId, originRunId: replacement.runId, event: "approval-displayed", code: null });
              // [B18-E E15] the page's own sentence: the target, where it came from (the recorded authority — never the
              // model's choice), and what happens to the connections. Nothing has been changed at this point.
              appendActivityStep(logId, replacementChatLines.ready({
                partId: replacement.proposal.target.partId,
                manufacturer: replacement.proposal.target.manufacturer,
                preservedConnections: replacement.proposal.impact.preservedConnections.length,
                droppedConnections: replacement.proposal.impact.droppedConnections.length,
              }), "done");
              return;
            }
            if (proposal && proposal.schema === TIER1_PROPOSAL_SCHEMA && Array.isArray(proposal.operations)) {
              setPendingTier1(proposal);
              // B12: the originating run id is audit metadata only (never
              // authority); the sealed scope/head/digest fields remain the
              // sole basis for apply-time verification.
              setPendingTier1RunId(typeof event.runId === "string" ? event.runId : null);
              approvedMutationAudit.record({ at: Date.now(), proposalId: proposal.proposalId, originRunId: typeof event.runId === "string" ? event.runId : null, event: "approval-displayed", code: null });
              appendActivityStep(logId, `Proposal ready — ${proposal.operations.length} operation(s) awaiting your explicit review`, "done");
            }
            return;
          }
          case "pcb_proposal_ready": {
            // [B15.3] the DISTINCT PCB proposal event. The PRODUCTION safe
            // discriminator narrows + structurally verifies; a fabricated or
            // malformed event is dropped. Receiving/displaying mutates
            // NOTHING — the review + one-shot approval live inside PcbEditor.
            const pcbProposal = receivePcbProposalReadyEvent(event);
            if (pcbProposal) {
              setPendingPcbProposal({ proposal: pcbProposal.proposal, originRunId: pcbProposal.runId });
              appendActivityStep(logId, `PCB proposal ready — ${pcbProposal.proposal.operations.length} bounded operation(s) awaiting your explicit review in the PCB editor`, "done");
            }
            return;
          }
          case "view_command_ready": {
            // [B17-F] a server-VALIDATED view command for the user's own view bus. The bridge re-checks the
            // request shape, expiry, the live surface and the session id; the bus applies its stale-revision
            // rule and role gate. It changes what the editor SHOWS, never the design.
            const bridge = viewSessionBridgeRef.current!;
            void bridge.execute(event.request).then((execution) => {
              if (!scope.isCurrent()) return;
              if (execution.ok) appendActivityStep(logId, `View updated — ${execution.commandId}${execution.rebased ? " (rebased onto your newer view)" : ""}`, "done");
              else appendActivityStep(logId, `View command ${execution.commandId ?? ""} not applied — ${execution.message}`, "error");
            });
            return;
          }
          case "layout_candidate_ready": {
            // [B17-F] the agent's placement / routing candidate — the SAFE receiver verifies the artifact; the
            // PCB editor registers it in its own store after re-verifying the base revision. Nothing is applied.
            const received = receiveLayoutCandidateEvent(event);
            if (received) {
              setPendingLayoutCandidate({ candidate: received.candidate, originRunId: received.runId });
              // [B18-E E17] the page's own sentence names what the candidate measured and, for routing, what could not be
              // routed — "show me anything that failed" is the last clause of the request, and it is answered here rather
              // than left to the model's prose or to the panel the person may not open.
              appendActivityStep(logId, layoutCandidateChatLine(received.candidate), "done");
            }
            return;
          }
          case "execution_grant_ready": {
            // [B18-B] a server-minted execution grant — the SAFE receiver re-parses it and checks its coherence; the PCB
            // editor (the composition root) runs the granted-execution ritual: preview grants wait for the human's Confirm,
            // explicit grants execute once and settle back to the server. Receiving it changes nothing.
            const received = receiveExecutionGrantReadyEvent(event);
            if (!received) {
              // [B18-D review] the SAFE receiver dropped the grant (altered in transit, incoherent or not issued). The tool line
              // came first and said it was issued: rewrite it, and say what happened. [B18-D review 2] the run view stops
              // counting it as a change in progress: there is no entry, so the answer's label says the page dropped it.
              runView = runViewGrantDropped(runView);
              setMessages((prev) => prev.map((m) => (m.role === "log" && m.id === logId ? { ...m, entries: markGrantLineDropped(m.entries) } : m)));
              appendActivityStep(logId, "An AI change the assistant issued was dropped by this page: it failed the integrity checks. Nothing was changed and there is no card.", "error");
            }
            if (received) {
              runView = runViewGrantReceived(runView); // [B18-D review 2] an entry exists for it
              setPendingExecutionGrant({ grant: received.grant, decision: received.decision, note: received.note, originRunId: received.runId });
              // [B18-D review] one card at a time: an earlier preview still awaiting confirmation was replaced by this grant (its card
              // is gone), so its entry says so instead of inviting a confirmation that no longer exists.
              for (const earlier of [...executionEntriesRef.current.values()]) {
                if (earlier.grantId !== received.grant.grantId && earlier.state === "awaiting_confirmation") upsertExecutionEntry(entrySuperseded(earlier));
              }
              // [B18-D I6] ONE execution entry per grant (just before this run's answer) carries the state, the tier, what was
              // asked and understood, the targets, the operations and why a confirmation is (not) required; the run log points to it.
              upsertExecutionEntry(entryFromGrant({ grant: received.grant, decision: received.decision, note: received.note }, refOf), assistantId);
              if (received.decision === "execute_explicit") appendActivityStep(logId, "AI change issued — your editor executes it now; its entry below follows it", "running");
              else appendActivityStep(logId, "AI change prepared — confirm or cancel it on the card; its entry below follows it", "done");
            }
            return;
          }
          case "execution_settled": {
            // [B18-B] what the run learned from the DURABLE record (display only — never a claim of its own).
            const settled = receiveExecutionSettledEvent(event);
            if (settled) {
              // [B18-D I6] the durable settlement updates the grant's entry (its state row says what happened); the log points to it.
              const committed = settled.status === "settled" && settled.outcome === "committed";
              const entry = executionEntriesRef.current.get(settled.grantId);
              if (entry) upsertExecutionEntry(entrySettled(entry, settled));
              // [B18-D review 2] "see its entry" only when there is one: a grant this page dropped has none, and was never executed here
              const line = entry
                ? (committed ? "AI change settled — see its entry" : "AI change not completed — see its entry")
                : (committed ? "AI change settled on the server — this page has no entry for it" : "AI change not completed — this page has no entry for it and never executed it; nothing was changed here");
              appendActivityStep(logId, line, committed ? "done" : "error");
            }
            return;
          }
          case "warning": {
            if (typeof event.message === "string") appendActivityStep(logId, event.message, "done");
            return;
          }
          case "run_failed": {
            runFailure = {
              reason: typeof event.reason === "string" ? event.reason : "unknown",
              message: typeof event.message === "string" ? event.message : "The assistant run failed.",
            };
            return;
          }
          default:
            return; // run_started / run_completed need no extra UI writes
        }
      };
      while (true) {
        // [B18-D review 2] a dropped connection errors the body stream (read() rejects) instead of ending it: it is handled
        // below exactly like a stream cut before its terminal event — the answer stays, the notes are released and the entry
        // is named. Stop (a cancelled reader ends the stream) and a project switch (an abort) keep their own paths.
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (readError) {
          if (isAbortError(readError) || chatRun.stopped || !scope.isCurrent()) throw readError;
          break;
        }
        const { done, value } = chunk;
        if (done) break;
        if (!scope.isCurrent()) {
          // Project changed mid-stream: stop consuming; write nothing more
          // (the id-keyed map below is already a no-op after hydration
          // replaced the message list — this stops the network work too).
          try { await reader.cancel(); } catch { /* already closed */ }
          break;
        }
        ndjsonBuffer += dec.decode(value, { stream: true });
        for (let newline = ndjsonBuffer.indexOf("\n"); newline >= 0; newline = ndjsonBuffer.indexOf("\n")) {
          const line = ndjsonBuffer.slice(0, newline).trim();
          ndjsonBuffer = ndjsonBuffer.slice(newline + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            applyAgentEvent(event);
          } catch { /* malformed line: skipped, never rendered raw */ }
        }
      }
      // [B18-D review] a run stopped before it ended: close its view so its interim notes are still released as notes.
      const stoppedEarly = chatRun.stopped && runView.terminal === null;
      if (stoppedEarly) runView = reduceRunView(runView, { type: "run_failed", reason: "stopped", message: "Stopped by you." });
      // [B18-D review] a stream that ended without its terminal event (a dropped connection, not Stop) is a failure: its notes
      // are released and the failure stays visible — never a green log.
      if (!chatRun.stopped && runView.terminal === null && scope.isCurrent()) {
        const cut = "The connection ended before the assistant finished. An AI change already sent to your editor is reported in its entry: made, or not made.";
        runView = reduceRunView(runView, { type: "run_failed", reason: "stream_cut", message: cut });
        runFailure = { reason: "stream_cut", message: cut };
      }
      // [B18-D I6] the run's interim notes are released only now, after the run ended — never in the answer.
      if (scope.isCurrent()) {
        const projected = projectRunView(runView);
        for (const note of projected.notes) appendActivityStep(logId, note, "done");
        if (projected.answer) setMessages((prev) => prev.map((m) => (m.role === "assistant" && m.id === assistantId ? { ...m, content: projected.answer } : m)));
      }
      // [B18-D I9, review] a run stopped before it ended says so (a Stop pressed after the run had already ended claims nothing).
      // An AI change already sent to the editor is reported in its entry either way — made, or not made: a grant not yet consumed
      // is retired run_cancelled, so "it still finishes" would not be true.
      if (stoppedEarly && scope.isCurrent()) {
        const stopped = "Stopped. An AI change already sent to your editor is reported in its entry: made, or not made.";
        appendActivityStep(logId, "Stopped by you — the assistant's run was cancelled.", "done");
        setMessages((prev) => prev.map((m) => (m.role === "assistant" && m.id === assistantId ? { ...m, content: m.content ? `${m.content}\n\n${stopped}` : stopped } : m)));
      }
      if (runFailure !== null && scope.isCurrent()) {
        const failure = runFailure as { reason: string; message: string };
        failActivityLog(logId, failure.message);
        setMessages((prev) => prev.map((m) => (m.role === "assistant" && m.id === assistantId && m.content === ""
          ? { ...m, content: failure.reason.startsWith("provider_") ? `${failure.message} Choose an action below.` : failure.message }
          : m)));
        // B09.2 — the settlement is PRODUCTION-owned (run-consumer.ts):
        // recoverable provider_* failures on the CURRENT generation dispatch
        // the owned Retry / Use-other-provider event; retry starts a NEW
        // send() run (fresh scope + fresh AbortController); stale/cancelled/
        // deadline runs recover nothing.
        settleAgentRunFailure({
          reason: failure.reason,
          provider: runProvider,
          ownership: { isCurrent: () => scope.isCurrent() },
          startNewRun: () => void send(text),
        });
      }
    } catch (err) {
      if (isAbortError(err) || !scope.isCurrent()) {
        // Cancellation (project switch/unmount) — not a provider failure;
        // no error text is written into the now-active project.
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && m.id === assistantId
            ? {
                ...m,
                content:
                  err instanceof AiProviderUnavailableError
                    ? `${err.message} Choose an action below.`
                    : "Error — please try again.",
              }
            : m
        )
      );
      failActivityLog(logId, err instanceof Error ? err.message : "Chat request failed");
      console.error(err);
    } finally {
      setMessages((prev) => {
        const log = prev.find((message) => message.role === "log" && message.id === logId);
        if (log?.role === "log" && log.status === "error") return prev;
        return prev.map((message) => {
          if (message.role !== "log" || message.id !== logId) return message;
          return {
            ...message,
            status: "done",
            entries: message.entries.map((entry) =>
              entry.status === "running" ? { ...entry, status: "done" as const } : entry,
            ),
          };
        });
      });
      if (activeChatRunRef.current === chatRun) activeChatRunRef.current = null; // [B18-D I9]
      // Only THIS request may clear the busy flag it set.
      if (activeChatRef.current === scope.requestId) {
        activeChatRef.current = null;
        setLoading(false);
      }
    }
  }

  // B07.4 — ONE project async-scope registry for the page's lifetime.
  // hydrateProject begins a new project GENERATION (aborting the previous
  // generation's fetches and canceling its timers); handlers capture scopes
  // at invocation and check them after every await.
  const projectScopeRegistryRef = useRef<ProjectAsyncScopeRegistry | null>(null);
  if (projectScopeRegistryRef.current === null) projectScopeRegistryRef.current = new ProjectAsyncScopeRegistry();
  // [B16-C.5] mount re-arms (StrictMode runs this cleanup once and mounts again), unmount disposes.
  useEffect(() => { projectScopeRegistryRef.current?.resume(); return () => projectScopeRegistryRef.current?.dispose(); }, []);

  // B10 — ONE page-owned editor-context bridge: PcbEditor publishes the
  // exact working-copy read source into it; send() captures one atomic
  // immutable snapshot per chat request. Its generation advances with
  // every project hydration (see hydrateProject) and it is invalidated on
  // page teardown.
  const editorContextBridgeRef = useRef<EditorContextBridge | null>(null);
  if (editorContextBridgeRef.current === null) editorContextBridgeRef.current = new EditorContextBridge();
  // [B10.1] no unmount-invalidate effect: under React Strict Mode the
  // setup→cleanup→setup replay would run that cleanup while the page keeps
  // living, and nothing outside hydration re-establishes the generation.
  // The bridge is owned by this ref alone — at REAL unmount its owner
  // becomes unreachable, so the teardown was redundant; publisher-side
  // liveness (effect-local + lifecycle scope) already retires publications.

  /** B07.3/B07.4 — immutable invocation context captured BEFORE any
   *  asynchronous schematic-producing request (generation, topology edit,
   *  tidy). The response may only apply against this exact project, session
   *  GENERATION, and authoritative base — anything else is truthfully
   *  surfaced as stale. */
  const captureLifecycleInvocationContext = useCallback(() => {
    const baseDigest = schematicStateDigest(gestureCoordinatorRef.current!.authoritativeState());
    return {
      projectId: projectRef.current?.id ?? null,
      session: schematicSessionRef.current,
      baseDigest,
      scope: projectScopeRegistryRef.current!.capture({ baseDigest }),
    };
  }, []);

  /** B07.5 (failure F) — project-generation ownership for AI requests made
   *  by mounted editor COMPONENTS (SpiceStudio, PCB AssistBox, net-class):
   *  each request captures a scope at submission, so its provider-failure
   *  dispatch and retry callback die with the owning project generation
   *  even though the component itself may stay mounted across a switch. */
  const captureAiRequestOwnership = useCallback((): AiRequestOwnership => {
    const scope = projectScopeRegistryRef.current!.capture();
    return { isCurrent: () => scope.isCurrent() };
  }, []);

  /**
   * B07.3 — TRANSACTIONAL machine-schematic application through the
   * lifecycle gateway: validate → canonical adoption (quarantine-first, on
   * the CAPTURED session) → and only then projection/history/chat/
   * checkpoint/page-size/auto-run. On any failure or stale token the prior
   * projection, mirror, history, chat, and persistence stay unchanged, and
   * the structured reason is surfaced. Returns true only when adopted.
   */
  async function applySchematic(
    state: SchematicState,
    explanation: string,
    prompt: string,
    opts?: {
      skipAutoRun?: boolean;
      promptAlreadyLogged?: boolean;
      suppressChat?: boolean;
      /** Exact-base invocation pin (captured before the producing request). */
      pin?: { projectId: string | null; session: SchematicEditorSession | null; baseDigest: string; scope: ProjectAsyncScope };
    },
  ): Promise<boolean> {
    // B07.4 — the scope of record: the invocation pin's when present, else a
    // fresh capture for this explicit user action.
    const scope = opts?.pin?.scope ?? projectScopeRegistryRef.current!.capture();
    const session = opts?.pin ? opts.pin.session : schematicSessionRef.current;
    const label = opts?.skipAutoRun ? "Applied AI edit" : `Generated schematic: ${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}`;
    const appliedState: SchematicState = {
      components: state.components, wires: state.wires,
      kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [],
      ...(state.pageSize ? { pageSize: state.pageSize } : { ...(liveStateRef.current.pageSize ? { pageSize: liveStateRef.current.pageSize } : {}) }),
    };
    const applyForProject = opts?.pin ? opts.pin.projectId : (projectRef.current?.id ?? null);
    const outcome = await gestureCoordinator.adoptLifecycle({
      state: appliedState,
      reason: "AI-generated schematic applied",
      ...(opts?.pin ? { expectedBaseDigest: opts.pin.baseDigest } : {}),
      // Project id AND session generation must both be current (the same
      // project can be rehydrated into a new session).
      stillCurrent: () => scope.isCurrent() && (applyForProject === null || projectRef.current?.id === applyForProject),
      adopt: (candidate) => session
        ? session.adoptLifecycleProjection(candidate, "AI-generated schematic applied")
        : Promise.resolve({ ok: false as const, code: "no-service" as const, detail: "Schematic session unavailable — reload the project." }),
      applyUi: (candidate) => applyCanonicalSchematicProjection(label, candidate),
      onAdopted: () => {
        // Machine-generated layout → safe to auto-tidy, then auto-review.
        // Tidy's own apply passes skipAutoRun so the pipeline can't loop.
        if (!opts?.skipAutoRun) {
          autoRunIncludesTidy.current = (state.kicadComponents?.length ?? 0) > 0;
          setAutoRunToken((t) => t + 1);
        }
        if (state.pageSize) setPageSize(state.pageSize);
        setSelectedId(null);
        setSelectedKicadId(null);
        setWireDraftStart(null);
        setTool("select");
        const appendedMessages = opts?.suppressChat ? [] : [
          ...(opts?.promptAlreadyLogged ? [] : [{ id: crypto.randomUUID(), role: "user" as const, content: prompt }]),
          { id: crypto.randomUUID(), role: "assistant" as const, content: explanation, advisory: true },
        ];
        if (appendedMessages.length > 0) setMessages((prev) => [...prev, ...appendedMessages]);
        // B07.4 (failure C) — the generation checkpoint is written
        // IMMEDIATELY from the exact adopted candidate and the CAPTURED
        // project: no ambient delayed effect, no re-read of projectRef or
        // authoritative state after a delay, and a failure is reported only
        // while the owning project is still active. A checkpoint failure
        // never rolls back the already-successful adoption.
        //
        // B07.5 — checkpoint READINESS is re-evaluated immediately before
        // the write, on the CAPTURED session (never an ambient ref):
        // adoption just succeeded on that session, but defense in depth
        // requires the canonical session to still be ready, no recovery to
        // be pending, and the owning scope to still be current. If any of
        // those no longer hold, the checkpoint is silently not written —
        // the adoption itself stands.
        if (!opts?.skipAutoRun && applyForProject !== null) {
          const checkpointGate = evaluateSchematicConsumerGate({
            lifecycle: session?.lifecycle ?? null,
            recoveryPending: schematicRecoveryRef.current !== null,
            consumer: "checkpoint",
          });
          if (checkpointGate.allowed && scope.isCurrent()) {
            const checkpointProject = applyForProject;
            const checkpointChat = toStoredChat([...liveStateRef.current.messages, ...appendedMessages]);
            void checkpointStore().add({
              projectId: checkpointProject,
              label,
              at: Date.now(),
              schematic: structuredClone(appliedState),
              chat: checkpointChat,
              workflowView: liveStateRef.current.view,
            }).then(() => {
              scope.ifCurrent(() => refreshCheckpoints());
            }).catch((error: unknown) => {
              scope.ifCurrent(() => showToast(`Checkpoint could not be saved: ${error instanceof Error ? error.message : String(error)}`));
            });
          }
        }
      },
    });
    if (outcome.status === "adopted") return true;
    if (outcome.status !== "canceled-stale-project") {
      const detail = "detail" in outcome ? outcome.detail : "The project changed while the result was being prepared.";
      const errorScope = opts?.pin?.scope ?? projectScopeRegistryRef.current!.capture();
      errorScope.ifCurrent(() => {
        setGenError(detail);
        errorScope.setTimeout(() => setGenError(null), 8000);
      });
    }
    return false;
  }

  /** B07.4 — project-scoped transient error: written and auto-cleared only
   *  while the owning scope is current; never appears in another project. */
  const setScopedGenError = useCallback((scope: ProjectAsyncScope, message: string, ms = 6000) => {
    scope.ifCurrent(() => {
      setGenError(message);
      scope.setTimeout(() => setGenError(null), ms);
    });
  }, []);

  /** An aborted fetch is a CANCELLATION (project switch/unmount), never a
   *  provider failure. */
  const isAbortError = (error: unknown): boolean =>
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError");

  async function handleGenerateSchematic(prompt: string) {
    if (!prompt.trim() || isGenerating) return;
    // B07.3 — generation cannot bypass a conflicted/invalid/loading session,
    // and the result is pinned to the exact project + authoritative base
    // captured NOW: an intervening edit or project switch makes it stale.
    const entryGate = schematicConsumerGate("edit");
    if (!entryGate.allowed) {
      setScopedGenError(projectScopeRegistryRef.current!.capture(), entryGate.reason);
      return;
    }
    const pin = captureLifecycleInvocationContext();
    const scope = pin.scope;
    const logId = startActivityLog("Generating schematic", "Preparing request", prompt);
    setLastDesignPrompt(prompt); // remembered for the SchGen cross-verify second opinion
    setPendingSuggestions(null); // any prior suggestions are now stale
    setSuggestionsMinimized(false);
    // B07.4 — request-owned busy state: only THIS request's finally may
    // clear it, and errors/retries are scope-guarded.
    activeGenerationRef.current = scope.requestId;
    setIsGenerating(true);
    setGenError(null);
    setAiProviderFailure(null);
    lastAiRetryRef.current = () => void handleGenerateSchematic(prompt);
    try {
      let state: SchematicState;
      let explanation: string;

      if (mode === "build") {
        appendActivityStep(logId, "Generating build netlist");
        const res = await fetch("/api/schematic/build-multi", {
          method: "POST",
          headers: aiRequestHeaders(scope),
          body: JSON.stringify({ prompt, provider: aiBrainRef.current }),
          signal: scope.signal,
        });
        if (!res.ok) await throwAiResponseError(res, lastAiRetryRef.current ?? undefined, { isCurrent: () => scope.isCurrent() });
        const data = (await res.json()) as
          | { ok: true; netlist: BuildLogicalNetlist; explanation: string }
          | { ok: false; error: string };
        if (!data.ok) throw new Error(data.error || "Generation failed");

        // Load every referenced part before laying out (positions come from pins).
        const netlist = data.netlist;
        const partIds = [...new Set(netlist.components.map((c) => c.partId))];
        const parts = new Map<string, CachedPart>();
        appendActivityStep(logId, `Loading ${partIds.length} catalog part${partIds.length === 1 ? "" : "s"}`);
        await Promise.all(
          partIds.map(async (id) => {
            parts.set(id, await ensurePartLoaded(id));
          }),
        );
        appendActivityStep(logId, "Laying out and validating schematic");
        const built = autoLayoutBuildValidated(netlist, parts);
        state = built.state;
        explanation = data.explanation;

        if ((state.kicadComponents?.length ?? 0) === 0) {
          failActivityLog(logId, "No parts produced");
          setScopedGenError(scope, "No parts produced — try a more specific prompt.");
          return;
        }

        // Electrical validation: surface (don't silently ship) a schematic that
        // is electrically wrong by netlist after reroute attempts.
        if (!built.validation.ok) {
          const v = built.validation.violations;
          setScopedGenError(scope, `Electrical check: ${v.length} issue(s) — ${v.slice(0, 3).map((x) => x.message).join("  |  ")}${v.length > 3 ? " …" : ""}`, 12000);
          appendActivityStep(logId, `Electrical check found ${v.length} issue${v.length === 1 ? "" : "s"}`, "done");
        }
      } else {
        appendActivityStep(logId, "Synthesizing theory schematic");
        const result = await generateSchematic(prompt, lastAiRetryRef.current ?? undefined, { isCurrent: () => scope.isCurrent() });
        state = result.state;
        explanation = result.netlist.explanation;
        if (state.components.length === 0) {
          failActivityLog(logId, "No components produced");
          setScopedGenError(scope, "No components produced — try a more specific prompt.");
          return;
        }

        // Surface (don't silently ship) an electrically-invalid theory schematic.
        if (!result.validation.ok) {
          const v = result.validation.violations;
          appendActivityStep(logId, `Electrical check found ${v.length} issue${v.length === 1 ? "" : "s"}`, "done");
          setScopedGenError(scope, `Electrical check: ${v.length} issue(s) — ${v.slice(0, 3).map((x) => x.message).join("  |  ")}${v.length > 3 ? " …" : ""}`, 12000);
        }
      }

      // B07.4 (failure B) — the replacement dialog may only open while the
      // ORIGINATING project/session generation is still active, the
      // authoritative base still equals the invocation pin, and the result
      // validates. A stale response marks only its own activity log (id-
      // keyed, so it is a no-op after a switch) and touches NOTHING else in
      // the now-active project.
      const resultIssues = validateSchematicStateIntegrity(state);
      if (!scope.isCurrent()) {
        failActivityLog(logId, "Result discarded — the project changed while generating");
        return;
      }
      if (resultIssues.length > 0) {
        failActivityLog(logId, "Generated schematic failed validation — nothing applied");
        setScopedGenError(scope, `The generated schematic failed validation (${resultIssues[0]}). Nothing was changed.`);
        return;
      }
      const authoritativeDigestNow = schematicStateDigest(gestureCoordinatorRef.current!.authoritativeState());
      if (authoritativeDigestNow !== pin.baseDigest) {
        failActivityLog(logId, "Result is stale — the schematic changed while generating. Nothing was applied.");
        setScopedGenError(scope, "The schematic changed while generating — the result is stale and was not applied.");
        return;
      }
      // [B16.1C §F] EVERY generated schematic is a proposal that waits for the
      // human's explicit approval in the review dialog — including the first
      // generation onto an empty sheet, which used to apply itself. The
      // dialog states what will change (parts, wires, labels, what is
      // replaced); the pin travels with the pending proposal so confirming
      // later still rejects as stale if the schematic or project moved on.
      finishActivityLog(logId, components.length > 0 || wires.length > 0 || kicadComponents.length > 0 || netLabels.length > 0 ? "Generated replacement; waiting for confirmation" : "Generated schematic proposal; waiting for approval");
      setPendingReplace({ state, explanation, prompt, logId, promptAlreadyLogged: true, pin });
    } catch (err) {
      if (isAbortError(err) || !scope.isCurrent()) {
        // Cancellation (project switch/unmount) — not a provider failure;
        // nothing is written into the now-active project.
        failActivityLog(logId, "Canceled — the project changed");
        return;
      }
      const msg = err instanceof Error ? err.message : "Generation failed";
      failActivityLog(logId, msg);
      setScopedGenError(scope, msg);
    } finally {
      // Only THIS request may clear the busy flag it set.
      if (activeGenerationRef.current === scope.requestId) {
        activeGenerationRef.current = null;
        setIsGenerating(false);
      }
    }
  }

  // Tier-1 text editing: attribute-only edits (set value / rename / delete)
  // applied directly to state. No re-layout, no netlist round-trip — so manual
  // placement is preserved and the validator isn't involved (connectivity only
  // changes on delete, which is the user's explicit intent).
  async function handleEditSchematic(prompt: string, opts?: { displayPrompt?: string }) {
    if (!prompt.trim() || isEditing) return;
    // B07.3 — the edit pipeline reads ONE immutable authoritative snapshot
    // captured now (never the visible arrays, which may show a gesture
    // preview), is gated on session readiness, and pins its eventual
    // topology application to this exact project + base digest.
    const entryGate = schematicConsumerGate("edit");
    if (!entryGate.allowed) {
      setScopedGenError(projectScopeRegistryRef.current!.capture(), entryGate.reason);
      return;
    }
    const pin = captureLifecycleInvocationContext();
    const scope = pin.scope;
    const snapshot = currentSchematicState();
    const hasSchematic = snapshot.components.length > 0 || (snapshot.kicadComponents ?? []).length > 0;
    if (!hasSchematic) return;

    const logId = startActivityLog("Editing schematic", "Interpreting edit request", opts?.displayPrompt ?? prompt);
    const isApplyingSuggestions = isGuardedSupportApplyInstruction(prompt);
    activeEditRef.current = scope.requestId;
    setIsEditing(true);
    setGenError(null);
    setAiProviderFailure(null);
    lastAiRetryRef.current = () => void handleEditSchematic(prompt, opts);
    try {
      const summary = [
        // B07: tier-1 targets address theory components by DISPLAY reference
        // (refDes ?? id) — the stable id never leaves the client.
        ...snapshot.components.map((c) => ({ refDes: schDisplayRef(c), kind: c.type, value: c.value || "" })),
        ...(snapshot.kicadComponents ?? []).map((k) => ({
          refDes: k.refDes,
          kind: getCachedPart(k.partId)?.name ?? "part",
          value: k.value || "",
        })),
      ];

      const res = await fetch("/api/schematic/edit", {
        method: "POST",
        headers: aiRequestHeaders(scope),
        body: JSON.stringify({ instruction: prompt, components: summary, provider: aiBrainRef.current }),
        signal: scope.signal,
      });
      if (!res.ok) await throwAiResponseError(res, lastAiRetryRef.current ?? undefined, { isCurrent: () => scope.isCurrent() });
      const data = (await res.json()) as
        | { ok: true; ops: SchematicEditOp[]; note: string; needsTopology: boolean }
        | { ok: false; error: string };
      if (!data.ok) throw new Error(data.error || "Edit failed");

      // Tier 2 — topology edit (add / rewire / swap). Round-trips the current
      // schematic through the netlist editor, then re-lays-out + validates.
      if (data.needsTopology) {
        appendActivityStep(logId, "Routing through topology editor");
        if (mode !== "build") {
          finishActivityLog(logId, "Topology edit not available in Theory mode");
          appendChatFor(pin.projectId, (prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content:
                "Topology edits (adding, rewiring, or swapping parts) aren't supported in Theory mode yet — use Generate to recreate the circuit.",
            },
          ]);
          return;
        }

        const partsMap = new Map<string, CachedPart>();
        for (const k of snapshot.kicadComponents ?? []) {
          const p = getCachedPart(k.partId);
          if (p) partsMap.set(k.partId, p);
        }
        // B07.3 — the topology round-trip serializes the SAME authoritative
        // snapshot the summary came from, never the visible arrays.
        const currentNetlist = schematicToBuildNetlist(snapshot, partsMap);

        appendActivityStep(logId, "Applying netlist edit");
        const res2 = await fetch("/api/schematic/edit-build", {
          method: "POST",
          headers: aiRequestHeaders(scope),
          body: JSON.stringify({ instruction: prompt, netlist: currentNetlist, provider: aiBrainRef.current }),
          signal: scope.signal,
        });
        if (!res2.ok) await throwAiResponseError(res2, lastAiRetryRef.current ?? undefined, { isCurrent: () => scope.isCurrent() });
        const data2 = (await res2.json()) as
          | { ok: true; netlist: BuildLogicalNetlist; explanation: string }
          | { ok: false; error: string };
        if (!data2.ok) throw new Error(data2.error || "Edit failed");

        const nl = data2.netlist;
        if (isApplyingSuggestions) {
          const beforeByRef = new Map(currentNetlist.components.map((c) => [c.refDes, c] as const));
          const afterByRef = new Map(nl.components.map((c) => [c.refDes, c] as const));
          const processorBefore = currentNetlist.components.filter((c) => c.role === "processor");
          const changedProcessors = processorBefore.filter((c) => afterByRef.get(c.refDes)?.partId !== c.partId);
          const addedBlocked = nl.components.filter((c) => {
            if (beforeByRef.has(c.refDes)) return false;
            const prefix = (c.refDes.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();
            return (
              c.role === "processor" ||
              prefix === "U" ||
              /\b(esp32|mcu|microcontroller|processor|controller|rp2040|stm32|atmega|wroom|wrover)\b/i.test(c.value)
            );
          });
          if (changedProcessors.length > 0 || addedBlocked.length > 0) {
            throw new Error(
              "Apply suggestions was blocked because it tried to add, remove, or rename a processor/controller. Use a manual edit if you really want that change.",
            );
          }
        }
        const ids = [...new Set(nl.components.map((c) => c.partId))];
        const loaded = new Map<string, CachedPart>();
        appendActivityStep(logId, `Loading ${ids.length} catalog part${ids.length === 1 ? "" : "s"}`);
        await Promise.all(ids.map(async (id) => loaded.set(id, await ensurePartLoaded(id))));

        appendActivityStep(logId, "Laying out and validating edit");
        const built = autoLayoutBuildValidated(nl, loaded);
        // [B16-A F11] the provider's topology edit is a PROPOSAL like every
        // other generation: it is staged in the review dialog (which names
        // exactly what will change against the live schematic) and nothing is
        // applied until the human approves it there. Before this correction
        // the edit-build result — and the "Apply suggestions" result — were
        // adopted directly here, a hidden auto-apply of provider output.
        // Re-layout replaces positions (Tier 2 tradeoff); the invocation pin
        // travels with the proposal so a late approval is still refused as
        // stale by the transactional gateway (B07.3).
        const validationNote = built.validation.ok ? null : `Electrical check: ${built.validation.violations.length} issue(s) — ${built.validation.violations.slice(0, 3).map((x) => x.message).join("  |  ")}${built.validation.violations.length > 3 ? " …" : ""}`;
        if (!scope.isCurrent()) { failActivityLog(logId, "Canceled — the project changed"); return; }
        finishActivityLog(logId, isApplyingSuggestions ? "Suggestions proposal ready; waiting for approval" : "Edit proposal ready; waiting for approval");
        setPendingReplace({ state: built.state, explanation: data2.explanation || "Updated the circuit.", prompt, logId, promptAlreadyLogged: true, pin, skipAutoRun: isApplyingSuggestions, validationNote });
        return;
      }

      // B06.1: receiving provider output MUTATES NOTHING. The ops are
      // compiled (deterministically, strictly all-or-nothing) into canonical
      // operations and sealed into a digest-pinned pending proposal. Any
      // unknown target, unsupported operation (theory id-rename), or missing
      // pin data BLOCKS the complete proposal — no valid subset ever
      // executes, and there is no legacy setComponents side channel. Only
      // the explicit "Apply exact proposal" button executes the sealed
      // operations through the trusted interactive session.
      //
      // B07.4 (failure E) — the provider output stays PINNED to the exact
      // INVOCATION snapshot: compilation and sealing use `snapshot` (never a
      // fresh read of response-time state, which would silently grant the
      // output an unreviewed rebase), the pin is re-verified before
      // compilation AND after the catalog preflight awaits, and the sealed
      // digest must equal the invocation digest.
      const tier1StillPinned = (): boolean =>
        scope.isCurrent() && schematicStateDigest(gestureCoordinatorRef.current!.authoritativeState()) === pin.baseDigest;
      if (!tier1StillPinned()) {
        failActivityLog(logId, "Edit result is stale — the schematic or project changed while it was being prepared. No proposal was created.");
        return;
      }
      const kicadByRefDes = new Map((snapshot.kicadComponents ?? []).map((k) => [k.refDes, k] as const));
      const deletePartIds = new Set<string>();
      for (const op of data.ops) {
        if (op.op !== "delete") continue;
        const instance = kicadByRefDes.get(op.target);
        if (instance) deletePartIds.add(instance.partId);
      }
      const pinsByPartId = new Map<string, CachedPart["pins"]>();
      await Promise.all([...deletePartIds].map(async (partId) => {
        try {
          const part = getCachedPart(partId) ?? (await ensurePartLoaded(partId));
          if (part?.pins) pinsByPartId.set(partId, part.pins);
        } catch { /* missing pin data → the compiler blocks that delete */ }
      }));
      // Catalog preflight awaited above — re-verify the pin before compiling.
      if (!tier1StillPinned()) {
        failActivityLog(logId, "Edit result is stale — the schematic or project changed during catalog loading. No proposal was created.");
        return;
      }
      const sealScope = { tenantId: "local", projectId: pin.projectId ?? "", branchId: scope.branchId };
      // [B16.0.2 §E] REQUEST-OWNED, ASYNC, TYPED live identity for EXACTLY this
      // scope, bound to the captured ProjectAsyncScope (its signal aborts the
      // load on project switch / logout / unmount). There is NO fallback
      // identity: when it cannot be loaded, NO proposal is created and the
      // user is told to sign in / retry. Local development obtains its
      // deterministic identity through the SAME server boundary.
      const sessionIdentity = await loadSessionIdentity(sealScope, { signal: scope.signal });
      if (!tier1StillPinned()) {
        failActivityLog(logId, "Edit result is stale — the schematic or project changed while your sign-in was being verified. No proposal was created.");
        return;
      }
      if (!sessionIdentity.ok) {
        failActivityLog(logId, SESSION_IDENTITY_UNAVAILABLE_MESSAGE);
        return;
      }
      // B09.1 — the proposal is sealed WITH the current session's scope/
      // head identity; a not-ready session fails closed (no proposal). The
      // head mark is read AFTER the identity await so it is the live head.
      const sealSession = schematicSessionRef.current;
      const sealHeadMark = sealSession?.headMark() ?? null;
      if (!sealHeadMark) {
        failActivityLog(logId, "The schematic session is not ready — no scope-sealed proposal can be created. Nothing was changed.");
        return;
      }
      const compilation = compileTier1Proposal(snapshot, { ops: data.ops, pinsByPartId });
      const sealed = sealTier1Proposal({
        state: snapshot,
        compilation,
        // [B18-D review 2] the sealed note is the page's own sentence (as the agent path's is): the model's note never reaches the
        // review dialog — it is only a labelled note in the run log (Rule 2, OD-18)
        provenance: { provider: aiBrainRef.current, note: editRouteProvenanceNote(data.note), instruction: prompt },
        now: Date.now(),
        scope: { ...sealScope, headMark: sealHeadMark },
        // [B16.0.2 §E] the LIVE server-derived principal + membership revision
        // for exactly this scope — never a local-dev or cached fallback.
        // Apply-time reauthorization compares the LIVE membership against it.
        authorization: sessionAuthorizationBindingFrom(sessionIdentity, sealScope),
      });

      if (sealed.kind === "blocked") {
        finishActivityLog(logId, "Proposal blocked — nothing applied");
        appendChatFor(pin.projectId, (prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `The proposed edit was refused in full (all-or-nothing): ${sealed.blockers.map((blocker) => blocker.detail).join(" ")} Nothing was changed.`,
          },
        ]);
        return;
      }

      // The sealed base digest MUST equal the invocation pin — anything else
      // means an unreviewed rebase and the proposal is discarded.
      if (sealed.proposal.baseSchematicDigest !== pin.baseDigest) {
        failActivityLog(logId, "Proposal discarded — sealed base digest did not match the invocation pin");
        return;
      }
      // B07.3/B07.4 — a proposal prepared for another project/session
      // generation must never surface in the currently selected one.
      if (!tier1StillPinned()) {
        finishActivityLog(logId, "Proposal discarded — the project or schematic changed while it was being prepared");
        return;
      }
      setPendingTier1(sealed.proposal);
      // [B18-D review] Rule 2 here too (OD-18): the model's note is a labelled note in the run log — never the answer, and never
      // the history the next run receives; the answer is the page's own sentence.
      const editMessages = editProposalMessages(data.note);
      if (editMessages.note) appendActivityStep(logId, editMessages.note, "done");
      finishActivityLog(logId, `Proposal ready — ${sealed.proposal.operations.length} operation(s) awaiting your review`);
      appendChatFor(pin.projectId, (prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: editMessages.answer,
        },
      ]);
    } catch (err) {
      if (isAbortError(err) || !scope.isCurrent()) {
        failActivityLog(logId, "Canceled — the project changed");
        return;
      }
      const msg = err instanceof Error ? err.message : "Edit failed";
      failActivityLog(logId, msg);
      setScopedGenError(scope, msg);
    } finally {
      if (activeEditRef.current === scope.requestId) {
        activeEditRef.current = null;
        setIsEditing(false);
      }
    }
  }

  // Layer-2 design review: advisory, non-blocking. Computes the deterministic
  // netlist (ground truth), asks an LLM for electrical-sensibility findings, and
  // posts them to the chat. Contradicted "floating" claims are dropped server-side.
  async function handleReview(auto = false) {
    if (isReviewing) return;
    // B07.3 — review reads ONE immutable authoritative snapshot (never a
    // gesture preview), is gated on session readiness (its findings become
    // applicable suggestions), and its results are pinned to this project.
    const reviewGate = schematicConsumerGate("edit");
    if (!reviewGate.allowed) {
      if (!auto) setScopedGenError(projectScopeRegistryRef.current!.capture(), reviewGate.reason);
      return;
    }
    const reviewPin = captureLifecycleInvocationContext();
    const reviewScope = reviewPin.scope;
    const reviewSnapshot = currentSchematicState();
    if (reviewSnapshot.components.length === 0 && (reviewSnapshot.kicadComponents ?? []).length === 0) return;
    activeReviewRef.current = reviewScope.requestId;
    setIsReviewing(true);
    setGenError(null);
    setAiProviderFailure(null);
    lastAiRetryRef.current = () => void handleReview(auto);
    try {
      const partsMap = new Map<string, CachedPart>();
      for (const k of reviewSnapshot.kicadComponents ?? []) {
        const p = getCachedPart(k.partId);
        if (p) partsMap.set(k.partId, p);
      }
      const reviewInput = buildReviewInput(reviewSnapshot, partsMap);

      const res = await fetch("/api/schematic/review", {
        method: "POST",
        headers: aiRequestHeaders(reviewScope),
        body: JSON.stringify({ ...reviewInput, provider: aiBrainRef.current }),
        signal: reviewScope.signal,
      });
      if (!res.ok) await throwAiResponseError(res, lastAiRetryRef.current ?? undefined, { isCurrent: () => reviewScope.isCurrent() });
      const data = (await res.json()) as
        | { ok: true; findings: { severity: string; category?: string; title: string; detail: string; refs: string[] }[]; summary: string; dropped: number }
        | { ok: false; error: string };
      if (!data.ok) throw new Error(data.error || "Review failed");

      const icon = (s: string) => (s === "error" ? "🔴" : s === "warning" ? "⚠️" : "ℹ️");
      // Actionable findings (errors/warnings) can be integrated via the validated
      // edit pipeline — no SchGen/GPU dependency, so this works today.
      const actionable = data.findings
        .filter((f) => f.severity === "error" || f.severity === "warning")
        .filter(isSupportSuggestion)
        .map((f) => ({
          title: f.title,
          detail: f.detail,
          category: f.category,
          severity: f.severity,
          refs: f.refs ?? [],
          source: "review" as const,
        }));
      // B07.3/B07.4 — findings prepared for another project GENERATION or a
      // superseded schematic never surface as current suggestions. When
      // current, they are stored as a SCOPED BATCH carrying exact
      // project/session/base ownership.
      const reviewStillCurrent = reviewScope.isCurrent()
        && schematicStateDigest(gestureCoordinatorRef.current!.authoritativeState()) === reviewPin.baseDigest;
      if (reviewStillCurrent && actionable.length > 0) {
        setPendingSuggestions({ items: actionable, scope: reviewScope, baseSchematicDigest: reviewPin.baseDigest, createdAt: Date.now() });
        setSuggestionsMinimized(false);
      }

      const md =
        data.findings.length === 0
          ? `**Design review** — no issues found.${data.summary ? `\n\n${data.summary}` : ""}`
          : `**Design review — ${data.findings.length} finding(s)**\n\n` +
            data.findings
              .map((f) => `- ${icon(f.severity)} **${f.title}**${f.refs?.length ? ` (${f.refs.join(", ")})` : ""} — ${f.detail}`)
              .join("\n") +
            (data.summary ? `\n\n_${data.summary}_` : "") +
            (reviewStillCurrent && actionable.length > 0 ? "\n\n_Click **Apply suggestions** to address these via a validated edit._" : "") +
            (reviewStillCurrent ? "" : "\n\n_The schematic changed while this review ran — treat these findings as a snapshot review, not current suggestions._") +
            "\n\n_Advisory — design suggestions, not hard errors; verify before acting._";

      appendChatFor(reviewPin.projectId, (prev) => [
        ...prev,
        // Auto-runs post only the result; a fake user turn would read as noise.
        ...(auto ? [] : [{ id: crypto.randomUUID(), role: "user" as const, content: "Review the circuit" }]),
        { id: crypto.randomUUID(), role: "assistant", content: md, advisory: true },
      ]);
    } catch (err) {
      if (isAbortError(err) || !reviewScope.isCurrent()) return; // cancellation, not a failure
      if (!auto) {
        const msg = err instanceof Error ? err.message : "Review failed";
        setScopedGenError(reviewScope, msg);
      }
    } finally {
      if (activeReviewRef.current === reviewScope.requestId) {
        activeReviewRef.current = null;
        setIsReviewing(false);
      }
    }
  }

  // Rasterize the live schematic to a PNG data URL for the layout critic. We
  // reframe a CLONE of the on-screen SVG to the full content bounds (getBBox on
  // the transformed inner <g>, in world units) so the model sees the whole
  // circuit regardless of the current pan/zoom — then draw it onto a canvas.
  async function captureSchematicPng(): Promise<string | null> {
    const svg = document.getElementById("sirkit-schematic-svg") as SVGSVGElement | null;
    if (!svg) return null;
    const inner = svg.querySelector("g") as SVGGraphicsElement | null;
    if (!inner) return null;
    let bb: DOMRect;
    try {
      bb = inner.getBBox();
    } catch {
      return null;
    }
    if (!bb.width || !bb.height) return null;

    const PAD = 40;
    const vbX = bb.x - PAD, vbY = bb.y - PAD;
    const vbW = bb.width + 2 * PAD, vbH = bb.height + 2 * PAD;
    const CAP = 1600; // cap the long edge so the upload stays small
    const scale = Math.min(1, CAP / Math.max(vbW, vbH));
    const pxW = Math.max(1, Math.round(vbW * scale));
    const pxH = Math.max(1, Math.round(vbH * scale));

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
    clone.setAttribute("width", String(pxW));
    clone.setAttribute("height", String(pxH));
    clone.removeAttribute("style");
    // Drop the pan/zoom transform so world coords map straight into the viewBox,
    // and replace the panned dot-grid background with a flat fill.
    const cloneInner = clone.querySelector("g");
    if (cloneInner) cloneInner.setAttribute("transform", "translate(0,0) scale(1)");
    const bgRect = clone.querySelector("rect");
    if (bgRect) bgRect.setAttribute("fill", "#0b0b0d");

    const xml = new XMLSerializer().serializeToString(clone);
    const dataUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));

    return await new Promise<string | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = pxW;
        canvas.height = pxH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.fillStyle = "#0b0b0d";
        ctx.fillRect(0, 0, pxW, pxH);
        ctx.drawImage(img, 0, 0, pxW, pxH);
        try {
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null); // tainted canvas (shouldn't happen for inline SVG)
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // Layer-2 LAYOUT critic: screenshot the schematic, let Claude flag crowded
  // component groups, then DETERMINISTICALLY re-lay-out the circuit with extra
  // spacing on those groups. Only applies a result that stays electrically valid.
  async function handleTidyLayout(auto = false) {
    if (isTidying) return;
    // B07.3 — tidy is gated on readiness, REFUSED while a gesture owns the
    // preview (the screenshot captures the LIVE canvas, which would show
    // uncommitted preview geometry), reads one authoritative snapshot, and
    // pins its eventual application to the base captured now.
    const tidyGate = schematicConsumerGate("edit");
    if (!tidyGate.allowed) {
      if (!auto) setScopedGenError(projectScopeRegistryRef.current!.capture(), tidyGate.reason, 5000);
      return;
    }
    if (gestureCoordinatorRef.current!.previewActive || gestureCoordinatorRef.current!.busy) {
      if (!auto) setScopedGenError(projectScopeRegistryRef.current!.capture(), "Tidy was not started: finish or cancel the current move first.", 5000);
      return;
    }
    const tidyPin = captureLifecycleInvocationContext();
    const tidyScope = tidyPin.scope;
    const tidySnapshot = currentSchematicState();
    if ((tidySnapshot.kicadComponents ?? []).length === 0) {
      if (!auto) setScopedGenError(tidyScope, "Tidy is available for Build-mode schematics with catalog parts.", 5000);
      return;
    }
    activeTidyRef.current = tidyScope.requestId;
    setIsTidying(true);
    setGenError(null);
    setAiProviderFailure(null);
    lastAiRetryRef.current = () => void handleTidyLayout(auto);
    try {
      // The screenshot is taken while no preview is active (checked above),
      // so the rendered SVG equals the authoritative snapshot sent below.
      const image = await captureSchematicPng();
      if (!image) throw new Error("Could not capture the schematic image");

      const res = await fetch("/api/schematic/layout-critic", {
        method: "POST",
        headers: aiRequestHeaders(tidyScope),
        body: JSON.stringify({
          provider: aiBrainRef.current,
          state: { ...tidySnapshot, pageSize: tidySnapshot.pageSize ?? pageSize },
          image,
        }),
        signal: tidyScope.signal,
      });
      if (!res.ok) await throwAiResponseError(res, lastAiRetryRef.current ?? undefined, { isCurrent: () => tidyScope.isCurrent() });
      const data = (await res.json()) as
        | {
            ok: true;
            applied: boolean;
            state: SchematicState;
            critique: { groups: { refDes: string[]; reason: string; severity: string }[]; summary: string };
            validation: { ok: boolean; violations: number };
            spreadRefDes: string[];
            regressedRefDes: string[];
            improved: boolean;
          }
        | { ok: false; error: string };
      if (!data.ok) throw new Error(data.error || "Layout critic failed");

      const { groups, summary } = data.critique;
      const sevIcon = (s: string) => (s === "high" ? "🔴" : s === "medium" ? "⚠️" : "ℹ️");
      const groupLines =
        groups.length === 0
          ? "No crowding found — layout reads clearly."
          : groups
              .map((g) => `- ${sevIcon(g.severity)} **${g.refDes.join(", ")}** — ${g.reason}`)
              .join("\n");

      if (data.applied) {
        const note =
          `**Layout tidied** — spaced out ${data.spreadRefDes.length} crowded component(s) and re-routed.\n\n` +
          groupLines +
          (summary ? `\n\n_${summary}_` : "");
        // Re-layout replaces positions. Auto-tidy is part of the default loop,
        // so it updates the canvas silently; manual tidy still reports to chat.
        // skipAutoRun: the auto pipeline drives tidy → review itself; letting
        // this apply re-bump the token would loop tidy on its own output.
        // B07.3 — pinned to the pre-request base: a manual edit or project
        // switch during the critic call makes this result stale (surfaced by
        // the gateway), so a late tidy can never overwrite newer work.
        await applySchematic(data.state, note, "Tidy the schematic layout", { skipAutoRun: true, suppressChat: auto, pin: tidyPin });
      } else if (!auto) {
        // Auto runs stay silent when nothing changed; manual runs explain why.
        const reason =
          data.spreadRefDes.length === 0
            ? "Nothing to spread out."
            : !data.validation.ok
              ? "A tidied re-layout would have broken connectivity, so the original was kept."
              : data.regressedRefDes.length > 0
                ? `Spreading those out would have crowded other parts (${data.regressedRefDes.join(", ")}), so the original was kept.`
                : !data.improved
                  ? "Re-spacing wouldn't have given the crowded parts more room, so the original was kept."
                  : "No safe improvement applied.";
        appendChatFor(tidyPin.projectId, (prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", content: "Tidy the schematic layout" },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `**Layout review** — ${reason}\n\n${groupLines}${summary ? `\n\n_${summary}_` : ""}`,
          },
        ]);
      }
    } catch (err) {
      if (isAbortError(err) || !tidyScope.isCurrent()) return; // cancellation, not a failure
      if (!auto) {
        const msg = err instanceof Error ? err.message : "Layout critic failed";
        setScopedGenError(tidyScope, msg);
      }
    } finally {
      if (activeTidyRef.current === tidyScope.requestId) {
        activeTidyRef.current = null;
        setIsTidying(false);
      }
    }
  }

  // Post-apply auto pipeline: after a machine-generated schematic lands (and has
  // had a moment to render — Tidy screenshots the live SVG), auto-tidy the
  // layout, then auto-review it. Both are no-ops/silent when there's nothing to
  // do. The review reads the pre-tidy snapshot's netlist, which Tidy's validation
  // gate guarantees is electrically identical to the tidied one.
  useEffect(() => {
    if (autoRunToken === 0) return;
    const wantTidy = autoRunIncludesTidy.current;
    // B07.4 — the pending auto pipeline runs on a PROJECT-OWNED timer: a
    // project transition cancels it at the registry (and stales its guard),
    // so a stage scheduled by project A can never run in project B. The
    // effect cleanup also cancels on token change/unmount.
    const pipelineScope = projectScopeRegistryRef.current!.capture();
    const cancel = pipelineScope.setTimeout(() => {
      void (async () => {
        if (!pipelineScope.isCurrent()) return;
        if (wantTidy) await handleTidyLayout(true);
        if (!pipelineScope.isCurrent()) return;
        await handleReview(true);
      })();
    }, 1200);
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunToken]);

  // Cross-verify: ask an INDEPENDENT domain model (SchGen) to design the same
  // request, then diff its netlist against this one and surface disagreements as
  // advisory findings. Slow (~1–2 min, a 20B model) and no-ops gracefully when the
  // endpoint isn't configured.
  async function handleSecondOpinion() {
    if (isSecondOpinion) return;
    if (kicadComponents.length === 0) {
      setScopedGenError(projectScopeRegistryRef.current!.capture(), "Second opinion needs a Build-mode schematic.", 5000);
      return;
    }
    const prompt = (lastDesignPrompt || input).trim();
    if (!prompt) {
      setScopedGenError(projectScopeRegistryRef.current!.capture(), "No design prompt to compare against — generate from a prompt first.", 5000);
      return;
    }
    // B07.3/B07.4 — cross-verification reads one authoritative snapshot and
    // pins its results to this project generation + base.
    const opinionPin = captureLifecycleInvocationContext();
    const opinionScope = opinionPin.scope;
    const opinionSnapshot = currentSchematicState();
    activeSecondOpinionRef.current = opinionScope.requestId;
    setIsSecondOpinion(true);
    setGenError(null);
    try {
      const res = await fetch("/api/schematic/cross-verify", {
        method: "POST",
        headers: aiRequestHeaders(opinionScope),
        body: JSON.stringify({ prompt, state: { ...opinionSnapshot, pageSize: opinionSnapshot.pageSize ?? pageSize } }),
        signal: opinionScope.signal,
      });
      const data = (await res.json()) as
        | {
            ok: true;
            available: boolean;
            findings: { severity: string; category: string; title: string; detail: string }[];
            agreement: number | null;
            summary: string;
          }
        | { ok: false; error: string };
      if (!data.ok) throw new Error(data.error || "Second opinion failed");

      // Actionable = likely-missing support parts (warning severity). Stashed so
      // the user can integrate them through the validated edit pipeline.
      const actionable = data.available
        ? data.findings
            .filter((f) => f.severity === "warning")
            .filter(isSupportSuggestion)
            .map((f) => ({
              title: f.title,
              detail: f.detail,
              category: f.category,
              severity: f.severity,
              refs: [],
              source: "second-opinion" as const,
            }))
        : [];
      // B07.3/B07.4 — suggestions prepared against a superseded schematic or
      // another project generation never surface as current; current ones
      // are stored as a SCOPED BATCH.
      const opinionStillCurrent = opinionScope.isCurrent()
        && schematicStateDigest(gestureCoordinatorRef.current!.authoritativeState()) === opinionPin.baseDigest;
      if (opinionStillCurrent && actionable.length > 0) {
        setPendingSuggestions({ items: actionable, scope: opinionScope, baseSchematicDigest: opinionPin.baseDigest, createdAt: Date.now() });
        setSuggestionsMinimized(false);
      }

      let md: string;
      if (!data.available) {
        md = "**Second opinion** — the independent model isn't configured (`SCHGEN_ENDPOINT_URL`).";
      } else if (data.agreement === null) {
        // No comparable netlist parsed (model returned prose / no DSL, or was truncated).
        md = "**Second opinion** — the independent model's output couldn't be parsed into a comparable netlist, so no comparison was made. Its output is stochastic — try again, or simplify the request.";
      } else if (data.findings.length === 0) {
        md = `**Second opinion** — an independent domain model agrees on the component set (${(data.agreement * 100).toFixed(0)}% match).${data.summary ? `\n\n_${data.summary}_` : ""}`;
      } else {
        const icon = (s: string) => (s === "warning" ? "⚠️" : "ℹ️");
        md =
          `**Second opinion — ${data.findings.length} difference(s)** · agreement ${(data.agreement * 100).toFixed(0)}%` +
          "\n\n" +
          data.findings.map((f) => `- ${icon(f.severity)} **${f.title}** — ${f.detail}`).join("\n") +
          (actionable.length > 0
            ? "\n\n_Click **Apply suggestions** to integrate the flagged support parts via a validated edit._"
            : "") +
          "\n\n_Advisory — an independent model's take, not ground truth; verify before acting._";
      }
      appendChatFor(opinionPin.projectId, (prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: "Get a second opinion" },
        { id: crypto.randomUUID(), role: "assistant", content: opinionStillCurrent ? md : `${md}\n\n_The schematic changed while this ran — treat as a snapshot comparison, not current suggestions._`, advisory: true },
      ]);
    } catch (err) {
      if (isAbortError(err) || !opinionScope.isCurrent()) return; // cancellation, not a failure
      const msg = err instanceof Error ? err.message : "Second opinion failed";
      setScopedGenError(opinionScope, msg);
    } finally {
      if (activeSecondOpinionRef.current === opinionScope.requestId) {
        activeSecondOpinionRef.current = null;
        setIsSecondOpinion(false);
      }
    }
  }

  // Integrate the second opinion's suggestions by running them through the
  // VALIDATED edit pipeline: a frontier model adds the actual parts/connections
  // and autoLayoutBuildValidated checks them. We never graft SchGen's netlist raw.
  async function handleApplySuggestions() {
    const batch = pendingSuggestions;
    if (!batch || batch.items.length === 0 || isEditing || isGenerating) return;
    // B07.4 (failure A) — a suggestion batch is applicable ONLY while its
    // exact project/session generation AND authoritative base digest still
    // match. Anything else is refused truthfully BEFORE any request is
    // built, and old findings are never silently rebased onto a newer
    // schematic.
    const evaluation = evaluateSuggestionBatch(batch, schematicStateDigest(gestureCoordinatorRef.current!.authoritativeState()));
    if (!evaluation.applicable) {
      setPendingSuggestions(null);
      showToast(evaluation.reason);
      return;
    }
    const applyBase = currentSchematicState();
    const existingProcessors = (applyBase.kicadComponents ?? [])
      .map((k) => {
        const part = getCachedPart(k.partId);
        const role = normalizeComponentRole(undefined, k.refDes, part?.pins.length ?? 0);
        return role === "processor" ? `${k.refDes} (${k.value || part?.name || "processor"})` : null;
      })
      .filter((p): p is string => p !== null);
    // [B19-D I5e row 05] the findings are quoted as untrusted data inside a delimited, bounded block
    const guardedInstruction = buildSuggestionInstruction({ existingProcessors, items: batch.items });
    setPendingSuggestions(null);
    setSuggestionsMinimized(false);
    await handleEditSchematic(guardedInstruction, { displayPrompt: "Apply suggestions" });
  }

  function handleComposerSubmit() {
    const text = input.trim();
    if (!text || loading || isGenerating || isEditing) return;
    const hasSchematic = components.length > 0 || kicadComponents.length > 0;
    // [B18-D I1] the shown route, or the user's override — routing only; the server loop or the proposal review decides.
    const action = composerRouteOverride ?? routeComposerMessage(text, hasSchematic).route;
    setComposerRouteOverride(null);
    if (action !== "ask") setInput("");
    if (action === "generate") void handleGenerateSchematic(text);
    else if (action === "edit") void handleEditSchematic(text);
    else void send();
  }

  const composerText = input.trim();
  const hasSchematicForComposer = components.length > 0 || kicadComponents.length > 0;
  const composerRouting = routeComposerMessage(composerText, hasSchematicForComposer);
  const composerAction = composerRouteOverride ?? composerRouting.route;
  const overrideComposerRoute = (): void => setComposerRouteOverride((current) => (current ? null : "ask"));
  const composerBusy = loading || isGenerating || isEditing;
  const composerDisabled = !composerText || composerBusy;
  const showComposerButton = composerAction !== "ask" || isGenerating || isEditing;
  const composerLabel = isGenerating
    ? "Generating..."
    : isEditing
      ? "Editing..."
      : composerAction === "generate"
        ? "Generate"
        : "Edit";

  /** B07.5 (failure E) — simulation runs are OWNED requests: scope +
   *  request id + captured session generation + authoritative base digest
   *  at invocation, `scope.signal` on the fetch (a project switch aborts
   *  it — a cancellation, never a simulation failure), and only a
   *  current-scope, current-base completion may touch simResult/simError/
   *  panes/activePaneId/chart/loading. A simulation begun in project A can
   *  never present its waveforms, set its error, or clear the loading flag
   *  in project B (the transition reset owns B's simulation state), and a
   *  same-project result whose schematic base was superseded mid-run is
   *  DISCARDED with a truthful notice (no versioned result model exists
   *  yet, so a stale-base result is never presented as current). Server
   *  results remain advisory — nothing here mutates schematic state. */
  async function handleRunSim() {
    if (simLoading) return;
    // B07.2 — simulation consumes the AUTHORITATIVE schematic (never a
    // gesture preview) and is blocked while the session is not ready.
    const simGate = schematicConsumerGate("simulation");
    if (!simGate.allowed) {
      setSimError(simGate.reason);
      return;
    }
    const authoritative = currentSchematicState();
    const scope = projectScopeRegistryRef.current!.capture({ baseDigest: schematicStateDigest(authoritative) });
    const hadPanes = panes.length > 0;
    await simulationRunnerRef.current.run(scope, {
      execute: async (signal) => {
        const res = await fetch("/api/simulate", {
          method: "POST",
          // [B16.0.2 §A] ngspice execution is authenticated + project-scoped:
          // the active project identity travels as a SELECTOR only.
          headers: { "Content-Type": "application/json", ...projectSelectorHeaders(scope.projectId ? { tenantId: "local", projectId: scope.projectId, branchId: scope.branchId } : null) },
          body: JSON.stringify({ state: { components: authoritative.components, wires: authoritative.wires, netLabels: authoritative.netLabels ?? [] }, analysis: analysisConfig }),
          signal,
        });
        const data = await res.json() as SimResult & { ok?: boolean; error?: string; details?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? "Simulation failed");
        return data;
      },
      currentBaseDigest: () => schematicStateDigest(gestureCoordinatorRef.current!.authoritativeState()),
      setLoading: (loading) => { setSimLoading(loading); if (loading) setSimError(null); },
      apply: (data) => {
        setSimResult(data);
        // Only auto-create a pane when the user has none yet; otherwise keep
        // their pane layout intact across re-runs.
        if (!hadPanes) {
          const defaultProbe = pickDefaultSignal(data.variables, data.analysisType);
          const pane: Pane = {
            id: crypto.randomUUID(),
            signals: new Set(defaultProbe ? [defaultProbe] : []),
          };
          console.log("[sim] received", data.variables.length, "variables; auto-probing:", defaultProbe ?? "(none)");
          setPanes([pane]);
          setActivePaneId(pane.id);
        }
        setChartPanelOpen(true);
      },
      onError: (error) => setSimError(error instanceof Error ? error.message : "Simulation failed"),
      onStaleBase: () => showToast("The schematic changed while the simulation ran — the stale result was discarded. Re-run to simulate the current schematic."),
    });
  }

  async function handleExportKicad() {
    // B07.2 — export consumes the AUTHORITATIVE schematic (never a gesture
    // preview) and is blocked while the session is conflicted or not ready.
    const exportGate = schematicConsumerGate("export");
    if (!exportGate.allowed) {
      showToast(exportGate.reason);
      return;
    }
    const authoritative = currentSchematicState();
    try {
      const res = await fetch("/api/export/kicad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: { ...authoritative, pageSize: authoritative.pageSize ?? pageSize },
          title: "sirkit-export",
        }),
      });
      if (!res.ok) {
        // [B17-E] the route answers a structured, sanitized refusal (SCHEMATIC_STATE_INVALID + issues): report it as such — a file artifact was NOT produced and nothing changed.
        let refusal: unknown = null;
        try { refusal = await res.json(); } catch { refusal = null; }
        showToast(`KiCad export refused: ${describeExportRefusal(res.status, refusal)} No file was produced; the schematic is unchanged.`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sirkit-export.kicad_sch";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`);
    }
  }

  // Swap every placed instance of `sourcePartId` over to `newPartId`, invoked by
  // the BOM alternates drawer. Position/rotation/refDes/value are preserved — the
  // alternate is assumed form-fit-function compatible. If the new part's pin
  // layout differs, attached wires keep their old endpoints and may hang; the
  // toast tells the user to verify visually rather than blocking on a check.
  // B06: BOM part swap is a canonical fail-closed replacement. One user action
  // replaces every instance of the source part in ONE atomic transaction:
  // identity and ALL authority fields are replaced together (stale Stage-5
  // authority ids can never survive a partId change), and wire endpoints move
  // per the validated pin mapping. Any instance without a safe identity pin
  // mapping refuses the WHOLE swap with a structured message — nothing is
  // applied and there is no direct-state fallback.
  // B06.2: replacement plans are built INSIDE the serialized session queue
  // against the canonical head at execution position — a queued swap can
  // never rebase onto, or execute a plan from, a stale snapshot. Only static
  // catalog part data is fetched up front. Fail-closed all-or-nothing is
  // unchanged: any unmappable instance refuses the whole swap.
  async function handleSwapPart(sourcePartId: string, newPartId: string) {
    if (!liveStateRef.current.kicadComponents.some((k) => k.partId === sourcePartId)) return;
    // B07.4 (failure D) — scope captured BEFORE the catalog preflight: part
    // IDs commonly repeat across projects, so after the awaits the swap may
    // only submit to the CAPTURED project/session; a switch cancels it. The
    // replacement plan is still built inside the serialized queue against
    // the latest canonical head of that SAME project.
    const scope = projectScopeRegistryRef.current!.capture();
    let oldPart: CachedPart;
    let newPart: CachedPart;
    try {
      [oldPart, newPart] = await Promise.all([ensurePartLoaded(sourcePartId), ensurePartLoaded(newPartId)]);
    } catch {
      scope.ifCurrent(() => showToast("Swap failed: part data could not be loaded, so a safe replacement plan cannot be computed. Nothing was changed."));
      return;
    }
    if (!scope.isCurrent()) return; // project changed during preflight — cancel silently
    let refusalMessage: string | null = null;
    let swapCount = 0;
    const planWarnings = new Set<string>();
    const outcome = await runSchematicCommand(`Swapped to ${newPart.mpn ?? newPart.name}`, "schematic.replace-component", (canonical) => {
      const state = fromCanonicalSchematic(canonical);
      const instances = (state.kicadComponents ?? []).filter((k) => k.partId === sourcePartId);
      if (instances.length === 0) return [];
      const operations: EngineeringOperation[] = [];
      for (const instance of instances) {
        const planned = planSchematicReplacement(state, {
          componentId: instance.id,
          // Catalog swap carries catalog identity only — atomic authority is
          // never inferred; re-binding it is an explicit later step.
          target: { partId: newPartId, pins: newPart.pins, authority: { status: "catalog-unverified" } },
          currentPins: oldPart.pins,
        });
        if (!planned.ok) {
          refusalMessage = `Swap refused for ${instance.refDes}: ${planned.detail} Nothing was changed.`;
          return [];
        }
        for (const warning of planned.plan.warnings) planWarnings.add(warning);
        operations.push(planned.operation);
      }
      swapCount = instances.length;
      return operations;
    }, { scope });
    if (refusalMessage) {
      scope.ifCurrent(() => showToast(refusalMessage!));
      return;
    }
    if (outcome.ok && swapCount > 0) {
      scope.ifCurrent(() => {
        showToast(`Swapped ${swapCount === 1 ? "1 component" : `${swapCount} components`} to ${newPart.mpn ?? newPart.name}. Mapped wire connections were preserved; ERC, BOM, physical binding, and PCB sync will recompute from the new identity.`);
        for (const warning of planWarnings) showToast(warning);
      });
    }
  }

  const selectedComp = selectedId
    ? components.find((c) => c.id === selectedId) ?? null
    : null;

  const selectedKicad = selectedKicadId
    ? kicadComponents.find((k) => k.id === selectedKicadId) ?? null
    : null;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* ── Header ── */}
      <header className="h-12 border-b border-zinc-800 flex items-center px-3 gap-3 shrink-0">
        <div className="flex items-center gap-2 pr-3 border-r border-zinc-800 h-12 -my-px">
          <div className="size-6 rounded bg-gradient-to-br from-teal-400 to-cyan-700" />
          <span className="font-medium text-zinc-100">sirkit</span>
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5 ml-1">preview</Badge>
        </div>

        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded p-0.5">
          <button
            onClick={() => setMode("theory")}
            className={`text-xs px-3 py-1 rounded-sm transition ${
              mode === "theory" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >Theory</button>
          <button
            onClick={() => setMode("build")}
            className={`text-xs px-3 py-1 rounded-sm transition ${
              mode === "build" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >Build</button>
        </div>

        <div className="text-sm text-zinc-500">/</div>
        <button
          type="button"
          className="text-sm hover:text-teal-300 transition-colors"
          onClick={handleRenameProject}
          title="Rename project"
        >
          {project?.name ?? "Loading…"}
        </button>
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded ${
            saveStatus.state === "error" ? "bg-red-500/20 text-red-300"
            : saveStatus.state === "saving" || saveStatus.state === "dirty" ? "text-zinc-400"
            : saveStatus.state === "saved" ? "text-zinc-500"
            : "text-zinc-600"
          }`}
          title={saveStatus.detail ?? undefined}
          data-testid="save-status"
        >
          {saveStatus.state === "error" ? `Save failed — ${saveStatus.detail ?? "storage error"}`
            : saveStatus.state === "saving" ? "Saving…"
            : saveStatus.state === "dirty" ? "Unsaved changes…"
            : saveStatus.state === "saved" ? "Saved"
            : ""}
        </span>

        <div className="ml-2 flex items-center gap-0.5">
          <Button
            size="sm" variant="ghost" className="px-2 text-zinc-300 disabled:opacity-40"
            onClick={undoSchematic}
            disabled={view !== "schematic" || !schHistoryView.canUndo}
            title={view !== "schematic" ? "Undo (schematic view)" : schHistoryView.canUndo ? `Undo: ${schHistoryView.undoLabel ?? "last action"} (Ctrl+Z)` : "Nothing to undo"}
            aria-label="Undo schematic action"
          ><Undo2 className="size-3.5" /></Button>
          <Button
            size="sm" variant="ghost" className="px-2 text-zinc-300 disabled:opacity-40"
            onClick={redoSchematic}
            disabled={view !== "schematic" || !schHistoryView.canRedo}
            title={view !== "schematic" ? "Redo (schematic view)" : schHistoryView.canRedo ? `Redo: ${schHistoryView.redoLabel ?? "next action"} (Ctrl+Y)` : "Nothing to redo"}
            aria-label="Redo schematic action"
          ><Redo2 className="size-3.5" /></Button>
          <Button
            size="sm" variant="ghost" className="px-2 text-zinc-300"
            onClick={() => { refreshCheckpoints(); setHistoryOpen(true); }}
            title="Revision history / checkpoints"
            aria-label="Revision history"
          ><History className="size-3.5" /></Button>
          <Button
            size="sm" variant="ghost" className="px-2 text-zinc-300"
            onClick={() => void handleExportProject()}
            title="Save project to a local .sirkit.json file"
            aria-label="Save project file"
          ><Save className="size-3.5" /></Button>
          <Button
            size="sm" variant="ghost" className="px-2 text-zinc-300"
            onClick={() => importInputRef.current?.click()}
            title="Open a Sirkit project file"
            aria-label="Open project file"
          ><FolderInput className="size-3.5" /></Button>
          <input
            ref={importInputRef}
            type="file"
            accept={`${PROJECT_FILE_EXTENSION},.json,application/json`}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleImportProjectFile(file);
            }}
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm" variant="ghost" className="gap-1.5 text-zinc-300"
            onClick={() => { workspaceView.open("sim"); handleRunSim(); }}
            disabled={simLoading}
          >
            {simLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {simLoading ? "Running…" : "Run sim"}
          </Button>
          <Button
            size="sm" variant="ghost" className="gap-1.5 text-zinc-300"
            onClick={handleExportKicad}
            title="Export as KiCad (.kicad_sch)"
          >
            <Download className="size-3.5" /> Export
          </Button>
          <Button
            size="sm" variant="ghost"
            onClick={() => setChatOpen((o) => !o)}
            className={`gap-1.5 ${chatOpen ? "text-teal-400" : "text-zinc-300"}`}
            title="Toggle AI chat"
          >
            <MessageSquare className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="text-zinc-300">
            <Settings className="size-3.5" />
          </Button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex min-h-0">
        {/* Activity Bar */}
        <nav className="w-12 border-r border-zinc-800 flex flex-col items-center py-2 gap-1 shrink-0 bg-zinc-950">
          <ActivityBarButton icon={FolderOpen}    label="Projects"  active={leftPanel === "projects"} onClick={() => toggleLeftPanel("projects")} />
          <ActivityBarButton icon={Package}       label={mode === "theory" ? "Theory Library" : "Build Library"} active={leftPanel === "library"}  onClick={() => toggleLeftPanel("library")} />
          <ActivityBarButton icon={MessageSquare} label="AI Chat"   active={chatOpen}                 onClick={() => setChatOpen((o) => !o)} />
        </nav>

        {/* Left Sidebar */}
        {leftPanel !== null && (
          <aside className="border-r border-zinc-800 flex flex-col shrink-0 relative z-20" style={{ width: leftPanelWidth }}>
            {leftPanel === "projects" ? (
              <>
                <div className="p-3 border-b border-zinc-800">
                  <Button
                    variant="secondary" size="sm" className="w-full justify-start gap-2"
                    data-testid="new-project" onClick={createNewProject}
                  >
                    <Plus className="size-3.5" /> New project
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="px-2 pb-3">
                    <div className="text-xs text-zinc-500 px-2 py-1.5">Projects</div>
                    {projectList.length === 0 && (
                      <div className="text-xs text-zinc-600 px-2 py-1.5">No saved projects yet.</div>
                    )}
                    {projectList.map((item) => (
                      <div key={item.id} className="group flex items-center">
                        <button
                          type="button"
                          onClick={() => switchProject(item.id)}
                          className={`flex-1 text-left text-sm px-2 py-1.5 rounded truncate ${item.id === project?.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"}`}
                          title={`Open "${item.name}"`}
                        >
                          {item.name}
                        </button>
                        {item.id !== project?.id && (
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 px-1 text-zinc-600 hover:text-red-400"
                            title={`Delete "${item.name}"`}
                            aria-label={`Delete project ${item.name}`}
                            onClick={() => {
                              if (!window.confirm(`Delete project "${item.name}"? This removes its local record (durable server boards are kept).`)) return;
                              if (deleteProject(item.id)) { void checkpointStore().removeProject(item.id).catch(() => {}); setProjectList(listProjects()); showToast(`Deleted "${item.name}"`); }
                              else showToast("Delete failed: project record could not be removed.");
                            }}
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            ) : mode === "build" ? (
              <BuildLibraryPanel onSelectForPlacement={startKicadPlacement} />
            ) : (
              <>
                <div className="p-3 border-b border-zinc-800">
                  <div className="text-xs text-zinc-500 mb-2">
                    {mode === "theory" ? "Theory Library" : "Build Library"}
                  </div>
                  <div className="relative">
                    <Search className="size-3.5 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
                    <Input
                      placeholder={mode === "theory" ? "Search primitives" : "Search real parts"}
                      className="pl-7 border-zinc-800 bg-zinc-900"
                    />
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  {mode === "theory" ? (
                    <div className="p-2 space-y-1">
                      {theoryParts.map((part) => {
                        const mapping = SCH_PART_MAP[part.label];
                        return (
                          <TheoryPartRow
                            key={part.label}
                            icon={part.icon}
                            label={part.label}
                            note={part.note}
                            shortcut={part.shortcut}
                            disabled={mapping === null}
                            onPlace={mapping ? () => addComponent(mapping.type) : undefined}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-2 space-y-1">
                      {buildCategories.map((item) => (
                        <BuildCategoryRow key={item.label} label={item.label} count={item.count} />
                      ))}
                    </div>
                  )}
                </ScrollArea>
                <div className="p-3 border-t border-zinc-800 bg-zinc-900/40">
                  <div className="text-xs text-zinc-500 mb-2">Design checks</div>
                  <div className="space-y-1.5 text-xs">
                    <CheckRow ok label="No floating nets" />
                    <CheckRow ok label="Supply rails connected" />
                    <CheckRow label="BOM not finalized" />
                  </div>
                </div>
              </>
            )}
          </aside>
        )}

        {/* Left panel drag handle */}
        {leftPanel !== null && (
          <div
            onMouseDown={(e) => startDrag("left", e)}
            className="sirkit-chat-resizer w-1 shrink-0 relative flex items-center justify-center cursor-col-resize group bg-zinc-800 hover:bg-teal-500/60 transition-colors"
          >
            <div className="absolute flex flex-col items-center gap-0.5 pointer-events-none">
              <ChevronLeft  className="size-2.5 text-zinc-600 group-hover:text-teal-300 transition-colors" />
              <ChevronRight className="size-2.5 text-zinc-600 group-hover:text-teal-300 transition-colors" />
            </div>
          </div>
        )}

        {/* Main Content */}
        {!chatFullscreen && (
          <main className="flex-1 flex flex-col min-w-0">
            <div className="h-10 border-b border-zinc-800 flex items-center px-2 gap-1 shrink-0" data-testid="workspace-tabs" data-view={JSON.stringify(workspaceView.view)} data-view-revision={workspaceView.viewRevision}>
              <ViewTab icon={Cable}        label="Schematic" active={view === "schematic"} onClick={() => workspaceView.open("schematic")} />
              <ViewTab icon={CircuitBoard} label="PCB"       active={view === "pcb"}       onClick={() => workspaceView.open("pcb")} />
              <ViewTab icon={Box}          label="3D"        active={view === "3d"}        onClick={() => workspaceView.open("3d")} />
              <ViewTab icon={Receipt}      label="BOM"       active={view === "bom"}       onClick={() => workspaceView.open("bom")} />
              <ViewTab icon={Activity}     label="SPICE"     active={view === "sim"}       onClick={() => workspaceView.open("sim")} />
            </div>

            <div className="flex-1 min-h-0 relative">
              {view === "schematic" ? (
                <>
                  <SchematicEditor
                    tool={tool} setTool={setTool}
                    components={components}
                    wires={wires}
                    selectedId={selectedId} setSelectedId={setSelectedId}
                    wireDraftStart={wireDraftStart} setWireDraftStart={setWireDraftStart}
                    placementRotation={placementRotation}
                    kicadComponents={kicadComponents}
                    selectedKicadId={selectedKicadId} setSelectedKicadId={setSelectedKicadId}
                    placementPartId={placementPartId}
                    netLabels={netLabels}
                    pendingNetLabel={pendingNetLabel} setPendingNetLabel={setPendingNetLabel}
                    pageSize={pageSize} setPageSize={changeSheetSize}
                    onDeleteComponent={(family, componentId) => void deleteComponentCanonical(family, componentId)}
                    graph={schematicGraphApi}
                    viewScope={{ projectId: project?.id ?? "local", branchId: "main" }}
                    viewSessionBridge={viewSessionBridgeRef.current!} // [B17-F]
                  />
                  {/* Empty state overlay */}
                  {components.length === 0 && wires.length === 0 && kicadComponents.length === 0 && netLabels.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none select-none">
                      <Sparkles className="size-8 text-zinc-700" />
                      <p className="text-zinc-400 text-sm">Empty schematic</p>
                      <p className="text-zinc-500 text-xs text-center max-w-xs">
                        Describe a circuit above, or pick a tool from the toolbar to place components manually.
                      </p>
                    </div>
                  )}
                  {/* B06: panel edits are canonical schematic commands — no
                      direct-state fallback. Rejections surface as toasts and
                      change nothing. */}
                  {selectedComp && (
                    <PropertiesPanel
                      comp={selectedComp}
                      onValueChange={(v) =>
                        setComponentPropertiesCanonical("theory", selectedComp.id, { value: v }, `Changed ${schDisplayRef(selectedComp)} value to ${v}`)
                      }
                      onRotationChange={(r) =>
                        rotateComponentCanonical("theory", selectedComp.id, `Rotated ${schDisplayRef(selectedComp)}`, r)
                      }
                      onDelete={() => void deleteComponentCanonical("theory", selectedComp.id)}
                      onReferenceChange={(v) =>
                        setComponentPropertiesCanonical("theory", selectedComp.id, { refDes: v }, `Renamed ${schDisplayRef(selectedComp)} to ${v}`)
                      }
                    />
                  )}
                  {selectedKicad && (
                    <KicadPropertiesPanel
                      instance={selectedKicad}
                      onRefDesChange={(v) =>
                        setComponentPropertiesCanonical("kicad", selectedKicad.id, { refDes: v }, `Renamed ${selectedKicad.refDes} to ${v}`)
                      }
                      onValueChange={(v) =>
                        setComponentPropertiesCanonical("kicad", selectedKicad.id, { value: v }, `Changed ${selectedKicad.refDes} value to ${v}`)
                      }
                      onRotate={() =>
                        rotateComponentCanonical("kicad", selectedKicad.id, `Rotated ${selectedKicad.refDes}`)
                      }
                      onDelete={() => void deleteComponentCanonical("kicad", selectedKicad.id)}
                      onReplace={() => { setMode("build"); setLeftPanel("library"); }}
                    />
                  )}
                </>
              ) : view === "sim" ? (
                <SpiceStudio
                  key={project?.id ?? "unloaded"}
                  schematic={{ ...authoritativeSchematic, pageSize: authoritativeSchematic.pageSize ?? pageSize }}
                  aiOwnership={captureAiRequestOwnership}
                  projectScope={project ? { tenantId: "local", projectId: project.id, branchId: "main" } : null} // [B16.0.2 §B] the ACTIVE project identity (selector only)
                  legacyPanel={(
                    <SimView
                      components={components}
                      wires={wires}
                      netLabels={netLabels}
                      simResult={simResult}
                      simLoading={simLoading}
                      simError={simError}
                      panes={panes}
                      setPanes={setPanes}
                      activePaneId={activePaneId}
                      setActivePaneId={setActivePaneId}
                      onRunSim={handleRunSim}
                      simMode={simMode}
                      setSimMode={setSimMode}
                      gesture={schematicGraphApi}
                      chartPanelOpen={chartPanelOpen}
                      setChartPanelOpen={setChartPanelOpen}
                      analysisConfig={analysisConfig}
                      setAnalysisConfig={setAnalysisConfig}
                    />
                  )}
                />
              ) : view === "bom" ? (
                <BomView
                  key={project?.id ?? "unloaded"}
                  state={authoritativeSchematic}
                  projectScope={project ? { tenantId: "local", projectId: project.id, branchId: "main" } : null} // [B16.0.2 §B] the ACTIVE project identity (selector only — never a content hash)
                  onSwapPart={handleSwapPart}
                />
              ) : view !== "pcb" ? (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm select-none">
                  {view === "3d"        && "3D view"}
                </div>
              ) : null}
              {/* R06: the PCB editor stays MOUNTED once opened — unmounting on
                  tab switch destroyed the board state and its undo history.
                  While hidden it is display:none and its shortcuts are gated
                  by `active`.
                  B07.5 (audit) — keyed by PROJECT: the editor captures its
                  project scope, sync identity, and checkpoint target once at
                  mount (init.scope), so surviving a project switch left it
                  writing board checkpoints and working copies under the OLD
                  project id. A switch now remounts it with the new project's
                  identity (tab switches within a project keep the mount, so
                  board state and undo history still survive tab changes). */}
              {(pcbMounted || view === "pcb") && (
                <div className={view === "pcb" ? "absolute inset-0" : "hidden"}>
                  <PcbEditor
                    key={project?.id ?? "unloaded"}
                    schematic={authoritativeSchematic}
                    active={view === "pcb"}
                    hydrateToken={pcbHydrateToken}
                    gateSchematicSync={() => schematicConsumerGate("pcb-sync")}
                    aiOwnership={captureAiRequestOwnership}
                    editorContextBridge={editorContextBridgeRef.current!} // B10
                    pcbProposalIntake={pendingPcbProposal} // B15.3 — display only; approval lives inside PcbEditor
                    onPcbProposalSettled={() => setPendingPcbProposal(null)}
                    currentInterlock={() => projectTransitionRef.current?.currentInterlock() ?? null}
                    operationTimeline={projectTimeline} // [B17-E]
                    viewSessionBridge={viewSessionBridgeRef.current!} // [B17-F]
                    layoutCandidateIntake={pendingLayoutCandidate} // [B17-F] — display only; apply lives inside PcbEditor
                    onLayoutCandidateSettled={() => setPendingLayoutCandidate(null)}
                    executionGrantIntake={pendingExecutionGrant} // [B18-B] — display only; the granted-execution ritual lives inside PcbEditor
                    onExecutionGrantSettled={(grantId, outcome, detail) => {
                      setPendingExecutionGrant((current) => (current && current.grant.grantId === grantId ? null : current));
                      // [B18-D I6] the editor's outcome updates the grant's entry (display only).
                      const entry = executionEntriesRef.current.get(grantId);
                      if (!entry) return;
                      if (detail) upsertExecutionEntry(entryEditorOutcome(entry, detail));
                      else if (outcome === "cancelled") upsertExecutionEntry(entryCancelled(entry));
                      else if (outcome === "retired") upsertExecutionEntry(entrySuperseded(entry));
                      else if (outcome === "failed") upsertExecutionEntry(entryEditorOutcome(entry, { ok: false, code: "session-superseded", changed: false }));
                    }}
                    onExecutionGrantProgress={(grantId) => { const entry = executionEntriesRef.current.get(grantId); if (entry) upsertExecutionEntry(entryExecuting(entry)); }}
                    onExecutionGrantAttemptRefused={(grantId, refusal) => { /* [B18-D review] the card stays; the entry says the attempt changed nothing */ const entry = executionEntriesRef.current.get(grantId); if (entry) upsertExecutionEntry(entryAttemptRefused(entry, refusal)); }}
                    onExecutionRecovery={(results) => { for (const result of results) { const entry = executionEntriesRef.current.get(result.grantId); if (entry && result.action !== "left-in-flight") upsertExecutionEntry(entryRecovery(entry, result.action)); } }}
                  />
                </div>
              )}
            </div>
          </main>
        )}

        {/* Drag handle between main and chat */}
        {chatOpen && !chatFullscreen && (
          <div
            onMouseDown={(e) => startDrag("right", e)}
            className="w-1 shrink-0 relative flex items-center justify-center cursor-col-resize group bg-zinc-800 hover:bg-teal-500/60 transition-colors"
          >
            <div className="absolute flex flex-col items-center gap-0.5 pointer-events-none">
              <ChevronLeft  className="size-2.5 text-zinc-600 group-hover:text-teal-300 transition-colors" />
              <ChevronRight className="size-2.5 text-zinc-600 group-hover:text-teal-300 transition-colors" />
            </div>
          </div>
        )}

        {/* Confirmation dialog for replacing existing schematic */}
        <Dialog
          open={pendingReplace !== null}
          onOpenChange={(open) => {
            if (!open) {
              if (pendingReplace?.logId) finishActivityLog(pendingReplace.logId, "Replacement discarded");
              setPendingReplace(null);
            }
          }}
        >
          <DialogContent data-testid="schematic-proposal-review">
            <DialogHeader>
              <DialogTitle>{pendingProposalSummary?.headline ?? "Apply the generated schematic?"}</DialogTitle>
            </DialogHeader>
            {/* [B16.1C §F] the approval names exactly what will change. */}
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-400" data-testid="schematic-proposal-summary">
              {(pendingProposalSummary?.details ?? []).map((line) => <li key={line}>{line}</li>)}
            </ul>
            {pendingReplace?.explanation && <p className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-zinc-500">{pendingReplace.explanation}</p>}
            {pendingReplace?.validationNote && <p className="text-xs text-amber-300" data-testid="schematic-proposal-validation">{pendingReplace.validationNote}</p>}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  if (pendingReplace?.logId) finishActivityLog(pendingReplace.logId, "Replacement discarded");
                  setPendingReplace(null);
                }}
              >
                Cancel
              </Button>
              <Button data-testid="schematic-proposal-approve" onClick={() => {
                if (pendingReplace) {
                  const pending = pendingReplace;
                  setPendingReplace(null);
                  void applySchematic(pending.state, pending.explanation, pending.prompt, {
                    promptAlreadyLogged: pending.promptAlreadyLogged,
                    pin: pending.pin,
                    skipAutoRun: pending.skipAutoRun,
                  }).then((adopted) => {
                    if (pending.logId) {
                      if (adopted) finishActivityLog(pending.logId, "Applied replacement to canvas");
                      else failActivityLog(pending.logId, "Replacement not applied (stale or rejected)");
                    }
                  });
                }
              }}>{pendingProposalSummary?.replaces ? "Replace" : "Apply"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <ReplacementReviewDialog
          proposal={pendingReplacement}
          busy={replacementApplyBusy}
          componentLabel={pendingReplacement ? (kicadComponents.find((instance) => instance.id === pendingReplacement.componentInstanceId)?.refDes ?? null) : null}
          currentPartLabel={pendingReplacement?.expectedCurrentPartId ?? null}
          onApply={() => void applyReplacementProposal()}
          onCancel={cancelReplacementProposal}
        />
        {replacementReceipt && (
          <div className="fixed bottom-28 right-4 z-50 max-w-xs rounded border border-teal-800/60 bg-zinc-900/95 px-3 py-2 text-[11px] text-teal-300 shadow-lg">
            <div className="font-medium text-teal-200">Exact replacement applied &amp; verified</div>
            <div className="mt-0.5 text-zinc-400">
              {replacementReceipt.sourcePartId} → {replacementReceipt.target.partId} · transaction {replacementReceipt.transactionId.slice(0, 12)}… · undoable
            </div>
            <button className="mt-1 text-zinc-500 hover:text-zinc-300" onClick={() => setReplacementReceipt(null)}>Dismiss</button>
          </div>
        )}

        {/* B06.1: sealed tier-1 proposal review — the ONLY path from provider
            output to schematic mutation. Shows the exact operations and
            destructive impacts; nothing executes without the explicit apply. */}
        {/* B12: verified-commit confirmation, driven by the receipt — success
            is truthful because it exists only after postcondition verification. */}
        {tier1Receipt && (
          <div className="fixed bottom-16 right-4 z-50 max-w-xs rounded border border-teal-800/60 bg-zinc-900/95 px-3 py-2 text-[11px] text-teal-300 shadow-lg">
            <div className="font-medium text-teal-200">Approved edit applied &amp; verified</div>
            <div className="mt-0.5 text-zinc-400">
              transaction {tier1Receipt.transactionId.slice(0, 12)}… · {tier1Receipt.operationCount} operation(s)
              {tier1Receipt.destructive ? " · destructive" : ""} · undoable
            </div>
            <button className="mt-1 text-zinc-500 hover:text-zinc-300" onClick={() => setTier1Receipt(null)}>Dismiss</button>
          </div>
        )}
        <Dialog
          open={pendingTier1 !== null}
          onOpenChange={(open) => { if (!open && !tier1ApplyBusy) cancelTier1Proposal(); }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>AI edit proposal — review before applying</DialogTitle>
            </DialogHeader>
            {pendingTier1 && (
              <div className="space-y-3 text-sm">
                <p className="text-zinc-400 text-xs">
                  Proposed by {pendingTier1.provenance.provider} · proposal {pendingTier1.proposalId.slice(0, 18)}… ·
                  expires {new Date(pendingTier1.expiresAt).toLocaleTimeString()}. Nothing has been changed yet;
                  applying executes exactly the operations below as one atomic transaction.
                </p>
                {pendingTier1.provenance.note && (
                  <p className="text-zinc-400 text-xs italic">{pendingTier1.provenance.note}</p>
                )}
                <div className="max-h-56 overflow-y-auto rounded border border-zinc-800 divide-y divide-zinc-800">
                  {pendingTier1.impacts.propertyEdits.map((edit, index) => (
                    <div key={`prop-${index}`} className="px-2 py-1.5 text-[12px] text-zinc-300">
                      <span className="text-teal-400">Edit</span> {edit.targetLabel}:{" "}
                      {edit.patch.value !== undefined && <>value → “{edit.patch.value}”</>}
                      {edit.patch.refDes !== undefined && <>reference designator → “{edit.patch.refDes}”</>}
                    </div>
                  ))}
                  {pendingTier1.impacts.deletes.map((impact, index) => (
                    <div key={`del-${index}`} className="px-2 py-1.5 text-[12px] text-zinc-300">
                      <span className="text-red-400">Delete</span> {impact.componentLabel}
                      {impact.removeWireIds.length > 0 && <> · removes {impact.removeWireIds.length} attached wire{impact.removeWireIds.length === 1 ? "" : "s"}</>}
                      {impact.removeNetLabelIds.length > 0 && <> · removes label{impact.removeNetLabelIds.length === 1 ? "" : "s"} {impact.removedLabelNames.join(", ")}</>}
                      <div className="text-zinc-500 text-[11px] mt-0.5">{impact.downstream.pcbSync}</div>
                    </div>
                  ))}
                </div>
                {pendingTier1.impacts.destructive && (
                  <p className="text-red-400/90 text-xs">This proposal deletes components — the deletions are undoable, and derived outputs (ERC, BOM, PCB sync) will recompute.</p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={cancelTier1Proposal} disabled={tier1ApplyBusy}>Cancel — change nothing</Button>
              <Button
                variant={pendingTier1?.impacts.destructive ? "destructive" : "default"}
                onClick={() => void applyTier1Proposal()}
                disabled={tier1ApplyBusy}
              >
                {tier1ApplyBusy ? "Applying…" : "Apply exact proposal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* B12.5 §C: blocking activation recovery. A commit-phase
            activation failure (or unavailable project storage at
            bootstrap) means the workspace cannot claim a consistent
            installed project — this modal is NOT dismissible and neither
            project is reported installed. Reload recovers from durable
            state; committed work is preserved. */}
        <Dialog open={activationRecovery !== null} onOpenChange={() => { /* never dismissible — blocking recovery */ }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Project activation needs recovery</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-zinc-400">{activationRecovery}</p>
            <p className="text-sm text-zinc-400">
              The switch stopped before either project could be truthfully reported as installed.
              Reload the workspace to recover from durable state — committed work is preserved.
            </p>
            <DialogFooter>
              <Button onClick={() => window.location.reload()}>Reload workspace</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* B06.2: explicit schematic-history recovery. While pending, the
            session is `conflicted` and canonical edits are refused with a
            truthful message. Neither side is overwritten automatically. */}
        <Dialog
          open={schematicRecovery !== null}
          onOpenChange={(open) => {
            if (open || !schematicRecovery) return;
            // B07.2 — an invalid projection with no valid fallback is a
            // PERSISTENT blocking state: it cannot be dismissed away.
            if (schematicRecovery.kind === "invalid-projection") {
              showToast("The schematic failed validation and cannot be edited until repaired — this recovery notice stays until then.");
              return;
            }
            setSchematicRecovery(null);
            showToast("Recovery postponed — canonical schematic editing stays disabled. Reload the project to choose again.");
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {schematicRecovery?.kind === "corrupt-history"
                  ? "Schematic history needs recovery"
                  : schematicRecovery?.kind === "invalid-projection"
                    ? "Schematic failed validation"
                    : "Schematic history conflict"}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-zinc-400">{schematicRecovery?.detail}</p>
            {schematicRecovery?.kind === "invalid-projection" ? (
              <>
                {(schematicRecovery.issues?.length ?? 0) > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded border border-red-900/50 bg-red-950/20 px-2 py-1.5">
                    {schematicRecovery.issues!.slice(0, 12).map((issue, index) => (
                      <div key={index} className="text-[11px] text-red-300/90 font-mono truncate" title={issue}>{issue}</div>
                    ))}
                    {(schematicRecovery.issues!.length > 12) && (
                      <div className="text-[11px] text-red-400/70">…and {schematicRecovery.issues!.length - 12} more issue(s)</div>
                    )}
                  </div>
                )}
                <p className="text-xs text-red-400/90">
                  This schematic cannot be edited, exported, simulated, synchronized to a PCB, autosaved, or released
                  until the data is repaired. No valid canonical history exists to fall back to. Nothing has been
                  changed or deleted — the stored project is preserved exactly as it was. You can download a raw
                  backup below; reopening the project will show this same notice until the data is repaired.
                </p>
              </>
            ) : schematicRecovery?.kind === "corrupt-history" ? (
              <p className="text-xs text-red-400/90">
                Starting fresh supersedes the old canonical history. The stored (corrupt) history will be preserved in
                quarantine for recovery before anything replaces it.
              </p>
            ) : (
              <p className="text-xs text-zinc-500">
                Whichever side you keep, the other is preserved (quarantined history or a saved local copy) — nothing is
                silently discarded.
              </p>
            )}
            {schematicRecovery?.kind === "projection-conflict" && schematicRecovery.reason === "invalid-projection-identity" && (
              <p className="text-xs text-red-400/90">
                Your locally saved schematic failed identity validation, so it cannot be kept — only the intact
                canonical history can be adopted. The invalid local copy is preserved and can be downloaded below.
              </p>
            )}
            <DialogFooter>
              {/* B07.5 — decision buttons are DISABLED while a recovery
                  decision is in flight: one owned decision at a time (the
                  adapter also refuses duplicate submissions structurally). */}
              {schematicRecovery?.kind === "projection-conflict" ? (
                <>
                  <Button variant="ghost" onClick={downloadRecoveryBackup}>Download local copy (JSON)</Button>
                  {schematicRecovery.reason !== "invalid-projection-identity" && (
                    <Button variant="ghost" disabled={recoveryDecisionBusy} onClick={resolveRecoveryKeepLocal}>Keep my local schematic</Button>
                  )}
                  <Button disabled={recoveryDecisionBusy} onClick={resolveRecoveryAdoptCanonical}>Use canonical history</Button>
                </>
              ) : schematicRecovery?.kind === "invalid-projection" ? (
                <Button variant="ghost" onClick={downloadRecoveryBackup}>Download raw backup (JSON)</Button>
              ) : (
                <Button variant="destructive" disabled={recoveryDecisionBusy} onClick={resolveRecoveryStartFresh}>Start fresh (old history preserved)</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* R06: durable revision history / checkpoint restore */}
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Revision history</DialogTitle>
            </DialogHeader>
            {schHistoryView.entries.length > 1 && (
              <div className="mb-2">
                <div className="text-xs text-zinc-500 mb-1">This session (undo/redo)</div>
                <div className="max-h-28 overflow-y-auto rounded border border-zinc-800 px-2 py-1 space-y-0.5">
                  {[...schHistoryView.entries].reverse().map((entry, index) => (
                    <div key={`${entry.at}-${index}`} className="text-[11px] text-zinc-400 truncate">
                      {entry.label} <span className="text-zinc-600">· {new Date(entry.at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mb-2" data-testid="project-timeline">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-zinc-500">Project timeline (schematic + PCB, this session)</div>
                <Button size="sm" variant="secondary" data-testid="project-timeline-undo" onClick={() => void undoLatestProjectOperation()}>Undo latest</Button>
              </div>
              {projectTimelineNotice && <p data-testid="project-timeline-notice" className="text-[11px] text-amber-300 mb-1">{projectTimelineNotice}</p>}
              <div className="max-h-28 overflow-y-auto rounded border border-zinc-800 px-2 py-1 space-y-0.5">
                {projectTimelineEntries.length === 0 && <div className="text-[11px] text-zinc-600">No operation recorded yet this session.</div>}
                {[...projectTimelineEntries].reverse().slice(0, 40).map((operation) => (
                  <div key={operation.seq} className="text-[11px] text-zinc-400 truncate" data-testid="project-timeline-entry" data-store={operation.store} data-kind={operation.kind}>
                    <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] uppercase text-zinc-300">{operation.store}</span> {operation.kind !== "commit" ? `${operation.kind}: ` : ""}{operation.label} <span className="text-zinc-600">· {new Date(operation.at).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-zinc-600 mt-1">Undo latest runs the owning editor&apos;s own undo; it refuses when that history moved on. Nothing is undone across both stores at once.</p>
            </div>
            <div className="text-xs text-zinc-500 mb-1">Durable checkpoints</div>
            <div className="max-h-80 overflow-y-auto space-y-1">
              {checkpoints.length === 0 && (
                <p className="text-sm text-zinc-500">No checkpoints yet. Checkpoints are recorded when a schematic is generated, footprints are placed, the board is routed, or a release is produced.</p>
              )}
              {[...checkpoints].reverse().map((checkpoint) => (
                <div key={checkpoint.id} className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-200 truncate">{checkpoint.label}</div>
                    <div className="text-[11px] text-zinc-500">
                      #{checkpoint.seq} · {new Date(checkpoint.at).toLocaleString()}
                      {checkpoint.board ? " · includes board" : ""}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => restoreCheckpoint(checkpoint)}>
                    Restore
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500">
              Restoring applies the checkpoint as a new undoable operation — nothing is deleted.
            </p>
          </DialogContent>
        </Dialog>

        {/* Right Chat Panel */}
        {chatOpen && (
          <aside
            className="sirkit-chat-panel border-l border-zinc-800 bg-zinc-950 z-30 shrink-0 flex flex-col min-h-0"
            style={{ width: chatFullscreen ? undefined : chatWidth, flex: chatFullscreen ? "1 1 0" : undefined }}
          >
            <div className="border-b border-zinc-800 px-3 py-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-300 font-medium flex-1">AI Chat</span>
                <button
                  onClick={() => setChatFullscreen((f) => !f)}
                  title={chatFullscreen ? "Restore" : "Maximize"}
                  className="text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  {chatFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </button>
              </div>
              <div className="mt-2 flex items-end gap-2 flex-wrap">
                <label className="flex flex-col gap-1 min-w-28">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">AI Brain</span>
                  <select
                    aria-label="AI Brain"
                    value={aiBrain}
                    onChange={(event) => selectAiBrain(event.target.value as LLMProviderId)}
                    className="h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 outline-none focus:border-teal-500"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </label>
                <div className="pb-0.5 text-[10px] leading-4 text-zinc-500">
                  <div>Brain: <span className="text-teal-300">{aiBrain === "openai" ? "OpenAI" : "Anthropic"}</span></div>
                  <div>Model: <span className="text-zinc-300">{aiRuntime?.providers[aiBrain].label ?? "Loading…"}</span></div>
                  {aiBrain === "openai" && aiRuntime?.providers.openai.contextWindowTokens ? (
                    <div title={`${aiRuntime.providers.openai.contextWindowTokens.toLocaleString()} token context; ${aiRuntime.providers.openai.maxOutputTokens?.toLocaleString() ?? "provider-defined"} maximum output`}>
                      Context: <span className="text-zinc-300">{(aiRuntime.providers.openai.contextWindowTokens / 1_000_000).toFixed(2)}M</span>
                      {" · "}App cap: <span className="text-zinc-300">none</span>
                    </div>
                  ) : null}
                  <div>Embeddings: <span className="text-zinc-300">OpenAI</span></div>
                </div>
                {/* [B18-D I11] the project's agent autonomy: shown to every member; a project administrator may change it */}
                <AutonomyModeControl key={project?.id ?? "no-project"} scope={project ? { tenantId: "local", projectId: project.id, branchId: "main" } : null} />
              </div>
              {/* [B18-D review] §1 item 3: the static Tier 3 line */}
              <p className="mt-1.5 text-[10px] leading-4 text-zinc-500" data-testid="chat-tier3-line">Release, qualification and ordering are never done by the assistant — use the release workflow.</p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-3 py-4 space-y-3">
                {messages.length === 0 && (
                  <p className="text-xs text-zinc-600 text-center pt-6">
                    Describe a circuit to get started.
                  </p>
                )}
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} undoStates={executionUndoStates} onUndoExecution={undoAiChange} />
                ))}
                <div ref={chatEndRef} />
              </div>
            </div>

            {genError && (
              <div className="px-3 py-1.5 text-xs text-red-400 border-t border-zinc-800 shrink-0">
                {genError}
              </div>
            )}
            {aiProviderFailure && (
              <div role="alert" className="mx-3 mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs shrink-0">
                <div className="font-medium text-amber-200">
                  {aiProviderFailure.provider === "openai" ? "OpenAI" : "Anthropic"} is currently unavailable.
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!lastAiRetryRef.current}
                    onClick={() => {
                      setAiProviderFailure(null);
                      lastAiRetryRef.current?.();
                    }}
                  >
                    Retry
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      // B09.2 — production-owned: the alternative provider is
                      // SELECTED before the new run starts (run-consumer.ts).
                      performProviderSwitch(aiProviderFailure.provider, {
                        selectProvider: selectAiBrain,
                        startNewRun: lastAiRetryRef.current,
                      });
                    }}
                  >
                    Use {aiProviderFailure.provider === "anthropic" ? "OpenAI" : "Anthropic"} instead
                  </Button>
                </div>
              </div>
            )}
            <div className="border-t border-zinc-800 p-3">
              {pendingSuggestions !== null && pendingSuggestions.items.length > 0 && (
                <div className="mb-3 rounded-lg border border-teal-500/25 bg-teal-500/5 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Sparkles className="size-3.5 text-teal-300 shrink-0" />
                    <button
                      type="button"
                      className="flex items-center gap-1 min-w-0 flex-1 text-left"
                      onClick={() => setSuggestionsMinimized((m) => !m)}
                      title={suggestionsMinimized ? "Expand suggestions" : "Minimise suggestions"}
                    >
                      {suggestionsMinimized
                        ? <ChevronRight className="size-3.5 text-zinc-500 shrink-0" />
                        : <ChevronDown className="size-3.5 text-zinc-500 shrink-0" />}
                      <span className="text-xs font-medium text-zinc-200 truncate">
                        {pendingSuggestions.items.length} suggestion{pendingSuggestions.items.length === 1 ? "" : "s"} ready
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Apply bounded support-part fixes via a validated edit"
                      disabled={isEditing || isGenerating || loading || isSecondOpinion || isReviewing || isTidying}
                      onClick={handleApplySuggestions}
                    >
                      <Check className="size-3.5 mr-1" />
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Ignore these suggestions"
                      disabled={isEditing}
                      onClick={() => {
                        setPendingSuggestions(null);
                        setSuggestionsMinimized(false);
                      }}
                    >
                      <X className="size-3.5 mr-1" />
                      Ignore
                    </Button>
                  </div>
                  {!suggestionsMinimized && (
                    <div className="px-3 pb-3 space-y-2">
                      <div className="text-[11px] text-zinc-500">
                        Bounded support fixes only; controllers and main ICs are preserved.
                      </div>
                      <div className="space-y-1.5">
                        {pendingSuggestions.items.slice(0, 3).map((s, idx) => (
                          <div key={`${s.source}-${s.title}-${idx}`} className="text-xs text-zinc-300 leading-relaxed">
                            <span className="text-zinc-500">{s.source === "review" ? "Review" : "Second opinion"} · </span>
                            <span className="font-medium text-zinc-200">{s.title}</span>
                            {s.refs && s.refs.length > 0 && (
                              <span className="text-zinc-500"> ({s.refs.join(", ")})</span>
                            )}
                            <span className="text-zinc-400"> — {s.detail}</span>
                          </div>
                        ))}
                        {pendingSuggestions.items.length > 3 && (
                          <div className="text-[11px] text-zinc-500">
                            +{pendingSuggestions.items.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <Textarea
                data-testid="prompt-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleComposerSubmit(); }
                }}
                className="min-h-20 resize-none border-zinc-800 bg-zinc-900/60 text-sm"
                placeholder={mode === "build"
                  ? "Type a question, edit (e.g. 'set R1 to 4.7k'), or describe a circuit to generate"
                  : "Type a question, edit (e.g. 'set R1 to 4.7k'), or describe a circuit to generate"}
                disabled={loading || isGenerating || isEditing}
              />
              {/* [B18-D I1] where Enter sends this message, shown before sending; the override sends a suggested schematic
                  edit or generation to the assistant instead (and back). Routing only: nothing here makes a change. */}
              {composerText && (
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-zinc-500">
                  <span data-testid="composer-route" data-route={composerAction} title={composerRouting.reason}>
                    Sirkit will: {COMPOSER_ROUTE_LABELS[composerAction]}{composerRouteOverride ? " (your choice)" : ""}
                    {/* [B18-D review] the reason is readable without the tooltip */}
                    <span className="sr-only"> — {composerRouting.reason}</span>
                  </span>
                  {composerRouting.route !== "ask" && (
                    <button type="button" data-testid="composer-route-override" onClick={overrideComposerRoute} className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200">
                      {composerRouteOverride ? `${COMPOSER_ROUTE_LABELS[composerRouting.route].replace(/^./, (c) => c.toUpperCase())} instead` : "Ask the assistant instead"}
                    </button>
                  )}
                  {composerRouting.hints.includes("tier3-release") && (
                    <span data-testid="composer-tier3-hint" className="text-amber-400/90">Release, qualification and ordering are never done by the assistant — use the release workflow.</span>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between mt-2 gap-2">
                <div className="text-xs text-zinc-500">
                  {isTidying
                    ? "Tidying layout…"
                    : isReviewing
                      ? "Reviewing design…"
                      : isSecondOpinion
                        ? "Consulting SchGen…"
                        : "Enter to submit - Shift+Enter newline"}
                </div>
                <div className="flex items-center flex-wrap justify-end gap-2">
                  {loading && (
                    <Button size="sm" variant="outline" data-testid="chat-stop" title="Stop the assistant's run" onClick={stopChatRun}>
                      Stop
                    </Button>
                  )}
                  {showComposerButton && (
                    <Button
                      size="sm"
                      title={
                        composerAction === "generate"
                          ? "Generate a schematic from this prompt"
                          : "Apply this as an edit to the current schematic"
                      }
                      disabled={composerDisabled}
                      onClick={handleComposerSubmit}
                    >
                      {(isGenerating || isEditing) && <Loader2 className="size-3.5 mr-1 animate-spin" />}
                      {composerLabel}
                    </Button>
                  )}
                  {/* Overflow: manual re-runs of the automatic passes + the
                      expensive SchGen check. Tidy/review run by themselves after
                      every generate/edit, so they no longer need primary buttons. */}
                  <div className="relative">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="More checks"
                      onClick={() => setMoreMenuOpen((o) => !o)}
                    >
                      ⋯
                    </Button>
                    {moreMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} />
                        <div className="absolute bottom-full right-0 mb-1 z-50 w-56 rounded-md border border-zinc-800 bg-zinc-900 py-1 shadow-lg">
                          <button
                            className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                            disabled={isReviewing || isTidying || isSecondOpinion || loading || isGenerating || isEditing ||
                              (components.length === 0 && kicadComponents.length === 0)}
                            onClick={() => { setMoreMenuOpen(false); handleReview(); }}
                          >
                            Re-run design review
                          </button>
                          <button
                            className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                            disabled={isTidying || isReviewing || isSecondOpinion || loading || isGenerating || isEditing ||
                              kicadComponents.length === 0}
                            onClick={() => { setMoreMenuOpen(false); handleTidyLayout(); }}
                          >
                            Re-tidy layout
                          </button>
                          <button
                            className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                            title="Independent domain model designs the same request and diffs it (slow, ~1–2 min)"
                            disabled={isSecondOpinion || isReviewing || isTidying || loading || isGenerating || isEditing ||
                              kicadComponents.length === 0}
                            onClick={() => { setMoreMenuOpen(false); handleSecondOpinion(); }}
                          >
                            Second opinion (SchGen)
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Transient toast (BOM part swaps, etc.) */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md">
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 shadow-lg"
          >
            <span className="flex-1">{toast}</span>
            <button
              onClick={() => setToast(null)}
              className="text-zinc-500 hover:text-zinc-200 transition-colors"
              title="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Simulation view ──────────────────────────────────────────────────────────

function WaveformChart({
  points, variables, probedSignals, analysisType,
}: {
  points: Record<string, number>[];
  variables: string[];
  probedSignals: Set<string>;
  analysisType: AnalysisType;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 200 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pick the swept (x) variable per analysis type.
  const xVar =
    analysisType === "ac"   ? "frequency"
  : analysisType === "tran" ? "time"
  : analysisType === "dc"   ? variables[0]
  :                            null;
  const logX = analysisType === "ac";

  // Recharts-style: filter signals to ones in the result.
  const probed = [...probedSignals].filter((s) => variables.includes(s));

  const W = size.w, H = size.h;
  const ML = 56, MR = 16, MT = 12, MB = 28;
  const plotW = Math.max(1, W - ML - MR);
  const plotH = Math.max(1, H - MT - MB);

  if (!xVar || probed.length === 0 || points.length === 0) {
    return (
      <div ref={wrapRef} className="w-full h-full flex items-center justify-center text-zinc-600 text-xs select-none px-4 text-center">
        {points.length === 0
          ? "No data — re-run the simulation"
          : "Click a wire or component to probe a signal in this pane"}
      </div>
    );
  }

  // Y axis label depends on AC signal kind.
  let yLabel = "V";
  if (analysisType === "ac") {
    const hasMag   = probed.some((s) => s.endsWith(".mag"));
    const hasPhase = probed.some((s) => s.endsWith(".phase"));
    yLabel = hasMag && !hasPhase ? "Magnitude (dB)"
           : hasPhase && !hasMag ? "Phase (deg)"
           : "Mixed";
  }
  const xLabel =
    analysisType === "ac"   ? "Frequency (Hz)"
  : analysisType === "dc"   ? `Sweep: ${xVar}`
  :                            "Time (s)";

  // X range.
  const xValsAll = points.map((p) => p[xVar] ?? 0);
  let xMin: number, xMax: number;
  if (logX) {
    const pos = xValsAll.filter((v) => v > 0);
    xMin = pos.length ? Math.min(...pos) : 1;
    xMax = pos.length ? Math.max(...pos) : 10;
  } else {
    xMin = Math.min(...xValsAll);
    xMax = Math.max(...xValsAll);
  }
  if (xMin === xMax) { xMin -= 1; xMax += 1; }

  // Y range across all probed signals.
  const allY: number[] = [];
  for (const sig of probed) for (const p of points) {
    const v = p[sig];
    if (typeof v === "number" && isFinite(v)) allY.push(v);
  }
  let yMin = allY.length ? Math.min(...allY) : 0;
  let yMax = allY.length ? Math.max(...allY) : 1;
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.05;
  yMin -= yPad; yMax += yPad;

  // Coord mappers.
  const lMin = logX ? Math.log10(xMin) : xMin;
  const lMax = logX ? Math.log10(xMax) : xMax;
  function px(x: number): number {
    const v = logX ? Math.log10(Math.max(x, 1e-30)) : x;
    return ML + ((v - lMin) / (lMax - lMin || 1)) * plotW;
  }
  function py(y: number): number {
    return MT + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH;
  }

  // Ticks.
  function linspace(a: number, b: number, n: number): number[] {
    return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
  }
  function logDecadeTicks(a: number, b: number): number[] {
    const ticks: number[] = [];
    const start = Math.floor(Math.log10(a));
    const end   = Math.ceil(Math.log10(b));
    for (let e = start; e <= end; e++) {
      const v = Math.pow(10, e);
      if (v >= a / 1.001 && v <= b * 1.001) ticks.push(v);
    }
    return ticks;
  }
  const xTicks = logX ? logDecadeTicks(xMin, xMax) : linspace(xMin, xMax, 5);
  const yTicks = linspace(yMin, yMax, 5);

  // Range-aware tick formatters: pick decimal count from the data domain so
  // adjacent ticks never collapse to the same string (the "12.0, 12.0, 12.0"
  // bug for tight ranges around a non-zero baseline).
  const fmtX = rangeAwareTickFormatter([xMin, xMax]);
  const fmtY = rangeAwareTickFormatter([yMin, yMax]);

  return (
    <div ref={wrapRef} className="w-full h-full">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <rect width={W} height={H} fill="#09090b" />

        {/* y grid + tick labels */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={ML} x2={W - MR} y1={py(t)} y2={py(t)} stroke="#27272a" strokeWidth={0.5} />
            <text x={ML - 6} y={py(t) + 3.5} textAnchor="end" fontSize={10} fontFamily="monospace" fill="#71717a">
              {fmtY(t)}
            </text>

          </g>
        ))}

        {/* x grid + tick labels */}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={px(t)} x2={px(t)} y1={MT} y2={H - MB} stroke="#27272a" strokeWidth={0.5} />
            <text x={px(t)} y={H - MB + 12} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#71717a">
              {fmtX(t)}
            </text>
          </g>
        ))}

        {/* axes */}
        <line x1={ML} y1={MT} x2={ML} y2={H - MB} stroke="#52525b" strokeWidth={1} />
        <line x1={ML} y1={H - MB} x2={W - MR} y2={H - MB} stroke="#52525b" strokeWidth={1} />

        {/* signal paths */}
        {probed.map((sig, si) => {
          const color = PROBE_COLORS[si % PROBE_COLORS.length];
          let d = "";
          let started = false;
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const xv = p[xVar];
            const yv = p[sig];
            if (typeof xv !== "number" || typeof yv !== "number") continue;
            if (logX && xv <= 0) continue;
            const x = px(xv).toFixed(2);
            const y = py(yv).toFixed(2);
            d += `${started ? "L" : "M"}${x},${y}`;
            started = true;
          }
          return <path key={sig} d={d} stroke={color} strokeWidth={1.5} fill="none" />;
        })}

        {/* legend */}
        {probed.map((sig, si) => {
          const color = PROBE_COLORS[si % PROBE_COLORS.length];
          const ly = MT + 14 + si * 14;
          return (
            <g key={`l-${sig}`}>
              <line x1={ML + 8} y1={ly} x2={ML + 24} y2={ly} stroke={color} strokeWidth={2} />
              <text x={ML + 28} y={ly + 3.5} fontSize={10} fontFamily="monospace" fill={color}>
                {sig}
              </text>
            </g>
          );
        })}

        {/* axis labels */}
        <text x={ML + plotW / 2} y={H - 6} textAnchor="middle"
          fontSize={10} fontFamily="monospace" fill="#52525b">
          {xLabel}
        </text>
        <text x={14} y={MT + plotH / 2} textAnchor="middle"
          fontSize={10} fontFamily="monospace" fill="#52525b"
          transform={`rotate(-90, 14, ${MT + plotH / 2})`}>
          {yLabel}
        </text>
      </svg>
    </div>
  );
}

function OpTable({
  points, variables, probedSignals,
}: {
  points: Record<string, number>[];
  variables: string[];
  probedSignals: Set<string>;
}) {
  if (points.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs select-none">
        No data
      </div>
    );
  }
  const row = points[0];
  // Empty pane → show full operating point; otherwise filter to probed.
  const rows = probedSignals.size === 0
    ? variables
    : variables.filter((v) => probedSignals.has(v));

  if (rows.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs select-none px-4 text-center">
        Click a wire or component to probe a value in this pane
      </div>
    );
  }
  return (
    <div className="w-full h-full overflow-auto">
      <table className="w-full text-xs font-mono">
        <thead className="sticky top-0 bg-zinc-900 text-zinc-500 border-b border-zinc-800">
          <tr>
            <th className="text-left  px-3 py-1.5 font-normal">Variable</th>
            <th className="text-right px-3 py-1.5 font-normal">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const cell = row[v];
            return (
              <tr key={v} className="border-b border-zinc-900/60">
                <td className="px-3 py-1 text-zinc-300">{v}</td>
                <td className="px-3 py-1 text-zinc-200 text-right">
                  {typeof cell === "number" ? cell.toExponential(6) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProbeSchematic({
  components,
  wires,
  netLabels,
  probedSignals,
  pinNodes,
  onToggleProbe,
  mode,
  gesture,
}: {
  components: SchComponent[];
  wires: Wire[];
  netLabels: NetLabel[];
  probedSignals: Set<string>;
  pinNodes: Record<string, string>;
  onToggleProbe: (signal: string) => void;
  mode: SimMode;
  /** B07/B07.1: gesture transaction contract — `preview` frames through the
   *  coordinator (this canvas holds NO schematic state setters). */
  gesture: { begin(): boolean; preview(frame: SchematicGraphAfter): void; commit(label: string, finalGraph: SchematicGraphAfter): void };
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan]   = useState<Point>({ x: 80, y: 60 });
  const [zoom, setZoom] = useState(0.9);
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);
  const [hoveredPin,    setHoveredPin]    = useState<string | null>(null);

  const panRef  = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current  = pan;
  zoomRef.current = zoom;

  const componentsRef    = useRef(components);
  const wiresRef         = useRef(wires);
  const netLabelsRef     = useRef(netLabels);
  componentsRef.current  = components;
  wiresRef.current       = wires;
  netLabelsRef.current   = netLabels;

  const isPanning = useRef(false);
  const panStart  = useRef<{ mouse: Point; pan: Point }>({ mouse: { x: 0, y: 0 }, pan: { x: 0, y: 0 } });

  const moveDragRef = useRef<{
    groupCompIds: Set<string>;
    groupWireIds: Set<string>;
    groupLabelIds: Set<string>;
    initComps: Map<string, { x: number; y: number }>;
    initWires: Map<string, Point[]>;
    initLabels: Map<string, Point>;
    startWorld: Point;
    /** B07: latest preview arrays; pointer-up commits them as ONE gesture. */
    preview?: SchematicGraphAfter;
  } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setZoom((z) => {
        const nz = Math.min(4, Math.max(0.2, z * factor));
        setPan((p) => ({ x: mx - (mx - p.x) * (nz / z), y: my - (my - p.y) * (nz / z) }));
        return nz;
      });
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (isPanning.current) {
        setPan({
          x: panStart.current.pan.x + (e.clientX - panStart.current.mouse.x),
          y: panStart.current.pan.y + (e.clientY - panStart.current.mouse.y),
        });
      }
      if (moveDragRef.current) {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const wx = (e.clientX - rect.left  - panRef.current.x) / zoomRef.current;
        const wy = (e.clientY - rect.top   - panRef.current.y) / zoomRef.current;
        const { groupCompIds, groupWireIds, groupLabelIds, initComps, initWires, initLabels, startWorld } = moveDragRef.current;
        const dx = Math.round((wx - startWorld.x) / 10) * 10;
        const dy = Math.round((wy - startWorld.y) / 10) * 10;
        // B07: compute the preview once, render it non-authoritatively, and
        // remember it - pointer-up commits ONE gesture transaction.
        const nextComponents = componentsRef.current.map((c) => {
          const init = initComps.get(c.id);
          return (groupCompIds.has(c.id) && init) ? { ...c, x: init.x + dx, y: init.y + dy } : c;
        });
        const nextWires = wiresRef.current.map((w) => {
          const init = initWires.get(w.id);
          return (groupWireIds.has(w.id) && init) ? { ...w, vertices: init.map((v) => ({ x: v.x + dx, y: v.y + dy })) } : w;
        });
        const nextLabels = netLabelsRef.current.map((l) => {
          const init = initLabels.get(l.id);
          return (groupLabelIds.has(l.id) && init) ? { ...l, position: { x: init.x + dx, y: init.y + dy } } : l;
        });
        moveDragRef.current.preview = { components: nextComponents, wires: nextWires, netLabels: nextLabels };
        gesture.preview(moveDragRef.current.preview);
      }
    }
    function onUp() {
      isPanning.current = false;
      const drag = moveDragRef.current;
      moveDragRef.current = null;
      // B07: the completed move commits ONE canonical gesture transaction.
      // (`gesture` is memo-stable in the page, so the [] effect closure is safe.)
      if (drag?.preview) gesture.commit("Moved component", drag.preview);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [gesture]);

  function onSvgDown(e: React.MouseEvent) {
    if (e.button !== 0 || e.target !== svgRef.current) return;
    isPanning.current = true;
    panStart.current = { mouse: { x: e.clientX, y: e.clientY }, pan: { ...panRef.current } };
  }

  function onCompMoveStart(e: React.MouseEvent, comp: SchComponent) {
    e.stopPropagation();
    if (!svgRef.current) return;
    // B07.1: gesture start — refused while another gesture owns the preview.
    if (!gesture.begin()) return;
    const rect = svgRef.current.getBoundingClientRect();
    const wx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current;
    const wy = (e.clientY - rect.top  - panRef.current.y) / zoomRef.current;
    const group = findConnectedGroup(
      { kind: "component", id: comp.id },
      componentsRef.current,
      wiresRef.current,
      [],
      netLabelsRef.current,
    );
    const initComps = new Map<string, { x: number; y: number }>();
    const initWires = new Map<string, Point[]>();
    const initLabels = new Map<string, Point>();
    for (const id of group.componentIds) {
      const c = componentsRef.current.find((c) => c.id === id);
      if (c) initComps.set(id, { x: c.x, y: c.y });
    }
    for (const id of group.wireIds) {
      const w = wiresRef.current.find((w) => w.id === id);
      if (w) initWires.set(id, w.vertices.map((v) => ({ ...v })));
    }
    for (const id of group.netLabelIds) {
      const l = netLabelsRef.current.find((l) => l.id === id);
      if (l) initLabels.set(id, { ...l.position });
    }
    moveDragRef.current = {
      groupCompIds: group.componentIds,
      groupWireIds: group.wireIds,
      groupLabelIds: group.netLabelIds,
      initComps,
      initWires,
      initLabels,
      startWorld: { x: wx, y: wy },
    };
  }

  function handleBodyClick(e: React.MouseEvent, comp: SchComponent) {
    e.stopPropagation();
    const key = compProbeKey(comp);
    if (key) onToggleProbe(key);
  }

  function handlePinClick(e: React.MouseEvent, comp: SchComponent, off: Point) {
    e.stopPropagation();
    const rot = rotatePoint(off, comp.rotation);
    const nd  = pinNodes[`${Math.round(comp.x + rot.x)},${Math.round(comp.y + rot.y)}`];
    if (nd && nd !== "0") onToggleProbe(`v(${nd.toLowerCase()})`);
  }

  function handleWireClick(e: React.MouseEvent, wire: Wire) {
    e.stopPropagation();
    // Spec: clicking ANY pixel along a wire adds that net's voltage —
    // including ground (v(0) is a flat-zero reference trace).
    for (const v of wire.vertices) {
      const nd = pinNodes[`${Math.round(v.x)},${Math.round(v.y)}`];
      if (nd) { onToggleProbe(`v(${nd.toLowerCase()})`); return; }
    }
  }

  const probeList = [...probedSignals];

  // Probe number badge positions (world coords, computed before render)
  type Marker = { signal: string; x: number; y: number };
  const markers: Marker[] = [];
  const markerSeen = new Set<string>();

  for (const comp of components) {
    const key = compProbeKey(comp);
    if (key && probedSignals.has(key) && !markerSeen.has(key)) {
      markerSeen.add(key);
      const bb = COMP_BBOX[comp.type];
      markers.push({ signal: key, x: comp.x + bb.x + bb.w + 10, y: comp.y + bb.y - 6 });
    }
    for (const [, off] of Object.entries(PROBE_PIN_OFFSETS[comp.type] ?? {})) {
      const rot = rotatePoint(off, comp.rotation);
      const wx  = Math.round(comp.x + rot.x);
      const wy  = Math.round(comp.y + rot.y);
      const nd  = pinNodes[`${wx},${wy}`];
      if (!nd || nd === "0") continue;
      const sig = `v(${nd.toLowerCase()})`;
      if (probedSignals.has(sig) && !markerSeen.has(sig)) {
        markerSeen.add(sig);
        markers.push({ signal: sig, x: wx + 14, y: wy - 14 });
      }
    }
  }
  for (const wire of wires) {
    const mid = wire.vertices[Math.floor(wire.vertices.length / 2)] ?? wire.vertices[0];
    if (!mid) continue;
    for (const v of wire.vertices) {
      const nd = pinNodes[`${Math.round(v.x)},${Math.round(v.y)}`];
      if (!nd || nd === "0") continue;
      const sig = `v(${nd.toLowerCase()})`;
      if (probedSignals.has(sig) && !markerSeen.has(sig)) {
        markerSeen.add(sig);
        markers.push({ signal: sig, x: mid.x + 12, y: mid.y - 12 });
      }
      break;
    }
  }

  // Junction dots
  const ptCount = new Map<string, number>();
  for (const w of wires) {
    for (const p of [w.vertices[0], w.vertices[w.vertices.length - 1]]) {
      if (!p) continue;
      ptCount.set(`${p.x},${p.y}`, (ptCount.get(`${p.x},${p.y}`) ?? 0) + 1);
    }
  }
  const junctions: Point[] = [];
  ptCount.forEach((n, k) => {
    if (n >= 3) { const [x, y] = k.split(",").map(Number); junctions.push({ x, y }); }
  });

  console.log("[ProbeSchematic] render", { mode, componentCount: components.length, wireCount: wires.length });

  return (
    <svg
      ref={svgRef}
      width="100%" height="100%"
      style={{ display: "block", cursor: mode === "move" ? "move" : PROBE_CURSOR }}
      onMouseDown={onSvgDown}
    >
      <defs>
        <pattern
          id="probe-dot-grid"
          x={pan.x % (20 * zoom)} y={pan.y % (20 * zoom)}
          width={20 * zoom} height={20 * zoom}
          patternUnits="userSpaceOnUse"
        >
          <circle cx="0" cy="0" r={Math.max(0.4, zoom * 0.7)} fill="rgba(255,255,255,0.07)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#probe-dot-grid)" />

      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
        {/* Wires */}
        {wires.map((wire) => {
          const pts = wire.vertices.map((v) => `${v.x},${v.y}`).join(" ");
          const isHov = hoveredWireId === wire.id;
          let wSig: string | null = null;
          for (const v of wire.vertices) {
            const nd = pinNodes[`${Math.round(v.x)},${Math.round(v.y)}`];
            if (nd && nd !== "0") { wSig = `v(${nd.toLowerCase()})`; break; }
          }
          const wIdx    = wSig ? probeList.indexOf(wSig) : -1;
          const wProbed = wIdx >= 0;
          const wColor  = wProbed ? PROBE_COLORS[wIdx % PROBE_COLORS.length] : "#a1a1aa";
          return (
            <g key={wire.id}>
              {isHov && (
                <polyline points={pts} fill="none" stroke="rgba(20,184,166,0.35)"
                  strokeWidth={8 / zoom} strokeLinecap="round" strokeLinejoin="round"
                  style={{ pointerEvents: "none" }} />
              )}
              <polyline points={pts} fill="none" stroke={wColor}
                strokeWidth={(wProbed ? 2 : 1) / zoom} strokeLinecap="round" strokeLinejoin="round"
                style={{ pointerEvents: "none" }} />
              <polyline points={pts} fill="none" stroke="transparent"
                strokeWidth={12 / zoom} strokeLinecap="round"
                onMouseEnter={() => { if (mode === "probe") setHoveredWireId(wire.id); }}
                onMouseLeave={() => setHoveredWireId((p) => p === wire.id ? null : p)}
                onMouseDown={(e) => { if (mode === "probe") handleWireClick(e, wire); }} />
            </g>
          );
        })}

        {/* Junction dots */}
        {junctions.map((j, i) => (
          <circle key={i} cx={j.x} cy={j.y} r={2.5 / zoom} fill="#a1a1aa" style={{ pointerEvents: "none" }} />
        ))}

        {/* Net labels (read-only in sim view) */}
        {netLabels.map((label) => (
          <NetLabelGlyph
            key={label.id}
            label={label}
            role={label.kind === "ground" ? "ground" : label.kind === "power" ? "power" : "signal"}
            zoom={zoom}
          />
        ))}

        {/* Components */}
        {components.map((comp) => {
          const compKey    = compProbeKey(comp);
          const compIdx    = compKey ? probeList.indexOf(compKey) : -1;
          const compProbed = compIdx >= 0;
          const compColor  = compProbed ? PROBE_COLORS[compIdx % PROBE_COLORS.length] : null;
          // Ground is now probeable too (toggles v(0)).
          const isBodyHov  = mode === "probe" && hoveredCompId === comp.id;
          const canProbe   = compProbeKey(comp) !== null;
          const bb = COMP_BBOX[comp.type];

          return (
            <g key={comp.id} transform={`translate(${comp.x},${comp.y}) rotate(${comp.rotation})`}>
              {/* Body hover halo */}
              {isBodyHov && (
                <rect x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
                  fill="rgba(20,184,166,0.08)" stroke="#14b8a6" strokeWidth={0.75 / zoom} rx={2}
                  style={{ pointerEvents: "none" }} />
              )}
              {/* Probed body ring */}
              {compProbed && compColor && (
                <rect x={bb.x - 6} y={bb.y - 6} width={bb.w + 12} height={bb.h + 12}
                  fill="none" stroke={compColor} strokeWidth={1.5 / zoom} rx={2}
                  style={{ pointerEvents: "none" }} />
              )}
              {/* Body hit area + shape */}
              <g
                style={{ cursor: mode === "move" ? "grab" : undefined }}
                onMouseEnter={() => { if (mode === "probe" && canProbe) setHoveredCompId(comp.id); }}
                onMouseLeave={() => setHoveredCompId((p) => p === comp.id ? null : p)}
                onMouseDown={
                  mode === "probe" && canProbe ? (e) => handleBodyClick(e, comp)
                  : mode === "move" ? (e) => onCompMoveStart(e, comp)
                  : undefined
                }
              >
                <rect x={bb.x - 4} y={bb.y - 4} width={bb.w + 8} height={bb.h + 8} fill="transparent" />
                {comp.type === "resistor"       && <ResistorSymbol />}
                {comp.type === "capacitor"      && <CapacitorSymbol />}
                {comp.type === "inductor"       && <InductorSymbol />}
                {comp.type === "diode"          && <DiodeSymbol />}
                {comp.type === "voltage-source" && <VoltageSourceSymbol />}
                {comp.type === "current-source" && <CurrentSourceSymbol />}
                {comp.type === "ground"         && <GroundSymbol />}
              </g>
              {/* Value label */}
              {VALUE_LABEL[comp.type] && comp.value && (
                <text x={VALUE_LABEL[comp.type]!.x} y={VALUE_LABEL[comp.type]!.y}
                  textAnchor={VALUE_LABEL[comp.type]!.anchor as "middle" | "start"}
                  fontSize={10} fontFamily="monospace" fill="#71717a"
                  style={{ pointerEvents: "none", userSelect: "none" }}>
                  {comp.value}
                </text>
              )}
              {/* Per-pin hit targets — rendered last so they sit on top of body */}
              {Object.entries(PROBE_PIN_OFFSETS[comp.type] ?? {}).map(([pinName, off]) => {
                const rot    = rotatePoint(off, comp.rotation);
                const nd     = pinNodes[`${Math.round(comp.x + rot.x)},${Math.round(comp.y + rot.y)}`];
                const pinSig = nd && nd !== "0" ? `v(${nd.toLowerCase()})` : null;
                const pinIdx = pinSig ? probeList.indexOf(pinSig) : -1;
                const pinProbed = pinIdx >= 0;
                const pinColor  = pinProbed ? PROBE_COLORS[pinIdx % PROBE_COLORS.length] : null;
                const pinHovKey = `${comp.id}:${pinName}`;
                const isPinHov  = hoveredPin === pinHovKey;
                return (
                  <g key={pinName}>
                    <circle cx={off.x} cy={off.y} r={2}
                      fill={pinProbed ? pinColor! : "#71717a"}
                      style={{ pointerEvents: "none" }} />
                    {isPinHov && (
                      <circle cx={off.x} cy={off.y} r={6 / zoom}
                        fill="none" stroke="#14b8a6" strokeWidth={1.5 / zoom}
                        style={{ pointerEvents: "none" }} />
                    )}
                    {mode === "probe" && pinSig && (
                      <circle cx={off.x} cy={off.y} r={8 / zoom} fill="transparent"
                        onMouseEnter={() => setHoveredPin(pinHovKey)}
                        onMouseLeave={() => setHoveredPin((p) => p === pinHovKey ? null : p)}
                        onMouseDown={(e) => handlePinClick(e, comp, off)} />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Probe number badges in world coords */}
        {markers.map(({ signal, x, y }) => {
          const idx   = probeList.indexOf(signal);
          if (idx < 0) return null;
          const color = PROBE_COLORS[idx % PROBE_COLORS.length];
          const r     = 6 / zoom;
          return (
            <g key={signal} style={{ pointerEvents: "none" }}>
              <circle cx={x} cy={y} r={r} fill={color} />
              <text x={x} y={y + r * 0.38} textAnchor="middle"
                fontSize={r * 1.2} fontFamily="monospace" fill="white">
                {idx + 1}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ─── FloatingPanel ─────────────────────────────────────────────────────────────

type PanelLayout = { x: number; y: number; w: number; h: number };
const PANEL_STORAGE_KEY = "sirkit:simPanel:layout";

function FloatingPanel({
  title,
  containerRef,
  children,
  onClose,
}: {
  title: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const [layout, setLayout] = useState<PanelLayout>(() => {
    try {
      const raw = localStorage.getItem(PANEL_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as PanelLayout;
    } catch { /* ignore */ }
    // Landscape default, docked bottom-left (matches LTspice's waveform pane).
    return { x: 16, y: 16, w: 720, h: 280 };
  });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useLayoutEffect(() => {
    if (localStorage.getItem(PANEL_STORAGE_KEY)) return;
    // The container ref is owned by the parent SimView; in React 19 strict mode
    // its .current can be null when this child effect first runs. Poll across
    // a few rAF ticks until the ref attaches AND the container has a height.
    let applied = false;
    let attempts = 0;
    let raf = 0;
    const tick = () => {
      if (applied) return;
      const el = containerRef.current;
      if (el) {
        const { height } = el.getBoundingClientRect();
        if (height > 0) {
          applied = true;
          setLayout((l) => ({ ...l, y: Math.max(16, height - l.h - 16) }));
          return;
        }
      }
      if (++attempts > 30) return;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [containerRef]);

  function persistLayout(l: PanelLayout) {
    setLayout(l);
    try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(l)); } catch { /* ignore */ }
  }

  const dragRef = useRef<{ startMouse: Point; startLayout: PanelLayout } | null>(null);

  function onTitleBarDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startMouse: { x: e.clientX, y: e.clientY }, startLayout: { ...layoutRef.current } };
    function onMove(mv: MouseEvent) {
      if (!dragRef.current || !containerRef.current) return;
      const { startMouse, startLayout } = dragRef.current;
      const cRect = containerRef.current.getBoundingClientRect();
      const nx = Math.max(0, Math.min(cRect.width  - startLayout.w, startLayout.x + mv.clientX - startMouse.x));
      const ny = Math.max(0, Math.min(cRect.height - startLayout.h, startLayout.y + mv.clientY - startMouse.y));
      persistLayout({ ...layoutRef.current, x: nx, y: ny });
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }

  const resizeRef = useRef<{ startMouse: Point; startLayout: PanelLayout } | null>(null);

  function onResizeDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startMouse: { x: e.clientX, y: e.clientY }, startLayout: { ...layoutRef.current } };
    function onMove(mv: MouseEvent) {
      if (!resizeRef.current) return;
      const { startMouse, startLayout } = resizeRef.current;
      const nw = Math.max(360, startLayout.w + mv.clientX - startMouse.x);
      const nh = Math.max(200, startLayout.h + mv.clientY - startMouse.y);
      persistLayout({ ...layoutRef.current, w: nw, h: nh });
    }
    function onUp() {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }

  return (
    <div
      style={{ position: "absolute", left: layout.x, top: layout.y, width: layout.w, height: layout.h, zIndex: 20 }}
      className="flex flex-col bg-zinc-900/95 border border-zinc-700 rounded-md shadow-xl backdrop-blur-sm overflow-hidden"
    >
      <div
        className="h-8 px-3 flex items-center gap-2 shrink-0 border-b border-zinc-800 cursor-move select-none"
        onMouseDown={onTitleBarDown}
      >
        <span className="text-xs text-zinc-400 font-medium flex-1 truncate">{title}</span>
        <GripVertical className="size-3 text-zinc-600 shrink-0" />
        {onClose && (
          <button
            className="ml-1 flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition"
            onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
            title="Close"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={onResizeDown}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-1 right-1 pointer-events-none">
          <path d="M10 0 L10 10 L0 10" fill="none" stroke="#52525b" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}

// ─── SimView ───────────────────────────────────────────────────────────────────

function SimView({
  components, wires, netLabels, simResult, simLoading, simError,
  panes, setPanes, activePaneId, setActivePaneId,
  onRunSim, simMode, setSimMode,
  chartPanelOpen, setChartPanelOpen,
  analysisConfig, setAnalysisConfig,
  gesture,
}: {
  components: SchComponent[];
  wires: Wire[];
  netLabels: NetLabel[];
  simResult: SimResult | null;
  simLoading: boolean;
  simError: string | null;
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  activePaneId: string | null;
  setActivePaneId: Dispatch<SetStateAction<string | null>>;
  onRunSim: () => void;
  simMode: SimMode;
  setSimMode: (m: SimMode) => void;
  /** B07/B07.1: gesture transaction contract for SPICE-view moves (no
   *  schematic state setters reach this view — structurally enforced). */
  gesture: { begin(): boolean; preview(frame: SchematicGraphAfter): void; commit(label: string, finalGraph: SchematicGraphAfter): void };
  chartPanelOpen: boolean;
  setChartPanelOpen: Dispatch<SetStateAction<boolean>>;
  analysisConfig: AnalysisConfig;
  setAnalysisConfig: Dispatch<SetStateAction<AnalysisConfig>>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Visual probe markers reflect ONLY the active pane.
  const activePane    = panes.find((p) => p.id === activePaneId) ?? null;
  const probedSignals = activePane?.signals ?? new Set<string>();

  function toggleProbe(signal: string) {
    if (!activePaneId) {
      const pane: Pane = { id: crypto.randomUUID(), signals: new Set([signal]) };
      setPanes([pane]);
      setActivePaneId(pane.id);
      return;
    }
    setPanes((prev) => prev.map((p) => {
      if (p.id !== activePaneId) return p;
      const next = new Set(p.signals);
      if (next.has(signal)) next.delete(signal);
      else next.add(signal);
      return { ...p, signals: next };
    }));
  }

  function addPane() {
    const pane: Pane = { id: crypto.randomUUID(), signals: new Set() };
    setPanes((prev) => [...prev, pane]);
    setActivePaneId(pane.id);
  }

  function removePane(id: string) {
    const pane = panes.find((p) => p.id === id);
    if (pane && pane.signals.size > 0) {
      if (!window.confirm(`Close pane with ${pane.signals.size} signal(s)?`)) return;
    }
    setPanes((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (id === activePaneId) setActivePaneId(next[0]?.id ?? null);
      return next;
    });
  }

  const panelTitle = simResult ? simResult.analysis : "Waveforms";

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Full-canvas probe schematic — always visible across all analysis types */}
      <div style={{ position: "absolute", inset: 0 }}>
        <ProbeSchematic
          components={components}
          wires={wires}
          netLabels={netLabels}
          probedSignals={probedSignals}
          pinNodes={simResult?.pinNodes ?? {}}
          onToggleProbe={toggleProbe}
          mode={simMode}
          gesture={gesture}
        />
        {components.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-zinc-600 text-xs select-none">Add components to simulate</span>
          </div>
        )}
      </div>

      {/* Toolbar — kept above the floating panel so it stays accessible
          even if the user drags the panel over it. */}
      <div className="absolute top-2 left-2 z-30 flex items-center gap-0.5 bg-zinc-900/95 border border-zinc-800 rounded px-1 py-0.5 backdrop-blur-sm shadow">
        <button
          title="Probe mode (P)"
          onClick={() => setSimMode("probe")}
          className={`h-6 flex items-center gap-1.5 px-2 rounded text-xs transition ${
            simMode === "probe"
              ? "bg-teal-700/60 text-teal-200"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Crosshair className="size-3.5" />
          <span>Probe</span>
          <span className="bg-zinc-800/80 text-zinc-500 font-mono text-[10px] px-1 rounded">P</span>
        </button>
        <button
          title="Move mode (M)"
          onClick={() => setSimMode("move")}
          className={`h-6 flex items-center gap-1.5 px-2 rounded text-xs transition ${
            simMode === "move"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Move className="size-3.5" />
          <span>Move</span>
          <span className="bg-zinc-800/80 text-zinc-500 font-mono text-[10px] px-1 rounded">M</span>
        </button>

        <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />

        <AnalysisPicker config={analysisConfig} onChange={setAnalysisConfig} />

        <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />

        <button
          onClick={onRunSim}
          disabled={simLoading}
          title="Re-run simulation"
          className="h-6 flex items-center gap-1.5 px-2 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 transition"
        >
          {simLoading ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
          Re-run
        </button>

        {simError && (
          <>
            <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />
            <span className="text-xs text-red-400 max-w-[160px] truncate" title={simError}>{simError}</span>
          </>
        )}
        {!chartPanelOpen && (
          <>
            <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />
            <button
              onClick={() => setChartPanelOpen(true)}
              className="h-6 flex items-center gap-1.5 px-2 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
            >
              <Activity className="size-3" />
              Waveforms
            </button>
          </>
        )}
      </div>

      {/* Floating waveform panel */}
      {chartPanelOpen && (
        <FloatingPanel title={panelTitle} containerRef={containerRef} onClose={() => setChartPanelOpen(false)}>
          {simResult ? (
            <div className="flex flex-col h-full">
              <PaneTabBar
                panes={panes}
                activePaneId={activePaneId}
                onSelect={setActivePaneId}
                onAdd={addPane}
                onRemove={removePane}
              />
              <div className="flex-1 flex flex-col min-h-0">
                {panes.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs px-4 text-center select-none">
                    Add a pane to plot signals
                  </div>
                ) : panes.map((pane, idx) => (
                  <div
                    key={pane.id}
                    onMouseDown={() => setActivePaneId(pane.id)}
                    className={`flex-1 min-h-0 ${idx > 0 ? "border-t border-zinc-800" : ""} ${
                      pane.id === activePaneId ? "" : "opacity-90"
                    }`}
                  >
                    {simResult.analysisType === "op" ? (
                      <OpTable
                        points={simResult.points}
                        variables={simResult.variables}
                        probedSignals={pane.signals}
                      />
                    ) : (
                      <WaveformChart
                        points={simResult.points}
                        variables={simResult.variables}
                        probedSignals={pane.signals}
                        analysisType={simResult.analysisType}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-700 text-xs select-none px-4 text-center">
              {simLoading ? "Running…" : "Run a simulation to see waveforms"}
            </div>
          )}
        </FloatingPanel>
      )}
    </div>
  );
}

// ─── Multi-pane tab bar ────────────────────────────────────────────────────────

function PaneTabBar({
  panes, activePaneId, onSelect, onAdd, onRemove,
}: {
  panes: Pane[];
  activePaneId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 bg-zinc-900/60 shrink-0">
      {panes.map((p, i) => {
        const isActive = p.id === activePaneId;
        const color    = PROBE_COLORS[i % PROBE_COLORS.length];
        return (
          <div
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`flex items-center gap-1.5 h-6 px-2 rounded text-[11px] cursor-pointer transition ${
              isActive
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
            }`}
            title={`Pane ${i + 1}${p.signals.size ? ` — ${p.signals.size} signal(s)` : ""}`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            <span className="font-mono">{i + 1}</span>
            {!isActive && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(p.id); }}
                className="ml-0.5 size-3.5 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                title="Close pane"
              >
                <X className="size-2.5" />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="h-6 px-1.5 rounded text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 flex items-center gap-1 transition"
        title="Add pane"
      >
        <Plus className="size-3" />
        <span>Add pane</span>
      </button>
    </div>
  );
}

// ─── Analysis picker (dropdown + settings popover) ─────────────────────────────

function AnalysisPicker({
  config, onChange,
}: {
  config: AnalysisConfig;
  onChange: (c: AnalysisConfig) => void;
}) {
  const [open, setOpen] = useState<"type" | "settings" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(null);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  function pickType(t: AnalysisType) {
    if (t !== config.type) onChange(DEFAULT_ANALYSIS_CONFIGS[t]);
    setOpen(null);
  }

  return (
    <div ref={wrapRef} className="relative flex items-center gap-0.5">
      <button
        onClick={() => setOpen(open === "type" ? null : "type")}
        className={`h-6 flex items-center gap-1 px-2 rounded text-xs transition ${
          open === "type"
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        }`}
        title="Analysis type"
      >
        <span>{ANALYSIS_LABELS[config.type]}</span>
        <ChevronDown className="size-3" />
      </button>
      <button
        onClick={() => setOpen(open === "settings" ? null : "settings")}
        className={`h-6 w-6 flex items-center justify-center rounded transition ${
          open === "settings"
            ? "bg-zinc-700 text-zinc-100"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        }`}
        title="Analysis settings"
      >
        <Settings2 className="size-3" />
      </button>

      {open === "type" && (
        <div className="absolute top-full left-0 mt-1 z-30 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded-md shadow-xl py-1">
          {(["tran", "ac", "dc", "op"] as const).map((t) => (
            <button
              key={t}
              onClick={() => pickType(t)}
              className={`w-full text-left px-3 py-1 text-xs transition ${
                config.type === t ? "bg-zinc-800 text-teal-300" : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {ANALYSIS_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {open === "settings" && (
        <div className="absolute top-full left-0 mt-1 z-30 w-64 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl p-3">
          <div className="text-[10px] uppercase text-zinc-500 mb-2 tracking-wide">
            {ANALYSIS_LABELS[config.type]} settings
          </div>
          {config.type === "tran" && (
            <div className="space-y-2">
              <PickerField label="tstep" value={config.tstep}
                onChange={(v) => onChange({ ...config, tstep: v })} />
              <PickerField label="tstop" value={config.tstop}
                onChange={(v) => onChange({ ...config, tstop: v })} />
            </div>
          )}
          {config.type === "ac" && (
            <div className="space-y-2">
              <div>
                <div className="text-[10px] text-zinc-500 mb-1">Sweep</div>
                <div className="flex gap-1">
                  {(["dec", "oct", "lin"] as const).map((s) => (
                    <button key={s}
                      onClick={() => onChange({ ...config, sweep: s })}
                      className={`flex-1 text-[10px] py-1 rounded border transition ${
                        config.sweep === s
                          ? "bg-zinc-700 border-zinc-600 text-zinc-100"
                          : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                      }`}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <PickerField label="points" value={String(config.points)}
                onChange={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n > 0) onChange({ ...config, points: n });
                }} />
              <PickerField label="fstart" value={config.fstart}
                onChange={(v) => onChange({ ...config, fstart: v })} />
              <PickerField label="fstop"  value={config.fstop}
                onChange={(v) => onChange({ ...config, fstop: v })} />
            </div>
          )}
          {config.type === "dc" && (
            <div className="space-y-2">
              <PickerField label="source" value={config.source}
                onChange={(v) => onChange({ ...config, source: v })} />
              <PickerField label="vstart" value={config.vstart}
                onChange={(v) => onChange({ ...config, vstart: v })} />
              <PickerField label="vstop"  value={config.vstop}
                onChange={(v) => onChange({ ...config, vstop: v })} />
              <PickerField label="vstep"  value={config.vstep}
                onChange={(v) => onChange({ ...config, vstep: v })} />
            </div>
          )}
          {config.type === "op" && (
            <p className="text-xs text-zinc-400 leading-relaxed">
              Computes the DC steady-state operating point.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PickerField({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-zinc-500 w-14 shrink-0">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 text-xs border-zinc-700 bg-zinc-800 flex-1"
      />
    </div>
  );
}

// ─── Helper components ─────────────────────────────────────────────────────────

function ActivityBarButton({ icon: Icon, label, active, onClick }: {
  icon: LucideIcon; label: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={`activity-${label.toLowerCase()}`}
      className={`w-9 h-9 flex items-center justify-center rounded-md transition ${
        active ? "text-zinc-100 bg-zinc-800" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
      }`}
    >
      <Icon className="size-5" />
    </button>
  );
}

// R06: the mock ProjectTreeItem list was replaced by the real project list
// backed by lib/persistence (see the projects panel in Home).

function ViewTab({ icon: Icon, label, active, onClick }: {
  icon: LucideIcon; label: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`view-tab-${label.toLowerCase()}`}
      className={`h-7 px-2.5 rounded-md text-xs flex items-center gap-1.5 transition ${
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
      }`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function MessageBubble({ message, undoStates, onUndoExecution }: { message: Message; undoStates?: ReadonlyMap<string, { eligible: boolean; reason: string | null }>; onUndoExecution?: (grantId: string) => Promise<void> }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed bg-teal-700/60 text-zinc-100 whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }
  if (message.role === "log") {
    const StatusIcon = message.status === "running" ? Loader2 : message.status === "error" ? X : Check;
    const entryState = entryStateOfLogMessage(message); // [B18-D I6] a chat execution entry (display only; its one control is I8's Undo)
    const entryGrantId = entryState ? message.id.slice(EXECUTION_ENTRY_ID_PREFIX.length) : null;
    const undoState = entryGrantId && entryState === "committed" ? (undoStates?.get(entryGrantId) ?? null) : null; // [B18-D I8] live entries only
    return (
      <div className="flex justify-start w-full" {...(entryState ? { "data-testid": "chat-execution-entry", "data-grant-id": message.id.slice(EXECUTION_ENTRY_ID_PREFIX.length), "data-state": entryState, "data-tier": "1" } : {})}>
        <div className="w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <StatusIcon className={`size-3.5 shrink-0 ${message.status === "running" ? "animate-spin text-teal-300" : message.status === "error" ? "text-red-400" : "text-teal-400"}`} />
            <span className="font-medium">{message.title}</span>
          </div>
          {undoState && entryGrantId && onUndoExecution ? <ExecutionEntryActions eligible={undoState.eligible} reason={undoState.reason} onUndo={() => void onUndoExecution?.(entryGrantId)} /> : null}
          <div className="mt-2 space-y-1.5">
            {message.entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
                <span
                  className={`mt-1.5 size-1.5 rounded-full shrink-0 ${
                    entry.status === "running"
                      ? "bg-teal-300 animate-pulse"
                      : entry.status === "error"
                        ? "bg-red-400"
                        : "bg-zinc-600"
                  }`}
                />
                <span className={entry.status === "error" ? "text-red-300" : "text-zinc-400"}>{entry.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!message.content.trim()) return null;
  return (
    <div className="flex justify-start w-full">
      <div className="w-full rounded-lg px-3 py-2.5 text-xs leading-relaxed bg-zinc-900 border border-zinc-800 overflow-hidden">
        <ChatMarkdown content={message.content} /> {/* [B19-D I5c row 02] images never fetched; links web/mail only */}
      </div>
    </div>
  );
}

function TheoryPartRow({ icon: Icon, label, note, onPlace, disabled, shortcut }: {
  icon: LucideIcon; label: string; note: string; onPlace?: () => void; disabled?: boolean; shortcut?: string;
}) {
  return (
    <button
      onClick={disabled ? undefined : onPlace}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition ${
        disabled ? "opacity-40 cursor-not-allowed text-zinc-600" : "hover:bg-zinc-900 cursor-pointer"
      }`}
    >
      <div className="size-6 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
        <Icon className="size-3.5 text-zinc-300" />
      </div>
      <div className="flex-1 text-left min-w-0">
        <div className="text-sm text-zinc-200 truncate">{label}</div>
        <div className="text-xs text-zinc-500 truncate">{note}</div>
      </div>
      {shortcut && (
        <span className="bg-zinc-800 text-zinc-500 font-mono text-[10px] px-1 rounded shrink-0">{shortcut}</span>
      )}
      {!disabled && <ChevronRight className="size-3.5 text-zinc-600 shrink-0" />}
    </button>
  );
}

function BuildCategoryRow({ label, count }: { label: string; count: number }) {
  return (
    <button className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-900 transition text-sm">
      <span className="text-zinc-300 truncate">{label}</span>
      <Badge variant="outline" className="text-[10px] text-zinc-400">{count.toLocaleString()}</Badge>
    </button>
  );
}

function CheckRow({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-zinc-300">
      {ok
        ? <Check         className="size-3.5 text-emerald-400" />
        : <AlertTriangle className="size-3.5 text-amber-400" />
      }
      <span>{label}</span>
    </div>
  );
}
