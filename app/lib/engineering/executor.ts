/**
 * B02 — canonical executor kernel.
 *
 * Adapts the Stage 10 `EngineeringTransactionService` into the ONE execution
 * surface future stages route mutations through. The kernel:
 *
 *  - resolves a B01 action-registry command id to an executor contract
 *    (kind, approval tier, executability) BEFORE anything runs;
 *  - enforces expected-revision (stale base → rejected, nothing applied);
 *  - enforces actor authorization and per-operation capabilities (Stage 10
 *    role/capability model, including the AI-delegation restrictions);
 *  - enforces approval-tier policy from B01 metadata: destructive commands
 *    require an independent `approve_proposal` approval; release-tier
 *    commands are categorically refused here — manufacturing-release
 *    authority stays exactly where MFG01 put it;
 *  - is idempotent on `idempotencyKey` (durable replay returns the original
 *    result, marked as such);
 *  - is atomic: a failed persistence commit leaves the project, revision,
 *    and derived artifacts unchanged;
 *  - records affected scope and derived-artifact invalidation
 *    deterministically in a structured execution result.
 *
 * B02 shipped this kernel disconnected from product runtime. B03 connected
 * the first editor slice through `editor-adapter.ts` (move/rotate/side,
 * track width/layer, non-footprint delete, all-footprint arrange, canonical
 * undo/redo). No agent-callable mutation tool exists; destructive-tier
 * commands from non-human/non-ui provenance still require an independent
 * approval, and release-tier commands remain categorically refused.
 */

import { ACTION_COVERAGE_REGISTRY, type ActionCoverageRecord, type ActionKind, type ApprovalTier, type CoverageStatus } from "./action-registry";
import { pcbRevisionId } from "../pcb/revision";
import type { PcbBoard } from "../pcb/types";
import { InteractiveUiChannel } from "./interactive-channel.internal";
import { retireReplacementAuthorityGrant, verifyReplacementAuthorityGrant } from "./schematic-authority.internal";
import { applyEngineeringOperations } from "./operations";
import { computeProjectRevision, revisionMatches, semanticStateDigest } from "./revision";
import { engineeringDigest } from "./stable";
import { createEngineeringTransaction, EngineeringTransactionService } from "./transaction-service";
import type {
  CanonicalProjectState,
  DeclaredMutationScope,
  DerivedArtifactState,
  EngineeringActor,
  EngineeringOperation,
  EngineeringTransaction,
  ProjectRevision,
  TransactionOutcome,
} from "./types";

// ─── B01 metadata → executor contract ────────────────────────────────────────

export interface ExecutorCommandContract {
  commandId: string;
  kind: ActionKind;
  approvalTier: ApprovalTier;
  status: CoverageStatus;
  /** Mutating commands are the only ones the B02 kernel executes. */
  mutating: boolean;
  /** False for `missing` coverage — a command that does not exist cannot run. */
  executable: boolean;
  /** Operation kinds this command is allowed to submit to the transaction service. */
  allowedOperationKinds: EngineeringOperation["kind"][];
}

/**
 * Fail-closed semantic binding for the operation vocabulary the Stage 10
 * transaction service can execute today. A B01 record is descriptive only
 * until it has an explicit binding here and its coverage is `implemented`.
 */
/** B08 — every PCB operation kind the kernel can execute (used by the
 *  broad-candidate commands whose delta compilation may touch any board
 *  field, and by canonical undo/redo replay). */
export const ALL_PCB_OPERATION_KINDS = Object.freeze([
  "move_footprint", "set_footprint_protection", "set_copper_protection",
  "add_track", "update_track", "remove_track",
  "add_via", "update_via", "remove_via",
  "add_zone", "update_zone", "remove_zone",
  "add_text", "update_text", "remove_text",
  "add_silk", "update_silk", "remove_silk",
  "add_padstack", "update_padstack", "remove_padstack",
  "add_keepout", "update_keepout", "remove_keepout",
  "add_dimension", "update_dimension", "remove_dimension",
  "update_board_outline", "update_stackup", "update_routing_preferences",
  "update_net_classing", "update_constraint_state", "update_placement_settings",
  "update_routing_history", "update_net",
] satisfies readonly EngineeringOperation["kind"][]);

