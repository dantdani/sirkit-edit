# B14.2 — final verdict

**Stop condition:** "B14.2 is complete only when every reauthorization
transport and stream settles within a hard bound, timeout cannot retain the
commit lease or block project transitions, request/response correlation is
real and accurately documented, the authority-bearing controller has a
permanent trusted-import boundary, the rendered UI path still commits
exactly once, and the full suite remains green."

**Verdict: MET.**

1. **Hard total settlement.** Every reauthorization consumption settles
   exactly once within the documented 10 s deadline under the B09.2/B13.2
   race discipline: the internal AbortSignal cancels the production fetch
   and body read, late results are discarded/observed, timers clear on every
   terminal path, pre-aborted consumption performs no transport, and the
   one-shot channel discipline survives timeout and abort.
2. **Timeout cannot hold anything.** A hung transport yields
   `authority-unavailable` with zero journal entries and zero canonical
   transactions; afterwards the commit lease acquires, ordinary commands
   execute through the same serialized gateway, and `interlock.retire()`
   settles.
3. **Real streaming bounds.** Both HTTP directions consume through the ONE
   extracted B10.1/B10.2 bounded reader — oversized/never-ending streams
   refuse at the byte ceiling without buffering or partial-JSON parsing,
   never-settling cancellation cannot delay settlement, and the transport
   enforces JSON content type, `no-store`, and redirect refusal.
4. **Real correlation, honestly documented.** A platform-random nonce
   travels in the request and is validated + echoed in the allowlisted
   binding with the component locator and the server-constructed scope; the
   channel verifies the echo before accepting facts. It is correlation and
   replay defence for the exchange — never server authentication; the
   local-only scope disposition is unchanged.
5. **Permanent trusted-import boundary.** The authority-bearing controller
   is an internal composition-boundary module importable only by page.tsx;
   the channel module and test factory carry their own walkers; a
   synthetic-injection tripwire proves the gates detect violations; the
   guarantee is documented as trusted interactive composition, not
   cryptographic human proof.
6. **The rendered UI path still commits exactly once** through the real
   nonce-bound endpoint exchange, and everything else stays green: FULL
   SUITE **2714 passed / 20 skipped / 0 failures**; tsc clean; scoped ESLint
   clean; page baseline unchanged; pins/hashes untouched
   (`e66dd9e0…`/`f18e47e0…`/`72ad7c77…`/`5501d810…`); `git diff --check`
   clean; protected original at its 6-entry baseline.

Classification: **CONFIRMED** — R1–R4 reproductions and every closure above.
**INFERRED** — browser-realm fetch/AbortSignal behaviour (the jsdom/undici
realm split requires stripping the signal at the PLATFORM STUB only; in a
real browser both sides share one realm, and signal threading is proven at
the channel level). **PROPOSED** — none required. **UNKNOWN** — none
material.

**B15, PCB mutation exposure, manufacturing release, MCP, external
component APIs, provider expansion, and multi-agent work are NOT started.
Stopped; awaiting independent verification.**

---

> **SUPERSESSION NOTE (B14.3).** Verdict point 1 ("settles exactly once
> within the documented 10 s deadline no matter what the … response stream
> … does") and point 3 ("never-ending streams refuse at the byte ceiling")
> were overstated in two respects, and one evidence figure was wrong:
> (a) the ENDPOINT could still hang forever on a request stream that never
> emitted its first chunk; (b) after a response-stream timeout the active
> reader was ABANDONED uncanceled; (c) the B14/B14.1 suite count is 60, not
> 58. B14.3 reproduces and closes (a) and (b) — hard request-read deadline
> (408), reader cancellation on abandonment, real hung-body regressions,
> hardened specifier-resolving import gates — and corrects (c). The
> remaining verdicts (timeout holds nothing, real correlation, trusted
> import boundary, one canonical commit) stand. See
> `../ai-control-plane-b14-3/final-verdict.md`.
