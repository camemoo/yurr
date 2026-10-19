"""Flowstage backend: lyric transcription, beat analysis and B-roll extraction.

Run:
    venv\\Scripts\\python.exe main.py          (or: uvicorn main:app --port 8000)
Docs:
    http://localhost:8000/docs
"""

import gc
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
UPLOAD_DIR = STORAGE_DIR / "uploads"
BROLL_DIR = STORAGE_DIR / "broll"

# Whisper models to try, in order. A GPU that runs out of memory steps down to
# the smaller English-only model; a GPU that can't be used at all (no CUDA
# libraries, no device) goes straight to the CPU, where memory isn't the limit.
WHISPER_TIERS = [
    ("large-v3-turbo", "cuda"),
    ("medium.en", "cuda"),
    ("large-v3-turbo", "cpu"),
]

# --- B-roll tuning ---
DEFAULT_CLIP_LENGTH = "5-7"   # seconds: fixed ("6") or a range ("5-7")
MAX_CLIP_LENGTH = 30.0
NUM_CLIPS = 5
ANALYSIS_FPS = 5.0          # frames per second actually analysed
ANALYSIS_WIDTH = 480        # downscale before differencing / face detection
FACE_WEIGHT = 1.0           # score bonus for a frame containing a frontal face
SMOOTH_SECONDS = 1.0        # moving-average window over the per-frame score

