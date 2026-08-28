# B16.0.12 §H — Export byte parity

## `/api/export/kicad` (.kicad_sch)

- Valid state → response bytes **identical** to the REAL serializer
  (`exportToKicadSch`) over the same inputs — full byte equality, pinned pre
  and post.
- Filename sanitization exact: `title: "My Board!"` →
  `attachment; filename="My_Board.kicad_sch"`; `Content-Type:
  application/octet-stream`.
- Fail-closed contracts preserved: `Missing 'state'` 400; empty schematic 400;
  canonical-integrity violation → structured 422 `SCHEMATIC_STATE_INVALID` with
  bounded `issues[]`; 415/malformed/oversized (8 MB + 1) refuse before any work.
- The standing `route-fail-closed` suite passes unchanged.

## `/api/pcb/export/kicad-pcb` (.kicad_pcb)

- Valid board → bytes **identical to the REAL `writeKicadPcb` output modulo the
  writer's per-element random UUIDs** — the writer historically mints a fresh
  `(uuid "…")` per graphic element on every call (verified by diffing two
  direct writer invocations), so parity is pinned with those tokens normalized;
  every other byte (ordering, formatting, layers, geometry) is exact.
- Filename sanitization exact: `boardName: "My Board!"` → `My-Board.kicad_pcb`;
  octet-stream; the `X-Sirkit-Export-Unsupported` diagnostics header path is
  unchanged code.
- Invalid board / netlist / options exact 400s; 415 first.

No export algorithm was changed — both routes' serializer calls are
byte-identical to the pre-migration code; only the boundary prologue moved into
`publicJsonRoute`.
