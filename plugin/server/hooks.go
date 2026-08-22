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
//
// TODO Your task:
//
//  1. Ignore anything that is not in the alerts channel. Use p.resolveAlertsChannel()
//     and compare against post.ChannelId. Do not compare channel names.
//  2. Pull severity, source, indicator, and timestamp out of the attachment fields.
//     post.Attachments() gives you []*model.SlackAttachment, and the values are in
//     Fields, not in post.Message. There is a helper below for reading a field by title.
//  3. Store an AlertRecord at status StatusOpen with p.putAlert.
//
// Fire an alert with `fire-alert.sh --severity CRITICAL` and then read it back with:
//
//	curl -s localhost:8065/plugins/com.mattermost.cert-alerts/api/v1/alert/<post_id>
func (p *Plugin) MessageHasBeenPosted(_ *plugin.Context, post *model.Post) {
	_ = post
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