export const KERNEL_OPERATION_BINDINGS = Object.freeze({
  "pcb.move-footprint": ["move_footprint"],
  "pcb.rotate-side-footprint": ["move_footprint"],
  "pcb.edit-track": ["add_track", "update_track"],
  // B08: deletion covers every deletable annotation/copper kind, and removes
  // the routing-history events that referenced ripped-up copper.
  "pcb.delete-item": ["remove_track", "remove_via", "remove_zone", "remove_text", "remove_silk", "remove_dimension", "update_routing_history"],
  "pcb.arrange": ["move_footprint"],
  // B08 — interactive routing: one gesture (route commit, via placement,
  // stretch, rip-up, candidate commit) compiles to one transaction. Route
  // candidates may also rewrite zones/constraint state (commitRouteCandidate).
  "pcb.route-copper": ["add_track", "update_track", "remove_track", "add_via", "remove_via", "update_zone", "update_constraint_state", "update_routing_history"],
  // B08 — bulk candidates: each applies ONE compiled transaction.
  "pcb.auto-place": ["move_footprint", "add_track", "update_track", "remove_track", "add_via", "update_via", "remove_via", "add_zone", "update_zone", "remove_zone", "update_constraint_state", "update_board_outline"],
  "pcb.autoroute-import": ["add_track", "remove_track", "add_via", "remove_via", "update_routing_history"],
  // [B17-E] explicit selected-net commands built on the same vocabulary: a scoped routing candidate and a per-net rip-up.
  "pcb.reroute-nets": ["add_track", "remove_track", "add_via", "remove_via", "update_routing_history"],
  "pcb.clear-nets": ["remove_track", "remove_via", "update_routing_history"],
  "pcb.autonomous-layout": [...ALL_PCB_OPERATION_KINDS],
  "pcb.board-repair": ["add_track", "update_track", "remove_track", "add_via", "update_via", "remove_via", "add_zone", "update_zone", "remove_zone", "update_constraint_state", "update_routing_history"],
  // B08 — AI assist explicit apply: a declared compound command whose batch
  // compiles atomically (mixed widths/moves/deletes/padstacks in ONE
  // transaction) — never a silent legacy fallback.
  "pcb.assist-edit": [...ALL_PCB_OPERATION_KINDS],
  // B15.3 — the human-approved bounded PCB proposal apply: the delta of a
  // recompiled candidate whose operation VOCABULARY is exactly the closed
  // B15 bounded set (no deletions except the explicit remove_dimension form,
  // no zones/text/silk/padstack/outline/stackup — those cannot appear in a
  // bounded proposal, so the kernel binding truthfully excludes them).
  "pcb.bounded-edit-apply": [
    "move_footprint", "add_track", "update_track", "add_via", "update_via",
    "update_routing_preferences", "update_net_classing",
    "add_dimension", "update_dimension", "remove_dimension",
    "add_keepout", "update_keepout",
  ],
  // B08 — protection is its own command + capability.
  "pcb.protection": ["set_footprint_protection", "set_copper_protection"],
  // B08 — padstack library management (+ via association).
  "pcb.padstack": ["add_padstack", "update_padstack", "remove_padstack", "update_via"],
  "pcb.placement-settings": ["update_placement_settings"],
  // B03: canonical undo/redo replays a durable record's inverse (or forward)
  // operations as a NEW transaction, so it may need the inverse kind of every
  // slice operation (undoing a delete re-adds; undoing an add removes).
  // B06 extends it with the schematic slice inverses; B08 with the full PCB
  // vocabulary.
  "pcb.undo-redo-canonical": [
    ...ALL_PCB_OPERATION_KINDS,
    "schematic_delete_component", "schematic_restore_entities", "schematic_replace_component",
    "schematic_set_component_properties", "schematic_transform_component",
    // B07 — graph-slice inverses.
    "schematic_add_wire", "schematic_delete_wire", "schematic_update_wire_geometry",
    "schematic_add_net_label", "schematic_delete_net_label", "schematic_update_net_label",
    "schematic_add_component",
  ],
  // ── B06 — canonical schematic semantic mutations ───────────────────────────
  "schematic.delete-component": ["schematic_delete_component"],
  "schematic.replace-component": ["schematic_replace_component"], "schematic.resolve-components": ["schematic_replace_component"], // [PR-M, 2026-10-17] the reviewed component RESOLUTION batch: N exact replacements in ONE transaction, each under its own B06.2-verified runtime grant (app/lib/component-resolution/approved-resolution-mutations.ts)
  "schematic.set-property": ["schematic_set_component_properties"],
  // B07: one completed drag/stretch gesture commits component transforms
  // together with attached wire geometry and label moves — one transaction.
  "schematic.move-rotate": ["schematic_transform_component", "schematic_update_wire_geometry", "schematic_update_net_label"],
  // ── B07 — canonical schematic graph mutations ──────────────────────────────
  "schematic.connect": [
    "schematic_add_wire", "schematic_delete_wire", "schematic_update_wire_geometry",
    "schematic_add_net_label", "schematic_delete_net_label", "schematic_update_net_label",
  ],
  "schematic.add-component": ["schematic_add_component"],
  // One chat-initiated tier-1 apply = one atomic transaction that may mix
  // property edits and pre-planned deletes (provider output is compiled by
  // the deterministic tier-1 planner; it never supplies operations directly).
  "schematic.edit-tier1-apply": ["schematic_set_component_properties", "schematic_delete_component"],
  // B08 — these commands are now implemented end-to-end.
  "pcb.create-via": ["add_via"],
  "pcb.edit-via": ["update_via"],
  "pcb.zone": ["add_zone", "update_zone", "remove_zone"],
  "pcb.silkscreen-text": ["add_silk", "update_silk", "remove_silk", "add_text", "update_text", "remove_text"],
  "pcb.rules": ["update_routing_preferences", "update_net_classing"],
  // Board geometry: outline + stackup edits also reconcile stackup plane
  // zones inside the SAME transaction; keepouts share the geometry command.
  "pcb.board-geometry": ["update_board_outline", "update_stackup", "add_zone", "update_zone", "remove_zone", "add_keepout", "update_keepout", "remove_keepout"],
  "pcb.dimension": ["add_dimension", "update_dimension", "remove_dimension"],
} satisfies Partial<Record<string, readonly EngineeringOperation["kind"][]>>);

