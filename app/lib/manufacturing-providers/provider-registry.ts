/**
 * [B23-A1] The versioned registry of external manufacturing, assembly, quote and distributor providers (OD-161, OD-162).
 *
 * A sibling of B19's source registry (`app/lib/acquisition/source-registry.ts`), never an extension of it. One reviewed row per
 * provider carries the twelve runbook B23-A fields (`:956-967`) as closed, typed fields, and every operation carries its OWN tier
 * and enable state (D23-2), so a provider's ordering capability can be recorded as present but disabled. A distributor row names
 * its B19 entry by id and adds only the B23 fields: B19 keeps that source's hosts, secret references, read operations and the terms
 * for the data Sirkit keeps; this registry records what Sirkit would SEND, quotes, orders and hand-offs.
 *
 * Tiers, per operation, in ascending order (OD-162): none < handoff (a deep link, a CSV download or a manual upload by a person;
 * never an API call) < read_observation < dfm_quote_transfer < ordering. `none` is only ever a row's enabled tier. In B23 no
 * transfer and no order is enabled, an ordering operation is never above disabled, and no row declares a callable host.
 *
 * Every provider fact is RECORDED from the B23 discovery's section 1.2 (reader 7, read 2026-10-01); A1 did not re-read the pages.
 * A value nobody could read is the literal UNKNOWN with the reason. Hand-offs Sirkit already offers cite the repository file that
 * offers them. Nothing here calls a provider, and no route reads this registry yet.
 *
 * Browser-safe: no environment reads at module load, no server imports. Bump PROVIDER_REGISTRY_VERSION on any change; the render
 * (`artifacts/ai-control-plane-b23/provider-registry.csv`) is gated byte for byte.
 */
import { SOURCE_REGISTRY, type AcquisitionSourceId } from "../acquisition/source-registry";

export const PROVIDER_REGISTRY_VERSION = "1.0.0"; // [B23-A1] first revision

