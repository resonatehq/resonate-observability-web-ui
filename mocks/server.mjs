#!/usr/bin/env node
/**
 * Mock Resonate server speaking the `POST /` envelope protocol.
 *
 * This exists so the UI migration can be verified continuously without a Rust
 * toolchain in the loop. It is a *fixture*, not a reimplementation: it copies
 * the server's request validation, status codes, field names and pagination
 * semantics exactly, and does nothing else. Divergences are listed in
 * mocks/README.md and are all in the auth layer.
 *
 * Usage:
 *   node mocks/server.mjs [--port 8099] [--cors <origin>] [--token <token>]
 *                         [--prefix <prefix>] [--latency <ms>]
 *
 *   --cors    repeatable; mirrors `--server-cors-allow-origin`. Omitted means
 *             no CORS headers at all, which is the real server's default and
 *             the single likeliest first-run failure for an operator.
 *   --token   require this exact string in `head.auth`. Omitted means auth is
 *             off, which is also the real server's default.
 *   --prefix  authorisation prefix for the accepted token. Reproduces the
 *             403-on-every-search behaviour of a non-admin scoped token.
 *   --latency artificial per-request delay, for exercising loading states.
 */

import { createServer } from 'node:http';
import {
	DEFAULT_SEARCH_LIMIT,
	LEGACY_PATHS,
	MAX_SEARCH_LIMIT,
	PROMISE_STATES,
	PROTOCOL_VERSION,
	SUPPORTED_VERSIONS,
	KNOWN_KINDS,
	seedPromises,
	seedSchedules
} from './protocol.mjs';

// ─── Envelope helpers ────────────────────────────────────────────────────────

// src/types.rs:824-842 — every response carries the request's kind and corrId.
const envelope = (kind, corrId, status, data) => ({
	kind,
	head: { corrId, status, version: PROTOCOL_VERSION },
	data
});

// src/types.rs:836-838 — an error's `data` is a bare string, not an object.
const errorEnvelope = (kind, corrId, status, message) =>
	envelope(kind, corrId, status, message);

// ─── Store ───────────────────────────────────────────────────────────────────

export function createStore() {
	// A deterministic monotonic clock, never Date.now(). Records created during
	// a test run must be reproducible, and the seed data uses fixed timestamps
	// for the same reason.
	let tick = 1_755_100_000_000;
	return {
		promises: seedPromises(),
		schedules: seedSchedules(),
		clock: () => (tick += 1000)
	};
}

/**
 * Tag matching — persistence_sqlite.rs:635-637.
 *
 * The SQL is a NOT EXISTS over an EXCEPT, i.e. every key/value pair in the
 * filter must be present in the record's tags. It is a subset test, not an
 * equality test, and values are exact — there is no globbing.
 */
function tagsMatch(recordTags, filterTags) {
	return Object.entries(filterTags).every(([k, v]) => recordTags?.[k] === v);
}

/**
 * Cursor pagination — server.rs:977-989, persistence_sqlite.rs:631-641.
 *
 * Ordering is `ORDER BY id ASC` and the cursor is the last id of the previous
 * page, applied as `id > cursor`. The cursor is only returned when there is a
 * further page. This is the *only* ordering the server offers: there is no
 * sort parameter and no id filter (src/types.rs:382-389), which is why the
 * UI's wildcard search boxes have no backend.
 */
function paginate(records, cursor, limit) {
	const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const start = cursor == null ? 0 : sorted.findIndex((r) => r.id > cursor);
	const from = start === -1 ? sorted.length : start;
	const page = sorted.slice(from, from + limit + 1);
	const hasMore = page.length > limit;
	const result = page.slice(0, limit);
	return { result, cursor: hasMore ? result[result.length - 1]?.id : undefined };
}

