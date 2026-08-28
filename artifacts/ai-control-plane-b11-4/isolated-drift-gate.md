# B11.4 §F — fully non-mutating drift proofs

## What was wrong

B11.4 R7 confirmed the B11.3 suite wrote two repository paths:

```json
{
  "writes the checked-in descriptor (writeFileSync(DESCRIPTOR_FILE, …))": true,
  "creates app/lib/pcb/__b113probe__.types.ts": true,
  "writeFileSync call sites in the suite": 4
}
```

An interrupted run leaves the tree modified. During B11.3 the earlier
in-place variant of the same test did corrupt `app/lib/pcb/types.ts`.

## The refactor

Generation logic moved out of the CLI into an importable, filesystem-pure
builder: [`scripts/pcb-shape-descriptor-build.ts`](../../scripts/pcb-shape-descriptor-build.ts).

```ts
buildPcbShapeDescriptor(options?: { root?; entry?; overlay?: Record<string, string> }): BuildResult
comparePcbShapeDescriptor(checkedIn: string | null, options?): CompareResult
```

* `overlay` is an **in-memory source overlay**: repo-relative path → text.
  Overlaid files are never read from disk and never written.
* It is installed through a virtual `ts.CompilerHost` that patches
  `getSourceFile`, `readFile`, and `fileExists` — and disables `writeFile`
  outright, so an overlaid build cannot emit anything anywhere.
* `comparePcbShapeDescriptor` takes the checked-in **text**, not a path, so it
  is read-only by construction: the caller supplies the bytes and the function
  has nothing to write to.

[`scripts/generate-pcb-shape-descriptor.ts`](../../scripts/generate-pcb-shape-descriptor.ts)
is now a thin CLI shell that reads the checked-in file, delegates, and writes
only in write mode. Tests import the builder directly and never execute the
script.

## What the tests now prove

| Requirement | Proof |
| --- | --- |
| fresh production generation matches the checked-in descriptor | `comparePcbShapeDescriptor(readFileSync(DESCRIPTOR_FILE), { root })` is `ok`, with the expected summary |
| a candidate descriptor copy with one changed byte fails comparison | the candidate is a **string** (`"root":` → `"root" :`); result is `{ ok: false, reason: "drift" }`. A `null` candidate yields `reason: "missing"` |
| adding / removing / changing a reachable PCB type changes generation | five in-memory overlays (add nested property, change optionality, change property type, change union membership, remove property); each asserted to have actually applied, each producing a descriptor different from the baseline |
| …and therefore fails `--check` | one overlay is additionally run through `comparePcbShapeDescriptor` against the checked-in text, yielding `reason: "drift"` |
| production source and descriptor hashes remain unchanged | both files are SHA-256 hashed at **module load**, before any test body runs, and re-hashed at the end |
| interruption cannot leave a probe file in the repository | no probe file is ever created; the test asserts `__b113probe__.types.ts` / `__b114probe__.types.ts` do not exist |

## No test writes any repository path

The B11.3 suite now imports only `{ existsSync, readFileSync }` from `node:fs`
— asserted by comparing the import line itself — and `node:child_process` is
gone entirely.

A repository-wide scan lives in `b11-4-capture-ownership` §F: it walks every
test file under `app/lib/agent/__tests__` and `app/api/chat/__tests__` and
asserts none contains a call to `writeFileSync`, `rmSync`, `mkdirSync`,
`appendFileSync`, `unlinkSync`, or `cpSync`. (The scanner file itself is
excluded, because it necessarily names those primitives.)

## Hashes, before and after the entire battery

```
BEFORE app/lib/pcb/types.ts                              15088  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
BEFORE app/lib/agent/generated/pcb-shape-descriptor.ts  213528  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d

AFTER  app/lib/pcb/types.ts                              15088  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
AFTER  app/lib/agent/generated/pcb-shape-descriptor.ts  213528  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
```

Identical. The refactor is also byte-neutral: the CLI still emits exactly the
checked-in descriptor, and `--check` reports the same graph and source digests
as before the stage.
