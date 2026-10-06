/**
 * [B23-D] `manufacturing.assembled-release` stays blocked, pinned by id in a CI-admitted suite (runbook B23-D :1013: "Keep
 * `manufacturing.assembled-release` blocked until the required evidence and qualified human review exist."; D23-15; OD-177).
 *
 * The record is one record, `missing`, Tier 3 and reached by nothing. Its registry note, the release gate's refusal and the message a
 * person sees name both unblock conditions: assembly-data authority (MPN, variant, BOM, placement, paste) and OD-175's physical evidence
 * with qualified human review. The gate refuses `assembled_pcb`, shown here at runtime on a hand-built authority that never starts a
 * router (the generic pin, `manufacturing-release-gate.test.ts:149-150`, runs in no CI workflow and starts Java when FreeRouting
 * resolves). The pinned 555 release identity does not move: the refusal is not inside the archive. The eligibility evaluator answers
 * blocked from the block's side too.
 *
 * Files are read as text; nothing is written and nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listRouteFiles } from "@/app/lib/auth/route-tree";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE, renderActionToolabilityCsv, validateActionCoverageRegistry } from "@/app/lib/engineering/action-registry";
import { classifyControlSites, CONTROL_RULES } from "@/app/lib/engineering/control-registry";
import { scanControlSites } from "@/app/lib/engineering/control-surface";
import { AUTONOMY_MODES, decideAgentExecution, defaultAutonomySetting, permissionTierOfAction } from "@/app/lib/engineering/permission-tiers";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import type { ProjectRole } from "@/app/lib/engineering/types";
import { boundedManufacturingFailure, MANUFACTURING_PUBLIC_ERRORS, redactInternalDetail, setManufacturingTraceSinkForTests } from "@/app/lib/pcb/fab/manufacturing-errors";
import { authoritativeBoardDigest, ManufacturingReleaseGateError, manufacturingComponentAuthorityDigest, releaseManufacturingPackage, type ManufacturingReleaseAuthority } from "@/app/lib/pcb/fab/release-gate";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { collectProductionFiles, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { ASSEMBLED_CLAIM_REQUIRED_KINDS, ASSEMBLED_RELEASE_UNBLOCK_CONDITION, assembledProductEligibility } from "../physical-evidence";
import { completeSet, FAKE_LOT, FAKE_RELEASE, fakeReviewPort } from "./_b23-d-evidence-fixture";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
const ID = "manufacturing.assembled-release";
const REGISTRY = "app/lib/engineering/action-registry.ts";
const GATE = "app/lib/pcb/fab/release-gate.ts";
const ERRORS = "app/lib/pcb/fab/manufacturing-errors.ts";
const CSV = "artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv";
const CODE = "MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE";
const ROLES: readonly ProjectRole[] = ["viewer", "commenter", "pcb_editor", "automation", "reviewer", "project_admin", "migration_admin"];
/** B19-E's purchase wording and its one lifecycle exception, verbatim (case 2 pins both equal to b19-e-no-purchase-tripwire.test.ts). */
const PURCHASE_WORDING = /add to cart|checkout|\bbuy\b|place (an )?order|purchase order|order now|project cart|populate your cart/i;
const LIFECYCLE_TERM = /\blast[- ]time[- ]buy\b/gi;
const hasPurchaseWording = (text: string): boolean => PURCHASE_WORDING.test(text.replace(LIFECYCLE_TERM, ""));
/** Both unblock conditions (OD-177): the assembly-data authority and OD-175's physical evidence with qualified human review. */
const ASSEMBLY_DATA = ["MPN", "variant", "BOM", "placement", "paste"];
const record = () => ACTION_COVERAGE_REGISTRY.find((entry) => entry.id === ID);
/** Every production source (the import gates' whole-root walk, read as text), less any test or spec file. */
let cached: FileMap | null = null;
const productionFiles = (): FileMap => (cached ??= new Map([...collectProductionFiles(ROOT)].filter(([path]) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)).map(([path, source]) => [path, source.replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE)] as const)));
/** The release gate's refusal of `assembled_pcb`, read from its one line. */
function gateRefusal(): { line: number; message: string } {
  const source = lines(GATE);
  const index = source.findIndex((text) => text.includes('source.releaseMode === "assembled_pcb"'));
  const message = /fail\("MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE", "([^"]+)"\);(?: \/\/ .*)?$/.exec(source[index] ?? "")?.[1] ?? "";
  return { line: index + 1, message };
}