/** server.rs:964-975 — limit is optional, defaults to 100, and 1000 is the cap. */
function resolveLimit(raw) {
	if (raw == null) return { limit: DEFAULT_SEARCH_LIMIT };
	if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
		return { error: 'Limit must be a positive integer' };
	}
	if (raw > MAX_SEARCH_LIMIT) {
		return { error: "Invalid 'limit' — must be between 1 and 1000" };
	}
	return { limit: raw };
}

// ─── Operations ──────────────────────────────────────────────────────────────

const ops = {
	'promise.get'(store, { kind, corrId, data }) {
		if (typeof data.id !== 'string' || data.id.length === 0) {
			return errorEnvelope(kind, corrId, 400, 'Promise ID is required');
		}
		const found = store.promises.find((p) => p.id === data.id);
		// server.rs:529-537
		if (!found) return errorEnvelope(kind, corrId, 404, 'Promise not found');
		return envelope(kind, corrId, 200, { promise: found });
	},

	/**
	 * Write operations exist only so the fixture can be seeded through the same
	 * code path as a real server (see mocks/conformance.mjs). The UI is
	 * read-only until C4 and must not call these.
	 */
	'promise.create'(store, { kind, corrId, data }) {
		// src/types.rs:269-280
		if (typeof data.id !== 'string' || data.id.length === 0) {
			return errorEnvelope(kind, corrId, 400, 'Promise ID is required');
		}
		if (!Number.isInteger(data.timeoutAt) || data.timeoutAt < 0) {
			return errorEnvelope(kind, corrId, 400, 'TimeoutAt must be a non-negative integer');
		}
		const existing = store.promises.find((p) => p.id === data.id);
		// promise.create is idempotent on id — re-creating returns the existing
		// record rather than erroring, which is what makes reseeding safe.
		if (existing) return envelope(kind, corrId, 200, { promise: existing });
		const record = {
			id: data.id,
			state: 'pending',
			param: data.param ?? {},
			value: {},
			tags: data.tags ?? {},
			timeoutAt: data.timeoutAt,
			createdAt: store.clock()
		};
		store.promises.push(record);
		// 200, not 201 — the server uses ResponseEnvelope::success throughout
		// (src/types.rs:840-841), which hardcodes 200.
		return envelope(kind, corrId, 200, { promise: record });
	},

	'promise.settle'(store, { kind, corrId, data }) {
		// src/types.rs:338-345. SettleState has only three variants
		// (src/types.rs:100-104): there is no way to settle into
		// rejected_timedout — the server does that itself on expiry.
		if (typeof data.id !== 'string' || data.id.length === 0) {
			return errorEnvelope(kind, corrId, 400, 'Promise ID is required');
		}
		if (!['resolved', 'rejected', 'rejected_canceled'].includes(data.state)) {
			return errorEnvelope(kind, corrId, 400, `Invalid request: unknown variant \`${data.state}\``);
		}
		const found = store.promises.find((p) => p.id === data.id);
		if (!found) return errorEnvelope(kind, corrId, 404, 'Promise not found');
		if (found.state === 'pending') {
			found.state = data.state;
			found.value = data.value ?? {};
			found.settledAt = store.clock();
		}
		return envelope(kind, corrId, 200, { promise: found });
	},

	'schedule.create'(store, { kind, corrId, data }) {
		// src/types.rs:616-632
		for (const [field, message] of [
			['id', 'Schedule ID is required'],
			['cron', 'Cron expression is required'],
			['promiseId', 'Promise ID template is required']
		]) {
			if (typeof data[field] !== 'string' || data[field].length === 0) {
				return errorEnvelope(kind, corrId, 400, message);
			}
		}
		const existing = store.schedules.find((s) => s.id === data.id);
		if (existing) return envelope(kind, corrId, 200, { schedule: existing });
		const record = {
			id: data.id,
			cron: data.cron,
			promiseId: data.promiseId,
			promiseTimeout: data.promiseTimeout ?? 0,
			promiseParam: data.promiseParam ?? {},
			promiseTags: data.promiseTags ?? {},
			createdAt: store.clock(),
			nextRunAt: store.clock() + 3_600_000
		};
		store.schedules.push(record);
		return envelope(kind, corrId, 200, { schedule: record });
	},

	'schedule.delete'(store, { kind, corrId, data }) {
		const i = store.schedules.findIndex((s) => s.id === data.id);
		if (i === -1) return errorEnvelope(kind, corrId, 404, 'Schedule not found');
		store.schedules.splice(i, 1);
		// server.rs:2445-2452 — 200 with an empty object, not 204.
		return envelope(kind, corrId, 200, {});
	},

	'promise.search'(store, { kind, corrId, data }) {
		// src/types.rs:382-389 — {state, tags, limit, cursor}. Nothing else.
		if (data.state != null && !PROMISE_STATES.includes(data.state)) {
			return errorEnvelope(
				kind,
				corrId,
				400,
				`Invalid request: unknown variant \`${data.state}\`, expected one of ${PROMISE_STATES.map((s) => `\`${s}\``).join(', ')}`
			);
		}
		const { limit, error } = resolveLimit(data.limit);
		if (error) return errorEnvelope(kind, corrId, 400, error);

		// The state filter is exact equality (persistence_sqlite.rs:634), so
		// `rejected` does NOT match `rejected_canceled` or `rejected_timedout`.
		// A UI "failed" filter therefore needs three queries or client-side work.
		const matched = store.promises.filter(
			(p) =>
				(data.state == null || p.state === data.state) &&
				(data.tags == null || tagsMatch(p.tags, data.tags))
		);
		const { result, cursor } = paginate(matched, data.cursor, limit);
		const out = { promises: result };
		// `cursor` is skip_serializing_if = Option::is_none (src/types.rs:673).
		if (cursor !== undefined) out.cursor = cursor;
		return envelope(kind, corrId, 200, out);
	},

	'schedule.get'(store, { kind, corrId, data }) {
		if (typeof data.id !== 'string' || data.id.length === 0) {
			return errorEnvelope(kind, corrId, 400, 'Schedule ID is required');
		}
		const found = store.schedules.find((s) => s.id === data.id);
		if (!found) return errorEnvelope(kind, corrId, 404, 'Schedule not found');
		return envelope(kind, corrId, 200, { schedule: found });
	},

	'schedule.search'(store, { kind, corrId, data }) {
		// src/types.rs:654-660 — {tags, limit, cursor}. No state, no id.
		const { limit, error } = resolveLimit(data.limit);
		if (error) return errorEnvelope(kind, corrId, 400, error);
		const matched = store.schedules.filter(
			(s) => data.tags == null || tagsMatch(s.promiseTags, data.tags)
		);
		const { result, cursor } = paginate(matched, data.cursor, limit);
		const out = { schedules: result };
		if (cursor !== undefined) out.cursor = cursor;
		return envelope(kind, corrId, 200, out);
	},

	'task.search'(store, { kind, corrId, data }) {
		// Seeded empty on purpose. A TaskRecord carries no promise or root id
		// (src/types.rs:226-237), so tasks cannot be joined to the workflow they
		// are running — there is nothing useful for the UI to render yet.
		const { limit, error } = resolveLimit(data.limit);
		if (error) return errorEnvelope(kind, corrId, 400, error);
		return envelope(kind, corrId, 200, { tasks: [] });
	}
};

// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * auth.rs:301-306 — the resource id each kind is authorised against. The three
 * search kinds return an empty string, which can only satisfy an empty (admin
 * or wildcard) prefix. Any narrower prefix is a 403 on every search.
 */
function resourceIdFor(kind, data) {
	if (kind === 'promise.search' || kind === 'task.search' || kind === 'schedule.search') {
		return '';
	}
	return typeof data?.id === 'string' ? data.id : null;
}

/**
 * Reads `role` and `prefix` out of a JWT payload without verifying the
 * signature — which is exactly what the real server does in unsigned mode
 * (auth.rs:263-269). `exp` is a *required* claim and is checked
 * (auth.rs:273-275, 289); a token without one is a 401, not a 403.
 */
function decodeJwtClaims(token) {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
		if (typeof claims !== 'object' || claims === null) return null;
		if (typeof claims.exp !== 'number') return null; // required spec claim
		if (claims.exp * 1000 <= Date.now()) return null; // validate_exp = true
		return claims;
	} catch {
		return null;
	}
}

/**
 * Applies the authorisation rules from auth.rs:145-243, all verified against a
 * live server:
 *
 *   role: "admin"        → everything
 *   prefix: ""           → everything (empty prefix is the wildcard)
 *   prefix: "foo-"       → 403 on EVERY search; gets allowed only within foo-
 *   neither role nor prefix → 403 on anything with a resource id
 */
function authorize(claims, { kind, corrId, data }) {
	if (typeof claims.role === 'string' && claims.role.toLowerCase() === 'admin') return null;
	const prefix = claims.prefix;
	if (typeof prefix !== 'string') {
		// Absent, null, or not a string — all 403 (auth.rs:157-177, 229-238).
		return errorEnvelope(kind, corrId, 403, 'Forbidden');
	}
	if (prefix === '') return null;
	const resourceId = resourceIdFor(kind, data);
	if (resourceId === null) return null;
	if (!resourceId.startsWith(prefix)) {
		return errorEnvelope(kind, corrId, 403, 'Forbidden');
	}
	return null;
}

function authCheck(config, { kind, corrId, auth, data }) {
	// server.rs:270 — the whole block is skipped when auth is unconfigured,
	// which is the default. Most operators will never see any of this.
	if (config.mode === 'off') return null;

	// auth.rs:120-131 — a missing token is 401, not 403. Note the real server
	// ignores the Authorization header entirely; only head.auth is read.
	if (auth == null) return errorEnvelope(kind, corrId, 401, 'Unauthorized');

	if (config.mode === 'token') {
		// Simplified mode: one shared string. Enough to exercise the UI's
		// 401/403/200 branches without minting JWTs.
		if (auth !== config.token) return errorEnvelope(kind, corrId, 401, 'Unauthorized');
		return authorize({ role: config.prefix ? undefined : 'admin', prefix: config.prefix }, { kind, corrId, data });
	}

	// JWT mode: paste a real operator token in and get the real verdict.
	const claims = decodeJwtClaims(auth);
	// auth.rs:132-143 — every verification failure collapses to 401
	// Unauthorized. Expired, malformed and wrong-algorithm are indistinguishable
	// to the client, so the UI cannot tell the operator which one it was.
	if (claims == null) return errorEnvelope(kind, corrId, 401, 'Unauthorized');
	return authorize(claims, { kind, corrId, data });
}

// ─── Request handling ────────────────────────────────────────────────────────

/**
 * The validation ladder from server.rs:175-240, in the server's order. Order
 * matters: a request with both a bad version and an unknown kind gets the
 * version error, because the version gate runs before dispatch.
 */
export function handleEnvelope(store, config, raw) {
	let req;
	try {
		req = JSON.parse(raw);
	} catch {
		// server.rs:152-173 — kind and corrId are best-effort, corrId falls
		// back to the literal string "0".
		return errorEnvelope('', '0', 400, 'Invalid request envelope: expected value');
	}

	const kind = typeof req?.kind === 'string' ? req.kind : '';
	const corrId =
		typeof req?.head?.corrId === 'string' && req.head.corrId.length > 0
			? req.head.corrId
			: '0';

	if (req == null || typeof req !== 'object' || Array.isArray(req)) {
		return errorEnvelope(kind, corrId, 400, 'Invalid request envelope: expected object');
	}
	if (req.head == null || typeof req.head !== 'object') {
		return errorEnvelope(kind, corrId, 400, 'Invalid request envelope: missing field `head`');
	}
	if (typeof req.head.corrId !== 'string') {
		return errorEnvelope(kind, corrId, 400, 'Invalid request envelope: missing field `corrId`');
	}
	if (typeof req.head.version !== 'string') {
		return errorEnvelope(kind, corrId, 400, 'Invalid request envelope: missing field `version`');
	}
	// server.rs:205-214
	if (kind.length === 0) {
		return errorEnvelope(
			kind,
			corrId,
			400,
			'Missing or invalid \'kind\' field — must be a non-empty string'
		);
	}
	// server.rs:216-224 — arrays and scalars are both rejected here.
	if (req.data == null || typeof req.data !== 'object' || Array.isArray(req.data)) {
		return errorEnvelope(kind, corrId, 400, "Invalid 'data' field — must be an object");
	}
	// server.rs:227-238
	if (!SUPPORTED_VERSIONS.includes(req.head.version)) {
		return errorEnvelope(
			kind,
			corrId,
			400,
			`Unsupported protocol version '${req.head.version}', supported versions: ${JSON.stringify(SUPPORTED_VERSIONS)}`
		);
	}

	const denied = authCheck(config, { kind, corrId, auth: req.head.auth, data: req.data });
	if (denied) return denied;

	const op = ops[kind];
	if (!op) {
		if (KNOWN_KINDS.includes(kind)) {
			// The real server implements this; the fixture does not. 501 is used
			// deliberately because the real server never returns it — so a 501
			// always means "fixture gap", never "server rejected you".
			return errorEnvelope(
				kind,
				corrId,
				501,
				`Kind '${kind}' is real but not implemented by the mock fixture`
			);
		}
		// server.rs:473-480. Note this is 400 — the server never returns 501,
		// despite the stale doc comment at auth.rs:113 claiming it does.
		return errorEnvelope(kind, corrId, 400, `Unknown operation: ${kind}`);
	}

	return op(store, { kind, corrId, data: req.data });
}

/**
 * CORS — main.rs:441-464, verified against a running v0.9.8 binary.
 *
 * Three things here are easy to get wrong and were all confirmed live:
 *
 * 1. `allow-methods` / `allow-headers` appear ONLY on the OPTIONS preflight.
 *    The actual POST response carries `allow-origin` and nothing else.
 * 2. The preflight answers 200, not 204.
 * 3. A disallowed origin still gets a 200 preflight carrying methods and
 *    headers — it just omits `allow-origin`, which is what the browser
 *    actually checks. Probing the preflight status tells you nothing.
 *
 * The preflight is not hypothetical: `content-type: application/json` is not a
 * CORS-safelisted request header, so the browser preflights *every* call this
 * UI makes. A server with no `--server-cors-allow-origin` fails at the
 * preflight, before any envelope is ever parsed — which is why that failure
 * carries no status code and needs its own branch in the UI's error taxonomy.
 */
const CORS_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const CORS_HEADERS = 'origin,content-length,content-type,authorization';

function corsOriginFor(config, origin) {
	if (config.cors.length === 0) return null;
	// main.rs:445-447 — "*" swaps in CorsLayer::permissive(), which mirrors
	// any origin rather than echoing the literal star.
	if (config.cors.includes('*')) return '*';
	return config.cors.includes(origin) ? origin : null;
}

function applyCors(res, config, origin, { preflight }) {
	if (config.cors.length === 0) return; // real server default: no headers at all

	// CorsLayer::permissive() behaves noticeably differently from the explicit
	// layer, and operators reach for `*` first — so the fixture reproduces it
	// rather than approximating. Verified live: no `vary`, `*` for methods and
	// headers, and an extra expose-headers on the actual response.
	if (config.cors.includes('*')) {
		res.setHeader('access-control-allow-origin', '*');
		if (preflight) {
			res.setHeader('access-control-allow-methods', '*');
			res.setHeader('access-control-allow-headers', '*');
		} else {
			res.setHeader('access-control-expose-headers', '*');
		}
		return;
	}

	res.setHeader('vary', 'origin, access-control-request-method, access-control-request-headers');
	if (preflight) {
		res.setHeader('access-control-allow-methods', CORS_METHODS);
		res.setHeader('access-control-allow-headers', CORS_HEADERS);
	}
	const allowed = corsOriginFor(config, origin);
	if (allowed != null) res.setHeader('access-control-allow-origin', allowed);
}

export function createMockServer(config = {}) {
	const resolved = {
		cors: config.cors ?? [],
		token: config.token ?? null,
		prefix: config.prefix ?? '',
		latency: config.latency ?? 0,
		// 'off' is the real server's default: no --auth-publickey, no checks.
		mode: config.jwt ? 'jwt' : config.token != null ? 'token' : 'off'
	};
	const store = config.store ?? createStore();

	const server = createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost');
		const origin = req.headers.origin ?? '';
		applyCors(res, resolved, origin, { preflight: req.method === 'OPTIONS' });

		const send = (status, body) => {
			const payload = JSON.stringify(body);
			res.writeHead(status, {
				'content-type': 'application/json',
				'content-length': Buffer.byteLength(payload)
			});
			res.end(payload);
		};

		const respond = (status, body) => {
			if (resolved.latency > 0) setTimeout(() => send(status, body), resolved.latency);
			else send(status, body);
		};

		if (req.method === 'OPTIONS') {
			// 200 with an empty body, matching tower-http. `allow: POST` is
			// axum's own method-not-allowed hint and rides along on `/`.
			if (url.pathname === '/') res.setHeader('allow', 'POST');
			res.writeHead(200, { 'content-length': '0' });
			res.end();
			return;
		}

		// server.rs:102-104
		if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/ready')) {
			respond(200, { status: 'ok' });
			return;
		}

		// server.rs:106-125 — the endpoints the current UI still calls.
		const isLegacy = LEGACY_PATHS.some(
			(p) => url.pathname === p || url.pathname.startsWith(`${p}/`)
		);
		if (isLegacy) {
			respond(410, {
				error: 'This endpoint is no longer supported. Please update to the latest SDK.'
			});
			return;
		}

		if (req.method !== 'POST' || url.pathname !== '/') {
			respond(404, { error: 'Not found' });
			return;
		}

		let body = '';
		req.on('data', (chunk) => {
			body += chunk;
		});
		req.on('end', () => {
			const result = handleEnvelope(store, resolved, body);
			// server.rs:146-150 — the HTTP status mirrors head.status.
			respond(result.head.status, result);
		});
	});

	return { server, store, config: resolved };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
	const out = { port: 8099, cors: [], token: null, prefix: '', latency: 0, jwt: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => argv[++i];
		if (arg === '--port') out.port = Number(next());
		else if (arg === '--cors') out.cors.push(next());
		else if (arg === '--token') out.token = next();
		else if (arg === '--prefix') out.prefix = next();
		else if (arg === '--latency') out.latency = Number(next());
		else if (arg === '--jwt') out.jwt = true;
		else if (arg === '--help' || arg === '-h') out.help = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return out;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(
			'Usage: node mocks/server.mjs [--port 8099] [--cors <origin>] [--token <t>] [--prefix <p>] [--jwt] [--latency <ms>]'
		);
		process.exit(0);
	}
	const { server, store, config } = createMockServer(args);
	server.listen(args.port, '127.0.0.1', () => {
		console.log(`mock resonate server on http://127.0.0.1:${args.port}`);
		console.log(`  protocol version : ${PROTOCOL_VERSION}`);
		console.log(`  promises seeded  : ${store.promises.length}`);
		console.log(`  schedules seeded : ${store.schedules.length}`);
		console.log(
			`  cors             : ${config.cors.length ? config.cors.join(', ') : 'off (browser calls will fail — this is the real default)'}`
		);
		console.log(
			`  auth             : ${
				config.mode === 'off'
					? 'off (the real default)'
					: config.mode === 'jwt'
						? 'jwt — role/prefix read from the token, signature not verified'
						: `shared token${config.prefix ? `, prefix "${config.prefix}"` : ' (admin)'}`
			}`
		);
	});
}
