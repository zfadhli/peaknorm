#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { color, createCLI, createProgress } from "@zfadhli/koko-cli"
import { PeaknormError } from "./errors.ts"
import { detectFfmpeg } from "./ffmpeg/index.ts"
import { formatResult } from "./format.ts"
import { normalize } from "./normalize.ts"
import type { BackupStrategy, NormalizeResult } from "./types.ts"

interface OptionMapping {
  cliName: string
  normalizeName: string
  coerce?: (val: unknown) => unknown
}

const OPTION_MAPPINGS: OptionMapping[] = [
  { cliName: "output", normalizeName: "output" },
  { cliName: "loudness", normalizeName: "loudness", coerce: Number },
  { cliName: "lra", normalizeName: "lra", coerce: Number },
  { cliName: "truePeak", normalizeName: "truePeak", coerce: Number },
  { cliName: "audioCodec", normalizeName: "audioCodec" },
  { cliName: "audioBitrate", normalizeName: "audioBitrate" },
  { cliName: "recursive", normalizeName: "recursive" },
  { cliName: "ext", normalizeName: "extensions" },
  { cliName: "ffmpegPath", normalizeName: "ffmpegPath" },
  { cliName: "dryRun", normalizeName: "dryRun" },
  { cliName: "sortBy", normalizeName: "sortBy" },
  { cliName: "sortOrder", normalizeName: "sortOrder" },
]

function getVersion(): string {
  try {
    const dirname = import.meta.dirname ?? process.cwd()
    const pkgPath = resolve(dirname, "../package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version: string
    }
    return pkg.version
  } catch {
    return "0.0.0"
  }
}

const cli = createCLI("peaknorm", getVersion()).description(
  "Normalize audio in media files using EBU R128 (ffmpeg loudnorm)",
)

cli.command("[input]", "File or folder to normalize", (cmd) => {
  cmd.option("-o, --output <dir>", "Output directory (default: same as input)")
  cmd.option("-l, --loudness <num>", "Target loudness in LUFS (default: -14)")
  cmd.option("--lra <num>", "Loudness range in LU (default: 7)")
  cmd.option("-tp, --true-peak <num>", "True peak limit in dBTP (default: -2)")
  cmd.option("--audio-codec <name>", "Audio codec (default: libopus)")
  cmd.option("--audio-bitrate <str>", "Audio bitrate (default: 96k)")
  cmd.option("-b, --backup <strategy>", "Backup strategy: copy|folder|suffix (default: disabled)")
  cmd.option("-r, --recursive", "Recurse subdirectories (default: true)")
  cmd.option("-e, --ext <ext>", "File extensions to process (repeatable)")
  cmd.option("--ffmpeg-path <path>", "Custom ffmpeg binary path")
  cmd.option("--dry-run", "Preview without processing")
  cmd.option("--sort-by <method>", "Sort files by: name|mtime (default: name)")
  cmd.option("--sort-order <dir>", "Sort direction: asc|desc (default: asc)")
  cmd.option("--verbose", "Verbose output")

  cmd.action(async (options: Record<string, unknown>) => {
    const inputArg = options.input as string | undefined
    if (!inputArg) {
      console.error("error: missing required input path")
      process.exit(1)
    }

    // Detect ffmpeg early
    try {
      detectFfmpeg(options.ffmpegPath as string | undefined)
    } catch (err) {
      console.error(err instanceof PeaknormError ? err.message : String(err))
      process.exit(1)
    }

    // ─── Resolve backup ──────────────────────────────────
    const backup: BackupStrategy | false =
      options.backup === undefined
        ? false
        : typeof options.backup === "string"
          ? (options.backup as BackupStrategy)
          : "copy"

    // ─── Build options object via schema mapping ──────────
    const cliOpts = options as Record<string, unknown>
    const normalizeOpts: Record<string, unknown> = {}
    for (const mapping of OPTION_MAPPINGS) {
      const val = cliOpts[mapping.cliName]
      if (val !== undefined) {
        normalizeOpts[mapping.normalizeName] = mapping.coerce ? mapping.coerce(val) : val
      }
    }
    normalizeOpts.backup = backup

    const verbose = cliOpts.verbose === true

    if (verbose) {
      console.error(`Input: ${inputArg}`)
      console.error(`Options: ${JSON.stringify(normalizeOpts, null, 2)}`)
    }

    // ─── Progress bar instance ────────────────────────
    let progressBar: ReturnType<typeof createProgress> | null = null

    // ─── Run normalization ────────────────────────────────
    try {
      const batch = await normalize(inputArg, {
        ...normalizeOpts,
        onFileStart: (input) => {
          if (progressBar) {
            progressBar.stop()
          }
          progressBar = createProgress({
            total: 100,
            clearOnComplete: true,
            format: "{phase} [{bar}] {percentage}% | {file}",
          })
          progressBar.update(0, {
            phase: "Analyzing",
            file: basename(input),
          })
        },
        onFileProgress: (_file, percent, phase) => {
          if (!progressBar) return
          const label = phase === "analyzing" ? "Analyzing" : "Normalizing"
          progressBar.update(percent, {
            phase: label,
            file: basename(_file),
          })
        },
        onFileComplete: (result: NormalizeResult) => {
          if (progressBar) {
            progressBar.stop()
            progressBar = null
          }
          writeFormattedResult(result)
        },
      })

      console.error(
        `\n${color.blue("Done:")} ${color.green(String(batch.completed))}/${batch.total} files processed` +
          (batch.errors > 0 ? `, ${color.red(String(batch.errors))} errors` : "") +
          ` (${(batch.durationMs / 1000).toFixed(1)}s)`,
      )

      if (batch.errors > 0) {
        process.exit(1)
      }
    } catch (err) {
      if (err instanceof PeaknormError) {
        console.error(err.message)
      } else {
        console.error(String(err))
      }
      process.exit(1)
    }
  })
})

cli.parse()

// ─── Result printer ──────────────────────────────────
function writeFormattedResult(result: NormalizeResult): void {
  const lines = formatResult(result)
  for (const line of lines) {
    // Apply color based on status prefix
    if (line === "[completed]") {
      console.error(color.green(line))
    } else if (line === "[skipped]") {
      console.error(color.yellow(line))
    } else if (line === "[error]") {
      console.error(color.red(line))
    } else if (line.startsWith("  error:")) {
      console.error(color.red(line))
    } else {
      console.error(color.white(line))
    }
  }
}
