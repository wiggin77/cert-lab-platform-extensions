---
slug: foundations
id: 5tj8y4gpnkjl
type: challenge
title: Foundations
teaser: Orientation for the Platform Extension Expert labs.
notes:
- type: text
  contents: |-
    A simulated cyber threat intelligence feed needs to post alerts into Mattermost.

    Over the five labs that follow you build the integration that receives them, and
    keep extending it until it can escalate, enrich, and render them.
difficulty: basic
timelimit: 600
enhanced_loading: null
---

# Foundations

## The scenario

A simulated cyber threat intelligence feed needs to post alerts into Mattermost.

Right now it has nowhere to send them, and nothing formats them. Alerts either arrive
as an unreadable line of plain text, or not at all.

Across the five labs that follow you build the integration that fixes that, one
Mattermost extension surface at a time. Each module adds a capability the previous one
could not provide, against the same running scenario: by the end, a CRITICAL alert
lands formatted in `~alerts`, escalates itself to `~incidents`, can be enriched on
demand, carries a working Escalate button, and renders through a custom interface you
wrote in Go.

## The certification path

Six modules, numbered to match the curriculum. This is Module 1. The five that follow
are separate tracks, each with its own sandbox:

| Track | Surface | What you build |
| --- | --- | --- |
| 2 | Incoming webhooks | Alerts arrive in `~alerts` as formatted attachments |
| 3 | Outgoing webhooks | CRITICAL alerts auto-escalate to `~incidents` |
| 4 | Slash commands | `/threat <indicator>` returns enrichment |
| 5 | Post actions and dialogs | An Escalate button opens a form |
| 6 | Plugins | A Go plugin, its HTTP API, and a custom interface |

## How the labs work

A simulated cyber threat intelligence feed posts alerts into Mattermost. Across the
five labs you extend one integration codebase to react to those alerts, adding a
capability per module that the previous one could not provide.

**Take them in order.** Each lab starts with the previous modules' work already in
place, so you can begin a later one without having finished an earlier one, but the
concepts build on each other.

**You are graded on behaviour, not on source.** Each check fires a real alert and
inspects what Mattermost actually did with it. You can re-run a check as often as you
like, and a Lab Inspector tab shows you every request in both directions, live.

## What is yours, and what is scaffolding

Each lab comes with a rig around it. **None of the rig is what you are being assessed
on**, and you never have to build or understand any of it. It stands in for the systems
a real integrator would already own before they ever opened the Mattermost docs.

**Yours, and the only code you write:**

| Path | Modules |
| --- | --- |
| `/home/learner/handler` | 2 to 5. A small service that receives Mattermost's calls and calls back. |
| `/home/learner/plugin` | 6. A Go plugin that runs inside the Mattermost server. |

**The rig, standing in for your own systems:**

- **The threat feed.** In production this is your SIEM, your alerting platform, your
  ticketing system: whatever already has events worth putting into Mattermost. Here it
  is a mock, and you fire it by hand rather than waiting for a real incident:

      fire-alert.sh --severity CRITICAL
      fire-alert.sh --indicator 203.0.113.47

- **The enrichment API and the AI service.** A threat intelligence lookup and an
  OpenAI-compatible endpoint, both mocked so the labs need no accounts, keys or
  network egress. Real ones would be a vendor API and a real model.

- **The wiring helpers.** When Mattermost generates a URL or a token for an
  integration, something on your side has to be told about it. In production that is
  your config management. Here it is one command:

      lab-set-webhook '<the URL Mattermost gave you>'
      lab-set-token outgoing '<the token Mattermost gave you>'

- **The Lab Inspector.** A tab showing every request in both directions, live. There
  is no equivalent in production, and that is the point: it exists so you can see what
  Mattermost actually sent you and what you actually sent back, instead of guessing.

So when an instruction says to run `fire-alert.sh`, read it as "pretend a real alert
just arrived". The skill being taught is what Mattermost does with it and how you
extend Mattermost to respond, never how the feed itself works.

## Before you start

Nothing to install. Each lab provisions its own environment, with Mattermost, the
mock feed, your handler, and an editor already running.

---

*Continue to **Platform Extensions 2: Incoming Webhooks**.*
