import { spawn, spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { FfmpegError } from "../errors.ts"
import type { MediaProbeResult } from "../types.ts"

/**
 * Resolve the path to ffprobe from the given ffmpeg path.
 * Tries same directory first, then falls back to PATH.
 */
function resolveFfprobe(ffmpegPath: string): string {
  if (ffmpegPath !== "ffmpeg") {
    const candidate = join(dirname(ffmpegPath), "ffprobe")
    const result = spawnSync(candidate, ["-version"], { stdio: "pipe", timeout: 5_000 })
    if (result.status === 0) return candidate
  }
  return "ffprobe"
}

/**
 * Probe a media file for its stream information using ffprobe.
 * ffprobe ships with every ffmpeg installation.
 */
export async function probeMedia(
  inputPath: string,
  ffmpegPath: string,
  signal?: AbortSignal,
): Promise<MediaProbeResult> {
  const ffprobePath = resolveFfprobe(ffmpegPath)

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