export const KERNEL_EXECUTABLE_COVERAGE_STATUSES = Object.freeze([
  "implemented",
] satisfies readonly CoverageStatus[]);

export function resolveExecutorContract(
  commandId: string,
  registry: readonly ActionCoverageRecord[] = ACTION_COVERAGE_REGISTRY,
): ExecutorCommandContract | null {
  const record = registry.find((item) => item.id === commandId);
  if (!record) return null;
  const mutating = record.kind === "mutate" || record.kind === "destructive";
  const allowedOperationKinds = [
    ...(KERNEL_OPERATION_BINDINGS[
      record.id as keyof typeof KERNEL_OPERATION_BINDINGS
    ] ?? []),
  ];
  const executable =
    mutating &&
    KERNEL_EXECUTABLE_COVERAGE_STATUSES.some((status) => status === record.status) &&
    allowedOperationKinds.length > 0;
  return {
    commandId: record.id,
    kind: record.kind,
    approvalTier: record.approvalTier,
    status: record.status,
    mutating,
    executable,
    allowedOperationKinds,
  };
}

// ─── Structured execution results ────────────────────────────────────────────

export interface InvalidatedArtifactSummary {
  artifactKind: string;
  status: DerivedArtifactState["status"];
  invalidatedByTransactionIds: string[];
}

export type ExecutionRejectionCode =
  | "unknown_command"
  | "not_executable"
  | "non_mutating_command"
  | "operation_mismatch"
  | "release_tier_blocked"
  | "approval_required"
  | "unauthorized"
  | "stale_revision"
  | "invalid"
  | "persistence_failed"
  // B03.1 verified-replay rejections — all pre-mutation.
  | "unverified_replay"
  | "unknown_reference"
  | "reference_mismatch"
  | "replay_position"
  | "digest_mismatch";

export type ExecutionResult =
  | {
      status: "executed" | "idempotent_replay";
      commandId: string;
      contract: ExecutorCommandContract;
      transactionId: string;
      recordSequence: number;
      revisionBefore: ProjectRevision;
      revisionAfter: ProjectRevision;
      /** B03.1: semantic-domain digests (verified undo/redo replay contract). */
      semanticDigestBefore?: string;
      semanticDigestAfter?: string;
      affectedScope: DeclaredMutationScope;
      changeSetDigest: string;
      invalidatedArtifacts: InvalidatedArtifactSummary[];
      diagnostics: string[];
    }
  | {
      status: "rejected";
      commandId: string;
      contract: ExecutorCommandContract | null;
      reasonCode: ExecutionRejectionCode;
      diagnostics: string[];
      revision: ProjectRevision;
    };

// ─── B03.1/B03.2: trusted interactive-UI execution channel ───────────────────

/**
 * The channel capability itself lives in `./interactive-channel.internal.ts`
 * — an internal composition module that is NOT exported from the engineering
 * barrel and whose importers are enforced by an architectural CI test. The
 * executor only VERIFIES the capability by class identity; it never creates
 * one. An executor constructed WITHOUT a channel (every generic API/agent
 * caller) stays fail-closed: destructive commands require an independent
 * approve_proposal approval regardless of claimed actorKind/provenance.
 */

export interface CanonicalExecutorOptions {
  interactiveChannel?: InteractiveUiChannel;
  /**
   * B03.2: immutable lineage identity of this executor. The editor session
   * injects its current (content-derived, rebase-versioned, reload-restored)
   * lineage id. Generic users omit it and receive the deterministic default
   * `deriveExecutorLineageId(...)` computed from the service state at
   * construction — the check in `executeUndoRedo` is NEVER optional.
   */
  lineageId?: string;
}

