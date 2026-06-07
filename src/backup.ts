import {
	copyFileSync,
	mkdirSync,
	renameSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { BackupError } from "./errors.ts";
import type { BackupStrategy } from "./types.ts";

export interface BackupResult {
	path: string;
	strategy: BackupStrategy;
}

/**
 * Create a backup of a file before processing.
 *
 * Strategies:
 *   "copy"   — copy file to `<original>.bak`
 *   "folder" — copy file to `<original-dir>/backups/<basename>`
 *   "suffix" — rename original to `<original>.original`
 */
export function createBackup(
	filePath: string,
	strategy: BackupStrategy,
): BackupResult {
	try {
		switch (strategy) {
			case "copy": {
				const backupPath = `${filePath}.bak`;
				copyFileSync(filePath, backupPath);
				return { path: backupPath, strategy };
			}

			case "folder": {
				const dir = dirname(filePath);
				const base = basename(filePath);
				const backupDir = join(dir, "backups");
				mkdirSync(backupDir, { recursive: true });
				const backupPath = join(backupDir, base);
				copyFileSync(filePath, backupPath);
				return { path: backupPath, strategy };
			}

			case "suffix": {
				const backupPath = `${filePath}.original`;
				renameSync(filePath, backupPath);
				return { path: backupPath, strategy };
			}

			default:
				throw new BackupError(
					filePath,
					`Unknown backup strategy: ${strategy as string}`,
				);
		}
	} catch (err) {
		throw new BackupError(
			filePath,
			err instanceof Error ? err.message : String(err),
		);
	}
}

/**
 * Restore a file from its backup.
 */
export function restoreBackup(
	backup: BackupResult,
	originalPath: string,
): void {
	try {
		switch (backup.strategy) {
			case "copy":
			case "folder": {
				copyFileSync(backup.path, originalPath);
				break;
			}

			case "suffix": {
				renameSync(backup.path, originalPath);
				break;
			}
		}
	} catch (err) {
		throw new BackupError(
			originalPath,
			`Failed to restore backup: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Delete a backup file after successful processing.
 */
export function deleteBackup(backup: BackupResult): void {
	try {
		unlinkSync(backup.path);
	} catch {
		// Ignore cleanup failures
	}
}

/**
 * Get file size in bytes.
 */
export function getFileSize(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}
