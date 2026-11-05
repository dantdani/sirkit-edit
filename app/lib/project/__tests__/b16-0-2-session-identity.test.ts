/**
 * B16.0.2 §E — production session identity for client-sealed tier-1
 * proposals.
 *
 * R6 closure:
 *  1. `loadSessionIdentity` is request-owned, async, typed, scope-exact,
 *     abort-bound, and has NO fallback identity (source-pinned: no local-dev
 *     principal import, no cache);
 *  2. the page's seal site awaits it and seals ONLY from a successful load
 *     (source-pinned);
 *  3. PRODUCTION INTEGRATION through the REAL narrow endpoint
 *     (`/api/pcb/apply-authorization` handler dispatched by a fetch stub),
 *     the REAL seal, the REAL approved-mutation apply service and the REAL
 *     membership reauthorizer: authenticated editor → proposal sealed under
 *     the exact principal/revision → explicit Apply → fresh matching
 *     reauthorization → exactly one canonical transaction; logout, project
 *     switch, downgrade, membership-revision change and identity-load failure
 *     yield zero proposal or zero mutation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { loadSessionIdentity, sessionAuthorizationBindingFrom, SESSION_IDENTITY_UNAVAILABLE_MESSAGE } from "../session-identity";
import { createMembershipReauthorizer, type MembershipReauthorizer } from "../membership-reauthorization";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as applyAuthorizationPost } from "@/app/api/pcb/apply-authorization/route";
import { membershipRevisionOf } from "@/app/lib/auth/project-membership";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { SchematicHistory } from "../schematic-history";
import { adoptCanonicalResult } from "../canonical-adoption";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { compileTier1Proposal } from "@/app/lib/engineering/schematic-plans";
import { sealTier1Proposal, type SealedTier1Proposal } from "@/app/lib/engineering/schematic-proposals";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry, applyApprovedTier1Proposal } from "@/app/lib/engineering/approved-agent-mutations";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";

const SCOPE = { tenantId: "local", projectId: "project-e2e-b1602", branchId: "main" };
const OTHER = { tenantId: "local", projectId: "project-other", branchId: "main" };
const SCHEMATIC: SchematicState = {
  components: [
    { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
    { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
  ],
  wires: [],
};

/** Dispatch the browser's same-origin fetch to the REAL apply-authorization handler. */
function installFetchToRealEndpoint(options: { failNetwork?: boolean } = {}): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.endsWith("/api/pcb/apply-authorization")) throw new Error(`unexpected fetch ${url}`);
    if (options.failNetwork) throw new TypeError("network down");
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const request = new Request(`http://localhost${url}`, { method: "POST", headers: { ...(init?.headers as Record<string, string>), origin: "http://localhost" }, body: init?.body as string });
    return applyAuthorizationPost(request);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

afterEach(() => { resetInjectedIdentity(); });

