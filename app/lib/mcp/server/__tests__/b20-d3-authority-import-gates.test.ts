/**
 * [B20 D3] The authority import gate, ASYMMETRIC and honest about what is new (OD-105).
 *
 * The recorded B20-D3 plan (`discovery.md` §7) says MCP modules must never import "grant mint/consume/settle,
 * reauthorization, approval controllers, manufacturing release". Three of those four are already on B2's J2 gate for the
 * SERVER half, whose entry filter is byte-for-byte this gate's `SERVER_HALF`. So:
 *
 *  - on the SERVER half this gate asserts the APPROVAL-CONTROLLER family ONLY, and a case asserts D3's own source does not
 *    restate grants, reauthorization or fabrication there;
 *  - on the CLIENT half — a DERIVED prefix over `app/lib/mcp/**` minus `server/`, plus the agent's external-read boundary
 *    and the chat composition root — it asserts all four families, because A4 case 11 walks only TWO NAMED entry files, so
 *    a third client module joins no gate today. The derived set is the new property.
 *
 * The approval family is matched BY PREFIX, never by an exact list: three `-idb` journals exist that an exact list of six
 * would let straight through B2's extension-stripped exact match.
 *
 * The fab-preset exemption (`app/lib/pcb/fab/presets/index.ts`) holds for the SERVER half only — the readiness read
 * consumes a preset — and is refused for the client half.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, opaqueModuleLoads } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { anchorOccurrences, pageCitations } from "./_citations";
import { importClosure } from "./_import-closure";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const production = collectProductionFiles(ROOT);
const PAGE = "artifacts/ai-control-plane-b20/mcp-adversarial.md";
const SELF = "app/lib/mcp/server/__tests__/b20-d3-authority-import-gates.test.ts";

/** byte-for-byte B2's `MCP_SERVER_SIDE` (FACT 35: the duplication is DECLARED, not hidden — G-D1 asserts the equality) */
const SERVER_HALF = (path: string): boolean => path.startsWith("app/lib/mcp/server/") || path.startsWith("app/api/mcp/") || path.startsWith("app/.well-known/");
/** the derived client half: the MCP client tree, the agent's external-read boundary and the chat composition root */
const CLIENT_HALF = (path: string): boolean =>
  (path.startsWith("app/lib/mcp/") && !path.startsWith("app/lib/mcp/server/"))
  || path === "app/lib/agent/mcp-observation-reads.ts"
  || path === "app/api/chat/mcp-observation-runtime.ts";

const EXTENSION = /\.[cm]?[jt]sx?$/;
/**
 * [B20 D review] security-7: every family is matched by PREFIX, for the reason the header gives for the approval family —
 * an exact list is complete only today. GRANTS is the whole `execution-grant` tree (a new module there joins the gate the
 * day it is written); REAUTH is the reauthorization module by name prefix. G-D1 pins what each prefix resolves to now, so
 * a new member is visible there rather than silently covered.
 */
const GRANTS_PREFIX = "app/lib/execution-grant/";
const REAUTH_PREFIX = "app/lib/project/membership-reauthorization";
/** the members the prefixes resolve to as of this base (the recorded plan names mint/consume/settle; the tree holds five) */
const GRANTS_TODAY = ["app/lib/execution-grant/consume.ts", "app/lib/execution-grant/mint.ts", "app/lib/execution-grant/route-contract.ts", "app/lib/execution-grant/settle.ts", "app/lib/execution-grant/store.ts"];
const REAUTH_TODAY = ["app/lib/project/membership-reauthorization.ts"];
/** FACT 34: NINE files, matched by PREFIX — an exact list of six lets three `-idb` journals through */
const APPROVAL_PREFIXES = ["app/lib/engineering/approved-", "app/lib/engineering/agent-execution-journal"];
const RELEASE_PREFIX = "app/lib/pcb/fab/";
const FAB_DATA = new Set(["app/lib/pcb/fab/presets/index.ts"]);

