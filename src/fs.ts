import { statSync } from "node:fs"

/**
 * Check whether a path exists and is a regular file.
 */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Check whether a path exists and is a directory.
 */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Get file size in bytes, or 0 if the file doesn't exist.
 */
export function getFileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
