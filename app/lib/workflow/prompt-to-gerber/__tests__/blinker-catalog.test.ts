/**
 * B16.1C §G — the acceptance catalog is a truthful, closed, deterministic
 * fixture: real KiCad geometry, production-validated mapping certificates,
 * published atomic revisions, and a fake-provider netlist whose every pin
 * exists on the referenced symbols.
 */
import { describe, expect, it } from "vitest";
import { BLINKER_ACCEPTANCE_PROMPT, BLINKER_NETLIST, BLINKER_PART_IDS, blinkerCatalog } from "./fixtures/blinker-catalog";
import { isLabelConnection } from "@/lib/schematic-types";

describe("B16.1C acceptance catalog (555 astable LED blinker)", () => {
  const fixture = blinkerCatalog();

  it("publishes one atomic revision per exact part with an approved certificate and complete snapshot", () => {
    expect([...fixture.parts.keys()].sort()).toEqual(Object.values(BLINKER_PART_IDS).sort());
    let revisions = 0;
    for (const part of fixture.parts.values()) {
      for (const entry of Object.values(part.revisions)) {
        revisions += 1;
        expect(entry.mapping.state).toBe("approved");
        expect(entry.mapping.missingSymbolPinIds).toEqual([]);
        expect(entry.mapping.missingPadNumbers).toEqual([]);
        expect(fixture.catalog.isPublished(entry.revisionId)).toBe(true);
        const snapshot = fixture.snapshots.get(entry.revisionId);
        expect(snapshot).toBeDefined();
        expect(snapshot!.footprint?.versionId).toBe(part.footprint.versionId);
        expect(snapshot!.symbol.versionId).toBe(part.symbol.versionId);
        expect(snapshot!.mapping?.id).toBe(entry.mapping.id);
        expect(snapshot!.exactPart?.exactMpn).toBe(entry.exactPart.exactMpn);
        expect(snapshot!.evidence.length).toBeGreaterThan(0);
        // The raw footprint bytes travel with the snapshot under the parsed asset's content hash.
        const raw = snapshot!.assetBlobs.find((blob) => blob.id === snapshot!.footprint!.rawContentObjectId);
        expect(raw?.contentHash).toBe(part.footprint.contentHash);
        expect(raw?.encoding).toBe("utf8");
      }
    }
    expect(revisions).toBe(9);
  });

  it("uses the official KiCad geometry: SOIC-8 has 8 SMD pads, 0805 parts 2 pads, the header 2 plated holes", () => {
    const pads = (id: string) => fixture.parts.get(id)!.footprint.pads.filter((pad) => !pad.mechanical);
    expect(pads(BLINKER_PART_IDS.timer)).toHaveLength(8);
    expect(fixture.parts.get(BLINKER_PART_IDS.timer)!.footprint.mountingTechnology).toBe("smd");
    for (const id of [BLINKER_PART_IDS.resistor, BLINKER_PART_IDS.capacitor, BLINKER_PART_IDS.led]) {
      expect(pads(id)).toHaveLength(2);
      expect(fixture.parts.get(id)!.footprint.mountingTechnology).toBe("smd");
    }
    const header = fixture.parts.get(BLINKER_PART_IDS.header)!.footprint;
    expect(header.mountingTechnology).toBe("through_hole");
    expect(pads(BLINKER_PART_IDS.header).every((pad) => pad.padType === "thru_hole" && (pad.drillNm ?? 0) > 0)).toBe(true);
    // Derived symbol inheritance resolved: NE555D carries the 8 timer pins.
    expect(fixture.parts.get(BLINKER_PART_IDS.timer)!.extracted.pins.map((pin) => pin.number).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    const led = fixture.parts.get(BLINKER_PART_IDS.led)!.extracted.pins;
    expect(led.find((pin) => pin.number === "1")?.name).toBe("K");
    expect(led.find((pin) => pin.number === "2")?.name).toBe("A");
  });

  it("the fake-provider netlist references only catalog parts and existing pins, with an atomic revision per value", () => {
    const byRef = new Map(BLINKER_NETLIST.components.map((component) => [component.refDes, component]));
    for (const component of BLINKER_NETLIST.components) {
      expect(fixture.cachedParts.has(component.partId), component.refDes).toBe(true);
      expect(fixture.revisionFor(component.partId, component.value), `${component.refDes}=${component.value}`).not.toBeNull();
    }
    const pinExists = (endpoint: string) => {
      const [ref, pin] = endpoint.split(".");
      const component = byRef.get(ref!);
      return Boolean(component && fixture.cachedParts.get(component.partId)!.pins.some((item) => item.number === pin));
    };
    for (const connection of BLINKER_NETLIST.connections) {
      if (isLabelConnection(connection)) expect(pinExists(connection.pin), connection.pin).toBe(true);
      else { expect(pinExists(connection.from), connection.from).toBe(true); expect(pinExists(connection.to), connection.to).toBe(true); }
    }
    expect(BLINKER_ACCEPTANCE_PROMPT).toContain("555 timer in astable mode at approximately 1 to 1.5 Hz");
  });

  it("is deterministic: rebuilding the catalog in a fresh module yields identical revision ids and digests", async () => {
    const { blinkerCatalog: rebuilt } = await import("./fixtures/blinker-catalog?fresh=" + Date.now()) as typeof import("./fixtures/blinker-catalog");
    const second = rebuilt();
    expect([...second.snapshots.keys()].sort()).toEqual([...fixture.snapshots.keys()].sort());
    for (const [id, snapshot] of fixture.snapshots) expect(second.snapshots.get(id)?.mapping?.semanticHash).toBe(snapshot.mapping?.semanticHash);
  });
});
