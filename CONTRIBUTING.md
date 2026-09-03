# Contributing to Resonate UI

Thanks for your interest in contributing! This project is in its early stages and we welcome bug reports, feature ideas, and code contributions.

## Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/resonatehq/resonate-ui/issues/new).

When reporting a bug, please include:

- **What you expected** to happen
- **What actually happened** (screenshots help!)
- **Steps to reproduce** the issue
- **Environment** — browser, OS, Node.js version, Resonate server version
- **Console errors** — check the browser dev tools console and include any errors

When requesting a feature:

- **Describe the problem** you're trying to solve
- **Suggest a solution** if you have one in mind
- **Share context** — how would this help your workflow?

## Development Setup

```bash
# Clone the repo
git clone https://github.com/resonatehq/resonate-ui.git
cd resonate-ui

# Install dependencies
npm install

# Start the dev server
npm run dev
```

You don't need a server to develop: `npm run mock` starts a fixture speaking the real protocol on `:8099`, and every screenshot in the README comes from it. To work against a real [Resonate server](https://github.com/resonatehq/resonate), configure its URL at `/settings` in the UI.

### Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server at localhost:5173 |
| `npm run mock` | Protocol fixture on localhost:8099 — develop without a server |
| `npm test` | Protocol conformance tests |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run check` | Run svelte-check (type checking) |

## Submitting Changes

1. **Fork the repo** and create a branch from `main`
2. **Make your changes** — keep commits focused and well-described
3. **Run `npm run check` and `npm test`** — CI enforces both, plus a build and a container smoke test, on every PR
4. **Test manually** — the fixture (`npm run mock`) covers most changes; use a running Resonate server when you touch the protocol
5. **Open a pull request** with a clear description of what you changed and why

### Code Style

- TypeScript throughout — avoid `any` types where possible
- Svelte 5 runes (`$state`, `$derived`, `$effect`) for reactivity
- Keep components focused — one responsibility per component
- Follow existing naming conventions and file organization

## Community

- **Discord** — Join the [Resonate Discord](https://discord.gg/AHGHZPrDH3) to chat with the team

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
