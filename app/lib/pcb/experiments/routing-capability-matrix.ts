/**
 * [PR-F] The ROUTING CAPABILITY MATRIX (the owner's Astra directive, section 10: "keep a capability matrix proving which constraints
 * survive export, routing, import, and independent checking"): for each constraint kind the constraint / intent / stackup schemas can
 * express, whether it survives EXPORT (the DSN writer), ROUTING (the rules the DSN hands FreeRouting), IMPORT (the SES reader) and the
 * INDEPENDENT CHECK (DRC, connectivity, the compiled physical and application checks, the placement validator and objectives).
 *
 * Derived from code, not typed: every cell names the file and an ANCHOR line of text; `resolveRoutingCapabilityMatrix` reads the
 * current files, turns each anchor into `file:line` (the first line holding the anchor; a missing anchor is a problem, never a
 * guess), verifies every named kind is a member of `ConstraintKind` / `RelationshipKind` in app/lib/constraints/types.ts, and reads
 * the compiler's declared enforcement support per kind from its `DEFAULT_SUPPORT` table (a kind without an entry is `unsupported`,
 * the compiler's own fallback). The generator (scripts/generate-pr-f-routing-capability-matrix.ts) writes the CSV and summary; the gate
 * (__tests__/pr-f-capability-matrix.test.ts) regenerates and byte-compares them, so a moved line, a removed anchor or a changed
 * support entry is reviewed here first.
 *
 * Statuses: `exact` (carried as written), `conservative` (carried as the most restrictive value of a class, or as a scope), `advisory`
 * (a soft placement objective: evidence, never a pass/fail check), `post_route_check` (not carried into the router; checked on the
 * imported copper), `not_applicable` (the stage cannot see the constraint - the router moves no footprint), `unsupported` (no code
 * carries or checks it; the reason is mandatory). Verdicts are closed (`ROUTING_CAPABILITY_VERDICTS`). Section 10 says not to assume
 * FreeRouting enforces differential coupling, skew, impedance, return paths or every advanced via rule: those rows are expected and
 * pinned `unsupported` at the routing stage.
 */
export const ROUTING_CAPABILITY_MATRIX_SCHEMA = "sirkit.routing-capability-matrix.v1" as const;
export const ROUTING_CAPABILITY_STAGES = Object.freeze(["export", "routing", "import", "check"] as const);
export type RoutingCapabilityStage = (typeof ROUTING_CAPABILITY_STAGES)[number];
export const ROUTING_CAPABILITY_STATUSES = Object.freeze(["exact", "conservative", "advisory", "post_route_check", "not_applicable", "unsupported"] as const);
export type RoutingCapabilityStatus = (typeof ROUTING_CAPABILITY_STATUSES)[number];
export const ROUTING_CAPABILITY_VERDICTS = Object.freeze(["survives", "survives-conservatively", "placement-only", "check-only", "advisory-only", "scope-only", "unsupported"] as const);
export type RoutingCapabilityVerdict = (typeof ROUTING_CAPABILITY_VERDICTS)[number];
/** The rows section 10 names as not to be assumed enforced by FreeRouting; the gate pins their routing stage `unsupported`. */
export const DIRECTIVE_10_EXPECTED_UNSUPPORTED_ROUTING = Object.freeze(["differential-coupling-separation", "differential-skew", "impedance", "return-paths", "via-policy-per-net"] as const);
export const ROUTING_CAPABILITY_COLUMNS = Object.freeze(["id", "constraint", "kinds", "compiler_support", "export", "export_evidence", "routing", "routing_evidence", "import", "import_evidence", "check", "check_evidence", "verdict", "reason"] as const);

export interface CapabilityAnchor { readonly file: string; readonly anchor: string }
export interface CapabilityCell { readonly status: RoutingCapabilityStatus; readonly reason: string; readonly evidence: readonly CapabilityAnchor[] }
export interface RoutingCapabilityRowDefinition {
  readonly id: string;
  readonly constraint: string;
  /** Members of `ConstraintKind` or `RelationshipKind` (app/lib/constraints/types.ts); verified at resolution. */
  readonly kinds: readonly string[];
  readonly cells: Readonly<Record<RoutingCapabilityStage, CapabilityCell>>;
  /** The row-level reason (mandatory when any stage is unsupported). */
  readonly reason: string;
}

const WRITE_DSN = "app/lib/pcb/dsn/write-dsn.ts";
const READ_SES = "app/lib/pcb/dsn/read-ses.ts";
const PREFLIGHT = "app/lib/pcb/dsn/preflight.ts";
const VERIFICATION = "app/lib/pcb/autoroute/verification.ts";
const COMPLETION = "app/lib/pcb/autoroute/completion.ts";
const RUN_DRC = "app/lib/pcb/drc/run-drc.ts";
const DRC_CLEARANCE = "app/lib/pcb/drc/checks/clearance.ts";
const DRC_GEOMETRY = "app/lib/pcb/drc/checks/geometry.ts";
const DRC_CONTAINMENT = "app/lib/pcb/drc/checks/containment.ts";
const DRC_CONNECTIVITY = "app/lib/pcb/drc/checks/connectivity.ts";
const PHYSICAL_CHECKER = "app/lib/constraints/physical-checker.ts";
const APPLICATION_CHECKER = "app/lib/constraints/application-checker.ts";
export const CONSTRAINT_COMPILER = "app/lib/constraints/compiler.ts";
export const CONSTRAINT_TYPES = "app/lib/constraints/types.ts";
const PLACEMENT_VALIDATOR = "app/lib/pcb/placement/validator.ts";
const PLACEMENT_OBJECTIVES = "app/lib/pcb/placement/objectives.ts";
const PLACEMENT_TYPES = "app/lib/pcb/placement/types.ts";
const PLACEMENT_PROBLEM = "app/lib/pcb/placement/problem.ts";
const PLACEMENT_INTENT = "app/lib/pcb/placement/intent.ts";
const PCB_TYPES = "app/lib/pcb/types.ts";
const SMART_VALIDATOR = "app/lib/pcb/smart-routing/validator.ts";
const SMART_WORLD = "app/lib/pcb/smart-routing/world.ts";
const STACKUP = "app/lib/pcb/stackup.ts";
const CAPABILITY_PROFILE = "app/lib/pcb/autonomous/capability-profile.ts";

