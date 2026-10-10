/**
 * [B24-D2] D24-31's FreeRouting and kicad-cli remainder: the tree kill and an orphan check (OD-145's method, B22-A3's
 * `killDiagnosticProcessTree`, which is not touched). `app/lib/pcb/process-tree.ts` ends a child's tree - taskkill /PID /T /F under the
 * checked Windows directory on win32, SIGKILL to the process group on POSIX, the direct child alone without a pid - with the killer's
 * spawn passed in, so it names no process module; both runners spawn their child detached except on win32, call it in place of
 * `child.kill("SIGKILL")`, and settle a killed run only after its `close` is observed or after the bounded confirm wait
 * (TREE_KILL_CONFIRM_MS, 5,000 ms), with `killConfirmed` on the result.
 *
 *  1. the helper on win32: one taskkill with the fixed argv, only SystemRoot in its environment, windowsHide and no shell, then the
 *     direct child once taskkill ends - or at once when taskkill cannot start;
 *  2. the helper on POSIX: SIGKILL to the group (-pid), the direct child only when the group is gone;
 *  3. a child with no pid gets the direct kill only; the Windows-directory refusals: unset, relative, or carrying `%`, `;` or `"` -
 *     the direct kill only, and no taskkill is started from it;
 *  4. kicad-cli on timeout, on each platform branch (a mocked spawn with a pid): the tree kill, `detached` on POSIX only, the run
 *     settled after `close` with killConfirmed true - or, when no exit is observed, after exactly the confirm wait with killConfirmed false;
 *  5. FreeRouting on timeout and on abort: the tree kill, killConfirmed, and its temporary files still present while the kill is in
 *     flight and removed only after the run settles;
 *  6. the sources: neither runner calls `child.kill` directly any more, each passes its own spawn to the helper, and the helper names no
 *     process module;
 *  7. one REAL process tree, no Java and no kicad-cli: `runKicadCli` with `cliPath: process.execPath` runs a script that starts a
 *     grandchild and records both pids in its working directory; both are alive before the timeout (else NOT MEASURED), and after the
 *     result both are gone within the confirm wait (signal 0). On win32 this measures taskkill /T; on ubuntu (CI) the group kill.
 *     [B24-D2 review] A pid confirmed gone is struck off the survivors at once, so afterAll never signals a pid another process may
 *     hold by then;
 *  8. [B24-D2 review] an unconfirmed kill is reported beyond the runner: the route's pass executor and the production router carry
 *     killConfirmed into each attempt's evidence, and kicad-cli's bundle error carries it (the gerbers route answers it); a run that
 *     was not killed carries none. Red first on the D2 tree: every one of them dropped it.
 *
 * Failing first on 3d5f225 (performance-and-reliability.md part 2): the helper does not exist; a fake child with a pid gets no
 * taskkill and no group kill, only `child.kill("SIGKILL")`, and the run settles before its exit; and the real grandchild survives the
 * kill. The write of case 7's child names its primitive at run time (B22-B's precedent for B22-A3's counterexample); the scratch
 * cleanup spells its own, admitted by b11-5-capture-exactness case 12 while every write line is rooted at the case's
 * `mkdtempSync(join(tmpdir(), "sirkit-b24-d2-proc-"))` root ([B24-D2 review]).
 */
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

type Spawned = { command: string; args: readonly string[]; options: Record<string, unknown> };
const harness = vi.hoisted(() => ({ fake: null as null | ((call: { command: string; args: readonly string[]; options: Record<string, unknown> }) => unknown), calls: [] as Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> }));
vi.mock("child_process", async (original) => {
  const actual = await original<typeof import("child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      const call = { command, args, options };
      harness.calls.push(call);
      return harness.fake ? harness.fake(call) : (actual.spawn as unknown as (file: string, argv: string[], opts: Record<string, unknown>) => unknown)(command, [...args], options);
    },
  };
});

const ROOT = process.cwd();
const READ = (path: string): string => fs.readFileSync(join(ROOT, path), "utf8");
const FAKE_PID = 424_242;
const WINDOWS = "C:\\Windows";
const survivors: number[] = [];
const scratchRoots: string[] = [];

