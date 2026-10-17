/**
 * [PR-F fB] Agent parity for missing parts (CONTINUATION C.1-C.6; assignment section F.1-F.4): the two shared commands
 * `sirkit.parts.missing-facts` (a Tier 0 read of the UI's own checklist) and `sirkit.parts.draft-request` (a Tier 2 sealed,
 * explicitly UNVERIFIED draft request a human files), through the REAL registry, gateway and loop with FAKE ports.
 *
 *  - the descriptors: registered, valid, strict-compatible, Tier 0 / Tier 2 (execute_direct / proposal_only by derivation), their
 *    examples validate against their schemas, exposed in the reviewed list, withheld from MCP, bound to their one implementation;
 *  - denied discovery: no schematic (project_state_missing) for both; a viewer keeps the read and not the proposal; a board-less run
 *    without a head mark keeps both (a review task is not a sheet edit);
 *  - the draft request: sealed in the publication path's OWN vocabulary (the server's normalizer accepts the sealed spec byte for
 *    byte), verification `unverified`, the documented facts with their sources, the missing facts, the C.4 PCB-assignment blockers,
 *    the human path; the integrity verifier catches a tampered artifact; the publication request path stays human-only;
 *  - refusals as `proposal-blocked` data with the conflicting facts listed: no pin table, no identity, a fact without its source, a
 *    duplicate pin, a pad mapped twice, a fact both given and missing, pcb_assignable without the C.4 facts, an unknown or resolved
 *    instance; with the catalog port bound: an MPN or manufacturer that differs (identity-conflict), an incompatible package, a pin
 *    count that differs; authority-shaped keys and the symbol / footprint references refused by name;
 *  - ZERO live connector calls: a counting fake external acquisition port bound to the same gateway is never asked - on the seal, on
 *    every refusal, by either command;
 *  - the loop end to end: the draft request's own event once, `proposal_sealed`, a second proposal refused `proposal_exists`;
 *  - the ratchet amendment's tripwire: the two acquisition modules the UI's derivation imports stay contract / label modules;
 *  - the CONTINUATION C case index: every B19-E suite the evidence page cites exists and still holds the case it cites.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { sirkitToolRegistry } from "../tool-catalog";
import { validateToolDescriptor } from "../tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { validateAgainstSchema } from "../tool-io-validation";
import { discoverTools } from "../tool-discovery";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport } from "../agent-exposure";
import { MCP_WITHHELD_TOOL_IDS, mcpExposureReport } from "../mcp-exposure";
import { NEVER_EXPOSED_TOOL_PATTERNS } from "../granted-execution-families";
import { TIER3_FLOOR_PATTERN, decideAgentExecution, defaultAutonomySetting, permissionTierOfDescriptor } from "../permission-tiers";
import { schematicStateDigest } from "../schematic-model";
import type { ProjectRole } from "../types";
import { strictCompatibility } from "../../agent/provider-tools";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { buildRunToolset, runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../../agent/contracts";
import type { ExternalAcquisitionReadPort, ExternalEvidencePortRequest, ExternalSearchPortRequest } from "../../agent/acquisition-reads";
import type { CatalogPartInspectionPort, CatalogPartInspectionPortAnswer, CatalogPartInspectionPortRequest } from "../../agent/catalog-inspection-reads";
import { MISSING_FACTS_BINDING, MISSING_FACTS_INPUT_EXAMPLE, MISSING_FACTS_TOOL_ID, resolveMissingFactsBinding } from "../../agent/missing-facts-reads";
import { DRAFT_REQUEST_BINDING, DRAFT_REQUEST_HUMAN_PATH, DRAFT_REQUEST_INPUT_EXAMPLE, DRAFT_REQUEST_SCHEMA, DRAFT_REQUEST_TOOL_ID, DRAFT_REQUEST_VERIFICATION, PCB_ASSIGNMENT_BLOCKING_FACTS, compilePartDraftRequest, resolveDraftRequestBinding, verifySealedPartDraftRequestIntegrity, type SealedPartDraftRequest } from "../../agent/draft-request-proposals";
import { normalizeAtomicPublicationSpec } from "../../atomic/authoring";
import { isHumanPublicationActor, PUBLICATION_REQUESTER_ROLES } from "../../atomic/publication-review";
import type { CatalogPartDetail } from "../../atomic/catalog-part-detail";
import { listUnresolvedInstances } from "../../pcb-sync/unresolved-instances";
import { createEmptyBoard } from "../../pcb/types";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const READ = MISSING_FACTS_TOOL_ID;
const DRAFT = DRAFT_REQUEST_TOOL_ID;
const SCOPE = { tenantId: "local", projectId: "p-prf-parity", branchId: "main" };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };
const ROOT = process.cwd();

const SHEET: SchematicState = {
  components: [{ id: "r9", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k", refDes: "R9" }],
  wires: [], netLabels: [],
  kicadComponents: [
    { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "NE555", atomicPartRevisionId: "rev-u1", symbolAssetVersionId: "sym-u1" },
    { id: "u2-id", partId: "lib:part-u2", x: 300, y: 200, rotation: 0, refDes: "U2", value: "NE555DR" },
  ],
} as unknown as SchematicState;
const pin = (number: string, name: string, type = "passive") => ({ number, name, type, position: { x: 0, y: 0 }, orientation: "right" as const, length: 2.54 });
/** The catalog record U2 was placed from: the exact timer, SOIC-8, eight pins, no published link (that is why it is unresolved). */
const PART_U2: CatalogPartDetail = {
  id: "lib:part-u2", name: "NE555D", description: "Precision timer", keywords: null, mpn: "NE555DR", manufacturer: "Texas Instruments", datasheet: null,
  footprintHint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", mainCategory: "Timer", libraryName: "Timer", pins: ["GND", "TRIG", "OUT", "RESET", "CONT", "THRES", "DISCH", "VCC"].map((name, index) => pin(String(index + 1), name)),
  symbolRaw: "(symbol \"NE555D\" ...)", properties: {}, internalPartNumber: null, lifecycleStatus: "active", rohsStatus: "compliant", packageNormalized: "SOIC-8", keySpecs: null, isGeneric: false,
} as unknown as CatalogPartDetail;

