"use client";

import type { PcbBoard } from "@/app/lib/pcb/types";
import {
  getBoardStackup,
  stackupProfile,
  type BoardStackup,
  type CopperLayer,
  type StackupProfileId,
} from "@/app/lib/pcb/stackup";
import type { AutorouteResult } from "./hooks/useAutoroute";
import type { AutorouteUnresolvedConnection } from "@/app/lib/pcb/autoroute/completion";

const PROFILES: Array<{ id: StackupProfileId; label: string }> = [
  { id: "simple-2", label: "Simple 2-layer" },
  { id: "signal-plane-4", label: "Signal / plane 4-layer" },
  { id: "all-signal-4", label: "All-signal 4-layer" },
  { id: "dense-4", label: "Dense 4-layer" },
];

export function AutorouteSetup({
  board,
  result,
  onChange,
  onFocusFailure,
}: {
  board: PcbBoard;
  result?: AutorouteResult;
  onChange: (stackup: BoardStackup, label: string) => void;
  onFocusFailure?: (failure: AutorouteUnresolvedConnection) => void;
}) {
  const stackup = getBoardStackup(board);
  const updateLayer = (id: CopperLayer["id"], patch: Partial<CopperLayer>): void => {
    onChange(
      {
        ...stackup,
        routing: { ...stackup.routing },
        copperLayers: stackup.copperLayers.map((layer) => (layer.id === id ? { ...layer, ...patch } : { ...layer })),
      },
      "Update routing layer",
    );
  };

  return (
    <details className="border-b border-zinc-800 px-3 py-2" open>
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Multilayer routing
      </summary>
      <label className="mt-2 block text-[10px] text-zinc-500">
        Stackup profile
        <select
          value={stackup.profileId}
          onChange={(event) => onChange(stackupProfile(event.target.value as StackupProfileId), "Set stackup profile")}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200"
        >
          {PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
        </select>
      </label>
      <div className="mt-2 space-y-2">
        {stackup.copperLayers.filter((layer) => layer.enabled).map((layer) => {
          const usage = result?.layerUsage[layer.id];
          return (
            <div key={layer.id} className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
              <div className="flex items-center justify-between text-[10px] text-zinc-300">
                <span>{layer.name}</span>
                <span className="text-zinc-600">{usage ? `${(usage.trackLengthNm / 1_000_000).toFixed(1)} mm` : "unused"}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <select
                  aria-label={`${layer.name} role`}
                  value={layer.role}
                  onChange={(event) => updateLayer(layer.id, {
                    role: event.target.value as CopperLayer["role"],
                    autorouteEnabled: event.target.value === "plane" ? false : layer.autorouteEnabled,
                  })}
                  className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300"
                >
                  <option value="signal">Signal</option>
                  <option value="plane">Plane</option>
                  <option value="mixed">Mixed</option>
                </select>
                <select
                  aria-label={`${layer.name} preferred direction`}
                  value={layer.preferredDirection}
                  disabled={layer.role === "plane"}
                  onChange={(event) => updateLayer(layer.id, { preferredDirection: event.target.value as CopperLayer["preferredDirection"] })}
                  className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300 disabled:opacity-40"
                >
                  <option value="horizontal">Horizontal</option>
                  <option value="vertical">Vertical</option>
                  <option value="any">Any</option>
                </select>
              </div>
              <label className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
                <input
                  type="checkbox"
                  checked={layer.autorouteEnabled}
                  disabled={layer.role === "plane"}
                  onChange={(event) => updateLayer(layer.id, { autorouteEnabled: event.target.checked })}
                />
                Autorouter may use this layer
              </label>
              {layer.role === "plane" && (
                <select
                  aria-label={`${layer.name} plane net`}
                  value={layer.planeNetId ?? ""}
                  onChange={(event) => updateLayer(layer.id, { planeNetId: event.target.value ? Number(event.target.value) : undefined })}
                  className="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300"
                >
                  <option value="">Choose plane net</option>
                  {board.nets.filter((net) => net.id !== 0).map((net) => <option key={net.id} value={net.id}>{net.name || `net${net.id}`}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
      {result && (
        <div className="mt-2 space-y-1.5 text-[10px]">
          <p className={result.status === "complete" ? "text-emerald-400" : "text-amber-400"}>
            {result.status === "complete" ? "Complete" : "Partial"}: {result.completedConnections}/{result.requiredConnections} connections · {result.acceptedPasses}/{result.passCount} improving passes
          </p>
          {result.failures.length > 0 && (
            <details className="rounded border border-amber-900/60 bg-amber-950/10 p-1.5">
              <summary className="cursor-pointer text-amber-300">{result.failures.length} unresolved connection{result.failures.length === 1 ? "" : "s"}</summary>
              <div className="mt-1 space-y-1">
                {result.failures.map((failure, index) => (
                  <button
                    type="button"
                    key={`${failure.netId}:${index}`}
                    onClick={() => onFocusFailure?.(failure)}
                    className="block w-full rounded border border-zinc-800 bg-zinc-950/70 p-1.5 text-left hover:border-amber-700"
                  >
                    <span className="block text-zinc-200">{failure.netName}: {failure.from ? `${failure.from.reference}.${failure.from.padNumber}` : "cluster"} → {failure.to ? `${failure.to.reference}.${failure.to.padNumber}` : "cluster"}</span>
                    <span className="block text-zinc-500">{failure.primaryBlockers[0]}</span>
                    <span className="block text-teal-500">{failure.suggestedRepair[0]}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </details>
  );
}