/**
 * B03.2 — deterministic executor lineage identity. Content-derived: two
 * executors opened over identical genesis state (same tenant/project/branch,
 * same parent) share an identity; a rebase changes `genesisStateDigest` (and
 * chains `parent`), producing a new one. Never inferred from project id,
 * transaction id, or board digest alone.
 */
export function deriveExecutorLineageId(input: {
  tenantId: string;
  projectId: string;
  branchId: string;
  genesisStateDigest: string;
  parent?: string | null;
}): string {
  return `lin1-${engineeringDigest({
    tenantId: input.tenantId,
    projectId: input.projectId,
    branchId: input.branchId,
    genesis: input.genesisStateDigest,
    parent: input.parent ?? null,
  }).slice(5)}`;
}

// ─── B03.1: verified undo/redo replay contract ───────────────────────────────

/** The one command whose execution is ONLY reachable through `executeUndoRedo`. */
export const REPLAY_COMMAND_ID = "pcb.undo-redo-canonical";

/**
 * A replay request references a durable transaction; it NEVER carries
 * operations. The executor selects the authoritative forward/inverse
 * operations from the durable record and verifies scope, lineage position,
 * and source/result digests before anything mutates.
 */
export interface UndoRedoReplayRequest {
  referencedTransactionId: string;
  direction: "undo" | "redo";
  actor: EngineeringActor;
  /** Durable lineage identity the referenced record must belong to.
   *  B03.2: `lineageId` is REQUIRED and compared to the executor's immutable
   *  lineage identity before any lookup — a pre-rebase or forged lineage is
   *  rejected even when project/branch/transaction/digests all match. */
  expectedLineage: { tenantId: string; projectId: string; branchId: string; lineageId: string };
  /** Current head the caller believes it is replaying against. */
  expectedHeadRevision: ProjectRevision;
  /** SEMANTIC state digest the head must have BEFORE the replay applies.
   *  (Semantic = derived zone-fill lifecycle normalized — the operation
   *  model's exact-invertible domain; see `semanticStateDigest`.) */
  expectedSourceStateDigest: string;
  /** SEMANTIC state digest the state must have AFTER the replay applies. */
  expectedResultStateDigest: string;
  idempotencyKey: string;
  reason?: string;
}

export interface ExecutorRequest {
  /** B01 action-registry id — the canonical name of what is being done. */
  commandId: string;
  actor: EngineeringActor;
  /** Expected head revision; execution is refused when the head moved. */
  expectedRevision: ProjectRevision;
  /** Client-scoped idempotency key; durable replay returns the original result. */
  idempotencyKey: string;
  reason: string;
  operations: EngineeringOperation[];
  approvals?: EngineeringTransaction["approvals"];
  provenance?: EngineeringTransaction["provenance"];
  transactionId?: string;
}

// ─── Kernel ──────────────────────────────────────────────────────────────────

export class CanonicalExecutor {
  /** B03.2: immutable lineage identity, fixed at construction. */
  readonly lineageId: string;

  constructor(
    private readonly service: EngineeringTransactionService,
    private readonly registry: readonly ActionCoverageRecord[] = ACTION_COVERAGE_REGISTRY,
    private readonly options?: CanonicalExecutorOptions,
  ) {
    const project = service.currentProject();
    this.lineageId = options?.lineageId && options.lineageId.length > 0
      ? options.lineageId
      : deriveExecutorLineageId({
          tenantId: project.tenantId,
          projectId: project.projectId,
          branchId: project.branchId,
          genesisStateDigest: service.currentRevision().canonicalStateDigest,
        });
  }

  currentRevision(): ProjectRevision { return this.service.currentRevision(); }
  currentProject(): CanonicalProjectState { return this.service.currentProject(); }
  derivedArtifacts(): DerivedArtifactState[] { return this.service.derivedArtifacts(); }

