/**
 * [B20 D2] Name spellings at the dispatch, with an injected registry and no route: every renamed, re-typed, nested and
 * header-disagreeing spelling of a tool the server must never serve answers the SAME closed refusal, and nothing is served.
 *
 * This is a SPELLING attack, not a name collision. The runbook's "tool-name collision" item is the client half's, and on
 * that half it is a stated limit (`mcp-adversarial.md` §D1.4): two servers' provider names are never compared. The server
 * half has no name namespace to collide in — one registry, one exact match — which is what N1 pins.
 *
 * DEC-1: D2 asserts the POPULATION-WIDE identity of the refusals; the per-name refusal itself is B2's and B3's, and this
 * suite names the B and C cases it composes over by title (DEC-2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpBearerContext } from "@/app/lib/auth/mcp-bearer";
import type { McpRequestHeaders } from "@/app/lib/auth/mcp-bearer";
import type { McpBearerJsonInput } from "@/app/lib/auth/route-handlers";
import type { MembershipRole } from "@/app/lib/auth/project-membership";
import { FIXTURE_SCOPE } from "@/app/lib/engineering/__tests__/_durable-board-fixture";
import { encodeMcpNameHeader } from "../../http-transport";
import { handleMcpRequest } from "../dispatch";
import { resetMcpReadStateForTests } from "../read-call";
import { MCP_JSON_RPC_ERROR_CODES, MCP_JSON_RPC_MESSAGES } from "../protocol";
import { resetMcpServerTraceSinkFactory, setMcpServerTraceSinkFactory, type McpServerRequestTrace } from "../request-trace";
import { harnessPrincipal, readHarness, type Harness } from "./_read-harness";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b20/mcp-adversarial.md";
const B2_ENDPOINT = "app/api/mcp/__tests__/b20-b2-mcp-endpoint.test.ts";
const B4_SUITE = "b20-b4-withhold-proposals.test.ts";

const META = Object.freeze({ "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} });
const ZERO_WIDTH_JOINER = String.fromCharCode(8205);
const FULLWIDTH_OFFSET = 65_248;
const fullwidth = (value: string): string => Array.from(value, (char) => {
  const code = char.charCodeAt(0);
  return code >= 33 && code <= 126 ? String.fromCharCode(code + FULLWIDTH_OFFSET) : char;
}).join("");

/** The four representative ids: a Tier 3 release, a grant-only mutation, a destructive mutation and a withheld proposal. */
const NEVER_SERVED = Object.freeze({
  tier3: "sirkit.manufacturing.release",
  grantOnly: "sirkit.pcb.undo-redo-granted",
  destructive: "sirkit.pcb.delete-item",
  withheld: "sirkit.placement.propose",
});
const SERVED = "sirkit.pcb.board-inspect";

let records: McpServerRequestTrace[] = [];
let harness: Harness;
let principal: McpBearerContext;

/**
 * One authenticated JSON-RPC input; `nameHeader` overrides the `Mcp-Name` the client would send and `null` removes it.
 * `raw: true` uses `params` EXACTLY as built — never spread — so a hostile accessor planted on it is invoked by the
 * dispatch if at all, and never by this harness.
 */
function input(method: "tools/list" | "tools/call" | "server/discover", params: Record<string, unknown>, options: { nameHeader?: string | null; id?: unknown; who?: McpBearerContext; raw?: boolean } = {}): McpBearerJsonInput {
  const own = Object.getOwnPropertyDescriptor(params, "name");
  const bodyName = own !== undefined && own.get === undefined && typeof own.value === "string" ? (own.value as string) : null;
  const header = options.nameHeader === undefined ? bodyName : options.nameHeader;
  const mcp: McpRequestHeaders = {
    protocolVersion: { state: "present", value: "2026-07-28" },
    method: { state: "present", value: method },
    name: header === null ? { state: "absent" } : { state: "present", value: encodeMcpNameHeader(header) },
    paramHeaderCount: 0,
  };
  const built = options.raw === true ? params : { ...params, _meta: { ...META, ...((params._meta as Record<string, unknown>) ?? {}) } };
  return {
    principal: options.who ?? principal,
    message: { jsonrpc: "2.0", id: options.id ?? 5, method, params: built },
    bytes: 200, mcp, meta: { method: "POST", pathname: "/api/mcp" }, signal: new AbortController().signal,
  } as McpBearerJsonInput;
}

