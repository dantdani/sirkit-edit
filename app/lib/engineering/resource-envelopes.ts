/**
 * B05.1 — versioned, digest-verified authority-resource envelopes.
 *
 * Every fact a read binding consumes travels in a provider-neutral envelope
 * that pins WHAT it is (kind), WHOSE it is (tenant/project/branch scope),
 * WHERE it came from (authority source + producer), WHICH version it is
 * (source version + canonical-revision compatibility), and WHAT it contains
 * (content digest + dependency digests). Bundles carry a deterministic
 * manifest and manifest digest so composite reads are pinned to ALL of their
 * inputs, not just the canonical board.
 *
 * Trust boundary (documented, not overstated): digest verification proves
 * INTEGRITY AND CONSISTENCY of the supplied envelopes. It does not prove an
 * arbitrary in-process caller selected the correct real-world authority —
 * production composition must build envelopes through approved authority
 * adapters, and tool arguments never provide resource contents. No secrets,
 * credentials, connections, tokens, or provider request data belong here.
 */

import { engineeringDigest } from "./stable";
import type { ToolAuthoritySource } from "./tool-registry";
import type { CanonicalProjectState } from "./types";
import { computeProjectRevision } from "./revision";

// ─── Kinds (closed set; unknown kinds fail closed) ───────────────────────────

export const READ_RESOURCE_KINDS = [
  "canonical-state",
  "selection-snapshot",
  "component-authority-records",
  "drc-rules",
  "fab-preset",
  "drc-preset",
  "netlist",
  // [B17-F] the captured view context (what the editors show) and the project operation timeline it carries.
  "view-state-snapshot",
  "project-timeline-snapshot",
] as const;
export type ReadResourceKind = (typeof READ_RESOURCE_KINDS)[number];

export const RESOURCE_FRESHNESS = ["current", "stale", "unknown"] as const;
export type ResourceFreshness = (typeof RESOURCE_FRESHNESS)[number];

// ─── Envelope ────────────────────────────────────────────────────────────────

export interface ReadAuthorityResourceEnvelope<T = unknown> {
  /** [B09.2] v2: `authorityStatus` participates in the content digest and
   *  the manifest, so post-seal authority tampering is an integrity
   *  failure. v1 envelopes are refused explicitly as superseded. */
  schema: "sirkit.read-authority-resource.v2";
  resourceId: string;
  kind: ReadResourceKind;
  tenantId: string;
  projectId: string;
  branchId: string;
  authoritySource: ToolAuthoritySource;
  authorityStatus: "verified" | "unverified" | "unavailable";
  /** Source version/revision of the resource itself (preset version, binding revision, …). */
  sourceVersion: string;
  /** Canonical state digest this resource corresponds to, when applicable. */
  sourceCanonicalRevision?: string;
  producer: string;
  producerVersion: string;
  /** Only when a timestamp is meaningful provenance; fixtures omit it. */
  generatedAt?: number;
  freshness: ResourceFreshness;
  contentDigest: string;
  dependencyDigests?: Record<string, string>;
  content: T;
}

export type SealResourceInput<T> = Omit<ReadAuthorityResourceEnvelope<T>, "schema" | "contentDigest">;

/** Compute and attach the content digest — the ONLY way to mint an envelope.
 *  Content is CLONED at seal time so the envelope owns its bytes: external
 *  aliases (shared preset objects, caller-held references) can never mutate
 *  a sealed envelope from the outside. */
export function sealResourceEnvelope<T>(input: SealResourceInput<T>): ReadAuthorityResourceEnvelope<T> {
  const content = structuredClone(input.content);
  return {
    schema: "sirkit.read-authority-resource.v2",
    ...input,
    content,
    // [B09.2] the digest pins WHAT the resource is AND its authority claim.
    contentDigest: engineeringDigest({ kind: input.kind, authorityStatus: input.authorityStatus, content }),
  };
}

// ─── Structured failure codes (never collapsed into generic failure) ─────────

export const RESOURCE_FAILURE_CODES = [
  "missing_resource",
  "corrupt_resource",
  "stale_resource",
  "foreign_resource",
  "incompatible_resource_revision",
  "manifest_mismatch",
  "dependency_mismatch",
  "duplicate_resource",
] as const;
export type ResourceFailureCode = (typeof RESOURCE_FAILURE_CODES)[number];

export interface ResourceFailure {
  code: ResourceFailureCode;
  resourceId?: string;
  kind?: string;
  detail: string;
}

// ─── Manifest + bundle ───────────────────────────────────────────────────────

