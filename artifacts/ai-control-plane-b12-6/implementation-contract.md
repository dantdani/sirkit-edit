# B12.6 — implementation contract

Symbol: `settleAutosaveForTransition(autosaver: Autosaver | null | undefined): AutosaveSettlement`
Module: [app/lib/project/autosave.ts](../../app/lib/project/autosave.ts)
(hook-free, framework-free, exported beside the `Autosaver` it settles —
the page and the permanent tests import the SAME function).
`AutosaveSettlement = { ok: true } | { ok: false; detail: string }` —
structurally identical to the coordinator's `BeforeInstallOutcome`
(declared locally so `app/lib/project` does not import
`app/lib/engineering`).

| Input condition | Result |
| --- | --- |
| `autosaver` null/undefined (bootstrap window — no autosaver armed yet) | `{ ok: true }` |
| Nothing pending (`flush()` → true without running a save) | `{ ok: true }` — proven side-effect-free (save call count 0, status untouched) |
| Pending write succeeds (`flush()` → true) | `{ ok: true }` |
| Pending write fails (`flush()` → false) | `{ ok: false, detail }` — detail prefers the autosaver's recorded `status().detail` when its state is `error` |
| `flush()` throws (foreign/hostile implementations; the production autosaver never throws) | `{ ok: false, detail: "autosave flush threw: …" }` |
| `status()` throws while composing the failure detail | the refusal stands with the bare prefix — a hostile status can neither break the refusal nor smuggle content |

## Bounded, safe detail

Failure detail = fixed prefix + optional reason passed through
`sanitizeTraceText(reason, 200)` (the shared dependency-neutral
redaction module, [app/lib/agent/redaction.ts](../../app/lib/agent/redaction.ts)):
secret-shaped content (API keys, bearer tokens, credential patterns) is
replaced with `[redacted]` and the text is hard-capped at 200 chars —
never raw exception dumps, serialized objects, or credential values.
Proven with a credential-bearing reason (redacted) and a 5,000-char
reason (capped).

## Retry semantics

The helper adds NO state of its own: a failed settlement leaves the
autosaver exactly as `flush()` left it — write pending, status `error` —
so the next transition request (or export, or pagehide flush) re-runs
the SAME save. After storage recovers, the retry settles `{ ok: true }`
having actually persisted the survivor's work, and only then does the
coordinator proceed to install the replacement.

## Page composition

```ts
beforeInstall: () => settleAutosaveForTransition(autosaverRef.current),
```

One expression; no inline try/catch to drift out of sync with the
autosaver's signal shape again. Source-gated: the import, the exact hook
expression, the absence of any bare `autosaverRef.current?.flush()` in
the coordinator construction, and the untouched export-handler boolean
check are all pinned by `b12-6-autosave-settlement.test.ts`.
