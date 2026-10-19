"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  API_BASE,
  analyzeBeats,
  discardBroll,
  downloadStock,
  extractBroll,
  searchStock,
  transcribe,
  type BeatsResponse,
  type BrollClipResponse,
  type StockVideo,
  type TimedWord,
} from "@/lib/api";
import {
  DEFAULT_CAPTION_STYLE,
  type BeatsPerCut,
  type BrollClip,
  type CaptionStyle,
} from "@/components/VideoComposition";

// ---------------------------------------------------------------- types

export type TranscriptionState = { status: "queued" | "running" | "done" | "error"; error?: string };

export type SongItem = {
  id: string;
  file: File;
  name: string;
  url: string; // object URL
  size: number;
  duration: number | null; // from audio metadata, before any analysis
  beats?: BeatsResponse;
  /** Whisper's output: the timing source for captions. */
  transcript?: { text: string; words: TimedWord[] };
  transcription: TranscriptionState;
  /** The checked lyrics text: starts as the transcript, editable in the library.
   *  Edited words keep their timing via alignment against `transcript.words`. */
  lyrics: string;
  lyricsEdited: boolean;
};

export type ClipItem = {
  id: string;
  /** "upload": the user's raw footage. "stock": downloaded from Pixabay.
   *  "chopper": a highlight cut by the backend (already a B-roll clip). */
  source: "upload" | "stock" | "chopper";
  /** Raw footage (upload/stock) keeps its File: it's sent for B-roll extraction. */
  file?: File;
  /** Attribution for stock footage. */
  credit?: { author: string | null; authorUrl: string | null; pageUrl: string };
  name: string;
  url: string; // object URL (upload) or backend URL (chopper)
  size: number | null;
  duration: number | null;
  width?: number;
  height?: number;
  /** Highlights to cut to. Chopped clips are their own single highlight. */
  broll?: BrollClip[];
  origin?: { sourceName: string; start: number; end: number; reason: string };
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  songId: string | null;
  clipIds: string[];
  /** null = use the song's library lyrics (and follow later fixes to them).
   *  A string = lyrics edited for this project only. */
  lyricsOverride: string | null;
  captionStyle: CaptionStyle;
  beatsPerCut: BeatsPerCut;
};

export type TaskState = { status: "running" | "done" | "error" | "cached"; message?: string };

/** A clip the chopper found, awaiting the user's keep/discard decision. */
export type ChopperCandidate = { response: BrollClipResponse; broll: BrollClip; fileName: string };

export type ChopperJob = {
  id: string;
  file: File;
  name: string;
  size: number;
  /** "review": clips are cut and waiting in the selection modal; nothing is in the library yet. */
  status: "pending" | "processing" | "review" | "done" | "error";
  message?: string;
  startedAt?: number;
  /** Backend job id (the folder the candidate clips live in). */
  backendJobId?: string;
  candidates?: ChopperCandidate[];
  /** The user closed the review modal without deciding ("review later"). */
  reviewDismissed?: boolean;
  clipIds?: string[];
};

export type StockSearchState = {
  query: string;
  results: StockVideo[];
  page: number;
  hasMore: boolean;
  total: number;
  loading: boolean;
  error: string | null;
};

export type StockDownload = { status: "downloading" | "done" | "error"; progress: number; clipId?: string; error?: string };

/** Seconds; shared by the Video Chopper and Magic Cut's B-roll extraction. */
export type ClipLengthRange = [number, number];

type State = {
  songLibrary: SongItem[];
  clipLibrary: ClipItem[];
  projects: Project[];
  activeProjectId: string | null;
};

