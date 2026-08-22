package main

// Tests for the server half of Module 6.
//
// These are the spec. Run them with `make test` and work until they pass, which is a much
// faster loop than `make deploy` and firing an alert: a full deploy plus a stimulus is
// most of a minute, and these run in well under a second.
//
// They fail on the untouched scaffold. That is expected, and the failure messages say
// which behaviour is missing.

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// The capture hook
// ---------------------------------------------------------------------------

func TestCaptureStoresAllFields(t *testing.T) {
	p, _ := newTestPlugin(t)

	post := alertPost(t, testAlertsChannelID, defaultAlertFields())
	p.MessageHasBeenPosted(nil, post)

	record, err := p.getAlert(post.Id)
	require.NoError(t, err)
	require.NotNil(t, record, "the hook stored nothing for a post in the alerts channel")

	assert.Equal(t, post.Id, record.PostID)
	assert.Equal(t, "CRITICAL", record.Severity)
	assert.Equal(t, "Suricata", record.Source)
	assert.Equal(t, "2026-08-21T12:00:00Z", record.Timestamp)
	assert.Equal(t, StatusOpen, record.Status, "a newly captured alert starts at status open")
}

// The feed renders the indicator as inline code. Those backticks are formatting, and an
// indicator stored with them does not match the same indicator anywhere else.
func TestCaptureStripsBackticksFromIndicator(t *testing.T) {
	p, _ := newTestPlugin(t)

	post := alertPost(t, testAlertsChannelID, defaultAlertFields())
	p.MessageHasBeenPosted(nil, post)

	record, err := p.getAlert(post.Id)
	require.NoError(t, err)
	require.NotNil(t, record)

	assert.Equal(t, "203.0.113.47", record.Indicator)
}

func TestCaptureIgnoresOtherChannels(t *testing.T) {
	p, store := newTestPlugin(t)

	post := alertPost(t, "someotherchannelid00000000", defaultAlertFields())
	p.MessageHasBeenPosted(nil, post)

	assert.Empty(t, store, "the hook captured a post from outside the alerts channel")
}

// Not everything in the alerts channel is an alert. A human replying has no attachment.
func TestCaptureIgnoresPostsWithoutAnAttachment(t *testing.T) {
	p, store := newTestPlugin(t)

	post := alertPost(t, testAlertsChannelID, nil)
	p.MessageHasBeenPosted(nil, post)

	assert.Empty(t, store, "the hook captured a plain message as though it were an alert")
}

// ---------------------------------------------------------------------------
// GET /api/v1/alert/{postID}
// ---------------------------------------------------------------------------

func TestGetAlertReturnsTheRecord(t *testing.T) {
	p, _ := newTestPlugin(t)

	post := alertPost(t, testAlertsChannelID, defaultAlertFields())
	p.MessageHasBeenPosted(nil, post)

	recorder := p.call(t, http.MethodGet, "/api/v1/alert/"+post.Id, nil)
	require.Equal(t, http.StatusOK, recorder.Code, "body: %s", recorder.Body.String())

	record := decodeJSON[AlertRecord](t, recorder)
	assert.Equal(t, "CRITICAL", record.Severity)
	assert.Equal(t, "Suricata", record.Source)
	assert.Equal(t, "203.0.113.47", record.Indicator)
	assert.Equal(t, StatusOpen, record.Status)
}

// A missing record is a 404. An empty 200 looks to the webapp like an alert with no
// fields, which is a different problem and harder to diagnose.
func TestGetAlertReturns404WhenUnknown(t *testing.T) {
	p, _ := newTestPlugin(t)

	recorder := p.call(t, http.MethodGet, "/api/v1/alert/nosuchpostid00000000000000", nil)
	assert.Equal(t, http.StatusNotFound, recorder.Code)
}

func TestGetAlertRequiresAuthentication(t *testing.T) {
	p, _ := newTestPlugin(t)

	post := alertPost(t, testAlertsChannelID, defaultAlertFields())
	p.MessageHasBeenPosted(nil, post)

	recorder := p.callAs(t, http.MethodGet, "/api/v1/alert/"+post.Id, nil, "")
	assert.Equal(t, http.StatusUnauthorized, recorder.Code,
		"alert data is not public, so a request with no Mattermost-User-Id must be rejected")
}

// ---------------------------------------------------------------------------
// POST /api/v1/alert/{postID}/status
// ---------------------------------------------------------------------------

