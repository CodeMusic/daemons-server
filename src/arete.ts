// C-544: ARETE -- work pays it, ASK spends it (SERVER.md 6; the user, 2026-11-24: "ARETE ledger"). The entries keep
// PRAXIS's ledger rules (daemons-praxis): an award's id comes from what it paid for (`mesh:<job id>`), so a job heard
// twice pays once, and the balance is the sum of the entries. Kept on this host for now, in its own folder; when THE
// COMMONS opens they are carried onto the household's PRAXIS ledger (C-544 stays open for that). Every rate is DRAFT.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Entry = { id: string; at: string; amount: number; why: string };
export const RATES = { processingPerMinute: 1, thought: 2, ask: 1, allowancePerDay: 10 };   // DRAFT

// a processing job pays by the work it took on a machine of power 1 (its minutes here x this host's power / 10), so a
// faster machine is given more jobs, not paid more for each; at least one
export const payForProcessing = (ms: number, power: number) => Math.max(1, Math.round(((ms / 60_000) * power / 10) * RATES.processingPerMinute));

export class Ledger {
  private file: string;
  entries: Entry[] = [];
  constructor(dir: string) {
    this.file = join(dir, "arete.jsonl");
    if (existsSync(this.file))
      this.entries = readFileSync(this.file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Entry]; } catch { return []; } });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  private add(e: Entry): boolean {
    if (this.entries.some((x) => x.id === e.id)) return false;      // paid once
    this.entries.push(e);
    appendFileSync(this.file, JSON.stringify(e) + "\n", { mode: 0o600 });
    return true;
  }
  balance() { return this.entries.reduce((s, e) => s + e.amount, 0); }
  earned() { return this.entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0); }
  award(id: string, amount: number, why: string) { return this.add({ id, at: new Date().toISOString(), amount, why }); }

  // ASK: the day's allowance first, then ARETE
  asksToday(now = new Date()) { const d = now.toISOString().slice(0, 10); return this.entries.filter((e) => e.id.startsWith(`ask:${d}`)).length; }
  allowanceLeft(now = new Date()) { return Math.max(0, RATES.allowancePerDay - this.asksToday(now)); }
  canAsk(now = new Date()) { return this.allowanceLeft(now) > 0 || this.balance() >= RATES.ask; }
  spendAsk(now = new Date()): Entry | null {
    if (!this.canAsk(now)) return null;
    const free = this.allowanceLeft(now) > 0;
    const e = { id: `ask:${now.toISOString().slice(0, 10)}:${now.getTime()}:${Math.random().toString(36).slice(2, 6)}`, at: now.toISOString(),
                amount: free ? 0 : -RATES.ask, why: free ? "an ask, from the day's allowance" : "an ask" };
    this.add(e);
    return e;
  }
}
