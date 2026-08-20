# Lab Services Server

Design for the supporting server behind the **Mattermost Platform Extension Expert**
certification track, hosted on Instruqt.

Status: draft, for review
Source curriculum: *Mattermost Certification, Platform Extension Expert, Track Overview v0.5*

---

## 1. What this server actually has to be

Reading the curriculum's six modules, "the server" is being asked to play five distinct
roles. Naming them separately is the main structural decision, because they have opposite
requirements.

| Role | Used by | Must be |
| --- | --- | --- |
| **Learner handler** | Modules 3, 4, 5 | Freely editable, freely breakable, hot reloaded |
| **Mock threat feed** | Modules 2 to 6 | Deterministic, pausable, on demand |
| **Mock threat intel API** | Module 4 | Deterministic, keyed fixtures, includes a 404 case |
| **Mock LLM** | Module 6 | OpenAI compatible, deterministic, no API key cost |
| **Grader and inspector** | All labs | Tamper resistant relative to the handler, always up |

Roles 2 to 5 are lab infrastructure and must survive the learner writing a syntax error.
Role 1 is the thing that breaks constantly, by design.

**They must not be the same process.**

---

## 2. Language: Node.js and TypeScript, run under `tsx`

The curriculum already commits to it ("Pre-wired Node.js handler", Module 3).
Reinforcing reasons:

- Module 6 puts learners in React and TypeScript anyway. One language across modules 3 to 6
  removes a context switch at the hardest point of the track.
- `tsx watch` gives hot reload with **no build step**, and it strips types rather than
  typechecking, so a learner's type error shows as an editor squiggle instead of a dead
  server. That is the correct failure mode for a lab.
- Types on `SubmitDialogRequest`, `PostActionIntegrationRequest`, and friends are real
  teaching value. Autocomplete on `submission` and `context` is worth more than a chapter
  of documentation.

Fastify over Express for both the handler and the lab service: first class schema
validation (useful for showing learners exactly which field was malformed), and
`content-type` handling that copes with the form encoded slash command body and the JSON
action callback in one app without middleware juggling.

Python would work, but it splits the track's languages three ways (Python, Go, React)
instead of two.

---

## 3. Topology

One Instruqt VM host, `workbench`. Not a container host: Module 6 needs the Go toolchain,
Node, webpack, and Docker together, and a VM plus a hot start snapshot boots faster than
building that image at track start.

```
Instruqt host: workbench (VM, hot start snapshot)
|
+-- docker compose
|   +-- postgres      :5432
|   +-- mattermost    :8065      <- Instruqt tab "Mattermost"
|
+-- systemd: mm-labsvc           (user: labsvc, /opt/lab)
|   +-- :4000                    <- Instruqt tab "Lab Inspector"
|
+-- systemd: mm-handler          (user: learner, /home/learner/handler)
|   +-- :3000                    tsx watch, restarts on crash
|
+-- code-server      :8080       <- Instruqt tab "Editor"
```

### 3.1 Internal versus public URLs

The URLs learners paste into Mattermost's integration configuration are called **by the
Mattermost server**, not by the browser. They must be internal:

```
http://workbench:4000/hooks/outgoing          correct
https://workbench-4000-<participant>.env.play.instruqt.com/hooks/outgoing   wrong
```

Getting this wrong is the single most common way this kind of lab breaks. The lab guide
should print the exact string to paste, and the grader should specifically detect the
public URL variant and emit a targeted hint for it.

---

## 4. Core idea: labsvc is a bidirectional recording proxy

Every byte between Mattermost and the learner's handler passes through labsvc.

```
                 +---------------- labsvc :4000 -----------------+
Mattermost  ----->  inbound proxy  ------------------------------->  handler :3000
  :8065     <-----  (records req + res, timing, status)          <--
                 |                                               |
           <-----  outbound proxy  <-------------------------------  handler
                 |  /mm/api/v4/*  ->  mattermost:8065/api/v4/*    |
                 |                                               |
                 |  journal (append only JSONL + SSE stream)      |
                 |  mocks: feed, intel, llm                       |
                 |  grader: stimulus + assertions                 |
                 |  inspector UI                                  |
                 +-----------------------------------------------+
```

Why this earns its keep:

- **Debuggability.** "My webhook isn't firing" is the number one lab support burden. The
  inspector shows, live, whether Mattermost called you at all, what it sent, what you
  returned, and how long you took. That converts the most frustrating failure mode into a
  glance.
