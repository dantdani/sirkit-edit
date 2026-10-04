# B23-B1 - revalidate, disclose, approve: what would leave Sirkit

Labels: **CONFIRMED** (executed and measured here, or read at the cited file:line), **INFERRED** (a conclusion from reading code; nothing
executed it), **PROPOSED**, **RECORDED** (written down without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Tree: `chapter/b23-external-manufacturing`, base `da36d51` (B23-A2). Runbook B23-B steps 1-3 (`:975-977`): "Revalidate authority
immediately before upload.", "Present exactly which files and metadata will leave Sirkit.", "Require explicit user approval for the
named provider and purpose." Closes D23-6 and D23-7. Owner decisions applied: OD-163, OD-164, OD-166 and OD-174 (the route half); B1's
own choices beyond its task text are OD-183 (section 10). No provider is admitted (A1), so nothing is sent: every commit ends refused
`provider_not_admitted`, and no fetch happens. The send is B23-B2's; a live exchange stays BLOCKED-LIVE-QUALIFICATION (LB-11).

## 0. What B23-B1 is

- **Step 1, revalidate (D23-7).** The release route's route-only checks are one exported server function,
  `revalidateReleaseAuthority` (`app/api/pcb/release/route.ts:145`), moved verbatim from the handler, which now calls it (`:91`). The
  release route refuses every case it refused before with the same codes, statuses and bodies; its own suites ran unchanged and green
  (section 9), and the pinned 555 release identity did not move. The provider exchange runs the same function at preview and again at
  commit. CONFIRMED
- **Step 2, the exact disclosure (D23-6, OD-163).** A pure `buildOutboundPackage` (`app/lib/manufacturing-providers/outbound-package.ts:115`)
  derives the package only from a ledgered release, carries the Gerber, Excellon and job files byte for byte, and adds a generated
  provider manifest; it has its own `outboundPackageDigest`. [B23-B1 review, 2026-10-04] It also says what else leaves: the identities
  whose value is in a file name or byte (`carried`), and every metadata field the bytes carry (`embedded`); only an identity found
  nowhere is withheld. Section 1 is the exact disclosure for the pinned 555 release. CONFIRMED
- **Step 3, approval of a named provider and purpose (D23-7, OD-164, OD-166).** `ProviderExchangeService`
  (`app/lib/manufacturing-providers/provider-exchange.ts:216`): `preview` answers a sealed plan valid for 10 minutes; `commit` takes
  the plan's id and digest, an idempotency key and the opt-in header, consumes the plan once, re-runs steps 1 and 2, and asks
  admission, which refuses. Only a human project administrator acts. [B23-B1 review, 2026-10-04] The stores are bounded per project
  and refuse at a bound instead of evicting; a key is kept 24 hours apart from its plan; a throw at commit ends the plan with the
  bounded envelope, replayed for the same key. CONFIRMED
- **The route (OD-174).** `POST /api/pcb/provider-exchange` (one route file, two operations named by a closed body field): a canonical
  route whose policy row carries `externalTransfer: true` and `spend: false`, human-only, CSRF, `project_admin`, never public; its
  classification row carries `outboundEgress: "files"` and `modelEgress: false`. The census moved once, by review, to 166 / 163 / 3 / 0.
  CONFIRMED
- **The panel.** A provider panel inside the manufacturing workflow panel, shown for a current ledgered release of a current
  authority: it names the provider and purpose, lists the files and fields a preview answers, and states that no provider is enabled
  in B23; preview and commit are two separate controls. **The UI changed: the lead runs the browser suite.** CONFIRMED (component
  suites, the mounting condition included since the review); the browser suite was not run here.
- **Unchanged.** No agent tool (counts 47 / 36 / 9 / 27); no new runtime dependency (OD-42); no provider contacted, no account, no
  credential, no fetch; the pinned release `mfg-release-45b3b7efbc85dc3a8ecd233c906384cd` (archive SHA-256
  `997664c0b9a87c4d3a65e64eeb90b98159b2ad6ad8806e4ebea748a592ac6dcc`, 41,855 bytes) is reproduced byte for byte. CONFIRMED

## 1. The exact disclosure of the pinned 555 release

The deterministic acceptance pipeline (`app/lib/workflow/prompt-to-gerber/__tests__`; in-memory durable store, the committed catalog,
a fake provider adapter, the recorded router replayed) releases the 555 blinker; `b23-b-outbound-package` drives the same pipeline,
regenerates the release from the head authority and builds its outbound package, and previews and commits it through the route. Every
value below is CONFIRMED by that suite, and independently recomputed in Python from the acceptance suite's own evidence ZIP and
manifest (the OS temp directory `sirkit-b16-1c-evidence`, written by that suite): each member's size and SHA-256, and the provider
manifest's bytes and SHA-256, which equal the suite's pin.

**Identity.** `releaseId` `mfg-release-45b3b7efbc85dc3a8ecd233c906384cd`; `archiveSha256`
`997664c0b9a87c4d3a65e64eeb90b98159b2ad6ad8806e4ebea748a592ac6dcc` (recomputed from Sirkit's own built archive bytes and equal to the
ledger record; the archive is never re-read, so the archive reader's per-entry bound, B22-D, is not relied on); manifest content digest
`mfg-manifest-bca057f6a031374aa46edc283b9759a3f4d80d3ad97487430e062f93889826d2`.

**The files that would leave** (byte-identical to the release: each equal to its archive member and to its manifest record; 30,511
bytes):

| path | role | kind | media type | bytes | sha256 |
|---|---|---|---|---|---|
| `gerber/board-b16-1c-blinker-pth-1-2.xnc` | pth_drill | xnc | application/x-excellon | 287 | `c566d65454d74706f606d3889295f17b93af714f42f06fa6b090c2bb87319144` |
| `gerber/board-b16-1c-blinker.GBL` | copper_bottom | gerber | application/vnd.gerber | 1,465 | `833c6469ac6db979a54edf17a5ae84462d6333288dadfd9493f89146737cca33` |
| `gerber/board-b16-1c-blinker.GBS` | mask_bottom | gerber | application/vnd.gerber | 648 | `46e10d9eaad93bc4f7ef7e8fadf13c921e774ebf2c45a67aac8896f4c660805a` |
| `gerber/board-b16-1c-blinker.GML` | outline | gerber | application/vnd.gerber | 711 | `d7f1f11629c97aa8fd57084a7f4159f4e1196b55077b75bb0a951643f2075568` |
| `gerber/board-b16-1c-blinker.GTL` | copper_top | gerber | application/vnd.gerber | 9,695 | `a1e34fe49ca900c354482e012240ddc639d08e90e3503b4ff9581889d1e56738` |
| `gerber/board-b16-1c-blinker.GTO` | silk_top | gerber | application/vnd.gerber | 13,258 | `1c8080a1a4ab82fadf7a61454ddaf232dbad20badbe5f0cc126bdb19e5f0ad1a` |
| `gerber/board-b16-1c-blinker.GTS` | mask_top | gerber | application/vnd.gerber | 2,817 | `8daf9fa522e233b64ad1b0ab6cacbeffcd0e416bbf9720a94c0c2d5f153d12b9` |
| `gerber/board-b16-1c-blinker.gbrjob` | gerber_job | job | application/json | 1,630 | `0f4d9b656fe7b4537135df4b34e402a7a6dc3074b82e4364840dbfe8bc27eac2` |

**The generated provider manifest** `sirkit-outbound-manifest.json`: 2,396 bytes, SHA-256
`c81e46952d7069fe0d803a5ba9df1d3f13f3a3ee21d32a5bda5939ac03b61cae` (stable key order, two-space indent, LF). Its fields, closed and
exactly these: `schema` (`sirkit.provider-outbound-manifest.v1`), `releaseId`, `archiveSha256`, `capabilityProfile.profileId`
(`jlcpcb-2l`), `capabilityProfile.version` (`2`), and per file `path`, `role`, `kind`, `mediaType`, `bytes`, `sha256` (the eight rows
above). The package's own digest is **`outboundPackageDigest` = `mfg-outbound-c81e46952d7069fe0d803a5ba9df1d3f13f3a3ee21d32a5bda5939ac03b61cae`**,
the manifest's SHA-256 with a prefix: the manifest names every file's size and SHA-256, so the digest binds every byte; two builds from
two regenerations give the same digest and the same manifest bytes. In all, 32,907 bytes would leave. CONFIRMED

**What stays in Sirkit.** `gerber/README.txt` (584 bytes, `0446c8fa0bb9ee34b7a5c4c7faa2731b362bffc92ee0dc127554915e6b42a52e`) and
`gerber/release-manifest.json` (9,370 bytes, `99aa191c32d6fdcde0f7c9a94d3e9548054746ef780f8388c60be7e7a85773c4`). The release manifest
is D23-6's counterexample, reproduced by case 1 on the real release: its `source` carries `tenantId` (`local`), `projectId`,
`branchId`, `designId` and `boardId`, and `actor` is the qualifying human (`u-fresh-editor`); it also carries the RC01-RC03 evidence,
the component authority, the full rule profile, `sourceDate` and the readiness digests. None of them is a field of the provider
manifest, which holds none of the keys `tenantId`, `projectId`, `branchId`, `designId`, `boardId`, `actor`, `source`, `evidence`,
`componentAuthority`, `sourceDate`, `mpn`, `price`, `stock`, `sku`, `quantity`, `currency`, `bom` or `placement`, and none of those
values as a value. No BOM, CPL or distributor-observed value leaves: the bare release lists BOM and both placement files as
intentionally absent, and the builder refuses a release that lists any kind other than Gerber, Excellon, job or README
(`unexpected_kind`). CONFIRMED

**What the file bytes themselves carry - disclosed, never stripped.** The outbound files are the release's own bytes; changing one would
move the pinned release identity (a stop condition of this task), so the package discloses what they carry instead of rewriting it:

- every path carries the board's file-safe name `board-b16-1c-blinker`, which is the board id `board:b16-1c-blinker` with `:` made
  file-safe; the board id is `pcbBoardInstanceId(projectId)` (`app/lib/pcb/board-identity.ts:13`), so the name embeds the project id
  `b16-1c-blinker`;
- each of the six Gerber files carries the X2 attribute
  `%TF.ProjectId,board-b16-1c-blinker,d8e3b30e-31dc-58bc-b245-10b1541e5fd3,rev-d8e3b30e31dcb8bc*%` (the board name, the shared
  coordinate GUID and the MIR revision tag);
- the job file carries the same name, GUID and revision as `GeneralSpecs.ProjectId` and the seven file names in `FilesAttributes`;
- the Excellon file carries none of them;
- no outbound byte carries the tenant, the branch, the design id, the raw board id (`board:...`) or any actor id.

CONFIRMED (case 5 and the Python scan). Whether a provider should receive the board's name is an owner question (section 11, OD-183
(g)).

**What the plan says leaves, and what it says stays** ([B23-B1 review, 2026-10-04]; security-1, coverage-1). The first B1 plan listed
`projectId` and `boardId` under "kept in Sirkit" because neither is a provider-manifest field, while their values leave as above. The
package now scans every outbound name and byte (the eight files and the provider manifest) for each identity value of the release
manifest, as is and in its file-safe form, with no letter or digit beside it, and the sealed plan carries what it finds:

- `carried` (shown as "Sirkit identifiers that would leave inside file names or file bytes"): `projectId` as `b16-1c-blinker` (as is)
  and `boardId` as `board-b16-1c-blinker` (file-safe), each in the names of all eight files and in the bytes of the six Gerbers, the
  job file and the provider manifest;
- `withheldFields` (shown under "Kept in Sirkit", after `gerber/README.txt` and `gerber/release-manifest.json`): `tenantId`, `branchId`,
  `designId` and `actor`, whose values occur in no outbound name or byte;
- `embedded` (shown as "Metadata inside the files that would leave"): every metadata field the file bytes carry, verbatim, with the
  files that carry it; 84 entries for this release:

| field | values (files) |
|---|---|
| `TF.GenerationSoftware` | `Sirkit,Sirkit Fab Compiler,0.1.0` (7: the Gerbers and the Excellon file) |
| `TF.ProjectId` | `board-b16-1c-blinker,d8e3b30e-31dc-58bc-b245-10b1541e5fd3,rev-d8e3b30e31dcb8bc` (6) |
| `TF.SameCoordinates` | `d8e3b30e-31dc-58bc-b245-10b1541e5fd3` (6) |
| `TF.FileFunction` | one per file: `Copper,L1,Top`, `Copper,L2,Bot`, `Soldermask,Top`, `Soldermask,Bot`, `Legend,Top`, `Profile,NP`, `Plated,1,2,PTH` |
| `TF.FilePolarity`, `TF.Part` | `Positive` (4), `Negative` (2); `Single` (6) |
| `G04` | `Sirkit native Gerber X2/X3 - generated from immutable manufacturing snapshot`, `Aperture definitions`, `Image data` (6 each) |
| `TA.AperFunction` | `ComponentDrill`, `ComponentPad`, `Conductor`, `Material`, `NonConductor`, `Profile`, `SMDPad`, `ViaDrill`, `ViaPad` |
| `TO.N` (net names) | `/root/GND`, `/root/VCC` (2 each), `/root/N$5`, `/root/N$6`, `/root/N$7`, `/root/NET_NEVM`, `/root/NET_QFX8` |
| `TO.P` (component pins) | 24: `C1,1` ... `C3,2`, `D1,1`, `D1,2`, `J1,1`, `J1,2`, `R1,1` ... `R3,2`, `U1,1` ... `U1,8` |
| `job:Header.*` | `GenerationSoftware.Vendor` `Sirkit`, `.Application` `Sirkit Fab Compiler`, `.Version` `0.1.0`; `Comment` (the job file's one sentence) |
| `job:GeneralSpecs.*` | `ProjectId.Name` `board-b16-1c-blinker`, `ProjectId.GUID`, `ProjectId.Revision` (as `TF.ProjectId`), `Size.X` `21`, `Size.Y` `21`, `LayerNumber` `2` |
| `job:FilesAttributes[].*` | `Path` (the seven file names), `FileFunction` (as above), `FilePolarity`, `FileFormat` (`Gerber`, `XNC`) |

CONFIRMED: `b23-b-outbound-package` case 9 pins `carried`, the four withheld fields and the 84 entries against an independent read of
the bytes, and asserts that no withheld value occurs in any outbound name or byte; `b23-b-approval-plan` case 11 does the same through
the sealed plan; `b23-b-provider-panel` case 9 shows them and pins that "kept in Sirkit" never names a carried field. The values above
were also recomputed in Python from the acceptance evidence ZIP. The bytes are unchanged; this is a disclosure, and stripping stays
OD-183 (g).

[B23-B1 lead, 2026-10-04] low-3: the board's file-safe name is `safeFabName(boardId)` (`release-gate.ts:299`, `native/snapshot.ts:92`),
which keeps 80 characters, so a project id longer than 74 file-safe characters leaves cut short: `board-` and its first 74 characters
are in every name, each Gerber's `TF.ProjectId` and the job file, while neither its value nor its 80-character file-safe form occurs
anywhere, and the review round's scan listed it as kept. The package now also looks for the leading part of each id's file-safe form
that the cut board name keeps, and lists it as `carried` with form `file-safe-prefix`. CONFIRMED by `b23-b-outbound-package` case 10,
which has the release gate regenerate the 555's own authority for an 86-character project id: the eight names, the six
`TF.ProjectId` attributes and the job file's `ProjectId.Name` carry the 74-character prefix, the whole id is in no name or byte, and
`projectId` is carried as that prefix, never kept. For the 555 nothing changes (its id is 14 characters). Can a project id be that
long? The request selector admits 1 to 128 characters (`ID_PATTERN`, `app/lib/auth/trusted-request-context.ts:43`), and
`project_members.project_id` is unconstrained text (`app/lib/db/schema.ts:1355`); no production code in this tree creates a project id
or a membership (only test suites insert `project_members` rows), so whether a deployment uses an id over 74 characters is UNKNOWN.

## 2. Step 1: `revalidateReleaseAuthority` (D23-7)

In order, as the handler ran them: the stored authority head exists (`MFG_AUTHORITY_NOT_FOUND` 404); the administrator's pins are
present and typed (`MFG_AUTHORITY_CONFIRMATION_REQUIRED` 400) and equal to it (`MFG_AUTHORITY_CONFIRMATION_MISMATCH` 409); the board is
the current one of its lineage (`MFG_BOARD_SUPERSEDED` 409) and has a durable head (`MFG_AUTHORITATIVE_BOARD_NOT_FOUND` 404); that head is
the authority's board revision AND digest (`MFG_AUTHORITY_STALE` 409); the rule profile is v2 (`MFG_RULE_PROFILE_SCHEMA_RETIRED` 422),
unexpired at this instant (`MFG_RULE_PROFILE_EXPIRED` 422), not future-dated and not older than 366 days
(`MFG_RULE_PROFILE_STALE_AT_RELEASE` 422). The release gate still re-checks scope, board identity, profile schema and
`sourceDate`-relative expiry itself (`release-gate.ts:153-159`, `:179-182`). A refusal is the release route's own envelope; a thrown
durable error propagates to the caller's bounded failure. The function reads and writes nothing. CONFIRMED

`b23-b-revalidation` drives twelve refusal cases through the release route, the function itself and the exchange's preview: same code,
status and body (correlation id aside), no generation, no fetch. At commit, six moves between preview and commit refuse with the release
route's own code: a re-qualified authority, a removed authority, a board at another revision, a superseded board, profile evidence that
expires at midnight inside the plan's 10 minutes, and evidence that crosses the 366-day age three minutes after the preview; the
release is not regenerated and nothing is fetched. With nothing moved, commit makes one more authority and board read and ends refused
`provider_not_admitted`. CONFIRMED

The release route's own suites - `release-human-only`, `b16-a-release-confirmation`, `b16-0-15-tranche-parity`, the B16.1C and B16-A
tripwires, `b16-0-15-manufacturing-boundary-gate`, the identity-header gate and the acceptance and recovery pipelines - ran before and
after the edit, unchanged and green (section 9). CONFIRMED

## 3. Step 2: `buildOutboundPackage` (D23-6, OD-163)

Pure; it reads only its input. In order it refuses: `release_not_ledgered` (no ledger record); `archive_digest_mismatch` (the SHA-256
recomputed from the built archive bytes differs from the release's, or from the ledger's); `release_id_mismatch` (the release id
differs from the ledger's or from its manifest's, or does not derive from the manifest digest and board digest as `release-manifest.ts`
derives it); `manifest_digest_invalid` (the manifest's content digest does not verify, or differs from the ledger's); `unexpected_kind`
(any file kind but Gerber, Excellon, job or README); `file_missing` (an outbound record is not exactly once among the built files);
`file_digest_mismatch` (a built file's size or SHA-256 differs from its record). Each refusal is shown by `b23-b-outbound-package` case 7.
CONFIRMED

## 4. Step 3: the sealed plan and the commit (OD-164, OD-166)

**Preview.** After the human-administrator check, the reviewed exchange check and ([B23-B1 review, 2026-10-04]) the store's bound for
this project (`PX_PLAN_LIMIT_REACHED` 429, before any port; below), it re-runs step 1, regenerates the release from the
head authority (`releaseManufacturingPackage`; no ledger write), finds that release in the ledger by its id (`PX_RELEASE_NOT_LEDGERED`
409 otherwise), derives the package (`PX_PACKAGE_REFUSED` 409 with the builder's refusal otherwise) and seals the plan: `planId`
(derived from a server nonce, the scope, the board and the instant), the scope, design and board ids (fields of the plan, which is never
sent; the board's file-safe name does leave inside the files, section 1), the provider
(id, display name, operation id and name, descriptor version `1.0.0` and the digest of the reviewed registry row), the purpose, the
release and authority identity, the outbound files with sizes and SHA-256, the provider manifest's path, size and SHA-256, every
metadata field (the manifest value and its field paths), [B23-B1 review, 2026-10-04] the identities carried inside names and bytes
(`carried`) and every metadata field the file bytes carry (`embedded`), what stays in Sirkit, the `outboundPackageDigest`, a `requestDigest` over
provider, operation, purpose, descriptor, package and release, admission as stated (never acted on), the creator, `createdAt`,
`expiresAt` (10 minutes later) and `planDigest` over all of it. The plan is deep-frozen and kept in memory. Nothing is sent. CONFIRMED

**The reviewed board-file exchanges** (`BOARD_FILE_EXCHANGES`, `provider-exchange.ts:56`, OD-183 (b)): JLCPCB `pcb-quote` (quote),
OSH Park `import-upload` and `api-upload` (quote), MacroFab `dfm-readiness` (dfm) and `pcb-quote` (quote); each is a
`dfm_quote_transfer` operation of A1's registry. Not offered: PCBWay's PcbQuotation (parameters only, no file), its SMT quotation and
DigiKey's Quote-v4 (each takes a BOM; a bare board sends none), MacroFab's `upload` (the transport step of its two operations), and
every ordering or hand-off operation (`PX_EXCHANGE_NOT_OFFERED` 422). CONFIRMED

**Commit.** It checks, before any port (a durable read) is called: a human project administrator (`PX_HUMAN_ADMIN_REQUIRED` 403);
`planId`, `planDigest` and `idempotencyKey` (`PX_PLAN_REQUIRED` 400); a key already used in this project within 24 hours of its commit,
whether or not its plan is still held: the same plan replays the recorded outcome (`idempotent: true`), another plan is
`PX_IDEMPOTENCY_KEY_REUSE_CONFLICT` 409; the plan exists in this project (`PX_PLAN_NOT_FOUND` 404), its digest is the request's and
still verifies (`PX_PLAN_DIGEST_MISMATCH` 409), it is not expired (`PX_PLAN_EXPIRED` 409) and not consumed (`PX_PLAN_CONSUMED` 409);
[B23-B1 review, 2026-10-04] the project has room for one more key record (`PX_KEY_LIMIT_REACHED` 429; the plan is not consumed). Then
it consumes the plan, synchronously, before any await, so a racing second commit finds it consumed; re-runs steps 1 and 2 (a step-1
refusal passes through with its own code and status; [B23-B1 review, 2026-10-04] a THROW - the release gate refuses by throwing, or a
durable read fails - ends the plan with the release route's bounded envelope, the gate's own code and status or
`MFG_DURABLE_STORE_UNAVAILABLE` 503, recorded as the key's outcome, so the same key replays it and another key finds the plan
consumed: the plan is never re-armed, and the administrator previews again); refuses
`PX_PLAN_INPUT_MOVED` 409 when the regenerated release, its package, the board identity or the provider descriptor differ from the
plan; and only then asks admission (`admitProviderOperation`), which refuses every `dfm_quote_transfer` in B23:
`PX_PROVIDER_NOT_ADMITTED` 409 with `refusal: "provider_not_admitted"`, `sent: false`, the plan id and the request digest. Were admission
ever to admit, the service still has no transport and answers `PX_SEND_UNAVAILABLE` (a forged admitting port shows it, case 9).
CONFIRMED

**The stores** ([B23-B1 review, 2026-10-04]; security-3, coverage-2; OD-183 (d)). Plans and key records live in memory, bounded per
project scope (tenant, project, branch) with a backstop over every project together (`PROVIDER_EXCHANGE_LIMITS`,
`provider-exchange.ts:160`): at most 32 open (unconsumed, unexpired) plans per project and 2,048 open plans in all; at most 256 key
records per project and 16,384 in all. Expired plans are dropped before every count; a bound refuses the new preview or commit with 429
and evicts nothing, so one project's previews can no longer push another project's live plan out (the first B1 store evicted the oldest
of 256 across every tenant). A key record is kept 24 hours after its commit (`PROVIDER_EXCHANGE_KEY_RETENTION_MS`), apart from its plan
(the first store forgot a key with its plan). A restart forgets both. CONFIRMED (`b23-b-approval-plan` cases 12 and 13)

[B23-B1 lead, 2026-10-04] low-1: the review round's backstops counted every held plan, consumed ones included, and allowed 1,024 key
records per project. Two scopes (two branches of one project are two scopes) that preview, commit and preview again filled the 2,048
plan backstop, refusing every other project's preview for up to 10 minutes; and 16 scopes at their key bound would fill the 16,384 key
backstop (the bounds' arithmetic), refusing every other project's commit for up to 24 hours. Now the plan backstop counts open plans
only, and a consumed plan keeps only a tombstone (its scope, digest and expiry), which answers another project, a wrong digest, a
second key and its expiry exactly as the plan did until its 10 minutes end. A tombstone counts toward no bound: each was consumed
under its own key record, which outlives it, so the key bound bounds them. The key bound per project is 256. What remains across projects: 64 scopes, each at its 32 open plans, refuse every other
project's preview until one of those plans is committed or expires (at most 10 minutes); 64 scopes, each at its 256 key records, refuse
every other project's commit until the oldest record's 24 hours end. Each needs a human project administrator and a current ledgered
release in all 64 scopes, and nothing is evicted. CONFIRMED (`b23-b-approval-plan` case 16: two branches at their own bounds leave a
third project's preview and commit untouched; case 18: eight scopes at their bounds hold 2,304 plans, more than the backstop, and a
ninth project still previews; case 17: the tombstone's answers, and the 64 as the shipped bounds' arithmetic; no run filled 64 scopes)

**B22-B's sealed request is the shape reused** (`app/lib/computation/requests.ts`): a server-sealed digest and nonce, human-only
approval of the exact digest in the same scope, consumed once before anything runs; the plan adds a provider, a purpose and the exact
disclosure, and its approval is the commit itself (OD-183 (c)). CONFIRMED

## 5. The route, its rows and the census (OD-174)

- **The handler** (`app/api/pcb/provider-exchange/route.ts:66`): `authenticatedJsonRoute` (policy, CSRF, a 16 KiB / 30 s bounded body,
  the opt-in header projected as a safe header); then, before any durable read: authority-shaped keys
  (`PROVIDER_EXCHANGE_FORBIDDEN_KEYS`: identity and scope, content and egress keys) refused `AUTH_AUTHORITATIVE_INPUT_FORBIDDEN` 400;
  any actor but a human project administrator refused `PX_HUMAN_ADMIN_REQUIRED`; `operation` other than `preview` or `commit`
  refused `PX_API_OPERATION_REQUIRED`; an undeclared key refused `PX_API_UNKNOWN_FIELD` (naming the keys); a commit without
  `x-sirkit-provider-exchange-commit: send_exact_plan` refused `PX_COMMIT_OPT_IN_REQUIRED` 403. CONFIRMED (`b23-b-exchange-route` cases
  5-10; [B23-B1 review, 2026-10-04] case 5 now configures production authentication with obvious fakes, so the cross-origin request is
  refused `AUTH_CROSS_ORIGIN_DENIED` and the same request from the expected origin is previewed). A thrown error at preview keeps the
  release route's bounded envelope (the route's `catch`); at commit the service records it (section 4). CONFIRMED ([B23-B1 review,
  2026-10-04] `b23-b-revalidation` cases 6 and 7, `b23-b-approval-plan` case 14; the first page cited cases 5-10 here, none of which
  throws)
- **The policy row** (`route-policy.ts:304`, appended at the end of the table so every earlier row keeps its line):
  `authenticated-mutation`, `trusted-context`, `project_admin` only, CSRF, `authoritativeWrite: false`, `releaseOrQualification: false`,
  `externalTransfer: true`, `spend: false`. `routeVocabularyViolations` passes; it is the one transfer row, no row is spend, and the two
  `releaseOrQualification` rows are unchanged. The B16.0.1 policy CSV gains the row (it does not render the two booleans, OD-182 (f)).
  CONFIRMED
- **The classification row** (`route-resource-classification.ts:99`, `:200`): durable `read`, `project-durable`, `expensive`, no
  external process, not public; `outboundEgress: "files"` is declared by the transfer row itself (never derived), `modelEgress: false`.
  `outboundEgressViolations` passes; `b22-a2-process-census` case 3 derives no process for the route and accepts the row. CONFIRMED
- **No connection is reached.** The route's runtime import closure is the release route's plus exactly six modules: the route, the
  exchange, the package, admission, A1's registry and B19's source registry; no egress boundary, no process spawner, and none of the
  six holds a fetch or a network or model SDK import (`b23-b-exchange-route` case 4). The transport census (`b23-a-route-vocabulary`
  case 8) passes unchanged. CONFIRMED
- **The census** moved once, by review: 166 route methods = 163 canonical wrappers + 3 approved factories + 0 raw. The B16.0, B16.0.1,
  B16.0.2, B16.0.4 and B16.0.7 artifacts each gained the one row; the raw-route baseline is unchanged (3 -> 3). CONFIRMED
- **The record.** `manufacturing.provider-exchange` (`action-registry.ts:186`, appended on that line, as B22 did on `:149`): kind
  destructive, implemented, `toolExposure: "none"`, approval tier `release`, side effect `external-transfer`: permission Tier 3 by
  both. The route coverage entry is appended on `:323`. The B01 matrix gains one last row; the route-coverage CSV one row. CONFIRMED

## 6. The panel

`app/components/pcb/ProviderExchangePanel.tsx`, mounted at the end of `ManufacturingWorkflowPanel.tsx` (`:122`; its import is appended on
`:19` so every later line keeps the number B16-B23 pages cite) when the workflow has a current authority and a current ledgered
release. It states "No provider is enabled in B23", names the provider and purpose (`PROVIDER_EXCHANGE_CHOICES`, equal to the server's
`BOARD_FILE_EXCHANGES`, `b23-b-exchange-route` case 12), and after a preview lists the provider, descriptor, release, authority, every
file with its size and SHA-256, the provider manifest, every field, [B23-B1 review, 2026-10-04] the Sirkit identifiers that leave inside
file names or bytes and every metadata field inside the files, what stays in Sirkit (only what the plan says stays), both digests,
the expiry and the admission answer. Preview and commit are two buttons; commit is disabled until a plan exists, sends that plan's id
and digest, a fresh idempotency key and the opt-in header, shows the server's refusal and is disabled again; changing the provider
discards the plan, and so does a refused or failed preview; a viewer the server says may not act sees both disabled with the reason.
The copy carries no B19-E purchase wording. B17-A classifies the three new controls (two semantic controls of
`manufacturing.provider-exchange`, one view control for the choice); the inventory gained three rows. CONFIRMED (`b23-b-provider-panel`,
9 cases: the mounting condition is case 8, added by the review - current authority and current release shown, preview disabled for a
viewer who may not release; a stale authority, a stale release, no release, no authority, no workflow and no truth hidden; B17-A and
the B19-E tripwire green)

## 7. Test-first record

- **Red first on `da36d51` (CONFIRMED):** the five new suites before any production edit: 5 failed to load, no test ran (log
  `b1-02-red.log`): `../outbound-package`, `@/app/api/pcb/provider-exchange/route` and `@/app/components/pcb/ProviderExchangePanel` did not
  exist, and `revalidateReleaseAuthority` was not exported. The D23-6 counterexample is case 1 of `b23-b-outbound-package`, green by
  design: on the real release, the release's own manifest carries `tenantId` and the actor.
- **First code (CONFIRMED):** 53 / 58 (`b1-03-first-code.log`). Four expectations of the suites themselves were wrong and were corrected:
  the approval suite expected admission never consulted, but preview states it (the case now counts commit's calls only); the route
  suite sent a cross-origin request in the local-only auth mode, which does not enforce the exact origin (it now uses the production
  mode, as `b18-b-execution-grant-route` does; [B23-B1 review, 2026-10-04] that fix was vacuous: unconfigured, the production mode
  refuses every request before the origin check, so the case passed with the route's CSRF turned off; tests-2, section 13); the route suite's wrong opt-in value `send_exact_plan ` (trailing space) is trimmed by
  the Fetch header rules into the right one (now `SEND_EXACT_PLAN` and `send_exact_plan_v2`); and the 555 digest pin was a placeholder
  until the first run measured it (an independent Python recomputation from the acceptance evidence agrees). The classification CSV
  case waited for the generator. Then 58 / 58.
- **The tests bite (CONFIRMED):** with three source mutations at once - commit trusting the previewed plan instead of re-running steps 1
  and 2, the consumed-once check deleted, and the README added to the outbound kinds - 17 of the 58 cases failed (`b1-15-mutations.log`);
  both files were restored and checked by SHA-256.

## 8. Every pin moved, and why

| pin | moved how | why |
|---|---|---|
| `app/api/__tests__/b16-1c-invariant-tripwires.test.ts` header `:5`, title `:38`, `:48` | 165 / 162 -> 166 / 163, in place, dated `[B23-B1, 2026-10-03]` notes | the census moves once (OD-174) |
| `app/lib/auth/__tests__/b16-1b-auth-composition.test.ts` title `:242`, `:255` | the same | the same |
| `app/lib/computation/__tests__/b22-a2-process-census.test.ts` `:315`, `:317` | 165 -> 166 rows, in place, dated | the same; the route reaches no spawner |
| `app/lib/manufacturing-providers/__tests__/b23-a-no-order-structural.test.ts` `:183` | 165 -> 166 policies, dated | the same; the transfer row is not spend |
| `b23-a-route-vocabulary.test.ts` header `:11`, case 1 (title, `:618`, `:623`), case 3 (title, `:658`, `:660`), `census` (`:497`, `TRANSFER_PATHS` on `:87`), case 4 (one assertion added), case 7 (title, count) | 165 -> 166; the one transfer row and the one `files` row named; a transfer path's census value is `files`, declared, and case 4 pins that its closure reaches no egress boundary | OD-182 (a): `files` is never derived, only declared with a transfer row |
| `b23-a-tier3-vocabulary.test.ts` case 5 | 104 -> 105 action ids; `manufacturing.provider-exchange` is the one record with `external-transfer` | the route's record (section 5) |
| `b23-a-provider-admission.test.ts` header `:6`, case 8 title and importers | + `app/api/pcb/provider-exchange/route.ts` | the route reaches admission through the exchange service |
| generated artifacts | B01 matrix and route coverage, B16.0, B16.0.1, B16.0.2, B16.0.4 (two), B16.0.7, B17-A inventory and summary | regenerated by their generators; each gained exactly the new row (the B17 summary its counts) |
| [B23-B1 review, 2026-10-04] `b23-a-route-vocabulary.test.ts` `TRANSFER_PATHS` (`:87`), `EgressRow` (`:488`), `census` (`:497`), case 4 (title `:686`, `:691`, `:692`), case 6 (`:741`) | in place, dated, line count unchanged (838): the transfer list is a reviewed literal, not the policy flag; each census row keeps its closure-derived value beside the declared one; case 4 checks every row at once before its pins, and pins the transfer row's derived value (`none`); its title says `files` is declared; case 6's synthetic row gains `derived` | regressions-3, tests-5 (section 13) |
| [B23-B1 review, 2026-10-04] the B1 suites themselves | `b23-b-approval-plan` case 4's wrong digest is `otherDigest` (tests-6); `b23-b-exchange-route` case 5 configures production authentication and asserts the code, with a same-origin control (tests-2); `b23-b-provider-panel`'s plan fixture says what the server's plan says (four withheld fields, the carried ids, the embedded metadata) | section 13 |

No other pin moved. Every other generator (tool registry, B20 parity, manifest and server registry, B21, B23 provider registry, B19 source
registry, the agent, B06, B10, B11, read-invocation and shape-descriptor artifacts) regenerated with no drift. CONFIRMED

**Citations that moved (not test pins).** [B23-B1 review, 2026-10-04] Every line citation that the discovery and A2's page make into a
file B1 changed, with the line its content holds on this tree. The release route's checks moved into `revalidateReleaseAuthority` and
everything after them moved up by 30; the release route is unchanged since `f6b9390`, so the discovery's `849a933` lines equal `da36d51`'s.
The workflow panel's import was appended on an existing line, so its cited lines did not move. `b23-b-page` case 1 checks every anchor
on the first line it names now. RECORDED

| file | cited | cited at | now | anchor (on the first line now) |
|---|---|---|---|---|
| `app/api/pcb/release/route.ts` | 88-123 | discovery :464, :556, :819 | 157-192 | `const stored = await store.getHead(authorityScope);` |
| `app/api/pcb/release/route.ts` | 95-101 | discovery :294, :474, :558 | 164-170 | `const expectedRevision = input.expectedAuthorityRevision` |
| `app/api/pcb/release/route.ts` | 95-120 | discovery :557, :1154, :1249 | 164-189 | `const expectedRevision = input.expectedAuthorityRevision` |
| `app/api/pcb/release/route.ts` | 107 | discovery :294 | 176 | `if (lineage.state === "superseded")` |
| `app/api/pcb/release/route.ts` | 109 | discovery :647, :1008 | 178 | `if (head.record.revision !== stored.authority.boardRevision` |
| `app/api/pcb/release/route.ts` | 109-111 | discovery :295 | 178-180 | `if (head.record.revision !== stored.authority.boardRevision` |
| `app/api/pcb/release/route.ts` | 114-120 | discovery :296 | 183-189 | `const storedProfile = stored.authority.manufacturingRuleProfile` |
| `app/api/pcb/release/route.ts` | 116-120 | discovery :540, :653, :996, :1009, :1167, :1246 | 185-189 | `const evidenceStatus = ruleProfileEvidenceStatus(` |
| `app/api/pcb/release/route.ts` | 124 | discovery :296 | 94 | `const artifact = await releaseManufacturingPackage(` |
| `app/api/pcb/release/route.ts` | 124-139 | discovery :59, :546 | 94-109 | `const artifact = await releaseManufacturingPackage(` |
| `app/api/pcb/release/route.ts` | 126-139 | discovery :296 | 96-109 | `const recorded = await ledger.record(authorityScope, {` |
| `app/api/pcb/release/route.ts` | 140-151 | discovery :297 | 110-121 | `const headers: Record<string, string> = {` |
| `app/api/pcb/release/route.ts` | 152-153 | discovery :59, :546 | 122-123 | `if (body.format === "manifest") {` |
| `app/components/pcb/ManufacturingWorkflowPanel.tsx` | 52 | discovery :308, :473 | 52 | `const releaseTitle = ` |
| `app/components/pcb/ManufacturingWorkflowPanel.tsx` | 71 | discovery :308, :473 | 71 | `data-testid="p2g-request-release"` |
| `app/components/pcb/ManufacturingWorkflowPanel.tsx` | 96 | discovery :48, :398, :589, :725 | 96 | `This is not a fabricated, ordered, assembled, or electrically certified board.` |
| `app/components/pcb/ManufacturingWorkflowPanel.tsx` | 106-112 | discovery :545 | 106-112 | `data-testid="p2g-release-confirmation"` |
| `app/lib/auth/route-policy.ts` | 358 | discovery :584; A2 page C21 | 360 | `export interface RoutePolicy {` |
| `app/lib/auth/route-policy.ts` | 375 | discovery :584; A2 page :162, C22 | 377 | `export function routeVocabularyViolations(` |
| `app/lib/auth/route-resource-classification.ts` | 112 | A2 page :168, C23 | 114 | `export const OUTBOUND_EGRESS = ` |
| `app/lib/auth/route-resource-classification.ts` | 128 | A2 page C33 | 130 | `const MODEL_EGRESS_PATHS: ReadonlySet<string> = new Set([` |
| `app/lib/auth/route-resource-classification.ts` | 137 | A2 page C34 | 139 | `export const PUBLIC_MODEL_EGRESS: ` |
| `app/lib/auth/route-resource-classification.ts` | 199 | A2 page C35 | 201 | `modelEgress: MODEL_EGRESS_PATHS.has(policy.path),` |
| `app/lib/auth/route-resource-classification.ts` | 236 | A2 page C24 | 238 | `export function outboundEgressViolations(` |

The first B1 page mapped `:124-139` to `:95-109`, one line low: the release generation is `:94` (regressions-1, section 13). Every anchor
text is unchanged except the pins' source, `body.` -> `input.` (`:164`). [B23-B1 lead, 2026-10-04] low-2: the `152-153` row listed
discovery `:544` and `:997` as well; both cite the runbook's `:152-153` (`:544` "Requirement: B23-B step 2 `:976`; global `:152-153`",
`:997` "Runbook `:152-153` is a loose anchor"), so neither moves to `:122-123`. `b23-b-page` case 5 now checks every line the "cited
at" column names: the row's range must be cited there, and the file named with it or nearest before it on that line must be the row's
file, never the runbook. CONFIRMED

## 9. Gates

Every run went through the shared lock, one at a time, and every CLI process was stopped after it (leftover count 0 each time). No run
printed `Timeout calling "onTaskUpdate"`.

| gate | result |
|---|---|
| every suite that reads a file B1 changed (65 files by name) + `app/api/pcb/release/__tests__`, before and after | before: 67 files; 929 passed, 1 skipped; exit 0. After: the same, 929 passed, 1 skipped; exit 0 |
| the five new suites | red first: 5 failed to load; then 58 / 58 (revalidation 21, outbound package 8, approval plan 10, exchange route 14, panel 5) |
| `app/lib/manufacturing-providers/__tests__` + the three moved census suites | 15 files; 227 / 227; exit 0 |
| `app/api/pcb`, `app/lib/pcb/fab`, `app/lib/pcb/__tests__`, `app/lib/workflow/prompt-to-gerber/__tests__` (excluding `autoroute-boundary-integrity`, `manufacturing-release-gate` and `autonomous-layout-qualification`, section 11) | 114 files passed, 2 skipped; 822 passed, 9 skipped; exit 0 |
| `app/lib/auth/__tests__`, `app/api/__tests__`, `app/lib/computation/__tests__`, `app/lib/agent/orchestration/__tests__`, `app/api/chat/__tests__` | 165 files passed, 2 skipped; 2447 passed, 27 skipped; exit 0 |
| `app/lib/engineering/__tests__` (B17-A, B01, B18-A, B19-E tripwire), `app/components/pcb/__tests__` (the workflow panel), `app/lib/acquisition/__tests__` (the CI job-scope guard) | 132 files passed, 1 skipped; 1393 passed, 3 skipped; exit 0 |
| `app/lib/agent/__tests__` (B11.5 case 12), `app/lib/mcp` (counts 47 / 36 / 9 / 27, `b20-b4-process-gate`), `app/lib/project/__tests__` (`b14-4-ast-import-gates`) | 118 files; 1534 / 1534; exit 0 |
| tsc (`--noEmit -p tsconfig.json`) | exit 0, no output (a first run found two type errors in the new suites, fixed) |
| eslint on the 23 changed or added `.ts` / `.tsx` files | exit 0, no output |
| generators | as section 8 |
| `b21-closeout-statements`, `b22-closeout-statements` and `b21-f-page` over this page, with `app/lib/manufacturing-providers/__tests__` and the CI job-scope guard | 16 files; 247 / 247; exit 0 |
| after the last route edit (the durable ports built inside the bounded `try`): the five new suites + `app/api/pcb/release/__tests__`; eslint on the route; tsc | 7 files; 79 / 79; exit 0; eslint exit 0; tsc exit 0 |

## 10. OD-183 - B23-B1's choices beyond its task text

(a) One route file, two operations named by a closed body field `operation: "preview" | "commit"`, each with its own closed key set;
authority-shaped keys are refused before anything else. (b) The reviewed board-file exchanges are the five of section 4; the others
are refused as not offered. (c) B22-B's sealed request is the approval shape: a server nonce and digest, the commit is the human
approval of the exact plan, consumed once before steps 1 and 2 re-run; the committing administrator may differ from the previewing
one, in the same project (any human project administrator; no two-person rule in B1). (d) Plans and idempotency keys live in memory
([B23-B1 review, 2026-10-04] replacing one process-wide store of 256 plans that evicted the oldest across every tenant and forgot a
plan's keys with it): per project scope at most 32 open plans and 256 key records ([B23-B1 lead, 2026-10-04] was 1,024), with backstops
of 2,048 open plans ([B23-B1 lead, 2026-10-04] the review round counted every held plan) and 16,384 key records over every project; a
consumed plan keeps only a tombstone until it expires; expired plans are dropped first; a bound refuses (`PX_PLAN_LIMIT_REACHED`,
`PX_KEY_LIMIT_REACHED`, 429) and never evicts; a key record is kept 24 hours after its commit, apart from its plan. A restart forgets
them, and a commit then refuses `PX_PLAN_NOT_FOUND`; nothing is persisted in B1, and the durable exchange record is B23-B2's (OD-167).
The backstops are the one remaining cross-project effect: 64 project scopes (each branch is its own scope) holding 2,048 open plans
together refuse every other project's next preview until one of them is committed or expires (at most 10 minutes), and [B23-B1 lead,
2026-10-04] 64 scopes each holding 256 key records refuse every other project's commit until the oldest record's 24 hours end (low-1:
the first wording left out the consumed plans, then counted, with which two scopes filled the plan backstop, and the 24-hour key
lockout, then reached by 16 scopes); nothing is evicted. (e) The exchange's refusals are its own closed `PX_*` vocabulary; step 1's and the
release gate's keep their `MFG_*` codes, statuses and bodies; a thrown error keeps the release route's bounded envelope ([B23-B1 review,
2026-10-04] at commit it ends the plan and is recorded as the key's outcome, so the same key replays it; the plan is never re-armed).
(f) The policy row is `authenticated-mutation` with `authoritativeWrite: false` (it writes no
engineering state), appended at the end of the table; its record is `manufacturing.provider-exchange` with the `external-transfer` side
effect and approval tier `release`. (g) The board's file-safe name in the release's file names and Gerber and job bytes is disclosed,
never stripped (stripping it would move the pinned release); whether a provider may receive it is the owner's question. [B23-B1 review,
2026-10-04] The sealed plan discloses it: an identity whose value is found in an outbound name or byte is `carried`, never "kept"; every
metadata field of the bytes is `embedded`. (h) The panel is shown only for a current ledgered release of a current authority; commit is
disabled until a preview and after one commit ([B23-B1 review, 2026-10-04] CONFIRMED by `b23-b-provider-panel` case 8; a refused or
failed preview discards the plan). RECORDED

## 11. What stays open

- **Live exchange: BLOCKED-LIVE-QUALIFICATION (LB-11).** No provider is admitted, no account exists (OD-160); the bounded send, the
  receipts and the exchange ledger are B23-B2's.
- **The board's name leaves with the files** (section 1): it embeds the project id. Removing it from the Gerber X2 attribute, the job
  file and the file names would change the release bytes and identity; that is an owner decision (OD-183 (g)), not B1's. UNKNOWN
- **Plans are per process** (OD-183 (d)): in a multi-instance deployment a commit routed to another instance refuses
  `PX_PLAN_NOT_FOUND`. INFERRED
- **Two `app/lib/pcb/__tests__` suites were not run here**: `manufacturing-release-gate.test.ts` and
  `autonomous-layout-qualification.test.ts` build their authority with `createAutonomousGoldenRealRouter`, the production FreeRouting
  executor, which starts Java when the runtime resolves (INFERRED from `production-router.ts:34-46`); the standing rule forbids that
  here. B1 does not change `release-gate.ts`. RECORDED
- **The browser suite** was not run (the UI changed). RECORDED
- **A stale statement left in place** ([B23-B1 review, 2026-10-04], regressions-4): `provider-registry.ts:16` still says "Nothing here calls a provider, and no route reads this registry yet."; since B1 the provider exchange route reads the registry at preview and commit (`b23-b-exchange-route` case 4, `b23-b-page` case 4). The first half still holds. The registry's own rule bumps `PROVIDER_REGISTRY_VERSION` on any change, which would move every plan's descriptor and A1's byte-gated CSV, so the sentence is corrected in the next reviewed registry revision, not here. RECORDED
- **`tier3-vocabulary.md:184`** says `b23-a-route-vocabulary` case 4 derives both values per path; since B1 a transfer path's `files` is declared, checked against the reviewed transfer list, with its closure-derived value pinned beside it (section 8). A2's page is left as A2 wrote it. RECORDED

## 12. Citations

As of this increment's working tree on `da36d51` after the review round (2026-10-04); the anchor text is the check, the line is for the
reader; `b23-b-page` case 3 checks every row. [B23-B1 lead, 2026-10-04] C24's anchor moved in place (`keysPerProject: 256`); C32-C36 are
the three low fixes' lines; every other row holds unchanged.

| # | file | line | anchor |
|---|---|---|---|
| C1 | `app/api/pcb/release/route.ts` | 91 | `const revalidated = await revalidateReleaseAuthority({ store, scope, designId, boardId,` |
| C2 | `app/api/pcb/release/route.ts` | 145 | `export async function revalidateReleaseAuthority(input: {` |
| C3 | `app/lib/manufacturing-providers/outbound-package.ts` | 36 | `export const OUTBOUND_FILE_KINDS = Object.freeze(["gerber", "xnc", "job"] as const);` |
| C4 | `app/lib/manufacturing-providers/outbound-package.ts` | 115 | `export function buildOutboundPackage(` |
| C5 | `app/lib/manufacturing-providers/outbound-package.ts` | 154 | ``outboundPackageDigest: `mfg-outbound-${manifestSha256}`,`` |
| C6 | `app/lib/manufacturing-providers/provider-exchange.ts` | 39 | `export const PROVIDER_EXCHANGE_PLAN_TTL_MS = 10 * 60_000;` |
| C7 | `app/lib/manufacturing-providers/provider-exchange.ts` | 56 | `export const BOARD_FILE_EXCHANGES` |
| C8 | `app/lib/manufacturing-providers/provider-exchange.ts` | 216 | `export class ProviderExchangeService {` |
| C9 | `app/lib/manufacturing-providers/provider-exchange.ts` | 317 | `stored.consumed = true;` |
| C10 | `app/lib/manufacturing-providers/provider-exchange.ts` | 346 | `if (!admission.admitted) return refusalBody("PX_PROVIDER_NOT_ADMITTED",` |
| C11 | `app/api/pcb/provider-exchange/route.ts` | 66 | `export const POST = authenticatedJsonRoute(` |
| C12 | `app/api/pcb/provider-exchange/route.ts` | 73 | `if (actor.actorKind !== "human" \|\| actor.role !== "project_admin") return providerExchangeRefusal("PX_HUMAN_ADMIN_REQUIRED",` |
| C13 | `app/lib/auth/route-policy.ts` | 304 | `...mutate("/api/pcb/provider-exchange", ["POST"],` |
| C14 | `app/lib/auth/route-resource-classification.ts` | 99 | `"/api/pcb/provider-exchange": { durable: "read", sensitivity: "project-durable", expensive: true },` |
| C15 | `app/lib/auth/route-resource-classification.ts` | 200 | `outboundEgress: policy.externalTransfer === true ? "files"` |
| C16 | `app/lib/engineering/action-registry.ts` | 186 | `action({ id: "manufacturing.provider-exchange", version: 1, area: "manufacturing",` |
| C17 | `app/lib/engineering/control-registry.ts` | 137 | `rule({ id: "manufacturing.provider-exchange", surface: PCB + "ProviderExchangePanel.tsx",` |
| C18 | `app/components/pcb/ProviderExchangePanel.tsx` | 122 | `export function ProviderExchangePanel(props: ProviderExchangePanelProps) {` |
| C19 | `app/components/pcb/ManufacturingWorkflowPanel.tsx` | 122 | `<ProviderExchangePanel scope={workflow.workflow.scope}` |
| C20 | `app/components/pcb/ManufacturingWorkflowPanel.tsx` | 19 | `import { ProviderExchangePanel } from "./ProviderExchangePanel"; // [B23-B1] appended in place` |
| C21 | `app/lib/manufacturing-providers/outbound-package.ts` | 155 | `withheld: { files: withheldFiles, fields: WITHHELD_SOURCE_FIELDS.filter((field) => !carried.some(` |
| C22 | `app/lib/manufacturing-providers/outbound-package.ts` | 170 | `function carriedIdentifiers(manifest: ManufacturingReleaseManifestV1,` |
| C23 | `app/lib/manufacturing-providers/outbound-package.ts` | 186 | `function embeddedMetadata(files: readonly OutboundFile[]): EmbeddedMetadata[] {` |
| C24 | `app/lib/manufacturing-providers/provider-exchange.ts` | 160 | `Object.freeze({ plansPerProject: 32, plans: 2048, keysPerProject: 256, keys: 16_384 });` |
| C25 | `app/lib/manufacturing-providers/provider-exchange.ts` | 162 | `export const PROVIDER_EXCHANGE_KEY_RETENTION_MS = 24 * 60 * 60_000;` |
| C26 | `app/lib/manufacturing-providers/provider-exchange.ts` | 248 | `if (!this.hasPlanRoom(scopeKeyOf(scope), this.now())) return refused("PX_PLAN_LIMIT_REACHED", correlationId);` |
| C27 | `app/lib/manufacturing-providers/provider-exchange.ts` | 315 | `if (!this.hasKeyRoom(scopeKey)) return refused("PX_KEY_LIMIT_REACHED", correlationId);` |
| C28 | `app/lib/manufacturing-providers/provider-exchange.ts` | 326 | `outcome = await fromResponse(boundedManufacturingFailure(error, "release", correlationId));` |
| C29 | `app/lib/manufacturing-providers/provider-exchange.ts` | 370 | `private hasPlanRoom(scope: string, now: number): boolean {` |
| C30 | `app/components/pcb/ProviderExchangePanel.tsx` | 157 | `data-testid="p2g-provider-carried"` |
| C31 | `app/lib/manufacturing-providers/provider-registry.ts` | 16 | `no route reads this registry yet` |
| C32 | `app/lib/manufacturing-providers/provider-exchange.ts` | 198 | `interface StoredPlan { plan: ProviderExchangePlan \| null;` |
| C33 | `app/lib/manufacturing-providers/provider-exchange.ts` | 317 | `stored.consumed = true; stored.plan = null;` |
| C34 | `app/lib/manufacturing-providers/provider-exchange.ts` | 374 | `return open < this.limits.plansPerProject && openAll < this.limits.plans;` |
| C35 | `app/lib/manufacturing-providers/outbound-package.ts` | 173 | `...boardNameCutPrefixes(identity[field], manifest.source.boardId)` |
| C36 | `app/lib/manufacturing-providers/outbound-package.ts` | 232 | `function boardNameCutPrefixes(value: string, boardId: string): string[] {` |

## 13. The adversarial review of the first B1 tree, and what it changed

An adversarial review CONFIRMED seventeen findings against the first B1 tree (regressions-1..4, security-1, security-3, coverage-1..4,
tests-1..7). Each was fixed test-first through the shared lock: a new or strengthened case failed on the unfixed tree, or a source
breakage the first suites missed was shown, and the strengthened case then caught the same breakage. Every breakage was applied by exact
text and the file restored and checked by SHA-256. Logs are `b1fix-*` in the increment's scratch log directory. CONFIRMED unless marked.

| finding(s) | what was wrong | reproduced | fix | after |
|---|---|---|---|---|
| regressions-1, coverage-4 (the release route) | section 8 mapped the discovery's `route.ts:124-139` to `:95-109`, one line low (the release generation is `:94`), and left most moved ranges out | `b1fix-07-red`: `b23-b-page` case 2 "app/api/pcb/release/route.ts:124-139 -> :95 (const artifact = await releaseManufacturingPackage()" | section 8 maps all thirteen cited release-route ranges, the four panel citations and A2's seven, each with the anchor its first line holds now | page case 2 green |
| regressions-2, coverage-4 (the panel) | the panel's import was a new line 20, so every later line of `ManufacturingWorkflowPanel.tsx` moved by one under the discovery's and B16-A's citations | `b1fix-07-red`: page case 2, the four panel rows (`:52`, `:71`, `:96`, `:106`) stale | the import is appended on `:19`; only the mount at the end of the JSX adds lines | page case 2 green; the discovery's `:52`, `:71`, `:96`, `:106-112` and B16-A's "panel line 96 now" hold |
| regressions-3, tests-5 | case 4's title claimed every value is derived, and for the transfer row its row equality compared the policy flag with itself | `b1fix-06`: with the transfer flag dropped, the first case 4 failed only at B1's pin (`:691`, "expected [] to deeply equal [ { ... } ]"), never at the row equality | the transfer list is a reviewed literal; each census row keeps its closure-derived value; case 4 collects every mismatching row first and pins the transfer row's derived value (`none`); retitled in place | `b1fix-19`: the same breakage fails case 4 at the row check, "POST /api/pcb/provider-exchange: none (census files)"; restored; green |
| regressions-4 | `provider-registry.ts:16` says no route reads the registry; the provider exchange route does | `b1fix-07-red`: page case 4 "provider-registry.ts:16: expected [] to have a length of 1" | recorded in section 11 (the registry's version rule keeps the file as A1 left it) | page case 4 green |
| security-1, coverage-1 | the plan and the panel said `projectId` and `boardId` stay in Sirkit while their values leave in every file name and in the Gerber and job bytes; no in-file metadata was listed; nothing tested it | `b1fix-07-red`: `b23-b-outbound-package` case 9 (`disclosure` undefined), `b23-b-approval-plan` case 11 ("expected undefined to deeply equal [ { field: 'projectId', ... } ]"), `b23-b-provider-panel` case 9 (no `p2g-provider-carried`) | the package scans every outbound name and byte: `carried`, `embedded`, and `withheld.fields` only for what occurs nowhere; the plan and the panel carry them; the route's header no longer claims no internal id leaves | green: for the 555, `projectId` and `boardId` carried, four fields withheld, 84 metadata entries (section 1) |
| security-3, tests-4 | one process-wide store of 256 plans evicted the oldest across every tenant; neither the bound nor the expiry sweep was tested | `b1fix-04`: the first suite stayed 10 / 10 with the eviction and the sweep deleted; `b1fix-07-red`: case 12 (`PROVIDER_EXCHANGE_LIMITS` undefined) | per-project bounds with backstops; a bound refuses (429) and evicts nothing (section 4, OD-183 (d)) | green; `b1fix-14`: the sweep deleted fails cases 12 and 13; `b1fix-15`: the per-project bound deleted fails case 12 |
| coverage-2 | a key was forgotten with its plan, so a reused key passed once the plan had expired or been evicted | `b1fix-07-red`: case 13 (the stores' counts did not exist) | key records kept 24 hours after their commit, apart from their plans; a project at its key bound is refused before the plan is consumed | green; `b1fix-16`: keys dropped with their plan again fails cases 12 and 13 |
| tests-1 | no case made a port or the gate throw; a throw at commit left the plan consumed with no outcome, so the same key answered `PX_PLAN_CONSUMED`; section 5 labelled the bounded envelope CONFIRMED by cases that never throw | `b1fix-05`: the first suites stayed 58 / 58 with the route's `catch` removed; `b1fix-07-red`: `b23-b-revalidation` case 7 "expected 409 to be 422", approval case 14 (the gate's error escaped `commit`) | a throw at commit ends the plan with the release route's bounded envelope, recorded as the key's outcome (section 4); section 5 relabelled | green; `b1fix-17`: the commit's `catch` removed fails approval 14 and revalidation 7; `b1fix-18`: the route's `catch` removed fails revalidation 6 |
| tests-2 | case 5's cross-origin request was refused because production authentication was unconfigured, whatever its origin | `b1fix-01`: with the route's CSRF turned off, the first case 5 passed | production authentication configured with obvious fakes; the case asserts `AUTH_CROSS_ORIGIN_DENIED`, and the same request from the expected origin is previewed (200) | green; `b1fix-11`: CSRF off fails case 5, "expected 200 to be 403" |
| tests-6 | case 4's wrong digest, `slice(0, -1) + "0"`, equals a digest that ends in `0` | `b1fix-07-red`: case 15 with the old construction, "dw1-...0: expected ... not to be ..." | `otherDigest` changes the last character to one it is not | green; `b1fix-20`: the digest comparison deleted fails case 4 |
| tests-7 | the panel's refused-preview, transport-failure and unreadable-answer paths were untested; a stale plan could stay committable | `b1fix-02`: the first panel suite stayed 5 / 5 with the plan-clearing deleted | panel cases 6 and 7 | green; `b1fix-12`: the same breakage fails cases 6 and 7 |
| coverage-3, tests-3 | the mounting condition (OD-183 (h)) was labelled CONFIRMED with no test; section 6 cited "case 12" of the 5-case panel suite | `b1fix-03`: the panel and workflow-panel suites stayed 17 / 17 with `truth.latestRelease?.current` dropped from the guard | panel case 8; section 6 relabelled, `b23-b-exchange-route` case 12 named | green; `b1fix-13`: the same breakage fails case 8, "a stale release: expected { shown: true, ... }" |

The red run (`b1fix-07-red`): 12 failed and 200 passed of 212 in `app/lib/manufacturing-providers/__tests__`; one of the twelve was
the review's own edit of `b23-a-route-vocabulary` case 6, whose synthetic census row lacked the new `derived` field (moved in place, section 8).

**Gates on the fixed tree** (each through the shared lock, one at a time, every CLI process stopped after it, leftover count 0 each
time; no run printed `Timeout calling "onTaskUpdate"`):

| gate | result |
|---|---|
| the reader suites of every file the review changed, before any edit (`b1fix-00`): `app/lib/manufacturing-providers/__tests__`, the workflow panel, B17-A, the action registry, the B22 process census, the B16.1C tripwires, the B16.1B auth composition, `app/api/pcb/release/__tests__` | 20 files; 276 / 276; exit 0 |
| the same after the fixes, with the new `b23-b-page` and the CI job-scope guard (`b1fix-30`) | 22 files; 305 / 305; exit 0 |
| the six B23-B1 suites | 74 / 74: revalidation 23, outbound package 9, approval plan 15, exchange route 14, panel 9, page 4 |
| `app/lib/manufacturing-providers/__tests__` with `b21-closeout-statements`, `b21-f-page`, `b22-closeout-statements`, the CI job-scope guard, the workflow panel and B17-A (`b1fix-21`) | 19 files; 281 / 281; exit 0 |
| `app/api/pcb`, `app/lib/pcb/fab`, `app/lib/pcb/__tests__`, `app/lib/workflow/prompt-to-gerber/__tests__` (the three exclusions of section 9; `b1fix-23`) | 114 files passed, 2 skipped; 822 passed, 9 skipped; exit 0; the pinned 555 identities unchanged |
| `app/lib/auth/__tests__`, `app/api/__tests__`, `app/lib/computation/__tests__`, `app/lib/agent/orchestration/__tests__`, `app/api/chat/__tests__` (`b1fix-24`) | 165 files passed, 2 skipped; 2447 passed, 27 skipped; exit 0 |
| `app/lib/engineering/__tests__`, `app/components/pcb/__tests__`, `app/lib/acquisition/__tests__` (`b1fix-25`) | 132 files passed, 1 skipped; 1393 passed, 3 skipped; exit 0 |
| `app/lib/agent/__tests__` (B11.5 case 12), `app/lib/mcp` (counts 47 / 36 / 9 / 27), `app/lib/project/__tests__` (`b14-4-ast-import-gates`; `b1fix-26`) | 118 files; 1534 / 1534; exit 0 |
| tsc (`--noEmit -p tsconfig.json`) | the first run found three type errors in the review's own code (the bounds' literal types, one test array's scope type), fixed; then exit 0, no output (`b1fix-28`) |
| eslint on the 24 changed or added `.ts` / `.tsx` files | exit 0, no output (`b1fix-29`) |
| every generator (21; `b1fix-22`) | each exit 0; no drift: the B17-A inventory, the B01 matrix and every B16.0 artifact are unchanged by the review |

The census stays 166 / 163 / 3 / 0; the agent-tool counts stay 47 / 36 / 9 / 27; no route, tool, control or runtime dependency was added
by the review. The four directory gates and the generators ran before the last edit, which only typed the bounds (`provider-exchange.ts:160`)
and one test array; tsc, eslint and `b1fix-30` ran after it. The panel's markup changed (two lists and three test ids): the lead runs
the browser suite. RECORDED

**[B23-B1 lead, 2026-10-04] Three low findings of the independent check of the review round**, each fixed test-first through the
shared lock. The red run (`lowfix-01-red`) had 4 failed and 28 passed of 32. Each source breakage (`lowfix-03`) was applied by exact
text, and the file was then restored and checked by SHA-256 (all four matched). Logs are `lowfix-*` in the increment's scratch log
directory.

| finding | what was wrong | reproduced | fix | after |
|---|---|---|---|---|
| low-1 (`provider-exchange.ts`) | the backstops counted consumed plans, and 1,024 key records per project let 16 scopes fill the key store for 24 hours; section 4 and OD-183 (d) named only "64 projects at their bound ... until plans expire" | `b23-b-approval-plan` case 16: two branches of one project at their own bounds, then a third project's preview: "expected 'PX_PLAN_LIMIT_REACHED' to be 'ok'"; case 17: "expected { planScopes: 64, keyScopes: 16 } to deeply equal { planScopes: 64, keyScopes: 64 }" | the plan backstop counts open plans; a consumed plan keeps a tombstone (scope, digest, expiry) until it expires; 256 key records per project; case 12's limits pin moved in place, dated; sections 4 and 10 state the cross-project effect that remains | green; counting consumed plans again fails the new case 18 (eight scopes at their bounds hold 2,304 plans; "expected { plans: 2048, openPlans: 224, ... }"); 1,024 key records fails cases 12 and 17; deleting the consumed plan instead of keeping its tombstone fails cases 7, 12-14 and 16-18 |
| low-2 (this page) | section 8's `152-153` row listed discovery `:544` and `:997`, which cite the runbook's `:152-153` | `b23-b-page` case 5: "app/api/pcb/release/route.ts:152-153 cited at discovery :544 -> [\"runbook\"]" and the same for `:997` | the row lists `:59, :546`; a dated note under the table | green; case 5 checks every line the "cited at" column names (40 lines) |
| low-3 (`outbound-package.ts`) | a project id over 74 file-safe characters leaves cut short in the 80-character board name, and the scan, which looked only for the whole value and its file-safe form, listed `projectId` as kept | `b23-b-outbound-package` case 10 (the 555's authority released for an 86-character project id): "expected [ { field: 'boardId', ... } ] to deeply equal [ { field: 'projectId', ... }, ... ]" | the scan also looks for the leading part the cut board name keeps, listed as carried with form `file-safe-prefix`; section 1 records whether such ids are admissible | green; removing that scan fails case 10 |

Not shown by any test: that a consumed plan's body is dropped (only memory differs; case 17 shows the tombstone answers as the plan
did). RECORDED

| gate (after the fixes, each through the lock, one at a time, every CLI process stopped after it, leftover count 0 each time) | result |
|---|---|
| the reader suites of every file changed, before any edit (`lowfix-00`): `app/lib/manufacturing-providers/__tests__`, `b21-closeout-statements`, `b22-closeout-statements`, `b21-f-page`, the CI job-scope guard | 17 files; 263 / 263; exit 0 |
| the same after the fixes (`lowfix-04`) | 17 files; 268 / 268; exit 0 (five new cases) |
| the six B23-B1 suites | 79: revalidation 23, outbound package 10, approval plan 18, exchange route 14, panel 9, page 5 |
| `app/api/pcb`, `app/lib/pcb/fab` (the three exclusions of section 9; `lowfix-05`) | 18 files passed, 1 skipped; 157 passed, 5 skipped; exit 0 |
| `app/api/__tests__/b16-1c-invariant-tripwires.test.ts`, `app/lib/auth/__tests__`, `app/lib/engineering/__tests__` (`lowfix-06`) | 141 files; 1593 passed, 9 skipped; exit 0 |
| tsc (`--noEmit -p tsconfig.json`; `lowfix-07`) | exit 0, no output |
| eslint on the five changed `.ts` files (`lowfix-08`) | exit 0, no output |
| every generator (21; `lowfix-09`) | each exit 0; no drift |

No route, tool, control, generated artifact or runtime dependency changed. The census stays 166 / 163 / 3 / 0 (`lowfix-06`). No tool
or registry file changed, so the agent-tool counts stay 47 / 36 / 9 / 27; that suite was not re-run here (INFERRED). The panel's markup
did not change in this round. RECORDED
