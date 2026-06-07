import { renameSync, unlinkSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
	createBackup,
	deleteBackup,
	getFileSize,
	restoreBackup,
} from "./backup.ts";
import { NoMediaFilesError, NormalizeError } from "./errors.ts";
import {
	detectFfmpeg,
	measureLoudness,
	normalizeMediaFile,
	probeMedia,
} from "./ffmpeg.ts";
import type {
	BackupStrategy,
	BatchResult,
	NormalizeOptions,
	NormalizeResult,
	ResolvedOptions,
} from "./types.ts";
import { findMediaFiles, isDirectory, isFile } from "./utils.ts";

const DEFAULT_EXTENSIONS: string[] = [
	".mp4",
	".mkv",
	".avi",
	".mov",
	".webm",
	".m4v",
	".ts",
	".mp3",
	".wav",
	".flac",
	".m4a",
	".ogg",
	".wma",
	".aac",
	".opus",
];

const DEFAULTS: ResolvedOptions = {
	loudness: -14,
	lra: 7,
	truePeak: -2,
	audioCodec: "libopus",
	audioBitrate: "96k",
	output: null,
	backup: "copy",
	recursive: true,
	extensions: DEFAULT_EXTENSIONS,
	ffmpegPath: "ffmpeg",
	dryRun: false,
	signal: null,
	onFileStart: null,
	onFileProgress: null,
	onFileComplete: null,
	onFileError: null,
};

