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
 *   4. `L`, `W` and `#` are not supported and are rejected. `?` means the same
 *      as `*` but is POSITIONAL: the server takes it only in day-of-month and
 *      day-of-week, and rejects it in seconds, minutes, hours, month and year.
 *      Unlike Quartz it will take `?` in both day fields at once.
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
 * @property {boolean} [question]  Whether this field accepts `?`.
 */

/**
 * `question` is not decoration. The server accepts `?` in the two day fields
 * and rejects it everywhere else — verified field by field against a running
 * 0.9.8, one `?` at a time into `0 0 0 1 1 *`. Treating `?` as a universal
 * wildcard is what let `? * * * *` draw a full fire-time preview, describe
 * itself, pass the submit gate and then come back 400.
 *
 * @type {FieldSpec[]}
 */
const FIELDS = [
	{ key: 'sec', label: 'seconds', min: 0, max: 59 },
	{ key: 'min', label: 'minutes', min: 0, max: 59 },
	{ key: 'hour', label: 'hours', min: 0, max: 23 },
	{ key: 'dom', label: 'day of month', min: 1, max: 31, question: true },
	{ key: 'month', label: 'month', min: 1, max: 12, names: MONTH_NAMES },
	{ key: 'dow', label: 'day of week', min: 1, max: 7, names: DOW_NAMES, question: true }
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
	const isName = (token) => Boolean(spec.names) && token.toUpperCase() in (spec.names ?? {});

	/** @param {string} token */
	const resolve = (token) => {
		const upper = token.toUpperCase();
		if (spec.names && upper in spec.names) return spec.names[upper];
		if (!/^\d+$/.test(token)) return NaN;
		return Number(token);
	};

	/** The name this field spells a value with, e.g. `4` → `WED`. @param {number} value */
	const nameOf = (value) =>
		Object.keys(spec.names ?? {}).find((k) => (spec.names ?? {})[k] === value) ?? String(value);

	/** `4 (WED)` where the field has names, plain `4` where it does not. @param {number} value */
	const spell = (value) => (spec.names ? `${value} (${nameOf(value)})` : String(value));

	const values = new Set();
	let wildcard = true;

	for (const item of raw.split(',')) {
		if (item === '') return { ok: false, error: `Empty entry in the ${spec.label} field.` };

		// `L`, `W` and `#` parse in some cron dialects but not this one, and the
		// server rejects them outright. Naming them beats "invalid expression".
		//
		// Tested per TOKEN, not per comma-item. The whole-item test refused every
		// named range with one of those letters inside an endpoint — `WED-FRI`,
		// `MON-WED`, `JAN-JUL`, 6 of the 21 weekday ranges and 11 of the 66 month
		// ranges — all of which a live 0.9.8 accepts, and it disabled submit while
		// naming an operator the reader had never typed.
		for (const token of item.split(/[-/]/)) {
			if (isName(token)) continue;

			// A name from the OTHER named field is the likelier reading of a token
			// like `WED` in the month field, and saying "you used the W operator"
			// there would be the same lie the whole-item test used to tell.
			const upper = token.toUpperCase();
			if (upper in DOW_NAMES || upper in MONTH_NAMES) {
				const kind = upper in DOW_NAMES ? 'a day-of-week name' : 'a month name';
				return {
					ok: false,
					error: `\`${token}\` is ${kind}, and this is the ${spec.label} field.`
				};
			}

			if (/[LW#]/i.test(token)) {
				return {
					ok: false,
					error: `\`${item}\` uses L, W or # in the ${spec.label} field. This server does not support them.`
				};
			}
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

		if (rangePart === '?' && !spec.question) {
			return {
				ok: false,
				error: `\`?\` is not allowed in the ${spec.label} field. This server takes it only in day of month and day of week — use \`*\` here.`
			};
		}

		let start;
		let end;
		/** Set when the two ends of a range are spelled differently — see below. */
		let mixedSpelling = false;
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
			// The crate will not mix the two spellings in one range: `WED-6` and
			// `2-FRI` are both 400s on 0.9.8, even though each end is valid on its
			// own and the range ascends.
			mixedSpelling = isName(a) !== isName(b);
			wildcard = false;
		} else {
			start = resolve(rangePart);
			// `5/10` means "from 5 to the end of the field, every 10" — the same
			// shape Unix cron uses, and the server accepts it.
			end = stepPart === undefined ? start : spec.max;
			wildcard = false;

			// ...but a step after a BARE NAME is a 400: `MON/2` and `JAN/2` are
			// both rejected where `2/2` and `MON-SAT/2` are accepted. The rule is
			// name-versus-range, not steps, and this direction is the one that
			// matters — it is the direction where the UI draws a preview, enables
			// submit, and hands the operator a server error.
			if (stepPart !== undefined && isName(rangePart)) {
				const asNumber = `${start}/${step}`;
				const asRange = `${rangePart.toUpperCase()}-${nameOf(spec.max)}/${step}`;
				return {
					ok: false,
					error:
						`\`${item}\` puts a step after a name in the ${spec.label} field, which this ` +
						`server rejects. Write the start as a number (\`${asNumber}\`) or give the ` +
						`range in full (\`${asRange}\`) — both mean the same thing.`
				};
			}
		}

		if (Number.isNaN(start) || Number.isNaN(end)) {
			return { ok: false, error: `\`${item}\` is not a valid ${spec.label} value.` };
		}
		if (start < spec.min || end > spec.max) {
			return {
				ok: false,
				error: `\`${item}\` is out of range for ${spec.label} (${spec.min}-${spec.max}).`
			};
		}
		if (start > end) {
			// Worth its own message because `SAT-SUN` is a natural way to write
			// "the weekend" and both ends ARE in range — "out of range" sent the
			// reader looking for a number that was never the problem. The server
			// rejects a descending range too.
			return {
				ok: false,
				error:
					`\`${item}\` runs backwards in the ${spec.label} field: it starts at ` +
					`${spell(start)} and ends at ${spell(end)}. This server needs an ascending ` +
					`range — list the values instead, as \`${nameOf(start)},${nameOf(end)}\`.`
			};
		}
		if (mixedSpelling) {
			return {
				ok: false,
				error:
					`\`${item}\` mixes a name and a number in the ${spec.label} field. This server ` +
					`needs both ends spelled the same way: \`${nameOf(start)}-${nameOf(end)}\` or ` +
					`\`${start}-${end}\`.`
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
		if (year === '*') {
			parts = parts.slice(0, 6);
		} else if (year === '?') {
			// `?` is legal in the two day fields but NOT here — the server
			// rejects `0 0 0 1 1 * ?` outright.
			return {
				ok: false,
				error: '`?` is not allowed in the year field. Use `*`, or drop the field.'
			};
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

/**
 * The crate's year field spans 1970-2100, so 2100 is the last year any
 * expression can fire in and scanning past it proves the expression never
 * fires at all.
 *
 * This used to be an eight-year day budget, which was not a bound on the
 * search so much as a bound on the truth: because day-of-month and day-of-week
 * are ANDed, ordinary expressions land decades out. `0 0 29 2 6` — the 29th of
 * February when it falls on a Friday — is 2036, and `0 0 29 2 7` is 2048. Both
 * were reported as "never fires", which also disabled the submit button, so
 * the UI refused to create schedules the server accepts and gave a false
 * reason for it. Scanning the real range costs a few milliseconds and lets the
 * "never" in that message mean never.
 */
export const CRON_MAX_YEAR = 2100;

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
 * cannot fire at all before the crate's 2100 ceiling (e.g. `0 0 30 2 *` —
 * February 30th).
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

	while (cursor.getUTCFullYear() <= CRON_MAX_YEAR) {
		const year = cursor.getUTCFullYear();
		const month = cursor.getUTCMonth();
		const date = cursor.getUTCDate();

		if (dayMatches(fields, cursor)) {
			// Only the first day of the scan starts part-way through.
			const partial = cursor.getTime() !== Date.UTC(year, month, date, 0, 0, 0);
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
 * `truncated` says the projection ran into the 2100 ceiling before finding
 * `count` of them — the caller has every fire time there will ever be, but
 * fewer than it asked for. A preview headed "next three runs" that silently
 * renders one row is a worse lie than an empty one, so this is reported rather
 * than left for the caller to infer from `times.length`.
 *
 * @param {string} expr
 * @param {number} fromMs
 * @param {number} [count]
 * @returns {{ok: true, times: number[], truncated: boolean} | {ok: false, error: string}}
 */
export function nextFireTimes(expr, fromMs, count = 3) {
	const parsed = parseCron(expr);
	if (!parsed.ok) return { ok: false, error: parsed.error };

	const times = [];
	let cursor = fromMs;
	let truncated = false;
	for (let i = 0; i < count; i++) {
		const next = nextAfter(parsed.fields, cursor);
		if (next === null) {
			if (times.length === 0) {
				return {
					ok: false,
					error:
						`The day, month and weekday this asks for never coincide between now and ` +
						`${CRON_MAX_YEAR}, which is as far as this server's cron reaches. It will not ` +
						`quietly do nothing: the server accepts the schedule and then computes it ` +
						`wrong, firing every 60 seconds forever instead of never.`
				};
			}
			truncated = true;
			break;
		}
		times.push(next);
		cursor = next;
	}

	return { ok: true, times, truncated };
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
 * The step, if the set is a clean `*​/n` run that also WRAPS cleanly — i.e. if
 * "every n" is true of the gap between the last value and the first value of
 * the next cycle, not just of the gaps inside one cycle.
 *
 * That last condition is the whole point, and leaving it out made this
 * function invent cadences nobody wrote. Two values are enough to satisfy
 * "uniformly spaced" vacuously, so `0,23` in the hour field was reported as
 * "every 23 hours" for a schedule whose runs are one hour apart, and `1,17` in
 * day-of-month as "every 16 days" for real gaps of 16, 14, 15 and 12 — with
 * the two dates the operator actually asked for nowhere in the sentence. The
 * same slip made `*​/7` minutes read "every 7 minutes" when the last gap of
 * each hour is 4.
 *
 * `(max - min + 1) % step === 0` is exactly the line between the honest cases
 * (`*​/5` and `0,30` minutes, `0,12` hours) and the misleading ones, because a
 * step that divides the field evenly is the only one whose wrap-around gap
 * equals its internal gap.
 *
 * @param {Set<number>} values
 * @param {number} min
 * @param {number} max
 * @returns {number | null}
 */
function stepOf(values, min, max) {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length < 2 || sorted[0] !== min) return null;
	const step = sorted[1] - sorted[0];
	if (step < 2) return null;
	if ((max - min + 1) % step !== 0) return null;
	for (let i = 0; i < sorted.length; i++) {
		if (sorted[i] !== min + i * step) return null;
	}
	return min + sorted.length * step > max ? step : null;
}

/**
 * Collapse a numeric set into runs, so eleven consecutive seconds read as
 * `10-20` rather than as eleven comma-separated numbers.
 *
 * @param {Set<number>} values
 * @returns {string}
 */
function compactNumbers(values) {
	const sorted = [...values].sort((a, b) => a - b);
	/** @type {string[]} */
	const tokens = [];
	let i = 0;
	while (i < sorted.length) {
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
		if (j - i >= 2) {
			tokens.push(`${sorted[i]}-${sorted[j]}`);
			i = j + 1;
		} else {
			tokens.push(String(sorted[i]));
			i++;
		}
	}
	if (tokens.length === 1) return tokens[0];
	if (tokens.length === 2) return `${tokens[0]} and ${tokens[1]}`;
	return `${tokens.slice(0, -1).join(', ')} and ${tokens[tokens.length - 1]}`;
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

	const minValue = [...f.min][0];

	const secStep = stepOf(f.sec, 0, 59);
	const minStep = stepOf(f.min, 0, 59);
	const hourStep = stepOf(f.hour, 0, 23);

	// Whether the branch taken below has already accounted for the seconds
	// field. The ones that have not get a seconds clause appended, because
	// otherwise `30 * * * * *`, `15,45 * * * * *` and `10-20 * * * * *` — one,
	// two and eleven runs a minute — all render as the same sentence. For a
	// describer whose entire job is "what will this actually do", not being
	// able to tell those apart is the failure it exists to prevent.
	let secSaid = false;

	if (!r.sec && !r.min && !r.hour) {
		time = 'every second';
		secSaid = true;
	} else if (secStep !== null && !r.min && !r.hour) {
		time = `every ${secStep} seconds`;
		secSaid = true;
	} else if (singleSec && secValue === 0 && !r.min && !r.hour) {
		time = 'every minute';
		secSaid = true;
	} else if (singleSec && minStep !== null && !r.hour) {
		time = `every ${minStep} minutes`;
	} else if (singleSec && singleMin && hourStep !== null) {
		time = `every ${hourStep} hours, at ${minValue} minutes past`;
	} else if (singleSec && singleMin && !r.hour) {
		time = `every hour at ${minValue} minutes past`;
	} else if (singleSec && singleMin && singleHour) {
		const clock = `${pad([...f.hour][0])}:${pad(minValue)}`;
		time = `at ${secValue === 0 ? clock : `${clock}:${pad(secValue)}`}`;
		secSaid = true;
	} else if (singleSec && singleMin) {
		time = `at ${listOf(f.hour, (h) => `${pad(h)}:${pad(minValue)}`)}`;
	} else {
		const hourText = r.hour ? `hour ${compactNumbers(f.hour)}` : 'every hour';
		const minText = r.min ? `minute ${compactNumbers(f.min)}` : 'every minute';
		time = `at ${minText} of ${hourText}`;
	}

	if (!secSaid) {
		if (!r.sec) time += ', every second';
		else if (singleSec) {
			// A lone `0` is the implied default and needs no clause.
			if (secValue !== 0) time += `, ${secValue} seconds past`;
		} else if (secStep !== null) time += `, every ${secStep} seconds`;
		else time += `, at seconds ${compactNumbers(f.sec)}`;
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
		// Deliberately never a cadence. Months are 28-31 days long, so a
		// day-of-month step never produces the even spacing "every N days"
		// promises: `*​/2` reads as every 2 days right up to the 31st, which is
		// one day before the 1st. The list is longer and it is true.
		days = `on the ${listOf(f.dom, ordinal)}`;
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
		if (expandYearField(parts[6]) === null) return false;
		return parseCron(parts.slice(0, 6).join(' ')).ok;
	}

	return parseCron(parts.join(' ')).ok;
}

/** The crate's year field spans 1970-2100 inclusive, both ends verified. */
const CRON_MIN_YEAR = 1970;

/**
 * Expand a year field into the years it selects, or null if the server would
 * reject it outright.
 *
 * The bound is the point. This was previously a regex that checked only for
 * four digits, so the fixture accepted `1969`, `2101`, `3000`, `1969-1971` and
 * `2100-2101` — every one of which a real server rejects — and accepted `?`,
 * which is legal in the two day fields but not this one. A fixture being more
 * permissive than the server is the one direction that matters, because it is
 * the direction that lets a broken UI pass.
 *
 * A range is rejected if EITHER end falls outside the span, which is why this
 * expands rather than clamping.
 *
 * @param {string} field
 * @returns {number[] | null}
 */
function expandYearField(field) {
	if (typeof field !== 'string' || field === '') return null;

	const years = new Set();

	for (const item of field.split(',')) {
		if (item === '') return null;

		const [rangePart, stepPart, ...extra] = item.split('/');
		if (extra.length > 0) return null;

		let step = 1;
		if (stepPart !== undefined) {
			if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) return null;
			step = Number(stepPart);
		}

		let lo;
		let hi;
		if (rangePart === '*') {
			lo = CRON_MIN_YEAR;
			hi = CRON_MAX_YEAR;
		} else {
			const m = /^(\d{4})(?:-(\d{4}))?$/.exec(rangePart);
			if (m === null) return null;
			lo = Number(m[1]);
			// `2040/5` means "from 2040 to the end of the field, every 5".
			hi = m[2] !== undefined ? Number(m[2]) : stepPart === undefined ? lo : CRON_MAX_YEAR;
		}

		if (lo < CRON_MIN_YEAR || hi > CRON_MAX_YEAR || lo > hi) return null;
		for (let y = lo; y <= hi; y += step) years.add(y);
	}

	return [...years].sort((a, b) => a - b);
}

/**
 * Mirrors `compute_next_cron` (src/util.rs:62), including its failure mode:
 * when the next occurrence cannot be computed it returns `after + 60_000`
 * rather than erroring, so a schedule the server accepted quietly becomes a
 * once-a-minute timer.
 *
 * ── What a bounded year actually does ─────────────────────────────────────
 *
 * The "fires every 60 seconds" behaviour is not a rule about single years and
 * the "lands on the wrong year" behaviour is not a separate bug. Both fall out
 * of one mistake, established by creating 22 schedules against a live 0.9.8
 * and reading `nextRunAt` back:
 *
 *   The search visits the years in the field in ascending order. For the FIRST
 *   candidate year it starts from `after`'s own month, day and time re-based
 *   into that year — correct when the candidate IS the current year, and
 *   nonsense when it is in the future. Every later candidate year is searched
 *   from its own 1 January.
 *
 * That single carry explains the whole table. `2027-2030` on a 1 January cron
 * skips 2027 (Jan 1 has "already passed" at August's date) and lands on 2028.
 * `2027` has no later candidate to fall back to, so it produces nothing and
 * the caller's 60-second retry path takes over — that is the once-a-minute
 * timer. `0 0 * * * * 2027-2030` fires at the same clock time a year out. And
 * a wildcard year is fine only because its first candidate is the current
 * year, where carrying the date is the right thing to do.
 *
 * The UI refuses every bounded year, so none of this reaches an operator — but
 * the fixture has to reproduce it, or a mock server disagrees with the real one
 * about which schedules are silent bombs.
 *
 * @param {string} expr
 * @param {number} afterMs
 * @returns {number}
 */
export function serverNextRunAt(expr, afterMs) {
	const parts = expr.trim().split(/\s+/).filter(Boolean);
	const hasYear = parts.length === 7;
	const parsed = parseCron(hasYear ? parts.slice(0, 6).join(' ') : expr);

	if (parsed.ok) {
		if (!hasYear || parts[6] === '*') {
			const next = nextAfter(parsed.fields, afterMs);
			if (next !== null) return next;
		} else {
			const years = expandYearField(parts[6]);
			const after = new Date(afterMs);
			const candidates = (years ?? []).filter((y) => y >= after.getUTCFullYear());

			for (let i = 0; i < candidates.length; i++) {
				const y = candidates[i];
				const from =
					i === 0
						? Date.UTC(
								y,
								after.getUTCMonth(),
								after.getUTCDate(),
								after.getUTCHours(),
								after.getUTCMinutes(),
								after.getUTCSeconds()
							)
						: Date.UTC(y, 0, 1) - 1000;

				const next = nextAfter(parsed.fields, from);
				if (next !== null && new Date(next).getUTCFullYear() === y) return next;
			}
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
