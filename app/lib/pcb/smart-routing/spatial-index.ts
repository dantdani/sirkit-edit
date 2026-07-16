import Flatbush from "flatbush";
import type { BBox, Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import type { RoutingWorldItem } from "./types";
import { bboxOfPoints, expandBBox } from "./geometry";

interface LayerTree {
  items: readonly RoutingWorldItem[];
  tree: Flatbush;
}
export class RoutingSpatialIndex {
  private readonly byLayer = new Map<LayerId, LayerTree>();

  constructor(items: readonly RoutingWorldItem[]) {
    const grouped = new Map<LayerId, RoutingWorldItem[]>();
    for (const item of items) {
      for (const layer of item.layers) {
        const values = grouped.get(layer) ?? [];
        values.push(item);
        grouped.set(layer, values);
      }
    }
    for (const [layer, values] of grouped) {
      values.sort((a, b) => a.id.localeCompare(b.id));
      if (!values.length) continue;
      const tree = new Flatbush(values.length);
      for (const item of values) {
        const box = item.bbox;
        tree.add(box.minX, box.minY, box.maxX, box.maxY);
      }
      tree.finish();
      this.byLayer.set(layer, { items: Object.freeze(values), tree });
    }
  }

  queryBox(layer: LayerId, box: BBox): RoutingWorldItem[] {
    const value = this.byLayer.get(layer);
    if (!value) return [];
    return value.tree
      .search(box.minX, box.minY, box.maxX, box.maxY)
      .map((index) => value.items[index])
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  queryPath(layer: LayerId, points: readonly Vec2[], inflationNm = 0): RoutingWorldItem[] {
    if (!points.length) return [];
    return this.queryBox(layer, expandBBox(bboxOfPoints(points), inflationNm));
  }
}
