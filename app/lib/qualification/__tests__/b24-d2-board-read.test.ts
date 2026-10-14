/**
 * [B24-D2] D24-29, OD-213 - a bounded, paged board read: `sirkit.pcb.board-page-inspect` (binding `read.board-page` 1.0.0,
 * `app/lib/pcb/ai/board-pages.ts` `buildBoardPage`). board-inspect answers with the whole AI PCB snapshot, and on every recorded
 * ROUTED board that snapshot is over the loop's 60,000-character result budget (b18-e-board-inspect-budget), so the model gets
 * `output_too_large_for_model` and no board facts. The paged read selects ONE layer, ONE net or ONE flat region of the same snapshot
 * and pages it, every page within the page constant.
 *
 *  1. through the real loop (the b18-e-via-facts harness: runAgentLoop, createAgentToolGateway, sirkitToolRegistry), on each recorded
 *     ROUTED board (e2e/fixtures/blinker-route-fixture.json): board-inspect is refused output_too_large_for_model, and a scripted model
 *     that follows nextCursor reads every layer and every net - each page's result text, exactly as the loop hands it over, within
 *     BOARD_PAGE_MAX_RESULT_CHARS, carrying the gateway's tool, revision and verification; the pages joined equal that selection of
 *     the snapshot (re-derived here from board-inspect's own projections), every item on exactly one page;
 *  2. the review: the constant plus its stated margin within MAX_RESULT_CHARS; a Tier 0 read modelled on via-inspect (owning command,
 *     roles, project state, authority, the activated binding on canonical-state), discovered wherever via-inspect is under every
 *     discovery context below, in the reviewed agent set, withheld from MCP (servable from durable state, so withheld by choice);
 *  3. a deterministic synthetic board with ten times the routed blinker's tracks: every layer and every net paged through the loop
 *     under the constant, at least one selection over several pages, the pages joined equal the selection;
 *  4. a flat region on a routed board and on the synthetic board: the pages joined equal the region's selection;
 *  5. the selector refusals: none, two, a partial region, an inverted region, an unknown layer, an unknown net - each a closed code,
 *     answered to the model as a read (nothing guessed);
 *  6. an item larger than a whole page is refused by kind and id (item_over_budget) where it falls, never truncated, and every other
 *     item still pages;
 *  7. a cursor is bound to the board revision and the selector: with another selector or another revision it is refused
 *     (stale_cursor), a malformed one is cursor_invalid;
 *  8. the same board and the same arguments give the same bytes, in a stable order (kinds in BOARD_PAGE_KINDS, ids by code point);
 *  9. [OD-236 approved] strict-rendered optional nulls are normalized against the original schema at the agent boundary;
 *     this read and via-inspect answer identically to the omitted-field calls. B05's domain validation is unchanged.
 *     The original red evidence remains in the historical B24 reports;
 * 10. [B24-D2 review] the page bound holds on the model-bound text: names the sanitizer lengthens never push a page, or a refusal's
 *     list of known names, over the constant (red first on the D2 tree: a 55,902-character page).
 *
 * Failing first on 3d5f225 (performance-and-reliability.md part 2): the tool does not exist, so the scripted model's paged calls
 * are refused unknown_tool and it gets no board facts on a routed board. Nothing is written; no process, network or provider.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { ProviderAgentAdapter, AgentStep } from "@/app/lib/agent/contracts";

const PAGE_TOOL = "sirkit.pcb.board-page-inspect";
const VIA_TOOL = "sirkit.pcb.via-inspect";
const BOARD_TOOL = "sirkit.pcb.board-inspect";
const COPPER_ORDER = ["copperTop", "in1", "in2", "copperBottom"];
const KINDS = ["nets", "footprints", "pads", "tracks", "vias", "zones", "keepouts"] as const;
type Kind = (typeof KINDS)[number];
type Item = Record<string, unknown> & { id: string };
type Selection = { label: string; args: Record<string, unknown> };
type Handed = { label: string; text: string };
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The recorded ROUTED boards of the browser fixture, loaded as b18-e-via-facts loads them (padstacks bound). */
async function routedBoards(): Promise<Array<{ key: string; board: PcbBoard }>> {
  const { ensureBoardPadstacks } = await import("@/app/lib/pcb/padstack/migrate");
  const fixture = JSON.parse(readFileSync("e2e/fixtures/blinker-route-fixture.json", "utf8")) as { entries: Record<string, { candidate: PcbBoard }> };
  return Object.entries(fixture.entries).map(([key, entry]) => {
    const board = JSON.parse(JSON.stringify(entry.candidate)) as PcbBoard;
    ensureBoardPadstacks(board);
    return { key, board };
  });
}

/** A deterministic synthetic board: the first routed board with its tracks copied nine more times, each copy shifted one board
 *  width to the right on an outline ten widths wide (ten times the routed blinker's track count; ids unique). */
async function syntheticBoard(): Promise<PcbBoard> {
  const [{ board }] = await routedBoards();
  const big = JSON.parse(JSON.stringify(board)) as PcbBoard;
  if (big.outline.kind !== "rect") throw new Error("the routed blinker's outline is a rect");
  const width = big.outline.width;
  big.outline = { ...big.outline, width: width * 10 };
  for (let copy = 1; copy < 10; copy += 1) {
    for (const track of board.tracks) big.tracks.push({ ...track, id: `${track.id}~x${copy}`, start: { x: track.start.x + copy * width, y: track.start.y }, end: { x: track.end.x + copy * width, y: track.end.y } });
  }
  expect(big.tracks.length).toBeGreaterThanOrEqual(10 * board.tracks.length);
  return big;
}

