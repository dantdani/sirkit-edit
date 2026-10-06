/**
 * [B23-B3] The world of the B23-B3 suites (not a test file): one project's durable truth in the in-memory durable-workflow
 * repository - a qualification authority head, a release ledger record and B2's exchange record `mfg.provider-exchange.v1` holding
 * acknowledged answers written through the record's own API (prepare, sent, settle) - and the GET /api/pcb-sync core over a stub
 * board read, composed as the route composes it.
 *
 * `boardPair` holds two boards with ONE revision id and two authoritative digests: their nets are listed in another order, which the
 * revision payload sorts away and `stableJson` does not (the digest-only move D23-17 is about). Nothing is written to disk and
 * nothing leaves the process; no provider is contacted.
 */
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { durableWorkflowDigest } from "@/app/lib/durable-workflow/stable";
import type { DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { DurableManufacturingReleaseLedger } from "@/app/lib/pcb/fab/release-ledger";
import { authoritativeBoardDigest, type ManufacturingReleaseAuthority } from "@/app/lib/pcb/fab/release-gate";
import type { ManufacturingRuleProfile } from "@/app/lib/pcb/fab/release-manifest";
import { buildManufacturingRuleProfile, JLCPCB_2L_RULE_PROFILE_EVIDENCE } from "@/app/lib/pcb/fab/rule-profile";
import { pcbDesignInstanceId } from "@/app/lib/pcb/board-identity";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import type { DurableBoardLineageStore } from "@/app/lib/pcb-sync/board-lineage";
import type { PcbSyncRepository } from "@/app/lib/pcb-sync/repository";
import { createPcbSyncBoardGetCore, type PcbSyncManufacturingSummary } from "@/app/api/pcb-sync/handler";
import { createManufacturingSummaryReader } from "@/app/api/pcb-sync/manufacturing-summary";
import { createProviderExchangeLedger, type ExchangeAggregate, type ExchangeAttempt, type ExchangeSettleOutcome } from "../exchange-ledger";
import { PROVIDER_REGISTRY_VERSION, PROVIDER_ROWS, type ProviderRow } from "../provider-registry";
import { createProviderObservationReader, type TransferVersion } from "../provider-observation";

export const SCOPE = { tenantId: "tenant-b3", projectId: "project-b3", branchId: "main", boardId: "board-b3" } as const;
export const DESIGN_ID = pcbDesignInstanceId(SCOPE.projectId);
export const AUTHORITY_SCOPE = { ...SCOPE, designId: DESIGN_ID } as const;
export const RETRIEVED_AT = "2026-10-04T12:00:00.000Z";
export const NOW = Date.parse("2026-10-04T13:00:00.000Z");
export const HOUR = 60 * 60_000;
export const PROFILE: ManufacturingRuleProfile = buildManufacturingRuleProfile({ presetId: "jlcpcb-2l", evidence: JLCPCB_2L_RULE_PROFILE_EVIDENCE });
/** The reviewed transfer descriptor version the suites' answers name; none is reviewed in B23 (`REVIEWED_TRANSFER_VERSIONS` is empty). */
export const TRANSFER: readonly TransferVersion[] = Object.freeze([{ providerId: "jlcpcb", operationId: "pcb-quote", version: "0.0.1" }]);
export const JLCPCB_ROW = PROVIDER_ROWS.find((row) => row.id === "jlcpcb")!;
export const RELEASE = { releaseId: "mfg-release-b3-0001", archiveSha256: "a".repeat(64) } as const;
export const NEXT_RELEASE = { releaseId: "mfg-release-b3-0002", archiveSha256: "b".repeat(64) } as const;
export const ADMIN = { role: "project_admin", actorKind: "human" } as const;

/** Two boards with one revision id and two authoritative digests (net order), and equal pcb-sync digests. */
export function boardPair(): { board: PcbBoard; reordered: PcbBoard } {
  const base = createEmptyBoard();
  const vcc = { id: 1, name: "VCC", stableId: "net:vcc", endpointKeys: [] };
  const gnd = { id: 2, name: "GND", stableId: "net:gnd", endpointKeys: [] };
  return { board: { ...base, nets: [base.nets[0]!, vcc, gnd] }, reordered: { ...base, nets: [base.nets[0]!, gnd, vcc] } };
}
const PAIR = boardPair();
export const BOARD = makeBoardRecord({ ...SCOPE, board: PAIR.board, updatedAt: "2026-10-04T10:00:00.000Z" });
export const REORDERED = makeBoardRecord({ ...SCOPE, board: PAIR.reordered, updatedAt: "2026-10-04T10:05:00.000Z" });
/** Another board revision (a footprint-free board of another size). */
export const MOVED = makeBoardRecord({ ...SCOPE, board: { ...PAIR.board, outline: { ...createEmptyBoard().outline, width: 50_000_000 } } as PcbBoard, updatedAt: "2026-10-04T10:10:00.000Z" });

/** A sealed authority for `board` (only the fields the summary and the release route compare are real). */
export function authorityFor(board: PcbBoard, overrides: { profile?: unknown; schematic?: string } = {}): ManufacturingReleaseAuthority {
  const record = makeBoardRecord({ ...SCOPE, board, updatedAt: "2026-10-04T10:00:00.000Z" });
  return {
    schemaVersion: "sirkit.manufacturing-release-authority.v1",
    ...AUTHORITY_SCOPE,
    boardRevision: record.revision,
    boardDigest: authoritativeBoardDigest(board),
    schematic: { revision: overrides.schematic ?? "schematic-b3-r1", digest: `sha256:${overrides.schematic ?? "schematic-b3-r1"}` },
    componentAuthority: { digest: "component-authority-b3" },
    manufacturingRuleProfile: overrides.profile ?? PROFILE,
    sourceDate: "2026-10-04T11:00:00.000Z",
    actor: "u-b3-editor",
  } as unknown as ManufacturingReleaseAuthority;
}

export async function saveAuthority(workflow: DurableWorkflowRepository, board: PcbBoard, key = "qualify-b3-1", overrides: { profile?: unknown; schematic?: string } = {}): Promise<{ revision: number; recordDigest: string }> {
  return new DurableManufacturingAuthorityStore(workflow).save(authorityFor(board, overrides), { idempotencyKey: key, savedAt: "2026-10-04T11:00:00.000Z" });
}

/** The release route's ledger record of `release` for the saved authority and `board`. */
export async function recordRelease(workflow: DurableWorkflowRepository, saved: { revision: number; recordDigest: string }, board: PcbBoard, release: { releaseId: string; archiveSha256: string } = RELEASE): Promise<void> {
  const record = makeBoardRecord({ ...SCOPE, board, updatedAt: "2026-10-04T10:00:00.000Z" });
  await new DurableManufacturingReleaseLedger(workflow).record(AUTHORITY_SCOPE, { releaseId: release.releaseId, archiveSha256: release.archiveSha256, manifestContentDigest: `mfg-manifest-${release.releaseId}`, filename: `sirkit-board-b3-${release.releaseId.slice(-4)}.zip`, authorityRecordDigest: saved.recordDigest, authorityRevision: saved.revision, boardRevision: record.revision, boardDigest: authoritativeBoardDigest(board), schematicRevision: "schematic-b3-r1", componentAuthorityDigest: "component-authority-b3", actor: "u-b3-admin", releasedAt: "2026-10-04T11:30:00.000Z" });
}

export function aggregateFor(providerId = "jlcpcb"): ExchangeAggregate {
  return { scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId }, designId: DESIGN_ID, boardId: SCOPE.boardId, providerId };
}

