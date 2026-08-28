/**
 * B16.0 — deterministic identity + membership injection for tests.
 *
 * NOT production code — this module is imported only by test files to drive
 * the injectable runtime seams (`setIdentityProviderFactory` /
 * `setMembershipRepositoryFactory`). It never ships a bypass into a
 * production path: the production defaults are unchanged and only a test that
 * explicitly calls these helpers alters resolution.
 */

import type { IdentityProvider, VerifiedPrincipal } from "./identity-provider";
import type { ProjectMembershipRepository, MembershipRole } from "./project-membership";
import { InMemoryProjectMembershipRepository } from "./project-membership";
import {
  setIdentityProviderFactory,
  resetIdentityProviderFactory,
  setMembershipRepositoryFactory,
  resetMembershipRepositoryFactory,
} from "./identity-runtime";

export interface InjectedIdentity {
  userId: string;
  sessionId?: string;
  authMethod?: VerifiedPrincipal["authMethod"];
  authStrength?: VerifiedPrincipal["authStrength"];
  /** null ⇒ the identity provider reports UNAUTHENTICATED (verify → null). */
  authenticated?: boolean;
}

/** Inject a fixed authenticated principal, or an unauthenticated provider. */
export function injectIdentity(identity: InjectedIdentity | null): void {
  const provider: IdentityProvider = {
    async verify(): Promise<VerifiedPrincipal | null> {
      if (!identity || identity.authenticated === false) return null;
      return {
        userId: identity.userId,
        sessionId: identity.sessionId ?? `session:${identity.userId}`,
        authMethod: identity.authMethod ?? "supabase_cookie",
        authStrength: identity.authStrength ?? "aal1",
      };
    },
  };
  setIdentityProviderFactory(() => provider);
}

/** Inject a membership repository seeded with one or more memberships. */
export function injectMembership(records: Array<{ tenantId?: string; projectId: string; userId: string; role: MembershipRole; state?: "active" | "revoked"; version?: number }>): InMemoryProjectMembershipRepository {
  const repo = new InMemoryProjectMembershipRepository();
  for (const record of records) {
    repo.set({
      tenantId: record.tenantId ?? "local",
      projectId: record.projectId,
      userId: record.userId,
      role: record.role,
      state: record.state ?? "active",
      version: record.version ?? 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      auditActorId: "test",
    });
  }
  setMembershipRepositoryFactory(() => repo);
  return repo;
}

/** Inject an explicit membership repository instance. */
export function injectMembershipRepository(repo: ProjectMembershipRepository): void {
  setMembershipRepositoryFactory(() => repo);
}

/** Convenience: inject a fully-authorized principal with a project role. */
export function injectAuthorizedPrincipal(input: { userId: string; projectId: string; tenantId?: string; role?: MembershipRole; sessionId?: string; authMethod?: VerifiedPrincipal["authMethod"] }): InMemoryProjectMembershipRepository {
  injectIdentity({ userId: input.userId, sessionId: input.sessionId, authMethod: input.authMethod });
  return injectMembership([{ tenantId: input.tenantId, projectId: input.projectId, userId: input.userId, role: input.role ?? "admin" }]);
}

export function resetInjectedIdentity(): void {
  resetIdentityProviderFactory();
  resetMembershipRepositoryFactory();
}
