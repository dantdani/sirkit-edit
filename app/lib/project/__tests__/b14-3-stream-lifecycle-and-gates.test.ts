/**
 * B14.3 — stream-lifecycle closure and hardened capability import gates.
 *
 * §A the shared bounded reader's OPTIONAL lifecycle bounds (external abort,
 *    hard deadline, one settlement, best-effort non-load-bearing reader
 *    cancellation, inert late results, unchanged B10 defaults);
 * §B the `/api/replacement-authority` request lifecycle (stalled stream ⇒
 *    deterministic 408, client abort ⇒ prompt 408, oversized ⇒ 413, no
 *    durable loader after any incomplete request);
 * §C ACTUAL never-settling response-body streams at the channel (reader
 *    receives cancellation, late bodies inert, zero facts after timeout) —
 *    replacing the B14.2 test that modeled a hung body as a hung transport;
 * §E specifier-RESOLVING import gates for every replacement capability
 *    module with equivalent-spelling tripwires (same-directory, parent-
 *    relative, alias, dynamic import, re-export).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readBoundedStream } from "../../http/bounded-stream";
import {
  __createTestReplacementReauthorizationChannel,
  consumeReplacementReauthorization,
  createReplacementReauthorization,
  REAUTHORIZATION_TRANSPORT_DEADLINE_MS,
} from "../replacement-reauthorization";
import { moduleImportOffenders, type FileMap } from "./_import-gate-helpers";
import { POST as REAUTH_POST } from "@/app/api/replacement-authority/route";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import {
  resetComponentAuthoritySourceFactory,
  setComponentAuthoritySourceFactory,
} from "@/app/api/chat/component-authority-runtime";
import {
  resetReplacementPinFactsSourceFactory,
  setReplacementPinFactsSourceFactory,
} from "@/app/api/chat/replacement-facts-runtime";

/** The route-internal request-read deadline (REQUEST_READ_DEADLINE_MS). */
const ROUTE_READ_DEADLINE_MS = 10_000;

const REQUEST = {
  proposalId: "rprop-aaaaaaaaaaaaaaaa",
  componentInstanceId: "u1-id",
  currentAtomicPartRevisionId: "rev-old",
  scope: { tenantId: "local", projectId: "p-b143", branchId: "main" },
  headMark: { lineageId: "lin1-aaaaaaaaaaaaaaaa", headSequence: 1, canonicalStateDigest: "eng1-bbbbbbbbbbbbbbbb" },
  now: 1_000_000,
};

function goodText(requestBody: string): string {
  const parsed = JSON.parse(requestBody) as { nonce: string; componentInstanceId: string; scope: { projectId: string } };
  return JSON.stringify({
    ok: true, records: [], candidates: [], currentPinFacts: null, targetPinFacts: null,
    binding: { nonce: parsed.nonce, componentInstanceId: parsed.componentInstanceId, scope: { tenantId: "local", projectId: parsed.scope.projectId, branchId: "main" } },
  });
}

/** A DUCK-TYPED stream whose reader IGNORES cancellation (cancel never
 *  settles) and can deliver a late resolution or rejection on demand —
 *  modeling a hostile response body that a standard ReadableStream cannot
 *  (reader.cancel always detaches a real one). */
function stubbornStream(): {
  stream: ReadableStream<Uint8Array>;
  cancelInvocations: () => number;
  releaseWith: (chunk: Uint8Array) => void;
  rejectWith: (error: Error) => void;
} {
  const pendingReads: Array<{ resolve: (result: { done: boolean; value?: Uint8Array }) => void; reject: (error: Error) => void }> = [];
  let cancels = 0;
  const stream = {
    getReader: () => ({
      read: () => new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => { pendingReads.push({ resolve, reject }); }),
      cancel: () => { cancels += 1; return new Promise<void>(() => {}); },
      releaseLock: () => {},
    }),
  } as unknown as ReadableStream<Uint8Array>;
  return {
    stream,
    cancelInvocations: () => cancels,
    releaseWith: (chunk) => { pendingReads.shift()?.resolve({ done: false, value: chunk }); },
    rejectWith: (error) => { pendingReads.shift()?.reject(error); },
  };
}

