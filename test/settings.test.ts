import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { defaultSettings, loadSettings, saveSettings, settingsPath } from "../lib/settings.ts"

const savedXdg = process.env.XDG_CONFIG_HOME

afterAll(() => {
	if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
	else process.env.XDG_CONFIG_HOME = savedXdg
})

async function inConfigDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "word-cfg-"))
	process.env.XDG_CONFIG_HOME = dir
	return dir
}

/** Write raw bytes to the settings file, creating ~/.config/pi as needed. */
async function writeRawSettings(body: string): Promise<void> {
	const p = settingsPath()
	await mkdir(join(p, ".."), { recursive: true })
	await writeFile(p, body)
}

describe("settingsPath", () => {
	test("uses XDG_CONFIG_HOME/pi", () => {
		const dir = "/tmp/xdg-test"
		process.env.XDG_CONFIG_HOME = dir
		expect(settingsPath()).toBe(join(dir, "pi", "pi-word-autocomplete.json"))
	})

	test("falls back to ~/.config", () => {
		delete process.env.XDG_CONFIG_HOME
		expect(settingsPath()).toBe(join(homedir(), ".config", "pi", "pi-word-autocomplete.json"))
	})
})

describe("loadSettings", () => {
	test("no file gives defaults", async () => {
		await inConfigDir()
		expect(await loadSettings()).toEqual(defaultSettings)
	})

	test("corrupt file gives defaults instead of throwing", async () => {
		await inConfigDir()
		await writeRawSettings("{not json")
		expect(await loadSettings()).toEqual(defaultSettings)
	})

	test("partial file merges over defaults", async () => {
		await inConfigDir()
		await writeRawSettings(JSON.stringify({ minPrefix: 5 }))
		const s = await loadSettings()
		expect(s.minPrefix).toBe(5)
		expect(s.maxVisible).toBe(defaultSettings.maxVisible)
		expect(s.autocorrectOnSubmit).toBe(false)
	})
})

describe("saveSettings", () => {
	test("creates the directory and round-trips", async () => {
		await inConfigDir() // nested "pi" dir does not exist yet
		await saveSettings({ ...defaultSettings, maxDistance: 1, shortcut: "alt+shift+w" })
		const raw = await readFile(settingsPath(), "utf8")
		expect(raw).toContain('"maxDistance": 1') // pretty-printed for hand-editing
		expect(await loadSettings()).toEqual({ ...defaultSettings, maxDistance: 1, shortcut: "alt+shift+w" })
	})

	test("overwrites a previous file", async () => {
		await inConfigDir()
		await saveSettings({ ...defaultSettings, minPrefix: 4 })
		await saveSettings({ ...defaultSettings, minPrefix: 2 })
		expect((await loadSettings()).minPrefix).toBe(2)
	})
})

describe("defaults", () => {
	test("autocorrect is opt-in and a shortcut is set per platform", () => {
		expect(defaultSettings.autocorrectOnSubmit).toBe(false)
		expect(defaultSettings.shortcut).toBe(process.platform === "darwin" ? "ctrl+super+c" : "ctrl+alt+c")
	})
})