const at = (file: string, anchor: string): CapabilityAnchor => ({ file, anchor });
const cell = (status: RoutingCapabilityStatus, reason: string, ...evidence: CapabilityAnchor[]): CapabilityCell => ({ status, reason, evidence });

// The writer emits per class exactly `(rule (width) (clearance))`, `use_via` and per-layer widths, and the board's layers / boundary /
// via padstacks / protected wiring (write-dsn.ts writeDsn): everything else below is "not written" by construction.
const ONLY_RULES_WRITTEN = at(WRITE_DSN, "(rule (width ${n(rule.widthNm)}) (clearance");
const ROUTER_MOVES_NO_FOOTPRINT = at(WRITE_DSN, "(place ${q(c.ref)} 0 0 front 0)");
const SES_WIRES_AND_VIAS_ONLY = at(READ_SES, "for (const wire of children(netList, \"wire\")) {");
const NO_DEFAULT_SUPPORT = at(CONSTRAINT_COMPILER, "support: \"unsupported\" as const,");

export const ROUTING_CAPABILITY_ROWS: readonly RoutingCapabilityRowDefinition[] = Object.freeze([
  {
    id: "connectivity-conservation",
    constraint: "Connectivity: nets, pins and endpoint identities (the base every other row stands on)",
    kinds: ["terminal_connection"],
    cells: {
      export: cell("exact", "every net and pin travels with a conservation manifest (stable net ids, endpoint keys, physical pad instances) that the DSN preflight checks net by net", at(WRITE_DSN, "nets: electricalTruth.nets.map((net) => ({"), at(WRITE_DSN, "expectedEndpoints: expectedEndpoints.sort("), at(PREFLIGHT, "DSN manifest does not conserve stable net")),
      routing: cell("exact", "FreeRouting receives each net's pins and routes within the class; existing copper is `protect`ed", at(WRITE_DSN, "(pins ${pins})"), at(WRITE_DSN, "(wire (path ${layerToken(item.layer)}")),
      import: cell("exact", "the SES reader resolves every net through the exact manifest and rejects a stale source revision whole", at(READ_SES, "const netId = netIdByName.get(netName);"), at(READ_SES, "code: \"STALE_ELECTRICAL_REPORT\",")),
      check: cell("exact", "connectivity is re-derived from geometry per net (required / completed / remaining connections, shorts) and DRC flags incomplete nets and shorts", at(VERIFICATION, "export function verifyAutorouteCandidate("), at(VERIFICATION, "complete: status.realizationState === \"proven\" && remaining === 0,"), at(DRC_CONNECTIVITY, "kind: \"incompleteNet\","), at(DRC_CONNECTIVITY, "kind: \"short\",")),
    },
    reason: "survives every stage; an unrouted connection is reported per net, never hidden",
  },
  {
    id: "net-class-width-clearance",
    constraint: "Net classes: track width and copper clearance (Default / Power / HighCurrent, compiled per net)",
    kinds: ["trace_width", "clearance"],
    cells: {
      export: cell("conservative", "one `(rule (width) (clearance))` per USED class, the most restrictive value across the class's member nets (declared `conservative` in the manifest when members differ); a board-wide default rule too", at(WRITE_DSN, "scope: { kind: \"class\", classId },"), at(WRITE_DSN, "clearanceNm: resolvedByClass.get(\"Default\")!.clearance,"), at(WRITE_DSN, "disposition: \"conservative\",")),
      routing: cell("exact", "FreeRouting applies the class rule (`(class ... (rule (width) (clearance)))`) and the per-layer width rule", ONLY_RULES_WRITTEN, at(WRITE_DSN, "(layer_rule ${layer.name} (rule (width ${n(width)})))")),
      import: cell("exact", "each imported wire carries its width; clearance is geometry and is re-measured, not read", at(READ_SES, "const width = rawWidth == null ? undefined : scaledInteger(rawWidth, resolution.scale);")),
      check: cell("exact", "DRC re-measures clearance and minimum width per net against the merged fabrication rules and the compiled class (the stricter of the two)", at(RUN_DRC, "clearanceNm: Math.max(fabrication.clearanceNm, design.clearance),"), at(DRC_CLEARANCE, "export function checkCopperClearance(ctx: DrcCheckContext): DrcViolation[] {"), at(DRC_GEOMETRY, "export function checkMinTrackWidth(ctx: DrcCheckContext): DrcViolation[] {")),
    },
    reason: "survives; a class whose members differ is routed at the most restrictive member's values (never relaxed)",
  },
  {
    id: "via-policy-board",
    constraint: "Via policy, board-wide: via size / drill per class, through vias only, vias allowed and via costs",
    kinds: ["via_diameter", "via_drill", "annular_ring"],
    cells: {
      export: cell("exact", "one via padstack candidate per class (most restrictive size / drill), spanning the whole enabled stack (through), plus `(vias on|off)` and the via costs of the stackup's routing settings", at(WRITE_DSN, "Object.keys(VIA_NAME_BY_CLASS)"), at(WRITE_DSN, "startLayer: dsnLayers[0].name,"), at(WRITE_DSN, "(vias ${dsn.routingSettings.viasAllowed"), at(STACKUP, "viasAllowed: boolean;")),
      routing: cell("exact", "FreeRouting chooses from the offered via padstacks only (`use_via` per class); an unoffered via cannot appear", at(WRITE_DSN, "(circuit (use_via"), at(WRITE_DSN, "(via ${dsn.vias.map")),
      import: cell("exact", "a via is accepted only when its padstack name is in the export manifest; its layer span is the padstack's", at(READ_SES, "const padstack = padstackByName.get(padstackName);"), at(READ_SES, "layers: [layers[0], layers[layers.length - 1]],")),
      check: cell("exact", "DRC re-measures via outer diameter, drill and annular ring and refuses an unsupported via span; the autonomous envelope admits full through vias only", at(DRC_GEOMETRY, "export function checkVia(ctx: DrcCheckContext): DrcViolation[] {"), at(DRC_CONTAINMENT, "\"unsupportedViaSpan\", \"error\", [ref], via.at,"), at(CAPABILITY_PROFILE, "CAP_VIA_TYPE_UNSUPPORTED")),
    },
    reason: "survives for the board-wide through-via policy; blind / buried / micro vias have no representation here (directive section 9)",
  },
  {
    id: "via-policy-per-net",
    constraint: "Via policy per net: allowed via type / span and a maximum via count for one net",
    kinds: ["via_type", "via_span", "via_count"],
    cells: {
      export: cell("unsupported", "the writer declares it cannot prove a per-net via type / span policy (manifest `constraintLoss`, severity error) and defers a per-net via count to a post-route check", at(WRITE_DSN, "cannot prove the exact per-net via type/span policy"), at(WRITE_DSN, "requires deterministic post-route evaluation")),
      routing: cell("unsupported", "FreeRouting's class rule carries no per-net via restriction and no via count; a per-net rule would need a class per net the writer does not emit", ONLY_RULES_WRITTEN),
      import: cell("not_applicable", "the SES reader imports wires and vias; it enforces no policy", SES_WIRES_AND_VIAS_ONLY),
      check: cell("post_route_check", "the compiled physical checker evaluates via type / span and via count per net on the imported copper (hard rules)", at(PHYSICAL_CHECKER, "} else if (rule.kind === \"via_type\" || rule.kind === \"via_span\") {"), at(PHYSICAL_CHECKER, "} else if (rule.kind === \"via_count\") {")),
    },
    reason: "check-only: the router is not told; a violation surfaces after import and the candidate stays unproven for that net",
  },
  {
    id: "layer-policy-per-net",
    constraint: "Layer policy per net: allowed / forbidden / preferred copper layers for one net",
    kinds: ["allowed_layers", "forbidden_layers", "preferred_layers"],
    cells: {
      export: cell("unsupported", "the writer declares it cannot preserve a per-net layer set (manifest `constraintLoss`, severity error); only the board-wide `layer_rule (active ...)` is written", at(WRITE_DSN, "cannot preserve the exact per-net layer set"), at(WRITE_DSN, "(active ${layer.autorouteEnabled ? \"on\" : \"off\"})")),
      routing: cell("unsupported", "FreeRouting routes every net on every active layer; preferred direction costs are per layer, not per net", at(WRITE_DSN, "(preferred_direction ${layer.preferredDirection})")),
      import: cell("exact", "every imported wire's layer is resolved through the manifest or the import is rejected", at(READ_SES, "const layer = layerName ? layerByName.get(layerName) : undefined;")),
      check: cell("post_route_check", "the compiled physical checker evaluates allowed / forbidden layers per net on the imported copper; a preferred layer is advisory (compiled for the routing graph only)", at(PHYSICAL_CHECKER, "if (rule.kind === \"allowed_layers\" || rule.kind === \"forbidden_layers\") {")),
    },
    reason: "check-only: a per-net layer restriction is found after routing, not obeyed during it",
  },
  {
    id: "stackup-layer-roles",
    constraint: "Stackup: enabled copper layers, signal / plane roles, plane nets, preferred directions, board thickness",
    kinds: ["zone_connection"],
    cells: {
      export: cell("exact", "enabled copper layers with their role (signal / power), a current plane fill per plane layer, and per-layer active / preferred-direction rules", at(WRITE_DSN, "function activeDsnLayers(board: PcbBoard): DsnLayer[] {"), at(WRITE_DSN, "(plane ${q(layer.plane.netName)}"), at(STACKUP, "export interface BoardStackup {")),
      routing: cell("exact", "FreeRouting routes on active layers, honours preferred-direction costs and plane via costs", at(WRITE_DSN, "(active ${layer.autorouteEnabled ? \"on\" : \"off\"})"), at(WRITE_DSN, "(plane_via_costs ${planeViaCost})")),
      import: cell("exact", "layers are resolved through the manifest's layer ledger; an unknown layer rejects the import", at(READ_SES, "code: \"SES_LAYER_UNKNOWN\",")),
      check: cell("exact", "DRC refuses copper on a disabled layer and unsupported via spans and re-checks zone fills; the autonomous envelope admits exactly the two-layer signal stackup", at(DRC_CONTAINMENT, "\"disabledLayer\", \"error\", [ref], boxCenter(shapeBBox(trackShape(track))),"), at(RUN_DRC, "{ code: \"zone-fills\", run: () => checkZoneFills(ctx) },"), at(CAPABILITY_PROFILE, "CAP_TWO_LAYER_SIGNAL_STACKUP_REQUIRED")),
    },
    reason: "survives for the represented stackup; dielectric / material data has no field in BoardStackup (thickness only), so no impedance-bearing stackup fact exists",
  },
  {
    id: "keepouts",
    constraint: "Routing keepouts (board polygons forbidding tracks / vias) and constraint keepout regions",
    kinds: ["keepout"],
    cells: {
      export: cell("unsupported", "the DSN writer emits no keepout: boundary, layers, padstacks, components, networks, rules and protected wiring only", at(WRITE_DSN, "(boundary (path pcb 0 ${closed}))"), at(PCB_TYPES, "export interface RoutingKeepout {")),
      routing: cell("unsupported", "FreeRouting never sees a keepout polygon and may route through one", ONLY_RULES_WRITTEN),
      import: cell("not_applicable", "the SES reader imports wires and vias; it checks no keepout", SES_WIRES_AND_VIAS_ONLY),
      check: cell("unsupported", "DRC has no keepout check (its ten checks are containment, clearance, width, via, PTH ring, hole, courtyard, silk, connectivity, zone fills); only the INTERACTIVE Smart Route validator refuses a route entering a keepout, and placement treats keepouts as regions (capacity, hard exclusion) - imported autorouter copper is never checked against a keepout", at(RUN_DRC, "{ code: \"containment-and-layers\", run: () => checkBoardContainmentAndLayers(ctx) },"), at(SMART_VALIDATOR, "? \"Route enters a copper keepout.\""), at(SMART_WORLD, "for (const keepout of board.routingKeepouts ?? []) {"), at(PLACEMENT_PROBLEM, "keepoutIds: (board.routingKeepouts ?? []).map((keepout) => keepout.id).sort(),"), at(PLACEMENT_VALIDATOR, "code: \"PLACEMENT_REGION_EXCLUSION\"")),
    },
    reason: "unsupported for autorouted copper: a required routing keepout is an explicit limitation of the FreeRouting path until the writer carries it and DRC checks it",
  },
  {
    id: "mechanical-envelope",
    constraint: "Mechanical envelope: board outline, edge clearance, courtyards, placement regions (mechanical / assembly)",
    kinds: ["edge_clearance", "courtyard_clearance", "placement_region"],
    cells: {
      export: cell("conservative", "the outline is written exactly as the boundary; the edge keep-out distance is NOT written (no DSN edge rule), so the router is bounded by the outline only", at(WRITE_DSN, "function boardBoundary(board: PcbBoard): DsnBoundary {"), at(WRITE_DSN, "(boundary (path pcb 0 ${closed}))")),
      routing: cell("conservative", "FreeRouting keeps copper inside the boundary; it has no edge-clearance rule here", ONLY_RULES_WRITTEN),
      import: cell("not_applicable", "the SES reader imports geometry; containment is re-checked after import", SES_WIRES_AND_VIAS_ONLY),
      check: cell("exact", "DRC re-measures edge clearance and refuses copper outside the board; courtyard overlap is checked; placement regions (containment / exclusion) are hard placement-validator rules and the compiled checker's region containment", at(DRC_CLEARANCE, "kind: \"edgeClearance\","), at(DRC_CONTAINMENT, "\"trackOutsideBoard\", \"error\", [ref], boxCenter(shapeBBox(trackShape(track))),"), at(DRC_GEOMETRY, "export function checkCourtyardOverlap(ctx: DrcCheckContext): DrcViolation[] {"), at(PLACEMENT_VALIDATOR, "code: \"PLACEMENT_REGION_CONTAINMENT\""), at(PHYSICAL_CHECKER, "} else if (rule.kind === \"placement_region\" && rule.requirement.form === \"containment\") {"), at(PLACEMENT_TYPES, "kind: \"room\" | \"keepout\" | \"mechanical\" | \"assembly\" | \"thermal\" | \"rf\";")),
    },
    reason: "survives conservatively: the router may route up to the edge; the edge-clearance violation is caught by DRC and the candidate stays unproven",
  },
  {
    id: "decoupling-proximity",
    constraint: "Decoupling proximity: a capacitor close to a specific power / ground pin (placement_proximity; decoupling relationship)",
    kinds: ["decoupling", "placement_proximity"],
    cells: {
      export: cell("not_applicable", "a placement constraint: the DSN bakes absolute pin positions and the router moves no footprint", ROUTER_MOVES_NO_FOOTPRINT),
      routing: cell("not_applicable", "routing cannot change a footprint position", ROUTER_MOVES_NO_FOOTPRINT),
      import: cell("not_applicable", "nothing to import", SES_WIRES_AND_VIAS_ONLY),
      check: cell("exact", "a hard `placement_proximity` distance rule is validated by the placement hard validator (source-backed distance only); the decoupling objective measures the closest same-rail terminal distance; the application checker verifies the decoupling relationship exists (count), not its distance", at(PLACEMENT_VALIDATOR, "candidate.kind === \"placement_proximity\" || candidate.kind === \"placement_separation\""), at(PLACEMENT_OBJECTIVES, "const decoupling = relationDistance(input.problem, input.placements, \"decoupling\");"), at(APPLICATION_CHECKER, "} else if (rule.kind === \"decoupling\") {"), at(PLACEMENT_INTENT, "\"corridors\", \"criticalNets\"]")),
    },
    reason: "placement-only: proved at placement by the hard validator (a soft objective otherwise); the router can neither honour nor violate it",
  },
  {
    id: "sensitive-analog-separation-placement",
    constraint: "Sensitive analog separation at placement: a minimum distance between an analog node's parts and an aggressor (placement_separation; aggressor_victim)",
    kinds: ["placement_separation", "aggressor_victim"],
    cells: {
      export: cell("not_applicable", "a placement constraint: the router moves no footprint", ROUTER_MOVES_NO_FOOTPRINT),
      routing: cell("not_applicable", "routing cannot change a footprint position", ROUTER_MOVES_NO_FOOTPRINT),
      import: cell("not_applicable", "nothing to import", SES_WIRES_AND_VIAS_ONLY),
      check: cell("exact", "a hard `placement_separation` distance rule is validated by the placement hard validator; the sensitive-separation objective uses source-backed distances only (unknown when none exists - never invented)", at(PLACEMENT_VALIDATOR, "candidate.kind === \"placement_proximity\" || candidate.kind === \"placement_separation\""), at(PLACEMENT_OBJECTIVES, "metrics.push(sourcedSeparation(input.problem, input.placements, \"sensitive_separation\",")),
    },
    reason: "placement-only for the footprint distance; the routed-copper separation is the next row",
  },
  {
    id: "sensitive-analog-routing-separation",
    constraint: "Sensitive analog separation of routed copper: extra spacing between an analog net and an aggressor net beyond the class clearance",
    kinds: ["aggressor_victim"],
    cells: {
      export: cell("unsupported", "no per-net-pair clearance exists in the DSN: the writer emits one clearance per class", ONLY_RULES_WRITTEN),
      routing: cell("unsupported", "FreeRouting keeps the class clearance only; it has no aggressor / victim rule", ONLY_RULES_WRITTEN),
      import: cell("not_applicable", "geometry only", SES_WIRES_AND_VIAS_ONLY),
      check: cell("unsupported", "DRC measures the class clearance only; no checker measures a net-pair spacing or coupling on routed copper, and the compiler lowers `aggressor_victim` into the placement graph only", at(DRC_CLEARANCE, "export function checkCopperClearance(ctx: DrcCheckContext): DrcViolation[] {"), at(CONSTRAINT_COMPILER, "placementGraph: graph.filter((item) => [\"decoupling\", \"current_loop\", \"placement_group\", \"aggressor_victim\", \"connector_edge\"].includes(item.kind)),")),
    },
    reason: "unsupported: a required analog routing separation is an explicit limitation of this path (a wider class clearance for the net is the qualified alternative)",
  },
  {
    id: "switching-loops",
    constraint: "Switching / current loops: keep a critical loop's members and copper small (critical_loop; current_loop)",
    kinds: ["critical_loop", "current_loop"],
    cells: {
      export: cell("unsupported", "no loop-area or net-ordering rule exists in the DSN", ONLY_RULES_WRITTEN),
      routing: cell("unsupported", "FreeRouting minimizes its own cost, not a loop area", ONLY_RULES_WRITTEN),
      import: cell("not_applicable", "geometry only", SES_WIRES_AND_VIAS_ONLY),
      check: cell("advisory", "the placement objective measures a perimeter PROXY for explicit current-loop members (soft, weighted); the compiler lowers `critical_loop` as compiled_for_consumer; no post-route loop-area checker exists", at(PLACEMENT_OBJECTIVES, "const loop = relationDistance(input.problem, input.placements, \"current_loop\");"), at(CONSTRAINT_COMPILER, "relationship.kind === \"differential_pair\" || relationship.kind === \"current_loop\"")),
    },
    reason: "advisory-only: a loop requirement is placement evidence, never a routed proof (not EMI, current-capacity or PI proof)",
  },
  {
    id: "connectors",
    constraint: "Connectors: edge placement, side and orientation of connectors (connector_edge; placementConstraints.edgeConnector / criticalRole)",
    kinds: ["connector_edge", "placement_side", "placement_orientation"],
    cells: {
      export: cell("not_applicable", "a placement constraint: the router moves no footprint", ROUTER_MOVES_NO_FOOTPRINT),
      routing: cell("not_applicable", "routing cannot change a footprint position", ROUTER_MOVES_NO_FOOTPRINT),
      import: cell("not_applicable", "nothing to import", SES_WIRES_AND_VIAS_ONLY),
      check: cell("exact", "hard side / orientation rules are checked by the compiled physical checker; the edge-connector distance is a soft placement objective (`mechanical_edge`); the board model carries the connector intent", at(PHYSICAL_CHECKER, "} else if (rule.kind === \"placement_fixed\" || rule.kind === \"placement_side\" || rule.kind === \"placement_orientation\") {"), at(PLACEMENT_OBJECTIVES, "kind: \"mechanical_edge\""), at(PCB_TYPES, "edgeConnector?: \"top\" | \"right\" | \"bottom\" | \"left\";")),
    },
    reason: "placement-only: side and orientation are hard-checked; the edge distance itself is advisory",
  },
  {
    id: "critical-net-priority",
    constraint: "Critical-net priority: route the named nets first / with precedence",
    kinds: ["topology"],
    cells: {
      export: cell("conservative", "no priority exists in the DSN; the only lever is SCOPE - the writer can offer a subset of nets as routable work (`includeNetIds`) with the rest protected", at(WRITE_DSN, "includeNetIds?: readonly number[];"), at(WRITE_DSN, "if (includedNetIds && !includedNetIds.has(net.id)) continue;")),
      routing: cell("conservative", "the completion loop routes a selected net set first (`selectedNetIds`), then the remaining incomplete nets; FreeRouting itself orders nothing by priority", at(COMPLETION, "selectedNetIds?: number[];"), at(COMPLETION, "const selected = options.selectedNetIds ? new Set(options.selectedNetIds) : undefined;")),
      import: cell("not_applicable", "geometry only", SES_WIRES_AND_VIAS_ONLY),
      check: cell("not_applicable", "an ordering preference has no pass / fail check; completion is measured per net (connectivity row); the placement intent carries priorities as data and states the engine takes no net-priority input", at(PLACEMENT_INTENT, "takes no net-priority input"), at(PLACEMENT_INTENT, "export const PLACEMENT_INTENT_SCHEMA = \"sirkit.placement-intent.v1\" as const;")),
    },
    reason: "scope-only: priority is realized as routing scope and sequence, never as a rule the router enforces",
  },
  {
    id: "return-paths",
    constraint: "Return paths: a signal net's return reference plane / net (return_reference)",
    kinds: ["return_reference"],
    cells: {
      export: cell("unsupported", "a current plane fill is written for a plane layer, but no return-reference relationship is: the writer has no construct for it", at(WRITE_DSN, "(plane ${q(layer.plane.netName)}"), ONLY_RULES_WRITTEN),
      routing: cell("unsupported", "FreeRouting routes to planes by cost (`plane_via_costs`) and knows no return-path requirement (directive section 10: do not assume it)", at(WRITE_DSN, "(plane_via_costs ${planeViaCost})")),
      import: cell("not_applicable", "geometry only", SES_WIRES_AND_VIAS_ONLY),
      check: cell("unsupported", "`return_reference` has no DEFAULT_SUPPORT entry, so the compiler marks it unsupported; the placement objective `plane_return_access` is an access-transition proxy, not a return-path proof; no post-route checker exists", NO_DEFAULT_SUPPORT, at(PLACEMENT_OBJECTIVES, "kind: \"plane_return_access\"")),
    },
    reason: "unsupported: a required return-path constraint is an explicit limitation of this path",
  },
  {
    id: "differential-coupling-separation",
    constraint: "Differential pair coupling / separation: paired nets routed together at a controlled gap",
    kinds: ["differential_pair"],
    cells: {
      export: cell("unsupported", "no differential-pair rule exists in the DSN the writer emits", ONLY_RULES_WRITTEN),
      routing: cell("unsupported", "FreeRouting receives two ordinary nets of a class; coupling is not assumed (directive section 10)", ONLY_RULES_WRITTEN),
      import: cell("not_applicable", "geometry only", SES_WIRES_AND_VIAS_ONLY),
      check: cell("unsupported", "the compiler lowers `differential_pair` as compiled_for_consumer (routing graph, later stage 8); the placement objective `high_speed_ordering` is an endpoint-span symmetry proxy; no checker measures gap or coupling on routed copper", at(CONSTRAINT_COMPILER, "relationship.kind === \"differential_pair\" || relationship.kind === \"current_loop\""), at(PLACEMENT_OBJECTIVES, "kind: \"high_speed_ordering\"")),
    },
    reason: "unsupported: a required differential coupling is an explicit limitation of this path",
  },
  {
    id: "differential-skew",
    constraint: "Differential pair skew / route length: the two members' routed lengths within a limit (pair_skew; route_length)",
    kinds: ["pair_skew", "route_length"],
    cells: {
      export: cell("unsupported", "no length or skew rule exists in the DSN the writer emits", ONLY_RULES_WRITTEN),
      routing: cell("unsupported", "FreeRouting does not length-match (directive section 10: do not assume skew is enforced)", ONLY_RULES_WRITTEN),
      import: cell("not_applicable", "geometry only; lengths are derived from the imported wires afterwards", SES_WIRES_AND_VIAS_ONLY),
      check: cell("post_route_check", "the compiled physical checker measures each member's routed length and their difference against the hard limit on the imported copper", at(PHYSICAL_CHECKER, "} else if (rule.kind === \"pair_skew\") {"), at(PHYSICAL_CHECKER, "const skew = Math.abs(routeLengthNm(board, ids[0]!) - routeLengthNm(board, ids[1]!));")),
    },
    reason: "check-only: skew is measured after routing (static length), never obeyed during it",
  },
  {
    id: "impedance",
    constraint: "Target impedance of a net or pair (target_impedance)",
    kinds: ["target_impedance"],
    cells: {
      export: cell("unsupported", "no impedance rule exists in the DSN the writer emits", ONLY_RULES_WRITTEN),
      routing: cell("unsupported", "FreeRouting has no impedance model (directive section 10)", ONLY_RULES_WRITTEN),
      import: cell("not_applicable", "geometry only", SES_WIRES_AND_VIAS_ONLY),
      check: cell("unsupported", "the compiler declares `target_impedance` unsupported (signal-integrity solver unavailable; needs validated stackup materials and a field solver); BoardStackup carries thickness only, no dielectric data (directive section 9: no impedance claim without the stackup data and a qualified checker)", at(CONSTRAINT_COMPILER, "target_impedance: { consumerId: \"signal-integrity-solver\""), at(STACKUP, "boardThicknessMm: number;")),
    },
    reason: "unsupported: a required impedance is an explicit limitation of this path",
  },
]);

