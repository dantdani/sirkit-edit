/**
 * [PR-D] The page's intake of the agent's Build-mode generation proposal (`sirkit.schematic.generate-proposal`, received by `send` as
 * `generation_proposal_ready`): pinned by reading app/page.tsx as text (as pr-a-journey-reproductions does) and by driving the SAFE
 * receiver (app/lib/project/generation-proposal-events.ts) with artifacts sealed by the service's own sealer.
 *
 *  1. ONE review dialog, no auto-apply: the page renders exactly one `data-testid="schematic-proposal-review"` and one
 *     `schematic-proposal-approve`, both driven by `pendingReplace`; the intake sets `pendingReplace` (the composer's Generate state),
 *     never a second dialog state and never `applySchematic`.
 *  2. The same path as the composer's Generate: the entry gate, catalog loading, `autoLayoutBuildValidated`, `completenessNote` /
 *     `electricalCheckNote` as the validation note (partial / skipped checks are data), `validateSchematicStateIntegrity`, the exact-base
 *     pin (`captureLifecycleInvocationContext`), the same base-digest recipe `send` posts, and the pending-proposal store
 *     (`savePendingProposal`, the page's one import of it; `restorePendingProposalRef` offers it again after a reload).
 *  3. The SAFE receiver: a sealed proposal is received with its run id as audit metadata; a wrong event type, a wrong schema, a tampered
 *     netlist, an extra key and a non-object are dropped.
 *  4. The currency check against the live editor: ok with the matching scope, head, base and time; foreign-scope, expired, stale-head
 *     (a moved head, or no session) and stale-base are refused with the page's sentence, in that order.
 *  5. No new control: the committed B17 inventory names neither the intake's case nor its function (the intake is a stream-event case
 *     and a function, not a control; the b17-a byte gate covers the CSV).
 *
 * Files are read as text; nothing is written; no provider, database or process work.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuildLogicalNetlist, SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { GENERATION_PROPOSAL_SCHEMA, GENERATION_PROPOSAL_TTL_MS, sealGenerationProposal, type SealedSchematicGenerationProposal } from "@/app/lib/agent/generation-proposals";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { generationProposalCurrency, receiveGenerationProposalEvent } from "@/app/lib/project/generation-proposal-events";

const page = readFileSync("app/page.tsx", "utf8").replaceAll("\r\n", "\n");
const inventory = readFileSync("artifacts/ai-control-plane-b17/ui-control-inventory.csv", "utf8");
const count = (text: string, needle: string): number => text.split(needle).length - 1;
/** the intake function's source: from its declaration to the next top-level comment (the tier-1 edit path) */
const intake = (() => {
  const start = page.indexOf("  async function offerGenerationProposal(");
  const end = page.indexOf("  // Tier-1 text editing:", start);
  if (start < 0 || end < 0) throw new Error("offerGenerationProposal is not where the suite expects it");
  return page.slice(start, end);
})();
/** the composer's Generate: handleGenerateSchematic's source */
const composer = (() => {
  const start = page.indexOf("  async function handleGenerateSchematic(");
  const end = page.indexOf("  async function offerGenerationProposal(", start);
  if (start < 0 || end < 0) throw new Error("handleGenerateSchematic is not where the suite expects it");
  return page.slice(start, end);
})();
/** the stream consumer's case block */
const caseBlock = (() => {
  const start = page.indexOf('          case "generation_proposal_ready": {');
  const end = page.indexOf('          case "view_command_ready": {', start);
  if (start < 0 || end < 0) throw new Error("the generation_proposal_ready case is not where the suite expects it");
  return page.slice(start, end);
})();

const SCOPE = { tenantId: "local", projectId: "p-prd-intake", branchId: "main" };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };
const NOW = 1_760_000_000_000;
/** a Build sheet: catalog parts, no Theory component (the server's `schematic-build-mode` fact) */
const BUILD_SHEET: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU" }], pageSize: "A4" };
const NETLIST: BuildLogicalNetlist = {
  components: [{ refDes: "U1", partId: "lib:ne555", value: "NE555", role: "processor" }, { refDes: "R1", partId: "lib:r-10k", value: "10k", role: "passive" }],
  connections: [{ from: "U1.3", to: "R1.1" }, { kind: "label", pin: "R1.2", labelName: "GND" }],
  explanation: "A 555 astable drives a series resistor.",
};

