# B12.5 §B — collision-free storage identity

## The defect (R4)

The B12.4 localStorage key
`sirkit.approved-mutation-journal.v1:${tenant}:${project}:${branch}`
joined the scope tuple with `:` — a character the journal's own
`SCOPE_ID` vocabulary permits inside ids. Distinct valid scopes
`{local, "a:b", "c"}` and `{local, "a", "b:c"}` both resolved to
`sirkit.approved-mutation-journal.v1:local:a:b:c`: the second scope read
— and could overwrite — the first scope's journal.

## The encoding

The production store keys records by the IndexedDB **array key**
`[tenantId, projectId, branchId]`. Array keys compare element-wise per
the IndexedDB specification, so the encoding is injective for every
legal tuple — there is no delimiter to be ambiguous about. (This is the
"another injective encoding" option: a native tuple key rather than
length-prefixing or digesting, chosen because it is the storage engine's
own first-class notion and adds zero derived material that could drift.)

## Bounds before key derivation

`assertJournalScope` runs BEFORE any key is built or any database is
opened: each id must match the closed `SCOPE_ID` vocabulary
(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` — exported as
`isValidJournalScopeId`). Unicode, empty, oversized (≥129), and
illegal-first-character ids throw `JOURNAL_SCOPE_INVALID`; the journal
converts that into a fail-closed disposition. A counting-factory test
proves storage is never touched for an illegal scope. Unicode is
therefore refused at bounds validation — "adversarial Unicode keys" are
excluded by the vocabulary itself, and the injectivity sweep covers
every character class the vocabulary does allow (colons, periods,
hyphens, underscores, multi-delimiter splits) at every tuple position.

## Migration never lets the old key select authority

The legacy (colliding) key is retained ONLY to locate candidate records:
`legacyLocalStorageJournalKey`. Ownership is decided exclusively by the
validated CONTENT scope of the entries
(`classifyLegacyJournalDocument`, built on the strict B12.4 entry
validator — each entry validated against its OWN embedded scope first):

| Classification | Meaning | Action |
| --- | --- | --- |
| `owned` | strictly valid; every entry belongs to the requesting scope | imported once (put-if-absent transaction); legacy removed only after durable confirmation |
| `foreign` | strictly valid; entries belong to a different scope (a collision victim's journal) | treated as ABSENT — never read as ours, never imported, never overwritten, never deleted |
| `absent` | valid but empty — no owner determinable | nothing to import; left untouched |
| `corrupt` | malformed, checksum-broken, duplicate-identity, or MIXED-scope (ambiguous authority) | fail closed: surfaced as the raw STRING → strict load classifies the DOCUMENT corrupt → `corrupt`/`recovery-required` for EVERY identity and every claimant (never a partial reinterpretation of a claimant's own entries, never a `conflict` mislabel); never imported, never deleted, deterministic across loads |

The R4 pair is proven end-to-end: with the owner's journal under the
shared legacy key, the collision victim's load returns `null` and leaves
the record untouched, and the true owner still migrates it afterward.
Concurrent migration from two contexts imports exactly one record
(put-if-absent inside a serialized transaction). A failed transactional
import (injected put failure) leaves the legacy record in place — it is
never deleted before the new record is durably confirmed — and the next
attempt migrates normally. Rollback story: until the atomic record
exists, the legacy record IS the state; after durable confirmation the
atomic record is authoritative and legacy removal is a non-fatal
cleanup (a failed removal is harmless because migration is
put-if-absent and can never re-import over newer atomic state).
