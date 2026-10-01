/**
 * [B22-A3] The diagnostic-only local runner (discovery D22-5 profile env, D22-8, D22-9, D22-11 runtime; OD-135, OD-136, OD-145).
 *
 * One module starts ngspice and it EXECUTES the B22-A2 profile `ngspice-local-diagnostic`: the pinned install (two server
 * settings, its install-tree digest checked before every spawn, cached with a stat fingerprint), the profile's argv with `-n`,
 * EXACTLY the profile's environment, a per-run `mkdtemp` directory removed on every path, output within A1's bound, the raw file
 * read back bounded, a tree kill on the wall clock and on abort, terminal only after the child's close (or `kill_unconfirmed`),
 * one global cap, no host path in a record, and every result labelled `diagnostic_only` and `environment_dependent`. The three
 * entry points (the worker's run and `-v` probe, `/api/simulate`, the smoke test) reach ngspice only through it.
 *
 * Test-first: run RED on c037627 with the runner absent (the module drafted first was moved aside for the red run; recorded in
 * `diagnostic-runner.md`). ngspice is NOT executed: `node:child_process` is a scripted in-process fake (a fake child may carry a
 * pid, so the tree kill's argv is observable), the run directories and the raw file live in an in-memory `node:fs/promises`
 * fake, and the install is a temporary fake tree (`_pinned-ngspice.ts`) whose stand-in executable is never run. The opt-in live
 * suite (`b22-a3-runner-live`) is the lead's.
 *
 * [B22-A3 review, 2026-10-01] The review's confirmed findings are pinned inside the existing cases (the case count stays fourteen),
 * each run RED on the reviewed tree first: a queued wait is bounded and the cap is shared fairly by holder (regressions-1,
 * coverage-3, security-2: cases 1, 4, 10, 13); the raw file's digest is kept (regressions-3: 13, 14); a deck that sets its own
 * seed is refused and the seed is recorded (regressions-4: 1, 3, 12, 13); the variables Node adds to a win32 child are recorded,
 * never claimed absent (security-1: 2, 12, 14); a settled run reaches no callback and a terminal Studio record is never reopened
 * (security-3: 8); the runner's own fs failures are closed, and host paths are redacted across pipe reads and the output cut
 * (security-4, coverage-2, coverage-4, tests-5, tests-7: 9, 11, 13); every entry point's outcome and refusal mapping (coverage-1,
 * tests-2, tests-3: 13); a looser caller bound is held to the profile's (tests-1: 5, 8); FIFO within a holder (tests-6: 10); an
 * abort during the pin check (tests-10: 4); the fixture helper's confinement (tests-8: 9); the stale records and the live case's
 * evidence (coverage-5, coverage-8, tests-4: 14).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeScript {
  stdout?: string | ((call: SpawnCall) => string);
  /** [B22-A3 review] stdout as separate pipe reads, in order. */
  chunks?: (call: SpawnCall) => string[];
  stderr?: string;
  code?: number | null;
  hang?: boolean;
  pid?: number;
  closeOnKill?: boolean;
  error?: { code: string } | null;
  raw?: Buffer | null;
}
interface SpawnCall { command: string; args: string[]; options: Record<string, unknown> }
interface FakeChild {
  pid?: number;
  kills: string[];
  close(code: number | null): void;
  closed: boolean;
  call: SpawnCall;
  stdout: { emit(event: string, ...args: unknown[]): boolean };
}

const proc = vi.hoisted(() => ({
  calls: [] as SpawnCall[],
  children: [] as FakeChild[],
  script: [] as FakeScript[],
  version: "ngspice-46 : Circuit level simulation program (b22-a3 fake)\n",
  taskkillEndsTree: false,
}));
const fsState = vi.hoisted(() => ({
  counter: 0,
  dirs: [] as string[],
  removed: [] as string[],
  writes: [] as Array<{ path: string; content: string; options: unknown }>,
  files: new Map<string, Buffer>(),
  declared: new Map<string, number>(),
  opens: [] as string[],
  reads: 0,
  failWrite: false,
  failMkdtemp: false,
  onLstat: null as null | (() => void),
}));

vi.mock("node:child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { EventEmitter } = await import("node:events");
  const { join: joinPath } = await import("node:path");
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: Record<string, unknown> = {}) => {
      const call: SpawnCall = { command, args: [...args], options: { ...options } };
      proc.calls.push(call);
      const child = new EventEmitter() as InstanceType<typeof EventEmitter> & FakeChild & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>; kill: (signal?: string) => boolean };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kills = [];
      child.closed = false;
      child.call = call;
      child.close = (code: number | null) => {
        if (child.closed) return;
        child.closed = true;
        child.emit("close", code);
      };
      if (/taskkill/i.test(command)) {
        queueMicrotask(() => {
          if (proc.taskkillEndsTree) proc.children.find((candidate) => String(candidate.pid) === args[1])?.close(1);
          child.close(0);
        });
        return child;
      }
      // [B22-A3 review] a -v probe takes no script (it prints proc.version), so a script always reaches the run it was pushed for
      const script: FakeScript = args.includes("-v") ? {} : proc.script.shift() ?? {};
      child.pid = script.pid;
      child.kill = (signal?: string) => {
        child.kills.push(signal ?? "SIGTERM");
        if (script.closeOnKill) queueMicrotask(() => child.close(null));
        return true;
      };
      proc.children.push(child);
      queueMicrotask(() => {
        if (script.error) {
          child.emit("error", Object.assign(new Error("spawn"), script.error));
          return;
        }
        const stdout = args.includes("-v") ? proc.version : typeof script.stdout === "function" ? script.stdout(call) : script.stdout ?? "";
        if (stdout) child.stdout.emit("data", Buffer.from(stdout));
        for (const piece of script.chunks?.(call) ?? []) child.stdout.emit("data", Buffer.from(piece));
        if (script.stderr) child.stderr.emit("data", Buffer.from(script.stderr));
        if (script.raw) fsState.files.set(joinPath(String(options.cwd), "result.raw"), script.raw);
        if (!script.hang) child.close(script.code ?? 0);
      });
      return child;
    },
  };
});
vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return {
    ...actual,
    mkdir: async () => undefined,
    mkdtemp: async (prefix: string) => {
      // [B22-A3 review] coverage-2, tests-5: Node's own message, which names the absolute path
      if (fsState.failMkdtemp) throw Object.assign(new Error(`ENOSPC: no space left on device, mkdtemp '${prefix}XXXXXX'`), { code: "ENOSPC", syscall: "mkdtemp", path: `${prefix}XXXXXX` });
      fsState.counter += 1;
      const dir = `${prefix}${fsState.counter}`;
      fsState.dirs.push(dir);
      return dir;
    },
    writeFile: async (path: string, content: string, options?: unknown) => {
      if (fsState.failWrite) throw Object.assign(new Error(`EACCES: permission denied, open '${String(path)}'`), { code: "EACCES", syscall: "open", path: String(path) });
      fsState.writes.push({ path: String(path), content: String(content), options });
    },
    rm: async (path: string) => {
      fsState.removed.push(String(path));
    },
    // [B22-A3 review] tests-10: a hook into the pin check's stat walk (the real lstat answers)
    lstat: async (...args: unknown[]) => {
      fsState.onLstat?.();
      return (actual.lstat as (...values: unknown[]) => Promise<unknown>)(...args);
    },
    open: async (path: string) => {
      fsState.opens.push(String(path));
      const bytes = fsState.files.get(String(path));
      if (bytes === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      let offset = 0;
      return {
        stat: async () => ({ size: fsState.declared.get(String(path)) ?? bytes.length }),
        read: async (buffer: Buffer, at: number, length: number) => {
          fsState.reads += 1;
          const slice = bytes.subarray(offset, Math.min(offset + length, bytes.length));
          slice.copy(buffer, at);
          offset += slice.length;
          return { bytesRead: slice.length, buffer };
        },
        close: async () => {},
      };
    },
  };
});

import { createFakeNgspiceInstall, FAKE_SYSTEM_ROOT, linkedCopyOfFakeInstall, pinFakeNgspiceInstall, removeFakeTree, replaceFakeInstallFile, pinFakeNgspiceForSuite, type FakeNgspiceInstall } from "./_pinned-ngspice";
import * as runner from "@/app/lib/computation/diagnostic-runner";
import { runtimeProfile } from "@/app/lib/computation/runtime-profile";
import { DIAGNOSTIC_OUTPUT_MAX_BYTES, OUTPUT_TRUNCATION_MARKER } from "@/app/lib/computation/output-bounds";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { createSimulationProject } from "@/app/lib/spice/project";
import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import { importModelText } from "@/app/lib/spice/models";
import { __resetJobStoreForTests, cancelRun, getRun, startRunPlan } from "@/app/lib/spice/server/job-store";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";

