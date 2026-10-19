"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { COMPOSITION_FPS, DEFAULT_DURATION_IN_FRAMES, cutBoundaries } from "@/components/VideoComposition";
import { formatDuration, interleaveBroll, useEditor } from "@/lib/editor-store";

const PreviewPlayer = dynamic(() => import("@/components/PreviewPlayer"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-zinc-900" />,
});

const EMPTY: never[] = [];

export function PreviewPanel() {
  const { workspace, selectedSong, selectedClips } = useEditor();

  // Stable references: the Player only re-renders the composition when these
  // actually change, so typing in other tabs never disturbs playback.
  const brollClips = useMemo(() => interleaveBroll(selectedClips), [selectedClips]);
  const beats = selectedSong?.beats?.beats ?? EMPTY;
  const words = selectedSong?.transcript?.words ?? EMPTY;
  const songSeconds = selectedSong?.beats?.duration ?? selectedSong?.duration ?? null;
  const durationInFrames = songSeconds
    ? Math.max(1, Math.round(songSeconds * COMPOSITION_FPS))
    : DEFAULT_DURATION_IN_FRAMES;

  const synced = beats.length > 0 && brollClips.length > 0;
  const cutCount = synced
    ? cutBoundaries(beats, workspace.beatsPerCut, durationInFrames, COMPOSITION_FPS).length - 1
    : 0;
  const mode = !selectedSong
    ? { label: "No song", tone: "bg-zinc-800 text-zinc-400" }
    : synced
      ? { label: "Beat-synced", tone: "bg-emerald-500/15 text-emerald-300" }
      : { label: "Rough preview", tone: "bg-amber-500/15 text-amber-300" };

  return (
    <aside className="flex shrink-0 flex-col gap-4 border-zinc-800/80 bg-zinc-950 p-4 lg:sticky lg:top-0 lg:h-screen lg:w-[380px] lg:border-l lg:p-6 xl:w-[440px]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Preview</h2>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${mode.tone}`}>{mode.label}</span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        {/* Width is derived from the available height (minus header + stats) so the
            box stays exactly 9:16 instead of letterboxing inside the panel. */}
        <div className="aspect-[9/16] w-[min(100%,calc(65vh*0.5625))] overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/60 ring-1 ring-zinc-800 lg:w-[min(100%,calc((100vh-11rem)*0.5625))]">
          <PreviewPlayer
            // A new song resets the playhead instead of keeping a position past its end.
            key={selectedSong?.id ?? "none"}
            durationInFrames={durationInFrames}
            lyrics={workspace.transcribedLyrics}
            words={words}
            beats={beats}
            beatsPerCut={workspace.beatsPerCut}
            brollClips={brollClips}
            captionStyle={workspace.captionStyle}
            audioSrc={selectedSong?.url ?? null}
            videoSrc={selectedClips[0]?.url ?? null}
          />
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Length", formatDuration(songSeconds)],
          ["Cuts", synced ? String(cutCount) : "—"],
          ["Highlights", brollClips.length ? String(brollClips.length) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-zinc-900/70 px-2 py-2">
            <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums text-zinc-200">{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
