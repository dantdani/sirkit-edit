/**
 * [B23-A1] The provider registry (OD-161, OD-162): a sibling of B19's source registry with one reviewed row per manufacturer,
 * assembler, quote service or distributor, carrying the twelve runbook B23-A fields (`:956-967`) as closed, typed fields, each
 * operation with its own tier and enable state (D23-2); every provider fact RECORDED from the discovery's section 1.2 (reader 7,
 * 2026-10-01) and not re-read in A1; the `jlcpcb-2l` capability mapping as `rule-profile.ts` computes it (D23-18); every validator
 * rule biting on a reintroduced violation; the CD-12 projection (no third shape); and the CSV equal to its render byte for byte.
 *
 * Regenerate the artifact after a reviewed registry change: npx tsx scripts/generate-b23-provider-registry.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION, validateSourceRegistry } from "@/app/lib/acquisition/source-registry";
import { DISTRIBUTOR_UPLOAD_URLS } from "@/app/lib/distributor-links";
import { buildManufacturingRuleProfile, JLCPCB_2L_RULE_PROFILE_EVIDENCE, QUALIFIED_RULE_PROFILE_IDS } from "@/app/lib/pcb/fab/rule-profile";
import { cd12Digest } from "@/app/lib/release-engineering/stable";
import type { ProcurementProviderDescriptor } from "@/app/lib/release-engineering/types";
import { CD12_PROVIDER_KIND, toProcurementProviderDescriptor } from "../cd12-projection";
import {
  AUTH_SCHEMES,
  OPERATION_CHANNELS,
  OPERATION_SOURCES,
  OPERATION_STATES,
  PROVIDER_IDS,
  PROVIDER_KINDS,
  PROVIDER_REGISTRY,
  PROVIDER_REGISTRY_CSV_COLUMNS,
  PROVIDER_REGISTRY_RULES,
  PROVIDER_REGISTRY_VERSION,
  PROVIDER_ROWS,
  PROVIDER_TIERS,
  RUNBOOK_FIELDS,
  renderFact,
  renderProviderRegistryCsv,
  tierRank,
  validateProviderRegistry,
  type AuthScheme,
  type OperationChannel,
  type OperationState,
  type OperationTier,
  type ProviderId,
  type ProviderOperation,
  type ProviderRow,
} from "../provider-registry";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const ARTIFACT = "artifacts/ai-control-plane-b23/provider-registry.csv";
const DISCOVERY = "artifacts/ai-control-plane-b23/discovery.md";

const ROW_KEYS = ["id", "displayName", "kind", "b19Source", "reading", "documentation", "notes", "legalIdentity", "endpoint", "credentials", "operations", "regionCurrency", "capabilityProfile", "outboundTerms", "limits", "webhook", "idempotency", "orderPolicy", "enabledFeatureTier", "apiAccess"];
const OPERATION_KEYS = ["id", "providerName", "purpose", "tier", "channel", "state", "reason", "endpoint", "auth", "neverCalled", "source"];
const NESTED_KEYS: ReadonlyArray<readonly [string, (row: ProviderRow) => unknown, readonly string[]]> = [
  ["reading", (row) => row.reading, ["label", "reader", "readOn", "where", "reReadInA1"]],
  ["endpoint", (row) => row.endpoint, ["hosts", "documentedHosts", "apiVersion"]],
  ["credentials", (row) => row.credentials, ["references", "accountScope"]],
  ["regionCurrency", (row) => row.regionCurrency, ["region", "currency"]],
  ["outboundTerms", (row) => row.outboundTerms, ["retention", "confidentiality"]],
  ["limits", (row) => row.limits, ["upload", "quote"]],
  ["orderPolicy", (row) => row.orderPolicy, ["order", "cancellation"]],
  ["apiAccess", (row) => row.apiAccess, ["status", "reason", "ownerDecision"]],
];

/** An operation's authentication as case 6 pins it: the scheme, "UNKNOWN" for an UNKNOWN record, or the B19 entry it names. */
type AuthWord = AuthScheme | "UNKNOWN" | `b19:${string}.auth`;
const authWord = (auth: ProviderOperation["auth"]): string => (typeof auth === "string" ? auth : "b19" in auth ? `b19:${auth.b19}.${auth.path}` : auth.value);

/**
 * OD-162's rows as B23-A1 applies them: provider -> [operation, tier, channel, state, authentication]. [B23-A1 review, 2026-10-02]
 * The authentication column pins D23-2's auth vocabulary (PCBWay's and MacroFab's header key, OSH Park's session token, DigiKey's
 * 3-legged authorization code, Mouser's query key, LCSC's signed partner key), each RECORDED in section 1.2.
 */
const EXPECTED_OPERATIONS: Readonly<Record<ProviderId, ReadonlyArray<readonly [string, OperationTier, OperationChannel, OperationState, AuthWord]>>> = {
  jlcpcb: [["pcb-quote", "dfm_quote_transfer", "api", "blocked", "UNKNOWN"], ["pcb-order", "ordering", "api", "disabled", "UNKNOWN"], ["manual-quote-upload", "handoff", "manual_upload", "enabled", "none"], ["dfm-web-tool", "handoff", "manual_upload", "enabled", "none"]],
  pcbway: [["pcb-quotation", "dfm_quote_transfer", "api", "blocked", "api-key-header"], ["smt-quotation", "dfm_quote_transfer", "api", "blocked", "api-key-header"], ["place-order", "ordering", "api", "disabled", "api-key-header"], ["confirm-order", "ordering", "api", "disabled", "api-key-header"], ["cancel-order", "ordering", "api", "disabled", "api-key-header"], ["query-order-process", "read_observation", "api", "blocked", "api-key-header"], ["online-quote-upload", "handoff", "manual_upload", "enabled", "none"]],
  oshpark: [["import-upload", "dfm_quote_transfer", "api", "disabled", "none"], ["api-upload", "dfm_quote_transfer", "api", "disabled", "session-token"], ["checkout", "ordering", "api", "disabled", "session-token"], ["manual-upload", "handoff", "manual_upload", "enabled", "none"]],
  macrofab: [["upload", "dfm_quote_transfer", "api", "disabled", "api-key-header"], ["dfm-readiness", "dfm_quote_transfer", "api", "disabled", "api-key-header"], ["pcb-quote", "dfm_quote_transfer", "api", "disabled", "api-key-header"], ["order-read", "read_observation", "api", "disabled", "api-key-header"]],
  eurocircuits: [["web-quote", "handoff", "manual_upload", "enabled", "none"]],
  digikey: [["product-information", "read_observation", "api", "enabled", "b19:digikey.auth"], ["bom-upload-link", "handoff", "deep_link", "enabled", "none"], ["cart-csv", "handoff", "csv_export", "enabled", "none"], ["quote", "dfm_quote_transfer", "api", "disabled", "oauth2-authorization-code"], ["ordering", "ordering", "api", "disabled", "oauth2-authorization-code"]],
  mouser: [["part-number-search", "read_observation", "api", "disabled", "b19:mouser.auth"], ["bom-upload-link", "handoff", "deep_link", "enabled", "none"], ["cart-csv", "handoff", "csv_export", "enabled", "none"], ["cart", "ordering", "api", "disabled", "api-key-query-parameter"], ["order", "ordering", "api", "disabled", "api-key-query-parameter"]],
  nexar: [["supply-search", "read_observation", "api", "enabled", "b19:octopart.auth"]],
  lcsc: [["product-search", "read_observation", "api", "blocked", "b19:lcsc.auth"], ["order-create", "ordering", "api", "disabled", "signed-request-partner-key"], ["check-order", "read_observation", "api", "blocked", "signed-request-partner-key"], ["get-shipment", "read_observation", "api", "blocked", "signed-request-partner-key"], ["bom-tool-link", "handoff", "deep_link", "enabled", "none"], ["cart-csv", "handoff", "csv_export", "enabled", "none"]],
};

