/**
 * [PR-J5, 2026-10-23] Runbook section J increment 5 (J.6 items 1, 4, 6, 8; OD-259 item 4): the sealed organise proposal artifact
 * `sirkit.sheet-organization-proposal.v1` (app/lib/engineering/sheet-organization-proposal.ts), pure over the fixture drone.
 *
 *  1. compile: the fixture drone's default groups resolve to stable ids, every part is assigned, the interfaces are the planner's
 *     ports (PWM1-4, I2C_SCL, I2C_SDA, IMU_INT1), the equivalence names the flat drone's partition digest, "check these" is empty when
 *     the groups ARE the planner's; a hand grouping that moves a pull-up to the MCU is listed under "check these";
 *  2. refusals by name: an unknown member, a member in two groups, a Theory component, 9 groups, 513 members, a bad interface name;
 *  3. seal / verify round trip: the closed key set, the identity digest; an extra key, a wrong schema, an altered group, an altered
 *     operations digest each refuse; the artifact is bounded;
 *  4. currency: foreign scope, moved head, expiry, moved base refuse; the base digest includes the sheet set (the J3 fixture's base
 *     differs from the flat drone's);
 *  5. replan: the sealed groups re-planned on the same base reproduce the operations digest and the partition digest; a moved base is
 *     stale-base; a changed group is operations-differ; applying the re-planned operations through the executor's own code yields the
 *     planner's `after`.
 * No network, no database, no randomness.
 */
import { describe, expect, it } from "vitest";
import { applySchematicOperationsToCanonical } from "../operations";
import { buildAuthorizationBinding } from "../proposal-authorization";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "../schematic-model";
import { compileSheetOrganizationProposal, replanSheetOrganization, sealSheetOrganizationProposal, sheetOrganizationGroupInputs, SHEET_ORGANIZATION_LIMITS, SHEET_ORGANIZATION_PROPOSAL_SCHEMA, SHEET_ORGANIZATION_PROPOSAL_TTL_MS, SHEET_ORGANIZATION_TOOL_ID, verifySealedSheetOrganizationProposal, verifySealedSheetOrganizationProposalIntegrity, type SealedSheetOrganizationProposal } from "../sheet-organization-proposal";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { planOrganizeIntoSheets, proposeSheetGroups } from "@/app/lib/schematic/sheet-organization";
import { droneFixtureState, fixturePartLookup, fixtureParts } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import { FIXTURE_DRONE_ORGANIZE_GROUPS } from "@/app/lib/agent/fixture-agent-adapter";

const parts = fixtureParts();
const getPart = (partId: string) => parts.get(partId) ?? null;
const T0 = Date.parse("2026-10-23T09:00:00.000Z");
const SCOPE = { tenantId: "local", projectId: "proj-j5", branchId: "main", headMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" } };
const AUTH = buildAuthorizationBinding({ principalId: "u1", membershipRevision: "mbr1-j5", scope: SCOPE });
const DRONE_GOLDEN_DIGEST = "eng1-66f025a6dde8f8c3"; // j1-sheet-operations GOLDEN.drone.stateDigest
const request = () => ({ groups: FIXTURE_DRONE_ORGANIZE_GROUPS.map((group) => ({ name: group.name, members: [...group.members] })) });

function sealed(state = droneFixtureState(), req = request()): SealedSheetOrganizationProposal {
  const compiled = compileSheetOrganizationProposal({ state, request: req, getPart });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.blockers));
  const outcome = sealSheetOrganizationProposal({ state, compilation: compiled.compilation, scope: SCOPE, authorization: AUTH, version: "1.0.0", provenance: { provider: "anthropic", runId: "run-j5", note: "test", instruction: "organise" }, now: T0 });
  if (outcome.kind !== "sealed") throw new Error(JSON.stringify(outcome.blockers));
  return outcome.proposal;
}

