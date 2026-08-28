/**
 * B14 — ACTUAL production integration: (52) a real `/api/chat` agent run
 * produces a sealed, non-mutating replacement proposal through the REAL
 * exported POST handler (scripted provider adapter, injected durable
 * seams); the reauthorization endpoint is read/prove-only with strict
 * browser-identity refusal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { pcbBoardInstanceId, PCB_BOARD_HIERARCHY_PATH } from "@/app/lib/pcb/board-identity";
import type { KicadPin } from "@/app/lib/kicad/types";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";
import { REPLACEMENT_PROPOSAL_SCHEMA, type SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import {
  FIXTURE_AUTHORITY_VARIANT,
  FIXTURE_EXACT,
  matchingAtomicConfirmer,
  validApprovedAggregate,
} from "@/app/lib/engineering/__tests__/_authority-fixtures";

/** Scripted provider: first turn calls the replacement tool, then completes. */
const adapterState: { toolsSeen: string[][]; started: number } = { toolsSeen: [], started: 0 };
vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start(input: { tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
      adapterState.started += 1;
      adapterState.toolsSeen.push(input.tools.map((tool) => tool.toolId));
      const replacement = input.tools.find((tool) => tool.toolId === "sirkit.schematic.propose-component-replacement");
      if (!replacement) {
        return { text: "no tool", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
      }
      return {
        text: "",
        toolCalls: [{ callId: "call-1", providerName: replacement.providerName, argumentsText: JSON.stringify({ componentId: "u1-id" }) }],
        stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "openai", state: null },
      };
    },
    async continueWith() {
      return { text: "done", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
    },
  }),
}));

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import { POST as REAUTH_POST } from "../../replacement-authority/route";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import {
  resetComponentAuthoritySourceFactory,
  setComponentAuthoritySourceFactory,
} from "../component-authority-runtime";
import {
  resetReplacementPinFactsSourceFactory,
  setReplacementPinFactsSourceFactory,
} from "../replacement-facts-runtime";

const COMPONENT = "u1-id";
const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };

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
    messages: [{ role: "user", content: "replace U1 with the verified part" }],
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

describe("B14 §H — the ACTUAL /api/chat handler produces the sealed replacement proposal", () => {
  afterEach(() => {
    resetComponentAuthoritySourceFactory();
    resetReplacementPinFactsSourceFactory();
    adapterState.toolsSeen = [];
    adapterState.started = 0;
  });

  it("52. a real agent run seals a replacement proposal, emits proposal_ready, and mutates nothing", async () => {
    // Server-owned seams: a REAL valid aggregate under the route-derived
    // board scope + published pin facts keyed by atomic revision.
    const aggregate = await validApprovedAggregate(COMPONENT, { scopeOverrides: ROUTE_BOARD_SCOPE });
    setComponentAuthoritySourceFactory(() => ({
      bindings: { async loadForComponent() { return [aggregate]; } },
      atomic: matchingAtomicConfirmer(),
    }));
    setReplacementPinFactsSourceFactory(() => ({
      loadPinFacts: async (revision) => (revision === "rev-current" ? CURRENT_FACTS : revision === FIXTURE_EXACT.atomicPartRevisionId ? TARGET_FACTS : null),
    }));

    const events = await runChat();
    const ready = events.find((event) => event.type === "proposal_ready");
    expect(ready, JSON.stringify(events.map((event) => event.type))).toBeTruthy();
    const proposal = ready!.proposal as SealedReplacementProposal;
    // B16.0.1 §E: the route now seals the v2 contract (authorization-bound).
    expect(proposal.schema).toBe(REPLACEMENT_PROPOSAL_SCHEMA);
    expect(proposal.componentInstanceId).toBe(COMPONENT);
    expect(proposal.target.partId).toBe(FIXTURE_EXACT.exactMpn);
    expect(proposal.target.atomicPartRevisionId).toBe(FIXTURE_EXACT.atomicPartRevisionId);
    expect(proposal.impact.droppedConnections).toEqual([]);
    // The ACTUAL run toolset contained the replacement tool (eleventh tool).
    expect(adapterState.toolsSeen[0]).toContain("sirkit.schematic.propose-component-replacement");
    // Receiving the proposal produced ZERO mutation events and one completed run.
    expect(events.some((event) => event.type === "run_completed")).toBe(true);
    expect(schematicStateDigest(SCHEMATIC)).toBe(schematicStateDigest(chatBody().schematicState));
  });

  it("52b. without the durable authority source the tool is withheld from the ACTUAL run", async () => {
    setComponentAuthoritySourceFactory(() => null);
    const events = await runChat();
    expect(events.some((event) => event.type === "proposal_ready")).toBe(false);
    expect(adapterState.toolsSeen[0]).not.toContain("sirkit.schematic.propose-component-replacement");
    expect(events.some((event) => event.type === "run_completed")).toBe(true);
  });
});

