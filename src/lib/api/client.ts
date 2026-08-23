/**
 * Client for the Resonate server's envelope protocol.
 *
 * Every request is a `POST /` carrying `{kind, head, data}`. The browser calls
 * the operator's server directly — there is no proxy hop — so the operator must
 * either serve this UI same-origin or start their server with
 * `--server-cors-allow-origin <this origin>`.
 *
 * Shapes here mirror `resonatehq/resonate` and are exercised by the fixture in
 * `mocks/`. If you change one, run `npm test`.
 */

import { connectionStore } from '$lib/stores/connection.svelte';

/** The only protocol version the server accepts (src/types.rs:133-135). */
export const PROTOCOL_VERSION = '2026-04-01';

/**
 * The five promise states, snake_case (src/types.rs:11-20).
 *
 * `rejected`, `rejected_canceled` and `rejected_timedout` are three different
 * incidents — a failure, somebody's decision, and a deadline — and the UI is
 * expected to keep them apart rather than collapsing them into "failed".
 */
export const PROMISE_STATES = [
	'pending',
	'resolved',
	'rejected',
	'rejected_canceled',
	'rejected_timedout'
] as const;

export type PromiseState = (typeof PROMISE_STATES)[number];

export function isPromiseState(value: string): value is PromiseState {
	return (PROMISE_STATES as readonly string[]).includes(value);
}

export interface PromiseValue {
	headers?: Record<string, string>;
	/** base64-encoded. Use `decodeValue` — never render this directly. */
	data?: string;
}

/** src/types.rs:211-224. */
export interface PromiseRecord {
	id: string;
	state: PromiseState;
	/** Always present — no longer optional server-side. */
	param: PromiseValue;
	value: PromiseValue;
	tags: Record<string, string>;
	timeoutAt: number;
	createdAt: number;
	/** Absent entirely while pending — the key is missing, not null. */
	settledAt?: number;
}

/** src/types.rs:239-257. Shares almost no field names with the old REST shape. */
export interface ScheduleRecord {
	id: string;
	cron: string;
	promiseId: string;
	promiseTimeout: number;
	promiseParam: PromiseValue;
	promiseTags: Record<string, string>;
	createdAt: number;
	nextRunAt: number;
	/** Absent until the schedule has run at least once. */
	lastRunAt?: number;
}

interface ResponseEnvelope<T> {
	kind: string;
	head: { corrId: string; status: number; version: string };
	/** An object on success; a bare string on every error (src/types.rs:836-838). */
	data: T | string;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * The failure kinds the UI must tell apart. Before the port every one of these
 * rendered as the same red `API returned {status}: {body}` div, which told the
 * operator nothing about what to do next.
 */
export type ApiErrorKind =
	| 'unreachable' // no HTTP response at all — usually CORS, sometimes a wrong URL
	| 'unauthorized' // 401: missing, malformed or expired token
	| 'forbidden' // 403: token is valid but not scoped for this
	| 'not_found' // 404
	| 'bad_request' // 400, including protocol-version mismatch
	| 'server_error' // 5xx
	| 'unknown';

export class ApiError extends Error {
	readonly kind: ApiErrorKind;
	readonly status: number | null;
	/** Operator-facing next step. Empty when there is nothing useful to say. */
	readonly remedy: string;

