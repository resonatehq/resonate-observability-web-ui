/**
 * Protocol constants and seed data for the mock Resonate server.
 *
 * Every constant and record shape here was read out of `resonatehq/resonate`
 * (commit c8d7c7b) rather than inferred from documentation. Citations are on
 * each definition so a future reader can re-verify against the server source
 * instead of trusting this file.
 */

/** src/types.rs:133 — echoed back in every response head. */
export const PROTOCOL_VERSION = '2026-04-01';

/** src/types.rs:135 — a request head.version outside this list is a 400. */
export const SUPPORTED_VERSIONS = [PROTOCOL_VERSION];

/** src/types.rs:11-20 — snake_case, and there are five of them, not four. */
export const PROMISE_STATES = [
	'pending',
	'resolved',
	'rejected',
	'rejected_canceled',
	'rejected_timedout'
];

/** src/server.rs:407-482 — the kinds `dispatch` actually matches. */
export const KNOWN_KINDS = [
	'promise.get',
	'promise.create',
	'promise.settle',
	'promise.register_callback',
	'promise.register_listener',
	'promise.search',
	'task.get',
	'task.create',
	'task.acquire',
	'task.release',
	'task.fulfill',
	'task.suspend',
	'task.fence',
	'task.heartbeat',
	'task.halt',
	'task.continue',
	'task.search',
	'schedule.get',
	'schedule.create',
	'schedule.delete',
	'schedule.search',
	'debug.start',
	'debug.stop',
	'debug.reset',
	'debug.snap',
	'debug.tick'
];

/** src/server.rs:106-111 — every path the old REST UI called now answers 410. */
export const LEGACY_PATHS = ['/promises', '/schedules', '/tasks'];

/** src/server.rs:519, 964-975 — search paging bounds. */
export const DEFAULT_SEARCH_LIMIT = 100;
export const MAX_SEARCH_LIMIT = 1000;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64');

/**
 * A `PromiseRecord` as the server serialises it — src/types.rs:211-224.
 * `param` and `value` are always present (they are not Option), `settledAt`
 * is omitted entirely when the promise has not settled.
 */
function promise({
	id,
	state,
	createdAt,
	timeoutAt,
	settledAt,
	tags = {},
	param = {},
	value = {}
}) {
	const record = { id, state, param, value, tags, timeoutAt, createdAt };
	if (settledAt != null) record.settledAt = settledAt;
	return record;
}

const HOUR = 3_600_000;

/**
 * Seed times default to a fixed constant, never `Date.now()` — a fixture whose
 * output changes between runs cannot be asserted against, and every test in
 * this directory takes that default.
 *
 * `npm run mock` overrides it (see the CLI in server.mjs), because a fixture
 * pinned to a fixed past renders as "379d ago" on every row and leaves the
 * throughput chart empty: the dashboard bins the last hour, and nothing
 * settled in it. Nothing asserts an absolute timestamp — the conformance
 * suite projects `nextRunAt` from each record's own `createdAt` precisely so
 * the comparison needs no clock — so the anchor is free to move.
 */
export const FIXTURE_EPOCH = 1_755_000_000_000; // 2025-08-12T12:00:00Z

/**
 * Oldest seeded record to newest. Anchor a run at `Date.now() - FIXTURE_SPAN_MS`
 * and the newest record lands on now.
 */
export const FIXTURE_SPAN_MS = 7 * HOUR;

const invoke = (func, args = []) => ({
	headers: { 'content-type': 'application/json' },
	data: b64({ func, args })
});

const rejection = (message, type = 'Error') => ({
	headers: { 'content-type': 'application/json' },
	data: b64({ type, message })
});

/**
 * Builds one workflow tree. Children carry both `resonate:parent` and
 * `resonate:origin` because `fetchTreePromises` searches on origin and
 * `buildTree` links on parent (src/lib/utils/tree.ts:49-130).
 */
