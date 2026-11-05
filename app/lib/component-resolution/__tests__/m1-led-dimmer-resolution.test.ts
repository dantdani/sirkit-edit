/**
 * [PR-M, 2026-10-17] Section M increment 1 - the LED-dimmer D1 / D2 reproduction as a faithful, isolated equivalent, over the
 * PRODUCTION path end to end (runbook M.5 items 1-3 and the relevant part of 6).
 *
 * The owner's transcript: a generated LED dimmer left D1 and D2 (1N4148) without published exact-part authority; the assistant
 * could not inspect, search or replace them because every tool it found needed a board. Here a valid schematic with NO PCB and two
 * unresolved instances is repaired through the real services:
 *
 *  - a real, migrated PostgreSQL (PGlite + pgvector) holds the catalog the way ingestion and publication write it: libraries named
 *    by `categorizeLib`, parts with their KiCad pins and embeddings, and REAL published atomic revisions (production KiCad parsers,
 *    mapping certificates and catalog transitions; _m1-fixtures.ts) written by `publishPortableAtomicSnapshot` with their catalog
 *    links, one of them withdrawn by `withdrawPublishedAtomicRevision`;
 *  - the chat route's REAL runtime boundaries answer the agent: `resolveCatalogInspectionPort` (loadCatalogPartDetail +
 *    loadAtomicRevisionStatus) and `resolveComponentResolutionPorts` (loadSelectablePortableSnapshot + the projection, and the
 *    Build loop's own `searchPartsForAI`) - the only seams are the embedding (a hashed bag of words, no provider) and the reranker
 *    (a fake that refuses with Anthropic's credit error, so the order is the fused fallback);
 *  - the agent's REAL gateway and run toolset, over a context assembled from the schematic alone (no board, no browser authority);
 *  - the human's apply through the REAL SchematicEditorSession, gesture coordinator, adoption, commit interlock, durable journal and
 *    one-shot registry, with a one-shot approval intent and a branded fresh-facts channel whose server half is the real
 *    `loadFreshResolutionFacts` over the same production ports.
 *
 * No product logic names D1, D2, 1N4148 or any catalog id: the test names them only to set up and read the sheet.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/app/lib/db/schema";
import { loadMigrationManifest } from "@/app/lib/db/migrations/manifest";
import { migrateDatabase } from "@/app/lib/db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "@/app/lib/db/disposable-postgres";
import { categorizeLib } from "@/app/lib/kicad/categories";
import type { KicadPin } from "@/app/lib/kicad/types";
import type { SchematicState } from "@/lib/schematic-types";

const seams = vi.hoisted(() => {
  function hashed(text: string): number[] {
    const vector = new Array<number>(1_536).fill(0);
    vector[0] = 0.05;
    for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 2_166_136_261;
      for (let index = 0; index < token.length; index++) hash = Math.imul(hash ^ token.charCodeAt(index), 16_777_619) >>> 0;
      vector[1 + (hash % 1_535)]! += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return vector.map((value) => value / norm);
  }
  return { hashed, embedded: [] as string[], rerank: vi.fn() };
});

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/app/lib/db/client", () => ({ getDb: () => orm }));
vi.mock("@/app/lib/embeddings", async (original) => ({ ...(await original() as object), embedQuery: vi.fn(async (text: string) => { seams.embedded.push(text); return seams.hashed(text); }) }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class OfflineReranker { messages = { create: (...args: unknown[]) => seams.rerank(...args) }; } }));

import { blinkerCatalog, BLINKER_PART_IDS } from "@/app/lib/fixture-runtime/blinker/catalog";
import { normalizeValueKey } from "@/app/lib/atomic/value-key";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { buildRunToolset, runAgentLoop } from "@/app/lib/agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type GatewayInvocationOutcome, type ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resolveComponentResolutionPorts } from "@/app/api/chat/component-resolution-runtime";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry } from "@/app/lib/engineering/approved-agent-mutations";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore, type JournalWrite } from "@/app/lib/engineering/approved-mutation-journal";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { buildNetlist } from "@/app/lib/pcb/netlist-bridge";
import { buildPcbSyncPreflightReport } from "@/app/lib/pcb-sync/preflight-read";
import { netlistLookupOf, type CatalogPartLoad } from "../instance-facts";
import { loadCatalogParts, loadFreshResolutionFacts } from "../facts-loader";
import type { SealedResolutionProposal } from "../resolution-proposal";
import { applyApprovedResolutionProposal, RESOLUTION_RECEIPT_SCHEMA } from "../approved-resolution-mutations";
import { issueResolutionApprovalIntent } from "../resolution-approval.internal";
import { __createTestResolutionReauthorizationChannel } from "../resolution-reauthorization";
import { COMPONENT_RESOLUTION_READY_EVENT, componentResolutionCurrency, componentResolutionReviewRows, receiveComponentResolutionEvent } from "../resolution-events";
import { DIODE_1N4148_PINS, D_AK_SYMBOL_SOURCE, D_SYMBOL_SOURCE, extractedPins, ledDimmerSheet, swappedSymbolDiodeRevision, switchingDiodeRevision, type DimmerResolvedIdentity } from "./_m1-fixtures";

const PROJECT = "p-m1-led-dimmer";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: "main" } as const;
const creditRefusal = () => Object.assign(new Error("400 credit balance"), { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } } });

const ids = new Map<string, string>();
const revisions = { w: "", ws: "", ak: "" };
const resolvedIdentity = new Map<string, DimmerResolvedIdentity>();

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const { publishPortableAtomicSnapshot, withdrawPublishedAtomicRevision } = await import("@/app/lib/atomic/server-repository");
  const blinker = blinkerCatalog();
  const libraryIds = new Map<string, string>();
  const library = async (name: string): Promise<string> => {
    if (!libraryIds.has(name)) libraryIds.set(name, (await pg.db.query<{ id: string }>("INSERT INTO libraries (name, main_category) VALUES ($1, $2) RETURNING id", [name, categorizeLib(name)])).rows[0]!.id);
    return libraryIds.get(name)!;
  };
  const part = async (key: string, input: { library: string; name: string; description: string; keywords: string; mpn: string | null; pins: readonly KicadPin[]; generic: boolean; footprintHint?: string }) => {
    const embedding = `[${seams.hashed(`${input.name} ${input.description} ${input.keywords}`).join(",")}]`;
    const row = await pg.db.query<{ id: string }>(
      "INSERT INTO parts (library_id, name, description, keywords, mpn, properties, pins, symbol_raw, is_generic, embedding, lifecycle_status, footprint_hint) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6::jsonb, '', $7, $8::vector, 'active', $9) RETURNING id",
      [await library(input.library), input.name, input.description, input.keywords, input.mpn, JSON.stringify(input.pins), input.generic, embedding, input.footprintHint ?? null],
    );
    ids.set(key, row.rows[0]!.id);
    return row.rows[0]!.id;
  };
  const publish = async (snapshot: Parameters<typeof publishPortableAtomicSnapshot>[0]["snapshot"], links: Array<{ partId: string; valueKey: string }>) => publishPortableAtomicSnapshot({ snapshot: structuredClone(snapshot), actorId: "user:fixture-publisher", actorRole: "publisher", requiredProfile: "pcb_assignable", reason: "PR-M fixture publication", links });

  // the resolved parts of the sheet: the blinker's published timer, resistor, capacitor (and its LED, a same-pin-names decoy)
  for (const [key, blinkerId, value, keywords, generic] of [["timer", BLINKER_PART_IDS.timer, "", "single timer 555", false], ["resistor", BLINKER_PART_IDS.resistor, "10k", "R res resistor", true], ["capacitor", BLINKER_PART_IDS.capacitor, "10nF", "cap capacitor", true], ["led", BLINKER_PART_IDS.led, "", "LED diode", true]] as const) {
    const cached = blinker.cachedParts.get(blinkerId)!;
    const partId = await part(key, { library: cached.libraryName === "Timer" ? "Timer" : "Device", name: cached.name, description: cached.description ?? cached.name, keywords, mpn: null, pins: cached.pins, generic });
    const revisionId = blinker.revisionFor(blinkerId, value)!;
    await publish(blinker.snapshots.get(revisionId)!, [{ partId, valueKey: normalizeValueKey(value) }]);
    const assignment = cached.atomicAssignments![normalizeValueKey(value)]!;
    resolvedIdentity.set(key, { atomicPartRevisionId: assignment.revisionId, symbolAssetVersionId: assignment.symbolVersionId, footprintAssetVersionId: assignment.footprintVersionId, mappingCertificateId: assignment.mappingCertificateId });
  }
  // the unresolved diode the dimmer was generated with: a real catalog part, NO published exact revision
  await part("1n4148", { library: "Diode", name: "1N4148", description: "100V 0.15A standard switching diode, DO-35", keywords: "diode", mpn: "1N4148", pins: DIODE_1N4148_PINS, generic: false, footprintHint: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal" });
  // candidates: an eligible SOD-123 switching diode, the same on a pin-swapped symbol, a withdrawn one, a Schottky with nothing published
  const w = switchingDiodeRevision("m1-db-w", "1N4148W-7-F");
  await publish(w.snapshot, [{ partId: await part("1n4148w", { library: "Diode", name: "1N4148W", description: "75V 0.15A fast switching diode, SOD-123", keywords: "diode switching small signal", mpn: "1N4148W-7-F", pins: extractedPins(D_SYMBOL_SOURCE, "D").pins, generic: false }), valueKey: "" }]);
  revisions.w = w.revisionId;
  const ak = swappedSymbolDiodeRevision("m1-db-ak", "1N4148WAK-7-F");
  await publish(ak.snapshot, [{ partId: await part("d-ak", { library: "Diode", name: "D_AK", description: "fast switching diode, SOD-123, anode on pin 1", keywords: "diode switching", mpn: "1N4148WAK-7-F", pins: extractedPins(D_AK_SYMBOL_SOURCE, "D_AK").pins, generic: false }), valueKey: "" }]);
  revisions.ak = ak.revisionId;
  const ws = switchingDiodeRevision("m1-db-ws", "1N4148WS-7-F");
  await publish(ws.snapshot, [{ partId: await part("1n4148ws", { library: "Diode", name: "1N4148WS", description: "75V 0.15A fast switching diode, SOD-323", keywords: "diode switching", mpn: "1N4148WS-7-F", pins: extractedPins(D_SYMBOL_SOURCE, "D").pins, generic: false }), valueKey: "" }]);
  revisions.ws = ws.revisionId;
  await withdrawPublishedAtomicRevision({ revisionId: ws.revisionId, to: "revoked", actorId: "user:fixture-publisher", actorRole: "publisher", reason: "PR-M fixture: a withdrawn candidate" });
  await part("1n5819", { library: "Diode", name: "1N5819", description: "40V 1A Schottky Barrier Rectifier Diode, DO-41", keywords: "diode Schottky", mpn: "1N5819", pins: DIODE_1N4148_PINS, generic: false });
}, 240_000);
afterAll(async () => { await pg?.close(); });

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://catalog-configured-placeholder"); // presence only: the runtime boundaries read the setting, never its value (the client is the PGlite above)
  vi.stubEnv("ANTHROPIC_API_KEY", "offline-test-placeholder");
  vi.stubEnv("OPENAI_API_KEY", "");
  seams.embedded.length = 0;
  seams.rerank.mockReset().mockRejectedValue(creditRefusal());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

// ─── The sheet, the session, the run ──────────────────────────────────────────────────────────────────────────────────────────

function sheet(): SchematicState {
  const blinker = blinkerCatalog();
  const pinsOf = (blinkerId: string) => blinker.cachedParts.get(blinkerId)!.pins;
  return ledDimmerSheet(
    { timer: { id: ids.get("timer")!, pins: pinsOf(BLINKER_PART_IDS.timer) }, resistor: { id: ids.get("resistor")!, pins: pinsOf(BLINKER_PART_IDS.resistor) }, capacitor: { id: ids.get("capacitor")!, pins: pinsOf(BLINKER_PART_IDS.capacitor) }, diode1n4148: { id: ids.get("1n4148")!, pins: DIODE_1N4148_PINS } },
    { timer: resolvedIdentity.get("timer")!, resistor: resolvedIdentity.get("resistor")!, capacitor: resolvedIdentity.get("capacitor")! },
  );
}

interface Harness {
  editor: SchematicEditorSession;
  coordinator: SchematicGestureCoordinator;
  history: SchematicHistory<SchematicState>;
  visible(): SchematicState;
  journalStore: InMemoryApprovedMutationJournalStore;
  interlock: ProjectCommitInterlock;
  registry: ApprovedMutationRegistry;
  context(over?: Partial<Parameters<typeof assembleAgentRunContext>[0]>): AgentRunContext;
  invoke(toolId: string, args: Record<string, unknown>, context?: AgentRunContext): Promise<GatewayInvocationOutcome>;
  executed(): number;
}

async function harness(state: SchematicState = sheet()): Promise<Harness> {
  const editor = new SchematicEditorSession(SCOPE, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(state, null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({ flushPendingRecord: () => {}, history: () => history, applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); }, snapshot: (authoritative) => structuredClone(authoritative), historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {} }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  const registry = sirkitToolRegistry();
  const context = (over?: Partial<Parameters<typeof assembleAgentRunContext>[0]>): AgentRunContext => {
    const assembly = assembleAgentRunContext({ ...SCOPE, schematic: structuredClone(visible), schematicHeadMark: editor.headMark(), catalogInspectionAvailable: resolveCatalogInspectionPort() !== null, componentResolutionAvailable: resolveComponentResolutionPorts().evidence !== undefined, catalogSearchAvailable: resolveComponentResolutionPorts().search !== undefined, ...over });
    if (!assembly.ok) throw new Error(assembly.reason);
    return assembly.context;
  };
  const gateway = createAgentToolGateway(registry, { catalogInspection: resolveCatalogInspectionPort()!, componentResolution: resolveComponentResolutionPorts() });
  return {
    editor, coordinator, history, visible: () => structuredClone(visible), journalStore: new InMemoryApprovedMutationJournalStore(), interlock: new ProjectCommitInterlock(), registry: new ApprovedMutationRegistry(),
    context,
    invoke: (toolId, args, ctx) => gateway.invoke({ runId: "run-m1", provider: "anthropic", toolId, version: "1.0.0", args, context: ctx ?? context(), timeoutMs: 15_000 }),
    executed: () => editor.events.filter((event) => event.kind === "executed").length,
  };
}

/** The production-shaped fresh-facts channel: its server half is the real loader over the chat route's real ports. */
function channel(respond: "facts" | "forbidden" = "facts") {
  return __createTestResolutionReauthorizationChannel(async (body) => {
    if (respond === "forbidden") return { ok: false, text: JSON.stringify({ ok: false, error: "membership revoked" }) };
    const request = JSON.parse(body) as { nonce: string; proposalId: string; scope: typeof SCOPE; items: Array<{ componentInstanceId: string; currentPartId: string; candidatePartId: string; atomicPartRevisionId: string }>; partIds: string[] };
    const facts = await loadFreshResolutionFacts({ catalog: resolveCatalogInspectionPort()!, evidence: resolveComponentResolutionPorts().evidence!, request: { items: request.items, partIds: request.partIds }, context: { scope: request.scope, runId: "apply", budgetMs: 10_000 } });
    if (!facts) return { ok: false, text: "{}" };
    return { ok: true, text: JSON.stringify({ ok: true, ...facts, binding: { nonce: request.nonce, proposalId: request.proposalId, scope: SCOPE } }) };
  });
}

