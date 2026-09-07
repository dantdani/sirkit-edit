/**
 * B16.0 — the injectable identity + membership runtime seam.
 *
 * Mirrors the established `app/api/chat/replacement-facts-runtime.ts` pattern:
 * a module-mutable factory with `set…`/`reset…` test setters and a
 * `resolve…` that never throws. The production default is gated on the auth
 * mode and fails CLOSED (null) when production authentication is not
 * configured; tests inject deterministic fakes.
 */

import type { IdentityProvider } from "./identity-provider";
import { LocalDevIdentityProvider, SupabaseIdentityProvider, createSupabaseSessionVerifiers } from "./identity-provider";
import type { ProjectMembershipRepository } from "./project-membership";
import { LocalDevProjectMembershipRepository } from "./project-membership";
import { PostgresProjectMembershipRepository } from "./postgres-membership";
import { resolveAuthMode } from "./mode";

// ── Identity provider seam ───────────────────────────────────────────────────

function productionIdentityProvider(environment: Record<string, string | undefined> = process.env): IdentityProvider | null {
  const mode = resolveAuthMode(environment);
  if (mode === "local_dev") return new LocalDevIdentityProvider();
  // Production: the Supabase adapter — signed-claim validation PLUS the
  // [B16.1B §E] server-confirmed session-liveness policy, both on ONE bounded
  // per-request client. If the SDK/config is absent the verifiers fail closed
  // (null / "unavailable"), so the resolver refuses with 401.
  const verifiers = createSupabaseSessionVerifiers(environment);
  return new SupabaseIdentityProvider(verifiers.verifyClaims, { verifier: verifiers.liveness });
}

const DEFAULT_IDENTITY_FACTORY: () => IdentityProvider | null = () => productionIdentityProvider();
let identityFactory = DEFAULT_IDENTITY_FACTORY;

export function setIdentityProviderFactory(factory: () => IdentityProvider | null): void { identityFactory = factory; }
export function resetIdentityProviderFactory(): void { identityFactory = DEFAULT_IDENTITY_FACTORY; }
export function resolveIdentityProvider(): IdentityProvider | null {
  try { return identityFactory(); } catch { return null; }
}

// ── Membership repository seam ────────────────────────────────────────────────

function productionMembershipRepository(environment: Record<string, string | undefined> = process.env): ProjectMembershipRepository | null {
  const mode = resolveAuthMode(environment);
  if (mode === "local_dev") return new LocalDevProjectMembershipRepository();
  // Production membership is served by the durable Postgres adapter. Wired
  // lazily via the DB-backed factory below; absent DB ⇒ null (fail closed).
  return productionPostgresMembershipRepository(environment);
}

/** The production membership repository backed by the durable DB. Returns null
 *  when DATABASE_URL is absent (fail closed). The adapter performs no I/O at
 *  construction (all queries are lazy inside its methods), so a static import
 *  is safe. */
function productionPostgresMembershipRepository(environment: Record<string, string | undefined>): ProjectMembershipRepository | null {
  if (!environment.DATABASE_URL) return null;
  cachedPostgresMembership ??= new PostgresProjectMembershipRepository();
  return cachedPostgresMembership;
}

let cachedPostgresMembership: ProjectMembershipRepository | null | undefined;

const DEFAULT_MEMBERSHIP_FACTORY: () => ProjectMembershipRepository | null = () => productionMembershipRepository();
let membershipFactory = DEFAULT_MEMBERSHIP_FACTORY;

export function setMembershipRepositoryFactory(factory: () => ProjectMembershipRepository | null): void { membershipFactory = factory; }
export function resetMembershipRepositoryFactory(): void { membershipFactory = DEFAULT_MEMBERSHIP_FACTORY; cachedPostgresMembership = undefined; }
export function resolveMembershipRepository(): ProjectMembershipRepository | null {
  try { return membershipFactory(); } catch { return null; }
}