function tree(rootId, rootState, rootStart, children, rootValue = {}) {
	// A root cannot settle before the children it is waiting on. The old
	// formula counted children rather than their durations, so a workflow with
	// one slow child — `report-nightly`, whose `aggregate_rows` runs the full
	// hour to its timeout — settled a second in, an hour before the child that
	// failed it, and listed ahead of its own cause in Recent Failures.
	const childSettles = children.map((child, i) =>
		child.state === 'pending' ? null : rootStart + i * 400 + 100 + (child.durationMs ?? 250)
	);
	const lastChildSettle = Math.max(rootStart, ...childSettles.filter((t) => t !== null));
	const rootSettled = rootState === 'pending' ? null : lastChildSettle + 900;
	const promises = [
		promise({
			id: rootId,
			state: rootState,
			createdAt: rootStart,
			timeoutAt: rootStart + HOUR,
			settledAt: rootSettled,
			tags: { 'resonate:origin': rootId, 'resonate:scope': 'global' },
			param: invoke(rootId.split('-')[0]),
			value: rootValue
		})
	];

	children.forEach((child, i) => {
		const start = rootStart + i * 400 + 100;
		const id = `${rootId}.${i + 1}`;
		const tags = {
			'resonate:parent': rootId,
			'resonate:origin': rootId,
			'resonate:scope': child.scope ?? 'local'
		};
		if (child.sleepMs) tags['resonate:timeout'] = String(child.sleepMs);

		promises.push(
			promise({
				id,
				state: child.state,
				createdAt: start,
				timeoutAt: start + HOUR,
				settledAt: child.state === 'pending' ? null : start + (child.durationMs ?? 250),
				tags,
				param: invoke(child.func),
				value: child.value ?? {}
			})
		);
	});

	return promises;
}

/**
 * The seeded promise set.
 *
 * Deliberately covers every state in PROMISE_STATES — including the two the
 * old UI collapsed into a single "rejected" bucket — plus a nested subtree,
 * a sleep promise, and enough filler to force cursor pagination at the
 * default limit of 100.
 *
 * Order matters as much as coverage: search is ordered by id, so the named
 * workflows are named to sort ahead of the filler. See the filler block below.
 */
