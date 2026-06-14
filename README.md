# peaknorm

[![npm version](https://img.shields.io/npm/v/peaknorm?style=flat-square)](https://www.npmjs.com/package/peaknorm)
[![CI](https://img.shields.io/github/actions/workflow/status/zfadhli/peaknorm/.github/workflows/ci.yml?style=flat-square)](https://github.com/zfadhli/peaknorm/actions)
[![License](https://img.shields.io/npm/l/peaknorm?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-≥1.2-000?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)

**Normalize audio loudness in media files** using the EBU R128 standard via ffmpeg. Works with video files (video passthrough, audio re-encoded) and audio-only files.

```bash
npx peaknorm ./video.mp4
```

---

## Features

- **EBU R128 two-pass loudnorm** — measures integrated loudness, LRA, and true peak, then applies linear normalization with precision
- **Video passthrough** — video stream is copied untouched (`-c:v copy`), only audio is re-encoded
- **In-place processing with backup** — overwrite originals safely with `.bak` / folder / suffix backup strategies, or disable backup entirely
- **Real-time progress** — per-file progress bar with phase labels (`Analyzing` / `Normalizing`) and percentage from ffmpeg
- **Batch folder processing** — recursive directory walk with configurable file extensions and sort order
- **Dry-run mode** — preview operations without requiring ffmpeg
- **Cancellation** — abort long-running operations via `AbortSignal`
- **Programmatic API** — import `normalize()`, `normalizeFile()`, or `normalizeFolder()` directly

## Installation

```bash
npm install -g peaknorm
```

Or use directly without installing:

```bash
npx peaknorm ./file.mp4
```

> [!IMPORTANT]
> [ffmpeg](https://ffmpeg.org) (≥4.2) must be installed on your system.\
> macOS: `brew install ffmpeg` — Ubuntu: `sudo apt install ffmpeg` — Windows: `choco install ffmpeg`

## CLI Usage

```bash
# Normalize a single video file (creates .bak, overwrites original)
peaknorm movie.mp4

# Normalize all media files in a folder (recursive by default)
peaknorm ./videos

# Output to a different directory instead of in-place
peaknorm ./input -o ./output

# Custom loudness target, disable backup, change audio codec
peaknorm ./files -l -16 --no-backup --audio-codec aac --audio-bitrate 128k

# Preview without processing (no ffmpeg needed)
peaknorm ./input --dry-run --verbose
```

### All options

```
  -o, --output <dir>       Output directory (default: same as input, in-place)
  -l, --loudness <num>     Target loudness in LUFS (default: -14)
  --lra <num>              Loudness range in LU (default: 7)
  -tp, --true-peak <num>   True peak limit in dBTP (default: -2)
  --audio-codec <name>     Audio codec (default: libopus)
  --audio-bitrate <str>    Audio bitrate (default: 96k)
  -b, --backup <strategy>  Backup strategy: copy, folder, suffix (default: copy)
  --no-backup              Disable backup entirely
  -r, --recursive          Recurse subdirectories (default: true)
  --no-recursive           Don't recurse subdirectories
  -e, --ext <ext>          File extensions to process (repeatable)
  --ffmpeg-path <path>     Custom ffmpeg binary path
  --dry-run                Preview without processing
  --sort-by <method>       Sort files by: name|mtime (default: name)
  --sort-order <dir>       Sort direction: asc|desc (default: asc)
  --verbose                Verbose output
  -h, --help               Show help
  -v, --version            Show version
```

## Programmatic API

```ts
import { normalize, normalizeFile, normalizeFolder } from "peaknorm";
import type {
  NormalizeOptions,
  NormalizeResult,
  BatchResult,
} from "peaknorm";
```

### normalize(input, options?)

Auto-detects whether the input is a file or a folder and processes accordingly.

```ts
const batch = await normalize("./input.mp4", {
  loudness: -16,
  onFileProgress: (file, percent, phase) => {
    console.log(`${phase}: ${file} ${percent}%`);
  },
  onFileComplete: (result) => {
    console.log(result.status);
  },
});

console.log(`Done: ${batch.completed}/${batch.total}`);
```

### normalizeFile(path, options?)

Normalize a single file. Returns a `NormalizeResult`.

```ts
const result = await normalizeFile("song.flac", {
  backup: "folder",
  dryRun: true,
});

if (result.status === "completed") {
  console.log(`${result.input} → ${result.output}`);
}
```

### normalizeFolder(path, options?)

Normalize all media files in a directory. Returns a `BatchResult`.

```ts
const batch = await normalizeFolder("./library", {
  extensions: [".flac", ".wav"],
  recursive: true,
  sortBy: "mtime",
  sortOrder: "desc",
  onFileError: (file, err) => {
    console.error(`Skipping ${file}: ${err.message}`);
  },
});
```

### Cancellation

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 60_000);

const batch = await normalize("./big-folder", { signal: ac.signal });
```

## How it works

Each file goes through a three-stage pipeline:

```
┌──────────┐    ┌──────────┐    ┌─────────────┐
│  Probe   │ →  │ Measure  │ →  │  Normalize  │
│ (~200ms) │    │ (Pass 1) │    │  (Pass 2)   │
└──────────┘    └──────────┘    └─────────────┘
```

| Stage | Action | Progress |
|---|---|---|
| **Probe** | `ffprobe` reads stream info and duration | — (instant) |
| **Measure** | `ffmpeg -af loudnorm=print_format=json` measures integrated loudness, LRA, true peak | `Analyzing [████░░░░] 35%` |
| **Normalize** | `ffmpeg -c:v copy -af loudnorm=linear=true:measured_I=...` applies correction, stream-copies video, re-encodes audio | `Normalizing [██████░░] 68%` |

> [!TIP]
> If the measured values contain `-inf` or `nan` (very quiet or silent content), peaknorm automatically falls back to dynamic loudnorm without `linear=true` or `measured_*` parameters.

### Backup strategies

On failure, the original is restored from the backup and partial output is deleted.

| Strategy | Behavior |
|---|---|
| `copy` (default) | `file.bak` alongside original |
| `folder` | `backups/file` in a subdirectory |
| `suffix` | Renames original to `file.original` |
| `false` / `--no-backup` | No backup created |

## Options reference

### NormalizeOptions

| Property | Type | Default | Description |
|---|---|---|---|
| `loudness` | `number` | `-14` | Target integrated loudness in LUFS |
| `lra` | `number` | `7` | Loudness range target in LU |
| `truePeak` | `number` | `-2` | True peak limit in dBTP |
| `audioCodec` | `string` | `"libopus"` | Output audio codec |
| `audioBitrate` | `string` | `"96k"` | Output audio bitrate |
| `output` | `string` | — | Output directory (omit for in-place) |
| `backup` | `BackupStrategy \| boolean` | `"copy"` | Backup strategy (`false` to disable) |
| `recursive` | `boolean` | `true` | Recurse subdirectories |
| `extensions` | `string[]` | _(see below)_ | File extensions to process |
| `ffmpegPath` | `string` | — | Custom ffmpeg binary path |
| `dryRun` | `boolean` | `false` | Preview without processing |
| `sortBy` | `"name" \| "mtime"` | `"name"` | Sort files by name or modification time |
| `sortOrder` | `"asc" \| "desc"` | `"asc"` | Sort direction |
| `signal` | `AbortSignal` | — | Cancellation signal |
| `onFileStart` | `(input, output) => void` | — | Called when a file starts |
| `onFileProgress` | `(file, percent, phase) => void` | — | Progress callback (0–100, `"analyzing"` or `"normalizing"`) |
| `onFileComplete` | `(result) => void` | — | Called when a file finishes |
| `onFileError` | `(input, error) => void` | — | Called when a file errors |

**Default extensions:** `.mp4` `.mkv` `.avi` `.mov` `.webm` `.m4v` `.ts` `.mp3` `.wav` `.flac` `.m4a` `.ogg` `.wma` `.aac` `.opus`

### NormalizeResult

```ts
interface NormalizeResult {
  input: string;                // Input file path
  output: string;               // Output file path
  status: "completed" | "skipped" | "error";
  error?: string;               // Error message if status is "error"
  backupPath?: string;          // Path to backup file
  inputSizeBytes: number;
  outputSizeBytes: number;
  durationMs: number;           // Processing time in milliseconds
}
```

### BatchResult

```ts
interface BatchResult {
  total: number;
  completed: number;
  skipped: number;
  errors: number;
  results: NormalizeResult[];
  durationMs: number;
}
```

## Error handling

Peaknorm defines a typed error hierarchy so you can catch specific failures:

```
PeaknormError
├── FfmpegNotFoundError   — ffmpeg not on PATH or at custom path
├── FfmpegError           — ffmpeg subprocess failed (exit code + stderr)
├── NormalizeError        — normalization failed for a specific file
├── BackupError           — backup creation or restore failed
└── NoMediaFilesError     — no matching files in the target folder
```

```ts
import { PeaknormError, FfmpegNotFoundError } from "peaknorm";

try {
  await normalize("./input");
} catch (err) {
  if (err instanceof FfmpegNotFoundError) {
    console.error("Please install ffmpeg first");
  } else if (err instanceof PeaknormError) {
    console.error(err.message);
  }
}
```

> [!NOTE]
> Per-file errors don't fail the batch — the file is marked as `error` in the results and processing continues with the next file.

## Supported formats

**Video containers:** `.mp4` `.mkv` `.avi` `.mov` `.webm` `.m4v` `.ts`

**Audio containers:** `.mp3` `.wav` `.flac` `.m4a` `.ogg` `.wma` `.aac` `.opus`

Customize with the `--ext` flag or `extensions` option.

## Development

```bash
# Clone and install
git clone https://github.com/zfadhli/peaknorm.git
cd peaknorm
bun install

# Run the CLI from source
bun run dev -- ./file.mp4 --dry-run

# Development commands
bun run check          # Lint + format check (Biome)
bun run typecheck      # TypeScript type check (tsc --noEmit)
bun run test           # Run unit tests
bun run test:integration  # Integration tests (requires ffmpeg)
bun run build          # Build dist/ via tsdown
```
