# R05-E2E01 — Real Prompt-to-Gerber MVP Qualification

**Stage:** `R05-E2E01` — Final Natural-Language Prompt-to-Gerber Qualification
**Date:** 2026-07-29
**Provider (owner override):** Anthropic (`claude-opus-4-7`). The owner reported no
remaining OpenAI tokens and authorized substituting Anthropic where necessary.

---

## 1. Verdict

`COMPLETE`.

One ordinary natural-language request now travels the production path end to end —
live provider call, authoritative schematic, exact component/footprint authority,
durable PCB publication and explicit apply, autonomous placement with the real
bundled FreeRouting runtime, independent connectivity/DRC verification, and an
MFG01 verified manufacturing release — and returns a deterministic,
independently-inspectable bare-board Gerber/Excellon archive with no manual
schematic or PCB edit at any point.

No board has been uploaded, quoted or ordered. No physical hardware has been
built or tested, and no first-pass-hardware claim is made.

---

## 2. Repository identity

| Item | Value |
|---|---|
| Working repository | `C:\Users\robsa\Desktop\sirkit-edit` |
| Branch | `codex/cd-13-full-flow-orchestrator` |
| HEAD (unchanged) | `2bd1603a775bd4b409b89710cd4e5f8d70201632` |
| Worktree before | 351 `git status --short` entries |
| Worktree after | 372 entries |
| Protected original | `C:\Users\robsa\sirkit` — untouched |

The working repository is a copy the owner asked to be taken from
`C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit` before this stage
began; that source and the protected original were both left unmodified. No Git
history was rewritten, no untracked file was deleted, and no `git clean` /
`git reset` was run.

**Database.** The live Supabase instance held only the KiCad catalog (8 public
tables). Drizzle migrations `0006`–`0025` had never been applied, so every
durable-authority table the stage depends on was absent. All were applied
(now 142 tables including the new `0026`).

---

## 3. Baseline failure reproduction

The exact acceptance prompt was submitted through the real AI chat UI before any
repair. It failed at the very first stage:

```
POST /api/schematic/build-multi → 503
{"ok":false,"code":"provider_unavailable","provider":"anthropic",
 "reason":"bad_request","error":"Anthropic rejected this AI request."}
```

The underlying provider response was `400 invalid_request_error: "Your credit
balance is too low to access the Anthropic API."` — an unfunded account reported
to the user as a malformed request. Nothing downstream of generation was reachable.

Read-only onboarding had already identified the structural gaps; this stage
confirmed each one against the running product:

| Gap | Confirmed symptom |
|---|---|
| Generation never reaches PCB publication | `applySchematic` never calls `PcbSyncClient`; the only path was a manual two-click PCB-tab flow |
| `SIRKIT_PCB_SYNC_STAGE3` defaults off | every `/api/pcb-sync` POST returned 503 `PS_STAGE3_DISABLED` |
| AI parts carry no footprint authority | `buildPcbSyncPublicationGraph` throws `PS_SYMBOL_ASSET_REQUIRED` |
| MFG01 release unreachable | `releaseManufacturingPackage` had zero non-test callers |
| Stable-net-ID schemes disagree | publication digest vs `stableNetIdForEndpoints` |

---

## 4. Architecture: before and after

**Before.** The qualified domain engines existed and were individually strong, but
the live user path stopped at a committed schematic. Publication, qualification
and release were reachable only from tests or manual UI actions, and three
independent identity/digest schemes disagreed across those boundaries.

**After.** One production path:

```
POST /api/schematic/build-multi        live provider, planner + parallel build loops
  -> autoLayoutBuildValidated          deterministic layout, electrically revalidated
  -> POST /api/physical-bindings        bind_atomic_selection per instance
                                        (create -> select -> revalidate -> approve)
  -> POST /api/pcb-sync publish_demo_snapshot
  -> POST /api/pcb-sync preflight -> apply -> authoritative board GET
  -> POST /api/pcb/qualify              outline fitting, placement candidates,
                                        bundled FreeRouting, RC01/RC02/RC03,
                                        durable authority persisted
  -> POST /api/pcb/release              MFG01 gate -> deterministic ZIP
```

New production modules (not test-only):

| File | Purpose |
|---|---|
| `app/api/pcb/qualify/route.ts` | Autonomous qualification endpoint; persists release authority |
| `app/api/pcb/release/route.ts` | MFG01 verified release endpoint; streams the archive |
| `app/lib/pcb/autonomous/production-router.ts` | Real FreeRouting executor, lifted out of a test fixture |
| `app/lib/pcb/fab/authority-store.ts` | Durable, digest-bound, server-owned release authority |
| `app/lib/pcb/autoplace/fit-outline.ts` | Deterministic board-outline sizing |
| `app/lib/physical-binding/atomic-binding.ts` | Stage 1 lifecycle driver for published atomic parts |
| `app/lib/atomic/value-key.ts` | Normalized component-value key |
| `drizzle/0026_parts_atomic_links.sql` | `parts` ↔ published atomic revision join |

