// C-542: THINKING -- a model already on this computer lent to the household as a thinker. THE MESH (the companion's
// procmesh.ts) already gives a "think" job to a node whose caps say "think", as it does for a phone that lends its
// model: {system, user, most} in, the words out. This finds a local model server on its usual port, measures one short
// prompt before offering it, and answers a job through its OpenAI-shaped chat completions. It keeps nothing: the
// household's words come in, the answer goes back, and neither is written down here (they are the household's, ring
// "home": SERVER.md 5 -- a thought for THE COMMONS is never routed to a host outside the household).

export type Found = { url: string; models: string[]; server: string };
const PLACES: { server: string; url: string }[] = [
  { server: "Ollama", url: "http://127.0.0.1:11434/v1" },
  { server: "LM Studio", url: "http://127.0.0.1:1234/v1" },
  { server: "an MLX server", url: "http://127.0.0.1:8080/v1" },
  { server: "llama.cpp", url: "http://127.0.0.1:8081/v1" },
];

export async function findModels(): Promise<Found[]> {
  const found: Found[] = [];
  await Promise.all(PLACES.map(async (p) => {
    try {
      const r = await fetch(`${p.url}/models`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return;
      const j: any = await r.json();
      const models = (Array.isArray(j.data) ? j.data : []).map((m: any) => String(m.id)).filter((m: string) => !/embed/i.test(m));
      if (models.length) found.push({ ...p, models });
    } catch { /* nothing there */ }
  }));
  return found;
}

// a thought, by a local model; thinking switched off in models that think aloud (Qwen's /no_think is ignored elsewhere)
export async function think(url: string, model: string, system: string, user: string, most: number, timeoutMs = 120_000): Promise<string> {
  const r = await fetch(`${url}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model, max_tokens: Math.max(16, Math.min(4096, most || 256)), temperature: 0.8, stream: false,
                           messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
  if (!r.ok) throw new Error(`the local model answered ${r.status}`);
  const j: any = await r.json();
  const text = String(j.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new Error("the local model said nothing");
  return text;
}

// one short prompt, timed: offered to the household only if it answers within the time a person would wait
export async function measure(url: string, model: string): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now();
  try { await think(url, model, "Answer in one short sentence.", "Say hello.", 32, 60_000); return { ok: Date.now() - t0 < 30_000, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, error: (e as Error).message }; }
}
