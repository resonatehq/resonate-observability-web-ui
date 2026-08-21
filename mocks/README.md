# Mock Resonate server

A zero-dependency fixture that speaks the `POST /` envelope protocol, so the UI
can be developed and tested without a Rust toolchain in the loop.

```bash
npm run mock          # http://127.0.0.1:8099, CORS open to the Vite dev server
npm test              # protocol conformance suite
npm run conformance   # diff this fixture against a real server (see below)
```

## Why this exists

The shipped UI calls `GET /promises`, `/promises/{id}`, `/schedules` and
`/schedules/{id}`. All four now answer **410 Gone**. The server moved to a single
`POST /` endpoint taking an envelope, and nothing in this repo noticed for six
months because nothing checked.

This fixture is the check. It is a *fixture*, not a reimplementation: it copies
the server's validation order, status codes, field names, error strings and
pagination semantics, and implements nothing beyond what the UI reads.

## The protocol, in one block

```jsonc
POST /
{
  "kind": "promise.search",
  "head": {
    "corrId": "<any non-empty string; echoed back>",
    "version": "2026-04-01",        // validated; anything else is a 400
    "auth":    "<JWT>"              // only when the server was started with --auth-publickey
  },
  "data": { "state": "pending", "limit": 100 }
}
```

The response mirrors it, and **the HTTP status equals `head.status`**:

```jsonc
{
  "kind": "promise.search",
  "head": { "corrId": "...", "status": 200, "version": "2026-04-01" },
  "data": { "promises": [ ... ], "cursor": "..." }   // a bare STRING on error
}
```

## Things that will bite during the migration

Each of these is covered by a test in `server.test.mjs` and a probe in
`conformance.mjs`.

| | |
|---|---|
| **States are snake_case and there are five** | `pending`, `resolved`, `rejected`, `rejected_canceled`, `rejected_timedout`. Every `'RESOLVED'` / `'PENDING'` comparison in the UI is dead. |
| **The state filter is exact** | Searching `rejected` does **not** return `rejected_canceled` or `rejected_timedout`. A naive "failed" filter silently drops two of the three failure modes. |
| **Field renames** | `timeout`→`timeoutAt`, `createdOn`→`createdAt`, `completedOn`→`settledAt`. `param`/`value` are always present now. |
| **`settledAt` is absent, not null** | Unsettled promises have no such key. Same for a schedule's `lastRunAt`. |
| **Schedules changed too** | `ScheduleRecord` is `{id, cron, promiseId, promiseTimeout, promiseParam, promiseTags, createdAt, nextRunAt, lastRunAt?}`. The UI's `Schedule` interface — `description`, `lastRunTime`, `nextRunTime`, `createdOn` — matches none of it. |
| **There is no id filter and no sort** | `PromiseSearchData` is `{state, tags, limit, cursor}`. An `id` or `sortId` key is **silently ignored**, not rejected — so the wildcard search boxes appear to work and quietly return everything. |
| **Errors put a bare string in `data`** | Not `{error}`, not `{message}`. `body.data.message` renders `undefined`. |
| **Unknown kinds are 400, never 501** | The doc comment at `auth.rs:113` mentions 501; no code path returns it. Do not write a 501 branch. |
| **Tags don't glob** | Exact key *and* value. `probe: "y*"` matches nothing. |
| **The token goes in `head.auth`** | The `Authorization` header is read by nothing. A token that "worked" before will 401 after the port. |

## CORS

The single likeliest first-run failure, and easy to test wrongly.

- Off by default. No `--server-cors-allow-origin` means **no CORS headers at
  all**, and the browser fails before any envelope is parsed — so the failure
  arrives with no status code and needs its own branch in the error taxonomy.
- Every call is preflighted. `content-type: application/json` is not a
  CORS-safelisted value, so the browser sends `OPTIONS` before each `POST`.
- `access-control-allow-methods` / `-allow-headers` appear **only on the
  preflight**, never on the `POST` response.