/**
 * Every API endpoint the registry states (RECORDED or, for PCBWay's paths, INFERRED from the help pages' names); every other API
 * operation's endpoint is an UNKNOWN record or its B19 entry's `endpoints`. [B23-A1 review, 2026-10-02]
 */
const EXPECTED_API_ENDPOINTS: Readonly<Record<string, string>> = {
  "pcbway.pcb-quotation": "POST /api/Pcb/PcbQuotation",
  "pcbway.place-order": "POST /api/Pcb/PlaceOrder",
  "pcbway.confirm-order": "POST /api/Pcb/ConfirmOrder",
  "pcbway.cancel-order": "POST /api/Pcb/CancelOrder",
  "oshpark.import-upload": "POST https://oshpark.com/import",
  "macrofab.dfm-readiness": "GET/POST /api/v5/pcb/{pcb_id}/{pcb_version}/ready/{quantity}",
  "macrofab.pcb-quote": "GET/POST /api/v4/quote/pcb/{id}/{version}/{quantity}",
  "mouser.order": "POST /api/v{version}/order",
};

/** Backticked spans of a text, whitespace folded (a span may wrap a line). */
const spans = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]!.replace(/\s+/g, " ").trim());
const pathOf = (span: string, hostname: string): string | null => {
  if (span.startsWith("/")) return span;
  try {
    const parsed = new URL(span);
    return parsed.hostname === hostname ? parsed.pathname : null;
  } catch {
    return null;
  }
};
/**
 * [B23-A1 review, 2026-10-02] A documentation URL is named in section 1.2 when one provider bullet carries it whole (a backticked
 * span, never a prefix); or names its host and its whole path; or names its last segment (bare, or as `.../segment`) beside a sibling
 * page on the same host in the same directory. A host plus a word that happens to occur somewhere in the section no longer counts.
 * [B23-A1 lead, 2026-10-02] A BARE segment counts only when it is in the sibling's naming family (the same text up to its last `-`,
 * as `POST-api-Pcb-PlaceOrder` beside `/Help/Api/POST-api-Pcb-PcbQuotation`): a field value or a verb the bullet happens to quote
 * (`checkout`, `PCBWayWebPay`) is no page name.
 */
function namedInSection(url: string, bullets: readonly string[]): boolean {
  const parsed = new URL(url);
  const parent = (path: string): string => path.slice(0, path.lastIndexOf("/"));
  const last = parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1);
  return bullets.some((bullet) => {
    const named = spans(bullet);
    if (named.includes(url)) return true;
    if (!bullet.includes(parsed.hostname)) return false;
    if (named.includes(parsed.pathname)) return true;
    const explicit = named.includes(`.../${last}`);
    if (last === "" || !(named.includes(last) || explicit)) return false;
    const family = (segment: string): string | null => (segment.includes("-") ? segment.slice(0, segment.lastIndexOf("-") + 1) : null);
    return named.some((span) => {
      const path = pathOf(span, parsed.hostname);
      if (path === null || path === parsed.pathname || parent(path) !== parent(parsed.pathname)) return false;
      return explicit || (family(last) !== null && family(last) === family(path.slice(path.lastIndexOf("/") + 1)));
    });
  });
}

/** One CSV line's cells (RFC 4180 quoting, as `renderProviderRegistryCsv` writes it). */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") quoted = false;
      else cell += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") {
      out.push(cell);
      cell = "";
    } else cell += char;
  }
  out.push(cell);
  return out;
}

type DeepMutable<T> = T extends readonly (infer U)[] ? DeepMutable<U>[] : T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> } : T;
type MutableRow = DeepMutable<ProviderRow>;
/** A loose view for writing a value the types forbid (the validator must refuse what the type system cannot see at run time). */
type Loose = Record<string, unknown>;
const loose = (value: unknown): Loose => value as Loose;

/** The registry with one row rewritten (a deep copy; the frozen registry is never touched). */
function mutated(id: ProviderId, change: (row: MutableRow) => void): ProviderRow[] {
  return PROVIDER_ROWS.map((row) => {
    if (row.id !== id) return row;
    const copy = JSON.parse(JSON.stringify(row)) as MutableRow;
    change(copy);
    return copy as unknown as ProviderRow;
  });
}
const operation = (row: MutableRow, id: string) => row.operations.find((entry) => entry.id === id)!;

/** Every string anywhere inside a value, with the key that holds it. */
function strings(value: unknown, key = "", out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === "string") out.push([key, value]);
  else if (Array.isArray(value)) for (const item of value) strings(item, key, out);
  else if (value && typeof value === "object") for (const [inner, item] of Object.entries(value)) strings(item, inner, out);
  return out;
}
/** Every object anywhere inside a value. */
function objects(value: unknown, out: Loose[] = []): Loose[] {
  if (Array.isArray(value)) for (const item of value) objects(item, out);
  else if (value && typeof value === "object") {
    out.push(value as Loose);
    for (const item of Object.values(value)) objects(item, out);
  }
  return out;
}

