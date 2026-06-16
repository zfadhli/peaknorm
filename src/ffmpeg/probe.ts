import { spawn } from "node:child_process"
import { FfmpegError } from "../errors.ts"
import type { MediaProbeResult } from "../types.ts"
import { resolveFfprobePath } from "./detect.ts"

/**
 * Probe a media file for its stream information.
 *
 * Uses `ffprobe` with JSON output for reliable structured parsing.
 * Falls back to parsing `ffmpeg -i` stderr if ffprobe is not available.
 *
 * ffprobe is part of the ffmpeg project and ships with every ffmpeg
 * installation, so the fallback is only for edge cases.
 */
export async function probeMedia(
  inputPath: string,
  ffmpegPath: string,
  signal?: AbortSignal,
): Promise<MediaProbeResult> {
  const ffprobePath = resolveFfprobePath(ffmpegPath)

  if (ffprobePath) {
    return probeWithFfprobe(ffprobePath, inputPath, signal)
  }

  // Fallback: parse ffmpeg -i stderr
  return probeWithFfmpeg(ffmpegPath, inputPath, signal)
}

/**
 * Probe using ffprobe with JSON output — reliable, no race conditions.
 */
async function probeWithFfprobe(
  ffprobePath: string,
  inputPath: string,
  signal?: AbortSignal,
): Promise<MediaProbeResult> {
  return new Promise<MediaProbeResult>((resolve, reject) => {
    const proc = spawn(
      ffprobePath,
      ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", inputPath],
      {
        stdio: ["ignore", "pipe", "pipe"],
        signal,
        timeout: 30_000,
      },
    )

    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8")
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8")
    })

    proc.on("error", (err) => reject(err))

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new FfmpegError(`ffprobe exited with code ${code}: ${stderr.trim() || "unknown error"}`),
        )
        return
      }

      try {
        const data = JSON.parse(stdout) as {
          streams?: Array<{ codec_type?: string }>
          format?: { duration?: string }
        }

        const duration = data.format?.duration ? Number.parseFloat(data.format.duration) : 0

        const hasVideo = data.streams?.some((s) => s.codec_type === "video") ?? false
        const hasAudio = data.streams?.some((s) => s.codec_type === "audio") ?? false

        resolve({ hasVideo, hasAudio, duration })
      } catch (err) {
        reject(
          new FfmpegError(
            `Failed to parse ffprobe output: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
      }
    })
  })
}

/**
 * Fallback probe using `ffmpeg -i` stderr parsing.
 * Used when ffprobe is not available.
 */
async function probeWithFfmpeg(
  ffmpegPath: string,
  inputPath: string,
  signal?: AbortSignal,
): Promise<MediaProbeResult> {
  return new Promise<MediaProbeResult>((resolve, reject) => {
    const proc = spawn(
      ffmpegPath,
      ["-hide_banner", "-i", inputPath, "-ignore_editlist", "1", "-f", "null", "-"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        signal,
        timeout: 30_000,
      },
    )

    let stderr = ""
    let resolved = false

    function tryResolve(): void {
      if (resolved) return
      const hasDuration = /Duration:\s*\d+:\d+:\d+\.\d+/.test(stderr)
      const hasStreams = /Stream #/.test(stderr)
      if (hasDuration && hasStreams) {
        resolved = true
        const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
        const duration = durMatch
          ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])
          : 0
        const hasVideo = /Stream.*Video:/i.test(stderr)
        const hasAudio = /Stream.*Audio:/i.test(stderr)
        proc.kill("SIGTERM")
        resolve({ hasVideo, hasAudio, duration })
      }
    }

    proc.stdout?.on("data", () => {
      // discard stdout
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8")
      tryResolve()
    })

    proc.on("error", (err) => {
      if (!resolved) reject(err)
    })

    proc.on("close", () => {
      if (!resolved) {
        // ffmpeg finished before we killed it, or file has no duration
        const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
        const duration = durMatch
          ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])
          : 0
        const hasVideo = /Stream.*Video:/i.test(stderr)
        const hasAudio = /Stream.*Audio:/i.test(stderr)
        resolved = true
        resolve({ hasVideo, hasAudio, duration })
      }
    })
  })
}
