# B09.1 — PCB Working-Copy Authority Validation

Pre-B09.1: `context.ts` accepted any object with `stackup ∈ {2,4}` and
five arrays, then sealed it as `authorityStatus:"verified"`,
`freshness:"current"` — a shallow-looking invalid board became verified
authority for every read tool.

Now (`assembleAgentRunContext`):

1. Shape gate (unchanged) — non-board shapes warn + degrade.
2. **`validatePcbBoardStructure(board)`** — the SAME whole-board
   structural/reference validation the canonical mutation boundary runs
   (global id uniqueness, net/padstack referential integrity, outline/
   polygon/layer/geometry validity, dimension validity, safe-integer
   coordinates). A validator THROW on malformed collections is treated as
   equally invalid (fail closed), never normalized.
3. Invalid ⇒ `board-present` project state is absent, board tools are
   undiscoverable, the sealed canonical-state envelope carries the empty
   substitute board (never the invalid client board), and a safe warning
   (bounded first issue) is emitted. Schematic-only/readless chat
   continues; only a structurally invalid REQUEST (bad identifiers) fails
   the whole call.
4. Valid boards — including legacy/additive shapes the authoritative
   validator permits — verify exactly as before.

Proof (b09-1-boundary §2): duplicate object ids, dangling padstack
reference, negative outline geometry, malformed collection entry (each →
warning, no board-present, empty-board envelope, board tools withheld);
valid board → zero warnings, board-present, board tools discoverable;
invalid board + valid schematic → schematic tools still available.
