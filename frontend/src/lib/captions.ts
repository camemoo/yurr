import type { TimedWord } from "@/lib/api";

const MAX_WORDS_PER_LINE = 3;
const MAX_GAP_SECONDS = 0.6;
/** How long a caption line lingers after its last word if nothing follows. */
const LINE_TAIL_SECONDS = 0.5;
/** Duration given to inserted words that have no timed neighbour on one side. */
const DEFAULT_WORD_SECONDS = 0.3;
/** Below this per-word gap, inserted words borrow time from the previous word. */
const MIN_WORD_SECONDS = 0.05;

export type CaptionLine = { words: TimedWord[]; start: number; end: number };

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Give every word of the (possibly user-edited) lyrics a timestamp.
 *
 * Edited tokens are matched to the transcription with a longest-common-
 * subsequence alignment: unchanged words keep their Whisper timing, and
 * inserted/replaced words are spread evenly across the gap between their
 * matched neighbours. So fixing one misheard word doesn't shift the rest.
 */
export function alignLyrics(lyrics: string, transcript: TimedWord[]): TimedWord[] {
  const tokens = lyrics.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || transcript.length === 0) return [];

  const a = tokens.map(norm);
  const b = transcript.map((w) => norm(w.word));
  const n = a.length;
  const m = b.length;

  // LCS table (suffix form so we can walk forwards).
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const match: (number | null)[] = new Array(n).fill(null);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) match[i++] = j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  // Nothing in common (lyrics fully rewritten): spread over the original vocal span.
  if (match.every((j) => j === null)) {
    const start = transcript[0].start;
    const step = (transcript[m - 1].end - start) / n;
    return tokens.map((word, i) => ({ word, start: start + step * i, end: start + step * (i + 1) }));
  }

  const out: TimedWord[] = [];
  for (let i = 0; i < n; ) {
    const j = match[i];
    if (j !== null) {
      out.push({ word: tokens[i], start: transcript[j].start, end: transcript[j].end });
      i++;
      continue;
    }
    // Run of unmatched tokens [i, k): spread them over the gap between neighbours.
    let k = i;
    while (k < n && match[k] === null) k++;
    const count = k - i;
    const prev = out[out.length - 1];
    const nextIdx = k < n ? match[k] : null;
    const nextStart =
      nextIdx !== null ? transcript[nextIdx].start : (prev?.end ?? 0) + DEFAULT_WORD_SECONDS * count;
    // No previous word: lead into the next one rather than stretching back to 0s.
    let winStart = prev ? prev.end : Math.max(0, nextStart - DEFAULT_WORD_SECONDS * count);
    if (prev && nextStart - winStart < MIN_WORD_SECONDS * count) {
      // No gap to fill (e.g. a repeated phrase typed in): share the previous word's slot.
      const step = (nextStart - prev.start) / (count + 1);
      prev.end = prev.start + step;
      winStart = prev.end;
    }
    const step = Math.max(0, nextStart - winStart) / count;
    for (let t = 0; t < count; t++) {
      const s = winStart + step * t;
      out.push({ word: tokens[i + t], start: s, end: s + step });
    }
    i = k;
  }
  return out;
}

/** Group timed words into short lines, breaking on long pauses. */
export function buildCaptionLines(words: TimedWord[]): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let current: TimedWord[] = [];
  for (const w of words) {
    const last = current[current.length - 1];
    if (current.length && (current.length >= MAX_WORDS_PER_LINE || w.start - last.end > MAX_GAP_SECONDS)) {
      lines.push({ words: current, start: current[0].start, end: last.end });
      current = [];
    }
    current.push(w);
  }
  if (current.length) {
    lines.push({ words: current, start: current[0].start, end: current[current.length - 1].end });
  }
  // Hold each line until the next one starts (short pauses) or briefly after its last word.
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    const tail = lines[i].end + LINE_TAIL_SECONDS;
    lines[i].end = next ? Math.min(Math.max(lines[i].end, next.start), tail) : tail;
  }
  return lines;
}