describe("B16.0.2 §E — loadSessionIdentity: typed, scope-exact, abort-bound, NO fallback", () => {
  const liveOk: MembershipReauthorizer = async ({ scope }) => ({ ok: true, principalId: "user-42", role: "pcb_editor", membershipRevision: "mbr1-abc", scope: { ...scope } });

  it("returns the live principal/role/revision for EXACTLY the requested scope", async () => {
    const identity = await loadSessionIdentity(SCOPE, { reauthorize: liveOk });
    expect(identity).toEqual({ ok: true, principalId: "user-42", role: "pcb_editor", membershipRevision: "mbr1-abc", scope: SCOPE });
    const binding = sessionAuthorizationBindingFrom(identity, SCOPE);
    expect(binding).toMatchObject({ principalId: "user-42", membershipRevision: "mbr1-abc", ...SCOPE, requiredApplyRole: "pcb_editor" });
  });

  it("maps endpoint refusals to typed failures: 401 → unauthenticated, 403 → forbidden, unreachable, malformed, other", async () => {
    const make = (code: string): MembershipReauthorizer => async () => ({ ok: false, code, detail: "refused" });
    expect((await loadSessionIdentity(SCOPE, { reauthorize: make("http-401") })) as { code: string }).toMatchObject({ ok: false, code: "unauthenticated" });
    expect((await loadSessionIdentity(SCOPE, { reauthorize: make("http-403") })) as { code: string }).toMatchObject({ ok: false, code: "forbidden" });
    expect((await loadSessionIdentity(SCOPE, { reauthorize: make("unreachable") })) as { code: string }).toMatchObject({ ok: false, code: "unreachable" });
    expect((await loadSessionIdentity(SCOPE, { reauthorize: make("malformed") })) as { code: string }).toMatchObject({ ok: false, code: "malformed" });
    expect((await loadSessionIdentity(SCOPE, { reauthorize: make("http-500") })) as { code: string }).toMatchObject({ ok: false, code: "denied" });
    const throwing: MembershipReauthorizer = async () => { throw new Error("boom"); };
    expect((await loadSessionIdentity(SCOPE, { reauthorize: throwing })) as { code: string }).toMatchObject({ ok: false, code: "unreachable" });
  });

  it("a pre-aborted or mid-flight-aborted scope yields `aborted` (never a stale identity); a foreign-scope answer is refused", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await loadSessionIdentity(SCOPE, { reauthorize: liveOk, signal: controller.signal })).toMatchObject({ ok: false, code: "aborted" });
    const late = new AbortController();
    const slow: MembershipReauthorizer = async (request) => { late.abort(); return liveOk(request); };
    expect(await loadSessionIdentity(SCOPE, { reauthorize: slow, signal: late.signal })).toMatchObject({ ok: false, code: "aborted" });
    const foreign: MembershipReauthorizer = async () => ({ ok: true, principalId: "user-42", role: "pcb_editor", membershipRevision: "mbr1-abc", scope: { ...OTHER } });
    expect(await loadSessionIdentity(SCOPE, { reauthorize: foreign })).toMatchObject({ ok: false, code: "scope-mismatch" });
  });

  it("sessionAuthorizationBindingFrom THROWS on a failed load or a scope disagreement (never a widened seal)", async () => {
    const failed = await loadSessionIdentity(SCOPE, { reauthorize: async () => ({ ok: false, code: "http-401", detail: "x" }) });
    expect(() => sessionAuthorizationBindingFrom(failed, SCOPE)).toThrow();
    const ok = await loadSessionIdentity(SCOPE, { reauthorize: liveOk });
    expect(() => sessionAuthorizationBindingFrom(ok, OTHER)).toThrow(/does not match/);
  });

  it("SOURCE: the module has NO local-dev fallback, NO cache, NO prime; the page seal site awaits the load and seals only from it", () => {
    const root = process.cwd();
    const source = readFileSync(join(root, "app", "lib", "project", "session-identity.ts"), "utf8");
    expect(source.includes("LOCAL_DEV_PRINCIPAL_ID")).toBe(false);
    expect(source.includes("localDevMembership")).toBe(false);
    expect(source.includes("auth/project-membership")).toBe(false);
    expect(source.includes("primeSessionIdentity")).toBe(false);
    expect(source.includes("let cached")).toBe(false);
    expect(source.includes("export function sessionAuthorizationBinding(")).toBe(false);
    const page = readFileSync(join(root, "app", "page.tsx"), "utf8");
    expect(page.includes("sessionAuthorizationBinding(")).toBe(false);
    const sealIndex = page.indexOf("sealTier1Proposal({");
    const loadIndex = page.indexOf("await loadSessionIdentity(sealScope, { signal: scope.signal })");
    expect(loadIndex).toBeGreaterThan(0);
    expect(loadIndex).toBeLessThan(sealIndex);
    expect(page.includes("if (!sessionIdentity.ok) {\n        failActivityLog(logId, SESSION_IDENTITY_UNAVAILABLE_MESSAGE);\n        return;\n      }")).toBe(true);
    expect(page.includes("authorization: sessionAuthorizationBindingFrom(sessionIdentity, sealScope),")).toBe(true);
    expect(SESSION_IDENTITY_UNAVAILABLE_MESSAGE).toMatch(/Sign in/);
  });
});

