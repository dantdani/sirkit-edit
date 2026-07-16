import type { BBox, Vec2 } from "../geometry";

export const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

export function expandBBox(box: BBox, amount: number): BBox {
  return {
    minX: box.minX - amount,
    minY: box.minY - amount,
    maxX: box.maxX + amount,
    maxY: box.maxY + amount,
  };
}
export function bboxOfPoints(points: readonly Vec2[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function bboxContainsPoint(box: BBox, point: Vec2): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}

export function isOctilinearSegment(a: Vec2, b: Vec2): boolean {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return dx === 0 || dy === 0 || dx === dy;
}

export function pathLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return total;
}

export function normalizePath(points: readonly Vec2[]): Vec2[] {
  const deduped: Vec2[] = [];
  for (const point of points) {
    const rounded = { x: Math.round(point.x), y: Math.round(point.y) };
    if (!deduped.length || !samePoint(deduped[deduped.length - 1], rounded)) deduped.push(rounded);
  }
  let changed = true;
  while (changed && deduped.length > 2) {
    changed = false;
    for (let i = 1; i + 1 < deduped.length; i++) {
      const a = deduped[i - 1];
      const b = deduped[i];
      const c = deduped[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = c.x - b.x;
      const bcy = c.y - b.y;
      if (abx * bcy === aby * bcx && abx * bcx + aby * bcy >= 0) {
        deduped.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return deduped;
}

/** Axis/45 connection matching the editor's established two-posture behavior. */
export function octilinearConnection(a: Vec2, b: Vec2, straightFirst: boolean): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === 0 || ady === 0 || adx === ady) return normalizePath([a, b]);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const m = Math.min(adx, ady);
  const corner = straightFirst
    ? adx >= ady
      ? { x: a.x + sx * (adx - m), y: a.y }
      : { x: a.x, y: a.y + sy * (ady - m) }
    : { x: a.x + sx * m, y: a.y + sy * m };
  return normalizePath([a, corner, b]);
}

/** Liang-Barsky clip against a one-nanometer inset: boundary travel is legal. */
export function segmentEntersBBoxInterior(a: Vec2, b: Vec2, box: BBox): boolean {
  const minX = box.minX + 1;
  const minY = box.minY + 1;
  const maxX = box.maxX - 1;
  const maxY = box.maxY - 1;
  if (minX > maxX || minY > maxY) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - minX, maxX - a.x, a.y - minY, maxY - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return t1 >= 0 && t0 <= 1;
}

export function pathEntersAnyBBox(points: readonly Vec2[], boxes: readonly BBox[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    for (const box of boxes) {
      if (segmentEntersBBoxInterior(points[i], points[i + 1], box)) return true;
    }
  }
  return false;
}

export function pathKey(points: readonly Vec2[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(";");
}
