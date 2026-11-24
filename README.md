# DAEMONS Server

*DRAFT name -- the app may become **DAEMONS Neuron**.*

Makes a computer a **host** of the [DAEMONS companion](https://github.com/CodeMusic/daemons-companion)'s mind: it lends
its cycles to the household's hub on its owner's terms, and (later) is paid in ARETE that buys requests to the network.
The design is the companion's [`docs/SERVER.md`](https://github.com/CodeMusic/daemons-companion/blob/main/docs/SERVER.md).

**What runs today (the proof, C-539)**: a Mac host that pairs with a household's hub, joins **THE MESH** as a
processing node (ffmpeg jobs only, files in and out, nothing else), works only in the mode its owner chose, and shows a
dashboard on `127.0.0.1`. Builds, thinking, memory, THE COMMONS, ARETE and the tray are drawn on the page as *not yet*.

## Run it

Node 22.18 or newer (it runs its TypeScript directly; there are no dependencies), and ffmpeg for processing.

```sh
npm start          # the agent and the dashboard: http://127.0.0.1:4770/
npm test
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
