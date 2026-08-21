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

/**
 * Seed times are fixed constants, never `Date.now()` — a fixture whose
 * output changes between runs cannot be asserted against.
 */
const T0 = 1_755_000_000_000; // 2025-08-12T12:00:00Z, an arbitrary fixed epoch
const HOUR = 3_600_000;

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
	const rootSettled =
		rootState === 'pending' ? null : rootStart + children.length * 400 + 900;
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
 */
export function seedPromises() {
	const all = [];

	// A clean run: everything resolved. The baseline "nothing is wrong" tree.
	all.push(
		...tree('checkout-7f3a', 'resolved', T0, [
			{ func: 'reserve_inventory', state: 'resolved', value: b64ok({ reserved: true }) },
			{ func: 'charge_card', state: 'resolved', scope: 'global', value: b64ok({ txn: 'ch_881' }) },
			{ func: 'send_receipt', state: 'resolved', value: b64ok({ sent: true }) }
		], b64ok({ orderId: 'ord-7f3a', total: 4210 }))
	);

	// A failed run: one child rejected, so the root is rejected too. This is
	// the tree the error-forensics work in C2 is built against.
	all.push(
		...tree('payout-91bc', 'rejected', T0 + HOUR, [
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

	// Still running, with a sleep child — exercises the `sleep` role and the
	// missing-settledAt path (no `settledAt` key at all, not a null).
	all.push(
		...tree('sync-inventory-4d2e', 'pending', T0 + 2 * HOUR, [
			{ func: 'fetch_catalog', state: 'resolved', value: b64ok({ skus: 1204 }) },
			{ func: 'sleep', state: 'pending', sleepMs: 300_000 }
		])
	);

	// Timed out vs cancelled — the whole point of surfacing these separately.
	// A timeout is an incident; a cancellation is somebody's decision.
	all.push(
		...tree('report-nightly-88aa', 'rejected_timedout', T0 + 3 * HOUR, [
			{ func: 'aggregate_rows', state: 'rejected_timedout', durationMs: 3_600_000 }
		])
	);

	all.push(
		...tree('import-legacy-1c5f', 'rejected_canceled', T0 + 4 * HOUR, [
			{ func: 'read_dump', state: 'resolved', value: b64ok({ bytes: 91_204 }) },
			{ func: 'write_rows', state: 'rejected_canceled' }
		])
	);

	// A deeper tree: grandchildren, to prove the graph is not flat.
	const deepRoot = 'fanout-2b6d';
	const deepStart = T0 + 5 * HOUR;
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
	for (let i = 0; i < 120; i++) {
		const n = String(i).padStart(4, '0');
		const start = T0 + 6 * HOUR + i * 1000;
		const state = PROMISE_STATES[i % PROMISE_STATES.length];
		all.push(
			promise({
				id: `bulk-job-${n}`,
				state,
				createdAt: start,
				timeoutAt: start + HOUR,
				settledAt: state === 'pending' ? null : start + 700,
				tags: { 'resonate:origin': `bulk-job-${n}`, 'resonate:scope': 'global', queue: 'bulk' },
				param: invoke('bulk_job', [i]),
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
export function seedSchedules() {
	return [
		{
			id: 'nightly-report',
			cron: '0 2 * * *',
			promiseId: 'report-nightly-{{.timestamp}}',
			promiseTimeout: HOUR,
			promiseParam: invoke('nightly_report'),
			promiseTags: { 'resonate:scope': 'global', team: 'analytics' },
			createdAt: T0 - 30 * 24 * HOUR,
			nextRunAt: T0 + 14 * HOUR,
			lastRunAt: T0 - 10 * HOUR
		},
		{
			id: 'inventory-sync',
			cron: '*/15 * * * *',
			promiseId: 'sync-inventory-{{.timestamp}}',
			promiseTimeout: 15 * 60_000,
			promiseParam: invoke('sync_inventory'),
			promiseTags: { 'resonate:scope': 'global', team: 'ops' },
			createdAt: T0 - 90 * 24 * HOUR,
			nextRunAt: T0 + 900_000,
			lastRunAt: T0 - 900_000
		},
		{
			// Never run: `lastRunAt` is skipped when None, not sent as null.
			id: 'quarterly-truesup',
			cron: '0 0 1 */3 *',
			promiseId: 'truesup-{{.timestamp}}',
			promiseTimeout: 6 * HOUR,
			promiseParam: invoke('quarterly_truesup'),
			promiseTags: { 'resonate:scope': 'global', team: 'finance' },
			createdAt: T0 - 2 * 24 * HOUR,
			nextRunAt: T0 + 40 * 24 * HOUR
		}
	];
}
