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
  url: string; // relative to API_BASE, ends in the file name (clip_N.mp4)
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
/** Delete extracted clips that weren't kept (file names like "clip_3.mp4"). */
export async function discardBroll(jobId: string, files: string[]) {
  if (!files.length) return;
  await fetch(`${API_BASE}/api/broll/${jobId}/discard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  }).catch(() => {}); // best-effort cleanup; leftovers only cost disk space
}

// ---------------------------------------------------------------- stock footage (Pixabay, via backend)

export type StockVideo = {
  id: number;
  /** Size of the file "Download" fetches. */
  width: number;
  height: number;
  duration: number;
  /** A frame from the video; null if Pixabay didn't provide one. */
  image: string | null;
  /** Smallest rendition, for hover previews. */
  preview_url: string;
  download: { width: number; height: number; quality: "large" | "medium" | "small" | "tiny" };
  tags: string;
  author: string | null;
  author_url: string | null;
  /** The uploader's profile picture (Pixabay's userImageURL). */
  author_avatar: string | null;
  page_url: string;
};

export type StockSearchResponse = {
  query: string;
  page: number;
  total_results: number;
  has_more: boolean;
  videos: StockVideo[];
};

export async function searchStock(query: string, page = 1) {
  const params = new URLSearchParams({ query, page: String(page), per_page: "18" });
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/stock/search?${params}`);
  } catch {
    throw new Error(`Can't reach the backend at ${API_BASE}. Is it running?`);
  }
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail).catch(() => res.statusText);
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return (await res.json()) as StockSearchResponse;
}

/** Download a stock video's HD file (proxied by the backend), reporting 0..1 progress. */
export async function downloadStock(video: StockVideo, onProgress: (fraction: number) => void): Promise<File> {
  const res = await fetch(`${API_BASE}/api/stock/download/${video.id}`);
  if (!res.ok || !res.body) {
    const detail = await res.json().then((j) => j.detail).catch(() => res.statusText);
    throw new Error(typeof detail === "string" ? detail : "Download failed");
  }
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(received / total);
  }
  const slug = (video.author ?? "pixabay").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new File(chunks, `pixabay-${video.id}-${slug}.mp4`, { type: "video/mp4" });
}

/** targetClipLength: seconds, fixed ("6") or a range ("5-7"). Server default is "5-7". */
export const extractBroll = (video: File, targetClipLength?: string) =>
  postFile<ExtractBrollResponse>(
    "/api/extract-broll",
    video,
    targetClipLength ? { target_clip_length: targetClipLength } : {},
  );
