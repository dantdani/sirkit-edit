/**
 * [B22-A3] The diagnostic-only local runner (runbook B22-A :906; discovery D22-5 profile env, D22-8, D22-9, D22-11 runtime;
 * OD-135, OD-136, OD-145): the ONE module that starts ngspice. `/api/simulate`, the SPICE Studio worker (its run and its `-v`
 * probe) and the model smoke test call it; none of them imports `child_process` any more.
 *
 * It EXECUTES the B22-A2 profile `ngspice-local-diagnostic` (never consults it): the executable is the install the server
 * settings pin (`SIRKIT_NGSPICE_INSTALL_ROOT`, `SIRKIT_NGSPICE_INSTALL_SHA256`), never `NGSPICE_BIN` or PATH, and its
 * install-tree digest (A2's `installTreeDigest`) must equal the pinned one before every spawn - cached per process, re-hashed when
 * a cheap stat fingerprint of the tree changes; argv comes from the profile's templates (`-n`: no `.spiceinit` is read); the
 * environment PASSED is EXACTLY the profile's map (`LC_ALL=C`, `TZ=UTC`, no HOME or USERPROFILE in it) - [B22-A3 review]
 * security-1: on win32 Node (libuv) then copies the server's value of each variable it requires that the map lacks (eight names,
 * `WIN32_NODE_REQUIRED_ENV`), so the child's environment is the map plus those, and every record names them
 * (`hostAddedEnvironment`); every run deck carries the profile's seed option and no seed of its own; each run gets its own
 * `mkdtemp` directory under one runner root, removed in `finally` on every path; stdout and stderr are redacted as they stream and
 * held within A1's bound; the raw output is read back through the bounded reader lifted from `/api/simulate`; the wall clock and
 * an abort end the whole process tree (win32 `taskkill /PID <pid> /T /F`, POSIX a process-group kill); a run is terminal only once
 * the child's `close` is observed, or as `kill_unconfirmed` after a bounded wait; one global cap bounds how many ngspice processes
 * run at once across every entry point, shared by holder (the caller's tenant) with every wait for a slot bounded.
 *
 * What it is NOT: an isolation boundary. The child runs as the server user with no OS limit on CPU, memory, processes, files or
 * network (no job object, OD-145); the deck screens (SEC-1, B22-A1) are the prevention. Every result is labelled
 * `diagnostic_only` and `environment_dependent`; nothing here is authoritative, and production simulation authority stays
 * BLOCKED (the CD-10 501; `executeAuthoritativeSimulation` throws).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, win32 } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { boundDiagnosticText, createDiagnosticCollector, readBoundedFile } from "./output-bounds";
import { INSTALL_TREE_DIGEST_ALGORITHM, InstallTreeDigestError, installTreeDigest, runtimeProfile, type RuntimeProfile } from "./runtime-profile";

/** [B22-A3] The profile this runner executes (the only one it can). */
export const DIAGNOSTIC_RUNNER_PROFILE_ID = "ngspice-local-diagnostic" as const;
/** [B22-A3] Every result carries both labels: a diagnostic run is never authoritative, and its numbers depend on the host. */
export const DIAGNOSTIC_RESULT_LABELS = Object.freeze(["diagnostic_only", "environment_dependent"] as const);
/** [B22-A3] The server-chosen names inside a run directory: the deck the server writes, the raw file the deck writes. */
export const DIAGNOSTIC_DECK_FILE = "deck.cir";
export const DIAGNOSTIC_RAW_OUTPUT_FILE = "result.raw";
/** [B22-A3] The one runner root under the OS temp directory; each run is a `mkdtemp` directory inside it. */
export const DIAGNOSTIC_RUNNER_ROOT_NAME = "sirkit-ngspice-runs";
/** [B22-A3] The global cap: at most this many ngspice processes at once, across every entry point and batch. */
export const DIAGNOSTIC_RUNNER_MAX_RUNNING = 4;
/** [B22-A3] Requests over the cap wait in one queue of at most this many; one more is refused (`NGSPICE_DIAGNOSTIC_BUSY`). */
export const DIAGNOSTIC_RUNNER_MAX_QUEUED = 64;
/** [B22-A3 review] security-2: one holder (the server-derived tenant a caller passes) runs at most this many at once, so one tenant
 *  never holds every slot and another tenant's request always finds one that tenant cannot take. */
export const DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER = 3;
/** [B22-A3 review] security-2: and has at most this many waiting: one tenant never fills the queue the others need. */
export const DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER = 32;
/** [B22-A3 review] regressions-1, security-2: the longest any request waits for a slot - a full queue drained by slots each held
 *  one profile wall clock plus the kill-confirm wait, (64 / 4) x (120 s + 5 s); a longer wait means slots are held by processes
 *  whose exit was not observed. A request's own wait defaults to its wall clock; the Studio worker alone asks for this one. */
export const DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS = 2_000_000;
/** [B22-A3] How long the runner waits for the child's `close` after a tree kill before it reports `kill_unconfirmed`. */
export const DIAGNOSTIC_KILL_CONFIRM_MS = 5_000;
/** [B22-A3] The `-v` probe's wall clock (the worker's former 2 s probe bound), within the profile's. */
export const DIAGNOSTIC_VERSION_WALL_CLOCK_MS = 2_000;
/** [B22-A3 review] security-1: the variables libuv requires in a win32 child's environment (`required_vars`, src/win/process.c):
 *  Node copies the server's value of each one the passed environment lacks (RECORDED from libuv; CONFIRMED on this host by the
 *  review's benign probe). The profile's map passes PATH, SystemRoot and TEMP, so the other eight come from the server. */
