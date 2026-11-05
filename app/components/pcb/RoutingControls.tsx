"use client";

import type { PcbBoard, RoutingPreferences } from "@/app/lib/pcb/types";
import { routingPreferences } from "@/app/lib/pcb/routing-profile";
import type { RouteToolStatusView } from "./hooks/useRouteTool";

const WIDTH_PRESETS_NM = [150_000, 200_000, 250_000, 300_000, 400_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000] as const;

export function RoutingControls({
  board,
  onChange,
  status,
}: {
  board: PcbBoard;
  onChange(preferences: RoutingPreferences): void;
  status?: RouteToolStatusView | null;
}) {
  const preferences = routingPreferences(board);
  const widthValue =
    preferences.trackWidthMode === "net-class"
      ? "auto"
      : WIDTH_PRESETS_NM.includes(preferences.customTrackWidthNm as (typeof WIDTH_PRESETS_NM)[number])
        ? String(preferences.customTrackWidthNm)
        : "custom";

  const setWidth = (value: string): void => {
    if (value === "auto") {
      onChange({ ...preferences, trackWidthMode: "net-class" });
      return;
    }
    const width = value === "custom" ? preferences.customTrackWidthNm ?? 250_000 : Number(value);
    onChange({ ...preferences, trackWidthMode: "custom", customTrackWidthNm: width });
  };

  return (
    <section
      data-testid="routing-controls"
      className="absolute top-3 left-3 z-30 w-64 rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-sm"
    >
      <div className="px-3 py-2 border-b border-zinc-800">
        <p className="text-xs font-medium text-zinc-100">New route setup</p>
        <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">Captured when you click the starting pad.</p>
      </div>
      <div className="p-3 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block mb-1 text-[11px] text-zinc-400">Interaction</span>
            <select
              aria-label="Routing interaction mode"
              value={preferences.routeMode ?? "walk_around"}
              onChange={(event) => onChange({ ...preferences, routeMode: event.target.value as NonNullable<RoutingPreferences["routeMode"]> })}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-teal-500 focus:outline-none"
            >
              <option value="highlight_stop">Highlight</option>
              <option value="walk_around">Walk around</option>
              <option value="shove">Shove</option>
            </select>
          </label>
          <label className="block">
            <span className="block mb-1 text-[11px] text-zinc-400">Posture</span>
            <select
              aria-label="Routing posture"
              value={preferences.posture ?? "octilinear_a"}
              onChange={(event) => onChange({ ...preferences, posture: event.target.value as NonNullable<RoutingPreferences["posture"]> })}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-teal-500 focus:outline-none"
            >
              <option value="orthogonal">90°</option>
              <option value="octilinear_a">45° A</option>
              <option value="octilinear_b">45° B</option>
              <option value="arbitrary">Any angle</option>
            </select>
          </label>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2" data-testid="smart-route-status">
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className={`size-1.5 rounded-full ${
                status?.status === "blocked"
                  ? "bg-red-400"
                  : status?.status === "walking-around"
                    ? "bg-amber-400"
                    : "bg-teal-400"
              }`}
            />
            <span className="font-medium text-zinc-200">
              {!status
                ? "Smart Route ready"
                : status.status === "blocked"
                  ? "No legal path"
                  : status.mode === "walk-around"
                    ? "Walking around"
                    : "Direct route"}
            </span>
            {status && status.alternatives > 1 && (
              <span className="ml-auto text-zinc-500">{status.selected}/{status.alternatives} · Tab</span>
            )}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-zinc-500">
            {status?.explanation ?? "Click a pad, then move toward the destination. Existing copper stays fixed."}
          </p>
          {status && status.elapsedMs > 0 && (
            <p className="mt-1 text-[9px] text-zinc-600">Deterministic search {status.elapsedMs.toFixed(1)} ms</p>
          )}
        </div>
        <label className="block">
          <span className="block mb-1 text-[11px] text-zinc-400">Copper width</span>
          <select
            aria-label="New route copper width"
            value={widthValue}
            onChange={(event) => setWidth(event.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-teal-500 focus:outline-none"
          >
            <option value="auto">Auto — net class / AI rule</option>
            {WIDTH_PRESETS_NM.map((width) => (
              <option key={width} value={width}>{(width / 1e6).toFixed(2)} mm</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {preferences.trackWidthMode === "custom" && widthValue === "custom" && (
          <label className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-400">Exact</span>
            <input
              aria-label="Custom route width in millimeters"
              type="number"
              min={0.1}
              max={5}
              step={0.01}
              value={(preferences.customTrackWidthNm ?? 250_000) / 1e6}
              onChange={(event) => {
                const mm = Number(event.target.value);
                if (Number.isFinite(mm) && mm > 0) {
                  onChange({ ...preferences, trackWidthMode: "custom", customTrackWidthNm: Math.round(mm * 1e6) });
                }
              }}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-teal-500 focus:outline-none"
            />
            <span className="text-[10px] text-zinc-500">mm</span>
          </label>
        )}
        <label className="block">
          <span className="block mb-1 text-[11px] text-zinc-400">Via preset (V)</span>
          <select
            aria-label="New route via preset"
            value={preferences.viaMode === "padstack" && preferences.viaPadstackId ? preferences.viaPadstackId : "auto"}
            onChange={(event) =>
              onChange(
                event.target.value === "auto"
                  ? { ...preferences, viaMode: "net-class", viaPadstackId: undefined }
                  : { ...preferences, viaMode: "padstack", viaPadstackId: event.target.value },
              )
            }
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:border-teal-500 focus:outline-none"
          >
            <option value="auto">Auto — net class / AI rule</option>
            {(board.padstacks ?? []).map((padstack) => (
              <option key={padstack.id} value={padstack.id}>
                {padstack.name} · {(padstack.outerNm / 1e6).toFixed(2)}/{(padstack.drillNm / 1e6).toFixed(2)} mm
              </option>
            ))}
          </select>
        </label>
        <p className="text-[10px] leading-snug text-zinc-500">
          Existing tracks remain unchanged. Select one to edit its width in Properties.
        </p>
      </div>
    </section>
  );
}
