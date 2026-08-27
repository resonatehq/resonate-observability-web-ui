/**
 * A guard on the one part of the Ask AI feature no other test can reach.
 *
 * The bundle module is pure and heavily tested; the wiring is not. Each route
 * builds its own `capture()`, and `loadError` is an OPTIONAL field, so a route
 * that stops passing its error state still type-checks, still renders, and
 * still produces a bundle — one that quietly claims a failed view was complete,
 * which is the bug this whole feature was fixed for. Deleting that one line
 * from a route was verified to leave both `npm test` and `svelte-check` green.
 *
 * Reading the source as text is the crude form of this check. The honest form
 * would drive each route, which needs a component test harness this project
 * does not have; until then a missing line here is a failing test rather than a
 * silent regression.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES = join(import.meta.dirname, '..', 'src', 'routes');

/** Every `+page.svelte` under src/routes, found rather than listed — a route added later is covered too. */
function routePages(dir = ROUTES, found = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) routePages(path, found);
		else if (entry.name === '+page.svelte') found.push(path);
	}
	return found;
}

describe('every view that can fail passes its failure to the bundle', () => {
	const pages = routePages();

	// A positive control. Without it, a bad glob or a moved directory turns this
	// whole file into a vacuous pass — the failure mode of every grep-shaped test.
	test('the route sweep actually found the routes', () => {
		assert.ok(pages.length >= 7, `expected at least 7 route pages, found ${pages.length}`);
		assert.ok(
			pages.some((p) => p.endsWith(join('promises', '+page.svelte'))),
			'the promises list was not among the pages found'
		);
	});

	for (const page of routePages()) {
		const source = readFileSync(page, 'utf8');
		const relative = page.slice(page.indexOf(join('src', 'routes')));
		const hasCapture = source.includes('function capture()');
		const rendersError = /<ErrorPanel/.test(source);

		if (!hasCapture) continue;

		test(`${relative} hands its error state to the capture`, () => {
			assert.match(
				source,
				/loadError:/,
				'this view builds an Ask AI capture but never passes loadError — a failed load will produce a bundle asserting the view is complete'
			);
		});

		if (rendersError) {
			test(`${relative} passes the same error it renders`, () => {
				const loadError = /loadError:\s*([A-Za-z0-9_.]+)/.exec(source);
				assert.ok(loadError, 'no loadError value found');
				const rendered = /<ErrorPanel\s+\{?([A-Za-z0-9_.]+)\}?/.exec(source);
				assert.ok(rendered, 'no ErrorPanel binding found');
				assert.equal(
					loadError[1],
					rendered[1],
					'the bundle would carry a different error than the page displays'
				);
			});
		}
	}
});
