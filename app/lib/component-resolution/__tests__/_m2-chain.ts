/**
 * [PR-M, 2026-10-18] Section M2 test harness: the WHOLE acquisition chain over the production services and a real, migrated PostgreSQL
 * (the test file starts PGlite and mocks the database client, the embedding and the reranker - each a COUNTING fake that must stay at 0).
 *
 *  - the catalog as ingestion and publication write it: the blinker's published timer / resistor / capacitor (M1's resolved parts) and
 *    the official KiCad Diode:1N4148 as a catalog part (pins extracted from the official symbol composed with its 1N4001 parent; MPN
 *    1N4148; footprint hint Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal) with NO published revision and NO local alternative;
 *  - the LED-dimmer sheet with D1 / D2 on that part (M1's isolated equivalent);
 *  - the task runtime over the PostgreSQL durable repository, the fixture CAD source through the production egress path (a counting
 *    transport), the existing generation worker with the component-resolution topic registered;
 *  - the governance scope (OD-37) with an editor, a reviewer and two administrators, and the publication deps the route composes
 *    (the handoff's acquired-asset port and registered candidates, the publication transaction);
 *  - M1's sealing gateway and its reviewed apply over the real schematic session, journal and fresh-facts channel.
 */
import type { KicadPin } from "@/app/lib/kicad/types";
import type { SchematicState } from "@/lib/schematic-types";
import { categorizeLib } from "@/app/lib/kicad/categories";
import { extractLibrary } from "@/app/lib/kicad/extract";
import { blinkerCatalog, BLINKER_PART_IDS } from "@/app/lib/fixture-runtime/blinker/catalog";
import { normalizeValueKey } from "@/app/lib/atomic/value-key";
import type { DisposablePostgres } from "@/app/lib/db/disposable-postgres";
import { PostgresDurableWorkflowRepository } from "@/app/lib/durable-workflow/server-repository";
import { InMemoryProjectMembershipRepository, type MembershipRole } from "@/app/lib/auth/project-membership";
import { setMembershipRepositoryFactory } from "@/app/lib/auth/identity-runtime";
import type { EngineeringActor, ProjectRole } from "@/app/lib/engineering/types";
import { GenerationTaskStore } from "@/app/lib/generation-task/store";
import { GenerationWorker } from "@/app/lib/generation-task/worker/worker";
import type { GenerationSlicePorts } from "@/app/lib/generation-task/worker/slices";
import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resolveRevisionEvidencePort } from "@/app/api/chat/revision-evidence-runtime";
import { setComponentResolutionRuntimeFactory, type ComponentResolutionRuntime } from "@/app/lib/component-resolution/task/runtime";
import { componentResolutionTopic, setCadSourceInjection } from "@/app/lib/component-resolution/task/worker-runtime";
import { ComponentResolutionService } from "@/app/lib/component-resolution/task/service";
import { ComponentResolutionTaskStore } from "@/app/lib/component-resolution/task/store";
import { acquiredAssetsLoader, handoffRegisteredCandidates, type HandoffDeps } from "@/app/lib/component-resolution/acquisition/handoff";
import { publishPortableAtomicSnapshot, withdrawPublishedAtomicRevision } from "@/app/lib/atomic/server-repository";
import { loadAtomicAuthoringIdentity, loadAtomicLinkTargets, loadAtomicRevisionStatus } from "@/app/lib/atomic/server-catalog";
import { DurableAtomicPublicationStore, publishAtomicPublicationRequest, resolveAtomicPublicationRequest, submitAtomicPublicationRequest, type AtomicPublicationDeps } from "@/app/lib/atomic/publication-review";
import { bundledKicadLibrary } from "@/app/lib/atomic/authoring";
import type { AtomicPublicationRequest, AtomicPublicationSpec } from "@/app/lib/atomic/publication-review-contract";
import { createFixtureCadTransport, type FixtureCadTransport } from "@/app/lib/fixture-runtime/cad-source/transport";
import { ledDimmerSheet, type DimmerResolvedIdentity } from "@/app/lib/component-resolution/__tests__/_m1-fixtures";
import { composed1N4148 } from "./_m2-fixtures";

