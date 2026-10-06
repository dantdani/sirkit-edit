/**
 * [B24-A2] D24-4, OD-195, runbook :168 ("Run a staged-content secret scan before every push.") - the secret scan.
 *
 * Pure: `runSecretScan` takes `{ path, text }` entries and an allowlist and returns `lines` of the form `path:line rule` - never the
 * matched text - with an exit code (1 on any hit the allowlist does not hold) and the entries it did not scan, counted (oversized:
 * over SECRET_SCAN_MAX_BYTES; missing: a blob git did not return, which also fails the run). [B24-A2 review, 2026-10-06] security-1:
 * a NUL byte skips nothing - each file is read as UTF-16 when it opens with that byte-order mark, as UTF-8 otherwise, and a line
 * holding a NUL is matched as it is and with its NULs dropped. The rules are closed: PEM private-key markers, the provider key shapes
 * the B19 source registry and the B20 MCP server registry already refuse (source-registry.ts:592, server-registry.ts:360; restated
 * here, not imported; [B24-A2 review] security-2: widened to OpenAI's and GitHub's current forms), a Supabase secret-key shape (the
 * prefix followed by at least 20 key characters) and the project's connection strings with a password. Each rule is written so that
 * its own statement matches no rule (a character class or a quantifier where a literal would stand).
 *
 * The allowlist holds exact paths, never a glob or a directory: a path, a rule, the sha256 of the line's text and a reason. A hit is
 * allowlisted only on the same path, rule and line digest, so an edited line hits again. In tree mode an entry whose line no longer
 * hits fails as stale; a `--staged` or `--history` run sees part of the tree, so it skips that check.
 *
 * The file listing is the script's (`scripts/scan-secrets.ts`, the only file that runs git): `collectSecretScanEntries` asks an
 * injected git for read-only answers - `ls-files` (tree mode), `diff --cached` (the staged blobs), `rev-list` and `diff-tree` then
 * `cat-file` (a commit range) - and the pure parsers below turn their text into entries. This module imports no process module.
 */
import { createHash } from "node:crypto";

export const SECRET_SCAN_RULE_IDS = Object.freeze(["pem-private-key", "anthropic-key-shape", "openai-key-shape", "github-token-shape", "aws-access-key-id-shape", "huggingface-token-shape", "jwt-shape", "supabase-secret-key-shape", "connection-string-password"] as const);
export type SecretScanRuleId = (typeof SECRET_SCAN_RULE_IDS)[number];
export interface SecretScanRule {
  readonly id: SecretScanRuleId;
  readonly pattern: RegExp;
  /** what the rule looks for, in words (never a matching literal) */
  readonly what: string;
}