export interface ResourceManifestEntry {
  resourceId: string;
  kind: ReadResourceKind;
  scope: { tenantId: string; projectId: string; branchId: string };
  authoritySource: ToolAuthoritySource;
  /** [B09.2] authority claim, covered by the manifest digest. */
  authorityStatus: "verified" | "unverified" | "unavailable";
  sourceVersion: string;
  sourceCanonicalRevision?: string;
  contentDigest: string;
  dependencyDigests?: Record<string, string>;
  freshness: ResourceFreshness;
}

export interface ReadResourceBundle {
  schema: "sirkit.read-resource-bundle.v1";
  canonicalState: ReadAuthorityResourceEnvelope<CanonicalProjectState>;
  auxiliary: ReadAuthorityResourceEnvelope[];
  manifest: ResourceManifestEntry[];
  manifestDigest: string;
}

function manifestEntry(envelope: ReadAuthorityResourceEnvelope): ResourceManifestEntry {
  return {
    resourceId: envelope.resourceId,
    kind: envelope.kind,
    scope: { tenantId: envelope.tenantId, projectId: envelope.projectId, branchId: envelope.branchId },
    authoritySource: envelope.authoritySource,
    authorityStatus: envelope.authorityStatus,
    sourceVersion: envelope.sourceVersion,
    ...(envelope.sourceCanonicalRevision ? { sourceCanonicalRevision: envelope.sourceCanonicalRevision } : {}),
    contentDigest: envelope.contentDigest,
    ...(envelope.dependencyDigests ? { dependencyDigests: envelope.dependencyDigests } : {}),
    freshness: envelope.freshness,
  };
}

export function computeResourceManifest(canonicalState: ReadAuthorityResourceEnvelope<CanonicalProjectState>, auxiliary: readonly ReadAuthorityResourceEnvelope[]): { manifest: ResourceManifestEntry[]; manifestDigest: string } {
  const manifest = [canonicalState, ...auxiliary]
    .map(manifestEntry)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.resourceId.localeCompare(b.resourceId));
  return { manifest, manifestDigest: engineeringDigest({ schema: "sirkit.read-resource-manifest.v2", manifest }) };
}

