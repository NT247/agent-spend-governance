/**
 * Discovery catalog.
 *
 * Mirrors the shape of `stripe projects catalog` from the Cloudflare/Stripe
 * Projects protocol: a list of provisionable services an agent can choose from,
 * each with the pricing metadata the governance layer needs to make a decision.
 *
 * The `category` and `recurring` fields are what let the policy engine reason
 * about an action. The shipped protocol exposes price; it does not expose a
 * structured sense of "what kind of charge is this," which is exactly what
 * governance needs. Adding that structure here is part of the point.
 */
export default [
  {
    service: "cloudflare/registrar:domain",
    label: "Register a domain",
    category: "domain",
    recurring: false,
    // Domain prices vary by TLD; the agent passes the concrete amount at request time.
    exampleAmountUsd: 10.44,
  },
  {
    service: "cloudflare/r2:bucket",
    label: "Create an R2 storage bucket",
    category: "storage",
    recurring: false,
    exampleAmountUsd: 0,
  },
  {
    service: "cloudflare/workers:paid",
    label: "Workers Paid subscription",
    category: "subscription",
    recurring: true,
    exampleAmountUsd: 5.0,
  },
  {
    service: "cloudflare/workers-ai:inference",
    label: "Workers AI inference (usage-based)",
    category: "usage",
    recurring: true,
    exampleAmountUsd: 0,
  },
];
