# B13.2 — artifact and replay stability (§F)

Everything §F requires to stay stable did.

| gate | value | status |
| --- | --- | --- |
| B11 replay pins (`artifacts/ai-control-plane-b11/replay-trace-pins.json`) | sha256 `03e043f4b5402bb4…` | UNCHANGED from B13.1; generator run twice, byte-identical |
| B05.1 composite replay fixtures | sha256 `f18e47e0f14b2d1d…` | UNCHANGED; generator run twice, byte-identical |
| `app/lib/pcb/types.ts` | sha256 `72ad7c7758b44414…` | UNCHANGED |
| `app/lib/agent/generated/pcb-shape-descriptor.ts` | sha256 `5501d810e583395d…` | UNCHANGED; `--check` reports a match against a fresh generation (81 named types, 8 source files) |
| registry exposure count | ten agent-exposed tools | UNCHANGED (no registry, catalog, or binding edit) |
| provider-neutral tool schemas | unchanged | UNCHANGED (B13.1 §G parity test still passes byte-identically) |
| B12 mutation/approval invariants | unchanged | full B12 family green inside the broad battery |
| `git diff --check` | exit 0 | clean (only pre-existing CRLF advisories) |

## No artifact was regenerated for content

B13.2 changes the loader's scope contract, the classifier's consistency
rule, the settlement machine, and the production read adapter. None of these
participates in a generated artifact's content:

- the tool registry, its digests, and the discovery surface are untouched, so
  the B11 replay pins do not move (B13 moved them once, for the tenth tool;
  B13.1 and B13.2 both leave them at `03e043f4…`);
- the B05 replay fixtures describe read-tool invocations over supplied
  records, not the loader's scope handling, so they are unchanged;
- no PCB type or descriptor input changed.

No generated artifact was hand-edited.

## Protected original

`C:\Users\robsa\sirkit` untouched — `git status --porcelain` still lists
exactly the same 6 pre-existing entries (the user's own Jul 16 auth files and
Aug 3 `ai_recon.patch`) that predate every builder stage. Nothing in the
protected tree was modified, formatted, staged, or generated.
