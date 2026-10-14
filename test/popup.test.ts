// Popup wiring against pi-tui's real Editor, not a fake: this is the layer that
// decides whether the completion popup is shown at all. Regression guard for the
// Windows checkout case (core.autocrlf=true -> CRLF words.txt), where every item
// carried a trailing carriage return, so pi auto-applied the lone match instead of
// showing a popup.
import { describe, expect, test } from "bun:test"
import { CombinedAutocompleteProvider, Editor, type TUI } from "@earendil-works/pi-tui"
import { join } from "node:path"
import { createWordProvider } from "../lib/provider.ts"
import { loadWordlist } from "../lib/wordlist.ts"

const id = (s: string) => s
const passthroughTheme = {
	borderColor: id,
	selectList: { selectedPrefix: id, selectedText: id, description: id, scrollInfo: id, noMatch: id },
} as never

function makeEditor(provider: ReturnType<typeof createWordProvider>): Editor {
	const tui = { requestRender() {}, hideCursor: () => {}, showCursor: () => {} } as unknown as TUI
	const editor = new Editor(tui, passthroughTheme)
	editor.setAutocompleteProvider(provider)
	return editor
}

/** Press Tab (pi-tui's force/explicitTab path) and wait for the request to settle. */
async function pressTab(editor: Editor): Promise<void> {
	editor.handleInput("\t")
	for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
}

describe("completion popup (real pi-tui editor)", () => {
	test("Tab shows a popup for a typo, with no control chars in it", async () => {
		const wl = await loadWordlist(join(import.meta.dir, "..", "words.txt"))
		const base = new CombinedAutocompleteProvider([], process.cwd(), null)
		const editor = makeEditor(createWordProvider(() => wl.index, base, { minPrefix: 3, maxVisible: 20, maxDistance: 2 }))

		editor.setText("the waterr")
		await pressTab(editor)
		expect(editor.isShowingAutocomplete()).toBe(true)

		editor.setText("fix the absol")
		await pressTab(editor)
		expect(editor.isShowingAutocomplete()).toBe(true)

		const s = (await createWordProvider(() => wl.index, base, { minPrefix: 3, maxVisible: 20, maxDistance: 2 })
			.getSuggestions(["fix the absol"], 0, 13, { signal: new AbortController().signal, force: true }))!
		expect(s.prefix).not.toMatch(/[\x00-\x1f\x7f]/)
		for (const item of s.items) {
			expect(item.value).not.toMatch(/[\x00-\x1f\x7f]/)
			expect(item.label).not.toMatch(/[\x00-\x1f\x7f]/)
		}
	})
})
