# B19-C — the quarantine-to-authority pipeline

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED**, **RECORDED**, **UNKNOWN**.

The runbook's five stages, and where each lives:

| stage | what it holds | where | state |
|---|---|---|---|
| 1. external observation | what a source said: availability, price, lifecycle claim, links — pinned to the source, the registry revision, the SHA-256 of the exact response bytes, and the normalizer | `app/lib/acquisition/quarantine.ts` (`observationFromPricing`) | **I4 CONFIRMED** |
| 2. normalized candidate | the observation's (or a document's) facts, each classified by what its source and method may establish | `candidateFromObservation`, `candidateFromExtraction` | **I4 CONFIRMED** |
| 3. verified evidence bundle | facts for one part across sources, conflicts, stale observations, parser versions, and the engineering evidence still missing | `buildEvidenceBundle` | **I4 CONFIRMED** |
| 4. reviewed atomic revision | exact identity, symbol, footprint, package geometry and pin-to-pad mapping approved under human review policy | `app/lib/atomic` (catalog transitions, `evaluateApproval`, mapping certificates) | existed before B19; its evidence rules are I4b |
| 5. published project binding | revision-bound use in a design | `app/lib/atomic` project pins, component selection, physical bindings | existed before B19 |

## I4 — the front half (CONFIRMED)

### What was missing, measured

- Discovery recorded that the front half had types (`app/lib/atomic/ingestion.ts`) but no implementation: nothing
  connected a distributor answer to the pipeline.
- A live distributor lookup carried **no evidence reference**. Measured on the connectors as I3b left them: a DigiKey
  lookup returned only the mapped fields (`distributor, mpn, manufacturer, description, datasheet, inStock,
  minOrderQty, priceBreaks, bestUnitPrice, productUrl, package, lifecycleStatus, lifecycleRaw, fetchedAt`) — nothing
  tied it to the bytes DigiKey sent. (The runbook's B19-B asks for an immutable raw-content hash where retention permits.)

### What was built

| rule | where |
|---|---|
| Every live distributor answer is pinned to the SHA-256 of the exact response bytes and the time they arrived; the bytes themselves are never kept (every registered distributor restricts storage) | `distributorJson` returns `contentHash` and `retrievedAt`; DigiKey, Mouser and Nexar attach `evidence` to each result (a Nexar batch pins every part to that batch's bytes) |
| An observation is deterministic (a content id over its canonical form), frozen, names its source, source class, authority class, registry version and normalizer version, expires by the registry's freshness, and records `rawRetained: false` | `observationFromPricing` |
| An observation from a source the registry does not enable is refused (LCSC blocked, Mouser disabled) | same |
| Every fact is classified: **sourcing** (stock, price breaks, packaging, lifecycle, links, SKU), **identity_hint** (an MPN or manufacturer as a distributor spelled it), **engineering_candidate** (symbol, footprint, package, pin mapping, terminal function or rating from a manufacturer, official-library, organization or human-reviewed source by a deterministic parser), or **quarantined** (any model or OCR extraction; any engineering fact from a distributor catalog, downloaded third-party CAD or geometry inference; any unrecognized property) with a reason | `candidateFromObservation`, `candidateFromExtraction` |
| A distributor observation can never produce an engineering fact; DigiKey's `Packaging` (cut tape, reel) is a sourcing fact, never a package claim | `candidateFromObservation` |
| A bundle holds one part (candidates for different parts are refused), names conflicts among reviewable facts (manufacturer, lifecycle, package, pin mapping, footprint, symbol — prices and stock legitimately differ), flags expired observations, lists parser versions, and says what engineering evidence is missing | `buildEvidenceBundle` |
| A bundle proves nothing: `engineering.proven` is always `false` and names the reviewed atomic revision as the only thing that can; the module exports no way to approve, publish, create a revision or bind a design | same; tripwire test |

### Proven (`app/lib/acquisition/__tests__/b19-quarantine-pipeline.test.ts`, 20 cases)

- Observations: same answer → same observation, one changed value → a different id; source, registry version, raw hash,
  normalizer, expiry, no raw content; a blocked or disabled source is refused.
- Candidates: a distributor yields only sourcing facts and identity hints; packaging is sourcing; six classification
  cases (LLM and OCR from a datasheet, pin mapping from a distributor, a footprint from third-party CAD → quarantined;
  manufacturer CAD and the official KiCad library via a deterministic parser → engineering candidates).
- Bundles: DigiKey "active" against Nexar "nrnd" is a lifecycle conflict while price and stock are not; the bundle never
  proves anything and lists the four missing kinds of evidence; an AI-extracted pin mapping stays quarantined and does
  not satisfy "pin-to-pad mapping"; manufacturer CAD fills the gaps only as candidates; an expired observation is stale;
  different parts are refused; input order does not change the bundle.
- The tripwire: no approve / publish / revision / bind / authorize export.
- The connectors: DigiKey and Nexar results carry the SHA-256 of the body the fake vendor sent, and an observation built
  from them keeps it.

### Not in I4

- **A distributor `SourceAdapter`** (the paging interface in `app/lib/atomic/ingestion.ts`). Discovery planned one; it was
  not built, because paging a vendor's catalog is bulk acquisition, which every registered source's terms prohibit or leave
  unclear, so the registry refuses it (`source-registry.md`). Observations are made per interactive lookup.
- **Stage 4's evidence rules (I4b).** `evaluateApproval` — used at publication, in catalog search and by component
  selection's CAD gate — checks that trusted claims have evidence, but not what KIND of source that evidence came from,
  and not whether it was extracted by a model. The downstream mapping verifier already refuses distributor and
  vendor-library evidence and requires reviewed evidence. I4b reproduces the approval gap and closes it.
- Unicode-confusable MPNs, unit ambiguity, malicious documents and archives: B19-D (I5).
- Showing candidates, conflicts and missing evidence to a person, and agent tools that read bundles: B19-E (I6).