- **Gradeable delayed responses.** The inbound proxy **rewrites the `response_url` field**
  in the slash command body to point back at labsvc before forwarding. Module 4's delayed
  response lesson becomes directly observable instead of invisible.
- **Timing.** The proxy stamps `duration_ms` on every handler call, which is what Module 4's
  timeout lesson needs to grade against.
- **No credential magic.** The outbound proxy is transparent. The learner still reads
  `process.env.MM_BOT_TOKEN` and sets the `Authorization` header themselves, exactly as
  they would in production. labsvc only observes.

### 4.1 Robustness rule

The grader treats **Mattermost state as the source of truth** and the journal as
enrichment. A learner who bypasses the proxy and calls `mattermost:8065` directly still
passes, they just get worse hints. Never grade on something only the proxy can see, except
for handler internal facts such as status codes and latency.

---

## 5. Component design

### 5.1 Mock threat feed

Two modes, and the mode switch is the thing that makes labs reliable.

- **Ambient.** Posts an alert every 60 seconds (the curriculum's requirement), seeded PRNG
  over a fixed corpus, so the sequence is reproducible per participant.
- **Scripted.** The grader picks exactly which alert fires and when.

Every alert carries `props.lab_feed_run_id` and `props.lab_alert_id`, so the grader can
tell its own stimulus apart from ambient noise. The ambient timer takes a **pause lock
during grading**, otherwise a random CRITICAL landing mid check produces flaky results.

#### Transport, a forced design decision

Posts created by an incoming webhook **do not fire outgoing webhook triggers**. Module 3
cannot work if the feed keeps using an incoming webhook. The feed therefore supports both
transports:

| Transport | Used by | Why |
| --- | --- | --- |
| `incoming_webhook` | Module 2 | Module 2's entire lesson is configuring an incoming webhook, and the learner must see their own webhook URL receive traffic |
| `bot_rest` | Modules 3 and later | Posts created via the REST API do fire trigger words |

The learner never sees the difference.

`fire-alert.sh` is a one line wrapper over `POST /mock/feed/fire`, taking optional
`--severity`, `--indicator`, and `--transport`.

### 5.2 Mock threat intel API

`GET /mock/intel/v1/indicators/{indicator}` over `fixtures/indicators.json`. Roughly 15
entries spanning IPv4, domain, and SHA256 forms, returning `malware_family`, `confidence`,
`last_seen`, and `campaigns`, matching Module 4's field list exactly.

Include deliberately:

- at least one indicator that returns **404 with a JSON error body**
- one that returns **200 with an empty `campaigns` array**

Module 4 otherwise teaches a handler that only ever sees the happy path. The grader should
require the learner handle the miss case gracefully.

Optional `?delay_ms=` so an instructor can demonstrate the slash command timeout live.

### 5.3 Mock LLM

`POST /mock/llm/v1/chat/completions`, OpenAI compatible, streaming supported (the Agents
plugin streams). Deterministic: it classifies the incoming prompt into
`analyze_threat_surface` or `suggest_remediation`, keys into `fixtures/llm-responses.json`
by `(skill, severity)`, and returns canned analysis.

This deletes a whole class of problems from Module 6:

- no LLM key baked into a public sandbox
- no per learner token cost
- no network egress, no rate limits
- deterministic text for the grader to match against
- works offline

Configure the Agents plugin with service type "OpenAI Compatible" and API URL
`http://workbench:4000/mock/llm/v1`.

**Setup gotcha:** the Agents plugin rejects a blank API key even for local services. Set a
dummy non-empty value in the track setup script.

### 5.4 Journal

Append only JSONL at `/var/lib/labsvc/journal.jsonl`, plus an in memory ring for the
inspector, plus SSE at `/api/journal/stream`.

```ts
type JournalEvent = {
    seq: number
    ts: string
    module: number
    kind: 'mm_to_handler' | 'handler_to_mm' | 'feed_fire' | 'intel_query'
        | 'llm_call' | 'grader_stimulus' | 'grader_assert' | 'admin'
    route: string
    request: {method: string; headers: Record<string, string>; body: unknown}
    response?: {status: number; headers: Record<string, string>; body: unknown}
    duration_ms?: number
    correlation_id: string
    prev_hash: string
    hash: string
}
```

Bodies are captured raw and pretty printed in the inspector. Tokens are redacted in the UI
but retained in the journal, because Module 3's whole lesson is token validation and the
grader needs to see whether a bad token was rejected.

---

## 6. Grading

### 6.1 Every check supplies its own stimulus

The most important property. A check must never depend on the learner having manually
fired the right thing at the right moment. Each check runs:

1. `pause_ambient_feed()`
2. `snapshot()`, recording a watermark timestamp
3. **stimulus**: fire a specific alert, or invoke the slash command as a test user, or
   `POST /api/v4/posts/{post_id}/actions/{action_id}` to simulate a button click
4. poll for the expected effect with a bounded timeout
5. assert against Mattermost state, enriched by the journal
6. `resume_ambient_feed()`

Checks are idempotent and re-runnable. A learner can hit Check as many times as they like.

### 6.2 Check contract

```
POST /grader/run/{module}/{challenge}
  -> {pass: boolean, checks: [{id, title, ok, detail, hint, evidence_seq?}]}
```

The Instruqt `check-workbench` script stays thin. Its stdout becomes the learner facing
failure message.

```sh
#!/usr/bin/env bash
set -euo pipefail
r=$(curl -sf -m 90 -X POST http://localhost:4000/grader/run/3/1) || {
    echo "Lab service unreachable. Run: sudo systemctl status mm-labsvc"; exit 1; }
echo "$r" | jq -r '.checks[] | (if .ok then "PASS  " else "FAIL  " end) + .title
                   + (if .ok then "" else "\n      -> " + (.hint // "") end)'
[ "$(jq -r .pass <<<"$r")" = true ]
```

### 6.3 Per module assertions

**Module 2, incoming webhooks.** An incoming webhook exists on `#alerts`. Firing the feed
through it produces a post whose `props.attachments[0]` has `color` matching severity (red,
amber, blue), `fields` containing exactly Severity, Source, Indicator, and Timestamp, and a
non-empty `fallback`.

**Module 3, outgoing webhooks.** An outgoing webhook is configured on `#alerts` with
trigger word `CRITICAL`. Stimulus fires a CRITICAL alert. Assert a new post exists in
`#incidents` carrying source, indicator, severity, and a permalink to the origin post.
Journal enrichment confirms the handler returned 200. A separate check replays the same
payload with a **deliberately wrong token** and asserts the handler rejects it. That is the
only way to grade the token validation lesson, and it is worth a dedicated check.

**Module 4, slash commands.** `/threat` is registered. Stimulus invokes it as the test user
with a known indicator. Assert an ephemeral acknowledgment came back within budget, that
`/mock/intel` was queried with the right indicator (journal), and that an enrichment
attachment landed with all four fields. A second check uses the 404 indicator and asserts a
graceful user facing message rather than a 500.

**Module 5, post actions and dialogs.** Stimulus clicks the Escalate action. Assert the
handler called `/api/v4/actions/dialogs/open` with a valid `trigger_id` and a dialog whose
elements match the spec (one select with three options, two text, one textarea). Then
submit the dialog twice: once with Severity blank, asserting a `SubmitDialogResponse` with
field level `errors`, and once valid, asserting the escalation post.

**Module 6 stage 1, server side.** `GET /plugins/{id}/api/v1/alert/{postID}` returns the
parsed KV record. `POST .../status` mutates it, and a re-GET reflects the change.

**Module 6 stage 2, webapp side.** Checked partly by the plugin's own endpoints, partly by
asserting the mock LLM was called with alert context in the prompt and that a threaded
reply appeared under the alert.

### 6.4 Integrity, stated honestly

The learner has root on the sandbox and the check script runs on their host, so grading
cannot be adversary proof. The journal is hash chained and labsvc runs as a separate user
with a root owned journal file, which defeats casual tampering and detects edits.

That is the right level. The labs are formative, the 40 question exam is the summative
gate. This should be written down internally so nobody assumes otherwise.

---

## 7. Repository layout

```
/opt/lab/labsvc/                    root owned, learner cannot edit
  src/
    server.ts
    proxy/       inbound.ts  outbound.ts  journal.ts  redact.ts
    mocks/       feed.ts  intel.ts  llm.ts
    grader/      index.ts  stimulus.ts  mmadmin.ts
                 checks/mod2.ts mod3.ts mod4.ts mod5.ts mod6.ts
    inspector/   ui/ (static)
    admin/       snapshot.ts  reset.ts  seed.ts
  fixtures/      alerts.json  indicators.json  llm-responses.json

/home/learner/handler/              learner owned
  src/
    index.ts                        Fastify app, routes pre-wired
    routes/
      outgoing-webhook.ts           module 3  <- learner fills in
      threat-command.ts             module 4  <- learner fills in
      post-action.ts                module 5  <- learner fills in
      dialog-submit.ts              module 5  <- learner fills in
    lib/
      mattermost.ts                 thin REST client, pre-wired
      attachments.ts                attachment builders, pre-wired
      types.ts                      Mattermost payload types
  .env

/home/learner/plugin/               module 6 scaffold

/opt/lab/variants/
  mod3/{starter,solution}/ ...      solve- scripts copy solution over
```

The `starter` and `solution` pair per module is what makes Instruqt's solve scripts and
regression testing possible. CI should run every solution against every check on every
commit. That is the only thing that keeps a five lab track from rotting.

---

## 8. Endpoint reference

### Inbound proxy, the URLs learners paste into Mattermost

```
POST /hooks/outgoing              ->  handler /webhooks/outgoing
POST /commands/threat             ->  handler /commands/threat
POST /actions/escalate            ->  handler /actions/escalate
POST /dialogs/escalate/submit     ->  handler /dialogs/escalate/submit
POST /hooks/commands/:id              rewritten response_url target
```

### Outbound proxy

```
ALL  /mm/api/v4/*                 ->  mattermost:8065/api/v4/*
```

### Mocks

```
POST /mock/feed/fire                     {severity?, indicator?, transport?}
POST /mock/feed/pause
POST /mock/feed/resume
GET  /mock/intel/v1/indicators/:indicator
POST /mock/llm/v1/chat/completions
```

### Journal and inspector

```
GET  /inspector
GET  /api/journal
GET  /api/journal/stream                 SSE
```

### Grader

```
POST /grader/run/:module/:challenge
GET  /grader/last/:module/:challenge
```

### Admin

```
POST /admin/snapshot
POST /admin/reset
POST /admin/seed
GET  /healthz
```

---

## 9. State lifecycle

Instruqt cleanup scripts call `POST /admin/reset?to=<snapshot_id>`, which:

- deletes posts created after the watermark
- removes integrations created during the module
- clears plugin KV
- truncates the journal

This matters because learners experiment. Without a reset between challenges, Module 5's
check trips over Module 3's leftover escalations.

---

## 10. Instruqt wiring

### Track setup

1. Start docker compose.
2. Wait on `/healthz` for Mattermost and labsvc.
3. Seed teams, channels, users, and bot tokens.
4. Install and configure the Agents plugin against the mock LLM (remember the dummy API
   key).
5. `systemctl start mm-handler`.

### Hot start snapshot

Bake in `node_modules`, the Go module cache, and a pre-built plugin bundle. The curriculum
budgets a 3 to 4 minute wait screen for Module 6's `npm install` plus webpack. Hot start
removes essentially all of it. This is the largest single UX win available in the track.

### Slash command timeout

Set `ServiceSettings.OutgoingIntegrationRequestsTimeout = 5` in the lab's `config.json`.
This value is configurable rather than hardcoded, and its default is much longer than 5
seconds. Setting it to 5 makes the curriculum's "5-second timeout" lesson literally true in
the lab environment instead of merely asserted. Grade the acknowledgment budget off the
same value via `SLASH_ACK_BUDGET_MS`.

---

## 11. Two design decisions forced by known curriculum issues

The curriculum has a number of technical inaccuracies that are tracked separately. Two of
them determine the shape of this server and cannot be deferred.

1. **Feed transport** (section 5.1). Module 3 is unsatisfiable if the feed keeps using an
   incoming webhook, because incoming webhook posts do not fire outgoing webhook triggers.
   The feed needs dual transport. This is a server design requirement, not a documentation
   note.

2. **Cross channel threading.** Modules 3 and 5 both ask for a post in `#incidents`
   "threaded under the original alert" in `#alerts`. Threads cannot span channels. The
   design uses a permalink back to the origin post in the `#incidents` escalation, plus an
   optional threaded confirmation reply in `#alerts`. The grader asserts that pair. The lab
   copy needs a small rewrite to match.

The remaining known issues (trigger word position semantics, the missing `custom_alert`
post creation in Module 6, the undefined open alert count storage) affect lab copy and the
plugin scaffold rather than this server.

---

## 12. Suggested build order

1. labsvc skeleton: Fastify, journal, healthz, inspector shell
2. Inbound and outbound proxy with recording, plus `response_url` rewriting
3. Mock feed with dual transport and fixtures, plus `fire-alert.sh`
4. Handler scaffold with pre-wired routes and `lib/mattermost.ts`
5. Grader framework: stimulus, snapshot and reset, check contract
6. Checks per module, each landed alongside its `solution/` variant and a CI job
7. Mock intel API, then mock LLM
8. Instruqt track configuration, hot start snapshot, wait screen removal

Steps 1 to 5 are the whole platform. Modules 2 through 6 then become fixtures plus check
definitions, which is what lets the track be maintained by content authors rather than
engineers.

---

## Appendix A. Mattermost integration contracts

Verified against `mattermost/server/public/model` rather than documentation, since these
are the contracts the labs actually exercise.

| Surface | Inbound to the handler | Handler response |
| --- | --- | --- |
| Slash command | Form encoded: `token`, `team_id`, `team_domain`, `channel_id`, `channel_name`, `user_id`, `user_name`, `command`, `text`, `trigger_id`, `root_id`, `response_url` (`channels/app/command.go:487`) | `CommandResponse`, where `response_type` is `in_channel` or `ephemeral` only, plus `attachments`, `extra_responses`, `goto_location` (`command_response.go:21`) |
| Outgoing webhook | `OutgoingWebhookPayload`: `token`, `trigger_word`, `post_id`, `file_ids`, and others (`outgoing_webhook.go:54`) | `OutgoingWebhookResponse`, `response_type: "comment"` (`outgoing_webhook.go:69`) |
| Incoming webhook | not applicable, the handler POSTs to Mattermost | `IncomingWebhookRequest`: `text`, `channel`, `props`, `attachments`, `priority`, `silent` (`incoming_webhook.go:52`) |
| Post actions | `PostActionIntegrationRequest`: `user_id`, `post_id`, `trigger_id`, `context` (`integration_action.go:415`) | `PostActionIntegrationResponse`: `update`, `ephemeral_text`, `goto_location` (`integration_action.go:429`) |
| Dialogs | `SubmitDialogRequest`: `callback_id`, `state`, `submission`, `cancelled` (`integration_action.go:548`) | `SubmitDialogResponse`, using `error` or `errors` for field level validation, or `type: "form"` to chain a follow-up dialog (`integration_action.go:570`) |

Relevant API routes (`channels/api4/integration_action.go`):

```
POST /api/v4/posts/{post_id}/actions/{action_id}    line 17, grader uses this to simulate clicks
POST /api/v4/actions/dialogs/open                   line 19
POST /api/v4/actions/dialogs/submit                 line 20
POST /api/v4/actions/dialogs/lookup                 line 21
POST /api/v4/actions/dialogs/execute                line 22
```

### A.1 Two things certification content commonly gets wrong

1. **There is no HMAC signature.** Mattermost authenticates outgoing webhooks and slash
   commands with a plaintext shared `token` in the request body, not a signed header. Any
   challenge teaching "verify the signature" would be teaching something that does not
   exist. The correct lesson is constant time token comparison plus HTTPS.

2. **`trigger_id` is the only path to a dialog.** It is short lived and only arrives on
   slash commands and post action callbacks. A challenge that asks a learner to open a
   dialog from an incoming webhook is unsatisfiable.

---

## Appendix B. References

- [Instruqt lifecycle scripts](https://docs.instruqt.com/sandboxes/lifecycle-scripts)
- [Instruqt challenge check scripts](https://docs.instruqt.com/sandboxes/lifecycle-scripts/add-a-script-to-check-challenge-execution)
- [Instruqt networking](https://docs.instruqt.com/reference/platform/networking)
- [Instruqt hot starts](https://docs.instruqt.com/sandboxes/manage/hot-start)
- [Agents LLM provider configuration](https://docs.mattermost.com/agents/docs/providers.html)
- [Agents OpenAI-compatible API key requirement](https://support.mattermost.com/hc/en-us/articles/50716248653332-Mattermost-Agents-v2-OpenAI-compatible-AI-Service-Fails-with-No-Valid-Keys-Error-Due-to-Missing-API-Key)
