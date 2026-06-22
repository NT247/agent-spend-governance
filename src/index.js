/**
 * Agent Spend Governance Worker
 * -----------------------------
 * A Cloudflare Worker that sits between an agent and the provisioning/payment
 * step described in Cloudflare's "agents can now create accounts, buy domains,
 * and deploy" protocol (Discovery / Authorization / Payment).
 *
 * It implements the piece that protocol leaves blunt today: governance of spend.
 * The shipped default is a flat $100/month cap. This Worker replaces that single
 * number with an inspectable policy engine, a persisted budget ledger, and an
 * audit trail of every decision.
 *
 * Endpoints:
 *   GET  /catalog              -> Discovery: the services an agent can provision
 *   POST /provision            -> evaluate one action against policy + ledger
 *   POST /approve              -> a human approves a previously held action
 *   GET  /ledger               -> current month-to-date spend + remaining budget
 *   GET  /audit                -> the full decision log
 *   POST /reset                -> reset ledger + audit (demo convenience)
 *
 * WHAT IS REAL: the policy engine, the budget ledger, the audit trail, the
 *   Discovery catalog shape, and the approve/hold/deny decision flow.
 * WHAT IS STUBBED (and clearly marked): Stripe identity attestation and the
 *   payment-token exchange. Those are deliberately out of scope so the project
 *   stays focused on the product judgment — the governance layer — rather than
 *   re-implementing OAuth/OIDC and payment tokenization, which the real protocol
 *   already handles. See `stubbedPayment()` below.
 */

import { evaluate, VERDICT, DEFAULT_POLICY } from "./policy.js";
import catalog from "./catalog.js";

const LEDGER_KEY = "ledger:current";
const AUDIT_PREFIX = "audit:";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (request.method === "GET" && pathname === "/catalog") {
        return json({ services: catalog });
      }
      if (request.method === "GET" && pathname === "/ledger") {
        return json(await readLedger(env));
      }
      if (request.method === "GET" && pathname === "/audit") {
        return json({ entries: await readAudit(env) });
      }
      if (request.method === "POST" && pathname === "/provision") {
        return await handleProvision(request, env);
      }
      if (request.method === "POST" && pathname === "/approve") {
        return await handleApprove(request, env);
      }
      if (request.method === "POST" && pathname === "/reset") {
        await env.GOVERNANCE.put(LEDGER_KEY, JSON.stringify({ spentUsd: 0 }));
        await clearAudit(env);
        return json({ ok: true, message: "Ledger and audit reset." });
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },
};

async function handleProvision(request, env) {
  const action = await request.json();
  // action: { service, label, amountUsd, category, recurring }

  const ledger = await readLedger(env);
  const decision = evaluate(action, ledger, DEFAULT_POLICY);

  // Only an APPROVE on a paid action moves the ledger. HOLD and DENY do not spend.
  if (decision.verdict === VERDICT.APPROVE && (action.amountUsd || 0) > 0) {
    ledger.spentUsd = decision.projectedSpendUsd;
    await writeLedger(env, ledger);

    // STUB: in the real protocol, an approved paid action would now exchange the
    // Stripe payment token and call the provider API. We record what *would* happen.
    decision.payment = stubbedPayment(action);
  }

  const entry = {
    ts: new Date().toISOString(),
    action,
    verdict: decision.verdict,
    reason: decision.reason,
    spentAfterUsd: ledger.spentUsd,
    remainingUsd: round2(DEFAULT_POLICY.monthlyBudgetUsd - ledger.spentUsd),
  };
  await appendAudit(env, entry);

  return json({ decision, ledger: summarize(ledger) });
}

async function handleApprove(request, env) {
  // A human approving a held action. In a full build this would look up the held
  // action by id; for the demo we accept the action payload directly and apply it
  // if it still fits the budget.
  const action = await request.json();
  const ledger = await readLedger(env);
  const amount = round2(action.amountUsd || 0);
  const remaining = round2(DEFAULT_POLICY.monthlyBudgetUsd - ledger.spentUsd);

  if (amount > remaining) {
    return json({
      decision: {
        verdict: VERDICT.DENY,
        reason: "Human approved, but charge now exceeds remaining budget.",
      },
      ledger: summarize(ledger),
    });
  }

  ledger.spentUsd = round2(ledger.spentUsd + amount);
  await writeLedger(env, ledger);
  const payment = stubbedPayment(action);

  await appendAudit(env, {
    ts: new Date().toISOString(),
    action,
    verdict: "approve",
    reason: "Approved by human after being held.",
    humanApproved: true,
    spentAfterUsd: ledger.spentUsd,
    remainingUsd: round2(DEFAULT_POLICY.monthlyBudgetUsd - ledger.spentUsd),
  });

  return json({ decision: { verdict: VERDICT.APPROVE, reason: "Approved by human.", payment }, ledger: summarize(ledger) });
}

/**
 * STUB. The real protocol exchanges a Stripe payment token and calls the provider
 * (Cloudflare) API to actually provision. We intentionally do not implement that
 * here. This returns a marker so the audit trail and demo show where the real
 * call would occur, without pretending to make it.
 */
function stubbedPayment(action) {
  return {
    stubbed: true,
    note: "Payment token exchange + provider provisioning happens here in the real protocol.",
    wouldChargeUsd: round2(action.amountUsd || 0),
  };
}

async function readLedger(env) {
  const raw = await env.GOVERNANCE.get(LEDGER_KEY);
  if (!raw) return { spentUsd: 0 };
  try { return JSON.parse(raw); } catch { return { spentUsd: 0 }; }
}
async function writeLedger(env, ledger) {
  await env.GOVERNANCE.put(LEDGER_KEY, JSON.stringify(ledger));
}
function summarize(ledger) {
  return {
    monthlyBudgetUsd: DEFAULT_POLICY.monthlyBudgetUsd,
    spentUsd: round2(ledger.spentUsd),
    remainingUsd: round2(DEFAULT_POLICY.monthlyBudgetUsd - ledger.spentUsd),
  };
}

async function appendAudit(env, entry) {
  const key = AUDIT_PREFIX + entry.ts + ":" + Math.random().toString(36).slice(2, 7);
  await env.GOVERNANCE.put(key, JSON.stringify(entry));
}
async function readAudit(env) {
  const list = await env.GOVERNANCE.list({ prefix: AUDIT_PREFIX });
  const entries = [];
  for (const k of list.keys) {
    const raw = await env.GOVERNANCE.get(k.name);
    if (raw) entries.push(JSON.parse(raw));
  }
  return entries.sort((a, b) => a.ts.localeCompare(b.ts));
}
async function clearAudit(env) {
  const list = await env.GOVERNANCE.list({ prefix: AUDIT_PREFIX });
  for (const k of list.keys) await env.GOVERNANCE.delete(k.name);
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
