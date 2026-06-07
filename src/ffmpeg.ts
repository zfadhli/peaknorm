import { spawn, spawnSync } from "node:child_process";
import { FfmpegError, FfmpegNotFoundError } from "./errors.ts";
import type {
	LoudnessMeasurement,
	MediaProbeResult,
	ResolvedOptions,
} from "./types.ts";
import { extractFfmpegError, parseFfmpegProgress } from "./utils.ts";

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
 * Probe a media file for its stream information.
 * Runs `ffmpeg -i` and parses the stderr output.
 *
 * Kills ffmpeg early once the Duration header is parsed —
 * this takes ~200ms instead of waiting for the full decode.
 */
export async function probeMedia(
	inputPath: string,
	ffmpegPath: string,
	signal?: AbortSignal,
): Promise<MediaProbeResult> {
	return new Promise<MediaProbeResult>((resolve, reject) => {
		const proc = spawn(
			ffmpegPath,
			["-hide_banner", "-i", inputPath, "-f", "null", "-"],
			{
				stdio: ["ignore", "pipe", "pipe"],
				signal,
				timeout: 30_000,
			},
		);

		let stderr = "";
		let resolved = false;

		function tryResolve(): void {
			if (resolved) return;
			const hasDuration = /Duration:\s*\d+:\d+:\d+\.\d+/.test(stderr);
			const hasStreams = /Stream #/.test(stderr);
			if (hasDuration && hasStreams) {
				resolved = true;
				const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
				const duration = durMatch
					? Number(durMatch[1]) * 3600 +
						Number(durMatch[2]) * 60 +
						Number(durMatch[3])
					: 0;
				const hasVideo = /Stream.*Video:/i.test(stderr);
				const hasAudio = /Stream.*Audio:/i.test(stderr);
				proc.kill("SIGTERM");
				resolve({ hasVideo, hasAudio, duration });
			}
		}

		proc.stdout?.on("data", () => {
			// discard stdout
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf-8");
			tryResolve();
		});

		proc.on("error", (err) => {
			if (!resolved) reject(err);
		});

		proc.on("close", () => {
			if (!resolved) {
				// ffmpeg finished before we killed it, or file has no duration
				const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
				const duration = durMatch
					? Number(durMatch[1]) * 3600 +
						Number(durMatch[2]) * 60 +
						Number(durMatch[3])
					: 0;
				const hasVideo = /Stream.*Video:/i.test(stderr);
				const hasAudio = /Stream.*Audio:/i.test(stderr);
				resolved = true;
				resolve({ hasVideo, hasAudio, duration });
			}
		});
	});
}

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
		const proc = spawn(
			ffmpegPath,
			[
				"-hide_banner",
				"-y",
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
		);

		let stderr = "";

		proc.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf-8");
			stderr += text;

			if (onProgress && totalDuration > 0) {
				const parsed = parseFfmpegProgress(text);
				if (parsed?.duration !== undefined && parsed.duration > 0) {
					const percent = Math.min(
						100,
						Math.round((parsed.duration / totalDuration) * 100),
					);
					onProgress(percent);
				}
			}
		});

		proc.on("error", (err) => reject(err));
		proc.on("close", (code) => {
			if (code !== 0) {
				resolve(null);
				return;
			}
			try {
				const parsed = parseLoudnormJson(stderr);
				resolve(parsed);
			} catch {
				resolve(null);
			}
		});
	});
}

/**
 * Parse the loudnorm JSON output from ffmpeg stderr.
 *
 * ffmpeg outputs something like:
 *   [Parsed_loudnorm_0 @ 0x...] { "input_i": "-23.5", ... }
 */
function parseLoudnormJson(stderr: string): LoudnessMeasurement | null {
	try {
		let start = -1;
		let depth = 0;

		for (let i = 0; i < stderr.length; i++) {
			const ch = stderr[i];
			if (ch === "{") {
				if (start === -1) {
					start = i;
				}
				depth++;
			} else if (ch === "}") {
				depth--;
				if (depth === 0 && start !== -1) {
					const jsonStr = stderr.slice(start, i + 1);
					const data = JSON.parse(jsonStr) as Record<string, string>;

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
						};
					}
					return null;
				}
			}
		}
	} catch {
		// JSON parse failure
	}

	return null;
}

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
	measurement: LoudnessMeasurement,
	opts: ResolvedOptions,
	totalDuration: number,
	signal?: AbortSignal,
	onProgress?: (percent: number) => void,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const args: string[] = ["-hide_banner", "-y", "-i", inputPath, "-map", "0"];

		// Determine if input has video by probing first (done upstream)
		// We use opts' ffmpegPath to detect again, but caller already probed.
		// We rely on the caller to pass hasVideo via... we need to probe here too.
		// Actually, probeMedia is called in normalize.ts before this function.
		// We'll accept hasVideo as a separate param. But since the options
		// don't include it, let's re-probe quickly.

		// For now, use a synchronous check via args:
		// Actually, let's just always add -c:v copy — ffmpeg ignores it
		// when there's no video stream.
		args.push("-c:v", "copy");

		// Build loudnorm filter string
		const loudnormArgs = [
			`loudnorm=I=${opts.loudness}`,
			`LRA=${opts.lra}`,
			`TP=${opts.truePeak}`,
			"linear=true",
			`measured_I=${measurement.inputI}`,
			`measured_LRA=${measurement.inputLra}`,
			`measured_TP=${measurement.inputTp}`,
			`measured_thresh=${measurement.inputThresh}`,
			`offset=${measurement.offset}`,
		];

		args.push("-af", loudnormArgs.join(":"));
		args.push("-c:a", opts.audioCodec);
		if (opts.audioBitrate && opts.audioBitrate.length > 0) {
			args.push("-b:a", opts.audioBitrate);
		}
		args.push("-c:s", "copy");
		args.push("-c:d", "copy");
		args.push(outputPath);

		const proc = spawn(ffmpegPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			signal,
			timeout: 600_000, // 10 minutes
		});

		let stderrBuffer = "";
		let currentDuration = 0;

		proc.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf-8");
			stderrBuffer += text;

			const lines = text.split("\n");
			for (const line of lines) {
				const parsed = parseFfmpegProgress(line);
				if (parsed?.duration !== undefined) {
					currentDuration = parsed.duration;
				}
			}

			if (onProgress && totalDuration > 0 && currentDuration > 0) {
				const percent = Math.min(
					100,
					Math.round((currentDuration / totalDuration) * 100),
				);
				onProgress(percent);
			}
		});

		proc.on("error", (err) => {
			if (err.name === "AbortError") {
				resolve();
				return;
			}
			reject(new FfmpegError(err.message));
		});

		proc.on("close", (code) => {
			if (signal?.aborted) {
				resolve();
				return;
			}

			if (code !== 0) {
				const msg = extractFfmpegError(stderrBuffer);
				reject(new FfmpegError(msg || `Exited with code ${code}`, code));
				return;
			}

			resolve();
		});
	});
}
