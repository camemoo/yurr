"use client";

import { VIDEO_EXTS, formatBytes, formatDuration, useEditor, type ClipItem } from "@/lib/editor-store";
import { DropZone } from "./DropZone";
import { CheckIcon, PlusIcon, TrashIcon } from "./icons";
import { PanelHeader } from "./PanelHeader";

function ClipCard({ clip }: { clip: ClipItem }) {
  const { activeProject, addClipsToProject, removeClipFromProject, removeClip } = useEditor();
  const order = activeProject?.clipIds.indexOf(clip.id) ?? -1;
  const inWorkspace = order >= 0;

  return (
    <li
      className={`group overflow-hidden rounded-xl border transition-colors animate-fade-in ${
        inWorkspace ? "border-violet-500/60 bg-violet-500/5" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
      }`}
    >
      <div className="relative aspect-video bg-black">
        {/* Poster frame: the clip's action peak if known, else 0.5s (skips a black first frame). Hover to play. */}
        <video
          src={`${clip.url}#t=${(clip.broll?.[0]?.centerOffset ?? 0.5).toFixed(2)}`}
          muted
          playsInline
          preload="metadata"
          className="size-full object-cover"
          onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()}
        />
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-200">
          {formatDuration(clip.duration)}
        </span>
        {inWorkspace && (
          <span className="absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-violet-600 text-xs font-semibold text-white shadow">
            {order + 1}
          </span>
        )}
        {clip.source === "chopper" ? (
          <span className="absolute right-2 top-2 rounded bg-fuchsia-500/25 px-1.5 py-0.5 text-[11px] font-medium text-fuchsia-200 backdrop-blur">
            Chopped
          </span>
        ) : clip.source === "stock" && !clip.broll ? (
          <span className="absolute right-2 top-2 rounded bg-sky-500/25 px-1.5 py-0.5 text-[11px] font-medium text-sky-200 backdrop-blur">
            Pixabay
          </span>
        ) : (
          clip.broll && (
            <span className="absolute right-2 top-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 backdrop-blur">
              {clip.broll.length} highlights
            </span>
          )
        )}
        <button
          type="button"
          onClick={() => removeClip(clip.id)}
          aria-label={`Remove ${clip.name}`}
          className="absolute bottom-2 left-2 rounded-md bg-black/70 p-1.5 text-zinc-300 opacity-0 transition hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
        >
          <TrashIcon className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{clip.name}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {clip.origin
              ? `from ${clip.origin.sourceName} @ ${formatDuration(clip.origin.start)} · ${clip.origin.reason}`
              : clip.credit
                ? `by ${clip.credit.author ?? "unknown"} on Pixabay · ${formatBytes(clip.size)}`
                : `${clip.width ? `${clip.width}×${clip.height} · ` : ""}${formatBytes(clip.size)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (inWorkspace ? removeClipFromProject(clip.id) : addClipsToProject([clip.id]))}
          className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
            inWorkspace
              ? "bg-violet-500/15 text-violet-300 hover:bg-red-500/15 hover:text-red-300"
              : "bg-violet-600 text-white hover:bg-violet-500"
          }`}
          title={
            inWorkspace
              ? `Remove from ${activeProject?.name}`
              : activeProject
                ? `Add to ${activeProject.name}`
                : "Creates a new project with this clip"
          }
        >
          {inWorkspace ? <CheckIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
          {inWorkspace ? "In Project" : activeProject ? "Add to Project" : "New Project"}
        </button>
      </div>
    </li>
  );
}

export function ClipsTab() {
  const { clipLibrary, addFiles } = useEditor();
  return (
    <div className="flex flex-col gap-6">
      <PanelHeader
        title="Clips"
        subtitle="Raw footage and chopped highlights. Add clips to a project to cut them to the beat."
        count={clipLibrary.length}
      />
      <DropZone
        title="Drag & drop raw video"
        hint="MP4, MOV, WEBM — or click to browse"
        accept={`video/*,${VIDEO_EXTS.join(",")}`}
        onFiles={(files) => addFiles(files, "clip").length}
        compact={clipLibrary.length > 0}
      />
      {clipLibrary.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {clipLibrary.map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
        </ul>
      )}
    </div>
  );
}
