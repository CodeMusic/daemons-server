// C-546: every job runs inside a sandbox of its own, as tight as the system allows (SERVER.md 5).
//   macOS   sandbox-exec: no network at all, nothing written outside the job's folder, nothing read from the owner's home
//   Linux   bubblewrap (bwrap) when present: the system read-only, only the job's folder writable, no network, no home
//   Windows not yet: the job runs at low priority in its own folder only (DRAFT, C-546 stays open for it)
// The job's folder is made per job and removed after it. Nothing here is a reason to trust a job: a job's kind still
// names the only program it may run (mesh.ts's safeArgs).
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";

export type Wrapped = { cmd: string; args: string[]; how: "sandbox-exec" | "bwrap" | "none" };

const has = (cmd: string) => { try { execFileSync("which", [cmd], { stdio: "ignore" }); return true; } catch { return false; } };
const q = (p: string) => JSON.stringify(p);                       // a quoted string in the profile's own syntax

// the macOS profile: everything not named is allowed (programs need their libraries), then network and writes are
// taken away, and the owner's home is not readable
export function macProfile(dir: string, home = homedir()): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    `(deny file-read* (subpath ${q(home)}))`,
    "(deny file-write*)",
    `(allow file-read* file-write* (subpath ${q(dir)}))`,
    '(allow file-write* (literal "/dev/null") (literal "/dev/dtracehelper"))',
  ].join("\n");
}

export function wrap(program: string, args: string[], dir: string): Wrapped {
  const real = (() => { try { return realpathSync(dir); } catch { return dir; } })();   // /var -> /private/var on a Mac
  if (process.platform === "darwin" && has("sandbox-exec"))
    return { cmd: "sandbox-exec", args: ["-p", macProfile(real), "nice", "-n", "15", program, ...args], how: "sandbox-exec" };
  if (process.platform === "linux" && has("bwrap"))
    return { cmd: "bwrap", args: ["--ro-bind", "/", "/", "--tmpfs", homedir(), "--bind", real, real, "--dev", "/dev", "--proc", "/proc",
                                  "--unshare-net", "--unshare-pid", "--die-with-parent", "--chdir", real, "nice", "-n", "15", program, ...args], how: "bwrap" };
  if (process.platform === "win32") return { cmd: program, args, how: "none" };
  return { cmd: "nice", args: ["-n", "15", program, ...args], how: "none" };
}

export const sandboxKind = (): Wrapped["how"] =>
  process.platform === "darwin" && has("sandbox-exec") ? "sandbox-exec" : process.platform === "linux" && has("bwrap") ? "bwrap" : "none";
