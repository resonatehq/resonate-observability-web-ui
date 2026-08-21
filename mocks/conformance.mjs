#!/usr/bin/env node
/**
 * Differential conformance harness.
 *
 * Runs an identical battery of protocol probes against any envelope-speaking
 * server and prints a JSON report. Point it at the mock and at a real
 * `resonate serve`, diff the two reports, and any divergence is a place the
 * fixture lies — which is the only thing that makes the fixture worth having.
 *
 *   node mocks/conformance.mjs http://127.0.0.1:8098 > real.json
 *   node mocks/conformance.mjs --mock                > mock.json
 *   diff real.json mock.json
 *
 * Probes are written to be seed-independent: the harness creates the handful
 * of promises it needs under a `conformance-` id prefix before probing, so the
 * same battery is meaningful against an empty production binary.
 */

import { createMockServer } from './server.mjs';
import { PROTOCOL_VERSION } from './protocol.mjs';

let counter = 0;

async function post(url, body, headers = {}) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { unparseable: text };
	}
	return { status: res.status, body: json, headers: res.headers };
}

const rpc = (url, kind, data, opts = {}) =>
	post(url, {
		kind,
		head: {
			corrId: opts.corrId ?? `conf-${++counter}`,
			version: opts.version ?? PROTOCOL_VERSION,
			...(opts.auth !== undefined ? { auth: opts.auth } : {})
		},
		data
	});

const TIMEOUT_AT = 4_102_444_800_000; // 2100-01-01, so nothing times out mid-run
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64');

/**
 * Seeds the minimum set of promises the probes need. Idempotent: promise.create
 * is idempotent on id in the server, and re-running against a dirty database is
 * the normal case when probing a long-lived dev server.
 */
async function seed(url) {
	const root = 'conformance-root';
	await rpc(url, 'promise.create', {
		id: root,
		timeoutAt: TIMEOUT_AT,
		param: { headers: { 'content-type': 'application/json' }, data: b64({ func: 'probe' }) },
		tags: { 'resonate:origin': root, probe: 'yes' }
	});
	for (let i = 1; i <= 3; i++) {
		await rpc(url, 'promise.create', {
			id: `${root}.${i}`,
			timeoutAt: TIMEOUT_AT,
			param: { data: b64({ func: `child_${i}` }) },
			tags: { 'resonate:origin': root, 'resonate:parent': root, probe: 'yes' }
		});
	}
	// One settled promise, so settledAt has a value somewhere.
	await rpc(url, 'promise.create', { id: `${root}.1.settled`, timeoutAt: TIMEOUT_AT, tags: { probe: 'yes' } });
	await rpc(url, 'promise.settle', {
		id: `${root}.1.settled`,
		state: 'resolved',
		value: { data: b64({ ok: true }) }
	});
	return root;
}

