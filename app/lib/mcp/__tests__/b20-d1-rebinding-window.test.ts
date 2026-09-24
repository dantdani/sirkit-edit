/**
 * [B20 D1] D20-23 — the DNS rebinding window, closed AS RECORDED under OD-51.
 *
 * OD-51's recorded mitigation is not a pinned dispatcher (that would add `undici`, which OD-42 forbids without an owner
 * decision) but this: "the B20-D rebinding test proves refusal when the resolver flips between admission calls and
 * documents the residual window". That is exactly what this suite does and nothing more.
 *
 * It is the ONE attack on the runbook's B20-D list that no existing suite has: `grep -ril rebind` over the B20 client
 * suites returns nothing, and every other item composes over an A-suite case (DEC-1(a)).
 *
 * The flip is injected through the resolver seam (`OutboundDeps.resolve`), which `outboundFetch` consults ONCE PER
 * ADMISSION — so a resolver that answers a public address on the discovery admission and a private one on the listing
 * admission is a rebinding between two admissions. The window INSIDE one admission -> connect pair is the limit
 * `app/lib/net/outbound-fetch.ts` states in its own header, and R4 records it rather than claiming it closed.
 *
 * No network, no DNS, no real credential; the global fetch is poisoned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { outboundFetch } from "../../net/outbound-fetch";
import { mcpInFlight, mcpPost, resetMcpInFlight } from "../http-transport";
import { resetMcpAuthorization } from "../authorization";
import { resetMcpToolCache } from "../tool-discovery";
import type { McpServerRegistryEntry } from "../server-registry";
import { byMethod, depsOf, fakeMcpServer, PUBLIC, rpcResult, tool, wideServer, type FakeScript } from "./_fake-mcp-server";
import { hostileRow, hostileRun, hostileWorld, nothingLeaked, sentenceOf, type HostileRun } from "./_hostile-server";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b20/mcp-adversarial.md";

const PUBLIC_ADDRESS = "93.184.216.34";
const METADATA_ADDRESS = "169.254.169.254";
const BENIGN = "LM358DR: dual operational amplifier, SOIC-8, in stock.";
const SEARCH = tool("search");
const DEFS: readonly Record<string, unknown>[] = [SEARCH];
const ARGS = { mpn: "LM358DR" };
const block = (value: string): Record<string, unknown> => ({ type: "text", text: value });

const script: FakeScript = byMethod({
  list: (call) => rpcResult(call, { tools: DEFS, ttlMs: 0, cacheScope: "private" }),
  call: (call) => rpcResult(call, { content: [block(BENIGN)] }),
});

const row = (id: string, overrides: Partial<McpServerRegistryEntry> = {}): McpServerRegistryEntry => hostileRow(id, DEFS, ["search"], overrides);

/** A resolver that answers `answers[i]` on its i-th call and repeats the last answer after that. */
function flipping(answers: ReadonlyArray<readonly string[]>): (hostname: string) => Promise<string[]> {
  let index = 0;
  return async () => {
    const answer = answers[Math.min(index, answers.length - 1)]!;
    index += 1;
    return [...answer];
  };
}

const ADDRESSES = [PUBLIC_ADDRESS, METADATA_ADDRESS, "10.0.0.1", "127.0.0.1", "100.64.0.1", "fc00::1"];
/** Nothing anywhere in the composed answer names an address, a hostname or a path. */
function namesNoAddress(run: HostileRun, host: string): string[] {
  return nothingLeaked(run, { hosts: [host], forbidden: ADDRESSES });
}

const DISCOVER = { jsonrpc: "2.0" as const, id: 1, method: "server/discover", params: {} };
const LIST = { jsonrpc: "2.0" as const, id: 2, method: "tools/list", params: {} };
/**
 * [B20 D review] coverage-7 / tests-09: the composed run shows the PORT's answer only (`mcpPortRefusalOf` folds every
 * egress refusal into `transport_failed, sent: false` and drops the egress code). So the transport-level outcome — which
 * check refused, by CODE — is observed HERE, one `mcpPost` per admission against the same row, the same fake and the same
 * resolver the composed run used.
 */
