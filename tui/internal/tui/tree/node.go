package tree

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/resonatehq/resonate-observability/tui/internal/client"
	"github.com/resonatehq/resonate-observability/tui/internal/tui/theme"
)

// TreeNode represents a node in the promise call graph.
type TreeNode struct {
	Promise  client.Promise
	Children []*TreeNode
	Expanded bool
	Depth    int
}

// BuildTree constructs a tree from a flat list of promises.
// The root is identified by rootID. Parent-child relationships come from the
// "resonate:parent" tag.
func BuildTree(rootID string, promises []client.Promise) *TreeNode {
	childrenMap := map[string][]*TreeNode{}
	nodeMap := map[string]*TreeNode{}

	for _, p := range promises {
		node := &TreeNode{Promise: p, Expanded: true}
		nodeMap[p.ID] = node
		if parent, ok := p.Tags["resonate:parent"]; ok && parent != p.ID {
			childrenMap[parent] = append(childrenMap[parent], node)
		}
	}

	// Sort children by CreatedOn
	for _, children := range childrenMap {
		sort.Slice(children, func(i, j int) bool {
			return safeInt64(children[i].Promise.CreatedOn) < safeInt64(children[j].Promise.CreatedOn)
		})
	}

	root, ok := nodeMap[rootID]
	if !ok {
		// Root not found in results — create a placeholder
		root = &TreeNode{
			Promise:  client.Promise{ID: rootID},
			Expanded: true,
		}
	}

	// Assign children recursively
	var assign func(node *TreeNode)
	assign = func(node *TreeNode) {
		node.Children = childrenMap[node.Promise.ID]
		for _, child := range node.Children {
			child.Depth = node.Depth + 1
			assign(child)
		}
	}
	assign(root)

	return root
}

// FlattenVisible returns a flat list of visible nodes (respecting Expanded state).
func FlattenVisible(root *TreeNode) []*TreeNode {
	if root == nil {
		return nil
	}
	var nodes []*TreeNode
	var walk func(node *TreeNode)
	walk = func(node *TreeNode) {
		nodes = append(nodes, node)
		if node.Expanded {
			for _, child := range node.Children {
				walk(child)
			}
		}
	}
	walk(root)
	return nodes
}

// RenderNode renders a single tree node as a styled string.
func RenderNode(node *TreeNode, prefix string, isLast bool, isRoot bool, isSelected bool) string {
	var connector string
	if isRoot {
		connector = ""
	} else if !isLast {
		connector = theme.TreeConnector.Render("├── ")
	} else {
		connector = theme.TreeConnector.Render("└── ")
	}

	// Expand/collapse indicator
	expandIcon := ""
	if len(node.Children) > 0 {
		if node.Expanded {
			expandIcon = "▼ "
		} else {
			expandIcon = "▶ "
		}
	} else {
		expandIcon = "  "
	}

	// Status dot
	dot := theme.StatusDot(node.Promise.State)

	// Promise ID
	id := node.Promise.ID

	// Details (scope + function name)
	details := nodeDetails(node)

	line := fmt.Sprintf("%s%s%s%s %s %s", prefix, connector, expandIcon, dot, id, details)

	if isSelected {
		line = theme.SelectedRow.Render(line)
	}

	return line
}

// ChildPrefix returns the prefix string for rendering children of a node.
func ChildPrefix(parentPrefix string, isLast bool, isRoot bool) string {
	if isRoot {
		return parentPrefix
	}
	if !isLast {
		return parentPrefix + theme.TreeConnector.Render("│   ")
	}
	return parentPrefix + "    "
}

func nodeDetails(node *TreeNode) string {
	p := node.Promise

	var funcName string
	if p.Param.Data != nil {
		if b, err := base64.StdEncoding.DecodeString(*p.Param.Data); err == nil {
			var d map[string]any
			if err := json.Unmarshal(b, &d); err == nil {
				funcName, _ = d["func"].(string)
			}
		}
	}

	if funcName != "" {
		funcName = " " + funcName
	}

	if p.Tags["resonate:timeout"] != "" {
		return theme.SleepLabel.Render("(sleep)")
	}

	switch p.Tags["resonate:scope"] {
	case "global":
		return theme.ScopeGlobal.Render(fmt.Sprintf("(rpc%s)", funcName))
	case "local":
		return theme.ScopeLocal.Render(fmt.Sprintf("(run%s)", funcName))
	}

	if funcName != "" {
		return theme.DimText.Render(fmt.Sprintf("(%s)", strings.TrimSpace(funcName)))
	}

	return ""
}

func safeInt64(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}
