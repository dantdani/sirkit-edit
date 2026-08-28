# B13 — component-authority record contract

Module: [component-authority.ts](../../app/lib/engineering/component-authority.ts)

## The record (B13 additions)

`ComponentAuthorityRecord` gains one optional, server-owned field:

```ts
exactAuthority?: ComponentExactAuthority;

interface ComponentExactAuthority {
  atomicPartRevisionId: string;
  mpn: string;
  manufacturer: string;
  symbolAssetVersionId: string;
  footprintAssetVersionId: string;
  mappingCertificateId: string;
  selectionRecordId?: string;   // present when a durable selection record backs it
}
```

- **Server-owned only.** `exactAuthority` is populated exclusively by the
  loader ([component-authority-source.ts](../../app/lib/engineering/component-authority-source.ts)) from durable facts — never from browser input, catalog candidates, or model output. It travels inside the sealed `component-authority-records` envelope content, so it is covered by the envelope content digest and the bundle manifest digest.
- **Digested.** The per-record digest (`sirkit.component-authority-record.v1`) already covers the whole record, so `exactAuthority` participates automatically.

## Deliberately unchanged: the inspection classifier and summary

`inspectComponentAuthority` and `ComponentAuthoritySummary` are byte-for-
byte unchanged. `classify()` still derives `verified-exact` from facet
states (conflict none, not stale, selected exact part, footprint
available, mapping verified, approval approved); duplicate records still
report `conflicted` and are NEVER merged; foreign-project records are
still rejected. This keeps every B05/B05.1 inspection pin stable — the
exact-authority block is a REPLACEMENT-GRANT concern, consulted by
`consumeReplacementAuthority`, not a change to the read summary the agent
sees.

Rationale: surfacing `exactAuthority` in the summary would move the
B04/B05 read-replay artifact pins for no security benefit — the grant
path is the only consumer that needs the exact asset identity. The
records themselves (with `exactAuthority`) are still what the sealed
resource carries and what the manifest digest pins.