The RC03 golden fixture now **delegates to the production router**, so
qualification evidence describes the code the product actually runs.

---

## 5. Exact user prompt

> Design a hand-solderable 5 V LED blinker using a 555 timer in astable mode at
> approximately 1 to 1.5 Hz. Use an SOIC-8 timer, 0805 resistors and capacitors,
> an 0805 LED, and a two-pin 2.54 mm through-hole power header. Include supply
> decoupling and a control-pin bypass capacitor. Make a compact two-layer PCB
> suitable for JLCPCB fabrication. Use only parts with exact verified symbols,
> footprints, pin-to-pad mappings, and physical package authority. Do not use a
> ground plane, high-speed rules, hidden connections, or unspecified connector
> footprints.

No netlist, component list or value was supplied by the user or the harness.

---

## 6. Provider evidence (no secrets)

| Field | Value |
|---|---|
| Provider | `anthropic` (server-side `ANTHROPIC_API_KEY`, never logged or returned) |
| Model | `claude-opus-4-7` (`SIRKIT_ANTHROPIC_MODEL` default) |
| Generation latency | 62.8 s – 172.3 s across runs (63.5 s median of accepted runs) |
| Schema validation | passed; `submit_schematic` tool call accepted first time on accepted runs |
| Correction loops | none required on the accepted runs |

The key value was never printed, moved to a `NEXT_PUBLIC_*` variable, committed,
or included in any response. The reranker (`claude-haiku-4-5`) and the OpenAI
embeddings dependency are discussed in §12.

---

## 7. Component and footprint authority

`scripts/seed-atomic-demo-parts.ts` publishes **21 exact orderable MPNs** through
the real atomic publication gates — no shim, no test override, `pcb_assignable`
profile:

- CAD assets parsed from the verbatim official KiCad libraries on disk
  (`parseSymbolAssets` / `parseFootprintAsset`), content-hashed.
- Real manufacturer-datasheet evidence records (`method: "manual"`, datasheet URL
  as locator); license recorded truthfully as CC-BY-SA-4.0 with the KiCad
  Libraries Exception.
- `provePackage` must reach `state: "proven"`; `buildMappingCertificate` must
  reach `state: "approved"` — the script aborts otherwise.
- Draft → needs_review → approved → published via `AtomicCatalog.transition`.

Parts published: TI `NE555DR` (SOIC-8), thirteen Yageo `RC0805FR-07…` 1 % resistors
(220 Ω – 470 kΩ), five Samsung `CL21B…` X7R MLCCs (1 nF – 10 µF), Lite-On
`LTST-C170KRKT` 0805 red LED, Würth `61300211121` 1×02 2.54 mm header.

**Per-instance bindings** cannot be pre-seeded (instance IDs are minted at layout
time), so `bind_atomic_selection` drives the ordinary Stage 1 lifecycle per
instance under the requesting human reviewer identity, with decision evidence
drawn from the atomic revision's own evidence records. Verified live:
footprint resolution returns `status: resolved`, `authorityClass: selected_stage1`,
with the exact atomic revision and zero blockers.

### Accepted-run component table (`e2e-ms6lpatj`)

| Ref | Value | MPN | Manufacturer | Package | Footprint |
|---|---|---|---|---|---|
| U1 | NE555 | `NE555DR` | Texas Instruments | SOIC-8 | `Package_SO:SOIC-8_3.9x4.9mm_P1.27mm` |
| J1 | 5V | `61300211121` | Würth Elektronik | 1×02 2.54 mm | `Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical` |
| D1 | red | `LTST-C170KRKT` | Lite-On | 0805 | `LED_SMD:LED_0805_2012Metric` |
| R1 | 22k | `RC0805FR-0722KL` | Yageo | 0805 | `Resistor_SMD:R_0805_2012Metric` |
| R2 | 47k | `RC0805FR-0747KL` | Yageo | 0805 | `Resistor_SMD:R_0805_2012Metric` |
| R3 | 330 | `RC0805FR-07330RL` | Yageo | 0805 | `Resistor_SMD:R_0805_2012Metric` |
| C1 | 10u | `CL21B106KOQNNNE` | Samsung Electro-Mechanics | 0805 | `Capacitor_SMD:C_0805_2012Metric` |
| C2 | 100n | `CL21B104KBCNNNC` | Samsung Electro-Mechanics | 0805 | `Capacitor_SMD:C_0805_2012Metric` |
| C3 | 10n | `CL21B103KBANNNC` | Samsung Electro-Mechanics | 0805 | `Capacitor_SMD:C_0805_2012Metric` |

