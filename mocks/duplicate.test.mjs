/**
 * Tests for `schedule.create` duplicate detection — `src/lib/api/duplicate.js`.
 *
 * This logic had zero coverage while being the most novel thing in the schedule
 * diff, and its risk is asymmetric: a false negative lets the UI report success
 * for a schedule somebody else owns, and a false positive tells an operator
 * their real, just-created schedule "already exists — nothing was created",
 * which is the same lie from the other side.
 *
 * The echo shapes in "what a live 0.9.8 actually returns" below are not
 * invented. They are recorded verbatim from four creates against
 * `resonate serve --storage-type sqlite` on 2026-08-24, and one of them —
 * `{headers, data}` echoed back as `{data, headers}` — is the reason the
 * comparison cannot be a `JSON.stringify` of each side.
 *
 * Run: npm test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from './server.mjs';
import { PROTOCOL_VERSION } from './protocol.mjs';
import {
	scheduleCreatePayload,
	isDuplicateEcho,
	sameJson
} from '../src/lib/api/duplicate.js';

/** A create as the form submits one, with every optional field supplied. */
const FULL_PARAMS = {
	id: 'nightly-report',
	cron: '0 3 * * *',
	promiseId: 'nightly-report-{{.timestamp}}',
	promiseTimeout: 60000,
	promiseParam: { data: 'eyJhIjoxfQ==' },
	promiseTags: { 'resonate:target': 'poll://any@default' }
};

/** The record a server returns for a successful create of FULL_PARAMS. */
const freshEcho = (overrides = {}) => ({
	id: FULL_PARAMS.id,
	cron: FULL_PARAMS.cron,
	promiseId: FULL_PARAMS.promiseId,
	promiseTimeout: FULL_PARAMS.promiseTimeout,
	promiseParam: { data: 'eyJhIjoxfQ==' },
	promiseTags: { 'resonate:target': 'poll://any@default' },
	createdAt: 1787607114215,
	nextRunAt: 1798761600000,
	...overrides
});

describe('scheduleCreatePayload', () => {
	test('defaults the two optional fields to empty objects', () => {
		const payload = scheduleCreatePayload({
			id: 'a',
			cron: '0 0 * * *',
			promiseId: 'p',
			promiseTimeout: 1000
		});
		assert.deepEqual(payload.promiseParam, {});
		assert.deepEqual(payload.promiseTags, {});
	});

	test('carries all six fields through unchanged', () => {
		assert.deepEqual(scheduleCreatePayload(FULL_PARAMS), FULL_PARAMS);
	});

	/**
	 * The reason the payload is built rather than inlined: the defaults applied
	 * on the way out are the same object compared on the way back, so they
	 * cannot drift. If a future edit defaults `promiseParam` to `null` on one
	 * side only, this fails.
	 */
	test('the payload it builds is what a matching echo is judged against', () => {
		const params = { id: 'a', cron: '0 0 * * *', promiseId: 'p', promiseTimeout: 1000 };
		const sent = scheduleCreatePayload(params);
		const echoed = { ...sent, createdAt: 1, nextRunAt: 2 };
		assert.equal(isDuplicateEcho(sent, echoed), false);
	});
});

describe('isDuplicateEcho — a faithful echo is not a duplicate', () => {
	test('the record the server returns for a fresh create', () => {
		assert.equal(isDuplicateEcho(scheduleCreatePayload(FULL_PARAMS), freshEcho()), false);
	});

	test('extra server-assigned fields do not count against it', () => {
		const echo = freshEcho({ lastRunAt: 1787607200000 });
		assert.equal(isDuplicateEcho(scheduleCreatePayload(FULL_PARAMS), echo), false);
	});
});

