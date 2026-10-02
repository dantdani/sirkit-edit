/**
 * [B22-A1] D22-8 (OD-148) - kicad-cli's and FreeRouting's output is bounded: the stdout/stderr Sirkit accumulates from
 * each (kicad-cli-runner.ts:64-69; pcb/autoroute/runner.ts:178-183) is cut to the one diagnostic channel bound with the
 * truncation marker, and the files they write that Sirkit reads back - FreeRouting's .ses (runner.ts:206) and kicad-cli's
 * gerber and drill files (pcb/fab/build-bundle.ts:182, :208) - go through a bounded reader that refuses an over-bound file,
 * unread, with a closed error (the precedent: /api/simulate's readBoundedRawFile, route.ts:222-254). [B22 lead, 2026-10-02: since B22-A3 that reader is the diagnostic runner's `readBoundedRawFile`, diagnostic-runner.ts]
 *
 * Test-first: every bound case was run RED on the unmodified tree 0432fb8 (both runners accumulated output without a cap;
 * the .ses and the kicad-cli files were read whole). Normal outputs keep their existing behaviour (the existing suites
 * runner-security, kicad-cli-runner and build-bundle stay green, and the small-output cases below pass before and after).
 *
 * No process starts: `child_process` (the bare specifier both runners import) is an in-process fake, and the fake kicad-cli
 * runner writes its files into a temporary directory; an over-bound file is made by extending an empty file (no data
 * written). No java, no kicad-cli.
 *
 * [B22-A1 review] FreeRouting's stderr keeps its own share of the bound beside a long stdout (regressions-2); the .ses read's
 * missing and empty branches (tests-5); the bounded reader's own bound, unread refusal and handle, through a fake FileHandle
 * (tests-2); the collector's memory, in bytes (tests-3).
 */
import { closeSync, mkdtempSync, openSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const tool = vi.hoisted(() => ({
  script: { stdout: "", stderr: "", code: 0 as number | null, hang: false, sesBytes: null as number | null, sesText: null as string | null },
}));
vi.mock("child_process", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const { EventEmitter } = await import("node:events");
  const fs = await import("node:fs");
  return {
    ...actual,
    spawn: (_command: string, args: readonly string[]) => {
      const child = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>; kill: (signal?: string) => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      const { stdout, stderr, code, hang, sesBytes, sesText } = tool.script;
      queueMicrotask(() => {
        const out = args.indexOf("-do");
        if (out >= 0 && sesText !== null) fs.writeFileSync(args[out + 1]!, sesText);
        if (out >= 0 && sesBytes !== null) { fs.writeFileSync(args[out + 1]!, ""); fs.truncateSync(args[out + 1]!, sesBytes); }
        if (stdout) child.stdout.emit("data", Buffer.from(stdout));
        if (stderr) child.stderr.emit("data", Buffer.from(stderr));
        if (!hang) child.emit("close", code);
      });
      return child;
    },
  };
});

/** [B22-A1 review] tests-2: a fake FileHandle for `open` when armed; every other call is the real module. */
type FakeHandle = { size: number; chunks: number; chunkBytes: number; statError?: Error; readError?: Error; closeError?: Error; reads: number; closes: number };
const handle = vi.hoisted(() => ({ fake: null as null | FakeHandle }));
vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig() as Record<string, unknown> & { open: (...args: unknown[]) => Promise<unknown> };
  return {
    ...actual,
    open: async (...args: unknown[]) => {
      const fake = handle.fake;
      if (!fake) return actual.open(...args);
      return {
        stat: async () => { if (fake.statError) throw fake.statError; return { size: fake.size }; },
        read: async (buffer: Buffer, offset: number, length: number) => {
          fake.reads += 1;
          if (fake.readError) throw fake.readError;
          if (fake.reads > fake.chunks) return { bytesRead: 0, buffer };
          const count = Math.min(length, fake.chunkBytes);
          buffer.fill(0x61, offset, offset + count);
          return { bytesRead: count, buffer };
        },
        close: async () => { fake.closes += 1; if (fake.closeError) throw fake.closeError; },
      };
    },
  };
});

import { runFreerouting } from "@/app/lib/pcb/autoroute/runner";
import { buildFabBundle } from "@/app/lib/pcb/fab/build-bundle";
import { runKicadCli, type KicadCliRunner } from "@/app/lib/pcb/fab/kicad-cli-runner";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { createEmptyBoard } from "@/app/lib/pcb/types";