export const WIN32_NODE_REQUIRED_ENV = Object.freeze(["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PATH", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"] as const);

export type DiagnosticRunnerErrorCode =
  | "NGSPICE_DIAGNOSTIC_UNPINNED"
  | "NGSPICE_DIAGNOSTIC_INSTALL_ROOT_UNSET"
  | "NGSPICE_DIAGNOSTIC_INSTALL_UNREADABLE"
  | "NGSPICE_DIAGNOSTIC_DIGEST_MISMATCH"
  | "NGSPICE_DIAGNOSTIC_PLATFORM_UNSUPPORTED"
  | "NGSPICE_DIAGNOSTIC_SYSTEM_ROOT_UNKNOWN"
  | "NGSPICE_DIAGNOSTIC_BUSY"
  | "NGSPICE_DIAGNOSTIC_DECK_REFUSED"
  | "NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED" | "NGSPICE_DIAGNOSTIC_DISABLED"; // [B24-A1] OD-200: the operator switched the runner off (SIRKIT_DIAGNOSTIC_RUNNER_DISABLED)

/** [B22-A3] A refusal before any spawn: a closed code and a fixed text that names the server setting, never a value or a path. */
export class DiagnosticRunnerError extends Error {
  readonly code: DiagnosticRunnerErrorCode;
  constructor(code: DiagnosticRunnerErrorCode, text: string) {
    super(`${code}: ${text}`);
    this.name = "DiagnosticRunnerError";
    this.code = code;
  }
}

export type DiagnosticOutcome = "exited" | "timeout" | "cancelled" | "kill_unconfirmed" | "spawn_failed";
export type DiagnosticRawRead =
  | { readonly state: "read"; readonly text: string }
  | { readonly state: "not-requested" | "skipped" | "missing" | "over-limit" | "invalid-utf8" | "not-a-plain-file" };

/** [B22-A3] What one run produced. No absolute host path: the run id is opaque and both host directories are redacted from the output. */
export interface DiagnosticRunRecord {
  readonly runId: string;
  readonly profileId: typeof DIAGNOSTIC_RUNNER_PROFILE_ID;
  readonly profileDigest: string;
  /** `sirkit-install-tree-sha256/1:<hex>`, observed before the spawn; null when the run ended before the check. */
  readonly installDigest: string | null;
  readonly labels: typeof DIAGNOSTIC_RESULT_LABELS;
  readonly operation: "run" | "version";
  readonly outcome: DiagnosticOutcome;
  readonly spawned: boolean;
  /** [B22-A3 review] coverage-1: why the runner killed the tree (its wall clock, or an abort); null when it killed nothing. */
  readonly killReason: "timeout" | "cancelled" | null;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly raw: DiagnosticRawRead;
  /** The wall clock applied: the profile's, or a caller's tighter one. */
  readonly wallClockMs: number;
  /** [B22-A3 review] security-1: the variables Node copies from the server process into the child (names only, never a value): on
   *  win32 each libuv-required name the profile's map lacks; none elsewhere. */
  readonly hostAddedEnvironment: readonly string[];
}

/** [B22-A3 review] security-2, regressions-1: how a request shares the cap. Server values only, never request data. */
interface DiagnosticQueueOptions {
  /** The server-derived tenant the request belongs to (its share of the cap); "" for a caller with none. */
  readonly holder?: string;
  /** How long the request may wait for a slot before it is refused `NGSPICE_DIAGNOSTIC_BUSY`: by default its own wall clock; never
   *  more than `DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS`. */
  readonly queueWaitMs?: number;
  /** [B22-A3 lead] A short request a person waits on (`/api/simulate`, the smoke test; each bounded by its own wall clock): it takes a
   *  free slot under the global cap even when its holder is at its running share, so a tenant's own Studio plan cannot refuse that
   *  tenant's Simulate while a slot sits idle. Batch requests (the Studio worker's points and its `-v` probe) keep the share. */
  readonly interactive?: boolean;
}

/** [B22-A3] Server callers only (never request data): bounds may only be TIGHTER than the profile's. */
export type DiagnosticRunRequest =
  | ({
      readonly operation: "run";
      /** The screened deck, ending with the profile's seed option and `.end` (`seedDiagnosticDeck`), setting no seed of its own. */
      readonly deck: string;
      /** Read `result.raw` back after a zero exit. */
      readonly readRaw: boolean;
      readonly wallClockMs?: number;
      readonly readBackBytes?: number;
      readonly killConfirmMs?: number;
      readonly signal?: AbortSignal;
      readonly onOutput?: (channel: "stdout" | "stderr", chunk: string) => void;
    } & DiagnosticQueueOptions)
  | ({ readonly operation: "version"; readonly killConfirmMs?: number; readonly signal?: AbortSignal } & DiagnosticQueueOptions);

/** [B22-A3] What the runner reads from its host. Tests replace it (`__setDiagnosticRunnerHostForTests`); production never does. */
export interface DiagnosticRunnerHost {
  /** `win32-x64`, `linux-x64`, ...: compared with the profile's executable platform. */
  platform(): string;
  /** The Windows directory (`{systemRoot}`); undefined off Windows. */
  systemRoot(): string | undefined;
}
const NODE_HOST: DiagnosticRunnerHost = Object.freeze({ platform: () => `${process.platform}-${process.arch}`, systemRoot: () => process.env.SystemRoot });
let host: DiagnosticRunnerHost = NODE_HOST;

interface Waiter { readonly holder: string; readonly interactive: boolean; readonly grant: () => void }
interface RunnerState {
  running: number;
  /** [B22-A3 review] security-2: the running count of each holder. */
  readonly runningBy: Map<string, number>;
  readonly waiting: Waiter[];
  pin: { readonly key: string; readonly fingerprint: string; readonly observed: string } | null;
  /** [B22-A3 review] security-2: the early pin check in flight, shared by every concurrent caller. */
  checking: { readonly key: string; readonly promise: Promise<string> } | null;
  readonly versions: Map<string, string>;
  digestComputations: number;
  installChecks: number;
}
/** One counter and one cache per server process (the job store's precedent: they survive a dev module reload). [B22-A3 review] v2:
 *  the holder shares and the shared pin check. */
const stateKey = Symbol.for("sirkit.computation.diagnostic-runner.v2");
const globalObject = globalThis as typeof globalThis & { [stateKey]?: RunnerState };
const state: RunnerState = globalObject[stateKey] ?? { running: 0, runningBy: new Map(), waiting: [], pin: null, checking: null, versions: new Map(), digestComputations: 0, installChecks: 0 };
globalObject[stateKey] = state;

/** The profile's seed and the line that pins it (`.options seed=1`), written immediately before a run deck's final `.end`. */
const PROFILE_SEED = runtimeProfile(DIAGNOSTIC_RUNNER_PROFILE_ID, () => undefined).determinism.seed.value!;
const SEED_LINE = `.options seed=${PROFILE_SEED}`;
const END_LINE = /^\s*\.end\s*$/i;
const OPTION_LINE = /^\.opt\w*/i;
const SEED_WORD = /\b(?:rnd)?seed\b/i;

/** The index of the deck's final `.end` line, when nothing but blank lines follows it; -1 otherwise. */
function finalEndLine(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (END_LINE.test(lines[index]!)) return index;
    if (lines[index]!.trim() !== "") return -1;
  }
  return -1;
}
/** [B22-A3 review] regressions-4: the index of a line, other than `skip`, that sets ngspice's random seed itself - an option line
 *  (`.opt`, `.option`, `.options`, any case) or a `+` line continuing one, naming `seed` or `rndseed` anywhere (a seed in its
 *  trailing comment counts: refused, never guessed) - or -1. Comment and blank lines do not end an option line's continuation. */
function ownSeedLine(lines: readonly string[], skip: number): number {
  let option = false;
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!.trim();
    if (text === "" || text.startsWith("*")) continue;
    if (!text.startsWith("+")) option = OPTION_LINE.test(text);
    if (option && index !== skip && SEED_WORD.test(text)) return index;
  }
  return -1;
}
const deckRefused = (): DiagnosticRunnerError => new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_DECK_REFUSED", "a run deck ends with the profile's seed option and its .end line");
const ownSeedRefused = (): DiagnosticRunnerError => new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_DECK_REFUSED", `a run deck may not set its own seed: the profile pins it (${SEED_LINE})`);