/** An authority built by hand that satisfies every check before the assembled refusal; nothing routes, compiles or spawns. */
function handBuiltAuthority(releaseMode: "assembled_pcb" | "bare_pcb"): { authority: ManufacturingReleaseAuthority; locator: Parameters<typeof releaseManufacturingPackage>[0]["locator"] } {
  const board = createEmptyBoard();
  const boardRevision = pcbRevisionId(board);
  const boardDigest = authoritativeBoardDigest(board);
  const facets = { bindingRevision: "binding:b23d", footprintLibraryRevision: "footprints:b23d", mappingRevision: "mapping:b23d", policyRevision: "policy:b23d", assemblyVariantRevision: "variant:b23d" };
  const scope = { tenantId: "tenant-b23d", projectId: "project-b23d", branchId: "main", designId: "design:b23d", boardId: "board:b23d" };
  const authority = {
    schemaVersion: "sirkit.manufacturing-release-authority.v1",
    ...scope,
    boardRevision,
    boardDigest,
    board,
    netlist: { nets: [] },
    schematic: { revision: "schematic:b23d", digest: "sha256:schematic-b23d" },
    rc01: { state: "pass", evidenceId: "rc01:b23d", digest: "parity-b23d", boardRevision },
    rc02: { state: "complete", evidenceId: "rc02:b23d", digest: "route-b23d", boardRevision, routePassIds: ["pass:b23d"], remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0 },
    rc03: { state: "complete", evidenceId: "rc03:b23d", digest: "capability-b23d", boardRevision, boardDigest, declaration: {}, capabilityEvaluation: { phase: "post_layout", status: "eligible", sourceRevision: boardRevision } },
    componentAuthority: { ...facets, digest: manufacturingComponentAuthorityDigest(facets) },
    fabPreset: {},
    drcPreset: {},
    manufacturingRuleProfile: { schemaVersion: "sirkit.manufacturing-rule-profile.v1" },
    releaseMode,
    sourceDate: "2026-10-05T00:00:00.000Z",
    actor: "user:b23d-admin",
  } as unknown as ManufacturingReleaseAuthority;
  return { authority, locator: { ...scope, expectedBoardRevision: boardRevision, expectedBoardDigest: boardDigest } };
}

afterEach(() => setManufacturingTraceSinkForTests(null));

