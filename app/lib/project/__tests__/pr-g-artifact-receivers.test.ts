/**
 * [PR-G, 2026-10-17] The page's SAFE receivers for the agent's three new sealed artifacts, driven with artifacts the services' OWN
 * sealers / compiler produced (no provider, no network, no process):
 *
 *  1. draft_request_ready (OD-248): a sealed `sirkit.part-draft-request.v1` is received with its run id as audit metadata; a wrong event
 *     type, a wrong schema, a tampered fact, an extra key and a non-object are dropped; the currency check against the live editor
 *     refuses a foreign scope, an expired request, a moved or absent head and a changed sheet, each with the page's sentence and in that
 *     order; the publication prefill is the sealed spec in the form's fields (symbol and footprint never invented); the card's rows are the
 *     artifact's facts.
 *  2. module_contracts_ready (OD-249): the same receiver discipline over `sirkit.module-contract-proposal.v1`; the note's rows name the
 *     modules, owned components, ports, constraints, gaps and the validator's result as data; nothing in them claims an apply or a verdict.
 *  3. stackup_candidate_ready (OD-249): a sealed `sirkit.stackup-candidate.v1` is received; a foreign producer, a tampered content and a
 *     wrong schema are dropped; the board check refuses no board, an expired candidate, a stale revision and an altered candidate with
 *     a sentence; the chat line states current against recommended, the qualification as the candidate states it and the invalidation.
 */
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { DRAFT_REQUEST_INPUT_EXAMPLE, DRAFT_REQUEST_SCHEMA, DRAFT_REQUEST_TTL_MS, compilePartDraftRequest, sealPartDraftRequest, type SealedPartDraftRequest } from "@/app/lib/agent/draft-request-proposals";
import { MODULE_CONTRACT_PROPOSAL_SCHEMA, MODULE_CONTRACT_PROPOSAL_TTL_MS, sealModuleContractProposal, type SealedModuleContractProposal } from "@/app/lib/agent/module-contract-proposals";
import { validateModuleContractSet } from "@/app/lib/engineering/module-contract";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { listUnresolvedInstances } from "@/app/lib/pcb-sync/unresolved-instances";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { STACKUP_CANDIDATE_SCHEMA, STACKUP_CANDIDATE_TTL_MS, compileStackupCandidate, type StackupCandidate } from "@/app/lib/pcb/candidates/stackup-candidate";
import { DRAFT_REQUEST_CARD_ID_PREFIX, DRAFT_REQUEST_OPEN_LABEL, draftRequestCardLines, draftRequestCurrency, draftRequestPublicationPrefill, receiveDraftRequestEvent } from "../draft-request-events";
import { MODULE_CONTRACT_NOTE_HOME, MODULE_CONTRACT_NOTE_ID_PREFIX, moduleContractCurrency, moduleContractNoteLines, receiveModuleContractsEvent } from "../module-contract-events";
import { receiveStackupCandidateEvent, stackupCandidateChatLine, verifyStackupCandidateAgainstBoard } from "../stackup-candidate-events";
import { sheetArtifactCurrency } from "../sheet-artifact-currency";

const SCOPE = { tenantId: "local", projectId: "p-prg-receivers", branchId: "main" };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };
const NOW = 1_760_000_000_000;
const ACTOR = { principalId: "u-1", actorRole: "pcb_editor" as const, membershipRevision: "mbr1-a", authMethod: "local_dev" as const };
/** the stream carries JSON: the page receives a plain (unfrozen) copy */
const wire = <T,>(value: T): Record<string, unknown> => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

