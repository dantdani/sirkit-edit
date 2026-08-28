/**
 * B15.3 §H — the ONE agent-facing handler for `sirkit.pcb.propose-bounded-edit`.
 *
 * This is the file the standing B15.2.2 §C tripwire names: it imports and
 * calls `createSealedPcbEditProposal` ONLY — never the raw internal sealer
 * (the raw-sealer allowlist stays at exactly two modules).
 *
 * SECURITY CONTRACT (non-negotiable):
 *  - Provider arguments may contain ONLY the bounded `intent` and
 *    `operations`. Unknown keys refuse — a provider can never submit a
 *    board, candidate board, DRC result, impact certificate, authority
 *    claim, scope, revision, history mark, lineage, approval tier, digest,
 *    or validation result, because no such parameter exists and any extra
 *    key is refused by name.
 *  - EVERY authority-bearing field is derived here from the validated run
 *    context and the run's sealed canonical-state resource: the board comes
 *    from the verified canonical project state, the scope from run identity
 *    plus the shared `pcbBoardInstanceId` authority, the history basis and
 *    lineage from the shape-validated `pcbProposalBasis` the editor bridge
 *    captured atomically with the board, and the validation policy from the
 *    canonical in-repo preset registry via the sealing service.
 *  - Invocation NEVER mutates PCB state: the service compiles against an
 *    isolated structuredClone candidate and seals an artifact. Apply
 *    authority stays behind the human-gated PCB approval boundary.
 */

import { engineeringDigest } from "../../engineering/stable";
import { pcbBoardInstanceId } from "../board-identity";
import type { AgentRunContext } from "../../agent/contracts";
import { createSealedPcbEditProposal } from "./pcb-edit-proposal-service";
import type { SealedPcbEditProposal } from "./sealed-pcb-edit-proposal";

export interface PcbProposeToolInput {
  /** Raw provider arguments (post JSON parse). Strictly closed here. */
  args: Record<string, unknown>;
  context: AgentRunContext;
  /** The run's sealed canonical-state resource pin — SERVER-derived by the
   *  gateway from the verified resource bundle, never provider data. */
  canonicalResource: { resourceId: string; contentDigest: string };
  provider: string;
  runId: string;
  /** Platform-random proposal nonce minted by the gateway. */
  nonce: string;
  now: number;
}

export type PcbProposeToolOutcome =
  | { status: "sealed"; proposal: SealedPcbEditProposal }
  | { status: "blocked"; blockers: Array<{ code: string; detail: string }> }
  | { status: "refused"; failure: string; diagnostics: string[] };

const ALLOWED_ARG_KEYS = ["intent", "operations"] as const;

export function handlePcbProposeTool(input: PcbProposeToolInput): PcbProposeToolOutcome {
  // 1. STRICT closed argument surface — exactly {intent, operations}.
  for (const key of Object.keys(input.args)) {
    if (!(ALLOWED_ARG_KEYS as readonly string[]).includes(key)) {
      return {
        status: "refused",
        failure: "invalid_input",
        diagnostics: [`Unexpected argument "${key.slice(0, 40)}" — the bounded PCB proposal accepts only intent and operations. Boards, rules, scopes, revisions, digests, impact reports, and authority claims are never accepted from the provider.`],
      };
    }
  }
  if (input.args.intent === undefined || input.args.operations === undefined) {
    return { status: "refused", failure: "invalid_input", diagnostics: ["Both intent and operations are required."] };
  }

  // 2. The VERIFIED canonical board is required (authority-unavailable
  //    refuses truthfully; nothing is fabricated).
  const board = input.context.canonicalState?.pcb;
  if (!board || !input.context.canonicalRevisionDigest) {
    return { status: "refused", failure: "authority_unavailable", diagnostics: ["No complete validated canonical PCB board exists for this run; the PCB proposal tool is unavailable."] };
  }

  // 3. The PCB history BASIS (canonical head + lineage + active DRC preset)
  //    is required — without it the proposal cannot be scope-sealed.
  const basis = input.context.pcbProposalBasis;
  if (!basis) {
    return { status: "refused", failure: "authority_unavailable", diagnostics: ["No verified PCB history basis (canonical head, lineage, active DRC preset) is available for this run; the PCB proposal tool is unavailable until the PCB editor session is ready."] };
  }

  // 4. Seal through the ONE high-level service. The payload carries ONLY the
  //    provider's bounded intent/operations; everything else is trusted
  //    context derived above.
  const created = createSealedPcbEditProposal({
    payload: { intent: input.args.intent, operations: input.args.operations },
    board,
    validationPolicy: { presetId: basis.activeDrcPresetId },
    scope: {
      tenantId: input.context.tenantId,
      projectId: input.context.projectId,
      branchId: input.context.branchId,
      boardInstanceId: pcbBoardInstanceId(input.context.projectId),
    },
    base: {
      canonicalResource: { resourceId: input.canonicalResource.resourceId, contentDigest: input.canonicalResource.contentDigest },
      historyHead: { sequence: basis.historyHeadSequence, label: basis.historyHeadLabel },
      lineageId: basis.lineageId,
    },
    actor: { actorId: `agent:${input.provider}`, kind: "ai" },
    effectiveActor: { actorId: input.context.actor.actorId, kind: "human" },
    // [B16.0.1 §E] bind the verified membership revision the actor's role was
    // resolved at (Section D threads it onto context.actor). The apply-time
    // reauthorization (§F) compares this against the LIVE membership, so a
    // later revocation/downgrade/revision-change refuses the apply.
    authorization: {
      membershipRevision: input.context.actor.membershipRevision ?? "membership:unverified",
      requiredApplyRole: "pcb_editor",
    },
    discovery: {
      digest: engineeringDigest({
        schema: "sirkit.pcb-proposal-discovery.v1",
        actorId: input.context.actor.actorId,
        tenantId: input.context.tenantId,
        projectId: input.context.projectId,
        branchId: input.context.branchId,
        revision: input.context.canonicalRevisionDigest,
        lineageId: basis.lineageId,
      }),
      contextDigest: input.context.canonicalRevisionDigest,
    },
    provenance: { provider: input.provider, model: "agent-tool-loop", runId: input.runId },
    nonce: input.nonce,
    now: input.now,
  });

  if (created.ok) return { status: "sealed", proposal: created.proposal };
  if (created.code === "invalid-validation-policy") {
    return { status: "refused", failure: "authority_unavailable", diagnostics: [created.detail] };
  }
  // Bounded-compile refusals are STRUCTURED blockers (drc-regression,
  // escapes-board, excluded intent, …) — surfaced truthfully, zero mutation.
  return { status: "blocked", blockers: [{ code: created.code, detail: created.detail }] };
}
