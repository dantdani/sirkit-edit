"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, RotateCcw, ZoomIn } from "lucide-react";
import { downsampleMinMax, interpolate } from "@/app/lib/spice/waveforms";
import type { WaveformSeries } from "@/app/lib/spice/types";
import { formatEngineering } from "@/app/lib/spice/units";

const COLORS = ["#2dd4bf", "#f59e0b", "#60a5fa", "#f472b6", "#a78bfa", "#84cc16", "#fb7185", "#22d3ee"];

interface CursorState {
  a?: number;
  b?: number;
  next: "a" | "b";
}

export interface SpiceWaveformPlotProps {
  series: WaveformSeries[];
  title?: string;
  height?: number;
  xScale?: "linear" | "log";
  onSignalFocus?: (name: string) => void;
}

function finiteBounds(series: WaveformSeries[]): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const xValues = series.flatMap((item) => [item.x[0], item.x.at(-1)]).filter((value): value is number => Number.isFinite(value));
  const yValues = series.flatMap((item) => item.y).filter(Number.isFinite);
  let xMin = Math.min(...xValues);
  let xMax = Math.max(...xValues);
  let yMin = Math.min(...yValues);
  let yMax = Math.max(...yValues);
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) { xMin = 0; xMax = 1; }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = -1; yMax = 1; }
  if (xMin === xMax) { xMin -= 0.5; xMax += 0.5; }
  if (yMin === yMax) { yMin -= Math.max(1, Math.abs(yMin) * 0.1); yMax += Math.max(1, Math.abs(yMax) * 0.1); }
  const yPad = (yMax - yMin) * 0.08;
  return { xMin, xMax, yMin: yMin - yPad, yMax: yMax + yPad };
}

function niceTicks(min: number, max: number, count = 6): number[] {
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) return [min];
  const rough = range / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const step = nice * power;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 1e-9 && ticks.length < 20; value += step) ticks.push(value);
  return ticks;
}