// ─── draft request fixture (pr-f-missing-parts-parity's sheet: U1 resolved, U2 placed without a published revision) ─────────────
const DRAFT_SHEET: SchematicState = {
  components: [{ id: "r9", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k", refDes: "R9" }],
  wires: [], netLabels: [],
  kicadComponents: [
    { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "NE555", atomicPartRevisionId: "rev-u1", symbolAssetVersionId: "sym-u1" },
    { id: "u2-id", partId: "lib:part-u2", x: 300, y: 200, rotation: 0, refDes: "U2", value: "NE555DR" },
  ],
} as unknown as SchematicState;
const SRC = "TI SLFS022I, table 5-1";
const PINS = ["GND", "TRIG", "OUT", "RESET", "CONT", "THRES", "DISCH", "VCC"].map((name, index) => ({ number: String(index + 1), name, function: name.toLowerCase(), source: SRC }));
const REQUEST: Record<string, unknown> = { ...structuredClone(DRAFT_REQUEST_INPUT_EXAMPLE), refDes: "U2", pinTable: PINS };

function context(schematic: SchematicState, board = true) {
  const assembly = assembleAgentRunContext({ ...SCOPE, schematic, ...(board ? { board: createEmptyBoard() } : {}), schematicHeadMark: HEAD_MARK, verifiedActor: ACTOR });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
function sealedDraft(): SealedPartDraftRequest {
  const compiled = compilePartDraftRequest({ args: REQUEST, unresolved: listUnresolvedInstances(DRAFT_SHEET), catalog: null, catalogReason: "the catalog port is not bound to this run" });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.blockers));
  return sealPartDraftRequest({ compiled: compiled.compiled, provider: "openai", runId: "run-prg-draft", context: context(DRAFT_SHEET, false), headMark: HEAD_MARK, descriptor: { version: "1.0.0" }, instruction: "draft U2 from the datasheet", now: NOW });
}
const liveSheet = (sheet: SchematicState, overrides: Partial<Parameters<typeof draftRequestCurrency>[1]> = {}) => ({ scope: SCOPE, headMark: HEAD_MARK, baseDigest: schematicStateDigest(sheet), now: NOW + 1_000, ...overrides });

// ─── module contract fixture (pr-f-module-propose's sheet and request) ─────────────────────────────────────────────────────────
const MODULE_SHEET: SchematicState = {
  components: [
    { id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k", refDes: "R1" },
    { id: "c1", type: "capacitor", x: 200, y: 100, rotation: 0, value: "100n", refDes: "C1" },
    { id: "gnd1", type: "ground", x: 200, y: 200, rotation: 0, value: "" },
  ],
  wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 170, y: 100 }] }, { id: "w2", vertices: [{ x: 230, y: 100 }, { x: 230, y: 180 }, { x: 200, y: 180 }] }],
  netLabels: [
    { id: "l1", position: { x: 70, y: 100 }, name: "VIN", kind: "signal", orientation: 0 },
    { id: "l2", position: { x: 130, y: 100 }, name: "AIN", kind: "signal", orientation: 0 },
    { id: "l3", position: { x: 400, y: 300 }, name: "+3V3", kind: "power", orientation: 0 },
  ],
  kicadComponents: [
    { id: "u1-id", partId: "lib:adc121", x: 400, y: 100, rotation: 0, refDes: "U1", value: "ADC121" },
    { id: "u2-id", partId: "lib:ne555", x: 400, y: 200, rotation: 0, refDes: "U2", value: "NE555", atomicPartRevisionId: "rev-u2", symbolAssetVersionId: "sym-u2" },
  ],
} as unknown as SchematicState;
type Rec = Record<string, unknown>;
const Q = (name: string, value: number, unit: string, bound = "nominal"): Rec => ({ name, value, unit, bound });
const EVIDENCE: Rec = { sourceIdentity: "ADC121 datasheet", documentRevision: "rev C", section: "analog input", applicability: "U1 AIN pin", assumptions: "acquisition time as specified", uncertainty: "none stated", kind: "hard-requirement" };
const LPF: Rec = {
  id: "lpf", name: "Anti-alias low-pass filter", responsibility: "Band-limit VIN below the ADC's Nyquist frequency and present it on AIN.",
  components: [{ refDes: "R1" }, { refDes: "C1" }],
  ports: [
    { id: "in", net: "VIN", direction: "input", logicLevel: "analog", voltage: [Q("signal", 0, "V", "min"), Q("signal", 2.5, "V", "max")], impedance: [Q("input impedance", 10000, "ohm")], unknown: ["current", "permittedLoading"], evidence: [EVIDENCE] },
    { id: "out", net: "AIN", direction: "output", logicLevel: "analog", voltage: [Q("signal", 2.5, "V", "max")], impedance: [Q("output impedance", 10000, "ohm")], permittedLoading: [Q("load capacitance", 50, "pF", "max")], unknown: ["current"], evidence: [EVIDENCE] },
    { id: "gnd", net: "GND", direction: "ground", unknown: ["voltage", "current", "impedance", "permittedLoading"] },
  ],
  requirements: [{ topic: "bandwidth", statement: "Cut-off well below the Nyquist frequency of 5 kHz.", quantities: [Q("cut-off frequency", 1600, "Hz")], evidence: [EVIDENCE] }],
  unknown: ["noise", "accuracy", "timing"], notApplicable: ["gain", "power", "reference", "ground", "startup", "protection"],
  partAuthorityGaps: ["R1", "C1"], placementRouting: ["keep C1 at the ADC input pin"], tests: [],
};
const ADC: Rec = {
  id: "adc", name: "ADC interface", responsibility: "Sample AIN at 10 kS/s referenced to the 3.3 V rail.",
  components: [{ refDes: "U1" }],
  ports: [
    { id: "ain", net: "AIN", direction: "input", logicLevel: "analog", voltage: [Q("absolute maximum", 3.6, "V", "max")], impedance: [Q("sample capacitance", 20, "pF", "typical")], unknown: ["current", "permittedLoading"], evidence: [EVIDENCE] },
    { id: "vref", net: "+3V3", direction: "power-in", voltage: [Q("supply and reference", 3.3, "V")], current: [Q("supply current", 2, "mA", "max")], unknown: ["impedance", "permittedLoading"], evidence: [EVIDENCE] },
    { id: "gnd", net: "GND", direction: "ground", unknown: ["voltage", "current", "impedance", "permittedLoading"] },
  ],
  requirements: [{ topic: "accuracy", statement: "12-bit no-missing-codes over the input range.", quantities: [Q("resolution", 12, "bit")], evidence: [EVIDENCE] }],
  unknown: ["noise", "timing", "startup", "protection"], notApplicable: ["bandwidth", "gain", "power", "reference", "ground"],
  partAuthorityGaps: ["U1"], placementRouting: [], tests: [],
};
const VALID: Rec = {
  system: { name: "Single-channel acquisition front end", statement: "A 0 to 2.5 V signal band-limited and sampled by a 12-bit ADC from a 3.3 V rail." },
  modules: [LPF, ADC],
  constraints: [
    { id: "ain-interface", kind: "interface", net: "AIN", modules: ["lpf", "adc"], statement: "The filter drives the ADC sample capacitor.", loading: { driver: "lpf", quantities: [Q("receiver sample capacitance", 20, "pF", "typical"), Q("driver permitted load", 50, "pF", "max")] }, evidence: [EVIDENCE] },
    { id: "rail", kind: "shared-power", net: "+3V3", modules: ["adc"], owner: "adc", statement: "The 3.3 V rail is the ADC reference.", evidence: [EVIDENCE] },
    { id: "ground", kind: "shared-ground", net: "GND", modules: ["adc", "lpf"], owner: "adc", statement: "One ground return for the filter and the ADC.", evidence: [EVIDENCE] },
  ],
};
function sealedContracts(): SealedModuleContractProposal {
  const validation = validateModuleContractSet(VALID, MODULE_SHEET);
  if (!validation.ok) throw new Error(JSON.stringify(validation.blockers));
  return sealModuleContractProposal({ set: validation.set, provider: "anthropic", runId: "run-prg-modcon", context: context(MODULE_SHEET), headMark: HEAD_MARK, descriptor: { version: "1.0.0" }, now: NOW });
}