describe("B14 §E / B14.1 §C / B16.0.3 §A — the reauthorization endpoint is AUTHENTICATED, read/prove-only", () => {
  // [B16.0.3 §A] the route now authenticates FIRST; the trusted scope is
  // derived from the session/selector. Inject an authorized editor of the
  // project and send its selector. Fixtures live under local/<project>/main.
  const REAUTH_SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": "main" };
  beforeEach(() => { injectAuthorizedPrincipal({ userId: "reauth-editor", tenantId: "local", projectId: SCOPE.projectId, role: "editor" }); });
  afterEach(() => {
    resetInjectedIdentity();
    resetComponentAuthoritySourceFactory();
    resetReplacementPinFactsSourceFactory();
  });

  // The trusted scope is local/<project>/main; a body `scope` is an optional
  // post-authentication cross-check that must match it. Fixtures use it.
  const LOCAL_SCOPE = { tenantId: "local", projectId: SCOPE.projectId, branchId: "main" };
  const LOCAL_BOARD_SCOPE = { ...ROUTE_BOARD_SCOPE, tenantId: "local", branchId: "main" };

  function reauth(body: unknown): Promise<Response> {
    return REAUTH_POST(new Request("http://localhost/api/replacement-authority", {
      method: "POST", headers: { "Content-Type": "application/json", ...REAUTH_SELECTOR }, body: JSON.stringify(body),
    }));
  }

  it("returns the allowlisted bounded result with server-derived target facts", async () => {
    const aggregate = await validApprovedAggregate(COMPONENT, { scopeOverrides: LOCAL_BOARD_SCOPE });
    setComponentAuthoritySourceFactory(() => ({
      bindings: { async loadForComponent() { return [aggregate]; } },
      atomic: matchingAtomicConfirmer(),
    }));
    setReplacementPinFactsSourceFactory(() => ({
      loadPinFacts: async (revision) => (revision === "rev-current" ? CURRENT_FACTS : revision === FIXTURE_EXACT.atomicPartRevisionId ? TARGET_FACTS : null),
    }));
    const NONCE = "a1b2c3d4e5f60718a1b2c3d4e5f60718";
    const response = await reauth({ scope: LOCAL_SCOPE, componentInstanceId: COMPONENT, currentAtomicPartRevisionId: "rev-current", nonce: NONCE });
    expect(response.status).toBe(200);
    const payload = await response.json() as { ok: boolean; records: Array<{ componentId: string }>; currentPinFacts: unknown; targetPinFacts: { atomicPartRevisionId: string } };
    expect(payload.ok).toBe(true);
    expect(payload.records[0]!.componentId).toBe(COMPONENT);
    // The TARGET revision was derived server-side from the durable record.
    expect(payload.targetPinFacts.atomicPartRevisionId).toBe(FIXTURE_EXACT.atomicPartRevisionId);
    expect(Object.keys(payload).sort()).toEqual(["binding", "candidates", "currentPinFacts", "ok", "records", "targetPinFacts"]);
    // [B14.2 §C] the binding echoes the EXACT nonce + component + server scope.
    const binding = (payload as unknown as { binding: { nonce: string; componentInstanceId: string; scope: { tenantId: string; branchId: string } } }).binding;
    expect(binding.nonce).toBe(NONCE);
    expect(binding.componentInstanceId).toBe(COMPONENT);
    expect(binding.scope).toMatchObject({ tenantId: "local", branchId: "main" });
  });

  it("refuses browser-supplied asset identities and unknown keys BY NAME", async () => {
    for (const body of [
      { scope: LOCAL_SCOPE, componentInstanceId: COMPONENT, currentAtomicPartRevisionId: null, nonce: "a1b2c3d4e5f60718", targetAtomicPartRevisionId: "rev-attacker" },
      { scope: LOCAL_SCOPE, componentInstanceId: COMPONENT, currentAtomicPartRevisionId: null, nonce: "a1b2c3d4e5f60718", symbolAssetVersionId: "sym-attacker" },
      { scope: LOCAL_SCOPE, componentInstanceId: COMPONENT, currentAtomicPartRevisionId: null, nonce: "a1b2c3d4e5f60718", authority: { status: "verified" } },
    ]) {
      const response = await reauth(body);
      expect(response.status).toBe(400);
      expect((await response.json() as { error: string }).error).toContain("refused");
    }
  });

  it("[B16.0.3 §A] a body scope foreign to the AUTHENTICATED project NEVER reaches the durable loader", async () => {
    let loaderCalls = 0;
    setComponentAuthoritySourceFactory(() => ({
      bindings: { async loadForComponent() { loaderCalls += 1; return []; } },
      atomic: matchingAtomicConfirmer(),
    }));
    // The authenticated project is local/<project>/main (the selector); a body
    // scope naming a different tenant/branch is a smuggle → 403, loader untouched.
    for (const scope of [
      { tenantId: "tenant-1", projectId: SCOPE.projectId, branchId: "main" },
      { tenantId: "local", projectId: SCOPE.projectId, branchId: "release" },
    ]) {
      const response = await reauth({ scope, componentInstanceId: COMPONENT, currentAtomicPartRevisionId: null, nonce: "a1b2c3d4e5f60718" });
      expect(response.status, JSON.stringify(scope)).toBe(403);
      expect((await response.json() as { error: string }).error).toContain("does not match the authenticated project scope");
    }
    expect(loaderCalls).toBe(0);
  });

  it("[B14.1 §C] the request bound counts UTF-8 bytes, not JS characters", async () => {
    // ~9000 three-byte chars: 9000 JS chars but ~27000 UTF-8 bytes (> 16384).
    const padded = "€".repeat(9_000);
    const response = await reauth({ scope: { ...LOCAL_SCOPE, projectId: undefined }, componentInstanceId: padded, currentAtomicPartRevisionId: null, nonce: "a1b2c3d4e5f60718" });
    expect([400, 413]).toContain(response.status);
    const oversized = await REAUTH_POST(new Request("http://localhost/api/replacement-authority", {
      method: "POST", headers: { "Content-Type": "application/json", ...REAUTH_SELECTOR }, body: "€".repeat(9_000),
    }));
    expect(oversized.status).toBe(413);
  });

  it("fails closed (503) without a durable source and never mutates anything", async () => {
    setComponentAuthoritySourceFactory(() => null);
    const response = await reauth({ scope: LOCAL_SCOPE, componentInstanceId: COMPONENT, currentAtomicPartRevisionId: null, nonce: "a1b2c3d4e5f60718" });
    expect(response.status).toBe(503);
  });
});
