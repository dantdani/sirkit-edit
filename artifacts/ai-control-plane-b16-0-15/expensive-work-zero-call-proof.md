# B16.0.15 §D/§E/§G — Expensive-work zero-call proof (CONFIRMED)

Seven durable/expensive seams are spied and asserted zero across EVERY refusal
class, for BOTH routes:

```
stage3Repository.getBoard        (durable board read)
stage3Repository.publishBoard    (durable board write)
createAutonomousRouteExecutor    (router / process resolution)
qualifyAutonomousLayout          (routing process)
DurableManufacturingAuthorityStore.save   (release-authority write)
DurableManufacturingAuthorityStore.get    (release-authority read)
releaseManufacturingPackage      (release generation)
```

## Zero-work proven for

| Refusal | getBoard | router | qualifyLayout | authority.save | authority.get | release |
|---|---|---|---|---|---|---|
| unauthenticated (401) | 0 | 0 | 0 | 0 | 0 | 0 |
| wrong-project membership (403) | 0 | 0 | 0 | 0 | 0 | 0 |
| revoked membership (403) | 0 | 0 | 0 | 0 | 0 | 0 |
| cross-origin CSRF (403, 0 body pulls) | 0 | 0 | 0 | 0 | 0 | 0 |
| media 415 / invalid-json 400 / oversized 413 | 0 | 0 | 0 | 0 | 0 | 0 |
| pre-aborted body (400) | 0 | 0 | 0 | 0 | 0 | 0 |
| missing designId/boardId (400) | 0 | 0 | 0 | 0 | 0 | 0 |
| forbidden snapshot/board/path (400) | 0 | 0 | 0 | 0 | 0 | 0 |

## Ordering guarantee (§G)

Because the wrapper runs identity → membership → role → CSRF → media → bounded
body parse → the in-callback forbidden-key + scope validation ALL before the
first durable call, every category of expensive/durable work is unreachable on
any boundary refusal. Additionally proven:

- **ineligible design → zero router/process** (pin): a loaded-but-ineligible
  design returns 422 with `createRouter`/`qualifyLayout` never called and no
  authority saved;
- **failure paths persist no authority** (pin): the ineligible path calls
  `authoritySave` zero times.
