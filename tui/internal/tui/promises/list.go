package promises

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/resonatehq/resonate-observability/tui/internal/client"
	"github.com/resonatehq/resonate-observability/tui/internal/tui/theme"
)

// Messages
type PromisesLoadedMsg struct {
	Promises []client.Promise
	Cursor   *string
	Err      error
}

// Navigation messages sent to the parent
type OpenDetailMsg struct {
	Promise client.Promise
}

type OpenTreeMsg struct {
	RootID string
}

// Model is the promise list view.
type Model struct {
	Client *client.Client

	search   textinput.Model
	spinner  spinner.Model
	editing  bool // true when search input is focused
	loading  bool
	err      error

	allPromises []client.Promise // raw from server
	promises    []client.Promise // after client-side filtering
	selected    int

	// Filters
	stateFilter string // "", "pending", "resolved", "rejected"
	rootsOnly   bool   // client-side filter: only show root promises

	// Pagination
	cursor      *string
	prevCursors []string
	limit       int

	width  int
	height int
}

func New(c *client.Client) Model {
	ti := textinput.New()
	ti.Placeholder = "Search pattern (e.g. * or foo/*)"
	ti.SetValue("*")
	ti.CharLimit = 256
	ti.Width = 40

	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("99"))

	return Model{
		Client: c,
		search: ti,
		spinner: s,
		limit:  50,
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(m.spinner.Tick, m.fetchCmd())
}

func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.editing {
			return m.updateSearchInput(msg)
		}
		return m.updateNavigation(msg)

	case PromisesLoadedMsg:
		m.loading = false
		if msg.Err != nil {
			m.err = msg.Err
			return m, nil
		}
		m.err = nil
		m.allPromises = msg.Promises
		m.cursor = msg.Cursor
		m.applyFilter()
		return m, nil

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}

	return m, tea.Batch(cmds...)
}

func (m Model) updateSearchInput(msg tea.KeyMsg) (Model, tea.Cmd) {
	switch {
	case theme.Key(msg, "enter"):
		m.editing = false
		m.search.Blur()
		m.prevCursors = nil
		m.cursor = nil
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchCmd())

	case theme.Key(msg, "esc"):
		m.editing = false
		m.search.Blur()
		return m, nil
	}

	var cmd tea.Cmd
	m.search, cmd = m.search.Update(msg)
	return m, cmd
}

func (m Model) updateNavigation(msg tea.KeyMsg) (Model, tea.Cmd) {
	switch {
	case theme.Key(msg, "/"):
		m.editing = true
		m.search.Focus()
		return m, m.search.Cursor.BlinkCmd()

	case theme.Key(msg, "j", "down"):
		if m.selected < len(m.promises)-1 {
			m.selected++
		}

	case theme.Key(msg, "k", "up"):
		if m.selected > 0 {
			m.selected--
		}

	case theme.Key(msg, "enter"):
		if len(m.promises) > 0 && m.selected < len(m.promises) {
			return m, func() tea.Msg {
				return OpenDetailMsg{Promise: m.promises[m.selected]}
			}
		}

	case theme.Key(msg, "t"):
		if len(m.promises) > 0 && m.selected < len(m.promises) {
			p := m.promises[m.selected]
			rootID := p.Tags["resonate:origin"]
			if rootID == "" {
				rootID = p.ID
			}
			return m, func() tea.Msg {
				return OpenTreeMsg{RootID: rootID}
			}
		}

	case theme.Key(msg, "n"):
		if m.cursor != nil {
			if cur := m.currentCursorStr(); cur != "" {
				m.prevCursors = append(m.prevCursors, cur)
			}
			m.loading = true
			return m, tea.Batch(m.spinner.Tick, m.fetchWithCursorCmd(*m.cursor))
		}

	case theme.Key(msg, "p"):
		if len(m.prevCursors) > 0 {
			prev := m.prevCursors[len(m.prevCursors)-1]
			m.prevCursors = m.prevCursors[:len(m.prevCursors)-1]
			m.loading = true
			return m, tea.Batch(m.spinner.Tick, m.fetchWithCursorCmd(prev))
		} else {
			m.loading = true
			return m, tea.Batch(m.spinner.Tick, m.fetchCmd())
		}

	case theme.Key(msg, "1"):
		m.stateFilter = ""
		m.prevCursors = nil
		m.cursor = nil
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchCmd())

	case theme.Key(msg, "2"):
		m.stateFilter = "pending"
		m.prevCursors = nil
		m.cursor = nil
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchCmd())

	case theme.Key(msg, "3"):
		m.stateFilter = "resolved"
		m.prevCursors = nil
		m.cursor = nil
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchCmd())

	case theme.Key(msg, "4"):
		m.stateFilter = "rejected"
		m.prevCursors = nil
		m.cursor = nil
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchCmd())

	case theme.Key(msg, "5"):
		m.rootsOnly = !m.rootsOnly
		m.applyFilter()
		return m, nil

	case theme.Key(msg, "r"):
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchCmd())
	}

	return m, nil
}

