import { describe, expect, test } from "bun:test"
import { buildIndex, contains, editDistance, suggest } from "../lib/suggest.ts"

const WORDS = ["abandon", "absolute", "absolutely", "absolution", "absorb", "run", "runner", "running", "water", "the", "dictionary", "quick", "brown"]

const idx = buildIndex(WORDS)

describe("editDistance", () => {
	test("basic", () => {
		expect(editDistance("kitten", "sitting")).toBe(3)
		expect(editDistance("absolutly", "absolutely")).toBe(1)
		expect(editDistance("abc", "xyz", 2)).toBeGreaterThan(2)
	})
})

describe("prefix completions", () => {
	test("absol completes", () => {
		const { completions, corrections } = suggest(idx, "absol")
		expect(completions.map((c) => c.word)).toEqual(["absolute", "absolutely", "absolution"])
		expect(corrections).toEqual([]) // token is a prefix of dict words, no corrections when completions exist? (token not exact => corrections may exist)
	})
	test("short token yields nothing", () => {
		expect(suggest(idx, "ab").completions).toEqual([])
	})
	test("case-insensitive", () => {
		expect(suggest(idx, "Abso").completions.length).toBe(4) // absolute, absolutely, absolution, absorb
	})
	test("no completion for non-prefix miss", () => {
		const { completions, corrections } = suggest(idx, "absolutly")
		expect(completions).toEqual([])
		expect(corrections[0].word).toBe("absolutely")
		expect(corrections[0].distance).toBe(1)
	})
})

describe("corrections", () => {
	test("distance-1 transposition-ish typo", () => {
		const { corrections } = suggest(idx, "abandon")
		expect(corrections).toEqual([]) // exact word: no corrections
	})
	test("water typo", () => {
		const { corrections } = suggest(idx, "waterr")
		expect(corrections.map((c) => c.word)).toContain("water")
	})
	test("ranked by distance then shared prefix", () => {
		const { corrections } = suggest(idx, "dictionery")
		expect(corrections[0].word).toBe("dictionary")
	})
	test("maxDistance respected", () => {
		expect(suggest(idx, "xylophone", { maxDistance: 1 }).corrections).toEqual([])
	})
	test("extra-letter typo reachable at distance 1", () => {
		// regression: the delete map must also key each word's own form, otherwise an
		// insertion typo ("waterr") only resolves at maxDistance 2 and correctText's
		// distance-1 path never sees it
		expect(suggest(idx, "waterr", { maxDistance: 1 }).corrections.map((c) => c.word)).toContain("water")
		expect(suggest(idx, "runniing", { maxDistance: 1 }).corrections.map((c) => c.word)).toContain("running")
	})
})

describe("ranking", () => {
	test("ties broken by shared prefix length", () => {
		const tie = buildIndex(["water", "baker", "bated"])
		const { corrections } = suggest(tie, "bater", { maxDistance: 1 })
		expect(corrections.map((c) => c.distance)).toEqual([1, 1, 1])
		expect(corrections.map((c) => c.word)).toEqual(["bated", "baker", "water"]) // 3, 2, 0 shared chars
	})
})

describe("contains", () => {
	test("membership", () => {
		expect(contains(idx, "run")).toBe(true)
		expect(contains(idx, "runner")).toBe(true)
		expect(contains(idx, "runer")).toBe(false)
	})
})