export const PROVIDER_IDS = ["jlcpcb", "pcbway", "oshpark", "macrofab", "eurocircuits", "digikey", "mouser", "nexar", "lcsc"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_KINDS = ["manufacturer", "assembler", "quote_service", "distributor"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** The feature tiers in ascending order (OD-162). */
export const PROVIDER_TIERS = ["none", "handoff", "read_observation", "dfm_quote_transfer", "ordering"] as const;
export type ProviderTier = (typeof PROVIDER_TIERS)[number];
export type OperationTier = Exclude<ProviderTier, "none">;
export const tierRank = (tier: ProviderTier): number => PROVIDER_TIERS.indexOf(tier);

/** `api` is a call Sirkit's server would make; the other three are hand-offs a person completes (runbook `:969`). */
export const OPERATION_CHANNELS = ["api", "deep_link", "csv_export", "manual_upload"] as const;
export type OperationChannel = (typeof OPERATION_CHANNELS)[number];
export const OPERATION_STATES = ["enabled", "disabled", "blocked"] as const;
export type OperationState = (typeof OPERATION_STATES)[number];
/** `none_found`: no official API was found, so the row is hand-off only (no scraping). */
export const API_ACCESS_STATUSES = ["enabled", "disabled", "blocked", "none_found"] as const;
export type ApiAccessStatus = (typeof API_ACCESS_STATUSES)[number];
export const AUTH_SCHEMES = ["none", "api-key-header", "api-key-query-parameter", "session-token", "oauth2-client-credentials", "oauth2-authorization-code", "signed-request-partner-key"] as const;
export type AuthScheme = (typeof AUTH_SCHEMES)[number];
/** Where an operation's record comes from: the discovery's section 1.2, a file of this repository, or the B19 entry. */
export const OPERATION_SOURCES = ["discovery-1.2", "repository", "b19-registry"] as const;
export type OperationSource = (typeof OPERATION_SOURCES)[number];

/** A value nobody could read: the literal UNKNOWN and the reason. */
export interface UnknownFact {
  readonly value: "UNKNOWN";
  readonly reason: string;
}
/** A distributor row's field held by its B19 entry, named by path (never copied). */
export interface B19Reference {
  readonly b19: AcquisitionSourceId;
  readonly path: string;
}
export type Fact = string | UnknownFact;

export interface ProviderOperation {
  /** kebab-case, unique within the row */
  readonly id: string;
  /** the provider's own name for it */
  readonly providerName: string;
  readonly purpose: string;
  readonly tier: OperationTier;
  readonly channel: OperationChannel;
  readonly state: OperationState;
  readonly reason: string;
  /** api: "METHOD /path" or "METHOD https://host/path"; hand-off: "repo:<file>" or an https page; a distributor's read: its B19 entry */
  readonly endpoint: Fact | B19Reference;
  readonly auth: AuthScheme | UnknownFact | B19Reference;
  /** recorded as never called by Sirkit, whatever a later owner decision enables (OD-162: OSH Park's checkout) */
  readonly neverCalled: boolean;
  readonly source: OperationSource;
}

export type CapabilityMapping =
  | { readonly mapping: "jlcpcb-2l"; readonly profileId: "jlcpcb-2l"; readonly version: number; readonly digest: string; readonly evidenceExpiresAt: string }
  | { readonly mapping: "unmapped"; readonly reason: string };

export interface ProviderRow {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly kind: ProviderKind;
  /** a distributor's B19 entry (its hosts, secrets, read operations and kept-data terms live there); null for every other kind */
  readonly b19Source: AcquisitionSourceId | null;
  readonly reading: { readonly label: "RECORDED"; readonly reader: string; readonly readOn: string; readonly where: string; readonly reReadInA1: boolean };
  /** the official pages read, each with the date it was read */
  readonly documentation: readonly { readonly url: string; readonly readOn: string }[];
  readonly notes: readonly string[];
  // ── the twelve runbook B23-A fields (`:956-967`), in the runbook's order ──
  readonly legalIdentity: Fact | B19Reference;
  readonly endpoint: {
    /** exact hosts an ENABLED API operation of this row may call (none in B23; a distributor's live in B19) */
    readonly hosts: readonly string[];
    /** exact API hosts the provider documents that this row does not call */
    readonly documentedHosts: readonly string[];
    readonly apiVersion: Fact | B19Reference;
  };
  /** environment variable NAMES only, never a value */
  readonly credentials: { readonly references: readonly { readonly env: string; readonly role: string }[]; readonly accountScope: Fact };
  readonly operations: readonly ProviderOperation[];
  readonly regionCurrency: { readonly region: Fact | B19Reference; readonly currency: Fact | B19Reference };
  readonly capabilityProfile: CapabilityMapping;
  /** how the provider keeps and protects what Sirkit SENDS (not B19's licence for what Sirkit keeps) */
  readonly outboundTerms: { readonly retention: Fact; readonly confidentiality: Fact };
  readonly limits: { readonly upload: Fact; readonly quote: Fact };
  readonly webhook: Fact;
  readonly idempotency: Fact;
  readonly orderPolicy: { readonly order: Fact; readonly cancellation: Fact };
  readonly enabledFeatureTier: ProviderTier;
  readonly apiAccess: { readonly status: ApiAccessStatus; readonly reason: string; readonly ownerDecision: string | null };
}

/** The runbook's twelve field names (`:956-967`) and the row key that carries each. */
export const RUNBOOK_FIELDS = [
  ["legal provider identity", "legalIdentity"],
  ["endpoint/API version", "endpoint"],
  ["credential reference and account scope", "credentials"],
  ["supported operations", "operations"],
  ["region/currency", "regionCurrency"],
  ["capability-profile mapping", "capabilityProfile"],
  ["data retention/confidentiality terms", "outboundTerms"],
  ["upload and quote limits", "limits"],
  ["webhook/signature contract", "webhook"],
  ["idempotency support", "idempotency"],
  ["order/cancellation policy", "orderPolicy"],
  ["enabled feature tier", "enabledFeatureTier"],
] as const satisfies ReadonlyArray<readonly [string, keyof ProviderRow]>;

// ── The rows ─────────────────────────────────────────────────────────────────

const READ_ON = "2026-10-01";
const READING = { label: "RECORDED", reader: "reader 7", readOn: READ_ON, where: "artifacts/ai-control-plane-b23/discovery.md section 1.2", reReadInA1: false } as const;
const doc = (url: string) => ({ url, readOn: READ_ON });
const unknown = (reason: string): UnknownFact => ({ value: "UNKNOWN", reason });
const b19 = (source: AcquisitionSourceId, path: string): B19Reference => ({ b19: source, path });
const NOT_IN_SECTION_1_2 = "not recorded in the discovery's section 1.2 (the pages read do not state it)";
const NO_ACCOUNT_TRANSFER = "B23 admits no transfer: the owner holds no account and has approved no outbound files (OD-160, LB-11)";
const ORDERING_OFF = "ordering stays feature-disabled in B23 until the owner supplies OD-171's prerequisites (runbook :986, LB-12)";

/** A hand-off a person completes: never an API call, no credential, always the hand-off tier. */
function handoff(id: string, providerName: string, purpose: string, channel: Exclude<OperationChannel, "api">, endpoint: string, reason: string, source: Exclude<OperationSource, "b19-registry">): ProviderOperation {
  return { id, providerName, purpose, tier: "handoff", channel, state: "enabled", reason, endpoint, auth: "none", neverCalled: false, source };
}

/** An API operation a provider documents (recorded from section 1.2). */
function api(fields: Omit<ProviderOperation, "channel" | "neverCalled" | "source"> & { neverCalled?: boolean }): ProviderOperation {
  return { ...fields, channel: "api", neverCalled: fields.neverCalled ?? false, source: "discovery-1.2" };
}

/** A distributor's read: exactly B19's operation, credentials and state, by reference (OD-33, OD-32). */
function b19Read(id: string, providerName: string, source: AcquisitionSourceId): ProviderOperation {
  const entry = SOURCE_REGISTRY[source];
  return {
    id,
    providerName,
    purpose: "a read observation exactly as B19 registers it (hosts, secret references, quota, freshness and terms live in the B19 entry)",
    tier: "read_observation",
    channel: "api",
    state: entry.state.status,
    reason: `as B19 has it: ${entry.state.status}${entry.state.ownerDecision ? ` (${entry.state.ownerDecision})` : ""}`,
    endpoint: b19(source, "endpoints"),
    auth: b19(source, "auth"),
    neverCalled: false,
    source: "b19-registry",
  };
}

const UNMAPPED_DISTRIBUTOR = { mapping: "unmapped", reason: "a distributor sells parts; no fabrication rule profile applies" } as const;

/**
 * [B23-A1] `jlcpcb-2l` as `rule-profile.ts` computes it (`buildManufacturingRuleProfile` with JLCPCB_2L_RULE_PROFILE_EVIDENCE): a
 * reviewed copy, so a change to the profile fails the registry suite until this row is reviewed with it (D23-18).
 */
const JLCPCB_2L_MAPPING = {
  mapping: "jlcpcb-2l",
  profileId: "jlcpcb-2l",
  version: 2,
  digest: "mfg-rule-41563ed452ed6c620965a29186a8139d67635ac7d36fee6730b1d75eba4ca9e2",
  evidenceExpiresAt: "2027-09-09",
} as const;

const ROWS: readonly ProviderRow[] = [
  {
    id: "jlcpcb",
    displayName: "JLCPCB",
    kind: "manufacturer",
    b19Source: null,
    reading: READING,
    documentation: [
      doc("https://api.jlcpcb.com/"),
      doc("https://jlcpcb.com/help/article/jlcpcb-online-api-available-now"),
      doc("https://api.jlcpcb.com/docs/api-list"),
      doc("https://api.jlcpcb.com/docs/api-request-signature"),
      doc("https://api.jlcpcb.com/docs/start"),
      doc("https://dfm.jlcpcb.com/"),
      doc("https://jlcdfm.com/"),
    ],
    notes: [
      "An API platform with a PCB API (real-time quotations, ordering, order lifecycle management) plus Stencil, 3D Printing and Components APIs; onboarding is: apply for API access, then create an app.",
      "Access needs a JLCPCB account; applications are reviewed on the applicant's orders and business, and not all are approved.",
      "The API list, request-signature and start pages are client-rendered and returned only navigation.",
      "A third-party issue seen only as a search snippet describes a signed Authorization header on open.jlcpcb.com: unofficial, not relied on.",
    ],
    legalIdentity: unknown("section 1.2 records the brand and its domains, not the contracting legal entity; that needs the API agreement, which follows an approved application"),
    endpoint: { hosts: [], documentedHosts: ["api.jlcpcb.com"], apiVersion: unknown("the API list and start pages are client-rendered and returned only navigation") },
    credentials: { references: [], accountScope: "none: no JLCPCB account and no approved API application (OD-160)" },
    operations: [
      api({ id: "pcb-quote", providerName: "PCB API: real-time quotations", purpose: "quote a board from its design data", tier: "dfm_quote_transfer", state: "blocked", reason: "approval-gated: a JLCPCB account and a reviewed application are needed and Sirkit holds neither (OD-160, LB-11)", endpoint: unknown("the client-rendered API list returned only navigation"), auth: unknown("the request-signature page returned only navigation") }),
      api({ id: "pcb-order", providerName: "PCB API: ordering process and order lifecycle management", purpose: "place and follow a board order", tier: "ordering", state: "disabled", reason: `${ORDERING_OFF}; access is also approval-gated`, endpoint: unknown("the client-rendered API list returned only navigation"), auth: unknown("the request-signature page returned only navigation") }),
      handoff("manual-quote-upload", "jlcpcb.com/quote", "a person uploads the Gerber bundle at JLCPCB's quote page", "manual_upload", "repo:app/lib/pcb/fab/presets/jlcpcb-2l.fab.json", "the preset's note is shown in the Send to fab dialog; a person uploads, Sirkit calls nothing", "repository"),
      handoff("dfm-web-tool", "JLCPCB DFM web upload tools (dfm.jlcpcb.com, jlcdfm.com)", "a person checks a design in JLCPCB's web DFM tool", "manual_upload", "https://dfm.jlcpcb.com/", "web upload tools a person uses; no DFM API was found, so nothing is called", "discovery-1.2"),
    ],
    regionCurrency: { region: unknown(NOT_IN_SECTION_1_2), currency: unknown(NOT_IN_SECTION_1_2) },
    capabilityProfile: JLCPCB_2L_MAPPING,
    outboundTerms: {
      retention: unknown("retention terms were not read: the API pages are client-rendered and the agreement follows an approved application"),
      confidentiality: "JLCPCB states it will not have access to any information about API partners' customers (RECORDED); how uploaded design files are kept is not stated in the pages read",
    },
    limits: { upload: unknown("upload and rate limits sit on client-rendered pages that returned only navigation"), quote: unknown("quote limits and validity sit on client-rendered pages that returned only navigation") },
    webhook: unknown("the webhook-signature page returned only navigation"),
    idempotency: unknown("not stated in the pages read (client-rendered)"),
    orderPolicy: { order: "the PCB API advertises an ordering process and order lifecycle management (RECORDED); the payment flow is not stated in the pages read", cancellation: unknown(NOT_IN_SECTION_1_2) },
    enabledFeatureTier: "handoff",
    apiAccess: { status: "blocked", reason: "approval-gated API; Sirkit holds no JLCPCB account or approved application", ownerDecision: "OD-162" },
  },
  {
    id: "pcbway",
    displayName: "PCBWay",
    kind: "manufacturer",
    b19Source: null,
    reading: READING,
    documentation: [
      doc("https://www.pcbway.com/api_cooperation.html"),
      doc("https://api-partner.pcbway.com/Help"),
      doc("https://api-partner.pcbway.com/Help/Example"),
      doc("https://api-partner.pcbway.com/Help/Api/POST-api-Pcb-PcbQuotation"),
      doc("https://api-partner.pcbway.com/Help/Api/POST-api-Pcb-PlaceOrder"),
      doc("https://api-partner.pcbway.com/Help/Api/POST-api-Pcb-ConfirmOrder"),
      doc("https://api-partner.pcbway.com/Help/Api/POST-api-Pcb-CancelOrder"),
    ],
    notes: [
      "An approval-gated Partner API requested by email and reviewed by the PCBWay team; the Assembly API is under construction; https://www.pcbway.com/api.html returned 404.",
      "The help index also lists GetFreightByOrder, CheckOrderDetails, the group-order checks, payments and cancellations, Account/QueryBalance and address lookups.",
      "Endpoint paths are read from the help pages' names (POST-api-Pcb-PcbQuotation reads as POST /api/Pcb/PcbQuotation): INFERRED.",
      "The only sandbox mention is a code comment on the same host over plain http; no distinct sandbox is documented. The partner PDF came back as binary.",
    ],
    legalIdentity: unknown("section 1.2 records the brand and its domains, not the contracting legal entity; the partner agreement was not read"),
    endpoint: { hosts: [], documentedHosts: ["api-partner.pcbway.com"], apiVersion: unknown("the help pages name no API version") },
    credentials: { references: [], accountScope: "none: no PCBWay partner approval (OD-160)" },
    operations: [
      api({ id: "pcb-quotation", providerName: "PcbQuotation", purpose: "quote a board from parameters only (no file); returns priceList, BuildDays and shipping", tier: "dfm_quote_transfer", state: "blocked", reason: "approval-gated Partner API; Sirkit holds no approval (OD-160, LB-11)", endpoint: "POST /api/Pcb/PcbQuotation", auth: "api-key-header" }),
      api({ id: "smt-quotation", providerName: "SMT/SMTQuotation", purpose: "quote an assembly", tier: "dfm_quote_transfer", state: "blocked", reason: "approval-gated Partner API; Sirkit holds no approval (OD-160, LB-11)", endpoint: unknown("the help index lists SMT/SMTQuotation; its route page was not read"), auth: "api-key-header" }),
      api({ id: "place-order", providerName: "PlaceOrder", purpose: "puts an order in the PCBWay cart; takes the design as DataZipFile (base64) or PcbFileUrl, with an optional PONumber", tier: "ordering", state: "disabled", reason: `${ORDERING_OFF}; the Partner API is also approval-gated`, endpoint: "POST /api/Pcb/PlaceOrder", auth: "api-key-header" }),
      api({ id: "confirm-order", providerName: "ConfirmOrder", purpose: "confirms orders and makes the payment (PayType AccountPay or PCBWayWebPay); returns TotalAmount and AccountBalance", tier: "ordering", state: "disabled", reason: `${ORDERING_OFF}; this operation spends money`, endpoint: "POST /api/Pcb/ConfirmOrder", auth: "api-key-header" }),
      api({ id: "cancel-order", providerName: "CancelOrder", purpose: "cancels an order; takes only OrderNo", tier: "ordering", state: "disabled", reason: ORDERING_OFF, endpoint: "POST /api/Pcb/CancelOrder", auth: "api-key-header" }),
      api({ id: "query-order-process", providerName: "QueryOrderProcess", purpose: "reads an order's progress", tier: "read_observation", state: "blocked", reason: "approval-gated Partner API; Sirkit holds no approval and has no order", endpoint: unknown("the help index lists QueryOrderProcess; its route page was not read"), auth: "api-key-header" }),
      handoff("online-quote-upload", "pcbway.com online quote", "a person uploads the Gerber bundle in PCBWay's online quote", "manual_upload", "repo:app/lib/pcb/fab/presets/pcbway-standard.fab.json", "the preset's note is shown in the Send to fab dialog; a person uploads, Sirkit calls nothing", "repository"),
    ],
    regionCurrency: { region: unknown(NOT_IN_SECTION_1_2), currency: unknown(NOT_IN_SECTION_1_2) },
    capabilityProfile: { mapping: "unmapped", reason: "pcbway-standard is a packaging and DRC preset, not a qualified rule profile (QUALIFIED_RULE_PROFILE_IDS holds jlcpcb-2l only)" },
    outboundTerms: {
      retention: unknown("the partner PDF came back as binary; no retention term was read"),
      confidentiality: "PCBWay states it will not know any information about partners' customers (RECORDED); how uploaded design files are kept is not stated in the pages read",
    },
    limits: {
      upload: "PlaceOrder takes the design as DataZipFile (base64) or PcbFileUrl; PcbQuotation sends parameters only, no file (RECORDED); a size limit is not stated in the pages read",
      quote: unknown("rate limits are not in the pages read (the partner PDF came back as binary)"),
    },
    webhook: unknown("no webhook is described in the pages read (the partner PDF came back as binary)"),
    idempotency: unknown("PlaceOrder takes an optional PONumber; whether a repeated PONumber is refused is not documented in the pages read"),
    orderPolicy: {
      order: "PlaceOrder puts an order in the cart; ConfirmOrder confirms it and pays (PayType AccountPay or PCBWayWebPay), returning TotalAmount and AccountBalance (RECORDED)",
      cancellation: "CancelOrder takes only OrderNo, and CancelTGroupOrder cancels a group order (RECORDED); refund behaviour is not stated in the pages read",
    },
    enabledFeatureTier: "handoff",
    apiAccess: { status: "blocked", reason: "approval-gated Partner API (requested by email, reviewed by PCBWay); Sirkit holds no approval", ownerDecision: "OD-162" },
  },
  {
    id: "oshpark",
    displayName: "OSH Park",
    kind: "manufacturer",
    b19Source: null,
    reading: READING,
    documentation: [doc("https://oshpark.com/developer"), doc("https://docs.oshpark.com/tips+tricks/api/"), doc("https://github.com/OSHPark/ruby-api-client/blob/master/README.md")],
    notes: [
      "An official REST/JSON API for Uploads, Projects and Orders, authenticated by a short-lived session token the API generates; https://oshpark.com/developer/resources returned 404.",
      "The import upload needs no authentication, returns no previews or warnings, and the person finishes in the browser.",
      "The Ruby client signs in by email plus password or an API secret and offers add_item and checkout.",
    ],
    legalIdentity: unknown("section 1.2 records the brand and its domains, not the contracting legal entity"),
    endpoint: { hosts: [], documentedHosts: ["oshpark.com"], apiVersion: unknown("the API base path and version are not in the pages read (the resources page returned 404)") },
    credentials: { references: [], accountScope: "none: no OSH Park account (OD-160)" },
    operations: [
      api({ id: "import-upload", providerName: "import (a multipart POST to /import or /import.json, or oshpark.com/import with a url parameter)", purpose: "sends the design for the person to finish in the browser; returns no previews or warnings", tier: "dfm_quote_transfer", state: "disabled", reason: `needs no authentication, but it sends the design out: ${NO_ACCOUNT_TRANSFER}`, endpoint: "POST https://oshpark.com/import", auth: "none" }),
      api({ id: "api-upload", providerName: "Uploads and Projects API", purpose: "uploads a design and creates a project under an account", tier: "dfm_quote_transfer", state: "disabled", reason: NO_ACCOUNT_TRANSFER, endpoint: unknown("the API base path is not in the pages read"), auth: "session-token" }),
      api({ id: "checkout", providerName: "checkout (the Ruby client's add_item and checkout)", purpose: "orders the items in the account's cart", tier: "ordering", state: "disabled", reason: `recorded as never called (OD-162): orders from invoiced customers proceed automatically and the API takes no card payment; ${ORDERING_OFF}`, endpoint: unknown("the API base path is not in the pages read"), auth: "session-token", neverCalled: true }),
      handoff("manual-upload", "oshpark.com upload", "a person uploads the Gerber bundle at oshpark.com", "manual_upload", "repo:app/lib/pcb/fab/presets/oshpark-4l.fab.json", "the preset's note is shown in the Send to fab dialog; a person uploads, Sirkit calls nothing", "repository"),
    ],
    regionCurrency: { region: unknown(NOT_IN_SECTION_1_2), currency: unknown(NOT_IN_SECTION_1_2) },
    capabilityProfile: { mapping: "unmapped", reason: "oshpark-4l is a packaging and DRC preset, not a qualified rule profile (QUALIFIED_RULE_PROFILE_IDS holds jlcpcb-2l only)" },
    outboundTerms: { retention: unknown(NOT_IN_SECTION_1_2), confidentiality: unknown(NOT_IN_SECTION_1_2) },
    limits: { upload: unknown("upload and rate limits are not in the pages read"), quote: unknown("no quote operation was read; the import returns no previews or warnings") },
    webhook: unknown("no webhook is described in the pages read"),
    idempotency: unknown("not stated in the pages read"),
    orderPolicy: { order: "add_item and checkout through the API; the API takes no card payment, and orders from invoiced customers proceed automatically (RECORDED)", cancellation: unknown(NOT_IN_SECTION_1_2) },
    enabledFeatureTier: "handoff",
    apiAccess: { status: "disabled", reason: "official API; Sirkit holds no OSH Park account", ownerDecision: "OD-162" },
  },
  {
    id: "macrofab",
    displayName: "MacroFab",
    kind: "manufacturer",
    b19Source: null,
    reading: READING,
    documentation: [doc("https://apidocs.macrofab.com/docs/accessing-your-api-key"), doc("https://apidocs.macrofab.com/llms.txt")],
    notes: [
      "The key goes in the X-MacroFab-API-Key header (one search snippet says a URL parameter, probably older documentation).",
      "The llms.txt index has 64 entries; uploads go through Sign S3 Upload and ingestion workflows; a testbench results API (serial number, SKU, status, date) exists.",
    ],
    legalIdentity: unknown("section 1.2 records the brand and its domains, not the contracting legal entity"),
    endpoint: { hosts: [], documentedHosts: ["api.macrofab.com"], apiVersion: "v5 for the DFM readiness path and v4 for the PCB quote path (RECORDED)" },
    credentials: { references: [], accountScope: "none: no MacroFab account (OD-160)" },
    operations: [
      api({ id: "upload", providerName: "Sign S3 Upload and ingestion workflows", purpose: "uploads the design", tier: "dfm_quote_transfer", state: "disabled", reason: NO_ACCOUNT_TRANSFER, endpoint: unknown("the upload paths are not in section 1.2"), auth: "api-key-header" }),
      api({ id: "dfm-readiness", providerName: "PCB ready check", purpose: "returns observations (error, warning, info) and available actions for an uploaded PCB", tier: "dfm_quote_transfer", state: "disabled", reason: NO_ACCOUNT_TRANSFER, endpoint: "GET/POST /api/v5/pcb/{pcb_id}/{pcb_version}/ready/{quantity}", auth: "api-key-header" }),
      api({ id: "pcb-quote", providerName: "PCB quote", purpose: "returns totals, business_days, due_date, valid and invalid_reasons for an uploaded PCB", tier: "dfm_quote_transfer", state: "disabled", reason: NO_ACCOUNT_TRANSFER, endpoint: "GET/POST /api/v4/quote/pcb/{id}/{version}/{quantity}", auth: "api-key-header" }),
      api({ id: "order-read", providerName: "order list, order details, deals", purpose: "reads the account's orders", tier: "read_observation", state: "disabled", reason: "read-only order endpoints; Sirkit holds no MacroFab account", endpoint: unknown("the order paths are not in section 1.2"), auth: "api-key-header" }),
    ],
    regionCurrency: { region: unknown(NOT_IN_SECTION_1_2), currency: unknown(NOT_IN_SECTION_1_2) },
    capabilityProfile: { mapping: "unmapped", reason: "Sirkit has no MacroFab preset or rule profile" },
    outboundTerms: { retention: unknown(NOT_IN_SECTION_1_2), confidentiality: unknown(NOT_IN_SECTION_1_2) },
    limits: { upload: unknown("upload and rate limits are not in the pages read"), quote: "a quote carries valid and invalid_reasons and no documented expiry (RECORDED)" },
    webhook: unknown("no webhook is described in the pages read"),
    idempotency: unknown("not stated in the pages read"),
    orderPolicy: { order: "the order endpoints read are read-only (order list, order details, deals); the 64-entry index lists no order placement (RECORDED)", cancellation: unknown(NOT_IN_SECTION_1_2) },
    enabledFeatureTier: "none",
    apiAccess: { status: "disabled", reason: "DFM and quote API; Sirkit holds no MacroFab account", ownerDecision: "OD-162" },
  },
  {
    id: "eurocircuits",
    displayName: "Eurocircuits",
    kind: "manufacturer",
    b19Source: null,
    reading: READING,
    documentation: [doc("https://www.eurocircuits.com/ask-for-a-quotation/"), doc("https://www.eurocircuits.com/eurocircuits-company-update/looking-forward-2026/")],
    notes: ["Searches found web quoting and the PCB Visualizer; the API mentions found describe Eurocircuits' own supplier links, not a customer API."],
    legalIdentity: unknown("section 1.2 records the brand and its domain, not the contracting legal entity"),
    endpoint: { hosts: [], documentedHosts: [], apiVersion: unknown("no public customer API was found") },
    credentials: { references: [], accountScope: "none: a hand-off needs no Sirkit-held account" },
    operations: [
      handoff("web-quote", "ask for a quotation (web)", "a person asks Eurocircuits for a quotation on its site", "manual_upload", "https://www.eurocircuits.com/ask-for-a-quotation/", "web quoting a person uses; no API was found, so nothing is called and nothing is scraped (runbook :969)", "discovery-1.2"),
    ],
    regionCurrency: { region: unknown(NOT_IN_SECTION_1_2), currency: unknown(NOT_IN_SECTION_1_2) },
    capabilityProfile: { mapping: "unmapped", reason: "Sirkit has no Eurocircuits preset or rule profile" },
    outboundTerms: { retention: unknown(NOT_IN_SECTION_1_2), confidentiality: unknown(NOT_IN_SECTION_1_2) },
    limits: { upload: "not applicable: hand-off only; Sirkit sends nothing", quote: "not applicable: hand-off only; Sirkit asks for nothing" },
    webhook: "not applicable: no API",
    idempotency: "not applicable: no API",
    orderPolicy: { order: "web quoting only (RECORDED); no API order path", cancellation: unknown(NOT_IN_SECTION_1_2) },
    enabledFeatureTier: "handoff",
    apiAccess: { status: "none_found", reason: "no public customer API was found; hand-off only, no scraping (runbook :969)", ownerDecision: "OD-162" },
  },
  {
    id: "digikey",
    displayName: "DigiKey",
    kind: "distributor",
    b19Source: "digikey",
    reading: READING,
    documentation: [doc("https://developer.digikey.com/products"), doc("https://developer.digikey.com/products/ordering"), doc("https://developer.digikey.com/documentation"), doc("https://developer.digikey.com/api-user-agreement")],
    notes: [
      "The products page lists Quote (prices locked for a period), Ordering (place and manage orders), Order Status, MyLists and Product Information V4.",
      "The Order, SalesOrderDetails and Quote-v4 GetQuote pages say only 3-legged OAuth and offer a sandbox mode; sandbox apps cannot call production and sandbox data may not be complete (B19 records the sandbox host under notCalled).",
      "Access tokens last 10 minutes (2-legged) or 30 minutes (3-legged); locale headers set the site, language and currency per request.",
    ],
    legalIdentity: b19("digikey", "provider.organization"),
    endpoint: { hosts: [], documentedHosts: [], apiVersion: "Quote-v4 (the GetQuote page); the read operation's version is B19's provider.apiVersion" },
    credentials: { references: [], accountScope: "reads: B19's account scope; Quote and Ordering: none - they need 3-legged OAuth, and Ordering an active DigiKey Credit account, which the owner does not hold (OD-160)" },
    operations: [
      b19Read("product-information", "Product Information V4 keyword search", "digikey"),
      handoff("bom-upload-link", "MyLists BOM upload page", "a link a person clicks after the import CSV downloads; nothing opens by itself", "deep_link", "repo:app/lib/distributor-links.ts", "B19-E's upload-page link; a person clicks it, nothing is sent and nothing is called", "repository"),
      handoff("cart-csv", "DigiKey import CSV", "a cache-priced import file a person downloads", "csv_export", "repo:app/api/bom/cart/digikey/route.ts", "B19-E's cart route returns a CSV download from the cache only; it never calls DigiKey", "repository"),
      api({ id: "quote", providerName: "Quote-v4 GetQuote", purpose: "locks prices for a period for a list of parts", tier: "dfm_quote_transfer", state: "disabled", reason: `only 3-legged OAuth; ${NO_ACCOUNT_TRANSFER}`, endpoint: unknown("the path is not in section 1.2"), auth: "oauth2-authorization-code" }),
      api({ id: "ordering", providerName: "Ordering (Order, SalesOrderDetails)", purpose: "places and manages orders", tier: "ordering", state: "disabled", reason: `needs an active DigiKey Credit account and 3-legged OAuth; ${ORDERING_OFF}`, endpoint: unknown("the path is not in section 1.2"), auth: "oauth2-authorization-code" }),
    ],
    regionCurrency: { region: b19("digikey", "scope.region"), currency: b19("digikey", "scope.currency") },
    capabilityProfile: UNMAPPED_DISTRIBUTOR,
    outboundTerms: {
      retention: unknown("the API user agreement read (undated) governs DigiKey's data, not what Sirkit would send in a quote or an order"),
      confidentiality: unknown("the API user agreement read governs DigiKey's data; how DigiKey keeps a quote or order request is not stated in the pages read"),
    },
    limits: {
      upload: "per-minute limits per product: Product Information 120 a minute, Ordering 10 a minute; a 429 carries Retry-After (RECORDED)",
      quote: unknown("Quote-v4 validity and line limits are not in the pages read (a search snippet says 30 days and 300 products: INFERRED only, not relied on)"),
    },
    webhook: unknown("no webhook is described in the pages read"),
    idempotency: unknown("duplicate purchase-order handling is not described in the pages read"),
    orderPolicy: { order: "Ordering places and manages orders and needs an active DigiKey Credit account; its pages say only 3-legged OAuth and offer a sandbox mode (RECORDED)", cancellation: unknown(NOT_IN_SECTION_1_2) },
    enabledFeatureTier: "read_observation",
    apiAccess: { status: "enabled", reason: "B19's enabled read source (OD-33); Quote and Ordering recorded, disabled", ownerDecision: "OD-33" },
  },
  {
    id: "mouser",
    displayName: "Mouser",
    kind: "distributor",
    b19Source: "mouser",
    reading: READING,
    documentation: [doc("https://api.mouser.com/api/docs/V1")],
    notes: [
      "The V1 specification has Search, Cart, Order and OrderHistory groups; order/options/query returns shipping, payment methods and tax certificates; no sandbox is documented.",
      "The API hub, the API terms (both paths) and the order API page timed out on 2026-10-01; B19's 2026-09-13 reading of the terms stands.",
      "Separate cart/order and search keys, 30 a minute and 1000 a day appear only in a search snippet: INFERRED, not relied on.",
    ],
    legalIdentity: b19("mouser", "provider.organization"),
    endpoint: { hosts: [], documentedHosts: [], apiVersion: "V1 (Search, Cart, Order and OrderHistory groups) (RECORDED)" },
    credentials: { references: [], accountScope: "search: B19's account scope; cart and order: none - the owner holds no Mouser order key" },
    operations: [
      b19Read("part-number-search", "V1 part-number search", "mouser"),
      handoff("bom-upload-link", "Mouser project upload page", "a link a person clicks after the import CSV downloads; nothing opens by itself", "deep_link", "repo:app/lib/distributor-links.ts", "B19-E's upload-page link; a person clicks it, nothing is sent and nothing is called", "repository"),
      handoff("cart-csv", "Mouser import CSV", "a cache-priced import file a person downloads", "csv_export", "repo:app/api/bom/cart/mouser/route.ts", "B19-E's cart route returns a CSV download from the cache only; it never calls Mouser", "repository"),
      api({ id: "cart", providerName: "Cart group", purpose: "fills a Mouser cart", tier: "ordering", state: "disabled", reason: `${ORDERING_OFF}; Mouser is disabled (OD-32)`, endpoint: unknown("the cart paths are not in section 1.2"), auth: "api-key-query-parameter" }),
      api({ id: "order", providerName: "Order (SubmitOrder true submits, false previews)", purpose: "submits or previews an order", tier: "ordering", state: "disabled", reason: `the order API is recorded and disabled: ${ORDERING_OFF}; Mouser is disabled (OD-32)`, endpoint: "POST /api/v{version}/order", auth: "api-key-query-parameter" }),
    ],
    regionCurrency: { region: b19("mouser", "scope.region"), currency: b19("mouser", "scope.currency") },
    capabilityProfile: UNMAPPED_DISTRIBUTOR,
    outboundTerms: {
      retention: unknown("the API terms pages timed out on 2026-10-01; B19's reading governs Mouser's data, not what Sirkit would send"),
      confidentiality: unknown("the API terms pages timed out on 2026-10-01"),
    },
    limits: { upload: unknown("cart and order rate limits are not in the pages read"), quote: "not applicable: the V1 specification records no quote operation" },
    webhook: unknown("no webhook is described in the pages read"),
    idempotency: unknown("not stated in the pages read"),
    orderPolicy: { order: "POST /api/v{version}/order with SubmitOrder true submits and false previews; order/options/query returns shipping, payment methods and tax certificates; no sandbox documented (RECORDED)", cancellation: unknown(NOT_IN_SECTION_1_2) },
    enabledFeatureTier: "handoff",
    apiAccess: { status: "disabled", reason: "B19 disabled (OD-32); the cart and order APIs are recorded, disabled", ownerDecision: "OD-32" },
  },
  {
    id: "nexar",
    displayName: "Nexar (Octopart)",
    kind: "distributor",
    b19Source: "octopart",
    reading: READING,
    documentation: [
      doc("https://support.nexar.com/support/solutions/articles/101000471994-authorization"),
      doc("https://nexar.com/api/legal"),
      doc("https://support.nexar.com/support/solutions/articles/101000476314-part-limits-and-how-they-work"),
      doc("https://support.nexar.com/support/solutions/articles/101000497890-frequently-asked-questions"),
    ],
    notes: [
      "OAuth2 client credentials (scope supply.domain) or authorization code with PKCE; tokens valid for 24 hours; no ordering scope.",
      "The API legal terms (dated August 1, 2022): no caching or storing beyond 24 hours, a followable Octopart attribution link, the API and the agreement confidential.",
      "Limits reset monthly; the Evaluation limit conflicts between two pages; a call times out after 90 seconds.",
    ],
    legalIdentity: b19("octopart", "provider.organization"),
    endpoint: { hosts: [], documentedHosts: [], apiVersion: b19("octopart", "provider.apiVersion") },
    credentials: { references: [], accountScope: "B19's account scope (reads only); Nexar documents no ordering scope" },
    operations: [b19Read("supply-search", "Supply GraphQL search", "octopart")],
    regionCurrency: { region: b19("octopart", "scope.region"), currency: b19("octopart", "scope.currency") },
    capabilityProfile: UNMAPPED_DISTRIBUTOR,
    outboundTerms: {
      retention: unknown("Nexar's API terms govern Nexar's data (no storing beyond 24 hours), not the part numbers Sirkit sends"),
      confidentiality: unknown("Nexar's API terms make the API and the agreement confidential; how Nexar keeps Sirkit's queries is not stated"),
    },
    limits: { upload: "not applicable: read-only queries; limits reset monthly and a call times out after 90 seconds (RECORDED); B19 holds the quota", quote: "not applicable: Nexar records no quote operation" },
    webhook: unknown("no webhook is described in the pages read"),
    idempotency: "not applicable: read-only queries",
    orderPolicy: { order: "none: the OAuth scope supply.domain carries no ordering (RECORDED); no order or quote-to-order path (INFERRED)", cancellation: "not applicable: no ordering" },
    enabledFeatureTier: "read_observation",
    apiAccess: { status: "enabled", reason: "B19's enabled read source (OD-33); read observations only, no ordering", ownerDecision: "OD-33" },
  },
  {
    id: "lcsc",
    displayName: "LCSC",
    kind: "distributor",
    b19Source: "lcsc",
    reading: READING,
    documentation: [doc("https://www.lcsc.com/docs/openapi/index.html")],
    notes: ["The official index lists product APIs plus an Order Create API, a Check Order API and a Get Shipment API; every call is signed with key, nonce, signature and timestamp; no sandbox is mentioned."],
    legalIdentity: b19("lcsc", "provider.organization"),
    endpoint: { hosts: [], documentedHosts: [], apiVersion: b19("lcsc", "provider.apiVersion") },
    credentials: { references: [], accountScope: "none: no approved LCSC partner application (B19 blocked)" },
    operations: [
      b19Read("product-search", "LCSC product APIs", "lcsc"),
      api({ id: "order-create", providerName: "Order Create API", purpose: "creates an LCSC order", tier: "ordering", state: "disabled", reason: `recorded from the official index; ${ORDERING_OFF}; LCSC is also blocked (no approved access)`, endpoint: unknown("the index's paths are not in section 1.2"), auth: "signed-request-partner-key" }),
      api({ id: "check-order", providerName: "Check Order API", purpose: "reads an order", tier: "read_observation", state: "blocked", reason: "LCSC's official API needs an approved partner application; Sirkit has none", endpoint: unknown("the index's paths are not in section 1.2"), auth: "signed-request-partner-key" }),
      api({ id: "get-shipment", providerName: "Get Shipment API", purpose: "reads a shipment", tier: "read_observation", state: "blocked", reason: "LCSC's official API needs an approved partner application; Sirkit has none", endpoint: unknown("the index's paths are not in section 1.2"), auth: "signed-request-partner-key" }),
      handoff("bom-tool-link", "LCSC BOM tool", "a link a person clicks after the import CSV downloads; nothing opens by itself", "deep_link", "repo:app/lib/distributor-links.ts", "B19-E's upload-page link; a person clicks it, nothing is sent and nothing is called", "repository"),
      handoff("cart-csv", "LCSC import CSV", "a cache-priced import file a person downloads", "csv_export", "repo:app/api/bom/cart/lcsc/route.ts", "B19-E's cart route returns a CSV download from the cache only; it never calls LCSC", "repository"),
    ],
    regionCurrency: { region: b19("lcsc", "scope.region"), currency: b19("lcsc", "scope.currency") },
    capabilityProfile: UNMAPPED_DISTRIBUTOR,
    outboundTerms: { retention: unknown(NOT_IN_SECTION_1_2), confidentiality: unknown(NOT_IN_SECTION_1_2) },
    limits: { upload: unknown("order and shipment limits are not in section 1.2; B19 holds the read quota"), quote: "not applicable: the index records no quote operation" },
    webhook: unknown("no webhook is described in the pages read"),
    idempotency: unknown("not stated in the pages read"),
    orderPolicy: { order: "the official index lists an Order Create API, a Check Order API and a Get Shipment API (RECORDED)", cancellation: unknown(NOT_IN_SECTION_1_2) },
    enabledFeatureTier: "handoff",
    apiAccess: { status: "blocked", reason: "B19 blocked: an approved partner application is required; no scraping and no unofficial access", ownerDecision: "OD-162" },
  },
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

export const PROVIDER_ROWS: readonly ProviderRow[] = deepFreeze(ROWS);
export const PROVIDER_REGISTRY: Readonly<Record<ProviderId, ProviderRow>> = Object.freeze(Object.fromEntries(PROVIDER_ROWS.map((row) => [row.id, row])) as Record<ProviderId, ProviderRow>);

export function providerRow(id: ProviderId): ProviderRow {
  return PROVIDER_REGISTRY[id];
}

// ── Validation ───────────────────────────────────────────────────────────────

/** Every rule a revision must satisfy; each violation message starts "<id>: [<rule>] ". */
export const PROVIDER_REGISTRY_RULES = [
  "closed-keys", "id", "text", "reading", "documentation", "unknown", "hosts-exact", "callable-hosts", "api-access", "blocked-row",
  "no-api-row", "b19-reference", "secrets", "operation-id", "vocabulary", "handoff", "api-endpoint", "ordering-disabled",
  "transfer-not-admitted", "never-called", "feature-tier", "capability",
] as const;
export type ProviderRegistryRule = (typeof PROVIDER_REGISTRY_RULES)[number];

const ROW_KEYS = ["id", "displayName", "kind", "b19Source", "reading", "documentation", "notes", "legalIdentity", "endpoint", "credentials", "operations", "regionCurrency", "capabilityProfile", "outboundTerms", "limits", "webhook", "idempotency", "orderPolicy", "enabledFeatureTier", "apiAccess"];
const OPERATION_KEYS = ["id", "providerName", "purpose", "tier", "channel", "state", "reason", "endpoint", "auth", "neverCalled", "source"];
const NESTED_KEYS: Readonly<Record<string, readonly string[]>> = {
  reading: ["label", "reader", "readOn", "where", "reReadInA1"],
  endpoint: ["hosts", "documentedHosts", "apiVersion"],
  credentials: ["references", "accountScope"],
  regionCurrency: ["region", "currency"],
  outboundTerms: ["retention", "confidentiality"],
  limits: ["upload", "quote"],
  orderPolicy: ["order", "cancellation"],
  apiAccess: ["status", "reason", "ownerDecision"],
};
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
/** [B23-A1] B19's secret shapes (`source-registry.ts`), assembled so this file never spells a key or a PEM marker itself */
const SECRET_SHAPES = new RegExp([
  "sk-ant-[A-Za-z0-9_-]{20,}", "sk-[A-Za-z0-9]{32,}", "ghp_[A-Za-z0-9]{36}", "AKIA[0-9A-Z]{16}", `${"-".repeat(5)}BEGIN [A-Z ]*PRIVATE KEY${"-".repeat(5)}`,
  "hf_[A-Za-z0-9]{30,}", "eyJ[A-Za-z0-9_-]{20,}[.][A-Za-z0-9_-]{20,}",
].join("|"));
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPERATION_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const API_ENDPOINT = /^(?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))* (\S+)$/;
/** [B23-A1 review] A path target: path characters and `{template}` segments only - no query, fragment, credentials or `//host`. */
const API_PATH = /^\/(?!\/)[\w.~{}/-]*$/;
const REPO_REF = /^repo:(?:app|lib|components|scripts)\/[A-Za-z0-9._/-]+$/;
const OPERATION_TIERS: readonly string[] = PROVIDER_TIERS.filter((tier) => tier !== "none");

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const sameKeys = (value: unknown, keys: readonly string[]): boolean => isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const isUnknownFact = (value: unknown): value is UnknownFact => isObject(value) && "value" in value;
const isB19Reference = (value: unknown): value is B19Reference => isObject(value) && "b19" in value;
const text = (value: unknown): boolean => typeof value === "string" && value.trim() !== "";
/** A plain https link: a host, no credentials, no query, no fragment. */
function plainHttps(url: unknown): URL | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash ? parsed : null;
  } catch {
    return null;
  }
}
/** Resolve a dotted path inside a B19 entry. */
function resolvePath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => (isObject(current) ? current[key] : undefined), value);
}

