# B16.0.24.1 §1 — bounded simulator file-read proof

`readBoundedRawFile(path, maxBytes)` in `app/api/simulate/route.ts`:

- **File handle, not `readFile`**: opened via `open(path, "r")`; the handle is
  closed in EVERY path (`finally` + swallowed close error) — pinned: close
  count 1 on success, over-limit, read-error, and huge-declared paths; a close
  ERROR never masks the read outcome (pinned). **CONFIRMED**.
- **Size obtained and verified, never trusted for allocation**: `handle.stat()`
  is an ADVISORY fast-fail only — a petabyte-declared artifact refuses
  over-limit with ZERO content reads and zero size-derived allocation (pinned:
  fake handle, `read` never called). **CONFIRMED**.
- **At most maxBytes + 1 bytes into bounded storage**: fixed 64 KiB chunk
  buffer; accumulation stops the moment the running total crosses `maxBytes`
  (over-limit). Storage is proportional to ACTUAL bytes read, capped.
  **CONFIRMED**.
- **Oversized output refused explicitly; never parsed**: route-level pins —
  a 20,000,001-byte artifact → 500 `{ ok:false, error:"Simulation output
  exceeded the bounded size limit" }` (parse never begins; envelope proves
  it); an EXACTLY-20,000,000-byte artifact → 200 with parsed data. Unit pins:
  ceiling accepted, ceiling+1 refused. Source gate: the over-limit refusal
  string precedes `parseAsciiRaw` in the POST callback. **CONFIRMED**.
- **Stat/read/truncation races safe**: a handle whose stat CLAIMS 10 bytes but
  streams forever is stopped by the actual-read cap within one chunk past the
  ceiling (pinned: ≤ 4,096 bytes consumed for a 2,000-byte cap). **CONFIRMED**.
- **Invalid UTF-8 fails deterministically**: fatal `TextDecoder` → explicit
  `invalid-utf8` → 500 "Could not parse simulation output" (never the previous
  lossy replacement-character decode). **CONFIRMED**.
- **Settle-once**: every failure (read error, close error, over-limit,
  missing file) resolves exactly once to a typed result — no throw escapes,
  no double settlement. **CONFIRMED**.
- **Cleanup preserved**: the route's `finally { rm(directory, …) }` runs on
  the new over-limit/invalid-utf8 paths exactly as on every other path.
  **CONFIRMED**.
- **The implementation never calls unbounded `readFile`**: source gate —
  `app/api/simulate/route.ts` contains no `readFile(` and no
  `.slice(0, MAX_RAW_BYTES)`. **CONFIRMED**.

## Behavior deltas (documented supersessions of B16.0.24 claims)

| input | B16.0.24 (defective) | B16.0.24.1 |
|---|---|---|
| artifact > 20 MB | full buffer + silent truncation + parse of partial output | explicit 500 over-limit refusal, ≤ cap+chunk bytes read |
| invalid UTF-8 artifact | lossy replacement-char decode → parse | deterministic 500 refusal |
| artifact ≤ 20 MB valid | parsed | parsed (unchanged) |
| missing artifact | 500 no-output-file | 500 no-output-file (unchanged) |

## [SUPERSEDED IN PART - B22-A3, 2026-10-01]

`readBoundedRawFile` no longer lives in `app/api/simulate/route.ts`: B22-A3 lifted it into the diagnostic runner
(`app/lib/computation/diagnostic-runner.ts`), over B22-A1's `readBoundedFile`, and the route re-exports it for the B16.0.24.1
suite. The runner reads `result.raw` back with it after a zero exit, bounded by the caller's tighter limit (`/api/simulate`'s
20 MB, the Studio worker's 100 MiB), and removes the run directory in `finally`; the properties above (file handle, advisory
size, at most the bound read, explicit over-limit refusal, fatal UTF-8 decode, settle-once) hold there and are pinned by
`b16-0-24-1-security-correction` and `b22-a3-diagnostic-runner` case 5.
