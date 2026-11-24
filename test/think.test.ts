import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { think, measure } from "../src/think.ts";

test("a thought through a local OpenAI-shaped model; its own thinking taken out", async () => {
  let asked: any = null;
  const s = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    asked = JSON.parse(b || "{}");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "<think>hm</think> A small hello." } }] }));
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(s.address() as any).port}/v1`;
  try {
    assert.equal(await think(url, "tiny", "You are a daemon.", "Hello?", 64), "A small hello.");
    assert.deepEqual(asked.messages.map((m: any) => m.role), ["system", "user"]);
    assert.equal(asked.max_tokens, 64);
    assert.equal((await measure(url, "tiny")).ok, true);
  } finally { s.close(); }
});
test("a model that is not there is not offered", async () => {
  const m = await measure("http://127.0.0.1:9/v1", "none");
  assert.equal(m.ok, false);
});
