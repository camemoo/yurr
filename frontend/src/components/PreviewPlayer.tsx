"use client";

import { Player } from "@remotion/player";
import { useEffect } from "react";
import { prefetch } from "remotion";
import {
  COMPOSITION_FPS,
  COMPOSITION_HEIGHT,
  COMPOSITION_WIDTH,
  VideoComposition,
  type VideoCompositionProps,
} from "@/components/VideoComposition";

type Props = VideoCompositionProps & { durationInFrames: number };

// Beat cuts can be a fraction of a second apart, so B-roll is downloaded up front
// (prefetch) instead of streamed per cut. The cache lives at module level so it
// survives Player remounts and clip-list changes; a clip is freed only once it has
// been unused for a while, so elements that are still unmounting never find their
// blob URL revoked underneath them.
const prefetched = new Map<string, ReturnType<typeof prefetch>>();
let wanted = new Set<string>();
const FREE_AFTER_MS = 5000;

function syncPrefetch(srcs: string[]) {
  wanted = new Set(srcs);
  for (const src of wanted) {
    if (!prefetched.has(src)) prefetched.set(src, prefetch(src, { method: "blob-url" }));
  }
  setTimeout(() => {
    for (const [src, handle] of prefetched) {
      if (!wanted.has(src)) {
        handle.free();
        prefetched.delete(src);
      }
    }
  }, FREE_AFTER_MS);
}

// Loaded with next/dynamic({ ssr: false }): the Remotion Player reads the clock
// during render, which can't be prerendered on the server.
export default function PreviewPlayer({ durationInFrames, ...inputProps }: Props) {
  const clipSrcs = inputProps.brollClips.map((c) => c.src).join("|");

  useEffect(() => {
    syncPrefetch(clipSrcs ? clipSrcs.split("|") : []);
  }, [clipSrcs]);

  return (
    <Player
      component={VideoComposition}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      fps={COMPOSITION_FPS}
      compositionWidth={COMPOSITION_WIDTH}
      compositionHeight={COMPOSITION_HEIGHT}
      style={{ width: "100%", height: "100%" }}
      controls
      loop
    />
  );
}