// ── resolution (derived from the current files) ───────────────────────────────

export interface ResolvedCitation { readonly file: string; readonly line: number; readonly anchor: string }
export interface ResolvedCell { readonly status: RoutingCapabilityStatus; readonly reason: string; readonly citations: readonly ResolvedCitation[] }
export interface CompilerSupportEntry { readonly kind: string; readonly support: string; readonly consumerId: string; readonly citation: ResolvedCitation }
export interface ResolvedCapabilityRow {
  readonly id: string;
  readonly constraint: string;
  readonly kinds: readonly string[];
  readonly compilerSupport: readonly CompilerSupportEntry[];
  readonly cells: Readonly<Record<RoutingCapabilityStage, ResolvedCell>>;
  readonly verdict: RoutingCapabilityVerdict;
  readonly reason: string;
}
export interface ResolvedRoutingCapabilityMatrix { readonly rows: readonly ResolvedCapabilityRow[]; readonly problems: readonly string[] }

const LF = String.fromCharCode(10);
const lines = (text: string): string[] => text.replaceAll("\r\n", LF).split(LF);

/** The 1-based line of the FIRST line holding the anchor, or null. */
export function anchorLine(text: string, anchor: string): number | null {
  const index = lines(text).findIndex((line) => line.includes(anchor));
  return index < 0 ? null : index + 1;
}

