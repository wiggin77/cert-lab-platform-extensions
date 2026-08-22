package main

import (
	"net/http"
	"sync"

	"github.com/mattermost/mattermost/server/public/model"
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

	// Bot that authors the plugin's own posts, such as an AI skill's answer. Set once at
	// activation and only read afterwards, so it needs no lock.
	botID string
}

func (p *Plugin) OnActivate() error {
	// Resolving here means a misconfiguration shows up in the log at activation rather
	// than silently on the first alert. It is deliberately not fatal: returning an error
	// leaves the plugin listed as installed but not running, which makes a missing
	// channel look like a broken build.
	if _, err := p.resolveAlertsChannel(); err != nil {
		p.API.LogWarn("could not resolve the alerts channel yet, will retry on the first post", "error", err.Error())
	}

	// A plugin's posts need an author. EnsureBotUser is idempotent, so this is safe on
	// every activation, and a bot is preferable to posting as whichever user happened to
	// click the button: the answer is the plugin's, not theirs.
	botID, err := p.API.EnsureBotUser(&model.Bot{
		Username:    "soc-alerts",
		DisplayName: "SOC Alerts",
		Description: "Posts alert analysis from the SOC Alerts plugin.",
	})
	if err != nil {
		// Not fatal. Everything except the plugin's own posts still works, and failing
		// activation here would present as a broken build.
		p.API.LogWarn("could not ensure the plugin bot, AI skill replies will fail", "error", err.Error())
	} else {
		p.botID = botID
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
