package main

import (
	"net/http"
)

// AI skills. Module 6.
//
// The route is already registered for you in api.go. This is the endpoint the two buttons
// in the sidebar pane call.
//
// The skills the lab's LLM knows about. The webapp sends one of these names.
const (
	skillAnalyzeThreatSurface = "analyze_threat_surface"
	skillSuggestRemediation   = "suggest_remediation"
)

// handleAnalyze runs an AI skill against one alert and posts the answer in its thread.
//
// TODO Your task:
//
//  1. Read the postID from the route and the skill name from the JSON body.
//  2. Load the alert with p.getAlert. A skill with no alert context returns generic text,
//     so this is the whole point of the endpoint.
//  3. Build a prompt from the alert fields and send it with p.llmCompletion (agents.go).
//  4. Post the answer as a REPLY IN THE ALERT'S THREAD, not to the channel root. That
//     means RootId set to the alert's post id. p.botID is the author.
//
// Two things that will catch you out:
//
//   - Include the alert's severity and indicator in the prompt. The grader checks the
//     indicator reached the model, and severity changes the answer you get back.
//   - Ask for an assessment, not for remediation, when the skill is
//     analyze_threat_surface. The lab's LLM picks its answer from the wording of your
//     prompt, so words like "fix", "remediate", "respond" or "next steps" in an
//     analyze prompt will get you a remediation answer instead.
func (p *Plugin) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	_ = r
	writeJSONError(w, http.StatusNotImplemented, "the analyze endpoint is not implemented yet")
}