describe("[PR-J5] 1. compile over the fixture drone", () => {
  it("resolves the default groups to stable ids, assigns every part, names the planner's ports and the flat partition; check-these is empty", () => {
    const state = droneFixtureState();
    const compiled = compileSheetOrganizationProposal({ state, request: request(), getPart });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.blockers));
    const c = compiled.compilation;
    expect(c.groups.map((group) => group.name)).toEqual(FIXTURE_DRONE_ORGANIZE_GROUPS.map((group) => group.name));
    expect(c.groups.flatMap((group) => group.members.map((member) => member.refDes)).sort()).toEqual(state.kicadComponents!.map((item) => item.refDes).sort());
    for (const group of c.groups) for (const member of group.members) expect(state.kicadComponents!.find((item) => item.id === member.componentId)?.refDes).toBe(member.refDes);
    expect(c.unassigned).toEqual([]);
    expect([...new Set(c.interfaces.map((item) => item.portName))].sort()).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1", "PWM1", "PWM2", "PWM3", "PWM4"]);
    expect(c.interfaces.every((item) => item.net === item.portName && item.defaultName === null && item.direction === "passive" && item.parentSheetId === "root" && item.hierarchicalLabels >= 1)).toBe(true);
    expect(c.equivalence.partitionDigest).toBe(resolveProjectConnectivity(state, fixturePartLookup()).partitionDigest);
    expect(c.equivalence.componentCount).toBe(41);
    expect(c.checkThese).toEqual([]);
    expect(c.checkNote).toBeNull();
    expect(c.operations.length).toBeGreaterThan(41);
    // the planner's default IS the adapter's script: the two agree (the j5-organize-proposal-tool suite drives the script end to end)
    const own = proposeSheetGroups(state, getPart);
    if (!own.ok) throw new Error(own.message);
    expect(own.groups.map((group) => ({ name: group.name, members: [...group.refs] }))).toEqual(FIXTURE_DRONE_ORGANIZE_GROUPS.map((group) => ({ name: group.name, members: [...group.members] })));
  });

  it("a hand grouping that moves the IMU's pull-up R11 to the MCU is planned (equivalent) and R11 is listed under check-these; the rest stays unassigned on the overview", () => {
    const compiled = compileSheetOrganizationProposal({ state: droneFixtureState(), request: { groups: [{ name: "MCU", members: ["U2", "C7", "R11"] }, { name: "IMU", members: ["U3", "R12"] }] }, getPart });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.blockers));
    expect(compiled.compilation.unassigned).toHaveLength(41 - 5);
    expect(compiled.compilation.checkThese.map((check) => [check.refs, check.group, check.alternatives])).toEqual([[["R11"], "MCU", ["IMU"]]]);
    expect(compiled.compilation.checkThese[0]!.reason).toContain("U3");
  });
});

describe("[PR-J5] 2. refusals name the member and change nothing", () => {
  const state = droneFixtureState();
  const digest = schematicStateDigest(state);
  const refusal = (req: Parameters<typeof compileSheetOrganizationProposal>[0]["request"]) => {
    const compiled = compileSheetOrganizationProposal({ state, request: req, getPart });
    expect(compiled.ok).toBe(false);
    expect(schematicStateDigest(state)).toBe(digest);
    return compiled.ok ? null : compiled.blockers[0]!;
  };
  it("unknown, duplicate, Theory, too many groups, too many members, a bad interface name", () => {
    expect(refusal({ groups: [{ name: "A", members: ["R99"] }] })).toMatchObject({ code: "unknown-member", refs: ["R99"] });
    expect(refusal({ groups: [{ name: "A", members: ["R1"] }, { name: "B", members: ["r1"] }] })).toMatchObject({ code: "duplicate-member", refs: ["R1"] });
    expect(refusal({ groups: [{ name: "A", members: ["R1"] }, { name: "A", members: ["R2"] }] })).toMatchObject({ code: "plan-refused" });
    const withTheory = { ...state, components: [{ id: "V1", type: "voltage-source" as const, x: 10, y: 10, rotation: 0 as const, value: "5" }] };
    const theory = compileSheetOrganizationProposal({ state: withTheory, request: { groups: [{ name: "A", members: ["V1"] }] }, getPart });
    expect(theory.ok ? null : theory.blockers[0]).toMatchObject({ code: "theory-component-unsupported", refs: ["V1"] });
    expect(refusal({ groups: Array.from({ length: 9 }, (_, index) => ({ name: `G${index}`, members: [`R${index + 1}`] })) })).toMatchObject({ code: "too-many-groups" });
    expect(refusal({ groups: [{ name: "A", members: Array.from({ length: 513 }, (_, index) => `R${index}`) }] })).toMatchObject({ code: "too-many-members" });
    expect(refusal({ ...request(), interfaceNames: { SIG1: "x y" } })).toMatchObject({ code: "interface-names-invalid" });
    expect(refusal({ ...request(), interfaceNames: { SIG1: "LINK" } })).toMatchObject({ code: "plan-refused" }); // the drone mints no SIG port: every crossing is a labelled net
    expect(refusal({ groups: [] })).toMatchObject({ code: "empty-request" });
  });
});

