# AGENTS.md — peaknorm

Agent orientation for working on this repository.

## What peaknorm does

Normalize audio loudness in media files using EBU R128 (ffmpeg loudnorm). Ships as an npm CLI tool (`peaknorm`) and a programmatic API (`normalize()`, `normalizeFile()`, `normalizeFolder()`).

## Quick start

```sh
git clone https://github.com/zfadhli/peaknorm.git
cd peaknorm
nub install
nub run dev -- ./file.mp4 --dry-run   # CLI from TS source
```

## Commands

| Purpose | Command | Expected on success |
|---------|---------|-------------------|
| Install | `nub install` | exit 0 |
| Typecheck | `nub run typecheck` (`tsc --noEmit`) | exit 0, no errors |
| Tests | `nub run test` (`vitest run`) | 34 pass |
| Integration | `nub run test:integration` | skips if no ffmpeg |
| Lint | `nub run check` (`biome check .`) | exit 0 |
| Build | `nub run build` (`tsdown`) | 8 files in dist/ |

## Architecture

```
src/
├── cli.ts              # Entry point (bin: peaknorm)
├── normalize.ts        # Core orchestration: file + folder + auto-detect
├── config.ts           # Defaults + option resolution
├── types.ts            # All public + internal types
├── errors.ts           # Typed error hierarchy (PeaknormError base)
├── backup.ts           # Backup/restore strategies
├── ffmpeg/
│   ├── detect.ts       # ffmpeg/ffprobe path resolution
│   ├── probe.ts        # Stream info via ffprobe (fallback ffmpeg -i)
│   ├── measure.ts      # Pass 1: loudnorm measurement
│   ├── normalize.ts    # Pass 2: loudnorm normalization
│   ├── parse.ts        # ffmpeg stderr parsing (progress + errors)
│   └── index.ts        # Re-exports
├── format.ts           # Result formatting for CLI
├── media.ts            # Directory walk filter
├── sort.ts             # File list sorting
├── fs.ts               # File system helpers
└── index.ts            # Public API exports
```

Pipeline per file: `Probe → Measure (Pass 1) → Normalize (Pass 2)`.

## Code conventions

- **TypeScript 6, strict mode, ESM** (`"type": "module"`)
- **No `any`, no `as` casts** (one exception: `config.ts` uses `as BackupStrategy` on the coercing `backup` option)
- **No `@ts-ignore` / `@ts-expect-error`** — fix the types instead
- **No semicolons** (Biome `semicolons: "asNeeded"`)
- **Error classes** extend `PeaknormError` with `override name = "..."` — match existing classes in `src/errors.ts`
- **Async over sync** for ffmpeg subprocess calls (`spawn` not `spawnSync`)
- **Cleanup must never throw** — wrap cleanup in try/catch with empty catch blocks
- **Test pattern**: vitest, `describe`/`it`/`expect`, integration tests gated on `hasFfmpeg()`, model new tests after `test/backup.test.ts`

## Key design decisions

- **No runtime lock-in**: augmentation via Node extension surfaces only, no Bun-specific APIs
- **Backup disabled by default** — opts in via `--backup copy|folder|suffix`
- **ffmpeg path**: detect via `spawnSync("ffmpeg", ["-version"])`, fallback to `ffprobe` or `ffmpeg -i` parsing
- **`-ignore_editlist 1`**: applied as demuxer option (before `-i`) for MOV/MP4 containers only
- **Dynamic mode** (`--dynamic`): skip measurement pass, null measurement → loudnorm without linear=true
- **Measurement timeout**: removed (0), normalize pass 2 timeout: removed (0) — cancel via AbortSignal/Ctrl+C

## Publishing

1. `nub run build` to verify dist/
2. `npm publish` (CI handles provenance via `.github/workflows/publish.yml`)
3. Tag: `git tag v<version> && git push origin v<version>`

## CI

Workflows in `.github/workflows/`:
- `ci.yml` — check, typecheck, build, test on push/PR to main
- `publish.yml` — npm publish on release publish
