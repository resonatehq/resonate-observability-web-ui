package theme

import tea "github.com/charmbracelet/bubbletea"

// Key checks for common key presses.
func Key(msg tea.KeyMsg, keys ...string) bool {
	for _, k := range keys {
		if msg.String() == k {
			return true
		}
	}
	return false
}