/** The member names of a string-literal union type (`export type Name =` ... up to the first blank line) in a types file. */
export function unionMembers(text: string, typeName: string): Set<string> {
  const all = lines(text);
  const start = all.findIndex((line) => line.startsWith(`export type ${typeName} =`));
  const members = new Set<string>();
  if (start < 0) return members;
  for (let index = start; index < all.length; index += 1) {
    const line = all[index]!;
    if (index > start && line.trim() === "") break;
    for (const match of line.matchAll(/"([a-z_]+)"/g)) members.add(match[1]!);
  }
  return members;
}

/** The compiler's DEFAULT_SUPPORT table: `kind: { consumerId: "...", checkerVersion: "...", support: "..." ... }` per line. */
export function compilerSupportTable(text: string): Map<string, { support: string; consumerId: string; line: number }> {
  const table = new Map<string, { support: string; consumerId: string; line: number }>();
  lines(text).forEach((line, index) => {
    const match = /^\s*([a-z_]+): \{ consumerId: "([^"]+)", checkerVersion: "[^"]+", support: "([a-z_]+)"/.exec(line);
    if (match) table.set(match[1]!, { support: match[3]!, consumerId: match[2]!, line: index + 1 });
  });
  return table;
}

export function routingCapabilityVerdict(cells: Readonly<Record<RoutingCapabilityStage, { status: RoutingCapabilityStatus }>>): RoutingCapabilityVerdict {
  if (cells.check.status === "unsupported") return "unsupported";
  if (cells.check.status === "advisory") return "advisory-only";
  if (cells.check.status === "not_applicable") return "scope-only";
  const pre = [cells.export.status, cells.routing.status];
  if (pre.every((status) => status === "not_applicable")) return "placement-only";
  if (pre.some((status) => status === "unsupported")) return "check-only";
  if (pre.some((status) => status === "conservative")) return "survives-conservatively";
  return "survives";
}

