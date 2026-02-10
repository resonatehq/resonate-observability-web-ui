package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/resonatehq/resonate-observability/tui/internal/client"
	"github.com/resonatehq/resonate-observability/tui/internal/tui"
)

func main() {
	server := flag.String("server", "http://localhost:8001", "Resonate server URL")
	view := flag.String("view", "list", "Initial view: list or tree")
	rootID := flag.String("root", "", "Root promise ID for tree view")
	refresh := flag.Duration("refresh", 5*time.Second, "Auto-refresh interval (0 to disable)")
	token := flag.String("token", "", "JWT bearer token for authentication")
	username := flag.String("username", "", "Basic auth username")
	password := flag.String("password", "", "Basic auth password")
	flag.Parse()

	c := &client.Client{
		BaseURL:  *server,
		HTTPClient: &http.Client{Timeout: 10 * time.Second},
		Token:    *token,
		Username: *username,
		Password: *password,
	}

	m := tui.NewModel(c, tui.Options{
		InitialView:     *view,
		TreeRootID:      *rootID,
		RefreshInterval: *refresh,
	})

	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
