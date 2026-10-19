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
  extractBroll,
  transcribe,
  type BeatsResponse,
  type BrollClipResponse,
  type TimedWord,
} from "@/lib/api";
import {
  DEFAULT_CAPTION_STYLE,
  type BeatsPerCut,
  type BrollClip,
  type CaptionStyle,
} from "@/components/VideoComposition";

// ---------------------------------------------------------------- types

export type SongItem = {
  id: string;
  file: File;
  name: string;
  url: string; // object URL
  size: number;
  duration: number | null; // from audio metadata, before any analysis
  beats?: BeatsResponse;
  transcript?: { text: string; words: TimedWord[] };
};

export type ClipItem = {
  id: string;
  /** "upload": raw footage from the user. "chopper": a highlight cut by the backend. */
  source: "upload" | "chopper";
  /** Only uploads have a local File (needed to send them for B-roll extraction). */
  file?: File;
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

/** The active edit. References library items by id so it never holds stale copies. */
export type Workspace = {
  selectedSongId: string | null;
  selectedClipIds: string[];
  transcribedLyrics: string;
  captionStyle: CaptionStyle;
  beatsPerCut: BeatsPerCut;
};

export type TaskState = { status: "running" | "done" | "error" | "cached"; message?: string };

export type ChopperJob = {
  id: string;
  file: File;
  name: string;
  size: number;
  status: "pending" | "processing" | "done" | "error";
  message?: string;
  startedAt?: number;
  clipIds?: string[];
};

/** Seconds; shared by the Video Chopper and Magic Cut's B-roll extraction. */
export type ClipLengthRange = [number, number];

type State = {
  songLibrary: SongItem[];
  clipLibrary: ClipItem[];
  workspace: Workspace;
};

type Action =
  | { type: "addSongs"; songs: SongItem[] }
  | { type: "addClips"; clips: ClipItem[] }
  | { type: "removeSong"; id: string }
  | { type: "removeClip"; id: string }
  | { type: "songMeta"; id: string; duration: number }
  | { type: "clipMeta"; id: string; duration: number; width: number; height: number }
  | { type: "sendSongToWorkspace"; id: string }
  | { type: "addClipsToWorkspace"; ids: string[] }
  | { type: "removeClipFromWorkspace"; id: string }
  | { type: "moveClip"; id: string; delta: -1 | 1 }
  | { type: "clearSong" }
  | { type: "setLyrics"; lyrics: string }
  | { type: "setCaptionStyle"; style: Partial<CaptionStyle> }
  | { type: "setBeatsPerCut"; beatsPerCut: BeatsPerCut }
  | { type: "songBeats"; id: string; beats: BeatsResponse }
  | { type: "songTranscript"; id: string; text: string; words: TimedWord[] }
  | { type: "clipBroll"; id: string; broll: BrollClip[] };

const initialState: State = {
  songLibrary: [],
  clipLibrary: [],
  workspace: {
    selectedSongId: null,
    selectedClipIds: [],
    transcribedLyrics: "",
    captionStyle: DEFAULT_CAPTION_STYLE,
    beatsPerCut: 1,
  },
};

const patch = <T extends { id: string }>(items: T[], id: string, p: Partial<T>) =>
  items.map((it) => (it.id === id ? { ...it, ...p } : it));

function reducer(state: State, action: Action): State {
  const ws = state.workspace;
  switch (action.type) {
    case "addSongs":
      return { ...state, songLibrary: [...state.songLibrary, ...action.songs] };
    case "addClips":
      return { ...state, clipLibrary: [...state.clipLibrary, ...action.clips] };
    case "removeSong":
      return {
        ...state,
        songLibrary: state.songLibrary.filter((s) => s.id !== action.id),
        workspace:
          ws.selectedSongId === action.id ? { ...ws, selectedSongId: null, transcribedLyrics: "" } : ws,
      };
    case "removeClip":
      return {
        ...state,
        clipLibrary: state.clipLibrary.filter((c) => c.id !== action.id),
        workspace: { ...ws, selectedClipIds: ws.selectedClipIds.filter((id) => id !== action.id) },
      };
    case "songMeta":
      return { ...state, songLibrary: patch(state.songLibrary, action.id, { duration: action.duration }) };
    case "clipMeta": {
      const { id, duration, width, height } = action;
      return { ...state, clipLibrary: patch(state.clipLibrary, id, { duration, width, height }) };
    }
    case "sendSongToWorkspace": {
      const song = state.songLibrary.find((s) => s.id === action.id);
      if (!song || ws.selectedSongId === song.id) return state;
      // Lyrics belong to the song: switching songs loads that song's transcript (if any).
      return {
        ...state,
        workspace: { ...ws, selectedSongId: song.id, transcribedLyrics: song.transcript?.text ?? "" },
      };
    }
    case "clearSong":
      return { ...state, workspace: { ...ws, selectedSongId: null, transcribedLyrics: "" } };
    case "addClipsToWorkspace": {
      const fresh = action.ids.filter((id) => !ws.selectedClipIds.includes(id));
      if (!fresh.length) return state;
      return { ...state, workspace: { ...ws, selectedClipIds: [...ws.selectedClipIds, ...fresh] } };
    }
    case "removeClipFromWorkspace":
      return {
        ...state,
        workspace: { ...ws, selectedClipIds: ws.selectedClipIds.filter((id) => id !== action.id) },
      };
    case "moveClip": {
      const ids = [...ws.selectedClipIds];
      const i = ids.indexOf(action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= ids.length) return state;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { ...state, workspace: { ...ws, selectedClipIds: ids } };
    }
    case "setLyrics":
      return { ...state, workspace: { ...ws, transcribedLyrics: action.lyrics } };
    case "setCaptionStyle":
      return { ...state, workspace: { ...ws, captionStyle: { ...ws.captionStyle, ...action.style } } };
    case "setBeatsPerCut":
      return { ...state, workspace: { ...ws, beatsPerCut: action.beatsPerCut } };
    case "songBeats":
      return { ...state, songLibrary: patch(state.songLibrary, action.id, { beats: action.beats }) };
    case "songTranscript": {
      const { id, text, words } = action;
      return {
        ...state,
        songLibrary: patch(state.songLibrary, id, { transcript: { text, words } }),
        // Only fill the editor if this song is still the one being edited.
        workspace: ws.selectedSongId === id ? { ...ws, transcribedLyrics: text } : ws,
      };
    }
    case "clipBroll":
      return { ...state, clipLibrary: patch(state.clipLibrary, action.id, { broll: action.broll }) };
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

/** Alternate between source videos so consecutive cuts come from different footage. */
export function interleaveBroll(clips: ClipItem[]): BrollClip[] {
  const lists = clips.map((c) => c.broll ?? []);
  const out: BrollClip[] = [];
  for (let r = 0; r < Math.max(0, ...lists.map((l) => l.length)); r++) {
    for (const l of lists) if (l[r]) out.push(l[r]);
  }
  return out;
}

// ---------------------------------------------------------------- context

type EditorContextValue = State & {
  selectedSong: SongItem | null;
  selectedClips: ClipItem[];
  tasks: Record<string, TaskState>;
  generating: boolean;
  chopperJobs: ChopperJob[];
  chopping: boolean;
  clipLengthRange: ClipLengthRange;
  setClipLengthRange: (r: ClipLengthRange) => void;
  /** Adds accepted files to the library; returns the new item ids. */
  addFiles: (files: File[], kind: "song" | "clip") => string[];
  removeSong: (id: string) => void;
  removeClip: (id: string) => void;
  sendSongToWorkspace: (id: string) => void;
  clearSong: () => void;
  addClipsToWorkspace: (ids: string[]) => void;
  removeClipFromWorkspace: (id: string) => void;
  moveClip: (id: string, delta: -1 | 1) => void;
  setLyrics: (lyrics: string) => void;
  setCaptionStyle: (style: Partial<CaptionStyle>) => void;
  setBeatsPerCut: (n: BeatsPerCut) => void;
  generateMagicCut: () => Promise<void>;
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

  const addFiles = useCallback(
    (files: File[], kind: "song" | "clip") => {
      const accepted = files.filter(kind === "song" ? isAudioFile : isVideoFile);
      const base = accepted.map((file) => ({
        id: newId(),
        file,
        name: file.name,
        url: URL.createObjectURL(file),
        size: file.size,
        duration: null,
      }));
      if (kind === "song") dispatch({ type: "addSongs", songs: base });
      else dispatch({ type: "addClips", clips: base.map((c) => ({ ...c, source: "upload" as const })) });
      for (const it of base) loadMeta(it.id, it.url, kind);
      return base.map((it) => it.id);
    },
    [loadMeta],
  );

  const setTask = useCallback(
    (key: string, t: TaskState) => setTasks((prev) => ({ ...prev, [key]: t })),
    [],
  );

  const generateMagicCut = useCallback(async () => {
    const { songLibrary, clipLibrary, workspace } = stateRef.current;
    const song = songLibrary.find((s) => s.id === workspace.selectedSongId);
    const clips = workspace.selectedClipIds
      .map((id) => clipLibrary.find((c) => c.id === id))
      .filter((c): c is ClipItem => !!c);
    if (!song || clips.length === 0) return;
    // Chopped clips are already highlights; only raw uploads need extraction.
    const rawClips = clips.filter((c) => c.source === "upload");

    setGenerating(true);
    // Results are cached on library items, so only missing analyses hit the backend.
    // Keys name the item they belong to, so the UI shows only current tasks.
    setTasks({
      [`beats:${song.id}`]: song.beats ? { status: "cached" } : { status: "running" },
      [`lyrics:${song.id}`]: song.transcript ? { status: "cached" } : { status: "running" },
      ...Object.fromEntries(
        rawClips.map((c) => [`broll:${c.id}`, c.broll ? { status: "cached" } : { status: "running" }]),
      ),
    });

    const run = async (key: string, job: () => Promise<string>) => {
      try {
        setTask(key, { status: "done", message: await job() });
      } catch (e) {
        setTask(key, { status: "error", message: e instanceof Error ? e.message : String(e) });
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
    if (!song.transcript) {
      jobs.push(
        run(`lyrics:${song.id}`, async () => {
          const r = await transcribe(song.file);
          dispatch({ type: "songTranscript", id: song.id, text: r.text, words: r.words });
          return r.words.length ? `${r.words.length} words` : "no vocals detected";
        }),
      );
    }
    // B-roll extraction is CPU-heavy on the server; do one source video at a
    // time (in parallel with the audio jobs) rather than all at once.
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
  }, [setTask]);

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
        const stem = job.name.replace(/\.[^.]+$/, "");
        const clips: ClipItem[] = r.clips.map((c, i) => {
          const broll = toBroll(c);
          return {
            id: newId(),
            source: "chopper",
            name: `${stem} · cut ${i + 1}`,
            url: broll.src,
            size: c.size ?? null,
            duration: c.end - c.start,
            broll: [broll],
            origin: { sourceName: job.name, start: c.start, end: c.end, reason: c.reason },
          };
        });
        dispatch({ type: "addClips", clips });
        for (const c of clips) loadMeta(c.id, c.url, "clip");
        updateJob(job.id, { status: "done", clipIds: clips.map((c) => c.id), message: `${clips.length} clips` });
        jobsRef.current = patch(jobsRef.current, job.id, { status: "done" });
      } catch (e) {
        updateJob(job.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
        jobsRef.current = patch(jobsRef.current, job.id, { status: "error" });
        break; // don't hammer a backend that's down; the user can retry
      }
    }
    setChopping(false);
  }, [loadMeta, updateJob]);

  // ---------------------------------------------------------------- derived

  const selectedSong = useMemo(
    () => state.songLibrary.find((s) => s.id === state.workspace.selectedSongId) ?? null,
    [state.songLibrary, state.workspace.selectedSongId],
  );
  const selectedClips = useMemo(
    () =>
      state.workspace.selectedClipIds
        .map((id) => state.clipLibrary.find((c) => c.id === id))
        .filter((c): c is ClipItem => !!c),
    [state.clipLibrary, state.workspace.selectedClipIds],
  );

  const value: EditorContextValue = {
    ...state,
    selectedSong,
    selectedClips,
    tasks,
    generating,
    chopperJobs,
    chopping,
    clipLengthRange,
    setClipLengthRange,
    addFiles,
    removeSong: useCallback((id) => dispatch({ type: "removeSong", id }), []),
    removeClip: useCallback((id) => dispatch({ type: "removeClip", id }), []),
    sendSongToWorkspace: useCallback((id) => dispatch({ type: "sendSongToWorkspace", id }), []),
    clearSong: useCallback(() => dispatch({ type: "clearSong" }), []),
    addClipsToWorkspace: useCallback((ids) => dispatch({ type: "addClipsToWorkspace", ids }), []),
    removeClipFromWorkspace: useCallback((id) => dispatch({ type: "removeClipFromWorkspace", id }), []),
    moveClip: useCallback((id, delta) => dispatch({ type: "moveClip", id, delta }), []),
    setLyrics: useCallback((lyrics) => dispatch({ type: "setLyrics", lyrics }), []),
    setCaptionStyle: useCallback((style) => dispatch({ type: "setCaptionStyle", style }), []),
    setBeatsPerCut: useCallback((beatsPerCut) => dispatch({ type: "setBeatsPerCut", beatsPerCut }), []),
    generateMagicCut,
    addChopperFiles,
    removeChopperJob,
    processChopperQueue,
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
