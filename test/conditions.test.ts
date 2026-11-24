import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, inHours, type Readings, type Settings } from "../src/conditions.ts";
import { apply, defaults } from "../src/config.ts";
import { safeArgs } from "../src/mesh.ts";

const S: Settings = { mode: "idle-plugged", idleMin: 5, hours: { from: 1, to: 6 }, memRestPct: 20, batteryFloor: null, diskMinGb: 5 };
const R: Readings = { idleSec: 600, onPower: true, batteryPct: 80, memFreePct: 60, hot: false, diskFreeGb: 100, paused: false, hour: 14 };

test("idle and plugged in: works only when both hold", () => {
  assert.equal(decide(S, R).work, true);
  assert.equal(decide(S, { ...R, idleSec: 30 }).work, false);
  assert.equal(decide(S, { ...R, onPower: false }).work, false);
  assert.equal(decide(S, { ...R, idleSec: null }).work, false);    // cannot tell: rests rather than guess
});
test("scheduled hours, past midnight too", () => {
  assert.equal(inHours(3, { from: 1, to: 6 }), true);
  assert.equal(inHours(23, { from: 22, to: 6 }), true);
  assert.equal(inHours(12, { from: 22, to: 6 }), false);
  assert.equal(decide({ ...S, mode: "scheduled" }, { ...R, hour: 3, idleSec: 0, onPower: true }).work, true);
  assert.equal(decide({ ...S, mode: "scheduled" }, { ...R, hour: 14 }).work, false);
});
test("every mode rests when paused or short of memory", () => {
  for (const mode of ["idle-plugged", "scheduled", "always"] as const) {
    assert.equal(decide({ ...S, mode }, { ...R, hour: 3, paused: true }).work, false);
    assert.equal(decide({ ...S, mode }, { ...R, hour: 3, memFreePct: 10 }).work, false);
  }
  assert.equal(decide({ ...S, mode: "always" }, { ...R, idleSec: 0, onPower: false }).work, false);   // never on battery, by default
  assert.equal(decide({ ...S, mode: "always" }, { ...R, idleSec: 0 }).work, true);
});
test("the rests: heat, disk, and battery below the owner's floor", () => {
  const A = { ...S, mode: "always" as const };
  assert.equal(decide(A, { ...R, hot: true }).work, false);
  assert.equal(decide(A, { ...R, diskFreeGb: 2 }).work, false);
  assert.equal(decide({ ...A, batteryFloor: 50 }, { ...R, onPower: false, batteryPct: 70 }).work, true);
  assert.equal(decide({ ...A, batteryFloor: 50 }, { ...R, onPower: false, batteryPct: 30 }).work, false);
  assert.equal(decide(S, { ...R, onPower: null, batteryPct: null }).work, true);    // a desktop: no battery at all
});
test("settings from the dashboard are checked; the kinds not built stay off", () => {
  const c = apply(defaults(), { mode: "nonsense", idleMin: 9999, builds: true, thinking: true, from: -4, commons: true });
  assert.equal(c.mode, "idle-plugged");
  assert.equal(c.idleMin, 120);
  assert.equal(c.hours.from, 0);
  assert.equal(c.work.builds, false);
  assert.equal(c.work.thinking, true);        // thinking is built (C-542); builds are not
  assert.equal(apply(defaults(), { batteryFloor: 40 }).batteryFloor, 40);
  assert.equal(apply(apply(defaults(), { batteryFloor: 40 }), { batteryFloor: "never" }).batteryFloor, null);
  assert.equal(c.commons, false);
});
test("a job names files only through @in and @out", () => {
  assert.equal(safeArgs(["-i", "@in:a", "-c:a", "libopus", "@out:b"]), true);
  assert.equal(safeArgs(["-i", "/etc/passwd", "@out:b"]), false);
  assert.equal(safeArgs(["-i", "https://x/y", "@out:b"]), false);
  assert.equal(safeArgs(["-i", "../x", "@out:b"]), false);
});

import { macProfile } from "../src/sandbox.ts";
test("the Mac sandbox: no network, writes only in the job's folder, the home unreadable", () => {
  const p = macProfile("/private/var/x/job", "/Users/someone");
  assert.match(p, /\(deny network\*\)/);
  assert.match(p, /\(deny file-write\*\)/);
  assert.match(p, /\(deny file-read\* \(subpath "\/Users\/someone"\)\)/);
  assert.match(p, /\(allow file-read\* file-write\* \(subpath "\/private\/var\/x\/job"\)\)/);
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, RATES, payForProcessing } from "../src/arete.ts";
test("ARETE: a job pays once; asks spend the allowance, then ARETE", () => {
  const l = new Ledger(mkdtempSync(join(tmpdir(), "arete-")));
  assert.equal(l.award("mesh:a", 3, "x"), true);
  assert.equal(l.award("mesh:a", 3, "x"), false);
  assert.equal(l.balance(), 3);
  const day = new Date("2026-11-24T12:00:00Z");
  for (let i = 0; i < RATES.allowancePerDay; i++) assert.equal(l.spendAsk(day)?.amount, 0);
  assert.equal(l.spendAsk(day)?.amount, -RATES.ask);
  assert.equal(l.balance(), 3 - RATES.ask);
  while (l.balance() >= RATES.ask) l.spendAsk(day);
  assert.equal(l.canAsk(day), false);
  assert.equal(l.canAsk(new Date("2026-11-25T12:00:00Z")), true);   // a new day's allowance
  assert.equal(new Ledger(join(tmpdir(), "nowhere-" + Date.now())).balance(), 0);
});
test("a faster host is given more jobs, not paid more for the same one", () => {
  assert.equal(payForProcessing(60_000, 10), payForProcessing(30_000, 20));
  assert.equal(payForProcessing(100, 1), 1);
});
