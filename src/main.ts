// DAEMONS Server (DRAFT name): the agent. One process -- the WHEN loop, the workers (processing, thinking), ARETE's
// ledger, THE HOARD's node and the dashboard on 127.0.0.1 only. SERVER.md in the companion is the design.
// One thing here listens beyond this machine, and only while its owner offers storage: THE HOARD's door (C-575).
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { decide, load as loadAvg, read, type Verdict } from "./conditions.ts";
import { apply, idOf, load, save, DIR, type Config } from "./config.ts";
import { Storage, places, type Place } from "./hoard.ts";
import { FOLDER } from "./hoardnode.ts";
import { MeshWorker, pair } from "./mesh.ts";
import { sandboxKind } from "./sandbox.ts";
import { findModels, measure, think, type Found } from "./think.ts";
import { Ledger, RATES, payForProcessing } from "./arete.ts";
import { canBuild, defaultLimits } from "./build.ts";

const PORT = Number(process.env.DAEMONS_SERVER_PORT) || 4770;
let cfg: Config = load();
let pausedUntil = 0;
let verdict: Verdict = { work: false, why: "starting" };
const say = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const worker = new MeshWorker(() => cfg.hub.replace(/\/+$/, ""), () => cfg.key, () => idOf(cfg), () => cfg.name);
const ledger = new Ledger(DIR);
const power = () => Math.round(worker.cores * worker.speed * 10) / 10;
const SANDBOX = sandboxKind();

// ARETE for each job finished (paid once by its id)
worker.onDone = (d) => {
  if (!d.ok) return;
  const amount = d.kind === "think" ? RATES.thought : d.kind === "build" ? RATES.build : payForProcessing(d.ms, power());
  const what = d.kind === "think" ? "a thought" : d.kind === "build" ? "a build" : "processing";
  if (ledger.award(`mesh:${d.id}`, amount, `${what}: ${d.title}`)) d.arete = amount;
};

// ---- THINKING: the local model, found and measured (C-542) ----
let models: Found[] = [];
let thinkCheck: { model: string; ok: boolean; ms: number; error?: string; at: number } | null = null;
async function lookForModels() {
  models = await findModels();
  if (!cfg.think.model || !models.some((f) => f.models.includes(cfg.think.model))) {
    const first = models[0];
    cfg = { ...cfg, think: first ? { url: first.url, model: first.models[0] } : { url: "", model: "" } };
  } else cfg = { ...cfg, think: { url: models.find((f) => f.models.includes(cfg.think.model))!.url, model: cfg.think.model } };
  if (cfg.work.thinking && cfg.think.model && thinkCheck?.model !== cfg.think.model) {
    const m = await measure(cfg.think.url, cfg.think.model);
    thinkCheck = { model: cfg.think.model, ...m, at: Date.now() };
    say(`thinking: ${cfg.think.model} ${m.ok ? `answers in ${m.ms} ms` : `not offered (${m.error ?? `${m.ms} ms`})`}`);
  }
  const lend = cfg.work.thinking && !!cfg.think.model && thinkCheck?.model === cfg.think.model && thinkCheck.ok;
  worker.thinker = lend ? (system, user, most) => think(cfg.think.url, cfg.think.model, system, user, most) : null;
}
setInterval(() => void lookForModels(), 60_000);
void lookForModels();

// ---- BUILDS: a container runtime that answers, while the switch is on (C-541) ----
let buildCheck = { ok: false, why: "" };
async function lookForBuilder() {
  buildCheck = await canBuild();
  worker.builds = cfg.work.builds && buildCheck.ok ? { ...defaultLimits(), cpus: Math.max(1, Math.min(defaultLimits().cpus, cfg.most * 2)) } : null;
}
setInterval(() => void lookForBuilder(), 60_000);
void lookForBuilder();

// ---- the WHEN loop: decide, and ask THE MESH for work only while allowed ----
async function tick() {
  worker.processing = cfg.work.processing;
  const r = read(Date.now() < pausedUntil);
  verdict = decide(cfg, r);
  if (!cfg.key) verdict = { work: false, why: "not paired with a household yet" };
  else if (!worker.caps().length) verdict = { work: false, why: "no kind of work is switched on" };
  if (!verdict.work || worker.holds >= cfg.most) return;
  try {
    const job = await worker.ask(loadAvg());
    if (job) { say(`took ${job.kind}: ${job.title}`); void worker.work(job).then(() => say(`${worker.done[0]?.ok ? "done" : "failed"} ${job.title}`)); }
  } catch (e) { worker.lastError = (e as Error).message; }
}
setInterval(() => void tick(), 2000);
void tick();

// ---- THE HOARD: the storage this computer offers, on a WHEN of its own; PAUSE rests it too (C-575) ----
const storage = new Storage({ cfg: () => cfg, paused: () => Date.now() < pausedUntil, log: say,
  keep: (leaving) => { cfg = { ...cfg, hoard: { ...cfg.hoard, leaving } }; save(cfg); } });   // a leaving outlives the agent
