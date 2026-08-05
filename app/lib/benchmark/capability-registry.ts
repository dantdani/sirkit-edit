import { benchmarkDigest } from "./stable";

export interface CapabilityHypothesis {
  hypothesisId: string;
  vendor: string;
  product: string;
  versionApplicability: string;
  licenseTier: string;
  officialSourceUrl: string;
  sourceAccessedAt: string;
  sourceUpdatedAt?: string;
  claimedCapability: string;
  applicableDomain: string;
  comparableSirkitTask: string;
  measurementStatus: "protocol_ready" | "measured" | "license_unavailable" | "environment_unavailable" | "not_comparable";
  knownMismatch: string;
  reviewDate: string;
  claimIsMeasuredQor: false;
  digest: string;
}

function entry(input: Omit<CapabilityHypothesis, "hypothesisId" | "digest" | "claimIsMeasuredQor">): CapabilityHypothesis {
  const base = { ...input, claimIsMeasuredQor: false as const };
  return { ...base, hypothesisId: `capability:${benchmarkDigest(base).slice(7, 31)}`, digest: benchmarkDigest(base) };
}

/** Official documentation records feature hypotheses only. No entry is a measured competitive result. */
export const COMPETITIVE_CAPABILITY_REGISTRY: readonly CapabilityHypothesis[] = [
  entry({ vendor: "Cadence", product: "Allegro X Design Platform", versionApplicability: "Current Allegro X web platform; page does not state an executable build number", licenseTier: "Commercial; exact modules/add-ons require vendor confirmation", officialSourceUrl: "https://www.cadence.com/en_US/home/tools/pcb-design-and-analysis/allegro-x-design-platform.html", sourceAccessedAt: "2026-07-17", claimedCapability: "Constraint-driven PCB design, concurrent engineering, in-design analysis, high-speed design, and AI-assisted component placement/routing are documented platform capabilities.", applicableDomain: "Enterprise PCB design and analysis", comparableSirkitTask: "Typed constraints, PCB placement/routing, evidence and collaboration protocols", measurementStatus: "license_unavailable", knownMismatch: "No licensed Allegro X installation or authorized operator is configured; integrated SI/PI/thermal/EM exceeds Sirkit Stage 9 scope.", reviewDate: "2027-01-17" }),
  entry({ vendor: "Altium", product: "Altium Designer", versionApplicability: "Official high-speed documentation updated 2026-04-14", licenseTier: "Commercial; feature availability may depend on subscription/workspace options", officialSourceUrl: "https://www.altium.com/documentation/altium-designer/pcb/high-speed-design", sourceAccessedAt: "2026-07-17", sourceUpdatedAt: "2026-04-14", claimedCapability: "Documentation covers xSignals, point-to-point length, via-span contribution, differential routing, length/matched-length rules, and interactive single/differential tuning.", applicableDomain: "High-speed PCB routing", comparableSirkitTask: "Stage 8 path measurement, differential pairs, layer transitions, and tuning", measurementStatus: "license_unavailable", knownMismatch: "No licensed Altium installation is configured; Sirkit cornered differential routing and pair tuning remain incomplete.", reviewDate: "2027-01-17" }),
  entry({ vendor: "Altium", product: "Altium Designer Constraint Manager", versionApplicability: "Official documentation updated 2026-07-09", licenseTier: "Commercial; Constraint Management option/access required", officialSourceUrl: "https://www.altium.com/documentation/altium-designer/sch-pcb/constraint-manager", sourceAccessedAt: "2026-07-17", sourceUpdatedAt: "2026-07-09", claimedCapability: "Project-level document-based management of clearance, physical, electrical, impedance, differential-pair and xSignal constraints is documented.", applicableDomain: "Schematic/PCB constraint management", comparableSirkitTask: "Stage 6 typed hierarchical constraint compilation and explanation", measurementStatus: "license_unavailable", knownMismatch: "Constraint languages and migration semantics are not one-to-one; a common subset and conversion-loss report are required.", reviewDate: "2027-01-17" }),
  entry({ vendor: "Synopsys", product: "Synopsys.ai / DSO.ai", versionApplicability: "Current AI-powered EDA overview; build unspecified", licenseTier: "Commercial", officialSourceUrl: "https://www.synopsys.com/ai/ai-powered-eda.html", sourceAccessedAt: "2026-07-17", claimedCapability: "Synopsys documents AI search over large chip-design solution spaces to optimize power, performance, area, QoR and verification productivity.", applicableDomain: "Chip/IC design optimization and verification methodology", comparableSirkitTask: "Stage 9 experiment governance, multi-objective QoR, and AI safety methodology", measurementStatus: "not_comparable", knownMismatch: "The source does not establish a directly comparable board-level PCB layout product/task; no PCB win/loss claim is permitted.", reviewDate: "2027-01-17" }),
  entry({ vendor: "KiCad", product: "PCB Editor", versionApplicability: "KiCad 10.0 documentation", licenseTier: "Open source", officialSourceUrl: "https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html", sourceAccessedAt: "2026-07-17", claimedCapability: "Documentation covers single-track automatic completion, differential-pair routing with paired vias, persistent single/differential length tuning, and skew tuning.", applicableDomain: "Open PCB layout reference", comparableSirkitTask: "Interactive routing, differential pairs, tuning, and KiCad interoperability", measurementStatus: "environment_unavailable", knownMismatch: "kicad-cli is unavailable on the current machine; documentation is not substituted for measured output. GUI/human protocol is required for interactive tasks.", reviewDate: "2027-01-17" }),
];

export const COMPETITIVE_PROTOCOL_V1 = {
  protocolId: "sirkit-competitive-common-denominator/1.0.0",
  taskPackageId: "sirkit-v1:competitive-common-denominator",
  allowedProducts: ["Sirkit", "KiCad PCB Editor 10.0", "Altium Designer (licensed build recorded at run)", "Cadence Allegro X (licensed build/modules recorded at run)"],
  source: "Generated two-layer netlist, outline, footprints, width/clearance rules, through vias, no proprietary-only metadata.",
  conversions: "Every adapter emits a unit/layer/net/rule/zone/via/geometry loss report; any legality/difficulty change is not_comparable.",
  assistanceLevels: ["default automatic", "tuned automatic", "interactive expert", "AI typed reversible"],
  budgets: "Pre-register equal wall/compute or publish quality-time curves; charge all retries, tuning and manual correction.",
  validation: "Sirkit authoritative connectivity/DRC plus native-tool checks; disagreement retained and claim-blocking.",
  outcomes: ["win", "tie", "loss", "not_comparable", "license_unavailable", "environment_failure"],
  publication: "Independent review, exact versions/tiers, raw permitted evidence, uncertainty, exclusions and expiry required.",
  digest: "",
} as const;

export const COMPETITIVE_PROTOCOL_DIGEST = benchmarkDigest({ ...COMPETITIVE_PROTOCOL_V1, digest: undefined });
