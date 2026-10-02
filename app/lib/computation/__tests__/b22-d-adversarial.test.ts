/**
 * [B22-D] The adversarial matrix, prevention offline (runbook B22-D :936-938: "Test fork bombs, child processes, filesystem escape,
 * symlink/hardlink tricks, device paths, huge output, infinite simulation, malformed binary output, NaN/Inf, locale drift, network
 * attempts, environment-variable exfiltration, signal races, orphan processes, archive traversal and parser differentials."; discovery
 * D22-20, section 7's B22-D items 1-16, 9.4's B22-D bullet). `adversarial-matrix.md` holds the 16 rows x P/L/O: where SEC-1, B22-A1,
 * A3, B or C already pin a prevention, the matrix cites that case by file and name (case 9 checks every citation resolves); this suite
 * adds only what was missing, each case written to fail on a deliberate breakage of its guard (the page records each breakage):
 *
 *  1. the output path: the final deck screen admitted any `write` target its pattern spelled - `../x`, `/dev/null`, `//./pipe/x`,
 *     `NUL`, `CON` (red first); now only a plain relative file inside the run directory (items 3, 5, 11);
 *  2. device and network paths in model text - `\\.\`, `//./`, `\\?\`, `NUL`, `CON`, `COM1`, `CONIN$`, `/dev/*`, `/proc/*`, URLs - in an
 *     include and an XSPICE file parameter, through the model screen and the final screen (items 5, 11; held by B22-A1's rule);
 *  3. a raw file that is not a plain file - a link or junction, a hardlink, a directory, a FIFO, a device - is refused unread at the
 *     runner, `/api/simulate` and the Studio worker (items 4, 5; red first: it was read through);
 *  4. a pre-planted link, junction or file at the runner root runs nothing (item 4; red first: the run directories went through it);
 *  5. a canary in the server environment never reaches the child or any output (item 12; a positive control shows the child's
 *     environment does reach the output, so a leak would be seen);
 *  6. signal races at the runner: every order of exit, abort and wall clock ends in exactly one terminal state (item 13);
 *  7. archives: the SPICE reproducibility bundle writes only its eleven fixed entry names; no named computation reads an archive
 *     (item 15);
 *  8. one corpus of raw files through every parser that exists - the output validator, the Studio worker's parser, `/api/simulate`'s
 *     parser and the circuit-analysis strict reader - with any disagreement failing, and every number they return finite (items 16,
 *     9, 10, 8; red first: the strict reader and the route's complex magnitude disagreed, and duplicate headers and an overflowing
 *     complex magnitude were read);
 *  9. the matrix page; 10. the opt-in live suite is opt-in, benign and confined.
 * [B22-D review] Case 8 also pins the strict reader's own bounds at their edges, a repeated `No. Variables:` header either way and the
 * MSVC indeterminate as non-finite; case 10 reads every live deck line by line (string literals only, a closed command list, no path
 * separator, `~` or redirection, every `write` target a plain relative file, every run's deck a named literal) and requires live case
 * 12's positive control to be asserted; case 3's assertions are soft, so a breakage reports every kind and entry point it lets through.
 *
 * Test-first: run RED on a269e7a (the record is the page's section 4). ngspice is NOT executed: `node:child_process` is a scripted
 * in-process fake, the run directories and the raw file live in an in-memory `node:fs/promises` fake (its `lstat` answers for them,
 * its `mkdir` behaves as Node's over an existing root), and the install is `_pinned-ngspice.ts`'s temporary fake tree. The opt-in live
 * suite (`b22-d-adversarial-live`) is the lead's; the OCI column is BLOCKED-LIVE-QUALIFICATION under LB-10.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface SpawnCall { command: string; args: string[]; options: Record<string, unknown> }
interface Script {
  stdout?: string | ((call: SpawnCall) => string);
  /** Written as `result.raw` in the child's cwd when it runs (at the spawn for a `manual` child). */
  raw?: string | Buffer;
  /** What the fake `lstat` reports for that raw file instead of a plain file. */
  rawKind?: "symlink" | "hardlink" | "directory" | "fifo" | "device";
  code?: number | null;
  hang?: boolean;
  /** The case drives every event itself. */
  manual?: boolean;
  pid?: number;
  closeOnKill?: boolean;
  /** Runs inside the fake spawn, before it returns (the spawn's own tick). */
  onSpawn?: () => void;
}
interface FakeChild {
  pid?: number;
  call: SpawnCall;
  kills: string[];
  closed: boolean;
  close(code: number | null): void;
  emit(event: string, ...args: unknown[]): boolean;
}

