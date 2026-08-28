-- B16.0 — authoritative project membership (server-owned role authority).
--
-- Closes R02-B1-011: a user's project role is looked up here, never read from
-- a client header or from user-editable JWT user_metadata. Membership is
-- unique per (tenant, project, user); a revoked row fails closed.
--
-- Rollback: see the DOWN section at the bottom of this file. There is no
-- implicit first-user administrator and no public endpoint that grants
-- membership; rows are provisioned by an operator / server-side admin flow.

CREATE TABLE IF NOT EXISTS "project_members" (
  "membership_id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "project_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "state" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "audit_actor_id" text NOT NULL,
  CONSTRAINT "project_members_role_check" CHECK ("role" IN ('viewer','commenter','editor','reviewer','admin')),
  CONSTRAINT "project_members_state_check" CHECK ("state" IN ('active','revoked')),
  CONSTRAINT "project_members_version_check" CHECK ("version" > 0),
  CONSTRAINT "project_members_identity_check" CHECK (
    btrim("membership_id") <> '' AND btrim("tenant_id") <> '' AND btrim("project_id") <> '' AND btrim("user_id") <> '' AND btrim("audit_actor_id") <> ''
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_members_tenant_project_user_uniq"
  ON "project_members" ("tenant_id", "project_id", "user_id");

CREATE INDEX IF NOT EXISTS "project_members_lookup_idx"
  ON "project_members" ("tenant_id", "project_id", "user_id", "state");

-- ─── Row Level Security (defence in depth) ──────────────────────────────────
-- Server application checks (app/lib/auth/*) remain the MANDATORY authority;
-- RLS is an additional database-level guard so that even a direct query with
-- the publishable (anon) key can only read a user's OWN active membership.
-- The secret/service_role key bypasses RLS and is used only by the trusted
-- server membership repository. `(select auth.uid())` is wrapped per Supabase
-- performance guidance (per-statement initPlan cache).

ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_members_self_select" ON "project_members";
CREATE POLICY "project_members_self_select"
  ON "project_members" FOR SELECT
  TO authenticated
  USING ( "state" = 'active' AND "user_id" = (select auth.uid())::text );

-- No INSERT/UPDATE/DELETE policy is granted to `authenticated`: a user can
-- never grant, escalate, or revoke their own membership. All writes go
-- through the trusted server path (secret key / service role), which bypasses
-- RLS by design.

-- ─── DOWN (rollback) ────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS "project_members_self_select" ON "project_members";
-- ALTER TABLE "project_members" DISABLE ROW LEVEL SECURITY;
-- DROP INDEX IF EXISTS "project_members_lookup_idx";
-- DROP INDEX IF EXISTS "project_members_tenant_project_user_uniq";
-- DROP TABLE IF EXISTS "project_members";