function apply(h: Harness, proposal: SealedResolutionProposal, over: Partial<Parameters<typeof applyApprovedResolutionProposal>[0]> & { journal?: ApprovedMutationJournal; respond?: "facts" | "forbidden"; membershipRevision?: string } = {}) {
  const intent = issueResolutionApprovalIntent({ proposalId: proposal.proposalId, scope: SCOPE, headMark: proposal.scope.headMark, authorization: { principalId: proposal.authorization.principalId, membershipRevision: over.membershipRevision ?? proposal.authorization.membershipRevision }, now: Date.now() });
  const respond = over.respond;
  const rest: Partial<Parameters<typeof applyApprovedResolutionProposal>[0]> & { journal?: ApprovedMutationJournal } = { ...over };
  delete (rest as { respond?: unknown }).respond;
  delete (rest as { membershipRevision?: unknown }).membershipRevision;
  return applyApprovedResolutionProposal({
    proposal, session: h.editor, gateway: h.coordinator, interlock: h.interlock, journal: new ApprovedMutationJournal(h.journalStore, SCOPE),
    stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: "main", originRunId: "run-m1",
    approval: intent, reauthorization: channel(respond), registry: h.registry, audit: new ApprovedMutationAuditLedger(),
    ...rest,
  });
}

async function sheetParts(state: SchematicState): Promise<Map<string, CatalogPartLoad>> {
  const partIds = [...new Set((state.kicadComponents ?? []).map((instance) => instance.partId))];
  return (await loadCatalogParts(resolveCatalogInspectionPort()!, partIds, { scope: SCOPE, runId: "check", budgetMs: 10_000 })).parts;
}

