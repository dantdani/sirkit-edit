/**
 * [B18-E E16] The fixture runtime's component-authority seams — scenario 4's structural blocker.
 *
 * Both `/api/chat` authority sources were gated on `DATABASE_URL`, which the fixture launchers blank on purpose. So in
 * every browser run the component-authority resource was never sealed, and the model was told
 * "Tool sirkit.schematic.propose-component-replacement unavailable: required resource(s) component-authority-records
 * cannot be supplied for this run." Scenario 4 was unreachable in the real application, not merely unproven.
 *
 * What is pinned here: the fixture sources exist, they are reachable ONLY under the fixture runtime, they read the stores
 * the fixture already fills (never invented rows), and an unapproved mapping or an absent binding still yields nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureComponentAuthoritySource, fixtureReplacementPinFactsSource } from "../blinker/authority";
import { fixtureContainer, resetFixtureContainer } from "../container";
import { blinkerCatalog } from "../blinker/catalog";
import { resolveComponentAuthoritySource } from "@/app/api/chat/component-authority-runtime";
import { resolveReplacementPinFactsSource } from "@/app/api/chat/replacement-facts-runtime";

const SAVED = { ...process.env };
function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
const fixtureOn = () => setEnv({ SIRKIT_FIXTURE_RUNTIME: "blinker", SIRKIT_AUTH_MODE: "local_dev", NODE_ENV: "test", DATABASE_URL: "" });

beforeEach(fixtureOn);
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in SAVED)) delete process.env[key];
  Object.assign(process.env, SAVED);
});

describe("[B18-E E16] the fixture component-authority seams", () => {
  it("the resolvers hand back a fixture source under the fixture runtime, where they used to hand back nothing", () => {
    expect(resolveComponentAuthoritySource({ tenantId: "local", projectId: "p", branchId: "main" }), "the authority source").not.toBeNull();
    expect(resolveReplacementPinFactsSource(), "the published pin facts").not.toBeNull();
  });

  it("and NOTHING outside it: with the runtime off, both resolvers withhold (no database, no fixture)", () => {
    setEnv({ SIRKIT_FIXTURE_RUNTIME: undefined });
    expect(resolveComponentAuthoritySource({ tenantId: "local", projectId: "p", branchId: "main" })).toBeNull();
    expect(resolveReplacementPinFactsSource()).toBeNull();
    // Requested but not honoured (production auth) is the same as off — the gate is `fixtureRuntimeEnabled`.
    setEnv({ SIRKIT_FIXTURE_RUNTIME: "blinker", SIRKIT_AUTH_MODE: "production" });
    expect(resolveComponentAuthoritySource({ tenantId: "local", projectId: "p", branchId: "main" })).toBeNull();
    expect(resolveReplacementPinFactsSource()).toBeNull();
    expect(() => fixtureComponentAuthoritySource()).toThrow(/FIXTURE_RUNTIME_DISABLED/);
    expect(() => fixtureReplacementPinFactsSource()).toThrow(/FIXTURE_RUNTIME_DISABLED/);
  });

  it("the bindings it reads are the ones the fixture STORE holds — a component nobody bound resolves to nothing", async () => {
    resetFixtureContainer();
    const source = fixtureComponentAuthoritySource();
    const aggregates = await source.bindings.loadForComponent({
      tenantId: "local", projectId: "p", branchId: "main", boardInstanceId: "board-1",
      componentInstanceId: "never-bound", hierarchyPath: ["root"], assemblyVariantId: "variant-default",
    });
    expect(aggregates, "nothing is invented for a component the fixture never bound").toEqual([]);
  });

  it("the atomic confirmation is the committed catalog's own published revision — and only when its mapping is approved", async () => {
    const catalog = blinkerCatalog();
    const [revisionId, snapshot] = [...catalog.snapshots.entries()][0]!;
    const source = fixtureComponentAuthoritySource();
    const confirmed = await source.atomic(revisionId);
    expect(confirmed, `${revisionId} is a published fixture revision`).not.toBeNull();
    expect(confirmed!).toMatchObject({
      atomicPartRevisionId: revisionId,
      published: true,
      exactMpn: snapshot.exactPart!.exactMpn,
      symbolAssetVersionId: snapshot.symbol.versionId,
    });
    expect(await source.atomic("no-such-revision"), "an unknown revision confirms nothing").toBeNull();
  });

  it("the published pin facts are the symbol's own pins and its APPROVED certificate — never a fabricated mapping", async () => {
    const catalog = blinkerCatalog();
    const entry = [...catalog.snapshots.entries()].find(([, snapshot]) => snapshot.mapping?.state === "approved" && snapshot.symbol.pins.length > 0);
    expect(entry, "the fixture catalog publishes at least one approved mapping").toBeTruthy();
    const [revisionId, snapshot] = entry!;
    const facts = await fixtureReplacementPinFactsSource().loadPinFacts(revisionId);
    expect(facts).not.toBeNull();
    expect(facts!.symbolAssetVersionId).toBe(snapshot.symbol.versionId);
    expect(facts!.pins.map((pin) => pin.number)).toEqual(snapshot.symbol.pins.map((pin) => pin.number));
    expect(facts!.certificate.state).toBe("approved");
    expect(facts!.symbolPinIds).toEqual(snapshot.symbol.pins.map((pin) => pin.id));
    expect(await fixtureReplacementPinFactsSource().loadPinFacts("no-such-revision")).toBeNull();
  });

  it("the container is shared, not rebuilt per call: two sources read the same store", async () => {
    const first = fixtureComponentAuthoritySource();
    const second = fixtureComponentAuthoritySource();
    const scope = { tenantId: "local", projectId: "p", branchId: "main", boardInstanceId: "b", componentInstanceId: "c", hierarchyPath: ["root"], assemblyVariantId: "v" } as const;
    expect(await first.bindings.loadForComponent(scope)).toEqual(await second.bindings.loadForComponent(scope));
    expect(fixtureContainer()).toBe(fixtureContainer());
  });
});
