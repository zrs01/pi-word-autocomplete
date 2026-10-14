# pi-word-autocomplete

pi-coding-agent extension: word **autocomplete** and **spelling
correction** in pi's input editor.

Runtime reads **one plain file** — `words.txt` next to `index.ts`
(41k words, 0.4 MB). No `.ld2` file, no Go, no cache directory at runtime.

## Regenerating the word list (rare, from this repo)

```bash
# from the dictionary repo (paths relative to that repo)
{ go run ./cmd/dict words -dict "data/Longman Dictionary of Contemporary English.ld2"
  go run ./cmd/dict words -dict "data/Oxford Advanced Learner's Dictionary v6.ld2"; } |
  cut -f1 | LC_ALL=C sort -u > <this repo>/words.txt
```

Format: one lowercase ASCII word per line, `LC_ALL=C sort -u`-ordered. No
frequency or per-dictionary info is kept.

## Use

```bash
pi install npm:pi-word-autocomplete   # published package
pi -e .                               # or from a clone of this repo, one run
pi -e /path/to/pi-word-autocomplete/index.ts
```

The repo root is the package: `package.json` declares `pi.extensions:
["./index.ts"]` and carries the `pi-package` keyword, which is what makes the
[package gallery](https://pi.dev/packages) pick it up once it is published to
npm. Unpublished git clones install with `pi install git:<host>/<repo>` but
never show in the gallery — it indexes npm only.

| you type | result |
|---|---|
| `absol` + Tab | `absolute / absolutely / absolution …` |
| `absolutly` + Tab | `absolutely  did you mean (ed=1)` (edit distance ≤ 2) |
| `/word-st` + Tab, `@file`, `~/path`, `#…` | built-in completion, untouched |

**Shortcut:** `Ctrl+Alt+C` (Linux/Win) / `Ctrl+Cmd+C` (macOS) — corrects all text in the editor in-place.
Configurable via `shortcut` in settings, e.g. `"ctrl+alt+c"`, `"ctrl+super+c"`, `"alt+shift+w"`.

Commands: `/word-status` (file, words, timings), `/word-reload`,
`/word-correct <text>` (corrects text and places result in editor).
Settings `~/.config/pi/pi-word-autocomplete.json`:
`wordsFile` (default: bundled `words.txt`), `minPrefix`, `maxVisible`,
`maxDistance`, `autocorrectOnSubmit`.

## Performance notes (measured, 41k words)

| stage | cost |
|---|---|
| parse `words.txt` (word per line, split) | **~3 ms** (0.37 MB) |
| build delete-map (corrections) | ~190 ms, once at startup (async) |
| prefix completion query | < 1 ms (binary search, pre-sorted) |
| correction query | ~0.04 ms (delete-map); fallback linear scan would be ~5 ms |

The map keys each word's own form as well as its delete-1 forms (338k keys for
41k words). The self-key is what makes extra-letter typos ("wroong" →
`wrong`) reachable at `maxDistance: 1`, which is the distance
`/word-correct`/shortcut autocorrect works at.

Why TSV over alternatives: smaller and faster to parse than any JSON variant
(JSON-object: 1.0 MB / ~7 ms) and greppable/diffable; the only faster option is
a binary blob (uint32 offsets + one string buffer, sub-ms parse), which only
matters when the list reaches hundreds of thousands of entries — the real
startup cost is the delete-map, not the file format.

## Test

```bash
bun test              # suggest / wordlist / settings / provider contract /
                      # index.ts via a fake-pi harness (commands, shortcut,
                      # autocorrect) — no API key needed
bun x tsc --noEmit
```

100% line and function coverage of `index.ts` and `lib/`; the only uncovered
path is the `stat().catch()` fallback in `lib/wordlist.ts`, which needs a file
that disappears between read and stat.

Manual TUI smoke (tmux; the same matrix as before extraction):

```bash
tmux new-session -d -s word -x 140 -y 40 "pi -e $PWD/index.ts" && sleep 5
tmux send-keys -t word "/word-status" Enter && sleep 2 && tmux capture-pane -pt word | tail -5
# word completion + "did you mean":
tmux send-keys -t word -l "the waterr" && tmux send-keys -t word Tab && sleep 1 && tmux capture-pane -pt word | tail -7
tmux kill-session -t word
```

Expected: `/word-status` reports 41095 words and no load error; `the waterr`
+ Tab lists `water … did you mean (ed=1)` first. `/word-correct <text>` edits
tokens that have exactly one distance-1 fix and leaves ambiguous ones alone.
