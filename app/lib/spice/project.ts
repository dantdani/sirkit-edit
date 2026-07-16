import type { SchematicState } from "@/lib/schematic-types";
import { createId, nowIso, stableHash } from "./identity";
import {
  SPICE_STUDIO_SCHEMA_VERSION,
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
  next.aiAuditLog.push({
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
  next.aiAuditLog.push({
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
    evidence: proposal.evidence,
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
