/**
 * [B22-D] OPT-IN live adversarial cases on the B22-A3 diagnostic runner against the REAL pinned ngspice (skipped unless
 * `SIRKIT_B22_LIVE_RUNNER=1`; never in CI). B22-D WROTE this suite and never ran it: the lead runs it once, locally, with the pinned
 * install (`SIRKIT_NGSPICE_INSTALL_ROOT`, `SIRKIT_NGSPICE_INSTALL_SHA256`), and records each result in `adversarial-matrix.md`.
 *
 * Each case is numbered by its runbook class (`:938`; the matrix's row) and runs only benign decks of ngspice's own commands (`op`,
 * `tran`, `ac`, `let`, `while`, `echo`, `set filetype`, `write`, `quit`) through `runDiagnosticNgspice`: no command interpreter, no
 * network, no file named outside the run directory (`b22-d-adversarial` case 10 reads every deck here: [B22-D review] each is one
 * `ngspiceDeck` call over an array of string literals, its commands from that closed list, no path separator, `~` or redirection, every
 * `write` target a plain relative file, and every run names its deck by such a literal). Each is designed so that an escape is
 * OBSERVED: the case FAILS when one is seen, and the lead records it as a finding (the class is then not contained); an escape never
 * becomes a pass. A positive control is asserted, never only printed: when it fails, the case fails as NOT MEASURED. Classes 5
 * (device paths), 11 (network attempts) and 15 (archive traversal) have no live case by design: opening a device or the network is
 * not a benign command, and no live process reads an archive (the matrix says why).
 *
 * The two module seams are pass-through spies, so the real spawn and the real file system run: the spawn spy records each pid (to
 * check that no process the runner started outlives its run), and the file spy can plant a link in a run directory after the
 * runner writes its deck and records each run directory's listing just before the runner removes it. No process listing is taken
 * (that would need a probe process of its own); the pids the runner started are checked with signal 0.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest"; import { assertLiveResources } from "../../evaluation/live-suites"; // [B24-B3, 2026-10-08] D24-19, OD-209: the resource gate, on this line so no line moves

const LIVE = process.env.SIRKIT_B22_LIVE_RUNNER === "1";
const spy = vi.hoisted(() => ({
  spawned: [] as Array<{ command: string; pid: number | undefined; cwd: string }>,
  plant: null as null | ((runDir: string) => void),
  listings: new Map<string, string[]>(),
}));
vi.mock("node:child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown> & { spawn: (...args: unknown[]) => { pid?: number } };
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      const child = actual.spawn(...args);
      const options = (args[2] ?? {}) as { cwd?: unknown };
      spy.spawned.push({ command: String(args[0]), pid: child.pid, cwd: String(options.cwd ?? "") });
      return child;
    },
  };
});
vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig() as Record<string, unknown> & { writeFile: (...args: unknown[]) => Promise<void>; rm: (...args: unknown[]) => Promise<void> };
  const { basename, dirname } = await import("node:path");
  const { readdirSync } = await import("node:fs");
  return {
    ...actual,
    writeFile: async (...args: unknown[]) => {
      await actual.writeFile(...args);
      if (spy.plant && basename(String(args[0])) === "deck.cir") spy.plant(dirname(String(args[0])));
    },
    rm: async (...args: unknown[]) => {
      const path = String(args[0]);
      if (/[\\/]run-[^\\/]+$/.test(path) && !spy.listings.has(path)) {
        try {
          spy.listings.set(path, readdirSync(path).sort());
        } catch {
          // already removed
        }
      }
      return actual.rm(...args);
    },
  };
});

import * as runner from "@/app/lib/computation/diagnostic-runner";
import { DIAGNOSTIC_OUTPUT_MAX_BYTES, OUTPUT_TRUNCATION_MARKER } from "@/app/lib/computation/output-bounds";
import { SimulationOutputError, validateNgspiceAsciiOutput } from "@/app/lib/computation/output-validator";
import { readStrictRaw } from "@/app/lib/computation/request-executors";
import { parseNgspiceAsciiRaw } from "@/app/lib/spice/waveforms";

const NEWLINE = String.fromCharCode(10);
const RUNNER_ROOT = join(tmpdir(), "sirkit-ngspice-runs");
/** A benign deck: ngspice's own commands only, seeded with the profile's option before its `.end` (the runner requires it). */
const ngspiceDeck = (lines: string[]): string => runner.seedDiagnosticDeck([...lines, ""].join(NEWLINE));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
  return true;
}
/** Is a process with this pid alive? Signal 0 tests it and sends nothing (EPERM: it exists under another user). */
function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === "EPERM";
  }
}
const spawnedSince = (mark: number) => spy.spawned.slice(mark);
const ngspiceSince = (mark: number) => spawnedSince(mark).filter((entry) => !/taskkill/i.test(entry.command));
const taskkillSince = (mark: number) => spawnedSince(mark).filter((entry) => /taskkill/i.test(entry.command));
const LONG_TRANSIENT = ngspiceDeck(["* b22-d live a transient far longer than any wall clock here", "V1 in 0 SIN(0 1 1k)", "R1 in out 1k", "C1 out 0 1u", ".control", "set filetype=ascii", "tran 1u 2 0 1u", "write result.raw v(out)", "quit", ".endc", ".end"]);
const DIVIDER_OP = ngspiceDeck(["* b22-d live an operating point", "V1 in 0 5", "R1 in out 1k", "R2 out 0 1k", ".control", "set filetype=ascii", "op", "write result.raw v(out)", "quit", ".endc", ".end"]);
/** Every reader's verdict on one text: the validator's code or "read"; the worker's; the strict reader's. */
function verdicts(text: string): { validator: string; worker: string; strict: string } {
  const code = (read: () => unknown): string => {
    try {
      return read() === null ? "refused" : "read";
    } catch (error) {
      return error instanceof SimulationOutputError ? error.code : `threw ${String(error)}`;
    }
  };
  return { validator: code(() => validateNgspiceAsciiOutput(text)), worker: code(() => parseNgspiceAsciiRaw(text)), strict: code(() => readStrictRaw(text)) };
}
const info = (text: string): void => console.info(`[B22-D live] ${text}`);

