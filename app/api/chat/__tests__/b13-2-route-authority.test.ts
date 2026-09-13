/**
 * B13.2 §E — ACTUAL `/api/chat` integration for the server-owned
 * component-authority path.
 *
 * These tests call the REAL exported POST handler. Only two server-only
 * dependencies are controlled: the provider adapter (a scripted adapter
 * replaces the network, as every B10/B11 route test does) and the durable
 * authority source. Scope validation, the shared board identity, the real
 * resolver, the real authority loader, real context assembly, real resource
 * sealing, and the real run toolset all execute unmodified.
 *
 * The proofs here are BEHAVIOURAL (what the running handler does with a
 * request), not source-string assertions.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { pcbBoardInstanceId, PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH } from "@/app/lib/pcb/board-identity";
import type {
  AuthorityBindingAggregate,
  AuthorityComponentScope,
  ComponentAuthoritySourceDeps,
} from "@/app/lib/engineering/component-authority-source";
import {
  FIXTURE_AUTHORITY_VARIANT,
  matchingAtomicConfirmer,
  validApprovedAggregate,
} from "@/app/lib/engineering/__tests__/_authority-fixtures";

/** The scripted provider adapter: reports the EXACT run toolset it received
 *  and records whether the provider was invoked at all. */
const providerCalls = { start: 0 };
vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start(input: { tools: ReadonlyArray<{ toolId: string }> }) {
      providerCalls.start += 1;
      return {
        text: `TOOLS:${input.tools.map((tool) => tool.toolId).sort().join(";")}`,
        toolCalls: [], stopReason: "completed", usage: {}, model: "scripted",
        continuation: { provider: "openai", state: null },
      };
    },
    async continueWith() { throw new Error("not used"); },
  }),
}));

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import {
  resetComponentAuthoritySourceFactory,
  setComponentAuthoritySourceFactory,
} from "../component-authority-runtime";

const COMPONENT = "u1-id";
const SCOPE = { tenantId: "local", projectId: "p132", branchId: "main" };
const AUTHORITY_TOOL = "sirkit.component-authority.inspect";
const SCHEMATIC: SchematicState = {
  components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }],
  wires: [],
  kicadComponents: [{ id: COMPONENT, partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU" }],
};

/** The durable scope the ROUTE must derive for this project — the shared
 *  board identity, hierarchy, and variant. Aggregates are built under it. */
const ROUTE_BOARD_SCOPE = {
  tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId,
  boardInstanceId: pcbBoardInstanceId(SCOPE.projectId),
  hierarchyPath: [...PCB_BOARD_HIERARCHY_PATH],
  assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT],
};

function editorContext(): Record<string, unknown> {
  const board = createEmptyBoard();
  return {
    schema: EDITOR_CONTEXT_SCHEMA,
    scope: SCOPE,
    board,
    pcbRevisionId: pcbRevisionId(board),
    selection: { refs: [], primary: null },
    netlist: null,
    schematicDigest: schematicStateDigest(SCHEMATIC),
    authoritySource: "local-working-copy",
  };
}

const BASE = {
  provider: "openai",
  messages: [{ role: "user", content: "what authority exists for U1?" }],
  scope: SCOPE,
  schematicState: SCHEMATIC,
};

/**
 * [B19-E E3] harness fix, not a pin move: the test holds every Request it sends until the test ends, as the server does
 * while a handler runs. A Request relays its init signal's abort through an AbortController only the Request references;
 * once the route has taken `request.signal`, nothing else holds the Request, so a garbage collection inside 23b's 25 ms
 * window dropped the relay and the abort reached the route only at the 5 s authority deadline. Proven in isolation (a
 * forced collection reproduced the 5 s settlement with the Request dropped and a 1 ms settlement with it held).
 */
const inFlightRequests: Request[] = [];
function post(body: unknown, init?: { signal?: AbortSignal }): Promise<Response> {
  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  inFlightRequests.push(request);
  return POST(request);
}

/** Drive the real handler and return the toolset the provider actually
 *  received (empty when the run never reached the provider). */
async function runTools(body: unknown): Promise<{ tools: string[]; status: number; events: Array<{ type: string; reason?: string }> }> {
  const response = await post(body);
  const text = await response.text();
  const events = text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line) as { type: string; reason?: string; finalText?: string }) : [];
  const completed = events.find((event) => event.type === "run_completed") as { finalText?: string } | undefined;
  const finalText = completed?.finalText ?? "";
  const tools = finalText.startsWith("TOOLS:") ? finalText.slice("TOOLS:".length).split(";").filter(Boolean) : [];
  return { tools, status: response.status, events };
}