/** The provider name the registry publishes for a tool id (agentProviderName: every character outside [A-Za-z0-9_-] becomes _). */
const providerNameOf = (toolId: string): string => toolId.replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * A scripted model that reads board-inspect once, then every selection in turn, following each page's nextCursor until it is null.
 * `handed` collects exactly the result text each call was answered with (the loop's resultText), in order, with its selection label.
 */
function walkingAdapter(selections: readonly Selection[], handed: Handed[]): ProviderAgentAdapter {
  const queue = [...selections];
  let current: Selection | null = null;
  let cursor: string | null = null;
  let calls = 0;
  let pendingLabel = "";
  const call = (label: string, toolId: string, args: Record<string, unknown>): AgentStep => {
    calls += 1;
    pendingLabel = label;
    return { text: "", toolCalls: [{ callId: `call-${calls}`, providerName: providerNameOf(toolId), argumentsText: JSON.stringify(args) }], stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null } };
  };
  const next = (): AgentStep => {
    if (current && cursor) return call(current.label, PAGE_TOOL, { ...current.args, cursor });
    current = queue.shift() ?? null;
    cursor = null;
    if (!current) return { text: "done", toolCalls: [], stopReason: "end", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null } };
    return call(current.label, PAGE_TOOL, current.args);
  };
  return {
    provider: "anthropic",
    async start() { return call("board-inspect", BOARD_TOOL, {}); },
    async continueWith(input) {
      for (const result of input.results) {
        handed.push({ label: pendingLabel, text: result.outputText });
        if (pendingLabel === "board-inspect") continue;
        let nextCursor: string | null = null;
        try {
          const parsed = JSON.parse(result.outputText) as { output?: { page?: { nextCursor?: string | null } } };
          nextCursor = parsed.output?.page?.nextCursor ?? null;
        } catch { nextCursor = null; }
        cursor = typeof nextCursor === "string" ? nextCursor : null;
      }
      return next();
    },
  };
}

/** Run the walking model through the REAL loop and gateway over `board`; returns what it was handed and the canonical board. */
async function walk(board: PcbBoard, selections: readonly Selection[]): Promise<{ handed: Handed[]; canonical: PcbBoard }> {
  const [{ assembleAgentRunContext }, { createAgentToolGateway }, { runAgentLoop }, { DEFAULT_AGENT_BUDGET }, { AGENT_SYSTEM_PROMPT }, { sirkitToolRegistry }] = await Promise.all([
    import("@/app/lib/agent/context"), import("@/app/lib/agent/gateway"), import("@/app/lib/agent/loop"), import("@/app/lib/agent/contracts"), import("@/app/lib/prompts"), import("@/app/lib/engineering/tool-catalog"),
  ]);
  const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p24d2", branchId: "main", board });
  if (!assembly.ok) throw new Error(assembly.reason);
  const handed: Handed[] = [];
  const registry = sirkitToolRegistry();
  const result = await runAgentLoop(
    { runId: "run-b24-d2-board-read", provider: "anthropic", history: [], userMessage: "Read the whole routed board, one layer and one net at a time.", budget: { ...DEFAULT_AGENT_BUDGET, maxModelSteps: 400, maxToolCalls: 400, runDeadlineMs: 600_000 } },
    { adapter: walkingAdapter(selections, handed), gateway: createAgentToolGateway(registry, { now: () => 24_000_000 }), registry, context: assembly.context, system: AGENT_SYSTEM_PROMPT, emit: () => {}, contextWarnings: assembly.warnings },
  );
  expect(result.status).toBe("completed");
  return { handed, canonical: assembly.context.canonicalState!.pcb };
}

interface Snapshot { boardRevisionId: string; footprints: Item[]; pads: Item[]; nets: Item[]; tracks: Item[]; vias: Item[]; zones: Item[]; keepouts: Item[] }
type Point = { x: number; y: number };
type Region = { xMinMm: number; yMinMm: number; xMaxMm: number; yMaxMm: number };

