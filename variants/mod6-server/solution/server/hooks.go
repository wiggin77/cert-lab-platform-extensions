package main

import (
	"fmt"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// MessageHasBeenPosted runs after a post is saved, for every post on the server.
//
// It is a notification, not a filter: the post already exists and nothing returned here
// can change it. It also runs on the server's own goroutine, so slow work in here slows
// down posting for everybody. Do the cheap check first and return.
//
// Compare this with MessageWillBePosted, which runs before the save and CAN reject or
// rewrite the post. The wrong one of the two is a common mistake, and the symptom is
// confusing: your edits appear to be ignored.
func (p *Plugin) MessageHasBeenPosted(_ *plugin.Context, post *model.Post) {
	if post == nil {
		return
	}

	// Cheapest possible exit first. This hook sees every post on the server, including
	// direct messages in channels this plugin has no business reading.
	channelID, err := p.resolveAlertsChannel()
	if err != nil {
		p.API.LogWarn("cannot capture alerts, the alerts channel is unresolved", "error", err.Error())
		return
	}

	if post.ChannelId != channelID {
		return
	}

	// Ignore our own threaded replies. The AI skill posts back into the alert's thread,
	// and without this that reply is captured as though it were an alert of its own,
	// inflating the open count with records that have no fields.
	if post.RootId != "" {
		return
	}

	severity := attachmentField(post, "Severity")
	if severity == "" {
		// Not everything posted in the alerts channel is an alert. A human saying
		// "looking at this now" has no attachment, and is not a capture failure.
		return
	}

	record := &AlertRecord{
		PostID:    post.Id,
		ChannelID: post.ChannelId,
		Severity:  severity,
		Source:    attachmentField(post, "Source"),
		Indicator: attachmentField(post, "Indicator"),
		Timestamp: attachmentField(post, "Timestamp"),
		Status:    StatusOpen,
	}

	if err := p.putAlert(record); err != nil {
		p.API.LogError("could not store the alert", "post_id", post.Id, "error", err.Error())
		return
	}

	p.API.LogDebug("captured an alert", "post_id", post.Id, "severity", record.Severity)
}

// attachmentField returns the value of the first attachment field with the given title.
//
// Field titles are display strings, so they are matched case insensitively. Value is
// typed `any` because Slack compatible attachments allow a number there, which is why
// this returns a string rather than handing you the raw value.
func attachmentField(post *model.Post, title string) string {
	attachments := post.Attachments()
	if len(attachments) == 0 {
		return ""
	}

	for _, field := range attachments[0].Fields {
		if field == nil {
			continue
		}

		if strings.EqualFold(strings.TrimSpace(field.Title), title) {
			return cleanFieldValue(field.Value)
		}
	}

	return ""
}

// cleanFieldValue renders a field value as a plain string.
//
// The feed wraps indicators in backticks so they render as code in the message. Those
// backticks are formatting, not part of the indicator, and leaving them in means the
// stored value does not match the indicator anywhere else in the system.
func cleanFieldValue(value any) string {
	if value == nil {
		return ""
	}

	return strings.TrimSpace(strings.Trim(strings.TrimSpace(fmt.Sprintf("%v", value)), "`"))
}
