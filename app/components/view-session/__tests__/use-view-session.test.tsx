// @vitest-environment jsdom
/**
 * [B17-D] The shared view-session owner under React StrictMode: the simulated
 * unmount retires the first bus and the owner replaces it before the editor is
 * live; descriptors read live dependencies through `deps()`; a real unmount
 * retires the session for good.
 *
 * [PR-L7 verify, 2026-10-20] The schematic view session's selection mirror converges and never loops (`useSchematicViewSession`; the
 * cases are here, not in a file of their own, so prompt-to-gerber's selection keeps the files its committed timing evidence measured):
 *
 * `useSchematicViewSession` mirrors the selection both ways: an effect applies the bus selection to the page, and another observes
 * the page's selection back (`schematic.observe`). Each observe applies against the bus state it was dispatched on, so an observe that
 * lands after the page has moved on writes a STALE echo. Applying that echo back to the page started a second observe the other way,
 * and the two chased each other without end: page-browser-e2e-b24's `multi-tab` case 1 stalled past its 300 s timeout on 2026-10-22
 * (page A's schematic tab, its bus flipping R1 / none in the trace's DOM snapshots, six "Maximum update depth exceeded" warnings - the
 * warning B24-D2B recorded with an UNKNOWN cause, `performance-and-reliability.md` section 18). Now only intents (select,
 * clear-selection, an agent's command) are applied to the page; an echo that differs from the page makes the hook observe the page
 * again, so the bus converges on the page.
 *
 *  1. an intent, then a page click a microtask later (the interleaving that looped: 3,179 renders in 300 ms before the fix): the page
 *     and the bus converge on one selection in a bounded number of renders, with no "Maximum update depth exceeded";
 *  2. the editor mounting over a page selection the fresh bus does not hold (the multi-tab trigger: back to the Schematic tab with R1
 *     still selected): the page keeps its selection - nothing is applied to it - and the bus adopts it (before the fix the mount
 *     cleared the page's selection, then applied the observe's echo back);
 *  3. a page click, then an intent, in one act: they converge on one selection;
 *  4. intents still reach the page: select and clear-selection move the page's selection, kicad family included.
 *
 * A harness component holds the page's two selection states exactly as `app/page.tsx` does and passes the same `applySelection`. No
 * network, no timers faked; nothing is written to disk.
 */
import { StrictMode, useEffect, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewSession, type ViewSessionHandle } from "../useViewSession";
import type { ViewCommandContext, ViewCommandDescriptor } from "@/app/lib/view-session/types";
import { useSchematicViewSession, type SchematicViewSession } from "@/app/components/schematic/hooks/useSchematicViewSession"; // [PR-L7 verify, 2026-10-20]

interface CounterState { count: number; label: string }
type Deps = { label: string };
const commands = (deps: () => Deps): ViewCommandDescriptor<CounterState, never>[] => [
  { commandId: "pcb.read-state", editor: "pcb", title: "read", staleness: "rebase", validate: () => ({ ok: true, value: null }), apply: (_p: null, { state }: ViewCommandContext<CounterState>) => ({ ok: true, state }) },
  { commandId: "pcb.bump", editor: "pcb", title: "bump", staleness: "rebase", validate: () => ({ ok: true, value: null }), apply: (_p: null, { state }: ViewCommandContext<CounterState>) => ({ ok: true, state: { count: state.count + 1, label: deps().label } }) },
] as unknown as ViewCommandDescriptor<CounterState, never>[];

function Probe({ label, onSession }: { label: string; onSession: (session: ViewSessionHandle<CounterState>) => void }) {
  const session = useViewSession<CounterState, Deps>({ editor: "pcb", projectId: "proj-1", branchId: "main", actorId: "u-1", initialState: { count: 0, label: "" }, deps: { label }, commands });
  onSession(session);
  return <div data-testid="state">{session.view.count}:{session.view.label}:{session.viewRevision}</div>;
}

describe("B17-D — useViewSession owner", () => {
  it("survives StrictMode, reads live deps, and retires on a real unmount", async () => {
    let latest: ViewSessionHandle<CounterState> | null = null;
    const view = render(<StrictMode><Probe label="one" onSession={(s) => { latest = s; }} /></StrictMode>);
    expect(screen.getByTestId("state").textContent).toBe("0::0");
    await act(async () => { await latest!.command("pcb.bump", null); });
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("1:one:1"));
    // Live dependencies: the descriptor reads the NEW label after a re-render.
    view.rerender(<StrictMode><Probe label="two" onSession={(s) => { latest = s; }} /></StrictMode>);
    await act(async () => { await latest!.command("pcb.bump", null); });
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("2:two:2"));
    expect(await latest!.command("pcb.nope", null)).toMatchObject({ ok: false, code: "VS_COMMAND_UNKNOWN" });
    view.unmount();
    expect(await latest!.command("pcb.read-state", null)).toMatchObject({ ok: false, code: "VS_SESSION_RETIRED" });
  });
});