// ─── Production integration ──────────────────────────────────────────────────

function editorUi(session: SchematicEditorSession, initial: SchematicState) {
  let visible: SchematicState = structuredClone(initial);
  const history = new SchematicHistory<SchematicState>(structuredClone(initial), { label: "Opened project" });
  let adoptions = 0;
  const coordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, state) => {
      adoptions += 1;
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {},
        history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {},
        suppressEffectRecord: () => {},
        scheduleAutosave: () => {},
      }, label, state);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (state) => { visible = structuredClone(state); },
    execute: (base, request) => session.execute(base, request),
    notify: () => {},
  });
  return { coordinator, history, adoptions: () => adoptions, visible: () => structuredClone(visible), visibleDigest: () => schematicStateDigest(visible) };
}

async function production() {
  const store = new InMemoryAtomicProjectStore();
  const editor = new SchematicEditorSession({ ...SCOPE }, { store });
  await editor.openForProject(structuredClone(SCHEMATIC), null);
  const ui = editorUi(editor, SCHEMATIC);
  const interlock = new ProjectCommitInterlock();
  const registry = new ApprovedMutationRegistry();
  const audit = new ApprovedMutationAuditLedger();
  const journalStore = new InMemoryApprovedMutationJournalStore();
  let current = true;
  return {
    store, editor, ui, interlock, registry, audit, journalStore,
    async head(): Promise<number> { return (await store.load(SCOPE.projectId, "main"))?.snapshotRevision.headSequence ?? -1; },
    /** The page's client-side seal: identity → binding → seal. */
    async seal(signal?: AbortSignal): Promise<{ proposal: SealedTier1Proposal | null; reason?: string }> {
      const identity = await loadSessionIdentity(SCOPE, signal ? { signal } : {});
      if (!identity.ok) return { proposal: null, reason: SESSION_IDENTITY_UNAVAILABLE_MESSAGE };
      const state = ui.visible();
      const outcome = sealTier1Proposal({
        state,
        compilation: compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "4k7" }], pinsByPartId: new Map() }),
        provenance: { provider: "anthropic", note: "t", instruction: "set R1 to 4k7" },
        now: Date.now(),
        scope: { ...SCOPE, headMark: editor.headMark()! },
        authorization: sessionAuthorizationBindingFrom(identity, SCOPE),
      });
      return outcome.kind === "sealed" ? { proposal: outcome.proposal } : { proposal: null, reason: "blocked" };
    },
    apply: (proposal: SealedTier1Proposal) => applyApprovedTier1Proposal({
      proposal, session: editor, gateway: ui.coordinator, interlock,
      journal: new ApprovedMutationJournal(journalStore, { ...SCOPE }),
      reauthorize: createMembershipReauthorizer(), // the REAL production transport (fetch → real endpoint)
      stillCurrent: () => current,
      currentProjectId: SCOPE.projectId, currentBranchId: "main",
      originRunId: null, registry, audit,
    }),
    retireScope: () => { current = false; },
  };
}