setInterval(() => void storage.sync(), 15_000);            // a drive comes back, a port frees, a leaving node empties
// a change is not waited on for long: taking an offer back waits on the hub, and the page wants its answer
const soon = (p: Promise<unknown>, ms = 2000) => Promise.race([p, new Promise((ok) => setTimeout(ok, ms))]);
let offerable: { at: number; v: Place[] } = { at: 0, v: [] };
const placesNow = () => (Date.now() - offerable.at > 10_000 ? (offerable = { at: Date.now(), v: places() }).v : offerable.v);

// ---- ASK: one prompt to the household, the day's allowance first, then ARETE (C-544) ----
async function ask(text: string) {
  if (!cfg.key) throw new Error("pair with a household first");
  const said = text.trim().slice(0, 200);
  if (!said) throw new Error("ask something");
  if (!ledger.canAsk()) throw new Error(`no ARETE left: lend this computer for a while, or wait for tomorrow's ${RATES.allowancePerDay}`);
  const r = await fetch(`${cfg.hub.replace(/\/+$/, "")}/api/ai/try`, { method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" }, body: JSON.stringify({ text: said }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.answer) throw new Error(j.error || `the household did not answer (${r.status})`);
  const spent = ledger.spendAsk();
  return { said, answer: String(j.answer), by: j.provider ?? null, ms: j.ms ?? null, spent: spent ? -spent.amount : 0 };
}

// ---- the dashboard ----
const PAGE = new URL("../public/index.html", import.meta.url);
function state() {
  const r = read(Date.now() < pausedUntil);
  return {
    name: cfg.name, id: idOf(cfg), hub: cfg.hub, paired: !!cfg.key, verdict, readings: r, caps: worker.caps(),
    mode: cfg.mode, idleMin: cfg.idleMin, hours: cfg.hours, most: cfg.most, maxMost: Math.max(1, Math.floor(cpus().length / 2)),
    batteryFloor: cfg.batteryFloor, diskMinGb: cfg.diskMinGb, memRestPct: cfg.memRestPct,
    work: cfg.work, commons: cfg.commons, pausedUntil, sandbox: SANDBOX,
    build: { ...buildCheck, lending: !!worker.builds, now: worker.building },
    think: { ...cfg.think, found: models.map((f) => ({ server: f.server, models: f.models })), check: thinkCheck, lending: !!worker.thinker },
    machine: { cores: worker.cores, speed: worker.speed, power: power(), memGb: Math.round(totalmem() / 2 ** 30), ffmpeg: !!worker.ffmpeg, platform: process.platform },
    mesh: { holds: worker.holds, lastHeard: worker.lastHeard, lastError: worker.lastError },
    hoard: { ...cfg.hoard, ...storage.state(), places: placesNow(), keepsTo: FOLDER },
    arete: { balance: ledger.balance(), earned: ledger.earned(), allowanceLeft: ledger.allowanceLeft(), allowance: RATES.allowancePerDay,
             recent: ledger.entries.slice(-8).reverse() },
    done: worker.done, dir: DIR,
  };
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
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
    if (req.method === "POST" && path === "/api/settings") {
      const was = cfg, problems: string[] = [];
      cfg = apply(cfg, await body(req), problems); save(cfg);
      if (was.work.thinking !== cfg.work.thinking || was.think.model !== cfg.think.model) await lookForModels();
      if (was.work.builds !== cfg.work.builds) await lookForBuilder();
      await soon(storage.sync());
      return send(200, { ...state(), problems });          // what was refused or changed on the way in, for the page to say
    }
    if (req.method === "POST" && path === "/api/pause") {
      const b = await body(req), mins = Number(b.minutes);
      pausedUntil = mins > 0 ? Date.now() + mins * 60_000 : 0;
      void tick(); void storage.node?.beat();              // the hub hears the rest, or its end, now
      return send(200, state());
    }
    // a leaving node's owner will not wait for its files to move: its door closes now, the leaving is over, and they stay in its folder
    if (req.method === "POST" && path === "/api/hoard/close") { if (!cfg.hoard.on) await soon(storage.stop(true)); return send(200, state()); }
    if (req.method === "POST" && path === "/api/ask") return send(200, await ask(String((await body(req)).text ?? "")));
    if (req.method === "POST" && path === "/api/pair") {
      const b = await body(req);
      const hub = typeof b.hub === "string" && /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(b.hub) ? b.hub : cfg.hub;
      const key = await pair(hub, String(b.code ?? ""), cfg.name);
      cfg = { ...cfg, hub, key }; save(cfg); say(`paired with ${hub}`);
      await soon(storage.sync());
      return send(200, state());
    }
    if (req.method === "POST" && path === "/api/forget") { cfg = { ...cfg, key: "" }; save(cfg); await soon(storage.sync()); return send(200, state()); }
    send(404, { error: "no such page" });
  } catch (e) { send(400, { error: (e as Error).message }); }
});
await storage.sync();
server.listen(PORT, "127.0.0.1", () => say(`DAEMONS Server: ${cfg.name}, the dashboard at http://127.0.0.1:${PORT}/ (settings in ${DIR}; jobs in ${SANDBOX}; ${storage.said()})`));
// ending: THE HOARD's door is closed and its offer stands (the hub waits for this node to return)
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { void soon(storage.stop(), 3000).then(() => process.exit(0)); });
