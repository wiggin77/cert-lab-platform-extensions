# Baking a custom workbench VM image

Status: **W1, W2 and W3 done, 2026-08-30.** The image exists, all five tracks point at it,
and track 2 passed three consecutive runs on it.

The image is `mattermost/platform-extensions`: an Instruqt Host image, 10 GB,
`debian-cloud/debian-12` base, marker `20260830-0431 node=22 go=1.25.5`.

**Result: `setup-workbench` went from 77-112s to 14-15s, and the learner's wait from about
2m31s to about 50s.** The remaining ~26s of that is terraform, which is a fixed platform cost
no image can touch.

W4 (roll out and test all five) is running. W5 (the Go build cache) is still an open decision
and is now less attractive, since track 6's toolchain install was never the expensive part.

Depends on: the per-module track split, which is done. Read
`implementation-plans/split-into-per-module-tracks.md` first, since the split is what
determined how much an image is worth and to which tracks.

## Goal

Cut the time a learner watches the loading screen, by shipping a VM image with the toolchain
already installed instead of installing it on every sandbox boot.

**One image, used by all five sandbox tracks.** Not one per track. See "Why one image".

Read "Do this first" before costing the image. Research turned up a change that addresses
the same complaint for one line and no build.

## What the numbers say

A real track 2 run, 2026-08-30, end to end 2m31s:

```
26s   terraform apply           fixed platform cost, not addressable
 2s   setup-a-postgres
 3s   setup-mattermost          the cmd: fix holding, was ~2m25s when the race was lost
112s  setup-workbench           <- the target
 3s   challenge setup
```

`setup-workbench` broken down, and split by whether the work depends on this repo:

```
REPO INDEPENDENT, safe to bake          REPO DEPENDENT or per-run
  45s  apt base packages                  6s  start services
  23s  install Node 22                    3s  npm ci labsvc
  14s  install code-server                2s  npm ci handler
  ---                                     2s  write lab.env and seed Mattermost
  82s                                     2s  seed prior modules
                                          1s  git clone lab repo
                                          0s  write systemd units, wait for Mattermost
```

**82 of 112 seconds is fetching and unpacking things that only change when someone
deliberately bumps a version.**

A second run, 2026-08-30, participant `nrpszjrjvp5r`, launched from the UI rather than by
`instruqt track test`:

```
 2s   setup-a-postgres
 3s   setup-mattermost
82s   setup-workbench
 4s   challenge setup          ~107s of scripts, ~2m13s including terraform
```

with `setup-workbench` splitting 30s apt, 25s Node, 13s code-server, 6s start services, 3s
npm ci labsvc, 2s seed, 2s npm ci handler, 1s clone. **68 of 82 seconds was the bakeable
layer, 83%**, against 73% on the 112s run. The bakeable fraction rises as the run gets
faster, because the repo-dependent remainder is nearly constant at 14s. On that run the image
would have meant `setup-workbench` in about 14s and the whole thing in about 1m05s.

The spread matters as much as the mean. `apt base packages` has measured 20s, 36s, 45s and
47s across runs, and `setup-workbench` totals have ranged 71s to 116s for byte-identical
input. Baking removes most of that variance, which a learner feels more sharply than the
average, because the loading screen has no progress bar.

Projected, tracks 2 to 5: **2m31s to roughly 1m05s.**

Track 6 also gains the same 82s, from 315s to ~233s. Its remaining cost is the Go build
(103s) and `make bundle` (87s), which is phase 2 below and a genuinely different decision.

## Do this first: the loading experience is a one-line change

Instruqt has a per-track **loading experience** setting with two values, and every track in
this repo is on the slower-feeling one. `track.yml` carries `enhanced_loading: false` in all
six tracks, and every `assignment.md` carries `enhanced_loading: null`, meaning "inherit the
track".

- `false` is **Notes only**: the learner sits on the launch screen and can page through the
  notes. They cannot reach the assignment until loading completes.
- `true` is **Full access**: the learner is moved into the challenge immediately and can read
  the notes *and the assignment* while the sandbox builds. Tabs that are not ready show
  their own loading bar. They cannot advance to the next challenge until it is ready.

This does not make anything faster. It changes 2m31s of staring at a progress bar into 2m31s
of reading the assignment, which is the actual complaint. It costs one line per `track.yml`
plus a push, it is reversible in the same one line, and it needs no image.

Two things to check when trying it, both cheap:

- Our assignments open by telling the learner to do something in Mattermost. On Full access
  they may click a tab that is still loading. Documented behaviour is a loading bar on that
  tab, not an error, but confirm it once rather than assuming.
- The loading messages are per track, not per tab (`lab_config.loadingMessages` is already
  `true`), so there is no way to say "Mattermost is still starting" specifically.

Do this before the image, measure how much of the complaint it absorbs, and let that inform
whether the image is still worth building. It is not an alternative to the image, it is the
cheap half of the same goal.

## Why one image, not two

There are two profiles, so two images looks natural: tracks 2 to 5 never use Go or the
plugin scaffold. Three reasons not to, and the third is weaker than it was.

1. **The fat profile is a strict superset.** Nothing tracks 2 to 5 need is absent from what
   track 6 needs. Two images would be duplication with a divergence risk, and a lean image
   that drifts to a different Node version than the fat one produces tracks that behave
   differently for reasons nothing checks. That is the failure class `bin/check-track-drift`
   exists to prevent, reintroduced at a layer no check covers.
2. **`config.yml` is byte-identical across all five today**, which is what lets the drift
   check md5 it directly. Two images means the `image:` line differs, `config.yml` stops
   being identical, and the check needs the same normalisation hack `setup-workbench`
   already needs. One image keeps that design intact.
3. **Unused content is probably close to free at boot, but this is NOT documented.** The
   claim rests on GCE populating a boot disk lazily from the image. Google does not document
   that behaviour for Compute Engine boot disks, and the image management best practices page
   says nothing about image size affecting boot or instance creation time. Treat it as
   plausible and unproven. It is cheap to settle: W3 measures track 2 on the fat image
   anyway, and track 2 uses none of the Go content, so its boot time *is* the experiment.
   Reasons 1 and 2 stand on their own if reason 3 turns out false.

## Building it: two routes, now with the actual steps

### Route A, an Instruqt Host image (recommended)

Built entirely inside the Instruqt team. No GCP project, no Packer, no service account
grants. Instruqt recommends it for anyone not already managing a cloud account.

1. **Settings** -> **Host images**.
2. **Create image**, upper right.
3. Enter an image name, optionally a description, and a **disk size**. The default is 10 GB.
4. Select a base image: an Instruqt preset, or your own in `PROJECT_ID/IMAGE_NAME` form.
5. **Next**.
6. On *Customize your image*, use the **terminal and code editor tabs** to install things.
7. **Save**, upper right.
8. Reference it from `config.yml` as **`TEAM_NAME/IMAGE_NAME`**. Our team slug is
   `mattermost` (`instruqt config list`), so the line becomes
   `image: mattermost/<IMAGE_NAME>`.

To edit later: Host images page, select the image, **Edit**, repeat steps 3 to 7.

**The catch, and it matters here.** Step 6 is an interactive browser terminal. The image is
built by hand, so its provenance is a click path and a shell history, not a file. This repo
has repeatedly chosen version-controlled, drift-checked artifacts over convenient ones (the
five copied `config.yml` files, `bin/check-track-drift`, the deliberate absence of a
generator). An image built by typing into a web terminal is the opposite of that.

**Mitigation, and it should be part of W2, not an afterthought.** Keep the provisioning in
the repo as `image/provision.sh`, and make step 6 literally "paste and run this script".
Then the image *contents* are version controlled and reviewable even though the build
gesture is manual, `git log` explains why a package is present, and a rebuild is
reproducible rather than remembered. The script is also the input to Route B or to Packer
later, so choosing Route A now does not strand the work.

### Route B, a custom GCP image

Only if Route A cannot express what we need. Steps, from the same doc:

1. GCP: Compute Engine -> VM instances -> **Create instance**, pick the boot disk OS.
2. SSH in, install everything, then **Stop** the instance.
3. Storage -> **Images** -> **Create Image**, source = that instance's disk, Location =
   **Regional**, and the doc's worked example uses `europe-west1`.
4. IAM -> **Grant access** -> principal
   `instruqt-track@instruqt-prod.iam.gserviceaccount.com`, role **Compute Image User**.
5. `image: YOUR_GCPPROJECT_ID/YOUR_IMAGE_NAME` in `config.yml`.

**Disk Images only. Machine Images do not work in Instruqt**, and the docs say so outright.

Either route must satisfy the custom image requirements: the **Google guest environment**
must be installed (Instruqt uses it to inject the bootstrap startup script), and TCP to the
Instruqt agent on **ports 15778 and 15779** must be allowed, which is what serves the
Terminal and Editor tabs and runs lifecycle scripts. An Instruqt preset base already
satisfies both; a hand-rolled or imported image is where this bites.

