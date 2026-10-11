import type { SchematicState } from "@/lib/schematic-types";
import { createId, nowIso, stableHash } from "./identity";
import {
  SPICE_STUDIO_SCHEMA_VERSION, CALLER_SUPPLIED_EVIDENCE,
  type AiStudioOperation,
  type AiStudioProposal,
  type DesignRevision,
  type ModelAsset,
  type SimulationProject,
  type SimulationTest,
} from "./types";

export const DEFAULT_SOLVER_PROFILE = {
  id: "solver_balanced",
  name: "Balanced",
  reltol: 0.001,
  abstol: 1e-12,
  vntol: 1e-6,
  gmin: 1e-12,
  itl1: 150,
  itl4: 50,
  method: "trap" as const,
  maxord: 2 as const,
  sourceStepping: true,
  gminStepping: true,
  customOptions: [],
};

function builtInModel(
  name: string,
  category: string,
  originalContent: string,
  modelType: ModelAsset["modelType"] = "primitive",
): ModelAsset {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    id: `builtin_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    version: "1.0.0",
    name,
    category,
    modelType,
    originalContent,
    checksum: stableHash(originalContent),
    provenance: "built-in",
    license: "Sirkit built-in",
    redistribution: "allowed",
    dialects: ["ngspice"],
    externalPins: [],
    dependencies: [],
    defaultParameters: {},
    supportedAnalyses: ["op", "dc", "ac", "tran", "noise", "tf", "pz", "sens", "disto", "fourier", "custom"],
    unsupportedAnalyses: [],
    validationStatus: "trusted",
    validationChecks: [{ id: `check_${name}`, kind: "syntax", status: "pass", message: "Built-in ngspice primitive", checkedAt: timestamp }],
    warnings: [],
    transforms: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createBuiltInModels(): ModelAsset[] {
  return [
    builtInModel("Resistor", "passive", "* native ngspice resistor"),
    builtInModel("Capacitor", "passive", "* native ngspice capacitor"),
    builtInModel("Inductor", "passive", "* native ngspice inductor"),
    builtInModel("Independent voltage source", "source", "* native ngspice voltage source"),
    builtInModel("Independent current source", "source", "* native ngspice current source"),
    builtInModel(
      "1N4148 generic",
      "diode",
      ".model SIRKIT_D1N4148 D(IS=2.52e-9 RS=0.568 N=1.752 CJO=4e-12 M=0.4 TT=20n BV=100 IBV=0.1u)",
      "model",
    ),
  ];
}

export function createDefaultTest(designRevisionId: string, now = nowIso()): SimulationTest {
  const testId = createId("test");
  return {
    id: testId,
    name: "Nominal verification",
    description: "Nominal operating point and startup behavior.",
    revision: 1,
    baseDesignRevisionId: designRevisionId,
    overlay: { id: createId("overlay"), revision: 1, elements: [] },
    variables: [],
    environment: {
      temperatureC: 27,
      globalParameters: {},
      modelSections: {},
      solverProfile: { ...DEFAULT_SOLVER_PROFILE },
    },
    analyses: [
      { id: createId("analysis"), name: "Operating point", type: "op", enabled: true },
      {
        id: createId("analysis"),
        name: "Startup transient",
        type: "tran",
        outputStep: "10u",
        stopTime: "10m",
        maxStep: "10u",
        startup: false,
        useInitialConditions: false,
        enabled: true,
      },
    ],
    sweeps: [],
    cornerSets: [],
    monteCarlo: { enabled: false, samples: 100, seed: 12345, method: "latin-hypercube", includeNominal: true },
    outputs: [{ id: createId("output"), label: "All node voltages", expression: "v(*)", unit: "V", enabled: true }],
    measurements: [],
    specifications: [],
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function createSimulationProject(
  schematic: SchematicState,
  options: { name?: string; now?: string } = {},
): SimulationProject {
  const now = options.now ?? nowIso();
  const design: DesignRevision = {
    id: createId("design"),
    revision: 1,
    schematicHash: stableHash(schematic),
    schematic: structuredClone(schematic),
    createdAt: now,
  };
  const test = createDefaultTest(design.id, now);
  return {
    schemaVersion: SPICE_STUDIO_SCHEMA_VERSION,
    id: createId("simproj"),
    name: options.name ?? "Sirkit SPICE Studio",
    revision: 1,
    activeDesignRevisionId: design.id,
    designRevisions: [design],
    tests: [test],
    modelAssets: createBuiltInModels(),
    modelBindings: [],
    runPlans: [
      {
        id: createId("runplan"),
        name: "Nominal suite",
        testIds: [test.id],
        includeSweeps: true,
        includeCorners: true,
        includeMonteCarlo: false,
        concurrency: 2,
        stopOnFailure: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    plotTemplates: [],
    aiAuditLog: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function cloneProject(project: SimulationProject): SimulationProject {
  return structuredClone(project);
}

export function refreshDesignRevision(
  project: SimulationProject,
  schematic: SchematicState,
  now = nowIso(),
): SimulationProject {
  const nextHash = stableHash(schematic);
  const active = project.designRevisions.find((revision) => revision.id === project.activeDesignRevisionId);
  if (active?.schematicHash === nextHash) return project;
  const next = cloneProject(project);
  const maxRevision = Math.max(0, ...next.designRevisions.map((revision) => revision.revision));
  const design: DesignRevision = {
    id: createId("design"),
    revision: maxRevision + 1,
    schematicHash: nextHash,
    schematic: structuredClone(schematic),
    createdAt: now,
  };
  next.designRevisions.push(design);
  next.activeDesignRevisionId = design.id;
  next.revision += 1;
  next.updatedAt = now;
  return next;
}

export function updateTest(
  project: SimulationProject,
  testId: string,
  updater: (draft: SimulationTest) => void,
  reason = "Test setup updated",
  now = nowIso(),
): SimulationProject {
  const next = cloneProject(project);
  const test = next.tests.find((candidate) => candidate.id === testId);
  if (!test) throw new Error(`Test ${testId} was not found`);
  updater(test);
  test.revision += 1;
  test.updatedAt = now;
  next.revision += 1;
  next.updatedAt = now;
  next.aiAuditLog = appendAiAuditEntry(next.aiAuditLog, { // [B24-C2] D24-25: through the one append helper (redacted, capped, bounded)
    id: createId("audit"),
    timestamp: now,
    actor: "user",
    operation: "update-test",
    approval: "automatic",
    status: "applied",
    reason,
  });
  return next;
}

export function duplicateTest(project: SimulationProject, testId: string, name: string, now = nowIso()): SimulationProject {
  const source = project.tests.find((test) => test.id === testId);
  if (!source) throw new Error(`Test ${testId} was not found`);
  const next = cloneProject(project);
  const copy = structuredClone(source);
  copy.id = createId("test");
  copy.name = name;
  copy.parentTestId = source.id;
  copy.revision = 1;
  copy.overlay.id = createId("overlay");
  copy.createdAt = now;
  copy.updatedAt = now;
  next.tests.push(copy);
  next.revision += 1;
  next.updatedAt = now;
  return next;
}

function applyOperation(project: SimulationProject, operation: AiStudioOperation): void {
  switch (operation.op) {
    case "create-test":
      project.tests.push(structuredClone(operation.test));
      return;
    case "duplicate-test": {
      const source = project.tests.find((test) => test.id === operation.testId);
      if (!source) throw new Error(`Test ${operation.testId} was not found`);
      const copy = structuredClone(source);
      copy.id = createId("test");
      copy.name = operation.name;
      copy.parentTestId = source.id;
      copy.revision = 1;
      project.tests.push(copy);
      return;
    }
    case "assign-model":
      project.modelBindings = project.modelBindings.filter((binding) => binding.componentId !== operation.binding.componentId);
      project.modelBindings.push(structuredClone(operation.binding));
      return;
    case "add-overlay-element": {
      const test = project.tests.find((candidate) => candidate.id === operation.testId);
      if (!test) throw new Error(`Test ${operation.testId} was not found`);
      test.overlay.elements.push(structuredClone(operation.element));
      test.overlay.revision += 1;
      test.revision += 1;
      return;
    }
    case "set-variable":
    case "configure-analysis":
    case "configure-sweep":
    case "configure-corners":
    case "define-measurement":
    case "define-specification":
    case "set-solver-profile": {
      const test = project.tests.find((candidate) => candidate.id === operation.testId);
      if (!test) throw new Error(`Test ${operation.testId} was not found`);
      if (operation.op === "set-variable") {
        test.variables = [...test.variables.filter((item) => item.id !== operation.variable.id && item.name !== operation.variable.name), structuredClone(operation.variable)];
      } else if (operation.op === "configure-analysis") {
        test.analyses = [...test.analyses.filter((item) => item.id !== operation.analysis.id), structuredClone(operation.analysis)];
      } else if (operation.op === "configure-sweep") {
        test.sweeps = [...test.sweeps.filter((item) => item.id !== operation.sweep.id), structuredClone(operation.sweep)];
      } else if (operation.op === "configure-corners") {
        test.cornerSets = [...test.cornerSets.filter((item) => item.id !== operation.cornerSet.id), structuredClone(operation.cornerSet)];
      } else if (operation.op === "define-measurement") {
        test.measurements = [...test.measurements.filter((item) => item.id !== operation.measurement.id), structuredClone(operation.measurement)];
      } else if (operation.op === "define-specification") {
        test.specifications = [...test.specifications.filter((item) => item.id !== operation.specification.id), structuredClone(operation.specification)];
      } else {
        test.environment.solverProfile = structuredClone(operation.profile);
      }
      test.revision += 1;
      return;
    }
    case "propose-design-patch":
      throw new Error("Design patches require explicit schematic-editor confirmation");
    case "request-run":
      // Execution is deliberately outside project mutation. Applying this
      // operation records approval; the UI then starts the referenced plan.
      if (!project.runPlans.some((plan) => plan.id === operation.runPlanId)) {
        throw new Error(`Run plan ${operation.runPlanId} was not found`);
      }
      return;
  }
}

export function applyAiProposal(
  project: SimulationProject,
  proposal: AiStudioProposal,
  approvedOperationIndexes: number[],
  now = nowIso(),
): SimulationProject {
  const approved = new Set(approvedOperationIndexes);
  const next = cloneProject(project);
  proposal.operations.forEach((entry, index) => {
    if (!approved.has(index)) return;
    applyOperation(next, entry.operation);
  });
  next.revision += 1;
  next.updatedAt = now;
  next.aiAuditLog = appendAiAuditEntry(next.aiAuditLog, { // [B24-C2] D24-25: through the one append helper (redacted, capped, bounded)
    id: createId("audit"),
    timestamp: now,
    actor: "ai",
    operation: "apply-ai-proposal",
    approval: proposal.operations.some((entry, index) => approved.has(index) && entry.approval === "explicit")
      ? "explicit"
      : proposal.operations.some((entry, index) => approved.has(index) && entry.approval === "review")
        ? "review"
        : "automatic",
    status: "applied",
    reason: proposal.rationale,
    evidence: proposal.evidence.map((ref) => ({ ...ref, provenance: CALLER_SUPPLIED_EVIDENCE })), // [B22-C] D22-21: a browser-held proposal's references are caller-supplied, whatever they claim
    changeSet: proposal.operations.filter((_, index) => approved.has(index)),
  });
  return next;
}

export function getActiveDesign(project: SimulationProject): DesignRevision {
  const revision = project.designRevisions.find((candidate) => candidate.id === project.activeDesignRevisionId);
  if (!revision) throw new Error("Simulation project has no active design revision");
  return revision;
}

export function assertProjectShape(value: unknown): asserts value is SimulationProject {
  if (typeof value !== "object" || value === null) throw new Error("Simulation project is not an object");
  const project = value as Partial<SimulationProject>;
  if (project.schemaVersion !== SPICE_STUDIO_SCHEMA_VERSION) throw new Error(`Unsupported simulation project schema: ${String(project.schemaVersion)}`);
  if (typeof project.id !== "string" || typeof project.name !== "string") throw new Error("Simulation project identity is invalid");
  if (!Array.isArray(project.designRevisions) || !Array.isArray(project.tests) || !Array.isArray(project.runPlans)) {
    throw new Error("Simulation project collections are invalid");
  }
}

// ─── [B24-C2] D24-25: the audit log's bounds and the one append helper both writers use ─────────────────────────────────────────
// Appended on purpose (function declarations are hoisted): no line cited above moves.

/** The audit log's bounds, stated choices (OD-232): 200 entries, 2,000 reason characters, 16,000 change-set characters, 200 evidence
 *  references per entry (the server's own cap on a proposal's references, `/api/spice/ai`; [B24-C2 review, 2026-10-09]). */
export const AI_AUDIT_LOG_BOUNDS = Object.freeze({ maxEntries: 200, maxReasonChars: 2_000, maxChangeSetChars: 16_000, maxEvidenceRefs: 200 });
export const AI_AUDIT_LOG_TRUNCATED = "audit-log-truncated" as const;

/** A change set past its bound is stored as this, never as text. */
export interface AiAuditChangeSetWithheld { withheld: "change_set_too_large"; operationCount: number; digest: string }

/** Every string leaf of a value through the token-anchored redactor (design text such as a net name survives; a key does not). */
function redactStringLeaves(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return sanitizeModelBoundText(value);
  if (depth > 32 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => redactStringLeaves(entry, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = redactStringLeaves(entry, depth + 1);
  return out;
}
/** [B24-C2 review, 2026-10-09] The evidence references as they are stored: string leaves redacted (a `signal`, a `unit`, an id), at most
 *  `maxEvidenceRefs` kept, the excess counted in `evidenceWithheld` (cumulative, so a bounded entry loads unchanged; absent when none). */
function redactAiAuditEvidence(entry: AiAuditEntry): Pick<AiAuditEntry, "evidence" | "evidenceWithheld"> {
  if (entry.evidence === undefined) return {};
  if (!Array.isArray(entry.evidence)) return { evidence: [] };
  const kept = entry.evidence.slice(0, AI_AUDIT_LOG_BOUNDS.maxEvidenceRefs);
  const carried = typeof entry.evidenceWithheld === "number" && Number.isSafeInteger(entry.evidenceWithheld) && entry.evidenceWithheld > 0 ? entry.evidenceWithheld : 0;
  const withheld = carried + (entry.evidence.length - kept.length);
  return { evidence: redactStringLeaves(kept) as EvidenceRef[], ...(withheld > 0 ? { evidenceWithheld: withheld } : {}) };
}
/** One entry as it is stored: the reason redacted and capped; the evidence redacted and bounded; a change set redacted, or withheld past its bound. */
function redactAiAuditEntry(entry: AiAuditEntry): AiAuditEntry {
  const reason = sanitizeModelBoundText(typeof entry.reason === "string" ? entry.reason : "").slice(0, AI_AUDIT_LOG_BOUNDS.maxReasonChars);
  const base: AiAuditEntry = { ...entry, reason, ...redactAiAuditEvidence(entry) };
  if (!("changeSet" in entry) || entry.changeSet === undefined) return base;
  let serialized: string;
  try { serialized = JSON.stringify(entry.changeSet) ?? ""; } catch { serialized = ""; }
  if (serialized.length > AI_AUDIT_LOG_BOUNDS.maxChangeSetChars) {
    const withheld: AiAuditChangeSetWithheld = { withheld: "change_set_too_large", operationCount: Array.isArray(entry.changeSet) ? entry.changeSet.length : 1, digest: engineeringDigest({ schema: "sirkit.spice-audit-change-set.v1", changeSet: entry.changeSet }) };
    return { ...base, changeSet: withheld };
  }
  return { ...base, changeSet: redactStringLeaves(entry.changeSet) };
}
const isTruncationMarker = (entry: AiAuditEntry | undefined): boolean => entry !== undefined && entry.actor === "system" && entry.operation === AI_AUDIT_LOG_TRUNCATED;
const droppedOf = (marker: AiAuditEntry | undefined): number => {
  const dropped = marker !== undefined && typeof marker.changeSet === "object" && marker.changeSet !== null ? (marker.changeSet as { droppedEntries?: unknown }).droppedEntries : undefined;
  return typeof dropped === "number" && Number.isSafeInteger(dropped) && dropped >= 0 ? dropped : 0;
};

/** The log bounded to `maxEntries`: the oldest entries go first, behind ONE leading `system` entry carrying the cumulative number dropped. Applied on every write and again when a stored project is loaded. */
export function boundAiAuditLog(entries: readonly AiAuditEntry[]): AiAuditEntry[] {
  if (entries.length <= AI_AUDIT_LOG_BOUNDS.maxEntries) return [...entries];
  const marker = isTruncationMarker(entries[0]) ? entries[0] : undefined;
  const body = marker === undefined ? entries : entries.slice(1);
  const keep = AI_AUDIT_LOG_BOUNDS.maxEntries - 1;
  const dropped = body.slice(0, Math.max(0, body.length - keep));
  const droppedEntries = droppedOf(marker) + dropped.length;
  const newest = dropped.at(-1) ?? marker;
  const leading: AiAuditEntry = {
    id: marker?.id ?? createId("audit"),
    timestamp: newest?.timestamp ?? nowIso(),
    actor: "system",
    operation: AI_AUDIT_LOG_TRUNCATED,
    approval: "automatic",
    status: "applied",
    reason: `${droppedEntries} older audit entries were dropped (the log keeps ${AI_AUDIT_LOG_BOUNDS.maxEntries}).`,
    changeSet: { droppedEntries },
  };
  return [leading, ...body.slice(body.length - keep)];
}
/** The one append both writers use: redact, cap and bound. */
function appendAiAuditEntry(entries: readonly AiAuditEntry[], entry: AiAuditEntry): AiAuditEntry[] {
  return boundAiAuditLog([...entries, redactAiAuditEntry(entry)]);
}
/** [B24-C2 review, 2026-10-09] A STORED log as `loadStudioProject` returns it: every entry (one written before the redaction, or by a writer
 *  that set `aiAuditLog` directly, included) redacted and capped exactly as on write, then the log bounded. A non-object entry is dropped. */
export function loadAiAuditLog(stored: unknown): AiAuditEntry[] {
  if (!Array.isArray(stored)) return [];
  const entries = stored.filter((entry): entry is AiAuditEntry => typeof entry === "object" && entry !== null && !Array.isArray(entry));
  return boundAiAuditLog(entries.map((entry) => redactAiAuditEntry(entry)));
}
import type { AiAuditEntry, EvidenceRef } from "./types"; // on its own line at the end (an import is hoisted): no cited line moves
import { sanitizeModelBoundText } from "@/app/lib/agent/redaction"; // [B24-C2] D24-25: the redaction authority (dependency-neutral) on the browser-local audit log; at the end, hoisted, so the flag census's cited line (:72) holds
import { engineeringDigest } from "@/app/lib/engineering/stable"; // [B24-C2] browser-safe digest of a withheld change set
