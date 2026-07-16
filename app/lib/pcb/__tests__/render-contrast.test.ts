import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { COPPER_LAYERS, type LayerId } from "../layers";
import { BACKGROUND_COLOR, GRID_MAJOR_COLOR, GRID_MINOR_COLOR, layerColor } from "../render/colors";
import { renderCopper } from "../render/copper";

function luminance(color: number): number {
  const channel = (shift: number): number => {
    const value = ((color >> shift) & 0xff) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

function contrast(a: number, b: number): number {
  const bright = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (bright + 0.05) / (dark + 0.05);
}

describe("PCB render visibility", () => {
  it("keeps both copper colors distinct from the major grid", () => {
    expect(contrast(layerColor("copperTop"), GRID_MAJOR_COLOR)).toBeGreaterThan(3);
    expect(contrast(layerColor("copperBottom"), GRID_MAJOR_COLOR)).toBeGreaterThan(3);
    expect(contrast(GRID_MINOR_COLOR, BACKGROUND_COLOR)).toBeLessThan(1.5);
  });

  it("builds track/via graphics for every used copper target", () => {
    const board = buildRoutedDemo();
    const containers = new Map<LayerId | "holes", Container>();
    for (const layer of [...COPPER_LAYERS, "holes" as const]) containers.set(layer, new Container());
    const result = renderCopper(board, (layer) => containers.get(layer)!);
    expect(result.primitives).toBe(board.tracks.length + board.vias.length);
    expect(containers.get("copperTop")?.children.some((child) => child.label === "copper:copperTop")).toBe(true);
    expect(containers.get("copperBottom")?.children.some((child) => child.label === "copper:copperBottom")).toBe(true);
    expect(containers.get("holes")?.children.some((child) => child.label === "copper:holes")).toBe(true);
  });
});
