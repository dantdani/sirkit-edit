/**
 * [B23-B1] Step 2 of B23-B, "present exactly which files and metadata will leave Sirkit" (runbook :976; D23-6, OD-163).
 *
 * `buildOutboundPackage` is pure. It derives the outbound package ONLY from a ledgered release: the regenerated release's
 * `archiveSha256` is recomputed from Sirkit's own built archive bytes (the archive is never re-read: B22-D found the archive reader
 * inflates an entry before its total bound, `validate-package.ts`), and it, the `releaseId` and the manifest digest must equal the
 * ledger record. The package carries the release's Gerber, Excellon and job files byte for byte, each SHA-256 and size equal to its
 * manifest record, and a generated provider manifest naming exactly `releaseId`, `archiveSha256`, the file list and the
 * capability-profile id and version. The release's `release-manifest.json` (tenant, project, branch, design and board ids, the
 * actor, the evidence) and `README.txt` are withheld, and no BOM, CPL or distributor-observed value (price, stock, SKU) is part of a
 * bare-board release or of this package: a release that lists any other kind of file is refused. The package has its own digest,
 * `outboundPackageDigest` = `mfg-outbound-` + the SHA-256 of the provider manifest's bytes, which name every file's size and SHA-256.
 *
 * What the file BYTES carry is the release's own (a changed byte would move the pinned release identity): the board's name in every
 * path, in each Gerber's X2 `%TF.ProjectId` attribute and in the job file's `ProjectId.Name`. It is disclosed, never stripped
 * (`artifacts/ai-control-plane-b23/outbound-disclosure.md`). Nothing here sends, stores or fetches anything.
 *
 * [B23-B1 review, 2026-10-04] security-1, coverage-1: "withheld" was a list of manifest FIELDS, so the plan said `projectId` and
 * `boardId` stay in Sirkit while their values leave in every file name and in the Gerber and job bytes. The package now scans every
 * outbound name and byte (the files and the provider manifest) for each identity value, as is and in its file-safe form: a field
 * found anywhere is `disclosure.carried` with every place it is, and only a field found nowhere is `withheld.fields`. And
 * `disclosure.embedded` lists, verbatim, every metadata field the file bytes carry: each Gerber's and the Excellon file's X2
 * attributes (file, aperture and object: `TF.*`, `TA.*`, `TO.*`) and comments, and every field of the job file.
 */
import { compareCodePoints } from "../stable-compare";
import { safeFabName, sha256, stableJson, utf8 } from "../pcb/fab/native/stable";
import type { NativeFabFile } from "../pcb/fab/native/types";
import type { ManufacturingReleaseRecord } from "../pcb/fab/release-ledger";
import { validateManifestContentDigest, type ManufacturingFileRole, type ManufacturingReleaseManifestV1 } from "../pcb/fab/release-manifest";

export const OUTBOUND_PACKAGE_SCHEMA = "sirkit.provider-outbound-package.v1" as const;
export const OUTBOUND_MANIFEST_SCHEMA = "sirkit.provider-outbound-manifest.v1" as const;
/** The generated provider manifest's name inside the package (beside the release's own `gerber/` paths). */
export const OUTBOUND_MANIFEST_PATH = "sirkit-outbound-manifest.json";
/** The release file kinds that leave: the Gerber layers, the Excellon drills and the Gerber job file. */
export const OUTBOUND_FILE_KINDS = Object.freeze(["gerber", "xnc", "job"] as const);
type OutboundFileKind = (typeof OUTBOUND_FILE_KINDS)[number];
/** The release file kinds that never leave (the README; the release manifest is not a manifest record of itself). */
const WITHHELD_FILE_KINDS: ReadonlySet<string> = new Set(["readme"]);
/** The provider manifest's closed top-level fields, and every field path it carries (what the plan lists, OD-166). */
export const OUTBOUND_MANIFEST_FIELDS = Object.freeze(["schema", "releaseId", "archiveSha256", "capabilityProfile", "files"] as const);
export const OUTBOUND_FIELD_PATHS = Object.freeze(["schema", "releaseId", "archiveSha256", "capabilityProfile.profileId", "capabilityProfile.version", "files[].path", "files[].role", "files[].kind", "files[].mediaType", "files[].bytes", "files[].sha256"] as const);
/** The release manifest's identity fields, none of which is a provider-manifest field (OD-163; the D23-6 counterexample: `source.*` and
 *  `actor`). [B23-B1 review, 2026-10-04] Each is `withheld` only when its value occurs in no outbound name or byte; otherwise it is
 *  `carried` (security-1). */
