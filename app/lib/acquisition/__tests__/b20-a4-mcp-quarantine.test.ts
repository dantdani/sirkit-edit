/**
 * [B20 A4] 6.6 — MCP facts in the quarantine pipeline (D15, OD-79): the source class `external_mcp_tool` is quarantined FIRST
 * for every property, belongs to no authority list, and `candidateFromMcpObservation` reads every value from the observation
 * record at a validated pointer (a caller can never supply one), refusing with a closed code and never throwing. Pure: no
 * server, no network, no database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveClaim } from "../../atomic/claims";
import type { EngineeringClaim, EvidenceRef, SourceRecord } from "../../atomic/types";
import { ENGINEERING_AUTHORITY_SOURCE_CLASSES } from "../../atomic/validation";
import { REVIEW_AUTHORITY_SOURCE_CLASSES } from "../../atomic/publication-review-contract";
import { buildImportReviewEvidence, factValueHash } from "../import-review";
import {
  buildEvidenceBundle, candidateFromMcpObservation, ENGINEERING_CANDIDATE_SOURCE_CLASSES, ENGINEERING_PROPERTIES, EXTRACTION_MAX_FACTS, MCP_QUARANTINE_REASON,
  type CandidateFact, type NormalizedCandidate,
} from "../quarantine";
import type { McpObservationRecord } from "../../mcp/observation";

const ID = `external_tool_observation_${"a".repeat(64)}`;
const RETRIEVED = "2026-09-17T12:00:00.000Z";
const FRESH_UNTIL = "2026-09-17T12:15:00.000Z";

function record(structured: McpObservationRecord["structured"] = { state: "kept", untrustedValue: { part: { mpn: "LM358DR", manufacturer: "Texas Instruments", package: "SOIC-8", stock: 1200, rohs: true } } }): McpObservationRecord {
  return {
    schema: "sirkit.mcp-observation.v1", id: ID, normalizerVersion: "sirkit.mcp-observation-normalizer/1",
    source: { serverId: "docs-a", serverTitle: "Docs A", registryVersion: "1.1.0", protocolVersion: "2026-07-28", sourceClass: "external_mcp_tool" },
    policy: { agentDisclosure: "unknown", termsDocumentationUrl: null, termsCheckedOn: null, retentionNote: null, ownerDecision: null },
    tool: { name: "search", toolId: "mcp.docs-a.search", providerName: "mcp_docs-a__search", listingDigest: `sha256:${"b".repeat(64)}`, pinned: true, outputSchemaDeclared: true },
    call: { argumentsDigest: `sha256:${"c".repeat(64)}` }, resultType: "complete", isError: false, retrievedAt: RETRIEVED, freshUntil: FRESH_UNTIL,
    contentHash: `sha256:${"d".repeat(64)}`, rawRetained: false, untrusted: true, note: "external tool observation", redactionSubjectsUnavailable: false,
    content: { blocks: [], blocksRead: 0, blocksNotRead: 0, contentMalformed: false }, structured, notificationsIgnored: 0,
  };
}

const PROPERTIES: Array<[string, CandidateFact["facet"], string]> = [
  ["mpn", "identity", "/part/mpn"],
  ["manufacturer", "identity", "/part/manufacturer"],
  ["package", "package", "/part/package"],
  ["stock", "sourcing", "/part/stock"],
  ["rohs_compliant", "compliance", "/part/rohs"],
];

function mcpCandidate(facts = PROPERTIES.map(([property, facet, pointer]) => ({ property, facet, pointer }))): Readonly<NormalizedCandidate> {
  const outcome = candidateFromMcpObservation(record(), { exactMpn: "LM358DR", facts });
  if (!outcome.ok) throw new Error(outcome.code);
  return outcome.candidate;
}

/** A distributor candidate as candidateFromObservation shapes one: an identity hint and a sourcing fact. */
function distributorCandidate(): NormalizedCandidate {
  const base = { observationId: `observation_${"e".repeat(64)}`, sourceId: "octopart", sourceClass: "distributor_catalog" as const, method: "structured_api" as const, parserVersion: "sirkit.distributor-normalizer/1", locator: "octopart:LM358DR" };
  return {
    schemaVersion: 1, id: `candidate_${"f".repeat(64)}`, identityKey: "LM358DR", exactMpn: "LM358DR",
    facts: [
      { ...base, property: "manufacturer", facet: "identity", value: "TI", establishes: "identity_hint" },
      { ...base, property: "stock", facet: "sourcing", value: 50, establishes: "sourcing" },
    ],
    observationIds: [base.observationId], expiresAt: "2026-09-18T12:00:00.000Z", superseded: false, requestedMpn: null,
  };
}

