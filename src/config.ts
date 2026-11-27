// The host's settings and its key, kept where the owner's applications keep theirs, readable by the owner only.
// The key is never shown on the dashboard and never written anywhere else.
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { cpus, homedir, hostname } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { Hours, Mode } from "./conditions.ts";
import { DiskStore, DOOR_PORT, type OfferKind } from "./hoardnode.ts";

export type Work = { processing: boolean; builds: boolean; thinking: boolean; memory: boolean };
// THE HOARD (C-575, C-596): the storage this computer offers the household. It has one switch of its own (`on`) and is
// not a kind of WORK: it keeps its own WHEN, so a node goes on serving when its owner returns to the keyboard.
export type Hoard = {
  on: boolean;
  leaving: boolean;       // switched off while its folder still held files: the node stays, offering nothing, until
                          // they have moved (hoard.ts sets and clears it; kept here so it outlives the agent)
  dir: string;            // the drive or folder offered ("" until chosen); THE HOARD keeps to daemons-hoard/ inside it
  gb: number;             // the most it will share, in GB (a thousand million bytes, as a drive's box counts them)
  kind: OfferKind;        // extend: its room is added to THE HOARD's; replica: adds none, keeps a copy of everything
  port: number;           // its door: the one thing here that listens to the network, and only while the offer is on
  wifiOnly: boolean; pluggedOnly: boolean;   // its WHEN (neither: at any time)
  up: number | null;      // this internet's upload, megabits a second, when its owner knows it
};
export const GB = 1e9;
export type Config = {
  name: string;
  hub: string;            // the household's hub, http://<hub>:4730
  key: string;            // the paired key ("" until paired)
  mode: Mode; idleMin: number; hours: Hours; memRestPct: number;
  batteryFloor: number | null;   // null: never on battery (C-540)
  diskMinGb: number;
  think: { url: string; model: string };   // the local model lent as a thinker ("" until found, C-542)
  most: number;           // jobs at once (CPU cap: half the cores, at most)
  work: Work;
  hoard: Hoard;
  commons: false;         // THE COMMONS: not yet (SERVER.md 5)
};

export const DIR = process.env.DAEMONS_SERVER_DIR ||
  (process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "daemons-server")
   : process.platform === "win32" ? join(process.env.APPDATA ?? homedir(), "daemons-server")
   : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "daemons-server"));
const FILE = join(DIR, "config.json");

const noHoard = (): Hoard => ({ on: false, leaving: false, dir: "", gb: 10, kind: "extend", port: DOOR_PORT, wifiOnly: false, pluggedOnly: false, up: null });
export const defaults = (): Config => ({
  name: hostname().replace(/\.local$/, "").slice(0, 40), hub: "http://daemons-hearth:4730", key: "",
  mode: "idle-plugged", idleMin: 5, hours: { from: 1, to: 6 }, memRestPct: 20, batteryFloor: null, diskMinGb: 5,
  think: { url: "", model: "" },
  most: Math.max(1, Math.floor(cpus().length / 4)),
  work: { processing: true, builds: false, thinking: false, memory: false }, hoard: noHoard(), commons: false,
});
// one machine is one node: THE MESH's worker and THE HOARD's node say the same id
export const idOf = (c: Config) => `server-${c.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}`.slice(0, 40);

/** a kept file as today's settings: one written before THE HOARD has no `hoard`, and is given its defaults */
export function merged(raw: Record<string, unknown>): Config {
  const d = defaults(), h = raw.hoard && typeof raw.hoard === "object" ? raw.hoard : {};
  return { ...d, ...raw, hoard: { ...d.hoard, ...h }, commons: false } as Config;
}
export function load(): Config {
  if (!existsSync(FILE)) return defaults();
  try { return merged(JSON.parse(readFileSync(FILE, "utf8"))); } catch { return defaults(); }
}
export function save(c: Config) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, FILE);
}

/** the most a folder could be asked to hold: what is free on its drive, and what THE HOARD's own folder there already uses */
export function roomAt(dir: string): number { const s = new DiskStore(dir); return s.diskFree() + s.used(); }
/** Linux: a folder under where drives are mounted (/mnt, /media, /run/media) that is on the same device as that place
 *  itself has no drive under it -- a mount point whose drive is away. It is not offered and not used: writing there
 *  would fill the system's own disk. Written, untried (`platform` and `dev` are given so a test can state them). */
export function unmounted(dir: string, platform: string = process.platform, dev: (p: string) => number = (p) => statSync(p).dev): boolean {
  if (platform !== "linux") return false;
  const area = ["/mnt", "/media", "/run/media"].find((a) => dir.startsWith(`${a}/`));
  try { return !!area && dev(dir) === dev(area); } catch { return false; }
}
/** a folder as its owner named it: its whole path when it is there and can be written in, or why not */
function folderSaid(said: string): { dir: string } | { why: string } {
  const s = said.trim().replace(/^~(?=$|[\\/])/, () => homedir());
  if (!s) return { why: "choose a folder first" };
  if (!isAbsolute(s)) return { why: "give the folder's whole path, from the drive down" };
  const dir = resolve(s);
  try { if (!statSync(dir).isDirectory()) return { why: `that is a file, not a folder: ${dir}` }; } catch { return { why: `there is no such folder: ${dir}` }; }
  if (unmounted(dir)) return { why: `no drive is mounted there: ${dir}` };
  try { accessSync(dir, constants.W_OK); } catch { return { why: `this account cannot write in that folder: ${dir}` }; }
  return { dir };
}