describe('isDuplicateEcho — each submitted field on its own proves the create was discarded', () => {
	// One case per field. Dropping any single comparison from the
	// implementation fails exactly one of these, which is the point: the
	// earlier version compared two of the five and looked fine.
	const divergences = {
		cron: { cron: '0 4 * * *' },
		promiseId: { promiseId: 'someone-elses-{{.timestamp}}' },
		promiseTimeout: { promiseTimeout: 30000 },
		promiseParam: { promiseParam: { data: 'eyJhIjoyfQ==' } },
		promiseTags: { promiseTags: { 'resonate:target': 'poll://any@other' } }
	};

	for (const [field, override] of Object.entries(divergences)) {
		test(`a different ${field} means the id already existed`, () => {
			const echo = freshEcho(override);
			assert.equal(isDuplicateEcho(scheduleCreatePayload(FULL_PARAMS), echo), true);
		});
	}

	test('a param the operator did not send at all is caught', () => {
		const params = { ...FULL_PARAMS, promiseParam: undefined };
		const echo = freshEcho({ promiseParam: { data: 'eyJhIjoxfQ==' } });
		assert.equal(isDuplicateEcho(scheduleCreatePayload(params), echo), true);
	});

	/**
	 * The one case this cannot see, stated as a test so nobody later reports it
	 * as a bug: an identical resubmission is indistinguishable from a create.
	 */
	test('an identical resubmission is undetectable, by design', () => {
		assert.equal(isDuplicateEcho(scheduleCreatePayload(FULL_PARAMS), freshEcho()), false);
	});
});

describe('what a live 0.9.8 actually returns — recorded 2026-08-24, sqlite', () => {
	// If any of these fail against a newer server, duplicate detection is
	// reporting real creates as duplicates and this is where you find out.

	test('an empty param is echoed as {} — no headers added, no empty data added', () => {
		const sent = scheduleCreatePayload({
			id: 'echo-probe',
			cron: '0 0 1 1 *',
			promiseId: 'echo-probe-{{.timestamp}}',
			promiseTimeout: 60000
		});
		const echoed = { ...sent, promiseParam: {}, promiseTags: {} };
		assert.equal(isDuplicateEcho(sent, echoed), false);
	});

	test('promiseTimeout comes back a number, not a string', () => {
		const sent = scheduleCreatePayload(FULL_PARAMS);
		assert.equal(isDuplicateEcho(sent, freshEcho({ promiseTimeout: '60000' })), true);
	});

	/**
	 * Sent `{headers, data}`, echoed `{data, headers}`. A `JSON.stringify`
	 * comparison — the obvious implementation — reports this as a duplicate and
	 * tells the operator their new schedule already exists.
	 */
	test('the server reorders param keys, and that is not a difference', () => {
		const sent = scheduleCreatePayload({
			...FULL_PARAMS,
			promiseParam: { headers: { 'x-source': 'ui' }, data: 'e30=' }
		});
		const echoed = freshEcho({ promiseParam: { data: 'e30=', headers: { 'x-source': 'ui' } } });
		assert.notEqual(
			JSON.stringify(sent.promiseParam),
			JSON.stringify(echoed.promiseParam),
			'fixture is stale: these must differ by key order or the test proves nothing'
		);
		assert.equal(isDuplicateEcho(sent, echoed), false);
	});
});

