/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.5: "supported SPICE generation ... must consume the whole design"; J.4 scoped
 * connections; OD-258 item 1): the SPICE node assignment of a project organised into sheets, shared by the Theory deck
 * (app/lib/netlist.ts schematicToSpice, behind POST /api/simulate) and the Studio IR (app/lib/spice/ir.ts compileCanonicalIr, behind
 * POST /api/spice/compile and the Studio worker). Both read THE project connectivity (app/lib/schematic/project-connectivity.ts) and
 * name their nodes from its nets, so a child sheet's local label or coordinate never aliases another sheet's; both keep their
 * single-sheet bodies untouched (those decks are pinned byte for byte by j1-sheet-operations and j4-ir-sheets).
 *
 * Node names (OD-258 item 1): a named net takes its project name sanitized to SPICE's `[A-Za-z0-9_+.-]` (a sheet-local net
 * "IMU/I2C_SCL" becomes IMU_I2C_SCL; a rail keeps its exact name: +3V3, VBAT, AGND); a sanitized name already taken - or reserved,
 * because ngspice reads `0` and `GND` as ground - takes the first free "_2", "_3" suffix in net-identity order; every unnamed net is
 * N001, N002 ... in sorted net-identity order (identities are endpoint-based: stable under renames and re-layouts). Names are compared
 * case-insensitively, as ngspice does.
 * Ground (the strict rule, OD-255 items 2-3): node 0 is the GND rail - the ground net that carries a Theory ground symbol or is named
 * GND or 0; when no net qualifies and exactly one ground rail exists, that lone return is node 0 (the LEGACY_GROUND_RENAMED design) and
 * a warning says so; when several ground rails exist and none is GND, the deck is refused SIM_GROUND_AMBIGUOUS naming them. Every
 * OTHER ground rail (AGND, DGND, PGND ...) is a separate named node - never collapsed into 0 - with a deck comment and a response
 * warning. A plain kind-"label" label named GND or 0 is a LOCAL net under the strict rule (never node 0): it is named in a warning.
 * Structural errors (`ok: false`: a missing port, a cycle, a dangling sheet reference, a net-name collision) and, when the caller asks,
 * KiCad parts whose pins are unknown refuse SIM_SHEET_HIERARCHY_INVALID: nothing is guessed.
 * Probe keys: a point on the probe sheet (the root unless the caller names another existing sheet) is keyed bare "x,y" as before, so
 * the editor's bare-key probes work on the sheet it shows; a point on any other sheet is keyed "<sheetId>|x,y" ("|" is JSON-safe and
 * never part of a point key), so coincident points on two sheets never share a probe entry.
 * Pure: no I/O, no randomness, no network.
 */
import { pointKey } from "@/app/lib/geometry";
import { resolveProjectConnectivity, type PartPinsLookup, type ProjectConnectivity, type ProjectNet } from "@/app/lib/schematic/project-connectivity";
import { sheetPathName, sheetsOf } from "@/app/lib/schematic/sheets";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { ROOT_SHEET_ID, netLabelNameKey, type Point, type SchematicState } from "@/lib/schematic-types";

/** The structured refusal codes POST /api/simulate maps to `code` (an `Error` whose message starts with `<CODE>: `). */
export const SIM_SHEET_HIERARCHY_INVALID = "SIM_SHEET_HIERARCHY_INVALID";
export const SIM_GROUND_AMBIGUOUS = "SIM_GROUND_AMBIGUOUS";

/** Node names ngspice reads as the ground node whatever the deck says (case-insensitive). */
const RESERVED_NODE_NAMES: ReadonlySet<string> = new Set(["0", "GND"]);

/** A project net name as a SPICE node token: `[A-Za-z0-9_+.-]` kept, everything else "_" (the Studio IR's rule); empty -> "N". */
export function spiceNodeName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_+.-]/g, "_");
  return cleaned === "" ? "N" : cleaned;
}

