// Integration tests for the extension entry: fake ExtensionAPI harness driving
// the real handlers (session_start, commands, shortcut, input autocorrect).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ext from "../index.ts"

// --- fake pi ---------------------------------------------------------------

type Handler = (event: never, ctx: Ctx) => unknown
type Ctx = {
	mode: string
	ui: {
		notify(msg: string, level?: "info" | "warning" | "error"): void
		getEditorText(): string
		setEditorText(t: string): void
		addAutocompleteProvider(factory: (current: unknown) => unknown): void
	}
}

interface Harness {
	providers: Array<(current: unknown) => unknown>
	commands: Record<string, { description?: string; handler: (args: string, ctx: Ctx) => Promise<void> }>
	shortcuts: Array<{ key: string; handler: (ctx: Ctx) => Promise<void> }>
	handlers: Record<string, Handler[]>
}

function fakePi(): Harness {
	const h: Harness = { providers: [], commands: {}, shortcuts: [], handlers: {} }
	const pi = {
		on(event: string, handler: (...args: never[]) => unknown) {
			;(h.handlers[event] ??= []).push(handler as Handler)
			return () => {
				h.handlers[event] = (h.handlers[event] ?? []).filter((f) => f !== handler)
			}
		},
		registerCommand(name: string, opts: { description?: string; handler: (args: string, ctx: Ctx) => Promise<void> }) {
			h.commands[name] = opts
		},
		registerShortcut(key: string, opts: { handler: (ctx: Ctx) => Promise<void> }) {
			h.shortcuts.push({ key, handler: opts.handler })
		},
		registerTool() {},
		registerFlag() {},
	}
	// biome-ignore lint/suspicious/noExplicitAny: fake API surface
	ext(pi as any)
	return h
}

function fakeCtx(editor = "", mode = "tui") {
	const notes: Array<{ msg: string; level?: string }> = []
	let text = editor
	const ctx: Ctx = {
		mode,
		ui: {
			notify: (msg, level) => notes.push({ msg, level }),
			getEditorText: () => text,
			setEditorText: (t) => {
				text = t
			},
			addAutocompleteProvider: (f) => providers.push(f),
		},
	}
	const providers: Array<(current: unknown) => unknown> = []
	return { ctx, notes, providers, get text() { return text }, set text(t: string) { text = t } }
}

// --- fixtures --------------------------------------------------------------

let cfgDir: string
let wordsFile: string
let base: string
const WORDS = "absolute\nabsolutely\nabsolution\nwater\ndictionary\n"

async function writeWords(content: string): Promise<void> {
	await writeFile(wordsFile, content)
}

async function writeSettings(extra: Record<string, unknown>): Promise<void> {
	await mkdir(join(cfgDir, "pi"), { recursive: true })
	await writeFile(join(cfgDir, "pi", "pi-word-autocomplete.json"), JSON.stringify({ wordsFile, ...extra }))
}

const savedXdg = process.env.XDG_CONFIG_HOME

beforeAll(async () => {
	base = await mkdtemp(join(tmpdir(), "word-ext-"))
	wordsFile = join(base, "words.txt")
	await writeWords(WORDS)
	cfgDir = join(base, "config")
	process.env.XDG_CONFIG_HOME = cfgDir
})

afterAll(() => {
	if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
	else process.env.XDG_CONFIG_HOME = savedXdg
})

/** Boot the extension with the given settings and wait for the wordlist load. */
async function boot(extra: Record<string, unknown> = {}, editor = "") {
	await writeWords(WORDS) // each test starts from the base list
	await writeSettings(extra)
	const h = fakePi()
	const f = fakeCtx(editor)
	await h.handlers.session_start![0]({ type: "session_start", reason: "startup" } as never, f.ctx)
	await h.commands["word-reload"]!.handler("", f.ctx) // join the async load
	f.notes.length = 0 // drop the "reloaded" notice so tests see only their own output
	return { h, f, notes: f.notes }
}