func (m Model) View() string {
	var b strings.Builder

	// Search bar
	searchLabel := theme.DimText.Render("Search: ")
	if m.editing {
		searchLabel = theme.HeaderStyle.Render("Search: ")
	}
	b.WriteString(searchLabel + m.search.View() + "\n")

	// State filter pills
	filters := []struct {
		key   string
		label string
		state string
	}{
		{"1", "All", ""},
		{"2", "Pending", "pending"},
		{"3", "Resolved", "resolved"},
		{"4", "Rejected", "rejected"},
	}
	var pills []string
	for _, f := range filters {
		label := fmt.Sprintf("[%s] %s", f.key, f.label)
		if m.stateFilter == f.state {
			pills = append(pills, theme.FilterActive.Render(label))
		} else {
			pills = append(pills, theme.FilterInactive.Render(label))
		}
	}
	// Roots toggle
	rootsLabel := "[5] Roots"
	if m.rootsOnly {
		pills = append(pills, theme.FilterActive.Render(rootsLabel))
	} else {
		pills = append(pills, theme.FilterInactive.Render(rootsLabel))
	}
	b.WriteString(strings.Join(pills, " ") + "\n\n")

	if m.loading {
		b.WriteString(m.spinner.View() + " Loading...\n")
		return b.String()
	}

	if m.err != nil {
		b.WriteString(theme.ErrorText.Render("Error: "+m.err.Error()) + "\n")
		return b.String()
	}

	if len(m.promises) == 0 {
		b.WriteString(theme.DimText.Render("No promises found.") + "\n")
		return b.String()
	}

	// Table header
	header := fmt.Sprintf("  %-50s %-12s %-8s %-20s %s", "ID", "STATE", "ROLE", "CREATED", "FUNC")
	b.WriteString(theme.HeaderStyle.Render(header) + "\n")

	// Fixed-width column styles (lipgloss handles visible width correctly with ANSI codes)
	colState := lipgloss.NewStyle().Width(12)
	colRole := lipgloss.NewStyle().Width(8)

	// Calculate visible area
	availableHeight := m.height - 8 // header, filters, table header, status bar, etc.
	if availableHeight < 5 {
		availableHeight = 5
	}

	// Scroll offset
	offset := 0
	if m.selected >= availableHeight {
		offset = m.selected - availableHeight + 1
	}

	// Table rows
	for i := offset; i < len(m.promises) && i < offset+availableHeight; i++ {
		p := m.promises[i]
		id := fmt.Sprintf("%-50s", truncate(p.ID, 50))
		state := colState.Render(theme.StyleState(p.State))
		role := colRole.Render(styledRole(promiseRole(p)))
		created := fmt.Sprintf("%-20s", formatTime(p.CreatedOn))
		funcName := extractFunc(p)

		row := fmt.Sprintf("  %s %s %s %s %s", id, state, role, created, funcName)
		if i == m.selected {
			row = theme.SelectedRow.Render(row)
		}
		b.WriteString(row + "\n")
	}

	// Pagination info
	b.WriteString("\n")
	pageInfo := fmt.Sprintf("  Showing %d promises", len(m.promises))
	if m.cursor != nil {
		pageInfo += " (more available: n=next)"
	}
	if len(m.prevCursors) > 0 {
		pageInfo += " (p=prev)"
	}
	b.WriteString(theme.DimText.Render(pageInfo) + "\n")

	// Help
	help := "  /=search  1-4=filter  5=roots  j/k=navigate  enter=detail  t=tree  r=refresh  q=quit"
	b.WriteString(theme.HelpStyle.Render(help))

	return b.String()
}

