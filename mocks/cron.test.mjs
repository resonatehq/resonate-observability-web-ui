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

// ─── Regressions ─────────────────────────────────────────────────────────────
//
// Everything below fixes a case where this engine and a live 0.9.8 disagreed.
// Each expected value came from creating the schedule against the real server
// and reading `nextRunAt` back, the same way the rest of this file was built.

test('`?` is positional — legal in the two day fields and nowhere else', async (t) => {
	// Verified one `?` at a time into `0 0 0 1 1 *` against 0.9.8. Treating it
	// as a universal wildcard let `? * * * *` draw a full preview, describe
	// itself, pass the submit gate, and come back 400.
	await t.test('accepted in day-of-month and day-of-week, together or apart', () => {
		// Six-field forms are seconds-first, so `0 0 0 ? 1 *` is the day-of-month
		// case and `0 0 0 1 ? *` is the month one — which is rejected below.
		for (const expr of ['0 0 ? * *', '0 0 * * ?', '0 0 ? * ?', '0 0 0 ? 1 *', '0 0 0 1 1 ?']) {
			assert.ok(parseCron(expr).ok, `${expr} should parse`);
			assert.ok(serverAcceptsCron(expr), `${expr} should be accepted`);
		}
	});

	await t.test('rejected in seconds, minutes, hours, month and year', () => {
		for (const expr of [
			'? 0 0 1 1 *',
			'0 ? 0 1 1 *',
			'0 0 ? 1 1 *',
			'0 0 0 1 ? *',
			'? * * * *',
			'0 0 * ? *',
			'0 0 0 1 1 * ?'
		]) {
			assert.equal(parseCron(expr).ok, false, `${expr} should not parse`);
			assert.equal(serverAcceptsCron(expr), false, `${expr} should not be accepted`);
		}
	});

	await t.test('the rejection names the field rather than saying "invalid"', () => {
		const r = parseCron('? * * * *');
		assert.equal(r.ok, false);
		assert.match(r.error, /minutes/);
	});
});

test('the projection reaches the crate ceiling, not eight years', async (t) => {
	// Because day-of-month and day-of-week are ANDed, ordinary expressions land
	// decades out. An eight-year budget reported these as "never fires", which
	// also disabled the submit button — so the UI refused schedules the server
	// accepts, and gave a false reason.
	await t.test('a leap day on a given weekday resolves', () => {
		assert.equal(first('0 0 29 2 6'), '2036-02-29T00:00:00.000Z'); // Friday
		assert.equal(first('0 0 29 2 7'), '2048-02-29T00:00:00.000Z'); // Saturday
		assert.equal(first('0 0 29 2 1'), '2032-02-29T00:00:00.000Z'); // Sunday
	});

	await t.test('an expression that truly never fires still says so', () => {
		const r = nextFireTimes('0 0 30 2 *', REF, 3);
		assert.equal(r.ok, false);
		assert.match(r.error, /never fires/);
		assert.match(r.error, /2100/);
	});

	await t.test('running out before `count` is reported, not silently short', () => {
		// 2048 and 2076 are inside the range; 2104 is not.
		const r = nextFireTimes('0 0 29 2 7', REF, 3);
		assert.ok(r.ok);
		assert.equal(r.times.length, 2);
		assert.equal(r.truncated, true);
	});

	await t.test('an ordinary projection is not marked truncated', () => {
		const r = nextFireTimes('0 0 * * *', REF, 3);
		assert.ok(r.ok);
		assert.equal(r.truncated, false);
	});
});

test('a cadence is only claimed when the wrap-around gap matches', async (t) => {
	// Two values are enough to be "uniformly spaced" vacuously, which is how
	// `0,23` in the hour field became "every 23 hours" for runs an hour apart.
	/** @param {string} e */
	const text = (e) => {
		const d = describeCron(e);
		assert.ok(d.ok, e);
		return d.text;
	};

	await t.test('sets that do not divide the field are listed, not summarised', () => {
		assert.match(text('0 0,23 * * *'), /00:00 and 23:00/);
		assert.doesNotMatch(text('0 0,23 * * *'), /every 23 hours/);
		assert.doesNotMatch(text('0,59 * * * *'), /every 59/);
		assert.doesNotMatch(text('0,21,42 * * * *'), /every 21/);
		assert.doesNotMatch(text('*/7 * * * *'), /every 7 minutes/);
	});

	await t.test('sets that do divide it keep their cadence', () => {
		assert.match(text('*/5 * * * *'), /Every 5 minutes/);
		assert.match(text('0,30 * * * *'), /Every 30 minutes/);
		assert.match(text('0 0,12 * * *'), /every 12 hours/i);
		assert.match(text('*/15 * * * *'), /Every 15 minutes/);
	});

	await t.test('day-of-month never claims a day cadence, because months vary', () => {
		// `*/2` runs every 2 days right up to the 31st, one day before the 1st.
		assert.doesNotMatch(text('0 0 */2 * *'), /every 2 days/);
		assert.match(text('0 0 1,17 * *'), /1st and 17th/);
		assert.doesNotMatch(text('0 0 1,17 * *'), /every 16 days/);
	});
});

