import { describe, expect, test } from "bun:test"
import { createWordProvider, extractToken, type AutocompleteProvider } from "../lib/provider.ts"
import { buildIndex } from "../lib/suggest.ts"

const idx = buildIndex(["absolute", "absolutely", "absolution", "run", "water", "dictionary"])

const delegated: string[] = []
const base: AutocompleteProvider = {
	async getSuggestions() {
		delegated.push("get")
		return { items: [{ value: "BASE", label: "BASE" }], prefix: "" }
	},
	applyCompletion(lines, line, col, item) {
		const l = lines[line]
		return { lines: [...lines.slice(0, line), l + item.value, ...lines.slice(line + 1)], cursorLine: line, cursorCol: col + item.value.length }
	},
}

const provider = createWordProvider(() => idx, base)

async function sug(line: string, col = line.length) {
	return (await provider.getSuggestions([line], 0, col, { signal: new AbortController().signal, force: true }))!
}

describe("extractToken", () => {
	test("word before cursor", () => expect(extractToken("the absol", 9)).toBe("absol"))
	test("word with hyphen/apostrophe", () => expect(extractToken("rock-n roll'", 13)).toBe("roll'"))
	test("none after slash", () => expect(extractToken("/word", 5)).toBeUndefined())
	test("none after @", () => expect(extractToken("@ld2", 4)).toBeUndefined())
	test("none after ~ or / in path", () => expect(extractToken("~/dev", 5)).toBeUndefined())
	test("none inside slash command lines", () => expect(extractToken("/cmd absol", 10)).toBeUndefined())
	test("none mid-word after dot (version/decimals)", () => expect(extractToken("v1.absol", 8)).toBeUndefined())
	test("CJK yields nothing", () => expect(extractToken("词彙", 2)).toBeUndefined())
})

describe("provider", () => {
	test("completions with token prefix", async () => {
		const s = await sug("fix the absol")
		expect(s.prefix).toBe("absol")
		expect(s.items.map((i) => i.value)).toEqual(["absolute", "absolutely", "absolution"])
		expect(delegated).toEqual([])
	})
	test("corrections marked did-you-mean", async () => {
		const s = await sug("the absolutly")
		expect(s.items[0].description).toContain("did you mean")
		expect(s.items[0].value).toBe("absolutely")
	})
	test("delegates slash/@/path tokens", async () => {
		delegated.length = 0
		await sug("/word")
		await sug("@src/inde")
		await sug("~/dev/so")
		expect(delegated.length).toBe(3)
	})
	test("delegates short tokens and index-less state", async () => {
		delegated.length = 0
		await sug("ab")
		expect(delegated).toEqual(["get"])
		const empty = createWordProvider(() => null, base)
		delegated.length = 0
		await empty.getSuggestions(["absol"], 0, 5, { signal: new AbortController().signal, force: true })
		expect(delegated).toEqual(["get"])
	})
	test("applyCompletion delegates to base", async () => {
		const r = provider.applyCompletion(["the absol"], 0, 9, { value: "absolute", label: "absolute" }, "absol")
		expect(r.lines[0]).toBe("the absolabsolute") // base is naive; we only assert delegation happened
	})
	test("delegates when nothing matches at all", async () => {
		delegated.length = 0
		const s = await sug("xylophone")
		expect(delegated).toEqual(["get"])
		expect(s.items.map((i) => i.value)).toEqual(["BASE"])
	})
	test("file-completion trigger follows base, defaults to allow", async () => {
		const strict = createWordProvider(() => idx, { ...base, shouldTriggerFileCompletion: () => false })
		expect(strict.shouldTriggerFileCompletion?.(["@ld2"], 0, 4)).toBe(false)
		expect(provider.shouldTriggerFileCompletion?.(["the absol"], 0, 9)).toBe(true) // base has no hook
	})
	test("respects abort signal", async () => {
		const ac = new AbortController()
		ac.abort()
		expect(await provider.getSuggestions(["the absol"], 0, 9, { signal: ac.signal, force: true })).toBeNull()
	})
})