const installOf = pinFakeNgspiceForSuite();
const NEWLINE = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const RUNNER_ROOT = join(tmpdir(), "sirkit-ngspice-runs");
const TASKKILL = [FAKE_SYSTEM_ROOT, "System32", "taskkill.exe"].join(BACKSLASH);
const LABELS = ["diagnostic_only", "environment_dependent"];
/** [B22-A3 review] security-1: the variables libuv copies from the server into a win32 child whose environment lacks them. */
const HOST_ADDED = ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "SYSTEMDRIVE", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"];
const BUSY = "NGSPICE_DIAGNOSTIC_BUSY";
const DECK = ["* b22-a3 deck", "R1 1 0 1k", "V1 1 0 1", ".op", ".end", ""].join(NEWLINE);
const seeded = (): string => runner.seedDiagnosticDeck(DECK);
const deckNamed = (name: string): string => runner.seedDiagnosticDeck([`* ${name}`, "R1 1 0 1k", "V1 1 0 1", ".op", ".end", ""].join(NEWLINE));
const ngspiceCalls = (): SpawnCall[] => proc.calls.filter((call) => !/taskkill/i.test(call.command));
const taskkillCalls = (): SpawnCall[] => proc.calls.filter((call) => /taskkill/i.test(call.command));
const childOf = (call: SpawnCall): FakeChild => proc.children.find((child) => child.call === call)!;
const spawnedPid = (pid: number): boolean => proc.children.some((child) => child.pid === pid);
const killedPid = (pid: number): boolean => taskkillCalls().some((call) => call.args[1] === String(pid));
const deckOf = (call: SpawnCall): string | undefined => fsState.writes.find((write) => write.path === join(String(call.options.cwd), "deck.cir"))?.content;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, label: string, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(2);
  }
}
/** The closed refusal a promise rejects with, or "resolved". */
async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string } | "resolved"> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    expect(error).toBeInstanceOf(runner.DiagnosticRunnerError);
    return { code: (error as InstanceType<typeof runner.DiagnosticRunnerError>).code, message: (error as Error).message };
  }
}
const run = (extra: Partial<Extract<Parameters<typeof runner.runDiagnosticNgspice>[0], { operation: "run" }>> = {}) =>
  runner.runDiagnosticNgspice({ operation: "run", deck: seeded(), readRaw: false, ...extra });
const RAW = ["Title: b22-a3", "Plotname: Operating Point", "Flags: real", "No. Variables: 1", "No. Points: 1", "Variables:", "  0 v(1) voltage", "Values:", "0 1", ""].join(NEWLINE);
/** The divider project with one operating-point analysis. */
function opProject() {
  const project = createSimulationProject(dividerSchematic());
  const test = project.tests[0]!;
  test.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
  test.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
  return project;
}
/** [B22-A3 review] Fake setTimeout/clearTimeout that also follow real time, so a case can jump the runner's 5 s and 10 s waits. */
function withFakeTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
}