// ─── stackup fixture (pr-f-stackup-candidate's two-layer board with three nets) ───────────────────────────────────────────────
function board() {
  const resistor = makeResistorDef();
  return makeBoard(40, 30, [makeInstance("r1", resistor, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("r2", resistor, { x: 30, y: 22 }, { "1": 1, "2": 3 })], 3);
}
function sealedStackup(theBoard = board()): StackupCandidate {
  const compiled = compileStackupCandidate({ board: theBoard, request: { profileId: "signal-plane-4", manufacturingProfileId: "jlcpcb-4l", planes: [{ layer: "in1", net: { name: "NET_1", id: 1 } }], viaTechnology: "through", rationale: "A continuous ground return under the top signal layer." }, presetId: "jlcpcb-2l", clock: () => new Date(NOW).toISOString() });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.blockers));
  return compiled.candidate;
}

describe("[PR-G receivers 1] draft_request_ready", () => {
  it("receives a sealed request from its own event with the run id as audit metadata; drops a wrong type, a wrong schema, a tampered fact, an extra key and a non-object", () => {
    const proposal = sealedDraft();
    expect(proposal.schema).toBe(DRAFT_REQUEST_SCHEMA);
    const received = receiveDraftRequestEvent({ type: "draft_request_ready", runId: "run-prg-draft", toolId: proposal.toolId, proposal: wire(proposal) });
    expect(received).not.toBeNull();
    expect(received!.proposal.proposalId).toBe(proposal.proposalId);
    expect(received!.runId).toBe("run-prg-draft");
    expect(receiveDraftRequestEvent({ type: "draft_request_ready", runId: 42, proposal: wire(proposal) })!.runId).toBeNull();
    expect(receiveDraftRequestEvent({ type: "generation_proposal_ready", runId: "r", proposal: wire(proposal) })).toBeNull();
    expect(receiveDraftRequestEvent({ type: "draft_request_ready", runId: "r", proposal: { ...wire(proposal), schema: "sirkit.module-contract-proposal.v1" } })).toBeNull();
    const tampered = wire(proposal) as { draftRequest: { exactMpn: string } };
    tampered.draftRequest.exactMpn = "LM555CM";
    expect(receiveDraftRequestEvent({ type: "draft_request_ready", runId: "r", proposal: tampered })).toBeNull();
    const asserted = wire(proposal) as { verification: string };
    asserted.verification = "verified"; // a claim a draft request can never carry
    expect(receiveDraftRequestEvent({ type: "draft_request_ready", runId: "r", proposal: asserted })).toBeNull();
    expect(receiveDraftRequestEvent({ type: "draft_request_ready", runId: "r", proposal: { ...wire(proposal), published: true } })).toBeNull();
    expect(receiveDraftRequestEvent({ type: "draft_request_ready", runId: "r", proposal: "draftreq-x" })).toBeNull();
    expect(receiveDraftRequestEvent({ type: "draft_request_ready", runId: "r" })).toBeNull();
    expect(receiveDraftRequestEvent(null)).toBeNull();
  });

  it("is current with the matching scope, head, base and time; refuses a foreign scope, an expired request, a moved or absent head and a changed sheet with the page's sentence, in that order", () => {
    const proposal = sealedDraft();
    expect(draftRequestCurrency(proposal, liveSheet(DRAFT_SHEET))).toEqual({ ok: true });
    expect(draftRequestCurrency(proposal, liveSheet(DRAFT_SHEET, { scope: { ...SCOPE, projectId: "p-other" } }))).toMatchObject({ ok: false, code: "foreign-scope", detail: "the draft request was sealed for another project or branch; nothing was changed." });
    expect(draftRequestCurrency(proposal, liveSheet(DRAFT_SHEET, { now: NOW + DRAFT_REQUEST_TTL_MS }))).toMatchObject({ ok: false, code: "expired", detail: expect.stringContaining("expired before it could be reviewed") });
    expect(draftRequestCurrency(proposal, liveSheet(DRAFT_SHEET, { now: NOW + DRAFT_REQUEST_TTL_MS - 1 }))).toEqual({ ok: true });
    expect(draftRequestCurrency(proposal, liveSheet(DRAFT_SHEET, { headMark: { ...HEAD_MARK, headSequence: 4 } }))).toMatchObject({ ok: false, code: "stale-head", detail: expect.stringContaining("canonical head moved since the draft request was sealed") });
    expect(draftRequestCurrency(proposal, liveSheet(DRAFT_SHEET, { headMark: null }))).toMatchObject({ ok: false, code: "stale-head", detail: expect.stringContaining("not ready") });
    const resolved: SchematicState = { ...DRAFT_SHEET, kicadComponents: [DRAFT_SHEET.kicadComponents![0]!, { ...DRAFT_SHEET.kicadComponents![1]!, atomicPartRevisionId: "rev-u2", symbolAssetVersionId: "sym-u2" }] };
    expect(draftRequestCurrency(proposal, liveSheet(resolved))).toMatchObject({ ok: false, code: "stale-base", detail: "the schematic changed since the draft request was sealed — it is stale and was not offered." });
    // order: a foreign scope before expiry, a stale head before a stale base
    expect(draftRequestCurrency(proposal, liveSheet(DRAFT_SHEET, { scope: { ...SCOPE, branchId: "feature" }, now: NOW + DRAFT_REQUEST_TTL_MS }))).toMatchObject({ code: "foreign-scope" });
    expect(draftRequestCurrency(proposal, liveSheet(DRAFT_SHEET, { headMark: null, baseDigest: "eng1-00" }))).toMatchObject({ code: "stale-head" });
    for (const refusal of [liveSheet(DRAFT_SHEET, { scope: { ...SCOPE, projectId: "p-other" } }), liveSheet(DRAFT_SHEET, { now: NOW + DRAFT_REQUEST_TTL_MS }), liveSheet(DRAFT_SHEET, { headMark: null }), liveSheet(DRAFT_SHEET, { baseDigest: "eng1-00" })]) {
      const outcome = draftRequestCurrency(proposal, refusal);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.detail).toMatch(/nothing was changed|was not offered/i);
    }
    expect(sheetArtifactCurrency(proposal, liveSheet(DRAFT_SHEET, { now: NOW + DRAFT_REQUEST_TTL_MS }), "module contract set")).toMatchObject({ detail: "the module contract set expired before it could be reviewed; ask for it again. Nothing was changed." });
  });

  it("the publication prefill is the sealed spec in the form's fields: MPN, manufacturer, profile, the pin table one line per pin, package, mounting, datasheet; symbol and footprint never invented; the catalog part only when the cross-check ran", () => {
    const proposal = sealedDraft();
    const prefill = draftRequestPublicationPrefill(proposal);
    expect(prefill).toMatchObject({ exactMpn: "NE555DR", manufacturer: "Texas Instruments", partId: null, symbol: null, footprint: null, profile: "schematic_only", packageCode: "SOIC-8 (D)", mounting: "smd", datasheetUrl: "", datasheetLocator: "" });
    const lines = prefill.terminals.split("\n");
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe("1 GND: gnd 1");
    expect(lines[7]).toBe("8 VCC: vcc 8");
    expect(proposal.catalogCrossCheck).toMatchObject({ state: "unavailable" });
    const checked = { ...proposal, catalogCrossCheck: { state: "checked" as const, partId: "lib:part-u2", compared: ["mpn", "pinCount"] } };
    expect(draftRequestPublicationPrefill(checked).partId).toBe("lib:part-u2");
  });

  it("the review-task card's rows are the artifact's facts: the part and its missing fact, each documented fact with its source, each missing fact, the PCB-assignment blockers, the cross-check, the path, what it never claims and the one action", () => {
    const proposal = sealedDraft();
    const card = draftRequestCardLines(proposal);
    expect(card.title).toBe("Review task — unverified draft request for U2 (NE555DR)");
    expect(card.lines[0]).toContain("Part: U2 (catalog part) — no published exact revision; review path: ");
    expect(card.lines[1]).toContain("exact MPN NE555DR; manufacturer Texas Instruments; package SOIC-8 (D), surface mount; 8 pins in the pin table; profile schematic_only");
    expect(card.lines[1]).toContain("Verification: unverified");
    expect(card.lines).toContain("Documented: exact manufacturer part number = NE555DR (source: TI SLFS022I, page 1)");
    expect(card.lines).toContain(`Documented: pin 1 = GND / gnd / pads 1 (source: ${SRC})`);
    expect(card.lines.filter((line) => line.startsWith("Documented: "))).toHaveLength(proposal.documented.length);
    expect(card.lines.filter((line) => line.startsWith("Missing: "))).toHaveLength(proposal.missing.length);
    expect(card.lines).toContain("Missing: courtyard per IPC-7351 is not in the datasheet");
    expect(card.lines.find((line) => line.startsWith("PCB assignment: "))).toMatch(/^PCB assignment: BLOCKED — /);
    expect(card.lines.find((line) => line.startsWith("Catalog cross-check: "))).toContain("unavailable — the catalog port is not bound to this run");
    expect(card.lines.find((line) => line.startsWith("Path: "))).toContain("submit_request");
    expect(card.lines.find((line) => line.startsWith("Never: "))).toBe(`Never: ${proposal.reviewTask.neverClaims}`);
    expect(card.lines[card.lines.length - 1]).toContain(`"${DRAFT_REQUEST_OPEN_LABEL}" below opens the Build Library's evidence review prefilled from this request`);
    expect(card.lines[card.lines.length - 1]).toContain("Nothing is requested until a person submits it there.");
    expect(DRAFT_REQUEST_CARD_ID_PREFIX).toBe("draft-request:");
    for (const line of card.lines) expect(line).not.toMatch(/\b(is|was|has been) (verified|approved|published|bound|PCB-assignable)\b/i); // no row states a verdict the artifact cannot carry
  });
});

