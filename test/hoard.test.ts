// THE HOARD (C-575): the settings the dashboard may change, the places an owner could offer, and the glue that keeps
// the node in step with them -- against a hub made here, on this machine only, in folders made for the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { apply, defaults, idOf, merged, unmounted, GB, type Config } from "../src/config.ts";
import { PAUSED, Storage, places } from "../src/hoard.ts";
import { DOOR_PORT, FOLDER, doorPath, type Beat, type BeatReply, type HoardNode, type LinkKind } from "../src/hoardnode.ts";

const tmp = (what: string) => mkdtempSync(join(tmpdir(), `hoard-${what}-`));
const shaOf = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** a blob laid in a folder's daemons-hoard/ as the node would keep it */
const lay = (dir: string, bytes: Buffer) => {
  const sha = shaOf(bytes);
  mkdirSync(join(dir, FOLDER, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(dir, FOLDER, sha.slice(0, 2), sha), bytes);
  return sha;
};

test("settings kept before THE HOARD are given its defaults", () => {
  const old = { name: "old host", hub: "http://hub:4730", key: "k", mode: "always", work: { processing: true, builds: false, thinking: false, memory: false } };
  const c = merged(old);
  assert.deepEqual(c.hoard, { on: false, leaving: false, dir: "", gb: 10, kind: "extend", port: DOOR_PORT, wifiOnly: false, pluggedOnly: false, up: null });
  assert.equal(c.mode, "always");
  assert.equal(merged({ hoard: { on: true, gb: 3 } }).hoard.kind, "extend");          // a part of it kept: the rest filled in
  assert.equal(merged({ hoard: { on: true, gb: 3 } }).hoard.gb, 3);
  // and a Config in hand that has none (an agent that was running across the change) takes a setting all the same
  const bare = { ...defaults() } as Partial<Config>;
  delete bare.hoard;
  const n = apply(bare as Config, { hoardKind: "replica" });
  assert.equal(n.hoard.kind, "replica");
  assert.equal(n.hoard.on, false);
  assert.equal(n.hoard.port, DOOR_PORT);
});

test("THE HOARD's settings from the dashboard are checked, each one", () => {
  const dir = tmp("cfg"), room = () => 500 * GB;
  try {
    const set = (p: Record<string, unknown>, from: Config = defaults()) => { const problems: string[] = []; return { c: apply(from, p, problems, room), problems }; };
    // the switch
    assert.equal(set({ hoardOn: true }).c.hoard.on, true);
    assert.equal(set({ hoardOn: "yes" }).c.hoard.on, false);
    // a leaving is the glue's to set, never the page's; switching the offer on again ends it
    const leaving = { ...defaults(), hoard: { ...defaults().hoard, leaving: true } };
    assert.equal(set({ hoardLeaving: false, leaving: false, mode: "always" }, leaving).c.hoard.leaving, true);
    assert.equal(set({ hoardOn: false }, leaving).c.hoard.leaving, true);
    assert.equal(set({ hoardOn: true }, leaving).c.hoard.leaving, false);
    // the folder: its whole path, there, and a folder
    assert.equal(set({ hoardDir: dir }).c.hoard.dir, dir);
    assert.equal(set({ hoardDir: `${dir}/` }).c.hoard.dir, dir);
    assert.equal(set({ hoardDir: "~" }).c.hoard.dir, homedir());
    const gone = set({ hoardDir: join(dir, "nowhere") });
    assert.equal(gone.c.hoard.dir, "");
    assert.match(gone.problems[0], /no such folder/);
    writeFileSync(join(dir, "a-file"), "x");
    assert.match(set({ hoardDir: join(dir, "a-file") }).problems[0], /a file, not a folder/);
    assert.match(set({ hoardDir: "some/folder" }).problems[0], /whole path/);
    assert.match(set({ hoardDir: "  " }).problems[0], /choose a folder/);
    assert.equal(set({ hoardDir: 7 }).c.hoard.dir, "");
    // the most to share: 0.001 to 100000 GB
    assert.equal(set({ hoardGb: 250 }).c.hoard.gb, 250);
    assert.equal(set({ hoardGb: "2.5" }).c.hoard.gb, 2.5);
    assert.equal(set({ hoardGb: 0 }).c.hoard.gb, 0.001);
    assert.equal(set({ hoardGb: 9e9 }).c.hoard.gb, 100_000);
    const word = set({ hoardGb: "plenty" });
    assert.equal(word.c.hoard.gb, 10);
    assert.match(word.problems[0], /number of GB/);
    // its kind
    assert.equal(set({ hoardKind: "replica" }).c.hoard.kind, "replica");
    assert.equal(set({ hoardKind: "extend" }, set({ hoardKind: "replica" }).c).c.hoard.kind, "extend");
    assert.equal(set({ hoardKind: "mirror" }).c.hoard.kind, "extend");
    // its WHEN
    assert.equal(set({ hoardWifiOnly: true }).c.hoard.wifiOnly, true);
    assert.equal(set({ hoardWifiOnly: 1 }).c.hoard.wifiOnly, false);
    assert.equal(set({ hoardPluggedOnly: true }).c.hoard.pluggedOnly, true);
    assert.equal(set({ hoardPluggedOnly: "true" }).c.hoard.pluggedOnly, false);
    // its internet's upload: 0.1 to 100000, or unknown
    const up = set({ hoardUp: 20 }).c;
    assert.equal(up.hoard.up, 20);
    assert.equal(set({ hoardUp: "" }, up).c.hoard.up, null);
    assert.equal(set({ hoardUp: null }, up).c.hoard.up, null);
    assert.equal(set({ hoardUp: 0.01 }).c.hoard.up, 0.1);
    assert.equal(set({ hoardUp: 1e9 }).c.hoard.up, 100_000);
    const fast = set({ hoardUp: "fast" }, up);
    assert.equal(fast.c.hoard.up, 20);
    assert.match(fast.problems[0], /megabits/);
    // its door's port: 1024 to 65535, whole
    assert.equal(set({ hoardPort: 5000 }).c.hoard.port, 5000);
    for (const bad of [80, 70_000, 4772.5, "door", null]) {
      const r = set({ hoardPort: bad });
      assert.equal(r.c.hoard.port, DOOR_PORT);
      assert.match(r.problems[0], /1024 to 65535/);
    }
    // what was not asked is not touched, and nothing was said
    const quiet = set({ mode: "always" });
    assert.deepEqual(quiet.c.hoard, defaults().hoard);
    assert.deepEqual(quiet.problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("never more offered than there is room for; a folder that holds files is not left behind", () => {
  const a = tmp("a"), b = tmp("b");
  try {
    // 2 GB of room where the folder is: 500 asked becomes 2, and it is said
    const problems: string[] = [];
    const c = apply(defaults(), { hoardDir: a, hoardGb: 500 }, problems, () => 2 * GB);
    assert.equal(c.hoard.gb, 2);
    assert.match(problems[0], /room for 2 GB/);
    // within the room: kept as asked, nothing said
    const fine: string[] = [];
    assert.equal(apply(c, { hoardGb: 1.5 }, fine, () => 2 * GB).hoard.gb, 1.5);
    assert.deepEqual(fine, []);
    // the drive filled since: switching the offer on brings it down too
    const later: string[] = [];
    assert.equal(apply(c, { hoardOn: true }, later, () => 0.5 * GB).hoard.gb, 0.5);
    assert.equal(later.length, 1);
    // the room is what is free and what THE HOARD's own folder there already uses (read from the disk when not given)
    lay(a, Buffer.alloc(4096, 7));
    const real = apply(defaults(), { hoardDir: a, hoardGb: 100_000 }, []);
    assert.ok(real.hoard.gb < 100_000 && real.hoard.gb > 0);
    // while the offer is on, its folder is not changed for another while it still holds THE HOARD's files
    const on = apply(c, { hoardOn: true }, [], () => 2 * GB), held: string[] = [];
    assert.equal(apply(on, { hoardDir: b }, held, () => 2 * GB).hoard.dir, a);
    assert.match(held[0], /still holds files/);
    assert.equal(apply({ ...on, hoard: { ...on.hoard, on: false } }, { hoardDir: b }, [], () => 2 * GB).hoard.dir, b);
    // nor while those files are on their way out of it
    const out: string[] = [];
    assert.equal(apply({ ...on, hoard: { ...on.hoard, on: false, leaving: true } }, { hoardDir: b }, out, () => 2 * GB).hoard.dir, a);
    assert.match(out[0], /on their way to other nodes/);
  } finally { for (const d of [a, b]) rmSync(d, { recursive: true, force: true }); }
});

test("the places an owner could offer: the home folder, with its room", () => {
  const all = places(), home = all.find((p) => p.path === homedir());
  assert.ok(home, "the home folder is among them");
  assert.equal(home.what, "home");
  for (const p of all) {
    assert.equal(typeof p.free, "number");
    assert.equal(typeof p.total, "number");
    assert.ok(Number.isFinite(p.free) && p.free >= 0 && p.total >= p.free, p.path);
  }
});

test("Linux: a mount point whose drive is away is not a place to keep files (written, untried there)", () => {
  // the devices are stated here: /mnt and whatever is under it with no drive mounted are one device, a mounted drive another
  const away = (p: string) => (p.startsWith("/mnt/attic") ? 1 : p === "/mnt" ? 1 : 9);
  const mounted = (p: string) => (p.startsWith("/mnt/attic") ? 2 : p === "/mnt" ? 1 : 9);
  assert.equal(unmounted("/mnt/attic", "linux", away), true);
  assert.equal(unmounted("/mnt/attic/films", "linux", away), true);
  assert.equal(unmounted("/mnt/attic", "linux", mounted), false);
  assert.equal(unmounted("/mnt/attic/films", "linux", mounted), false);
  assert.equal(unmounted("/media/someone/attic", "linux", () => 1), true);
  assert.equal(unmounted("/run/media/someone/attic", "linux", (p) => (p === "/run/media" ? 1 : 2)), false);
  assert.equal(unmounted("/home/someone/hoard", "linux", () => 1), false);          // not where drives are mounted: any folder will do
  assert.equal(unmounted("/mnt/gone", "linux", () => { throw new Error("no such folder"); }), false);
  assert.equal(unmounted("/mnt/attic", "darwin", away), false);                      // asked only on Linux
});

// ---- a hub made here: it hears beats, hands out its blobs, and answers a leaving node as the hub does ----
type FakeHub = { url: string; beats: Beat[]; heads: Record<string, string | undefined>[]; next: BeatReply[]; elsewhere: boolean; close: () => void };
async function fakeHub(blobs: Map<string, Buffer>): Promise<FakeHub> {
  const hub: FakeHub = { url: "", beats: [], heads: [], next: [], elsewhere: false, close: () => {} };
  const s: Server = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    const blob = /^\/api\/hoard\/blob\/([0-9a-f]{64})$/.exec(req.url ?? "");
    if (req.method === "POST" && req.url === "/api/hoard/beat") {
      const beat = JSON.parse(b) as Beat;
      hub.beats.push(beat); hub.heads.push({ authorization: req.headers.authorization, node: String(req.headers["x-hoard-node"]) });
      res.writeHead(200, { "content-type": "application/json" });
      // a node that has taken its offer back is told to let go of a blob once another node holds it (`elsewhere`)
      const reply = hub.next.shift() ?? (beat.offer === null && hub.elsewhere ? { secret: "s3cret", drop: [...blobs.keys()] } : { secret: "s3cret" });
      return res.end(JSON.stringify(reply));
    }
    if (req.method === "GET" && blob && blobs.has(blob[1])) { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(blobs.get(blob[1])); }
    res.writeHead(404); res.end("{}");
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  hub.url = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  hub.close = () => { s.close(); s.closeAllConnections(); };
  return hub;
}
/** the node it runs now (read here, so one assertion about it does not narrow the next) */
const nodeOf = (s: Storage): HoardNode | null => s.node;
const must = (s: Storage): HoardNode => { assert.ok(s.node, s.why || "it is not running"); return s.node; };
/** what a door answers (its answer read to the end, so nothing is left holding the door open) */
const knock = async (url: string) => { const r = await fetch(url); await r.arrayBuffer(); return r.status; };
const hostOf = (hub: string, dir: string, over: Partial<Config["hoard"]> = {}): Config =>
  ({ ...defaults(), name: "Test Host", hub: `${hub}/`, key: "k-test",
     hoard: { on: true, leaving: false, dir, gb: 1, kind: "extend", port: 0, wifiOnly: false, pluggedOnly: false, up: 12, ...over } });
/** a host as main.ts keeps one: its settings in hand, and `leaving` written into them when the glue says */
function host(first: Config) {
  const h = {
    cfg: first, paused: false, link: "ethernet" as LinkKind,
    set: (over: Partial<Config["hoard"]>) => { h.cfg = { ...h.cfg, hoard: { ...h.cfg.hoard, ...over } }; },
    storage: () => new Storage({ cfg: () => h.cfg, keep: (leaving) => h.set({ leaving }), paused: () => h.paused, beats: false, host: "127.0.0.1", link: () => h.link }),
  };
  return h;
}

test("the offer, end to end: a blob fetched and kept, the door and its tickets, the WHEN, PAUSE, and the offer taken back", async () => {
  const dir = tmp("node"), bytes = Buffer.from("a small file of the household's, kept whole\n".repeat(200)), sha = shaOf(bytes);
  const hub = await fakeHub(new Map([[sha, bytes]]));
  const h = host(hostOf(hub.url, dir)), storage = h.storage();
  const last = () => hub.beats[hub.beats.length - 1];
  try {
    await storage.sync();
    const node = must(storage);
    assert.equal(storage.state().running, true);
    assert.equal(storage.why, "");

    // the first beat: what it offers; the hub wants a blob kept here, and it is fetched into THE HOARD's own folder
    hub.next.push({ secret: "s3cret", want: [{ sha, size: bytes.length }], list: false });
    await node.beat();
    assert.equal(hub.beats.length, 1);
    assert.equal(last().id, idOf(h.cfg));                                   // the same node as THE MESH's worker
    assert.equal(last().id, "server-test-host");
    assert.equal(last().name, "Test Host");
    assert.deepEqual(last().offer, { kind: "extend", bytes: 1 * GB });
    assert.equal(last().up, 12);
    assert.equal(last().link, "ethernet");
    assert.equal(last().rests, "");
    assert.deepEqual(last().have, []);
    for (const d of last().doors) assert.match(d, new RegExp(`^http://[0-9.]+:${node.port}$`));
    assert.deepEqual(hub.heads[0], { authorization: "Bearer k-test", node: "server-test-host" });
    const kept = join(dir, FOLDER, sha.slice(0, 2), sha);
    assert.ok(existsSync(kept), "the blob is kept under daemons-hoard/<first two>/<sha>");
    assert.deepEqual(readFileSync(kept), bytes);
    assert.equal(node.lastError, "");

    // the next beat says it has it
    await node.beat();
    assert.deepEqual(last().got, [sha]);
    assert.equal(last().used, bytes.length);

    // the door: a ticket the hub signed opens it; one that was changed does not
    const door = `http://127.0.0.1:${node.port}`, path = doorPath("s3cret", sha, Date.now());
    const ok = await fetch(door + path);
    assert.equal(ok.status, 200);
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), bytes);
    const t = new URL(door + path).searchParams.get("t")!;
    assert.equal(await knock(door + path.replace(`t=${t}`, `t=${t.slice(0, -1)}${t.endsWith("0") ? "1" : "0"}`)), 403);
    assert.equal(await knock(door + doorPath("another secret", sha, Date.now())), 403);

    // what the dashboard is shown
    const s = storage.state();
    assert.equal(s.files, 1);
    assert.equal(s.used, bytes.length);
    assert.equal(s.folder, join(dir, FOLDER));
    assert.ok(s.room >= bytes.length);
    assert.equal(s.leaving, false);
    assert.equal(s.node!.lastError, "");
    assert.ok(s.node!.lastHeard > 0);
    assert.deepEqual(s.node!.moved.map((m) => m.way).sort(), ["in", "served"]);

    // a change of kind, size or upload is said at the next beat, by the same node: nothing restarts for it
    h.set({ kind: "replica", gb: 2, up: null });
    await storage.sync();
    assert.equal(nodeOf(storage), node);
    await node.beat();
    assert.deepEqual(last().offer, { kind: "replica", bytes: 2 * GB });
    assert.equal(last().up, null);

    // its WHEN: only on Wi-Fi, and the connection is a phone's data -- it rests, and tells no door
    h.set({ wifiOnly: true });
    h.link = "cell";
    await node.beat();
    assert.equal(last().rests, "not on Wi-Fi");
    assert.deepEqual(last().doors, []);
    assert.equal(last().link, "cell");
    assert.equal(await knock(door + doorPath("s3cret", sha, Date.now())), 503);   // and its door hands nothing out meanwhile
    h.link = "wifi";
    await node.beat();
    assert.equal(last().rests, "");
    assert.equal(last().doors.length, node.doors().length);

    // PAUSE rests it too, whatever its WHEN; it moves nothing while it rests
    h.paused = true;
    hub.next.push({ secret: "s3cret", drop: [sha] });
    await node.beat();
    assert.equal(last().rests, PAUSED);
    assert.deepEqual(last().doors, []);
    assert.equal(storage.state().node!.rests, PAUSED);
    assert.ok(existsSync(kept));
    assert.equal(await knock(door + doorPath("s3cret", sha, Date.now())), 503);
    h.paused = false;
    await node.beat();
    assert.equal(last().rests, "");

    // The offer switched off: the hub hears at once that it is taken back. It still holds a file, so it LEAVES -- it
    // stays, offering nothing, its door open -- and that it is leaving is written into the settings
    h.set({ on: false });
    await storage.sync();
    assert.equal(last().offer, null);
    assert.equal(nodeOf(storage), node);
    assert.equal(node.leaving, true);
    assert.equal(storage.leaving, true);
    assert.equal(storage.state().leaving, true);
    assert.equal(h.cfg.hoard.leaving, true);
    assert.equal(node.empty(), false);
    assert.equal(await knock(door + doorPath("s3cret", sha, Date.now())), 200);   // another node can still fetch it from here
    hub.next.push({ secret: "s3cret", want: [{ sha: shaOf(Buffer.from("another")), size: 7 }] });
    await node.beat();
    assert.equal(last().offer, null);                                       // said at every beat while it leaves
    assert.equal(node.lastError, "");                                       // and nothing more is fetched, nor complained of
    assert.ok(existsSync(kept));
    await storage.sync();
    assert.equal(nodeOf(storage), node);                                    // not yet empty: still here

    // switched on again before it emptied: the offer stands again, by the same node, and the leaving is over
    h.set({ on: true });
    await storage.sync();
    assert.equal(nodeOf(storage), node);
    assert.equal(node.leaving, false);
    assert.equal(h.cfg.hoard.leaving, false);
    assert.deepEqual(last().offer, { kind: "replica", bytes: 2 * GB });    // and the hub heard so at once

    // off again; this time another node comes to hold the file, and the hub answers the leaving node's beat with a
    // drop for it: the folder is emptied, and the next look closes the door with a last word
    h.set({ on: false });
    await storage.sync();
    assert.equal(node.leaving, true);
    assert.equal(h.cfg.hoard.leaving, true);
    hub.elsewhere = true;
    await node.beat();
    assert.ok(!existsSync(kept));
    assert.equal(node.empty(), true);
    await storage.sync();
    assert.equal(last().offer, null);
    assert.deepEqual(last().gone, [sha]);
    assert.equal(nodeOf(storage), null);
    assert.equal(storage.leaving, false);
    assert.equal(h.cfg.hoard.leaving, false);
    assert.equal(storage.state().running, false);
    assert.equal(storage.state().files, 0);
    await assert.rejects(fetch(`${door}/hoard/ping`));
    const heard = hub.beats.length;
    await storage.sync();
    assert.equal(hub.beats.length, heard);                                  // off, and nothing owed: it says nothing more
  } finally {
    await storage.stop();
    hub.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a node that holds nothing closes at once; one whose files the hub lets go at once closes in the same breath", async () => {
  const dir = tmp("quick"), bytes = Buffer.from("kept twice already\n".repeat(50)), sha = shaOf(bytes);
  const hub = await fakeHub(new Map([[sha, bytes]]));
  const h = host(hostOf(hub.url, dir)), storage = h.storage();
  const last = () => hub.beats[hub.beats.length - 1];
  try {
    // nothing held: switched off, it says so once and is gone; no leaving is kept
    await storage.sync();
    await must(storage).beat();
    h.set({ on: false });
    await storage.sync();
    assert.equal(nodeOf(storage), null);
    assert.equal(hub.beats.length, 2);
    assert.equal(last().offer, null);
    assert.equal(h.cfg.hoard.leaving, false);

    // a file every other node already holds (a REPLICA's): the hub's answer to its first leaving beat drops it
    h.set({ on: true, kind: "replica" });
    await storage.sync();
    const node = must(storage);
    hub.next.push({ secret: "s3cret", want: [{ sha, size: bytes.length }] });
    await node.beat();
    assert.equal(node.empty(), false);
    hub.elsewhere = true;
    h.set({ on: false });
    await storage.sync();
    assert.equal(node.empty(), true);
    assert.equal(nodeOf(storage), null);
    assert.equal(h.cfg.hoard.leaving, false);
    assert.equal(last().offer, null);
    assert.deepEqual(last().gone, [sha]);
  } finally {
    await storage.stop();
    hub.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a leaving outlives the agent: started again, it is taken up where it was, until the folder is empty", async () => {
  const dir = tmp("again"), bytes = Buffer.from("still here when the agent comes back\n".repeat(100)), sha = shaOf(bytes);
  const hub = await fakeHub(new Map([[sha, bytes]]));
  const h = host(hostOf(hub.url, dir));
  const last = () => hub.beats[hub.beats.length - 1];
  const kept = join(dir, FOLDER, sha.slice(0, 2), sha);
  const first = h.storage();
  let second: Storage | null = null, third: Storage | null = null;
  try {
    await first.sync();
    hub.next.push({ secret: "s3cret", want: [{ sha, size: bytes.length }] });
    await must(first).beat();
    h.set({ on: false });
    await first.sync();
    assert.equal(first.leaving, true);
    assert.equal(h.cfg.hoard.leaving, true);
    // the agent ends: its door closes, nothing is said, and the leaving stays in the settings
    const heard = hub.beats.length;
    await first.stop();
    assert.equal(hub.beats.length, heard);
    assert.equal(h.cfg.hoard.leaving, true);
    assert.ok(existsSync(kept));

    // while it cannot run (its port is another's, say) the leaving is still owed, and the dashboard says so
    const taken = createServer();
    await new Promise<void>((ok) => taken.listen(0, "127.0.0.1", ok));
    h.set({ port: (taken.address() as { port: number }).port });
    second = h.storage();
    await second.sync();
    assert.equal(nodeOf(second), null);
    assert.match(second.why, /is taken/);
    assert.equal(second.state().leaving, true);
    assert.equal(second.state().files, 1);
    assert.equal(h.cfg.hoard.leaving, true);
    await new Promise<void>((ok) => taken.close(() => ok()));
    h.set({ port: 0 });

    // the agent starts again: off, but leaving, and the folder still holds the file -- the node starts as a leaving one
    await second.sync();
    const node = must(second);
    assert.equal(node.leaving, true);
    assert.equal(second.state().leaving, true);
    assert.match(second.said(), /taking its offer back/);
    await node.beat();
    assert.equal(last().offer, null);                                       // its first word says so
    assert.deepEqual(last().have, [sha]);
    assert.ok(existsSync(kept));
    hub.elsewhere = true;                                                   // another node holds it now: the hub's answer is a drop
    await node.beat();
    assert.ok(!existsSync(kept));
    assert.equal(node.empty(), true);
    await second.sync();
    assert.equal(nodeOf(second), null);
    assert.equal(h.cfg.hoard.leaving, false);
    assert.deepEqual(last().gone, [sha]);
    assert.equal(last().offer, null);

    // a leaving kept for a folder that holds nothing now is simply over: no node, no word to the hub
    h.set({ leaving: true });
    const said = hub.beats.length;
    third = h.storage();
    await third.sync();
    assert.equal(nodeOf(third), null);
    assert.equal(h.cfg.hoard.leaving, false);
    assert.equal(third.why, "");
    assert.equal(hub.beats.length, said);
  } finally {
    await first.stop(); await second?.stop(); await third?.stop();
    hub.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("its owner will not wait: the door closed now, the hub told, the leaving over, the files left in the folder", async () => {
  const dir = tmp("now"), bytes = Buffer.from("left where it is\n".repeat(80)), sha = shaOf(bytes);
  const hub = await fakeHub(new Map([[sha, bytes]]));
  const h = host(hostOf(hub.url, dir)), storage = h.storage();
  try {
    await storage.sync();
    hub.next.push({ secret: "s3cret", want: [{ sha, size: bytes.length }] });
    await must(storage).beat();
    h.set({ on: false });
    await storage.sync();
    assert.equal(storage.leaving, true);
    await storage.stop(true);
    assert.equal(hub.beats[hub.beats.length - 1].offer, null);
    assert.equal(nodeOf(storage), null);
    assert.equal(h.cfg.hoard.leaving, false);
    assert.ok(existsSync(join(dir, FOLDER, sha.slice(0, 2), sha)));
    assert.equal(storage.state().files, 1);                                 // and the dashboard still says what is there
    assert.equal(storage.state().leaving, false);
    assert.equal(storage.why, "");
    const heard = hub.beats.length;
    await storage.sync();                                                   // and no later look starts it again
    assert.equal(nodeOf(storage), null);
    assert.equal(hub.beats.length, heard);
  } finally {
    await storage.stop();
    hub.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("when it runs, and why not: not paired, no folder, its drive gone, its port taken; a new folder or key starts it again", async () => {
  const a = tmp("a"), b = tmp("b");
  const hub = await fakeHub(new Map());
  const h = host(hostOf(hub.url, "")), storage = h.storage();
  const taken = createServer();
  try {
    await storage.sync();
    assert.equal(nodeOf(storage), null);
    assert.match(storage.why, /no folder chosen/);
    h.cfg = { ...hostOf(hub.url, a), key: "" };
    await storage.sync();
    assert.match(storage.why, /not paired/);
    assert.equal(storage.state().running, false);
    h.cfg = hostOf(hub.url, a, { on: false });
    await storage.sync();
    assert.equal(nodeOf(storage), null);
    assert.equal(storage.why, "");                                          // off is not a problem
    assert.ok(!existsSync(join(a, FOLDER)), "nothing is made in a folder that is not offered");

    // its door's port is another program's
    await new Promise<void>((ok) => taken.listen(0, "127.0.0.1", ok));
    const port = (taken.address() as { port: number }).port;
    h.cfg = hostOf(hub.url, a, { port });
    await storage.sync();
    assert.equal(nodeOf(storage), null);
    assert.match(storage.why, new RegExp(`port \\(${port}\\) is taken`));
    await new Promise<void>((ok) => taken.close(() => ok()));
    await storage.sync();                                                   // freed: the next look opens it
    const first = must(storage);
    assert.equal(first.port, port);
    assert.match(storage.said(), /THE HOARD's door at/);
    await first.beat();
    assert.equal(hub.beats.length, 1);

    // another folder: the node is started again there, and the offer was never taken back
    h.cfg = hostOf(hub.url, b, { port });
    await storage.sync();
    const second = must(storage);
    assert.notEqual(second, first);
    assert.equal(storage.state().folder, join(b, FOLDER));
    assert.ok(hub.beats.every((x) => x.offer !== null));
    // another door
    h.cfg = hostOf(hub.url, b, { port: 0 });
    await storage.sync();
    const third = must(storage);
    assert.notEqual(third, second);
    assert.notEqual(third.port, 0);
    // its folder's drive is gone: closed, and said; back again: open again
    rmSync(b, { recursive: true, force: true });
    await storage.sync();
    assert.equal(nodeOf(storage), null);
    assert.match(storage.why, /folder is not there/);
    mkdirSync(b);
    await storage.sync();
    const fourth = must(storage);
    await fourth.beat();
    assert.equal(hub.heads[hub.heads.length - 1].authorization, "Bearer k-test");

    // the household forgotten: the one it served is told, with the key it had, and the door closes
    const before = hub.beats.length;
    h.cfg = { ...h.cfg, key: "" };
    await storage.sync();
    assert.equal(nodeOf(storage), null);
    assert.equal(hub.beats.length, before + 1);
    assert.equal(hub.beats[before].offer, null);
    assert.equal(hub.heads[before].authorization, "Bearer k-test");
    assert.match(storage.why, /not paired/);
    assert.match(storage.said(), /door closed: not paired/);
  } finally {
    await storage.stop();
    taken.close();
    hub.close();
    for (const d of [a, b]) rmSync(d, { recursive: true, force: true });
  }
});
