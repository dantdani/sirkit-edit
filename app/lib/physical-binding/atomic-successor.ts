/**
 * [B19-E E5] Moving a bound component OFF a withdrawn atomic revision ONTO the successor the catalog names (OD-38).
 *
 *  - PREVIEW (a read): the effective approved selection must name the from revision, and the to revision must be on the from
 *    revision's successor chain (its named successor, or, when that successor was itself withdrawn, a later successor at most
 *    MAX_SUCCESSOR_HOPS away; [B19-E E5 review]); the upgrade diff is recomputed from both portable snapshots and the successor's
 *    durable status, and its digest pins what a reviewer saw (the diff, the project scope, the component and the binding
 *    revision; never who previewed it).
 *  - REBIND: a human reviewer or project administrator only (never automation, never the AI); a reason; the digest must equal a
 *    fresh preview's and the diff must have no blockers. The old binding is superseded and the successor bound through the
 *    ordinary lifecycle (create_candidate, select, revalidate, approve) — all staged, then written in ONE durable commit, so a
 *    failure anywhere leaves the old selection in effect. Nothing is rebound automatically.
 */
import { resolveSuccessorChains, type AtomicRevisionStatus } from "../atomic/revision-status";
import { diffAtomicSnapshots } from "../atomic/project";
import { semanticHash } from "../atomic/stable";
import type { AtomicUpgradeDiff, PortableAtomicSnapshot } from "../atomic/types";
import type { EngineeringActor } from "../engineering/types";
import { bindAtomicSelection, type BindAtomicSelectionResult } from "./atomic-binding";
import { PhysicalBindingService, type PhysicalBindingAggregateState, type PhysicalBindingRepository } from "./repository";
import { StagedPhysicalBindingRepository } from "./staged-repository";

export const ATOMIC_SUCCESSOR_DIFF_SCHEMA = "sirkit.atomic-successor-diff.v1" as const;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_REASON = 2_000;
const REBIND_ROLES: ReadonlySet<string> = new Set(["reviewer", "project_admin"]);

export interface AtomicSuccessorDeps {
  service: PhysicalBindingService;
  repository: PhysicalBindingRepository;
  loadStatus(revisionIds: readonly string[]): Promise<ReadonlyMap<string, AtomicRevisionStatus>>;
  /** the historical loader: published, whatever was withdrawn (the from side may be revoked; the diff's status blocks the to side) */
  loadSnapshot(revisionId: string): Promise<PortableAtomicSnapshot | null>;
}

export interface AtomicSuccessorTarget {
  scope: { tenantId: string; projectId: string; branchId: string };
  boardInstanceId: string;
  componentInstanceId: string;
  fromRevisionId: string;
  toRevisionId: string;
  hierarchyPath?: string[];
  assemblyVariantIds?: string[];
}

export interface AtomicSuccessorPreview {
  fromRevisionId: string;
  toRevisionId: string;
  fromStatus: AtomicRevisionStatus["state"];
  toStatus: AtomicRevisionStatus["state"];
  setId: string;
  bindingRevisionId: string;
  diff: AtomicUpgradeDiff;
  diffDigest: string;
}

export interface AtomicSuccessorRebindResult extends BindAtomicSelectionResult {
  supersededBindingRevisionId: string | null;
  /** the digest the rebind verified; null on a replay of a rebind that already happened (nothing was previewed) */
  diffDigest: string | null;
}

/** [B19-E E5 review] One component's effective approved binding revision on a board (null when it has none). */
export interface EffectiveAtomicSelection {
  componentInstanceId: string;
  atomicPartRevisionId: string | null;
}

/** [B19-E E5 review] At most this many components per effective-selection read. */
export const MAX_EFFECTIVE_SELECTION_COMPONENTS = 50;

function effectiveSelection(states: readonly PhysicalBindingAggregateState[], revisionId: string) {
  for (const state of states) {
    const selected = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId);
    if (selected && selected.approval.state === "approved" && selected.exactPart?.atomicPartRevisionId === revisionId) return { state, selected };
  }
  return null;
}

