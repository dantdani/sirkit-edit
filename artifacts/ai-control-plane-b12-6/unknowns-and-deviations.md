# B12.6 — unknowns and deviations

## Deviations from the stage text

None material. Notes:

- The stage's closure item 3 lists "flush() throws → { ok: false }".
  The PRODUCTION `createAutosaver.flush()` cannot throw (it converts a
  throwing save function into a false return with the message recorded
  on status — itself proven in the suite). The helper still guards the
  throw path for foreign/hostile `Autosaver` implementations, and the
  permanent tests exercise BOTH shapes.
- "Missing autosaver or no pending work: { ok: true }" — for "no
  pending work" the helper simply calls `flush()`, which is a true
  no-op returning true when nothing is pending (proven: zero save
  calls, status untouched). No separate pending-inspection API was
  added — the autosaver's own contract already encodes it.
- The reproduction models storage failure by a save function returning
  `{ ok: false, reason: "quota" }` — exactly how the page's
  `persistProject` reports quota failures to the autosaver — not by a
  mocked flush boolean; the real `createAutosaver` supplies the
  false-return/pending/status behavior under test.

## Residual unknowns

- **Destroy-window loss (out of scope, pre-existing):** on unmount the
  autosaver's `destroy()` runs one final `run()`; if THAT write fails,
  the pending state is lost with the component (nothing retains it
  after teardown). B12.6's boundary guarantees a transition never
  proceeds over a failed save, but page unload/crash after a failed
  autosave remains bounded by the browser-storage reality it always
  had. PROPOSED follow-up, not part of this stage's finding.
- **Live-browser composition** remains INFERRED as in B12.5: the hook
  is proven through the real coordinator + real autosaver in vitest;
  no full-page React mount exercises it end-to-end.
- **No live provider validation:** provider-free by construction; no
  credits spent; no provider configuration changed.
