# B16.0.5 — Unknowns, owner decisions, and analyzer soundness boundary

## Owner decisions

1. **415 is now enforced, not deferred.** B16.0.4 had recorded 415 retrofit as
   an optional "owner decision"; the stage contract requires it. B16.0.5
   enforces it at the bounded-reader chokepoint (default on) and on the two
   streaming JSON routes. The behavior change (JSON posts must send
   `Content-Type: application/json`) is intended; its 7-test fallout was fixed by
   sending the correct header.
2. **Intentionally non-JSON endpoints** must opt out explicitly
   (`requireJsonContentType: false`). None do today. If a future route accepts
   form-data or a raw binary body, it must set that flag AND enforce its own
   media allowlist — recorded here so the default cannot be silently bypassed.
3. **Adopting the audited wrapper for the 118 guard-first routes** remains
   optional; it upgrades polarity + dominance + raw-request isolation from
   analyzer-verified to true-by-construction. Not required by this stage.

## Analyzer soundness boundary (honest)

- The analyzer is a **conservative, fail-closed static** analysis. The B16.0.5
  corrections only TIGHTEN it (a former PASS can become a REJECT, never the
  reverse), so it cannot newly accept a hazard it modeled.
- **Polarity** is proven structurally for the canonical negation forms
  (`!x.ok`, `x.ok === false`, `!x`, boolean boundary calls). A guard expressed
  through an idiom outside that set (e.g. a positive-block `if (x.ok) { … } else
  return`) is **rejected**, not silently accepted — a route wanting it must use
  the canonical form or the wrapper.
- **Wrapper/factory identity** is resolved to the exact canonical file and the
  original exported symbol. A build-time path-alias remapping that made a
  different file resolve to `app/lib/auth/route-handlers.ts` is out of scope;
  the analyzer trusts the repository's own module resolution.
- **Taint tracking** covers the reproduced forms and bounded interprocedural
  following (depth 4, in-file + imported helpers, factory closures). Exotic
  reflection (`Reflect.get(request, "json")`, dynamic property names computed at
  runtime, request escaping into a global) is not modeled; such a construct in a
  production route would be a review finding, and the §C gate still fails any
  route it cannot prove clean because a canonical bounded reader is required.

## Residual risk carried forward

- **R9 live-Supabase production auth remains UNKNOWN** — no live database was
  contacted, per the stage constraints.
- Wall-clock perf tests remain load-sensitive; green in isolation and under the
  bounded-fork validation. The vitest `onTaskUpdate` worker timeout under
  maximal parallelism is a reporter/worker infra artifact, not a test failure —
  see [test-and-validation-report.md](test-and-validation-report.md).

## Scope adherence

- Work confined to `C:\Users\robsa\Desktop\sirkit-edit`; `C:\Users\robsa\sirkit`
  untouched.
- No provider credits spent; no live database contacted or mutated.
- No security test weakened, deleted, skipped, or broadly excluded — the media
  fallout fixes only add the correct `Content-Type` header a real JSON client
  sends; the b11-5 test-write admission ADDS an OS-temp-confinement invariant.
- **B16.1, MCP, multi-agent, manufacturing integration, provider expansion, and
  new tool exposure were NOT started**; exactly **12** exposed tools, replay
  pins, authoritative hashes, and internal-only manufacturing release preserved.