const proc = vi.hoisted(() => ({
  calls: [] as SpawnCall[],
  children: [] as FakeChild[],
  script: [] as Script[],
  taskkillEndsTree: true,
}));
const fsState = vi.hoisted(() => ({
  root: "absent" as "absent" | "directory" | "symlink" | "file",
  counter: 0,
  dirs: [] as string[],
  removed: [] as string[],
  writes: [] as Array<{ path: string; content: string; options: unknown }>,
  mkdirs: [] as Array<{ path: string; options: unknown }>,
  lstats: [] as string[],
  opens: [] as string[],
  files: new Map<string, Buffer>(),
  kinds: new Map<string, string>(),
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
          if (proc.taskkillEndsTree) proc.children.find((candidate) => String(candidate.pid) === args[1])?.close(null);
          child.close(0);
        });
        return child;
      }
      const script: Script = args.includes("-v") ? {} : proc.script.shift() ?? {};
      child.pid = script.pid;
      child.kill = (signal?: string) => {
        child.kills.push(signal ?? "SIGTERM");
        if (script.closeOnKill) queueMicrotask(() => child.close(null));
        return true;
      };
      proc.children.push(child);
      const writeRaw = (): void => {
        if (script.raw === undefined) return;
        const path = joinPath(String(options.cwd), "result.raw");
        fsState.files.set(path, Buffer.isBuffer(script.raw) ? script.raw : Buffer.from(script.raw, "utf8"));
        if (script.rawKind) fsState.kinds.set(path, script.rawKind);
      };
      script.onSpawn?.();
      if (script.manual) {
        writeRaw();
        return child;
      }
      queueMicrotask(() => {
        const stdout = args.includes("-v") ? "ngspice-46 : Circuit level simulation program (b22-d fake)\n" : typeof script.stdout === "function" ? script.stdout(call) : script.stdout ?? "";
        if (stdout) child.stdout.emit("data", Buffer.from(stdout));
        writeRaw();
        if (!script.hang) child.close(script.code ?? 0);
      });
      return child;
    },
  };
});
vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { join: joinPath, sep: separator } = await import("node:path");
  const { tmpdir: osTmpdir } = await import("node:os");
  const runnerRoot = joinPath(osTmpdir(), "sirkit-ngspice-runs");
  const missing = (path: string) => Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: "ENOENT", path });
  const statOf = (kind: string, size: number) => ({
    isSymbolicLink: () => kind === "symlink",
    isFile: () => kind === "file" || kind === "hardlink",
    isDirectory: () => kind === "directory",
    isFIFO: () => kind === "fifo",
    isCharacterDevice: () => kind === "device",
    isBlockDevice: () => false,
    isSocket: () => false,
    nlink: kind === "hardlink" ? 2 : 1,
    size,
  });
  return {
    ...actual,
    // Node's mkdir: `recursive` resolves over an existing directory (a link to one included) and throws EEXIST over a file; without it,
    // any existing entry throws EEXIST
    mkdir: async (path: string, options?: unknown) => {
      fsState.mkdirs.push({ path: String(path), options });
      if (String(path) === runnerRoot && fsState.root !== "absent") {
        const recursive = typeof options === "object" && options !== null && (options as { recursive?: unknown }).recursive === true;
        if (recursive && fsState.root !== "file") return undefined;
        throw Object.assign(new Error(`EEXIST: file already exists, mkdir '${String(path)}'`), { code: "EEXIST", path: String(path) });
      }
      return undefined;
    },
    mkdtemp: async (prefix: string) => {
      fsState.counter += 1;
      const dir = `${prefix}${fsState.counter}`;
      fsState.dirs.push(dir);
      return dir;
    },
    writeFile: async (path: string, content: string, options?: unknown) => {
      fsState.writes.push({ path: String(path), content: String(content), options });
    },
    rm: async (path: string) => {
      fsState.removed.push(String(path));
    },
    lstat: async (path: string, ...rest: unknown[]) => {
      const key = String(path);
      fsState.lstats.push(key);
      if (key === runnerRoot) {
        if (fsState.root === "absent") throw missing(key);
        return statOf(fsState.root, 0);
      }
      if (key.startsWith(`${runnerRoot}${separator}`)) {
        const bytes = fsState.files.get(key);
        const kind = fsState.kinds.get(key);
        if (kind !== undefined) return statOf(kind, bytes?.length ?? 0);
        if (bytes !== undefined) return statOf("file", bytes.length);
        throw missing(key);
      }
      return (actual.lstat as (...values: unknown[]) => Promise<unknown>)(path, ...rest);
    },
    open: async (path: string) => {
      const key = String(path);
      fsState.opens.push(key);
      const bytes = fsState.files.get(key);
      if (bytes === undefined) throw missing(key);
      let offset = 0;
      return {
        stat: async () => ({ size: bytes.length }),
        read: async (buffer: Buffer, at: number, length: number) => {
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

import JSZip from "jszip";
import { FAKE_SYSTEM_ROOT, pinFakeNgspiceForSuite } from "./_pinned-ngspice";
import * as runner from "@/app/lib/computation/diagnostic-runner";
import { SimulationOutputError, validateNgspiceAsciiOutput, type SimulationOutputLimits } from "@/app/lib/computation/output-validator";
import { buildCircuitAnalysisDeck, readStrictRaw } from "@/app/lib/computation/request-executors";
import { ARTIFACT_PARSERS } from "@/app/lib/computation/catalog";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as simulatePost } from "@/app/api/simulate/route";
import { POST as smokePost } from "@/app/api/spice/models/smoke-test/route";
import { POST as runsPost } from "@/app/api/spice/runs/route";
import { GET as bundleGet } from "@/app/api/spice/runs/[id]/bundle/route";
import { assertModelSafeForExecution, importModelText } from "@/app/lib/spice/models";
import { assertCompiledDeckSafe, plainRelativeFileName, SpiceDeckSafetyError } from "@/app/lib/spice/netlist";
import { createSimulationProject } from "@/app/lib/spice/project";
import { estimateRunPlan } from "@/app/lib/spice/run-plan";
import { executeRunPoint } from "@/app/lib/spice/server/worker";
import { __resetJobStoreForTests, getRun } from "@/app/lib/spice/server/job-store";
import { parseNgspiceAsciiRaw, type ParsedRawResult } from "@/app/lib/spice/waveforms";
import type { RunEvent, RunRecord } from "@/app/lib/spice/types";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";

pinFakeNgspiceForSuite();
const C = (...codes: number[]): string => String.fromCharCode(...codes);
const NL = C(10);
const TAB = C(9);
const BS = C(92);
const CR = C(13);
const RUNNER_ROOT = join(tmpdir(), "sirkit-ngspice-runs");
const SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-b22d", "x-sirkit-branch-id": "main" };
const SCOPE = { tenantId: "local", projectId: "proj-b22d", branchId: "main" };
const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, label: string, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(2);
  }
}
const ngspiceCalls = (): SpawnCall[] => proc.calls.filter((call) => !/taskkill/i.test(call.command));
const taskkillCalls = (): SpawnCall[] => proc.calls.filter((call) => /taskkill/i.test(call.command));
const childWithPid = (pid: number): FakeChild | undefined => proc.children.find((child) => child.pid === pid);
const killedPid = (pid: number): boolean => taskkillCalls().some((call) => call.args[1] === String(pid));
const rawOpens = (): string[] => fsState.opens.filter((path) => path.endsWith(`${sep}result.raw`));
const DECK = ["* b22-d deck", "V1 in 0 1", "R1 in 0 1k", ".op", ".end", ""].join(NL);
const run = (extra: Partial<Extract<Parameters<typeof runner.runDiagnosticNgspice>[0], { operation: "run" }>> = {}) =>
  runner.runDiagnosticNgspice({ operation: "run", deck: runner.seedDiagnosticDeck(DECK), readRaw: false, ...extra });
/** The refusal a promise rejects with, or "resolved". */
async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string } | "resolved"> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    expect(error).toBeInstanceOf(runner.DiagnosticRunnerError);
    return { code: (error as InstanceType<typeof runner.DiagnosticRunnerError>).code, message: (error as Error).message };
  }
}
/** A deck screen's verdict: accepted, a closed refusal (`SpiceDeckSafetyError`) or another refusal. */
function verdict(screen: () => unknown): "accepted" | "refused (closed)" | "refused" {
  try {
    screen();
    return "accepted";
  } catch (error) {
    return error instanceof SpiceDeckSafetyError ? "refused (closed)" : "refused";
  }
}
const OP_RAW = ["Title: * b22-d", "Plotname: Operating Point", "Flags: real", "No. Variables: 1", "No. Points: 1", "Variables:", `${TAB}0${TAB}v(vin)${TAB}voltage`, "Values:", ` 0${TAB}5.000000000000000e+00`, ""].join(NL);
const SCHEMATIC = {
  components: [
    { id: "v1", type: "voltage-source", value: "5", position: { x: 100, y: 100 }, rotation: 0, refDes: "V1" },
    { id: "r1", type: "resistor", value: "1k", position: { x: 130, y: 70 }, rotation: 0, refDes: "R1" },
    { id: "g1", type: "ground", value: "", position: { x: 100, y: 180 }, rotation: 0, refDes: "" },
  ],
  wires: [{ id: "w1", vertices: [{ x: 100, y: 130 }, { x: 100, y: 160 }] }, { id: "w2", vertices: [{ x: 160, y: 70 }, { x: 160, y: 160 }, { x: 100, y: 160 }] }],
  netLabels: [],
};
function post(path: string, body: unknown): Request {
  injectAuthorizedPrincipal({ userId: "u-b22d", tenantId: "local", projectId: "proj-b22d", role: "editor" });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SELECTOR }, body: JSON.stringify(body) });
}
async function simulate(): Promise<{ status: number; text: string; body: Record<string, unknown> }> {
  const response = await simulatePost(post("/api/simulate", { state: SCHEMATIC }));
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> };
}
/** The divider project with one operating point and one output. */
function opProject() {
  const project = createSimulationProject(dividerSchematic());
  const test = project.tests[0]!;
  test.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
  test.outputs = [{ id: "vin", label: "VIN", expression: "v(VIN)", unit: "V", enabled: true }];
  return project;
}
async function workerRun(): Promise<{ result: Partial<RunRecord>; logs: string[] }> {
  const project = opProject();
  const planId = project.runPlans[0]!.id;
  const point = estimateRunPlan(project, planId).runPoints[0]!;
  const events: Array<Omit<RunEvent, "sequence" | "timestamp">> = [];
  const result = await executeRunPoint({ runId: "run-b22d", project, runPlanId: planId, runPoint: point, parts: [], signal: new AbortController().signal, onEvent: (event) => events.push(event) });
  return { result: result as Partial<RunRecord>, logs: events.map((event) => [event.message, event.log ?? ""].join(NL)) };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const child of proc.children) child.close(null);
  await until(() => runner.diagnosticRunnerState().running === 0 && runner.diagnosticRunnerState().queued === 0, "the runner to drain");
  __resetJobStoreForTests();
  proc.calls = [];
  proc.children = [];
  proc.script = [];
  proc.taskkillEndsTree = true;
  Object.assign(fsState, { root: "absent", dirs: [], removed: [], writes: [], mkdirs: [], lstats: [], opens: [] });
  fsState.files.clear();
  fsState.kinds.clear();
  resetInjectedIdentity();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ─── the corpus (case 8) ─────────────────────────────────────────────────────────────────────────────────────────────────

