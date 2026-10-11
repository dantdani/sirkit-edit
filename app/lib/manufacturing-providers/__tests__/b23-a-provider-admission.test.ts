/**
 * [B23-A1] Admission per provider and per operation tier (OD-162): a pure decision over the registry and the environment it is
 * given. An enabled hand-off is admitted as a hand-off (no host, no credential, no API call); a distributor's read follows its B19
 * source's own admission (OD-33, OD-32, the blocked LCSC); every dfm_quote_transfer and every ordering operation refuses
 * `provider_not_admitted` in B23, whatever the registry or the environment says; the operator switch can only switch OFF; refusals
 * name variables, never values; and nothing outside this directory calls admission yet (no route, no tool). [B23-B1, 2026-10-03] The provider exchange route now does, through the exchange service. [B23-B3, 2026-10-04] GET /api/pcb-sync's route reads the registry through the observation reader (no admission); case 8 lists it.
 *
 * Every credential below is an obvious fake assembled at run time. Nothing is written to disk and nothing leaves the process.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_DISABLE_ENV as B19_OPERATOR_DISABLE_ENV, SOURCE_REGISTRY } from "@/app/lib/acquisition/source-registry";
import { admitProviderOperation, PROVIDER_ADMISSION_REFUSALS, PROVIDER_OPERATOR_DISABLE_ENV, structuralDelegation, type ProviderAdmission } from "../provider-admission";
import { PROVIDER_REGISTRY, PROVIDER_ROWS, tierRank, validateProviderRegistry, type ProviderId, type ProviderRow } from "../provider-registry";

const ROOT = process.cwd();
/** Every credential variable the B19 sources name (the distributor rows hold none of their own). */
const NAMES = [...new Set(Object.values(SOURCE_REGISTRY).flatMap((entry) => entry.auth.secrets.flatMap((reference) => [reference.env, ...reference.fallbacks])))].sort();
const fake = (name: string): string => ["fake", name.toLowerCase().replaceAll("_", "-"), "b23"].join("-");
const FULL_ENV: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(NAMES.map((name) => [name, fake(name)])));
const PAIRS = PROVIDER_ROWS.flatMap((row) => row.operations.map((entry) => ({ row, entry })));
const admit = (providerId: string, operationId: string, env: Readonly<Record<string, string | undefined>> = FULL_ENV, registry: readonly ProviderRow[] = PROVIDER_ROWS): ProviderAdmission =>
  admitProviderOperation(registry, providerId, operationId, env);
const refusal = (admission: ProviderAdmission): string => (admission.admitted ? "admitted" : admission.refusal);