All nine instances carried published atomic authority (`withAtomicAuthority: 9/9`).

---

## 8. Electrical verification

`scripts/verify-blinker-electrical.ts` reads the netlist the live run actually
produced, identifies the astable topology from connectivity, and computes
behaviour from first principles. It shares no code with Sirkit's own analysis.

**Topology confirmed:** pin 8 → +5 V, pin 1 → GND, pin 4 (RESET) tied high,
pin 5 (CONT) bypassed, R_A rail→DISCH, R_B DISCH→timing node, timing capacitor
timing-node→GND, LED driven from pin 3 through a series resistor.

**Accepted run (`e2e-ms6lpatj`): R_A = 22 kΩ, R_B = 47 kΩ, C = 10 µF**

| Quantity | Value |
|---|---|
| f nominal = 1.44 / ((R_A + 2·R_B)·C) | **1.2414 Hz** (requested 1–1.5 Hz) |
| t_high = 0.693·(R_A+R_B)·C | 478.2 ms |
| t_low = 0.693·R_B·C | 325.7 ms |
| Duty (high) | 59.48 % |
| Tolerance band (R ±1 %, C ±10 %) | 1.117 – 1.393 Hz |
| Incl. X7R temp drift (±15 %) | 0.983 – 1.672 Hz |
| LED current, Vf 1.9 V typ, V_OH 3.3 V, R 330 Ω | 4.24 mA |
| LED current, Vf 2.4 V max | 2.73 mA |
| R_LED dissipation | 5.94 mW of 125 mW (0805) |
| Timing-network dissipation | 0.36 mW |

`ELECTRICAL VERIFICATION: PASS` — evidence in
`scripts/output/electrical-e2e-ms6lpatj.json`.

**Method limitation, stated plainly.** This is deterministic closed-form analysis
of the 555 astable plus rating checks, **not** a SPICE transient simulation with a
vendor 555 model. The repository's SPICE path is a project-based studio requiring
a governed model registry entry for the NE555, which does not exist in this
catalog; rather than fabricate a model or a waveform, the calculation route
permitted by §4.3 of the stage prompt was used. No simulated waveform is claimed.

**A real design defect this caught.** An earlier accepted run chose R3 = 1 kΩ.
With a bipolar 555's true output-high (V_OH ≈ VCC − 1.7 V = 3.3 V) that yields
1.40 mA typical and **0.90 mA at worst-case Vf** — too dim to demonstrate. The
generator's design knowledge was corrected (both build prompts now state that an
LED driven from a timer/logic output must be sized from the loaded output-high
voltage, not the rail, targeting 3–8 mA; ≈220–470 Ω for a 5 V bipolar 555). This
is engineering guidance, not a gate relaxation.

---

## 9. Durable authority chain (accepted run `e2e-ms6lpatj`)

| Stage | Evidence |
|---|---|
| Project / design / board | `e2e-ms6lpatj` / `design:e2e-ms6lpatj` / `board:e2e-ms6lpatj` |
| Publication | snapshot revision 1, 9 components, 7 nets, `sourceDigest = pb1-139c20dd4e760db3aa97` |
| Preflight | `ready_to_apply`, plan `pcb-sync-plan:11d323fc45c0b5` |
| Apply | `applied`, committed board revision `pcb2-2e263c41f7303fb8` |
| Authoritative reload | revision `pcb2-2e263c41f7303fb8` verified, 9 footprints, 8 nets |
| RC02 | remaining connections **0**, shorts **0**, route-blocking DRC errors **0** |
| RC03 | `eligible`, profile `sirkit.autonomous-pcb-capability.v1`, post-layout |
| Routed board | revision `pcb2-9b2183320136d897` |
| MFG01 release | `mfg-release-afb31a91402c4cdd4ff845b4cd13a8d0` |
| Archive | 38 613 bytes, sha256 `13f3938dca65314d7c9fea5fe4ff51cd38b85362e483118b20f6ce2ae923023f` |
| Disposition | `verified_manufacturing_release` |

Qualification wall-clock: 19.9 s including real FreeRouting.

**Determinism A/B:** the same immutable authority released twice produced a
byte-identical archive (`13f3938dca65314d…` both times) — asserted in every run.

---

## 10. Three consecutive live runs

