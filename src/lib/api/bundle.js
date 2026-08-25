/**
 * The "Ask AI" context bundle — what the operator is looking at, as text an
 * assistant can read.
 *
 * The premise is that this console should not compete with an AI, it should be
 * a *sensor* for one. Since the envelope-protocol port every view already
 * renders from structured records, so "what is on screen" is machine-readable
 * without screenshots or DOM scraping. This module turns a view's live state
 * into one bounded, redacted, self-describing document.
 *
 * ── Three properties this file exists to guarantee ──
 *
 * **It never touches the network and never carries a credential.** The bundle
 * is assembled from in-memory records and handed to the clipboard. That is what
 * makes it work on the air-gapped and on-prem installs this UI is built for,
 * and it is why the feature ships without a backend. The auth token is not
 * merely omitted — every string it appears in is scrubbed, along with anything
 * JWT-shaped and any field named like a credential, because a promise param is
 * operator-supplied and can contain anything. There is no filesystem access
 * here at all, so there is no local data to leak into a bundle.
 *
 * **It says when it left something out.** Every cap below is reported in the
 * bundle itself. A silent truncation reads as "you have everything" when you do
 * not, which is worse than a small bundle: an assistant reasoning over a
 * silently-clipped subtree will state a confident conclusion about promises it
 * never saw.
 *
 * **It stays readable to a model that has never seen Resonate.** Raw records
 * are included verbatim — key order, absent keys and all — because their shape
 * is itself evidence. `SCHEMA_NOTE` orients a reader who has no other context,
 * and base64 payloads get a decoded appendix, since `eyJ...` tells a model
 * nothing about why a workflow failed.
 *
 * Pure and dependency-free, in `.js` with JSDoc for the same reason as
 * `utils/cron.js` and `api/duplicate.js`: `client.ts` imports runes that
 * `node --test` cannot load, so anything reaching through it is untestable by
 * this repo's harness. `checkJs` is on, so the types below are enforced exactly
 * as TypeScript would enforce them. Tests: `mocks/bundle.test.mjs`.
 */

/**
 * Bounds. Generous enough that an ordinary view is captured whole, small enough
 * that no bundle can blow past a chat context window.
 *
 * `bytes` is the one that actually binds in practice: a workflow with a hundred
 * nodes carrying real payloads passes every per-field cap and still produces a
 * document nobody can paste anywhere.
 */
export const BUNDLE_LIMITS = {
	/** Records kept per group before the tail is dropped. */
	records: 100,
	/** Longest string kept anywhere in a raw record. */
	string: 2048,
	/** Longest decoded payload kept in the appendix. */
	decoded: 4096,
	/** Records that get a decoded payload. Decoding is for reading, not for bulk. */
	decodedRecords: 20,
	/** Structural depth before a subtree is replaced by a marker. */
	depth: 12,
	/** Whole-document ceiling, ~256 KB. */
	bytes: 262144
};

/**
 * One line per idea, because it is prepended to every bundle and the operator
 * pays for it in context window on every paste.
 */
export const SCHEMA_NOTE = `This is a capture from the Resonate observability console. Resonate is a durable-execution
server; its unit of work is a **durable promise** — a record that survives process restarts and
is settled exactly once.

- A promise record is \`{id, state, param, value, tags, timeoutAt, createdAt, settledAt?}\`.
- \`state\` is one of five, and they are five on purpose: \`pending\`, \`resolved\`, \`rejected\`
  (it failed), \`rejected_canceled\` (somebody stopped it) and \`rejected_timedout\` (a deadline
  passed). Do not collapse the last three into "failed" — which one it is, is the diagnosis.
- \`param\` is the input and \`value\` is the outcome; both are \`{headers?, data?}\` where \`data\`
  is **base64**. Decoded copies are in the Payloads section below where they were readable.
- \`settledAt\` is **absent**, not null, while a promise is pending. Timestamps are epoch
  milliseconds.
- Workflows are not a separate record type: a workflow is a root promise, and its steps are
  promises whose \`tags\` carry the parent id. A "tree" here is that parent/child relation.
- A schedule record is \`{id, cron, promiseId, promiseTimeout, promiseParam, promiseTags,
  createdAt, nextRunAt, lastRunAt?}\` and creates a new promise on each fire.`;

