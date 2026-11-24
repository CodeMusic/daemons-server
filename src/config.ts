// The host's settings and its key, kept where the owner's applications keep theirs, readable by the owner only.
// The key is never shown on the dashboard and never written anywhere else.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cpus, homedir, hostname } from "node:os";
import { join } from "node:path";
import type { Hours, Mode } from "./conditions.ts";

export type Work = { processing: boolean; builds: boolean; thinking: boolean; memory: boolean };
export type Config = {
  name: string;
  hub: string;            // the household's hub, http://<hub>:4730
  key: string;            // the paired key ("" until paired)
  mode: Mode; idleMin: number; hours: Hours; memRestPct: number;
  most: number;           // jobs at once (CPU cap: half the cores, at most)
  work: Work;
  commons: false;         // THE COMMONS: not yet (SERVER.md 5)
};

export const DIR = process.env.DAEMONS_SERVER_DIR ||
  (process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "daemons-server")
   : process.platform === "win32" ? join(process.env.APPDATA ?? homedir(), "daemons-server")
   : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "daemons-server"));
const FILE = join(DIR, "config.json");

export const defaults = (): Config => ({
  name: hostname().replace(/\.local$/, "").slice(0, 40), hub: "http://daemons-hearth:4730", key: "",
  mode: "idle-plugged", idleMin: 5, hours: { from: 1, to: 6 }, memRestPct: 20,
  most: Math.max(1, Math.floor(cpus().length / 4)),
  work: { processing: true, builds: false, thinking: false, memory: false }, commons: false,
});

export function load(): Config {
  if (!existsSync(FILE)) return defaults();
  try { return { ...defaults(), ...JSON.parse(readFileSync(FILE, "utf8")), commons: false }; } catch { return defaults(); }
}
export function save(c: Config) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, FILE);
}

// what the owner may change from the dashboard, checked; anything else is ignored
export function apply(c: Config, p: Record<string, unknown>): Config {
  const n = { ...c, hours: { ...c.hours }, work: { ...c.work } };
  if (p.mode === "idle-plugged" || p.mode === "scheduled" || p.mode === "always") n.mode = p.mode;
  const int = (v: unknown, lo: number, hi: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null; };
  const im = int(p.idleMin, 1, 120); if (im !== null && p.idleMin !== undefined) n.idleMin = im;
  const hf = int(p.from, 0, 23); if (hf !== null && p.from !== undefined) n.hours.from = hf;
  const ht = int(p.to, 0, 23); if (ht !== null && p.to !== undefined) n.hours.to = ht;
  const mm = int(p.most, 1, Math.max(1, Math.floor(cpus().length / 2))); if (mm !== null && p.most !== undefined) n.most = mm;
  if (typeof p.processing === "boolean") n.work.processing = p.processing;   // the only kind built yet
  if (typeof p.name === "string" && p.name.trim()) n.name = p.name.replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 40) || n.name;
  return n;
}