/** The sheet's nets as {name: sorted "REF.pinFunction"} over the SERVER catalog pins - a polarity-aware view that survives renumbering. */
async function netsByFunction(state: SchematicState): Promise<Record<string, string[]>> {
  const parts = await sheetParts(state);
  const netlist = buildNetlist(state, netlistLookupOf(parts));
  const ref = new Map((state.kicadComponents ?? []).map((instance) => [instance.id, instance] as const));
  const nameOf = (componentId: string, pin: string): string => {
    const instance = ref.get(componentId)!;
    const load = parts.get(instance.partId);
    const pinName = load?.state === "found" ? (load.detail.pins as KicadPin[]).find((entry) => entry.number === pin)?.name ?? pin : pin;
    return `${instance.refDes}.${pinName === "~" ? pin : pinName}`;
  };
  return Object.fromEntries(netlist.nets.filter((net) => !net.name.startsWith("N$")).map((net) => [net.name, net.nodes.map((node) => nameOf(node.componentId, node.pinNumber)).sort()]));
}

const seal = async (h: Harness, items: Array<{ componentId: string; candidatePartId: string; atomicPartRevisionId: string }>, extra: Record<string, unknown> = {}) => h.invoke("sirkit.schematic.propose-component-resolution", { items, ...extra });
const both = (candidate: string, revision: string) => [{ componentId: "kc-d1", candidatePartId: ids.get(candidate)!, atomicPartRevisionId: revision }, { componentId: "kc-d2", candidatePartId: ids.get(candidate)!, atomicPartRevisionId: revision }];

