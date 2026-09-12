/**
 * [B18-E E12] Scenario 2, part 1 — Tier 2 truth in the REVIEW and in the CHAT.
 *
 * "Change every via on the 5 V net to 0.7 mm diameter and 0.35 mm drill." is a Tier 2 sealed proposal a human applies
 * (OD-13); nothing here can be granted. B18-C proved the COMPILER refuses and accepts the right via operations. What the
 * discovery for this increment found is that the two human-facing surfaces did not carry that truth:
 *
 *  1. THE REVIEW. The dialog the human approves listed the via operation as the bare `Update via v1` — neither the new
 *     diameter nor the new drill appeared anywhere on the surface. The human was asked to approve exactly the numbers the
 *     dialog did not show, while its siblings (`Move R3 to (x, y) mm`, `Add 0.400 mm track …`) do state theirs.
 *  2. THE CHAT. A blocked proposal rendered as `T2 · Propose bounded PCB edits — refused (proposal_blocked)`: a code, with
 *     no statement that nothing was changed and no trace of the compiler's reason. The truthful sentence (which via, which
 *     padstack, which human fix) went to the MODEL only, so whether the human learned it depended on the model's prose —
 *     the one thing B18-D decided the page must never rely on.
 *
 * Both are fixed here, and this file also pins the facts scenario 2 stands on, because they are the reason the refusal —
 * not the edit — is its normal outcome: board LOAD binds every via to a padstack, and 0.7/0.35 is not a padstack that
 * exists, nor one any proposal can create.
 */
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PcbProposalReviewDialog } from "@/app/components/pcb/PcbProposalReviewDialog";
import type { SealedPcbEditProposal } from "../../pcb/proposal/sealed-pcb-edit-proposal";
import { createEmptyBoard, type PcbBoard } from "../../pcb/types";
import { getPreset, DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { pcbRevisionId } from "../../pcb/revision";
import { compileBoundedPcbEdit } from "../../pcb/proposal/bounded-edit-compiler";
import { BOUNDED_EDIT_OPERATION_KINDS } from "../../pcb/proposal/bounded-edit-operations";
import { ensureBoardPadstacks } from "../../pcb/padstack/migrate";
import { DEFAULT_PADSTACKS } from "../../pcb/padstack/defaults";
import { LABEL_BEFORE_REVIEW, initialRunView, projectRunView, reduceRunView, toolLineLabel } from "../../project/chat-run-view";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../../agent/contracts";
import { AGENT_SYSTEM_PROMPT } from "../../prompts";
import { sirkitToolRegistry } from "../tool-catalog";

afterEach(cleanup);

const RULES = getPreset(DEFAULT_PRESET_ID).rules;
const LAYERS: ["copperTop", "copperBottom"] = ["copperTop", "copperBottom"];

/** Two vias on a net the user would call the 5 V net, one on another net — as an unsaved working board carries them. */
function board(): PcbBoard {
  const base = createEmptyBoard();
  base.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  base.nets.push({ id: 1, name: "5V" }, { id: 2, name: "GND" });
  base.vias = [
    { id: "v1", at: { x: 30_000_000, y: 30_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: LAYERS },
    { id: "v2", at: { x: 40_000_000, y: 30_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: LAYERS },
    { id: "v3", at: { x: 50_000_000, y: 30_000_000 }, size: 600_000, drill: 300_000, netId: 2, layers: LAYERS },
  ];
  return base;
}

/** The same board as any real one: LOADED, i.e. through the padstack normalization board-persistence runs on every load. */
function loadedBoard(): PcbBoard {
  const source = board();
  ensureBoardPadstacks(source);
  return source;
}

const compile = (operations: unknown[], source: PcbBoard = board()) =>
  compileBoundedPcbEdit({ board: source, rules: RULES, baseIdentity: pcbRevisionId(source), payload: { intent: "resize the 5 V vias", operations } });

function summaries(operations: unknown[], source?: PcbBoard): readonly string[] {
  const result = compile(operations, source);
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.impact.operationSummaries;
}

describe("[B18-E E12] scenario 2 — the review states what the human is approving", () => {
  it("a via resize names the resultant pad and drill, not just the via id", () => {
    expect(summaries([{ kind: "update_via", viaId: "v1", sizeNm: 700_000, drillNm: 350_000 }])).toEqual(["Update via v1 — 0.700 mm pad / 0.350 mm drill"]);
  });

  it("a PARTIAL resize states the RESULTANT pair, so the human reads the via they will get, not the field that was sent", () => {
    // Only the pad is changed; the drill stays the board's 0.300 mm. Both numbers are what the human is approving.
    expect(summaries([{ kind: "update_via", viaId: "v1", sizeNm: 700_000 }])).toEqual(["Update via v1 — 0.700 mm pad / 0.300 mm drill"]);
  });

  it("a padstack retarget names the padstack AND the geometry it imposes; a move names the position and claims no resize", () => {
    const source = loadedBoard();
    const power = source.padstacks!.find((padstack) => padstack.id === "via-power")!;
    expect(summaries([{ kind: "update_via", viaId: "v1", padstackId: power.id }], source)).toEqual([`Update via v1 — padstack ${power.name} (0.800 mm pad / 0.400 mm drill)`]);
    expect(summaries([{ kind: "update_via", viaId: "v1", at: { x: 31_000_000, y: 32_000_000 } }], source)).toEqual(["Update via v1 — position (31.000, 32.000) mm"]);
  });

  it("every operation summary is a sentence about a change: an update_via that would say nothing never compiles", () => {
    // The parse layer refuses a no-op, so the summary can never degrade to a bare id with an empty tail.
    expect(compile([{ kind: "update_via", viaId: "v1" }])).toMatchObject({ ok: false, code: "invalid-value" });
    for (const summary of summaries([
      { kind: "update_via", viaId: "v1", sizeNm: 700_000, drillNm: 350_000 },
      { kind: "update_via", viaId: "v2", at: { x: 41_000_000, y: 30_000_000 }, sizeNm: 700_000 },
    ])) expect(summary, summary).toMatch(/^Update via v\d — \S.*\S$/);
  });
});

describe("[B18-E E12] scenario 2 — the chat says a blocked proposal changed nothing, and why", () => {
  const line = (input: Record<string, unknown>) => toolLineLabel({ title: "Propose bounded PCB edits", tier: 2, ok: false, ...input });

  it("a blocked proposal is plain words and states that nothing was changed — never a bare code", () => {
    const rendered = line({ status: "proposal_blocked" });
    expect(rendered).not.toContain("refused (proposal_blocked)");
    expect(rendered).toContain("nothing was changed");
    expect(rendered.startsWith("T2 · Propose bounded PCB edits — "), rendered).toBe(true);
  });

  it("the compiler's own reason is carried onto the line, so the human is not left depending on the model's prose", () => {
    const reason = "Operation 1 (update_via) changes the size/drill of via v1, which is bound to padstack Via 0.6/0.3 (via-default).";
    expect(line({ status: "proposal_blocked", reason })).toContain(reason);
  });

  it("a reason never lets a refusal read as a success, and an absent or hostile one degrades safely", () => {
    expect(line({ status: "proposal_blocked", reason: "" })).toContain("nothing was changed");
    expect(line({ status: "proposal_blocked", reason: 17 })).toContain("nothing was changed");
    const long = line({ status: "proposal_blocked", reason: "x".repeat(5_000) });
    expect(long.length, "the line stays a line").toBeLessThan(600);
    expect(toolLineLabel({ title: "Propose bounded PCB edits", tier: 2, ok: true, status: "proposal_sealed", reason: "ignored" }))
      .toBe("T2 · Propose bounded PCB edits — proposal sealed — awaiting your review");
  });
});

// ─── the facts scenario 2 rests on ───────────────────────────────────────────

describe("[B18-E E12] scenario 2 — the refusal is the NORMAL outcome, and 0.7/0.35 is out of reach", () => {
  it("board load binds every via to a padstack, so the literal sentence is refused padstack-bound on any real board", () => {
    const loaded = loadedBoard();
    expect(loaded.vias.every((via) => via.padstackId !== undefined), "every via is bound after a load").toBe(true);
    for (const viaId of ["v1", "v2"]) {
      const result = compile([{ kind: "update_via", viaId, sizeNm: 700_000, drillNm: 350_000 }], loaded);
      expect(result, viaId).toMatchObject({ ok: false, code: "padstack-bound" });
      expect((result as { detail: string }).detail, viaId).toMatch(/create-padstack/);
    }
    // The unbound shape the B15 fixtures use — the only one where the resize compiles — cannot survive a load.
    expect(compile([{ kind: "update_via", viaId: "v1", sizeNm: 700_000, drillNm: 350_000 }])).toMatchObject({ ok: true });
  });

  it("no seeded padstack is 0.7/0.35 and no proposal can create one, so the requested pair is reachable only by a human fork", () => {
    expect(DEFAULT_PADSTACKS.some((padstack) => padstack.outerNm === 700_000 && padstack.drillNm === 350_000)).toBe(false);
    expect(DEFAULT_PADSTACKS.map((padstack) => `${padstack.outerNm}/${padstack.drillNm}`)).toEqual(["600000/300000", "800000/400000", "1200000/600000"]);
    for (const kind of BOUNDED_EDIT_OPERATION_KINDS) expect(kind, kind).not.toMatch(/padstack/);
    // Retargeting is the only in-proposal route, and it can only land on geometry that already exists.
    const loaded = loadedBoard();
    const retarget = compile([{ kind: "update_via", viaId: "v1", padstackId: "via-power" }], loaded);
    if (!retarget.ok) throw new Error(retarget.code);
    expect(retarget.candidate.vias.find((via) => via.id === "v1")).toMatchObject({ padstackId: "via-power", size: 800_000, drill: 400_000 });
  });
});

// ─── the via payload through the real loop ───────────────────────────────────

const PCB_TOOL_NAME = "sirkit_pcb_propose-bounded-edit";
const BASIS = { historyHeadSequence: 0, historyHeadLabel: null, lineageId: "lin-b18-e12", activeDrcPresetId: DEFAULT_PRESET_ID };

function scriptedAdapter(args: unknown, answer: string): ProviderAgentAdapter {
  return {
    provider: "anthropic",
    async start(): Promise<AgentStep> {
      return { text: "", toolCalls: [{ callId: "call-1", providerName: PCB_TOOL_NAME, argumentsText: JSON.stringify(args) }], stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null } };
    },
    async continueWith(): Promise<AgentStep> {
      return { text: answer, toolCalls: [], stopReason: "end", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null } };
    },
  };
}

async function runVia(source: PcbBoard, operations: unknown[], answer: string): Promise<{ events: AgentRunEvent[]; revisionAfter: string }> {
  const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p18e12", branchId: "main", board: source, pcbProposalBasis: BASIS });
  if (!assembly.ok) throw new Error(assembly.reason);
  const registry = sirkitToolRegistry();
  const events: AgentRunEvent[] = [];
  const result = await runAgentLoop(
    { runId: "run-e12", provider: "anthropic", history: [], userMessage: "Change every via on the 5 V net to 0.7 mm diameter and 0.35 mm drill.", budget: DEFAULT_AGENT_BUDGET },
    {
      adapter: scriptedAdapter({ intent: "resize the 5 V vias", operations }, answer),
      gateway: createAgentToolGateway(registry, { now: () => 3_000_000 }),
      registry, context: assembly.context, system: AGENT_SYSTEM_PROMPT,
      emit: (event) => events.push(event), contextWarnings: assembly.warnings,
    },
  );
  expect(result.status).toBe("completed");
  return { events, revisionAfter: pcbRevisionId(assembly.context.canonicalState!.pcb) };
}

describe("[B18-E E12] scenario 2 — an update_via payload through the real loop and gateway", () => {
  it("seals ONE proposal, grants nothing, changes nothing, and the answer is labelled as written before any apply", async () => {
    const source = board();
    const before = pcbRevisionId(source);
    const { events, revisionAfter } = await runVia(source, [
      { kind: "update_via", viaId: "v1", sizeNm: 700_000, drillNm: 350_000 },
      { kind: "update_via", viaId: "v2", sizeNm: 700_000, drillNm: 350_000 },
    ], "Both 5 V vias are in a proposal for you to review.");
    expect(events.filter((event) => event.type === "pcb_proposal_ready")).toHaveLength(1);
    expect(events.filter((event) => event.type === "execution_grant_ready" || event.type === "proposal_ready")).toHaveLength(0);
    expect(revisionAfter, "a sealed proposal mutates nothing").toBe(before);
    const rows = (events as unknown as Array<Record<string, unknown>>).concat([{ type: "run_completed" }]);
    const view = projectRunView(rows.reduce(reduceRunView, initialRunView()));
    expect(view.label).toBe(LABEL_BEFORE_REVIEW);
    expect(view.answer.startsWith(LABEL_BEFORE_REVIEW), "the page's label opens the answer").toBe(true);
    const sealedLine = events.find((event) => event.type === "tool_finished" && event.status === "proposal_sealed")!;
    expect(toolLineLabel(sealedLine as unknown as Record<string, unknown>)).toBe("T2 · Propose bounded PCB edits — proposal sealed — awaiting your review");
  });

  it("the REAL review dialog shows the human the numbers they asked for, beside the promise that nothing has changed", async () => {
    const { events } = await runVia(board(), [
      { kind: "update_via", viaId: "v1", sizeNm: 700_000, drillNm: 350_000 },
      { kind: "update_via", viaId: "v2", sizeNm: 700_000, drillNm: 350_000 },
    ], "Both 5 V vias are in a proposal for you to review.");
    const ready = events.find((event) => event.type === "pcb_proposal_ready") as { proposal: SealedPcbEditProposal };
    render(<PcbProposalReviewDialog proposal={ready.proposal} busy={false} disableReason={null} onApply={() => { throw new Error("no click"); }} onCancel={() => { throw new Error("no cancel"); }} />);
    const operations = screen.getByTestId("pcb-proposal-operations").textContent ?? "";
    expect(operations).toContain("Operations (2)");
    expect(operations).toContain("1. Update via v1 — 0.700 mm pad / 0.350 mm drill");
    expect(operations).toContain("2. Update via v2 — 0.700 mm pad / 0.350 mm drill");
    expect(screen.getByText(/Nothing has been changed yet\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve and apply PCB edits" }).hasAttribute("disabled"), "the human's click is the only authority").toBe(false);
  });

  it("a padstack-bound via seals NOTHING and the run log carries the compiler's reason to the human", async () => {
    const source = loadedBoard();
    const before = pcbRevisionId(source);
    const { events, revisionAfter } = await runVia(source, [{ kind: "update_via", viaId: "v1", sizeNm: 700_000, drillNm: 350_000 }], "I could not prepare that change.");
    expect(events.filter((event) => event.type === "pcb_proposal_ready")).toHaveLength(0);
    expect(revisionAfter).toBe(before);
    const finished = events.find((event) => event.type === "tool_finished") as { ok: boolean; status: string; reason?: string } | undefined;
    expect(finished).toMatchObject({ ok: false, status: "proposal_blocked" });
    expect(finished!.reason, "the reason the model is given is the reason the page shows").toMatch(/padstack/);
    const rendered = toolLineLabel(finished as unknown as Record<string, unknown>);
    expect(rendered).toContain("nothing was changed");
    expect(rendered).toMatch(/padstack/);
  });
});
