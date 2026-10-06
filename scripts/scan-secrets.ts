/**
 * [B24-A2] D24-4, OD-195, runbook :168 - the secret scan's shell. It lists files through read-only git calls and prints the scan's
 * lines; every judgement is the pure `runSecretScan` (app/lib/deployment/secret-scan.ts) against the reviewed allowlist.
 *
 *   pnpm exec tsx scripts/scan-secrets.ts                       tree mode: `git ls-files` (tracked, and untracked but not ignored)
 *   pnpm exec tsx scripts/scan-secrets.ts --staged              the staged blobs (before a commit; after it: --history origin/<branch>..HEAD)
 *   pnpm exec tsx scripts/scan-secrets.ts --history <range>     the blobs each commit of the range added or changed, merges included
 *
 * Standard output holds only `path:line rule` lines (history mode: `<commit>:<path>:<line> <rule>`) and allowlist problems - never
 * the matched text or any file content; the summary goes to standard error. Exit 0 when clean, 1 on any hit the allowlist does not
 * hold (or a stale or refused entry, a blob git did not return, or a --staged or --history run with nothing to scan: [B24-A2 review]),
 * 2 when the arguments are refused - before any git call. Each git call is `execFileSync` with an argument array and no shell; nothing is written.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runSecretScanCommand, type SecretScanIo } from "../app/lib/deployment/secret-scan";
import { SECRET_SCAN_ALLOWLIST } from "../app/lib/deployment/secret-scan-allowlist";

const root = process.cwd();

const io: SecretScanIo = {
  git: (args, input) => execFileSync("git", [...args], { cwd: root, input, maxBuffer: 256 * 1024 * 1024, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }),
  readFile: (path) => {
    const full = join(root, path);
    const stats = lstatSync(full, { throwIfNoEntry: false });
    return stats?.isFile() ? readFileSync(full) : null;
  },
};

const result = runSecretScanCommand(process.argv.slice(2), io, SECRET_SCAN_ALLOWLIST);
if (result.refusal !== null) {
  process.stderr.write(`scan-secrets: refused: ${result.refusal}\n`);
} else {
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  process.stderr.write(`scan-secrets (${result.mode}): ${result.entries} entries scanned or skipped; skipped ${result.skipped.oversized} oversized; ${result.skipped.missing} blobs git did not return (unscanned, failing); ${result.unreadable} listed paths not a regular file; ${result.allowlisted} allowlisted line(s); exit ${result.exitCode}\n`); // [B24-A2 review, 2026-10-06] security-1: no binary skip any more
}
process.exitCode = result.exitCode;
