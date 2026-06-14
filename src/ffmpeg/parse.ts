/**
 * Parse ffmpeg stderr progress line for time and size.
 *
 * Example ffmpeg output:
 *   frame=  123 fps= 30 q=28.0 size=    1024kB time=00:01:23.45 ...
 */
export function parseFfmpegProgress(
	line: string,
): { duration?: number; sizeBytes?: number } | null {
	const result: { duration?: number; sizeBytes?: number } = {};

	const timeMatch = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
	if (timeMatch) {
		const hours = Number(timeMatch[1]);
		const minutes = Number(timeMatch[2]);
		const seconds = Number(timeMatch[3]);
		result.duration = hours * 3600 + minutes * 60 + seconds;
	}

	const sizeMatch = line.match(/size=\s*(\d+)(\w?)B/);
	if (sizeMatch) {
		const value = Number(sizeMatch[1]);
		const unit = sizeMatch[2] ?? "";
		if (unit === "k" || unit === "K") {
			result.sizeBytes = value * 1024;
		} else if (unit === "m" || unit === "M") {
			result.sizeBytes = value * 1024 * 1024;
		} else {
			result.sizeBytes = value;
		}
	}

	return result.duration !== undefined || result.sizeBytes !== undefined
		? result
		: null;
}

/**
 * Extract a meaningful error message from ffmpeg stderr.
 */
export function extractFfmpegError(stderr: string): string {
	const lines = stderr.split("\n").filter((l) => l.trim().length > 0);

	const errorLines = lines.filter(
		(l) =>
			l.toLowerCase().includes("error") ||
			l.toLowerCase().includes("invalid") ||
			l.toLowerCase().includes("cannot"),
	);

	if (errorLines.length > 0) {
		return errorLines[0]?.trim() ?? "";
	}

	return lines[lines.length - 1]?.trim() ?? "Unknown ffmpeg error";
}
