# Build and deploy the alerts plugin.
#
#   make               build both halves and package the bundle
#   make test          run the server side tests, no deploy needed
#   make deploy        build, then upload and enable it on the lab server
#   make build-server  just the Go binary
#   make build-webapp  just the webapp bundle
#   make clean
#
# Deploy uploads over the REST API rather than copying files into the plugin directory.
# It has to: Mattermost runs in its own container on this track and the plugin directory
# is not on this machine. Uploading is also what a real deployment does.

PLUGIN_ID = com.mattermost.cert-alerts
PLUGIN_VERSION = 0.1.0
BUNDLE_NAME = $(PLUGIN_ID)-$(PLUGIN_VERSION).tar.gz

MM_URL ?= http://mattermost:8065
LAB_ENV ?= /etc/lab.env

# CGO off and a static build, because the binary runs inside the Mattermost container,
# which does not necessarily have the same libc as this machine.
GO_BUILD_ENV = CGO_ENABLED=0 GOOS=linux GOARCH=amd64

# server/public requires Go 1.24.11 or newer. Track setup installs a newer one than that.
# If this errors with a version complaint, `go version` is the thing to check first.
GO ?= go

# Note there is a real ./webapp directory, so the build targets below are named for what
# they produce rather than "webapp". A phony target sharing a name with a directory works
# until somebody removes the .PHONY line, and then it stops rebuilding with no error.
.PHONY: all test build-server build-webapp bundle deploy clean check-style

all: bundle

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
# The server side tests are the spec for this challenge, and they run against an in-memory
# KV Store rather than a server. Use them as the inner loop: they finish in under a
# second, where a deploy plus firing an alert is most of a minute.
test:
	$(GO) test ./server/

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
build-server:
	@echo "--- building the server binary"
	mkdir -p server/dist
	$(GO_BUILD_ENV) $(GO) build -trimpath -o server/dist/plugin-linux-amd64 ./server/

# ---------------------------------------------------------------------------
# Webapp
# ---------------------------------------------------------------------------
webapp/node_modules: webapp/package.json
	@echo "--- installing webapp dependencies"
	cd webapp && npm install --no-audit --no-fund
	@touch webapp/node_modules

build-webapp: webapp/node_modules
	@echo "--- building the webapp bundle"
	cd webapp && npm run build

# ---------------------------------------------------------------------------
# Bundle
# ---------------------------------------------------------------------------
# The tar must contain a single top level directory named after the plugin id, with
# plugin.json at its root. A flat archive is rejected on upload with a message that does
# not say which of the two rules was broken.
bundle: build-server build-webapp
	@echo "--- packaging $(BUNDLE_NAME)"
	rm -rf dist/$(PLUGIN_ID) dist/$(BUNDLE_NAME)
	mkdir -p dist/$(PLUGIN_ID)/server/dist dist/$(PLUGIN_ID)/webapp/dist
	cp plugin.json dist/$(PLUGIN_ID)/
	cp server/dist/plugin-linux-amd64 dist/$(PLUGIN_ID)/server/dist/
	cp webapp/dist/main.js dist/$(PLUGIN_ID)/webapp/dist/
	cd dist && tar -czf $(BUNDLE_NAME) $(PLUGIN_ID)
	@echo "--- built dist/$(BUNDLE_NAME) ($$(du -h dist/$(BUNDLE_NAME) | cut -f1))"

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------
# force=true replaces an already installed copy. Without it a second deploy fails with a
# conflict, which during development is every deploy after the first.
deploy: bundle
	@echo "--- uploading to $(MM_URL)"
	@token="$${MM_ADMIN_TOKEN:-$$(sed -n 's/^MM_ADMIN_TOKEN=//p' $(LAB_ENV) 2>/dev/null | tail -1)}"; \
	if [ -z "$$token" ]; then \
		echo "No admin token. Set MM_ADMIN_TOKEN, or check $(LAB_ENV)." >&2; \
		exit 1; \
	fi; \
	code=$$(curl -sS -m 300 -o /tmp/plugin-upload.json -w '%{http_code}' \
		-X POST "$(MM_URL)/api/v4/plugins" \
		-H "Authorization: Bearer $$token" \
		-F "plugin=@dist/$(BUNDLE_NAME)" -F 'force=true'); \
	if [ "$$code" -lt 200 ] || [ "$$code" -ge 300 ]; then \
		echo "upload failed with HTTP $$code:" >&2; \
		cat /tmp/plugin-upload.json >&2; echo >&2; \
		exit 1; \
	fi; \
	echo "--- enabling $(PLUGIN_ID)"; \
	code=$$(curl -sS -m 60 -o /tmp/plugin-enable.json -w '%{http_code}' \
		-X POST "$(MM_URL)/api/v4/plugins/$(PLUGIN_ID)/enable" \
		-H "Authorization: Bearer $$token"); \
	if [ "$$code" -lt 200 ] || [ "$$code" -ge 300 ]; then \
		echo "enable failed with HTTP $$code:" >&2; \
		cat /tmp/plugin-enable.json >&2; echo >&2; \
		exit 1; \
	fi; \
	echo "--- deployed. Reload the browser tab to pick up the new webapp bundle."

check-style: webapp/node_modules
	$(GO) vet ./server/
	gofmt -l -d ./server/
	cd webapp && npm run check-types

clean:
	rm -rf dist server/dist webapp/dist
