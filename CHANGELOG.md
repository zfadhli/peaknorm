# Changelog

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

[0.2.1]: https://github.com/zfadhli/peaknorm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/zfadhli/peaknorm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zfadhli/peaknorm/releases/tag/v0.1.0
