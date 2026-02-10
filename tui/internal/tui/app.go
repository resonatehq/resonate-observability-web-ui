package tui

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/resonatehq/resonate-observability/tui/internal/client"
	"github.com/resonatehq/resonate-observability/tui/internal/tui/promises"
	"github.com/resonatehq/resonate-observability/tui/internal/tui/theme"
	"github.com/resonatehq/resonate-observability/tui/internal/tui/tree"
)

type View int

const (
	ViewPromiseList View = iota
	ViewPromiseDetail
	ViewTree
)

type Options struct {
	InitialView     string
	TreeRootID      string
	RefreshInterval time.Duration
}

type tickMsg time.Time

// Model is the root TUI model.
type Model struct {
	client  *client.Client
	options Options

	activeView   View
	previousView View
	width        int
	height       int
	serverURL    string

	promiseList   promises.Model
	promiseDetail promises.DetailModel
	treeView      tree.Model

	showHelp bool
}

func NewModel(c *client.Client, opts Options) Model {
	m := Model{
		client:        c,
		options:       opts,
		activeView:    ViewPromiseList,
		previousView:  ViewPromiseList,
		serverURL:     c.BaseURL,
		promiseList:   promises.New(c),
		promiseDetail: promises.NewDetail(),
		treeView:      tree.New(c),
	}

	if opts.InitialView == "tree" && opts.TreeRootID != "" {
		m.activeView = ViewTree
	}

	return m
}

func (m Model) Init() tea.Cmd {
	var cmds []tea.Cmd
	cmds = append(cmds, m.promiseList.Init())

	if m.activeView == ViewTree && m.options.TreeRootID != "" {
		cmds = append(cmds, m.treeView.Load(m.options.TreeRootID))
	}

	if m.options.RefreshInterval > 0 {
		cmds = append(cmds, tickCmd(m.options.RefreshInterval))
	}

	return tea.Batch(cmds...)
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case tea.KeyMsg:
		// Global keys
		if theme.Key(msg, "q", "ctrl+c") {
			return m, tea.Quit
		}

		if theme.Key(msg, "?") && m.activeView != ViewPromiseList {
			m.showHelp = !m.showHelp
			return m, nil
		}

		if theme.Key(msg, "tab") {
			switch m.activeView {
			case ViewPromiseList:
				if m.treeView.RootID != "" {
					m.activeView = ViewTree
				}
			case ViewTree:
				m.activeView = ViewPromiseList
			}
			return m, nil
		}

		if theme.Key(msg, "esc") {
			switch m.activeView {
			case ViewPromiseDetail:
				m.activeView = m.previousView
				return m, nil
			case ViewTree:
				m.activeView = ViewPromiseList
				return m, nil
			}
		}

		// View-specific "t" for jumping to tree from detail
		if theme.Key(msg, "t") && m.activeView == ViewPromiseDetail {
			if m.promiseDetail.Promise != nil {
				rootID := m.promiseDetail.Promise.Tags["resonate:origin"]
				if rootID == "" {
					rootID = m.promiseDetail.Promise.ID
				}
				m.activeView = ViewTree
				m.previousView = ViewTree
				return m, m.treeView.Load(rootID)
			}
		}

	case promises.OpenDetailMsg:
		m.previousView = m.activeView
		m.activeView = ViewPromiseDetail
		m.promiseDetail.SetPromise(&msg.Promise, m.width, m.height)
		return m, nil

	case promises.OpenTreeMsg:
		m.activeView = ViewTree
		m.previousView = ViewPromiseList
		return m, m.treeView.Load(msg.RootID)

	case tree.OpenDetailFromTreeMsg:
		m.previousView = ViewTree
		m.activeView = ViewPromiseDetail
		m.promiseDetail.SetPromise(&msg.Promise, m.width, m.height)
		return m, nil

	case tickMsg:
		cmds = append(cmds, tickCmd(m.options.RefreshInterval))
		if m.activeView == ViewPromiseList {
			cmds = append(cmds, m.promiseList.Refresh())
		}
		return m, tea.Batch(cmds...)
	}

	// Delegate to active view
	switch m.activeView {
	case ViewPromiseList:
		var cmd tea.Cmd
		m.promiseList, cmd = m.promiseList.Update(msg)
		cmds = append(cmds, cmd)

	case ViewPromiseDetail:
		var cmd tea.Cmd
		m.promiseDetail, cmd = m.promiseDetail.Update(msg)
		cmds = append(cmds, cmd)

	case ViewTree:
		var cmd tea.Cmd
		m.treeView, cmd = m.treeView.Update(msg)
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

func (m Model) View() string {
	var b strings.Builder

	// Tab bar
	tabs := []struct {
		label string
		view  View
	}{
		{"Promises", ViewPromiseList},
		{"Tree", ViewTree},
	}

	var tabParts []string
	for _, t := range tabs {
		if m.activeView == t.view || (m.activeView == ViewPromiseDetail && m.previousView == t.view) {
			tabParts = append(tabParts, theme.TabActive.Render(t.label))
		} else {
			tabParts = append(tabParts, theme.TabInactive.Render(t.label))
		}
	}
	b.WriteString("  " + strings.Join(tabParts, "  ") + "    " + theme.DimText.Render(m.serverURL) + "\n")
	b.WriteString(theme.DimText.Render(strings.Repeat("─", m.width)) + "\n")

	// Active view content
	switch m.activeView {
	case ViewPromiseList:
		b.WriteString(m.promiseList.View())
	case ViewPromiseDetail:
		b.WriteString(m.promiseDetail.View())
	case ViewTree:
		b.WriteString(m.treeView.View())
	}

	if m.showHelp {
		b.WriteString("\n\n")
		b.WriteString(renderHelp())
	}

	return b.String()
}

func tickCmd(d time.Duration) tea.Cmd {
	return tea.Tick(d, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func renderHelp() string {
	help := []string{
		theme.HeaderStyle.Render("Keyboard Shortcuts"),
		"",
		fmt.Sprintf("  %s  %s", theme.HeaderStyle.Render("Global"), ""),
		"  q/ctrl+c    Quit",
		"  tab         Switch views",
		"  ?           Toggle help",
		"",
		fmt.Sprintf("  %s  %s", theme.HeaderStyle.Render("Promise List"), ""),
		"  /           Search",
		"  1-4         Filter by state",
		"  5           Toggle roots only",
		"  j/k         Navigate",
		"  enter       View detail",
		"  t           View tree",
		"  n/p         Next/prev page",
		"  r           Refresh",
		"",
		fmt.Sprintf("  %s  %s", theme.HeaderStyle.Render("Tree"), ""),
		"  j/k         Navigate",
		"  enter/space  Toggle node",
		"  h/l         Collapse/expand",
		"  i           Inspect node",
		"  r           Refresh",
		"",
		fmt.Sprintf("  %s  %s", theme.HeaderStyle.Render("Detail"), ""),
		"  esc         Back",
		"  t           View tree",
		"  j/k         Scroll",
	}
	return theme.HelpStyle.Render(strings.Join(help, "\n"))
}
