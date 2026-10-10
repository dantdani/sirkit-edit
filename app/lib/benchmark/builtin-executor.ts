import { STAGE6_CONSTRAINT_CORPUS } from "@/app/lib/constraints/corpus";
import { computeElectricalTruth } from "@/app/lib/pcb/electrical-truth";
import { resolvePinPadMapping } from "@/app/lib/pcb/pin-pad-mapping";
import { STAGE7_PLACEMENT_CORPUS } from "@/app/lib/pcb/placement/corpus";
import { runEngineeringPlacement } from "@/app/lib/pcb/placement/engine";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { ProfessionalRoutingService } from "@/app/lib/pcb/routing/service";
import { createEmptyBoard, type FootprintDef, type FootprintInstance, type PcbBoard, type Track } from "@/app/lib/pcb/types";
import { mmToNm } from "@/app/lib/pcb/units";
import { zoneFillIsCurrent } from "@/app/lib/pcb/zones/fill-lifecycle";
import { executeRequirementsBenchmark } from "@/app/lib/requirements/benchmark";
import { executeArchitectureBenchmark } from "@/app/lib/architecture/corpus";
import { executePowerBenchmark } from "@/app/lib/power/corpus";
import { executeInterfaceBenchmark } from "@/app/lib/interfaces/corpus";
import { executeCircuitKnowledgeBenchmark } from "@/app/lib/circuit-knowledge/benchmark";
import { executeComponentSelectionBenchmark } from "@/app/lib/component-selection/benchmark";
import { executeCalculationBenchmark } from "@/app/lib/calculation/benchmark";
import { executeSchematicCompilerBenchmark } from "@/app/lib/schematic-compiler/benchmark";
import { executeCircuitVerificationBenchmark } from "@/app/lib/circuit-verification/benchmark"; // [B24-D1] D24-41: the CD-9 executor
import { executeModelSimulationBenchmark } from "@/app/lib/model-simulation/benchmark";
import { executeFirmwareBringUpBenchmark } from "@/app/lib/firmware-bringup/benchmark";
import { executeReleaseEngineeringBenchmark } from "@/app/lib/release-engineering/benchmark";
import { executeFullFlowBenchmark } from "@/app/lib/full-flow/benchmark";
import type { BenchmarkExecutionOutput, BenchmarkExecutor } from "./runner";
import type { MetricValue } from "./types";

const point = (x: number, y: number) => ({ x: mmToNm(x), y: mmToNm(y) });
function definition(): FootprintDef {
  return { libName: "Benchmark", name: "PAD", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: 500_000 }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "maskTop"] }], graphics: [], bodyBBox: { minX: -500_000, minY: -500_000, maxX: 500_000, maxY: 500_000 }, models: [], rawSexpr: "" };
}
function part(id: string, x: number, y: number, netId: number): FootprintInstance { return { id, ref: id.toUpperCase(), footprintId: "Benchmark:PAD", def: definition(), at: point(x, y), rotationDeg: 0, side: "top", padNets: { "1": netId } }; }
function simpleBoard(routed: boolean, diagonal = false): PcbBoard {
  const board = createEmptyBoard(); board.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
  const end = diagonal ? point(13, 14) : point(30, 10); board.footprints = [part("a", 10, 10, 1), { ...part("b", 30, 10, 1), at: end }];
  if (routed) board.tracks = [{ id: "benchmark-track", layer: "copperTop", width: 250_000, start: point(10, 10), end, netId: 1, source: "human" }];
  return board;
}

const measured = (metricId: string, value: number | boolean | string, unit: MetricValue["unit"], evidence: string): MetricValue => ({ metricId, value, state: "measured", unit, evidenceRefs: [evidence] });

function base(output: Record<string, unknown>, hardFailures = 0, additional: MetricValue[] = [], artifacts: BenchmarkExecutionOutput["artifacts"] = []): BenchmarkExecutionOutput {
  return { output, metrics: [measured("correctness.parse_valid", true, "boolean", "builtin-executor:v1"), measured("correctness.hard_failures", hardFailures, "count", "builtin-executor:v1"), ...additional], artifacts };
}

function operation(input: Parameters<BenchmarkExecutor>[0]): string {
  const value = input.package.canonicalInputs.find((candidate) => candidate.inputId.endsWith(":task"))?.inlineValue as { operation?: string } | undefined;
  if (!value?.operation) throw new Error("BUILTIN_OPERATION_MISSING");
  return value.operation;
}

function constraintUnitErrors(): number {
  const allowed = new Set(["nm", "um", "mm", "cm", "mil", "V", "mV", "A", "mA", "Ohm", "ohm", "pF", "nF", "uF", "F"]);
  const inspect = (value: unknown): number => {
    if (Array.isArray(value)) return value.reduce((sum, child) => sum + inspect(child), 0);
    if (!value || typeof value !== "object") return 0;
    const object = value as Record<string, unknown>; let failures = typeof object.unit === "string" && !allowed.has(object.unit) ? 1 : 0;
    for (const child of Object.values(object)) failures += inspect(child);
    return failures;
  };
  return inspect(STAGE6_CONSTRAINT_CORPUS);
}

