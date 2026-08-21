# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lab infrastructure for the **Mattermost Platform Extension Expert** certification track,
hosted on Instruqt. Six modules teach Mattermost integration surfaces (incoming webhooks,
outgoing webhooks, slash commands, post actions and dialogs, plugins) against a simulated
threat alert scenario.

`DESIGN.md` is the authoritative design document. Read it before making structural changes.

Two npm packages, no monorepo tooling. Install and run them independently.

| Path | What it is |
| --- | --- |
| `labsvc/` | Lab infrastructure. Recording proxy, mock services, grader, inspector. |
| `handler/` | The learner's integration handler, modules 2 to 5. Ships to `/home/learner/handler`. |
| `variants/` | Per-module solution overlays plus `apply-variant.sh`. |

## Commands

```bash
# Either package
npm install
npm run dev          # tsx watch, no build step
npm run typecheck    # use this, not `npx tsc`, which installs an unrelated tsc package
```

`labsvc` listens on 4000, `handler` on 3000. Neither needs a build.

```bash
# Run one challenge's checks (this is the real test suite)
curl -X POST http://localhost:4000/grader/run/3/1 | jq
labsvc/scripts/check-challenge.sh 3 1     # same, rendered as a learner sees it

curl http://localhost:4000/grader/challenges | jq   # every registered check

# Trigger the scenario
labsvc/scripts/fire-alert.sh --severity CRITICAL
labsvc/scripts/fire-alert.sh --indicator 203.0.113.47

# Put a worked solution in place
HANDLER_DIR=./handler variants/apply-variant.sh mod3 solution
```

There are no unit tests. The intended CI loop is: apply each module's solution variant,
run that module's checks, expect a pass. That is what stops the track rotting as the
codebase moves underneath it. It is not wired up yet.

Both packages need a seeded Mattermost to do anything interesting. Without one, the mocks,
proxies, and inspector still work; grading returns 503 without `MM_ADMIN_TOKEN`.

## Architecture

### Two processes, deliberately

`labsvc` and `handler` are separate services because the learner's handler breaks
constantly by design, and grading, the mocks, and the inspector must survive that. Nothing
in `labsvc` imports learner code at module load time. The one place it touches learner code
at all (the Module 2 payload builder) is a per-call dynamic import wrapped in try/catch.

### labsvc is a bidirectional recording proxy

Every byte between Mattermost and the handler passes through it.

- **Inbound** (`proxy/inbound.ts`): Mattermost to handler. Two behaviours beyond recording:
  it **rewrites `response_url`** in slash command payloads to point back at labsvc, which
  is what makes Module 4's delayed response observable and gradeable; and it **synthesises
  failure responses** shaped per calling surface when the handler is down, because
  Mattermost's own error surface is generic.
- **Outbound** (`proxy/outbound.ts`): handler to Mattermost, at `/mm/api/v4/*`. Deliberately
  transparent. The learner sets their own `Authorization` header. No credential injection.
- **Journal** (`proxy/journal.ts`): hash chained JSONL plus an in memory ring plus SSE.
  Tokens are retained in full and redacted only on the way out to the browser, because
  Module 3's lesson is token validation and the grader must distinguish a good token from a
  bad one.

### Grading rules

These are load bearing. Breaking them produces checks that fail correct work.

1. **Assert on Mattermost state, not the journal.** The journal is enrichment for hints
   only. A learner who bypasses the proxy and calls Mattermost directly must still pass.
   The single sanctioned exception is facts state cannot show: handler status codes,
   handler latency, and opening a dialog (which leaves no trace once the trigger expires).
   Where a check does depend on the journal, it degrades to a specific message rather than
   a wrong failure.
2. **Every check supplies its own stimulus.** The runner wraps each run in
   `pause ambient feed -> snapshot -> stimulus -> poll -> assert -> resume`. Never depend on
   the learner having fired something manually.
3. **Never read learner source code.**
4. `detail` says what was observed. `hint` names the next concrete action, it does not
   restate the rule.

Checks live in `labsvc/src/grader/checks/`, one file per module, registered by import side
effect from `checks/index.ts`.

### Mock feed transport is module dependent

`LAB_MODULE` drives it. Module 2 posts through the learner's incoming webhook, because
configuring one is the lesson. Module 3 onward posts over REST as a bot, because **posts
created by an incoming webhook do not fire outgoing webhook triggers**, which makes
Module 3 unsatisfiable otherwise.

