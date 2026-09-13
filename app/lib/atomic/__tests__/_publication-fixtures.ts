/**
 * [B19-E E4] Shared, database-free fixtures for the atomic publication review suites: a bundled-KiCad-library reader over
 * the committed blinker fixture copies (the real bundled library under data/ is not in the repository), a complete NE555DR
 * request, human and automated actors, and review dependencies over the in-memory durable workflow repository.
 *
 * Nothing here starts a database: a suite that needs PostgreSQL starts PGlite itself (and runs in the database-delivery job).
 */
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { DurableWorkflowRepository } from "../../durable-workflow/types";
import { InMemoryProjectMembershipRepository, type MembershipRole } from "../../auth/project-membership";
import type { EngineeringActor, ProjectRole } from "../../engineering/types";
import type { ExternalObservation, NormalizedCandidate } from "../../acquisition/quarantine";
import type { AtomicAuthoringIdentity } from "../authoring";
import { fixtureKicadLibrary } from "./_kicad-fixture-library";
import type { AtomicPublicationDeps } from "../publication-review";
import { DurableAtomicPublicationStore } from "../publication-review";
import type { AtomicPublicationSpec } from "../publication-review-contract";
import { validatePortableSnapshotForPublication } from "../server-repository";

export { fixtureKicadLibrary };

export const NE555_TERMINALS = [["1", "GND"], ["2", "TRIG"], ["3", "OUT"], ["4", "RESET"], ["5", "CONT"], ["6", "THRES"], ["7", "DISCH"], ["8", "VCC"]].map(([number, fn]) => ({ number: number!, function: fn!, pads: [number!] }));

export function ne555Spec(overrides: Partial<AtomicPublicationSpec> = {}): AtomicPublicationSpec {
  return {
    exactMpn: "NE555DR",
    profile: "pcb_assignable",
    symbol: { library: "Timer", name: "NE555D" },
    footprint: { library: "Package_SO", name: "SOIC-8_3.9x4.9mm_P1.27mm" },
    terminals: NE555_TERMINALS,
    package: { code: "SOIC-8", mounting: "smd" },
    datasheet: { url: "https://www.ti.com/lit/ds/symlink/ne555.pdf", locator: "NE555 datasheet, pin configuration and functions (D package), Table 1" },
    manufacturer: { canonicalName: "Texas Instruments", officialDomains: ["ti.com"] },
    ...overrides,
  };
}

export const GOVERNANCE = { tenantId: "local", projectId: "sirkit-catalog-governance", branchId: "main" } as const;
export const USERS = { editor: "u-catalog-editor", reviewer: "u-catalog-reviewer", admin: "u-catalog-admin", admin2: "u-catalog-admin-2", editor2: "u-catalog-editor-2", viewer: "u-catalog-viewer" } as const;
const MEMBERSHIP_ROLE: Record<ProjectRole, MembershipRole> = { viewer: "viewer", commenter: "commenter", pcb_editor: "editor", reviewer: "reviewer", project_admin: "admin", automation: "editor", migration_admin: "admin" };

export function human(actorId: string, role: ProjectRole): EngineeringActor {
  return { actorId, actorKind: "human", sessionId: `session:${actorId}`, role };
}

export const T_SUBMIT = new Date("2026-09-13T12:00:00.000Z");

/** [B19-E E4 review] A catalog part a request may link: its MPN, its KiCad symbol and the value keys already linked. */
export interface FixtureLinkTarget {
  partId: string;
  mpn: string | null;
  library: string;
  name: string;
  linkedValueKeys: string[];
}

/** [B19-E E4 review] Catalog part ids for link fixtures. */
export const PARTS = { ne555: "11111111-1111-4111-8111-111111111111", lm7805: "22222222-2222-4222-8222-222222222222", resistor: "33333333-3333-4333-8333-333333333333", missing: "44444444-4444-4444-8444-444444444444" } as const;

export interface FixtureDeps extends AtomicPublicationDeps {
  workflow: DurableWorkflowRepository;
  memberships: InMemoryProjectMembershipRepository;
  published: Array<Parameters<AtomicPublicationDeps["publish"]>[0]>;
  setNow(date: Date): void;
  observations: ExternalObservation[];
  candidates: NormalizedCandidate[];
  publishedRevisionIds: Set<string>;
  /** [B19-E E4 review] the catalog parts the fixture's link reader knows */
  linkTargets: Map<string, FixtureLinkTarget>;
}

/** Review dependencies over in-memory stores; `publish` runs the real publication validation and records the call. */
export function fixtureDeps(overrides: Partial<AtomicPublicationDeps> & { workflow?: DurableWorkflowRepository } = {}): FixtureDeps {
  const workflow = overrides.workflow ?? new InMemoryDurableWorkflowRepository();
  const memberships = new InMemoryProjectMembershipRepository();
  const roles: Array<[string, ProjectRole]> = [[USERS.editor, "pcb_editor"], [USERS.editor2, "pcb_editor"], [USERS.reviewer, "reviewer"], [USERS.admin, "project_admin"], [USERS.admin2, "project_admin"], [USERS.viewer, "viewer"]];
  for (const [userId, role] of roles) memberships.set({ tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId, userId, role: MEMBERSHIP_ROLE[role], state: "active", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "test" });
  let now = T_SUBMIT;
  const published: FixtureDeps["published"] = [];
  const publishedRevisionIds = new Set<string>();
  const state = { observations: [] as ExternalObservation[], candidates: [] as NormalizedCandidate[] };
  const identity: AtomicAuthoringIdentity = { manufacturerId: null, exactPartId: null, logicalPartId: null, latestRevision: 0 };
  const linkTargets = new Map<string, FixtureLinkTarget>([
    [PARTS.ne555, { partId: PARTS.ne555, mpn: "NE555DR", library: "Timer", name: "NE555D", linkedValueKeys: [] }],
    [PARTS.lm7805, { partId: PARTS.lm7805, mpn: "LM7805", library: "Regulator_Linear", name: "L7805", linkedValueKeys: [] }],
    [PARTS.resistor, { partId: PARTS.resistor, mpn: null, library: "Device", name: "R", linkedValueKeys: [] }],
  ]);
  const deps: FixtureDeps = {
    workflow,
    memberships,
    published,
    publishedRevisionIds,
    linkTargets,
    get observations() { return state.observations; },
    set observations(value) { state.observations = value; },
    get candidates() { return state.candidates; },
    set candidates(value) { state.candidates = value; },
    setNow(date) { now = date; },
    store: new DurableAtomicPublicationStore(workflow),
    membership: memberships,
    governanceProjectId: GOVERNANCE.projectId,
    governanceTenantId: GOVERNANCE.tenantId,
    library: fixtureKicadLibrary(),
    clock: () => now,
    loadObservations: async () => state.observations,
    registeredCandidates: async () => state.candidates,
    loadIdentity: async () => identity,
    loadLinkTargets: async (partIds: readonly string[]) => new Map(partIds.flatMap((id) => (linkTargets.has(id) ? [[id, structuredClone(linkTargets.get(id)!)] as const] : []))),
    loadRevisionStatus: async (ids) => new Map(ids.filter((id) => publishedRevisionIds.has(id)).map((id) => [id, { state: "published" }])),
    publish: async (input) => {
      validatePortableSnapshotForPublication(input.snapshot, input.requiredProfile, { actorId: input.actorId, actorRole: input.actorRole });
      published.push(input);
      publishedRevisionIds.add(input.snapshot.atomicRevision.id);
      return { revisionId: input.snapshot.atomicRevision.id, auditId: `audit_fixture_${published.length}` };
    },
    ...overrides,
  };
  return deps;
}
