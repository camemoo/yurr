export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type TimedWord = { word: string; start: number; end: number; probability?: number };

export type TranscribeResponse = {
  text: string;
  /** Which Whisper model actually ran, e.g. "large-v3-turbo (cpu)". */
  model: string;
  language: string;
  duration: number;
  words: TimedWord[];
};

export type BeatsResponse = { beats: number[]; tempo: number; duration: number };

export type BrollClipResponse = {
  path: string;
  url: string; // relative to API_BASE
  size?: number; // bytes
  start: number;
  end: number;
  center: number; // the activity peak
  length: number;
  /** How long the detected action actually lasts (s); clip length follows it within the target range. */
  active_span: number;
  score: number;
  reason: string;
};

export type ExtractBrollResponse = {
  job_id: string;
  duration: number;
  target_clip_length: { min: number; max: number };
  clips: BrollClipResponse[];
};

async function postFile<T>(endpoint: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const body = new FormData();
  body.append("file", file);
  for (const [k, v] of Object.entries(fields)) body.append(k, v);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", body });
  } catch {
    throw new Error(`Can't reach the backend at ${API_BASE}. Is it running?`);
  }
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail).catch(() => res.statusText);
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export const analyzeBeats = (audio: File) => postFile<BeatsResponse>("/api/analyze-beats", audio);
export const transcribe = (audio: File) => postFile<TranscribeResponse>("/api/transcribe", audio);
/** targetClipLength: seconds, fixed ("6") or a range ("5-7"). Server default is "5-7". */
export const extractBroll = (video: File, targetClipLength?: string) =>
  postFile<ExtractBrollResponse>(
    "/api/extract-broll",
    video,
    targetClipLength ? { target_clip_length: targetClipLength } : {},
  );
