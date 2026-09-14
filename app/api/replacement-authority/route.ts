/**
 * B14 §E / B14.1 §C / B16.0.3 §A — the same-origin replacement REAUTHORIZATION
 * endpoint.
 *
 * READ/PROVE ONLY. It derives fresh server-owned component authority and
 * published pin facts from durable sources, returns an allowlisted bounded
 * result, and never mutates the schematic (it executes no command, opens no
 * session, writes nothing).
 *
 * [B16.0.3 §A] AUTHENTICATION FIRST. Independent verification (B16.0.3 R1)
 * found this route reached component-authority source resolution with NO
 * authentication — an anonymous same-origin caller got a 503, not a 401. That
 * is closed here: the ONE shared authorization boundary runs FIRST and
 * completes — authentication, active project membership, the exact permitted
 * role (editor class), and exact-origin CSRF — BEFORE the request body is
 * consumed and BEFORE any component-authority source is resolved or any
 * authority/pin-fact read is issued. An anonymous same-origin request → 401;
 * a cross-origin request → 403; a disallowed role → 403; a foreign / revoked
 * / missing project membership → 403; all before the body and before any
 * durable read.
 *
 * [B16.0.22] CANONICAL WRAPPER ADOPTION. The boundary above now runs inside
 * `authenticatedJsonRoute` (authorization → media type → bounded 16,384-byte
 * / 10 s streaming read → object requirement), with the EXACT historical
 * B14.2/B14.3 refusal envelopes preserved through the declarative
 * `legacyReaderRefusals: "replacement-authority-v1"` contract (plain
 * `{ ok:false, error }` bodies; a stalled stream settles 408 at the read
 * deadline; a client abort settles 408; over-limit settles 413; no durable
 * authority loader or pin-fact reader runs after an incomplete, aborted,
 * timed-out, or oversized request). The callback never sees the raw Request:
 * the abort signal reaches the durable loaders ONLY through the declared
 * `exposeAbortSignal` input.
 *
 * SCOPE DISPOSITION [B16.0.3 §A, supersedes B14.1 §C's local-only note]: the
 * tenant, project and branch are now DERIVED EXCLUSIVELY from
 * `TrustedRequestContext` (the project selector headers verified against the
 * authenticated session's membership), never from local constants and never
 * from the request body. A `scope` field MAY still appear in the body as an
 * OPTIONAL post-authentication locator CROSS-CHECK — if present it must
 * byte-match the trusted scope (a mismatch is refused, 403), and it NEVER
 * selects data: every durable read uses the trusted scope exclusively. The
 * response `binding.scope` echoes the trusted scope so the channel can verify
 * the server operated on its exact project.
 *
 * Browser asset identities are refused: the TARGET identity is derived
 * exclusively from the durable authority record's exactAuthority block — the
 * request cannot name target assets. The only browser-supplied identifier
 * consumed is `currentAtomicPartRevisionId`, a PUBLISHED-FACTS LOOKUP KEY for
 * the component currently on the canvas; the returned facts are server truths
 * about that published revision and grant nothing (the apply path's
 * deterministic recompile + digest byte-match + fresh runtime grant are the
 * authority chain). Provider/model code never calls this endpoint — only the
 * private trusted UI adapter does, and only IT can turn a response into the
 * runtime capability path.
 */

import { loadRunComponentAuthority } from "@/app/lib/engineering/component-authority-source";
import { resolveComponentAuthoritySource } from "../chat/component-authority-runtime";
import { DEFAULT_PIN_FACTS_DEADLINE_MS, loadRunReplacementPinFacts, resolveReplacementPinFactsSource } from "../chat/replacement-facts-runtime";
import { pcbBoardInstanceId, PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH } from "@/app/lib/pcb/board-identity";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/;
/** [B14.2 §C] the platform-random correlation nonce (32–128 hex/word chars). */
const NONCE_PATTERN = /^[A-Za-z0-9]{16,128}$/;
const MAX_BODY_BYTES = 16_384;
/** [B14.3 §B] the HARD deadline on receiving the request body: a request
 *  stream that never emits its first chunk (or trickles forever) settles
 *  with a deterministic 408 within this bound — the handler can never hang
 *  on the bounded reader. */
const REQUEST_READ_DEADLINE_MS = 10_000;

