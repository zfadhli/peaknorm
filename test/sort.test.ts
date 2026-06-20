import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { sortFileList } from "../src/sort.ts"

describe("sortFileList", () => {
  it("returns files as-is for name ascending (findMediaFiles already sorts)", () => {
    const files = ["a.mp3", "b.mp3", "c.mp3"]
    expect(sortFileList(files, "name", "asc")).toBe(files)
  })

  it("sorts by name descending", () => {
    const files = ["a.mp3", "b.mp3", "c.mp3"]
    expect(sortFileList(files, "name", "desc")).toEqual(["c.mp3", "b.mp3", "a.mp3"])
  })

  it("handles empty array", () => {
    expect(sortFileList([], "name", "asc")).toEqual([])
  })

  it("sorts by modification time ascending", () => {
    const dir = mkdtempSync(join(tmpdir(), "sort-test-"))
    const old = join(dir, "old.mp3")
    const mid = join(dir, "mid.mp3")
    const newFile = join(dir, "new.mp3")
    writeFileSync(old, "")
    writeFileSync(mid, "")
    writeFileSync(newFile, "")
    utimesSync(old, new Date("2020-01-01"), new Date("2020-01-01"))
    utimesSync(mid, new Date("2023-06-01"), new Date("2023-06-01"))
    utimesSync(newFile, new Date("2026-01-01"), new Date("2026-01-01"))

    const sorted = sortFileList([newFile, old, mid], "mtime", "asc")
    expect(sorted).toEqual([old, mid, newFile])

    rmSync(dir, { recursive: true, force: true })
  })

  it("sorts by modification time descending", () => {
    const dir = mkdtempSync(join(tmpdir(), "sort-test-"))
    const old = join(dir, "old.wav")
    const newFile = join(dir, "new.wav")
    writeFileSync(old, "")
    writeFileSync(newFile, "")
    utimesSync(old, new Date("2020-01-01"), new Date("2020-01-01"))
    utimesSync(newFile, new Date("2026-01-01"), new Date("2026-01-01"))

    const sorted = sortFileList([old, newFile], "mtime", "desc")
    expect(sorted).toEqual([newFile, old])

    rmSync(dir, { recursive: true, force: true })
  })
})