export const GOVERNANCE = { tenantId: "local", projectId: "m2-catalog-governance", branchId: "main" } as const;
export const USERS = { requester: "u-m2-requester", govEditor: "u-m2-gov-editor", reviewer: "u-m2-gov-reviewer", admin: "u-m2-gov-admin", admin2: "u-m2-gov-admin-2" } as const;
const MEMBERSHIP_ROLE: Record<ProjectRole, MembershipRole> = { viewer: "viewer", commenter: "commenter", pcb_editor: "editor", reviewer: "reviewer", project_admin: "admin", automation: "editor", migration_admin: "admin" };

export function human(actorId: string, role: ProjectRole): EngineeringActor {
  return { actorId, actorKind: "human", sessionId: `session:${actorId}`, role };
}
export function agentActor(): EngineeringActor {
  return { actorId: "agent:assistant", actorKind: "ai", sessionId: "session:agent", role: "pcb_editor" };
}

export const PINS_1N4148: KicadPin[] = (() => {
  const extracted = extractLibrary([composed1N4148()]).find((item) => item.name === "1N4148");
  if (!extracted) throw new Error("the composed 1N4148 did not extract");
  return extracted.pins;
})();

export interface ChainCatalog { ids: Map<string, string>; resolved: Map<string, DimmerResolvedIdentity> }

