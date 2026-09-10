/**
 * B16.0.12 §A — BEHAVIORAL CONTRACT PINS for the tranche-5 migration (12 public
 * catalog / footprint / deterministic-export / placement-preview methods + the
 * KiCad token-protected category route). Written and run GREEN against the
 * PRE-migration raw handlers, then kept green unchanged after migration.
 *
 * NO live database, embedding service, provider or external API is contacted:
 * `getDb` is a queue-driven chainable fake (select-counted), `embedQuery` is a
 * counted fake, `parts-search` is faked, and the placement engine is a counted
 * pass-through spy over the REAL deterministic engine. Export bytes are
 * compared against the REAL serializers (`exportToKicadSch`, `writeKicadPcb`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// ── queue-driven chainable drizzle fake ──────────────────────────────────────
const dbState = { results: [] as unknown[][], selects: 0 };
function makeChain(): unknown {
  const target = (): void => {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        const rows = dbState.results.length ? dbState.results.shift()! : [];
        return (resolve: (v: unknown) => void) => resolve(rows);
      }
      if (prop === "select") dbState.selects += 1;
      return (...args: unknown[]) => { void args; return proxy; };
    },
    apply: () => proxy,
  });
  return proxy;
}
vi.mock("@/app/lib/db/client", () => ({ getDb: vi.fn(() => makeChain()) }));
vi.mock("@/app/lib/embeddings", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, embedQuery: vi.fn(async () => new Array(1536).fill(0.1)) };
});
vi.mock("@/app/lib/parts-search", () => ({
  getFullPartsByIds: vi.fn(async () => []),
  getPartsByIds: vi.fn(async () => []),
  searchParts: vi.fn(async () => []),
}));
vi.mock("@/app/lib/pcb/placement/engine", async (orig) => {
  const actual = await orig() as { runEngineeringPlacement: (i: unknown) => unknown };
  return { ...actual, runEngineeringPlacement: vi.fn(actual.runEngineeringPlacement) };
});
import { embedQuery } from "@/app/lib/embeddings";
import { runEngineeringPlacement } from "@/app/lib/pcb/placement/engine";
const embeds = vi.mocked(embedQuery);
const placement = vi.mocked(runEngineeringPlacement);

import { GET as aiRuntime } from "../ai/runtime/route";
import { GET as atomicCatalog } from "../components/atomic/route";
import { POST as atomicSearch } from "../components/atomic/search/route";
import { POST as exportKicad } from "../export/kicad/route";
import { GET as kicadCategory } from "../kicad/v1/parts/category/[id]/route";
import { GET as partDetail } from "../parts/[id]/route";
import { GET as partAlternates } from "../parts/[id]/alternates/route";
import { POST as exportKicadPcb } from "../pcb/export/kicad-pcb/route";
import { GET as footprintDetail } from "../pcb/footprints/[id]/route";
import { GET as footprintResolve } from "../pcb/footprints/resolve/route";
import { GET as footprintSearch } from "../pcb/footprints/search/route";
import { POST as placementPreview } from "../pcb/placement/preview/route";

import { exportToKicadSch } from "@/app/lib/kicad-export";
import { writeKicadPcb, netlistFromBoard } from "@/app/lib/pcb/kicad/write-pcb";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import type { SchematicState } from "@/lib/schematic-types";

function validSchState(): SchematicState {
  return {
    components: [
      { id: "uuid-r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k", refDes: "RSENSE" },
      { id: "uuid-g1", type: "ground", x: 100, y: 200, rotation: 0, value: "" },
    ],
    kicadComponents: [],
    wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 300, y: 100 }] }],
    netLabels: [{ id: "l1", position: { x: 300, y: 100 }, name: "VOUT", kind: "label", orientation: 0 }],
    pageSize: "A4",
  } as SchematicState;
}

const UUID = "12345678-1234-1234-1234-123456789abc";
function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "GET", headers });
}
function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}
function ctxFor(id: string): { params: Promise<{ id: string }> } { return { params: Promise.resolve({ id }) }; }
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
const resetDb = (): void => { dbState.results = []; dbState.selects = 0; };

afterEach(() => { resetDb(); embeds.mockClear(); placement.mockClear(); vi.unstubAllEnvs(); });

// ── I. AI runtime secret safety ──────────────────────────────────────────────
describe("B16.0.12 §I — /api/ai/runtime discloses no secrets", () => {
  it("adversarial sentinel env values never appear in the serialized response", async () => {
    const SENTINELS: Record<string, string> = {
      OPENAI_API_KEY: "sk-SENTINEL-OPENAI-9f1",
      ANTHROPIC_API_KEY: "sk-ant-SENTINEL-7c2",
      KICAD_HTTP_LIBRARY_TOKEN: "SENTINEL-KICAD-TOKEN-3d4",
      SIRKIT_WORKFLOW_WORKER_SECRET: "SENTINEL-WORKER-5e6",
      DATABASE_URL: "postgres://user:SENTINEL-DBPASS-1a2@host/db",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "SENTINEL-SUPA-8b3",
      SUPABASE_SERVICE_ROLE_KEY: "SENTINEL-SERVICE-ROLE-4c5",
    };
    for (const [k, v] of Object.entries(SENTINELS)) vi.stubEnv(k, v);
    const res = await aiRuntime(get("/api/ai/runtime"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = JSON.stringify(await res.json());
    for (const v of Object.values(SENTINELS)) expect(text).not.toContain(v);
    expect(text).not.toContain("SENTINEL");
  });
  it("returns only the intended public capability shape", async () => {
    const body = await payload(await aiRuntime(get("/api/ai/runtime")));
    expect(Object.keys(body).sort()).toEqual(["embeddings", "providers"]);
    expect(Object.keys(body.providers as object).sort()).toEqual(["anthropic", "openai"]);
  });
});

// ── F. Atomic catalog + search + part detail/alternates ─────────────────────
describe("B16.0.12 §F — atomic/parts public authority", () => {
  it("[components/atomic] limit clamped (1..100, default 50), `after` cursor honored; only-published filter; deterministic catalogSnapshotId; nextCursor", async () => {
    const rows = [
      { id: "a1", semanticHash: "h1", revision: { exactPartId: "E1", genericDeviceId: null, cadBundles: [], publicationState: "published" } },
      { id: "a2", semanticHash: "h2", revision: { exactPartId: null, genericDeviceId: "G2", cadBundles: [], publicationState: "published" } },
    ];
    dbState.results = [rows, [{ id: "a1" }, { id: "a2" }]];
    const res = await atomicCatalog(get("/api/components/atomic?limit=1&after=a0"));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect((body.items as unknown[]).length).toBe(1);
    expect(body.nextCursor).toBe("a1"); // limit+1 row present → cursor
    expect(String(body.catalogSnapshotId)).toMatch(/^catalog_/);
    expect(dbState.selects).toBe(2);
    // deterministic snapshot id over the same published-id set
    dbState.results = [rows, [{ id: "a1" }, { id: "a2" }]];
    const again = await payload(await atomicCatalog(get("/api/components/atomic?limit=1&after=a0")));
    expect(again.catalogSnapshotId).toBe(body.catalogSnapshotId);
  });
  it("[components/atomic] absurd limit clamps to bounds without DB explosion (still 2 selects)", async () => {
    dbState.results = [[], []];
    const res = await atomicCatalog(get("/api/components/atomic?limit=99999"));
    expect(res.status).toBe(200);
    expect(dbState.selects).toBe(2);
  });
  it("[atomic/search] 415 / malformed / oversized (200 KB + 1) refuse before any DB select", async () => {
    const m = await atomicSearch(post("/api/components/atomic/search", "{}", { "content-type": "text/plain" }));
    expect(m.status).toBe(415);
    const bad = await atomicSearch(post("/api/components/atomic/search", "{not json"));
    expect(bad.status).toBe(400);
    const big = await atomicSearch(post("/api/components/atomic/search", "x".repeat(200_001)));
    expect(big.status).toBe(413);
    expect(dbState.selects).toBe(0);
  });
  it("[parts/[id]] malformed id → { ok:true, part:null } with ZERO DB selects (historical in-bound behavior)", async () => {
    const res = await partDetail(get(`/api/parts/not-a-uuid`), ctxFor("not-a-uuid"));
    expect(res.status).toBe(200);
    expect((await payload(res)).part).toBeNull();
    expect(dbState.selects).toBe(0);
  });
  it("[parts/[id]] missing part → part:null; atomicAssignments emitted ONLY from existing published links", async () => {
    dbState.results = [[]];
    const miss = await partDetail(get(`/api/parts/${UUID}`), ctxFor(UUID));
    expect((await payload(miss)).part).toBeNull();
  });
  it("[alternates] invalid id → 400 with ZERO DB selects; kind/limit validated", async () => {
    const res = await partAlternates(get(`/api/parts/xx/alternates`), ctxFor("xx"));
    expect(res.status).toBe(400);
    expect((await payload(res)).error).toBe("Invalid part id");
    expect(dbState.selects).toBe(0);
  });
});

// ── E. KiCad token boundary ──────────────────────────────────────────────────
describe("B16.0.12 §E — KiCad HTTP-library token authority (category route)", () => {
  const CTX = ctxFor("published.json");
  it("unconfigured server token → 503 with ZERO DB selects", async () => {
    const res = await kicadCategory(get("/api/kicad/v1/parts/category/published.json"), CTX);
    expect(res.status).toBe(503);
    expect(dbState.selects).toBe(0);
  });
  it("missing / wrong token → 401 with ZERO DB selects (before parameter processing)", async () => {
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", "right-token");
    const missing = await kicadCategory(get("/api/kicad/v1/parts/category/published.json"), CTX);
    expect(missing.status).toBe(401);
    const wrong = await kicadCategory(get("/api/kicad/v1/parts/category/published.json", { authorization: "Token wrong" }), CTX);
    expect(wrong.status).toBe(401);
    expect(dbState.selects).toBe(0);
  });
  it("valid token: `.json` suffix stripped; `published` lists mapped rows; unknown category → []", async () => {
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", "right-token");
    dbState.results = [[{ id: "a1", revision: { exactPartId: "E1", genericDeviceId: null } }]];
    const ok = await kicadCategory(get("/api/kicad/v1/parts/category/published.json", { authorization: "Token right-token" }), CTX);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([{ id: "a1", name: "E1", description: "Sirkit evidence-backed atomic component revision", keywords: "sirkit atomic component" }]);
    const unknown = await kicadCategory(get("/api/kicad/v1/parts/category/other", { authorization: "Token right-token" }), ctxFor("other"));
    expect(await unknown.json()).toEqual([]);
  });
});

// ── G. Footprint search & resolution ────────────────────────────────────────
describe("B16.0.12 §G — footprint search/resolve zero-embedding discipline", () => {
  it("[resolve] missing/malformed hint → 400 with ZERO DB and ZERO embedding calls", async () => {
    for (const q of ["", "?hint=", "?hint=NoColon", "?hint=:Name", "?hint=Lib:"]) {
      const res = await footprintResolve(get(`/api/pcb/footprints/resolve${q}`));
      expect(res.status, q).toBe(400);
    }
    expect(dbState.selects).toBe(0);
    expect(embeds).not.toHaveBeenCalled();
  });
  it("[resolve] valid hint → ONE indexed select, zero embeddings; miss → { ok:true, hit:null }", async () => {
    dbState.results = [[]];
    const res = await footprintResolve(get("/api/pcb/footprints/resolve?hint=Lib:Name"));
    expect(res.status).toBe(200);
    expect((await payload(res)).hit).toBeNull();
    expect(dbState.selects).toBe(1);
    expect(embeds).not.toHaveBeenCalled();
  });
  it("[search] invalid queries (missing q, >500 chars, bad padCount, bad smd) → 400 with ZERO embeddings", async () => {
    expect((await footprintSearch(get("/api/pcb/footprints/search"))).status).toBe(400);
    expect((await footprintSearch(get(`/api/pcb/footprints/search?q=${"x".repeat(501)}`))).status).toBe(400);
    expect((await footprintSearch(get("/api/pcb/footprints/search?q=r&padCount=-1"))).status).toBe(400);
    expect((await footprintSearch(get("/api/pcb/footprints/search?q=r&smd=maybe"))).status).toBe(400);
    expect(embeds).not.toHaveBeenCalled();
    expect(dbState.selects).toBe(0);
  });
  it("[search] EXACT `Lib:Name` hit → indexed path with ZERO embedding calls; score 1 at rank 0", async () => {
    dbState.results = [[{ id: "f1", libName: "Resistor_SMD", name: "R_0805", description: null, padCount: 2, attrSmd: true, attrTht: false, bodyBBox: null }]];
    const res = await footprintSearch(get("/api/pcb/footprints/search?q=Resistor_SMD:R_0805"));
    expect(res.status).toBe(200);
    const hits = (await payload(res)).hits as Array<{ score: number; fullName?: string; libName?: string }>;
    expect(hits.length).toBe(1);
    expect(hits[0]!.score).toBe(1);
    expect(embeds).not.toHaveBeenCalled();
  });
  it("[search] free text → EXACTLY ONE fake embedding call, then the two candidate pools", async () => {
    dbState.results = [[], []];
    const res = await footprintSearch(get("/api/pcb/footprints/search?q=small%20resistor&limit=5"));
    expect(res.status).toBe(200);
    expect(embeds).toHaveBeenCalledTimes(1);
    expect(dbState.selects).toBeGreaterThanOrEqual(2); // vector + trigram pools
  });
  it("[footprints/[id]] malformed id → 404 with ZERO DB selects", async () => {
    const res = await footprintDetail(get("/api/pcb/footprints/zzz"), ctxFor("zzz"));
    expect(res.status).toBe(404);
    expect(dbState.selects).toBe(0);
  });
});

// ── H. Export byte parity + placement determinism ───────────────────────────
describe("B16.0.12 §H — deterministic export bytes & placement preview", () => {
  it("[export/kicad] 415/malformed/oversized refuse before work; missing state and empty schematic → exact historical 400s", async () => {
    expect((await exportKicad(post("/api/export/kicad", "{}", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await exportKicad(post("/api/export/kicad", "{nope"))).status).toBe(400);
    expect((await exportKicad(post("/api/export/kicad", "x".repeat(8_000_001)))).status).toBe(413);
    const missing = await exportKicad(post("/api/export/kicad", JSON.stringify({})));
    expect(missing.status).toBe(400);
    expect((await payload(missing)).error).toBe("Missing 'state'");
    const empty = await exportKicad(post("/api/export/kicad", JSON.stringify({ state: { components: [], kicadComponents: [], wires: [], netLabels: [] } })));
    expect(empty.status).toBe(400);
    expect((await payload(empty)).error).toBe("Schematic has no components to export");
  });
  it("[export/kicad] valid state → BYTES identical to the real serializer; sanitized filename; octet-stream", async () => {
    const state = validSchState();
    const res = await exportKicad(post("/api/export/kicad", JSON.stringify({ state, title: "My Board!" })));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="My_Board.kicad_sch"');
    const expected = exportToKicadSch({ state, parts: new Map(), title: "My Board!", description: undefined, company: undefined, componentSelections: undefined });
    expect(await res.text()).toBe(expected);
  });
  it("[export/kicad] canonical-integrity violation → structured 422, nothing exported", async () => {
    const state = validSchState();
    (state.components as Array<{ x: number }>)[0]!.x = 101; // off-grid
    const res = await exportKicad(post("/api/export/kicad", JSON.stringify({ state })));
    expect(res.status).toBe(422);
    const body = await payload(res);
    expect(body.code).toBe("SCHEMATIC_STATE_INVALID");
    expect(Array.isArray(body.issues)).toBe(true);
  });
  it("[pcb/export/kicad-pcb] valid empty board → BYTES identical to the real writer; filename sanitized", async () => {
    const board = createEmptyBoard();
    const res = await exportKicadPcb(post("/api/pcb/export/kicad-pcb", JSON.stringify({ board, options: { boardName: "My Board!" } })));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="My-Board.kicad_pcb"');
    // The writer mints a RANDOM uuid per element (historical behavior,
    // preserved) — bytes are pinned modulo those uuids.
    const stripUuids = (s: string): string => s.replace(/\(uuid "[0-9a-f-]+"\)/g, '(uuid "<v>")');
    const expected = writeKicadPcb(board, netlistFromBoard(board), { boardName: "My-Board" });
    expect(stripUuids(await res.text())).toBe(stripUuids(expected));
  });
  it("[pcb/export/kicad-pcb] invalid board / netlist / options → exact 400s; media/body refusals first", async () => {
    expect((await exportKicadPcb(post("/api/pcb/export/kicad-pcb", "{}", { "content-type": "text/plain" }))).status).toBe(415);
    const noBoard = await exportKicadPcb(post("/api/pcb/export/kicad-pcb", JSON.stringify({})));
    expect(noBoard.status).toBe(400);
    expect((await payload(noBoard)).error).toBe("body.board must be a PcbBoard");
    const badOptions = await exportKicadPcb(post("/api/pcb/export/kicad-pcb", JSON.stringify({ board: createEmptyBoard(), options: 5 })));
    expect(badOptions.status).toBe(400);
  });
  it("[placement/preview] valid board → engine EXACTLY ONCE; deterministic modulo the volatile runId; input NOT mutated; no durable ops", async () => {
    const board = createEmptyBoard();
    const frozen = JSON.stringify(board);
    const body = JSON.stringify({ board, options: { candidateCount: 2, localRefinementPasses: 0 } });
    const res1 = await placementPreview(post("/api/pcb/placement/preview", body));
    expect(placement).toHaveBeenCalledTimes(1);
    expect(res1.status).toBe(200);
    const out1 = (await res1.json()) as { ok: boolean; result: Record<string, unknown> };
    const res2 = await placementPreview(post("/api/pcb/placement/preview", body));
    const out2 = (await res2.json()) as { ok: boolean; result: Record<string, unknown> };
    // The engine mints a fresh run identifier and records wall-clock elapsedMs
    // per invocation (historical behavior, preserved). Everything else must be
    // byte-deterministic.
    // [B17-E] the response now carries the shared layout candidate: its wall-clock stamps are the only other volatile
    // fields (the candidate digest deliberately excludes them, so it must match byte-for-byte).
    const norm = (o: unknown): string => JSON.stringify(o).replace(/"runId":"[^"]+"/g, '"runId":"<v>"').replace(/"elapsedMs":\d+/g, '"elapsedMs":0').replace(/"(createdAt|expiresAt)":"[^"]+"/g, '"$1":"<t>"');
    expect(norm(out2)).toBe(norm(out1));
    expect(JSON.stringify(board)).toBe(frozen); // input untouched
    expect(dbState.selects).toBe(0); // no durable save/history/revision
  });
  it("[placement/preview] media/body/board refusals precede placement computation", async () => {
    expect((await placementPreview(post("/api/pcb/placement/preview", "{}", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await placementPreview(post("/api/pcb/placement/preview", "{oops"))).status).toBe(400);
    const noBoard = await placementPreview(post("/api/pcb/placement/preview", JSON.stringify({})));
    expect(noBoard.status).toBe(400);
    expect((await payload(noBoard)).error).toBe("board is required");
    expect(placement).not.toHaveBeenCalled();
  });
});
