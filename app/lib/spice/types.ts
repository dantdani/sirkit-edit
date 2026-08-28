import type { KicadPin } from "@/app/lib/kicad/types";
import type { SchematicState } from "@/lib/schematic-types";

export const SPICE_STUDIO_SCHEMA_VERSION = 1 as const;

export type EntityId = string;
export type IsoTimestamp = string;
export type Severity = "info" | "warning" | "error";
export type ApprovalLevel = "automatic" | "review" | "explicit";
export type ValidationStatus =
  | "unverified"
  | "syntax-checked"
  | "smoke-tested"
  | "curve-validated"
  | "trusted";

export interface RevisionRef {
  id: EntityId;
  revision: number;
  createdAt: IsoTimestamp;
  createdBy: "user" | "ai" | "system";
  reason?: string;
}

export interface DesignRevision {
  id: EntityId;
  revision: number;
  schematicHash: string;
  schematic: SchematicState;
  createdAt: IsoTimestamp;
}

export type OverlayNodeTarget =
  | { kind: "net"; net: string }
  | { kind: "component-pin"; componentId: string; pin: string };

export type OverlayElement =
  | {
      id: EntityId;
      kind: "voltage-source" | "current-source";
      name: string;
      positive: OverlayNodeTarget;
      negative: OverlayNodeTarget;
      value: string;
      waveform?: string;
      enabled: boolean;
    }
  | {
      id: EntityId;
      kind: "resistive-load" | "capacitive-load" | "inductive-load";
      name: string;
      positive: OverlayNodeTarget;
      negative: OverlayNodeTarget;
      value: string;
      enabled: boolean;
    }
  | {
      id: EntityId;
      kind: "probe";
      name: string;
      target: OverlayNodeTarget;
      quantity: "voltage" | "current" | "power";
      enabled: boolean;
    }
  | {
      id: EntityId;
      kind: "initial-condition";
      name: string;
      target: OverlayNodeTarget;
      value: string;
      enabled: boolean;
    }
  | {
      id: EntityId;
      kind: "series-parasitic";
      name: string;
      targetComponentId: string;
      resistance?: string;
      inductance?: string;
      capacitance?: string;
      enabled: boolean;
    }
  | {
      id: EntityId;
      kind: "fault";
      name: string;
      fault: "open" | "short" | "stuck-high" | "stuck-low";
      target: OverlayNodeTarget;
      resistance?: string;
      enabled: boolean;
    }
  | {
      id: EntityId;
      kind: "component-substitution";
      name: string;
      componentId: string;
      modelId: string;
      enabled: boolean;
    };

export interface SimulationOverlay {
  id: EntityId;
  revision: number;
  elements: OverlayElement[];
  notes?: string;
}

export type Distribution =
  | { kind: "gaussian"; sigma: number; truncationSigma?: number; correlationGroup?: string }
  | { kind: "uniform"; tolerance: number; correlationGroup?: string }
  | { kind: "lognormal"; sigma: number; truncationSigma?: number; correlationGroup?: string }
  | { kind: "discrete"; values: Array<{ value: string; weight: number }> }
  | { kind: "custom"; samples: string[] };

export interface DesignVariable {
  id: EntityId;
  name: string;
  value: string;
  unit: string;
  description?: string;
  min?: string;
  max?: string;
  formula?: string;
  distribution?: Distribution;
  enabled: boolean;
}

export interface SolverProfile {
  id: EntityId;
  name: string;
  reltol?: number;
  abstol?: number;
  vntol?: number;
  gmin?: number;
  itl1?: number;
  itl4?: number;
  method?: "trap" | "gear";
  maxord?: 1 | 2 | 3 | 4 | 5 | 6;
  sourceStepping?: boolean;
  gminStepping?: boolean;
  customOptions?: string[];
}

export interface SimulationEnvironment {
  temperatureC: number;
  globalParameters: Record<string, string>;
  modelSections: Record<string, string>;
  solverProfile: SolverProfile;
}

interface AnalysisBase {
  id: EntityId;
  name: string;
  enabled: boolean;
  advancedDirectives?: string[];
}

