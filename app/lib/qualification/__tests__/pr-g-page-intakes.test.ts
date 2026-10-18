/**
 * [PR-G, 2026-10-17] The page's intakes of the agent's three new sealed artifacts, pinned by reading app/page.tsx, PcbEditor.tsx, the
 * stackup preview panel, the publication panel and the committed inventories as text (as pr-d-page-intake does):
 *
 *  1. the stream consumer names exactly the three new cases, each once, each through its SAFE receiver exactly once, each dropping a failed
 *     artifact and refusing a stale one with the page's sentence; the case order keeps stackup beside layout_candidate_ready;
 *  2. draft_request_ready is a REVIEW TASK: a run-log card from the receiver's rows, ONE action ("Open the publication request") that opens
 *     the EXISTING AtomicPublicationReviewSection prefilled from the sealed spec in the page's one dialog; the page submits nothing
 *     (no publication POST, no submit call), and a card whose request the page no longer holds says so with a disabled control;
 *  3. module_contracts_ready is an engineering NOTE: a collapsible run-log card, no apply of any kind, and the card says it is the note;
 *  4. stackup_candidate_ready is a PREVIEW: the page checks the candidate against the LIVE board's revision and hands it to PcbEditor,
 *     which re-verifies and renders StackupCandidatePanel; its Accept re-checks the revision and runs the SAME `applyStackupProfile` the
 *     toolbar's Stackup selector runs (the one pcb.board-geometry commit); the intake effect never commits; the page never commits;
 *  5. the sheet-artifact currency recipe is byte-identical to offerGenerationProposal's ([PR-L, 2026-10-18] since runbook L.5 removed that v1 intake: to
 *     generationLiveBaseDigest's chat-sheet recipe, the base a chat-started design task pins); the new controls are classified in the B17
 *     inventory and named in the B24 census; the answer footer is rendered from the run's own events and never enters the history.
 *
 * Files are read as text; nothing is written; no provider, database or process work.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const page = read("app/page.tsx");
const editor = read("app/components/pcb/PcbEditor.tsx");
const panel = read("app/components/pcb/StackupCandidatePanel.tsx");
const publication = read("app/components/parts/AtomicPublicationReviewPanel.tsx");
const inventory = read("artifacts/ai-control-plane-b17/ui-control-inventory.csv");
const census = read("artifacts/ai-control-plane-b24/accessible-name-census.csv");
const history = read("app/lib/project/chat-history.ts");
const persistence = read("lib/persistence.ts");
const count = (text: string, needle: string): number => text.split(needle).length - 1;
const between = (text: string, start: string, end: string): string => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`${start.slice(0, 60)} … ${end.slice(0, 60)} is not where the suite expects it`);
  return text.slice(from, to);
};
const consumer = between(page, "const applyAgentEvent = (event: Record<string, unknown>): void => {", "while (true) {");
const stackupCase = between(consumer, 'case "stackup_candidate_ready": {', 'case "draft_request_ready": {');
const draftCase = between(consumer, 'case "draft_request_ready": {', 'case "module_contracts_ready": {');
const moduleCase = between(consumer, 'case "module_contracts_ready": {', 'case "component_resolution_ready": {'); // [PR-M, 2026-10-18] reviewed pin move: the case after it is now the component resolution's (was execution_grant_ready)
const resolutionCase = between(consumer, 'case "component_resolution_ready": {', 'case "execution_grant_ready": {'); // [PR-M, 2026-10-18] the component resolution's intake
const bubble = between(page, "function MessageBubble(", "function TheoryPartRow(");
const dialog = between(page, 'data-testid="draft-request-publication-dialog"', "{/* Confirmation dialog for replacing existing schematic */}");
const liveSheet = between(page, "function liveSheetForSealedArtifacts()", "// Tier-1 text editing:");
const generationIntake = between(page, "function generationLiveBaseDigest(", "async function confirmGenerationControl("); // [PR-L, 2026-10-18] pin move (runbook L.5): the v1 intake (offerGenerationProposal) was removed; the chat task's chat-sheet base recipe is the copy that must stay byte-identical
const intakeEffect = between(editor, "const stackupIntakeRef = useRef<string | null>(null);", "const pendingStackupLiveRevision");
const accept = between(editor, "async function acceptStackupCandidate(): Promise<void> {", "// B08.2 — lifecycle replacement");
const applyStackup = between(editor, "function applyStackupProfile(", "// [PR-G, 2026-10-17] the agent's stackup recommendation enters as a PREVIEW");