describe("session_start", () => {
	test("registers an autocomplete provider in tui mode", async () => {
		const { h, f } = await boot()
		expect(f.providers.length).toBe(1)
		const baseProvider = {
			async getSuggestions() {
				return { items: [{ value: "BASE", label: "BASE" }], prefix: "" }
			},
			applyCompletion: (l: string[]) => ({ lines: l, cursorLine: 0, cursorCol: 0 }),
		}
		const provider = (f.providers[0]!(baseProvider)) as {
			getSuggestions(l: string[], n: number, c: number, o: { signal: AbortSignal }): Promise<{ items: Array<{ value: string }> } | null>
		}
		const s = await provider.getSuggestions(["the absol"], 0, 9, { signal: new AbortController().signal })
		expect(s!.items.map((i) => i.value)).toEqual(["absolute", "absolutely", "absolution"])
		expect(h.shortcuts.length).toBe(1)
		expect(h.shortcuts[0]!.key).toBe(process.platform === "darwin" ? "ctrl+super+c" : "ctrl+alt+c")
	})

	test("no provider outside tui mode", async () => {
		await writeSettings({})
		const h = fakePi()
		const f = fakeCtx("", "rpc")
		await h.handlers.session_start![0]({ type: "session_start", reason: "startup" } as never, f.ctx)
		expect(f.providers.length).toBe(0)
	})
})

describe("word-status / word-reload", () => {
	test("reports words, source and timings", async () => {
		const { h, f } = await boot()
		await h.commands["word-status"]!.handler("", f.ctx)
		const last = f.notes.at(-1)!.msg
		expect(last).toContain("5 words")
		expect(last).toContain("words.txt")
		expect(last).toMatch(/parse [\d.]+ms \+ index \d+ms/)
	})

	test("reload picks up an edited word file", async () => {
		const { h, f } = await boot()
		await writeWords(WORDS + "zebra\n")
		await h.commands["word-reload"]!.handler("", f.ctx)
		expect(f.notes.at(-1)!.msg).toBe("reloaded (6 words)")
	})

	test("missing word file surfaces as an error, not a crash", async () => {
		const { h, f } = await boot({ wordsFile: join(base, "nope.txt") })
		await h.commands["word-status"]!.handler("", f.ctx)
		expect(f.notes.at(-1)!.level).toBe("error")
		expect(f.notes.at(-1)!.msg).toContain("pi-word-autocomplete:")
		await h.commands["word-reload"]!.handler("", f.ctx)
		expect(f.notes.at(-1)!.level).toBe("error")
	})
})

describe("word-correct", () => {
	test("corrects args text and writes it to the editor", async () => {
		const { h, f } = await boot()
		await h.commands["word-correct"]!.handler("the absolutly waterr dog", f.ctx)
		expect(f.text).toBe("the absolutely water dog")
		const last = f.notes.at(-1)!
		expect(last.msg).toContain("absolutly→absolutely")
		expect(last.msg).toContain("waterr→")
	})

	test("no args corrects the editor text in place", async () => {
		const { h, f } = await boot({}, "the absolutly dog")
		await h.commands["word-correct"]!.handler("", f.ctx)
		expect(f.text).toBe("the absolutely dog")
		expect(f.notes.at(-1)!.msg).toBe("corrected: absolutly→absolutely")
	})

	test("preserves capitalisation", async () => {
		const { h, f } = await boot({}, "Absolutly sure")
		await h.commands["word-correct"]!.handler("", f.ctx)
		expect(f.text).toBe("Absolutely sure")
	})

	test("ambiguous typo left alone (needs exactly one candidate)", async () => {
		const { h, f } = await boot({}, "the abso dog") // absolute/absolutely/absolution
		await h.commands["word-correct"]!.handler("", f.ctx)
		expect(f.text).toBe("the abso dog")
		expect(f.notes.at(-1)!.msg).toBe("no confident corrections found")
	})

	test("correct words and short tokens untouched", async () => {
		const { h, f } = await boot({}, "absolutely the a ab cat")
		await h.commands["word-correct"]!.handler("", f.ctx)
		expect(f.text).toBe("absolutely the a ab cat")
	})

	test("empty input is a usage notice", async () => {
		const { h, f } = await boot({}, "")
		await h.commands["word-correct"]!.handler("   ", f.ctx)
		expect(f.notes.at(-1)!.msg).toBe("usage: /word-correct <text>")
	})

	test("before load warns instead of throwing", async () => {
		await writeSettings({ wordsFile: join(base, "nope.txt") })
		const h = fakePi()
		const f = fakeCtx("absolutly")
		await h.commands["word-correct"]!.handler("", f.ctx)
		expect(f.notes.at(-1)!.level).toBe("warning")
		expect(f.text).toBe("absolutly")
	})
})