// what the owner may change from the dashboard, checked; anything else is ignored. What was refused or changed on the
// way in is said in `problems`, in words the page can show (C-575). `room` is roomAt, given so a test can state it.
export function apply(c: Config, p: Record<string, unknown>, problems: string[] = [], room: (dir: string) => number = roomAt): Config {
  const n = { ...c, hours: { ...c.hours }, work: { ...c.work }, think: { ...c.think }, hoard: { ...noHoard(), ...c.hoard } };
  if (p.mode === "idle-plugged" || p.mode === "scheduled" || p.mode === "always") n.mode = p.mode;
  const int = (v: unknown, lo: number, hi: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null; };
  const im = int(p.idleMin, 1, 120); if (im !== null && p.idleMin !== undefined) n.idleMin = im;
  const hf = int(p.from, 0, 23); if (hf !== null && p.from !== undefined) n.hours.from = hf;
  const ht = int(p.to, 0, 23); if (ht !== null && p.to !== undefined) n.hours.to = ht;
  const mm = int(p.most, 1, Math.max(1, Math.floor(cpus().length / 2))); if (mm !== null && p.most !== undefined) n.most = mm;
  if (typeof p.processing === "boolean") n.work.processing = p.processing;
  if (typeof p.thinking === "boolean") n.work.thinking = p.thinking;
  if (typeof p.builds === "boolean") n.work.builds = p.builds;                // memory: not built yet
  if (p.batteryFloor === "never" || p.batteryFloor === null) n.batteryFloor = null;
  else if (p.batteryFloor !== undefined) { const b = int(p.batteryFloor, 10, 100); if (b !== null) n.batteryFloor = b; }
  const dm = int(p.diskMinGb, 1, 500); if (dm !== null && p.diskMinGb !== undefined) n.diskMinGb = dm;
  if (typeof p.thinkModel === "string") n.think.model = p.thinkModel.replace(/[^A-Za-z0-9._:\/@-]/g, "").slice(0, 120);
  if (typeof p.name === "string" && p.name.trim()) n.name = p.name.replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 40) || n.name;

  // THE HOARD (C-575): the offer, its folder, its size, its kind, its WHEN, its door
  const h = n.hoard;
  const num = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim()) ? Number(v) : NaN);
  if (typeof p.hoardOn === "boolean") { h.on = p.hoardOn; if (h.on) h.leaving = false; }   // on again: no leaving to take up
  if (p.hoardKind === "extend" || p.hoardKind === "replica") h.kind = p.hoardKind;
  if (typeof p.hoardWifiOnly === "boolean") h.wifiOnly = p.hoardWifiOnly;
  if (typeof p.hoardPluggedOnly === "boolean") h.pluggedOnly = p.hoardPluggedOnly;
  if (p.hoardUp === null || p.hoardUp === "") h.up = null;                    // unknown
  else if (p.hoardUp !== undefined) {
    const u = num(p.hoardUp);
    if (Number.isFinite(u)) h.up = Math.max(0.1, Math.min(100_000, u)); else problems.push("the upload speed is a number of megabits a second, or left empty");
  }
  if (p.hoardPort !== undefined) {
    const x = num(p.hoardPort);
    if (Number.isInteger(x) && x >= 1024 && x <= 65535) h.port = x; else problems.push("the door's port is a whole number from 1024 to 65535");
  }
  if (p.hoardGb !== undefined) {
    const g = num(p.hoardGb);
    if (Number.isFinite(g)) h.gb = Math.max(0.001, Math.min(100_000, Math.round(g * 1000) / 1000)); else problems.push("the most to share is a number of GB");
  }
  if (typeof p.hoardDir === "string") {
    const f = folderSaid(p.hoardDir);
    if ("why" in f) problems.push(f.why);
    // as the hub's own offer does: a folder that still holds THE HOARD's files is not left behind while the offer is
    // on, nor while they are on their way out of it
    else if ((h.on || h.leaving) && h.dir && f.dir !== h.dir && new DiskStore(h.dir).list().length)
      problems.push(h.on ? "its folder still holds files of THE HOARD: switch the offer off and let them move, then choose the new folder"
                         : "its folder still holds files of THE HOARD, on their way to other nodes: wait for them, or close its door now, then choose the new folder");
    else h.dir = f.dir;
  }
  // never more than there is: what is free on the folder's drive, and what THE HOARD's own folder there already uses
  // (not measured while its drive is away: that would be the room of whatever drive its path now falls on)
  if (h.dir && existsSync(h.dir) && (p.hoardGb !== undefined || h.dir !== c.hoard?.dir || p.hoardOn === true)) {
    const most = Math.floor(room(h.dir) / (GB / 1000)) / 1000;
    if (h.gb > most) { h.gb = Math.max(0.001, most); problems.push(`there is room for ${most} GB there: the most to share is now ${h.gb} GB`); }
  }
  return n;
}