/** Every structural rule a registry revision must satisfy. Returns human-readable violations; empty means valid. */
export function validateProviderRegistry(rows: readonly ProviderRow[] = PROVIDER_ROWS): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const candidate of rows) {
    const row = candidate as unknown as Loose;
    const id = typeof row.id === "string" ? row.id : "?";
    const at = (rule: ProviderRegistryRule, message: string) => errors.push(`${id}: [${rule}] ${message}`);
    const endpoint = isObject(row.endpoint) ? row.endpoint : {};
    const credentials = isObject(row.credentials) ? row.credentials : {};
    const apiAccess = isObject(row.apiAccess) ? row.apiAccess : {};
    const reading = isObject(row.reading) ? row.reading : {};
    const operations = list(row.operations).filter(isObject);
    const hosts = list(endpoint.hosts);
    const documentedHosts = list(endpoint.documentedHosts);
    const references = list(credentials.references).filter(isObject);
    const b19Source = row.b19Source;
    const distributor = row.kind === "distributor";
    const source = typeof b19Source === "string" && b19Source in SOURCE_REGISTRY ? SOURCE_REGISTRY[b19Source as AcquisitionSourceId] : null;
    const enabledApi = operations.filter((entry) => entry.channel === "api" && entry.state === "enabled");

    // closed-keys: a row, every nested block and every operation carry exactly their keys
    if (!sameKeys(row, ROW_KEYS)) at("closed-keys", `row keys are not exactly ${ROW_KEYS.join(", ")}`);
    for (const [key, keys] of Object.entries(NESTED_KEYS)) if (!sameKeys(row[key], keys)) at("closed-keys", `${key} keys are not exactly ${keys.join(", ")}`);
    for (const item of list(row.documentation)) if (!sameKeys(item, ["url", "readOn"])) at("closed-keys", "a documentation entry is not exactly url, readOn");
    for (const item of list(credentials.references)) if (!sameKeys(item, ["env", "role"])) at("closed-keys", "a credential reference is not exactly env, role");
    for (const entry of list(row.operations)) if (!sameKeys(entry, OPERATION_KEYS)) at("closed-keys", `operation ${isObject(entry) ? String(entry.id) : "?"} keys are not exactly ${OPERATION_KEYS.join(", ")}`);
    const capability = isObject(row.capabilityProfile) ? row.capabilityProfile : {};
    if (!sameKeys(capability, capability.mapping === "jlcpcb-2l" ? ["mapping", "profileId", "version", "digest", "evidenceExpiresAt"] : ["mapping", "reason"])) at("closed-keys", "capabilityProfile keys do not match its mapping");

    // id
    if (!(PROVIDER_IDS as readonly string[]).includes(id)) at("id", "id is not one of the registered providers");
    if (ids.has(id)) at("id", "duplicate id");
    ids.add(id);

    // text: names, reasons, purposes and notes are never empty
    if (!text(row.displayName)) at("text", "displayName is empty");
    if (!text(apiAccess.reason)) at("text", "apiAccess.reason is empty");
    for (const note of list(row.notes)) if (!text(note)) at("text", "a note is empty");
    for (const reference of references) if (!text(reference.role)) at("text", "a credential reference has no role");
    for (const entry of operations) for (const field of ["providerName", "purpose", "reason"]) if (!text(entry[field])) at("text", `operation ${String(entry.id)} ${field} is empty`);

    // reading: every provider fact is RECORDED by a named reader on a date
    if (reading.label !== "RECORDED" || !text(reading.reader) || !DATE.test(String(reading.readOn)) || !text(reading.where) || typeof reading.reReadInA1 !== "boolean") at("reading", "a provider fact must be RECORDED by a named reader on a date, from a named page");

    // documentation: official pages, HTTPS, dated
    if (list(row.documentation).length === 0) at("documentation", "no official documentation recorded");
    for (const item of list(row.documentation).filter(isObject)) {
      if (!plainHttps(item.url)) at("documentation", `documentation is not a plain HTTPS link: ${String(item.url)}`);
      if (!DATE.test(String(item.readOn))) at("documentation", `documentation ${String(item.url)} is not dated`);
    }

    // unknown: a value nobody could read is the literal UNKNOWN with a reason, never a bare or embedded UNKNOWN
    const facts: Array<[string, unknown]> = [
      ["legalIdentity", row.legalIdentity], ["endpoint.apiVersion", endpoint.apiVersion], ["credentials.accountScope", credentials.accountScope],
      ["regionCurrency.region", isObject(row.regionCurrency) ? row.regionCurrency.region : undefined], ["regionCurrency.currency", isObject(row.regionCurrency) ? row.regionCurrency.currency : undefined],
      ["outboundTerms.retention", isObject(row.outboundTerms) ? row.outboundTerms.retention : undefined], ["outboundTerms.confidentiality", isObject(row.outboundTerms) ? row.outboundTerms.confidentiality : undefined],
      ["limits.upload", isObject(row.limits) ? row.limits.upload : undefined], ["limits.quote", isObject(row.limits) ? row.limits.quote : undefined],
      ["webhook", row.webhook], ["idempotency", row.idempotency],
      ["orderPolicy.order", isObject(row.orderPolicy) ? row.orderPolicy.order : undefined], ["orderPolicy.cancellation", isObject(row.orderPolicy) ? row.orderPolicy.cancellation : undefined],
      ...operations.flatMap((entry): Array<[string, unknown]> => [[`${String(entry.id)}.endpoint`, entry.endpoint], [`${String(entry.id)}.auth`, entry.auth]]),
    ];
    for (const [name, fact] of facts) {
      if (typeof fact === "string") {
        if (fact.trim() === "") at("unknown", `${name} is empty`);
        else if (/\bUNKNOWN\b/.test(fact)) at("unknown", `${name} spells UNKNOWN outside an UNKNOWN record`);
      } else if (isUnknownFact(fact)) {
        if (!sameKeys(fact, ["value", "reason"]) || fact.value !== "UNKNOWN" || !text(fact.reason) || /^UNKNOWN$/i.test(String(fact.reason).trim())) at("unknown", `${name} is an UNKNOWN record without its reason`);
      } else if (!isB19Reference(fact)) at("unknown", `${name} is neither a value, an UNKNOWN record nor a B19 reference`);
    }

    // hosts-exact
    for (const host of [...hosts, ...documentedHosts]) if (typeof host !== "string" || !HOST.test(host)) at("hosts-exact", `host is not an exact lowercase hostname: ${String(host)}`);
    if (new Set(hosts).size !== hosts.length || new Set(documentedHosts).size !== documentedHosts.length) at("hosts-exact", "a host is listed twice");
    for (const host of hosts) if (documentedHosts.includes(host)) at("hosts-exact", `${String(host)} is both callable and documented-only`);

    // callable-hosts: a host is callable only for an enabled API operation (none in B23)
    if (hosts.length > 0 && enabledApi.length === 0) at("callable-hosts", "callable hosts are declared but no API operation is enabled");
    if (!distributor && enabledApi.length > 0 && hosts.length === 0) at("callable-hosts", "an enabled API operation has no callable host");

    // api-access: the row's API status agrees with its operations
    if (apiAccess.status === "enabled" && enabledApi.length === 0) at("api-access", "API access is enabled but no API operation is");
    if (enabledApi.length > 0 && apiAccess.status !== "enabled") at("api-access", `an API operation is enabled while API access is ${String(apiAccess.status)}`);

    // blocked-row: a blocked row declares no hosts and no secrets
    if (apiAccess.status === "blocked" && (hosts.length > 0 || references.length > 0)) at("blocked-row", "a blocked row may not declare callable hosts or secrets");

    // no-api-row: no official API means hand-off only, no hosts (no scraping, runbook :969)
    if (apiAccess.status === "none_found") {
      if (hosts.length > 0 || documentedHosts.length > 0) at("no-api-row", "a row with no official API may not name a host");
      if (operations.some((entry) => entry.tier !== "handoff" || entry.channel === "api")) at("no-api-row", "a row with no official API records hand-offs only");
      if (row.enabledFeatureTier !== "none" && row.enabledFeatureTier !== "handoff") at("no-api-row", "a row with no official API is at most hand-off");
    }

    // b19-reference: a distributor names its B19 entry and copies nothing B19 holds
    if (distributor !== (b19Source !== null)) at("b19-reference", "a distributor row (and only a distributor row) names its B19 entry");
    if (b19Source !== null && source === null) at("b19-reference", `b19Source ${String(b19Source)} is not a B19 source`);
    if (distributor && (hosts.length > 0 || documentedHosts.length > 0 || references.length > 0)) at("b19-reference", "a distributor row may not duplicate B19's hosts or secrets");
    const referencesInRow = [row.legalIdentity, endpoint.apiVersion, isObject(row.regionCurrency) ? row.regionCurrency.region : null, isObject(row.regionCurrency) ? row.regionCurrency.currency : null, ...operations.flatMap((entry) => [entry.endpoint, entry.auth])].filter(isB19Reference);
    for (const reference of referencesInRow) {
      if (!distributor || reference.b19 !== b19Source) at("b19-reference", `a reference into ${String(reference.b19)} on a row that is not that source's`);
      else if (!sameKeys(reference, ["b19", "path"]) || !text(reference.path) || resolvePath(source, reference.path) === undefined) at("b19-reference", `the reference ${String(reference.path)} does not resolve in B19's ${String(reference.b19)}`);
    }
    const b19Reads = operations.filter((entry) => entry.source === "b19-registry");
    if (!distributor && b19Reads.length > 0) at("b19-reference", "only a distributor row records B19's read");
    if (source) {
      if (apiAccess.status !== source.state.status) at("b19-reference", `API access ${String(apiAccess.status)} does not mirror B19's ${source.state.status}`);
      if (b19Reads.length !== 1) at("b19-reference", "a distributor row records B19's read exactly once");
      for (const entry of b19Reads) {
        if (entry.channel !== "api" || entry.tier !== "read_observation" || !isB19Reference(entry.endpoint) || !isB19Reference(entry.auth)) at("b19-reference", `the read ${String(entry.id)} is not B19's read operation by reference`);
        if (entry.state !== source.state.status) at("b19-reference", `the read ${String(entry.id)} is ${String(entry.state)}; B19 has ${source.state.status}`);
      }
      for (const entry of operations) if (typeof entry.endpoint === "string" && /:\/\//.test(entry.endpoint) && entry.channel === "api") at("b19-reference", `the API operation ${String(entry.id)} names a host; a distributor's hosts live in B19`);
    }

    // secrets: names only, and nothing shaped like a value anywhere
    for (const reference of references) if (typeof reference.env !== "string" || !ENV_NAME.test(reference.env)) at("secrets", `secret reference is not an environment variable name: ${String(reference.env)}`);
    if (SECRET_SHAPES.test(JSON.stringify(row))) at("secrets", "the row contains something shaped like a secret value");

    // operation-id
    if (operations.length === 0) at("operation-id", "a row records no operation");
    const operationIds = operations.map((entry) => entry.id);
    for (const operationId of operationIds) if (typeof operationId !== "string" || !OPERATION_ID.test(operationId)) at("operation-id", `operation id is not kebab-case: ${String(operationId)}`);
    if (new Set(operationIds).size !== operationIds.length) at("operation-id", "an operation id is listed twice");

    // vocabulary: every closed word is from its vocabulary
    if (!(PROVIDER_KINDS as readonly unknown[]).includes(row.kind)) at("vocabulary", `kind ${String(row.kind)} is not a provider kind`);
    if (!(API_ACCESS_STATUSES as readonly unknown[]).includes(apiAccess.status)) at("vocabulary", `API access ${String(apiAccess.status)} is not a status`);
    if (!(PROVIDER_TIERS as readonly unknown[]).includes(row.enabledFeatureTier)) at("vocabulary", `enabledFeatureTier ${String(row.enabledFeatureTier)} is not a tier`);
    for (const entry of operations) {
      if (!OPERATION_TIERS.includes(entry.tier as string)) at("vocabulary", `operation ${String(entry.id)} tier ${String(entry.tier)} is not an operation tier`);
      if (!(OPERATION_CHANNELS as readonly unknown[]).includes(entry.channel)) at("vocabulary", `operation ${String(entry.id)} channel ${String(entry.channel)} is not a channel`);
      if (!(OPERATION_STATES as readonly unknown[]).includes(entry.state)) at("vocabulary", `operation ${String(entry.id)} state ${String(entry.state)} is not a state`);
      if (!(OPERATION_SOURCES as readonly unknown[]).includes(entry.source)) at("vocabulary", `operation ${String(entry.id)} source ${String(entry.source)} is not a source`);
      if (typeof entry.auth === "string" && !(AUTH_SCHEMES as readonly string[]).includes(entry.auth)) at("vocabulary", `operation ${String(entry.id)} auth ${entry.auth} is not an auth scheme`);
      if (typeof entry.neverCalled !== "boolean") at("vocabulary", `operation ${String(entry.id)} neverCalled is not a boolean`);
    }

    // handoff: deep links, CSV downloads and manual uploads are hand-offs, never an API call (runbook :969)
    for (const entry of operations) {
      if ((entry.tier === "handoff") !== (entry.channel !== "api")) at("handoff", `operation ${String(entry.id)}: a hand-off is exactly a deep link, a CSV download or a manual upload`);
      if (entry.tier !== "handoff") continue;
      if (entry.auth !== "none") at("handoff", `hand-off ${String(entry.id)} carries a credential`);
      if (entry.source === "b19-registry") at("handoff", `hand-off ${String(entry.id)} is not B19's to record`);
      if (!(typeof entry.endpoint === "string" && ((REPO_REF.test(entry.endpoint) && !entry.endpoint.includes("..")) || plainHttps(entry.endpoint)))) at("handoff", `hand-off ${String(entry.id)} names neither a repository file nor an https page`);
    }

    // api-endpoint: "METHOD /path" or "METHOD https://<declared host>/path"; neither form carries a query, a fragment or credentials
    // (B19's rule, `source-registry.ts`: a key never sits in a recorded URL)
    for (const entry of operations.filter((item) => item.channel === "api" && typeof item.endpoint === "string")) {
      const match = API_ENDPOINT.exec(entry.endpoint as string);
      if (!match) {
        at("api-endpoint", `operation ${String(entry.id)} endpoint is not "METHOD target"`);
        continue;
      }
      const target = match[1]!;
      if (target.startsWith("/")) {
        // [B23-A1 review] the message never echoes the target: what it carries may be a key
        if (!API_PATH.test(target)) at("api-endpoint", `operation ${String(entry.id)} endpoint path carries a query, a fragment, credentials or a host`);
        continue;
      }
      const url = plainHttps(target);
      if (!url) at("api-endpoint", `operation ${String(entry.id)} endpoint is not a path or a plain HTTPS URL: ${target}`);
      else if (!hosts.includes(url.hostname) && !documentedHosts.includes(url.hostname)) at("api-endpoint", `operation ${String(entry.id)} host ${url.hostname} is not declared`);
    }

    // ordering-disabled and transfer-not-admitted: nothing in B23 can order or send a file to a provider
    for (const entry of operations) {
      if (entry.tier === "ordering" && entry.state === "enabled") at("ordering-disabled", `ordering operation ${String(entry.id)} is enabled; ordering is never above disabled in B23`);
      if (entry.tier === "dfm_quote_transfer" && entry.state === "enabled") at("transfer-not-admitted", `transfer operation ${String(entry.id)} is enabled; no owner decision names an account (OD-160)`);
    }

    // never-called: an API operation recorded as never called is never enabled
    for (const entry of operations.filter((item) => item.neverCalled === true)) {
      if (entry.channel !== "api") at("never-called", `operation ${String(entry.id)} is marked never called but is not an API operation`);
      if (entry.state === "enabled") at("never-called", `operation ${String(entry.id)} is marked never called but is enabled`);
    }

    // feature-tier: the row's enabled tier is its highest enabled operation's
    const ranks = operations.filter((entry) => entry.state === "enabled").map((entry) => tierRank(entry.tier as ProviderTier));
    const computed = PROVIDER_TIERS[ranks.length === 0 ? 0 : Math.max(...ranks)];
    if (row.enabledFeatureTier !== computed) at("feature-tier", `enabledFeatureTier ${String(row.enabledFeatureTier)} is not the highest enabled operation's (${String(computed)})`);

    // capability: jlcpcb-2l (id, version, rule-profile digest, evidence expiry) on a manufacturer, or unmapped with a reason
    if (capability.mapping === "jlcpcb-2l") {
      if (capability.profileId !== "jlcpcb-2l" || !Number.isInteger(capability.version) || (capability.version as number) < 1 || !/^mfg-rule-[0-9a-f]{64}$/.test(String(capability.digest)) || !DATE.test(String(capability.evidenceExpiresAt))) at("capability", "a jlcpcb-2l mapping needs the profile id, a version, a rule-profile digest and the evidence expiry");
      if (row.kind !== "manufacturer") at("capability", "only a manufacturer maps to a fabrication rule profile");
    } else if (capability.mapping === "unmapped") {
      if (!text(capability.reason)) at("capability", "an unmapped row needs a reason");
    } else at("capability", `mapping ${String(capability.mapping)} is neither jlcpcb-2l nor unmapped`);
  }
  return errors;
}

