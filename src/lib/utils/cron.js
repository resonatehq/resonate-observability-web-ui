/**
 * Cron parsing, description and fire-time projection, matching what the
 * Resonate server actually does.
 *
 * This is plain JavaScript rather than TypeScript on purpose: `mocks/` is a
 * zero-dependency fixture run directly by `node --test`, and the app is
 * bundled. A `.js` module with JSDoc types is the only form both can import
 * without a build step, and `checkJs: true` still type-checks it strictly.
 * One source of truth beats a second copy that drifts.
 *
 * ── Why this file exists at all ───────────────────────────────────────────
 *
 * The server computes `nextRunAt` and never exposes a preview endpoint, so a
 * "what will this actually do" preview has to be computed client-side. That
 * makes agreement with the server a correctness requirement, not a nicety —
 * hence the notes below, every one of which was pinned by creating real
 * schedules against a real server and reading `nextRunAt` back.
 *
 * ── Where this differs from the cron you think you know ───────────────────
 *
 * The server uses the Rust `cron` crate (`src/util.rs`), NOT Unix cron. Four
 * differences change what a given expression means, silently:
 *
 *   1. Day-of-week is 1-7 where 1 = SUNDAY and 7 = Saturday. `0` is a parse
 *      ERROR, not Sunday. So `0 0 * * 1` is Sunday midnight, not Monday —
 *      the opposite of what a Unix crontab would do with the same string.
 *   2. Day-of-month and day-of-week are ANDed. Unix cron ORs them when both
 *      are restricted. `0 0 1 * 2` means "the 1st, but only if it is a
 *      Monday", which fires far more rarely than a Unix user would expect.
 *   3. Fields are seconds-first when six are given: `sec min hour dom month
 *      dow`. A five-field expression gets a `0` seconds field prepended.
 *   4. `L`, `W` and `#` are not supported and are rejected. `?` is accepted
 *      and means the same as `*`.
 *
 * ── Everything is UTC ─────────────────────────────────────────────────────
 *
 * `compute_next_cron` builds a `DateTime<Utc>` and evaluates the schedule
 * against it. There is no timezone field on a schedule and no server setting
 * for one. Every fire time this module returns is therefore a UTC instant,
 * and any UI rendering one must say so — an operator reading "03:00" and
 * assuming their own zone is the failure this module exists to prevent.
 */

/** Field ordinals are 1-based here to match the crate, not JS `getUTCDay()`. */
const DOW_NAMES = { SUN: 1, MON: 2, TUE: 3, WED: 4, THU: 5, FRI: 6, SAT: 7 };

const MONTH_NAMES = {
	JAN: 1,
	FEB: 2,
	MAR: 3,
	APR: 4,
	MAY: 5,
	JUN: 6,
	JUL: 7,
	AUG: 8,
	SEP: 9,
	OCT: 10,
	NOV: 11,
	DEC: 12
};

