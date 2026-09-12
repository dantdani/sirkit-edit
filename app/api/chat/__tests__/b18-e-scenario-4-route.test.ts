/**
 * [B18-E E15] Scenario 4 from the SENTENCE: "Delete U1 and replace it with the approved lower-power part while preserving
 * compatible nets."
 *
 * B14 proved the sealed replacement artifact, the gateway's closed argument surface and the human apply, densely. What it
 * never proved is the scenario: its only route-level case hard-codes `{componentId: "u1-id"}` and sends the message
 * "replace U1 with the verified part" — so nothing showed an agent turning the runbook's words into a proposal, and until
 * E15 the composer did not even send that sentence to the assistant.
 *
 * Here the scripted provider does what a model must: it reads the schematic to find which component "U1" is, and only then
 * names it. It never names the replacement part — it cannot: the tool takes `{componentId}` and the server reads the target
 * from the project's own component authority. That is the whole point of the scenario, so it is asserted, not assumed:
 * every asset identity in the sealed proposal comes from the authority fixture the server owns.
 *
 * "the approved lower-power part": the authority record carries no power fact of any kind, so no surface may call the
 * target lower-power. What the run can truthfully say — and what the page's own sentence says — is which part the
 * authority records, and that nothing has changed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { pcbBoardInstanceId, PCB_BOARD_HIERARCHY_PATH } from "@/app/lib/pcb/board-identity";
import type { KicadPin } from "@/app/lib/kicad/types";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";
import { REPLACEMENT_PROPOSAL_SCHEMA, type SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import { replacementChatLines } from "@/app/lib/project/chat-run-view";
import { routeComposerMessage } from "@/app/lib/project/composer-routing";
import {
  FIXTURE_AUTHORITY_VARIANT,
  FIXTURE_EXACT,
  matchingAtomicConfirmer,
  validApprovedAggregate,
} from "@/app/lib/engineering/__tests__/_authority-fixtures";

const SENTENCE = "Delete U1 and replace it with the approved lower-power part while preserving compatible nets.";
const COMPONENT = "u1-id";
const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };

/** What the scripted provider saw and did, so the test can assert the ORDER and the arguments it actually sent. */
const agent: { tools: string[][]; calls: Array<{ toolId: string; args: unknown }>; results: string[]; answer: string } = { tools: [], calls: [], results: [], answer: "" };

vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start(input: { userMessage: string; tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
      agent.tools.push(input.tools.map((tool) => tool.toolId));
      // The sentence names a reference designator, not an id. The model must READ the schematic to resolve it.
      const inspect = input.tools.find((tool) => tool.toolId === "sirkit.schematic.inspect");
      if (!inspect) return { text: "(scripted) I cannot see the schematic.", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
      agent.calls.push({ toolId: inspect.toolId, args: {} });
      return { text: "", toolCalls: [{ callId: "call-read", providerName: inspect.providerName, argumentsText: "{}" }], stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
    },
    async continueWith(input: { results: ReadonlyArray<{ outputText: string }>; tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
      const outputText = input.results[0]?.outputText ?? "";
      agent.results.push(outputText);
      const done = (text: string) => { agent.answer = text; return { text, toolCalls: [], stopReason: "completed" as const, usage: {}, model: "scripted", continuation: { provider: "openai" as const, state: null } }; };
      if (agent.calls.length === 1) {
        const parsed = JSON.parse(outputText) as { output?: { report?: { components?: Array<{ id: string; displayRef: string }> } } };
        const found = (parsed.output?.report?.components ?? []).find((component) => component.displayRef === "U1");
        const replacement = input.tools.find((tool) => tool.toolId === "sirkit.schematic.propose-component-replacement");
        if (!found || !replacement) return done("(scripted) I cannot prepare that replacement.");
        agent.calls.push({ toolId: replacement.toolId, args: { componentId: found.id } });
        return { text: "", toolCalls: [{ callId: "call-propose", providerName: replacement.providerName, argumentsText: JSON.stringify({ componentId: found.id }) }], stopReason: "tool_use" as const, usage: {}, model: "scripted", continuation: { provider: "openai" as const, state: null } };
      }
      // The closing sentence is built from the sealed result only — it names the part the AUTHORITY chose and makes no
      // claim the record cannot support.
      const sealed = JSON.parse(outputText) as { ok?: boolean; status?: string };
      return done(sealed.ok === true ? "(scripted) A replacement proposal is ready for your review. Nothing has been changed." : "(scripted) I could not prepare that replacement.");
    },
  }),
}));

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import {
  resetComponentAuthoritySourceFactory,
  setComponentAuthoritySourceFactory,
} from "../component-authority-runtime";
import {
  resetReplacementPinFactsSourceFactory,
  setReplacementPinFactsSourceFactory,
} from "../replacement-facts-runtime";

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];