/** The closed rules, in order. No pattern carries a flag (no lastIndex state). */
export const SECRET_SCAN_RULES: readonly SecretScanRule[] = Object.freeze([
  { id: "pem-private-key", pattern: /-{5}BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-{5}/, what: "a PEM private-key marker, the PRIVATE KEY form or the PRIVATE KEY BLOCK form" },
  { id: "anthropic-key-shape", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/, what: "the Anthropic key prefix followed by at least 20 key characters" },
  // [B24-A2 review, 2026-10-06] security-2: + OpenAI's project, service-account and admin forms (a word boundary first, so a word that
  // only ends in the prefix is no hit), + GitHub's OAuth, user, server and refresh prefixes and its fine-grained form
  { id: "openai-key-shape", pattern: /sk-[A-Za-z0-9]{32,}|\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/, what: "the OpenAI key prefix followed by at least 32 letters or digits, or its project, service-account or admin form: the prefix, the form's word and a dash, then at least 20 key characters" },
  { id: "github-token-shape", pattern: /gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}/, what: "a GitHub token: a personal, OAuth, user, server or refresh prefix followed by 36 letters or digits, or the fine-grained prefix followed by at least 60 key characters" },
  { id: "aws-access-key-id-shape", pattern: /AKIA[0-9A-Z]{16}/, what: "an AWS access key id: its prefix followed by 16 capitals or digits" },
  { id: "huggingface-token-shape", pattern: /hf_[A-Za-z0-9]{30,}/, what: "a Hugging Face token prefix followed by at least 30 letters or digits" },
  { id: "jwt-shape", pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, what: "a JSON web token: two base64url segments, the first opening a JSON object" },
  { id: "supabase-secret-key-shape", pattern: /sb_secret_[A-Za-z0-9_-]{20,}/, what: "the Supabase secret-key prefix followed by at least 20 key characters" },
  // [B24-A2 review, 2026-10-06] security-2: the project's connection strings (DATABASE_URL, SIRKIT_DB_QUALIFICATION_URL) - scoped to an
  // assignment to a *_URL name or a Supabase host, because a bare userinfo rule hits some 25 test sentinels and a production comment;
  // a password written as a <placeholder> is no hit
  { id: "connection-string-password", pattern: /[A-Z][A-Z0-9_]*_URL\s*[=:]\s*["'`]?(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s:/@]+:(?!<)[^\s@/]{6,}@|postgres(?:ql)?:\/\/[^\s:/@]+:(?!<)[^\s@/]{6,}@[A-Za-z0-9.-]*\.supabase\.(?:co|com)\b/, what: "a database URL holding a password of at least 6 characters, either assigned to a name ending in _URL or naming a Supabase host; a password written as an angle-bracket placeholder is no hit" },
].map((rule) => Object.freeze(rule as SecretScanRule)));

/** Files over this many bytes are skipped and counted, never scanned (4 MiB; the largest tracked file at 1b2c08c is about 1 MiB). */
export const SECRET_SCAN_MAX_BYTES = 4 * 1024 * 1024;

export type SecretScanMode = "tree" | "staged" | "history";
export interface SecretScanEntry {
  /** a repository path; in history mode git's `<commit>:<path>` */
  readonly path: string;
  readonly text: string;
  /** the size in bytes when it is known without the text (an oversized blob is never read) */
  readonly bytes?: number;
  /** [B24-A2 review, 2026-10-06] security-1: git returned no blob for it (batch-check said `missing`, or `--batch` left it out): it is
   *  never scanned, it is counted, it is named as `unscanned: <path>` and it fails the run */
  readonly missing?: boolean;
}
export interface SecretScanAllowlistEntry {
  readonly path: string;
  readonly rule: SecretScanRuleId;
  /** sha256 (hex) of the line's text, without its line break */
  readonly sha256: string;
  readonly reason: string;
}
export interface SecretScanResult {
  readonly lines: readonly string[];
  readonly exitCode: 0 | 1;
  /** [B24-A2 review, 2026-10-06] security-1: nothing is skipped for a NUL byte any more (no `binary` count); `missing` counts the blobs
   *  git did not return, each also a failing `unscanned:` line */
  readonly skipped: { readonly oversized: number; readonly missing: number };
  readonly allowlisted: number;
}

const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const utf8 = new TextEncoder();

/** The digest an allowlist entry holds: sha256 over the line's UTF-8 text, without its line break. */
export function lineDigest(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex");
}

/** Characters a glob, a directory or a path that climbs would need; an allowlist path holds none of them. */
const GLOB = /[*?[\]{}!]/;
const SEGMENT = /^[^/\\]+$/;
const DIGEST = /^[0-9a-f]{64}$/;

/** Every reason the allowlist cannot be used: a glob, a directory, an absolute or climbing path, an unknown rule, a malformed digest,
 *  a short reason, a duplicate. An empty answer means usable. */
export function allowlistProblems(allowlist: readonly SecretScanAllowlistEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  allowlist.forEach((entry, index) => {
    const at = `entry ${index + 1} (${typeof entry.path === "string" ? entry.path : "?"})`;
    const path = typeof entry.path === "string" ? entry.path : "";
    const segments = path.split("/");
    if (path.length === 0 || GLOB.test(path) || path.endsWith("/") || path.startsWith("/") || path.includes("\\") || !segments.every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..")) problems.push(`${at}: not one exact file path (a glob, a directory, an absolute or climbing path is refused)`);
    if (!(SECRET_SCAN_RULE_IDS as readonly string[]).includes(entry.rule)) problems.push(`${at}: unknown rule`);
    if (typeof entry.sha256 !== "string" || !DIGEST.test(entry.sha256)) problems.push(`${at}: the line digest is not a sha256`);
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 30) problems.push(`${at}: no reason`);
    const key = `${path} ${entry.rule} ${entry.sha256}`;
    if (seen.has(key)) problems.push(`${at}: duplicate`);
    seen.add(key);
  });
  return problems;
}

/** Scan entries against the closed rules and the allowlist. Lines name `path:line rule` (and allowlist problems); never the text. */
export function runSecretScan(input: { readonly entries: readonly SecretScanEntry[]; readonly allowlist: readonly SecretScanAllowlistEntry[]; readonly mode?: SecretScanMode }): SecretScanResult {
  const mode = input.mode ?? "tree";
  const problems = allowlistProblems(input.allowlist);
  const lines: string[] = problems.map((problem) => `allowlist: ${problem}`);
  const usable = problems.length === 0 ? input.allowlist : [];
  const used = new Set<number>();
  const skipped = { oversized: 0, missing: 0 };
  const scanned = new Set<string>();
  let allowlisted = 0;
  for (const entry of input.entries) {
    // [B24-A2 review, 2026-10-06] security-1: a blob git did not return is never passed silently
    if (entry.missing === true) {
      skipped.missing += 1;
      lines.push(`unscanned: ${entry.path} (git returned no blob for it; nothing was scanned)`);
      continue;
    }
    const bytes = entry.bytes ?? utf8.encode(entry.text).byteLength;
    if (bytes > SECRET_SCAN_MAX_BYTES) {
      skipped.oversized += 1;
      continue;
    }
    // [B24-A2 review, 2026-10-06] security-1: a NUL byte no longer skips the file (three tracked .ts files hold raw NULs, and UTF-16
    // text holds one after every ASCII character); each line is matched as it is and, when it holds a NUL, with every NUL dropped
    scanned.add(entry.path);
    // in history mode the allowlist matches the <path> part of git's <commit>:<path>
    const allowPath = mode === "history" ? entry.path.slice(entry.path.indexOf(":") + 1) : entry.path;
    entry.text.split(NEWLINE).forEach((raw, index) => {
      const line = raw.endsWith(CR) ? raw.slice(0, -1) : raw;
      const views = line.includes(NUL) ? [line, line.split(NUL).join("")] : [line];
      const rules = SECRET_SCAN_RULES.filter((rule) => views.some((view) => rule.pattern.test(view)));
      if (rules.length === 0) return;
      const digest = lineDigest(line);
      for (const rule of rules) {
        const at = usable.findIndex((allowed) => allowed.path === allowPath && allowed.rule === rule.id && allowed.sha256 === digest);
        if (at >= 0) {
          used.add(at);
          allowlisted += 1;
        } else {
          lines.push(`${entry.path}:${index + 1} ${rule.id}`);
        }
      }
    });
  }
  if (mode === "tree") {
    usable.forEach((allowed, index) => {
      if (used.has(index)) return;
      lines.push(`allowlist: entry ${index + 1} (${allowed.path} ${allowed.rule}) is stale: ${scanned.has(allowed.path) ? "no line of that file hits with that digest" : "that path is no file of the tree"}`);
    });
  }
  return Object.freeze({ lines: Object.freeze(lines), exitCode: lines.length > 0 ? 1 : 0, skipped: Object.freeze(skipped), allowlisted });
}

// ── The command line (the script's arguments) ────────────────────────────────────────────────────────────────────────────────────

export type SecretScanCommand =
  | { readonly ok: true; readonly mode: "tree" }
  | { readonly ok: true; readonly mode: "staged" }
  | { readonly ok: true; readonly mode: "history"; readonly range: string }
  | { readonly ok: false; readonly refusal: string };

/** Exactly three forms: no argument (tree mode), `--staged`, `--history <range>`. A missing range, one that begins with `-` (it
 *  would be read as an option) or one holding whitespace or a NUL is refused before any git call. */
export function parseSecretScanArguments(argv: readonly string[]): SecretScanCommand {
  if (argv.length === 0) return { ok: true, mode: "tree" };
  if (argv.length === 1 && argv[0] === "--staged") return { ok: true, mode: "staged" };
  if (argv[0] === "--history") {
    const range = argv[1];
    if (argv.length !== 2 || range === undefined || range.length === 0) return { ok: false, refusal: "--history takes exactly one commit range" };
    if (range.startsWith("-")) return { ok: false, refusal: "the commit range begins with '-' and would be read as an option" };
    if (/[\s\u0000]/.test(range)) return { ok: false, refusal: "the commit range holds whitespace" };
    return { ok: true, mode: "history", range };
  }
  return { ok: false, refusal: "accepted: no argument (tree mode), --staged, or --history <range>" };
}

// ── Pure parsers of git's answers ────────────────────────────────────────────────────────────────────────────────────────────────

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const REGULAR_FILE = new Set(["100644", "100755"]);
const RAW_RECORD = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([A-Z])[0-9]*$/;

/** `git rev-list` output: one commit id per line, nothing else. */
export function parseRevList(text: string): string[] {
  const ids = text.split(NEWLINE).map((line) => (line.endsWith(CR) ? line.slice(0, -1) : line)).filter((line) => line.length > 0);
  for (const id of ids) if (!OBJECT_ID.test(id)) throw new Error("rev-list: an output line is not a commit id");
  return ids;
}

/** `git diff-tree -r -m --root --no-renames --no-abbrev -z` (or `git diff --cached --raw -z ...`) output: NUL-separated tokens, a
 *  commit-id header before each parent's records (diff-tree only), then `:srcmode dstmode srcid dstid status` and the path. The
 *  regular files a record adds, modifies or retypes are kept; deletions, symbolic links and submodules are not. */
export function parseDiffTree(text: string): Array<{ readonly blob: string; readonly path: string }> {
  const tokens = text.split(NUL);
  if (tokens[tokens.length - 1] === "") tokens.pop();
  const out: Array<{ blob: string; path: string }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!.replace(/^\n+/, "");
    if (OBJECT_ID.test(token)) continue; // a commit header
    const record = RAW_RECORD.exec(token);
    const path = tokens[index + 1];
    if (!record || path === undefined || path.length === 0) throw new Error("diff-tree: a malformed record");
    index += 1;
    const [, , dstMode, , blob, status] = record;
    if (status === "D" || !REGULAR_FILE.has(dstMode!) || /^0+$/.test(blob!)) continue;
    if (status !== "A" && status !== "M" && status !== "T") continue;
    out.push({ blob: blob!, path });
  }
  return out;
}

