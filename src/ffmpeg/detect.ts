import { spawnSync } from "node:child_process"
import { FfmpegNotFoundError } from "../errors.ts"

/**
 * Detect ffmpeg on the system PATH or at a custom path.
 * Throws FfmpegNotFoundError if not found.
 */
export function detectFfmpeg(customPath?: string): string {
  const binary = customPath ?? "ffmpeg"
  try {
    const result = spawnSync(binary, ["-version"], {
      stdio: "pipe",
      timeout: 5_000,
    })
    if (result.status === 0) {
      return binary
    }
  } catch {
    // not found
  }
  throw new FfmpegNotFoundError(customPath)
}
