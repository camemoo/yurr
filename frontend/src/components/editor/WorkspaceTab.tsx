"use client";

import { useRef } from "react";
import {
  BEATS_PER_CUT_OPTIONS,
  CAPTION_ANIMATIONS,
  DEFAULT_CAPTION_STYLE,
  FONT_FAMILIES,
  type CaptionAnimation,
  type FontFamilyKey,
} from "@/components/VideoComposition";
import {
  AUDIO_EXTS,
  VIDEO_EXTS,
  formatDuration,
  useEditor,
  type TaskState,
} from "@/lib/editor-store";
import { ColorField, Select, Slider, StepSlider } from "./controls";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FilmIcon,
  MusicIcon,
  SpinnerIcon,
  TypeIcon,
  UploadIcon,
  WandIcon,
  XIcon,
} from "./icons";
import { PanelHeader } from "./PanelHeader";
import type { TabKey } from "./Sidebar";

function Section(props: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{props.title}</h3>
        <div className="flex items-center gap-3">{props.aside}</div>
      </div>
      {props.children}
    </section>
  );
}

/** Small "upload here" button: adds files to the library *and* to the workspace. */
function MiniUpload(props: { label: string; accept: string; multiple?: boolean; onFiles: (files: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800/60 hover:text-white"
      >
        <UploadIcon className="size-3.5" />
        {props.label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={props.accept}
        multiple={props.multiple}
        className="hidden"
        onChange={(e) => {
          props.onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );
}

function EmptySlot(props: { icon: React.ReactNode; text: string; action: string; onClick: () => void }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-dashed border-zinc-800 p-4">
      <span className="flex size-10 items-center justify-center rounded-lg bg-zinc-900 text-zinc-600">
        {props.icon}
      </span>
      <p className="flex-1 text-sm text-zinc-500">{props.text}</p>
      <button
        type="button"
        onClick={props.onClick}
        className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
      >
        {props.action}
      </button>
    </div>
  );
}

function TaskRow({ label, task }: { label: string; task: TaskState }) {
  const icon = {
    running: <SpinnerIcon className="size-4 text-violet-400" />,
    done: <CheckIcon className="size-4 text-emerald-400" />,
    cached: <CheckIcon className="size-4 text-zinc-500" />,
    error: <XIcon className="size-4 text-red-400" />,
  }[task.status];
  const message = task.status === "cached" ? "already analyzed" : task.message;
  return (
    <li className="flex items-start gap-2.5 text-sm animate-fade-in">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="text-zinc-300">{label}</span>
        {message && (
          <span className={task.status === "error" ? "text-red-400" : "text-zinc-500"}> — {message}</span>
        )}
      </span>
    </li>
  );
}

const iconBtn =
  "rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent";

export function WorkspaceTab({ onNavigate }: { onNavigate: (tab: TabKey) => void }) {
  const {
    workspace,
    selectedSong,
    selectedClips,
    tasks,
    generating,
    addFiles,
    sendSongToWorkspace,
    addClipsToWorkspace,
    clearSong,
    removeClipFromWorkspace,
    moveClip,
    setLyrics,
    setCaptionStyle,
    setBeatsPerCut,
    generateMagicCut,
  } = useEditor();
  const style = workspace.captionStyle;

  const canGenerate = !!selectedSong && selectedClips.length > 0 && !generating;
  const allCached =
    !!selectedSong?.beats && !!selectedSong?.transcript && selectedClips.every((c) => c.broll);

  // Only tasks for what's in the workspace now, in workspace order.
  const taskEntries: [string, string, TaskState][] = [];
  if (selectedSong) {
    for (const [k, label] of [["beats", "Analyze beats"], ["lyrics", "Transcribe lyrics"]] as const) {
      const t = tasks[`${k}:${selectedSong.id}`];
      if (t) taskEntries.push([k, label, t]);
    }
  }
  for (const c of selectedClips) {
    const t = tasks[`broll:${c.id}`];
    if (t) taskEntries.push([c.id, `Extract B-roll · ${c.name}`, t]);
  }

  const beatSeconds =
    selectedSong?.beats && selectedSong.beats.tempo > 0 ? 60 / selectedSong.beats.tempo : null;
  const fmtBeats = (n: number) =>
    `${n} beat${n > 1 ? "s" : ""}${beatSeconds ? ` · ~${(n * beatSeconds).toFixed(1)}s per cut` : ""}`;

  return (
    <div className="flex flex-col gap-8">
      <PanelHeader title="Workspace" subtitle="Your active edit. The preview reflects exactly what's here." />

      {/* ------------------------------------------------ song */}
      <Section
        title="Song"
        aside={
          <MiniUpload
            label={selectedSong ? "Replace" : "Upload song"}
            accept={`audio/*,${AUDIO_EXTS.join(",")}`}
            onFiles={(files) => {
              const [id] = addFiles(files.slice(0, 1), "song");
              if (id) sendSongToWorkspace(id);
            }}
          />
        }
      >
        {selectedSong ? (
          <div className="flex items-center gap-4 rounded-xl border border-violet-500/40 bg-gradient-to-r from-violet-500/10 to-transparent p-4 animate-fade-in">
            <span className="flex size-11 items-center justify-center rounded-lg bg-violet-600/30 text-violet-200">
              <MusicIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-100">{selectedSong.name}</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                {formatDuration(selectedSong.beats?.duration ?? selectedSong.duration)}
                {selectedSong.beats &&
                  ` · ${Math.round(selectedSong.beats.tempo)} BPM · ${selectedSong.beats.beats.length} beats`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("songs")}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              Library
            </button>
            <button type="button" onClick={clearSong} aria-label="Remove song from workspace" className={iconBtn}>
              <XIcon className="size-4" />
            </button>
          </div>
        ) : (
          <EmptySlot
            icon={<MusicIcon className="size-5" />}
            text="No song selected. The song's beat drives every cut."
            action="Pick from library"
            onClick={() => onNavigate("songs")}
          />
        )}
      </Section>

      {/* ------------------------------------------------ clips */}
      <Section
        title={`Clips${selectedClips.length ? ` · ${selectedClips.length}` : ""}`}
        aside={
          <>
            {selectedClips.length > 0 && (
              <button
                type="button"
                onClick={() => onNavigate("clips")}
                className="text-xs font-medium text-violet-400 hover:text-violet-300"
              >
                + From library
              </button>
            )}
            <MiniUpload
              label="Upload clips"
              accept={`video/*,${VIDEO_EXTS.join(",")}`}
              multiple
              onFiles={(files) => addClipsToWorkspace(addFiles(files, "clip"))}
            />
          </>
        }
      >
        {selectedClips.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {selectedClips.map((clip, i) => (
              <li
                key={clip.id}
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-2 pr-3 animate-fade-in"
              >
                <span className="w-5 text-center text-xs font-semibold tabular-nums text-zinc-500">{i + 1}</span>
                <video
                  src={`${clip.url}#t=${(clip.broll?.[0]?.centerOffset ?? 0.5).toFixed(2)}`}
                  muted
                  preload="metadata"
                  className="h-12 w-20 shrink-0 rounded-md bg-black object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-200">{clip.name}</p>
                  <p className="text-xs text-zinc-500">
                    {formatDuration(clip.duration)}
                    {clip.source === "chopper" ? (
                      <span className="text-fuchsia-300"> · chopped highlight</span>
                    ) : (
                      clip.broll && <span className="text-emerald-400"> · {clip.broll.length} highlights</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center">
                  <button type="button" onClick={() => moveClip(clip.id, -1)} disabled={i === 0} aria-label="Move up" className={iconBtn}>
                    <ChevronUpIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveClip(clip.id, 1)}
                    disabled={i === selectedClips.length - 1}
                    aria-label="Move down"
                    className={iconBtn}
                  >
                    <ChevronDownIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeClipFromWorkspace(clip.id)}
                    aria-label={`Remove ${clip.name} from workspace`}
                    className={`ml-1 ${iconBtn} hover:text-red-400`}
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptySlot
            icon={<FilmIcon className="size-5" />}
            text="No clips yet. Highlights from these get cut on the beat."
            action="Browse library"
            onClick={() => onNavigate("clips")}
          />
        )}
      </Section>

      {/* ------------------------------------------------ magic cut + pacing */}
      <Section title="Magic Cut">
        <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <StepSlider
            label="Beats per Cut"
            options={BEATS_PER_CUT_OPTIONS}
            value={workspace.beatsPerCut}
            onChange={setBeatsPerCut}
            format={fmtBeats}
          />
          <button
            type="button"
            onClick={generateMagicCut}
            disabled={!canGenerate}
            className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
          >
            {generating ? <SpinnerIcon className="size-4" /> : <WandIcon className="size-4" />}
            {generating ? "Generating…" : allCached && selectedSong ? "Magic Cut is up to date" : "Generate Magic Cut"}
          </button>
          {!selectedSong || selectedClips.length === 0 ? (
            <p className="text-center text-xs text-zinc-500">Select a song and at least one clip to generate.</p>
          ) : (
            taskEntries.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {taskEntries.map(([key, label, task]) => (
                  <TaskRow key={key} task={task} label={label} />
                ))}
              </ul>
            )
          )}
        </div>
      </Section>

      {/* ------------------------------------------------ lyrics */}
      <Section
        title="Editable Lyrics"
        aside={
          selectedSong?.transcript && (
            <span className="text-xs text-zinc-500">{selectedSong.transcript.words.length} timed words</span>
          )
        }
      >
        <textarea
          id="lyrics"
          value={workspace.transcribedLyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder={
            selectedSong ? "Generate a Magic Cut to transcribe lyrics, or type them here…" : "Select a song first…"
          }
          rows={6}
          className="min-h-36 resize-y rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 font-mono text-sm leading-relaxed text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
        />
        {selectedSong?.transcript && (
          <p className="text-xs text-zinc-500">
            Edits keep their timing: unchanged words stay synced, new or corrected words fill the gap around them.
          </p>
        )}
      </Section>

      {/* ------------------------------------------------ text styling */}
      <Section
        title="Text Style"
        aside={
          <button
            type="button"
            onClick={() => setCaptionStyle(DEFAULT_CAPTION_STYLE)}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-300"
          >
            Reset
          </button>
        }
      >
        <div className="grid gap-5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:grid-cols-2">
          <Slider
            label="Font Size"
            min={40}
            max={180}
            step={2}
            value={style.fontSize}
            onChange={(fontSize) => setCaptionStyle({ fontSize })}
            format={(v) => `${v}px`}
          />
          <ColorField label="Text Color" value={style.color} onChange={(color) => setCaptionStyle({ color })} />
          <Select<FontFamilyKey>
            label="Font Family"
            value={style.fontFamily}
            onChange={(fontFamily) => setCaptionStyle({ fontFamily })}
            options={(Object.keys(FONT_FAMILIES) as FontFamilyKey[]).map((k) => ({
              value: k,
              label: FONT_FAMILIES[k].label,
              style: { fontFamily: FONT_FAMILIES[k].css },
            }))}
          />
          <Select<CaptionAnimation>
            label="Animation Style"
            value={style.animation}
            onChange={(animation) => setCaptionStyle({ animation })}
            options={(Object.keys(CAPTION_ANIMATIONS) as CaptionAnimation[]).map((k) => ({
              value: k,
              label: CAPTION_ANIMATIONS[k],
            }))}
          />
          {/* Live sample of the current style (the preview on the right shows it in context). */}
          <div className="flex items-center gap-3 rounded-lg bg-black/60 px-4 py-3 sm:col-span-2">
            <TypeIcon className="size-4 shrink-0 text-zinc-600" />
            <span
              className="truncate"
              style={{
                color: style.color,
                fontFamily: FONT_FAMILIES[style.fontFamily].css,
                fontWeight: style.fontFamily === "impact" ? 400 : 800,
                fontSize: Math.round(style.fontSize / 4),
                WebkitTextStroke: `${Math.max(1, Math.round(style.fontSize * 0.035))}px black`,
                paintOrder: "stroke fill",
              }}
            >
              We are dancing all night long
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}