/** `/api/simulate`'s own bounds (route.ts MAX_PARSE_VARIABLES, MAX_PARSE_POINTS, MAX_PARSE_TOKENS; b22-c-output-validator case 10). */
const ROUTE_LIMITS: Partial<SimulationOutputLimits> = { maxVariables: 10_000, maxPoints: 2_000_000, maxValues: 5_000_000 };
/** The circuit-analysis strict reader's own bounds (request-executors.ts: at most 64 variables and 100,000 points). */
const STRICT_LIMITS: Partial<SimulationOutputLimits> = { maxVariables: 64, maxPoints: 100_000 };
const head = (plot: string, flags: string | null, variables: number, points: number | null, extra: string[] = []): string[] => [
  "Title: * b22-d corpus",
  "Date: Fri Oct  2 12:00:00  2026",
  `Plotname: ${plot}`,
  ...(flags === null ? [] : [`Flags: ${flags}`]),
  `No. Variables: ${variables}`,
  ...(points === null ? [] : [`No. Points: ${points}`]),
  ...extra,
];
const variable = (index: number, name: string, type: string, attributes = ""): string => `${TAB}${index}${TAB}${name}${TAB}${type}${attributes}`;
/** ngspice's ASCII layout: ` <index>` and the first value, then each further value on its own tab-indented line. */
const values = (points: string[][], index: (point: number) => string = String): string[] => points.flatMap((row, point) => [` ${index(point)}${TAB}${row[0]}`, ...row.slice(1).map((value) => `${TAB}${value}`)]);
const raw = (header: string[], variables: string[], body: string[], end = NL): string => [...header, "Variables:", ...variables, "Values:", ...body, ""].join(end);
const TIME = [variable(0, "time", "time"), variable(1, "v(out)", "voltage")];
const TRAN = [["0.000000000000000e+00", "0.000000000000000e+00"], ["1.000000000000000e-03", "6.321205588285577e-01"], ["2.000000000000000e-03", "8.646647167633873e-01"]];
const tranWith = (second: string): string => raw(head("Transient Analysis", "real", 2, 2), TIME, values([["0.000000000000000e+00", "1.000000000000000e+00"], ["1.000000000000000e-03", second]]));
const AC_VARIABLES = (attributes = "") => [variable(0, "frequency", "frequency", attributes), variable(1, "v(out)", "voltage")];
const acWith = (out: string): string => raw(head("AC Analysis", "complex", 2, 1), AC_VARIABLES(), values([["1.591549430918953e+02,0.000000000000000e+00", out]]));
const float64 = (...numbers: number[]): Buffer => Buffer.concat(numbers.map((value) => { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value); return bytes; }));
interface CorpusRow { readonly name: string; readonly bytes: Buffer; readonly expected: "read" | string }
const row = (name: string, text: string | Buffer, expected: "read" | string): CorpusRow => ({ name, bytes: Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8"), expected });
/** One corpus, the realistic files first: every row's verdict is pinned (the validator's, under its default bounds). */
const CORPUS: readonly CorpusRow[] = [
  row("an operating point, values on their own lines", raw(head("Operating Point", "real", 2, 1), [variable(0, "v(out)", "voltage"), variable(1, "i(v1)", "current")], values([["3.333333333333333e+00", "-1.666666666666667e-03"]])), "read"),
  row("a transient", raw(head("Transient Analysis", "real", 2, 3), TIME, values(TRAN)), "read"),
  row("an AC sweep whose frequency line carries ngspice's grid attribute (grid=3)", raw(head("AC Analysis", "complex", 2, 2), AC_VARIABLES(" grid=3"), values([["1.000000000000000e+02,0.000000000000000e+00", "9.900990099009901e-01,-9.900990099009901e-02"], ["1.000000000000000e+03,0.000000000000000e+00", "5.000000000000000e-01,-5.000000000000000e-01"]])), "read"),
  row("an AC sweep", raw(head("AC Analysis", "complex", 2, 2), AC_VARIABLES(), values([["1.000000000000000e+02,0.000000000000000e+00", "9.900990099009901e-01,-9.900990099009901e-02"], ["1.000000000000000e+03,0.000000000000000e+00", "5.000000000000000e-01,-5.000000000000000e-01"]])), "read"),
  row("a DC sweep whose swept value repeats", raw(head("DC transfer characteristic", "real", 2, 3), [variable(0, "v-sweep", "voltage"), variable(1, "v(out)", "voltage")], values([["5", "2.5"], ["5", "2"], ["3", "1.5"]])), "read"),
  row("a negative zero", raw(head("Operating Point", "real", 1, 1), [variable(0, "v(1)", "voltage")], values([["-0.000000000000000e+00"]])), "read"),
  row("no No. Points header (every point complete)", raw(head("Transient Analysis", "real", 2, null), TIME, values(TRAN)), "read"),
  row("no Flags header", raw(head("Transient Analysis", null, 2, 3), TIME, values(TRAN)), "read"),
  row("a point index written 00", raw(head("Transient Analysis", "real", 2, 3), TIME, values(TRAN, (point) => (point === 0 ? "00" : String(point)))), "read"),
  row("CRLF line ends", raw(head("Transient Analysis", "real", 2, 3), TIME, values(TRAN), `${CR}${NL}`), "read"),
  row("a complex value written with a space after its comma", acWith("5.000000000000000e-01, -5.000000000000000e-01"), "read"),
  row("a large complex magnitude (1e200)", acWith("1.000000000000000e+200,0.000000000000000e+00"), "read"),
  row("a tiny complex magnitude (1e-40)", acWith("1.000000000000000e-40,0.000000000000000e+00"), "read"),
  row("inf", tranWith("inf"), "OUTPUT_NON_FINITE"),
  row("nan", tranWith("nan"), "OUTPUT_NON_FINITE"),
  row("Infinity", tranWith("Infinity"), "OUTPUT_NON_FINITE"),
  row("an overflowing literal (1e999)", tranWith("1e999"), "OUTPUT_NON_FINITE"),
  row("the MSVC infinity 1.#INF00e+000", tranWith("1.#INF00e+000"), "OUTPUT_NON_FINITE"),
  row("the MSVC indeterminate -1.#IND00e+000", tranWith("-1.#IND00e+000"), "OUTPUT_NON_FINITE"), // [B22-D review] tests-8: a NaN spelling, not malformed text
  row("the UCRT NaN -nan(ind)", tranWith("-nan(ind)"), "OUTPUT_NON_FINITE"),
  row("a complex value whose magnitude overflows though both parts are finite", acWith("1.500000000000000e+308,1.500000000000000e+308"), "OUTPUT_NON_FINITE"),
  row("decimal commas in a transient", raw(head("Transient Analysis", "real", 2, 2), TIME, values([["0,000000000000000e+00", "1,500000000000000e+00"], ["1,000000000000000e-03", "2,500000000000000e+00"]])), "OUTPUT_MALFORMED"),
  row("a decimal comma in an operating point", raw(head("Operating Point", "real", 1, 1), [variable(0, "v(1)", "voltage")], values([["1,500000000000000e+00"]])), "OUTPUT_MALFORMED"),
  row("ngspice's binary format", Buffer.concat([Buffer.from([...head("Transient Analysis", "real", 2, 1), "Variables:", ...TIME, "Binary:", ""].join(NL), "utf8"), float64(0, 0.5)]), "OUTPUT_HEADER_INVALID"),
  row("an ASCII header over binary values", Buffer.concat([Buffer.from([...head("Transient Analysis", "real", 2, 1), "Variables:", ...TIME, "Values:", ""].join(NL), "utf8"), float64(0, 2)]), "OUTPUT_SHORT"),
  row("a byte that is not UTF-8", Buffer.concat([Buffer.from(tranWith("1.0").slice(0, -1), "utf8"), Buffer.from([0xff, 0x0a])]), "OUTPUT_MALFORMED"),
  row("a NUL inside a value", tranWith(`1${C(0)}5`), "OUTPUT_MALFORMED"),
  row("fewer points than declared", raw(head("Transient Analysis", "real", 2, 3), TIME, values(TRAN.slice(0, 2))), "OUTPUT_SHORT"),
  row("more points than declared", raw(head("Transient Analysis", "real", 2, 2), TIME, values(TRAN)), "OUTPUT_MALFORMED"),
  row("a point index out of order", raw(head("Transient Analysis", "real", 2, 3), TIME, values(TRAN, (point) => String(point * 2))), "OUTPUT_MALFORMED"),
  row("a time axis that repeats a point", raw(head("Transient Analysis", "real", 2, 3), TIME, values([TRAN[0]!, TRAN[1]!, [TRAN[1]![0]!, "9.000000000000000e-01"]])), "OUTPUT_AXIS_NOT_INCREASING"),
  row("a vector type ngspice does not declare", raw(head("Transient Analysis", "real", 2, 3), [variable(0, "time", "time"), variable(1, "x(q1)", "mystery")], values(TRAN)), "OUTPUT_UNIT_UNKNOWN"),
  row("no data point", raw(head("Transient Analysis", "real", 2, 0), TIME, []), "OUTPUT_EMPTY"),
  row("two No. Points headers", raw(head("Transient Analysis", "real", 2, 3, ["No. Points: 2"]), TIME, values(TRAN.slice(0, 2))), "OUTPUT_HEADER_INVALID"),
  // [B22-D review] coverage-3, tests-1: one file the last copy would read, one the first copy would
  row("two No. Variables headers, the last matching the declarations", raw(head("Transient Analysis", "real", 3, 3, ["No. Variables: 2"]), TIME, values(TRAN)), "OUTPUT_HEADER_INVALID"),
  row("two No. Variables headers, the first matching the declarations", raw(head("Transient Analysis", "real", 2, 3, ["No. Variables: 3"]), TIME, values(TRAN)), "OUTPUT_HEADER_INVALID"),
  row("two Flags headers", raw(head("Transient Analysis", "complex", 2, 3, ["Flags: real"]), TIME, values(TRAN)), "OUTPUT_HEADER_INVALID"),
  row("a declared point count past every reader's bound but the validator's default", raw(head("Transient Analysis", "real", 2, 3_000_000), TIME, values(TRAN.slice(0, 1))), "OUTPUT_SHORT"),
  row("a second plot appended", `${raw(head("Transient Analysis", "real", 2, 3), TIME, values(TRAN))}${raw(head("Transient Analysis", "real", 2, 3), TIME, values(TRAN))}`, "OUTPUT_MALFORMED"),
];

interface Vector { name: string; real: number[]; imaginary: number[] | null }
type Reading = { read: true; complex: boolean; plot: string; vectors: Vector[] } | { read: false; code: string | null };
/** What the validator reads (B22-C's one output validator) under a reader's bounds. */
function byValidator(text: string, limits: Partial<SimulationOutputLimits> = {}): Reading {
  try {
    const output = validateNgspiceAsciiOutput(text, { limits });
    return { read: true, complex: output.complex, plot: output.plotName, vectors: [output.axis, ...output.variables].map((vector) => ({ name: vector.name, real: [...vector.real], imaginary: vector.imaginary ? [...vector.imaginary] : null })) };
  } catch (error) {
    if (error instanceof SimulationOutputError) return { read: false, code: error.code };
    throw error;
  }
}
/** The worker's and the route's derived magnitude and phase of a complex value (waveforms.ts; route.ts). */
const magnitudeDb = (re: number, im: number): number => 20 * Math.log10(Math.max(1e-30, Math.hypot(re, im)));
const phaseDeg = (re: number, im: number): number => (Math.atan2(im, re) * 180) / Math.PI;
const same = (a: number, b: unknown): boolean => typeof b === "number" && Object.is(a, b);
/** Every disagreement between the validator's reading and another parser's, as text (empty when they agree). */
function disagreements(label: string, expected: Reading, actual: { read: boolean; code?: string | null; check?: (expected: Extract<Reading, { read: true }>, out: string[]) => void; numbers?: unknown[] }): string[] {
  const out: string[] = [];
  if (expected.read !== actual.read) return [`${label}: the validator ${expected.read ? "reads" : `refuses (${(expected as { code: string | null }).code ?? "no code"})`} the file, this parser ${actual.read ? "reads" : `refuses (${actual.code ?? "no code"})`} it`];
  if (!expected.read) {
    if (actual.code !== undefined && actual.code !== null && actual.code !== expected.code) out.push(`${label}: refused with ${actual.code}, the validator with ${String(expected.code)}`);
    return out;
  }
  actual.check?.(expected, out);
  for (const value of actual.numbers ?? []) if (typeof value !== "number" || !Number.isFinite(value)) out.push(`returned a value that is not a finite number (${String(value)})`);
  return out.map((line) => `${label}: ${line}`);
}

describe("[B22-D] the adversarial matrix: what was missing, prevented offline at the fake seams", () => {
  it("1. [items 3, 5, 11] the output path: an executed deck's write target must be a plain relative file inside the run directory - a traversing, absolute, UNC, drive, device (//./, NUL, CON, COM1, /dev/*, /proc/*) or URL target is refused by the final deck screen; the compiler's own `write result.raw` passes, and /api/simulate's deck writes exactly `write result.raw`", async () => {
    const deck = buildCircuitAnalysisDeck({ circuit: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 }, "seeded");
    const EXECUTED = { controlBlock: true, executed: true };
    const writeLine = deck.split(NL).find((line) => line.startsWith("write "))!;
    expect(writeLine).toBe("write result.raw v(out) i(V1)");
    const withTarget = (target: string): string => deck.split(NL).map((line) => (line === writeLine ? `write ${target} v(out) i(V1)` : line)).join(NL);
    expect(verdict(() => assertCompiledDeckSafe(deck, EXECUTED))).toBe("accepted");
    expect(verdict(() => assertCompiledDeckSafe(withTarget("results/result.raw"), EXECUTED)), "a plain relative path stays inside the run directory").toBe("accepted");
    const refused = [
      "../result.raw", "../../b22d.raw", "results/../../b22d.raw", "/tmp/b22d.raw", "/dev/null", "/dev/tcp/192.0.2.1/80", "/proc/self/environ",
      "//./pipe/b22d", "//./PhysicalDrive0", "//host/share/b22d.raw", "NUL", "nul.raw", "CON", "con.raw", "COM1", "lpt9.raw", "results/NUL",
      `${BS}${BS}.${BS}PhysicalDrive0`, `C:${BS}b22d.raw`, "C:b22d.raw", "http://192.0.2.1/b22d.raw", "~/b22d.raw", "$HOME/b22d.raw",
    ];
    const admitted = refused.filter((target) => verdict(() => assertCompiledDeckSafe(withTarget(target), EXECUTED)) !== "refused (closed)");
    expect(admitted, "write targets the final deck screen admitted").toEqual([]);
    // /api/simulate's deck (its own screen): the control block writes exactly the server's raw file name
    proc.script.push({ raw: OP_RAW });
    expect((await simulate()).status).toBe(200);
    const written = fsState.writes.find((write) => write.path.endsWith(`${sep}deck.cir`))!.content;
    expect(written.split(NL).filter((line) => /^\s*write\b/i.test(line))).toEqual(["write result.raw"]);
  });

  it("2. [items 5, 11] device and network paths in model text: an include or an XSPICE file parameter naming \\\\.\\, //./, \\\\?\\, a UNC share, NUL, CON, COM1, CONIN$, a device name under a folder, /dev/*, /proc/* or a URL is refused by the model screen and by the final deck screen; plainRelativeFileName refuses each and admits a plain relative name", () => {
    const paths = [
      `${BS}${BS}.${BS}PhysicalDrive0`, "//./PhysicalDrive0", `${BS}${BS}.${BS}pipe${BS}b22d`, `${BS}${BS}?${BS}C:${BS}b22d.lib`, `${BS}${BS}?${BS}UNC${BS}host${BS}share${BS}b22d.lib`,
      `${BS}${BS}host${BS}share${BS}b22d.lib`, "//host/share/b22d.lib",
      "NUL", "con", "nul.lib", "COM1", "lpt9.lib", "CONIN$", "CONOUT$", `COM${C(0xb9)}`, "models/NUL", "models/con.lib", `models${BS}aux.txt`,
      "/dev/null", "/dev/zero", "/dev/tcp/192.0.2.1/80", "/proc/self/environ",
      "http://192.0.2.1/b22d.lib", "https://192.0.2.1/b22d.lib", "file:///etc/passwd", "ftp://192.0.2.1/b22d.lib",
    ];
    const SUBCKT = [".subckt AMP 1 2", "R1 1 2 1k", ".ends AMP"].join(NL);
    const model = (text: string) => {
      const asset = importModelText("b22d.lib", `${SUBCKT}${NL}`).candidate;
      asset.originalContent = text;
      return asset;
    };
    const deck = buildCircuitAnalysisDeck({ circuit: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 }, "seeded");
    const deckWith = (card: string): string => deck.replace(`${NL}.control${NL}`, `${NL}${card}${NL}.control${NL}`);
    const EXECUTED = { controlBlock: true, executed: true };
    const admitted: string[] = [];
    for (const path of paths) {
      if (plainRelativeFileName(path)) admitted.push(`plainRelativeFileName admits ${path}`);
      for (const card of [`.include ${path}`, `.include "${path}"`, `.model fsrc filesource (file="${path}")`, `.model din d_source (input_file=${path})`, `.model st d_state (state_file '${path}')`]) {
        if (verdict(() => assertModelSafeForExecution(model(`${SUBCKT}${NL}${card}`))) === "accepted") admitted.push(`the model screen admits ${card}`);
        if (verdict(() => assertCompiledDeckSafe(deckWith(card), EXECUTED)) === "accepted") admitted.push(`the final deck screen admits ${card}`);
      }
    }
    expect(admitted).toEqual([]);
    // the rule still admits what is legitimate: a plain relative data file (an include is refused anyway: an unresolved dependency)
    expect(plainRelativeFileName("models/data.txt")).toBe(true);
    expect(verdict(() => assertModelSafeForExecution(model(`${SUBCKT}${NL}.model fsrc filesource (file="data.txt")`)))).toBe("accepted");
    expect(verdict(() => assertCompiledDeckSafe(deckWith('.model fsrc filesource (file="data.txt")'), EXECUTED))).toBe("accepted");
  });

  it("3. [items 4, 5] the raw file is read back only when lstat shows a plain file with one name: a link or junction, a hardlink, a directory, a FIFO or a device in its place is refused unread - at the runner, /api/simulate and the Studio worker - and an absent one is missing, as before", async () => {
    // [B22-D review] coverage-5: soft assertions, so a breakage reports every kind and every entry point it lets through, not the first
    const kinds = ["symlink", "hardlink", "directory", "fifo", "device"] as const;
    for (const kind of kinds) {
      fsState.opens.length = 0;
      proc.script.push({ raw: OP_RAW, rawKind: kind });
      const record = await run({ readRaw: true });
      expect.soft(record.outcome, kind).toBe("exited");
      expect.soft(record.raw, kind).toEqual({ state: "not-a-plain-file" });
      expect.soft(rawOpens(), `${kind}: never opened`).toEqual([]);
    }
    proc.script.push({ raw: OP_RAW });
    expect.soft((await run({ readRaw: true })).raw).toEqual({ state: "read", text: OP_RAW });
    proc.script.push({});
    expect.soft((await run({ readRaw: true })).raw).toEqual({ state: "missing" });
    // the entry points answer the refusal as no output; nothing of the file is parsed or returned
    fsState.opens.length = 0;
    proc.script.push({ raw: OP_RAW, rawKind: "symlink" });
    const simulated = await simulate();
    expect.soft(simulated.status).toBe(500);
    expect.soft(simulated.body.ok).not.toBe(true);
    expect.soft(simulated.text).not.toContain("5.000000000000000e+00");
    proc.script.push({ raw: OP_RAW, rawKind: "hardlink" });
    const worker = await workerRun();
    expect.soft(worker.result.status).toBe("failed");
    expect.soft(worker.result.waveforms ?? []).toEqual([]);
    expect.soft(rawOpens()).toEqual([]);
  });

  it("4. [item 4] the runner root: the runner creates it, or - when it exists - runs only if lstat shows a plain directory; a pre-planted link, junction or file there runs nothing, writes nothing and names no path", async () => {
    fsState.root = "absent";
    proc.script.push({});
    expect((await run()).outcome).toBe("exited");
    expect(fsState.lstats.filter((path) => path === RUNNER_ROOT), "a root this run created needs no check").toEqual([]);
    fsState.root = "directory";
    proc.script.push({});
    expect((await run()).outcome).toBe("exited");
    for (const root of ["symlink", "file"] as const) {
      fsState.root = root;
      const spawns = ngspiceCalls().length;
      const dirs = fsState.dirs.length;
      const writes = fsState.writes.length;
      const refused = await refusal(run());
      expect(refused, root).toMatchObject({ code: "NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED" });
      expect((refused as { message: string }).message, root).not.toContain(tmpdir());
      expect(ngspiceCalls(), root).toHaveLength(spawns);
      expect(fsState.dirs, root).toHaveLength(dirs);
      expect(fsState.writes, root).toHaveLength(writes);
    }
    // /api/simulate answers the closed refusal 503, before any process
    fsState.root = "symlink";
    const simulated = await simulate();
    expect(simulated.status).toBe(503);
    expect(String(simulated.body.error)).toMatch(/^NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED: /);
    expect(simulated.text).not.toContain(RUNNER_ROOT.split(BS).join(`${BS}${BS}`));
  });

  it("5. [item 12] a canary in the server environment never reaches the child or any output - the runner's record, /api/simulate, the smoke test, the Studio worker's result and its log events - while the child's own environment does reach them (the positive control)", async () => {
    const canaryName = `SIRKIT_B22D_CANARY_${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const canaryValue = `canary-${randomUUID()}`;
    const providerName = ["OPENAI", "API", "KEY"].join("_");
    const providerValue = `canary-${randomUUID()}`;
    vi.stubEnv(canaryName, canaryValue);
    vi.stubEnv(providerName, providerValue);
    const printsEnvironment = (call: SpawnCall): string => `CHILD-ENV ${JSON.stringify(call.options.env)}${NL}`;
    const leaks = (text: string): string[] => [canaryName, canaryValue, providerName, providerValue].filter((secret) => text.includes(secret));
    // the runner
    proc.script.push({ stdout: printsEnvironment });
    const record = await run();
    const env = ngspiceCalls().at(-1)!.options.env as Record<string, string>;
    expect(Object.keys(env).sort()).toEqual(["LC_ALL", "PATH", "SystemRoot", "TEMP", "TMP", "TZ"]);
    expect(leaks(JSON.stringify(env))).toEqual([]);
    expect(record.stdout).toContain('"TZ":"UTC"');
    expect(leaks(JSON.stringify(record))).toEqual([]);
    expect(record.hostAddedEnvironment).not.toContain(canaryName);
    // /api/simulate: a failing run returns ngspice's output tail
    proc.script.push({ stdout: printsEnvironment, code: 1 });
    const simulated = await simulate();
    expect(simulated.status).toBe(500);
    expect(simulated.text).toContain("LC_ALL");
    expect(leaks(simulated.text)).toEqual([]);
    // the smoke test returns stdout and stderr
    proc.script.push({ stdout: printsEnvironment });
    const smoke = await smokePost(post("/api/spice/models/smoke-test", { model: importModelText("dtest.lib", ".model DTEST D(IS=1e-14)\n").candidate }));
    const smokeText = await smoke.text();
    expect(smokeText).toContain("LC_ALL");
    expect(leaks(smokeText)).toEqual([]);
    // the Studio worker: its result and every log event
    proc.script.push({ stdout: printsEnvironment, code: 1 });
    const worker = await workerRun();
    expect(JSON.stringify(worker.result)).toContain("LC_ALL");
    expect(leaks(JSON.stringify(worker.result))).toEqual([]);
    expect(leaks(worker.logs.join(NL))).toEqual([]);
    // taskkill, the runner's only other spawn, gets SystemRoot alone (b22-a3-diagnostic-runner case 6 pins its argv)
    for (const call of proc.calls) expect(leaks(JSON.stringify(call.options.env ?? {})), call.command).toEqual([]);
  });

  it("6. [item 13] signal races at the runner: an abort after the exit, in the spawn's own tick, beside the child's clean exit, after the wall clock; an error from a live child; a second close - each run ends in exactly one terminal state, kills at most once, is never reported exited after a kill, reads no raw file after one, and frees its slot and its directory once", async () => {
    const settledOnce = async (pending: Promise<runner.DiagnosticRunRecord>) => {
      const record = await pending;
      expect(Object.isFrozen(record)).toBe(true);
      await until(() => runner.diagnosticRunnerState().running === 0, "the slot to be released");
      return record;
    };
    const spawnedPid = (pid: number) => until(() => Boolean(childWithPid(pid)), `the spawn of ${pid}`);
    const killsOf = (pid: number) => taskkillCalls().filter((call) => call.args[1] === String(pid)).length;
    // an abort after the exit changes nothing and kills nothing
    const late = new AbortController();
    proc.script.push({ pid: 601, raw: OP_RAW });
    const exited = await settledOnce(run({ signal: late.signal, readRaw: true }));
    late.abort();
    await sleep(10);
    expect(exited).toMatchObject({ outcome: "exited", exitCode: 0, killReason: null, raw: { state: "read" } });
    expect(killsOf(601)).toBe(0);
    // an abort inside the spawn's own tick: cancelled once the tree's close is observed; nothing read
    const atSpawn = new AbortController();
    proc.script.push({ pid: 602, hang: true, raw: OP_RAW, onSpawn: () => atSpawn.abort() });
    expect(await settledOnce(run({ signal: atSpawn.signal, readRaw: true }))).toMatchObject({ outcome: "cancelled", killReason: "cancelled", spawned: true, raw: { state: "skipped" } });
    expect(killsOf(602)).toBe(1);
    expect(taskkillCalls().at(-1)!.options.env, "taskkill gets the Windows directory alone").toEqual({ SystemRoot: FAKE_SYSTEM_ROOT });
    proc.taskkillEndsTree = false;
    // an abort, then the child's own clean exit in the same tick: cancelled, never exited; the raw file it wrote is not read
    const beside = new AbortController();
    fsState.opens.length = 0;
    proc.script.push({ pid: 603, manual: true, raw: OP_RAW });
    const racing = run({ signal: beside.signal, readRaw: true });
    await spawnedPid(603);
    beside.abort();
    childWithPid(603)!.close(0);
    expect(await settledOnce(racing)).toMatchObject({ outcome: "cancelled", killReason: "cancelled", exitCode: 0, raw: { state: "skipped" } });
    expect(rawOpens()).toEqual([]);
    expect(killsOf(603)).toBe(1);
    // the child's clean exit, then an abort in the same tick: exited, nothing killed
    const after = new AbortController();
    proc.script.push({ pid: 604, manual: true, raw: OP_RAW });
    const closing = run({ signal: after.signal, readRaw: true });
    await spawnedPid(604);
    childWithPid(604)!.close(0);
    after.abort();
    expect(await settledOnce(closing)).toMatchObject({ outcome: "exited", killReason: null, raw: { state: "read" } });
    expect(killsOf(604)).toBe(0);
    // the wall clock fires, an abort arrives while the killed child still runs, then it exits cleanly: timeout (the first cause
    // kept), one tree kill, never exited, nothing read
    const clocked = new AbortController();
    proc.script.push({ pid: 605, manual: true, raw: OP_RAW });
    const timed = run({ signal: clocked.signal, wallClockMs: 5, readRaw: true });
    await until(() => killedPid(605), "the wall clock's tree kill of 605");
    clocked.abort();
    await sleep(10);
    childWithPid(605)!.close(0);
    expect(await settledOnce(timed)).toMatchObject({ outcome: "timeout", killReason: "timeout", raw: { state: "skipped" } });
    expect(killsOf(605)).toBe(1);
    // an error from a child that started (a failed kill or a pipe error) is not terminal: its close decides
    proc.script.push({ pid: 606, manual: true });
    let settled = false;
    const erring = run().then((record) => { settled = true; return record; });
    await spawnedPid(606);
    childWithPid(606)!.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
    await sleep(10);
    expect(settled).toBe(false);
    childWithPid(606)!.close(0);
    expect(await settledOnce(erring)).toMatchObject({ outcome: "exited", exitCode: 0 });
    // a second close event with another code: the first wins
    proc.script.push({ pid: 607, manual: true });
    const twice = run();
    await spawnedPid(607);
    childWithPid(607)!.emit("close", 0);
    childWithPid(607)!.emit("close", 3);
    expect(await settledOnce(twice)).toMatchObject({ outcome: "exited", exitCode: 0 });
    // every run directory was removed exactly once
    for (const dir of fsState.dirs) expect(fsState.removed.filter((path) => path === dir), dir).toHaveLength(1);
  });

  it("7. [item 15] archives: the SPICE reproducibility bundle writes exactly its eleven fixed entry names - never a name a run carries - and no named computation reads an archive (no computation module imports an archive or inflate library; artifact-parse parses server-held JSON only)", async () => {
    const FIXED = ["README.txt", "diagnostics.json", "logs/stderr.log", "logs/stdout.log", "manifest.json", "netlist/executed.cir", "netlist/generated.cir", "netlist/normalized.cir", "netlist/source-map.json", "results/scalars.json", "results/waveforms.json"];
    const project = opProject();
    project.name = "../../b22d-escape";
    project.tests[0]!.name = `C:${BS}b22d${BS}..${BS}escape`;
    project.runPlans[0]!.name = "/b22d/absolute";
    proc.script.push({ stdout: `../../b22d-out${NL}/b22d-abs${NL}`, code: 1 });
    const started = await runsPost(post("/api/spice/runs", { project, runPlanId: project.runPlans[0]!.id, parts: [] }));
    expect(started.status).toBe(202);
    const runId = ((await started.json()) as { batch: { runIds: string[] } }).batch.runIds[0]!;
    await until(() => Boolean(getRun(runId, SCOPE)?.finishedAt), "the run to settle");
    injectAuthorizedPrincipal({ userId: "u-b22d", tenantId: "local", projectId: "proj-b22d", role: "editor" });
    const bundle = await bundleGet(new Request(`http://localhost/api/spice/runs/${runId}/bundle`, { headers: SELECTOR }), { params: Promise.resolve({ id: runId }) });
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("Content-Disposition")).toMatch(/^attachment; filename="sirkit-spice-[A-Za-z0-9_-]+\.zip"$/);
    const zip = await JSZip.loadAsync(await bundle.arrayBuffer());
    const entries = Object.values(zip.files);
    expect(entries.filter((entry) => !entry.dir).map((entry) => entry.name).sort()).toEqual(FIXED);
    for (const entry of entries) expect(entry.name, entry.name).not.toMatch(/(?:^|[\\/])\.\.(?:[\\/]|$)|^[\\/]|^[A-Za-z]:|\\/);
    // statically: every zip.file( in the route names a string literal from the fixed set
    const route = read("app/api/spice/runs/[id]/bundle/route.ts");
    const named = [...route.matchAll(/zip\.file\(\s*([^,]+?)\s*,/g)].map((match) => match[1]!);
    expect(named.every((argument) => /^"[^"$`]+"$/.test(argument)), named.join(" ")).toBe(true);
    expect(named.map((argument) => argument.slice(1, -1)).sort()).toEqual(FIXED);
    // no named computation reads an archive: the catalog's parse kind has two closed parsers over server-held JSON, and no
    // computation module imports an archive or inflate library (b22-b-catalog case 2 pins that no input field is a file or bytes)
    expect([...ARTIFACT_PARSERS]).toEqual(["board-statistics", "result-fields"]);
    const directory = join(process.cwd(), "app", "lib", "computation");
    const modules = readdirSync(directory).filter((name) => /\.(?:ts|mjs)$/.test(name));
    expect(modules.length).toBeGreaterThanOrEqual(13);
    const ARCHIVE = /(?:from\s+|import\s+|import\s*\(\s*|require\(\s*)["'](?:jszip|(?:node:)?zlib|fflate|adm-zip|yauzl|yazl|unzipper|tar|tar-stream|decompress|pako)["']/;
    for (const name of modules) expect(readFileSync(join(directory, name), "utf8"), name).not.toMatch(ARCHIVE);
  });

  it("8. [items 16, 9, 10, 8] one corpus of raw files through every parser that exists - the output validator, the Studio worker's parser, /api/simulate's parser and the circuit-analysis strict reader: every verdict and every value agree, and every number any of them returns is finite; NaN/Inf, an overflowing complex magnitude, decimal commas, binary and mixed output, duplicate headers and a byte that is not UTF-8 are refused by all; the strict reader's own bounds (64 variables, 100,000 points) hold at their edges", { timeout: 60_000 }, async () => {
    const found: string[] = [];
    for (const entry of CORPUS) {
      // the string parsers read what they are handed: the text, or for bytes that are not UTF-8 a lossless byte view (the runner
      // refuses those before any parser; here each parser must refuse them on its own too)
      let utf8 = true;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes);
      } catch {
        utf8 = false;
      }
      const text = utf8 ? entry.bytes.toString("utf8") : entry.bytes.toString("latin1");
      const validator = byValidator(text);
      found.push(...(validator.read ? (entry.expected === "read" ? [] : [`${entry.name}: the validator reads it (pinned: ${entry.expected})`]) : validator.code === entry.expected ? [] : [`${entry.name}: the validator refuses it ${String(validator.code)} (pinned: ${entry.expected})`]));
      // the Studio worker's parser (waveforms.ts)
      let worker: ParsedRawResult | null = null;
      let workerCode: string | null = null;
      try {
        worker = parseNgspiceAsciiRaw(text);
      } catch (error) {
        workerCode = error instanceof SimulationOutputError ? error.code : "UNCLOSED";
      }
      found.push(...disagreements(`${entry.name} [worker]`, validator, {
        read: worker !== null,
        code: workerCode,
        numbers: worker ? worker.waveforms.flatMap((waveform) => [...waveform.x, ...waveform.y, ...(waveform.complex ? [...waveform.complex.real, ...waveform.complex.imaginary, ...waveform.complex.magnitudeDb, ...waveform.complex.phaseDeg] : [])]) : [],
        check: (expected, out) => {
          const parsed = worker!;
          const names = expected.vectors.map((vector) => vector.name);
          if (JSON.stringify(parsed.header.variables.map((entry2) => entry2.name)) !== JSON.stringify(names)) out.push(`names ${JSON.stringify(parsed.header.variables.map((entry2) => entry2.name))}`);
          const [axis, ...rest] = expected.vectors;
          if (rest.length === 0) {
            const only = parsed.waveforms[0];
            if (!only || only.y.some((value, index) => !same(axis!.real[index]!, value)) || only.y.length !== axis!.real.length) out.push("the single vector's values");
            return;
          }
          for (const vector of rest) {
            if (vector.imaginary) {
              const mag = parsed.waveforms.find((waveform) => waveform.name === `${vector.name}.mag`);
              const phase = parsed.waveforms.find((waveform) => waveform.name === `${vector.name}.phase`);
              if (!mag || !phase || !mag.complex) { out.push(`${vector.name}: no magnitude and phase series`); continue; }
              vector.real.forEach((re, index) => {
                const im = vector.imaginary![index]!;
                if (!same(re, mag.complex!.real[index]) || !same(im, mag.complex!.imaginary[index])) out.push(`${vector.name}[${index}]: real or imaginary part`);
                if (!same(magnitudeDb(re, im), mag.y[index]) || !same(phaseDeg(re, im), phase.y[index])) out.push(`${vector.name}[${index}]: derived magnitude or phase`);
                if (!same(axis!.real[index]!, mag.x[index])) out.push(`${vector.name}[${index}]: axis`);
              });
            } else {
              const series = parsed.waveforms.find((waveform) => waveform.name === vector.name);
              if (!series || series.y.length !== vector.real.length || vector.real.some((value, index) => !same(value, series.y[index]) || !same(axis!.real[index]!, series.x[index]))) out.push(`${vector.name}: values or axis`);
            }
          }
        },
      }));
      // the circuit-analysis strict reader (request-executors.ts), under its own bounds
      const strictExpected = byValidator(text, STRICT_LIMITS);
      const strict = readStrictRaw(text);
      found.push(...disagreements(`${entry.name} [strict reader]`, strictExpected, {
        read: strict !== null,
        numbers: strict ? strict.points.flat(2) : [],
        check: (expected, out) => {
          if (strict!.complex !== expected.complex) out.push(`complex ${String(strict!.complex)}`);
          if (JSON.stringify(strict!.names) !== JSON.stringify(expected.vectors.map((vector) => vector.name.toLowerCase()))) out.push(`names ${JSON.stringify(strict!.names)}`);
          const points = expected.vectors[0]!.real.length;
          if (strict!.points.length !== points) out.push(`${strict!.points.length} points, the validator ${points}`);
          strict!.points.forEach((pointValues, point) => pointValues.forEach(([re, im], index) => {
            const vector = expected.vectors[index];
            if (!vector || !same(vector.real[point]!, re) || !same(vector.imaginary ? vector.imaginary[point]! : 0, im)) out.push(`point ${point} vector ${index}: ${String(re)},${String(im)}`);
          }));
        },
      }));
      // /api/simulate's parser, through the route and the runner (which refuses bytes that are not UTF-8 before any parser)
      proc.script.push({ raw: entry.bytes });
      const answer = await simulate();
      const routeExpected: Reading = utf8 ? byValidator(text, ROUTE_LIMITS) : { read: false, code: null };
      const points = Array.isArray(answer.body.points) ? (answer.body.points as Array<Record<string, unknown>>) : [];
      found.push(...disagreements(`${entry.name} [route]`, routeExpected, {
        read: answer.status === 200,
        code: answer.status === 200 ? null : typeof answer.body.code === "string" ? answer.body.code : null,
        numbers: points.flatMap((point) => Object.values(point)),
        check: (expected, out) => {
          const vectors = expected.vectors;
          const columns = vectors.flatMap((vector, index) => (vector.imaginary ? (index === 0 && /freq/i.test(vector.name) ? [vector.name] : [`${vector.name}.mag`, `${vector.name}.phase`]) : [vector.name]));
          if (JSON.stringify(answer.body.variables) !== JSON.stringify(columns)) out.push(`variables ${JSON.stringify(answer.body.variables)}`);
          if (points.length !== vectors[0]!.real.length) out.push(`${points.length} points`);
          points.forEach((point, index) => vectors.forEach((vector, k) => {
            if (!vector.imaginary) { if (!same(vector.real[index]!, point[vector.name])) out.push(`${vector.name}[${index}]`); return; }
            const re = vector.real[index]!;
            const im = vector.imaginary[index]!;
            if (k === 0 && /freq/i.test(vector.name)) { if (!same(re, point[vector.name])) out.push(`${vector.name}[${index}]`); return; }
            if (!same(magnitudeDb(re, im), point[`${vector.name}.mag`]) || !same(phaseDeg(re, im), point[`${vector.name}.phase`])) out.push(`${vector.name}[${index}]: derived magnitude or phase`);
          }));
        },
      }));
    }
    // [B22-D review] coverage-2, tests-2: the strict reader's OWN bounds (request-executors.ts STRICT_RAW_LIMITS: 64 variables, 100,000
    // points), which the corpus never reaches - complete sweeps the validator's defaults and the worker's parser read: the strict reader
    // reads each up to its bound and refuses one past it (declared, or counted when no `No. Points:` header declares it)
    const sweep = (count: number, points: number, declared: boolean): string => raw(
      head("DC transfer characteristic", "real", count, declared ? points : null),
      Array.from({ length: count }, (_, index) => variable(index, `v(n${index})`, "voltage")),
      values(Array.from({ length: points }, () => Array.from({ length: count }, () => "1"))),
    );
    const EDGES = [
      { name: "64 variables, the strict bound", text: sweep(64, 1, true), strict: { variables: 64, points: 1 } },
      { name: "65 variables", text: sweep(65, 1, true), strict: null },
      { name: "100,000 points, the strict bound", text: sweep(1, 100_000, true), strict: { variables: 1, points: 100_000 } },
      { name: "100,001 points, declared", text: sweep(1, 100_001, true), strict: null },
      { name: "100,001 points, no No. Points header", text: sweep(1, 100_001, false), strict: null },
    ];
    for (const edge of EDGES) {
      if (!byValidator(edge.text).read) found.push(`${edge.name}: the validator's default bounds refuse it`);
      try {
        parseNgspiceAsciiRaw(edge.text);
      } catch {
        found.push(`${edge.name} [worker]: refused`);
      }
      const strict = readStrictRaw(edge.text);
      const got = strict === null ? null : { variables: strict.names.length, points: strict.points.length };
      if (JSON.stringify(got) !== JSON.stringify(edge.strict)) found.push(`${edge.name} [strict reader]: ${got === null ? "refused" : `read ${got.variables} x ${got.points}`} (pinned: ${edge.strict === null ? "refused" : "read"})`);
    }
    expect(found).toEqual([]);
  });

  it("9. adversarial-matrix.md holds the 16 runbook classes in order, each with P (citations that resolve to an existing suite and case, and its breakage proof), L (a case of the opt-in live suite, or none by design) and O (BLOCKED-LIVE-QUALIFICATION under LB-10), and states the residuals", () => {
    const CLASSES = ["fork bombs", "child processes", "filesystem escape", "symlink/hardlink tricks", "device paths", "huge output", "infinite simulation", "malformed binary output", "NaN/Inf", "locale drift", "network attempts", "environment-variable exfiltration", "signal races", "orphan processes", "archive traversal", "parser differentials"];
    const page = read("artifacts/ai-control-plane-b22/adversarial-matrix.md");
    expect(page.startsWith("# B22-D - ")).toBe(true);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(`**${label}**`);
    const rows = page.split(NL).filter((line) => /^\| \d+ \| /.test(line)).map((line) => line.slice(2, -2).split(" | "));
    expect(rows.map((cells) => [cells[0], cells[1]])).toEqual(CLASSES.map((name, index) => [String(index + 1), name]));
    // every cited suite resolves: by number (`[suite#N]`, its `it("N. ` case) or by a quoted fragment of its source
    const suites = new Map<string, string>();
    const walk = (directory: string): void => {
      for (const name of readdirSync(join(process.cwd(), directory), { withFileTypes: true })) {
        if (name.isDirectory()) { if (name.name !== "node_modules") walk(`${directory}/${name.name}`); continue; }
        const match = /^(.+)\.test\.tsx?$/.exec(name.name);
        if (match) suites.set(match[1]!, `${directory}/${name.name}`);
      }
    };
    for (const directory of ["app/lib/computation", "app/lib/spice", "app/api/simulate", "app/api/__tests__", "app/lib/auth/__tests__", "app/lib/mcp/server/__tests__", "app/lib/pcb"]) walk(directory);
    const live = read("app/lib/computation/__tests__/b22-d-adversarial-live.test.ts");
    const broken: string[] = [];
    rows.forEach((cells, index) => {
      const [, name, prevention, liveCell, oci] = cells;
      const citations = [...(prevention ?? "").matchAll(/\[([a-z0-9-]+)(?:#([\d, ]+)|: "([^"]+)")\]/g)];
      if (citations.length === 0) broken.push(`${name}: P cites no case`);
      if (!/breakage proof: \S/i.test(prevention ?? "")) broken.push(`${name}: P names no breakage proof`);
      for (const [, stem, numbers, fragment] of citations) {
        const path = suites.get(stem!);
        if (!path) { broken.push(`${name}: no suite ${stem}`); continue; }
        const source = read(path);
        for (const number of (numbers ?? "").split(",").map((text) => text.trim()).filter(Boolean)) if (!new RegExp(`it\\((?:"|\`)(?:\\[[^\\]]*\\] )?${number}\\. `).test(source)) broken.push(`${name}: ${stem} has no case ${number}`);
        if (fragment !== undefined && !source.includes(fragment)) broken.push(`${name}: ${stem} has no "${fragment}"`);
      }
      const liveCase = /\bcase (\d+)\b/.exec(liveCell ?? "");
      if (liveCase) { if (!live.includes(`it("${liveCase[1]}. `)) broken.push(`${name}: the live suite has no case ${liveCase[1]}`); }
      else if (!/none by design/.test(liveCell ?? "")) broken.push(`${name}: L names no live case and is not "none by design"`);
      if (!/BLOCKED-LIVE-QUALIFICATION/.test(oci ?? "") || !/LB-10/.test(oci ?? "")) broken.push(`${name}: O is not BLOCKED-LIVE-QUALIFICATION under LB-10`);
      expect(cells, `row ${index + 1}`).toHaveLength(5);
    });
    expect(broken).toEqual([]);
    // the honest residuals
    expect(page).toContain("OD-145");
    expect(page).toMatch(/no OS network denial/);
    expect(page).toMatch(/only O could prove denial/);
    expect(page).not.toMatch(/\bsandbox(ed)? (is|are|runs?)\b/i);
  });

  it("10. the live suite is opt-in, benign and confined: skipped unless SIRKIT_B22_LIVE_RUNNER=1; every deck it runs is an ngspiceDeck([...]) array of string literals (no deck built another way, no line built at runtime) holding circuit cards and ngspice's own commands from a closed list - no command interpreter, no `*#`, no include or library, no redirection, no path separator, `~` or URL, every `write` target a plain relative file in the run directory; every write it makes is rooted at its scratch root or the run directory; its positive control is asserted, never only printed", () => {
    const live = read("app/lib/computation/__tests__/b22-d-adversarial-live.test.ts");
    expect(live).toContain('const LIVE = process.env.SIRKIT_B22_LIVE_RUNNER === "1";');
    expect(live.match(/describe\.runIf\(LIVE\)\(/g)).toHaveLength(1);
    expect(live).not.toMatch(/\bdescribe\(|\.only\(/);
    // [B22-D review] coverage-1, tests-3: a deck reaches the runner only through the one helper, and every call of the helper passes an
    // array of string literals, so the lines read here are the lines ngspice reads (no line built at runtime, no deck built elsewhere)
    expect(live).toContain("const ngspiceDeck = (lines: string[]): string => runner.seedDiagnosticDeck(");
    expect(live.match(/seedDiagnosticDeck\(/g), "seedDiagnosticDeck is called only by the helper").toHaveLength(1);
    const LITERALS = /^\s*"(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:[^"\\]|\\.)*")*\s*,?\s*$/;
    const decks: string[][] = [];
    const malformed: string[] = [];
    let masked = "";
    let from = 0;
    for (let at = live.indexOf("ngspiceDeck(["); at >= 0; at = live.indexOf("ngspiceDeck([", at + 1)) {
      let depth = 0;
      let end = at + "ngspiceDeck(".length;
      for (; end < live.length; end += 1) {
        const character = live[end]!;
        if (character === "[") depth += 1;
        else if (character === "]") { depth -= 1; if (depth === 0) break; }
      }
      const body = live.slice(at + "ngspiceDeck([".length, end);
      if (live[end + 1] !== ")" || !LITERALS.test(body)) { malformed.push(live.slice(at, end + 2)); continue; }
      decks.push(JSON.parse(`[${body.replace(/,\s*$/, "")}]`) as string[]);
      masked += `${live.slice(from, at)}DECK`;
      from = end + 2;
    }
    masked += live.slice(from);
    expect(malformed, "a deck that is not an array of string literals").toEqual([]);
    expect(decks.length).toBeGreaterThanOrEqual(12);
    expect(live.match(/ngspiceDeck\(/g), "every call of the helper passes an array literal").toHaveLength(decks.length);
    // every line: no forbidden construct, no path separator, `~`, redirection or pipe; outside the control block only circuit cards,
    // comments and `.end`; inside it only ngspice's own commands from a closed list, `set` only for the file type, and every `write`
    // target a plain relative file (B22-A1's rule, the final screen's G1: no device name, no drive, nothing absolute)
    const FORBIDDEN = /\bshell\b|\*#|\*ng_script|\.inc|\.lib\b|\.exec|\.system|\.cd\b|\.source|\bsource\b|!|`|\.\.|\/dev\/|:\/\/|\\\\|\b[A-Za-z]:[\\/]|\bcd\b|\bload\b|\bcodemodel\b|\bwrdata\b/;
    const COMMANDS = new Set(["set", "op", "tran", "ac", "let", "while", "end", "echo", "write", "quit"]);
    const offending: string[] = [];
    for (const lines of decks) {
      let control = false;
      for (const line of lines) {
        if (FORBIDDEN.test(line) || [BS, "/", "~", "<", ">", "|"].some((character) => line.includes(character))) offending.push(`forbidden: ${line}`);
        // [B22-D lead] the check's new issue: an escaped line break (or any control character) inside one literal would hide a second
        // ngspice line behind an allowed first word - every element must be exactly one line
        if ([...line].some((character) => { const code = character.charCodeAt(0); return code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029; })) offending.push(`not one line: ${JSON.stringify(line)}`);
        if (line === ".control" || line === ".endc") { control = line === ".control"; continue; }
        if (!control) {
          if (line !== ".end" && !/^\* /.test(line) && !/^[VRC]\d+ /.test(line)) offending.push(`not a circuit card: ${line}`);
          continue;
        }
        const [command = "", target = ""] = line.split(" ");
        if (!COMMANDS.has(command)) offending.push(`not on the closed command list: ${line}`);
        if (command === "set" && !/^set filetype=(?:ascii|binary)$/.test(line)) offending.push(`not a file-type setting: ${line}`);
        if (command === "write" && !plainRelativeFileName(target)) offending.push(`a write target outside the run directory: ${line}`);
      }
      if (control) offending.push(`an unclosed control block: ${lines[0]}`);
    }
    expect(offending).toEqual([]);
    // every run names its deck by an identifier bound only to such a literal (or a for-of over one array of them), never reassigned
    const calls = [...masked.matchAll(/runDiagnosticNgspice\(\{([^{}]*)\}\)/g)].map((match) => match[1]!);
    expect(calls, "every runDiagnosticNgspice call is read").toHaveLength(masked.match(/runDiagnosticNgspice\(/g)!.length);
    expect(calls.length).toBeGreaterThanOrEqual(19);
    const bindings = (name: string): string[] => [...masked.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+${name}\s*=\s*([^;]*);`, "g"))].map((match) => match[1]!.trim());
    const assignments = (name: string): number => masked.match(new RegExp(String.raw`(?<![\w.$])${name}\s*=(?![=>])`, "g"))?.length ?? 0;
    const unproven: string[] = [];
    for (const call of calls) {
      const property = /(?:^|,)\s*deck\s*(?::\s*([^,]*?))?\s*(?:,|$)/.exec(call);
      const name = property ? (property[1] ?? "deck").trim() : "";
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { unproven.push(`a deck that is not a named literal: ${call.trim()}`); continue; }
      const constants = bindings(name);
      const loops = [...masked.matchAll(new RegExp(String.raw`\bfor\s*\(\s*(?:const|let|var)\s+${name}\s+of\s+(\w+)\s*\)`, "g"))].map((match) => match[1]!);
      const proven = constants.length + loops.length > 0
        && constants.every((value) => value === "DECK")
        && assignments(name) === constants.length
        && loops.every((array) => bindings(array).length === 1 && /^\[\s*DECK(?:\s*,\s*DECK)*\s*,?\s*\]$/.test(bindings(array)[0]!) && assignments(array) === 1);
      if (!proven) unproven.push(`${name}: bound to something other than an ngspiceDeck literal`);
    }
    expect(unproven).toEqual([]);
    // [B22-D review] tests-4: case 12's positive control is ASSERTED before the canary check it makes meaningful - a run where `echo`
    // does not expand $TZ fails as not measured, never passes as contained
    const control = live.indexOf('.toContain("B22D-TZ=UTC");');
    expect(control, "case 12 asserts its positive control").toBeGreaterThan(0);
    expect(control).toBeLessThan(live.indexOf("expect(output.includes(value)"));
    // every write primitive in the live suite is rooted at its scratch root or the runner's run directory (the B11.5 admission)
    const WRITERS = /\b(?:writeFileSync|mkdirSync|rmSync|appendFileSync|unlinkSync|cpSync|rmdirSync|createWriteStream|symlinkSync|linkSync|mkdtempSync)\s*\(/;
    const unrooted = live.split(NL).filter((line) => WRITERS.test(line) && !/^\s*(?:\*|\/\/|import)/.test(line) && !/\b(?:scratch|runDir)\b/.test(line));
    expect(unrooted).toEqual([]);
    expect(live).toContain('mkdtempSync(join(tmpdir(), "sirkit-b22-d-live-"))');
    // the B11.5 write gate admits it by that same rule
    expect(read("app/lib/agent/__tests__/b11-5-capture-exactness.test.ts")).toContain('"b22-d-adversarial-live.test.ts": (source) =>');
  });
});