/** Resolve every anchor and kind against the current files (`read` returns a file's text or null when absent). */
export function resolveRoutingCapabilityMatrix(read: (file: string) => string | null): ResolvedRoutingCapabilityMatrix {
  const problems: string[] = [];
  const texts = new Map<string, string | null>();
  const textOf = (file: string): string | null => {
    if (!texts.has(file)) texts.set(file, read(file));
    return texts.get(file)!;
  };
  const cite = (rowId: string, anchor: CapabilityAnchor): ResolvedCitation => {
    const text = textOf(anchor.file);
    if (text === null) { problems.push(`${rowId}: ${anchor.file} is not in the tree`); return { file: anchor.file, line: 0, anchor: anchor.anchor }; }
    const line = anchorLine(text, anchor.anchor);
    if (line === null) { problems.push(`${rowId}: ${anchor.file} no longer holds the anchor ${JSON.stringify(anchor.anchor)}`); return { file: anchor.file, line: 0, anchor: anchor.anchor }; }
    return { file: anchor.file, line, anchor: anchor.anchor };
  };
  const typesText = textOf(CONSTRAINT_TYPES);
  const compilerText = textOf(CONSTRAINT_COMPILER);
  if (typesText === null) problems.push(`${CONSTRAINT_TYPES} is not in the tree`);
  if (compilerText === null) problems.push(`${CONSTRAINT_COMPILER} is not in the tree`);
  const constraintKinds = typesText === null ? new Set<string>() : unionMembers(typesText, "ConstraintKind");
  const relationshipKinds = typesText === null ? new Set<string>() : unionMembers(typesText, "RelationshipKind");
  const table = compilerText === null ? new Map<string, { support: string; consumerId: string; line: number }>() : compilerSupportTable(compilerText);
  const fallbackLine = compilerText === null ? null : anchorLine(compilerText, NO_DEFAULT_SUPPORT.anchor);
  const relationshipRuleLine = compilerText === null ? null : anchorLine(compilerText, "relationship.kind === \"differential_pair\" || relationship.kind === \"current_loop\"");
  if (compilerText !== null && fallbackLine === null) problems.push(`${CONSTRAINT_COMPILER} no longer holds the unsupported fallback anchor`);
  if (compilerText !== null && relationshipRuleLine === null) problems.push(`${CONSTRAINT_COMPILER} no longer holds the relationship support rule`);
  const seen = new Set<string>();
  const rows = ROUTING_CAPABILITY_ROWS.map((row): ResolvedCapabilityRow => {
    if (seen.has(row.id)) problems.push(`${row.id}: duplicate row id`);
    seen.add(row.id);
    if (row.kinds.length === 0) problems.push(`${row.id}: names no constraint kind`);
    const compilerSupport = row.kinds.map((kind): CompilerSupportEntry | null => {
      if (constraintKinds.has(kind)) {
        const entry = table.get(kind);
        if (entry) return { kind, support: entry.support, consumerId: entry.consumerId, citation: { file: CONSTRAINT_COMPILER, line: entry.line, anchor: `${kind}: {` } };
        return { kind, support: "unsupported", consumerId: "none (no DEFAULT_SUPPORT entry: the compiler's fallback)", citation: { file: CONSTRAINT_COMPILER, line: fallbackLine ?? 0, anchor: NO_DEFAULT_SUPPORT.anchor } };
      }
      if (relationshipKinds.has(kind)) {
        const compiled = kind === "differential_pair" || kind === "current_loop" || kind === "placement_group";
        return { kind, support: compiled ? "compiled_for_consumer" : "enforced", consumerId: "relationship lowering (routing / placement graph)", citation: { file: CONSTRAINT_COMPILER, line: relationshipRuleLine ?? 0, anchor: "relationship.kind === \"differential_pair\"" } };
      }
      problems.push(`${row.id}: ${kind} is neither a ConstraintKind nor a RelationshipKind in ${CONSTRAINT_TYPES}`);
      return null;
    }).filter((entry): entry is CompilerSupportEntry => entry !== null);
    const cells = Object.fromEntries(ROUTING_CAPABILITY_STAGES.map((stage) => {
      const definition = row.cells[stage];
      if (!(ROUTING_CAPABILITY_STATUSES as readonly string[]).includes(definition.status)) problems.push(`${row.id}.${stage}: status ${definition.status} is not in the closed set`);
      if (definition.evidence.length === 0) problems.push(`${row.id}.${stage}: cites nothing`);
      if (definition.status === "unsupported" && definition.reason.trim().length < 20) problems.push(`${row.id}.${stage}: unsupported without a reason`);
      return [stage, { status: definition.status, reason: definition.reason, citations: definition.evidence.map((anchor) => cite(row.id, anchor)) }];
    })) as unknown as Record<RoutingCapabilityStage, ResolvedCell>;
    const verdict = routingCapabilityVerdict(cells);
    if ((verdict === "unsupported" || Object.values(cells).some((item) => item.status === "unsupported")) && row.reason.trim().length < 20) problems.push(`${row.id}: unsupported without a row reason`);
    return { id: row.id, constraint: row.constraint, kinds: row.kinds, compilerSupport, cells, verdict, reason: row.reason };
  });
  for (const id of DIRECTIVE_10_EXPECTED_UNSUPPORTED_ROUTING) {
    const row = rows.find((item) => item.id === id);
    if (!row) problems.push(`${id}: a directive-10 row is missing`);
    else if (row.cells.routing.status !== "unsupported") problems.push(`${id}: directive 10 forbids assuming FreeRouting enforces it, but its routing stage is ${row.cells.routing.status}`);
  }
  return { rows, problems };
}

