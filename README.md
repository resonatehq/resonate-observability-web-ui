# Resonate Observability

> **Experimental** observability tools for exploring and debugging [Resonate](https://github.com/resonatehq/resonate) durable execution systems.

This monorepo contains two complementary interfaces for monitoring Resonate promises and schedules:

- **TUI** (Terminal User Interface) — Go-based terminal dashboard using [Bubble Tea](https://github.com/charmbracelet/bubbletea)
- **Web UI** — Browser-based dashboard using [SvelteKit](https://kit.svelte.dev/)

Both UIs connect to any Resonate server via its HTTP API.

---

## Features

### Call Graph Forest View (Default)
- **Visualize all active workflows** — See all root promises with their call graphs at a glance
- **Expandable trees** — Click to expand any root and see its full promise tree
- **Smart filtering** — Filter by state (pending/resolved/rejected) and type (root/rpc/run/sleep)
- **Flexible sorting** — Sort by created time or resolved time (ascending/descending)
- **Pagination** — Load more roots on demand
- **Auto-refresh** — Keeps view up-to-date every 5 seconds (TUI) or 5 seconds (Web UI)

### Promise List View (TUI Only)
- Search promises by ID pattern (wildcards supported)
- Filter by state and type
- View detailed promise information
- Inspect parameters, values, and tags

### Single-Tree View
- Deep-dive into a specific promise call graph
- Fully recursive tree building using `resonate:parent` tags
- Expand/collapse nodes
- Inspect individual promises in context

---

## TUI Quick Start

### Prerequisites
- Go 1.21+
- Running Resonate server (default: `http://localhost:8001`)

### Build & Run

```bash
cd tui
go build .
./resonate-observability-tui --server http://localhost:8001
```

### Flags

```
--server string      Resonate server URL (default "http://localhost:8001")
--view string        Initial view: graphs (default), list, tree
--root string        Root promise ID for tree view
--refresh duration   Auto-refresh interval (default 5s)
--token string       Bearer auth token
--username string    Basic auth username
--password string    Basic auth password
```

### Keyboard Shortcuts

**Call Graphs (Forest View):**
- `1-4` — Filter by state (all, pending, resolved, rejected)
- `5` — Cycle type filter (all roots, root, rpc, run, sleep)
- `s` — Cycle sort mode (created ↓/↑, resolved ↓/↑)
- `j/k` — Navigate up/down
- `enter/space` — Expand/collapse selected root
- `a` — Expand all roots
- `c` — Collapse all to roots only
- `i` — Inspect selected root
- `n/p` — Next/previous page
- `r` — Manual refresh
- `tab` — Switch views
- `q` — Quit

**Promise List:**
- `/` — Search
- `1-4` — Filter by state (all, pending, resolved, rejected)
- `5` — Toggle roots only (show/hide child promises)
- `j/k` — Navigate up/down
- `enter` — View detail
- `t` — View tree from selected promise
- `n/p` — Next/previous page
- `r` — Manual refresh
- `tab` — Switch views
- `esc` — Back to graphs
- `q` — Quit

**Tree View:**
- `j/k` — Navigate
- `enter/space` — Toggle node expand/collapse
- `h/l` — Collapse/expand node
- `i` — Inspect selected promise
- `r` — Refresh tree
- `tab` — Switch views
- `esc` — Back to graphs
- `q` — Quit

**Detail View:**
- `j/k` — Scroll
- `t` — View tree from this promise
- `esc` — Back
- `q` — Quit

---

## Web UI Quick Start

### Prerequisites
- Node.js 18+
- npm or pnpm
- Running Resonate server (default: `http://localhost:8001`)

### Install & Run

```bash
cd web-ui
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Production Build

```bash
npm run build
npm run preview
```

### Configuration

Edit connection settings in the UI at `/settings` or configure the default server in `src/lib/stores/connection.svelte.ts`.

---

## Architecture

### TUI Structure

```
tui/
├── main.go                      # CLI entry point
├── internal/
│   ├── client/                  # HTTP client for Resonate API
│   │   ├── types.go            # Promise, Value, SearchResult types
│   │   └── client.go           # SearchPromises, GetPromise methods
│   └── tui/                    # Bubble Tea components
│       ├── app.go              # Root model & view routing
│       ├── theme/              # Brand colors & styles
│       ├── promises/           # List & detail views
│       └── tree/               # Tree view & node rendering
```

### Web UI Structure

```
web-ui/
├── src/
│   ├── lib/
│   │   ├── api/client.ts           # Resonate API client
│   │   ├── components/             # Reusable Svelte components
│   │   └── stores/                 # Connection state management
│   └── routes/
│       ├── promises/               # Promise list & detail pages
│       ├── schedules/              # Schedule list page
│       ├── tree/[id]/              # Tree visualization page
│       ├── settings/               # Connection settings
│       └── api/proxy/[...path]/    # Server-side API proxy
```

---

## Brand Colors

Both interfaces use the Resonate brand design system:

| Token | Value | Usage |
|-------|-------|-------|
| Dark | `#080A0E` | Primary background |
| Secondary (Teal) | `#1EE3CF` | Brand accent, CTAs, highlights |
| Primary | `#E4E7EB` | Body text on dark backgrounds |
| Muted | `#94A3B8` | Subtle elements, help text |

**Typography:** Inter (web) / System monospace (terminal)

---

## API Compatibility

Both UIs use the Resonate HTTP API:

- `GET /promises` — Search promises with filtering
- `GET /promises/{id}` — Get promise by ID
- `GET /schedules` — List schedules

Query parameters use deepObject encoding for tags:
```
GET /promises?tags[resonate:origin]=workflow-123
```

---

## Development Status

⚠️ **Experimental** — These tools are under active development. Features, APIs, and UI design may change.

### Known Limitations
- Web UI pagination is basic (no cursor-based paging yet)
- Tree view performance degrades with very large promise graphs (>1000 nodes)
- No real-time updates (polling only)

### Roadmap
- [ ] Real-time updates via Server-Sent Events (SSE)
- [ ] Advanced filtering (by tags, time ranges, custom queries)
- [ ] Promise timeline visualization
- [ ] Schedule management UI
- [ ] Metrics & analytics dashboard
- [ ] Export/import promise data

---

## Contributing

This is an experimental project. Feedback and contributions welcome!

1. Report issues or suggest features via GitHub Issues
2. Share your use cases on [Discord](https://discord.gg/AHGHZPrDH3)
3. Submit PRs with improvements

---

## License

[Apache 2.0](LICENSE) — same as the Resonate project.

---

## Links

- [Resonate Server](https://github.com/resonatehq/resonate)
- [Documentation](https://docs.resonatehq.io)
- [Discord Community](https://discord.gg/AHGHZPrDH3)
- [Resonate HQ](https://www.resonatehq.io)