interface ContextOptions { schematic?: SchematicState | null; role?: ProjectRole; board?: boolean; headMark?: boolean; catalog?: boolean; external?: boolean }
function contextFor(options: ContextOptions = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE,
    ...(options.schematic === null ? {} : { schematic: options.schematic ?? SHEET }),
    ...(options.board === false ? {} : { board: createEmptyBoard() }),
    ...(options.headMark === false ? {} : { schematicHeadMark: HEAD_MARK }),
    verifiedActor: { principalId: "u-1", actorRole: options.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    ...(options.catalog ? { catalogInspectionAvailable: true } : {}),
    ...(options.external ? { externalAcquisitionAvailable: true } : {}),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const reasonFor = (toolId: string, context: AgentRunContext): string => {
  const result = discoverTools(registry, context.discovery);
  if (result.included.some((item) => item.toolId === toolId)) return "included";
  return result.excluded.find((item) => item.toolId === toolId)?.reason ?? "absent";
};
const offered = (context: AgentRunContext): string[] => buildRunToolset(registry, context, () => undefined).declarations.map((declaration) => declaration.toolId);

function fakeCatalog(answers: Record<string, CatalogPartInspectionPortAnswer>): { port: CatalogPartInspectionPort; requests: CatalogPartInspectionPortRequest[] } {
  const requests: CatalogPartInspectionPortRequest[] = [];
  return { requests, port: { inspect: async (request) => { requests.push(request); return answers[request.partId] ?? { state: "not_found" as const }; } } };
}
function fakeExternal(): { port: ExternalAcquisitionReadPort; calls: { search: ExternalSearchPortRequest[]; evidence: ExternalEvidencePortRequest[] } } {
  const calls = { search: [] as ExternalSearchPortRequest[], evidence: [] as ExternalEvidencePortRequest[] };
  return { calls, port: { async searchExactMpns(request) { calls.search.push(request); throw new Error("a connector was asked"); }, async readEvidence(request) { calls.evidence.push(request); throw new Error("a connector was asked"); } } };
}
const gatewayWith = (options: { catalog?: CatalogPartInspectionPort; external?: ExternalAcquisitionReadPort } = {}) => createAgentToolGateway(registry, { ...(options.catalog ? { catalogInspection: options.catalog } : {}), ...(options.external ? { externalAcquisition: options.external } : {}), now: () => 1_760_000_000_000 });
const invoke = (gateway: ReturnType<typeof createAgentToolGateway>, toolId: string, context: AgentRunContext, args: Record<string, unknown>, timeoutMs = 5_000, signal?: AbortSignal) =>
  gateway.invoke({ runId: "run-prf-parity", provider: "openai", callId: "call-prf-1", toolId, version: "1.0.0", args, context, timeoutMs, ...(signal ? { signal } : {}) });
const sealedOf = (outcome: Awaited<ReturnType<ReturnType<typeof createAgentToolGateway>["invoke"]>>): SealedPartDraftRequest => {
  if (outcome.kind !== "draft-request-proposal") throw new Error(`not a draft request: ${JSON.stringify(outcome).slice(0, 400)}`);
  return outcome.proposal;
};
const blockersOf = (outcome: Awaited<ReturnType<ReturnType<typeof createAgentToolGateway>["invoke"]>>): string[] => {
  if (outcome.kind !== "proposal-blocked") throw new Error(`not blocked: ${JSON.stringify(outcome).slice(0, 400)}`);
  return outcome.blockers.map((blocker) => blocker.code);
};
/** The module's own example, aimed at this sheet's unresolved timer (U2), with every pin of the datasheet table. */
const SRC = "TI SLFS022I, table 5-1";
const PINS = ["GND", "TRIG", "OUT", "RESET", "CONT", "THRES", "DISCH", "VCC"].map((name, index) => ({ number: String(index + 1), name, function: name.toLowerCase(), source: SRC }));
const REQUEST: Record<string, unknown> = { ...structuredClone(DRAFT_REQUEST_INPUT_EXAMPLE), refDes: "U2", pinTable: PINS };
const withoutKey = (key: string): Record<string, unknown> => { const copy = { ...REQUEST }; delete copy[key]; return copy; };

describe("PR-F fB - the two descriptors", () => {
  it("missing-facts: a Tier 0 validation read over the verified schematic (no board, no catalog required), bound to the UI's derivation, exposed and MCP-withheld; its example validates and an argument is refused", () => {
    const d = registry.get(READ)!;
    expect(validateToolDescriptor(d, KNOWN)).toEqual([]);
    expect(d).toMatchObject({ version: "1.0.0", lifecycle: "active", owningCommandId: "pcb.sync-durable", category: "validation", operationClass: "read", sideEffects: "none", approvalTier: "none", requiredCapability: "read_project", requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"], requiresExpectedRevision: false, requiresLineage: false, agentExposed: true, binding: { status: "bound-read", module: MISSING_FACTS_BINDING.module, symbol: MISSING_FACTS_BINDING.symbol } });
    expect(d.requiredRoles).toEqual(["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"]);
    expect(strictCompatibility(d).ok).toBe(true);
    expect(resolveMissingFactsBinding(d)).toEqual({ state: "resolved" });
    expect(resolveMissingFactsBinding(registry.get("sirkit.pcb-sync.preflight")!).state).toBe("not_callable");
    expect(permissionTierOfDescriptor(d)).toBe(0);
    expect(decideAgentExecution({ tier: 0, setting: defaultAutonomySetting(SCOPE), actorRole: "viewer", explicitUserRequest: false })).toMatchObject({ decision: "execute_direct", requiresHumanApproval: false });
    expect(validateAgainstSchema(MISSING_FACTS_INPUT_EXAMPLE, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema({ partId: "x" }, d.inputSchema)).toEqual(["$.partId: unknown field"]);
    expect(d.description).toContain("Example input: {}");
    expect(d.description).toContain("catalog unavailable");
  });

  it("draft-request: a Tier 2 proposal (proposal_only by derivation) over the verified schematic, bound to the one compile, exposed and MCP-withheld, the publication requester roles; its example validates; symbol and footprint keys are not in its schema", () => {
    const d = registry.get(DRAFT)!;
    expect(validateToolDescriptor(d, KNOWN)).toEqual([]);
    expect(d).toMatchObject({ version: "1.0.0", lifecycle: "active", owningCommandId: "parts.draft-request" /* [PR-F lead, 2026-10-17] its own propose record: B19-E E4 forbids any tool owned by the human-only publication-review record */, category: "parts", operationClass: "propose", sideEffects: "proposal-artifact", approvalTier: "none", requiredCapability: "read_project", requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"], requiresExpectedRevision: true, requiresLineage: true, agentExposed: true, binding: { status: "bound-proposal", module: DRAFT_REQUEST_BINDING.module, symbol: DRAFT_REQUEST_BINDING.symbol } });
    expect([...d.requiredRoles].sort()).toEqual([...PUBLICATION_REQUESTER_ROLES].sort());
    expect(strictCompatibility(d).ok).toBe(true);
    expect(resolveDraftRequestBinding(d)).toEqual({ state: "resolved" });
    expect(resolveDraftRequestBinding(registry.get("sirkit.schematic.generate-proposal")!).state).toBe("not_callable");
    expect(permissionTierOfDescriptor(d)).toBe(2);
    expect(decideAgentExecution({ tier: 2, setting: defaultAutonomySetting(SCOPE), actorRole: "pcb_editor", explicitUserRequest: true })).toMatchObject({ decision: "proposal_only", requiresHumanApproval: true });
    expect(validateAgainstSchema(DRAFT_REQUEST_INPUT_EXAMPLE, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema(REQUEST, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema({ refDes: "U2", symbol: { library: "Timer", name: "NE555D" } }, d.inputSchema)).toEqual(["$.symbol: unknown field"]);
    expect(validateAgainstSchema({}, d.inputSchema)).toEqual(["$.refDes: required"]);
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "parts.atomic-publication-review")).toMatchObject({ kind: "mutate" });
  });

  it("both: no Tier 3 stem, no never-exposed pattern, in the reviewed exposure list, withheld from MCP, the reports clean", () => {
    for (const id of [READ, DRAFT]) {
      expect(TIER3_FLOOR_PATTERN.test(id), id).toBe(false);
      for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(id), `${id} ${String(pattern)}`).toBe(false);
      expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, id).toContain(id);
      expect(MCP_WITHHELD_TOOL_IDS, id).toContain(id);
    }
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [], executionViolations: [] });
    const mcp = mcpExposureReport(registry);
    expect(mcp.ok).toBe(true);
    expect(mcp.excludedByReason.withheld).toEqual(expect.arrayContaining([READ, DRAFT]));
  });
});

describe("PR-F fB - denied discovery, with the reason", () => {
  it("a verified schematic: both included and offered board-less; without a head mark the read stays and the proposal goes (the B09.1 gate: lineage_required); a viewer keeps the read and not the proposal; no schematic: project_state_missing for both and withheld at the run", () => {
    const boardless = contextFor({ board: false });
    expect(boardless.canonicalState).toBeNull();
    expect(reasonFor(READ, boardless)).toBe("included");
    expect(reasonFor(DRAFT, boardless)).toBe("included");
    expect(offered(boardless)).toEqual(expect.arrayContaining([READ, DRAFT]));
    const bare = contextFor({ board: false, headMark: false });
    expect(reasonFor(READ, bare)).toBe("included");
    expect(reasonFor(DRAFT, bare)).toBe("lineage_required");
    expect(offered(bare)).toContain(READ);
    expect(offered(bare)).not.toContain(DRAFT);
    expect(offered(bare)).not.toContain("sirkit.schematic.propose-tier1-edit");
    const viewer = contextFor({ role: "viewer" });
    expect(reasonFor(READ, viewer)).toBe("included");
    expect(reasonFor(DRAFT, viewer)).toBe("role_not_permitted");
    expect(offered(viewer)).toContain(READ);
    expect(offered(viewer)).not.toContain(DRAFT);
    const none = contextFor({ schematic: null });
    expect(reasonFor(READ, none)).toBe("project_state_missing");
    expect(reasonFor(DRAFT, none)).toBe("lineage_required"); // no schematic means no lineage either, and discovery gates the lineage requirement before the project state
    expect(offered(none)).not.toEqual(expect.arrayContaining([READ]));
    expect(offered(none)).not.toEqual(expect.arrayContaining([DRAFT]));
  });
});

describe("PR-F fB - the draft request seals an UNVERIFIED review task in the publication path's own vocabulary", () => {
  it("without the catalog port: sealed, verification unverified, the spec the server's normalizer accepts byte for byte, symbol and footprint null, the documented facts with their sources, the missing facts, the C.4 blockers, the human path; the cross-check recorded unavailable; no connector asked", async () => {
    const external = fakeExternal();
    const context = contextFor({ external: true, board: false });
    const outcome = await invoke(gatewayWith({ external: external.port }), DRAFT, context, REQUEST);
    const sealed = sealedOf(outcome);
    expect(outcome).toMatchObject({ kind: "draft-request-proposal", ok: true, toolId: DRAFT, version: "1.0.0" });
    expect(sealed).toMatchObject({ schema: DRAFT_REQUEST_SCHEMA, toolId: DRAFT, verification: DRAFT_REQUEST_VERIFICATION, scope: { ...SCOPE, headMark: HEAD_MARK }, baseSchematicDigest: schematicStateDigest(SHEET), instance: { refDes: "U2", family: "kicad", missing: "published_exact_revision" }, actor: { actorId: "agent:openai", kind: "ai" }, effectiveActor: { actorId: "u-1", kind: "human" } });
    expect(sealed.draftRequest).toMatchObject({ exactMpn: "NE555DR", profile: "schematic_only", symbol: null, footprint: null, package: { code: "SOIC-8 (D)", mounting: "smd" }, manufacturer: { canonicalName: "Texas Instruments", officialDomains: [] }, datasheet: null });
    expect(sealed.draftRequest.terminals).toHaveLength(8);
    expect(sealed.draftRequest.terminals[0]).toEqual({ number: "1", function: "GND: gnd", pads: ["1"] });
    // the SAME normalizer the human-only submit_request runs accepts the sealed spec, unchanged
    const normalized = normalizeAtomicPublicationSpec(sealed.draftRequest);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) expect(normalized.spec).toEqual(sealed.draftRequest);
    expect(sealed.documented.map((fact) => fact.fact)).toEqual(expect.arrayContaining(["exact manufacturer part number", "manufacturer", "package variant (code and mounting)", "pitch", "body dimensions (courtyard)", "pin-1 orientation", "exposed-pad mapping", "pin 1", "pin 8"]));
    for (const fact of sealed.documented) expect(fact.source.length, fact.fact).toBeGreaterThan(0);
    expect(sealed.missing).toEqual(expect.arrayContaining(["courtyard per IPC-7351 is not in the datasheet", expect.stringContaining("symbol and footprint references")]));
    expect(sealed.pcbAssignment.blocked).toBe(true); // schematic_only was requested: not PCB-assignable, whatever the facts
    expect(sealed.catalogCrossCheck).toMatchObject({ state: "unavailable", reason: expect.stringContaining("catalog unavailable") });
    expect(sealed.reviewTask).toMatchObject({ path: DRAFT_REQUEST_HUMAN_PATH, neverClaims: expect.stringContaining("no mapping certificate") });
    expect(JSON.stringify(sealed)).not.toMatch(/mappingCertificateId|approved|published:/);
    expect(verifySealedPartDraftRequestIntegrity(sealed)).toEqual({ ok: true });
    expect(verifySealedPartDraftRequestIntegrity({ ...sealed, verification: "verified" })).toMatchObject({ ok: false, code: "malformed" });
    expect(verifySealedPartDraftRequestIntegrity({ ...sealed, draftRequest: { ...sealed.draftRequest, exactMpn: "NE555P" } })).toMatchObject({ ok: false, code: "altered" });
    expect(verifySealedPartDraftRequestIntegrity({ ...sealed, missing: [] })).toMatchObject({ ok: false, code: "altered" });
    expect(external.calls).toEqual({ search: [], evidence: [] });
    expect(schematicStateDigest(context.schematic!)).toBe(schematicStateDigest(SHEET));
  });

  it("with the catalog port: the placed part's identity, package and pin count are cross-checked (checked, three facts compared); every C.4 fact documented makes pcb_assignable reachable and the default profile; the port was asked once", async () => {
    const catalog = fakeCatalog({ "lib:part-u2": { state: "found", detail: PART_U2, revisionStatus: {} } });
    const sealed = sealedOf(await invoke(gatewayWith({ catalog: catalog.port }), DRAFT, contextFor({ catalog: true }), withoutKey("profile")));
    expect(sealed.catalogCrossCheck).toEqual({ state: "checked", partId: "lib:part-u2", compared: ["exact MPN", "manufacturer", "package", "pin count"] });
    expect(sealed.draftRequest.profile).toBe("pcb_assignable");
    expect(sealed.pcbAssignment).toEqual({ blocked: false, blockers: [expect.stringContaining("deterministic mapping checks and the human review and publication have not run")] });
    expect(catalog.requests.map((request) => request.partId)).toEqual(["lib:part-u2"]);
  });

  it("the publication request path stays human-only: an agent actor is refused by isHumanPublicationActor, and the proposal's roles are the requester roles", () => {
    expect(isHumanPublicationActor({ actorId: "agent:openai", actorKind: "agent", sessionId: "s", role: "pcb_editor" } as never)).toBe(false);
    expect(isHumanPublicationActor({ actorId: "llm:openai", actorKind: "human", sessionId: "s", role: "pcb_editor" } as never)).toBe(false);
    expect(isHumanPublicationActor({ actorId: "user_7", actorKind: "human", sessionId: "s", role: "pcb_editor" } as never)).toBe(true);
    const handler = readFileSync(resolve(ROOT, "app/api/components/atomic/publication/handler.ts"), "utf8");
    expect(handler).toContain("ATOMIC_PUBLICATION_HUMAN_REQUIRED");
    expect(handler).toContain("Only a person can request, review, publish or withdraw an atomic revision.");
  });
});

describe("PR-F fB - the draft request refuses as data, listing the facts; no connector is ever asked", () => {
  const cases: Array<[label: string, args: Record<string, unknown>, codes: string[], detail?: RegExp]> = [
    ["no pin table", withoutKey("pinTable"), ["pin-table-missing"], /plausible image or a matching pin count is insufficient/],
    ["an empty pin table", { ...REQUEST, pinTable: [] }, ["pin-table-missing"]],
    ["no exact MPN and no manufacturer", { ...withoutKey("exactMpn"), manufacturer: undefined }, ["identity-missing"], /exact manufacturer part number and manufacturer/],
    ["a fact without its source label", { ...REQUEST, pitchMm: { value: 1.27, source: "   " } }, ["source-label-missing"], /pitch is given without a source label/],
    ["a duplicate pin number", { ...REQUEST, pinTable: [...PINS, { number: "8", name: "VCC", function: "supply", source: SRC }] }, ["pin-table-conflict"], /pin 8 is listed twice/],
    ["a pad mapped to two pins", { ...REQUEST, pinTable: [{ number: "1", function: "gnd", pads: ["1", "9"], source: SRC }, { number: "2", function: "trig", pads: ["9"], source: SRC }] }, ["pin-table-conflict"], /pad 9 is mapped to pins 1 and 2/],
    ["a fact both documented and listed missing", { ...REQUEST, missing: ["pitch"] }, ["fact-conflict"], /listed as missing while "pitch" is documented/],
    ["pcb_assignable without the geometry facts", { ...withoutKey("pitchMm"), bodyMm: undefined, pin1Orientation: undefined, exposedPad: undefined, profile: "pcb_assignable" }, ["pcb-assignable-blocked"], /pitch; body dimensions \(courtyard\); pin-1 orientation; exposed-pad mapping/],
    ["an instance that is not unresolved", { ...REQUEST, refDes: "U1" }, ["instance-not-unresolved"]],
    ["an unknown reference", { ...REQUEST, refDes: "R77" }, ["instance-not-unresolved"]],
    ["a malformed package", { ...REQUEST, package: { code: "SOIC-8", mounting: "glued", source: SRC } }, ["package-malformed"]],
    ["an unknown profile", { ...REQUEST, profile: "verified" }, ["profile-malformed"]],
  ];
  for (const [label, args, codes, detail] of cases) {
    it(`${label}: proposal-blocked with ${codes.join(", ")}`, async () => {
      const external = fakeExternal();
      const catalog = fakeCatalog({ "lib:part-u2": { state: "found", detail: PART_U2, revisionStatus: {} } });
      const cleaned = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
      const outcome = await invoke(gatewayWith({ external: external.port, catalog: catalog.port }), DRAFT, contextFor({ external: true, catalog: true }), cleaned);
      expect(blockersOf(outcome), label).toEqual(expect.arrayContaining(codes));
      if (detail && outcome.kind === "proposal-blocked") expect(outcome.blockers.map((blocker) => blocker.detail).join("\n"), label).toMatch(detail);
      expect(external.calls, label).toEqual({ search: [], evidence: [] });
    });
  }

  it("the catalog cross-check: an MPN that differs is identity-conflict (never a silent substitution), a package that differs is incompatible-package, a pin count that differs is pin-count-conflict; the compile lists every conflict", async () => {
    const catalog = fakeCatalog({ "lib:part-u2": { state: "found", detail: PART_U2, revisionStatus: {} } });
    const gateway = gatewayWith({ catalog: catalog.port });
    const context = contextFor({ catalog: true });
    const mpn = await invoke(gateway, DRAFT, context, { ...REQUEST, exactMpn: { value: "NE555P", source: SRC } });
    expect(blockersOf(mpn)).toEqual(["identity-conflict"]);
    if (mpn.kind === "proposal-blocked") expect(mpn.blockers[0]!.detail).toMatch(/names MPN NE555P but the placed catalog part \(lib:part-u2\) names NE555DR: a different part is never substituted silently/);
    const pkg = await invoke(gateway, DRAFT, context, { ...REQUEST, package: { code: "PDIP-8", mounting: "through_hole", source: SRC } });
    expect(blockersOf(pkg)).toEqual(["incompatible-package"]);
    const pins = await invoke(gateway, DRAFT, context, { ...REQUEST, pinTable: PINS.slice(0, 6) });
    expect(blockersOf(pins)).toEqual(["pin-count-conflict"]);
    // the pure compile lists every conflict at once, all-or-nothing
    const compiled = compilePartDraftRequest({ args: { ...REQUEST, exactMpn: { value: "NE555P", source: SRC }, package: { code: "PDIP-8", mounting: "through_hole", source: SRC }, pinTable: PINS.slice(0, 6) }, unresolved: listUnresolvedInstances(SHEET), catalog: { partId: "lib:part-u2", mpn: "NE555DR", manufacturer: "Texas Instruments", packageNormalized: "SOIC-8", pinCount: 8 } });
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.blockers.map((blocker) => blocker.code)).toEqual(["identity-conflict", "incompatible-package", "pin-count-conflict"]);
    // a catalog that holds no identity for the placed part checks nothing and says so
    const bare = compilePartDraftRequest({ args: REQUEST, unresolved: listUnresolvedInstances(SHEET), catalog: { partId: "lib:part-u2", mpn: null, manufacturer: null, packageNormalized: null, pinCount: null } });
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.compiled.catalogCrossCheck).toEqual({ state: "checked", partId: "lib:part-u2", compared: [] });
  });

  it("the closed argument surface: symbol / footprint references and authority-shaped keys are refused by name, an unknown key and a missing refDes refuse invalid_input; no schematic refuses authority_unavailable; a cancelled run refuses cancelled; a viewer is unauthorized at the registry", async () => {
    const external = fakeExternal();
    const catalog = fakeCatalog({});
    const gateway = gatewayWith({ external: external.port, catalog: catalog.port });
    const context = contextFor({ external: true, catalog: true });
    for (const key of ["symbol", "footprint", "approve", "publish", "mappingCertificateId", "links", "evidence"]) {
      const outcome = await invoke(gateway, DRAFT, context, { ...REQUEST, [key]: "x" });
      expect(outcome, key).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("authority-shaped")] });
    }
    expect(await invoke(gateway, DRAFT, context, { ...REQUEST, colour: "red" })).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("Unexpected argument")] });
    expect(await invoke(gateway, DRAFT, context, withoutKey("refDes"))).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await invoke(gateway, DRAFT, contextFor({ schematic: null }), REQUEST)).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    expect(await invoke(gateway, DRAFT, contextFor({ headMark: false }), REQUEST)).toMatchObject({ kind: "refused", status: "authority_unavailable", diagnostics: [expect.stringContaining("head mark")] });
    const aborted = new AbortController();
    aborted.abort();
    expect(await invoke(gateway, DRAFT, context, REQUEST, 5_000, aborted.signal)).toMatchObject({ kind: "refused", status: "cancelled" });
    expect(await invoke(gateway, DRAFT, contextFor({ role: "viewer" }), REQUEST)).toMatchObject({ kind: "refused", status: "not_discoverable" });
    expect(catalog.requests).toHaveLength(0);
    expect(external.calls).toEqual({ search: [], evidence: [] });
  });
});