export function seedPromises(T0 = FIXTURE_EPOCH) {
	const all = [];

	// Minutes back from the end of the span — the instant the fixture presents
	// as "now". The layout below is deliberate, because two dashboard panels
	// read this ordering and nothing else does:
	//
	//   Recent Failures  sorts by settledAt, so the three NAMED failures are
	//                    placed most-recently. One rejection, one timeout, one
	//                    cancellation: the three modes this UI separates, side
	//                    by side, each with a decodable reason.
	//   Active Workflows sorts oldest-pending first "so the stuck ones
	//                    surface", so the genuinely stuck workflow is the
	//                    oldest record in the fixture.
	const ago = (minutes) => T0 + FIXTURE_SPAN_MS - minutes * 60_000;

	// Still running after seven hours, with a sleep child — the stuck one, and
	// the oldest thing here. Also exercises the `sleep` role and the
	// missing-settledAt path (no `settledAt` key at all, not a null).
	all.push(
		...tree('sync-inventory-4d2e', 'pending', T0, [
			{ func: 'fetch_catalog', state: 'resolved', value: b64ok({ skus: 1204 }) },
			{ func: 'sleep', state: 'pending', sleepMs: 300_000 }
		])
	);

	// A clean run: everything resolved. The baseline "nothing is wrong" tree.
	all.push(
		...tree('checkout-7f3a', 'resolved', T0 + HOUR, [
			{ func: 'reserve_inventory', state: 'resolved', value: b64ok({ reserved: true }) },
			{ func: 'charge_card', state: 'resolved', scope: 'global', value: b64ok({ txn: 'ch_881' }) },
			{ func: 'send_receipt', state: 'resolved', value: b64ok({ sent: true }) }
		], b64ok({ orderId: 'ord-7f3a', total: 4210 }))
	);

	// A failed run: one child rejected, so the root is rejected too. This is
	// the tree the error-forensics work in C2 is built against.
	all.push(
		...tree('payout-91bc', 'rejected', ago(40), [
			{ func: 'load_ledger', state: 'resolved', value: b64ok({ rows: 42 }) },
			{
				func: 'transfer_funds',
				state: 'rejected',
				scope: 'global',
				durationMs: 1800,
				value: rejection('insufficient balance: need 4210, have 1980', 'BalanceError')
			},
			{ func: 'notify_recipient', state: 'pending' }
		], rejection('transfer_funds failed', 'WorkflowError'))
	);

	// Timed out vs cancelled — the whole point of surfacing these separately.
	// A timeout is an incident; a cancellation is somebody's decision.
	// `aggregate_rows` runs the full hour to its deadline, so this one has to
	// start more than an hour back or it would settle in the future.
	all.push(
		...tree('report-nightly-88aa', 'rejected_timedout', ago(85), [
			{ func: 'aggregate_rows', state: 'rejected_timedout', durationMs: 3_600_000 }
		])
	);

	all.push(
		...tree('import-legacy-1c5f', 'rejected_canceled', ago(30), [
			{ func: 'read_dump', state: 'resolved', value: b64ok({ bytes: 91_204 }) },
			{ func: 'write_rows', state: 'rejected_canceled' }
		])
	);

	// A deeper tree: grandchildren, to prove the graph is not flat.
	const deepRoot = 'fanout-2b6d';
	const deepStart = T0 + 2 * HOUR;
	all.push(
		promise({
			id: deepRoot,
			state: 'resolved',
			createdAt: deepStart,
			timeoutAt: deepStart + HOUR,
			settledAt: deepStart + 5000,
			tags: { 'resonate:origin': deepRoot, 'resonate:scope': 'global' },
			param: invoke('fanout'),
			value: b64ok({ batches: 3 })
		})
	);
	for (let branch = 1; branch <= 3; branch++) {
		const branchId = `${deepRoot}.${branch}`;
		const branchStart = deepStart + branch * 200;
		all.push(
			promise({
				id: branchId,
				state: 'resolved',
				createdAt: branchStart,
				timeoutAt: branchStart + HOUR,
				settledAt: branchStart + 1500,
				tags: {
					'resonate:parent': deepRoot,
					'resonate:origin': deepRoot,
					'resonate:scope': 'local'
				},
				param: invoke('process_batch', [branch]),
				value: b64ok({ batch: branch })
			})
		);
		for (let leaf = 1; leaf <= 2; leaf++) {
			const leafStart = branchStart + leaf * 100;
			all.push(
				promise({
					id: `${branchId}.${leaf}`,
					state: 'resolved',
					createdAt: leafStart,
					timeoutAt: leafStart + HOUR,
					settledAt: leafStart + 300,
					tags: {
						'resonate:parent': branchId,
						'resonate:origin': deepRoot,
						'resonate:scope': 'local'
					},
					param: invoke('write_record', [branch, leaf]),
					value: b64ok({ ok: true })
				})
			);
		}
	}

	// Filler roots so the default limit of 100 is exceeded and `cursor` is
	// exercised without the caller having to construct it.
	//
	// Two properties the filler has to keep, both found by looking at a first
	// run rather than at the code:
	//
	// 1. It sorts AFTER the named workflows above. Search is ordered by id and
	//    the dashboard samples the first page, so filler named `bulk-job-*`
	//    WAS the entire sample — 120 near-identical rows, and not one of the
	//    trees above visible until you paged past them.
	// 2. Its state mix is lopsided, the way a real queue is. Cycling through
	//    PROMISE_STATES evenly put the donut at an exact 20% per state and the
	//    error rate at 80%, which reads as placeholder art rather than data.
	//
	// The cycle below is 20 long and repeats 6 times: 78 resolved, 24 pending,
	// 6 each rejected / timedout / canceled. Every state stays populated, which
	// is what `every state is filterable` in server.test.mjs asserts.
	const FILLER_STATES = [
		'resolved',
		'resolved',
		'resolved',
		'pending',
		'resolved',
		'resolved',
		'rejected',
		'resolved',
		'pending',
		'resolved',
		'resolved',
		'resolved',
		'rejected_timedout',
		'pending',
		'resolved',
		'resolved',
		'rejected_canceled',
		'pending',
		'resolved',
		'resolved'
	];
	// Spread evenly across the whole span rather than bunched into two minutes
	// at the end: a batch queue runs all day, and the dashboard's throughput
	// chart bins the last hour in 5-minute buckets, which bunched filler left
	// empty but for one spike.
	//
	// The suffix is an opaque hash, not a counter, because search returns
	// promises ordered by id and the dashboard samples the FIRST page. With
	// zero-padded counters the sample was necessarily the oldest hundred
	// records, so the throughput chart — which bins the last hour — was empty
	// across its whole right-hand side while the store was busy. Real ids are
	// opaque and uncorrelated with time; making these opaque too is both more
	// faithful and what makes "sampled from 100+" a representative sample
	// rather than a window onto the past.
	const FILLER_INTERVAL_MS = FIXTURE_SPAN_MS / 120;
	const suffix = (i) => (((i + 1) * 2_654_435_761) % 0xffffff).toString(16).padStart(6, '0');
	for (let i = 0; i < 120; i++) {
		const n = suffix(i);
		const start = T0 + i * FILLER_INTERVAL_MS;
		// A queue item hours old has finished one way or another. Leaving old
		// filler `pending` put a 6-hour-old batch job at the top of Active
		// Workflows, which sorts oldest-first to surface stuck work — so the
		// filler, not the workflow that is actually stuck, read as the problem.
		const rolled = FILLER_STATES[i % FILLER_STATES.length];
		const state =
			rolled === 'pending' && start < ago(90) ? 'resolved' : rolled;
		all.push(
			promise({
				id: `worker-batch-${n}`,
				state,
				createdAt: start,
				timeoutAt: start + HOUR,
				settledAt: state === 'pending' ? null : start + 700,
				tags: {
					'resonate:origin': `worker-batch-${n}`,
					'resonate:scope': 'global',
					queue: 'batch'
				},
				param: invoke('run_batch', [i]),
				value: state === 'pending' ? {} : b64ok({ i })
			})
		);
	}

	return all;
}

