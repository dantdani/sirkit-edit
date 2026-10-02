/**
 * [B22-C] Wording (discovery D22-14, the UI half; 9.5 item 25; OD-144; runbook B22-A :906 "Do not call a weak subprocess sandbox
 * authoritative", global :144 "never tell a human that a ... simulation ... is verified beyond the evidence"). The SPICE report was
 * titled a "verification report" with a "Qualification summary", the Reports & regression panel's eyebrow label read "Reproducible
 * qualification", and the public renderer produced that document from caller-supplied records with no disclosure. Now one fixed
 * diagnostic disclosure sentence stands in the report (JSON and HTML) and in the studio panel, and `/api/spice/reports` stays public
 * with the disclosure "caller-supplied records, not verified by Sirkit". The dated notes beside the B16.0.24 records and the
 * `/api/simulate` header are the closeout's; this suite also pins the human-truth sentences discovery section 5 found unpinned.
 *
 * Test-first: cases 1-4 ran RED on b4c7be7. No process, no network, no model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { policyFor } from "@/app/lib/auth/route-policy";
import { buildSpiceReport, reportToHtml, reportToJson } from "@/app/lib/spice/report";
import { createSimulationProject } from "@/app/lib/spice/project";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";
import { POST as reportsPost } from "@/app/api/spice/reports/route";

const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");
const DISCLOSURE = "Diagnostic simulation only: these results come from a local ngspice process with no isolation boundary, so they are environment-dependent evidence and never verification, qualification or engineering approval.";
const CALLER = "caller-supplied records, not verified by Sirkit";

describe("[B22-C] diagnostic wording with one fixed disclosure (D22-14, OD-144)", () => {
  it("1. the SPICE report is a diagnostic simulation report: its default title, its HTML heading and its JSON carry the one fixed disclosure sentence", async () => {
    const types = await import("@/app/lib/spice/types");
    expect(types.DIAGNOSTIC_SIMULATION_DISCLOSURE).toBe(DISCLOSURE);
    const project = createSimulationProject(dividerSchematic());
    const report = buildSpiceReport(project, []);
    expect(report.title).toBe(`${project.name} diagnostic simulation report`);
    expect(report.disclosures).toEqual([DISCLOSURE]);
    const html = reportToHtml(report);
    expect(html).toContain(DISCLOSURE);
    expect(html).toContain("<h2>Diagnostic specification summary</h2>");
    expect(html).not.toMatch(/Qualification summary|verification report/);
    expect((JSON.parse(reportToJson(report)) as { disclosures: string[] }).disclosures).toEqual([DISCLOSURE]);
  });

  it("2. the studio's Reports & regression panel carries the diagnostic eyebrow label and renders the same sentence", () => {
    const studio = read("app/components/spice/SpiceStudio.tsx");
    expect(studio).not.toContain("Reproducible qualification");
    expect(studio).toContain('text-zinc-600">Diagnostic regression</div><h2 className="mt-1 text-xl font-semibold">Reports & regression</h2>');
    expect(studio).toContain("{DIAGNOSTIC_SIMULATION_DISCLOSURE}");
    expect(studio).toMatch(/import \{[^}]*DIAGNOSTIC_SIMULATION_DISCLOSURE[^}]*\} from "@\/app\/lib\/spice\/report";/);
  });

  it("3. /api/spice/reports stays public and says what it renders: caller-supplied records, not verified by Sirkit, beside the diagnostic sentence - whatever title the caller sends", async () => {
    expect(policyFor("/api/spice/reports", "POST")?.requiresAuth).toBe(false);
    const project = createSimulationProject(dividerSchematic());
    const request = (format: "json" | "html") => new Request("http://localhost/api/spice/reports", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ project, runs: [], format, title: "Certified qualification report" }) });
    const json = JSON.parse(await (await reportsPost(request("json"))).text()) as { title: string; disclosures: string[] };
    expect(json.title).toBe("Certified qualification report");
    expect(json.disclosures).toEqual([DISCLOSURE, CALLER]);
    const html = await (await reportsPost(request("html"))).text();
    expect(html).toContain(DISCLOSURE);
    expect(html).toContain(CALLER);
    const types = await import("@/app/lib/spice/types");
    expect(types.CALLER_SUPPLIED_RECORDS_DISCLOSURE).toBe(CALLER);
  });

  it("4. no SPICE report or studio string still calls a diagnostic run a verification or a qualification", () => {
    for (const path of ["app/lib/spice/report.ts", "app/components/spice/SpiceStudio.tsx", "app/api/spice/reports/route.ts"]) {
      expect(read(path), path).not.toMatch(/verification report|Qualification summary|Reproducible qualification/);
    }
  });

  it("5. the standing human-truth sentences discovery section 5 found unpinned stay true: /api/simulate's truthfulness sentence, the CD-10 page's blocked verdict, the SPICE AI's run note", () => {
    const simulate = read("app/api/simulate/route.ts").replace(/\r?\n \* /g, " ");
    expect(simulate).toContain("a successful process exit is an EXECUTED simulation result only — never physical validation, engineering approval, design readiness, safety certification, or manufacturing release.");
    const page = read("app/model-simulation/page.tsx");
    expect(page).toContain("Validated sandbox unavailable");
    expect(page).toContain("Current verdict: BLOCKED");
    expect(read("app/api/spice/ai/route.ts")).toContain("Execution begins only after the user applies this proposal.");
  });
});