Product code was frozen before this sequence; each run began from a **fresh
project** with no manual edit.

| Run | Project | Components | Generation | Release sha256 (first 16) | A/B identical | Electrical |
|---|---|---:|---:|---|---|---|
| Final 1 | `e2e-ms6lv90d` | 9 | 85.4 s | `885b25753a9e7a66` | yes | PASS, 1.385 Hz |
| Final 2 | `e2e-ms6m1635` | 10 | 89.1 s | `992e2abe829e61be` | yes | PASS, 1.385 Hz |
| Final 3 | `e2e-ms6m71sg` | 9 | 73.8 s | `45479a477e5b40ff` | yes | PASS, 1.385 Hz |

All three completed every stage (`1-live-generation` … `8-determinism`) with no
manual edit, each from a fresh project, on frozen product code.

Earlier full-pipeline passes on the same engines: `e2e-ms6l0uhp` (first complete
run), `e2e-ms6l7p29`, `e2e-ms6lddmg`, `e2e-ms6lii2e`, `e2e-ms6lpatj`
(release candidate, electrical PASS at 1.2414 Hz).

**Cross-run comparison.** Topology was identical in every accepted run: pin 4
tied high, pin 5 bypassed, R_A rail→DISCH, R_B DISCH→timing node, timing
capacitor timing-node→GND, LED from OUT through a series resistor. Component
count was 9 in most runs and 10 in Final 2, which added a 10 µF bulk capacitor
alongside the 100 nF decoupler — a legitimate design choice, not a defect.

The model legitimately varies values within the seeded E-series — R_A ∈
{10 k, 22 k, 100 k}, R_B ∈ {47 k, 68 k, 470 k}, R_LED ∈ {220, 330, 470},
C_timing ∈ {1 µ, 10 µ} — and every accepted combination landed at 1.24–1.39 Hz
nominal, inside the requested 1–1.5 Hz, with LED current 2.7–6.4 mA across
typical and worst-case forward voltage.

Net identity, placement and route differ per run (different values, different
seeds), so archive hashes differ **between** runs; each individual authority is
byte-deterministic **within** itself, which is the property the stage requires.

**One verifier bug surfaced here and is worth recording.** Final 2 initially
reported an electrical failure (RESET floating, R_A/R_B/timing-capacitor not
found). Inspection of the netlist showed the *circuit was correct*: the run
referenced pins by name (`U1.DISCH`, `U1.THRES`) and used KiCad overbar notation
for active-low RESET (`U1.~{RST}`), while my checker assumed numeric pin
references and a plain `RST` alias. The checker now resolves every reference form
— number, name, and overbar-stripped name — to the canonical 555 pin number, and
all four runs pass. No product code was involved; recorded because a
false-negative in verification is as dangerous as a false-positive.

---

## 11. Independent verification

Two checkers that share **no code** with Sirkit, both using `gerbonara` 1.6.3
(third-party RS-274X/Excellon parser):

`scripts/verify-release-independent.py` — verified release archive:

```
layer set: copper_top, copper_bottom, mask_top, mask_bottom, outline, pth_drill, gerber_job  PASS
copper_top 93 objects, copper_bottom 4, mask_top 24, mask_bottom 2, silk_top 211, outline 4  PASS
outline nominal 21.00 x 21.00 mm, closed, 4 segments, no dangling endpoints                  PASS
plated drill: 3 holes, diameters [0.4, 1.0] mm, all >= 0.300 mm                              PASS
top copper inside outline; all holes inside outline; bottom copper shares the frame           PASS
INDEPENDENT VERIFICATION: PASS
```

`scripts/verify-manufacturer-zip.py` — manufacturer upload archive: all 8 files
byte-identical to the verified release **and** matching their release-manifest
SHA-256, every layer re-parsed from the delivered bytes, 3 holes inside a
21 × 21 mm outline. `MANUFACTURER UPLOAD VERIFICATION: PASS`.

**KiCad availability.** KiCad 10.0 is installed (`gerbview`, `kicad-cli`), but
`kicad-cli` has no Gerber-import validation subcommand and `gerbview` is GUI-only,
so `gerbonara` was used as the independent programmatic parser. This is one
independent mechanism, not two; see §14.

### Official manufacturer guidance consulted (2026-07-29)

- `jlcpcb.com/help/article/how-to-generate-gerber-and-drill-files-in-kicad-9`
- `jlcpcb.com/help/article/how-to-generate-gerber-files-in-different-software`

