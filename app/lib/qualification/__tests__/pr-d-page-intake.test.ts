/**
 * [PR-D] The page's intake of the agent's Build-mode generation (`sirkit.schematic.generate-proposal`), pinned by reading app/page.tsx
 * as text (as pr-a-journey-reproductions does) and by driving the SAFE receivers (app/lib/project/generation-proposal-events.ts).
 *
 * [PR-L, 2026-10-18] Runbook L.5, increment 5: updated to the 2.0.0 contract. Its v1 assertions described the REMOVED intake of a design
 * sealed inside the chat run (`generation_proposal_ready` -> offerGenerationProposal, its own currency check and its own copy of the
 * layout path). The chat's generation is now the project's DURABLE generation task, and the page receives a task REFERENCE
 * (`generation_task_ready`) that it follows with the SAME status card and the SAME review intake as a Build start. What each block pins:
 *
 *  1. ONE review dialog, no auto-apply: exactly one `schematic-proposal-review` and one approve control, driven by `pendingReplace`; the
 *     stream case sets no proposal state and applies nothing.
 *  2. ONE intake for Build and chat: the case hands the received reference to followChatGenerationTask, which decides once
 *     (generationTaskAttachDecision), re-reads the task through the page's own authorized route and calls the SAME attachGenerationTask
 *     the composer's Build start calls; its result reaches the SAME offerGenerationTaskResult -> offerBuildResult -> offerSchematicProposal
 *     (catalog loading, autoLayoutBuildValidated, completeness and electrical notes, the integrity check, the exact-base pin, the persisted
 *     pending-proposal record), once per (task, result digest); a chat-started task says who proposed it.
 *  3. The base recipe follows the TASK: build-pin is the sheet's content (the composer's pin), chat-sheet the sheet as the chat run posts
 *     it (the server digested that object as-is) - the same recipe as the sheet-artifact checks.
 *  4. The SAFE receivers: a reference is narrowed defensively (a wrong event type or schema, a malformed id or disposition, a non-object
 *     are dropped); the attach decision follows a task once and never a foreign one; a control request is integrity-verified.
 *  5. No v1 intake remains, and the control inventory classifies the chip's two buttons (the stream cases themselves are not controls).
 *
 * Files are read as text; nothing is written; no provider, database or process work.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATION_TASK_CONTROL_SCHEMA, GENERATION_TASK_REF_SCHEMA, sealGenerationTaskControlRequest, type GenerationTaskReference } from "@/app/lib/agent/generation-task-tools";
import { generationTaskAttachDecision, generationTaskControlCurrency, receiveGenerationTaskControlEvent, receiveGenerationTaskEvent } from "@/app/lib/project/generation-proposal-events";

const page = readFileSync("app/page.tsx", "utf8").replaceAll("\r\n", "\n");
const inventory = readFileSync("artifacts/ai-control-plane-b17/ui-control-inventory.csv", "utf8");
const count = (text: string, needle: string): number => text.split(needle).length - 1;
const between = (from: string, to: string): string => {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`${from.trim().slice(0, 60)} is not where the suite expects it`);
  return page.slice(start, end);
};
/** the stream consumer's two task cases */
const caseBlock = between('          case "generation_task_ready": {', '          case "view_command_ready": {');
/** the chat task's follow, its log, the base recipe and the chip's actions */
const follow = between("  async function followChatGenerationTask(", "  // [PR-G, 2026-10-17] The LIVE editor as the sheet-artifact currency checks read it");
/** the composer's Generate (Build start) */
const composer = between("  async function handleGenerateSchematic(", "  async function offerBuildResult(");
/** the shared result intake: offerBuildResult and offerSchematicProposal */
const intake = between("  async function offerBuildResult(", "  // ─── [PR-L, 2026-10-17] the project's durable generation task");
/** the task follow and the once-per-result offer */
const taskFollow = between("  function attachGenerationTask(", "  /** The sheet moved since the task's base");
const recipes = between("  function liveSheetForSealedArtifacts(", "  // Tier-1 text editing:");

const SCOPE = { tenantId: "local", projectId: "p-prd-intake", branchId: "main" };
const TASK_ID = `generation-task:${"cd".repeat(16)}`;
const reference = (overrides: Partial<GenerationTaskReference> = {}): GenerationTaskReference => ({
  schema: GENERATION_TASK_REF_SCHEMA, taskId: TASK_ID, scope: { ...SCOPE }, disposition: "started", sameRequest: true, state: "queued", phase: "planning", origin: "chat", liveness: "waiting_for_worker",
  base: { schematicDigest: "eng1-0123456789abcdef", recipe: "chat-sheet" }, result: null, durability: "durable", createdAt: "2026-10-18T09:00:00.000Z", ...overrides,
});

