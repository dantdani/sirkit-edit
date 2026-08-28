# B16.0.23 §H — reports and bundles

## Reports (public)

- `reports` renders exactly the caller-supplied project + run records into a
  downloadable document; it reads no durable state and INVENTS no results —
  it formats the evidence it is given. **CONFIRMED**.
- Output contract preserved byte-for-shape: default JSON attachment
  (`application/json; charset=utf-8`, `Content-Disposition: attachment;
  filename="sirkit-spice-report.json"`), `format:"html"` → HTML attachment.
  Pinned. **CONFIRMED**.
- It is a rendered document, never a certification object — no signoff/
  certification/manufacturing-release wording anywhere in the route (gate).
  **CONFIRMED**.

## Bundle (protected, scope-confined)

- `runs/[id]/bundle` authorizes (query selector for the anchor-download
  surface) BEFORE any artifact read; a foreign/missing run is the uniform 404;
  an artifact-less run is 409 `Run has no reproducibility artifacts` (pinned
  exact). **CONFIRMED**.
- The zip includes ONLY this run's recorded artifacts (manifest, generated/
  normalized/executed netlists + source map, scalars, waveforms, logs,
  diagnostics, README) — all read from the scope-owned run record. **CONFIRMED**.
- **No directory traversal**: the optional raw-vector read is confined by a
  path-PREFIX check — `resolve(run.artifactId)` must start with
  `resolve(join(tmpdir(),"sirkit-spice")) + sep` before `readFile`; anything
  outside the server-owned artifact root is skipped. `run.artifactId` is
  server-assigned, never caller-supplied. The zip member names are fixed
  literals (no caller-controlled filenames). **CONFIRMED**.
- Attachment named by the run id (`sirkit-spice-<runId>.zip`), `application/
  zip`, non-zero content-length. Pinned. **CONFIRMED**.
