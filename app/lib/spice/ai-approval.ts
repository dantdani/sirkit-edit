/**
 * [B22-A1] OD-150, the approval half: the ONE table of SPICE AI operation approval levels. The AI route labels each recorded
 * operation with it (app/api/spice/ai/route.ts `approvalFor`), and the studio pre-selects through it (SpiceStudio.tsx).
 *
 * Every operation whose strings reach an ngspice deck, and the run request, is "review": the studio never pre-selects it, so a
 * human selects each before Apply. Only an operation that never reaches a deck is "automatic" (a measurement or a
 * specification: evaluated in-process after a run by measurements.ts, never written to a deck - SEC-1 pins that a measurement
 * expression is never written). A production design patch is "explicit" (applyOperation refuses it outright). The evidence
 * half of OD-150 (D22-21: evidence references built from browser-supplied run records) is NOT here.
 */
import type { AiStudioOperation, AiStudioProposal, ApprovalLevel } from "./types";

export const SPICE_AI_APPROVAL: Readonly<Record<AiStudioOperation["op"], ApprovalLevel>> = Object.freeze({
  "create-test": "review", // the test's name is the deck title and every run point's label
  "duplicate-test": "review", // the copy's name is the deck title
  "assign-model": "review", // the bound model's text and pin map write the part's element lines
  "add-overlay-element": "review", // element names, values and waveforms are deck lines
  "set-variable": "review", // a `.param` line
  "configure-analysis": "review", // the analysis directive
  "configure-sweep": "review", // run point values and labels
  "configure-corners": "review", // run point values, temperatures and labels
  "set-solver-profile": "review", // `.options` lines
  "request-run": "review", // applying it starts the run plan
  "define-measurement": "automatic", // never written to a deck: evaluated in-process after the run
  "define-specification": "automatic", // never written to a deck: a pass/fail limit on a measurement
  "propose-design-patch": "explicit", // never applied by the studio: explicit schematic-editor confirmation
});

/** [B22-A1] The level of one operation; an unknown kind (a forged proposal) is "explicit", never pre-selected. */
export function spiceAiApproval(operation: AiStudioOperation): ApprovalLevel {
  return SPICE_AI_APPROVAL[operation.op] ?? "explicit";
}

/** [B22-A1] The indexes the studio pre-selects: an entry whose recorded level AND whose kind's level are both "automatic", so a
 *  proposal can never pre-select a deck-reaching operation or a run request, whatever level it carries. */
export function preselectedOperationIndexes(proposal: Pick<AiStudioProposal, "operations">): number[] {
  return proposal.operations.flatMap((entry, index) => (entry.approval === "automatic" && SPICE_AI_APPROVAL[entry.operation.op] === "automatic" ? [index] : []));
}