/** `git cat-file --batch-check` output: `<id> <type> <size>` (or `<id> missing`) per line. */
export function parseCatFileBatchCheck(text: string): Map<string, { readonly type: string; readonly size: number }> {
  const out = new Map<string, { type: string; size: number }>();
  for (const line of text.split(NEWLINE)) {
    if (line.length === 0) continue;
    const match = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) ([a-z]+) (\d+)$/.exec(line);
    if (match) out.set(match[1]!, { type: match[2]!, size: Number(match[3]) });
    else if (!/^[0-9a-f]+ missing$/.test(line)) throw new Error("cat-file --batch-check: a malformed line");
  }
  return out;
}

/** `git cat-file --batch` output: per object a `<id> <type> <size>` header line, exactly <size> bytes, then a line break. */
export function parseCatFileBatch(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const decoder = new TextDecoder("utf-8");
  let at = 0;
  while (at < bytes.byteLength) {
    const end = bytes.indexOf(10, at);
    if (end < 0) throw new Error("cat-file --batch: a header without its line break");
    const header = decoder.decode(bytes.subarray(at, end));
    const match = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) ([a-z]+) (\d+)$/.exec(header);
    if (!match) throw new Error("cat-file --batch: a malformed header");
    const size = Number(match[3]);
    const start = end + 1;
    if (start + size >= bytes.byteLength + 1 || bytes[start + size] !== 10) throw new Error("cat-file --batch: an object of the wrong size");
    out.set(match[1]!, bytes.subarray(start, start + size));
    at = start + size + 1;
  }
  return out;
}