/** Build a sealed bundle with its deterministic manifest. */
export function buildReadResourceBundle(canonicalState: ReadAuthorityResourceEnvelope<CanonicalProjectState>, auxiliary: readonly ReadAuthorityResourceEnvelope[] = []): ReadResourceBundle {
  const { manifest, manifestDigest } = computeResourceManifest(canonicalState, auxiliary);
  return { schema: "sirkit.read-resource-bundle.v1", canonicalState, auxiliary: [...auxiliary], manifest, manifestDigest };
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function validateResourceEnvelope(envelope: ReadAuthorityResourceEnvelope, expectedScope: { tenantId: string; projectId: string; branchId: string }): ResourceFailure[] {
  const failures: ResourceFailure[] = [];
  const at = envelope.resourceId ?? "(missing id)";
  if ((envelope as { schema?: unknown }).schema === "sirkit.read-authority-resource.v1") {
    // [B09.2] stale replay/fixture versions fail EXPLICITLY, never silently.
    failures.push({ code: "corrupt_resource", resourceId: at, kind: envelope.kind, detail: "envelope schema v1 is superseded by v2 (authority-pinned digests); regenerate the resource" });
    return failures;
  }
  if (envelope.schema !== "sirkit.read-authority-resource.v2") {
    failures.push({ code: "corrupt_resource", resourceId: at, kind: envelope.kind, detail: "unsupported envelope schema" });
    return failures;
  }
  if (envelope.authorityStatus !== "verified" && envelope.authorityStatus !== "unverified" && envelope.authorityStatus !== "unavailable") {
    failures.push({ code: "corrupt_resource", resourceId: at, kind: envelope.kind, detail: "authority status is missing or unknown" });
  }
  if (!envelope.resourceId || !envelope.sourceVersion || !envelope.producer || !envelope.producerVersion) {
    failures.push({ code: "corrupt_resource", resourceId: at, kind: envelope.kind, detail: "envelope is structurally incomplete" });
  }
  if (!(READ_RESOURCE_KINDS as readonly string[]).includes(envelope.kind)) {
    failures.push({ code: "corrupt_resource", resourceId: at, kind: String(envelope.kind), detail: `unknown resource kind ${String(envelope.kind)}` });
    return failures; // fail closed — nothing else is checkable for unknown kinds
  }
  if (!(RESOURCE_FRESHNESS as readonly string[]).includes(envelope.freshness)) {
    failures.push({ code: "corrupt_resource", resourceId: at, kind: envelope.kind, detail: "freshness status is missing or unknown" });
  }
  const recomputed = engineeringDigest({ kind: envelope.kind, authorityStatus: envelope.authorityStatus, content: envelope.content });
  if (recomputed !== envelope.contentDigest) {
    failures.push({ code: "corrupt_resource", resourceId: at, kind: envelope.kind, detail: "content digest does not match content/authority (post-seal tampering)" });
  }
  if (envelope.tenantId !== expectedScope.tenantId || envelope.projectId !== expectedScope.projectId || envelope.branchId !== expectedScope.branchId) {
    failures.push({ code: "foreign_resource", resourceId: at, kind: envelope.kind, detail: `resource is scoped to ${envelope.tenantId}/${envelope.projectId}/${envelope.branchId}` });
  }
  if (envelope.freshness === "stale") {
    failures.push({ code: "stale_resource", resourceId: at, kind: envelope.kind, detail: "resource is marked stale by its producer" });
  }
  return failures;
}

/**
 * Full bundle validation: envelope structure + digests, scope, unique ids,
 * dependency digests, canonical-revision compatibility, manifest agreement.
 */
export function validateReadResourceBundle(bundle: ReadResourceBundle, expectedScope: { tenantId: string; projectId: string; branchId: string }): ResourceFailure[] {
  const failures: ResourceFailure[] = [];
  if (bundle.schema !== "sirkit.read-resource-bundle.v1") {
    return [{ code: "corrupt_resource", detail: "unsupported bundle schema" }];
  }
  if (bundle.canonicalState.kind !== "canonical-state") {
    failures.push({ code: "missing_resource", kind: "canonical-state", detail: "bundle canonicalState envelope must have kind canonical-state" });
  }
  const all = [bundle.canonicalState as ReadAuthorityResourceEnvelope, ...bundle.auxiliary];
  const seenIds = new Set<string>();
  for (const envelope of all) {
    failures.push(...validateResourceEnvelope(envelope, expectedScope));
    if (seenIds.has(envelope.resourceId)) {
      failures.push({ code: "duplicate_resource", resourceId: envelope.resourceId, kind: envelope.kind, detail: "resource id registered more than once" });
    }
    seenIds.add(envelope.resourceId);
  }
  if (bundle.auxiliary.some((envelope) => envelope.kind === "canonical-state")) {
    failures.push({ code: "duplicate_resource", kind: "canonical-state", detail: "canonical state may appear exactly once" });
  }
  // Canonical revision + auxiliary compatibility.
  const canonicalDigest = computeProjectRevision(bundle.canonicalState.content).canonicalStateDigest;
  if (bundle.canonicalState.sourceCanonicalRevision && bundle.canonicalState.sourceCanonicalRevision !== canonicalDigest) {
    failures.push({ code: "incompatible_resource_revision", resourceId: bundle.canonicalState.resourceId, kind: "canonical-state", detail: "canonical envelope claims a different canonical revision than its content" });
  }
  for (const envelope of bundle.auxiliary) {
    if (envelope.sourceCanonicalRevision && envelope.sourceCanonicalRevision !== canonicalDigest) {
      failures.push({ code: "incompatible_resource_revision", resourceId: envelope.resourceId, kind: envelope.kind, detail: `resource is pinned to canonical revision ${envelope.sourceCanonicalRevision}, bundle canonical revision is ${canonicalDigest}` });
    }
    for (const [dependencyId, expectedDigest] of Object.entries(envelope.dependencyDigests ?? {})) {
      const dependency = all.find((candidate) => candidate.resourceId === dependencyId);
      if (!dependency) {
        failures.push({ code: "dependency_mismatch", resourceId: envelope.resourceId, kind: envelope.kind, detail: `declared dependency ${dependencyId} is not in the bundle` });
      } else if (dependency.contentDigest !== expectedDigest) {
        failures.push({ code: "dependency_mismatch", resourceId: envelope.resourceId, kind: envelope.kind, detail: `dependency ${dependencyId} digest changed` });
      }
    }
  }
  // Manifest agreement (recomputed, byte-deterministic).
  const recomputed = computeResourceManifest(bundle.canonicalState, bundle.auxiliary);
  if (engineeringDigest(recomputed.manifest) !== engineeringDigest(bundle.manifest) || recomputed.manifestDigest !== bundle.manifestDigest) {
    failures.push({ code: "manifest_mismatch", detail: "bundle manifest does not match its resources" });
  }
  return failures;
}

/** Manifest entries for the kinds a binding consumed (deterministic order). */
export function consumedManifest(bundle: ReadResourceBundle, kinds: readonly ReadResourceKind[]): ResourceManifestEntry[] {
  return bundle.manifest.filter((entry) => kinds.includes(entry.kind));
}