describe("[PR-J5] 3. seal and verify", () => {
  it("round trip: the closed key set, the identity, the bound; an extra key, a wrong schema, an altered group or digest refuse", () => {
    const proposal = sealed();
    expect(proposal.schema).toBe(SHEET_ORGANIZATION_PROPOSAL_SCHEMA);
    expect(proposal.toolId).toBe(SHEET_ORGANIZATION_TOOL_ID);
    expect(proposal.proposalId).toMatch(/^shorg-[0-9a-f]{16}$/);
    expect(Object.keys(proposal).sort()).toEqual(["authorization", "baseSchematicDigest", "checkNote", "checkThese", "createdAt", "equivalence", "expiresAt", "groups", "interfaceNames", "interfaces", "operationCount", "operationsDigest", "proposalId", "provenance", "renamedNets", "rootName", "schema", "scope", "sourceSheetId", "toolId", "unassigned", "version"]);
    expect(proposal.expiresAt - proposal.createdAt).toBe(SHEET_ORGANIZATION_PROPOSAL_TTL_MS);
    expect(proposal.baseSchematicDigest).toBe(DRONE_GOLDEN_DIGEST);
    expect(JSON.stringify(proposal).length).toBeLessThanOrEqual(SHEET_ORGANIZATION_LIMITS.maxArtifactChars);
    expect(Object.isFrozen(proposal.groups)).toBe(true);
    expect(verifySealedSheetOrganizationProposalIntegrity(JSON.parse(JSON.stringify(proposal)))).toEqual({ ok: true });
    expect(verifySealedSheetOrganizationProposalIntegrity({ ...proposal, extra: 1 })).toMatchObject({ ok: false, code: "malformed" });
    expect(verifySealedSheetOrganizationProposalIntegrity({ ...proposal, schema: "sirkit.sheet-organization-proposal.v0" })).toMatchObject({ ok: false, code: "wrong-version" });
    const alteredGroups = structuredClone(proposal) as SealedSheetOrganizationProposal;
    alteredGroups.groups[0]!.members.pop();
    expect(verifySealedSheetOrganizationProposalIntegrity(alteredGroups)).toMatchObject({ ok: false, code: "altered" });
    expect(verifySealedSheetOrganizationProposalIntegrity({ ...proposal, operationsDigest: "eng1-0000000000000000" })).toMatchObject({ ok: false, code: "altered" });
    expect(verifySealedSheetOrganizationProposalIntegrity({ ...proposal, expiresAt: proposal.expiresAt + 1 })).toMatchObject({ ok: false, code: "malformed" });
    expect(verifySealedSheetOrganizationProposalIntegrity("no")).toMatchObject({ ok: false, code: "malformed" });
  });

  it("4. currency: foreign scope, moved head, expiry and a moved base refuse; the base digest includes the sheet set", () => {
    const proposal = sealed();
    const current = { currentSchematicDigest: proposal.baseSchematicDigest, now: T0 + 1_000, expectedScope: SCOPE };
    expect(verifySealedSheetOrganizationProposal(proposal, current)).toEqual({ ok: true });
    expect(verifySealedSheetOrganizationProposal(proposal, { ...current, expectedScope: { ...SCOPE, projectId: "proj-other" } })).toMatchObject({ ok: false, code: "foreign-scope" });
    expect(verifySealedSheetOrganizationProposal(proposal, { ...current, expectedScope: { ...SCOPE, headMark: { ...SCOPE.headMark, lineageId: "lin1-ffffffffffffffff" } } })).toMatchObject({ ok: false, code: "foreign-scope" });
    expect(verifySealedSheetOrganizationProposal(proposal, { ...current, expectedScope: { ...SCOPE, headMark: { ...SCOPE.headMark, headSequence: 4 } } })).toMatchObject({ ok: false, code: "stale-head" });
    expect(verifySealedSheetOrganizationProposal(proposal, { ...current, now: proposal.expiresAt + 1 })).toMatchObject({ ok: false, code: "expired" });
    expect(verifySealedSheetOrganizationProposal(proposal, { ...current, currentSchematicDigest: "eng1-1111111111111111" })).toMatchObject({ ok: false, code: "stale-base" });
    // a multi-sheet base: the J3 fixture's overview holds the MCU block; grouping it seals against a base digest that carries the sheets
    const sheeted = multiSheetDroneFixtureState();
    const compiled = compileSheetOrganizationProposal({ state: sheeted, request: { groups: [{ name: "Flight controller MCU", members: ["U2", "C4", "C5", "C6", "C7", "C8", "R9", "R10", "J6", "J7", "D5"] }] }, getPart });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.blockers));
    const outcome = sealSheetOrganizationProposal({ state: sheeted, compilation: compiled.compilation, scope: SCOPE, authorization: AUTH, version: "1.0.0", provenance: { provider: "anthropic", runId: "run-j5", note: "t", instruction: "o" }, now: T0 });
    if (outcome.kind !== "sealed") throw new Error(JSON.stringify(outcome.blockers));
    expect(outcome.proposal.baseSchematicDigest).toBe(schematicStateDigest(sheeted));
    expect(outcome.proposal.baseSchematicDigest).not.toBe(DRONE_GOLDEN_DIGEST);
    expect(outcome.proposal.interfaces.map((item) => item.portName).sort()).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1", "PWM1", "PWM2", "PWM3", "PWM4"]);
  });
});

