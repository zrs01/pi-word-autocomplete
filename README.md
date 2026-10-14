# pi-word-autocomplete

Word **autocomplete** and **spelling correction** in pi's input editor.
One plain word list (`words.txt`, 41k words, 0.37 MB), no runtime dependencies.

```bash
pi install git:github.com/zrs01/pi-word-autocomplete
```

This package is distributed from this repository only — it is **not** published
to npm, so `npm:pi-word-autocomplete` and the [pi.dev/packages](https://pi.dev/packages)
gallery (which indexes npm) do not apply. To run it from a clone instead of
installing: `pi -e .`

## Use

| you type | result |
|---|---|
| `absol` + Tab | `absolute / absolutely / absolution …` |
| `absolutly` + Tab | `absolutely  did you mean (ed=1)` (edit distance ≤ 2) |
| `/word-st` + Tab, `@file`, `~/path`, `#…` | built-in completion, untouched |

**Shortcut** `Ctrl+Alt+C` (Linux/Win) / `Ctrl+Cmd+C` (macOS) — corrects the whole
editor buffer in place.

**Commands** `/word-status` (file, words, timings) · `/word-reload` ·
`/word-correct <text>` (corrects text, or the buffer when given no args).

Correction replaces only tokens with **exactly one** distance-1 candidate, so
ambiguous typos are left alone; `absolutly` → `absolutely` but `waterr` stays
until you pick from the Tab list.

**Settings** `~/.config/pi/pi-word-autocomplete.json`: `wordsFile` (default: the
bundled `words.txt`), `minPrefix` (3), `maxVisible` (20), `maxDistance` (2),
`autocorrectOnSubmit` (false — rewrites every submitted message), `shortcut`.

## Word list

One lowercase ASCII word per line, `LC_ALL=C sort -u`-ordered; binary search
depends on that order. Derived once from two Lingoes `.ld2` dictionaries with
the dictionary repo's `cmd/dict words` tool — no frequency or per-dictionary
data is kept, so regenerating means re-running that tool and piping
`| cut -f1 | LC_ALL=C sort -u` over `words.txt`.

## Performance (measured, 41k words)

| stage | cost |
|---|---|
| parse `words.txt` | **~3 ms** |
| build delete-map | ~190 ms, once at startup (async) |
| prefix completion query | < 1 ms |
| correction query | ~0.04 ms |

The delete-map keys each word's own form as well as its delete-1 forms (338k
keys). That self-key is what makes extra-letter typos (`wroong` → `wrong`)
reachable at `maxDistance: 1`, the distance `/word-correct` and the shortcut
work at — keying only delete-1 forms silently drops that whole typo class.

## Test

```bash
bun test              # suggest, wordlist, settings, provider contract, the real
                      # pi-tui Tab popup, and index.ts through a fake-pi harness
                      # (no API key needed)
bun x tsc --noEmit    # 65 tests; 100% line + function coverage of index.ts and lib/
```

Manual TUI check (unit tests can't exercise pi's completion wiring):

```bash
tmux new-session -d -s word -x 140 -y 40 "pi -e $PWD/index.ts" && sleep 5
tmux send-keys -t word "/word-status" Enter && sleep 2 && tmux capture-pane -pt word | tail -5
tmux send-keys -t word -l "the waterr" && tmux send-keys -t word Tab && sleep 1 && tmux capture-pane -pt word | tail -7
tmux kill-session -t word
```

Expect `41095 words` with no load error, then `water … did you mean (ed=1)` as
the first completion.

On Windows (no tmux) the same wiring is covered by `test/popup.test.ts`, which
drives pi-tui's real `Editor` and asserts Tab makes the popup visible. `words.txt`
is pinned to LF by `.gitattributes`: a `core.autocrlf=true` checkout otherwise
puts a `\r` on every word, and the popup silently never appears (a lone match is
auto-applied by pi instead of shown).

## License

MIT — see [LICENSE](LICENSE).
