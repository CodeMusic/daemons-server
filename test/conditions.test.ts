import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, inHours, type Readings, type Settings } from "../src/conditions.ts";
import { apply, defaults } from "../src/config.ts";
import { safeArgs } from "../src/mesh.ts";

const S: Settings = { mode: "idle-plugged", idleMin: 5, hours: { from: 1, to: 6 }, memRestPct: 20 };
const R: Readings = { idleSec: 600, onPower: true, memFreePct: 60, paused: false, hour: 14 };

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
  assert.equal(decide({ ...S, mode: "scheduled" }, { ...R, hour: 3, idleSec: 0, onPower: false }).work, true);
  assert.equal(decide({ ...S, mode: "scheduled" }, { ...R, hour: 14 }).work, false);
});
test("every mode rests when paused or short of memory", () => {
  for (const mode of ["idle-plugged", "scheduled", "always"] as const) {
    assert.equal(decide({ ...S, mode }, { ...R, hour: 3, paused: true }).work, false);
    assert.equal(decide({ ...S, mode }, { ...R, hour: 3, memFreePct: 10 }).work, false);
  }
  assert.equal(decide({ ...S, mode: "always" }, { ...R, idleSec: 0, onPower: false }).work, true);
});
test("settings from the dashboard are checked; the kinds not built stay off", () => {
  const c = apply(defaults(), { mode: "nonsense", idleMin: 9999, builds: true, thinking: true, from: -4, commons: true });
  assert.equal(c.mode, "idle-plugged");
  assert.equal(c.idleMin, 120);
  assert.equal(c.hours.from, 0);
  assert.equal(c.work.builds, false);
  assert.equal(c.work.thinking, false);
  assert.equal(c.commons, false);
});
test("a job names files only through @in and @out", () => {
  assert.equal(safeArgs(["-i", "@in:a", "-c:a", "libopus", "@out:b"]), true);
  assert.equal(safeArgs(["-i", "/etc/passwd", "@out:b"]), false);
  assert.equal(safeArgs(["-i", "https://x/y", "@out:b"]), false);
  assert.equal(safeArgs(["-i", "../x", "@out:b"]), false);
});
