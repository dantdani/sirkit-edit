/**
 * [B21 D3] Shared state for the D3 suites (not a test file): runbook scenario 17 over a FIXTURE CATALOG. The schematic holds U1 -
 * an NE555 on the canvas, bound to its current atomic revision, one wire into pin 1 - behind the B12.1 / B14.1 production editor
 * composition (a live SchematicEditorSession whose head the chat context captures). The catalog is the one the route and the
 * replacement family's own reauthorization route both read: ONE durable binding aggregate for U1 (the B13 authority fixture,
 * produced through the REAL physical-binding service; its exact authority is the fixture's part, `FIXTURE_EXACT`) behind the
 * component-authority seam, and the published pin facts of the current and the target revision behind the pin-facts seam. The
 * authority carries no power fact of any kind (B18-E's rule), so no surface here calls the target "lower-power": the server's
 * catalog decides the target, the model never does. The approval helpers are the family's EXISTING path: the platform fetch boundary
 * routed into the REAL `/api/replacement-authority` handler (b14-1's pattern, plus the same-origin header a browser sends) and the
 * membership reauthorized by the REAL `/api/pcb/apply-authorization` route (D2's pattern).
 */
import { vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import type { KicadPin } from "@/app/lib/kicad/types";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH, pcbBoardInstanceId } from "@/app/lib/pcb/board-identity";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import type { AgentRunContext } from "@/app/lib/agent/contracts";
import type { PublishedSymbolPinFacts, ReplacementPinFactsRole } from "@/app/lib/engineering/replacement-pin-facts";
import type { ComponentAuthorityRecord, ComponentCatalogCandidate } from "@/app/lib/engineering/component-authority";
import { loadRunComponentAuthority, type ComponentAuthoritySourceDeps } from "@/app/lib/engineering/component-authority-source";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry } from "@/app/lib/engineering/approved-agent-mutations";
import type { SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { approveAndApplyReplacement } from "@/app/lib/project/replacement-approval-controller.internal";
import { parseMembershipReauthorization, type MembershipReauthorization, type MembershipReauthorizer } from "@/app/lib/project/membership-reauthorization";
import { FIXTURE_AUTHORITY_VARIANT, FIXTURE_EXACT, matchingAtomicConfirmer, validApprovedAggregate } from "@/app/lib/engineering/__tests__/_authority-fixtures";
import { POST as APPLY_AUTHORIZATION } from "@/app/api/pcb/apply-authorization/route";
import { POST as REPLACEMENT_AUTHORITY } from "@/app/api/replacement-authority/route";
import { resetComponentAuthoritySourceFactory, setComponentAuthoritySourceFactory } from "@/app/api/chat/component-authority-runtime";
import { resetReplacementPinFactsSourceFactory, setReplacementPinFactsSourceFactory, type ReplacementPinFactsSource } from "@/app/api/chat/replacement-facts-runtime";

/** Runbook section 3, scenario 17, in the runbook's own words (the sentence a user types) and two natural variants naming the part swapped in. */
export const SCENARIO_17 = "Replace the NE555 timer U1 with a lower-power timer.";
export const SCENARIO_17_VARIANTS = ["Swap the NE555 (U1) for a lower-power CMOS timer.", "Replace U1, the NE555, with a low-power CMOS timer."] as const;
export const TIMER = "u1-id";
export const TIER1 = "sirkit.schematic.propose-tier1-edit";
export const REPLACEMENT = "sirkit.schematic.propose-component-replacement";
export const D3_SCOPE = Object.freeze({ tenantId: "tenant-1", projectId: "project-d3-timer", branchId: "main" });

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
/** the two published pins of both revisions (identity mapping by number and name: no connected pin is ever dropped) */
export const TIMER_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const U1 = { id: TIMER, partId: "lib:ne555", x: 300, y: 100, rotation: 0 as const, refDes: "U1", value: "NE555", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" };

/** U1 on the canvas with one wire into its pin 1 (b14-1's state, the part named as scenario 17 names it). */
export function timerSchematic(): SchematicState {
  const pin1 = kicadPinWorldPos(U1, TIMER_PINS[0]!);
  return { components: [], kicadComponents: [{ ...U1 }], wires: [{ id: "w1", vertices: [{ x: pin1.x - 60, y: pin1.y }, pin1] }], netLabels: [] };
}

/** One revision's published pin facts, with its APPROVED mapping certificate (the projection the production reader returns). */
export function publishedPinFacts(revision: string, symbol: string, certificateId: string, footprint: string = FIXTURE_EXACT.footprintAssetVersionId): PublishedSymbolPinFacts {
  const ids = TIMER_PINS.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: revision, symbolAssetVersionId: symbol, pins: [...TIMER_PINS],
    certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: footprint, symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" },
    symbolPinIds: ids,
  };
}
export const CURRENT_FACTS = publishedPinFacts("rev-current", "sym-current", "cert-current");
export const TARGET_FACTS = publishedPinFacts(FIXTURE_EXACT.atomicPartRevisionId, FIXTURE_EXACT.symbolAssetVersionId, FIXTURE_EXACT.mappingCertificateId);
/** The catalog's EARLIER selection for U1 (the part-review variant): the exact authority before it moved to FIXTURE_EXACT. */
export const EARLIER = Object.freeze({ atomicPartRevisionId: "atomic-revision-f401", mpn: "STM32F401CCU6", symbolAssetVersionId: "symbol-stm32f401:r1", footprintAssetVersionId: "footprint-stm32-ufqfpn48:r3", mappingCertificateId: "mapping-certificate-f401" });
export const EARLIER_FACTS = publishedPinFacts(EARLIER.atomicPartRevisionId, EARLIER.symbolAssetVersionId, EARLIER.mappingCertificateId, EARLIER.footprintAssetVersionId);

/** The published pin-facts source of the fixture catalog: every read recorded with its revision, its role and its own signal. */
export interface RecordingPinFactsSource extends ReplacementPinFactsSource { readonly reads: Array<{ revision: string; role: ReplacementPinFactsRole | undefined; signal: AbortSignal | undefined }> }
export function catalogPinFacts(): RecordingPinFactsSource {
  const reads: RecordingPinFactsSource["reads"] = [];
  const facts = new Map([[CURRENT_FACTS.atomicPartRevisionId, CURRENT_FACTS], [TARGET_FACTS.atomicPartRevisionId, TARGET_FACTS], [EARLIER_FACTS.atomicPartRevisionId, EARLIER_FACTS]]);
  return { reads, async loadPinFacts(revision, signal, role) { reads.push({ revision, role, signal }); return facts.get(revision) ?? null; } };
}

export interface Catalog { authority: { records: ComponentAuthorityRecord[]; candidates: ComponentCatalogCandidate[] }; pinFacts: RecordingPinFactsSource | null; source: ComponentAuthoritySourceDeps }
/** Installs the catalog behind BOTH seams (the chat route and the reauthorization route read the same ones) and loads U1's
 *  authority exactly as the chat route does (`loadRunComponentAuthority`, the shared board identity). ONE aggregate serves both. */
export async function installCatalog(scope: { tenantId: string; projectId: string; branchId: string } = D3_SCOPE, over: { pinFacts?: RecordingPinFactsSource | null } = {}): Promise<Catalog> {
  const boardScope = { ...scope, boardInstanceId: pcbBoardInstanceId(scope.projectId) };
  const aggregate = await validApprovedAggregate(TIMER, { scopeOverrides: { ...boardScope, hierarchyPath: [...PCB_BOARD_HIERARCHY_PATH], assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT] } });
  const source: ComponentAuthoritySourceDeps = { bindings: { async loadForComponent() { return [aggregate]; } }, atomic: matchingAtomicConfirmer() };
  setComponentAuthoritySourceFactory(() => source);
  const pinFacts = over.pinFacts === undefined ? catalogPinFacts() : over.pinFacts;
  setReplacementPinFactsSourceFactory(() => pinFacts);
  const loaded = await loadRunComponentAuthority(source, { scope: boardScope, canonicalRevision: "d3-fixture", componentInstanceIds: [TIMER], hierarchyPath: PCB_BOARD_HIERARCHY_PATH, assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID });
  if (!loaded) throw new Error("the D3 catalog did not load U1's authority");
  return { authority: { records: [...loaded.records], candidates: [...loaded.candidates] }, pinFacts, source };
}
export function resetCatalog(): void {
  resetComponentAuthoritySourceFactory();
  resetReplacementPinFactsSourceFactory();
}
/** The same authority with U1's exact target as the catalog held it EARLIER (the selection it moved from): the record's selected
 *  part and exact block both name EARLIER - still a complete, consistent, verified-exact record. */
