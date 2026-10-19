import { useMemo } from "react";
import {
  AbsoluteFill,
  Html5Audio,
  Html5Video,
  Series,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { TimedWord } from "@/lib/api";
import { alignLyrics, buildCaptionLines, type CaptionLine } from "@/lib/captions";

export const COMPOSITION_WIDTH = 1080;
export const COMPOSITION_HEIGHT = 1920;
export const COMPOSITION_FPS = 30;
export const DEFAULT_DURATION_IN_FRAMES = 15 * COMPOSITION_FPS;

// ---------------------------------------------------------------- style options

export const BEATS_PER_CUT_OPTIONS = [1, 2, 4, 8] as const;
export type BeatsPerCut = (typeof BEATS_PER_CUT_OPTIONS)[number];

export const FONT_FAMILIES = {
  impact: { label: "Impact", css: "Impact, 'Arial Black', 'Haettenschweiler', sans-serif" },
  arial: { label: "Arial", css: "Arial, Helvetica, sans-serif" },
  courier: { label: "Courier New", css: "'Courier New', Courier, monospace" },
  georgia: { label: "Georgia", css: "Georgia, 'Times New Roman', serif" },
  verdana: { label: "Verdana", css: "Verdana, Geneva, sans-serif" },
} as const;
export type FontFamilyKey = keyof typeof FONT_FAMILIES;

export const CAPTION_ANIMATIONS = {
  highlight: "Highlight",
  bounce: "Bounce",
  typewriter: "Typewriter",
} as const;
export type CaptionAnimation = keyof typeof CAPTION_ANIMATIONS;

export type CaptionStyle = {
  fontSize: number; // px on the 1080x1920 canvas
  color: string; // #rrggbb
  fontFamily: FontFamilyKey;
  animation: CaptionAnimation;
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 96,
  color: "#ffffff",
  fontFamily: "arial",
  animation: "highlight",
};

// ---------------------------------------------------------------- props

export type BrollClip = {
  src: string;
  /** Clip length in seconds. */
  length: number;
  /** Seconds from the clip's start to its high-activity moment. */
  centerOffset: number;
};

// Remotion input props must be a plain object type (not an interface).
export type VideoCompositionProps = {
  lyrics: string;
  /** Whisper word timings; when present, lyrics are shown as timed captions. */
  words: TimedWord[];
  /** Beat timestamps in seconds. */
  beats: number[];
  beatsPerCut: BeatsPerCut;
  brollClips: BrollClip[];
  captionStyle: CaptionStyle;
  /** Master song (object URL). */
  audioSrc: string | null;
  /** Uploaded raw video, shown when there's no B-roll yet. */
  videoSrc: string | null;
};

// ---------------------------------------------------------------- pacing

/**
 * Frame numbers where cuts happen: every `beatsPerCut`-th beat, so with 2 the
 * segments run beats[0]->beats[2]->beats[4]... Beats are rounded to frames
 * *before* taking differences, so rounding never accumulates. Frame 0 and the
 * last frame bound the intro (before the first beat) and outro.
 */
export function cutBoundaries(beats: number[], beatsPerCut: number, totalFrames: number, fps: number) {
  const cuts = beats
    .filter((_, i) => i % beatsPerCut === 0)
    .map((t) => Math.round(t * fps))
    .filter((f) => f > 0 && f < totalFrames);
  return [...new Set([0, ...cuts, totalFrames])].sort((a, b) => a - b);
}

type Segment = { durationInFrames: number; clip: BrollClip };

/** One segment per cut interval; clips are reused round-robin when cuts outnumber clips. */
function buildSegments(boundaries: number[], clips: BrollClip[]): Segment[] {
  if (clips.length === 0) return [];
  return boundaries.slice(1).map((end, i) => ({
    durationInFrames: end - boundaries[i],
    clip: clips[i % clips.length],
  }));
}

/** Start each cut so the clip's high-activity moment sits mid-segment. */
function trimForSegment(clip: BrollClip, durationInFrames: number, fps: number) {
  const clipFrames = Math.floor(clip.length * fps);
  const ideal = Math.round(clip.centerOffset * fps - durationInFrames / 2);
  return Math.max(0, Math.min(ideal, clipFrames - durationInFrames));
}

// ---------------------------------------------------------------- captions

/** Yellow highlight, unless the text itself is yellow-ish: then cyan, so it still reads. */
function highlightFor(color: string) {
  const n = parseInt(color.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.hypot(255 - r, 255 - g, b) < 140 ? "#00E5FF" : "#FFFF00";
}

function baseTextStyle(style: CaptionStyle): React.CSSProperties {
  return {
    color: style.color,
    fontFamily: FONT_FAMILIES[style.fontFamily].css,
    fontWeight: style.fontFamily === "impact" ? 400 : 800, // Impact has no bold face
    fontSize: style.fontSize,
    lineHeight: 1.15,
    textAlign: "center",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    maxWidth: "100%",
    // Thick black outline that scales with the type (matches the Python .ass style).
    WebkitTextStroke: `${Math.round(style.fontSize * 0.14)}px black`,
    paintOrder: "stroke fill",
  };
}

/** Reveal `text` character by character between two frames. Hidden characters
 *  still take up space so the centred block doesn't re-flow while typing. */
const Typewriter: React.FC<{ text: string; from: number; to: number; style: CaptionStyle }> = ({
  text,
  from,
  to,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = Math.floor(
    interpolate(frame, [from, Math.max(from + 1, to)], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const typing = shown < text.length;
  const caretOn = Math.floor(frame / (fps / 2)) % 2 === 0;
  return (
    <div style={baseTextStyle(style)}>
      {text.slice(0, shown)}
      {/* Thin blinking caret with zero net width, so it never shifts the text. */}
      <span
        style={{
          display: "inline-block",
          width: "0.08em",
          height: "0.9em",
          marginRight: "-0.08em",
          verticalAlign: "-0.08em",
          background: style.color,
          opacity: typing && caretOn ? 1 : 0,
        }}
      />
      <span style={{ color: "transparent", WebkitTextStroke: "0 transparent" }}>{text.slice(shown)}</span>
    </div>
  );
};

const LineCaption: React.FC<{ line: CaptionLine; style: CaptionStyle }> = ({ line, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const highlight = highlightFor(style.color);

  if (style.animation === "typewriter") {
    // Type the line out over the time it's sung.
    const text = line.words.map((w) => w.word).join(" ");
    const lastWord = line.words[line.words.length - 1];
    return (
      <Typewriter
        text={text}
        from={Math.round(line.start * fps)}
        to={Math.round(lastWord.end * fps)}
        style={style}
      />
    );
  }

  return (
    <div style={baseTextStyle(style)}>
      {line.words.map((w, i) => {
        const next = line.words[i + 1];
        // A word is "active" from its start until the next word starts.
        const active = t >= w.start && (!next || t < next.start);

        if (style.animation === "bounce") {
          // Each word springs in as it's sung; unsung words wait invisibly (keeping layout).
          const startFrame = Math.round(w.start * fps);
          const pop = spring({ frame: frame - startFrame, fps, config: { damping: 10, stiffness: 200, mass: 0.6 } });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: next ? "0.25em" : 0,
                color: active ? highlight : style.color,
                opacity: frame < startFrame ? 0 : 1,
                transform: `translateY(${interpolate(pop, [0, 1], [0.35, 0]) * style.fontSize}px) scale(${interpolate(pop, [0, 1], [0.5, 1])})`,
              }}
            >
              {w.word}
            </span>
          );
        }

        return (
          <span key={i} style={{ color: active ? highlight : style.color }}>
            {w.word}
            {next ? " " : ""}
          </span>
        );
      })}
    </div>
  );
};

const Captions: React.FC<{ lyrics: string; words: TimedWord[]; style: CaptionStyle }> = ({
  lyrics,
  words,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  // Re-aligned only when the text or timings change, not every frame.
  const lines = useMemo(() => buildCaptionLines(alignLyrics(lyrics, words)), [lyrics, words]);

  if (words.length === 0) {
    // No timings (lyrics typed by hand): show the whole text, animated over the video.
    if (style.animation === "typewriter") {
      return <Typewriter text={lyrics} from={0} to={durationInFrames - 1} style={style} />;
    }
    const pop = style.animation === "bounce" ? spring({ frame, fps, config: { damping: 10, mass: 0.6 } }) : 1;
    return <div style={{ ...baseTextStyle(style), transform: `scale(${interpolate(pop, [0, 1], [0.5, 1])})` }}>{lyrics}</div>;
  }

  const t = frame / fps;
  const line = lines.find((l) => t >= l.start && t < l.end);
  return line ? <LineCaption line={line} style={style} /> : null;
};

// ---------------------------------------------------------------- composition

export const VideoComposition: React.FC<VideoCompositionProps> = ({
  lyrics,
  words,
  beats,
  beatsPerCut,
  brollClips,
  captionStyle,
  audioSrc,
  videoSrc,
}) => {
  const { durationInFrames, fps } = useVideoConfig();
  const segments = useMemo(
    () => buildSegments(cutBoundaries(beats, beatsPerCut, durationInFrames, fps), brollClips),
    [beats, beatsPerCut, brollClips, durationInFrames, fps],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {segments.length > 0 ? (
        <Series>
          {segments.map((seg, i) => (
            <Series.Sequence key={i} durationInFrames={seg.durationInFrames} premountFor={fps}>
              <Html5Video
                src={seg.clip.src}
                muted
                loop
                trimBefore={trimForSegment(seg.clip, seg.durationInFrames, fps)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </Series.Sequence>
          ))}
        </Series>
      ) : (
        <Html5Video
          src={videoSrc ?? staticFile("placeholder.mp4")}
          muted={!!audioSrc}
          loop
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      {audioSrc && <Html5Audio src={audioSrc} />}

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
        <Captions lyrics={lyrics} words={words} style={captionStyle} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
