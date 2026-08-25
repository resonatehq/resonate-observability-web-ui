/**
 * Tests for the "Ask AI" context bundle.
 *
 * The bundle is a document an operator copies out of the console and pastes
 * somewhere else, so two properties matter more than any formatting detail:
 * a credential must never survive into it, and anything it left out must be
 * named inside it. Most of what follows is one of those two.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	buildBundle,
	decodePayload,
	sanitizeServerUrl,
	treeOutline,
	BUNDLE_LIMITS,
	SCHEMA_NOTE
} from '../src/lib/api/bundle.js';

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

/** A promise record with the shape the server actually returns. */
function promise(overrides = {}) {
	return {
		id: 'step-1',
		state: 'resolved',
		param: { data: b64('{"n":1}') },
		value: { data: b64('{"ok":true}') },
		tags: {},
		timeoutAt: 1_780_000_060_000,
		createdAt: 1_780_000_000_000,
		settledAt: 1_780_000_030_000,
		...overrides
	};
}

function capture(overrides = {}) {
	return {
		view: 'Promises',
		path: '/promises',
		viewState: { stateFilter: null },
		serverUrl: 'http://127.0.0.1:8801',
		capturedAt: '2026-08-24T12:00:00.000Z',
		groups: [{ label: 'Promises in view', kind: 'promise', records: [promise()] }],
		selection: null,
		...overrides
	};
}

describe('the bundle never carries a credential', () => {
	// The strongest form of the assertion, and the one worth keeping if every
	// other test in this file were deleted: not "the token was replaced at the
	// path we expected" but "the token is nowhere in the document."
	test("the console's own token does not appear anywhere, wherever it was hiding", () => {
		const token = 'sk-live-9f3a-not-a-real-token';
		const { text } = buildBundle(
			capture({
				secrets: [token],
				viewState: { note: `debugging with ${token}` },
				groups: [
					{
						label: 'Promises in view',
						kind: 'promise',
						records: [
							promise({ tags: { 'operator-note': `token=${token}` } }),
							promise({ id: 'step-2', param: { data: b64(`{"auth":"${token}"}`) } })
						]
					}
				]
			})
		);
		assert.equal(text.includes(token), false);
	});

	test('a JWT is redacted even when it is not the token this console holds', () => {
		// An operator debugging an auth failure pastes somebody else's token into
		// a promise param. It is not in `secrets`, so only the shape catches it.
		const jwt =
			'eyJhbGciOiJIUzI1NiJ9.eyJwcmVmaXgiOiIiLCJleHAiOjE4MDAwMDAwMDB9.c2lnbmF0dXJlLWhlcmU';
		const { text, redactions } = buildBundle(
			capture({
				secrets: [],
				groups: [
					{ label: 'Promises in view', kind: 'promise', records: [promise({ tags: { hdr: jwt } })] }
				]
			})
		);
		assert.equal(text.includes(jwt), false);
		assert.equal(
			redactions.some((r) => r.includes('JWT')),
			true
		);
	});

	test('a credential-named field is redacted by its name, whatever the value looks like', () => {
		const { text } = buildBundle(
			capture({
				groups: [
					{
						label: 'Promises in view',
						kind: 'promise',
						records: [promise({ value: { headers: { authorization: 'Basic YWJjOjEyMw==' } } })]
					}
				]
			})
		);
		assert.equal(text.includes('Basic YWJjOjEyMw=='), false);
	});

	// The counterweight, and the reason `SECRET_KEY_PATTERNS` is a list of
	// anchored patterns rather than a `/key|token|secret/` sweep. Redacting these
	// would remove the payload the operator is asking for help with, and they
	// would have no way to know why the assistant was confused.
	test('fields that merely sound like credentials are left alone', () => {
		const innocuous = {
			idempotencyKey: 'order-42-attempt-1',
			partitionKey: 'eu-west',
			tokenCount: 4096,
			publicKeyId: 'kid-7',
			keyspace: 'workflows'
		};
		const { text, redactions } = buildBundle(
			capture({
				groups: [
					{ label: 'Promises in view', kind: 'promise', records: [promise({ tags: innocuous })] }
				]
			})
		);
		for (const value of ['order-42-attempt-1', 'eu-west', '4096', 'kid-7', 'workflows']) {
			assert.equal(text.includes(value), true, `${value} should have survived`);
		}
		assert.deepEqual(redactions, []);
	});

	test('a username and password in the server URL are stripped and the strip is reported', () => {
		const { text, redactions } = buildBundle(
			capture({ serverUrl: 'https://ops:hunter2@resonate.internal:8001' })
		);
		assert.equal(text.includes('hunter2'), false);
		assert.equal(
			redactions.some((r) => r.includes('server URL')),
			true
		);
	});

	test('a server URL that does not parse is reported as-is rather than dropped', () => {
		// A malformed URL is worth seeing — it is very often the bug — and it
		// cannot contain userinfo we would be leaking.
		assert.deepEqual(sanitizeServerUrl('not a url'), { url: 'not a url', redacted: false });
	});
});

