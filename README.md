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
- **THE HOARD**: a drive or a folder of this computer offered to the household's own storage, up to a size its owner
  sets, as an EXTEND or a REPLICA, on a WHEN of its own (see *Offering storage* below).
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
dials out to the hub, and the dashboard answers this machine only. The one exception is one you switch on yourself:
while you offer storage, THE HOARD's door listens (below).

## When it works

| mode | it works when |
|---|---|
| **Idle and plugged in** (default) | you have been away a few minutes and the computer is on power; it stops when you return |
| **Scheduled hours** | inside the hours you pick |
| **Always, under caps** | any time, at the lowest priority |

In every mode it rests when paused, or when memory is short. Its settings and key are kept, readable by you only, in
`~/Library/Application Support/daemons-server/` (Mac), `~/.config/daemons-server/` (Linux) or `%APPDATA%\daemons-server`
(Windows).

## Offering storage

**THE HOARD** is the household's own storage, kept on its own computers: the storage twin of THE MESH. On the
dashboard's THE HOARD card you choose a drive or a folder, the most you will share (in GB), and how:

| | what it does |
|---|---|
| **EXTEND** | adds its room to THE HOARD: a 1 TB hoard and a new 1 TB offer make 2 TB |
| **REPLICA** | adds no room: keeps a copy of the files here, in the same house or far away, so they can still be reached while another source is offline |

- **The folder.** THE HOARD keeps to a folder of its own, `daemons-hoard`, inside the one you chose. It never reads,
  counts or removes anything else there, and never keeps more than you offered -- nor more than the drive has room for.
- **The door.** A node hands a file to whoever holds a ticket for it: the file's hash and an hour it ends, signed by
  the hub with a secret only the hub and this node have. The door is on port **4772** (yours to change), on every
  address of the computer, and it is open only while the offer is on. Like the rest of the agent, the node dials out
  to the hub every few seconds; the hub answers with what to fetch, what to let go of and what to hand back. A
  computer's firewall may ask, the first time, whether `node` may accept incoming connections: until it may, no other
  device reaches the door.
- **WHEN.** At any time, only on Wi-Fi (or a cable: never over a phone's data), and/or only while plugged in. This is
  storage's own WHEN, not the one above: a node goes on serving when you return to the keyboard. PAUSE rests it too.
  While it rests it says so to the hub, tells no door, and moves nothing.
- **Taking it back.** Switch the offer off and the hub hears at once. A node that still holds files stays, offering
  nothing and fetching nothing, with its door open, until the hub has moved them to other nodes and had them dropped
  here; then its door closes. That it is leaving is kept with its settings, so a computer started again in the middle
  takes it up where it was. *Close its door now* does not wait: the files stay in the folder, out of reach until the
  offer is on again.
- **The upload speed** of your internet, in megabits a second, helps the hub choose where a far-away reader is sent
  from. Leave it empty if you do not know it.

Whether the computer is on Ethernet or Wi-Fi, and whether it is on power, are read on a Mac and tried there. The
readings for Linux and Windows are written and untried, as is the list of drives to choose from on both. On Linux a
folder where a drive is mounted (`/mnt`, `/media`, `/run/media`) is neither offered nor used while its drive is away,
so nothing meant for the drive lands on the system's own disk; that, too, is written and untried.

## Licence

MIT.
