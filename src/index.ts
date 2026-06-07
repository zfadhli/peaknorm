export {
	BackupError,
	FfmpegError,
	FfmpegNotFoundError,
	NoMediaFilesError,
	NormalizeError,
	PeaknormError,
} from "./errors.ts";
export { normalize, normalizeFile, normalizeFolder } from "./normalize.ts";

export type {
	BackupStrategy,
	BatchResult,
	LoudnessMeasurement,
	MediaProbeResult,
	NormalizeOptions,
	NormalizePhase,
	NormalizeResult,
	NormalizeStatus,
} from "./types.ts";