Confirmed against the emitted archive: **Protel filename extensions** (`.GTL`,
`.GBL`, `.GTS`, `.GBS`, `.GTO`, `.GML`) are the recommended KiCad convention —
Sirkit emits exactly these; drill in **millimetres, decimal format, absolute
origin** — matches; **board outline watertight/continuous** — independently
verified closed; **"Gerber files and the Drill file must be stored in the same
folder/archive"** — the manufacturer ZIP places all fabrication files together at
the archive root. RS-274X confirmed. Source CAD files are excluded.

---

## 12. Defects found and fixed

Every item below was a live failure reproduced on the running product, not a
hypothetical. Each is covered by a regression test in
`app/lib/pcb/__tests__/r05-e2e01-boundaries.test.ts` (16 tests).

**1. Billing exhaustion reported as a malformed request.**
`describeProviderFailure` collapsed distinct provider failures. Rebuilt with
`missing_credentials`, `authentication`, `insufficient_quota`, `model_access`,
`rate_limit`, `overloaded`, `bad_request`, `timeout`, `cancelled`, `network`,
plus a `retryable` flag and the provider's own bounded diagnostic. Anthropic's
nested `error.error.type` is now read correctly.

**2. Publication rejected every valid graph (`PS_SOURCE_DIGEST_MISMATCH`).**
The server digested its *canonicalized* graph while the builder digested its
arrays as constructed — components sorted by reference designator vs component
instance ID, pins unsorted vs sorted, members by pin vs by (component, pin).
Fixed by removing the duplicate definition: `canonicalPublicationGraph` +
`publicationSourceDigest` are now the single shared form, and
`canonicalAuthoritativeSnapshot` delegates to them.

**3. Apply could never succeed for a new board (`PS_BOARD_NAME_UNSAFE`).**
`revalidateForApply` passed `plan.scope.boardId` as the *board name*; the app's
own convention is `board:${projectId}`, and the safety pattern correctly rejects
colons. The plan's snapshot identity now carries `targetBoardName` from the
originating request, and revalidation reuses it. The gate was not weakened.

**4. RC03 evidence could never survive persistence (`MFG_RC03_RECOMPUTATION_MISMATCH`).**
`rulesDigest` and `evaluationDigest` used plain `JSON.stringify`, which is
key-order sensitive, but authority round-trips through Postgres `jsonb`, which
does not preserve key order. Proven: the same rules object hashed
`rules-8bbc546e` in memory and `rules-ea51f5c4` after persistence; under
`canonicalJson` both give `rules-35c4be20`. Both digests are now canonical.

**5. Drill file unparseable by a third-party CAM parser.**
A 1 mm tool emitted as `T02C1`. Under `METRIC` with no format statement a bare
integer is genuinely ambiguous (1 mm vs 1 µm under implied decimals), and
`gerbonara` refused the file outright — a board house could have misread the hole
size. Every tool diameter and coordinate now carries an explicit decimal point
(`C1.0`, `X40.0`).

**6. Boards released at the profile maximum, not compact.**
`createEmptyBoard` defaults to 100 × 80 mm — the capability-profile *maximum* —
and nothing sized it to the design, contradicting the requested "compact" board
and wasting fabrication area. Added deterministic outline fitting: candidates
derived from actual component courtyards, tried smallest-first, each screened for
capability and required to produce a fully legal, routed, verified layout, with
the original outline as final fallback. Result **21 × 21 mm** — an ≈18× area
reduction — still zero shorts and zero route-blocking DRC errors.

**7. Manufacturable parts were invisible to the generator.**
Direct inspection showed that for "0805 red LED", "2-pin 2.54 mm header" and
"555 timer SOIC-8", **not one** authority-backed part appeared in results — the
model was never offered a buildable option, which is why it chose real but
PCB-unready parts (`TSAL4400`, a 3 mm through-hole IR LED; `APFA3010`). Two
causes: verified-first ordering ran *after* the candidate trim, and verified parts
had no recall channel at all (with embeddings unavailable, a generic symbol named
`LED` loses on token overlap). Added a third recall stage for parts with published
exact-part authority, fused via the same RRF, ordered ahead of unverified
candidates, with `physicalAuthority` and `verifiedFootprint` surfaced to both the
reranker and the build prompts. Unlinked parts still fail closed at publication.

**8. A failed suggestion-tier source could block a valid authoritative resolution.**
`FR_ADAPTER_FAILED` was promoted to an unconditional blocker, defeating the
engine's kind-aware isolation (only a failed `selected_stage1_binding` should
block). Adapter lifecycle diagnostics are now excluded from that promotion.

**9. Every current-format KiCad footprint was rejected.**
`(embedded_fonts no)` — a KiCad 9+ presentational flag present in essentially
every modern file — was classed as unsupported semantics. Only an actual embedded
font payload (`embedded_fonts yes`) is unsupported now; `zone`, `keepout`,
`group` and `net_tie_pad_groups` still are.