// ─── M.5 item 1: no PCB, real discovery and invocation ────────────────────────────────────────────────────────────────────────

describe("[PR-M M.5-1] a valid schematic with NO PCB and two unresolved instances", { timeout: 120_000 }, () => {
  it("1. discovers the schematic-only resolution tools while every board-only tool stays withheld; no board is fabricated or accepted", async () => {
    const h = await harness();
    const context = h.context();
    expect(context.canonicalState).toBeNull();
    expect(context.canonicalRevisionDigest).toBeNull();
    expect(context.discovery.projectState).not.toContain("board-present");
    expect(context).toMatchObject({ catalogInspectionAvailable: true, componentResolutionAvailable: true, catalogSearchAvailable: true });
    const warnings: string[] = [];
    const names = buildRunToolset(sirkitToolRegistry(), context, (message) => warnings.push(message)).declarations.map((declaration) => declaration.toolId);
    for (const toolId of ["sirkit.schematic.instance-inspect", "sirkit.parts.candidate-search", "sirkit.schematic.propose-component-resolution", "sirkit.parts.missing-facts", "sirkit.pcb-sync.preflight", "sirkit.parts.catalog-inspect"]) expect(names, toolId).toContain(toolId);
    for (const toolId of ["sirkit.pcb.board-inspect", "sirkit.validation.drc-run", "sirkit.pcb.propose-bounded-edit", "sirkit.placement.propose", "sirkit.component-authority.inspect", "sirkit.schematic.inspect", "sirkit.schematic.propose-component-replacement", "sirkit.parts.external-search"]) expect(names, toolId).not.toContain(toolId);
    // a board the browser claims but cannot prove is never a canonical board (and so never unlocks a board tool)
    const claimed = h.context({ board: { stackup: 2, nets: [], footprints: [], tracks: [], vias: [], zones: [], outline: "forged" } });
    expect(claimed.canonicalState).toBeNull();
    expect(buildRunToolset(sirkitToolRegistry(), claimed, () => {}).declarations.map((declaration) => declaration.toolId)).not.toContain("sirkit.pcb.board-inspect");
  });

  it("2. the instance inspection reads D1 and D2 from the server catalog and the sheet: stable ids, pins, functions, nets, polarity", async () => {
    const h = await harness();
    const outcome = await h.invoke("sirkit.schematic.instance-inspect", {});
    expect(outcome.kind, JSON.stringify(outcome)).toBe("read");
    if (outcome.kind !== "read") return;
    expect(outcome.verification).toBe("schematic-snapshot-verified+catalog-read");
    const report = outcome.output.report as { captured: { schematicDigest: string; headMark: unknown }; inspection: { instances: Array<{ componentId: string; refDes: string; resolution: { missing: string }; polarity: unknown; pins: { source: string; items: Array<{ number: string; function: { key: string }; net: { name: string } | null }> } }> } };
    expect(report.captured.schematicDigest).toBe(schematicStateDigest(h.visible()));
    expect(report.captured.headMark).toEqual(h.editor.headMark());
    expect(report.inspection.instances.map((instance) => [instance.componentId, instance.refDes, instance.resolution.missing])).toEqual([["kc-d1", "D1", "published_exact_revision"], ["kc-d2", "D2", "published_exact_revision"]]);
    expect(report.inspection.instances[0]!.pins.source).toBe("catalog-symbol");
    expect(report.inspection.instances.map((instance) => instance.polarity)).toEqual([{ anodeNet: "RA", cathodeNet: "TIMING" }, { anodeNet: "TIMING", cathodeNet: "RB" }]);
    // a pin list or an authority claim from the caller is refused by name
    expect(await h.invoke("sirkit.schematic.instance-inspect", { pins: [{ number: "1", name: "K" }] })).toMatchObject({ kind: "refused", status: "invalid_input" });
  });

  it("3. the candidate search finds eligible revisions by REQUIREMENTS (not known ids) and buckets the rest precisely", async () => {
    const h = await harness();
    const outcome = await h.invoke("sirkit.parts.candidate-search", { componentId: "kc-d1", query: "small-signal fast switching diode 1N4148" });
    expect(outcome.kind, JSON.stringify(outcome)).toBe("read");
    if (outcome.kind !== "read") return;
    const result = outcome.output.result as { buckets: Record<string, Array<{ catalogPartId: string; origin: string; exactRevision: { revisionId: string } | null; reasons: Array<{ code: string }>; mapping: unknown; permutation: boolean }>>; ranking: string; searchesThisRun: { used: number } };
    const where = (key: string): string | undefined => Object.entries(result.buckets).find(([, entries]) => entries.some((entry) => entry.catalogPartId === ids.get(key)))?.[0];
    expect(where("1n4148w")).toBe("eligible");
    expect(where("d-ak")).toBe("eligible");
    expect(where("1n4148ws")).toBe("withdrawn");
    expect(where("1n4148")).toBe("missing-asset"); // the instance's own part, considered first: nothing published for it
    expect(result.buckets["missing-asset"].find((entry) => entry.catalogPartId === ids.get("1n4148"))!.origin).toBe("own-part");
    expect(where("led")).toBe("incompatible"); // recalled by "diode": same pin names and a published revision, another class
    expect(where("1n5819")).toBe("incompatible"); // a Schottky is another class (and publishes nothing)
    expect(result.buckets.incompatible.find((entry) => entry.catalogPartId === ids.get("led"))!.reasons[0]!.code).toBe("functional-class-mismatch");
    expect(where("resistor")).toBe("incompatible"); // a published part of another class is never a candidate for a diode
    const eligible = result.buckets.eligible.find((entry) => entry.catalogPartId === ids.get("1n4148w"))!;
    expect(eligible.exactRevision!.revisionId).toBe(revisions.w);
    expect(eligible.permutation).toBe(false);
    expect(result.buckets.eligible.find((entry) => entry.catalogPartId === ids.get("d-ak"))!.permutation).toBe(true);
    expect(seams.embedded).toEqual(["small-signal fast switching diode 1N4148"]); // one embedding of the requirement text, nothing else
    expect(result.ranking).toBe("fused"); // the refused reranker: the truthful fallback order
    expect(result.searchesThisRun.used).toBe(1);
    // the model can never hand the search a revision to call eligible, and never searches past the per-run limit
    expect(await h.invoke("sirkit.parts.candidate-search", { componentId: "kc-d1", query: "diode", atomicPartRevisionId: revisions.w })).toMatchObject({ kind: "refused", status: "invalid_input" });
  });
});