/** [B22-A3] `deck` with the profile's seed option inserted before its final `.end` (D22-11: the seed is pinned by the deck the runner
 *  executes). Callers screen the seeded deck, so the deck written is the deck screened; a deck without a final `.end` is refused,
 *  and [B22-A3 review] regressions-4 so is one that sets its own seed (two seed options would leave the effective one unprobed). */
export function seedDiagnosticDeck(deck: string): string {
  const lines = deck.split("\n");
  const end = finalEndLine(lines);
  if (end < 1) throw deckRefused();
  if (ownSeedLine(lines, -1) >= 0) throw ownSeedRefused();
  return [...lines.slice(0, end), SEED_LINE, ...lines.slice(end)].join("\n");
}

/** [B22-A3] The provenance a caller attaches to a response or a record. [B22-A3 review] regressions-4, security-1: with the effective
 *  seed (the profile's; a deck with its own is refused) and the variables Node added on win32. */
export function diagnosticProvenance(record: DiagnosticRunRecord): { profileId: string; installDigest: string | null; labels: string[]; seed: string; hostAddedEnvironment: string[] } {
  return { profileId: record.profileId, installDigest: record.installDigest, labels: [...record.labels], seed: PROFILE_SEED, hostAddedEnvironment: [...record.hostAddedEnvironment] };
}

// ── the bounded raw read (lifted from /api/simulate, B16.0.24.1 §1) ─────────────────────────────────────────────────────

export type BoundedRawRead =
  | { ok: true; text: string }
  | { ok: false; reason: "over-limit" | "invalid-utf8" | "unreadable" };

/**
 * [B16.0.24.1 §1, lifted by B22-A3] A TRULY bounded read of the simulator's raw output, over A1's bounded reader: the declared size
 * is an advisory fast-fail, storage grows with the bytes actually read, crossing `maxBytes` refuses whole (partial output is never
 * returned, so parsing never begins on it), invalid UTF-8 fails deterministically (a fatal decode), and the handle closes on every path.
 */
export async function readBoundedRawFile(path: string, maxBytes: number): Promise<BoundedRawRead> {
  const read = await readBoundedFile(path, maxBytes);
  if (!read.ok) return { ok: false, reason: read.reason };
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(read.bytes) };
  } catch {
    return { ok: false, reason: "invalid-utf8" };
  }
}

// ── the pinned install ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Preflight { readonly root: string; readonly systemRoot: string; readonly win32: boolean }

