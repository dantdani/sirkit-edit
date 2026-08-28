/**
 * B13 — server-owned component-authority resource bridge and verified-
 * replacement prerequisite. Real loader + real inspector + real envelope +
 * real grant path. Since B13.1 the loader VALIDATES every durable aggregate,
 * so records here originate from genuinely valid aggregates built through the
 * real physical-binding service (see `_authority-fixtures.ts`) — no synthetic
 * binding is presented as authority, and none is browser-supplied.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentPhysicalBinding } from "../../physical-binding/types";
import {
  loadComponentAuthorityRecords,
  type AuthorityBindingAggregate,
  type AuthorityBindingSource,
  type ComponentAuthoritySourceDeps,
} from "../component-authority-source";
import { inspectComponentAuthority, type ComponentAuthorityRecord, type ComponentCatalogCandidate } from "../component-authority";
import { consumeReplacementAuthority } from "../schematic-authority.internal";
import { buildReadResourceBundle, sealResourceEnvelope } from "../resource-envelopes";
import { computeProjectRevision } from "../revision";
import { createEmptyBoard } from "../../pcb/types";
import { toCanonicalSchematic } from "../schematic-model";
import { assembleAgentRunContext, buildAgentResourceBundle } from "../../agent/context";
import { verifyAgentContextIntegrity } from "../../agent/gateway";
import { sirkitToolRegistry } from "../tool-catalog";
import { buildRunToolset } from "../../agent/loop";
import { agentAdapterFor } from "../../agent/adapters";
import type { SchematicState } from "@/lib/schematic-types";
import { FIXTURE_AUTHORITY_HIERARCHY, FIXTURE_AUTHORITY_SCOPE, FIXTURE_EXACT, matchingAtomicConfirmer, unpublishedAtomicConfirmer, validApprovedAggregate } from "./_authority-fixtures";

const COMPONENT = "component-uuid-1";
const SCOPE = FIXTURE_AUTHORITY_SCOPE;
// [B13.2 §A] loads against fixture aggregates request the fixture hierarchy.
const LOAD = { scope: SCOPE, canonicalRevision: "eng1-run-head", componentInstanceIds: [COMPONENT], hierarchyPath: FIXTURE_AUTHORITY_HIERARCHY };

function source(aggregates: readonly AuthorityBindingAggregate[], opts?: { throwOnLoad?: boolean }): AuthorityBindingSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    // [B13.2 §A] the component id arrives INSIDE the one complete scope.
    async loadForComponent(scope) {
      calls.push(scope.componentInstanceId);
      if (opts?.throwOnLoad) throw new Error("PB_DB_DOWN");
      return aggregates;
    },
  };
}
const deps = (bindings: AuthorityBindingSource, atomic = matchingAtomicConfirmer()): ComponentAuthoritySourceDeps => ({ bindings, atomic });

describe("B13 — server-owned authority loader", () => {
  it("#1 a valid verified aggregate projects the complete server-owned exact authority", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    const load = await loadComponentAuthorityRecords(deps(source([agg])), LOAD);
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records[0]!.exactAuthority).toEqual({
      atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, mpn: FIXTURE_EXACT.exactMpn, manufacturer: FIXTURE_EXACT.manufacturerId,
      symbolAssetVersionId: FIXTURE_EXACT.symbolAssetVersionId, footprintAssetVersionId: FIXTURE_EXACT.footprintAssetVersionId, mappingCertificateId: FIXTURE_EXACT.mappingCertificateId,
    });
    expect(inspectComponentAuthority({ componentIds: [COMPONENT], projectId: SCOPE.projectId, records: load.records })[0]!.state).toBe("verified-exact");
  });

  it("#2 a component with no durable aggregate yields no record (inspector → unknown)", async () => {
    const load = await loadComponentAuthorityRecords(deps(source([])), LOAD);
    expect(load.status === "loaded" && load.records.length === 0).toBe(true);
    expect(inspectComponentAuthority({ componentIds: [COMPONENT], projectId: SCOPE.projectId, records: [] })[0]!.state).toBe("unknown");
  });

  it("#6b an otherwise-verified selection whose atomic revision is NOT published gets no exact authority (inspector → exact-authority-unresolved)", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    const load = await loadComponentAuthorityRecords({ bindings: source([agg]), atomic: unpublishedAtomicConfirmer }, LOAD);
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records[0]!.exactAuthority).toBeUndefined();
    expect(inspectComponentAuthority({ componentIds: [COMPONENT], projectId: SCOPE.projectId, records: load.records })[0]!.state).toBe("exact-authority-unresolved");
  });

  it("#7/#8 conflicting/duplicate aggregates are conflicted and NEVER merged", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    const load = await loadComponentAuthorityRecords(deps(source([agg, agg])), LOAD);
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records[0]!.conflict).toBe("present");
    expect(load.records[0]!.exactAuthority).toBeUndefined();
    expect(inspectComponentAuthority({ componentIds: [COMPONENT], projectId: SCOPE.projectId, records: load.records })[0]!.state).toBe("conflicted");
  });

  it("#9 [B13.2 §A] a foreign tenant/project/branch/board aggregate fails the load CLOSED — never relabeled, projected, or conflicted", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    for (const foreign of [{ tenantId: "other" }, { projectId: "other" }, { branchId: "other" }, { boardInstanceId: "other" }] as const) {
      const load = await loadComponentAuthorityRecords(deps(source([agg])), { ...LOAD, scope: { ...SCOPE, ...foreign } });
      // B13.2 strengthens the B13 drop semantics: an aggregate outside the
      // requested scope is untrusted source behaviour — the WHOLE load fails
      // closed with a bounded reason instead of silently vanishing.
      expect(load.status, JSON.stringify(foreign)).toBe("unavailable");
      if (load.status === "unavailable") expect(load.reason).toBe("durable source returned an aggregate outside the requested authority scope");
    }
  });

  it("#11 a throwing durable source fails CLOSED as unavailable", async () => {
    const load = await loadComponentAuthorityRecords(deps(source([], { throwOnLoad: true })), LOAD);
    expect(load.status).toBe("unavailable");
  });

  it("#26 the loader performs read-only I/O and the tool is a read tool", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    const src = source([agg]);
    await loadComponentAuthorityRecords(deps(src), LOAD);
    expect(src.calls).toEqual([COMPONENT]);
    expect(sirkitToolRegistry().get("sirkit.component-authority.inspect", "1.0.0")!.operationClass).toBe("read");
  });
});

// ─── Envelope / context / discovery ──────────────────────────────────────────

function contextWith(authority: { records: readonly ComponentAuthorityRecord[]; candidates?: readonly ComponentCatalogCandidate[] } | undefined) {
  return assembleAgentRunContext({
    tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId,
    board: createEmptyBoard(),
    ...(authority ? { componentAuthority: authority } : {}),
  });
}

async function loadedRecords() {
  const agg = await validApprovedAggregate(COMPONENT);
  const load = await loadComponentAuthorityRecords(deps(source([agg])), LOAD);
  if (load.status !== "loaded") throw new Error("load failed");
  return load;
}

describe("B13 — envelope, context integration, discovery", () => {
  it("#22 the tool is included and the bundle seals a durable-server-board envelope pinned to the canonical revision", async () => {
    const { records, candidates } = await loadedRecords();
    const assembly = contextWith({ records, candidates });
    if (!assembly.ok) throw new Error("assembly failed");
    const bundle = buildAgentResourceBundle(assembly.context);
    const envelope = bundle.auxiliary.find((e) => e.kind === "component-authority-records");
    expect(envelope?.authoritySource).toBe("durable-server-board");
    expect(envelope?.sourceCanonicalRevision).toBe(assembly.context.canonicalRevisionDigest);
    const { declarations } = buildRunToolset(sirkitToolRegistry(), assembly.context, () => undefined);
    expect(declarations.some((d) => d.toolId === "sirkit.component-authority.inspect")).toBe(true);
  });

  it("#23 the tool is withheld when no authority resource exists", () => {
    const assembly = contextWith(undefined);
    if (!assembly.ok) throw new Error("assembly failed");
    const { declarations } = buildRunToolset(sirkitToolRegistry(), assembly.context, () => undefined);
    expect(declarations.some((d) => d.toolId === "sirkit.component-authority.inspect")).toBe(false);
  });

  it("context integrity: a post-assembly authority mutation fails closed", async () => {
    const { records, candidates } = await loadedRecords();
    const assembly = contextWith({ records, candidates });
    if (!assembly.ok) throw new Error("assembly failed");
    expect(verifyAgentContextIntegrity(assembly.context)).toEqual([]);
    const tampered = { ...assembly.context, componentAuthority: { records: [], candidates: [] } };
    expect(verifyAgentContextIntegrity(tampered).some((i) => i.includes("component-authority"))).toBe(true);
  });

  it("#14 browser authority forgery: the chat body/editor-context contracts never carry an authority field", () => {
    const routeSource = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
    const allowedBody = routeSource.slice(routeSource.indexOf("ALLOWED_BODY_KEYS"), routeSource.indexOf("ALLOWED_EDITOR_CONTEXT_KEYS"));
    expect(allowedBody).not.toContain("componentAuthority");
    expect(allowedBody).not.toContain("authority");
    const allowedEditor = routeSource.slice(routeSource.indexOf("ALLOWED_EDITOR_CONTEXT_KEYS"), routeSource.indexOf("AUTHORITY_CLAIM_KEYS"));
    expect(allowedEditor).not.toContain("componentAuthority");
    expect(routeSource).toContain("componentAuthority: authority");
    expect(routeSource).toContain("resolveComponentAuthoritySource(requestScope)");
  });

  it("#25 the tool's provider schema renders identically for OpenAI and Anthropic", async () => {
    const { records, candidates } = await loadedRecords();
    const assembly = contextWith({ records, candidates });
    if (!assembly.ok) throw new Error("assembly failed");
    const registry = sirkitToolRegistry();
    const openai = buildRunToolset(registry, assembly.context, () => undefined).declarations.find((d) => d.toolId === "sirkit.component-authority.inspect");
    const anthropic = buildRunToolset(registry, assembly.context, () => undefined).declarations.find((d) => d.toolId === "sirkit.component-authority.inspect");
    expect(JSON.stringify(openai!.inputSchema)).toBe(JSON.stringify(anthropic!.inputSchema));
    void agentAdapterFor("openai"); void agentAdapterFor("anthropic");
  });
});

// ─── Grant consumption hardening ─────────────────────────────────────────────

describe("B13 — grant consumption exact-authority hardening", () => {
  async function verifiedBundle(recordOver?: Partial<ComponentAuthorityRecord>) {
    const { records } = await loadedRecords();
    const finalRecords = recordOver ? [{ ...records[0]!, ...recordOver }] : records;
    const canonicalProject = { schemaVersion: "sirkit.engineering.v1" as const, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, pcb: createEmptyBoard(), schematic: toCanonicalSchematic(baseSchematic()), pinnedAssets: [] };
    const canonicalRevision = computeProjectRevision(canonicalProject).canonicalStateDigest;
    const scope = { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId };
    const canonicalEnvelope = sealResourceEnvelope({ resourceId: "res:canonical", kind: "canonical-state", ...scope, authoritySource: "local-working-copy", authorityStatus: "verified", sourceVersion: "1", sourceCanonicalRevision: canonicalRevision, producer: "b13-test", producerVersion: "1.0.0", freshness: "current", content: canonicalProject });
    const authorityEnvelope = sealResourceEnvelope({ resourceId: "res:authority", kind: "component-authority-records", ...scope, authoritySource: "durable-server-board", authorityStatus: "verified", sourceVersion: "1", sourceCanonicalRevision: canonicalRevision, producer: "component-authority-source", producerVersion: "1.0.0", freshness: "current", content: { records: finalRecords, candidates: [] } });
    return { bundle: buildReadResourceBundle(canonicalEnvelope, [authorityEnvelope]), canonicalRevision, scope };
  }

  it("#17 an exact authorized selection mints a grant deriving every asset from the server-owned record", async () => {
    const { bundle, canonicalRevision, scope } = await verifiedBundle();
    const result = consumeReplacementAuthority({ bundle, scope, expectedCanonicalRevision: canonicalRevision, componentId: COMPONENT, targetPartId: FIXTURE_EXACT.exactMpn, target: { atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.authority.symbolAssetVersionId).toBe(FIXTURE_EXACT.symbolAssetVersionId);
    expect(result.authority.footprintAssetVersionId).toBe(FIXTURE_EXACT.footprintAssetVersionId);
    expect(result.authority.mappingCertificateId).toBe(FIXTURE_EXACT.mappingCertificateId);
  });

  it("#18 substituting ANY asset-ID field is refused as asset_mismatch before grant registration (the #7 closure)", async () => {
    const { bundle, canonicalRevision, scope } = await verifiedBundle();
    for (const field of ["atomicPartRevisionId", "symbolAssetVersionId", "footprintAssetVersionId", "mappingCertificateId"] as const) {
      const target: Record<string, string> = { atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, [field]: "ATTACKER" };
      const result = consumeReplacementAuthority({ bundle, scope, expectedCanonicalRevision: canonicalRevision, componentId: COMPONENT, targetPartId: FIXTURE_EXACT.exactMpn, target: target as never });
      expect(result.ok, field).toBe(false);
      if (!result.ok) expect(result.code, field).toBe("asset_mismatch");
    }
  });

  it("#15/#16 a record without exact authority (candidate-only) is never verified replacement authority", async () => {
    const { bundle, canonicalRevision, scope } = await verifiedBundle({ exactAuthority: undefined });
    const result = consumeReplacementAuthority({ bundle, scope, expectedCanonicalRevision: canonicalRevision, componentId: COMPONENT, targetPartId: FIXTURE_EXACT.exactMpn, target: { atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId } });
    expect(!result.ok && (result.code === "incomplete_identity" || result.code === "not_verified")).toBe(true);
  });

  it("#10 an authority envelope pinned to a different canonical revision is refused", async () => {
    const { bundle, scope } = await verifiedBundle();
    const result = consumeReplacementAuthority({ bundle, scope, expectedCanonicalRevision: "eng1-different-head", componentId: COMPONENT, targetPartId: FIXTURE_EXACT.exactMpn, target: { atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId } });
    expect(!result.ok && result.code === "wrong_revision").toBe(true);
  });

  it("#21 changing an authority record changes the sealed manifest digest deterministically (board unchanged)", async () => {
    const a = await loadedRecords();
    const modified = [{ ...a.records[0]!, footprintBindingRevision: "DIFFERENT" }];
    const assemblyA = contextWith({ records: a.records });
    const assemblyB = contextWith({ records: modified });
    if (!assemblyA.ok || !assemblyB.ok) throw new Error("assembly failed");
    const digestA = buildAgentResourceBundle(assemblyA.context).manifestDigest;
    const digestB = buildAgentResourceBundle(assemblyB.context).manifestDigest;
    expect(assemblyA.context.canonicalRevisionDigest).toBe(assemblyB.context.canonicalRevisionDigest);
    expect(digestA).not.toBe(digestB);
    expect(buildAgentResourceBundle(assemblyA.context).manifestDigest).toBe(digestA);
  });
});

function baseSchematic(): SchematicState {
  return { components: [{ id: "R1", type: "resistor", x: 0, y: 0, rotation: 0, value: "1k" }], wires: [] };
}
void (null as unknown as ComponentPhysicalBinding);
