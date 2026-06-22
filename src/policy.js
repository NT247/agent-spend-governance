/**
 * Policy engine for agent spend governance.
 *
 * This is the heart of the project. It is deliberately separated from the
 * Worker request plumbing so it can be reasoned about, tested, and explained
 * on its own. Every decision returns a machine-readable verdict AND a
 * human-readable reason, because an agent acting autonomously needs both:
 * the verdict to act on, and the reason for the audit trail a human reviews later.
 *
 * Design stance: the default $100/month flat cap that ships today treats every
 * dollar as identical. It is not. A one-time $10 domain and a $10/month recurring
 * subscription have very different long-run consequences, and a human's tolerance
 * for "approve without asking me" differs by category, by amount, and by how much
 * budget is left. This engine encodes that judgment as explicit, inspectable rules
 * rather than a single number.
 */

export const VERDICT = {
  APPROVE: "approve",
  HOLD: "hold",     // requires human approval before proceeding
  DENY: "deny",     // refused outright; agent should not retry without a budget change
};

/**
 * A policy is a set of rules evaluated in order. The first rule that matches
 * decides the verdict. Order matters: hard limits (budget) come before
 * discretionary thresholds (category auto-approve), so we never auto-approve
 * something we cannot afford.
 *
 * This default policy is intentionally small and opinionated. The point is not
 * to be exhaustive; it is to show that governance is a set of legible decisions,
 * not a magic number.
 */
export const DEFAULT_POLICY = {
  monthlyBudgetUsd: 100,

  // One-time charges at or below this auto-approve (per category).
  autoApproveThresholdUsd: 20,

  // Categories whose charges recur. Recurring spend compounds month over month,
  // which is the failure mode humans actually get burned by ("why am I paying
  // $400/mo?"), so recurring charges always route to a human regardless of size.
  recurringCategories: ["subscription", "plan", "seat"],

  // Free actions (no spend) always pass; we still log them for the audit trail.
  // (handled in code, not as a rule, because $0 is unambiguous.)
};

/**
 * Evaluate a single provisioning action against the policy and current ledger state.
 *
 * @param {Object} action  { service, label, amountUsd, category, recurring }
 * @param {Object} state   { spentUsd }  current month-to-date spend
 * @param {Object} policy  a policy object (defaults to DEFAULT_POLICY)
 * @returns {Object} { verdict, reason, projectedSpendUsd }
 */
export function evaluate(action, state, policy = DEFAULT_POLICY) {
  const remaining = round2(policy.monthlyBudgetUsd - state.spentUsd);
  const amount = round2(action.amountUsd || 0);

  // Free actions: always allowed, never affect the ledger.
  if (amount === 0) {
    return {
      verdict: VERDICT.APPROVE,
      reason: "Free service; no spend impact.",
      projectedSpendUsd: state.spentUsd,
    };
  }

  // Hard limit: never approve something that exceeds the remaining budget.
  // This is checked before any discretionary rule so a cheap-looking category
  // can never sneak past the cap.
  if (amount > remaining) {
    return {
      verdict: VERDICT.DENY,
      reason: `Charge of $${amount.toFixed(2)} exceeds remaining budget of $${remaining.toFixed(2)}.`,
      projectedSpendUsd: state.spentUsd,
    };
  }

  // Recurring charges always need a human, regardless of amount. A small monthly
  // fee is the thing most likely to quietly compound into a surprise bill.
  const isRecurring = action.recurring === true ||
    policy.recurringCategories.includes(action.category);
  if (isRecurring) {
    return {
      verdict: VERDICT.HOLD,
      reason: "Recurring charge; held for human approval because recurring spend compounds over time.",
      projectedSpendUsd: state.spentUsd,
    };
  }

  // One-time charge under the auto-approve threshold: let the agent proceed.
  if (amount <= policy.autoApproveThresholdUsd) {
    return {
      verdict: VERDICT.APPROVE,
      reason: `One-time charge of $${amount.toFixed(2)} is within the $${policy.autoApproveThresholdUsd} auto-approve threshold.`,
      projectedSpendUsd: round2(state.spentUsd + amount),
    };
  }

  // One-time charge over the threshold but within budget: affordable, but large
  // enough that a human should sign off.
  return {
    verdict: VERDICT.HOLD,
    reason: `One-time charge of $${amount.toFixed(2)} is over the $${policy.autoApproveThresholdUsd} auto-approve threshold; held for human approval.`,
    projectedSpendUsd: state.spentUsd,
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
