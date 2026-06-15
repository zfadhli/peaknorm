# Session Handoff — 2026-06-14 11:52

## Goal

Multiple objectives across this session:

1. **Fix ffprobe race condition** — the old `probeMedia` used `ffmpeg -i` stderr parsing and killed ffmpeg early, causing false "no audio" reports when the audio stream line arrived in a different data chunk than the video stream line. Switched to `ffprobe` JSON output.
2. **Add `--sort-by mtime`** — allow batch processing in modification-time order.
3. **Refactor CLI** — replace `cac` + `picocolors` with `@zfadhli/koko-cli` (builder pattern, spinner, progress bar).
4. **Architectural deepening** — two `/deepen` passes: split god files, dissolve catch-alls, extract modules, add tests.
5. **Code quality audit** — found and fixed 5 TS compilation errors, added sort unit tests.
6. **Releases** — v0.3.0 through v0.5.1 (6 releases total).
7. **Comprehensive README rewrite** — structured with CLI + API docs, pipeline diagram, full options reference.

## Files Modified/Created

### New files (created this session)
- `src/ffmpeg/` — directory with 6 modules: `detect.ts`, `probe.ts`, `measure.ts`, `normalize.ts`, `parse.ts`, `index.ts`
- `src/config.ts` — `DEFAULTS`, `resolveOptions()`, `tempOutputPath()`
- `src/sort.ts` — `sortFileList()`
- `src/format.ts` — `formatResult()` pure function
- `src/fs.ts` — `isFile()`, `isDirectory()`
- `src/media.ts` — `findMediaFiles()`
- `test/sort.test.ts` — 5 tests for `sortFileList`

### Deleted files
- `src/ffmpeg.ts` — split into `src/ffmpeg/` directory
- `src/utils.ts` — dissolved into `ffmpeg/parse.ts`, `config.ts`, `media.ts`, `fs.ts`

### Modified files
- `src/cli.ts` — migrated to `@zfadhli/koko-cli` (createCLI, color, createProgress), schema-driven option mapping, replaced spinner with progress bar
- `src/normalize.ts` — extracted config/sort/cleanup, updated imports
- `src/types.ts` — added `sortBy`, `sortOrder` to `NormalizeOptions` + `ResolvedOptions`
- `src/ffmpeg/measure.ts` — replaced brace-counting JSON parser with regex
- `test/normalize.test.ts` — updated imports, added `sortBy`/`sortOrder` to test opts
- `test/utils.test.ts` — updated imports (parseFfmpegProgress → ffmpeg/parse.ts, isFile → fs.ts)
- `package.json` — replaced `cac` + `picocolors` with `@zfadhli/koko-cli`; 6 version bumps
- `CHANGELOG.md` — added entries for v0.3.0 through v0.5.1
- `README.md` — complete rewrite

## Key Decisions

- **ffprobe over ffmpeg -i** — `probeMedia` uses ffprobe JSON output for reliable stream detection, with ffmpeg -i stderr parsing as fallback. Eliminates race condition where audio stream was missed.
- **koko-cli over raw cac** — `@zfadhli/koko-cli` wraps cac + picocolors + cli-progress + cli-spinners with a composition API. Spinner for analyzing, progress bar for normalizing (both use real ffmpeg progress).
- **Schema-driven CLI option mapping** — 15 repetitive `if (cliOpts.X !== undefined)` blocks replaced with a declarative `OptionMapping[]` array. Extensible — just add a row.
- **Error recovery extracted** — `cleanupAfterError()` helper separates temp cleanup + backup restore from pipeline logic.
- **Deepen over rebuild** — codebase had good bones with isolated issues. Two `/deepen` passes resolved structural friction without a rewrite.
- **Format → pure function** — `formatResult()` returns `string[]` without side effects. Caller applies colors + output. Testable without mocking console.

## Current State

