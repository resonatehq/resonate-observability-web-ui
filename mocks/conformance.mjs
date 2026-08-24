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
import { nextFireTimes } from '../src/lib/utils/cron.js';
import { scheduleCreatePayload, isDuplicateEcho } from '../src/lib/api/duplicate.js';

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

/**
 * `JSON.stringify` with keys sorted, for probes that compare a payload the
 * server echoed back.
 *
 * A real 0.9.8 echoes `{headers, data}` as `{data, headers}` and the mock
 * echoes it in the order it arrived. That is a true difference between the two
 * and a meaningless one — the UI's comparison is key-order-insensitive
 * precisely because of it — so recording the raw string would put a permanent
 * benign line in every real-vs-mock diff, which is the fastest way to teach
 * someone to stop reading diffs. Content still compares; ordering does not.
 */
function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const entries = Object.keys(value)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
	return `{${entries.join(',')}}`;
}

/**
 * The cron corpus, one entry per way the UI parser and the server have been
 * caught disagreeing about what is legal. Verified expression by expression
 * against a live 0.9.8 on 2026-08-24.
 *
 * Coarse expressions only, and the reason is operational rather than numerical:
 * an accepted schedule starts FIRING on a real server, so a `* * * * *` in here
 * would have every probe run leave a once-a-minute promise factory behind. The
 * block below deletes what it creates, but only what it can see — a probe that
 * fires between the create and the delete has already made promises. At daily
 * granularity nothing fires inside a run. (`0 0 30 2 *` is the exception that
 * proves it: it is here BECAUSE the server accepts it and then fires it every
 * 60 seconds, which is exactly what makes deleting it afterwards necessary.)
 */