describe("[PR-G receivers 2] module_contracts_ready", () => {
  it("receives a sealed set with its run id; drops a wrong type, a wrong schema, a tampered module, an asserted electrical check, an extra key and a non-object", () => {
    const proposal = sealedContracts();
    expect(proposal.schema).toBe(MODULE_CONTRACT_PROPOSAL_SCHEMA);
    const received = receiveModuleContractsEvent({ type: "module_contracts_ready", runId: "run-prg-modcon", toolId: proposal.toolId, proposal: wire(proposal) });
    expect(received).not.toBeNull();
    expect(received!.proposal.proposalId).toBe(proposal.proposalId);
    expect(received!.runId).toBe("run-prg-modcon");
    expect(receiveModuleContractsEvent({ type: "draft_request_ready", runId: "r", proposal: wire(proposal) })).toBeNull();
    expect(receiveModuleContractsEvent({ type: "module_contracts_ready", runId: "r", proposal: { ...wire(proposal), schema: DRAFT_REQUEST_SCHEMA } })).toBeNull();
    const tampered = wire(proposal) as { contractSet: { modules: Array<{ name: string }> } };
    tampered.contractSet.modules[0]!.name = "Gain stage";
    expect(receiveModuleContractsEvent({ type: "module_contracts_ready", runId: "r", proposal: tampered })).toBeNull();
    const asserted = wire(proposal) as { electricalCheck: { state: string } };
    asserted.electricalCheck.state = "passed";
    expect(receiveModuleContractsEvent({ type: "module_contracts_ready", runId: "r", proposal: asserted })).toBeNull();
    expect(receiveModuleContractsEvent({ type: "module_contracts_ready", runId: "r", proposal: { ...wire(proposal), applied: true } })).toBeNull();
    expect(receiveModuleContractsEvent({ type: "module_contracts_ready", runId: "r", proposal: [] })).toBeNull();
    expect(receiveModuleContractsEvent(undefined)).toBeNull();
  });

  it("is current with the live sheet; refuses a foreign scope, an expired set, a moved head and a changed sheet with the page's sentence", () => {
    const proposal = sealedContracts();
    expect(moduleContractCurrency(proposal, liveSheet(MODULE_SHEET))).toEqual({ ok: true });
    expect(moduleContractCurrency(proposal, liveSheet(MODULE_SHEET, { scope: { ...SCOPE, projectId: "p-other" } }))).toMatchObject({ code: "foreign-scope", detail: "the module contract set was sealed for another project or branch; nothing was changed." });
    expect(moduleContractCurrency(proposal, liveSheet(MODULE_SHEET, { now: NOW + MODULE_CONTRACT_PROPOSAL_TTL_MS }))).toMatchObject({ code: "expired" });
    expect(moduleContractCurrency(proposal, liveSheet(MODULE_SHEET, { headMark: { ...HEAD_MARK, canonicalStateDigest: "eng1-moved" } }))).toMatchObject({ code: "stale-head" });
    expect(moduleContractCurrency(proposal, liveSheet(DRAFT_SHEET))).toMatchObject({ code: "stale-base", detail: "the schematic changed since the module contract set was sealed — it is stale and was not offered." });
  });

  it("the note's rows: a summary (modules, ownership, constraints, gaps, structure-only validation, electrical check not run), then every module with its owned components and ports, each constraint, the unresolved part authority, the validator's result as data and where the note lives; no row claims an apply or a verdict", () => {
    const proposal = sealedContracts();
    const note = moduleContractNoteLines(proposal);
    expect(note.title).toBe("Engineering note — module contracts for Single-channel acquisition front end (2 modules)");
    expect(note.summary).toContain("2 modules owning 3 of 4 physical instances (1 unassigned: U2), 3 cross-module constraints, 3 part-authority gaps");
    expect(note.summary).toContain("Validated for structure only (contract-structure-checked); electrical check: not run.");
    expect(note.details.find((line) => line.startsWith("Module lpf — "))).toContain("Owns R1 (10k) — Theory symbol, C1 (100n) — Theory symbol. Part-authority gaps acknowledged: R1, C1.");
    expect(note.details.find((line) => line.startsWith("Module adc — "))).toContain("Owns U1 (ADC121) — no published exact revision");
    expect(note.details).toContain("  Port lpf.in → net VIN, input, analog; signal 0 V (min); signal 2.5 V (max); input impedance 10000 ohm (nominal); unknown: current, permittedLoading; evidence: ADC121 datasheet rev C §analog input");
    expect(note.details.find((line) => line.startsWith("Constraint ain-interface (interface) on net AIN between adc, lpf"))).toContain("Loading (driver lpf): receiver sample capacitance 20 pF (typical); driver permitted load 50 pF (max).");
    expect(note.details.find((line) => line.startsWith("Unresolved part authority"))).toMatch(/U1 in adc — published_exact_revision/);
    expect(note.details.find((line) => line.startsWith("Validator result (data, not a verdict): contract-structure-checked"))).toContain("Electrical check not run: ");
    expect(note.details[note.details.length - 1]).toContain(MODULE_CONTRACT_NOTE_HOME);
    expect(MODULE_CONTRACT_NOTE_HOME).toContain("no separate notes store exists");
    expect(MODULE_CONTRACT_NOTE_ID_PREFIX).toBe("module-contracts:");
    for (const line of [note.summary, ...note.details]) expect(line).not.toMatch(/\b(was|has been) (applied|approved|verified)\b|\bis (approved|verified)\b|\bpassed\b/i); // no row states a verdict or an apply ("Nothing is applied" is the negation)
  });
});