// ── Rendering (the committed artifact) ───────────────────────────────────────

/** A field as the artifact prints it: a value, "UNKNOWN (reason)", or "b19:<source>.<path>". */
export function renderFact(fact: Fact | B19Reference | AuthScheme): string {
  if (typeof fact === "string") return fact;
  if (isB19Reference(fact)) return `b19:${fact.b19}.${fact.path}`;
  return `UNKNOWN (${fact.reason})`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value;
}

/**
 * [B23-A1 review] Each operation's endpoint, authentication scheme and record source are rendered beside its tier, channel and state,
 * so a change to an operation's API surface changes the CSV. Not rendered (prose, reviewed in this file and read by the registry
 * suite): an operation's provider name, purpose and reason, a row's notes, a credential reference's role and each documentation
 * page's own date; [B23-A1 lead, 2026-10-02] and the API access's reason and the reading's `where` (`api_access` and `owner_decision`
 * render the access's status and decision; `read_by`, `read_on` and `re_read_in_a1` the reading's reader, date and mark).
 */
export const PROVIDER_REGISTRY_CSV_COLUMNS = [
  "registry_version", "id", "display_name", "kind", "b19_source", "api_access", "owner_decision", "enabled_feature_tier", "legal_identity", "api_version",
  "hosts", "documented_hosts", "credential_references", "account_scope", "operations", "operation_endpoints", "operation_auth", "operation_sources", "region",
  "currency", "capability_profile", "outbound_retention", "outbound_confidentiality", "upload_limits", "quote_limits", "webhook_signature", "idempotency",
  "order_policy", "cancellation_policy", "documentation", "read_by", "read_on", "re_read_in_a1",
] as const;