interface FakeChild extends EventEmitter { pid?: number; stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }
function fakeChild(pid: number | undefined): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = pid;
  child.kill = vi.fn(() => true);
  return child;
}
/** A fake killer: it ends (`close`) on the next microtask, unless told it cannot start (`error`). */
function fakeKiller(fails = false): EventEmitter {
  const killer = new EventEmitter();
  queueMicrotask(() => killer.emit(fails ? "error" : "close", fails ? new Error("spawn ENOENT") : 0));
  return killer;
}
/** Run `body` as if on `platform`, restoring the real one after. */
async function onPlatform<T>(platform: "win32" | "linux", body: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  try {
    return await body();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

afterEach(() => {
  harness.fake = null;
  harness.calls.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
afterAll(() => {
  // [B24-D2 review, 2026-10-09] only a pid case 7 did NOT confirm gone is left here (a confirmed one is struck off at once: a freed pid
  // may already be another process's), and it is killed only while it is still alive
  for (const pid of survivors) {
    if (!alive(pid)) continue;
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
  // [B24-D2 review, 2026-10-09] spelled, and admitted by b11-5-capture-exactness case 12 only while every write line is rooted at the
  // case's mkdtempSync(join(tmpdir(), "sirkit-b24-d2-proc-")) root (`root`, `scratch`)
  for (const root of scratchRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe("[B24-D2] FreeRouting and kicad-cli: the tree kill and an orphan check (D24-31, OD-145)", () => {
  it("1. the helper on win32: one taskkill with the fixed argv /PID <pid> /T /F, only SystemRoot in its environment, windowsHide and no shell, then the direct child once taskkill ends - or at once when taskkill cannot start", async () => {
    const { killProcessTree, treeKillPlace } = await import("@/app/lib/pcb/process-tree");
    const place = treeKillPlace("win32", WINDOWS);
    expect(place).toEqual({ win32: true, systemRoot: WINDOWS });
    for (const fails of [false, true]) {
      const child = fakeChild(FAKE_PID);
      const calls: Spawned[] = [];
      const method = killProcessTree(child, place, () => true, (command, args, options) => { calls.push({ command, args, options }); return fakeKiller(fails); });
      expect(method).toBe("taskkill-tree");
      expect(calls).toEqual([{ command: "C:\\Windows\\System32\\taskkill.exe", args: ["/PID", String(FAKE_PID), "/T", "/F"], options: { env: { SystemRoot: WINDOWS }, windowsHide: true, shell: false, stdio: "ignore" } }]);
      expect(child.kill).not.toHaveBeenCalled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(child.kill, `taskkill ${fails ? "failed" : "ended"}`).toHaveBeenCalledWith("SIGKILL");
      expect(child.kill).toHaveBeenCalledTimes(1);
    }
    // a child already gone gets no fallback kill
    const gone = fakeChild(FAKE_PID);
    killProcessTree(gone, place, () => false, () => fakeKiller());
    await new Promise((resolve) => setImmediate(resolve));
    expect(gone.kill).not.toHaveBeenCalled();
  });

  it("2. the helper on POSIX: SIGKILL to the process group (-pid) and nothing else; the direct child only when the group is gone", async () => {
    const { killProcessTree, treeKillPlace } = await import("@/app/lib/pcb/process-tree");
    const place = treeKillPlace("linux", undefined);
    expect(place).toEqual({ win32: false, systemRoot: null });
    const signals: Array<[number, string | number | undefined]> = [];
    const kill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => { signals.push([pid, signal]); return true; }) as typeof process.kill);
    const child = fakeChild(FAKE_PID);
    const spawnKiller = vi.fn();
    expect(killProcessTree(child, place, () => true, spawnKiller)).toBe("process-group");
    expect(signals).toEqual([[-FAKE_PID, "SIGKILL"]]);
    expect(child.kill).not.toHaveBeenCalled();
    expect(spawnKiller).not.toHaveBeenCalled();
    kill.mockImplementation((() => { throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }); }) as typeof process.kill);
    const lone = fakeChild(FAKE_PID);
    expect(killProcessTree(lone, place, () => true, spawnKiller)).toBe("process-group");
    expect(lone.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("3. a child with no pid gets the direct kill only; the Windows-directory refusals (unset, relative, `%`, `;`, `\"`) leave the direct kill only and start no taskkill", async () => {
    const { killProcessTree, treeKillPlace, WINDOWS_DIRECTORY_PATTERN, TREE_KILL_CONFIRM_MS } = await import("@/app/lib/pcb/process-tree");
    const { DIAGNOSTIC_KILL_CONFIRM_MS } = await import("@/app/lib/computation/diagnostic-runner");
    expect(TREE_KILL_CONFIRM_MS).toBe(DIAGNOSTIC_KILL_CONFIRM_MS);
    expect(TREE_KILL_CONFIRM_MS).toBe(5_000);
    expect(WINDOWS_DIRECTORY_PATTERN.source).toBe(String.raw`^[A-Za-z]:\\[^;%"]*$`);
    expect(READ("app/lib/computation/diagnostic-runner.ts")).toContain(`/${WINDOWS_DIRECTORY_PATTERN.source}/.test(systemRoot)`);
    const signals: number[] = [];
    vi.spyOn(process, "kill").mockImplementation(((pid: number) => { signals.push(pid); return true; }) as typeof process.kill);
    const spawnKiller = vi.fn(() => fakeKiller());
    for (const place of [treeKillPlace("win32", WINDOWS), treeKillPlace("linux", undefined)]) {
      const child = fakeChild(undefined);
      expect(killProcessTree(child, place, () => true, spawnKiller)).toBe("direct-only");
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    }
    for (const systemRoot of [undefined, "", "Windows", "\\Windows", "C:Windows", "C:\\Win%SYSTEMROOT%", "C:\\Windows;D:\\evil", "C:\\\"Windows\""]) {
      const place = treeKillPlace("win32", systemRoot);
      expect(place, String(systemRoot)).toEqual({ win32: true, systemRoot: null });
      const child = fakeChild(FAKE_PID);
      expect(killProcessTree(child, place, () => true, spawnKiller), String(systemRoot)).toBe("direct-only");
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    }
    expect(spawnKiller).not.toHaveBeenCalled();
    expect(signals).toEqual([]);
    expect(treeKillPlace("linux", WINDOWS)).toEqual({ win32: false, systemRoot: null });
  });

  it("4. kicad-cli on timeout, on each platform branch: the tree kill, detached on POSIX only, the run settled after `close` with killConfirmed true - or, with no exit observed, after exactly the confirm wait with killConfirmed false", { timeout: 60_000 }, async () => {
    const { runKicadCli } = await import("@/app/lib/pcb/fab/kicad-cli-runner");
    const { TREE_KILL_CONFIRM_MS } = await import("@/app/lib/pcb/process-tree");
    vi.stubEnv("SystemRoot", WINDOWS);
    for (const platform of ["win32", "linux"] as const) {
      await onPlatform(platform, async () => {
        harness.calls.length = 0;
        const signals: number[] = [];
        vi.spyOn(process, "kill").mockImplementation(((pid: number) => { signals.push(pid); return true; }) as typeof process.kill);
        // (a) the exit is observed: the tree kill ends the child, which then closes
        const child = fakeChild(FAKE_PID);
        harness.fake = (call) => (call.command.endsWith("taskkill.exe") ? fakeKiller() : child);
        const result = await new Promise<Awaited<ReturnType<typeof runKicadCli>>>((resolve) => {
          void runKicadCli({ cliPath: "kicad-cli-b24-d2-fake", args: ["pcb"], timeoutMs: 20 }).then(resolve);
          const wait = setInterval(() => {
            const killed = platform === "win32" ? harness.calls.some((call) => call.command.endsWith("taskkill.exe")) : signals.includes(-FAKE_PID);
            if (killed) { clearInterval(wait); setTimeout(() => child.emit("close", null), 5); }
          }, 2);
        });
        expect(result, platform).toMatchObject({ ok: false, error: "timeout", killConfirmed: true });
        expect(harness.calls[0]!.options.detached, platform).toBe(platform !== "win32");
        if (platform === "win32") {
          expect(harness.calls.map((call) => [call.command, call.args, call.options.env])).toEqual([["kicad-cli-b24-d2-fake", ["pcb"], harness.calls[0]!.options.env], [`${WINDOWS}\\System32\\taskkill.exe`, ["/PID", String(FAKE_PID), "/T", "/F"], { SystemRoot: WINDOWS }]]);
          expect(signals).toEqual([]);
        } else {
          expect(signals).toEqual([-FAKE_PID]);
          expect(harness.calls).toHaveLength(1);
        }
        // (b) no exit observed: the run settles after exactly the confirm wait, killConfirmed false
        harness.calls.length = 0;
        const silent = fakeChild(FAKE_PID);
        harness.fake = (call) => (call.command.endsWith("taskkill.exe") ? fakeKiller() : silent);
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        let settled: unknown = null;
        const pending = runKicadCli({ cliPath: "kicad-cli-b24-d2-fake", args: ["pcb"], timeoutMs: 20 }).then((value) => { settled = value; });
        await vi.advanceTimersByTimeAsync(20);
        await vi.advanceTimersByTimeAsync(TREE_KILL_CONFIRM_MS - 1);
        expect(settled, `${platform}: still waiting for the exit`).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(settled, platform).toMatchObject({ ok: false, error: "timeout", killConfirmed: false });
        vi.useRealTimers();
        vi.restoreAllMocks();
      });
    }
  });

  it("5. FreeRouting on timeout and on abort: the tree kill on this host, killConfirmed true once `close` is observed, its temporary files present while the kill is in flight and removed only after the run settles", { timeout: 60_000 }, async () => {
    const { runFreerouting } = await import("@/app/lib/pcb/autoroute/runner");
    vi.stubEnv("SystemRoot", WINDOWS);
    const signals: number[] = [];
    vi.spyOn(process, "kill").mockImplementation(((pid: number) => { signals.push(pid); return true; }) as typeof process.kill);
    for (const how of ["timeout", "cancelled"] as const) {
      harness.calls.length = 0;
      signals.length = 0;
      const child = fakeChild(FAKE_PID);
      const controller = new AbortController();
      let inFlight: boolean[] = [];
      harness.fake = (call) => {
        if (!call.command.endsWith("taskkill.exe")) return child;
        return fakeKiller();
      };
      const pending = runFreerouting({ dsnText: "(pcb b24d2)", freeroutingJarPath: process.execPath, javaPath: "java-b24-d2-fake", timeoutMs: how === "timeout" ? 20 : 60_000, signal: controller.signal });
      const files = await vi.waitFor(() => {
        const java = harness.calls.find((call) => call.command === "java-b24-d2-fake");
        if (!java) throw new Error("not spawned yet");
        return [java.args[java.args.indexOf("-de") + 1]!, java.args[java.args.indexOf("-do") + 1]!];
      }, { timeout: 5_000, interval: 2 });
      expect(fs.existsSync(files[0]!), "the input is written before the run").toBe(true);
      if (how === "cancelled") controller.abort();
      await vi.waitFor(() => {
        const killed = process.platform === "win32" ? harness.calls.some((call) => call.command.endsWith("taskkill.exe")) : signals.includes(-FAKE_PID);
        if (!killed) throw new Error("not killed yet");
      }, { timeout: 5_000, interval: 2 });
      inFlight = [fs.existsSync(files[0]!)];
      child.emit("close", null);
      const result = await pending;
      expect(result, how).toMatchObject({ ok: false, error: how, processStatus: how, killConfirmed: true });
      expect(inFlight, `${how}: the input file is still there while the kill is in flight`).toEqual([true]);
      expect(files.map((file) => fs.existsSync(file)), `${how}: removed only after the run settled`).toEqual([false, false]);
      expect(harness.calls[0]!.options.detached).toBe(process.platform !== "win32");
      expect(child.kill, how).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 0);
    }
  });

  it("6. the sources: neither runner calls child.kill directly, each passes its own spawn to the helper and spawns detached except on win32; the helper names no process module", () => {
    const helper = READ("app/lib/pcb/process-tree.ts");
    expect(helper).not.toMatch(/child_process|worker_threads|node:cluster|from "vm"|from "module"|require\(/);
    expect([...helper.matchAll(/^import [^;]+ from "([^"]+)";$/gm)].map((match) => match[1])).toEqual(["node:path"]);
    for (const runner of ["app/lib/pcb/autoroute/runner.ts", "app/lib/pcb/fab/kicad-cli-runner.ts"]) {
      const source = READ(runner);
      expect(source, runner).not.toContain('child.kill("SIGKILL")');
      expect(source.match(/killProcessTree\(child, place, \(\) => !closed, spawn\)/g)?.length ?? 0, runner).toBeGreaterThan(0);
      expect(source, runner).toContain("detached: !place.win32");
      expect(source, runner).toContain("treeKillPlace(process.platform, process.env.SystemRoot)");
    }
  });

  it("7. one REAL process tree (node, no Java, no kicad-cli): runKicadCli with cliPath process.execPath starts a child that starts a grandchild; both are alive before the timeout, and after the result both are gone within the confirm wait", { timeout: 60_000 }, async () => {
    const { runKicadCli } = await import("@/app/lib/pcb/fab/kicad-cli-runner");
    const { TREE_KILL_CONFIRM_MS } = await import("@/app/lib/pcb/process-tree");
    const scratch = fs.mkdtempSync(join(tmpdir(), "sirkit-b24-d2-proc-"));
    scratchRoots.push(scratch);
    const write = ["write", "File", "Sync"].join("");
    // the child: start a grandchild that only waits, record both pids in the working directory (the scratch root), then wait. On win32
    // the grandchild is started detached: a node child's children sit in libuv's kill-on-close job object and die with it whatever kills
    // it (measured at 3d5f225: the direct kill alone ended them), while a Java or kicad-cli grandchild has no such job - detached, only
    // taskkill /T reaches it. On POSIX it stays in the child's process group (detached it would leave the group the kill names).
    const script = [
      `const { spawn } = require("child_process");`,
      `const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true, detached: process.platform === "win32" });`,
      `require("fs")["${write}"]("pids.json", JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));`,
      `setInterval(() => {}, 1000);`,
    ].join(" ");
    const pending = runKicadCli({ cliPath: process.execPath, args: ["-e", script], timeoutMs: 8_000, cwd: scratch });
    const pids = await vi.waitFor(() => JSON.parse(fs.readFileSync(join(scratch, "pids.json"), "utf8")) as { child: number; grandchild: number }, { timeout: 7_000, interval: 50 });
    survivors.push(pids.child, pids.grandchild);
    // the positive control: the tree is really there before the kill, or nothing below is measured
    if (!alive(pids.child) || !alive(pids.grandchild)) throw new Error(`NOT MEASURED: the child (${alive(pids.child)}) or the grandchild (${alive(pids.grandchild)}) was not alive before the timeout`);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: "timeout" });
    await vi.waitFor(() => { if (alive(pids.child) || alive(pids.grandchild)) throw new Error(`alive: child ${alive(pids.child)}, grandchild ${alive(pids.grandchild)}`); }, { timeout: 5_000, interval: 50 }); // the confirm wait, as a literal the threshold census reads (TREE_KILL_CONFIRM_MS, asserted below)
    expect([alive(pids.child), alive(pids.grandchild)]).toEqual([false, false]);
    for (const pid of [pids.child, pids.grandchild]) survivors.splice(survivors.indexOf(pid), 1); // [B24-D2 review, 2026-10-09] confirmed gone: struck off
    expect(TREE_KILL_CONFIRM_MS).toBe(5_000);
    expect(result).toMatchObject({ killConfirmed: true });
    console.info(`[B24-D2] the real tree on ${process.platform}: child ${pids.child} and grandchild ${pids.grandchild} gone after the ${process.platform === "win32" ? "taskkill /T" : "process-group"} kill; killConfirmed ${String((result as { killConfirmed?: boolean }).killConfirmed)}`);
    expect(survivors, "[B24-D2 review] both confirmed gone: afterAll is left no pid to kill (a freed pid may already be another process's)").toEqual([]);
  });

  it("8. an unconfirmed kill is reported beyond the runner: FreeRouting's pass evidence (the route's pass executor and the production router) and kicad-cli's bundle error carry killConfirmed; a run that was not killed carries none", { timeout: 60_000 }, async () => {
    const runs: Array<Record<string, unknown>> = [
      { ok: false, error: "timeout", stderr: "", elapsedMs: 5, processStatus: "timeout", outputFileStatus: "not-checked", killConfirmed: false },
      { ok: false, error: "cancelled", stderr: "", elapsedMs: 5, processStatus: "cancelled", outputFileStatus: "not-checked", killConfirmed: true },
      { ok: false, error: "exit-nonzero", stderr: "", elapsedMs: 5, processStatus: "exit-nonzero", outputFileStatus: "not-checked", exitCode: 1 },
    ];
    let next: Record<string, unknown> = runs[0]!;
    let started = 0;
    vi.resetModules();
    vi.doMock("@/app/lib/pcb/autoroute/runner", () => ({ runFreerouting: async () => { started += 1; return next; } }));
    vi.doMock("@/app/lib/pcb/autoroute/runtime", () => ({ resolveFreeroutingRuntime: async () => ({ ok: true, jarPath: "freerouting-b24-d2-fake.jar", javaPath: "java-b24-d2-fake", version: "2.2.4", jarSource: "environment", javaSource: "environment" }) }));
    try {
      // one import at a time: concurrent cold imports of one graph right after resetModules can wait on each other for ever
      const { createFreeroutingPassExecutor } = await import("@/app/lib/pcb/autoroute/freerouting-pass-executor");
      const { createAutonomousRouteExecutor } = await import("@/app/lib/pcb/autonomous/production-router");
      const { pcbRevisionId } = await import("@/app/lib/pcb/revision");
      const { getPreset } = await import("@/app/lib/pcb/drc/presets");
      const { ensureBoardPadstacks } = await import("@/app/lib/pcb/padstack/migrate");
      const fixture = JSON.parse(READ("e2e/fixtures/blinker-route-fixture.json")) as { entries: Record<string, { candidate: import("@/app/lib/pcb/types").PcbBoard }> };
      const board = JSON.parse(JSON.stringify(Object.values(fixture.entries)[0]!.candidate)) as import("@/app/lib/pcb/types").PcbBoard;
      ensureBoardPadstacks(board);
      board.tracks = board.tracks.filter((track) => track.source !== "autorouter" && track.source !== "ai");
      board.vias = board.vias.filter((via) => via.source !== "autorouter" && via.source !== "ai");
      // (a) the route's pass executor
      const runtimeInfo = { ok: true, jarPath: "freerouting-b24-d2-fake.jar", javaPath: "java-b24-d2-fake", version: "2.2.4", jarSource: "environment", javaSource: "environment" } as const;
      const pass = { board, routeAttemptId: "ra-b24-d2-kill", requestedSourceRevision: pcbRevisionId(board), passIndex: 0, engineMaxPasses: 10, effort: "high" as const };
      for (const run of runs) {
        next = run;
        const before = started;
        const executor = createFreeroutingPassExecutor({ runtimeInfo, deadline: Date.now() + 60_000, signal: new AbortController().signal });
        const output = await executor(pass);
        expect(started, `${String(run.error)}: the (mocked) runner was reached`).toBe(before + 1);
        if ("killConfirmed" in run) expect.soft(output.evidence, `pass executor, ${String(run.error)}`).toMatchObject({ processStatus: run.processStatus, killConfirmed: run.killConfirmed });
        else expect.soft(output.evidence, `pass executor, ${String(run.error)}`).not.toHaveProperty("killConfirmed");
      }
      // (b) the production router (qualify): every attempt record of a pass whose kill was not confirmed says so
      next = runs[0]!;
      const route = await createAutonomousRouteExecutor({ maxGlobalPasses: 1, maxSelectedNetRetries: 0, maxNoImprovementPasses: 1 });
      const execution = await route({ board, candidateId: "b24d2kill", rules: getPreset("jlcpcb-2l").rules, timeoutMs: 30_000 });
      expect(execution.completion.attempts.length).toBeGreaterThan(0);
      for (const attempt of execution.completion.attempts) expect.soft(attempt.evidence, `production router, ${attempt.routeAttemptId}`).toMatchObject({ processStatus: "timeout", killConfirmed: false });
    } finally {
      vi.doUnmock("@/app/lib/pcb/autoroute/runner");
      vi.doUnmock("@/app/lib/pcb/autoroute/runtime");
      vi.resetModules();
    }
    // (c) kicad-cli: the bundle error carries the runner's answer (the route's answer is pinned in gerbers/__tests__/route.test.ts)
    const { buildFabBundle } = await import("@/app/lib/pcb/fab/build-bundle");
    const { getFabPreset } = await import("@/app/lib/pcb/fab/presets");
    const { getPreset } = await import("@/app/lib/pcb/drc/presets");
    const { createEmptyBoard } = await import("@/app/lib/pcb/types");
    for (const killConfirmed of [false, true]) {
      const timedOut = async () => ({ ok: false as const, error: "timeout" as const, stderr: "", elapsedMs: 1, killConfirmed });
      await expect.soft(buildFabBundle({ board: createEmptyBoard(), netlist: { components: [], nets: [] }, fabPreset: getFabPreset("jlcpcb-2l"), drcPreset: getPreset("jlcpcb-2l"), boardName: "b24-d2-kill" }, { runner: timedOut, cliPath: "kicad-cli-b24-d2-fake" })).rejects.toMatchObject({ name: "KicadCliError", kind: "timeout", killConfirmed });
    }
    const failed = async () => ({ ok: false as const, error: "exit-nonzero" as const, stderr: "", elapsedMs: 1 });
    const error = await buildFabBundle({ board: createEmptyBoard(), netlist: { components: [], nets: [] }, fabPreset: getFabPreset("jlcpcb-2l"), drcPreset: getPreset("jlcpcb-2l"), boardName: "b24-d2-kill" }, { runner: failed, cliPath: "kicad-cli-b24-d2-fake" }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "KicadCliError", kind: "cli-failed" });
    expect((error as { killConfirmed?: boolean }).killConfirmed).toBeUndefined();
  });
});