type Action =
  | { type: "addSongs"; songs: SongItem[] }
  | { type: "addClips"; clips: ClipItem[] }
  | { type: "removeSong"; id: string }
  | { type: "removeClip"; id: string }
  | { type: "songMeta"; id: string; duration: number }
  | { type: "clipMeta"; id: string; duration: number; width: number; height: number }
  | { type: "transcription"; id: string; state: TranscriptionState }
  | { type: "songTranscript"; id: string; text: string; words: TimedWord[] }
  | { type: "setSongLyrics"; id: string; lyrics: string }
  | { type: "songBeats"; id: string; beats: BeatsResponse }
  | { type: "clipBroll"; id: string; broll: BrollClip[] }
  | { type: "createProject"; project: Project }
  | { type: "openProject"; id: string | null }
  | { type: "deleteProject"; id: string }
  | { type: "updateProject"; id: string; at: number; fn: (p: Project) => Project };

const initialState: State = { songLibrary: [], clipLibrary: [], projects: [], activeProjectId: null };

const patch = <T extends { id: string }>(items: T[], id: string, p: Partial<T>) =>
  items.map((it) => (it.id === id ? { ...it, ...p } : it));

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "addSongs":
      return { ...state, songLibrary: [...state.songLibrary, ...action.songs] };
    case "addClips":
      return { ...state, clipLibrary: [...state.clipLibrary, ...action.clips] };
    case "removeSong":
      return {
        ...state,
        songLibrary: state.songLibrary.filter((s) => s.id !== action.id),
        // Projects using it lose the song; an override (their own lyrics) is kept.
        projects: state.projects.map((p) => (p.songId === action.id ? { ...p, songId: null } : p)),
      };
    case "removeClip":
      return {
        ...state,
        clipLibrary: state.clipLibrary.filter((c) => c.id !== action.id),
        projects: state.projects.map((p) =>
          p.clipIds.includes(action.id) ? { ...p, clipIds: p.clipIds.filter((id) => id !== action.id) } : p,
        ),
      };
    case "songMeta":
      return { ...state, songLibrary: patch(state.songLibrary, action.id, { duration: action.duration }) };
    case "clipMeta": {
      const { id, duration, width, height } = action;
      return { ...state, clipLibrary: patch(state.clipLibrary, id, { duration, width, height }) };
    }
    case "transcription":
      return { ...state, songLibrary: patch(state.songLibrary, action.id, { transcription: action.state }) };
    case "songTranscript":
      return {
        ...state,
        songLibrary: state.songLibrary.map((s) =>
          s.id === action.id
            ? {
                ...s,
                transcript: { text: action.text, words: action.words },
                transcription: { status: "done" },
                // Never clobber lyrics the user already typed (e.g. after a failed run).
                lyrics: s.lyricsEdited ? s.lyrics : action.text,
              }
            : s,
        ),
      };
    case "setSongLyrics":
      return {
        ...state,
        songLibrary: patch(state.songLibrary, action.id, { lyrics: action.lyrics, lyricsEdited: true }),
      };
    case "songBeats":
      return { ...state, songLibrary: patch(state.songLibrary, action.id, { beats: action.beats }) };
    case "clipBroll":
      return { ...state, clipLibrary: patch(state.clipLibrary, action.id, { broll: action.broll }) };
    case "createProject":
      return { ...state, projects: [action.project, ...state.projects], activeProjectId: action.project.id };
    case "openProject":
      return { ...state, activeProjectId: action.id };
    case "deleteProject":
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.id),
        activeProjectId: state.activeProjectId === action.id ? null : state.activeProjectId,
      };
    case "updateProject":
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.id ? { ...action.fn(p), updatedAt: action.at } : p)),
      };
  }
}

// ---------------------------------------------------------------- helpers

const newId = () => crypto.randomUUID();

const isType = (f: File, kind: "audio" | "video", exts: string[]) =>
  f.type.startsWith(`${kind}/`) || exts.some((e) => f.name.toLowerCase().endsWith(e));

export const AUDIO_EXTS = [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"];
export const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".mkv"];
export const isVideoFile = (f: File) => isType(f, "video", VIDEO_EXTS);
const isAudioFile = (f: File) => isType(f, "audio", AUDIO_EXTS);

