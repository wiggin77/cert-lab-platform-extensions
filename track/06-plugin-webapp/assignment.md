---
slug: plugin-webapp
id: tv7iayaxa83k
type: challenge
title: Plugin Development, Webapp Side
teaser: Replace alert rendering with a custom post card, a sidebar pane, and AI skills.
notes:
- type: text
  contents: |-
    The server half is storing alerts and answering questions about them. Nothing in
    the interface has changed yet.

    This challenge replaces alert rendering entirely: a custom post card instead of a
    message attachment, a sidebar pane for full detail and status changes, AI-powered
    analysis, and a live open alert count in the channel header.
tabs:
- id: mowaqjeoi6vl
  title: Mattermost
  type: service
  hostname: mattermost
  port: 8065
- id: dhpjn9wepubk
  title: Editor
  type: service
  hostname: workbench
  port: 8080
  path: /?folder=/home/learner/plugin/webapp
- id: 9p3epr5ihqm9
  title: Lab Inspector
  type: service
  hostname: workbench
  path: /inspector
  port: 4000
- id: que0njogylnt
  title: Terminal
  type: terminal
  hostname: workbench
difficulty: advanced
timelimit: 1800
enhanced_loading: null
---

The webpack config, registry entry point, component stubs, and an HTTP client helper are
already wired. You do not touch the build config.

# Your task

## 1. Custom post card

`registerPostTypeComponent` renders posts of a given type as a fully custom React
component. This is not attachment formatting with extra steps: you own the whole render.

Show severity colour, source, indicator, and timestamp, plus a **View Details** button
that opens the sidebar pane.

## 2. Right hand sidebar pane

`registerRightHandSidebarComponent` gives you a persistent panel that can be opened from
a post action.

- Fetch the KV record on open, using the `GET` endpoint from the previous challenge
- Display every alert field
- A status selector that calls your `POST .../status` endpoint and re-fetches on change

## 3. AI skills

This one has a server half. Add two buttons to the pane, **Analyze Threat Surface** and
**Suggest Remediation**, and write the endpoint they call in `server/analyze.go`. Its
route is already registered, and `p.llmCompletion` in `server/agents.go` handles talking
to the Agents plugin, so what is left to you is the prompt and the reply.

Build the prompt from the alert fields and post the answer as a **threaded reply under the
original alert**. Show a loading state in the pane while the call is in flight, because
these are not instant.

## 4. Channel header widget

`registerChannelHeaderButtonAction` is always visible. Show the open alert count from
`GET /api/v1/alerts/count`, and update it when an alert is acknowledged in the pane.

## 5. Build and deploy

In the **Terminal** tab:

```bash
cd /home/learner/plugin
make deploy
```

# Worth knowing

**Server and webapp are separate processes.** The webapp cannot read the KV Store. Every
piece of data it shows arrives over an HTTP endpoint you wrote in the previous challenge,
which is why that one came first.

**A threaded reply needs `root_id` set** to the alert's post id. Without it the AI
response lands at channel root, detached from the alert it is about.

**Reload the browser tab after `make deploy`.** The webapp bundle is cached, and a stale
bundle looks exactly like code that does not work.

**The post card and the pane never see each other.** They are rendered in different parts
of the app, so "which alert is selected" cannot live in either one's props. Register a
small reducer with `registerReducer` and keep it there. Mattermost namespaces your state
under `plugins-<your plugin id>`.

**Wording your prompt changes the answer you get.** The lab's LLM is deterministic and
picks its response from cues in the text, so asking an "analyse" question with words like
fix, respond, or next steps returns remediation advice instead. Real models are less
literal about this but not immune to it.
