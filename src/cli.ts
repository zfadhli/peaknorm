#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createCLI, color, createSpinner, createProgress } from "@zfadhli/koko-cli";
import { PeaknormError } from "./errors.ts";
import { detectFfmpeg } from "./ffmpeg.ts";
import { normalize } from "./normalize.ts";
import type { BackupStrategy, NormalizeResult } from "./types.ts";

function getVersion(): string {
	try {
		const dirname = import.meta.dirname ?? process.cwd();
		const pkgPath = resolve(dirname, "../package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
			version: string;
		};
		return pkg.version;
	} catch {
		return "0.0.0";
	}
}

const cli = createCLI("peaknorm", getVersion()).description(
	"Normalize audio in media files using EBU R128 (ffmpeg loudnorm)",
);

cli.command("[input]", "File or folder to normalize", (cmd) => {
	cmd.option("-o, --output <dir>", "Output directory (default: same as input)");
	cmd.option("-l, --loudness <num>", "Target loudness in LUFS (default: -14)");
	cmd.option("--lra <num>", "Loudness range in LU (default: 7)");
	cmd.option("-tp, --true-peak <num>", "True peak limit in dBTP (default: -2)");
	cmd.option("--audio-codec <name>", "Audio codec (default: libopus)");
	cmd.option("--audio-bitrate <str>", "Audio bitrate (default: 96k)");
	cmd.option(
		"-b, --backup <strategy>",
		"Backup strategy: copy|folder|suffix (default: copy)",
	);
	cmd.option("-r, --recursive", "Recurse subdirectories (default: true)");
	cmd.option("-e, --ext <ext>", "File extensions to process (repeatable)");
	cmd.option("--ffmpeg-path <path>", "Custom ffmpeg binary path");
	cmd.option("--dry-run", "Preview without processing");
	cmd.option(
		"--sort-by <method>",
		"Sort files by: name|mtime (default: name)",
	);
	cmd.option(
		"--sort-order <dir>",
		"Sort direction: asc|desc (default: asc)",
	);
	cmd.option("--verbose", "Verbose output");

	cmd.action(async (options) => {
		const inputArg = options.input as string | undefined;
		if (!inputArg) {
			console.error("error: missing required input path");
			process.exit(1);
		}

		// Detect ffmpeg early
		try {
			detectFfmpeg(options.ffmpegPath as string | undefined);
		} catch (err) {
			console.error(
				err instanceof PeaknormError ? err.message : String(err),
			);
			process.exit(1);
		}

		// ─── Resolve backup from raw argv ─────────────────────
		// cac v6 (used by koko) auto-interprets --no-backup as a
		// negation of --backup. We read from raw argv to be safe.
		const rawArgv = process.argv.slice(2);
		const noBackup = rawArgv.includes("--no-backup");
		const backup: BackupStrategy | false = noBackup
			? false
			: typeof options.backup === "string"
				? (options.backup as BackupStrategy)
				: "copy";

		// ─── Build options object ──────────────────────────────
		const cliOpts = options as Record<string, unknown>;

		const normalizeOpts: Record<string, unknown> = {};

		if (cliOpts.output !== undefined) normalizeOpts.output = cliOpts.output;
		if (cliOpts.loudness !== undefined)
			normalizeOpts.loudness = Number(cliOpts.loudness);
		if (cliOpts.lra !== undefined) normalizeOpts.lra = Number(cliOpts.lra);
		if (cliOpts.truePeak !== undefined)
			normalizeOpts.truePeak = Number(cliOpts.truePeak);
		if (cliOpts.audioCodec !== undefined)
			normalizeOpts.audioCodec = cliOpts.audioCodec;
		if (cliOpts.audioBitrate !== undefined)
			normalizeOpts.audioBitrate = cliOpts.audioBitrate;
		normalizeOpts.backup = backup;
		if (cliOpts.recursive !== undefined)
			normalizeOpts.recursive = cliOpts.recursive;
		if (cliOpts.ext !== undefined)
			normalizeOpts.extensions = cliOpts.ext;
		if (cliOpts.ffmpegPath !== undefined)
			normalizeOpts.ffmpegPath = cliOpts.ffmpegPath;
		if (cliOpts.dryRun !== undefined)
			normalizeOpts.dryRun = cliOpts.dryRun;
		if (cliOpts.sortBy !== undefined)
			normalizeOpts.sortBy = cliOpts.sortBy;
		if (cliOpts.sortOrder !== undefined)
			normalizeOpts.sortOrder = cliOpts.sortOrder;

		const verbose = cliOpts.verbose === true;

		if (verbose) {
			console.error(`Input: ${inputArg}`);
			console.error(`Options: ${JSON.stringify(normalizeOpts, null, 2)}`);
		}

		// ─── Spinner + Progress bar instances ─────────────
		// These persist across callbacks via closure so we can
		// transition from spinner (analyzing) to bar (normalizing).
		let spin: ReturnType<typeof createSpinner> | null = null;
		let progressBar: ReturnType<typeof createProgress> | null = null;

		// ─── Run normalization ────────────────────────────────
		try {
			const batch = await normalize(inputArg, {
				...normalizeOpts,
				onFileStart: (input) => {
					if (progressBar) {
						progressBar.stop();
						progressBar = null;
					}
					spin = createSpinner(basename(input));
					spin.start();
				},
				onFileProgress: (_file, percent, phase) => {
					const name = basename(_file);
					if (phase === "analyzing" && spin) {
						spin.text = `Analyzing ${name} ${percent}%`;
					} else if (phase === "normalizing") {
						if (spin) {
							spin.succeed(`Analysis complete`);
							spin = null;
						}
						if (!progressBar) {
							progressBar = createProgress({
								total: 100,
								clearOnComplete: true,
							});
						}
						progressBar.update(percent);
					}
				},
				onFileComplete: (result: NormalizeResult) => {
					if (progressBar) {
						progressBar.stop();
						progressBar = null;
					}
					if (spin) {
						spin.stop();
						spin = null;
					}
					printResult(result);
				},
			});

			console.error(
				`\n${color.blue("Done:")} ${color.green(String(batch.completed))}/${batch.total} files processed` +
					(batch.errors > 0
						? `, ${color.red(String(batch.errors))} errors`
						: "") +
					` (${(batch.durationMs / 1000).toFixed(1)}s)`,
			);

			if (batch.errors > 0) {
				process.exit(1);
			}
		} catch (err) {
			if (err instanceof PeaknormError) {
				console.error(err.message);
			} else {
				console.error(String(err));
			}
			process.exit(1);
		}
	});
});

