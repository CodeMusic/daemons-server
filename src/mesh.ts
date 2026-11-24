// The processing worker: a node of THE MESH (the companion's procmesh.ts, C-360), spoken to over its own routes.
// It dials out to the household's hub with a paired key (nothing here listens to the network), says what it can do,
// how much and how busy it is, takes the jobs it is given, runs only ffmpeg with only the job's own files in a folder
// of its own, sends the outputs back, and removes the folder. Same protocol as mesh_worker_main.ts.
import { execFile, execFileSync } from "node:child_process";
import { wrap } from "./sandbox.ts";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdtempSync, rmSync, statSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type Job = { id: string; kind: string; title: string; args: string[]; inputs: Record<string, string>; outputs: Record<string, string>;
                    system?: string; user?: string; most?: number };
export type Done = { id: string; kind: string; title: string; ok: boolean; ms: number; at: string; error?: string; arete?: number };
export type Thinker = (system: string, user: string, most: number) => Promise<string>;

// procmesh.ts's rule, kept: a job's arguments name files only as @in:<name> and @out:<name>
const SAFE_ARG = (a: string) => !/^[/~]/.test(a) && !a.includes("../") && !a.includes("://") && !/^file:/i.test(a);
export const safeArgs = (args: string[]) => args.every((a) => /^@(in|out):[a-z0-9._-]{1,40}$/i.test(a) || SAFE_ARG(a));
export const argvFor = (args: string[], files: Record<string, string>) =>
  args.map((a) => { const m = /^@(in|out):(.+)$/.exec(a); return m ? files[`${m[1]}:${m[2]}`] ?? a : a; });

export function findFfmpeg(): string | null {
  for (const p of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]) { try { statSync(p); return p; } catch { /* next */ } }
  try { return execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim() || null; } catch { return null; }
}
// the same fixed piece of work THE MESH measures every node by (~1 on the hub's one ARM core)
export function measureSpeed(): number {
  const t = performance.now();
  let h = Buffer.alloc(64);
  for (let i = 0; i < 40_000; i++) h = createHash("sha256").update(h).digest();
  return Math.round((250 / Math.max(1, performance.now() - t)) * 100) / 100;
}

export class MeshWorker {
  holds = 0;
  done: Done[] = [];
  lastHeard = 0;
  lastError = "";
  readonly cores = cpus().length;
  speed = measureSpeed();
  readonly ffmpeg = findFfmpeg();
  private hub: () => string; private key: () => string; private id: () => string; private name: () => string;
  thinker: Thinker | null = null;              // set while THINKING is on and a local model answers (C-542)
  processing = true;                           // PROCESSING's switch
  onDone: (d: Done) => void = () => {};
  constructor(hub: () => string, key: () => string, id: () => string, name: () => string) {
    this.hub = hub; this.key = key; this.id = id; this.name = name;
  }
  caps(): string[] { return [...(this.processing && this.ffmpeg ? ["ffmpeg"] : []), ...(this.thinker ? ["think"] : [])]; }

  private auth() { return { authorization: `Bearer ${this.key()}` }; }
  private async post(path: string, body: unknown): Promise<any> {
    const r = await fetch(this.hub() + path, { method: "POST", headers: { ...this.auth(), "content-type": "application/json" },
                                               body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    if (r.status === 401 || r.status === 403) throw new Error(`the hub refused this host's key (${r.status}): pair it again`);
    if (!r.ok) throw new Error(`the hub answered ${r.status}`);
    return r.json();
  }

  // one ask for work; the hub counts the ask itself as the node being here (fresh)
  // (asked only while it holds fewer than its most: the hub gives whatever it answers with)
  async ask(load: number): Promise<Job | null> {
    const r = await this.post("/api/mesh/take", { id: this.id(), name: this.name(), caps: this.caps(), cores: this.cores, speed: this.speed,
                                                 load, holds: this.holds });
    this.lastHeard = Date.now(); this.lastError = "";
    return r.job ?? null;
  }

  async work(job: Job) {
    const t0 = Date.now(), dir = mkdtempSync(join(tmpdir(), "daemons-server-"));
    this.holds++;
    const end = (ok: boolean, error?: string) => {
      const d: Done = { id: job.id, kind: job.kind, title: job.title, ok, ms: Date.now() - t0, at: new Date().toISOString(), error };
      this.onDone(d); this.done.unshift(d);
    };
    try {
      if (job.kind === "think") {                // a thought: the household's words in, the answer out, nothing kept
        if (!this.thinker) throw new Error("refused: this host is not thinking now");
        const text = await this.thinker(String(job.system ?? ""), String(job.user ?? ""), Number(job.most) || 256);
        await this.post("/api/mesh/done", { id: job.id, node: this.id(), ok: true, text, ms: Date.now() - t0 });
        end(true);
        return;
      }
      if (job.kind !== "ffmpeg" || !this.processing || !safeArgs(job.args) || !this.ffmpeg) throw new Error("refused: not a job this host runs");
      const files: Record<string, string> = {};
      for (const name of Object.keys(job.inputs)) {
        const to = join(dir, `in-${name.replace(/[^A-Za-z0-9._-]/g, "_")}`);
        const r = await fetch(`${this.hub()}/api/mesh/in/${job.id}/${encodeURIComponent(name)}`, { headers: this.auth(), signal: AbortSignal.timeout(600_000) });
        if (!r.ok || !r.body) throw new Error(`its input ${name} did not come (${r.status})`);
        await pipeline(Readable.fromWeb(r.body as any), createWriteStream(to));
        files[`in:${name}`] = to;
      }
      for (const name of Object.keys(job.outputs)) files[`out:${name}`] = join(dir, `out-${name.replace(/[^A-Za-z0-9._-]/g, "_")}`);
      const w = wrap(this.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...argvFor(job.args, files)], dir);   // C-546
      await new Promise<void>((ok, fail) => execFile(w.cmd, w.args, { timeout: 3_600_000, cwd: dir },
        (e, _o, err) => (e ? fail(new Error(String(err || e.message).slice(-200))) : ok())));
      for (const name of Object.keys(job.outputs)) {
        const f = files[`out:${name}`];
        const r = await fetch(`${this.hub()}/api/mesh/out/${job.id}/${encodeURIComponent(name)}?node=${this.id()}`, {
          method: "PUT", headers: { ...this.auth(), "content-type": "application/octet-stream", "content-length": String(statSync(f).size) },
          body: Readable.toWeb(createReadStream(f)) as any, duplex: "half", signal: AbortSignal.timeout(600_000) } as RequestInit);
        if (!r.ok) throw new Error(`the hub did not take its output ${name} (${r.status})`);
      }
      await this.post("/api/mesh/done", { id: job.id, node: this.id(), ok: true, ms: Date.now() - t0 });
      end(true);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 200);
      await this.post("/api/mesh/done", { id: job.id, node: this.id(), ok: false, error: msg }).catch(() => {});
      end(false, msg);
    } finally {
      this.holds--; this.done = this.done.slice(0, 50);
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// pairing, as hub/mesh.sh does: a code from THE ENGINE ROOM (or the hub's own machine) for a key, kept in config only
export async function pair(hub: string, code: string, name: string): Promise<string> {
  const r = await fetch(`${hub.replace(/\/+$/, "")}/api/pair`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.trim(), name: `DAEMONS Server (${name})` }), signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || typeof j.token !== "string") throw new Error(j.error || `the hub did not pair (${r.status})`);
  return j.token;
}
