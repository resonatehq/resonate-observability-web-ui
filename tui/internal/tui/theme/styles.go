package theme

import "github.com/charmbracelet/lipgloss"

// Resonate Brand Colors (256-color terminal approximations)
// Dark: #080A0E → 232-234 (very dark gray)
// Secondary (teal): #1EE3CF → 51 (bright cyan/teal)
// Primary: #E4E7EB → 254 (light gray)
// Muted: #94A3B8 → 246 (medium gray)

var (
	// Status colors
	StatusPending  = lipgloss.NewStyle().Foreground(lipgloss.Color("226")) // yellow
	StatusResolved = lipgloss.NewStyle().Foreground(lipgloss.Color("46"))  // green
	StatusRejected = lipgloss.NewStyle().Foreground(lipgloss.Color("196")) // red

	// Layout (Resonate brand)
	HeaderStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("51"))  // teal accent
	TabActive   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("51")).Underline(true) // teal
	TabInactive = lipgloss.NewStyle().Foreground(lipgloss.Color("246")) // muted gray
	SelectedRow = lipgloss.NewStyle().Background(lipgloss.Color("236")).Bold(true)
	NormalRow   = lipgloss.NewStyle()
	DimText     = lipgloss.NewStyle().Foreground(lipgloss.Color("246")) // muted gray
	ErrorText   = lipgloss.NewStyle().Foreground(lipgloss.Color("196")).Bold(true)
	HelpStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("246")) // muted gray
	StatusBar   = lipgloss.NewStyle().Foreground(lipgloss.Color("254")).Background(lipgloss.Color("235"))

	// Detail view
	LabelStyle  = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("51")).Width(14) // teal accent
	ValueStyle  = lipgloss.NewStyle()
	TagKey      = lipgloss.NewStyle().Foreground(lipgloss.Color("51"))  // teal for emphasis
	TagValue    = lipgloss.NewStyle().Foreground(lipgloss.Color("254")) // light gray
	ResonateTag = lipgloss.NewStyle().Foreground(lipgloss.Color("51")).Italic(true) // teal for resonate: tags

	// Tree / Role labels
	TreeConnector = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	ScopeGlobal   = lipgloss.NewStyle().Foreground(lipgloss.Color("51"))  // teal for rpc
	ScopeLocal    = lipgloss.NewStyle().Foreground(lipgloss.Color("141")) // purple for run
	SleepLabel    = lipgloss.NewStyle().Foreground(lipgloss.Color("246")) // muted gray for sleep
	RootLabel     = lipgloss.NewStyle().Foreground(lipgloss.Color("51")).Bold(true) // teal for root/workflow

	// Filter pills
	FilterActive   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("0")).Background(lipgloss.Color("51")).Padding(0, 1) // teal bg
	FilterInactive = lipgloss.NewStyle().Foreground(lipgloss.Color("246")).Padding(0, 1) // muted gray
)

// StyleState returns a styled string for the given promise state.
func StyleState(state string) string {
	switch state {
	case "PENDING":
		return StatusPending.Render("PENDING")
	case "RESOLVED":
		return StatusResolved.Render("RESOLVED")
	case "REJECTED":
		return StatusRejected.Render("REJECTED")
	case "REJECTED_CANCELED":
		return StatusRejected.Render("CANCELED")
	case "REJECTED_TIMEDOUT":
		return StatusRejected.Render("TIMEDOUT")
	default:
		return state
	}
}

// StatusDot returns a colored dot for the given promise state.
func StatusDot(state string) string {
	switch state {
	case "PENDING":
		return StatusPending.Render("●")
	case "RESOLVED":
		return StatusResolved.Render("●")
	case "REJECTED", "REJECTED_CANCELED", "REJECTED_TIMEDOUT":
		return StatusRejected.Render("●")
	default:
		return "○"
	}
}
