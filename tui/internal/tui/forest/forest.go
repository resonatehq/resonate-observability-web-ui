package forest

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/resonatehq/resonate-observability/tui/internal/client"
	"github.com/resonatehq/resonate-observability/tui/internal/tui/theme"
	"github.com/resonatehq/resonate-observability/tui/internal/tui/tree"
)

// SortMode defines how to sort roots.
type SortMode int

const (
	SortCreatedDesc SortMode = iota // newest first (default)
	SortCreatedAsc                  // oldest first
	SortResolvedDesc
	SortResolvedAsc
)

func (s SortMode) String() string {
	switch s {
	case SortCreatedDesc:
		return "Created ↓"
	case SortCreatedAsc:
		return "Created ↑"
	case SortResolvedDesc:
		return "Resolved ↓"
	case SortResolvedAsc:
		return "Resolved ↑"
	default:
		return "Unknown"
	}
}

// Messages
type RootsLoadedMsg struct {
	Promises []client.Promise
	Cursor   *string
	Err      error
}

type TreeLoadedForRootMsg struct {
	RootID string
	Tree   *tree.TreeNode
	Err    error
}

type OpenDetailMsg struct {
	Promise client.Promise
}

// RootItem represents a root promise with optional expanded tree.
type RootItem struct {
	Promise  client.Promise
	Tree     *tree.TreeNode // nil if collapsed, loaded when expanded
	Expanded bool
	Loading  bool
}

// Model is the forest view showing all root promises with expandable trees.
type Model struct {
	Client *client.Client

	roots    []*RootItem
	selected int
	spinner  spinner.Model
	loading  bool
	err      error

	// Filters
	stateFilter string   // "", "pending", "resolved", "rejected"
	typeFilter  string   // "", "root", "rpc", "run", "sleep"
	sortMode    SortMode // how to sort roots

	// Pagination
	cursor      *string
	prevCursors []string
	limit       int

	width  int
	height int
	offset int // scroll offset for visible roots
}

func New(c *client.Client) Model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("51"))

	return Model{
		Client:   c,
		spinner:  s,
		limit:    50,
		sortMode: SortCreatedDesc,
	}
}

// Init loads the first page of roots.
func (m Model) Init() tea.Cmd {
	m.loading = true
	return tea.Batch(m.spinner.Tick, m.fetchRootsCmd())
}

func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case RootsLoadedMsg:
		m.loading = false
		if msg.Err != nil {
			m.err = msg.Err
			return m, nil
		}
		m.err = nil
		// Preserve expanded state and tree data from old roots
		oldRoots := make(map[string]*RootItem)
		for _, root := range m.roots {
			oldRoots[root.Promise.ID] = root
		}
		// Replace roots (don't append) to prevent duplicates on refresh
		m.roots = nil
		for _, p := range msg.Promises {
			newRoot := &RootItem{Promise: p, Expanded: false}
			// Restore state from old root if it exists
			if oldRoot, exists := oldRoots[p.ID]; exists {
				newRoot.Expanded = oldRoot.Expanded
				newRoot.Tree = oldRoot.Tree
				newRoot.Loading = oldRoot.Loading
			}
			m.roots = append(m.roots, newRoot)
		}
		m.cursor = msg.Cursor
		return m, nil

	case TreeLoadedForRootMsg:
		// Find the root and attach the tree
		for _, root := range m.roots {
			if root.Promise.ID == msg.RootID {
				root.Loading = false
				if msg.Err != nil {
					m.err = msg.Err
				} else {
					root.Tree = msg.Tree
				}
				break
			}
		}
		return m, nil

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case tea.KeyMsg:
		return m.updateNavigation(msg)
	}

	return m, tea.Batch(cmds...)
}

