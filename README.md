# DAEMONS Server

*DRAFT name -- the app may become **DAEMONS Neuron**.*

Makes a computer a **host** of the [DAEMONS companion](https://github.com/CodeMusic/daemons-companion)'s mind: it lends
its cycles to the household's hub on its owner's terms, and (later) is paid in ARETE that buys requests to the network.
The design is the companion's [`docs/SERVER.md`](https://github.com/CodeMusic/daemons-companion/blob/main/docs/SERVER.md).

**What runs today**: a Mac host that pairs with a household's hub and joins **THE MESH**:

- **Processing**: ffmpeg jobs only, files in and out, each in a **sandbox** of its own (`sandbox-exec` on a Mac: no
  network, writes only in the job's folder, the home unreadable; `bwrap` on Linux when present).
- **Thinking**: a model already on the computer (Ollama, LM Studio, an MLX server, llama.cpp) is found, timed on one
  short prompt, and lent to the household's talk. The household's words are never kept here.
- **WHEN**: idle and plugged in (default), scheduled hours, or always; in every mode it rests when paused, short of
  memory or disk, hot, or on battery below the owner's floor.
- **ARETE and ASK**: each finished job pays ARETE (once, by its id); ASK puts one short question to the household's
  mind, from ten free asks a day and then ARETE.
- **Builds**: with Docker on an arm64 machine, the Pi devices' program for a hub whose builds come from volunteers --
  one commit, one board, by the companion's own recipe, with no network while it compiles.
- **A menu-bar dot** (`mac/Tray.swift`): green working or ready, amber resting, grey not running; pause and resume.

Memory and THE COMMONS are drawn on the dashboard as *not yet*.

## Run it

Node 22.18 or newer (it runs its TypeScript directly; there are no dependencies), and ffmpeg for processing.

```sh
npm start          # the agent and the dashboard: http://127.0.0.1:4770/
npm test
```

To run it at login with the menu-bar dot (a Mac; a notarised installer comes later):

```sh
bin/daemons-server.sh install      # uninstall | restart | log
```

Pair it from the dashboard's CIRCLES with a code from your hub's ENGINE ROOM. Nothing on the network can reach it: it
dials out to the hub, and the dashboard answers this machine only.

## When it works

| mode | it works when |
|---|---|
| **Idle and plugged in** (default) | you have been away a few minutes and the computer is on power; it stops when you return |
| **Scheduled hours** | inside the hours you pick |
| **Always, under caps** | any time, at the lowest priority |

In every mode it rests when paused, or when memory is short. Its settings and key are kept, readable by you only, in
`~/Library/Application Support/daemons-server/` (Mac), `~/.config/daemons-server/` (Linux) or `%APPDATA%\daemons-server`
(Windows).

## Licence

MIT.
