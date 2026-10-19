"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration, type ChopperJob } from "@/lib/editor-store";
import { CheckIcon, XIcon } from "./icons";

/**
 * Grid of every clip the chopper found. Click (or Space/Enter) to toggle a
 * clip; only the selected ones are saved to the Clips library, the rest are
 * deleted from the server.
 */
export function ChopperReviewDialog(props: {
  job: ChopperJob;
  onSave: (keep: number[]) => void;
  onLater: () => void;
}) {
  const { job } = props;
  const candidates = job.candidates ?? [];
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const allSelected = selected.size === candidates.length;

  return (
    <dialog
      ref={ref}
      onClose={props.onLater}
      aria-labelledby="chopper-review-title"
      className="m-auto flex h-[min(88vh,960px)] w-[min(1180px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-5">
        <div className="min-w-0">
          <h2 id="chopper-review-title" className="text-lg font-semibold tracking-tight">
            Pick your clips
          </h2>
          <p className="mt-0.5 truncate text-sm text-zinc-500">
            {candidates.length} clips found in {job.name}. Hover to preview, click to select.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setSelected(allSelected ? new Set() : new Set(candidates.map((_, i) => i)))}
            className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800/60"
          >
            {allSelected ? "Clear selection" : "Select all"}
          </button>
          <button
            type="button"
            onClick={props.onLater}
            aria-label="Close (review later)"
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <XIcon className="size-5" />
          </button>
        </div>
      </header>

      <ul className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-6 sm:grid-cols-3 lg:grid-cols-4">
        {candidates.map((c, i) => {
          const on = selected.has(i);
          return (
            <li key={c.fileName}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`Clip ${i + 1} at ${formatDuration(c.response.start)}, ${c.response.length.toFixed(1)} seconds, ${c.response.reason}`}
                onClick={() => toggle(i)}
                onMouseEnter={(e) => e.currentTarget.querySelector("video")?.play().catch(() => {})}
                onMouseLeave={(e) => e.currentTarget.querySelector("video")?.pause()}
                className={`group relative block w-full overflow-hidden rounded-xl bg-black text-left outline-none transition focus-visible:ring-2 focus-visible:ring-violet-400 ${
                  on ? "ring-2 ring-violet-500 ring-offset-2 ring-offset-zinc-950" : "ring-1 ring-zinc-800 hover:ring-zinc-600"
                }`}
              >
                <video
                  src={`${c.broll.src}#t=${c.broll.centerOffset.toFixed(2)}`}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  className={`aspect-video w-full object-cover transition ${on ? "opacity-100" : "opacity-75 group-hover:opacity-100"}`}
                />
                <span
                  className={`absolute left-2 top-2 flex size-6 items-center justify-center rounded-full border-2 transition ${
                    on ? "border-violet-500 bg-violet-500 text-white" : "border-white/70 bg-black/40 text-transparent"
                  }`}
                >
                  <CheckIcon className="size-3.5" />
                </span>
                <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-300">
                  {c.response.reason}
                </span>
                <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-100">
                  {formatDuration(c.response.start)} · {c.response.length.toFixed(1)}s
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-6 py-4">
        <span className="text-sm text-zinc-400">
          <span className="font-semibold tabular-nums text-zinc-100">{selected.size}</span> of {candidates.length} selected
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => (confirmDiscard ? props.onSave([]) : setConfirmDiscard(true))}
            onBlur={() => setConfirmDiscard(false)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              confirmDiscard ? "bg-red-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-red-300"
            }`}
          >
            {confirmDiscard ? "Click again to discard all" : "Discard all"}
          </button>
          <button
            type="button"
            onClick={props.onLater}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Review later
          </button>
          <button
            type="button"
            onClick={() => props.onSave([...selected].sort((a, b) => a - b))}
            disabled={selected.size === 0}
            className="rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:brightness-110 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
          >
            Save Selected to Clips{selected.size ? ` (${selected.size})` : ""}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