/** The selection, re-derived here from board-inspect's own projections (an independent statement of the membership rules). */
function expectedSelection(snapshot: Snapshot, selector: { layer: string } | { netId: string } | { region: Region }): Record<Kind, Item[]> {
  const out: Record<Kind, Item[]> = { nets: [], footprints: [], pads: [], tracks: [], vias: [], zones: [], keepouts: [] };
  const inRegion = (r: Region, p: Point): boolean => p.x >= r.xMinMm && p.x <= r.xMaxMm && p.y >= r.yMinMm && p.y <= r.yMaxMm;
  const boxMeets = (r: Region, minX: number, minY: number, maxX: number, maxY: number): boolean => minX <= r.xMaxMm && maxX >= r.xMinMm && minY <= r.yMaxMm && maxY >= r.yMinMm;
  // a segment meets the rectangle when an end lies in it or it crosses one of the four edges
  const cross = (a: Point, b: Point, c: Point, d: Point): boolean => {
    const o = (p: Point, q: Point, s: Point): number => Math.sign((q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x));
    const on = (p: Point, q: Point, s: Point): boolean => Math.min(p.x, q.x) <= s.x && s.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= s.y && s.y <= Math.max(p.y, q.y);
    const [o1, o2, o3, o4] = [o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b)];
    if (o1 !== o2 && o3 !== o4) return true;
    return (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b));
  };
  const segmentMeets = (r: Region, a: Point, b: Point): boolean => {
    if (inRegion(r, a) || inRegion(r, b)) return true;
    const c = [{ x: r.xMinMm, y: r.yMinMm }, { x: r.xMaxMm, y: r.yMinMm }, { x: r.xMaxMm, y: r.yMaxMm }, { x: r.xMinMm, y: r.yMaxMm }];
    return [0, 1, 2, 3].some((index) => cross(a, b, c[index]!, c[(index + 1) % 4]!));
  };
  const polygonBoxMeets = (r: Region, polygon: Point[]): boolean => polygon.length > 0 && boxMeets(r, Math.min(...polygon.map((p) => p.x)), Math.min(...polygon.map((p) => p.y)), Math.max(...polygon.map((p) => p.x)), Math.max(...polygon.map((p) => p.y)));
  const span = (via: Item): string[] => {
    const [i0, i1] = [COPPER_ORDER.indexOf(String(via.startLayerId)), COPPER_ORDER.indexOf(String(via.endLayerId))];
    return i0 < 0 || i1 < 0 ? [] : COPPER_ORDER.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
  };
  if ("layer" in selector) {
    const L = selector.layer;
    out.pads = snapshot.pads.filter((pad) => (pad.layers as string[]).includes(L));
    const footprintIds = new Set(out.pads.map((pad) => String(pad.footprintId)));
    out.footprints = snapshot.footprints.filter((footprint) => footprintIds.has(footprint.id));
    out.tracks = snapshot.tracks.filter((track) => track.layerId === L);
    out.vias = snapshot.vias.filter((via) => span(via).includes(L));
    out.zones = snapshot.zones.filter((zone) => zone.layerId === L);
    out.keepouts = snapshot.keepouts.filter((keepout) => (keepout.layers as string[]).includes(L));
  } else if ("netId" in selector) {
    const n = selector.netId;
    out.nets = snapshot.nets.filter((net) => net.id === n);
    out.pads = snapshot.pads.filter((pad) => pad.netId === n);
    const footprintIds = new Set(out.pads.map((pad) => String(pad.footprintId)));
    out.footprints = snapshot.footprints.filter((footprint) => footprintIds.has(footprint.id));
    out.tracks = snapshot.tracks.filter((track) => track.netId === n);
    out.vias = snapshot.vias.filter((via) => via.netId === n);
    out.zones = snapshot.zones.filter((zone) => zone.netId === n);
  } else {
    const r = selector.region;
    out.footprints = snapshot.footprints.filter((footprint) => { const b = footprint.bodyBounds as { minX: number; minY: number; maxX: number; maxY: number }; return boxMeets(r, b.minX, b.minY, b.maxX, b.maxY); });
    out.pads = snapshot.pads.filter((pad) => inRegion(r, pad.position as Point));
    out.tracks = snapshot.tracks.filter((track) => { const [a, b] = track.geometry as [Point, Point]; return segmentMeets(r, a, b); });
    out.vias = snapshot.vias.filter((via) => inRegion(r, via.position as Point));
    out.zones = snapshot.zones.filter((zone) => polygonBoxMeets(r, zone.polygon as Point[]));
    out.keepouts = snapshot.keepouts.filter((keepout) => polygonBoxMeets(r, keepout.polygon as Point[]));
  }
  for (const kind of KINDS) out[kind] = [...out[kind]].sort((a, b) => byCodePoint(a.id, b.id));
  return out;
}

interface PageAnswer { schema: string; units: string; boardRevisionId: string; selector: Record<string, unknown>; counts: Partial<Record<Kind, number>>; page: number; pageCount: number; items: Partial<Record<Kind, Item[]>>; refusedItems: Array<{ kind: string; id: string; code: string; chars: number }>; nextCursor: string | null; refused?: { code: string } }
interface ResultEnvelope { ok: boolean; tool?: string; revision?: string; verification?: string; status?: string; output?: { page?: PageAnswer } }

/** The handed texts of one selection: each within the page constant, each a read answer of the paged tool; the pages joined. */
function joinPages(handed: readonly Handed[], label: string, maxChars: number): { pages: PageAnswer[]; joined: Record<Kind, Item[]>; refused: PageAnswer["refusedItems"] } {
  const texts = handed.filter((entry) => entry.label === label);
  expect(texts.length, `${label}: the model was handed at least one page`).toBeGreaterThan(0);
  const pages = texts.map(({ text }, index) => {
    expect(text.length, `${label} page ${index + 1}: ${text.length} characters`).toBeLessThanOrEqual(maxChars);
    const envelope = JSON.parse(text) as ResultEnvelope;
    expect(envelope, `${label} page ${index + 1}: ${text.slice(0, 300)}`).toMatchObject({ ok: true, tool: PAGE_TOOL, verification: "canonical-revision-verified" });
    expect(envelope.revision, label).toMatch(/^eng1-/);
    const page = envelope.output!.page!;
    expect(page.refused, `${label}: ${JSON.stringify(page.refused)}`).toBeUndefined();
    expect([page.page, page.pageCount], label).toEqual([index + 1, texts.length]);
    expect(page.nextCursor === null, label).toBe(index === texts.length - 1);
    return page;
  });
  const joined: Record<Kind, Item[]> = { nets: [], footprints: [], pads: [], tracks: [], vias: [], zones: [], keepouts: [] };
  for (const page of pages) for (const kind of KINDS) joined[kind].push(...(page.items[kind] ?? []));
  return { pages, joined, refused: pages.flatMap((page) => page.refusedItems) };
}

/** Every selected item on exactly one page, the joined pages equal to the re-derived selection, the true counts stated on every page. */
function expectSelection(label: string, result: ReturnType<typeof joinPages>, expected: Record<Kind, Item[]>): void {
  expect(result.refused, label).toEqual([]);
  for (const kind of KINDS) {
    const ids = result.joined[kind].map((item) => item.id);
    expect(new Set(ids).size, `${label} ${kind}: no item on two pages`).toBe(ids.length);
    expect(result.joined[kind], `${label} ${kind}`).toEqual(expected[kind]);
    for (const page of result.pages) if (page.counts[kind] !== undefined) expect(page.counts[kind], `${label} ${kind} count`).toBe(expected[kind].length);
  }
}

