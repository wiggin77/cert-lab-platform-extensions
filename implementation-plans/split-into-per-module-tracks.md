# Splitting the track into per-module tracks

Status: DONE, 2026-08-29. All six tracks are pushed, all five sandbox tracks pass
`instruqt track test` end to end, and the old `platform-extensions` track has been deleted
from Instruqt along with the local `track/` directory. Kept for the reasoning, not as a
live plan.
Supersedes: nothing. Blocks: the custom VM image (see "Why this comes first")

## Goal

Replace the single `platform-extensions` track, six challenges in one sandbox, with six
standalone tracks named for their position in the learning path:

```
Platform Extensions 1: Foundations              (theory, no sandbox)
Platform Extensions 2: Incoming Webhooks
Platform Extensions 3: Outgoing Webhooks
Platform Extensions 4: Slash Commands
Platform Extensions 5: Post Actions and Dialogs
Platform Extensions 6: Plugins                  (two challenges)
```

The number in the title is the only ordering signal a learner gets in the catalogue, so it
is load bearing, not decoration. **The track number is the curriculum module number**, with
no offset in either direction, and it is also the `LAB_MODULE` value and the grader's module
argument. One number means one thing everywhere.

Five of the six provision a sandbox. Foundations does not.

## Why this comes first, before the VM image

Each track becomes its own sandbox, so setup runs once per track rather than once per
learner. That is the bad news. The good news is bigger: **tracks 2 to 5 stop needing the
Module 6 plugin toolchain at all**, and the measured phase breakdown says that is most of
the cost.

```
96s go compile test binary
81s make bundle
 6s npm install plugin webapp
 5s go mod download
 3s install Go
```

191 s of a 309 s script, removed from four of the five sandbox tracks by a conditional
rather than by an image. That change is impossible to make until the tracks exist, and an
image baked against today's monolithic setup would be baking things four tracks never use.

**The skip is part of this work, not a follow-up.** Without it the split ships as a roughly
5x load-time regression, and the split is externally mandated so it will ship regardless.

## Decisions already taken

1. **Later tracks arrive with earlier modules' work already in place**, produced at setup
   from `variants/`. Not baked into a VM image: it is file copies (`copy plugin scaffold`
   measures 0 s), and baking learner-facing code would mean an image rebuild instead of a
   `git push` for any fix to a variant, breaking `LAB_REPO_REF` branch testing.
2. **The two plugin challenges stay together in track 6**, which keeps its two challenges
   while every other track has one. They share one Go module and one plugin, so it is the
   worst possible seam to split on. As a bonus all plugin toolchain cost lands in exactly
   one track.
3. **The theory module is numbered 1, matching its curriculum module.** The source
   curriculum (`DESIGN.md:7`) lists a theory module as Module 1, which is why the labs in
   this repo start at Module 2 and why `variants/` and the grader checks are named `mod2`
   upward. Numbering the track 1 makes the track number and the curriculum module number the
   same number, so there is no offset to remember or to get wrong. Verified: a track with no
   sandbox hosts validates clean, so it provisions nothing and loads instantly.

   **Its content is a placeholder for now** and will be written later. Track 1 exists in this
   plan for the numbering and the navigation, not because the theory is ready. Do not let
   W6 block on it.
4. **The shared files are copied, not generated, and a check catches drift.** There is no
   templating step and no hidden source of truth: every track directory is a plain, complete,
   hand-editable track. See "Duplication: measured, then decided" below for the numbers this
   rests on. YAML cannot help here in any case, since it has no include directive and
   Instruqt adds none (`!include` fails with `yaml: line 3: could not find expected ':'`);
   anchors and aliases *do* work within a single file, but neither crosses a file boundary.

## What each track needs

Track N's starting state is exactly the concatenation of the *solve* scripts for every
module before it. That is the whole specification, and it means the seeding and the solve
scripts should share one implementation or they will drift.