const DOW_LABELS = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH_LABELS = [
	'',
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/**
 * @typedef {object} FieldSpec
 * @property {string} key
 * @property {string} label
 * @property {number} min
 * @property {number} max
 * @property {Record<string, number>} [names]
 */

/** @type {FieldSpec[]} */
const FIELDS = [
	{ key: 'sec', label: 'seconds', min: 0, max: 59 },
	{ key: 'min', label: 'minutes', min: 0, max: 59 },
	{ key: 'hour', label: 'hours', min: 0, max: 23 },
	{ key: 'dom', label: 'day of month', min: 1, max: 31 },
	{ key: 'month', label: 'month', min: 1, max: 12, names: MONTH_NAMES },
	{ key: 'dow', label: 'day of week', min: 1, max: 7, names: DOW_NAMES }
];

/**
 * @typedef {object} CronFields
 * @property {Set<number>} sec
 * @property {Set<number>} min
 * @property {Set<number>} hour
 * @property {Set<number>} dom
 * @property {Set<number>} month
 * @property {Set<number>} dow
 * @property {Record<string, boolean>} restricted  Which fields were not `*`/`?`.
 */

/**
 * @typedef {{ok: true, fields: CronFields, normalized: string}} CronParseOk
 * @typedef {{ok: false, error: string}} CronParseErr
 * @typedef {CronParseOk | CronParseErr} CronParseResult
 */

/**
 * Mirrors `normalize_cron` in `src/util.rs`: a five-field expression is
 * promoted by prepending a `0` seconds field; six is used as-is.
 *
 * @param {string} expr
 * @returns {string}
 */
export function normalizeCron(expr) {
	const parts = expr.trim().split(/\s+/).filter(Boolean);
	return parts.length === 5 ? `0 ${parts.join(' ')}` : parts.join(' ');
}

/**
 * Expand one field into the set of values it matches.
 *
 * @param {string} raw
 * @param {FieldSpec} spec
 * @returns {{ok: true, values: Set<number>, wildcard: boolean} | {ok: false, error: string}}
 */
function parseField(raw, spec) {
	/** @param {string} token */
	const resolve = (token) => {
		const upper = token.toUpperCase();
		if (spec.names && upper in spec.names) return spec.names[upper];
		if (!/^\d+$/.test(token)) return NaN;
		return Number(token);
	};

	const values = new Set();
	let wildcard = true;

	for (const item of raw.split(',')) {
		if (item === '') return { ok: false, error: `Empty entry in the ${spec.label} field.` };

		// `L`, `W` and `#` parse in some cron dialects but not this one, and the
		// server rejects them outright. Naming them beats "invalid expression".
		if (/[LW#]/i.test(item) && !(spec.names && item.toUpperCase() in spec.names)) {
			return {
				ok: false,
				error: `\`${item}\` uses L, W or # in the ${spec.label} field. This server does not support them.`
			};
		}

		const [rangePart, stepPart, ...extra] = item.split('/');
		if (extra.length > 0) {
			return { ok: false, error: `\`${item}\` has more than one \`/\` in the ${spec.label} field.` };
		}

		let step = 1;
		if (stepPart !== undefined) {
			if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) {
				return { ok: false, error: `\`${item}\` has an invalid step in the ${spec.label} field.` };
			}
			step = Number(stepPart);
		}

		let start;
		let end;
		if (rangePart === '*' || rangePart === '?') {
			start = spec.min;
			end = spec.max;
			// `*` is a wildcard but `*/5` is not: it selects every fifth value,
			// which is a restriction. Treating it as a wildcard is what made
			// `*/5 * * * *` describe itself as "every minute".
			if (step > 1) wildcard = false;
		} else if (rangePart.includes('-')) {
			const [a, b] = rangePart.split('-');
			start = resolve(a);
			end = resolve(b);
			wildcard = false;
		} else {
			start = resolve(rangePart);
			// `5/10` means "from 5 to the end of the field, every 10" — the same
			// shape Unix cron uses, and the server accepts it.
			end = stepPart === undefined ? start : spec.max;
			wildcard = false;
		}

		if (Number.isNaN(start) || Number.isNaN(end)) {
			return { ok: false, error: `\`${item}\` is not a valid ${spec.label} value.` };
		}
		if (start < spec.min || end > spec.max || start > end) {
			return {
				ok: false,
				error: `\`${item}\` is out of range for ${spec.label} (${spec.min}-${spec.max}).`
			};
		}

		for (let v = start; v <= end; v += step) values.add(v);
	}

	return { ok: true, values, wildcard };
}

/**
 * Parse a cron expression the way the server will.
 *
 * @param {string} expr
 * @returns {CronParseResult}
 */
export function parseCron(expr) {
	if (typeof expr !== 'string' || expr.trim() === '') {
		return { ok: false, error: 'Cron expression is required.' };
	}

	let parts = expr.trim().split(/\s+/).filter(Boolean);

	if (parts.length === 7) {
		// A seventh field is a year. The server parses it — so it passes the
		// server's own validity check — and then MISCOMPUTES it: a bounded year
		// makes `compute_next_cron` fall through to its "retry in 60 seconds"
		// error path, so the schedule fires every minute forever instead of
		// once in the year asked for. A year range is accepted and lands on the
		// wrong year. `*` is the only year value that behaves.
		const year = parts[6];
		if (year === '*' || year === '?') {
			parts = parts.slice(0, 6);
		} else {
			return {
				ok: false,
				error:
					'A year field is not usable on this server: it is accepted and then computed wrong, firing every 60 seconds instead of on the year given. Use `*` for the year, or drop the field.'
			};
		}
	}

	if (parts.length === 5) parts = ['0', ...parts];

	if (parts.length !== 6) {
		return {
			ok: false,
			error: `Expected 5 or 6 fields, got ${parts.length}. Five is \`min hour day month weekday\`; six puts seconds first.`
		};
	}

	/** @type {Record<string, Set<number>>} */
	const sets = {};
	/** @type {Record<string, boolean>} */
	const restricted = {};

	for (let i = 0; i < FIELDS.length; i++) {
		const spec = FIELDS[i];
		const result = parseField(parts[i], spec);
		if (!result.ok) return { ok: false, error: result.error };
		sets[spec.key] = result.values;
		restricted[spec.key] = !result.wildcard;
	}

	const fields = /** @type {CronFields} */ ({
		sec: sets.sec,
		min: sets.min,
		hour: sets.hour,
		dom: sets.dom,
		month: sets.month,
		dow: sets.dow,
		restricted
	});

	return { ok: true, fields, normalized: parts.join(' ') };
}

/** Eight years of day-steps: enough for `Feb 29`, bounded for `Feb 30`. */
const MAX_DAYS_SCANNED = 366 * 8;

/**
 * @param {CronFields} fields
 * @param {Date} d
 * @returns {boolean}
 */
function dayMatches(fields, d) {
	// ANDed, not ORed — see the header note. `*` expands to the full set, so a
	// plain AND gives the right answer for the unrestricted cases too.
	return (
		fields.month.has(d.getUTCMonth() + 1) &&
		fields.dom.has(d.getUTCDate()) &&
		fields.dow.has(d.getUTCDay() + 1)
	);
}

/**
 * The next fire time strictly after `afterMs`, or null if the expression
 * cannot fire within the scan window (e.g. `0 0 30 2 *` — February 30th).
 *
 * @param {CronFields} fields
 * @param {number} afterMs
 * @returns {number | null}
 */
function nextAfter(fields, afterMs) {
	const hours = [...fields.hour].sort((a, b) => a - b);
	const minutes = [...fields.min].sort((a, b) => a - b);
	const seconds = [...fields.sec].sort((a, b) => a - b);

	let cursor = new Date(Math.floor(afterMs / 1000) * 1000 + 1000);

	for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned++) {
		const year = cursor.getUTCFullYear();
		const month = cursor.getUTCMonth();
		const date = cursor.getUTCDate();

		if (dayMatches(fields, cursor)) {
			// Only the first day of the scan starts part-way through.
			const partial = scanned === 0;
			const fromH = partial ? cursor.getUTCHours() : 0;

			for (const h of hours) {
				if (h < fromH) continue;
				const fromM = partial && h === cursor.getUTCHours() ? cursor.getUTCMinutes() : 0;

				for (const m of minutes) {
					if (m < fromM) continue;
					const fromS =
						partial && h === cursor.getUTCHours() && m === cursor.getUTCMinutes()
							? cursor.getUTCSeconds()
							: 0;

					for (const s of seconds) {
						if (s < fromS) continue;
						return Date.UTC(year, month, date, h, m, s);
					}
				}
			}
		}

		cursor = new Date(Date.UTC(year, month, date + 1, 0, 0, 0));
	}

	return null;
}