export function renderProviderRegistryCsv(rows: readonly ProviderRow[] = PROVIDER_ROWS): string {
  const lines = [PROVIDER_REGISTRY_CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const capability = row.capabilityProfile;
    const cells = [
      PROVIDER_REGISTRY_VERSION,
      row.id,
      row.displayName,
      row.kind,
      row.b19Source ?? "",
      row.apiAccess.status,
      row.apiAccess.ownerDecision ?? "",
      row.enabledFeatureTier,
      renderFact(row.legalIdentity),
      renderFact(row.endpoint.apiVersion),
      row.endpoint.hosts.join(";"),
      row.endpoint.documentedHosts.join(";"),
      row.credentials.references.map((reference) => reference.env).join(";"),
      renderFact(row.credentials.accountScope),
      row.operations.map((entry) => `${entry.id}=${entry.tier}/${entry.channel}/${entry.state}${entry.neverCalled ? "/never-called" : ""}`).join(";"),
      row.operations.map((entry) => `${entry.id}=${renderFact(entry.endpoint)}`).join(";"),
      row.operations.map((entry) => `${entry.id}=${renderFact(entry.auth)}`).join(";"),
      row.operations.map((entry) => `${entry.id}=${entry.source}`).join(";"),
      renderFact(row.regionCurrency.region),
      renderFact(row.regionCurrency.currency),
      capability.mapping === "jlcpcb-2l" ? `jlcpcb-2l v${capability.version} ${capability.digest} (evidence expires ${capability.evidenceExpiresAt})` : `unmapped (${capability.reason})`,
      renderFact(row.outboundTerms.retention),
      renderFact(row.outboundTerms.confidentiality),
      renderFact(row.limits.upload),
      renderFact(row.limits.quote),
      renderFact(row.webhook),
      renderFact(row.idempotency),
      renderFact(row.orderPolicy.order),
      renderFact(row.orderPolicy.cancellation),
      row.documentation.map((item) => item.url).join(";"),
      `${row.reading.label} ${row.reading.reader}`,
      row.reading.readOn,
      String(row.reading.reReadInA1),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
