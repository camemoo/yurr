"use client";

import { useId } from "react";

// Shared form controls for the editor panels (dark theme, violet accent).

const trackClass =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-violet-500 " +
  "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:ring-4 " +
  "[&::-webkit-slider-thumb]:ring-violet-500/40 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full " +
  "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white";

export function Field(props: { label: string; htmlFor?: string; value?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={props.htmlFor} className="text-xs font-medium text-zinc-400">
          {props.label}
        </label>
        {props.value !== undefined && (
          <span className="text-xs font-medium tabular-nums text-zinc-200">{props.value}</span>
        )}
      </div>
      {props.children}
    </div>
  );
}

export function Slider(props: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = useId();
  return (
    <Field label={props.label} htmlFor={id} value={props.format ? props.format(props.value) : props.value}>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className={trackClass}
      />
    </Field>
  );
}

/** Two-thumb range slider built from two overlaid native range inputs (keyboard accessible). */
export function RangeSlider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  format: (v: [number, number]) => string;
  disabled?: boolean;
}) {
  const [lo, hi] = props.value;
  const pct = (v: number) => ((v - props.min) / (props.max - props.min)) * 100;
  const thumb =
    "pointer-events-none absolute inset-0 h-1.5 w-full appearance-none bg-transparent " +
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer " +
    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white " +
    "[&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:ring-4 [&::-webkit-slider-thumb]:ring-violet-500/40 " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer " +
    "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white " +
    "disabled:opacity-50";
  return (
    <Field label={props.label} value={props.format(props.value)}>
      <div className="relative h-1.5 rounded-full bg-zinc-800">
        <div
          className="absolute h-full rounded-full bg-violet-500"
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />
        <input
          type="range"
          aria-label={`${props.label} minimum`}
          min={props.min}
          max={props.max}
          step={props.step}
          value={lo}
          disabled={props.disabled}
          onChange={(e) => props.onChange([Math.min(Number(e.target.value), hi), hi])}
          className={thumb}
        />
        <input
          type="range"
          aria-label={`${props.label} maximum`}
          min={props.min}
          max={props.max}
          step={props.step}
          value={hi}
          disabled={props.disabled}
          onChange={(e) => props.onChange([lo, Math.max(Number(e.target.value), lo)])}
          className={thumb}
        />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-zinc-600">
        <span>{props.min}s</span>
        <span>{props.max}s</span>
      </div>
    </Field>
  );
}

/** A slider that snaps to a fixed set of values (e.g. 1, 2, 4, 8), with tick labels. */
export function StepSlider<T extends number>(props: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  const id = useId();
  const index = Math.max(0, props.options.indexOf(props.value));
  return (
    <Field label={props.label} htmlFor={id} value={props.format ? props.format(props.value) : props.value}>
      <input
        id={id}
        type="range"
        min={0}
        max={props.options.length - 1}
        step={1}
        value={index}
        aria-valuetext={props.format ? props.format(props.value) : String(props.value)}
        onChange={(e) => props.onChange(props.options[Number(e.target.value)])}
        className={trackClass}
      />
      <div className="flex justify-between px-0.5 text-[10px] tabular-nums text-zinc-500">
        {props.options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => props.onChange(o)}
            className={`w-4 text-center ${o === props.value ? "font-semibold text-violet-300" : "hover:text-zinc-300"}`}
          >
            {o}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function Select<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; style?: React.CSSProperties }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <Field label={props.label} htmlFor={id}>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
        className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-violet-500"
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value} style={o.style}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

export function ColorField(props: { label: string; value: string; onChange: (hex: string) => void }) {
  const id = useId();
  return (
    <Field label={props.label} htmlFor={id}>
      <div className="flex h-9 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 pl-1.5 pr-3 focus-within:border-violet-500">
        <input
          type="color"
          aria-label={`${props.label} picker`}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="size-6 cursor-pointer rounded border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        />
        <input
          id={id}
          // Uncontrolled + keyed on value: free typing, committed only when it's a valid hex.
          key={props.value}
          defaultValue={props.value}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            if (HEX.test(v)) props.onChange(v.toLowerCase());
          }}
          className="w-full bg-transparent font-mono text-sm uppercase text-zinc-100 outline-none"
        />
      </div>
    </Field>
  );
}
