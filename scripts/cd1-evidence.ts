import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalBenchmarkJson } from "../app/lib/benchmark/stable";
import { EMBEDDED_LOW_VOLTAGE_PROFILE_V1 } from "../app/lib/requirements/capability";
import { REQUIREMENTS_CORPUS_V1 } from "../app/lib/requirements/corpus";

const root = process.cwd();
const output = path.join(root, "artifacts", "cd-01");

const intentInventory = [
  { source: "lib/persistence.ts SavedProject.name", owner: "project owner/UI", identity: "project id", typing: "string", provenance: "local project record", authority: "not requirement authority", constraintRelation: "none", evidenceRelation: "none", collaboration: "localStorage", migration: "preserve as project metadata; do not fabricate a requirement" },
  { source: "app/api/schematic/** prompt", owner: "requesting user", identity: "HTTP request only", typing: "free text", provenance: "not durably pinned", authority: "ambiguous", constraintRelation: "direct generation can bypass Stage 6 intent", evidenceRelation: "none", collaboration: "none", migration: "adapt through CD-1 source ingestion before CD-2/CD-8; not cut over in this stage" },
  { source: "app/api/chat/route.ts designConstraints", owner: "AI chat caller", identity: "none", typing: "unknown JSON", provenance: "request-scoped", authority: "none", constraintRelation: "parallel constraint context", evidenceRelation: "none", collaboration: "none", migration: "deprecate as authority; pass package/constraint stable refs through a later adapter" },
  { source: "app/lib/constraints ConstraintDocument", owner: "Stage 6", identity: "stable id/revision", typing: "typed exact quantities", provenance: "ConstraintOrigin", authority: "review state", constraintRelation: "authoritative constraint truth", evidenceRelation: "evaluation IDs", collaboration: "Stage 6 transactions", migration: "preserve; CD-1 emits draft proposals only; report orphans" },
  { source: "manufacturing profiles and fabrication presets", owner: "manufacturing/Stage 6", identity: "profile revision", typing: "typed", provenance: "profile source", authority: "organization/manufacturer", constraintRelation: "compiled Stage 6 input", evidenceRelation: "Stage 3 readiness", collaboration: "project state", migration: "keep separate; reference as a named source/default only when explicitly selected" },
  { source: "Stage 5 component claims/guidance", owner: "atomic library", identity: "part/source/evidence revisions", typing: "typed quantities", provenance: "evidence graph", authority: "publication/claim state", constraintRelation: "guidance conversion", evidenceRelation: "component evidence", collaboration: "database", migration: "observed feasibility context, never user requirement" },
  { source: "Stage 3 readiness/check policies", owner: "readiness engine", identity: "claim/policy/check versions", typing: "pass/fail/unknown/not-run/unsupported/stale", provenance: "revision-bound evidence", authority: "checker", constraintRelation: "coverage consumer", evidenceRelation: "authoritative PCB evidence", collaboration: "release history", migration: "keep evidence separate; CD-1 obligations start planned" },
  { source: "Stage 9 BenchmarkPackage expectations", owner: "benchmark governance", identity: "package/version/digest", typing: "oracle properties", provenance: "license/source declarations", authority: "benchmark only", constraintRelation: "fixture refs", evidenceRelation: "oracle results", collaboration: "immutable artifacts", migration: "adapter source kind; never convert oracle expectations into customer requirements" },
  { source: "comments/issues/approvals/waivers", owner: "collaborators/reviewers", identity: "partial by subsystem", typing: "mixed", provenance: "partial", authority: "role-specific", constraintRelation: "waivers separate", evidenceRelation: "waivers do not pass evidence", collaboration: "Stage 10 foundation", migration: "explicit source/approval adapters still required" },
  { source: "downloaded specifications and agent prompts", owner: "user/external author", identity: "filesystem only", typing: "Markdown/free text", provenance: "not project-pinned", authority: "unknown until reviewed", constraintRelation: "none", evidenceRelation: "none", collaboration: "none", migration: "ingest immutable artifact with access policy; extraction remains proposed" },
];