// ── rendering (deterministic, LF, no clock) ───────────────────────────────────

const csvField = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const citationText = (citations: readonly ResolvedCitation[]): string => citations.map((citation) => `${citation.file}:${citation.line}`).join(" | ");

export function renderRoutingCapabilityCsv(rows: readonly ResolvedCapabilityRow[]): string {
  const body = rows.map((row) => [
    row.id,
    row.constraint,
    row.kinds.join(" "),
    row.compilerSupport.map((entry) => `${entry.kind}=${entry.support} (${entry.citation.file}:${entry.citation.line})`).join(" | "),
    row.cells.export.status, citationText(row.cells.export.citations),
    row.cells.routing.status, citationText(row.cells.routing.citations),
    row.cells.import.status, citationText(row.cells.import.citations),
    row.cells.check.status, citationText(row.cells.check.citations),
    row.verdict,
    row.reason,
  ].map(csvField).join(","));
  return [ROUTING_CAPABILITY_COLUMNS.join(","), ...body].join(LF) + LF;
}

export interface RoutingCapabilitySummary {
  schema: typeof ROUTING_CAPABILITY_MATRIX_SCHEMA;
  rows: number;
  citations: number;
  byVerdict: Record<RoutingCapabilityVerdict, number>;
  byStage: Record<RoutingCapabilityStage, Record<RoutingCapabilityStatus, number>>;
  unsupportedRows: string[];
  directive10: Array<{ id: string; routing: RoutingCapabilityStatus; check: RoutingCapabilityStatus; verdict: RoutingCapabilityVerdict }>;
  rowReasons: Array<{ id: string; verdict: RoutingCapabilityVerdict; reason: string }>;
}

