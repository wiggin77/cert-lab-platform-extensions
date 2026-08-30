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
| `tracks/` | Six Instruqt tracks, one per curriculum module. See `tracks/README.md`. |
| `image/` | `provision.sh`, the contents of the baked workbench VM image. Not built yet. |

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

A REST posted alert **must lead its message text with the severity**, which is what
`triggerableMessage()` in `mocks/feed.ts` guarantees. Trigger words are matched against
`strings.Fields(post.Message)[0]` and `TriggerWordExactMatch` rejects an empty word
(`channels/app/webhook.go:57`), so attachment content is invisible to the matcher. Alert
payloads put everything in an attachment and leave `text` empty, so without this the post
message is blank, no trigger can fire, and Module 3 is unsatisfiable however the learner
configures the webhook. Do not "simplify" that function away.

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

Each silent when violated, and only the script ordering below is documented by Instruqt.
`track/config.yml` and `DESIGN.md` section 3.0 carry the detail.

- **Setup scripts run serially, in alphanumeric hostname order.** Load time is the sum of
  every host's setup, not the longest, and the `a-` on `a-postgres` is what puts the
  database ahead of `mattermost`. Renaming a host reorders setup.
- Container hosts have **no persistent storage**. `volumes:` validates and is ignored.
- Base images must be **Debian-family**. Alpine/musl fails to provision with an SSH
  handshake error, because Instruqt injects its own `sandbox-agent` as PID 1.
- Instruqt **ignores the image's `WORKDIR`** and runs from `/`.
- **A container process that exits is not restarted.** Mattermost can lose a startup race
  against sandbox DNS, exit fatally, and stay down for the life of the sandbox. This is why
  `cmd:` matters: a container that waits cannot lose the race, and a container that dies
  cannot recover.
  **Fixed by `cmd:` on the container**, which waits for `a-postgres` to resolve before
  exec'ing Mattermost. Before the fix the race was lost in four of nine measured runs, each
  costing 2m25s in `setup-mattermost`'s relaunch path, which made it the largest single term
  in track load time. After it, five runs and no relaunches, `setup-mattermost` taking 2 to
  9s. Note `cmd:` works and `command:` does not: the latter is
  docker-compose's key name, parses fine, and is silently ignored. `setup-mattermost`'s
  relaunch stays as a backstop. See the comment in `tracks/*/config.yml` before changing the
  wrapper, particularly on why it uses `getent` and not `/dev/tcp`.
- Lifecycle script stdout is the **only** log Instruqt surfaces, and each script sees one
  host. A failure with no printed reason costs a full run to diagnose, so scripts print
  their own diagnostics (`wait_for` dumps `journalctl`; each container has a setup script).

## systemd: EnvironmentFile beats Environment

`mm-labsvc` and `mm-handler` share `/etc/lab.env`, but `MM_URL` means different things to
them: labsvc addresses Mattermost directly because it **is** the proxy, while the handler
goes **through** the proxy so its REST calls are recorded for the Lab Inspector.

`MM_URL` is therefore absent from `lab.env` and set per unit with `Environment=`. Putting
it back in the shared file silently breaks the handler: systemd documents that settings
from `EnvironmentFile=` "override settings made with `Environment=`", and that precedence
is **unconditional**, not decided by the order the lines appear in the unit. The only
visible symptom is the Module 5 dialog check failing while everything else passes, because
the outbound proxy records nothing.

## Six tracks, one per curriculum module

The six modules are six separate Instruqt tracks under `tracks/`. **The track number is the
curriculum module number**, and also `LAB_MODULE` and the grader's module argument: track 4
is module 4, sets `LAB_MODULE=4`, grades with `check-challenge.sh 4 1`. Track 1 is theory,
has no sandbox, and carries the scenario framing and orientation; only its conceptual
module content is still unwritten. It loads instantly, so anything the learner must read
belongs in its assignment body, not its notes. Track 6 is the only one with two challenges
and the only one that touches Go.

Three things follow, and all three are load bearing:

1. **Four files are copied, not generated**, and identical across the five sandbox tracks:
   `config.yml`, `setup-a-postgres`, `setup-mattermost`, `cleanup-workbench`. A shared fix
   lands five times. `bin/check-track-drift` is what tells you when it landed four. There is
   deliberately no generator: it would silently revert hand edits and put a build step
   between editing a setup script and pushing a track.
2. **`setup-workbench` varies by exactly two variables**, `LAB_TRACK` and
   `NEEDS_PLUGIN_TOOLCHAIN`, at the top of the file. The drift check normalises those out
   and compares the rest, and asserts `LAB_TRACK` matches its directory. Put anything else
   that needs to differ into those variables, not into a divergent copy.
