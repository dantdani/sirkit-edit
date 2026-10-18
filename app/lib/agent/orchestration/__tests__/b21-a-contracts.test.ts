/**
 * [B21 A] The canonical provider-neutral orchestration contracts (`sirkit.specialist-request.v1`,
 * `sirkit.specialist-result.v1`): closed key sets checked before any digest, the key-name denylist (the capsule's exact
 * keys, every credential-shaped name, every reasoning / thinking / continuation / chain-of-thought-shaped name), bounded
 * strings and arrays, the structural tool-request gate (D21-1: a result naming a release, a qualification or any id
 * outside the 33 [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): the exposure list, 36 since B22-B] never validates), the closed verifier set a validation request may bind, the A4L semantics of
 * `allowedToolIds`, the recomputed `artifactDigest` of every proposed action, the four REAL sealed artifacts wrapped verbatim
 * (the sealers' declared authorization-binding names exempt from the name check, their values scanned), a wrapped artifact's
 * interior scanned for names and values at every level, credential-shaped ids refused, hostile documents that never throw and
 * never survive capture, reproducible whole-body digests, the nine roles pinned, and the module read as text: no provider SDK,
 * and nothing that names authority.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isOwnedCapture } from "@/app/lib/agent/plain-capture";
import { foldFieldName, isCredentialShapedName } from "@/app/lib/agent/redaction";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS } from "@/app/lib/engineering/agent-exposure";
import { REPLACEMENT_PROPOSAL_KEYS, REPLACEMENT_PROPOSAL_SCHEMA } from "@/app/lib/engineering/replacement-proposals";
import { TIER1_PROPOSAL_SCHEMA } from "@/app/lib/engineering/schematic-proposals";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { LAYOUT_CANDIDATE_SCHEMA, layoutCandidateIntact } from "@/app/lib/pcb/candidates/layout-candidate";
import { PCB_EDIT_PROPOSAL_KEYS, PCB_EDIT_PROPOSAL_SCHEMA } from "@/app/lib/pcb/proposal/sealed-pcb-edit-proposal";
import { DEFAULT_AGENT_BUDGET } from "@/app/lib/agent/contracts";
import {
  AGENT_BUDGET_KEYS, CAPSULE_DENYLIST_KEYS, CONFIDENCE_LEVELS, EVIDENCE_EXTRACTION_METHODS, EVIDENCE_KINDS, EVIDENCE_SOURCE_CLASSES,
  ORCHESTRATION_BOUNDS, ORCHESTRATION_REFUSALS, PROPOSED_ACTION_KINDS, REASONING_SHAPED_STEMS, REQUIRED_OUTPUT_NAMES, RISK_SEVERITIES,
  SEALED_ARTIFACT_DECLARED_NAMES, SPECIALIST_REQUEST_SCHEMA, SPECIALIST_RESULT_SCHEMA, SPECIALIST_ROLES, VALIDATION_BINDING_TOOL_IDS,
  isForbiddenOrchestrationKeyName, isOrchestrationId, validateSpecialistRequest, validateSpecialistResult, validatedDigestOf,
  type OrchestrationRefusal, type OrchestrationValidation,
} from "../contracts";
import { BUDGET, DIGEST_A, DIGEST_B, SCOPE, TIER1_KIND, action, payloadOf, validRequest, validResult } from "./_fixtures";
import { sealedArtifacts } from "./_sealed-artifacts";

const ROOT = process.cwd();
const MODULE = "app/lib/agent/orchestration/contracts.ts";
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const EXPOSED: readonly string[] = INTENTIONAL_AGENT_EXPOSED_TOOL_IDS;
/** every text bound in one place: a string of exactly `n` characters */
const chars = (n: number): string => "x".repeat(n);
/** the members of one string-literal union type, read from a source file as text (the atomic vocabularies have no runtime array):
 *  one member per `| "..."` line, so a member with a digit or a capital is kept and a quoted word in a comment is never counted
 *  [B21 A review: the earlier `"[a-z_]+"` scan over the whole block silently dropped the former and admitted the latter] */