export const WITHHELD_SOURCE_FIELDS = Object.freeze(["tenantId", "projectId", "branchId", "designId", "boardId", "actor"] as const);
export type SourceIdentityField = (typeof WITHHELD_SOURCE_FIELDS)[number];
export const OUTBOUND_PACKAGE_REFUSALS = Object.freeze(["release_not_ledgered", "archive_digest_mismatch", "release_id_mismatch", "manifest_digest_invalid", "unexpected_kind", "file_missing", "file_digest_mismatch"] as const);
export type OutboundPackageRefusal = (typeof OUTBOUND_PACKAGE_REFUSALS)[number];

export interface OutboundFile {
  readonly path: string;
  readonly role: ManufacturingFileRole;
  readonly kind: OutboundFileKind;
  readonly mediaType: string;
  /** the size in bytes, equal to the release manifest's record */
  readonly bytes: number;
  readonly sha256: string;
  /** the exact bytes, as the release built them */
  readonly content: Uint8Array;
}

export interface OutboundManifest {
  readonly schema: typeof OUTBOUND_MANIFEST_SCHEMA;
  readonly releaseId: string;
  readonly archiveSha256: string;
  readonly capabilityProfile: { readonly profileId: string; readonly version: number };
  readonly files: ReadonlyArray<{ readonly path: string; readonly role: ManufacturingFileRole; readonly kind: OutboundFileKind; readonly mediaType: string; readonly bytes: number; readonly sha256: string }>;
}

/** [B23-B1 review, 2026-10-04] A Sirkit identity whose value leaves: the form found, and the outbound paths whose name or bytes hold it. */
export interface CarriedIdentifier {
  readonly field: SourceIdentityField;
  readonly value: string;
  /** `as-is`: the value itself; `file-safe`: the value as the release's file names spell it (`safeFabName`); [B23-B1 lead, 2026-10-04] `file-safe-prefix`: the leading part of its file-safe value that the release's 80-character board name keeps when it cuts the id short (low-3) */
  readonly form: "as-is" | "file-safe" | "file-safe-prefix";
  readonly names: readonly string[];
  readonly bytes: readonly string[];
}
/** [B23-B1 review, 2026-10-04] One metadata field the outbound file bytes carry, verbatim, with every file that carries it. */
export interface EmbeddedMetadata {
  /** `TF.<name>` / `TA.<name>` / `TO.<name>` (an X2 attribute), `G04` (a Gerber comment), `;` (an Excellon comment), `job:<path>` (a job-file field) */
  readonly field: string;
  readonly value: string;
  readonly paths: readonly string[];
}

export interface OutboundPackage {
  readonly schema: typeof OUTBOUND_PACKAGE_SCHEMA;
  readonly releaseId: string;
  readonly archiveSha256: string;
  readonly files: readonly OutboundFile[];
  readonly manifest: { readonly path: string; readonly value: OutboundManifest; readonly content: Uint8Array; readonly bytes: number; readonly sha256: string };
  readonly outboundPackageDigest: string;
  /** what the release holds that does not leave: its README and its own manifest, and the identity fields whose value occurs nowhere outbound */
  readonly withheld: { readonly files: readonly string[]; readonly fields: readonly SourceIdentityField[] };
  /** [B23-B1 review, 2026-10-04] what else leaves, said exactly: the identities the names and bytes carry, and the bytes' own metadata */
  readonly disclosure: { readonly carried: readonly CarriedIdentifier[]; readonly embedded: readonly EmbeddedMetadata[] };
}

/** The regenerated release, as `releaseManufacturingPackage` answers it (only these fields are read). */
export interface OutboundReleaseInput {
  readonly releaseId: string;
  readonly archiveSha256: string;
  readonly archiveBytes: Uint8Array;
  readonly manifest: ManufacturingReleaseManifestV1;
  readonly files: readonly NativeFabFile[];
}

export type OutboundPackageAnswer = { readonly ok: true; readonly package: OutboundPackage } | { readonly ok: false; readonly refusal: OutboundPackageRefusal; readonly detail: string };

const refuse = (refusal: OutboundPackageRefusal, detail: string): OutboundPackageAnswer => ({ ok: false, refusal, detail });

