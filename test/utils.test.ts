import { describe, expect, it } from "bun:test";
import { isDirectory, isFile, parseFfmpegProgress } from "../src/utils.ts";

describe("parseFfmpegProgress", () => {
	it("parses time from ffmpeg output", () => {
		const result = parseFfmpegProgress(
			"frame=  123 fps= 30 q=28.0 size=    1024kB time=00:01:23.45 bitrate= 1234.5kbits/s speed=1.0x",
		);
		expect(result).not.toBeNull();
		expect(result?.duration).toBe(83); // 1*60 + 23
		expect(result?.sizeBytes).toBe(1024 * 1024); // 1024KB
	});

	it("parses size in MB", () => {
		const result = parseFfmpegProgress("size=      10MB time=00:00:30.00");
		expect(result).not.toBeNull();
		expect(result?.sizeBytes).toBe(10 * 1024 * 1024);
	});

	it("returns null for non-progress lines", () => {
		const result = parseFfmpegProgress("Output #0, mp4, to 'output.mp4':");
		expect(result).toBeNull();
	});

	it("handles empty line", () => {
		const result = parseFfmpegProgress("");
		expect(result).toBeNull();
	});

	it("parses partial data (time only)", () => {
		const result = parseFfmpegProgress("time=00:00:05.00");
		expect(result).not.toBeNull();
		expect(result?.duration).toBe(5);
		expect(result?.sizeBytes).toBeUndefined();
	});

	it("parses partial data (size only)", () => {
		const result = parseFfmpegProgress("size=       500kB");
		expect(result).not.toBeNull();
		expect(result?.sizeBytes).toBe(500 * 1024);
		expect(result?.duration).toBeUndefined();
	});
});

describe("isFile", () => {
	it("returns false for non-existent path", () => {
		expect(isFile("/nonexistent/path")).toBe(false);
	});

	it("returns false for null/empty", () => {
		expect(isFile("")).toBe(false);
	});
});

describe("isDirectory", () => {
	it("returns false for non-existent path", () => {
		expect(isDirectory("/nonexistent/path")).toBe(false);
	});
});
