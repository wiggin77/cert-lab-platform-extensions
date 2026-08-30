#!/usr/bin/env bash
#
# Provision the baked workbench VM image.
#
# WHY THIS FILE EXISTS. Instruqt Host images are built by typing into a browser terminal
# (Settings -> Host images -> Create image -> Customize your image). That makes the image's
# provenance a click path, which is the one thing this repo consistently refuses: the five
# copied config.yml files, bin/check-track-drift and the deliberate absence of a track
# generator all exist to keep shared state reviewable. So the build gesture stays manual,
# but the CONTENT does not: paste and run this script in that terminal, and `git log`
# explains every package in the image.
#
#   curl -fsSL https://raw.githubusercontent.com/wiggin77/cert-lab-platform-extensions/main/image/provision.sh | sudo bash
#
# or paste it. Then Save, and reference the image from config.yml as `mattermost/<NAME>`
# (Instruqt Host images use TEAM_NAME/IMAGE_NAME; our team slug is `mattermost`).
#
# WHAT THIS IS NOT ALLOWED TO BE. The image is an optimisation, never a dependency.
# setup-workbench verifies before it installs, so a stale or absent image costs time and not
# correctness, and rolling back is one `image:` line. Nothing here may be load bearing.
#
# WHAT DELIBERATELY IS NOT HERE, and the reasons are in
# implementation-plans/bake-a-workbench-vm-image.md:
#   - the lab repo clone      1s, and baking it would break LAB_REPO_REF branch testing
#   - labsvc/handler node_modules   5s, and a baked copy can disagree with package-lock.json
#   - anything Mattermost-side      those are containers, not this VM
#   - the Go BUILD cache      phase 2, and it self-evicts after five days (see the plan)
#
# THE VERSIONS BELOW MUST MATCH setup-workbench. They are duplicated because this script
# runs where the repo is not checked out. `bin/check-track-drift` asserts they agree, so a
# bump in one place fails the check rather than silently producing a stale image.
#
set -euo pipefail

NODE_MAJOR=22
GO_VERSION=1.25.5

# Overridable so a rebuild can be labelled deliberately. The marker is what makes
# "why was that run slow" answerable after the fact: setup-workbench logs it on every boot,
# and its absence means the stock base image.
IMAGE_VERSION="${IMAGE_VERSION:-$(date -u +%Y%m%d-%H%M)}"

if [ "$(id -u)" -ne 0 ]; then
    echo "provision.sh must run as root (try: sudo bash provision.sh)" >&2
    exit 1
fi

log() { echo "[image] $*"; }

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# apt packages
# ---------------------------------------------------------------------------
# `make` is here rather than relying on build-essential, matching setup-workbench: the
# Module 6 plugin build is driven by a Makefile, so make is required and build-essential is
# merely nice to have.
log "installing base packages"
apt-get update
apt-get install -y -qq git curl jq make ca-certificates

# Allowed to fail here for the same reason it is allowed to fail at setup: nothing in the
# lab needs a C toolchain, since Mattermost plugins build with CGO_ENABLED=0.
log "installing build-essential (optional)"
apt-get install -y -qq build-essential || log "build-essential unavailable, continuing"

# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------
log "installing Node ${NODE_MAJOR}"
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
apt-get install -y -qq nodejs
log "node $(node --version), npm $(npm --version)"

# ---------------------------------------------------------------------------
# Go
# ---------------------------------------------------------------------------
# Only Module 6 uses Go, but it goes in the single shared image anyway: the track 6 profile
# is a strict superset of the others, and two images would be a divergence risk at a layer
# no check covers. See "Why one image" in the plan.
#
# Must stay at or above the `go` directive in plugin/go.mod (1.24.11 today). An older
# toolchain does not say "upgrade Go", it tries to download a newer one and hangs.
log "installing Go ${GO_VERSION}"
curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tgz
rm -rf /usr/local/go
tar -C /usr/local -xzf /tmp/go.tgz
rm /tmp/go.tgz
ln -sf /usr/local/go/bin/go /usr/local/bin/go
ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
log "$(go version)"

# ---------------------------------------------------------------------------
# code-server
# ---------------------------------------------------------------------------
# Unpinned, which is why setup-workbench can only check that it is present and never that
# it is current. A baked code-server is therefore frozen until the image is rebuilt. That is
# the trade for 13s; it is recorded in the plan's rebuild triggers.
#
# No config is written here. setup-workbench owns ~learner/.config/code-server, because the
# learner account does not exist yet at image build time.
log "installing code-server"
curl -fsSL https://code-server.dev/install.sh | sh
log "code-server $(code-server --version 2>/dev/null | head -1)"

# ---------------------------------------------------------------------------
# Marker
# ---------------------------------------------------------------------------
cat > /etc/lab-image-version <<MARKER
${IMAGE_VERSION} node=${NODE_MAJOR} go=${GO_VERSION}
MARKER
chmod 644 /etc/lab-image-version

log "done. /etc/lab-image-version: $(cat /etc/lab-image-version)"
log "reference this image from config.yml as: image: mattermost/<IMAGE_NAME>"