  async execute(request: ExecutorRequest): Promise<ExecutionResult> {
    const contract = resolveExecutorContract(request.commandId, this.registry);
    const reject = (reasonCode: ExecutionRejectionCode, diagnostics: string[]): ExecutionResult => ({
      status: "rejected", commandId: request.commandId, contract, reasonCode,
      diagnostics: [...diagnostics].sort(), revision: this.service.currentRevision(),
    });

    if (!contract) return reject("unknown_command", [`No B01 action-registry record for command ${request.commandId}.`]);
    if (request.commandId === REPLAY_COMMAND_ID) {
      // B03.1: canonical undo/redo is a VERIFIED replay of a durable record,
      // never a generic execution with caller-supplied operations.
      return reject("unverified_replay", [`Command ${REPLAY_COMMAND_ID} executes only through executeUndoRedo with a referenced durable transaction.`]);
    }
    if (!contract.mutating) return reject("non_mutating_command", [`Command ${request.commandId} is ${contract.kind}; the B02 kernel executes mutating commands only.`]);
    if (contract.approvalTier === "release") {
      return reject("release_tier_blocked", ["Release-tier commands never execute through the B02 kernel; manufacturing-release authority is owned by the MFG01 release gate."]);
    }
    if (!contract.executable) {
      return reject("not_executable", [
        `Command ${request.commandId} is not kernel-executable (coverage=${contract.status}, bindings=${contract.allowedOperationKinds.length}).`,
      ]);
    }
    const mismatchedKinds = [...new Set(
      request.operations
        .map((operation) => operation.kind)
        .filter((kind) => !contract.allowedOperationKinds.includes(kind)),
    )].sort();
    if (mismatchedKinds.length > 0) {
      return reject("operation_mismatch", [
        `Command ${request.commandId} does not permit operation kind(s): ${mismatchedKinds.join(", ")}.`,
      ]);
    }
    if (contract.approvalTier === "destructive") {
      // B03.1 policy: destructive-tier approval comes from EITHER an
      // independent approve_proposal approval OR the trusted interactive-UI
      // execution channel injected at composition time. Caller-supplied
      // actorKind/provenance fields can only NARROW the channel grant (a
      // channel-held executor still refuses non-human or non-ui requests);
      // they can never create authority — forged "human"/"ui" fields on a
      // channel-less executor change nothing.
      const channel = this.options?.interactiveChannel;
      const viaTrustedChannel =
        channel instanceof InteractiveUiChannel &&
        channel.approvesDestructive(contract) &&
        request.actor.actorKind === "human" &&
        request.provenance?.source === "ui";
      if (!viaTrustedChannel) {
        const approvals = request.approvals ?? [];
        const independent = approvals.some((approval) => approval.capability === "approve_proposal" && approval.actorId !== request.actor.actorId);
        if (!independent) {
          return reject("approval_required", [`Command ${request.commandId} is destructive-tier and requires an approve_proposal approval from an actor other than ${request.actor.actorId} (or the trusted interactive editor channel).`]);
        }
      }
    }

    // ── B06.2 — executor-level replacement-authority gate ────────────────────
    // An INITIAL execution that installs ANY atomic-authority field (or
    // claims consumed resources / a grant id) must present a matching
    // registered runtime grant minted by `consumeReplacementAuthority`.
    // Serialized operation data can never manufacture authority: the check
    // compares the live branded grant's scope, canonical revision, component,
    // target part, every installed field, and consumed-resource records
    // against the operation, BEFORE any mutation or durable record exists.
    // Idempotent retries of an already-durable transaction replay without a
    // live grant (the duplicate short-circuit returns the original result);
    // durable undo/redo replays through `executeUndoRedo`, whose operations
    // come exclusively from durable records.
    const usedGrantIds: string[] = [];
    const alreadyDurable = this.service.durableRecords().some((record) => record.transaction.clientOperationId === request.idempotencyKey);
    if (!alreadyDurable) {
      const project = this.service.currentProject();
      for (const operation of request.operations) {
        if (operation.kind !== "schematic_replace_component") continue;
        const replacement = operation.replacement;
        const installsAuthority = Boolean(
          replacement.atomicPartRevisionId || replacement.symbolAssetVersionId || replacement.footprintAssetVersionId ||
          replacement.mappingCertificateId || replacement.selectionRecordId ||
          operation.consumedAuthorityResources !== undefined || operation.authorityGrantId !== undefined,
        );
        if (!installsAuthority) continue;
        const check = verifyReplacementAuthorityGrant({
          grantId: operation.authorityGrantId,
          scope: { tenantId: project.tenantId, projectId: project.projectId, branchId: project.branchId },
          currentCanonicalRevision: this.service.currentRevision().canonicalStateDigest,
          operation,
        });
        if (!check.ok) {
          return reject("unauthorized", [
            `AUTHORITY_GRANT_${check.code.toUpperCase()}`,
            `Replacement of ${operation.componentId} installs atomic authority without a valid runtime grant: ${check.detail}`,
          ]);
        }
        usedGrantIds.push(operation.authorityGrantId!);
      }
    }

    const transaction = createEngineeringTransaction({
      transactionId: request.transactionId ?? `tx:${request.commandId}:${request.idempotencyKey}`,
      projectId: request.expectedRevision.projectId,
      branchId: request.expectedRevision.branchId,
      clientOperationId: request.idempotencyKey,
      actor: request.actor,
      reason: request.reason,
      baseRevision: structuredClone(request.expectedRevision),
      operations: request.operations,
      approvals: structuredClone(request.approvals ?? []),
      provenance: structuredClone(request.provenance ?? { source: "api", toolVersion: "b02-executor" }),
    });

    const outcome = await this.service.submit(transaction);
    // Grants are single-use: retire them only after the transaction is
    // durably accepted (a rejected/failed submit keeps the grant usable for
    // an exact retry).
    if (outcome.state === "accepted" || outcome.state === "rebased") {
      for (const grantId of usedGrantIds) retireReplacementAuthorityGrant(grantId);
    }
    return this.mapOutcome(request, contract, outcome);
  }

