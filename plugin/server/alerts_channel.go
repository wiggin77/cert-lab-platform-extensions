package main

import (
	"strings"

	"github.com/pkg/errors"
)

// Fallbacks used when the AlertsChannelID setting is empty, so the plugin still works if
// it is deployed by hand rather than by track setup.
const (
	defaultTeamName    = "soc"
	defaultChannelName = "alerts"
)

// resolveAlertsChannel returns the ID of the channel the capture hook watches.
//
// Why an ID and not a name: Channel.Name is the URL slug and Channel.DisplayName is what
// the sidebar shows. They drift apart the moment somebody renames a channel, and neither
// is unique across teams. The ID is stable and unique, so it is the only safe thing to
// compare a post against.
//
// The result is cached because MessageHasBeenPosted runs for every post on the server,
// and an API round trip per post would be a real cost.
func (p *Plugin) resolveAlertsChannel() (string, error) {
	p.alertsChannelLock.RLock()
	cached := p.alertsChannelID
	p.alertsChannelLock.RUnlock()

	if cached != "" {
		return cached, nil
	}

	resolved, err := p.lookupAlertsChannel()
	if err != nil {
		return "", err
	}

	p.alertsChannelLock.Lock()
	p.alertsChannelID = resolved
	p.alertsChannelLock.Unlock()

	return resolved, nil
}

func (p *Plugin) lookupAlertsChannel() (string, error) {
	if id := strings.TrimSpace(p.getConfiguration().AlertsChannelID); id != "" {
		return id, nil
	}

	// No setting, so fall back to a name lookup. This is the one place a name is
	// acceptable: converting it to an ID once, rather than comparing it per post.
	channel, appErr := p.API.GetChannelByNameForTeamName(defaultTeamName, defaultChannelName, false)
	if appErr != nil {
		return "", errors.Wrapf(appErr, "no AlertsChannelID configured and ~%s not found in team %s", defaultChannelName, defaultTeamName)
	}

	return channel.Id, nil
}
