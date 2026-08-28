/**
 * B12.4 §D/§E — failed-transition rollback (R4) and the current-project
 * pointer commit (R5).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore } from "../persistence";
import { compileTier1Proposal } from "../schematic-plans";
import { sealTier1Proposal, type Tier1ProposalScope } from "../schematic-proposals";
import { buildAuthorizationBinding, UNVERIFIED_MEMBERSHIP_REVISION } from "../proposal-authorization";
import type { MembershipReauthorizer } from "../../project/membership-reauthorization";
import { SchematicEditorSession } from "../schematic-session";
import { SchematicGestureCoordinator } from "../schematic-gesture-coordinator";
import { SchematicHistory } from "../../project/schematic-history";
import { adoptCanonicalResult } from "../../project/canonical-adoption";
import { ProjectTransitionCoordinator, type ProjectTransitionOutcome } from "../project-transition-coordinator";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "../approved-mutation-journal";
import type { SchematicEditOp } from "@/lib/schematic-types";
import {
  ApprovedMutationAuditLedger, ApprovedMutationRegistry, applyApprovedTier1Proposal,
} from "../approved-agent-mutations";

const PROJECT = { tenantId: "local", projectId: "proj-b124d", branchId: "main" } as const;
const SEAL_NOW = 1_700_000_000_000;

// B16.0.1 §E/§F: the test principal the fixtures seal under, and a stub
// reauthorizer returning the MATCHING live snapshot.
const TEST_PRINCIPAL = "local-user";
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: TEST_PRINCIPAL, role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});

function baseState(): SchematicState {
  return {
    components: [
      { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
    ],
    wires: [],
  };
}

describe("B12.4 §D/R4 — a failed transition leaves the surviving project fully OPERATIONAL", () => {
  it("after a failed beforeInstall the survivor holds a FRESH ACTIVE interlock and a real approved apply succeeds end-to-end", async () => {
    let failNext = false;
    const transition: ProjectTransitionCoordinator = new ProjectTransitionCoordinator({
      beforeInstall: () => (failNext ? { ok: false, detail: "flush failed" } : { ok: true }),
    });
    // Install project A with a REAL session composition.
    const store = new InMemoryAtomicProjectStore();
    const state = baseState();
    const session = new SchematicEditorSession({ ...PROJECT }, { store });
    await session.openForProject(structuredClone(state), null);
    let visible: SchematicState = structuredClone(state);
    const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
    const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
      currentState: () => structuredClone(visible),
      applyPreviewFrame: () => {},
      applyCanonicalProjection: (label, next) => {
        const outcome = adoptCanonicalResult<SchematicState>({
          flushPendingRecord: () => {}, history: () => history,
          applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
          snapshot: (authoritative) => structuredClone(authoritative),
          historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
        }, label, next);
        if (!outcome.ok) throw new Error(outcome.detail);
      },
      applyRollbackProjection: (next) => { visible = structuredClone(next); },
      execute: (base, request) => session.execute(base, request),
      notify: () => {},
    });
    transition.request(() => { /* project A installed */ });
    const interlockA = transition.currentInterlock()!;

    // The switch to B fails its required flush.
    failNext = true;
    const outcomes: ProjectTransitionOutcome[] = [];
    let installedB = false;
    transition.request(() => { installedB = true; }, (outcome) => outcomes.push(outcome));
    failNext = false;
    // R4 closure: one typed failure; NO installation; pending settled; the
    // survivor's interlock is a FRESH ACTIVE one (never the retired A one,
    // and reactivated only after the settled retirement barrier).
    expect(outcomes).toEqual([{ status: "transition-failed", detail: "flush failed" }]);
    expect(installedB).toBe(false);
    expect(transition.transitionPending).toBe(false);
    const survivor = transition.currentInterlock()!;
    expect(survivor).not.toBe(interlockA);
    expect(survivor.retired).toBe(false);
    const lease = survivor.acquireCommitLease();
    expect(lease.ok).toBe(true);
    if (lease.ok) lease.lease.release();

    // The surviving session/history/scope are authoritative — a REAL
    // approved apply works WITHOUT a successful switch first.
    const scope: Tier1ProposalScope = { ...PROJECT, headMark: session.headMark()! };
    const compilation = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "4k7" } as SchematicEditOp], pinsByPartId: new Map() });
    const sealed = sealTier1Proposal({
      state, compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
      authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId } }),
    });
    if (sealed.kind !== "sealed") throw new Error("seal failed");
    let tick = SEAL_NOW + 1_000;
    const applied = await applyApprovedTier1Proposal({
      proposal: sealed.proposal, session, gateway: coordinator, interlock: transition.currentInterlock()!,
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { ...PROJECT }),
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => true,
      currentProjectId: PROJECT.projectId, currentBranchId: PROJECT.branchId,
      now: () => { tick += 1_000; return tick; }, registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
    });
    expect(applied.ok && applied.status === "committed").toBe(true);
    expect(history.view().entries.length).toBe(2);
  });

  it("reactivation happens only AFTER the retirement barrier settles (an outstanding lease is never raced)", async () => {
    let failNext = false;
    const transition: ProjectTransitionCoordinator = new ProjectTransitionCoordinator({
      beforeInstall: () => (failNext ? { ok: false, detail: "flush failed" } : { ok: true }),
    });
    transition.request(() => { /* A */ });
    const interlockA = transition.currentInterlock()!;
    const lease = interlockA.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    failNext = true;
    const outcomes: ProjectTransitionOutcome[] = [];
    transition.request(() => { /* B */ }, (outcome) => outcomes.push(outcome));
    // Barrier pending — no reactivation yet, retiring interlock reachable.
    expect(transition.transitionPending).toBe(true);
    expect(transition.currentInterlock()).toBe(interlockA);
    lease.lease.release();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(outcomes).toEqual([{ status: "transition-failed", detail: "flush failed" }]);
    const survivor = transition.currentInterlock()!;
    expect(survivor).not.toBe(interlockA);
    expect(survivor.retired).toBe(false);
    expect(transition.transitionPending).toBe(false);
  });
});