func TestSetStatusPersists(t *testing.T) {
	p, _ := newTestPlugin(t)

	post := alertPost(t, testAlertsChannelID, defaultAlertFields())
	p.MessageHasBeenPosted(nil, post)

	recorder := p.call(t, http.MethodPost, "/api/v1/alert/"+post.Id+"/status",
		map[string]string{"status": StatusAcknowledged})
	require.Equal(t, http.StatusOK, recorder.Code, "body: %s", recorder.Body.String())

	after, err := p.getAlert(post.Id)
	require.NoError(t, err)
	require.NotNil(t, after)
	assert.Equal(t, StatusAcknowledged, after.Status)
}

// The read, modify, write lesson. Writing a fresh record holding only the new status
// persists and silently drops everything else.
func TestSetStatusKeepsTheOtherFields(t *testing.T) {
	p, _ := newTestPlugin(t)

	post := alertPost(t, testAlertsChannelID, defaultAlertFields())
	p.MessageHasBeenPosted(nil, post)

	recorder := p.call(t, http.MethodPost, "/api/v1/alert/"+post.Id+"/status",
		map[string]string{"status": StatusAcknowledged})
	require.Equal(t, http.StatusOK, recorder.Code)

	after, err := p.getAlert(post.Id)
	require.NoError(t, err)
	require.NotNil(t, after)

	assert.Equal(t, "CRITICAL", after.Severity, "severity was lost by the status update")
	assert.Equal(t, "Suricata", after.Source, "source was lost by the status update")
	assert.Equal(t, "203.0.113.47", after.Indicator, "indicator was lost by the status update")
	assert.Equal(t, "2026-08-21T12:00:00Z", after.Timestamp, "timestamp was lost by the status update")
}

func TestSetStatusRejectsAnUnknownStatus(t *testing.T) {
	p, _ := newTestPlugin(t)

	post := alertPost(t, testAlertsChannelID, defaultAlertFields())
	p.MessageHasBeenPosted(nil, post)

	recorder := p.call(t, http.MethodPost, "/api/v1/alert/"+post.Id+"/status",
		map[string]string{"status": "acknowledgd"})
	assert.Equal(t, http.StatusBadRequest, recorder.Code,
		"a typo must not create a status that nothing counts and nothing displays")
}

func TestSetStatusReturns404WhenUnknown(t *testing.T) {
	p, _ := newTestPlugin(t)

	recorder := p.call(t, http.MethodPost, "/api/v1/alert/nosuchpostid00000000000000/status",
		map[string]string{"status": StatusAcknowledged})
	assert.Equal(t, http.StatusNotFound, recorder.Code)
}

// ---------------------------------------------------------------------------
// GET /api/v1/alerts/count
// ---------------------------------------------------------------------------

func TestCountStartsAtZero(t *testing.T) {
	p, _ := newTestPlugin(t)

	recorder := p.call(t, http.MethodGet, "/api/v1/alerts/count", nil)
	require.Equal(t, http.StatusOK, recorder.Code, "body: %s", recorder.Body.String())

	count := decodeJSON[map[string]int](t, recorder)
	assert.Equal(t, 0, count["open"])
}

func TestCountTracksCaptureAndAcknowledgement(t *testing.T) {
	p, _ := newTestPlugin(t)

	first := alertPost(t, testAlertsChannelID, defaultAlertFields())
	second := alertPost(t, testAlertsChannelID, defaultAlertFields())
	p.MessageHasBeenPosted(nil, first)
	p.MessageHasBeenPosted(nil, second)

	recorder := p.call(t, http.MethodGet, "/api/v1/alerts/count", nil)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, 2, decodeJSON[map[string]int](t, recorder)["open"])

	recorder = p.call(t, http.MethodPost, "/api/v1/alert/"+first.Id+"/status",
		map[string]string{"status": StatusAcknowledged})
	require.Equal(t, http.StatusOK, recorder.Code)

	recorder = p.call(t, http.MethodGet, "/api/v1/alerts/count", nil)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, 1, decodeJSON[map[string]int](t, recorder)["open"],
		"only records at status open should be counted")
}

// listAlerts has to page. A single KVList call returns at most one page, so a count built
// on one call quietly stops rising once there are more alerts than the page size.
func TestCountPagesThroughTheStore(t *testing.T) {
	p, _ := newTestPlugin(t)

	const total = 250
	for range total {
		p.MessageHasBeenPosted(nil, alertPost(t, testAlertsChannelID, defaultAlertFields()))
	}

	recorder := p.call(t, http.MethodGet, "/api/v1/alerts/count", nil)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, total, decodeJSON[map[string]int](t, recorder)["open"],
		"the count stopped at a page boundary")
}