// ─── §A — the shared reader's lifecycle bounds (regressions at the primitive) ─

describe("B14.3 §A — readBoundedStream lifecycle bounds", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("1. a stream that never emits its first chunk settles 'timeout' at the deadline; the reader receives cancellation; timers cleared", async () => {
    let canceled = 0;
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => {}),
      cancel() { canceled += 1; },
    });
    const pending = readBoundedStream(stalled, 1024, { deadlineMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
    expect(canceled).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("2. a PRE-aborted signal settles 'aborted' without ever calling getReader()", async () => {
    let getReaderCalls = 0;
    const untouchable = {
      getReader: () => { getReaderCalls += 1; throw new Error("must not be reached"); },
    } as unknown as ReadableStream<Uint8Array>;
    const controller = new AbortController();
    controller.abort();
    expect(await readBoundedStream(untouchable, 1024, { signal: controller.signal })).toEqual({ ok: false, reason: "aborted" });
    expect(getReaderCalls).toBe(0);
  });

  it("3. an external abort mid-read settles 'aborted' and cancels the active reader", async () => {
    let canceled = 0;
    const hung = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => {}),
      cancel() { canceled += 1; },
    });
    const controller = new AbortController();
    const pending = readBoundedStream(hung, 1024, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "aborted" });
    expect(canceled).toBe(1);
  });

  it("4. cancellation that throws synchronously or never settles cannot delay the timeout result", async () => {
    for (const cancel of [
      () => { throw new Error("hostile sync cancel"); },
      () => new Promise<void>(() => {}),
    ]) {
      const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
      const pending = readBoundedStream(stalled, 1024, { deadlineMs: 250 });
      await vi.advanceTimersByTimeAsync(250);
      expect(await pending).toEqual({ ok: false, reason: "timeout" });
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("5. a late read rejection after the timeout is observed — never unhandled; a late resolution is discarded", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const rejecting = stubbornStream();
      const rejectPending = readBoundedStream(rejecting.stream, 1024, { deadlineMs: 200 });
      await vi.advanceTimersByTimeAsync(200);
      expect(await rejectPending).toEqual({ ok: false, reason: "timeout" });
      rejecting.rejectWith(new Error("late failure"));
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();

      const resolving = stubbornStream();
      const resolvePending = readBoundedStream(resolving.stream, 1024, { deadlineMs: 200 });
      await vi.advanceTimersByTimeAsync(200);
      expect(await resolvePending).toEqual({ ok: false, reason: "timeout" });
      resolving.releaseWith(new TextEncoder().encode("late data"));
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("6. crossing the byte ceiling under an active lifecycle still settles 'over-limit' (not 'timeout') with cancellation", async () => {
    let canceled = 0;
    const chunk = new Uint8Array(512).fill(66);
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(chunk); },
      cancel() { canceled += 1; },
    });
    const pending = readBoundedStream(oversized, 1024, { signal: new AbortController().signal, deadlineMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toEqual({ ok: false, reason: "over-limit" });
    expect(canceled).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("7. WITHOUT lifecycle options the B10 default is unchanged: byte ceiling only, no hidden deadline", async () => {
    // A stalled stream stays pending indefinitely (the caller's liveness
    // problem, exactly as before B14.3) …
    let settled = false;
    void readBoundedStream(new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }), 1024)
      .then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(settled).toBe(false);
    // … while completion and the ceiling behave identically.
    const bytes = new TextEncoder().encode("plain");
    const normal = await readBoundedStream(new Response(bytes).body, 1024);
    expect(normal).toEqual({ ok: true, bytes });
    const over = await readBoundedStream(new Response(new Uint8Array(2048)).body, 1024);
    expect(over).toEqual({ ok: false, reason: "over-limit" });
  });
});

// ─── §B — the endpoint's bounded request lifecycle ───────────────────────────

describe("B14.3 §B — /api/replacement-authority request lifecycle", () => {
  let authorityResolutions = 0;
  let pinFactsResolutions = 0;

  // [B16.0.3 §A] the route now authenticates FIRST; inject an authorized
  // editor of the selected project so the bounded-body lifecycle path is
  // reached (auth resolves via microtasks under fake timers).
  const B143_PROJECT = "p-b143";
  const SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": B143_PROJECT, "x-sirkit-branch-id": "main" };
  beforeEach(() => {
    vi.useFakeTimers();
    injectAuthorizedPrincipal({ userId: "reauth-editor", tenantId: "local", projectId: B143_PROJECT, role: "editor" });
    authorityResolutions = 0;
    pinFactsResolutions = 0;
    setComponentAuthoritySourceFactory(() => { authorityResolutions += 1; return null; });
    setReplacementPinFactsSourceFactory(() => { pinFactsResolutions += 1; return null; });
  });
  afterEach(() => {
    resetInjectedIdentity();
    resetComponentAuthoritySourceFactory();
    resetReplacementPinFactsSourceFactory();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  function streamingRequest(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Request {
    return new Request("http://localhost/api/replacement-authority", {
      method: "POST", headers: { "Content-Type": "application/json", ...SELECTOR },
      body: stream, duplex: "half", ...(signal ? { signal } : {}),
    } as RequestInit);
  }

  it("8. a request stream that never emits its first chunk returns 408 at the read deadline; no durable loader ran", async () => {
    const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const pending = REAUTH_POST(streamingRequest(stalled));
    await vi.advanceTimersByTimeAsync(ROUTE_READ_DEADLINE_MS);
    const response = await pending;
    expect(response.status).toBe(408);
    expect(authorityResolutions).toBe(0);
    expect(pinFactsResolutions).toBe(0);
  });

  it("9. a client abort before the first chunk settles promptly with 408; no durable loader ran", async () => {
    const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const controller = new AbortController();
    const pending = REAUTH_POST(streamingRequest(stalled, controller.signal));
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    const response = await pending;
    expect(response.status).toBe(408);
    expect(authorityResolutions).toBe(0);
  });

  it("10. the read timeout invokes best-effort cancellation on the request stream, and a never-settling cancel cannot delay the 408", async () => {
    let canceled = 0;
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => {}),
      cancel() { canceled += 1; return new Promise(() => {}); },
    });
    const pending = REAUTH_POST(streamingRequest(stalled));
    await vi.advanceTimersByTimeAsync(ROUTE_READ_DEADLINE_MS);
    const response = await pending;
    expect(response.status).toBe(408);
    expect(canceled).toBe(1);
  });

  it("11. an oversized stream remains 413 under the active lifecycle; no durable loader ran", async () => {
    const chunk = new Uint8Array(4096).fill(120);
    let served = 0;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) { served += 1; controller.enqueue(chunk); },
    });
    const pending = REAUTH_POST(streamingRequest(oversized));
    await vi.advanceTimersByTimeAsync(0);
    const response = await pending;
    expect(response.status).toBe(413);
    expect(served).toBeLessThan(10);
    expect(authorityResolutions).toBe(0);
  });

  it("12. a well-formed request still reaches durable resolution through the lifecycle path", async () => {
    const body = JSON.stringify({
      scope: { tenantId: "local", projectId: B143_PROJECT, branchId: "main" },
      componentInstanceId: "u1-id", currentAtomicPartRevisionId: null, nonce: "a1b2c3d4e5f60718",
    });
    const pending = REAUTH_POST(new Request("http://localhost/api/replacement-authority", {
      method: "POST", headers: { "Content-Type": "application/json", ...SELECTOR }, body,
    }));
    await vi.advanceTimersByTimeAsync(0);
    const response = await pending;
    expect(response.status).toBe(503); // the counting factory returns no source
    expect(authorityResolutions).toBe(1);
  });
});