// ─── M.5 item 2: the D1 / D2 reproduction through confirmation, application and a new canonical revision ───────────────────

describe("[PR-M M.5-2/3] D1 + D2 resolved as ONE reviewed batch to an eligible local revision", { timeout: 180_000 }, () => {
  it("4. the batch seals the right mapping and diff, the apply commits ONE transaction with a receipt and a new revision; refDes, values, polarity and every net are kept; Prepare PCB no longer refuses them; undo / redo hold", async () => {
    const h = await harness();
    const before = h.visible();
    const netsBefore = await netsByFunction(before);
    expect(buildPcbSyncPreflightReport(before)).toMatchObject({ unresolved: { count: 2 } });
    const outcome = await seal(h, both("1n4148w", revisions.w));
    expect(outcome.kind, JSON.stringify(outcome)).toBe("resolution-proposal");
    if (outcome.kind !== "resolution-proposal") return;
    const proposal = outcome.proposal;
    expect(h.visible()).toEqual(before); // sealing changed nothing
    expect(h.executed()).toBe(0);
    expect(proposal.impact.items.map((item) => [item.refDes, item.current.missing, item.target.catalogPartId, item.target.atomicPartRevisionId, item.target.exactMpn, item.mode, item.permutation])).toEqual([
      ["D1", "published_exact_revision", ids.get("1n4148w"), revisions.w, "1N4148W-7-F", "part-replacement", false],
      ["D2", "published_exact_revision", ids.get("1n4148w"), revisions.w, "1N4148W-7-F", "part-replacement", false],
    ]);
    expect(proposal.impact.items[0]!.nets).toEqual([{ pin: "1", net: "TIMING" }, { pin: "2", net: "RA" }]);
    expect(proposal.impact.items[1]!.nets).toEqual([{ pin: "1", net: "RB" }, { pin: "2", net: "TIMING" }]);
    expect(proposal.impact.items[0]!.warnings.join(" ")).toContain("not an electrical equivalence proof");
    expect(proposal.operations).toHaveLength(2);
    expect(proposal.operations.every((operation) => operation.kind === "schematic_replace_component")).toBe(true);
    expect(proposal.scope.headMark).toEqual(h.editor.headMark());

    const seqBefore = h.editor.headMark()!.headSequence;
    const applied = await apply(h, proposal);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (!applied.ok || applied.status !== "committed") return;
    const receipt = applied.receipt;
    expect(receipt).toMatchObject({ schema: RESOLUTION_RECEIPT_SCHEMA, commandId: "schematic.resolve-components", proposalId: proposal.proposalId, operationCount: 2, destructive: true, postconditions: "verified", approvalActor: "human:interactive" });
    expect(receipt.headAfter.headSequence).toBe(seqBefore + 1); // ONE canonical transaction for the whole batch
    expect(h.executed()).toBe(1);
    expect(h.editor.headMark()!.canonicalStateDigest).toBe(receipt.headAfter.canonicalStateDigest);
    const after = h.visible();
    expect(schematicStateDigest(after)).toBe(receipt.schematicDigestAfter);
    for (const id of ["kc-d1", "kc-d2"]) {
      const was = before.kicadComponents!.find((instance) => instance.id === id)!;
      const now = after.kicadComponents!.find((instance) => instance.id === id)!;
      expect(now).toMatchObject({ partId: ids.get("1n4148w"), atomicPartRevisionId: revisions.w, refDes: was.refDes, value: was.value, x: was.x, y: was.y, rotation: was.rotation });
      expect(now.symbolAssetVersionId && now.footprintAssetVersionId && now.mappingCertificateId).toBeTruthy();
    }
    for (const id of ["kc-u1", "kc-r1", "kc-c1"]) expect(after.kicadComponents!.find((instance) => instance.id === id)).toEqual(before.kicadComponents!.find((instance) => instance.id === id));
    expect(after.wires).toEqual(before.wires);
    expect(after.netLabels).toEqual(before.netLabels);
    expect(await netsByFunction(after)).toEqual(netsBefore); // every net, its members and the polarity on it (D1.K / D2.A on TIMING)
    expect(buildPcbSyncPreflightReport(after)).toMatchObject({ unresolved: { count: 0 } });
    // undo restores the unresolved instances exactly; redo re-applies the committed state
    const undone = h.history.undo()!;
    expect(await h.editor.reconcileHistoryStep("undo", undone)).toMatchObject({ ok: true });
    expect(schematicStateDigest(undone)).toBe(schematicStateDigest(before));
    expect(undone.kicadComponents!.find((instance) => instance.id === "kc-d1")!.atomicPartRevisionId).toBeUndefined();
    const redone = h.history.redo()!;
    expect(await h.editor.reconcileHistoryStep("redo", redone)).toMatchObject({ ok: true });
    expect(schematicStateDigest(redone)).toBe(receipt.schematicDigestAfter);
  });

  it("5. a proved permutation applies with the connectivity proof: the pin-swapped symbol keeps every net by FUNCTION", async () => {
    const h = await harness();
    const netsBefore = await netsByFunction(h.visible());
    const outcome = await seal(h, both("d-ak", revisions.ak));
    expect(outcome.kind, JSON.stringify(outcome)).toBe("resolution-proposal");
    if (outcome.kind !== "resolution-proposal") return;
    expect(outcome.proposal.impact.items[0]!.mapping.map((entry) => `${entry.fromPin}->${entry.toPin}:${entry.function}`)).toEqual(["1->2:cathode", "2->1:anode"]);
    const applied = await apply(h, outcome.proposal);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(await netsByFunction(h.visible())).toEqual(netsBefore);
  });

  it("6. a duplicate click returns the SAME receipt, and a reload (a fresh registry) reconciles it from the durable history - never a second commit", async () => {
    const h = await harness();
    const outcome = await seal(h, both("1n4148w", revisions.w));
    if (outcome.kind !== "resolution-proposal") throw new Error(JSON.stringify(outcome));
    const first = await apply(h, outcome.proposal);
    if (!first.ok || first.status !== "committed") throw new Error(JSON.stringify(first));
    const again = await apply(h, outcome.proposal);
    expect(again).toMatchObject({ ok: true, status: "already-applied", receipt: { receiptId: first.receipt.receiptId } });
    h.registry = new ApprovedMutationRegistry(); // the page reloaded: the in-memory one-shot registry is gone, the journal and history are not
    const reloaded = await apply(h, outcome.proposal);
    expect(reloaded).toMatchObject({ ok: true, status: "already-applied", receipt: { receiptId: first.receipt.receiptId } });
    expect(h.executed()).toBe(1);
  });

  it("7. an uncertain commit (the receipt write failed after the transaction landed) is reconciled from authoritative history, not resubmitted", async () => {
    const h = await harness();
    const outcome = await seal(h, both("1n4148w", revisions.w));
    if (outcome.kind !== "resolution-proposal") throw new Error(JSON.stringify(outcome));
    class LosingJournal extends ApprovedMutationJournal {
      override async finalizeReceipt(): Promise<JournalWrite> { return { ok: false, reason: "unavailable" }; }
    }
    const lost = await apply(h, outcome.proposal, { journal: new LosingJournal(h.journalStore, SCOPE) });
    expect(lost).toMatchObject({ ok: false, code: "recovery-required" });
    const headAfterCommit = h.editor.headMark()!;
    const reconciled = await apply(h, outcome.proposal);
    expect(reconciled).toMatchObject({ ok: true, status: "already-applied", receipt: { headAfter: { headSequence: headAfterCommit.headSequence } } });
    expect(h.editor.headMark()).toEqual(headAfterCommit);
    expect(h.executed()).toBe(1);
  });
});

