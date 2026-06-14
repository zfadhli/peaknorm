import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = join(tmpdir(), "peaknorm-test-normalize");

function hasFfmpeg(): boolean {
	try {
		const result = Bun.spawnSync(["ffmpeg", "-version"], {
			timeout: 5000,
		});
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

beforeEach(() => {
	mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("normalizeFile (dry-run)", () => {
	it("returns skipped status for dry-run", async () => {
		const { normalizeFile } = await import("../src/normalize.ts");
		const filePath = join(testDir, "test.mp4");
		writeFileSync(filePath, "fake video content");

		const result = await normalizeFile(filePath, { dryRun: true });

		expect(result.status).toBe("skipped");
		expect(result.input).toBe(filePath);
	});

	it("throws for non-existent file", async () => {
		const { normalizeFile } = await import("../src/normalize.ts");

		try {
			await normalizeFile("/nonexistent/file.mp4", { dryRun: true });
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeDefined();
		}
	});
});

describe("normalizeFolder (dry-run)", () => {
	it("returns batch result for folder", async () => {
		const { normalizeFolder } = await import("../src/normalize.ts");
		const subDir = join(testDir, "sub");
		mkdirSync(subDir, { recursive: true });
		writeFileSync(join(subDir, "song1.mp3"), "fake audio");
		writeFileSync(join(subDir, "song2.wav"), "fake audio");

		const batch = await normalizeFolder(subDir, { dryRun: true });

		expect(batch.total).toBe(2);
		expect(batch.skipped).toBe(2);
		expect(batch.errors).toBe(0);
	});

	it("throws NoMediaFilesError for empty folder", async () => {
		const { normalizeFolder } = await import("../src/normalize.ts");
		const emptyDir = join(testDir, "empty");
		mkdirSync(emptyDir, { recursive: true });

		try {
			await normalizeFolder(emptyDir, { dryRun: true });
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeDefined();
		}
	});
});

describe("normalize (auto-detect)", () => {
	it("auto-detects single file", async () => {
		const { normalize } = await import("../src/normalize.ts");
		const filePath = join(testDir, "video.mp4");
		writeFileSync(filePath, "fake video");

		const batch = await normalize(filePath, { dryRun: true });

		expect(batch.total).toBe(1);
	});

	it("auto-detects folder", async () => {
		const { normalize } = await import("../src/normalize.ts");
		const subDir = join(testDir, "music");
		mkdirSync(subDir, { recursive: true });
		writeFileSync(join(subDir, "track.flac"), "fake audio");

		const batch = await normalize(subDir, { dryRun: true });

		expect(batch.total).toBe(1);
	});

	it("throws for non-existent path", async () => {
		const { normalize } = await import("../src/normalize.ts");

		try {
			await normalize("/nonexistent/path", { dryRun: true });
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeDefined();
		}
	});
});

describe("findMediaFiles", () => {
	it("finds media files by extension", async () => {
		const { findMediaFiles } = await import("../src/media.ts");
		mkdirSync(join(testDir, "videos"), { recursive: true });
		writeFileSync(join(testDir, "videos", "a.mp4"), "");
		writeFileSync(join(testDir, "videos", "b.mp3"), "");
		writeFileSync(join(testDir, "videos", "c.txt"), "");

		const files = findMediaFiles(
			join(testDir, "videos"),
			[".mp4", ".mp3"],
			false,
		);

		expect(files).toHaveLength(2);
		expect(files[0]).toEndWith("a.mp4");
		expect(files[1]).toEndWith("b.mp3");
	});

	it("respects recursive flag", async () => {
		const { findMediaFiles } = await import("../src/media.ts");
		mkdirSync(join(testDir, "parent", "sub"), { recursive: true });
		writeFileSync(join(testDir, "parent", "a.mp4"), "");
		writeFileSync(join(testDir, "parent", "sub", "b.mp4"), "");

		const nonRecursive = findMediaFiles(
			join(testDir, "parent"),
			[".mp4"],
			false,
		);
		expect(nonRecursive).toHaveLength(1);

		const recursive = findMediaFiles(join(testDir, "parent"), [".mp4"], true);
		expect(recursive).toHaveLength(2);
	});
});

test("extractFfmpegError extracts error from stderr", async () => {
	const { extractFfmpegError } = await import("../src/ffmpeg/parse.ts");

	const stderr = `
ffmpeg version 7.0 ...
  libavutil ...
[in#0 @ 0x...] Error opening input: No such file or directory
Error opening input file nonexistent.mp4
`.trim();

	const error = extractFfmpegError(stderr);
	expect(error).toContain("Error opening input");
});

// ─── Integration tests (require ffmpeg) ────────────────

describe("integration", () => {
	const itIf = hasFfmpeg() ? it : it.skip;

	itIf("probes a media file", async () => {
		const { probeMedia } = await import("../src/ffmpeg/index.ts");
		const { detectFfmpeg } = await import("../src/ffmpeg/index.ts");
		const ffmpegPath = detectFfmpeg();

		// Generate a small test video using ffmpeg
		const inputFile = join(testDir, "input.mp4");
		const genResult = Bun.spawnSync([
			ffmpegPath,
			"-y",
			"-f",
			"lavfi",
			"-i",
			"testsrc=duration=1:size=64x64:rate=1",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=1",
			"-c:v",
			"libx264",
			"-c:a",
			"aac",
			"-shortest",
			inputFile,
		]);
		if (genResult.exitCode !== 0) {
			throw new Error(
				`Failed to create test video: ${genResult.stderr.toString()}`,
			);
		}

		const probe = await probeMedia(inputFile, ffmpegPath);
		expect(probe.hasVideo).toBe(true);
		expect(probe.hasAudio).toBe(true);
		expect(probe.duration).toBeGreaterThan(0);
	});

	itIf("measures loudness of an audio file", async () => {
		const { detectFfmpeg, measureLoudness } = await import(
			"../src/ffmpeg/index.ts"
		);
		const ffmpegPath = detectFfmpeg();

		// Generate a test audio file (sine tone)
		const inputFile = join(testDir, "test_sine.wav");
		const genResult = Bun.spawnSync([
			ffmpegPath,
			"-y",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=2",
			inputFile,
		]);
		if (genResult.exitCode !== 0) {
			throw new Error(
				`Failed to create test audio: ${genResult.stderr.toString()}`,
			);
		}

		const measurement = await measureLoudness(
			ffmpegPath,
			inputFile,
			-14,
			7,
			-2,
			2,
		);
		expect(measurement).not.toBeNull();
		expect(measurement?.inputI).toBeDefined();
		expect(measurement?.inputLra).toBeDefined();
		expect(measurement?.inputTp).toBeDefined();
	});

	itIf("normalizes a short audio file", async () => {
		const { detectFfmpeg, measureLoudness, normalizeMediaFile } = await import(
			"../src/ffmpeg/index.ts"
		);
		const ffmpegPath = detectFfmpeg();

		// Generate test audio
		const inputFile = join(testDir, "test_norm.wav");
		await Bun.spawnSync([
			ffmpegPath,
			"-y",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=1",
			inputFile,
		]);

		const outputFile = join(testDir, "test_norm_out.wav");
		const opts = {
			loudness: -14,
			lra: 7,
			truePeak: -2,
			audioCodec: "pcm_s16le",
			audioBitrate: "",
			output: null,
			backup: false as const,
			recursive: false,
			extensions: [".wav"],
			ffmpegPath,
			dryRun: false,
			signal: null,
			onFileStart: null,
			onFileProgress: null,
			onFileComplete: null,
			onFileError: null,
		};

		const measurement = await measureLoudness(
			ffmpegPath,
			inputFile,
			-14,
			7,
			-2,
			1,
		);
		expect(measurement).not.toBeNull();

		const m = measurement as NonNullable<typeof measurement>;

		await normalizeMediaFile(
			ffmpegPath,
			inputFile,
			outputFile,
			m,
			opts,
			1,
			undefined,
			undefined,
		);

		expect(existsSync(outputFile)).toBe(true);

		// Verify the output is playable
		const probe = await (await import("../src/ffmpeg/index.ts")).probeMedia(
			outputFile,
			ffmpegPath,
		);
		expect(probe.hasAudio).toBe(true);
	});
});