/** The probe key of a point: bare "x,y" on the probe sheet, "<sheetId>|x,y" elsewhere. */
export function spiceProbeKey(sheetId: string, point: Point, probeSheetId: string): string {
  return sheetId === probeSheetId ? pointKey(point) : `${sheetId}|${pointKey(point)}`;
}

export interface ProjectSpiceNodesOptions {
  /** Which consumer refuses (named in the refusal message): the Theory deck or the Studio IR. */
  consumer: "spice" | "spice-ir";
  /** KiCad pin positions (the Studio IR hands its part snapshots; the Theory deck has no KiCad devices and passes none). */
  getPart?: PartPinsLookup;
  /** Refuse when a KiCad part's pins are unknown (the Studio IR: a device whose pins cannot be placed is never guessed). */
  requireResolvedParts?: boolean;
  /** The sheet whose points take bare probe keys (the editor's active sheet); the root when absent or unknown (then a warning). */
  probeSheetId?: string;
}

export interface ProjectSpiceNodes {
  conn: ProjectConnectivity;
  /** Net identity -> node name, for every net of the project (ground: "0"). */
  nodeOfNet: Map<string, string>;
  /** The net that is node 0, or null when the project has no ground rail. */
  groundNetId: string | null;
  /** Response warnings: separate returns, a lone non-GND ground used as node 0, plain GND-named labels, an unknown probe sheet. */
  warnings: string[];
  /** Deck comment lines (without the leading "* "). */
  comments: string[];
  /** The sheet whose points are keyed bare. */
  probeSheetId: string;
  /** The node name at a point on a sheet, or null when no net is there (a wire island without a pin or label). */
  nodeAt(sheetId: string, point: Point): string | null;
  /** The probe key of a point on a sheet. */
  keyOf(sheetId: string, point: Point): string;
}

const isGroundName = (net: ProjectNet): boolean => net.name !== null && RESERVED_NODE_NAMES.has(netLabelNameKey(net.name));
const describeNet = (state: SchematicState, net: ProjectNet): string => {
  const where = net.sheetIds.map((id) => (id === ROOT_SHEET_ID ? "the overview" : `sheet "${sheetPathName(state, id)}"`)).join(", ");
  return `${net.name ?? "(unnamed)"} on ${where}`;
};

/**
 * Resolve the project connectivity of `state` and assign every net its SPICE node name under the rules in the header. Throws an
 * `Error` whose message starts with SIM_SHEET_HIERARCHY_INVALID or SIM_GROUND_AMBIGUOUS (structured for the routes); never guesses.
 */
