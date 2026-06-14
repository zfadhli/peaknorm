// ─── Public Types ──────────────────────────────────────

export interface NormalizeOptions {
	/** Target loudness in LUFS (default: -14) */
	loudness?: number;
	/** Loudness Range in LU (default: 7) */
	lra?: number;
	/** True peak limit in dBTP (default: -2) */
	truePeak?: number;
	/** Audio codec for output (default: "libopus") */
	audioCodec?: string;
	/** Audio bitrate (default: "96k") */
	audioBitrate?: string;
	/** Output directory. If not set, overwrites input files. */
	output?: string;
	/** Backup strategy (default: "copy") */
	backup?: BackupStrategy | boolean;
	/** Recurse subdirectories when input is a folder (default: true) */
	recursive?: boolean;
	/** File extensions to process (default: see code) */
	extensions?: string[];
	/** Custom ffmpeg binary path */
	ffmpegPath?: string;
	/** Preview without processing */
	dryRun?: boolean;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	/** Sort order for batch processing: by name or modification time (default: "name") */
	sortBy?: "name" | "mtime";
	/** Sort direction for batch processing (default: "asc") */
	sortOrder?: "asc" | "desc";
	/** Callback when a file starts processing */
	onFileStart?: (input: string, output: string) => void;
	/** Callback for per-file progress (0–100, phase) */
	onFileProgress?: (
		file: string,
		percent: number,
		phase: NormalizePhase,
	) => void;
	/** Callback when a file completes processing */
	onFileComplete?: (result: NormalizeResult) => void;
	/** Callback when a file errors */
	onFileError?: (input: string, error: Error) => void;
}

export type BackupStrategy = "copy" | "folder" | "suffix";

export type NormalizePhase = "analyzing" | "normalizing";

export type NormalizeStatus = "completed" | "skipped" | "error";

export interface NormalizeResult {
	input: string;
	output: string;
	status: NormalizeStatus;
	error?: string;
	backupPath?: string;
	inputSizeBytes: number;
	outputSizeBytes: number;
	durationMs: number;
}

export interface BatchResult {
	total: number;
	completed: number;
	skipped: number;
	errors: number;
	results: NormalizeResult[];
	durationMs: number;
}

export interface LoudnessMeasurement {
	inputI: string;
	inputLra: string;
	inputTp: string;
	inputThresh: string;
	offset: string;
}

export interface MediaProbeResult {
	hasVideo: boolean;
	hasAudio: boolean;
	duration: number;
}

// ─── Internal Resolved Options ─────────────────────────

export interface ResolvedOptions {
	loudness: number;
	lra: number;
	truePeak: number;
	audioCodec: string;
	audioBitrate: string;
	output: string | null;
	backup: BackupStrategy | false;
	recursive: boolean;
	extensions: string[];
	ffmpegPath: string;
	dryRun: boolean;
	signal: AbortSignal | null;
	sortBy: "name" | "mtime";
	sortOrder: "asc" | "desc";
	onFileStart: ((input: string, output: string) => void) | null;
	onFileProgress:
		| ((file: string, percent: number, phase: NormalizePhase) => void)
		| null;
	onFileComplete: ((result: NormalizeResult) => void) | null;
	onFileError: ((input: string, error: Error) => void) | null;
}