func (m Model) updateNavigation(msg tea.KeyMsg) (Model, tea.Cmd) {
	switch {
	case theme.Key(msg, "j", "down"):
		if m.selected < len(m.roots)-1 {
			m.selected++
			m.adjustScroll()
		}

	case theme.Key(msg, "k", "up"):
		if m.selected > 0 {
			m.selected--
			m.adjustScroll()
		}

	case theme.Key(msg, "enter", " "):
		// Toggle expand/collapse for selected root
		if m.selected < len(m.roots) {
			root := m.roots[m.selected]
			if root.Expanded {
				// Collapse
				root.Expanded = false
			} else {
				// Expand - load tree if not already loaded
				root.Expanded = true
				if root.Tree == nil && !root.Loading {
					root.Loading = true
					return m, tea.Batch(m.spinner.Tick, m.fetchTreeForRoot(root.Promise.ID))
				}
			}
		}

	case theme.Key(msg, "i"):
		// Inspect selected root
		if m.selected < len(m.roots) {
			return m, func() tea.Msg {
				return OpenDetailMsg{Promise: m.roots[m.selected].Promise}
			}
		}

	case theme.Key(msg, "a"):
		// Expand all roots
		var cmds []tea.Cmd
		for _, root := range m.roots {
			if !root.Expanded {
				root.Expanded = true
				if root.Tree == nil && !root.Loading {
					root.Loading = true
					cmds = append(cmds, m.fetchTreeForRoot(root.Promise.ID))
				}
			}
		}
		return m, tea.Batch(cmds...)

	case theme.Key(msg, "c"):
		// Collapse all to roots only
		for _, root := range m.roots {
			root.Expanded = false
		}

	case theme.Key(msg, "s"):
		// Cycle sort mode
		m.sortMode = (m.sortMode + 1) % 4
		m.roots = nil
		m.cursor = nil
		m.prevCursors = nil
		m.selected = 0
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchRootsCmd())

	case theme.Key(msg, "1"):
		m.stateFilter = ""
		m.roots = nil
		m.cursor = nil
		m.prevCursors = nil
		m.selected = 0
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchRootsCmd())

	case theme.Key(msg, "2"):
		m.stateFilter = "pending"
		m.roots = nil
		m.cursor = nil
		m.prevCursors = nil
		m.selected = 0
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchRootsCmd())

	case theme.Key(msg, "3"):
		m.stateFilter = "resolved"
		m.roots = nil
		m.cursor = nil
		m.prevCursors = nil
		m.selected = 0
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchRootsCmd())

	case theme.Key(msg, "4"):
		m.stateFilter = "rejected"
		m.roots = nil
		m.cursor = nil
		m.prevCursors = nil
		m.selected = 0
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchRootsCmd())

	case theme.Key(msg, "5"):
		// Cycle type filter
		switch m.typeFilter {
		case "":
			m.typeFilter = "root"
		case "root":
			m.typeFilter = "rpc"
		case "rpc":
			m.typeFilter = "run"
		case "run":
			m.typeFilter = "sleep"
		case "sleep":
			m.typeFilter = ""
		}
		m.roots = nil
		m.cursor = nil
		m.prevCursors = nil
		m.selected = 0
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchRootsCmd())

	case theme.Key(msg, "n"):
		// Next page
		if m.cursor != nil {
			m.prevCursors = append(m.prevCursors, currentCursorPlaceholder(m.roots))
			m.roots = nil
			m.selected = 0
			m.loading = true
			return m, tea.Batch(m.spinner.Tick, m.fetchRootsCmd())
		}

	case theme.Key(msg, "p"):
		// Previous page
		if len(m.prevCursors) > 0 {
			prevCursor := m.prevCursors[len(m.prevCursors)-1]
			m.prevCursors = m.prevCursors[:len(m.prevCursors)-1]
			if prevCursor == "" {
				m.cursor = nil
			} else {
				m.cursor = &prevCursor
			}
			m.roots = nil
			m.selected = 0
			m.loading = true
			return m, tea.Batch(m.spinner.Tick, m.fetchRootsCmd())
		}

	case theme.Key(msg, "r"):
		// Refresh
		m.roots = nil
		m.cursor = nil
		m.prevCursors = nil
		m.selected = 0
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchRootsCmd())
	}

	return m, nil
}

func (m *Model) adjustScroll() {
	availableHeight := m.viewHeight()
	if m.selected < m.offset {
		m.offset = m.selected
	}
	if m.selected >= m.offset+availableHeight {
		m.offset = m.selected - availableHeight + 1
	}
}

func (m Model) viewHeight() int {
	h := m.height - 12 // header, filters, column headers, footer
	if h < 5 {
		h = 5
	}
	return h
}