describe('the bundle says what it left out', () => {
	// The property the whole "bounds" section exists for. A cap that fires
	// without a line in the document reads as "you have everything", and an
	// assistant will state a confident conclusion about records it never saw.
	test('every bound and redaction it reports also appears in the document', () => {
		const { text, truncations, redactions } = buildBundle(
			capture({
				serverUrl: 'https://ops:hunter2@resonate.internal',
				secrets: ['tok-abc'],
				groups: [
					{
						label: 'Promises in view',
						kind: 'promise',
						records: Array.from({ length: BUNDLE_LIMITS.records + 5 }, (_, i) =>
							promise({
								id: `step-${i}`,
								tags: { blob: 'x'.repeat(BUNDLE_LIMITS.string + 1), leak: 'tok-abc' }
							})
						)
					}
				]
			})
		);
		assert.ok(truncations.length > 0);
		assert.ok(redactions.length > 0);
		for (const line of [...truncations, ...redactions]) {
			assert.equal(text.includes(line), true, `missing from the bundle: ${line}`);
		}
	});

	test('records past the cap are dropped and the drop is stated with both counts', () => {
		const records = Array.from({ length: BUNDLE_LIMITS.records + 7 }, (_, i) =>
			promise({ id: `step-${i}` })
		);
		const { recordCount, truncations } = buildBundle(
			capture({ groups: [{ label: 'Promises in view', kind: 'promise', records }] })
		);
		assert.equal(recordCount, BUNDLE_LIMITS.records);
		assert.equal(
			truncations.some((t) => t.includes(String(records.length))),
			true
		);
	});

	test('a long value is truncated, and the line says how long it really was', () => {
		const { truncations } = buildBundle(
			capture({
				groups: [
					{
						label: 'Promises in view',
						kind: 'promise',
						records: [promise({ tags: { blob: 'y'.repeat(9001) } })]
					}
				]
			})
		);
		assert.equal(truncations.length, 1);
		assert.match(truncations[0], /9001/);
		assert.match(truncations[0], /tags\.blob/);
	});

	// A hundred identical truncations would produce a bounds section longer than
	// the data it describes, which is a section nobody reads.
	test('identical truncations collapse to one line with a count', () => {
		const { truncations } = buildBundle(
			capture({
				groups: [
					{
						label: 'Promises in view',
						kind: 'promise',
						records: Array.from({ length: 6 }, (_, i) =>
							promise({ id: `step-${i}`, tags: { blob: 'y'.repeat(3000) } })
						)
					}
				]
			})
		);
		assert.equal(truncations.length, 1);
		assert.match(truncations[0], /6 values/);
		// Indices collapsed, so the path names the field rather than one row.
		assert.match(truncations[0], /\[\]\.tags\.blob/);
	});

	test('a structure nested past the depth limit is replaced and reported', () => {
		let deep = { end: 'bottom' };
		for (let i = 0; i < BUNDLE_LIMITS.depth + 4; i += 1) deep = { nest: deep };
		const { text, truncations } = buildBundle(
			capture({
				groups: [
					{ label: 'Promises in view', kind: 'promise', records: [promise({ tags: deep })] }
				]
			})
		);
		assert.equal(text.includes('bottom'), false);
		assert.equal(
			truncations.some((t) => t.includes('nested deeper')),
			true
		);
	});

	// Every per-field cap can pass while the document is still far too large to
	// paste, so the byte ceiling is enforced by rebuilding with fewer records —
	// never by slicing the finished string, which would end the document in half
	// a JSON record.
	test('the byte ceiling holds, by dropping whole records rather than cutting the text', () => {
		// Each record has to be fat enough that a hundred of them — the record cap,
		// which bites first — still overshoot the byte ceiling. An earlier version
		// of this test used one big field per record and never crossed the ceiling
		// at all, so it passed with the ceiling removed entirely.
		const wide = Object.fromEntries(
			Array.from({ length: 12 }, (_, i) => [`blob${i}`, 'z'.repeat(BUNDLE_LIMITS.string)])
		);
		const fat = Array.from({ length: 400 }, (_, i) => promise({ id: `step-${i}`, tags: wide }));
		assert.ok(
			BUNDLE_LIMITS.records * BUNDLE_LIMITS.string * 12 > BUNDLE_LIMITS.bytes,
			'the fixture must overshoot the ceiling even after the record cap applies'
		);
		const bundle = buildBundle(
			capture({ groups: [{ label: 'Promises in view', kind: 'promise', records: fat }] })
		);
		assert.ok(
			bundle.bytes <= BUNDLE_LIMITS.bytes,
			`${bundle.bytes} exceeds ${BUNDLE_LIMITS.bytes}`
		);
		assert.ok(bundle.recordCount < fat.length);
		assert.equal(
			bundle.truncations.some((t) => t.includes(String(fat.length))),
			true
		);
		// The document must still parse as a whole: the last section is present,
		// which it would not be if the text had been sliced to fit.
		assert.match(bundle.text, /## What this bundle left out/);
	});

	// Without this, an empty bounds section is ambiguous: did nothing get cut,
	// or did the reporting fail? The operator needs to be able to trust silence.
	test('a bundle that cut nothing says so out loud', () => {
		const { text, truncations, redactions } = buildBundle(capture());
		assert.deepEqual(truncations, []);
		assert.deepEqual(redactions, []);
		assert.match(text, /Nothing\. Every record rendered in this view is included in full/);
	});
});

describe('the bundle is readable to a model that has never seen Resonate', () => {
	test('the schema note is in every bundle', () => {
		assert.equal(buildBundle(capture()).text.includes(SCHEMA_NOTE), true);
	});

	// The five states are five on purpose, and a bundle that let an assistant
	// collapse the three rejections into "failed" would undo the distinction the
	// UI was deliberately built to keep.
	test('the schema note keeps the three rejection states apart', () => {
		for (const state of ['rejected_canceled', 'rejected_timedout']) {
			assert.equal(SCHEMA_NOTE.includes(state), true);
		}
		assert.match(SCHEMA_NOTE, /Do not collapse/);
	});

	test('records go in raw — an absent settledAt stays absent rather than becoming null', () => {
		const pending = promise({ id: 'waiting', state: 'pending' });
		delete pending.settledAt;
		const { text } = buildBundle(
			capture({ groups: [{ label: 'Promises in view', kind: 'promise', records: [pending] }] })
		);
		// Quoted, because the schema note discusses `settledAt` by name — only a
		// JSON key would be rendered with quotes.
		assert.equal(text.includes('"settledAt"'), false);
		assert.equal(text.includes('"state": "pending"'), true);
	});

	test('base64 payloads get a decoded copy, because eyJ... orients nobody', () => {
		const { text } = buildBundle(
			capture({
				groups: [
					{
						label: 'Promises in view',
						kind: 'promise',
						records: [promise({ value: { data: b64('{"error":"connection refused"}') } })]
					}
				]
			})
		);
		assert.match(text, /connection refused/);
		// And the raw form survives alongside it — the shape is itself evidence.
		assert.match(text, /"data": "eyJ/);
	});

	test('the selection is called out separately from the records', () => {
		const chosen = promise({ id: 'the-clicked-one' });
		const { text } = buildBundle(
			capture({
				selection: { label: 'the promise `the-clicked-one`', record: chosen },
				groups: [{ label: 'Promises in view', kind: 'promise', records: [promise(), chosen] }]
			})
		);
		assert.match(text, /## Selection/);
		assert.match(text, /the operator has the promise `the-clicked-one` selected/i);
	});

	test('hasPayload is false when there is nothing but metadata', () => {
		const bare = promise({ param: {}, value: {} });
		assert.equal(
			buildBundle(capture({ groups: [{ label: 'p', kind: 'promise', records: [bare] }] }))
				.hasPayload,
			false
		);
		assert.equal(buildBundle(capture()).hasPayload, true);
	});
});

describe('decodePayload — readable text only', () => {
	test('valid UTF-8 JSON comes back pretty-printed inside a bundle', () => {
		assert.equal(decodePayload(b64('{"a":1}')), '{"a":1}');
	});

	test('multi-byte characters survive, which `atob` alone would mangle', () => {
		assert.equal(decodePayload(b64('café — 🎉')), 'café — 🎉');
	});

	// A payload can be perfectly valid base64 *and* valid UTF-8 and still not be
	// text. Pasting a protobuf into a chat window helps nobody, and the raw
	// base64 is already in the record above the appendix.
	test('binary that happens to decode is refused rather than pasted', () => {
		const binary = Buffer.from([0x00, 0x01, 0x02, 0x7f, 0x03]).toString('base64');
		assert.equal(decodePayload(binary), null);
	});

	test('tabs and newlines are text, not control characters to refuse', () => {
		assert.equal(decodePayload(b64('one\ttwo\nthree')), 'one\ttwo\nthree');
	});

	test('invalid base64 is refused rather than returned as garbage', () => {
		// Deliberately unlike `client.ts:decodeValue`, which returns the raw
		// bytes so the operator sees what is really there. Here the raw form is
		// already in the bundle, so a second unreadable copy is only noise.
		assert.equal(decodePayload('!!!not base64!!!'), null);
	});
});

describe('treeOutline — the relation a flat list cannot carry', () => {
	const node = (id, state, children = [], missing = false) => ({
		promise: { id, state },
		children,
		...(missing ? { missing: true } : {})
	});

	test('nesting is preserved, and only ids and states come along', () => {
		const tree = node('root', 'pending', [
			node('a', 'resolved'),
			node('b', 'rejected', [node('b1', 'rejected_timedout')])
		]);
		assert.deepEqual(treeOutline(tree), {
			id: 'root',
			state: 'pending',
			children: [
				{ id: 'a', state: 'resolved' },
				{
					id: 'b',
					state: 'rejected',
					children: [{ id: 'b1', state: 'rejected_timedout' }]
				}
			]
		});
	});

	// A missing node is a placeholder for a promise the search did not return.
	// Its state is not a fact, and an assistant told otherwise will diagnose a
	// step that may never have existed.
	test('a missing node stays marked as missing', () => {
		const outline = treeOutline(node('root', 'pending', [node('ghost', 'pending', [], true)]));
		assert.equal(outline.children[0].missing, true);
	});

	test('a leaf has no children key at all, rather than an empty array', () => {
		assert.deepEqual(treeOutline(node('solo', 'resolved')), { id: 'solo', state: 'resolved' });
	});

	test('the outline reaches the bundle when a view supplies one', () => {
		const tree = node('root', 'pending', [node('child', 'resolved')]);
		const { text } = buildBundle(
			capture({
				structure: {
					label: 'Workflow structure',
					description: 'The parent/child tree.',
					value: treeOutline(tree)
				}
			})
		);
		assert.match(text, /## Workflow structure/);
		assert.match(text, /"id": "child"/);
	});
});