const CHANNEL_MAX_BYTES = 65_536;
const FILE_MAX_BYTES = 64 * 1024 * 1024;
const MARKER = "[SIRKIT: earlier output truncated]\n";
const TAIL = "TAIL-END-b22a1";
const output = (size: number): string => `${"x".repeat(size)}${TAIL}`;
const NEWLINE = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
function expectBounded(text: string | undefined, label: string): void {
  expect(typeof text, label).toBe("string");
  expect(Buffer.byteLength(text!, "utf8"), `${label}: at most ${CHANNEL_MAX_BYTES} bytes`).toBeLessThanOrEqual(CHANNEL_MAX_BYTES);
  expect(text!.startsWith(MARKER), `${label}: opens with the truncation marker`).toBe(true);
  expect(text!.endsWith(TAIL), `${label}: keeps the tail`).toBe(true);
}

const WORK = mkdtempSync(join(tmpdir(), "sirkit-b22a1-tools-"));
const JAR = join(WORK, "freerouting.jar");
writeFileSync(JAR, "not a jar: the spawn is faked");
afterAll(() => rmSync(WORK, { recursive: true, force: true }));
afterEach(() => {
  tool.script = { stdout: "", stderr: "", code: 0, hang: false, sesBytes: null, sesText: null };
  handle.fake = null;
});

