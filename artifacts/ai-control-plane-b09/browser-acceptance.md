# B09 — Browser Acceptance (2026-08-08)

Environment: the actual app from `C:\Users\robsa\Desktop\sirkit-edit`
(`pnpm dev`, Next.js 16.2.6, http://localhost:3000), fresh browser
session (empty localStorage). Screenshots were NOT capturable in this
session: the automation browser pane was never displayed, so the page
never composited frames (`screenshot` timed out by design). All evidence
below is text/DOM/network/server-log evidence captured from the live app.

## Credential reality (disclosed up front)

Both provider accounts turned out to have NO usable credits:

- OpenAI: every run failed `insufficient_quota` ("out of credits or over
  its billing quota") — classified and surfaced truthfully by the new
  protocol.
- Anthropic: the account's remaining balance was consumed by the live
  per-tool schema validation probe below; subsequent calls returned the
  credit-balance error.

Per the stage instructions, NO live model behavior is fabricated: every
scenario needing a completed model turn is marked **UNKNOWN (live)** and
covered by the complete mocked-adapter suites (26 B09 tests over the real
adapters/loop/gateway/services).

## What WAS demonstrated live

1. **App + seeded schematic.** A project ("B09 acceptance") with theory
   components r1=10k, r2=4.7k, c1=100n + one wire was seeded through the
   app's own persistence schema and hydrated; the canvas rendered
   `r1 10k r2 4.7k c1 100n` (DOM text evidence).
2. **Versioned NDJSON protocol end-to-end.** Chat submit produced
   `POST /api/chat → 200` with `Content-Type: application/x-ndjson`,
   `X-Sirkit-Chat-Protocol: 1`, `X-Sirkit-Run-Id: run-…`; the activity UI
   showed the event-driven steps ("Submitting message" → "Calling
   assistant" → "Streaming response") and the run terminated with a
   truthful `run_failed` rendering.
3. **Classified provider failures, no secrets.** OpenAI:
   "The OpenAI account is out of credits or over its billing quota…
   retrying will not help until then. Choose an action below." Anthropic
   (before the schema fix): "Anthropic rejected the request as malformed.
   This is a Sirkit-side request construction problem, not an account
   issue." Both distinguishable, actionable, credential-free; chat text
   stayed separate from tool/activity state.
4. **Live strict-schema parity check (Anthropic API).** A transient probe
   validated EVERY exposed tool declaration against the real
   `/v1/messages` endpoint with `strict: true`. It caught a REAL wire
   incompatibility — `tools.0.custom: For 'array' type, property
   'maxItems' is not supported` on `sirkit_schematic_propose-tier1-edit` —
   which was fixed (bounds moved to runtime validation); afterwards all
   8 declarations were accepted (`OK`) until the account balance ran out.
   The probe script was deleted after use; no key values were printed.
5. **Provider switch = new run.** Switching the brain OpenAI → Anthropic
   issued a NEW `/api/chat` request (new run id) — no silent fallback
   occurred on the failing run (its failure stayed rendered).

## Scenario status

| # | scenario | status |
|---|---|---|
| 1 | tool-grounded schematic inspection via chat | **UNKNOWN (live)** — provider credits exhausted; proven by loop-safety test 14 (real ReadToolInvocationService, revision-pinned output) and the live protocol/activity evidence above |
| 2 | propose delete/edit → review UI, unchanged before approval | **UNKNOWN (live)**; proven by proposal tests 27–28 (gateway seal mutates nothing; artifact enters `verifySealedTier1Proposal`) and the UI routing of `proposal_ready` → `setPendingTier1` (existing review boundary) |
| 3 | apply exact proposal → one canonical transaction; undo restores | **UNKNOWN (live)**; proven by proposal test 29–30 against the real SchematicEditorSession (one executed transaction; undo restores the exact digest) |
| 4 | stale application rejected after schematic change | **UNKNOWN (live)**; proven by proposal test 32 (stale-base/altered/expired/foreign all refuse) |
| 5 | project switch during pending call leaks nothing | Partially live: the B07.4 scope gate is the same mechanism observed cancelling stream consumption; proven by loop-safety tests 19/22–24 |
| 6 | manufacturing-release refusal in chat | **UNKNOWN (live)** for the model's phrasing; STRUCTURALLY guaranteed — no release descriptor is exposed (b04 tripwire + proposal test 34) and the system prompt states release is unavailable |
| 7 | equivalent tool request on both providers | **UNKNOWN (live)** — neither account has credits; mocked adapter coverage (contract tests 1–10) proves semantic-equivalent traces |

Re-running scenarios 1–7 live requires only provider credits; no code
path is blocked.