// ── Listing (through an injected, read-only git) ─────────────────────────────────────────────────────────────────────────────────

export interface SecretScanIo {
  /** runs `git <args>` (an argument array, never a shell) and returns its standard output */
  readonly git: (args: readonly string[], input?: string) => Uint8Array;
  /** a regular file's bytes, relative to the repository root, or null (missing, a directory, a link) */
  readonly readFile: (path: string) => Uint8Array | null;
}
export interface CollectedSecretScanEntries {
  readonly entries: readonly SecretScanEntry[];
  /** listed paths that are no regular file on disk (tree mode) */
  readonly unreadable: number;
  /** [B24-A2 review, 2026-10-06] security-3: why nothing could be scanned - nothing staged, or a range with no commit; the run fails */
  readonly nothing?: string;
}

const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

/** [B24-A2 review, 2026-10-06] security-1: the text a scan reads from a file's bytes - UTF-16 when they open with its byte-order mark
 *  (little or big endian), otherwise UTF-8 (an invalid sequence read as U+FFFD, a UTF-8 byte-order mark dropped). A NUL byte decides
 *  nothing: `runSecretScan` matches a line holding one with and without its NULs, so BOM-less UTF-16 is caught too. */
export function decodeScanText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - (bytes.length % 2));
    for (let at = 0; at < swapped.length; at += 2) {
      swapped[at] = bytes[at + 1]!;
      swapped[at + 1] = bytes[at]!;
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder("utf-8").decode(bytes);
}
/** At most this many objects, or this many bytes, per `cat-file --batch` call. */
const BATCH_OBJECTS = 256;
const BATCH_BYTES = 64 * 1024 * 1024;

