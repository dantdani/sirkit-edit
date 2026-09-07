/**
 * Durable, server-owned storage for ManufacturingReleaseAuthority.
 *
 * MFG01's release gate only accepts authority supplied by a server-owned
 * loader (a browser board can never publish manufacturing authority). This
 * store persists the exact authority assembled after a successful autonomous
 * qualification (RC01 parity + RC02 route evidence + RC03 capability
 * evaluation over the committed routed board) in the durable-workflow
 * repository, CAS-protected and digest-bound, so the release endpoint can
 * reload and re-verify it independently of any client state.
 */

import type { DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../../durable-workflow/stable";
import { sha256, stableJson } from "./native/stable";
import type { ManufacturingReleaseAuthority, ManufacturingReleaseLocator } from "./release-gate";

const AUTHORITY = "mfg.release-authority.v1";

export interface ManufacturingAuthorityScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  designId: string;
  boardId: string;
}

function workflowScope(scope: ManufacturingAuthorityScope): DurableWorkflowScope {
  return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId };
}

function authorityKey(scope: ManufacturingAuthorityScope): string {
  return durableWorkflowId("mfg-release-authority", {
    tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId,
    designId: scope.designId, boardId: scope.boardId,
  });
}

export function manufacturingAuthorityRecordDigest(authority: ManufacturingReleaseAuthority): string {
  return `sha256:${sha256(stableJson(authority))}`;
}

export class DurableManufacturingAuthorityStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  private async head(scope: ManufacturingAuthorityScope) {
    return this.workflow.loadHead<ManufacturingReleaseAuthority>(
      durableAggregateIdentity(workflowScope(scope), AUTHORITY, authorityKey(scope)),
    );
  }

  /** Persist authority for the exact routed board; CAS on the aggregate revision. */
  async save(authority: ManufacturingReleaseAuthority, input: { idempotencyKey: string; savedAt: string }): Promise<{ revision: number; recordDigest: string }> {
    const scope: ManufacturingAuthorityScope = authority;
    if (scope.tenantId !== authority.tenantId || scope.boardId !== authority.boardId) throw new Error("MFG_AUTHORITY_SCOPE_INVALID");
    const recordDigest = manufacturingAuthorityRecordDigest(authority);
    const current = await this.head(scope);
    if (current?.recordDigest === recordDigest) return { revision: current.revision, recordDigest };
    const committed = await this.workflow.commit({
      scope: workflowScope(scope),
      scopeKey: durableScopeKey(workflowScope(scope), `mfg-authority:${scope.boardId}`),
      idempotencyKey: input.idempotencyKey,
      operations: [{ aggregateType: AUTHORITY, aggregateKey: authorityKey(scope), expectedRevision: current?.revision ?? 0, payload: structuredClone(authority), recordDigest }],
      outbox: [{ owner: { aggregateType: AUTHORITY, aggregateKey: authorityKey(scope) }, eventType: "mfg.authority-published", eventVersion: 1, topic: "mfg.authority-published", payload: { boardId: scope.boardId, boardRevision: authority.boardRevision, recordDigest } }],
      result: { boardRevision: authority.boardRevision, recordDigest },
      committedAt: input.savedAt,
    });
    void committed;
    const head = await this.head(scope);
    if (!head || head.recordDigest !== recordDigest) throw new Error("MFG_AUTHORITY_SAVE_UNVERIFIED");
    return { revision: head.revision, recordDigest };
  }

  /**
   * Server-owned loader for releaseManufacturingPackage. Verifies the stored
   * record's digest and the locator's expected board identity before returning;
   * anything inconsistent loads as null so the release gate fails closed.
   */
  loader(locator: ManufacturingReleaseLocator): () => Promise<ManufacturingReleaseAuthority | null> {
    return async () => {
      const head = await this.head(locator);
      if (!head) return null;
      const authority = head.payload;
      if (manufacturingAuthorityRecordDigest(authority) !== head.recordDigest) return null;
      if (authority.boardRevision !== locator.expectedBoardRevision || authority.boardDigest !== locator.expectedBoardDigest) return null;
      return structuredClone(authority);
    };
  }

  /** [B16.1C] the durable head — payload plus the aggregate revision and record digest a release binds. */
  async getHead(scope: ManufacturingAuthorityScope): Promise<{ authority: ManufacturingReleaseAuthority; revision: number; recordDigest: string } | null> {
    const head = await this.head(scope);
    if (!head) return null;
    if (manufacturingAuthorityRecordDigest(head.payload) !== head.recordDigest) throw new Error("MFG_AUTHORITY_RECORD_DIGEST_MISMATCH");
    return { authority: structuredClone(head.payload), revision: head.revision, recordDigest: head.recordDigest };
  }

  async get(scope: ManufacturingAuthorityScope): Promise<ManufacturingReleaseAuthority | null> {
    const head = await this.head(scope);
    if (!head) return null;
    if (manufacturingAuthorityRecordDigest(head.payload) !== head.recordDigest) throw new Error("MFG_AUTHORITY_RECORD_DIGEST_MISMATCH");
    return structuredClone(head.payload);
  }
}
