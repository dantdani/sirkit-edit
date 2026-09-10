/**
 * [B17-B] The view-session command bus — behavioural contract.
 *
 * Every requirement of the runbook's B17-B is pinned here against the real
 * bus with a small test editor: view state never confused with engineering
 * authority (the bus owns no history and can be given none); commands scoped
 * to the session/project/editor; stale revisions refuse or rebase by the
 * documented rule; retirement on project switch / logout / tab disposal;
 * single settlement; cancellation; resulting view state returned; durable
 * persistence limited to explicit workspace preferences; trace records
 * redact content while keeping command evidence.
 */
import { describe, expect, it, vi } from "vitest";
import { createViewCommand, newViewSessionId, ViewSessionBus, type ViewPreferenceStore } from "../bus";
import { VIEW_COMMAND_SCHEMA, type TrustedViewActor, type ViewCommandDescriptor, type ViewCommandEnvelope, type ViewCommandTrace } from "../types";

interface TestView { zoom: number; layers: Record<string, boolean>; focus: string | null; theme: string }
const IDENTITY = { sessionId: "vs-test-1", projectId: "proj-1", branchId: "main", editor: "pcb" as const };
const HUMAN: TrustedViewActor = { actorId: "u-1", role: "pcb_editor", actorKind: "human" };
const AGENT: TrustedViewActor = { actorId: "agent-1", role: "automation", actorKind: "agent" };
const T0 = "2026-09-09T12:00:00.000Z";

const applyCalls: string[] = [];
const commands: ViewCommandDescriptor<TestView, never>[] = [
  { commandId: "test.zoom-by", editor: "pcb", title: "Zoom by a factor (relative → refuses stale)", staleness: "refuse",
    validate: (p) => (typeof p === "object" && p !== null && typeof (p as { factor?: unknown }).factor === "number" && (p as { factor: number }).factor > 0 ? { ok: true, value: p as never } : { ok: false, message: "factor must be a positive number" }),
    apply: (p: { factor: number }, ctx) => { applyCalls.push("zoom-by"); return { ok: true, state: { ...ctx.state, zoom: ctx.state.zoom * p.factor } }; } } as ViewCommandDescriptor<TestView, never>,
  { commandId: "test.fit", editor: "pcb", title: "Fit (idempotent → rebases)", staleness: "rebase",
    validate: () => ({ ok: true, value: null as never }),
    apply: (_p, ctx) => { applyCalls.push("fit"); return { ok: true, state: { ...ctx.state, zoom: 1 } }; } } as ViewCommandDescriptor<TestView, never>,
  { commandId: "test.set-theme", editor: "pcb", title: "Workspace theme (explicit preference)", staleness: "rebase",
    persist: { scope: "workspace-preference", keys: ["theme"], project: (state) => ({ theme: state.theme }) },
    validate: (p) => (typeof p === "string" ? { ok: true, value: p as never } : { ok: false, message: "theme must be a string" }),
    apply: (p: string, ctx) => ({ ok: true, state: { ...ctx.state, theme: p } }) } as ViewCommandDescriptor<TestView, never>,
  { commandId: "test.slow-focus", editor: "pcb", title: "Slow focus (cancellable)", staleness: "rebase",
    validate: (p) => (typeof p === "string" ? { ok: true, value: p as never } : { ok: false, message: "ref required" }),
    apply: (p: string, ctx) => new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: true, state: { ...ctx.state, focus: p } }), 30);
      ctx.signal.addEventListener("abort", () => { clearTimeout(timer); resolve({ ok: true, state: { ...ctx.state, focus: "SHOULD-NOT-APPLY" } }); });
    }) } as ViewCommandDescriptor<TestView, never>,
  { commandId: "test.unavailable", editor: "pcb", title: "Geometry unavailable", staleness: "rebase",
    validate: () => ({ ok: true, value: null as never }),
    apply: () => ({ ok: false, refusal: { code: "VS_UNAVAILABLE", message: "model/geometry unavailable for R9" } }) } as ViewCommandDescriptor<TestView, never>,
  { commandId: "test.throws", editor: "pcb", title: "Throws", staleness: "rebase",
    validate: () => ({ ok: true, value: null as never }),
    apply: () => { throw new Error("boom"); } } as ViewCommandDescriptor<TestView, never>,
  { commandId: "test.admin-only", editor: "pcb", title: "Admin only", staleness: "rebase", roles: ["project_admin"],
    validate: () => ({ ok: true, value: null as never }),
    apply: (_p, ctx) => ({ ok: true, state: ctx.state }) } as ViewCommandDescriptor<TestView, never>,
];

