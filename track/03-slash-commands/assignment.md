---
slug: slash-commands
id: frfuuczcsjy7
type: challenge
title: Slash Commands
teaser: Build /threat, an on-demand IOC lookup an analyst can run mid-triage.
notes:
- type: text
  contents: |-
    An analyst spots an indicator in an alert, an IP, a domain, or a file hash, and
    needs to know what is already known about it before deciding how to respond.

    Everything so far has been automatic. This is the first surface the analyst
    drives, and the first one with a hard deadline: Mattermost gives a slash command
    five seconds to reply, and a threat intel lookup can outlast that.
tabs:
- id: aiyrennx6yt0
  title: Mattermost
  type: service
  hostname: mattermost
  port: 8065
- id: ticdwyq1swj7
  title: Editor
  type: service
  hostname: workbench
  port: 8080
  path: /?folder=/home/learner/handler
- id: otqoumdb0uzc
  title: Lab Inspector
  type: service
  hostname: workbench
  path: /inspector
  port: 4000
- id: 1an9mm6pf4yg
  title: Terminal
  type: terminal
  hostname: workbench
difficulty: intermediate
timelimit: 2400
enhanced_loading: null
---

# Your task

## 1. Register the command

**Integrations > Slash Commands > Add Slash Command**:

| Field | Value |
|---|---|
| Command Trigger Word | `threat` |
| Request URL | `http://workbench:4000/commands/threat` |
| Request Method | `POST` |

Copy the **token**, switch to the **Terminal** tab, and register it:

```bash
sudo lab-set-token command '<paste the token here>'
```

## 2. Implement the handler

Edit `src/routes/threat-command.ts`. The shape that matters:

1. **Validate** the token.
2. **Acknowledge immediately**, ephemerally, naming the indicator. Do not await the
   lookup before replying.
3. **Then** query `${INTEL_API_URL}/indicators/<indicator>` and deliver the result,
   either by posting with the bot token or by POSTing to `payload.response_url`.

Include fields for malware family, confidence score, last seen, and associated
campaigns.

## 3. Test it

In the **Mattermost** tab, in `~alerts`:

```
/threat 203.0.113.47
```

Not every indicator is known. Try `198.51.100.23`, which the API does not hold, and make
sure your handler says so cleanly rather than returning an error. To browse the full set,
switch to the **Terminal** tab:

```bash
curl $LABSVC_URL/mock/intel/v1/_catalog | jq
```

# Worth knowing

**`response_type` accepts `ephemeral` or `in_channel`, and nothing else.** Anything else
is rejected outright.

**The Lab Inspector shows how long your handler took** on every call, and flags it when
you run over budget. Use it rather than guessing: this is the one lesson in the track
where the failure is invisible from the Mattermost side until it is too late.

**`response_url` is short lived** but needs no bot token, which is what makes it useful
for a delayed reply.
