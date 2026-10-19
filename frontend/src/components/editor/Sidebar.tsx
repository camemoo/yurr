"use client";

import { useEditor } from "@/lib/editor-store";
import { FilmIcon, MusicIcon, ScissorsIcon, StockIcon, WandIcon } from "./icons";

export type TabKey = "songs" | "clips" | "chopper" | "stock" | "workspace";

export function Sidebar({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  const { songLibrary, clipLibrary, projects, generating, chopperJobs, chopping, stockDownloads } = useEditor();
  const transcribing = songLibrary.some((s) => s.transcription.status === "running");
  const stockDownloading = Object.values(stockDownloads).some((d) => d.status === "downloading");

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; badge?: number; dot?: boolean }[] = [
    {
      key: "songs",
      label: "Songs",
      icon: <MusicIcon className="size-5" />,
      badge: songLibrary.length,
      dot: transcribing,
    },
    { key: "clips", label: "Clips", icon: <FilmIcon className="size-5" />, badge: clipLibrary.length },
    {
      key: "chopper",
      label: "Video Chopper",
      icon: <ScissorsIcon className="size-5" />,
      // Waiting to run, or waiting for the user to pick clips.
      badge: chopperJobs.filter((j) => j.status === "pending" || j.status === "review").length,
      dot: chopping,
    },
    {
      key: "stock",
      label: "Stock Footage",
      icon: <StockIcon className="size-5" />,
      dot: stockDownloading,
    },
    {
      key: "workspace",
      label: "Workspace",
      icon: <WandIcon className="size-5" />,
      badge: projects.length,
      dot: generating,
    },
  ];

  return (
    <nav
      aria-label="Editor sections"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800/80 bg-zinc-950 px-3 py-2 lg:h-full lg:w-[84px] lg:flex-col lg:items-stretch lg:gap-2 lg:overflow-visible lg:border-b-0 lg:border-r lg:px-2 lg:py-4"
    >
      <div className="mr-2 hidden size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-sm font-black text-white shadow-lg shadow-violet-900/40 sm:flex lg:mx-auto lg:mb-4">
        F
      </div>
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors lg:flex-col lg:gap-1.5 lg:px-1 lg:py-3 ${
              isActive ? "bg-zinc-800/80 text-white" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            {isActive && (
              <span className="absolute inset-x-3 -bottom-2 h-0.5 rounded-full bg-violet-500 lg:inset-x-auto lg:inset-y-3 lg:-left-2 lg:bottom-auto lg:h-auto lg:w-0.5" />
            )}
            <span className="relative">
              {t.icon}
              {t.dot && <span className="absolute -right-1 -top-1 size-2 animate-pulse rounded-full bg-violet-400" />}
            </span>
            <span className="whitespace-nowrap lg:whitespace-normal lg:text-center lg:leading-tight">{t.label}</span>
            {!!t.badge && (
              <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] tabular-nums text-zinc-400 lg:absolute lg:right-1.5 lg:top-1.5 lg:bg-violet-600/80 lg:text-white">
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
