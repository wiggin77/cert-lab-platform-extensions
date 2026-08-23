---
slug: incoming-webhooks
id: y4lxcwyswyzs
type: challenge
title: Incoming Webhooks
teaser: Get a simulated threat feed posting formatted alerts into a Mattermost channel.
notes:
- type: text
  contents: |-
    A simulated threat intelligence feed needs to post alerts into Mattermost.

    Right now it has nowhere to send them, and nothing formats them. Alerts either
    arrive as an unreadable line of plain text, or not at all.

    In this challenge you create the incoming webhook and write the payload that
    turns a raw alert into something an analyst can triage at a glance.
tabs:
- id: 2lq9umknucov
  title: Mattermost
  type: service
  hostname: mattermost
  port: 8065
- id: 6xlnq463x5pz
  title: Editor
  type: code
  hostname: workbench
  path: /home/learner/handler
- id: dpqeqsufpv2n
  title: Lab Inspector
  type: service
  hostname: workbench
  path: /inspector
  port: 4000
- id: v5frq8cil2hj
  title: Terminal
  type: terminal
  hostname: workbench
difficulty: basic
timelimit: 2400
enhanced_loading: null
---

An incoming webhook is how an outside system pushes a message into Mattermost. It is
system-push only: there is no user interaction, no `trigger_id`, and it cannot open a
dialog. For pushing alerts in, it is exactly the right tool.

# Your task

## 1. Sign in to Mattermost

Open the **Mattermost** tab and sign in:

| | |
|---|---|
| Username | `analyst` |
| Password | `Password123!` |

You have system admin rights, so the Integrations menu is available. The same account is
used for every challenge in the track.

## 2. Create the incoming webhook

From the main menu, go to **Integrations > Incoming Webhooks > Add Incoming Webhook**.

**Channel** is the only field that matters: set it to **Alerts**. Title, Description,
Username, Profile Picture and *Lock to this channel* are all optional, and Mattermost will
save without them. Give it a Title if you like, then **Save**.

Mattermost shows you the webhook URL once. Copy it, then open the **Terminal** tab and
register it with the feed:

```bash
sudo lab-set-webhook '<paste the URL here>'
```

Keep the quotes. The URL in your browser is a public address and the feed calls it from
inside the sandbox, so `lab-set-webhook` rewrites it to the internal one and tells you it
did. It then posts a test message, so you should see something land in **~alerts**
immediately.

## 3. Format the payload

Open the **Editor** tab and edit `src/payloads/alert-payload.ts`. The feed calls
`buildAlertPayload()` for every alert and posts whatever you return.

Return a message **attachment** carrying:

- **Colour bar** by severity: red for `CRITICAL`, amber for `HIGH`, blue for `INFO`
- **Fields** titled exactly `Severity`, `Source`, `Indicator`, and `Timestamp`
- **Fallback text**, which is what appears in a push notification

Helpers are available in `src/lib/attachments.ts` if you want them. Writing the object
by hand is equally fine.

## 4. Watch it arrive

```bash
fire-alert.sh --severity CRITICAL
```

Then look at **~alerts**. If nothing appears, open the **Lab Inspector** tab: it shows
whether the feed reached your webhook and what Mattermost said back.

# Worth knowing

`fallback` is the most commonly skipped part of the format. Leave it empty and your
notifications are blank, which is worse than useless to someone on call.

The attachment format you write here is the same one used by outgoing webhook responses,
slash command responses, and REST posts. You learn it once and reuse it for the rest of
the track.