function sealed(): SealedSchematicGenerationProposal {
  const assembly = assembleAgentRunContext({ ...SCOPE, schematic: BUILD_SHEET, board: createEmptyBoard(), schematicHeadMark: HEAD_MARK, verifiedActor: { principalId: "u-1", actorRole: "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" }, schematicGenerationAvailable: true });
  if (!assembly.ok) throw new Error(assembly.reason);
  return sealGenerationProposal({
    body: { ok: true, netlist: NETLIST, explanation: NETLIST.explanation, status: "complete", omittedBlocks: [], electricalCheck: { state: "passed", criticalCount: 0, warningCount: 0 }, planner: { state: "planned", blocks: 1 }, budget: { iterationCap: 20, iterationsUsed: 3, deadlineMs: 40_000, elapsedMs: 1_234, concurrencyCap: 3 } },
    prompt: "A 555 timer LED blinker.", provider: "openai", runId: "run-prd-intake", context: assembly.context, headMark: HEAD_MARK, descriptor: { version: "1.0.0" }, now: NOW,
  });
}
/** the stream carries JSON: the page receives a plain (unfrozen) copy */
const wire = (proposal: SealedSchematicGenerationProposal): Record<string, unknown> => JSON.parse(JSON.stringify(proposal)) as Record<string, unknown>;
const live = (overrides: Partial<Parameters<typeof generationProposalCurrency>[1]> = {}) => ({ scope: SCOPE, headMark: HEAD_MARK, baseDigest: schematicStateDigest(BUILD_SHEET), now: NOW + 1_000, ...overrides });

