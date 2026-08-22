package main

import (
	"github.com/pkg/errors"
)

// configuration mirrors the settings_schema block in plugin.json.
//
// Mattermost hands the plugin a fresh copy whenever an admin saves the System Console
// form, so it must never be mutated in place. Read it through getConfiguration and treat
// the result as immutable.
type configuration struct {
	// AlertsChannelID scopes the capture hook. Track setup fills this in.
	//
	// A channel ID rather than a name, on purpose. See resolveAlertsChannel in
	// alerts_channel.go.
	AlertsChannelID string
}

// getConfiguration returns the active configuration, never nil.
func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	if p.configuration == nil {
		return &configuration{}
	}

	return p.configuration
}

// OnConfigurationChange is called once at activation and again on every save.
func (p *Plugin) OnConfigurationChange() error {
	cfg := new(configuration)

	if err := p.API.LoadPluginConfiguration(cfg); err != nil {
		return errors.Wrap(err, "failed to load plugin configuration")
	}

	p.configurationLock.Lock()
	p.configuration = cfg
	p.configurationLock.Unlock()

	// A changed setting invalidates whatever channel we had resolved and cached.
	p.alertsChannelLock.Lock()
	p.alertsChannelID = ""
	p.alertsChannelLock.Unlock()

	return nil
}
