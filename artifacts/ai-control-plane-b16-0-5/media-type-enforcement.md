# B16.0.5 §C — Media-type enforcement (415 before the first body pull)

Every JSON-consuming `POST`/`PUT`/`PATCH` route now refuses an unsupported or
absent `Content-Type` with **exactly `415 AUTH_MEDIA_TYPE_UNSUPPORTED`**, before
any body is pulled, `no-store`, with zero provider/durable/process work.

## Where it is enforced (single chokepoints)

| Path | Enforcement |
|---|---|
| 49 routes reading `readBoundedJsonObject` / `readBoundedJsonBody` | The bounded reader itself: `requireJsonContentType` (default **true**) → `unsupported-media-type` (415) checked FIRST, before abort/length/read. `isJsonContentType` accepts `application/json` with or without parameters (`; charset=utf-8`). |
| `_scope` families via `scopedTrustedJson` (and `scopedPcbSyncJson`) | Already enforced a 415 media-type check before the reader (pre-existing); unchanged. |
| Audited wrappers (`authenticatedJsonRoute` etc.) | `mediaTypeOk` → 415 before the reader (pre-existing); unchanged. |
| Streaming JSON routes `POST /api/chat`, `POST /api/replacement-authority` | Explicit `isJsonContentType` guard → 415 added before `readBoundedStream` (chat: before the pre-auth bounded read; replacement-authority: after authorization, before the read). |

Accepted: `application/json`, `application/json; charset=utf-8`.
Refused (415): `text/plain`, a missing `Content-Type`, `application/x-www-form-urlencoded`, and any other media.

## Classification of non-JSON endpoints

The reader's `requireJsonContentType` defaults to **true**, so a JSON route
cannot silently accept a non-JSON body. An intentionally non-JSON body reader
must opt out **explicitly** (`requireJsonContentType: false`) — a unit test pins
that the opt-out reaches the parse path. No production route opts out today
(every migrated body route is JSON); GET/HEAD routes never read a body and are
unaffected.

## Proof

- Unit: [`b16-0-2-bounded-json.test.ts`](../../app/lib/http/__tests__/b16-0-2-bounded-json.test.ts) — text/plain and missing → 415 before any read; charset accepted; explicit opt-out reaches invalid-json.
- Behavioral (real handlers, every family): [`b16-0-5-media-type-and-wrapper.test.ts`](../../app/api/__tests__/b16-0-5-media-type-and-wrapper.test.ts) — text/plain → 415 `no-store` with **0** counted body pulls; missing Content-Type → 415 with 0 pulls; `application/json; charset=utf-8` accepted past the media gate.
- Regression fallout (7 tests in 5 files that POSTed JSON without a Content-Type) was fixed by sending the correct `application/json` header — never by weakening an assertion. See [changed-files.md](changed-files.md).
