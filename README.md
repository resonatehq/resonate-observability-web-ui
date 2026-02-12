# Resonate Observability Web UI

> **Early Stage** — This tool is under active development. Expect rough edges! Please [file an issue](https://github.com/resonatehq/resonate-observability-web-ui/issues) if you run into problems or have ideas, and consider [contributing](CONTRIBUTING.md) fixes.

A browser-based dashboard for exploring and debugging [Resonate](https://github.com/resonatehq/resonate) durable execution systems. Built with [SvelteKit](https://kit.svelte.dev/), [Svelte Flow](https://svelteflow.dev/), and [dagre](https://github.com/dagrejs/dagre).

---

## Features

### Dashboard
- **At-a-glance metrics** — Total promises, active workflows, error counts
- **State distribution** — Donut chart showing pending/resolved/rejected/cancelled breakdown
- **Throughput chart** — Visualize promise completion over time
- **Active workflows** — Quick list of in-flight workflows
- **Error list** — Surface recent failures

### Workflow Graph View
- **Interactive DAG visualization** — See the full call graph of any workflow as a directed acyclic graph
- **Color-coded nodes** — Instantly identify pending, resolved, rejected, and cancelled promises
- **Zoom, pan, and fit** — Navigate large graphs with ease
- **Auto-layout** — Hierarchical layout via dagre

### Call Graph Forest View
- **Visualize all active workflows** — See all root promises with their call graphs at a glance
- **Expandable trees** — Click to expand any root and see its full promise tree
- **Smart filtering** — Filter by state (pending/resolved/rejected) and type (root/rpc/run/sleep)
- **Flexible sorting** — Sort by created time or resolved time
- **Pagination** — Load more roots on demand
- **Auto-refresh** — Keeps view up-to-date every 5 seconds

### Timeline View
- **Waterfall visualization** — See promise execution timing as horizontal bars
- **Duration display** — Understand where time is being spent

### Promise & Schedule Management
- **Search promises** by ID pattern (wildcards supported)
- **Filter by state** and type
- **View detailed promise information** — Parameters, values, tags, timestamps
- **Browse schedules** — View schedule configurations and status

### Settings
- **Configure server connection** — URL and optional auth token
- **Light/Dark mode** — Toggle between themes

---

## Quick Start

### Prerequisites
- Node.js 18+
- npm
- A running [Resonate server](https://github.com/resonatehq/resonate) (default: `http://localhost:8001`)

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and configure your server connection at `/settings`.

### Production Build

```bash
npm run build
npm run preview
```

---

## Architecture

```
src/
├── lib/
│   ├── api/client.ts               # Resonate API client
│   ├── components/                  # Reusable Svelte components
│   │   ├── dashboard/               # Dashboard widgets (metrics, charts)
│   │   ├── graph/                   # Workflow DAG visualization (Svelte Flow)
│   │   └── timeline/                # Timeline/waterfall visualization
│   ├── stores/                      # Svelte stores (connection, dashboard, theme)
│   └── utils/                       # Tree building, timeline layout, statistics
└── routes/
    ├── +page.svelte                 # Dashboard
    ├── promises/                    # Promise list & detail pages
    ├── schedules/                   # Schedule list & detail pages
    ├── workflows/                   # Workflow list & DAG detail pages
    ├── tree/[id]/                   # Tree visualization page
    ├── settings/                    # Connection settings
    └── api/proxy/[...path]/         # Server-side API proxy (handles CORS/auth)
```

### Key Design Decisions
- **Server-side proxy** — All API calls go through a SvelteKit server route, avoiding CORS issues and keeping auth tokens server-side
- **Svelte 5 runes** — Uses `$state`, `$derived`, and `$effect` for reactive state management
- **dagre layout** — Automatic hierarchical graph layout for workflow DAGs
- **Polling** — Views auto-refresh via polling (pauses when tab is hidden)

---

## API Compatibility

Connects to the Resonate HTTP API:

- `GET /promises` — Search promises with filtering
- `GET /promises/{id}` — Get promise by ID
- `GET /schedules` — List schedules
- `GET /schedules/{id}` — Get schedule by ID

Query parameters use deepObject encoding for tags:
```
GET /promises?tags[resonate:origin]=workflow-123
```

---

## Brand Colors

| Token | Value | Usage |
|-------|-------|-------|
| Dark | `#080A0E` | Primary background |
| Secondary (Teal) | `#1EE3CF` | Brand accent, CTAs, highlights |
| Primary | `#E4E7EB` | Body text on dark backgrounds |
| Muted | `#94A3B8` | Subtle elements, help text |

**Typography:** Inter (web) / System monospace (code)

---

## Known Limitations

- Pagination is basic (no cursor-based paging yet)
- Tree view performance degrades with very large promise graphs (>1000 nodes)
- No real-time updates (polling only — SSE planned)
- No tests yet

### Roadmap
- [ ] Real-time updates via Server-Sent Events (SSE)
- [ ] Advanced filtering (by tags, time ranges, custom queries)
- [ ] Schedule management UI (create/pause/resume)
- [ ] Export/import promise data
- [ ] Accessibility improvements (ARIA labels, keyboard navigation)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on reporting issues and submitting changes.

---

## License

[Apache 2.0](LICENSE) — same as the Resonate project.

---

## Links

- [Resonate Server](https://github.com/resonatehq/resonate)
- [Documentation](https://docs.resonatehq.io)
- [Discord Community](https://discord.gg/AHGHZPrDH3)
- [Resonate HQ](https://www.resonatehq.io)