app = FastAPI(title="Flowstage Backend")
app.add_middleware(
    CORSMiddleware,
    # Any local port: Next.js moves to 3001+ when 3000 is busy.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Browsers can't load local file paths, so extracted clips are also served over
# HTTP. Only the broll folder is exposed, not the raw uploads.
BROLL_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media/broll", StaticFiles(directory=BROLL_DIR), name="broll")


# ---------------------------------------------------------------- helpers

def save_upload(upload: UploadFile, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(upload.filename or "").suffix.lower() or ".bin"
    dest = dest_dir / f"{uuid.uuid4().hex}{suffix}"
    with dest.open("wb") as f:
        shutil.copyfileobj(upload.file, f)
    return dest


# ---------------------------------------------------------------- whisper

_model = None
_model_tier = 0  # index into WHISPER_TIERS of the loaded (or next to try) model
_model_lock = threading.Lock()
_CPU_TIER = next(i for i, (_, d) in enumerate(WHISPER_TIERS) if d == "cpu")


def _is_oom(e: Exception) -> bool:
    msg = str(e).lower()
    return "out of memory" in msg or "cudaerrormemoryallocation" in msg


def _next_tier(tier: int, e: Exception) -> int:
    """Where to go after `tier` failed with `e`."""
    if WHISPER_TIERS[tier][1] != "cuda":
        raise e  # CPU failed: nothing left to try
    return tier + 1 if _is_oom(e) else _CPU_TIER


def _load_tier(tier: int):
    import ctranslate2
    from faster_whisper import WhisperModel

    name, device = WHISPER_TIERS[tier]
    if device == "cuda":
        supported = ctranslate2.get_supported_compute_types("cuda")
        compute = next(t for t in ("float16", "int8_float16", "float32") if t in supported)
    else:
        compute = "int8"
    print(f"Loading Whisper {name} on {device} ({compute})...", file=sys.stderr)
    return WhisperModel(name, device=device, compute_type=compute)


def get_model():
    """Load Whisper once, walking down WHISPER_TIERS until one loads."""
    global _model, _model_tier
    with _model_lock:
        while _model is None:
            try:
                _model = _load_tier(_model_tier)
            except Exception as e:
                nxt = _next_tier(_model_tier, e)
                print(f"Whisper {WHISPER_TIERS[_model_tier]} failed to load ({e}); "
                      f"trying {WHISPER_TIERS[nxt]}.", file=sys.stderr)
                _model_tier = nxt
        return _model, _model_tier


def demote_model(failed_tier: int, e: Exception):
    """A model loaded but failed while decoding (OOM, or missing cuBLAS/cuDNN,
    which only surface on first use): drop it and move to the next tier."""
    global _model, _model_tier
    with _model_lock:
        if _model_tier != failed_tier:
            return  # another request already demoted it
        nxt = _next_tier(failed_tier, e)
        print(f"Whisper {WHISPER_TIERS[failed_tier]} failed while decoding ({e}); "
              f"switching to {WHISPER_TIERS[nxt]}.", file=sys.stderr)
        _model, _model_tier = None, nxt
        gc.collect()  # release VRAM before the next model loads


def load_audio(path: Path, sr: int = 16000) -> np.ndarray:
    """Decode any audio/video file to mono float32 PCM at `sr` Hz.

    Uses the ffmpeg binary bundled with moviepy (imageio-ffmpeg) instead of
    faster-whisper's PyAV decoder, which breaks with newer PyAV releases."""
    import imageio_ffmpeg

    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-v", "error", "-i", str(path),
           "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise ValueError(f"Could not decode audio: {proc.stderr.decode(errors='replace').strip()}")
    return np.frombuffer(proc.stdout, np.int16).astype(np.float32) / 32768.0


def _voice_spans(audio: np.ndarray, sr: int = 16000) -> list[tuple[float, float]]:
    """(start, end) seconds where Silero VAD hears a voice."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    ts = get_speech_timestamps(audio, VadOptions(threshold=0.5, min_silence_duration_ms=500))
    return [(t["start"] / sr, t["end"] / sr) for t in ts]


def run_whisper(audio_path: Path, language: str | None):
    audio = load_audio(audio_path)
    if audio.size == 0:
        raise ValueError("File contains no audio")

    while True:
        model, tier = get_model()
        name, device = WHISPER_TIERS[tier]
        try:
            segments, info = model.transcribe(
                audio,
                # English-only models (*.en) can't take another language.
                language="en" if name.endswith(".en") else language,
                word_timestamps=True,
                beam_size=5,
                # Don't feed each window's text into the next: stops Whisper looping
                # the last lyric line through long instrumental sections.
                condition_on_previous_text=False,
            )
            segments = list(segments)  # lazy generator: decoding happens here
            break
        except RuntimeError as e:
            if device != "cuda":
                raise
            demote_model(tier, e)

    # Whisper hallucinates filler ("You", "Thank you.", "Amen.") on non-vocal audio.
    # large-v3-turbo reports no_speech_prob ~0 even for pure noise, so we also ask
    # an independent voice-activity detector (Silero, bundled with faster-whisper).
    # VAD alone isn't trusted to delete lyrics (it can miss heavily processed
    # singing), so a segment is only dropped when it's *also* low-confidence.
    voiced = _voice_spans(audio)

    def voiced_fraction(s):
        dur = max(s.end - s.start, 1e-3)
        return sum(max(0.0, min(s.end, e) - max(s.start, b)) for b, e in voiced) / dur

    def hallucinated(s):
        probs = [w.probability for w in s.words or []]
        mean_prob = sum(probs) / len(probs) if probs else 0.0
        if s.no_speech_prob > 0.6 and mean_prob < 0.3:
            return True
        return voiced_fraction(s) < 0.2 and mean_prob < 0.8

    segments = [s for s in segments if not hallucinated(s)]

    words = [
        {"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3),
         "probability": round(w.probability, 3)}
        for seg in segments for w in (seg.words or []) if w.word.strip()
    ]
    text = " ".join(seg.text.strip() for seg in segments).strip()
    return text, words, info, f"{name} ({device})"


# ---------------------------------------------------------------- b-roll analysis

_face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def score_video(path: Path):
    """Scan the video and return (times, motion, faces, duration).

    Every ~1/ANALYSIS_FPS seconds a frame is downscaled to grayscale, compared
    with the previous sampled frame (mean absolute difference = motion), and
    checked for frontal faces with the Haar cascade."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError("OpenCV could not open the video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, int(round(fps / ANALYSIS_FPS)))

    times, motion, faces = [], [], []
    prev = None
    idx = 0
    while True:
        # grab() skips colour conversion for frames we don't analyse.
        if not cap.grab():
            break
        if idx % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            h, w = frame.shape[:2]
            scale = ANALYSIS_WIDTH / w
            gray = cv2.cvtColor(cv2.resize(frame, (ANALYSIS_WIDTH, int(h * scale))), cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)  # suppress sensor noise
            motion.append(0.0 if prev is None else float(cv2.absdiff(blurred, prev).mean()))
            prev = blurred

            detected = _face_cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=6,
                                                      minSize=(40, 40))
            faces.append(len(detected))
            times.append(idx / fps)
        idx += 1
    cap.release()

    duration = (frame_count or idx) / fps
    return np.array(times), np.array(motion), np.array(faces), duration


