/**
 * Policy engine tests.
 *
 * Plain Node, no framework, so it runs anywhere with `node test/policy.test.js`.
 * Each case states the scenario, the expected verdict, and why — the same
 * structure you'd want in an eval suite for an agent: inputs, expected behavior,
 * and a readable rationale so a reviewer can audit the judgment, not just the pass/fail.
 */
import { evaluate, VERDICT, DEFAULT_POLICY } from "../src/policy.js";

let passed = 0, failed = 0;
function check(name, got, want) {
  if (got === want) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}\n       got "${got}" want "${want}"`); }
}

// Free action -> always approve, regardless of spend.
check(
  "free service approves even at high spend",
  evaluate({ amountUsd: 0, category: "storage" }, { spentUsd: 95 }).verdict,
  VERDICT.APPROVE
);

// Cheap one-time domain under threshold -> auto-approve.
check(
  "cheap one-time domain auto-approves",
  evaluate({ amountUsd: 10.44, category: "domain", recurring: false }, { spentUsd: 0 }).verdict,
  VERDICT.APPROVE
);

// One-time charge over the $20 threshold but within budget -> hold for human.
check(
  "pricey one-time charge is held",
  evaluate({ amountUsd: 34, category: "domain", recurring: false }, { spentUsd: 0 }).verdict,
  VERDICT.HOLD
);

// Recurring charge, even if tiny -> hold for human (compounding risk).
check(
  "small recurring charge is held",
  evaluate({ amountUsd: 5, category: "subscription", recurring: true }, { spentUsd: 0 }).verdict,
  VERDICT.HOLD
);

// Charge that exceeds remaining budget -> deny, even if category would auto-approve.
check(
  "over-budget cheap-category charge is denied",
  evaluate({ amountUsd: 15, category: "domain", recurring: false }, { spentUsd: 90 }).verdict,
  VERDICT.DENY
);

// Budget check beats category: an $18 domain would auto-approve, but not if only $10 remains.
check(
  "budget hard limit beats auto-approve threshold",
  evaluate({ amountUsd: 18, category: "domain", recurring: false }, { spentUsd: 90 }).verdict,
  VERDICT.DENY
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
