# Session Handoff — 2026-06-07 13:44

## Goal

Build a TypeScript CLI + library (`peaknorm`) for normalizing audio loudness in media files using EBU R128 standard via ffmpeg's `loudnorm` filter. The tool handles both video (video passthrough) and audio-only files, with backup strategies, real-time progress, and a clean programmatic API.

## Files Modified/Created

### Config & Docs
- `package.json` — project metadata, dependencies (`cac`, `picocolors`), scripts, dual exports
- `tsconfig.json` — TS6 strict, NodeNext, `isolatedDeclarations: true`
- `tsdown.config.ts` — builds both `src/index.ts` (lib) and `src/cli.ts` (CLI) to ESM
- `biome.json` — linter + formatter with git integration
- `.gitignore` — excludes `dist/`, `node_modules/`, `input/` (test media), temp/backup artifacts
- `CHANGELOG.md` — versions 0.1.0 through 0.2.3 (Keep a Changelog format)
- `README.md` — full docs: CLI usage, API reference, pipeline walkthrough, error handling
- `.github/workflows/ci.yml` — lint, typecheck, build, test on push/PR to main
- `.github/workflows/publish.yml` — npm publish with Sigstore provenance on `v*` tags

### Source — `src/`
- `index.ts` — barrel exports: `normalize`, `normalizeFile`, `normalizeFolder`, error classes, types
- `types.ts` — `NormalizeOptions`, `NormalizeResult`, `BatchResult`, `NormalizePhase`, `LoudnessMeasurement`, etc.
- `errors.ts` — `PeaknormError` hierarchy (6 classes)
- `utils.ts` — `findMediaFiles()`, `parseFfmpegProgress()`, `extractFfmpegError()`, `isFile/isDirectory`
- `backup.ts` — `createBackup()`, `restoreBackup()`, `deleteBackup()` — three strategies (copy/folder/suffix)
- `ffmpeg.ts` — `detectFfmpeg()`, `probeMedia()` (early-kill ~200ms), `measureLoudness()` (Pass 1), `normalizeMediaFile()` (Pass 2 with validation fallback)
- `normalize.ts` — `normalizeFile()` (orchestrates pipeline with backup/restore), `normalizeFolder()`, `normalize()`
- `cli.ts` — cac CLI: dry-run, backup, codec, loudness options; progress bar with phase labels; multi-line result output

### Test — `test/`
- `normalize.test.ts` — dry-run unit tests + integration tests (conditional on ffmpeg presence)
- `backup.test.ts` — all three backup/restore strategies
- `utils.test.ts` — `parseFfmpegProgress`, `isFile`, `isDirectory`

## Key Decisions

- **Functional API (no class)** — The pipeline is stateless (input → backup → normalize → done). A class would only wrap a function. Callbacks (`onFileProgress`, `onFileComplete`) handle progress/error reporting instead of EventEmitter.
- **Single package, dual exports** — Not a monorepo. `import { normalize } from "peaknorm"` loads the lib; `npx peaknorm` runs the CLI. `cac` is bundled only into `cli.mjs` at build time. Simpler than splitting packages.
- **Callbacks, not EventEmitter** — For a one-shot batch operation, `onFileProgress` callbacks in options are simpler than `.on()`/`.off()` lifecycle management.
- **`--no-backup` parsed from raw argv** — `cac` v6 auto-handles `--no-` prefix negation, but sets a boolean `true` default that conflicts with required value options. Solution: parse `rawArgv.includes("--no-backup")` manually after `cli.parse(argv, { run: false })`.
- **`probeMedia` early-kill** — ffmpeg outputs `Duration:` and `Stream #` lines in stderr within ~200ms but continues decoding the whole file (10-30s). We kill ffmpeg with SIGTERM as soon as both are detected.
- **Measurement validation** — ffmpeg returns `-inf`/`nan` for silent/very quiet audio in Pass 1. `normalizeMediaFile` validates with `isFinite`/`isNaN` before Pass 2; falls back to dynamic normalization when values are invalid.
- **Default branch: `main`** — was `feature/progress-phase`, switched to `main` during development.
- **Opus default codec** — royalt-free, better quality-per-bit than AAC at 96k. Configurable via `--audio-codec`.

## Current State

### Working
- Full EBU R128 two-pass loudnorm pipeline
- CLI: all flags, dry-run, backup strategies, progress bar, multi-line output
- Library: `normalize()`, `normalizeFile()`, `normalizeFolder()` with full type exports
- GitHub Actions CI (build + test) and publish (npm with provenance)
- 4 releases published to npm (v0.2.0 through v0.2.3)
- README with comprehensive documentation
- Both video files (stream-copy) and audio-only files handled

### Test results
- 29 tests: 29 pass (3 integration tests skipped when ffmpeg not available)

## Next Steps / Pending

- [ ] **One-pass dynamic mode** — add `dynamic: true` option to skip Pass 1 and use dynamic loudnorm without measured values
- [ ] **Album batch mode** — `{ batch: true }` that measures all files first, then applies a single gain offset preserving relative loudness
- [ ] **Presets** — like ffmpeg-normalize's `--preset podcast/music/streaming-video`
- [ ] **Selective audio streams** — allow users to pick which audio stream(s) to normalize in multi-stream files
- [ ] **Shell completions** — bash/zsh completions via `cac` or custom generation
- [ ] **`--lower-only` flag** — prevent audio from increasing in loudness, only lower if needed

## Important Context

- **Runtime:** Bun ≥1.2. **System dep:** ffmpeg ≥4.2 (for `loudnorm` filter)
- **Entry points:** `"exports"` maps `"."` → `dist/index.mjs` (lib), `"./cli"` → `dist/cli.mjs` (CLI module)
- **Build:** `bun run build` → tsdown bundles both entries + generates `.d.mts` declarations
- **Dev loop:** `bun run dev -- ./file.mp4 --dry-run` runs CLI from TypeScript source directly
- **cac v6 caveat:** `--no-backup` handling requires `cli.parse(argv, { run: false })` + raw argv scanning. The `process.argv.slice(2)` pattern from cac docs is wrong for v6 — it expects full `process.argv` and internally slices again.
- **probeMedia:** Resolves as soon as `Duration:` and `Stream #` lines appear in stderr, kills ffmpeg. For very short files, the `close` handler is the fallback.
- **measurement validation:** If ffmpeg returns `-inf`/`nan` for any measured value, Pass 2 falls back to dynamic loudnorm (no `linear=true` or `measured_*` args).
- **GitHub:** Repo at `zfadhli/peaknorm`, default branch `main`, publish on `v*` tags via npm with provenance.
- **No LICENSE file yet** — `package.json` says MIT but no actual `LICENSE` file in repo.