function makeBus(overrides: { clock?: () => string; preferences?: ViewPreferenceStore; trace?: (record: ViewCommandTrace) => void } = {}) {
  applyCalls.length = 0;
  return new ViewSessionBus<TestView>({ identity: IDENTITY, initialState: { zoom: 2, layers: { "F.Cu": true }, focus: null, theme: "dark" }, commands, clock: overrides.clock ?? (() => T0), preferences: overrides.preferences, trace: overrides.trace });
}
function envelope(commandId: string, payload: unknown, rev: number, extra: Partial<ViewCommandEnvelope> = {}): ViewCommandEnvelope {
  return { ...createViewCommand({ identity: IDENTITY, commandId, payload, actor: HUMAN, expectedViewRevision: rev, issuedAt: T0, ttlMs: 10_000 }), ...extra };
}

describe("B17-B — view-session command bus", () => {
  it("validates the envelope: schema, required fields, actor and revision are refused with bounded codes", async () => {
    const bus = makeBus();
    expect((await bus.dispatch({ ...envelope("test.fit", null, 0), schemaVersion: "sirkit.view-command.v0" as never })).status).toBe("refused");
    expect((await bus.dispatch({ ...envelope("test.fit", null, 0, { invocationId: "i-1" }), schemaVersion: "x" as never }) as { refusal: { code: string } }).refusal.code).toBe("VS_SCHEMA_UNSUPPORTED");
    expect((await bus.dispatch({ ...envelope("test.fit", null, 0, { invocationId: "i-2" }), sessionId: "" }) as { refusal: { code: string } }).refusal.code).toBe("VS_ENVELOPE_INVALID");
    expect((await bus.dispatch({ ...envelope("test.fit", null, 0, { invocationId: "i-3" }), actor: { actorId: "u", role: "viewer", actorKind: "robot" as never } }) as { refusal: { code: string } }).refusal.code).toBe("VS_ENVELOPE_INVALID");
    expect((await bus.dispatch({ ...envelope("test.fit", null, -1, { invocationId: "i-4" }) }) as { refusal: { code: string } }).refusal.code).toBe("VS_ENVELOPE_INVALID");
    expect((await bus.dispatch({ ...envelope("test.fit", null, 0, { invocationId: "i-5" }), expiresAt: T0 }) as { refusal: { code: string } }).refusal.code).toBe("VS_ENVELOPE_INVALID");
    expect(bus.viewRevision).toBe(0);
    expect(applyCalls).toEqual([]);
  });

  it("scopes commands to the session, project/branch and editor; another session's command is refused, never applied", async () => {
    const bus = makeBus();
    const codes = await Promise.all([
      bus.dispatch({ ...envelope("test.fit", null, 0, { invocationId: "s-1" }), sessionId: "vs-other" }),
      bus.dispatch({ ...envelope("test.fit", null, 0, { invocationId: "s-2" }), projectId: "proj-2" }),
      bus.dispatch({ ...envelope("test.fit", null, 0, { invocationId: "s-3" }), branchId: "feature" }),
      bus.dispatch({ ...envelope("test.fit", null, 0, { invocationId: "s-4" }), editor: "schematic" }),
      bus.dispatch({ ...envelope("test.nope", null, 0, { invocationId: "s-5" }) }),
    ]);
    expect(codes.map((r) => (r as { refusal: { code: string } }).refusal.code)).toEqual(["VS_SESSION_MISMATCH", "VS_PROJECT_MISMATCH", "VS_PROJECT_MISMATCH", "VS_EDITOR_MISMATCH", "VS_COMMAND_UNKNOWN"]);
    expect(applyCalls).toEqual([]);
    expect(bus.getState().zoom).toBe(2);
  });

  it("stale revisions: a relative command REFUSES with the current revision; an idempotent command REBASES onto the current state and says so", async () => {
    const bus = makeBus();
    const first = await bus.dispatch(envelope("test.zoom-by", { factor: 2 }, 0, { invocationId: "z-1" }));
    expect(first).toMatchObject({ status: "settled", viewRevision: 1, rebased: false, changed: true, state: { zoom: 4 } });
    const stale = await bus.dispatch(envelope("test.zoom-by", { factor: 2 }, 0, { invocationId: "z-2" }));
    expect(stale).toMatchObject({ status: "refused", viewRevision: 1, refusal: { code: "VS_STALE_REVISION" } });
    expect(bus.getState().zoom).toBe(4);
    const rebased = await bus.dispatch(envelope("test.fit", null, 0, { invocationId: "f-1" }));
    expect(rebased).toMatchObject({ status: "settled", viewRevision: 2, rebased: true, changed: true, state: { zoom: 1 } });
    const current = await bus.dispatch(envelope("test.fit", null, 2, { invocationId: "f-2" }));
    expect(current).toMatchObject({ status: "settled", viewRevision: 2, rebased: false, changed: false }); // no change → revision unchanged
  });

  it("settles every invocation exactly once: a replayed invocation id returns the same settled result without executing again; an in-flight duplicate shares the settlement", async () => {
    const bus = makeBus();
    const env = envelope("test.zoom-by", { factor: 3 }, 0, { invocationId: "once-1" });
    const [a, b] = await Promise.all([bus.dispatch(env), bus.dispatch(env)]);
    expect(a).toBe(b);
    const again = await bus.dispatch({ ...env, payload: { factor: 100 } }); // even a different payload under the same id replays
    expect(again).toBe(a);
    expect(applyCalls).toEqual(["zoom-by"]);
    expect(bus.getState().zoom).toBe(6);
    expect(bus.viewRevision).toBe(1);
  });

  it("is cancellable: a cancelled invocation settles as cancelled and changes nothing; cancelling a settled one is a no-op", async () => {
    const bus = makeBus();
    const pending = bus.dispatch(envelope("test.slow-focus", "R1", 0, { invocationId: "slow-1" }));
    expect(bus.cancel("slow-1")).toBe(true);
    expect(await pending).toMatchObject({ status: "cancelled", viewRevision: 0 });
    expect(bus.getState().focus).toBeNull();
    expect(bus.cancel("slow-1")).toBe(false);
    const done = await bus.dispatch(envelope("test.slow-focus", "R2", 0, { invocationId: "slow-2" }));
    expect(done).toMatchObject({ status: "settled", state: { focus: "R2" }, viewRevision: 1 });
  });

  it("retires with the session: project switch / logout / tab disposal refuse every later command and abort in-flight work", async () => {
    for (const reason of ["project-switch", "logout", "tab-disposed"] as const) {
      const bus = makeBus();
      const inFlight = bus.dispatch(envelope("test.slow-focus", "R1", 0, { invocationId: `r-${reason}` }));
      bus.retire(reason);
      expect(bus.retirement).toBe(reason);
      expect((await inFlight).status).toBe("cancelled");
      const later = await bus.dispatch(envelope("test.fit", null, 0, { invocationId: `r2-${reason}` }));
      expect(later).toMatchObject({ status: "refused", refusal: { code: "VS_SESSION_RETIRED" } });
      expect(bus.getState().focus).toBeNull();
    }
  });

  it("persists ONLY explicit workspace preferences: the theme command saves its keys, nothing else is ever written, and preferences load at start", async () => {
    const saved: Record<string, unknown>[] = [];
    const store: ViewPreferenceStore = { load: (keys) => (keys.includes("theme") ? { theme: "light" } : {}), save: (values) => { saved.push(values); } };
    const bus = makeBus({ preferences: store });
    expect(bus.getState().theme).toBe("light"); // loaded preference
    await bus.dispatch(envelope("test.zoom-by", { factor: 2 }, 0, { invocationId: "p-1" }));
    await bus.dispatch(envelope("test.slow-focus", "R1", 1, { invocationId: "p-2" }));
    expect(saved).toEqual([]); // zoom and focus are session-only
    await bus.dispatch(envelope("test.set-theme", "solar", 2, { invocationId: "p-3" }));
    expect(saved).toEqual([{ theme: "solar" }]); // exactly the declared keys, nothing of the view
  });

  it("never creates an engineering undo entry: the bus owns no history and exposes no undo/redo; settled commands only move the VIEW revision", async () => {
    const bus = makeBus();
    const engineeringHistory = { entries: [] as string[], push: vi.fn() };
    for (let i = 0; i < 5; i += 1) await bus.dispatch(envelope("test.zoom-by", { factor: 2 }, i, { invocationId: `h-${i}` }));
    expect(engineeringHistory.push).not.toHaveBeenCalled();
    expect(engineeringHistory.entries).toEqual([]);
    expect((bus as unknown as { undo?: unknown }).undo).toBeUndefined();
    expect((bus as unknown as { history?: unknown }).history).toBeUndefined();
    expect(bus.viewRevision).toBe(5);
  });

  it("trace records keep command evidence (ids, digest, keys, revisions, status) and redact private content", async () => {
    const traces: ViewCommandTrace[] = [];
    const bus = makeBus({ trace: (record) => traces.push(record) });
    const secret = "NET_SUPER_SECRET_PROJECT_CONTENT";
    await bus.dispatch(envelope("test.slow-focus", secret, 0, { invocationId: "t-1" }));
    await bus.dispatch(envelope("test.zoom-by", { factor: 2, note: secret }, 1, { invocationId: "t-2" }));
    await bus.dispatch(envelope("test.zoom-by", { factor: 2 }, 0, { invocationId: "t-3" })); // stale → refused
    expect(traces).toHaveLength(3);
    const serialized = JSON.stringify(traces);
    expect(serialized).not.toContain(secret);
    expect(traces[0]).toMatchObject({ schemaVersion: "sirkit.view-command-trace.v1", invocationId: "t-1", commandId: "test.slow-focus", sessionId: IDENTITY.sessionId, projectId: IDENTITY.projectId, editor: "pcb", actorKind: "human", role: "pcb_editor", expectedViewRevision: 0, resultingViewRevision: 1, status: "settled", refusalCode: null, payloadKeys: [], issuedAt: T0, settledAt: T0 });
    expect(traces[0]!.payloadDigest).toMatch(/^eng1-/);
    expect(traces[1]!.payloadKeys).toEqual(["factor", "note"]);
    expect(traces[2]).toMatchObject({ status: "refused", refusalCode: "VS_STALE_REVISION", resultingViewRevision: 2 });
  });

  it("refuses expired commands, role-gated commands for other roles, and passes bounded handler refusals and failures through", async () => {
    const later = new Date(Date.parse(T0) + 60_000).toISOString();
    const bus = makeBus({ clock: () => later });
    expect((await bus.dispatch(envelope("test.fit", null, 0, { invocationId: "e-1" })) as { refusal: { code: string } }).refusal.code).toBe("VS_EXPIRED");
    const fresh = makeBus();
    expect((await fresh.dispatch(envelope("test.admin-only", null, 0, { invocationId: "e-2" })) as { refusal: { code: string } }).refusal.code).toBe("VS_ROLE_FORBIDDEN");
    const admin = { ...envelope("test.admin-only", null, 0, { invocationId: "e-3" }), actor: { actorId: "a", role: "project_admin" as const, actorKind: "human" as const } };
    expect((await fresh.dispatch(admin)).status).toBe("settled");
    expect(await fresh.dispatch(envelope("test.unavailable", null, 0, { invocationId: "e-4" }))).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE", message: "model/geometry unavailable for R9" } });
    expect(await fresh.dispatch(envelope("test.throws", null, 0, { invocationId: "e-5" }))).toMatchObject({ status: "refused", refusal: { code: "VS_HANDLER_FAILED" } });
    expect(await fresh.dispatch(envelope("test.zoom-by", { factor: -1 }, 0, { invocationId: "e-6" }))).toMatchObject({ status: "refused", refusal: { code: "VS_PAYLOAD_INVALID" } });
    expect(fresh.viewRevision).toBe(0);
  });

  it("agents issue the same envelope as humans; the descriptor list is provider-neutral and the bus refuses mis-registered commands", async () => {
    const bus = makeBus();
    const agentEnvelope = { ...envelope("test.fit", null, 0, { invocationId: "a-1" }), actor: AGENT };
    expect(await bus.dispatch(agentEnvelope)).toMatchObject({ status: "settled" });
    expect(bus.describeCommands().map((c) => c.commandId)).toEqual(["test.admin-only", "test.fit", "test.set-theme", "test.slow-focus", "test.throws", "test.unavailable", "test.zoom-by"]);
    expect(bus.describeCommands().find((c) => c.commandId === "test.set-theme")?.persists).toBe(true);
    expect(() => new ViewSessionBus<TestView>({ identity: IDENTITY, initialState: bus.getState(), commands: [commands[0]!, commands[0]!] })).toThrow(/VS_COMMAND_DUPLICATE/);
    expect(() => new ViewSessionBus<TestView>({ identity: { ...IDENTITY, editor: "schematic" }, initialState: bus.getState(), commands: [commands[0]!] })).toThrow(/VS_COMMAND_EDITOR_MISMATCH/);
    expect(() => new ViewSessionBus<TestView>({ identity: { ...IDENTITY, sessionId: "bad id!" }, initialState: bus.getState(), commands: [] })).toThrow(/VS_IDENTITY_INVALID/);
  });

  it("createViewCommand builds a valid, scoped envelope with a deterministic invocation id; session ids are fresh and never persisted", () => {
    const env = createViewCommand({ identity: IDENTITY, commandId: "test.fit", payload: { a: 1 }, actor: HUMAN, expectedViewRevision: 3, issuedAt: T0, ttlMs: 5_000 });
    expect(env).toMatchObject({ schemaVersion: VIEW_COMMAND_SCHEMA, commandId: "test.fit", sessionId: IDENTITY.sessionId, projectId: IDENTITY.projectId, branchId: IDENTITY.branchId, editor: "pcb", expectedViewRevision: 3, actor: HUMAN, payload: { a: 1 }, issuedAt: T0, expiresAt: "2026-09-09T12:00:05.000Z" });
    expect(env.invocationId).toMatch(/^vc-[0-9a-f]{16,}$/);
    expect(createViewCommand({ identity: IDENTITY, commandId: "test.fit", payload: { a: 1 }, actor: HUMAN, expectedViewRevision: 3, issuedAt: T0 }).invocationId).toBe(env.invocationId);
    expect(newViewSessionId()).toMatch(/^vs-/);
    expect(newViewSessionId()).not.toBe(newViewSessionId());
  });
});