// ─── §C — ACTUAL never-settling response bodies at the channel ───────────────

describe("B14.3 §C — hung response-body streams settle, cancel, and stay inert", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("13. an actual never-settling response ReadableStream: consume settles null at the deadline, the body reader receives cancellation, timers cleared", async () => {
    let canceled = 0;
    const hungBody = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => {}),
      cancel() { canceled += 1; return new Promise(() => {}); }, // never settles — must not delay
    });
    const channel = __createTestReplacementReauthorizationChannel(async () => ({ ok: true, stream: hungBody }));
    const pending = consumeReplacementReauthorization(channel, REQUEST);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_TRANSPORT_DEADLINE_MS);
    expect(await pending).toBeNull();
    expect(canceled).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("14. a late VALID JSON body after the timeout is discarded — zero facts accepted, and the channel stays consumed", async () => {
    const stubborn = stubbornStream();
    let requestBody = "";
    const channel = __createTestReplacementReauthorizationChannel(async (body) => {
      requestBody = body;
      return { ok: true, stream: stubborn.stream };
    });
    const pending = consumeReplacementReauthorization(channel, REQUEST);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_TRANSPORT_DEADLINE_MS);
    expect(await pending).toBeNull();
    expect(stubborn.cancelInvocations()).toBe(1);
    // The stream IGNORED cancellation and now delivers a fully valid,
    // correctly nonce-bound JSON body — it must be inert.
    stubborn.releaseWith(new TextEncoder().encode(goodText(requestBody)));
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    // one-shot: the same channel refuses a retry outright.
    const second = consumeReplacementReauthorization(channel, REQUEST);
    await vi.advanceTimersByTimeAsync(1);
    expect(await second).toBeNull();
  });

  it("15. a late response-body rejection after the timeout produces no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const stubborn = stubbornStream();
      const channel = __createTestReplacementReauthorizationChannel(async () => ({ ok: true, stream: stubborn.stream }));
      const pending = consumeReplacementReauthorization(channel, REQUEST);
      await vi.advanceTimersByTimeAsync(REAUTHORIZATION_TRANSPORT_DEADLINE_MS);
      expect(await pending).toBeNull();
      stubborn.rejectWith(new Error("late body failure"));
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("16. [R2 closure] the PRODUCTION channel cancels a hung fetch response body at the transport deadline", async () => {
    let canceled = 0;
    const hungBody = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => {}),
      cancel() { canceled += 1; },
    });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      headers: { get: () => "application/json" },
      body: hungBody,
    }));
    try {
      const channel = createReplacementReauthorization();
      const pending = consumeReplacementReauthorization(channel, REQUEST);
      await vi.advanceTimersByTimeAsync(REAUTHORIZATION_TRANSPORT_DEADLINE_MS + 100);
      expect(await pending).toBeNull();
      expect(canceled).toBe(1); // the pre-B14.3 counterexample was {"result":null,"canceled":false}
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ─── §E — hardened, specifier-resolving capability import gates ──────────────

function productionFiles(): FileMap {
  const files: FileMap = new Map();
  const root = process.cwd();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", "__tests__", ".next", ".git", "vendor", "artifacts", "data", "public"].includes(entry)) continue;
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      files.set(relative(root, full).replaceAll("\\", "/"), readFileSync(full, "utf8"));
    }
  };
  walk(join(root, "app"));
  walk(join(root, "scripts"));
  walk(join(root, "lib"));
  return files;
}

