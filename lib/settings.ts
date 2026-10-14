// Settings persistence: ~/.config/pi/pi-word-autocomplete.json
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export interface Settings {
	/** word list file (one lowercase word per line); default: the bundled words.txt */
	wordsFile?: string
	minPrefix: number
	maxVisible: number
	maxDistance: number
	autocorrectOnSubmit: boolean
	/** key binding for in-editor correct, e.g. "ctrl+shift+w" or "ctrl+super+c" */
	shortcut?: string
}

export const defaultSettings: Settings = {
	minPrefix: 3,
	maxVisible: 20,
	maxDistance: 2,
	autocorrectOnSubmit: false,
	shortcut: process.platform === "darwin" ? "ctrl+super+c" : "ctrl+alt+c",
}

export function settingsPath(): string {
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pi", "pi-word-autocomplete.json")
}

export async function loadSettings(): Promise<Settings> {
	try {
		return { ...defaultSettings, ...JSON.parse(await readFile(settingsPath(), "utf8")) }
	} catch {
		return { ...defaultSettings }
	}
}

export async function saveSettings(s: Settings): Promise<void> {
	const p = settingsPath()
	await mkdir(dirname(p), { recursive: true })
	await writeFile(p, JSON.stringify(s, null, 2))
}
