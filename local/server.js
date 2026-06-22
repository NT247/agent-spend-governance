/**
 * Local runner.
 *
 * Lets you run the entire governance flow on your laptop with no Cloudflare
 * account, no wrangler, no network — useful for developing and for demoing
 * offline. It imports the SAME Worker handler used in production and gives it an
 * in-memory stand-in for the KV namespace, so the logic exercised here is
 * identical to what runs on Cloudflare. Only the storage backing differs.
 *
 * Usage:
 *   node local/server.js          # starts on http://127.0.0.1:8787
 *   (in another terminal) node agent/run.js
 */
import { createServer } from "node:http";
import worker from "../src/index.js";

// Minimal in-memory implementation of the KV API surface the Worker uses:
// get, put, list({prefix}), delete.
function makeMemoryKV() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, val) { store.set(key, val); },
    async delete(key) { store.delete(key); },
    async list({ prefix = "" } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

const env = { GOVERNANCE: makeMemoryKV() };

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString("utf8");

  const request = new Request("http://127.0.0.1:8787" + req.url, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
  });

  const response = await worker.fetch(request, env);
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(await response.text());
});

server.listen(8787, () => {
  console.log("Governance Worker running locally at http://127.0.0.1:8787");
  console.log("In another terminal, run:  node agent/run.js\n");
});
