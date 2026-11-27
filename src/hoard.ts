// THE HOARD's glue (C-575, C-596): this computer's offer of storage, kept in step with its owner's settings.
// The node itself is hoardnode.ts -- the hub's own file, byte for byte, never edited here. This only decides when it
// runs: started while the offer is on, the host is paired and a folder is chosen; started again when its folder, its
// door's port or its key change; and, when its owner switches the offer off, kept as a LEAVING node (it offers
// nothing, its door open) until the hub has had its files moved to other nodes and dropped here. That it is leaving is
// kept in the settings, so an agent started again before its folder is empty takes the leaving up where it was.
// Its kind, its size, its upload and its WHEN are read from the settings at every beat, so a change is heard within
// seconds and nothing restarts for it.
//
// Its WHEN is its own (only on Wi-Fi, only while plugged in): it is NOT the compute's mode, so it goes on serving when
// its owner returns to the keyboard. PAUSE rests it too.
// Every word a person reads is DRAFT.
import { accessSync, constants, readdirSync, realpathSync, statSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { GB, idOf, unmounted, type Config } from "./config.ts";
import { DiskStore, HoardNode, type LinkKind } from "./hoardnode.ts";

export const PAUSED = "paused by its owner";

// ---- where an owner could offer: the home folder, and the drives mounted on this computer ----
export type Place = { path: string; free: number; total: number; what: "home" | "drive" };
const placeAt = (path: string, what: Place["what"]): Place | null => {
  try {
    if (!statSync(path).isDirectory()) return null;
    accessSync(path, constants.W_OK);                     // only where this account can write (not an installer's image)
    const s = statfsSync(path);
    return { path, free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize), what };
  } catch { return null; }
};
const under = (dir: string) => { try { return readdirSync(dir).filter((n) => !n.startsWith(".")).map((n) => join(dir, n)); } catch { return []; } };
/** the Mac read; Linux and Windows written, untried */
export function places(): Place[] {
  const drives = process.platform === "darwin" ? under("/Volumes")
    : process.platform === "win32" ? [..."CDEFGHIJKLMNOPQRSTUVWXYZ"].map((l) => `${l}:\\`)
    : [...under("/media").flatMap(under), ...under("/mnt"), ...under("/run/media").flatMap(under)];
  const out: Place[] = [];
  const home = placeAt(homedir(), "home");
  if (home) out.push(home);
  for (const d of drives) {
    try {
      if (realpathSync(d) === "/") continue;              // a Mac lists its own startup disk among its volumes: the home folder stands for it
      // A folder on the same device as the folder it is in has no drive mounted on it: on Linux a mount point whose
      // drive is away (/mnt/x), where writing would fill the system's own disk; on a Mac a folder left in /Volumes.
      // The Mac tried; Linux written, untried.
      if (process.platform !== "win32" && statSync(d).dev === statSync(dirname(d)).dev) continue;
    } catch { continue; }
    const p = placeAt(d, "drive");
    if (p && !out.some((o) => o.path === p.path)) out.push(p);
  }
  return out;
}

// ---- the node's life ----
/** its folder is there, and (Linux) the drive it is on is mounted */
const there = (dir: string) => { try { return statSync(dir).isDirectory() && !unmounted(dir); } catch { return false; } };
const hubOf = (c: Config) => c.hub.replace(/\/+$/, "");

export type StorageOptions = {
  cfg: () => Config;
  keep?: (leaving: boolean) => void;        // write `hoard.leaving` into the settings, so a leaving outlives the agent
  paused?: () => boolean;                   // PAUSE on the dashboard
  log?: (...a: unknown[]) => void;
  beats?: boolean;                          // false: whoever made it calls node.beat() itself (the tests)
  host?: string;                            // where its door listens (every address; the tests keep to this machine)
  link?: () => LinkKind | null;             // the connection as it was stated, when the reading is wrong (null: read it)
  fetch?: typeof fetch;
};
type Ran = { dir: string; port: number; key: string; hub: string };

export class Storage {
  node: HoardNode | null = null;
  /** why it is not running although it should be ("" while it runs, or while it is off) */
  why = "";
  private o: StorageOptions;
  private ran: Ran | null = null;
  private turn: Promise<void> = Promise.resolve();
  private shelf: { dir: string; store: DiskStore } | null = null;   // the folder while no node runs (it counts itself once a minute)
  constructor(o: StorageOptions) { this.o = o; }
  /** its owner switched the offer off while it held files: it offers nothing, and stays until the hub has moved them */
  get leaving(): boolean { return this.node?.leaving ?? false; }

  /** bring the node in step with the settings (after any change, and now and then: a drive comes back, a port frees,
   *  a leaving node empties). One change at a time, in the order they were asked */
  sync(): Promise<void> { return (this.turn = this.turn.then(() => this.step()).catch((e) => { this.why = (e as Error).message.slice(0, 160); })); }
  /** close its door. The agent is ending: the offer, or the leaving, stands and is taken up when it starts again.
   *  With `final` its owner will not wait for a leaving node's files to move: the hub is told a last time, the
   *  leaving is over, and what is in the folder stays there */
  stop(final = false): Promise<void> {
    return (this.turn = this.turn.then(() => { if (final) { this.keep(false); if (!this.o.cfg().hoard.on) this.why = ""; } return this.shut(final); }).catch(() => {}));
  }