export function SpiceWaveformPlot({ series, title = "Waveforms", height = 320, xScale = "linear", onSignalFocus }: SpiceWaveformPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height });
  const dataBounds = useMemo(() => finiteBounds(series), [series]);
  const [view, setView] = useState(dataBounds);
  const [cursor, setCursor] = useState<CursorState>({ next: "a" });
  const dragRef = useRef<{ x: number; view: typeof view } | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setView(dataBounds));
    return () => cancelAnimationFrame(frame);
  }, [dataBounds]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(320, Math.floor(entry.contentRect.width)), height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

  const transformX = useCallback((value: number, left: number, width: number) => {
    if (xScale === "log") {
      const min = Math.log10(Math.max(view.xMin, 1e-30));
      const max = Math.log10(Math.max(view.xMax, 1e-30));
      return left + (Math.log10(Math.max(value, 1e-30)) - min) / Math.max(Number.EPSILON, max - min) * width;
    }
    return left + (value - view.xMin) / (view.xMax - view.xMin) * width;
  }, [view.xMin, view.xMax, xScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const width = size.width;
    const plotHeight = size.height;
    const margin = { left: 68, right: 18, top: 34, bottom: 38 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = plotHeight - margin.top - margin.bottom;
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, width, plotHeight);
    ctx.fillStyle = "#18181b";
    ctx.fillRect(margin.left, margin.top, innerWidth, innerHeight);
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#71717a";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const tick of niceTicks(view.yMin, view.yMax)) {
      const y = margin.top + innerHeight - (tick - view.yMin) / (view.yMax - view.yMin) * innerHeight;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + innerWidth, y); ctx.stroke();
      ctx.fillText(formatEngineering(tick, series[0]?.unit ?? "", 4), margin.left - 8, y);
    }
    const xTicks = xScale === "log"
      ? Array.from({ length: Math.max(1, Math.ceil(Math.log10(view.xMax) - Math.log10(Math.max(view.xMin, 1e-30))) + 1) }, (_, index) => 10 ** (Math.floor(Math.log10(Math.max(view.xMin, 1e-30))) + index))
      : niceTicks(view.xMin, view.xMax);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const tick of xTicks) {
      const x = transformX(tick, margin.left, innerWidth);
      if (x < margin.left - 1 || x > margin.left + innerWidth + 1) continue;
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + innerHeight); ctx.stroke();
      ctx.fillText(formatEngineering(tick, series[0]?.xUnit ?? "", 4), x, margin.top + innerHeight + 8);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(margin.left, margin.top, innerWidth, innerHeight); ctx.clip();
    series.forEach((item, seriesIndex) => {
      const visibleIndexes = item.x.reduce<number[]>((acc, value, index) => {
        if (value >= view.xMin && value <= view.xMax) acc.push(index);
        return acc;
      }, []);
      if (visibleIndexes.length < 2) return;
      const start = visibleIndexes[0];
      const end = visibleIndexes.at(-1)! + 1;
      const sampled = downsampleMinMax(item.x.slice(start, end), item.y.slice(start, end), Math.max(400, innerWidth * 2));
      ctx.strokeStyle = COLORS[seriesIndex % COLORS.length];
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      sampled.x.forEach((xValue, index) => {
        const x = transformX(xValue, margin.left, innerWidth);
        const y = margin.top + innerHeight - (sampled.y[index] - view.yMin) / (view.yMax - view.yMin) * innerHeight;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    for (const [label, value, color] of [["A", cursor.a, "#f59e0b"], ["B", cursor.b, "#f472b6"]] as const) {
      if (value === undefined || value < view.xMin || value > view.xMax) continue;
      const x = transformX(value, margin.left, innerWidth);
      ctx.strokeStyle = color; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + innerHeight); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.fillRect(x - 9, margin.top, 18, 16); ctx.fillStyle = "#09090b"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x, margin.top + 8);
    }
    ctx.restore();
    ctx.strokeStyle = "#3f3f46"; ctx.strokeRect(margin.left, margin.top, innerWidth, innerHeight);
    ctx.fillStyle = "#d4d4d8"; ctx.font = "600 12px system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(title, margin.left, 17);
  }, [cursor.a, cursor.b, series, size.height, size.width, title, transformX, view.xMax, view.xMin, view.yMax, view.yMin, xScale]);

  function canvasXToValue(clientX: number): number {
    const rect = canvasRef.current!.getBoundingClientRect();
    const left = 68;
    const width = rect.width - 68 - 18;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - left) / width));
    if (xScale === "log") {
      const logMin = Math.log10(Math.max(view.xMin, 1e-30));
      return 10 ** (logMin + ratio * (Math.log10(Math.max(view.xMax, 1e-30)) - logMin));
    }
    return view.xMin + ratio * (view.xMax - view.xMin);
  }

  function onWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const center = canvasXToValue(event.clientX);
    const factor = Math.exp(Math.sign(event.deltaY) * 0.18);
    const nextMin = center - (center - view.xMin) * factor;
    const nextMax = center + (view.xMax - center) * factor;
    if (nextMax - nextMin > (dataBounds.xMax - dataBounds.xMin) * 1e-8) setView((current) => ({ ...current, xMin: Math.max(dataBounds.xMin, nextMin), xMax: Math.min(dataBounds.xMax, nextMax) }));
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, view };
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const delta = (event.clientX - dragRef.current.x) / Math.max(1, rect.width - 86) * (dragRef.current.view.xMax - dragRef.current.view.xMin);
    const span = dragRef.current.view.xMax - dragRef.current.view.xMin;
    let xMin = dragRef.current.view.xMin - delta;
    xMin = Math.max(dataBounds.xMin, Math.min(dataBounds.xMax - span, xMin));
    setView((current) => ({ ...current, xMin, xMax: xMin + span }));
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const moved = dragRef.current ? Math.abs(event.clientX - dragRef.current.x) : 0;
    dragRef.current = null;
    if (moved < 3) {
      const value = canvasXToValue(event.clientX);
      setCursor((current) => current.next === "a" ? { ...current, a: value, next: "b" } : { ...current, b: value, next: "a" });
    }
  }

  const cursorRows = [cursor.a, cursor.b].map((value) => value === undefined ? null : series.map((item) => ({ name: item.name, value: interpolate(item.x, item.y, value), unit: item.unit })));
  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <canvas ref={canvasRef} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="block touch-none cursor-crosshair" />
      <div className="absolute right-2 top-2 flex items-center gap-1">
        <button title="Reset zoom" onClick={() => setView(dataBounds)} className="rounded border border-zinc-700 bg-zinc-900/90 p-1.5 text-zinc-400 hover:text-white"><RotateCcw className="size-3.5" /></button>
        <span className="rounded border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[10px] text-zinc-400"><ZoomIn className="mr-1 inline size-3" />wheel · drag · click cursors</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-800 px-3 py-2 text-[11px]">
        {series.map((item, index) => <button key={item.id} onClick={() => onSignalFocus?.(item.name)} className="flex items-center gap-1.5 text-zinc-300 hover:text-white"><span className="h-0.5 w-4" style={{ background: COLORS[index % COLORS.length] }} />{item.name}</button>)}
        {cursor.a !== undefined && cursor.b !== undefined && <span className="ml-auto text-zinc-400"><Crosshair className="mr-1 inline size-3" />Δx {formatEngineering(cursor.b - cursor.a, series[0]?.xUnit ?? "", 6)}</span>}
      </div>
      {(cursorRows[0] || cursorRows[1]) && <div className="grid grid-cols-2 gap-2 border-t border-zinc-800 bg-zinc-950/90 px-3 py-2 text-[10px] text-zinc-400">
        {cursorRows.map((rows, index) => <div key={index}>{rows && <><strong className={index === 0 ? "text-amber-400" : "text-pink-400"}>{index === 0 ? "A" : "B"} {formatEngineering(index === 0 ? cursor.a! : cursor.b!, series[0]?.xUnit ?? "", 6)}</strong>{rows.map((row) => <span key={row.name} className="ml-3">{row.name} {formatEngineering(row.value, row.unit, 5)}</span>)}</>}</div>)}
      </div>}
    </div>
  );
}
