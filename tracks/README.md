# Instruqt track configuration

Track config as code for the **Mattermost Platform Extension Expert** certification.
Deployed with the Instruqt CLI, versioned alongside the `labsvc` and `handler` packages
it drives.

**Six tracks, one per curriculum module.** The track number, the curriculum module number,
`LAB_MODULE`, and the grader's module argument are all the same number. Track 4 is
curriculum module 4, sets `LAB_MODULE=4`, and grades with `check-challenge.sh 4 1`.

| Directory | Title | Sandbox | Challenges |
| --- | --- | --- | --- |
| `1-foundations/` | Platform Extensions 1: Foundations | none | 1, placeholder content |
| `2-incoming-webhooks/` | Platform Extensions 2: Incoming Webhooks | yes | 1 |
| `3-outgoing-webhooks/` | Platform Extensions 3: Outgoing Webhooks | yes | 1 |
| `4-slash-commands/` | Platform Extensions 4: Slash Commands | yes | 1 |
| `5-actions-and-dialogs/` | Platform Extensions 5: Post Actions and Dialogs | yes | 1 |
| `6-plugins/` | Platform Extensions 6: Plugins | yes | 2 |

Track 1 provisions nothing and loads instantly. Its content is a **placeholder**: Module 1's
theory has not been written yet, and the track exists for the numbering and the navigation.

## Workflow

Each directory is a complete, independent track. `validate` and `push` operate on the
current directory, so they need a `cd` into one.

```bash
cd tracks/4-slash-commands
instruqt track validate     # check the config
instruqt track push         # deploy to Instruqt
instruqt track test         # run the track with its lifecycle scripts
instruqt track open         # open it in a browser
```

`instruqt track push` is the only command here that changes remote state. `instruqt track
logs` takes a slug and works from anywhere, but **it tails forever**, so wrap it in
`timeout`.

## The shared files, and the drift check

Four files are identical in all five sandbox tracks:

```
config.yml
track_scripts/setup-a-postgres
track_scripts/setup-mattermost
track_scripts/cleanup-workbench
```

Nothing generates them. They are plain copies, so any track directory can be edited and
pushed directly, and **a shared fix has to land five times**. Run the check before pushing:

```bash
bin/check-track-drift          # exits non-zero on drift
bin/check-track-drift --fix    # copy the reference track's shared files over the others
```

`setup-workbench` is the one shared file with real per-track variation, held to exactly two
variables at the top:

```bash
LAB_TRACK=4                      # track number == curriculum module number
NEEDS_PLUGIN_TOOLCHAIN=false     # true only in 6-plugins
```

The drift check normalises those two lines out and compares the rest, so the body is covered
too. It also asserts that `LAB_TRACK` matches the directory it sits in, which is the one
mistake nothing else would catch. `--fix` deliberately does **not** copy `setup-workbench`,
because that would overwrite those two variables with the reference track's values.

Setting `NEEDS_PLUGIN_TOOLCHAIN=false` skips the Go toolchain, the plugin scaffold, all four
build cache warming phases, and the Agents plugin. Those measured 191 s of a 309 s run, and
only Module 6 uses any of them.

## Prior modules are seeded, not assumed

Each track gets a fresh sandbox, so a learner arriving at track 5 has not built modules 2 to
4 in it. `setup-workbench` calls `bin/lab-seed-prior-modules $LAB_TRACK`, which creates each
earlier module's integration and applies its solution variant.

**That script and the per-challenge `solve-workbench` scripts do the same work and must stay
in agreement.** If they disagree, a track seeds a state no solve script produces, and it
grades as a learner error. The mapping lives in a comment at the top of
`bin/lab-seed-prior-modules`.

## Layout

Every sandbox track has the same shape.

