package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

// AI skills. Module 6, challenge 2.
//
// The skills the lab's LLM knows about. The webapp sends one of these names.
const (
	skillAnalyzeThreatSurface = "analyze_threat_surface"
	skillSuggestRemediation   = "suggest_remediation"
)

// handleAnalyze runs an AI skill against one alert and posts the answer in its thread.
func (p *Plugin) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	postID := mux.Vars(r)["postID"]

	var body struct {
		Skill string `json:"skill"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "body must be JSON with a skill field")
		return
	}

	skill := strings.TrimSpace(body.Skill)
	if skill == "" {
		skill = skillAnalyzeThreatSurface
	}
	if skill != skillAnalyzeThreatSurface && skill != skillSuggestRemediation {
		writeJSONError(w, http.StatusBadRequest, "unknown skill: "+body.Skill)
		return
	}

	// The alert is the context. Without it the model has nothing specific to work with and
	// answers in generalities, which is the failure mode that looks like success.
	record, err := p.getAlert(postID)
	if err != nil {
		p.API.LogError("could not read an alert before analysing it", "post_id", postID, "error", err.Error())
		writeJSONError(w, http.StatusInternalServerError, "could not read the alert")
		return
	}
	if record == nil {
		writeJSONError(w, http.StatusNotFound, "no alert stored for post "+postID)
		return
	}

	answer, err := p.llmCompletion(buildSkillPrompt(skill, record))
	if err != nil {
		// 502, not 500: the failure is upstream, in the Agents plugin or the model behind
		// it, and the message says which so the learner is not left guessing.
		p.API.LogError("the AI skill failed", "post_id", postID, "skill", skill, "error", err.Error())
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}

	// RootId is what makes this a threaded reply. Without it the answer lands at channel
	// root, detached from the alert it is about, and the thread is where an analyst is
	// actually looking.
	reply := &model.Post{
		UserId:    p.botID,
		ChannelId: record.ChannelID,
		RootId:    record.PostID,
		Message:   answer,
	}

	if _, appErr := p.API.CreatePost(reply); appErr != nil {
		p.API.LogError("could not post the analysis", "post_id", postID, "error", appErr.Error())
		writeJSONError(w, http.StatusInternalServerError, "could not post the analysis: "+appErr.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"posted": true, "skill": skill})
}

// buildSkillPrompt turns an alert into a prompt.
//
// Wording matters more than it looks. The lab's LLM is deterministic and picks its answer
// from cues in the prompt, so an "analyse" prompt containing words like fix, remediate,
// respond, or next steps comes back with a remediation answer instead. A real model is
// less literal about it but no less influenced.
//
// Severity is included because it changes the answer, and the indicator because an
// assessment that does not name what it is assessing is not worth posting.
func buildSkillPrompt(skill string, record *AlertRecord) string {
	var ask string
	switch skill {
	case skillSuggestRemediation:
		ask = "Recommend remediation steps for this alert, in priority order."
	default:
		ask = "Assess the threat surface this alert exposes."
	}

	return fmt.Sprintf(
		"%s\n\nSeverity: %s\nSource: %s\nIndicator: %s\nObserved: %s\n",
		ask, record.Severity, record.Source, record.Indicator, record.Timestamp,
	)
}
