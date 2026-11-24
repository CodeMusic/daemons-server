// C-541: BUILDS -- the Pi program built here for the household, when its hub's source is "volunteers" (the companion's
// pibuilds.ts). A build names a recipe, a commit and a board; only the recipes below are run, only from the companion's
// public repository, and only by that repository's own script (firmware/pizero/tools/package.sh -- the one GitHub runs).
//   1. the commit's two folders, fetched by git here (a sparse, blob-less clone: kilobytes, not the whole repository)
//   2. the build system, an image made from the repository's own tools/build.Dockerfile, kept between builds
//   3. `package.sh fetch` in a container with the network: CMake fetches what it pins, each checked by its hash
//   4. `package.sh build` in a container with NO network, at most the host's own caps of CPU and memory
// The result is three files -- the tarball, the .deb and the board's JSON with its SHA-1 -- sent back as any job's are.
// The commit's time is SOURCE_DATE_EPOCH, so an honest build here gives the same SHA-1 as GitHub's or another host's.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";

export const RECIPES: Record<string, { repo: string; paths: string[]; dir: string; dockerfile: string }> = {
  pizero: { repo: "https://github.com/CodeMusic/daemons-companion.git", paths: ["/firmware/pizero/", "/server/data/patches.json"],
            dir: "firmware/pizero", dockerfile: "firmware/pizero/tools/build.Dockerfile" },
};
export const okBuild = (args: string[]) =>
  args.length === 3 && args[0] in RECIPES && /^[0-9a-f]{40}$/.test(args[1]) && /^[a-z0-9-]{1,40}$/.test(args[2]);

const DOCKER = ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/usr/bin/docker"].find((p) => existsSync(p)) ?? "docker";
const sh = (cmd: string, args: string[], o: { cwd?: string; timeout?: number } = {}) => new Promise<string>((ok, fail) =>
  execFile(cmd, args, { cwd: o.cwd, timeout: o.timeout ?? 600_000, maxBuffer: 64 * 2 ** 20 },
           (e, out, err) => (e ? fail(new Error(`${cmd} ${args[0]}: ${String(err || e.message).trim().split("\n").slice(-3).join(" | ").slice(-300)}`)) : ok(String(out)))));

// whether this machine can build: a container runtime that answers (asked at most once a minute)
let seen = { at: 0, ok: false, why: "" };
export async function canBuild(): Promise<{ ok: boolean; why: string }> {
  if (Date.now() - seen.at < 60_000) return seen;
  try { const v = (await sh(DOCKER, ["info", "--format", "{{.ServerVersion}} {{.Architecture}}"], { timeout: 10_000 })).trim();
        seen = { at: Date.now(), ok: /aarch64|arm64/.test(v), why: /aarch64|arm64/.test(v) ? `Docker ${v}` : `Docker ${v}: the Pi program needs an arm64 machine` }; }
  catch { seen = { at: Date.now(), ok: false, why: "no container runtime answers (Docker Desktop, Podman or OrbStack)" }; }
  return seen;
}

export type Limits = { cpus: number; memGb: number };
export const defaultLimits = (): Limits => ({ cpus: Math.max(1, Math.floor(cpus().length / 2)), memGb: Math.max(2, Math.floor(totalmem() / 2 ** 30 / 4)) });

// run one build in dir; returns the job's outputs by name
export async function runBuild(args: string[], dir: string, lim: Limits = defaultLimits(), say: (s: string) => void = () => {}): Promise<Record<string, string>> {
  if (!okBuild(args)) throw new Error("refused: not a build this host runs");
  const [recipe, commit, board] = args, r = RECIPES[recipe];
  const src = join(dir, "src"), out = join(dir, "out");
  mkdirSync(out, { recursive: true });
  say(`fetching ${commit.slice(0, 12)}`);
  await sh("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", "--sparse", r.repo, src], { timeout: 300_000 });
  await sh("git", ["-C", src, "sparse-checkout", "set", "--no-cone", ...r.paths]);
  await sh("git", ["-C", src, "checkout", "-q", commit]);
  const epoch = (await sh("git", ["-C", src, "log", "-1", "--format=%ct", commit])).trim();
  // no .git left in what is built: a build reads `git describe` from the nearest one (mGBA's does), and GitHub's copy
  // at /daemons has none -- with it, the same commit gave another program
  rmSync(join(src, ".git"), { recursive: true, force: true });

  // the build system, from the repository's own Dockerfile, kept by its hash
  const dockerfile = join(src, r.dockerfile);
  const tag = `daemons-build-${recipe}:${createHash("sha256").update(readFileSync(dockerfile)).digest("hex").slice(0, 12)}`;
  try { await sh(DOCKER, ["image", "inspect", tag], { timeout: 30_000 }); }
  catch { say(`making the build system ${tag}`); await sh(DOCKER, ["build", "-q", "-t", tag, "-f", dockerfile, join(src, r.dir, "tools")], { timeout: 1_800_000 }); }

  const user = process.getuid && process.getgid ? ["--user", `${process.getuid()}:${process.getgid()}`] : [];
  const run = (network: "bridge" | "none", cmd: string[], mounts: string[]) =>
    sh(DOCKER, ["run", "--rm", "--network", network, ...user, "-e", "HOME=/tmp", "-e", `ZERO_VERSION=${commit}`, "-e", `SOURCE_DATE_EPOCH=${epoch}`,
                "--cpus", String(lim.cpus), "--memory", `${lim.memGb}g`, "--pids-limit", "4096", "--security-opt", "no-new-privileges",
                ...mounts.flatMap((m) => ["-v", m]), "-w", `/daemons/${r.dir}`, tag, ...cmd], { timeout: 3_600_000 });
  say(`fetching what CMake pins for the ${board}`);
  await run("bridge", ["tools/package.sh", "fetch", board], [`${src}:/daemons`]);
  say(`building the ${board} (no network)`);
  await run("none", ["tools/package.sh", "build", board, "/out"], [`${src}:/daemons`, `${out}:/out`]);

  const files = { tar: join(out, `daemons-zero-${board}.tar.gz`), deb: join(out, `daemons-zero-${board}.deb`), json: join(out, `${board}.json`) };
  for (const f of Object.values(files)) if (!existsSync(f)) throw new Error(`the build left no ${f.split("/").pop()}`);
  const said = JSON.parse(readFileSync(files.json, "utf8"));
  const sha = createHash("sha1").update(readFileSync(files.tar)).digest("hex");
  if (said.sha1 !== sha || said.commit !== commit || said.board !== board) throw new Error("the build's JSON does not match its tarball");
  say(`built the ${board}: ${sha}`);
  return { "out:tar": files.tar, "out:deb": files.deb, "out:json": files.json };
}