| Track | Title | `LAB_MODULE` | Integrations to pre-create | Variants to pre-apply | Plugin toolchain | Challenge timelimit |
|---|---|---|---|---|---|---|
| 1 | Foundations | n/a | none | none | no sandbox at all | 600 |
| 2 | Incoming Webhooks | 2 | none | none | no | 2400 |
| 3 | Outgoing Webhooks | 3 | `incoming-webhook` | `mod2` | no | 2400 |
| 4 | Slash Commands | 4 | `incoming-webhook`, `outgoing-webhook` | `mod2`, `mod3` | no | 2400 |
| 5 | Post Actions and Dialogs | 5 | `incoming-webhook`, `outgoing-webhook`, `slash-command` | `mod2`, `mod3`, `mod4` | no | 2700 |
| 6 | Plugins | 6 | `incoming-webhook`, `outgoing-webhook`, `slash-command` | `mod2` to `mod5` | **yes** | 1800 + 1800 |

There is no separate curriculum module column, because it is the track number.

Integration kinds come from `bin/lab-create-integration`, which supports exactly
`incoming-webhook`, `outgoing-webhook`, and `slash-command`. Modules 5 and 6 add no new
Mattermost-side integration, which is why the last two rows repeat rather than grow.

Track 6's two challenges need no seeding between them: they share a sandbox, so the
learner's own server-side plugin carries into the webapp challenge. That is the point of
decision 2.

Track timelimit should be the challenge total plus provisioning and slack, so roughly
`challenge + 900`. Do not simply reuse the current 16200.

## Work items

### W1. Copy the shared files, and add `bin/check-track-drift`

No generator. Each of the six directories is a complete track that can be edited in place
and pushed with `cd tracks/4-slash-commands && instruqt track push`, exactly as `track/`
works today.

The copies themselves arrive from W4, which lets the platform clone the existing track
rather than copying files by hand. W1's job is what happens afterwards: keeping them
comparable, and noticing when they stop being so.

All four shared files vary not at all, so they stay literal copies:

```
config.yml                       identical in all five sandbox tracks
track_scripts/setup-a-postgres   identical
track_scripts/setup-mattermost   identical
track_scripts/cleanup-workbench  identical
```

`setup-workbench` is the one file with real per-track variation, and it is expressed
**inside** the file as two variables near the top rather than by templating:

```bash
# The only lines that differ between tracks. Everything below is identical everywhere.
LAB_TRACK=3
NEEDS_PLUGIN_TOOLCHAIN=false
```

with W2's conditional reading `NEEDS_PLUGIN_TOOLCHAIN`. Tracks 2 to 5 therefore carry the
plugin toolchain code behind a false flag. That is deliberate: it keeps all five copies
byte-identical apart from those two lines, so the drift check can cover `setup-workbench`
too, and moving a module between tracks becomes a flag change rather than a code move.

`bin/check-track-drift` md5s the four shared files across the five sandbox tracks, and
compares `setup-workbench` with the two variable lines normalised out. It prints which
tracks disagree and exits non-zero. Perhaps thirty lines of shell. Wire it into a pre-push
hook and into W6.

**Do not extend this to `track.yml` or to the challenge directories.** `track.yml` is
per-track by nature: slug, id, title, teaser, description and timelimit all differ, and
`checksum` is rewritten by `instruqt track push` on every push. Challenge directories carry
platform-assigned ids (`id: y4lxcwyswyzs`, and a `tabs:` id per tab), so anything that
rewrote them would have to round-trip through `instruqt track pull` to stay valid. Each
challenge lives in exactly one track, so there is nothing to duplicate anyway.

Acceptance: `bin/check-track-drift` is clean, and `instruqt track validate` passes in all
six directories.

### W2. Make the plugin toolchain conditional

In `setup-workbench`, gate on the `NEEDS_PLUGIN_TOOLCHAIN` variable from W1:

- `install Go`, `go mod download`, `go compile test binary`, `npm install plugin webapp`,
  `make bundle`, and the `plugin/` copy run only for track 6.
- Everything else runs everywhere.

Keep the phase timing instrumentation in both paths so the difference is measurable rather
than assumed.

Acceptance: track 2's summary shows no Go or plugin phases, and its total is materially
lower. Track 6's summary is unchanged from today's.

### W3. `bin/lab-seed-prior-modules <module>`

New script. For each module M from 2 to N-1: create M's integration if it has one, then
`apply-variant.sh modM solution`. Called from each track's `setup-workbench` after
`lab-seed`. Because the track number is the module number, the argument is just the track
number.

This is the same work the solve scripts already do, so factor it so both use it and neither
drifts. Note it must run before `chown -R learner:learner`, and that
`lab-create-integration` is already idempotent.

Acceptance: on a fresh track 5 sandbox, before the learner touches anything, the checks for
modules 2 to 4 pass and module 5's own first check fails. That asymmetry is the definition
of correct seeding.

### W4. Create the remote tracks by copying the existing one

`instruqt track create` takes a `--from` flag that copies a remote track:

```bash
instruqt track create --from mattermost/platform-extensions \
                      --title "Platform Extensions 4: Slash Commands"
```

**Use it for all five sandbox tracks.** It does three jobs at once: the platform assigns
fresh track, challenge and tab ids; the shared `config.yml` and `track_scripts/` arrive
already correct; and there is no window in which a hand-copied `id:` points at the wrong
track. Then `instruqt track pull` each one into `tracks/N-slug/`, delete the challenges it
does not need, and apply W1's two variables and W5's copy edits.

Track 1 is created empty (`instruqt track create --title "Platform Extensions 1:
Foundations"`), since it has no sandbox and nothing to copy.

**Never hand-copy an `id:`.** The current track carries 31 platform-assigned ids: one track
id, six challenge ids, and 24 tab ids, all opaque 12-character strings. If `--from` ever
proves unsuitable, the verified fallback is to strip every `id:` and the `checksum:` from a
copied directory and let push assign them; that passes all five validate stages, confirmed
locally.

**Leave the existing `platform-extensions` track in place** until the new ones are verified
end to end. It is the rollback.

### W5. Assignment copy

Only one cross-track reference exists, which is a pleasant surprise:

- `track/04-actions-and-dialogs/assignment.md:10` says "The automatic escalation from
  Module 3", which becomes a reference to a track the learner may not have taken. Reword to
  describe the behaviour as already present in the environment. The module number it cites
  is now also a track number, so if the reference is kept it should read as one.

