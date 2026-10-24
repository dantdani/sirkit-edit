/**
 * [PR-J5, 2026-10-23] Runbook J.6.1-J.6.3 (OD-255 item 9; OD-259 items 1-3, 5): SOURCE PINS of app/page.tsx's intake of a planned
 * generation result as SHEETS and of the assistant's organise proposal, plus the pure helpers the page calls. What it pins:
 *
 *  1. the page keeps its 9156 lines (every J5-B edit was in place) and is LF;
 *  2. the result intake: the pinned flat layout literal stays (OD-259 item 5) and the sheeted layout runs AFTER it, seeded by the task's
 *     result digest; the proposal state and the drawing validation follow the sheeted layout when there is one; the sheet set's notes are
 *     pushed before the pinned run.note line; the task follow passes `sheets` from the fetched result; the one offer is unchanged;
 *  3. the composer: the refusal at the Build start is replaced by an advisory activity step (OD-259 item 2) before the task start; the
 *     flat-result refusal stays at the offer (with WHY the result is one page) and at the final apply; edit and Tidy stay as they were;
 *  4. the organise receiver: ONE `sheet_organization_ready` case on an existing line that receives through the SAFE receiver exactly
 *     once, checks currency against the live editor and only sets the pending card - never applies; Approve goes through the Sheets
 *     controller's `applyOrganizeProposal` with the tool's own re-plan on the canonical base (the page never plans itself); Discard
 *     records nothing; the card is rendered once; a project switch drops the pending proposal;
 *  5. the pure helpers: the advisory, the refusal with findings, the sheet-set notes; the B17 inventory classifies the card's controls.
 * Files are read as text; pure functions on the committed fixtures; no DOM, no network.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import { droneFixtureState } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { generatedSheetsProposalNotes, describeGeneratedSheetLayout } from "../generation-proposal-events";
import { flatReplacementRefusal, flatReplacementRefusalWithFindings, multiSheetReplaceAdvisory, multiSheetReplaceRefusal } from "../sheet-replace-guard";

const page = readFileSync("app/page.tsx", "utf8");
const inventory = readFileSync("artifacts/ai-control-plane-b17/ui-control-inventory.csv", "utf8");
const count = (text: string, needle: string): number => text.split(needle).length - 1;
const between = (from: string, to: string): string => {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`${from.trim().slice(0, 60)} is not where the suite expects it`);
  return page.slice(start, end);
};
const at = (literal: string): number => { const index = page.indexOf(literal); expect(index, literal).toBeGreaterThan(0); expect(page.indexOf(literal, index + 1), `${literal.slice(0, 80)} once`).toBe(-1); return index; };
const PAGE_LINES = 9156;
const composer = between("  async function handleGenerateSchematic(", "  async function offerBuildResult(");
const intake = between("  async function offerBuildResult(", "  // ─── [PR-L, 2026-10-17] the project's durable generation task");
const taskFollow = between("  function attachGenerationTask(", "  /** The sheet moved since the task's base");
// the organise case shares the existing line of the execution-grant case (OD-259 item 5): it ends where that case starts on the same line
// the organise case shares an existing line (OD-259 item 5): the line that closes the component resolution's case, so every case that
// starts a line keeps its place (the PR-G / B21 case-order pins read line-initial cases)
const organiseCase = between('          } case "sheet_organization_ready": {', '\n          case "execution_grant_ready": {');

describe("[PR-J5] 1. app/page.tsx keeps its line count and is LF", () => {
  it("9156 lines, no CR, a trailing newline", () => {
    expect(page.includes("\r")).toBe(false);
    expect(page.split("\n").length - 1).toBe(PAGE_LINES);
    expect(page.endsWith("\n")).toBe(true);
  });
});

describe("[PR-J5] 2. the result intake lays a planned result out as sheets after the flat layout", () => {
  it("the pinned flat literal stays and the sheeted layout follows it, seeded by the task's result digest; state and validation follow the sheets", () => {
    const flat = at("      const built = autoLayoutBuildValidated(netlist, parts);");
    const sheeted = at("const laid = data.sheets?.sheets ? layoutGeneratedSheets(netlist, data.sheets.sheets, parts, { seed: run.task?.resultDigest ?? run.pin.baseDigest }) : null;");
    expect(sheeted).toBeGreaterThan(flat);
    expect(sheeted - flat).toBeLessThan(400); // the very next statement
    expect(intake).toContain('const state = laid?.kind === "sheets" ? laid.state : built.state; const validation = laid?.kind === "sheets" ? laid.validation : built.validation;');
    expect(intake).toContain("if (!validation.ok) {");
    expect(intake).toContain("const v = validation.violations;");
    expect(count(intake, "built.validation")).toBe(1); // the flat validation is read only through `validation` (its one selection above)
    expect(count(intake, "layoutGeneratedSheets(")).toBe(1);
    expect(count(page, "layoutGeneratedSheets(")).toBe(1);
    expect(intake).toContain("omittedBlocks: string[]; electricalCheck: ElectricalCheckStatus; sheets?: GeneratedSheets }, run: {");
  });

  it("the sheet set's notes travel with the proposal before the pinned run.note line, as steps of the entry; the task follow passes the fetched sheets; the one offer is unchanged", () => {
    expect(intake).toContain('for (const line of generatedSheetsProposalNotes(data.sheets, laid)) { proposalNotes.push(line); appendActivityStep(logId, line, "done"); } if (run.note) proposalNotes.push(run.note);');
    expect(count(intake, "if (run.note) proposalNotes.push(run.note);")).toBe(1);
    expect(taskFollow).toContain("electricalCheck: fetched.result.electricalCheck as ElectricalCheckStatus, sheets: fetched.result.sheets }, { logId: entry.logId,");
    expect(count(intake, "setPendingReplace({ state, explanation, prompt, logId, promptAlreadyLogged: true, pin, validationNote })")).toBe(1);
    expect(intake).not.toMatch(/applySchematic\(|setPendingTier1\(|setPendingReplacement\(|setPendingPcbProposal\(|setPendingOrganization\(|<Dialog/);
    expect(page).toContain('import { layoutGeneratedSheets, type GeneratedSheets } from "@/lib/build-sheet-layout";');
    expect(page).toContain('data-testid="schematic-proposal-replaced-sheets"');
    expect(count(page, "replacedSheetsLine(authoritativeSchematic)")).toBe(2); // the condition and the line, in the one dialog
    // the dialog stays inside a 1366 x 768 viewport with a generated multi-sheet design's lines (the browser run of the drone found
    // Approve below the fold before): the summary list and the notes are bounded, scrollable regions; no stray text node inside the list
    expect(page).toContain('<ul className="max-h-[35vh] list-disc space-y-1 overflow-y-auto pl-5 text-sm text-zinc-400" data-testid="schematic-proposal-summary">{/*');
    expect(page).toContain('<p className="max-h-24 overflow-auto text-xs text-amber-300" data-testid="schematic-proposal-validation">');
    expect(page).toContain('<p className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-zinc-500">{pendingReplace.explanation}</p>');
    expect(page).not.toContain("</li>} {/* [PR-J5");
  });
});

describe("[PR-J5] 3. the Build start advises; a flat result stays refused at the offer (with why) and at the final apply", () => {
  it("the composer's start carries the advisory step, before any task start, and no refusal", () => {
    const advisory = at("const sheetAdvisory = multiSheetReplaceAdvisory(gestureCoordinatorRef.current!.authoritativeState());");
    const step = at('const logId = startActivityLog("Generating schematic", "Preparing request", prompt); if (sheetAdvisory !== null) appendActivityStep(logId, sheetAdvisory, "done");');
    expect(advisory).toBeLessThan(step);
    expect(step).toBeLessThan(at("const started = await startGenerationTask({ scope, clientRequestId: newGenerationClientRequestId(), prompt, provider: aiBrainRef.current,"));
    expect(composer).not.toContain("multiSheetReplaceRefusal(");
    expect(composer).not.toContain("sheetRefusal");
    expect(count(page, "multiSheetReplaceAdvisory(")).toBe(1);
    // edit stays refused before its request; the result-less refusal is now the edit path's alone
    expect(count(page, "multiSheetReplaceRefusal(")).toBe(1);
    expect(page).toContain("const editRefusal = multiSheetReplaceRefusal(snapshot); if (editRefusal !== null) { setScopedGenError(scope, editRefusal, 12000); return; }");
  });

  it("the offer refuses a flat result over a multi-sheet base and says why it is one page; the final apply guard is unchanged", () => {
    expect(count(page, "flatReplacementRefusal(")).toBe(2);
    expect(intake).toContain("const flatRefusal = flatReplacementRefusal(gestureCoordinatorRef.current!.authoritativeState(), state); if (resultIssues.length > 0 || flatRefusal !== null) {");
    expect(intake).toContain("setScopedGenError(scope, flatRefusal !== null ? flatReplacementRefusalWithFindings(flatRefusal, input.proposalNotes) : `The generated schematic failed validation (${resultIssues[0]}). Nothing was changed.`, flatRefusal !== null ? 12000 : undefined);");
    expect(page).toContain("const flatRefusal = flatReplacementRefusal(gestureCoordinator.authoritativeState(), appliedState); if (flatRefusal !== null) { showToast(flatRefusal); return false; }");
    // the applied state keeps the result's sheet tree (J3's carriage), so a sheeted result replaces as ONE lifecycle adoption
    expect(page).toContain("...(state.sheets !== undefined ? { sheets: state.sheets } : {}), // [PR-J3, 2026-10-22] a sheet-aware result (J5-2) keeps its tree");
  });
});

describe("[PR-J5] 4. the organise receiver and its Approve", () => {
  it("ONE case on an existing line: the SAFE receiver once, the currency check, the pending card - never an apply", () => {
    expect(count(page, 'case "sheet_organization_ready": {')).toBe(1);
    expect(count(organiseCase, "receiveSheetOrganizationEvent(event)")).toBe(1);
    expect(organiseCase).toContain("sheetOrganizationCurrency(organise.proposal, liveSheetForSealedArtifacts())");
    expect(organiseCase).toContain("setPendingOrganization({ received: organise, logId });");
    expect(organiseCase).toContain("appendActivityStep(logId, sheetOrganizationLines.dropped(), \"error\"); return;");
    expect(organiseCase).not.toMatch(/applySchematic\(|setPendingReplace\(|runSchematicCommand\(|applyOrganize|planOrganizeIntoSheets|replanSheetOrganization\(/);
    expect(organiseCase.split("\n").length).toBe(1); // one existing line (OD-259 item 5)
    expect(page).toContain(`            appendActivityStep(logId, resolutionLines.awaitingReview(resolution.proposal), "done");\n            return;\n          } case "sheet_organization_ready": {`);
    expect([...page.matchAll(/^\s*case "sheet_organization_ready":/gm)]).toHaveLength(0); // never line-initial: the case-order pins stay byte-identical
  });

  it("Approve re-checks currency and applies through the Sheets controller's one transaction with the tool's re-plan; Discard records nothing; the card renders once; a project switch drops it", () => {
    expect(count(page, "sheetLens.controller.applyOrganizeProposal({")).toBe(1);
    expect(page).toContain("replan: (canonical) => { const again = replanSheetOrganization(proposal, sheetOrganizationReplanBase(fromCanonicalSchematic(canonical), liveStateRef.current.pageSize), getCachedPart); return again.ok ? { ok: true, operations: again.operations } : { ok: false, detail: again.detail }; }");
    expect(page).toContain("expectedBaseDigest: schematicStateDigest(gestureCoordinatorRef.current!.authoritativeState()), expectedHeadMark: proposal.scope.headMark,");
    expect(page).toContain("const currency = sheetOrganizationCurrency(proposal, liveSheetForSealedArtifacts()); if (!currency.ok) { setPendingOrganization(null);");
    expect(page).not.toContain("planOrganizeIntoSheets("); // the page never plans an organisation itself: the tool (seal, re-plan) and the Sheets controller do
    expect(page).toContain("const discardOrganizationProposal = useCallback(() => { if (organizationApplyBusy || !pendingOrganization) return; finishActivityLog(pendingOrganization.logId, sheetOrganizationLines.discarded()); setPendingOrganization(null); showToast(sheetOrganizationLines.discarded()); }, [organizationApplyBusy, pendingOrganization]);");
    expect(count(page, "<SheetOrganizationReviewCard ")).toBe(1);
    expect(page).toContain("alreadyApplied: sheetOrganizationAlreadyApplied(pendingOrganization.received.proposal, authoritativeSchematic)");
    expect(page).toContain("setPendingReplace(null); setPendingOrganization(null); // no stale replacement dialog crosses projects");
    expect(count(page, "crypto.randomUUID")).toBe(36); // [PR-J3] 6e60efa0's count: no new browser uuid draw
  });
});

describe("[PR-J5] 5. the pure helpers and the inventory", () => {
  it("the advisory is null for a single-sheet base and names the sheets of a multi-sheet one; the refusal appends only the kept-flat findings", () => {
    expect(multiSheetReplaceAdvisory(droneFixtureState())).toBeNull();
    expect(multiSheetReplaceAdvisory({ sheets: undefined })).toBeNull();
    const base = multiSheetDroneFixtureState();
    expect(multiSheetReplaceAdvisory(base)).toBe("This project has 4 schematic sheets (Overview, Power, Motor drivers, IMU): a generated multi-sheet design replaces all of them after your review (one undoable step); a one-page design is refused at review.");
    const refusal = flatReplacementRefusal(base, droneFixtureState())!;
    expect(refusal).toBe(multiSheetReplaceRefusal(base));
    expect(refusal.endsWith("Ask for the design as subsystem blocks, or start a new project. Nothing was changed.")).toBe(true);
    expect(flatReplacementRefusalWithFindings(refusal, [])).toBe(refusal);
    expect(flatReplacementRefusalWithFindings(refusal, ["Electrical check passed.", "Kept on one page: PWM1 is labelled in A, B but is not a planned shared net."])).toBe(`${refusal} Why it is one page: PWM1 is labelled in A, B but is not a planned shared net.`);
    expect(flatReplacementRefusalWithFindings(refusal, ["Kept on one page: a.", "Kept on one page: b.", "Kept on one page: c."])).toBe(`${refusal} Why it is one page: a. b. (and 1 more finding)`);
  });

  it("the sheet-set notes: nothing without a set; the findings, then the kept-flat finding or the layout's sentence", () => {
    expect(generatedSheetsProposalNotes(undefined, null)).toEqual([]);
    const findings = ["Barometer was not designed: its ports I2C_SDA, I2C_SCL are unbound."];
    expect(generatedSheetsProposalNotes({ schema: "sirkit.generation-sheets.v1", sheets: null, findings }, null)).toEqual(findings);
    expect(generatedSheetsProposalNotes({ schema: "sirkit.generation-sheets.v1", sheets: null, findings }, { kind: "flat", kept: "flat", finding: "Kept on one page: x." })).toEqual([...findings, "Kept on one page: x."]);
    const layout = { sheets: [{ sheetId: "a", sheetKey: "b1" as const, name: "Power", status: "designed" as const, components: 6, ports: [] }, { sheetId: "b", sheetKey: "b2" as const, name: "Barometer", status: "omitted" as const, components: 0, ports: ["I2C_SDA"] }], interfaces: ["I2C_SDA"] };
    expect(describeGeneratedSheetLayout(layout)).toBe("Laid out as System overview + 2 subsystem sheets: Power (6 parts); incomplete: Barometer; interfaces I2C_SDA. Approving replaces the whole project as one undoable transaction.");
  });

  it("the committed B17 inventory classifies the card's Approve (semantic, schematic.move-to-sheet) and Discard (view)", () => {
    const rows = inventory.split("\n").filter((row) => row.includes("SheetOrganizationReviewCard.tsx"));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((row) => row.includes("onApprove") && row.includes("semantic") && row.includes("schematic.move-to-sheet"))).toBe(true);
    expect(rows.some((row) => row.includes("onDiscard") && row.includes("view"))).toBe(true);
  });
});