describe.runIf(LIVE)("[B22-D] the adversarial matrix against the real pinned ngspice (opt-in; the lead's)", () => {
  it("1. fork bombs: a deck cannot start a process (the screens refuse every spawning construct - the matrix's P); its closest benign analogue, a control loop that never ends, is stopped at the wall clock with its tree and no ngspice survives; Windows sets no OS process cap (OD-145)", { timeout: 60_000 }, async () => {
    const mark = spy.spawned.length;
    const deck = ngspiceDeck(["* b22-d live 1 a control loop that never ends", "V1 in 0 1", "R1 in 0 1k", ".control", "let n = 0", "while 1", "let n = n + 1", "end", ".endc", ".end"]);
    const started = performance.now();
    const record = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: false, wallClockMs: 1_500 });
    info(`1: outcome ${record.outcome} after ${(performance.now() - started).toFixed(0)} ms (wall clock 1500 ms), kill reason ${String(record.killReason)}`);
    expect(record.outcome, "a kill whose close is not observed is a finding (kill_unconfirmed)").toBe("timeout");
    const [ngspice] = ngspiceSince(mark);
    expect(await until(() => !alive(ngspice?.pid), 5_000), "the looping ngspice is still alive after the tree kill").toBe(true);
    expect(runner.diagnosticRunnerState().running).toBe(0);
  });

  it("2. child processes: after a clean exit and after a wall-clock tree kill, no ngspice the runner started and no taskkill it ran is alive; a benign deck starts no descendant, so taskkill /T reaching one stays INFERRED", { timeout: 60_000 }, async () => {
    const mark = spy.spawned.length;
    const clean = await runner.runDiagnosticNgspice({ operation: "run", deck: DIVIDER_OP, readRaw: false, wallClockMs: 30_000 });
    expect(clean.outcome).toBe("exited");
    const killed = await runner.runDiagnosticNgspice({ operation: "run", deck: LONG_TRANSIENT, readRaw: false, wallClockMs: 1_500 });
    expect(killed.outcome).toBe("timeout");
    const started = spawnedSince(mark);
    expect(ngspiceSince(mark)).toHaveLength(2);
    expect(taskkillSince(mark).length, "the wall clock ran the runner's own taskkill").toBeGreaterThanOrEqual(1);
    expect(await until(() => started.every((entry) => !alive(entry.pid)), 5_000), `alive: ${started.filter((entry) => alive(entry.pid)).map((entry) => entry.command).join(", ")}`).toBe(true);
    info(`2: ${started.length} processes started (ngspice and taskkill), none alive afterwards`);
  });

  it("3. filesystem escape: a deck that names only relative files writes inside its own run directory and nowhere else - not the server's working directory, the OS temp directory or the runner root - and the run directory is removed", { timeout: 60_000 }, async () => {
    // [B22-D review] coverage-1, tests-3: the second file's name is a literal in the deck (no line built at runtime, so case 10 of
    // b22-d-adversarial reads the line ngspice reads); a copy left by an earlier run is refused first, never read as an escape
    const SECOND = "b22d-live-3.raw";
    for (const place of [process.cwd(), tmpdir(), RUNNER_ROOT]) expect(existsSync(join(place, SECOND)), `${place}: a ${SECOND} left by an earlier run (remove it, then re-run)`).toBe(false);
    const mark = spy.spawned.length;
    const deck = ngspiceDeck(["* b22-d live 3 relative writes only", "V1 in 0 5", "R1 in out 1k", "R2 out 0 1k", ".control", "set filetype=ascii", "op", "write result.raw v(out)", "write b22d-live-3.raw v(out)", "quit", ".endc", ".end"]);
    const record = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: true, wallClockMs: 30_000 });
    expect(record.outcome).toBe("exited");
    const runDir = ngspiceSince(mark)[0]!.cwd;
    info(`3: the run directory held ${JSON.stringify(spy.listings.get(runDir))}`);
    expect(spy.listings.get(runDir)).toEqual(["deck.cir", "result.raw", SECOND].sort());
    for (const place of [process.cwd(), tmpdir(), RUNNER_ROOT]) expect(existsSync(join(place, SECOND)), `NOT CONTAINED: ${SECOND} was written in ${place}`).toBe(false);
    expect(existsSync(runDir)).toBe(false);
  });

  it("4. symlink/hardlink tricks: a hardlink planted as result.raw in the run directory (after the runner writes its deck, before the spawn) is refused by the runner - lstat sees a second name - and is never read; a write by ngspice through it to the file outside is OBSERVED and fails this case (a finding: the runner refuses the read, the OS does not stop the write)", { timeout: 60_000 }, async () => {
    const scratch = mkdtempSync(join(tmpdir(), "sirkit-b22-d-live-"));
    const SENTINEL = `b22-d sentinel ${randomUUID()}${NEWLINE}`;
    try {
      writeFileSync(join(scratch, "outside.txt"), SENTINEL);
      spy.plant = (runDir: string) => linkSync(join(scratch, "outside.txt"), join(runDir, "result.raw"));
      const record = await runner.runDiagnosticNgspice({ operation: "run", deck: DIVIDER_OP, readRaw: true, wallClockMs: 30_000 });
      spy.plant = null;
      info(`4: outcome ${record.outcome}, exit ${String(record.exitCode)}, raw ${record.raw.state}`);
      expect(record.raw.state, "the runner read a file that has a second name outside its run directory").toBe("not-a-plain-file");
      const after = readFileSync(join(scratch, "outside.txt"), "utf8");
      info(`4: the file outside the run directory was written through the link: ${after !== SENTINEL}`);
      expect(after === SENTINEL, "NOT CONTAINED: ngspice wrote through a planted hardlink to a file outside its run directory").toBe(true);
    } finally {
      spy.plant = null;
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("6. huge output: a control loop that prints without end is held within the channel bound (the tail kept, the marker first) and stopped at the wall clock; a raw file past the read-back bound is refused whole and never read", { timeout: 60_000 }, async () => {
    const printing = ngspiceDeck(["* b22-d live 6 output that never ends", "V1 in 0 1", "R1 in 0 1k", ".control", "while 1", "echo b22d-output-line-0123456789-0123456789-0123456789-0123456789", "end", ".endc", ".end"]);
    const flood = await runner.runDiagnosticNgspice({ operation: "run", deck: printing, readRaw: false, wallClockMs: 2_000 });
    info(`6: stdout ${Buffer.byteLength(flood.stdout, "utf8")} bytes kept, marker ${flood.stdout.startsWith(OUTPUT_TRUNCATION_MARKER)}, outcome ${flood.outcome}`);
    expect(flood.outcome).toBe("timeout");
    expect(Buffer.byteLength(flood.stdout, "utf8")).toBeLessThanOrEqual(DIAGNOSTIC_OUTPUT_MAX_BYTES);
    expect(Buffer.byteLength(flood.stderr, "utf8")).toBeLessThanOrEqual(DIAGNOSTIC_OUTPUT_MAX_BYTES);
    const large = ngspiceDeck(["* b22-d live 6b a raw file past the read-back bound", "V1 in 0 SIN(0 1 1k)", "R1 in out 1k", "C1 out 0 1u", ".control", "set filetype=ascii", "tran 1u 2m", "write result.raw v(out)", "quit", ".endc", ".end"]);
    const over = await runner.runDiagnosticNgspice({ operation: "run", deck: large, readRaw: true, readBackBytes: 4_096, wallClockMs: 30_000 });
    expect(over.outcome).toBe("exited");
    expect(over.raw.state).toBe("over-limit");
  });

  it("7. infinite simulation: a transient far longer than the wall clock is stopped there - timeout, its raw file never read, nothing parsed", { timeout: 60_000 }, async () => {
    const record = await runner.runDiagnosticNgspice({ operation: "run", deck: LONG_TRANSIENT, readRaw: true, wallClockMs: 1_500 });
    expect(record.outcome).toBe("timeout");
    expect(record.raw.state).toBe("skipped");
    expect(runner.diagnosticRunnerState().running).toBe(0);
  });

  it("8. malformed binary output: ngspice's own binary rawfile is refused whole - by the runner's UTF-8 read, or by every parser - never parsed into values", { timeout: 60_000 }, async () => {
    const deck = ngspiceDeck(["* b22-d live 8 binary output", "V1 in 0 5", "R1 in out 1k", "R2 out 0 1k", ".control", "set filetype=binary", "op", "write result.raw v(out)", "quit", ".endc", ".end"]);
    const record = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: true, wallClockMs: 30_000 });
    expect(record.outcome).toBe("exited");
    info(`8: raw ${record.raw.state}`);
    if (record.raw.state === "read") {
      const found = verdicts(record.raw.text);
      info(`8: the binary file decoded as UTF-8; verdicts ${JSON.stringify(found)}`);
      expect(found.validator).toMatch(/^OUTPUT_/);
      expect(found.worker).toMatch(/^OUTPUT_/);
      expect(found.strict).toBe("refused");
    } else {
      expect(record.raw.state).toBe("invalid-utf8");
    }
  });

  it("9. NaN/Inf: an overflowed and an undefined value, as ngspice-46 writes them, are refused whole by every parser; the spellings are printed (discovery 9.5 item 21: unmeasured until now)", { timeout: 60_000 }, async () => {
    const deck = ngspiceDeck(["* b22-d live 9 an overflowed and an undefined value", "V1 in 0 5", "R1 in out 1k", "R2 out 0 1k", ".control", "set filetype=ascii", "op", "let big = v(out) * 1e308 * 1e308", "let undef = big - big", "write result.raw v(out) big undef", "quit", ".endc", ".end"]);
    const record = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: true, wallClockMs: 30_000 });
    info(`9: outcome ${record.outcome}, exit ${String(record.exitCode)}, raw ${record.raw.state}; stderr tail ${JSON.stringify(record.stderr.slice(-300))}`);
    expect(record.raw.state).toBe("read");
    const text = record.raw.state === "read" ? record.raw.text : "";
    const tokens = (text.split("Values:")[1] ?? "").split(/[\s,]+/).filter((token) => token !== "");
    const nonFinite = tokens.filter((token) => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token) || !Number.isFinite(Number(token)));
    info(`9: tokens that are not finite numbers: ${JSON.stringify(nonFinite)}`);
    expect(nonFinite, "ngspice wrote no non-finite token: the measurement this case exists for did not happen (record it)").not.toEqual([]);
    const found = verdicts(text);
    expect(found.validator).toMatch(/^OUTPUT_(?:NON_FINITE|MALFORMED)$/);
    expect(found.worker).toBe(found.validator);
    expect(found.strict).toBe("refused");
  });

  it("10. locale drift: the raw file ngspice writes under the profile's environment (LC_ALL=C) carries '.' decimals that every parser reads, and a decimal-comma locale set in the server's environment leaves it byte-identical (SHA-256 without its Date line) - an allowlist re-check: the child's locale cannot be varied through the runner (its environment is the profile's map), and the Windows C runtime's reading of the OS user locale cannot be forced from here (a system setting), so drift under a comma locale stays INFERRED", { timeout: 60_000 }, async () => {
    const deck = ngspiceDeck(["* b22-d live 10 locale", "V1 in 0 5", "R1 in out 1k", "R2 out 0 3k", ".control", "set filetype=ascii", "op", "write result.raw v(out) i(V1)", "quit", ".endc", ".end"]);
    const digestOf = (text: string): string => createHash("sha256").update(text.split(NEWLINE).filter((line) => !line.startsWith("Date:")).join(NEWLINE)).digest("hex");
    const plain = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: true, wallClockMs: 30_000 });
    for (const name of ["LC_ALL", "LANG", "LC_NUMERIC"]) vi.stubEnv(name, "de_DE.UTF-8");
    try {
      const comma = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: true, wallClockMs: 30_000 });
      expect(plain.raw.state).toBe("read");
      expect(comma.raw.state).toBe("read");
      const [first, second] = [plain, comma].map((record) => (record.raw.state === "read" ? record.raw.text : ""));
      info(`10: digests ${digestOf(first!).slice(0, 16)} / ${digestOf(second!).slice(0, 16)}; values ${JSON.stringify((second!.split("Values:")[1] ?? "").trim())}`);
      // [B22-D review] tests-5: the measurement this case can make - the decimals ngspice wrote under the profile's environment and
      // this host's OS user locale (a comma here is a finding: the profile's LC_ALL=C did not hold)
      const written = (first!.split("Values:")[1] ?? "").split(/\s+/).filter((token) => token !== "");
      expect(written.length, "no values to measure").toBeGreaterThan(0);
      expect(written.filter((token) => /\d,\d/.test(token)), "ngspice wrote a decimal comma under the profile's environment").toEqual([]);
      expect(verdicts(first!).validator).toBe("read");
      expect(digestOf(second!)).toBe(digestOf(first!));
      expect(verdicts(second!).validator).toBe("read");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("12. environment-variable exfiltration: a canary set in the server's environment is never printed by ngspice's echo of it, while the profile's own TZ is (the positive control, asserted: a run where echo does not expand $TZ fails as NOT MEASURED, never passes as contained)", { timeout: 60_000 }, async () => {
    const value = `canary-${randomUUID()}`;
    vi.stubEnv("SIRKIT_B22D_LIVE_CANARY", value);
    try {
      const deck = ngspiceDeck(["* b22-d live 12 the server environment", "V1 in 0 1", "R1 in 0 1k", ".control", "echo B22D-TZ=$TZ", "echo B22D-CANARY=$SIRKIT_B22D_LIVE_CANARY", "quit", ".endc", ".end"]);
      const record = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: false, wallClockMs: 30_000 });
      const output = `${record.stdout}${NEWLINE}${record.stderr}`;
      info(`12: the positive control expanded $TZ to UTC: ${output.includes("B22D-TZ=UTC")}; the canary line found: ${output.includes("B22D-CANARY=")}`);
      expect(record.outcome).toBe("exited");
      expect(output, "NOT MEASURED: the positive control did not expand $TZ, so the canary check below would observe nothing (record it)").toContain("B22D-TZ=UTC");
      expect(output.includes(value), "NOT CONTAINED: ngspice printed a value from the server's environment").toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("13. signal races: an abort before the call, during the run and after the exit each end in exactly one terminal state, and the runner's slots drain", { timeout: 60_000 }, async () => {
    const before = new AbortController();
    before.abort();
    const early = await runner.runDiagnosticNgspice({ operation: "run", deck: DIVIDER_OP, readRaw: true, signal: before.signal });
    expect(early).toMatchObject({ outcome: "cancelled", spawned: false });
    const during = new AbortController();
    const pending = runner.runDiagnosticNgspice({ operation: "run", deck: LONG_TRANSIENT, readRaw: true, signal: during.signal, wallClockMs: 30_000 });
    await sleep(300);
    during.abort();
    const stopped = await pending;
    expect(stopped, "an abort whose close is not observed is a finding (kill_unconfirmed)").toMatchObject({ outcome: "cancelled", killReason: "cancelled", raw: { state: "skipped" } });
    const after = new AbortController();
    const mark = spy.spawned.length;
    const done = await runner.runDiagnosticNgspice({ operation: "run", deck: DIVIDER_OP, readRaw: true, signal: after.signal, wallClockMs: 30_000 });
    after.abort();
    await sleep(200);
    expect(done).toMatchObject({ outcome: "exited", exitCode: 0, raw: { state: "read" } });
    expect(taskkillSince(mark), "an abort after the exit started a kill").toEqual([]);
    expect(await until(() => runner.diagnosticRunnerState().running === 0, 5_000)).toBe(true);
  });

  it("14. orphan processes: after an abort and after a timeout, no ngspice the runner started and no taskkill it ran is alive", { timeout: 60_000 }, async () => {
    const mark = spy.spawned.length;
    const abort = new AbortController();
    const cancelled = runner.runDiagnosticNgspice({ operation: "run", deck: LONG_TRANSIENT, readRaw: false, signal: abort.signal, wallClockMs: 30_000 });
    await sleep(300);
    abort.abort();
    expect((await cancelled).outcome).toBe("cancelled");
    expect((await runner.runDiagnosticNgspice({ operation: "run", deck: LONG_TRANSIENT, readRaw: false, wallClockMs: 1_500 })).outcome).toBe("timeout");
    const started = spawnedSince(mark);
    expect(ngspiceSince(mark)).toHaveLength(2);
    const gone = await until(() => started.every((entry) => !alive(entry.pid)), 5_000);
    info(`14: ${started.length} processes started; alive afterwards: ${started.filter((entry) => alive(entry.pid)).length}`);
    expect(gone, "NOT CONTAINED: a process the runner started outlived its run").toBe(true);
  });

  it("16. parser differentials on real files: the raw files ngspice-46 writes for an operating point, a transient and an AC sweep read the same through the validator, the Studio worker's parser and the circuit-analysis strict reader; their Variables lines are printed (the vector names and attributes B22-B and B22-C left UNKNOWN)", { timeout: 60_000 }, async () => {
    const decks = [
      ngspiceDeck(["* b22-d live 16 operating point", "V1 in 0 5", "R1 in out 1k", "R2 out 0 2k", ".control", "set filetype=ascii", "op", "write result.raw v(out) i(V1)", "quit", ".endc", ".end"]),
      ngspiceDeck(["* b22-d live 16 transient", "V1 in 0 5", "R1 in out 1k", "C1 out 0 1u IC=0", ".control", "set filetype=ascii", "tran 10u 1m uic", "write result.raw v(out)", "quit", ".endc", ".end"]),
      ngspiceDeck(["* b22-d live 16 AC sweep", "V1 in 0 AC 1", "R1 in out 1k", "C1 out 0 1u", ".control", "set filetype=ascii", "ac dec 5 10 100k", "write result.raw v(out)", "quit", ".endc", ".end"]),
    ];
    for (const deck of decks) {
      const record = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: true, wallClockMs: 30_000 });
      expect(record.raw.state).toBe("read");
      const text = record.raw.state === "read" ? record.raw.text : "";
      const lines = text.split(/\r?\n/);
      info(`16: ${lines.find((line) => line.startsWith("Plotname:"))}; ${JSON.stringify(lines.slice(lines.indexOf("Variables:"), lines.indexOf("Values:")))}`);
      expect(verdicts(text)).toEqual({ validator: "read", worker: "read", strict: "read" });
      const output = validateNgspiceAsciiOutput(text);
      const vectors = [output.axis, ...output.variables];
      const strict = readStrictRaw(text)!;
      expect(strict.names).toEqual(vectors.map((vector) => vector.name.toLowerCase()));
      strict.points.forEach((point, index) => point.forEach(([re, im], column) => {
        expect(Object.is(re, vectors[column]!.real[index]), `${vectors[column]!.name}[${index}]`).toBe(true);
        expect(Object.is(im, vectors[column]!.imaginary ? vectors[column]!.imaginary![index] : 0), `${vectors[column]!.name}[${index}] imaginary`).toBe(true);
      }));
      const parsed = parseNgspiceAsciiRaw(text);
      expect(parsed.header.variables.map((entry) => entry.name)).toEqual(vectors.map((vector) => vector.name));
    }
  });

  beforeAll(() => assertLiveResources("b22-d-adversarial-live")); // [B24-B3, 2026-10-08] D24-19, OD-209: with the flag set and the pin or the host absent this block fails NOT EXERCISED before any case body runs
});
