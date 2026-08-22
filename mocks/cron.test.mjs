/**
 * Cron semantics, pinned against resonate 0.9.8.
 *
 * Every expected value in this file was produced by creating a real schedule
 * against a real server and reading `nextRunAt` back — not by reading the
 * crate's documentation, which describes a dialect the server does not use.
 * The reference instant is 2026-08-22T14:48:00Z, a Saturday.
 *
 * These are the cases that make the fire-time preview trustworthy. If the
 * preview and the server disagree, the operator is shown a schedule that is
 * not the one they created, which is worse than showing nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	parseCron,
	nextFireTimes,
	describeCron,
	normalizeCron,
	serverAcceptsCron,
	serverNextRunAt,
	formatUtc
} from '../src/lib/utils/cron.js';

/** Saturday 2026-08-22 14:48:00 UTC — the instant every expectation below is relative to. */
const REF = Date.UTC(2026, 7, 22, 14, 48, 0);

/** @param {string} expr */
function first(expr) {
	const r = nextFireTimes(expr, REF, 1);
	assert.ok(r.ok, `expected ${expr} to be valid: ${r.ok ? '' : r.error}`);
	return new Date(r.times[0]).toISOString();
}

test('day-of-week is 1 = Sunday, not the Unix 0 = Sunday', async (t) => {
	// The single most dangerous divergence: an operator who writes `* * * * 1`
	// from muscle memory gets Sunday, and nothing tells them.
	await t.test('1 is Sunday', () => {
		assert.equal(first('0 0 * * 1'), '2026-08-23T00:00:00.000Z'); // a Sunday
	});

	await t.test('2 is Monday', () => {
		assert.equal(first('0 0 * * 2'), '2026-08-24T00:00:00.000Z'); // a Monday
	});

	await t.test('7 is Saturday', () => {
		assert.equal(first('0 0 * * 7'), '2026-08-29T00:00:00.000Z'); // a Saturday
	});

	await t.test('0 is a parse error, not Sunday', () => {
		const r = parseCron('0 0 * * 0');
		assert.equal(r.ok, false);
		assert.match(r.error, /out of range for day of week/);
	});

	await t.test('names agree with the ordinals', () => {
		assert.equal(first('0 0 * * SUN'), first('0 0 * * 1'));
		assert.equal(first('0 0 * * MON'), first('0 0 * * 2'));
	});

	await t.test('the description says the day out loud', () => {
		const d = describeCron('0 0 * * 1');
		assert.ok(d.ok);
		assert.match(d.text, /Sunday/);
	});
});

test('day-of-month and day-of-week are ANDed, not ORed', () => {
	// Unix cron would fire on the next Monday OR the next 1st — 2026-08-24.
	// This server fires only on a Monday that is also the 1st.
	assert.equal(first('0 0 1 * 2'), '2027-02-01T00:00:00.000Z');

	const d = describeCron('0 0 1 * 2');
	assert.ok(d.ok);
	assert.match(d.text, /but only when that is a Monday/);
});

test('everything is evaluated in UTC', () => {
	// Would be 18:00Z if the server used a UTC-6 local zone.
	assert.equal(first('0 12 * * *'), '2026-08-23T12:00:00.000Z');
	assert.equal(first('30 3 * * *'), '2026-08-23T03:30:00.000Z');

	// And every rendered fire time says so, because a bare "03:30" read in the
	// operator's own zone is the bug this whole module exists to prevent.
	assert.match(formatUtc(Date.UTC(2026, 7, 23, 3, 30, 0)), /^2026-08-23 03:30:00 UTC$/);

	const d = describeCron('30 3 * * *');
	assert.ok(d.ok);
	assert.match(d.text, /UTC\.$/);
});

test('five fields gain a seconds field; six are seconds-first', async (t) => {
	await t.test('normalizeCron prepends a zero to five fields', () => {
		assert.equal(normalizeCron('* * * * *'), '0 * * * * *');
		assert.equal(normalizeCron('0 * * * * *'), '0 * * * * *');
	});

	await t.test('five and six field forms agree', () => {
		assert.equal(first('* * * * *'), '2026-08-22T14:49:00.000Z');
		assert.equal(first('0 * * * * *'), '2026-08-22T14:49:00.000Z');
		assert.equal(first('0 0 12 * * *'), first('0 12 * * *'));
	});

	await t.test('a six-field seconds step fires on the next 30s boundary', () => {
		// REF is exactly :48:00, so the next half-minute mark is :48:30 — the
		// five-field forms above skip it because their seconds field is fixed 0.
		assert.equal(first('*/30 * * * * *'), '2026-08-22T14:48:30.000Z');
	});

	await t.test('anything other than 5, 6 or 7 fields is rejected', () => {
		const r = parseCron('* * *');
		assert.equal(r.ok, false);
		assert.match(r.error, /Expected 5 or 6 fields/);
	});
});

