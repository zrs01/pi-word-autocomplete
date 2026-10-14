// AutocompleteProvider implementation, decoupled from pi via structural types
// so it can be unit-tested with a fake base provider.

import type { SuggestIndex } from "./suggest.ts"
import { suggest } from "./suggest.ts"

// --- structural mirrors of @earendil-works/pi-tui types ---
export interface AutocompleteItem {
	value: string
	label: string
	description?: string
}
export interface AutocompleteSuggestions {
	items: AutocompleteItem[]
	prefix: string
}
export interface AutocompleteProvider {
	triggerCharacters?: string[]
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: { signal: AbortSignal; force?: boolean },
	): Promise<AutocompleteSuggestions | null>
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number }
	shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean
}

export interface ProviderOptions {
	minPrefix: number
	maxVisible: number
	maxDistance: number
}

export const defaultProviderOptions: ProviderOptions = {
	minPrefix: 3,
	maxVisible: 20,
	maxDistance: 2,
}

/** ASCII word token immediately before the cursor, or undefined. */
export function extractToken(line: string, cursorCol: number): string | undefined {
	const before = line.slice(0, cursorCol)
	const m = /([A-Za-z][A-Za-z'\-]*)$/.exec(before)
	if (!m) return undefined
	const prev = before[m.index - 1]
	// After a special char the token belongs to another provider
	// (slash command, @file, #ref, ~/path, version-like v1.abc) or is a path part.
	// \r: a pasted CRLF buffer keeps a bare CR mid-line; completing there would
	// render a popup over a row whose left half is overwritten by that CR.
	if (prev !== undefined && "/@#~$\\.\r".includes(prev)) return undefined
	// Inside a slash command line ("/cmd ..."): first word is a command.
	if (/^\s*\/[^\s]*$/.test(before) || /^\s*\//.test(before)) return undefined
	return m[1]
}

export function createWordProvider(
	getIndex: () => SuggestIndex | null,
	base: AutocompleteProvider,
	opts: ProviderOptions = defaultProviderOptions,
): AutocompleteProvider {
	return {
		// no triggerCharacters: word items show on explicit Tab (force),
		// not on every keystroke
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const line = lines[cursorLine] ?? ""
			const token = extractToken(line, cursorCol)
			const idx = getIndex()
			if (!token || !idx || token.length < opts.minPrefix) {
				return base.getSuggestions(lines, cursorLine, cursorCol, options)
			}
			const { completions, corrections } = suggest(idx, token, {
				minPrefix: opts.minPrefix,
				maxVisible: opts.maxVisible,
				maxDistance: opts.maxDistance,
			})
			if (completions.length === 0 && corrections.length === 0) {
				return base.getSuggestions(lines, cursorLine, cursorCol, options)
			}
			if (options.signal.aborted) return null
			const items: AutocompleteItem[] = [
				...completions.map((c) => ({ value: c.word, label: c.word })),
				...corrections.map((c) => ({ value: c.word, label: c.word, description: `did you mean (ed=${c.distance})` })),
			]
			return { items: items.slice(0, opts.maxVisible), prefix: token }
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return base.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return base.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true
		},
	}
}
