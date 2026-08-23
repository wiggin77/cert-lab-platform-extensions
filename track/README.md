# Instruqt track configuration

Track config as code for the **Mattermost Platform Extension Expert** certification.
Deployed with the Instruqt CLI, versioned alongside the `labsvc` and `handler` packages
it drives.

## Workflow

```bash
cd track
instruqt track validate     # check the config
instruqt track push         # deploy to Instruqt
instruqt track test         # run the track with its lifecycle scripts
instruqt track logs         # tail lifecycle script output
instruqt track open         # open it in a browser
```

`instruqt track push` is the only command here that changes remote state.

## Layout

```
track.yml                     metadata, tags, time limits
config.yml                    the sandbox: one VM host named workbench
track_scripts/
  setup-workbench             runs once before the learner starts
  cleanup-workbench           runs once at the end
NN-<name>/
  assignment.md               frontmatter (tabs, difficulty, timelimit) plus instructions
  setup-workbench             switches LAB_MODULE, snapshots
  check-workbench             runs the grader
  solve-workbench             applies the worked solution
  cleanup-workbench           resets to the challenge's opening snapshot
```

| Challenge | Curriculum module | Grader |
| --- | --- | --- |
| `01-incoming-webhooks` | 2 | `/grader/run/2/1` |
| `02-outgoing-webhooks` | 3 | `/grader/run/3/1` |
| `03-slash-commands` | 4 | `/grader/run/4/1` |
| `04-actions-and-dialogs` | 5 | `/grader/run/5/1` |
| `05-plugin-server` | 6 stage 1 | `/grader/run/6/1` |
| `06-plugin-webapp` | 6 stage 2 | `/grader/run/6/2` |

Module 1 is theory with no lab, and the final exam lives in WorkRamp, so neither appears
here.

## How the scripts hang together

The lifecycle scripts are deliberately thin. All the logic lives in `labsvc`, so it is
typechecked, runnable locally, and testable without pushing a track.

- `setup-workbench` calls `lab-module.sh <n>`, which rewrites `LAB_MODULE` in
  `/etc/lab.env`, restarts `mm-labsvc`, and takes a snapshot. **`LAB_MODULE` is not
  cosmetic**: it selects the mock feed's transport. Module 2 posts through the learner's
  incoming webhook, because configuring one is the lesson. Module 3 onward posts over
  REST as a bot, because incoming webhook posts do not fire outgoing webhook triggers.
- `check-workbench` calls `check-challenge.sh <module> <challenge>`, which posts to the
  grader and renders the result. Every check fires its own stimulus, so learners can
  re-run it freely.
- `cleanup-workbench` posts to `/admin/reset`, deleting anything created since the
  snapshot. Without it, later challenges trip over earlier experimentation.
- `solve-workbench` calls `apply-variant.sh`.

## Topology

Three hosts, chosen from empirical testing on a scratch track. `config.yml` carries the
full reasoning.

| Host | Type | Runs |
| --- | --- | --- |
| `postgres` | container | `postgres:15`, official image |
| `mattermost` | container | `mattermost/mattermost-team-edition:10.5`, official image |
| `workbench` | VM | labsvc, the learner's handler, code-server, and the Go/Node toolchains |

Mattermost and Postgres are containers because the official images work unmodified and the
platform keeps them away from anything the learner breaks. The learner's mutable code is on
a VM because container hosts have **no persistent storage** on classic Tracks: a `volumes:`
entry validates and is then silently ignored, so learner-authored code in a container would
be lost on a pod restart.

Two undocumented constraints, both silent when violated:

- **Base images must be Debian-family.** An Alpine/musl image fails to provision with an
  SSH handshake error, because Instruqt injects its own `sandbox-agent` as PID 1.
- **Instruqt ignores the image's `WORKDIR`** and runs from `/`. Mattermost's plugin paths
  are relative, so plugin startup fails with `mkdir ./client/plugins`. That would break all
  of Module 6, as a log warning rather than a crash. `config.yml` pins them absolutely.

## Paths on the workbench VM

Track setup clones <https://github.com/wiggin77/cert-lab-platform-extensions> to
`/opt/lab`, so the challenge scripts find things here.

| Path | Contents |
| --- | --- |
| `/opt/lab/labsvc/` | the labsvc package, including `scripts/` |
| `/opt/lab/variants/` | solution overlays and `apply-variant.sh` |
| `/opt/lab/bin/` | `lab-seed`, `lab-configure-agents`, `lab-set-webhook`, `lab-set-token` |
| `/etc/lab.env` | environment shared by `mm-labsvc` and `mm-handler` |
| `/home/learner/handler/` | the learner's own copy, modules 2 to 5 |
| `/home/learner/plugin/` | the plugin scaffold, module 6 |

`/opt/lab` stays pristine. The learner works in a copy, which is what lets a reset restore
from it and keeps grading code out of a directory they can edit.

`mm-labsvc`, `mm-handler`, and `code-server@learner` are systemd units written by track
setup. Override the clone source with `LAB_REPO_URL` and `LAB_REPO_REF` when testing a
branch.

## Sign in

`lab-seed` creates `analyst` / `Password123!` as a system admin, which is what the first
assignment tells the learner to use. System admin because they configure integrations and
upload a plugin. A separate `labadmin` account exists purely so the grader holds a token
the learner cannot invalidate by logging out.

## Not built yet

- Solution variants for modules 4, 5, and 6, so four of the six `solve-workbench` scripts
  will fail until those land.
- The Module 6 plugin scaffold.
- Setup takes 5m38s on a clean sandbox, ~3m20s of it warming the Module 6 plugin build
  caches. Hot start is not enabled on this track, so the learner waits for all of it.
  Baking a custom VM image would remove it entirely.

## Deploying a change

Track setup clones the repo at run time, so **code changes need pushing to GitHub before a
track run picks them up**. Pushing the track alone only updates config and assignments.

```bash
git push                       # code: labsvc, handler, bin, variants
cd track && instruqt track push  # config, assignments, lifecycle scripts
```

Point a test run at a branch with `LAB_REPO_REF` rather than editing the setup script.
