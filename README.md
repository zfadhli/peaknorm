# peaknorm

[![npm version](https://img.shields.io/npm/v/peaknorm?style=flat-square)](https://www.npmjs.com/package/peaknorm)
[![CI](https://img.shields.io/github/actions/workflow/status/zfadhli/peaknorm/.github/workflows/ci.yml?style=flat-square)](https://github.com/zfadhli/peaknorm/actions)
[![License](https://img.shields.io/npm/l/peaknorm?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-≥1.2-000?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)

**Normalize audio loudness in media files** using EBU R128 standard via ffmpeg. Works with video files (video passthrough, audio re-encoded) and audio-only files.

```bash
npx peaknorm ./video.mp4
```

---

## Features

- **EBU R128 two-pass loudnorm** — measures integrated loudness, then applies linear normalization with precision
- **Video passthrough** — video stream is copied untouched (`-c:v copy`), only audio is re-encoded
- **In-place processing with backup** — overwrite originals safely with `.bak` / folder / suffix backup strategies
- **Real-time progress bar** — shows `Analyzing` (Pass 1) and `Normalizing` (Pass 2) phases with percentage
- **Batch folder processing** — recursive directory walk, configurable file extensions
- **Dry-run mode** — preview operations without ffmpeg installed
- **Programmatic API** — import `normalize()` in any TypeScript/Bun/Node project (Hono, Elysia, etc.)

## Installation

```bash
# Install globally
npm install -g peaknorm

# Or use directly
npx peaknorm ./file.mp4
```

> [!IMPORTANT]
> [ffmpeg](https://ffmpeg.org) (≥4.2) must be installed on your system. On macOS: `brew install ffmpeg`, on Ubuntu: `sudo apt install ffmpeg`.

## CLI Usage

```bash
# Normalize a single video (creates .bak, overwrites original)
peaknorm movie.mp4

# Normalize all media in a folder (recursive by default)
peaknorm ./videos

# Custom loudness target, disable backup, change audio codec
peaknorm ./files -l -16 --no-backup --audio-codec aac --audio-bitrate 128k

# Preview what would be done (no ffmpeg needed)
peaknorm ./input --dry-run --verbose
```

### Options

```
  -o, --output <dir>       Output directory (default: same as input, in-place)
  -l, --loudness <num>     Target loudness in LUFS (default: -14)
  --lra <num>              Loudness range in LU (default: 7)
  -tp, --true-peak <num>   True peak limit in dBTP (default: -2)
  --audio-codec <name>     Audio codec (default: libopus)
  --audio-bitrate <str>    Audio bitrate (default: 96k)
  -b, --backup <strategy>  Backup: copy, folder, suffix (default: copy)
  --no-backup              Disable backup entirely
  -r, --recursive          Recurse subdirectories (default: true)
  --no-recursive           Don't recurse subdirectories
  -e, --ext <ext>          File extensions to process (repeatable)
  --ffmpeg-path <path>     Custom ffmpeg binary path
  --dry-run                Preview without processing
  --verbose                Verbose output
  -h, --help               Show help
  --version                Show version
```

## Programmatic API

```ts
import { normalize, normalizeFile, normalizeFolder } from "peaknorm";
import {
  PeaknormError,
  FfmpegNotFoundError,
  NormalizeError,
} from "peaknorm";
```

### normalize(input, options?)

Auto-detects file or folder.

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
  onFileError: (file, err) => {
    console.error(`Skipping ${file}: ${err.message}`);
  },
});
```

### AbortSignal support

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 60_000);

const batch = await normalize("./big-folder", { signal: ac.signal });
```

## How it works

Each file goes through a two-pass pipeline:

```
1. Probe     ffmpeg -i input → parse Duration + Stream info (~200ms)
             ↓
2. Analyze   ffmpeg -i input -af loudnorm=print_format=json -f null -
             → measures input_i, input_lra, input_tp, input_thresh, offset
             ↓
3. Normalize ffmpeg -i input -c:v copy -af loudnorm=linear=true:measured_*...
             -c:a libopus -b:a 96k output
```

### Step details

| Phase | What happens | Progress shown |
|---|---|---|
| **Starting** | File path resolved, backup created | `Starting filename...` |
| **Analyzing** | Pass 1 — ffmpeg measures integrated loudness, LRA, true peak | `████░░░░ 35% Analyzing` |
| **Normalizing** | Pass 2 — ffmpeg applies linear normalization with measured values, stream-copies video, re-encodes audio | `██████░░ 68% Normalizing` |

### Backup strategies

| Strategy | Behavior |
|---|---|
| `copy` (default) | `file.bak` alongside original |
| `folder` | `backups/file` in a `backups/` subdirectory |
| `suffix` | Renames original to `file.original` |
| `false` / `--no-backup` | No backup created |

On failure, the original is restored from the backup and partial output is deleted.

## Types

### NormalizeOptions

| Property | Type | Default | Description |
|---|---|---|---|
| `loudness` | `number` | `-14` | Target integrated loudness in LUFS |
| `lra` | `number` | `7` | Loudness range target in LU |
| `truePeak` | `number` | `-2` | True peak limit in dBTP |
| `audioCodec` | `string` | `"libopus"` | Output audio codec |
| `audioBitrate` | `string` | `"96k"` | Output audio bitrate |
| `output` | `string` | — | Output directory (omitted = in-place) |
| `backup` | `BackupStrategy \| boolean` | `"copy"` | Backup strategy (`false` to disable) |
| `recursive` | `boolean` | `true` | Recurse subdirectories |
| `extensions` | `string[]` | — | File extensions to process (default: 15 common media types) |
| `ffmpegPath` | `string` | — | Custom ffmpeg binary path |
| `dryRun` | `boolean` | `false` | Preview without processing |
| `signal` | `AbortSignal` | — | Cancellation signal |
| `onFileStart` | `(input, output) => void` | — | Called when a file starts |
| `onFileProgress` | `(file, percent, phase) => void` | — | Progress callback (percent 0–100, phase is `"analyzing"` or `"normalizing"`) |
| `onFileComplete` | `(result) => void` | — | Called when a file finishes |
| `onFileError` | `(input, error) => void` | — | Called when a file errors |

### NormalizeResult

```ts
interface NormalizeResult {
  input: string;           // Input file path
  output: string;          // Output file path
  status: "completed" | "skipped" | "error";
  error?: string;          // Error message if status is "error"
  backupPath?: string;     // Path to backup file (if created)
  inputSizeBytes: number;
  outputSizeBytes: number;
  durationMs: number;      // Processing time
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

Peaknorm defines a hierarchy of error classes:

```
PeaknormError
├── FfmpegNotFoundError   — ffmpeg not on PATH or at custom path
├── FfmpegError           — ffmpeg subprocess failed (exit code + stderr tail)
├── NormalizeError        — normalization failed for a specific file
├── BackupError           — backup creation/restore failed
└── NoMediaFilesError     — no matching files found in the given folder
```

All errors extend `PeaknormError`, which extends `Error`. Catch broadly or specifically:

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

Per-file errors don't fail the batch — the file is marked as `error` in the results and processing continues.

## Supported formats

**Video containers:** `.mp4` `.mkv` `.avi` `.mov` `.webm` `.m4v` `.ts`

**Audio containers:** `.mp3` `.wav` `.flac` `.m4a` `.ogg` `.wma` `.aac` `.opus`

## Development

```bash
# Clone and install
git clone https://github.com/zfadhli/peaknorm.git
cd peaknorm
bun install

# Dev workflow
bun run dev -- ./file.mp4 --dry-run  # Run CLI from source
bun run check                         # Lint + format
bun run typecheck                     # TypeScript check
bun run test                          # Run tests
bun run build                         # Build dist/

# Integration tests (requires ffmpeg)
bun run test:integration
```