const testCategories = [
  [1, "Schema/canonical serialization", "covered", "runtime validation, package integrity, deterministic digest"],
  [2, "Source provenance", "covered", "immutable revision, spans, excerpts, integrity"],
  [3, "Stable identity/lineage", "covered", "wording-independent lineage and revisions"],
  [4, "Units/quantities", "covered", "Stage 6 exact decimals and unit equivalence"],
  [5, "Value semantics", "partial", "types distinguish semantics; complete registry/validation remains"],
  [6, "Conditions/modes", "covered", "true/false/unknown evaluation and preservation"],
  [7, "Structured extraction", "covered", "strict proposal schema and AI confirmation rejection"],
  [8, "Extraction robustness", "partial", "text/Markdown/JSON; no PDF/OCR/multilingual model study"],
  [9, "Compound requirements", "partial", "diagnosed; automatic safe split workflow not implemented"],
  [10, "Duplicate/refinement", "partial", "exact semantic duplicates; broader semantic similarity absent"],
  [11, "Quality/ambiguity", "covered", "vague, compound, subject, conditions, standards"],
  [12, "Conflicts", "partial", "numeric/equality/set/capability; budget/mandate algorithms remain"],
  [13, "Minimal conflict explanation", "covered", "stable IDs, normalized values, minimal pair, actions"],
  [14, "Unknown/hypothesis/assumption/default", "covered", "separate types, storage, UI summary"],
  [15, "High-risk assumptions", "covered", "risk floor, AI prohibition, human approval"],
  [16, "Assumption propagation", "covered", "exact dependency keys; product-wide consumer cutover remains"],
  [17, "Defaults", "partial", "named records/visibility; profile deprecation flow remains"],
  [18, "Capability profiles", "covered", "six support states, immutable profile/digest"],
  [19, "Aggregate capability", "covered", "unsupported confirmed hard demand blocks"],
  [20, "Clarification questions", "covered", "diagnostic-linked narrow questions"],
  [21, "Question prioritization", "covered", "explicit deterministic score breakdown"],
  [22, "Answer transactions", "partial", "source-backed patch required; answer-only mutation rejected"],
  [23, "No-answer behavior", "covered", "blockers stay open; high-risk auto-answer forbidden"],
  [24, "Constraint lowering", "covered", "draft proposal, units, condition, provenance"],
  [25, "Deferred scopes", "covered", "typed roles and no invented objects/enforcement"],
  [26, "Verification obligations", "covered", "hard/target plans and planned status"],
  [27, "Acceptance matrix", "covered", "every active hard requirement represented"],
  [28, "Requirement versus evidence", "covered", "planned never pass and no evidence refs"],
  [29, "Package status aggregation", "covered", "contradiction/capability/questions/approval states"],
  [30, "Revision/diff", "covered", "field diff/source diff/obligations/capability"],
  [31, "Dependency invalidation", "covered", "exact requirement/assumption keys; full product graph pending"],
  [32, "Collaboration/conflicts", "covered", "overlap conflicts/no last-writer-wins"],
  [33, "Undo/restore", "not_run", "requirements inverse/branch restore not implemented"],
  [34, "Legacy migration", "covered", "proposed prose and orphan constraint report"],
  [35, "AI boundary", "covered", "AI cannot confirm/approve/activate/pass"],
  [36, "Prompt injection/malicious source", "covered", "untrusted evidence, bounded input, malformed JSON/units"],
  [37, "Privacy/authorization", "partial", "scoped API, access metadata, benchmark exclusion; production auth not deployed"],
  [38, "Determinism", "covered", "reorder equality and governed benchmark"],
  [39, "Incremental/full differential", "partial", "semantic transaction recompile; mutation-sequence oracle incomplete"],
  [40, "Large package performance", "covered", "500 requirements, 3 trials; UI/merge tails not measured"],
  [41, "Expert rubric", "not_run", "rubric declared; qualified blind review not performed"],
  [42, "Provider/model variation", "not_run", "no pinned multi-provider extraction study"],
  [43, "Full fixture end-to-end", "partial", "18 governed declarations; four executable Stage 9 packages"],
  [44, "PCB Stage 1-10 regressions", "partial", "889 pass serial; default parallel has three timing gates"],
  [45, "Commands/evidence", "covered", "machine-readable artifact and exact command record"],
].map(([category, name, state, evidence]) => ({ category, name, state, evidence }));