async function snapshotOf(board: PcbBoard): Promise<Snapshot> {
  const { buildAIPcbSnapshot } = await import("@/app/lib/pcb/ai/snapshot");
  return buildAIPcbSnapshot(board) as unknown as Snapshot;
}

async function enabledCopperLayers(board: PcbBoard): Promise<string[]> {
  const { getBoardStackup } = await import("@/app/lib/pcb/stackup");
  return getBoardStackup(board).copperLayers.filter((layer) => layer.enabled).map((layer) => layer.id);
}

describe("[B24-D2] a bounded, paged board read (D24-29, OD-213)", () => {
  it("1. through the real loop on each recorded ROUTED board: board-inspect is over the budget, and a model following nextCursor reads every layer and every net, each page within the page constant, the pages joined equal to that selection", { timeout: 180_000 }, async () => {
    const routed = await routedBoards();
    expect(routed.length).toBeGreaterThan(0);
    for (const { key, board } of routed) {
      expect(board.tracks.length, key).toBeGreaterThan(0);
      const layers = await enabledCopperLayers(board);
      const nets = board.nets.filter((net) => net.id !== 0).map((net) => ({ id: String(net.id), name: net.name || `net${net.id}` }));
      const selections: Selection[] = [...layers.map((layer) => ({ label: `layer:${layer}`, args: { layer } })), ...nets.map((net) => ({ label: `net:${net.id}`, args: { netName: net.name } }))];
      const { handed, canonical } = await walk(board, selections);
      const inspect = JSON.parse(handed.find((entry) => entry.label === "board-inspect")!.text) as ResultEnvelope;
      expect(inspect, `${key}: board-inspect on a routed board`).toMatchObject({ ok: false, status: "output_too_large_for_model" });
      // the model's view first: every paged call answered with board facts (on 3d5f225 each is refused unknown_tool)
      for (const entry of handed.filter((candidate) => candidate.label !== "board-inspect")) expect(JSON.parse(entry.text), `${key} ${entry.label}: ${entry.text.slice(0, 200)}`).toMatchObject({ ok: true, tool: PAGE_TOOL });
      const { BOARD_PAGE_MAX_RESULT_CHARS } = await import("@/app/lib/pcb/ai/board-pages");
      const snapshot = await snapshotOf(canonical);
      for (const layer of layers) expectSelection(`${key} layer ${layer}`, joinPages(handed, `layer:${layer}`, BOARD_PAGE_MAX_RESULT_CHARS), expectedSelection(snapshot, { layer }));
      for (const net of nets) expectSelection(`${key} net ${net.name}`, joinPages(handed, `net:${net.id}`, BOARD_PAGE_MAX_RESULT_CHARS), expectedSelection(snapshot, { netId: net.id }));
      // every track, via and pad of the routed board is reachable through the layer pages
      const fromLayers = new Set(layers.flatMap((layer) => joinPages(handed, `layer:${layer}`, BOARD_PAGE_MAX_RESULT_CHARS).joined.tracks.map((track) => track.id)));
      expect([...fromLayers].sort(byCodePoint), key).toEqual(snapshot.tracks.map((track) => track.id).sort(byCodePoint));
    }
  });

  it("2. the review: the constant and its margin within MAX_RESULT_CHARS; a Tier 0 read modelled on via-inspect, discovered wherever via-inspect is, in the reviewed agent set, withheld from MCP although servable from durable state", async () => {
    const [{ MAX_RESULT_CHARS }, pages, { sirkitToolRegistry }, { resolveReadBinding, ACTIVATED_READ_BINDINGS }, { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS }, { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS, mcpExposureReport }, { permissionTierOfDescriptor }, { discoverTools }, { DURABLE_BUILDABLE_RESOURCE_KINDS }] = await Promise.all([
      import("@/app/lib/agent/loop"), import("@/app/lib/pcb/ai/board-pages"), import("@/app/lib/engineering/tool-catalog"), import("@/app/lib/engineering/tool-bindings-readonly"), import("@/app/lib/engineering/agent-exposure"), import("@/app/lib/engineering/mcp-exposure"), import("@/app/lib/engineering/permission-tiers"), import("@/app/lib/engineering/tool-discovery"), import("@/app/lib/engineering/durable-read-bundle"),
    ]);
    expect(MAX_RESULT_CHARS).toBe(60_000);
    expect(pages.BOARD_PAGE_MAX_RESULT_CHARS + pages.BOARD_PAGE_MARGIN_CHARS).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect([pages.BOARD_PAGE_MAX_RESULT_CHARS, pages.BOARD_PAGE_MARGIN_CHARS]).toEqual([48_000, 12_000]);
    const registry = sirkitToolRegistry();
    const page = registry.get(PAGE_TOOL)!;
    const via = registry.get(VIA_TOOL)!;
    expect(page).toMatchObject({ version: "1.0.0", operationClass: "read", sideEffects: "none", approvalTier: "none", agentExposed: true, callability: "callable", discovery: "discoverable", lifecycle: "active" });
    expect(page.executionMode).toBeUndefined();
    expect(permissionTierOfDescriptor(page)).toBe(0);
    for (const field of ["owningCommandId", "requiredCapability", "requiredRoles", "requiredProjectState", "requiredAuthority", "requiredSelectionKinds", "category", "budgetClass", "timeoutMs"] as const) expect(page[field], field).toEqual(via[field]);
    expect(page.binding).toMatchObject({ status: "bound-read", module: "app/lib/pcb/ai/board-pages.ts", symbol: "buildBoardPage" });
    const resolution = resolveReadBinding(page);
    expect(resolution.state).toBe("resolved");
    const binding = ACTIVATED_READ_BINDINGS.find((entry) => entry.toolId === PAGE_TOOL)!;
    expect(binding).toMatchObject({ bindingId: "read.board-page", bindingVersion: "1.0.0", kind: "read", requiredResources: ["canonical-state"] });
    expect(binding.optionalResources).toBeUndefined();
    // the wire schema carries no bounds (the [B09.1] rule): the limits are the server's
    expect(JSON.stringify(page.inputSchema)).not.toMatch(/maxLength|maxItems|minimum|maximum|pattern/);
    expect(Object.keys((page.inputSchema as { properties: object }).properties).sort()).toEqual(["cursor", "layer", "netName", "xMaxMm", "xMinMm", "yMaxMm", "yMinMm"]);
    expect((page.inputSchema as { required?: unknown }).required).toBeUndefined();
    // the selection rule is stated on the descriptor
    for (const phrase of ["layer", "net", "region", "nextCursor", "item_over_budget", "stale_cursor"]) expect(page.verificationStrategy, phrase).toContain(phrase);
    // discovered wherever via-inspect is: the same inclusion, or the same exclusion reason, under every context
    const base = { tenantId: "tenant-a", projectId: "project-a", branchId: "main", actorId: "local-editor", lineageId: "lin1-lineage", currentEditor: "pcb" as const, currentRevisionDigest: "eng1-headdigest", selectedKinds: [], providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 100 }, enabledFlags: [], requestedCategories: [] };
    const contexts = {
      agent: { ...base, channel: "assistant-agent", actorRole: "pcb_editor", grantedCapabilities: ["read_project"], projectState: ["board-present", "schematic-present"], availableAuthority: ["local-working-copy"], riskCeiling: "propose", approvalsAvailable: [] },
      agentDurable: { ...base, channel: "assistant-agent", actorRole: "viewer", grantedCapabilities: ["read_project"], projectState: ["board-present"], availableAuthority: ["durable-server-board"], riskCeiling: "propose", approvalsAvailable: [] },
      agentNoBoard: { ...base, channel: "assistant-agent", actorRole: "pcb_editor", grantedCapabilities: ["read_project"], projectState: ["schematic-present"], availableAuthority: ["local-working-copy"], riskCeiling: "propose", approvalsAvailable: [] },
      agentNoRead: { ...base, channel: "assistant-agent", actorRole: "pcb_editor", grantedCapabilities: [], projectState: ["board-present"], availableAuthority: ["local-working-copy"], riskCeiling: "propose", approvalsAvailable: [] },
      editor: { ...base, channel: "interactive-ui", actorRole: "project_admin", grantedCapabilities: ["read_project", "edit_placement"], projectState: ["board-present", "schematic-present"], availableAuthority: ["local-working-copy", "durable-server-board"], riskCeiling: "destructive", approvalsAvailable: ["reversible"] },
    } as unknown as Record<string, Parameters<typeof discoverTools>[1]>;
    const fate = (result: ReturnType<typeof discoverTools>, toolId: string): string => (result.included.some((item) => item.toolId === toolId) ? "included" : result.excluded.find((item) => item.toolId === toolId)?.reason ?? "unreported");
    let included = 0;
    for (const [name, context] of Object.entries(contexts)) {
      const result = discoverTools(registry, context);
      expect(fate(result, PAGE_TOOL), name).toBe(fate(result, VIA_TOOL));
      if (fate(result, PAGE_TOOL) === "included") included += 1;
    }
    expect(included).toBeGreaterThanOrEqual(2);
    // exposure: the reviewed agent set; MCP withheld by a reviewed choice, although the read is servable from durable state
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toContain(PAGE_TOOL);
    expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS).not.toContain(PAGE_TOOL);
    expect(MCP_WITHHELD_TOOL_IDS).toContain(PAGE_TOOL);
    expect(binding.requiredResources.every((kind) => (DURABLE_BUILDABLE_RESOURCE_KINDS as readonly string[]).includes(kind))).toBe(true);
    expect(page.requiredAuthority).toContain("durable-server-board");
    expect(page.requiredProjectState).toEqual(["board-present"]);
    const report = mcpExposureReport(registry);
    expect(report.ok).toBe(true);
    expect([...report.excludedByReason.withheld]).toContain(PAGE_TOOL);
  });

  it("3. a deterministic synthetic board with ten times the routed blinker's tracks: every layer and every net paged through the loop within the constant, at least one selection over several pages, the pages joined equal to the selection", { timeout: 300_000 }, async () => {
    const board = await syntheticBoard();
    const layers = await enabledCopperLayers(board);
    const nets = board.nets.filter((net) => net.id !== 0).map((net) => ({ id: String(net.id), name: net.name || `net${net.id}` }));
    const selections: Selection[] = [...layers.map((layer) => ({ label: `layer:${layer}`, args: { layer } })), ...nets.map((net) => ({ label: `net:${net.id}`, args: { netName: net.name } }))];
    const { handed, canonical } = await walk(board, selections);
    const { BOARD_PAGE_MAX_RESULT_CHARS } = await import("@/app/lib/pcb/ai/board-pages");
    const snapshot = await snapshotOf(canonical);
    let multiPage = 0;
    for (const layer of layers) {
      const result = joinPages(handed, `layer:${layer}`, BOARD_PAGE_MAX_RESULT_CHARS);
      if (result.pages.length > 1) multiPage += 1;
      expectSelection(`synthetic layer ${layer}`, result, expectedSelection(snapshot, { layer }));
    }
    for (const net of nets) {
      const result = joinPages(handed, `net:${net.id}`, BOARD_PAGE_MAX_RESULT_CHARS);
      if (result.pages.length > 1) multiPage += 1;
      expectSelection(`synthetic net ${net.name}`, result, expectedSelection(snapshot, { netId: net.id }));
    }
    expect(multiPage, "the synthetic board needs more than one page somewhere").toBeGreaterThan(0);
  });

  it("4. a flat region on a routed board and on the synthetic board: the pages joined equal the region's selection", { timeout: 180_000 }, async () => {
    const [{ board }] = await routedBoards();
    const synthetic = await syntheticBoard();
    const { BOARD_PAGE_MAX_RESULT_CHARS } = await import("@/app/lib/pcb/ai/board-pages");
    for (const [label, target, region] of [["routed", board, { xMinMm: 2, yMinMm: 2, xMaxMm: 11, yMaxMm: 12 }], ["synthetic", synthetic, { xMinMm: 0, yMinMm: 0, xMaxMm: 105, yMaxMm: 21 }]] as const) {
      const { handed, canonical } = await walk(target, [{ label: `region:${label}`, args: { ...region } }]);
      const snapshot = await snapshotOf(canonical);
      const expected = expectedSelection(snapshot, { region });
      expect(expected.tracks.length + expected.pads.length, label).toBeGreaterThan(0);
      expectSelection(`${label} region`, joinPages(handed, `region:${label}`, BOARD_PAGE_MAX_RESULT_CHARS), expected);
    }
  });

  it("5. the selector refusals: none, two, a partial region, an inverted region, an unknown layer, an unknown net - each a closed code, answered as a read through the gateway, nothing guessed", { timeout: 60_000 }, async () => {
    const { buildBoardPage, BOARD_PAGE_REFUSALS } = await import("@/app/lib/pcb/ai/board-pages");
    const [{ board }] = await routedBoards();
    const refusal = (args: Record<string, unknown>): string | undefined => (buildBoardPage(board, args) as { refused?: { code: string } }).refused?.code;
    expect(refusal({})).toBe("selector_missing");
    expect(refusal({ layer: "  " })).toBe("selector_missing");
    expect(refusal({ layer: "copperTop", netName: "/root/GND" })).toBe("selector_doubled");
    expect(refusal({ layer: "copperTop", xMinMm: 0, yMinMm: 0, xMaxMm: 1, yMaxMm: 1 })).toBe("selector_doubled");
    expect(refusal({ xMinMm: 0, yMinMm: 0, xMaxMm: 1 })).toBe("region_incomplete");
    expect(refusal({ xMinMm: 5, yMinMm: 0, xMaxMm: 1, yMaxMm: 1 })).toBe("region_inverted");
    expect(refusal({ xMinMm: 0, yMinMm: 5, xMaxMm: 1, yMaxMm: 1 })).toBe("region_inverted");
    expect(refusal({ layer: "in1" })).toBe("unknown_layer");
    expect(refusal({ layer: "silkTop" })).toBe("unknown_layer");
    expect(refusal({ netName: "5 V" })).toBe("unknown_net");
    expect(refusal({ netName: "  /ROOT/gnd " })).toBeUndefined();
    expect([...BOARD_PAGE_REFUSALS].sort()).toEqual(["cursor_invalid", "region_incomplete", "region_inverted", "selector_doubled", "selector_missing", "stale_cursor", "unknown_layer", "unknown_net"]);
    const unknownNet = buildBoardPage(board, { netName: "5 V" }) as unknown as { refused: { code: string; known: string[]; knownCount: number } };
    expect(unknownNet.refused.known).toContain("/root/GND");
    expect(unknownNet.refused.knownCount).toBe(board.nets.filter((net) => net.id !== 0).length);
    const unknownLayer = buildBoardPage(board, { layer: "in1" }) as unknown as { refused: { known: string[] } };
    expect(unknownLayer.refused.known).toEqual(["copperTop", "copperBottom"]);
    // through the gateway the refusal reaches the model as a read answer, and the board is unchanged
    const [{ assembleAgentRunContext }, { createAgentToolGateway }, { sirkitToolRegistry }, { pcbRevisionId }] = await Promise.all([import("@/app/lib/agent/context"), import("@/app/lib/agent/gateway"), import("@/app/lib/engineering/tool-catalog"), import("@/app/lib/pcb/revision")]);
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p24d2", branchId: "main", board });
    if (!assembly.ok) throw new Error(assembly.reason);
    const before = pcbRevisionId(assembly.context.canonicalState!.pcb);
    const outcome = await createAgentToolGateway(sirkitToolRegistry(), { now: () => 24_000_000 }).invoke({ runId: "run-b24-d2-refusal", provider: "anthropic", toolId: PAGE_TOOL, version: "1.0.0", args: { netName: "5 V" }, context: assembly.context, timeoutMs: 10_000 });
    expect(outcome).toMatchObject({ kind: "read", ok: true });
    expect((outcome as unknown as { output: { page: { refused: { code: string } } } }).output.page.refused.code).toBe("unknown_net");
    expect(pcbRevisionId(assembly.context.canonicalState!.pcb)).toBe(before);
  });

  it("6. an item larger than a whole page is refused by kind and id (item_over_budget) where it falls, never truncated, and every other item still pages", { timeout: 60_000 }, async () => {
    const { buildBoardPage, BOARD_PAGE_OUTPUT_CHARS } = await import("@/app/lib/pcb/ai/board-pages");
    const [{ board }] = await routedBoards();
    const huge = JSON.parse(JSON.stringify(board)) as PcbBoard;
    const polygon = Array.from({ length: 4_000 }, (_, index) => ({ x: 1_000_000 + (index % 2) * 1_234_567 + index * 1_000, y: 1_000_000 + index * 3_000 }));
    huge.routingKeepouts = [{ id: "keepout-over-budget", polygon, layers: ["copperTop"], forbidTracks: true, forbidVias: false }, { id: "keepout-small", polygon: polygon.slice(0, 4), layers: ["copperTop"], forbidTracks: true, forbidVias: false }];
    const pages: Array<{ items: Partial<Record<Kind, Item[]>>; refusedItems: Array<{ kind: string; id: string; code: string; chars: number }>; nextCursor: string | null }> = [];
    let cursor: string | null = null;
    do {
      const answer = buildBoardPage(huge, { layer: "copperTop", ...(cursor ? { cursor } : {}) }) as unknown as (typeof pages)[number] & { refused?: unknown };
      expect(answer.refused).toBeUndefined();
      expect(JSON.stringify(answer).length).toBeLessThanOrEqual(BOARD_PAGE_OUTPUT_CHARS);
      pages.push(answer);
      cursor = answer.nextCursor;
    } while (cursor);
    const refused = pages.flatMap((page) => page.refusedItems);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ kind: "keepouts", id: "keepout-over-budget", code: "item_over_budget" });
    expect(refused[0]!.chars).toBeGreaterThan(BOARD_PAGE_OUTPUT_CHARS);
    const keepouts = pages.flatMap((page) => page.items.keepouts ?? []);
    expect(keepouts.map((keepout) => keepout.id)).toEqual(["keepout-small"]);
    expect((keepouts[0]!.polygon as unknown[]).length, "never truncated: the small one is whole").toBe(4);
    const snapshot = await snapshotOf(huge);
    expect(pages.flatMap((page) => page.items.tracks ?? []).map((track) => track.id)).toEqual(snapshot.tracks.filter((track) => track.layerId === "copperTop").map((track) => track.id).sort(byCodePoint));
  });

  it("7. a cursor is bound to the board revision and the selector: with another selector or another revision it is stale_cursor; a malformed one is cursor_invalid", { timeout: 120_000 }, async () => {
    const { buildBoardPage } = await import("@/app/lib/pcb/ai/board-pages");
    const board = await syntheticBoard();
    const first = buildBoardPage(board, { layer: "copperTop" }) as unknown as { nextCursor: string | null; pageCount: number };
    expect(first.pageCount).toBeGreaterThan(1);
    const cursor = first.nextCursor!;
    expect(cursor).toMatch(/^bp1\.2\.[0-9a-f]{8}$/);
    const second = buildBoardPage(board, { layer: "copperTop", cursor }) as unknown as { page: number; refused?: unknown };
    expect(second.refused).toBeUndefined();
    expect(second.page).toBe(2);
    const code = (target: PcbBoard, args: Record<string, unknown>): string | undefined => (buildBoardPage(target, args) as { refused?: { code: string } }).refused?.code;
    expect(code(board, { layer: "copperBottom", cursor })).toBe("stale_cursor");
    expect(code(board, { netName: "/root/GND", cursor })).toBe("stale_cursor");
    const moved = JSON.parse(JSON.stringify(board)) as PcbBoard;
    moved.footprints[0]!.at = { x: moved.footprints[0]!.at.x + 100_000, y: moved.footprints[0]!.at.y };
    expect(code(moved, { layer: "copperTop", cursor })).toBe("stale_cursor");
    for (const bad of ["garbage", "bp1.1.00000000", "bp1.x.00000000", `${cursor}0`, "bp2.2.00000000"]) expect(code(board, { layer: "copperTop", cursor: bad }), bad).toBe("cursor_invalid");
    expect(code(board, { layer: "copperTop", cursor: cursor.replace(/\.[0-9a-f]{8}$/, ".00000000") })).toBe("stale_cursor");
  });

  it("8. the same board and the same arguments give the same bytes, in a stable order: kinds in BOARD_PAGE_KINDS, ids by code point", { timeout: 60_000 }, async () => {
    const { buildBoardPage, BOARD_PAGE_KINDS } = await import("@/app/lib/pcb/ai/board-pages");
    expect([...BOARD_PAGE_KINDS]).toEqual([...KINDS]);
    const [{ board }] = await routedBoards();
    for (const args of [{ layer: "copperTop" }, { netName: "/root/GND" }, { xMinMm: 0, yMinMm: 0, xMaxMm: 21, yMaxMm: 21 }]) {
      const once = JSON.stringify(buildBoardPage(board, args));
      const twice = JSON.stringify(buildBoardPage(JSON.parse(JSON.stringify(board)) as PcbBoard, args));
      expect(twice, JSON.stringify(args)).toBe(once);
      const answer = JSON.parse(once) as { items: Record<string, Item[]> };
      expect(Object.keys(answer.items)).toEqual(KINDS.filter((kind) => Object.hasOwn(answer.items, kind)));
      for (const items of Object.values(answer.items)) expect(items.map((item) => item.id)).toEqual(items.map((item) => item.id).sort(byCodePoint));
    }
  });

  it("9. OD-236 approved: strict-rendered optional nulls answer identically to omitted fields", { timeout: 120_000 }, async () => {
    // Red first on the D2 tree (d2fix-red-1): written as "the strict-shaped call answers as the plain one does", it received
    // {"ok":false,"status":"invalid_input","diagnostics":["args.netName: must be a string","args.xMinMm: must be a finite number",...]}.
    // The owner approved OD-236: the agent boundary now inverts only synthetic optional nulls.
    // The original B24 red evidence remains in the historical artifacts; B05 validation stays unchanged.
    const [{ strictCompatibility }, { sirkitToolRegistry }, { createAgentToolGateway }, { assembleAgentRunContext }] = await Promise.all([import("@/app/lib/agent/provider-tools"), import("@/app/lib/engineering/tool-catalog"), import("@/app/lib/agent/gateway"), import("@/app/lib/agent/context")]);
    const registry = sirkitToolRegistry();
    const strictShape = (toolId: string, set: Record<string, unknown>): Record<string, unknown> => {
      const strict = strictCompatibility(registry.get(toolId)!);
      if (!strict.ok) throw new Error(strict.reason);
      return { ...Object.fromEntries(((strict.schema as { required: string[] }).required).map((name) => [name, null])), ...set };
    };
    const shaped = strictShape(PAGE_TOOL, { layer: "copperTop" });
    expect(Object.keys(shaped).sort()).toEqual(["cursor", "layer", "netName", "xMaxMm", "xMinMm", "yMaxMm", "yMinMm"]);
    const [{ board }] = await routedBoards();
    const { handed } = await walk(board, [{ label: "strict", args: shaped }, { label: "plain", args: { layer: "copperTop" } }]);
    const strictTexts = handed.filter((entry) => entry.label === "strict").map((entry) => entry.text);
    const plainTexts = handed.filter((entry) => entry.label === "plain").map((entry) => entry.text);
    expect(JSON.parse(plainTexts[0]!), "the plain call answers").toMatchObject({ ok: true, tool: PAGE_TOOL });
    expect(strictTexts.length).toBeGreaterThan(0);
    expect(strictTexts.map((text) => JSON.parse(text))).toEqual(plainTexts.map((text) => JSON.parse(text)));
    // via-inspect's synthetic optional null likewise means read all nets.
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p24d2", branchId: "main", board });
    if (!assembly.ok) throw new Error(assembly.reason);
    const gateway = createAgentToolGateway(registry, { now: () => 24_000_000 });
    const invoke = (args: Record<string, unknown>) => gateway.invoke({ runId: "run-b24-d2-strict", provider: "anthropic", toolId: VIA_TOOL, version: "1.0.0", args, context: assembly.context, timeoutMs: 10_000 });
    expect(strictShape(VIA_TOOL, {})).toEqual({ netName: null });
    expect(await invoke({ netName: null }), "via-inspect with its strict-shaped null").toMatchObject({ ok: true });
    expect(await invoke({}), "via-inspect without it").toMatchObject({ ok: true });
  });

  it("10. the page bound holds on the model-bound text: names the sanitizer lengthens (a URL-credential shape becomes [redacted]) never push a page or a refusal over the constant", { timeout: 180_000 }, async () => {
    const [{ BOARD_PAGE_MAX_RESULT_CHARS }, { sanitizeModelBoundText }] = await Promise.all([import("@/app/lib/pcb/ai/board-pages"), import("@/app/lib/agent/redaction")]);
    const UNIT = "a://@ ";
    expect(sanitizeModelBoundText(UNIT.repeat(3)), "each unit grows by five characters").toBe("[redacted] ".repeat(3));
    // (a) every footprint's library name made of the unit (board-inspect's projection carries it twice: value and footprintName)
    const [{ board: routed }] = await routedBoards();
    const named = JSON.parse(JSON.stringify(routed)) as PcbBoard;
    for (const footprint of named.footprints) footprint.def = { ...footprint.def, name: `${footprint.ref}-${UNIT.repeat(1_200)}` };
    const layers = await enabledCopperLayers(named);
    const { handed, canonical } = await walk(named, layers.map((layer) => ({ label: `layer:${layer}`, args: { layer } })));
    const snapshot = await snapshotOf(canonical);
    for (const layer of layers) {
      const texts = handed.filter((entry) => entry.label === `layer:${layer}`);
      for (const [index, { text }] of texts.entries()) {
        expect(text.length, `layer ${layer} page ${index + 1}: ${text.length} characters as handed`).toBeLessThanOrEqual(BOARD_PAGE_MAX_RESULT_CHARS);
        expect(JSON.parse(text), `layer ${layer} page ${index + 1}: ${text.slice(0, 160)}`).toMatchObject({ ok: true, tool: PAGE_TOOL });
      }
      const pages = texts.map(({ text }) => (JSON.parse(text) as ResultEnvelope).output!.page!);
      expect(pages.at(-1)!.nextCursor, layer).toBeNull();
      const ids = pages.flatMap((page) => (page.items.footprints ?? []).map((item) => item.id));
      expect(ids, `layer ${layer}: every footprint on exactly one page`).toEqual(expectedSelection(snapshot, { layer }).footprints.map((item) => item.id));
      expect(pages.flatMap((page) => page.refusedItems), layer).toEqual([]);
    }
    // (b) a refusal listing known names: 80 more nets whose names are made of the unit; the list stays within the constant, with
    // the true count beside it and a prefix of the names in their own order
    const crowded = JSON.parse(JSON.stringify(routed)) as PcbBoard;
    const template = crowded.nets.find((net) => net.id !== 0)!;
    for (let index = 0; index < 80; index += 1) crowded.nets.push({ ...template, id: 5_000 + index, name: `N${index}-${UNIT.repeat(300)}`, ...("stableId" in template ? { stableId: `b24d2-crowded-${index}` } : {}), ...("endpointKeys" in template ? { endpointKeys: [] } : {}) } as typeof template);
    const refusal = await walk(crowded, [{ label: "unknown", args: { netName: "no such net" } }]);
    const text = refusal.handed.find((entry) => entry.label === "unknown")!.text;
    expect(text.length, `the refusal as handed: ${text.length} characters`).toBeLessThanOrEqual(BOARD_PAGE_MAX_RESULT_CHARS);
    const answer = JSON.parse(text) as ResultEnvelope & { output?: { page?: { refused?: { code: string; known: string[]; knownCount: number } } } };
    expect(answer, text.slice(0, 160)).toMatchObject({ ok: true, tool: PAGE_TOOL });
    const refused = answer.output!.page!.refused!;
    const allNames = (await snapshotOf(refusal.canonical)).nets.map((net) => sanitizeModelBoundText(String(net.name)));
    expect(refused.code).toBe("unknown_net");
    expect(refused.knownCount).toBe(allNames.length);
    expect(refused.known.length, "some names, not all").toBeGreaterThan(0);
    expect(refused.known.length).toBeLessThan(allNames.length);
    expect(refused.known).toEqual(allNames.slice(0, refused.known.length));
  });
});