describe("[PR-G page intakes 1] the three cases, each through its SAFE receiver once", () => {
  it("the consumer names each new case exactly once, in order, and keeps every earlier case; every case drops a failed artifact and refuses a stale one with the page's sentence", () => {
    const cases = [...consumer.matchAll(/^\s*case "([a-z_]+)":/gm)].map((match) => match[1]!);
    expect(cases).toEqual(["text_delta", "tool_started", "tool_finished", "tool_refused", "proposal_ready", "pcb_proposal_ready", "generation_task_ready", "generation_task_control_ready", "view_command_ready", "layout_candidate_ready", "stackup_candidate_ready", "draft_request_ready", "module_contracts_ready", "component_resolution_ready", "execution_grant_ready", "execution_settled", "warning", "run_failed"]); // [PR-M, 2026-10-18] reviewed pin move: + component_resolution_ready after module_contracts_ready (runbook M.2.5: the SAFE receiver, the currency check, the review dialog)
    expect(count(resolutionCase, "receiveComponentResolutionEvent(event)")).toBe(1); // [PR-M, 2026-10-18] received once, through its SAFE receiver, and checked against the live editor before it is offered
    expect(count(page, "receiveComponentResolutionEvent(")).toBe(1);
    expect(count(resolutionCase, "componentResolutionCurrency(resolution.proposal, liveSheetForSealedArtifacts())")).toBe(1);
    expect(resolutionCase).toContain("resolutionLines.dropped()");
    expect(resolutionCase).toContain("resolutionLines.notOffered(resolutionVerdict.detail)");
    expect(count(stackupCase, "receiveStackupCandidateEvent(event)")).toBe(1);
    expect(count(draftCase, "receiveDraftRequestEvent(event)")).toBe(1);
    expect(count(moduleCase, "receiveModuleContractsEvent(event)")).toBe(1);
    expect(count(page, "receiveStackupCandidateEvent(")).toBe(1);
    expect(count(page, "receiveDraftRequestEvent(")).toBe(1);
    expect(count(page, "receiveModuleContractsEvent(")).toBe(1);
    expect(stackupCase).toContain("A stackup recommendation the assistant issued was dropped by this page: it failed the integrity checks. Nothing was changed and nothing is offered.");
    expect(stackupCase).toContain("`Stackup recommendation not offered — ${stackupVerdict.detail}`");
    expect(draftCase).toContain("A part draft request the assistant issued was dropped by this page: it failed the integrity checks. Nothing was changed and no review task is offered.");
    expect(draftCase).toContain("`Draft request not offered — ${draftVerdict.detail}`");
    expect(moduleCase).toContain("A module contract set the assistant issued was dropped by this page: it failed the integrity checks. Nothing was changed and no note is offered.");
    expect(moduleCase).toContain("`Module contracts not offered — ${noteVerdict.detail}`");
    for (const block of [stackupCase, draftCase, moduleCase]) expect(block).toMatch(/if \(!\w+\) \{ appendActivityStep\(logId, "[^"]+", "error"\); return; \}/);
  });

  it("the three receivers are imported from app/lib/project (the page's SAFE-receiver layer), once each, beside the generation receiver", () => {
    expect(count(page, 'from "@/app/lib/project/draft-request-events";')).toBe(1);
    expect(count(page, 'from "@/app/lib/project/module-contract-events";')).toBe(1);
    expect(count(page, 'from "@/app/lib/project/stackup-candidate-events";')).toBe(1);
    expect(count(page, 'from "@/app/lib/project/generation-proposal-events";')).toBe(1);
    // the page never imports the services, the gateway, the loop or the sealers
    expect(page).not.toMatch(/from "@\/app\/lib\/agent\/(draft-request-proposals|module-contract-proposals|stackup-proposals|gateway|loop)"/);
  });
});

describe("[PR-G page intakes 2] draft_request_ready is a review task with one action; the page submits nothing", () => {
  it("the current request becomes a run-log card from the receiver's rows, held live by proposal id, with the one-action sentence in the run log", () => {
    expect(count(draftCase, "draftRequestCurrency(draft.proposal, liveSheetForSealedArtifacts())")).toBe(1);
    expect(count(draftCase, "liveDraftRequestsRef.current.set(draft.proposal.proposalId, draft);")).toBe(1);
    expect(count(draftCase, "const card = draftRequestCardLines(draft.proposal);")).toBe(1);
    expect(count(draftCase, "upsertReviewCard(`${DRAFT_REQUEST_CARD_ID_PREFIX}${draft.proposal.proposalId}`, card.title, card.lines, assistantId);")).toBe(1);
    expect(draftCase).toContain('`Review task: an UNVERIFIED draft request for ${draft.proposal.instance.refDes} (${draft.proposal.draftRequest.exactMpn})');
    expect(draftCase).toContain("Nothing is published, bound or assignable until a person submits it, a reviewer approves and an administrator publishes.");
    expect(draftCase).not.toMatch(/fetch\(|setPendingReplace\(|setPendingTier1\(|applySchematic\(|publishRequest|submitRequest|\.submit\(/); // the case files nothing (its sentences SAY "publishes nothing")
  });

  it("the card's ONE action opens the EXISTING publication request prefilled from the sealed spec in the page's one dialog; a card the page no longer holds has the control disabled with the reason", () => {
    expect(count(bubble, "<Button size=\"sm\" variant=\"outline\" data-testid=\"draft-request-open\" disabled={!draftRequestHeld}")).toBe(1);
    expect(bubble).toContain("onClick={() => onOpenDraftRequest(draftRequestId)}>{DRAFT_REQUEST_OPEN_LABEL}</Button>");
    expect(bubble).toContain("not available: this page no longer holds the sealed request (reload or project switch) — ask the assistant again");
    expect(bubble).toContain('"data-testid": "chat-draft-request-card"');
    expect(count(page, "function openDraftRequestPublication(proposalId: string): void {")).toBe(1);
    expect(page).toContain("const held = liveDraftRequestsRef.current.get(proposalId);");
    expect(page).toContain("setDraftRequestOpen(held);");
    expect(count(page, 'data-testid="draft-request-publication-dialog"')).toBe(1);
    expect(count(page, "<AtomicPublicationReviewSection ")).toBe(1);
    expect(dialog).toContain('projectScope={{ tenantId: "local", projectId: project.id, branchId: "main" }} prefill={draftRequestPublicationPrefill(draftRequestOpen.proposal)}');
    expect(dialog).toContain("the symbol and footprint references are yours to pick");
    expect(dialog).toContain("No project is open: the publication request needs the project&apos;s scope. Nothing was changed.");
    // the page itself never files the request: no publication route, no submit, no normalizer, no draft assembly
    expect(page).not.toMatch(/\/api\/components\/atomic\/publication|submitRequest|review\.submit|normalizeAtomicPublicationSpec|assembleAtomicDraft|submitAtomicPublicationRequest/);
    // the same section the Build Library and the Missing parts list mount (the existing human path)
    expect(count(page, 'import { AtomicPublicationReviewSection } from "@/app/components/parts/AtomicPublicationReviewPanel";')).toBe(1);
    expect(read("app/components/pcb/MissingPartsList.tsx")).toContain('import { AtomicPublicationReviewSection, type AtomicPublicationPrefill } from "@/app/components/parts/AtomicPublicationReviewPanel";');
  });

  it("the publication form takes the sealed spec's remaining fields as optional prefill and keeps a pin function with a space whole; the existing callers are unchanged", () => {
    expect(publication).toContain("profile: prefill?.profile ?? \"pcb_assignable\"");
    expect(publication).toContain("terminals: prefill?.terminals ?? \"\", packageCode: prefill?.packageCode ?? \"\", mounting: prefill?.mounting ?? \"smd\", datasheetUrl: prefill?.datasheetUrl ?? \"\", datasheetLocator: prefill?.datasheetLocator ?? \"\"");
    expect(publication).toContain("const pads = rest.length >= 2 ? rest.pop()! : \"\";");
    expect(publication).toContain("return { number, function: rest.join(\" \"), pads: pads ? pads.split(\",\").filter(Boolean) : [number] };");
    for (const field of ["profile?: ImportReviewProfile;", "terminals?: string;", "packageCode?: string;", "mounting?: \"smd\" | \"through_hole\";", "datasheetUrl?: string;", "datasheetLocator?: string;"]) expect(publication).toContain(field);
  });
});

describe("[PR-G page intakes 3] module_contracts_ready is a collapsible engineering note; no apply exists", () => {
  it("the current set becomes a collapsible run-log card from the receiver's rows; the run log says the card is the note; nothing applies", () => {
    expect(count(moduleCase, "moduleContractCurrency(contracts.proposal, liveSheetForSealedArtifacts())")).toBe(1);
    expect(count(moduleCase, "const note = moduleContractNoteLines(contracts.proposal);")).toBe(1);
    expect(count(moduleCase, "upsertReviewCard(`${MODULE_CONTRACT_NOTE_ID_PREFIX}${contracts.proposal.proposalId}`, note.title, [note.summary, ...note.details], assistantId);")).toBe(1);
    expect(moduleCase).toContain("read the collapsible note below (this card is the note; it is kept with the project's chat history). Validated for structure only; no electrical check ran; nothing is applied to the sheet or a board.");
    const moduleCode = moduleCase.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n"); // code rows only (the comment says "NO apply" in words)
    expect(moduleCode).not.toMatch(/\bapply[A-Z]\w*\(|commitPcbCandidate|setPending\w*\(|fetch\(|dispatch\(/);
    expect(page).not.toMatch(/applyModuleContract|moduleContractApply|setPendingModuleContract/);
    expect(bubble).toContain("const shownEntries = moduleNote && !noteExpanded ? message.entries.slice(0, 1) : message.entries;");
    expect(count(bubble, 'data-testid="module-note-toggle"')).toBe(1);
    expect(bubble).toContain("aria-expanded={noteExpanded} aria-controls={`${message.id}-details`}");
    expect(bubble).toContain('"data-testid": "chat-module-note-card"');
  });
});

describe("[PR-G page intakes 4] stackup_candidate_ready is a preview; the existing stackup path performs the change", () => {
  it("the page re-parses the candidate, checks it against the LIVE board's revision (the editor-context bridge's exact working copy) and hands it to PcbEditor; the page itself never commits", () => {
    expect(stackupCase).toContain('const liveBoard = editorContextBridgeRef.current!.capture({ tenantId: "local", projectId: scope.projectId ?? projectRef.current?.id ?? "local", branchId: scope.branchId ?? "main" });');
    expect(count(stackupCase, "verifyStackupCandidateAgainstBoard(stackup.candidate, liveBoard?.pcbRevisionId ?? null, Date.now())")).toBe(1);
    expect(count(stackupCase, "setPendingStackupCandidate({ candidate: stackup.candidate, originRunId: stackup.runId });")).toBe(1);
    expect(count(stackupCase, "appendActivityStep(logId, stackupCandidateChatLine(stackup.candidate), \"done\");")).toBe(1);
    expect(count(page, "stackupCandidateIntake={pendingStackupCandidate}")).toBe(1);
    expect(count(page, "onStackupCandidateSettled={() => setPendingStackupCandidate(null)}")).toBe(1);
    expect(page).not.toMatch(/commitPcbCandidate|applyStackupProfile|stackupProfile\(|reconcileStackupPlaneZones|pcb\.board-geometry/);
  });

  it("PcbEditor re-verifies on intake and renders the preview without committing; Accept re-checks the live revision, then runs the SAME applyStackupProfile the toolbar's Stackup selector runs; Discard drops it", () => {
    expect(count(intakeEffect, "verifyStackupCandidateAgainstBoard(intake.candidate, board ? pcbRevisionId(board) : null, Date.now())")).toBe(1);
    expect(intakeEffect).toContain("setPendingStackupCandidate(intake.candidate);");
    expect(intakeEffect).not.toMatch(/commitPcbCandidate|applyStackupProfile|produce\(/);
    expect(count(accept, "verifyStackupCandidateAgainstBoard(candidate, board ? pcbRevisionId(board) : null, Date.now())")).toBe(1);
    expect(accept).toContain("if (!verdict.ok) { setToast(`Stackup recommendation not applied: ${verdict.detail}`); setPendingStackupCandidate(null); return; }");
    expect(count(accept, "await applyStackupProfile(candidate.recommendation.profileId, candidate.recommendation.planes,")).toBe(1);
    expect(accept).not.toMatch(/commitPcbCandidate|produce\(/); // the commit lives in applyStackupProfile only
    expect(count(editor, 'onStackupChange={(stackup) => { void applyStackupProfile(stackup === 4 ? "all-signal-4" : "simple-2"); }}')).toBe(1);
    expect(count(applyStackup, 'commandId: "pcb.board-geometry"')).toBe(1);
    expect(applyStackup).toContain("d.stackupConfig = config;");
    expect(applyStackup).toContain("reconcileStackupPlaneZones(d);");
    expect(applyStackup).toContain("if (plane && layer.role === \"plane\") layer.planeNetId = plane.net.id;");
    expect(count(editor, "function applyStackupProfile(")).toBe(1);
    expect(count(editor, "applyStackupProfile(")).toBe(3); // the declaration, the toolbar's selector, the preview's Accept
    expect(count(editor, "<StackupCandidatePanel candidate={pendingStackupCandidate} liveRevision={pendingStackupLiveRevision} now={stackupPreviewNow} busy={stackupCandidateBusy} onAccept={() => void acceptStackupCandidate()} onDiscard={() => setPendingStackupCandidate(null)} />")).toBe(1);
  });

  it("the preview panel has exactly two controls, Accept disabled with the reason when stale or expired, and states what the candidate states (qualification, invalidation, not validated, unsupported)", () => {
    expect(count(panel, 'data-testid="stackup-candidate-accept"')).toBe(1);
    expect(count(panel, 'data-testid="stackup-candidate-discard"')).toBe(1);
    expect(count(panel, "onClick=")).toBe(2);
    expect(panel).toContain("disabled={busy || blocker !== null}");
    expect(panel).toContain("The board moved since the recommendation was sealed; it is stale. Ask the assistant again.");
    expect(panel).toContain("{recommendation.manufacturing.qualificationNote}");
    expect(panel).toContain('data-invalidates={invalidation.dependentApprovalsInvalidated ? "true" : "false"}');
    expect(panel).toContain("{notValidated.join(\" \")}");
    expect(panel).toContain("{unsupported.viaTechnologies.join(\", \")} vias; {unsupported.materialsAndImpedance} — {unsupported.reason}.");
    expect(panel).toContain("nothing is manufactured, qualified or released by it");
    expect(panel).not.toMatch(/commitPcbCandidate|fetch\(|manufacturable/);
  });
});

describe("[PR-G page intakes 5] the shared recipe, the inventories and the answer footer", () => {
  it("the sheet-artifact live-editor recipe is byte-identical to the chat task's chat-sheet base recipe (offerGenerationProposal's until runbook L.5 removed it)", () => {
    for (const line of [
      'scope: { tenantId: "local", projectId: projectScopeRegistryRef.current?.current.projectId ?? "local", branchId: projectScopeRegistryRef.current?.current.branchId ?? "local" },',
      "headMark: schematicSessionRef.current?.headMark() ?? null,",
      "baseDigest: schematicStateDigest({ ...live, pageSize: live.pageSize ?? liveStateRef.current.pageSize }),",
    ]) expect(count(liveSheet, line), line).toBe(1);
    // [PR-L, 2026-10-18] pin move: the digest expression is the shared recipe (a task's scope is the attach decision's, its head is not pinned)
    expect(count(generationIntake, 'recipe === "chat-sheet" ? schematicStateDigest({ ...live, pageSize: live.pageSize ?? liveStateRef.current.pageSize }) : proposalContentDigest(live)')).toBe(1);
    expect(count(liveSheet, "const live = gestureCoordinatorRef.current!.authoritativeState();")).toBe(1);
    expect(count(generationIntake, "const live = gestureCoordinatorRef.current!.authoritativeState();")).toBe(1);
    expect(count(page, "liveSheetForSealedArtifacts()")).toBe(4); // the declaration and the two sheet-artifact cases; [PR-M, 2026-10-18] reviewed pin move 3 -> 4: + the component resolution's intake (the same recipe)
  });

  it("every new control is classified in the committed B17 inventory under a PR-G rule and named in the B24 census", () => {
    for (const [key, rule] of [
      ["app/components/pcb/StackupCandidatePanel.tsx|click|button|stackup-candidate-accept|onAccept", "pcb.stackup-candidate-accept"],
      ["app/components/pcb/StackupCandidatePanel.tsx|click|button|stackup-candidate-discard|onDiscard", "view.stackup-candidate-discard"],
      ["app/page.tsx|click|Button|draft-request-open|onOpenDraftRequest", "view.page-draft-request-open"],
      ["app/page.tsx|click|button|module-note-toggle|setNoteExpanded", "view.page-module-note-toggle"],
      ["app/page.tsx|click|Button|Close|setDraftRequestOpen", "view.page-dismiss"],
      ["app/page.tsx|dialog|Dialog|(none)|setDraftRequestOpen", "view.page-dismiss"],
    ] as const) {
      const row = inventory.split("\n").find((line) => line.startsWith(`${key},`) || line.includes(`"${key}"`) || line.includes(key));
      expect(row, key).toBeDefined();
      expect(row, key).toContain(rule);
      expect(census, key).toContain(key);
    }
    expect(inventory).toContain("pcb.board-geometry"); // the Accept reaches the stackup selector's record
    const censusRows = census.split("\n").filter((line) => line.includes("StackupCandidatePanel.tsx") || line.includes("draft-request-open") || line.includes("module-note-toggle"));
    expect(censusRows.length).toBeGreaterThanOrEqual(4);
    for (const row of censusRows) expect(row, row).not.toMatch(/,unnamed,|,unnamed$/);
  });

  it("the answer footer is rendered once from the run's own events with the configured source for the disclosure only; it is kept with the answer and never enters the history", () => {
    expect(count(page, 'data-testid="chat-answer-footer"')).toBe(1);
    expect(count(page, "const footer = answerFooter(runView, { provider: runProvider, model: aiRuntime?.providers[runProvider]?.model ?? null });")).toBe(1);
    expect(page).toContain("...(footer ? { footer } : {})");
    expect(count(page, "answerFooter(")).toBe(1);
    expect(page).toContain("...(message.footer ? { footer: message.footer } : {})");
    expect(page).toContain("type ChatMessage = { id: string; role: \"user\" | \"assistant\"; content: string; advisory?: boolean; footer?: string };");
    expect(persistence).toContain("footer?: string }");
    expect(persistence).toContain('(m["footer"] === undefined || (typeof m["footer"] === "string" && m["footer"].length <= 1_000))');
    // the next run's history is role + content only: the label never reaches the model
    expect(history).toContain(".map(({ role, content }) => ({ role, content }));");
    expect(history).not.toContain("footer");
  });
});