describe("[B22-A1] kicad-cli: the stdout and stderr Sirkit keeps are bounded", () => {
  it("a short run keeps its output unchanged", async () => {
    tool.script = { ...tool.script, stdout: "Plotted 7 layers\n" };
    expect(await runKicadCli({ cliPath: "kicad-cli", args: ["pcb"] })).toMatchObject({ ok: true, stdout: "Plotted 7 layers\n", stderr: "" });
  });

  it("a successful run with a long stdout and stderr: each cut to the channel bound, the tail kept, the marker first", async () => {
    tool.script = { ...tool.script, stdout: output(1_000_000), stderr: output(1_000_000) };
    const result = await runKicadCli({ cliPath: "kicad-cli", args: ["pcb"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expectBounded(result.stdout, "kicad-cli stdout");
      expectBounded(result.stderr, "kicad-cli stderr");
    }
  });

  it("a failed run (non-zero exit) and a timed-out run return a bounded stderr", async () => {
    tool.script = { ...tool.script, stderr: output(1_000_000), code: 1 };
    const failed = await runKicadCli({ cliPath: "kicad-cli", args: ["pcb"] });
    expect(failed).toMatchObject({ ok: false, error: "exit-nonzero" });
    if (!failed.ok) expectBounded(failed.stderr, "kicad-cli exit-nonzero stderr");
    tool.script = { ...tool.script, stderr: "", stdout: output(1_000_000), hang: true };
    const timedOut = await runKicadCli({ cliPath: "kicad-cli", args: ["pcb"], timeoutMs: 30 });
    expect(timedOut).toMatchObject({ ok: false, error: "timeout" });
    if (!timedOut.ok) expectBounded(timedOut.stderr, "kicad-cli timeout output");
  });
});

describe("[B22-A1] FreeRouting: the diagnostics Sirkit keeps are bounded and the .ses is read through the bounded reader", () => {
  const route = (overrides: Partial<Parameters<typeof runFreerouting>[0]> = {}) => runFreerouting({ dsnText: "(pcb b22a1)", freeroutingJarPath: JAR, javaPath: "java-b22a1-fake", timeoutMs: 5_000, ...overrides });

  it("a normal .ses is returned unchanged (the existing behaviour)", async () => {
    tool.script = { ...tool.script, sesText: "(session b22a1 (routes))\n" };
    expect(await route()).toMatchObject({ ok: true, sesText: "(session b22a1 (routes))\n", processStatus: "exit-success", outputFileStatus: "nonempty", sesByteLength: 25 });
  });

  it("a failed run with a long stdout and stderr returns one bounded diagnostics text", async () => {
    tool.script = { ...tool.script, stdout: output(1_000_000), stderr: output(1_000_000), code: 1 };
    const result = await route();
    expect(result).toMatchObject({ ok: false, error: "exit-nonzero" });
    if (!result.ok) expectBounded(result.stderr, "FreeRouting diagnostics");
  });

  // [B22-A1 review] regressions-2: stderr (where FreeRouting's exception prints) keeps its own share of the bound; it was the head
  // of one tail-cut text, so a stdout near the bound pushed it out (red on the first fix)
  it("a short stderr survives a stdout over the bound: the exception first, stdout's tail after it, the whole within the bound", async () => {
    const exception = 'Exception in thread "main" java.lang.OutOfMemoryError: Java heap space';
    tool.script = { ...tool.script, stdout: output(70_000), stderr: exception, code: 1 };
    const result = await route();
    expect(result).toMatchObject({ ok: false, error: "exit-nonzero" });
    if (!result.ok) {
      expect(result.stderr.startsWith(exception), result.stderr.slice(0, 80)).toBe(true);
      expect(result.stderr).toContain(MARKER);
      expect(result.stderr.endsWith(TAIL)).toBe(true);
      expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(CHANNEL_MAX_BYTES);
    }
  });

  it("a 10 KiB stack trace keeps its header line and its last frame beside a 60 KiB stdout", async () => {
    const header = 'Exception in thread "main" java.lang.IllegalStateException: b22a1 routing failed';
    const frames = Array.from({ length: 200 }, (_, index) => `${TAB}at app.freerouting.Frame${index}.route(Frame.java:${index})`).join(NEWLINE);
    tool.script = { ...tool.script, stdout: output(60 * 1024), stderr: `${header}${NEWLINE}${frames}`, code: 1 };
    const result = await route();
    expect(result).toMatchObject({ ok: false, error: "exit-nonzero" });
    if (!result.ok) {
      expect(result.stderr.startsWith(`${header}${NEWLINE}`), result.stderr.slice(0, 80)).toBe(true);
      expect(result.stderr).toContain(frames.slice(-60));
      expect(result.stderr.endsWith(TAIL)).toBe(true);
      expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(CHANNEL_MAX_BYTES);
    }
  });

  // [B22-A1 review] tests-5: the two failure outputs the bounded read now carries
  it("no .ses written: error io, outputFileStatus missing, with the diagnostics or the plain message", async () => {
    expect(await route()).toMatchObject({ ok: false, error: "io", processStatus: "exit-success", outputFileStatus: "missing", exitCode: 0, stderr: "Freerouting produced no .ses output file" });
    tool.script = { ...tool.script, stderr: "routing gave up" };
    expect(await route()).toMatchObject({ ok: false, error: "io", processStatus: "exit-success", outputFileStatus: "missing", exitCode: 0, stderr: "routing gave up" });
  });

  it("an empty .ses: error output-empty, outputFileStatus empty", async () => {
    tool.script = { ...tool.script, sesText: `   ${NEWLINE}` };
    expect(await route()).toMatchObject({ ok: false, error: "output-empty", processStatus: "exit-success", outputFileStatus: "empty", exitCode: 0, stderr: "Freerouting produced an empty .ses output file" });
  });

  it("a .ses over the file bound is refused unread with a closed error that names the bound, never the content", async () => {
    tool.script = { ...tool.script, sesBytes: FILE_MAX_BYTES + 1 };
    const result = await route();
    expect(result).toMatchObject({ ok: false, error: "io", processStatus: "exit-success", outputFileStatus: "not-checked" });
    if (!result.ok) expect(result.stderr).toBe("Freerouting's .ses output exceeded the bounded size limit; it was not read");
  }, 60_000);
});

describe("[B22-A1] the fab bundle reads kicad-cli's gerber and drill files through the bounded reader", () => {
  /** A fake kicad-cli (the build-bundle suite's), with one output file made over the bound by extending it (no data written). */
  const runnerWith = (oversize: "gerber" | "drill" | null): KicadCliRunner => async ({ args }) => {
    const command = args[2];
    const stem = basename(args[3]!, ".kicad_pcb");
    const outDir = args[args.indexOf("--output") + 1]!;
    await mkdir(outDir, { recursive: true });
    if (command === "gerbers") {
      const layers = args[args.indexOf("--layers") + 1]!.split(",");
      for (const layer of layers) await writeFile(join(outDir, `${stem}-${layer.replace(/\./g, "_")}.gbr`), "G04 fake gerber*\nM02*\n");
      if (oversize === "gerber") { const path = join(outDir, `${stem}-${layers[0]!.replace(/\./g, "_")}.gbr`); closeSync(openSync(path, "w")); truncateSync(path, FILE_MAX_BYTES + 1); }
    } else if (command === "drill") {
      const path = join(outDir, `${stem}-PTH.drl`);
      await writeFile(path, "M48\nMETRIC\nM30\n");
      if (oversize === "drill") truncateSync(path, FILE_MAX_BYTES + 1);
    }
    return { ok: true, stdout: "", stderr: "", elapsedMs: 1 };
  };
  const input = () => ({ board: createEmptyBoard(), netlist: { components: [], nets: [] }, fabPreset: getFabPreset("jlcpcb-2l"), drcPreset: getPreset("jlcpcb-2l"), boardName: "sirkit-b22a1" });

  it("normal files bundle as before", async () => {
    const result = await buildFabBundle(input(), { runner: runnerWith(null), cliPath: "fake" });
    expect(result.stats.gerberFiles.length).toBeGreaterThan(0);
    expect(result.stats.drillFiles).toEqual(["sirkit-b22a1-PTH.drl"]);
  });

  it.each(["gerber", "drill"] as const)("a %s file over the bound is refused unread with a closed kicad-cli error", async (step) => {
    await expect(buildFabBundle(input(), { runner: runnerWith(step), cliPath: "fake" })).rejects.toMatchObject({
      name: "KicadCliError",
      kind: "cli-failed",
      message: `kicad-cli wrote a ${step} file over the ${FILE_MAX_BYTES}-byte bound; it was not read`,
    });
  }, 60_000);
});

describe("[B22-A1] the bounded reader", () => {
  it("reads a file at the bound, refuses one over it, and reports an unreadable one with its error", async () => {
    const { readBoundedFile } = await import("@/app/lib/computation/output-bounds");
    const path = join(WORK, "reader.bin");
    writeFileSync(path, "0123456789");
    const at = await readBoundedFile(path, 10);
    expect(at.ok && at.bytes.toString("utf8")).toBe("0123456789");
    expect(await readBoundedFile(path, 9)).toEqual({ ok: false, reason: "over-limit" });
    const missing = await readBoundedFile(join(WORK, "absent.bin"), 10);
    expect(missing).toMatchObject({ ok: false, reason: "unreadable" });
    expect(!missing.ok && missing.reason === "unreadable" && (missing.error as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
});

describe("[B22-A1 review] tests-2: the bounded reader's own bound, its unread refusal and its handle (a fake FileHandle)", () => {
  const arm = (fake: Partial<FakeHandle>): FakeHandle => (handle.fake = { size: 0, chunks: 0, chunkBytes: 65_536, reads: 0, closes: 0, ...fake });

  it("a declared size over the bound is refused before any read, and the handle is closed once", async () => {
    const { readBoundedFile } = await import("@/app/lib/computation/output-bounds");
    const fake = arm({ size: 1e15 });
    expect(await readBoundedFile("declared-huge.bin", 100_000)).toEqual({ ok: false, reason: "over-limit" });
    expect({ reads: fake.reads, closes: fake.closes }).toEqual({ reads: 0, closes: 1 });
  });

  it("a file that streams past the bound though its stat declared it small is refused within one chunk of the bound, the handle closed once", async () => {
    const { readBoundedFile } = await import("@/app/lib/computation/output-bounds");
    const fake = arm({ size: 10, chunks: 10 });
    expect(await readBoundedFile("lying-stat.bin", 100_000)).toEqual({ ok: false, reason: "over-limit" });
    expect({ reads: fake.reads, closes: fake.closes }).toEqual({ reads: 2, closes: 1 });
  });

  it("a read error and a stat error are unreadable with their error, the handle closed once each", async () => {
    const { readBoundedFile } = await import("@/app/lib/computation/output-bounds");
    const readError = new Error("read failed");
    const failedRead = arm({ size: 10, chunks: 1, readError });
    expect(await readBoundedFile("read-fails.bin", 100)).toEqual({ ok: false, reason: "unreadable", error: readError });
    expect(failedRead.closes).toBe(1);
    const statError = new Error("stat failed");
    const failedStat = arm({ statError });
    expect(await readBoundedFile("stat-fails.bin", 100)).toEqual({ ok: false, reason: "unreadable", error: statError });
    expect({ reads: failedStat.reads, closes: failedStat.closes }).toEqual({ reads: 0, closes: 1 });
  });

  it("a close error does not mask a complete read", async () => {
    const { readBoundedFile } = await import("@/app/lib/computation/output-bounds");
    const fake = arm({ size: 3, chunks: 1, chunkBytes: 3, closeError: new Error("close failed") });
    const read = await readBoundedFile("close-fails.bin", 10);
    expect(read.ok && read.bytes.toString("utf8")).toBe("aaa");
    expect(fake.closes).toBe(1);
  });
});

describe("[B22-A1 review] tests-3: a collector holds at most twice its bound, counted in bytes", () => {
  it.each([["one-byte", "x"], ["three-byte", String.fromCharCode(0x20ac)]])("many small %s chunks: never more than twice the bound held after any append; the text is bounded, marked, and keeps the tail", async (_label, char) => {
    const { createDiagnosticCollector } = await import("@/app/lib/computation/output-bounds");
    const collector = createDiagnosticCollector(4_096);
    let most = 0;
    for (let index = 0; index < 2_000; index += 1) {
      collector.append(char.repeat(100));
      most = Math.max(most, collector.heldBytes());
    }
    collector.append(TAIL);
    most = Math.max(most, collector.heldBytes());
    expect(most, "the most bytes held after any append").toBeLessThanOrEqual(2 * 4_096);
    const text = collector.text();
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(4_096);
    expect(text.startsWith(MARKER)).toBe(true);
    expect(text.endsWith(TAIL)).toBe(true);
  });
});