export function earlierAuthority(authority: Catalog["authority"]): Catalog["authority"] {
  const records = authority.records.map((record) => (record.componentId !== TIMER || !record.exactAuthority ? structuredClone(record) : {
    ...structuredClone(record),
    selectedPart: { ...structuredClone(record.selectedPart!), mpn: EARLIER.mpn },
    exactAuthority: { ...structuredClone(record.exactAuthority), atomicPartRevisionId: EARLIER.atomicPartRevisionId, mpn: EARLIER.mpn, symbolAssetVersionId: EARLIER.symbolAssetVersionId, footprintAssetVersionId: EARLIER.footprintAssetVersionId, mappingCertificateId: EARLIER.mappingCertificateId },
  }));
  return { records, candidates: structuredClone(authority.candidates) };
}

// ── The B12.1 / B14.1 production editor composition ────────────────────────────────────────────────────────────────────────
export interface TimerEditor { editor: SchematicEditorSession; coordinator: SchematicGestureCoordinator; history: SchematicHistory<SchematicState>; visible(): SchematicState; executed(): number }
export async function timerEditor(scope: { tenantId: string; projectId: string; branchId: string } = D3_SCOPE): Promise<TimerEditor> {
  const state = timerSchematic();
  const editor = new SchematicEditorSession({ ...scope }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(state), null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {}, history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative), historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
      }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  return { editor, coordinator, history, visible: () => structuredClone(visible), executed: () => editor.events.filter((event) => event.kind === "executed").length };
}