export type SimulationAnalysis =
  | (AnalysisBase & { type: "op" })
  | (AnalysisBase & {
      type: "dc";
      source: string;
      start: string;
      stop: string;
      step: string;
      nested?: { source: string; start: string; stop: string; step: string };
    })
  | (AnalysisBase & {
      type: "ac";
      scale: "dec" | "oct" | "lin";
      points: number;
      startFrequency: string;
      stopFrequency: string;
    })
  | (AnalysisBase & {
      type: "tran";
      outputStep: string;
      stopTime: string;
      startTime?: string;
      maxStep?: string;
      useInitialConditions?: boolean;
      startup?: boolean;
    })
  | (AnalysisBase & {
      type: "noise";
      output: string;
      inputSource: string;
      scale: "dec" | "oct" | "lin";
      points: number;
      startFrequency: string;
      stopFrequency: string;
      pointsPerSummary?: number;
    })
  | (AnalysisBase & { type: "tf"; output: string; inputSource: string })
  | (AnalysisBase & {
      type: "pz";
      inputPositive: string;
      inputNegative: string;
      outputPositive: string;
      outputNegative: string;
      transfer: "vol" | "cur";
      calculation: "pz" | "pol" | "zer";
    })
  | (AnalysisBase & { type: "sens"; output: string; ac?: { scale: "dec" | "oct" | "lin"; points: number; start: string; stop: string } })
  | (AnalysisBase & { type: "disto"; scale: "dec" | "oct" | "lin"; points: number; startFrequency: string; stopFrequency: string; f2overF1?: number })
  | (AnalysisBase & { type: "fourier"; fundamentalFrequency: string; outputs: string[] })
  | (AnalysisBase & { type: "custom"; commands: string[] });

export type SweepDefinition =
  | { kind: "linear"; start: string; stop: string; step: string }
  | { kind: "log"; start: string; stop: string; pointsPerDecade: number }
  | { kind: "list"; values: string[] }
  | { kind: "expression"; expression: string; values: string[] };

export interface Sweep {
  id: EntityId;
  name: string;
  variable: string;
  definition: SweepDefinition;
  nestedSweepId?: EntityId;
  enabled: boolean;
}

export interface Corner {
  id: EntityId;
  name: string;
  variableValues: Record<string, string>;
  modelSections: Record<string, string>;
  temperatureC?: number;
  enabled: boolean;
  tags?: string[];
}

export interface CornerSet {
  id: EntityId;
  name: string;
  corners: Corner[];
  mode: "listed" | "cartesian";
  exclusions?: Array<Record<string, string>>;
  enabled: boolean;
}

export interface MonteCarloConfig {
  enabled: boolean;
  samples: number;
  seed: number;
  method: "random" | "latin-hypercube";
  includeNominal: boolean;
}

export interface SavedOutput {
  id: EntityId;
  expression: string;
  label: string;
  unit?: string;
  enabled: boolean;
}

export type MeasurementOperator =
  | "min"
  | "max"
  | "average"
  | "rms"
  | "peak-to-peak"
  | "integral"
  | "derivative"
  | "value-at"
  | "crossing"
  | "rise-time"
  | "fall-time"
  | "propagation-delay"
  | "pulse-width"
  | "duty-cycle"
  | "overshoot"
  | "undershoot"
  | "settling-time"
  | "slew-rate"
  | "gain"
  | "phase"
  | "bandwidth"
  | "unity-gain-frequency"
  | "gain-margin"
  | "phase-margin"
  | "impedance"
  | "ripple"
  | "average-power"
  | "peak-power"
  | "energy"
  | "thd"
  | "integrated-noise"
  | "formula";

export interface Measurement {
  id: EntityId;
  name: string;
  operator: MeasurementOperator;
  expression: string;
  secondaryExpression?: string;
  unit?: string;
  from?: string;
  to?: string;
  at?: string;
  threshold?: number;
  nth?: number;
  tolerance?: number;
  formula?: string;
  enabled: boolean;
  description?: string;
}

export type SpecificationState = "pass" | "fail" | "warning" | "error" | "not-evaluated";

export interface Specification {
  id: EntityId;
  name: string;
  measurementId: EntityId;
  comparison: "<" | "<=" | ">" | ">=" | "between" | "outside";
  limit: number;
  upperLimit?: number;
  unit: string;
  severity: "warning" | "error";
  guardExpression?: string;
  applicableTestIds: EntityId[];
  enabled: boolean;
}