/** Reduces a response to the shape-level facts worth comparing across servers. */
const shape = (v) => {
	if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${shape(v[0])} x${v.length}]`;
	if (v === null) return 'null';
	if (typeof v === 'object') {
		return `{${Object.keys(v).sort().join(',')}}`;
	}
	return typeof v;
};

export async function runProbes(url) {
	const results = {};
	const record = (name, value) => {
		results[name] = value;
	};

	const root = await seed(url);

	// ── envelope validation ──────────────────────────────────────────────────
	{
		const r = await rpc(url, 'promise.search', { limit: 1 }, { corrId: 'echo-me' });
		record('echo.corrId', r.body.head?.corrId);
		record('echo.kind', r.body.kind);
		record('echo.version', r.body.head?.version);
		record('echo.httpMatchesHeadStatus', r.status === r.body.head?.status);
	}
	{
		const r = await rpc(url, 'promise.search', {}, { version: '2025-01-01' });
		record('badVersion.status', r.status);
		record('badVersion.message', r.body.data);
	}
	{
		const r = await rpc(url, 'not.a.real.kind', {}, { version: '1999-01-01' });
		record('versionBeforeKind.message', r.body.data);
	}
	{
		const r = await rpc(url, '', {});
		record('emptyKind.status', r.status);
		record('emptyKind.message', r.body.data);
	}
	{
		const r = await post(url, {
			kind: 'promise.search',
			head: { corrId: 'arr', version: PROTOCOL_VERSION },
			data: []
		});
		record('arrayData.status', r.status);
		record('arrayData.message', r.body.data);
	}
	{
		const r = await post(url, '{not json');
		record('badJson.status', r.status);
		record('badJson.corrId', r.body.head?.corrId);
	}
	{
		const r = await rpc(url, 'promise.frobnicate', {});
		record('unknownKind.status', r.status);
		record('unknownKind.message', r.body.data);
	}

	// ── promise.get ──────────────────────────────────────────────────────────
	{
		const r = await rpc(url, 'promise.get', { id: `${root}.1` });
		record('get.status', r.status);
		record('get.dataShape', shape(r.body.data));
		record('get.promiseKeys', Object.keys(r.body.data?.promise ?? {}).sort().join(','));
		record('get.stateValue', r.body.data?.promise?.state);
		record('get.settledAtAbsentWhenPending', !('settledAt' in (r.body.data?.promise ?? {})));
	}
	{
		const r = await rpc(url, 'promise.get', { id: `${root}.1.settled` });
		record('getSettled.state', r.body.data?.promise?.state);
		record('getSettled.hasSettledAt', 'settledAt' in (r.body.data?.promise ?? {}));
	}
	{
		const r = await rpc(url, 'promise.get', { id: 'conformance-definitely-absent' });
		record('getMissing.status', r.status);
		record('getMissing.message', r.body.data);
		record('getMissing.dataIsString', typeof r.body.data === 'string');
	}
	{
		const r = await rpc(url, 'promise.get', {});
		record('getNoId.status', r.status);
	}

	// ── promise.search ───────────────────────────────────────────────────────
	{
		const r = await rpc(url, 'promise.search', { limit: 1001 });
		record('limitTooHigh.status', r.status);
		record('limitTooHigh.message', r.body.data);
	}
	{
		const r = await rpc(url, 'promise.search', { limit: 0 });
		record('limitZero.status', r.status);
	}
	{
		const r = await rpc(url, 'promise.search', { state: 'REJECTED' });
		record('uppercaseState.status', r.status);
	}
	for (const state of ['pending', 'resolved', 'rejected', 'rejected_canceled', 'rejected_timedout']) {
		const r = await rpc(url, 'promise.search', { state, limit: 1 });
		record(`state.${state}.accepted`, r.status === 200);
	}
	{
		const r = await rpc(url, 'promise.search', { tags: { probe: 'yes' }, limit: 2 });
		record('search.dataShape', shape(r.body.data));
		record('search.honoursLimit', r.body.data?.promises?.length === 2);
		record('search.cursorIsLastId', r.body.data?.cursor === r.body.data?.promises?.at(-1)?.id);
	}
	{
		const r = await rpc(url, 'promise.search', { tags: { probe: 'yes' }, limit: 1000 });
		record('search.cursorOmittedOnLastPage', !('cursor' in (r.body.data ?? {})));
		const ids = r.body.data?.promises?.map((p) => p.id) ?? [];
		record('search.sortedByIdAsc', JSON.stringify(ids) === JSON.stringify([...ids].sort()));
	}
	{
		// Two pages must not overlap — `id > cursor`, not `id >= cursor`.
		const a = await rpc(url, 'promise.search', { tags: { probe: 'yes' }, limit: 2 });
		const b = await rpc(url, 'promise.search', {
			tags: { probe: 'yes' },
			limit: 2,
			cursor: a.body.data?.cursor
		});
		const first = new Set(a.body.data?.promises?.map((p) => p.id) ?? []);
		const overlap = (b.body.data?.promises ?? []).some((p) => first.has(p.id));
		record('search.pagesDoNotOverlap', !overlap);
	}
	{
		const withId = await rpc(url, 'promise.search', { id: root, tags: { probe: 'yes' }, limit: 1000 });
		const without = await rpc(url, 'promise.search', { tags: { probe: 'yes' }, limit: 1000 });
		record(
			'search.idFilterIgnored',
			withId.body.data?.promises?.length === without.body.data?.promises?.length
		);
		record('search.idFilterStatus', withId.status);
	}
	{
		const desc = await rpc(url, 'promise.search', { sortId: -1, tags: { probe: 'yes' }, limit: 5 });
		const plain = await rpc(url, 'promise.search', { tags: { probe: 'yes' }, limit: 5 });
		record(
			'search.sortIdIgnored',
			JSON.stringify(desc.body.data?.promises?.map((p) => p.id)) ===
				JSON.stringify(plain.body.data?.promises?.map((p) => p.id))
		);
	}
	{
		const r = await rpc(url, 'promise.search', { tags: { probe: 'y*' }, limit: 1000 });
		record('search.tagsDoNotGlob', r.body.data?.promises?.length === 0);
	}
	{
		const r = await rpc(url, 'promise.search', { tags: { 'resonate:origin': root }, limit: 1000 });
		record('search.originTagFindsTree', r.body.data?.promises?.length >= 4);
	}

	// ── schedules ────────────────────────────────────────────────────────────
	{
		await rpc(url, 'schedule.create', {
			id: 'conformance-schedule',
			cron: '0 2 * * *',
			promiseId: 'conformance-sched-{{.timestamp}}',
			promiseTimeout: 3_600_000,
			promiseParam: { data: b64({ func: 'probe' }) },
			promiseTags: { probe: 'yes' }
		});
		const r = await rpc(url, 'schedule.get', { id: 'conformance-schedule' });
		record('schedule.status', r.status);
		record('schedule.keys', Object.keys(r.body.data?.schedule ?? {}).sort().join(','));
		const s = await rpc(url, 'schedule.search', { limit: 10 });
		record('scheduleSearch.dataShape', shape(s.body.data));
	}

	// ── health ───────────────────────────────────────────────────────────────
	for (const path of ['/health', '/ready']) {
		const res = await fetch(new URL(path, url));
		record(`health${path}`, res.status);
	}

	// ── legacy REST ──────────────────────────────────────────────────────────
	for (const path of ['/promises', '/promises/x', '/schedules', '/tasks']) {
		const res = await fetch(new URL(path, url));
		record(`legacy${path}`, res.status);
	}

	// ── cors ─────────────────────────────────────────────────────────────────
	{
		const r = await post(
			url,
			{ kind: 'promise.search', head: { corrId: 'cors', version: PROTOCOL_VERSION }, data: { limit: 1 } },
			{ origin: 'http://localhost:5173' }
		);
		record('cors.post.allowOrigin', r.headers.get('access-control-allow-origin'));
		// These are preflight-only on the real server; asserting them on the
		// POST response is how the fixture and the server first diverged.
		record('cors.post.allowMethods', r.headers.get('access-control-allow-methods'));
		record('cors.post.allowHeaders', r.headers.get('access-control-allow-headers'));
	}
	{
		// The preflight the browser actually sends. `content-type:
		// application/json` is not CORS-safelisted, so every call preflights.
		const preflight = async (origin) =>
			fetch(url, {
				method: 'OPTIONS',
				headers: {
					origin,
					'access-control-request-method': 'POST',
					'access-control-request-headers': 'content-type'
				}
			});
		const ok = await preflight('http://localhost:5173');
		record('cors.preflight.status', ok.status);
		record('cors.preflight.allowOrigin', ok.headers.get('access-control-allow-origin'));
		record('cors.preflight.allowMethods', ok.headers.get('access-control-allow-methods'));
		record('cors.preflight.allowHeaders', ok.headers.get('access-control-allow-headers'));

		const denied = await preflight('http://evil.example');
		// Still 200, still carries methods/headers — only allow-origin is
		// withheld. Status alone is not a usable CORS probe.
		record('cors.preflightDenied.status', denied.status);
		record('cors.preflightDenied.allowOrigin', denied.headers.get('access-control-allow-origin'));
		record('cors.preflightDenied.allowMethods', denied.headers.get('access-control-allow-methods'));
	}

	return results;
}

const target = process.argv[2];

if (target === '--mock' || target === '--mock-permissive') {
	const handle = createMockServer({
		cors: target === '--mock-permissive' ? ['*'] : ['http://localhost:5173']
	});
	await new Promise((r) => handle.server.listen(0, '127.0.0.1', r));
	const url = `http://127.0.0.1:${handle.server.address().port}`;
	const results = await runProbes(url);
	console.log(JSON.stringify(results, null, 2));
	handle.server.close();
} else if (target) {
	console.log(JSON.stringify(await runProbes(target), null, 2));
} else {
	console.error('usage: node mocks/conformance.mjs <url> | --mock');
	process.exit(1);
}
