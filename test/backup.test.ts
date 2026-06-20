import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const testDir = join(tmpdir(), "peaknorm-test-backup")

function createTestFile(name: string): string {
  const path = join(testDir, name)
  writeFileSync(path, "test content")
  return path
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe("backup", () => {
  it("creates .bak copy backup", async () => {
    const { createBackup, deleteBackup } = await import("../src/backup.ts")
    const filePath = createTestFile("test.mp4")
    const result = createBackup(filePath, "copy")

    expect(result.strategy).toBe("copy")
    expect(result.path).toBe(`${filePath}.bak`)
    expect(existsSync(result.path)).toBe(true)

    deleteBackup(result)
    expect(existsSync(result.path)).toBe(false)
  })

  it("creates folder backup", async () => {
    const { createBackup, deleteBackup } = await import("../src/backup.ts")
    const filePath = createTestFile("test.mp4")
    const result = createBackup(filePath, "folder")

    expect(result.strategy).toBe("folder")
    expect(result.path).toContain("backups")
    expect(existsSync(result.path)).toBe(true)

    deleteBackup(result)
    expect(existsSync(result.path)).toBe(false)
  })

  it("creates suffix backup (renames original)", async () => {
    const { createBackup, deleteBackup } = await import("../src/backup.ts")
    const filePath = createTestFile("test.mp4")
    const result = createBackup(filePath, "suffix")

    expect(result.strategy).toBe("suffix")
    expect(result.path).toBe(`${filePath}.original`)
    expect(existsSync(result.path)).toBe(true)
    // File was renamed, so original no longer exists
    expect(existsSync(filePath)).toBe(false)

    // Restore to clean up
    const { restoreBackup } = await import("../src/backup.ts")
    restoreBackup(result, filePath)
    expect(existsSync(filePath)).toBe(true)
    deleteBackup(result)
  })

  it("restores from copy backup", async () => {
    const { createBackup, deleteBackup, restoreBackup } = await import("../src/backup.ts")
    const filePath = createTestFile("test.mp4")
    const originalSize = statSync(filePath).size
    const result = createBackup(filePath, "copy")

    // Modify original
    writeFileSync(filePath, "modified content")
    expect(statSync(filePath).size).not.toBe(originalSize)

    // Restore
    restoreBackup(result, filePath)
    expect(statSync(filePath).size).toBe(originalSize)

    deleteBackup(result)
  })

  it("restores from suffix backup", async () => {
    const { createBackup, deleteBackup, restoreBackup } = await import("../src/backup.ts")
    const filePath = createTestFile("test.mp4")
    const result = createBackup(filePath, "suffix")

    // Original was moved, so original doesn't exist
    expect(existsSync(filePath)).toBe(false)

    // Restore
    restoreBackup(result, filePath)
    expect(existsSync(filePath)).toBe(true)

    deleteBackup(result)
    expect(existsSync(result.path)).toBe(false)
  })

  it("returns file size", async () => {
    const { getFileSize } = await import("../src/backup.ts")
    const filePath = createTestFile("test.mp4")
    const size = getFileSize(filePath)
    expect(size).toBeGreaterThan(0)
  })

  it("returns 0 for non-existent file", async () => {
    const { getFileSize } = await import("../src/backup.ts")
    const size = getFileSize("/nonexistent/file.mp4")
    expect(size).toBe(0)
  })
})
