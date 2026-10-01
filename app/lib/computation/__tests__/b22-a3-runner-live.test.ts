/**
 * [B22-A3] OPT-IN live check of the diagnostic runner against the REAL pinned ngspice install (skipped unless
 * `SIRKIT_B22_LIVE_RUNNER=1`; never in CI; the lead runs it once, locally). It needs `SIRKIT_NGSPICE_INSTALL_ROOT` (the `Spice64`
 * folder) and `SIRKIT_NGSPICE_INSTALL_SHA256` (`scripts/print-install-tree-digest.ts <root>` prints it) set by the owner.
 *
 * What it settles that the fake seams cannot: the install digest of the real tree and the cost of the cached check (printed, never
 * asserted against a time); that `-n -v` prints the version under the profile's exact environment; that one `.op` deck with the
 * profile's seed option simulates and its raw file is read back; that a long transient is stopped at the wall clock and the direct
 * child's close is observed (`timeout`, never `kill_unconfirmed`). [B22-A3 review] coverage-5, tests-4: that deck starts no
 * descendant, so case 4 shows nothing about `taskkill /T` reaching one - that stays INFERRED (discovery 9.5 item 20). [B22-A3
 * review] security-1: case 5 records, as yes/no answers only (never a value), whether ngspice's own `echo` sees the server's
 * USERPROFILE, which Node (libuv) adds to a win32 child whose environment lacks it. Only ngspice's own commands run (`op`, `tran`,
 * `write`, `echo`); no shell, no path outside the run directory, no network. A failure here is a finding, never a pass.
 */
import { describe, expect, it } from "vitest";

const LIVE = process.env.SIRKIT_B22_LIVE_RUNNER === "1";
const NEWLINE = String.fromCharCode(10);

describe.runIf(LIVE)("[B22-A3] the diagnostic runner against the real pinned ngspice (opt-in)", () => {
  it("1. the real install's digest equals the pinned setting, and the cached re-check hashes nothing (timings printed)", { timeout: 120_000 }, async () => {
    const { installTreeDigest } = await import("@/app/lib/computation/runtime-profile");
    const runner = await import("@/app/lib/computation/diagnostic-runner");
    const root = process.env.SIRKIT_NGSPICE_INSTALL_ROOT ?? "";
    const started = performance.now();
    const digest = await installTreeDigest(root);
    const hashed = performance.now() - started;
    expect(digest.sha256).toBe((process.env.SIRKIT_NGSPICE_INSTALL_SHA256 ?? "").trim().toLowerCase());
    const first = performance.now();
    await runner.diagnosticNgspiceVersion();
    const cold = performance.now() - first;
    const second = performance.now();
    await runner.diagnosticNgspiceVersion();
    const warm = performance.now() - second;
    expect(runner.diagnosticRunnerState().digestComputations).toBe(1);
    console.info(`[B22-A3 live] files=${digest.fileCount} bytes=${digest.totalBytes} full-digest=${hashed.toFixed(1)}ms first-version(probe+digest)=${cold.toFixed(1)}ms cached-check=${warm.toFixed(1)}ms`);
  });

  it("2. -n -v prints the version line under the profile's exact environment", { timeout: 60_000 }, async () => {
    const runner = await import("@/app/lib/computation/diagnostic-runner");
    const record = await runner.runDiagnosticNgspice({ operation: "version" });
    expect(record).toMatchObject({ outcome: "exited", exitCode: 0, labels: ["diagnostic_only", "environment_dependent"] });
    expect(`${record.stdout}${NEWLINE}${record.stderr}`).toMatch(/ngspice/i);
    console.info(`[B22-A3 live] version: ${`${record.stdout}${NEWLINE}${record.stderr}`.split(/\r?\n/).find((line) => /ngspice/i.test(line))?.trim()}`);
  });

  it("3. one .op deck with the seed option simulates and its raw file is read back bounded", { timeout: 60_000 }, async () => {
    const runner = await import("@/app/lib/computation/diagnostic-runner");
    const deck = runner.seedDiagnosticDeck(["* b22-a3 live divider", "V1 in 0 5", "R1 in out 1k", "R2 out 0 1k", ".op", ".control", "set filetype=ascii", "op", "write result.raw v(out)", "quit", ".endc", ".end", ""].join(NEWLINE));
    const record = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: true, wallClockMs: 30_000 });
    expect(record).toMatchObject({ outcome: "exited", exitCode: 0 });
    expect(record.raw.state).toBe("read");
    expect(record.raw.state === "read" ? record.raw.text : "").toMatch(/v\(out\)/i);
    console.info(`[B22-A3 live] .op stdout tail: ${record.stdout.slice(-400)}`);
  });

  it("4. a long transient is stopped at the wall clock: the direct child is killed and its close observed (timeout, never kill_unconfirmed); the deck starts no descendant, so this shows nothing about taskkill /T reaching one", { timeout: 60_000 }, async () => {
    const runner = await import("@/app/lib/computation/diagnostic-runner");
    // [B22-A3 lead] the first deck (`.tran 1n 100` with no output line) never simulated: in batch mode ngspice answers "no .plot,
    // .print, or .fourier lines in batch mode; no simulations run!" and exits at once (the lead's probe p27); a transient run from a
    // control block simulates (p29: about 18.7 s on this host, 2,000,009 rows), so the wall clock really stops it
    const deck = runner.seedDiagnosticDeck(["* b22-a3 live long transient", "V1 in 0 SIN(0 1 1k)", "R1 in out 1k", "C1 out 0 1u", ".control", "tran 1u 2 0 1u", ".endc", ".end", ""].join(NEWLINE));
    const started = performance.now();
    const record = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: false, wallClockMs: 1_500 });
    const elapsed = performance.now() - started;
    expect(record.outcome).toBe("timeout");
    expect(runner.diagnosticRunnerState().running).toBe(0);
    console.info(`[B22-A3 live] long transient stopped after ${elapsed.toFixed(0)}ms (wall clock 1500ms), exit code ${String(record.exitCode)}`);
  });

  it("5. [B22-A3 review] security-1: whether ngspice's own echo of $USERPROFILE sees the server's value (Node adds it on win32), printed as yes/no only", { timeout: 60_000 }, async () => {
    const runner = await import("@/app/lib/computation/diagnostic-runner");
    const deck = runner.seedDiagnosticDeck(["* b22-a3 live host-added environment", "V1 in 0 1", "R1 in 0 1k", ".op", ".control", "echo B22A3-PROFILE=$USERPROFILE", "quit", ".endc", ".end", ""].join(NEWLINE));
    const record = await runner.runDiagnosticNgspice({ operation: "run", deck, readRaw: false, wallClockMs: 30_000 });
    expect(record.outcome).toBe("exited");
    expect([...record.hostAddedEnvironment]).toContain("USERPROFILE");
    const line = `${record.stdout}${NEWLINE}${record.stderr}`.split(NEWLINE).map((text) => text.trim()).find((text) => text.includes("B22A3-PROFILE=")) ?? "";
    const server = process.env.USERPROFILE ?? "";
    const value = line.slice(line.indexOf("B22A3-PROFILE=") + "B22A3-PROFILE=".length).trim();
    console.info(`[B22-A3 live] echo line found: ${line !== ""}; expanded: ${value !== "" && !value.includes("$USERPROFILE")}; equals the server's USERPROFILE: ${server !== "" && value === server}; equals the run directory placeholder: ${value === "{runDir}"}`);
  });
});
