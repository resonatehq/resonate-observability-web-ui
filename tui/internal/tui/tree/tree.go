package tree

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/resonatehq/resonate-observability/tui/internal/client"
	"github.com/resonatehq/resonate-observability/tui/internal/tui/theme"
)

// Messages
type TreeLoadedMsg struct {
	Promises []client.Promise
	Err      error
}

type OpenDetailFromTreeMsg struct {
	Promise client.Promise
}

// Model is the interactive tree view.
type Model struct {
	Client *client.Client
	RootID string

	root     *TreeNode
	visible  []*TreeNode
	selected int
	spinner  spinner.Model
	loading  bool
	err      error
	width    int
	height   int
	offset   int // scroll offset
}

func New(c *client.Client) Model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("99"))

	return Model{
		Client:  c,
		spinner: s,
	}
}

// Load fetches the tree for the given root ID.
func (m *Model) Load(rootID string) tea.Cmd {
	m.RootID = rootID
	m.loading = true
	m.root = nil
	m.visible = nil
	m.selected = 0
	m.offset = 0
	return tea.Batch(m.spinner.Tick, m.fetchCmd())
}

func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		return m.updateNavigation(msg)

	case TreeLoadedMsg:
		m.loading = false
		if msg.Err != nil {
			m.err = msg.Err
			return m, nil
		}
		m.err = nil
		m.root = BuildTree(m.RootID, msg.Promises)
		m.visible = FlattenVisible(m.root)
		m.selected = 0
		m.offset = 0
		return m, nil

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}

	return m, nil
}

func (m Model) updateNavigation(msg tea.KeyMsg) (Model, tea.Cmd) {
	switch {
	case theme.Key(msg, "j", "down"):
		if m.selected < len(m.visible)-1 {
			m.selected++
			m.adjustScroll()
		}

	case theme.Key(msg, "k", "up"):
		if m.selected > 0 {
			m.selected--
			m.adjustScroll()
		}

	case theme.Key(msg, "enter", " "):
		if len(m.visible) > 0 && m.selected < len(m.visible) {
			node := m.visible[m.selected]
			if len(node.Children) > 0 {
				node.Expanded = !node.Expanded
				m.visible = FlattenVisible(m.root)
				// Clamp selected
				if m.selected >= len(m.visible) {
					m.selected = len(m.visible) - 1
				}
			} else {
				// Leaf node — open detail
				return m, func() tea.Msg {
					return OpenDetailFromTreeMsg{Promise: node.Promise}
				}
			}
		}

	case theme.Key(msg, "l", "right"):
		// Expand selected node
		if len(m.visible) > 0 && m.selected < len(m.visible) {
			node := m.visible[m.selected]
			if len(node.Children) > 0 && !node.Expanded {
				node.Expanded = true
				m.visible = FlattenVisible(m.root)
			}
		}

	case theme.Key(msg, "h", "left"):
		// Collapse selected node, or jump to parent
		if len(m.visible) > 0 && m.selected < len(m.visible) {
			node := m.visible[m.selected]
			if node.Expanded && len(node.Children) > 0 {
				node.Expanded = false
				m.visible = FlattenVisible(m.root)
			} else {
				// Jump to parent
				parentID := node.Promise.Tags["resonate:parent"]
				if parentID != "" {
					for i, n := range m.visible {
						if n.Promise.ID == parentID {
							m.selected = i
							m.adjustScroll()
							break
						}
					}
				}
			}
		}

	case theme.Key(msg, "i"):
		// Inspect — open detail for selected node
		if len(m.visible) > 0 && m.selected < len(m.visible) {
			node := m.visible[m.selected]
			return m, func() tea.Msg {
				return OpenDetailFromTreeMsg{Promise: node.Promise}
			}
		}

	case theme.Key(msg, "r"):
		m.loading = true
		return m, tea.Batch(m.spinner.Tick, m.fetchCmd())
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
	h := m.height - 6 // header, footer, padding
	if h < 5 {
		h = 5
	}
	return h
}

func (m Model) View() string {
	var b strings.Builder

	// Title
	title := theme.HeaderStyle.Render("Call Graph")
	if m.RootID != "" {
		title += "  " + theme.DimText.Render(m.RootID)
	}
	b.WriteString(title + "\n\n")

	if m.loading {
		b.WriteString(m.spinner.View() + " Loading tree...\n")
		return b.String()
	}

	if m.err != nil {
		b.WriteString(theme.ErrorText.Render("Error: "+m.err.Error()) + "\n")
		return b.String()
	}

	if m.root == nil || len(m.visible) == 0 {
		b.WriteString(theme.DimText.Render("No tree data. Specify a root promise ID.") + "\n")
		return b.String()
	}

	// Render visible portion of tree
	availableHeight := m.viewHeight()
	rendered := m.renderTree()
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

	// Status
	b.WriteString("\n")
	status := fmt.Sprintf("  %d nodes  (%d/%d)", len(m.visible), m.selected+1, len(m.visible))
	b.WriteString(theme.DimText.Render(status) + "\n")

	// Help
	help := "  j/k=navigate  enter/space=toggle  h/l=collapse/expand  i=inspect  r=refresh  esc=back"
	b.WriteString(theme.HelpStyle.Render(help))

	return b.String()
}

func (m Model) renderTree() string {
	if m.root == nil {
		return ""
	}

	var b strings.Builder
	var render func(node *TreeNode, prefix string, isLast bool, isRoot bool, index *int)
	render = func(node *TreeNode, prefix string, isLast bool, isRoot bool, index *int) {
		isSelected := *index == m.selected
		b.WriteString(RenderNode(node, prefix, isLast, isRoot, isSelected) + "\n")
		*index++

		if node.Expanded {
			childPrefix := ChildPrefix(prefix, isLast, isRoot)
			for i, child := range node.Children {
				render(child, childPrefix, i == len(node.Children)-1, false, index)
			}
		}
	}

	idx := 0
	render(m.root, "", true, true, &idx)
	return strings.TrimRight(b.String(), "\n")
}

func (m Model) fetchCmd() tea.Cmd {
	c := m.Client
	rootID := m.RootID

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
				return TreeLoadedMsg{Err: err}
			}

			allPromises = append(allPromises, result.Promises...)

			if result.Cursor == nil {
				break
			}
			cursor = *result.Cursor
		}

		// If no results with resonate:origin, try resonate:root (old format)
		if len(allPromises) == 0 {
			allPromises = fetchWithRootTag(c, rootID)
		}

		return TreeLoadedMsg{Promises: allPromises}
	}
}

// fetchWithRootTag implements the old-format BFS tree loading using resonate:root tag.
func fetchWithRootTag(c *client.Client, rootID string) []client.Promise {
	type searchItem struct {
		id     string
		origin string
		cursor string
	}

	var allPromises []client.Promise
	queue := []searchItem{{id: "*", origin: rootID}}

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		params := client.SearchParams{
			ID:     item.id,
			Tags:   map[string]string{"resonate:root": item.origin},
			Limit:  100,
			Cursor: item.cursor,
		}
		result, err := c.SearchPromises(context.Background(), params)
		if err != nil {
			break
		}

		for _, p := range result.Promises {
			allPromises = append(allPromises, p)
			// Global scope with different origin means a new branch
			if p.Tags["resonate:scope"] == "global" && p.ID != item.origin {
				queue = append(queue, searchItem{id: "*", origin: p.ID})
			}
		}

		if result.Cursor != nil {
			queue = append(queue, searchItem{
				id:     item.id,
				origin: item.origin,
				cursor: *result.Cursor,
			})
		}
	}

	return allPromises
}
