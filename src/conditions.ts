// WHEN a host may work (SERVER.md 3.2): the owner's mode, then the rests that hold in every mode. The decision is a pure
// function of what was measured, so it is tested without a machine; the measuring is per system (Mac first).
import { execFileSync } from "node:child_process";
import { cpus, freemem, loadavg, totalmem } from "node:os";

export type Mode = "idle-plugged" | "scheduled" | "always";
export type Hours = { from: number; to: number };            // 0..23, local; to < from runs past midnight
export type Readings = { idleSec: number | null; onPower: boolean | null; memFreePct: number | null; paused: boolean; hour: number };
export type Settings = { mode: Mode; idleMin: number; hours: Hours; memRestPct: number };
export type Verdict = { work: boolean; why: string };

export const inHours = (h: number, { from, to }: Hours) => (from <= to ? h >= from && h < to : h >= from || h < to);

export function decide(s: Settings, r: Readings): Verdict {
  if (r.paused) return { work: false, why: "paused by its owner" };
  if (r.memFreePct !== null && r.memFreePct < s.memRestPct) return { work: false, why: `resting: ${r.memFreePct}% of memory free` };
  if (s.mode === "always") return { work: true, why: "always, under its caps" };
  if (s.mode === "scheduled")
    return inHours(r.hour, s.hours) ? { work: true, why: `inside its hours (${s.hours.from}:00-${s.hours.to}:00)` }
                                    : { work: false, why: `outside its hours (${s.hours.from}:00-${s.hours.to}:00)` };
  if (r.onPower === false) return { work: false, why: "on battery" };
  if (r.idleSec === null) return { work: false, why: "cannot tell whether its owner is here" };
  if (r.idleSec < s.idleMin * 60) return { work: false, why: "its owner is here" };
  return { work: true, why: `idle ${Math.floor(r.idleSec / 60)} min and plugged in` };
}

// ---- measuring (macOS; elsewhere each reads null and the decision rests rather than guessing) ----
const run = (cmd: string, args: string[]) => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 5000 }); } catch { return null; } };

export function idleSeconds(): number | null {
  if (process.platform !== "darwin") return null;
  const m = /"HIDIdleTime" = (\d+)/.exec(run("ioreg", ["-c", "IOHIDSystem", "-d", "4"]) ?? "");
  return m ? Math.floor(Number(m[1]) / 1e9) : null;
}
export function onPower(): boolean | null {
  if (process.platform !== "darwin") return null;
  const out = run("pmset", ["-g", "batt"]);
  return out === null ? null : out.includes("'AC Power'");
}
export function memFreePct(): number | null {
  if (process.platform === "darwin") {
    const m = /(\d+)%/.exec(run("memory_pressure", ["-Q"]) ?? "");
    if (m) return Number(m[1]);
  }
  return Math.round((freemem() / totalmem()) * 100);
}
export const load = () => Math.round((loadavg()[0] / cpus().length) * 100) / 100;

export function read(paused: boolean): Readings {
  return { idleSec: idleSeconds(), onPower: onPower(), memFreePct: memFreePct(), paused, hour: new Date().getHours() };
}