/**
 * Field names whose values are replaced wholesale. Deliberately narrow: this
 * fires on names that are credentials and essentially nothing else, because
 * over-redaction hides the payload the operator is asking for help with. A
 * broad `/token|key|secret/` would eat `idempotencyKey`, `tokenCount` and
 * `partitionKey`, and the operator would never know why the assistant was
 * confused.
 */
const SECRET_KEY_PATTERNS = [
	/^(authorization|proxy-authorization|cookie|set-cookie)$/i,
	/(^|[-_.])(password|passwd|secret|credentials?)([-_.]|$)/i,
	/(^|[-_.])(api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|session[-_]?token|security[-_]?token|private[-_]?key|client[-_]?secret)([-_.]|$)/i
];

/**
 * A three-segment JWT. The console's own token is scrubbed by exact value, but
 * this catches a *different* token pasted into a promise param, and the console
 * token after the operator has rotated it.
 *
 * Base64 payloads cannot collide with this: standard base64 has no `.`, and
 * this requires two of them separating three base64url runs.
 */
const JWT_SHAPE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g;

/**
 * Separates a path from its reason in the tally keys below, so two redactions
 * of one field for different reasons stay distinct and the reason does not end
 * up inside the code span when the line is rendered.
 */
const TALLY_SEP = '\u0000';

/**
 * @typedef {object} RecordGroup
 * @property {string} label     Heading for the section, e.g. `Promises in view`.
 * @property {string} kind      What these are, for the heading, e.g. `promise`.
 * @property {unknown[]} records Raw records exactly as the server returned them.
 */

/**
 * @typedef {object} CaptureInput
 * @property {string} view       Human name of the view, e.g. `Workflow detail`.
 * @property {string} path       The actual path, e.g. `/workflows/order-42`.
 * @property {Record<string, unknown>} viewState Filters, tab, pagination — what the user set.
 * @property {string} serverUrl  Which Resonate server this came from.
 * @property {string} capturedAt ISO 8601 timestamp.
 * @property {RecordGroup[]} groups
 * @property {{label: string, record: unknown} | null} [selection] The clicked row/node, if any.
 * @property {string[]} [notes]  View-specific lines worth telling a reader.
 * @property {{label: string, description: string, value: unknown} | null} [structure]
 *   Shape the flat record lists cannot carry — a workflow's parent/child tree, say.
 * @property {string[]} [secrets] Exact strings to scrub — in practice the auth token.
 */

/**
 * @typedef {object} Bundle
 * @property {string} text        The document itself.
 * @property {number} recordCount Records actually included.
 * @property {boolean} hasPayload Whether any included record carries payload bytes.
 * @property {string[]} truncations Human lines, one per cap that bound.
 * @property {string[]} redactions  Human lines, one per redaction that fired.
 * @property {number} bytes       UTF-8 size of `text`.
 */

/**
 * Strips userinfo from a URL so `https://ops:hunter2@resonate.internal` does not
 * travel in a document destined for someone else's chat history. Anything that
 * does not parse is returned as-is rather than dropped — a malformed server URL
 * is worth seeing, and it cannot contain a password we would be leaking.
 *
 * @param {string} url
 * @returns {{url: string, redacted: boolean}}
 */
export function sanitizeServerUrl(url) {
	try {
		const parsed = new URL(url);
		if (!parsed.username && !parsed.password) return { url, redacted: false };
		parsed.username = '';
		parsed.password = '';
		return { url: parsed.toString(), redacted: true };
	} catch {
		return { url, redacted: false };
	}
}

/**
 * Collapses `promises[3].value.data` to `promises[].value.data` so a hundred
 * identical truncations report as one line with a count. The alternative is a
 * bounds section longer than the data it describes, which nobody reads.
 *
 * @param {string} path
 * @returns {string}
 */