export interface SimulationTest {
  id: EntityId;
  name: string;
  description?: string;
  revision: number;
  parentTestId?: EntityId;
  baseDesignRevisionId: EntityId;
  overlay: SimulationOverlay;
  variables: DesignVariable[];
  environment: SimulationEnvironment;
  analyses: SimulationAnalysis[];
  sweeps: Sweep[];
  cornerSets: CornerSet[];
  monteCarlo?: MonteCarloConfig;
  outputs: SavedOutput[];
  measurements: Measurement[];
  specifications: Specification[];
  enabled: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type ModelType =
  | "primitive"
  | "model"
  | "subckt"
  | "ibis-derived"
  | "behavioral"
  | "xspice"
  | "verilog-a-osdi";

export interface ModelTransformPatch {
  id: EntityId;
  description: string;
  original: string;
  replacement: string;
  line?: number;
  approved: boolean;
}

export interface ModelValidationCheck {
  id: EntityId;
  kind: "syntax" | "smoke" | "curve";
  status: "pending" | "pass" | "fail" | "warning";
  message: string;
  runId?: EntityId;
  checkedAt?: IsoTimestamp;
}

export interface ModelAsset {
  id: EntityId;
  version: string;
  name: string;
  manufacturer?: string;
  mpn?: string;
  category: string;
  modelType: ModelType;
  sourceFileName?: string;
  originalContent: string;
  transformedContent?: string;
  checksum: string;
  provenance: "vendor" | "distributor" | "open-library" | "user" | "ai-approximation" | "built-in";
  sourceUrl?: string;
  license?: string;
  redistribution: "allowed" | "restricted" | "unknown";
  dialects: string[];
  subcircuitName?: string;
  externalPins: Array<{ position: number; name: string; semanticName?: string }>;
  dependencies: string[];
  defaultParameters: Record<string, string>;
  supportedAnalyses: SimulationAnalysis["type"][];
  unsupportedAnalyses: SimulationAnalysis["type"][];
  nominalConditions?: string;
  validityRange?: string;
  validationStatus: ValidationStatus;
  validationChecks: ModelValidationCheck[];
  warnings: string[];
  convergenceNotes?: string;
  transforms: ModelTransformPatch[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ModelBinding {
  id: EntityId;
  componentId: EntityId;
  modelId: EntityId;
  pinMap: Record<string, string>;
  parameterOverrides: Record<string, string>;
  confidence: number;
  assignedBy: "user" | "ai" | "system";
  reviewed: boolean;
  createdAt: IsoTimestamp;
}

export interface SimulationPartSnapshot {
  id: string;
  name: string;
  mpn: string | null;
  manufacturer: string | null;
  pins: KicadPin[];
}

export interface RunPlan {
  id: EntityId;
  name: string;
  testIds: EntityId[];
  includeSweeps: boolean;
  includeCorners: boolean;
  includeMonteCarlo: boolean;
  concurrency: number;
  stopOnFailure: boolean;
  tags?: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface PlotTemplate {
  id: EntityId;
  name: string;
  testType?: string;
  panes: Array<{ id: EntityId; title: string; expressions: string[]; yScale: "linear" | "log"; synchronized: boolean }>;
}

export interface AiAuditEntry {
  id: EntityId;
  timestamp: IsoTimestamp;
  actor: "ai" | "user" | "system";
  operation: string;
  approval: ApprovalLevel;
  status: "proposed" | "approved" | "rejected" | "applied" | "failed";
  reason: string;
  evidence?: EvidenceRef[];
  changeSet?: unknown;
}

export interface SimulationProject {
  schemaVersion: typeof SPICE_STUDIO_SCHEMA_VERSION;
  id: EntityId;
  name: string;
  revision: number;
  activeDesignRevisionId: EntityId;
  designRevisions: DesignRevision[];
  tests: SimulationTest[];
  modelAssets: ModelAsset[];
  modelBindings: ModelBinding[];
  runPlans: RunPlan[];
  plotTemplates: PlotTemplate[];
  aiAuditLog: AiAuditEntry[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface SourceRef {
  kind: "schematic-component" | "schematic-net" | "overlay" | "model" | "analysis" | "variable" | "custom-directive";
  id: EntityId;
  label?: string;
}

export interface IrNode {
  id: EntityId;
  name: string;
  aliases: string[];
  ground: boolean;
  sourceRefs: SourceRef[];
}

export interface IrPin {
  name: string;
  modelPin?: string;
  nodeId: EntityId;
}

export interface IrDevice {
  id: EntityId;
  name: string;
  deviceType: "R" | "C" | "L" | "V" | "I" | "D" | "Q" | "M" | "X" | "B";
  pins: IrPin[];
  value?: string;
  modelId?: EntityId;
  modelName?: string;
  parameters: Record<string, string>;
  source: SourceRef;
}

export interface CanonicalSimulationIr {
  schemaVersion: 1;
  title: string;
  designRevisionId: EntityId;
  testRevision: RevisionRef;
  nodes: IrNode[];
  devices: IrDevice[];
  variables: DesignVariable[];
  environment: SimulationEnvironment;
  analyses: SimulationAnalysis[];
  outputs: SavedOutput[];
  models: ModelAsset[];
  customDirectives: Array<{ text: string; source: SourceRef }>;
  warnings: string[];
}

export interface NetlistSourceMapEntry {
  lineStart: number;
  lineEnd: number;
  source: SourceRef;
  generatedText: string;
}

export interface NetlistBundle {
  generated: string;
  normalized: string;
  executed: string;
  sourceMap: NetlistSourceMapEntry[];
  nodeMap: Record<string, string>;
  pinNodes: Record<string, string>;
  warnings: string[];
}

export type ReadinessIssueCode =
  | "missing-ground"
  | "missing-source"
  | "floating-node"
  | "unconnected-pin"
  | "ideal-source-loop"
  | "current-source-cutset"
  | "missing-model"
  | "pin-map-mismatch"
  | "unsupported-model"
  | "missing-load"
  | "duplicate-reference"
  | "duplicate-net-name"
  | "analysis-incompatible"
  | "invalid-value"
  | "missing-output"
  | "approximate-model";

export interface ReadinessFix {
  kind: "automatic" | "guided";
  label: string;
  operation: string;
  payload?: unknown;
}

export interface ReadinessIssue {
  id: EntityId;
  code: ReadinessIssueCode;
  severity: Severity;
  title: string;
  message: string;
  why: string;
  sourceRefs: SourceRef[];
  fixes: ReadinessFix[];
}

export interface ReadinessReport {
  ready: boolean;
  blocking: number;
  warnings: number;
  infos: number;
  checkedAt: IsoTimestamp;
  issues: ReadinessIssue[];
}

export interface RunPoint {
  id: EntityId;
  index: number;
  testId: EntityId;
  analysisId: EntityId;
  cornerId?: EntityId;
  sweepValues: Record<string, string>;
  variableValues: Record<string, string>;
  temperatureC: number;
  monteCarloSample?: number;
  seed?: number;
  label: string;
}

export interface RunPlanEstimate {
  runPoints: RunPoint[];
  totalRuns: number;
  enabledTests: number;
  analyses: number;
  estimatedSeconds: number;
  estimatedOutputBytes: number;
  warnings: string[];
}

export type RunStatus =
  | "queued"
  | "preparing"
  | "netlisting"
  | "validating"
  | "running"
  | "post-processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunManifest {
  id: EntityId;
  projectId: EntityId;
  projectRevision: number;
  designRevisionId: EntityId;
  testId: EntityId;
  testRevision: number;
  runPlanId: EntityId;
  runPoint: RunPoint;
  simulator: { name: "ngspice"; version: string; mode: "subprocess" | "shared-library" };
  modelChecksums: Record<string, string>;
  schematicHash: string;
  netlistChecksum: string;
  analysis: SimulationAnalysis;
  solverProfile: SolverProfile;
  randomSeed?: number;
  createdAt: IsoTimestamp;
}

export interface WaveformSeries {
  id: EntityId;
  name: string;
  unit: string;
  xName: string;
  xUnit: string;
  x: number[];
  y: number[];
  complex?: { real: number[]; imaginary: number[]; magnitudeDb: number[]; phaseDeg: number[] };
  sourceRefs: SourceRef[];
}

export interface ScalarResult {
  id: EntityId;
  runId: EntityId;
  measurementId: EntityId;
  name: string;
  value?: number;
  unit?: string;
  status: SpecificationState;
  specificationId?: EntityId;
  message?: string;
  markers?: Array<{ series: string; x: number; y: number; label: string }>;
}

export type DiagnosticCode =
  | "singular-matrix"
  | "timestep-too-small"
  | "dc-operating-point-failed"
  | "newton-nonconvergence"
  | "model-not-found"
  | "subckt-pin-count"
  | "unknown-parameter"
  | "unsupported-syntax"
  | "numeric-overflow"
  | "excessive-output"
  | "discontinuous-expression"
  | "ideal-topology"
  | "timeout"
  | "cancelled"
  | "unknown";

export interface Diagnostic {
  id: EntityId;
  code: DiagnosticCode;
  severity: Severity;
  title: string;
  summary: string;
  rawExcerpt?: string;
  netlistLine?: number;
  sourceRefs: SourceRef[];
  suggestions: Array<{
    order: number;
    label: string;
    kind: "physical" | "numerical" | "inspection";
    explanation: string;
    solverPatch?: Partial<SolverProfile>;
  }>;
}

export interface RunEvent {
  sequence: number;
  timestamp: IsoTimestamp;
  status: RunStatus;
  progress: number;
  message: string;
  log?: string;
  scalar?: ScalarResult;
}

export interface RunRecord {
  id: EntityId;
  projectId: EntityId;
  runPlanId: EntityId;
  testId: EntityId;
  status: RunStatus;
  progress: number;
  label: string;
  manifest?: RunManifest;
  netlist?: NetlistBundle;
  waveforms: WaveformSeries[];
  scalars: ScalarResult[];
  diagnostics: Diagnostic[];
  events: RunEvent[];
  stdout: string;
  stderr: string;
  startedAt?: IsoTimestamp;
  finishedAt?: IsoTimestamp;
  createdAt: IsoTimestamp;
  artifactId?: string;
  error?: string;
  /** [B16.0.2 B] the SERVER-DERIVED ownership scope the run is bound to
   *  (trusted request context at start) — `projectId` above is only the
   *  client-asserted SimulationProject id and is never an ownership key. */
  scope?: { tenantId: string; projectId: string; branchId: string };
}

export interface RunBatchRecord {
  id: EntityId;
  projectId: EntityId;
  runPlanId: EntityId;
  status: RunStatus;
  runIds: EntityId[];
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  createdAt: IsoTimestamp;
  finishedAt?: IsoTimestamp;
  /** [B16.0.2 B] the SERVER-DERIVED ownership scope (see RunRecord.scope). */
  scope?: { tenantId: string; projectId: string; branchId: string };
}

export interface EvidenceRef {
  runId: EntityId;
  testId: EntityId;
  cornerId?: EntityId;
  signal?: string;
  measurementId?: EntityId;
  value?: number;
  unit?: string;
  from?: number;
  to?: number;
  diagnosticId?: EntityId;
}

export type AiStudioOperation =
  | { op: "create-test"; test: SimulationTest }
  | { op: "duplicate-test"; testId: EntityId; name: string }
  | { op: "assign-model"; binding: ModelBinding }
  | { op: "add-overlay-element"; testId: EntityId; element: OverlayElement }
  | { op: "set-variable"; testId: EntityId; variable: DesignVariable }
  | { op: "configure-analysis"; testId: EntityId; analysis: SimulationAnalysis }
  | { op: "configure-sweep"; testId: EntityId; sweep: Sweep }
  | { op: "configure-corners"; testId: EntityId; cornerSet: CornerSet }
  | { op: "define-measurement"; testId: EntityId; measurement: Measurement }
  | { op: "define-specification"; testId: EntityId; specification: Specification }
  | { op: "set-solver-profile"; testId: EntityId; profile: SolverProfile }
  | { op: "request-run"; runPlanId: EntityId }
  | { op: "propose-design-patch"; description: string; changes: unknown[]; evidence: EvidenceRef[] };

export interface AiStudioProposal {
  id: EntityId;
  summary: string;
  rationale: string;
  confidence: number;
  assumptions: string[];
  uncertainty?: string;
  operations: Array<{ approval: ApprovalLevel; operation: AiStudioOperation }>;
  evidence: EvidenceRef[];
  createdAt: IsoTimestamp;
}

export interface ModelImportReport {
  fileName: string;
  encoding: string;
  dialect: string;
  declarations: Array<{ kind: "model" | "subckt"; name: string; pins: string[]; line: number }>;
  includes: Array<{ path: string; line: number }>;
  unsupported: Array<{ syntax: string; line: number; message: string }>;
  warnings: string[];
  candidate: ModelAsset;
}

export interface SpiceReport {
  id: EntityId;
  title: string;
  generatedAt: IsoTimestamp;
  projectId: EntityId;
  projectRevision: number;
  designRevisionId: EntityId;
  runIds: EntityId[];
  modelInventory: Array<{ id: EntityId; name: string; version: string; checksum: string; status: ValidationStatus; provenance: string }>;
  testSummary: Array<{ testId: EntityId; name: string; analyses: string[]; runCount: number }>;
  specificationMatrix: Array<{ specification: string; unit: string; cells: Array<{ runId: EntityId; status: SpecificationState; value?: number }> }>;
  warnings: string[];
  reproducibility: { simulatorVersions: string[]; seeds: number[]; manifestIds: string[] };
}