function unionMembers(source: string, typeName: string): string[] {
  const block = source.match(new RegExp(`export type ${typeName} =([^;]*);`))?.[1] ?? "";
  return [...block.matchAll(/^\s*\|\s*"([^"]+)"/gm)].map((match) => match[1]!);
}
/** a key-shaped string assembled at run time (never a literal) */
const keyShaped = (): string => ["sk-", "ant-api03-", "A".repeat(40)].join("");
/** every key name of a plain tree, with its path, at every level */
function keyPaths(value: unknown, path = "$"): Array<[string, string]> {
  if (Array.isArray(value)) return value.flatMap((entry, index) => keyPaths(entry, `${path}[${index}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [[key, `${path}.${key}`] as [string, string], ...keyPaths(child, `${path}.${key}`)]);
}

function refused(outcome: OrchestrationValidation<unknown>, refusal: OrchestrationRefusal, path?: string): void {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.refusal).toBe(refusal);
  if (path !== undefined) expect(outcome.path).toBe(path);
}

function accepted<T>(outcome: OrchestrationValidation<T>): { value: T; digest: string } {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(`refused ${outcome.refusal} at ${outcome.path}`);
  return { value: outcome.value, digest: outcome.digest };
}
/** a result wrapping one payload under its own kind with the correct digest */
const wrapped = (kind: string, payload: Record<string, unknown> | object): Record<string, unknown> => validResult({ proposedActions: [{ kind, payload, artifactDigest: engineeringDigest(payload) }] });

describe("[B21 A] the canonical orchestration contracts", () => {
  it("1. the vocabularies are closed and pinned: nine kebab-case roles in the runbook's order, four action kinds equal to the sealed families' live schema ids, five evidence kinds, the source classes (the atomic SourceClass union plus the one orchestration-only `deterministic_verifier`) and extraction methods (the atomic union exactly), the confidence and severity triples, the budget keys (the loop's six plus the two token counts), the required-output names (the result's content keys, sorted), the five verifier ids a validation request may bind (a subset of the exposure list: 33 ids when written, 36 since B22-B), the three declared names, the bounds and the refusal vocabulary - every one frozen; the union extractor keeps a digit-bearing member and ignores a quoted word in a comment", () => { // [B22 closeout, 2026-10-02] retitled (D22-16): 36 since B22-B (OD-139); assertions unchanged
    expect(SPECIALIST_ROLES).toEqual(["coordinator", "requirements-analyst", "circuit-topology", "component-sourcing-evidence", "schematic", "pcb-placement-routing", "verification-critic", "manufacturing-readiness-reviewer", "cost-latency-router"]);
    for (const role of SPECIALIST_ROLES) expect(role).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(PROPOSED_ACTION_KINDS).toEqual([TIER1_PROPOSAL_SCHEMA, REPLACEMENT_PROPOSAL_SCHEMA, PCB_EDIT_PROPOSAL_SCHEMA, LAYOUT_CANDIDATE_SCHEMA]);
    expect(PROPOSED_ACTION_KINDS).toEqual(["sirkit.schematic-tier1-proposal.v3", "sirkit.schematic-replacement-proposal.v2", "sirkit.pcb-bounded-edit-proposal.v2", "sirkit.layout-candidate.v1"]);
    expect(EVIDENCE_KINDS).toEqual(["readiness-report", "qualification-authority", "atomic-evidence", "resource-envelope", "trace-event"]);
    const atomic = read("app/lib/atomic/types.ts");
    expect(unionMembers(atomic, "SourceClass")).toHaveLength(12);
    expect(EVIDENCE_SOURCE_CLASSES).toEqual([...unionMembers(atomic, "SourceClass"), "deterministic_verifier"]);
    expect(EVIDENCE_EXTRACTION_METHODS).toEqual(unionMembers(atomic, "ExtractionMethod"));
    expect(EVIDENCE_EXTRACTION_METHODS).toEqual(["manual", "structured_api", "kicad_parser", "deterministic_inference", "ocr", "llm"]);
    // [B21 A review] the extractor itself, on a probe union: a digit-bearing member kept, a quoted word inside a comment ignored
    expect(unionMembers(['export type Probe =', '  | "alpha"', '  /** a "quoted" word in a comment */', '  | "iso_9001";'].join(String.fromCharCode(10)), "Probe")).toEqual(["alpha", "iso_9001"]);
    expect(CONFIDENCE_LEVELS).toEqual(["low", "medium", "high"]);
    expect(RISK_SEVERITIES).toEqual(["low", "medium", "high"]);
    expect(AGENT_BUDGET_KEYS).toEqual([...Object.keys(DEFAULT_AGENT_BUDGET), "maxInputTokens", "maxOutputTokens"]);
    expect(AGENT_BUDGET_KEYS).toHaveLength(8);
    expect(REQUIRED_OUTPUT_NAMES).toEqual(["assumptions", "confidence", "evidence", "proposedActions", "requiredTools", "risks", "summary", "unresolvedQuestions", "validationRequests"]);
    expect(Object.keys(validResult()).filter((key) => key !== "schema" && key !== "role").sort()).toEqual([...REQUIRED_OUTPUT_NAMES]);
    // [B21 A review] the deterministic verifiers a validation request may bind: the two validators, the readiness report, the two revision inspections
    expect(VALIDATION_BINDING_TOOL_IDS).toEqual(["sirkit.manufacturing.readiness-inspect", "sirkit.pcb.revision-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"]);
    for (const toolId of VALIDATION_BINDING_TOOL_IDS) expect(EXPOSED).toContain(toolId);
    expect(SEALED_ARTIFACT_DECLARED_NAMES).toEqual(["authorization", "authorizationBinding", "authorizationSchema"]);
    expect(ORCHESTRATION_BOUNDS).toMatchObject({ maxSummaryChars: 4_000, maxTextChars: 1_000, maxArrayEntries: 32, maxAllowedToolIds: 32 });
    expect(SPECIALIST_REQUEST_SCHEMA).toBe("sirkit.specialist-request.v1");
    expect(SPECIALIST_RESULT_SCHEMA).toBe("sirkit.specialist-result.v1");
    expect(new Set(ORCHESTRATION_REFUSALS).size).toBe(ORCHESTRATION_REFUSALS.length);
    expect(ORCHESTRATION_REFUSALS).toHaveLength(29);
    for (const value of [SPECIALIST_ROLES, PROPOSED_ACTION_KINDS, EVIDENCE_KINDS, EVIDENCE_SOURCE_CLASSES, EVIDENCE_EXTRACTION_METHODS, CONFIDENCE_LEVELS, RISK_SEVERITIES, AGENT_BUDGET_KEYS, REQUIRED_OUTPUT_NAMES, ORCHESTRATION_BOUNDS, ORCHESTRATION_REFUSALS, CAPSULE_DENYLIST_KEYS, REASONING_SHAPED_STEMS, VALIDATION_BINDING_TOOL_IDS, SEALED_ARTIFACT_DECLARED_NAMES]) expect(Object.isFrozen(value)).toBe(true);
  });

  it("2. a valid request validates into an INDEPENDENT deep-frozen snapshot registered with the capture registry and the validated registry; the whole-body digest is reproducible, differs between documents, and later mutation of the caller's object changes nothing", () => {
    const input = validRequest();
    const first = accepted(validateSpecialistRequest(input));
    expect(first.value).not.toBe(input);
    expect(first.value).toEqual(input);
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(Object.isFrozen((first.value as { scope: object }).scope)).toBe(true);
    expect(isOwnedCapture(first.value)).toBe(true);
    expect(validatedDigestOf(first.value)).toEqual({ schema: SPECIALIST_REQUEST_SCHEMA, digest: first.digest });
    expect(validatedDigestOf(input)).toBeNull();
    expect(validatedDigestOf(structuredClone(first.value))).toBeNull();
    expect(first.digest).toMatch(/^eng1-[0-9a-f]{16}$/);
    expect(first.digest).toBe(engineeringDigest({ schema: SPECIALIST_REQUEST_SCHEMA, body: input }));
    // reproducible: the same document twice; different: any field moved
    expect(accepted(validateSpecialistRequest(validRequest())).digest).toBe(first.digest);
    expect(accepted(validateSpecialistRequest(validRequest({ taskId: "task-2" }))).digest).not.toBe(first.digest);
    // the caller's object is irrelevant after capture
    (input as { objective: string }).objective = "changed afterwards";
    expect((first.value as { objective: string }).objective).not.toBe("changed afterwards");
    expect(accepted(validateSpecialistRequest(validRequest())).digest).toBe(first.digest);
  });

  it("3. a valid result validates with one proposed action of each of the four kinds, each artifactDigest recomputed over the verbatim payload; the result digest is reproducible and differs from the request's; a payload interior is the sealer's structure (a `readiness.state` key below the payload's top level is accepted, bound by the digest; its names and strings are still scanned, case 14)", () => {
    const input = validResult({ proposedActions: PROPOSED_ACTION_KINDS.map((kind) => action(kind)) });
    const first = accepted(validateSpecialistResult(input));
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(isOwnedCapture(first.value)).toBe(true);
    expect(validatedDigestOf(first.value)).toEqual({ schema: SPECIALIST_RESULT_SCHEMA, digest: first.digest });
    expect(first.digest).toBe(engineeringDigest({ schema: SPECIALIST_RESULT_SCHEMA, body: input }));
    expect(accepted(validateSpecialistResult(validResult({ proposedActions: PROPOSED_ACTION_KINDS.map((kind) => action(kind)) }))).digest).toBe(first.digest);
    expect(accepted(validateSpecialistResult(validResult())).digest).not.toBe(first.digest);
    expect(first.digest).not.toBe(accepted(validateSpecialistRequest(validRequest())).digest);
    // the fixture payload really does carry the denylisted name below its top level, and it is accepted there
    expect(Object.keys((payloadOf(TIER1_KIND) as { readiness: object }).readiness)).toContain("state");
    expect(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND)] })).ok).toBe(true);
    // empty lists are valid: a specialist may have nothing to propose, assume, cite, request, warn or ask
    expect(validateSpecialistResult(validResult({ proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [] })).ok).toBe(true);
  });

  it("4. closed key sets, checked before any digest: an unknown key at the top level, in the scope, in the budget, in the PCB basis, in a proposed action, in an evidence reference, in a tool request, in an assumption, a risk, a question and a validation request refuses `unknown_key` with its path; a missing required key refuses `missing_key`; an optional scope key may be absent; a value of the wrong shape refuses `invalid_type`; the wrong schema refuses `schema_mismatch`; a non-object root refuses `not_an_object`", () => {
    refused(validateSpecialistRequest(validRequest({ extra: 1 })), "unknown_key", "$.extra");
    refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, generation: 4 } })), "unknown_key", "$.scope.generation");
    refused(validateSpecialistRequest(validRequest({ budget: { ...BUDGET, costUsd: 1 } })), "unknown_key", "$.budget.costUsd");
    refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, pcbBasis: { ...SCOPE.pcbBasis, boardDigest: "x" } } })), "unknown_key", "$.scope.pcbBasis.boardDigest");
    refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { approved: true })] })), "unknown_key", "$.proposedActions[0].approved");
    refused(validateSpecialistResult(validResult({ evidence: [{ kind: "trace-event", id: "e", digest: DIGEST_A, sourceClass: "deterministic_verifier", reviewed: true, locator: "x" }] })), "unknown_key", "$.evidence[0].locator");
    refused(validateSpecialistResult(validResult({ requiredTools: [{ toolId: "sirkit.validation.drc-run", version: "1.0.0", reason: "r", args: {} }] })), "unknown_key", "$.requiredTools[0].args");
    refused(validateSpecialistResult(validResult({ assumptions: [{ id: "a", statement: "s", evidenceIds: [], rationale: "hidden" }] })), "unknown_key", "$.assumptions[0].rationale");
    refused(validateSpecialistResult(validResult({ risks: [{ id: "r", severity: "low", statement: "s", mitigation: null, owner: "x" }] })), "unknown_key", "$.risks[0].owner");
    refused(validateSpecialistResult(validResult({ unresolvedQuestions: [{ id: "q", question: "?", blocking: false, answer: "x" }] })), "unknown_key", "$.unresolvedQuestions[0].answer");
    refused(validateSpecialistResult(validResult({ validationRequests: [{ bindingToolId: "sirkit.validation.drc-run", baseRevision: DIGEST_A, args: {} }] })), "unknown_key", "$.validationRequests[0].args");
    const missing = validRequest();
    delete (missing as { deadlineAt?: unknown }).deadlineAt;
    refused(validateSpecialistRequest(missing), "missing_key", "$.deadlineAt");
    const missingResult = validResult();
    delete (missingResult as { confidence?: unknown }).confidence;
    refused(validateSpecialistResult(missingResult), "missing_key", "$.confidence");
    const scopeWithoutOptionals = { tenantId: "local", projectId: "p21", branchId: "main", canonicalRevisionDigest: DIGEST_A };
    expect(validateSpecialistRequest(validRequest({ scope: scopeWithoutOptionals })).ok).toBe(true);
    refused(validateSpecialistRequest(validRequest({ scope: [] })), "invalid_type", "$.scope");
    refused(validateSpecialistRequest(validRequest({ contextRefs: {} })), "invalid_type", "$.contextRefs");
    refused(validateSpecialistRequest(validRequest({ budget: { ...BUDGET, maxToolCalls: "10" } })), "invalid_integer", "$.budget.maxToolCalls");
    refused(validateSpecialistResult(validResult({ evidence: [{ kind: "trace-event", id: "e", digest: DIGEST_A, sourceClass: "deterministic_verifier", reviewed: "yes" }] })), "invalid_type", "$.evidence[0].reviewed");
    refused(validateSpecialistRequest(validRequest({ schema: SPECIALIST_RESULT_SCHEMA })), "schema_mismatch", "$.schema");
    refused(validateSpecialistResult(validResult({ schema: "sirkit.specialist-result.v2" })), "schema_mismatch", "$.schema");
    refused(validateSpecialistRequest([validRequest()]), "not_an_object", "$");
    refused(validateSpecialistRequest("text"), "not_an_object", "$");
    refused(validateSpecialistResult(null), "not_an_object", "$");
  });

  it("5. the key-name denylist: each of the capsule's ten exact keys, at the top level, nested in the scope, at the top level of a proposed action's payload and inside an array element, refuses `forbidden_key_name` BEFORE the digest is looked at (a payload carrying `reasoning` with a CORRECT artifactDigest is still refused by name); reasoning / thinking / continuation / chain-of-thought-shaped and credential-shaped names refuse under any case or separator; the classifier is exported and agrees", () => {
    expect(CAPSULE_DENYLIST_KEYS).toEqual(["state", "response", "request", "body", "headers", "client", "sdk", "openai", "anthropic", "token"]);
    expect(REASONING_SHAPED_STEMS).toEqual(["reasoning", "thinking", "continuation", "chainofthought"]);
    for (const key of CAPSULE_DENYLIST_KEYS) {
      refused(validateSpecialistRequest(validRequest({ [key]: 1 })), "forbidden_key_name");
      refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, [key]: 1 } })), "forbidden_key_name");
      refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { payload: payloadOf(TIER1_KIND, { [key]: 1 }) })] })), "forbidden_key_name");
      refused(validateSpecialistResult(validResult({ evidence: [{ kind: "trace-event", id: "e", digest: DIGEST_A, sourceClass: "deterministic_verifier", reviewed: true, [key]: 1 }] })), "forbidden_key_name");
      expect(isForbiddenOrchestrationKeyName(key)).toBe(true);
      expect(isForbiddenOrchestrationKeyName(key.toUpperCase())).toBe(true);
    }
    // a non-credential denylisted name is echoed as the path; a credential-shaped one collapses to the redacted segment
    refused(validateSpecialistRequest(validRequest({ state: 1 })), "forbidden_key_name", "$.state");
    refused(validateSpecialistRequest(validRequest({ token: 1 })), "forbidden_key_name", "$.[redacted-key]");
    // the digest is correct and the payload is still refused by name: names are judged before digests
    const withReasoning = payloadOf(TIER1_KIND, { reasoning: "hidden chain" });
    refused(validateSpecialistResult(validResult({ proposedActions: [{ kind: TIER1_KIND, payload: withReasoning, artifactDigest: engineeringDigest(withReasoning) }] })), "forbidden_key_name", "$.proposedActions[0].payload.[redacted-key]");
    for (const name of ["reasoning", "reasoningContent", "reasoning_content", "thinking", "thinking_blocks", "redacted_thinking", "continuation", "continuationState", "chain_of_thought", "chainOfThought", "CHAIN-OF-THOUGHT", "apiKey", "API_KEY", "Authorization", "clientSecret", "refresh_token", "providerClient", "rawSdkPayload", "accessToken", "bearer", "encrypted_content", "STATE", "Response", "open_ai", "Anthropic"]) {
      expect(isForbiddenOrchestrationKeyName(name), name).toBe(true);
      refused(validateSpecialistResult(validResult({ [name]: 1 })), "forbidden_key_name");
    }
    // legitimate names pass: the budget's token COUNTS, digests, and every contract key
    for (const name of ["summary", "tokens", "maxInputTokens", "inputTokens", "canonicalStateDigest", "statement", "requiredOutputs", "validationRequests", "proposedActions", "artifactDigest"]) {
      expect(isForbiddenOrchestrationKeyName(name), name).toBe(false);
    }
    // `clientId` is credential-shaped by the shared classifier, so it is forbidden here too
    expect(isForbiddenOrchestrationKeyName("clientId")).toBe(true);
  });

  it("6. bounds: a 4 000-character summary and 32-entry arrays pass; 4 001 / 1 001 characters refuse `text_too_long`; 33 entries refuse `array_too_long`; a control, format or line-separator character refuses `invalid_text` (LF and TAB are allowed; a soft hyphen and a zero-width joiner refuse too - the recorded availability cost); a credential-shaped VALUE in any text refuses `secret_shaped_text` under the recorded pattern set (a `NAME=value` dump and a `secret:` / `password:` prefix refuse even in benign engineering prose - the fail-closed default; a design word carrying `sk-` inside it, a net name, a digest and an ordinary `key: value` phrase pass); an oversized string or document refuses `not_captured` at capture", () => {
    // [B21 A] a specialist result is persisted (OD-111): a secret-shaped value never enters it, whatever key it hides under
    refused(validateSpecialistResult(validResult({ summary: `use ${["sk-", "abcdefghijklmnop"].join("")} for the run` })), "secret_shaped_text", "$.summary");
    refused(validateSpecialistResult(validResult({ risks: [{ id: "r", severity: "low", statement: "s", mitigation: `${["api", "key"].join("_")}: ABCDEFGH12345678` }] })), "secret_shaped_text", "$.risks[0].mitigation");
    refused(validateSpecialistRequest(validRequest({ objective: `Authorization: Bearer ${"a".repeat(24)}` })), "secret_shaped_text", "$.objective");
    expect(validateSpecialistResult(validResult({ summary: "the desk-lamp-controller net is unchanged" })).ok).toBe(true);
    // [B21 A review] the value scan is the shared diagnostic pattern set with the `sk-` prefixes token-anchored (recorded on the page
    // and in OD-131): a `NAME=value` dump and a `secret:` / `password:` prefix refuse even in benign engineering prose - the
    // fail-closed default the owner may revisit - while ordinary engineering text passes
    for (const phrase of ["set R1_VALUE=10k-ohm-0603 on the timer", "the secret: R1 sets the timing constant", "password: none is required for the debug header", "DRC_PRESET=default-preset-v2 was applied", "SPI_MODE=CPOL0_CPHA0_MSB_FIRST"]) {
      refused(validateSpecialistResult(validResult({ summary: phrase })), "secret_shaped_text", "$.summary");
    }
    for (const phrase of ["netlist proof: VCC_3V3 unchanged", "R1=10k", `base ${DIGEST_A} verified`, "value: 4k7 on R1", "the timer's period is 1.1 x R1 x C1"]) {
      expect(validateSpecialistResult(validResult({ summary: phrase })).ok, phrase).toBe(true);
    }
    refused(validateSpecialistResult(validResult({ summary: `bidi${String.fromCharCode(0x202e)}text` })), "invalid_text", "$.summary");
    // [B21 A review] every format character refuses, a soft hyphen (U+00AD) and a zero-width joiner (U+200D) included
    refused(validateSpecialistResult(validResult({ summary: `10${String.fromCharCode(0xad)}k` })), "invalid_text", "$.summary");
    refused(validateSpecialistResult(validResult({ summary: `a${String.fromCharCode(0x200d)}b` })), "invalid_text", "$.summary");
    expect(validateSpecialistResult(validResult({ summary: chars(4_000) })).ok).toBe(true);
    refused(validateSpecialistResult(validResult({ summary: chars(4_001) })), "text_too_long", "$.summary");
    expect(validateSpecialistRequest(validRequest({ objective: chars(1_000) })).ok).toBe(true);
    refused(validateSpecialistRequest(validRequest({ objective: chars(1_001) })), "text_too_long", "$.objective");
    refused(validateSpecialistResult(validResult({ risks: [{ id: "r", severity: "low", statement: chars(1_001), mitigation: null }] })), "text_too_long", "$.risks[0].statement");
    refused(validateSpecialistResult(validResult({ requiredTools: [{ toolId: "sirkit.validation.drc-run", version: "1.0.0", reason: chars(1_001) }] })), "text_too_long", "$.requiredTools[0].reason");
    const many = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `question-${index}`, question: "?", blocking: false }));
    expect(validateSpecialistResult(validResult({ unresolvedQuestions: many(32) })).ok).toBe(true);
    refused(validateSpecialistResult(validResult({ unresolvedQuestions: many(33) })), "array_too_long", "$.unresolvedQuestions");
    refused(validateSpecialistRequest(validRequest({ contextRefs: Array.from({ length: 33 }, (_, index) => ({ id: `resource-${index}`, digest: DIGEST_A })) })), "array_too_long", "$.contextRefs");
    refused(validateSpecialistResult(validResult({ assumptions: [{ id: "a", statement: "s", evidenceIds: Array.from({ length: 33 }, (_, index) => `evidence-${index}`) }] })), "array_too_long", "$.assumptions[0].evidenceIds");
    expect(validateSpecialistResult(validResult({ summary: `line one${String.fromCharCode(10)}${String.fromCharCode(9)}line two` })).ok).toBe(true);
    refused(validateSpecialistResult(validResult({ summary: `esc${String.fromCharCode(27)}[31m` })), "invalid_text", "$.summary");
    refused(validateSpecialistRequest(validRequest({ objective: `nul${String.fromCharCode(0)}` })), "invalid_text", "$.objective");
    // capture bounds come first: a string past the capture bound inside a wrapped payload, and a document past the serialized bound
    refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { payload: payloadOf(TIER1_KIND, { note: chars(100_001) }) })] })), "not_captured");
    refused(validateSpecialistResult(validResult({ proposedActions: Array.from({ length: 12 }, () => action(TIER1_KIND, { payload: payloadOf(TIER1_KIND, { note: chars(99_000) }) })) })), "not_captured");
  });

  it("7. the structural tool-request gate (D21-1): a ToolRequest or a ValidationRequest naming the manufacturing release, a qualification, a never-exposed canonical mutation, the canonical replay primitive, an atomic authority command, an id outside the exposure list or a malformed id refuses `tool_request_not_permitted` whatever the rest of the document says; every one of the exposed ids (33 when written; 36 since B22-B) is accepted as a tool request; a validation request binds ONLY one of the five deterministic verifiers - an execution, a view-session control, an external read, a named computation read or a proposal tool refuses `validation_binding_not_permitted`; the never-exposed patterns really reject the names used here", () => { // [B22 closeout, 2026-10-02] retitled (D22-16): 36 since B22-B (OD-139); assertions unchanged
    const forbidden = ["sirkit.manufacturing.release", "sirkit.pcb.qualify", "sirkit.manufacturing.qualification-authority", "sirkit.pcb.edit-track", "sirkit.pcb.delete-item", "sirkit.pcb.undo-redo-canonical", "sirkit.atomic.approve", "sirkit.atomic.publish", "sirkit.schematic.execute", "sirkit.pcb.bounded-edit-apply", "not an id", ""];
    for (const toolId of forbidden) {
      refused(validateSpecialistResult(validResult({ requiredTools: [{ toolId, version: "1.0.0", reason: "please" }] })), "tool_request_not_permitted", "$.requiredTools[0].toolId");
      refused(validateSpecialistResult(validResult({ validationRequests: [{ bindingToolId: toolId, baseRevision: DIGEST_A }] })), "tool_request_not_permitted", "$.validationRequests[0].bindingToolId");
    }
    for (const toolId of ["sirkit.manufacturing.release", "sirkit.pcb.qualify", "sirkit.pcb.edit-track", "sirkit.pcb.undo-redo-canonical", "sirkit.atomic.approve"]) {
      expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(toolId)), toolId).toBe(true);
      expect(EXPOSED).not.toContain(toolId);
    }
    expect(EXPOSED).toHaveLength(51); // [PR-M, 2026-10-18] pin move: 49 -> 51 (the schematic-scoped CAD acquisition start and status (runbook M.3, section M2)); [PR-L, 2026-10-18] pin move: 47 -> 49 (the durable generation task's inspection and control request, runbook L.5); [PR-M, 2026-10-17] pin move: 44 -> 47 (the three PR-M descriptors); [PR-F lead, 2026-10-17] pin move: 40 -> 44 (the four PR-F descriptors); [PR-D d2, 2026-10-16] pin move: 38 -> 40, + the Schematic to PCB preflight read and the catalog part inspection (two Tier 0 reads); [B22-B, 2026-10-01] pin move (OD-139): + the three named computation reads; [B24-D2, 2026-10-09] pin move (OD-213): + the paged board read; [PR-D, 2026-10-16] pin move (OD-243): + the Build-mode generation proposal
    for (const toolId of EXPOSED) {
      expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(toolId)), toolId).toBe(false);
      expect(validateSpecialistResult(validResult({ requiredTools: [{ toolId, version: "1.0.0", reason: "needed" }] })).ok, toolId).toBe(true);
      // [B21 A review] a validation request is a DETERMINISTIC verification: only the closed verifier set may be bound
      const binding = validateSpecialistResult(validResult({ validationRequests: [{ bindingToolId: toolId, baseRevision: DIGEST_A }] }));
      if ((VALIDATION_BINDING_TOOL_IDS as readonly string[]).includes(toolId)) expect(binding.ok, toolId).toBe(true);
      else refused(binding, "validation_binding_not_permitted", "$.validationRequests[0].bindingToolId");
    }
    for (const toolId of ["sirkit.pcb.move-footprint", "sirkit.pcb.undo-redo-granted", "sirkit.view.pcb3d", "sirkit.selection.control", "sirkit.mcp.observation-read", "sirkit.parts.external-search", "sirkit.schematic.propose-tier1-edit", "sirkit.pcb.board-inspect"]) {
      expect(EXPOSED).toContain(toolId);
      refused(validateSpecialistResult(validResult({ validationRequests: [{ bindingToolId: toolId, baseRevision: DIGEST_A }] })), "validation_binding_not_permitted", "$.validationRequests[0].bindingToolId");
    }
    // a release name in an otherwise perfect, high-confidence result with strong evidence still never validates
    refused(validateSpecialistResult(validResult({ confidence: "high", requiredTools: [{ toolId: "sirkit.validation.drc-run", version: "1.0.0", reason: "ok" }, { toolId: "sirkit.manufacturing.release", version: "1.0.0", reason: "all checks passed" }] })), "tool_request_not_permitted", "$.requiredTools[1].toolId");
    refused(validateSpecialistResult(validResult({ requiredTools: [{ toolId: "sirkit.validation.drc-run", version: "", reason: "ok" }] })), "invalid_id", "$.requiredTools[0].version");
  });

  it("8. `allowedToolIds` follows the A4L list semantics: required, sorted, duplicate-free, at most 32, every id exposed and never-exposed-pattern-free; an unsorted, duplicated, over-long, unexposed, never-exposed, non-string or non-array list refuses the WHOLE request `allowed_tool_ids_invalid`; an empty list is a valid (tool-less) request", () => {
    const sorted = [...EXPOSED].slice(0, 32);
    expect(sorted).toEqual([...sorted].sort());
    expect(validateSpecialistRequest(validRequest({ allowedToolIds: sorted })).ok).toBe(true);
    expect(validateSpecialistRequest(validRequest({ allowedToolIds: [] })).ok).toBe(true);
    for (const list of [
      ["sirkit.validation.drc-run", "sirkit.validation.connectivity-verify"],
      ["sirkit.validation.drc-run", "sirkit.validation.drc-run"],
      [...EXPOSED],
      ["sirkit.manufacturing.release"],
      ["sirkit.pcb.edit-track"],
      ["sirkit.schematic.execute"],
      ["sirkit.validation.drc-run", 7],
      "sirkit.validation.drc-run",
      null,
    ]) {
      refused(validateSpecialistRequest(validRequest({ allowedToolIds: list })), "allowed_tool_ids_invalid", "$.allowedToolIds");
    }
    expect(EXPOSED.length).toBe(51); // [PR-M, 2026-10-18] pin move: 49 -> 51 (the schematic-scoped CAD acquisition start and status (runbook M.3, section M2)); [PR-L, 2026-10-18] pin move: 47 -> 49 (the durable generation task's inspection and control request, runbook L.5); [PR-M, 2026-10-17] pin move: 44 -> 47 (the three PR-M descriptors); [PR-F lead, 2026-10-17] pin move: 40 -> 44 (the four PR-F descriptors); [PR-D d2, 2026-10-16] pin move: 38 -> 40, + the Schematic to PCB preflight read and the catalog part inspection (two Tier 0 reads); [B22-B, 2026-10-01] pin move (OD-139): + the three named computation reads; [B24-D2, 2026-10-09] pin move (OD-213): + the paged board read; [PR-D, 2026-10-16] pin move (OD-243): + the Build-mode generation proposal
    const missing = validRequest();
    delete (missing as { allowedToolIds?: unknown }).allowedToolIds;
    refused(validateSpecialistRequest(missing), "missing_key", "$.allowedToolIds");
    // requiredOutputs is a closed, sorted, duplicate-free list too
    refused(validateSpecialistRequest(validRequest({ requiredOutputs: ["summary", "reasoning"] })), "forbidden_key_name", "$.requiredOutputs[1]");
    refused(validateSpecialistRequest(validRequest({ requiredOutputs: ["summary", "plan"] })), "unknown_required_output", "$.requiredOutputs[1]");
    refused(validateSpecialistRequest(validRequest({ requiredOutputs: ["validationRequests", "summary"] })), "list_not_sorted", "$.requiredOutputs");
    refused(validateSpecialistRequest(validRequest({ requiredOutputs: ["summary", "summary"] })), "list_not_sorted", "$.requiredOutputs");
  });

  it("9. a proposed action whose artifactDigest disagrees with its payload refuses `artifact_digest_mismatch`; a kind outside the four refuses `action_kind_unknown`; a payload whose own `schema` is not the kind refuses `action_schema_mismatch`; a non-object payload refuses `invalid_type`; a malformed digest refuses `invalid_digest`; the digest is exactly engineeringDigest over the verbatim payload", () => {
    const payload = payloadOf(TIER1_KIND);
    expect(action(TIER1_KIND).artifactDigest).toBe(engineeringDigest(payload));
    refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { artifactDigest: engineeringDigest({ ...payload, proposalId: "prop-2" }) })] })), "artifact_digest_mismatch", "$.proposedActions[0].artifactDigest");
    refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { payload: { ...payload, operations: [] } })] })), "artifact_digest_mismatch", "$.proposedActions[0].artifactDigest");
    refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { kind: "sirkit.schematic-tier1-proposal.v2" })] })), "action_kind_unknown", "$.proposedActions[0].kind");
    refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { kind: "sirkit.agent-execution-grant.v1" })] })), "action_kind_unknown", "$.proposedActions[0].kind");
    const relabelled = payloadOf(REPLACEMENT_PROPOSAL_SCHEMA);
    refused(validateSpecialistResult(validResult({ proposedActions: [{ kind: TIER1_KIND, payload: relabelled, artifactDigest: engineeringDigest(relabelled) }] })), "action_schema_mismatch", "$.proposedActions[0].payload.schema");
    refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { payload: "sealed" })] })), "invalid_type", "$.proposedActions[0].payload");
    refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { payload: [payload] })] })), "invalid_type", "$.proposedActions[0].payload");
    refused(validateSpecialistResult(validResult({ proposedActions: [action(TIER1_KIND, { artifactDigest: "sha256:abc" })] })), "invalid_digest", "$.proposedActions[0].artifactDigest");
  });

  it("10. hostile documents never throw and never survive: an accessor, a throwing Proxy trap, a revoked Proxy, a toJSON hook (never invoked), a class instance, a symbol key, a non-enumerable property, a cyclic document, a sparse array and a `__proto__` key each refuse `not_captured` or `unknown_key`; a document that would read differently on a second pass cannot, because only the first capture is ever read", () => {
    let reads = 0;
    const withGetter = validRequest();
    Object.defineProperty(withGetter, "objective", { enumerable: true, get: () => { reads += 1; return reads === 1 ? "benign" : "changed"; } });
    refused(validateSpecialistRequest(withGetter), "not_captured", "$.objective");
    expect(reads).toBe(0);
    const throwing = new Proxy(validRequest(), { ownKeys: () => { throw new Error("trap"); } });
    refused(validateSpecialistRequest(throwing), "not_captured");
    const { proxy, revoke } = Proxy.revocable(validRequest(), {});
    revoke();
    refused(validateSpecialistRequest(proxy), "not_captured");
    let hookRan = false;
    refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, toJSON: () => { hookRan = true; return SCOPE; } } })), "not_captured", "$.scope.toJSON");
    expect(hookRan).toBe(false);
    class Scope { tenantId = "local"; projectId = "p21"; branchId = "main"; canonicalRevisionDigest = DIGEST_A; }
    refused(validateSpecialistRequest(validRequest({ scope: new Scope() })), "not_captured", "$.scope");
    refused(validateSpecialistRequest(validRequest({ [Symbol("hidden")]: 1 })), "not_captured", "$");
    const hidden = validRequest();
    Object.defineProperty(hidden, "shadow", { enumerable: false, value: 1 });
    refused(validateSpecialistRequest(hidden), "not_captured", "$.shadow");
    const cyclic = validRequest() as { scope: Record<string, unknown> };
    cyclic.scope.self = cyclic;
    refused(validateSpecialistRequest(cyclic), "not_captured");
    const sparse: unknown[] = [];
    sparse[2] = { id: "resource-1", digest: DIGEST_A };
    refused(validateSpecialistRequest(validRequest({ contextRefs: sparse })), "not_captured", "$.contextRefs");
    const proto = JSON.parse(`{"__proto__": {"polluted": true}}`) as Record<string, unknown>;
    refused(validateSpecialistRequest(validRequest(proto)), "unknown_key", "$.__proto__");
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    for (const value of [undefined, 1, true, Symbol("s"), () => validRequest(), BigInt(10)]) {
      const outcome = validateSpecialistRequest(value);
      expect(outcome.ok).toBe(false);
    }
  });

  it("11. scalar refusals, each with its path: a role outside the nine, a malformed id, a non-UTC or malformed deadline, a non-integer or negative budget field, a confidence outside the triple, an evidence kind, source class, extraction method or risk severity outside their vocabularies, a malformed digest, a non-integer head sequence, a non-null non-string head label; a credential-shaped VALUE in any id-class field (a task, scope, evidence, assumption, risk or question id, an evidence id entry, a tool version) refuses `secret_shaped_text` although the id grammar admits its characters", () => {
    refused(validateSpecialistRequest(validRequest({ role: "planner" })), "unknown_role", "$.role");
    refused(validateSpecialistResult(validResult({ role: "Schematic" })), "unknown_role", "$.role");
    refused(validateSpecialistRequest(validRequest({ taskId: "task 1" })), "invalid_id", "$.taskId");
    refused(validateSpecialistRequest(validRequest({ taskId: chars(129) })), "invalid_id", "$.taskId");
    refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, tenantId: "" } })), "invalid_id", "$.scope.tenantId");
    refused(validateSpecialistRequest(validRequest({ deadlineAt: "2026-09-24T12:05:00+02:00" })), "invalid_timestamp", "$.deadlineAt");
    refused(validateSpecialistRequest(validRequest({ deadlineAt: "2026-13-40T12:05:00.000Z" })), "invalid_timestamp", "$.deadlineAt");
    refused(validateSpecialistRequest(validRequest({ budget: { ...BUDGET, maxModelSteps: 1.5 } })), "invalid_integer", "$.budget.maxModelSteps");
    refused(validateSpecialistRequest(validRequest({ budget: { ...BUDGET, maxOutputTokens: -1 } })), "invalid_integer", "$.budget.maxOutputTokens");
    refused(validateSpecialistResult(validResult({ confidence: "certain" })), "invalid_confidence", "$.confidence");
    refused(validateSpecialistResult(validResult({ evidence: [{ kind: "datasheet", id: "e", digest: DIGEST_A, sourceClass: "deterministic_verifier", reviewed: true }] })), "unknown_evidence_kind", "$.evidence[0].kind");
    refused(validateSpecialistResult(validResult({ evidence: [{ kind: "trace-event", id: "e", digest: DIGEST_A, sourceClass: "forum_post", reviewed: true }] })), "unknown_source_class", "$.evidence[0].sourceClass");
    refused(validateSpecialistResult(validResult({ evidence: [{ kind: "trace-event", id: "e", digest: DIGEST_A, sourceClass: "llm_suggestion", extractionMethod: "guess", reviewed: false }] })), "unknown_extraction_method", "$.evidence[0].extractionMethod");
    refused(validateSpecialistResult(validResult({ evidence: [{ kind: "trace-event", id: "e", digest: "not-a-digest", sourceClass: "deterministic_verifier", reviewed: true }] })), "invalid_digest", "$.evidence[0].digest");
    refused(validateSpecialistResult(validResult({ risks: [{ id: "r", severity: "critical", statement: "s", mitigation: null }] })), "invalid_severity", "$.risks[0].severity");
    refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, schematicHeadMark: { ...SCOPE.schematicHeadMark, headSequence: 3.5 } } })), "invalid_integer", "$.scope.schematicHeadMark.headSequence");
    refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, pcbBasis: { ...SCOPE.pcbBasis, historyHeadLabel: 4 } } })), "invalid_type", "$.scope.pcbBasis.historyHeadLabel");
    refused(validateSpecialistRequest(validRequest({ contextRefs: [{ id: "resource-1", digest: DIGEST_B.toUpperCase() }] })), "invalid_digest", "$.contextRefs[0].digest");
    expect(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, pcbBasis: { ...SCOPE.pcbBasis, historyHeadLabel: "moved R1" } } })).ok).toBe(true);
    // [B21 A review] the id grammar admits a provider key's characters, so every id-class field is scanned for a credential-shaped VALUE
    expect(keyShaped()).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    expect(isOrchestrationId(keyShaped())).toBe(false);
    expect(isOrchestrationId("task-1")).toBe(true);
    refused(validateSpecialistRequest(validRequest({ taskId: keyShaped() })), "secret_shaped_text", "$.taskId");
    refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, projectId: keyShaped() } })), "secret_shaped_text", "$.scope.projectId");
    refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, pcbBasis: { ...SCOPE.pcbBasis, activeDrcPresetId: keyShaped() } } })), "secret_shaped_text", "$.scope.pcbBasis.activeDrcPresetId");
    refused(validateSpecialistRequest(validRequest({ contextRefs: [{ id: keyShaped(), digest: DIGEST_A }] })), "secret_shaped_text", "$.contextRefs[0].id");
    refused(validateSpecialistResult(validResult({ evidence: [{ kind: "trace-event", id: keyShaped(), digest: DIGEST_A, sourceClass: "deterministic_verifier", reviewed: true }] })), "secret_shaped_text", "$.evidence[0].id");
    refused(validateSpecialistResult(validResult({ requiredTools: [{ toolId: "sirkit.validation.drc-run", version: keyShaped(), reason: "r" }] })), "secret_shaped_text", "$.requiredTools[0].version");
    refused(validateSpecialistResult(validResult({ assumptions: [{ id: "a", statement: "s", evidenceIds: [keyShaped()] }] })), "secret_shaped_text", "$.assumptions[0].evidenceIds[0]");
    refused(validateSpecialistResult(validResult({ risks: [{ id: ["authorization", "ABCDEFGH12345678"].join(":"), severity: "low", statement: "s", mitigation: null }] })), "secret_shaped_text", "$.risks[0].id");
    refused(validateSpecialistResult(validResult({ unresolvedQuestions: [{ id: keyShaped(), question: "?", blocking: false }] })), "secret_shaped_text", "$.unresolvedQuestions[0].id");
  });

  it("12. the module read as text: no provider SDK import, type or identifier; nothing that names a route, an executor, a grant, an approval, a release, a qualification or a minter (the nine role ids and the five evidence kinds, spelled as quoted data, are the only permitted spellings and are scrubbed first); every refusal the validators can return is in the closed vocabulary and every vocabulary member is returned somewhere; the denylist is spelled as data, never imported from a provider", () => {
    const source = read(MODULE);
    expect(source).not.toMatch(/from\s+["'](?:openai|@anthropic-ai\/sdk)/);
    expect(source).not.toMatch(/require\(\s*["'](?:openai|@anthropic-ai\/sdk)/);
    expect(source).not.toMatch(/\bOpenAI\b|\bAnthropic\b|ResponseInputItem|MessageParam|ChatCompletion|\bResponses\b/);
    // [B21 A] the quoted vocabularies are data the runbook names (`cost-latency-router`, `qualification-authority`); every other spelling is forbidden
    const scrubbed = [...SPECIALIST_ROLES, ...EVIDENCE_KINDS].reduce((text, word) => text.replaceAll(JSON.stringify(word), ""), source).toLowerCase();
    for (const subject of [["rou", "te"].join(""), ["execu", "tor"].join(""), ["gra", "nt"].join(""), ["appro", "v"].join(""), ["relea", "se"].join(""), ["quali", "f"].join(""), ["min", "ter"].join(""), ["app/", "api"].join("")]) {
      expect(scrubbed.includes(subject), subject).toBe(false);
    }
    const returned = new Set([...source.matchAll(/refuse\("([a-z_]+)"/g)].map((match) => match[1]!));
    expect([...returned].sort()).toEqual([...ORCHESTRATION_REFUSALS].sort());
    // the imports are exactly the four authority-free modules the discovery names, plus two TYPE-ONLY reuses of the loop's
    // budget / PCB basis and the sealer's head mark (never a new revision vocabulary)
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]!).sort();
    expect(imports).toEqual(["../../engineering/agent-exposure", "../../engineering/schematic-proposals", "../../engineering/stable", "../contracts", "../plain-capture", "../redaction"]);
    expect(source).toMatch(/^import type \{[^}]*\} from "\.\.\/contracts";$/m);
    expect(source).toMatch(/^import type \{[^}]*\} from "\.\.\/\.\.\/engineering\/schematic-proposals";$/m);
  });

  it("13. [B21 A review] the four REAL sealed artifacts - a Tier 1 proposal, a replacement proposal, a bounded PCB edit proposal and a routing layout candidate, each produced by its production sealer - validate wrapped VERBATIM with artifactDigest = engineeringDigest(payload), singly and all four in one result; the declared names are EXACTLY the credential- or reasoning-shaped names the real artifacts carry (at their top level and inside their bindings), so a newly declared such name or a stale exemption fails here; no real artifact carries a capsule key at its top level; the PCB certificate's `readiness.state` sits below the top level and is accepted", () => {
    const { tier1, replacement, pcb, layout } = sealedArtifacts();
    const families: Array<[string, object]> = [[TIER1_PROPOSAL_SCHEMA, tier1], [REPLACEMENT_PROPOSAL_SCHEMA, replacement], [PCB_EDIT_PROPOSAL_SCHEMA, pcb], [LAYOUT_CANDIDATE_SCHEMA, layout]];
    for (const [kind, artifact] of families) {
      expect((artifact as { schema: string }).schema).toBe(kind);
      const outcome = validateSpecialistResult(wrapped(kind, artifact));
      expect(outcome, kind).toMatchObject({ ok: true });
    }
    const all = validResult({ proposedActions: families.map(([kind, artifact]) => ({ kind, payload: artifact, artifactDigest: engineeringDigest(artifact) })) });
    const outcome = accepted(validateSpecialistResult(all));
    expect((outcome.value as { proposedActions: readonly unknown[] }).proposedActions).toHaveLength(4);
    // the sealers' own key lists are what the artifacts carry (the pinned lists of the two families that export one)
    expect(Object.keys(replacement).sort()).toEqual([...REPLACEMENT_PROPOSAL_KEYS].sort());
    expect(Object.keys(pcb).sort()).toEqual([...PCB_EDIT_PROPOSAL_KEYS].sort());
    expect(layoutCandidateIntact(layout)).toBe(true);
    // the declared names: exactly the credential- or reasoning-shaped names the real artifacts carry at any level, and where they sit
    const shaped = (key: string): boolean => isCredentialShapedName(key) || REASONING_SHAPED_STEMS.some((stem) => foldFieldName(key).includes(stem));
    const flagged = new Set(families.flatMap(([, artifact]) => keyPaths(artifact).filter(([key]) => shaped(key)).map(([key]) => key)));
    expect([...flagged].sort()).toEqual([...SEALED_ARTIFACT_DECLARED_NAMES].sort());
    // the capsule's exact keys the real artifacts carry: `state` alone, below the top level (the PCB impact certificate); never at a top level
    const capsuleKeys = families.flatMap(([, artifact]) => keyPaths(artifact).filter(([key]) => (CAPSULE_DENYLIST_KEYS as readonly string[]).includes(foldFieldName(key))));
    expect(capsuleKeys.map(([key]) => key)).toEqual(["state"]);
    expect(capsuleKeys[0]![1]).toBe("$.impact.readiness.state");
    expect(Object.keys(tier1)).toContain("authorization");
    expect(Object.keys(replacement)).toContain("authorization");
    expect(Object.keys(pcb)).toContain("authorizationBinding");
    expect(Object.keys(tier1.authorization)).toContain("authorizationSchema");
    expect(Object.keys(pcb.authorizationBinding)).toContain("authorizationSchema");
    // a declared name is a verified principal + membership revision, never a credential: its value is a closed record
    expect(tier1.authorization).toMatchObject({ principalId: "user-fixture", membershipRevision: "membership:rev-7", requiredApplyRole: "pcb_editor" });
    // no capsule key at any artifact's top level; the PCB impact certificate carries `readiness.state` below it
    for (const [, artifact] of families) for (const key of Object.keys(artifact)) expect(CAPSULE_DENYLIST_KEYS as readonly string[], key).not.toContain(key.toLowerCase());
    expect((pcb.impact as unknown as { readiness: { state: string } }).readiness.state).toBe("unavailable");
    expect(keyPaths(pcb).some(([key, path]) => key === "state" && path === "$.impact.readiness.state")).toBe(true);
  });

  it("14. [B21 A review] a wrapped artifact's interior is scanned, never trusted: below the payload's top level a reasoning-shaped or credential-shaped key name refuses `forbidden_key_name` with its (redacted) path, a credential-shaped string refuses `secret_shaped_text` and a control or format character refuses `invalid_text`, at any depth and inside arrays; a declared name is exempt from the NAME check only - its VALUE is still scanned; the capsule's exact keys are judged at every level except `state` below the top level (a real certificate carries it) and a declared name is exempt only where the sealers put it [lead]; names are still judged before the digest", () => {
    const nested = (interior: Record<string, unknown>): Record<string, unknown> => payloadOf(TIER1_KIND, { operations: [{ op: "set-property", target: "R1", ...interior }] });
    const wrap = (payload: Record<string, unknown>): Record<string, unknown> => wrapped(TIER1_KIND, payload);
    refused(validateSpecialistResult(wrap(nested({ reasoning: "hidden chain" }))), "forbidden_key_name", "$.proposedActions[0].payload.operations[0].[redacted-key]");
    refused(validateSpecialistResult(wrap(nested({ apiKey: "x" }))), "forbidden_key_name", "$.proposedActions[0].payload.operations[0].[redacted-key]");
    refused(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { a: { b: { thinking: 1 } } }))), "forbidden_key_name", "$.proposedActions[0].payload.a.b.[redacted-key]");
    refused(validateSpecialistResult(wrap(nested({ note: `use ${["sk-", "abcdefghijklmnop"].join("")} here` }))), "secret_shaped_text", "$.proposedActions[0].payload.operations[0].note");
    refused(validateSpecialistResult(wrap(nested({ note: `Authorization: Bearer ${"a".repeat(24)}` }))), "secret_shaped_text", "$.proposedActions[0].payload.operations[0].note");
    refused(validateSpecialistResult(wrap(nested({ note: `bidi${String.fromCharCode(0x202e)}text` }))), "invalid_text", "$.proposedActions[0].payload.operations[0].note");
    refused(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { notes: ["fine", `nul${String.fromCharCode(0)}`] }))), "invalid_text", "$.proposedActions[0].payload.notes[1]");
    refused(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { deep: [[{ [["access", "token"].join("_")]: 1 }]] }))), "forbidden_key_name", "$.proposedActions[0].payload.deep[0][0].[redacted-key]");
    // a declared name: exempt from the name check (the sealers put it there), its value scanned like any other
    expect(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { authorization: { principalId: "user-1", membershipRevision: "membership:rev-7" } }))).ok).toBe(true);
    refused(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { authorization: `Bearer ${"a".repeat(24)}` }))), "secret_shaped_text", "$.proposedActions[0].payload.[redacted-key]");
    refused(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { authorization: { principalId: `bidi${String.fromCharCode(0x202e)}` } }))), "invalid_text", "$.proposedActions[0].payload.[redacted-key].principalId");
    // outside a wrapped artifact the declared names stay forbidden (a result or request of its own never carries one)
    refused(validateSpecialistResult(validResult({ authorization: 1 })), "forbidden_key_name", "$.[redacted-key]");
    refused(validateSpecialistRequest(validRequest({ scope: { ...SCOPE, authorizationBinding: 1 } })), "forbidden_key_name", "$.scope.[redacted-key]");
    // the capsule's exact keys: `state` below the top level is a real certificate's key (case 13) and passes; at the top level it
    // refuses (case 5); [B21 A lead] the other nine refuse at EVERY level - no sealer emits one anywhere (case 13 measures it)
    expect(validateSpecialistResult(wrap(nested({ state: "unavailable" }))).ok).toBe(true);
    refused(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { state: 1 }))), "forbidden_key_name", "$.proposedActions[0].payload.state");
    for (const key of ["response", "request", "body", "headers", "client", "sdk", "openai", "anthropic", "token"]) {
      refused(validateSpecialistResult(wrap(nested({ [key]: { transcript: "x" } }))), "forbidden_key_name", `$.proposedActions[0].payload.operations[0].${key === "token" ? "[redacted-key]" : key}`);
      refused(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { impact: { [key]: 1 } }))), "forbidden_key_name", `$.proposedActions[0].payload.impact.${key === "token" ? "[redacted-key]" : key}`);
    }
    // [B21 A lead] a declared name is exempt only where the sealers put it: the top level, or directly inside a declared parent -
    // under any other parent (an operation, an impact record) it is judged like any credential-shaped name
    expect(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { authorizationBinding: { authorizationSchema: "sirkit.x.v1", principalId: "user-1" } }))).ok).toBe(true);
    refused(validateSpecialistResult(wrap(nested({ Authorization: "hunter2" }))), "forbidden_key_name", "$.proposedActions[0].payload.operations[0].[redacted-key]");
    refused(validateSpecialistResult(wrap(payloadOf(TIER1_KIND, { impact: { authorizationSchema: "x" } }))), "forbidden_key_name", "$.proposedActions[0].payload.impact.[redacted-key]");
    // names before digests, at every level: a hidden reasoning key with a WRONG digest reports the name, never the digest
    refused(validateSpecialistResult(validResult({ proposedActions: [{ kind: TIER1_KIND, payload: nested({ reasoning: "x" }), artifactDigest: DIGEST_A }] })), "forbidden_key_name", "$.proposedActions[0].payload.operations[0].[redacted-key]");
    // the interior is still bound by the digest: a benign interior with a wrong digest refuses on the digest
    refused(validateSpecialistResult(validResult({ proposedActions: [{ kind: TIER1_KIND, payload: nested({ note: "benign" }), artifactDigest: DIGEST_A }] })), "artifact_digest_mismatch", "$.proposedActions[0].artifactDigest");
  });
  it("15. [B21 E2b lead] (the check's residual) a LONE surrogate is refused `invalid_text` like a control character - JSON.parse turns an escaped `\\ud800` in a result-tool call into one, and a Postgres jsonb commit of the orchestration record would then fail the durable write - while a properly paired astral character (an emoji, a math letter) is text and still passes", () => {
    for (const code of [0xd800, 0xdbff, 0xdc00, 0xdfff]) {
      refused(validateSpecialistResult(validResult({ summary: `lone${String.fromCharCode(code)}surrogate` })), "invalid_text", "$.summary");
      refused(validateSpecialistResult(validResult({ summary: `ends${String.fromCharCode(code)}` })), "invalid_text", "$.summary");
    }
    refused(validateSpecialistResult(validResult({ summary: JSON.parse('"escaped \\ud800 surrogate"') as string })), "invalid_text", "$.summary");
    for (const summary of [`smile ${String.fromCodePoint(0x1f600)}`, `bold ${String.fromCodePoint(0x1d400)}`]) expect(validateSpecialistResult(validResult({ summary })).ok, summary).toBe(true);
  });
});
