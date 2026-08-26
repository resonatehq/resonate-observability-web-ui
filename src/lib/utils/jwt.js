/**
 * Reads the `exp` claim off a JWT without verifying it — used to warn an
 * operator that their Cloud Run identity token is about to lapse.
 *
 * A Google identity token is a signed assertion, not a secret, so decoding
 * its payload client-side is safe. What is never safe is logging or
 * displaying the token itself; callers must not do that.
 *
 * Plain `.js` with JSDoc, like `cron.js` and `duplicate.js`, so `node --test`
 * can reach it directly — `checkJs` in tsconfig.json enforces the types below
 * exactly as TypeScript would.
 */

/**
 * @param {string} token
 * @returns {number | null} Milliseconds since epoch the token expires at, or
 *   null if the token isn't a JWT or carries no `exp` claim.
 */
export function jwtExpiry(token) {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
		const payload = JSON.parse(atob(padded));
		if (typeof payload.exp !== 'number') return null;
		return payload.exp * 1000;
	} catch {
		return null;
	}
}
