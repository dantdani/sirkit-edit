/**
 * [PR-F fB] The agent's missing-facts read, `sirkit.parts.missing-facts`: the SAME checklist the UI derives, through the REAL gateway
 * and the UI's one derivation (app/lib/parts/missing-facts.ts), over the run's verified schematic and a FAKE catalog port.
 *
 *  - UI/AI parity: the read's items ARE `deriveMissingFacts` over `listUnresolvedInstances(sheet)` with the same schematic facts and
 *    the same catalog record the browser's part cache holds - byte for byte, in the editor's order;
 *  - denied discovery, with the reason: no schematic (project_state_missing) at the registry AND at the run toolset; a viewer keeps
 *    it (Tier 0); a board-less run keeps it; a Theory-only sheet still lists theory_symbol_only;
 *  - the catalog port absent: every identity and evidence fact is unknown with the source "catalog unavailable" - NEVER a guess from
 *    the footprint hint, the pin count or a vendor text; a miss, a failed, throwing or hanging port are data per instance;
 *  - bounded: at most 50 checklists, the rest counted; the catalog asked once per distinct placed part id;
 *  - failures as data: an argument, an authority-shaped argument, no schematic, a cancelled run;
 *  - ZERO live connector calls: a counting fake external acquisition port bound to the same gateway is never asked by this read -
 *    on the happy path, with the catalog unavailable, and on every refusal.
 */
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { discoverTools } from "../../engineering/tool-discovery";
import { schematicStateDigest } from "../../engineering/schematic-model";
import type { ProjectRole } from "../../engineering/types";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { buildRunToolset } from "../../agent/loop";
import type { AgentRunContext } from "../../agent/contracts";
import type { ExternalAcquisitionReadPort, ExternalEvidencePortRequest, ExternalSearchPortRequest } from "../../agent/acquisition-reads";
import type { CatalogPartInspectionPort, CatalogPartInspectionPortAnswer, CatalogPartInspectionPortRequest } from "../../agent/catalog-inspection-reads";
import { CATALOG_UNAVAILABLE, MAX_MISSING_FACTS_INSTANCES, MISSING_FACTS_BINDING, MISSING_FACTS_REPORT_SCHEMA, MISSING_FACTS_TOOL_ID, MISSING_FACTS_VERIFICATION, MISSING_FACTS_VERIFICATION_WITH_CATALOG, NO_CATALOG_LOAD, catalogLoadOf, catalogPartFactsOf, resolveMissingFactsBinding, schematicInstanceFactsOf, type MissingFactsReport } from "../../agent/missing-facts-reads";
import type { CatalogPartDetail } from "../../atomic/catalog-part-detail";
import type { AtomicRevisionStatus } from "../../atomic/revision-status";
import { listUnresolvedInstances, UNRESOLVED_REVIEW_PATH } from "../../pcb-sync/unresolved-instances";
import { createEmptyBoard } from "../../pcb/types";
import { deriveMissingFacts, SOURCING_NEVER_PROVES, THEORY_NOT_PHYSICAL } from "../missing-facts";

const registry = sirkitToolRegistry();
const TOOL = MISSING_FACTS_TOOL_ID;
const SCOPE = { tenantId: "local", projectId: "p-prf-missing-facts", branchId: "main" };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };

/** The editor's own refusal cases on one sheet: U1 resolved; R10 without a revision; C1 with a revision but no symbol asset; R9 a Theory
 *  resistor (physical: refused); G1 a Theory ground (a stimulus: never a blocker). */