3. **Each track seeds the modules before it**, via `bin/lab-seed-prior-modules $LAB_TRACK`.
   That script and the per-challenge `solve-workbench` scripts do the same work and must
   agree, or a track seeds a state no solve script produces and it grades as a learner error.

`NEEDS_PLUGIN_TOOLCHAIN=false` skips the Go toolchain, the plugin scaffold, all four build
cache warming phases, and the Agents plugin: 191 s of a measured 309 s run, none of which
anything but Module 6 uses.

## Two-step deploy

Code and track config ship separately, and this is easy to trip over: you can push a track
and see none of your code changes.

```bash
git push                                             # labsvc, handler, bin, variants
cd tracks/4-slash-commands && instruqt track push    # config, assignments, lifecycle scripts
```

Lifecycle scripts under `tracks/` deploy with the track, so they are testable without a git
push. Everything the sandbox clones needs GitHub first. Use `LAB_REPO_REF` to point a run
at a branch. There is no command that pushes all six tracks, so a change to a shared file
means pushing each affected directory.

## The Instruqt CLI is yours to drive

**Division of labour: Claude runs the `instruqt` commands, the user runs the `git` commands.**
Do not ask the user to read the track playback screen or to paste log output. Fetch it.

```bash
cd tracks/4-slash-commands
instruqt track validate     # local only, checks config.yml and every assignment
instruqt track push         # the ONLY command here that changes remote state
instruqt track logs         # lifecycle script output, see the warning below
instruqt track test         # run the track with its lifecycle scripts
instruqt track open         # open it in a browser
```

`validate` and `push` operate on the current directory, so they need a `cd` into one of the
six under `tracks/`. `logs` takes a slug and works from anywhere:

```bash
timeout 60 instruqt track logs platform-extensions-4-slash-commands --since 20m
```

**`instruqt track logs` tails forever and never exits.** Always wrap it in `timeout`, or
run it in the background writing to a file. Without that it hangs until something kills it.
`--since` takes a Go duration (`20m`) or RFC3339, and defaults to one minute ago, which is
almost never what you want. Other flags: `--severity` (default INFO), `--participant-id`,
`--config-version-id`.

**The log is a timing source even with no instrumentation.** Every line is
`<RFC3339> <participant-id> INFO: <script>: <output>`, and the platform emits
`Starting script: X` / `Finished running script: X` around each one, so per-host durations
are subtraction. Terraform provisioning is bracketed the same way.

**A running sandbox keeps the config version it started with.** Pushing mid-run does not
affect the run in progress, and the symptom is subtle: the log shows the *old* script names
and hostnames while your local tree has the new ones. Check for a script name you renamed
before concluding anything about a run's results.

**`instruqt track pull` destroys `config.yml`'s comments.** It rewrites the file from the
platform's parsed copy, so all 101 comment lines in this repo's sandbox definition vanish
(153 lines become 37) with no warning. `track_scripts/` and `assignment.md` survive a pull
intact; `config.yml` does not. Pull into a scratch directory, never into `tracks/`.

**`instruqt track push` rewrites local files.** It normalises tab key order and the
`checksum` in `track.yml`, so a push leaves you with an unstaged diff you did not write.
Commit it, or the next push reproduces it.

## Solve scripts must do both halves

A `solve-workbench` script has to reproduce the Mattermost-side configuration as well as
the code, because the first check of most challenges asks whether an integration exists.
`bin/lab-create-integration` does the API side. A solve script that only copies code leaves
its challenge unsolvable, which also means CI can never verify a solution against its own
checks.

**Threads cannot span channels.** Cross-channel escalations use a permalink, never a
`root_id`. The source curriculum doc says otherwise for Modules 3 and 5; the lab
assignments here already say the correct thing and call the constraint out explicitly, so
this is a note for whoever revises the doc, not an open task in this repo.

Note this is only true *across* channels. Module 6's AI reply threads under the alert with
`root_id` precisely because both posts are in `~alerts`.

**There is no HMAC signature on any Mattermost integration surface.** Outgoing webhooks and
slash commands carry a plaintext shared token in the request body. Any lesson about
verifying a signature is teaching something that does not exist.

## The Module 6 plugin

`plugin/` is the scaffold copied to `/home/learner/plugin` at setup. The learner writes
`server/hooks.go` and `server/api.go`; everything else is given.

