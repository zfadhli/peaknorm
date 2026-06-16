import { extname } from "node:path"
import type { BackupStrategy, NormalizeOptions, ResolvedOptions } from "./types.ts"

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
  const resolved: ResolvedOptions = { ...DEFAULTS }

  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined) {
      ;(resolved as unknown as Record<string, unknown>)[key] = value
    }
  }

  // Handle backup: boolean
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
