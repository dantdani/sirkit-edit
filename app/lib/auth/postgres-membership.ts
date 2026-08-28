/**
 * B16.0 — the production Postgres project-membership repository.
 *
 * Reads the server-owned `project_members` table via the durable DB handle.
 * Performs NO I/O at construction (the query is lazy inside the method), so a
 * static import is safe. Returns null for any absent / revoked / foreign row
 * (fail closed — cross-tenant and cross-project access simply do not match).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { projectMembers } from "../db/schema";
import type { ProjectMembershipRecord, ProjectMembershipRepository, MembershipRole } from "./project-membership";

export class PostgresProjectMembershipRepository implements ProjectMembershipRepository {
  async loadActiveMembership(input: { tenantId: string; projectId: string; userId: string }): Promise<ProjectMembershipRecord | null> {
    const rows = await getDb()
      .select()
      .from(projectMembers)
      .where(and(
        eq(projectMembers.tenantId, input.tenantId),
        eq(projectMembers.projectId, input.projectId),
        eq(projectMembers.userId, input.userId),
      ))
      .limit(1);
    const row = rows[0];
    if (!row || row.state !== "active") return null;
    return {
      tenantId: row.tenantId,
      projectId: row.projectId,
      userId: row.userId,
      role: row.role as MembershipRole,
      state: "active",
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      auditActorId: row.auditActorId,
    };
  }
}