  /**
   * B03.1 — the ONLY path that executes `pcb.undo-redo-canonical`.
   *
   * The caller references a durable transaction; the executor loads the
   * record, verifies tenant/project/branch scope, lineage eligibility at the
   * CURRENT head, and the expected source/result state digests — including a
   * pure dry-run proving the record's authoritative operations reproduce the
   * expected result — all BEFORE any mutation. Caller-supplied operations do
   * not exist in this contract and can never influence the replay. The
   * applied transaction is linked to the referenced transaction and
   * direction via its provenance and reason, and duplicate idempotency keys
   * replay the original result.
   */
  async executeUndoRedo(request: UndoRedoReplayRequest): Promise<ExecutionResult> {
    const contract = resolveExecutorContract(REPLAY_COMMAND_ID, this.registry);
    const reject = (reasonCode: ExecutionRejectionCode, diagnostics: string[]): ExecutionResult => ({
      status: "rejected", commandId: REPLAY_COMMAND_ID, contract, reasonCode,
      diagnostics: [...diagnostics].sort(), revision: this.service.currentRevision(),
    });
    if (!contract || !contract.executable) {
      return reject("not_executable", [`${REPLAY_COMMAND_ID} is not kernel-executable in this registry.`]);
    }
    if (request.direction !== "undo" && request.direction !== "redo") {
      return reject("unverified_replay", [`Unknown replay direction ${String(request.direction)}.`]);
    }

    // Scope: the request must name THIS tenant/project/branch — a
    // cross-project or cross-lineage request is rejected before any lookup.
    const project = this.service.currentProject();
    if (
      request.expectedLineage.tenantId !== project.tenantId ||
      request.expectedLineage.projectId !== project.projectId ||
      request.expectedLineage.branchId !== project.branchId
    ) {
      return reject("reference_mismatch", [
        `Replay scope ${request.expectedLineage.tenantId}/${request.expectedLineage.projectId}/${request.expectedLineage.branchId} does not match this lineage (${project.tenantId}/${project.projectId}/${project.branchId}).`,
      ]);
    }
    // B03.2: lineage identity is an enforced invariant — required, and it
    // must equal THIS executor's immutable lineage id. Checked before the
    // duplicate short-circuit and before any record lookup, so a pre-rebase
    // or forged lineage can neither replay nor harvest idempotent results,
    // even when project/branch/transaction ids and digests all match.
    if (!request.expectedLineage.lineageId) {
      return reject("reference_mismatch", ["Replay requests must carry the durable lineage id (expectedLineage.lineageId)."]);
    }
    if (request.expectedLineage.lineageId !== this.lineageId) {
      return reject("reference_mismatch", [
        `Replay lineage ${request.expectedLineage.lineageId} does not match this executor's lineage ${this.lineageId}.`,
      ]);
    }

    // Idempotency FIRST: a duplicate key replays the original applied
    // transaction (its position was consumed by the original — re-verifying
    // position would wrongly reject the retry).
    const records = this.service.durableRecords();
    const duplicate = records.find((item) => item.transaction.clientOperationId === request.idempotencyKey);
    if (duplicate) {
      const expectedLink = `${request.direction}:${request.referencedTransactionId}`;
      if (duplicate.transaction.provenance.candidateId !== expectedLink || !duplicate.appliedChangeSet) {
        return reject("reference_mismatch", [`Idempotency key ${request.idempotencyKey} was already used by a different request.`]);
      }
      return this.mapOutcome(
        { commandId: REPLAY_COMMAND_ID } as ExecutorRequest,
        contract,
        { state: "duplicate", record: structuredClone(duplicate), project: this.service.currentProject(), revision: this.service.currentRevision(), derivedArtifacts: this.service.derivedArtifacts(), acknowledgement: { preview: false, acceptedLocally: true, durableLocal: true, acceptedServer: false, durableServer: false, synchronizedToHead: true, verifiedAtHead: false } },
      );
    }

    // Load the referenced durable record — the ONLY source of replay operations.
    const record = records.find((item) => item.transaction.transactionId === request.referencedTransactionId);
    if (!record) {
      return reject("unknown_reference", [`No durable transaction record ${request.referencedTransactionId} in this lineage.`]);
    }
    if (record.transaction.projectId !== project.projectId || record.transaction.branchId !== project.branchId) {
      return reject("reference_mismatch", [`Referenced transaction ${request.referencedTransactionId} belongs to a different project/branch.`]);
    }
    if (record.status !== "accepted" || !record.appliedChangeSet) {
      return reject("reference_mismatch", [`Referenced transaction ${request.referencedTransactionId} was never applied (status ${record.status}).`]);
    }

    // Expected head + lineage-position eligibility + digest verification —
    // all before mutation. Head IDENTITY uses the full revision; position and
    // result equivalence use the SEMANTIC domain, because geometry operations
    // re-mark derived zone fills dirty on both apply and inverse-apply — the
    // recorded inverse is exact over semantic state, and only over it.
    const head = this.service.currentRevision();
    if (!revisionMatches(request.expectedHeadRevision, head)) {
      return reject("stale_revision", ["EXPECTED_HEAD_MISMATCH"]);
    }
    const changeSet = record.appliedChangeSet;
    if (!changeSet.baseSemanticStateDigest || !changeSet.resultSemanticStateDigest) {
      // Pre-B03.1 record: no verified replay domain — fail closed (rebase rule).
      return reject("unverified_replay", [`Transaction ${request.referencedTransactionId} predates semantic-digest recording and cannot be replayed verifiably.`]);
    }
    const sourceDigest = request.direction === "undo" ? changeSet.resultSemanticStateDigest : changeSet.baseSemanticStateDigest;
    const resultDigest = request.direction === "undo" ? changeSet.baseSemanticStateDigest : changeSet.resultSemanticStateDigest;
    if (semanticStateDigest(project) !== sourceDigest) {
      return reject("replay_position", [`Transaction ${request.referencedTransactionId} is not ${request.direction}-eligible at the current lineage position.`]);
    }
    if (request.expectedSourceStateDigest !== sourceDigest) {
      return reject("digest_mismatch", ["EXPECTED_SOURCE_DIGEST_MISMATCH"]);
    }
    if (request.expectedResultStateDigest !== resultDigest) {
      return reject("digest_mismatch", ["EXPECTED_RESULT_DIGEST_MISMATCH"]);
    }

    // Authoritative operations come from the durable record — forward for
    // redo, recorded inverse for undo. No exact inverse ⇒ fail closed.
    const authoritative = request.direction === "undo" ? record.inverseOperations : record.transaction.operations;
    if (authoritative.length === 0) {
      return reject("unverified_replay", [`Transaction ${request.referencedTransactionId} has no exact ${request.direction} operations; refusing to approximate.`]);
    }
    const mismatched = [...new Set(authoritative.map((operation) => operation.kind).filter((kind) => !contract.allowedOperationKinds.includes(kind)))].sort();
    if (mismatched.length > 0) {
      return reject("operation_mismatch", [`Replay operations include unbound kind(s): ${mismatched.join(", ")}.`]);
    }
    const operations = authoritative.map((operation, index) => ({
      ...structuredClone(operation),
      operationId: `replay:${request.direction}:${index}:${operation.operationId}`,
    }));

    // Pure dry-run: the recorded operations must provably reproduce the
    // expected semantic result state. A mismatch (evicted context, drifted
    // record) rejects with NOTHING mutated — callers fall back to the rebase
    // rule.
    let previewDigest: string;
    try {
      previewDigest = semanticStateDigest(applyEngineeringOperations(project, operations).project);
    } catch (error) {
      return reject("invalid", [error instanceof Error ? error.message : String(error)]);
    }
    if (previewDigest !== resultDigest) {
      return reject("digest_mismatch", ["REPLAY_RESULT_DIGEST_MISMATCH: recorded operations do not reproduce the expected state."]);
    }

    const transaction = createEngineeringTransaction({
      transactionId: `tx:${REPLAY_COMMAND_ID}:${request.idempotencyKey}`,
      projectId: project.projectId,
      branchId: project.branchId,
      clientOperationId: request.idempotencyKey,
      actor: request.actor,
      reason: request.reason ?? `${request.direction === "undo" ? "Undo" : "Redo"} of ${request.referencedTransactionId}`,
      baseRevision: structuredClone(head),
      operations,
      approvals: [],
      // The replay is LINKED to its referenced transaction and direction —
      // durable, auditable, and asserted by the idempotency duplicate check.
      provenance: { source: "ui", toolVersion: "b03.1-verified-replay", candidateId: `${request.direction}:${request.referencedTransactionId}` },
    });
    const outcome = await this.service.submit(transaction);
    return this.mapOutcome({ commandId: REPLAY_COMMAND_ID } as ExecutorRequest, contract, outcome);
  }