**10. Parts search hard-failed when the embeddings provider was unavailable.**
Embeddings are hard-pinned to OpenAI (out of quota). Both the AI tool path and the
browse route now degrade to tokenized lexical recall with a warning instead of
failing the request. Every selected `partId` is still re-validated downstream, so
degraded recall cannot fabricate a part.

**11. Connection-pool exhaustion took down all queries.**
The `postgres` client had no `max`, so concurrent handlers drained Supabase's
15-client session pooler and *every* query failed with `EMAXCONNSESSION`. Pool
bounded to 8 with idle recycling; per-component binding writes made sequential.

**12. A brittle migration test blocked any new migration.**
`schema-integrity.test.ts` asserted `entries.at(-2)` to claim "0025 is newest",
breaking the moment `0026` was added. Rewritten to assert 0025's position
*relative to itself*, preserving the 0024 → 0025 ordering guarantee.

**13. Frozen fixture debt (pre-existing, ~14 failures).**
Missing `decisionEvidenceRefs` on select/approve transitions and a real-time clock
in a fixture whose plans expire. Both repaired properly rather than skipped.

---

## 13. Quality gates

| Gate | Result |
|---|---|
| TypeScript (`tsc --noEmit`, whole project) | **PASS**, zero diagnostics |
| ESLint (all files changed this stage) | **PASS**, zero errors, zero warnings |
| Focused suites (26 files: pcb-sync, readiness, footprint-resolver, physical-binding, atomic, fab, pcb-sync-authority, R05-E2E01 boundaries) | **248 passed**, 7 skipped, **0 failed** |
| MFG01 golden release gate | **PASS** (5 tests) |
| RC03 golden qualification (three real FreeRouting runs) | **PASS** (5 tests) |
| Independent Gerber verification (gerbonara) | **PASS** |
| Independent manufacturer-ZIP verification | **PASS** |
| Independent electrical verification | **PASS** |

Skipped tests are the pre-existing isolated-PostgreSQL suites that require a
disposable container, not part of this stage's authorization.

**Not claimed:** the entire repository test suite is not asserted green. Broad
historical sweeps still contain fixture debt outside this stage's scope, and no
claim is made beyond the focused suites listed above.

---

## 14. Known limitations

1. **No SPICE transient simulation.** Closed-form astable analysis plus rating
   checks were used (§8). No vendor 555 model exists in the governed registry;
   no waveform is claimed.
2. **One independent parser, not two.** `gerbonara` is the single external
   mechanism; `kicad-cli` offers no Gerber-import validation and `gerbview` is
   GUI-only. A second parser (Gerbv, tracespace) would strengthen this.
3. **Browser E2E was not the acceptance vehicle.** The UI path was exercised
   manually to reproduce the baseline failure and verify error surfacing, but the
   accepted runs were driven server-side through the same HTTP endpoints the UI
   calls, because Node's `fetch` (undici) enforces a 300 s headers timeout that
   aborts legitimate multi-minute generation. Visual screenshot evidence of the
   full routed board in the browser is **not** included.
4. **Assembly output is blocked by design.** Bare-board only. No BOM, CPL or
   paste layer is in the release; assembly authority was never established.
5. **Demo-transport identity.** `x-sirkit-*` headers remain unauthenticated
   assertions (`R02-B1-011` open). Any caller can claim `project_admin`. Not
   production identity.
6. **Both provider keys are load-bearing.** Anthropic drives generation and
   reranking; OpenAI is still the fixed embeddings provider. With OpenAI out of
   quota, retrieval runs in lexical-only mode — functional, but semantic recall is
   degraded.
7. **Outline fitting is bounded.** Candidates are derived from courtyard area with
   a square-ish aspect; it does not optimize for routability, thermal or EMC. It
   proposes, and placement legality plus full routing decide.
8. **Seeded catalog is narrow.** 21 MPNs cover this circuit class. A different
   design will meet `PS_SYMBOL_ASSET_REQUIRED` until its parts are published —
   correct fail-closed behaviour, not a silent guess.
9. **Value-key matching is conservative.** A value outside the seeded E-series
   finds no link and fails closed rather than snapping to a near neighbour.

---

## 15. Deliverables

Under `scripts/output/`:

