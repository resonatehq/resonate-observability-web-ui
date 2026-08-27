<script lang="ts">
	import { untrack, tick } from 'svelte';
	import { searchSchedules, ApiError, type ScheduleRecord } from '$lib/api/client';
	import ScheduleTable from '$lib/components/ScheduleTable.svelte';
	import ScheduleForm from '$lib/components/ScheduleForm.svelte';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';
	import StaleNotice from '$lib/components/StaleNotice.svelte';
	import AskAi from '$lib/components/AskAi.svelte';

	let schedules: ScheduleRecord[] = $state([]);
	let error = $state<ApiError | null>(null);
	let loading = $state(true);
	let cursor = $state<string | undefined>(undefined);
	let hasMore = $state(false);
	let showForm = $state(false);
	let created = $state<ScheduleRecord | null>(null);
	/** When the rows were last loaded successfully, for the stale notice. */
	let loadedAt = $state<number | null>(null);

	/** Rows held from an earlier load, with the current one having failed. */
	const stale = $derived(error !== null && schedules.length > 0 && loadedAt !== null);

	/**
	 * Both ways out of the form unmount the control that was focused — the
	 * submit button or the cancel button — and focus then falls to `<body>`,
	 * so a keyboard user's next Tab restarts at the top of the page. The
	 * `role="status"` banner keeps screen-reader users informed either way;
	 * this is what sighted keyboard users were missing.
	 *
	 * Create lands on the banner, because the link to the new schedule is the
	 * next thing anyone wants. Cancel returns focus to the button that opened
	 * the form, which is where it came from.
	 */
	let createdAlert = $state<HTMLElement | null>(null);
	let newButton = $state<HTMLButtonElement | null>(null);

	async function load(append = false) {
		loading = true;
		try {
			const result = await searchSchedules({
				limit: 50,
				cursor: append ? cursor : undefined
			});
			schedules = append ? [...schedules, ...result.schedules] : result.schedules;
			cursor = result.cursor;
			hasMore = !!result.cursor;
			loadedAt = Date.now();
			error = null;
		} catch (e) {
			error = e instanceof ApiError ? e : new ApiError('unknown', String(e), null);
			// Rows are kept and labelled rather than cleared — see StaleNotice.
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		untrack(() => load(false));
	});

	/**
	 * Reload rather than pushing the returned record onto the list. The server
	 * decides `nextRunAt`, and a fresh search is the only thing that proves the
	 * schedule is actually registered and being scheduled — appending locally
	 * would show a row that looks identical whether or not that is true.
	 */
	async function onCreated(schedule: ScheduleRecord) {
		showForm = false;
		created = schedule;
		load(false);
		await tick();
		createdAlert?.focus();
	}

	async function onCancel() {
		showForm = false;
		await tick();
		newButton?.focus();
	}

	function capture() {
		return {
			view: 'Schedules',
			path: '/schedules',
			viewState: {
				loaded: schedules.length,
				moreAvailable: hasMore,
				createFormOpen: showForm,
				justCreated: created?.id ?? null
			},
			groups: [{ label: 'Schedules in view', kind: 'schedule', records: schedules }],
			selection: null,
			loadError: error,
			notes: [
				'A schedule creates a new promise on each fire, from `promiseId` as a template. `nextRunAt` and `lastRunAt` are epoch milliseconds, and the server evaluates cron in UTC.',
				'`lastRunAt` is absent, not null, on a schedule that has never fired.',
				'The server parses cron with the Rust `cron` crate, not Unix cron. Day-of-week is 1-7 with **1 = Sunday**, and day-of-month and day-of-week are ANDed rather than ORed — so a Unix reading of these expressions gets the wrong day. See `src/lib/utils/cron.js` for the full list.'
			]
		};
	}
</script>

<div class="page-header">
	<h1>Schedules</h1>
	<AskAi {capture} size="small" />
	{#if !showForm}
		<button
			class="btn btn-primary new-schedule"
			bind:this={newButton}
			onclick={() => {
				showForm = true;
				created = null;
			}}
		>
			New schedule
		</button>
	{/if}
</div>

{#if showForm}
	<ScheduleForm oncreated={onCreated} oncancel={onCancel} />
{/if}

{#if created}
	<div class="alert created-alert" role="status" tabindex="-1" bind:this={createdAlert}>
		Created <a href="/schedules/{created.id}" class="mono">{created.id}</a>. First run
		<span class="mono">{new Date(created.nextRunAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>.
	</div>
{/if}

<!--
	No search box: `schedule.search` takes only {tags, limit, cursor}. An id
	query would have been accepted and ignored.
-->

{#if error}
	<ErrorPanel {error} while="loading schedules" />
{/if}

{#if stale && loadedAt !== null}
	<StaleNotice since={loadedAt} what="these schedules" />
{/if}

{#if loading && schedules.length === 0}
	<div class="loading">Loading...</div>
{:else}
	<ScheduleTable {schedules} />
	{#if hasMore}
		<div class="load-more">
			<button class="btn" onclick={() => load(true)} disabled={loading}>
				{loading ? 'Loading...' : 'Load more'}
			</button>
		</div>
	{/if}
{/if}

<style>
	.load-more {
		display: flex;
		justify-content: center;
		margin-top: 1.5rem;
	}

	.new-schedule {
		margin-left: auto;
	}

	.created-alert {
		background: var(--status-resolved-bg);
		border: 1px solid var(--status-resolved);
		color: var(--status-resolved-fg);
		margin-bottom: 1.25rem;
	}

	/* The banner is only ever focused programmatically, and the whole point of
	   moving focus there is that a sighted keyboard user can see where they
	   landed — so this ring stays. */
	.created-alert:focus {
		outline: 2px solid var(--status-resolved);
		outline-offset: 2px;
	}

	.created-alert a {
		color: inherit;
		font-weight: 500;
	}
</style>
