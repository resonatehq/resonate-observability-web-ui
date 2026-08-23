/**
 * Conformance tests for the mock server.
 *
 * These assert the *protocol contract*, not the fixture's convenience. Each
 * assertion corresponds to something read out of `resonatehq/resonate` and is
 * cited. If the server changes, these are what fail first — which is the point:
 * the previous UI rotted for six months precisely because nothing checked.
 *
 * Run: npm test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from './server.mjs';
import {
	PROMISE_STATES,
	PROTOCOL_VERSION,
	DEFAULT_SEARCH_LIMIT
} from './protocol.mjs';

let baseUrl;
let handle;

before(async () => {
	handle = createMockServer({ cors: ['http://localhost:5173'] });
	await new Promise((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
	baseUrl = `http://127.0.0.1:${handle.server.address().port}`;
});

after(() => handle.server.close());

let corrCounter = 0;
const nextCorrId = () => `test-${++corrCounter}`;

async function rpc(kind, data, { corrId = nextCorrId(), version = PROTOCOL_VERSION, auth, url = baseUrl } = {}) {
	const head = { corrId, version };
	if (auth !== undefined) head.auth = auth;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ kind, head, data })
	});
	return { status: res.status, body: await res.json() };
}

describe('envelope', () => {
	test('response echoes kind and corrId and carries the protocol version', async () => {
		const { body } = await rpc('promise.search', {}, { corrId: 'abc-123' });
		assert.equal(body.kind, 'promise.search');
		assert.equal(body.head.corrId, 'abc-123');
		assert.equal(body.head.version, PROTOCOL_VERSION);
	});

	test('HTTP status mirrors head.status', async () => {
		// server.rs:146-150
		const { status, body } = await rpc('promise.get', { id: 'does-not-exist' });
		assert.equal(status, 404);
		assert.equal(body.head.status, 404);
	});

	test('an unsupported protocol version is rejected', async () => {
		// server.rs:227-238. This is the gate that makes head.version mandatory
		// rather than decorative — a client that omits or guesses it gets nothing.
		const { status, body } = await rpc('promise.search', {}, { version: '2025-01-01' });
		assert.equal(status, 400);
		assert.match(body.data, /Unsupported protocol version '2025-01-01'/);
	});

	test('version is validated before the kind is dispatched', async () => {
		// Order matters for the UI's error taxonomy: a stale client hitting a
		// newer server sees a version error, not a mysterious unknown-operation.
		const { body } = await rpc('not.a.real.kind', {}, { version: '1999-01-01' });
		assert.match(body.data, /Unsupported protocol version/);
	});

	test('an empty kind is rejected', async () => {
		const { status, body } = await rpc('', {});
		assert.equal(status, 400);
		assert.match(body.data, /must be a non-empty string/);
	});

	test('non-object data is rejected', async () => {
		// server.rs:216-224 — arrays count as non-objects here.
		const res = await fetch(baseUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				kind: 'promise.search',
				head: { corrId: 'x', version: PROTOCOL_VERSION },
				data: []
			})
		});
		assert.equal(res.status, 400);
		assert.match((await res.json()).data, /must be an object/);
	});

	test('malformed JSON falls back to corrId "0"', async () => {
		// server.rs:152-173 — the fallback exists so an error can still be
		// correlated. A client must tolerate a corrId it did not send.
		const res = await fetch(baseUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{not json'
		});
		assert.equal(res.status, 400);
		const body = await res.json();
		assert.equal(body.head.corrId, '0');
	});

	test('an unknown kind is 400, never 501', async () => {
		// The doc comment at auth.rs:113 mentions 501; no code path returns it.
		// The UI's error taxonomy must not have a 501 branch.
		const { status, body } = await rpc('promise.frobnicate', {});
		assert.equal(status, 400);
		assert.match(body.data, /Unknown operation: promise\.frobnicate/);
	});

	test('an error response carries a bare string in data', async () => {
		// src/types.rs:836-838 — not {error: ...}, not {message: ...}. A client
		// that reaches for body.data.message renders "undefined".
		const { body } = await rpc('promise.get', { id: 'nope' });
		assert.equal(typeof body.data, 'string');
		assert.equal(body.data, 'Promise not found');
	});
});

describe('legacy REST endpoints', () => {
	// server.rs:106-125. This is what makes the shipped UI a blank screen: it
	// calls exactly these paths.
	for (const path of ['/promises', '/promises/some-id', '/schedules', '/tasks']) {
		test(`GET ${path} is 410 Gone`, async () => {
			const res = await fetch(`${baseUrl}${path}`);
			assert.equal(res.status, 410);
			assert.match((await res.json()).error, /no longer supported/);
		});
	}
});

describe('promise.get', () => {
	test('returns the record under data.promise', async () => {
		// src/types.rs:665-668 — wrapped, not returned bare as the old REST API did.
		const { body } = await rpc('promise.get', { id: 'checkout-7f3a' });
		assert.equal(body.head.status, 200);
		assert.equal(body.data.promise.id, 'checkout-7f3a');
	});

	test('the record uses the new field names', async () => {
		// src/types.rs:211-224 — timeout→timeoutAt, createdOn→createdAt,
		// completedOn→settledAt. Every one of these is a rename the UI must make.
		const { body } = await rpc('promise.get', { id: 'checkout-7f3a' });
		const p = body.data.promise;
		assert.ok(Number.isInteger(p.timeoutAt), 'timeoutAt');
		assert.ok(Number.isInteger(p.createdAt), 'createdAt');
		assert.ok(Number.isInteger(p.settledAt), 'settledAt');
		assert.equal(p.timeout, undefined, 'old `timeout` must be gone');
		assert.equal(p.createdOn, undefined, 'old `createdOn` must be gone');
		assert.equal(p.completedOn, undefined, 'old `completedOn` must be gone');
	});

	test('param and value are always present, never undefined', async () => {
		// They are no longer Option in the Rust type, so `p.param?.data` is
		// over-defensive but harmless; `p.param.data` is now safe.
		const { body } = await rpc('promise.get', { id: 'sync-inventory-4d2e' });
		const p = body.data.promise;
		assert.equal(typeof p.param, 'object');
		assert.equal(typeof p.value, 'object');
	});

	test('an unsettled promise omits settledAt entirely', async () => {
		// skip_serializing_if = Option::is_none (src/types.rs:222). The key is
		// absent, not null — `'settledAt' in p` is false.
		const { body } = await rpc('promise.get', { id: 'sync-inventory-4d2e' });
		assert.equal('settledAt' in body.data.promise, false);
	});

	test('a missing id is 400, a missing promise is 404', async () => {
		assert.equal((await rpc('promise.get', {})).status, 400);
		assert.equal((await rpc('promise.get', { id: 'ghost' })).status, 404);
	});
});

describe('promise.search', () => {
	test('returns {promises, cursor}', async () => {
		const { body } = await rpc('promise.search', { limit: 5 });
		assert.ok(Array.isArray(body.data.promises));
		assert.equal(body.data.promises.length, 5);
		assert.equal(typeof body.data.cursor, 'string');
	});

	test('defaults to a limit of 100', async () => {
		// server.rs:974
		const { body } = await rpc('promise.search', {});
		assert.equal(body.data.promises.length, DEFAULT_SEARCH_LIMIT);
	});

	test('rejects a limit above 1000', async () => {
		// server.rs:964-972
		const { status, body } = await rpc('promise.search', { limit: 1001 });
		assert.equal(status, 400);
		assert.match(body.data, /between 1 and 1000/);
	});

	test('results are sorted by id ascending', async () => {
		// persistence_sqlite.rs:639. This is the only ordering available —
		// there is no sort parameter, so "most recent first" is not expressible.
		const { body } = await rpc('promise.search', { limit: 50 });
		const ids = body.data.promises.map((p) => p.id);
		assert.deepEqual(ids, [...ids].sort());
	});

	test('the cursor is the last id of the page and pages do not overlap', async () => {
		// server.rs:985-989 + persistence_sqlite.rs:638 (`id > cursor`).
		const first = await rpc('promise.search', { limit: 10 });
		assert.equal(first.body.data.cursor, first.body.data.promises.at(-1).id);
		const second = await rpc('promise.search', { limit: 10, cursor: first.body.data.cursor });
		const firstIds = new Set(first.body.data.promises.map((p) => p.id));
		for (const p of second.body.data.promises) {
			assert.equal(firstIds.has(p.id), false, `${p.id} appeared on both pages`);
		}
	});

	test('the cursor is omitted on the last page', async () => {
		// skip_serializing_if (src/types.rs:673). `cursor === undefined` is the
		// termination signal for the do/while loops in tree.ts.
		const { body } = await rpc('promise.search', { limit: 1000 });
		assert.equal('cursor' in body.data, false);
	});

	test('paging with the cursor eventually terminates and covers everything', async () => {
		const seen = new Set();
		let cursor;
		let pages = 0;
		do {
			const { body } = await rpc('promise.search', { limit: 25, cursor });
			for (const p of body.data.promises) seen.add(p.id);
			cursor = body.data.cursor;
			assert.ok(++pages < 100, 'pagination did not terminate');
		} while (cursor);
		assert.equal(seen.size, handle.store.promises.length);
	});

	test('every state is filterable and comes back snake_case', async () => {
		// src/types.rs:11-20. The UI compares against 'RESOLVED'/'PENDING'
		// today; every one of those comparisons is dead.
		for (const state of PROMISE_STATES) {
			const { body } = await rpc('promise.search', { state, limit: 1000 });
			assert.ok(body.data.promises.length > 0, `no promises seeded in state ${state}`);
			for (const p of body.data.promises) assert.equal(p.state, state);
		}
	});

	test('the state filter is exact — `rejected` excludes canceled and timedout', async () => {
		// persistence_sqlite.rs:634 is `state = ?1`. This is the trap behind a
		// naive "failed" filter: it silently drops two of the three failure modes.
		const { body } = await rpc('promise.search', { state: 'rejected', limit: 1000 });
		const states = new Set(body.data.promises.map((p) => p.state));
		assert.deepEqual([...states], ['rejected']);
	});

	test('an unknown state is a 400, not an empty result', async () => {
		const { status } = await rpc('promise.search', { state: 'REJECTED' });
		assert.equal(status, 400, 'uppercase states must be rejected outright');
	});

	test('tag filtering is an exact-value subset match', async () => {
		// persistence_sqlite.rs:635-637 — every filter pair must be present.
		const { body } = await rpc('promise.search', {
			tags: { 'resonate:origin': 'payout-91bc' },
			limit: 1000
		});
		assert.equal(body.data.promises.length, 4); // root + 3 children
		for (const p of body.data.promises) {
			assert.equal(p.tags['resonate:origin'], 'payout-91bc');
		}
	});

	test('tag values do not glob', async () => {
		// The tag index is exact-match; a `*` is just a character.
		const { body } = await rpc('promise.search', {
			tags: { 'resonate:origin': 'payout-*' },
			limit: 1000
		});
		assert.equal(body.data.promises.length, 0);
	});

	test('there is no id filter — an `id` key is silently ignored', async () => {
		// src/types.rs:382-389 has no `id`. serde ignores unknown fields, so the
		// UI's `id: '*'` wildcard does not error; it just returns everything.
		// That silence is exactly why the search boxes must be removed, not left
		// to "look like they work".
		const withId = await rpc('promise.search', { id: 'checkout-7f3a', limit: 1000 });
		const without = await rpc('promise.search', { limit: 1000 });
		assert.equal(withId.body.data.promises.length, without.body.data.promises.length);
	});

	test('there is no sort parameter — `sortId` is silently ignored', async () => {
		const desc = await rpc('promise.search', { sortId: -1, limit: 10 });
		const plain = await rpc('promise.search', { limit: 10 });
		assert.deepEqual(
			desc.body.data.promises.map((p) => p.id),
			plain.body.data.promises.map((p) => p.id)
		);
	});
});

describe('workflow trees', () => {
	test('a tree is reachable by its resonate:origin tag', async () => {
		// This is the path fetchTreePromises takes (tree.ts:116-121) and it is
		// the only one that still works — the id-prefix fallback needs B3.
		const { body } = await rpc('promise.search', {
			tags: { 'resonate:origin': 'fanout-2b6d' },
			limit: 1000
		});
		assert.equal(body.data.promises.length, 10); // root + 3 branches + 6 leaves
	});

	test('children carry resonate:parent for tree building', async () => {
		const { body } = await rpc('promise.search', {
			tags: { 'resonate:origin': 'fanout-2b6d' },
			limit: 1000
		});
		const child = body.data.promises.find((p) => p.id === 'fanout-2b6d.1.1');
		assert.equal(child.tags['resonate:parent'], 'fanout-2b6d.1');
	});

	test('a failed tree distinguishes its failure mode from a cancelled one', async () => {
		// The reason C1 step 4 insists on surfacing these separately: they are
		// different incidents with different operator responses.
		const timedout = await rpc('promise.get', { id: 'report-nightly-88aa' });
		const canceled = await rpc('promise.get', { id: 'import-legacy-1c5f' });
		assert.equal(timedout.body.data.promise.state, 'rejected_timedout');
		assert.equal(canceled.body.data.promise.state, 'rejected_canceled');
	});

	test('rejection values are base64-encoded JSON', async () => {
		// Both detail routes must decode this; today only workflows/[id] does.
		const { body } = await rpc('promise.get', { id: 'payout-91bc.2' });
		const decoded = JSON.parse(
			Buffer.from(body.data.promise.value.data, 'base64').toString()
		);
		assert.equal(decoded.type, 'BalanceError');
		assert.match(decoded.message, /insufficient balance/);
	});
});

describe('schedules', () => {
	test('schedule.search returns {schedules, cursor}', async () => {
		const { body } = await rpc('schedule.search', {});
		assert.ok(Array.isArray(body.data.schedules));
	});

	test('ScheduleRecord does not match the field names the UI declares', async () => {
		// src/types.rs:239-257. The spec's rename list only covers promises;
		// schedules changed just as much and the UI's Schedule interface —
		// description / lastRunTime / nextRunTime / createdOn — is entirely wrong.
		const { body } = await rpc('schedule.get', { id: 'nightly-report' });
		const s = body.data.schedule;
		for (const field of ['cron', 'promiseId', 'promiseTimeout', 'promiseParam', 'promiseTags', 'createdAt', 'nextRunAt']) {
			assert.ok(field in s, `missing ${field}`);
		}
		for (const gone of ['description', 'lastRunTime', 'nextRunTime', 'createdOn']) {
			assert.equal(s[gone], undefined, `${gone} must not exist`);
		}
	});

	test('a never-run schedule omits lastRunAt', async () => {
		const { body } = await rpc('schedule.get', { id: 'quarterly-truesup' });
		assert.equal('lastRunAt' in body.data.schedule, false);
	});

	test('schedule.search has no state filter', async () => {
		// src/types.rs:654-660 — {tags, limit, cursor} only.
		const filtered = await rpc('schedule.search', { state: 'pending' });
		const plain = await rpc('schedule.search', {});
		assert.equal(
			filtered.body.data.schedules.length,
			plain.body.data.schedules.length
		);
	});
});

describe('auth', () => {
	test('with auth off, no token is required', async () => {
		const { status } = await rpc('promise.search', { limit: 1 });
		assert.equal(status, 200);
	});

	describe('with a token configured', () => {
		let authed;
		let authedUrl;

		before(async () => {
			authed = createMockServer({ token: 'secret-token' });
			await new Promise((r) => authed.server.listen(0, '127.0.0.1', r));
			authedUrl = `http://127.0.0.1:${authed.server.address().port}`;
		});
		after(() => authed.server.close());

		test('a missing token is 401', async () => {
			// auth.rs:120-131
			const { status, body } = await rpc('promise.search', {}, { url: authedUrl });
			assert.equal(status, 401);
			assert.equal(body.data, 'Unauthorized');
		});

		test('a wrong token is 401', async () => {
			const { status } = await rpc('promise.search', {}, { url: authedUrl, auth: 'nope' });
			assert.equal(status, 401);
		});

		test('the token goes in head.auth, not an Authorization header', async () => {
			// auth.rs:120. The header the current client sends is ignored, which
			// is why a "working" token appears to fail after the port.
			const viaHeader = await fetch(authedUrl, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: 'Bearer secret-token'
				},
				body: JSON.stringify({
					kind: 'promise.search',
					head: { corrId: 'h', version: PROTOCOL_VERSION },
					data: {}
				})
			});
			assert.equal(viaHeader.status, 401, 'header auth must not be honoured');

			const viaBody = await rpc('promise.search', {}, { url: authedUrl, auth: 'secret-token' });
			assert.equal(viaBody.status, 200);
		});
	});

	describe('with a scoped (non-admin) prefix', () => {
		let scoped;
		let scopedUrl;

		before(async () => {
			scoped = createMockServer({ token: 't', prefix: 'checkout-' });
			await new Promise((r) => scoped.server.listen(0, '127.0.0.1', r));
			scopedUrl = `http://127.0.0.1:${scoped.server.address().port}`;
		});
		after(() => scoped.server.close());

		test('search is 403 for any non-empty prefix', async () => {
			// auth.rs:301-306 — the search kinds authorise against "", which no
			// non-empty prefix can satisfy. A scoped token cannot drive this UI
			// at all; it needs an admin token. That is the A1 decision, in code.
			const { status, body } = await rpc('promise.search', {}, { url: scopedUrl, auth: 't' });
			assert.equal(status, 403);
			assert.equal(body.data, 'Forbidden');
		});

		test('a get within the prefix is allowed', async () => {
			const { status } = await rpc(
				'promise.get',
				{ id: 'checkout-7f3a' },
				{ url: scopedUrl, auth: 't' }
			);
			assert.equal(status, 200);
		});

		test('a get outside the prefix is 403', async () => {
			const { status } = await rpc(
				'promise.get',
				{ id: 'payout-91bc' },
				{ url: scopedUrl, auth: 't' }
			);
			assert.equal(status, 403);
		});
	});

	describe('jwt mode', () => {
		// Every expectation in this block was confirmed against a live
		// `resonate serve --auth-publickey none` before being written down.
		let jwtServer;
		let jwtUrl;

		const mint = (claims, { alg = 'HS256', exp = 4_102_444_800 } = {}) => {
			const seg = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
			return `${seg({ alg, typ: 'JWT' })}.${seg({ exp, ...claims })}.c2ln`;
		};

		before(async () => {
			jwtServer = createMockServer({ jwt: true });
			await new Promise((r) => jwtServer.server.listen(0, '127.0.0.1', r));
			jwtUrl = `http://127.0.0.1:${jwtServer.server.address().port}`;
		});
		after(() => jwtServer.server.close());

		const as = (token) => rpc('promise.search', { limit: 1 }, { url: jwtUrl, auth: token });

		test('role=admin gets everything', async () => {
			assert.equal((await as(mint({ role: 'admin' }))).status, 200);
		});

		test('an empty prefix is the wildcard', async () => {
			// auth.rs:178-181 — `prefix: ""` short-circuits to allow.
			assert.equal((await as(mint({ prefix: '' }))).status, 200);
		});

		test('a non-empty prefix is 403 on every search', async () => {
			// auth.rs:301-306. This is the single most important auth fact for
			// this UI: a scoped token cannot list anything, so the operator
			// needs an admin token. Settings should say so rather than showing
			// an empty table.
			assert.equal((await as(mint({ prefix: 'checkout-' }))).status, 403);
		});

		test('a token with neither role nor prefix is 403', async () => {
			// auth.rs:157-166 — an absent prefix claim is always forbidden.
			assert.equal((await as(mint({}))).status, 403);
		});

		test('a missing exp claim is 401, not 403', async () => {
			// auth.rs:274-275, 289 — exp is in required_spec_claims, so this
			// fails verification rather than authorisation. Easy to misread as
			// a permissions problem when it is a token-minting problem.
			const noExp = (() => {
				const seg = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
				return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg({ role: 'admin' })}.c2ln`;
			})();
			assert.equal((await as(noExp)).status, 401);
		});

		test('an expired token is 401', async () => {
			assert.equal((await as(mint({ role: 'admin' }, { exp: 1_000_000_000 }))).status, 401);
		});

		test('a malformed token is 401', async () => {
			assert.equal((await as('not-a-jwt')).status, 401);
		});

		test('prefix scoping applies to gets', async () => {
			const token = mint({ prefix: 'checkout-' });
			const inside = await rpc('promise.get', { id: 'checkout-7f3a' }, { url: jwtUrl, auth: token });
			const outside = await rpc('promise.get', { id: 'payout-91bc' }, { url: jwtUrl, auth: token });
			assert.equal(inside.status, 200);
			assert.equal(outside.status, 403);
		});
	});
});

describe('cors', () => {
	const corsPost = (origin) =>
		fetch(baseUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin },
			body: JSON.stringify({
				kind: 'promise.search',
				head: { corrId: 'c', version: PROTOCOL_VERSION },
				data: { limit: 1 }
			})
		});

	const preflight = (origin, url = baseUrl) =>
		fetch(url, {
			method: 'OPTIONS',
			headers: {
				origin,
				'access-control-request-method': 'POST',
				'access-control-request-headers': 'content-type'
			}
		});

	test('an allowed origin gets allow-origin on the POST', async () => {
		const res = await corsPost('http://localhost:5173');
		assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
	});

	test('allow-methods and allow-headers are preflight-only', async () => {
		// Verified against a live v0.9.8 binary: tower-http emits these on the
		// OPTIONS response only. Asserting them on the POST is how this fixture
		// and the real server first diverged.
		const res = await corsPost('http://localhost:5173');
		assert.equal(res.headers.get('access-control-allow-methods'), null);
		assert.equal(res.headers.get('access-control-allow-headers'), null);
	});

	test('the preflight answers 200 and permits POST + content-type', async () => {
		// main.rs:451-462. Every call this UI makes is preflighted, because
		// `content-type: application/json` is not a CORS-safelisted value.
		const res = await preflight('http://localhost:5173');
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
		assert.match(res.headers.get('access-control-allow-methods'), /POST/);
		assert.match(res.headers.get('access-control-allow-headers'), /content-type/);
	});

	test('a denied preflight is still 200 — only allow-origin is withheld', async () => {
		// So a test-connection button cannot probe CORS by status code. The
		// absence of allow-origin is the signal, and in a browser it surfaces
		// as an opaque failure with no status at all.
		const res = await preflight('http://evil.example');
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('access-control-allow-origin'), null);
		assert.match(res.headers.get('access-control-allow-methods'), /POST/);
	});

	test('permissive mode ("*") behaves differently from an explicit origin', async () => {
		// main.rs:445-447 swaps in CorsLayer::permissive(), which mirrors any
		// origin, answers `*` for methods and headers, and adds expose-headers.
		const star = createMockServer({ cors: ['*'] });
		await new Promise((r) => star.server.listen(0, '127.0.0.1', r));
		const url = `http://127.0.0.1:${star.server.address().port}`;

		const pre = await preflight('http://anything.example', url);
		assert.equal(pre.headers.get('access-control-allow-origin'), '*');
		assert.equal(pre.headers.get('access-control-allow-methods'), '*');
		assert.equal(pre.headers.get('access-control-allow-headers'), '*');

		const post = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'http://anything.example' },
			body: JSON.stringify({
				kind: 'promise.search',
				head: { corrId: 'c', version: PROTOCOL_VERSION },
				data: { limit: 1 }
			})
		});
		assert.equal(post.headers.get('access-control-allow-origin'), '*');
		assert.equal(post.headers.get('access-control-expose-headers'), '*');
		star.server.close();
	});

	test('an unlisted origin gets no header', async () => {
		const res = await fetch(baseUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
			body: JSON.stringify({
				kind: 'promise.search',
				head: { corrId: 'c', version: PROTOCOL_VERSION },
				data: { limit: 1 }
			})
		});
		assert.equal(res.headers.get('access-control-allow-origin'), null);
	});

	test('with CORS unconfigured no header is sent at all', async () => {
		// The real server's default. In a browser this surfaces as an opaque
		// network failure with no status — which is why the UI's error taxonomy
		// needs a dedicated branch naming --server-cors-allow-origin.
		const bare = createMockServer({});
		await new Promise((r) => bare.server.listen(0, '127.0.0.1', r));
		const url = `http://127.0.0.1:${bare.server.address().port}`;
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
			body: JSON.stringify({
				kind: 'promise.search',
				head: { corrId: 'c', version: PROTOCOL_VERSION },
				data: { limit: 1 }
			})
		});
		assert.equal(res.headers.get('access-control-allow-origin'), null);
		assert.equal(res.status, 200, 'the request still succeeds outside a browser');
		bare.server.close();
	});
});

describe('health', () => {
	test('/health and /ready are plain GETs', async () => {
		// server.rs:102-104 — the only non-POST endpoints, and therefore the
		// only thing a test-connection button can probe without a valid token.
		for (const path of ['/health', '/ready']) {
			const res = await fetch(`${baseUrl}${path}`);
			assert.equal(res.status, 200);
		}
	});
});
