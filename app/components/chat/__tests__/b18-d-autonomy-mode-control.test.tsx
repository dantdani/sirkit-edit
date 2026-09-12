// @vitest-environment jsdom
/**
 * [B18-D I11] The chat's agent-autonomy control: every member sees the mode and what it means; only an administrator
 * (the server's `viewer.canChange`) can change it; the change sends exactly `{ mode, expectedRevision }` with the
 * project selector headers; a 409 is re-read and said so; a refusal is shown verbatim; an unavailable store says the
 * project behaves as proposal only; with no project open it renders nothing.
 * [B18-D review 2] Results are announced in a status region, focus returns to the select, and the note (with the lock
 * reason) describes the select; a lost, unreadable or unconfirmed response never claims "nothing was changed" — the
 * setting is read again and shown; a setting it cannot read is "not known here", never a mode.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTONOMY_UNREADABLE, AutonomyModeControl } from "../AutonomyModeControl";

const SCOPE = { tenantId: "local", projectId: "p1", branchId: "main" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const setting = (mode: string, revision: number, canChange: boolean) => json(200, { ok: true, setting: { mode, revision }, changes: [], viewer: { role: canChange ? "project_admin" : "editor", canChange } });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("B18-D I11 — the agent autonomy control", () => {
  it("a member who may not change it sees the mode, what it means, and why it is locked", async () => {
    const fetchMock = vi.fn(async () => setting("proposal_only", 0, false));
    vi.stubGlobal("fetch", fetchMock);
    render(<AutonomyModeControl scope={SCOPE} />);
    const select = (await screen.findByTestId("autonomy-mode")) as HTMLSelectElement;
    expect(select.value).toBe("proposal_only");
    expect(select.disabled).toBe(true);
    expect(screen.getByTestId("autonomy-note").textContent).toBe("Every AI change waits for your confirmation. Only a project administrator can change this.");
    expect(screen.queryByTestId("autonomy-change")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/autonomy", expect.objectContaining({ headers: { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "p1", "x-sirkit-branch-id": "main" } }));
  });

  it("an administrator changes it with exactly { mode, expectedRevision }; the new mode is shown", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST" ? json(200, { ok: true, setting: { mode: "execute_explicit_tier1", revision: 4 }, unchanged: false }) : setting("proposal_only", 3, true)));
    vi.stubGlobal("fetch", fetchMock);
    render(<AutonomyModeControl scope={SCOPE} />);
    fireEvent.change(await screen.findByTestId("autonomy-mode"), { target: { value: "execute_explicit_tier1" } });
    fireEvent.click(screen.getByTestId("autonomy-change"));
    await waitFor(() => expect(screen.getByTestId("autonomy-control").getAttribute("data-mode")).toBe("execute_explicit_tier1"));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ mode: "execute_explicit_tier1", expectedRevision: 3 });
    expect(post[1]!.headers).toMatchObject({ "Content-Type": "application/json", "x-sirkit-project-id": "p1" });
    expect(screen.getByTestId("autonomy-notice").textContent).toBe("Changed to Explicit Tier 1 (revision 4).");
    expect(screen.getByTestId("autonomy-note").textContent).toBe("An exact request for a reversible Tier 1 edit runs without the card; everything else still asks.");
  });

  it("a stale revision (409) is read again and said so; nothing is claimed", async () => {
    let reads = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json(409, { ok: false, code: "AGENT_AUTONOMY_STALE_REVISION", error: "stale", current: { mode: "execute_explicit_tier1", revision: 5 } });
      reads += 1;
      return reads === 1 ? setting("proposal_only", 3, true) : setting("execute_explicit_tier1", 5, true);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AutonomyModeControl scope={SCOPE} />);
    fireEvent.change(await screen.findByTestId("autonomy-mode"), { target: { value: "execute_explicit_tier1" } });
    fireEvent.click(screen.getByTestId("autonomy-change"));
    await waitFor(() => expect(screen.getByTestId("autonomy-notice").textContent).toBe("The setting changed since you read it. It has been read again; nothing was changed."));
    expect(reads).toBe(2);
    expect(screen.getByTestId("autonomy-control").getAttribute("data-mode")).toBe("execute_explicit_tier1");
  });

  it("a refusal is shown verbatim; an unavailable store says the project behaves as proposal only; no project renders nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST" ? json(403, { ok: false, code: "AGENT_AUTONOMY_FORBIDDEN", error: "Role editor may not change the agent autonomy setting; a project administrator must." }) : setting("proposal_only", 0, true))));
    const { unmount } = render(<AutonomyModeControl scope={SCOPE} />);
    fireEvent.change(await screen.findByTestId("autonomy-mode"), { target: { value: "execute_explicit_tier1" } });
    fireEvent.click(screen.getByTestId("autonomy-change"));
    await waitFor(() => expect(screen.getByTestId("autonomy-notice").textContent).toBe("Role editor may not change the agent autonomy setting; a project administrator must."));
    expect(screen.getByTestId("autonomy-control").getAttribute("data-mode")).toBe("proposal_only");
    unmount();

    vi.stubGlobal("fetch", vi.fn(async () => json(503, { ok: false, code: "AGENT_AUTONOMY_UNAVAILABLE", error: "The agent autonomy store is unavailable; the project behaves as proposal_only until it is reachable." })));
    const second = render(<AutonomyModeControl scope={SCOPE} />);
    expect((await screen.findByTestId("autonomy-unavailable")).textContent).toBe("The agent autonomy store is unavailable; the project behaves as proposal_only until it is reachable.");
    expect(screen.queryByTestId("autonomy-mode")).toBeNull();
    second.unmount();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AutonomyModeControl scope={null} />);
    expect(container.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[B18-D review 2] a result is announced in a status region, focus returns to the select, and the note describes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST" ? json(200, { ok: true, setting: { mode: "execute_explicit_tier1", revision: 4 }, unchanged: false }) : setting("proposal_only", 3, true))));
    render(<AutonomyModeControl scope={SCOPE} />);
    const select = (await screen.findByTestId("autonomy-mode")) as HTMLSelectElement;
    expect(select.getAttribute("aria-describedby")).toBe(screen.getByTestId("autonomy-note").id);
    expect(screen.getByRole("status").textContent).toBe(""); // present before any result, so the result is announced
    fireEvent.change(select, { target: { value: "execute_explicit_tier1" } });
    fireEvent.click(screen.getByTestId("autonomy-change"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Changed to Explicit Tier 1 (revision 4)."));
    await waitFor(() => expect(document.activeElement).toBe(select));
  });

  it("[B18-D review 2] a member who may not change it hears why: the lock reason describes the select", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => setting("execute_explicit_tier1", 2, false)));
    render(<AutonomyModeControl scope={SCOPE} />);
    const select = await screen.findByTestId("autonomy-mode");
    expect(document.getElementById(select.getAttribute("aria-describedby")!)?.textContent).toContain("Only a project administrator can change this.");
  });

  it("[B18-D review 2] a lost, unreadable or unconfirmed response never claims 'nothing was changed': the setting is read again and shown", async () => {
    const posts: Array<() => Promise<Response>> = [
      async () => new Response("<html>gateway timeout</html>", { status: 504 }),
      async () => { throw new TypeError("network error"); },
      async () => new Response("not json", { status: 200 }),
      async () => json(504, { ok: false, code: "ROUTE_DEADLINE_EXCEEDED", error: "The request exceeded its deadline." }),
    ];
    for (const post of posts) {
      let reads = 0;
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") return post();
        reads += 1;
        return reads === 1 ? setting("proposal_only", 3, true) : setting("execute_explicit_tier1", 4, true);
      }));
      const view = render(<AutonomyModeControl scope={SCOPE} />);
      fireEvent.change(await screen.findByTestId("autonomy-mode"), { target: { value: "execute_explicit_tier1" } });
      fireEvent.click(screen.getByTestId("autonomy-change"));
      await waitFor(() => expect(screen.getByTestId("autonomy-notice").textContent).toMatch(/^The response did not confirm the change \(.+\); the setting was read again and is shown here\.$/));
      expect(screen.getByTestId("autonomy-notice").textContent).not.toMatch(/nothing was changed/);
      expect(reads).toBe(2);
      expect(screen.getByTestId("autonomy-control").getAttribute("data-mode")).toBe("execute_explicit_tier1"); // what the server now says
      view.unmount();
    }
  });

  it("[B18-D review 2] a setting it cannot read is 'not known here', never a mode", async () => {
    expect(AUTONOMY_UNREADABLE).not.toMatch(/proposal only|proposal_only/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network error"); }));
    const first = render(<AutonomyModeControl scope={SCOPE} />);
    expect((await screen.findByTestId("autonomy-unavailable")).textContent).toBe(AUTONOMY_UNREADABLE);
    first.unmount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    render(<AutonomyModeControl scope={SCOPE} />);
    expect((await screen.findByTestId("autonomy-unavailable")).textContent).toBe(AUTONOMY_UNREADABLE);
  });
});
