/**
 * [B22-A1] What an engineering subprocess may hand back to Sirkit (D22-4, D22-8; OD-148).
 *
 * ONE constant decides every diagnostic text channel: `DIAGNOSTIC_OUTPUT_MAX_BYTES` bounds the ngspice stdout/stderr the SPICE
 * smoke test returns and a SPICE run record carries, and the stdout/stderr Sirkit collects from kicad-cli and FreeRouting; a
 * run record's one-line texts (a progress log event, a failure message) get a sixty-fourth of it. A cut text keeps its tail (where
 * a failure prints) and opens with `OUTPUT_TRUNCATION_MARKER`. RECORDED, not closed: a bounded channel still carries what the
 * process printed, up to the bound.
 *
 * `readBoundedFile` reads a file kicad-cli or FreeRouting wrote and Sirkit reads back, refusing one over
 * `TOOL_OUTPUT_FILE_MAX_BYTES` unread (the precedent: /api/simulate's `readBoundedRawFile`, route.ts:222-254) [B22 lead, 2026-10-02: since B22-A3 that reader is the diagnostic runner's `readBoundedRawFile`, diagnostic-runner.ts]: the declared size
 * is an advisory fast-fail, storage grows with the bytes actually read in 64 KiB chunks, and crossing the bound refuses.
 *
 * No process, no network; the reader opens one file handle and closes it in every path.
 */
import { open, type FileHandle } from "node:fs/promises";

/** [B22-A1] The ONE byte bound on a diagnostic text channel (a returned or recorded stdout or stderr). */
export const DIAGNOSTIC_OUTPUT_MAX_BYTES = 64 * 1024;
/** [B22-A1] A run record's one-line texts (a progress log event, a failure message): decided by the one constant. [B22-A1 review]
 *  regressions-3: 1 KiB, never above the 1,500 and 3,000 characters these texts were cut to before. */
export const DIAGNOSTIC_EXCERPT_MAX_BYTES = DIAGNOSTIC_OUTPUT_MAX_BYTES / 64;
/** [B22-A1] The bound on a file an engineering tool writes that Sirkit reads back (a gerber or drill file, a routed session). */
export const TOOL_OUTPUT_FILE_MAX_BYTES = 64 * 1024 * 1024;
/** [B22-A1] Opens every cut text: the head was dropped, the tail is kept. */
export const OUTPUT_TRUNCATION_MARKER = "[SIRKIT: earlier output truncated]\n";

const MARKER_BYTES = Buffer.byteLength(OUTPUT_TRUNCATION_MARKER, "utf8");

/** The last `maxBytes` bytes of `text`, started on a UTF-8 character boundary (never half a character). */
function tailBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

/** [B22-A1] `text` unchanged when it fits in `maxBytes`; otherwise the marker and the tail, `maxBytes` in all. */
export function boundDiagnosticText(text: string, maxBytes: number = DIAGNOSTIC_OUTPUT_MAX_BYTES): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return OUTPUT_TRUNCATION_MARKER + tailBytes(text, Math.max(0, maxBytes - MARKER_BYTES));
}

/** [B22-A1] Accumulates a process's output stream in memory, at most twice `maxBytes` bytes after any append; `text()` is the
 *  bounded text. [B22-A1 review] tests-3: counted in UTF-8 bytes (a string's length counts UTF-16 units, so three-byte output
 *  was held to about six times the bound), and `heldBytes()` lets a test see what is held. */
export interface DiagnosticOutputCollector {
  append(chunk: string): void;
  text(): string;
  heldBytes(): number;
}

export function createDiagnosticCollector(maxBytes: number = DIAGNOSTIC_OUTPUT_MAX_BYTES): DiagnosticOutputCollector {
  let held = "";
  let heldBytes = 0;
  let cut = false;
  return {
    append(chunk) {
      held += chunk;
      heldBytes += Buffer.byteLength(chunk, "utf8");
      if (heldBytes > maxBytes * 2) {
        held = tailBytes(held, maxBytes);
        heldBytes = Buffer.byteLength(held, "utf8");
        cut = true;
      }
    },
    heldBytes: () => heldBytes,
    text() {
      if (!cut) return boundDiagnosticText(held, maxBytes);
      return OUTPUT_TRUNCATION_MARKER + tailBytes(held, Math.max(0, maxBytes - MARKER_BYTES));
    },
  };
}

export type BoundedFileRead =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "over-limit" }
  | { ok: false; reason: "unreadable"; error: unknown };

/** [B22-A1] At most `maxBytes` actual bytes of `path`, or a refusal: over the bound (never partial) or unreadable (with the error). */
export async function readBoundedFile(path: string, maxBytes: number = TOOL_OUTPUT_FILE_MAX_BYTES): Promise<BoundedFileRead> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(path, "r");
    if ((await handle.stat()).size > maxBytes) return { ok: false, reason: "over-limit" };
    const chunk = Buffer.alloc(65_536);
    const pieces: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) return { ok: false, reason: "over-limit" };
      pieces.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    return { ok: true, bytes: Buffer.concat(pieces, total) };
  } catch (error) {
    return { ok: false, reason: "unreadable", error };
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * [B22-A1 review] regressions-2: two diagnostic channels joined in one bound, each keeping its own share - `first` (FreeRouting's
 * stderr, where an exception prints) up to half of it, `second` (its stdout) the rest. Each part keeps its tail and opens with
 * the marker when cut; an empty part is left out; the whole, the joining newline included, is within `maxBytes`. (One tail-cut
 * text dropped `first` whole whenever `second` neared the bound.)
 */
export function joinDiagnosticTexts(first: string, second: string, maxBytes: number = DIAGNOSTIC_OUTPUT_MAX_BYTES): string {
  if (!first || !second) return boundDiagnosticText(first || second, maxBytes);
  const head = boundDiagnosticText(first, Math.floor((maxBytes - 1) / 2));
  return `${head}\n${boundDiagnosticText(second, maxBytes - 1 - Buffer.byteLength(head, "utf8"))}`;
}
