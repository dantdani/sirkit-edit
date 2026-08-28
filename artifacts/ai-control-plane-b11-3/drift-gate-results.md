# B11.3 §E — CI drift gates

> **SUPERSEDED BY B11.4 §F.** The proof described below created
> `app/lib/pcb/__b113probe__.types.ts` and rewrote the checked-in descriptor —
> both repository paths, so an interrupted run left the tree modified (B11.4
> R7). Generation logic now lives in an importable, filesystem-pure builder
> with an IN-MEMORY source overlay, and no test writes any path under `app/`,
> `lib/`, `scripts/`, or `artifacts/`. See
> [../ai-control-plane-b11-4/isolated-drift-gate.md](../ai-control-plane-b11-4/isolated-drift-gate.md).
> The historical record below is retained unchanged as evidence.

## The gate

```bash
npx tsx scripts/generate-pcb-shape-descriptor.ts --check
```

`--check` re-runs the **entire** type-graph generation in memory and compares
the result **byte-for-byte** with the checked-in
`app/lib/agent/generated/pcb-shape-descriptor.ts`. It writes nothing, ever.
Artifact generation happens only when the script is run **without** `--check`.

Clean output:

```
OK — descriptor matches a fresh type-graph generation (81 named types from 8 source files; graph sha256-34cb69e527ca461d09cb8fdcc95854a0; sources sha256-cf412478820e4a9930a88b8c95e9cdbf).
```

Drift output (exit code 1):

```
DRIFT — the checked-in PCB shape descriptor does not match a fresh generation.
  fresh: <n> named types from <m> source files; graph <digest>; sources <digest>
  Run: npx tsx scripts/generate-pcb-shape-descriptor.ts
```

A missing descriptor file also exits 1. An **unsupported shape** exits 2 with
the offending path, and writes nothing.

## Proven, without touching a production source file

`b11-3-generated-pcb-shape` §E "changing ANY reachable PCB type moves the
descriptor, without touching production sources" copies
`app/lib/pcb/types.ts` to a disposable sibling
(`app/lib/pcb/__b113probe__.types.ts` — beside the original so its relative
imports resolve), generates a **baseline** descriptor from the unmodified copy
with `--entry=… --emit-to=…`, then applies each mutation to the copy and
asserts the emitted descriptor **moved**. Every mutation is asserted to have
actually applied first — a silently no-op `replace` would otherwise make this
gate pass while proving nothing.

| # | Mutation | Requirement | Result |
| --- | --- | --- | --- |
| 1 | add `b113DriftProbe?: string` to `PcbNet` | *adding a nested PCB property cannot silently widen replay fixtures* | descriptor differs from baseline |
| 2 | `stableId?: string` → `stableId: string` | *changing optionality trips the gate* | differs |
| 3 | `formatVersion: 1` → `formatVersion: 2` | *changing a property type trips the gate* | differs |
| 4 | add a `{ kind: "b113probe" }` member to `BoardOutline` | *changing union membership trips the gate* | differs |
| 5 | remove `texts: BoardText[]` | *removing a property trips the gate* | differs |

The other half of the gate — that a moved descriptor **fails CI** — is proven
separately by §E "--check is the byte-for-byte half of that gate: a
one-character edit fails it", which perturbs the checked-in descriptor by a
single space, asserts `--check` exits non-zero with `DRIFT`, and restores it.

Together: *any reachable PCB type change moves the descriptor* ∧ *any
descriptor difference fails `--check`* ⇒ **CI fails until regeneration**.

After the loop the test asserts the production declaration is **byte-identical**
(`readFileSync(production).equals(productionBytes)`), the descriptor file is
unchanged, and `--check` is green.

### Why the design changed mid-stage

The first version of this test mutated `app/lib/pcb/types.ts` **in place** and
restored it in `finally`. Adversarial review demonstrated — and this session
reproduced — that an interrupted run leaves the authoritative PCB declaration
corrupted, and that the test's own "restored byte-for-byte" assertion becomes
**vacuous** once it is: the next run reads the damaged file as its own baseline
and faithfully restores the damage. During this stage the file was in fact left
corrupted (`PcbBoard.texts` deleted, `formatVersion: 1` duplicated, CRLF
normalized) by concurrent runs of that test. It was detected by the
descriptor's **source digest**, repaired, and re-verified against the original
`sha256-cf412478820e4a9930a88b8c95e9cdbf`. The redesign removes the failure
mode entirely: production sources are never opened for writing.

### Residual

If the process is killed mid-test the disposable copy
`app/lib/pcb/__b113probe__.types.ts` may survive. It is an obviously-named,
unimported file that no production code reads and that the next run overwrites;
no authoritative declaration can be damaged.

## No second hand-written PCB key table

§A "no second hand-written PCB key table is used by replay validation" asserts,
against the real file bytes:

* after stripping comments, no statement in `app/lib/agent/replay-context.ts`
  or `app/lib/agent/pcb-shape-projection.ts` mentions **three or more** of the
  21 declared `PcbBoard` field names, in any spelling a table could use —
  double-quoted, single-quoted, backticked, or as a bare object-literal key.
  (A density threshold rather than a name blacklist, because `nets` is also a
  field of the agent netlist contract and prose may mention `outline`. The
  earlier version checked 10 of 21 names in one spelling and was shown by
  adversarial review to be trivially evadable.) A companion **mutation test**
  proves the gate catches every evasion the review proposed and does not fire
  on a comment-only mention;
* `PCB_BOARD_REQUIRED_KEYS` and `PCB_BOARD_OPTIONAL_KEYS` no longer appear
  anywhere in `replay-context.ts`;
* the projector's only PCB authority is
  `from "./generated/pcb-shape-descriptor"`.

The B11.2 drift-gate test's **board** half is retired for the same reason; its
**schematic** half remains (schematic key lists are still hand-written and
still gated against `lib/schematic-types.ts`).

## Byte stability

```
DESCRIPTOR BYTE-STABLE across 3 generations
```

Three consecutive generations produced identical bytes; a fourth, run after
all B11.3 edits, still matched (`--check` green with the same digests). The generator's output
is canonicalized (recursively key-sorted, `undefined` dropped) and contains no
timestamps, no absolute paths, and no environment-dependent values; paths are
repo-relative with forward slashes, and the source digest normalizes CRLF, so
the descriptor is stable across platforms and checkouts.

## Suggested CI wiring

```bash
npx tsx scripts/generate-pcb-shape-descriptor.ts --check
```

Run it alongside `tsc --noEmit`. It is read-only and takes a few seconds.
