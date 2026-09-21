/**
 * [B20 B3] The served-read harness of the B3 suites (not a test file): the REAL pipeline (`serveMcpReadCall`), the real B05
 * service, the real durable board reader over the in-memory durable repository, the real membership re-verifier over the
 * in-memory membership repository, and a fake component-authority source. Nothing here reaches a database or a network.
 */
import { buildMcpBearerContext, type McpBearerContext } from "@/app/lib/auth/mcp-bearer";
import { InMemoryProjectMembershipRepository, membershipRevisionOf, projectRoleFromMembership, type MembershipRole } from "@/app/lib/auth/project-membership";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import type { ComponentAuthoritySourceDeps } from "@/app/lib/engineering/component-authority-source";
import { createDurableBoardReader, readOnlyDurableWorkflow, type DurableBoardReader } from "@/app/lib/engineering/durable-read-bundle";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import type { ToolRegistry } from "@/app/lib/engineering/tool-registry";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbSyncBoardRecord } from "@/app/lib/pcb-sync/types";
import { durableBoardFixture, FIXTURE_SCOPE, publishDurableBoard } from "@/app/lib/engineering/__tests__/_durable-board-fixture";
import { membershipReverifier, serveMcpReadCall, type McpReadCallAnswer, type McpReadDependencies } from "../read-call";
import { MCP_TOOL_LISTING_SCHEMA, renderMcpToolListing } from "../tool-definitions";