describe("[B23-A1] the provider registry is a closed, versioned sibling of B19's", () => {
  it("1. is versioned, deep-frozen, and holds the nine OD-162 providers in order; the kinds and the tier order are the OD-161/OD-162 vocabularies", () => {
    expect(PROVIDER_REGISTRY_VERSION).toBe("1.0.0");
    expect([...PROVIDER_IDS]).toEqual(["jlcpcb", "pcbway", "oshpark", "macrofab", "eurocircuits", "digikey", "mouser", "nexar", "lcsc"]);
    expect(PROVIDER_ROWS.map((row) => row.id)).toEqual([...PROVIDER_IDS]);
    for (const id of PROVIDER_IDS) expect(PROVIDER_REGISTRY[id].id).toBe(id);
    expect([...PROVIDER_KINDS]).toEqual(["manufacturer", "assembler", "quote_service", "distributor"]);
    expect([...PROVIDER_TIERS]).toEqual(["none", "handoff", "read_observation", "dfm_quote_transfer", "ordering"]);
    expect(PROVIDER_TIERS.map(tierRank)).toEqual([0, 1, 2, 3, 4]);
    expect([...OPERATION_CHANNELS]).toEqual(["api", "deep_link", "csv_export", "manual_upload"]);
    expect([...OPERATION_STATES]).toEqual(["enabled", "disabled", "blocked"]);
    // [B23-A1 review, 2026-10-02] D23-2's auth vocabulary and the record sources are closed and pinned too
    expect([...AUTH_SCHEMES]).toEqual(["none", "api-key-header", "api-key-query-parameter", "session-token", "oauth2-client-credentials", "oauth2-authorization-code", "signed-request-partner-key"]);
    expect([...OPERATION_SOURCES]).toEqual(["discovery-1.2", "repository", "b19-registry"]);
    expect(Object.isFrozen(PROVIDER_ROWS)).toBe(true);
    for (const value of objects(PROVIDER_ROWS)) expect(Object.isFrozen(value)).toBe(true);
    expect(Object.fromEntries(PROVIDER_ROWS.map((row) => [row.id, row.kind]))).toEqual({ jlcpcb: "manufacturer", pcbway: "manufacturer", oshpark: "manufacturer", macrofab: "manufacturer", eurocircuits: "manufacturer", digikey: "distributor", mouser: "distributor", nexar: "distributor", lcsc: "distributor" });
  });

  it("2. closed keys: every row, nested block, operation, UNKNOWN record and B19 reference has exactly its keys", () => {
    for (const row of PROVIDER_ROWS) {
      expect(Object.keys(row).sort(), row.id).toEqual([...ROW_KEYS].sort());
      for (const [name, pick, keys] of NESTED_KEYS) expect(Object.keys(pick(row) as object).sort(), `${row.id}.${name}`).toEqual([...keys].sort());
      for (const doc of row.documentation) expect(Object.keys(doc).sort(), `${row.id} documentation`).toEqual(["readOn", "url"]);
      for (const reference of row.credentials.references) expect(Object.keys(reference).sort(), `${row.id} reference`).toEqual(["env", "role"]);
      const capability = row.capabilityProfile;
      expect(Object.keys(capability).sort(), `${row.id} capability`).toEqual(capability.mapping === "jlcpcb-2l" ? ["digest", "evidenceExpiresAt", "mapping", "profileId", "version"] : ["mapping", "reason"]);
      for (const entry of row.operations) expect(Object.keys(entry).sort(), `${row.id}.${entry.id}`).toEqual([...OPERATION_KEYS].sort());
    }
    for (const value of objects(PROVIDER_ROWS)) {
      if ("value" in value && value.value === "UNKNOWN") expect(Object.keys(value).sort()).toEqual(["reason", "value"]);
      if ("b19" in value) expect(Object.keys(value).sort()).toEqual(["b19", "path"]);
    }
  });

  it("3. every row carries all twelve runbook fields (:956-967): a value, the literal UNKNOWN with a reason, or (a distributor) a reference into its B19 entry", () => {
    expect(RUNBOOK_FIELDS.map(([name]) => name)).toEqual([
      "legal provider identity", "endpoint/API version", "credential reference and account scope", "supported operations", "region/currency",
      "capability-profile mapping", "data retention/confidentiality terms", "upload and quote limits", "webhook/signature contract",
      "idempotency support", "order/cancellation policy", "enabled feature tier",
    ]);
    for (const row of PROVIDER_ROWS) {
      for (const [name, key] of RUNBOOK_FIELDS) {
        const value = (row as unknown as Loose)[key];
        expect(value, `${row.id}: ${name}`).toBeDefined();
        expect(value, `${row.id}: ${name}`).not.toBe("");
      }
      expect(row.operations.length, `${row.id} supported operations`).toBeGreaterThan(0);
    }
    // UNKNOWN appears only as a record's value, always with a reason; never as a bare value or inside a stated fact
    for (const value of objects(PROVIDER_ROWS)) if (value.value === "UNKNOWN") expect(String(value.reason ?? "").trim().length, JSON.stringify(value)).toBeGreaterThan(10);
    const bare = strings(PROVIDER_ROWS).filter(([key, text]) => /\bUNKNOWN\b/.test(text) && !(key === "value" && text === "UNKNOWN") && !["reason", "purpose", "notes"].includes(key));
    expect(bare).toEqual([]);
    expect(PROVIDER_ROWS.flatMap((row) => objects(row)).filter((value) => value.value === "UNKNOWN").length).toBeGreaterThan(40);
  });

  it("4. passes every structural rule", () => {
    expect(validateProviderRegistry()).toEqual([]);
  });

  it("5. every provider fact is RECORDED by reader 7 on 2026-10-01 from the discovery's section 1.2, not re-read in A1; documentation is HTTPS, dated, and named in section 1.2 (whole, or by its path beside its host)", () => {
    const discovery = read(DISCOVERY);
    const section = discovery.slice(discovery.indexOf("### 1.2 External references"), discovery.indexOf("### 1.3 Repository state"));
    expect(section.length).toBeGreaterThan(5_000);
    const bullets = section.split(/\n- \*\*/).slice(1);
    expect(bullets.length).toBeGreaterThanOrEqual(PROVIDER_ROWS.length);
    for (const row of PROVIDER_ROWS) {
      expect(row.reading, row.id).toEqual({ label: "RECORDED", reader: "reader 7", readOn: "2026-10-01", where: "artifacts/ai-control-plane-b23/discovery.md section 1.2", reReadInA1: false });
      expect(row.documentation.length, row.id).toBeGreaterThan(0);
      for (const { url, readOn } of row.documentation) {
        expect(readOn, url).toBe("2026-10-01");
        const parsed = new URL(url);
        expect(parsed.protocol, url).toBe("https:");
        expect(parsed.username + parsed.password + parsed.search + parsed.hash, url).toBe("");
        expect(namedInSection(url, bullets), `${row.id}: ${url} is named in section 1.2`).toBe(true);
      }
    }
    // [B23-A1 review, 2026-10-02] the rule refuses a page section 1.2 does not name: a host plus a word found elsewhere, a prefix of
    // a named page, a named path on another provider's host, or a sibling segment the section never spells
    for (const url of ["https://developer.digikey.com/anything/ordering", "https://api.jlcpcb.com/v2/start", "https://developer.digikey.com/prod", "https://api.jlcpcb.com/import", "https://api-partner.pcbway.com/Help/Api/POST-api-Pcb-PayOrder", "https://oshpark.com/developer/checkout", "https://api-partner.pcbway.com/Help/Api/PCBWayWebPay"]) {
      expect(namedInSection(url, bullets), url).toBe(false);
    }
  });
});

