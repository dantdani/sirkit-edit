# B16.0.23 §H — events and waveforms

## Events (SSE)

- Authorize BEFORE opening the stream or adding ANY listener: a non-owner is
  refused (uniform 404 / 403 selector) with ZERO listeners registered
  (standing scope-isolation pin: `runListenerCount` stays 0). **CONFIRMED**.
- Content-type `text/event-stream`; the FIRST frame is the current run
  snapshot (`event: run`); a terminal run status closes the stream (pinned:
  second read is `done`). Refusals never carry the event-stream content-type.
  **CONFIRMED**.
- The subscription is re-scope-checked inside the store; a cancelled reader
  drops the listener back to zero. **CONFIRMED**.

## Waveforms

- Scope-confined read: foreign/missing run → uniform 404. **CONFIRMED**.
- Without `signal` → a bounded metadata list (name/unit/x-name/x-unit/points)
  — pinned exact. **CONFIRMED**.
- With `signal` → slice + min/max downsample, with the point count clamped
  server-side to `[32, 20_000]` — a caller passing `points=999999` gets at
  most ~20,002 samples (pinned). The caller can never inflate the read.
  **CONFIRMED**.
- Metadata agrees with the artifact: `rawPoints` equals the sliced source
  length (pinned), so the returned window count cannot disagree with the
  underlying vector. An unknown signal → 404 `{ ok:false, error:"Signal not
  found" }` (pinned exact). **CONFIRMED**.
