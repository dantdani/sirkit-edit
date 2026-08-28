# B16.0.12 §A — Pre-edit public route contracts (pinned BEFORE migration)

[`app/api/__tests__/b16-0-12-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-12-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and run GREEN first
(**24 / 24**, recorded), then kept green post-migration. All external work is
faked: `getDb` is a queue-driven chainable drizzle fake with a select counter;
`embedQuery` is a counted fake; `parts-search` is faked; the placement engine
is a counted pass-through spy over the REAL deterministic engine.

## Pinned per surface

| Surface | Pins |
|---|---|
| `/api/ai/runtime` | 200 + no-store; only `{providers, embeddings}` shape; adversarial sentinel secrets absent from the serialized response |
| `/api/components/atomic` | limit clamp (1..100, default 50), `after` cursor, published-only filter, `nextCursor` via limit+1, deterministic `catalogSnapshotId` over the published-id set, exactly 2 selects, absurd limit stays 2 selects |
| `/api/components/atomic/search` | 415 / malformed / 200 KB + 1 → 413, all with ZERO selects |
| `/api/export/kicad` | 415/malformed/8 MB + 1 first; `Missing 'state'` + empty-schematic exact 400s; valid → bytes identical to the REAL `exportToKicadSch`; sanitized filename `My_Board.kicad_sch`; octet-stream; off-grid → structured 422 `SCHEMATIC_STATE_INVALID` |
| `/api/kicad/v1/parts/category/[id]` | 503 unconfigured token / 401 missing/wrong token — all with ZERO DB selects (before parameter processing); `.json` suffix stripped; `published` mapped rows; unknown category → `[]` |
| `/api/parts/[id]` | malformed id → `{ok:true, part:null}` with ZERO selects (historical in-bound behavior); missing part → `part:null` |
| `/api/parts/[id]/alternates` | invalid id → 400 `Invalid part id` with ZERO selects |
| `/api/pcb/export/kicad-pcb` | valid empty board → bytes identical to the REAL `writeKicadPcb` modulo per-element random UUIDs; filename `My-Board.kicad_pcb`; invalid board/options exact 400s; 415 first |
| `/api/pcb/footprints/[id]` | malformed id → 404 with ZERO selects |
| `/api/pcb/footprints/resolve` | missing/malformed `hint` → 400 with ZERO selects + ZERO embeddings; valid hint → ONE indexed select, miss → `{ok:true, hit:null}` |
| `/api/pcb/footprints/search` | missing q / >500 chars / bad padCount / bad smd → 400 with ZERO embeddings + ZERO selects; EXACT `Lib:Name` hit → score 1, ZERO embeddings; free text → EXACTLY ONE embed call then the two pools |
| `/api/pcb/placement/preview` | engine EXACTLY once; deterministic modulo the volatile `runId`/`elapsedMs`; input board NOT mutated; ZERO durable selects; media/body/board refusals precede computation |
