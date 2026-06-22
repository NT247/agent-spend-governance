/**
 * Agent simulation.
 *
 * Plays the role of an agent that has been told to "build and ship an app," and
 * works through the provisioning steps that requires. For each step it calls the
 * governance Worker's /provision endpoint and prints the verdict, so you can watch
 * the full Discovery -> decide -> ledger loop run against your deployed Worker.
 *
 * Usage:
 *   node agent/run.js https://your-worker.your-subdomain.workers.dev
 *
 * If no URL is given it defaults to a local `wrangler dev` server.
 */

const BASE = process.argv[2] || "http://127.0.0.1:8787";

const purchaseQueue = [
  { service: "cloudflare/r2:bucket",        label: "Create R2 bucket for assets", amountUsd: 0,     category: "storage",      recurring: false },
  { service: "cloudflare/registrar:domain", label: "Register coolapp.dev",        amountUsd: 10.44, category: "domain",       recurring: false },
  { service: "cloudflare/workers:paid",     label: "Workers Paid subscription",   amountUsd: 5.0,   category: "subscription", recurring: true  },
  { service: "cloudflare/registrar:domain", label: "Register coolapp.ai",         amountUsd: 70.0,  category: "domain",       recurring: false },
  { service: "cloudflare/registrar:domain", label: "Register coolapp.io",         amountUsd: 34.0,  category: "domain",       recurring: false },
];

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

async function main() {
  console.log(`\nAgent goal: build and ship an app on Cloudflare.`);
  console.log(`Governance Worker: ${BASE}\n`);

  await post("/reset");

  for (const action of purchaseQueue) {
    const { decision, ledger } = await post("/provision", action);
    const tag = decision.verdict.toUpperCase().padEnd(8);
    const price = action.amountUsd ? `$${action.amountUsd.toFixed(2)}` : "free";
    console.log(`[${tag}] ${action.label} (${price})`);
    console.log(`           ${decision.reason}`);
    console.log(`           budget: $${ledger.spentUsd.toFixed(2)} spent, $${ledger.remainingUsd.toFixed(2)} left\n`);
  }

  console.log("Done. Held actions are waiting for a human to approve via POST /approve.");
  console.log("Full decision history: GET /audit\n");
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
