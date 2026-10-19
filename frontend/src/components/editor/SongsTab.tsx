"use client";

import { useEffect, useRef, useState } from "react";
import { AUDIO_EXTS, formatBytes, formatDuration, useEditor } from "@/lib/editor-store";
import { DropZone } from "./DropZone";
import { CheckIcon, MusicIcon, PauseIcon, PlayIcon, TrashIcon } from "./icons";
import { PanelHeader } from "./PanelHeader";

export function SongsTab() {
  const { songLibrary, workspace, addFiles, removeSong, sendSongToWorkspace } = useEditor();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Stop previewing a song that's been removed.
  useEffect(() => {
    if (playingId && !songLibrary.some((s) => s.id === playingId)) {
      audioRef.current?.pause();
    }
  }, [songLibrary, playingId]);

  const togglePreview = (id: string, url: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === id) {
      audio.pause();
      return;
    }
    audio.src = url;
    audio.play().catch(() => setPlayingId(null));
    setPlayingId(id);
  };

  return (
    <div className="flex flex-col gap-6">
      <PanelHeader
        title="Songs"
        subtitle="Master tracks. Send one to the workspace to cut to its beat."
        count={songLibrary.length}
      />

      <DropZone
        title="Drag & drop master tracks"
        hint="WAV, MP3, M4A, FLAC — or click to browse"
        accept={`audio/*,${AUDIO_EXTS.join(",")}`}
        onFiles={(files) => addFiles(files, "song").length}
        compact={songLibrary.length > 0}
      />

      {songLibrary.length > 0 && (
        <ul className="flex flex-col gap-2">
          {songLibrary.map((song) => {
            const inWorkspace = workspace.selectedSongId === song.id;
            const playing = playingId === song.id;
            return (
              <li
                key={song.id}
                className={`group flex items-center gap-4 rounded-xl border p-3 pr-4 transition-colors animate-fade-in ${
                  inWorkspace
                    ? "border-violet-500/50 bg-violet-500/5"
                    : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                }`}
              >
                <button
                  type="button"
                  onClick={() => togglePreview(song.id, song.url)}
                  aria-label={playing ? `Pause ${song.name}` : `Preview ${song.name}`}
                  className="relative flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/30 to-fuchsia-600/20 text-violet-300 transition hover:from-violet-600/50"
                >
                  <MusicIcon className="size-5 transition-opacity group-hover:opacity-0" />
                  <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                    {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
                  </span>
                  {playing && <span className="absolute -right-1 -top-1 size-2.5 animate-pulse rounded-full bg-violet-400" />}
                </button>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">{song.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span>{formatDuration(song.duration)}</span>
                    <span>{formatBytes(song.size)}</span>
                    {song.beats && (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                        {Math.round(song.beats.tempo)} BPM
                      </span>
                    )}
                    {song.transcript && (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">Lyrics</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => sendSongToWorkspace(song.id)}
                  disabled={inWorkspace}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    inWorkspace
                      ? "cursor-default bg-violet-500/15 text-violet-300"
                      : "bg-violet-600 text-white hover:bg-violet-500"
                  }`}
                >
                  {inWorkspace ? (
                    <>
                      <CheckIcon className="size-3.5" /> In Workspace
                    </>
                  ) : (
                    "Send to Workspace"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => removeSong(song.id)}
                  aria-label={`Remove ${song.name}`}
                  className="rounded-lg p-1.5 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                >
                  <TrashIcon className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <audio ref={audioRef} onPause={() => setPlayingId(null)} onEnded={() => setPlayingId(null)} hidden />
    </div>
  );
}
