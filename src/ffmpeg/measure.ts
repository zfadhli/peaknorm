import { spawn } from "node:child_process"
import { FfmpegError } from "../errors.ts"
import type { LoudnessMeasurement } from "../types.ts"
import { extractFfmpegError, parseFfmpegProgress } from "./parse.ts"

/**
 * Measure loudness of a media file using ffmpeg's loudnorm filter.
 *
 * Pass 1: runs loudnorm with `print_format=json`, parses the JSON output
 * from stderr. Returns the measured values for use in Pass 2,
 * or null if measurement failed.
 */
export async function measureLoudness(
  ffmpegPath: string,
  inputPath: string,
  loudness: number,
  lra: number,
  truePeak: number,
  totalDuration: number,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<LoudnessMeasurement | null> {
  return new Promise((resolve, reject) => {
    const isMov = /\.(mp4|mov|m4a|m4v|3gp|3g2)$/i.test(inputPath)
    const proc = spawn(
      ffmpegPath,
      [
        "-hide_banner",
        "-y",
        ...(isMov ? ["-ignore_editlist", "1"] : []),
        "-i",
        inputPath,
        "-af",
        `loudnorm=I=${loudness}:LRA=${lra}:TP=${truePeak}:print_format=json`,
        "-f",
        "null",
        "-",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        signal,
        timeout: 300_000, // 5 minutes
      },
    )

    let stderr = ""

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      stderr += text

      if (onProgress && totalDuration > 0) {
        const parsed = parseFfmpegProgress(text)
        if (parsed?.duration !== undefined && parsed.duration > 0) {
          const percent = Math.min(100, Math.round((parsed.duration / totalDuration) * 100))
          onProgress(percent)
        }
      }
    })

    proc.on("error", (err) => reject(err))
    proc.on("close", (code) => {
      if (code !== 0) {
        const msg = extractFfmpegError(stderr)
        reject(new FfmpegError(msg || `Exited with code ${code}`, code))
        return
      }
      try {
        const parsed = parseLoudnormJson(stderr)
        resolve(parsed)
      } catch {
        resolve(null)
      }
    })
  })
}

/**
 * Parse the loudnorm JSON output from ffmpeg stderr.
 *
 * ffmpeg outputs something like:
 *   [Parsed_loudnorm_0 @ 0x...] { "input_i": "-23.5", ... }
 *
 * Finds the first JSON object in stderr and validates its shape.
 */
function parseLoudnormJson(stderr: string): LoudnessMeasurement | null {
  // Find the first JSON object in ffmpeg stderr output
  const match = stderr.match(/\{[\s\S]*?\}/)
  if (!match) return null

  try {
    const data = JSON.parse(match[0]) as Record<string, string>

    if (
      typeof data.input_i === "string" &&
      typeof data.input_lra === "string" &&
      typeof data.input_tp === "string" &&
      typeof data.input_thresh === "string" &&
      typeof data.target_offset === "string"
    ) {
      return {
        inputI: data.input_i,
        inputLra: data.input_lra,
        inputTp: data.input_tp,
        inputThresh: data.input_thresh,
        offset: data.target_offset,
      }
    }
    return null
  } catch {
    return null
  }
}