| Artifact | File |
|---|---|
| Sirkit verified release archive | `sirkit-verified-release-e2e-ms6lpatj.zip` (38 613 B, sha256 `13f3938d…23023f`) |
| Manufacturer upload archive | `manufacturer-upload-e2e-ms6lpatj.zip` (fabrication only, flattened, byte-identical) |
| Prototype BOM | `deliverables-e2e-ms6lpatj/prototype-bom.md` and `.csv` |
| Assembly guide | `deliverables-e2e-ms6lpatj/assembly-guide.md` |
| Bring-up and test procedure | `deliverables-e2e-ms6lpatj/bring-up-procedure.md` |
| Fabrication order notes | `deliverables-e2e-ms6lpatj/fabrication-order-notes.md` |
| Deliverable index with hashes | `deliverables-e2e-ms6lpatj/README.md` |
| Per-run acceptance evidence | `e2e-<projectId>.json` |
| Generated netlists | `netlist-<projectId>.json` |
| Electrical evidence | `electrical-e2e-ms6lpatj.json` |
| Atomic authority manifest | `atomic-demo-manifest.json` (21 published MPNs) |

**Release-candidate selection.** `e2e-ms6lpatj` was chosen because it is the run
whose electrical verification passes with the widest margin: R_LED = 330 Ω gives
4.24 mA typical and 2.73 mA at worst-case Vf (comfortably visible), and its
1.2414 Hz nominal sits mid-band with a 1.117–1.393 Hz tolerance spread that stays
inside the requested 1–1.5 Hz even before temperature drift. Runs choosing
R_LED = 1 kΩ were rejected on LED-current grounds.

The prototype BOM is **not** a qualified JLCPCB assembly package: no BOM/CPL is
in the upload archive, no population authority exists, and assembly is by hand.

---

## 16. Reproduction

```bash
# once: publish exact atomic authority for the demo part set
pnpm exec tsx scripts/seed-atomic-demo-parts.ts

# full acceptance run (fresh project, live provider, no manual edit)
pnpm exec tsx scripts/e2e-prompt-to-gerber.ts

# independent verification of the produced archive
python scripts/verify-release-independent.py scripts/output/sirkit-verified-release-<id>.zip

# electrical verification of the generated circuit
pnpm exec tsx scripts/verify-blinker-electrical.ts <id>

# manufacturer upload archive + its independent verification
python scripts/make-manufacturer-zip.py scripts/output/sirkit-verified-release-<id>.zip
python scripts/verify-manufacturer-zip.py scripts/output/manufacturer-upload-<id>.zip scripts/output/sirkit-verified-release-<id>.zip

# prototype deliverables
pnpm exec tsx scripts/make-prototype-deliverables.ts <id>
```

Requires `.env.local` with `ANTHROPIC_API_KEY`, `DATABASE_URL`, and
`SIRKIT_PCB_SYNC_STAGE3=authoritative_safe_profile` (now documented in
`.env.example`), plus the bundled FreeRouting runtime
(`pnpm run setup:freerouting`).

---

## 17. Changed-file inventory

**New production code**

| File | Lines | Why |
|---|---|---|
| `app/api/pcb/qualify/route.ts` | 231 | Autonomous qualification endpoint + authority persistence |
| `app/api/pcb/release/route.ts` | 69 | MFG01 verified release endpoint |
| `app/lib/pcb/autonomous/production-router.ts` | 64 | Real FreeRouting executor lifted from a test fixture |
| `app/lib/pcb/fab/authority-store.ts` | 94 | Durable server-owned release authority |
| `app/lib/pcb/autoplace/fit-outline.ts` | 80 | Deterministic outline sizing |
| `app/lib/physical-binding/atomic-binding.ts` | 217 | Stage 1 lifecycle driver for atomic parts |
| `app/lib/atomic/value-key.ts` | 22 | Normalized value key |
| `drizzle/0026_parts_atomic_links.sql` | 22 | `parts` ↔ atomic revision join |

**Modified production code**