export const POST = authenticatedJsonRoute(
  {
    maxBytes: MAX_BODY_BYTES,
    deadlineMs: REQUEST_READ_DEADLINE_MS,
    legacyReaderRefusals: "replacement-authority-v1",
    exposeAbortSignal: true,
  },
  async ({ context, body, signal }) => {
    // The trusted, server-derived scope is the ONLY authority: tenant/project/
    // branch come from TrustedRequestContext, never from local constants and
    // never from the request body. Authorization, exact-origin CSRF, media
    // type, and the bounded streaming read have already completed in the
    // wrapper — every refusal returned there, before any durable read.
    const trustedScope = { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
    for (const key of Object.keys(body)) {
      if (!["scope", "componentInstanceId", "currentAtomicPartRevisionId", "nonce"].includes(key)) {
        return Response.json({ ok: false, error: `unexpected request key "${key.slice(0, 40)}" — browser-supplied authority and asset identities are refused` }, { status: 400 });
      }
    }
    // [B14.2 §C] the correlation nonce is REQUIRED and well-formed. It binds
    // this response to this request (echoed below) — correlation/replay defence
    // for the exchange, never server authentication.
    const nonce = body.nonce;
    if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
      return Response.json({ ok: false, error: "a well-formed request nonce is required" }, { status: 400 });
    }
    // [B16.0.3 §A] body.scope is an OPTIONAL post-authentication locator
    // CROSS-CHECK only. If present it must be well-formed AND byte-match the
    // trusted scope; it NEVER selects data. A smuggled scope (differing from the
    // authenticated project) is refused 403.
    if ("scope" in body) {
      const scope = body.scope;
      if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
        return Response.json({ ok: false, error: "scope must be an object" }, { status: 400 });
      }
      const scopeRecord = scope as Record<string, unknown>;
      for (const key of Object.keys(scopeRecord)) {
        if (!["tenantId", "projectId", "branchId"].includes(key)) {
          return Response.json({ ok: false, error: `unexpected scope key "${key.slice(0, 40)}"` }, { status: 400 });
        }
      }
      if (scopeRecord.tenantId !== trustedScope.tenantId
        || scopeRecord.projectId !== trustedScope.projectId
        || scopeRecord.branchId !== trustedScope.branchId) {
        return Response.json({ ok: false, error: "the request scope does not match the authenticated project scope" }, { status: 403 });
      }
    }
    const componentInstanceId = body.componentInstanceId;
    if (typeof componentInstanceId !== "string" || !ID_PATTERN.test(componentInstanceId)) {
      return Response.json({ ok: false, error: "componentInstanceId must be a well-formed identifier" }, { status: 400 });
    }
    const currentAtomicPartRevisionId = body.currentAtomicPartRevisionId;
    if (currentAtomicPartRevisionId !== null && (typeof currentAtomicPartRevisionId !== "string" || !REVISION_PATTERN.test(currentAtomicPartRevisionId))) {
      return Response.json({ ok: false, error: "currentAtomicPartRevisionId must be null or a bounded identifier" }, { status: 400 });
    }

    // Fresh SERVER-OWNED authority for exactly this component (fail closed). The
    // scope handed to the loader is the TRUSTED context scope — never a body
    // field. Authorization has already completed above.
    const source = resolveComponentAuthoritySource(trustedScope);
    if (!source) {
      return Response.json({ ok: false, error: "no durable authority source is configured" }, { status: 503 });
    }
    const authority = await loadRunComponentAuthority(source, {
      scope: { ...trustedScope, boardInstanceId: pcbBoardInstanceId(trustedScope.projectId) },
      canonicalRevision: "replacement-reauthorization",
      componentInstanceIds: [componentInstanceId],
      hierarchyPath: PCB_BOARD_HIERARCHY_PATH,
      assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID,
      signal,
    });
    if (!authority) {
      return Response.json({ ok: false, error: "fresh component authority could not be resolved" }, { status: 503 });
    }

    // The TARGET revision is derived SERVER-SIDE from the durable record.
    const record = authority.records.find((candidate) => candidate.componentId === componentInstanceId);
    const targetRevisionId = record?.exactAuthority?.atomicPartRevisionId ?? null;
    const factsSource = resolveReplacementPinFactsSource();
    // [B19-E E5] the target only if selectable; the current revision (the one being left) whatever was withdrawn since (OD-38)
    const targetPinFacts = targetRevisionId ? await loadRunReplacementPinFacts(factsSource, targetRevisionId, signal, DEFAULT_PIN_FACTS_DEADLINE_MS, "target") : null;
    const currentPinFacts = currentAtomicPartRevisionId ? await loadRunReplacementPinFacts(factsSource, currentAtomicPartRevisionId, signal, DEFAULT_PIN_FACTS_DEADLINE_MS, "current") : null;

    // Allowlisted bounded result — records/candidates are already the allowlisted
    // authority projection; pin facts are the §B projection. [B14.2 §C]
    // `binding` echoes the EXACT request nonce plus the component locator and the
    // TRUSTED scope, so the channel can correlate this response to its own
    // request and verify the server operated on its exact project before
    // accepting any facts.
    return Response.json({
      ok: true,
      records: authority.records,
      candidates: authority.candidates,
      currentPinFacts,
      targetPinFacts,
      binding: { nonce, componentInstanceId, scope: trustedScope },
    }, { headers: { "Cache-Control": "no-store" } });
  });