  private mapOutcome(request: ExecutorRequest, contract: ExecutorCommandContract, outcome: TransactionOutcome): ExecutionResult {
    if (outcome.state === "accepted" || outcome.state === "duplicate" || outcome.state === "rebased") {
      const record = outcome.record;
      const changeSet = record.appliedChangeSet!;
      const invalidated = outcome.derivedArtifacts
        .filter((artifact) => artifact.invalidatedByTransactionIds.includes(record.transaction.transactionId))
        .map((artifact) => ({
          artifactKind: artifact.artifactKind,
          status: artifact.status,
          invalidatedByTransactionIds: [...artifact.invalidatedByTransactionIds],
        }))
        .sort((a, b) => a.artifactKind.localeCompare(b.artifactKind));
      return {
        status: outcome.state === "duplicate" ? "idempotent_replay" : "executed",
        commandId: request.commandId,
        contract,
        transactionId: record.transaction.transactionId,
        recordSequence: record.serverSequence,
        revisionBefore: structuredClone(changeSet.baseRevision),
        revisionAfter: structuredClone(changeSet.resultRevision),
        ...(changeSet.baseSemanticStateDigest ? { semanticDigestBefore: changeSet.baseSemanticStateDigest } : {}),
        ...(changeSet.resultSemanticStateDigest ? { semanticDigestAfter: changeSet.resultSemanticStateDigest } : {}),
        affectedScope: structuredClone(record.transaction.declaredMutationScope),
        changeSetDigest: record.integrityDigest,
        invalidatedArtifacts: invalidated,
        diagnostics: [],
      };
    }
    if (outcome.state === "conflict") {
      return {
        status: "rejected", commandId: request.commandId, contract, reasonCode: "invalid",
        diagnostics: [`CONFLICT:${outcome.conflict.conflictClass}`],
        revision: structuredClone(outcome.revision),
      };
    }
    const reasonCode: ExecutionRejectionCode =
      outcome.state === "rejected_unauthorized" ? "unauthorized"
      : outcome.state === "rejected_stale" ? "stale_revision"
      : outcome.state === "persistence_failed" ? "persistence_failed"
      : "invalid";
    return {
      status: "rejected", commandId: request.commandId, contract, reasonCode,
      diagnostics: "diagnostics" in outcome ? [...outcome.diagnostics].sort() : [],
      revision: structuredClone(outcome.revision),
    };
  }
}