describe("[PR-D page intake 1] one review dialog, no auto-apply", () => {
  it("the page renders exactly one schematic review dialog and one approve control, both driven by pendingReplace", () => {
    expect(count(page, 'data-testid="schematic-proposal-review"')).toBe(1);
    expect(count(page, '<Button data-testid="schematic-proposal-approve"')).toBe(1); // the one approve control...
    expect(count(page, 'data-testid="schematic-proposal-approve"')).toBe(2); // ...and the journey strip's focus target for it (review_proposal), the same control
    expect(count(page, "open={pendingReplace !== null}")).toBe(1);
  });

  it("the intake offers the proposal through pendingReplace only: no second dialog state, no apply, no tier-1 or replacement state", () => {
    expect(count(intake, "setPendingReplace({ state, explanation, prompt, logId, promptAlreadyLogged: true, pin, validationNote })")).toBe(1);
    expect(intake).not.toMatch(/applySchematic\(/);
    expect(intake).not.toMatch(/setPendingTier1\(|setPendingReplacement\(|setPendingPcbProposal\(|<Dialog/);
    expect(caseBlock).not.toMatch(/applySchematic\(|setPendingReplace\(/);
  });

  it("the stream case receives through the SAFE receiver exactly once, drops a failed artifact with the page's sentence, and hands the verified one to the intake", () => {
    expect(count(page, 'case "generation_proposal_ready": {')).toBe(1);
    expect(count(caseBlock, "receiveGenerationProposalEvent(event)")).toBe(1);
    expect(count(caseBlock, "void offerGenerationProposal(generation, { logId, scope });")).toBe(1);
    expect(caseBlock).toContain("failed the integrity checks. Nothing was changed and no proposal is offered.");
    expect(count(page, 'import { generationProposalCurrency, receiveGenerationProposalEvent, type ReceivedGenerationProposal } from "@/app/lib/project/generation-proposal-events";')).toBe(1);
  });
});

describe("[PR-D page intake 2] the same path as the composer's Generate", () => {
  it("the same entry gate, catalog loading, layout and validation, notes as data and integrity check", () => {
    for (const shared of ['schematicConsumerGate("edit")', "ensurePartLoaded(id)", "const built = autoLayoutBuildValidated(netlist, parts);", "validateSchematicStateIntegrity(state)", "completenessNote({", "electricalCheckNote(", "proposalNotes.push(", "const validationNote = "]) {
      expect(composer, `composer: ${shared}`).toContain(shared);
      expect(intake, `intake: ${shared}`).toContain(shared);
    }
    expect(intake).toContain("completenessNote({ status: proposal.generation.status, omittedBlocks: proposal.generation.omittedBlocks })");
    expect(intake).toContain("electricalCheckNote(proposal.generation.electricalCheck)");
    expect(intake).toContain("Drawing check: ${v.length} issue(s)");
  });

  it("the same exact-base pin, the same persisted record, and the base-digest recipe `send` posts", () => {
    expect(count(intake, "const pin = captureLifecycleInvocationContext();")).toBe(1);
    expect(count(composer, "const pin = captureLifecycleInvocationContext();")).toBe(1);
    expect(intake).toContain("savePendingProposal({ projectId: pin.projectId, baseDigest: proposalContentDigest(gestureCoordinatorRef.current!.authoritativeState()), state, explanation, prompt, validationNote })");
    expect(composer).toContain("savePendingProposal({ projectId: pin.projectId, baseDigest: proposalContentDigest(gestureCoordinatorRef.current!.authoritativeState()), state, explanation, prompt, validationNote })");
    // the sheet as the chat run posts it (the server digests that object as-is) and the intake's live digest use one recipe
    expect(count(page, "schematicState: { ...chatSnapshot, pageSize: chatSnapshot.pageSize ?? pageSize }")).toBe(1);
    expect(intake).toContain("baseDigest: schematicStateDigest({ ...live, pageSize: live.pageSize ?? liveStateRef.current.pageSize })");
    expect(intake).toContain("headMark: schematicSessionRef.current?.headMark() ?? null");
    expect(count(intake, "generationProposalCurrency(proposal, {")).toBe(1);
  });

  it("the pending-proposal store is the page's one store, and a persisted proposal is restored into the same dialog", () => {
    expect(count(page, 'from "@/app/lib/project/pending-proposal-store"')).toBe(1);
    expect(page).toContain('import { clearPendingProposal, loadPendingProposal, savePendingProposal } from "@/app/lib/project/pending-proposal-store";');
    expect(page).toContain("restorePendingProposalRef.current(record.id);");
    expect(page).toContain("setPendingReplace({ state: stored.state, explanation: stored.explanation, prompt: stored.prompt, promptAlreadyLogged: true, pin,");
  });
});

describe("[PR-D page intake 3] the SAFE receiver", () => {
  it("receives a sealed proposal from its own event with the run id as audit metadata", () => {
    const proposal = sealed();
    const received = receiveGenerationProposalEvent({ type: "generation_proposal_ready", runId: "run-prd-intake", toolId: proposal.toolId, proposal: wire(proposal) });
    expect(received).not.toBeNull();
    expect(received!.proposal.proposalId).toBe(proposal.proposalId);
    expect(received!.runId).toBe("run-prd-intake");
    expect(receiveGenerationProposalEvent({ type: "generation_proposal_ready", runId: 42, proposal: wire(proposal) })!.runId).toBeNull();
  });

  it("drops a wrong event type, a wrong schema, a tampered netlist, an extra key and a non-object", () => {
    const proposal = sealed();
    expect(receiveGenerationProposalEvent({ type: "proposal_ready", runId: "r", proposal: wire(proposal) })).toBeNull();
    expect(receiveGenerationProposalEvent({ type: "generation_proposal_ready", runId: "r", proposal: { ...wire(proposal), schema: "sirkit.schematic-tier1-proposal.v3" } })).toBeNull();
    const tampered = wire(proposal) as { generation: { netlist: { components: Array<{ value: string }> } } };
    tampered.generation.netlist.components[0]!.value = "LM555";
    expect(receiveGenerationProposalEvent({ type: "generation_proposal_ready", runId: "r", proposal: tampered })).toBeNull();
    expect(receiveGenerationProposalEvent({ type: "generation_proposal_ready", runId: "r", proposal: { ...wire(proposal), applied: true } })).toBeNull();
    expect(receiveGenerationProposalEvent({ type: "generation_proposal_ready", runId: "r", proposal: "genprop-x" })).toBeNull();
    expect(receiveGenerationProposalEvent({ type: "generation_proposal_ready", runId: "r" })).toBeNull();
    expect(receiveGenerationProposalEvent(null)).toBeNull();
    expect(proposal.schema).toBe(GENERATION_PROPOSAL_SCHEMA);
  });
});

describe("[PR-D page intake 4] currency against the live editor", () => {
  it("is current with the matching scope, head, base and time", () => {
    expect(generationProposalCurrency(sealed(), live())).toEqual({ ok: true });
  });

  it("refuses a foreign scope, an expired proposal, a moved head, a not-ready session and a changed sheet, each with the page's sentence", () => {
    const proposal = sealed();
    expect(generationProposalCurrency(proposal, live({ scope: { ...SCOPE, projectId: "p-other" } }))).toMatchObject({ ok: false, code: "foreign-scope" });
    expect(generationProposalCurrency(proposal, live({ scope: { ...SCOPE, branchId: "feature" } }))).toMatchObject({ ok: false, code: "foreign-scope" });
    expect(generationProposalCurrency(proposal, live({ now: NOW + GENERATION_PROPOSAL_TTL_MS }))).toMatchObject({ ok: false, code: "expired" });
    expect(generationProposalCurrency(proposal, live({ now: NOW + GENERATION_PROPOSAL_TTL_MS - 1 }))).toEqual({ ok: true });
    expect(generationProposalCurrency(proposal, live({ headMark: { ...HEAD_MARK, headSequence: 4 } }))).toMatchObject({ ok: false, code: "stale-head", detail: expect.stringContaining("canonical head moved") });
    expect(generationProposalCurrency(proposal, live({ headMark: null }))).toMatchObject({ ok: false, code: "stale-head", detail: expect.stringContaining("not ready") });
    const edited: SchematicState = { ...BUILD_SHEET, kicadComponents: [...BUILD_SHEET.kicadComponents!, { id: "r1-id", partId: "lib:r-10k", x: 400, y: 100, rotation: 0, refDes: "R1", value: "10k" }] };
    expect(generationProposalCurrency(proposal, live({ baseDigest: schematicStateDigest(edited) }))).toMatchObject({ ok: false, code: "stale-base", detail: expect.stringContaining("stale") });
    // the sheet-size fallback is part of the posted digest: a sheet posted without its size is another base
    const unsized: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: BUILD_SHEET.kicadComponents };
    expect(generationProposalCurrency(proposal, live({ baseDigest: schematicStateDigest(unsized) }))).toMatchObject({ ok: false, code: "stale-base" });
    // order: a foreign scope is refused before expiry, a stale head before a stale base
    expect(generationProposalCurrency(proposal, live({ scope: { ...SCOPE, projectId: "p-other" }, now: NOW + GENERATION_PROPOSAL_TTL_MS }))).toMatchObject({ code: "foreign-scope" });
    expect(generationProposalCurrency(proposal, live({ headMark: null, baseDigest: "eng1-00" }))).toMatchObject({ code: "stale-head" });
    for (const refusal of [live({ scope: { ...SCOPE, projectId: "p-other" } }), live({ now: NOW + GENERATION_PROPOSAL_TTL_MS }), live({ headMark: null }), live({ baseDigest: "eng1-00" })]) {
      const outcome = generationProposalCurrency(proposal, refusal);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.detail).toMatch(/nothing was changed|was not offered/i);
    }
  });
});

describe("[PR-D page intake 5] no new control", () => {
  it("the committed B17 control inventory names neither the intake's case nor its function", () => {
    expect(inventory).not.toContain("generation_proposal");
    expect(inventory).not.toContain("offerGenerationProposal");
  });
});