def parse_clip_length(value: str) -> tuple[float, float]:
    """'6' -> (6, 6); '5-7' -> (5, 7). Raises ValueError on nonsense."""
    parts = [p.strip() for p in value.replace("–", "-").split("-")]
    if len(parts) not in (1, 2) or not all(parts):
        raise ValueError("target_clip_length must be a number (6) or a range (5-7)")
    lo, hi = float(parts[0]), float(parts[-1])
    if not (0.5 <= lo <= hi <= MAX_CLIP_LENGTH):
        raise ValueError(f"target_clip_length must be between 0.5 and {MAX_CLIP_LENGTH:.0f} seconds, low <= high")
    return lo, hi


# A moment's "active span" is the stretch around its peak where the smoothed
# score stays at least this far (as a fraction of peak - baseline) above the
# video's baseline (median) activity. Measuring from the baseline rather than
# as a fraction of the peak keeps one-frame spikes (hard cuts, flashes) from
# making normal sustained action look inactive.
ACTIVE_FRACTION = 0.35


def pick_moments(times, motion, faces, duration, n=NUM_CLIPS, length_range=(5.0, 7.0)):
    """Combine motion + faces into one score, then pick the n strongest moments.

    Each clip's length adapts to how long the action lasts: the active span
    around the peak, clamped to `length_range`, and the clip is centred on that
    span (or on the peak itself, if the action runs longer than the max length).
    Clips never overlap unless the video is too short to fit n of them."""
    if len(times) == 0:
        return []
    lo, hi = min(length_range[0], duration), min(length_range[1], duration)
    step = 1.0 / ANALYSIS_FPS

    # Normalise motion by its 95th percentile so a few hard cuts don't dominate.
    ref = np.percentile(motion, 95) or 1.0
    motion_n = np.clip(motion / ref, 0, 1.5)
    score = motion_n + FACE_WEIGHT * (faces > 0)

    win = max(1, int(round(SMOOTH_SECONDS * ANALYSIS_FPS)))
    smooth = np.convolve(score, np.ones(win) / win, mode="same")

    baseline = float(np.median(smooth))

    def window_for(i):
        thr = baseline + ACTIVE_FRACTION * (smooth[i] - baseline)
        left = right = i
        while left > 0 and smooth[left - 1] >= thr:
            left -= 1
        while right < len(smooth) - 1 and smooth[right + 1] >= thr:
            right += 1
        # The moving average smears each edge outward by half a window; undo that.
        smear = (win - 1) / 2 * step
        span_start, span_end = times[left] + smear, times[right] + step - smear
        if span_end <= span_start:
            span_start = span_end = times[i]
        length = float(np.clip(span_end - span_start, lo, hi))
        center = (span_start + span_end) / 2 if span_end - span_start <= hi else times[i]
        start = float(np.clip(center - length / 2, 0.0, duration - length))
        return start, start + length, span_end - span_start

    def overlap(a, b):
        return max(0.0, min(a[1], b[1]) - max(a[0], b[0]))

    order = np.argsort(smooth)[::-1]
    chosen = []
    # Pass 1: no overlap at all. Pass 2 (short videos only): allow clips to share
    # up to half their length so we still return n distinct moments.
    for max_shared in (0.0, 0.5):
        for i in order:
            if len(chosen) == n:
                break
            start, end, span = window_for(i)
            if any(overlap((start, end), (c["start"], c["end"])) > max_shared * min(end - start, c["end"] - c["start"]) + 1e-6
                   for c in chosen):
                continue
            reason = "face" if faces[i] > 0 and motion_n[i] < 0.5 else (
                "motion+face" if faces[i] > 0 else "motion")
            chosen.append({
                "start": round(start, 3),
                "end": round(end, 3),
                "center": round(float(np.clip(times[i], start, end)), 3),  # the peak itself
                "length": round(end - start, 3),
                "active_span": round(float(span), 2),
                "score": round(float(smooth[i]), 3),
                "reason": reason,
            })
        if len(chosen) == n:
            break
    return sorted(chosen, key=lambda c: c["start"])