describe("[B23-D] manufacturing.assembled-release stays blocked, by id (D23-15; OD-177)", () => {
  it("1. the record by id: one record, missing, explicitly blocked, no domain command, no tool exposure, approval tier release, Tier 3 (decision never for every role, mode and request); it keeps line :118 and its one B01 CSV row at :47, rendered by the generator", () => {
    expect(ACTION_COVERAGE_REGISTRY.filter((entry) => entry.id === ID)).toHaveLength(1);
    const entry = record()!;
    expect(entry).toMatchObject({ id: ID, version: 1, area: "manufacturing", action: "Release assembled product", kind: "destructive", status: "missing", sources: [GATE], handler: "explicitly blocked", domainCommand: null, mutationAuthority: "none", validation: "fail closed", historyOrRevision: "none", toolExposure: "none", approvalTier: "release" });
    expect(entry.sideEffects).toBeUndefined();
    expect(validateActionCoverageRegistry()).toEqual([]);
    expect(permissionTierOfAction(entry)).toBe(3);
    for (const actorRole of ROLES) {
      for (const mode of [null, ...AUTONOMY_MODES]) {
        const setting = mode === null ? null : { ...defaultAutonomySetting({ tenantId: "tenant-b23d", projectId: "project-b23d" }), mode };
        for (const explicitUserRequest of [true, false]) expect(decideAgentExecution({ tier: permissionTierOfAction(entry), setting, actorRole, explicitUserRequest }).decision, `${actorRole} ${mode} ${explicitUserRequest}`).toBe("never");
      }
    }
    const source = lines(REGISTRY);
    expect(source[117]).toContain(`action({ id: "${ID}"`);
    expect(source.filter((text) => text.includes(`id: "${ID}"`))).toHaveLength(1);
    const csv = read(CSV);
    expect(csv).toBe(renderActionToolabilityCsv());
    const rows = csv.split(NEWLINE);
    expect(rows.filter((row) => row.startsWith(`${ID},`))).toHaveLength(1);
    expect(rows[46]!.startsWith(`${ID},1,manufacturing,Release assembled product,destructive,missing,explicitly blocked,,none,fail closed,none,none,release,${GATE},`)).toBe(true);
  });

  it("2. the registry note, the gate's refusal and the message a person sees each name both conditions - the assembly-data authority and OD-175's physical evidence with qualified human review - and none is purchase wording", () => {
    const note = record()!.notes ?? "";
    for (const words of [...ASSEMBLY_DATA, "population variant", "OD-175", "physical evidence", "qualified human review", "LB-5"]) expect(note, words).toContain(words);
    expect(note.startsWith("[B17-A] still missing: no route, no control.")).toBe(true);
    const { line, message } = gateRefusal();
    expect(line).toBe(189);
    for (const words of [...ASSEMBLY_DATA, "OD-175", "physical evidence", "qualified human review"]) expect(message, words).toContain(words);
    expect(message.startsWith("Assembled release is blocked until ")).toBe(true);
    const shown = MANUFACTURING_PUBLIC_ERRORS[CODE];
    expect(shown.status).toBe(422);
    expect(shown.message.startsWith("Assembled release is not available. ")).toBe(true);
    for (const words of [...ASSEMBLY_DATA, "population variant", "physical evidence", "qualified person"]) expect(shown.message, words).toContain(words);
    expect(shown.message).not.toMatch(/OD-|LB-|\{|\}|stack trace|Error:/); // a person reads plain words, no internal ids
    expect(lines(ERRORS)[61]).toContain(`${CODE}: { status: 422, message: "${shown.message}" }`);
    for (const text of [note, message, shown.message, ASSEMBLED_RELEASE_UNBLOCK_CONDITION]) expect(hasPurchaseWording(text), text).toBe(false);
    const tripwire = read("app/lib/engineering/__tests__/b19-e-no-purchase-tripwire.test.ts");
    expect(tripwire).toContain(`const PURCHASE_WORDING = ${PURCHASE_WORDING.toString()};`);
    expect(tripwire).toContain(`const LIFECYCLE_TERM = ${LIFECYCLE_TERM.toString()};`);
  });

  it("3. unreachable (B17-A :63): no control, control rule, route coverage row, route file or tool names it; nothing produces assembled_pcb - production spells it only in the release-mode type and the gate's refusal, and qualification seals bare_pcb", () => {
    const { classified } = classifyControlSites(scanControlSites(ROOT));
    expect(classified.length).toBeGreaterThan(400);
    expect(classified.filter((row) => row.recordIds.includes(ID))).toEqual([]);
    expect(CONTROL_RULES.filter((rule) => (rule.recordIds ?? []).includes(ID))).toEqual([]);
    expect(API_ROUTE_COVERAGE.filter((entry) => entry.recordId === ID)).toEqual([]);
    const routes = listRouteFiles(ROOT).map((file) => relative(ROOT, file).split(sep).join("/"));
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.filter((file) => /assembled-release|assembled_pcb/.test(read(file)))).toEqual([]);
    expect(sirkitToolRegistry().list().filter((descriptor) => /assembled/i.test(descriptor.toolId))).toEqual([]);
    const recordId = ["$", "{record.id}"].join("");
    expect(read("app/lib/engineering/__tests__/b17-a-control-inventory.test.ts")).toContain(`if (record.status === "missing") expect(reached.has(record.id) || routed.has(record.id), \`${recordId} is 'missing' yet reachable\`).toBe(false);`);
    const spelled: string[] = [];
    for (const [path, text] of productionFiles()) text.split(NEWLINE).forEach((line, index) => { if (line.includes("assembled_pcb")) spelled.push(`${path}:${index + 1}`); });
    expect(spelled.sort()).toEqual(["app/lib/pcb/fab/release-gate.ts:189", "app/lib/pcb/fab/release-manifest.ts:4"]);
    expect(lines("app/lib/pcb/fab/release-manifest.ts")[3]).toBe('export type ManufacturingReleaseMode = "bare_pcb" | "assembled_pcb";');
    expect(lines("app/api/pcb/qualify/route.ts")[283]).toContain('releaseMode: "bare_pcb"');
  }, 30_000);

  it("4. the gate refuses assembled_pcb at runtime, before anything is generated, on an authority that passes every earlier check (no router, no process); its bare twin passes that line; a person sees the table's words and the gate's wording reaches only the redacted trace, both conditions intact", async () => {
    const assembled = handBuiltAuthority("assembled_pcb");
    let refusal: unknown = null;
    try {
      await releaseManufacturingPackage({ locator: assembled.locator, loadAuthority: async () => assembled.authority });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ManufacturingReleaseGateError);
    expect(refusal).toMatchObject({ code: CODE, message: gateRefusal().message });
    const bare = handBuiltAuthority("bare_pcb");
    await expect(releaseManufacturingPackage({ locator: bare.locator, loadAuthority: async () => bare.authority })).rejects.toMatchObject({ code: "MFG_RULE_PROFILE_SCHEMA_RETIRED" });
    const traces: Array<{ code: string; detail: string }> = [];
    setManufacturingTraceSinkForTests((entry) => { traces.push({ code: entry.code, detail: entry.detail }); });
    const response = boundedManufacturingFailure(refusal, "release", "corr-b23d");
    expect(response.status).toBe(422);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ ok: false, code: CODE, error: MANUFACTURING_PUBLIC_ERRORS[CODE].message, correlationId: "corr-b23d" });
    expect(JSON.stringify(body)).not.toContain("OD-175");
    expect(traces).toHaveLength(1);
    expect(traces[0]).toEqual({ code: CODE, detail: redactInternalDetail(refusal) });
    expect(traces[0]!.detail.endsWith("qualified human review.")).toBe(true); // within the trace's 200-character bound
    for (const words of ["MPN", "paste", "physical evidence"]) expect(traces[0]!.detail, words).toContain(words);
  });

  it("5. the release identity does not move: the pinned 555 identity is unchanged, the README sentence inside the archive is unchanged, and the refusal's words occur in production only at the gate's line and the error table's line - outside every archive input", () => {
    const identities = JSON.parse(read("app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json")) as { release: { releaseId: string; archiveSha256: string; archiveByteLength: number } };
    expect(identities.release).toMatchObject({ releaseId: "mfg-release-45b3b7efbc85dc3a8ecd233c906384cd", archiveSha256: "997664c0b9a87c4d3a65e64eeb90b98159b2ad6ad8806e4ebea748a592ac6dcc", archiveByteLength: 41855 });
    expect(lines(GATE)[271]).toContain('"No manufacturer upload/order has been performed. External board-house DFM and physical prototype review remain mandatory.",');
    const gateMessage = gateRefusal().message;
    const shown = MANUFACTURING_PUBLIC_ERRORS[CODE].message;
    const holders: string[] = [];
    for (const [path, text] of productionFiles()) text.split(NEWLINE).forEach((line, index) => { if (line.includes(gateMessage) || line.includes(shown)) holders.push(`${path}:${index + 1}`); });
    expect(holders.sort()).toEqual([`${ERRORS}:62`, `${GATE}:189`]);
  }, 30_000);

  it("6. from the block's side, the eligibility evaluator answers blocked for every input today: the missing kinds with no review port wired, and the absent assembly-data authority even when every kind is satisfied", () => {
    const today = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: completeSet() });
    expect(today).toMatchObject({ eligible: false, status: "blocked", missing: [...ASSEMBLED_CLAIM_REQUIRED_KINDS], unblockCondition: ASSEMBLED_RELEASE_UNBLOCK_CONDITION });
    expect(today.reasons).toEqual(["assembly_data_authority_absent", "review_port_not_wired", "physical_evidence_missing"]);
    const satisfied = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: completeSet(), reviewPort: fakeReviewPort() });
    expect(satisfied).toMatchObject({ eligible: false, status: "blocked", reasons: ["assembly_data_authority_absent"], missing: [] });
  });
});
