# pi-draft-stash

pi-draft-stash is an extension for the [pi coding agent](https://github.com/earendil-works/pi). It parks the draft in pi's prompt editor, including pasted images and large pasted blocks, as plain files on disk. It brings the draft back when you ask, or automatically after your next prompt.

## Install

Once published to npm:

```sh
pi install npm:pi-draft-stash
```

From a local checkout:

```sh
pi install /path/to/pi-draft-stash
```

To try it for one session without installing:

```sh
pi -e /path/to/pi-draft-stash
```

This extension registers `alt+s` and `/stash`. Other stash extensions that use the same key or command, such as `@yusukeshib/pi-stash`, conflict with it. Remove them first. If you keep both, pi renames the commands to `/stash:1` and `/stash:2`.

## Keys and commands

| Input | What it does |
|---|---|
| `alt+s` with text in the editor | Saves the draft to a new stash folder, then clears the editor. The editor is cleared only after the files are written, so a failed save keeps your draft. |
| `alt+s` with an empty editor | Restores the newest stash. |
| `/stash` | Opens a picker, newest first, showing age and image count. Choosing one restores it. |
| `/stash pop` | Restores the newest stash. |
| `/stash drop` | Opens a picker and moves the chosen stash to `.trash`. |
| `/stash list` | Prints the folder path of every stash, so you can copy a `prompt.md` path into another tool. |

Auto-restore: after you stash with `alt+s` and then submit a normal prompt, the stashed draft reappears in the editor. This matches the Claude Code flow of parking a draft, asking a quick question, and getting the draft back. Extension commands and `!bash` lines do not trigger it. Turn it off with `PI_DRAFT_STASH_AUTO_RESTORE=0`.

If you restore while the editor holds text, the current text is stashed first, so nothing is overwritten. The footer shows `stash:N` while N stashes exist.

## macOS Option key

Your terminal must send Option as Alt, or `option+s` types "ß" and pi never sees the shortcut. In Ghostty, set `macos-option-as-alt = true`. In iTerm2, open the profile's Keys settings and choose "Esc+" for the Option key.

## Storage

Each stash is a folder under `~/.pi/agent/stash/` (the location follows `PI_CODING_AGENT_DIR`):

```
~/.pi/agent/stash/
  20261010-174501-fix-the-login-bug-in-auth/
    prompt.md        # the draft text, pasted blocks expanded
    image-1.png      # copies of the images the draft referred to
    image-2.jpg
  .trash/
    20261009-090000-old-draft/
```

The folder name is the local time followed by the first six words of the draft. If two stashes land in the same second, the second gets `-2` appended.

`prompt.md` holds only the draft text, with no header. Image references in it are absolute paths to the copies in the same folder, and the copies are named `image-<n>` so the paths contain no spaces.

When you restore or drop a stash, the folder moves to `.trash/` and its modification time is set to now. The restored draft's image paths point into `.trash/`, so they keep working. Trash entries older than 3 days are deleted when a pi session starts.

Only images in a temp folder are copied: files ending in png, jpg, jpeg, gif or webp under the system temp directory, `/tmp`, `/private/tmp`, `/var/folders` or `/private/var/folders`. Pi writes clipboard images there, and macOS may delete them. Images elsewhere, such as inside your repository, are left as they are. Paths with spaces, including backslash-escaped ones, are handled.

### Settings

You set these with environment variables, which are read once when pi starts.

| Variable | Default | Meaning |
|---|---|---|
| `PI_DRAFT_STASH_DIR` | `~/.pi/agent/stash` | Where stashes are stored. |
| `PI_DRAFT_STASH_KEY` | `alt+s` | Any pi key id, for example `ctrl+alt+s`. Set it to `none` or an empty string to register no shortcut. |
| `PI_DRAFT_STASH_AUTO_RESTORE` | on | Set to `0` to turn auto-restore off. |

Pi's `keybindings.json` cannot rebind extension shortcuts, which is why the key is an environment variable.

## Using a stash from other tools

Because a stash is an ordinary folder, other programs can read it. In Claude Code you can attach a draft with `@~/.pi/agent/stash/<name>/prompt.md`. From a shell:

```sh
cat ~/.pi/agent/stash/*/prompt.md | less
grep -rl "login" ~/.pi/agent/stash/*/prompt.md
cp ~/.pi/agent/stash/<name>/image-1.png ~/Desktop/
```

## Limitations

- Pasted blocks come back expanded, not collapsed into `[paste #1 +N lines]` markers. Pi's editor offers no way to re-collapse them.
- Only images in temp folders are copied. Repository image paths are left alone.
- An image path whose file was already gone before you stashed is not detected, and no warning appears.
- Restoring the newest stash is global across sessions and projects.
- A storage directory whose path contains spaces produces image paths with unescaped spaces.
- If a draft mentions two files where one name is a prefix of the other, such as `a.png` and `a.png x.png`, the shorter existing file wins.

## Development

```sh
npm test
```

This needs Node 22.18 or later, which runs TypeScript test files directly. The logic lives in `lib/stash-core.ts` with no pi imports. `extensions/index.ts` is the pi glue. The extension has no runtime dependencies beyond Node and pi itself.

## License

MIT. See `LICENSE`.