type Family = "GRANTS" | "REAUTH" | "APPROVALS" | "RELEASE";
const isApproval = (path: string): boolean => APPROVAL_PREFIXES.some((prefix) => path.startsWith(prefix));
const isGrant = (path: string): boolean => path.startsWith(GRANTS_PREFIX) && !path.includes("/__tests__/");
const isReauth = (path: string): boolean => path.startsWith(REAUTH_PREFIX);
function familyOf(path: string, fabExempt: boolean): Family | null {
  if (isGrant(path)) return "GRANTS";
  if (isReauth(path)) return "REAUTH";
  if (isApproval(path)) return "APPROVALS";
  if (path.startsWith(RELEASE_PREFIX) && !(fabExempt && FAB_DATA.has(path))) return "RELEASE";
  return null;
}
/** Every closure member of one of `families`, as the chain that reaches it. */
function reached(closure: ReadonlyMap<string, readonly string[]>, families: readonly Family[], fabExempt: boolean): string[] {
  const wanted = new Set<Family>(families);
  return [...closure]
    .filter(([file]) => { const family = familyOf(file, fabExempt); return family !== null && wanted.has(family); })
    .map(([, chain]) => chain.join(" -> "));
}

const entriesOf = (predicate: (path: string) => boolean): string[] => [...production.keys()].filter(predicate).sort();