func (m Model) View() string {
	var b strings.Builder

	// Header
	title := theme.HeaderStyle.Render("Call Graphs")
	sortInfo := theme.DimText.Render(fmt.Sprintf(" (sort: %s)", m.sortMode.String()))
	b.WriteString(title + sortInfo + "\n\n")

	// Filters
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

	// Type filter
	typeLabel := "[5] Type: "
	if m.typeFilter == "" {
		typeLabel += "all"
	} else {
		typeLabel += m.typeFilter
	}
	if m.typeFilter != "" {
		pills = append(pills, theme.FilterActive.Render(typeLabel))
	} else {
		pills = append(pills, theme.FilterInactive.Render(typeLabel))
	}

	b.WriteString(strings.Join(pills, " ") + "\n\n")

	if m.loading && len(m.roots) == 0 {
		b.WriteString(m.spinner.View() + " Loading roots...\n")
		return b.String()
	}

	if m.err != nil {
		b.WriteString(theme.ErrorText.Render("Error: "+m.err.Error()) + "\n")
		return b.String()
	}

	if len(m.roots) == 0 {
		b.WriteString(theme.DimText.Render("No root promises found.") + "\n")
		return b.String()
	}

	// Column headers
	header := fmt.Sprintf("  %-62s %s", "Promise ID", "State")
	b.WriteString(theme.DimText.Render(header) + "\n")
	b.WriteString(theme.DimText.Render(strings.Repeat("─", m.width)) + "\n")

	// Render roots (and expanded trees)
	availableHeight := m.viewHeight()
	rendered := m.renderForest()
	lines := strings.Split(rendered, "\n")

	end := m.offset + availableHeight
	if end > len(lines) {
		end = len(lines)
	}
	start := m.offset
	if start > len(lines) {
		start = len(lines)
	}

	for _, line := range lines[start:end] {
		b.WriteString(line + "\n")
	}

	// Pagination info
	b.WriteString("\n")
	pageInfo := fmt.Sprintf("  %d roots", len(m.roots))
	if m.cursor != nil {
		pageInfo += " (more available: n=next)"
	}
	if len(m.prevCursors) > 0 {
		pageInfo += " (p=prev)"
	}
	b.WriteString(theme.DimText.Render(pageInfo) + "\n")

	// Help
	help := "  enter=expand/collapse  a=expand-all  c=collapse-all  i=inspect  s=sort  1-5=filter  n/p=page  r=refresh  q=quit"
	b.WriteString(theme.HelpStyle.Render(help))

	return b.String()
}

func (m Model) renderForest() string {
	var b strings.Builder
	lineIdx := 0

	for rootIdx, root := range m.roots {
		isSelected := rootIdx == m.selected

		// Render root line
		expandIcon := "▶ "
		if root.Expanded {
			expandIcon = "▼ "
		}

		dot := theme.StatusDot(root.Promise.State)
		state := theme.StyleState(root.Promise.State)
		id := root.Promise.ID

		// Format with proper column widths
		line := fmt.Sprintf("%s%s %-60s %s", expandIcon, dot, id, state)
		if isSelected {
			line = theme.SelectedRow.Render(line)
		}
		b.WriteString(line + "\n")
		lineIdx++

		// Render tree if expanded
		if root.Expanded {
			if root.Loading {
				loadingLine := "  " + m.spinner.View() + " Loading tree..."
				b.WriteString(loadingLine + "\n")
				lineIdx++
			} else if root.Tree != nil {
				// Render the tree with indentation
				treeLines := m.renderTree(root.Tree, "  ")
				b.WriteString(treeLines)
			}
		}
	}

	return strings.TrimRight(b.String(), "\n")
}

func (m Model) renderTree(node *tree.TreeNode, basePrefix string) string {
	if node == nil || len(node.Children) == 0 {
		return ""
	}

	var b strings.Builder
	var render func(n *tree.TreeNode, prefix string, isLast bool)
	render = func(n *tree.TreeNode, prefix string, isLast bool) {
		for i, child := range n.Children {
			childIsLast := i == len(n.Children)-1
			connector := "├── "
			if childIsLast {
				connector = "└── "
			}

			dot := theme.StatusDot(child.Promise.State)
			id := child.Promise.ID
			details := nodeDetails(child)

			line := fmt.Sprintf("%s%s%s %s %s", prefix, theme.TreeConnector.Render(connector), dot, id, details)
			b.WriteString(line + "\n")

			// Recurse for children
			childPrefix := prefix
			if childIsLast {
				childPrefix += "    "
			} else {
				childPrefix += theme.TreeConnector.Render("│   ")
			}
			render(child, childPrefix, childIsLast)
		}
	}

	render(node, basePrefix, false)
	return b.String()
}