// ─── Compatibility bridge for current product revisions ──────────────────────

export interface CurrentProjectBridgeInput {
  tenantId: string;
  projectId: string;
  branchId: string;
  /** Today's editor board (working copy or durable authority board). */
  board: PcbBoard;
  /** Today's schematic state, pinned as canonical opaque JSON. */
  schematic?: unknown;
  pinnedAssets?: CanonicalProjectState["pinnedAssets"];
  /**
   * A revision identifier from the CURRENT product (a `pcb2-…` semantic
   * board revision, as used by R06 stage evidence and working-copy bases).
   * When provided, the bridge verifies it still names this exact board.
   */
  claimedBoardRevision?: string;
}

export interface BridgedProjectRevision {
  state: CanonicalProjectState;
  revision: ProjectRevision;
  /** Semantic board revision of the bridged board (current product scheme). */
  boardSemanticRevision: string;
  /** null = no claim supplied; false = the claim is STALE for this board. */
  claimVerified: boolean | null;
}

/**
 * Bind a current-product project (board + opaque schematic + a legacy
 * `pcb2-…` revision claim) to an executor-compatible ProjectRevision without
 * migrating any UI handler. A stale claim is reported, never silently
 * accepted — callers must refuse to execute against it.
 */
export function bridgeCurrentProjectRevision(input: CurrentProjectBridgeInput): BridgedProjectRevision {
  const state: CanonicalProjectState = {
    schemaVersion: "sirkit.engineering.v1",
    tenantId: input.tenantId,
    projectId: input.projectId,
    branchId: input.branchId,
    pcb: structuredClone(input.board),
    ...(input.schematic === undefined ? {} : { schematic: structuredClone(input.schematic) }),
    pinnedAssets: structuredClone(input.pinnedAssets ?? []),
  };
  const boardSemanticRevision = pcbRevisionId(state.pcb);
  return {
    state,
    revision: computeProjectRevision(state),
    boardSemanticRevision,
    claimVerified: input.claimedBoardRevision === undefined ? null : input.claimedBoardRevision === boardSemanticRevision,
  };
}
