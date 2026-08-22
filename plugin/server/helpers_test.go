package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const testAlertsChannelID = "alertschannelid00000000000"

// newTestPlugin returns a plugin wired to an in-memory KV Store.
//
// The KV mock is backed by a real map rather than per-call expectations, so a test can
// write a record and read it back the way the plugin does at runtime. Expectation-only
// mocks pass while the code stores nothing, which is exactly the bug worth catching.
func newTestPlugin(t *testing.T) (*Plugin, map[string][]byte) {
	t.Helper()

	store := map[string][]byte{}
	api := &plugintest.API{}

	api.On("KVSet", mock.Anything, mock.Anything).Return(func(key string, value []byte) *model.AppError {
		// Copy, because the caller owns the slice it passed in.
		stored := make([]byte, len(value))
		copy(stored, value)
		store[key] = stored
		return nil
	}).Maybe()

	api.On("KVGet", mock.Anything).Return(
		func(key string) []byte { return store[key] },
		func(_ string) *model.AppError { return nil },
	).Maybe()

	api.On("KVDelete", mock.Anything).Return(func(key string) *model.AppError {
		delete(store, key)
		return nil
	}).Maybe()

	api.On("KVList", mock.Anything, mock.Anything).Return(
		func(page, perPage int) []string {
			keys := make([]string, 0, len(store))
			for key := range store {
				keys = append(keys, key)
			}
			// KVList is documented as paginated, so a stable order is required for the
			// paging maths to mean anything. Map iteration order is not stable.
			sort.Strings(keys)

			start := page * perPage
			if start >= len(keys) {
				return nil
			}
			end := min(start+perPage, len(keys))

			return keys[start:end]
		},
		func(_, _ int) *model.AppError { return nil },
	).Maybe()

	api.On("GetChannelByNameForTeamName", mock.Anything, mock.Anything, mock.Anything).Return(
		&model.Channel{Id: testAlertsChannelID, Name: "alerts"}, nil,
	).Maybe()

	// Logging is noise in a test, but the plugin calls it, so it has to be satisfied.
	for _, level := range []string{"LogDebug", "LogInfo", "LogWarn", "LogError"} {
		api.On(level, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Maybe()
		api.On(level, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Maybe()
		api.On(level, mock.Anything, mock.Anything).Maybe()
		api.On(level, mock.Anything).Maybe()
	}

	p := &Plugin{}
	p.API = api
	p.configuration = &configuration{AlertsChannelID: testAlertsChannelID}

	return p, store
}

// alertPost builds a post shaped like one the threat feed produces.
//
// The props are deliberately round-tripped through JSON. A real post's attachments arrive
// as []any of map[string]any, not as []*model.SlackAttachment, and code that type
// asserts straight to the typed form works in a test built the easy way and then finds
// nothing in production.
func alertPost(t *testing.T, channelID string, fields map[string]string) *model.Post {
	t.Helper()

	attachmentFields := make([]*model.SlackAttachmentField, 0, len(fields))
	// Sorted so the post is identical between runs.
	titles := make([]string, 0, len(fields))
	for title := range fields {
		titles = append(titles, title)
	}
	sort.Strings(titles)

	for _, title := range titles {
		attachmentFields = append(attachmentFields, &model.SlackAttachmentField{
			Title: title,
			Value: fields[title],
			Short: true,
		})
	}

	post := &model.Post{
		Id:        model.NewId(),
		ChannelId: channelID,
		Message:   "CRITICAL Suspicious outbound beacon",
	}

	if len(attachmentFields) > 0 {
		model.ParseSlackAttachment(post, []*model.SlackAttachment{{
			Color:  "#D24B4E",
			Title:  "Suspicious outbound beacon",
			Fields: attachmentFields,
		}})
	}

	encoded, err := json.Marshal(post)
	require.NoError(t, err)

	var roundTripped model.Post
	require.NoError(t, json.Unmarshal(encoded, &roundTripped))

	return &roundTripped
}

// defaultAlertFields is a well formed alert, matching what the feed sends. The indicator
// is wrapped in backticks because the feed renders it as inline code.
func defaultAlertFields() map[string]string {
	return map[string]string{
		"Severity":  "CRITICAL",
		"Source":    "Suricata",
		"Indicator": "`203.0.113.47`",
		"Timestamp": "2026-08-21T12:00:00Z",
	}
}

// call runs a request through the plugin's router as an authenticated user.
func (p *Plugin) call(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	return p.callAs(t, method, path, body, "someuserid0000000000000000")
}

// callAs runs a request with an explicit user id. An empty id means unauthenticated,
// which is what Mattermost sends for a request with no valid session.
func (p *Plugin) callAs(t *testing.T, method, path string, body any, userID string) *httptest.ResponseRecorder {
	t.Helper()

	var req *http.Request
	if body == nil {
		req = httptest.NewRequest(method, path, nil)
	} else {
		encoded, err := json.Marshal(body)
		require.NoError(t, err)
		req = httptest.NewRequest(method, path, bytes.NewReader(encoded))
		req.Header.Set("Content-Type", "application/json")
	}

	if userID != "" {
		req.Header.Set("Mattermost-User-Id", userID)
	}

	recorder := httptest.NewRecorder()
	p.ServeHTTP(nil, recorder, req)

	return recorder
}

func decodeJSON[T any](t *testing.T, recorder *httptest.ResponseRecorder) T {
	t.Helper()

	var value T
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &value), "response was not JSON: %s", recorder.Body.String())

	return value
}