function shape(path) {
	return path.replace(/\[\d+\]/g, '[]');
}

/**
 * Walks a record and returns a sanitized clone, recording every cap that bound
 * and every redaction that fired.
 *
 * Written as a factory rather than a recursive function with an accumulator
 * argument so the tallies cannot be forgotten at a call site — every scrub in
 * one bundle shares one set of counters, and the report is built from those.
 *
 * @param {string[]} secrets
 */
function createScrubber(secrets) {
	/** @type {Map<string, {count: number, largest: number}>} */
	const truncated = new Map();
	/** @type {Map<string, number>} */
	const redacted = new Map();
	/** @type {Map<string, number>} */
	const dropped = new Map();
	let sawPayload = false;

	/** Non-empty strings only: scrubbing on `''` would replace every gap. */
	const live = secrets.filter((s) => typeof s === 'string' && s.length > 0);

	/**
	 * @param {string} text
	 * @param {string} path
	 * @returns {string}
	 */
	function scrubText(text, path) {
		let out = text;
		for (const secret of live) {
			if (out.includes(secret)) {
				out = out.split(secret).join('«redacted: this console\'s auth token»');
				bump(redacted, `${shape(path)}${TALLY_SEP}it contained this console's auth token`);
			}
		}
		if (JWT_SHAPE.test(out)) {
			JWT_SHAPE.lastIndex = 0;
			out = out.replace(JWT_SHAPE, '«redacted: JWT»');
			bump(redacted, `${shape(path)}${TALLY_SEP}it contained a JWT`);
		}
		JWT_SHAPE.lastIndex = 0;

		if (out.length > BUNDLE_LIMITS.string) {
			const entry = truncated.get(shape(path)) ?? { count: 0, largest: 0 };
			entry.count += 1;
			entry.largest = Math.max(entry.largest, out.length);
			truncated.set(shape(path), entry);
			out = `${out.slice(0, BUNDLE_LIMITS.string)}…«truncated, ${out.length} chars total»`;
		}
		return out;
	}

	/**
	 * @param {unknown} value
	 * @param {string} path
	 * @param {number} depth
	 * @returns {unknown}
	 */
	function walk(value, path, depth) {
		if (value === null || typeof value !== 'object') {
			return typeof value === 'string' ? scrubText(value, path) : value;
		}
		if (depth >= BUNDLE_LIMITS.depth) {
			bump(dropped, `${shape(path)}${TALLY_SEP}nested deeper than ${BUNDLE_LIMITS.depth} levels`);
			return '«omitted: too deeply nested»';
		}
		if (Array.isArray(value)) {
			return value.map((item, i) => walk(item, `${path}[${i}]`, depth + 1));
		}

		/** @type {Record<string, unknown>} */
		const out = {};
		for (const [key, child] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
			const childPath = path ? `${path}.${key}` : key;
			if (SECRET_KEY_PATTERNS.some((p) => p.test(key))) {
				out[key] = '«redacted: credential-shaped field name»';
				bump(redacted, `${shape(childPath)}${TALLY_SEP}the field name looks like a credential`);
				continue;
			}
			if (key === 'data' && typeof child === 'string' && child.length > 0) sawPayload = true;
			out[key] = walk(child, childPath, depth + 1);
		}
		return out;
	}

	return {
		/**
		 * @param {unknown} value
		 * @param {string} path
		 * @returns {unknown}
		 */
		scrub(value, path) {
			return walk(value, path, 0);
		},
		get hasPayload() {
			return sawPayload;
		},
		/** @returns {string[]} */
		truncations() {
			return [...truncated.entries()].map(
				([where, { count, largest }]) =>
					`Truncated ${count} value${count === 1 ? '' : 's'} at \`${where}\` to ${BUNDLE_LIMITS.string} chars (largest was ${largest}).`
			);
		},
		/** @returns {string[]} */
		omissions() {
			return [...dropped.entries()].map(
				([key, count]) => {
					const [where, reason] = key.split(TALLY_SEP);
					return `Omitted ${count} subtree${count === 1 ? '' : 's'} at \`${where}\` — ${reason}.`;
				}
			);
		},
		/** @returns {string[]} */
		redactions() {
			return [...redacted.entries()].map(([key, count]) => {
				const [where, reason] = key.split(TALLY_SEP);
				return `Redacted ${count} value${count === 1 ? '' : 's'} at \`${where}\` — ${reason}.`;
			});
		}
	};
}