func (m Model) fetchRootsCmd() tea.Cmd {
	c := m.Client
	stateFilter := m.stateFilter
	typeFilter := m.typeFilter
	cursor := m.cursor
	sortMode := m.sortMode

	return func() tea.Msg {
		params := client.SearchParams{
			ID:    "*",
			Limit: m.limit,
		}

		if cursor != nil {
			params.Cursor = *cursor
		}

		if stateFilter != "" {
			params.State = stateFilter
		}

		// Apply sorting
		switch sortMode {
		case SortCreatedDesc:
			params.SortID = client.IntPtr(-1)
		case SortCreatedAsc:
			params.SortID = client.IntPtr(1)
		}

		result, err := c.SearchPromises(context.Background(), params)
		if err != nil {
			return RootsLoadedMsg{Err: err}
		}

		// Filter to roots only (client-side for now)
		var roots []client.Promise
		for _, p := range result.Promises {
			// Default: only show root promises (no parent)
			if typeFilter == "" {
				if isRootInSet(p, result.Promises) {
					roots = append(roots, p)
				}
			} else {
				// Type filter: show all promises matching the type
				role := promiseRole(p)
				if role == typeFilter {
					roots = append(roots, p)
				}
			}
		}

		return RootsLoadedMsg{
			Promises: roots,
			Cursor:   result.Cursor,
		}
	}
}

func (m Model) fetchTreeForRoot(rootID string) tea.Cmd {
	c := m.Client

	return func() tea.Msg {
		var allPromises []client.Promise

		// Fetch all promises with resonate:origin tag
		id := "*"
		tags := map[string]string{"resonate:origin": rootID}
		var cursor string

		for {
			params := client.SearchParams{
				ID:     id,
				Tags:   tags,
				Limit:  100,
				Cursor: cursor,
			}
			result, err := c.SearchPromises(context.Background(), params)
			if err != nil {
				return TreeLoadedForRootMsg{RootID: rootID, Err: err}
			}

			allPromises = append(allPromises, result.Promises...)

			if result.Cursor == nil {
				break
			}
			cursor = *result.Cursor
		}

		// If no results with resonate:origin tag, try ID-based search
		if len(allPromises) == 0 {
			// Fetch promises with IDs starting with rootID (e.g., rootID.1, rootID.2, etc.)
			params := client.SearchParams{
				ID:    rootID + "*",
				Limit: 100,
			}
			result, err := c.SearchPromises(context.Background(), params)
			if err == nil {
				allPromises = result.Promises
			}
		}

		// Build tree (handles both tag-based and ID-based parent relationships)
		treeRoot := tree.BuildTree(rootID, allPromises)
		return TreeLoadedForRootMsg{RootID: rootID, Tree: treeRoot}
	}
}

// Refresh reloads from page 1 with current filters.
func (m *Model) Refresh() tea.Cmd {
	// Reset to page 1
	m.cursor = nil
	m.prevCursors = nil
	// Don't reset m.selected - preserve cursor position during auto-refresh
	// Set loading to true to prevent "No roots found" flash
	// Keep old roots visible until new data arrives (don't clear m.roots here)
	m.loading = true
	return m.fetchRootsCmd()
}

// isRoot checks if a promise is a root (has no parent or parent == self).
func isRoot(p client.Promise) bool {
	parent := p.Tags["resonate:parent"]
	return parent == "" || parent == p.ID
}

// isRootInSet checks if a promise is a root within a given set of promises.
// Uses both tag-based and ID-based parent detection.
func isRootInSet(p client.Promise, allPromises []client.Promise) bool {
	// First check tags
	parent := p.Tags["resonate:parent"]
	if parent != "" && parent != p.ID {
		return false // Has a parent tag
	}

	// Fallback: check if any other promise has an ID that is a prefix of this one
	// e.g., "countdown-123.2" is a child of "countdown-123"
	for _, other := range allPromises {
		if other.ID != p.ID && strings.HasPrefix(p.ID, other.ID+".") {
			return false // This promise's ID suggests it's a child
		}
	}

	return true
}

// promiseRole determines the type of a promise (for child promises).
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
	return "root"
}

func nodeDetails(node *tree.TreeNode) string {
	p := node.Promise

	if p.Tags["resonate:timeout"] != "" {
		return theme.SleepLabel.Render("(sleep)")
	}

	switch p.Tags["resonate:scope"] {
	case "global":
		return theme.ScopeGlobal.Render("(rpc)")
	case "local":
		return theme.ScopeLocal.Render("(run)")
	}

	return ""
}

func currentCursorPlaceholder(roots []*RootItem) string {
	// We don't track the exact cursor for the current page, just return empty
	return ""
}