describe("[B23-A1] the rows and their per-operation tiers (OD-162, D23-2)", () => {
  it("6. each provider records exactly OD-162's operations with their own tier, channel, state and authentication scheme, and the API endpoints the registry states; the enabled tier is the highest enabled operation's", () => {
    for (const row of PROVIDER_ROWS) expect(row.operations.map((entry) => [entry.id, entry.tier, entry.channel, entry.state, authWord(entry.auth)]), row.id).toEqual(EXPECTED_OPERATIONS[row.id]);
    // [B23-A1 review, 2026-10-02] every stated API endpoint, and nothing else stated: the rest are UNKNOWN records or B19's entry
    const stated = Object.fromEntries(PROVIDER_ROWS.flatMap((row) => row.operations.filter((entry) => entry.channel === "api" && typeof entry.endpoint === "string").map((entry) => [`${row.id}.${entry.id}`, entry.endpoint as string])));
    expect(stated).toEqual(EXPECTED_API_ENDPOINTS);
    for (const row of PROVIDER_ROWS) {
      for (const entry of row.operations.filter((item) => item.channel === "api" && typeof item.endpoint !== "string")) {
        const endpoint = entry.endpoint as Exclude<ProviderOperation["endpoint"], string>;
        if ("b19" in endpoint) expect(endpoint, `${row.id}.${entry.id}`).toEqual({ b19: row.b19Source, path: "endpoints" });
        else expect(endpoint.value, `${row.id}.${entry.id}`).toBe("UNKNOWN");
      }
    }
    expect(Object.fromEntries(PROVIDER_ROWS.map((row) => [row.id, row.apiAccess.status]))).toEqual({ jlcpcb: "blocked", pcbway: "blocked", oshpark: "disabled", macrofab: "disabled", eurocircuits: "none_found", digikey: "enabled", mouser: "disabled", nexar: "enabled", lcsc: "blocked" });
    expect(Object.fromEntries(PROVIDER_ROWS.map((row) => [row.id, row.enabledFeatureTier]))).toEqual({ jlcpcb: "handoff", pcbway: "handoff", oshpark: "handoff", macrofab: "none", eurocircuits: "handoff", digikey: "read_observation", mouser: "handoff", nexar: "read_observation", lcsc: "handoff" });
    for (const row of PROVIDER_ROWS) {
      const enabled = row.operations.filter((entry) => entry.state === "enabled").map((entry) => tierRank(entry.tier));
      expect(tierRank(row.enabledFeatureTier), row.id).toBe(enabled.length === 0 ? 0 : Math.max(...enabled));
    }
  });

  it("7. no ordering operation is above disabled and no transfer is enabled; ordering is recorded present-but-disabled where a provider documents it; OSH Park's checkout is recorded as never called", () => {
    const all = PROVIDER_ROWS.flatMap((row) => row.operations.map((entry) => ({ row, entry })));
    const ordering = all.filter(({ entry }) => entry.tier === "ordering");
    expect(ordering.map(({ row, entry }) => `${row.id}.${entry.id}`)).toEqual(["jlcpcb.pcb-order", "pcbway.place-order", "pcbway.confirm-order", "pcbway.cancel-order", "oshpark.checkout", "digikey.ordering", "mouser.cart", "mouser.order", "lcsc.order-create"]);
    for (const { row, entry } of ordering) expect(entry.state, `${row.id}.${entry.id}`).toBe("disabled");
    for (const { row, entry } of all.filter(({ entry }) => entry.tier === "dfm_quote_transfer")) expect(entry.state, `${row.id}.${entry.id}`).not.toBe("enabled");
    expect(all.filter(({ entry }) => entry.neverCalled).map(({ row, entry }) => `${row.id}.${entry.id}`)).toEqual(["oshpark.checkout"]);
    // JLCPCB's and PCBWay's transfers are blocked (approval-gated, no access); the rest wait for an account the owner does not hold
    for (const id of ["jlcpcb", "pcbway"] as const) for (const entry of PROVIDER_REGISTRY[id].operations.filter((item) => item.tier === "dfm_quote_transfer")) expect(entry.state).toBe("blocked");
    expect(PROVIDER_REGISTRY.oshpark.operations.find((entry) => entry.id === "checkout")!.reason).toMatch(/never called/);
    // D23-19, the code half: every transfer names its live blocker LB-11, every order LB-12 (OD-179; the register rows are the lead's)
    for (const { row, entry } of all.filter(({ entry }) => entry.tier === "dfm_quote_transfer")) expect(entry.reason, `${row.id}.${entry.id}`).toContain("LB-11");
    for (const { row, entry } of ordering) expect(entry.reason, `${row.id}.${entry.id}`).toContain("LB-12");
  });

  it("8. hand-offs are deep links, CSV downloads or manual uploads - never an API call - and the ones Sirkit offers today are the repository's", () => {
    for (const row of PROVIDER_ROWS) {
      for (const entry of row.operations) {
        expect(entry.tier === "handoff", `${row.id}.${entry.id}`).toBe(entry.channel !== "api");
        if (entry.tier !== "handoff") continue;
        expect(entry.auth, `${row.id}.${entry.id}`).toBe("none");
        const endpoint = entry.endpoint as string;
        if (endpoint.startsWith("repo:")) {
          expect(existsSync(join(ROOT, endpoint.slice(5))), endpoint).toBe(true);
          expect(entry.source).toBe("repository");
        } else {
          expect(new URL(endpoint).protocol, endpoint).toBe("https:");
          expect(entry.source).toBe("discovery-1.2");
        }
      }
    }
    // the manufacturer presets' notes are the manual uploads; DigiKey's, Mouser's and LCSC's upload pages and cart CSVs are B19-E's
    for (const [id, preset] of [["jlcpcb", "jlcpcb-2l"], ["pcbway", "pcbway-standard"], ["oshpark", "oshpark-4l"]] as const) {
      const upload = PROVIDER_REGISTRY[id].operations.find((entry) => entry.tier === "handoff" && entry.endpoint === `repo:app/lib/pcb/fab/presets/${preset}.fab.json`);
      expect(upload, id).toBeDefined();
      expect((JSON.parse(read(`app/lib/pcb/fab/presets/${preset}.fab.json`)) as { notes: string }).notes, preset).toMatch(/upload this zip/);
    }
    for (const id of ["digikey", "mouser", "lcsc"] as const) {
      const row = PROVIDER_REGISTRY[id];
      expect(Object.keys(DISTRIBUTOR_UPLOAD_URLS)).toContain(row.b19Source);
      expect(row.operations.filter((entry) => entry.channel === "deep_link").map((entry) => entry.endpoint)).toEqual(["repo:app/lib/distributor-links.ts"]);
      expect(row.operations.filter((entry) => entry.channel === "csv_export").map((entry) => entry.endpoint)).toEqual([`repo:app/api/bom/cart/${row.b19Source}/route.ts`]);
    }
  });

  it("9. a blocked row and a row with no official API declare no callable host and no secret; Eurocircuits is hand-off only (no scraping); no row declares a callable host in B23 (no API operation of a manufacturer is enabled)", () => {
    for (const row of PROVIDER_ROWS) {
      expect(row.endpoint.hosts, row.id).toEqual([]);
      if (row.apiAccess.status === "blocked" || row.apiAccess.status === "none_found") expect(row.credentials.references, row.id).toEqual([]);
    }
    const euro = PROVIDER_REGISTRY.eurocircuits;
    expect(euro.endpoint.documentedHosts).toEqual([]);
    expect(euro.operations.every((entry) => entry.tier === "handoff" && entry.channel !== "api")).toBe(true);
    expect(Object.fromEntries(PROVIDER_ROWS.filter((row) => row.b19Source === null).map((row) => [row.id, row.endpoint.documentedHosts]))).toEqual({ jlcpcb: ["api.jlcpcb.com"], pcbway: ["api-partner.pcbway.com"], oshpark: ["oshpark.com"], macrofab: ["api.macrofab.com"], eurocircuits: [] });
    for (const row of PROVIDER_ROWS) for (const host of [...row.endpoint.hosts, ...row.endpoint.documentedHosts]) expect(host, row.id).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);
  });

  it("10. distributor rows reference their B19 entry by id and add only the B23 fields: no duplicated hosts or secrets, reads exactly as B19 has them, and B19's registry untouched", () => {
    expect(Object.fromEntries(PROVIDER_ROWS.map((row) => [row.id, row.b19Source]))).toEqual({ jlcpcb: null, pcbway: null, oshpark: null, macrofab: null, eurocircuits: null, digikey: "digikey", mouser: "mouser", nexar: "octopart", lcsc: "lcsc" });
    for (const row of PROVIDER_ROWS.filter((item) => item.b19Source !== null)) {
      const source = SOURCE_REGISTRY[row.b19Source!];
      expect([row.endpoint.hosts, row.endpoint.documentedHosts, row.credentials.references], row.id).toEqual([[], [], []]);
      expect(row.apiAccess.status, row.id).toBe(source.state.status);
      const reads = row.operations.filter((entry) => entry.tier === "read_observation" && entry.source === "b19-registry");
      expect(reads.length, row.id).toBe(1);
      expect(reads[0]!.state, row.id).toBe(source.state.status);
      expect(reads[0]!.endpoint, row.id).toEqual({ b19: row.b19Source, path: "endpoints" });
      expect(reads[0]!.auth, row.id).toEqual({ b19: row.b19Source, path: "auth" });
      expect(row.legalIdentity, row.id).toEqual({ b19: row.b19Source, path: "provider.organization" });
      // nothing the B19 entry holds is copied: none of its hosts or secret names appears in the row's endpoint, credentials or
      // operations (a documentation page may live on a vendor's API host; it is a page read, never a host called)
      const text = JSON.stringify({ endpoint: row.endpoint, credentials: row.credentials, operations: row.operations, notes: row.notes });
      for (const host of source.endpoints.hosts) expect(text, `${row.id} ${host}`).not.toContain(host);
      for (const reference of source.auth.secrets) expect(text, `${row.id} ${reference.env}`).not.toContain(reference.env);
    }
    expect(SOURCE_REGISTRY_VERSION).toBe("1.1.0");
    expect(validateSourceRegistry()).toEqual([]);
  });

  it("11. capability mapping (D23-18): JLCPCB maps `jlcpcb-2l` with the id, version, digest and evidence expiry rule-profile.ts computes; every other row is `unmapped` with a reason", () => {
    expect([...QUALIFIED_RULE_PROFILE_IDS]).toEqual(["jlcpcb-2l"]);
    const profile = buildManufacturingRuleProfile({ presetId: "jlcpcb-2l", evidence: JLCPCB_2L_RULE_PROFILE_EVIDENCE });
    expect(PROVIDER_REGISTRY.jlcpcb.capabilityProfile).toEqual({ mapping: "jlcpcb-2l", profileId: profile.profileId, version: profile.version, digest: profile.digest, evidenceExpiresAt: JLCPCB_2L_RULE_PROFILE_EVIDENCE.expiresAt });
    expect(JLCPCB_2L_RULE_PROFILE_EVIDENCE.expiresAt).toBe("2027-09-09");
    for (const row of PROVIDER_ROWS.filter((item) => item.id !== "jlcpcb")) {
      expect(row.capabilityProfile.mapping, row.id).toBe("unmapped");
      expect(row.capabilityProfile.mapping === "unmapped" ? row.capabilityProfile.reason : "", row.id).toMatch(/\S{3,}/);
    }
  });
});

