package main

import (
	"net/http"

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
//
// TODO Your task, register these three routes:
//
//	GET   /api/v1/alert/{postID}          return the stored record as JSON
//	POST  /api/v1/alert/{postID}/status   read {"status": "..."} and write it back
//	GET   /api/v1/alerts/count            return {"open": <number>}
//
// Route them to handler methods you write in this file. p.getAlert, p.putAlert, and
// p.listAlerts in kvstore.go are already there for the storage half.
//
// For the count, count the records at StatusOpen every time it is called. Caching a
// number at activation drifts the moment anything changes, and the header widget in the
// next challenge shows that drift to the learner directly.
func (p *Plugin) router() *mux.Router {
	router := mux.NewRouter()

	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(p.requireUser)

	// Your routes go here.

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