**`server/public` v0.1.22 calls the type `model.SlackAttachment`, not
`model.MessageAttachment`.** Current Mattermost master uses the newer name, so reading
attachment code out of the checkout and pasting it in does not compile. `post.Attachments()`
returns `[]*model.SlackAttachment` at this version.

**The Go toolchain on the VM must be at or above the `go` directive in `plugin/go.mod`.**
`server/public` v0.1.22 requires 1.24.11, so `GO_VERSION` in `setup-workbench` is 1.25.5. An
older toolchain does not print "upgrade Go": it tries to download a newer one, which hangs
or fails for a user with no writable cache. Bumping `server/public` can silently raise this
floor, so re-check `grep '^go ' plugin/go.mod` after any dependency change.

**`make` is in the required apt package list, not `build-essential`.** `build-essential` is
deliberately allowed to fail, and the plugin build is driven by a Makefile.

**The plugin bundle tar must contain exactly one top level directory named for the plugin
id**, with `plugin.json` at its root. A flat archive is rejected on upload with a message
that does not say which rule was broken.

**Deploy is an API upload, not a file copy.** Mattermost runs in its own container, so its
plugin directory is not on the workbench. `make deploy` POSTs to `/api/v4/plugins` with
`force=true`, then `/api/v4/plugins/{id}/enable`. Both return before the plugin process is
actually up, so `bin/lab-deploy-plugin` polls `/api/v4/plugins` for the id under `active`.

**`/etc/lab.env` is explicitly chmod 644 by setup.** Instruqt runs lifecycle scripts under
a umask that leaves it 600, and `make deploy` reads `MM_ADMIN_TOKEN` out of it as the
learner. Without the chmod every step of the build succeeds and only the upload fails. Not
a boundary being dropped: the learner has sudo, and installing a plugin is an admin
operation by definition. Setup asserts the learner can read it and warns if not.

**The webapp's React and Redux pins are type-only.** `webpack.config.js` externalises
react, react-dom, redux, react-redux and prop-types to the copies Mattermost already loaded
on `window` (`webapp/channels/src/plugins/export.ts:132`), so the versions in
`plugin/webapp/package.json` only ever affect typechecking. Bundling our own React would
load a second copy and break hooks with an error that blames the component. Expect the pins
to differ from what the server ships (Mattermost master is on react-redux 9 / redux 5);
that is fine while only stable APIs are used, and is not worth chasing.

### Calling the Agents plugin

Inter-plugin calls go through `p.API.PluginHTTP(req)` with a **path-only** URL of the form
`/<destination-plugin-id>/<path>`; the server splits the id off the front
(`channels/app/plugin_api.go:1337`). For a completion:

    POST /mattermost-ai/bridge/v1/completion/service/lab-mock-llm/nostream
    {"posts":[{"role":"user","message":"..."}]}  ->  {"completion":"..."}

Auth needs nothing from the caller. The server sets `Mattermost-Plugin-ID` on inter-plugin
requests and deletes it from anything arriving externally
(`channels/app/plugin_requests.go:98` and `:190`), so it cannot be forged, and the Agents
bridge routes require it. No API key is involved: the trust boundary is the server.

The Agents plugin publishes `public/bridgeclient` for this, and `server/agents.go`
deliberately does **not** import it. That package lives in the main
`mattermost-plugin-agents` module, whose `go.mod` requires a Go newer than the workbench
has (1.26.2 at v2.2.0) and which pulls in the plugin's whole dependency tree, for three
structs. The wire format is transcribed instead.

**The Agents version is pinned to v2.2.0 and the ceiling is real.** v2.4.x raised
`min_server_version` to 11.9.0 and the lab runs Mattermost 10.5, so it cannot install at
all. v2.2.0 still declares 6.2.1 and already has the bridge. v1.x has no bridge. Moving
past v2.2.0 means raising the Mattermost image first.

**`lab-configure-agents` compares versions, not presence, and this is the whole point.**
The Mattermost image ships a prepackaged `mattermost-ai`, so the original presence check
reported "already installed" every time and the script never installed anything. The
bundled build predates the bridge, so `/bridge/v1/...` matched no route, and gin's
`NoRoute` handler still runs the router's global middleware, including the one demanding a
`Mattermost-User-Id`. An inter-plugin call has no user, so the result was a **bodyless 401
instead of a 404** and nothing in the log revealed that the wrong version was running.
Two guards now exist: the upload checks its HTTP status (curl without `-f` treats a 400 as
success, so a `min_server_version` rejection was being swallowed), and the script logs the
version actually running afterwards.

