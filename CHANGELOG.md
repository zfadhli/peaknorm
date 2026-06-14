# Changelog

## [0.3.0] - 2026-06-14

### Added

- `--sort-by name|mtime` and `--sort-order asc|desc` CLI flags to control
  batch processing order — useful for processing newest files first or
  maintaining album track sequence
- `sortBy` and `sortOrder` options in the programmatic API (`NormalizeOptions`)

### Fixed

- Media probing race condition where files with an audio stream were
  incorrectly reported as having no audio — switched from `ffmpeg -i`
  stderr parsing to `ffprobe` JSON output for reliable stream detection

## [0.2.4] - 2026-06-10

### Fixed

- Files without audio streams now fail with a clear "No audio stream found
  in the file" error instead of a cryptic "Failed to measure loudness"
- Loudnorm measurement failures now surface the actual ffmpeg error message
  from stderr, making debugging significantly easier
- Clarified loudnorm JSON parse failure error message

## [0.2.3] - 2026-06-07

### Fixed

- Loudnorm Pass 2 crash on silent/very quiet audio files — ffmpeg
  `measured_I` values of `-inf`/`nan` now cause a fallback to dynamic
  normalization instead of "Numerical result out of range" error

## [0.2.2] - 2026-06-07

### Added

- Comprehensive `README.md` with CLI usage, programmatic API reference, pipeline
  documentation, error handling guide, and development setup instructions

## [0.2.1] - 2026-06-07

### Fixed

- Repository URL in `package.json` updated from placeholder to actual repository,
  fixing npm publish with Sigstore provenance verification

## [0.2.0] - 2026-06-07

### Added

- Phase-aware progress bar — reports `Analyzing` (Pass 1) and `Normalizing` (Pass 2)
  phases during processing, with immediate `Starting...` feedback when a file begins
- `NormalizePhase` type exported from the public API (`"analyzing" | "normalizing"`)

### Fixed

- Dry-run mode no longer requires ffmpeg to be installed — `detectFfmpeg()` is
  skipped when `dryRun: true`, fixing CI and preview workflows
- Probe time reduced from 10-30s to ~200ms by killing ffmpeg early once stream
  metadata is gathered

### Changed

- Completed results now display in structured multi-line format with key: value
  labels instead of packed single-line output with full absolute paths
- Summary line now shows a `Done:` label for clarity

## [0.1.0] - 2026-06-07

### Added

- Initial project scaffold
- EBU R128 two-pass loudnorm via ffmpeg subprocess
- CLI via cac with backup, dry-run, and verbose flags
- Backup strategies: copy, folder, suffix
- Single-file and batch folder normalization
- TypeScript 6, tsdown build, Biome linting, Bun test
- GitHub Actions CI + publish workflows

[0.3.0]: https://github.com/zfadhli/peaknorm/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/zfadhli/peaknorm/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/zfadhli/peaknorm/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/zfadhli/peaknorm/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/zfadhli/peaknorm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/zfadhli/peaknorm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zfadhli/peaknorm/releases/tag/v0.1.0
