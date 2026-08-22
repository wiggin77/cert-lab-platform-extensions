package main

import (
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// alertPostType is what connects an alert post to your React component.
//
// registerPostTypeComponent(type, component) in the webapp matches on this exact string,
// so the two have to agree. It must start with "custom_": the server rejects any other
// unrecognised type (model/post.go, Post.IsValid).
const alertPostType = "custom_soc_alert"

// MessageWillBePosted stamps the custom type onto alerts before they are saved.
//
// You do not need to change this. It is here because without it the post card you build
// in the next challenge could never render: the threat feed is an external system posting
// over REST, and it has no reason to know about a type this plugin invented.
//
// Note which hook this is. MessageHasBeenPosted runs after the row is written, so it
// cannot change the post: setting a field there modifies a struct nobody reads again.
// Only the Will hook can rewrite a post, because it runs before the insert.
//
// The contract is easy to get wrong, so, from public/plugin/hooks.go:
//
//	return nil, ""        allow the post through unchanged
//	return post, ""       replace the post with the one returned
//	return nil, "reason"  reject it, and show the user that reason
//
// Every path that is not an alert returns (nil, "") here. This hook sees every post on
// the server, so a mistake in it does not break alerts, it breaks posting.
func (p *Plugin) MessageWillBePosted(_ *plugin.Context, post *model.Post) (*model.Post, string) {
	if post == nil {
		return nil, ""
	}

	channelID, err := p.resolveAlertsChannel()
	if err != nil || post.ChannelId != channelID {
		return nil, ""
	}

	// Replies are not alerts. The AI skill's own answer arrives here too, since this hook
	// fires for posts created by plugins, including this one.
	if post.RootId != "" {
		return nil, ""
	}

	// An alert is a post carrying alert fields. A human talking in the channel is not.
	if attachmentField(post, "Severity") == "" {
		return nil, ""
	}

	post.Type = alertPostType

	return post, ""
}
