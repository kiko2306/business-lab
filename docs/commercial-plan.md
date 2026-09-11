# Commercial plan

The business side of a turnkey deployment (P12, §84.5): what's sold, how
it's priced, how long onboarding takes, and what a client can count on.
This is a **template** — the structure and reasoning are decided, the
actual € figures are marked and left for whoever's pricing a real
engagement to fill in. Nothing here is sensitive on its own; it's public
alongside the rest of `docs/` the same way
[data-protection-position.md](data-protection-position.md) is — policy and
structure, not filled-in client numbers.

## What's sold

Per [the README](../README.md#what-it-is-and-how-its-sold): the software is
free. What's sold is **service** — domain management, custom configuration,
server maintenance — with turnkey hardware optional alongside it.

| Pillar | Covers |
|---|---|
| **Domain management** | The Cloudflare account, DNS, Tunnel, Zero Trust policies |
| **Custom configuration** | Standing up the app set an office needs, wiring it to their accounts |
| **Server maintenance** | Keeping the stack patched, backed up, healthy |

## Pricing structure

**One-time setup fee** — covers onboarding (below). Separate from the
ongoing retainer; a client pays this once, at handover.

> **Setup fee: € _____**

**Monthly retainer** — flat, not tiered or hourly. One price covers all
three service pillars, with reasonable support included — simplest to sell
and to administer for a small operation; no time-tracking, no itemized
invoices for routine work.

> **Monthly retainer: € _____ /month**

**Hardware** — optional, alongside the service. Pass-through of the
[turnkey build spec](turnkey-build-spec.md)'s cost (≈€400 today) plus
whatever markup covers sourcing/prep time:

> **Hardware: € _____** (cost ≈€400 + € _____ markup)

## Onboarding

**~1 business day of hands-on work:**

| Step | What happens |
|---|---|
| `sudo ./start.sh` + `setup_server.sh` prompts | Docker install, fixed IP, passwordless sudo, core stack up (~20 min if uneventful) |
| Cloudflare / domain wiring | Client's own Cloudflare account + API token, tunnel provisioning |
| Deployment checklist | Working **Settings → Deployment checklist** top to bottom — mail, backup destination, admin account |
| Starting the app bundle | The [turnkey build spec](turnkey-build-spec.md)'s ~14-app default bundle — most start in minutes, a few (Nextcloud, ITFlow) need a couple of settings each |
| Client accounts | Users page — one invite per staff member |
| Handoff walkthrough | Live session with the client, recovery procedure covered |

**~3–5 business days calendar time** — the gap beyond the hands-on day is
client-side coordination (DNS/domain readiness if migrating an existing
domain, scheduling the handoff session), not server time.

## Support

**Best-effort, no contracted SLA** — same shape as the [data protection
position](data-protection-position.md)'s disaster-recovery stance, for the
same reason: an honest internal response-time target (e.g. "within 1-2
business days"), not a penalty-backed contractual promise. One consistent
story across the whole offering, not a stricter commitment on support than
on DR.

## If a client stops paying

**Nothing happens to their system.** Each client holds their own Cloudflare
account and domain (§84.7) and owns the hardware outright — there's nothing
to hand back or migrate. Stopping payment ends the support relationship,
not the box: it keeps running exactly as it did, on infrastructure that was
always theirs. No data hostage situation, because there was never anything
to hold.

## What this doesn't cover

- **Actual pricing numbers** — a real business decision, deliberately left
  blank above rather than inventing plausible-sounding figures.
- **Legal contract language** — a service agreement, SLA wording, etc. needs
  real drafting against a real jurisdiction; this doc is the structure that
  drafting should reflect, not the contract itself.
- **Licence due diligence** — tracked separately in
  [licences.md](licences.md).
