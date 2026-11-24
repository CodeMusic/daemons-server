// WHEN a host may work (SERVER.md 3.2, C-540): the owner's mode, then the rests that hold in every mode -- paused, short
// of memory, too hot, on battery below the owner's floor, short of disk. The decision is a pure function of what was
// measured, so it is tested without a machine; the measuring is per system (macOS first; Linux and Windows read what
// they can, and whatever cannot be read is null: the decision rests rather than guess where it matters).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statfsSync } from "node:fs";
import { cpus, freemem, loadavg, tmpdir, totalmem } from "node:os";

export type Mode = "idle-plugged" | "scheduled" | "always";
export type Hours = { from: number; to: number };            // 0..23, local; to < from runs past midnight
export type Readings = { idleSec: number | null; onPower: boolean | null; batteryPct: number | null; memFreePct: number | null;
                         hot: boolean | null; diskFreeGb: number | null; paused: boolean; hour: number };
export type Settings = { mode: Mode; idleMin: number; hours: Hours; memRestPct: number;
                         batteryFloor: number | null;          // null: never on battery; else work on battery above this %
                         diskMinGb: number };
export type Verdict = { work: boolean; why: string };

export const inHours = (h: number, { from, to }: Hours) => (from <= to ? h >= from && h < to : h >= from || h < to);

export function decide(s: Settings, r: Readings): Verdict {
  if (r.paused) return { work: false, why: "paused by its owner" };
  if (r.memFreePct !== null && r.memFreePct < s.memRestPct) return { work: false, why: `resting: ${r.memFreePct}% of memory free` };
  if (r.hot) return { work: false, why: "resting: the machine is hot and slowing itself" };
  if (r.diskFreeGb !== null && r.diskFreeGb < s.diskMinGb) return { work: false, why: `resting: ${r.diskFreeGb} GB of disk free` };
  if (r.onPower === false) {
    if (s.batteryFloor === null) return { work: false, why: "on battery" };
    if (r.batteryPct === null || r.batteryPct < s.batteryFloor) return { work: false, why: `on battery below ${s.batteryFloor}%` };
  }
  if (s.mode === "always") return { work: true, why: "always, under its caps" };
  if (s.mode === "scheduled")
    return inHours(r.hour, s.hours) ? { work: true, why: `inside its hours (${s.hours.from}:00-${s.hours.to}:00)` }
                                    : { work: false, why: `outside its hours (${s.hours.from}:00-${s.hours.to}:00)` };
  if (r.onPower === null && s.batteryFloor === null && r.batteryPct !== null) return { work: false, why: "cannot tell whether it is plugged in" };
  if (r.idleSec === null) return { work: false, why: "cannot tell whether its owner is here" };
  if (r.idleSec < s.idleMin * 60) return { work: false, why: "its owner is here" };
  return { work: true, why: `idle ${Math.floor(r.idleSec / 60)} min${r.onPower ? " and plugged in" : ""}` };
}

// ---- measuring ----
const run = (cmd: string, args: string[], timeout = 5000) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }); } catch { return null; }
};
const ps = (script: string) => run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], 8000);
const mac = process.platform === "darwin", linux = process.platform === "linux", win = process.platform === "win32";

export function idleSeconds(): number | null {
  if (mac) { const m = /"HIDIdleTime" = (\d+)/.exec(run("ioreg", ["-c", "IOHIDSystem", "-d", "4"]) ?? ""); return m ? Math.floor(Number(m[1]) / 1e9) : null; }
  if (linux) {
    const x = run("xprintidle", []);                                   // X11, in milliseconds
    if (x && /^\d+/.test(x)) return Math.floor(Number(x) / 1000);
    const s = run("loginctl", ["show-session", process.env.XDG_SESSION_ID ?? "auto", "-p", "IdleHint", "-p", "IdleSinceHintMonotonic"]);
    if (s && /IdleHint=yes/.test(s)) {
      const since = Number(/IdleSinceHintMonotonic=(\d+)/.exec(s)?.[1] ?? 0);           // microseconds since boot
      let up = 0; try { up = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]); } catch { /* unknown */ }
      return since && up ? Math.max(0, Math.floor(up - since / 1e6)) : 600;
    }
    return s ? 0 : null;
  }
  if (win) {
    const out = ps(`Add-Type 'using System;using System.Runtime.InteropServices;public class I{[StructLayout(LayoutKind.Sequential)]public struct L{public uint s;public uint t;}[DllImport("user32.dll")]public static extern bool GetLastInputInfo(ref L l);public static uint S(){L l=new L();l.s=8;GetLastInputInfo(ref l);return ((uint)Environment.TickCount-l.t)/1000;}}';[I]::S()`);
    return out && /^\d+/.test(out.trim()) ? Number(out.trim()) : null;
  }
  return null;
}