async function componentStates(deps: Pick<AtomicSuccessorDeps, "repository">, target: Pick<AtomicSuccessorTarget, "scope" | "boardInstanceId" | "componentInstanceId" | "hierarchyPath" | "assemblyVariantIds">): Promise<PhysicalBindingAggregateState[]> {
  return deps.repository.findForComponentVariant({
    tenantId: target.scope.tenantId, projectId: target.scope.projectId, branchId: target.scope.branchId,
    boardInstanceId: target.boardInstanceId, componentInstanceId: target.componentInstanceId,
    hierarchyPath: target.hierarchyPath ?? ["root"], assemblyVariantId: target.assemblyVariantIds?.[0] ?? "variant-default",
  });
}

/**
 * [B19-E E5 review] Each component's effective APPROVED binding revision (the exact atomic revision it names), so a caller offers a
 * successor preview only where the server would accept one: the from revision must be that binding's revision.
 */
export async function effectiveAtomicSelections(deps: Pick<AtomicSuccessorDeps, "repository">, input: { scope: AtomicSuccessorTarget["scope"]; boardInstanceId: string; componentInstanceIds: readonly string[] }): Promise<EffectiveAtomicSelection[]> {
  const selections: EffectiveAtomicSelection[] = [];
  for (const componentInstanceId of input.componentInstanceIds) {
    const states = await componentStates(deps, { scope: input.scope, boardInstanceId: input.boardInstanceId, componentInstanceId });
    const approved = states.map((state) => state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)).find((binding) => binding?.approval.state === "approved");
    selections.push({ componentInstanceId, atomicPartRevisionId: approved?.exactPart?.atomicPartRevisionId ?? null });
  }
  return selections;
}

/** The successor diff a reviewer reviews, with its digest. Throws the route's PB_* codes. */
export async function previewAtomicSuccessor(deps: AtomicSuccessorDeps, target: AtomicSuccessorTarget): Promise<AtomicSuccessorPreview> {
  const effective = effectiveSelection(await componentStates(deps, target), target.fromRevisionId);
  if (!effective) throw new Error("PB_REBIND_FROM_NOT_EFFECTIVE_CONFLICT");
  const statuses = await deps.loadStatus([target.fromRevisionId, target.toRevisionId]);
  const fromStatus = statuses.get(target.fromRevisionId);
  const toStatus = statuses.get(target.toRevisionId);
  if (!fromStatus || !toStatus) throw new Error("PB_ATOMIC_REVISION_NOT_FOUND");
  // [B19-E E5 review] the to revision must be on the from revision's successor chain: a revoked revision never gets a new event, so
  // when its named successor is later withdrawn the chain's later successor is the only way off it (the diff blocks any
  // withdrawn target, so only a selectable revision on the chain can be rebound)
  const chain = (await resolveSuccessorChains(deps.loadStatus, new Map([[target.fromRevisionId, fromStatus]]))).get(target.fromRevisionId)?.chain ?? [];
  if (!chain.includes(target.toRevisionId)) throw new Error("PB_REBIND_NOT_SUCCESSOR_CONFLICT");
  const [from, to] = await Promise.all([deps.loadSnapshot(target.fromRevisionId), deps.loadSnapshot(target.toRevisionId)]);
  if (!from || !to || from.atomicRevision.id !== target.fromRevisionId || to.atomicRevision.id !== target.toRevisionId) throw new Error("PB_ATOMIC_REVISION_NOT_FOUND");
  const diff = diffAtomicSnapshots(from, to, toStatus.state);
  const diffDigest = `sha256:${semanticHash({
    schema: ATOMIC_SUCCESSOR_DIFF_SCHEMA,
    // [B19-E E5 review] the project scope only: a caller's scope may carry its actor (id, role, session), which is not the diff
    scope: { tenantId: target.scope.tenantId, projectId: target.scope.projectId, branchId: target.scope.branchId },
    boardInstanceId: target.boardInstanceId, componentInstanceId: target.componentInstanceId,
    setId: effective.state.set.setId, bindingRevisionId: effective.selected.revisionId,
    fromStatus: fromStatus.state, toStatus: toStatus.state, diff,
  })}`;
  return { fromRevisionId: target.fromRevisionId, toRevisionId: target.toRevisionId, fromStatus: fromStatus.state, toStatus: toStatus.state, setId: effective.state.set.setId, bindingRevisionId: effective.selected.revisionId, diff, diffDigest };
}

