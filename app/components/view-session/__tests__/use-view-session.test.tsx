// @vitest-environment jsdom
/**
 * [B17-D] The shared view-session owner under React StrictMode: the simulated
 * unmount retires the first bus and the owner replaces it before the editor is
 * live; descriptors read live dependencies through `deps()`; a real unmount
 * retires the session for good.
 */
import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useViewSession, type ViewSessionHandle } from "../useViewSession";
import type { ViewCommandContext, ViewCommandDescriptor } from "@/app/lib/view-session/types";

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