// ── [PR-L7 verify, 2026-10-20] the schematic view session's selection mirror ──────────────────────────────────────────────────────────
const SOURCES = {
  components: [{ id: "c1", x: 10, y: 10, refDes: "R1" }, { id: "c2", x: 50, y: 50, refDes: "R2" }, { id: "c3", x: 90, y: 90, refDes: "R3" }],
  kicadComponents: [{ id: "k1", x: 130, y: 130, refDes: "U1" }],
  netLabels: [],
  pagePx: { width: 1000, height: 700 },
};
const harness = { renders: 0, applied: [] as Array<string | null>, pageSelect: null as ((id: string | null) => void) | null, session: null as SchematicViewSession | null };

function Page({ initial }: { initial: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const [selectedKicadId, setSelectedKicadId] = useState<string | null>(null);
  const session = useSchematicViewSession({
    projectId: "proj-l7v", branchId: "main", actorId: "local", sources: SOURCES, selectedId, selectedKicadId,
    applySelection: (id, family) => { harness.applied.push(id); if (family === "kicad") { setSelectedId(null); setSelectedKicadId(id); } else { setSelectedKicadId(null); setSelectedId(id); } }, // app/page.tsx's
    camera: { pan: { x: 0, y: 0 }, zoom: 1 }, viewportPx: () => ({ width: 800, height: 600 }), applyCamera: () => {}, fitToPage: () => {},
  });
  useEffect(() => { // the test reads the page through the harness after every commit (counted: a loop commits without end)
    harness.renders += 1;
    harness.session = session;
    harness.pageSelect = (id) => { setSelectedKicadId(null); setSelectedId(id); };
  });
  return <div data-testid="selection">{selectedId ?? selectedKicadId ?? "none"}|{session.view.selection.id ?? "none"}</div>;
}
/** Let the observes land and React settle: real event-loop turns (the loop, when present, never settles). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));
let errors: string[] = [];

const loops = (): string[] => errors.filter((text) => text.includes("Maximum update depth exceeded"));

describe("[PR-L7 verify] the schematic view session's selection mirror", () => {
  beforeEach(() => {
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    harness.renders = 0;
    harness.applied = [];
    harness.session = null;
    harness.pageSelect = null;
  });

  it("1. an intent, then a page click a microtask later: the page and the bus converge in a bounded number of renders, with no update loop", async () => {
    const view = render(<Page initial={null} />);
    await settle();
    const before = harness.renders;
    void harness.session!.select({ kind: "component", ref: "R2" });
    await Promise.resolve();
    harness.pageSelect!("c3");
    await settle();
    expect(loops()).toEqual([]);
    expect(harness.renders - before).toBeLessThan(10);
    const [page, bus] = view.getByTestId("selection").textContent!.split("|");
    expect(page).toBe(bus);
    expect(harness.applied).toEqual(["c2"]); // the intent, once; never an echo
  });

  it("2. the editor mounting over a page selection keeps it: nothing is applied to the page, and the bus adopts it", async () => {
    const view = render(<Page initial="c1" />);
    await settle();
    expect(harness.applied).toEqual([]);
    expect(view.getByTestId("selection").textContent).toBe("c1|c1");
    expect(harness.session!.view.selection).toMatchObject({ id: "c1", family: "theory", refdes: "R1" });
    expect(loops()).toEqual([]);
  });

  it("3. a page click, then an intent, in one act: they converge on one selection", async () => {
    const view = render(<Page initial={null} />);
    await settle();
    await act(async () => {
      harness.pageSelect!("c3");
      void harness.session!.select({ kind: "component", ref: "R2" });
    });
    await settle();
    const [page, bus] = view.getByTestId("selection").textContent!.split("|");
    expect(page).toBe(bus);
    expect(loops()).toEqual([]);
  });

  it("4. intents still reach the page: select (a theory part, then a kicad part) and clear-selection move the page's selection", async () => {
    const view = render(<Page initial="c1" />);
    await settle();
    await act(async () => { await harness.session!.select({ kind: "component", ref: "R3" }); });
    await settle();
    expect(view.getByTestId("selection").textContent).toBe("c3|c3");
    await act(async () => { await harness.session!.select({ kind: "component", ref: "U1" }); });
    await settle();
    expect(view.getByTestId("selection").textContent).toBe("k1|k1");
    await act(async () => { harness.session!.clearSelection(); });
    await settle();
    expect(view.getByTestId("selection").textContent).toBe("none|none");
    expect(harness.applied).toEqual(["c3", "k1", null]);
    expect(loops()).toEqual([]);
  });
});