/** The coordinator's run context as the chat route assembles it: the editor's head, U1's loaded authority, the run's principal. */
export function timerContext(editor: TimerEditor, authority: Catalog["authority"] | null, live: Extract<MembershipReauthorization, { ok: true }>, scope: { tenantId: string; projectId: string; branchId: string } = D3_SCOPE): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...scope, schematic: editor.visible(), board: createEmptyBoard(), schematicHeadMark: editor.editor.headMark(), selection: { refs: [], primary: null },
    ...(authority ? { componentAuthority: authority } : {}),
    verifiedActor: { principalId: live.principalId, actorRole: live.role, membershipRevision: live.membershipRevision, authMethod: "local_dev" },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

// ── The replacement family's EXISTING approval path ───────────────────────────────────────────────────────────────────────
/** The product's own membership reauthorization, through the REAL apply-authorization route (the production reauthorizer minus `fetch`). */
export const throughRoute: MembershipReauthorizer = async ({ scope, proposalId }) => {
  const response = await APPLY_AUTHORIZATION(new Request("http://localhost/api/pcb/apply-authorization", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ scope, proposalId }) })); // the same-origin POST the browser sends (the route enforces CSRF)
  if (!response.ok) return { ok: false, code: `http-${response.status}`, detail: "The reauthorization endpoint refused the request." };
  return parseMembershipReauthorization(await response.json());
};
/** The run's principal as the server resolves it for a scope (the chat route binds the same trusted context). */
export async function principalOf(scope: { tenantId: string; projectId: string; branchId: string } = D3_SCOPE): Promise<Extract<MembershipReauthorization, { ok: true }>> {
  const live = await throughRoute({ scope, proposalId: "probe" });
  if (!live.ok) throw new Error(`the apply-authorization route refused: ${live.code}`);
  return live;
}
/** The PLATFORM fetch boundary routed into the REAL `/api/replacement-authority` handler (b14-1's stub): the production
 *  reauthorization channel's transport runs unmodified; the stub adds only the Origin header a same-origin browser POST carries
 *  (the route enforces exact-origin CSRF). Any other URL is refused. */
export function stubReplacementAuthorityFetch(): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    if (!href.includes("/api/replacement-authority")) throw new Error(`unexpected fetch: ${href}`);
    calls += 1;
    const headers = new Headers(init?.headers);
    headers.set("origin", "http://localhost");
    return REPLACEMENT_AUTHORITY(new Request(new URL(href, "http://localhost").toString(), { ...init, headers }));
  });
  return { calls: () => calls };
}
/** The human's Apply through the family's approval controller (the page's one production caller path): the live membership
 *  through the real route, the one-shot intent, the production reauthorization channel, one canonical transaction. */
export async function approveReplacement(editor: TimerEditor, proposal: SealedReplacementProposal, originRunId: string, scope: { tenantId: string; projectId: string; branchId: string } = D3_SCOPE) {
  return approveAndApplyReplacement({
    proposal, session: editor.editor, gateway: editor.coordinator, interlock: new ProjectCommitInterlock(),
    journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), scope), reauthorize: throughRoute,
    stillCurrent: () => true, currentProjectId: scope.projectId, currentBranchId: scope.branchId, tenantId: scope.tenantId,
    originRunId, registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
  });
}