| File | Change |
|---|---|
| `app/lib/llm/errors.ts` | Rebuilt provider failure classification (defect 1) |
| `app/lib/pcb-sync/stable.ts` | Shared `canonicalPublicationGraph` / `publicationSourceDigest` (defect 2) |
| `app/lib/pcb/netlist-bridge.ts` | Unified stable-net-ID scheme; canonical source digest |
| `app/lib/pcb-sync/types.ts`, `plan.ts`, `service.ts` | `targetBoardName` through plan → revalidation (defect 3) |
| `app/lib/pcb/autonomous/capability-profile.ts` | Canonical, persistence-invariant digests (defect 4) |
| `app/lib/pcb/fab/native/drill.ts` | Explicit decimal points in Excellon output (defect 5) |
| `app/lib/parts-search.ts` | Authority recall channel, `physicalAuthority`, graceful embedding degradation (defects 7, 10) |
| `app/api/parts/search/route.ts` | Tokenized lexical fallback (defect 10) |
| `app/api/parts/[id]/route.ts` | Serves `atomicAssignments` |
| `app/lib/prompts.ts` | Verified-part preference; LED drive-current guidance (§8) |
| `lib/build-auto-layout.ts` | Copies atomic authority onto generated instances |
| `app/components/pcb/PcbEditor.tsx` | Ensures Stage 1 bindings before publication (sequential) |
| `app/lib/footprint-resolver/validation.ts` | Adapter lifecycle isolation (defect 8) |
| `app/lib/atomic/kicad-assets.ts` | `embedded_fonts` benign-flag handling (defect 9) |
| `app/lib/db/client.ts` | Bounded connection pool (defect 11) |
| `app/lib/db/schema.ts` | `partsAtomicLinks` table |
| `.env.example` | Documents `SIRKIT_PCB_SYNC_STAGE3` |

**Tests and fixtures**

| File | Change |
|---|---|
| `app/lib/pcb/__tests__/r05-e2e01-boundaries.test.ts` | New — 16 regression tests, one per repaired boundary |
| `app/lib/pcb/__tests__/fixtures/autonomous-golden-board.ts` | Delegates to the production router |
| `app/lib/footprint-resolver/__tests__/fixtures.ts` | Decision evidence on select/approve (defect 13) |
| `app/lib/pcb-sync/__tests__/fixtures.ts` | Fixed trusted clock (defect 13) |
| `app/lib/physical-binding/__tests__/schema-integrity.test.ts` | Migration ordering assertion (defect 12) |

**Tooling** — `scripts/seed-atomic-demo-parts.ts`, `e2e-prompt-to-gerber.ts`,
`verify-release-independent.py`, `verify-manufacturer-zip.py`,
`make-manufacturer-zip.py`, `verify-blinker-electrical.ts`,
`make-prototype-deliverables.ts`.

---

## 18. Next owner action

1. Open `scripts/output/manufacturer-upload-e2e-ms6lpatj.zip` in JLCPCB's own
   Gerber viewer and confirm the layer mapping, the closed 21 × 21 mm outline,
   and the three drilled holes (two 1.0 mm, one 0.40 mm).
2. Work through the pre-order checklist in
   `deliverables-e2e-ms6lpatj/fabrication-order-notes.md`.
3. If the CAM/DFM review is clean, **explicitly approve** upload and ordering —
   2-layer FR-4, 1.6 mm, 1 oz copper, HASL or ENIG, quantity 5.
4. On receipt, hand assemble one board per `assembly-guide.md`, then follow
   `bring-up-procedure.md` with a current-limited 5 V supply.
5. Record measured frequency, duty and supply current; only then may any physical
   hardware claim be made.

---

```text
R05-E2E01 VERDICT: COMPLETE
LIVE OPENAI REQUEST: NOT APPLICABLE (owner override to Anthropic; live Anthropic request PASS)
LIVE SCHEMATIC GENERATION: PASS
EXACT COMPONENT/FOOTPRINT AUTHORITY: PASS
SCHEMATIC ERC/RULE VALIDATION: PASS
DURABLE PCB PUBLICATION/APPLY/RELOAD: PASS
RC01 PARITY: PASS
AUTONOMOUS V1 ELIGIBILITY: PASS
NO-EDIT PLACEMENT: PASS
REAL FREEROUTING: PASS
REMAINING CONNECTIONS: 0
SHORTS: 0
ROUTE-BLOCKING DRC ERRORS: 0
RC03 FINAL QUALIFICATION: PASS
MFG01 VERIFIED RELEASE: PASS
INDEPENDENT GERBER/DRILL VALIDATION: PASS
THREE CONSECUTIVE LIVE RUNS: PASS
DETERMINISTIC RELEASE A/B: PASS
MANUFACTURER UPLOAD ZIP READY: YES
PROTOTYPE BOM READY: YES
ASSEMBLY GUIDE READY: YES
BRING-UP PROCEDURE READY: YES
MANUFACTURER UPLOAD PERFORMED: NO
PCB ORDER PLACED: NO
PHYSICAL HARDWARE VALIDATED: NO
R04D FINAL QUALIFICATION: NOT AUTHORIZED
NEXT OWNER ACTION: Independently CAM/DFM-review scripts/output/manufacturer-upload-e2e-ms6lpatj.zip, then explicitly approve upload and ordering (2-layer FR-4, 1.6 mm, 1 oz, HASL/ENIG, qty 5).
REPORT: artifacts/prompt-to-gerber/r05-e2e01-report.md
```