test('a non-zero seconds field is never dropped from the description', async (t) => {
	/** @param {string} e */
	const text = (e) => {
		const d = describeCron(e);
		assert.ok(d.ok, e);
		return d.text;
	};

	await t.test('one, two and eleven runs a minute are distinguishable', () => {
		// These three used to share one sentence. For a describer whose job is
		// "what will this actually do", that is the failure it exists to stop.
		const once = text('30 * * * * *');
		const twice = text('15,45 * * * * *');
		const eleven = text('10-20 * * * * *');
		assert.notEqual(once, twice);
		assert.notEqual(twice, eleven);
		assert.notEqual(once, eleven);
	});

	await t.test('each says what it does', () => {
		assert.match(text('30 * * * * *'), /30 seconds past/);
		assert.match(text('15,45 * * * * *'), /15 and 45/);
		assert.match(text('10-20 * * * * *'), /10-20/);
		assert.match(text('7 */5 * * * *'), /Every 5 minutes.*7 seconds past/);
		assert.match(text('5 30 * * * *'), /30 minutes past.*5 seconds past/);
	});

	await t.test('a lone zero stays implicit', () => {
		assert.doesNotMatch(text('0 * * * * *'), /seconds past/);
		assert.doesNotMatch(text('0 0 * * *'), /seconds past/);
	});
});

test('the year field is bounded to the crate range of 1970-2100', async (t) => {
	// The fixture accepted anything with four digits, so it took `1969`,
	// `2101`, `3000` and ranges straddling either end — all of which a real
	// server rejects. A fixture may be stricter than the server; being more
	// permissive is what lets a broken UI pass.
	await t.test('in range', () => {
		assert.ok(serverAcceptsCron('0 0 0 1 1 * 1970'));
		assert.ok(serverAcceptsCron('0 0 0 1 1 * 2100'));
		assert.ok(serverAcceptsCron('0 0 0 1 1 * 1970-2100'));
		assert.ok(serverAcceptsCron('0 0 0 1 1 * 2040/5'));
		assert.ok(serverAcceptsCron('0 0 0 1 1 * */2'));
	});

	await t.test('out of range, at either end of a range', () => {
		for (const year of ['1969', '2101', '3000', '0001', '1969-1971', '2100-2101']) {
			assert.equal(
				serverAcceptsCron(`0 0 0 1 1 * ${year}`),
				false,
				`year ${year} should be rejected`
			);
		}
	});
});

test('a bounded year: the fallback and the wrong-year landing are one bug', async (t) => {
	// The search visits candidate years in order. For the FIRST it starts from
	// `after`'s own month, day and time re-based into that year — right when
	// the candidate is the current year, nonsense when it is in the future.
	// Later candidates start from 1 January. Every value below is a real
	// nextRunAt read back from 0.9.8.
	/** @param {string} expr */
	const at = (expr) => new Date(serverNextRunAt(expr, REF)).toISOString();

	await t.test('a single future year produces nothing, so the caller retries in 60s', () => {
		assert.equal(serverNextRunAt('0 0 0 1 1 * 2030', REF), REF + 60_000);
		assert.equal(serverNextRunAt('0 0 0 1 1 * 2027', REF), REF + 60_000);
		// 2100 is in range and still falls through: no later candidate to reach.
		assert.equal(serverNextRunAt('0 0 0 1 1 * 2100', REF), REF + 60_000);
	});

	await t.test('a multi-year field skips to the candidate after the right one', () => {
		assert.equal(at('0 0 0 1 1 * 2027-2030'), '2028-01-01T00:00:00.000Z');
		assert.equal(at('0 0 0 1 1 * 2027,2029'), '2029-01-01T00:00:00.000Z');
		assert.equal(at('0 0 0 1 1 * */2'), '2028-01-01T00:00:00.000Z');
		assert.equal(at('0 0 0 1 1 * 2040/5'), '2045-01-01T00:00:00.000Z');
	});

	await t.test('a set including the current year is correct, by accident', () => {
		// The first candidate IS this year, where carrying the date is right.
		assert.equal(at('0 0 0 1 1 * 1970-2100'), '2027-01-01T00:00:00.000Z');
		assert.equal(at('0 0 0 1 1 * 2026-2027'), '2027-01-01T00:00:00.000Z');
	});

	await t.test('the carried date is visible when the cron fires often enough', () => {
		// Not 2027-01-01: the first candidate year starts at August's date.
		assert.equal(at('0 0 * * * * 2027-2030'), '2027-08-22T15:00:00.000Z');
		assert.equal(at('0 0 0 25 8 * 2027-2030'), '2027-08-25T00:00:00.000Z');
		// Aug 15 has passed by August 22, so 2027 yields nothing and 2028 runs
		// from 1 January — where Aug 15 is still ahead.
		assert.equal(at('0 0 0 15 8 * 2027-2030'), '2028-08-15T00:00:00.000Z');
	});

	await t.test('a wildcard year behaves normally', () => {
		assert.equal(at('0 0 0 1 1 * *'), '2027-01-01T00:00:00.000Z');
	});
});
