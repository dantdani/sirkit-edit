# B15 — the bounded PCB edit operation contract

`app/lib/pcb/proposal/bounded-edit-operations.ts`

## What the provider may send

A single strict object: `{ intent: string, operations: BoundedPcbEditOperation[] }`.
Nothing else. It never contains a board, a candidate board, a raw canonical
command, an arbitrary command id, a mutation receipt, an approval
credential, or an authoritative id for a NEW board object.

## The allowed operations (the 9 mandated intents, 13 forms)

| # | Mandated intent | Operation kind(s) | Canonical B08 expression |
| --- | --- | --- | --- |
| 1 | Move a footprint | `move_footprint` | `move_footprint` |
| 2 | Rotate a footprint | `rotate_footprint` | `move_footprint` (rotation field) |
| 3 | Add a track segment | `add_track` | `add_track` |
| 4 | Update track geometry | `update_track` | `update_track` |
| 5 | Add a via | `add_via` | `add_via` |
| 6 | Update via geometry/padstack | `update_via` | `update_via` |
| 7 | Routing preference / net-class rule | `set_routing_preference`, `set_net_class_rule` | `update_routing_preferences`, `update_net_classing` |
| 8 | Add/update/remove a dimension | `add_dimension`, `update_dimension`, `remove_dimension` | `add|update|remove_dimension` |
| 9 | Add/update a keepout | `add_keepout`, `update_keepout` | `add|update_keepout` |

No operation is "improvised": the candidate board is handed to the existing
`compilePcbBoardDelta`, which is the sole authority on what is canonically
expressible. Anything it cannot express refuses as `not-canonical`.

## Explicitly excluded (named, so refusals are specific)

`EXCLUDED_EDIT_INTENTS` names 33 out-of-scope intents — footprint/track/
via/zone/component deletion, `remove_*`, rip-up, net reassignment, zone
add/update/fill/refill, board outline, stackup, copper and footprint
protection, component replacement, sync/binding/authority, auto-place /
autoroute / board-repair apply, manufacturing release, fabrication export,
and view/session control. Each refuses with code `excluded-operation` and a
message that says bounded PCB proposals never perform it. **A permanent
test iterates the entire list** (B15 §2 test 4).

## Bounds (all enforced before any board is touched)

| bound | value |
| --- | --- |
| operations per proposal | ≤ 16 |
| request bytes | ≤ 32 768 |
| nesting depth | ≤ 8 |
| array length | ≤ 64 |
| string length | ≤ 256 |
| identifier length | ≤ 128, `^[A-Za-z0-9][A-Za-z0-9._:-]*$` |
| coordinates | finite **integers**, \|v\| ≤ 10 000 000 000 nm |
| sizes (width/drill/offset/text/stroke) | integers, 1 000 … 100 000 000 nm |
| net id | integer, 0 … 1 000 000 |
| intent | non-empty, ≤ 240 chars (kept below the string bound so the specific refusal fires) |
| rotation | exactly 0 / 90 / 180 / 270 |
| via | drill strictly less than pad size |

## Hostile-input posture

A pre-clone scan walks the RAW payload once and refuses: functions,
symbols (as values OR keys), bigints, `undefined`, accessor properties
(`get`/`set`), non-plain objects (any prototype other than
`Object.prototype`/`null`), the reserved keys `__proto__` / `constructor` /
`prototype`, and any breach of the depth/array/string bounds. Because the
scan runs BEFORE cloning, a hostile getter never executes twice and never
observes validation. The accepted payload is then rebuilt through a
`JSON.parse(JSON.stringify(...))` round trip and **deep-frozen**, so
validation and compilation observe exactly the same immutable value.

A permanent test asserts `Object.prototype` is not polluted by any of the
hostile fixtures (B15 §2 test 5).

## Deterministic identity for new objects

The provider never names a new board object. Sirkit mints
`b15-<kind>-<16 hex>` from `engineeringDigest({schema, baseIdentity, kind,
index})` where `baseIdentity` is the sealed base board revision — so the
same proposal against the same base always mints the same ids, and the
apply-time recompile reproduces them byte-for-byte.
