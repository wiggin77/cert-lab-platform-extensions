package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/pkg/errors"
)

// Talking to the Agents plugin.
//
// You do not need to change anything in this file. It is here so the AI skill in the next
// challenge is about the prompt and the reply, not about inter-plugin plumbing.
//
// Worth understanding anyway, because it is the only way one plugin calls another:
//
// p.API.PluginHTTP takes an *http.Request whose path is /<destination-plugin-id>/<path>
// and dispatches it to that plugin's ServeHTTP, in process. No network, no port, no URL
// for the other plugin. The server splits the plugin id off the front of the path
// (channels/app/plugin_api.go), which is why the id is baked into the path below rather
// than passed as an argument.
//
// Authentication is handled for us. The server sets a Mattermost-Plugin-ID header naming
// the CALLING plugin, and strips that header from any request arriving from outside
// (channels/app/plugin_requests.go), so it cannot be forged. The Agents plugin's bridge
// routes require it and reject anything without it. That is also why this needs no API
// key: the trust boundary is the server, not a shared secret.
const (
	// The Agents plugin's id is still its original name.
	agentsPluginID = "mattermost-ai"

	// The LLM service id that track setup registered with the Agents plugin. See
	// bin/lab-configure-agents. In this lab it points at the deterministic mock LLM
	// rather than a real provider.
	labLLMServiceID = "lab-mock-llm"
)

// bridgePost is one message in the conversation sent to the LLM.
//
// Role is user, assistant, or system. This mirrors the Agents plugin's public
// bridgeclient package, transcribed rather than imported: importing it would pull the
// whole Agents module and its dependency tree into this build for three structs.
type bridgePost struct {
	Role    string `json:"role"`
	Message string `json:"message"`
}

type bridgeCompletionRequest struct {
	Posts []bridgePost `json:"posts"`
}

type bridgeCompletionResponse struct {
	Completion string `json:"completion"`
}

type bridgeErrorResponse struct {
	Error string `json:"error"`
}

// llmCompletion sends a prompt to the lab's configured LLM and returns the answer.
//
// This uses the service endpoint rather than the agent endpoint, so it goes straight to
// the configured LLM service. The agent endpoint would apply a specific bot's custom
// instructions and permissions, and takes a bot user id rather than a name.
func (p *Plugin) llmCompletion(prompt string) (string, error) {
	body, err := json.Marshal(bridgeCompletionRequest{
		Posts: []bridgePost{{Role: "user", Message: prompt}},
	})
	if err != nil {
		return "", errors.Wrap(err, "could not encode the completion request")
	}

	// nostream, because this returns a single JSON body. The streaming variant returns
	// server sent events, which is the right choice for typing into a UI and the wrong
	// one for posting a finished message.
	path := fmt.Sprintf("/%s/bridge/v1/completion/service/%s/nostream", agentsPluginID, labLLMServiceID)

	req, err := http.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	if err != nil {
		return "", errors.Wrap(err, "could not build the completion request")
	}
	req.Header.Set("Content-Type", "application/json")

	resp := p.API.PluginHTTP(req)
	if resp == nil {
		// A nil response means the request never reached a plugin at all, which in
		// practice means the Agents plugin is not installed or not enabled.
		return "", errors.Errorf("no response from the %s plugin. Is it installed and enabled?", agentsPluginID)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", errors.Wrap(err, "could not read the completion response")
	}

	if resp.StatusCode != http.StatusOK {
		var failure bridgeErrorResponse
		if json.Unmarshal(raw, &failure) == nil && failure.Error != "" {
			return "", errors.Errorf("the Agents plugin returned %d: %s", resp.StatusCode, failure.Error)
		}
		return "", errors.Errorf("the Agents plugin returned %d: %s", resp.StatusCode, truncate(string(raw), 300))
	}

	var completion bridgeCompletionResponse
	if err := json.Unmarshal(raw, &completion); err != nil {
		return "", errors.Wrapf(err, "the Agents plugin returned a body that is not a completion: %s", truncate(string(raw), 300))
	}

	if completion.Completion == "" {
		return "", errors.New("the Agents plugin returned an empty completion")
	}

	return completion.Completion, nil
}

func truncate(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	return s[:limit] + "..."
}