export function summarizeRoutingCapabilityMatrix(rows: readonly ResolvedCapabilityRow[]): RoutingCapabilitySummary {
  const byVerdict = Object.fromEntries(ROUTING_CAPABILITY_VERDICTS.map((verdict) => [verdict, rows.filter((row) => row.verdict === verdict).length])) as Record<RoutingCapabilityVerdict, number>;
  const byStage = Object.fromEntries(ROUTING_CAPABILITY_STAGES.map((stage) => [stage, Object.fromEntries(ROUTING_CAPABILITY_STATUSES.map((status) => [status, rows.filter((row) => row.cells[stage].status === status).length]))])) as Record<RoutingCapabilityStage, Record<RoutingCapabilityStatus, number>>;
  return {
    schema: ROUTING_CAPABILITY_MATRIX_SCHEMA,
    rows: rows.length,
    citations: rows.reduce((sum, row) => sum + ROUTING_CAPABILITY_STAGES.reduce((inner, stage) => inner + row.cells[stage].citations.length, 0) + row.compilerSupport.length, 0),
    byVerdict,
    byStage,
    unsupportedRows: rows.filter((row) => row.verdict === "unsupported").map((row) => row.id),
    directive10: DIRECTIVE_10_EXPECTED_UNSUPPORTED_ROUTING.map((id) => { const row = rows.find((item) => item.id === id)!; return { id, routing: row.cells.routing.status, check: row.cells.check.status, verdict: row.verdict }; }),
    rowReasons: rows.map((row) => ({ id: row.id, verdict: row.verdict, reason: row.reason })),
  };
}

export function renderRoutingCapabilitySummary(summary: RoutingCapabilitySummary): string {
  return JSON.stringify(summary, null, 2) + LF;
}