/** The checks that need no file: the host's platform is the profile's, the Windows directory is known, both settings are set. */
function preflight(profile: RuntimeProfile): Preflight {
  refuseIfDiagnosticRunnerSwitchedOff(); const platform = host.platform(); // [B24-A1] OD-200: the operator's off switch, before the host is read (verifyDiagnosticInstall's entry)
  if (platform !== profile.executable.platform) throw new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_PLATFORM_UNSUPPORTED", `the ${profile.profileId} profile runs on ${profile.executable.platform} only`);
  const win32Host = platform.startsWith("win32-");
  const systemRoot = host.systemRoot() ?? "";
  if (win32Host && !/^[A-Za-z]:\\[^;%"]*$/.test(systemRoot)) throw new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_SYSTEM_ROOT_UNKNOWN", "the host's Windows directory (SystemRoot) is not an absolute path");
  const { digestSetting, installRootSetting, expectedDigest } = profile.executable;
  if (expectedDigest.state !== "pinned" || expectedDigest.value === null) {
    throw new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_UNPINNED", `no install is pinned: set ${digestSetting} to the install-tree digest of the install in ${String(installRootSetting)} (scripts/print-install-tree-digest.ts prints it)`);
  }
  const setting = installRootSetting === null ? "" : (process.env[installRootSetting] ?? "").trim();
  if (setting === "" || !isAbsolute(setting)) throw new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_INSTALL_ROOT_UNSET", `set ${String(installRootSetting)} to the absolute path of the pinned ngspice install`);
  return { root: resolve(setting), systemRoot, win32: win32Host }; // the host's own spelling, for the spawn and for the redaction
}

/**
 * A cheap fingerprint of the install: every entry's relative path, type, size, modification and change times and file id, from
 * exact (bigint) stats, with no file read. A link anywhere is refused, as the digest refuses it. When it equals the fingerprint
 * taken around the last full digest, the cached digest stands; any change re-hashes.
 */
async function installFingerprint(root: string, members: readonly string[] | null): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (full: string, relativePath: string): Promise<void> => {
    const stat = await lstat(full, { bigint: true });
    if (stat.isSymbolicLink()) throw new InstallTreeDigestError("INSTALL_TREE_LINK", "a link in the install tree");
    const kind = stat.isDirectory() ? "d" : stat.isFile() ? "f" : "x";
    hash.update(`${JSON.stringify([relativePath, kind, String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs), String(stat.ino)])}\n`);
    if (kind === "d") for (const name of (await readdir(full)).sort()) await visit(join(full, name), `${relativePath}/${name}`);
  };
  const rootStat = await lstat(root).catch(() => null);
  if (rootStat === null || !rootStat.isDirectory()) throw new InstallTreeDigestError("INSTALL_TREE_ROOT_NOT_DIRECTORY", "the install root is not a directory");
  const listing = (await readdir(root)).sort();
  for (const name of members ?? listing) {
    if (!listing.includes(name)) throw new InstallTreeDigestError("INSTALL_TREE_MEMBER_MISSING", "a digest member is not an entry of the install root");
    await visit(join(root, name), name);
  }
  return hash.digest("hex");
}

const pinKey = (profile: RuntimeProfile, root: string): string => JSON.stringify([root, profile.executable.expectedDigest.value, profile.executable.digestMembers]);

/** The install's observed digest, equal to the pinned one, or a closed refusal (OD-135). Called before every spawn. */
async function verifiedInstall(profile: RuntimeProfile, root: string): Promise<string> {
  state.installChecks += 1;
  const expected = profile.executable.expectedDigest.value!;
  const members = profile.executable.digestMembers;
  const unreadable = (error: unknown): DiagnosticRunnerError => new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_INSTALL_UNREADABLE", `the pinned install could not be identified (${error instanceof InstallTreeDigestError ? error.code : "INSTALL_TREE_UNREADABLE"})`);
  const key = pinKey(profile, root);
  let observed: string;
  try {
    const fingerprint = await installFingerprint(root, members);
    if (state.pin?.key === key && state.pin.fingerprint === fingerprint) observed = state.pin.observed;
    else {
      const digest = await installTreeDigest(root, { members });
      state.digestComputations += 1;
      if ((await installFingerprint(root, members)) !== fingerprint) throw new InstallTreeDigestError("INSTALL_TREE_CHANGED", "the install changed while it was hashed");
      observed = digest.sha256;
      state.pin = { key, fingerprint, observed };
    }
  } catch (error) {
    throw unreadable(error);
  }
  if (observed !== expected) throw new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_DIGEST_MISMATCH", `the install does not match ${profile.executable.digestSetting}; nothing was run`);
  return `${INSTALL_TREE_DIGEST_ALGORITHM}:${observed}`;
}

// ── the global cap, shared by holder ────────────────────────────────────────────────────────────────────────────────────

const heldBy = (holder: string): number => state.runningBy.get(holder) ?? 0;
function take(holder: string): void {
  state.running += 1;
  state.runningBy.set(holder, heldBy(holder) + 1);
}
/** [B22-A3 review] security-2, tests-6: free slots go to waiters whose holder is under its share - the holder with the fewest
 *  running first, and FIFO within a holder (an earlier waiter wins every tie). */
function grantWaiters(): void {
  while (state.running < DIAGNOSTIC_RUNNER_MAX_RUNNING) {
    let next = -1;
    for (let index = 0; index < state.waiting.length; index += 1) {
      const held = heldBy(state.waiting[index]!.holder);
      if (held >= DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER && !state.waiting[index]!.interactive) continue; // [B22-A3 lead] an interactive request ignores the share
      if (next < 0 || held < heldBy(state.waiting[next]!.holder)) next = index;
    }
    if (next < 0) return;
    state.waiting.splice(next, 1)[0]!.grant();
  }
}
const busy = (text: string): DiagnosticRunnerError => new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_BUSY", `${text}; nothing was run`);

/** A slot under the cap and the holder's share, or "cancelled" when the signal aborts while the request waits. Over the queue bound
 *  or the holder's queue share: refused at once; [B22-A3 review] regressions-1: a wait longer than `waitMs`: refused then. */
