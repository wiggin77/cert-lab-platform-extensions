package main

import (
	"github.com/mattermost/mattermost/server/public/plugin"
)

// A plugin's server half is a separate process. Mattermost launches this binary and talks
// to it over RPC, which is why a panic in here takes the plugin down but not the server.
func main() {
	plugin.ClientMain(&Plugin{})
}