```
track.yml                     metadata, tags, time limits. No `id:` until pushed.
config.yml                    the sandbox: two container hosts and a VM
track_scripts/                run once before the learner starts, in this order
  setup-a-postgres            waits for the database, diagnostics only
  setup-mattermost            relaunches the server if it lost its startup race
  setup-workbench             toolchains, lab code, seeding, prior modules, services
  cleanup-workbench           runs once at the end
NN-<name>/
  assignment.md               frontmatter (tabs, difficulty, timelimit) plus instructions
  setup-workbench             switches LAB_MODULE, snapshots
  check-workbench             runs the grader
  solve-workbench             applies the worked solution
  cleanup-workbench           resets to the challenge's opening snapshot
```

`1-foundations/` has only `track.yml`, a hostless `config.yml`, and one challenge directory
holding an `assignment.md`. No `track_scripts/`, because there is no host to run them on.

**Track titles use a hyphen, not a colon**, and that is a YAML constraint rather than a
style choice. `title: Platform Extensions 4: Slash Commands` is invalid YAML, and the error
names the line rather than the colon:
`failed to read track.yml: yaml: line 2: mapping values are not allowed in this context`.
Quoting the value works, but every title and teaser here would need it forever, so the
convention is simply to keep colons out of bare scalars.

**Never run `instruqt track pull` into a track directory here.** It rewrites `config.yml`
from the platform's parsed copy, which **destroys every comment**: 153 lines become 37, and
all 101 comment lines go, including the Debian-family constraint, the ignored `WORKDIR`, the
Mattermost DNS race, and why `AllowCorsFrom` is `"*"`. Nothing warns you. `track_scripts/`
and `assignment.md` survive a pull intact; `config.yml` does not. Pull into a scratch
directory if you need to see remote state.

**Tab ids are assigned by the platform and are not written back.** `push` writes the track
`id:` and the challenge `id:` into your local files, but not tab ids. That is fine and they
are stable: pushing the same track twice keeps the same tab ids. Do not hand-add them.

**No other `id:` fields are checked in before the first push.** A track id, a challenge id, and one id per tab are all
platform-assigned, and a copied id points at the wrong track. Verified: stripping them all
still passes every validate stage.

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
- `solve-workbench` calls `apply-variant.sh`, and for challenges 1 to 3 also
  `lab-create-integration`, because the first check of most challenges asks whether an
  integration exists.

The per-challenge scripts are unchanged by the split. Each challenge lives in exactly one
track, so there is nothing duplicated among them: `check-challenge.sh 4 1` is track 4's only
challenge, and `check-challenge.sh 6 2` is track 6's second.

## Topology

Three hosts, chosen from empirical testing on a scratch track. `config.yml` carries the
full reasoning.

| Host | Type | Runs |
| --- | --- | --- |
| `a-postgres` | container | `postgres:15`, official image |
| `mattermost` | container | `mattermost/mattermost-team-edition:10.5`, official image |
| `workbench` | VM | labsvc, the learner's handler, code-server, and the Go/Node toolchains |

The `a-` prefix is the start order. Instruqt runs setup scripts serially in alphanumeric
hostname order, so it puts the database ahead of the server that needs it. Only that host is
prefixed: the other two already sort correctly after it, and both of their names are visible
to the learner.

Serially means the learner's wait is the sum of all three hosts' setup, not the longest of
them. Hot start would move that off the loading screen, and it is not enabled here. It is a
per-track setting in the Instruqt web UI rather than anything in `track.yml`, so the repo
cannot tell you either way.

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
| `/opt/lab/bin/` | the `lab-*` helpers: seeding, Agents config, integration and plugin creation, and the `lab-set-*` scripts the assignments tell the learner to run |
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

## Deploying a change

Track setup clones the repo at run time, so **code changes need pushing to GitHub before a
track run picks them up**. Pushing the track alone only updates config and assignments.

```bash
git push                                        # code: labsvc, handler, bin, variants
cd tracks/4-slash-commands && instruqt track push   # config, assignments, lifecycle scripts
```

Point a test run at a branch with `LAB_REPO_REF` rather than editing the setup script.

A change to a **shared** file has to be pushed from every track that carries it. Run
`bin/check-track-drift` first, then push each affected directory. There is no command that
pushes all six.
