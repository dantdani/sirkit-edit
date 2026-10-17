/**
 * B07.4 — project-scoped async state, deferred-effect ownership, and
 * preflight command pinning.
 *
 *  §1  ProjectAsyncScopeRegistry behavior (generations, aborts, timers,
 *      request ids) — the reusable ownership mechanism itself.
 *  §2  Scoped suggestion batches (failure A): applicability gating.
 *  §3  Preflight command pinning (failures D): coordinator-level
 *      stillCurrent submission over deferred catalog loading.
 *  §4  Deferred effects (failure C): project-owned timers cannot fire for
 *      a stale generation; canceled timers write nothing.
 *  §5  Page wiring supplements (failures B/E/F): dialog gating, tier-1
 *      invocation-snapshot compilation, transition reset contract,
 *      request-owned busy state, scoped errors/streams/retries.
 *
 * §1–§4 are REAL asynchronous state transitions over the production
 * modules; §5 supplements with structural assertions of the page wiring
 * those modules protect.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore } from "../persistence";
import { ProjectAsyncScopeRegistry, evaluateSuggestionBatch, type ScopedSuggestionBatch } from "../project-async-scope";
import { SchematicGestureCoordinator, type GestureCoordinatorHost } from "../schematic-gesture-coordinator";
import { schematicStateDigest, type CanonicalSchematic } from "../schematic-model";
import { SchematicEditorSession } from "../schematic-session";
import type { EngineeringOperation } from "../types";

const SCOPE = { tenantId: "tenant-b074", projectId: "project-b074", branchId: "main" } as const;

function state(x: number): SchematicState {
  return {
    components: [{ id: "uuid-r1", type: "resistor", x, y: 100, rotation: 0, value: "1k", refDes: "R1" }],
    kicadComponents: [], wires: [], netLabels: [],
  };
}

const op = (partial: Record<string, unknown>): EngineeringOperation =>
  ({ schemaVersion: 1, units: "px", ...partial }) as unknown as EngineeringOperation;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── §1 Registry behavior ────────────────────────────────────────────────────

describe("B07.4 §1 — project async scope registry", () => {
  it("scopes are generation-bound: beginProject (even for the SAME project id) stales prior scopes — project id alone is never enough", () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "p1", branchId: "main", session: "session-1" });
    const scopeA = registry.capture();
    expect(scopeA.isCurrent()).toBe(true);
    // Same project rehydrated into a NEW session: old scopes go stale.
    registry.beginProject({ projectId: "p1", branchId: "main", session: "session-2" });
    expect(scopeA.isCurrent()).toBe(false);
    let ran = false;
    expect(scopeA.ifCurrent(() => { ran = true; })).toBe(false);
    expect(ran).toBe(false);
    const scopeB = registry.capture();
    expect(scopeB.isCurrent()).toBe(true);
    expect(scopeB.requestId).not.toBe(scopeA.requestId);
    expect(scopeB.session).toBe("session-2");
  });

  it("T24: beginProject ABORTS the previous generation's signal (in-flight fetches cancel; dispose aborts everything)", () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "p1", branchId: "main", session: "s1" });
    const scopeA = registry.capture();
    expect(scopeA.signal.aborted).toBe(false);
    registry.beginProject({ projectId: "p2", branchId: "main", session: "s2" });
    expect(scopeA.signal.aborted).toBe(true);   // old fetches abort
    const scopeB = registry.capture();
    expect(scopeB.signal.aborted).toBe(false);  // new generation's signal is fresh
    registry.dispose();
    expect(scopeB.signal.aborted).toBe(true);
    expect(registry.capture().isCurrent()).toBe(false); // nothing is current after dispose
  });

  it("T10+T23: generation-owned timers are canceled by a project transition and NEVER fire for a stale scope", async () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "p1", branchId: "main", session: "s1" });
    const scopeA = registry.capture();
    let fired = 0;
    scopeA.setTimeout(() => { fired += 1; }, 5);   // canceled by transition below
    registry.beginProject({ projectId: "p2", branchId: "main", session: "s2" });
    await sleep(20);
    expect(fired).toBe(0);                          // canceled timer wrote nothing
    // A timer created from an ALREADY-stale scope never even schedules.
    scopeA.setTimeout(() => { fired += 1; }, 1);
    await sleep(15);
    expect(fired).toBe(0);
    // A current-generation timer fires normally (same-project behavior kept)…
    const scopeB = registry.capture();
    scopeB.setTimeout(() => { fired += 1; }, 5);
    await sleep(20);
    expect(fired).toBe(1);
    // …and the returned cancel handle prevents a scheduled run.
    let canceled = 0;
    const cancel = registry.capture().setTimeout(() => { canceled += 1; }, 5);
    cancel();
    await sleep(20);
    expect(canceled).toBe(0);
  });

  it("T18 (mechanism): request-owned busy state — a stale request's finally cannot clear a newer request's flag", () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "p1", branchId: "main", session: "s1" });
    // The page pattern: activeRef holds the OWNING requestId; finally only
    // clears when it still owns the flag.
    let busy = false;
    let activeRef: string | null = null;
    const start = (scope: { requestId: string }) => { activeRef = scope.requestId; busy = true; };
    const finish = (scope: { requestId: string }) => { if (activeRef === scope.requestId) { activeRef = null; busy = false; } };
    const oldRequest = registry.capture();
    start(oldRequest);
    const newRequest = registry.capture();
    start(newRequest);          // a newer request takes ownership
    finish(oldRequest);         // the STALE request's finally runs late…
    expect(busy).toBe(true);    // …and cannot clear the newer request's busy state
    finish(newRequest);
    expect(busy).toBe(false);
  });
});

// ─── §2 Scoped suggestion batches (failure A) ────────────────────────────────

describe("B07.4 §2 — suggestion batches carry exact ownership", () => {
  function makeBatch(registry: ProjectAsyncScopeRegistry, digest: string): ScopedSuggestionBatch {
    return {
      items: [{ title: "Add decoupling", detail: "100n at U1", severity: "warning", refs: ["U1"], source: "review" }],
      scope: registry.capture({ baseDigest: digest }),
      baseSchematicDigest: digest,
      createdAt: 1,
    };
  }

  it("T2: a batch captured in project A is refused in project B BEFORE any request (project/session mismatch)", () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "A", branchId: "main", session: "sA" });
    const digest = schematicStateDigest(state(100));
    const batch = makeBatch(registry, digest);
    expect(evaluateSuggestionBatch(batch, digest).applicable).toBe(true);
    registry.beginProject({ projectId: "B", branchId: "main", session: "sB" });
    const evaluation = evaluateSuggestionBatch(batch, digest);
    expect(evaluation.applicable).toBe(false);
    if (evaluation.applicable) throw new Error("unreachable");
    expect(evaluation.reason).toContain("different project or session");
  });

  it("T3: a batch goes stale after a same-project canonical edit (exact base digest, never silently rebased)", () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "A", branchId: "main", session: "sA" });
    const baseDigest = schematicStateDigest(state(100));
    const batch = makeBatch(registry, baseDigest);
    const editedDigest = schematicStateDigest(state(200)); // an authoritative mutation superseded the base
    const evaluation = evaluateSuggestionBatch(batch, editedDigest);
    expect(evaluation.applicable).toBe(false);
    if (evaluation.applicable) throw new Error("unreachable");
    expect(evaluation.reason).toContain("stale");
    // Same project, same base → still applicable (legitimate flow kept).
    expect(evaluateSuggestionBatch(batch, baseDigest).applicable).toBe(true);
  });

  it("T4 (mechanism): a late producer whose scope went stale cannot repopulate a batch", () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "A", branchId: "main", session: "sA" });
    const reviewScope = registry.capture({ baseDigest: "eng1-a" });
    registry.beginProject({ projectId: "B", branchId: "main", session: "sB" });
    // The page's producer gate: batch is stored only via scope.ifCurrent-
    // equivalent check (reviewStillCurrent = scope.isCurrent() && digest ok).
    let stored: ScopedSuggestionBatch | null = null;
    if (reviewScope.isCurrent()) {
      stored = { items: [], scope: reviewScope, baseSchematicDigest: "eng1-a", createdAt: 1 };
    }
    expect(stored).toBeNull();
  });
});

// ─── §3 Preflight command pinning (failure D) ────────────────────────────────

function makeCommandHarness(initial: SchematicState) {
  const editor = new SchematicEditorSession(SCOPE, { store: new InMemoryAtomicProjectStore() });
  let visible = structuredClone(initial);
  const adoptions: string[] = [];
  const host: GestureCoordinatorHost = {
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => undefined,
    applyCanonicalProjection: (label, s) => { visible = structuredClone(s); adoptions.push(label); coordinator.notifyAuthoritativeProjection(s); },
    applyRollbackProjection: (s) => { visible = structuredClone(s); coordinator.notifyAuthoritativeProjection(s); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => undefined,
  };
  const coordinator = new SchematicGestureCoordinator(host);
  return { editor, coordinator, adoptions, visibleState: () => structuredClone(visible) };
}

describe("B07.4 §3 — catalog preflight cannot retarget commands", () => {
  const deleteOps = (canonical: CanonicalSchematic): EngineeringOperation[] =>
    [op({ operationId: "op:del", kind: "schematic_delete_component", family: "theory", componentId: canonical.components[0].id, removeWireIds: [], removeNetLabelIds: [] })];

  it("T11+T12: a delete/swap whose preflight started in project A is CANCELED (never executed) when the scope goes stale before submission or execution", async () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "A", branchId: "main", session: "sA" });
    const h = makeCommandHarness(state(100));
    await h.editor.openForProject(state(100), null);
    h.coordinator.notifyAuthoritativeProjection(state(100));

    // Page pattern: scope captured BEFORE the catalog await…
    const scope = registry.capture();
    await sleep(5);                                     // …catalog preflight resolves…
    registry.beginProject({ projectId: "B", branchId: "main", session: "sB" }); // …but the project switched.
    // Caller-side cancel (checked after the await): no submission at all.
    expect(scope.isCurrent()).toBe(false);
    // Defense in depth: even if submitted, the coordinator cancels it.
    const gate = await h.coordinator.runCanonicalCommand({
      label: "Deleted component",
      stillCurrent: () => scope.isCurrent(),
      execute: (base) => h.editor.execute(base, { commandId: "schematic.delete-component", label: "Deleted component", buildOperations: deleteOps }),
    });
    expect(gate.status).toBe("canceled-stale");
    if (gate.status !== "canceled-stale") throw new Error("unreachable");
    expect(gate.stage).toBe("before-execution");        // canceled WITHOUT executing
    expect(h.editor.headMark()?.headSequence).toBe(0);  // the same-id component in "B" was never deleted
    expect(h.adoptions).toEqual([]);
    expect(h.visibleState().components).toHaveLength(1);
  });

  it("T13: a same-project delete after catalog loading still executes against the LATEST canonical head", async () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "A", branchId: "main", session: "sA" });
    const h = makeCommandHarness(state(100));
    await h.editor.openForProject(state(100), null);
    h.coordinator.notifyAuthoritativeProjection(state(100));

    const scope = registry.capture();
    // While the catalog loads, a same-project edit advances the head…
    const edit = await h.coordinator.runCanonicalCommand({
      label: "Changed value",
      execute: (base) => h.editor.execute(base, {
        commandId: "schematic.set-property", label: "Changed value",
        buildOperations: (c) => [op({ operationId: "op:v", kind: "schematic_set_component_properties", family: "theory", componentId: c.components[0].id, patch: { value: "9k" } })],
      }),
    });
    expect(edit.status).toBe("applied");
    await sleep(5); // catalog preflight resolves
    expect(scope.isCurrent()).toBe(true); // same project/session — still current
    const gate = await h.coordinator.runCanonicalCommand({
      label: "Deleted component",
      stillCurrent: () => scope.isCurrent(),
      execute: (base) => h.editor.execute(base, { commandId: "schematic.delete-component", label: "Deleted component", buildOperations: deleteOps }),
    });
    expect(gate.status).toBe("applied");   // plan built against the LATEST head (with the 9k edit)
    expect(h.editor.headMark()?.headSequence).toBe(2);
    expect(h.visibleState().components).toHaveLength(0);
  });
});

// ─── §4 + §5 Page wiring supplements ─────────────────────────────────────────

describe("B07.4 §5 — page wiring (SUPPLEMENT to the behavioral tests above)", () => {
  const source = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");

  it("T1+T22: the project-transition reset intentionally clears every project-owned transient field, and hydration runs it", () => {
    const resetBody = source.slice(source.indexOf("const resetTransientProjectState"), source.indexOf("const installProject"));
    for (const cleared of [
      "setPendingReplace(null)", "setPendingTier1(null)", "setSchematicRecovery(null)",
      "setPendingSuggestions(null)", "setGenError(null)", "setAiProviderFailure(null)",
      "lastAiRetryRef.current = null",
      "setIsGenerating(false)", "setIsEditing(false)", "setIsReviewing(false)",
      "setIsTidying(false)", "setIsSecondOpinion(false)", "setLoading(false)",
    ]) {
      expect(resetBody, `reset must clear: ${cleared}`).toContain(cleared);
    }
    // T20 — lastDesignPrompt is HYDRATED (loaded value or explicit default),
    // never leaked from the previous project.
    expect(resetBody).toContain('setLastDesignPrompt(record.designPrompt ?? "")');
    // [B12.2] the hydration body lives in installProject; hydrateProject
    // routes through the serialized transition coordinator.
    const installBody = source.slice(source.indexOf("const installProject"), source.indexOf("const hydrateProject"));
    expect(installBody).toContain("resetTransientProjectState(record)");
    expect(installBody).toContain("beginProject({ projectId: record.id");
    expect(installBody).not.toContain("if (record.designPrompt) setLastDesignPrompt");
    const hydrateBody = source.slice(source.indexOf("const hydrateProject"), source.indexOf("// Mount bootstrap"));
    expect(hydrateBody).toContain("projectTransitionRef.current!.request(");
    expect(hydrateBody).toContain("() => installProject(record, opts)");
    // [B12.3 §F / B12.5 §C] transition outcomes are truthful: only failed
    // transitions surface (pre-commit failures toast "unchanged";
    // commit-phase failures route to BLOCKING activation recovery).
    expect(hydrateBody).toContain('if (outcome.status !== "transition-failed") return;');
    expect(hydrateBody).toContain("if (outcome.recovery)");
    expect(hydrateBody).toContain("setActivationRecovery(outcome.detail)");
  });

  it("T5+T6+T7: the replacement dialog opens only for a current scope + matching base + valid result; hydration closes it via the reset", () => {
    const genBody = source.slice(source.indexOf("async function handleGenerateSchematic"), source.indexOf("// Tier-1 text editing"));
    expect(genBody).toContain("if (!scope.isCurrent())");
    expect(genBody).toContain("validateSchematicStateIntegrity(state)");
    expect(genBody).toContain("authoritativeDigestNow !== pin.baseDigest");
    // Stale results mark only the originating activity log — no dialog, no
    // global error in the other project.
    expect(genBody).toContain('failActivityLog(logId, "Result discarded — the project changed while generating")');
    // The valid path still opens the dialog (same-project behavior kept).
    // [PR-L step 0, 2026-10-17] since PR-C (checkpoint C) the call also carries the proposal's validation note beside the
    // lifecycle pin; the pin moves to the current call. The point is unchanged: the pending replace is set only after the
    // scope guard, the integrity check and the base-digest check above.
    expect(genBody).toContain("setPendingReplace({ state, explanation, prompt, logId, promptAlreadyLogged: true, pin, validationNote })");
    const offeredAt = genBody.indexOf("setPendingReplace({ state, explanation, prompt, logId, promptAlreadyLogged: true, pin, validationNote })");
    expect(genBody.indexOf("if (!scope.isCurrent())")).toBeLessThan(offeredAt);
    expect(genBody.indexOf("authoritativeDigestNow !== pin.baseDigest")).toBeLessThan(offeredAt);
  });

  it("T8+T9: the generation checkpoint is written immediately to the CAPTURED project from the exact adopted candidate — no ambient delayed addCheckpoint remains", () => {
    const applyBody = source.slice(source.indexOf("async function applySchematic"), source.indexOf("async function handleGenerateSchematic"));
    expect(applyBody).toContain("const checkpointProject = applyForProject;");
    expect(applyBody).toContain("projectId: checkpointProject");
    expect(applyBody).toContain("schematic: structuredClone(appliedState)");
    expect(applyBody).not.toContain("setTimeout(() => addCheckpoint");
    expect(source).not.toContain("setTimeout(() => addCheckpoint");
    // Failure reporting is scope-guarded (correct project only).
    expect(applyBody).toContain("scope.ifCurrent(() => showToast(`Checkpoint could not be saved");
  });

  it("T14+T15+T16: tier-1 output stays pinned to the INVOCATION snapshot — compiled and sealed against it, pin rechecked after catalog awaits, sealed digest verified", () => {
    const editBody = source.slice(source.indexOf("async function handleEditSchematic"), source.indexOf("// Layer-2 design review"));
    expect(editBody).toContain("const tier1StillPinned = ()");
    expect(editBody).toContain("compileTier1Proposal(snapshot, { ops: data.ops, pinsByPartId })");
    expect(editBody).toContain("state: snapshot,");
    expect(editBody).not.toContain("compileTier1Proposal(tier1State");
    expect(editBody).not.toContain("const tier1State = currentSchematicState()");
    expect(editBody).toContain("sealed.proposal.baseSchematicDigest !== pin.baseDigest");
    // Pin rechecked BEFORE compilation and AFTER the ensurePartLoaded awaits.
    expect((editBody.match(/tier1StillPinned\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("T17+T18+T19+T24: errors, busy flags, retries, and aborts are request/project-scoped in every async handler", () => {
    // Scoped error writer exists and unscoped patterns are gone.
    expect(source).toContain("const setScopedGenError = useCallback((scope: ProjectAsyncScope");
    expect(source.match(/setTimeout\(\(\) => setGenError\(null\)/g) ?? []).toHaveLength(2); // both inside scoped helpers
    // Request-owned busy clears.
    for (const guard of [
      "if (activeGenerationRef.current === scope.requestId)",
      "if (activeEditRef.current === scope.requestId)",
      "if (activeReviewRef.current === reviewScope.requestId)",
      "if (activeTidyRef.current === tidyScope.requestId)",
      "if (activeSecondOpinionRef.current === opinionScope.requestId)",
      "if (activeChatRef.current === scope.requestId)",
    ]) {
      expect(source, `request-owned busy guard: ${guard}`).toContain(guard);
    }
    // Abort = cancellation, never provider failure.
    expect(source).toContain("const isAbortError = (error: unknown)");
    expect((source.match(/isAbortError\(err\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("T21: chat streaming uses collision-resistant UUID ids, an abortable fetch, and a scope-gated stream loop", () => {
    const sendBody = source.slice(source.indexOf("async function send("), source.indexOf("// B07.4 — ONE project async-scope registry"));
    expect(sendBody).toContain('const userMsg: ChatMessage  = { id: crypto.randomUUID()');
    expect(sendBody).toContain("const assistantId           = crypto.randomUUID()");
    expect(sendBody).not.toContain("Date.now().toString()");
    expect(sendBody).toContain("signal: scope.signal");
    expect(sendBody).toContain("if (!scope.isCurrent()) {");
    expect(sendBody).toContain("reader.cancel()");
  });

  it("T11/T12 (wiring): delete and swap capture their scope BEFORE catalog preflight, cancel after the await, and submit with the captured scope", () => {
    const deleteBody = source.slice(source.indexOf("const deleteComponentCanonical"), source.indexOf("/** Canonical discrete rotate"));
    expect(deleteBody).toContain("const scope = projectScopeRegistryRef.current!.capture();");
    expect(deleteBody).toContain("if (!scope.isCurrent()) return;");
    expect(deleteBody).toContain("}, { scope });");
    const swapBody = source.slice(source.indexOf("async function handleSwapPart"), source.indexOf("const selectedComp"));
    expect(swapBody).toContain("const scope = projectScopeRegistryRef.current!.capture();");
    expect(swapBody).toContain("if (!scope.isCurrent()) return;");
    expect(swapBody).toContain("}, { scope });");
    // runSchematicCommand submits to the CAPTURED session, never silently
    // substituting the current one.
    expect(source).toContain("? (options.scope.session as SchematicEditorSession | null)");
  });

  it("T23 (wiring): the auto tidy→review pipeline runs on a project-owned timer", () => {
    const pipelineBody = source.slice(source.indexOf("// Post-apply auto pipeline"), source.indexOf("// Cross-verify"));
    expect(pipelineBody).toContain("const pipelineScope = projectScopeRegistryRef.current!.capture();");
    expect(pipelineBody).toContain("pipelineScope.setTimeout(");
    expect(pipelineBody).toContain("if (!pipelineScope.isCurrent()) return;");
  });

  it("T1–T3 (wiring): suggestion batches are scoped, staleness-cleared by an authoritative-mirror effect, and Apply refuses stale batches before any request", () => {
    expect(source).toContain("useState<ScopedSuggestionBatch | null>(null)");
    expect(source).toContain("evaluateSuggestionBatch(batch, schematicStateDigest(");
    const staleEffect = source.slice(source.indexOf("// B07.4 — a suggestion batch goes STALE"), source.indexOf("/** User prompts"));
    expect(staleEffect).toContain("!pendingSuggestions.scope.isCurrent()");
    expect(staleEffect).toContain("schematicStateDigest(authoritativeSchematic) !== pendingSuggestions.baseSchematicDigest");
    const applyBody = source.slice(source.indexOf("async function handleApplySuggestions"), source.indexOf("function handleComposerSubmit"));
    expect(applyBody).toContain("if (!evaluation.applicable) {");
    expect(applyBody).toContain("setPendingSuggestions(null);");
    expect(applyBody).toContain("showToast(evaluation.reason);");
  });
});
