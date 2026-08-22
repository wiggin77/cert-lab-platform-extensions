package main

import (
	"net/http"
	"sync"

	"github.com/mattermost/mattermost/server/public/plugin"
)

// Plugin is the server half of the alerts plugin.
//
// One instance is created per activation. Anything cached on it has to be guarded,
// because hooks and HTTP handlers run concurrently on different goroutines.
type Plugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration

	// The alerts channel is resolved once and cached. See alerts_channel.go.
	alertsChannelLock sync.RWMutex
	alertsChannelID   string
}

func (p *Plugin) OnActivate() error {
	// Resolving here means a misconfiguration shows up in the log at activation rather
	// than silently on the first alert. It is deliberately not fatal: returning an error
	// leaves the plugin listed as installed but not running, which makes a missing
	// channel look like a broken build.
	if _, err := p.resolveAlertsChannel(); err != nil {
		p.API.LogWarn("could not resolve the alerts channel yet, will retry on the first post", "error", err.Error())
	}

	p.API.LogInfo("alerts plugin activated")

	return nil
}

func (p *Plugin) OnDeactivate() error {
	p.API.LogInfo("alerts plugin deactivated")

	return nil
}

// ServeHTTP is the entry point for every request to /plugins/com.mattermost.cert-alerts/...
//
// Note the path Mattermost hands over here is already relative to the plugin, so a
// request to /plugins/com.mattermost.cert-alerts/api/v1/alerts/count arrives as
// /api/v1/alerts/count.
func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router().ServeHTTP(w, r)
}