interface Answer { status: number; body: Record<string, unknown>; text: string; outcome: string; toolId: string | null }
async function dispatch(request: McpBearerJsonInput): Promise<Answer> {
  records = [];
  const response = await handleMcpRequest(request, { registry: harness.registry, reads: harness.deps });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { body = {}; }
  expect(records).toHaveLength(1);
  return { status: response.status, body, text, outcome: records[0]!.outcome, toolId: records[0]!.toolId };
}

const shapeOf = (body: Record<string, unknown>): string => JSON.stringify({ ...body, id: 0 });
const UNKNOWN_TOOL_ERROR = { code: MCP_JSON_RPC_ERROR_CODES.INVALID_PARAMS, message: MCP_JSON_RPC_MESSAGES.UNKNOWN_TOOL };
/** the read pipeline's closed refusal code, where a served read writes it (empty on a success) */
const refusalOf = (body: Record<string, unknown>): string => String(((body.result as { _meta?: Record<string, unknown> } | undefined)?._meta ?? {})["dev.sirkit/refusal"] ?? "");
/** The caller's own current revision, read from the server's own answer to the pin-exempt revision read — never typed. */
async function currentPin(): Promise<Record<string, unknown>> {
  const answer = await dispatch(input("tools/call", { name: "sirkit.project.canonical-revision-inspect", arguments: {} }));
  const revision = ((answer.body.result as { _meta?: Record<string, unknown> } | undefined)?._meta ?? {})["dev.sirkit/revision"];
  if (typeof revision !== "string" || revision === "") throw new Error(`fixture: no revision in ${answer.text.slice(0, 200)}`);
  return { "dev.sirkit/expectedRevision": revision };
}

async function principalOf(stored: MembershipRole): Promise<McpBearerContext> {
  const user = `user-d2-${stored}`;
  harness.repo.set({ tenantId: FIXTURE_SCOPE.tenantId, projectId: FIXTURE_SCOPE.projectId, userId: user, role: stored, state: "active", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "test" });
  return harnessPrincipal(harness.repo, { user });
}

beforeEach(async () => {
  resetMcpReadStateForTests();
  records = [];
  setMcpServerTraceSinkFactory(() => ({ record: (trace) => { records.push(trace); } }));
  harness = await readHarness({ role: "admin" });
  principal = await principalOf("admin");
});
afterEach(() => {
  resetMcpServerTraceSinkFactory();
  resetMcpReadStateForTests();
  vi.restoreAllMocks();
});