cli.parse();

// ─── Result printer ──────────────────────────────────
function printResult(result: NormalizeResult): void {
	const name = basename(result.input);
	const time = `  time taken: ${(result.durationMs / 1000).toFixed(1)}s`;

	switch (result.status) {
		case "completed": {
			const sizePart = (() => {
				const inMB = (result.inputSizeBytes / 1024 / 1024).toFixed(1);
				const isInPlace = result.input === result.output;
				const sizeChanged =
					result.inputSizeBytes !== result.outputSizeBytes &&
					result.outputSizeBytes > 0;

				if (!isInPlace) {
					const outMB = (result.outputSizeBytes / 1024 / 1024).toFixed(1);
					return `  size: ${inMB}MB → ${outMB}MB`;
				}
				if (sizeChanged) {
					const outMB = (result.outputSizeBytes / 1024 / 1024).toFixed(1);
					return `  size: ${inMB}MB → ${outMB}MB`;
				}
				return `  size: ${inMB}MB`;
			})();

			console.error(`${color.green("[completed]")}`);
			console.error(`  ${color.white(`filename: ${name}`)}`);
			console.error(`${color.white(sizePart)}`);
			console.error(`${color.white(time)}`);
			break;
		}
		case "skipped":
			console.error(color.yellow("[skipped]"));
			console.error(`  ${color.white(`filename: ${name}`)}`);
			break;
		case "error":
			console.error(color.red("[error]"));
			console.error(`  ${color.white(`filename: ${name}`)}`);
			console.error(
				`  ${color.red(`error: ${result.error ?? "Unknown error"}`)}`,
			);
			break;
	}
}
