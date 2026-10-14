import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadWordlist } from "../lib/wordlist.ts"

async function tmpFile(content: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "dict-words-"))
	const p = join(dir, "words.txt")
	await writeFile(p, content)
	return p
}

describe("loadWordlist", () => {
	test("parses word-per-line file", async () => {
		const wl = await loadWordlist(await tmpFile("abandon\nabsolute\nrun\n"))
		expect(wl.stats.words).toBe(3)
		expect(wl.index.sorted).toEqual(["abandon", "absolute", "run"]) // sorted for binary search
	})

	test("sorts unsorted input", async () => {
		const wl = await loadWordlist(await tmpFile("water\nrun\n"))
		expect(wl.index.sorted).toEqual(["run", "water"])
	})

	test("suggest works on loaded list", async () => {
		const wl = await loadWordlist(await tmpFile("absolutely\nabsolute\nwaterr\n"))
		expect(wl.index.sorted).toEqual(["absolute", "absolutely", "waterr"])
	})

	test("missing file rejects", async () => {
		const err = await loadWordlist("/nonexistent/words.txt").then(() => null, (e) => e as NodeJS.ErrnoException & { cause?: Error })
		expect(err).not.toBeNull()
		expect([err!.code, (err!.cause as NodeJS.ErrnoException | undefined)?.code]).toContain("ENOENT")
	})
})