describe("[B20 D2] name spellings at the dispatch", () => {
  it("N1. every renamed spelling of a Tier 3 release, a grant-only mutation, a destructive mutation and a withheld proposal — upper case, mixed case, trailing dot, trailing and leading space, a zero-width joiner, a fullwidth spelling, a provider-style spelling, a foreign-namespace spelling, a ../-style spelling, 2 048 characters and the empty string, the body and the header agreeing — is ONE identical 200 -32602 with outcome unknown_tool", async () => {
    const spellings = (id: string): Array<{ name: string; value: string }> => [
      { name: "as written", value: id },
      { name: "upper case", value: id.toUpperCase() },
      { name: "mixed case", value: `${id.slice(0, 1).toUpperCase()}${id.slice(1)}` },
      { name: "trailing dot", value: `${id}.` },
      { name: "trailing space", value: `${id} ` },
      { name: "leading space", value: ` ${id}` },
      { name: "a zero-width joiner inside", value: id.replace(".", `.${ZERO_WIDTH_JOINER}`) },
      { name: "fullwidth", value: fullwidth(id) },
      { name: "an NFKC-folding confusable", value: id.replace("i", String.fromCharCode(305)) },
      { name: "provider style", value: id.replace(/\./g, "_") },
      { name: "a foreign namespace", value: `mcp.docs__${id.split(".").pop()}` },
      { name: "a ../ spelling", value: `../${id}` },
      { name: "2 048 characters", value: id.padEnd(2_048, "x") },
    ];
    const bodies = new Set<string>();
    for (const [kind, id] of Object.entries(NEVER_SERVED)) {
      for (const spelling of spellings(id)) {
        const label = `${kind}/${spelling.name}`;
        const answer = await dispatch(input("tools/call", { name: spelling.value, arguments: {} }));
        expect(answer.status, label).toBe(200);
        expect(answer.body.error, label).toEqual(UNKNOWN_TOOL_ERROR);
        expect(Object.hasOwn(answer.body.error as object, "data"), label).toBe(false);
        expect(answer.outcome, label).toBe("unknown_tool");
        expect(answer.toolId, label).toBeNull();
        expect(answer.text.includes(spelling.value), label).toBe(false);
        bodies.add(shapeOf(answer.body));
      }
    }
    // the server half has no name namespace to collide in: one registry, one exact match, one identical refusal
    expect(bodies.size).toBe(1);

    // the EMPTY name is the one spelling with a different answer, and it is a STRICTER one: an empty `Mcp-Name` header
    // cannot be decoded, so the request is refused as a header mismatch before any name is looked up
    const empty = await dispatch(input("tools/call", { name: "", arguments: {} }));
    expect(empty.status).toBe(400);
    expect((empty.body.error as { code: number }).code).toBe(MCP_JSON_RPC_ERROR_CODES.HEADER_MISMATCH);
    expect(empty.toolId).toBeNull();
  });

  it("N2. params.name of the WRONG TYPE — a number, null, true, an array, an object and absent — is the same 200 -32602 unknown-tool answer, never a throw and never an echo, and it holds even when the Mcp-Name header is absent (that check precedes the header check); a getter that throws is the one shape with its own answer, a closed 400 with the throw never escaping and never echoed", async () => {
    const thrower: Record<string, unknown> = { arguments: {}, _meta: { ...META } };
    Object.defineProperty(thrower, "name", { get() { throw new Error("hostile getter"); }, enumerable: true, configurable: true });
    const shapes: Array<{ name: string; params: Record<string, unknown>; raw?: boolean }> = [
      { name: "a number", params: { name: 42, arguments: {} } },
      { name: "null", params: { name: null, arguments: {} } },
      { name: "true", params: { name: true, arguments: {} } },
      { name: "an array", params: { name: [SERVED], arguments: {} } },
      { name: "an object", params: { name: { toString: () => SERVED }, arguments: {} } },
      { name: "absent", params: { arguments: {} } },
    ];
    const bodies = new Set<string>();
    for (const shape of shapes) {
      const answer = await dispatch(input("tools/call", shape.params, { nameHeader: null, ...(shape.raw === true ? { raw: true } : {}) }));
      expect(answer.status, shape.name).toBe(200);
      expect(answer.body.error, shape.name).toEqual(UNKNOWN_TOOL_ERROR);
      expect(answer.toolId, shape.name).toBeNull();
      bodies.add(shapeOf(answer.body));
    }
    expect(bodies.size).toBe(1);

    // a THROWING accessor on `params.name` is the one shape with its own answer, and it is a closed one: the read of the
    // name is inside the validator's try, so the request is refused 400 without the throw ever escaping and without the
    // name being echoed. Never a 500 with a stack, never a served tool.
    const thrown = await dispatch(input("tools/call", thrower, { nameHeader: null, raw: true }));
    expect(thrown.status).toBe(400);
    expect(thrown.toolId).toBeNull();
    expect(thrown.body.result).toBeUndefined();
    expect(thrown.text.includes("hostile getter")).toBe(false);
    expect(thrown.text.includes("at ")).toBe(false);
  });

  it("N3. header and body disagreeing, BOTH directions — a served read in the body with a release id in Mcp-Name, and the reverse — is 400 -32020 header_mismatch and nothing is served", async () => {
    const pairs: Array<{ name: string; body: string; header: string }> = [
      { name: "served body, release header", body: SERVED, header: NEVER_SERVED.tier3 },
      { name: "release body, served header", body: NEVER_SERVED.tier3, header: SERVED },
      { name: "served body, withheld header", body: SERVED, header: NEVER_SERVED.withheld },
      { name: "served body, case-changed header", body: SERVED, header: SERVED.toUpperCase() },
    ];
    for (const pair of pairs) {
      const answer = await dispatch(input("tools/call", { name: pair.body, arguments: {} }, { nameHeader: pair.header }));
      expect(answer.status, pair.name).toBe(400);
      expect((answer.body.error as { code: number }).code, pair.name).toBe(MCP_JSON_RPC_ERROR_CODES.HEADER_MISMATCH);
      expect(answer.outcome, pair.name).toBe("header_mismatch");
      expect(answer.toolId, pair.name).toBeNull();
      expect(answer.body.result, pair.name).toBeUndefined();
    }
  });

  it("N3b. an Mcp-Name on the WRONG METHOD — a tools/list or a server/discover carrying any name — is 400 -32020, because only tools/call, resources/read and prompts/get carry that header", async () => {
    for (const method of ["tools/list", "server/discover"] as const) {
      for (const header of [SERVED, NEVER_SERVED.tier3, ""]) {
        const answer = await dispatch(input(method, {}, { nameHeader: header }));
        expect(answer.status, `${method}/${header}`).toBe(400);
        expect((answer.body.error as { code: number }).code, `${method}/${header}`).toBe(MCP_JSON_RPC_ERROR_CODES.HEADER_MISMATCH);
        expect(answer.outcome, `${method}/${header}`).toBe("header_mismatch");
      }
    }
  });

  it("N4. NESTED spellings on a SERVED read, each PINNED to the refusal the gate that reads it writes: a release id or a delegation key inside arguments, __proto__ and constructor as argument keys are invalid_arguments (the CURRENT pin is sent, so the revision check cannot mask the argument gate); a params.params.name naming a release tool is IGNORED and the read is served; an expectedRevision that is a release id is 400 -32602; a dev.sirkit/* _meta key with a throwing getter is served with the getter never invoked; and no release id is ever served or echoed", async () => {
    const pinned = await currentPin();
    let getterCalls = 0;
    const throwingMeta: Record<string, unknown> = { ...META, ...pinned };
    Object.defineProperty(throwingMeta, "dev.sirkit/toolId", { get() { getterCalls += 1; throw new Error("hostile _meta getter"); }, enumerable: true, configurable: true });
    const hostileMetaParams: Record<string, unknown> = { name: SERVED, arguments: {}, _meta: throwingMeta };
    // [B20 D review] tests-03: the read pipeline judges the arguments (step 3) BEFORE the pin (step 4), so without a pin a
    // removed argument gate would fall through to `revision_required` and still read as a closed refusal. Every shape here
    // carries the caller's own current pin and names the ONE refusal (or the served answer) it must produce.
    const shapes: Array<{ name: string; params: Record<string, unknown>; expect: "invalid_arguments" | "served" | "invalid_meta"; raw?: boolean }> = [
      { name: "toolId in arguments", params: { name: SERVED, arguments: { toolId: NEVER_SERVED.tier3 }, _meta: pinned }, expect: "invalid_arguments" },
      { name: "delegateTo in arguments", params: { name: SERVED, arguments: { delegateTo: NEVER_SERVED.tier3 }, _meta: pinned }, expect: "invalid_arguments" },
      { name: "tool in arguments", params: { name: SERVED, arguments: { tool: NEVER_SERVED.grantOnly }, _meta: pinned }, expect: "invalid_arguments" },
      { name: "name in arguments", params: { name: SERVED, arguments: { name: NEVER_SERVED.destructive }, _meta: pinned }, expect: "invalid_arguments" },
      { name: "__proto__ in arguments", params: { name: SERVED, arguments: JSON.parse(`{"__proto__":{"role":"project_admin"}}`) as Record<string, unknown>, _meta: pinned }, expect: "invalid_arguments" },
      { name: "constructor in arguments", params: { name: SERVED, arguments: { constructor: NEVER_SERVED.tier3 }, _meta: pinned }, expect: "invalid_arguments" },
      { name: "params.params.name", params: { name: SERVED, arguments: {}, params: { name: NEVER_SERVED.tier3 }, _meta: pinned }, expect: "served" },
      { name: "expectedRevision is a release id", params: { name: SERVED, arguments: {}, _meta: { "dev.sirkit/expectedRevision": NEVER_SERVED.tier3 } }, expect: "invalid_meta" },
      { name: "a throwing dev.sirkit/ _meta getter", params: hostileMetaParams, expect: "served", raw: true },
    ];
    for (const shape of shapes) {
      const answer = await dispatch(input("tools/call", shape.params, shape.raw === true ? { raw: true } : {}));
      const label = shape.name;
      if (shape.expect === "invalid_meta") {
        expect(answer.status, label).toBe(400);
        expect((answer.body.error as { code: number }).code, label).toBe(MCP_JSON_RPC_ERROR_CODES.INVALID_PARAMS);
        expect(answer.outcome, label).toBe("invalid_params");
      } else if (shape.expect === "invalid_arguments") {
        expect(answer.status, label).toBe(200);
        expect(answer.outcome, label).toBe("read_refused");
        expect(refusalOf(answer.body), label).toBe("invalid_arguments");
        expect(answer.toolId, label).toBe(SERVED);
      } else {
        // the extra key is not one the pipeline reads: the served read answers for SERVED, and nothing else
        expect(answer.status, label).toBe(200);
        expect(answer.outcome, label).toBe("read_served");
        expect(refusalOf(answer.body), label).toBe("");
        expect(answer.toolId, label).toBe(SERVED);
      }
      for (const id of Object.values(NEVER_SERVED)) expect(answer.text.includes(id), `${label} leaked ${id}`).toBe(false);
    }
    // the undeclared `dev.sirkit/toolId` key is never READ: the argument gate compares the three binding keys by exact
    // `Object.hasOwn`, and never iterates the object — even on the path that served the read
    expect(getterCalls).toBe(0);
  });

  it("N5. arguments of the wrong SHAPE, each PINNED: an array, a string and null are the dispatch's identical unknown-tool answer with outcome arguments_invalid; a 9-key object and a 64 KiB object reach the argument gate and are invalid_arguments (the current pin sent, so the revision check cannot mask the gate); never a throw, and nothing served", async () => {
    const pinned = await currentPin();
    const big: Record<string, unknown> = {};
    for (let index = 0; index < 500; index += 1) big[`k${index}`] = "x".repeat(130);
    const nine: Record<string, unknown> = {};
    for (let index = 0; index < 9; index += 1) nine[`a${index}`] = index;
    const shapes: Array<{ name: string; value: unknown; unknown: boolean }> = [
      { name: "an array", value: [1, 2, 3], unknown: true },
      { name: "a string", value: "release", unknown: true },
      { name: "null", value: null, unknown: true },
      { name: "a nine-key object", value: nine, unknown: false },
      { name: "a 64 KiB object", value: big, unknown: false },
    ];
    for (const shape of shapes) {
      const answer = await dispatch(input("tools/call", { name: SERVED, arguments: shape.value, _meta: pinned }));
      expect(answer.status, shape.name).toBe(200);
      if (shape.unknown) {
        expect(answer.body.error, shape.name).toEqual(UNKNOWN_TOOL_ERROR);
        expect(answer.outcome, shape.name).toBe("arguments_invalid");
        expect(answer.toolId, shape.name).toBeNull();
      } else {
        expect(answer.body.result, shape.name).toBeDefined();
        expect(answer.outcome, shape.name).toBe("read_refused");
        expect(refusalOf(answer.body), shape.name).toBe("invalid_arguments");
      }
    }
  });

  it("N6. the page's D2.4 section states the spelling attack, why the server half has no name namespace to collide in, and the case counts; and B4's listed-means-served ratchet is still the case this composes over", () => {
    const page = read(PAGE);
    expect(page).toMatch(/^### D2\.4 /m);
    expect(page).toContain("one registry, one exact match");
    expect(page).toContain("is the client half's");
    const suite = "app/lib/mcp/server/__tests__/b20-d2-name-spellings.test.ts";
    const cases = (read(suite).match(/^\s*it\(/gm) ?? []).length;
    expect(page).toContain(`| \`${suite}\` | ${cases} |`);
    // the committed case this composes over, bound by title (DEC-2)
    expect(read(`app/lib/mcp/server/__tests__/${B4_SUITE}`)).toContain("5. listed means served (ratchet)");
    expect(read(B2_ENDPOINT).length).toBeGreaterThan(0);
  });
});