## What goes in the image

Derived from `setup-workbench`, and every line reference below re-verified against the file:

```
apt      git curl jq make ca-certificates          (setup-workbench:205)
apt      build-essential                           (:218, allowed to fail, track 6 only)
Node     22, via deb.nodesource.com                (:229, NODE_MAJOR at :53)
Go       1.25.5                                    (GO_VERSION at :59, track 6 only)
         code-server, via code-server.dev/install.sh  (:598)
```

Base image must be **Debian family**. Alpine/musl fails to provision with an SSH handshake
error, because Instruqt injects its own `sandbox-agent` as PID 1. Our current base,
`ubuntu-os-cloud/ubuntu-2204-lts`, is on Instruqt's supported public image list, alongside
`debian-cloud/debian-11` and `-12`, `ubuntu-os-cloud/ubuntu-2404-lts-amd64`, the
`rhel-cloud` and `suse-cloud` families, and Instruqt's own `instruqt/k3s-*` and
`instruqt/docker-28-3`. Stay on 22.04 unless there is a reason not to: changing the base and
adding a bake at the same time makes a regression ambiguous.

Go and `build-essential` go in even though only track 6 uses them, per "Why one image".

## What does NOT go in the image

- **The repo clone.** It measures 1s, and baking learner-facing code would mean an image
  rebuild instead of a `git push` for any fix, breaking `LAB_REPO_REF` branch testing.
- **`labsvc` and `handler` `node_modules`.** 5s combined, and they are pinned by
  `package-lock.json` in the repo, so a baked copy can disagree with the lockfile the clone
  brings. Not worth the staleness for 5s.
- **Anything Mattermost-side.** The image is the workbench VM only. Mattermost and Postgres
  are containers and already start from official images.
- **The Go build cache**, for now. That is phase 2 and has its own hazards.

## Disk size is headroom, not speed

Worth settling because it is a tempting knob and the answer is no.

GCE persistent disk performance scales with disk size: `pd-standard` gets 0.75 read and 1.5
write IOPS per GiB and 0.12 MiB/s per GiB, `pd-balanced` gets 6 IOPS per GiB and 0.28 MiB/s
per GiB over a baseline. On those numbers a 10 GB `pd-standard` volume would be capped near
1.2 MiB/s, which would be a severe constraint.

**Existing measurements rule that out without a new run.** `npm ci labsvc` takes 3s and
produces 52 MB of `node_modules`, and the Go *module* cache rebuilds 251 MB in a few
seconds. At 1.2 MiB/s the module cache alone would take about three and a half minutes.
So the workbench boot disk behaves like `pd-balanced` or better, and the 10 GB size is not
throttling us.

Conclusion: **size the disk generously for phase 2 caches, but do not expect speed from it.**
Of the three hypotheses named in the comment at `setup-workbench:68` (bake an image, bigger
disk, bigger `machine_type`), the disk one is now closed.

The `machine_type` one is still open and is cheaper to test than an image. Instruqt documents
`machine_type` as a free-form field with no allow-list, and track 6's remaining 190s is two
CPU-bound compiles on two vCPU. Trying `n1-standard-4` on track 6 is a one-line change with
no build step, and it targets the half of track 6's cost that the image does not touch. It
has an obvious per-play cost implication, which is why it is a separate decision, but it
should be measured before phase 2 is attempted.

## Work items

### W1. Make `setup-workbench` image-agnostic first. DONE

Every install step is now verify-then-install:

```bash
if have_node "$NODE_MAJOR"; then
    log "Node $(node --version) already present, skipping install"
else
    ...existing install...
fi
```

The point is that **the image must be an optimisation, never a dependency**. With this, the
same script works on the stock base and on the baked image, a stale image degrades to
slow-but-correct rather than broken, and rolling back is changing one `image:` line rather
than reverting a script.

It also makes the image measurable: the phase summary will show `install Node 22` at 0s
instead of the phase vanishing, so a partially stale image is visible in the log rather than
silently costing time.

Keep the version variables (`NODE_MAJOR`, `GO_VERSION`) as the source of truth, and have the
check compare against them. An image carrying Node 20 when the script wants 22 must install
22, not accept what it finds.

Four helpers do the checking, at `setup-workbench:137`: `have_pkgs` (all-or-none over
`dpkg-query`), `have_node` (major version), `have_go` (exact version), and
`have_code_server` (presence only, since code-server is deliberately unpinned, which means a
baked one is frozen until the image is rebuilt).