export interface AnswerOptions {
  readonly key?: string;
  readonly normalized?: Readonly<Record<string, string | number | boolean>>;
  readonly retrievedAt?: string;
  readonly release?: { releaseId: string; archiveSha256: string };
  readonly row?: ProviderRow;
  readonly transferVersion?: string;
  readonly retention?: "normalized" | "ids_digests_timestamps_only";
  readonly purpose?: "dfm" | "quote";
  readonly operationId?: string;
  readonly providerId?: string;
  readonly receiptId?: string;
  /** stop the attempt at this state (an answer only when acknowledged) */
  readonly state?: "prepared" | "sent" | ExchangeSettleOutcome["state"];
}

/** One attempt of B2's record, written through its own API: prepared, sent, then settled as the egress reports it. */
export async function recordAnswer(workflow: DurableWorkflowRepository, options: AnswerOptions = {}): Promise<ExchangeAttempt> {
  const ledger = createProviderExchangeLedger(workflow);
  const aggregate = aggregateFor(options.providerId ?? "jlcpcb");
  const key = options.key ?? "key-b3-0001";
  const release = options.release ?? RELEASE;
  const at = options.retrievedAt ?? RETRIEVED_AT;
  const prepared = await ledger.prepare({
    aggregate,
    at,
    attempt: {
      idempotencyKey: key,
      planId: `provider-exchange-plan:${durableWorkflowDigest({ key }).slice(4, 36)}`,
      planDigest: durableWorkflowDigest({ plan: key }),
      requestDigest: durableWorkflowDigest({ request: key, release }),
      committedBy: "u-b3-admin",
      operationId: options.operationId ?? "pcb-quote",
      purpose: options.purpose ?? "quote",
      descriptor: { registryVersion: PROVIDER_REGISTRY_VERSION, registryDigest: durableWorkflowDigest(options.row ?? JLCPCB_ROW), transferVersion: options.transferVersion ?? "0.0.1" },
      capabilityProfile: { profileId: PROFILE.profileId, version: PROFILE.version },
      release: { releaseId: release.releaseId, archiveSha256: release.archiveSha256 },
      outboundPackageDigest: `mfg-outbound-${durableWorkflowDigest({ package: release.releaseId }).slice(4)}`,
      retention: options.retention ?? "normalized",
      statusRead: "not_declared",
    },
  });
  if (!prepared.ok) throw new Error(`prepare refused: ${prepared.code}`);
  const state = options.state ?? "acknowledged";
  if (state === "prepared") return prepared.attempt;
  if (state === "not_sent") return ledger.settle({ aggregate, idempotencyKey: key, at, outcome: { state: "not_sent", sendStarted: false, failure: "dns_failed", response: null, receipt: null, normalized: {} } });
  const sent = await ledger.markSent({ aggregate, idempotencyKey: key, request: { bytes: 4_096, sha256: "c".repeat(64) }, at });
  if (state === "sent") return sent;
  const response = { status: state === "acknowledged" ? 200 : state === "rejected" ? 422 : 503, contentType: "application/json", bytes: 321, sha256: "d".repeat(64) };
  const outcome: ExchangeSettleOutcome = state === "acknowledged"
    ? { state, sendStarted: true, failure: null, response, receipt: { providerReceiptId: options.receiptId ?? `fake-receipt-${key.slice(-4)}`, retrievedAt: at }, normalized: options.normalized ?? { status: "received", quotedDays: 5, accepted: true } }
    : { state, sendStarted: true, failure: state === "rejected" ? "http_422" : "http_503", response, receipt: null, normalized: {} };
  return ledger.settle({ aggregate, idempotencyKey: key, at, outcome });
}

