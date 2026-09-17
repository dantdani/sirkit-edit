/**
 * [B19-E E6] a + i — the two bounded read-only external acquisition tools as registry descriptors, and the exposure sweep.
 *
 *  a. `sirkit.parts.external-search` and `sirkit.parts.evidence-read` are Tier 0 reads bound as `bound-external-read` with
 *     exactly the `external-observation` authority; neither id falls in the Tier 3 family or a never-exposed pattern; the
 *     validator refuses `bound-external-read` on a propose, mutate or view-session tool and on any read of another shape.
 *  i. no exposed tool id or owning command names publication, binding, approval, ordering, purchasing, a cart, checkout,
 *     buying, uploading or withdrawal, and no exposed binding module is a publication, cart or catalog repository module.
 */
import { describe, expect, it } from "vitest";
import { sirkitToolRegistry } from "../tool-catalog";
import { validateToolDescriptor, type ToolDescriptor } from "../tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { TIER3_FAMILY_PATTERN, permissionTierOfDescriptor } from "../permission-tiers";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS, agentExposureReport } from "../agent-exposure";
import { resolveReadBinding } from "../tool-bindings-readonly";
import { ACTIVATED_EXTERNAL_READ_BINDINGS, resolveExternalReadBinding } from "../../agent/acquisition-reads";
import { strictCompatibility } from "../../agent/provider-tools";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const SEARCH = "sirkit.parts.external-search";
const EVIDENCE = "sirkit.parts.evidence-read";
const descriptorOf = (id: string): ToolDescriptor => {
  const descriptor = registry.get(id);
  if (!descriptor) throw new Error(`${id} is not registered`);
  return descriptor;
};

describe("[B19-E E6] a — the external read descriptors", () => {
  it("external-search is a Tier 0 read over 1-5 exact MPNs, bound as bound-external-read with exactly the external-observation authority", () => {
    const search = descriptorOf(SEARCH);
    expect(search).toMatchObject({
      version: "1.0.0", lifecycle: "active", owningCommandId: "parts.external-observation-read", category: "parts", operationClass: "read",
      sideEffects: "derived-cache", approvalTier: "none", requiredCapability: "read_project", requiredProjectState: ["board-present"],
      requiredSelectionKinds: [], requiredAuthority: ["external-observation"], requiresExpectedRevision: false, requiresLineage: false,
      discovery: "discoverable", callability: "callable", agentExposed: true, timeoutMs: 12_000,
      binding: { status: "bound-external-read", module: "app/lib/acquisition/agent-read-port.ts" },
    });
    expect(search.executionMode).toBeUndefined();
    expect(search.inputSchema).toEqual({ type: "object", additionalProperties: false, properties: { mpns: expect.objectContaining({ type: "array", items: { type: "string" } }) }, required: ["mpns"] });
    expect(permissionTierOfDescriptor(search)).toBe(0);
    expect(strictCompatibility(search).ok).toBe(true);
    expect(resolveExternalReadBinding(search).state).toBe("resolved");
  });

  it("evidence-read is a cache-only Tier 0 read of one exact MPN with no side effects", () => {
    const evidence = descriptorOf(EVIDENCE);
    expect(evidence).toMatchObject({
      version: "1.0.0", owningCommandId: "parts.external-observation-read", operationClass: "read", sideEffects: "none", approvalTier: "none",
      requiredProjectState: ["board-present"], requiredAuthority: ["external-observation"], agentExposed: true,
      binding: { status: "bound-external-read", module: "app/lib/acquisition/agent-read-port.ts" },
    });
    expect(evidence.inputSchema).toEqual({ type: "object", additionalProperties: false, properties: { mpn: expect.objectContaining({ type: "string" }) }, required: ["mpn"] });
    expect(permissionTierOfDescriptor(evidence)).toBe(0);
    expect(strictCompatibility(evidence).ok).toBe(true);
    expect(resolveExternalReadBinding(evidence).state).toBe("resolved");
  });

  it("every input property is required, neither id is Tier 3 or never-exposed, and the owning record is a chat-exposed read", () => {
    for (const id of [SEARCH, EVIDENCE]) {
      const descriptor = descriptorOf(id);
      const properties = Object.keys((descriptor.inputSchema.properties ?? {}) as Record<string, unknown>).sort();
      expect([...((descriptor.inputSchema.required ?? []) as string[])].sort(), id).toEqual(properties);
      expect(TIER3_FAMILY_PATTERN.test(id), id).toBe(false);
      for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(id), `${id} vs ${pattern}`).toBe(false);
      expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, id).toContain(id);
    }
    const record = ACTION_COVERAGE_REGISTRY.find((item) => item.id === "parts.external-observation-read");
    expect(record).toMatchObject({ kind: "read", toolExposure: "chat", approvalTier: "none", status: "implemented" });
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [], executionViolations: [] });
  });

  it("the validator refuses bound-external-read on a propose, mutate or view-session tool, and on a read of any other shape", () => {
    const base = descriptorOf(SEARCH);
    expect(validateToolDescriptor(base, KNOWN)).toEqual([]);
    const variants: Array<[string, ToolDescriptor]> = [
      ["propose", { ...base, operationClass: "propose", sideEffects: "proposal-artifact" }],
      ["mutate", { ...base, operationClass: "mutate", sideEffects: "engineering-state", approvalTier: "reversible" }],
      ["view-session", { ...base, operationClass: "view-session", sideEffects: "session-state" }],
      ["engineering-state side effects", { ...base, sideEffects: "engineering-state" }],
      ["proposal-artifact side effects", { ...base, sideEffects: "proposal-artifact" }],
      ["an approval tier", { ...base, approvalTier: "reversible" }],
      ["a second authority", { ...base, requiredAuthority: ["external-observation", "local-working-copy"] }],
      ["another authority", { ...base, requiredAuthority: ["local-working-copy"] }],
      ["no module", { ...base, binding: { status: "bound-external-read", symbol: base.binding.symbol } }],
      ["no symbol", { ...base, binding: { status: "bound-external-read", module: base.binding.module } }],
    ];
    for (const [label, variant] of variants) {
      const errors = validateToolDescriptor(variant, KNOWN);
      expect(errors.length, label).toBeGreaterThan(0);
    }
    // the external-observation authority belongs to a bound external read alone
    const boundRead = descriptorOf("sirkit.pcb.board-inspect");
    expect(validateToolDescriptor({ ...boundRead, requiredAuthority: ["external-observation"] }, KNOWN).join(" ")).toMatch(/external-observation/);
  });

  it("a B05 read binding never resolves an external read, and the external resolver refuses a module or symbol that is not the allowlisted one", () => {
    const search = descriptorOf(SEARCH);
    expect(resolveReadBinding(search).state).toBe("not_callable");
    expect(resolveExternalReadBinding({ ...search, binding: { ...search.binding, symbol: "somethingElse" } }).state).toBe("not_callable");
    expect(resolveExternalReadBinding({ ...search, binding: { ...search.binding, module: "app/lib/atomic/server-repository.ts" } }).state).toBe("not_callable");
    expect(resolveExternalReadBinding({ ...search, binding: { ...search.binding, status: "bound-read" } }).state).toBe("not_callable");
    expect(resolveExternalReadBinding(descriptorOf("sirkit.pcb.board-inspect")).state).toBe("not_callable");
    expect(ACTIVATED_EXTERNAL_READ_BINDINGS.map((binding) => binding.toolId).sort()).toEqual([EVIDENCE, SEARCH]);
  });
});

