/**
 * [B18-E E13] The BOUNDED via read.
 *
 * Scenario 2 ("Change every via on the 5 V net to 0.7 mm diameter and 0.35 mm drill.") needs facts no agent-visible surface
 * carried. The full AI snapshot lists vias and net names, but it is the whole board — and vias only exist once a board is
 * ROUTED, where that snapshot measures 70,173 / 72,453 characters against the loop's 60,000-character result budget, so the
 * model receives `output_too_large_for_model` and cannot resolve a net name to via ids at all. Worse, even where it fits,
 * the snapshot STRIPS the fact that decides the outcome: a via bound to a padstack takes its size and drill from that
 * padstack, so a size/drill change on it is refused `padstack-bound` — and board LOAD binds every via. The model could only
 * discover that by being refused, and could not name a padstack to retarget onto because the library was never shown.
 *
 * This read answers exactly that: which nets carry vias (so a name can be resolved, or truthfully found absent), the named
 * net's vias with their padstack binding, and the board's via padstack library — the only geometry a bound via can be
 * retargeted onto. Nothing else: no tracks, pads, zones, footprints or validations. Its size depends only on the caps below.
 *
 * It states no DRC floor. The floors are a property of the active preset, which this read does not receive; board-inspect's
 * per-net `rules` carries them, and the compiler refuses `weakened-minimum` truthfully. A guess is not a fact.
 */
import type { PcbBoard, Via } from "../types";
import type { Padstack } from "../padstack/types";

const NM_PER_MM = 1_000_000;
const mm = (nm: number): number => nm / NM_PER_MM;

/** Caps, so one dense board can never blow the model's result budget. The TRUE count is always reported beside each list. */
export const MAX_VIA_NETS = 64;
export const MAX_VIAS = 64;
export const MAX_VIA_PADSTACKS = 32;

export interface ViaPadstackFacts {
  id: string;
  name: string;
  outerMm: number;
  drillMm: number;
}

export interface ViaFacts {
  id: string;
  positionMm: { x: number; y: number };
  diameterMm: number;
  drillMm: number;
  startLayerId: string;
  endLayerId: string;
  locked: boolean;
  /** The padstack this via takes its size and drill FROM, when it is bound to one: then a size/drill change is refused
   *  `padstack-bound` and the only proposable route is retargeting onto another padstack in `viaPadstacks`. */
  padstack: ViaPadstackFacts | null;
}

export interface ViaSnapshot {
  units: "mm";
  boardRevisionId: string | null;
  /** The net name this read was asked for, exactly as it was asked (never re-spelled or guessed at). */
  requestedNetName: string | null;
  /** The net that name matched, or null — including when a name was asked for and matched nothing. */
  net: { netId: number; name: string } | null;
  /** Every net carrying at least one via: how a name is resolved to via ids, and what to say when none matches. */
  netsWithVias: Array<{ netId: number; name: string; viaCount: number }>;
  netsWithViasCount: number;
  /** The matched net's vias. Empty when no net was asked for or none matched — never another net's vias. */
  vias: ViaFacts[];
  viaCount: number;
  /** Every VIA padstack the board has: the complete set of geometry a bound via can be retargeted onto. A pair that is not
   *  here cannot be reached by any proposal — creating a padstack is a human step in the editor. */
  viaPadstacks: ViaPadstackFacts[];
  viaPadstackCount: number;
}

const padstackFacts = (padstack: Padstack): ViaPadstackFacts => ({ id: padstack.id, name: padstack.name, outerMm: mm(padstack.outerNm), drillMm: mm(padstack.drillNm) });

function viaFacts(via: Via, padstacks: readonly Padstack[]): ViaFacts {
  const bound = via.padstackId ? padstacks.find((padstack) => padstack.id === via.padstackId) : undefined;
  return {
    id: via.id,
    positionMm: { x: mm(via.at.x), y: mm(via.at.y) },
    diameterMm: mm(via.size),
    drillMm: mm(via.drill),
    startLayerId: via.layers[0],
    endLayerId: via.layers[1],
    locked: via.locked === true,
    padstack: bound ? padstackFacts(bound) : null,
  };
}

/**
 * Build the bounded via view of a board. `netName` is matched EXACTLY (case-insensitively, trimmed) against the board's own
 * net names: a read never guesses which net a person meant. A name that matches nothing returns `net: null` with every
 * via-bearing net listed, which is what an honest answer to "the 5 V net" on a board that has no such net is made of.
 */
export function buildViaSnapshot(board: PcbBoard, options: { netName?: string | null; boardRevisionId?: string | null } = {}): ViaSnapshot {
  const padstacks = (board.padstacks ?? []).filter((padstack) => padstack.kind === "via");
  const named = board.nets.filter((net) => net.id !== 0).map((net) => ({ netId: net.id, name: net.name || `net${net.id}`, vias: board.vias.filter((via) => via.netId === net.id) }));
  const withVias = named.filter((entry) => entry.vias.length > 0);
  const requested = typeof options.netName === "string" ? options.netName.trim() : "";
  const match = requested.length > 0 ? withVias.find((entry) => entry.name.toLowerCase() === requested.toLowerCase()) ?? null : null;
  return {
    units: "mm",
    boardRevisionId: options.boardRevisionId ?? null,
    requestedNetName: requested.length > 0 ? requested : null,
    net: match ? { netId: match.netId, name: match.name } : null,
    netsWithVias: withVias.slice(0, MAX_VIA_NETS).map((entry) => ({ netId: entry.netId, name: entry.name, viaCount: entry.vias.length })),
    netsWithViasCount: withVias.length,
    vias: match ? match.vias.slice(0, MAX_VIAS).map((via) => viaFacts(via, padstacks)) : [],
    viaCount: match ? match.vias.length : 0,
    viaPadstacks: padstacks.slice(0, MAX_VIA_PADSTACKS).map(padstackFacts),
    viaPadstackCount: padstacks.length,
  };
}