/** A durable source that records the EXACT scope the route asked for. */
function recordingSource(aggregates: readonly AuthorityBindingAggregate[], opts?: { throwOnLoad?: boolean }): {
  deps: ComponentAuthoritySourceDeps; scopes: AuthorityComponentScope[];
} {
  const scopes: AuthorityComponentScope[] = [];
  return {
    scopes,
    deps: {
      bindings: {
        async loadForComponent(scope) {
          scopes.push(scope);
          if (opts?.throwOnLoad) throw new Error("PB_DB_DOWN");
          return aggregates;
        },
      },
      atomic: matchingAtomicConfirmer(),
    },
  };
}

describe("B13.2 §E — the ACTUAL /api/chat handler proves the production authority path", () => {
  afterEach(() => { resetComponentAuthoritySourceFactory(); providerCalls.start = 0; inFlightRequests.length = 0; });

  it("19. a matching durable aggregate becomes the sealed resource and exposes the tool in the REAL run toolset", async () => {
    const aggregate = await validApprovedAggregate(COMPONENT, { scopeOverrides: ROUTE_BOARD_SCOPE });
    const source = recordingSource([aggregate]);
    setComponentAuthoritySourceFactory(() => source.deps);

    const { tools, status } = await runTools({ ...BASE, editorContext: editorContext() });
    expect(status).toBe(200);
    // (1) authenticated scope accepted, (3) real resolver + loader ran,
    // (4) the aggregate became the sealed resource, (5) the tool is in the
    // ACTUAL toolset the provider received.
    expect(tools).toContain(AUTHORITY_TOOL);
    expect(tools).toContain("sirkit.pcb.board-inspect");

    // (2) the route calculated the SHARED board identity, hierarchy, and
    // variant — and asked for the schematic's component instance.
    expect(source.scopes).toEqual([{
      tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId,
      boardInstanceId: pcbBoardInstanceId(SCOPE.projectId),
      componentInstanceId: COMPONENT,
      hierarchyPath: [...PCB_BOARD_HIERARCHY_PATH],
      assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID,
    }]);
  });

  it("20. a component / hierarchy / variant mismatch withholds the tool through the real handler", async () => {
    for (const [label, aggregate] of [
      ["component", await validApprovedAggregate("component-somewhere-else", { scopeOverrides: ROUTE_BOARD_SCOPE })],
      ["hierarchy", await validApprovedAggregate(COMPONENT, { scopeOverrides: { ...ROUTE_BOARD_SCOPE, hierarchyPath: ["root", "power"] } })],
      ["variant", await validApprovedAggregate(COMPONENT, { scopeOverrides: { ...ROUTE_BOARD_SCOPE, assemblyVariantIds: ["variant-alt"] } })],
      ["board", await validApprovedAggregate(COMPONENT, { scopeOverrides: { ...ROUTE_BOARD_SCOPE, boardInstanceId: "board-somewhere-else" } })],
    ] as const) {
      const source = recordingSource([aggregate]);
      setComponentAuthoritySourceFactory(() => source.deps);
      const { tools, status } = await runTools({ ...BASE, editorContext: editorContext() });
      expect(status, label).toBe(200);
      expect(tools, label).not.toContain(AUTHORITY_TOOL);
      expect(tools, label).toContain("sirkit.pcb.board-inspect"); // the run continues
    }
  });

  it("21. a database failure withholds the tool while unrelated read tools remain available", async () => {
    const source = recordingSource([], { throwOnLoad: true });
    setComponentAuthoritySourceFactory(() => source.deps);
    const { tools, status } = await runTools({ ...BASE, editorContext: editorContext() });
    expect(status).toBe(200);
    expect(tools).not.toContain(AUTHORITY_TOOL);
    expect(tools).toContain("sirkit.pcb.board-inspect");
    expect(tools).toContain("sirkit.schematic.inspect");
  });

  it("22. browser-provided authority fields cannot alter the resource (refused by name, or ignored)", async () => {
    const aggregate = await validApprovedAggregate(COMPONENT, { scopeOverrides: ROUTE_BOARD_SCOPE });
    // No durable source configured for this request: the resource must be
    // withheld regardless of what the body claims.
    setComponentAuthoritySourceFactory(() => null);

    // (a) a top-level authority claim REFUSES the request outright.
    const topLevel = await post({ ...BASE, componentAuthority: { records: [{ componentId: COMPONENT }] } });
    expect(topLevel.status).toBe(400);
    expect(((await topLevel.json()) as { error: string }).error).toContain("unexpected request key");

    // (b) an authority-shaped key inside editorContext refuses BY NAME.
    const nested = await post({ ...BASE, editorContext: { ...editorContext(), authority: { records: [] } } });
    expect(nested.status).toBe(400);
    expect(((await nested.json()) as { error: string }).error).toContain("authority-shaped key");

    // (c) a forged durable authoritySource refuses.
    const forged = await post({ ...BASE, editorContext: { ...editorContext(), authoritySource: "durable-server-board" } });
    expect(forged.status).toBe(400);

    // (d) with the source withheld, no body content can expose the tool.
    const { tools } = await runTools({ ...BASE, editorContext: editorContext() });
    expect(tools).not.toContain(AUTHORITY_TOOL);
    void aggregate;
  });

  it("23. an already-aborted request settles the route WITHOUT waiting for the authority deadline and never invokes the provider", async () => {
    // A durable source that NEVER settles: if the route waited on it (or on
    // the 5s authority deadline), this test could not finish quickly.
    const hanging: ComponentAuthoritySourceDeps = {
      bindings: { loadForComponent: () => new Promise<AuthorityBindingAggregate[]>(() => {}) },
      atomic: matchingAtomicConfirmer(),
    };
    setComponentAuthoritySourceFactory(() => hanging);

    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    const response = await post({ ...BASE, editorContext: editorContext() }, { signal: controller.signal });
    const text = await response.text();
    const elapsed = Date.now() - started;

    // Settled well inside the 5s authority deadline (no deadline wait).
    expect(elapsed).toBeLessThan(2_000);
    const events = text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line) as { type: string; reason?: string }) : [];
    const failed = events.find((event) => event.type === "run_failed");
    expect(failed?.reason).toBe("cancelled");
    // (10) the provider is never invoked for an already-aborted request.
    expect(providerCalls.start).toBe(0);
  });

  it("23b. a MID-FLIGHT abort settles the route immediately while the durable source is still hanging", async () => {
    let sourceSawAbort = false;
    const hanging: ComponentAuthoritySourceDeps = {
      bindings: {
        loadForComponent(_scope, signal) {
          signal?.addEventListener("abort", () => { sourceSawAbort = true; });
          return new Promise<AuthorityBindingAggregate[]>(() => {}); // never settles
        },
      },
      atomic: matchingAtomicConfirmer(),
    };
    setComponentAuthoritySourceFactory(() => hanging);

    const controller = new AbortController();
    const started = Date.now();
    const pending = post({ ...BASE, editorContext: editorContext() }, { signal: controller.signal });
    // Abort WHILE the authority load is in flight (not pre-aborted).
    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();
    const response = await pending;
    await response.text();
    // The route settled on the abort, NOT on the 5s authority deadline.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(sourceSawAbort).toBe(true); // the durable source was actively cancelled
  });

  it("24. resource/tool exposure is consistent: the tool appears ONLY when the sealed resource exists", async () => {
    const aggregate = await validApprovedAggregate(COMPONENT, { scopeOverrides: ROUTE_BOARD_SCOPE });
    setComponentAuthoritySourceFactory(() => recordingSource([aggregate]).deps);
    const withResource = await runTools({ ...BASE, editorContext: editorContext() });
    expect(withResource.tools).toContain(AUTHORITY_TOOL);

    setComponentAuthoritySourceFactory(() => null);
    const withoutResource = await runTools({ ...BASE, editorContext: editorContext() });
    expect(withoutResource.tools).not.toContain(AUTHORITY_TOOL);
    // Every OTHER tool is identical — withholding is surgical.
    expect(withoutResource.tools).toEqual(withResource.tools.filter((tool) => tool !== AUTHORITY_TOOL));
  });

  it("25. the exposed run toolset is deterministic across identical authority-bearing requests", async () => {
    const aggregate = await validApprovedAggregate(COMPONENT, { scopeOverrides: ROUTE_BOARD_SCOPE });
    setComponentAuthoritySourceFactory(() => recordingSource([aggregate]).deps);
    const first = await runTools({ ...BASE, editorContext: editorContext() });
    const second = await runTools({ ...BASE, editorContext: editorContext() });
    expect(second.tools).toEqual(first.tools);
    expect(first.tools).toContain(AUTHORITY_TOOL);
  });
});
