/**
 * [B19-E E5] A staging overlay over the durable physical-binding repository, so a sequence of ordinary lifecycle steps (a
 * supersede, then create_candidate, select, revalidate and approve) commits as ONE durable commit: all of it, or none of it.
 *
 * The steps run through the ordinary PhysicalBindingService against this overlay: every commit here is checked against the
 * overlay's head (optimistic revision) and kept in memory; reads see the staged heads. `flush` then writes the final head of the
 * one staged set in a single durable commit, expected at the revision the durable store had when staging began, with every
 * intermediate binding revision as an immutable row. A failure before or during the flush leaves the durable store untouched.
 */
import { compareCodePoints } from "@/app/lib/stable-compare";
import type { PhysicalBindingAggregateState, PhysicalBindingCommitRequest, PhysicalBindingRepository } from "./repository";
import type { ComponentPhysicalBinding } from "./types";

const clone = <T>(value: T): T => structuredClone(value);

interface StagedSet {
  state: PhysicalBindingAggregateState;
  /** the durable revision when staging began (0 when the set did not exist) */
  baseRevision: number;
  /** the binding revision ids the durable head held when staging began */
  baseRevisionIds: Set<string>;
  /** every binding revision a staged commit introduced */
  introduced: Map<string, ComponentPhysicalBinding>;
  last: { idempotencyKey: string; requestDigest?: string };
}

export class StagedPhysicalBindingRepository implements PhysicalBindingRepository {
  private readonly staged = new Map<string, StagedSet>();

  constructor(private readonly durable: PhysicalBindingRepository) {}

  async load(setId: string): Promise<PhysicalBindingAggregateState | null> {
    const staged = this.staged.get(setId);
    return staged ? clone(staged.state) : this.durable.load(setId);
  }

  async findForComponentVariant(scope: Parameters<PhysicalBindingRepository["findForComponentVariant"]>[0]): Promise<PhysicalBindingAggregateState[]> {
    const durable = await this.durable.findForComponentVariant(scope);
    const bySet = new Map(durable.map((state) => [state.set.setId, state]));
    for (const [setId, staged] of this.staged) {
      const set = staged.state.set.scope;
      const applies = set.tenantId === scope.tenantId && set.projectId === scope.projectId && set.branchId === scope.branchId && set.boardInstanceId === scope.boardInstanceId && set.componentInstanceId === scope.componentInstanceId
        && set.hierarchyPath.join("\0") === scope.hierarchyPath.join("\0") && (set.assemblyVariantIds.length === 0 || set.assemblyVariantIds.includes(scope.assemblyVariantId));
      if (applies) bySet.set(setId, clone(staged.state));
      else bySet.delete(setId);
    }
    return [...bySet.values()].sort((a, b) => compareCodePoints(a.set.setId, b.set.setId));
  }

  async listSelectedPeers(scope: ComponentPhysicalBinding["scope"]): Promise<ComponentPhysicalBinding[]> {
    // a staged set's selection is its staged head, never the durable one it replaces
    const hidden = new Set<string>();
    for (const staged of this.staged.values()) {
      for (const id of staged.baseRevisionIds) hidden.add(id);
      for (const id of staged.introduced.keys()) hidden.add(id);
    }
    const peers = (await this.durable.listSelectedPeers(scope)).filter((binding) => !hidden.has(binding.revisionId));
    for (const staged of this.staged.values()) {
      const { set, bindings } = staged.state;
      if (!set.effectiveSelectedRevisionId) continue;
      if (set.scope.tenantId !== scope.tenantId || set.scope.projectId !== scope.projectId || set.scope.branchId !== scope.branchId || set.scope.boardInstanceId !== scope.boardInstanceId || set.scope.componentInstanceId !== scope.componentInstanceId) continue;
      const selected = bindings.find((binding) => binding.revisionId === set.effectiveSelectedRevisionId);
      if (selected) peers.push(clone(selected));
    }
    return peers.sort((a, b) => compareCodePoints(a.revisionId, b.revisionId));
  }

  async commit(input: PhysicalBindingCommitRequest): Promise<{ state: PhysicalBindingAggregateState; duplicate: boolean }> {
    let staged = this.staged.get(input.setId);
    if (staged) {
      if (staged.state.set.revision !== input.expectedRevision) throw new Error(`PB_OPTIMISTIC_LOCK_CONFLICT:${staged.state.set.revision}`);
    } else {
      // the first staged commit of a set: its durable head is the base the flush will be expected at
      const current = await this.durable.load(input.setId);
      const baseRevision = current?.set.revision ?? 0;
      if (baseRevision !== input.expectedRevision) throw new Error(`PB_OPTIMISTIC_LOCK_CONFLICT:${baseRevision}`);
      staged = { state: input.state, baseRevision, baseRevisionIds: new Set(current?.bindings.map((binding) => binding.revisionId) ?? []), introduced: new Map(), last: { idempotencyKey: input.idempotencyKey } };
    }
    for (const binding of input.state.bindings) {
      if (!staged.baseRevisionIds.has(binding.revisionId)) staged.introduced.set(binding.revisionId, clone(binding));
    }
    staged.state = clone(input.state);
    staged.last = { idempotencyKey: input.idempotencyKey, ...(input.requestDigest ? { requestDigest: input.requestDigest } : {}) };
    this.staged.set(input.setId, staged);
    return { state: clone(input.state), duplicate: false };
  }

  /** Write the one staged set's final head in a single durable commit (every intermediate revision included as a row). */
  async flush(): Promise<PhysicalBindingAggregateState> {
    if (this.staged.size !== 1) throw new Error(`PB_STAGED_COMMIT_SCOPE:${this.staged.size}`);
    const [[setId, staged]] = [...this.staged];
    const headIds = new Set(staged.state.bindings.map((binding) => binding.revisionId));
    const historicalBindings = [...staged.introduced.values()].filter((binding) => !headIds.has(binding.revisionId)).sort((a, b) => compareCodePoints(a.revisionId, b.revisionId));
    const { state } = await this.durable.commit({ setId, expectedRevision: staged.baseRevision, idempotencyKey: staged.last.idempotencyKey, ...(staged.last.requestDigest ? { requestDigest: staged.last.requestDigest } : {}), state: staged.state, historicalBindings });
    this.staged.clear();
    return state;
  }
}
