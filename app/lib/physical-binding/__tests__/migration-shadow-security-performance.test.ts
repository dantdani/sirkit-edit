import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { legacyFootprintAssignmentView, migrateLegacyPhysicalBinding } from "../legacy";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "../repository";
import { withPhysicalBindingShadow } from "../shadow";
import { physicalBindingDigest } from "../stable";
import { ACTOR, NOW, scope } from "./fixtures";

describe("legacy migration, compatibility, security and scale", () => {
  it("preserves old fields, remains unapproved/unverified, and is deterministic and idempotent", async () => {
    const input = { sourceSchemaVersion: "sirkit.project.legacy-v3", scope: scope("legacy-cap-c1"), rawComponent: { id: "legacy-cap-c1", refDes: "C1", value: "100n", footprintHint: "Capacitor_SMD:C_0603_1608Metric", package: "0603", extraFutureField: { retain: true } }, actor: { ...ACTOR, actorKind: "system_migration" as const, role: "migration_admin" as const }, migratedAt: NOW };
    const first = migrateLegacyPhysicalBinding(input);
    const second = migrateLegacyPhysicalBinding(input);
    expect(first).toEqual(second);
    expect(first.candidate.legacySource?.rawFields).toEqual(input.rawComponent);
    expect(first.candidate.package).toBeUndefined();
    expect(first.diagnostics).toContain("PB_LEGACY_PACKAGE_AMBIGUOUS");
    expect(first.candidate.approval.state).toBe("unreviewed");
    expect(first.candidate.pinPadMapping.state).toBe("legacy_unverified");
    const service = new PhysicalBindingService(new InMemoryPhysicalBindingRepository());
    const once = await service.migrate(first);
    const twice = await service.migrate(second);
    expect(twice.set.recordDigest).toBe(once.set.recordDigest);
    expect(twice.bindings).toHaveLength(1);
    expect(twice.auditEvents).toHaveLength(1);
    expect(twice.migrationRecords).toHaveLength(1);
  });

  it("does not promote an MPN without manufacturer or a hostile footprint locator", () => {
    const result = migrateLegacyPhysicalBinding({ sourceSchemaVersion: "legacy", scope: scope("legacy-j1"), rawComponent: { refDes: "J1", mpn: "12345", footprint: "../../evil:payload", unknown: "preserve" }, actor: { ...ACTOR, actorKind: "system_migration", role: "migration_admin" }, migratedAt: NOW });
    expect(result.candidate.exactPart).toBeUndefined();
    expect(result.candidate.footprint).toBeUndefined();
    expect(result.diagnostics).toEqual(expect.arrayContaining(["PB_LEGACY_MPN_WITHOUT_MANUFACTURER", "PB_LEGACY_FOOTPRINT_LOCATOR_UNPARSEABLE"]));
    expect(result.candidate.legacySource?.rawFields.unknown).toBe("preserve");
  });

  it("bounds hostile payload depth and does not log or execute imported strings", () => {
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 25; index++) nested = { child: nested };
    expect(() => migrateLegacyPhysicalBinding({ sourceSchemaVersion: "legacy", scope: scope("hostile"), rawComponent: nested, actor: { ...ACTOR, actorKind: "system_migration", role: "migration_admin" }, migratedAt: NOW })).toThrow("PB_LEGACY_PAYLOAD_TOO_DEEP");
    expect(() => migrateLegacyPhysicalBinding({ sourceSchemaVersion: "legacy", scope: scope("hostile-null"), rawComponent: { footprint: "Lib:Name\u0000<script>" }, actor: { ...ACTOR, actorKind: "system_migration", role: "migration_admin" }, migratedAt: NOW })).toThrow("PB_LEGACY_NULL_BYTE");
  });

  it("marks the legacy projection non-authoritative", () => {
    const candidate = migrateLegacyPhysicalBinding({ sourceSchemaVersion: "legacy", scope: scope("legacy-view"), rawComponent: { footprintHint: "Connector_Generic:Conn_01x02" }, actor: { ...ACTOR, actorKind: "system_migration", role: "migration_admin" }, migratedAt: NOW }).candidate;
    const view = legacyFootprintAssignmentView(candidate);
    expect(view.authoritative).toBe(false);
    expect(view.proofState).toBe("candidate");
    expect(view.warnings.join(" ")).toContain("unapproved");
  });

  it("runs production exactly once and returns its result unchanged in disabled and enabled shadow modes", async () => {
    const binding = migrateLegacyPhysicalBinding({ sourceSchemaVersion: "legacy", scope: scope("shadow"), rawComponent: { footprintHint: "Connector:One" }, actor: { ...ACTOR, actorKind: "system_migration", role: "migration_admin" }, migratedAt: NOW }).candidate;
    const productionResult = { boardDigest: "legacy-board-unchanged", mutations: ["legacy-only"] };
    let calls = 0;
    let comparison: unknown;
    const result = await withPhysicalBindingShadow({ production: async () => { calls += 1; return productionResult; }, binding, legacyFootprint: "Connector:One", assessedAt: NOW, enabled: true, observe: (value) => { comparison = value; } });
    expect(result).toBe(productionResult);
    expect(calls).toBe(1);
    expect(comparison).toMatchObject({ productionBehaviorChanged: false, agreement: "same" });
    const disabled = await withPhysicalBindingShadow({ production: async () => productionResult, binding, legacyFootprint: "Connector:One", assessedAt: NOW, enabled: false, observe: () => { throw new Error("observer must not run"); } });
    expect(disabled).toBe(productionResult);
  });

  it("keeps canonical digest and readiness-scale work inside regression budgets", () => {
    const started = performance.now();
    for (let index = 0; index < 10_000; index++) physicalBindingDigest({ index, component: `component-${index}`, evidenceRefs: ["b", "a"], nested: { value: "100n" } });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(5_000);
  });
});
