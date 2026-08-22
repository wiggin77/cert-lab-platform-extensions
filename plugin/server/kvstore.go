package main

import (
	"encoding/json"

	"github.com/pkg/errors"
)

// Statuses an alert can hold. Compared case insensitively on the way in.
const (
	StatusOpen         = "open"
	StatusAcknowledged = "acknowledged"
	StatusResolved     = "resolved"
)

// alertKeyPrefix namespaces our keys.
//
// The KV Store is per plugin, so there is no risk of colliding with another plugin, but a
// prefix still matters: it is what makes it possible to list only alerts later, rather
// than everything the plugin has ever written.
const alertKeyPrefix = "alert_"

// AlertRecord is one captured alert.
//
// The JSON tags are the wire format for the webapp as well as the storage format, so
// renaming a field changes both.
type AlertRecord struct {
	PostID    string `json:"post_id"`
	ChannelID string `json:"channel_id"`
	Severity  string `json:"severity"`
	Source    string `json:"source"`
	Indicator string `json:"indicator"`
	Timestamp string `json:"timestamp"`
	Status    string `json:"status"`
}

func alertKey(postID string) string {
	return alertKeyPrefix + postID
}

// putAlert writes a record, overwriting any existing one under the same key.
//
// Note this replaces the whole value. When updating a single field, read the record
// first, change that field, and write the result back. Constructing a fresh record with
// only the field you care about silently drops the rest.
func (p *Plugin) putAlert(record *AlertRecord) error {
	encoded, err := json.Marshal(record)
	if err != nil {
		return errors.Wrap(err, "could not encode the alert record")
	}

	if appErr := p.API.KVSet(alertKey(record.PostID), encoded); appErr != nil {
		return errors.Wrap(appErr, "could not write the alert record")
	}

	return nil
}

// getAlert reads one record. A missing key is not an error: it returns (nil, nil), so
// callers distinguish "no such alert" from "storage is broken".
func (p *Plugin) getAlert(postID string) (*AlertRecord, error) {
	encoded, appErr := p.API.KVGet(alertKey(postID))
	if appErr != nil {
		return nil, errors.Wrap(appErr, "could not read the alert record")
	}

	if len(encoded) == 0 {
		return nil, nil
	}

	var record AlertRecord
	if err := json.Unmarshal(encoded, &record); err != nil {
		return nil, errors.Wrap(err, "stored alert record is not valid JSON")
	}

	return &record, nil
}

// listAlerts returns every stored alert.
//
// KVList is paginated and the page size is capped server side, so a single call is not
// enough once there are more records than fit on one page. Looping until a short page
// comes back is the only reliable way to read them all.
func (p *Plugin) listAlerts() ([]*AlertRecord, error) {
	const perPage = 100

	var records []*AlertRecord

	for page := 0; ; page++ {
		keys, appErr := p.API.KVList(page, perPage)
		if appErr != nil {
			return nil, errors.Wrap(appErr, "could not list the KV Store")
		}

		for _, key := range keys {
			if len(key) <= len(alertKeyPrefix) || key[:len(alertKeyPrefix)] != alertKeyPrefix {
				continue
			}

			record, err := p.getAlert(key[len(alertKeyPrefix):])
			if err != nil {
				// One unreadable record should not fail the whole listing.
				p.API.LogWarn("skipping an unreadable alert record", "key", key, "error", err.Error())
				continue
			}

			if record != nil {
				records = append(records, record)
			}
		}

		if len(keys) < perPage {
			return records, nil
		}
	}
}