// ─── M.5 items 3 and 6: precise refusals that change nothing ──────────────────────────────────────────────────────────────────

describe("[PR-M M.5-3/6] refusals forge nothing, change nothing and say why", { timeout: 180_000 }, () => {
  async function unchanged(h: Harness, run: () => Promise<{ ok: boolean }>): Promise<{ ok: false; code: string; message: string }> {
    const digest = schematicStateDigest(h.visible());
    const head = h.editor.headMark();
    const executed = h.executed();
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    expect(schematicStateDigest(h.visible())).toBe(digest);
    expect(h.editor.headMark()).toEqual(head);
    expect(h.executed()).toBe(executed);
    return outcome as unknown as { ok: false; code: string; message: string };
  }

  it("8. the proposal refuses an LED, a withdrawn revision, a revision the candidate does not link, a resolved part and a reference designator", async () => {
    const h = await harness();
    expect(await seal(h, both("led", blinkerCatalog().revisionFor(BLINKER_PART_IDS.led, "")!))).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "candidate-not-compatible" }] });
    expect(await seal(h, both("1n4148ws", revisions.ws))).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "candidate-unresolved" }] });
    expect(await seal(h, both("1n4148w", revisions.ak))).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "candidate-revision-mismatch" }] });
    expect(await seal(h, [{ componentId: "kc-r1", candidatePartId: ids.get("resistor")!, atomicPartRevisionId: resolvedIdentity.get("resistor")!.atomicPartRevisionId }])).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "already-resolved" }] });
    expect(await seal(h, [{ componentId: "D1", candidatePartId: ids.get("1n4148w")!, atomicPartRevisionId: revisions.w }])).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("kc-d1")] });
    expect(await seal(h, both("1n4148w", revisions.w), { mapping: [{ fromPin: "1", toPin: "2" }] })).toMatchObject({ kind: "refused", status: "invalid_input" });
    expect(await seal(h, both("1n4148w", revisions.w), { ratings: [{ property: "reverse_voltage", dimension: "voltage", min: 100 }] })).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "candidate-not-compatible" }] });
    expect(h.executed()).toBe(0);
  });

  it("9. an instance whose current pins cannot be established returns the exact missing evidence and the existing work items", async () => {
    const state = sheet();
    state.kicadComponents!.find((instance) => instance.id === "kc-d2")!.partId = "7d5d2b1e-0b7d-4e5a-9c21-000000000000"; // no catalog part has this id
    const h = await harness(state);
    const outcome = await seal(h, both("1n4148w", revisions.w));
    expect(outcome).toMatchObject({ kind: "proposal-blocked", blockers: [{ code: "current-pin-evidence-unavailable" }] });
    const detail = (outcome as { blockers: Array<{ detail: string }> }).blockers[0]!.detail;
    expect(detail).toContain("Missing evidence:");
    expect(detail).toContain("sirkit.parts.missing-facts");
    expect(detail).toContain("sirkit.parts.draft-request");
  });

  it("10. a stale base, a withdrawal after review, a revoked membership and a forged approval all refuse with nothing changed", async () => {
    const h = await harness();
    const outcome = await seal(h, both("1n4148w", revisions.w));
    if (outcome.kind !== "resolution-proposal") throw new Error(JSON.stringify(outcome));
    const proposal = outcome.proposal;
    // revoked membership: the fresh-facts endpoint refuses the caller (403) - nothing is authenticated, nothing applied
    expect((await unchanged(h, () => apply(h, proposal, { respond: "forbidden" }))).code).toBe("authority-unavailable");
    // an approval minted for another membership revision authorizes nothing
    expect((await unchanged(h, () => apply(h, proposal, { membershipRevision: "membership:rev-2" }))).code).toBe("approval-required");
    // a structural copy of an approval is no approval
    expect((await unchanged(h, () => apply(h, proposal, { approval: { intentId: "cai-forged", proposalId: proposal.proposalId } }))).code).toBe("approval-required");
    // the candidate is withdrawn after review: the fresh facts block the recompile
    const { withdrawPublishedAtomicRevision } = await import("@/app/lib/atomic/server-repository");
    // a user edit moves the head: the reviewed batch is stale
    const base = h.visible();
    const edited = await h.coordinator.runCanonicalCommand({ label: "edit R1", execute: (authoritative) => h.editor.execute(authoritative, { commandId: "schematic.set-property", label: "edit R1", buildOperations: () => [{ operationId: "op:test:r1", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "kicad", componentId: "kc-r1", patch: { value: "12k" } }] }) });
    expect(edited.status).toBe("applied");
    expect(schematicStateDigest(h.visible())).not.toBe(schematicStateDigest(base));
    const stale = await unchanged(h, () => apply(h, proposal));
    expect(stale.code).toBe("verification-failed");
    expect(stale.message).toMatch(/head moved|schematic changed/);
    // re-seal at the new head, then withdraw the candidate before the apply
    const fresh = await seal(h, both("1n4148w", revisions.w));
    if (fresh.kind !== "resolution-proposal") throw new Error(JSON.stringify(fresh));
    await withdrawPublishedAtomicRevision({ revisionId: revisions.w, to: "deprecated", actorId: "user:fixture-publisher", actorRole: "publisher", reason: "PR-M fixture: withdrawn after review" });
    const withdrawn = await unchanged(h, () => apply(h, fresh.proposal));
    expect(withdrawn.code).toBe("verification-failed");
    expect(withdrawn.message).toContain("candidate");
  });

  it("11. a viewer cannot propose, and a sealed batch for one project never applies in another", async () => {
    const h = await harness();
    const viewer = h.context({ verifiedActor: { principalId: "user-viewer", actorRole: "viewer", membershipRevision: "membership:v1", authMethod: "local_dev" } });
    expect(buildRunToolset(sirkitToolRegistry(), viewer, () => {}).declarations.map((declaration) => declaration.toolId)).not.toContain("sirkit.schematic.propose-component-resolution");
    expect(await h.invoke("sirkit.schematic.propose-component-resolution", { items: both("1n4148w", revisions.ak) }, viewer)).toMatchObject({ kind: "refused" });
  });
});

