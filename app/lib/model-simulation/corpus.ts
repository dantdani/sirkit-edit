import { simulationDigest, simulationId } from "./stable";

export interface ModelSimulationCorpusCase { caseId: string; category: string; ordinal: number; title: string; expectedApplicability: "supported" | "unsupported" | "blocked_missing_evidence"; expectedResult: "pass" | "fail" | "indeterminate_numeric" | "nonconverged" | "not_evaluated"; expectedLimitations: string[]; implementationState: "manifest_only" | "automated_fixture" | "expert_reviewed"; evidenceRefs: string[]; deterministicDigest: string }
const requiredCategories: Array<{ category: string; count: number; title: string }> = [
  { category: "model_identity_binding", count: 12, title: "Exact model identity and binding" },
  { category: "netlist_lowering", count: 11, title: "Semantic netlist lowering" },
  { category: "dc", count: 9, title: "DC operating point and sweep" },
  { category: "transient", count: 12, title: "Transient startup, sequence, load, and fault" },
  { category: "ac_stability", count: 9, title: "AC, impedance, filter, and stability" },
  { category: "noise_distortion", count: 9, title: "Capability-gated noise and distortion" },
  { category: "corner_statistical", count: 11, title: "Corners, worst-case, Monte Carlo, and sensitivity" },
  { category: "measurement_assertion", count: 10, title: "Typed measurement and assertion" },
  { category: "convergence_security", count: 11, title: "Convergence, execution, cache, and security" },
  { category: "full_embedded_campaign", count: 8, title: "Full low-voltage embedded campaign" },
];
function makeCase(category: string, ordinal: number, title: string): ModelSimulationCorpusCase { const body = { category, ordinal, title: `${title} ${String(ordinal).padStart(2, "0")}`, expectedApplicability: "blocked_missing_evidence" as const, expectedResult: "not_evaluated" as const, expectedLimitations: ["Manifest entry only; licensed model/source, golden output, mutation evidence, and qualified simulation review are not yet attached."], implementationState: "manifest_only" as const, evidenceRefs: ["Sirkit CD-10 specification required verification corpus"] }; const caseId = simulationId("cd10-corpus-case", body); return { ...body, caseId, deterministicDigest: simulationDigest({ ...body, caseId }) }; }
export const MODEL_SIMULATION_CORPUS = requiredCategories.flatMap((entry) => Array.from({ length: entry.count }, (_, index) => makeCase(entry.category, index + 1, entry.title)));
export const MODEL_SIMULATION_CORPUS_DIGEST = simulationDigest(MODEL_SIMULATION_CORPUS);
export function validateModelSimulationCorpus(): string[] { const errors: string[] = []; if (MODEL_SIMULATION_CORPUS.length !== 102) errors.push("CD10_CORPUS_REQUIRED_COUNT_MISMATCH"); if (new Set(MODEL_SIMULATION_CORPUS.map((item) => item.caseId)).size !== MODEL_SIMULATION_CORPUS.length) errors.push("CD10_CORPUS_DUPLICATE_ID"); for (const item of MODEL_SIMULATION_CORPUS) if (item.deterministicDigest !== simulationDigest({ ...item, deterministicDigest: undefined })) errors.push(`CD10_CORPUS_DIGEST_MISMATCH:${item.caseId}`); return errors; }