/** Derive the exact outbound package of a ledgered release, or say why none exists. Pure: it reads only its input. */
export function buildOutboundPackage(input: { release: OutboundReleaseInput; ledger: ManufacturingReleaseRecord | null }): OutboundPackageAnswer {
  const { release, ledger } = input;
  if (!ledger) return refuse("release_not_ledgered", "The release is not in the release ledger; only a ledgered release can leave Sirkit.");
  if (sha256(release.archiveBytes) !== release.archiveSha256 || release.archiveSha256 !== ledger.archiveSha256) return refuse("archive_digest_mismatch", "The regenerated archive's SHA-256 does not equal the ledger record's.");
  const manifest = release.manifest;
  const derivedReleaseId = `mfg-release-${sha256(`${manifest.manifestContentDigest}\0${manifest.source.boardDigest}`).slice(0, 32)}`;
  if (release.releaseId !== ledger.releaseId || manifest.releaseId !== release.releaseId || derivedReleaseId !== release.releaseId) return refuse("release_id_mismatch", "The regenerated release id does not equal the ledger record's, or does not derive from its manifest.");
  if (!validateManifestContentDigest(manifest) || manifest.manifestContentDigest !== ledger.manifestContentDigest) return refuse("manifest_digest_invalid", "The release manifest's content digest does not verify, or does not equal the ledger record's.");
  const unexpected = manifest.files.filter((record) => !(OUTBOUND_FILE_KINDS as readonly string[]).includes(record.kind) && !WITHHELD_FILE_KINDS.has(record.kind));
  if (unexpected.length > 0) return refuse("unexpected_kind", `The release lists a ${unexpected[0]!.kind} file; a bare-board exchange carries Gerber, Excellon and job files only.`);
  const files: OutboundFile[] = [];
  for (const record of manifest.files) {
    if (!(OUTBOUND_FILE_KINDS as readonly string[]).includes(record.kind)) continue;
    const built = release.files.filter((candidate) => candidate.path === record.path);
    if (built.length !== 1) return refuse("file_missing", `The release's ${record.role} file is not exactly once among its built files.`);
    const content = built[0]!.bytes;
    if (content.byteLength !== record.bytes || sha256(content) !== record.sha256) return refuse("file_digest_mismatch", `The release's ${record.role} file does not equal its manifest record.`);
    files.push(Object.freeze({ path: record.path, role: record.role, kind: record.kind as OutboundFileKind, mediaType: record.mediaType, bytes: record.bytes, sha256: record.sha256, content }));
  }
  files.sort((left, right) => compareCodePoints(left.path, right.path));
  const value: OutboundManifest = {
    schema: OUTBOUND_MANIFEST_SCHEMA,
    releaseId: release.releaseId,
    archiveSha256: release.archiveSha256,
    capabilityProfile: { profileId: manifest.manufacturingProfile.profileId, version: manifest.manufacturingProfile.version },
    files: files.map(({ path, role, kind, mediaType, bytes, sha256: digest }) => ({ path, role, kind, mediaType, bytes, sha256: digest })),
  };
  const content = utf8(`${stableJson(value, true)}\n`);
  const manifestSha256 = sha256(content);
  const withheldFiles = [...manifest.files.filter((record) => WITHHELD_FILE_KINDS.has(record.kind)).map((record) => record.path), ...release.files.filter((candidate) => candidate.kind === "manifest").map((candidate) => candidate.path)].sort(compareCodePoints);
  const carried = carriedIdentifiers(manifest, [...files.map((file) => ({ path: file.path, content: file.content })), { path: OUTBOUND_MANIFEST_PATH, content }]);
  return {
    ok: true,
    package: deepFreeze({
      schema: OUTBOUND_PACKAGE_SCHEMA,
      releaseId: release.releaseId,
      archiveSha256: release.archiveSha256,
      files,
      manifest: { path: OUTBOUND_MANIFEST_PATH, value, content, bytes: content.byteLength, sha256: manifestSha256 },
      outboundPackageDigest: `mfg-outbound-${manifestSha256}`,
      withheld: { files: withheldFiles, fields: WITHHELD_SOURCE_FIELDS.filter((field) => !carried.some((entry) => entry.field === field)) },
      disclosure: { carried, embedded: embeddedMetadata(files) },
    }),
  };
}

const TEXT = new TextDecoder("utf-8");
/** Whether `value` occurs in `text` with no letter or digit beside it (`main` is not found in `Domain`; `b16-1c-blinker` is found in `board-b16-1c-blinker`). */
function occurs(text: string, value: string): boolean {
  if (value.length === 0) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(text);
}

/** [B23-B1 review, 2026-10-04] Each identity of the release manifest whose value, as is or file-safe, is in an outbound name or byte. */
function carriedIdentifiers(manifest: ManufacturingReleaseManifestV1, outbound: ReadonlyArray<{ path: string; content: Uint8Array }>): CarriedIdentifier[] {
  const identity: Record<SourceIdentityField, string> = { tenantId: manifest.source.tenantId, projectId: manifest.source.projectId, branchId: manifest.source.branchId, designId: manifest.source.designId, boardId: manifest.source.boardId, actor: manifest.actor };
  const texts = outbound.map((entry) => ({ path: entry.path, text: TEXT.decode(entry.content) }));
  return WITHHELD_SOURCE_FIELDS.flatMap((field) => [...new Set([identity[field], safeFabName(identity[field]), ...boardNameCutPrefixes(identity[field], manifest.source.boardId)])].flatMap((value): CarriedIdentifier[] => {
    const names = texts.filter((entry) => occurs(entry.path, value)).map((entry) => entry.path);
    const bytes = texts.filter((entry) => occurs(entry.text, value)).map((entry) => entry.path);
    return names.length + bytes.length > 0 ? [{ field, value, form: value === identity[field] ? "as-is" : value === safeFabName(identity[field]) ? "file-safe" : "file-safe-prefix", names, bytes }] : [];
  }));
}