function acquireSlot(holder: string, waitMs: number, signal?: AbortSignal, interactive = false): Promise<"granted" | "cancelled"> {
  if (signal?.aborted) return Promise.resolve("cancelled");
  // every waiter is at its holder's share whenever a slot is free (grantWaiters runs at each release), so this takes no one's turn
  if (state.running < DIAGNOSTIC_RUNNER_MAX_RUNNING && (interactive || heldBy(holder) < DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER)) {
    take(holder);
    return Promise.resolve("granted");
  }
  if (state.waiting.length >= DIAGNOSTIC_RUNNER_MAX_QUEUED) {
    return Promise.reject(busy(`the diagnostic runner is at its cap (${DIAGNOSTIC_RUNNER_MAX_RUNNING} running, ${DIAGNOSTIC_RUNNER_MAX_QUEUED} waiting)`));
  }
  if (state.waiting.filter((waiter) => waiter.holder === holder).length >= DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER) {
    return Promise.reject(busy(`this tenant's share of the diagnostic runner is full (${DIAGNOSTIC_RUNNER_MAX_RUNNING_PER_HOLDER} running, ${DIAGNOSTIC_RUNNER_MAX_QUEUED_PER_HOLDER} waiting)`));
  }
  return new Promise((resolveSlot, rejectSlot) => {
    const leave = (): void => {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      const index = state.waiting.indexOf(entry);
      if (index >= 0) state.waiting.splice(index, 1);
    };
    const entry: Waiter = {
      holder,
      interactive,
      grant: () => {
        leave();
        take(holder);
        resolveSlot("granted");
      },
    };
    const onAbort = (): void => {
      leave();
      resolveSlot("cancelled");
    };
    const deadline = setTimeout(() => {
      leave();
      rejectSlot(busy(`no slot came free within this request's wait of ${waitMs} ms`));
    }, waitMs);
    state.waiting.push(entry);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function releaseSlot(holder: string): void {
  state.running = Math.max(0, state.running - 1);
  const held = heldBy(holder) - 1;
  if (held > 0) state.runningBy.set(holder, held);
  else state.runningBy.delete(holder);
  grantWaiters();
}

// ── the process ─────────────────────────────────────────────────────────────────────────────────────────────────────────

interface ProcessEnd {
  readonly outcome: DiagnosticOutcome;
  readonly killReason: "timeout" | "cancelled" | null;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Settles once the child's `close` is observed (at once when it never started). */
  readonly closed: Promise<void>;
}

/**
 * [B22-A3] OD-145: end the child's whole tree. win32: the runner's own `taskkill /PID <pid> /T /F` (a fixed, server-built argv:
 * the absolute taskkill under the Windows directory, the child's pid), then the direct child as a fallback once taskkill ends;
 * POSIX: SIGKILL to the process group the detached child leads, the direct child only when the group is gone. A child with no pid
 * (never started) gets the direct kill only. Exported for its own test: no POSIX profile exists, so no run reaches that branch.
 * [B22-A3 review] security-1: taskkill too receives the libuv-required variables its map lacks - [B22-A3 lead] ten, not eight: its map passes only SystemRoot, so PATH and TEMP come from the server too.
 */
export function killDiagnosticProcessTree(child: ChildProcess, place: { readonly win32: boolean; readonly systemRoot: string }, alive: () => boolean): void {
  const direct = (): void => {
    if (!alive()) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // the outcome records whether the exit was observed
    }
  };
  const pid = child.pid;
  if (pid === undefined) return direct();
  if (place.win32) {
    try {
      // taskkill's one variable; the cast only satisfies Next's ProcessEnv augmentation (it declares NODE_ENV, which is not passed)
      const systemRootOnly = { SystemRoot: place.systemRoot } as unknown as NodeJS.ProcessEnv;
      const killer = spawn(win32.join(place.systemRoot, "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { env: systemRootOnly, windowsHide: true, shell: false, stdio: "ignore" });
      killer.once("error", direct);
      killer.once("close", direct);
    } catch {
      direct();
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    direct();
  }
}

/** Each host path (with either slash) and its placeholder, the longest first. */
type RedactionPairs = ReadonlyArray<readonly [string, string]>;
function redactionPairs(paths: ReadonlyArray<readonly [string, string]>): RedactionPairs {
  return paths
    .flatMap(([path, placeholder]) => [[path.split("/").join(BACKSLASH), placeholder], [path.split(BACKSLASH).join("/"), placeholder]] as const)
    .filter(([path], index, all) => path.length > 0 && all.findIndex(([other]) => other === path) === index)
    .sort((a, b) => b[0].length - a[0].length);
}
const BACKSLASH = String.fromCharCode(92);
/** The shortest trailing path fragment `end()` replaces by its placeholder (one or two characters, a drive letter, are left). */
const MIN_PATH_FRAGMENT = 3;

/**
 * [B22-A3 review] security-4, coverage-4, tests-7: redacts a stream as it arrives, not chunk by chunk. Each piece `write` returns has
 * every complete host path replaced; a trailing piece that could begin a host path (at most the longest path less one character)
 * is held until the next read completes or disproves it, so a path split across two pipe reads is replaced whole. `end` returns
 * what is held, a host-path fragment replaced by its placeholder. The collector and the progress callback receive these pieces
 * only, so the collector's head cut can no longer leave a path fragment either.
 */
function streamRedactor(pairs: RedactionPairs): { write(chunk: string): string; end(): string } {
  const longest = pairs.reduce((max, [path]) => Math.max(max, path.length), 0);
  let held = "";
  /** The length of the longest end of `text` that is a proper beginning of a host path. */
  const pending = (text: string): number => {
    for (let length = Math.min(longest - 1, text.length); length > 0; length -= 1) {
      const tail = text.slice(text.length - length);
      if (pairs.some(([path]) => path.length > length && path.startsWith(tail))) return length;
    }
    return 0;
  };
  return {
    write(chunk) {
      const text = pairs.reduce((out, [path, placeholder]) => out.split(path).join(placeholder), held + chunk);
      const keep = pending(text);
      held = text.slice(text.length - keep);
      return text.slice(0, text.length - keep);
    },
    end() {
      const rest = held;
      held = "";
      const fragmentOf = rest.length >= MIN_PATH_FRAGMENT ? pairs.find(([path]) => path.startsWith(rest)) : undefined;
      return fragmentOf ? fragmentOf[1] : rest;
    },
  };
}

function runProcess(input: {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  /** EXACTLY the profile's map (no NODE_ENV: the type is Node's, as Next augments it, the value is the profile's). */
  readonly env: NodeJS.ProcessEnv;
  readonly place: Preflight;
  readonly wallClockMs: number;
  readonly killConfirmMs: number;
  /** The profile's `outputBytes`: each of stdout and stderr is held to twice it and returned within it (A1's collector). */
  readonly outputBytes: number;
  readonly signal?: AbortSignal;
  /** The host paths no output may carry, with their placeholders. */
  readonly redaction: RedactionPairs;
  readonly onOutput?: (channel: "stdout" | "stderr", chunk: string) => void;
}): Promise<ProcessEnd> {
  return new Promise((resolve) => {
    const collected = { stdout: createDiagnosticCollector(input.outputBytes), stderr: createDiagnosticCollector(input.outputBytes) };
    const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    const streams = { stdout: streamRedactor(input.redaction), stderr: streamRedactor(input.redaction) };
    let isClosed = false;
    let markClosed: () => void = () => {};
    const closed = new Promise<void>((resolveClosed) => {
      markClosed = () => {
        isClosed = true;
        resolveClosed();
      };
    });
    let child: ChildProcess;
    try {
      child = spawn(input.executable, [...input.argv], { cwd: input.cwd, env: { ...input.env }, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: !input.place.win32 });
    } catch {
      markClosed();
      resolve({ outcome: "spawn_failed", killReason: null, exitCode: null, stdout: "", stderr: "", closed });
      return;
    }
    let settled = false;
    let killReason: "timeout" | "cancelled" | null = null;
    let confirm: ReturnType<typeof setTimeout> | undefined;
    const wall = setTimeout(() => kill("timeout"), input.wallClockMs); // fires only after this executor returns: `kill` is defined below
    /** A redacted piece reaches the collector and the caller's progress callback alike. */
    const deliver = (channel: "stdout" | "stderr", piece: string): void => {
      if (piece === "") return;
      collected[channel].append(piece);
      input.onOutput?.(channel, piece);
    };
    const finish = (outcome: DiagnosticOutcome, exitCode: number | null): void => {
      if (settled) return;
      // what is still held (an incomplete character, a trailing path fragment) is delivered, redacted, before the run settles
      for (const channel of ["stdout", "stderr"] as const) deliver(channel, `${streams[channel].write(decoders[channel].end())}${streams[channel].end()}`);
      settled = true;
      clearTimeout(wall);
      clearTimeout(confirm);
      input.signal?.removeEventListener("abort", onAbort);
      const text = (channel: "stdout" | "stderr"): string => boundDiagnosticText(collected[channel].text(), input.outputBytes);
      resolve({ outcome, killReason, exitCode, stdout: text("stdout"), stderr: text("stderr"), closed });
    };
    for (const channel of ["stdout", "stderr"] as const) {
      child[channel]?.on("data", (data: Buffer | string) => {
        if (settled) return; // [B22-A3 review] security-3: a settled run (kill_unconfirmed) hands a caller nothing more
        deliver(channel, streams[channel].write(typeof data === "string" ? data : decoders[channel].write(data)));
      });
    }
    child.on("error", () => {
      // a child that never started (no pid) is terminal now; a failed kill is not: the close or the bounded wait decides
      if (child.pid !== undefined || isClosed) return;
      markClosed();
      finish("spawn_failed", null);
    });
    child.on("close", (code: number | null) => {
      markClosed();
      finish(killReason ?? "exited", typeof code === "number" ? code : null);
    });
    const kill = (reason: "timeout" | "cancelled"): void => {
      if (killReason !== null || settled) return;
      killReason = reason;
      killDiagnosticProcessTree(child, input.place, () => !isClosed);
      confirm = setTimeout(() => finish("kill_unconfirmed", null), input.killConfirmMs);
    };
    const onAbort = (): void => kill("cancelled");
    if (input.signal?.aborted) onAbort();
    else input.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const tighter = (bound: number, requested: number | undefined): number => (typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? Math.min(bound, Math.floor(requested)) || 1 : bound);
/** A template filled with server values only; any other placeholder is a contract break, never filled. */
function filled(template: readonly string[], values: Readonly<Record<string, string>>): string[] {
  return template.map((element) => element.replace(/\{[^{}]*\}/g, (token) => {
    const value = values[token];
    if (value === undefined) throw new Error(`B22-A3: the diagnostic runner fills no ${token}`);
    return value;
  }));
}
const NO_NAMES: readonly string[] = Object.freeze([]);
/** [B22-A3 review] security-1: the libuv-required names a win32 child gets from the server because `environment` lacks them. */
function win32AddedEnvironment(environment: Readonly<Record<string, string>>): readonly string[] {
  const passed = new Set(Object.keys(environment).map((key) => key.toUpperCase()));
  return Object.freeze(WIN32_NODE_REQUIRED_ENV.filter((name) => !passed.has(name)));
}
/** [B22-A3 review] coverage-2, tests-5, security-4: Node's fs messages name the absolute path; the refusal names the errno only. */
function runDirectoryFailed(error: unknown): DiagnosticRunnerError {
  const code = (error as { code?: unknown } | null)?.code;
  return new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED", `the run directory could not be prepared (${typeof code === "string" && /^E[A-Z0-9]{1,24}$/.test(code) ? code : "UNKNOWN"}); nothing was run`);
}

/**
 * [B22-D] item 4 (D22-8's open link at the runner root): the runner creates its root, or - when one exists already (EEXIST) - runs
 * only if `lstat`, which never follows a link, shows a plain directory there. A link, a junction (Node's `lstat` reports one as a
 * link: CONFIRMED by b22-a2-runtime-profile case 5's real junction) or a file at the root is refused before any run directory, so no
 * pre-planted link moves every run directory elsewhere. A root this call just created needs no check. RECORDED: a process of the
 * server user can still replace the root between this check and `mkdtemp` (the runner is no boundary against one); with no POSIX
 * profile, a root another user owns is not checked (`lstat`'s owner and mode would be the POSIX guard).
 */
async function ensureRunnerRoot(root: string): Promise<void> {
  try {
    await mkdir(root);
    return;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== "EEXIST") throw error;
  }
  const stat = await lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED", "the runner root is a link, a junction or not a directory; nothing was run");
}

/**
 * [B22-D] items 4, 5: the raw file is read back only when `lstat` shows a plain file with one name - never a link or a junction, a
 * hardlink (a second name, which may lie outside the run directory), a directory, or a device, FIFO or socket (`not-a-plain-file`,
 * never opened); absent, or unreadable to `lstat`, it is missing, as before. RECORDED: this check and the bounded read's `open` are
 * two steps, so a process of the server user could swap the file between them; ngspice has exited by then.
 */
async function rawFileKind(path: string): Promise<"plain" | "missing" | "not-a-plain-file"> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(path);
  } catch {
    return "missing";
  }
  return !stat.isSymbolicLink() && stat.isFile() && stat.nlink === 1 ? "plain" : "not-a-plain-file";
}

/**
 * [B22-A3] Run the pinned ngspice once (`run`: the screened, seeded deck in a fresh run directory; `version`: the `-v` probe in an
 * empty one). Refusals - an unpinned or mismatched install, an unset root, another platform, a full queue or an expired wait, a
 * deck that is not seeded or sets its own seed, a run directory that cannot be prepared - throw a closed `DiagnosticRunnerError`
 * before any spawn; everything else returns a labelled record.
 */
export async function runDiagnosticNgspice(request: DiagnosticRunRequest): Promise<DiagnosticRunRecord> {
  refuseIfDiagnosticRunnerSwitchedOff(); const profile = runtimeProfile(DIAGNOSTIC_RUNNER_PROFILE_ID); // [B24-A1] OD-200: first - before the deck screen, any digest, directory or spawn
  if (request.operation === "run") {
    const lines = typeof request.deck === "string" ? request.deck.split("\n") : [];
    const end = finalEndLine(lines);
    if (end < 1 || lines[end - 1] !== SEED_LINE) throw deckRefused();
    if (ownSeedLine(lines, end - 1) >= 0) throw ownSeedRefused();
  }
  const place = preflight(profile);
  const wallClockMs = tighter(profile.limits.wallClockMs.value!, request.operation === "version" ? DIAGNOSTIC_VERSION_WALL_CLOCK_MS : request.wallClockMs);
  const queueWaitMs = tighter(DIAGNOSTIC_RUNNER_MAX_QUEUE_WAIT_MS, request.queueWaitMs ?? wallClockMs);
  const holder = typeof request.holder === "string" ? request.holder : "";
  const hostAddedEnvironment = place.win32 ? win32AddedEnvironment(profile.environment) : NO_NAMES;
  const base = { runId: `diagrun_${randomUUID()}`, profileId: DIAGNOSTIC_RUNNER_PROFILE_ID, profileDigest: profile.deterministicDigest, labels: DIAGNOSTIC_RESULT_LABELS, operation: request.operation, wallClockMs, hostAddedEnvironment };
  const notRun = (installDigest: string | null): DiagnosticRunRecord => Object.freeze({ ...base, installDigest, outcome: "cancelled" as const, spawned: false, killReason: null, exitCode: null, stdout: "", stderr: "", raw: { state: request.operation === "run" && request.readRaw ? "skipped" as const : "not-requested" as const } });
  if ((await acquireSlot(holder, queueWaitMs, request.signal, request.interactive === true)) === "cancelled") return notRun(null);
  let runDir: string | null = null;
  let holdsSlot = true;
  try {
    const runnerRoot = join(tmpdir(), DIAGNOSTIC_RUNNER_ROOT_NAME);
    try {
      await ensureRunnerRoot(runnerRoot); // [B22-D] item 4: a link, a junction or a file at the root is refused
      runDir = await mkdtemp(join(runnerRoot, "run-"));
      if (request.operation === "run") await writeFile(join(runDir, DIAGNOSTIC_DECK_FILE), request.deck, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      throw error instanceof DiagnosticRunnerError ? error : runDirectoryFailed(error);
    }
    const installDigest = await verifiedInstall(profile, place.root);
    if (request.signal?.aborted) return notRun(installDigest);
    const relative = profile.executable.relativePath.split("/");
    const directory = runDir;
    const env = Object.fromEntries(Object.entries(profile.environment).map(([key, value]) => [key, filled([value], { "{installBinDir}": join(place.root, ...relative.slice(0, -1)), "{systemRoot}": place.systemRoot, "{runDir}": directory })[0]!])) as unknown as NodeJS.ProcessEnv;
    const end = await runProcess({
      executable: join(place.root, ...relative),
      argv: filled(profile.argvTemplates[request.operation]!, { "{deckFile}": DIAGNOSTIC_DECK_FILE }),
      cwd: directory,
      env,
      place,
      wallClockMs,
      killConfirmMs: tighter(DIAGNOSTIC_KILL_CONFIRM_MS, request.killConfirmMs),
      outputBytes: profile.limits.outputBytes.value!,
      signal: request.signal,
      redaction: redactionPairs([[directory, "{runDir}"], [place.root, "{installRoot}"]]),
      onOutput: request.operation === "run" ? request.onOutput : undefined,
    });
    if (end.outcome === "kill_unconfirmed") {
      // the process may live: its slot stays held, and its directory is removed again, once its close is observed
      holdsSlot = false;
      void end.closed.then(async () => {
        releaseSlot(holder);
        await rm(directory, { recursive: true, force: true }).catch(() => {});
      });
    }
    let raw: DiagnosticRawRead = { state: "not-requested" };
    if (request.operation === "run" && request.readRaw) {
      if (end.outcome !== "exited" || end.exitCode !== 0) raw = { state: "skipped" };
      else {
        const kind = await rawFileKind(join(directory, DIAGNOSTIC_RAW_OUTPUT_FILE)); // [B22-D] items 4, 5: a link, a hardlink or a device is never opened
        if (kind !== "plain") raw = { state: kind };
        else {
          const read = await readBoundedRawFile(join(directory, DIAGNOSTIC_RAW_OUTPUT_FILE), tighter(profile.limits.readBackBytes.value!, request.readBackBytes));
          raw = read.ok ? { state: "read", text: read.text } : { state: read.reason === "unreadable" ? "missing" : read.reason };
        }
      }
    }
    return Object.freeze({ ...base, installDigest, outcome: end.outcome, spawned: end.outcome !== "spawn_failed", killReason: end.killReason, exitCode: end.exitCode, stdout: end.stdout, stderr: end.stderr, raw });
  } finally {
    if (runDir !== null) await rm(runDir, { recursive: true, force: true }).catch(() => {});
    if (holdsSlot) releaseSlot(holder);
  }
}

/** [B22-A3] The pin check alone, no process: the observed install digest, or the closed refusal a run would raise (an unpinned or
 *  mismatched install, an unset root, another platform). The worker calls it before it compiles anything. [B22-A3 review]
 *  security-2: it runs outside the cap, so concurrent calls share one check in flight (one stat walk, and one digest when cold). */
export async function verifyDiagnosticInstall(): Promise<string> {
  const profile = runtimeProfile(DIAGNOSTIC_RUNNER_PROFILE_ID);
  const root = preflight(profile).root;
  const key = pinKey(profile, root);
  if (state.checking?.key === key) return state.checking.promise;
  const checking = { key, promise: verifiedInstall(profile, root) };
  state.checking = checking;
  try {
    return await checking.promise;
  } finally {
    if (state.checking === checking) state.checking = null;
  }
}

/** [B22-A3] The pinned ngspice's version line, probed once per observed install digest (`-n -v` through the runner). A refusal
 *  throws, as a run's would; a probe that fails degrades to a fixed text, as the worker's probe always has. `verified` is a digest
 *  `verifyDiagnosticInstall` just returned (the worker's), used only to look the cached line up; a probe verifies again. [B22-A3
 *  review] `holder` and `queueWaitMs` share the cap as a run does (the worker passes its tenant and the runner's longest wait). */
export async function diagnosticNgspiceVersion(options: { readonly signal?: AbortSignal; readonly verified?: string } & DiagnosticQueueOptions = {}): Promise<{ version: string; installDigest: string | null }> {
  const pinned = options.verified ?? (await verifyDiagnosticInstall());
  const cached = state.versions.get(pinned);
  if (cached !== undefined) return { version: cached, installDigest: pinned };
  const record = await runDiagnosticNgspice({ operation: "version", signal: options.signal, holder: options.holder, queueWaitMs: options.queueWaitMs });
  if (record.outcome === "spawn_failed") return { version: "unavailable", installDigest: record.installDigest };
  if (record.outcome === "timeout" || record.outcome === "kill_unconfirmed") return { version: "ngspice (version probe timed out)", installDigest: record.installDigest };
  const line = `${record.stdout}\n${record.stderr}`.split(/\r?\n/).find((text) => /ngspice/i.test(text))?.trim();
  const version = line || "ngspice (version unknown)";
  if (record.outcome === "exited" && record.exitCode === 0 && line && record.installDigest !== null) state.versions.set(record.installDigest, version);
  return { version, installDigest: record.installDigest };
}

/** [B22-A3] The runner's load and its digest work, for tests and diagnostics: counts only, never a path, a holder or a record. */
export function diagnosticRunnerState(): { running: number; queued: number; digestComputations: number; installChecks: number } {
  return { running: state.running, queued: state.waiting.length, digestComputations: state.digestComputations, installChecks: state.installChecks };
}

/** [B22-A3] Tests only: replace the host the runner reads (null restores the real one). */
export function __setDiagnosticRunnerHostForTests(next: DiagnosticRunnerHost | null): void {
  host = next ?? NODE_HOST;
}

/** [B22-A3] Tests only: forget the cached digest, the check in flight and the version lines, and zero the counts. */
export function __resetDiagnosticRunnerCachesForTests(): void {
  state.pin = null;
  state.checking = null;
  state.versions.clear();
  state.digestComputations = 0;
  state.installChecks = 0;
}

// ── [B24-A1] the operator's off-only switch (D24-11, OD-200) ──────────
// Appended after the module's last line (function declarations are hoisted): the two checks sit in place on :249 and :633, and no
// line B22's pages cite moves.

/** [B24-A1] Set to any non-blank value (the SIRKIT_ORDERING_DISABLED precedent, ordering-enablement.ts:104-105), the runner refuses
 *  every run and every install check first ([B24-A1 review] coverage-6: a version line already probed is answered from memory, with
 *  no refusal and no process); unset, empty or blank leaves it as it is. It only switches off; production simulation stays BLOCKED. */
export const DIAGNOSTIC_RUNNER_DISABLE_ENV = "SIRKIT_DIAGNOSTIC_RUNNER_DISABLED";

/** [B24-A1] Whether the operator switched the runner off (read from the environment at each call; the value is never echoed). */
export function diagnosticRunnerDisabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = environment[DIAGNOSTIC_RUNNER_DISABLE_ENV];
  return typeof value === "string" && value.trim() !== "";
}

/** [B24-A1] The refusal every run and every install check raises first while the switch is set: before the deck screen, the host,
 *  any digest, directory or spawn. The text names the setting, never a value or a path. */
function refuseIfDiagnosticRunnerSwitchedOff(): void {
  if (diagnosticRunnerDisabled()) throw new DiagnosticRunnerError("NGSPICE_DIAGNOSTIC_DISABLED", `the diagnostic runner is switched off by the operator (${DIAGNOSTIC_RUNNER_DISABLE_ENV}); nothing was run`);
}
