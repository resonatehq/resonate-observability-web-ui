# Resonate Observability Web UI

> **Early Stage** — This tool is under active development. Expect rough edges! Please [file an issue](https://github.com/resonatehq/resonate-observability-web-ui/issues) if you run into problems or have ideas, and consider [contributing](CONTRIBUTING.md) fixes.

A browser-based dashboard for exploring and debugging [Resonate](https://github.com/resonatehq/resonate) durable execution systems. Built with [SvelteKit](https://kit.svelte.dev/), [Svelte Flow](https://svelteflow.dev/), and [dagre](https://github.com/dagrejs/dagre).

---

## Features

### Dashboard
- **At-a-glance metrics** — active, resolved and failed counts, honestly labelled as a sample
- **State distribution** — donut across all five states, with timeouts and cancellations
  broken out from outright rejections
- **Throughput chart** — promise completion over the last hour
- **Active workflows** — oldest pending first, so the stuck ones surface
- **Error list** — recent failures, each labelled with which kind of failure it was

### Workflow Graph View
- **Interactive DAG visualization** — the full call graph of any workflow
- **Color-coded nodes** — pending, resolved, rejected, timed out and canceled are five
  distinct colours, not three
- **Zoom, pan, and fit** — navigate large graphs with ease
- **Auto-layout** — hierarchical layout via dagre

### Call Graph Forest View
- **Visualize all workflows** — every root promise with its call graph at a glance
- **Filter by state** — all five states, each filtered exactly
- **Pagination** — cursor-based; load more roots on demand
- **Auto-refresh** — every 5 seconds, refetching only the trees that actually changed

### Timeline View
- **Waterfall visualization** — See promise execution timing as horizontal bars
- **Duration display** — Understand where time is being spent

### Promises & Schedules
- **Filter promises by state**, and page through with a cursor
- **Promise detail** — decoded parameters and values, tags, timings and duration
- **Browse schedules** — cron, promise-ID template, last and next run

> There is no ID search. The server has no ID filter, and a box that appeared to search
> while returning everything is worse than no box. See
> [What the server does not offer](#what-the-server-does-not-offer).

### Settings
- **Configure server connection** — URL and optional auth token
- **Test connection** — reports whether the server is reachable *and* whether the token
  works, rather than always claiming success
- **Light/Dark mode** — toggle between themes

---

## Quick Start

### Prerequisites
- Node.js 20.19+, 22.12+, or 24+ (required by Vite 8)
- npm
- A running [Resonate server](https://github.com/resonatehq/resonate) (default: `http://localhost:8001`)

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and set your server URL at `/settings`.

**Your browser calls the server directly**, so unless you serve this UI from the same
origin as the server, you must start the server with the UI's origin allowed:

```bash
resonate serve --server-cors-allow-origin http://localhost:5173
```

Without it, requests fail at the CORS preflight — before the server ever sees them — and
arrive in the browser with no status code. Settings has a **Test connection** button that
tells you which side is at fault.

### No server to hand?

A mock speaking the same protocol ships with the repo:

```bash
npm run mock        # http://127.0.0.1:8099, seeded with example workflows
```

See [`mocks/README.md`](mocks/README.md).

### Production Build

```bash
npm run build       # static files in build/ — no Node runtime needed to serve them
npm run preview
npm test            # protocol conformance suite
```

---

## Architecture

```
mocks/                               # Protocol fixture + conformance tests
src/
├── lib/
│   ├── api/client.ts                # Envelope client, error taxonomy, payload decoding
│   ├── components/                  # Reusable Svelte components
│   │   ├── dashboard/               # Dashboard widgets (metrics, charts)
│   │   ├── graph/                   # Workflow DAG visualization (Svelte Flow)
│   │   └── timeline/                # Timeline/waterfall visualization
│   ├── stores/                      # Svelte stores (connection, dashboard, theme)
│   └── utils/                       # Tree building, timeline layout, statistics, state display
└── routes/
    ├── +page.svelte                 # Dashboard
    ├── promises/                    # Promise list & detail pages
    ├── schedules/                   # Schedule list & detail pages
    ├── workflows/                   # Workflow list & DAG detail pages
    ├── tree/[id]/                   # Redirects to /workflows/[id]
    └── settings/                    # Connection settings
```

### Key Design Decisions
- **Static SPA, no proxy** — the browser calls the operator's server directly. The build is
  plain files; nothing server-side runs. This replaced a SvelteKit proxy route that fetched
  a client-supplied URL and mirrored the auth token into a non-`HttpOnly` cookie.
- **Single-tenant, self-hosted** — the operator owns the server and the data, so their own
  payloads are rendered as-is. This is not a multi-tenant console.
- **Five states, shown as five** — `rejected`, `rejected_canceled` and `rejected_timedout`
  get distinct colours and labels throughout. A failure, a cancellation and a missed
  deadline call for different responses.
- **Svelte 5 runes** — `$state`, `$derived`, `$effect` for reactive state.
- **dagre layout** — automatic hierarchical layout for workflow DAGs.
- **Polling** — views auto-refresh every 5s (pauses when the tab is hidden).

### Auth

Only relevant if the server was started with `--auth-publickey`. The token is a **JWT** and
travels in the request body as `head.auth`; an `Authorization` header is ignored. It needs
an `exp` claim, and either `role: "admin"` or an empty `prefix` claim — a prefix-scoped token
cannot run searches at all, so it cannot drive this UI.

> ⚠️ The token is stored in `localStorage` in plain text, and a token that can drive this UI
> can read and modify every promise on the server. That is a reasonable trade for a tool on
> your own machine, and not one for a page served on a shared network.

---

## API Compatibility

This UI speaks the server's envelope protocol, version **`2026-04-01`**. Every request is a
`POST /`:

```
POST /
{ "kind": "promise.search",
  "head": { "corrId": "...", "version": "2026-04-01", "auth": "<jwt>" },
  "data": { "state": "pending", "limit": 100 } }
```

The legacy REST endpoints (`GET /promises`, `/schedules`, …) return **410 Gone** and are not
used. The protocol version is validated by the server, so a mismatch is reported plainly
rather than failing obscurely.

### What the server does not offer

These are absences, not omissions in this UI — worth knowing before filing a bug:

- **No ID filter and no sort on search.** `promise.search` takes only
  `{state, tags, limit, cursor}`. Listings are ordered by promise ID, and there are no
  search boxes, because an unrecognised parameter is *silently ignored* rather than
  rejected — a search box here would have returned everything while appearing to filter.
- **The state filter is exact.** Asking for `rejected` does not return `rejected_canceled`
  or `rejected_timedout`, which is why the filters list all five states separately.
- **No way to list a schedule's runs.** That needs a prefix match on the promise-ID
  template. The schedule's own `lastRunAt` is shown instead.
- **No promise-population metrics.** `/metrics` exposes API traffic, not promise counts by
  state, so the dashboard counts client-side over one page and labels itself
  *"sampled from N"* rather than implying a total.
- **No task-to-workflow link.** `TaskRecord` carries no promise or root ID, so "which
  worker is running my stuck workflow" is not answerable yet.

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

- **Read-only.** No cancel or settle yet; there is no mutation layer, and every view polls
  on a 5s interval, so a write would visibly revert on the next refresh.
- Filter state is component-local — deep links like `/workflows?state=pending` do not yet
  restore the filter.
- Graph performance degrades on very large promise trees (>1000 nodes); no virtualization.
- Polling only, no push. The server's SSE endpoint is for workers, not general subscription.
- Accessibility gaps: clickable table rows have no keyboard path, and tab bars lack
  `role="tablist"`.

### Roadmap
- [ ] Shared selection across graph / timeline / list on the run detail view
- [ ] URL-backed filter and view state
- [ ] Operator actions (cancel, settle) with poll suppression and confirmation
- [ ] Accessibility pass (keyboard navigation, ARIA, focus management)
- [ ] Self-host the Inter font so air-gapped installs do not block on a CDN
- [ ] Scheduled CI job that boots a pinned server and asserts a real round trip

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
