import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { FfmpegNotFoundError } from "../errors.ts";

/**
 * Detect ffmpeg on the system PATH or at a custom path.
 * Throws FfmpegNotFoundError if not found.
 */
export function detectFfmpeg(customPath?: string): string {
	const binary = customPath ?? "ffmpeg";
	try {
		const result = spawnSync(binary, ["-version"], {
			stdio: "pipe",
			timeout: 5_000,
		});
		if (result.status === 0) {
			return binary;
		}
	} catch {
		// not found
	}
	throw new FfmpegNotFoundError(customPath);
}

/**
 * Resolve the path to ffprobe from the given ffmpeg path.
 * Tries the same directory as ffmpeg first, then falls back to PATH.
 * Returns `null` if ffprobe is not available.
 */
export function resolveFfprobePath(ffmpegPath: string): string | null {
	// Try same directory as the ffmpeg binary
	if (ffmpegPath !== "ffmpeg") {
		const dir = dirname(ffmpegPath);
		const candidate = join(dir, "ffprobe");
		try {
			const result = spawnSync(candidate, ["-version"], {
				stdio: "pipe",
				timeout: 5_000,
			});
			if (result.status === 0) return candidate;
		} catch {
			// not found in same dir, fall through
		}
	}

	// Fall back to PATH
	try {
		const result = spawnSync("ffprobe", ["-version"], {
			stdio: "pipe",
			timeout: 5_000,
		});
		if (result.status === 0) return "ffprobe";
	} catch {
		// not found
	}

	return null;
}
