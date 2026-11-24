// DAEMONS Server (DRAFT name): the agent. One process -- the WHEN loop, the processing worker and the dashboard on
// 127.0.0.1 only. SERVER.md in the companion is the design; this is its proof (C-539).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { decide, load as loadAvg, read, type Verdict } from "./conditions.ts";
import { apply, load, save, DIR, type Config } from "./config.ts";
import { MeshWorker, pair } from "./mesh.ts";

const PORT = Number(process.env.DAEMONS_SERVER_PORT) || 4770;
let cfg: Config = load();
let pausedUntil = 0;
let verdict: Verdict = { work: false, why: "starting" };
const say = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const idOf = (c: Config) => `server-${c.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}`.slice(0, 40);
const worker = new MeshWorker(() => cfg.hub.replace(/\/+$/, ""), () => cfg.key, () => idOf(cfg), () => cfg.name);

// ---- the WHEN loop: decide, and ask THE MESH for work only while allowed ----
async function tick() {
  const r = read(Date.now() < pausedUntil);
  verdict = decide(cfg, r);
  if (!cfg.key) verdict = { work: false, why: "not paired with a household yet" };
  else if (!cfg.work.processing) verdict = { work: false, why: "no kind of work is switched on" };
  if (!verdict.work || worker.holds >= cfg.most) return;
  try {
    const job = await worker.ask(loadAvg());
    if (job) { say(`took ${job.title}`); void worker.work(job).then(() => say(`${worker.done[0]?.ok ? "done" : "failed"} ${job.title}`)); }
  } catch (e) { worker.lastError = (e as Error).message; }
}
setInterval(() => void tick(), 2000);
void tick();

// ---- the dashboard ----
const PAGE = new URL("../public/index.html", import.meta.url);
function state() {
  const r = read(Date.now() < pausedUntil);
  return {
    name: cfg.name, id: idOf(cfg), hub: cfg.hub, paired: !!cfg.key, verdict, readings: r,
    mode: cfg.mode, idleMin: cfg.idleMin, hours: cfg.hours, most: cfg.most, maxMost: Math.max(1, Math.floor(cpus().length / 2)),
    work: cfg.work, commons: cfg.commons, pausedUntil,
    machine: { cores: worker.cores, speed: worker.speed, power: Math.round(worker.cores * worker.speed * 10) / 10,
               memGb: Math.round(totalmem() / 2 ** 30), ffmpeg: !!worker.ffmpeg, platform: process.platform },
    mesh: { holds: worker.holds, lastHeard: worker.lastHeard, lastError: worker.lastError },
    done: worker.done, dir: DIR,
  };
}
async function body(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let s = ""; for await (const c of req) { s += c; if (s.length > 8192) throw new Error("too long"); }
  return s ? JSON.parse(s) : {};
}
const server = createServer(async (req, res) => {
  const send = (code: number, v: unknown, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(v) : v);
  };
  // only this machine, and only pages it served itself (no other site may drive it)
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(403, { error: "this machine only" });
  if (req.method === "POST" && req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin))
    return send(403, { error: "this machine only" });
  try {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/") return send(200, readFileSync(PAGE, "utf8"), "text/html; charset=utf-8");
    if (req.method === "GET" && path === "/api/state") return send(200, state());
    if (req.method === "POST" && path === "/api/settings") { cfg = apply(cfg, await body(req)); save(cfg); return send(200, state()); }
    if (req.method === "POST" && path === "/api/pause") {
      const b = await body(req), mins = Number(b.minutes);
      pausedUntil = mins > 0 ? Date.now() + mins * 60_000 : 0;
      void tick(); return send(200, state());
    }
    if (req.method === "POST" && path === "/api/pair") {
      const b = await body(req);
      const hub = typeof b.hub === "string" && /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(b.hub) ? b.hub : cfg.hub;
      const key = await pair(hub, String(b.code ?? ""), cfg.name);
      cfg = { ...cfg, hub, key }; save(cfg); say(`paired with ${hub}`);
      return send(200, state());
    }
    if (req.method === "POST" && path === "/api/forget") { cfg = { ...cfg, key: "" }; save(cfg); return send(200, state()); }
    send(404, { error: "no such page" });
  } catch (e) { send(400, { error: (e as Error).message }); }
});
server.listen(PORT, "127.0.0.1", () => say(`DAEMONS Server: ${cfg.name}, the dashboard at http://127.0.0.1:${PORT}/ (settings in ${DIR})`));