/** The reads case 8's walk makes (the disk, or an in-memory tree that proves a read error is never swallowed). */
interface TreeReader {
  readonly exists: (path: string) => boolean;
  readonly list: (dir: string) => string[];
  readonly isDirectory: (path: string) => boolean;
  readonly read: (path: string) => string;
}
const DISK: TreeReader = { exists: existsSync, list: (dir) => readdirSync(dir), isDirectory: (path) => statSync(path).isDirectory(), read: (path) => readFileSync(path, "utf8") };
const TOP_LEVEL = ["app", "lib", "components", "scripts", "e2e"] as const;
/** Every source file under the top-level directories (outside this module's own directory) that names `manufacturing-providers`. */
function importersOf(root: string, tops: readonly string[], io: TreeReader): string[] {
  const importers: string[] = [];
  const scan = (dir: string): void => {
    for (const name of io.list(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (io.isDirectory(full)) {
        scan(full);
        continue;
      }
      if (!/\.(?:ts|tsx|mjs|js)$/.test(name)) continue;
      const path = relative(root, full).split(sep).join("/");
      if (path.startsWith("app/lib/manufacturing-providers/")) continue;
      if (io.read(full).includes("manufacturing-providers") && !B24_QUALIFICATION_ROOTS.some((root) => path.startsWith(root))) importers.push(path); // [B24-A1, 2026-10-06] reviewed move (D6), the only one: a path under a B24 root (B24_QUALIFICATION_ROOTS, at the end of this file) is read - a read error still fails the case - but never listed; every other importer still is
    }
  };
  // [B23-A1 review, 2026-10-02] only a missing top-level directory is skipped; every other read error propagates (was: a bare catch
  // around the whole walk, which ended a top-level scan at its first error and hid any importer after it)
  for (const dir of tops) {
    const top = join(root, dir);
    if (io.exists(top)) scan(top);
  }
  return importers;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[B23-A1] admission per provider and per operation tier", () => {
  it("1. every enabled hand-off is admitted as a hand-off: no host, no credential reference, no API call", () => {
    const handoffs = PAIRS.filter(({ entry }) => entry.tier === "handoff" && entry.state === "enabled");
    expect(handoffs.length).toBeGreaterThanOrEqual(11);
    for (const { row, entry } of handoffs) {
      for (const env of [{}, FULL_ENV]) {
        expect(admit(row.id, entry.id, env), `${row.id}.${entry.id}`).toEqual({ admitted: true, providerId: row.id, operationId: entry.id, tier: "handoff", via: "handoff", credentialReferences: [] });
      }
    }
  });

  it("2. every dfm_quote_transfer and every ordering operation refuses provider_not_admitted, whatever the environment holds - and even in a forged registry that enables it, as does every API operation that is not a distributor's B19 read", () => {
    const transfers = PAIRS.filter(({ entry }) => tierRank(entry.tier) >= tierRank("dfm_quote_transfer"));
    expect(transfers.length).toBeGreaterThanOrEqual(18);
    const envs = [{}, FULL_ENV, { ...FULL_ENV, [PROVIDER_OPERATOR_DISABLE_ENV]: PROVIDER_ROWS.map((row) => row.id).join(",") }];
    for (const { row, entry } of transfers) for (const env of envs) expect(refusal(admit(row.id, entry.id, env)), `${row.id}.${entry.id}`).toBe("provider_not_admitted");
    // a forged revision that enables every API operation (and every row's access) still admits no transfer, no order and no
    // manufacturer API call: the refusal is structural, not a reading of the row's state
    const forged = PROVIDER_ROWS.map((row) => ({ ...row, apiAccess: { ...row.apiAccess, status: "enabled" }, operations: row.operations.map((entry) => ({ ...entry, state: "enabled" })) })) as unknown as ProviderRow[];
    for (const { row, entry } of transfers) expect(refusal(admit(row.id, entry.id, FULL_ENV, forged)), `forged ${row.id}.${entry.id}`).toBe("provider_not_admitted");
    for (const { row, entry } of PAIRS.filter(({ entry: op }) => op.channel === "api" && op.source !== "b19-registry")) {
      expect(refusal(admit(row.id, entry.id, FULL_ENV, forged)), `forged ${row.id}.${entry.id}`).toBe("provider_not_admitted");
    }
    const message = admit("oshpark", "checkout");
    expect(message.admitted ? "" : message.message).toMatch(/not admitted/);
  });

  it("3. a distributor's read follows its B19 source: DigiKey and Nexar admitted by reference (names, never values), Mouser disabled (OD-32), LCSC blocked", () => {
    expect(admit("digikey", "product-information")).toEqual({ admitted: true, providerId: "digikey", operationId: "product-information", tier: "read_observation", via: "b19_source", credentialReferences: ["DIGIKEY_CLIENT_ID", "DIGIKEY_CLIENT_SECRET"] });
    expect(admit("nexar", "supply-search")).toEqual({ admitted: true, providerId: "nexar", operationId: "supply-search", tier: "read_observation", via: "b19_source", credentialReferences: ["OCTOPART_API_KEY"] });
    const mouser = admit("mouser", "part-number-search");
    expect(refusal(mouser)).toBe("disabled");
    expect(mouser.admitted ? "" : mouser.message).toContain("OD-32");
    expect(refusal(admit("lcsc", "product-search"))).toBe("blocked");
    expect(refusal(admit("lcsc", "check-order"))).toBe("blocked");
    const missing = admit("digikey", "product-information", { DIGIKEY_CLIENT_ID: fake("DIGIKEY_CLIENT_ID") });
    expect(refusal(missing)).toBe("credentials_missing");
    expect(missing.admitted ? "" : missing.message).toContain("DIGIKEY_CLIENT_SECRET");
    expect(JSON.stringify(missing)).not.toContain(fake("DIGIKEY_CLIENT_ID"));
  });

  it("4. the operator switch can only switch OFF: a listed provider or provider:operation refuses operator_disabled naming the variable; no value ever widens admission", () => {
    expect(PROVIDER_OPERATOR_DISABLE_ENV).toBe("SIRKIT_MANUFACTURING_DISABLED_PROVIDERS");
    const off = (value: string) => ({ ...FULL_ENV, [PROVIDER_OPERATOR_DISABLE_ENV]: value });
    const whole = admit("digikey", "product-information", off(" DigiKey , pcbway "));
    expect(refusal(whole)).toBe("operator_disabled");
    expect(whole.admitted ? "" : whole.message).toContain(PROVIDER_OPERATOR_DISABLE_ENV);
    expect(refusal(admit("digikey", "cart-csv", off("digikey")))).toBe("operator_disabled");
    expect(refusal(admit("jlcpcb", "manual-quote-upload", off("JLCPCB:manual-quote-upload")))).toBe("operator_disabled");
    expect(admit("jlcpcb", "dfm-web-tool", off("jlcpcb:manual-quote-upload")).admitted).toBe(true);
    const values = ["", " ", "*", "all", "none", "enable", "enabled", "+jlcpcb", "jlcpcb=on", "!digikey", "-digikey", "macrofab:pcb-quote=enabled", "order", "ordering", ...PROVIDER_ROWS.map((row) => row.id), ...PAIRS.map(({ row, entry }) => `${row.id}:${entry.id}`)];
    for (const { row, entry } of PAIRS) {
      const without = admit(row.id, entry.id).admitted;
      for (const value of values) {
        const withSwitch = admit(row.id, entry.id, off(value)).admitted;
        if (withSwitch) expect(without, `${row.id}.${entry.id} with ${JSON.stringify(value)}`).toBe(true);
      }
    }
    // B19's own switch still switches a delegated read off, naming B19's variable
    const b19 = admit("digikey", "product-information", { ...FULL_ENV, [B19_OPERATOR_DISABLE_ENV]: "digikey" });
    expect(refusal(b19)).toBe("operator_disabled");
    expect(b19.admitted ? "" : b19.message).toContain(B19_OPERATOR_DISABLE_ENV);
  });

  it("5. blocked and disabled operations refuse with their own state, reason and owner decision; an unknown provider or operation refuses; the refusal vocabulary is closed", () => {
    expect([...PROVIDER_ADMISSION_REFUSALS]).toEqual(["unknown_provider", "unknown_operation", "provider_not_admitted", "operator_disabled", "blocked", "disabled", "credentials_missing"]);
    const blocked = admit("pcbway", "query-order-process");
    expect(refusal(blocked)).toBe("blocked");
    expect(blocked.admitted ? "" : blocked.message).toContain("OD-162");
    expect(refusal(admit("macrofab", "order-read"))).toBe("disabled");
    expect(refusal(admit("boardhouse", "quote"))).toBe("unknown_provider");
    expect(refusal(admit("jlcpcb", "teleport"))).toBe("unknown_operation");
    const outcomes = new Set(PAIRS.map(({ row, entry }) => refusal(admit(row.id, entry.id))));
    expect([...outcomes].sort()).toEqual(["admitted", "blocked", "disabled", "provider_not_admitted"]);
  });

  it("6. refusals name variables, never values: no admission, admitted or refused, carries any environment value", () => {
    const envs = [FULL_ENV, { ...FULL_ENV, [PROVIDER_OPERATOR_DISABLE_ENV]: "digikey,nexar" }, { [NAMES[0]!]: fake(NAMES[0]!) }, { ...FULL_ENV, [B19_OPERATOR_DISABLE_ENV]: "octopart" }];
    const values = Object.values(FULL_ENV);
    let checked = 0;
    for (const env of envs) {
      for (const { row, entry } of PAIRS) {
        const text = JSON.stringify(admit(row.id, entry.id, env));
        for (const value of values) expect(text, `${row.id}.${entry.id}`).not.toContain(value);
        checked += 1;
      }
    }
    expect(checked).toBe(envs.length * PAIRS.length);
  });

  it("7. admission is pure: it reads only the environment it is given, never process.env", () => {
    for (const name of NAMES) vi.stubEnv(name, fake(name));
    expect(refusal(admit("digikey", "product-information", {}))).toBe("credentials_missing");
    expect(refusal(admit("nexar", "supply-search", {}))).toBe("credentials_missing");
    vi.stubEnv(PROVIDER_OPERATOR_DISABLE_ENV, "jlcpcb");
    expect(admit("jlcpcb", "manual-quote-upload", {}).admitted).toBe(true);
  });

  it("8. outside its directory exactly five source files under app, lib, components, scripts and e2e name the provider directory - the provider exchange route, GET /api/pcb-sync's handler.ts, manufacturing-summary.ts and route.ts, and the CSV generator, whose text names neither admission nor the CD-12 projection; a read error anywhere in the walk fails the case instead of ending it early", () => { // [B23 closeout, 2026-10-05] retitled (B23-B1, B23-B3): the old title named one reader of the registry where the body pins five files; assertions unchanged
    expect(importersOf(ROOT, TOP_LEVEL, DISK)).toEqual(["app/api/pcb/provider-exchange/route.ts", "app/api/pcb-sync/handler.ts", "app/api/pcb-sync/manufacturing-summary.ts", "app/api/pcb-sync/route.ts", "scripts/generate-b23-provider-registry.ts"]); // [B23-B1, 2026-10-03] reviewed pin move: + the provider exchange route, which reaches admission only through the exchange service (b23-b-exchange-route case 4 pins its closure) [B23-B3, 2026-10-04] reviewed pin move: + GET /api/pcb-sync's three files - handler.ts and manufacturing-summary.ts name the observation module in type-only imports (erased; they call nothing of it), and route.ts composes the observation reader, which reads the registry for a provider's name, terms and row digest and never calls admission (b23-b-no-auto-accept case 3 pins its imports)
    // [B23-A1 review, 2026-10-02] the walk skips only a top-level directory that does not exist; any other error (a dangling link, a
    // locked file) propagates, so it can never hide an importer listed after the failing entry
    const tree = new Map<string, string | Error | null>([
      [join("R", "app"), null],
      [join("R", "app", "a-locked.ts"), Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" })],
      [join("R", "app", "b-route.ts"), `import { admitProviderOperation } from "@/app/lib/manufacturing-providers/provider-admission";`],
      [join("R", "scripts"), null],
    ]);
    const fake: TreeReader = {
      exists: (path) => tree.has(path),
      list: (dir) => {
        if (tree.get(dir) !== null) throw Object.assign(new Error(`ENOENT: no such directory, scandir '${dir}'`), { code: "ENOENT" });
        return [...tree.keys()].filter((path) => path.startsWith(`${dir}${sep}`) && !path.slice(dir.length + 1).includes(sep)).map((path) => path.slice(dir.length + 1)).sort();
      },
      isDirectory: (path) => tree.get(path) === null,
      read: (path) => {
        const value = tree.get(path);
        if (value instanceof Error) throw value;
        return String(value);
      },
    };
    expect(() => importersOf("R", ["app", "scripts", "e2e"], fake)).toThrow(/EBUSY/);
    tree.delete(join("R", "app", "a-locked.ts"));
    expect(importersOf("R", ["app", "scripts", "e2e"], fake)).toEqual(["app/b-route.ts"]);
    const generator = readFileSync(join(ROOT, "scripts/generate-b23-provider-registry.ts"), "utf8");
    expect(generator).not.toContain("provider-admission");
    expect(generator).not.toContain("cd12-projection");
  });

  it("9. the admission answers every pair of the registry exactly as the tier rules say", () => {
    const expected = ({ row, entry }: (typeof PAIRS)[number]): string => {
      if (tierRank(entry.tier) >= tierRank("dfm_quote_transfer")) return "provider_not_admitted";
      if (entry.state !== "enabled") return entry.state;
      if (entry.channel === "api" && (row.b19Source === null || entry.source !== "b19-registry")) return "provider_not_admitted";
      return "admitted";
    };
    for (const pair of PAIRS) expect(refusal(admit(pair.row.id, pair.entry.id)), `${pair.row.id}.${pair.entry.id}`).toBe(expected(pair));
    const euro: ProviderId = "eurocircuits";
    expect(PROVIDER_REGISTRY[euro].operations.map((entry) => refusal(admit(euro, entry.id)))).toEqual(["admitted"]);
  });

  it("10. a forged revision that relabels an operation's tier or channel, not only its state, still admits no API call: no API operation is admitted as a hand-off, a relabelled hand-off or B19 read refuses, and a fully valid revision that enables a manufacturer's read refuses", () => {
    // [B23-A1 review, 2026-10-02] case 2's forgery changed only states; these change what the operation claims to be
    const forge = (providerId: string, operationId: string, change: Readonly<Record<string, unknown>>): ProviderRow[] =>
      PROVIDER_ROWS.map((row) => (row.id !== providerId ? row : ({ ...row, operations: row.operations.map((entry) => (entry.id === operationId ? { ...entry, ...change } : entry)) } as unknown as ProviderRow)));
    const apiOperations = PAIRS.filter(({ entry }) => entry.channel === "api");
    expect(apiOperations.length).toBeGreaterThanOrEqual(26);
    let forgeries = 0;
    for (const { row, entry } of apiOperations) {
      // an API call relabelled a hand-off with its channel kept, and relabelled a manual upload with its auth and endpoint kept
      for (const change of [{ tier: "handoff", state: "enabled" }, { tier: "handoff", channel: "manual_upload", state: "enabled" }]) {
        expect(refusal(admit(row.id, entry.id, FULL_ENV, forge(row.id, entry.id, change))), `${row.id}.${entry.id} ${JSON.stringify(change)}`).toBe("provider_not_admitted");
        forgeries += 1;
      }
      if (entry.source === "b19-registry") continue;
      expect(refusal(admit(row.id, entry.id, FULL_ENV, forge(row.id, entry.id, { tier: "read_observation", state: "enabled" }))), `${row.id}.${entry.id} as an enabled read`).toBe("provider_not_admitted");
      forgeries += 1;
    }
    // a hand-off relabelled an API call; a distributor's B19 read relabelled a deep link
    for (const { row, entry } of PAIRS.filter(({ entry: op }) => op.tier === "handoff")) {
      expect(refusal(admit(row.id, entry.id, FULL_ENV, forge(row.id, entry.id, { channel: "api" }))), `${row.id}.${entry.id} as an API call`).toBe("provider_not_admitted");
      forgeries += 1;
    }
    for (const { row, entry } of PAIRS.filter(({ entry: op }) => op.source === "b19-registry")) {
      expect(refusal(admit(row.id, entry.id, FULL_ENV, forge(row.id, entry.id, { channel: "deep_link", state: "enabled" }))), `${row.id}.${entry.id} as a deep link`).toBe("provider_not_admitted");
      forgeries += 1;
    }
    expect(forgeries).toBeGreaterThanOrEqual(2 * 26 + 22 + 11 + 4);
    // a revision every validator rule accepts, enabling MacroFab's order read on a declared host: still no provider API call in B23
    const valid = PROVIDER_ROWS.map((row) =>
      row.id !== "macrofab"
        ? row
        : ({ ...row, endpoint: { ...row.endpoint, hosts: ["api.macrofab.com"], documentedHosts: [] }, apiAccess: { ...row.apiAccess, status: "enabled" }, enabledFeatureTier: "read_observation", operations: row.operations.map((entry) => (entry.id === "order-read" ? { ...entry, state: "enabled" } : entry)) } as unknown as ProviderRow),
    );
    expect(validateProviderRegistry(valid)).toEqual([]);
    expect(refusal(admit("macrofab", "order-read", FULL_ENV, valid))).toBe("provider_not_admitted");
  });

  it("11. [B23-A1 lead, 2026-10-02] the structural layer bites on its own, before any validator: structuralDelegation refuses a hand-off that is an API call or carries a credential, an API operation relabelled a hand-off, and a read that is not a distributor's B19 read at read_observation, while every hand-off and B19 read of the registry passes it as itself", () => {
    type Operation = ProviderRow["operations"][number];
    const relabel = (entry: Operation, change: Readonly<Record<string, unknown>>): Operation => ({ ...entry, ...change }) as unknown as Operation;
    const credentialed = PAIRS.find(({ entry }) => entry.auth !== "none")!.entry.auth;
    const notB19 = PAIRS.find(({ entry }) => entry.source !== "b19-registry")!.entry.source;
    let handoffs = 0;
    let reads = 0;
    let refused = 0;
    for (const { row, entry } of PAIRS) {
      if (entry.tier === "handoff") {
        expect(structuralDelegation(row, entry), `${row.id}.${entry.id}`).toBe("handoff");
        handoffs += 1;
        for (const change of [{ channel: "api" }, { auth: credentialed }]) {
          expect(structuralDelegation(row, relabel(entry, change)), `${row.id}.${entry.id} ${JSON.stringify(change)}`).toBe("refuse");
          refused += 1;
        }
      } else if (entry.source === "b19-registry" && entry.channel === "api" && entry.tier === "read_observation") {
        expect(structuralDelegation(row, entry), `${row.id}.${entry.id}`).toBe("b19_source");
        reads += 1;
        for (const forged of [
          { row, entry: relabel(entry, { channel: "deep_link" }) },
          { row, entry: relabel(entry, { source: notB19 }) },
          { row, entry: relabel(entry, { tier: "dfm_quote_transfer" }) },
          { row: { ...row, b19Source: null } as unknown as ProviderRow, entry },
        ]) {
          expect(structuralDelegation(forged.row, forged.entry), `${row.id}.${entry.id} forged`).toBe("refuse");
          refused += 1;
        }
      } else {
        expect(structuralDelegation(row, entry), `${row.id}.${entry.id}`).toBe("refuse");
        if (entry.channel === "api") {
          expect(structuralDelegation(row, relabel(entry, { tier: "handoff" })), `${row.id}.${entry.id} as a hand-off`).toBe("refuse");
          refused += 1;
        }
      }
    }
    expect(handoffs).toBeGreaterThan(0);
    expect(reads).toBeGreaterThan(0);
    expect(refused).toBeGreaterThanOrEqual(2 * handoffs + 4 * reads);
  });
});

/** [B24-A1, 2026-10-06] D6: the B24 roots case 8 admits as a class, by prefix, never by file - the deployment configuration and flag
 *  inventory (app/lib/deployment/), the golden evaluation catalog (app/lib/evaluation/, B24-B1), the B24 suites
 *  (app/lib/qualification/) and the observability records (app/lib/observability/, B24-C1/C3). A root with no file admits nothing.
 *  A file outside these roots that names the provider directory is still listed, and fails the case until a reviewed move. */
const B24_QUALIFICATION_ROOTS: readonly string[] = ["app/lib/deployment/", "app/lib/evaluation/", "app/lib/qualification/", "app/lib/observability/"];