const evidence = {
  schema: "sirkit.cd1-implementation-evidence.v1",
  generatedAt: "2026-07-17T17:00:00.000-04:00",
  prompt: { path: "C:/Users/robsa/Downloads/sirkit-cd-01-requirements-compiler-assumption-ledger-agent-prompt.md", sha256: "06FE368479E09D84406F3DF1C7AEA37E97EC44FAF0910FF1801A634B95775F95" },
  workspace: { protectedCopy: "C:/Users/robsa/Documents/Codex/2026-07-13/do/work/sirkit-edit", originalUntouched: "C:/Users/robsa/sirkit", branch: "codex/cd-01-requirements-compiler" },
  versions: { schema: "sirkit.requirements.v1", compiler: "sirkit-requirements/1.0.0", lowering: "sirkit-requirement-lowering/1.0.0", profile: "embedded-low-voltage-v1@1.0.0" },
  prerequisiteEvidence: [
    { stage: 1, available: true, contract: "stable PCB identities and protected mutations", limitation: "CD-1 IDs use the shared deterministic engineering digest" },
    { stage: 2, available: true, contract: "stable electrical vocabulary", limitation: "CD-1 references roles and does not create another electrical graph" },
    { stage: 3, available: true, contract: "pass/fail/unknown/not-run/unsupported/stale remain distinct", limitation: "CD-1 plans obligations without creating Stage 3 evidence" },
    { stage: 4, available: true, contract: "stackup/plane/manufacturing vocabulary", limitation: "requirements do not claim physical realization" },
    { stage: 5, available: true, contract: "typed component quantities and evidence", limitation: "full schematic consumer integration is previously documented incomplete" },
    { stage: 6, available: true, contract: "typed constraints, exact units, conditions, proposals", limitation: "product-wide authoring/apply cutover is previously documented incomplete" },
    { stage: 7, available: true, contract: "placement capability/evidence vocabulary", limitation: "richer downstream checkers remain incomplete" },
    { stage: 8, available: true, contract: "routing capability/evidence vocabulary", limitation: "advanced differential/shove/tuning remains incomplete" },
    { stage: 9, available: true, contract: "governed packages, licenses, oracles, hidden holdout", limitation: "expert protocol and licensed-open corpus remain incomplete" },
    { stage: 10, available: "foundation_only", contract: "actors, digests, revision vectors, dependencies, conflict/proposal patterns", limitation: "canonical operations are PCB-only and production collaboration is not deployed; CD-1 uses a compatible adapter and does not force intent into nm operations" },
  ],
  commands: [
    { command: "npx vitest run app/lib/requirements/__tests__ app/components/requirements/__tests__ app/lib/benchmark/__tests__/stage-09-benchmark-core.test.ts --reporter=dot", result: "7 files, 74 passed" },
    { command: "npm run benchmark:validate", result: "24 packages, zero diagnostics" },
    { command: "npx tsx scripts/benchmark.ts run <each CD-1 package>", result: "4 of 4 passed" },
    { command: "npm test -- --reporter=dot", result: "891 passed, 9 skipped, 4 contention-sensitive timing failures" },
    { command: "npx vitest run app/lib/pcb/__tests__/auto-place.test.ts app/lib/pcb/__tests__/pcb-repair-agent.test.ts app/lib/pcb/__tests__/route-tool.test.ts --reporter=verbose", result: "3 files, 40 passed; timing gates passed in isolation" },
    { command: "npx vitest run --reporter=dot --maxWorkers=1", result: "136 files passed, 2 skipped; 895 tests passed, 9 skipped" },
    { command: "npx tsc --noEmit --pretty false", result: "passed" },
    { command: "npx eslint <CD-1 and touched integration paths>", result: "passed, zero warnings" },
    { command: "npm run build", result: "passed; 51 pages; five inherited dynamic executable tracing warnings" },
    { command: "npm run benchmark:baseline", result: "not rerun: immutable pre-CD-1 corpus-v1.json already exists (EEXIST); existing artifact preserved" },
  ],
  benchmarks: [
    { packageId: "sirkit-v1:cd1-requirements-determinism", runId: "benchmark-run:6f284cc7b7aec8c95904b01520e3bb14", state: "passed", elapsedMs: [18.4039] },
    { packageId: "sirkit-v1:cd1-malicious-source", runId: "benchmark-run:247371d4266235563e1d5fd2482be30f", state: "passed", elapsedMs: [9.0909] },
    { packageId: "sirkit-v1:cd1-vague-holdout", runId: "benchmark-run:13d006f411e2a8b62c680dcab06b4d0c", state: "passed", elapsedMs: [16.8335] },
    { packageId: "sirkit-v1:cd1-large-package", runId: "benchmark-run:ba340489bc9742aa7ff87a898ad0b405", state: "passed", elapsedMs: [904.0424, 1448.1533, 2236.0706], medianMs: 1448.1533 },
  ],
  acceptance: { covered: testCategories.filter((item) => item.state === "covered").length, partial: testCategories.filter((item) => item.state === "partial").length, notRun: testCategories.filter((item) => item.state === "not_run").length, total: testCategories.length },
  verdict: "CD-1 INCOMPLETE",
  smallestRemainingWork: [
    "Cut every schematic/chat/project-creation intent path over to the authoritative package before CD-2 or schematic generation runs.",
    "Extend Stage 10 canonical state/operations for durable requirements undo, answer/conflict disposition, merge, server sync, and product-wide dependency invalidation.",
    "Implement PDF/DOCX/OCR/table source adapters and a pinned provider-neutral extraction service with model/prompt/tool version persistence.",
    "Complete compound split/merge, semantic refinement, budget, default-policy, implementation-mandate, and verification-impossibility algorithms.",
    "Run all 18 fixtures end to end, qualified blind expert rubric, multi-provider variation, privacy/tenant penetration, and incremental/full mutation equivalence.",
    "Integrate the workspace into the live project navigation and deploy authenticated database persistence/migration rather than only shipping schemas/repository boundaries.",
  ],
};

async function main(): Promise<void> {
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(path.join(output, "implementation-evidence.json"), `${canonicalBenchmarkJson(evidence)}\n`),
    writeFile(path.join(output, "intent-inventory.json"), `${canonicalBenchmarkJson({ schema: "sirkit.cd1-intent-inventory.v1", items: intentInventory })}\n`),
    writeFile(path.join(output, "test-matrix.json"), `${canonicalBenchmarkJson({ schema: "sirkit.cd1-test-matrix.v1", categories: testCategories })}\n`),
    writeFile(path.join(output, "capability-profile-v1.json"), `${canonicalBenchmarkJson(EMBEDDED_LOW_VOLTAGE_PROFILE_V1)}\n`),
    writeFile(path.join(output, "corpus-v1.json"), `${canonicalBenchmarkJson({ schema: "sirkit.cd1-corpus.v1", fixtures: REQUIREMENTS_CORPUS_V1 })}\n`),
  ]);
  process.stdout.write(`${output}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
