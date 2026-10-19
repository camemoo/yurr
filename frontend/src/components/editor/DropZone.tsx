"use client";

import { useRef, useState } from "react";
import { UploadIcon } from "./icons";

export function DropZone(props: {
  title: string;
  hint: string;
  accept: string;
  /** Returns how many files were accepted, to report rejected ones. */
  onFiles: (files: File[]) => number;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState(0);
  // dragenter/leave fire for every child element; count depth to avoid flicker.
  const depth = useRef(0);

  const handle = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setRejected(files.length - props.onFiles(files));
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          handle(e.dataTransfer.files);
        }}
        className={`group flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
          props.compact ? "px-6 py-6" : "px-6 py-12"
        } ${
          dragging
            ? "scale-[1.01] border-violet-500 bg-violet-500/10"
            : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/70"
        }`}
      >
        <span
          className={`flex size-12 items-center justify-center rounded-full transition-colors ${
            dragging ? "bg-violet-500 text-white" : "bg-zinc-800 text-zinc-400 group-hover:text-zinc-200"
          }`}
        >
          <UploadIcon className="size-5" />
        </span>
        <span>
          <span className="block text-sm font-medium text-zinc-200">
            {dragging ? "Drop to upload" : props.title}
          </span>
          <span className="mt-1 block text-xs text-zinc-500">{props.hint}</span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={props.accept}
        className="hidden"
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
      />
      {rejected > 0 && (
        <p className="mt-2 text-xs text-amber-400">
          Skipped {rejected} file{rejected > 1 ? "s" : ""} with an unsupported type.
        </p>
      )}
    </div>
  );
}