describe("[B20 A4] 6.6 MCP facts are quarantined", () => {
  it("1. every property class is quarantined with the fixed reason, and the class is in none of the authority lists", () => {
    const candidate = mcpCandidate([...ENGINEERING_PROPERTIES.map((property) => ({ property, facet: "package" as const, pointer: "/part/package" })), ...PROPERTIES.map(([property, facet, pointer]) => ({ property, facet, pointer })), { property: "anything_else", facet: "identity", pointer: "/part/mpn" }]);
    expect(candidate.facts.length).toBe(ENGINEERING_PROPERTIES.length + PROPERTIES.length + 1);
    for (const fact of candidate.facts) {
      expect(fact, fact.property).toMatchObject({ establishes: "quarantined", reason: MCP_QUARANTINE_REASON, sourceClass: "external_mcp_tool", sourceId: "mcp:docs-a", method: "structured_api", parserVersion: "sirkit.mcp-observation-normalizer/1", observationId: ID });
      expect(fact.locator, fact.property).toMatch(/^mcp:docs-a\/search#\/part\//);
    }
    expect(candidate.observationIds).toEqual([ID]);
    expect(candidate.expiresAt).toBe(FRESH_UNTIL);
    expect(ENGINEERING_CANDIDATE_SOURCE_CLASSES).not.toContain("external_mcp_tool");
    expect(ENGINEERING_AUTHORITY_SOURCE_CLASSES.has("external_mcp_tool" as never)).toBe(false);
    expect([...REVIEW_AUTHORITY_SOURCE_CLASSES]).not.toContain("external_mcp_tool");
  });

  it("2. closed refusals, never throwing: a bad pointer, too many facts, a bad MPN, a withheld or invalid state, a malformed record", () => {
    const refusals: Array<[string, () => ReturnType<typeof candidateFromMcpObservation>, string]> = [
      ["a pointer without a slash", () => candidateFromMcpObservation(record(), { exactMpn: "LM358DR", facts: [{ property: "mpn", facet: "identity", pointer: "part/mpn" }] }), "pointer_invalid"],
      ["a pointer with a space", () => candidateFromMcpObservation(record(), { exactMpn: "LM358DR", facts: [{ property: "mpn", facet: "identity", pointer: "/part/m pn" }] }), "pointer_invalid"],
      ["a pointer of nine steps", () => candidateFromMcpObservation(record(), { exactMpn: "LM358DR", facts: [{ property: "mpn", facet: "identity", pointer: "/a/b/c/d/e/f/g/h/i" }] }), "pointer_invalid"],
      ["a prototype step", () => candidateFromMcpObservation(record(), { exactMpn: "LM358DR", facts: [{ property: "mpn", facet: "identity", pointer: "/__proto__/x" }] }), "value_absent"],
      [`${EXTRACTION_MAX_FACTS + 1} facts`, () => candidateFromMcpObservation(record(), { exactMpn: "LM358DR", facts: Array.from({ length: EXTRACTION_MAX_FACTS + 1 }, () => ({ property: "mpn", facet: "identity" as const, pointer: "/part/mpn" })) }), "too_many_facts"],
      ["a bad MPN", () => candidateFromMcpObservation(record(), { exactMpn: `LM358${String.fromCharCode(0x202e)}DR`, facts: [{ property: "mpn", facet: "identity", pointer: "/part/mpn" }] }), "mpn_invalid"],
      ["a pointer to an object", () => candidateFromMcpObservation(record(), { exactMpn: "LM358DR", facts: [{ property: "mpn", facet: "identity", pointer: "/part" }] }), "value_absent"],
      ["a missing leaf", () => candidateFromMcpObservation(record(), { exactMpn: "LM358DR", facts: [{ property: "mpn", facet: "identity", pointer: "/part/nothing" }] }), "value_absent"],
      ...(["withheld_credential", "withheld_instruction", "withheld_budget", "invalid", "unsafe"] as const).map((state): [string, () => ReturnType<typeof candidateFromMcpObservation>, string] => [
        `a ${state} value`, () => candidateFromMcpObservation(record({ state }), { exactMpn: "LM358DR", facts: [{ property: "mpn", facet: "identity", pointer: "/part/mpn" }] }), "value_absent",
      ]),
      ["a malformed record", () => candidateFromMcpObservation({ ...record(), id: "observation_x" }, { exactMpn: "LM358DR", facts: [] }), "observation_invalid"],
      ["another source class", () => candidateFromMcpObservation({ ...record(), source: { ...record().source, sourceClass: "distributor_catalog" as never } }, { exactMpn: "LM358DR", facts: [] }), "observation_invalid"],
    ];
    for (const [label, run, code] of refusals) {
      let outcome: ReturnType<typeof candidateFromMcpObservation> | null = null;
      expect(() => { outcome = run(); }, label).not.toThrow();
      expect(outcome, label).toMatchObject({ ok: false, code });
    }
    for (const junk of [null, undefined, 5, "record", new Proxy({}, { get() { throw new Error("trap"); } })]) {
      expect(() => candidateFromMcpObservation(junk as never, { exactMpn: "LM358DR", facts: [] })).not.toThrow();
      expect(candidateFromMcpObservation(junk as never, null as never).ok).toBe(false);
    }
  });

  it("3. values come from the record at the pointer, made inert and bounded; a caller cannot supply one", () => {
    const outcome = candidateFromMcpObservation(record({ state: "kept", untrustedValue: { part: { mpn: "LM358DR", note: `a${String.fromCharCode(27)}b ${"n".repeat(3_000)}` } } }), {
      exactMpn: "LM358DR",
      facts: [{ property: "mpn", facet: "identity", pointer: "/part/mpn", value: "FORGED" } as never, { property: "description", facet: "identity", pointer: "/part/note" }],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidate.facts.find((fact) => fact.property === "mpn")!.value).toBe("LM358DR");
    const note = outcome.candidate.facts.find((fact) => fact.property === "description")!.value as string;
    expect(note).not.toMatch(/[\p{Cc}]/u);
    expect(note.length).toBeLessThanOrEqual(2_000);
    expect(JSON.stringify(outcome)).not.toContain("FORGED");
    const numbers = mcpCandidate();
    expect(numbers.facts.find((fact) => fact.property === "stock")!.value).toBe(1200);
    expect(numbers.facts.find((fact) => fact.property === "rohs_compliant")!.value).toBe(true);
  });

  it("4. in a bundle beside a distributor: MCP facts stay out of conflicts, appear in quarantined disagreements, clear nothing missing, prove nothing, and are stale after freshUntil", () => {
    const alone = buildEvidenceBundle([distributorCandidate()], new Date(RETRIEVED));
    const bundle = buildEvidenceBundle([distributorCandidate(), mcpCandidate()], new Date(RETRIEVED));
    expect(bundle.conflicts.map((conflict) => conflict.property)).toEqual(alone.conflicts.map((conflict) => conflict.property));
    expect(bundle.quarantinedDisagreements.map((entry) => entry.property)).toContain("manufacturer");
    expect(bundle.engineering.missing).toEqual(alone.engineering.missing);
    expect(bundle.engineering.proven).toBe(false);
    expect(bundle.engineering.candidates).toEqual([]);
    expect(bundle.identityHints.every((fact) => fact.sourceClass !== "external_mcp_tool")).toBe(true);
    expect(bundle.sourcing.every((fact) => fact.sourceClass !== "external_mcp_tool")).toBe(true);
    expect(bundle.quarantined.filter((fact) => fact.sourceClass === "external_mcp_tool")).toHaveLength(PROPERTIES.length);
    expect(bundle.staleObservationIds).not.toContain(ID);
    expect(buildEvidenceBundle([distributorCandidate(), mcpCandidate()], new Date(FRESH_UNTIL)).staleObservationIds).toContain(ID);
  });

  it("5. the mapping adapter reads the class as other, and claim ranking scores it lowest (0)", () => {
    const adapter = readFileSync(join(process.cwd(), "app/lib/mapping-verification/adapters.ts"), "utf8");
    const mapper = adapter.slice(adapter.indexOf("function sourceClass("), adapter.indexOf("function evidenceFromSnapshot("));
    expect(mapper).not.toContain("external_mcp_tool");
    expect(mapper.trimEnd().endsWith('return "other";\n}') || /return "other";\s*\}\s*$/.test(mapper)).toBe(true);
    const claim = (id: string, evidenceId: string): EngineeringClaim => ({ id, property: "package", facet: "package", value: "SOIC-8", limit: "typical", conditions: {}, scope: "part", state: "source_backed", evidenceIds: [evidenceId], conflictsWith: [], safetyCritical: false } as unknown as EngineeringClaim);
    const evidence = new Map<string, EvidenceRef>([["ev-mcp", { id: "ev-mcp", sourceRecordId: "rec-mcp" } as EvidenceRef], ["ev-llm", { id: "ev-llm", sourceRecordId: "rec-llm" } as EvidenceRef]]);
    const records = new Map<string, SourceRecord>([["rec-mcp", { id: "rec-mcp", sourceId: "src-mcp" } as SourceRecord], ["rec-llm", { id: "rec-llm", sourceId: "src-llm" } as SourceRecord]]);
    const classes = new Map([["src-mcp", "external_mcp_tool"], ["src-llm", "llm_suggestion"]]);
    // the MCP claim sorts first by id, so only a lower priority puts it behind the lowest-ranked class there is (a model's suggestion)
    expect(effectiveClaim([claim("claim-a", "ev-mcp"), claim("claim-z", "ev-llm")], evidence, records, classes).claim?.id).toBe("claim-z");
  });

  it("6. import review masks an MCP fact's value and keeps its hash", () => {
    const bundle = buildEvidenceBundle([distributorCandidate(), mcpCandidate()], new Date(RETRIEVED));
    const review = buildImportReviewEvidence(bundle, [], "pcb_assignable");
    const mcpFacts = review.facts.filter((fact) => fact.sourceClass === "external_mcp_tool");
    expect(mcpFacts).toHaveLength(PROPERTIES.length);
    for (const fact of mcpFacts) {
      expect(fact.value, fact.property).toBeNull();
      expect(fact.locator, fact.property).toBeNull();
    }
    const manufacturer = mcpFacts.find((fact) => fact.property === "manufacturer")!;
    expect(manufacturer.valueHash).toBe(factValueHash("manufacturer", "Texas Instruments"));
    expect(JSON.stringify(review)).not.toContain("Texas Instruments");
  });
});
