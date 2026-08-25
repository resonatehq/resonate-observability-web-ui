<script lang="ts">
	import {
		createSchedule,
		encodeValue,
		ApiError,
		type ScheduleRecord,
		type CreateScheduleOutcome
	} from '$lib/api/client';
	import {
		CRON_PRESETS,
		CRON_MAX_YEAR,
		DOW_OPTIONS,
		describeCron,
		nextFireTimes,
		formatUtc
	} from '$lib/utils/cron';
	import ErrorPanel from './ErrorPanel.svelte';

	interface Props {
		/** Called with the new record once the server has confirmed it. */
		oncreated: (schedule: ScheduleRecord) => void;
		oncancel: () => void;
	}

	let { oncreated, oncancel }: Props = $props();

	let id = $state('');
	let promiseId = $state('');
	let promiseTimeout = $state(60000);
	let target = $state('poll://any@default');
	let preset = $state('daily');
	let customCron = $state('0 0 * * *');
	let dailyTime = $state('00:00');
	let weeklyDay = $state(2);
	let weeklyTime = $state('00:00');
	let monthlyTime = $state('00:00');
	let showAdvanced = $state(false);
	let promiseParamText = $state('{}');
	let extraTagsText = $state('');

	let submitting = $state(false);
	let error = $state<ApiError | null>(null);
	let duplicate = $state<ScheduleRecord | null>(null);

	/**
	 * The preview clock, advanced on a coarse tick.
	 *
	 * This was captured once at init, on the reasoning that a ticking preview
	 * would shuffle under the operator mid-read. That reasoning holds for a
	 * per-second countdown and not for this: on any sub-hourly schedule every
	 * time in a frozen preview is in the past within a minute, so the form's
	 * one real feature quietly starts describing history while the operator is
	 * still filling in the target. Recomputing on submit would not help — the
	 * window that matters is the one before submit, while they are reading the
	 * preview to decide.
	 *
	 * Fifteen seconds is slow enough that the rendered list only changes when a
	 * fire time is actually crossed, which is the moment it SHOULD change.
	 */
	let now = $state(Date.now());

	$effect(() => {
		const handle = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(handle);
	});

	/** @param {string} hhmm */
	function timeParts(hhmm: string): { h: number; m: number } {
		const [h, m] = hhmm.split(':').map(Number);
		return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
	}

	const cron = $derived.by(() => {
		switch (preset) {
			case 'daily': {
				const { h, m } = timeParts(dailyTime);
				return `${m} ${h} * * *`;
			}
			case 'weekly': {
				const { h, m } = timeParts(weeklyTime);
				return `${m} ${h} * * ${weeklyDay}`;
			}
			case 'monthly': {
				const { h, m } = timeParts(monthlyTime);
				return `${m} ${h} 1 * *`;
			}
			case 'custom':
				return customCron;
			default:
				return CRON_PRESETS.find((p) => p.id === preset)?.cron ?? '';
		}
	});

	const description = $derived(describeCron(cron));
	const fireTimes = $derived(nextFireTimes(cron, now, 3));

	/**
	 * Client-side id rules. A newer server rejects a dot outright
	 * (`validate_schedule_create_data`, src/types.rs:634-646); 0.9.8 accepts
	 * it. Refusing it here is correct against both — a schedule created with a
	 * dot today would start failing validation the moment the server updates.
	 */
	const idProblem = $derived.by(() => {
		if (id.trim() === '') return null;
		if (id.includes('.')) return 'A schedule id must not contain a dot.';
		if (/\s/.test(id)) return 'A schedule id must not contain whitespace.';
		return null;
	});

	const paramProblem = $derived.by(() => {
		if (promiseParamText.trim() === '') return null;
		try {
			JSON.parse(promiseParamText);
			return null;
		} catch {
			return 'Promise param must be valid JSON.';
		}
	});

	const tagsProblem = $derived.by(() => {
		if (extraTagsText.trim() === '') return null;
		for (const line of extraTagsText.split('\n')) {
			if (line.trim() === '') continue;
			if (!line.includes('=')) return `\`${line.trim()}\` is not \`key=value\`.`;
		}
		return null;
	});

	/**
	 * The advanced fields gate `canSubmit` but render only while the panel is
	 * open, so an error in one of them used to leave Create disabled with no
	 * visible reason anywhere in the form once the panel was collapsed —
	 * collapsing is a tidy-up, not an undo, and the bad text is still in state.
	 * The error follows the fields out and is shown on the toggle instead,
	 * which keeps collapsing a real choice rather than a trap.
	 */
	const advancedProblems = $derived(
		[paramProblem, tagsProblem].filter((problem) => problem !== null)
	);

	const canSubmit = $derived(
		id.trim() !== '' &&
			promiseId.trim() !== '' &&
			description.ok &&
			fireTimes.ok &&
			idProblem === null &&
			paramProblem === null &&
			tagsProblem === null &&
			Number.isFinite(promiseTimeout) &&
			promiseTimeout >= 0 &&
			!submitting
	);

	function buildTags(): Record<string, string> {
		const tags: Record<string, string> = {};
		if (target.trim() !== '') tags['resonate:target'] = target.trim();
		for (const line of extraTagsText.split('\n')) {
			if (line.trim() === '') continue;
			const idx = line.indexOf('=');
			tags[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
		}
		return tags;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;

		submitting = true;
		error = null;
		duplicate = null;

		try {
			const outcome: CreateScheduleOutcome = await createSchedule({
				id: id.trim(),
				cron,
				promiseId: promiseId.trim(),
				promiseTimeout,
				// Re-serialised through `JSON.parse` first so the payload is
				// normalised and a syntax error surfaces here rather than being
				// base64'd into an unreadable blob on the server.
				promiseParam:
					promiseParamText.trim() === ''
						? {}
						: encodeValue(JSON.stringify(JSON.parse(promiseParamText))),
				promiseTags: buildTags()
			});

			if (outcome.duplicate) {
				duplicate = outcome.schedule;
			} else {
				oncreated(outcome.schedule);
			}
		} catch (e) {
			error = e instanceof ApiError ? e : new ApiError('unknown', String(e), null);
		} finally {
			submitting = false;
		}
	}
</script>

<form class="schedule-form" onsubmit={submit}>
	<h2>New schedule</h2>

	{#if error}
		<ErrorPanel {error} while="creating the schedule" />
	{/if}

	{#if duplicate}
		<!--
			The server said 200. It is still not what was asked for, and saying
			"created" here would be a lie the operator only discovers when the
			wrong cron fires.
		-->
		<div class="alert alert-warning" role="alert">
			<p><strong>That id already exists — nothing was created.</strong></p>
			<p>
				The server returned the schedule already registered under
				<code class="mono">{duplicate.id}</code>, unchanged, and discarded what was submitted. It
				answers 200 for this, so it is not reported as an error.
			</p>
			<!--
				The timeout and target are shown because they are now compared:
				"same schedule, new target" is a normal thing to try, and it is
				discarded exactly as silently as a changed cron.
			-->
			<p class="dup-detail">
				Existing: <code class="mono">{duplicate.cron}</code> &rarr;
				<code class="mono">{duplicate.promiseId}</code>, timeout
				<code class="mono">{duplicate.promiseTimeout}</code>, target
				<code class="mono">{duplicate.promiseTags['resonate:target'] ?? '(none)'}</code><br />
				Submitted: <code class="mono">{cron}</code> &rarr;
				<code class="mono">{promiseId.trim()}</code>, timeout
				<code class="mono">{promiseTimeout}</code>, target
				<code class="mono">{target.trim() === '' ? '(none)' : target.trim()}</code>
			</p>
			<p>Choose a different id, or delete the existing schedule first.</p>
		</div>
	{/if}

	<div class="field">
		<label for="sched-id">Schedule id</label>
		<input
			id="sched-id"
			class="search-input"
			bind:value={id}
			placeholder="nightly-reconcile"
			autocomplete="off"
			aria-invalid={idProblem !== null}
			aria-describedby={idProblem ? 'sched-id-error' : undefined}
		/>
		{#if idProblem}<p class="field-error" id="sched-id-error">{idProblem}</p>{/if}
	</div>

	<div class="field">
		<label for="sched-promise">Promise id template</label>
		<input
			id="sched-promise"
			class="search-input mono"
			bind:value={promiseId}
			placeholder="nightly-reconcile-{'{{.timestamp}}'}"
			autocomplete="off"
		/>
		<p class="field-hint">
			Each run creates a promise from this template. Include a varying part such as
			<code class="mono">{'{{.timestamp}}'}</code> — a fixed id resolves once and every later run
			collides with it.
		</p>
	</div>

	<fieldset class="field">
		<legend>When</legend>
		<select class="search-select" bind:value={preset} aria-label="Schedule frequency">
			{#each CRON_PRESETS as option}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>

		{#if preset === 'daily'}
			<label class="inline-label" for="daily-time">at</label>
			<input id="daily-time" class="search-input time" type="time" bind:value={dailyTime} />
			<span class="utc-note">UTC</span>
		{:else if preset === 'weekly'}
			<label class="inline-label" for="weekly-day">on</label>
			<select id="weekly-day" class="search-select" bind:value={weeklyDay}>
				{#each DOW_OPTIONS as day}
					<option value={day.value}>{day.label}</option>
				{/each}
			</select>
			<input class="search-input time" type="time" bind:value={weeklyTime} aria-label="Time" />
			<span class="utc-note">UTC</span>
		{:else if preset === 'monthly'}
			<label class="inline-label" for="monthly-time">at</label>
			<input id="monthly-time" class="search-input time" type="time" bind:value={monthlyTime} />
			<span class="utc-note">UTC</span>
		{:else if preset === 'custom'}
			<input
				class="search-input mono custom-cron"
				bind:value={customCron}
				placeholder="0 0 * * *"
				aria-label="Cron expression"
				autocomplete="off"
				spellcheck="false"
			/>
		{/if}
	</fieldset>

	<!--
		The preview is the feature. Everything above it is data entry; this is
		the part that turns a cron string into a decision the operator can
		actually make, and it is the only place the 1 = Sunday convention
		becomes visible before the schedule is live.
	-->
	<div class="preview" class:preview-invalid={!description.ok || !fireTimes.ok}>
		{#if !description.ok}
			<p class="preview-error">{description.error}</p>
		{:else if !fireTimes.ok}
			<p class="preview-error">{fireTimes.error}</p>
		{:else}
			<p class="preview-text">{description.text}</p>
			<code class="mono preview-cron">{cron}</code>
			<!--
				When the projection runs out before three, say so. A fixed "next
				three runs" heading over a single row reads as "this fires three
				times and here is the first", which is the opposite of the truth.
			-->
			<p class="preview-label">
				{fireTimes.truncated
					? `Every run this will ever have (${fireTimes.times.length})`
					: 'Next three runs'}
			</p>
			<ul class="preview-times">
				{#each fireTimes.times as time}
					<li class="mono">{formatUtc(time)}</li>
				{/each}
			</ul>
			{#if fireTimes.truncated}
				<p class="preview-note">
					This expression has no further runs before {CRON_MAX_YEAR}, which is as far as this
					server's cron reaches.
				</p>
			{/if}
			{#if preset === 'custom'}
				<p class="preview-warn">
					Weekdays are <strong>1&nbsp;=&nbsp;Sunday</strong> through 7&nbsp;=&nbsp;Saturday, and
					<code class="mono">0</code> is rejected. Day-of-month and weekday are combined with AND,
					not OR. Both differ from Unix cron — read the description above, not the expression.
				</p>
			{/if}
		{/if}
	</div>

	<div class="field">
		<label for="sched-target">Target</label>
		<input
			id="sched-target"
			class="search-input mono"
			bind:value={target}
			placeholder="poll://any@default"
			autocomplete="off"
			aria-describedby={target.trim() === '' ? 'sched-target-warning' : undefined}
		/>
		<p class="field-hint">
			Written as the <code class="mono">resonate:target</code> tag — where the promise this schedule
			creates gets delivered. Schemes: <code class="mono">poll://</code>,
			<code class="mono">http(s)://</code>, <code class="mono">gcps://</code>,
			<code class="mono">bash://</code>. A newer server rejects a schedule without this tag; 0.9.8
			accepts one and then has nowhere to deliver the work.
		</p>
		{#if target.trim() === ''}
			<p class="field-error" id="sched-target-warning">
				Without a target, nothing will execute the promises this creates.
			</p>
		{/if}
	</div>

	<div class="field">
		<label for="sched-timeout">Promise timeout (ms)</label>
		<input
			id="sched-timeout"
			class="search-input timeout"
			type="number"
			min="0"
			bind:value={promiseTimeout}
		/>
		<p class="field-hint">
			How long each created promise may stay pending before it times out. Required by the server —
			it has no default.
		</p>
	</div>

	<button
		type="button"
		class="disclosure"
		aria-expanded={showAdvanced}
		aria-describedby={!showAdvanced && advancedProblems.length > 0
			? 'sched-advanced-error'
			: undefined}
		onclick={() => (showAdvanced = !showAdvanced)}
	>
		{showAdvanced ? '−' : '+'} Promise param and extra tags
	</button>

	{#if !showAdvanced && advancedProblems.length > 0}
		<p class="field-error disclosure-error" id="sched-advanced-error">
			{advancedProblems.join(' ')} Open this section to fix it.
		</p>
	{/if}

	{#if showAdvanced}
		<div class="field">
			<label for="sched-param">Promise param (JSON)</label>
			<textarea
				id="sched-param"
				class="search-input mono param"
				rows="4"
				bind:value={promiseParamText}
				aria-invalid={paramProblem !== null}
				aria-describedby={paramProblem ? 'sched-param-error' : undefined}
			></textarea>
			{#if paramProblem}<p class="field-error" id="sched-param-error">{paramProblem}</p>{/if}
		</div>

		<div class="field">
			<label for="sched-tags">Extra tags</label>
			<textarea
				id="sched-tags"
				class="search-input mono param"
				rows="3"
				placeholder="team=payments"
				bind:value={extraTagsText}
				aria-invalid={tagsProblem !== null}
				aria-describedby={tagsProblem ? 'sched-tags-error' : undefined}
			></textarea>
			<p class="field-hint">One <code class="mono">key=value</code> per line.</p>
			{#if tagsProblem}<p class="field-error" id="sched-tags-error">{tagsProblem}</p>{/if}
		</div>
	{/if}

	<div class="actions">
		<button type="submit" class="btn btn-primary" disabled={!canSubmit}>
			{submitting ? 'Creating...' : 'Create schedule'}
		</button>
		<button type="button" class="btn" onclick={oncancel} disabled={submitting}>Cancel</button>
	</div>
</form>

<style>
	.schedule-form {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
		max-width: 46rem;
	}

	.schedule-form h2 {
		margin: 0 0 1.25rem;
		font-size: 1.05rem;
		font-weight: 600;
	}

	.field {
		margin-bottom: 1.1rem;
		border: 0;
		padding: 0;
	}

	.field label,
	.field legend {
		display: block;
		margin-bottom: 0.35rem;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text);
		padding: 0;
	}

	.field .inline-label {
		display: inline;
		margin: 0 0.4rem 0 0.5rem;
		color: var(--text-muted);
		font-weight: 400;
	}

	.field-hint {
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--text-muted);
	}

	.field-error {
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
		color: var(--status-rejected-fg);
	}

	.time {
		width: auto;
		display: inline-block;
	}

	.timeout {
		width: 10rem;
	}

	.custom-cron {
		margin-top: 0.6rem;
		width: 100%;
	}

	.param {
		width: 100%;
		resize: vertical;
		font-size: 0.82rem;
		padding: 0.5rem 0.6rem;
	}

	.utc-note {
		margin-left: 0.4rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.preview {
		background: var(--secondary-bg-soft);
		border: 1px solid var(--border);
		border-left: 3px solid var(--secondary-fill);
		border-radius: 6px;
		padding: 0.9rem 1rem;
		margin-bottom: 1.1rem;
	}

	.preview-invalid {
		border-left-color: var(--status-rejected);
		background: var(--status-rejected-bg);
	}

	.preview-text {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 500;
	}

	.preview-cron {
		display: inline-block;
		margin-top: 0.35rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.preview-error {
		margin: 0;
		font-size: 0.88rem;
		color: var(--status-rejected-fg);
	}

	.preview-label {
		margin: 0.8rem 0 0.3rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.preview-times {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.82rem;
		line-height: 1.6;
	}

	.preview-note {
		margin: 0.5rem 0 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.preview-warn {
		margin: 0.8rem 0 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.dup-detail {
		font-size: 0.82rem;
		line-height: 1.7;
	}

	.disclosure {
		background: none;
		border: 0;
		padding: 0;
		margin-bottom: 1rem;
		font: inherit;
		font-size: 0.83rem;
		color: var(--secondary);
		cursor: pointer;
	}

	.disclosure:hover {
		text-decoration: underline;
	}

	/* Pulls up against the toggle's own 1rem gap so the error reads as
	   belonging to it rather than floating above the actions. */
	.disclosure-error {
		margin: -0.7rem 0 1rem;
	}

	.actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 1.25rem;
	}
</style>