	constructor(kind: ApiErrorKind, message: string, status: number | null, remedy = '') {
		super(message);
		this.name = 'ApiError';
		this.kind = kind;
		this.status = status;
		this.remedy = remedy;
	}
}

/**
 * A browser fetch that never reaches the server throws a bare TypeError with no
 * status — a blocked CORS preflight is indistinguishable from a dead host at
 * this layer. Since the server ships with CORS *off*, that is overwhelmingly
 * the cause, so the message names the exact flag rather than guessing.
 */
function unreachable(serverUrl: string, cause: unknown): ApiError {
	const origin = typeof location !== 'undefined' ? location.origin : '<this UI\'s origin>';
	return new ApiError(
		'unreachable',
		`Could not reach the Resonate server at ${serverUrl}.`,
		null,
		`If the server is running, it is probably not allowing requests from this page. ` +
			`Restart it with:\n\n    resonate serve --server-cors-allow-origin ${origin}\n\n` +
			`Otherwise check the URL in Settings. (${cause instanceof Error ? cause.message : String(cause)})`
	);
}

function errorFor(status: number, message: string): ApiError {
	switch (status) {
		case 401:
			return new ApiError(
				'unauthorized',
				'The server rejected this token.',
				status,
				'The token must be a JWT carrying an `exp` claim, and it goes in the request ' +
					'body — an Authorization header is ignored. An expired or malformed token ' +
					'looks identical to a missing one from here. Check the token in Settings.'
			);
		case 403:
			return new ApiError(
				'forbidden',
				'This token is not permitted to do that.',
				status,
				// Worth being specific: a prefix-scoped token authorises searches
				// against an empty string, so it cannot list anything at all.
				'A prefix-scoped token cannot run searches — it can only fetch promises ' +
					'under its own prefix. This UI needs a token with `role: "admin"` or an ' +
					'empty `prefix` claim.'
			);
		case 404:
			return new ApiError('not_found', message || 'Not found.', status);
		case 400:
			return new ApiError(
				'bad_request',
				message || 'The server rejected the request.',
				status,
				message.includes('protocol version')
					? `This UI speaks protocol ${PROTOCOL_VERSION}. The server expects a different ` +
						`version, so one of the two needs updating.`
					: ''
			);
		default:
			if (status >= 500) {
				return new ApiError('server_error', message || 'The server failed.', status);
			}
			return new ApiError('unknown', message || `Request failed (${status}).`, status);
	}
}

// ─── Transport ───────────────────────────────────────────────────────────────

let corrCounter = 0;

/**
 * Correlation id. The server only echoes it back — it does not parse it or
 * require uniqueness — so this just needs to be distinct enough to match a
 * response to a request in the network log.
 */
function nextCorrId(): string {
	corrCounter += 1;
	return `ui-${Date.now().toString(36)}-${corrCounter}`;
}

async function rpc<T>(kind: string, data: Record<string, unknown>): globalThis.Promise<T> {
	const serverUrl = connectionStore.url.replace(/\/+$/, '') || '';
	const head: Record<string, unknown> = { corrId: nextCorrId(), version: PROTOCOL_VERSION };
	// The token travels in the envelope, not a header (src/auth.rs:120). Sending
	// it as `Authorization: Bearer` — as this client used to — is a silent no-op.
	if (connectionStore.token) head.auth = connectionStore.token;

	let resp: Response;
	try {
		resp = await fetch(`${serverUrl}/`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind, head, data })
		});
	} catch (cause) {
		throw unreachable(serverUrl, cause);
	}

	let body: ResponseEnvelope<T>;
	try {
		body = await resp.json();
	} catch {
		throw new ApiError(
			'unknown',
			`The server returned a ${resp.status} that was not a protocol envelope.`,
			resp.status,
			'Check that the URL points at a Resonate server and not something else.'
		);
	}

	// The HTTP status mirrors head.status (src/server.rs:146-150), so either is
	// authoritative; head.status is preferred because it survives a proxy.
	const status = body?.head?.status ?? resp.status;
	if (status >= 400) {
		throw errorFor(status, typeof body?.data === 'string' ? body.data : '');
	}
	return body.data as T;
}

// ─── Operations ──────────────────────────────────────────────────────────────

/**
 * src/types.rs:382-389 — the complete set of search parameters.
 *
 * There is deliberately no `id` and no sort: the server has neither, and passing
 * them is *silently ignored* rather than rejected, which is how the old wildcard
 * search boxes appeared to work while returning everything.
 */
export interface SearchPromisesParams {
	state?: PromiseState;
	tags?: Record<string, string>;
	limit?: number;
	cursor?: string;
}

export interface SearchPromisesResult {
	promises: PromiseRecord[];
	/** Absent on the last page — that absence is the termination signal. */
	cursor?: string;
}

export function searchPromises(
	params: SearchPromisesParams = {}
): globalThis.Promise<SearchPromisesResult> {
	return rpc<SearchPromisesResult>('promise.search', { ...params });
}

export async function getPromise(id: string): globalThis.Promise<PromiseRecord> {
	const data = await rpc<{ promise: PromiseRecord }>('promise.get', { id });
	return data.promise;
}

export interface SearchSchedulesResult {
	schedules: ScheduleRecord[];
	cursor?: string;
}

/** src/types.rs:654-660 — tags, limit and cursor only. No state, no id. */
export function searchSchedules(
	params: { tags?: Record<string, string>; limit?: number; cursor?: string } = {}
): globalThis.Promise<SearchSchedulesResult> {
	return rpc<SearchSchedulesResult>('schedule.search', { ...params });
}

export async function getSchedule(id: string): globalThis.Promise<ScheduleRecord> {
	const data = await rpc<{ schedule: ScheduleRecord }>('schedule.get', { id });
	return data.schedule;
}

/**
 * src/types.rs:615-632.
 *
 * `promiseTimeout` has no serde default and is therefore REQUIRED — omitting
 * it fails deserialization with `missing field promiseTimeout`, not a
 * defaulted zero. `promiseParam` and `promiseTags` do default.
 */
export interface CreateScheduleParams {
	id: string;
	cron: string;
	promiseId: string;
	promiseTimeout: number;
	promiseParam?: PromiseValue;
	promiseTags?: Record<string, string>;
}