- A *denied* preflight still answers **200** and still carries methods and
  headers. Only `allow-origin` is withheld. **Status is not a usable CORS
  probe** — check for the `allow-origin` header.
- `--server-cors-allow-origin '*'` swaps in a permissive layer that behaves
  differently again: `*` for methods and headers, an extra `expose-headers`, and
  no `vary`. The fixture reproduces both modes; pass `--cors '*'`.

## Auth

Off unless the server is started with `--auth-publickey`. When on, the token is
a **JWT**, not a password — verified live:

| Token | Result |
|---|---|
| absent / malformed / expired / missing `exp` | `401 Unauthorized` |
| `role: "admin"` | full access |
| `prefix: ""` | full access — the empty prefix is the wildcard |
| `prefix: "foo-"` | **403 on every search**, plus 403 on gets outside `foo-` |
| neither `role` nor `prefix` | `403 Forbidden` |

`exp` is a **required** claim. A token without one fails *verification* and
returns 401, which reads like a permissions problem but is a token-minting
problem.

The 403-on-every-search rule is the important one for this UI: a prefix-scoped
token authorises `*.search` against an empty string, which no non-empty prefix
can satisfy. **A scoped token cannot drive this UI at all.** That is why the
single-tenant/admin-token decision was made, and Settings should say so rather
than rendering an empty table.

### The one place this fixture deliberately diverges

`--jwt` mode reads `role` and `prefix` out of the token payload **without
verifying the signature**. The real server verifies against `--auth-publickey`
(and its `none` mode does not verify either). The status taxonomy the UI depends
on — 401 vs 403 vs 200 — is identical; the cryptography is not reproduced.

`--token <string>` is a simpler shared-secret mode for exercising the same
branches without minting JWTs.

## Verifying the fixture against a real server

The tests prove the fixture is self-consistent. They cannot prove it matches the
server. `conformance.mjs` does that: it runs 65 identical probes against any
envelope-speaking server and prints a JSON report to diff.

```bash
resonate serve --server-port 8098 \
  --storage-sqlite-path /tmp/conf.db \
  --server-cors-allow-origin http://localhost:5173 &

node mocks/conformance.mjs http://127.0.0.1:8098 > real.json
node mocks/conformance.mjs --mock                > mock.json
diff real.json mock.json          # any output is a place this fixture lies
```

The harness seeds what it needs under a `conformance-` id prefix, so it is
meaningful against an empty binary and safe to re-run against a dirty one.

**Last verified:** 2026-08-21 against `resonate 0.9.8` (Homebrew), in three
configurations — explicit-origin CORS, permissive CORS, and
`--auth-publickey none`. 65/65 probes identical in each.

> The fixture defaults to port 8099 and the examples use 8098 for the real
> server, leaving the server's own default of 8001 free. Check with
> `lsof -nP -iTCP:8001 -sTCP:LISTEN` before assuming it is.

## Layout

| File | |
|---|---|
| `protocol.mjs` | Protocol constants and seed data. Fixed timestamps, never `Date.now()`. |
| `server.mjs` | The server. Every rule cites the `resonatehq/resonate` line it came from. |
| `server.test.mjs` | Conformance suite (`node:test`, no dependencies). |
| `conformance.mjs` | Differential harness — runs the same probes anywhere. |

## Seed data

Six workflow trees plus 120 filler promises, enough to force pagination past the
default limit of 100:

| Root | Shape |
|---|---|
| `checkout-7f3a` | resolved, 3 children — the baseline |
| `payout-91bc` | rejected; one child carries a decodable rejection value |
| `sync-inventory-4d2e` | pending, with a sleep child and no `settledAt` |
| `report-nightly-88aa` | `rejected_timedout` |
| `import-legacy-1c5f` | `rejected_canceled` |
| `fanout-2b6d` | resolved, two levels deep — 10 nodes |

Children carry `resonate:parent` and `resonate:origin` so both `buildTree` and
`fetchTreePromises` work. Payloads are base64-encoded JSON, matching the server.