/** A stub board read (the route's repository) answering `record`. */
export function boardRead(record: ReturnType<typeof makeBoardRecord> | null): PcbSyncRepository {
  return { getBoard: async () => (record ? structuredClone(record) : null) } as unknown as PcbSyncRepository;
}
/** A lineage store answering one state for the board. */
export function lineage(state: "current" | "superseded"): DurableBoardLineageStore {
  return { resolveCurrent: async () => ({ boardId: SCOPE.boardId, rootBoardId: SCOPE.boardId, generation: 1, state, supersededBy: state === "superseded" ? `${SCOPE.boardId}@r2` : null, parentBoardId: null, currentBoardId: state === "superseded" ? `${SCOPE.boardId}@r2` : SCOPE.boardId }) } as unknown as DurableBoardLineageStore;
}

export interface ReadOptions {
  readonly now?: number;
  readonly registry?: readonly ProviderRow[];
  readonly transferVersions?: readonly TransferVersion[];
  readonly lineageState?: "current" | "superseded";
  readonly observations?: boolean;
}

/** GET /api/pcb-sync?boardId=..&include=manufacturing through the core, composed as the route composes it (the observation reader over B2's record). */
export async function readSummary(workflow: DurableWorkflowRepository, record: ReturnType<typeof makeBoardRecord> | null, options: ReadOptions = {}): Promise<{ status: number; summary: PcbSyncManufacturingSummary }> {
  const observations = options.observations === false ? undefined : createProviderObservationReader({ exchanges: createProviderExchangeLedger(workflow), ...(options.registry ? { registry: options.registry } : {}), transferVersions: options.transferVersions ?? TRANSFER });
  const reader = createManufacturingSummaryReader(workflow, { ...(observations ? { observations } : {}), now: () => options.now ?? NOW });
  const core = createPcbSyncBoardGetCore(boardRead(record), () => "opt_in", reader, options.lineageState ? lineage(options.lineageState) : undefined);
  const response = await core({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId }, { boardId: SCOPE.boardId, include: "manufacturing" }, ADMIN);
  const body = (await response.json()) as { manufacturing: PcbSyncManufacturingSummary };
  return { status: response.status, summary: body.manufacturing };
}

/** A project whose authority, release and board are current, with one acknowledged answer for that release. */
export async function currentWorld(options: AnswerOptions = {}): Promise<{ workflow: InMemoryDurableWorkflowRepository; saved: { revision: number; recordDigest: string }; attempt: ExchangeAttempt }> {
  const workflow = new InMemoryDurableWorkflowRepository();
  const saved = await saveAuthority(workflow, BOARD.board);
  await recordRelease(workflow, saved, BOARD.board);
  const attempt = await recordAnswer(workflow, options);
  return { workflow, saved, attempt };
}