The feed prefers the learner's own payload builder (`FEED_PAYLOAD_MODULE`) at every module.
Fallback differs on purpose: plain text in Module 2 (that is the scenario the lab
describes), the reference builder from Module 3 on (so a later lab is never blocked by
earlier work). Module 5 depends on this, since the Escalate button lives in the attachment
the learner builds.

## Things that will bite you

**`removeAllContentTypeParsers()` in `labsvc/src/server.ts` is load bearing.** Fastify's
built-in JSON parser takes precedence over a `'*'` catch-all, which leaves the proxies
holding a parsed object where they need original bytes. Routes wanting structure call
`jsonBody()` from `util/body.ts`.

**Never surface a caught fetch error raw.** Node reports nearly every transport failure as
the bare string `fetch failed` and hides the cause on `err.cause`. Everything user facing
goes through `describeError()` in `labsvc/src/util/errors.ts` first.

**Internal URLs, not public ones.** URLs pasted into Mattermost are fetched by the
Mattermost *server* process. `LABSVC_PUBLIC_BASE_URL` must be the internal address
(`http://workbench:4000`), never the browser facing `env.play.instruqt.com` form, and never
`localhost`. `callbackUrlProblem()` in `checks/shared.ts` detects both mistakes.

**The Agents plugin rejects a blank API key** even for local OpenAI compatible services.
The track setup script must set a dummy non-empty value when pointing it at
`/mock/llm/v1`.

## Instruqt platform behaviour

Found by testing, none of it documented, each silent when violated. `track/config.yml` and
`DESIGN.md` section 3.0 carry the detail.

- Container hosts have **no persistent storage**. `volumes:` validates and is ignored.
- Base images must be **Debian-family**. Alpine/musl fails to provision with an SSH
  handshake error, because Instruqt injects its own `sandbox-agent` as PID 1.
- Instruqt **ignores the image's `WORKDIR`** and runs from `/`.
- **A container process that exits is not restarted.** Mattermost loses a startup race
  against sandbox DNS, exits fatally, and stays down. `setup-mattermost` relaunches it.
- Lifecycle script stdout is the **only** log Instruqt surfaces, and each script sees one
  host. A failure with no printed reason costs a full run to diagnose, so scripts print
  their own diagnostics (`wait_for` dumps `journalctl`; each container has a setup script).

## Two-step deploy

Code and track config ship separately, and this is easy to trip over: you can push a track
and see none of your code changes.

```bash
git push                          # labsvc, handler, bin, variants  (cloned at setup)
cd track && instruqt track push   # config, assignments, lifecycle scripts
```

Lifecycle scripts under `track/` deploy with the track, so they are testable without a git
push. Everything the sandbox clones needs GitHub first. Use `LAB_REPO_REF` to point a run
at a branch.

## Solve scripts must do both halves

A `solve-workbench` script has to reproduce the Mattermost-side configuration as well as
the code, because the first check of most challenges asks whether an integration exists.
`bin/lab-create-integration` does the API side. A solve script that only copies code leaves
its challenge unsolvable, which also means CI can never verify a solution against its own
checks.

**Threads cannot span channels.** Cross-channel escalations use a permalink, never a
`root_id`. This contradicts the curriculum copy in Modules 3 and 5, which needs a rewrite.

**There is no HMAC signature on any Mattermost integration surface.** Outgoing webhooks and
slash commands carry a plaintext shared token in the request body. Any lesson about
verifying a signature is teaching something that does not exist.

## Mattermost payload types

`labsvc/src/types.ts` and `handler/src/lib/types.ts` are transcribed from
`server/public/model` in the Mattermost repo, not from documentation, with file and line
references in the comments. The Mattermost checkout is at
`/home/dlauder/Development/mattermost/mattermost`. Verify against source there rather than
against docs when a payload shape is in question, and update the line references when they
drift.

## Status

Built: journal, both proxies, all three mocks (feed, threat intel, OpenAI compatible LLM),
grader framework, checks for all six challenges, snapshot and reset, inspector UI, handler
scaffold, solution variants for modules 2 and 3.

Not built: solution variants for modules 4 to 6, the Module 6 plugin scaffold, the Instruqt
track configuration, and the CI loop described above.

Module 6 challenge 1 checks a `GET /api/v1/alerts/count` endpoint that the curriculum does
not currently mention. It closes a gap the doc review flagged (nothing described how the
header widget's open alert count is stored or fetched) and needs a one-line addition to the
lab copy.