/**
 * The outcome of a create, with the duplicate case called out separately.
 *
 * `schedule.create` is not idempotent-with-update and it is not a conflict
 * error: given an id that already exists the server returns **200 with the
 * pre-existing record untouched** (src/oracle.rs:1501-1508), discarding
 * everything that was just submitted. Nothing in the envelope marks this as
 * different from a successful create, so the only way to detect it is to
 * compare the record that came back against what went out — which is what
 * `duplicate` reports. Without that check the UI cheerfully reports success
 * for a schedule it did not create, running on somebody else's cron.
 *
 * All five submitted fields are compared, not just the cron and the promise
 * id. The server discards the whole submission, so a resubmission that keeps
 * the cron and template but changes the timeout, the param or the target tag
 * is just as much a silent no-op — and those are the likelier edits, since
 * "same schedule, new target" is how someone tries to repoint one. Comparing
 * them costs nothing and needs no clock.
 *
 * Limit worth knowing: resubmitting an id with a record identical in every
 * one of those fields is indistinguishable from a fresh create. `createdAt`
 * would tell us, but only by trusting the browser clock against the server's,
 * and a skewed clock would then report false duplicates on genuine creates.
 * The undetectable case is the benign one — the schedule that exists is the
 * schedule that was asked for — so this trades it for not lying in the other
 * direction.
 */
export interface CreateScheduleOutcome {
	schedule: ScheduleRecord;
	duplicate: boolean;
}

export async function createSchedule(
	params: CreateScheduleParams
): globalThis.Promise<CreateScheduleOutcome> {
	const data = await rpc<{ schedule: ScheduleRecord }>('schedule.create', {
		id: params.id,
		cron: params.cron,
		promiseId: params.promiseId,
		promiseTimeout: params.promiseTimeout,
		promiseParam: params.promiseParam ?? {},
		promiseTags: params.promiseTags ?? {}
	});

	const returned = data.schedule;
	const duplicate =
		returned.cron !== params.cron ||
		returned.promiseId !== params.promiseId ||
		returned.promiseTimeout !== params.promiseTimeout ||
		!sameJson(returned.promiseParam, params.promiseParam ?? {}) ||
		!sameJson(returned.promiseTags, params.promiseTags ?? {});

	return { schedule: returned, duplicate };
}

/**
 * Key-order-insensitive structural comparison, for diffing a record the server
 * echoed back against the one that went out. `JSON.stringify` alone would
 * report a difference purely from key ordering.
 */
function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b || a === null || b === null) return false;
	if (typeof a !== 'object') return false;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, i) => sameJson(item, b[i]));
	}

	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((k) => Object.hasOwn(right, k) && sameJson(left[k], right[k]));
}

/**
 * Probes reachability without needing a valid token: `/health` is the server's
 * only unauthenticated GET (src/server.rs:102-104).
 *
 * A browser cannot distinguish "host is down" from "CORS is not configured" —
 * both surface as a bare TypeError — so this reports reachability, not the
 * reason for unreachability.
 */
export async function testConnection(
	url: string
): globalThis.Promise<{ ok: boolean; detail: string }> {
	const base = url.replace(/\/+$/, '');
	try {
		const resp = await fetch(`${base}/health`);
		if (!resp.ok) {
			return { ok: false, detail: `The server answered ${resp.status} at ${base}/health.` };
		}
	} catch {
		return {
			ok: false,
			detail:
				`Could not reach ${base}. Either nothing is listening there, or the server is ` +
				`running without CORS enabled for this page.`
		};
	}
	// Reachable. Now check the protocol actually works, which also exercises the
	// token — the likeliest second point of failure.
	try {
		await searchPromises({ limit: 1 });
		return { ok: true, detail: 'Connected. The server answered a promise search.' };
	} catch (e) {
		const err = e as ApiError;
		return { ok: false, detail: `${base} is reachable, but: ${err.message}` };
	}
}

// ─── Payload decoding ────────────────────────────────────────────────────────

/**
 * Decodes a base64 `PromiseValue.data`. One shared implementation because the
 * two detail routes disagreed: `workflows/[id]` decoded, `promises/[id]` did
 * not, so promise detail rendered raw base64 at the user.
 *
 * Returns the decoded text, or null when there is nothing to decode. Invalid
 * base64 is returned verbatim rather than swallowed — showing the operator the
 * bytes that are actually there beats showing them nothing.
 */
export function decodeValue(value: PromiseValue | undefined): string | null {
	if (!value?.data) return null;
	try {
		const binary = atob(value.data);
		return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
	} catch {
		return value.data;
	}
}

/**
 * The inverse of `decodeValue`, for the one place the UI sends a payload
 * rather than reading one.
 *
 * `PromiseValue` is `{headers?, data?}` where `data` is base64 — it is not a
 * free-form JSON object, and a schedule created with a bare object as its
 * param is accepted by the server with a 200 and stored with `promiseParam`
 * emptied to `{}`. The payload is gone, nothing reports it, and the operator
 * is told the schedule was created.
 *
 * Bytes go through `TextEncoder` rather than straight into `btoa`, which is
 * latin1-only and throws on the first accented character or emoji in a
 * customer payload.
 */
export function encodeValue(text: string): PromiseValue {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return { data: btoa(binary) };
}

/** Decodes and pretty-prints JSON payloads, falling back to the raw text. */
export function decodeValueAsJson(value: PromiseValue | undefined): string | null {
	const decoded = decodeValue(value);
	if (decoded === null) return null;
	try {
		return JSON.stringify(JSON.parse(decoded), null, 2);
	} catch {
		return decoded;
	}
}
