# Agent Spend Governance

**Live demo:** [`/catalog`](https://agent-spend-governance.niveditathapa.workers.dev/catalog) · [`/audit`](https://agent-spend-governance.niveditathapa.workers.dev/audit) · [`/ledger`](https://agent-spend-governance.niveditathapa.workers.dev/ledger)
 | **Writeup:** see [`writeup.pdf`](./writeup.pdf) for what I built and the product feedback that came out of it.

A Cloudflare Worker that adds an inspectable governance layer to the
agent-provisioning protocol described in Cloudflare's [*Agents can now create
Cloudflare accounts, buy domains, and deploy*](https://blog.cloudflare.com/agents-stripe-projects/).

That protocol's Payment step ships with a single guardrail today: a flat
**$100/month spend cap per provider**. This project replaces that one number
with a small policy engine, a persisted budget ledger, and an audit trail of
every decision so an agent spending on your behalf is governed by legible
rules, not a blunt limit.

## The idea in one line

A flat cap treats every dollar as identical. A one-time $10 domain and a
recurring $10/month subscription are not the same risk. Governance should
reflect that, and a human should be able to read *why* each decision was made.

## What it does

For each provisioning action an agent attempts, the Worker returns one of:

- **approve** : within budget and within an auto-approve rule; the agent proceeds
- **hold** : affordable, but a human should sign off (recurring charges; one-time
  charges over a threshold)
- **deny** : would exceed the remaining budget

Every decision is written to an audit trail with a timestamp, the action, the
verdict, the reason, and the budget state after the decision.

## Architecture

```
agent  ──POST /provision──▶  Worker  ──▶  policy engine (src/policy.js)
                              │
                              ├──▶  KV: budget ledger   (spent / remaining)
                              └──▶  KV: audit trail      (every decision + reason)

human  ──POST /approve───▶  Worker     (releases a held action)
```

- `src/policy.js` : the decision logic. Pure, testable, framework-free. This is
  the heart of the project.
- `src/index.js` : the Worker: HTTP endpoints, KV-backed ledger and audit trail.
- `src/catalog.js` : a Discovery-style service catalog (mirrors `stripe projects
  catalog`).
- `agent/run.js` : a simulated agent that drives a realistic purchase queue.
- `test/policy.test.js` : proves the decision logic, including the cases that
  matter most (budget limit beats category; recurring is always held).
- `local/server.js` : run the whole thing offline with an in-memory KV.

## Run it locally (no Cloudflare account needed)

```bash
node local/server.js          # terminal 1: starts the Worker on :8787
node agent/run.js             # terminal 2: runs the agent against it
```

You'll see the agent work through five actions and the governance layer
approve / hold / deny each with a reason, while the budget ledger updates.

```bash
node test/policy.test.js      # run the decision-logic tests
```

## Deploy it to Cloudflare (from scratch)

If you've never used Cloudflare Workers, this is the full path:

1. **Create a free Cloudflare account** at https://dash.cloudflare.com/sign-up
2. **Install Wrangler** (the Workers CLI) and log in:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. **Create the KV namespace** that backs the ledger and audit trail:
   ```bash
   wrangler kv namespace create GOVERNANCE
   ```
   Copy the returned `id` into `wrangler.toml` (replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`).
4. **Deploy:**
   ```bash
   wrangler deploy
   ```
   Wrangler prints a URL like `https://agent-spend-governance.<you>.workers.dev`.
5. **Point the agent at your live Worker:**
   ```bash
   node agent/run.js https://agent-spend-governance.<you>.workers.dev
   ```

> Note: the Workers platform evolves quickly. If the scaffold differs from
> what `npm create cloudflare@latest` generates today, prefer the current
> generated `wrangler` config and move `src/` into it — the Worker logic is
> unchanged.

## What is real vs. stubbed

**Real:** the policy engine, the budget ledger, the audit trail, the Discovery
catalog shape, and the approve/hold/deny flow — all running on actual Workers + KV.

**Stubbed, on purpose:** Stripe identity attestation and the payment-token
exchange (see `stubbedPayment()` in `src/index.js`). The real protocol already
solves those with OAuth/OIDC and payment tokenization; re-implementing them would
add plumbing without adding product insight. The interesting question, *how
should an agent's spend be governed?*, lives entirely in the layer this project
does build. Marking the boundary explicitly is deliberate.

## API

| Method | Path         | Purpose                                            |
|--------|--------------|----------------------------------------------------|
| GET    | `/catalog`   | Discovery: services an agent can provision         |
| POST   | `/provision` | Evaluate one action against policy + ledger        |
| POST   | `/approve`   | Human releases a held action                        |
| GET    | `/ledger`    | Current spend + remaining budget                   |
| GET    | `/audit`     | Full decision history                              |
| POST   | `/reset`     | Reset ledger + audit (demo convenience)            |