  private keep(leaving: boolean) { if (this.o.cfg().hoard.leaving !== leaving) this.o.keep?.(leaving); }
  /** the folder while no node runs */
  private idle(dir: string): DiskStore { if (this.shelf?.dir !== dir) this.shelf = { dir, store: new DiskStore(dir) }; return this.shelf.store; }
  private async shut(final: boolean) {
    const n = this.node;
    this.node = null; this.ran = null; this.shelf = null;
    if (n) await n.stop(final);
  }
  private async step() {
    let c = this.o.cfg(), h = c.hoard;
    const n = this.node, r = this.ran;
    if (h.on) this.keep(false);                                           // switched on again: no leaving to take up
    if (n && r) {
      if (r.key !== c.key || r.hub !== hubOf(c)) { this.keep(false); await this.shut(true); }   // forgotten, or another household: the one it served is told, and no leaving is owed to the next
      else if (!there(r.dir) || (h.on && (r.dir !== h.dir || r.port !== h.port))) await this.shut(false);   // its drive is gone, or another folder or door: the offer stands
      else if (h.on) { if (n.leaving) { n.stay(); await n.beat(); } }     // changed their mind: the offer stands again, and the hub hears now
      else {
        // Switched off. A node that still holds files LEAVES: the hub hears at once that the offer is taken back, and
        // the node stays -- offering nothing, fetching nothing, its door open -- so its files can be moved to other
        // nodes and then dropped here. One that holds none says so a last time and its door closes.
        if (!n.empty() && !n.leaving) { n.leave(); this.keep(true); await n.beat(); }
        if (n.empty()) { this.keep(false); await this.shut(true); }
      }
    }
    c = this.o.cfg(); h = c.hoard;
    // a leaving kept from before this agent started is taken up, unless its folder is there and holds nothing now
    let drain = !h.on && h.leaving;
    if (drain && !this.node && h.dir && there(h.dir) && !this.idle(h.dir).list().length) { this.keep(false); drain = false; }
    this.why = !h.on && !drain ? "" : !c.key ? "not paired with a household yet" : !h.dir ? "no folder chosen yet"
      : !there(h.dir) ? "its folder is not there: is its drive connected?" : "";
    if (this.node || (!h.on && !drain) || this.why) return;
    const ran: Ran = { dir: h.dir, port: h.port, key: c.key, hub: hubOf(c) };
    const now = () => this.o.cfg();
    const node = new HoardNode({
      hub: () => ran.hub, key: () => ran.key, dir: () => ran.dir, port: ran.port, host: this.o.host,
      id: () => idOf(now()), name: () => now().name,                      // the same node as THE MESH's worker: one machine
      kind: () => now().hoard.kind, bytes: () => Math.floor(now().hoard.gb * GB), up: () => now().hoard.up,
      when: () => ({ wifiOnly: now().hoard.wifiOnly, pluggedOnly: now().hoard.pluggedOnly }),
      rest: () => (this.o.paused?.() ? PAUSED : ""),                       // PAUSE rests storage too, whatever its WHEN
      link: this.o.link, log: this.o.log, fetch: this.o.fetch,
    });
    if (drain) node.leave();
    try { await node.start({ beats: this.o.beats }); }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      this.why = code === "EADDRINUSE" ? `its door's port (${ran.port}) is taken by something else on this computer`
        : code === "EACCES" || code === "EPERM" || code === "EROFS" ? "this account cannot write in its folder"
        : `its door did not open: ${(e as Error).message}`.slice(0, 160);
      return;
    }
    this.node = node; this.ran = ran; this.shelf = null;
    this.o.log?.(drain ? `THE HOARD: still taking its offer of ${ran.dir} back; its door on port ${node.port} until its files have moved`
                       : `THE HOARD: offering ${h.gb} GB of ${ran.dir} (${h.kind}); its door on port ${node.port}`);
  }

  /** what the dashboard shows: whether it runs and why not, whether it is leaving (or would be, were it running), what
   *  its folder holds (running or not), and what the node says of itself */
  state() {
    const h = this.o.cfg().hoard;
    if (this.node) {
      const s = this.node.state();
      return { running: true, leaving: s.leaving, why: this.why, folder: s.folder, files: s.files, used: s.used, room: s.diskFree + s.used, node: s };
    }
    if (!h.dir) return { running: false, leaving: false, why: this.why, folder: "", files: 0, used: 0, room: 0, node: null };
    const store = this.idle(h.dir), list = store.list(), used = list.reduce((a, b) => a + b.size, 0);
    return { running: false, leaving: !h.on && h.leaving, why: this.why, folder: store.root, files: list.length, used, room: store.diskFree() + used, node: null };
  }
  /** one line for the log */
  said(): string {
    return this.node ? `THE HOARD's door at ${this.node.doors().join(", ") || `port ${this.node.port}`}${this.node.leaving ? " (taking its offer back)" : ""}`
                     : `THE HOARD's door closed${this.why ? `: ${this.why}` : ""}`;
  }
}