describe("[PR-G receivers 3] stackup_candidate_ready", () => {
  it("receives a sealed candidate with its run id; drops a wrong type, a wrong schema, a foreign producer, a tampered content, a missing digest and a non-object", () => {
    const candidate = sealedStackup();
    expect(candidate.schema).toBe(STACKUP_CANDIDATE_SCHEMA);
    const received = receiveStackupCandidateEvent({ type: "stackup_candidate_ready", runId: "run-prg-stackup", toolId: "sirkit.stackup.propose", candidate: wire(candidate) });
    expect(received).not.toBeNull();
    expect(received!.candidate.candidateId).toBe(candidate.candidateId);
    expect(received!.runId).toBe("run-prg-stackup");
    expect(receiveStackupCandidateEvent({ type: "layout_candidate_ready", runId: "r", candidate: wire(candidate) })).toBeNull();
    expect(receiveStackupCandidateEvent({ type: "stackup_candidate_ready", runId: "r", candidate: { ...wire(candidate), schema: "sirkit.layout-candidate.v1" } })).toBeNull();
    expect(receiveStackupCandidateEvent({ type: "stackup_candidate_ready", runId: "r", candidate: { ...wire(candidate), producer: "editor" } })).toBeNull();
    const tampered = wire(candidate) as { recommendation: { manufacturing: { releaseQualified: boolean } } };
    tampered.recommendation.manufacturing.releaseQualified = true; // the four-layer preset is NOT release-qualified; a flipped claim is dropped
    expect(receiveStackupCandidateEvent({ type: "stackup_candidate_ready", runId: "r", candidate: tampered })).toBeNull();
    const undigested = wire(candidate); delete undigested.digest;
    expect(receiveStackupCandidateEvent({ type: "stackup_candidate_ready", runId: "r", candidate: undigested })).toBeNull();
    expect(receiveStackupCandidateEvent({ type: "stackup_candidate_ready", runId: "r", candidate: "sc-x" })).toBeNull();
    expect(receiveStackupCandidateEvent(null)).toBeNull();
  });

  it("the board check: current for the sealed board's revision; refuses no board, an expired candidate, a stale revision and an altered candidate, each with a sentence", () => {
    const theBoard = board();
    const candidate = sealedStackup(theBoard);
    const live = pcbRevisionId(theBoard);
    expect(candidate.base.revision).toBe(live);
    expect(verifyStackupCandidateAgainstBoard(candidate, live, NOW + 1_000)).toEqual({ ok: true });
    expect(verifyStackupCandidateAgainstBoard(candidate, null, NOW + 1_000)).toMatchObject({ ok: false, code: "no-board", detail: "no board is loaded in the PCB editor; nothing was changed." });
    expect(verifyStackupCandidateAgainstBoard(candidate, live, NOW + STACKUP_CANDIDATE_TTL_MS)).toMatchObject({ ok: false, code: "expired" });
    expect(verifyStackupCandidateAgainstBoard(candidate, live, NOW + STACKUP_CANDIDATE_TTL_MS - 1)).toEqual({ ok: true });
    const moved = { ...theBoard, stackup: 4 as const };
    expect(verifyStackupCandidateAgainstBoard(candidate, pcbRevisionId(moved), NOW + 1_000)).toMatchObject({ ok: false, code: "stale-revision", detail: expect.stringContaining("the board moved since the recommendation was sealed") });
    const altered = { ...candidate, recommendation: { ...candidate.recommendation, profileId: "dense-4" as const } };
    expect(verifyStackupCandidateAgainstBoard(altered, live, NOW + 1_000)).toMatchObject({ ok: false, code: "altered" });
    for (const verdict of [verifyStackupCandidateAgainstBoard(candidate, null, NOW), verifyStackupCandidateAgainstBoard(candidate, live, NOW + STACKUP_CANDIDATE_TTL_MS), verifyStackupCandidateAgainstBoard(candidate, "pcb2-other", NOW), verifyStackupCandidateAgainstBoard(altered, live, NOW)]) {
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.detail).toMatch(/nothing was changed/i);
    }
  });

  it("the chat line states current against recommended, the manufacturing qualification as the candidate states it, the via profiles, the invalidation and that nothing changed", () => {
    const candidate = sealedStackup();
    const line = stackupCandidateChatLine(candidate);
    expect(line).toContain("Stackup recommendation ready — review it in the PCB editor's preview and accept or discard it; the board is unchanged until you accept.");
    expect(line).toContain("Current: 2-layer simple-2 (2 routable signal).");
    expect(line).toContain("Recommended: 4-layer signal-plane-4 (2 routable signal; planes in1=NET_1)");
    expect(line).toContain("manufacturing preset jlcpcb-4l (NOT release-qualified: DRC and export preflight run, the manufacturing release does not)");
    expect(line).toContain("Accepting it changes the board's stackup and layer count and INVALIDATES dependent approvals");
    expect(line).toContain("Not validated: not DRC-checked, not routed, no impedance or signal-integrity claim.");
    expect(line).not.toMatch(/manufacturable|applied|routed successfully/i);
    const same = compileStackupCandidate({ board: board(), request: { profileId: "simple-2", manufacturingProfileId: "jlcpcb-2l" }, presetId: "jlcpcb-2l", clock: () => new Date(NOW).toISOString() });
    if (!same.ok) throw new Error("the same-stackup candidate did not compile");
    expect(stackupCandidateChatLine(same.candidate)).toContain("It matches the board's current stackup: accepting it changes nothing but records the choice.");
  });
});
