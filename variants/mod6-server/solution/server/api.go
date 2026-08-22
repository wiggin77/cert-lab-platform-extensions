package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
)

// router builds the plugin's HTTP routes.
//
// Everything here is served under /plugins/com.mattermost.cert-alerts/, on the root
// router. Plugin endpoints are NOT under /api/v4, and looking for them there is the usual
// reason a correct handler appears to 404.
//
// Mattermost authenticates the request before it reaches us and passes the result in the
// Mattermost-User-Id header. An empty header means the caller is not logged in, which is
// why requireUser exists below.
func (p *Plugin) router() *mux.Router {
	router := mux.NewRouter()

	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(p.requireUser)

	// Registered before /alert/{postID} would matter only if the two could overlap.
	// They cannot here ("alerts" is not "alert"), but ordering routes from most to least
	// specific is the habit that avoids the version of this bug that does bite.
	api.HandleFunc("/alerts/count", p.handleAlertCount).Methods(http.MethodGet)
	api.HandleFunc("/alert/{postID}", p.handleGetAlert).Methods(http.MethodGet)
	api.HandleFunc("/alert/{postID}/status", p.handleSetAlertStatus).Methods(http.MethodPost)

	// Set on both, because a subrouter does not inherit its parent's NotFoundHandler.
	// Without the second line, an unmatched path under /api/v1 answers with net/http's
	// plain text 404 while everything else here answers JSON.
	notFound := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.API.LogDebug("no plugin route matched", "path", r.URL.Path, "method", r.Method)
		writeJSONError(w, http.StatusNotFound, "no such endpoint: "+r.Method+" "+r.URL.Path)
	})
	router.NotFoundHandler = notFound
	api.NotFoundHandler = notFound

	return router
}

// requireUser rejects requests that Mattermost did not authenticate.
//
// Without this, every endpoint here is readable by anyone who can reach the server, and
// alert data is not public. Mattermost sets the header, so we only have to check it.
func (p *Plugin) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Mattermost-User-Id") == "" {
			writeJSONError(w, http.StatusUnauthorized, "not authorized")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// GET /api/v1/alert/{postID}
func (p *Plugin) handleGetAlert(w http.ResponseWriter, r *http.Request) {
	postID := mux.Vars(r)["postID"]

	record, err := p.getAlert(postID)
	if err != nil {
		p.API.LogError("could not read an alert", "post_id", postID, "error", err.Error())
		writeJSONError(w, http.StatusInternalServerError, "could not read the alert")
		return
	}

	// A missing record is a 404, not an empty 200. An empty record would look to the
	// webapp like an alert with no fields, which is a different problem entirely.
	if record == nil {
		writeJSONError(w, http.StatusNotFound, "no alert stored for post "+postID)
		return
	}

	writeJSON(w, http.StatusOK, record)
}

// POST /api/v1/alert/{postID}/status
func (p *Plugin) handleSetAlertStatus(w http.ResponseWriter, r *http.Request) {
	postID := mux.Vars(r)["postID"]

	var body struct {
		Status string `json:"status"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "body must be JSON with a status field")
		return
	}

	status := strings.ToLower(strings.TrimSpace(body.Status))
	switch status {
	case StatusOpen, StatusAcknowledged, StatusResolved:
	default:
		// Validating against the known set keeps a typo from creating a status that
		// nothing counts and nothing displays, which is worse than an error.
		writeJSONError(w, http.StatusBadRequest, "unknown status: "+body.Status)
		return
	}

	// Read, modify, write. Building a fresh record here with only PostID and Status would
	// persist and silently drop severity, source, indicator, and timestamp.
	record, err := p.getAlert(postID)
	if err != nil {
		p.API.LogError("could not read an alert before updating it", "post_id", postID, "error", err.Error())
		writeJSONError(w, http.StatusInternalServerError, "could not read the alert")
		return
	}

	if record == nil {
		writeJSONError(w, http.StatusNotFound, "no alert stored for post "+postID)
		return
	}

	record.Status = status

	if err := p.putAlert(record); err != nil {
		p.API.LogError("could not update an alert", "post_id", postID, "error", err.Error())
		writeJSONError(w, http.StatusInternalServerError, "could not update the alert")
		return
	}

	writeJSON(w, http.StatusOK, record)
}

// GET /api/v1/alerts/count
func (p *Plugin) handleAlertCount(w http.ResponseWriter, _ *http.Request) {
	records, err := p.listAlerts()
	if err != nil {
		p.API.LogError("could not count alerts", "error", err.Error())
		writeJSONError(w, http.StatusInternalServerError, "could not count the alerts")
		return
	}

	// Counted on every call rather than cached. The channel header widget shows this
	// number permanently, so a stale value is visible to everyone until a reload.
	open := 0
	for _, record := range records {
		if strings.EqualFold(record.Status, StatusOpen) {
			open++
		}
	}

	writeJSON(w, http.StatusOK, map[string]int{"open": open})
}
