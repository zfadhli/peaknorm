import { statSync } from "node:fs"

/**
 * Sort a list of file paths by the given criterion and direction.
 */
export function sortFileList(
  files: string[],
  by: "name" | "mtime",
  order: "asc" | "desc",
): string[] {
  if (by === "name") {
    // findMediaFiles already sorts lexicographically ascending
    return order === "asc" ? files : [...files].reverse()
  }

  // Sort by modification time
  const entries = files.map((f) => {
    let mtime = 0
    try {
      mtime = statSync(f).mtimeMs
    } catch {
      // file may have been removed between discovery and sorting
    }
    return { path: f, mtime }
  })

  entries.sort((a, b) => (order === "asc" ? a.mtime - b.mtime : b.mtime - a.mtime))

  return entries.map((e) => e.path)
}