export const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");

/** Read duration (and size for video) without decoding the whole file. */
function readMediaMeta(url: string, kind: "audio" | "video") {
  return new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.onloadedmetadata = () =>
      resolve({
        duration: el.duration,
        width: (el as HTMLVideoElement).videoWidth ?? 0,
        height: (el as HTMLVideoElement).videoHeight ?? 0,
      });
    el.onerror = () => reject(new Error("unreadable media"));
    el.src = url;
  });
}

const toBroll = (c: BrollClipResponse): BrollClip => ({
  src: `${API_BASE}${c.url}`,
  length: c.end - c.start,
  centerOffset: c.center - c.start,
});

const rangeParam = ([lo, hi]: ClipLengthRange) => (lo === hi ? `${lo}` : `${lo}-${hi}`);

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Alternate between source videos so consecutive cuts come from different footage. */
export function interleaveBroll(clips: ClipItem[]): BrollClip[] {
  const lists = clips.map((c) => c.broll ?? []);
  const out: BrollClip[] = [];
  for (let r = 0; r < Math.max(0, ...lists.map((l) => l.length)); r++) {
    for (const l of lists) if (l[r]) out.push(l[r]);
  }
  return out;
}

/** The lyrics a project shows: its own edit, else the song's checked library lyrics. */
export const projectLyricsOf = (p: Project, song: SongItem | null | undefined) =>
  p.lyricsOverride ?? song?.lyrics ?? "";

// ---------------------------------------------------------------- context

type EditorContextValue = State & {
  activeProject: Project | null;
  selectedSong: SongItem | null;
  selectedClips: ClipItem[];
  projectLyrics: string;
  tasks: Record<string, TaskState>;
  generating: boolean;
  chopperJobs: ChopperJob[];
  chopping: boolean;
  clipLengthRange: ClipLengthRange;
  setClipLengthRange: (r: ClipLengthRange) => void;

  // library
  /** Adds accepted files to the library (songs start transcribing); returns new ids.
   *  `priority` puts new songs at the front of the transcription queue. */
  addFiles: (files: File[], kind: "song" | "clip", opts?: { priority?: boolean }) => string[];
  removeSong: (id: string) => void;
  removeClip: (id: string) => void;
  setSongLyrics: (id: string, lyrics: string) => void;
  retryTranscription: (id: string) => void;

  // projects
  createProject: (init?: { name?: string; songId?: string; clipIds?: string[] }) => string;
  openProject: (id: string | null) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  /** These act on the active project, creating one first if none is open. */
  setProjectSong: (songId: string) => void;
  addClipsToProject: (ids: string[]) => void;
  clearProjectSong: () => void;
  removeClipFromProject: (id: string) => void;
  moveClip: (id: string, delta: -1 | 1) => void;
  setProjectLyrics: (lyrics: string) => void;
  resetProjectLyrics: () => void;
  setCaptionStyle: (style: Partial<CaptionStyle>) => void;
  setBeatsPerCut: (n: BeatsPerCut) => void;
  generateMagicCut: () => Promise<void>;

  // stock footage
  stock: StockSearchState;
  stockDownloads: Record<number, StockDownload>;
  runStockSearch: (query: string, page?: number) => Promise<void>;
  downloadStockVideo: (video: StockVideo) => Promise<void>;

  // chopper
  saveChopperSelection: (jobId: string, keep: number[]) => void;
  /** "Review later": close the selection modal without deciding. */
  setChopperReviewDismissed: (jobId: string, dismissed: boolean) => void;
  addChopperFiles: (files: File[]) => number;
  removeChopperJob: (id: string) => void;
  processChopperQueue: () => Promise<void>;
};

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside <EditorProvider>");
  return ctx;
}