**The `/v1` in the Agents `apiURL` is load bearing, and so is the fact that it looks
wrong.** `lab-configure-agents` sets `apiURL` to `.../mock/llm/v1`, and v2.2.0 routes
through Bifrost, which builds paths starting with `/v1/` itself. It does not double up:
`openaicompatible` maps to the `OpenAI` provider (`bifrost/config.go:21`), and
`normalizeOpenAIBaseURL` strips exactly one trailing `/v1` for that provider before Bifrost
re-appends it, landing on `/mock/llm/v1/chat/completions`, which is the route the mock
actually serves. Dropping the `/v1` from the config to "fix" the apparent duplication is
what breaks it. `UseResponsesAPI` is left unset, so the service registers `ChatOnly` and
Bifrost downgrades any Responses-API request rather than calling `/v1/responses`, which the
mock does not serve.

**The Agents webapp bundle is stripped before upload, and that is required.** Agents 2.2.0's
webapp is far newer than the Mattermost 10.5 webapp it runs inside and throws during
initialize. The damage is not contained to its own UI: the post editor renders "Something
went wrong while loading the component" and opening the main menu blanks the whole client
to a white screen. Confirmed by disabling the plugin in a live sandbox, after which the
client renders normally. `lab-configure-agents` deletes `webapp/` from the release archive
and removes the `webapp` key from its `plugin.json` (a declared bundle path with no bundle
fails activation), then repacks. Nothing is lost: the lab only ever calls the server side
LLM Bridge over `PluginHTTP`, and learners build their own alert UI in Module 6.

**The WebSocket needs `ServiceSettings.AllowCorsFrom`.** Mattermost origin-checks the
WebSocket upgrade and nothing else, comparing the browser's `Origin` host *and* scheme
against `SiteURL` (`channels/app/server.go` `OriginChecker`). `SiteURL` is the internal
`http://mattermost:8065` while the learner's browser arrives from
`https://<generated>.env.play.instruqt.com`, so it is rejected and the client shows
"Mattermost unreachable, ask your administrator to check WebSocket port" while the REST API
keeps working, which is why the channel list renders fine. `"*"` is checked before `SiteURL`
is consulted (`channels/utils/api.go` `CheckOrigin`), so it works without knowing the
per-participant hostname. Note the webapp derives its own base URL from
`window.location.origin`, not from `SiteURL`, so `SiteURL` is not what routes the client.

**The Agents config goes under a single `Config` key, and nothing tells you when it does
not.** Its `plugin.json` declares exactly one setting, `Config`, and it loads that into a
struct whose only field is `config.Config` with an explicit `json:"config"` tag. An
explicit tag on an embedded field makes it a *named* field rather than an inlined one, so
`services` and `bots` must sit inside a `config` object:

    {"PluginSettings": {"Plugins": {"mattermost-ai": {"Config": {"services": [...], "bots": [...]}}}}}

Written at the top level instead, the settings store verbatim, the one-shot migration below
runs and logs success, and it migrates an empty config. `EnsureBots` then has nothing to
create and returns no error, so the only symptom is the bridge answering "no bot found for
service" two challenges away. When debugging this, read `.PluginSettings.Plugins[id].Config`
and not the level above it, or a correct config looks empty.

**Agents 2.x reads `PluginSettings` exactly once, so `lab-configure-agents` writes the
config BEFORE installing the plugin.** On first activation it checks
`store.IsConfigMigrated()`, and if false loads `PluginSettings`, writes it to its own
database table, and marks itself migrated (`server/main.go`). After that it reads only the
database, and v2.2.0 has no `OnConfigurationChange`, so later writes to `PluginSettings`
are never seen. Configuring after enabling looked like it worked and did nothing: the
plugin had migrated the old bundled version's (empty) config, and ours went to a file it
had stopped reading. Disabling and re-enabling does **not** help, because that is a second
activation and migration has already run. Do not reorder those two sections.

The visible symptom was a bridge 404 naming the service, two challenges away from the
cause. Worth knowing why the message misleads: in `EnsureBots`, a `getLLM` error returns
before `b.bots` is ever assigned (`bots/bots.go`), so one unusable service leaves
`GetAllBots()` empty and *every* service reports "no bot found" regardless of its own
config.

**The service completion endpoint still needs a bot.** Despite the name, the bridge calls
`getBotByService(service)` and 404s if no configured bot references that service id
(`api/api_llm_bridge.go:971`). `lab-configure-agents` happens to define bot
`threat-analyst` against `lab-mock-llm`, so it resolves; deleting that bot as redundant
would break the AI skill. The bot's `customInstructions` also become part of the prompt the
mock classifies, so they must stay clear of the cue words below.