/** Supersede the old binding and bind the successor, in one durable commit. Throws the route's PB_* codes. */
export async function rebindAtomicSuccessor(deps: AtomicSuccessorDeps, input: AtomicSuccessorTarget & { actor: EngineeringActor; diffDigest: unknown; reason: unknown }): Promise<AtomicSuccessorRebindResult> {
  // no automation and no AI actor may rebind; an editor is told a reviewer rebinds (checked before anything is read). [B19-E E5
  // review] never the review-request handoff: approving a review binds without superseding, so it cannot complete a rebind
  if (input.actor.actorKind !== "human") throw new Error("PB_ATOMIC_REBIND_HUMAN_REQUIRED");
  if (!REBIND_ROLES.has(input.actor.role)) throw new Error("PB_ATOMIC_REBIND_REVIEWER_REQUIRED");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > MAX_REASON) throw new Error("PB_API_REBIND_REASON_INVALID");
  if (typeof input.diffDigest !== "string" || !DIGEST.test(input.diffDigest)) throw new Error("PB_API_REBIND_INPUT_INVALID");

  // an identical rebind that already happened is answered, never repeated; [B19-E E5 review] after re-reading the successor's
  // status, as bind_atomic_selection's replay does (a revoked or unpublished successor is refused), and without echoing the
  // caller's digest (nothing was previewed)
  const already = effectiveSelection(await componentStates(deps, input), input.toRevisionId);
  if (already) {
    const status = (await deps.loadStatus([input.toRevisionId])).get(input.toRevisionId);
    if (!status?.pinnable) throw new Error(status ? "PB_ATOMIC_REVISION_REVOKED" : "PB_ATOMIC_REVISION_NOT_FOUND");
    return { setId: already.state.set.setId, bindingRevisionId: already.selected.revisionId, lifecycleState: already.selected.lifecycleState, alreadyBound: true, supersededBindingRevisionId: null, diffDigest: null };
  }

  const preview = await previewAtomicSuccessor(deps, input);
  if (preview.diff.blockers.length > 0) throw new Error("PB_REBIND_DIFF_BLOCKED_CONFLICT");
  if (preview.diffDigest !== input.diffDigest) throw new Error("PB_REBIND_DIFF_CHANGED_CONFLICT");

  const staged = new StagedPhysicalBindingRepository(deps.repository);
  const stagedService = new PhysicalBindingService(staged);
  const current = await staged.load(preview.setId);
  if (!current || current.set.effectiveSelectedRevisionId !== preview.bindingRevisionId) throw new Error("PB_REBIND_FROM_NOT_EFFECTIVE_CONFLICT");
  const selected = current.bindings.find((binding) => binding.revisionId === preview.bindingRevisionId)!;
  // 1. supersede the old binding (the set then has no effective selection — only inside the staged commit)
  await stagedService.transition(preview.setId, {
    schemaVersion: "sirkit.physical-binding-transition.v1",
    action: "supersede",
    bindingRevisionId: selected.revisionId,
    expectedSetRevision: current.set.revision,
    idempotencyKey: `rebind-${input.componentInstanceId}-${input.fromRevisionId}-${input.toRevisionId}-supersede`,
    reason: `Superseded by successor revision ${input.toRevisionId}: ${reason}`,
    actor: input.actor,
    at: new Date().toISOString(),
  }, current);
  // 2. create, select, revalidate and approve the successor through the ordinary lifecycle, against the staged head
  const bound = await bindAtomicSelection(stagedService, staged, { scope: input.scope, actor: input.actor, boardInstanceId: input.boardInstanceId, componentInstanceId: input.componentInstanceId, atomicPartRevisionId: input.toRevisionId, hierarchyPath: input.hierarchyPath, assemblyVariantIds: input.assemblyVariantIds });
  // 3. one durable commit: all of it, or none of it (the old selection stays in effect on any failure)
  await staged.flush();
  return { ...bound, supersededBindingRevisionId: selected.revisionId, diffDigest: preview.diffDigest };
}