const GERBER_ATTRIBUTE = /^%(T[FAO])\.([^,*]+),(.*)\*%$/;
const GERBER_COMMENT = /^G04 (.*)\*$/;
const DRILL_ATTRIBUTE = /^; #@! (T[FAO])\.([^,]+),(.*)$/;
const DRILL_COMMENT = /^;(?! #@!)\s?(.*)$/;

/** [B23-B1 review, 2026-10-04] Every metadata field the outbound file bytes carry, verbatim, grouped by field and value, in code-point order. */
function embeddedMetadata(files: readonly OutboundFile[]): EmbeddedMetadata[] {
  const held = new Map<string, { field: string; value: string; paths: string[] }>();
  const note = (field: string, value: string, path: string): void => {
    const key = `${field}\0${value}`;
    const entry = held.get(key) ?? { field, value, paths: [] };
    if (!entry.paths.includes(path)) entry.paths.push(path);
    held.set(key, entry);
  };
  for (const file of files) {
    const text = TEXT.decode(file.content);
    if (file.kind === "job") {
      const walk = (node: unknown, at: string): void => {
        if (Array.isArray(node)) node.forEach((child) => walk(child, `${at}[]`));
        else if (node !== null && typeof node === "object") for (const [key, child] of Object.entries(node)) walk(child, at ? `${at}.${key}` : key);
        else note(`job:${at}`, String(node), file.path);
      };
      try { walk(JSON.parse(text), ""); } catch { note("job:(unreadable)", "the job file is not JSON; its bytes leave as they are", file.path); }
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const attribute = file.kind === "gerber" ? GERBER_ATTRIBUTE.exec(line) : DRILL_ATTRIBUTE.exec(line);
      if (attribute) { note(`${attribute[1]}.${attribute[2]}`, attribute[3]!, file.path); continue; }
      const comment = file.kind === "gerber" ? GERBER_COMMENT.exec(line) : DRILL_COMMENT.exec(line);
      if (comment) note(file.kind === "gerber" ? "G04" : ";", comment[1]!, file.path);
    }
  }
  return [...held.values()].sort((left, right) => compareCodePoints(left.field, right.field) || compareCodePoints(left.value, right.value));
}

/** Freeze plain objects and arrays; byte arrays stay as they are (a typed array with elements cannot be frozen). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/**
 * [B23-B1 lead, 2026-10-04] low-3: the release names every file and fills each Gerber's `TF.ProjectId` and the job file's
 * `ProjectId.Name` with `safeFabName(boardId)` (`release-gate.ts:299`, `native/snapshot.ts:92`), which keeps 80 characters. The board
 * id embeds the project id (`board:<projectId>`, `pcbBoardInstanceId`), so a project id longer than 74 file-safe characters leaves
 * cut short, and neither its whole value nor its 80-character file-safe form occurs anywhere. This answers, for one identity value,
 * the leading part of its file-safe form that the cut board name ends with: wherever that form starts inside the uncut board name,
 * at a boundary, and runs past the cut. Empty when the board name was not cut or holds no such part.
 */
function boardNameCutPrefixes(value: string, boardId: string): string[] {
  const board = safeFabName(boardId), whole = fabNameUncut(boardId), id = fabNameUncut(value);
  if (whole.length <= board.length || id.length === 0 || !whole.startsWith(board)) return [];
  const kept: string[] = [];
  for (let at = whole.indexOf(id); at >= 0; at = whole.indexOf(id, at + 1)) {
    if (at > 0 && /[A-Za-z0-9]/.test(whole[at - 1]!)) continue;
    if (at < board.length && at + id.length > board.length) kept.push(board.slice(at));
  }
  return kept;
}

/** [B23-B1 lead, 2026-10-04] `safeFabName`'s cleaning (`native/stable.ts:39`) without its 80-character cut: `safeFabName(x)` is this
 *  value (or `sirkit-board` when it is empty) cut to 80 characters. Were the two ever to disagree, `boardNameCutPrefixes` answers
 *  nothing, and `b23-b-outbound-package` case 10 (a release built for a long project id) fails. */
function fabNameUncut(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
}
