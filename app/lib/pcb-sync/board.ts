import { pcbRevisionId, pcbRevisionPayload } from "../pcb/revision";
import type { PcbBoard } from "../pcb/types";
import { pcbSyncDigest } from "./stable";
import type { BoardTransferAssessment, PcbSyncBoardClass, PcbSyncBoardRecord, PcbSyncIssue, PcbSyncRiskClass } from "./types";
import { pcbSyncIssue } from "./validation";
import { compareCodePoints } from "@/app/lib/stable-compare";

export function boardDigest(board: PcbBoard): string { return pcbSyncDigest(pcbRevisionPayload(board)); }

export function makeBoardRecord(input: { tenantId: string; projectId: string; branchId: string; boardId: string; board: PcbBoard; updatedAt: string }): PcbSyncBoardRecord {
  const board = structuredClone(input.board);
  return { ...input, board, revision: pcbRevisionId(board), digest: boardDigest(board) };
}

/** [B16-C.1] the board class the sync boundary reasons about (routed / zoned / constrained / …), for callers outside inspection. */
export function classifyBoard(board: PcbBoard): { boardClass: PcbSyncBoardClass; risk: PcbSyncRiskClass; constrained: boolean } { return classify(board); }

function classify(board: PcbBoard): { boardClass: PcbSyncBoardClass; risk: PcbSyncRiskClass; constrained: boolean } {
  const constrained = Boolean(board.constraintState || board.netClassing || board.routingKeepouts?.length || board.stackupConfig?.copperLayers.some((layer) => layer.role === "plane"));
  if ((board as { formatVersion?: number }).formatVersion !== 1) return { boardClass: "unsupported", risk: "unsupported_unknown", constrained };
  if (board.tracks.length || board.vias.length) return { boardClass: "routed", risk: "copper_affecting", constrained };
  if (board.zones.length) return { boardClass: "zoned", risk: "copper_affecting", constrained };
  if (constrained) return { boardClass: "constrained", risk: "constraint_affecting", constrained };
  if (board.footprints.some((footprint) => footprint.locked || footprint.placementConstraints?.fixedPosition)) return { boardClass: "locked_unrouted", risk: "placement_affecting", constrained };
  if (board.footprints.length) return { boardClass: "placed_unrouted", risk: "unrouted_structural", constrained };
  return { boardClass: "empty_unrouted", risk: "none", constrained };
}

export function inspectBoard(boardId: string, record: PcbSyncBoardRecord | null, newBoardTemplate?: PcbBoard): BoardTransferAssessment {
  const board = record?.board ?? newBoardTemplate;
  const blockers: PcbSyncIssue[] = [];
  if (!board) blockers.push(pcbSyncIssue({ code: "PS_NEW_BOARD_TEMPLATE_MISSING", scope: "board", message: "A validated project board template with outline and stack-up is required.", stableIds: [boardId], remediation: "board_template" }));
  const classified = board ? classify(board) : { boardClass: "unsupported" as const, risk: "unsupported_unknown" as const, constrained: false };
  if (classified.boardClass === "unsupported") blockers.push(pcbSyncIssue({ code: "PS_BOARD_FORMAT_UNSUPPORTED", scope: "board", message: "Board format is unsupported by the Stage 3 lossless JSON adapter.", stableIds: [boardId], remediation: "board_format" }));
  const unknownConstructs = board ? Object.keys(board as unknown as Record<string, unknown>).filter((key) => !new Set(["formatVersion", "identityVersion", "stackup", "stackupConfig", "outline", "nets", "footprints", "tracks", "vias", "zones", "texts", "netClassing", "silkItems", "padstacks", "routingPreferences", "routingKeepouts", "routingHistory", "placementPolicy", "placementPreferences", "constraintState"]).has(key)).sort() : [];
  if (unknownConstructs.length) blockers.push(pcbSyncIssue({ code: "PS_BOARD_UNKNOWN_CONSTRUCT", scope: "board", message: "Board contains constructs outside the proven lossless adapter profile.", stableIds: [boardId], remediation: "unsupported_construct" }));
  return {
    boardId,
    boardClass: unknownConstructs.length ? "unsupported" : classified.boardClass,
    formatSupported: Boolean(board) && classified.boardClass !== "unsupported" && unknownConstructs.length === 0,
    backend: "sirkit_json_board",
    boardRevision: record?.revision ?? null,
    boardDigest: record?.digest ?? null,
    footprintCount: board?.footprints.length ?? 0,
    netCount: board?.nets.length ?? 0,
    trackCount: board?.tracks.length ?? 0,
    viaCount: board?.vias.length ?? 0,
    zoneCount: board?.zones.length ?? 0,
    lockedFootprintCount: board?.footprints.filter((footprint) => footprint.locked || footprint.placementConstraints?.fixedPosition).length ?? 0,
    constrained: classified.constrained,
    unknownConstructs,
    risk: unknownConstructs.length ? "unsupported_unknown" : classified.risk,
    blockers: blockers.sort((a, b) => compareCodePoints(a.code, b.code)),
    warnings: [],
  };
}

