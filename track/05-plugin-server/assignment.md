---
slug: plugin-server
id: j9ys8y4eff9w
type: challenge
title: Plugin Development, Server Side
teaser: Intercept alerts in Go, store them in the KV Store, and expose them over HTTP.
notes:
- type: text
  contents: |-
    Everything so far has worked from outside Mattermost, reacting to it over HTTP.
    There is a ceiling to that. You cannot change how a message renders, add a
    sidebar, or put a widget in the channel header from a webhook.

    A plugin runs inside Mattermost. This challenge builds its server half: a hook
    that sees every post, persistent storage, and HTTP endpoints for the webapp half
    to call.

    The next challenge is locked until this one passes.
tabs:
- id: rnucjsxyrrvq
  title: Mattermost
  type: service
  hostname: mattermost
  port: 8065
- id: ymc6wtx80ayy
  title: Editor
  type: code
  hostname: workbench
  path: /home/learner/plugin
- id: fizaii2l5pkg
  title: Lab Inspector
  type: service
  hostname: workbench
  path: /inspector
  port: 4000
- id: b4pd3lxtue2n
  title: Terminal
  type: terminal
  hostname: workbench
difficulty: advanced
timelimit: 1800
enhanced_loading: null
---

The scaffold in `/home/learner/plugin` has the manifest, folder structure, build script,
KV helpers, and `OnActivate` / `OnDeactivate` stubs already in place. You write the hook,
the parsing, and the endpoints.

# Your task

## 1. Capture alerts

Register a `MessageHasBeenPosted` hook. For posts in `~alerts`:

- Parse severity, source, indicator, and timestamp out of the post props. The values
  live in `props.attachments[0].fields`, not in the message text.
- Write a KV record keyed to the post id, with those fields and `status: "open"`.

Filter on the **channel id**, not the channel name. The name is a display value and
comparing it will bite you.

## 2. Expose the endpoints

Register these on your plugin's sub-router:

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/v1/alert/{postID}` | return the KV record as JSON |
| `POST` | `/api/v1/alert/{postID}/status` | accept a new status, write it back |
| `GET` | `/api/v1/alerts/count` | return `{"open": <number>}` |

The count endpoint is what the channel header widget reads in the next challenge. Count
records at status `open` rather than caching a value at activation, or it will drift.

## 3. Build and deploy

```bash
cd /home/learner/plugin
make deploy
```

Then fire an alert and check your work:

```bash
fire-alert.sh --severity CRITICAL
```

# Worth knowing

**Plugin endpoints live at `/plugins/{plugin_id}/...`**, on the root router. They are not
under `/api/v4`.

**The KV Store is the only persistence you get** without standing up your own database.
It is cluster-aware, so it works in a high availability deployment, which a local file
would not.

**Read, modify, write the whole record** when updating status. Writing a partial record
back over the key drops the rest of the fields.
