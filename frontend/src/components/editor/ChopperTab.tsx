"use client";

import { useEffect, useState } from "react";
import {
  VIDEO_EXTS,
  formatBytes,
  formatDuration,
  useEditor,
  type ChopperJob,
} from "@/lib/editor-store";
import { ChopperReviewDialog } from "./ChopperReviewDialog";
import { RangeSlider } from "./controls";
import { DropZone } from "./DropZone";
import { CheckIcon, PlusIcon, ScissorsIcon, SpinnerIcon, XIcon } from "./icons";
import { PanelHeader } from "./PanelHeader";
import type { TabKey } from "./Sidebar";

const fmtRange = ([lo, hi]: [number, number]) => (lo === hi ? `${lo}s` : `${lo}–${hi}s`);

/** Re-render every second while something is processing (for elapsed timers). */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function JobRow({ job, now, onReview }: { job: ChopperJob; now: number; onReview: () => void }) {
  const { clipLibrary, removeChopperJob, addClipsToProject, activeProject } = useEditor();
  const clips = (job.clipIds ?? [])
    .map((id) => clipLibrary.find((c) => c.id === id))
    .filter((c) => !!c);
  const allAdded = clips.length > 0 && !!activeProject && clips.every((c) => activeProject.clipIds.includes(c.id));

  const status = {
    pending: <span className="text-zinc-500">Queued</span>,
    processing: (
      <span className="flex items-center gap-1.5 text-violet-300">
        <SpinnerIcon className="size-3.5" />
        Scanning & cutting… {job.startedAt ? `${Math.round((now - job.startedAt) / 1000)}s` : ""}
      </span>
    ),
    review: <span className="text-amber-300">{job.message}, waiting for your pick</span>,
    done: (
      <span className="flex items-center gap-1 text-emerald-400">
        <CheckIcon className="size-3.5" /> {job.message}
      </span>
    ),
    error: <span className="text-red-400">{job.message}</span>,
  }[job.status];

  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400">
          <ScissorsIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{job.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
            <span className="text-zinc-500">{formatBytes(job.size)}</span>
            {status}
          </div>
        </div>
        {job.status === "done" && clips.length > 0 && (
          <button
            type="button"
            onClick={() => addClipsToProject(clips.map((c) => c.id))}
            disabled={allAdded}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:bg-violet-500/15 disabled:text-violet-300"
          >
            {allAdded ? <CheckIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
            {allAdded ? "In Project" : activeProject ? "Add all to Project" : "New Project from clips"}
          </button>
        )}
        {job.status === "review" && (
          <button
            type="button"
            onClick={onReview}
            className="shrink-0 rounded-lg bg-amber-500/90 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            Review {job.candidates?.length} clips
          </button>
        )}
        {/* A job under review owns cut files on the server; it's settled through the modal. */}
        {job.status !== "processing" && job.status !== "review" && (
          <button
            type="button"
            onClick={() => removeChopperJob(job.id)}
            aria-label={`Remove ${job.name} from queue`}
            className="rounded-lg p-1.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      {clips.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {clips.map((c) => (
            <li key={c.id} className="group relative overflow-hidden rounded-lg bg-black ring-1 ring-zinc-800">
              <video
                src={`${c.url}#t=${(c.broll?.[0]?.centerOffset ?? 0.5).toFixed(2)}`}
                muted
                playsInline
                preload="metadata"
                className="aspect-video w-full object-cover"
                onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                onMouseLeave={(e) => e.currentTarget.pause()}
              />
              <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] tabular-nums text-zinc-200">
                {c.origin ? `${formatDuration(c.origin.start)} · ${(c.origin.end - c.origin.start).toFixed(1)}s` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ChopperTab({ onNavigate }: { onNavigate: (tab: TabKey) => void }) {
  const {
    chopperJobs,
    chopping,
    addChopperFiles,
    processChopperQueue,
    clipLengthRange,
    setClipLengthRange,
    saveChopperSelection,
    setChopperReviewDismissed,
  } = useEditor();
  const now = useNow(chopping);
  const waiting = chopperJobs.filter((j) => j.status === "pending" || j.status === "error").length;
  const produced = chopperJobs.reduce((n, j) => n + (j.clipIds?.length ?? 0), 0);

  // The review modal opens by itself for each newly chopped video (unless the
  // user chose "review later"), or on demand from a job's "Review" button.
  const [manualReviewId, setManualReviewId] = useState<string | null>(null);
  const reviewJob =
    chopperJobs.find((j) => j.id === manualReviewId && j.status === "review") ??
    chopperJobs.find((j) => j.status === "review" && !j.reviewDismissed);

  return (
    <div className="flex flex-col gap-6">
      <PanelHeader
        title="Video Chopper"
        subtitle="Turn long raw footage into short highlight clips, cut around the action and faces."
        actions={
          produced > 0 && (
            <button
              type="button"
              onClick={() => onNavigate("clips")}
              className="text-sm font-medium text-violet-400 hover:text-violet-300"
            >
              View {produced} clips in library →
            </button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <DropZone
            title="Drag & drop long raw videos"
            hint="MP4, MOV, WEBM — every moment of action or faces gets cut, then you pick the keepers"
            accept={`video/*,${VIDEO_EXTS.join(",")}`}
            onFiles={addChopperFiles}
            compact={chopperJobs.length > 0}
          />
          {chopperJobs.length > 0 && (
            <ul className="flex flex-col gap-3">
              {chopperJobs.map((job) => (
                <JobRow key={job.id} job={job} now={now} onReview={() => setManualReviewId(job.id)} />
              ))}
            </ul>
          )}
        </div>

        <aside className="flex h-fit flex-col gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 lg:sticky lg:top-0">
          <RangeSlider
            label="Target Clip Length"
            min={2}
            max={15}
            step={0.5}
            value={clipLengthRange}
            onChange={setClipLengthRange}
            format={fmtRange}
            disabled={chopping}
          />
          <p className="-mt-2 text-xs leading-relaxed text-zinc-500">
            Within this range, each clip runs as long as its action does: short bursts get {clipLengthRange[0]}s,
            sustained action up to {clipLengthRange[1]}s. Drag both handles together for a fixed length.
          </p>
          <button
            type="button"
            onClick={processChopperQueue}
            disabled={chopping || waiting === 0}
            className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
          >
            {chopping ? <SpinnerIcon className="size-4" /> : <ScissorsIcon className="size-4" />}
            {chopping ? "Processing…" : waiting > 1 ? `Process ${waiting} Long Videos` : "Process Long Video"}
          </button>
          <p className="text-center text-xs text-zinc-500">
            {waiting === 0 && !chopping
              ? "Add a video to get started."
              : "When a video finishes you'll pick which clips go to your library."}
          </p>
        </aside>
      </div>

      {reviewJob && (
        <ChopperReviewDialog
          key={reviewJob.id}
          job={reviewJob}
          onSave={(keep) => {
            saveChopperSelection(reviewJob.id, keep);
            setManualReviewId(null);
          }}
          onLater={() => {
            setChopperReviewDismissed(reviewJob.id, true);
            setManualReviewId(null);
          }}
        />
      )}
    </div>
  );
}
