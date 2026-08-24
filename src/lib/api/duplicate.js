/**
 * Duplicate detection for `schedule.create`, kept separate from the client.
 *
 * `schedule.create` on an id that already exists returns **200 with the
 * existing record** (src/oracle.rs:1488-1527) — no conflict, no update. The
 * submission is silently discarded, so an operator who does not read the
 * returned record closely believes they created a schedule they did not, and
 * may then wait on somebody else's cron. Comparing the echo against what went
 * out is the only way to tell the two 200s apart without trusting a clock.
 *
 * This lives in its own `.js` module, like `utils/cron.js`, for one concrete
 * reason: `client.ts` imports `$lib/stores/connection.svelte`, and the runes in
 * it cannot be loaded by `node --test`. Anything importing the client is
 * therefore untestable by this repo's harness. Pure comparison logic here is
 * directly testable — see `mocks/duplicate.test.mjs` — and `checkJs` is on, so
 * the JSDoc types below are enforced exactly as TypeScript would be.
 *
 * ── Verified against a live server, not read off the source ──
 * `resonate 0.9.8`, sqlite, four fresh creates. On a **successful** create the
 * server echoes `promiseParam` and `promiseTags` back byte-identical: `{}`
 * stays `{}` (no `headers` added, no empty `data` added), `{data}` stays
 * `{data}`, and `promiseTimeout` comes back a number. It does **not** normalise
 * an echoed field, which is the failure this comparison would otherwise turn
 * into a false "that id already exists — nothing was created."
 *
 * It does reorder keys: `{headers, data}` is echoed as `{data, headers}`. That
 * is why the comparison is key-order-insensitive rather than a `JSON.stringify`
 * of each side — the cheap version reports every param carrying two keys as a
 * duplicate. `mocks/duplicate.test.mjs` pins both observations.
 */

/**
 * The subset of a create that is compared. Deliberately not the full
 * `CreateScheduleParams`: `id` is excluded because it is the join key — it
 * matches by definition in the duplicate case and carries no signal.
 *
 * @typedef {object} ScheduleCreatePayload
 * @property {string} id
 * @property {string} cron
 * @property {string} promiseId
 * @property {number} promiseTimeout
 * @property {{headers?: Record<string, string>, data?: string}} promiseParam
 * @property {Record<string, string>} promiseTags
 */

/**
 * Builds the wire payload, with the optional fields defaulted.
 *
 * The point of building it here is that the comparison below receives *this
 * object* rather than the caller's params — so the defaults applied on the way
 * out and the values checked on the way back cannot drift apart. When they were
 * written twice, a change to either `?? {}` silently broke detection.
 *
 * @param {{id: string, cron: string, promiseId: string, promiseTimeout: number,
 *          promiseParam?: {headers?: Record<string, string>, data?: string},
 *          promiseTags?: Record<string, string>}} params
 * @returns {ScheduleCreatePayload}
 */
export function scheduleCreatePayload(params) {
	return {
		id: params.id,
		cron: params.cron,
		promiseId: params.promiseId,
		promiseTimeout: params.promiseTimeout,
		promiseParam: params.promiseParam ?? {},
		promiseTags: params.promiseTags ?? {}
	};
}

/**
 * True when the record the server returned is not the one that was submitted —
 * i.e. the id already existed and this create did nothing.
 *
 * All five submitted fields are compared, not just the cron and the promise id.
 * The server discards the whole submission, so a resubmission that keeps the
 * cron and template but changes the timeout, the param or the target tag is
 * just as much a silent no-op — and those are the likelier edits, since "same
 * schedule, new target" is how someone tries to repoint one.
 *
 * Limit worth knowing: resubmitting an id whose record is identical in every
 * one of those fields is indistinguishable from a fresh create. `createdAt`
 * would tell us, but only by trusting the browser clock against the server's,
 * and a skewed clock would then report false duplicates on genuine creates. The
 * undetectable case is the benign one — the schedule that exists is the
 * schedule that was asked for — so this trades it for not lying in the other
 * direction.
 *
 * @param {ScheduleCreatePayload} sent
 * @param {{cron: string, promiseId: string, promiseTimeout: number,
 *          promiseParam: {headers?: Record<string, string>, data?: string},
 *          promiseTags: Record<string, string>}} returned
 * @returns {boolean}
 */
export function isDuplicateEcho(sent, returned) {
	return (
		returned.cron !== sent.cron ||
		returned.promiseId !== sent.promiseId ||
		returned.promiseTimeout !== sent.promiseTimeout ||
		!sameJson(returned.promiseParam, sent.promiseParam) ||
		!sameJson(returned.promiseTags, sent.promiseTags)
	);
}

/**
 * Key-order-insensitive structural comparison, for diffing a record the server
 * echoed back against the one that went out. `JSON.stringify` alone would
 * report a difference purely from key ordering — which the server does produce.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sameJson(a, b) {
	if (a === b) return true;
	if (typeof a !== typeof b || a === null || b === null) return false;
	if (typeof a !== 'object') return false;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, i) => sameJson(item, b[i]));
	}

	const left = /** @type {Record<string, unknown>} */ (a);
	const right = /** @type {Record<string, unknown>} */ (b);
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((k) => Object.hasOwn(right, k) && sameJson(left[k], right[k]));
}