describe("B16.0.2 §E — PRODUCTION integration: live identity → seal → explicit Apply → fresh reauthorization → exactly one transaction", () => {
  let restoreFetch: () => void = () => {};
  beforeEach(() => { restoreFetch = installFetchToRealEndpoint(); });
  afterEach(() => { restoreFetch(); vi.restoreAllMocks(); });

  it("an authenticated (supabase_cookie) editor seals under the EXACT live principal/revision and applies exactly once", async () => {
    const repo = injectAuthorizedPrincipal({ userId: "supabase-user-7", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor", authMethod: "supabase_cookie" });
    const membership = await repo.loadActiveMembership({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, userId: "supabase-user-7" });
    const p = await production();
    const sealed = await p.seal();
    expect(sealed.proposal).not.toBeNull();
    const proposal = sealed.proposal!;
    expect(proposal.authorization.principalId).toBe("supabase-user-7");
    expect(proposal.authorization.membershipRevision).toBe(membershipRevisionOf(membership!));
    expect(proposal.authorization.principalId).not.toBe("local-dev-principal");
    expect(await p.head()).toBe(0);
    const outcome = await p.apply(proposal);
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    expect(await p.head()).toBe(1);
    expect(p.ui.adoptions()).toBe(1);
    expect(p.ui.visible().components.find((c) => c.id === "R1")?.value).toBe("4k7");
    const again = await p.apply(proposal);
    expect(again.ok && again.status === "already-applied").toBe(true);
    expect(await p.head()).toBe(1);
  });

  it("LOGOUT before sealing: identity load fails (401) → ZERO proposal, truthful sign-in message", async () => {
    injectIdentity(null);
    injectMembership([]);
    const p = await production();
    const sealed = await p.seal();
    expect(sealed.proposal).toBeNull();
    expect(sealed.reason).toBe(SESSION_IDENTITY_UNAVAILABLE_MESSAGE);
    expect(await p.head()).toBe(0);
  });

  it("NO membership for the project (403) → ZERO proposal", async () => {
    injectIdentity({ userId: "stranger" });
    injectMembership([{ projectId: OTHER.projectId, userId: "stranger", role: "editor" }]);
    const p = await production();
    expect((await p.seal()).proposal).toBeNull();
  });

  it("PROJECT SWITCH (scope abort) during the identity load → ZERO proposal", async () => {
    injectAuthorizedPrincipal({ userId: "supabase-user-7", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
    const p = await production();
    const controller = new AbortController();
    controller.abort();
    const sealed = await p.seal(controller.signal);
    expect(sealed.proposal).toBeNull();
  });

  it("IDENTITY-LOAD FAILURE (endpoint unreachable) → ZERO proposal; nothing is sealed under a guessed identity", async () => {
    injectAuthorizedPrincipal({ userId: "supabase-user-7", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
    restoreFetch();
    restoreFetch = installFetchToRealEndpoint({ failNetwork: true });
    const p = await production();
    const sealed = await p.seal();
    expect(sealed.proposal).toBeNull();
    expect(sealed.reason).toBe(SESSION_IDENTITY_UNAVAILABLE_MESSAGE);
  });

  it("DOWNGRADE after sealing (editor → viewer): Apply refuses role-insufficient with ZERO mutation", async () => {
    injectAuthorizedPrincipal({ userId: "supabase-user-7", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
    const p = await production();
    const { proposal } = await p.seal();
    injectMembership([{ projectId: SCOPE.projectId, userId: "supabase-user-7", role: "viewer", version: 2 }]);
    const outcome = await p.apply(proposal!);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toMatch(/^reauthorization-(role-insufficient|membership-changed)$/);
    expect(await p.head()).toBe(0);
    expect(p.ui.adoptions()).toBe(0);
  });

  it("MEMBERSHIP REVISION CHANGE after sealing (same role, version bump): Apply refuses membership-changed with ZERO mutation", async () => {
    injectAuthorizedPrincipal({ userId: "supabase-user-7", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
    const p = await production();
    const { proposal } = await p.seal();
    injectMembership([{ projectId: SCOPE.projectId, userId: "supabase-user-7", role: "editor", version: 9 }]);
    const outcome = await p.apply(proposal!);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("reauthorization-membership-changed");
    expect(await p.head()).toBe(0);
  });

  it("LOGOUT after sealing: Apply refuses (membership unavailable) with ZERO mutation", async () => {
    injectAuthorizedPrincipal({ userId: "supabase-user-7", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
    const p = await production();
    const { proposal } = await p.seal();
    injectIdentity(null);
    const outcome = await p.apply(proposal!);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("reauthorization-membership-unavailable");
    expect(await p.head()).toBe(0);
  });

  it("a DIFFERENT principal signing in after sealing cannot apply (principal-changed) with ZERO mutation", async () => {
    injectAuthorizedPrincipal({ userId: "supabase-user-7", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
    const p = await production();
    const { proposal } = await p.seal();
    injectAuthorizedPrincipal({ userId: "supabase-user-8", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "admin" });
    const outcome = await p.apply(proposal!);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("reauthorization-principal-changed");
    expect(await p.head()).toBe(0);
  });
});
