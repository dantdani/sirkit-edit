/**
 * [PR-M, 2026-10-18] Section M2 (design M2.2): a NETWORK CAD source is reached only through the bounded egress path. Over the fixture
 * source's REAL committed bytes (app/lib/fixture-runtime/cad-source/transport.ts) and the production `outboundFetch`: exact hosts, the
 * resolved-address policy, redirects refused, the byte ceiling, the media type, the deadline, a 429's REAL Retry-After becoming a
 * scheduled wait (and the breaker refusing the next call without a request), the blocked source refused before any request, and the
 * SHA-256 of what arrived equal to the committed file's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { componentResolutionSlicePorts, resetCadSourceInjection, setCadSourceInjection } from "@/app/lib/component-resolution/task/worker-runtime";
import type { ComponentResolutionRuntime } from "@/app/lib/component-resolution/task/runtime";
import type { ComponentResolutionTaskHead } from "@/app/lib/component-resolution/task/contracts";
import { fetchCadAsset, retryAfterAt, cadTemplatePath } from "@/app/lib/acquisition/cad-egress";
import { CAD_SOURCE_ENTRIES, type CadSourceEntry } from "@/app/lib/acquisition/cad-source-registry";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { createFixtureCadTransport, FIXTURE_CAD_HOST } from "@/app/lib/fixture-runtime/cad-source/transport";
import { createGitlabCadAdapter, createFixtureCadAdapter } from "@/app/lib/acquisition/cad-adapters/network";

const NOW = Date.parse("2026-10-18T10:00:00.000Z");
const clock = (): number => NOW;
const SYMBOL_PATH = "/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym";
const committed = (relative: string): Buffer => readFileSync(join(process.cwd(), "app", "lib", "fixture-runtime", "cad-source", ...relative.split("/")));

function fixtureDeps(transport = createFixtureCadTransport(), extra: Record<string, unknown> = {}) {
  return { transport, deps: { fetch: transport.fetch, resolve: transport.resolve, fixtureAllowed: true, clock, ...extra } };
}

beforeEach(() => resetAdmissionControl());
afterEach(() => resetAdmissionControl());

describe("[PR-M M2.2] the fixture source through the production egress path", () => {
  it("returns the exact committed bytes, their SHA-256, the origin + path and the KiCad media type", async () => {
    const { transport, deps } = fixtureDeps();
    const outcome = await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148", ref: "90c39c3880f0062a56b5944d428edc846968d72b" } }, deps);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) return;
    const bytes = committed("kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym");
    expect(outcome.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(outcome.byteLength).toBe(bytes.byteLength);
    expect(outcome.url).toBe(`https://${FIXTURE_CAD_HOST}${SYMBOL_PATH}`);
    expect(outcome.contentType).toBe("application/x-kicad-symbol");
    expect(outcome.retrievedAt).toBe(new Date(NOW).toISOString());
    expect(transport.requests).toEqual([`https://${FIXTURE_CAD_HOST}${SYMBOL_PATH}`]);
  });

  it("refuses a resolved private / metadata address (address_blocked) before any byte is read", async () => {
    const transport = createFixtureCadTransport();
    const outcome = await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, { fetch: transport.fetch, resolve: async () => ["169.254.169.254"], fixtureAllowed: true, clock });
    expect(outcome).toMatchObject({ ok: false, code: "address_blocked" });
    expect(transport.requests).toEqual([]);
  });

  it("refuses a redirect (to anywhere) and never follows it", async () => {
    const { transport, deps } = fixtureDeps();
    transport.overrides.set(SYMBOL_PATH, { status: 302, headers: { location: "https://evil.example/x.kicad_sym" } });
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, deps)).toMatchObject({ ok: false, code: "redirect_refused" });
    expect(transport.requests).toEqual([`https://${FIXTURE_CAD_HOST}${SYMBOL_PATH}`]);
  });

  it("refuses a body over the kind's ceiling (response_too_large), a wrong media type, and bytes that are not UTF-8", async () => {
    const { transport, deps } = fixtureDeps();
    transport.overrides.set(SYMBOL_PATH, { status: 200, body: "(".repeat(1024 * 1024 + 10), headers: { "content-type": "application/x-kicad-symbol" } });
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, deps)).toMatchObject({ ok: false, code: "response_too_large" });
    transport.overrides.set(SYMBOL_PATH, { status: 200, body: "<html></html>", headers: { "content-type": "text/html" } });
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, deps)).toMatchObject({ ok: false, code: "unexpected_content_type" });
    transport.overrides.set(SYMBOL_PATH, { status: 200, body: new Uint8Array([0x28, 0xff, 0xfe, 0x29]), headers: { "content-type": "application/x-kicad-symbol" } });
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, deps)).toMatchObject({ ok: false, code: "not_text" });
  });

  it("stops at the row's deadline (timeout)", async () => {
    const transport = createFixtureCadTransport();
    transport.overrides.set(SYMBOL_PATH, { status: 200, body: "(kicad_symbol_lib)", headers: { "content-type": "application/x-kicad-symbol" }, delayMs: 2_000 });
    const entries = CAD_SOURCE_ENTRIES.map((entry): CadSourceEntry => entry.id === "fixture-kicad" ? { ...entry, resilience: { ...entry.resilience, deadlineMs: 60 } } : entry);
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, { fetch: transport.fetch, resolve: transport.resolve, fixtureAllowed: true, clock, entries })).toMatchObject({ ok: false, code: "timeout" });
  });

  it("a 429 with the REAL Retry-After becomes a scheduled wait, and the open breaker refuses the next call WITHOUT a request (no hot retry)", async () => {
    const { transport, deps } = fixtureDeps();
    transport.overrides.set(SYMBOL_PATH, { status: 429, headers: { "retry-after": "120", "content-type": "text/plain" }, body: "slow down" });
    const limited = await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, deps);
    expect(limited).toMatchObject({ ok: false, code: "rate_limited", status: 429, retryAtMs: NOW + 120_000 });
    const again = await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, deps);
    expect(again).toMatchObject({ ok: false, code: "breaker_open" });
    expect((again as { retryAtMs: number }).retryAtMs).toBeGreaterThan(NOW);
    expect(transport.requests).toHaveLength(1);
    // an HTTP-date Retry-After, a malformed one, and the bound
    expect(retryAfterAt("Sun, 18 Oct 2026 10:05:00 GMT", NOW)).toBe(Date.parse("2026-10-18T10:05:00.000Z"));
    expect(retryAfterAt("soon", NOW)).toBeNull();
    expect(retryAfterAt("999999", NOW)).toBe(NOW + 3_600_000);
  });

  it("a 404 is not_found; the template accepts only validated KiCad segments (no traversal, no arbitrary URL)", async () => {
    const { deps } = fixtureDeps();
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "NoSuchPart" } }, deps)).toMatchObject({ ok: false, code: "not_found", status: 404 });
    for (const name of ["../../etc/passwd", "a/b", "x.kicad_sym", "", "%2e%2e"]) expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name } }, deps), name).toMatchObject({ ok: false, code: "path_refused" });
    expect(cadTemplatePath("/kicad-symbols/{library}.kicad_symdir/{name}.kicad_sym", { library: "Diode", name: "1N4148" })).toBe(SYMBOL_PATH);
    expect(cadTemplatePath("/x/{ref}", { name: "a", ref: "main" })).toBeNull(); // a ref is a full pinned commit
  });

  it("a 3D model is refused by the row before any request; the fixture source is refused without the fixture runtime", async () => {
    const { transport, deps } = fixtureDeps();
    expect(await fetchCadAsset("fixture-kicad", { kind: "model", values: { name: "x" } }, deps)).toMatchObject({ ok: false, code: "kind_refused" });
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, { ...deps, fixtureAllowed: false })).toMatchObject({ ok: false, code: "source_fixture_only" });
    expect(transport.requests).toEqual([]);
  });
});

describe("[PR-M M2.7] the gitlab.com adapter exists and is never called (blocked, OD-M2-3)", () => {
  it("refuses at admission with no request, whatever transport it is given", async () => {
    const calls: string[] = [];
    const counting: typeof fetch = async (input) => { calls.push(String(input)); return new Response("(kicad_symbol_lib)", { status: 200, headers: { "content-type": "text/plain" } }); };
    const adapter = createGitlabCadAdapter({ fetch: counting, resolve: async () => ["93.184.216.34"], fixtureAllowed: true, clock });
    for (const kind of ["symbol", "footprint"] as const) expect(await adapter.retrieve({ kind, library: "Diode", name: "1N4148" })).toMatchObject({ ok: false, code: "source_blocked" });
    expect(calls).toEqual([]);
  });

  it("the fixture adapter maps the egress result to the adapter shape with the pinned ref", async () => {
    const transport = createFixtureCadTransport();
    const adapter = createFixtureCadAdapter({ fetch: transport.fetch, resolve: transport.resolve, fixtureAllowed: true, clock });
    const symbol = await adapter.retrieve({ kind: "symbol", library: "Diode", name: "1N4148" });
    expect(symbol).toMatchObject({ ok: true, object: { sourceId: "fixture-kicad", ref: "90c39c3880f0062a56b5944d428edc846968d72b", library: "Diode", name: "1N4148", mediaType: "application/x-kicad-symbol" } });
    const table = await adapter.retrieve({ kind: "datasheet", library: null, name: "1N4148" });
    expect(table).toMatchObject({ ok: true, object: { kind: "datasheet", ref: null, mediaType: "text/plain" } });
  });
});

// ─── [PR-L/M integration, 2026-10-18] review fixes M2-SEC-7, M2-SEC-8, M2-SEC-9 ─────────────────────────────────────────────────────────

const FOOTPRINT_PATH = "/kicad-footprints/Diode_THT.pretty/D_DO-35_SOD27_P7.62mm_Horizontal.kicad_mod";

describe("[PR-L/M integration] the exact bytes stay exact; a non-2xx body is never read", () => {
  it("M2-SEC-7: a byte-order mark is KEPT in the text, so sha256(text) - the object store's key - is sha256(bytes), the hash the candidate names", async () => {
    const { transport, deps } = fixtureDeps();
    const original = committed("kicad-footprints/Diode_THT.pretty/D_DO-35_SOD27_P7.62mm_Horizontal.kicad_mod");
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...original]);
    transport.overrides.set(FOOTPRINT_PATH, { status: 200, body: withBom, headers: { "content-type": "application/x-kicad-footprint" } });
    const outcome = await fetchCadAsset("fixture-kicad", { kind: "footprint", values: { library: "Diode_THT", name: "D_DO-35_SOD27_P7.62mm_Horizontal" } }, deps);
    expect(outcome.ok, JSON.stringify(outcome).slice(0, 300)).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sha256).toBe(createHash("sha256").update(withBom).digest("hex"));
    expect(outcome.text.charCodeAt(0)).toBe(0xfeff); // not silently stripped
    expect(createHash("sha256").update(outcome.text, "utf8").digest("hex")).toBe(outcome.sha256); // the store's key IS the candidate's hash
    expect(outcome.byteLength).toBe(withBom.byteLength);
  });

  it("M2-SEC-8: a 429 with Retry-After and a body over the kind's ceiling is still a scheduled wait at the real retry time (the body is never read); a large 404 is not_found; a 503's Retry-After is kept", async () => {
    const { transport, deps } = fixtureDeps();
    transport.overrides.set(SYMBOL_PATH, { status: 429, headers: { "retry-after": "120", "content-type": "text/html" }, body: "<html>slow down</html>".padEnd(2 * 1024 * 1024, " ") });
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, deps)).toMatchObject({ ok: false, code: "rate_limited", status: 429, retryAtMs: NOW + 120_000 });
    resetAdmissionControl();
    transport.overrides.set(SYMBOL_PATH, { status: 404, headers: { "content-type": "text/html" }, body: "x".repeat(2 * 1024 * 1024) });
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, deps)).toMatchObject({ ok: false, code: "not_found", status: 404 });
    transport.overrides.set(SYMBOL_PATH, { status: 503, headers: { "retry-after": "30", "content-type": "text/plain" }, body: "maintenance" });
    expect(await fetchCadAsset("fixture-kicad", { kind: "symbol", values: { library: "Diode", name: "1N4148" } }, deps)).toMatchObject({ ok: false, code: "http_error", status: 503, retryAtMs: NOW + 30_000 });
  });
});

describe("[PR-L/M integration] M2-SEC-9: the CAD source meter holds an agent-started task to the agent share (OD-40) (the bundled row's own meter: m2-3, over its pinned scratch checkout)", () => {
  afterEach(() => resetCadSourceInjection());
  const runtime = (): ComponentResolutionRuntime => ({ repository: new InMemoryDurableWorkflowRepository(), clock, durability: "process-memory", fixture: true, governance: { tenantId: null, projectId: null }, environment: {} });
  const fixtureAdapterFor = (origin: "chat" | "page") => {
    const transport = createFixtureCadTransport();
    setCadSourceInjection({ fixtureEgress: { fetch: transport.fetch, resolve: transport.resolve }, fixtureAllowed: true });
    const ports = componentResolutionSlicePorts(runtime(), { catalog: {} as never, evidence: {} as never });
    const adapter = ports.pipeline({ origin } as ComponentResolutionTaskHead).adapters.find((candidate) => candidate.sourceId === "fixture-kicad");
    if (!adapter) throw new Error("the fixture adapter was not admitted");
    return { adapter, transport };
  };

  it("a CHAT-started task gets floor(0.25 x 120) = 30 requests a minute from the fixture source, then a pause with its retry time and no request; a PAGE start is a person's whole window", async () => {
    const share = Math.floor(0.25 * CAD_SOURCE_ENTRIES.find((entry) => entry.id === "fixture-kicad")!.quota.requestsPerMinute);
    expect(share).toBe(30);
    const agent = fixtureAdapterFor("chat");
    for (let index = 0; index < share; index += 1) expect((await agent.adapter.retrieve({ kind: "symbol", library: "Diode", name: "1N4148" })).ok, `request ${index + 1}`).toBe(true);
    const paused = await agent.adapter.retrieve({ kind: "symbol", library: "Diode", name: "1N4148" });
    expect(paused).toMatchObject({ ok: false, code: "quota_exhausted" });
    expect((paused as { retryAtMs: number }).retryAtMs).toBeGreaterThan(NOW);
    expect(agent.transport.requests).toHaveLength(share); // the paused request was never sent
    resetAdmissionControl();
    const person = fixtureAdapterFor("page");
    for (let index = 0; index <= share; index += 1) expect((await person.adapter.retrieve({ kind: "symbol", library: "Diode", name: "1N4148" })).ok, `request ${index + 1}`).toBe(true);
  });
});