describe("correct shortcut", () => {
	test("edits the editor in place", async () => {
		const { h, f } = await boot({}, "fix the absolutly dog")
		await h.shortcuts[0]!.handler(f.ctx)
		expect(f.text).toBe("fix the absolutely dog")
		expect(f.notes.at(-1)!.msg).toContain("absolutly→absolutely")
	})

	test("empty editor is a silent no-op", async () => {
		const { h, f } = await boot({}, "")
		await h.shortcuts[0]!.handler(f.ctx)
		expect(f.notes.length).toBe(0)
	})

	test("no confident fix notifies without editing", async () => {
		const { h, f } = await boot({}, "absolutely fine")
		await h.shortcuts[0]!.handler(f.ctx)
		expect(f.text).toBe("absolutely fine")
		expect(f.notes.at(-1)!.msg).toBe("no confident corrections found")
	})

	test("warns when the list is not loaded", async () => {
		await writeSettings({ wordsFile: join(base, "nope.txt") })
		const h = fakePi()
		const f = fakeCtx("absolutly")
		await h.shortcuts[0]!.handler(f.ctx)
		expect(f.notes.at(-1)!.level).toBe("warning")
	})
})

describe("input autocorrect (opt-in)", () => {
	const input = (text: string, source = "interactive") =>
		({ type: "input", text, source }) as never

	test("off by default: text passes through", async () => {
		const { h, f } = await boot()
		const res = await h.handlers.input![0]!(input("the absolutly dog"), f.ctx)
		expect(res).toEqual({ action: "continue" })
	})

	test("on: transforms typos and notifies", async () => {
		const { h, f } = await boot({ autocorrectOnSubmit: true })
		const res = (await h.handlers.input![0]!(input("the absolutly dog"), f.ctx)) as { action: string; text?: string }
		expect(res.action).toBe("transform")
		expect(res.text).toBe("the absolutely dog")
		expect(f.notes.at(-1)!.msg).toBe("autocorrect: absolutly→absolutely")
	})

	test("on: clean text is not transformed", async () => {
		const { h, f } = await boot({ autocorrectOnSubmit: true })
		const res = (await h.handlers.input![0]!(input("absolutely fine"), f.ctx)) as { action: string }
		expect(res).toEqual({ action: "continue" })
	})

	test("on: extension-sourced input is never rewritten", async () => {
		const { h, f } = await boot({ autocorrectOnSubmit: true })
		const res = (await h.handlers.input![0]!(input("the absolutly dog", "extension"), f.ctx)) as { action: string }
		expect(res).toEqual({ action: "continue" })
	})

	test("on: no list loaded leaves input alone", async () => {
		const { h, f } = await boot({ autocorrectOnSubmit: true, wordsFile: join(base, "nope.txt") })
		const res = (await h.handlers.input![0]!(input("the absolutly dog"), f.ctx)) as { action: string }
		expect(res).toEqual({ action: "continue" })
	})
})

describe("bundled word list", () => {
	test("ships a list that loads and corrects without config", async () => {
		// no wordsFile in settings -> defaults to words.txt next to index.ts
		await writeSettings({ wordsFile: undefined })
		const h = fakePi()
		const f = fakeCtx("did you mean absolutly?")
		await h.handlers.session_start![0]({ type: "session_start", reason: "startup" } as never, f.ctx)
		await h.commands["word-reload"]!.handler("", f.ctx)
		await h.shortcuts[0]!.handler(f.ctx)
		expect(f.text).toBe("did you mean absolutely?")
	})
})