`setup-workbench` also logs `/etc/lab-image-version` on every boot, so a run's log says which
image it booted, and no marker means the stock base.

Acceptance: with no image, every phase runs and totals are unchanged. **Met**, track 2,
participant `xmvjtktpcdgm`, 2026-08-30. `instruqt track test` succeeded end to end, the log
opened with `image: none, stock base image`, every install phase ran (30s apt, 22s Node, 12s
code-server), and the total was 77s, inside the 71s to 116s band the script had before the
change. No phase reported a skip, which is the correct result when no image exists.

Note what that does NOT prove. The skip path has never executed, because nothing has yet
booted with the toolchain preinstalled. W3 is its first real test, and the phase summary is
built to make it obvious: the three phases should report at or near 0s with a
`already present, skipping install` line each, rather than vanishing.

**The second source of truth is now checked.** `image/provision.sh` has to name
`NODE_MAJOR` and `GO_VERSION` again, because it runs in the Instruqt image builder where
this repo is not checked out. `bin/check-track-drift` compares the two and fails on
disagreement, which is what stops a version bump from quietly producing a stale image. A
stale image is otherwise invisible: setup just reinstalls the toolchain and the saving
disappears with nothing printed.

### W2. Build the image

DONE. Built 2026-08-30 as `mattermost/platform-extensions`, 10 GB, on
`debian-cloud/debian-12`. The customise step was `image/provision.sh` pasted into the browser
terminal, since the repo was not yet pushed for the curl form to work.

Note the base is Debian 12, not the Ubuntu 22.04 this document originally assumed, and not
the Debian 13 that measured fastest unbaked. Debian 12 is the right choice anyway: it is on
Instruqt's documented public image list where 13 is not, and once apt is baked the base's apt
speed stops mattering, which is exactly what the numbers in W3 show.

The original instructions, kept because rebuilding follows them again:

Route A, and `image/provision.sh` is written. Create the Host image from an Ubuntu 22.04
base, run that script in the browser terminal (paste it, or curl it from the repo's raw URL,
which the script's own header gives), Save, then record the image name and date here.

This step needs the Instruqt web UI, so it is the one part of this plan that cannot be driven
from the CLI.

Give the disk enough room for phase 2 even if phase 2 never happens, since resizing later is
more disruptive than provisioning generously now, and per the section above the extra space
costs nothing in speed either way.

### W3. Point ONE track at it and measure. DONE

Track 2 on `mattermost/platform-extensions`, three consecutive `instruqt track test` runs,
all passing, participants `f5htik76g9rf`, `jnx1vs7r7evh`, `b4atky8cebap`:

| Phase | Ubuntu 22.04, unbaked | Debian 13, unbaked | Debian 12, baked |
| --- | --- | --- | --- |
| apt base packages | 21-45s | 8s | 0s, 0s, 1s |
| install Node 22 | 22-25s | 15s | 1s, 1s, 0s |
| install code-server | 12-14s | 13s | 0s, 0s, 0s |
| `setup-workbench` total | 77s, 82s, 112s | 49s | **15s, 14s, 46s** |
| lifecycle scripts, end to end | ~107s | ~63s | **24s, 22s, 57s** |

Every run logged the marker and all three skip lines, so the verify-then-install path from W1
is confirmed working rather than merely present.

**Run 3's 46s was a 32s `git clone lab repo`**, against 0-1s in the other two. That is GitHub
network variance and nothing to do with the image. It is worth keeping in the record as the
reason three runs were required: a single run landing on that outlier would have understated
the result by a factor of three, and a single run landing on runs 1 or 2 would have hidden
that this variance still exists at all. It has not gone away, it has only stopped being
dominated by installs.

**Disk, now measured rather than estimated.** The image boots with `5.3G free` of 9.7G and
peaks at `4.1G used, 5.1G free`. 10 GB is correct, and the earlier suggestion of 20 GB was
unnecessary.

### W3 as originally written

Track 2, because it is the fastest to run and has no seeding to confuse the picture. Change
`image:` in `tracks/2-incoming-webhooks/config.yml` only, push, and run
`instruqt track test`.

This deliberately breaks the `config.yml` drift check, which is correct: it is real
divergence and the check should complain until the rollout finishes.

Read the phase summary, expecting `apt base packages`, `install Node 22` and
`install code-server` at or near 0s. **Run it three times**, not once. Given the 20s to 47s
spread on apt alone, a single run cannot distinguish a working image from a lucky boot. That
mistake has already been made once in this repo, on the `cmd:` fix, where a passing run
proved nothing because half of all runs passed anyway.

Track 2 also settles the open question from "Why one image" reason 3: it uses none of the Go
or plugin content, so if its `terraform apply` time is unchanged against the fat image, the
unused content really is close to free.

### W4. Roll out

Copy the `image:` line to the other four, push all five, confirm `bin/check-track-drift` is
clean again, and run the full five-track test batch.

### W5. Phase 2, the Go build cache. Separate decision.

Only track 6 benefits, and it is worth ~103s there (`go compile test binary`), plus 5s of
module cache and 5s of webapp `node_modules`.

Two hazards, and the first is easy to miss:

**Go trims its build cache.** Entries whose mtime is older than five days are evicted, and
the trim runs when the cache is opened if it has not run in 24 hours
(`cmd/go/internal/cache`). A baked `GOCACHE` carries mtimes from image build time, so **an
image more than five days old can have its cache evicted on first use and redo all 103s.**
The symptom is the worst kind: setup succeeds, nothing warns, and the saving is simply
absent, intermittently, depending on image age. Mitigate by `touch`ing the cache tree during
setup before any Go command runs, and measure that the touch itself is cheap.

**The cache is keyed by repo content.** Compiler version, build flags and source hash all
feed it, so bumping `server/public` or editing the plugin partially invalidates it. It
degrades to a partial hit, which is slower but correct, so this is a maintenance cost rather
than a correctness risk.

Decide this only after W4 is measured, and after `machine_type` has been tried, since that is
the cheaper lever on the same 190s. If track 6 at ~233s is acceptable, phase 2 may not be
worth the rebuild cadence it implies.

## Rebuild triggers

The image goes stale silently. Anything here means rebuilding it, which on Route A means a
manual Edit session in the web UI, so keeping this list short has real value:

| Change | Why |
| --- | --- |
| `NODE_MAJOR` in `setup-workbench` | baked Node no longer matches |
| `GO_VERSION` in `setup-workbench` | same, and `plugin/go.mod`'s `go` directive (1.24.11 today) can force it |
| the `install_pkgs` list at `:205` | a new package would be installed at runtime every boot |
| code-server, if a version is ever pinned | currently unpinned, installs latest |
| `plugin/go.mod`, if phase 2 happens | invalidates the baked build cache |

W1 is what makes these survivable: a stale image costs time, not correctness. Put a
`/etc/lab-image-version` marker in the image and log it in `setup-workbench`, so a run's log
says which image it booted. Without that, "why was this run slow" is unanswerable after the
fact.

## Sandbox presets: the answer to the five-copies problem, with a real cost

The previous version of this plan listed presets as uninvestigated. They are real, they are
documented, and they would centralise the `image:` line along with much more. They are also
not free.

**What they are.** A preset holds one sandbox configuration shared across many tracks,
exactly to prevent config drift. Create with `instruqt sandbox create`, edit `config.yml` and
`scripts/`, `instruqt sandbox push`, then `instruqt sandbox publish --message="..."`.

**How a track uses one.** Add `sandbox_preset: <slug>` to `track.yml`, then **delete the
track's `config.yml` and its entire `track_scripts/` directory**, and push. Challenge scripts
(`check-`, `solve-`, per-challenge `setup-`/`cleanup-`) live in the challenge directories and
are unaffected.

That deletion is the whole trade. The preset would absorb precisely the four files
`bin/check-track-drift` currently guards (`config.yml`, `setup-a-postgres`,
`setup-mattermost`, `cleanup-workbench`) plus `setup-workbench`, and the drift check could
then be deleted rather than maintained. But `setup-workbench` is not identical across tracks:
it varies by `LAB_TRACK` and `NEEDS_PLUGIN_TOOLCHAIN`, and a preset has one copy.

**There is a way out, and it needs one experiment.** Lifecycle scripts get
`INSTRUQT_TRACK_SLUG` in the environment. Our slugs are
`platform-extensions-<N>-<name>`, so `LAB_TRACK` could be parsed out of the slug and
`NEEDS_PLUGIN_TOOLCHAIN` derived as `[ "$LAB_TRACK" = 6 ]`. That would make the shared script
genuinely shared, with zero per-track lines. Unverified: that `INSTRUQT_TRACK_SLUG` is
actually populated in a *track* setup script. Prove it with one echo before designing on it.

Four consequences to weigh, all of them found in the docs rather than guessed:

- **Publishing a preset immediately updates every track using it**, and drains any shared hot
  start pool. Today a bad `setup-workbench` edit reaches one track per `instruqt track push`.
  With a preset, one publish reaches all five at once. That cuts both ways: it is the fix for
  "a shared fix lands four times", and it is a much larger blast radius.
- **`instruqt track validate` stops being local-only.** Tested here: adding
  `sandbox_preset:` to a copy of track 2 and removing `config.yml` makes validate call the
  API (it returned `failed to remote config (some-preset-slug): graphql: Unauthorized` for a
  slug that does not exist). CLAUDE.md currently documents validate as local only. That would
  need correcting, and validate would need network and auth.
- **Presets are drafts until published**, which is a review step the current copy-and-push
  flow does not have. Probably an improvement.
- **Hot start interacts badly with slug-derived variables.** Track setup scripts run in
  advance for hot start pools, and pools can be scoped to a preset, shared across every track
  using it. A sandbox provisioned into a preset-scoped pool has no single track, so anything
  derived from `INSTRUQT_TRACK_SLUG` is unsafe there. Not a problem today (no pools), but it
  forecloses the shared-pool option, which is the main reason presets exist besides drift.

**Recommendation: not now.** Do it as its own change, after the image work, so that if the
five tracks start behaving differently there is only one new variable. But it is the right
long-term answer to the copies, and it is a stronger one than a generator, because it moves
the sharing into the platform instead of into a build step.

## Hot start: correctly ruled out for now, but not forever

`setup-workbench:14` and `config.yml` both say hot start is ruled out on cost. The docs back
that verbatim: "You are billed for Hotstarted sandboxes, even if end users are not using
them."

Worth recording the nuance, because the comments read as a permanent no. That billing note
applies to an always-hot pool. Instruqt also documents **scheduled** pools with a start and
end date, which the docs recommend specifically for live events, and warn that pools without
an end date "can lead to significantly high bills". A certification cohort with a known date
is exactly the scheduled case, and for that a pool would take the wait to near zero for the
duration and then stop costing anything.

So: correct to rule out for on-demand self-paced use, worth reconsidering if this
certification is ever run as a cohort. That is a delivery decision, not an engineering one.

## Risks

**A single measurement will mislead.** `setup-workbench` has ranged 71s to 116s on identical
input. Any before-and-after claim needs at least three runs on each side. See W3.

**The image build is a click path, not a file.** Route A's customise step is an interactive
browser terminal. `image/provision.sh` in W2 is the mitigation and is not optional; without
it, the only record of what is in the image is whoever built it.

**Whether unused image content is free at boot is still unproven.** Google does not document
lazy hydration of boot disks from images, and the image size question is absent from their
image management guidance. W3 answers it for our case as a side effect.

**The image is a second source of truth for the toolchain.** `setup-workbench` says Node 22
and Go 1.25.5; the image also says so, in a place not under version control. W1's
verify-then-install keeps the script authoritative, and the version marker makes the
disagreement visible. Do not skip either.

**Five `config.yml` copies name the image.** Changing it is five edits, caught by
`bin/check-track-drift`. The sandbox preset section above is the real fix, deferred
deliberately.

## Sources

Instruqt docs, fetched 2026-08-29:

- Custom VM images (both routes, requirements, IAM, `TEAM_NAME/IMAGE_NAME`):
  <https://docs.instruqt.com/sandboxes/hosts/create-a-custom-vm-image>
- Public images (supported base list):
  <https://docs.instruqt.com/sandboxes/hosts/using-custom-public-images>
- Add hosts (`virtualmachines` fields, container `cmd`):
  <https://docs.instruqt.com/sandboxes/hosts/add-hosts>
- Sandbox presets: <https://docs.instruqt.com/sandboxes/manage/build-sandbox-presets>
- Hot starts, including the billing note: <https://docs.instruqt.com/sandboxes/manage/hot-start>
- Loading experience: <https://docs.instruqt.com/tracks/manage/loading-experience>

The whole corpus is available as one file at <https://docs.instruqt.com/llms-full.txt>, which
is far faster to search than the site. GCE persistent disk performance figures come from
<https://docs.cloud.google.com/compute/docs/disks/performance>.

Verified locally rather than from docs: team slug `mattermost` (`instruqt config list`); the
CLI has no image subcommand, so image creation is web UI or GCP only; `sandbox_preset` is
accepted by `instruqt track validate` and resolved remotely; every `setup-workbench` line
reference in this document.
