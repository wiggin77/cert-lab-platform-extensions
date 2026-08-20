---
slug: outgoing-webhooks
id: x8dvxwnzlm02
type: challenge
title: Outgoing Webhooks
teaser: Auto-escalate CRITICAL alerts to the incident channel with no analyst action.
notes:
- type: text
  contents: |-
    Alerts are landing in ~alerts and they look right. Nobody is watching that
    channel at 3am.

    A CRITICAL alert needs to reach the on-call team without waiting for an analyst
    to notice it. That means Mattermost has to call you when something matches, not
    the other way round.

    This challenge wires an outgoing webhook and writes the handler that escalates.
tabs:
- id: 08qujayercun
  title: Mattermost
  type: service
  hostname: workbench
  port: 8065
- id: e8qzzypo9h7i
  title: Editor
  type: code
  hostname: workbench
  path: /home/learner/handler
- id: poowj5xabgza
  title: Lab Inspector
  type: service
  hostname: workbench
  path: /inspector
  port: 4000
- id: qumzdtjzftuv
  title: Terminal
  type: terminal
  hostname: workbench
difficulty: intermediate
timelimit: 2400
enhanced_loading: null
---

An incoming webhook pushes data in. An outgoing webhook is the reverse: Mattermost calls
your endpoint when a message matches a trigger word you configure.

# Your task

## 1. Create the outgoing webhook

**Integrations > Outgoing Webhooks > Add Outgoing Webhook**:

| Field | Value |
|---|---|
| Content Type | `application/x-www-form-urlencoded` |
| Channel | `~alerts` |
| Trigger Words | `CRITICAL` |
| Callback URLs | `http://workbench:4000/hooks/outgoing` |

Then copy the **token** it shows you and register it:

```bash
sudo lab-set-token outgoing '<paste the token here>'
```

## 2. Handle the callback

Edit `src/routes/outgoing-webhook.ts`:

1. **Reject** any request whose token does not match. Use `isValidToken()` from
   `src/lib/verify.ts`, not `===`.
2. **Fetch** the triggering post with `getPost(payload.post_id)` and pull the alert
   fields out with `parseAlertFromProps()`. The structured values live in the
   attachment, not in `payload.text`.
3. **Post** an escalation to `~incidents` carrying the alert source, indicator,
   severity, and a `permalink()` back to the original message.

## 3. Test it

```bash
fire-alert.sh --severity CRITICAL
```

# Worth knowing

**The callback URL must be `workbench`, not `localhost` and not the browser address bar
URL.** Mattermost calls it from the server process, so it needs an address that resolves
there.

**The trigger word matches at the start of a message**, not anywhere inside it. This
surprises people.

**There is no signature to verify.** Mattermost sends a plaintext shared token in the
request body. That token is the entire security model for this surface, which is why
comparing it in constant time matters: a plain `===` returns as soon as it hits a
differing byte, and how long that takes leaks how much of the token an attacker guessed.

**Threads cannot span channels.** Your escalation lives in `~incidents` and the alert
lives in `~alerts`, so a reply cannot join them. A permalink is how you point across.
