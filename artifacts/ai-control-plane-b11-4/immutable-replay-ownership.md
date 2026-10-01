# B11.4 §B — parse once, execute the snapshot

> **EXTENDED BY B11.6.** The parse-once chain described here now runs through
> the capture OWNERSHIP REGISTRY: every captured container is registered in a
> module-private WeakSet, and the captured-only entries take a zero-copy fast
> path only for registry-owned snapshots. See
> [../ai-control-plane-b11-6/parse-once-proof.md](../ai-control-plane-b11-6/parse-once-proof.md).

> **EXTENDED BY B11.5.** The parse-once ownership model is unchanged and green.
> One consequence stated here was false in practice: an accepted field COULD be
> silently discarded, because the capture used ordinary assignment for
> untrusted keys (B11.5 R1). The projection invariant now holds for that key
> class too. See
> [../ai-control-plane-b11-5/exact-capture-contract.md](../ai-control-plane-b11-5/exact-capture-contract.md).

Modules: [`replay-capsule.ts`](../../app/lib/agent/replay-capsule.ts),
[`replay-context.ts`](../../app/lib/agent/replay-context.ts)

## The contract

```ts
export type ReplayCapsuleParseResult =
  | { ok: true; value: DeepReadonly<ReplayCapsule> }
  | { ok: false; issues: string[] };

export function parseReplayCapsule(untrusted: unknown): ReplayCapsuleParseResult
export function validateReplayCapsule(raw: unknown): string[]   // compatibility wrapper
```

`validateReplayCapsule` remains, and remains exactly what it was to callers —
an issue list. It is now a two-line wrapper over `parseReplayCapsule`, so there
is a single validation path and no way for the two to disagree.

## What replayCapsule does now

```diff
- const capsuleIssues = validateReplayCapsule(capsule);
- if (capsuleIssues.length > 0) throw new ReplayCapsuleInvalidError(capsuleIssues);
+ const parsed = parseReplayCapsule(untrustedCapsule);
+ if (!parsed.ok) throw new ReplayCapsuleInvalidError(parsed.issues);
+ const capsule = parsed.value as unknown as ReplayCapsule;
```

The parameter is named `untrustedCapsule` and is referenced **exactly once**,
on the line that captures it. Everything after that — schema and digest pins,
context assembly, resource construction, discovery, the scripted adapter's
steps, the expected comparisons, trace identity, and the run itself — reads the
local `capsule`, which is the frozen snapshot.

Verified mechanically:

```
$ grep -n "untrustedCapsule" app/lib/agent/replay-capsule.ts
448:export async function replayCapsule(untrustedCapsule: ReplayCapsule, options?: ReplayOptions): Promise<ReplayOutcome> {
464:  const parsed = parseReplayCapsule(untrustedCapsule);
```

## The same rule for the replay context

`validateReplayContext` used to end with `const context = raw as unknown as
ReplayContextFixture` — a **cast of the caller's object**. It now captures
first and returns the capture:

```ts
const captured = capturePlainJson(untrusted, "context", REPLAY_CONTEXT_BOUNDS.maxSerializedChars);
if (!captured.ok) return { ok: false, issues: … };
return validateCapturedReplayContext(captured.value);
```

`ReplayContextResult.context` is now `DeepReadonly<ReplayContextFixture>`, so
the type system also says what the runtime does.
`validateCapturedReplayContext` is the shared validation half, reused by
`parseReplayCapsule` so the capture never runs twice over the same bytes.

## R3, proven closed

`b11-4-capture-ownership` §G4 calls `replayCapsule` **without awaiting**, then
mutates every slot the stage names, then awaits:

| Mutated slot | Injected marker |
| --- | --- |
| `steps[last].text` | `B114-MUTATED-STEP` |
| `context.board.nets` | `B114-INJECTED-NET` |
| `expected.traceDigest` | `eng1-B114-FORGED` |
| `expected.discoveredTools` | `B114-FORGED-TOOL` |
| `scope.projectId` | `B114-FORGED-PROJECT` |
| `userMessage` | `B114-FORGED-MESSAGE` |

None of the six markers appears in `events`, `trace`, `discoveredTools`, or
`failures`; `outcome.ok` is `true`; and the trace digest is exactly the
committed pin `eng1-2bfd85ba305e5b53`. Before the fix the same probe produced
`eng1-0711a8a796c5afb0` with the mutated text visible in the events.

## Deep immutability, proven per container

`b11-4-capture-ownership` §G5/G6 asserts `Object.isFrozen` on the snapshot, on
`steps`, on `steps[0]`, on `context`, on `context.board`, on
`context.board.nets`, on `expected`, and on `scope` — and that mutating the
source after parsing cannot reach the snapshot.

## Versioning decision — NO bump

> [B21 F, 2026-09-28] Superseded for the capsule by B21-F (B11.4's decision stands for B11.4, which changed handling
> only): the capsule is now `sirkit.agent-replay-capsule.v4` - its own field set grew (optional per-task step lists
> of a task graph, each task at its plan's index with one list per role, and a scripted stall only in a task's step
> list); a capsule with no tasks replays exactly as v3 did and a v3 document is refused explicitly; the context stays
> `sirkit.agent-replay-context.v2`. See `artifacts/ai-control-plane-b21/evaluation-matrix.md` section 2.

`sirkit.agent-replay-capsule.v3` and `sirkit.agent-replay-context.v2` are
**unchanged**, deliberately.

**Why the wire contract did not change.** A version identifies the shape of a
*document*. B11.4 changed how the runtime *handles* a document — it captures
it, owns it, and freezes it — not what a conforming document looks like. The
field set, the types, the required/optional split, and every content rule are
identical. Every one of the 19 committed capsules validates unchanged and
replays to its unchanged pin.

**What newly refuses, and why that is not a shape change.** Documents carrying
`toJSON` hooks, accessors, functions, symbols, cycles, sparse arrays, or hostile
proxies are now refused. None of those is expressible in a serialized wire
format: they are JavaScript artifacts of an in-process object, not features of
a JSON document. A conforming capsule — one that could survive a round trip
through JSON, which is the only way a capsule ever travels — is unaffected.

**The counter-argument, recorded.** A stricter reading says any narrowing of
the accepted set is incompatible and deserves a bump. Two things decided
against it: bumping would force every conforming document to be rewritten for
no semantic difference, and the stage's own rule that *a version change alone
must not move trace pins* is best served by not manufacturing a version whose
only content is "the runtime is now safer". The stricter reading is why this
decision is written down rather than assumed.

A regression pins both version strings so the decision cannot drift silently.