/** Read blobs once each: sizes first, then the ones within the bound in bounded batches; an oversized blob is never read. */
function readBlobs(io: SecretScanIo, ids: readonly string[]): { contents: Map<string, Uint8Array>; sizes: Map<string, number> } {
  const contents = new Map<string, Uint8Array>();
  const sizes = new Map<string, number>();
  if (ids.length === 0) return { contents, sizes };
  const checked = parseCatFileBatchCheck(decode(io.git(["cat-file", "--batch-check"], `${ids.join(NEWLINE)}${NEWLINE}`)));
  let batch: string[] = [];
  let batchBytes = 0;
  const flush = (): void => {
    if (batch.length === 0) return;
    for (const [id, body] of parseCatFileBatch(io.git(["cat-file", "--batch"], `${batch.join(NEWLINE)}${NEWLINE}`))) contents.set(id, body);
    batch = [];
    batchBytes = 0;
  };
  for (const id of ids) {
    const size = checked.get(id)?.size;
    if (size === undefined) continue;
    sizes.set(id, size);
    if (size > SECRET_SCAN_MAX_BYTES) continue;
    if (batch.length >= BATCH_OBJECTS || batchBytes + size > BATCH_BYTES) flush();
    batch.push(id);
    batchBytes += size;
  }
  flush();
  return { contents, sizes };
}
/** One blob's entry: its text, or an oversized blob by its size only (never read). [B24-A2 review, 2026-10-06] security-1: a blob git
 *  did not return - no size from batch-check (`missing`), or no body from `--batch` - is a missing entry, never dropped or scanned as
 *  empty. */
function blobEntry(path: string, id: string, read: { contents: Map<string, Uint8Array>; sizes: Map<string, number> }): SecretScanEntry {
  const size = read.sizes.get(id);
  if (size === undefined) return { path, text: "", missing: true };
  if (size > SECRET_SCAN_MAX_BYTES) return { path, text: "", bytes: size };
  const body = read.contents.get(id);
  return body === undefined ? { path, text: "", missing: true } : { path, text: decodeScanText(body), bytes: body.byteLength };
}

