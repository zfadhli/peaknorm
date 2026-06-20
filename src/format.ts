import type { NormalizeResult } from "./types.ts"

/**
 * Format a NormalizeResult into an array of lines for display.
 *
 * Pure function — returns formatted strings without side effects.
 * The caller is responsible for output (console.error, file, etc.).
 */
export function formatResult(result: NormalizeResult): string[] {
  const lines: string[] = []
  const time = `  time taken: ${(result.durationMs / 1000).toFixed(1)}s`

  switch (result.status) {
    case "completed": {
      const inMB = (result.inputSizeBytes / 1024 / 1024).toFixed(1)
      const isInPlace = result.input === result.output
      const sizeChanged =
        result.inputSizeBytes !== result.outputSizeBytes && result.outputSizeBytes > 0

      const showArrow = !isInPlace || sizeChanged
      const sizePart = showArrow
        ? `  size: ${inMB}MB → ${(result.outputSizeBytes / 1024 / 1024).toFixed(1)}MB`
        : `  size: ${inMB}MB`

      lines.push("[completed]")
      lines.push(`  filename: ${result.input}`)
      lines.push(sizePart)
      lines.push(time)
      break
    }
    case "skipped":
      lines.push("[skipped]")
      lines.push(`  filename: ${result.input}`)
      break
    case "error":
      lines.push("[error]")
      lines.push(`  filename: ${result.input}`)
      lines.push(`  error: ${result.error ?? "Unknown error"}`)
      break
  }

  return lines
}
