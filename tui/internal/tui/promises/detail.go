package promises

import (
	"encoding/base64"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/resonatehq/resonate-observability/tui/internal/client"
	"github.com/resonatehq/resonate-observability/tui/internal/tui/theme"
)

// DetailModel displays a single promise's full details.
type DetailModel struct {
	Promise  *client.Promise
	viewport viewport.Model
	ready    bool
	width    int
	height   int
}

func NewDetail() DetailModel {
	return DetailModel{}
}

func (m *DetailModel) SetPromise(p *client.Promise, width, height int) {
	m.Promise = p
	m.width = width
	m.height = height
	content := m.renderContent()
	m.viewport = viewport.New(width, height-4) // reserve space for header/footer
	m.viewport.SetContent(content)
	m.ready = true
}

func (m DetailModel) Update(msg tea.Msg) (DetailModel, tea.Cmd) {
	if !m.ready {
		return m, nil
	}

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.viewport.Width = msg.Width
		m.viewport.Height = msg.Height - 4
		if m.Promise != nil {
			m.viewport.SetContent(m.renderContent())
		}
	}

	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

func (m DetailModel) View() string {
	if !m.ready || m.Promise == nil {
		return "No promise selected."
	}

	var b strings.Builder
	title := theme.HeaderStyle.Render("Promise Detail")
	b.WriteString(title + "\n\n")
	b.WriteString(m.viewport.View())
	b.WriteString("\n")
	help := "  esc=back  t=tree  j/k=scroll"
	b.WriteString(theme.HelpStyle.Render(help))
	return b.String()
}

func (m DetailModel) renderContent() string {
	p := m.Promise
	if p == nil {
		return ""
	}

	var b strings.Builder

	row := func(label, value string) {
		b.WriteString(theme.LabelStyle.Render(label) + " " + value + "\n")
	}

	row("ID", p.ID)
	row("State", theme.StyleState(p.State))
	row("Timeout", formatDuration(p.Timeout))
	row("Created", formatTimestamp(p.CreatedOn))
	row("Completed", formatTimestamp(p.CompletedOn))

	// Function name
	funcName := extractFunc(*p)
	if funcName != "" {
		row("Function", funcName)
	}

	// Scope
	if scope, ok := p.Tags["resonate:scope"]; ok {
		row("Scope", scope)
	}

	// Param
	b.WriteString("\n")
	b.WriteString(theme.HeaderStyle.Render("Param") + "\n")
	renderValue(&b, p.Param)

	// Value
	b.WriteString("\n")
	b.WriteString(theme.HeaderStyle.Render("Value") + "\n")
	renderValue(&b, p.Value)

	// Tags
	b.WriteString("\n")
	b.WriteString(theme.HeaderStyle.Render("Tags") + "\n")
	if len(p.Tags) == 0 {
		b.WriteString(theme.DimText.Render("  (none)") + "\n")
	} else {
		keys := make([]string, 0, len(p.Tags))
		for k := range p.Tags {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			v := p.Tags[k]
			if strings.HasPrefix(k, "resonate:") {
				b.WriteString("  " + theme.ResonateTag.Render(k) + " = " + theme.TagValue.Render(v) + "\n")
			} else {
				b.WriteString("  " + theme.TagKey.Render(k) + " = " + theme.TagValue.Render(v) + "\n")
			}
		}
	}

	return b.String()
}

func renderValue(b *strings.Builder, v client.Value) {
	if len(v.Headers) > 0 {
		b.WriteString("  " + theme.DimText.Render("Headers:") + "\n")
		keys := make([]string, 0, len(v.Headers))
		for k := range v.Headers {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			b.WriteString("    " + theme.TagKey.Render(k) + ": " + v.Headers[k] + "\n")
		}
	}

	if v.Data != nil && *v.Data != "" {
		decoded, err := base64.StdEncoding.DecodeString(*v.Data)
		if err != nil {
			b.WriteString("  " + theme.DimText.Render("Data (raw): ") + *v.Data + "\n")
		} else {
			b.WriteString("  " + theme.DimText.Render("Data:") + "\n")
			b.WriteString("    " + string(decoded) + "\n")
		}
	} else {
		b.WriteString("  " + theme.DimText.Render("(empty)") + "\n")
	}
}

func formatDuration(ms int64) string {
	d := time.Duration(ms) * time.Millisecond
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}

func formatTimestamp(t *int64) string {
	if t == nil {
		return "-"
	}
	ts := time.UnixMilli(*t)
	ago := time.Since(ts)
	relative := ""
	switch {
	case ago < time.Minute:
		relative = fmt.Sprintf(" (%ds ago)", int(ago.Seconds()))
	case ago < time.Hour:
		relative = fmt.Sprintf(" (%dm ago)", int(ago.Minutes()))
	case ago < 24*time.Hour:
		relative = fmt.Sprintf(" (%dh ago)", int(ago.Hours()))
	}
	return ts.Format("2006-01-02 15:04:05 UTC") + theme.DimText.Render(relative)
}
