import { createHash } from "node:crypto";
import { schematicDigest, schematicId } from "./stable";
import type { ExternalIdentityMapping, KiCadSchematicArtifactManifest, SchematicCompilerCapabilityProfile } from "./types";
import type { KiCadRoundTripCertificate } from "./types";

function safeRelativePath(path: string): boolean {
  return Boolean(path) && !path.includes("\\") && !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && path.split("/").every((part) => part && part !== "." && part !== ".." && !/[\u0000-\u001f<>:"|?*]/.test(part));
}

/** Builds a candidate manifest only. Publication still requires independent reparse/equivalence. */
export function buildKiCadArtifactManifest(input: { candidateId: string; version: string; adapterRevisionId: string; rootPath: string; childPaths: string[]; files: Array<{ path: string; content: string | Uint8Array }>; externalMappings: ExternalIdentityMapping[]; profile: SchematicCompilerCapabilityProfile }): KiCadSchematicArtifactManifest {
  if (!input.profile.supportedKiCadVersions.includes(input.version)) throw new Error("CD8_KICAD_ADAPTER_VERSION_UNSUPPORTED");
  const requested = [input.rootPath, ...input.childPaths], filePaths = input.files.map((item) => item.path);
  if (requested.some((path) => !safeRelativePath(path) || !path.endsWith(".kicad_sch")) || filePaths.some((path) => !safeRelativePath(path)) || new Set(filePaths).size !== filePaths.length || requested.some((path) => !filePaths.includes(path))) throw new Error("CD8_ARTIFACT_PATH_INVALID");
  const files = input.files.map((file) => { const content = typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content; return { path: file.path, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.byteLength }; }).sort((a, b) => a.path.localeCompare(b.path));
  if (files.reduce((sum, file) => sum + file.bytes, 0) > input.profile.limits.maximumArtifactBytes) throw new Error("CD8_ARTIFACT_RESOURCE_LIMIT");
  const base: Omit<KiCadSchematicArtifactManifest, "manifestId" | "deterministicDigest"> = { candidateId: input.candidateId, supportedKiCadVersion: input.version, adapterRevisionId: input.adapterRevisionId, rootSchematicPath: input.rootPath, childSchematicPaths: [...new Set(input.childPaths)].sort(), generatedFiles: files, externalIdentityMappingSnapshotDigest: schematicDigest([...input.externalMappings].sort((a, b) => a.mappingId.localeCompare(b.mappingId))), generationDiagnostics: ["INDEPENDENT_REPARSE_REQUIRED_BEFORE_PUBLICATION"], publicationState: "candidate_only" };
  const withId = { ...base, manifestId: schematicId("kicad-artifact-manifest", base) };
  return { ...withId, deterministicDigest: schematicDigest(withId) };
}

export function validateManifestAfterRoundTrip(manifest: KiCadSchematicArtifactManifest, certificate: KiCadRoundTripCertificate): KiCadSchematicArtifactManifest {
  if (certificate.artifactManifestId !== manifest.manifestId || certificate.certificateState !== "semantically_equivalent" || certificate.semanticDifferenceIds.length || certificate.unsupportedConstructIds.length) throw new Error("CD8_ARTIFACT_ROUND_TRIP_NOT_EQUIVALENT");
  const next = { ...structuredClone(manifest), publicationState: "validated" as const, generationDiagnostics: [...manifest.generationDiagnostics, `ROUND_TRIP:${certificate.certificateId}`].sort() };
  next.deterministicDigest = schematicDigest({ ...next, deterministicDigest: undefined });
  return next;
}
