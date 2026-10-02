/**
 * B16.0.24 §A — PERMANENT route-level parity suite for the FINAL raw-handler
 * tranche: auth callback (GET), sign-in (POST), sign-out (POST), agent chat
 * (POST), and legacy /api/simulate (POST). Written and run GREEN against the
 * raw handlers FIRST, then kept green unchanged after migration except the
 * pins explicitly marked [SUPERSEDED B16.0.24] (documented corrections in
 * artifacts/ai-control-plane-b16-0-24/).
 *
 * ZERO Supabase calls (every tested auth path returns before the SSR client),
 * ZERO provider credits (fake adapter), and ZERO real processes (scripted fake
 * child; no ngspice ever spawns).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- fake ngspice child (simulate) : no real process ever spawns ----
const spawnState = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; args: readonly string[]; opts: Record<string, unknown> }>,
  script: { code: 0 as number | null, stdout: "", stderr: "", emitError: null as null | { code?: string } },
  rawFile: null as string | null,
}));
vi.mock("node:child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
      spawnState.calls.push({ cmd, args, opts });
      const child = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        if (spawnState.script.emitError) { child.emit("error", Object.assign(new Error("spawn"), spawnState.script.emitError)); return; }
        if (spawnState.script.stdout) child.stdout.emit("data", Buffer.from(spawnState.script.stdout));
        if (spawnState.script.stderr) child.stderr.emit("data", Buffer.from(spawnState.script.stderr));
        child.emit("close", spawnState.script.code);
      });
      return child;
    },
  };
});
// child_process (bare) — the raw simulate route imports "child_process".
vi.mock("child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
      spawnState.calls.push({ cmd, args, opts });
      const child = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        if (spawnState.script.emitError) { child.emit("error", Object.assign(new Error("spawn"), spawnState.script.emitError)); return; }
        if (spawnState.script.stdout) child.stdout.emit("data", Buffer.from(spawnState.script.stdout));
        if (spawnState.script.stderr) child.stderr.emit("data", Buffer.from(spawnState.script.stderr));
        child.emit("close", spawnState.script.code);
      });
      return child;
    },
  };
});
// fake fs for simulate raw-file read (both specifiers). [B16.0.24.1] the
// route now reads the raw artifact through a bounded file HANDLE (`open`),
// so the seam serves `fsState.raw` as a fake handle: stat() reports the byte
// size, read() serves the bytes chunk by chunk, close() records itself.
const fsState = vi.hoisted(() => ({ writes: [] as string[], raw: null as string | null, unlinks: [] as string[], closes: 0 }));
function fakeHandle() {
  const bytes = fsState.raw === null ? null : Buffer.from(fsState.raw, "utf8");
  let offset = 0;
  return {
    stat: async () => ({ size: bytes?.length ?? 0 }),
    read: async (buffer: Buffer, bufferOffset: number, length: number) => {
      if (bytes === null) return { bytesRead: 0, buffer };
      const slice = bytes.subarray(offset, Math.min(offset + length, bytes.length));
      slice.copy(buffer, bufferOffset);
      offset += slice.length;
      return { bytesRead: slice.length, buffer };
    },
    close: async () => { fsState.closes += 1; },
  };
}
function fsImpl(actual: Record<string, unknown>) {
  return {
    ...actual,
    writeFile: async (p: string) => { fsState.writes.push(String(p)); },
    open: async () => { if (fsState.raw === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return fakeHandle(); },
    readFile: async () => { if (fsState.raw === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return fsState.raw; },
    unlink: async (p: string) => { fsState.unlinks.push(String(p)); },
    mkdtemp: async (p: string) => `${p}fake`,
    rm: async () => {},
    // [B22-D] reviewed harness move: the diagnostic runner lstats the raw file before its bounded read (a link, a hardlink or a
    // device is refused unread; b22-d-adversarial case 3), so the raw artifact this seam serves is a plain file; any other path is real
    lstat: async (p: string, ...rest: unknown[]) => {
      if (/[\\/]result\.raw$/.test(String(p))) {
        if (fsState.raw === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, nlink: 1, size: Buffer.byteLength(fsState.raw, "utf8") };
      }
      return (actual.lstat as (...values: unknown[]) => Promise<unknown>)(p, ...rest);
    },
  };
}
vi.mock("node:fs/promises", async (orig) => fsImpl(await orig() as Record<string, unknown>));
vi.mock("fs/promises", async (orig) => fsImpl(await orig() as Record<string, unknown>));

// ---- fake agent adapter (chat) : zero provider credits ----
const adapterState = vi.hoisted(() => ({ started: 0 }));
vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start() { adapterState.started += 1; return { text: "ok", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } }; },
    async continueWith() { throw new Error("not used"); },
  }),
}));

import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { policyFor } from "@/app/lib/auth/route-policy";
import { safeRedirectPath } from "@/app/lib/auth/request-security";
import { GET as callbackGet } from "../auth/callback/route";
import { POST as signinPost } from "../auth/signin/route";
import { POST as signoutPost } from "../auth/signout/route";
import { POST as chatPost, MAX_CHAT_REQUEST_BYTES } from "../chat/route";
import { POST as simulatePost } from "../simulate/route";
import { pinFakeNgspiceForSuite } from "@/app/lib/computation/__tests__/_pinned-ngspice";

// [B22-A3] reviewed pin move: /api/simulate runs ngspice through the diagnostic runner, which refuses an unpinned install (OD-135)
pinFakeNgspiceForSuite();

const SIGNIN_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); spawnState.calls = []; spawnState.script = { code: 0, stdout: "", stderr: "", emitError: null }; fsState.writes = []; fsState.raw = null; fsState.unlinks = []; fsState.closes = 0; adapterState.started = 0; });

// ═══ Policy rows ═════════════════════════════════════════════════════════════
describe("B16.0.24 §A — exact policy rows for the five methods", () => {
  it("auth callback GET public; signin/signout POST public+CSRF; chat body-scope propose+CSRF; simulate authenticated read", () => {
    expect(policyFor("/api/auth/callback", "GET")).toMatchObject({ authClass: "public", requiresAuth: false });
    for (const p of ["/api/auth/signin", "/api/auth/signout"]) {
      expect(policyFor(p, "POST"), p).toMatchObject({ authClass: "public", requiresAuth: false, requiresCsrf: true, providerCredit: false });
    }
    expect(policyFor("/api/chat", "POST")).toMatchObject({ identitySource: "body-scope-server-actor", requiresAuth: true, requiresCsrf: true, providerCredit: true });
    expect(policyFor("/api/simulate", "POST")).toMatchObject({ requiresAuth: true, requiresCsrf: true });
  });
});

// ═══ §B auth callback ════════════════════════════════════════════════════════
describe("B16.0.24 §B — auth callback (PKCE redirect boundary)", () => {
  beforeEach(() => { for (const k of SIGNIN_ENV_KEYS) vi.stubEnv(k, ""); });
  it("no code (unconfigured) → 303 same-origin /signin?error=auth; never a token", async () => {
    const res = await callbackGet(new Request("http://localhost/api/auth/callback"));
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(new URL(location).host).toBe("localhost");
    expect(new URL(location).pathname).toBe("/signin");
    expect(new URL(location).searchParams.get("error")).toBe("auth");
    expect(location).not.toMatch(/token|code=/i);
  });
  it("a hostile `next` (absolute) is refused: redirect stays same-origin /signin (never the attacker path)", async () => {
    const res = await callbackGet(new Request("http://localhost/api/auth/callback?code=abc&next=https://evil.example/steal"));
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(new URL(location).host).toBe("localhost");
    expect(new URL(location).pathname).toBe("/signin"); // unconfigured → /signin?error=auth (code present but no url/key)
  });
  it("safeRedirectPath rejects every open-redirect vector and preserves safe relative paths", () => {
    expect(safeRedirectPath("https://evil.example/x")).toBe("/");
    expect(safeRedirectPath("//evil.example/x")).toBe("/");
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/");
    expect(safeRedirectPath("/projects/1")).toBe("/projects/1");
  });
});

// ═══ §C sign-in ══════════════════════════════════════════════════════════════
describe("B16.0.24 §C — sign-in credential boundary", () => {
  beforeEach(() => { for (const k of SIGNIN_ENV_KEYS) vi.stubEnv(k, ""); });
  function signin(body: BodyInit, headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/auth/signin", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body });
  }
  it("CSRF before body: cross-origin 403; origin-less 403", async () => {
    expect((await signinPost(signin(JSON.stringify({ email: "a@b.c", password: "x" }), { origin: "http://evil.example" }))).status).toBe(403);
    const noOrigin = new Request("http://localhost/api/auth/signin", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await signinPost(noOrigin)).status).toBe(403);
  });
  it("media 415; malformed JSON 400; non-object 400; missing credentials 400; oversized 413", async () => {
    expect((await signinPost(signin("{}", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await signinPost(signin("not json"))).status).toBe(400);
    expect((await signinPost(signin("[]"))).status).toBe(400);
    expect((await signinPost(signin(JSON.stringify({ email: "", password: "" })))).status).toBe(400);
    expect((await signinPost(signin(JSON.stringify({ email: "a@b.c" })))).status).toBe(400);
    expect((await signinPost(signin(JSON.stringify({ email: "a@b.c", password: "x".repeat(2000) })))).status).toBe(400);
    expect((await signinPost(signin(JSON.stringify({ email: "a@b.c", password: "x", pad: "y".repeat(20_000) })))).status).toBe(413);
  });
  it("valid credentials but unconfigured → 503 AUTH_SIGNIN_UNAVAILABLE; body carries no token/session/user", async () => {
    const res = await signinPost(signin(JSON.stringify({ email: "a@b.c", password: "secret" })));
    expect(res.status).toBe(503);
    const body = await payload(res);
    expect(body.code).toBe("AUTH_SIGNIN_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toMatch(/token|session|access|secret/i);
  });
  it("no sign-UP endpoint exists under /api/auth", async () => {
    const { existsSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const authDir = join(dirname(fileURLToPath(import.meta.url)), "..", "auth");
    for (const forbidden of ["signup", "sign-up", "register", "create-account"]) {
      expect(existsSync(join(authDir, forbidden)), forbidden).toBe(false);
    }
  });
});

// ═══ §D sign-out ═════════════════════════════════════════════════════════════
describe("B16.0.24 §D — sign-out session retirement", () => {
  function signoutReq(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/auth/signout", { method: "POST", headers: { origin: "http://localhost", ...headers } });
  }
  function stub(env: Record<string, string>): void { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); }
  it("local development → 200 { ok:true, signedOut:false, mode:'local_dev' }", async () => {
    const res = await signoutPost(signoutReq());
    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ ok: true, signedOut: false, mode: "local_dev" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("production unconfigured → 503 AUTH_SIGNOUT_UNAVAILABLE mode production", async () => {
    stub({ SIRKIT_AUTH_MODE: "production", SIRKIT_EXPECTED_ORIGIN: "http://localhost" });
    const res = await signoutPost(signoutReq());
    expect(res.status).toBe(503);
    expect(await payload(res)).toMatchObject({ ok: false, code: "AUTH_SIGNOUT_UNAVAILABLE", mode: "production" });
  });
  it("CSRF still enforced before any cookie/Supabase work: unconfigured-origin production 403; spoofed forwarded-host 403", async () => {
    stub({ NODE_ENV: "production" });
    expect((await signoutPost(signoutReq())).status).toBe(403);
    resetInjectedIdentity(); vi.unstubAllEnvs();
    stub({ NODE_ENV: "production", SIRKIT_EXPECTED_ORIGIN: "https://sirkit.example" });
    const spoof = await signoutPost(new Request("https://sirkit.example/api/auth/signout", { method: "POST", headers: { origin: "https://evil.example", "x-forwarded-host": "evil.example" } }));
    expect(spoof.status).toBe(403);
  });
});

// ═══ §E/§F agent chat ════════════════════════════════════════════════════════
describe("B16.0.24 §E/§F — agent chat boundary and streaming", () => {
  const SCOPE = { tenantId: "local", projectId: "local", branchId: "local" };
  function chat(body: BodyInit, headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body });
  }
  function validBody(extra: Record<string, unknown> = {}) {
    return JSON.stringify({ provider: "openai", messages: [{ role: "user", content: "hello" }], scope: SCOPE, ...extra });
  }
  it("media 415 with ZERO body pulls; 413 board-capable over the ceiling", async () => {
    const counter = { pulls: 0 };
    const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
    const media = await chatPost(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "text/plain", origin: "http://localhost" }, body: stream, duplex: "half" } as RequestInit));
    expect(media.status).toBe(415);
    expect((await payload(media)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    expect(counter.pulls).toBe(0);
    const over = await chatPost(chat("x".repeat(MAX_CHAT_REQUEST_BYTES + 1)));
    expect(over.status).toBe(413);
    expect(String((await payload(over)).error)).toContain("board-capable limit");
  });
  it("authority-shaped and unknown keys refuse (400); non-UTF8 400; empty messages 400", async () => {
    expect((await chatPost(chat(validBody({ actor: "admin" })))).status).toBe(400);
    expect(String((await payload(await chatPost(chat(validBody({ actor: "admin" }))))).error)).toContain("authority");
    expect((await chatPost(chat(JSON.stringify({ boardState: {} })))).status).toBe(400);
    expect((await chatPost(chat(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])))).status).toBe(400);
    const empty = await chatPost(chat(JSON.stringify({ messages: [], scope: SCOPE })));
    expect(empty.status).toBe(400);
    expect(String((await payload(empty)).error)).toContain("user message");
  });
  it("scope authority-shaped keys refuse; scope.actor 400", async () => {
    const res = await chatPost(chat(JSON.stringify({ messages: [{ role: "user", content: "hi" }], scope: { ...SCOPE, actor: "admin" } })));
    expect(res.status).toBe(400);
    expect(String((await payload(res)).error)).toContain("authority-shaped key");
  });
  it("a valid conversational run streams NDJSON with the exact protocol headers and a single terminal event", async () => {
    const res = await chatPost(chat(validBody()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("x-sirkit-chat-protocol")).toBe("1");
    expect(res.headers.get("x-sirkit-run-id")).toMatch(/^run-/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { v: number; seq: number; type: string });
    expect(lines.every((l) => l.v === 1)).toBe(true);
    for (let i = 0; i < lines.length; i++) expect(lines[i]!.seq).toBe(i + 1); // monotonic from 1
    const terminals = lines.filter((l) => l.type === "run_completed" || l.type === "run_failed");
    expect(terminals.length).toBe(1);
    expect(adapterState.started).toBe(1); // exactly one provider invocation
  });
  it("production cross-origin → 403 with no run-id / non-ndjson; viewer role → 403 AUTH_ROLE_DENIED", async () => {
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk");
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "tenant-1", projectId: "project-1", role: "editor" });
    const cross = await chatPost(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], scope: { tenantId: "tenant-1", projectId: "project-1", branchId: "main" } }) }));
    expect(cross.status).toBe(403);
    expect(cross.headers.get("x-sirkit-run-id")).toBeNull();
    expect(cross.headers.get("content-type")).not.toContain("ndjson");
    resetInjectedIdentity();
    injectAuthorizedPrincipal({ userId: "u2", tenantId: "tenant-1", projectId: "project-1", role: "viewer" });
    const viewer = await chatPost(chat(JSON.stringify({ messages: [{ role: "user", content: "hi" }], scope: { tenantId: "tenant-1", projectId: "project-1", branchId: "main" } })));
    expect(viewer.status).toBe(403);
    expect((await payload(viewer)).code).toBe("AUTH_ROLE_DENIED");
    expect(adapterState.started).toBe(0); // refusal spent zero provider work
  });
});

// ═══ §G/§H legacy simulate ═══════════════════════════════════════════════════
describe("B16.0.24 §G/§H — legacy /api/simulate process boundary", () => {
  const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "local", "x-sirkit-branch-id": "local" };
  function simulate(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/simulate", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body: JSON.stringify(body) });
  }
  // A minimal VALID connected circuit: V1 (5V) with R1 (1k) across it to
  // ground — pins co-locate / wire-connect so the union-find yields two nodes.
  function validState() {
    return { state: {
      components: [
        { id: "v1", type: "voltage-source", value: "5", position: { x: 100, y: 100 }, rotation: 0, refDes: "V1" },
        { id: "r1", type: "resistor", value: "1k", position: { x: 130, y: 70 }, rotation: 0, refDes: "R1" },
        { id: "g1", type: "ground", value: "", position: { x: 100, y: 180 }, rotation: 0, refDes: "" },
      ],
      wires: [
        { id: "w1", vertices: [{ x: 100, y: 130 }, { x: 100, y: 160 }] },
        { id: "w2", vertices: [{ x: 160, y: 70 }, { x: 160, y: 160 }, { x: 100, y: 160 }] },
      ],
      netLabels: [],
    } };
  }
  it("unauthenticated 401; refusals spawn ZERO processes", async () => {
    injectIdentity(null);
    expect((await simulatePost(simulate(validState()))).status).toBe(401);
    expect(spawnState.calls).toEqual([]);
  });
  it("validation refusals (no components / no source / no ground) → 400 before any spawn", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "local", role: "editor" });
    expect((await simulatePost(simulate({ state: { components: [] } }))).status).toBe(400);
    expect((await simulatePost(simulate({ state: { components: [{ id: "r1", type: "resistor", value: "1k" }] } }))).status).toBe(400);
    expect((await simulatePost(simulate({ state: { components: [{ id: "v1", type: "voltage-source", value: "5" }], netLabels: [] } }))).status).toBe(400);
    expect(spawnState.calls).toEqual([]);
  });
  // [B16.0.24.1 §1] the raw artifact is read through a TRULY bounded handle
  // reader: an over-ceiling output is refused EXPLICITLY (never truncated,
  // never parsed) and an exactly-at-ceiling output still parses.
  it("an OVER-CEILING raw artifact refuses explicitly — parsing never begins on partial output", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "local", role: "editor" });
    fsState.raw = "x".repeat(20_000_001); // MAX_RAW_BYTES + 1
    spawnState.script = { code: 0, stdout: "ok", stderr: "", emitError: null };
    const res = await simulatePost(simulate(validState()));
    expect(res.status).toBe(500);
    expect(await payload(res)).toEqual({ ok: false, error: "Simulation output exceeded the bounded size limit" });
    expect(fsState.closes).toBe(1); // the handle closed on the refusal path
  });
  it("an EXACTLY-at-ceiling raw artifact is accepted and parses", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "local", role: "editor" });
    const header = ["Plotname: Transient Analysis", "Flags: real", "No. Variables: 2", "Variables:", " 0 time time", " 1 v(out) voltage", "Values:", "0 0 1.0", "1 1e-3 2.0", ""].join("\n");
    fsState.raw = header + " ".repeat(20_000_000 - Buffer.byteLength(header, "utf8")); // pad to EXACTLY MAX_RAW_BYTES
    spawnState.script = { code: 0, stdout: "ok", stderr: "", emitError: null };
    const res = await simulatePost(simulate(validState()));
    expect(res.status).toBe(200);
    expect((await payload(res)).ok).toBe(true);
    expect(fsState.closes).toBe(1);
  });
  it("a successful run spawns ngspice exactly once (no shell) and returns the analysis result envelope", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "local", role: "editor" });
    fsState.raw = ["Plotname: Transient Analysis", "Flags: real", "No. Variables: 2", "Variables:", " 0 time time", " 1 v(out) voltage", "Values:", "0 0 1.0", "1 1e-3 2.0"].join("\n");
    spawnState.script = { code: 0, stdout: "ok", stderr: "", emitError: null };
    const res = await simulatePost(simulate(validState()));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.variables)).toBe(true);
    expect(Array.isArray(body.points)).toBe(true);
    expect(spawnState.calls.length).toBe(1);
    expect(spawnState.calls[0]!.opts.shell ?? false).toBe(false); // never a shell
  });
});