describe("[B19-E E6] i — the exposure sweep", () => {
  const SWEEP = /publish|bind|approve|order|purchas|cart|checkout|buy|upload|withdraw/i;
  /**
   * Reviewed exception, stated here rather than hidden: the B13 authority READ `sirkit.component-authority.inspect` is owned by
   * the `pcb.physical-binding` record because it inspects that aggregate's records; the tool itself binds nothing (Tier 0 read,
   * no side effects). Its id does not match; only its owning command's name does.
   */
  const REVIEWED_OWNER_EXCEPTIONS = new Map([["sirkit.component-authority.inspect", "pcb.physical-binding"]]);
  const exposed = registry.list().filter((descriptor) => descriptor.agentExposed);

  it("no exposed tool id or owning command matches publish|bind|approve|order|purchas|cart|checkout|buy|upload|withdraw", () => {
    expect(exposed.map((descriptor) => descriptor.toolId)).toEqual(expect.arrayContaining([SEARCH, EVIDENCE]));
    const offenders: string[] = [];
    for (const descriptor of exposed) {
      if (SWEEP.test(descriptor.toolId)) offenders.push(`id ${descriptor.toolId}`);
      if (SWEEP.test(descriptor.owningCommandId) && REVIEWED_OWNER_EXCEPTIONS.get(descriptor.toolId) !== descriptor.owningCommandId) offenders.push(`owner ${descriptor.toolId} -> ${descriptor.owningCommandId}`);
    }
    expect(offenders).toEqual([]);
    for (const [toolId] of REVIEWED_OWNER_EXCEPTIONS) {
      const descriptor = descriptorOf(toolId);
      expect(descriptor).toMatchObject({ operationClass: "read", sideEffects: "none", approvalTier: "none" });
      expect(permissionTierOfDescriptor(descriptor)).toBe(0);
    }
  });

  it("no exposed binding module is the catalog repository, the cart formats, a BOM cart route or the publication review", () => {
    const forbidden = (module: string): boolean =>
      module === "app/lib/atomic/server-repository.ts" || module === "app/lib/cart-formats.ts" || module.startsWith("app/api/bom/cart/") || module === "app/lib/atomic/publication-review.ts";
    expect(exposed.filter((descriptor) => forbidden(descriptor.binding.module ?? "")).map((descriptor) => descriptor.toolId)).toEqual([]);
  });
});