export function battery(): { onPower: boolean | null; pct: number | null } {
  if (mac) {
    const out = run("pmset", ["-g", "batt"]);
    if (out === null) return { onPower: null, pct: null };
    const pct = /(\d+)%/.exec(out);
    return { onPower: out.includes("'AC Power'"), pct: pct ? Number(pct[1]) : null };    // a desktop: AC and no %
  }
  if (linux) {
    const base = "/sys/class/power_supply";
    if (!existsSync(base)) return { onPower: null, pct: null };
    let onPower: boolean | null = null, pct: number | null = null;
    for (const d of readdirSync(base)) {
      const read = (f: string) => { try { return readFileSync(`${base}/${d}/${f}`, "utf8").trim(); } catch { return null; } };
      const type = read("type");
      if (type === "Mains" && read("online") !== null) onPower = (onPower ?? false) || read("online") === "1";
      if (type === "Battery" && read("capacity") !== null) pct = Number(read("capacity"));
    }
    return { onPower: onPower ?? (pct === null ? true : null), pct };
  }
  if (win) {
    const out = ps("$b=Get-CimInstance Win32_Battery;if($b){\"$($b.BatteryStatus) $($b.EstimatedChargeRemaining)\"}else{'none'}");
    if (!out) return { onPower: null, pct: null };
    if (out.trim() === "none") return { onPower: true, pct: null };
    const [status, pct] = out.trim().split(/\s+/).map(Number);
    return { onPower: status !== 1, pct: Number.isFinite(pct) ? pct : null };          // 1: discharging
  }
  return { onPower: null, pct: null };
}

export function memFreePct(): number | null {
  if (mac) { const m = /(\d+)%/.exec(run("memory_pressure", ["-Q"]) ?? ""); if (m) return Number(m[1]); }
  if (linux) {
    try {
      const mi = readFileSync("/proc/meminfo", "utf8");
      const avail = Number(/MemAvailable:\s+(\d+)/.exec(mi)?.[1]), total = Number(/MemTotal:\s+(\d+)/.exec(mi)?.[1]);
      if (avail && total) return Math.round((avail / total) * 100);
    } catch { /* below */ }
  }
  return Math.round((freemem() / totalmem()) * 100);
}

// hot: the machine is limiting its own speed for heat
export function hot(): boolean | null {
  if (mac) {
    const out = run("pmset", ["-g", "therm"]);
    if (out === null) return null;
    const lim = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(out);
    return lim ? Number(lim[1]) < 100 : /thermal warning level.*(serious|critical)/i.test(out);
  }
  if (linux) {
    try {
      const zones = readdirSync("/sys/class/thermal").filter((z) => z.startsWith("thermal_zone"));
      const t = Math.max(...zones.map((z) => Number(readFileSync(`/sys/class/thermal/${z}/temp`, "utf8")) / 1000));
      return Number.isFinite(t) ? t >= 90 : null;
    } catch { return null; }
  }
  return null;
}

export function diskFreeGb(dir = tmpdir()): number | null {
  try { const s = statfsSync(dir); return Math.round((s.bavail * s.bsize) / 2 ** 30); } catch { return null; }
}

export const load = () => Math.round((loadavg()[0] / cpus().length) * 100) / 100;

// readings are cached a few seconds: on Windows each costs a PowerShell
let cache: { at: number; r: Omit<Readings, "paused" | "hour"> } | null = null;
export function read(paused: boolean): Readings {
  if (!cache || Date.now() - cache.at > (win ? 15_000 : 4_000)) {
    const b = battery();
    cache = { at: Date.now(), r: { idleSec: idleSeconds(), onPower: b.onPower, batteryPct: b.pct, memFreePct: memFreePct(), hot: hot(), diskFreeGb: diskFreeGb() } };
  }
  return { ...cache.r, paused, hour: new Date().getHours() };
}
