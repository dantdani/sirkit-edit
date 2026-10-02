# B16.0.24 §G — simulator output & cleanup proof

## Bounded output & parse

| bound | value | where |
|---|---|---|
| stdout/stderr accumulation | 1 MB (`slice(-MAX_OUTPUT_BYTES)`) | `runNgspice` [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): the diagnostic runner's channels, 64 KiB each (B22-A1, B22-A3)] |
| raw-file read | 20 MB (`slice(0, MAX_RAW_BYTES)`) | after read |
| parsed numeric tokens | 5,000,000 | `parseAsciiRaw` |
| parsed points | 2,000,000 | `parseAsciiRaw` |
| parsed variables | 10,000 | `parseAsciiRaw` |
| error-body text | 3,000 chars (`stderr.slice(-3000)`) | 500 path |

No design data is logged to the server (the raw route's
`console.error("[simulate] netlist…/raw…/stderr…")` calls were removed —
gate: the route contains no `console.error("[simulate]"`), and the netlist is
no longer echoed in error bodies.

## Deterministic cleanup — every path

`finally { if (directory) await rm(directory, { recursive: true, force: true })
}` runs on: [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): the cleanup is the diagnostic runner's finally over its per-run directory (B22-A3)]

- success (result returned),
- semantic-validation refusal (400) — returns before `directory` is created,
  so nothing to clean,
- netlist-generation / injection-guard refusal (400) — same,
- ngspice non-zero exit (500),
- timeout (504),
- spawn error / ENOENT (500),
- parse error (500),
- no-output-file / no-data-points (500),
- client abort / disconnect (the runner is killed; the finally still runs).

The per-request isolated directory guarantees no cross-run artifact leakage,
and `force: true` swallows a missing directory. **CONFIRMED.** [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): a per-run directory only, the diagnostic runner's, with no isolation boundary (B22-A3)]

---

## [SUPERSEDED IN PART — B16.0.24.1 §1]

The "raw-file read | 20 MB (`slice(0, MAX_RAW_BYTES)`)" row above described a
TRUNCATION, not a bounded read: `readFile` buffered the COMPLETE file into
memory before the slice, so an adversarially large artifact caused a
proportional allocation, and a truncated (partial) artifact could still be
parsed. B16.0.24.1 replaced it with `readBoundedRawFile` — a file-handle,
chunked reader that allocates only for actual bytes (never the declared size),
refuses over-ceiling output EXPLICITLY (500 "Simulation output exceeded the
bounded size limit"; partial output is never parsed), decodes UTF-8 fatally
(deterministic failure), and closes the handle in every path. See
`artifacts/ai-control-plane-b16-0-24-1/bounded-file-read-proof.md`.
