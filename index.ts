// pi-coding-agent extension: word autocomplete & spelling correction.
//
// Reads a plain word list (words.txt next to this file, produced once from the
// Lingoes .ld2 dictionaries via `go run ./cmd/dict words`; see lib/wordlist.ts
// for the format) and stacks an AutocompleteProvider on top of pi's built-in
// completion:
//
//   absol<Tab>    → absolute / absolutely / …
//   absolutly<Tab>→ absolutely            ("did you mean")
//
// Slash commands, @file, #refs and path completion are delegated untouched.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { type KeyId } from "@earendil-works/pi-tui"

import { createWordProvider } from "./lib/provider.ts"
import { contains, suggest, type SuggestIndex } from "./lib/suggest.ts"
import { loadWordlist, type Wordlist } from "./lib/wordlist.ts"
import { loadSettings, defaultSettings, type Settings } from "./lib/settings.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_WORDS_FILE = join(HERE, "words.txt")

export default function (pi: ExtensionAPI): void {
	let settings: Settings = { ...defaultSettings }
	let wordlist: Wordlist | undefined
	let loadError: string | undefined

	const index = (): SuggestIndex | null => wordlist?.index ?? null

	async function reload(): Promise<void> {
		loadError = undefined
		try {
			wordlist = await loadWordlist(settings.wordsFile ?? DEFAULT_WORDS_FILE)
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err)
			wordlist = undefined
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		settings = await loadSettings()
		if (ctx.mode === "tui") {
			ctx.ui.addAutocompleteProvider((current) =>
				createWordProvider(index, current, {
					minPrefix: settings.minPrefix,
					maxVisible: settings.maxVisible,
					maxDistance: settings.maxDistance,
				}),
			)
		}
		void reload()
	})

	// ---- commands ----------------------------------------------------------

	pi.registerCommand("word-status", {
		description: "Word-list autocomplete status (file, words, timings)",
		handler: async (_args, ctx) => {
			if (loadError) return ctx.ui.notify(`pi-word-autocomplete: ${loadError}`, "error")
			if (!wordlist) return ctx.ui.notify("pi-word-autocomplete: still loading…", "info")
			const s = wordlist.stats
			ctx.ui.notify(
				`${s.words} words · ${s.source} · parse ${s.loadMs.toFixed(1)}ms + index ${s.indexMs.toFixed(0)}ms`,
				"info",
			)
		},
	})

	pi.registerCommand("word-reload", {
		description: "Re-read the word list",
		handler: async (_args, ctx) => {
			await reload()
			ctx.ui.notify(loadError ? `pi-word-autocomplete: ${loadError}` : `reloaded (${wordlist?.stats.words ?? 0} words)`, loadError ? "error" : "info")
		},
	})

	function correctEditor(ctx: { ui: { getEditorText(): string; setEditorText(t: string): void; notify(msg: string, level?: "info" | "warning" | "error"): void } }): void {
		if (!wordlist) { ctx.ui.notify("pi-word-autocomplete: not loaded yet", "warning"); return }
		const before = ctx.ui.getEditorText()
		if (!before) return
		const { text, fixes } = correctText(wordlist.index, before)
		if (fixes.length === 0) { ctx.ui.notify("no confident corrections found", "info"); return }
		ctx.ui.setEditorText(text)
		ctx.ui.notify(`corrected: ${fixes.join(", ")}`, "info")
	}

	pi.registerShortcut(settings.shortcut as KeyId, {
		description: "Correct spelling in editor text",
		handler: async (ctx) => { correctEditor(ctx) },
	})

	pi.registerCommand("word-correct", {
		description: "Spelling correction: /word-correct <text> or /word-correct (corrects editor text)",
		handler: async (args, ctx) => {
			if (!wordlist) return ctx.ui.notify("pi-word-autocomplete: not loaded yet", "warning")
			const before = args?.trim() || ctx.ui.getEditorText()
			if (!before) return ctx.ui.notify("usage: /word-correct <text>", "info")
			const { text, fixes } = correctText(wordlist.index, before)
			if (fixes.length === 0) return ctx.ui.notify("no confident corrections found", "info")
			ctx.ui.setEditorText(text)
			ctx.ui.notify(`corrected: ${fixes.join(", ")}`, "info")
		},
	})

	// ---- pre-submit autocorrect (opt-in, default off) ----------------------

	pi.on("input", async (event, ctx) => {
		if (!settings.autocorrectOnSubmit || !wordlist || event.source === "extension") {
			return { action: "continue" as const }
		}
		const { text, fixes } = correctText(wordlist.index, event.text)
		if (fixes.length === 0) return { action: "continue" as const }
		ctx.ui.notify(`autocorrect: ${fixes.join(", ")}`, "info")
		return { action: "transform" as const, text }
	})
}

/** Replace tokens that have exactly one confident (distance-1) correction. */
function correctText(idx: SuggestIndex, text: string): { text: string; fixes: string[] } {
	const fixes: string[] = []
	const out = text.replace(/\b[A-Za-z][A-Za-z'-]{2,29}\b/g, (token) => {
		if (contains(idx, token.toLowerCase())) return token
		const { corrections } = suggest(idx, token, { minPrefix: 3, maxVisible: 5, maxDistance: 1 })
		if (corrections.length !== 1) return token
		fixes.push(`${token}→${corrections[0].word}`)
		return token[0] === token[0].toUpperCase() ? cap(corrections[0].word) : corrections[0].word
	})
	return { text: out, fixes }
}

function cap(w: string): string {
	return w[0].toUpperCase() + w.slice(1)
}