describe("PR-F fB - through the real loop", () => {
  const step = (toolCalls: AgentStep["toolCalls"], text = ""): AgentStep => ({ text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null } });

  it("the model reads the missing facts, then seals ONE draft request: tool_finished succeeded then proposal_sealed, draft_request_ready exactly once with the sealed artifact; a second proposal in the run is refused proposal_exists; no connector asked", async () => {
    const external = fakeExternal();
    const context = contextFor({ external: true, board: false });
    const events: AgentRunEvent[] = [];
    const continuations: string[][] = [];
    let turn = 0;
    const adapter: ProviderAgentAdapter = {
      provider: "openai",
      async start(input) {
        const read = input.tools.find((declaration) => declaration.toolId === READ);
        const draft = input.tools.find((declaration) => declaration.toolId === DRAFT);
        expect(read, "the missing-facts read is offered").toBeDefined();
        expect(draft, "the draft request is offered").toBeDefined();
        return step([{ callId: "call-1", providerName: read!.providerName, argumentsText: "{}" }]);
      },
      async continueWith(input) {
        continuations.push(input.results.map((result) => result.outputText));
        turn += 1;
        const draft = input.tools.find((declaration) => declaration.toolId === DRAFT)!;
        if (turn === 1) return step([{ callId: "call-2", providerName: draft.providerName, argumentsText: JSON.stringify(REQUEST) }]);
        if (turn === 2) return step([{ callId: "call-3", providerName: draft.providerName, argumentsText: JSON.stringify(REQUEST) }]);
        return step([], "U2 needs a reviewed draft; the request is sealed for a person to file.");
      },
    };
    const result = await runAgentLoop(
      { runId: "run-prf-loop", provider: "openai", history: [], userMessage: "What is missing for U2, and prepare the draft request.", budget: DEFAULT_AGENT_BUDGET },
      { adapter, gateway: gatewayWith({ external: external.port }), registry, context, system: "test", emit: (event) => { events.push(event); } },
    );
    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["succeeded", "proposal_sealed"]);
    const ready = events.filter((event) => event.type === "draft_request_ready");
    expect(ready).toHaveLength(1);
    const sealed = (ready[0] as { proposal: SealedPartDraftRequest }).proposal;
    expect(sealed.schema).toBe(DRAFT_REQUEST_SCHEMA);
    expect(verifySealedPartDraftRequestIntegrity(sealed)).toEqual({ ok: true });
    expect(events.some((event) => event.type === "proposal_ready" || event.type === "pcb_proposal_ready" || event.type === "generation_proposal_ready" || event.type === "execution_grant_ready")).toBe(false);
    expect(events.filter((event) => event.type === "tool_refused").map((event) => (event as { status: string }).status)).toEqual(["proposal_exists"]);
    const toldRead = JSON.parse(continuations[0]![0]!) as { ok: boolean; output: { report: { items: Array<{ checklist: { refDes: string } }> } } };
    expect(toldRead.ok).toBe(true);
    expect(toldRead.output.report.items.map((item) => item.checklist.refDes)).toEqual(["R9", "U2"]);
    const toldDraft = JSON.parse(continuations[1]![0]!) as { ok: boolean; status: string; verification: string; missing: string[]; pcbAssignment: { blocked: boolean }; note: string };
    expect(toldDraft).toMatchObject({ ok: true, status: "proposal_sealed", verification: DRAFT_REQUEST_VERIFICATION, pcbAssignment: { blocked: true } });
    expect(toldDraft.note).toContain("never claim the part exists");
    expect(JSON.stringify(toldDraft)).not.toContain("terminals"); // the model is told the facts' DATA, never the spec to relay as a part
    expect(external.calls).toEqual({ search: [], evidence: [] });
  });
});