test('ranges, lists and steps', async (t) => {
	await t.test('minute list', () => {
		assert.equal(first('0,30 * * * *'), '2026-08-22T15:00:00.000Z');
	});

	await t.test('hour list', () => {
		assert.equal(first('0 0,12 * * *'), '2026-08-23T00:00:00.000Z');
	});

	await t.test('weekday range', () => {
		assert.equal(first('0 0 * * MON-FRI'), '2026-08-24T00:00:00.000Z');
	});

	await t.test('hour range with weekday range', () => {
		assert.equal(first('0 9-17 * * 2-6'), '2026-08-24T09:00:00.000Z');
	});

	await t.test('step within a range', () => {
		assert.equal(first('0 0-10/2 * * *'), '2026-08-23T00:00:00.000Z');
	});

	await t.test('bare number with a step runs to the end of the field', () => {
		// `5/10` is minutes 5, 15, 25, 35, 45, 55 — not "every 10 from 5 to 5".
		assert.equal(first('5/10 * * * *'), '2026-08-22T14:55:00.000Z');
	});

	await t.test('month names and lists', () => {
		assert.equal(first('0 0 1 JAN *'), '2027-01-01T00:00:00.000Z');
		assert.equal(first('0 0 1 JAN,JUL *'), '2027-01-01T00:00:00.000Z');
	});

	await t.test('a leap day skips to the next leap year', () => {
		assert.equal(first('0 0 29 2 *'), '2028-02-29T00:00:00.000Z');
	});
});

test('out-of-range values are rejected with the field named', async (t) => {
	for (const [expr, pattern] of [
		['0 24 * * *', /out of range for hours/],
		['0 0 0 * *', /out of range for day of month/],
		['0 0 1 13 *', /out of range for month/],
		['0 0 * * 8', /out of range for day of week/]
	]) {
		await t.test(String(expr), () => {
			const r = parseCron(String(expr));
			assert.equal(r.ok, false);
			assert.match(r.error, /** @type {RegExp} */ (pattern));
		});
	}
});

test('L, W and # are named rather than reported as "invalid"', async (t) => {
	for (const expr of ['0 0 L * *', '0 0 * * 1#2', '0 0 15W * *']) {
		await t.test(expr, () => {
			const r = parseCron(expr);
			assert.equal(r.ok, false);
			assert.match(r.error, /does not support them/);
		});
	}
});

test('`?` is accepted and means the same as `*`', () => {
	assert.equal(first('0 0 ? * 1'), first('0 0 * * 1'));
	assert.equal(first('0 0 1 * ?'), first('0 0 1 * *'));
});

test('a bounded year is refused by the UI and mis-computed by the server', async (t) => {
	// The trap: the server's validity check PASSES, so it answers 200 and
	// registers the schedule — then compute_next_cron falls through to its
	// 60-second retry path, and the schedule fires every minute forever
	// instead of once a year.
	await t.test('the UI parser refuses it, and says why', () => {
		const r = parseCron('0 0 0 1 1 * 2030');
		assert.equal(r.ok, false);
		assert.match(r.error, /firing every 60 seconds/);
	});

	await t.test('the server would have accepted it', () => {
		assert.equal(serverAcceptsCron('0 0 0 1 1 * 2030'), true);
	});

	await t.test('and then computed the 60-second fallback', () => {
		assert.equal(serverNextRunAt('0 0 0 1 1 * 2030', REF), REF + 60_000);
	});

	await t.test('a wildcard year is fine and is treated as six fields', () => {
		const r = parseCron('0 0 0 1 1 * *');
		assert.equal(r.ok, true);
		assert.equal(first('0 0 0 1 1 * *'), '2027-01-01T00:00:00.000Z');
	});
});

test('an expression that can never fire is reported, not returned empty', () => {
	// February 30th parses field-by-field and matches no date that exists.
	const r = nextFireTimes('0 0 30 2 *', REF, 3);
	assert.equal(r.ok, false);
	assert.match(r.error, /never fires/);
});

test('the fixture and the UI agree on fire times', () => {
	// The fixture computes nextRunAt with the same engine that draws the
	// preview, so a preview that matches the fixture also matches the server.
	for (const expr of ['* * * * *', '0 0 * * *', '0 0 * * 2', '*/5 * * * *', '0 0 1 * *']) {
		const preview = nextFireTimes(expr, REF, 1);
		assert.ok(preview.ok);
		assert.equal(serverNextRunAt(expr, REF), preview.times[0], expr);
	}
});

test('descriptions read as decisions, not as cron', async (t) => {
	for (const [expr, expected] of [
		['* * * * *', 'Every minute, every day, UTC.'],
		['*/5 * * * *', 'Every 5 minutes, every day, UTC.'],
		['0 0 * * *', 'At 00:00, every day, UTC.'],
		['30 3 * * *', 'At 03:30, every day, UTC.'],
		['0 0 * * MON-FRI', 'At 00:00, Monday to Friday, UTC.'],
		['0 0 1 * *', 'At 00:00, on the 1st, UTC.'],
		['*/30 * * * * *', 'Every 30 seconds, every day, UTC.']
	]) {
		await t.test(String(expr), () => {
			const d = describeCron(String(expr));
			assert.ok(d.ok);
			assert.equal(d.text, expected);
		});
	}
});

test('nextFireTimes projects forward, strictly increasing', () => {
	const r = nextFireTimes('0 0 * * *', REF, 3);
	assert.ok(r.ok);
	assert.equal(r.times.length, 3);
	assert.deepEqual(
		r.times.map((t) => new Date(t).toISOString()),
		['2026-08-23T00:00:00.000Z', '2026-08-24T00:00:00.000Z', '2026-08-25T00:00:00.000Z']
	);
});

test('a fire time exactly at the reference instant is not returned twice', () => {
	// `nextAfter` is strictly-after, so projecting from a boundary advances.
	const onTheMinute = Date.UTC(2026, 7, 22, 14, 48, 0);
	const r = nextFireTimes('* * * * *', onTheMinute, 2);
	assert.ok(r.ok);
	assert.equal(new Date(r.times[0]).toISOString(), '2026-08-22T14:49:00.000Z');
	assert.equal(new Date(r.times[1]).toISOString(), '2026-08-22T14:50:00.000Z');
});
