import { renameSync, statSync, unlinkSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import type { BackupResult } from "./backup.ts"
import { createBackup, deleteBackup, restoreBackup } from "./backup.ts"
import { resolveOptions, tempOutputPath } from "./config.ts"
import { NoMediaFilesError, NormalizeError } from "./errors.ts"
import { detectFfmpeg, measureLoudness, normalizeMediaFile, probeMedia } from "./ffmpeg/index.ts"
import { getFileSize, isDirectory, isFile } from "./fs.ts"
import { findMediaFiles } from "./media.ts"
import type {
  BatchResult,
  LoudnessMeasurement,
  NormalizeOptions,
  NormalizeResult,
} from "./types.ts"

/**
 * Clean up after a failed normalization attempt.
 * Deletes the temp output file and restores the original from backup.
 */
function cleanupAfterError(
  outputPath: string,
  backupResult: BackupResult | null,
  useTemp: boolean,
  inputPath: string,
): void {
  try {
    unlinkSync(outputPath)
  } catch {
    // ignore — temp file may not exist
  }

  if (backupResult && useTemp) {
    try {
      restoreBackup(backupResult, inputPath)
    } catch {
      // ignore restore failure
    }
  }
}

/**
 * Normalize a single media file.
 *
 * Pipeline:
 *   1. Detect ffmpeg
 *   2. Probe file (video/audio streams, duration)
 *   3. Create backup
 *   4. Measure loudness (Pass 1)
 *   5. Normalize audio (Pass 2)
 *   6. On success: move temp → original, delete backup
 *   7. On failure: delete temp, restore backup, throw
 */
export async function normalizeFile(
  inputPath: string,
  opts: NormalizeOptions = {},
): Promise<NormalizeResult> {
  const resolved = resolveOptions(opts)
  const startTime = performance.now()
  const inputSize = getFileSize(inputPath)

  if (!isFile(inputPath)) {
    throw new NormalizeError(inputPath, "File does not exist")
  }

  // Dry-run: skip actual processing (no ffmpeg needed)
  if (resolved.dryRun) {
    const dryOutput = resolved.output
      ? join(resolved.output, basename(inputPath))
      : tempOutputPath(inputPath)
    resolved.onFileStart?.(inputPath, dryOutput, 1, 1)
    const result: NormalizeResult = {
      input: inputPath,
      output: dryOutput,
      status: "skipped",
      inputSizeBytes: inputSize,
      outputSizeBytes: 0,
      durationMs: 0,
    }
    resolved.onFileComplete?.(result)
    return result
  }

  // Resolve ffmpeg path
  const ffmpegPath = detectFfmpeg(resolved.ffmpegPath)

  // Determine output path
  const outputDir = resolved.output ? join(resolved.output, basename(inputPath)) : null

  const useTemp = outputDir === null
  const outputPath = outputDir ?? tempOutputPath(inputPath)

  resolved.onFileStart?.(inputPath, outputPath, 1, 1)

  // Create backup for in-place normalization
  let backupResult: ReturnType<typeof createBackup> | null = null
  if (useTemp && resolved.backup !== false) {
    backupResult = createBackup(inputPath, resolved.backup)
  }

  try {
    // Probe file (duration, stream info)
    const probe = await probeMedia(inputPath, ffmpegPath, resolved.signal ?? undefined)

    if (!probe.hasAudio) {
      throw new NormalizeError(inputPath, "No audio stream found in the file")
    }

    // Measure loudness (Pass 1) — skipped in dynamic mode
    // In album batch mode, uses the shared measurement computed from all files
    let measurement: LoudnessMeasurement | null = null
    if (!resolved.dynamic) {
      measurement =
        resolved.sharedMeasurement ??
        (await measureLoudness(
          ffmpegPath,
          inputPath,
          resolved.loudness,
          resolved.lra,
          resolved.truePeak,
          probe.duration,
          resolved.signal ?? undefined,
          (pct) => resolved.onFileProgress?.(basename(inputPath), pct, "analyzing"),
        ))

      if (!measurement) {
        throw new NormalizeError(inputPath, "Failed to parse loudnorm measurement output")
      }
    }

    // lowerOnly: skip if already at or below the target loudness
    if (
      resolved.lowerOnly &&
      measurement !== null &&
      Number(measurement.inputI) <= resolved.loudness
    ) {
      // Clean up temp file if it was created, restore backup
      if (useTemp) {
        try {
          unlinkSync(outputPath)
        } catch {
          // ignore
        }
        if (backupResult) {
          try {
            restoreBackup(backupResult, inputPath)
          } catch {
            // ignore
          }
        }
      }
      if (backupResult) {
        deleteBackup(backupResult)
      }
      resolved.onFileProgress?.(basename(inputPath), 100, "normalizing")
      const result: NormalizeResult = {
        input: inputPath,
        output: inputPath,
        status: "skipped",
        inputSizeBytes: inputSize,
        outputSizeBytes: 0,
        durationMs: Math.round(performance.now() - startTime),
      }
      resolved.onFileComplete?.(result)
      return result
    }

    // Normalize audio (Pass 2) — null measurement = dynamic one-pass mode
    await normalizeMediaFile(
      ffmpegPath,
      inputPath,
      outputPath,
      measurement,
      resolved,
      probe.duration,
      resolved.signal ?? undefined,
      (pct) => resolved.onFileProgress?.(basename(inputPath), pct, "normalizing"),
    )

    // If in-place, move temp to original
    if (useTemp) {
      renameSync(outputPath, inputPath)
    }

    // Delete backup on success
    if (backupResult) {
      deleteBackup(backupResult)
    }

    const endTime = performance.now()
    const finalPath = useTemp ? inputPath : outputPath
    const outputSize = getFileSize(finalPath)

    const result: NormalizeResult = {
      input: inputPath,
      output: finalPath,
      status: "completed",
      inputSizeBytes: inputSize,
      outputSizeBytes: outputSize,
      durationMs: Math.round(endTime - startTime),
    }

    resolved.onFileComplete?.(result)
    return result
  } catch (err) {
    cleanupAfterError(outputPath, backupResult, useTemp, inputPath)

    const error = err instanceof Error ? err : new NormalizeError(inputPath, String(err))

    resolved.onFileError?.(inputPath, error)

    const result: NormalizeResult = {
      input: inputPath,
      output: outputPath,
      status: "error",
      error: error.message,
      backupPath: backupResult?.path,
      inputSizeBytes: inputSize,
      outputSizeBytes: 0,
      durationMs: Math.round(performance.now() - startTime),
    }

    resolved.onFileComplete?.(result)
    return result
  }
}

/**
 * Normalize all media files in a directory.
 */
export async function normalizeFolder(
  dirPath: string,
  opts: NormalizeOptions = {},
): Promise<BatchResult> {
  const resolved = resolveOptions(opts)
  const batchStart = performance.now()

  if (!isDirectory(dirPath)) {
    throw new NormalizeError(dirPath, "Directory does not exist")
  }

  const files = findMediaFiles(dirPath, resolved.extensions, resolved.recursive)

  if (files.length === 0) {
    throw new NoMediaFilesError(dirPath)
  }

  // Sort files based on options
  const sorted =
    resolved.sortBy === "name"
      ? resolved.sortOrder === "asc"
        ? files
        : [...files].reverse()
      : files
          .map((f) => {
            let mtime = 0
            try {
              mtime = statSync(f).mtimeMs
            } catch {
              // file may have been removed between discovery and sorting
            }
            return { path: f, mtime }
          })
          .sort((a, b) => (resolved.sortOrder === "asc" ? a.mtime - b.mtime : b.mtime - a.mtime))
          .map((e) => e.path)

  // Album batch mode: measure all files first, compute unified measurement
  let sharedMeasurement: LoudnessMeasurement | null = null
  if (resolved.batch && !resolved.dryRun && !resolved.dynamic) {
    const ffmpegPath = detectFfmpeg(resolved.ffmpegPath)
    const measurements: LoudnessMeasurement[] = []

    for (const file of sorted) {
      try {
        const probe = await probeMedia(file, ffmpegPath, resolved.signal ?? undefined)
        if (!probe.hasAudio) continue

        const m = await measureLoudness(
          ffmpegPath,
          file,
          resolved.loudness,
          resolved.lra,
          resolved.truePeak,
          probe.duration,
          resolved.signal ?? undefined,
        )
        if (m) measurements.push(m)
      } catch {
        // skip files that fail measurement in batch pre-scan
      }
    }

    if (measurements.length > 0) {
      // Compute average measurement across all files
      const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

      sharedMeasurement = {
        inputI: String(avg(measurements.map((m) => Number(m.inputI)))),
        inputLra: String(avg(measurements.map((m) => Number(m.inputLra)))),
        inputTp: String(avg(measurements.map((m) => Number(m.inputTp)))),
        inputThresh: String(avg(measurements.map((m) => Number(m.inputThresh)))),
        offset: String(avg(measurements.map((m) => Number(m.offset)))),
      }
    }
  }

  // Pass shared measurement to normalizeFile via opts
  const batchOpts: NormalizeOptions = sharedMeasurement ? { ...opts, sharedMeasurement } : opts

  const results: NormalizeResult[] = []
  let completed = 0
  let skipped = 0
  let errors = 0

  for (const [fileIndex, file] of sorted.entries()) {
    // Wrap onFileStart to pass index/total for batch progress display
    const fileOpts: NormalizeOptions = {
      ...batchOpts,
      onFileStart: (input: string, output: string) => {
        batchOpts.onFileStart?.(input, output, fileIndex + 1, sorted.length)
      },
    }
    try {
      const result = await normalizeFile(file, fileOpts)
      results.push(result)
      if (result.status === "completed") completed++
      else if (result.status === "skipped") skipped++
      else errors++
    } catch (err) {
      errors++
      const result: NormalizeResult = {
        input: file,
        output: file,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        inputSizeBytes: 0,
        outputSizeBytes: 0,
        durationMs: 0,
      }
      results.push(result)
      resolved.onFileComplete?.(result)
    }
  }

  return {
    total: files.length,
    completed,
    skipped,
    errors,
    results,
    durationMs: Math.round(performance.now() - batchStart),
  }
}

/**
 * Normalize a file or folder. Auto-detects which one.
 */
export async function normalize(
  inputPath: string,
  opts: NormalizeOptions = {},
): Promise<BatchResult> {
  const resolvedPath = resolve(inputPath)

  if (isFile(resolvedPath)) {
    const result = await normalizeFile(resolvedPath, opts)
    return {
      total: 1,
      completed: result.status === "completed" ? 1 : 0,
      skipped: result.status === "skipped" ? 1 : 0,
      errors: result.status === "error" ? 1 : 0,
      results: [result],
      durationMs: result.durationMs,
    }
  }

  if (isDirectory(resolvedPath)) {
    return normalizeFolder(resolvedPath, opts)
  }

  throw new NormalizeError(inputPath, "Path does not exist or is not a file/directory")
}
