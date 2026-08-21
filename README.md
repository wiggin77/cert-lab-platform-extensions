# Mattermost Platform Extensions certification lab

Hands-on labs for the **Platform Extension Expert** certification, hosted on
[Instruqt](https://instruqt.com). Five labs across six challenges, in which a learner
builds a working Mattermost integration one surface at a time against a simulated threat
intelligence feed.

Each module adds a capability the previous one could not provide:

| Challenge | Surface | What the learner builds |
| --- | --- | --- |
| 1 | Incoming webhooks | Alerts arrive in `~alerts` as formatted message attachments |
| 2 | Outgoing webhooks | CRITICAL alerts auto-escalate to `~incidents` |
| 3 | Slash commands | `/threat <indicator>` returns threat intel enrichment |
| 4 | Post actions and dialogs | An Escalate button opens a form and posts an assessment |
| 5 | Plugins, server | A Go hook captures alerts into the KV Store, exposed over HTTP |
| 6 | Plugins, webapp | A custom post card, sidebar pane, AI skills, and a header widget |

Learners are graded by firing a real alert and inspecting what Mattermost actually did
with it, never by reading their source.

## Repository map

| Path | What it is |
| --- | --- |
| [`labsvc/`](labsvc/) | Lab infrastructure: recording proxy, mock services, grader, inspector |
| [`handler/`](handler/) | The learner's integration handler, challenges 1 to 4 |
| [`bin/`](bin/) | Provisioning and helper scripts run on the sandbox host |
| [`track/`](track/) | Instruqt track configuration: hosts, assignments, lifecycle scripts |
| [`variants/`](variants/) | Worked solutions, applied by the platform's solve scripts |
| [`DESIGN.md`](DESIGN.md) | Architecture and the reasoning behind it. Read this first. |

Each of `labsvc/`, `handler/`, and `track/` has its own README covering local use.

## How it fits together

```
                  +---------------- labsvc :4000 ----------------+
Mattermost  ------>  inbound proxy  ----------------------------->  handler :3000
  :8065     <------  records both directions, rewrites            <--
                  |  response_url, synthesises failures            |
                  |                                               |
            <------  outbound proxy  /mm/api/v4/*  ---------------- handler
                  |                                               |
                  |  mocks:    threat feed, threat intel, LLM      |
                  |  grader:   stimulus + assertions per challenge |
                  |  journal:  hash chained, streamed to the UI    |
                  +-----------------------------------------------+
```

Two properties do most of the work.

**Everything between Mattermost and the learner passes through a recording proxy.** The
Lab Inspector then answers the question that dominates integration support, *"is Mattermost
even calling me"*, at a glance: what was sent, what came back, how long it took. It also
makes otherwise invisible lessons gradeable, such as the slash command timeout.

**Every check supplies its own stimulus.** A check fires its own alert, invokes its own
command, or clicks its own button, then asserts against Mattermost state. Learners never
have to trigger something by hand first, and can re-run a check as often as they like.

`labsvc` and `handler` are deliberately separate processes. The learner's handler breaks
constantly by design, and grading, the mocks, and the inspector have to survive that.

## Getting started locally

Both packages run their TypeScript directly under `tsx`. No build step.

```bash
cd labsvc && npm install && npm run dev     # :4000, then open /inspector
cd handler && npm install && npm run dev    # :3000
```

Use `npm run typecheck`, not `npx tsc`, which installs an unrelated package called `tsc`.

The mocks, proxies, and inspector work standalone. Grading needs a seeded Mattermost and
returns 503 without `MM_ADMIN_TOKEN`. See `.env.example` in each package.

## Working on the track

```bash
cd track
instruqt track validate     # check the configuration
instruqt track push         # deploy config, assignments, lifecycle scripts
instruqt track test         # run the whole track: setup, check, solve, check
instruqt track logs         # tail lifecycle script output
```

**Code and track config deploy separately**, which is easy to trip over: you can push a
track and see none of your code changes.

```bash
git push                          # labsvc, handler, bin, variants  (cloned at setup)
cd track && instruqt track push   # config, assignments, lifecycle scripts
```

Track setup clones this repository to `/opt/lab` on the sandbox. Point a run at a branch
with `LAB_REPO_REF` rather than editing the setup script.

## Status

Working end to end: the sandbox provisions, Mattermost and Postgres come up, seeding
creates the team, channels, users, bots and tokens, the Agents plugin is wired to the mock
LLM, and both services start. Twenty checks are registered across all six challenges, and
they correctly fail work that has not been done.

Outstanding:

- Solution variants for challenges 3 to 6. Only `mod2` and `mod3` exist, so the solve
  scripts for the rest will fail, and `instruqt track test` cannot go green past
  challenge 2.
- The challenge 5 and 6 plugin scaffold.
- A baked VM image. Setup installs Node and Go at run time, which hot start absorbs
  because hot start runs track-level setup during pre-warm, but baking would remove it.
- CI. The intended loop is: apply each solution variant, run that challenge's checks,
  expect a pass. That is what keeps the track from rotting as the codebase moves.

## Notes on the curriculum

The lab exercises a few things the source curriculum gets wrong, and the design works
around them rather than teaching them:

- **Posts created by an incoming webhook do not fire outgoing webhook triggers.** The mock
  feed therefore posts through the learner's webhook for challenge 1, where configuring one
  is the lesson, and over REST as a bot from challenge 2 onward. Challenge 2 is
  unsatisfiable otherwise.
- **Threads cannot span channels.** Cross-channel escalations carry a permalink, never a
  `root_id`.
- **There is no HMAC signature on any Mattermost integration surface.** Outgoing webhooks
  and slash commands carry a plaintext shared token in the request body, so constant time
  token comparison is the lesson, not signature verification.