function pinFacts(rev: string, symbol: string, certificateId: string): PublishedSymbolPinFacts {
  const ids = PINS.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...PINS],
    certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: FIXTURE_EXACT.footprintAssetVersionId, symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" },
    symbolPinIds: ids,
  };
}
const CURRENT_FACTS = pinFacts("rev-current", "sym-current", "cert-current");
const TARGET_FACTS = pinFacts(FIXTURE_EXACT.atomicPartRevisionId, FIXTURE_EXACT.symbolAssetVersionId, FIXTURE_EXACT.mappingCertificateId);

const SCHEMATIC: SchematicState = {
  components: [],
  wires: [],
  netLabels: [],
  kicadComponents: [{ id: COMPONENT, partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" }],
};

const ROUTE_BOARD_SCOPE = {
  ...SCOPE,
  boardInstanceId: pcbBoardInstanceId(SCOPE.projectId),
  hierarchyPath: [...PCB_BOARD_HIERARCHY_PATH],
  assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT],
};

function chatBody() {
  const board = createEmptyBoard();
  return {
    provider: "openai",
    messages: [{ role: "user", content: SENTENCE }],
    scope: SCOPE,
    schematicState: SCHEMATIC,
    schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(SCHEMATIC, SCOPE) },
    editorContext: {
      schema: EDITOR_CONTEXT_SCHEMA,
      scope: SCOPE,
      board,
      pcbRevisionId: pcbRevisionId(board),
      selection: { refs: [], primary: null },
      netlist: null,
      schematicDigest: schematicStateDigest(SCHEMATIC),
      authoritySource: "local-working-copy",
    },
  };
}

async function runChat(): Promise<Array<{ type: string; proposal?: unknown }>> {
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(chatBody()),
  }));
  expect(response.status).toBe(200);
  const text = await response.text();
  return text.trim().split("\n").map((line) => JSON.parse(line) as { type: string; proposal?: unknown });
}

function installAuthority(): Promise<void> {
  return validApprovedAggregate(COMPONENT, { scopeOverrides: ROUTE_BOARD_SCOPE }).then((aggregate) => {
    setComponentAuthoritySourceFactory(() => ({
      bindings: { async loadForComponent() { return [aggregate]; } },
      atomic: matchingAtomicConfirmer(),
    }));
    setReplacementPinFactsSourceFactory(() => ({
      loadPinFacts: async (revision) => (revision === "rev-current" ? CURRENT_FACTS : revision === FIXTURE_EXACT.atomicPartRevisionId ? TARGET_FACTS : null),
    }));
  });
}

