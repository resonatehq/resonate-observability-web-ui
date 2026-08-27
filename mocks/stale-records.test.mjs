/**
 * A guard on what a view does with the records it is already holding when the
 * next load fails.
 *
 * Two rules, and the difference between them is identity rather than age:
 *
 *   1. A view keyed on an id must never render a record belonging to a
 *      DIFFERENT id. Its `$effect` re-runs on the param without remounting, so
 *      without an explicit discard the previous entity stays on screen under
 *      the new id — a "not found" panel above another promise's payloads.
 *
 *   2. A view that keeps records a failed load did not replace must say so on
 *      screen. The Ask AI bundle has said it in text since the load-failure
 *      work; the person looking at the page was the one still not being told.
 *
 * Reading the source as text is the crude form of this, for the same reason as
 * `capture-wiring.test.mjs`: driving the routes needs a component harness this
 * project does not have. Both of these defects were invisible to a code audit
 * and obvious in thirty seconds of driving the UI, so treat a green run here as
 * "the wiring is still present", not as "the behaviour is correct".
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');
const ROUTES = join(SRC, 'routes');

/** Every `+page.svelte` under src/routes, found rather than listed. */
function routePages(dir = ROUTES, found = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) routePages(path, found);
		else if (entry.name === '+page.svelte') found.push(path);
	}
	return found;
}

const pages = routePages().map((path) => ({
	path,
	relative: path.slice(path.indexOf(join('src', 'routes'))),
	source: readFileSync(path, 'utf8')
}));

/** Views that render a failure are the only ones that can render one over data. */
const canFail = pages.filter((p) => /<ErrorPanel/.test(p.source));
/** Routes keyed on an id — the ones where stale means *wrong entity*. */
const idKeyed = canFail.filter((p) => p.relative.includes('['));

describe('a failed load does not leave the wrong records on screen', () => {
	// Positive controls. Without these a bad glob, a renamed directory or a
	// tightened filter turns every assertion below into a vacuous pass — the
	// failure mode of every grep-shaped test.
	test('the route sweep found the routes that can fail', () => {
		assert.ok(
			canFail.length >= 7,
			`expected at least 7 routes rendering ErrorPanel, found ${canFail.length}`
		);
		assert.ok(
			canFail.some((p) => p.relative.endsWith(join('promises', '+page.svelte'))),
			'the promises list was not among the pages found'
		);
	});

	test('the sweep found the id-keyed routes', () => {
		assert.equal(
			idKeyed.length,
			3,
			`expected the 3 id-keyed routes (promises, workflows, schedules), found ${idKeyed.length}: ${idKeyed.map((p) => p.relative).join(', ')}`
		);
	});

	for (const { relative, source } of idKeyed) {
		test(`${relative} discards a record belonging to another id`, () => {
			// The guard compares the held record's id against the one being loaded
			// and nulls it out. Spelled loosely on purpose: the three routes hold
			// their record differently (`promise`, `schedule`, `root.promise`), and
			// pinning the exact expression would make this a change-detector.
			assert.match(
				source,
				/\.id !== \w+\)\s*\{[^}]*=\s*null/s,
				'no guard discarding a record whose id differs from the one being loaded — ' +
					'a failed navigation between two ids will render the previous entity under the new one'
			);
		});
	}

	for (const { relative, source } of canFail) {
		test(`${relative} labels records it keeps after a failure`, () => {
			assert.match(
				source,
				/<StaleNotice/,
				'this view can render an error over records it already had, but never tells the ' +
					'reader those records are from an earlier load'
			);
		});

		test(`${relative} gates that label on an actual failure`, () => {
			// A notice that renders unconditionally is worse than none: it would
			// caption current data as stale and get ignored, taking the real case
			// with it.
			assert.match(
				source,
				/\{#if stale[^}]*\}\s*<StaleNotice/,
				'the stale notice is not gated on a `stale` condition'
			);
		});
	}
});

describe('the dashboard store does not publish a half-loaded state', () => {
	const source = readFileSync(join(SRC, 'lib', 'stores', 'dashboard.svelte.ts'), 'utf8');

	test('the store was actually read', () => {
		assert.match(source, /async load\(\)/, 'dashboard store load() not found — the path moved');
	});

	test('both requests are awaited before anything is assigned', () => {
		const schedulesAwaited = source.indexOf('await searchSchedules');
		const firstAssign = source.indexOf('this.promises = ');
		assert.ok(schedulesAwaited > 0, 'searchSchedules is no longer awaited in this store');
		assert.ok(firstAssign > 0, 'this.promises is no longer assigned in this store');
		assert.ok(
			schedulesAwaited < firstAssign,
			'records are assigned between the two requests, so a failure in the second leaves ' +
				'the store holding fresh promises next to stale schedules with stats for neither'
		);
	});

	test('the error is cleared on success, not on entry', () => {
		const clear = source.indexOf('this.error = null');
		const stamp = source.indexOf('this.loadedAt = Date.now()');
		assert.ok(clear > 0 && stamp > 0, 'the success path no longer clears the error or stamps the load');
		assert.ok(
			clear > stamp,
			'the error is cleared before the load succeeds, so a persistently unreachable server ' +
				'makes the panel flash out and back on every poll and reads as an intermittent fault'
		);
	});
});