export const HARNESS_USER = "user-mcp-0001";
export const HARNESS_T0 = Date.UTC(2026, 8, 21, 12, 0, 0);
export const PROTOCOL_META = Object.freeze({ "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} });
export const SERVED_READS = [
  "sirkit.component-authority.inspect", "sirkit.manufacturing.readiness-inspect", "sirkit.pcb.board-inspect", "sirkit.pcb.mechanical-inspect",
  "sirkit.pcb.revision-inspect", "sirkit.pcb.via-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run",
] as const;
export const EXEMPT_READS = ["sirkit.pcb.revision-inspect", "sirkit.project.canonical-revision-inspect"] as const;
export const ROLE_OF: Record<MembershipRole, string> = { viewer: "viewer", commenter: "commenter", editor: "pcb_editor", reviewer: "reviewer", admin: "project_admin" };

/** A verified MCP principal for `user` with `role`, pinned to the membership revision `repo` holds for it. */
export async function harnessPrincipal(repo: InMemoryProjectMembershipRepository, options: { user?: string; projectId?: string; tenantId?: string; branchId?: string; nowMs?: number } = {}): Promise<McpBearerContext> {
  const user = options.user ?? HARNESS_USER;
  const tenantId = options.tenantId ?? FIXTURE_SCOPE.tenantId;
  const projectId = options.projectId ?? FIXTURE_SCOPE.projectId;
  const record = await repo.loadActiveMembership({ tenantId, projectId, userId: user });
  if (!record) throw new Error("harness: no membership");
  const nowS = Math.floor((options.nowMs ?? HARNESS_T0) / 1000);
  return buildMcpBearerContext({
    claims: { issuer: "https://mcp.example.com", audience: "https://mcp.example.com/api/mcp", subject: user, tenantId, projectId, branchId: options.branchId ?? FIXTURE_SCOPE.branchId, membershipRevision: membershipRevisionOf(record), tokenId: "AbCdEfGhIjKlMnOpQrStUv", issuedAtS: nowS, expiresAtS: nowS + 3600, scope: "sirkit.mcp" },
    role: projectRoleFromMembership(record.role)!,
    membershipRevision: membershipRevisionOf(record),
    requestId: `mcpreq-${"0123456789abcdef"}`,
  });
}

export function membershipRepo(role: MembershipRole = "editor", user = HARNESS_USER, projectId: string = FIXTURE_SCOPE.projectId): InMemoryProjectMembershipRepository {
  const repo = new InMemoryProjectMembershipRepository();
  repo.set({ tenantId: FIXTURE_SCOPE.tenantId, projectId, userId: user, role, state: "active", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "test" });
  return repo;
}

/** The served listing digest of `role`, exactly as the dispatch computes it. */
export function listingDigestFor(registry: ToolRegistry, role: string): string {
  const listing = renderMcpToolListing(registry);
  const tools = listing.tools.filter((tool) => registry.get(tool.name, tool._meta["dev.sirkit/toolVersion"])?.requiredRoles.includes(role as never) === true);
  return engineeringDigest({ schema: MCP_TOOL_LISTING_SCHEMA, registryDigest: listing.registryDigest, tools });
}

let randomCounter = 0;
/** Deterministic, distinct bytes per call (never a real random source in a test). */
export function countingRandomBytes(size: number): Uint8Array {
  randomCounter += 1;
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (randomCounter * 31 + index * 7) % 256;
  return bytes;
}

export interface Harness {
  workflow: InMemoryDurableWorkflowRepository;
  record: PcbSyncBoardRecord | null;
  repo: InMemoryProjectMembershipRepository;
  registry: ToolRegistry;
  registryDigest: string;
  deps: McpReadDependencies;
  reader: DurableBoardReader;
  principal: McpBearerContext;
  /** `registryDigest` stands in for another registry's digest (the call's context; [B20 B3 review] replay eviction) */
  call(toolId: string, options?: { args?: unknown; meta?: Record<string, unknown>; signal?: AbortSignal; principal?: McpBearerContext; omitArguments?: boolean; registryDigest?: string }): Promise<McpReadCallAnswer>;
}

export interface HarnessOptions {
  board?: PcbBoard | null;
  role?: MembershipRole;
  authority?: ComponentAuthoritySourceDeps | null;
  workflow?: DurableWorkflowRepository;
  now?: () => number;
  registry?: ToolRegistry;
}

/** Seed a durable board (unless `board: null`) and build the dependencies the production runtime would, over fakes. */
export async function readHarness(options: HarnessOptions = {}): Promise<Harness> {
  const workflow = new InMemoryDurableWorkflowRepository();
  const record = options.board === null ? null : await publishDurableBoard(workflow, FIXTURE_SCOPE, options.board ?? durableBoardFixture());
  const repo = membershipRepo(options.role ?? "editor");
  const registry = options.registry ?? sirkitToolRegistry();
  const registryDigest = registry.digest();
  const reader = createDurableBoardReader(readOnlyDurableWorkflow(options.workflow ?? workflow));
  const deps: McpReadDependencies = {
    boardReader: reader,
    componentAuthority: () => options.authority ?? null,
    membership: membershipReverifier(() => repo),
    now: options.now ?? (() => HARNESS_T0),
    randomBytes: countingRandomBytes,
  };
  const principal = await harnessPrincipal(repo);
  const harness: Harness = {
    workflow, record, repo, registry, registryDigest, deps, reader, principal,
    call: (toolId, call = {}) => {
      const who = call.principal ?? principal;
      const descriptor = registry.get(toolId);
      return serveMcpReadCall({
        principal: who,
        toolId,
        toolVersion: descriptor?.version ?? "0.0.0",
        params: { name: toolId, ...(call.omitArguments ? {} : { arguments: call.args ?? {} }), _meta: { ...PROTOCOL_META, ...(call.meta ?? {}) } },
        registry,
        registryDigest: call.registryDigest ?? registryDigest,
        listingDigest: listingDigestFor(registry, who.role),
        signal: call.signal ?? new AbortController().signal,
      }, harness.deps);
    },
  };
  return harness;
}

/** The result object of an answer (throws when the answer is the -32602 binding error). */
export function resultOf(answer: McpReadCallAnswer): Record<string, unknown> & { _meta: Record<string, unknown>; content: Array<{ type: string; text: string }> } {
  if (answer.kind !== "result") throw new Error(`expected a result, got ${answer.kind}`);
  return answer.result as never;
}
export function refusalOf(answer: McpReadCallAnswer): string {
  return String(resultOf(answer)._meta["dev.sirkit/refusal"]);
}
export const pinOf = (revision: string): Record<string, unknown> => ({ "dev.sirkit/expectedRevision": revision });
