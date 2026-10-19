"use client";

import { useState } from "react";
import type { StockVideo } from "@/lib/api";
import { formatDuration, useEditor } from "@/lib/editor-store";
import { CheckIcon, DownloadIcon, PlayIcon, SearchIcon, SpinnerIcon } from "./icons";
import { PanelHeader } from "./PanelHeader";
import type { TabKey } from "./Sidebar";

const SUGGESTIONS = ["city at night", "concert crowd", "dancing", "neon lights", "ocean waves", "skateboard"];

function StockCard({ video, onNavigate }: { video: StockVideo; onNavigate: (tab: TabKey) => void }) {
  const { stockDownloads, downloadStockVideo, clipLibrary } = useEditor();
  const [hovered, setHovered] = useState(false);
  const dl = stockDownloads[video.id];
  // "Done" only while the downloaded clip is still in the library.
  const inLibrary = dl?.status === "done" && clipLibrary.some((c) => c.id === dl.clipId);
  const downloading = dl?.status === "downloading";
  const vertical = video.height > video.width;

  return (
    <li className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 transition hover:border-zinc-700 animate-fade-in">
      <div
        className="relative aspect-[4/5] bg-gradient-to-br from-zinc-800 to-zinc-900"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {video.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote Pixabay thumbnails; no image optimizer configured
          <img src={video.image} alt={video.tags} loading="lazy" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
            <PlayIcon className="size-8" />
          </div>
        )}
        {/* The (small) preview rendition only loads while hovered. */}
        {hovered && (
          <video
            src={video.preview_url}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-100">
          {formatDuration(video.duration)}
        </span>
        <span className="absolute left-2 top-2 flex gap-1">
          <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
            {video.download.width}×{video.download.height}
          </span>
          {vertical && (
            <span className="rounded bg-violet-600/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">Vertical</span>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-2.5 p-3">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
          {video.author_avatar && (
            // eslint-disable-next-line @next/next/no-img-element -- creator avatar from Pixabay
            <img src={video.author_avatar} alt="" className="size-4 shrink-0 rounded-full" />
          )}
          <span className="truncate">
            <a
              href={video.author_url ?? video.page_url}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-300 hover:text-white hover:underline"
            >
              {video.author ?? "Unknown"}
            </a>{" "}
            on{" "}
            <a href={video.page_url} target="_blank" rel="noreferrer" className="text-zinc-300 hover:underline">
              Pixabay
            </a>
          </span>
        </p>

        {inLibrary ? (
          <button
            type="button"
            onClick={() => onNavigate("clips")}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25"
          >
            <CheckIcon className="size-3.5" /> In Clip Library
          </button>
        ) : downloading ? (
          <div className="relative overflow-hidden rounded-lg bg-zinc-800 px-3 py-2 text-center text-xs font-medium text-zinc-200">
            <div
              className="absolute inset-y-0 left-0 bg-violet-600/60 transition-[width]"
              style={{ width: `${Math.round(dl.progress * 100)}%` }}
            />
            <span className="relative flex items-center justify-center gap-1.5 tabular-nums">
              <SpinnerIcon className="size-3.5" /> Downloading {Math.round(dl.progress * 100)}%
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => downloadStockVideo(video)}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-violet-500"
          >
            <DownloadIcon className="size-3.5" /> Download to Clip Library
          </button>
        )}
        {dl?.status === "error" && <p className="text-xs text-red-400">{dl.error}</p>}
      </div>
    </li>
  );
}

export function StockTab({ onNavigate }: { onNavigate: (tab: TabKey) => void }) {
  const { stock, runStockSearch } = useEditor();
  const [draft, setDraft] = useState(stock.query);

  const search = (q = draft) => {
    const query = q.trim();
    if (query) void runStockSearch(query);
  };

  return (
    <div className="flex flex-col gap-6">
      <PanelHeader
        title="Stock Footage"
        subtitle="Search free Pixabay videos and pull them straight into your clip library."
        count={stock.results.length || undefined}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20">
          <SearchIcon className="size-4 shrink-0 text-zinc-500" />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search videos, e.g. “city at night”"
            aria-label="Search stock videos"
            maxLength={100}
            className="h-11 w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </label>
        <button
          type="submit"
          disabled={!draft.trim() || (stock.loading && stock.page === 0)}
          className="h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          Search
        </button>
      </form>

      {stock.error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {stock.error}
        </div>
      )}

      {!stock.query && !stock.error && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">Try:</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setDraft(s);
                search(s);
              }}
              className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {stock.query && !stock.loading && !stock.error && stock.results.length === 0 && (
        <p className="text-sm text-zinc-500">No videos found for “{stock.query}”.</p>
      )}

      {stock.results.length > 0 && (
        <>
          <p className="-mb-2 text-xs text-zinc-500">
            {stock.total.toLocaleString()} results for “{stock.query}”. Hover a video to preview it. Most stock
            footage is horizontal; vertical clips are marked.
          </p>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {stock.results.map((v) => (
              <StockCard key={v.id} video={v} onNavigate={onNavigate} />
            ))}
          </ul>
        </>
      )}

      {stock.loading && (
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400">
          <SpinnerIcon className="size-4" /> Searching Pixabay…
        </p>
      )}

      {stock.hasMore && !stock.loading && (
        <button
          type="button"
          onClick={() => runStockSearch(stock.query, stock.page + 1)}
          className="self-center rounded-lg border border-zinc-800 px-5 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800/60"
        >
          Load more
        </button>
      )}

      <p className="text-center text-xs text-zinc-600">
        Videos provided by{" "}
        <a href="https://pixabay.com/" target="_blank" rel="noreferrer" className="text-zinc-400 hover:underline">
          Pixabay
        </a>
        . Free to use under the Pixabay Content License; crediting the creator is appreciated.
      </p>
    </div>
  );
}