afterEach(async () => {
  vi.useRealTimers();
  // every fake child still open is closed, so no slot leaks into the next case
  for (const child of proc.children) child.close(null);
  await until(() => runner.diagnosticRunnerState().running === 0 && runner.diagnosticRunnerState().queued === 0, "the runner to drain");
  __resetJobStoreForTests();
  proc.calls = [];
  proc.children = [];
  proc.script = [];
  proc.taskkillEndsTree = false;
  Object.assign(fsState, { counter: fsState.counter, dirs: [], removed: [], writes: [], opens: [], reads: 0, failWrite: false, failMkdtemp: false, onLstat: null });
  fsState.files.clear();
  fsState.declared.clear();
  resetInjectedIdentity();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("[B22-A3] the runner executes the ngspice-local-diagnostic profile", () => {
  it("1. pins its profile, names, bounds and labels: argv from the templates with -n, the exact environment, no legacy spawn; the seed option precedes the deck's final .end", () => {
    expect(runner.DIAGNOSTIC_RUNNER_PROFILE_ID).toBe("ngspice-local-diagnostic");
    expect([...runner.DIAGNOSTIC_RESULT_LABELS]).toEqual(LABELS);
    expect(Object.isFrozen(runner.DIAGNOSTIC_RESULT_LABELS)).toBe(true);
    expect({ deck: runner.DIAGNOSTIC_DECK_FILE, raw: runner.DIAGNOSTIC_RAW_OUTPUT_FILE, root: runner.DIAGNOSTIC_RUNNER_ROOT_NAME }).toEqual({ deck: "deck.cir", raw: "result.raw", root: "sirkit-ngspice-runs" });
    expect({ running: runner.DIAGNOSTIC_RUNNER_MAX_RUNNING, queued: runner.DIAGNOSTIC_RUNNER_MAX_QUEUED, confirm: runner.DIAGNOSTIC_KILL_CONFIRM_MS, version: runner.DIAGNOSTIC_VERSION_WALL_CLOCK_MS }).toEqual({ running: 4, queued: 64, confirm: 5_000, version: 2_000 });
    const profile = runtimeProfile("ngspice-local-diagnostic", () => undefined);
    expect(profile.argvTemplates).toEqual({ run: ["-b", "-n", "{deckFile}"], version: ["-n", "-v"] });
    expect(profile.environment).toEqual({ LC_ALL: "C", TZ: "UTC", PATH: "{installBinDir}", SystemRoot: "{systemRoot}", TEMP: "{runDir}", TMP: "{runDir}" });
    expect(profile.legacySpawn, "every ngspice spawn site executes the profile through the runner").toBeNull();
    expect(profile.determinism.seed).toMatchObject({ value: "1", pinnedBy: "deck-option" });
    expect(runner.seedDiagnosticDeck(DECK)).toBe(["* b22-a3 deck", "R1 1 0 1k", "V1 1 0 1", ".op", ".options seed=1", ".end", ""].join(NEWLINE));
    expect(runner.seedDiagnosticDeck(["t", ".control", "run", ".endc", ".END"].join(NEWLINE))).toBe(["t", ".control", "run", ".endc", ".options seed=1", ".END"].join(NEWLINE));
    for (const deck of ["* no end", ".end", ["t", ".end", "R1 1 0 1"].join(NEWLINE)]) expect(() => runner.seedDiagnosticDeck(deck), deck).toThrow(/^NGSPICE_DIAGNOSTIC_DECK_REFUSED: /);
    // [B22-A3 review] security-2, regressions-1: one holder (the caller's tenant) never holds every slot or fills the queue, and no
    // wait outlasts a full queue drained by slots each held one profile wall clock plus the kill-confirm wait
    expect({ perHolderRunning: runner.DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER, perHolderQueued: runner.DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER, queueWait: runner.DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS }).toEqual({ perHolderRunning: 3, perHolderQueued: 32, queueWait: 2_000_000 });
    expect(runner.DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER).toBeLessThan(runner.DIAGNOSTIC_RUNNER_MAX_RUNNING);
    expect(runner.DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER).toBeLessThan(runner.DIAGNOSTIC_RUNNER_MAX_QUEUED);
    expect(runner.DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS).toBe((runner.DIAGNOSTIC_RUNNER_MAX_QUEUED / runner.DIAGNOSTIC_RUNNER_MAX_RUNNING) * (profile.limits.wallClockMs.value! + runner.DIAGNOSTIC_KILL_CONFIRM_MS));
    // [B22-A3 review] regressions-4: the profile's seed is the only one; a deck that sets its own (an option line or its + continuation,
    // any case or spacing) is refused, never silently overridden; a comment naming a seed and an option line naming none are admitted
    for (const lines of [[".options seed=42"], [".option rndseed=3"], [".OPT reltol=1e-3 SEED = 7"], [".options reltol=1e-3", "+ seed=9"], [".options seed=1"]]) {
      expect(() => runner.seedDiagnosticDeck(["* t", ...lines, "R1 1 0 1k", ".op", ".end"].join(NEWLINE)), lines.join(" / ")).toThrow(/^NGSPICE_DIAGNOSTIC_DECK_REFUSED: .*seed/);
    }
    expect(runner.seedDiagnosticDeck(["* seed=42 in a comment", ".options reltol=1e-3", "R1 1 0 1k", ".op", ".end"].join(NEWLINE)).split(NEWLINE).slice(-2)).toEqual([".options seed=1", ".end"]);
  });

  it("2. a run spawns the pinned executable (never NGSPICE_BIN or PATH) with the profile's argv, EXACTLY the profile's environment (no HOME, USERPROFILE or server secret), a fresh run directory as cwd, windowsHide and no shell; the deck written there is the seeded deck; the -v probe runs the same way in an empty directory", async () => {
    const install = installOf();
    const canaries = [["SIRKIT", "B22A3", "ENV", "CANARY"], ["SIRKIT", "B22A3", "FAKE", "API", "KEY"], ["HOME"], ["USERPROFILE"]].map((parts) => parts.join("_"));
    for (const name of canaries) vi.stubEnv(name, "b22a3-fake-canary");
    vi.stubEnv("NGSPICE_BIN", join(tmpdir(), "b22a3-elsewhere", "ngspice_con.exe"));
    vi.stubEnv("PATH", join(tmpdir(), "b22a3-path"));
    const record = await run();
    expect(record.outcome).toBe("exited");
    const [call] = ngspiceCalls();
    expect(ngspiceCalls()).toHaveLength(1);
    const runDir = String(call!.options.cwd);
    expect(runDir.startsWith(join(RUNNER_ROOT, "run-")), runDir).toBe(true);
    expect(fsState.dirs).toEqual([runDir]);
    expect(call!.command).toBe(install.executable);
    expect(call!.args).toEqual(["-b", "-n", "deck.cir"]);
    expect(call!.options.env).toEqual({ LC_ALL: "C", TZ: "UTC", PATH: install.binDir, SystemRoot: FAKE_SYSTEM_ROOT, TEMP: runDir, TMP: runDir });
    expect({ windowsHide: call!.options.windowsHide, shell: call!.options.shell, stdio: call!.options.stdio, detached: call!.options.detached }).toEqual({ windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: false });
    expect(fsState.writes).toEqual([{ path: join(runDir, "deck.cir"), content: seeded(), options: { encoding: "utf8", flag: "wx" } }]);
    // [B22-A3 review] security-1: on win32 Node (libuv) copies the server's value of every required variable the passed map lacks; the
    // runner passes none of them and records their names on the run (never a value), so no record claims "nothing inherited"
    expect([...runner.WIN32_NODE_REQUIRED_ENV]).toEqual(["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PATH", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"]);
    expect([...record.hostAddedEnvironment]).toEqual(HOST_ADDED);
    for (const name of HOST_ADDED) expect(Object.keys(call!.options.env as object).map((key) => key.toUpperCase()), name).not.toContain(name);
    const version = await runner.diagnosticNgspiceVersion();
    expect(version).toEqual({ version: "ngspice-46 : Circuit level simulation program (b22-a3 fake)", installDigest: `sirkit-install-tree-sha256/1:${install.digest}` });
    const probe = ngspiceCalls()[1]!;
    expect(probe.args).toEqual(["-n", "-v"]);
    expect(probe.command).toBe(install.executable);
    expect(probe.options.env).toEqual({ LC_ALL: "C", TZ: "UTC", PATH: install.binDir, SystemRoot: FAKE_SYSTEM_ROOT, TEMP: probe.options.cwd, TMP: probe.options.cwd });
    expect(String(probe.options.cwd).startsWith(join(RUNNER_ROOT, "run-"))).toBe(true);
    expect(fsState.writes, "the probe's directory holds nothing").toHaveLength(1);
    // probed once per observed install digest: a second call re-checks the pin and spawns nothing
    expect((await runner.diagnosticNgspiceVersion()).version).toBe(version.version);
    expect(ngspiceCalls().filter((candidate) => candidate.args.includes("-v"))).toHaveLength(1);
  });

  it("3. refused before any spawn with a closed error: unpinned (absent or malformed, the value never echoed) naming SIRKIT_NGSPICE_INSTALL_SHA256, no install root naming SIRKIT_NGSPICE_INSTALL_ROOT, a mismatched digest, an install that is not a directory or holds a link, another platform, an unknown Windows directory, a deck that is not seeded", async () => {
    const install = installOf();
    const malformed = ["zz", "not", "a", "digest", "b22a3"].join("-");
    const other = createHash("sha256").update("b22-a3 another install").digest("hex");
    const linked = linkedCopyOfFakeInstall(install);
    const cases: Array<[string, () => void, string, RegExp | null]> = [
      ["the digest setting absent", () => vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", ""), "NGSPICE_DIAGNOSTIC_UNPINNED", /SIRKIT_NGSPICE_INSTALL_SHA256/],
      ["the digest setting malformed", () => vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", malformed), "NGSPICE_DIAGNOSTIC_UNPINNED", /SIRKIT_NGSPICE_INSTALL_SHA256/],
      ["the root setting absent", () => vi.stubEnv("SIRKIT_NGSPICE_INSTALL_ROOT", ""), "NGSPICE_DIAGNOSTIC_INSTALL_ROOT_UNSET", /SIRKIT_NGSPICE_INSTALL_ROOT/],
      ["the root setting relative", () => vi.stubEnv("SIRKIT_NGSPICE_INSTALL_ROOT", "relative/ngspice"), "NGSPICE_DIAGNOSTIC_INSTALL_ROOT_UNSET", /SIRKIT_NGSPICE_INSTALL_ROOT/],
      ["another install's digest", () => vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", other), "NGSPICE_DIAGNOSTIC_DIGEST_MISMATCH", /SIRKIT_NGSPICE_INSTALL_SHA256/],
      ["a root that is a file", () => vi.stubEnv("SIRKIT_NGSPICE_INSTALL_ROOT", install.executable), "NGSPICE_DIAGNOSTIC_INSTALL_UNREADABLE", /INSTALL_TREE_ROOT_NOT_DIRECTORY/],
      ["an install holding a link", () => vi.stubEnv("SIRKIT_NGSPICE_INSTALL_ROOT", linked), "NGSPICE_DIAGNOSTIC_INSTALL_UNREADABLE", /INSTALL_TREE_LINK/],
      ["another platform", () => runner.__setDiagnosticRunnerHostForTests({ platform: () => "linux-x64", systemRoot: () => undefined }), "NGSPICE_DIAGNOSTIC_PLATFORM_UNSUPPORTED", /win32-x64/],
      ["an unknown Windows directory", () => runner.__setDiagnosticRunnerHostForTests({ platform: () => "win32-x64", systemRoot: () => undefined }), "NGSPICE_DIAGNOSTIC_SYSTEM_ROOT_UNKNOWN", null],
    ];
    try {
      for (const [label, arrange, code, names] of cases) {
        pinFakeNgspiceInstall(install);
        arrange();
        for (const attempt of [() => run(), () => runner.diagnosticNgspiceVersion()]) {
          const outcome = await refusal(attempt()); // one at a time: a refusal is awaited as it happens
          expect(outcome, label).toMatchObject({ code });
          if (outcome !== "resolved") {
            if (names) expect(outcome.message, label).toMatch(names);
            for (const secret of [malformed, other, install.root, linked]) expect(outcome.message, label).not.toContain(secret);
          }
        }
      }
      pinFakeNgspiceInstall(install);
      for (const deck of [DECK, `${seeded()}R2 1 0 1k${NEWLINE}`, ["* t", ".options seed=1", ".op", ".end"].join(NEWLINE).replace(".options seed=1", ".options seed=7")]) {
        expect(await refusal(runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: false })), deck).toMatchObject({ code: "NGSPICE_DIAGNOSTIC_DECK_REFUSED" });
      }
      // [B22-A3 review] regressions-4: a deck carrying its own seed option besides the runner's line is refused by the runner too
      for (const own of [".options seed=42", ".option rndseed=3"]) {
        const deck = ["* t", own, "R1 1 0 1k", ".op", ".options seed=1", ".end"].join(NEWLINE);
        expect(await refusal(runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: false })), own).toMatchObject({ code: "NGSPICE_DIAGNOSTIC_DECK_REFUSED", message: expect.stringMatching(/seed/) });
      }
      expect(ngspiceCalls(), "no ngspice process was started").toEqual([]);
      expect(fsState.dirs.every((dir) => fsState.removed.includes(dir)), "every run directory a refusal created was removed").toBe(true);
    } finally {
      removeFakeTree(linked);
    }
  });

  it("4. the install digest is computed once per process and re-checked by a stat fingerprint before every spawn: a second run hashes nothing; a changed file is re-hashed and refused, the restored file re-hashed and admitted; another pinned digest re-hashes", async () => {
    const own: FakeNgspiceInstall = await createFakeNgspiceInstall();
    try {
      pinFakeNgspiceInstall(own);
      runner.__resetDiagnosticRunnerCachesForTests();
      expect((await run()).outcome).toBe("exited");
      expect(runner.diagnosticRunnerState().digestComputations).toBe(1);
      expect((await run()).outcome).toBe("exited");
      expect(runner.diagnosticRunnerState().digestComputations, "the cached digest stands while the fingerprint holds").toBe(1);
      const original = readFileSync(join(own.root, "share", "ngspice", "scripts", "spinit"));
      replaceFakeInstallFile(own, "share/ngspice/scripts/spinit", Buffer.concat([original, Buffer.from("set num_threads=2\n")]));
      expect(await refusal(run())).toMatchObject({ code: "NGSPICE_DIAGNOSTIC_DIGEST_MISMATCH" });
      expect(runner.diagnosticRunnerState().digestComputations).toBe(2);
      replaceFakeInstallFile(own, "share/ngspice/scripts/spinit", original);
      expect((await run()).outcome).toBe("exited");
      expect(runner.diagnosticRunnerState().digestComputations, "the restored file moved the fingerprint, so it was re-hashed").toBe(3);
      vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", createHash("sha256").update("b22-a3 re-pinned").digest("hex"));
      expect(await refusal(run())).toMatchObject({ code: "NGSPICE_DIAGNOSTIC_DIGEST_MISMATCH" });
      expect(runner.diagnosticRunnerState().digestComputations).toBe(4);
      expect(ngspiceCalls()).toHaveLength(3);
      // [B22-A3 review] security-2: the worker's early pin check (outside the cap) is single-flight - concurrent checks share one stat
      // walk, and one digest when the cache is cold
      pinFakeNgspiceInstall(own);
      runner.__resetDiagnosticRunnerCachesForTests();
      const checks = await Promise.all(Array.from({ length: 6 }, () => runner.verifyDiagnosticInstall()));
      expect(new Set(checks)).toEqual(new Set([`sirkit-install-tree-sha256/1:${own.digest}`]));
      expect(runner.diagnosticRunnerState()).toMatchObject({ installChecks: 1, digestComputations: 1 });
      // [B22-A3 review] tests-10: an abort that lands while the slot is held and the pin is being checked ends the run cancelled with
      // nothing spawned (the check still completes: the observed digest is recorded)
      const controller = new AbortController();
      fsState.onLstat = () => {
        fsState.onLstat = null;
        controller.abort();
      };
      const spawned = ngspiceCalls().length;
      expect(await run({ signal: controller.signal })).toMatchObject({ outcome: "cancelled", spawned: false, killReason: null, installDigest: `sirkit-install-tree-sha256/1:${own.digest}` });
      expect(ngspiceCalls()).toHaveLength(spawned);
      expect(taskkillCalls()).toEqual([]);
    } finally {
      removeFakeTree(own.root);
    }
  });

  it("5. stdout and stderr are held within A1's bound with the marker; the raw file is read back bounded after a zero exit only: over the bound refused whole with no read, a caller's tighter bound applied, invalid UTF-8 refused, a missing file missing", async () => {
    const tail = "TAIL-b22a3";
    proc.script.push({ stdout: `${"x".repeat(200_000)}${tail}`, stderr: `${"y".repeat(90_000)}${tail}` });
    const loud = await run();
    for (const text of [loud.stdout, loud.stderr]) {
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(DIAGNOSTIC_OUTPUT_MAX_BYTES);
      expect(text.startsWith(OUTPUT_TRUNCATION_MARKER)).toBe(true);
      expect(text.endsWith(tail)).toBe(true);
    }
    proc.script.push({ raw: Buffer.from(RAW) });
    expect((await run({ readRaw: true })).raw).toEqual({ state: "read", text: RAW });
    proc.script.push({ raw: Buffer.from("x".repeat(11)) });
    expect((await run({ readRaw: true, readBackBytes: 10 })).raw).toEqual({ state: "over-limit" });
    proc.script.push({ raw: Buffer.from("x".repeat(10)) });
    expect((await run({ readRaw: true, readBackBytes: 10 })).raw).toEqual({ state: "read", text: "x".repeat(10) });
    proc.script.push({ raw: Buffer.from([0x50, 0xff, 0xfe]) });
    expect((await run({ readRaw: true })).raw).toEqual({ state: "invalid-utf8" });
    proc.script.push({});
    expect((await run({ readRaw: true })).raw).toEqual({ state: "missing" });
    // a petabyte-declared raw file: refused on the declared size, no content read
    proc.script.push({ stdout: (call) => { fsState.declared.set(join(String(call.options.cwd), "result.raw"), 1e15); return ""; }, raw: Buffer.from("tiny") });
    fsState.reads = 0;
    expect((await run({ readRaw: true })).raw).toEqual({ state: "over-limit" });
    expect(fsState.reads).toBe(0);
    // a non-zero exit is never read back; a run that asks for no raw file reads none
    proc.script.push({ code: 1, raw: Buffer.from(RAW) });
    const opens = fsState.opens.length;
    expect((await run({ readRaw: true })).raw).toEqual({ state: "skipped" });
    proc.script.push({ raw: Buffer.from(RAW) });
    expect((await run()).raw).toEqual({ state: "not-requested" });
    expect(fsState.opens.length).toBe(opens);
    // [B22-A3 review] tests-1: a caller's bound may only be TIGHTER - a looser wall clock is held to the profile's 120 s, and a looser
    // read-back bound to its 100 MiB (a raw file declared one byte over it is refused unread)
    expect((await run({ wallClockMs: 10_000_000 })).wallClockMs).toBe(120_000);
    const profileReadBack = runtimeProfile("ngspice-local-diagnostic").limits.readBackBytes.value!;
    expect(profileReadBack).toBe(100 * 1024 * 1024);
    proc.script.push({ stdout: (call) => { fsState.declared.set(join(String(call.options.cwd), "result.raw"), profileReadBack + 1); return ""; }, raw: Buffer.from("tiny") });
    expect((await run({ readRaw: true, readBackBytes: 2 ** 31 })).raw).toEqual({ state: "over-limit" });
  });

  it("6. the wall clock and an abort end the process tree on win32 with the runner's own fixed taskkill argv; the run is terminal only once the child's close is observed; an abort before the start runs nothing", async () => {
    proc.script.push({ pid: 4242, hang: true });
    let settled = false;
    const timed = run({ wallClockMs: 20 }).then((record) => { settled = true; return record; });
    await until(() => taskkillCalls().length === 1, "the tree kill");
    const [kill] = taskkillCalls();
    expect(kill!.command).toBe(TASKKILL);
    expect(kill!.args).toEqual(["/PID", "4242", "/T", "/F"]);
    expect(kill!.options).toEqual({ env: { SystemRoot: FAKE_SYSTEM_ROOT }, windowsHide: true, shell: false, stdio: "ignore" });
    const child = childOf(ngspiceCalls()[0]!);
    await until(() => child.kills.length > 0, "the direct fallback after taskkill");
    expect(child.kills).toEqual(["SIGKILL"]);
    await sleep(40);
    expect(settled, "never terminal while the child may live").toBe(false);
    child.close(1);
    expect(await timed).toMatchObject({ outcome: "timeout", exitCode: 1, spawned: true, killReason: "timeout" });
    // an abort: taskkill ends the tree and the child's close follows
    proc.taskkillEndsTree = true;
    proc.script.push({ pid: 4343, hang: true });
    const controller = new AbortController();
    const aborted = run({ signal: controller.signal });
    await until(() => ngspiceCalls().length === 2, "the second spawn");
    controller.abort();
    expect(await aborted).toMatchObject({ outcome: "cancelled", exitCode: 1, spawned: true, killReason: "cancelled" });
    expect(taskkillCalls().map((call) => call.args)).toEqual([["/PID", "4242", "/T", "/F"], ["/PID", "4343", "/T", "/F"]]);
    // aborted before the start: no directory, no process, no digest
    const early = new AbortController();
    early.abort();
    const dirs = fsState.dirs.length;
    expect(await run({ signal: early.signal })).toMatchObject({ outcome: "cancelled", spawned: false, installDigest: null, killReason: null });
    expect(fsState.dirs.length).toBe(dirs);
    expect(ngspiceCalls()).toHaveLength(2);
  });

  it("7. the POSIX kill is SIGKILL to the child's process group (the child is spawned detached off Windows), falling back to the child; a child with no pid gets the direct kill only", () => {
    const killed: Array<[number, string | number | undefined]> = [];
    const kill = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => { killed.push([pid, signal]); return true; }) as typeof process.kill);
    const fake = (pid: number | undefined) => ({ pid, kills: [] as string[], kill(signal?: string) { this.kills.push(signal ?? "SIGTERM"); return true; } });
    const leader = fake(777);
    runner.killDiagnosticProcessTree(leader as never, { win32: false, systemRoot: "" }, () => true);
    expect(killed).toEqual([[-777, "SIGKILL"]]);
    expect(leader.kills).toEqual([]);
    kill.mockImplementation((() => { throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }); }) as typeof process.kill);
    const orphan = fake(778);
    runner.killDiagnosticProcessTree(orphan as never, { win32: false, systemRoot: "" }, () => true);
    expect(orphan.kills).toEqual(["SIGKILL"]);
    const unstarted = fake(undefined);
    runner.killDiagnosticProcessTree(unstarted as never, { win32: true, systemRoot: FAKE_SYSTEM_ROOT }, () => true);
    expect(unstarted.kills).toEqual(["SIGKILL"]);
    expect(taskkillCalls()).toEqual([]);
    const source = readFileSync(join(process.cwd(), "app/lib/computation/diagnostic-runner.ts"), "utf8");
    expect(source).toContain("detached: !input.place.win32");
    expect(source).toContain('process.kill(-pid, "SIGKILL")');
  });

  it("8. kill_unconfirmed: a child that does not close after the tree kill is reported kill_unconfirmed after the bounded wait, never cancelled; its slot stays held until its close, and its run directory is removed again then", async () => {
    proc.script.push({ pid: 5150, hang: true });
    const chunks: string[] = [];
    const record = await run({ wallClockMs: 20, killConfirmMs: 30, onOutput: (_channel, chunk) => chunks.push(chunk) });
    expect(record).toMatchObject({ outcome: "kill_unconfirmed", exitCode: null, spawned: true, killReason: "timeout" });
    const runDir = String(ngspiceCalls()[0]!.options.cwd);
    expect(runner.diagnosticRunnerState().running, "the process may live: its slot is held").toBe(1);
    expect(fsState.removed.filter((dir) => dir === runDir)).toHaveLength(1);
    // [B22-A3 review] security-3: what the surviving child prints after the record settled reaches no callback (the Studio worker
    // turned each chunk into a "running" event)
    childOf(ngspiceCalls()[0]!).stdout.emit("data", Buffer.from("ngspice still printing after kill_unconfirmed\n"));
    await sleep(5);
    expect(chunks).toEqual([]);
    childOf(ngspiceCalls()[0]!).close(null);
    await until(() => runner.diagnosticRunnerState().running === 0, "the late close to release the slot");
    await until(() => fsState.removed.filter((dir) => dir === runDir).length === 2, "the second removal");
    // [B22-A3 review] coverage-1: an abort whose close is not observed is kill_unconfirmed too, and the record keeps its cause
    proc.script.push({ pid: 5151, hang: true });
    const controller = new AbortController();
    const stopped = run({ signal: controller.signal, killConfirmMs: 30 });
    await until(() => spawnedPid(5151), "the fourth spawn");
    controller.abort();
    expect(await stopped).toMatchObject({ outcome: "kill_unconfirmed", killReason: "cancelled", spawned: true });
    // [B22-A3 review] tests-1: a looser kill-confirm wait is held to DIAGNOSTIC_KILL_CONFIRM_MS
    withFakeTimers();
    proc.script.push({ pid: 5152, hang: true });
    let settled = false;
    const held = run({ wallClockMs: 10, killConfirmMs: 10_000_000 }).then((value) => { settled = true; return value; });
    await until(() => killedPid(5152), "the tree kill of 5152");
    await vi.advanceTimersByTimeAsync(runner.DIAGNOSTIC_KILL_CONFIRM_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled, "settled at the default kill-confirm wait").toBe(true);
    expect(await held).toMatchObject({ outcome: "kill_unconfirmed", killReason: "timeout" });
    vi.useRealTimers();
    // [B22-A3 review] security-3: the job store never reopens a terminal Studio record - output after a cancel (the process may
    // still live during the bounded wait) adds no event and leaves the record cancelled
    const project = opProject();
    const scope = { tenantId: "t-b22a3", projectId: "p-b22a3", branchId: "main" };
    proc.script.push({ pid: 5153, hang: true });
    const batch = startRunPlan({ scope, project, runPlanId: project.runPlans[0]!.id, parts: [] });
    const runId = batch.runIds[0]!;
    await until(() => spawnedPid(5153), "the Studio run's spawn");
    expect(cancelRun(runId, scope)).toBe(true);
    await until(() => killedPid(5153), "the cancel's tree kill");
    const events = getRun(runId, scope)!.events.length;
    proc.children.find((candidate) => candidate.pid === 5153)!.stdout.emit("data", Buffer.from("ngspice still printing after the cancel\n"));
    await sleep(5);
    const after = getRun(runId, scope)!;
    expect({ status: after.status, events: after.events.length, last: after.events.at(-1)?.status }).toEqual({ status: "cancelled", events, last: "cancelled" });
  });

  it("9. every run directory is removed on every path - success, a non-zero exit, timeout, abort, a refusal after the directory exists, a spawn error, a failed deck write - and the runner writes nothing but the deck, inside its own root", async () => {
    proc.taskkillEndsTree = true;
    await run();
    proc.script.push({ code: 1 });
    await run();
    proc.script.push({ pid: 61, hang: true });
    await run({ wallClockMs: 10 });
    const controller = new AbortController();
    proc.script.push({ pid: 62, hang: true });
    const aborted = run({ signal: controller.signal });
    await until(() => ngspiceCalls().length === 4, "the fourth spawn");
    controller.abort();
    expect((await aborted).outcome).toBe("cancelled");
    vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", createHash("sha256").update("b22-a3 cleanup").digest("hex"));
    expect(await refusal(run())).toMatchObject({ code: "NGSPICE_DIAGNOSTIC_DIGEST_MISMATCH" });
    pinFakeNgspiceInstall(installOf());
    proc.script.push({ error: { code: "ENOENT" } });
    expect(await run()).toMatchObject({ outcome: "spawn_failed", spawned: false });
    // [B22-A3 review] coverage-2, tests-5, security-4: the runner's own fs failures (Node names the absolute path) are refused with a
    // closed code and the errno only - no host path reaches a record or a response
    fsState.failWrite = true;
    const unwritable = await refusal(run());
    fsState.failWrite = false;
    fsState.failMkdtemp = true;
    const full = await refusal(run());
    fsState.failMkdtemp = false;
    expect(unwritable).toMatchObject({ code: "NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED", message: expect.stringMatching(/EACCES/) });
    expect(full).toMatchObject({ code: "NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED", message: expect.stringMatching(/ENOSPC/) });
    for (const outcome of [unwritable, full]) for (const path of [tmpdir(), RUNNER_ROOT, tmpdir().split(BACKSLASH).join("/")]) expect(JSON.stringify(outcome), path).not.toContain(JSON.stringify(path).slice(1, -1));
    expect(fsState.dirs).toHaveLength(7);
    expect(fsState.dirs.filter((dir) => !fsState.removed.includes(dir)), "a run directory left behind").toEqual([]);
    expect(fsState.dirs.every((dir) => dir.startsWith(join(RUNNER_ROOT, "run-")))).toBe(true);
    expect(fsState.writes.every((write) => write.path.endsWith(`${sep}deck.cir`) && fsState.dirs.some((dir) => write.path === join(dir, "deck.cir")))).toBe(true);
    // [B22-A3 review] tests-8: the suite's own fixture writes live in `_pinned-ngspice.ts`, which the B11.5 write gate (it scans
    // *.test.ts only) never reads: every write primitive there takes its path through `confined(`, which refuses anything outside the
    // OS temporary directory before any write (checked on a path whose folder does not exist, so a missing guard writes nothing)
    const helper = readFileSync(join(process.cwd(), "app/lib/computation/__tests__/_pinned-ngspice.ts"), "utf8");
    const primitives = /\b(?:writeFileSync|mkdirSync|mkdtempSync|cpSync|symlinkSync|rmSync|renameSync|copyFileSync|linkSync)\(/;
    const writes = helper.split(NEWLINE).filter((line) => primitives.test(line) && !/^\s*(?:import|\*|\/\/)/.test(line));
    expect(writes.length).toBeGreaterThanOrEqual(8);
    // [B22-A3 lead] the check's new issue: a copy, link or rename names TWO paths, and both must be confined - each call's top-level
    // arguments are read (parentheses, brackets, braces and quotes balanced), its path arguments by position
    const TWO_PATHS = new Set(["cpSync", "symlinkSync", "renameSync", "copyFileSync", "linkSync"]);
    const topLevelArgs = (text: string, open: number): string[] => {
      const args: string[] = [];
      let depth = 0;
      let quote = "";
      let start = open + 1;
      for (let index = open + 1; index < text.length; index += 1) {
        const character = text[index]!;
        if (quote !== "") { if (character === quote && text[index - 1] !== "\\") quote = ""; continue; }
        if (character === '"' || character === "'" || character === "`") quote = character;
        else if ("([{".includes(character)) depth += 1;
        else if (")]}".includes(character)) {
          if (depth === 0) { args.push(text.slice(start, index).trim()); return args; }
          depth -= 1;
        } else if (character === "," && depth === 0) { args.push(text.slice(start, index).trim()); start = index + 1; }
      }
      return args;
    };
    const unconfined = (line: string): string[] => [...line.matchAll(/\b(writeFileSync|mkdirSync|mkdtempSync|cpSync|symlinkSync|rmSync|renameSync|copyFileSync|linkSync)\(/g)].flatMap((match) => {
      const args = topLevelArgs(line, match.index! + match[0].length - 1);
      return args.slice(0, TWO_PATHS.has(match[1]!) ? 2 : 1).filter((arg) => !arg.startsWith("confined("));
    });
    for (const line of writes) expect(unconfined(line), line.trim()).toEqual([]);
    expect(unconfined('cpSync(confined(install.root), join(process.cwd(), "app", "b22a3-copy"), { recursive: true });')).not.toEqual([]);
    expect(unconfined('symlinkSync(confined(join(copy, "x")), join(process.cwd(), "b22a3-link"), "junction");')).not.toEqual([]);
    const outside = { ...installOf(), root: join(process.cwd(), `b22a3-no-such-folder-${fsState.counter}`) };
    expect(() => replaceFakeInstallFile(outside, "bin/x", Buffer.from("x"))).toThrow(/outside the OS temporary directory/);
  });

  it("10. one global cap across entry points, shared fairly by holder: four ngspice processes at once and at most three per holder, waiters granted FIFO within a holder with the fewest-running holder first, an abort while queued cancelled with no spawn, every wait bounded (by default the request's own wall clock) and then refused NGSPICE_DIAGNOSTIC_BUSY, and a holder over its queue share or any request over the queue bound refused BUSY at once", async () => {
    runner.__resetDiagnosticRunnerCachesForTests(); // the probe must not be answered from the version cache
    const [A, B] = ["tenant-a", "tenant-b"];
    // three of tenant A run; its next requests wait although a slot is free (security-2: one holder never takes every slot)
    for (let index = 0; index < 3; index += 1) proc.script.push({ pid: 900 + index, hang: true });
    const aRunning = Array.from({ length: 3 }, () => run({ holder: A }));
    await until(() => ngspiceCalls().length === 3, "three spawns");
    const aFirst = run({ holder: A, deck: deckNamed("a-first") });
    const aSecond = run({ holder: A, deck: deckNamed("a-second") });
    await until(() => runner.diagnosticRunnerState().queued === 2, "two of A waiting");
    await sleep(10);
    expect(ngspiceCalls(), "a slot is free, but A holds its share").toHaveLength(3);
    // tenant B takes the free slot at once (its script first, then A's first waiter's)
    proc.script.push({ pid: 903, hang: true }, { pid: 904, hang: true });
    const bRunning = run({ holder: B });
    await until(() => ngspiceCalls().length === 4, "B's run in the free slot");
    // B's version probe and an aborted request of B queue too; the abort ends it cancelled with no spawn
    const probe = runner.diagnosticNgspiceVersion({ holder: B, queueWaitMs: 60_000 });
    const controller = new AbortController();
    const queued = run({ holder: B, signal: controller.signal });
    await until(() => runner.diagnosticRunnerState().queued === 4, "four waiting");
    controller.abort();
    expect(await queued).toMatchObject({ outcome: "cancelled", spawned: false });
    expect(runner.diagnosticRunnerState()).toMatchObject({ running: 4, queued: 3 });
    // one of A's runs ends: B (one running) goes before A (two running), although A's waiters came first
    childOf(ngspiceCalls()[0]!).close(0);
    await until(() => ngspiceCalls().length === 5, "the probe to start");
    expect(ngspiceCalls()[4]!.args).toEqual(["-n", "-v"]);
    expect((await probe).version).toMatch(/ngspice-46/);
    // the probe ended: A's waiters are granted in the order they came (tests-6: FIFO within a holder)
    await until(() => ngspiceCalls().length === 6, "A's first waiter");
    expect(deckOf(ngspiceCalls()[5]!)).toContain("* a-first");
    // regressions-1, coverage-3: a request that names no signal waits at most its wall clock, then is refused BUSY with nothing run
    const dirs = fsState.dirs.length;
    const started = Date.now();
    const bounded = await refusal(run({ holder: B, wallClockMs: 40 }));
    expect(bounded).toMatchObject({ code: BUSY, message: expect.stringMatching(/40 ms/) });
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect({ spawns: ngspiceCalls().length, dirs: fsState.dirs.length }).toEqual({ spawns: 6, dirs });
    // security-2: a holder over its queue share is refused at once while another holder still queues; the queue bound refuses anyone
    const waiting = new AbortController();
    const aBacklog = Array.from({ length: runner.DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER - 1 }, () => run({ holder: A, signal: waiting.signal }));
    await until(() => runner.diagnosticRunnerState().queued === runner.DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER, "A's queue share full");
    expect(await refusal(run({ holder: A, signal: waiting.signal }))).toMatchObject({ code: BUSY });
    const bBacklog = Array.from({ length: runner.DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER }, () => run({ holder: B, signal: waiting.signal }));
    await until(() => runner.diagnosticRunnerState().queued === runner.DIAGNOSTIC_RUNNER_MAX_QUEUED, "a full queue");
    expect(await refusal(run({ holder: "tenant-c", signal: waiting.signal }))).toMatchObject({ code: BUSY });
    waiting.abort();
    expect((await Promise.all([...aBacklog, ...bBacklog])).every((record) => record.outcome === "cancelled" && !record.spawned)).toBe(true);
    for (const child of proc.children) child.close(0);
    await until(() => ngspiceCalls().length === 7, "A's second waiter");
    for (const child of proc.children) child.close(0);
    expect((await Promise.all([...aRunning, aFirst, aSecond, bRunning])).map((record) => record.outcome)).toEqual(["exited", "exited", "exited", "exited", "exited", "exited"]);
    expect(deckOf(ngspiceCalls()[6]!)).toContain("* a-second");
    expect(ngspiceCalls()).toHaveLength(7);
    // [B22-A3 lead] the check's new issue: a holder at its running share (one tenant's Studio plan) still gets the free slot for an
    // INTERACTIVE request - a person waiting on /api/simulate or a smoke test, bounded by its own short wall clock - while its batch
    // requests keep waiting for their share
    for (let index = 0; index < 4; index += 1) proc.script.push({ pid: 950 + index, hang: true });
    const aBatch = Array.from({ length: 3 }, () => run({ holder: A }));
    await until(() => ngspiceCalls().length === 10, "A's three batch runs");
    const aMore = run({ holder: A, deck: deckNamed("a-more") });
    await until(() => runner.diagnosticRunnerState().queued === 1, "A's fourth batch run waiting");
    const aInteractive = run({ holder: A, interactive: true, deck: deckNamed("a-interactive") });
    await until(() => ngspiceCalls().length === 11, "A's interactive run in the free slot");
    expect(deckOf(ngspiceCalls()[10]!)).toContain("* a-interactive");
    expect(runner.diagnosticRunnerState()).toMatchObject({ running: 4, queued: 1 });
    for (const child of proc.children) child.close(0);
    expect((await Promise.all([...aBatch, aInteractive, aMore])).map((record) => record.outcome)).toEqual(["exited", "exited", "exited", "exited", "exited"]);
    expect(deckOf(ngspiceCalls()[11]!)).toContain("* a-more");
  });

  it("11. no absolute host path in a record: the run id is opaque; output naming the run directory or the install root (either slash) is redacted; nothing is called a sandbox or authoritative", async () => {
    const install = installOf();
    proc.script.push({ stdout: (call) => `reading ${String(call.options.cwd)}${sep}deck.cir${NEWLINE}init ${install.root}${sep}share${NEWLINE}also ${install.root.split(BACKSLASH).join("/")}/bin${NEWLINE}`, stderr: "" });
    const chunks: string[] = [];
    const record = await run({ onOutput: (_channel, chunk) => chunks.push(chunk) });
    expect(record.runId).toMatch(/^diagrun_[0-9a-f-]{36}$/);
    expect(record.stdout).toContain(`{runDir}${sep}deck.cir`);
    expect(record.stdout).toContain(`{installRoot}${sep}share`);
    expect(record.stdout).toContain("{installRoot}/bin");
    // the record's own strings, as they are (a JSON text would double every backslash and hide a Windows path)
    const text = [record.runId, record.stdout, record.stderr, record.installDigest, record.profileDigest, JSON.stringify(record.raw), ...chunks].join(NEWLINE);
    for (const path of [String(ngspiceCalls()[0]!.options.cwd), install.root, install.root.split(BACKSLASH).join("/"), RUNNER_ROOT, tmpdir()]) expect(text, path).not.toContain(path);
    expect(JSON.stringify(record)).not.toMatch(/sandbox|authoritative/i);
    // [B22-A3 review] security-4, coverage-4, tests-7: a path split across pipe reads (here every read is seven characters, so every
    // path is split, both slashes) is still redacted in every streamed chunk and in the record; a trailing fragment of a path is
    // replaced too; and what the streamed chunks carry is exactly what the record keeps
    const slashed = install.root.split(BACKSLASH).join("/");
    const name = basename(install.root);
    chunks.length = 0;
    proc.script.push({ chunks: (call) => (`reading ${String(call.options.cwd)}${sep}deck.cir${NEWLINE}init ${install.root}${sep}share${NEWLINE}also ${slashed}/bin and ${install.root}${NEWLINE}trailing ${install.root.slice(0, -3)}`.match(/[\s\S]{1,7}/g) ?? []) });
    const split = await run({ onOutput: (_channel, chunk) => chunks.push(chunk) });
    expect(split.stdout).toBe(`reading {runDir}${sep}deck.cir${NEWLINE}init {installRoot}${sep}share${NEWLINE}also {installRoot}/bin and {installRoot}${NEWLINE}trailing {installRoot}`);
    expect(chunks.join("")).toBe(split.stdout);
    for (const piece of [...chunks, split.stdout]) for (const path of [tmpdir(), install.root, slashed, name]) expect(piece, path).not.toContain(path);
    // a path cut by the output bound: the kept tail would begin inside the install root and keep its last folder's name
    const kept = DIAGNOSTIC_OUTPUT_MAX_BYTES - Buffer.byteLength(OUTPUT_TRUNCATION_MARKER);
    proc.script.push({ stdout: `${"p".repeat(1_000)}${install.root}${"f".repeat(kept - name.length)}` });
    const cut = await run();
    expect(cut.stdout.startsWith(OUTPUT_TRUNCATION_MARKER)).toBe(true);
    expect(cut.stdout).not.toContain(name);
    expect(cut.stdout).not.toContain(name.slice(0, 12));
  });

  it("12. every record is labelled diagnostic_only and environment_dependent with the profile id, the profile digest and the observed install digest (null only when nothing ran)", async () => {
    const install = installOf();
    const profile = runtimeProfile("ngspice-local-diagnostic");
    proc.taskkillEndsTree = true;
    const records = [await run()];
    proc.script.push({ code: 3 });
    records.push(await run());
    proc.script.push({ pid: 71, hang: true });
    records.push(await run({ wallClockMs: 10 }));
    proc.taskkillEndsTree = false;
    proc.script.push({ pid: 72, hang: true });
    records.push(await run({ wallClockMs: 10, killConfirmMs: 10 }));
    proc.script.push({ error: { code: "ENOENT" } });
    records.push(await run());
    const early = new AbortController();
    early.abort();
    records.push(await run({ signal: early.signal }));
    expect(records.map((record) => record.outcome)).toEqual(["exited", "exited", "timeout", "kill_unconfirmed", "spawn_failed", "cancelled"]);
    // [B22-A3 review] coverage-1: the record keeps why the runner killed the tree (null when it killed nothing)
    expect(records.map((record) => record.killReason)).toEqual([null, null, "timeout", "timeout", null, null]);
    for (const record of records) {
      expect([...record.labels]).toEqual(LABELS);
      expect({ profileId: record.profileId, profileDigest: record.profileDigest }).toEqual({ profileId: "ngspice-local-diagnostic", profileDigest: profile.deterministicDigest });
      expect([...record.hostAddedEnvironment]).toEqual(HOST_ADDED);
      expect(Object.isFrozen(record)).toBe(true);
    }
    expect(records.slice(0, 5).every((record) => record.installDigest === `sirkit-install-tree-sha256/1:${install.digest}`)).toBe(true);
    expect(records[5]!.installDigest).toBeNull();
    // [B22-A3 review] regressions-4, security-1: the provenance names the effective seed (the profile's; a deck with its own is refused)
    // and the variables Node adds on win32
    expect(runner.diagnosticProvenance(records[0]!)).toEqual({ profileId: "ngspice-local-diagnostic", installDigest: `sirkit-install-tree-sha256/1:${install.digest}`, labels: LABELS, seed: "1", hostAddedEnvironment: HOST_ADDED });
  });

  it("13. the three entry points reach ngspice only through the runner: the worker's run and -v probe, /api/simulate and the smoke test each spawn the pinned executable with the profile's argv and exact environment; the worker records the opaque run id and the provenance, and the deck it records is the deck it ran", async () => {
    const install = installOf();
    runner.__resetDiagnosticRunnerCachesForTests(); // the worker's -v probe must run, not be answered from the version cache
    const exact = (call: SpawnCall) => ({ LC_ALL: "C", TZ: "UTC", PATH: install.binDir, SystemRoot: FAKE_SYSTEM_ROOT, TEMP: call.options.cwd, TMP: call.options.cwd });
    const provenance = { profileId: "ngspice-local-diagnostic", installDigest: `sirkit-install-tree-sha256/1:${install.digest}`, labels: LABELS, seed: "1", hostAddedEnvironment: HOST_ADDED };
    // the worker
    const { executeRunPoint } = await import("@/app/lib/spice/server/worker");
    const project = opProject();
    const planId = project.runPlans[0]!.id;
    const point = estimateRunPlan(project, planId).runPoints[0]!;
    const runPoint = (extra: Partial<Parameters<typeof executeRunPoint>[0]> = {}) => executeRunPoint({ runId: "run-b22a3", project, runPlanId: planId, runPoint: point, parts: [], signal: new AbortController().signal, onEvent: () => {}, ...extra });
    proc.script.push({ raw: Buffer.from(RAW) });
    const result = await runPoint();
    const workerCalls = ngspiceCalls();
    expect(workerCalls.map((call) => call.args)).toEqual([["-n", "-v"], ["-b", "-n", "deck.cir"]]);
    for (const call of workerCalls) {
      expect(call.command).toBe(install.executable);
      expect(call.options.env).toEqual(exact(call));
    }
    expect(result.artifactId).toMatch(/^diagrun_[0-9a-f-]{36}$/);
    expect(result.manifest?.simulator).toMatchObject({ name: "ngspice", runner: provenance });
    const written = fsState.writes.find((write) => write.path.endsWith(`${sep}deck.cir`))!;
    expect(result.netlist?.executed).toBe(written.content);
    expect(written.content.split(NEWLINE).slice(-3)).toEqual([".options seed=1", ".end", ""]);
    // [B22-A3 review] regressions-3: the raw file is not kept (its run directory is removed), but its SHA-256 and size are, as read
    expect(result.status).toBe("completed");
    expect(result.manifest?.rawOutput).toEqual({ sha256: createHash("sha256").update(RAW).digest("hex"), bytes: Buffer.byteLength(RAW) });
    // [B22-A3 review] coverage-1, tests-2, tests-3: the worker's mapping of every other outcome and refusal
    proc.script.push({ error: { code: "ENOENT" } });
    await expect(runPoint()).rejects.toThrow("ngspice could not be started from the pinned install");
    fsState.failWrite = true;
    const unwritable = await runPoint().then(() => null, (error: Error) => error.message);
    fsState.failWrite = false;
    expect(unwritable).toMatch(/^NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED: .*EACCES/);
    expect(unwritable).not.toContain(tmpdir());
    vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", "");
    const preparing: string[] = [];
    const spawnsBefore = ngspiceCalls().length;
    await expect(runPoint({ onEvent: (event) => preparing.push(event.status) })).rejects.toThrow(/^NGSPICE_DIAGNOSTIC_UNPINNED: .*SIRKIT_NGSPICE_INSTALL_SHA256/);
    expect(preparing, "refused before anything is compiled").toEqual(["preparing"]);
    expect(ngspiceCalls()).toHaveLength(spawnsBefore);
    // ... and through the job store: the Studio record fails with the closed text, nothing spawned
    const scope = { tenantId: "t-b22a3", projectId: "p-b22a3", branchId: "main" };
    const studio = startRunPlan({ scope, project, runPlanId: planId, parts: [] }).runIds[0]!;
    await until(() => Boolean(getRun(studio, scope)?.finishedAt), "the Studio record to settle");
    expect(getRun(studio, scope)).toMatchObject({ status: "failed", error: expect.stringMatching(/^NGSPICE_DIAGNOSTIC_UNPINNED: .*SIRKIT_NGSPICE_INSTALL_SHA256/) });
    expect(ngspiceCalls()).toHaveLength(spawnsBefore);
    pinFakeNgspiceInstall(install);
    // /api/simulate
    proc.calls = [];
    const { POST: simulatePost } = await import("@/app/api/simulate/route");
    const selector = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "local", "x-sirkit-branch-id": "local" };
    const state = {
      components: [
        { id: "v1", type: "voltage-source", value: "5", position: { x: 100, y: 100 }, rotation: 0, refDes: "V1" },
        { id: "r1", type: "resistor", value: "1k", position: { x: 130, y: 70 }, rotation: 0, refDes: "R1" },
        { id: "g1", type: "ground", value: "", position: { x: 100, y: 180 }, rotation: 0, refDes: "" },
      ],
      wires: [{ id: "w1", vertices: [{ x: 100, y: 130 }, { x: 100, y: 160 }] }, { id: "w2", vertices: [{ x: 160, y: 70 }, { x: 160, y: 160 }, { x: 100, y: 160 }] }],
      netLabels: [],
    };
    const simulate = async (signal?: AbortSignal) => {
      injectAuthorizedPrincipal({ userId: "u-b22a3", tenantId: "local", projectId: "local", role: "editor" });
      const response = await simulatePost(new Request("http://localhost/api/simulate", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...selector }, body: JSON.stringify({ state }), signal }));
      return { status: response.status, body: await response.json() as { ok?: boolean; runner?: unknown; netlist?: string; error?: string } };
    };
    proc.script.push({ raw: Buffer.from(["Plotname: Transient Analysis", "Flags: real", "No. Variables: 2", "Variables:", " 0 time time", " 1 v(out) voltage", "Values:", "0 0 1.0", "1 1e-3 2.0"].join(NEWLINE)) });
    const simulated = await simulate();
    expect(simulated.status).toBe(200);
    expect(simulated.body.runner).toEqual(provenance);
    expect(ngspiceCalls().map((call) => call.args)).toEqual([["-b", "-n", "deck.cir"]]);
    expect(ngspiceCalls()[0]!.options.env).toEqual(exact(ngspiceCalls()[0]!));
    expect(simulated.body.netlist?.split(NEWLINE).slice(-2)).toEqual([".options seed=1", ".end"]);
    // [B22-A3 review] tests-3: a refusal before any process is 503 with the closed text (the setting named, no value, no path)
    vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", "");
    const unpinned = await simulate();
    expect(unpinned.status).toBe(503);
    expect(unpinned.body.error).toMatch(/^NGSPICE_DIAGNOSTIC_UNPINNED: .*SIRKIT_NGSPICE_INSTALL_SHA256/);
    expect(unpinned.body.error).not.toContain(install.root);
    pinFakeNgspiceInstall(install);
    fsState.failMkdtemp = true;
    const noDirectory = await simulate();
    fsState.failMkdtemp = false;
    expect(noDirectory).toMatchObject({ status: 503, body: { error: expect.stringMatching(/^NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED: .*ENOSPC/) } });
    expect(noDirectory.body.error).not.toContain(tmpdir());
    proc.script.push({ error: { code: "ENOENT" } });
    expect(await simulate()).toMatchObject({ status: 500, body: { error: "ngspice could not be started from the pinned install" } });
    // [B22-A3 review] coverage-1, tests-2: cancelled only once the close is observed; a kill whose close never comes names kill_unconfirmed
    proc.taskkillEndsTree = true;
    proc.script.push({ pid: 1402, hang: true });
    const abortSimulate = new AbortController();
    const cancelledSimulate = simulate(abortSimulate.signal);
    await until(() => spawnedPid(1402), "the simulate spawn 1402");
    abortSimulate.abort();
    expect(await cancelledSimulate).toMatchObject({ status: 500, body: { ok: false, error: "Simulation cancelled" } });
    proc.taskkillEndsTree = false;
    withFakeTimers();
    proc.script.push({ pid: 1401, hang: true });
    const slow = simulate();
    await until(() => spawnedPid(1401), "the simulate spawn 1401");
    await vi.advanceTimersByTimeAsync(10_000);
    await until(() => killedPid(1401), "the wall clock's tree kill");
    await vi.advanceTimersByTimeAsync(runner.DIAGNOSTIC_KILL_CONFIRM_MS);
    expect(await slow).toMatchObject({ status: 504, body: { error: expect.stringMatching(/^Simulation timed out; .*\(kill_unconfirmed\)$/) } });
    proc.script.push({ pid: 1403, hang: true });
    const abortUnconfirmed = new AbortController();
    const unconfirmed = simulate(abortUnconfirmed.signal);
    await until(() => spawnedPid(1403), "the simulate spawn 1403");
    abortUnconfirmed.abort();
    await until(() => killedPid(1403), "the abort's tree kill");
    await vi.advanceTimersByTimeAsync(runner.DIAGNOSTIC_KILL_CONFIRM_MS);
    expect(await unconfirmed).toMatchObject({ status: 500, body: { ok: false, error: expect.stringMatching(/^Simulation cancelled; .*\(kill_unconfirmed\)$/) } });
    // the worker: a kill_unconfirmed run is failed, naming it and its cause, never cancelled
    proc.script.push({ pid: 1301, hang: true });
    const workerTimedOut = runPoint({ limits: { timeoutMs: 20 } });
    await until(() => killedPid(1301), "the worker run's tree kill");
    await vi.advanceTimersByTimeAsync(runner.DIAGNOSTIC_KILL_CONFIRM_MS);
    expect(await workerTimedOut).toMatchObject({ status: "failed", error: expect.stringMatching(/kill_unconfirmed.*wall clock/) });
    const abortWorker = new AbortController();
    proc.script.push({ pid: 1302, hang: true });
    const workerCancelled = runPoint({ signal: abortWorker.signal });
    await until(() => spawnedPid(1302), "the worker spawn 1302");
    abortWorker.abort();
    await until(() => killedPid(1302), "the worker abort's tree kill");
    await vi.advanceTimersByTimeAsync(runner.DIAGNOSTIC_KILL_CONFIRM_MS);
    expect(await workerCancelled).toMatchObject({ status: "failed", error: expect.stringMatching(/kill_unconfirmed.*cancel/) });
    vi.useRealTimers();
    for (const child of proc.children) child.close(null);
    await until(() => runner.diagnosticRunnerState().running === 0, "the unconfirmed runs to release their slots");
    // the smoke test
    proc.calls = [];
    const { POST: smokePost } = await import("@/app/api/spice/models/smoke-test/route");
    const model = importModelText("dtest.lib", ".model DTEST D(IS=1e-14)\n").candidate;
    const smoke = async (signal?: AbortSignal) => {
      injectAuthorizedPrincipal({ userId: "u-b22a3", tenantId: "local", projectId: "local", role: "editor" });
      const response = await smokePost(new Request("http://localhost/api/spice/models/smoke-test", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...selector }, body: JSON.stringify({ model }), signal }));
      return { status: response.status, body: await response.json() as { ok?: boolean; runner?: unknown; error?: string; check?: { message?: string } } };
    };
    const smoked = await smoke();
    expect({ status: smoked.status, ok: smoked.body.ok }).toEqual({ status: 200, ok: true });
    expect(smoked.body.runner).toEqual(provenance);
    expect(ngspiceCalls().map((call) => call.args)).toEqual([["-b", "-n", "deck.cir"]]);
    expect(ngspiceCalls()[0]!.command).toBe(install.executable);
    // [B22-A3 review] tests-3, coverage-2: a refusal and the runner's own fs failure are the route's closed 422, with no path
    vi.stubEnv("SIRKIT_NGSPICE_INSTALL_SHA256", "");
    expect(await smoke()).toMatchObject({ status: 422, body: { ok: false, error: expect.stringMatching(/^NGSPICE_DIAGNOSTIC_UNPINNED: .*SIRKIT_NGSPICE_INSTALL_SHA256/) } });
    pinFakeNgspiceInstall(install);
    fsState.failWrite = true;
    const smokeUnwritable = await smoke();
    fsState.failWrite = false;
    expect(smokeUnwritable).toMatchObject({ status: 422, body: { error: expect.stringMatching(/^NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED: .*EACCES/) } });
    expect(smokeUnwritable.body.error).not.toContain(tmpdir());
    // [B22-A3 review] security-2, regressions-1: the request's abort reaches the runner (exposeAbortSignal): the tree kill names its pid
    proc.taskkillEndsTree = true;
    proc.script.push({ pid: 1501, hang: true });
    const abortSmoke = new AbortController();
    const cancelledSmoke = smoke(abortSmoke.signal);
    await until(() => spawnedPid(1501), "the smoke spawn 1501");
    abortSmoke.abort();
    expect(await cancelledSmoke).toMatchObject({ status: 422, body: { ok: false, check: { message: "Smoke test cancelled." } } });
    expect(killedPid(1501)).toBe(true);
    // every entry point passes its server-derived tenant as the holder; the Studio worker waits up to the runner's longest wait
    const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");
    expect(read("app/api/simulate/route.ts")).toContain("holder: context.tenantId");
    const smokeSource = read("app/api/spice/models/smoke-test/route.ts");
    expect(smokeSource).toContain("holder: context.tenantId");
    expect(smokeSource).toMatch(/exposeAbortSignal: true/);
    expect(read("app/lib/spice/server/job-store.ts")).toContain("holder: job.scope.tenantId");
    const workerSource = read("app/lib/spice/server/worker.ts");
    expect(workerSource.match(/queueWaitMs: DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS/g)).toHaveLength(2);
    expect(workerSource.match(/holder: input\.holder/g)).toHaveLength(2);
    // [B22-A3 lead] the two requests a person waits on are interactive (they take a free slot past their holder's share); the Studio
    // worker's points and probe are not
    expect(read("app/api/simulate/route.ts")).toContain("holder: context.tenantId, interactive: true");
    expect(smokeSource).toContain("holder: context.tenantId, interactive: true");
    expect(workerSource).not.toContain("interactive");
  });

  it("14. diagnostic-runner.md states the constants, the settings, how the owner pins the install, each B22-A bullet's enforcement and the stated limits, and calls nothing that runs a sandbox", () => {
    const page = readFileSync(join(process.cwd(), "artifacts/ai-control-plane-b22/diagnostic-runner.md"), "utf8");
    expect(page.startsWith("# B22-A3 - ")).toBe(true);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN"]) expect(page, label).toContain(`**${label}**`);
    for (const text of ["SIRKIT_NGSPICE_INSTALL_ROOT", "SIRKIT_NGSPICE_INSTALL_SHA256", "scripts/print-install-tree-digest.ts", "`-n`", "`.options seed=1`", "taskkill /PID <pid> /T /F", "kill_unconfirmed", "diagnostic_only", "environment_dependent", "OD-135", "OD-136", "OD-145"]) expect(page, text).toContain(text);
    for (const [name, value] of [["DIAGNOSTIC_RUNNER_MAX_RUNNING", runner.DIAGNOSTIC_RUNNER_MAX_RUNNING], ["DIAGNOSTIC_RUNNER_MAX_QUEUED", runner.DIAGNOSTIC_RUNNER_MAX_QUEUED], ["DIAGNOSTIC_KILL_CONFIRM_MS", runner.DIAGNOSTIC_KILL_CONFIRM_MS], ["DIAGNOSTIC_VERSION_WALL_CLOCK_MS", runner.DIAGNOSTIC_VERSION_WALL_CLOCK_MS], ["DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER", runner.DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER], ["DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER", runner.DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER], ["DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS", runner.DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS]] as const) expect(page, name).toContain(`\`${name}\` = ${value}`);
    for (const bullet of ["executable", "arguments", "input mount", "output directory", "network", "environment", "cpu", "memory", "processes", "file size", "output", "wall clock", "locale", "seed", "threads", "kill"]) expect(page.toLowerCase(), bullet).toMatch(new RegExp(`^\\| ${bullet} \\| (os|runner|server code|none)`, "m"));
    expect(page).not.toMatch(/\bsandbox(ed)? (is|are|runs?)\b/i);
    // [B22-A3 review] security-1: the page names the variables Node adds on win32 and never claims a child inherits nothing
    for (const name of HOST_ADDED) expect(page, name).toContain(`\`${name}\``);
    expect(page).not.toMatch(/nothing inherited, no HOME or USERPROFILE/);
    // [B22-A3 review] regressions-1, coverage-3: no claim that a wall clock bounds a queued request; the wait is stated
    expect(page).not.toMatch(/its 10 s wall clock bounds it/);
    // [B22-A3 review] coverage-5, tests-4: live case 4 shows only the direct child's close; descendant reach stays INFERRED
    expect(page).not.toMatch(/descendant[^.]*live suite's \(case 4/);
    expect(page).toMatch(/descendant[^.]*\*\*INFERRED\*\*/);
    const live = readFileSync(join(process.cwd(), "app/lib/computation/__tests__/b22-a3-runner-live.test.ts"), "utf8");
    expect(live).toMatch(/it\("4\. [^"]*the direct child[^"]*no descendant/);
    // [B22-A3 review] regressions-3, coverage-8: the Studio docs promise neither a complete bundle nor an engine_missing diagnostic
    const docs = readFileSync(join(process.cwd(), "docs/spice-studio.md"), "utf8");
    for (const stale of ["the complete run bundle", "reproducible ZIP evidence bundle", "engine_missing", "through the same worker used for normal jobs"]) expect(docs, stale).not.toContain(stale);
    expect(docs).toContain("rawOutput");
    const bundle = readFileSync(join(process.cwd(), "app/api/spice/runs/[id]/bundle/route.ts"), "utf8");
    expect(bundle).toContain("rawOutput");
    // [B22-A3 review] coverage-8: the B16.0.24 proofs that described the route's own process and reader carry a dated note, and the
    // threat model's control cells and adversary paragraph no longer state pre-A3 facts as current
    for (const path of ["artifacts/ai-control-plane-b16-0-24/simulate-process-security-proof.md", "artifacts/ai-control-plane-b16-0-24-1/bounded-file-read-proof.md"]) {
      expect(readFileSync(join(process.cwd(), path), "utf8"), path).toMatch(/^## \[SUPERSEDED IN PART - B22-A3, 2026-10-01\]$/m);
    }
    const threat = readFileSync(join(process.cwd(), "artifacts/ai-control-plane-b22/threat-model.md"), "utf8");
    for (const id of ["T4", "T6", "T7", "T9", "T14"]) {
      const row = threat.split(NEWLINE).find((line) => line.startsWith(`| ${id} |`))!;
      expect(row, id).not.toMatch(/today: none|still read whole|today no spawn sets them/);
    }
    expect(threat).toMatch(/\[B22-A3, 2026-10-01\] ngspice is no longer found/);
    for (const path of ["artifacts/ai-control-plane-b16-0-23/simulator-execution-boundary.md", "artifacts/ai-control-plane-b22/runtime-profiles.md"]) {
      const record = readFileSync(join(process.cwd(), path), "utf8");
      expect(record, path).toContain("USERPROFILE");
      expect(record, path).toMatch(/libuv/);
    }
  });
});
