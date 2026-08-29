---
slug: foundations
id: 5tj8y4gpnkjl
type: challenge
title: Foundations
teaser: Orientation for the Platform Extension Expert labs.
notes:
- type: text
  contents: |-
    PLACEHOLDER CONTENT. Module 1's theory has not been written yet.

    This screen exists so the learning path is numbered from 1 and so the five
    hands-on labs that follow have somewhere to point back to.
difficulty: basic
timelimit: 600
enhanced_loading: null
---

# Foundations

> **PLACEHOLDER.** This track is a stub. Module 1's theory content is still to be
> written, and this file should be replaced wholesale when it is. Nothing below is
> finished copy.

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

## Before you start

Nothing to install. Each lab provisions its own environment, with Mattermost, the
mock feed, your handler, and an editor already running.

---

*Continue to **Platform Extensions 2: Incoming Webhooks**.*
