import { spawn } from "node:child_process"
import { FfmpegError } from "../errors.ts"
import type { LoudnessMeasurement, ResolvedOptions } from "../types.ts"
import { extractFfmpegError, parseFfmpegProgress } from "./parse.ts"

/**
 * Apply loudnorm normalization (Pass 2) and write the output file.
 *
 * ffmpeg arguments:
 *   - Stream-copy video if present (-c:v copy)
 *   - Apply EBU R128 loudnorm filter
 *   - Re-encode audio with the specified codec/bitrate
 *   - Stream-copy subtitles and data tracks
 */
export async function normalizeMediaFile(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  measurement: LoudnessMeasurement | null,
  opts: ResolvedOptions,
  totalDuration: number,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const isMov = /\.(mp4|mov|m4a|m4v|3gp|3g2)$/i.test(inputPath)
    const args: string[] = [
      "-hide_banner",
      "-y",
      ...(isMov ? ["-ignore_editlist", "1"] : []),
      "-i",
      inputPath,
      "-map",
      "0",
    ]

    // Always add -c:v copy — ffmpeg ignores it when there's no video stream.
    args.push("-c:v", "copy")

    // Build loudnorm filter string
    const loudnormArgs = [`loudnorm=I=${opts.loudness}`, `LRA=${opts.lra}`, `TP=${opts.truePeak}`]

    // Validate measurement values — ffmpeg can return "-inf"/"nan" for
    // very quiet or silent content, causing "Numerical result out of range"
    // in Pass 2. Fall back to dynamic normalization when values are invalid.
    const isValidNum = (v: string): boolean => {
      const n = Number(v)
      return !Number.isNaN(n) && Number.isFinite(n)
    }

    if (
      measurement !== null &&
      isValidNum(measurement.inputI) &&
      isValidNum(measurement.inputLra) &&
      isValidNum(measurement.inputTp) &&
      isValidNum(measurement.inputThresh) &&
      isValidNum(measurement.offset)
    ) {
      loudnormArgs.push("linear=true")
      loudnormArgs.push(`measured_I=${measurement.inputI}`)
      loudnormArgs.push(`measured_LRA=${measurement.inputLra}`)
      loudnormArgs.push(`measured_TP=${measurement.inputTp}`)
      loudnormArgs.push(`measured_thresh=${measurement.inputThresh}`)
      loudnormArgs.push(`offset=${measurement.offset}`)
    }

    args.push("-af", loudnormArgs.join(":"))
    args.push("-c:a", opts.audioCodec)
    if (opts.audioBitrate && opts.audioBitrate.length > 0) {
      args.push("-b:a", opts.audioBitrate)
    }
    args.push("-c:s", "copy")
    args.push("-c:d", "copy")
    args.push(outputPath)

    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      timeout: 0, // must complete naturally; cancel via AbortSignal
    })

    let stderrBuffer = ""
    let currentDuration = 0

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      stderrBuffer += text

      const lines = text.split("\n")
      for (const line of lines) {
        const parsed = parseFfmpegProgress(line)
        if (parsed?.duration !== undefined) {
          currentDuration = parsed.duration
        }
      }

      if (onProgress && totalDuration > 0 && currentDuration > 0) {
        const percent = Math.min(100, Math.round((currentDuration / totalDuration) * 100))
        onProgress(percent)
      }
    })

    proc.on("error", (err) => {
      if (err.name === "AbortError") {
        resolve()
        return
      }
      reject(new FfmpegError(err.message))
    })

    proc.on("close", (code) => {
      if (signal?.aborted) {
        resolve()
        return
      }

      if (code !== 0) {
        const msg = extractFfmpegError(stderrBuffer)
        reject(new FfmpegError(msg || `Exited with code ${code}`, code))
        return
      }

      resolve()
    })
  })
}
