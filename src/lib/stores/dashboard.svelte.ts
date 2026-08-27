import {
	searchPromises,
	searchSchedules,
	ApiError,
	type PromiseRecord,
	type ScheduleRecord
} from '$lib/api/client';
import { computeStats, getRecentFailures, getActivePending, type PromiseStats } from '$lib/utils/stats';

class DashboardStore {
	promises: PromiseRecord[] = $state([]);
	schedules: ScheduleRecord[] = $state([]);
	stats: PromiseStats = $state({
		total: 0,
		pending: 0,
		resolved: 0,
		rejected: 0,
		rejectedCanceled: 0,
		rejectedTimedOut: 0,
		throughputPerMin: 0,
		errorRate: 0
	});
	recentFailures: PromiseRecord[] = $state([]);
	activePending: PromiseRecord[] = $state([]);
	loading = $state(true);
	error = $state<ApiError | null>(null);
	/**
	 * How many promises the figures below were computed from.
	 *
	 * Every number on the dashboard is counted client-side over one page of
	 * search results, because `/metrics` exposes API traffic rather than
	 * promise counts by state. The UI says "sampled from N" rather than
	 * implying a server-wide total.
	 */
	sampleSize = $state(0);
	/** True when the server had more promises than this sample covers. */
	sampleTruncated = $state(false);

	/** When this store last loaded successfully, for the stale notice. */
	loadedAt = $state<number | null>(null);

	/** Records held from an earlier load, with the current one having failed. */
	get stale() {
		return this.error !== null && this.loadedAt !== null && this.promises.length > 0;
	}

	private pollInterval: ReturnType<typeof setInterval> | null = null;

	async load() {
		this.loading = true;
		try {
			// One page only. There is no sort parameter, so this is the first
			// 100 promises by ID — not the most recent 100, whatever the old
			// `sortId: -1` implied.
			const promiseResult = await searchPromises({ limit: 100 });
			const scheduleResult = await searchSchedules({ limit: 100 });

			// Both requests are awaited BEFORE anything is assigned. Assigning as
			// each one landed meant a failure in the second call left the store
			// holding fresh promises, stale schedules and stats computed for
			// neither — a mixed state that no single "keep" or "clear" rule can
			// describe honestly, because half of it is current and half is not.
			this.promises = promiseResult.promises;
			this.sampleSize = promiseResult.promises.length;
			this.sampleTruncated = !!promiseResult.cursor;
			this.schedules = scheduleResult.schedules;

			// Compute stats
			this.stats = computeStats(this.promises);
			this.recentFailures = getRecentFailures(this.promises, 10);
			this.activePending = getActivePending(this.promises, 5);

			this.loadedAt = Date.now();
			// Cleared here rather than at the top of `load`. Clearing on entry made
			// the error panel vanish and reappear on every 5s tick while the server
			// was down, which reads as an intermittent fault rather than a
			// consistently unreachable server.
			this.error = null;
		} catch (e) {
			this.error = e instanceof ApiError ? e : new ApiError('unknown', String(e), null);
			// Records are kept and labelled rather than cleared. This view polls
			// every 5s; clearing would let one blip blank a populated dashboard
			// somebody is watching, which trades a small honesty problem for a
			// larger one. `loadedAt` is deliberately not updated, so the notice on
			// screen keeps naming the last time these numbers were actually current.
		} finally {
			this.loading = false;
		}
	}

	startPolling(intervalMs: number = 5000) {
		this.stopPolling();
		this.load(); // Initial load
		this.pollInterval = setInterval(() => {
			// Only poll if document is visible
			if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
				this.load();
			}
		}, intervalMs);
	}

	stopPolling() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}
}

export const dashboardStore = new DashboardStore();
