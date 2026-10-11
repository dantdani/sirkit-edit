# B24-F - Provider security report

Labels: **CONFIRMED** (read at the cited file:line at `58c0834`, or executed and measured), **INFERRED** (a reading, nothing executed),
**RECORDED** (taken from a record without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the
owner has not supplied; never faked, never claimed). Base: `58c0834`. Every external party Sirkit can reach, by registry, with the
controls between it and Sirkit; the generated `trust-boundary-map.md` sections 3 and 4 hold the same lists, derived from the tree.

## 1. Model providers (OpenAI, Anthropic)

- **Two providers**, `openai` and `anthropic` (`app/lib/llm/types.ts:1`). Six production modules import a provider SDK, as
  `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts:91` pins them: `app/lib/agent/adapters.ts`, `app/lib/embeddings.ts`,
  `app/lib/evaluation/live-contract-clients.ts`, `app/lib/llm/anthropic-provider.ts`, `app/lib/llm/openai-provider.ts` and
  `app/lib/parts-search.ts` (six since B24-B3; five at `f663d71`). **CONFIRMED** (`trust-boundary-map.md` section 3 derives the same six).
- **Configuration** (D24-10, OD-199): every SDK client Sirkit builds is in the digested `sirkit.deployment-configuration.v1` record with
  its timeout and retries; `/api/ai/runtime` reports what the clients send; an empty or padded Anthropic model is refused, never sent
  (`b24-a1-configuration`). **CONFIRMED** by B24-A1's suites.
- **Spend** (D24-8, D24-18, D24-23; OD-197, OD-209, OD-216): the two public embedding searches meet per-process windows and the
  embedding meter before any provider call (`artifacts/ai-control-plane-b24/abuse-controls.md:36`, `:161`); authenticated spend meets
  per-principal windows (`abuse-controls.md` section 15); the record-only live command refuses to run without an owner price table and
  a money cap; recorded usage is priced through the one price table, `unpriced` while `MODEL_PRICE_TABLE` is null. **CONFIRMED** offline.
- **Records** (D24-20, D24-21): one `sirkit.llm-call-record.v1` per provider call on the 22 model-calling paths other than `/api/chat`
  (`b24-c1-llm-call-record`), holding no prompt or model text (OD-207), and the chat run's trace kept durably
  (`b24-c1-durable-trace`).
- **Live**: BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7, LB-9; the matrix's Q1 and Q15). On 2026-09-24 OpenAI answered 429 no credits for
  both configured keys (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md:2508-2509`), recorded `failing` in Q1.

## 2. Component distributors (B19's source registry)

| source | status (`SOURCE_REGISTRY`, `app/lib/acquisition/source-registry.ts:532`) |
|---|---|
| digikey | enabled: admitted only with its credential names set; with none, `admitSource("digikey", {})` refuses `credentials_missing` (`app/lib/acquisition/source-registry.ts:568`) |
| mouser | disabled (its terms; OD-32) |
| octopart | enabled: the same credential rule |
| lcsc | blocked |

Every distributor call goes through one bounded egress path (HTTPS only, exact-host allowlists from the registry, every resolved
address checked, one deadline, bounded reads; B19-B), per-source quotas and breakers, and the quarantine pipeline: an observation is
never engineering authority. No purchase path exists (`b19-e-no-purchase-tripwire`). The live distributor contract is
BLOCKED-LIVE-QUALIFICATION (LB-15; the matrix's Q3).

## 3. Manufacturing and quote providers (B23's registry)

The registry holds nine rows (`artifacts/ai-control-plane-b23/provider-registry.csv`, byte-pinned): five manufacturers and four
distributors, each operation with its tier, channel and state. No provider is admitted: every DFM and quote operation is refused
`provider_not_admitted`, no reviewed transfer descriptor exists (`PROVIDER_TRANSFER_DESCRIPTORS` is empty,
`app/lib/manufacturing-providers/provider-egress.ts:69`), and the one `externalTransfer` route, `POST /api/pcb/provider-exchange`, is a
human project administrator's preview and commit whose commit is refused before anything leaves Sirkit. Ordering stays visibly
disabled: `ORDERING_OWNER_RECORD === null` and `ORDER_SUBMISSION_PORT_WIRING === "none"`
(`app/lib/manufacturing-providers/ordering-enablement.ts:36`, `:39`). Live DFM/quote exchange and an ordering sandbox are
BLOCKED-LIVE-QUALIFICATION (LB-11, LB-12; the matrix's Q5).

## 4. The edge: headers, origins, secrets (B24-A2)

- **Headers** (D24-5, OD-196): six security headers on every path from one pure builder, `poweredByHeader: false`, HSTS only for an
  https origin, the script and connect policy shipped report-only (`artifacts/ai-control-plane-b24/edge-security.md:27`); the served
  headers are asserted by `e2e/security-headers.spec.ts`, which page-browser-e2e runs (green on B24-D4's run, the lead's reading);
  a hosted edge is LB-13's.
- **Origins** (D24-6): the Supabase Site URL and the one redirect, `<origin>/api/auth/callback`, per environment (`edge-security.md:80`);
  verified only in staging (LB-1, LB-13).
- **Secrets** (D24-4, OD-195): the worker secret, the KiCad library token and the MCP signing key each take a previous value that only
  verifies; every environment name the code reads is in the census with `.env.example` parity over the declared classes
  (`edge-security.md:108`, `:157`); the secret scan, `scripts/scan-secrets.ts`, runs in CI over the tree and, with `--history <range>`,
  over a commit range (`edge-security.md:214`; the history-only allowlist entries, `edge-security.md:694`). No real secret was rotated
  and no `.env*` value was read by any increment (names only).

## 5. What stays open (INFERRED)

- Every limit is per process (OD-197): a second server process holds its own windows (`abuse-controls.md:65`).
- The secret scan finds the shapes its rules name; a secret of another shape is not seen. `SECRETS EXPOSED` for main's history is
  measured at the closeout with the same scanner's `--history` mode (`open-risks-and-owner-decisions.md` section 2.6).