/**
 * Project the next `count` fire times, as UTC epoch milliseconds.
 *
 * @param {string} expr
 * @param {number} fromMs
 * @param {number} [count]
 * @returns {{ok: true, times: number[]} | {ok: false, error: string}}
 */
export function nextFireTimes(expr, fromMs, count = 3) {
	const parsed = parseCron(expr);
	if (!parsed.ok) return { ok: false, error: parsed.error };

	const times = [];
	let cursor = fromMs;
	for (let i = 0; i < count; i++) {
		const next = nextAfter(parsed.fields, cursor);
		if (next === null) {
			if (times.length === 0) {
				return {
					ok: false,
					error:
						'This expression never fires — the day, month and weekday it asks for never coincide.'
				};
			}
			break;
		}
		times.push(next);
		cursor = next;
	}

	return { ok: true, times };
}

/**
 * @param {Set<number>} values
 * @param {(n: number) => string} label
 * @returns {string}
 */
function listOf(values, label) {
	const sorted = [...values].sort((a, b) => a - b);
	const parts = sorted.map(label);
	if (parts.length === 1) return parts[0];
	if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * @param {Set<number>} values
 * @param {number} min
 * @param {number} max
 * @returns {number | null} The step, if the set is a clean `*​/n` run.
 */
function stepOf(values, min, max) {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length < 2 || sorted[0] !== min) return null;
	const step = sorted[1] - sorted[0];
	if (step < 2) return null;
	for (let i = 0; i < sorted.length; i++) {
		if (sorted[i] !== min + i * step) return null;
	}
	return min + sorted.length * step > max ? step : null;
}

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/** @param {number} n */
function ordinal(n) {
	const rem100 = n % 100;
	if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
	return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * A plain-language reading of the expression. This is the point of the whole
 * preview: it is what turns a cron string from a guess into a decision, and
 * it is the only place the 1 = Sunday surprise becomes visible before the
 * schedule is created.
 *
 * @param {string} expr
 * @returns {{ok: true, text: string} | {ok: false, error: string}}
 */
export function describeCron(expr) {
	const parsed = parseCron(expr);
	if (!parsed.ok) return { ok: false, error: parsed.error };

	const f = parsed.fields;
	const r = f.restricted;

	// ── time of day ─────────────────────────────────────────────────────────
	let time;
	const singleSec = f.sec.size === 1;
	const singleMin = f.min.size === 1;
	const singleHour = f.hour.size === 1;
	const secValue = [...f.sec][0];

	const secStep = stepOf(f.sec, 0, 59);
	const minStep = stepOf(f.min, 0, 59);
	const hourStep = stepOf(f.hour, 0, 23);

	if (!r.sec && !r.min && !r.hour) {
		time = 'every second';
	} else if (secStep !== null && !r.min && !r.hour) {
		time = `every ${secStep} seconds`;
	} else if (singleSec && secValue === 0 && !r.min && !r.hour) {
		time = 'every minute';
	} else if (singleSec && minStep !== null && !r.hour) {
		time = `every ${minStep} minutes`;
	} else if (singleSec && singleMin && hourStep !== null) {
		time = `every ${hourStep} hours, at ${[...f.min][0]} minutes past`;
	} else if (singleSec && singleMin && !r.hour) {
		time = `every hour at ${pad([...f.min][0])} minutes past`;
	} else if (singleSec && singleMin && singleHour) {
		const clock = `${pad([...f.hour][0])}:${pad([...f.min][0])}`;
		time = `at ${secValue === 0 ? clock : `${clock}:${pad(secValue)}`}`;
	} else if (singleSec && singleMin) {
		time = `at ${listOf(f.hour, (h) => `${pad(h)}:${pad([...f.min][0])}`)}`;
	} else {
		const hourText = r.hour ? `hour ${listOf(f.hour, String)}` : 'every hour';
		const minText = r.min ? `minute ${listOf(f.min, String)}` : 'every minute';
		time = `at ${minText} of ${hourText}`;
	}

	// ── which days ──────────────────────────────────────────────────────────
	let days;
	if (!r.dom && !r.dow) {
		days = 'every day';
	} else if (r.dow && !r.dom) {
		const weekdays = new Set([2, 3, 4, 5, 6]);
		const isWeekdays = f.dow.size === 5 && [...f.dow].every((d) => weekdays.has(d));
		const isWeekend = f.dow.size === 2 && f.dow.has(1) && f.dow.has(7);
		if (isWeekdays) days = 'Monday to Friday';
		else if (isWeekend) days = 'on Saturday and Sunday';
		else days = `on ${listOf(f.dow, (d) => DOW_LABELS[d])}`;
	} else if (r.dom && !r.dow) {
		const domStep = stepOf(f.dom, 1, 31);
		days = domStep !== null ? `every ${domStep} days` : `on the ${listOf(f.dom, ordinal)}`;
	} else {
		// Both restricted. The crate ANDs these, so say so explicitly — this is
		// the case a Unix-cron reader will get backwards.
		days = `on the ${listOf(f.dom, ordinal)}, but only when that is a ${listOf(f.dow, (d) => DOW_LABELS[d])}`;
	}

	const months = r.month ? ` in ${listOf(f.month, (m) => MONTH_LABELS[m])}` : '';

	const text = `${time.charAt(0).toUpperCase()}${time.slice(1)}, ${days}${months}, UTC.`;
	return { ok: true, text };
}

// ─── The server's own view, for the fixture to mirror ────────────────────────
//
// `parseCron`/`nextFireTimes` above are what the UI uses, and they are
// deliberately STRICTER than the server: they refuse a bounded year, because
// the server accepts one and then computes it wrong. The mock fixture cannot
// be that strict without ceasing to be a fixture, so the two functions below
// model what the server actually does, bug included.

/**
 * Mirrors `is_valid_cron` (src/util.rs:54): parseability only. Notably this
 * accepts a seven-field expression with a bounded year, which the server also
 * accepts and then miscomputes.
 *
 * @param {string} expr
 * @returns {boolean}
 */
export function serverAcceptsCron(expr) {
	if (typeof expr !== 'string' || expr.trim() === '') return false;
	const parts = expr.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 5 || parts.length > 7) return false;

	if (parts.length === 7) {
		const year = parts[6];
		// The crate's year field spans 1970-2100. Syntax only, same as the crate.
		if (!/^(\*|\?|\d{4}(-\d{4})?)(\/\d+)?(,(\d{4}(-\d{4})?))*$/.test(year)) return false;
		return parseCron(parts.slice(0, 6).join(' ')).ok;
	}

	return parseCron(parts.join(' ')).ok;
}

