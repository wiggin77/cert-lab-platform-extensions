package main

import (
	"encoding/json"
	"net/http"
)

// writeJSON sends a value as JSON.
//
// The content type has to be set before the first write. Once WriteHeader has run the
// headers are on the wire and setting one afterwards does nothing, silently.
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(value); err != nil {
		// The status line is already sent, so there is no way to turn this into an error
		// response. Nothing useful is left to do but stop.
		return
	}
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
