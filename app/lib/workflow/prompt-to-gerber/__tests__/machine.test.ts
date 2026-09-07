/**
 * B16.1C §C — the explicit workflow state machine: closed state set, legal
 * transitions only, no hidden auto-approval, reconstruction from durable
 * truth, deterministic idempotent step keys.
 */
import { describe, expect, it } from "vitest";
import { enabledActions, initialSnapshot, PENDING_STATES, reconstruct, REVIEW_STATES, stepKey, transition } from "../machine";
import { PROMPT_TO_GERBER_STATES, type PromptToGerberEvent, type PromptToGerberSnapshot } from "../types";

const SCOPE = { tenantId: "local", projectId: "p", branchId: "main", designId: "design:p", boardId: "board:p" };
const AT = "2026-09-07T12:00:00.000Z";
const ERR = { code: "X", message: "x", retryable: true };

function run(events: PromptToGerberEvent[], from: PromptToGerberSnapshot = initialSnapshot(SCOPE)): PromptToGerberSnapshot {
  let snapshot = from;
  for (const event of events) {
    const result = transition(snapshot, event, AT);
    if (!result.accepted) throw new Error(`refused ${event.type} in ${snapshot.state}: ${result.refused?.reason}`);
    snapshot = result.snapshot;
  }
  return snapshot;
}

const HAPPY: PromptToGerberEvent[] = [
  { type: "PROPOSE_SCHEMATIC", operationKey: "k1", baseDigest: "sha256:base0" },
  { type: "SCHEMATIC_PROPOSAL_READY", summary: "9 parts, 7 nets", digest: "sha256:proposal" },
  { type: "APPROVE_SCHEMATIC", operationKey: "k2" },
  { type: "SCHEMATIC_APPLIED", schematicBaseDigest: "sha256:base1" },
  { type: "RESOLVE_COMPONENT_AUTHORITY", operationKey: "k3" },
  { type: "COMPONENT_AUTHORITY_RESOLVED", boundInstances: 9 },
  { type: "SNAPSHOT_PUBLISHED", snapshotRevision: 1, schematicRevision: "schematic:abc" },
  { type: "PCB_PLAN_READY", planId: "plan-1", planDigest: "sha256:plan", summary: "add 9 footprints" },
  { type: "APPROVE_PCB", operationKey: "k4", planId: "plan-1", planDigest: "sha256:plan" },
  { type: "PCB_APPLIED", boardRevision: "pcb2-board1", boardDigest: "pb1-d1" },
  { type: "QUALIFY", operationKey: "k5", boardRevision: "pcb2-board1" },
  { type: "QUALIFIED", boardRevision: "pcb2-routed", boardDigest: "pb1-d2", authorityRevision: 1, authorityDigest: "sha256:auth", componentAuthorityDigest: "qualification-authority-1" },
  { type: "REQUEST_RELEASE", summary: "release authority r1" },
  { type: "AUTHORIZE_RELEASE", operationKey: "k6", authorityRevision: 1, authorityDigest: "sha256:auth" },
  { type: "RELEASED", releaseId: "mfg-release-1", archiveSha256: "abc", filename: "sirkit.zip", authorityRevision: 1, authorityDigest: "sha256:auth" },
];