const MIXED_SHEET: SchematicState = {
  components: [
    { id: "r9", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k", refDes: "R9" },
    { id: "g1", type: "ground", x: 100, y: 200, rotation: 0, value: "" },
  ],
  wires: [], netLabels: [],
  kicadComponents: [
    { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "NE555", atomicPartRevisionId: "rev-u1", symbolAssetVersionId: "sym-u1" },
    { id: "r10-id", partId: "lib:part-r", x: 300, y: 200, rotation: 0, refDes: "R10", value: "1k" },
    { id: "c1-id", partId: "lib:part-c", x: 300, y: 300, rotation: 0, refDes: "C1", value: "100n", atomicPartRevisionId: "rev-c1" },
  ],
} as unknown as SchematicState;
const THEORY_SHEET: SchematicState = { components: [{ id: "r1", type: "resistor", x: 0, y: 0, rotation: 0, value: "4k7", refDes: "R1" }, { id: "g1", type: "ground", x: 0, y: 50, rotation: 0, value: "" }], wires: [], netLabels: [], kicadComponents: [] } as unknown as SchematicState;

const pin = (number: string, name: string, type = "passive") => ({ number, name, type, position: { x: 0, y: 0 }, orientation: "right" as const, length: 2.54 });
/** The catalog record of lib:part-r: an exact part with a published default link (the browser's part cache holds the same record). */
const PART_R: CatalogPartDetail = {
  id: "lib:part-r", name: "R_1k_0603", description: "Thick film resistor", keywords: null, mpn: "RC0603FR-071KL", manufacturer: "Yageo", datasheet: null,
  footprintHint: "Resistor_SMD:R_0603_1608Metric", mainCategory: "Resistor", libraryName: "Device", pins: [pin("1", "~"), pin("2", "~")],
  symbolRaw: "(symbol \"R\" ...)", properties: {}, internalPartNumber: null, lifecycleStatus: "active", rohsStatus: "compliant", packageNormalized: "0603", keySpecs: null, isGeneric: false,
  atomicAssignments: { "": { revisionId: "rev-r-default", symbolVersionId: "sym-r", footprintVersionId: "fp-r", mappingCertificateId: "map-r", footprintFullName: "Resistor_SMD:R_0603_1608Metric", approved: true } },
  withdrawnValueKeys: [],
} as unknown as CatalogPartDetail;
const STATUS_R: Record<string, AtomicRevisionStatus> = { "rev-r-default": { revisionId: "rev-r-default", logicalPartId: "lp-r", state: "published", selectable: true, pinnable: true } };

interface ContextOptions { schematic?: SchematicState | null; role?: ProjectRole; board?: boolean; catalog?: boolean; external?: boolean }
function contextFor(options: ContextOptions = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE,
    ...(options.schematic === null ? {} : { schematic: options.schematic ?? MIXED_SHEET }),
    ...(options.board === false ? {} : { board: createEmptyBoard() }),
    schematicHeadMark: HEAD_MARK,
    verifiedActor: { principalId: "u-1", actorRole: options.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    ...(options.catalog ? { catalogInspectionAvailable: true } : {}),
    ...(options.external ? { externalAcquisitionAvailable: true } : {}),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const reasonFor = (context: AgentRunContext): string => {
  const result = discoverTools(registry, context.discovery);
  if (result.included.some((item) => item.toolId === TOOL)) return "included";
  return result.excluded.find((item) => item.toolId === TOOL)?.reason ?? "absent";
};
const offered = (context: AgentRunContext): string[] => buildRunToolset(registry, context, () => undefined).declarations.map((declaration) => declaration.toolId);

type CatalogAnswer = CatalogPartInspectionPortAnswer | "hang" | "throw";
function fakeCatalog(answers: Record<string, CatalogAnswer>): { port: CatalogPartInspectionPort; requests: CatalogPartInspectionPortRequest[] } {
  const requests: CatalogPartInspectionPortRequest[] = [];
  return {
    requests,
    port: {
      inspect: async (request) => {
        requests.push(request);
        const answer = answers[request.partId] ?? { state: "not_found" as const };
        if (answer === "hang") return new Promise<never>(() => { /* only the deadline ends this */ });
        if (answer === "throw") throw new Error("connection refused sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop");
        return answer;
      },
    },
  };
}
/** A counting fake of the external acquisition port: the proof that this read never asks a connector. */
function fakeExternal(): { port: ExternalAcquisitionReadPort; calls: { search: ExternalSearchPortRequest[]; evidence: ExternalEvidencePortRequest[] } } {
  const calls = { search: [] as ExternalSearchPortRequest[], evidence: [] as ExternalEvidencePortRequest[] };
  return {
    calls,
    port: {
      async searchExactMpns(request) { calls.search.push(request); throw new Error("a connector was asked"); },
      async readEvidence(request) { calls.evidence.push(request); throw new Error("a connector was asked"); },
    },
  };
}
const CATALOG_ANSWERS: Record<string, CatalogAnswer> = { "lib:part-r": { state: "found", detail: PART_R, revisionStatus: STATUS_R } };
const gatewayWith = (options: { catalog?: CatalogPartInspectionPort; external?: ExternalAcquisitionReadPort } = {}) => createAgentToolGateway(registry, { ...(options.catalog ? { catalogInspection: options.catalog } : {}), ...(options.external ? { externalAcquisition: options.external } : {}), now: () => 1_760_000_000_000 });
const invoke = (gateway: ReturnType<typeof createAgentToolGateway>, context: AgentRunContext, args: Record<string, unknown>, timeoutMs = 5_000, signal?: AbortSignal) =>
  gateway.invoke({ runId: "run-prf-missing-facts", provider: "openai", callId: "call-mf-1", toolId: TOOL, version: "1.0.0", args, context, timeoutMs, ...(signal ? { signal } : {}) });
const reportOf = (outcome: Awaited<ReturnType<ReturnType<typeof createAgentToolGateway>["invoke"]>>): MissingFactsReport => {
  if (outcome.kind !== "read") throw new Error(`not a read: ${JSON.stringify(outcome)}`);
  return outcome.output.report as unknown as MissingFactsReport;
};
const factsOf = (report: MissingFactsReport, refDes: string, cls: "identity" | "evidence" | "stock_pricing") => report.items.find((item) => item.checklist.refDes === refDes)!.checklist.facts.filter((fact) => fact.cls === cls);

describe("PR-F fB parts.missing-facts - UI/AI parity: the read's items ARE the UI's derivation", () => {
  it("with the catalog port: each item equals deriveMissingFacts over the editor's own row, the instance's schematic facts and the SAME catalog record the part cache holds, in the editor's order; the port was asked once per distinct placed part", async () => {
    const catalog = fakeCatalog(CATALOG_ANSWERS);
    const external = fakeExternal();
    const context = contextFor({ catalog: true, external: true, board: false });
    const outcome = await invoke(gatewayWith({ catalog: catalog.port, external: external.port }), context, {});
    expect(outcome).toMatchObject({ kind: "read", ok: true, toolId: TOOL, version: "1.0.0", verification: MISSING_FACTS_VERIFICATION_WITH_CATALOG, sourceRevisionDigest: schematicStateDigest(MIXED_SHEET) });
    const report = reportOf(outcome);
    const rows = listUnresolvedInstances(MIXED_SHEET);
    expect(rows.map((row) => row.refDes)).toEqual(["C1", "R9", "R10"]);
    expect(report.items.map((item) => item.checklist.refDes)).toEqual(["C1", "R9", "R10"]);
    // the UI's derivation, computed here from the same inputs: byte for byte
    const expected = rows.map((instance) => {
      const schematic = schematicInstanceFactsOf(MIXED_SHEET, instance);
      const catalogLoad = instance.family === "theory" ? { state: "none" as const } : schematic.partId === "lib:part-r" ? catalogLoadOf({ state: "found", detail: PART_R, revisionStatus: STATUS_R }).load : catalogLoadOf({ state: "not_found" }).load;
      return deriveMissingFacts({ instance, schematic, catalog: catalogLoad, projectOpen: true });
    });
    expect(report.items.map((item) => item.checklist)).toEqual(expected);
    expect(report).toMatchObject({ schema: MISSING_FACTS_REPORT_SCHEMA, derivation: `${MISSING_FACTS_BINDING.module}#${MISSING_FACTS_BINDING.symbol}`, status: "missing_facts", unresolved: { count: 3, listed: 3, truncated: 0 }, catalog: { state: "bound", partsAsked: 2, partsFailed: 1 }, sourcingRule: SOURCING_NEVER_PROVES });
    expect(report.refusal).toContain("3 part(s)");
    // R10: identity from the record, evidence from its published default link, the revision status as data
    expect(factsOf(report, "R10", "identity").map((fact) => [fact.id, fact.state, fact.value])).toEqual([["manufacturer", "known", "Yageo"], ["exact_mpn", "known", "RC0603FR-071KL"], ["package_variant", "known", "0603"]]);
    expect(factsOf(report, "R10", "evidence").every((fact) => fact.state === "known")).toBe(true);
    expect(report.items.find((item) => item.checklist.refDes === "R10")!.revisionStatus).toEqual({ revisionId: "rev-r-default", state: "published", selectable: true, pinnable: true, successorRevisionId: null });
    // stock and pricing: no sourcing observation in a read - unknown, with the rule that sourcing never proves identity or evidence
    for (const fact of factsOf(report, "R10", "stock_pricing")) { expect(fact.state).toBe("unknown"); expect(fact.note).toBe(SOURCING_NEVER_PROVES); }
    // C1: the catalog does not hold the placed part - data per instance, never a refusal and never a guess
    expect(report.items.find((item) => item.checklist.refDes === "C1")!.catalog).toMatchObject({ state: "unavailable", partId: "lib:part-c", reason: expect.stringContaining("no catalog part has the placed part id") });
    expect(factsOf(report, "C1", "identity").every((fact) => fact.state === "unknown")).toBe(true);
    // the catalog was asked once per distinct placed part id, with the trusted scope and a deadline; the connector never
    expect(catalog.requests.map((request) => request.partId)).toEqual(["lib:part-c", "lib:part-r"]);
    for (const request of catalog.requests) { expect(request.scope).toEqual(SCOPE); expect(request.deadlineMs).toBeGreaterThan(0); expect(request.deadlineMs).toBeLessThanOrEqual(5_000); }
    expect(external.calls).toEqual({ search: [], evidence: [] });
    expect(schematicStateDigest(context.schematic!)).toBe(schematicStateDigest(MIXED_SHEET));
  });

  it("the catalog projection reads exactly what the derivation reads (identity, hint, package, pin count, symbol drawing, links, withdrawn keys); the editor's row texts travel unchanged", () => {
    expect(catalogPartFactsOf(PART_R)).toEqual({ id: "lib:part-r", name: "R_1k_0603", mpn: "RC0603FR-071KL", manufacturer: "Yageo", libraryName: "Device", footprintHint: "Resistor_SMD:R_0603_1608Metric", packageNormalized: "0603", pinCount: 2, hasSymbol: true, atomicAssignments: { "": { revisionId: "rev-r-default", symbolVersionId: "sym-r", footprintVersionId: "fp-r", mappingCertificateId: "map-r", footprintFullName: "Resistor_SMD:R_0603_1608Metric" } }, withdrawnValueKeys: [] });
    expect(schematicInstanceFactsOf(MIXED_SHEET, { refDes: "R10", family: "kicad", missing: "published_exact_revision", reviewPath: UNRESOLVED_REVIEW_PATH.published_exact_revision })).toEqual({ value: "1k", partId: "lib:part-r", atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null });
    expect(schematicInstanceFactsOf(MIXED_SHEET, { refDes: "R9", family: "theory", missing: "theory_symbol_only", reviewPath: UNRESOLVED_REVIEW_PATH.theory_symbol_only })).toEqual({ value: "10k", partId: null, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: "resistor" });
    expect(NO_CATALOG_LOAD).toEqual({ state: "unavailable", reason: `${CATALOG_UNAVAILABLE}: no catalog port is bound to this run` });
  });
});

describe("PR-F fB parts.missing-facts - the catalog port absent or failing: unknown with the reason, NEVER a guess", () => {
  it("no catalog port and no catalog fact: every identity and evidence fact of a KiCad instance is unknown with the source catalog unavailable; the verification says no catalog was read; the footprint hint and the pin count promote nothing", async () => {
    const external = fakeExternal();
    const outcome = await invoke(gatewayWith({ external: external.port }), contextFor({ external: true }), {});
    expect(outcome).toMatchObject({ kind: "read", ok: true, verification: MISSING_FACTS_VERIFICATION });
    const report = reportOf(outcome);
    expect(report.catalog).toMatchObject({ state: "unavailable", partsAsked: 0, partsFailed: 0, reason: expect.stringContaining(CATALOG_UNAVAILABLE) });
    for (const refDes of ["R10", "C1"]) {
      for (const fact of [...factsOf(report, refDes, "identity"), ...factsOf(report, refDes, "evidence")]) {
        if (refDes === "C1" && fact.id === "symbol") continue; // the symbol-asset row names the instance's own revision, not the catalog
        expect(fact.state, `${refDes} ${fact.id}`).toBe("unknown");
        expect(fact.value, `${refDes} ${fact.id}`).toBeNull();
        expect(fact.source, `${refDes} ${fact.id}`).toContain(CATALOG_UNAVAILABLE);
      }
    }
    expect(JSON.stringify(report)).not.toContain("Yageo");
    expect(external.calls).toEqual({ search: [], evidence: [] });
  });

  it("a catalog fact without the port, or the port without the fact: the port is never asked and the facts stay unknown (the fact and the port must agree)", async () => {
    const catalog = fakeCatalog(CATALOG_ANSWERS);
    const withoutPort = reportOf(await invoke(gatewayWith(), contextFor({ catalog: true }), {}));
    expect(withoutPort.catalog.state).toBe("unavailable");
    expect(factsOf(withoutPort, "R10", "identity").every((fact) => fact.state === "unknown")).toBe(true);
    const withoutFact = reportOf(await invoke(gatewayWith({ catalog: catalog.port }), contextFor({ catalog: false }), {}));
    expect(withoutFact.catalog.state).toBe("unavailable");
    expect(catalog.requests).toHaveLength(0);
  });

  it("a failed port answers a closed code, a throwing port is redacted, a hanging port meets the deadline: each is catalog unavailable per instance, the read still answers", async () => {
    const failed = reportOf(await invoke(gatewayWith({ catalog: fakeCatalog({ "lib:part-r": { state: "failed", code: "CATALOG_UNAVAILABLE" }, "lib:part-c": { state: "failed", code: "boom: db-host down" } }).port }), contextFor({ catalog: true }), {}));
    expect(failed.items.find((item) => item.checklist.refDes === "R10")!.catalog.reason).toBe(`${CATALOG_UNAVAILABLE}: CATALOG_READ_FAILED:CATALOG_UNAVAILABLE`);
    expect(failed.items.find((item) => item.checklist.refDes === "C1")!.catalog.reason).toBe(`${CATALOG_UNAVAILABLE}: CATALOG_READ_FAILED:UNKNOWN`);
    expect(failed.catalog).toMatchObject({ state: "bound", partsAsked: 2, partsFailed: 2 });
    const thrown = await invoke(gatewayWith({ catalog: fakeCatalog({ "lib:part-r": "throw", "lib:part-c": "throw" }).port }), contextFor({ catalog: true }), {});
    expect(thrown).toMatchObject({ kind: "read", ok: true });
    expect(JSON.stringify(thrown)).not.toContain("sk-ant-api03");
    expect(JSON.stringify(thrown)).not.toContain("connection refused");
    expect(reportOf(thrown).items.find((item) => item.checklist.refDes === "R10")!.catalog.reason).toBe(`${CATALOG_UNAVAILABLE}: CATALOG_READ_FAILED (details redacted)`);
    const hung = fakeCatalog({ "lib:part-r": "hang", "lib:part-c": "hang" });
    const started = Date.now();
    const late = await invoke(gatewayWith({ catalog: hung.port }), contextFor({ catalog: true }), {}, 700);
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(late).toMatchObject({ kind: "read", ok: true });
    for (const item of reportOf(late).items.filter((entry) => entry.checklist.family === "kicad")) expect(item.catalog.reason).toContain(CATALOG_UNAVAILABLE);
    expect(hung.requests.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PR-F fB parts.missing-facts - denied discovery, the Theory-only sheet, the bound", () => {
  it("a verified schematic: included and offered - without a board, without the catalog fact, and to a viewer (Tier 0); no schematic: project_state_missing and withheld at the run", () => {
    expect(resolveMissingFactsBinding(registry.get(TOOL)!)).toEqual({ state: "resolved" });
    expect(reasonFor(contextFor())).toBe("included");
    expect(offered(contextFor({ board: false }))).toContain(TOOL);
    expect(offered(contextFor({ board: false }))).not.toContain("sirkit.schematic.inspect"); // the B05 canonical-state reads still need the board
    expect(reasonFor(contextFor({ role: "viewer" }))).toBe("included");
    expect(offered(contextFor({ role: "viewer" }))).toContain(TOOL);
    const none = contextFor({ schematic: null });
    expect(reasonFor(none)).toBe("project_state_missing");
    expect(offered(none)).not.toContain(TOOL);
  });

  it("a Theory-only sheet still lists theory_symbol_only: not a physical part, every identity and evidence fact unknown by construction, no catalog asked", async () => {
    const catalog = fakeCatalog(CATALOG_ANSWERS);
    const report = reportOf(await invoke(gatewayWith({ catalog: catalog.port }), contextFor({ schematic: THEORY_SHEET, catalog: true }), {}));
    expect(report.items.map((item) => [item.checklist.refDes, item.checklist.missing, item.checklist.physical, item.catalog.state])).toEqual([["R1", "theory_symbol_only", false, "none"]]);
    expect(report.items[0]!.checklist.headline).toBe(`R1: ${THEORY_NOT_PHYSICAL}`);
    for (const fact of [...factsOf(report, "R1", "identity"), ...factsOf(report, "R1", "evidence")]) expect([fact.state, fact.source]).toEqual(["unknown", THEORY_NOT_PHYSICAL]);
    expect(catalog.requests).toHaveLength(0);
    expect(report.catalog).toMatchObject({ state: "bound", partsAsked: 0 });
  });

  it("a resolved sheet: all_resolved with no items and no refusal (the server stages are Prepare PCB's, not this read's)", async () => {
    const ready: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 0, y: 0, rotation: 0, refDes: "U1", value: "NE555", atomicPartRevisionId: "rev-u1", symbolAssetVersionId: "sym-u1" }] } as unknown as SchematicState;
    const report = reportOf(await invoke(gatewayWith(), contextFor({ schematic: ready }), {}));
    expect(report).toMatchObject({ status: "all_resolved", refusal: null, unresolved: { count: 0, listed: 0, truncated: 0 }, items: [] });
    expect(report.note).toContain("Prepare PCB");
  });

  it("an over-long unresolved list is bounded to 50 checklists and counted, never dropped silently; one catalog read per distinct part id", async () => {
    const many: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: Array.from({ length: MAX_MISSING_FACTS_INSTANCES + 10 }, (_, index) => ({ id: `k${index}`, partId: index % 2 === 0 ? "lib:part-r" : "lib:part-c", x: 0, y: 0, rotation: 0, refDes: `R${index + 1}`, value: "1k" })) } as unknown as SchematicState;
    const catalog = fakeCatalog(CATALOG_ANSWERS);
    const report = reportOf(await invoke(gatewayWith({ catalog: catalog.port }), contextFor({ schematic: many, catalog: true }), {}));
    expect(report.unresolved).toEqual({ count: MAX_MISSING_FACTS_INSTANCES + 10, listed: MAX_MISSING_FACTS_INSTANCES, truncated: 10 });
    expect(report.items).toHaveLength(MAX_MISSING_FACTS_INSTANCES);
    expect(catalog.requests.map((request) => request.partId).sort()).toEqual(["lib:part-c", "lib:part-r"]);
    expect(report.refusal).toContain(`${MAX_MISSING_FACTS_INSTANCES + 10} part(s)`);
  });
});

describe("PR-F fB parts.missing-facts - failures are returned as data; no connector is ever asked", () => {
  it("an argument (even a harmless one) and an authority-shaped argument refuse invalid_input; no schematic refuses authority_unavailable; a cancelled run refuses cancelled - the catalog and the connector untouched", async () => {
    const catalog = fakeCatalog(CATALOG_ANSWERS);
    const external = fakeExternal();
    const gateway = gatewayWith({ catalog: catalog.port, external: external.port });
    const context = contextFor({ catalog: true, external: true });
    expect(await invoke(gateway, context, { verbose: true })).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("takes no arguments")] });
    for (const key of ["partId", "mpn", "live", "bind", "publish", "refDes", "scope"]) {
      expect(await invoke(gateway, context, { [key]: "x" }), key).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("authority-shaped")] });
    }
    expect(await invoke(gateway, contextFor({ schematic: null, catalog: true }), {})).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    const aborted = new AbortController();
    aborted.abort();
    expect(await invoke(gateway, context, {}, 5_000, aborted.signal)).toMatchObject({ kind: "refused", status: "cancelled" });
    expect(catalog.requests).toHaveLength(0);
    expect(external.calls).toEqual({ search: [], evidence: [] });
    expect(schematicStateDigest(context.schematic!)).toBe(schematicStateDigest(MIXED_SHEET));
  });
});
