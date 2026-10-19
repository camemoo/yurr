"use client";

import { useEffect, useRef, useState } from "react";
import type { SongItem } from "@/lib/editor-store";
import { XIcon } from "./icons";

/** Modal editor for a song's library lyrics (the "pre-checked" copy projects pull in). */
export function LyricsDialog(props: { song: SongItem; onSave: (lyrics: string) => void; onClose: () => void }) {
  const { song } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(song.lyrics);
  const dirty = draft !== song.lyrics;
  const words = draft.split(/\s+/).filter(Boolean).length;

  // Native <dialog>: focus trapping, Esc to close and an inert background for free.
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      onClick={(e) => e.target === ref.current && props.onClose()} // backdrop click
      className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-2xl border border-zinc-800 bg-zinc-950 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <form
        method="dialog"
        onSubmit={() => {
          if (dirty) props.onSave(draft);
        }}
        className="flex flex-col gap-4 p-6"
      >
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">Edit lyrics</h2>
            <p className="mt-0.5 truncate text-sm text-zinc-500">{song.name}</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <XIcon className="size-5" />
          </button>
        </header>

        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={12}
          placeholder={song.transcript ? "" : "Transcription failed. Type the lyrics here (they'll show without word timing)."}
          className="min-h-64 resize-y rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 font-mono text-sm leading-relaxed outline-none transition placeholder:text-zinc-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
        />

        <p className="text-xs leading-relaxed text-zinc-500">
          {song.transcript
            ? "Fix misheard words freely: unchanged words keep their exact timing and corrected ones fill the gap around them. Projects using this song pick up the changes unless they've edited their own copy."
            : "No word timings for this song, so lyrics will show as static text."}
        </p>

        <footer className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="tabular-nums">{words} words</span>
            {song.transcript && draft !== song.transcript.text && (
              <button
                type="button"
                onClick={() => setDraft(song.transcript!.text)}
                className="font-medium text-zinc-400 hover:text-zinc-200"
              >
                Revert to transcript
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!dirty}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              Save lyrics
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