/** An obvious fake, assembled at run time: the api-endpoint rule must refuse a query on a path, whatever it carries. */
const FAKE_QUERY_KEY = ["fake", "mouser", "order", "key"].join("-");
/** MacroFab's order read enabled, with the row's tier to match (the crafted revisions that enable a manufacturer API read). */
const enableMacroFabRead = (row: MutableRow): void => {
  operation(row, "order-read").state = "enabled";
  row.enabledFeatureTier = "read_observation";
};

/**
 * One crafted revision per guarded branch of every validator rule: [rule, what the revision does, the revision, a fragment of the
 * message only that branch writes]. [B23-A1 review, 2026-10-02] Was one revision per rule, asserting only the rule tag, so a deleted
 * branch (a hand-off's credential, an unresolvable B19 path, an undeclared https host, an auth outside the vocabulary, a B19 read
 * count, B19's access status, an enabled never-called operation, a no-API row's tier) left every case green.
 */
const VIOLATIONS: ReadonlyArray<readonly [string, string, ProviderRow[], string]> = [
  ["closed-keys", "an extra key on a row", mutated("jlcpcb", (row) => { loose(row).extra = "x"; }), "row keys are not exactly"],
  ["closed-keys", "an extra key on a nested block", mutated("oshpark", (row) => { loose(row.limits).rate = "x"; }), "limits keys are not exactly"],
  ["closed-keys", "an extra key on a documentation entry", mutated("mouser", (row) => { loose(row.documentation[0]).checkedBy = "x"; }), "a documentation entry is not exactly url, readOn"],
  ["closed-keys", "an extra key on a credential reference", mutated("macrofab", (row) => { row.credentials.references.push({ env: "MACROFAB_API_KEY", role: "API key" }); loose(row.credentials.references[0]).scope = "x"; }), "a credential reference is not exactly env, role"],
  ["closed-keys", "an extra key on an operation", mutated("pcbway", (row) => { loose(row.operations[0]).cost = "x"; }), "operation pcb-quotation keys are not exactly"],
  ["closed-keys", "a jlcpcb-2l mapping without its evidence expiry", mutated("jlcpcb", (row) => { delete loose(row.capabilityProfile).evidenceExpiresAt; }), "capabilityProfile keys do not match its mapping"],
  ["id", "a provider id outside the registered ones", mutated("pcbway", (row) => { loose(row).id = "boardhouse"; }), "id is not one of the registered providers"],
  ["id", "a duplicate provider id", mutated("pcbway", (row) => { loose(row).id = "jlcpcb"; }), "duplicate id"],
  ["text", "an empty display name", mutated("macrofab", (row) => { row.displayName = " "; }), "displayName is empty"],
  ["text", "an empty API-access reason", mutated("oshpark", (row) => { row.apiAccess.reason = ""; }), "apiAccess.reason is empty"],
  ["text", "an empty note", mutated("lcsc", (row) => { row.notes.push(" "); }), "a note is empty"],
  ["text", "a credential reference without a role", mutated("macrofab", (row) => { row.credentials.references.push({ env: "MACROFAB_API_KEY", role: " " }); }), "a credential reference has no role"],
  ["text", "an operation without a purpose", mutated("macrofab", (row) => { operation(row, "upload").purpose = ""; }), "operation upload purpose is empty"],
  ["reading", "a provider fact labelled as executed", mutated("oshpark", (row) => { loose(row.reading).label = "CONFIRMED"; }), "a provider fact must be RECORDED"],
  ["documentation", "no documentation", mutated("eurocircuits", (row) => { row.documentation = []; }), "no official documentation recorded"],
  ["documentation", "plain-HTTP documentation", mutated("jlcpcb", (row) => { row.documentation[0]!.url = "http://api.jlcpcb.com/"; }), "documentation is not a plain HTTPS link"],
  ["documentation", "undated documentation", mutated("pcbway", (row) => { row.documentation[0]!.readOn = "recently"; }), "is not dated"],
  ["unknown", "an empty fact", mutated("macrofab", (row) => { row.idempotency = " "; }), "idempotency is empty"],
  ["unknown", "a bare UNKNOWN", mutated("jlcpcb", (row) => { row.legalIdentity = "UNKNOWN"; }), "legalIdentity spells UNKNOWN outside an UNKNOWN record"],
  ["unknown", "an UNKNOWN without a reason", mutated("macrofab", (row) => { row.webhook = { value: "UNKNOWN", reason: " " }; }), "webhook is an UNKNOWN record without its reason"],
  ["unknown", "a fact that is neither a value, an UNKNOWN record nor a B19 reference", mutated("oshpark", (row) => { loose(row).webhook = 42; }), "webhook is neither a value, an UNKNOWN record nor a B19 reference"],
  ["hosts-exact", "a wildcard host", mutated("jlcpcb", (row) => { row.endpoint.documentedHosts.push("*.jlcpcb.com"); }), "host is not an exact lowercase hostname"],
  ["hosts-exact", "a host listed twice", mutated("jlcpcb", (row) => { row.endpoint.documentedHosts.push("api.jlcpcb.com"); }), "a host is listed twice"],
  ["hosts-exact", "a host both callable and documented-only", mutated("oshpark", (row) => { row.endpoint.hosts.push("oshpark.com"); }), "oshpark.com is both callable and documented-only"],
  ["callable-hosts", "a callable host with no enabled API operation", mutated("macrofab", (row) => { row.endpoint.hosts.push("uploads.macrofab.com"); }), "callable hosts are declared but no API operation is enabled"],
  ["callable-hosts", "an enabled manufacturer API operation with no callable host", mutated("macrofab", (row) => { enableMacroFabRead(row); row.apiAccess.status = "enabled"; }), "an enabled API operation has no callable host"],
  ["api-access", "API access enabled with no enabled API operation", mutated("macrofab", (row) => { row.apiAccess.status = "enabled"; }), "API access is enabled but no API operation is"],
  ["api-access", "an API operation enabled while API access is disabled", mutated("macrofab", (row) => { enableMacroFabRead(row); }), "an API operation is enabled while API access is disabled"],
  ["blocked-row", "a blocked row with a secret reference", mutated("jlcpcb", (row) => { row.credentials.references.push({ env: "JLCPCB_APP_KEY", role: "app key" }); }), "a blocked row may not declare callable hosts or secrets"],
  ["blocked-row", "a blocked row with a callable host", mutated("pcbway", (row) => { row.endpoint.hosts.push("api-partner.pcbway.com"); }), "a blocked row may not declare callable hosts or secrets"],
  ["no-api-row", "a row with no official API naming a host", mutated("eurocircuits", (row) => { row.endpoint.documentedHosts.push("www.eurocircuits.com"); }), "a row with no official API may not name a host"],
  ["no-api-row", "a row with no official API recording an API operation", mutated("eurocircuits", (row) => { row.operations.push({ ...row.operations[0]!, id: "scraped-quote", tier: "dfm_quote_transfer", channel: "api", state: "disabled", endpoint: "POST /quote", auth: "none" }); }), "a row with no official API records hand-offs only"],
  ["no-api-row", "a row with no official API above hand-off", mutated("eurocircuits", (row) => { row.enabledFeatureTier = "read_observation"; }), "a row with no official API is at most hand-off"],
  ["b19-reference", "a distributor row that names no B19 entry", mutated("digikey", (row) => { loose(row).b19Source = null; }), "a distributor row (and only a distributor row) names its B19 entry"],
  ["b19-reference", "a B19 entry that does not exist", mutated("digikey", (row) => { loose(row).b19Source = "boardhouse"; }), "b19Source boardhouse is not a B19 source"],
  ["b19-reference", "a distributor row duplicating a B19 host", mutated("digikey", (row) => { row.endpoint.documentedHosts.push("api.digikey.com"); }), "a distributor row may not duplicate B19's hosts or secrets"],
  ["b19-reference", "a reference into another source's entry", mutated("nexar", (row) => { row.legalIdentity = { b19: "digikey", path: "provider.organization" }; }), "a reference into digikey on a row that is not that source's"],
  ["b19-reference", "a B19 path that does not resolve", mutated("digikey", (row) => { row.regionCurrency.region = { b19: "digikey", path: "scope.regoin" }; }), "the reference scope.regoin does not resolve in B19's digikey"],
  ["b19-reference", "a manufacturer recording a B19 read", mutated("jlcpcb", (row) => { operation(row, "pcb-quote").source = "b19-registry"; }), "only a distributor row records B19's read"],
  ["b19-reference", "a distributor whose API access does not mirror B19's", mutated("mouser", (row) => { row.apiAccess.status = "blocked"; }), "API access blocked does not mirror B19's disabled"],
  ["b19-reference", "a distributor with no B19 read", mutated("digikey", (row) => { row.operations = row.operations.filter((entry) => entry.source !== "b19-registry"); }), "a distributor row records B19's read exactly once"],
  ["b19-reference", "a distributor with two B19 reads", mutated("digikey", (row) => { row.operations.push({ ...operation(row, "product-information"), id: "product-information-again" }); }), "a distributor row records B19's read exactly once"],
  ["b19-reference", "a B19 read not by reference", mutated("digikey", (row) => { operation(row, "product-information").endpoint = "GET /search"; }), "the read product-information is not B19's read operation by reference"],
  ["b19-reference", "a distributor read that does not mirror its B19 state", mutated("mouser", (row) => { operation(row, "part-number-search").state = "enabled"; }), "the read part-number-search is enabled; B19 has disabled"],
  ["b19-reference", "a distributor API operation naming a host", mutated("digikey", (row) => { operation(row, "quote").endpoint = "POST https://api.digikey.com/quote"; }), "the API operation quote names a host; a distributor's hosts live in B19"],
  ["secrets", "a secret VALUE where a variable name belongs", mutated("macrofab", (row) => { row.credentials.references.push({ env: "abcd-1234-real-key", role: "API key" }); }), "secret reference is not an environment variable name"],
  ["secrets", "something shaped like a real secret anywhere", mutated("oshpark", (row) => { row.notes.push(`token ${["gh", "p_"].join("")}${"a".repeat(36)}`); }), "the row contains something shaped like a secret value"],
  ["operation-id", "a row with no operation", mutated("eurocircuits", (row) => { row.operations = []; }), "a row records no operation"],
  ["operation-id", "an operation id that is not kebab-case", mutated("pcbway", (row) => { operation(row, "place-order").id = "Place_Order"; }), "operation id is not kebab-case: Place_Order"],
  ["operation-id", "a duplicate operation id", mutated("pcbway", (row) => { row.operations[1]!.id = row.operations[0]!.id; }), "an operation id is listed twice"],
  ["vocabulary", "a kind outside the vocabulary", mutated("macrofab", (row) => { loose(row).kind = "broker"; }), "kind broker is not a provider kind"],
  ["vocabulary", "an API-access status outside the vocabulary", mutated("oshpark", (row) => { loose(row.apiAccess).status = "open"; }), "API access open is not a status"],
  ["vocabulary", "an enabled tier outside the vocabulary", mutated("macrofab", (row) => { loose(row).enabledFeatureTier = "spend"; }), "enabledFeatureTier spend is not a tier"],
  ["vocabulary", "a tier outside the vocabulary", mutated("macrofab", (row) => { loose(row.operations[0]).tier = "spend"; }), "operation upload tier spend is not an operation tier"],
  ["vocabulary", "a channel outside the vocabulary", mutated("oshpark", (row) => { loose(operation(row, "manual-upload")).channel = "email"; }), "operation manual-upload channel email is not a channel"],
  ["vocabulary", "a state outside the vocabulary", mutated("oshpark", (row) => { loose(operation(row, "api-upload")).state = "paused"; }), "operation api-upload state paused is not a state"],
  ["vocabulary", "a record source outside the vocabulary", mutated("jlcpcb", (row) => { loose(operation(row, "dfm-web-tool")).source = "web"; }), "operation dfm-web-tool source web is not a source"],
  ["vocabulary", "an authentication scheme outside the vocabulary", mutated("digikey", (row) => { loose(operation(row, "quote")).auth = "basic"; }), "operation quote auth basic is not an auth scheme"],
  ["vocabulary", "a never-called mark that is not a boolean", mutated("oshpark", (row) => { loose(operation(row, "checkout")).neverCalled = "yes"; }), "operation checkout neverCalled is not a boolean"],
  ["handoff", "a hand-off recorded as an API call", mutated("jlcpcb", (row) => { operation(row, "manual-quote-upload").channel = "api"; }), "operation manual-quote-upload: a hand-off is exactly a deep link, a CSV download or a manual upload"],
  ["handoff", "a CSV download recorded above hand-off", mutated("digikey", (row) => { operation(row, "cart-csv").tier = "read_observation"; }), "operation cart-csv: a hand-off is exactly a deep link, a CSV download or a manual upload"],
  ["handoff", "a hand-off carrying a credential", mutated("jlcpcb", (row) => { loose(operation(row, "manual-quote-upload")).auth = "api-key-header"; }), "hand-off manual-quote-upload carries a credential"],
  ["handoff", "a hand-off recorded as B19's", mutated("lcsc", (row) => { operation(row, "cart-csv").source = "b19-registry"; }), "hand-off cart-csv is not B19's to record"],
  ["handoff", "a hand-off naming a file outside the repository", mutated("oshpark", (row) => { operation(row, "manual-upload").endpoint = "repo:app/lib/../../.env"; }), "hand-off manual-upload names neither a repository file nor an https page"],
  ["api-endpoint", "an API endpoint with no target", mutated("pcbway", (row) => { operation(row, "place-order").endpoint = "PUT"; }), "operation place-order endpoint is not \"METHOD target\""],
  ["api-endpoint", "a plain-HTTP API endpoint", mutated("oshpark", (row) => { operation(row, "import-upload").endpoint = "POST http://oshpark.com/import"; }), "operation import-upload endpoint is not a path or a plain HTTPS URL"],
  ["api-endpoint", "an API endpoint on an undeclared https host", mutated("macrofab", (row) => { operation(row, "dfm-readiness").endpoint = "POST https://evil.example/upload"; }), "operation dfm-readiness host evil.example is not declared"],
  ["api-endpoint", "a path endpoint carrying a query (a key in a recorded URL)", mutated("mouser", (row) => { operation(row, "order").endpoint = `POST /api/v1/order?apiKey=${FAKE_QUERY_KEY}`; }), "operation order endpoint path carries a query, a fragment, credentials or a host"],
  ["api-endpoint", "a scheme-relative path endpoint (a host by the back door)", mutated("pcbway", (row) => { operation(row, "place-order").endpoint = "POST //evil.example/api/Pcb/PlaceOrder"; }), "operation place-order endpoint path carries a query, a fragment, credentials or a host"],
  ["api-endpoint", "a path endpoint carrying a fragment", mutated("macrofab", (row) => { operation(row, "pcb-quote").endpoint = "GET /api/v4/quote#key"; }), "operation pcb-quote endpoint path carries a query, a fragment, credentials or a host"],
  ["api-endpoint", "a path endpoint carrying credentials", mutated("pcbway", (row) => { operation(row, "cancel-order").endpoint = "POST /api/Pcb/CancelOrder@evil.example"; }), "operation cancel-order endpoint path carries a query, a fragment, credentials or a host"],
  ["ordering-disabled", "an ordering operation enabled", mutated("lcsc", (row) => { operation(row, "order-create").state = "enabled"; }), "ordering operation order-create is enabled"],
  ["transfer-not-admitted", "a transfer enabled with no owner decision naming an account", mutated("macrofab", (row) => { operation(row, "pcb-quote").state = "enabled"; }), "transfer operation pcb-quote is enabled"],
  ["never-called", "a never-called mark on a hand-off", mutated("jlcpcb", (row) => { operation(row, "manual-quote-upload").neverCalled = true; }), "operation manual-quote-upload is marked never called but is not an API operation"],
  ["never-called", "an enabled API operation marked never called (no ordering rule fires)", mutated("macrofab", (row) => { enableMacroFabRead(row); operation(row, "order-read").neverCalled = true; }), "operation order-read is marked never called but is enabled"],
  ["feature-tier", "an enabled tier that no enabled operation has", mutated("macrofab", (row) => { row.enabledFeatureTier = "handoff"; }), "enabledFeatureTier handoff is not the highest enabled operation's (none)"],
  ["capability", "a capability digest that is not a rule-profile digest", mutated("jlcpcb", (row) => { if (row.capabilityProfile.mapping === "jlcpcb-2l") row.capabilityProfile.digest = "mfg-rule-xyz"; }), "a jlcpcb-2l mapping needs the profile id, a version, a rule-profile digest and the evidence expiry"],
  ["capability", "a distributor mapped to a fabrication profile", mutated("lcsc", (row) => { row.capabilityProfile = { ...PROVIDER_REGISTRY.jlcpcb.capabilityProfile } as MutableRow["capabilityProfile"]; }), "only a manufacturer maps to a fabrication rule profile"],
  ["capability", "an unmapped row without a reason", mutated("pcbway", (row) => { row.capabilityProfile = { mapping: "unmapped", reason: " " }; }), "an unmapped row needs a reason"],
  ["capability", "a mapping that is neither jlcpcb-2l nor unmapped", mutated("pcbway", (row) => { loose(row.capabilityProfile).mapping = "pcbway-standard"; }), "mapping pcbway-standard is neither jlcpcb-2l nor unmapped"],
];