/** Resolves with the transcript's word count once a queued song is transcribed. */
type Waiter = { promise: Promise<number>; resolve: (words: number) => void; reject: (e: unknown) => void };

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const [generating, setGenerating] = useState(false);
  const [chopperJobs, setChopperJobs] = useState<ChopperJob[]>([]);
  const [chopping, setChopping] = useState(false);
  const [clipLengthRange, setClipLengthRange] = useState<ClipLengthRange>([5, 7]);

  // Latest values for async callbacks.
  const stateRef = useRef(state);
  const jobsRef = useRef(chopperJobs);
  const rangeRef = useRef(clipLengthRange);
  useEffect(() => {
    stateRef.current = state;
    jobsRef.current = chopperJobs;
    rangeRef.current = clipLengthRange;
  }, [state, chopperJobs, clipLengthRange]);

  // Revoke object URLs only after a removal has been committed, so no <video>
  // or <audio> still pointing at one tries to reload it mid-unmount.
  // (Chopped clips use backend URLs, which need no cleanup.)
  const liveUrls = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(
      [...state.songLibrary, ...state.clipLibrary].map((it) => it.url).filter((u) => u.startsWith("blob:")),
    );
    for (const url of liveUrls.current) if (!now.has(url)) URL.revokeObjectURL(url);
    liveUrls.current = now;
  }, [state.songLibrary, state.clipLibrary]);
  useEffect(() => () => liveUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const loadMeta = useCallback((id: string, url: string, kind: "song" | "clip") => {
    readMediaMeta(url, kind === "song" ? "audio" : "video")
      .then((m) =>
        kind === "song"
          ? dispatch({ type: "songMeta", id, duration: m.duration })
          : dispatch({ type: "clipMeta", id, ...m }),
      )
      .catch(() => {}); // unknown codec: the item just shows no duration
  }, []);

  // ---------------------------------------------------------------- transcription queue
  // Whisper is heavy on the backend, so songs are transcribed one at a time.
  // Files are kept here (not read from state) so a song can be queued in the
  // same tick it's added, before React has committed it.

  const songFiles = useRef(new Map<string, File>());
  const queue = useRef<string[]>([]);
  const running = useRef<string | null>(null);
  const waiters = useRef(new Map<string, Waiter>());

  const pump = useCallback(async () => {
    if (running.current) return;
    while (queue.current.length) {
      const id = queue.current.shift()!;
      const file = songFiles.current.get(id);
      if (!file) continue; // removed while queued
      running.current = id;
      dispatch({ type: "transcription", id, state: { status: "running" } });
      try {
        const r = await transcribe(file);
        dispatch({ type: "songTranscript", id, text: r.text, words: r.words });
        waiters.current.get(id)?.resolve(r.words.length);
      } catch (e) {
        dispatch({ type: "transcription", id, state: { status: "error", error: errorText(e) } });
        waiters.current.get(id)?.reject(e);
      }
      waiters.current.delete(id);
      running.current = null;
    }
  }, []);

  const enqueue = useCallback(
    (ids: string[], priority = false) => {
      for (const id of ids) {
        queue.current = queue.current.filter((q) => q !== id);
        dispatch({ type: "transcription", id, state: { status: "queued" } });
      }
      queue.current = priority ? [...ids, ...queue.current] : [...queue.current, ...ids];
      void pump();
    },
    [pump],
  );

  /** Resolves once the song has a transcript; jumps it to the front of the queue. */
  const ensureTranscribed = useCallback(
    (id: string) => {
      const song = stateRef.current.songLibrary.find((s) => s.id === id);
      if (song?.transcription.status === "done") return Promise.resolve(song.transcript?.words.length ?? 0);
      let w = waiters.current.get(id);
      if (!w) {
        let resolve!: (words: number) => void, reject!: (e: unknown) => void;
        const promise = new Promise<number>((res, rej) => ((resolve = res), (reject = rej)));
        w = { promise, resolve, reject };
        waiters.current.set(id, w);
      }
      if (running.current !== id) enqueue([id], true);
      return w.promise;
    },
    [enqueue],
  );

  // ---------------------------------------------------------------- library

  const addFiles = useCallback(
    (files: File[], kind: "song" | "clip", opts?: { priority?: boolean }) => {
      const accepted = files.filter(kind === "song" ? isAudioFile : isVideoFile);
      const base = accepted.map((file) => ({
        id: newId(),
        file,
        name: file.name,
        url: URL.createObjectURL(file),
        size: file.size,
        duration: null,
      }));
      if (kind === "song") {
        dispatch({
          type: "addSongs",
          songs: base.map((s) => ({
            ...s,
            transcription: { status: "queued" as const },
            lyrics: "",
            lyricsEdited: false,
          })),
        });
        for (const s of base) songFiles.current.set(s.id, s.file);
        enqueue(base.map((s) => s.id), opts?.priority);
      } else {
        dispatch({ type: "addClips", clips: base.map((c) => ({ ...c, source: "upload" as const })) });
      }
      for (const it of base) loadMeta(it.id, it.url, kind);
      return base.map((it) => it.id);
    },
    [enqueue, loadMeta],
  );

  const removeSong = useCallback((id: string) => {
    songFiles.current.delete(id);
    queue.current = queue.current.filter((q) => q !== id);
    dispatch({ type: "removeSong", id });
  }, []);

  // ---------------------------------------------------------------- projects

  const createProject = useCallback((init?: { name?: string; songId?: string; clipIds?: string[] }) => {
    const now = Date.now();
    const n = stateRef.current.projects.length + 1;
    const song = init?.songId && stateRef.current.songLibrary.find((s) => s.id === init.songId);
    const project: Project = {
      id: newId(),
      name: init?.name ?? (song ? stripExt(song.name) : `Untitled project ${n}`),
      createdAt: now,
      updatedAt: now,
      songId: init?.songId ?? null,
      clipIds: init?.clipIds ?? [],
      lyricsOverride: null,
      captionStyle: DEFAULT_CAPTION_STYLE,
      beatsPerCut: 1,
    };
    dispatch({ type: "createProject", project });
    stateRef.current = reducer(stateRef.current, { type: "createProject", project }); // for same-tick follow-ups
    return project.id;
  }, []);

  const update = useCallback((fn: (p: Project) => Project) => {
    const id = stateRef.current.activeProjectId;
    if (id) dispatch({ type: "updateProject", id, at: Date.now(), fn });
  }, []);

  const setProjectSong = useCallback(
    (songId: string) => {
      if (!stateRef.current.activeProjectId) {
        createProject({ songId });
        return;
      }
      // Switching songs drops the old song's project-specific lyric edits:
      // the new song brings its own pre-checked lyrics.
      update((p) => (p.songId === songId ? p : { ...p, songId, lyricsOverride: null }));
    },
    [createProject, update],
  );

  const addClipsToProject = useCallback(
    (ids: string[]) => {
      if (!stateRef.current.activeProjectId) {
        createProject({ clipIds: ids });
        return;
      }
      update((p) => {
        const fresh = ids.filter((id) => !p.clipIds.includes(id));
        return fresh.length ? { ...p, clipIds: [...p.clipIds, ...fresh] } : p;
      });
    },
    [createProject, update],
  );

  const moveClip = useCallback(
    (id: string, delta: -1 | 1) =>
      update((p) => {
        const ids = [...p.clipIds];
        const i = ids.indexOf(id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= ids.length) return p;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        return { ...p, clipIds: ids };
      }),
    [update],
  );

  // ---------------------------------------------------------------- magic cut

  const setTask = useCallback(
    (key: string, t: TaskState) => setTasks((prev) => ({ ...prev, [key]: t })),
    [],
  );

  const generateMagicCut = useCallback(async () => {
    const { songLibrary, clipLibrary, projects, activeProjectId } = stateRef.current;
    const project = projects.find((p) => p.id === activeProjectId);
    const song = songLibrary.find((s) => s.id === project?.songId);
    const clips = (project?.clipIds ?? [])
      .map((id) => clipLibrary.find((c) => c.id === id))
      .filter((c): c is ClipItem => !!c);
    if (!song || clips.length === 0) return;
    // Chopped clips are already highlights; only raw footage (uploads, stock) needs extraction.
    const rawClips = clips.filter((c) => !!c.file);

    setGenerating(true);
    // Results are cached on library items, so only missing analyses hit the backend.
    setTasks({
      [`beats:${song.id}`]: song.beats ? { status: "cached" } : { status: "running" },
      [`lyrics:${song.id}`]: song.transcription.status === "done" ? { status: "cached" } : { status: "running" },
      ...Object.fromEntries(
        rawClips.map((c) => [`broll:${c.id}`, c.broll ? { status: "cached" } : { status: "running" }]),
      ),
    });

    const run = async (key: string, job: () => Promise<string>) => {
      try {
        setTask(key, { status: "done", message: await job() });
      } catch (e) {
        setTask(key, { status: "error", message: errorText(e) });
      }
    };

    const jobs: Promise<void>[] = [];
    if (!song.beats) {
      jobs.push(
        run(`beats:${song.id}`, async () => {
          const r = await analyzeBeats(song.file);
          dispatch({ type: "songBeats", id: song.id, beats: r });
          return `${r.beats.length} beats · ${Math.round(r.tempo)} BPM`;
        }),
      );
    }
    if (song.transcription.status !== "done") {
      // Usually already transcribed at upload; otherwise wait for (and prioritise) it.
      jobs.push(
        run(`lyrics:${song.id}`, async () => {
          const words = await ensureTranscribed(song.id);
          return words ? `${words} words` : "no vocals detected";
        }),
      );
    }
    // B-roll extraction is CPU-heavy on the server; one source video at a time.
    jobs.push(
      (async () => {
        for (const clip of rawClips.filter((c) => !c.broll && c.file)) {
          await run(`broll:${clip.id}`, async () => {
            const r = await extractBroll(clip.file!, rangeParam(rangeRef.current));
            dispatch({ type: "clipBroll", id: clip.id, broll: r.clips.map(toBroll) });
            return `${r.clips.length} highlights`;
          });
        }
      })(),
    );

    await Promise.all(jobs);
    setGenerating(false);
  }, [ensureTranscribed, setTask]);

  // ---------------------------------------------------------------- video chopper

  const addChopperFiles = useCallback((files: File[]) => {
    const accepted = files.filter(isVideoFile);
    setChopperJobs((prev) => [
      ...prev,
      ...accepted.map((file) => ({ id: newId(), file, name: file.name, size: file.size, status: "pending" as const })),
    ]);
    return accepted.length;
  }, []);

  const removeChopperJob = useCallback(
    (id: string) => setChopperJobs((prev) => prev.filter((j) => j.id !== id || j.status === "processing")),
    [],
  );

  const updateJob = useCallback(
    (id: string, p: Partial<ChopperJob>) => setChopperJobs((prev) => patch(prev, id, p)),
    [],
  );

  const processChopperQueue = useCallback(async () => {
    setChopping(true);
    // Re-read the queue after each job so files added mid-run are processed too.
    for (;;) {
      const job = jobsRef.current.find((j) => j.status === "pending" || j.status === "error");
      if (!job) break;
      updateJob(job.id, { status: "processing", startedAt: Date.now(), message: undefined });
      jobsRef.current = patch(jobsRef.current, job.id, { status: "processing" });
      try {
        const r = await extractBroll(job.file, rangeParam(rangeRef.current));
        // Nothing goes into the library yet: the user picks which clips to keep.
        const candidates: ChopperCandidate[] = r.clips.map((c) => ({
          response: c,
          broll: toBroll(c),
          fileName: c.url.split("/").pop()!,
        }));
        const result: Partial<ChopperJob> = candidates.length
          ? { status: "review", backendJobId: r.job_id, candidates, message: `${candidates.length} clips found` }
          : { status: "done", clipIds: [], message: "No action or faces found" };
        updateJob(job.id, result);
        jobsRef.current = patch(jobsRef.current, job.id, result);
      } catch (e) {
        updateJob(job.id, { status: "error", message: errorText(e) });
        jobsRef.current = patch(jobsRef.current, job.id, { status: "error" });
        break; // don't hammer a backend that's down; the user can retry
      }
    }
    setChopping(false);
  }, [updateJob]);

  /** Keep the chosen candidates (by index) as library clips; delete the rest on the server. */
  const saveChopperSelection = useCallback(
    (jobId: string, keep: number[]) => {
      const job = jobsRef.current.find((j) => j.id === jobId);
      if (!job?.candidates) return;
      const keepSet = new Set(keep);
      const stem = stripExt(job.name);
      const clips: ClipItem[] = job.candidates
        .map((cand, i) => ({ cand, i }))
        .filter(({ i }) => keepSet.has(i))
        .map(({ cand, i }) => ({
          id: newId(),
          source: "chopper",
          name: `${stem} · cut ${i + 1}`,
          url: cand.broll.src,
          size: cand.response.size ?? null,
          duration: cand.response.end - cand.response.start,
          broll: [cand.broll],
          origin: {
            sourceName: job.name,
            start: cand.response.start,
            end: cand.response.end,
            reason: cand.response.reason,
          },
        }));
      if (clips.length) dispatch({ type: "addClips", clips });
      for (const c of clips) loadMeta(c.id, c.url, "clip");
      if (job.backendJobId) {
        void discardBroll(
          job.backendJobId,
          job.candidates.filter((_, i) => !keepSet.has(i)).map((c) => c.fileName),
        );
      }
      const done: Partial<ChopperJob> = {
        status: "done",
        clipIds: clips.map((c) => c.id),
        candidates: undefined,
        message: `${clips.length} of ${job.candidates.length} clips saved`,
      };
      updateJob(job.id, done);
      jobsRef.current = patch(jobsRef.current, job.id, done);
    },
    [loadMeta, updateJob],
  );

  // ---------------------------------------------------------------- stock footage

  const [stock, setStock] = useState<StockSearchState>({
    query: "",
    results: [],
    page: 0,
    hasMore: false,
    total: 0,
    loading: false,
    error: null,
  });
  const [stockDownloads, setStockDownloads] = useState<Record<number, StockDownload>>({});
  const stockReq = useRef(0); // ignore responses from superseded searches

  const runStockSearch = useCallback(async (query: string, page = 1) => {
    const req = ++stockReq.current;
    setStock((s) => ({ ...s, query, loading: true, error: null, ...(page === 1 ? { results: [] } : {}) }));
    try {
      const r = await searchStock(query, page);
      if (req !== stockReq.current) return;
      setStock((s) => ({
        ...s,
        results: page === 1 ? r.videos : [...s.results, ...r.videos.filter((v) => !s.results.some((x) => x.id === v.id))],
        page,
        hasMore: r.has_more,
        total: r.total_results,
        loading: false,
      }));
    } catch (e) {
      if (req !== stockReq.current) return;
      setStock((s) => ({ ...s, loading: false, error: errorText(e) }));
    }
  }, []);

  const downloadStockVideo = useCallback(
    async (video: StockVideo) => {
      const set = (d: StockDownload) => setStockDownloads((prev) => ({ ...prev, [video.id]: d }));
      set({ status: "downloading", progress: 0 });
      let last = 0;
      try {
        const file = await downloadStock(video, (p) => {
          if (p - last >= 0.02 || p === 1) {
            last = p;
            set({ status: "downloading", progress: p });
          }
        });
        const clip: ClipItem = {
          id: newId(),
          source: "stock",
          file,
          name: `${video.author ?? "Pixabay"} · ${video.id}`,
          url: URL.createObjectURL(file),
          size: file.size,
          duration: video.duration,
          width: video.download.width,
          height: video.download.height,
          credit: { author: video.author, authorUrl: video.author_url, pageUrl: video.page_url },
        };
        dispatch({ type: "addClips", clips: [clip] });
        loadMeta(clip.id, clip.url, "clip");
        set({ status: "done", progress: 1, clipId: clip.id });
      } catch (e) {
        set({ status: "error", progress: 0, error: errorText(e) });
      }
    },
    [loadMeta],
  );

  // ---------------------------------------------------------------- derived

  const activeProject = useMemo(
    () => state.projects.find((p) => p.id === state.activeProjectId) ?? null,
    [state.projects, state.activeProjectId],
  );
  const selectedSong = useMemo(
    () => state.songLibrary.find((s) => s.id === activeProject?.songId) ?? null,
    [state.songLibrary, activeProject?.songId],
  );
  const selectedClips = useMemo(
    () =>
      (activeProject?.clipIds ?? [])
        .map((id) => state.clipLibrary.find((c) => c.id === id))
        .filter((c): c is ClipItem => !!c),
    [state.clipLibrary, activeProject?.clipIds],
  );
  const projectLyrics = activeProject ? projectLyricsOf(activeProject, selectedSong) : "";

  const value: EditorContextValue = {
    ...state,
    activeProject,
    selectedSong,
    selectedClips,
    projectLyrics,
    tasks,
    generating,
    chopperJobs,
    chopping,
    clipLengthRange,
    setClipLengthRange,

    addFiles,
    removeSong,
    removeClip: useCallback((id) => dispatch({ type: "removeClip", id }), []),
    setSongLyrics: useCallback((id, lyrics) => dispatch({ type: "setSongLyrics", id, lyrics }), []),
    retryTranscription: useCallback((id) => enqueue([id], true), [enqueue]),

    createProject,
    openProject: useCallback((id) => dispatch({ type: "openProject", id }), []),
    renameProject: useCallback(
      (id, name) => dispatch({ type: "updateProject", id, at: Date.now(), fn: (p) => ({ ...p, name }) }),
      [],
    ),
    deleteProject: useCallback((id) => dispatch({ type: "deleteProject", id }), []),
    setProjectSong,
    addClipsToProject,
    clearProjectSong: useCallback(() => update((p) => ({ ...p, songId: null, lyricsOverride: null })), [update]),
    removeClipFromProject: useCallback(
      (id) => update((p) => ({ ...p, clipIds: p.clipIds.filter((c) => c !== id) })),
      [update],
    ),
    moveClip,
    setProjectLyrics: useCallback((lyrics) => update((p) => ({ ...p, lyricsOverride: lyrics })), [update]),
    resetProjectLyrics: useCallback(() => update((p) => ({ ...p, lyricsOverride: null })), [update]),
    setCaptionStyle: useCallback(
      (style) => update((p) => ({ ...p, captionStyle: { ...p.captionStyle, ...style } })),
      [update],
    ),
    setBeatsPerCut: useCallback((beatsPerCut) => update((p) => ({ ...p, beatsPerCut })), [update]),
    generateMagicCut,

    addChopperFiles,
    removeChopperJob,
    processChopperQueue,
    saveChopperSelection,
    setChopperReviewDismissed: useCallback(
      (jobId, dismissed) => updateJob(jobId, { reviewDismissed: dismissed }),
      [updateJob],
    ),

    stock,
    stockDownloads,
    runStockSearch,
    downloadStockVideo,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

// ---------------------------------------------------------------- formatting

export function formatDuration(s: number | null | undefined) {
  if (s == null || !Number.isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

export function formatBytes(n: number | null | undefined) {
  if (n == null) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatRelative(ts: number, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}
