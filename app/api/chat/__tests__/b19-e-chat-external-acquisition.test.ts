/**
 * [B19-E E6] The chat route wires the external read tools through ONE approved runtime boundary
 * (`app/api/chat/external-acquisition-runtime.ts`): the server resolves a port (never the request body), passes the port to
 * the gateway and the availability fact to the context assembler, and the model sees the two tools only when both exist.
 * A FAKE port stands in for the server one: no vendor, no network, no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import type { ExternalAcquisitionReadPort, ExternalSearchPortRequest } from "@/app/lib/agent/acquisition-reads";

const SCOPE = { tenantId: "local", projectId: "p19e6", branchId: "main" };
const BOARD = JSON.parse(JSON.stringify(makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2)));
const SCHEMATIC: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [{ id: "k1", partId: "lib:ne555", x: 100, y: 100, rotation: 0, refDes: "U1", value: "NE555" }] };
const BASIS = { historyHeadSequence: 4, historyHeadLabel: null, lineageId: "lin1-0000000000000001", activeDrcPresetId: DEFAULT_PRESET_ID };

const seen = vi.hoisted(() => ({ tools: [] as string[][], results: [] as string[] }));

vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start(input: { tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
      seen.tools.push(input.tools.map((tool) => tool.toolId));
      const search = input.tools.find((tool) => tool.toolId === "sirkit.parts.external-search");
      if (!search) return { text: "no search tool", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
      return { text: "", toolCalls: [{ callId: "c-search", providerName: search.providerName, argumentsText: JSON.stringify({ mpns: ["NE555P"] }) }], stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
    },
    async continueWith(input: { results: ReadonlyArray<{ outputText: string }> }) {
      seen.results.push(...input.results.map((result) => result.outputText));
      return { text: "Here is what the distributors say.", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
    },
  }),
}));

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import { resetExternalAcquisitionPortFactory, resolveExternalAcquisitionPort, setExternalAcquisitionPortFactory } from "../external-acquisition-runtime";

function body(extra: Record<string, unknown> = {}) {
  return {
    provider: "openai", messages: [{ role: "user", content: "Is NE555P available?" }], scope: SCOPE, schematicState: SCHEMATIC,
    editorContext: {
      schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board: BOARD, pcbRevisionId: pcbRevisionId(BOARD), selection: { refs: [], primary: null }, netlist: null,
      schematicDigest: schematicStateDigest(SCHEMATIC), authoritySource: "local-working-copy", pcbProposalBasis: BASIS,
    },
    ...extra,
  };
}

function fakePort() {
  const requests: ExternalSearchPortRequest[] = [];
  const port: ExternalAcquisitionReadPort = {
    async searchExactMpns(request) {
      requests.push(request);
      return { registryVersion: "1.1.0", liveMpnsUsed: 0, sources: [{ sourceId: "octopart", status: "available", retryAt: null, disclosure: "labels_only" }], observations: request.mpns.map((mpn) => ({ mpn, sourceId: "octopart", outcome: "not_cached" as const, servedFrom: null, retrievedAt: null, expiresAt: null, exactMatch: false })) };
    },
    async readEvidence() { throw new Error("not used"); },
  };
  return { port, requests };
}

const post = async (payload: unknown) => {
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
  return { status: response.status, events: (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; toolId?: string; status?: string }) };
};

beforeEach(() => {
  seen.tools.length = 0;
  seen.results.length = 0;
});
afterEach(() => {
  resetExternalAcquisitionPortFactory();
  vi.unstubAllEnvs();
});

describe("[B19-E E6] chat wiring through the one approved runtime boundary", () => {
  it("with a server port the model sees both tools, a search runs with the trusted scope and returns labels", async () => {
    const fake = fakePort();
    const policies: unknown[] = [];
    setExternalAcquisitionPortFactory((policy) => { policies.push(policy); return fake.port; });
    const { status, events } = await post(body());
    expect(status).toBe(200);
    expect(seen.tools[0]).toEqual(expect.arrayContaining(["sirkit.parts.external-search", "sirkit.parts.evidence-read"]));
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ mpns: ["NE555P"], scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId } });
    expect(policies).toEqual([{ live: true }]);
    expect(events.find((event) => event.type === "tool_finished")).toMatchObject({ toolId: "sirkit.parts.external-search", status: "succeeded" });
    expect(seen.results[0]).toContain("not engineering authority");
  });

  it("without a server port (the production default without a database) the tools are withheld and nothing is asked", async () => {
    resetExternalAcquisitionPortFactory();
    // the production default decides on the server's own environment: stubbed here, so the shell this suite runs in (with or
    // without a DATABASE_URL) never decides the outcome; the resolver's three states are pinned in b19-e-agent-read-port.test.ts
    vi.stubEnv("DATABASE_URL", "");
    await post(body());
    expect(seen.tools[0]).not.toContain("sirkit.parts.external-search");
    expect(seen.tools[0]).not.toContain("sirkit.parts.evidence-read");
  });

  it("a factory that throws fails closed to no tools; a board-less request never advertises them", async () => {
    setExternalAcquisitionPortFactory(() => { throw new Error("port construction failed"); });
    expect(resolveExternalAcquisitionPort({ live: true })).toBeNull();
    await post(body());
    expect(seen.tools[0]).not.toContain("sirkit.parts.external-search");

    const fake = fakePort();
    setExternalAcquisitionPortFactory(() => fake.port);
    const boardless = body();
    delete (boardless as { editorContext?: unknown }).editorContext;
    await post(boardless);
    expect(seen.tools[1]).not.toContain("sirkit.parts.external-search");
    expect(fake.requests).toHaveLength(0);
  });

  it("the request body can never claim the fact or the port", async () => {
    const fake = fakePort();
    setExternalAcquisitionPortFactory(() => fake.port);
    for (const key of ["externalAcquisition", "externalAcquisitionAvailable"]) {
      const { status } = await post(body({ [key]: true }));
      expect(status, key).toBe(400);
    }
    expect(fake.requests).toHaveLength(0);
  });
});
