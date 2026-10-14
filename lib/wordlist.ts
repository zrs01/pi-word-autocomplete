// Loads the word list from a static file — no .ld2, no Go, no cache.
//
// Format: one lowercase ASCII word per line, sorted (see README for how the
// file is produced once from the Lingoes .ld2 dictionaries).
import { readFile, stat } from "node:fs/promises"
import { buildIndex, type SuggestIndex } from "./suggest.ts"

export interface LoadStats {
	words: number
	source: string
	mtimeMs: number
	loadMs: number
	indexMs: number
}

export interface Wordlist {
	index: SuggestIndex
	stats: LoadStats
}

export async function loadWordlist(wordsFile: string): Promise<Wordlist> {
	const t0 = performance.now()
	const raw = await readFile(wordsFile, "utf8")
	const words = raw.split("\n").filter(Boolean)
	const t1 = performance.now()
	const index = buildIndex(words)
	const t2 = performance.now()
	const s = await stat(wordsFile).catch(() => null)
	return {
		index,
		stats: { words: words.length, source: wordsFile, mtimeMs: s?.mtimeMs ?? 0, loadMs: t1 - t0, indexMs: t2 - t1 },
	}
}