/** The entries of one command: the listed files (tree), the staged blobs (staged) or the blobs a commit range brought (history). */
export function collectSecretScanEntries(command: Extract<SecretScanCommand, { ok: true }>, io: SecretScanIo): CollectedSecretScanEntries {
  if (command.mode === "tree") {
    const paths = [...new Set(decode(io.git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])).split(NUL).filter((path) => path.length > 0))];
    const entries: SecretScanEntry[] = [];
    let unreadable = 0;
    for (const path of paths) {
      const bytes = io.readFile(path);
      if (bytes === null) unreadable += 1;
      else entries.push({ path, text: decodeScanText(bytes), bytes: bytes.byteLength });
    }
    return { entries, unreadable };
  }
  if (command.mode === "staged") {
    // [B24-A2 review, 2026-10-06] security-3: no diff filter, so a staged deletion still counts as something staged (the parser keeps
    // only the added, modified or retyped regular files); an empty index diff is nothing staged, and the run fails
    const raw = decode(io.git(["diff", "--cached", "--raw", "-z", "--no-renames", "--no-abbrev"]));
    const records = parseDiffTree(raw);
    const read = readBlobs(io, [...new Set(records.map((record) => record.blob))]);
    const entries = records.map((record) => blobEntry(record.path, record.blob, read));
    return raw.length === 0 ? { entries, unreadable: 0, nothing: "the index holds no staged change (after a commit, scan the unpushed commits with --history origin/<branch>..HEAD)" } : { entries, unreadable: 0 };
  }
  // history: every commit of the range, oldest first; each blob and path once, under the first commit that brought it there
  const commits = parseRevList(decode(io.git(["rev-list", "--reverse", command.range, "--"])));
  if (commits.length === 0) return { entries: [], unreadable: 0, nothing: "the range holds no commit" }; // [B24-A2 review, 2026-10-06] security-3
  const seen = new Set<string>();
  const firsts: Array<{ commit: string; path: string; blob: string }> = [];
  for (const commit of commits) {
    for (const record of parseDiffTree(decode(io.git(["diff-tree", "-r", "-m", "--root", "--no-renames", "--no-abbrev", "-z", commit])))) {
      const key = `${record.blob} ${record.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      firsts.push({ commit, ...record });
    }
  }
  const read = readBlobs(io, [...new Set(firsts.map((first) => first.blob))]);
  const entries = firsts.map((first) => blobEntry(`${first.commit}:${first.path}`, first.blob, read));
  return { entries, unreadable: 0 };
}

/** The whole command as the script runs it: parse (a refusal exits 2 before any git call), list, scan. [B24-A2 review, 2026-10-06]
 *  security-3: a --staged or --history run that had nothing to scan exits 1 with a `nothing scanned:` line, never 0. */
export function runSecretScanCommand(argv: readonly string[], io: SecretScanIo, allowlist: readonly SecretScanAllowlistEntry[]): Omit<SecretScanResult, "exitCode"> & { readonly mode: SecretScanMode | null; readonly entries: number; readonly unreadable: number; readonly refusal: string | null; readonly exitCode: 0 | 1 | 2 } {
  const command = parseSecretScanArguments(argv);
  if (!command.ok) return { lines: [], exitCode: 2, skipped: { oversized: 0, missing: 0 }, allowlisted: 0, mode: null, entries: 0, unreadable: 0, refusal: command.refusal };
  const collected = collectSecretScanEntries(command, io);
  const result = runSecretScan({ entries: collected.entries, allowlist, mode: command.mode });
  const nothing = collected.nothing === undefined ? null : Object.freeze([...result.lines, `nothing scanned: ${collected.nothing}`]);
  return { ...result, ...(nothing === null ? {} : { lines: nothing, exitCode: 1 as const }), mode: command.mode, entries: collected.entries.length, unreadable: collected.unreadable, refusal: null };
}