### Working (v0.5.1)
- Full EBU R128 two-pass loudnorm pipeline (probe → measure → normalize)
- CLI with all flags: output, loudness, LRA, true peak, audio codec/bitrate, backup strategies, dry-run, recursive, extensions, ffmpeg-path, sort-by, sort-order, verbose
- Library: `normalize()`, `normalizeFile()`, `normalizeFolder()` with typed options, progress callbacks, abort signal
- 6 releases published to npm (v0.2.4 through v0.5.1)
- Comprehensive README with CLI + API docs
- Video files (stream-copy) and audio-only files handled
- Module structure cleaned: `src/ffmpeg/` directory, `config.ts`, `sort.ts`, `format.ts`, `media.ts`, `fs.ts`
- No `utils.ts` catch-all, no god files, no `any`, all typed errors, 0 TS errors

### Test results
- 34 tests: 34 pass (3 integration skipped when ffmpeg unavailable)
- 5 new sort unit tests added this session

### Releases this session
- v0.3.0 — sort-by-mtime feature + ffprobe fix
- v0.4.0 — koko-cli CLI refactor
- v0.5.0 — deepen pass (module split, config/sort extraction, format.ts, cleanupAfterError, JSON parser regex)
- v0.5.1 — progress bar for analyze phase (replaced spinner)

## Next Steps / Pending

- [ ] **One-pass dynamic mode** — add `dynamic: true` option to skip Pass 1 and use dynamic loudnorm without measured values
- [ ] **Album batch mode** — `{ batch: true }` that measures all files first, then applies a single gain offset preserving relative loudness
- [ ] **Presets** — like `--preset podcast/music/streaming-video`
- [ ] **Selective audio streams** — allow users to pick which audio stream(s) to normalize in multi-stream files
- [ ] **Shell completions** — bash/zsh completions via koko-cli or custom generation
- [ ] **`--lower-only` flag** — prevent audio from increasing in loudness, only lower if needed
- [ ] **LICENSE file** — `package.json` says MIT but no actual `LICENSE` file in repo

## Important Context

- **Runtime:** Bun ≥1.2. **System dep:** ffmpeg ≥4.2 (for `loudnorm` filter)
- **Entry points:** `"exports"` maps `"."` → `dist/index.mjs` (lib), `"./cli"` → `dist/cli.mjs` (CLI module)
- **Build:** `bun run build` → tsdown bundles both entries + generates `.d.mts` declarations
- **Dev loop:** `bun run dev -- ./file.mp4 --dry-run` runs CLI from TypeScript source directly
- **Latest version:** v0.5.1 (released, tag pushed, release published on GitHub)
- **Current branch:** `main` (clean working tree, up to date with origin)
- **Remaining branches:** `main` + `release/v0.5.1` (stale release branches cleaned)
- **Dependencies:** `@zfadhli/koko-cli` only runtime dep (wraps cac v7 + picocolors + cli-progress + cli-spinners)
- **`--no-backup` handling:** Uses raw `process.argv.includes("--no-backup")` since cac v7 doesn't auto-negate string-argument options
- **ffprobe path resolution:** `resolveFfprobePath()` tries same directory as ffmpeg first, falls back to PATH. Falls back to ffmpeg -i parsing if ffprobe unavailable.
- **measurement validation:** If ffmpeg returns `-inf`/`nan` for any measured value, Pass 2 falls back to dynamic loudnorm (no `linear=true` or `measured_*` args).
- **No LICENSE file yet** — `package.json` says MIT but no actual `LICENSE` file in repo. Noted in handoff for two sessions now.
- **Module architecture:**
  ```
  src/
  ├── ffmpeg/{detect,probe,measure,normalize,parse,index}.ts
  ├── cli.ts, config.ts, format.ts, fs.ts, media.ts, sort.ts
  ├── normalize.ts, backup.ts, errors.ts, types.ts, index.ts
  ```
- **GitHub:** Repo at `zfadhli/peaknorm`, default branch `main`, publish on `v*` tags via npm with provenance.
