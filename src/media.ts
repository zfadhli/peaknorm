import { type Dirent, readdirSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * Walk a directory recursively and return all media file paths
 * matching the given extensions.
 */
export function findMediaFiles(
	dir: string,
	extensions: string[],
	recursive: boolean,
): string[] {
	const extSet = new Set(
		extensions.map((e) =>
			e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`,
		),
	);
	const results: string[] = [];

	function walk(path: string): void {
		let entries: Dirent[];
		try {
			entries = readdirSync(path, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = join(path, entry.name);

			if (entry.isDirectory() && recursive) {
				walk(fullPath);
			} else if (entry.isFile()) {
				const ext = extname(entry.name).toLowerCase();
				if (extSet.has(ext)) {
					results.push(fullPath);
				}
			}
		}
	}

	walk(dir);
	return results.sort();
}
