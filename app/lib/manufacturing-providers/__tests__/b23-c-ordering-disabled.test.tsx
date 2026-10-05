// @vitest-environment jsdom
/**
 * [B23-C] Ordering is visibly disabled (runbook B23-C :984-994 "Ordering stays feature-disabled until the owner separately supplies:" the
 * seven inputs; pass :1017 "purchase/order paths are either separately authorized and idempotent or remain visibly disabled"; D23-10;
 * OD-170, OD-171). `orderingEnablement()` answers disabled with the closed list of missing prerequisites unless an owner record carries
 * all seven AND a reviewed code change wires a submission port; no environment variable can enable it and the operator switch only turns
 * it off; no record exists in B23. The action record `manufacturing.provider-order` is `missing`, explicitly blocked, never tool-exposed,
 * approval tier `release` (Tier 3), and reached by no control and no route (B17-A's rule); the provider panel shows a fixed notice that
 * B19-E's purchase phrases do not match, with no control. The page `ordering-boundary.md` is checked last.
 *
 * The panel renders with a fake transport and makes no request. Files are read as text; nothing is written and nothing leaves the
 * process.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderExchangePanel } from "@/app/components/pcb/ProviderExchangePanel";
import { listRouteFiles } from "@/app/lib/auth/route-tree";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE, renderActionToolabilityCsv, validateActionCoverageRegistry } from "@/app/lib/engineering/action-registry";
import { classifyControlSites, CONTROL_RULES } from "@/app/lib/engineering/control-registry";
import { scanControlSites } from "@/app/lib/engineering/control-surface";
import { decideAgentExecution, permissionTierOfAction } from "@/app/lib/engineering/permission-tiers";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { ORDER_SUBMISSION_PORT_WIRING, ORDERING_DISABLED_NOTICE, ORDERING_DISABLED_REASONS, ORDERING_OPERATOR_DISABLE_ENV, ORDERING_OWNER_RECORD, ORDERING_PREREQUISITE_RUNBOOK, ORDERING_PREREQUISITES, orderingEnablement, orderingEnablementFromProcess, type OrderingPrerequisite } from "../ordering-enablement";
import { TEST_OWNER_RECORD } from "./_b23-c-ordering-fixture";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
const ID = "manufacturing.provider-order";
const PANEL = "app/components/pcb/ProviderExchangePanel.tsx";
const REGISTRY = "app/lib/engineering/action-registry.ts";
const PAGE = "artifacts/ai-control-plane-b23/ordering-boundary.md";
const MODULES = ["ordering-enablement.ts", "purchase-authorization.ts", "order-contract.ts", "webhook-verification.ts"].map((name) => `app/lib/manufacturing-providers/${name}`);
/** B19-E's purchase wording and its one lifecycle exception, verbatim (case 5 pins both equal to b19-e-no-purchase-tripwire.test.ts). */
const PURCHASE_WORDING = /add to cart|checkout|\bbuy\b|place (an )?order|purchase order|order now|project cart|populate your cart/i;
const LIFECYCLE_TERM = /\blast[- ]time[- ]buy\b/gi;
const hasPurchaseWording = (text: string): boolean => PURCHASE_WORDING.test(text.replace(LIFECYCLE_TERM, ""));
const SEVEN = ["account_reference", "spend_and_quantity_limits", "billing_shipping_policy", "authorized_roles", "cancellation_refund_behaviour", "legal_compliance", "sandbox_path"] as const;
const record = () => ACTION_COVERAGE_REGISTRY.find((entry) => entry.id === ID);
const withPrerequisites = (prerequisites: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ownerDecision: "OD-999", prerequisites, ...extra });
const fullPrerequisites = (): Record<string, unknown> => ({ ...TEST_OWNER_RECORD.prerequisites });

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("[B23-C] ordering is visibly disabled (D23-10; OD-170, OD-171)", () => {
  it("1. orderingEnablement() answers disabled with the closed list of the runbook's seven prerequisites, all missing: no owner record exists and no submission port is wired", () => {
    expect([...ORDERING_PREREQUISITES]).toEqual([...SEVEN]);
    expect(Object.entries(ORDERING_PREREQUISITE_RUNBOOK)).toEqual([
      ["account_reference", "a supported account"],
      ["spend_and_quantity_limits", "spending and quantity limits"],
      ["billing_shipping_policy", "billing/shipping policy"],
      ["authorized_roles", "authorized human roles"],
      ["cancellation_refund_behaviour", "cancellation/refund behavior"],
      ["legal_compliance", "legal/compliance requirements"],
      ["sandbox_path", "a staging/sandbox provider path"],
    ]);
    expect(ORDERING_OWNER_RECORD).toBe(null);
    expect(ORDER_SUBMISSION_PORT_WIRING).toBe("none");
    const verdict = orderingEnablement();
    expect(verdict).toEqual({ enabled: false, reasons: ["owner_record_absent", "submission_port_not_wired"], missing: [...SEVEN], ownerDecision: null, notice: ORDERING_DISABLED_NOTICE });
    expect(Object.isFrozen(verdict) && Object.isFrozen(verdict.missing)).toBe(true);
    expect([...ORDERING_DISABLED_REASONS]).toEqual(["owner_record_absent", "owner_record_invalid", "prerequisites_missing", "submission_port_not_wired", "operator_disabled"]);
  });

  it("2. only a complete owner record AND a wired port enable it: each missing, empty or UNKNOWN prerequisite is listed; a complete record without a wired port stays disabled; an invalid record enables nothing, even with a wired port", () => {
    for (const prerequisite of SEVEN) {
      for (const value of [undefined, "", "   ", "UNKNOWN", "unknown"]) {
        const prerequisites = fullPrerequisites();
        if (value === undefined) delete prerequisites[prerequisite]; else prerequisites[prerequisite] = value;
        for (const submissionPort of ["none", "wired"] as const) {
          const verdict = orderingEnablement({ ownerRecord: withPrerequisites(prerequisites), submissionPort });
          expect(verdict.enabled, `${prerequisite}=${JSON.stringify(value)} ${submissionPort}`).toBe(false);
          expect(verdict.missing, prerequisite).toEqual([prerequisite]);
          expect(verdict.reasons, prerequisite).toEqual(submissionPort === "wired" ? ["prerequisites_missing"] : ["prerequisites_missing", "submission_port_not_wired"]);
        }
      }
    }
    expect(orderingEnablement({ ownerRecord: TEST_OWNER_RECORD })).toMatchObject({ enabled: false, reasons: ["submission_port_not_wired"], missing: [], ownerDecision: "OD-999" });
    expect(orderingEnablement({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "yes" as never })).toMatchObject({ enabled: false, reasons: ["submission_port_not_wired"] });
    expect(orderingEnablement({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired" })).toEqual({ enabled: true, reasons: [], missing: [], ownerDecision: "OD-999", notice: null });
    const invalid: Array<[string, unknown]> = [
      ["a string", "OD-999"],
      ["an array", [TEST_OWNER_RECORD]],
      ["an extra key", withPrerequisites(fullPrerequisites(), { enabled: true })],
      ["an extra prerequisite", withPrerequisites({ ...fullPrerequisites(), payment_card: "x" })],
      ["no owner decision", { prerequisites: fullPrerequisites() }],
      ["a malformed owner decision", withPrerequisites(fullPrerequisites(), { ownerDecision: "od-1" })],
      ["prerequisites that are no object", withPrerequisites([] as never)],
      ["a number for a reference", withPrerequisites({ ...fullPrerequisites(), account_reference: 42 })],
      ["a reference over 200 characters", withPrerequisites({ ...fullPrerequisites(), legal_compliance: "x".repeat(201) })],
      ["a reference with a line break", withPrerequisites({ ...fullPrerequisites(), sandbox_path: `a${NEWLINE}b` })],
    ];
    for (const [label, ownerRecord] of invalid) {
      const verdict = orderingEnablement({ ownerRecord, submissionPort: "wired" });
      expect(verdict.enabled, label).toBe(false);
      expect(verdict.reasons, label).toEqual(["owner_record_invalid"]);
      expect(verdict.missing, label).toEqual([...SEVEN]);
    }
  });

  it("3. no environment variable can enable it: the pure function reads only the environment it is given, and the production default reads exactly one process variable, the operator switch; without a record every environment answers disabled; the switch, set to any value, turns even a complete record off", () => {
    const envs: Array<Record<string, string>> = [{}, { SIRKIT_ORDERING_ENABLED: "1" }, { SIRKIT_ORDERING: "on" }, { SIRKIT_B23_LIVE_PROVIDER: "1" }, { [ORDERING_OPERATOR_DISABLE_ENV]: "" }, { SIRKIT_MANUFACTURING_DISABLED_PROVIDERS: "" }, { SIRKIT_ORDERING_OWNER_RECORD: JSON.stringify(TEST_OWNER_RECORD), SIRKIT_ORDER_SUBMISSION_PORT: "wired" }];
    for (const env of envs) expect(orderingEnablement({ env }), JSON.stringify(env)).toEqual(orderingEnablement());
    for (const value of ["1", "0", "false", "no", "off", " x "]) {
      expect(orderingEnablement({ env: { [ORDERING_OPERATOR_DISABLE_ENV]: value } }).reasons, value).toEqual(["owner_record_absent", "submission_port_not_wired", "operator_disabled"]);
      expect(orderingEnablement({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired", env: { [ORDERING_OPERATOR_DISABLE_ENV]: value } }), value).toMatchObject({ enabled: false, reasons: ["operator_disabled"], missing: [] });
    }
    expect(orderingEnablement({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired", env: { [ORDERING_OPERATOR_DISABLE_ENV]: "   " } }).enabled).toBe(true);
    // the only key it reads is the switch
    const keys: string[] = [];
    const watched = new Proxy({} as Record<string, string | undefined>, { get: (_target, key) => { keys.push(String(key)); return undefined; } });
    orderingEnablement({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired", env: watched });
    expect([...new Set(keys)]).toEqual([ORDERING_OPERATOR_DISABLE_ENV]);
    // [B23-C fix, 2026-10-04] reviewed pin move (security-1): this case pinned the switch, set in the process environment, as doing nothing on
    // the production path. The pure function still reads only what it is given; the production default, which both stores use, now reads
    // that one switch from the process, so an operator turns ordering off without a code change; no process variable can turn it on.
    vi.stubEnv(ORDERING_OPERATOR_DISABLE_ENV, "");
    vi.stubEnv("SIRKIT_ORDERING_ENABLED", "1");
    vi.stubEnv("SIRKIT_ORDER_SUBMISSION_PORT", "wired");
    expect(orderingEnablementFromProcess()).toEqual(orderingEnablement());
    expect(orderingEnablementFromProcess({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired" }).enabled).toBe(true);
    vi.stubEnv(ORDERING_OPERATOR_DISABLE_ENV, "1");
    expect(orderingEnablement()).toEqual({ enabled: false, reasons: ["owner_record_absent", "submission_port_not_wired"], missing: [...SEVEN], ownerDecision: null, notice: ORDERING_DISABLED_NOTICE });
    expect(orderingEnablement({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired" }).enabled).toBe(true);
    expect(orderingEnablementFromProcess().reasons).toEqual(["owner_record_absent", "submission_port_not_wired", "operator_disabled"]);
    expect(orderingEnablementFromProcess({ ownerRecord: TEST_OWNER_RECORD, submissionPort: "wired" })).toMatchObject({ enabled: false, reasons: ["operator_disabled"], missing: [] });
    // the one process read is that switch, in ordering-enablement.ts; both stores default to it
    for (const file of MODULES) expect(read(file).split("process.env").length - 1, file).toBe(file.endsWith("/ordering-enablement.ts") ? 1 : 0);
    expect(read(MODULES[0]!)).toContain("process.env[ORDERING_OPERATOR_DISABLE_ENV]");
    for (const file of [MODULES[1]!, MODULES[2]!]) expect(read(file), file).toContain("options.enablement ?? (() => orderingEnablementFromProcess())");
  });

  it("4. the action record manufacturing.provider-order: missing, explicitly blocked until OD-171's prerequisites, no tool exposure, approval tier release, Tier 3 (decision never); appended in place on the provider-exchange line, so :118, :159 and :182 keep their records; one row of the B01 CSV", () => {
    const entry = record();
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry).toMatchObject({ id: ID, version: 1, area: "manufacturing", kind: "destructive", status: "missing", handler: "explicitly blocked: feature-disabled until the owner supplies OD-171's prerequisites", domainCommand: null, mutationAuthority: "none", historyOrRevision: "none", toolExposure: "none", approvalTier: "release" });
    expect(entry.sideEffects).toBeUndefined();
    expect(validateActionCoverageRegistry()).toEqual([]);
    expect(permissionTierOfAction(entry)).toBe(3);
    for (const actorRole of ["project_admin", "pcb_editor"] as const) expect(decideAgentExecution({ tier: permissionTierOfAction(entry), setting: null, actorRole, explicitUserRequest: true }).decision).toBe("never");
    const source = lines(REGISTRY);
    expect(source[117]).toContain('id: "manufacturing.assembled-release"');
    expect(source[158]).toContain('id: "bom.workbench"');
    expect(source[181]).toContain('id: "cd.release-engineering.workbench"');
    expect(source[181]).toContain("never orders or releases");
    const shared = source[185]!;
    expect(shared.indexOf('id: "manufacturing.provider-exchange"')).toBeGreaterThan(-1);
    expect(shared.indexOf(`id: "${ID}"`)).toBeGreaterThan(shared.indexOf('id: "manufacturing.provider-exchange"'));
    expect(source.filter((line) => line.includes(`id: "${ID}"`))).toHaveLength(1);
    const csv = read("artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv");
    expect(csv).toBe(renderActionToolabilityCsv());
    expect(csv.split(NEWLINE).filter((row) => row.startsWith(`${ID},`))).toHaveLength(1);
  });

  it("5. B17-A's missing-unreachable rule holds (:63): no control, no control rule, no route coverage row, no route file and no tool names the record; the B19-E tripwire is unchanged", () => {
    const { classified } = classifyControlSites(scanControlSites(ROOT));
    expect(classified.length).toBeGreaterThan(400);
    expect(classified.filter((row) => row.recordIds.includes(ID))).toEqual([]);
    expect(CONTROL_RULES.filter((rule) => (rule.recordIds ?? []).includes(ID))).toEqual([]);
    expect(API_ROUTE_COVERAGE.filter((entry) => entry.recordId === ID)).toEqual([]);
    const routes = listRouteFiles(ROOT).map((file) => relative(ROOT, file).split(sep).join("/"));
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.filter((file) => read(file).includes("provider-order"))).toEqual([]);
    expect(sirkitToolRegistry().list().filter((descriptor) => descriptor.toolId.includes("provider-order"))).toEqual([]);
    const tripwire = read("app/lib/engineering/__tests__/b19-e-no-purchase-tripwire.test.ts");
    expect(tripwire).toContain(`const PURCHASE_WORDING = ${PURCHASE_WORDING.toString()};`);
    expect(tripwire).toContain(`const LIFECYCLE_TERM = ${LIFECYCLE_TERM.toString()};`);
    expect(tripwire).toContain("const ORDER_OPERATIONS = /placeOrder|checkout|addToCart|purchaseOrder/;");
  }, 30_000);

  it("6. the fixed notice renders in the provider panel for every viewer, worded outside B19-E's purchase phrases, and no control comes with it", () => {
    expect(hasPurchaseWording(ORDERING_DISABLED_NOTICE)).toBe(false);
    for (const prerequisite of ["account", "limits", "billing and shipping policy", "roles", "cancellation and refund", "legal and compliance", "sandbox path"]) expect(ORDERING_DISABLED_NOTICE, prerequisite).toContain(prerequisite);
    const entry = record()!;
    for (const text of [entry.action, entry.handler, entry.validation, entry.notes ?? ""]) expect(hasPurchaseWording(text), text).toBe(false);
    const fetchImpl = vi.fn(async () => Response.json({ ok: false })) as unknown as typeof fetch;
    const scope = { tenantId: "tenant-b23c", projectId: "project-b23c", branchId: "main", designId: "design:b23c", boardId: "board:b23c" };
    for (const canAct of [true, false]) {
      render(<ProviderExchangePanel scope={scope} authority={{ revision: 1, recordDigest: "sha256:b23c" }} canAct={canAct} fetchImpl={fetchImpl} newKey={() => "key-1"} />);
      expect(screen.getByTestId("p2g-ordering-notice").textContent, String(canAct)).toBe(ORDERING_DISABLED_NOTICE);
      const panel = screen.getByTestId("p2g-provider-panel");
      const controls = [...panel.querySelectorAll("button, select, input, textarea, a, [role=button]")].map((element) => element.getAttribute("data-testid"));
      expect(controls, String(canAct)).toEqual(["p2g-provider-choice", "p2g-provider-preview", "p2g-provider-commit"]);
      expect(hasPurchaseWording(panel.textContent ?? ""), String(canAct)).toBe(false);
      cleanup();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    const source = read(PANEL);
    expect(source.split(ORDERING_DISABLED_NOTICE)).toHaveLength(2); // the literal is in the panel's own copy, where B19-E's scan reads it
    expect(scanControlSites(ROOT, [PANEL]).map((site) => site.kind).sort()).toEqual(["change", "click", "click"]);
  });

  it("7. the page ordering-boundary.md states the verdict, the seven prerequisites (none supplied), the contract and its suites, and LB-12; every citation of its section 13 is on the line it names", () => {
    const page = read(PAGE);
    expect(page.startsWith("# B23-C - ")).toBe(true);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(`**${label}**`);
    const titles = ["0. What B23-C is", "1. Ordering visibly disabled (D23-10, OD-170, OD-171)", "2. The seven prerequisites, none supplied", "3. The purchase authorization (D23-11, OD-172)", "4. The order contract against a fake port", "5. Webhook verification", "6. Who can reach it", "7. Live: BLOCKED-LIVE-QUALIFICATION (LB-12)", "8. Test-first record", "9. Every pin moved, and why", "10. Gates", "11. OD-186 - B23-C's choices beyond its task text", "12. What stays open", "13. Citations"];
    const positions = titles.map((title) => page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`));
    expect(positions.every((position) => position > 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(page).toContain("**Verdict: ordering is visibly disabled.");
    for (const words of Object.values(ORDERING_PREREQUISITE_RUNBOOK)) expect(page, words).toContain(words);
    for (const suite of ["b23-c-ordering-disabled", "b23-c-purchase-authorization", "b23-c-order-contract", "b23-c-webhook-verification"]) expect(page, suite).toContain(suite);
    expect(page).toContain("LB-12");
    expect(page).toContain(ORDERING_DISABLED_NOTICE);
    const citations = page.slice(page.indexOf(`${NEWLINE}## 13. Citations${NEWLINE}`));
    const rows = [...citations.matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| `(.+)` \|$/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.map((row) => row[1])).toEqual(rows.map((_, index) => `C${index + 1}`));
    const stale = rows.filter((row) => !(lines(row[2]!)[Number(row[3]) - 1] ?? "").includes(row[4]!.replaceAll("\\|", "|"))).map((row) => `${row[1]} ${row[2]}:${row[3]}`);
    expect(stale).toEqual([]);
    for (const prerequisite of SEVEN satisfies readonly OrderingPrerequisite[]) expect(page, prerequisite).toContain(`\`${prerequisite}\``);
  });
});