**The mock LLM picks its answer from cues in the prompt.** `labsvc/src/mocks/llm.ts`
`classify()` routes to `suggest_remediation` on any of remediat, mitigat, fix, respond,
containment, next step, what should, and picks the severity fixture by looking for
"critical" or "high". So an analyse prompt must avoid those words and must include the
severity, or the reply comes back as remediation text and the check looking for "threat
surface assessment" fails.

### The custom post card

`MessageWillBePosted` in `server/posttype.go` stamps `post.Type = "custom_soc_alert"`. This
is scaffold, not a learner task, and it is what makes the post card reachable at all: the
feed is an external system and has no reason to know about a type this plugin invented.

Verified in the webapp source rather than assumed:

- An unregistered custom type **falls through to normal rendering**
  (`post_message_view.tsx:142`), so stamping is safe in challenge 5 when no component is
  registered yet.
- When a component **is** registered, `PostBodyAdditionalContent` is skipped
  (`message_with_additional_content.tsx:46`), so attachments do not double-render
  underneath the card. That is the "you own the whole render" lesson, literally.
- `hasPlugin` matches on `post.type` while `PostMessageView` prefers `post.props.type`, so
  set `post.Type` and not a prop, or the two disagree.
- `findAlertPost` in the grader matches on props and attachment content, never on
  `post.type`, so stamping does not disturb any check.

Hook contract, from `public/plugin/hooks.go`: return `(nil, "")` to allow unchanged,
`(post, "")` to replace, `(nil, "reason")` to reject. Every non-alert path returns
`(nil, "")`. This hook sees every post on the server, so a mistake in it does not break
alerts, it breaks posting. There are tests for exactly that.

**A phony Make target must not share a name with a real directory.** `make webapp` alongside
`webapp/` works only while the `.PHONY` line survives, and then stops rebuilding with no
error. The targets are `build-server` and `build-webapp`.

### Tests are the inner loop

`plugin/server/*_test.go` ships in the scaffold, so `make test` is a spec the learner can
run without deploying: 16 tests in ~50ms against an in-memory KV Store, versus most of a
minute for a deploy plus a stimulus. The 10 covering the learner's tasks fail on the
untouched scaffold by design; the post type ones pass, because that is scaffold behaviour.

The KV mock is backed by a real map, not per-call expectations, so a test can write and read
back the way the plugin does at runtime. `AssertExpectations` is deliberately **not** used:
it turns "not written yet" into pages of mock noise that buries the one assertion explaining
what is missing. Mocks are `.Maybe()` for the same reason.

Posts in tests are round-tripped through JSON on purpose. Real attachments arrive as `[]any`
of `map[string]any`, so code that type asserts straight to the typed slice passes a
naively-built test and finds nothing in production.

### Variants target the handler or the plugin

`apply-variant.sh` reads `variants/<module>/dest`, holding `handler` or `plugin`. Absent
means handler, so modules 2 to 5 are unchanged. `mod6-server` and `mod6-webapp` say
`plugin`. This is explicit rather than inferred from the module name because a variant
copied into the wrong tree fails later, somewhere else, as a compile error in code nobody
touched.

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
scaffold, the Instruqt track configuration, the plugin scaffold with its test suite, and
solution variants for every module including `mod6-server` and `mod6-webapp`.

**All six challenges pass end to end on Instruqt, across all five sandbox tracks**
(2026-08-29). `instruqt track test` drives setup, check-expecting-failure, solve, and
check-expecting-success for every challenge, and all five tracks return `Track test
succeeded`. Module 6 completed a full Instruqt run for the first time in that batch, both
the server and the webapp challenge, so the "verified locally only" caveat that stood here
is retired.

`instruqt track test` per track is now a usable CI loop in everything but name, and it is
what the "not built" note below used to refer to. It still needs a live sandbox, so a pull
request cannot run it.

Setup cost, measured in that batch: **71s** for a track without the plugin toolchain,
**315s** for track 6 with it. The gap is the 191s of Go and plugin work plus `build-essential`
and Agents, which is what `NEEDS_PLUGIN_TOOLCHAIN` skips.

Not built: a baked VM image with the toolchains pre-installed, and CI that runs without a
sandbox. Note the image is now a smaller win than the Mattermost DNS race above, which it
cannot fix.

**Nothing in Module 6's UI has been seen in a browser.** The grader inspects the bundle for
registrations and says outright that it does not verify rendering. The reasoning behind the
components is checked against webapp source (see the post card notes above), but layout,
whether the RHS opens from the card, and whether the header count actually updates all need
a human to look at them once.