describe("[B18-E E15] scenario 4 — the runbook's sentence, through the real chat route", () => {
  afterEach(() => {
    resetComponentAuthoritySourceFactory();
    resetReplacementPinFactsSourceFactory();
    agent.tools = []; agent.calls = []; agent.results = []; agent.answer = "";
  });

  it("the sentence reaches the assistant at all — the composer no longer sends it to the schematic editor", () => {
    expect(routeComposerMessage(SENTENCE, true).route).toBe("ask");
  });

  it("the run RESOLVES the reference designator by reading, then names only the component — and the server chooses the part", async () => {
    await installAuthority();
    const events = await runChat();

    // Read first, propose second: the model never invents an id for a refDes it was told in words.
    expect(agent.calls.map((call) => call.toolId)).toEqual(["sirkit.schematic.inspect", "sirkit.schematic.propose-component-replacement"]);
    expect(agent.calls[1]!.args, "the ONLY argument it can send is which component to replace").toEqual({ componentId: COMPONENT });

    const ready = events.find((event) => event.type === "proposal_ready");
    expect(ready, JSON.stringify(events.map((event) => event.type))).toBeTruthy();
    const proposal = ready!.proposal as SealedReplacementProposal;
    expect(proposal.schema).toBe(REPLACEMENT_PROPOSAL_SCHEMA);
    expect(proposal.componentInstanceId).toBe(COMPONENT);
    // Every identity in the target came from the server-owned authority; none of it was ever in the model's arguments.
    expect(proposal.target).toMatchObject({
      partId: FIXTURE_EXACT.exactMpn,
      atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId,
      symbolAssetVersionId: FIXTURE_EXACT.symbolAssetVersionId,
      footprintAssetVersionId: FIXTURE_EXACT.footprintAssetVersionId,
      mappingCertificateId: FIXTURE_EXACT.mappingCertificateId,
    });
    expect(JSON.stringify(agent.calls), "the model never named the part, the revision or any asset").not.toContain(FIXTURE_EXACT.exactMpn);
    expect(JSON.stringify(agent.calls)).not.toContain(FIXTURE_EXACT.atomicPartRevisionId);
  });

  it("'preserving compatible nets' is a stated outcome, not a hope: connections are mapped by pin identity and NONE are dropped", async () => {
    await installAuthority();
    const events = await runChat();
    const proposal = events.find((event) => event.type === "proposal_ready")!.proposal as SealedReplacementProposal;
    expect(proposal.impact.droppedConnections, "a replacement that would drop a connected pin never seals").toEqual([]);
    expect(proposal.impact.mappingEvidence).toBe("exact-pin-identity+certificate");
    for (const entry of proposal.impact.pinMapping) expect(entry.fromPin, JSON.stringify(entry)).toBe(entry.toPin);
  });

  it("nothing is changed and nothing is granted: one sealed proposal, no execution grant, the schematic byte-identical", async () => {
    await installAuthority();
    const digestBefore = schematicStateDigest(SCHEMATIC);
    const events = await runChat();
    expect(events.filter((event) => event.type === "proposal_ready")).toHaveLength(1);
    expect(events.filter((event) => event.type === "execution_grant_ready" || event.type === "pcb_proposal_ready"), "a replacement is Tier 2: never a grant").toHaveLength(0);
    expect(events.some((event) => event.type === "run_completed")).toBe(true);
    expect(schematicStateDigest(SCHEMATIC)).toBe(digestBefore);
  });

  it("what the human is then told is the page's own sentence, built from the sealed proposal — the part the AUTHORITY records, and that nothing changed", async () => {
    await installAuthority();
    const events = await runChat();
    const proposal = events.find((event) => event.type === "proposal_ready")!.proposal as SealedReplacementProposal;
    const line = replacementChatLines.ready({
      partId: proposal.target.partId,
      manufacturer: proposal.target.manufacturer,
      preservedConnections: proposal.impact.preservedConnections.length,
      droppedConnections: proposal.impact.droppedConnections.length,
    });
    expect(line).toContain(FIXTURE_EXACT.exactMpn);
    expect(line).toContain("the part this project's component authority records for this component");
    expect(line).toContain("none are dropped");
    expect(line).toContain("Nothing has been changed");
    // The person asked for "the approved lower-power part". No surface may call it that: the authority record carries no
    // power fact at all, so neither the page's sentence nor the tool result the model was handed contains such a claim.
    for (const text of [line, ...agent.results]) expect(text.toLowerCase(), text.slice(0, 120)).not.toContain("lower-power");
    for (const text of agent.results) expect(text.toLowerCase()).not.toMatch(/\b(?:milliamp|quiescent|power consumption)\b/);
  });

  it("without the authority source there is no target to propose: the tool is withheld and the run changes nothing", async () => {
    setComponentAuthoritySourceFactory(() => null);
    const events = await runChat();
    expect(agent.tools[0]).not.toContain("sirkit.schematic.propose-component-replacement");
    expect(events.some((event) => event.type === "proposal_ready")).toBe(false);
    expect(events.some((event) => event.type === "run_completed")).toBe(true);
    expect(schematicStateDigest(SCHEMATIC)).toBe(schematicStateDigest(chatBody().schematicState));
  });
});