describe('sameJson', () => {
	test('key order is not a difference', () => {
		assert.equal(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
	});

	test('nested key order is not a difference either', () => {
		assert.equal(sameJson({ h: { a: 1, b: 2 } }, { h: { b: 2, a: 1 } }), true);
	});

	test('a missing key is a difference in both directions', () => {
		assert.equal(sameJson({ a: 1, b: 2 }, { a: 1 }), false);
		assert.equal(sameJson({ a: 1 }, { a: 1, b: 2 }), false);
	});

	/**
	 * Equal key counts with different key names — the case a length check alone
	 * would wave through.
	 */
	test('same number of keys, different names, is a difference', () => {
		assert.equal(sameJson({ a: 1 }, { b: 1 }), false);
	});

	test('a key present but undefined is not the same as absent', () => {
		assert.equal(sameJson({ a: undefined }, {}), false);
	});

	/**
	 * Both sides hold one undefined value under a different name. Comparing
	 * `left[k]` to `right[k]` without first asking whether the key exists reads
	 * `undefined === undefined` and calls them equal.
	 */
	test('differently-named keys holding undefined are still a difference', () => {
		assert.equal(sameJson({ a: undefined }, { b: undefined }), false);
	});

	/**
	 * A string is indexable and has keys, so an object of single characters
	 * matches one key-for-key unless the types are compared first.
	 */
	test('an object is never equal to a string with the same indices', () => {
		assert.equal(sameJson({ 0: 'a', 1: 'b' }, 'ab'), false);
		assert.equal(sameJson('ab', { 0: 'a', 1: 'b' }), false);
	});

	test('arrays compare element-wise and by length', () => {
		assert.equal(sameJson([1, 2], [1, 2]), true);
		assert.equal(sameJson([1, 2], [2, 1]), false);
		assert.equal(sameJson([1], [1, 2]), false);
	});

	test('an array and an object are never the same', () => {
		assert.equal(sameJson([], {}), false);
		assert.equal(sameJson({}, []), false);
		assert.equal(sameJson({ 0: 'a' }, ['a']), false);
	});

	test('null is handled without throwing, and is not an empty object', () => {
		assert.equal(sameJson(null, null), true);
		assert.equal(sameJson(null, {}), false);
		assert.equal(sameJson({}, null), false);
	});

	test('primitives compare by value and by type', () => {
		assert.equal(sameJson('a', 'a'), true);
		assert.equal(sameJson(1, '1'), false);
		assert.equal(sameJson(0, false), false);
		assert.equal(sameJson(undefined, undefined), true);
	});
});

/**
 * The unit tests above assert against a hand-written echo. This one asserts the
 * premise underneath them: that a server really does answer a duplicate id with
 * 200 and the original record, so that detection has something to detect.
 */
describe('against the fixture, over HTTP', () => {
	let baseUrl;
	let handle;
	let corrCounter = 0;

	before(async () => {
		handle = createMockServer({});
		await new Promise((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${handle.server.address().port}`;
	});

	after(() => handle.server.close());

	async function create(payload) {
		const res = await fetch(baseUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				kind: 'schedule.create',
				head: { corrId: `dup-${++corrCounter}`, version: PROTOCOL_VERSION },
				data: payload
			})
		});
		const body = await res.json();
		return { status: res.status, schedule: body?.data?.schedule };
	}

	test('a fresh create is not reported as a duplicate', async () => {
		const sent = scheduleCreatePayload({
			id: 'dup-test-fresh',
			cron: '0 3 * * *',
			promiseId: 'dup-test-fresh-{{.timestamp}}',
			promiseTimeout: 60000,
			promiseTags: { 'resonate:target': 'poll://any@default' }
		});
		const { status, schedule } = await create(sent);
		assert.equal(status, 200);
		assert.equal(isDuplicateEcho(sent, schedule), false);
	});

	test('resubmitting the id with a changed cron is 200, and is caught', async () => {
		const first = scheduleCreatePayload({
			id: 'dup-test-collide',
			cron: '0 3 * * *',
			promiseId: 'mine-{{.timestamp}}',
			promiseTimeout: 60000
		});
		await create(first);

		const second = scheduleCreatePayload({
			id: 'dup-test-collide',
			cron: '0 4 * * *',
			promiseId: 'mine-{{.timestamp}}',
			promiseTimeout: 60000
		});
		const { status, schedule } = await create(second);

		assert.equal(status, 200, 'the server does not report a conflict — that is the whole problem');
		assert.equal(schedule.cron, '0 3 * * *', 'the original record comes back untouched');
		assert.equal(isDuplicateEcho(second, schedule), true);
	});

	/**
	 * The edit likeliest to be attempted and likeliest to be missed: same
	 * schedule, new target. Only the tag differs.
	 */
	test('resubmitting with only a changed target tag is still caught', async () => {
		const first = scheduleCreatePayload({
			id: 'dup-test-repoint',
			cron: '0 3 * * *',
			promiseId: 'mine-{{.timestamp}}',
			promiseTimeout: 60000,
			promiseTags: { 'resonate:target': 'poll://any@default' }
		});
		await create(first);

		const repointed = scheduleCreatePayload({
			id: 'dup-test-repoint',
			cron: '0 3 * * *',
			promiseId: 'mine-{{.timestamp}}',
			promiseTimeout: 60000,
			promiseTags: { 'resonate:target': 'poll://any@workers' }
		});
		const { schedule } = await create(repointed);
		assert.equal(isDuplicateEcho(repointed, schedule), true);
	});
});