const CRON_PROBES = [
	'0 0 * * WED-FRI', // a named range with W inside an endpoint
	'0 0 1 JAN-JUL *', // ...and with L inside one
	'0 0 * * MON/2', // a step after a bare name: rejected
	'0 0 * * MON-SAT/2', // a step after a named range: accepted
	'0 0 * * 2/2', // a step after a number: accepted
	'0 0 * * WED-6', // a range that mixes the two spellings: rejected
	'0 0 * * SAT-SUN', // a descending range: rejected
	'0 0 * * L', // the operators this dialect genuinely lacks
	'0 0 15W * *',
	'0 0 * * 6#3',
	'? * * * *', // `?` outside the two day fields: rejected
	'0 0 ? * ?', // ...and in both of them at once: accepted
	'0 0 30 2 *', // accepted, then fires every 60 seconds forever
	'0 0 29 2 *', // fires, decades out
	'0 0 * * 0', // 0 is not Sunday in this dialect
	'0 2 * * *' // the happy path
];
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

	// ── schedule cron validation ─────────────────────────────────────────────
	//
	// The block above creates one valid schedule and compares shapes, which is
	// blind to the class of bug that actually bites here: the fixture and the
	// server disagreeing about which expressions are legal, and a nextRunAt
	// that is wildly wrong but the right TYPE. `shape()` reduces a number to
	// "number", so it can see neither. These probes take the failure paths and
	// compare the fire time by VALUE.
	{
		// A fresh id per run: `schedule.create` on an existing id returns 200
		// with the OLD record, whose nextRunAt may long since have passed —
		// which would read as a conformance failure and be a dirty database.
		const stamp = Date.now().toString(36);
		/** @type {string[]} */
		const created = [];
		let n = 0;
		for (const expr of CRON_PROBES) {
			n += 1;
			const id = `conformance-cron-${stamp}-${n}`;
			const r = await rpc(url, 'schedule.create', {
				id,
				cron: expr,
				promiseId: `${id}-{{.timestamp}}`,
				promiseTimeout: 3_600_000,
				promiseParam: {},
				promiseTags: { probe: 'yes' }
			});

			if (r.status >= 400) {
				record(`cron[${expr}]`, `rejected ${r.status}`);
				continue;
			}

			// Projected from the record's own createdAt, not from this process's
			// clock: the mock runs a deterministic clock that is nowhere near
			// wall time, and a real server's is its own. Both report the instant
			// they computed nextRunAt from, so the comparison needs no clock.
			created.push(id);
			const sched = r.body.data?.schedule;
			const next = sched?.nextRunAt ?? null;
			const from = sched?.createdAt ?? null;
			const preview = from === null ? null : nextFireTimes(expr, from, 1);
			let verdict;
			if (next === null || from === null) verdict = 'accepted, no nextRunAt';
			else if (preview.ok && preview.times[0] === next) verdict = 'accepted, preview exact';
			else if (next - from === 60_000) verdict = 'accepted, 60s fallback';
			else if (!preview.ok) verdict = 'accepted, but the UI draws no preview';
			else verdict = `accepted, preview off by ${next - preview.times[0]}ms`;
			record(`cron[${expr}]`, verdict);
		}

		// Delete every schedule this block created. Without it the harness is a
		// slow leak on any long-lived server it is pointed at: 16 schedules per
		// run, one of which (`0 0 30 2 *`) fires every 60 seconds forever and
		// mints a `probe: yes` promise each time. Both counts feed probes that
		// are recorded above — `scheduleSearch.dataShape` grows a `cursor` key
		// past 10 schedules, `search.cursorOmittedOnLastPage` flips past 1000
		// promises — so an uncleaned run makes the NEXT run diff against a fresh
		// mock for reasons that have nothing to do with the fixture.
		//
		// Deliberately not recorded: `schedule.delete` on an id that was never
		// created answers 404, and the rejected expressions above created none.
		for (const id of created) await rpc(url, 'schedule.delete', { id });
	}

	// ── schedule.create echo fidelity ────────────────────────────────────────
	//
	// Duplicate detection reports "that id already exists — nothing was created"
	// by comparing the returned record against the submitted one, so it rests
	// entirely on the server echoing a SUCCESSFUL create back unchanged. If a
	// server ever normalises an echoed field — adds `headers: {}`, drops an
	// empty `data`, stringifies the timeout — every genuine create starts being
	// reported to the operator as a duplicate. That is the failure this block
	// exists to catch, and it cannot be caught by `shape()`: normalisation
	// preserves the type and changes the value.
	//
	// These call the shipped `isDuplicateEcho` rather than reimplementing the
	// comparison, so what is probed here is what the UI actually runs.
	{
		const stamp = Date.now().toString(36);
		const id = `conformance-echo-${stamp}`;

		const sent = scheduleCreatePayload({
			id,
			cron: '0 2 1 1 *',
			promiseId: `${id}-{{.timestamp}}`,
			promiseTimeout: 3_600_000,
			promiseParam: { headers: { 'x-probe': 'echo' }, data: b64({ func: 'probe' }) },
			promiseTags: { probe: 'yes' }
		});
		const r = await rpc(url, 'schedule.create', sent);
		const echoed = r.body.data?.schedule;

		record('createEcho.status', r.status);
		record('createEcho.param', canonicalJson(echoed?.promiseParam ?? null));
		record('createEcho.tags', canonicalJson(echoed?.promiseTags ?? null));
		record('createEcho.timeoutType', typeof echoed?.promiseTimeout);
		// The one that matters: a fresh create must never read as a duplicate.
		record('createEcho.freshReadsAsDuplicate', echoed ? isDuplicateEcho(sent, echoed) : null);

		// An omitted param and an omitted tag map are the form's default, and
		// `{}` is the shape most likely to be normalised into something else.
		const bareId = `conformance-echo-bare-${stamp}`;
		const bare = scheduleCreatePayload({
			id: bareId,
			cron: '0 2 1 1 *',
			promiseId: `${bareId}-{{.timestamp}}`,
			promiseTimeout: 3_600_000
		});
		const rb = await rpc(url, 'schedule.create', bare);
		const bareEcho = rb.body.data?.schedule;
		record('createEcho.bareParam', canonicalJson(bareEcho?.promiseParam ?? null));
		record('createEcho.bareTags', canonicalJson(bareEcho?.promiseTags ?? null));
		record('createEcho.bareReadsAsDuplicate', bareEcho ? isDuplicateEcho(bare, bareEcho) : null);

		// And the case detection exists for: the same id resubmitted with a
		// different cron answers 200 with the ORIGINAL record.
		const resubmit = scheduleCreatePayload({ ...sent, cron: '0 3 1 1 *' });
		const rr = await rpc(url, 'schedule.create', resubmit);
		const resubmitEcho = rr.body.data?.schedule;
		record('createEcho.duplicateStatus', rr.status);
		record('createEcho.duplicateKeepsOriginalCron', resubmitEcho?.cron === sent.cron);
		record(
			'createEcho.duplicateDetected',
			resubmitEcho ? isDuplicateEcho(resubmit, resubmitEcho) : null
		);

		for (const created of [id, bareId]) await rpc(url, 'schedule.delete', { id: created });
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
