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

## Paths assumed on the host

Track setup must place things here, or the challenge scripts will not find them.

| Path | Contents |
| --- | --- |
| `/opt/lab/labsvc/` | the labsvc package, including `scripts/` |
| `/opt/lab/variants/` | solution overlays and `apply-variant.sh` |
| `/opt/lab/docker-compose.yml` | Mattermost and Postgres |
| `/opt/lab/bin/` | `lab-seed`, `lab-configure-agents`, `lab-set-webhook`, `lab-set-token` |
| `/etc/lab.env` | environment shared by `mm-labsvc` and `mm-handler` |
| `/home/learner/handler/` | the learner's handler, modules 2 to 5 |
| `/home/learner/plugin/` | the plugin scaffold, module 6 |

`mm-labsvc`, `mm-handler`, and `code-server` are systemd units.

## Not built yet

- The VM image. `config.yml` points at a stock `ubuntu-2204-lts` with a TODO. It needs a
  baked custom image with Mattermost, Postgres, `node_modules`, the Go module cache, and
  a pre-built plugin bundle, plus hot start enabled. The curriculum budgets a 3 to 4
  minute wait screen for Module 6's build; a snapshot removes almost all of it.
- Provisioning: `docker-compose.yml`, the systemd units, and the `/opt/lab/bin` helpers
  the setup script and the assignments reference (`lab-seed`,
  `lab-configure-agents`, `lab-set-webhook`, `lab-set-token`).
- Solution variants for modules 4, 5, and 6, so four of the six `solve-workbench`
  scripts will fail until those land.
- The Module 6 plugin scaffold.
