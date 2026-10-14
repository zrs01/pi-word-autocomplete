// Suggestion engine: prefix completion + SymSpell-style correction.
// Pure TS, no dependencies — unit-testable in isolation.

export interface Candidate {
	word: string
	distance: number // 0 = exact prefix completion, 1..2 = correction
}

export interface SuggestIndex {
	sorted: string[] // sorted lowercase words
	// delete-0/1 map: word and deleted-form -> indices into sorted
	deleteMap: Map<string, number[]>
}

const MAX_TOKEN_LEN = 30

export function buildIndex(words: string[]): SuggestIndex {
	const sorted = words.slice().sort()
	const deleteMap = new Map<string, number[]>()
	for (let i = 0; i < sorted.length; i++) {
		// The word itself (delete-0) must be a key too: a typo with an extra letter
		// ("waterr" → "water") reaches it as a delete-1 query variant, and without
		// this key that distance-1 candidate would be invisible.
		for (const d of [sorted[i], ...deletesOf(sorted[i])]) {
			let list = deleteMap.get(d)
			if (!list) deleteMap.set(d, (list = []))
			list.push(i)
		}
	}
	return { sorted, deleteMap }
}

/** All strings obtained by deleting exactly one character. */
function deletesOf(word: string): string[] {
	const out: string[] = []
	for (let i = 0; i < word.length; i++) out.push(word.slice(0, i) + word.slice(i + 1))
	return out
}

/** Delete-0/1/2 variants of a query word (deduplicated). */
function queryVariants(word: string, max: number): string[] {
	const seen = new Set<string>([word])
	let frontier = [word]
	for (let step = 0; step < max; step++) {
		const next: string[] = []
		for (const f of frontier) for (const d of deletesOf(f)) if (!seen.has(d)) (seen.add(d), next.push(d))
		frontier = next
	}
	return [...seen]
}

/** Levenshtein distance, early-exiting above `cap`. */
export function editDistance(a: string, b: string, cap = 2): number {
	if (Math.abs(a.length - b.length) > cap) return cap + 1
	const prev = new Array<number>(b.length + 1)
	const cur = new Array<number>(b.length + 1)
	for (let j = 0; j <= b.length; j++) prev[j] = j
	for (let i = 1; i <= a.length; i++) {
		cur[0] = i
		let rowMin = cur[0]
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
			if (cur[j] < rowMin) rowMin = cur[j]
		}
		if (rowMin > cap) return cap + 1
		for (let j = 0; j <= b.length; j++) prev[j] = cur[j]
	}
	return prev[b.length]
}

/** Prefix completion (binary search) + corrections, capped and ranked. */
export function suggest(
	idx: SuggestIndex,
	token: string,
	opts: { minPrefix?: number; maxVisible?: number; maxDistance?: number } = {},
): { completions: Candidate[]; corrections: Candidate[] } {
	const maxDistance = opts.maxDistance ?? 2
	const token0 = token.toLowerCase()
	if (token0.length < (opts.minPrefix ?? 3) || token0.length > MAX_TOKEN_LEN) {
		return { completions: [], corrections: [] }
	}

	// ---- completions: words starting with token, alphabetical (sorted order) ----
	const start = lowerBound(idx.sorted, token0)
	const completions: Candidate[] = []
	for (let i = start; i < idx.sorted.length && idx.sorted[i].startsWith(token0); i++) {
		completions.push({ word: idx.sorted[i], distance: 0 })
	}

	// ---- corrections only when the token is not itself a word ----
	const corrections: Candidate[] = []
	const exact = start < idx.sorted.length && idx.sorted[start] === token0
	if (!exact && maxDistance > 0) {
		const variants = queryVariants(token0, maxDistance)
		const seen = new Set<number>()
		for (const v of variants) {
			const hits = idx.deleteMap.get(v)
			if (!hits) continue
			for (const i of hits) {
				if (seen.has(i)) continue
				seen.add(i)
				const w = idx.sorted[i]
				if (w === token0 || w.startsWith(token0)) continue
				const d = editDistance(token0, w, maxDistance)
				if (d <= maxDistance) corrections.push({ word: w, distance: d })
			}
		}
		corrections.sort(
			(a, b) =>
				a.distance - b.distance ||
				commonPrefixLen(token0, b.word) - commonPrefixLen(token0, a.word) ||
				(a.word < b.word ? -1 : 1),
		)
		corrections.length = Math.min(corrections.length, opts.maxVisible ?? 20)
	}
	completions.length = Math.min(completions.length, opts.maxVisible ?? 20)
	return { completions, corrections }
}

function commonPrefixLen(a: string, b: string): number {
	let n = 0
	while (n < a.length && n < b.length && a[n] === b[n]) n++
	return n
}

function lowerBound(words: string[], folded: string): number {
	let lo = 0,
		hi = words.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (words[mid] < folded) lo = mid + 1
		else hi = mid
	}
	return lo
}

/** True if the folded token is a word in the index. */
export function contains(idx: SuggestIndex, folded: string): boolean {
	const i = lowerBound(idx.sorted, folded)
	return i < idx.sorted.length && idx.sorted[i] === folded
}