async function transportOutcomes(entry: McpServerRegistryEntry, resolve: (hostname: string) => Promise<string[]>): Promise<Array<Record<string, unknown>>> {
  const fake = fakeMcpServer(script);
  const deps = depsOf(fake, undefined, { resolve, environment: {} });
  const outcomes: Array<Record<string, unknown>> = [];
  for (const message of [DISCOVER, LIST]) outcomes.push((await mcpPost(entry, message, { purpose: "interactive", deps })) as unknown as Record<string, unknown>);
  return outcomes;
}

beforeEach(() => {
  resetAdmissionControl();
  resetMcpInFlight();
  resetMcpToolCache();
  resetMcpAuthorization();
  vi.stubGlobal("fetch", () => { throw new Error("a rebinding case bypassed the egress boundary and called the global fetch"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetMcpInFlight();
});

describe("[B20 D1] D20-23 — the DNS rebinding window, under OD-51", () => {
  it("R1. the resolver flips between two admissions — public on the discovery admission, the cloud metadata address on the listing admission: the listing is egress_refused with egressCode address_blocked -> port transport_failed, sent false -> class not_sent, the sentence names the server id ALONE, and the fake recorded exactly one request", async () => {
    const entry = row("docs-rebind");
    const fake = fakeMcpServer(script);
    const world = hostileWorld({ entries: [entry], fake, resolve: flipping([[PUBLIC_ADDRESS], [METADATA_ADDRESS]]) });
    const run = await world.run({ operation: "call", serverId: "docs-rebind", toolName: "search", args: ARGS });

    expect(run.stage).toBe("agent");
    expect(world.resolves.length).toBeGreaterThanOrEqual(2); // the flip happened BETWEEN two admissions
    expect(run.port).toMatchObject({ ok: false, kind: "refused", code: "transport_failed", sent: false });
    expect(run.agent.kind).toBe("refused");
    expect(run.agent.status).toBe("transport_failed");
    expect(run.agent.text).toBe(sentenceOf("transport_failed", "docs-rebind"));
    expect(run.attribution).toMatchObject({ serverId: "docs-rebind", resultClass: "not_sent", contentHash: null, observationId: null });
    // only the discovery request reached the wire; the listing never did
    expect(run.calls).toHaveLength(1);
    expect(String(run.calls[0]!.body.method)).toBe("server/discover");
    expect(namesNoAddress(run, entry.endpoint.host)).toEqual([]);
    expect(mcpInFlight("docs-rebind")).toBe(0);

    // the TRANSPORT-level outcome of the same flip, by CODE: the first admission is served, the second is `egress_refused`
    // with `egressCode: "address_blocked"` — the ADDRESS check, not the allowlist and not a failed lookup — and its sentence
    // names the code alone, never an address, the hostname or the path
    resetAdmissionControl();
    resetMcpInFlight();
    const [admitted, refused] = await transportOutcomes(entry, flipping([[PUBLIC_ADDRESS], [METADATA_ADDRESS]]));
    expect(admitted).toMatchObject({ ok: true, kind: "complete" });
    expect(refused).toMatchObject({ ok: false, kind: "closed", code: "egress_refused", egressCode: "address_blocked" });
    const sentence = String(refused!.message);
    expect(sentence).toContain("(address_blocked)");
    for (const literal of [...ADDRESSES, entry.endpoint.host, entry.endpoint.path]) expect(sentence.includes(literal), literal).toBe(false);
  });

  it("R2. the private address SECOND in a two-address answer is still refused: EVERY resolved address must be public, because the transport may pick either", async () => {
    const entry = row("docs-rebind-two");
    const fake = fakeMcpServer(script);
    const world = hostileWorld({ entries: [entry], fake, resolve: flipping([[PUBLIC_ADDRESS], [PUBLIC_ADDRESS, METADATA_ADDRESS]]) });
    const run = await world.run({ operation: "call", serverId: "docs-rebind-two", toolName: "search", args: ARGS });

    expect(run.port).toMatchObject({ ok: false, code: "transport_failed", sent: false });
    expect(run.attribution?.resultClass).toBe("not_sent");
    expect(run.agent.text).toBe(sentenceOf("transport_failed", "docs-rebind-two"));
    expect(run.calls).toHaveLength(1);
    expect(namesNoAddress(run, entry.endpoint.host)).toEqual([]);
  });

  it("R3. every blocked class flipped in on the second admission — loopback, the link-local metadata service, a private range, carrier-grade NAT and an IPv6 unique-local address — gives the same closed answer and the same sentence", async () => {
    const classes: Array<{ name: string; address: string }> = [
      { name: "loopback", address: "127.0.0.1" },
      { name: "link-local metadata", address: METADATA_ADDRESS },
      { name: "private", address: "10.0.0.1" },
      { name: "carrier-grade NAT", address: "100.64.0.1" },
      { name: "IPv6 unique-local", address: "fc00::1" },
    ];
    for (const blocked of classes) {
      resetAdmissionControl();
      resetMcpToolCache();
      resetMcpInFlight();
      const entry = row("docs-rebind-class");
      const fake = fakeMcpServer(script);
      const world = hostileWorld({ entries: [entry], fake, resolve: flipping([[PUBLIC_ADDRESS], [blocked.address]]) });
      const run = await world.run({ operation: "call", serverId: "docs-rebind-class", toolName: "search", args: ARGS });
      expect(run.stage, blocked.name).toBe("agent");
      expect(run.port, blocked.name).toMatchObject({ ok: false, code: "transport_failed", sent: false });
      expect(run.attribution?.resultClass, blocked.name).toBe("not_sent");
      expect(run.agent.text, blocked.name).toBe(sentenceOf("transport_failed", "docs-rebind-class"));
      expect(run.calls, blocked.name).toHaveLength(1);
      expect(namesNoAddress(run, entry.endpoint.host), blocked.name).toEqual([]);
    }
  });

  it("R4. the ROW is the only thing that names a URL, and the window this does NOT close is recorded, not claimed: a crafted row whose canonical URI names another host is refused before anything is sent; the transport's per-source allowlist is exactly the row's endpoint host; and a public answer really does reach deps.fetch, so neither assertion is vacuous", async () => {
    // (a) a crafted revision whose canonical URI names another host than the row's endpoint: nothing is sent at all, and
    // no host is named in the answer. This is the refusal a real input produces — `allowedHosts: [endpoint.host]` is not
    // reachable from a peer, because this row-level check runs first, which is the point.
    const crafted = row("docs-elsewhere", { canonicalUri: "https://elsewhere.example/mcp" });
    const craftedFake = fakeMcpServer(script);
    const craftedRun = await hostileRun({ entries: [crafted], fake: craftedFake }, { operation: "call", serverId: "docs-elsewhere", toolName: "search", args: ARGS });
    expect(craftedRun.stage).toBe("agent");
    expect(craftedRun.agent.kind).toBe("refused");
    expect(craftedFake.calls).toHaveLength(0);
    expect(nothingLeaked(craftedRun, { forbidden: ["elsewhere.example"] })).toEqual([]);
    // [B20 D review] tests-09: WHICH check refused it, by code. The transport's row-consistency check (`endpointMatches`:
    // the canonical URI must name the row's endpoint origin and exact path) runs BEFORE the egress policy is even built,
    // so this crafted row is `endpoint_mismatch` — a pre-send refusal of Sirkit's own, which the port classes `port_failed`
    // — and the per-source allowlist below is never reached by it. That is a stated fact, not a gap: no row can reach the
    // allowlist with a host other than its own, because the URL and the allowlist are both derived from the same row.
    expect(craftedRun.port).toMatchObject({ ok: false, code: "port_failed", sent: false });
    expect(craftedRun.agent.status).toBe("port_failed");
    resetAdmissionControl();
    resetMcpInFlight();
    const [mismatch] = await transportOutcomes(crafted, PUBLIC);
    expect(mismatch).toMatchObject({ ok: false, kind: "closed", code: "endpoint_mismatch" });
    expect(String(mismatch!.message).includes("elsewhere.example")).toBe(false);

    // (a') the allowlist ITSELF, exercised at the egress boundary with a policy whose allowlist excludes the URL's host —
    // the one input that reaches it — is `host_not_allowed` before any lookup and before any request: the resolver and the
    // transport are both poisoned and neither is called. The MCP transport maps every unlisted egress code to
    // `egress_refused` (case (b) pins that sentence), so this is the chain the allowlist would take if a row could reach it.
    let lookups = 0;
    let sends = 0;
    const allowlisted = await outboundFetch(
      { url: `https://${crafted.endpoint.host}${crafted.endpoint.path}`, method: "POST", headers: {}, body: "{}" },
      { source: "mcp:docs-elsewhere", allowedHosts: ["other.example.com"], deadlineMs: 1_000, maxResponseBytes: 1_000, maxRedirects: 0, acceptContentTypes: [] },
      { fetch: (async () => { sends += 1; throw new Error("the allowlist let a request through"); }) as unknown as typeof fetch, resolve: async () => { lookups += 1; return [PUBLIC_ADDRESS]; } },
    );
    expect(allowlisted).toMatchObject({ ok: false, code: "host_not_allowed" });
    expect(lookups).toBe(0);
    expect(sends).toBe(0);

    // (b) the transport's per-source allowlist is the ROW's endpoint host and nothing else, read from the source
    const transport = read("app/lib/mcp/http-transport.ts");
    expect(transport).toContain("allowedHosts: [server.endpoint.host]");
    expect(transport).toContain("maxRedirects: server.maxRedirects");
    // and the sentence that carries an egress refusal names the CODE and nothing else. The agent never sees this text at
    // all — the port maps every closed outcome to a code and the service renders its own fixed sentence — so a hostname
    // added here could not be caught by an outcome assertion; it is caught HERE, where the sentence is written.
    expect(transport).toContain("the egress boundary refused the request (${exchange.code}); nothing was sent.");

    // (c) the assertions above are not vacuous: with the row's own host and a public address the request IS made, once
    // per exchange, to that host and no other
    resetAdmissionControl();
    resetMcpToolCache();
    const good = row("docs-allowed");
    const goodFake = fakeMcpServer(script);
    const goodRun = await hostileRun({ entries: [good], fake: goodFake }, { operation: "call", serverId: "docs-allowed", toolName: "search", args: ARGS });
    expect(goodRun.agent.kind).toBe("external-observation");
    expect(goodFake.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of goodFake.calls) expect(new URL(call.url).hostname).toBe(good.endpoint.host);

    // (d) the RESIDUAL WINDOW, recorded as OD-51's mitigation requires. `app/lib/net/outbound-fetch.ts` states it in its
    // own header: the transport resolves the name again when it connects, so a rebinding that flips a record between the
    // admission check and that connect is NOT excluded there; the per-source allowlist of exact hosts is what closes it in
    // practice, and pinning the connection to the checked address needs a custom dispatcher (a new dependency: OD-42).
    // the sentence is wrapped across comment lines, so it is read with the comment prefixes removed
    const egress = read("app/lib/net/outbound-fetch.ts").split(NEWLINE).map((line) => line.replace(/^\s*\*\s?/, "")).join(" ").replace(/\s+/g, " ");
    expect(egress).toContain("the transport resolves the name again when it connects, so a rebinding that flips a record between this check and that connect is not excluded here");
    expect(egress).toContain("pinning the connection to the checked address needs a custom dispatcher and is recorded as a follow-up");
  });

  it("R5. a resolver that throws, one that rejects, one that never settles, one answering an empty list and one answering non-strings are each a CLOSED REFUSAL with nothing sent — pinned per resolver, by transport code and port answer, with zero wire calls — while 10 000 public addresses are admitted and served; nothing throws, and mcpInFlight returns to 0", async () => {
    const entry = row("docs-resolver", { limits: { ...wideServer("docs-resolver").limits, perTool: {}, deadlineMs: 200 } });
    // [B20 D review] tests-10 / coverage-6: each resolver names the ONE answer it must produce. A lookup that throws, rejects
    // or answers no address is `dns_failed` at the egress boundary -> `egress_refused` -> port `transport_failed, sent:
    // false`. One that never settles is raced by the row's deadline -> `timeout` (the transport's own closed code, which
    // the port classes as an answer that failed to come). One answering non-strings throws inside the address check and
    // is closed by the transport as `network_error`. In every one of those five NOTHING reaches the wire. Only the
    // 10 000-address answer — every address public — is admitted.
    const resolvers: Array<{ name: string; resolve: (hostname: string) => Promise<string[]>; code: string | null; egressCode?: string; sent: boolean }> = [
      { name: "throws", resolve: () => { throw new Error("resolver exploded"); }, code: "egress_refused", egressCode: "dns_failed", sent: false },
      { name: "rejects", resolve: () => Promise.reject(new Error("resolver rejected")), code: "egress_refused", egressCode: "dns_failed", sent: false },
      { name: "never settles", resolve: () => new Promise<string[]>(() => undefined), code: "timeout", sent: true },
      { name: "empty", resolve: async () => [], code: "egress_refused", egressCode: "dns_failed", sent: false },
      { name: "10 000 addresses", resolve: async () => Array.from({ length: 10_000 }, (_value, index) => `93.184.${Math.floor(index / 256) % 256}.${index % 256}`), code: null, sent: true },
      { name: "non-strings", resolve: async () => ([null, 42, { a: 1 }] as unknown as string[]), code: "network_error", sent: true },
    ];
    for (const resolver of resolvers) {
      resetAdmissionControl();
      resetMcpToolCache();
      resetMcpInFlight();
      const fake = fakeMcpServer(script);
      const run = await hostileRun({ entries: [entry], fake, resolve: resolver.resolve }, { operation: "call", serverId: "docs-resolver", toolName: "search", args: ARGS });
      expect(run.stage, resolver.name).toBe("agent");
      expect(run.thrown, resolver.name).toBeNull();
      if (resolver.code === null) {
        expect(run.agent.kind, resolver.name).toBe("external-observation");
        expect(run.calls.length, resolver.name).toBeGreaterThanOrEqual(3);
      } else {
        expect(run.agent.kind, resolver.name).toBe("refused");
        expect(run.port, resolver.name).toMatchObject({ ok: false, kind: "refused", code: "transport_failed", sent: resolver.sent });
        expect(run.agent.status, resolver.name).toBe("transport_failed");
        expect(run.calls, resolver.name).toHaveLength(0); // NOTHING reached the wire, whatever the sent flag reads
        // and the transport-level code that closed it, observed on one post with the same resolver
        resetAdmissionControl();
        resetMcpInFlight();
        const [outcome] = await transportOutcomes(entry, resolver.resolve);
        expect(outcome, resolver.name).toMatchObject({ ok: false, kind: "closed", code: resolver.code, ...(resolver.egressCode === undefined ? {} : { egressCode: resolver.egressCode }) });
      }
      expect(namesNoAddress(run, entry.endpoint.host), resolver.name).toEqual([]);
      expect(mcpInFlight("docs-resolver"), resolver.name).toBe(0);
    }
  });

  it("R6. the page's D1.5 section states D20-23's closure under OD-51 — the flip, the closed answer, the addresses that never appear, and the residual window it does NOT close — and this suite is the only one in the repository that tests rebinding", () => {
    const page = read(PAGE);
    expect(page).toMatch(/^### D1\.5 /m);
    expect(page).toContain("D20-23");
    expect(page).toContain("OD-51");
    expect(page).toContain("residual window");
    const suite = "app/lib/mcp/__tests__/b20-d1-rebinding-window.test.ts";
    const cases = (read(suite).match(/^\s*it\(/gm) ?? []).length;
    expect(page).toContain(`| \`${suite}\` | ${cases} |`);
    // DEC-1(a): this is the ONE item on the runbook's B20-D list with no precedent
    expect(page).toContain("no existing suite has the attack at all");
  });
});
