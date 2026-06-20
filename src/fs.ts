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
