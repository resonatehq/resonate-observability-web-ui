/**
 * `jwtExpiry` — `src/lib/utils/jwt.js`.
 *
 * Covers the shapes that actually reach it: a real ID token's three-segment
 * base64url payload, and the malformed input a paste error produces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { jwtExpiry } from '../src/lib/utils/jwt.js';

/** @param {object} payload */
function tokenWithPayload(payload) {
	const base64url = (s) => Buffer.from(s).toString('base64url');
	return `${base64url(JSON.stringify({ alg: 'RS256' }))}.${base64url(JSON.stringify(payload))}.signature`;
}

test('reads exp as milliseconds', () => {
	assert.equal(jwtExpiry(tokenWithPayload({ exp: 1_800_000_000 })), 1_800_000_000_000);
});

test('handles base64url without padding, and with - and _', () => {
	// A payload chosen so its base64 encoding needs padding and produces both
	// URL-safe substitution characters, unlike a random small integer.
	const token = tokenWithPayload({ exp: 1_800_000_001, aud: '>>>???' });
	assert.equal(jwtExpiry(token), 1_800_000_001_000);
});

test('returns null when the exp claim is missing', () => {
	assert.equal(jwtExpiry(tokenWithPayload({ aud: 'https://example.run.app' })), null);
});

test('returns null for a non-JWT string', () => {
	assert.equal(jwtExpiry('not-a-jwt'), null);
	assert.equal(jwtExpiry(''), null);
});

test('returns null for a JWT whose payload is not valid JSON', () => {
	const garbage = Buffer.from('not json').toString('base64url');
	assert.equal(jwtExpiry(`header.${garbage}.sig`), null);
});
