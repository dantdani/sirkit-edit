// @vitest-environment jsdom
/**
 * [B17-C] The editor's pcb3d view session under React StrictMode: the
 * simulated unmount at mount retires the first bus; the hook must replace it
 * with a live session so the toolbar's first click opens the 3D view (the
 * browser proof found the toggle refused VS_SESSION_RETIRED). A real unmount
 * retires the bus for good, and every entry point issues bus commands.
 */
import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePcb3dViewSession, type Pcb3dViewSession } from "../hooks/usePcb3dViewSession";
import { createEmptyBoard } from "@/app/lib/pcb/types";

function Probe({ onSession }: { onSession: (session: Pcb3dViewSession) => void }) {
  const session = usePcb3dViewSession({ projectId: "proj-1", branchId: "main", board: createEmptyBoard(), actorId: "u-1", demo: true });
  onSession(session);
  return <div data-testid="open">{String(session.view.open)}</div>;
}

describe("B17-C — pcb3d view session hook", () => {
  it("survives StrictMode's simulated unmount: the first toggle opens the view; a real unmount retires the session", async () => {
    let latest: Pcb3dViewSession | null = null;
    const view = render(<StrictMode><Probe onSession={(session) => { latest = session; }} /></StrictMode>);
    expect(screen.getByTestId("open").textContent).toBe("false");
    await act(async () => { latest!.toggle(); });
    await waitFor(() => expect(screen.getByTestId("open").textContent).toBe("true"));
    const result = await latest!.command("pcb3d.read-state", null);
    expect(result).toEqual({ ok: true });
    await act(async () => { latest!.setOpen(false); });
    await waitFor(() => expect(screen.getByTestId("open").textContent).toBe("false"));
    view.unmount();
    expect(await latest!.command("pcb3d.open", null)).toMatchObject({ ok: false, code: "VS_SESSION_RETIRED" });
  });

  it("refuses an unknown component with a bounded unavailable message and keeps the view unchanged", async () => {
    let latest: Pcb3dViewSession | null = null;
    render(<StrictMode><Probe onSession={(session) => { latest = session; }} /></StrictMode>);
    await act(async () => { latest!.setOpen(true); });
    await waitFor(() => expect(screen.getByTestId("open").textContent).toBe("true"));
    const refused = await latest!.command("pcb3d.focus-component", { ref: "U9" });
    expect(refused).toMatchObject({ ok: false, code: "VS_UNAVAILABLE" });
    expect(latest!.view.focus).toBeNull();
  });
});