The two references in `06-plugin-webapp/assignment.md` (lines 61 and 93, "the previous
challenge") stay correct, because both challenges live in track 6.

**Every track from 3 up needs a note saying earlier modules are already working.** This is
the gap the grep did not find, because it is an absence. A learner opening track 5 sees a
handler full of code they did not write, and nothing currently explains it. One paragraph in
the first `notes:` block of each track, naming what is already in place and that they are
expected to build on it rather than start clean.

Track 1's assignment is **placeholder text**: enough to state the scenario, name the five
labs that follow, and say the theory is coming. Mark it clearly as a placeholder in the file
so nobody mistakes it for finished copy.

Each track also needs its own `track.yml` teaser and description. The current description
narrates all five modules as one journey and cannot be reused verbatim.

### W6. Verification

Per track, in order:

1. `bin/check-track-drift`, once, covering all five sandbox tracks
2. `instruqt track validate`
3. `instruqt track push`
4. A launch, reading the phase summary and confirming the setup shape
5. `instruqt track test`, which is now feasible per track rather than as one 40-minute run

Steps 4 and 5 are close to vacuous for track 1, which has no sandbox and no lifecycle
scripts. The five sandbox tracks are the real work.

`instruqt track test` on five small tracks is the closest this repo has come to the CI loop
`CLAUDE.md` describes as unbuilt. Worth capturing that as a side benefit.

### W7. Retire the old track

Only after all six pass. `instruqt track delete`. Update `README.md`, `DESIGN.md`,
`CLAUDE.md`, and `track/README.md`, including the documented workflow, which currently says
`cd track && instruqt track push` and will need to describe six directories.

## Duplication: measured, then decided

A generator was the earlier plan. The measurements do not support it.

**How much is actually shared.** Of everything in a track directory:

| File | Lines | Varies per track? |
|---|---|---|
| `config.yml` | 153 | **No.** Byte-identical, nothing in it is module-specific |
| `track_scripts/setup-mattermost` | 151 | No |
| `track_scripts/setup-a-postgres` | 28 | No |
| `track_scripts/cleanup-workbench` | 23 | No |
| `track_scripts/setup-workbench` | 577 | Yes: 2 variables plus ~75 lines behind one conditional |
| `track.yml` | 43 | Yes, and per-track by nature |
| challenge directories | n/a | Each lives in one track. Not duplicated at all |

So the duplicated surface is about 930 lines, of which roughly 855 never vary and 75 vary by
a single boolean.

**How often the shared files change.** Over the whole life of the repo:

```
17 commits   track_scripts/setup-workbench
 6 commits   config.yml
 5 commits   track_scripts/setup-mattermost
 3 commits   track_scripts/setup-a-postgres
 2 commits   track_scripts/cleanup-workbench
```

The four zero-variation files have changed 16 times between them, ever. One commit (25e5619,
the `a-postgres` rename) touched three of them at once, which is the exact shape of change
that would need to land in five places. That is the real cost of copying, and it is small.

**The precedent is already in the repo, at a higher multiple.** The six challenge directories
each hold four lifecycle scripts that are already hand-maintained copies:
`cleanup-workbench` is byte-identical in all six (md5 `83bd153b`), and `check-workbench`,
`setup-workbench` and `solve-workbench` differ only by a module number. Twenty-four files,
six-way duplicated, maintained by hand for the life of the project, and it has caused no
trouble. Five-way duplication of four files is a smaller version of a problem this codebase
has already demonstrably absorbed.

**What a generator would cost.** It would silently revert any hand edit to a generated file,
which is the objection that killed it: someone tweaking `config.yml` in a sandbox directory
and pushing would find their change gone at the next `gen-tracks`. It also adds a step
between "edit the setup script" and "push the track", and `track/README.md` explicitly values
those scripts being testable without a git push. Detecting drift preserves all of that;
preventing drift does not.

**Where the churn actually is.** Note the inversion: the file that changes most,
`setup-workbench`, is also the only one with genuine variation, so it is the one a generator
would have helped with most. That is handled instead by keeping the variation to two
variables, which makes the copies comparable and puts the file back under the drift check.
Much of its 17-commit history was the track being built rather than maintained, but expect a
spike during W2 and again if the VM image work happens.

**When to revisit.** If `check-track-drift` starts failing regularly, or if a second real
per-track difference appears in `config.yml`, copying is no longer paying. The first likely
candidate is a larger `machine_type` for track 6, which would be `config.yml`'s first genuine
variation, so write the drift check to compare per-key rather than per-file if that is cheap.

## Risks, and the decision taken for each

Every entry here is decided. Where a decision rests on something that could change, the
trigger that would reopen it is named.

**Five sandboxes instead of one.** *Decided: proceed, the cost is bounded and small.* The
delta is provisioning overhead, not sandbox hours: today one sandbox is held for the whole
path, and after the split each is held only for its own module and then released. Measured,
setup across the five tracks totals roughly 17 minutes against about 6 today, so about 11
extra minutes of sandbox time per learner against a multi-hour path, under 5 percent. W2
shrinks it further. It is also partly offset, since a learner who pauses between modules
today either holds a sandbox or loses their work. **Reopens if** Instruqt bills per sandbox
launch rather than per minute, which is the one billing shape that would make five
provisionings materially worse than one.

**Drift across five copies of the shared files.** *Decided: detect, do not prevent.*
`bin/check-track-drift` from W1. A shared fix has to land five times and the check is what
tells you when it landed four. The failure it guards is quiet, since a stale
`setup-mattermost` in one track shows up as one track behaving differently, weeks later. Run
the check before every push, not after. **Reopens if** the check starts failing regularly, or
if a second genuine per-track difference appears in `config.yml`.

**Two sources of truth during the transition.** *Decided: freeze `track/` at the split
commit.* While both layouts exist, `track/` is the rollback and is never edited again. Any
fix goes into `tracks/` only. Without this rule a fix lands in the old tree, the drift check
does not cover it because it only looks at `tracks/`, and the fix is lost at W7.

**Renaming `track/` to `tracks/`.** *Decided: do it, in one commit, docs included.* `track/`
is deleted in W7 rather than kept locally, because the remote track is the rollback and git
history is the local one. Keeping a stale copy on disk is what causes the previous risk.

**Platform-assigned ids.** *Decided: `instruqt track create --from`, per W4.* The current
track carries 31 of them. Copying a directory by hand and pushing it would be the single
easiest way to corrupt a track, and the platform will do the copy for us.

**Learners taking tracks out of order.** *Decided: solve it in copy, because there is no
mechanism.* Nothing in `track.yml` expresses a prerequisite. Each track's description states
which track precedes it, and W5's note explains that earlier modules arrive already working.
If the platform does have a prerequisite or ordering feature, use it and keep the copy
anyway.

**Assignments written for a single continuous sandbox.** *Decided: one reword, one addition,
both in W5.* Checked rather than assumed: grepping all six assignments for prior-work
references turns up only `04-actions-and-dialogs/assignment.md:10` ("The automatic escalation
from Module 3") as genuinely cross-track. `03:11` and `05:10` say "everything so far" but
stay true of a seeded environment, and `06`'s two "previous challenge" references stay inside
track 6. The real gap is the absence W5 now covers.

**Seeding and the solve scripts drifting apart.** *Decided: one implementation, per W3.*
`bin/lab-seed-prior-modules` and the per-challenge `solve-workbench` scripts do the same
work. If they are written twice they will disagree, and the symptom is a track that seeds a
state no solve script produces, which grades as a learner error.

**Track 1 has no content yet.** *Decided: ship it with placeholder text.* It exists for the
numbering and the navigation. W6 does not block on it, and it has no sandbox, so it cannot
fail in a way that affects anything else.

**Per-challenge `cleanup-workbench` becomes mostly redundant.** *Decided: keep all of them,
unchanged.* Every track starts clean, so the reset only matters between track 6's two
challenges. Leaving the rest in place is harmless and cheaper than proving they are
unnecessary.

**The grader needs no changes, and now it needs no mental arithmetic either.** *Decided:
change nothing.* Module numbers stay 2 to 6, `check-challenge.sh <module> <challenge>` is
unchanged, and the module argument is now the same number as the track. `check-challenge.sh
4 1` is track 4's only challenge; `check-challenge.sh 6 2` is track 6's second. Removing the
offset is half the point of numbering Foundations 1, so do not reintroduce one by renumbering
anything to be zero-based.

## Explicitly out of scope

- The custom VM image. Re-measure after W2; tracks 2 to 5 should land near two minutes with
  no image, which changes what is worth baking and possibly how many images are needed.
- The `apt-get update` race that costs ~25 s (`cloud-init status --wait` would fix it). Only
  worth doing if the image work is abandoned, since an image removes apt from the run.
- Trimming the 90 s stability hold in `setup-mattermost`. Two measured runs never entered
  that path, so it is not on the critical path.