// ─── M.5 items 1-2 through the REAL agent loop, and the page's safe intake ────────────────────────────────────────────────────

describe("[PR-M M.5-1/2] the real loop inspects, searches and proposes; the page's intake receives the batch safely", { timeout: 180_000 }, () => {
  const step = (toolCalls: AgentStep["toolCalls"], text = ""): AgentStep => ({ text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "anthropic", state: null } });

  it("12. the model reads the unresolved instances, picks a candidate FROM THE SEARCH RESULTS and seals one batch: one component_resolution_ready, the data told, a second proposal refused; the intake verifies, rows and currency hold; the received batch applies", async () => {
    const h = await harness();
    const registry = sirkitToolRegistry();
    const gateway = createAgentToolGateway(registry, { catalogInspection: resolveCatalogInspectionPort()!, componentResolution: resolveComponentResolutionPorts() });
    const context = h.context();
    const events: AgentRunEvent[] = [];
    const told: unknown[] = [];
    let instanceIds: string[] = [];
    let proposalArgs: Record<string, unknown> = {};
    let turn = 0;
    const call = (tools: ReadonlyArray<{ toolId: string; providerName: string }>, toolId: string, args: Record<string, unknown>, callId: string): AgentStep => {
      const tool = tools.find((declaration) => declaration.toolId === toolId);
      expect(tool, `${toolId} is offered to the model`).toBeDefined();
      return step([{ callId, providerName: tool!.providerName, argumentsText: JSON.stringify(args) }]);
    };
    const adapter: ProviderAgentAdapter = {
      provider: "anthropic",
      async start(input) {
        for (const boardOnly of ["sirkit.pcb.board-inspect", "sirkit.schematic.inspect", "sirkit.component-authority.inspect", "sirkit.schematic.propose-component-replacement"]) expect(input.tools.some((declaration) => declaration.toolId === boardOnly), boardOnly).toBe(false);
        return call(input.tools, "sirkit.schematic.instance-inspect", {}, "call-inspect");
      },
      async continueWith(input) {
        const result = JSON.parse(input.results[0]!.outputText) as Record<string, unknown>;
        told.push(result);
        turn += 1;
        if (turn === 1) {
          const instances = (result.output as { report: { inspection: { instances: Array<{ componentId: string; family: string }> } } }).report.inspection.instances.filter((instance) => instance.family === "kicad");
          instanceIds = instances.map((instance) => instance.componentId);
          return call(input.tools, "sirkit.parts.candidate-search", { componentId: instanceIds[0], query: "small-signal fast switching diode" }, "call-search");
        }
        if (turn === 2) {
          const eligible = (result.output as { result: { buckets: { eligible: Array<{ catalogPartId: string; exactRevision: { revisionId: string } }> } } }).result.buckets.eligible;
          expect(eligible.length).toBeGreaterThan(0);
          proposalArgs = { items: instanceIds.map((componentId) => ({ componentId, candidatePartId: eligible[0]!.catalogPartId, atomicPartRevisionId: eligible[0]!.exactRevision.revisionId })), functionalClass: "diode" };
          return call(input.tools, "sirkit.schematic.propose-component-resolution", proposalArgs, "call-propose");
        }
        if (turn === 3) return call(input.tools, "sirkit.schematic.propose-component-resolution", proposalArgs, "call-propose-again");
        return step([], "Both diodes can be resolved to an eligible published part; review the batch to apply it.");
      },
    };
    const result = await runAgentLoop(
      { runId: "run-m1-loop", provider: "anthropic", history: [], userMessage: "find the missing footprints and parts or replace it with what is existing in the library", budget: DEFAULT_AGENT_BUDGET },
      { adapter, gateway, registry, context, system: "test", emit: (event) => { events.push(event); } },
    );
    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(instanceIds).toEqual(["kc-d1", "kc-d2"]);
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string }).status)).toEqual(["succeeded", "succeeded", "proposal_sealed"]);
    expect(events.filter((event) => event.type === "tool_refused").map((event) => (event as { status: string }).status)).toEqual(["proposal_exists"]);
    expect(events.some((event) => ["proposal_ready", "pcb_proposal_ready", "generation_task_ready", "generation_task_control_ready", "draft_request_ready", "module_contracts_ready", "execution_grant_ready"].includes(event.type))).toBe(false); // [PR-L, 2026-10-18] pin move (runbook L.5): the durable task's two events replaced the removed v1 generation_proposal_ready; the same "no other artifact" assertion
    const ready = events.filter((event) => event.type === COMPONENT_RESOLUTION_READY_EVENT);
    expect(ready).toHaveLength(1);
    expect(h.executed()).toBe(0); // sealing changed nothing
    const sealedTold = told[2] as { status: string; items: Array<{ refDes: string; mapping: string[]; netsKept: string[] }>; note: string };
    expect(sealedTold.status).toBe("proposal_sealed");
    expect(sealedTold.items.map((item) => item.refDes)).toEqual(["D1", "D2"]);
    expect(sealedTold.items[1]!.netsKept).toEqual(["1:RB", "2:TIMING"]);
    expect(sealedTold.note).toContain("NOTHING has been changed");

    // the page's intake: the event as the browser receives it (a JSON round trip) verifies; an altered copy offers nothing
    const wire = JSON.parse(JSON.stringify(ready[0])) as Record<string, unknown>;
    const received = receiveComponentResolutionEvent(wire);
    expect(received).not.toBeNull();
    expect(received!.runId).toBe("run-m1-loop");
    const altered = structuredClone(wire) as { proposal: { impact: { items: Array<{ target: { atomicPartRevisionId: string } }> } } };
    altered.proposal.impact.items[0]!.target.atomicPartRevisionId += "-altered";
    expect(receiveComponentResolutionEvent(altered as unknown as Record<string, unknown>)).toBeNull();
    expect(receiveComponentResolutionEvent({ ...wire, type: "proposal_ready" })).toBeNull();
    expect(receiveComponentResolutionEvent({ type: COMPONENT_RESOLUTION_READY_EVENT, proposal: { schema: "sirkit.component-resolution-proposal.v1", impact: "x" } })).toBeNull();
    const rows = componentResolutionReviewRows(received!.proposal);
    expect(rows.map((row) => [row.refDes, row.componentInstanceId, row.mode])).toEqual([["D1", "kc-d1", "part-replacement"], ["D2", "kc-d2", "part-replacement"]]);
    expect(rows.every((row) => row.established.includes("not") && row.established.includes("electrical equivalence proof"))).toBe(true);
    expect(rows[0]!.from).toContain("no published exact revision");
    const live = { scope: SCOPE, headMark: h.editor.headMark(), baseDigest: schematicStateDigest(h.visible()), now: Date.now() };
    expect(componentResolutionCurrency(received!.proposal, live)).toEqual({ ok: true });
    expect(componentResolutionCurrency(received!.proposal, { ...live, scope: { ...SCOPE, projectId: "another" } })).toMatchObject({ ok: false, code: "foreign-scope" });
    expect(componentResolutionCurrency(received!.proposal, { ...live, now: received!.proposal.expiresAt + 1 })).toMatchObject({ ok: false, code: "expired" });

    // the received batch is exactly what the human applies: one canonical transaction, a receipt, a new revision
    const applied = await apply(h, received!.proposal);
    expect(applied).toMatchObject({ ok: true, status: "committed", receipt: { operationCount: 2, commandId: "schematic.resolve-components" } });
    expect(componentResolutionCurrency(received!.proposal, { ...live, headMark: h.editor.headMark(), baseDigest: schematicStateDigest(h.visible()) })).toMatchObject({ ok: false, code: "stale-head" });
  });
});