describe("B14.3 §E — capability import gates resolve every import spelling", () => {
  const files = productionFiles();
  const CHANNEL = "app/lib/project/replacement-reauthorization";
  const CONTROLLER = "app/lib/project/replacement-approval-controller.internal";
  const INTENT = "app/lib/engineering/replacement-approval.internal";
  // The exact approved importer sets — unchanged from B14.1/B14.2.
  const CHANNEL_APPROVED = new Set([
    "app/lib/project/replacement-reauthorization.ts",
    "app/lib/project/replacement-approval-controller.internal.ts",
    "app/lib/engineering/approved-replacement-mutations.ts",
  ]);
  const CONTROLLER_APPROVED = new Set([
    "app/lib/project/replacement-approval-controller.internal.ts",
    "app/page.tsx",
  ]);
  const INTENT_APPROVED = new Set([
    "app/lib/engineering/replacement-approval.internal.ts",
    "app/lib/engineering/approved-replacement-mutations.ts",
    "app/lib/project/replacement-approval-controller.internal.ts",
  ]);

  it("17. every capability target is clean under specifier resolution with its exact approved set", { timeout: 60_000 }, () => {
    expect(moduleImportOffenders(files, CHANNEL, CHANNEL_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, CONTROLLER, CONTROLLER_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, INTENT, INTENT_APPROVED)).toEqual([]);
    // the test-only factory is an identifier gate: it must not APPEAR in any
    // production file outside its gated definition.
    const factoryOffenders = [...files].filter(([relPath, source]) =>
      relPath !== "app/lib/project/replacement-reauthorization.ts" && source.includes("__createTestReplacementReauthorizationChannel"),
    ).map(([relPath]) => relPath);
    expect(factoryOffenders).toEqual([]);
  });

  it("18. tripwires: same-directory, parent-relative, alias, dynamic, and re-export spellings are ALL detected", { timeout: 60_000 }, () => {
    const cases: Array<[string, string]> = [
      // [R4] the exact bypass: a same-directory relative import.
      ["app/lib/project/evil-same-dir.ts", 'import { createReplacementReauthorization } from "./replacement-reauthorization";'],
      ["app/lib/agent/evil-parent.ts", 'import { consumeReplacementReauthorization } from "../project/replacement-reauthorization";'],
      ["app/api/evil/route.ts", 'import { createReplacementReauthorization } from "@/app/lib/project/replacement-reauthorization";'],
      ["app/lib/agent/evil-dynamic.ts", 'const channel = await import("../project/replacement-reauthorization");'],
      ["app/lib/engineering/evil-reexport.ts", 'export * from "../project/replacement-reauthorization";'],
      ["app/lib/agent/evil-deep.ts", 'import { createReplacementReauthorization } from "./../project/./replacement-reauthorization";'],
    ];
    for (const [path, source] of cases) {
      const injected: FileMap = new Map(files);
      injected.set(path, source);
      expect(moduleImportOffenders(injected, CHANNEL, CHANNEL_APPROVED), path).toEqual([path]);
    }
    // the same resolver protects the controller and the intent module:
    for (const [path, source, module, approved] of [
      ["app/lib/project/evil-controller.ts", 'import { approveAndApplyReplacement } from "./replacement-approval-controller.internal";', CONTROLLER, CONTROLLER_APPROVED],
      ["app/lib/engineering/evil-intent.ts", 'export { issueReplacementApprovalIntent } from "./replacement-approval.internal";', INTENT, INTENT_APPROVED],
      ["app/api/evil-intent/route.ts", 'const intent = await import("@/app/lib/engineering/replacement-approval.internal");', INTENT, INTENT_APPROVED],
    ] as Array<[string, string, string, ReadonlySet<string>]>) {
      const injected: FileMap = new Map(files);
      injected.set(path, source);
      expect(moduleImportOffenders(injected, module, approved), path).toEqual([path]);
    }
  });

  it("19. non-import occurrences of a module NAME are ignored (the endpoint's canonicalRevision literal), so the gate is sound as well as complete", () => {
    const route = files.get("app/api/replacement-authority/route.ts") ?? "";
    expect(route).toContain('"replacement-reauthorization"'); // the canonicalRevision string literal
    expect(CHANNEL_APPROVED.has("app/api/replacement-authority/route.ts")).toBe(false);
    // …and yet test 17 held: the literal is not an import, so the route is
    // not an offender. A raw-substring gate could not make this distinction.
  });
});
