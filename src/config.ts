import { extname } from "node:path"
import type { BackupStrategy, NormalizeOptions, PresetName, ResolvedOptions } from "./types.ts"

/**
 * Named presets for common use cases.
 * Individual options (loudness, lra, etc.) override preset values.
 */
export const PRESETS: Record<PresetName, Partial<ResolvedOptions>> = {
  music: { loudness: -14, lra: 7, truePeak: -2, audioCodec: "libopus", audioBitrate: "320k" },
  podcast: { loudness: -16, lra: 5, truePeak: -1, audioCodec: "libopus", audioBitrate: "96k" },
  "streaming-video": {
    loudness: -23,
    lra: 7,
    truePeak: -2,
    audioCodec: "aac",
    audioBitrate: "128k",
  },
}

export const DEFAULT_EXTENSIONS: string[] = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".webm",
  ".m4v",
  ".ts",
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".ogg",
  ".wma",
  ".aac",
  ".opus",
]

const DEFAULTS: ResolvedOptions = {
  loudness: -14,
  lra: 7,
  truePeak: -2,
  audioCodec: "libopus",
  audioBitrate: "96k",
  output: null,
  backup: false,
  recursive: true,
  extensions: DEFAULT_EXTENSIONS,
  ffmpegPath: "ffmpeg",
  dryRun: false,
  dynamic: false,
  lowerOnly: false,
  batch: false,
  sharedMeasurement: null,
  signal: null,
  sortBy: "name",
  sortOrder: "asc",
  onFileStart: null,
  onFileProgress: null,
  onFileComplete: null,
  onFileError: null,
}

/**
 * Resolve user-provided options against defaults.
 */
export function resolveOptions(opts: NormalizeOptions = {}): ResolvedOptions {
  // Apply preset first (if any), then individual options override
  const preset = opts.preset ? PRESETS[opts.preset] : {}

  // Map each option explicitly — verbose but fully type-safe.
  // Priority: preset < explicit option < coercion-needed fields.
  const resolved: ResolvedOptions = {
    loudness: opts.loudness ?? preset.loudness ?? DEFAULTS.loudness,
    lra: opts.lra ?? preset.lra ?? DEFAULTS.lra,
    truePeak: opts.truePeak ?? preset.truePeak ?? DEFAULTS.truePeak,
    audioCodec: opts.audioCodec ?? preset.audioCodec ?? DEFAULTS.audioCodec,
    audioBitrate: opts.audioBitrate ?? preset.audioBitrate ?? DEFAULTS.audioBitrate,
    output: opts.output ?? DEFAULTS.output,
    recursive: opts.recursive ?? DEFAULTS.recursive,
    ffmpegPath: opts.ffmpegPath ?? DEFAULTS.ffmpegPath,
    dryRun: opts.dryRun ?? DEFAULTS.dryRun,
    dynamic: opts.dynamic ?? DEFAULTS.dynamic,
    lowerOnly: opts.lowerOnly ?? DEFAULTS.lowerOnly,
    batch: opts.batch ?? DEFAULTS.batch,
    sharedMeasurement: opts.sharedMeasurement ?? DEFAULTS.sharedMeasurement,
    sortBy: opts.sortBy ?? DEFAULTS.sortBy,
    sortOrder: opts.sortOrder ?? DEFAULTS.sortOrder,
    signal: opts.signal ?? DEFAULTS.signal,
    onFileStart: opts.onFileStart ?? DEFAULTS.onFileStart,
    onFileProgress: opts.onFileProgress ?? DEFAULTS.onFileProgress,
    onFileComplete: opts.onFileComplete ?? DEFAULTS.onFileComplete,
    onFileError: opts.onFileError ?? DEFAULTS.onFileError,
    // Fields with coercion logic — set defaults, then conditionally override
    backup: false,
    extensions: DEFAULTS.extensions,
  }

  // Handle backup: boolean → strategy
  if (opts.backup === false || opts.backup === undefined) {
    resolved.backup = false
  } else if (opts.backup === true) {
    resolved.backup = "copy"
  } else if (typeof opts.backup === "string") {
    resolved.backup = opts.backup as BackupStrategy
  }

  // Handle extensions: normalize to dot-prefixed lowercase
  if (opts.extensions) {
    resolved.extensions = opts.extensions.map((e) =>
      e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`,
    )
  }

  return resolved
}

/**
 * Generate a temporary output path for in-place processing.
 * Uses `<original>.<ext>.peaknorm-tmp` pattern.
 */
export function tempOutputPath(inputPath: string): string {
  const ext = extname(inputPath)
  const base = inputPath.slice(0, -ext.length)
  return `${base}.peaknorm-tmp${ext}`
}