export function projectSpiceNodes(state: SchematicState, options: ProjectSpiceNodesOptions): ProjectSpiceNodes {
  const conn = resolveProjectConnectivity(state, options.getPart);
  const nothing = options.consumer === "spice" ? "nothing was simulated" : "nothing was compiled";
  if (!conn.ok) {
    const errors = conn.diagnostics.filter((item) => item.severity === "error");
    throw new Error(`${SIM_SHEET_HIERARCHY_INVALID}: the sheet structure of this project has ${errors.length} error(s): ${errors.map((item) => `${item.code}: ${item.message}`).join(" ")} Fix them in the Sheets panel; ${nothing}`);
  }
  if (options.requireResolvedParts && conn.unresolvedPartIds.length > 0) {
    throw new Error(`${SIM_SHEET_HIERARCHY_INVALID}: the catalog pins of ${conn.unresolvedPartIds.length} part(s) are unknown (${conn.unresolvedPartIds.join(", ")}): a project organised into sheets is compiled only from resolved parts, so their pins are never placed by guess; ${nothing}`);
  }
  const warnings: string[] = [];
  const comments: string[] = [];

  // ground: the strict rule
  const groundNets = conn.nets.filter((net) => net.kind === "ground" || (net.kind === "power" && isGroundName(net)));
  const qualified = groundNets.filter((net) => net.groundSymbol || isGroundName(net));
  let ground: ProjectNet | null = null;
  if (qualified.length === 1) ground = qualified[0]!;
  else if (qualified.length > 1) throw new Error(`${SIM_GROUND_AMBIGUOUS}: ${qualified.length} different ground rails could each be node 0 (${qualified.map((net) => describeNet(state, net)).join("; ")}): make them one rail or keep one of them named GND; ${nothing}`);
  else if (groundNets.length === 1) {
    ground = groundNets[0]!;
    warnings.push(`Node 0 is the ground rail ${ground.name}: the project's only ground rail (no rail is named GND).`);
    comments.push(`node 0 is the ground rail ${ground.name} (the project's only ground rail; no rail is named GND)`);
  } else if (groundNets.length > 1) {
    throw new Error(`${SIM_GROUND_AMBIGUOUS}: ${groundNets.length} ground rails and none is named GND (${groundNets.map((net) => describeNet(state, net)).join("; ")}): name the reference return GND (or 0), or tie them explicitly; ${nothing}`);
  }

  // names: named nets first (project names sanitized; collisions and reserved names suffixed), then N001.. for the unnamed
  const byIdentity = [...conn.nets].sort((a, b) => compareCodePoints(a.id, b.id));
  const used = new Set<string>(RESERVED_NODE_NAMES);
  const nodeOfNet = new Map<string, string>();
  if (ground) nodeOfNet.set(ground.id, "0");
  const claim = (base: string): string => {
    let unique = base;
    for (let suffix = 2; used.has(unique.toUpperCase()); suffix += 1) unique = `${base}_${suffix}`;
    used.add(unique.toUpperCase());
    return unique;
  };
  for (const net of byIdentity) if (net !== ground && net.name !== null) nodeOfNet.set(net.id, claim(spiceNodeName(net.name)));
  let anonymous = 1;
  for (const net of byIdentity) {
    if (net === ground || net.name !== null) continue;
    let candidate = `N${String(anonymous++).padStart(3, "0")}`;
    while (used.has(candidate.toUpperCase())) candidate = `N${String(anonymous++).padStart(3, "0")}`;
    used.add(candidate.toUpperCase());
    nodeOfNet.set(net.id, candidate);
  }

  // the other ground rails stay their own nodes; plain GND-named labels are local nets
  for (const net of groundNets) {
    if (net === ground) continue;
    const node = nodeOfNet.get(net.id)!;
    warnings.push(`The ground rail ${net.name} is a separate return and not node 0 (node ${node}); tie it to the GND rail explicitly if the two returns are one.`);
    comments.push(`separate return ${net.name} is not node 0; tie it explicitly if it should be`);
  }
  for (const net of conn.nets) {
    if (net.kind !== "label") continue;
    const plain = net.labels.filter((label) => label.kind === "label" && label.scope === "local" && RESERVED_NODE_NAMES.has(netLabelNameKey(label.name)));
    if (plain.length === 0) continue;
    const where = [...new Set(plain.map((label) => (label.sheetId === ROOT_SHEET_ID ? "the overview" : `sheet "${sheetPathName(state, label.sheetId)}"`)))].join(", ");
    warnings.push(`The plain label ${plain[0]!.name} on ${where} is a local net (node ${nodeOfNet.get(net.id)}), not node 0: a label of kind "label" never is the ground rail. Use a ground symbol or a ground-kind label for the reference return.`);
  }

  // probe sheet: the one the caller names when it exists, else the root
  let probeSheetId: string = ROOT_SHEET_ID;
  if (options.probeSheetId !== undefined) {
    if (sheetsOf(state).some((sheet) => sheet.id === options.probeSheetId)) probeSheetId = options.probeSheetId;
    else warnings.push(`The probe sheet ${options.probeSheetId} is not a sheet of this project: the overview's points are keyed bare.`);
  }

  return {
    conn,
    nodeOfNet,
    groundNetId: ground?.id ?? null,
    warnings,
    comments,
    probeSheetId,
    nodeAt: (sheetId, point) => { const net = conn.netAt(sheetId, point); return net ? nodeOfNet.get(net.id) ?? null : null; },
    keyOf: (sheetId, point) => spiceProbeKey(sheetId, point, probeSheetId),
  };
}