def cut_clips(path: Path, moments, out_dir: Path):
    from moviepy import VideoFileClip

    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    with VideoFileClip(str(path)) as video:
        for i, m in enumerate(moments, 1):
            out = out_dir / f"clip_{i}.mp4"
            sub = video.subclipped(m["start"], min(m["end"], video.duration))
            sub.write_videofile(str(out), codec="libx264", audio_codec="aac",
                                preset="veryfast", logger=None,
                                temp_audiofile=str(out_dir / f"clip_{i}_temp_audio.m4a"))
            results.append({**m, "path": str(out.resolve()), "size": out.stat().st_size,
                            "url": f"/media/broll/{out_dir.name}/{out.name}"})
    return results


# ---------------------------------------------------------------- endpoints
# Plain `def` (not async): FastAPI runs these in a worker thread, so the
# CPU-heavy work doesn't block the event loop.

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/transcribe")
def transcribe(file: UploadFile = File(...),
               language: str | None = Query(None, description="e.g. 'en'; auto-detect if omitted")):
    with tempfile.TemporaryDirectory() as tmp:
        audio_path = save_upload(file, Path(tmp))
        try:
            text, words, info, model_used = run_whisper(audio_path, language)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Transcription failed: {e}")

    return {
        "text": text,
        "model": model_used,
        "language": info.language,
        "duration": round(info.duration, 3),
        "words": words,
    }


@app.post("/api/analyze-beats")
def analyze_beats(file: UploadFile = File(...)):
    import librosa

    with tempfile.TemporaryDirectory() as tmp:
        audio_path = save_upload(file, Path(tmp))
        try:
            y, sr = librosa.load(str(audio_path))
        except Exception:
            # librosa/soundfile can't read some containers (e.g. .m4a); ffmpeg can.
            try:
                sr = 22050
                y = load_audio(audio_path, sr=sr)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))

    if y.size == 0:
        raise HTTPException(status_code=422, detail="File contains no audio")

    # trim=False: the default trimming discards "weak" leading beats, which in
    # practice drops every beat under the vocals of an intro/verse. Without it,
    # beats continue at the tracked tempo through quiet sections.
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time", trim=False)
    return {
        "beats": [round(float(t), 3) for t in beats],
        "tempo": round(float(np.atleast_1d(tempo)[0]), 2),
        "duration": round(len(y) / sr, 3),
    }


@app.post("/api/extract-broll")
def extract_broll(
    file: UploadFile = File(...),
    target_clip_length: str = Form(
        DEFAULT_CLIP_LENGTH,
        description="Clip length in seconds: fixed ('6') or a range ('5-7'). With a range, "
                    "each clip's length follows how long the action lasts.",
    ),
):
    try:
        length_range = parse_clip_length(target_clip_length)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    job_id = uuid.uuid4().hex[:12]
    video_path = save_upload(file, UPLOAD_DIR)

    try:
        times, motion, faces, duration = score_video(video_path)
    except ValueError as e:
        video_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(e))
    if duration < 1.0:
        video_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Video is {duration:.1f}s; need at least 1s.")

    moments = pick_moments(times, motion, faces, duration, length_range=length_range)
    clips = cut_clips(video_path, moments, BROLL_DIR / job_id)

    return {
        "job_id": job_id,
        "source": str(video_path.resolve()),
        "duration": round(duration, 3),
        "target_clip_length": {"min": length_range[0], "max": length_range[1]},
        "clips": clips,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000)