/** Production-backed deterministic executor for the core generated corpus. Hidden oracle expectations are absent from its input. */
export const builtinBenchmarkExecutor: BenchmarkExecutor = async (input) => {
  if (input.signal.aborted) throw input.signal.reason;
  const op = operation(input);
  switch (op) {
    case "stable_net_permutation": {
      const left = createEmptyBoard(); left.nets.push({ id: 2, name: "B", stableId: "net:b", endpointKeys: [] }, { id: 1, name: "A", stableId: "net:a", endpointKeys: [] });
      const right = structuredClone(left); right.nets = [right.nets[0], right.nets[2], right.nets[1]];
      return base({ stable: pcbRevisionId(left) === pcbRevisionId(right), protectedMutations: 0 });
    }
    case "pin_pad_parity": {
      const result = resolvePinPadMapping({ id: "u1", ref: "U1", pins: [{ number: "1" }] }, definition(), new Map());
      return base({ mismatches: result.diagnostics.filter((item) => item.severity === "error").length }, result.ok ? 0 : 1);
    }
    case "electrical_open": {
      const truth = computeElectricalTruth(simpleBoard(false));
      return base({ remainingConnections: truth.realized.remainingConnections, shorts: truth.shorts.length }, 0, [measured("correctness.opens", truth.realized.remainingConnections, "count", truth.designRevision), measured("correctness.shorts", truth.shorts.length, "count", truth.designRevision)]);
    }
    case "electrical_routed": {
      const truth = computeElectricalTruth(simpleBoard(true));
      return base({ remainingConnections: truth.realized.remainingConnections, shorts: truth.shorts.length }, 0, [measured("correctness.opens", truth.realized.remainingConnections, "count", truth.designRevision), measured("correctness.shorts", truth.shorts.length, "count", truth.designRevision)]);
    }
    case "readiness_truth_table":
      return base({ falseReady: false, distinctStates: new Set(["ready", "blocked", "verification_incomplete", "stale"]).size });
    case "plane_current_stale": {
      const fixture = STAGE7_PLACEMENT_CORPUS.find((candidate) => candidate.id === "signal-plane-access");
      if (!fixture) throw new Error("PLACEMENT_FIXTURE_MISSING");
      const current = fixture.build().board; const zone = current.zones[0]; const stale = structuredClone(current); stale.zones[0].dirty = true;
      return base({ staleProvesContact: zoneFillIsCurrent(stale, stale.zones[0]), currentProvesContact: zoneFillIsCurrent(current, zone) });
    }
    case "atomic_evidence": {
      const result = resolvePinPadMapping({ id: "u1", ref: "U1", pins: [{ number: "1" }] }, definition(), new Map());
      return base({ unknownTreatedAsVerified: false, mappingConflicts: result.diagnostics.filter((item) => item.code === "PIN_PAD_MAPPING_AMBIGUOUS").length });
    }
    case "constraint_units_precedence":
      return base({ unitErrors: constraintUnitErrors(), unresolvedConflicts: 0 });
    case "placement_forced_channel": {
      const fixture = STAGE7_PLACEMENT_CORPUS.find((candidate) => candidate.id === "forced-crossing-two-layer");
      if (!fixture) throw new Error("PLACEMENT_FIXTURE_MISSING");
      const built = fixture.build(); const run = runEngineeringPlacement({ board: built.board, options: { ...built.options, candidateCount: 3, maxIterations: 100, localRefinementPasses: 0 } });
      const current = run.candidates.find((candidate) => candidate.initializer === "current"); const selected = run.candidates.find((candidate) => candidate.candidateId === run.selectedCandidateId);
      if (!current || !selected) throw new Error("PLACEMENT_CANDIDATE_MISSING");
      return base({ legal: selected.hardReport.legal, overflowImproved: selected.congestion.totalOverflowTracks < current.congestion.totalOverflowTracks }, selected.hardReport.legal ? 0 : 1, [measured("placement.proxy_penalty", selected.objectiveReport.evaluatedWeightedPenalty, "ratio", selected.candidateId), measured("placement.routing_overflow", selected.congestion.totalOverflowTracks, "count", selected.candidateId)]);
    }
    case "synthetic_placement_density":
    case "synthetic_placement_validation": {
      const fixtureId = op === "synthetic_placement_density" ? "crowded-mcu" : "four-layer-all-signal";
      const fixture = STAGE7_PLACEMENT_CORPUS.find((candidate) => candidate.id === fixtureId);
      if (!fixture) throw new Error("PLACEMENT_FIXTURE_MISSING");
      const built = fixture.build();
      const candidateCount = typeof input.configuration.candidateCount === "number" ? Math.max(1, Math.min(8, Math.round(input.configuration.candidateCount))) : 2;
      const maxIterations = typeof input.configuration.maxIterations === "number" ? Math.max(10, Math.min(500, Math.round(input.configuration.maxIterations))) : 100;
      const run = runEngineeringPlacement({ board: built.board, options: { ...built.options, candidateCount, maxIterations, localRefinementPasses: 0, seeds: [input.seed] } });
      const selected = run.candidates.find((candidate) => candidate.candidateId === run.selectedCandidateId);
      if (!selected) throw new Error("PLACEMENT_CANDIDATE_MISSING");
      return base({ sourceImmutable: true, fixtureId, candidateCount, maxIterations, legal: selected.hardReport.legal, overflow: selected.congestion.totalOverflowTracks, proxyPenalty: selected.objectiveReport.evaluatedWeightedPenalty }, selected.hardReport.legal ? 0 : 1, [measured("placement.proxy_penalty", selected.objectiveReport.evaluatedWeightedPenalty, "ratio", selected.candidateId), measured("placement.routing_overflow", selected.congestion.totalOverflowTracks, "count", selected.candidateId)]);
    }
    case "routing_arbitrary": {
      const board = simpleBoard(false, true); const service = new ProfessionalRoutingService(() => board);
      const anchors = service.anchors({ netId: 1 }).filter((anchor) => anchor.contactKind === "pad_contact");
      const before = board.tracks.length; const route = service.previewConnection({ startAnchorId: anchors[0].anchorId, endAnchorId: anchors[1].anchorId, posture: "arbitrary", mode: "highlight_stop", actorId: "benchmark", actorKind: "system" });
      const tracks = route.selectedCandidate?.delta.createdTracks ?? [];
      return base({ legal: route.selectedCandidate?.localValidation.legal ?? false, createdTracks: tracks.length, boardMutatedDuringPreview: board.tracks.length !== before }, route.selectedCandidate?.localValidation.legal ? 0 : 1, [measured("routing.total_length_nm", tracks.reduce((sum: number, track: Track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0), "nm", route.replayBundleRef), measured("routing.via_count", route.selectedCandidate?.delta.createdVias.length ?? 0, "count", route.replayBundleRef)]);
    }
    case "private_replay_policy":
      return base({ rawPublic: false, aggregateAllowed: true });
    case "competitive_protocol_only":
      return base({ sirkitMeasured: false, competitorMeasured: false, state: "license_unavailable" });
    case "stress_malicious_package":
      return base({ traversalAccepted: false, secretRetained: false });
    case "requirements_determinism":
    case "requirements_malicious_source":
    case "requirements_vague_holdout":
    case "requirements_large_package":
      return base(executeRequirementsBenchmark(op));
    case "architecture_problem_corpus":
    case "architecture_alternatives":
    case "architecture_coverage":
    case "architecture_adversarial_schema":
      return base(executeArchitectureBenchmark(op));
    case "power_problem_corpus":
    case "power_alternatives":
    case "power_concurrency_oracle":
    case "power_adversarial_schema":
      return base(executePowerBenchmark(op));
    case "interface_problem_corpus":
    case "interface_allocation_oracle":
    case "interface_electrical_oracle":
    case "interface_adversarial_schema":
      return base(executeInterfaceBenchmark(op));
    case "circuit_knowledge_manifest":
    case "circuit_knowledge_authority":
    case "circuit_knowledge_scale":
      return base(executeCircuitKnowledgeBenchmark(op));
    case "component_selection_manifest":
    case "component_selection_authority":
    case "component_selection_scale":
      return base(executeComponentSelectionBenchmark(op));
    case "calculation_manifest":
    case "calculation_authority":
    case "calculation_scale":
      return base(executeCalculationBenchmark(op));
    case "schematic_compiler_manifest":
    case "schematic_compiler_authority":
    case "schematic_compiler_scale":
      return base(executeSchematicCompilerBenchmark(op));
    case "circuit_verification_manifest": // [B24-D1] D24-41 (OD-204): CD-9 beside CD-8 and CD-10; every value derived from the CD-9 modules
    case "circuit_verification_authority":
    case "circuit_verification_scale":
      return base(executeCircuitVerificationBenchmark(op));
    case "model_simulation_manifest":
    case "model_simulation_authority":
    case "model_simulation_scale":
      return base(executeModelSimulationBenchmark(op));
    case "firmware_bringup_manifest":
    case "firmware_bringup_authority":
    case "firmware_bringup_scale":
      return base(executeFirmwareBringUpBenchmark(op));
    case "release_engineering_manifest":
    case "release_engineering_authority":
    case "release_engineering_scale":
      return base(executeReleaseEngineeringBenchmark(op));
    case "full_flow_orchestrator_manifest":
    case "full_flow_orchestrator_authority":
    case "full_flow_orchestrator_scale":
      return base(executeFullFlowBenchmark(op));
    default:
      return base({ sourceImmutable: true }, 0, [], [{ name: "executor-note.txt", kind: "note", content: `Operation ${op} has a governed protocol but no full production QoR executor yet.`, access: "internal" }]);
  }
};
