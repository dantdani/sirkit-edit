# Local Freerouting integration — no hosted API key

Date: 2026-07-15

## Why

The existing Route board control already used the Freerouting CLI contract, but
it required an operator-provided JAR and system Java. That looked like a hosted
API credential problem when the runtime was absent. Sirkit now owns a pinned,
reproducible local runtime instead; the public Freerouting API is not used.

## What changed

- Cloned the official GPLv3 Freerouting source at tag `v2.2.4`, commit
  `20f1a72e546b9b23c7ba5127086885cfacbdd4be`, under the protected working copy's
  ignored `vendor/freerouting` directory.
- Added `npm run setup:freerouting`. The PowerShell installer downloads the
  official v2.2.4 executable JAR and Eclipse Temurin JRE 25.0.3+9, verifies both
  SHA-256 checksums, verifies the source commit, and writes a local manifest.
- Added automatic runtime discovery. Sirkit prefers explicit operator overrides,
  then the verified release, then a JAR built from the pinned source clone.
- The subprocess is headless, disables Freerouting's API server and anonymous
  analytics, and receives only a small allowlist of OS variables. Sirkit's AI,
  database, and distributor secrets are not inherited by Java.
- The autoroute API reports its engine/version and `apiKeyRequired: false`.
  Missing-runtime UI guidance points to the setup command instead of an API key.
- Repaired two pre-existing DSN interoperability defects exposed only by the
  real executable: Sirkit now converts nanometers to Freerouting's supported
  micrometer unit and emits Specctra pins as `"component"-"pin"`. The SES
  reader performs the inverse unit conversion on import.

## Supply-chain pins

- Freerouting JAR SHA-256:
  `f5ed374182900ccc78e473518bbb9f6b869f4a07159495f663a76f52bb10523b`
- Temurin JRE archive SHA-256:
  `a183e7280220ad5f6fe94ecbf025a5f10fc5797a0b18c600ed8f813c8158c530`

## Safety boundary

The original `C:\Users\robsa\sirkit` directory was not modified. All source,
downloads, integration code, tests, and documentation live in
`C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`.

## Verification

- Installer completed with both published hashes verified; bundled Java reports
  Eclipse Temurin 25.0.3+9.
- Direct real-engine test on the auto-placed story board: 172 tracks and 8 vias
  parsed from SES in 21.7 seconds.
- Real Next.js API test: HTTP 200, 172 tracks, 8 vias, engine v2.2.4,
  `apiKeyRequired: false`.
- Live browser workflow: Auto-place then the toolbar autoroute control completed
  in 24.8 seconds, routed 10/11 nets, displayed `Freerouting 2.2.4 local`, and
  exposed `Undo Autoroute board` as one history step. No API-key dialog appeared.
- Autoroute/DSN targeted suite: 25/25 passing. TypeScript and touched-file ESLint:
  clean. Production `next build`: passed.
- Full repository suite: 510 passed, 9 skipped. Three unrelated performance
  gates missed wall-clock thresholds under the loaded dev/build environment;
  isolated reruns cleared DRC and zone-fill, while the existing route-preview
  case still exceeded Vitest's 5-second test timeout despite reporting a
  62.6 ms p95 preview latency. No autoroute correctness test failed.