describe("[B23-A1] the validator refuses what a registry revision must never contain", () => {
  it.each(VIOLATIONS)("12. [%s] %s", (rule, _label, revision, branch) => {
    const errors = validateProviderRegistry(revision);
    // the rule's tag AND the branch's own message: a deleted branch fails its case even while another branch of the rule fires
    expect(errors.filter((error) => error.includes(`[${rule}]`) && error.includes(branch)), errors.join("\n")).not.toEqual([]);
  });

  it("13. every rule the validator holds has a crafted revision above, every branch is crafted once, and every message names its rule", () => {
    expect([...new Set(VIOLATIONS.map(([rule]) => rule))].sort()).toEqual([...PROVIDER_REGISTRY_RULES].sort());
    expect(new Set(VIOLATIONS.map(([rule, label]) => `${rule} ${label}`)).size).toBe(VIOLATIONS.length);
    for (const [, , revision] of VIOLATIONS) for (const error of validateProviderRegistry(revision)) expect(error).toMatch(/^[a-z]+: \[[a-z0-9-]+\] /);
  });
});

describe("[B23-A1] the CD-12 projection (no third shape)", () => {
  it("14. every row projects to CD-12's ProcurementProviderDescriptor: exactly its keys, every field taken from the row (region, currency and account as the registry renders them, each reference to its own block), CD-12's kind word, and a digest over that content that differs per row", () => {
    const keys: ReadonlyArray<keyof ProcurementProviderDescriptor> = ["providerId", "providerVersion", "providerKind", "regionAccountScope", "authenticationRef", "licenseRef", "retentionPolicyRef", "semanticsRef", "deterministicDigest"];
    expect(CD12_PROVIDER_KIND).toEqual({ manufacturer: "manufacturer", assembler: "manufacturer", quote_service: "formal_quote", distributor: "authorized_distributor" });
    const kinds: Record<string, string> = {};
    const digests = new Set<string>();
    for (const row of PROVIDER_ROWS) {
      const descriptor = toProcurementProviderDescriptor(row);
      const self = `provider-registry@${PROVIDER_REGISTRY_VERSION}#${row.id}`;
      expect(Object.keys(descriptor).sort(), row.id).toEqual([...keys].sort());
      expect(descriptor.providerId).toBe(row.id);
      expect(descriptor.providerVersion).toBe(PROVIDER_REGISTRY_VERSION);
      expect(descriptor.semanticsRef).toBe(self);
      // [B23-A1 review, 2026-10-02] every field, not only its count or key: a dropped render or a swapped reference fails here
      expect(descriptor.regionAccountScope, row.id).toEqual([`region: ${renderFact(row.regionCurrency.region)}`, `currency: ${renderFact(row.regionCurrency.currency)}`, `account: ${renderFact(row.credentials.accountScope)}`]);
      for (const scope of descriptor.regionAccountScope) expect(scope, row.id).not.toMatch(/\[object |undefined/);
      expect(descriptor.authenticationRef, row.id).toBe(`${self}.credentials`);
      expect(descriptor.retentionPolicyRef, row.id).toBe(`${self}.outboundTerms.retention`);
      expect(descriptor.licenseRef, row.id).toBe(row.b19Source !== null ? `source-registry@${SOURCE_REGISTRY_VERSION}#${row.b19Source}.license` : `${self}.outboundTerms`);
      expect(descriptor.deterministicDigest, row.id).toMatch(/^cd12-[0-9a-f]+$/);
      digests.add(descriptor.deterministicDigest);
      expect(toProcurementProviderDescriptor(row), `${row.id} is deterministic`).toEqual(descriptor);
      kinds[row.id] = descriptor.providerKind;
    }
    expect(digests.size).toBe(PROVIDER_ROWS.length);
    // Nexar's B19 source is the aggregated Octopart data, so CD-12's aggregator word; the other distributors take its distributor word
    expect(kinds).toEqual({ jlcpcb: "manufacturer", pcbway: "manufacturer", oshpark: "manufacturer", macrofab: "manufacturer", eurocircuits: "manufacturer", digikey: "authorized_distributor", mouser: "authorized_distributor", nexar: "approved_aggregator", lcsc: "authorized_distributor" });
    // [B23-A1 review, 2026-10-02] a manufacturer and a distributor pinned whole, literally, and the digest is CD-12's over exactly that
    // content (was: the digest compared with CD-12's recomputation of the same object, which holds for any content)
    const notRead = "UNKNOWN (not recorded in the discovery's section 1.2 (the pages read do not state it))";
    const pinned: ReadonlyArray<readonly [ProviderId, Omit<ProcurementProviderDescriptor, "deterministicDigest">]> = [
      ["jlcpcb", {
        providerId: "jlcpcb", providerVersion: "1.0.0", providerKind: "manufacturer",
        regionAccountScope: [`region: ${notRead}`, `currency: ${notRead}`, "account: none: no JLCPCB account and no approved API application (OD-160)"],
        authenticationRef: "provider-registry@1.0.0#jlcpcb.credentials", licenseRef: "provider-registry@1.0.0#jlcpcb.outboundTerms",
        retentionPolicyRef: "provider-registry@1.0.0#jlcpcb.outboundTerms.retention", semanticsRef: "provider-registry@1.0.0#jlcpcb",
      }],
      ["digikey", {
        providerId: "digikey", providerVersion: "1.0.0", providerKind: "authorized_distributor",
        regionAccountScope: ["region: b19:digikey.scope.region", "currency: b19:digikey.scope.currency", "account: reads: B19's account scope; Quote and Ordering: none - they need 3-legged OAuth, and Ordering an active DigiKey Credit account, which the owner does not hold (OD-160)"],
        authenticationRef: "provider-registry@1.0.0#digikey.credentials", licenseRef: "source-registry@1.1.0#digikey.license",
        retentionPolicyRef: "provider-registry@1.0.0#digikey.outboundTerms.retention", semanticsRef: "provider-registry@1.0.0#digikey",
      }],
    ];
    for (const [id, content] of pinned) expect(toProcurementProviderDescriptor(PROVIDER_REGISTRY[id]), id).toEqual({ ...content, deterministicDigest: cd12Digest(content) });
    // the digest moves with the content it covers
    const moved = toProcurementProviderDescriptor({ ...PROVIDER_REGISTRY.jlcpcb, regionCurrency: { region: "EU", currency: "EUR" } });
    expect(moved.regionAccountScope.slice(0, 2)).toEqual(["region: EU", "currency: EUR"]);
    expect(moved.deterministicDigest).not.toBe(toProcurementProviderDescriptor(PROVIDER_REGISTRY.jlcpcb).deterministicDigest);
  });
});

describe("[B23-A1] the committed artifact is the registry", () => {
  it(`15. ${ARTIFACT} equals the render byte for byte; one row per provider, each carrying the registry version and every operation's endpoint, authentication and record source`, () => {
    expect(existsSync(join(ROOT, ARTIFACT)), "run: npx tsx scripts/generate-b23-provider-registry.ts").toBe(true);
    const csv = renderProviderRegistryCsv();
    expect(read(ARTIFACT)).toBe(csv);
    const [header, ...rows] = csv.trimEnd().split(String.fromCharCode(10));
    expect(header).toBe(PROVIDER_REGISTRY_CSV_COLUMNS.join(","));
    expect(PROVIDER_REGISTRY_CSV_COLUMNS).toEqual(expect.arrayContaining(["enabled_feature_tier", "operations", "capability_profile", "outbound_retention", "webhook_signature", "idempotency", "order_policy", "re_read_in_a1"]));
    expect(rows.map((row) => row.split(",")[1])).toEqual([...PROVIDER_IDS]);
    for (const row of rows) expect(row.startsWith(`${PROVIDER_REGISTRY_VERSION},`)).toBe(true);
    expect(csv).toContain("oshpark,");
    expect(csv).toContain("checkout=ordering/api/disabled/never-called");
    expect(csv.includes(String.fromCharCode(13))).toBe(false);
    // [B23-A1 review, 2026-10-02] the byte gate covers each operation's API surface: an endpoint, an auth scheme or a record source
    // changed in the registry changes the CSV (was: only id, tier, channel, state and the never-called mark were rendered)
    const column = (name: string): number => PROVIDER_REGISTRY_CSV_COLUMNS.indexOf(name as (typeof PROVIDER_REGISTRY_CSV_COLUMNS)[number]);
    expect(PROVIDER_REGISTRY_CSV_COLUMNS.slice(column("operations"), column("operations") + 4)).toEqual(["operations", "operation_endpoints", "operation_auth", "operation_sources"]);
    PROVIDER_ROWS.forEach((row, index) => {
      const cells = csvCells(rows[index]!);
      expect(cells.length, row.id).toBe(PROVIDER_REGISTRY_CSV_COLUMNS.length);
      expect(cells[column("operation_endpoints")], row.id).toBe(row.operations.map((entry) => `${entry.id}=${renderFact(entry.endpoint)}`).join(";"));
      expect(cells[column("operation_auth")], row.id).toBe(row.operations.map((entry) => `${entry.id}=${renderFact(entry.auth)}`).join(";"));
      expect(cells[column("operation_sources")], row.id).toBe(row.operations.map((entry) => `${entry.id}=${entry.source}`).join(";"));
    });
    for (const text of ["quote=oauth2-authorization-code", "ordering=oauth2-authorization-code", "place-order=api-key-header", "import-upload=none", "checkout=session-token", "order=api-key-query-parameter", "order-create=signed-request-partner-key", "product-information=b19:digikey.auth", "import-upload=POST https://oshpark.com/import", "order=POST /api/v{version}/order", "product-information=b19:digikey.endpoints", "cart-csv=repo:app/api/bom/cart/digikey/route.ts", "supply-search=b19-registry", "dfm-web-tool=discovery-1.2"]) {
      expect(csv, text).toContain(text);
    }
  });
});
