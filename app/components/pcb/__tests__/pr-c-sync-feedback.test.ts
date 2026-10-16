/**
 * [PR-C F-08] PCB sync feedback — source-level pins on app/components/pcb/PcbEditor.tsx (read as text; rendering the editor in
 * jsdom is out of scope). The contract checkpoint C closes:
 *  1. no silent return: the `if (!client || !syncIdentity) return;` guard is gone from handleSync and handleApplySync; each guard
 *     says the demo or no-scope sentence; the apply single-flight refusal (`refused-busy`) speaks too;
 *  2. unresolved instances are named BEFORE any server call: `listUnresolvedInstances(` is consulted in handleSync before
 *     `runOwnedSyncPreparation(`, the refusal sets `syncBlockers` and returns; the list renders with its testids in the empty
 *     state and in the editor; Dismiss clears it; a later sync clears it first;
 *  3. a blocked preflight is persisted per blocker: `complete` sets `syncBlockers` and the existing `PcbSyncReadinessPanel`
 *     renders inside `data-testid="sync-readiness-panel"` without an apply handler of its own;
 *  4. a stale apply has its own sentence and retires the plan (`setPendingPreflight(null)` follows the sentence, in the
 *     owned-gated commitFailed); every other failure keeps its code and `detail`;
 *  5. the browser proof's testids are all kept; the B16-C.5 toasts are all kept.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/components/pcb/PcbEditor.tsx", "utf8");
const between = (start: string, end: string): string => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`section not found: ${start} … ${end}`);
  return source.slice(from, to);
};
const handleSync = between("const handleSync = useCallback(", "const handleApplySync = useCallback(");
const handleApplySync = between("const handleApplySync = useCallback(", "// ── History + move tool lifecycle");

const DEMO = "Schematic → PCB needs a saved project: demo boards have no durable scope.";
const NO_SCOPE = "Schematic → PCB could not start: the project scope is not available — reload the page or open the project again.";
const STALE = "Apply refused: the plan is stale — the board or schematic changed since preflight. Run Schematic → PCB again.";

describe("[PR-C 1] no silent return", () => {
  it("the bare scope guard is gone from the editor; both handlers say the demo or the no-scope sentence", () => {
    expect(source).not.toMatch(/if \(!client \|\| !syncIdentity\) return;/);
    expect(source).not.toMatch(/if \(!client \|\| !syncIdentity \|\| !plan\) return;/);
    for (const handler of [handleSync, handleApplySync]) {
      expect(handler).toContain("if (!client || !syncIdentity) {");
      expect(handler).toContain(`init.demo\n        ? "${DEMO}"\n        : "${NO_SCOPE}"`);
    }
    expect(handleApplySync).toContain('if (!plan) { setToast("Apply could not start: no preflighted plan is pending — run Schematic → PCB first."); return; }');
  });

  it("the apply single-flight refusal speaks, beside the B16-C.5 sync refusals that stay", () => {
    expect(handleApplySync).toContain("const run = await runVerifiedServerAdoption(ownedOps, \"sync-apply\", pcbLifecycle, {");
    expect(handleApplySync).toContain('if (run.status === "refused-busy") setToast("Apply is already running — wait for it to finish.");');
    expect(handleSync).toContain('if (run.status === "refused-busy") setToast("Schematic → PCB is already running — wait for it to finish.");');
    expect(handleSync).toContain('setToast("Schematic → PCB was not started: the board changed while it was starting. Try again.");');
  });
});

describe("[PR-C 2] unresolved instances are named before any server call", () => {
  it("handleSync lists the unresolved instances after the scope guard and before runOwnedSyncPreparation, and returns on a non-empty list", () => {
    const guard = handleSync.indexOf("if (!client || !syncIdentity) {");
    const listed = handleSync.indexOf("const unresolved = listUnresolvedInstances(s);");
    const prepared = handleSync.indexOf("runOwnedSyncPreparation(");
    expect(guard).toBeGreaterThan(-1);
    expect(listed).toBeGreaterThan(guard);
    expect(prepared).toBeGreaterThan(listed);
    const refusal = handleSync.slice(listed, prepared);
    expect(refusal).toContain('setSyncBlockers({ kind: "unresolved_instances", items: unresolved });');
    expect(refusal).toContain("setToast(unresolvedInstancesRefusal(unresolved));");
    expect(refusal).toMatch(/setToast\(unresolvedInstancesRefusal\(unresolved\)\);\s*return;/);
    // a later sync clears the previous refusal before it is recomputed
    const cleared = handleSync.indexOf("setSyncBlockers(null);");
    expect(cleared).toBeGreaterThan(guard);
    expect(cleared).toBeLessThan(listed);
  });

  it("the list renders in the empty state and in the editor with the row testids, and Dismiss clears it", () => {
    expect(source).toContain('data-testid="sync-unresolved-instances"');
    expect(source).toContain("data-testid={`sync-unresolved-${item.refDes}`}");
    expect(source).toContain("{UNRESOLVED_MISSING_LABEL[item.missing]}");
    expect(source).toContain("Review path: {item.reviewPath}");
    expect(source).toContain('<button type="button" onClick={onDismiss} data-testid="sync-blockers-dismiss"');
    expect(source.match(/<SyncBlockersPanel blockers=\{syncBlockers\} busy=\{syncing \|\| applying\} onDismiss=\{\(\) => setSyncBlockers\(null\)\} \/>/g)).toHaveLength(2);
    // one mount under the empty state's call to action, one in the editor's canvas area
    const emptyState = between('data-testid="pcb-empty-state"', "<SyncPlacementDialog");
    const editor = between('data-testid="pcb-editor"', "<DebugHud scene={scene} />");
    expect(emptyState).toContain("<SyncBlockersPanel");
    expect(editor).toContain("<SyncBlockersPanel");
  });
});

describe("[PR-C 3] a blocked preflight is persisted per blocker", () => {
  it("complete keeps the toast and sets the preflight blockers; the readiness panel renders inside sync-readiness-panel without an apply handler", () => {
    expect(handleSync).toContain('setSyncBlockers(preflighted.blockers.length > 0 ? { kind: "preflight", result: preflighted } : null);');
    expect(handleSync).toContain("`Sync blocked: ${preflighted.blockers.map((item) => `${item.code} ${item.displayRefs.join(\",\")}`).join(\"; \") || preflighted.status}`");
    expect(source).toContain('import { PcbSyncReadinessPanel } from "./PcbSyncReadinessPanel";');
    expect(source).toContain('<div className="mt-2" data-testid="sync-readiness-panel">');
    expect(source).toContain("<PcbSyncReadinessPanel result={blockers.result} busy={busy} />");
    expect(source).not.toMatch(/<PcbSyncReadinessPanel[^>]*onApply=/);
  });

  it("the blockers state is one union held until Dismiss or the next sync", () => {
    expect(source).toContain("const [syncBlockers, setSyncBlockers] = useState<SyncBlockers | null>(null);");
    expect(source).toContain('| { kind: "unresolved_instances"; items: UnresolvedInstance[] }');
    expect(source).toContain('| { kind: "preflight"; result: PcbSyncPreflightResult };');
  });
});

describe("[PR-C 4] a stale apply has its own sentence and retires the plan", () => {
  it("the stale sentence exists in commit, setPendingPreflight(null) follows it in the owned-gated commitFailed, and other failures keep code + detail", () => {
    const sentence = handleApplySync.indexOf(STALE);
    expect(sentence).toBeGreaterThan(-1);
    expect(handleApplySync).toContain('if (result.code === "PS_PLAN_STALE" || result.kind === "stale") {');
    const retired = handleApplySync.indexOf("if (stalePlan) setPendingPreflight(null);");
    expect(retired).toBeGreaterThan(sentence);
    expect(handleApplySync.slice(handleApplySync.indexOf("commitFailed: (message) => {"), retired)).not.toContain("adopt:"); // inside commitFailed, not adopt
    expect(handleApplySync).toContain("return { committed: false, message: `Apply failed: ${result.code}${result.detail ? ` — ${result.detail}` : \"\"}` };");
    expect(handleApplySync).toContain("return { committed: false, message: `Apply failed: ${result.value.status}` };");
  });
});

describe("[PR-C 5] the browser proof's testids and the existing sync toasts are kept", () => {
  it("every testid the prompt-to-gerber proof relies on is still in the editor", () => {
    for (const id of ["sync-schematic-to-pcb", "apply-sync-plan", "apply-sync-plan-toolbar", "pcb-empty-state", "pcb-editor", "pcb-save-status", "derive-board-revision", "server-divergence-banner"]) {
      expect(source, id).toContain(`data-testid="${id}"`);
    }
    expect(source).toContain("<ComponentReviewPanel review={componentReview} />");
    expect(source).toContain("Apply sync plan");
    expect(source).toContain("Apply verified plan");
  });

  it("every existing sync/apply toast is kept", () => {
    for (const text of [
      "Preflight ready. Review and explicitly apply the durable plan.",
      "PCB is already synchronized.",
      "Durable PCB plan applied and verified from the authoritative server board.",
      "Authoritative board committed, but its matching browser cache could not be stored.",
      "Another session published schematic revision ${published.conflict.currentRevision}",
      "Publication failed: ${published.code}",
      "Preflight failed: ${result.code}",
    ]) expect(source, text).toContain(text);
  });
});