function b64ok(value) {
	return { headers: { 'content-type': 'application/json' }, data: b64(value) };
}

/**
 * `ScheduleRecord` — src/types.rs:239-257.
 *
 * Note how little this resembles the `Schedule` interface the UI currently
 * declares: there is no `description`, no `lastRunTime`/`nextRunTime`/
 * `createdOn`. The fixture serves the server's shape, not the UI's.
 */
export function seedSchedules(T0 = FIXTURE_EPOCH) {
	// Schedules are the one seed that reads forwards as well as backwards, so
	// they hang off the END of the span — the instant the fixture presents as
	// "now" — not off its start. A `nextRunAt` behind the clock is the single
	// most obviously wrong thing a schedules table can show.
	const NOW = T0 + FIXTURE_SPAN_MS;
	return [
		{
			id: 'nightly-report',
			cron: '0 2 * * *',
			promiseId: 'report-nightly-{{.timestamp}}',
			promiseTimeout: HOUR,
			promiseParam: invoke('nightly_report'),
			promiseTags: { 'resonate:scope': 'global', team: 'analytics' },
			createdAt: NOW - 30 * 24 * HOUR,
			nextRunAt: NOW + 14 * HOUR,
			lastRunAt: NOW - 10 * HOUR
		},
		{
			id: 'inventory-sync',
			cron: '*/15 * * * *',
			promiseId: 'sync-inventory-{{.timestamp}}',
			promiseTimeout: 15 * 60_000,
			promiseParam: invoke('sync_inventory'),
			promiseTags: { 'resonate:scope': 'global', team: 'ops' },
			createdAt: NOW - 90 * 24 * HOUR,
			nextRunAt: NOW + 600_000,
			lastRunAt: NOW - 300_000
		},
		{
			// Never run: `lastRunAt` is skipped when None, not sent as null.
			id: 'quarterly-truesup',
			cron: '0 0 1 */3 *',
			promiseId: 'truesup-{{.timestamp}}',
			promiseTimeout: 6 * HOUR,
			promiseParam: invoke('quarterly_truesup'),
			promiseTags: { 'resonate:scope': 'global', team: 'finance' },
			createdAt: NOW - 2 * 24 * HOUR,
			nextRunAt: NOW + 40 * 24 * HOUR
		}
	];
}