describe("[B20 D3] the authority import gate", () => {
  it("G-D1. the entry sets are DERIVED and non-empty: SERVER_HALF equals B2's MCP_SERVER_SIDE applied to production (so the duplication is declared, not hidden), CLIENT_HALF is a strict superset of A4 case 11's two named entry files, and the approval family really does hold nine files", () => {
    const serverHalf = entriesOf(SERVER_HALF);
    const clientHalf = entriesOf(CLIENT_HALF);
    expect(serverHalf.length).toBeGreaterThanOrEqual(5);
    expect(clientHalf.length).toBeGreaterThanOrEqual(10);
    expect(serverHalf).toEqual(expect.arrayContaining(["app/api/mcp/route.ts", "app/api/mcp/token/route.ts", "app/.well-known/oauth-protected-resource/api/mcp/route.ts", "app/lib/mcp/server/dispatch.ts", "app/lib/mcp/server/read-call.ts"]));
    expect(clientHalf).toEqual(expect.arrayContaining(["app/lib/mcp/agent-port.ts", "app/lib/mcp/observation.ts", "app/lib/mcp/http-transport.ts", "app/lib/mcp/authorization.ts", "app/lib/mcp/oauth-discovery.ts", "app/lib/agent/mcp-observation-reads.ts", "app/api/chat/mcp-observation-runtime.ts"]));
    // the two halves are disjoint, and together they hold every MCP module
    expect(serverHalf.filter((path) => CLIENT_HALF(path))).toEqual([]);
    expect([...production.keys()].filter((path) => path.startsWith("app/lib/mcp/") && !SERVER_HALF(path) && !CLIENT_HALF(path))).toEqual([]);

    // the declared duplication: B2's own filter, read from its source, selects exactly this server half
    const b2 = read("app/lib/mcp/server/__tests__/b20-b2-import-gates.test.ts");
    expect(b2).toContain('const MCP_SERVER_SIDE = (path: string): boolean => path.startsWith("app/lib/mcp/server/") || path.startsWith("app/api/mcp/") || path.startsWith("app/.well-known/");');
    expect(read(SELF)).toContain('const SERVER_HALF = (path: string): boolean => path.startsWith("app/lib/mcp/server/") || path.startsWith("app/api/mcp/") || path.startsWith("app/.well-known/");');

    // A4 case 11 walks TWO named entry files; the client half is a STRICT superset, which is what makes it a new property
    const a4Entries = ["app/lib/mcp/agent-port.ts", "app/lib/mcp/observation.ts"];
    for (const entry of a4Entries) expect(clientHalf, entry).toContain(entry);
    expect(clientHalf.length).toBeGreaterThan(a4Entries.length);
    expect(read("app/lib/mcp/__tests__/b20-a4-agent-read-port.test.ts")).toContain('importClosure(production, ["app/lib/mcp/agent-port.ts", "app/lib/mcp/observation.ts"])');

    // the GRANTS and REAUTH prefixes resolve to exactly the members recorded above: a module added under either prefix
    // joins the gate at once AND fails this pin, so its arrival is a deliberate edit here, never silent coverage
    expect([...production.keys()].filter(isGrant).sort()).toEqual(GRANTS_TODAY);
    expect([...production.keys()].filter(isReauth).sort()).toEqual(REAUTH_TODAY);
    for (const named of ["mint", "consume", "settle"]) expect(GRANTS_TODAY, named).toContain(`app/lib/execution-grant/${named}.ts`); // the recorded plan's three

    // FACT 34: the approval family, by prefix, is nine files
    const approvals = [...production.keys()].filter(isApproval).sort();
    expect(approvals).toEqual([
      "app/lib/engineering/agent-execution-journal-idb.ts",
      "app/lib/engineering/agent-execution-journal.ts",
      "app/lib/engineering/approved-agent-mutations.ts",
      "app/lib/engineering/approved-mutation-journal-idb.ts",
      "app/lib/engineering/approved-mutation-journal.ts",
      "app/lib/engineering/approved-pcb-mutation-journal-idb.ts",
      "app/lib/engineering/approved-pcb-mutation-journal.ts",
      "app/lib/engineering/approved-pcb-mutations.ts",
      "app/lib/engineering/approved-replacement-mutations.ts",
    ]);
    expect(approvals.filter((path) => path.endsWith("-idb.ts"))).toHaveLength(3);
  });

  it("G-D2. neither half reaches an approval controller, and the client half reaches none of the four families — the fab exemption applies to the server walk only", { timeout: 180_000 }, () => {
    const serverClosure = importClosure(production, entriesOf(SERVER_HALF));
    const clientClosure = importClosure(production, entriesOf(CLIENT_HALF));
    expect(serverClosure.size).toBeGreaterThan(20);
    expect(clientClosure.size).toBeGreaterThan(10);

    // the SERVER half: the approval family ONLY (grants, reauthorization and fabrication there are J2's)
    expect(reached(serverClosure, ["APPROVALS"], true)).toEqual([]);
    // the CLIENT half: all four families, and the fab PRESET data is forbidden here too
    expect(reached(clientClosure, ["GRANTS", "REAUTH", "APPROVALS", "RELEASE"], false)).toEqual([]);

    // neither walk is vacuous: each closure really does hold the modules its half is built from
    expect(serverClosure.has("app/lib/mcp/server/dispatch.ts")).toBe(true);
    expect(clientClosure.has("app/lib/mcp/http-transport.ts")).toBe(true);
    expect(clientClosure.has("app/lib/net/outbound-fetch.ts")).toBe(true);
  });

  it("G-D3. negative tripwires, each caught with its chain: a client and a server module importing an approval controller, all THREE -idb journals (an exact list of six would miss them), the REAL external-read boundary importing a grant and the REAL chat runtime importing reauthorization (walked from the derived entry set, so the entry rule itself is exercised), a client module importing a grant module that does not exist today (caught by the prefix, missed by an exact list), a client module importing the fab PRESET data (caught on the client half, not on the server half), a two-hop bridge, a re-export, a dynamic import, a bare side-effect import and a case-variant specifier — and a TYPE-ONLY import is not caught", { timeout: 180_000 }, () => {
    const injected = new Map(production);
    // [B20 D review] coverage-12: the two exact-path client entries are probed IN PLACE — their real source with one
    // forbidden import appended — and the walk starts from `entriesOf(CLIENT_HALF)` over the injected map, so the entry
    // rule selects them; a probe under an invented path would bypass that rule.
    injected.set("app/lib/agent/mcp-observation-reads.ts", `${production.get("app/lib/agent/mcp-observation-reads.ts")!}\nimport * as settleProbe from "../execution-grant/settle";\nexport const d3Probe = settleProbe;\n`);
    injected.set("app/api/chat/mcp-observation-runtime.ts", `${production.get("app/api/chat/mcp-observation-runtime.ts")!}\nimport * as reauthProbe from "@/app/lib/project/membership-reauthorization";\nexport const d3Probe = reauthProbe;\n`);
    // [B20 D review] security-7: a grant module that does NOT exist today, matched by the prefix
    injected.set("app/lib/execution-grant/authorize.ts", 'export const authorize = (): string => "d3-probe";');
    injected.set("app/lib/mcp/evil-grant-new.ts", 'import { authorize } from "../execution-grant/authorize";\nexport const x = authorize;');
    injected.set("app/lib/mcp/evil-approval.ts", 'import { approvedPcbMutations } from "../engineering/approved-pcb-mutations";\nexport const x = approvedPcbMutations;');
    injected.set("app/lib/mcp/server/evil-approval.ts", 'import { approvedAgentMutations } from "../../engineering/approved-agent-mutations";\nexport const x = approvedAgentMutations;');
    injected.set("app/lib/mcp/evil-idb-a.ts", 'import * as journal from "../engineering/approved-mutation-journal-idb";\nexport const x = journal;');
    injected.set("app/lib/mcp/server/evil-idb-b.ts", 'import * as journal from "../../engineering/approved-pcb-mutation-journal-idb";\nexport const x = journal;');
    injected.set("app/lib/mcp/evil-idb-c.ts", 'import * as journal from "../engineering/agent-execution-journal-idb";\nexport const x = journal;');
    injected.set("app/lib/agent/evil-reads.ts", 'import * as settle from "../execution-grant/settle";\nexport const x = settle;');
    injected.set("app/api/chat/evil-runtime.ts", 'import * as reauth from "@/app/lib/project/membership-reauthorization";\nexport const x = reauth;');
    injected.set("app/lib/mcp/evil-preset.ts", 'import * as presets from "../pcb/fab/presets";\nexport const x = presets;');
    injected.set("app/lib/mcp/evil-hop.ts", 'import { bridge } from "./evil-bridge-d3-fixture";\nexport const x = bridge;');
    injected.set("app/lib/mcp/evil-bridge-d3-fixture.ts", 'export * from "../engineering/approved-replacement-mutations";');
    injected.set("app/lib/mcp/evil-dynamic.ts", 'export const load = () => import("../engineering/approved-mutation-journal");');
    injected.set("app/lib/mcp/evil-side-effect.ts", 'import "@/app/lib/engineering/approved-agent-mutations";');
    injected.set("app/lib/mcp/evil-case.ts", 'import * as approvals from "../engineering/Approved-Pcb-Mutations";\nexport const x = approvals;');
    injected.set("app/lib/mcp/types-only.ts", 'import type { ApprovedPcbMutation } from "../engineering/approved-pcb-mutations";\nexport type T = ApprovedPcbMutation;');

    const caught = (entry: string, families: readonly Family[], fabExempt: boolean): string[] => reached(importClosure(injected, [entry]), families, fabExempt);
    const ALL: readonly Family[] = ["GRANTS", "REAUTH", "APPROVALS", "RELEASE"];
    expect(caught("app/lib/mcp/evil-approval.ts", ALL, false)[0]).toBe("app/lib/mcp/evil-approval.ts -> app/lib/engineering/approved-pcb-mutations.ts");
    expect(caught("app/lib/mcp/server/evil-approval.ts", ["APPROVALS"], true)[0]).toBe("app/lib/mcp/server/evil-approval.ts -> app/lib/engineering/approved-agent-mutations.ts");
    expect(caught("app/lib/mcp/evil-idb-a.ts", ["APPROVALS"], false)[0]).toBe("app/lib/mcp/evil-idb-a.ts -> app/lib/engineering/approved-mutation-journal-idb.ts");
    expect(caught("app/lib/mcp/server/evil-idb-b.ts", ["APPROVALS"], true)[0]).toBe("app/lib/mcp/server/evil-idb-b.ts -> app/lib/engineering/approved-pcb-mutation-journal-idb.ts");
    expect(caught("app/lib/mcp/evil-idb-c.ts", ["APPROVALS"], false)[0]).toBe("app/lib/mcp/evil-idb-c.ts -> app/lib/engineering/agent-execution-journal-idb.ts");
    // the two REAL entries, reached through the derived entry set (the walk starts from every CLIENT_HALF file of the
    // production tree, over the injected map in which those two files carry the probe import)
    const fromEntries = reached(importClosure(injected, entriesOf(CLIENT_HALF)), ALL, false);
    expect(fromEntries).toContain("app/lib/agent/mcp-observation-reads.ts -> app/lib/execution-grant/settle.ts");
    expect(fromEntries).toContain("app/api/chat/mcp-observation-runtime.ts -> app/lib/project/membership-reauthorization.ts");
    // the invented probe files under those paths (kept as a second reading: the direct walk of one file)
    expect(caught("app/lib/agent/evil-reads.ts", ALL, false)[0]).toBe("app/lib/agent/evil-reads.ts -> app/lib/execution-grant/settle.ts");
    expect(caught("app/api/chat/evil-runtime.ts", ALL, false)[0]).toBe("app/api/chat/evil-runtime.ts -> app/lib/project/membership-reauthorization.ts");
    // a grant module that does not exist today: the prefix catches it; the old exact list of five would have answered null
    expect(caught("app/lib/mcp/evil-grant-new.ts", ["GRANTS"], false)[0]).toBe("app/lib/mcp/evil-grant-new.ts -> app/lib/execution-grant/authorize.ts");
    expect(GRANTS_TODAY.includes("app/lib/execution-grant/authorize.ts")).toBe(false);
    // the split fab exemption, BOTH directions, in one case
    expect(caught("app/lib/mcp/evil-preset.ts", ["RELEASE"], false)[0]).toBe("app/lib/mcp/evil-preset.ts -> app/lib/pcb/fab/presets/index.ts");
    expect(caught("app/lib/mcp/evil-preset.ts", ["RELEASE"], true)).toEqual([]);
    expect(caught("app/lib/mcp/evil-hop.ts", ["APPROVALS"], false)[0]).toBe("app/lib/mcp/evil-hop.ts -> app/lib/mcp/evil-bridge-d3-fixture.ts -> app/lib/engineering/approved-replacement-mutations.ts");
    expect(caught("app/lib/mcp/evil-dynamic.ts", ["APPROVALS"], false)[0]).toBe("app/lib/mcp/evil-dynamic.ts -> app/lib/engineering/approved-mutation-journal.ts");
    expect(caught("app/lib/mcp/evil-side-effect.ts", ["APPROVALS"], false)[0]).toBe("app/lib/mcp/evil-side-effect.ts -> app/lib/engineering/approved-agent-mutations.ts");
    expect(caught("app/lib/mcp/evil-case.ts", ["APPROVALS"], false)[0]).toBe("app/lib/mcp/evil-case.ts -> app/lib/engineering/approved-pcb-mutations.ts");
    // a type-only import is erased at run time and is deliberately NOT caught
    expect(caught("app/lib/mcp/types-only.ts", ALL, false)).toEqual([]);
  });

  it("G-D4. the composition claim, checked by FAMILY and by D3's own source text: grants, reauthorization and fabrication DO occur in B2's list, and D3's own source makes no server-half assertion over those three; D3 asserts nothing the other gates assert; and the approval family's absence from the other gates is RECORDED for this base, never asserted — so B2, B3, B4 or A4 may add the family later without D3 refusing the strengthening", () => {
    const gates = {
      b2: read("app/lib/mcp/server/__tests__/b20-b2-import-gates.test.ts"),
      b3: read("app/lib/mcp/server/__tests__/b20-b3-import-gates.test.ts"),
      b4: read("app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts"),
      a4: read("app/lib/mcp/__tests__/b20-a4-agent-read-port.test.ts"),
    };
    const approvals = [...production.keys()].filter(isApproval).map((path) => path.replace(EXTENSION, ""));
    expect(approvals.length).toBe(9);
    // [B20 D review] regressions-5: "no other gate names the family" was a SNAPSHOT of base 6e3efa7 (true then: zero
    // occurrences in all four gates). Asserting it would forbid B2's FORBIDDEN list from ever growing an approval name —
    // a strictly stronger gate — so it is recorded on the page (§D3.1) and deliberately NOT asserted here.
    // the three families that ARE B2's, on the server half: named in B2's own list (this is the positive composition claim)
    for (const family of GRANTS_TODAY.map((path) => path.replace(EXTENSION, ""))) expect(gates.b2, family).toContain(family);
    for (const family of REAUTH_TODAY.map((path) => path.replace(EXTENSION, ""))) expect(gates.b2, family).toContain(family);
    expect(gates.b2).toContain('const FAB_PREFIX = "app/lib/pcb/fab/";');
    // [B20 D review] coverage-13: the committed J2 case this gate composes over on the server half, bound by TITLE (DEC-2)
    expect(gates.b2).toContain("2. the server modules, /api/mcp and app/.well-known reach no forbidden module and nothing under pcb/fab but its static preset data through their whole runtime import closure, and import no server auth module directly");

    // D3's own source: EVERY server-half walk in this file names one family list, and that list is APPROVALS alone.
    // Read by pattern rather than by a literal, so the assertion cannot defeat itself by containing what it forbids.
    const self = read(SELF);
    const serverWalks = [...self.matchAll(/reached\(serverClosure, ([^)]*)\)/g)].map((match) => match[1]!.trim());
    expect(serverWalks.length).toBeGreaterThan(0);
    expect(new Set(serverWalks)).toEqual(new Set([`[${JSON.stringify("APPROVALS")}], true`]));
    // and D3 restates none of the other gates' subjects: B3 G7's durable writers, B3 G1's read-service bridge, B2's
    // direct-only auth modules, B2 case 3's B11 token tripwire and B4's process gate. Each subject is ASSEMBLED from
    // parts, so the identifier never occurs literally in this file and the check cannot defeat itself.
    // (the server-half filter is DECLARED duplication, asserted in G-D1, so it is not on this list)
    const subjects = [
      ["DURABLE", "WRITERS"].join("_"),
      ["tool", "invocation"].join("-"),
      ["readOnly", "DurableWorkflow"].join(""),
      ["worker", "principal"].join("-"),
      ["supabase", "server"].join("-"),
      ["modelcontext", "protocol"].join(""),
      ["node:worker", "threads"].join("_"),
    ];
    for (const identifier of subjects) expect(self.includes(identifier), identifier).toBe(false);
  });

  it("G-D5. no opaque module load, as a COMPUTED set difference: the client half minus (B2 case 4's scope union B3 case 6's scope) is non-empty before it is asserted empty of opaque loads, so this case can never go vacuous", { timeout: 180_000 }, () => {
    // the two existing scopes, as their own sources write them (FACT 37)
    const b2Scope = (path: string): boolean => SERVER_HALF(path) || path === "app/lib/auth/mcp-bearer.ts" || path === "app/lib/auth/route-tree.ts";
    const b3Scope = (path: string): boolean => ["app/lib/engineering/durable-read-bundle.ts", "app/api/mcp/read-runtime.ts", "app/api/mcp/route.ts"].includes(path) || path.startsWith("app/lib/mcp/server/");
    const difference = new Map([...production].filter(([path]) => CLIENT_HALF(path) && !b2Scope(path) && !b3Scope(path)));
    expect(difference.size).toBeGreaterThanOrEqual(10);
    expect([...difference.keys()]).toEqual(expect.arrayContaining(["app/lib/mcp/agent-port.ts", "app/lib/mcp/observation.ts", "app/lib/agent/mcp-observation-reads.ts", "app/api/chat/mcp-observation-runtime.ts"]));
    expect(opaqueModuleLoads(difference)).toEqual([]);

    // the scopes really are the ones the two suites write (a retitle or a widening there is visible here)
    expect(read("app/lib/mcp/server/__tests__/b20-b2-import-gates.test.ts")).toContain('MCP_SERVER_SIDE(path) || path === "app/lib/auth/mcp-bearer.ts" || path === "app/lib/auth/route-tree.ts"');
    expect(read("app/lib/mcp/server/__tests__/b20-b3-import-gates.test.ts")).toContain('["app/lib/engineering/durable-read-bundle.ts", "app/api/mcp/read-runtime.ts", "app/api/mcp/route.ts"].includes(path) || path.startsWith("app/lib/mcp/server/")');
  });

  it("G-D6. the page's D3.1 section states the entry rule, the four families, the asymmetric assertion, the split fab exemption and exactly how this gate composes with J2, G1/G5/G7 and A4 case 11", () => {
    const page = read(PAGE);
    expect(page).toMatch(/^### D3\.1 /m);
    for (const claim of ["SERVER_HALF", "CLIENT_HALF", "APPROVALS", "by prefix", "fab-preset exemption", "J2", "A4 case 11"]) {
      expect(page, claim).toContain(claim);
    }
    const suite = SELF;
    const cases = (read(suite).match(/^\s*it\(/gm) ?? []).length;
    expect(page).toContain(`| \`${suite}\` | ${cases} |`);
  });

  it("G-D7. the WHOLE page: every citation resolves exactly once, every suite it names exists with the case count it states, the D1, D2 and D3 sections are all present, and it names D20-23 (under OD-51), D20-28, UNKNOWN 3 and U1/U2 with their closures and what stays open", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(15);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_value, index) => `C${index + 1}`));
    expect(citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`)).toEqual([]);

    // every suite row on the page: the file exists and the stated count is its real `it(` count
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \|/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const row of rows) {
      // a vitest suite declares cases with `it(`, a Playwright spec with `test(`
      const pattern = row[1]!.endsWith(".spec.ts") ? /^\s*test\(/gm : /^\s*it\(/gm;
      const cases = (read(row[1]!).match(pattern) ?? []).length;
      expect(cases, row[1]).toBe(Number(row[2]));
    }

    for (const heading of [/^## 0\. /m, /^## D1\. /m, /^## D2\. /m, /^## D3\. /m, /^## 9\. Citations/m]) expect(page).toMatch(heading);
    // D holds exactly FOUR owner-decision numbers; the page location is recorded, never spent as a fifth
    for (const claim of ["D20-23", "D20-28", "UNKNOWN 3", "U1", "U2", "OD-51", "OD-102", "OD-103", "OD-104", "OD-105", "BLOCKED-LIVE-QUALIFICATION", "stays open"]) {
      expect(page, claim).toContain(claim);
    }
  });
});