/**
 * Mirrors `compute_next_cron` (src/util.rs:62), including its failure mode:
 * when the next occurrence cannot be computed it returns `after + 60_000`
 * rather than erroring, so a schedule the server accepted quietly becomes a
 * once-a-minute timer.
 *
 * Not modelled: a bounded year *range* (`2027-2030`), which the server
 * computes to a wrong-but-not-fallback year. The UI refuses to submit either
 * form, so the fixture reproduces the single-year case and stops there.
 *
 * @param {string} expr
 * @param {number} afterMs
 * @returns {number}
 */
export function serverNextRunAt(expr, afterMs) {
	const parts = expr.trim().split(/\s+/).filter(Boolean);
	const boundedYear = parts.length === 7 && parts[6] !== '*' && parts[6] !== '?';

	if (!boundedYear) {
		const parsed = parseCron(parts.length === 7 ? parts.slice(0, 6).join(' ') : expr);
		if (parsed.ok) {
			const next = nextAfter(parsed.fields, afterMs);
			if (next !== null) return next;
		}
	}

	return afterMs + 60_000;
}

/**
 * Presets for the common cases, so the operator never has to write cron at
 * all. `weekly` deliberately spells out `2` for Monday rather than the `1` a
 * Unix crontab would use.
 *
 * @type {{id: string, label: string, cron: string | null}[]}
 */
export const CRON_PRESETS = [
	{ id: 'minute', label: 'Every minute', cron: '* * * * *' },
	{ id: 'five-minutes', label: 'Every 5 minutes', cron: '*/5 * * * *' },
	{ id: 'hourly', label: 'Hourly, on the hour', cron: '0 * * * *' },
	{ id: 'daily', label: 'Daily at a set time', cron: '0 0 * * *' },
	{ id: 'weekly', label: 'Weekly on a set day', cron: '0 0 * * 2' },
	{ id: 'monthly', label: 'Monthly on the 1st', cron: '0 0 1 * *' },
	{ id: 'custom', label: 'Custom expression', cron: null }
];

/** The weekday options, in the server's 1 = Sunday ordering. */
export const DOW_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map((value) => ({
	value,
	label: DOW_LABELS[value]
}));

/**
 * Render a UTC instant unambiguously. Never use `toLocaleString` for a fire
 * time — the schedule is evaluated in UTC and showing it in the browser's
 * zone without saying so is how an operator ends up with a schedule six
 * hours off.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatUtc(ms) {
	const d = new Date(ms);
	return (
		`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
		`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
	);
}