describe("[PR-D page intake 1] one review dialog, no auto-apply", () => {
  it("the page renders exactly one schematic review dialog and one approve control, both driven by pendingReplace", () => {
    expect(count(page, 'data-testid="schematic-proposal-review"')).toBe(1);
    expect(count(page, '<Button data-testid="schematic-proposal-approve"')).toBe(1); // the one approve control...
    expect(count(page, 'data-testid="schematic-proposal-approve"')).toBe(2); // ...and the journey strip's focus target for it (review_proposal), the same control
    expect(count(page, "open={pendingReplace !== null}")).toBe(1);
  });

  it("[PR-L, 2026-10-18] pin move: the stream cases set no proposal state and apply nothing; the follow never applies either", () => {
    expect(caseBlock).not.toMatch(/applySchematic\(|setPendingReplace\(|setPendingTier1\(|setPendingReplacement\(/);
    expect(follow).not.toMatch(/applySchematic\(|setPendingReplace\(|<Dialog/);
    expect(count(intake, "setPendingReplace({ state, explanation, prompt, logId, promptAlreadyLogged: true, pin, validationNote })")).toBe(1); // the ONE offer
    // [PR-L/M integration, 2026-10-18] F4: v1's guard over the region that carries the offer, restored over v2's two regions - the shared
    // intake (offerBuildResult / offerSchematicProposal) opens only the review dialog's state above and never applies; the task follow
    // (attachGenerationTask / offerGenerationTaskResult) neither applies nor sets any proposal state itself (it calls offerBuildResult)
    expect(intake).not.toMatch(/applySchematic\(|setPendingTier1\(|setPendingReplacement\(|setPendingPcbProposal\(|<Dialog/);
    expect(taskFollow).not.toMatch(/applySchematic\(|setPendingReplace\(|setPendingTier1\(|setPendingReplacement\(|setPendingPcbProposal\(|<Dialog/);
  });

  it("[PR-L, 2026-10-18] pin move: the task case receives through the SAFE receiver exactly once, drops a malformed reference with the page's sentence, and hands the reference to the follow; the control case shows a chip", () => {
    expect(count(page, 'case "generation_task_ready": {')).toBe(1);
    expect(count(caseBlock, "receiveGenerationTaskEvent(event)")).toBe(1);
    expect(count(caseBlock, "void followChatGenerationTask(started, { scope });")).toBe(1);
    expect(caseBlock).toContain("it was malformed. This page follows nothing for it and nothing was changed.");
    expect(count(page, 'case "generation_task_control_ready": {')).toBe(1);
    expect(count(caseBlock, "receiveGenerationTaskControlEvent(event)")).toBe(1);
    expect(caseBlock).toContain("generationTaskControlCurrency(control.request,");
    expect(caseBlock).toContain("upsertReviewCard(`${GENERATION_TASK_CONTROL_CARD_ID_PREFIX}${control.request.requestId}`");
    expect(caseBlock).not.toContain("controlGenerationTask("); // receiving the chip sends nothing
  });
});

describe("[PR-D page intake 2] ONE intake for Build and chat", () => {
  it("[PR-L, 2026-10-18] the follow decides once, re-reads the task through the page's own authorized route, and calls the SAME attachGenerationTask as the Build start", () => {
    expect(follow).toContain("const decision = generationTaskAttachDecision(task, {");
    expect(follow).toContain('if (decision.kind !== "attach") return;');
    expect(follow).toContain("await fetchGenerationTask({ projectId: scope.projectId, branchId: scope.branchId }, task.taskId, { signal: scope.signal });");
    expect(follow).toContain("attachGenerationTask(detail.task, { logId, prompt: detail.task.prompt ?? \"\", scope });");
    expect(composer).toContain("attachGenerationTask(started.task, { logId, prompt, scope });");
    expect(count(page, "  function attachGenerationTask(")).toBe(1);
    expect(follow).not.toContain("crypto.randomUUID"); // the chat task's entry and lines draw no editor id (the composer's id sequence is unchanged, as l4-task-client pins for the task code)
    // [PR-L/M integration, 2026-10-18] L5-1: the chat task's activity ENTRY (a chat message, saved and restored with the project) takes an id
    // that is unique across page loads; the page-local line counter restarts at every load, so it names the entry's lines only - an entry
    // id from it collided with a restored entry's id, and the new task's progress and Stop/Pause card were written into both
    const taskLog = between("  function startGenerationTaskLog(", "  /** [PR-L, 2026-10-18] The live sheet's digest under a design task's base recipe");
    expect(taskLog).toContain("const id = `generation-task-log-${randomGenerationUuid()}`;");
    expect(taskLog).not.toMatch(/const id = generationActivityLineId\(\)/);
    expect(count(taskLog, "generationActivityLineId()")).toBe(1); // the entry's first line
  });

  it("[PR-L, 2026-10-18] the followed task's result takes the ONE offer: once per (task, result digest), through offerBuildResult's catalog loading, layout, notes and the exact-base pin, persisted by the one store", () => {
    expect(taskFollow).toContain("const key = `${view.taskId}:${result.resultDigest}`;");
    expect(taskFollow).toContain("if (entry.offered.has(key)) return;");
    expect(taskFollow).toContain("stored.task.resultDigest === result.resultDigest");
    expect(taskFollow).toContain("const offered = await offerBuildResult(");
    expect(taskFollow).toContain('...(view.origin === "chat" ? { note: `Proposed by the assistant (${view.provider}) for your request; approving replaces the sheet it was generated against. Nothing has been changed yet.` } : {})');
    for (const shared of ["ensurePartLoaded(id)", "const built = autoLayoutBuildValidated(netlist, parts);", "completenessNote({", "electricalCheckNote(", "validateSchematicStateIntegrity(state)", "if (run.note) proposalNotes.push(run.note);"]) expect(intake, shared).toContain(shared);
    expect(intake).toContain("savePendingProposal({ projectId: pin.projectId, baseDigest: proposalContentDigest(gestureCoordinatorRef.current!.authoritativeState()), state, explanation, prompt, validationNote })");
    expect(count(page, 'from "@/app/lib/project/pending-proposal-store"')).toBe(1);
    expect(page).toContain("restorePendingProposalRef.current(record.id);");
  });
});

describe("[PR-D page intake 3] the base recipe follows the task", () => {
  it("[PR-L, 2026-10-18] build-pin is the sheet's content, chat-sheet the sheet as the chat run posts it - the same recipe as the sheet-artifact checks; the moved base is reported under the task's recipe", () => {
    expect(count(page, "schematicState: { ...chatSnapshot, pageSize: chatSnapshot.pageSize ?? pageSize }")).toBe(1); // what `send` posts (the server digests it as-is)
    expect(follow).toContain('return recipe === "chat-sheet" ? schematicStateDigest({ ...live, pageSize: live.pageSize ?? liveStateRef.current.pageSize }) : proposalContentDigest(live);');
    expect(recipes).toContain("baseDigest: schematicStateDigest({ ...live, pageSize: live.pageSize ?? liveStateRef.current.pageSize }),");
    expect(taskFollow).toContain("const liveDigest = generationLiveBaseDigest(view.base.recipe);");
    expect(taskFollow).toContain("await reportGenerationBaseMoved(entry, liveDigest, view.base.recipe);");
    expect(page).toContain('liveBase: { schematicDigest: liveDigest, recipe: recipe === "chat-sheet" ? "chat-sheet" : "build-pin" }');
  });

  it("[PR-L/M integration, 2026-10-18] L5-3: the review's report of the live base uses the TASK's recipe even when this page does not follow the task (a result restored before, or without, the reattach): it re-reads the task, never guesses build-pin, sends nothing when the recipe is unreadable, and says a refused report in the task's entry", () => {
    const review = between("  function reportGenerationReview(", "  // [PR-D] The agent's Build-mode generation enters");
    expect(review).not.toContain(': "build-pin" as const; const liveDigest'); // the old guess: every unfollowed task reported as build-pin (the store refuses a mismatched recipe)
    expect(review).toContain('const liveDigests = outcome === "not-applied" ? { "build-pin": generationLiveBaseDigest("build-pin"), "chat-sheet": generationLiveBaseDigest("chat-sheet") } : null;');
    expect(review).toContain('const detail = await fetchGenerationTask({ projectId, branchId: "main" }, task.taskId); return detail.ok && (detail.task.base.recipe === "chat-sheet" || detail.task.base.recipe === "build-pin") ? detail.task.base.recipe : null;');
    expect(review).toContain("if (liveDigests !== null && recipe === null) return;");
    expect(review).toContain("liveBase: { schematicDigest: liveDigests[recipe], recipe }");
    expect(review).toContain("appendActivityStep(entry.logId, `The design task did not record this review: ${answer.message}`, \"error\", generationActivityLineId()); return; }");
    expect(count(review, "newGenerationClientActionId()")).toBe(2);
  });
});

describe("[PR-D page intake 4] the SAFE receivers", () => {
  it("[PR-L, 2026-10-18] a reference is received from its own event with the run id as audit metadata; a wrong event type or schema, a malformed id or disposition and a non-object are dropped", () => {
    const wire = JSON.parse(JSON.stringify(reference())) as Record<string, unknown>;
    const received = receiveGenerationTaskEvent({ type: "generation_task_ready", runId: "run-prd-intake", task: wire });
    expect(received).toMatchObject({ runId: "run-prd-intake", task: { taskId: TASK_ID, disposition: "started", base: { recipe: "chat-sheet" } } });
    expect(receiveGenerationTaskEvent({ type: "generation_task_ready", runId: 42, task: wire })!.runId).toBeNull();
    expect(receiveGenerationTaskEvent({ type: "generation_proposal_ready", task: wire })).toBeNull();
    expect(receiveGenerationTaskEvent({ type: "generation_task_ready", task: { ...wire, schema: "sirkit.schematic-generation-proposal.v1" } })).toBeNull();
    expect(receiveGenerationTaskEvent({ type: "generation_task_ready", task: { ...wire, taskId: "task-1" } })).toBeNull();
    expect(receiveGenerationTaskEvent({ type: "generation_task_ready", task: { ...wire, disposition: "applied" } })).toBeNull();
    expect(receiveGenerationTaskEvent({ type: "generation_task_ready", task: "generation-task:x" })).toBeNull();
    expect(receiveGenerationTaskEvent(null)).toBeNull();
  });

  it("[PR-L, 2026-10-18] the attach decision: this project's new task is attached; a task already followed or a result already in the dialog is not attached twice; another project's is foreign", () => {
    const live = { projectId: SCOPE.projectId, branchId: "main", followedTaskId: null, pendingTask: null };
    expect(generationTaskAttachDecision(reference(), live)).toEqual({ kind: "attach" });
    expect(generationTaskAttachDecision(reference(), { ...live, followedTaskId: TASK_ID })).toMatchObject({ kind: "already-followed" });
    expect(generationTaskAttachDecision(reference({ result: { status: "complete", omittedBlocks: [], resultDigest: "dw1-r" } }), { ...live, pendingTask: { taskId: TASK_ID, resultDigest: "dw1-r" } })).toMatchObject({ kind: "already-offered" });
    expect(generationTaskAttachDecision(reference(), { ...live, projectId: "p-other" })).toMatchObject({ kind: "foreign", detail: expect.stringContaining("another project") });
    expect(generationTaskAttachDecision(reference(), { ...live, branchId: "feature" })).toMatchObject({ kind: "foreign" });
  });

  it("[PR-L, 2026-10-18] a control request is integrity-verified (an altered action or an extra key is dropped) and current only in its project, unexpired", () => {
    const request = sealGenerationTaskControlRequest({ version: "1.0.0", scope: { ...SCOPE }, taskId: TASK_ID, action: "pause", blockId: null, label: "Pause design", stateAtRequest: "running", actor: { actorId: "agent:openai", kind: "ai" }, effectiveActor: { actorId: "u-1", kind: "human" }, provenance: { provider: "openai", runId: "run-prd-intake" }, createdAt: 1_760_000_000_000 });
    const wire = JSON.parse(JSON.stringify(request)) as Record<string, unknown>;
    expect(request.schema).toBe(GENERATION_TASK_CONTROL_SCHEMA);
    expect(receiveGenerationTaskControlEvent({ type: "generation_task_control_ready", runId: "r", request: wire })?.request.requestId).toBe(request.requestId);
    expect(receiveGenerationTaskControlEvent({ type: "generation_task_control_ready", request: { ...wire, action: "cancel" } })).toBeNull();
    expect(receiveGenerationTaskControlEvent({ type: "generation_task_control_ready", request: { ...wire, confirmed: true } })).toBeNull();
    expect(receiveGenerationTaskControlEvent({ type: "generation_task_ready", request: wire })).toBeNull();
    expect(generationTaskControlCurrency(request, { projectId: SCOPE.projectId, branchId: "main", now: request.createdAt + 1 })).toEqual({ ok: true });
    expect(generationTaskControlCurrency(request, { projectId: "p-other", branchId: "main", now: request.createdAt + 1 })).toMatchObject({ ok: false, code: "foreign-scope" });
    expect(generationTaskControlCurrency(request, { projectId: SCOPE.projectId, branchId: "main", now: request.expiresAt })).toMatchObject({ ok: false, code: "expired" });
  });
});

describe("[PR-D page intake 5] no v1 intake remains; the chip's controls are classified", () => {
  it("[PR-L, 2026-10-18] pin move: the page names neither the v1 event nor its intake; the committed B17 inventory classifies the chip's Confirm (semantic) and Dismiss (view), and names no stream case", () => {
    expect(page).not.toContain('case "generation_proposal_ready"');
    expect(page).not.toContain("offerGenerationProposal");
    expect(page).not.toContain("receiveGenerationProposalEvent");
    expect(inventory).not.toContain("generation_proposal");
    expect(inventory).not.toContain("offerGenerationProposal");
    expect(inventory).toContain("onConfirmGenerationControl");
    expect(inventory).toContain("onDismissGenerationControl");
    expect(inventory).not.toContain("followChatGenerationTask");
  });
});
