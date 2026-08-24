#!/usr/bin/env node
/**
 * Cron acceptance differential.
 *
 * `conformance.mjs` probes a fixed 16-expression corpus, small enough to read
 * in a diff. This is the other half: a generated sweep over the whole grammar
 * of the two named fields, asking a real server about every one and comparing
 * the answer to what `src/lib/utils/cron.js` predicts.
 *
 *   resonate serve --server-port 8811 --storage-type sqlite --storage-sqlite-path /tmp/x.db
 *   node mocks/cron-differential.mjs http://localhost:8811
 *
 * A mismatch is a place the UI and the server disagree about whether an
 * expression is legal, which is either a refused schedule the server would
 * have taken or — worse — a fire-time preview and an enabled submit button in
 * front of a 400. Both have shipped here before; hence this file.
 *
 * Every schedule it creates is deleted before it exits. That is not tidiness:
 * an accepted cron starts FIRING on a real server, and the corpus deliberately
 * contains expressions the server accepts and then retries every 60 seconds
 * forever.
 */

import { parseCron, serverAcceptsCron, nextFireTimes } from '../src/lib/utils/cron.js';

const url = (process.argv[2] ?? 'http://localhost:8001').replace(/\/+$/, '');

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC'
];

/** @returns {string[]} */
function corpus() {
	const out = [];
	// Every named range in both fields, both directions — ascending ones are
	// legal, descending ones are 400s, and the letters inside the names are
	// what a naive `L`/`W`/`#` operator check trips over.
	for (const a of DOW) for (const b of DOW) if (a !== b) out.push(`0 0 * * ${a}-${b}`);
	for (const a of MONTHS) for (const b of MONTHS) if (a !== b) out.push(`0 0 1 ${a}-${b} *`);
	// Bare names, steps after names, steps after named ranges.
	for (const a of DOW) out.push(`0 0 * * ${a}`, `0 0 * * ${a}/2`, `0 0 * * ${a}-SAT/2`);
	for (const a of MONTHS) out.push(`0 0 1 ${a} *`, `0 0 1 ${a}/2 *`, `0 0 1 ${a}-DEC/2 *`);
	// Ranges that mix a name and a number.
	for (const a of DOW) out.push(`0 0 * * ${a}-6`, `0 0 * * 2-${a}`);
	// Chains of three, which a two-element destructure would silently truncate.
	for (const a of DOW)
		for (const b of DOW) for (const c of DOW) if (a !== b && b !== c) out.push(`0 0 * * ${a}-${b}-${c}`);
	// Ranges with an end outside the field.
	for (const a of DOW) out.push(`0 0 * * ${a}-0`, `0 0 * * ${a}-8`, `0 0 * * 0-${a}`);
	// The assorted rest: numeric equivalents, lists, the unsupported operators,
	// `?` in and out of the two day fields, and the two 60-second-fallback cases.
	out.push(
		'0 0 * * 1',
		'0 0 * * 7',
		'0 0 * * 2/2',
		'0 0 * 1/2 *',
		'0 0 * * 2-6/2',
		'0 0 * * WED,FRI',
		'0 0 * * WED-FRI,SUN',
		'0 0 * * SUN,MON/2',
		'0 0 * * MON-FRI/2,SUN',
		'0 0 * * L',
		'0 0 15W * *',
		'0 0 * * 6#3',
		'0 0 * * TUE#1',
		'0 0 L * *',
		'0 0 * * 0',
		'0 0 * * 8',
		'0 0 32 * *',
		'0 0 1 13 *',
		'0 24 * * *',
		'0 0 30 2 *',
		'0 0 29 2 *',
		'* * * * *',
		'*/5 * * * *',
		'0 0 * * *',
		'0 0 ? * *',
		'0 0 * * ?',
		'? * * * *',
		'0 0 * ? *',
		'0 0 * * wed-fri',
		'0 0 * jan-jul *',
		'0 0 * * mon/2',
		'0 0 * */2 *',
		'0 0-10/2 * * *',
		'5/10 * * * *',
		'0 0 * * */2',
		'0 0 * * 1-2-3',
		'0 0 * * WED-FRI-',
		'0 0 * * --',
		'0 0 * * MON-',
		'0 0 * * -FRI',
		'0 0 * * MON/FRI',
		'0 0 * * 9-2',
		'0 30-5 * * *',
		'0 0 15-0 * *',
		'0 0 1 13-2 *'
	);
	return out;
}

let counter = 0;
/**
 * @param {string} kind
 * @param {Record<string, unknown>} data
 */
async function rpc(kind, data) {
	counter += 1;
	const resp = await fetch(`${url}/`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			kind,
			head: { corrId: `differential-${counter}`, version: '2026-04-01' },
			data
		})
	});
	const body = await resp.json().catch(() => null);
	return { status: body?.head?.status ?? resp.status, data: body?.data };
}

const created = [];
const mismatches = [];
const exprs = corpus();

// A stamp per run, because `schedule.create` on an existing id answers 200 with
// the pre-existing record rather than creating anything.
const stamp = Date.now().toString(36);

for (let i = 0; i < exprs.length; i++) {
	const expr = exprs[i];
	const id = `differential-${stamp}-${i}`;
	const r = await rpc('schedule.create', {
		id,
		cron: expr,
		promiseId: `${id}-{{.timestamp}}`,
		promiseTimeout: 3_600_000,
		promiseParam: {},
		promiseTags: {}
	});

	const accepted = r.status < 400;
	if (accepted) created.push(id);

	const ui = parseCron(expr).ok;
	const fixture = serverAcceptsCron(expr);

	if (ui !== accepted) {
		mismatches.push({ expr, kind: 'parser', parser: ui, server: accepted });
	}
	if (fixture !== accepted) {
		mismatches.push({ expr, kind: 'fixture', fixture, server: accepted });
	}

	// Where both agree the expression is legal, the preview has to reproduce
	// the server's own nextRunAt — projected from the record's own createdAt,
	// so the comparison needs no clock of its own.
	const sched = r.data?.schedule;
	if (accepted && ui && typeof sched?.nextRunAt === 'number') {
		const preview = nextFireTimes(expr, sched.createdAt, 1);
		const exact = preview.ok && preview.times[0] === sched.nextRunAt;
		// The 60-second fallback is the server computing nothing, not a
		// disagreement — `0 0 30 2 *` reaches it by design.
		const fallback = sched.nextRunAt - sched.createdAt === 60_000;
		if (!exact && !fallback) {
			mismatches.push({
				expr,
				kind: 'nextRunAt',
				server: new Date(sched.nextRunAt).toISOString(),
				preview: preview.ok ? new Date(preview.times[0]).toISOString() : preview.error
			});
		}
	}
}

for (const id of created) await rpc('schedule.delete', { id });

console.log(`${exprs.length} expressions against ${url}`);
console.log(`${created.length} accepted, ${exprs.length - created.length} rejected`);
console.log(`${created.length} schedules created and deleted`);
console.log(`mismatches: ${mismatches.length}`);
for (const m of mismatches) console.log('  ', JSON.stringify(m));

process.exit(mismatches.length === 0 ? 0 : 1);