describe("[PR-J5] 5. the page's Approve re-plan is one truth with the seal", () => {
  it("re-planning the sealed groups reproduces the operations and partition digests; the executor's batch yields the planner's after; a moved base or changed group refuses", () => {
    const state = droneFixtureState();
    const proposal = sealed(state);
    const replan = replanSheetOrganization(proposal, state, getPart);
    if (!replan.ok) throw new Error(replan.detail);
    expect(replan.operations).toHaveLength(proposal.operationCount);
    const applied = fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(state), replan.operations).schematic);
    expect(schematicStateDigest(applied)).toBe(schematicStateDigest(replan.after));
    const direct = planOrganizeIntoSheets(state, sheetOrganizationGroupInputs(proposal.groups), getPart, { operationIdPrefix: "organize-proposal" });
    if (!direct.ok) throw new Error(direct.message);
    expect(JSON.stringify(direct.operations)).toBe(JSON.stringify(replan.operations));
    expect(resolveProjectConnectivity(applied, fixturePartLookup()).partitionDigest).toBe(proposal.equivalence.partitionDigest);
    expect(replanSheetOrganization(proposal, applied, getPart)).toMatchObject({ ok: false, code: "stale-base" });
    const changed = structuredClone(proposal) as SealedSheetOrganizationProposal;
    changed.groups[3]!.members = changed.groups[3]!.members.filter((member) => member.refDes !== "R12");
    changed.groups[2]!.members.push({ componentId: state.kicadComponents!.find((item) => item.refDes === "R12")!.id, refDes: "R12" });
    expect(replanSheetOrganization(changed, state, getPart)).toMatchObject({ ok: false, code: "operations-differ" });
  });
});