/** Seed the catalog the way ingestion and publication write it (see the header). */
export async function seedChainCatalog(pg: DisposablePostgres, embedding: (text: string) => string): Promise<ChainCatalog> {
  const blinker = blinkerCatalog();
  const ids = new Map<string, string>();
  const resolved = new Map<string, DimmerResolvedIdentity>();
  const libraryIds = new Map<string, string>();
  const library = async (name: string): Promise<string> => {
    if (!libraryIds.has(name)) libraryIds.set(name, (await pg.db.query<{ id: string }>("INSERT INTO libraries (name, main_category) VALUES ($1, $2) RETURNING id", [name, categorizeLib(name)])).rows[0]!.id);
    return libraryIds.get(name)!;
  };
  const part = async (key: string, input: { library: string; name: string; description: string; keywords: string; mpn: string | null; pins: readonly KicadPin[]; generic: boolean; footprintHint?: string }) => {
    const row = await pg.db.query<{ id: string }>(
      "INSERT INTO parts (library_id, name, description, keywords, mpn, properties, pins, symbol_raw, is_generic, embedding, lifecycle_status, footprint_hint) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6::jsonb, '', $7, $8::vector, 'active', $9) RETURNING id",
      [await library(input.library), input.name, input.description, input.keywords, input.mpn, JSON.stringify(input.pins), input.generic, embedding(`${input.name} ${input.description} ${input.keywords}`), input.footprintHint ?? null],
    );
    ids.set(key, row.rows[0]!.id);
    return row.rows[0]!.id;
  };
  for (const [key, blinkerId, value, keywords, generic] of [["timer", BLINKER_PART_IDS.timer, "", "single timer 555", false], ["resistor", BLINKER_PART_IDS.resistor, "10k", "R res resistor", true], ["capacitor", BLINKER_PART_IDS.capacitor, "10nF", "cap capacitor", true]] as const) {
    const cached = blinker.cachedParts.get(blinkerId)!;
    const partId = await part(key, { library: cached.libraryName === "Timer" ? "Timer" : "Device", name: cached.name, description: cached.description ?? cached.name, keywords, mpn: null, pins: cached.pins, generic });
    const revisionId = blinker.revisionFor(blinkerId, value)!;
    await publishPortableAtomicSnapshot({ snapshot: structuredClone(blinker.snapshots.get(revisionId)!), actorId: "user:fixture-publisher", actorRole: "publisher", requiredProfile: "pcb_assignable", reason: "PR-M fixture publication", links: [{ partId, valueKey: normalizeValueKey(value) }] });
    const assignment = cached.atomicAssignments![normalizeValueKey(value)]!;
    resolved.set(key, { atomicPartRevisionId: assignment.revisionId, symbolAssetVersionId: assignment.symbolVersionId, footprintAssetVersionId: assignment.footprintVersionId, mappingCertificateId: assignment.mappingCertificateId });
  }
  // the unresolved official KiCad 1N4148: a real catalog part, nothing published for it, and no local alternative in the catalog
  await part("1n4148", { library: "Diode", name: "1N4148", description: "100V 0.15A standard switching diode, DO-35", keywords: "diode", mpn: "1N4148", pins: PINS_1N4148, generic: false, footprintHint: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal" });
  return { ids, resolved };
}

export function chainSheet(catalog: ChainCatalog): SchematicState {
  const blinker = blinkerCatalog();
  const pinsOf = (blinkerId: string) => blinker.cachedParts.get(blinkerId)!.pins;
  return ledDimmerSheet(
    { timer: { id: catalog.ids.get("timer")!, pins: pinsOf(BLINKER_PART_IDS.timer) }, resistor: { id: catalog.ids.get("resistor")!, pins: pinsOf(BLINKER_PART_IDS.resistor) }, capacitor: { id: catalog.ids.get("capacitor")!, pins: pinsOf(BLINKER_PART_IDS.capacitor) }, diode1n4148: { id: catalog.ids.get("1n4148")!, pins: PINS_1N4148 } },
    { timer: catalog.resolved.get("timer")!, resistor: catalog.resolved.get("resistor")!, capacitor: catalog.resolved.get("capacitor")! },
  );
}

/** Memberships of the source projects and the governance project. */
export function chainMemberships(projects: ReadonlyArray<{ tenantId: string; projectId: string }>): InMemoryProjectMembershipRepository {
  const memberships = new InMemoryProjectMembershipRepository();
  const record = (tenantId: string, projectId: string, userId: string, role: ProjectRole) => memberships.set({ tenantId, projectId, userId, role: MEMBERSHIP_ROLE[role], state: "active", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "test" });
  for (const project of projects) record(project.tenantId, project.projectId, USERS.requester, "pcb_editor");
  for (const [userId, role] of [[USERS.requester, "pcb_editor"], [USERS.govEditor, "pcb_editor"], [USERS.reviewer, "reviewer"], [USERS.admin, "project_admin"], [USERS.admin2, "project_admin"]] as const) record(GOVERNANCE.tenantId, GOVERNANCE.projectId, userId, role);
  setMembershipRepositoryFactory(() => memberships);
  return memberships;
}

export interface ChainRuntime {
  runtime: ComponentResolutionRuntime;
  transport: FixtureCadTransport;
  clock: { now: number; advance(ms: number): void };
  service: ComponentResolutionService;
  store: ComponentResolutionTaskStore;
  handoffDeps: HandoffDeps;
  runWorker(): Promise<Awaited<ReturnType<GenerationWorker["runOnce"]>>>;
  publicationDeps(memberships: InMemoryProjectMembershipRepository): AtomicPublicationDeps;
}

/** The task runtime over PostgreSQL, the fixture CAD source (bundled checkout switched off by the operator setting) and the worker. */
export function chainRuntime(start = Date.parse("2026-10-18T10:00:00.000Z"), options: { governance?: { tenantId: string | null; projectId: string | null } } = {}): ChainRuntime {
  const clock = { now: start, advance(ms: number) { this.now += ms; } };
  const tick = (): number => clock.now;
  const transport = createFixtureCadTransport();
  const repository = new PostgresDurableWorkflowRepository();
  const runtime: ComponentResolutionRuntime = { repository, clock: tick, durability: "durable", fixture: false, governance: options.governance ?? { tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId }, environment: { SIRKIT_ACQUISITION_DISABLED_SOURCES: "kicad-bundled" } };
  setComponentResolutionRuntimeFactory(() => runtime);
  setCadSourceInjection({ fixtureEgress: { fetch: transport.fetch, resolve: transport.resolve }, fixtureAllowed: true });
  const catalog = resolveCatalogInspectionPort()!;
  const evidence = resolveRevisionEvidencePort()!;
  const store = new ComponentResolutionTaskStore({ repository, clock: tick });
  const service = new ComponentResolutionService({ runtime, catalog, store });
  const handoffDeps: HandoffDeps = { repository, governance: runtime.governance, clock: tick };
  const topic = componentResolutionTopic(runtime, () => ({ catalog, evidence }))!;
  return {
    runtime, transport, clock, service, store, handoffDeps,
    // the worker drains what is DUE (other tests' scheduled re-checks included), one slice at a time, as a running worker would
    runWorker: async () => {
      const worker = new GenerationWorker({ store: new GenerationTaskStore({ repository, clock: tick }), workerId: "m2-test-worker", ports: {} as GenerationSlicePorts, revalidate: async () => ({ ok: true }), clock: tick, topics: [topic], policy: { concurrency: 1 } });
      const all: Awaited<ReturnType<GenerationWorker["runOnce"]>> = { tick: { at: new Date(tick()).toISOString(), claims: [], started: [] }, slices: [] };
      // a claim that is refused at the claim (a stale event, a revoked initiator) starts nothing but consumes its event: keep draining
      // until two passes in a row find nothing
      let empty = 0;
      for (let pass = 0; pass < 16 && empty < 2; pass += 1) {
        const once = await worker.runOnce();
        all.tick.claims.push(...once.tick.claims);
        all.tick.started.push(...once.tick.started);
        all.slices.push(...once.slices);
        empty = once.tick.claims.length === 0 ? empty + 1 : 0;
      }
      return all;
    },
    publicationDeps: (memberships) => ({
      store: new DurableAtomicPublicationStore(repository), membership: memberships, governanceProjectId: runtime.governance.projectId, governanceTenantId: runtime.governance.tenantId,
      library: bundledKicadLibrary("/nonexistent-root-for-m2"), clock: () => new Date(tick()),
      loadObservations: async () => [], registeredCandidates: handoffRegisteredCandidates(handoffDeps), acquired: acquiredAssetsLoader(handoffDeps),
      loadIdentity: loadAtomicAuthoringIdentity, loadLinkTargets: loadAtomicLinkTargets, loadRevisionStatus: loadAtomicRevisionStatus, publish: publishPortableAtomicSnapshot, withdraw: withdrawPublishedAtomicRevision,
    }),
  };
}

/** The two humans' review: a governance editor submits the package (entering the manufacturer they verified), a reviewer approves. */
export async function submitAndApprove(deps: AtomicPublicationDeps, spec: AtomicPublicationSpec, links: Array<{ partId: string; valueKey: string }>, discovery = false): Promise<AtomicPublicationRequest> {
  const entered: AtomicPublicationSpec = { ...spec, manufacturer: { canonicalName: "Nexperia", officialDomains: ["nexperia.com"] }, datasheet: { url: "https://assets.nexperia.com/documents/data-sheet/1N4148_1N4448.pdf", locator: "1N4148_1N4448 datasheet, pinning information (Table 2)" } };
  const { stored } = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.govEditor, "pcb_editor"), membershipRevision: null, spec: entered, links, reason: "acquired from the fixture CAD source; pin table confirmed against the cited datasheet", ...(discovery ? { discovery: true } : {}) });
  const manufacturer = stored.request.evidence.facts.find((fact) => fact.property === "manufacturer" && fact.sourceClass === "organization_authored")!;
  const approved = await resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.reviewer, "reviewer"), requestId: stored.request.requestId, decision: "approve", reason: "symbol, footprint and pin table reviewed", reviewEvidenceDigest: stored.request.evidence.reviewEvidenceDigest, resolutions: [{ property: "manufacturer", factId: manufacturer.factId, reason: "named by the cited datasheet" }], factDispositions: [] });
  return approved.request;
}

export async function publishBy(deps: AtomicPublicationDeps, requestId: string, actor = human(USERS.admin, "project_admin")) {
  return publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor, requestId, reason: "two-person publication of the acquired part" });
}