function resolveOptions(opts: NormalizeOptions = {}): ResolvedOptions {
	const resolved: ResolvedOptions = { ...DEFAULTS };

	for (const [key, value] of Object.entries(opts)) {
		if (value !== undefined) {
			(resolved as unknown as Record<string, unknown>)[key] = value;
		}
	}

	// Handle backup: boolean
	if (opts.backup === false) {
		resolved.backup = false;
	} else if (opts.backup === true || opts.backup === undefined) {
		resolved.backup = "copy";
	} else if (typeof opts.backup === "string") {
		resolved.backup = opts.backup as BackupStrategy;
	}

	// Handle extensions: normalize to dot-prefixed lowercase
	if (opts.extensions) {
		resolved.extensions = opts.extensions.map((e) =>
			e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`,
		);
	}

	return resolved;
}

/**
 * Generate a temporary output path for in-place processing.
 * Uses `<original>.<ext>.peaknorm-tmp` pattern.
 */
function tempOutputPath(inputPath: string): string {
	const ext = extname(inputPath);
	const base = inputPath.slice(0, -ext.length);
	return `${base}.peaknorm-tmp${ext}`;
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
	const resolved = resolveOptions(opts);
	const startTime = performance.now();
	const inputSize = getFileSize(inputPath);

	if (!isFile(inputPath)) {
		throw new NormalizeError(inputPath, "File does not exist");
	}

	// Resolve ffmpeg path
	const ffmpegPath = detectFfmpeg(resolved.ffmpegPath);

	// Determine output path
	const outputDir = resolved.output
		? join(resolved.output, basename(inputPath))
		: null;

	const useTemp = outputDir === null;
	const outputPath = outputDir ?? tempOutputPath(inputPath);

	resolved.onFileStart?.(inputPath, outputPath);

	// Dry-run: skip actual processing
	if (resolved.dryRun) {
		const result: NormalizeResult = {
			input: inputPath,
			output: outputPath,
			status: "skipped",
			inputSizeBytes: inputSize,
			outputSizeBytes: 0,
			durationMs: 0,
		};
		resolved.onFileComplete?.(result);
		return result;
	}

	// Create backup for in-place normalization
	let backupResult: ReturnType<typeof createBackup> | null = null;
	if (useTemp && resolved.backup !== false) {
		backupResult = createBackup(inputPath, resolved.backup);
	}

	try {
		// Probe file (duration, stream info)
		const probe = await probeMedia(
			inputPath,
			ffmpegPath,
			resolved.signal ?? undefined,
		);

		// Measure loudness (Pass 1) — reports "analyzing" phase
		const measurement = await measureLoudness(
			ffmpegPath,
			inputPath,
			resolved.loudness,
			resolved.lra,
			resolved.truePeak,
			probe.duration,
			resolved.signal ?? undefined,
			(pct) => resolved.onFileProgress?.(basename(inputPath), pct, "analyzing"),
		);

		if (!measurement) {
			throw new NormalizeError(inputPath, "Failed to measure loudness");
		}

		// Normalize audio (Pass 2)
		await normalizeMediaFile(
			ffmpegPath,
			inputPath,
			outputPath,
			measurement,
			resolved,
			probe.duration,
			resolved.signal ?? undefined,
			(pct) =>
				resolved.onFileProgress?.(basename(inputPath), pct, "normalizing"),
		);

		// If in-place, move temp to original
		if (useTemp) {
			renameSync(outputPath, inputPath);
		}

		// Delete backup on success
		if (backupResult) {
			deleteBackup(backupResult);
		}

		const endTime = performance.now();
		const finalPath = useTemp ? inputPath : outputPath;
		const outputSize = getFileSize(finalPath);

		const result: NormalizeResult = {
			input: inputPath,
			output: finalPath,
			status: "completed",
			inputSizeBytes: inputSize,
			outputSizeBytes: outputSize,
			durationMs: Math.round(endTime - startTime),
		};

		resolved.onFileComplete?.(result);
		return result;
	} catch (err) {
		// Clean up temp file if it exists
		try {
			unlinkSync(outputPath);
		} catch {
			// ignore
		}

		// Restore backup if it exists
		if (backupResult && useTemp) {
			try {
				restoreBackup(backupResult, inputPath);
			} catch {
				// ignore restore failure
			}
		}

		const error =
			err instanceof Error ? err : new NormalizeError(inputPath, String(err));

		resolved.onFileError?.(inputPath, error);

		const result: NormalizeResult = {
			input: inputPath,
			output: outputPath,
			status: "error",
			error: error.message,
			backupPath: backupResult?.path,
			inputSizeBytes: inputSize,
			outputSizeBytes: 0,
			durationMs: Math.round(performance.now() - startTime),
		};

		resolved.onFileComplete?.(result);
		return result;
	}
}

/**
 * Normalize all media files in a directory.
 */
export async function normalizeFolder(
	dirPath: string,
	opts: NormalizeOptions = {},
): Promise<BatchResult> {
	const resolved = resolveOptions(opts);
	const batchStart = performance.now();

	if (!isDirectory(dirPath)) {
		throw new NormalizeError(dirPath, "Directory does not exist");
	}

	const files = findMediaFiles(
		dirPath,
		resolved.extensions,
		resolved.recursive,
	);

	if (files.length === 0) {
		throw new NoMediaFilesError(dirPath);
	}

	const results: NormalizeResult[] = [];
	let completed = 0;
	let skipped = 0;
	let errors = 0;

	for (const file of files) {
		try {
			const result = await normalizeFile(file, opts);
			results.push(result);
			if (result.status === "completed") completed++;
			else if (result.status === "skipped") skipped++;
			else errors++;
		} catch (err) {
			errors++;
			const result: NormalizeResult = {
				input: file,
				output: file,
				status: "error",
				error: err instanceof Error ? err.message : String(err),
				inputSizeBytes: 0,
				outputSizeBytes: 0,
				durationMs: 0,
			};
			results.push(result);
			resolved.onFileComplete?.(result);
		}
	}

	return {
		total: files.length,
		completed,
		skipped,
		errors,
		results,
		durationMs: Math.round(performance.now() - batchStart),
	};
}

/**
 * Normalize a file or folder. Auto-detects which one.
 */
export async function normalize(
	inputPath: string,
	opts: NormalizeOptions = {},
): Promise<BatchResult> {
	const resolvedPath = resolve(inputPath);

	if (isFile(resolvedPath)) {
		const result = await normalizeFile(resolvedPath, opts);
		return {
			total: 1,
			completed: result.status === "completed" ? 1 : 0,
			skipped: result.status === "skipped" ? 1 : 0,
			errors: result.status === "error" ? 1 : 0,
			results: [result],
			durationMs: result.durationMs,
		};
	}

	if (isDirectory(resolvedPath)) {
		return normalizeFolder(resolvedPath, opts);
	}

	throw new NormalizeError(
		inputPath,
		"Path does not exist or is not a file/directory",
	);
}
