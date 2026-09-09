// @vitest-environment jsdom
/**
 * [B16-C.5] React StrictMode (development) runs every effect's cleanup once and
 * mounts the effect again WITHOUT re-rendering. The lifecycle owners used to be
 * disposed permanently by that simulated unmount, so — in `next dev` only — every
 * request-owned PCB workflow (Schematic → PCB, apply, qualification) captured a
 * never-current scope and ended "stale" before its first server call: the click
 * did nothing. Found by the page-level browser proof; pinned here behaviourally
 * against the real owners and the exact effect pattern the editors use.
 */
import { StrictMode, useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PcbBoardLifecycleOwner } from "@/app/lib/pcb/lifecycle/board-lifecycle";
import { PcbOwnedOperationRegistry, runOwnedSyncPreparation } from "@/app/lib/pcb/lifecycle/owned-operations";
import { ProjectAsyncScopeRegistry } from "@/app/lib/engineering/project-async-scope";

const IDENTITY = { tenantId: "t", projectId: "p", branchId: "main", boardId: "board:p" };

// (StrictMode also double-invokes the useState initializer and keeps ONE instance; the
//  effect reports the instance React kept.)
function Editor({ onOwner }: { onOwner: (owner: PcbBoardLifecycleOwner) => void }) {
  const [owner] = useState(() => { const o = new PcbBoardLifecycleOwner(); o.adopt(IDENTITY); return o; });
  useEffect(() => { onOwner(owner); owner.resume(); return () => owner.dispose(); }, [owner, onOwner]);
  return null;
}

function LegacyEditor({ onOwner }: { onOwner: (owner: PcbBoardLifecycleOwner) => void }) {
  const [owner] = useState(() => { const o = new PcbBoardLifecycleOwner(); o.adopt(IDENTITY); return o; });
  useEffect(() => { onOwner(owner); return () => owner.dispose(); }, [owner, onOwner]); // the pattern before the fix
  return null;
}

describe("B16-C.5 — lifecycle owners survive a StrictMode remount", () => {
  it("the pre-fix effect pattern leaves the owner disposed after StrictMode's simulated unmount (the defect)", () => {
    let owner: PcbBoardLifecycleOwner | null = null;
    render(<StrictMode><LegacyEditor onOwner={(o) => { owner = o; }} /></StrictMode>);
    expect(owner!.disposed).toBe(true);
    expect(owner!.capture().isCurrent()).toBe(false);
  });

  it("mount re-arms, so a scope captured after mount is current; a real unmount disposes for good", async () => {
    let owner: PcbBoardLifecycleOwner | null = null;
    const view = render(<StrictMode><Editor onOwner={(o) => { owner = o; }} /></StrictMode>);
    expect(owner!.disposed).toBe(false);
    const scope = owner!.capture();
    expect(scope.isCurrent()).toBe(true);
    expect(scope.signal.aborted).toBe(false);
    // the owned sync-preparation workflow reaches its server stages instead of ending "stale" at warm-up.
    const registry = new PcbOwnedOperationRegistry(owner!);
    const stages: string[] = [];
    const run = await runOwnedSyncPreparation(registry, {
      instances: [1],
      warmup: async () => { stages.push("warmup"); },
      bind: async () => { stages.push("bind"); return { ok: true }; },
      publish: async () => { stages.push("publish"); return { ok: true, value: {} }; },
      persistSnapshotRevision: () => { stages.push("persist"); },
      preflight: async () => { stages.push("preflight"); return { ok: true, value: {} }; },
      progress: () => undefined,
      fail: (message) => { stages.push(`fail:${message}`); },
      complete: () => { stages.push("complete"); },
      settleStale: (stage) => { stages.push(`stale:${stage}`); },
    });
    expect(run.status).toBe("completed");
    expect(stages).toEqual(["warmup", "bind", "publish", "persist", "preflight", "complete"]);
    view.unmount();
    expect(owner!.disposed).toBe(true);
    expect(scope.isCurrent()).toBe(false);
  });

  it("resume is a no-op on a live owner and never revives a retired generation", () => {
    const owner = new PcbBoardLifecycleOwner();
    owner.adopt(IDENTITY);
    const before = owner.capture();
    owner.resume();
    expect(before.isCurrent()).toBe(true);
    owner.adopt(IDENTITY); // replacement: the old scope is retired for good
    owner.dispose();
    owner.resume();
    expect(before.isCurrent()).toBe(false);
    expect(owner.capture().isCurrent()).toBe(true);
  });

  it("the project scope registry has the same contract", () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "p", branchId: "main", session: null });
    registry.dispose();
    expect(registry.capture().isCurrent()).toBe(false);
    registry.resume();
    expect(registry.capture().isCurrent()).toBe(true);
    registry.dispose();
    expect(registry.capture().isCurrent()).toBe(false);
  });
});