describe("prompt-to-Gerber state machine", () => {
  it("declares exactly the 18 mandated states and walks the full success path through every review gate", () => {
    expect([...PROMPT_TO_GERBER_STATES]).toEqual(["idle", "hydrating_project", "proposing_schematic", "awaiting_schematic_review", "applying_schematic", "resolving_component_authority", "syncing_pcb", "proposing_pcb", "awaiting_pcb_review", "applying_pcb", "awaiting_qualification", "qualifying", "qualification_failed", "qualified", "awaiting_release_authorization", "releasing", "release_failed", "released"]);
    const visited: string[] = [];
    let snapshot = initialSnapshot(SCOPE);
    for (const event of HAPPY) { snapshot = run([event], snapshot); visited.push(snapshot.state); }
    expect(visited).toEqual(["proposing_schematic", "awaiting_schematic_review", "applying_schematic", "idle", "resolving_component_authority", "syncing_pcb", "proposing_pcb", "awaiting_pcb_review", "applying_pcb", "awaiting_qualification", "qualifying", "qualified", "awaiting_release_authorization", "releasing", "released"]);
    expect(snapshot.identity).toMatchObject({ schematicBaseDigest: "sha256:base1", snapshotRevision: 1, schematicRevision: "schematic:abc", boardRevision: "pcb2-routed", authorityRevision: 1, authorityDigest: "sha256:auth", releaseId: "mfg-release-1", releaseFilename: "sirkit.zip", planId: null });
    expect(snapshot.history).toHaveLength(15);
    expect(snapshot.history.every((entry) => entry.at === AT && entry.note.length > 0)).toBe(true);
  });

  it("never leaves a review state without the explicit human event (no hidden auto-approval)", () => {
    const awaitingSchematic = run(HAPPY.slice(0, 2));
    for (const event of [{ type: "SCHEMATIC_APPLIED", schematicBaseDigest: "x" }, { type: "RESOLVE_COMPONENT_AUTHORITY", operationKey: "k" }, { type: "QUALIFY", operationKey: "k", boardRevision: "b" }, { type: "RELEASED", releaseId: "r", archiveSha256: "a", filename: "f", authorityRevision: 1, authorityDigest: "d" }] as PromptToGerberEvent[]) {
      const result = transition(awaitingSchematic, event, AT);
      expect(result.accepted, event.type).toBe(false);
      expect(result.snapshot).toBe(awaitingSchematic);
    }
    const awaitingPcb = run(HAPPY.slice(0, 8));
    expect(transition(awaitingPcb, { type: "PCB_APPLIED", boardRevision: "b", boardDigest: "d" }, AT).accepted).toBe(false);
    // Approving a DIFFERENT plan than the one under review is refused.
    expect(transition(awaitingPcb, { type: "APPROVE_PCB", operationKey: "k", planId: "plan-other", planDigest: "sha256:plan" }, AT).refused?.reason).toMatch(/different plan/);
    const awaitingRelease = run(HAPPY.slice(0, 13));
    expect(transition(awaitingRelease, { type: "RELEASED", releaseId: "r", archiveSha256: "a", filename: "f", authorityRevision: 1, authorityDigest: "sha256:auth" }, AT).accepted).toBe(false);
    expect(transition(awaitingRelease, { type: "AUTHORIZE_RELEASE", operationKey: "k", authorityRevision: 2, authorityDigest: "sha256:auth" }, AT).refused?.reason).toMatch(/different authority/);
    for (const state of REVIEW_STATES) expect(["awaiting_schematic_review", "awaiting_pcb_review", "awaiting_release_authorization"]).toContain(state);
  });

  it("refuses a second start while the same operation is pending and refuses qualification of a non-current board", () => {
    const qualifying = run(HAPPY.slice(0, 11));
    expect(PENDING_STATES.has(qualifying.state)).toBe(true);
    expect(transition(qualifying, { type: "QUALIFY", operationKey: "k5", boardRevision: "pcb2-board1" }, AT).accepted).toBe(false);
    expect(enabledActions(qualifying)).toMatchObject({ qualify: false, requestRelease: false, propose: false });
    const awaiting = run(HAPPY.slice(0, 10));
    expect(transition(awaiting, { type: "QUALIFY", operationKey: "k", boardRevision: "pcb2-OTHER" }, AT).refused?.reason).toMatch(/other than the current durable board/);
  });

  it("release requires a current authority; a board change invalidates authority AND release truthfully", () => {
    const qualified = run(HAPPY.slice(0, 12));
    expect(enabledActions(qualified).requestRelease).toBe(true);
    const invalidated = run([{ type: "AUTHORITY_INVALIDATED", reason: "board re-synchronized", boardRevision: "pcb2-new" }], qualified);
    expect(invalidated.state).toBe("awaiting_qualification");
    expect(invalidated.identity).toMatchObject({ boardRevision: "pcb2-new", authorityRevision: null, authorityDigest: null, releaseId: null });
    expect(transition(invalidated, { type: "REQUEST_RELEASE", summary: "x" }, AT).accepted).toBe(false);
    const released = run(HAPPY);
    const resynced = run([{ type: "PCB_APPLIED", boardRevision: "pcb2-new", boardDigest: "pb1-new" }], run([{ type: "RESOLVE_COMPONENT_AUTHORITY", operationKey: "a" }, { type: "COMPONENT_AUTHORITY_RESOLVED", boundInstances: 9 }, { type: "SNAPSHOT_PUBLISHED", snapshotRevision: 2, schematicRevision: "schematic:def" }, { type: "PCB_PLAN_READY", planId: "plan-2", planDigest: "sha256:plan2", summary: "s" }, { type: "APPROVE_PCB", operationKey: "b", planId: "plan-2", planDigest: "sha256:plan2" }], released));
    expect(resynced.state).toBe("awaiting_qualification");
    expect(resynced.identity.releaseId).toBeNull();
    expect(resynced.identity.authorityRevision).toBeNull();
  });

  it("failures are explicit states with explicit, idempotent retry — no silent fallback", () => {
    const failedQualification = run([{ type: "QUALIFICATION_FAILED", error: { ...ERR, code: "MFG_QUALIFY_FAILED", correlationId: "c" } }], run(HAPPY.slice(0, 11)));
    expect(failedQualification.state).toBe("qualification_failed");
    expect(failedQualification.lastError?.correlationId).toBe("c");
    expect(enabledActions(failedQualification).retry).toBe(true);
    const retried = run([{ type: "RETRY" }], failedQualification);
    expect(retried.state).toBe("awaiting_qualification");
    expect(retried.lastError).toBeNull();
    const failedRelease = run([{ type: "RELEASE_FAILED", error: { ...ERR, code: "MFG_AUTHORITY_STALE" } }], run(HAPPY.slice(0, 14)));
    expect(failedRelease.state).toBe("release_failed");
    expect(run([{ type: "RETRY" }], failedRelease).state).toBe("qualified");
    // A refused schematic proposal returns to idle with the bounded error; a refused apply keeps the proposal for review.
    expect(run([{ type: "SCHEMATIC_PROPOSAL_FAILED", error: ERR }], run(HAPPY.slice(0, 1))).state).toBe("idle");
    expect(run([{ type: "SCHEMATIC_APPLY_FAILED", error: ERR }], run(HAPPY.slice(0, 3))).state).toBe("awaiting_schematic_review");
    expect(run([{ type: "PCB_APPLY_FAILED", error: ERR }], run(HAPPY.slice(0, 9))).state).toBe("awaiting_pcb_review");
    // Unknown/illegal events are refused with a reason and leave the snapshot untouched.
    const idle = initialSnapshot(SCOPE);
    const refused = transition(idle, { type: "QUALIFIED", boardRevision: "b", boardDigest: "d", authorityRevision: 1, authorityDigest: "a", componentAuthorityDigest: "c" }, AT);
    expect(refused).toMatchObject({ accepted: false, refused: { event: "QUALIFIED", state: "idle" } });
    expect(refused.snapshot).toBe(idle);
  });

  it("reconstructs truthful progress from durable records alone (refresh after each stage)", () => {
    const local = { hasSchematic: true, schematicBaseDigest: "sha256:base1" };
    const nothing = reconstruct(SCOPE, { boardFound: false, boardRevision: null, boardDigest: null, snapshot: null, authority: null, latestRelease: null }, { hasSchematic: false, schematicBaseDigest: null }, AT);
    expect(nothing.state).toBe("idle");
    const synced = reconstruct(SCOPE, { boardFound: true, boardRevision: "pcb2-b1", boardDigest: "pb1-1", snapshot: { revision: 1, schematicRevision: "schematic:abc" }, authority: null, latestRelease: null }, local, AT);
    expect(synced.state).toBe("awaiting_qualification");
    expect(synced.identity).toMatchObject({ boardRevision: "pcb2-b1", snapshotRevision: 1, schematicRevision: "schematic:abc", schematicBaseDigest: "sha256:base1" });
    const qualified = reconstruct(SCOPE, { boardFound: true, boardRevision: "pcb2-r", boardDigest: "pb1-2", snapshot: { revision: 1, schematicRevision: "schematic:abc" }, authority: { revision: 1, recordDigest: "sha256:auth", boardRevision: "pcb2-r", componentAuthorityDigest: "qa-1", current: true }, latestRelease: null }, local, AT);
    expect(qualified.state).toBe("qualified");
    expect(qualified.identity.authorityRevision).toBe(1);
    const released = reconstruct(SCOPE, { boardFound: true, boardRevision: "pcb2-r", boardDigest: "pb1-2", snapshot: { revision: 1, schematicRevision: "schematic:abc" }, authority: { revision: 1, recordDigest: "sha256:auth", boardRevision: "pcb2-r", componentAuthorityDigest: "qa-1", current: true }, latestRelease: { releaseId: "mfg-release-1", archiveSha256: "abc", filename: "sirkit.zip", authorityRevision: 1, current: true } }, local, AT);
    expect(released.state).toBe("released");
    expect(released.identity.releaseFilename).toBe("sirkit.zip");
    // Stale authority (board moved on) is NOT reported as qualified; a stale release is not reported as released.
    const stale = reconstruct(SCOPE, { boardFound: true, boardRevision: "pcb2-NEW", boardDigest: "pb1-3", snapshot: { revision: 2, schematicRevision: "schematic:def" }, authority: { revision: 1, recordDigest: "sha256:auth", boardRevision: "pcb2-r", componentAuthorityDigest: "qa-1", current: false }, latestRelease: { releaseId: "mfg-release-1", archiveSha256: "abc", filename: "sirkit.zip", authorityRevision: 1, current: false } }, local, AT);
    expect(stale.state).toBe("awaiting_qualification");
    expect(stale.identity.authorityRevision).toBeNull();
    expect(stale.identity.releaseId).toBeNull();
    // A pending review is browser-local and never survives a refresh — reconstruction never invents one.
    expect([nothing, synced, qualified, released, stale].every((snapshot) => snapshot.pendingReview === null && snapshot.pendingOperationKey === null)).toBe(true);
  });

  it("step keys are deterministic over scope + durable facts (a retry replays, a different fact never collides)", () => {
    const a = stepKey("qualify", SCOPE, { boardRevision: "pcb2-b1", componentAuthorityDigest: "qa-1" });
    const b = stepKey("qualify", SCOPE, { componentAuthorityDigest: "qa-1", boardRevision: "pcb2-b1" });
    expect(a).toBe(b);
    expect(stepKey("qualify", SCOPE, { boardRevision: "pcb2-b2", componentAuthorityDigest: "qa-1" })).not.toBe(a);
    expect(stepKey("qualify", { ...SCOPE, branchId: "feature" }, { boardRevision: "pcb2-b1", componentAuthorityDigest: "qa-1" })).not.toBe(a);
    expect(a).toContain("local/p/main/board:p");
  });
});
