#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { cac } from "cac";
import pc from "picocolors";
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

const cli = cac("peaknorm");

cli
	.command("[input]", "File or folder to normalize")
	.option("-o, --output <dir>", "Output directory (default: same as input)")
	.option("-l, --loudness <num>", "Target loudness in LUFS (default: -14)")
	.option("--lra <num>", "Loudness range in LU (default: 7)")
	.option("-tp, --true-peak <num>", "True peak limit in dBTP (default: -2)")
	.option("--audio-codec <name>", "Audio codec (default: libopus)")
	.option("--audio-bitrate <str>", "Audio bitrate (default: 96k)")
	.option(
		"-b, --backup <strategy>",
		"Backup strategy: copy|folder|suffix (default: copy)",
	)
	.option("-r, --recursive", "Recurse subdirectories (default: true)")
	.option("--no-recursive", "Don't recurse subdirectories")
	.option("-e, --ext <ext>", "File extensions to process (repeatable)")
	.option("--ffmpeg-path <path>", "Custom ffmpeg binary path")
	.option("--dry-run", "Preview without processing")
	.option(
		"--sort-by <method>",
		"Sort files by: name|mtime (default: name)",
	)
	.option(
		"--sort-order <dir>",
		"Sort direction: asc|desc (default: asc)",
	)
	.option("--verbose", "Verbose output");

cli.help();
cli.version(getVersion());

// ─── Parse (don't run — we handle manually) ────────────
const parsed = cli.parse(process.argv, { run: false });

// cac already printed help/version above — exit
if (parsed.options.help || parsed.options.version) {
	process.exit(0);
}

const inputArg = parsed.args[0];
if (!inputArg) {
	cli.outputHelp();
	process.exit(1);
}

// Detect ffmpeg early
try {
	detectFfmpeg(parsed.options.ffmpegPath as string | undefined);
} catch (err) {
	console.error(err instanceof PeaknormError ? err.message : String(err));
	process.exit(1);
}

// ─── Resolve backup from raw argv ─────────────────────
// cac v6 auto-interprets --no-backup as a negation of --backup.
// We read from raw argv to avoid cac's run-time validation.
const rawArgv = process.argv.slice(2);
const noBackup = rawArgv.includes("--no-backup");
const backupRaw = parsed.options.backup;
const backup = noBackup
	? false
	: typeof backupRaw === "string"
		? (backupRaw as BackupStrategy)
		: "copy";

// ─── Build options object ──────────────────────────────
const cliOpts = parsed.options as Record<string, unknown>;

const options: Record<string, unknown> = {};

if (cliOpts.output !== undefined) options.output = cliOpts.output;
if (cliOpts.loudness !== undefined) options.loudness = Number(cliOpts.loudness);
if (cliOpts.lra !== undefined) options.lra = Number(cliOpts.lra);
if (cliOpts.truePeak !== undefined) options.truePeak = Number(cliOpts.truePeak);
if (cliOpts.audioCodec !== undefined) options.audioCodec = cliOpts.audioCodec;
if (cliOpts.audioBitrate !== undefined)
	options.audioBitrate = cliOpts.audioBitrate;
options.backup = backup;
if (cliOpts.recursive !== undefined) options.recursive = cliOpts.recursive;
// Handle --no-recursive (cac sets recursive to false when --no-recursive is passed)
if (cliOpts.recursive === false) options.recursive = false;
if (cliOpts.ext !== undefined) options.extensions = cliOpts.ext;
if (cliOpts.ffmpegPath !== undefined) options.ffmpegPath = cliOpts.ffmpegPath;
if (cliOpts.dryRun !== undefined) options.dryRun = cliOpts.dryRun;
if (cliOpts.sortBy !== undefined) options.sortBy = cliOpts.sortBy;
if (cliOpts.sortOrder !== undefined) options.sortOrder = cliOpts.sortOrder;

const verbose = cliOpts.verbose === true;

if (verbose) {
	console.error(`Input: ${inputArg}`);
	console.error(`Options: ${JSON.stringify(options, null, 2)}`);
}

// ─── Run normalization ────────────────────────────────
try {
	const batch = await normalize(inputArg, {
		...options,
		onFileStart: (input) => {
			process.stderr.write(
				`\n${pc.dim("Starting")} ${basename(input).padEnd(40).slice(0, 40)}`,
			);
		},
		onFileProgress: (_file, percent, phase) => {
			const label =
				phase === "analyzing" ? pc.yellow("Analyzing") : pc.cyan("Normalizing");
			const bar = renderProgressBar(percent, 20);
			process.stderr.write(
				`\r${bar} ${pc.cyan(String(percent))}% ${label} ${_file.padEnd(25).slice(0, 25)}`,
			);
		},
		onFileComplete: (result: NormalizeResult) => {
			// Clear progress line
			process.stderr.write(`\r${" ".repeat(80)}\r`);
			printResult(result);
		},
	} as Parameters<typeof normalize>[1]);

	console.error(
		`\n${pc.blue("Done:")} ${pc.green(String(batch.completed))}/${batch.total} files processed` +
			(batch.errors > 0 ? `, ${pc.red(String(batch.errors))} errors` : "") +
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

// ─── Progress bar ────────────────────────────────────
function renderProgressBar(percent: number, width: number): string {
	const filled = Math.round((percent / 100) * width);
	const empty = width - filled;
	return pc.green("█".repeat(filled)) + pc.gray("░".repeat(empty));
}

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

			console.error(`${pc.green("[completed]")}`);
			console.error(`  ${pc.white(`filename: ${name}`)}`);
			console.error(`${pc.white(sizePart)}`);
			console.error(`${pc.white(time)}`);
			break;
		}
		case "skipped":
			console.error(pc.yellow("[skipped]"));
			console.error(`  ${pc.white(`filename: ${name}`)}`);
			break;
		case "error":
			console.error(pc.red("[error]"));
			console.error(`  ${pc.white(`filename: ${name}`)}`);
			console.error(`  ${pc.red(`error: ${result.error ?? "Unknown error"}`)}`);
			break;
	}
}