// Refresh re-fetches with current filters silently (no loading spinner).
func (m *Model) Refresh() tea.Cmd {
	return m.fetchCmd()
}

func (m Model) fetchCmd() tea.Cmd {
	c := m.Client
	pattern := m.search.Value()
	if pattern == "" {
		pattern = "*"
	}
	state := m.stateFilter
	limit := m.limit

	return func() tea.Msg {
		result, err := c.SearchPromises(context.Background(), client.SearchParams{
			ID:    pattern,
			State: state,
			Limit: limit,
		})
		if err != nil {
			return PromisesLoadedMsg{Err: err}
		}
		return PromisesLoadedMsg{Promises: result.Promises, Cursor: result.Cursor}
	}
}

func (m Model) fetchWithCursorCmd(cursor string) tea.Cmd {
	c := m.Client
	pattern := m.search.Value()
	if pattern == "" {
		pattern = "*"
	}
	state := m.stateFilter
	limit := m.limit

	return func() tea.Msg {
		result, err := c.SearchPromises(context.Background(), client.SearchParams{
			ID:     pattern,
			State:  state,
			Limit:  limit,
			Cursor: cursor,
		})
		if err != nil {
			return PromisesLoadedMsg{Err: err}
		}
		return PromisesLoadedMsg{Promises: result.Promises, Cursor: result.Cursor}
	}
}

func (m Model) currentCursorStr() string {
	// We don't have the "current" cursor (the one that loaded this page),
	// so this is only used for forward paging.
	return ""
}

// applyFilter rebuilds m.promises from m.allPromises based on rootsOnly.
func (m *Model) applyFilter() {
	if m.rootsOnly {
		filtered := make([]client.Promise, 0, len(m.allPromises))
		for _, p := range m.allPromises {
			if promiseRole(p) == "root" {
				filtered = append(filtered, p)
			}
		}
		m.promises = filtered
	} else {
		m.promises = m.allPromises
	}
	if m.selected >= len(m.promises) {
		m.selected = max(len(m.promises)-1, 0)
	}
}

// promiseRole classifies a promise based on its resonate tags.
func promiseRole(p client.Promise) string {
	if p.Tags["resonate:timeout"] != "" {
		return "sleep"
	}
	switch p.Tags["resonate:scope"] {
	case "global":
		return "rpc"
	case "local":
		return "run"
	}
	// No scope tag — check if it has a parent
	parent := p.Tags["resonate:parent"]
	if parent == "" || parent == p.ID {
		return "root"
	}
	return ""
}

func styledRole(role string) string {
	switch role {
	case "root":
		return theme.RootLabel.Render("root")
	case "rpc":
		return theme.ScopeGlobal.Render("rpc")
	case "run":
		return theme.ScopeLocal.Render("run")
	case "sleep":
		return theme.SleepLabel.Render("sleep")
	default:
		return theme.DimText.Render("-")
	}
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}

func formatTime(t *int64) string {
	if t == nil {
		return "-"
	}
	ts := time.UnixMilli(*t)
	ago := time.Since(ts)
	switch {
	case ago < time.Minute:
		return fmt.Sprintf("%ds ago", int(ago.Seconds()))
	case ago < time.Hour:
		return fmt.Sprintf("%dm ago", int(ago.Minutes()))
	case ago < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(ago.Hours()))
	default:
		return ts.Format("2006-01-02 15:04")
	}
}

func extractFunc(p client.Promise) string {
	if p.Param.Data == nil {
		return ""
	}
	b, err := base64.StdEncoding.DecodeString(*p.Param.Data)
	if err != nil {
		return ""
	}
	var d map[string]any
	if err := json.Unmarshal(b, &d); err != nil {
		return ""
	}
	f, _ := d["func"].(string)
	return f
}