describe("B12.4 §E/R5 — the persisted current-project pointer commits only on the winning install", () => {
  const backing = new Map<string, string>();
  beforeEach(() => {
    backing.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => { backing.set(key, String(value)); },
      removeItem: (key: string) => { backing.delete(key); },
      key: (index: number) => [...backing.keys()][index] ?? null,
      get length() { return backing.size; },
      clear: () => backing.clear(),
    };
  });
  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

  async function pointerHarness() {
    const { createProjectRecord, loadProjectRecord, markProjectCurrent, currentProjectId, bootstrapCurrentProject } = await import("../../project/current");
    let failFlush = false;
    let visible = "";
    let pointerWrites = 0;
    const originalSet = (globalThis as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage.setItem;
    (globalThis as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage.setItem = (key: string, value: string) => {
      if (key === "sirkit:currentProjectId") pointerWrites += 1;
      originalSet(key, value);
    };
    const transition: ProjectTransitionCoordinator = new ProjectTransitionCoordinator({
      beforeInstall: () => (failFlush ? { ok: false, detail: "autosave flush failed" } : { ok: true }),
    });
    // The page's install body: the LAST act of a winning install commits
    // the pointer (mirrors installProject).
    const installFor = (id: string) => () => { visible = id; markProjectCurrent(id); };
    return {
      createProjectRecord, loadProjectRecord, currentProjectId, bootstrapCurrentProject,
      transition, installFor,
      visible: () => visible,
      setFailFlush: (value: boolean) => { failFlush = value; },
      pointerWrites: () => pointerWrites,
    };
  }

  it("R5 closure: a FAILED switch leaves the pointer on the installed project (no split-brain; reload bootstraps the visible project)", { timeout: 20_000 }, async () => {
    const h = await pointerHarness();
    const projectA = h.createProjectRecord("Project A");
    const projectB = h.createProjectRecord("Project B");
    h.transition.request(h.installFor(projectA.id));
    expect(h.visible()).toBe(projectA.id);
    expect(h.currentProjectId()).toBe(projectA.id);
    // The switch to B: load WITHOUT activating, then the transition fails.
    h.setFailFlush(true);
    const loaded = h.loadProjectRecord(projectB.id);
    expect(loaded).not.toBeNull();
    expect(h.currentProjectId()).toBe(projectA.id); // loading did NOT activate
    let outcome = "";
    h.transition.request(h.installFor(projectB.id), (result) => { outcome = result.status; });
    expect(outcome).toBe("transition-failed");
    expect(h.visible()).toBe(projectA.id);
    expect(h.currentProjectId()).toBe(projectA.id); // NO split-brain
    expect(h.bootstrapCurrentProject().project.id).toBe(projectA.id); // a reload agrees with the UI
  });

  it("a SUPERSEDED target never touches the pointer; the final winner commits it exactly once", { timeout: 20_000 }, async () => {
    const h = await pointerHarness();
    const projectA = h.createProjectRecord("A");
    const projectB = h.createProjectRecord("B");
    const projectC = h.createProjectRecord("C");
    h.transition.request(h.installFor(projectA.id));
    const writesAfterA = h.pointerWrites();
    // Hold a lease so B and C queue; C supersedes B.
    const lease = h.transition.currentInterlock()!.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    h.transition.request(h.installFor(projectB.id));
    h.transition.request(h.installFor(projectC.id));
    lease.lease.release();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(h.visible()).toBe(projectC.id);
    expect(h.currentProjectId()).toBe(projectC.id); // never B
    expect(h.pointerWrites()).toBe(writesAfterA + 1); // exactly ONE write, by the winner
  });

  it("create/import-style records persist WITHOUT becoming current until installation wins", { timeout: 20_000 }, async () => {
    const h = await pointerHarness();
    const projectA = h.createProjectRecord("A");
    h.transition.request(h.installFor(projectA.id));
    // A created-but-never-installed record must not own the pointer.
    const projectNew = h.createProjectRecord("Fresh");
    expect(h.currentProjectId()).toBe(projectA.id);
    // A failing transition to it leaves the pointer untouched.
    h.setFailFlush(true);
    h.transition.request(h.installFor(projectNew.id));
    expect(h.currentProjectId()).toBe(projectA.id);
    h.setFailFlush(false);
    // The successful transition commits it.
    h.transition.request(h.installFor(projectNew.id));
    expect(h.currentProjectId()).toBe(projectNew.id);
  });

  it("page wiring (source gates): switch/create/import load without activating; installProject commits the pointer; no raw flush in transition handlers", () => {
    const source = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");
    const switchBody = source.slice(source.indexOf("const switchProject"), source.indexOf("const createNewProject"));
    expect(switchBody).toContain("loadProjectRecord(id)");
    expect(switchBody).not.toContain("openProject(");
    expect(switchBody).not.toContain("autosaverRef.current?.flush()");
    const createBody = source.slice(source.indexOf("const createNewProject"), source.indexOf("const handleExportProject"));
    expect(createBody).toContain("createProjectRecord()");
    expect(createBody).not.toContain("startNewProject(");
    expect(createBody).not.toContain("autosaverRef.current?.flush()");
    const importBody = source.slice(source.indexOf("const handleImportProjectFile"), source.indexOf("const handleRenameProject"));
    expect(importBody).not.toContain("openProject(");
    const installBody = source.slice(source.indexOf("const installProject"), source.indexOf("const hydrateProject"));
    expect(installBody).toContain("markProjectCurrent(record.id)");
  });
});