describe("PR-F fB - the ratchet amendment's tripwire and the CONTINUATION C case index", () => {
  const runtimeImports = (file: string): string[] => {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    const specs: string[] = [];
    for (const match of source.matchAll(/^\s*(import|export)\s+(?!type\s)([^;]*?)\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)) specs.push(match[3] ?? match[4]!);
    return specs;
  };

  it("the two acquisition modules admitted to the chat closure stay contract / label modules: external-search-contract.ts has no runtime import, source-labels.ts imports only the source registry; the UI's derivation reaches no other acquisition module; the agent modules import no database, route or vendor code", () => {
    expect(runtimeImports("app/lib/acquisition/external-search-contract.ts")).toEqual([]);
    expect(runtimeImports("app/lib/acquisition/source-labels.ts")).toEqual(["./source-registry"]);
    const derivation = runtimeImports("app/lib/parts/missing-facts.ts").filter((spec) => spec.includes("acquisition"));
    expect(derivation.sort()).toEqual(["@/app/lib/acquisition/external-search-contract", "@/app/lib/acquisition/source-labels", "@/app/lib/acquisition/source-registry"]);
    for (const file of ["app/lib/agent/missing-facts-reads.ts", "app/lib/agent/draft-request-proposals.ts"]) {
      const source = readFileSync(resolve(ROOT, file), "utf8");
      for (const spec of runtimeImports(file)) expect(spec, `${file}: ${spec}`).not.toMatch(/\/db\/|\/api\/|server-catalog|drizzle|acquisition\/(?!source-registry)|distributors|authoring|publication-review"|catalog-part-detail"/);
      expect(source).not.toMatch(/getDb|fetch\(|process\.env/);
    }
    const ratchet = readFileSync(resolve(ROOT, "app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts"), "utf8");
    expect(ratchet).toContain("external-search-contract\\.ts$|source-labels\\.ts$");
    expect(ratchet).toContain("[PR-F fB, 2026-10-17] REVIEWED AMENDMENT");
  });

  it("every B19-E case the evidence page cites for a CONTINUATION C refusal still exists under its title", () => {
    const cited: Array<[file: string, title: string]> = [
      ["app/lib/acquisition/__tests__/b19-e-agent-read-port.test.ts", "an offer-cache hit makes zero vendor calls"],
      ["app/lib/acquisition/__tests__/b19-e-agent-read-port.test.ts", "a miss goes live only when disclosure is permitted and the server's live policy allows"],
      ["app/lib/acquisition/__tests__/b19-e-external-search.test.ts", "without live pricing a miss asks no vendor"],
      ["app/lib/acquisition/__tests__/b19-e-external-search-sources.test.ts", "an operator switch-off holds for search: DigiKey off is never constructed"],
      ["app/lib/acquisition/__tests__/b19-e-agent-read-port.test.ts", "a used-up agent share answers paused with when to retry, and sends nothing"],
      ["app/lib/acquisition/__tests__/b19-e-external-search-sources.test.ts", "missing credentials: not constructed, and the result names no environment variable"],
      ["app/lib/acquisition/__tests__/b19-e-agent-read-port.test.ts", "under the committed registry a cached answer (hostile vendor text included) is labels only and live is never used"],
      ["app/lib/agent/__tests__/b19-e-external-read-service.test.ts", "for a permitting source an instruction in vendor text reaches the model only under untrustedVendorText"],
      ["app/lib/acquisition/__tests__/b19-e-quarantine-review-fixes.test.ts", "an engineering disagreement names each value's class"],
      ["app/lib/acquisition/__tests__/b19-e-import-review.test.ts", "changes when an identity conflict appears"],
      ["app/lib/acquisition/__tests__/b19-e-agent-read-port.test.ts", "with no cached observation and no published revision it still reports everything missing and nothing else"],
      ["app/lib/acquisition/__tests__/b19-e-import-review.test.ts", "the missing list follows the profile: schematic_only needs a symbol; pcb_assignable needs symbol, footprint and pin-to-pad mapping"],
      ["app/lib/atomic/__tests__/b19-e-publication-review.test.ts", "a rejection needs no resolutions, names its reason, and is final"],
    ];
    for (const [file, title] of cited) expect(readFileSync(resolve(ROOT, file), "utf8"), `${file}: ${title}`).toContain(title);
    expect(PCB_ASSIGNMENT_BLOCKING_FACTS).toHaveLength(6);
  });
});
