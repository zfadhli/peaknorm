export class PeaknormError extends Error {
  override name = "PeaknormError"
}

export class FfmpegNotFoundError extends PeaknormError {
  override name = "FfmpegNotFoundError"

  constructor(path?: string) {
    super(
      path
        ? `FFmpeg not found at "${path}"`
        : "FFmpeg not found on PATH. Install ffmpeg or set --ffmpeg-path.",
    )
  }
}

export class FfmpegError extends PeaknormError {
  override name = "FfmpegError"

  constructor(message: string, exitCode?: number | null) {
    super(`FFmpeg error: ${message}${exitCode != null ? ` (exit code ${exitCode})` : ""}`)
  }
}

export class NormalizeError extends PeaknormError {
  override name = "NormalizeError"

  constructor(file: string, cause?: string) {
    super(`Failed to normalize "${file}"${cause ? `: ${cause}` : ""}`)
  }
}

export class BackupError extends PeaknormError {
  override name = "BackupError"

  constructor(file: string, cause?: string) {
    super(`Failed to backup "${file}"${cause ? `: ${cause}` : ""}`)
  }
}

export class NoMediaFilesError extends PeaknormError {
  override name = "NoMediaFilesError"

  constructor(path: string) {
    super(`No media files found in "${path}"`)
  }
}