/**
 * @param {Map<string, number>} map
 * @param {string} key
 */
function bump(map, key) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Decodes a base64 `PromiseValue.data` for the appendix.
 *
 * This deliberately does not reuse `client.ts:decodeValue` — importing the
 * client would drag in the connection store's runes and make this module
 * untestable, which is the whole reason it is a `.js` file. The behaviour is
 * intentionally different anyway: the client falls back to returning raw base64
 * so the operator sees the bytes that are really there, whereas the appendix
 * exists only to be readable, so undecodable input is reported as such and
 * skipped — the raw form is already in the record above it.
 *
 * @param {string} base64
 * @returns {string | null} Decoded text, or null when it is not readable text.
 */
export function decodePayload(base64) {
	try {
		const binary = atob(base64);
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		// A payload can decode as valid UTF-8 and still not be text — a protobuf or
		// an image will do that. Control characters other than tab, newline and
		// carriage return are the tell, and pasting that into a chat helps nobody.
		if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return null;
		return text;
	} catch {
		return null;
	}
}

/**
 * Pretty-prints decoded JSON, falls back to the text. A minified payload on one
 * 3000-character line is technically present and practically unreadable.
 *
 * @param {string} text
 * @returns {string}
 */
function prettyIfJson(text) {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

/**
 * Collects readable payloads from the records that have them.
 *
 * @param {RecordGroup[]} groups
 * @param {{label: string, record: unknown} | null | undefined} selection
 * @param {string[]} secrets
 * @returns {{entries: string[], notes: string[]}}
 */
function decodedAppendix(groups, selection, secrets) {
	/** @type {{id: string, field: string, text: string}[]} */
	const found = [];
	let unreadable = 0;

	// The selection first, so that when the cap bites it is the thing the
	// operator actually clicked that survives, not the first row on the page.
	/** @type {unknown[]} */
	const ordered = [];
	if (selection?.record) ordered.push(selection.record);
	for (const group of groups) ordered.push(...group.records);

	const seen = new Set();
	for (const record of ordered) {
		if (found.length >= BUNDLE_LIMITS.decodedRecords) break;
		if (!record || typeof record !== 'object') continue;
		if (seen.has(record)) continue;
		seen.add(record);
		const rec = /** @type {Record<string, unknown>} */ (record);
		const id = typeof rec.id === 'string' ? rec.id : '(no id)';

		for (const field of ['param', 'value', 'promiseParam']) {
			if (found.length >= BUNDLE_LIMITS.decodedRecords) break;
			const holder = rec[field];
			if (!holder || typeof holder !== 'object') continue;
			const data = /** @type {Record<string, unknown>} */ (holder).data;
			if (typeof data !== 'string' || data.length === 0) continue;
			const decoded = decodePayload(data);
			if (decoded === null) {
				unreadable += 1;
				continue;
			}
			let text = prettyIfJson(decoded);
			let clipped = false;
			if (text.length > BUNDLE_LIMITS.decoded) {
				clipped = true;
				text = text.slice(0, BUNDLE_LIMITS.decoded);
			}
			for (const secret of secrets.filter(Boolean)) {
				text = text.split(secret).join('«redacted: this console\'s auth token»');
			}
			text = text.replace(JWT_SHAPE, '«redacted: JWT»');
			JWT_SHAPE.lastIndex = 0;
			found.push({
				id,
				field,
				text: clipped ? `${text}\n…«truncated to ${BUNDLE_LIMITS.decoded} chars»` : text
			});
		}
	}

	/** @type {string[]} */
	const notes = [];
	const withPayloads = countPayloadFields(groups, selection);
	if (withPayloads > found.length + unreadable) {
		notes.push(
			`Decoded ${found.length} of ${withPayloads} payload fields — the appendix is capped at ${BUNDLE_LIMITS.decodedRecords}. The rest are present as base64 in the records above.`
		);
	}
	if (unreadable > 0) {
		notes.push(
			`${unreadable} payload field${unreadable === 1 ? ' was' : 's were'} not readable text (binary or not base64) and ${unreadable === 1 ? 'is' : 'are'} left as base64 above.`
		);
	}

	return {
		entries: found.map(
			({ id, field, text }) => `**\`${id}\`** · \`${field}\`\n\n\`\`\`\n${text}\n\`\`\``
		),
		notes
	};
}

/**
 * @param {RecordGroup[]} groups
 * @param {{label: string, record: unknown} | null | undefined} selection
 * @returns {number}
 */
function countPayloadFields(groups, selection) {
	let total = 0;
	const seen = new Set();
	/** @type {unknown[]} */
	const all = [];
	if (selection?.record) all.push(selection.record);
	for (const group of groups) all.push(...group.records);
	for (const record of all) {
		if (!record || typeof record !== 'object' || seen.has(record)) continue;
		seen.add(record);
		const rec = /** @type {Record<string, unknown>} */ (record);
		for (const field of ['param', 'value', 'promiseParam']) {
			const holder = rec[field];
			if (!holder || typeof holder !== 'object') continue;
			const data = /** @type {Record<string, unknown>} */ (holder).data;
			if (typeof data === 'string' && data.length > 0) total += 1;
		}
	}
	return total;
}

/**
 * An id-and-state-only outline of a promise tree.
 *
 * The records section is flat, because that is how the server returns them and
 * flattening loses nothing about any individual promise. What it does lose is
 * the parent/child relation — and on a workflow view that relation *is* the
 * subject. An assistant handed twenty sibling-looking promises will invent an
 * ordering from the ids, which for a fan-out is exactly wrong.
 *
 * Ids and states only: the full records are already in the bundle, and
 * repeating them here would double a workflow bundle's size to say nothing new.
 *
 * `missing` is carried through deliberately. A missing node is a placeholder
 * for a promise the search did not return, and its state is not fact — an
 * assistant told otherwise will diagnose a step that may never have existed.
 *
 * @param {{promise: {id: string, state: string}, children?: unknown[], missing?: boolean}} node
 * @returns {{id: string, state: string, missing?: true, children?: unknown[]}}
 */
export function treeOutline(node) {
	/** @type {{id: string, state: string, missing?: true, children?: unknown[]}} */
	const out = { id: node.promise.id, state: node.promise.state };
	if (node.missing) out.missing = true;
	const children = node.children ?? [];
	if (children.length > 0) {
		out.children = children.map((child) =>
			treeOutline(
				/** @type {{promise: {id: string, state: string}, children?: unknown[], missing?: boolean}} */ (
					child
				)
			)
		);
	}
	return out;
}

/**
 * Builds the bundle.
 *
 * The whole-document byte cap is enforced by rebuilding with a smaller
 * per-group record cap rather than by cutting the finished string: a bundle
 * sliced mid-document ends in half a JSON record, which an assistant will
 * either choke on or — worse — silently repair into something that was never
 * on screen.
 *
 * @param {CaptureInput} input
 * @returns {Bundle}
 */
export function buildBundle(input) {
	let cap = BUNDLE_LIMITS.records;
	let built = render(input, cap);

	// Halve and rebuild until it fits. Bounded by cap reaching zero, and in
	// practice by the second or third pass.
	while (built.bytes > BUNDLE_LIMITS.bytes && cap > 1) {
		cap = Math.floor(cap / 2);
		built = render(input, cap);
	}
	return built;
}

/**
 * One rendering pass at a given per-group record cap.
 *
 * @param {CaptureInput} input
 * @param {number} cap
 * @returns {Bundle}
 */
function render(input, cap) {
	const secrets = input.secrets ?? [];
	const scrubber = createScrubber(secrets);
	const server = sanitizeServerUrl(input.serverUrl);

	/** @type {string[]} */
	const truncations = [];
	/** @type {string[]} */
	const sections = [];
	let recordCount = 0;

	sections.push(
		`# Resonate console — context bundle`,
		'',
		`**View:** ${input.view} (\`${input.path}\`)  `,
		`**Server:** \`${server.url || '(not set)'}\`  `,
		`**Captured:** ${input.capturedAt}`,
		'',
		'## What you are looking at',
		'',
		SCHEMA_NOTE,
		''
	);

	if (input.notes?.length) {
		sections.push('## About this view', '', ...input.notes.map((n) => `- ${n}`), '');
	}

	sections.push(
		'## View state',
		'',
		'What the operator has selected in the UI — filters, tab, pagination. The records below are',
		'what these settings produced, not the whole server.',
		'',
		'```json',
		JSON.stringify(scrubber.scrub(input.viewState, 'viewState'), null, 2),
		'```',
		''
	);

	if (input.structure) {
		sections.push(
			`## ${input.structure.label}`,
			'',
			input.structure.description,
			'',
			'```json',
			JSON.stringify(scrubber.scrub(input.structure.value, 'structure'), null, 2),
			'```',
			''
		);
	}

	if (input.selection?.record) {
		sections.push(
			'## Selection',
			'',
			`The operator has ${input.selection.label} selected. It also appears in the records below.`,
			'',
			'```json',
			JSON.stringify(scrubber.scrub(input.selection.record, 'selection'), null, 2),
			'```',
			''
		);
	}

	for (const group of input.groups) {
		const kept = group.records.slice(0, cap);
		if (group.records.length > kept.length) {
			truncations.push(
				`**${group.label}: showing ${kept.length} of ${group.records.length} ${group.kind} records.** The rest were dropped to keep this bundle a size you can paste — do not conclude anything about what is missing.`
			);
		}
		recordCount += kept.length;
		const key = group.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
		sections.push(
			`## ${group.label} (${kept.length}${group.records.length > kept.length ? ` of ${group.records.length}` : ''})`,
			'',
			'```json',
			JSON.stringify(scrubber.scrub(kept, key), null, 2),
			'```',
			''
		);
	}

	const appendix = decodedAppendix(
		input.groups.map((g) => ({ ...g, records: g.records.slice(0, cap) })),
		input.selection,
		secrets
	);
	if (appendix.entries.length > 0) {
		sections.push(
			'## Payloads, decoded',
			'',
			'The `data` fields above are base64. These are the same bytes as text, for reading.',
			'',
			...appendix.entries.flatMap((e) => [e, '']),
			''
		);
	}

	const allTruncations = [
		...truncations,
		...scrubber.truncations(),
		...scrubber.omissions(),
		...appendix.notes
	];
	const allRedactions = scrubber.redactions();
	if (server.redacted) {
		allRedactions.push('Removed a username and password embedded in the server URL.');
	}

	sections.push(
		'## What this bundle left out',
		'',
		'Read this before concluding anything from an absence.',
		''
	);
	if (allTruncations.length === 0 && allRedactions.length === 0) {
		sections.push(
			'Nothing. Every record rendered in this view is included in full, and no field needed redacting.',
			''
		);
	} else {
		if (allTruncations.length > 0) {
			sections.push('**Bounded:**', '', ...allTruncations.map((t) => `- ${t}`), '');
		}
		if (allRedactions.length > 0) {
			sections.push(
				'**Redacted** — removed on purpose, not missing by accident:',
				'',
				...allRedactions.map((r) => `- ${r}`),
				''
			);
		}
	}
	sections.push(
		"The console's auth token and server credentials are never included in a bundle.",
		''
	);

	const text = sections.join('\n');
	return {
		text,
		recordCount,
		hasPayload: scrubber.hasPayload,
		truncations: allTruncations,
		redactions: allRedactions,
		bytes: new TextEncoder().encode(text).length
	};
}
